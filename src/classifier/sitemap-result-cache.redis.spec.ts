import { onTestFinished } from "vitest";
import {
  closedRedis,
  connectTestRedis,
  testConnection,
  uniqueId,
} from "../../test/support/redis.js";
import type { RedisClient } from "../redis/redis-client.js";
import type { RerankStatus } from "./classification.js";
import type { ClassificationOutcome } from "./classification-service.js";
import {
  redisResultStore,
  sitemapResultKey,
  SitemapResultCache,
  type SitemapResultCacheOptions,
  type SitemapResultInput,
} from "./sitemap-result-cache.js";

const DAY_SECONDS = 24 * 60 * 60;
const NOW = new Date("2026-10-25T12:00:00.000Z");

let raw: RedisClient;

beforeAll(async () => {
  raw = await connectTestRedis();
});

afterAll(() => {
  raw.destroy();
});

function input(): SitemapResultInput {
  return {
    collectionName: uniqueId("collection"),
    topK: 10,
    query: "laptop computer",
  };
}

function outcome(rerank: RerankStatus = "applied"): ClassificationOutcome {
  return {
    results: [
      {
        id: 7,
        score: 0.91,
        payload: { original_id: "43211503", class_name: "Notebook computers" },
        rerankRelevanceScore: 0.91,
      },
      { id: "point-2", score: 0.5, payload: { nested: { a: [1, "b"] } } },
    ],
    versionName: "UNSPSC v26",
    version: { collectionName: "c" },
    query: "laptop computer",
    elapsedSeconds: 1.2345,
    rerank,
  };
}

function connectedCache(options: SitemapResultCacheOptions = {}) {
  const connection = testConnection();
  onTestFinished(() => connection.close());
  return new SitemapResultCache(redisResultStore(connection), {
    now: () => NOW,
    ...options,
  });
}

function counting(rerank: RerankStatus = "applied") {
  const calls: AbortSignal[] = [];
  return {
    calls,
    classify: (signal: AbortSignal) => {
      calls.push(signal);
      return Promise.resolve(outcome(rerank));
    },
  };
}

const live = () => new AbortController().signal;

