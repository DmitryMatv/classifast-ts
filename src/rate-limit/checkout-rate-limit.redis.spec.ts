import { setTimeout as sleep } from "node:timers/promises";
import { vi } from "vitest";
import {
  closedRedis,
  commandsSentBy,
  connectTestRedis,
  hungRedis,
  uniqueId,
} from "../../test/support/redis.js";
import type { RedisClient } from "../redis/redis-client.js";
import { hashIp } from "../usage/client-identity.js";
import {
  CheckoutRateLimit,
  CheckoutRateLimitedError,
  CheckoutRateLimitUnavailableError,
} from "./checkout-rate-limit.js";

const WINDOW_SECONDS = 60;

let redis: RedisClient;

beforeAll(async () => {
  redis = await connectTestRedis();
});

afterAll(async () => {
  await redis.close();
});

afterEach(() => {
  vi.useRealTimers();
});

function limiter(limit = 10, client: RedisClient | null = redis) {
  return new CheckoutRateLimit(client, {
    checkoutRateLimit: limit,
    checkoutRateLimitWindowSeconds: WINDOW_SECONDS,
  });
}

function counter() {
  const ip = uniqueId("ip");
  return { ip, key: `checkout_rl:${hashIp(ip)}` };
}

async function rejection(promise: Promise<void>): Promise<unknown> {
  return promise.then(
    () => undefined,
    (error: unknown) => error,
  );
}

describe("CheckoutRateLimit", () => {
  it("test_new_counter_expires_after_one_window", async () => {
    const { ip, key } = counter();

    await limiter().enforce(ip);

    expect(await redis.get(key)).toBe("1");
    expect(await redis.ttl(key)).toBe(WINDOW_SECONDS);
  });

  it("test_existing_counter_without_ttl_is_repaired", async () => {
    const { ip, key } = counter();
    await redis.set(key, "1");

    await limiter().enforce(ip);

    expect(await redis.get(key)).toBe("2");
    expect(await redis.ttl(key)).toBe(WINDOW_SECONDS);
  });

  it("test_over_limit_counter_without_ttl_is_repaired_before_denial", async () => {
    const { ip, key } = counter();
    await redis.set(key, "10");

    const error = await rejection(limiter().enforce(ip));

    expect(error).toBeInstanceOf(CheckoutRateLimitedError);
    expect(error).toMatchObject({
      status: 429,
      message: "Too many checkout requests. Please try again later.",
    });
    expect(await redis.get(key)).toBe("11");
    expect(await redis.ttl(key)).toBe(WINDOW_SECONDS);
  });

  it("test_existing_ttl_is_preserved", async () => {
    const { ip, key } = counter();
    await redis.set(key, "1", { expiration: { type: "EX", value: 30 } });

    await limiter().enforce(ip);

    expect(await redis.get(key)).toBe("2");
    expect(await redis.ttl(key)).toBe(30);
  });

  it("test_expired_window_resets_counter_and_allows_checkout", async () => {
    const { ip, key } = counter();
    await redis.set(key, "10", { expiration: { type: "PX", value: 200 } });

    const denied = await rejection(limiter().enforce(ip));
    await sleep(300);
    await limiter().enforce(ip);

    expect(denied).toBeInstanceOf(CheckoutRateLimitedError);
    expect(await redis.get(key)).toBe("1");
    expect(await redis.ttl(key)).toBe(WINDOW_SECONDS);
  });

  it("counts and arms the window in one MULTI transaction", async () => {
    const { ip, key } = counter();

    const commands = await commandsSentBy(redis, () => limiter().enforce(ip));

    expect(commands).toEqual([
      ["MULTI"],
      ["INCR", key],
      ["EXPIRE", key, String(WINDOW_SECONDS), "NX"],
      ["EXEC"],
    ]);
  });

  it("test_mapping_checkout_is_rate_limited_per_ip", async () => {
    const first = counter();
    const second = counter();
    const limit = limiter(2);

    await limit.enforce(first.ip);
    await limit.enforce(first.ip);
    const third = await rejection(limit.enforce(first.ip));
    await limit.enforce(second.ip);

    expect(third).toBeInstanceOf(CheckoutRateLimitedError);
  });

  it("admits exactly the limit from concurrent requests", async () => {
    const { ip, key } = counter();
    const limit = limiter(3);

    const outcomes = await Promise.all(
      Array.from({ length: 8 }, () => rejection(limit.enforce(ip))),
    );

    expect(outcomes.filter((outcome) => outcome === undefined)).toHaveLength(3);
    expect(await redis.get(key)).toBe("8");
  });

  it("test_checkout_rate_limit_fails_closed_without_redis", async () => {
    const error = await rejection(limiter(10, null).enforce(uniqueId("ip")));

    expect(error).toBeInstanceOf(CheckoutRateLimitUnavailableError);
    expect(error).toMatchObject({
      status: 503,
      message: "Service temporarily unavailable",
    });
  });

  it("test_checkout_rate_limit_fails_closed_on_redis_error", async () => {
    const error = await rejection(
      limiter(10, closedRedis()).enforce(uniqueId("ip")),
    );

    expect(error).toBeInstanceOf(CheckoutRateLimitUnavailableError);
  });

  it("fails closed when Redis stops answering", async () => {
    const { client, close } = await hungRedis();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });

    const error = rejection(limiter(10, client).enforce(uniqueId("ip")));
    await vi.advanceTimersByTimeAsync(5_000);

    expect(await error).toBeInstanceOf(CheckoutRateLimitUnavailableError);
    await close();
  });
});
