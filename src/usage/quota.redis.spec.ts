import { randomUUID } from "node:crypto";
import {
  activeSession,
  CLERK_API,
  clerkConfig,
  clerkWithKey,
  JWKS_URL,
  signingKey,
  signToken,
  type Route,
} from "../../test/support/clerk.js";
import {
  closedRedis,
  connectTestRedis,
  uniqueId,
} from "../../test/support/redis.js";
import type { RedisClient } from "../redis/redis-client.js";
import { hashIp } from "./client-identity.js";
import { ProAccess } from "./pro-access.js";
import {
  Quota,
  quotaHeaders,
  QuotaUnavailableError,
  USAGE_TTL_SECONDS,
  type AnonymousCaller,
  type CallerCredentials,
  type FreeCaller,
} from "./quota.js";

const ANON_LIMIT = 10;
const FREE_USER_LIMIT = 30;

let redis: RedisClient;

beforeAll(async () => {
  redis = await connectTestRedis();
});

afterAll(async () => {
  await redis.close();
});

const proTier: Route = () =>
  Response.json({ public_metadata: { tier: "pro" } });
const freeTier: Route = () =>
  Response.json({ public_metadata: { tier: "free" } });
const clerkDown: Route = () => new Response(null, { status: 503 });
const noSuchUser: Route = () => new Response(null, { status: 404 });

interface Setup {
  readonly origins?: string[];
  readonly client?: RedisClient | null;
}

async function setup({ origins = [], client = redis }: Setup = {}) {
  const { clerk, http, key } = await clerkWithKey(
    clerkConfig({ permittedOrigins: origins }),
  );
  const access = new ProAccess(client, clerk, 300);
  const quota = new Quota(client, clerk, access, {
    anonLimit: ANON_LIMIT,
    freeUserLimit: FREE_USER_LIMIT,
  });
  return { quota, access, http, key };
}

function credentials(
  overrides: Partial<CallerCredentials> = {},
): CallerCredentials {
  return {
    authorization: undefined,
    sessionCookie: undefined,
    trackingCookie: randomUUID(),
    clientIp: uniqueId("ip"),
    ...overrides,
  };
}

function anonymous(): AnonymousCaller {
  return {
    kind: "anonymous",
    trackingId: randomUUID(),
    ipHash: hashIp(uniqueId("ip")),
  };
}

function free(): FreeCaller {
  return { kind: "free", userId: uniqueId("user") };
}

const userKey = (userId: string) => `user:${userId}:usage_count`;
const trackingKey = (caller: AnonymousCaller) =>
  `anon:${caller.trackingId}:usage_count`;
const ipKey = (caller: AnonymousCaller) =>
  `anon:ip:${caller.ipHash}:usage_count`;

async function quotaFailure(promise: Promise<unknown>) {
  const error = await promise.then(
    () => undefined,
    (caught: unknown) => caught,
  );
  if (!(error instanceof QuotaUnavailableError)) {
    throw new Error(`expected QuotaUnavailableError, got ${String(error)}`);
  }
  return error;
}