describe("SitemapResultCache", () => {
  it("serves a stored result without classifying again", async () => {
    const key = input();
    const first = counting();
    const second = counting();

    const filled = await connectedCache().get(key, live(), first.classify);
    const hit = await connectedCache().get(key, live(), second.classify);

    expect(filled).toEqual({
      result: {
        results: outcome().results,
        versionName: "UNSPSC v26",
        query: "laptop computer",
        elapsedSeconds: 1.2345,
        computedAt: "2026-10-25T12:00:00.000Z",
      },
      complete: true,
    });
    expect(hit).toEqual(filled);
    expect(first.calls).toHaveLength(1);
    expect(second.calls).toHaveLength(0);
  });

  it("keys the result by collection, top-k and query", async () => {
    const key = input();
    const cache = connectedCache();
    await cache.get(key, live(), counting().classify);

    for (const other of [
      { ...key, collectionName: uniqueId("collection") },
      { ...key, topK: 5 },
      { ...key, query: "laptop" },
    ]) {
      const { calls, classify } = counting();
      await cache.get(other, live(), classify);
      expect(calls, JSON.stringify(other)).toHaveLength(1);
    }
    expect(
      await raw.exists(
        `ssr-result:v1:${key.collectionName}:10:laptop computer`,
      ),
    ).toBe(1);
  });

  it.each([
    [0, 24],
    [0.5, 30],
    [0.999999, 36],
  ])(
    "expires a result after 30 days give or take 20%% (random %s)",
    async (random, days) => {
      const key = input();
      await connectedCache({ random: () => random }).get(
        key,
        live(),
        counting().classify,
      );

      const ttl = await raw.ttl(sitemapResultKey(key));
      expect(ttl).toBeGreaterThan(days * DAY_SECONDS - 5);
      expect(ttl).toBeLessThanOrEqual(days * DAY_SECONDS);
    },
  );

  it.each([
    ["not JSON", "{"],
    ["the wrong shape", JSON.stringify({ results: "none" })],
    ["a bad timestamp", JSON.stringify({ ...outcome(), computedAt: "today" })],
  ])("treats %s as a miss and replaces it", async (_, value) => {
    const key = input();
    await raw.set(sitemapResultKey(key), value);
    const { calls, classify } = counting();

    const { result } = await connectedCache().get(key, live(), classify);

    expect(calls).toHaveLength(1);
    expect(result.results).toEqual(outcome().results);
    expect(
      JSON.parse((await raw.get(sitemapResultKey(key)))!) as unknown,
    ).toEqual(result);
  });

  it.each(["failed", "skipped"] as const)(
    "returns an incomplete result whose reranking %s without storing it",
    async (rerank) => {
      const key = input();
      const cache = connectedCache();

      const lookup = await cache.get(key, live(), counting(rerank).classify);
      const stored = await raw.exists(sitemapResultKey(key));
      const again = counting(rerank);
      await cache.get(key, live(), again.classify);

      expect(lookup.result.results).toEqual(outcome().results);
      expect(lookup.complete).toBe(false);
      expect(stored).toBe(0);
      expect(again.calls).toHaveLength(1);
    },
  );

  it("stores a result that ID matches decided without reranking", async () => {
    const key = input();
    const lookup = await connectedCache().get(
      key,
      live(),
      counting("not_needed").classify,
    );

    expect(lookup.complete).toBe(true);
    expect(await raw.exists(sitemapResultKey(key))).toBe(1);
  });

  it("classifies once for concurrent requests for one key", async () => {
    const key = input();
    const cache = connectedCache();
    let finish!: (value: ClassificationOutcome) => void;
    let calls = 0;
    const classify = () => {
      calls += 1;
      return new Promise<ClassificationOutcome>((resolve) => {
        finish = resolve;
      });
    };

    const requests = [1, 2, 3].map(() => cache.get(key, live(), classify));
    await vi.waitUntil(() => calls > 0);
    finish(outcome());
    const results = await Promise.all(requests);

    expect(calls).toBe(1);
    expect(results[1]).toEqual(results[0]);
    expect(results[2]).toEqual(results[0]);
  });

  it("finishes and stores the fill when the first requester leaves", async () => {
    const key = input();
    const cache = connectedCache();
    let finish!: (value: ClassificationOutcome) => void;
    let fillSignal: AbortSignal | undefined;
    const classify = (signal: AbortSignal) => {
      fillSignal = signal;
      return new Promise<ClassificationOutcome>((resolve) => {
        finish = resolve;
      });
    };
    const leaving = new AbortController();

    const first = cache.get(key, leaving.signal, classify);
    await vi.waitUntil(() => fillSignal !== undefined);
    const second = cache.get(key, live(), classify);
    leaving.abort(new Error("client gone"));
    await expect(first).rejects.toThrow("client gone");
    expect(fillSignal!.aborted).toBe(false);
    finish(outcome());

    expect((await second).result.results).toEqual(outcome().results);
    expect(await raw.exists(sitemapResultKey(key))).toBe(1);
  });

  it("aborts the fill at shutdown and stores nothing", async () => {
    const key = input();
    const cache = connectedCache();
    const classify = (signal: AbortSignal) =>
      new Promise<ClassificationOutcome>((_, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason as Error));
      });

    const pending = cache.get(key, live(), classify);
    await new Promise((resolve) => setTimeout(resolve, 20));
    cache.close();

    await expect(pending).rejects.toThrow("shutting down");
    expect(await raw.exists(sitemapResultKey(key))).toBe(0);
  });

  it("shares a classification failure with every waiter and retries later", async () => {
    const key = input();
    const cache = connectedCache();
    const failing = () => Promise.reject(new Error("queue full"));

    await expect(cache.get(key, live(), failing)).rejects.toThrow("queue full");
    const { calls, classify } = counting();
    await cache.get(key, live(), classify);

    expect(calls).toHaveLength(1);
  });

  it("classifies and returns the result when Redis is down", async () => {
    const key = input();
    const cache = new SitemapResultCache(redisResultStore(closedRedis()), {
      now: () => NOW,
    });
    const { calls, classify } = counting();

    const lookup = await cache.get(key, live(), classify);

    expect(calls).toHaveLength(1);
    expect(lookup).toMatchObject({
      result: { results: outcome().results },
      complete: true,
    });
    expect(await raw.exists(sitemapResultKey(key))).toBe(0);
  });

  it("classifies without a store when Redis was unreachable at startup", async () => {
    const key = input();
    const cache = new SitemapResultCache(null);
    const { calls, classify } = counting();

    await cache.get(key, live(), classify);
    await cache.get(key, live(), classify);

    expect(calls).toHaveLength(2);
  });
});
