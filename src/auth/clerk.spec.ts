import { SignJWT } from "jose";
import { vi } from "vitest";
import {
  activeSession,
  CLERK_API,
  clerkConfig,
  clerkWithKey,
  FakeClerkHttp,
  JWKS_URL,
  jwksResponse,
  type Route,
  signingKey,
  signToken,
} from "../../test/support/clerk.js";
import { parseAppConfig } from "../config/app-config.js";
import {
  Clerk,
  ClerkAuthError,
  ClerkUnavailableError,
  type TierResolution,
} from "./clerk.js";

const SESSION_URL = `${CLERK_API}/sessions/sess_123`;

async function failure(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => {
      throw new Error("expected a rejection");
    },
    (error: unknown) => error,
  );
}

async function authFailure(
  promise: Promise<unknown>,
): Promise<{ status: number; detail: string }> {
  const error = await failure(promise);
  if (!(error instanceof ClerkAuthError)) throw error;
  return { status: error.status, detail: error.message };
}

describe("Clerk.authenticateLocal", () => {
  it("test_local_auth_succeeds_without_session_claims", async () => {
    const { clerk, key } = await clerkWithKey();
    const token = await signToken(key, {
      sid: undefined,
      public_metadata: { tier: "pro" },
    });

    expect(await clerk.authenticateLocal(token, false)).toEqual({
      userId: "user_123",
      tierHint: "pro",
    });
  });

  it("test_local_auth_does_not_verify_live_session", async () => {
    const { clerk, http, key } = await clerkWithKey(
      clerkConfig({ permittedOrigins: ["https://classifast.com"] }),
    );
    const token = await signToken(key, { azp: "https://classifast.com" });

    const identity = await clerk.authenticateLocal(token, true);

    expect(identity).toEqual({ userId: "user_123", tierHint: undefined });
    expect(http.requestedUrls()).toEqual([JWKS_URL]);
  });

  it("rejects a token without a subject as an invalid payload", async () => {
    const { clerk, key } = await clerkWithKey();
    const token = await signToken(key, { sub: undefined });

    expect(await authFailure(clerk.authenticateLocal(token, false))).toEqual({
      status: 401,
      detail: "Invalid token payload",
    });
  });

  it("ignores a tier hint that is not a string", async () => {
    const { clerk, key } = await clerkWithKey();
    const token = await signToken(key, { public_metadata: { tier: 1 } });

    expect((await clerk.authenticateLocal(token, false)).tierHint).toBe(
      undefined,
    );
  });
});

describe("Clerk.authenticateWithSession", () => {
  it("test_missing_sub_claim_fails_authentication", async () => {
    const { clerk, http, key } = await clerkWithKey();
    http.session("sess_123", () => activeSession());
    const token = await signToken(key, { sub: undefined });

    expect(
      await authFailure(clerk.authenticateWithSession(token, false)),
    ).toEqual({ status: 401, detail: "Invalid token" });
  });

  it("test_session_auth_rejects_subject_mismatch", async () => {
    const { clerk, http, key } = await clerkWithKey();
    http.session("sess_123", () => activeSession("user_session"));
    const token = await signToken(key, { sub: "user_token" });

    expect(
      await authFailure(clerk.authenticateWithSession(token, false)),
    ).toEqual({ status: 401, detail: "Invalid session" });
  });

  it("test_backward_compatible_auth_wrapper_uses_session_auth", async () => {
    const { clerk, http, key } = await clerkWithKey();
    http.session("sess_123", () => activeSession());
    const token = await signToken(key);

    expect(await clerk.authenticateWithSession(token, false)).toEqual({
      userId: "user_123",
      tierHint: undefined,
    });
    expect(http.requestedUrls()).toEqual([JWKS_URL, SESSION_URL]);
    expect(http.fetch.mock.calls[1]?.[1]?.headers).toEqual({
      Authorization: "Bearer sk_test",
      "Clerk-API-Version": "2025-11-10",
    });
  });

  it("test_session_auth_propagates_infrastructure_failures", async () => {
    const { clerk, http, key } = await clerkWithKey();
    http.session("sess_123", () => new Response(null, { status: 503 }));
    const token = await signToken(key);

    expect(
      await failure(clerk.authenticateWithSession(token, false)),
    ).toBeInstanceOf(ClerkUnavailableError);
  });

  it("rejects a session token whose sid is null", async () => {
    const { clerk, key } = await clerkWithKey();
    const token = await signToken(key, { sid: null });

    expect(
      await authFailure(clerk.authenticateWithSession(token, false)),
    ).toEqual({ status: 401, detail: "Invalid token" });
  });

  it("rejects a session token whose sid is empty", async () => {
    const { clerk, key } = await clerkWithKey();
    const token = await signToken(key, { sid: "" });

    expect(
      await authFailure(clerk.authenticateWithSession(token, false)),
    ).toEqual({ status: 401, detail: "Invalid token payload" });
  });
});