describe("Quota.resolveCaller", () => {
  async function bearerCaller(tierRoute: Route, tierHint?: string) {
    const { quota, http, key } = await setup();
    const userId = uniqueId("user");
    http.user(userId, tierRoute);
    const token = await signToken(key, {
      sub: userId,
      public_metadata: tierHint === undefined ? {} : { tier: tierHint },
    });
    const caller = await quota.resolveCaller(
      credentials({ authorization: `Bearer ${token}` }),
    );
    return { caller, userId };
  }

  it.each<[string, Route, string | undefined, "pro" | "free"]>([
    [
      "test_valid_active_session_with_pro_tier_is_unlimited",
      proTier,
      "pro",
      "pro",
    ],
    [
      "test_jwt_pro_hint_stays_unlimited_when_clerk_tier_is_unknown",
      clerkDown,
      "pro",
      "pro",
    ],
    [
      "test_stale_jwt_pro_hint_is_not_treated_as_unlimited",
      freeTier,
      "pro",
      "free",
    ],
    [
      "test_jwt_pro_hint_is_not_unlimited_when_clerk_tier_is_explicit_negative",
      noSuchUser,
      "pro",
      "free",
    ],
    [
      "test_missing_jwt_pro_hint_and_unknown_clerk_tier_uses_free_quota",
      clerkDown,
      undefined,
      "free",
    ],
  ])("%s", async (_name, tierRoute, hint, kind) => {
    const { caller, userId } = await bearerCaller(tierRoute, hint);

    expect(caller).toEqual({ kind, userId });
  });

  it("test_valid_active_session_with_free_tier_uses_free_quota", async () => {
    const { quota, http, key } = await setup({
      origins: ["https://classifast.com"],
    });
    const userId = uniqueId("user");
    http.user(userId, freeTier);
    await redis.set(userKey(userId), "3");
    const token = await signToken(key, {
      sub: userId,
      azp: "https://classifast.com",
    });

    const caller = await quota.resolveCaller(
      credentials({ authorization: `Bearer ${token}` }),
    );
    const status = await quota.charge(caller);

    expect(status).toEqual({
      kind: "metered",
      allowed: true,
      remaining: FREE_USER_LIMIT - 4,
      limit: FREE_USER_LIMIT,
      caller: { kind: "free", userId },
    });
  });

  it("test_quota_auth_does_not_verify_live_session_for_bearer_requests", async () => {
    const { quota, http, key } = await setup({
      origins: ["https://classifast.com"],
    });
    const userId = uniqueId("user");
    http.user(userId, freeTier);
    http.session("sess_123", () => activeSession());
    const withAzp = await signToken(key, {
      sub: userId,
      azp: "https://classifast.com",
    });
    const withoutAzp = await signToken(key, { sub: userId });

    const signedIn = await quota.resolveCaller(
      credentials({ authorization: `Bearer ${withAzp}` }),
    );
    const azpChecked = await quota.resolveCaller(
      credentials({ authorization: `Bearer ${withoutAzp}` }),
    );

    expect(signedIn).toEqual({ kind: "free", userId });
    expect(azpChecked.kind).toBe("anonymous");
    expect(http.requestedUrls()).not.toContain(
      `${CLERK_API}/sessions/sess_123`,
    );
  });

  it("test_quota_auth_skips_azp_when_permitted_origins_not_configured", async () => {
    const { quota, http, key } = await setup();
    const userId = uniqueId("user");
    http.user(userId, freeTier);

    const caller = await quota.resolveCaller(
      credentials({
        authorization: `Bearer ${await signToken(key, { sub: userId })}`,
      }),
    );

    expect(caller).toEqual({ kind: "free", userId });
  });

  it("test_quota_auth_does_not_verify_live_session_for_session_cookie", async () => {
    const { quota, http, key } = await setup({
      origins: ["https://classifast.com"],
    });
    const userId = uniqueId("user");
    http.user(userId, freeTier);
    const token = await signToken(key, {
      sub: userId,
      azp: "https://elsewhere.example",
    });

    const caller = await quota.resolveCaller(
      credentials({ sessionCookie: token }),
    );

    expect(caller).toEqual({ kind: "free", userId });
    expect(http.requestedUrls()).toEqual([
      JWKS_URL,
      `${CLERK_API}/users/${userId}`,
    ]);
  });

  it("falls back to the session cookie when the Bearer token fails", async () => {
    const { quota, http, key } = await setup();
    const userId = uniqueId("user");
    http.user(userId, freeTier);
    const impostor = await signingKey("kid-1");

    const caller = await quota.resolveCaller(
      credentials({
        authorization: `Bearer ${await signToken(impostor, { sub: userId })}`,
        sessionCookie: await signToken(key, { sub: userId }),
      }),
    );

    expect(caller).toEqual({ kind: "free", userId });
  });

  it.each([
    ["test_invalid_session_falls_back_to_anonymous_quota", "authorization"],
    ["test_invalid_session_cookie_is_treated_as_anonymous", "sessionCookie"],
  ] as const)("%s", async (_name, field) => {
    const { quota } = await setup();
    const userId = uniqueId("user");
    const impostor = await signingKey("kid-1");
    const token = await signToken(impostor, { sub: userId });
    const trackingCookie = randomUUID();
    const value = field === "authorization" ? `Bearer ${token}` : token;

    const caller = await quota.resolveCaller(
      credentials({ [field]: value, trackingCookie, clientIp: "203.0.113.10" }),
    );

    expect(caller).toEqual({
      kind: "anonymous",
      trackingId: trackingCookie,
      ipHash: hashIp("203.0.113.10"),
    });
  });

  it.each([
    [
      "test_bearer_infrastructure_failure_falls_back_to_anonymous_quota",
      "authorization",
    ],
    [
      "test_session_cookie_infrastructure_failure_falls_back_to_anonymous_quota",
      "sessionCookie",
    ],
  ] as const)("%s", async (_name, field) => {
    const { quota, http, key } = await setup();
    const userId = uniqueId("user");
    http.routes.set(JWKS_URL, () => new Response(null, { status: 503 }));
    const token = await signToken(key, { sub: userId });
    const value = field === "authorization" ? `Bearer ${token}` : token;

    const caller = await quota.resolveCaller(credentials({ [field]: value }));

    expect(caller.kind).toBe("anonymous");
  });

  it("test_checkout_grace_does_not_help_invalid_identity", async () => {
    const { quota, access } = await setup();
    const userId = uniqueId("user");
    await access.grantCheckoutGrace(userId);
    const impostor = await signingKey("kid-1");

    const caller = await quota.resolveCaller(
      credentials({
        authorization: `Bearer ${await signToken(impostor, { sub: userId })}`,
      }),
    );

    expect(caller.kind).toBe("anonymous");
  });

  it("test_checkout_grace_allows_verified_user", async () => {
    const { quota, access, http, key } = await setup();
    const userId = uniqueId("user");
    http.user(userId, freeTier);
    await access.grantCheckoutGrace(userId);
    const token = await signToken(key, { sub: userId });

    const caller = await quota.resolveCaller(
      credentials({ authorization: `Bearer ${token}` }),
    );

    expect(caller).toEqual({ kind: "pro", userId });
  });

  it("replaces a cf_track cookie that is not a UUID", async () => {
    const { quota } = await setup();

    const caller = await quota.resolveCaller(
      credentials({ trackingCookie: "not-a-uuid" }),
    );

    expect(caller.kind === "anonymous" && caller.trackingId).not.toBe(
      "not-a-uuid",
    );
  });

  it("test_redis_unavailable_short_circuits_before_tier_or_grace_checks", async () => {
    const { quota, http, key } = await setup({ client: null });
    const userId = uniqueId("user");
    const token = await signToken(key, {
      sub: userId,
      public_metadata: { tier: "pro" },
    });

    const caller = await quota.resolveCaller(
      credentials({ authorization: `Bearer ${token}` }),
    );

    expect(caller).toEqual({ kind: "free", userId });
    expect(http.requestedUrls()).toEqual([JWKS_URL]);
    await quotaFailure(quota.check(caller));
  });
});

