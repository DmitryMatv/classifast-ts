import { Logger } from "@nestjs/common";
import { createClient, type RedisClientType } from "redis";
import type { AppConfig } from "../config/app-config.js";

export type RedisClient = RedisClientType;

export const REDIS_CONNECTION = Symbol("REDIS_CONNECTION");

const TIMEOUT_MS = 5_000;

const logger = new Logger("Redis");

class NoReplyError extends Error {
  constructor() {
    super(`Redis did not reply within ${TIMEOUT_MS} ms`);
  }
}

export class RedisClosedError extends Error {
  constructor() {
    super("Redis connection is closed");
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
 * Owns the Redis connection, like redis-py's pool: a connection that stops
 * replying or breaks is dropped, and the next call gets a fresh one. Each
 * connect attempt uses a new node-redis client and never reconnects in
 * place, so at most one socket is live.
 */
export class RedisConnection {
  #ready: RedisClient | undefined;
  #connecting: RedisClient | undefined;
  #attempt: Promise<RedisClient> | undefined;
  #closed = false;

  constructor(private readonly config: AppConfig["redis"]) {}

  /**
   * Runs one command on the current client. A reply slower than redis-py's
   * socket_timeout fails the call, because node-redis stops timing a command
   * once it is written.
   */
  async run<T>(command: (client: RedisClient) => Promise<T>): Promise<T> {
    const client = await this.#client();
    try {
      return await withinTimeout(command(client));
    } catch (error) {
      if (error instanceof NoReplyError || !client.isReady) this.#drop(client);
      throw error;
    }
  }

  async close(): Promise<void> {
    this.#closed = true;
    this.#connecting?.destroy();
    const ready = this.#ready;
    this.#ready = undefined;
    await Promise.all([
      this.#attempt?.catch(() => undefined),
      ready?.isOpen &&
        withinTimeout(ready.close()).catch(() => ready.destroy()),
    ]);
  }

  #client(): Promise<RedisClient> {
    if (this.#closed) return Promise.reject(new RedisClosedError());
    if (this.#ready?.isReady) return Promise.resolve(this.#ready);
    if (this.#ready) this.#drop(this.#ready);
    this.#attempt ??= this.#connect().finally(() => {
      this.#attempt = undefined;
    });
    return this.#attempt;
  }

  async #connect(): Promise<RedisClient> {
    const client: RedisClient = createClient({
      socket: {
        host: this.config.host,
        port: this.config.port,
        connectTimeout: TIMEOUT_MS,
        reconnectStrategy: false,
      },
      username: this.config.auth?.username,
      password: this.config.auth?.password,
      disableOfflineQueue: true,
    });
    client.on("error", (error: unknown) => {
      logger.warn(`Redis connection error: ${String(error)}`);
    });
    // node-redis installs a socket that finishes TCP setup after destroy();
    // close it as soon as it appears.
    client.on("connect", () => {
      if (!client.isOpen) client.destroy();
    });
    this.#connecting = client;
    try {
      await withinTimeout(client.connect().then(() => client.ping()));
      if (this.#closed) throw new RedisClosedError();
    } catch (error) {
      client.destroy();
      throw error;
    } finally {
      this.#connecting = undefined;
    }
    this.#ready = client;
    return client;
  }

  #drop(client: RedisClient): void {
    if (this.#ready === client) this.#ready = undefined;
    client.destroy();
  }
}

/**
 * Connects at startup. Like the Python app, a Redis that is unreachable at
 * startup disables usage tracking for the life of the process.
 */
export async function connectRedis(
  config: AppConfig["redis"],
): Promise<RedisConnection | null> {
  logger.log(`Connecting to Redis at ${config.host}:${config.port}...`);
  const connection = new RedisConnection(config);
  try {
    await connection.run((client) => client.ping());
  } catch (error) {
    logger.warn(
      `Redis not available, usage tracking disabled: ${String(error)}`,
    );
    await connection.close();
    return null;
  }
  logger.log("Redis client initialized successfully.");
  return connection;
}