describe("Clerk.verifyToken claim checks", () => {
  const verify = (clerk: Clerk, token: string, validateAzp = false) =>
    clerk.verifyToken(token, { requireSessionClaims: false, validateAzp });

  it("test_validate_azp_requires_configured_permitted_origins", async () => {
    const { clerk, key } = await clerkWithKey();
    const token = await signToken(key);

    expect(await authFailure(verify(clerk, token, true))).toEqual({
      status: 500,
      detail: "Server configuration error",
    });
  });

  it("fails as a server error when CLERK_FRONTEND_API is unset", async () => {
    const { key } = await clerkWithKey();
    const clerk = new Clerk(clerkConfig({ frontendApi: "" }));

    expect(await authFailure(verify(clerk, await signToken(key)))).toEqual({
      status: 500,
      detail: "Server configuration error",
    });
  });

  it("test_should_validate_clerk_azp_reflects_configured_origins", () => {
    const withOrigins = parseAppConfig({
      CLERK_PERMITTED_ORIGINS: " , https://a.example , ",
    });
    const blank = parseAppConfig({ CLERK_PERMITTED_ORIGINS: " , , " });

    expect(new Clerk(withOrigins.clerk).validatesAzp).toBe(true);
    expect(new Clerk(blank.clerk).validatesAzp).toBe(false);
  });

  it.each([
    ["missing", undefined, "Missing token origin"],
    ["empty", "", "Missing token origin"],
    ["not permitted", "https://evil.example", "Invalid token origin"],
    ["not a string", ["https://classifast.com"], "Invalid token origin"],
  ])("rejects an azp that is %s", async (_case, azp, detail) => {
    const { clerk, key } = await clerkWithKey(
      clerkConfig({ permittedOrigins: ["https://classifast.com"] }),
    );
    const token = await signToken(key, { azp });

    expect(await authFailure(verify(clerk, token, true))).toEqual({
      status: 401,
      detail,
    });
  });

  it("accepts a permitted azp", async () => {
    const { clerk, key } = await clerkWithKey(
      clerkConfig({
        permittedOrigins: ["https://a.example", "https://b.example"],
      }),
    );
    const token = await signToken(key, { azp: "https://b.example" });

    expect((await verify(clerk, token, true)).sub).toBe("user_123");
  });

  it("does not check azp unless asked", async () => {
    const { clerk, key } = await clerkWithKey(
      clerkConfig({ permittedOrigins: ["https://classifast.com"] }),
    );
    const token = await signToken(key, { azp: "https://evil.example" });

    expect((await verify(clerk, token)).sub).toBe("user_123");
  });

  it("rejects an expired token", async () => {
    const { clerk, key } = await clerkWithKey();
    const now = Math.floor(Date.now() / 1000);
    const token = await signToken(key, { iat: now - 120, exp: now - 60 });

    expect(await authFailure(verify(clerk, token))).toEqual({
      status: 401,
      detail: "Token has expired",
    });
  });

  it.each([
    ["the wrong issuer", { iss: "https://other.example" }],
    ["no exp", { exp: undefined }],
    ["no iat", { iat: undefined }],
    ["no nbf", { nbf: undefined }],
    ["an nbf in the future", { nbf: Math.floor(Date.now() / 1000) + 600 }],
    ["an iat in the future", { iat: Math.floor(Date.now() / 1000) + 600 }],
    ["an audience", { aud: "https://api.example" }],
    ["a subject that is not a string", { sub: 5 }],
    ["a jti that is not a string", { jti: 5 }],
  ])("rejects a token with %s as invalid", async (_case, claims) => {
    const { clerk, key } = await clerkWithKey();
    const token = await signToken(key, claims);

    expect(await authFailure(verify(clerk, token))).toEqual({
      status: 401,
      detail: "Invalid token",
    });
  });

  it.each([null, "", []])(
    "accepts an empty audience %j, as PyJWT does",
    async (aud) => {
      const { clerk, key } = await clerkWithKey();
      const token = await signToken(key, { aud });

      expect((await verify(clerk, token)).sub).toBe("user_123");
    },
  );

  it("rejects a token signed by another key under a known kid", async () => {
    const { clerk } = await clerkWithKey();
    const impostor = await signingKey("kid-1");

    expect(await authFailure(verify(clerk, await signToken(impostor)))).toEqual(
      { status: 401, detail: "Invalid token" },
    );
  });

  it("rejects an HS256 token", async () => {
    const { clerk } = await clerkWithKey();
    const token = await new SignJWT({ sub: "user_123" })
      .setProtectedHeader({ alg: "HS256", kid: "kid-1" })
      .sign(new TextEncoder().encode("a-shared-secret-of-sufficient-size"));

    expect(await authFailure(verify(clerk, token))).toEqual({
      status: 401,
      detail: "Invalid token",
    });
  });

  it("rejects a malformed token", async () => {
    const { clerk } = await clerkWithKey();

    expect(await authFailure(verify(clerk, "not-a-jwt"))).toEqual({
      status: 401,
      detail: "Invalid token",
    });
  });

  it("rejects a token without a kid, as PyJWKClient does", async () => {
    const { clerk, key } = await clerkWithKey();
    const token = await signToken(key, {}, null);

    expect(await authFailure(verify(clerk, token))).toEqual({
      status: 401,
      detail: "Authentication failed",
    });
  });
});

