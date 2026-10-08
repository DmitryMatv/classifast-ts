import { Logger } from "@nestjs/common";
import {
  createRemoteJWKSet,
  customFetch,
  errors,
  jwtVerify,
  type FetchImplementation,
  type JWTPayload,
  type JWTVerifyGetKey,
} from "jose";
import { z } from "zod";
import type { AppConfig } from "../config/app-config.js";
import { HttpStatusError } from "../http-status-error.js";

const logger = new Logger("ClerkAuth");

const CLERK_API_URL = "https://api.clerk.com/v1";
const CLERK_API_VERSION = "2025-11-10";
const SESSION_TIMEOUT_MS = 10_000;
const TIER_TIMEOUT_MS = 5_000;
const PYJWKCLIENT_DEFAULTS = {
  timeoutDuration: 30_000,
  cacheMaxAge: 300_000,
  cooldownDuration: 30_000,
};

const TRANSIENT_STATUSES = new Set([429, 500, 502, 503, 504]);
const SESSION_UNAVAILABLE_STATUSES = new Set([401, 403, ...TRANSIENT_STATUSES]);
const TIER_NEGATIVE_STATUSES = new Set([401, 403, 404]);

export class ClerkAuthError extends HttpStatusError {
  constructor(
    detail: string,
    readonly status: 401 | 500 = 401,
  ) {
    super(detail);
  }
}

export class ClerkUnavailableError extends HttpStatusError {
  readonly status = 503;

  constructor() {
    super("Auth service unavailable now");
  }
}

class JwksUnavailableError extends Error {}

const serverConfigurationError = () =>
  new ClerkAuthError("Server configuration error", 500);

export interface ClerkIdentity {
  readonly userId: string;
  readonly tierHint: string | undefined;
}

export type TierResolution =
  | { readonly status: "confirmed_pro" }
  | { readonly status: "confirmed_non_pro"; readonly tier?: string }
  | { readonly status: "explicit_negative" }
  | { readonly status: "transient_unavailable" };

interface VerifyOptions {
  readonly requireSessionClaims: boolean;
  readonly validateAzp: boolean;
}

const INVALID_TOKEN_ERRORS = [
  errors.JWTInvalid,
  errors.JWSInvalid,
  errors.JWTClaimValidationFailed,
  errors.JWSSignatureVerificationFailed,
  errors.JOSEAlgNotAllowed,
  errors.JOSENotSupported,
];

function verificationFailure(
  error: unknown,
): ClerkAuthError | ClerkUnavailableError {
  if (error instanceof errors.JWTExpired) {
    return new ClerkAuthError("Token has expired");
  }
  const name = error instanceof Error ? error.name : typeof error;
  if (INVALID_TOKEN_ERRORS.some((type) => error instanceof type)) {
    logger.warn(`Invalid Clerk JWT: ${name}`);
    return new ClerkAuthError("Invalid token");
  }
  logger.error(`Unexpected Clerk JWT verification error: ${name}`);
  return error instanceof JwksUnavailableError
    ? new ClerkUnavailableError()
    : new ClerkAuthError("Authentication failed");
}

function checkPyJwtClaims(payload: JWTPayload, required: string[]): void {
  const now = Date.now() / 1000;
  const { sub, jti } = payload;
  if (
    required.some((claim) => payload[claim] === null) ||
    Math.trunc(payload.iat ?? 0) > now ||
    (payload.aud ?? "").length !== 0 ||
    (sub !== undefined && typeof sub !== "string") ||
    (jti !== undefined && typeof jti !== "string")
  ) {
    throw new ClerkAuthError("Invalid token");
  }
}

// Fetch failures and non-200 answers are transient, as PyJWKClient's
// connection error is. The body is read here so that a stalled read is too.
function jwksFetch(fetchImpl: typeof fetch): FetchImplementation {
  return async (url, init) => {
    try {
      const response = await fetchImpl(url, init);
      if (response.status !== 200) {
        throw new Error(`JWKS answered ${response.status}`);
      }
      return new Response(await response.text(), { status: 200 });
    } catch (cause) {
      throw new JwksUnavailableError("Failed to fetch JWKS", { cause });
    }
  };
}

