import { createServer } from "node:net";
import { inject, vi } from "vitest";
import {
  connectTestRedis,
  hangingRedisServer,
  hungRedis,
} from "../../test/support/redis.js";
import { connectRedis, withReplyTimeout } from "./redis-client.js";

afterEach(() => {
  vi.useRealTimers();
});

async function closedPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  if (address === null || typeof address === "string") throw new Error();
  return address.port;
}

describe("connectRedis", () => {
  it("returns a connected client when Redis answers", async () => {
    const { hostname, port } = new URL(inject("redisUrl"));

    const client = await connectRedis({
      host: hostname,
      port: Number(port),
      auth: undefined,
    });

    expect(await client?.ping()).toBe("PONG");
    await client?.close();
  });

  it("returns null at once when the first connection fails", async () => {
    const started = Date.now();

    const client = await connectRedis({
      host: "127.0.0.1",
      port: await closedPort(),
      auth: undefined,
    });

    expect(client).toBeNull();
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it("returns null when Redis accepts the connection but never answers", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const server = await hangingRedisServer();
    server.hang();

    const client = connectRedis({
      host: "127.0.0.1",
      port: server.port,
      auth: undefined,
    });
    await vi.advanceTimersByTimeAsync(5_000);

    expect(await client).toBeNull();
    await server.close();
  });
});

describe("withReplyTimeout", () => {
  it("fails a call that Redis leaves unanswered for five seconds", async () => {
    const { client, close } = await hungRedis();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    let settled = false;

    const reply = withReplyTimeout(client.incr("counter"));
    void reply
      .catch(() => undefined)
      .finally(() => {
        settled = true;
      });
    const rejection = expect(reply).rejects.toThrow(
      "Redis did not reply within 5000 ms",
    );
    await vi.advanceTimersByTimeAsync(4_999);
    const settledEarly = settled;
    await vi.advanceTimersByTimeAsync(1);

    expect(settledEarly).toBe(false);
    await rejection;
    await close();
  });

  it("passes a prompt reply through", async () => {
    const client = await connectTestRedis();

    expect(await withReplyTimeout(client.ping())).toBe("PONG");
    await client.close();
  });
});
