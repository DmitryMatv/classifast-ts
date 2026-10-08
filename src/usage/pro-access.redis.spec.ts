import { Logger } from "@nestjs/common";
import { vi } from "vitest";
import {
  clerkConfig,
  FakeClerkHttp,
  type Route,
} from "../../test/support/clerk.js";
import {
  closedRedis,
  connectTestRedis,
  uniqueId,
} from "../../test/support/redis.js";
import { Clerk, type TierResolution } from "../auth/clerk.js";
import type { RedisClient } from "../redis/redis-client.js";
import {
  NEGATIVE_TIER_CACHE_TTL_SECONDS,
  ProAccess,
  TIER_CACHE_SENTINELS,
  TIER_CACHE_TTL_SECONDS,
} from "./pro-access.js";

const GRACE_TTL_SECONDS = 300;

let redis: RedisClient;

beforeAll(async () => {
  redis = await connectTestRedis();
});

afterAll(async () => {
  await redis.close();
});

function tierResponse(tier: string | undefined): Response {
  return Response.json({ public_metadata: tier === undefined ? {} : { tier } });
}

/** ProAccess over the test Redis, with Clerk answering `route` for `userId`. */
function proAccess(
  userId: string,
  route: Route,
  client: RedisClient | null = redis,
) {
  const http = new FakeClerkHttp();
  http.user(userId, route);
  const clerk = new Clerk(clerkConfig(), http.fetch);
  return { access: new ProAccess(client, clerk, GRACE_TTL_SECONDS), http };
}

function clerkRoute(resolution: TierResolution): Route {
  switch (resolution.status) {
    case "confirmed_pro":
      return () => tierResponse("pro");
    case "confirmed_non_pro":
      return () => tierResponse(resolution.tier);
    case "explicit_negative":
      return () => new Response(null, { status: 404 });
    case "transient_unavailable":
      return () => new Response(null, { status: 503 });
  }
}

/** A Clerk route that answers only once `release` is called. */
function heldRoute(answer: Route) {
  let release!: () => void;
  const released = new Promise<void>((resolve) => (release = resolve));
  let started!: () => void;
  const requested = new Promise<void>((resolve) => (started = resolve));
  const route: Route = async () => {
    started();
    await released;
    return answer();
  };
  return { route, requested, release };
}

describe("ProAccess.lookUpTier racing a webhook", () => {
  async function lookUpDuringWebhook(
    stale: TierResolution,
    authoritativeTier: string,
  ) {
    const userId = uniqueId("user");
    const held = heldRoute(clerkRoute(stale));
    const { access } = proAccess(userId, held.route);

    const lookup = access.lookUpTier(userId);
    await held.requested;
    await access.recordTier(userId, authoritativeTier);
    held.release();

    return { userId, access, resolution: await lookup };
  }

  it.each<TierResolution>([
    { status: "confirmed_non_pro", tier: "free" },
    { status: "confirmed_non_pro" },
    { status: "explicit_negative" },
    { status: "transient_unavailable" },
  ])(
    "test_cache_miss_lookup_preserves_authoritative_pro_update (%j)",
    async (stale) => {
      const { userId, access, resolution } = await lookUpDuringWebhook(
        stale,
        "pro",
      );

      expect(resolution).toEqual({ status: "confirmed_pro" });
      expect(await redis.get(`user_tier:${userId}`)).toBe("pro");
      expect(await redis.ttl(`user_tier:${userId}`)).toBe(
        TIER_CACHE_TTL_SECONDS,
      );
      expect(await access.isPro(userId, "free")).toBe(true);
    },
  );

  it("test_cache_miss_lookup_preserves_authoritative_free_update", async () => {
    const { userId, access, resolution } = await lookUpDuringWebhook(
      { status: "confirmed_pro" },
      "free",
    );

    expect(resolution).toEqual({ status: "confirmed_non_pro", tier: "free" });
    expect(await redis.get(`user_tier:${userId}`)).toBe("free");
    expect(await redis.ttl(`user_tier:${userId}`)).toBe(TIER_CACHE_TTL_SECONDS);
    expect(await access.isPro(userId, "pro")).toBe(false);
  });
});