function requireKid(getKey: JWTVerifyGetKey): JWTVerifyGetKey {
  return (header, token) =>
    header.kid === undefined
      ? Promise.reject(new errors.JWKSNoMatchingKey())
      : getKey(header, token);
}

const sessionSchema = z.looseObject({
  status: z.unknown().optional(),
  user_id: z.unknown().optional(),
});

const metadataSchema = z.looseObject({ tier: z.unknown().optional() });

const userSchema = z.looseObject({
  public_metadata: metadataSchema.optional(),
});

export class Clerk {
  readonly #config: AppConfig["clerk"];
  readonly #fetch: typeof fetch;
  readonly #jwks: JWTVerifyGetKey | undefined;

  constructor(config: AppConfig["clerk"], fetchImpl: typeof fetch = fetch) {
    this.#config = config;
    this.#fetch = fetchImpl;
    if (config.frontendApi) {
      const remote = createRemoteJWKSet(
        new URL(`https://${config.frontendApi}/.well-known/jwks.json`),
        {
          ...PYJWKCLIENT_DEFAULTS,
          [customFetch]: jwksFetch(fetchImpl),
        },
      );
      this.#jwks = requireKid(remote);
    }
  }

  get validatesAzp(): boolean {
    return this.#config.permittedOrigins.length > 0;
  }

  async verifyToken(
    token: string,
    { requireSessionClaims, validateAzp }: VerifyOptions,
  ): Promise<JWTPayload> {
    if (!this.#jwks) {
      logger.error("Clerk JWT verification is not configured");
      throw serverConfigurationError();
    }
    const requiredClaims = ["exp", "iat", "iss", "nbf"];
    if (requireSessionClaims) requiredClaims.push("sid", "sub");

    let payload: JWTPayload;
    try {
      ({ payload } = await jwtVerify(token, this.#jwks, {
        algorithms: ["RS256"],
        issuer: `https://${this.#config.frontendApi}`,
        requiredClaims,
      }));
    } catch (error) {
      throw verificationFailure(error);
    }
    checkPyJwtClaims(payload, requiredClaims);

