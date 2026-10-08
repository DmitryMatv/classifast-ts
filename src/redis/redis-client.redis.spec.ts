import { createServer } from "node:net";
import { inject } from "vitest";
import { connectRedis } from "./redis-client.js";

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
});
