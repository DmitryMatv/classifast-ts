import { Logger } from "@nestjs/common";
import type { AppConfig } from "../config/app-config.js";
import { HttpStatusError } from "../http-status-error.js";
import { withReplyTimeout, type RedisClient } from "../redis/redis-client.js";
import { hashIp } from "../usage/client-identity.js";

const logger = new Logger("CheckoutRateLimit");

export class CheckoutRateLimitedError extends HttpStatusError {
  readonly status = 429;

  constructor() {
    super("Too many checkout requests. Please try again later.");
  }
}

export class CheckoutRateLimitUnavailableError extends HttpStatusError {
  readonly status = 503;

  constructor(options?: ErrorOptions) {
    super("Service temporarily unavailable", options);
  }
}

export class CheckoutRateLimit {
  constructor(
    private readonly redis: RedisClient | null,
    private readonly config: Pick<
      AppConfig["quota"],
      "checkoutRateLimit" | "checkoutRateLimitWindowSeconds"
    >,
  ) {}

  async enforce(clientIp: string): Promise<void> {
    if (!this.redis) {
      logger.error("Redis client unavailable for checkout rate limiting");
      throw new CheckoutRateLimitUnavailableError();
    }
    const ipHash = hashIp(clientIp);
    const key = `checkout_rl:${ipHash}`;

    let count: number;
    try {
      const [incremented] = await withReplyTimeout(
        this.redis
          .multi()
          .incr(key)
          .expire(key, this.config.checkoutRateLimitWindowSeconds, "NX")
          .exec(),
      );
      count = Number(incremented);
    } catch (cause) {
      logger.error(
        `Redis error during checkout rate limiting: ${String(cause)}`,
      );
      throw new CheckoutRateLimitUnavailableError({ cause });
    }

    if (count > this.config.checkoutRateLimit) {
      logger.warn(`Checkout rate limit exceeded for IP hash ${ipHash}`);
      throw new CheckoutRateLimitedError();
    }
  }
}
