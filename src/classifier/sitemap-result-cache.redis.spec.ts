import { onTestFinished } from "vitest";
import {
  closedRedis,
  connectTestRedis,
  hungRedis,
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
  type ResultStore,
  type SitemapLookup,
  type SitemapResultCacheOptions,
  type SitemapResultInput,
} from "./sitemap-result-cache.js";

const DAY_SECONDS = 24 * 60 * 60;
const MEMORY_MS = 10 * 60 * 1000;
const NOW = new Date("2026-10-25T12:00:00.000Z");

let raw: RedisClient;

beforeAll(async () => {
  raw = await connectTestRedis();
});

afterAll(() => {
  raw.destroy();
});

afterEach(() => {
  vi.useRealTimers();
});

function input(): SitemapResultInput {
  return {
    collectionName: uniqueId("collection"),
    topK: 10,
    query: "laptop computer",
  };
}

function outcome(
  overrides: Partial<ClassificationOutcome> = {},
): ClassificationOutcome {
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
    rerank: "applied",
    idSearch: "ok",
    ...overrides,
  };
}

function clock() {
  let ms = NOW.getTime();
  return {
    now: () => new Date(ms),
    advance: (byMs: number) => {
      ms += byMs;
    },
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

function counting(overrides: Partial<ClassificationOutcome> = {}) {
  const calls: AbortSignal[] = [];
  return {
    calls,
    classify: (signal: AbortSignal) => {
      calls.push(signal);
      return Promise.resolve(outcome(overrides));
    },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
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
    await vi.waitUntil(async () =>
      (await raw.get(sitemapResultKey(key)))?.startsWith('{"results":['),
    );
    expect(
      JSON.parse((await raw.get(sitemapResultKey(key)))!) as unknown,
    ).toEqual(result);
  });

  it.each([
    ["a failed rerank", { rerank: "failed" as RerankStatus }],
    ["a skipped rerank", { rerank: "skipped" as RerankStatus }],
    ["a failed ID search", { idSearch: "failed" as const }],
    ["no results", { results: [], rerank: "not_needed" as RerankStatus }],
  ])(
    "returns an incomplete result after %s without storing it",
    async (_, overrides) => {
      const key = input();

      const lookup = await connectedCache().get(
        key,
        live(),
        counting(overrides).classify,
      );

      expect(lookup.complete).toBe(false);
      expect(await raw.exists(sitemapResultKey(key))).toBe(0);
    },
  );

  it("stores a result that ID matches decided without reranking", async () => {
    const key = input();
    const lookup = await connectedCache().get(
      key,
      live(),
      counting({ rerank: "not_needed" }).classify,
    );

    expect(lookup.complete).toBe(true);
    await vi.waitUntil(
      async () => (await raw.exists(sitemapResultKey(key))) === 1,
    );
  });

  it("remembers an incomplete result for 10 minutes", async () => {
    const key = input();
    const time = clock();
    const cache = connectedCache({ now: time.now });
    const degraded = counting({ rerank: "failed" });

    const first = await cache.get(key, live(), degraded.classify);
    time.advance(MEMORY_MS - 1);
    const second = await cache.get(key, live(), degraded.classify);
    time.advance(1);
    const third = await cache.get(key, live(), degraded.classify);

    expect(second).toEqual(first);
    expect(second.complete).toBe(false);
    expect(degraded.calls).toHaveLength(2);
    expect(third.result.computedAt).not.toBe(first.result.computedAt);
  });

  it("forgets the oldest remembered result beyond its limit", async () => {
    const cache = new SitemapResultCache(null, { memoryLimit: 2 });
    const keys = [input(), input(), input()];
    const { calls, classify } = counting();
    for (const key of keys) await cache.get(key, live(), classify);

    await cache.get(keys[2]!, live(), classify);
    await cache.get(keys[1]!, live(), classify);
    expect(calls).toHaveLength(3);
    await cache.get(keys[0]!, live(), classify);
    expect(calls).toHaveLength(4);
  });

  it("classifies once for concurrent requests for one key", async () => {
    const key = input();
    const cache = connectedCache();
    const result = deferred<ClassificationOutcome>();
    let calls = 0;
    const classify = () => {
      calls += 1;
      return result.promise;
    };

    const requests = [1, 2, 3].map(() => cache.get(key, live(), classify));
    await vi.waitUntil(() => calls > 0);
    result.resolve(outcome());
    const results = await Promise.all(requests);

    expect(calls).toBe(1);
    expect(results[1]).toEqual(results[0]);
    expect(results[2]).toEqual(results[0]);
  });

  it("shares a classification failure with every waiter and forgets it", async () => {
    const key = input();
    const cache = connectedCache();
    const failure = deferred<ClassificationOutcome>();
    let calls = 0;
    const failing = () => {
      calls += 1;
      return failure.promise;
    };

    const waiters = [1, 2, 3].map(() =>
      cache.get(key, live(), failing).catch((error: Error) => error.message),
    );
    await vi.waitUntil(() => calls > 0);
    failure.reject(new Error("queue full"));

    expect(await Promise.all(waiters)).toEqual([
      "queue full",
      "queue full",
      "queue full",
    ]);
    expect(calls).toBe(1);
    const retry = counting();
    await cache.get(key, live(), retry.classify);
    expect(retry.calls).toHaveLength(1);
  });

  it("finishes and stores the fill when the first requester leaves", async () => {
    const key = input();
    const cache = connectedCache();
    const result = deferred<ClassificationOutcome>();
    let fillSignal: AbortSignal | undefined;
    const classify = (signal: AbortSignal) => {
      fillSignal = signal;
      return result.promise;
    };
    const leaving = new AbortController();

    const first = cache.get(key, leaving.signal, classify);
    await vi.waitUntil(() => fillSignal !== undefined);
    const second = cache.get(key, live(), classify);
    leaving.abort(new Error("client gone"));
    await expect(first).rejects.toThrow("client gone");
    expect(fillSignal!.aborted).toBe(false);
    result.resolve(outcome());

    expect((await second).result.results).toEqual(outcome().results);
    await vi.waitUntil(
      async () => (await raw.exists(sitemapResultKey(key))) === 1,
    );
  });

  it("answers before a hung write settles and keeps the key claimed", async () => {
    const key = input();
    const write = deferred<void>();
    const writes: string[] = [];
    const store: ResultStore = {
      get: () => Promise.resolve(null),
      set: (written) => {
        writes.push(written);
        return write.promise;
      },
    };
    const cache = new SitemapResultCache(store);
    const { calls, classify } = counting();

    const first = await cache.get(key, live(), classify);
    const during = await cache.get(key, live(), classify);

    expect(first.complete).toBe(true);
    expect(during).toEqual(first);
    expect(writes).toEqual([sitemapResultKey(key)]);
    expect(calls).toHaveLength(1);
    write.resolve();
  });

  it("remembers a complete result that Redis could not store", async () => {
    const key = input();
    const time = clock();
    const cache = new SitemapResultCache(redisResultStore(closedRedis()), {
      now: time.now,
    });
    const { calls, classify } = counting();

    const first = await cache.get(key, live(), classify);
    // Let the refused write settle.
    await new Promise((resolve) => setTimeout(resolve, 20));
    const remembered = await cache.get(key, live(), classify);
    time.advance(MEMORY_MS);
    await cache.get(key, live(), classify);

    expect(first.complete).toBe(true);
    expect(remembered).toEqual(first);
    expect(calls).toHaveLength(2);
  });

  it("remembers results without a store when Redis was unreachable at startup", async () => {
    const key = input();
    const cache = new SitemapResultCache(null);
    const { calls, classify } = counting();

    await cache.get(key, live(), classify);
    await cache.get(key, live(), classify);

    expect(calls).toHaveLength(1);
  });

  it("classifies after a hung Redis read times out", async () => {
    const hung = await hungRedis();
    onTestFinished(() => hung.close());
    const cache = new SitemapResultCache(redisResultStore(hung.client));
    const { calls, classify } = counting();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });

    const pending: Promise<SitemapLookup> = cache.get(
      input(),
      live(),
      classify,
    );
    await vi.advanceTimersByTimeAsync(5_000);

    expect((await pending).complete).toBe(true);
    expect(calls).toHaveLength(1);
  });
});
