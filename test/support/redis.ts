import { randomUUID } from "node:crypto";
import { createClient } from "redis";
import { inject } from "vitest";
import type { RedisClient } from "../../src/redis/redis-client.js";

/**
 * A client of the shared test server. Specs isolate themselves by using
 * unique ids in their keys rather than by flushing the database.
 */
export async function connectTestRedis(): Promise<RedisClient> {
  const client = createClient({
    url: inject("redisUrl"),
    disableOfflineQueue: true,
  });
  await client.connect();
  return client;
}

/** A client whose every command fails, as a Redis outage looks to callers. */
export function closedRedis(): RedisClient {
  return createClient({ url: inject("redisUrl"), disableOfflineQueue: true });
}

export function uniqueId(prefix: string): string {
  return `${prefix}-${randomUUID()}`;
}
