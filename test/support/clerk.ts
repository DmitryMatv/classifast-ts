import {
  exportJWK,
  generateKeyPair,
  SignJWT,
  type CryptoKey,
  type JWK,
  type JWTPayload,
} from "jose";
import { vi } from "vitest";
import { Clerk } from "../../src/auth/clerk.js";
import type { AppConfig } from "../../src/config/app-config.js";

export const FRONTEND_API = "clerk.example.com";
export const ISSUER = `https://${FRONTEND_API}`;
export const JWKS_URL = `${ISSUER}/.well-known/jwks.json`;
export const CLERK_API = "https://api.clerk.com/v1";

export type Route = () => Response | Promise<Response>;

function urlOf(input: string | URL | Request): string {
  return typeof input === "string"
    ? input
    : "url" in input
      ? input.url
      : input.href;
}

export interface SigningKey {
  readonly kid: string;
  readonly privateKey: CryptoKey;
  readonly jwk: JWK;
}

export async function signingKey(kid: string): Promise<SigningKey> {
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  const jwk = {
    ...(await exportJWK(publicKey)),
    kid,
    alg: "RS256",
    use: "sig",
  };
  return { kid, privateKey, jwk };
}

export function jwksResponse(...keys: SigningKey[]): Response {
  return Response.json({ keys: keys.map((key) => key.jwk) });
}

/**
 * Clerk's HTTP surface: the frontend API's JWKS and the Backend API. Routes
 * are keyed by URL. An unrouted URL fails the test.
 */
export class FakeClerkHttp {
  readonly routes = new Map<string, Route>();
  readonly fetch = vi.fn(
    async (input: string | URL | Request, _init?: RequestInit) => {
      const route = this.routes.get(urlOf(input));
      if (!route) throw new Error(`Unexpected Clerk request: ${urlOf(input)}`);
      return route();
    },
  );

  requestedUrls(): string[] {
    return this.fetch.mock.calls.map(([input]) => urlOf(input));
  }

  session(id: string, route: Route): void {
    this.routes.set(`${CLERK_API}/sessions/${id}`, route);
  }

  user(id: string, route: Route): void {
    this.routes.set(`${CLERK_API}/users/${id}`, route);
  }
}

export function clerkConfig(
  overrides: Partial<AppConfig["clerk"]> = {},
): AppConfig["clerk"] {
  return {
    secretKey: "sk_test",
    frontendApi: FRONTEND_API,
    permittedOrigins: [],
    ...overrides,
  };
}

export async function clerkWithKey(
  config: AppConfig["clerk"] = clerkConfig(),
): Promise<{ clerk: Clerk; http: FakeClerkHttp; key: SigningKey }> {
  const key = await signingKey("kid-1");
  const http = new FakeClerkHttp();
  http.routes.set(JWKS_URL, () => jwksResponse(key));
  return { clerk: new Clerk(config, http.fetch), http, key };
}

/** A Clerk session token; `claims` override or, with `undefined`, remove. */
export async function signToken(
  key: SigningKey,
  claims: Record<string, unknown> = {},
  kid: string | null = key.kid,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const payload: JWTPayload = {
    iss: ISSUER,
    sub: "user_123",
    sid: "sess_123",
    iat: now,
    nbf: now - 5,
    exp: now + 60,
    ...claims,
  };
  for (const [claim, value] of Object.entries(claims)) {
    if (value === undefined) delete payload[claim];
  }
  return new SignJWT(payload)
    .setProtectedHeader(kid === null ? { alg: "RS256" } : { alg: "RS256", kid })
    .sign(key.privateKey);
}

export function activeSession(userId = "user_123"): Response {
  return Response.json({ status: "active", user_id: userId });
}