    if (requireSessionClaims && !payload.sid) {
      throw new ClerkAuthError("Invalid token payload");
    }
    if (validateAzp) this.#checkAzp(payload.azp);
    return payload;
  }

  #checkAzp(azp: unknown): void {
    if (this.#config.permittedOrigins.length === 0) {
      logger.error(
        "CLERK_PERMITTED_ORIGINS is empty but AZP validation requested",
      );
      throw serverConfigurationError();
    }
    if (!azp) throw new ClerkAuthError("Missing token origin");
    if (
      typeof azp !== "string" ||
      !this.#config.permittedOrigins.includes(azp)
    ) {
      throw new ClerkAuthError("Invalid token origin");
    }
  }

  async authenticateLocal(
    token: string,
    validateAzp: boolean,
  ): Promise<ClerkIdentity> {
    const payload = await this.verifyToken(token, {
      requireSessionClaims: false,
      validateAzp,
    });
    return identityFromPayload(payload);
  }

  async authenticateWithSession(
    token: string,
    validateAzp: boolean,
  ): Promise<ClerkIdentity> {
    const payload = await this.verifyToken(token, {
      requireSessionClaims: true,
      validateAzp,
    });
    if (typeof payload.sid !== "string") {
      throw new ClerkAuthError("Invalid token payload");
    }
    const sessionUserId = await this.verifySessionActive(payload.sid);
    const identity = identityFromPayload(payload);
    if (identity.userId !== sessionUserId) {
      throw new ClerkAuthError("Invalid session");
    }
    return identity;
  }

  async requireSessionUser(authorization: string | undefined): Promise<string> {
    if (!authorization) {
      throw new ClerkAuthError("Missing Authorization header");
    }
    if (!authorization.startsWith("Bearer ")) {
      throw new ClerkAuthError("Invalid Authorization header format");
    }
    const { userId } = await this.authenticateWithSession(
      authorization.slice("Bearer ".length),
      this.validatesAzp,
    );
    return userId;
  }

  async verifySessionActive(sessionId: string): Promise<string> {
    if (!sessionId) throw new ClerkAuthError("Invalid token payload");
    if (!this.#config.secretKey) {
      logger.error("CLERK_SECRET_KEY not set");
      throw serverConfigurationError();
    }

    let response: ClerkResponse;
    try {
      response = await this.#get(
        `sessions/${sessionId}`,
        this.#config.secretKey,
        SESSION_TIMEOUT_MS,
      );
    } catch (error) {
      logger.error(
        `Clerk session verification request failed: ${String(error)}`,
      );
      throw new ClerkUnavailableError();
    }

    if (SESSION_UNAVAILABLE_STATUSES.has(response.status)) {
      logger.error(
        `Clerk session verification temporarily unavailable: ${response.status}`,
      );
      throw new ClerkUnavailableError();
    }
    if (response.status !== 200) {
      logger.error(`Clerk session verification failed: ${response.status}`);
      throw new ClerkAuthError("Invalid session");
    }

    const session = sessionSchema.safeParse(parseJson(response.body));
    if (!session.success) {
      logger.error("Failed to parse Clerk session response");
      throw new ClerkAuthError("Authentication failed");
    }
    if (session.data.status !== "active") {
      throw new ClerkAuthError("Session is not active");
    }
    const userId = session.data.user_id;
    if (typeof userId !== "string" || !userId) {
      throw new ClerkAuthError("Invalid session");
    }
    return userId;
  }

  async fetchUserTier(userId: string): Promise<TierResolution> {
    if (!this.#config.secretKey || !userId) {
      logger.error(
        "CLERK_SECRET_KEY missing or user_id empty during tier lookup",
      );
      return { status: "explicit_negative" };
    }

    let response: ClerkResponse;
    try {
      response = await this.#get(
        `users/${userId}`,
        this.#config.secretKey,
        TIER_TIMEOUT_MS,
      );
    } catch (error) {
      logger.warn(`Failed to fetch tier from Clerk API: ${String(error)}`);
      return { status: "transient_unavailable" };
    }

    if (response.status === 200) {
      const user = userSchema.safeParse(parseJson(response.body));
      if (!user.success) {
        logger.warn("Failed to parse tier from Clerk API");
        return { status: "explicit_negative" };
      }
      const tier = user.data.public_metadata?.tier;
      if (tier === "pro") return { status: "confirmed_pro" };
      return typeof tier === "string" && tier
        ? { status: "confirmed_non_pro", tier }
        : { status: "confirmed_non_pro" };
    }
    if (TIER_NEGATIVE_STATUSES.has(response.status)) {
      return { status: "explicit_negative" };
    }
    if (TRANSIENT_STATUSES.has(response.status)) {
      return { status: "transient_unavailable" };
    }
    logger.warn(
      `Unexpected Clerk tier response status: user_id=${userId}, status=${response.status}`,
    );
    return { status: "explicit_negative" };
  }

  async #get(
    path: string,
    secretKey: string,
    timeoutMs: number,
  ): Promise<ClerkResponse> {
    const signal = AbortSignal.timeout(timeoutMs);
    const response = await this.#fetch(`${CLERK_API_URL}/${path}`, {
      headers: {
        Authorization: `Bearer ${secretKey}`,
        "Clerk-API-Version": CLERK_API_VERSION,
      },
      signal,
    });
    return { status: response.status, body: await response.text() };
  }
}

interface ClerkResponse {
  readonly status: number;
  readonly body: string;
}

function parseJson(body: string): unknown {
  try {
    return JSON.parse(body);
  } catch {
    return undefined;
  }
}

function identityFromPayload(payload: JWTPayload): ClerkIdentity {
  const userId = payload.sub;
  if (typeof userId !== "string" || !userId) {
    throw new ClerkAuthError("Invalid token payload");
  }
  const tier = metadataSchema.safeParse(payload.public_metadata).data?.tier;
  return { userId, tierHint: typeof tier === "string" ? tier : undefined };
}