describe("Clerk JWKS fetching", () => {
  const verify = (clerk: Clerk, token: string) =>
    clerk.verifyToken(token, {
      requireSessionClaims: false,
      validateAzp: false,
    });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("caches the key set between verifications", async () => {
    const { clerk, http, key } = await clerkWithKey();

    await verify(clerk, await signToken(key));
    await verify(clerk, await signToken(key));

    expect(http.requestedUrls()).toEqual([JWKS_URL]);
  });

  it("fetches a rotated key once the refresh cooldown has passed", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const { clerk, http, key } = await clerkWithKey();
    const rotated = await signingKey("kid-2");
    await verify(clerk, await signToken(key));
    http.routes.set(JWKS_URL, () => jwksResponse(key, rotated));

    const early = await authFailure(verify(clerk, await signToken(rotated)));
    vi.advanceTimersByTime(31_000);
    const late = await verify(clerk, await signToken(rotated));

    expect(early).toEqual({ status: 401, detail: "Authentication failed" });
    expect(late.sub).toBe("user_123");
    expect(http.requestedUrls()).toEqual([JWKS_URL, JWKS_URL]);
  });

  it.each([
    ["a network error", () => Promise.reject(new TypeError("fetch failed"))],
    [
      "a timeout",
      () => Promise.reject(new DOMException("timed out", "TimeoutError")),
    ],
    ["a 500", () => new Response("oops", { status: 500 })],
    ["a redirect", () => new Response(null, { status: 302 })],
  ])("treats %s from the JWKS endpoint as transient", async (_case, route) => {
    const { key } = await clerkWithKey();
    const http = new FakeClerkHttp();
    http.routes.set(JWKS_URL, route);
    const clerk = new Clerk(clerkConfig(), http.fetch);

    expect(await failure(verify(clerk, await signToken(key)))).toBeInstanceOf(
      ClerkUnavailableError,
    );
  });

  it.each([
    ["invalid JSON", () => new Response("<html>", { status: 200 })],
    ["no key set", () => Response.json({ nope: true })],
  ])("treats %s from the JWKS endpoint as a failure", async (_case, route) => {
    const { key } = await clerkWithKey();
    const http = new FakeClerkHttp();
    http.routes.set(JWKS_URL, route);
    const clerk = new Clerk(clerkConfig(), http.fetch);

    expect(await authFailure(verify(clerk, await signToken(key)))).toEqual({
      status: 401,
      detail: "Authentication failed",
    });
  });
});

