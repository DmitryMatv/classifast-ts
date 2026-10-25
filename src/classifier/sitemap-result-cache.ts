import { Logger } from "@nestjs/common";
import { z } from "zod";
import type { RedisConnection } from "../redis/redis-client.js";
import type { ClassificationResult, RerankStatus } from "./classification.js";
import type { ClassificationOutcome } from "./classification-service.js";

const KEY_PREFIX = "ssr-result:v1";
const TTL_SECONDS = 30 * 24 * 60 * 60;
const TTL_JITTER = 0.2;

/** A degraded ranking would stay on the page for a month. */
const STORED_RERANK_STATUSES: ReadonlySet<RerankStatus> = new Set([
  "applied",
  "not_needed",
]);

const logger = new Logger("SitemapResultCache");

/** One classification input. `query` is the whitespace-collapsed query. */
export interface SitemapResultInput {
  readonly collectionName: string;
  readonly topK: number;
  readonly query: string;
}

export interface SitemapResult {
  readonly results: readonly ClassificationResult[];
  readonly versionName: string;
  readonly query: string;
  readonly elapsedSeconds: number;
  /** ISO 8601 time of the classification. */
  readonly computedAt: string;
}

const sitemapResultSchema = z.object({
  results: z.array(
    z.object({
      id: z.union([z.string(), z.number()]),
      score: z.number(),
      payload: z.record(z.string(), z.unknown()),
      rerankRelevanceScore: z.number().optional(),
    }),
  ),
  versionName: z.string(),
  query: z.string(),
  elapsedSeconds: z.number(),
  computedAt: z.iso.datetime(),
}) satisfies z.ZodType<SitemapResult>;

export interface ResultStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds: number): Promise<void>;
}

export function redisResultStore(redis: RedisConnection): ResultStore {
  return {
    get: (key) => redis.run((client) => client.get(key)),
    set: async (key, value, ttlSeconds) => {
      await redis.run((client) =>
        client.set(key, value, {
          expiration: { type: "EX", value: ttlSeconds },
        }),
      );
    },
  };
}

export function sitemapResultKey({
  collectionName,
  topK,
  query,
}: SitemapResultInput): string {
  return `${KEY_PREFIX}:${collectionName}:${topK}:${query}`;
}

/** 30 days, give or take 20%, so a day's fills do not expire together. */
export function sitemapResultTtlSeconds(random: () => number): number {
  return Math.round(TTL_SECONDS * (1 - TTL_JITTER + 2 * TTL_JITTER * random()));
}

function parseStored(raw: string): SitemapResult | undefined {
  try {
    const parsed = sitemapResultSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

function untilAborted<T>(pending: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason as Error);
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason as Error);
    signal.addEventListener("abort", onAbort, { once: true });
    pending
      .then(resolve, reject)
      .finally(() => signal.removeEventListener("abort", onAbort));
  });
}

export type Classify = (signal: AbortSignal) => Promise<ClassificationOutcome>;

export interface SitemapResultCacheOptions {
  readonly now?: () => Date;
  readonly random?: () => number;
}

/**
 * Classification results for sitemap query pages, kept in Redis for about
 * 30 days. A miss runs one shared classification per key. That fill runs
 * until it finishes or the app shuts down, so a visitor who leaves does not
 * cancel it for the others waiting on the same key. A Redis failure counts
 * as a miss, and a failed write still returns the result.
 */
export class SitemapResultCache {
  readonly #fills = new Map<string, Promise<SitemapResult>>();
  readonly #shutdown = new AbortController();
  readonly #now: () => Date;
  readonly #random: () => number;

  constructor(
    private readonly store: ResultStore | null,
    {
      now = () => new Date(),
      random = Math.random,
    }: SitemapResultCacheOptions = {},
  ) {
    this.#now = now;
    this.#random = random;
  }

  /**
   * The stored result for `input`, or the result of `classify`. A rejection
   * from `classify`, such as a full queue, reaches every waiter. Aborting
   * `signal` rejects only this caller.
   */
  async get(
    input: SitemapResultInput,
    signal: AbortSignal,
    classify: Classify,
  ): Promise<SitemapResult> {
    const key = sitemapResultKey(input);
    const filling = this.#fills.get(key);
    if (filling) return untilAborted(filling, signal);
    const stored = await untilAborted(this.#read(key), signal);
    if (stored) return stored;
    return untilAborted(this.#fill(key, classify), signal);
  }

  /** Aborts the running fills. */
  close(): void {
    this.#shutdown.abort(new Error("The application is shutting down"));
  }

  async #read(key: string): Promise<SitemapResult | undefined> {
    if (!this.store) return undefined;
    let raw: string | null;
    try {
      raw = await this.store.get(key);
    } catch (error) {
      logger.warn(`Sitemap result read failed: ${String(error)}`);
      return undefined;
    }
    if (raw === null) return undefined;
    const stored = parseStored(raw);
    if (!stored) logger.warn(`Ignoring a malformed sitemap result at ${key}`);
    return stored;
  }

  #fill(key: string, classify: Classify): Promise<SitemapResult> {
    let fill = this.#fills.get(key);
    if (fill) return fill;
    fill = this.#classifyAndStore(key, classify).finally(() => {
      this.#fills.delete(key);
    });
    // Every waiter may leave before the fill settles.
    fill.catch(() => undefined);
    this.#fills.set(key, fill);
    return fill;
  }

  async #classifyAndStore(
    key: string,
    classify: Classify,
  ): Promise<SitemapResult> {
    const outcome = await classify(this.#shutdown.signal);
    const result: SitemapResult = {
      results: outcome.results,
      versionName: outcome.versionName,
      query: outcome.query,
      elapsedSeconds: outcome.elapsedSeconds,
      computedAt: this.#now().toISOString(),
    };
    if (!this.store || !STORED_RERANK_STATUSES.has(outcome.rerank)) {
      return result;
    }
    try {
      await this.store.set(
        key,
        JSON.stringify(result),
        sitemapResultTtlSeconds(this.#random),
      );
    } catch (error) {
      logger.warn(`Sitemap result write failed: ${String(error)}`);
    }
    return result;
  }
}