describe("ProAccess.lookUpTier", () => {
  it("test_get_cached_user_tier_uses_negative_cache_sentinel", async () => {
    const userId = uniqueId("user");
    await redis.set(
      `user_tier:${userId}`,
      TIER_CACHE_SENTINELS.explicit_negative,
    );
    const { access, http } = proAccess(userId, () => tierResponse("pro"));

    expect(await access.lookUpTier(userId)).toEqual({
      status: "explicit_negative",
    });
    expect(http.fetch).not.toHaveBeenCalled();
  });

  it.each<[string, TierResolution]>([
    ["pro", { status: "confirmed_pro" }],
    ["free", { status: "confirmed_non_pro", tier: "free" }],
    [TIER_CACHE_SENTINELS.non_pro, { status: "confirmed_non_pro" }],
    [TIER_CACHE_SENTINELS.explicit_negative, { status: "explicit_negative" }],
    [
      TIER_CACHE_SENTINELS.transient_unavailable,
      { status: "transient_unavailable" },
    ],
  ])(
    "reads the cached value %s without asking Clerk",
    async (value, expected) => {
      const userId = uniqueId("user");
      await redis.set(`user_tier:${userId}`, value);
      const { access, http } = proAccess(userId, () => tierResponse("pro"));

      expect(await access.lookUpTier(userId)).toEqual(expected);
      expect(http.fetch).not.toHaveBeenCalled();
    },
  );

  it.each<[string, TierResolution, string, number]>([
    [
      "test_get_cached_user_tier_fetches_and_caches_on_miss",
      { status: "confirmed_pro" },
      "pro",
      TIER_CACHE_TTL_SECONDS,
    ],
    [
      "caches a named non-Pro tier",
      { status: "confirmed_non_pro", tier: "starter" },
      "starter",
      TIER_CACHE_TTL_SECONDS,
    ],
    [
      "caches a missing tier as the non-Pro sentinel",
      { status: "confirmed_non_pro" },
      TIER_CACHE_SENTINELS.non_pro,
      TIER_CACHE_TTL_SECONDS,
    ],
    [
      "test_get_cached_user_tier_negative_result_is_cached",
      { status: "explicit_negative" },
      TIER_CACHE_SENTINELS.explicit_negative,
      NEGATIVE_TIER_CACHE_TTL_SECONDS,
    ],
    [
      "test_get_cached_user_tier_transient_result_is_cached",
      { status: "transient_unavailable" },
      TIER_CACHE_SENTINELS.transient_unavailable,
      NEGATIVE_TIER_CACHE_TTL_SECONDS,
    ],
  ])("%s", async (_name, resolution, cachedValue, ttl) => {
    const userId = uniqueId("user");
    const { access } = proAccess(userId, clerkRoute(resolution));

    expect(await access.lookUpTier(userId)).toEqual(resolution);
    expect(await redis.get(`user_tier:${userId}`)).toBe(cachedValue);
    expect(await redis.ttl(`user_tier:${userId}`)).toBe(ttl);
  });

  it("test_get_cached_user_tier_returns_clerk_resolution_when_fill_fails", async () => {
    const userId = uniqueId("user");
    const client = await connectTestRedis();
    const held = heldRoute(() => tierResponse("pro"));
    const { access } = proAccess(userId, held.route, client);

    const lookup = access.lookUpTier(userId);
    await held.requested;
    client.destroy();
    held.release();

    expect(await lookup).toEqual({ status: "confirmed_pro" });
  });

  it("test_get_cached_user_tier_returns_clerk_resolution_when_winner_read_fails", async () => {
    const userId = uniqueId("user");
    const held = heldRoute(() => tierResponse("pro"));
    const { access } = proAccess(userId, held.route);

    const lookup = access.lookUpTier(userId);
    await held.requested;
    await redis.set(`user_tier:${userId}`, Buffer.from([0xff]));
    held.release();

    expect(await lookup).toEqual({ status: "confirmed_pro" });
  });

  it("asks Clerk when the cached value is not UTF-8", async () => {
    const userId = uniqueId("user");
    await redis.set(`user_tier:${userId}`, Buffer.from([0xff]));
    const { access, http } = proAccess(userId, () => tierResponse("pro"));

    expect(await access.lookUpTier(userId)).toEqual({
      status: "confirmed_pro",
    });
    expect(http.fetch).toHaveBeenCalledOnce();
  });

  it("asks Clerk when Redis cannot be read", async () => {
    const userId = uniqueId("user");
    const { access } = proAccess(
      userId,
      () => tierResponse("pro"),
      closedRedis(),
    );

    expect(await access.lookUpTier(userId)).toEqual({
      status: "confirmed_pro",
    });
  });
});