describe("Clerk.verifySessionActive", () => {
  async function verifyWith(route: () => Response | Promise<Response>) {
    const http = new FakeClerkHttp();
    http.session("sess_123", route);
    return new Clerk(clerkConfig(), http.fetch).verifySessionActive("sess_123");
  }

  it("returns the user id of an active session", async () => {
    expect(await verifyWith(() => activeSession("user_9"))).toBe("user_9");
  });

  it("test_verify_clerk_session_active_maps_503_to_infrastructure_error", async () => {
    const error = await failure(
      verifyWith(() => new Response(null, { status: 503 })),
    );

    expect(error).toBeInstanceOf(ClerkUnavailableError);
    expect(error).toMatchObject({
      status: 503,
      message: "Auth service unavailable now",
    });
  });

  it.each([401, 403, 429, 500, 502, 504])(
    "test_verify_clerk_session_active_maps_429_to_infrastructure_error (%i)",
    async (status) => {
      expect(
        await failure(verifyWith(() => new Response(null, { status }))),
      ).toBeInstanceOf(ClerkUnavailableError);
    },
  );

  it("test_verify_clerk_session_active_maps_request_error_to_infrastructure_error", async () => {
    expect(
      await failure(verifyWith(() => Promise.reject(new TypeError("boom")))),
    ).toBeInstanceOf(ClerkUnavailableError);
  });

  it("test_verify_clerk_session_active_keeps_404_as_invalid_session", async () => {
    expect(
      await authFailure(verifyWith(() => new Response(null, { status: 404 }))),
    ).toEqual({ status: 401, detail: "Invalid session" });
  });

  it("test_verify_clerk_session_active_rejects_inactive_session", async () => {
    expect(
      await authFailure(
        verifyWith(() =>
          Response.json({ status: "ended", user_id: "user_123" }),
        ),
      ),
    ).toEqual({ status: 401, detail: "Session is not active" });
  });

  it("rejects an active session without a user id", async () => {
    expect(
      await authFailure(verifyWith(() => Response.json({ status: "active" }))),
    ).toEqual({ status: 401, detail: "Invalid session" });
  });

  it("rejects an unparseable session response", async () => {
    expect(await authFailure(verifyWith(() => new Response("<html>")))).toEqual(
      { status: 401, detail: "Authentication failed" },
    );
  });

  it("fails as a server error without CLERK_SECRET_KEY", async () => {
    const clerk = new Clerk(clerkConfig({ secretKey: undefined }));

    expect(await authFailure(clerk.verifySessionActive("sess_123"))).toEqual({
      status: 500,
      detail: "Server configuration error",
    });
  });
});