describe("Quota.check", () => {
  it.each<[AnonymousCaller | FreeCaller, (string | null)[], boolean, number]>([
    [anonymous(), [`${ANON_LIMIT - 4}`, `${ANON_LIMIT - 1}`], true, 1],
    [anonymous(), [`${ANON_LIMIT}`, null], false, 0],
    [anonymous(), [null, `${ANON_LIMIT + 3}`], false, 0],
    [free(), [`${FREE_USER_LIMIT - 1}`], true, 1],
    [free(), [`${FREE_USER_LIMIT}`], false, 0],
  ])(
    "test_check_usage_reads_quota_without_writing (%j, %j)",
    async (caller, stored, allowed, remaining) => {
      const { quota } = await setup();
      const keys =
        caller.kind === "anonymous"
          ? [trackingKey(caller), ipKey(caller)]
          : [userKey(caller.userId)];
      for (const [index, key] of keys.entries()) {
        const value = stored[index];
        if (value) await redis.set(key, value);
      }

      const status = await quota.check(caller);

      expect(status).toMatchObject({ allowed, remaining });
      expect(await redis.mGet(keys)).toEqual(stored);
      expect(await Promise.all(keys.map((key) => redis.ttl(key)))).toEqual(
        stored.map((value) => (value === null ? -2 : -1)),
      );
    },
  );

  it("reads a counter with Python's int() grammar", async () => {
    const { quota } = await setup();
    const caller = free();
    await redis.set(userKey(caller.userId), " 2_9 ");

    expect(await quota.check(caller)).toMatchObject({
      allowed: true,
      remaining: 1,
    });
  });

  it.each(["not-a-number", "1e3", "0x10"])(
    "fails as Python's int() does on the stored counter %j",
    async (stored) => {
      const { quota } = await setup();
      const caller = free();
      await redis.set(userKey(caller.userId), stored);

      const error = await quota
        .check(caller)
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(Error);
      expect(error).not.toBeInstanceOf(QuotaUnavailableError);
    },
  );

  it("test_check_usage_for_pro_caller_does_not_touch_redis", async () => {
    const { quota } = await setup({ client: closedRedis() });
    const caller = { kind: "pro", userId: "user-123" } as const;

    expect(await quota.check(caller)).toEqual({
      kind: "unlimited",
      allowed: true,
      caller,
    });
  });

  it.each([
    ["no Redis", null],
    ["a Redis error", "closed"],
  ] as const)(
    "test_check_usage_fails_closed_when_usage_tracking_is_unavailable (%s)",
    async (_case, client) => {
      const { quota } = await setup({
        client: client === null ? null : closedRedis(),
      });

      const error = await quotaFailure(quota.check(anonymous()));

      expect(error.status).toBe(503);
      expect(error.message).toBe("Usage tracking is temporarily unavailable");
      expect(error.cause === undefined).toBe(client === null);
    },
  );
});

