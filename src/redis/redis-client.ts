import { Logger } from "@nestjs/common";
import { createClient, type RedisClientType } from "redis";
import type { AppConfig } from "../config/app-config.js";

export type RedisClient = RedisClientType;

export const REDIS_CLIENT = Symbol("REDIS_CLIENT");

const TIMEOUT_MS = 5_000;
const MAX_RECONNECT_DELAY_MS = 2_000;

const logger = new Logger("Redis");

/**
 * Fails a Redis call whose reply takes longer than redis-py's
 * socket_timeout. node-redis stops timing a command once it is written, so a
 * Redis that accepts commands and never answers would hang the caller.
 */
export async function withReplyTimeout<T>(reply: Promise<T>): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timedOut = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`Redis did not reply within ${TIMEOUT_MS} ms`)),
      TIMEOUT_MS,
    );
  });
  try {
    return await Promise.race([reply, timedOut]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Connects like app/main.py: if the first connection fails, the process runs
 * without Redis and every metered request fails closed until a restart.
 * Commands fail at once while a later reconnect is pending, instead of
 * queueing behind it.
 */
export async function connectRedis(
  config: AppConfig["redis"],
): Promise<RedisClient | null> {
  let connected = false;
  const client = createClient({
    socket: {
      host: config.host,
      port: config.port,
      connectTimeout: TIMEOUT_MS,
      reconnectStrategy: (retries, cause) =>
        connected ? Math.min(retries * 50, MAX_RECONNECT_DELAY_MS) : cause,
    },
    username: config.auth?.username,
    password: config.auth?.password,
    disableOfflineQueue: true,
  });
  client.on("error", (error: unknown) => {
    if (connected) logger.warn(`Redis connection error: ${String(error)}`);
  });

  logger.log(`Connecting to Redis at ${config.host}:${config.port}...`);
  try {
    await withReplyTimeout(client.connect());
    await withReplyTimeout(client.ping());
  } catch (error) {
    logger.warn(
      `Redis not available, usage tracking disabled: ${String(error)}`,
    );
    client.destroy();
    return null;
  }
  connected = true;
  logger.log("Redis client initialized successfully.");
  return client;
}
