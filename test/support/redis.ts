import { randomUUID } from "node:crypto";
import { connect, createServer, type Server, type Socket } from "node:net";
import { createClient } from "redis";
import { inject } from "vitest";
import {
  connectRedis,
  RedisConnection,
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

export function testConnection(): RedisConnection {
  const { hostname, port } = new URL(inject("redisUrl"));
  return new RedisConnection({
    host: hostname,
    port: Number(port),
    auth: undefined,
  });
}

export function closedRedis(): RedisConnection {
  const connection = testConnection();
  void connection.close();
  return connection;
}

export function uniqueId(prefix: string): string {
  return `${prefix}-${randomUUID()}`;
}

async function listenOnLoopback(server: Server, sockets: Set<Socket>) {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("expected a TCP address");
  }
  return {
    port: address.port,
    close: () => {
      for (const socket of sockets) socket.destroy();
      return new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
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
  return {
    ...(await listenOnLoopback(server, sockets)),
    hang: () => {
      answering = false;
    },
  };
}

/**
 * Forwards connections to the test Redis. Freezing drops Redis's replies on
 * the connections open at that moment; `freeze` also drops them on later
 * connections until `heal`, so those accept TCP but never answer.
 */
export async function freezableRedisProxy() {
  const { hostname, port } = new URL(inject("redisUrl"));
  const sockets = new Set<Socket>();
  const open = new Set<Socket>();
  const frozen = new WeakSet<Socket>();
  let freezingNew = false;
  let accepted = 0;
  const server = createServer((downstream) => {
    accepted += 1;
    const upstream = connect(Number(port), hostname);
    sockets.add(downstream).add(upstream);
    open.add(downstream);
    if (freezingNew) frozen.add(downstream);
    downstream.pipe(upstream);
    upstream.on("data", (chunk) => {
      if (!frozen.has(downstream)) downstream.write(chunk);
    });
    for (const socket of [downstream, upstream]) {
      socket.on("error", () => undefined);
      socket.on("close", () => {
        open.delete(downstream);
        downstream.destroy();
        upstream.destroy();
      });
    }
  });
  return {
    ...(await listenOnLoopback(server, sockets)),
    freezeOpenConnections: () => {
      for (const socket of open) frozen.add(socket);
    },
    freeze: () => {
      for (const socket of open) frozen.add(socket);
      freezingNew = true;
    },
    heal: () => {
      freezingNew = false;
    },
    openConnections: () => open.size,
    acceptedConnections: () => accepted,
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
      void client.close();
      await server.close();
    },
  };
}

function monitorArgs(line: string): string[] {
  return Array.from(line.matchAll(/"((?:[^"\\]|\\.)*)"/g), ([, arg = ""]) =>
    arg.replaceAll(/\\(.)/g, "$1"),
  );
}

export async function commandsSentBy(
  connection: RedisConnection,
  run: () => Promise<unknown>,
): Promise<string[][]> {
  const { addr } = await connection.run((client) => client.clientInfo());
  const marker = uniqueId("end-of-commands");
  const monitor = await connectTestRedis();
  const lines: string[] = [];
  let sawMarker!: () => void;
  const markerSeen = new Promise<void>((resolve) => (sawMarker = resolve));
  await monitor.monitor((line) => {
    if (!line.includes(` ${addr}]`)) return;
    if (line.includes(marker)) sawMarker();
    else lines.push(line);
  });
  try {
    await run();
    await connection.run((client) => client.echo(marker));
    await markerSeen;
  } finally {
    monitor.destroy();
  }
  return lines.map(monitorArgs);
}