describe("Quota.charge", () => {
  it("test_authenticated_reservation_at_limit_is_allowed", async () => {
    const { quota } = await setup();
    const caller = free();
    await redis.set(userKey(caller.userId), `${FREE_USER_LIMIT - 1}`);

    const status = await quota.charge(caller);

    expect(status).toMatchObject({ allowed: true, remaining: 0 });
    expect(await redis.get(userKey(caller.userId))).toBe(`${FREE_USER_LIMIT}`);
    expect(await redis.ttl(userKey(caller.userId))).toBe(USAGE_TTL_SECONDS);
  });

  it("test_authenticated_reservation_above_limit_is_denied", async () => {
    const { quota } = await setup();
    const caller = free();
    await redis.set(userKey(caller.userId), `${FREE_USER_LIMIT}`);

    expect(await quota.charge(caller)).toMatchObject({
      allowed: false,
      remaining: 0,
    });
  });

  it("test_anonymous_reservation_updates_both_counters_atomically", async () => {
    const { quota } = await setup();
    const caller = anonymous();
    await redis.set(trackingKey(caller), "3");
    await redis.set(ipKey(caller), "6");

    const status = await quota.charge(caller);

    expect(status).toEqual({
      kind: "metered",
      allowed: true,
      remaining: ANON_LIMIT - 7,
      limit: ANON_LIMIT,
      caller,
    });
    expect(await redis.mGet([trackingKey(caller), ipKey(caller)])).toEqual([
      "4",
      "7",
    ]);
    expect(await redis.ttl(trackingKey(caller))).toBe(USAGE_TTL_SECONDS);
    expect(await redis.ttl(ipKey(caller))).toBe(USAGE_TTL_SECONDS);
  });

  it.each([
    [
      "test_anonymous_reservation_at_limit_is_allowed",
      ANON_LIMIT - 1,
      ANON_LIMIT - 3,
      true,
    ],
    [
      "test_anonymous_reservation_above_limit_is_denied",
      ANON_LIMIT - 3,
      ANON_LIMIT,
      false,
    ],
  ])("%s", async (_name, trackingCount, ipCount, allowed) => {
    const { quota } = await setup();
    const caller = anonymous();
    await redis.set(trackingKey(caller), `${trackingCount}`);
    await redis.set(ipKey(caller), `${ipCount}`);

    expect(await quota.charge(caller)).toMatchObject({
      allowed,
      remaining: 0,
    });
  });

  it("gives a stranded usage counter without a TTL its TTL", async () => {
    const { quota } = await setup();
    const caller = free();
    await redis.set(userKey(caller.userId), "2");

    await quota.charge(caller);

    expect(await redis.ttl(userKey(caller.userId))).toBe(USAGE_TTL_SECONDS);
  });

  it("test_pro_reservation_does_not_create_usage_pipeline", async () => {
    const { quota } = await setup();
    const userId = uniqueId("user");

    const status = await quota.charge({ kind: "pro", userId });

    expect(status.kind).toBe("unlimited");
    expect(await redis.exists(userKey(userId))).toBe(0);
  });

  it.each([
    [
      "test_reserve_usage_handles_redis_errors_for_anonymous_requests",
      anonymous,
    ],
    ["test_reserve_usage_handles_redis_errors_for_authenticated_users", free],
  ])("%s", async (_name, caller) => {
    const { quota } = await setup({ client: closedRedis() });

    const error = await quotaFailure(quota.charge(caller()));

    expect(error.cause).toBeInstanceOf(Error);
  });

  it("test_redis_unavailable_raises_quota_unavailable", async () => {
    const { quota } = await setup({ client: null });

    await quotaFailure(quota.charge(anonymous()));
  });

  it("fails closed when a counter in the transaction is not an integer", async () => {
    const { quota } = await setup();
    const caller = anonymous();
    await redis.set(ipKey(caller), "not-a-number");

    await quotaFailure(quota.charge(caller));
  });
});

