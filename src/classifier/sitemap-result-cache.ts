import { Logger } from "@nestjs/common";
import { z } from "zod";
import type { RedisConnection } from "../redis/redis-client.js";
import type { ClassificationResult, RerankStatus } from "./classification.js";
import type { ClassificationOutcome } from "./classification-service.js";

const KEY_PREFIX = "ssr-result:v1";
const TTL_SECONDS = 30 * 24 * 60 * 60;
const TTL_JITTER = 0.2;
const MEMORY_SECONDS = 10 * 60;

/** A degraded result would stay on the page for a month. */
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

/**
 * `complete` is false for a result too degraded to store: its rerank failed
 * or was skipped, an ID search failed, or it found nothing.
 */
export interface SitemapLookup {
  readonly result: SitemapResult;
  readonly complete: boolean;
}

export const SITEMAP_RESULT_STORE = Symbol("SITEMAP_RESULT_STORE");

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
  /** Results remembered in memory at most; the sitemap lists about 420. */
  readonly memoryLimit?: number;
}

/** Whether Redis may keep a classification for a month. */
function isCompleteClassification(outcome: ClassificationOutcome) {
  return (
    STORED_RERANK_STATUSES.has(outcome.rerank) &&
    outcome.idSearch === "ok" &&
    outcome.results.length > 0
  );
}

interface Remembered {
  readonly lookup: SitemapLookup;
  readonly expiresAt: number;
}

// A fill is never cancelled: the queue's shutdown drain lets the active one
// finish and store, and rejects the waiting ones.
const NEVER_ABORTED = new AbortController().signal;

/**
 * Classification results for sitemap query pages, kept in Redis for about
 * 30 days. A miss runs one shared classification per key, which no
 * visitor's disconnect cancels. Waiters get the result as soon as it is
 * classified; the key stays claimed until the Redis write settles.
 *
 * A result Redis does not keep, because it is incomplete or the write
 * failed, is remembered in this process for 10 minutes. Without that, every
 * view during an OpenRouter or Redis outage would run a classification and
 * fill the queue that paying fragment users share.
 */
export class SitemapResultCache {
  readonly #fills = new Map<string, Promise<SitemapLookup>>();
  readonly #remembered = new Map<string, Remembered>();
  readonly #now: () => Date;
  readonly #random: () => number;
  readonly #memoryLimit: number;

  constructor(
    private readonly store: ResultStore | null,
    {
      now = () => new Date(),
      random = Math.random,
      memoryLimit = 2_000,
    }: SitemapResultCacheOptions = {},
  ) {
    this.#now = now;
    this.#random = random;
    this.#memoryLimit = memoryLimit;
  }

  /**
   * The stored or remembered result for `input`, or the result of
   * `classify`. A rejection from `classify`, such as a full queue, reaches
   * every waiter and is not remembered. Aborting `signal` rejects only this
   * caller.
   */
  async get(
    input: SitemapResultInput,
    signal: AbortSignal,
    classify: Classify,
  ): Promise<SitemapLookup> {
    const key = sitemapResultKey(input);
    const known = this.#fills.get(key) ?? this.#recall(key);
    if (known) return untilAborted(Promise.resolve(known), signal);
    const stored = await untilAborted(this.#read(key), signal);
    if (stored) return { result: stored, complete: true };
    return untilAborted(this.#fill(key, classify), signal);
  }

  #recall(key: string): SitemapLookup | undefined {
    const entry = this.#remembered.get(key);
    if (entry === undefined) return undefined;
    if (entry.expiresAt > this.#now().getTime()) return entry.lookup;
    this.#remembered.delete(key);
    return undefined;
  }

  #remember(key: string, lookup: SitemapLookup): void {
    this.#remembered.delete(key);
    if (this.#remembered.size >= this.#memoryLimit) {
      const oldest = this.#remembered.keys().next().value;
      if (oldest !== undefined) this.#remembered.delete(oldest);
    }
    this.#remembered.set(key, {
      lookup,
      expiresAt: this.#now().getTime() + MEMORY_SECONDS * 1000,
    });
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

  #fill(key: string, classify: Classify): Promise<SitemapLookup> {
    const running = this.#fills.get(key);
    if (running) return running;
    const lookup = this.#classify(classify);
    this.#fills.set(key, lookup);
    // Every waiter may leave before the fill settles.
    lookup.catch(() => undefined);
    void lookup
      .then((found) => this.#keep(key, found))
      .catch(() => undefined)
      .finally(() => this.#fills.delete(key));
    return lookup;
  }

  async #classify(classify: Classify): Promise<SitemapLookup> {
    const outcome = await classify(NEVER_ABORTED);
    return {
      result: {
        results: outcome.results,
        versionName: outcome.versionName,
        query: outcome.query,
        elapsedSeconds: outcome.elapsedSeconds,
        computedAt: this.#now().toISOString(),
      },
      complete: isCompleteClassification(outcome),
    };
  }

  async #keep(key: string, lookup: SitemapLookup): Promise<void> {
    if (lookup.complete && this.store) {
      try {
        await this.store.set(
          key,
          JSON.stringify(lookup.result),
          sitemapResultTtlSeconds(this.#random),
        );
        return;
      } catch (error) {
        logger.warn(`Sitemap result write failed: ${String(error)}`);
      }
    }
    this.#remember(key, lookup);
  }
}
