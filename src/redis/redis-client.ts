import { Logger } from "@nestjs/common";
import { createClient, type RedisClientType } from "redis";
import type { AppConfig } from "../config/app-config.js";

export type RedisClient = RedisClientType;

export const REDIS_CLIENT = Symbol("REDIS_CLIENT");

const TIMEOUT_MS = 5_000;
const MAX_RECONNECT_DELAY_MS = 2_000;

const logger = new Logger("Redis");

class NoReplyError extends Error {
  constructor() {
    super(`Redis did not reply within ${TIMEOUT_MS} ms`);
  }
}

async function withinTimeout<T>(pending: Promise<T>): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timedOut = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new NoReplyError()), TIMEOUT_MS);
  });
  try {
    return await Promise.race([pending, timedOut]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fails a Redis call whose reply takes longer than redis-py's
 * socket_timeout. node-redis stops timing a command once it is written, so a
 * connection that stops answering would hang every later call. Like redis-py,
 * drop that connection so the next call gets a fresh one.
 */
export async function withReplyTimeout<T>(
  client: RedisClient,
  reply: Promise<T>,
): Promise<T> {
  try {
    return await withinTimeout(reply);
  } catch (error) {
    if (error instanceof NoReplyError && client.isOpen) {
      client.destroy();
      client.connect().catch(() => undefined);
    }
    throw error;
  }
}

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
    await withinTimeout(client.connect());
    await withinTimeout(client.ping());
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
