import { randomUUID } from "node:crypto";
import { createServer, type Socket } from "node:net";
import { createClient } from "redis";
import { inject } from "vitest";
import {
  connectRedis,
  type RedisClient,
} from "../../src/redis/redis-client.js";

export async function connectTestRedis(): Promise<RedisClient> {
  const client = createClient({
    url: inject("redisUrl"),
    disableOfflineQueue: true,
  });
  await client.connect();
  return client;
}

export function closedRedis(): RedisClient {
  return createClient({ url: inject("redisUrl"), disableOfflineQueue: true });
}

export function uniqueId(prefix: string): string {
  return `${prefix}-${randomUUID()}`;
}

export async function hangingRedisServer() {
  let answering = true;
  const sockets = new Set<Socket>();
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on("data", (chunk) => {
      if (!answering) return;
      const commands = chunk.toString("latin1").match(/^\*/gm) ?? [];
      socket.write("+OK\r\n".repeat(commands.length));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("expected a TCP address");
  }
  return {
    port: address.port,
    hang: () => {
      answering = false;
    },
    close: () => {
      for (const socket of sockets) socket.destroy();
      return new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

export async function hungRedis() {
  const server = await hangingRedisServer();
  const client = await connectRedis({
    host: "127.0.0.1",
    port: server.port,
    auth: undefined,
  });
  if (!client) throw new Error("expected the handshake to succeed");
  server.hang();
  return {
    client,
    close: async () => {
      client.destroy();
      await server.close();
    },
  };
}
