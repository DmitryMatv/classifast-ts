import { Logger } from "@nestjs/common";
import {
  ClerkAuthError,
  ClerkUnavailableError,
  type Clerk,
  type ClerkIdentity,
} from "../auth/clerk.js";
import type { AppConfig } from "../config/app-config.js";
import { parsePythonInt } from "../config/python-number.js";
import { HttpStatusError } from "../http-status-error.js";
import { withReplyTimeout, type RedisClient } from "../redis/redis-client.js";
import { hashIp, trackingId } from "./client-identity.js";
import type { ProAccess } from "./pro-access.js";

const logger = new Logger("UsageTracker");

const USAGE_TTL_SECONDS = 365 * 24 * 60 * 60;

export class QuotaUnavailableError extends HttpStatusError {
  readonly status = 503;

  constructor(options?: ErrorOptions) {
    super("Usage tracking is temporarily unavailable", options);
  }
}

export interface AnonymousCaller {
  readonly kind: "anonymous";
  readonly trackingId: string;
  readonly ipHash: string;
}

export interface FreeCaller {
  readonly kind: "free";
  readonly userId: string;
}

export interface ProCaller {
  readonly kind: "pro";
  readonly userId: string;
}

export type Caller = AnonymousCaller | FreeCaller | ProCaller;

export type MeteredCaller = AnonymousCaller | FreeCaller;

export interface CallerCredentials {
  readonly authorization: string | undefined;
  readonly sessionCookie: string | undefined;
  readonly trackingCookie: string | undefined;
  readonly clientIp: string;
}

export type UsageStatus =
  | {
      readonly kind: "unlimited";
      readonly allowed: true;
      readonly caller: ProCaller;
    }
  | {
      readonly kind: "metered";
      readonly allowed: boolean;
      readonly remaining: number;
      readonly limit: number;
      readonly caller: MeteredCaller;
    };

export function quotaHeaders(status: UsageStatus): Record<string, string> {
  if (status.kind === "unlimited") return {};
  return {
    "X-RateLimit-Remaining": String(status.remaining),
    "X-RateLimit-Limit": String(status.limit),
  };
}

function usageKeys(caller: MeteredCaller): string[] {
  return caller.kind === "anonymous"
    ? [
        `anon:${caller.trackingId}:usage_count`,
        `anon:ip:${caller.ipHash}:usage_count`,
      ]
    : [`user:${caller.userId}:usage_count`];
}

function storedCount(value: string | null): number {
  if (!value) return 0;
  const count = parsePythonInt(value);
  if (count === undefined) {
    throw new Error(`Usage counter is not an integer: ${value}`);
  }
  return count;
}

export class Quota {
  constructor(
    private readonly redis: RedisClient | null,
    private readonly clerk: Clerk,
    private readonly proAccess: ProAccess,
    private readonly limits: Pick<
      AppConfig["quota"],
      "anonLimit" | "freeUserLimit"
    >,
  ) {}

  async resolveCaller(credentials: CallerCredentials): Promise<Caller> {
    const identity = await this.#identify(credentials);
    if (!identity) {
      return {
        kind: "anonymous",
        trackingId: trackingId(credentials.trackingCookie),
        ipHash: hashIp(credentials.clientIp),
      };
    }
    const isPro = await this.proAccess.isPro(
      identity.userId,
      identity.tierHint,
    );
    return { kind: isPro ? "pro" : "free", userId: identity.userId };
  }

  async #identify({
    authorization,
    sessionCookie,
  }: CallerCredentials): Promise<ClerkIdentity | undefined> {
    if (authorization?.startsWith("Bearer ")) {
      const identity = await this.#authenticate(
        authorization.slice("Bearer ".length),
        this.clerk.validatesAzp,
        "Bearer token",
      );
      if (identity) return identity;
    }
    if (sessionCookie) {
      return this.#authenticate(sessionCookie, false, "Session cookie");
    }
    return undefined;
  }

  async #authenticate(
    token: string,
    validateAzp: boolean,
    source: string,
  ): Promise<ClerkIdentity | undefined> {
    try {
      return await this.clerk.authenticateLocal(token, validateAzp);
    } catch (error) {
      if (error instanceof ClerkUnavailableError) {
        logger.warn(
          `${source} verification temporarily unavailable; falling back to anonymous quota`,
        );
        return undefined;
      }
      if (error instanceof ClerkAuthError) return undefined;
      throw error;
    }
  }

  async check(caller: Caller): Promise<UsageStatus> {
    const redis = this.#requireRedis();
    if (caller.kind === "pro")
      return { kind: "unlimited", allowed: true, caller };

    let stored: (string | null)[];
    try {
      stored = await withReplyTimeout(redis.mGet(usageKeys(caller)));
    } catch (cause) {
      logger.error(`Redis error checking usage: ${String(cause)}`);
      throw new QuotaUnavailableError({ cause });
    }
    const count = Math.max(...stored.map(storedCount));
    return this.#metered(caller, count, count < this.#limit(caller));
  }

  async charge(caller: Caller): Promise<UsageStatus> {
    const redis = this.#requireRedis();
    if (caller.kind === "pro")
      return { kind: "unlimited", allowed: true, caller };

    let replies: unknown[];
    try {
      const transaction = redis.multi();
      for (const key of usageKeys(caller)) {
        transaction.incr(key).expire(key, USAGE_TTL_SECONDS);
      }
      replies = await withReplyTimeout(transaction.exec());
    } catch (cause) {
      logger.error(`Redis error reserving usage: ${String(cause)}`);
      throw new QuotaUnavailableError({ cause });
    }
    const counts = replies.filter((_, index) => index % 2 === 0).map(Number);
    const count = Math.max(...counts);
    return this.#metered(caller, count, count <= this.#limit(caller));
  }

  #requireRedis(): RedisClient {
    if (this.redis) return this.redis;
    logger.warn("Redis not available, denying metered request");
    throw new QuotaUnavailableError();
  }

  #limit(caller: MeteredCaller): number {
    return caller.kind === "anonymous"
      ? this.limits.anonLimit
      : this.limits.freeUserLimit;
  }

  #metered(
    caller: MeteredCaller,
    count: number,
    allowed: boolean,
  ): UsageStatus {
    const limit = this.#limit(caller);
    return {
      kind: "metered",
      allowed,
      remaining: Math.max(0, limit - count),
      limit,
      caller,
    };
  }
}