describe("Clerk.requireSessionUser", () => {
  it("test_create_checkout_requires_auth_header", async () => {
    const { clerk } = await clerkWithKey();

    expect(await authFailure(clerk.requireSessionUser(undefined))).toEqual({
      status: 401,
      detail: "Missing Authorization header",
    });
  });

  it("rejects a header that is not a Bearer token", async () => {
    const { clerk, key } = await clerkWithKey();
    const token = await signToken(key);

    expect(
      await authFailure(clerk.requireSessionUser(`bearer ${token}`)),
    ).toEqual({ status: 401, detail: "Invalid Authorization header format" });
  });

  it("test_create_checkout_uses_strict_session_auth_helper", async () => {
    const { clerk, http, key } = await clerkWithKey(
      clerkConfig({ permittedOrigins: ["https://classifast.com"] }),
    );
    http.session("sess_123", () => activeSession());
    const token = await signToken(key, { azp: "https://classifast.com" });

    expect(await clerk.requireSessionUser(`Bearer ${token}`)).toBe("user_123");
    expect(http.requestedUrls()).toContain(SESSION_URL);
  });

  it("test_create_checkout_rejects_missing_azp_from_strict_auth", async () => {
    const { clerk, http, key } = await clerkWithKey(
      clerkConfig({ permittedOrigins: ["https://classifast.com"] }),
    );
    http.session("sess_123", () => activeSession());

    expect(
      await authFailure(
        clerk.requireSessionUser(`Bearer ${await signToken(key)}`),
      ),
    ).toEqual({ status: 401, detail: "Missing token origin" });
  });

  it("test_create_checkout_skips_azp_when_permitted_origins_not_configured", async () => {
    const { clerk, http, key } = await clerkWithKey();
    http.session("sess_123", () => activeSession());

    expect(
      await clerk.requireSessionUser(`Bearer ${await signToken(key)}`),
    ).toBe("user_123");
  });

  it("test_create_checkout_rejects_invalid_session_from_strict_auth", async () => {
    const { clerk, http, key } = await clerkWithKey();
    http.session("sess_123", () => new Response(null, { status: 404 }));

    expect(
      await authFailure(
        clerk.requireSessionUser(`Bearer ${await signToken(key)}`),
      ),
    ).toEqual({ status: 401, detail: "Invalid session" });
  });

  it("test_create_checkout_maps_clerk_backend_failure_to_503", async () => {
    const { clerk, http, key } = await clerkWithKey();
    http.session("sess_123", () => new Response(null, { status: 502 }));

    const error = await failure(
      clerk.requireSessionUser(`Bearer ${await signToken(key)}`),
    );

    expect(error).toMatchObject({
      status: 503,
      message: "Auth service unavailable now",
    });
  });
});

describe("Clerk.fetchUserTier", () => {
  async function tierFrom(route: Route) {
    const http = new FakeClerkHttp();
    http.user("user_123", route);
    return new Clerk(clerkConfig(), http.fetch).fetchUserTier("user_123");
  }

  type Case = [string, Route, TierResolution];
  const statusCase = (status: number, expected: TierResolution): Case => [
    `HTTP ${status}`,
    () => new Response(null, { status }),
    expected,
  ];
  const cases: Case[] = [
    [
      "pro metadata",
      () => Response.json({ public_metadata: { tier: "pro" } }),
      { status: "confirmed_pro" },
    ],
    [
      "another tier",
      () => Response.json({ public_metadata: { tier: "starter" } }),
      { status: "confirmed_non_pro", tier: "starter" },
    ],
    [
      "no tier",
      () => Response.json({ public_metadata: {} }),
      { status: "confirmed_non_pro" },
    ],
    [
      "no metadata",
      () => Response.json({ id: "user_123" }),
      { status: "confirmed_non_pro" },
    ],
    [
      "null metadata",
      () => Response.json({ public_metadata: null }),
      { status: "explicit_negative" },
    ],
    [
      "invalid JSON",
      () => new Response("<html>"),
      { status: "explicit_negative" },
    ],
    ...[401, 403, 404, 418].map((status) =>
      statusCase(status, { status: "explicit_negative" }),
    ),
    ...[429, 500, 502, 503, 504].map((status) =>
      statusCase(status, { status: "transient_unavailable" }),
    ),
    [
      "a network error",
      () => Promise.reject(new TypeError("fetch failed")),
      { status: "transient_unavailable" },
    ],
  ];

  it.each(cases)("classifies %s", async (_case, route, expected) => {
    expect(await tierFrom(route)).toEqual(expected);
  });

  it("is an explicit negative without CLERK_SECRET_KEY", async () => {
    const clerk = new Clerk(clerkConfig({ secretKey: undefined }));

    expect(await clerk.fetchUserTier("user_123")).toEqual({
      status: "explicit_negative",
    });
  });
});