describe("ProAccess.recordTier", () => {
  it.each([
    ["test_set_cached_user_tier_stores_pro_tier", "pro", "pro"],
    ["test_set_cached_user_tier_stores_non_pro_as_free", "starter", "free"],
  ])("%s", async (_name, tier, stored) => {
    const userId = uniqueId("user");
    await redis.set(`user_tier:${userId}`, "stale", { EX: 5 });
    const { access } = proAccess(userId, () => tierResponse(undefined));

    await access.recordTier(userId, tier);

    expect(await redis.get(`user_tier:${userId}`)).toBe(stored);
    expect(await redis.ttl(`user_tier:${userId}`)).toBe(TIER_CACHE_TTL_SECONDS);
  });

  it("test_set_cached_user_tier_is_best_effort_on_redis_error", async () => {
    const warn = vi.spyOn(Logger.prototype, "warn");
    const userId = uniqueId("user");
    const { access } = proAccess(
      userId,
      () => tierResponse(undefined),
      closedRedis(),
    );

    await access.recordTier(userId, "pro");

    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("Failed to sync tier cache"),
    );
    warn.mockRestore();
  });
});

describe("ProAccess checkout grace", () => {
  it("grants grace for the configured TTL", async () => {
    const userId = uniqueId("user");
    const { access } = proAccess(userId, () => tierResponse(undefined));

    expect(await access.hasActiveGrace(userId)).toBe(false);
    expect(await access.grantCheckoutGrace(userId)).toBe(true);

    expect(await access.hasActiveGrace(userId)).toBe(true);
    expect(await redis.get(`checkout_grace:${userId}`)).toBe("1");
    expect(await redis.ttl(`checkout_grace:${userId}`)).toBe(GRACE_TTL_SECONDS);
  });

  it("reports failure instead of throwing when Redis is down", async () => {
    const userId = uniqueId("user");
    const { access } = proAccess(
      userId,
      () => tierResponse(undefined),
      closedRedis(),
    );

    expect(await access.grantCheckoutGrace(userId)).toBe(false);
    expect(await access.hasActiveGrace(userId)).toBe(false);
  });
});

describe("ProAccess.isPro", () => {
  it("test_checkout_grace_allows_verified_user", async () => {
    const userId = uniqueId("user");
    const { access, http } = proAccess(userId, () => tierResponse("free"));
    await access.grantCheckoutGrace(userId);

    expect(await access.isPro(userId, "free")).toBe(true);
    expect(http.fetch).not.toHaveBeenCalled();
  });

  it.each<[string, TierResolution, string | undefined, boolean]>([
    [
      "test_valid_active_session_with_pro_tier_is_unlimited",
      { status: "confirmed_pro" },
      "pro",
      true,
    ],
    [
      "test_jwt_pro_hint_stays_unlimited_when_clerk_tier_is_unknown",
      { status: "transient_unavailable" },
      "pro",
      true,
    ],
    [
      "test_stale_jwt_pro_hint_is_not_treated_as_unlimited",
      { status: "confirmed_non_pro", tier: "free" },
      "pro",
      false,
    ],
    [
      "test_jwt_pro_hint_is_not_unlimited_when_clerk_tier_is_explicit_negative",
      { status: "explicit_negative" },
      "pro",
      false,
    ],
    [
      "test_missing_jwt_pro_hint_and_unknown_clerk_tier_uses_free_quota",
      { status: "transient_unavailable" },
      undefined,
      false,
    ],
  ])("%s", async (_name, resolution, hint, expected) => {
    const userId = uniqueId("user");
    const { access } = proAccess(userId, clerkRoute(resolution));

    expect(await access.isPro(userId, hint)).toBe(expected);
  });

  it("test_redis_unavailable_short_circuits_before_tier_or_grace_checks", async () => {
    const userId = uniqueId("user");
    const { access, http } = proAccess(userId, () => tierResponse("pro"), null);

    expect(await access.isPro(userId, "pro")).toBe(false);
    expect(http.fetch).not.toHaveBeenCalled();
  });
});