describe("Quota races", () => {
  it("lets concurrent checks pass and lets the charge decide", async () => {
    const { quota } = await setup();
    const caller = anonymous();
    await redis.set(ipKey(caller), `${ANON_LIMIT - 1}`);

    const checks = await Promise.all(
      Array.from({ length: 5 }, () => quota.check(caller)),
    );
    const charges = await Promise.all(
      Array.from({ length: 5 }, () => quota.charge(caller)),
    );

    expect(checks.every((status) => status.allowed)).toBe(true);
    expect(charges.filter((status) => status.allowed)).toHaveLength(1);
    expect(await redis.get(ipKey(caller))).toBe(`${ANON_LIMIT + 4}`);
  });
});

describe("quotaHeaders", () => {
  it("reports the remaining and total quota of a metered caller", () => {
    expect(
      quotaHeaders({
        kind: "metered",
        allowed: true,
        remaining: 7,
        limit: 10,
        caller: anonymous(),
      }),
    ).toEqual({ "X-RateLimit-Remaining": "7", "X-RateLimit-Limit": "10" });
  });

  it("adds nothing for an unlimited caller", () => {
    expect(
      quotaHeaders({
        kind: "unlimited",
        allowed: true,
        caller: { kind: "pro", userId: "user_123" },
      }),
    ).toEqual({});
  });
});
