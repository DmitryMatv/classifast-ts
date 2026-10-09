import { createServer } from "node:net";
import { setTimeout as sleep } from "node:timers/promises";
import { inject, onTestFinished, vi } from "vitest";
import {
  freezableRedisProxy,
  hangingRedisServer,
  hungRedis,
  testConnection,
} from "../../test/support/redis.js";
import {
  connectRedis,
  RedisClosedError,
  RedisConnection,
  type RedisClient,
} from "./redis-client.js";

afterEach(() => {
  vi.useRealTimers();
});

const NO_REPLY = "Redis did not reply within 5000 ms";

const ping = (client: RedisClient) => client.ping();

async function closedPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  if (address === null || typeof address === "string") throw new Error();
  return address.port;
}

async function proxiedConnection() {
  const proxy = await freezableRedisProxy();
  const connection = new RedisConnection({
    host: "127.0.0.1",
    port: proxy.port,
    auth: undefined,
  });
  onTestFinished(async () => {
    await connection.close();
    await proxy.close();
  });
  return { proxy, connection };
}

function outcome(reply: Promise<unknown>): Promise<unknown> {
  return reply.catch((error: unknown) => error);
}

describe("connectRedis", () => {
  it("returns a connection when Redis answers", async () => {
    const { hostname, port } = new URL(inject("redisUrl"));

    const connection = await connectRedis({
      host: hostname,
      port: Number(port),
      auth: undefined,
    });

    expect(await connection?.run(ping)).toBe("PONG");
    await connection?.close();
  });

  it("returns null at once when the first connection fails", async () => {
    const started = Date.now();

    const connection = await connectRedis({
      host: "127.0.0.1",
      port: await closedPort(),
      auth: undefined,
    });

    expect(connection).toBeNull();
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it("returns null when Redis accepts the connection but never answers", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const server = await hangingRedisServer();
    server.hang();

    const connection = connectRedis({
      host: "127.0.0.1",
      port: server.port,
      auth: undefined,
    });
    await vi.advanceTimersByTimeAsync(5_000);

    expect(await connection).toBeNull();
    await server.close();
  });
});

describe("RedisConnection", () => {
  it("fails a call that Redis leaves unanswered for five seconds", async () => {
    const { client, close } = await hungRedis();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    let settled = false;

    const reply = client.run((redis) => redis.incr("counter"));
    void reply
      .catch(() => undefined)
      .finally(() => {
        settled = true;
      });
    const rejection = expect(reply).rejects.toThrow(NO_REPLY);
    await vi.advanceTimersByTimeAsync(4_999);
    const settledEarly = settled;
    await vi.advanceTimersByTimeAsync(1);

    expect(settledEarly).toBe(false);
    await rejection;
    await close();
  });

  it("answers the next call on a fresh connection after a reply times out", async () => {
    const { proxy, connection } = await proxiedConnection();
    await connection.run(ping);
    proxy.freezeOpenConnections();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });

    const stuck = expect(connection.run(ping)).rejects.toThrow(NO_REPLY);
    await vi.advanceTimersByTimeAsync(5_000);
    await stuck;
    vi.useRealTimers();

    expect(await connection.run(ping)).toBe("PONG");
  });

  it("passes a prompt reply through", async () => {
    const connection = testConnection();

    expect(await connection.run(ping)).toBe("PONG");
    await connection.close();
  });

  it("fails a reconnect that Redis never answers, then recovers", async () => {
    const { proxy, connection } = await proxiedConnection();
    await connection.run(ping);
    proxy.freeze();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const stuck = expect(connection.run(ping)).rejects.toThrow(NO_REPLY);
    await vi.advanceTimersByTimeAsync(5_000);
    await stuck;

    const reconnect = expect(connection.run(ping)).rejects.toThrow(NO_REPLY);
    await vi.waitFor(() => expect(proxy.acceptedConnections()).toBe(2));
    await vi.advanceTimersByTimeAsync(5_000);
    await reconnect;
    proxy.heal();
    vi.useRealTimers();

    expect(await connection.run(ping)).toBe("PONG");
  });

  it("keeps one socket when timeouts overlap a pending reconnect", async () => {
    const { proxy, connection } = await proxiedConnection();
    await connection.run(ping);
    proxy.freeze();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const first = outcome(connection.run(ping));
    await vi.advanceTimersByTimeAsync(2_000);
    const transaction = outcome(
      connection.run((client) => client.multi().incr("counter").exec()),
    );
    await vi.advanceTimersByTimeAsync(3_000);
    expect(await first).toBeInstanceOf(Error);

    const joined = [
      outcome(connection.run(ping)),
      outcome(connection.run(ping)),
    ];
    await vi.waitFor(() => expect(proxy.acceptedConnections()).toBe(2));
    await vi.advanceTimersByTimeAsync(2_000);
    expect(await transaction).toBeInstanceOf(Error);
    proxy.heal();
    await vi.advanceTimersByTimeAsync(3_000);
    for (const reply of await Promise.all(joined)) {
      expect(reply).toBeInstanceOf(Error);
    }
    vi.useRealTimers();

    expect(await connection.run(ping)).toBe("PONG");
    await sleep(200);
    expect(proxy.acceptedConnections()).toBe(3);
    expect(proxy.openConnections()).toBe(1);
  });

  it.each([
    ["TCP setup", false],
    ["an unanswered handshake", true],
  ])("closes promptly and leaves no socket during %s", async (_, hang) => {
    const { proxy, connection } = await proxiedConnection();
    if (hang) proxy.freeze();
    const reply = outcome(connection.run(ping));
    if (hang) {
      await vi.waitFor(() => expect(proxy.acceptedConnections()).toBe(1));
    }
    const started = Date.now();

    await connection.close();

    expect(Date.now() - started).toBeLessThan(1_000);
    expect(await reply).toBeInstanceOf(Error);
    await sleep(200);
    expect(proxy.openConnections()).toBe(0);
    await expect(connection.run(ping)).rejects.toThrow(RedisClosedError);
  });
});
