import { onTestFinished, vi } from "vitest";
import { hungRedis } from "../../test/support/redis.js";
import { RedisModule } from "./redis.module.js";

afterEach(() => {
  vi.useRealTimers();
});

describe("RedisModule", () => {
  it("closes Redis within five seconds while a command hangs", async () => {
    const { client, close } = await hungRedis();
    onTestFinished(close);
    const hanging = client
      .run((redis) => redis.incr("counter"))
      .catch((error: unknown) => error);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    let closed = false;

    void new RedisModule(client).onApplicationShutdown().then(() => {
      closed = true;
    });
    await vi.advanceTimersByTimeAsync(5_000);

    expect(closed).toBe(true);
    expect(await hanging).toBeInstanceOf(Error);
  });
});
