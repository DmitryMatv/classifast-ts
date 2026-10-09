import { Logger } from "@nestjs/common";
import { RESP_TYPES } from "redis";
import type { Clerk, TierResolution } from "../auth/clerk.js";
import { withReplyTimeout, type RedisClient } from "../redis/redis-client.js";

const logger = new Logger("ProAccess");

const TIER_CACHE_TTL_SECONDS = 3600;
const NEGATIVE_TIER_CACHE_TTL_SECONDS = 60;

const TIER_CACHE_SENTINELS = {
  non_pro: "__sentinel:non_pro",
  explicit_negative: "__sentinel:explicit_negative",
  transient_unavailable: "__sentinel:transient_unavailable",
} as const;

const tierKey = (userId: string) => `user_tier:${userId}`;
const graceKey = (userId: string) => `checkout_grace:${userId}`;

const strictUtf8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

function resolutionFromCache(value: string): TierResolution | undefined {
  switch (value) {
    case "":
      return undefined;
    case "pro":
      return { status: "confirmed_pro" };
    case TIER_CACHE_SENTINELS.non_pro:
      return { status: "confirmed_non_pro" };
    case TIER_CACHE_SENTINELS.explicit_negative:
      return { status: "explicit_negative" };
    case TIER_CACHE_SENTINELS.transient_unavailable:
      return { status: "transient_unavailable" };
    default:
      return { status: "confirmed_non_pro", tier: value };
  }
}

function cacheEntry(resolution: TierResolution): {
  value: string;
  ttlSeconds: number;
} {
  switch (resolution.status) {
    case "confirmed_pro":
      return { value: "pro", ttlSeconds: TIER_CACHE_TTL_SECONDS };
    case "confirmed_non_pro":
      return {
        value: resolution.tier || TIER_CACHE_SENTINELS.non_pro,
        ttlSeconds: TIER_CACHE_TTL_SECONDS,
      };
    case "explicit_negative":
    case "transient_unavailable":
      return {
        value: TIER_CACHE_SENTINELS[resolution.status],
        ttlSeconds: NEGATIVE_TIER_CACHE_TTL_SECONDS,
      };
  }
}

export class ProAccess {
  constructor(
    private readonly redis: RedisClient | null,
    private readonly clerk: Clerk,
    private readonly graceTtlSeconds: number,
  ) {}

  async isPro(userId: string, tierHint: string | undefined): Promise<boolean> {
    if (!this.redis) return false;
    if (await this.#hasActiveGrace(userId)) {
      logger.log(`Checkout grace period active for user ${userId}`);
      return true;
    }
    const resolution = await this.lookUpTier(userId);
    return (
      resolution.status === "confirmed_pro" ||
      (resolution.status === "transient_unavailable" && tierHint === "pro")
    );
  }

  async lookUpTier(userId: string): Promise<TierResolution> {
    if (!userId) return { status: "explicit_negative" };
    const cached = await this.#readTier(userId).catch(() => undefined);
    if (cached) return cached;

    const resolution = await this.clerk.fetchUserTier(userId);
    if (!this.redis) return resolution;
    try {
      const { value, ttlSeconds } = cacheEntry(resolution);
      await withReplyTimeout(
        this.redis.set(tierKey(userId), value, {
          expiration: { type: "EX", value: ttlSeconds },
          condition: "NX",
        }),
      );
      return (await this.#readTier(userId)) ?? resolution;
    } catch {
      return resolution;
    }
  }

  async #readTier(userId: string): Promise<TierResolution | undefined> {
    if (!this.redis) return undefined;
    const raw = await withReplyTimeout(
      this.redis
        .withTypeMapping({ [RESP_TYPES.BLOB_STRING]: Buffer })
        .get(tierKey(userId)),
    );
    return raw === null
      ? undefined
      : resolutionFromCache(strictUtf8.decode(raw));
  }

  async recordSubscriptionTier(userId: string, tier: string): Promise<void> {
    if (!userId || !this.redis) return;
    const value = tier === "pro" ? "pro" : "free";
    try {
      await withReplyTimeout(
        this.redis.setEx(tierKey(userId), TIER_CACHE_TTL_SECONDS, value),
      );
    } catch (error) {
      logger.warn(
        `Failed to sync tier cache for user_id=${userId}: ${String(error)}`,
      );
    }
    if (value !== "pro") return;
    try {
      await withReplyTimeout(
        this.redis.setEx(graceKey(userId), this.graceTtlSeconds, "1"),
      );
    } catch (error) {
      logger.error(`Failed to set checkout grace period: ${String(error)}`);
    }
  }

  async #hasActiveGrace(userId: string): Promise<boolean> {
    if (!userId || !this.redis) return false;
    try {
      return (await withReplyTimeout(this.redis.exists(graceKey(userId)))) > 0;
    } catch (error) {
      logger.error(`Failed to check checkout grace period: ${String(error)}`);
      return false;
    }
  }
}
