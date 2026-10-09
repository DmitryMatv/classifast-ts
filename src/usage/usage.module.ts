import { Module } from "@nestjs/common";
import { Clerk } from "../auth/clerk.js";
import { APP_CONFIG, type AppConfig } from "../config/app-config.js";
import { CheckoutRateLimit } from "../rate-limit/checkout-rate-limit.js";
import {
  REDIS_CONNECTION,
  type RedisConnection,
} from "../redis/redis-client.js";
import { RedisModule } from "../redis/redis.module.js";
import { ProAccess } from "./pro-access.js";
import { Quota } from "./quota.js";

@Module({
  imports: [RedisModule],
  providers: [
    {
      provide: Clerk,
      inject: [APP_CONFIG],
      useFactory: ({ clerk }: AppConfig) => new Clerk(clerk),
    },
    {
      provide: ProAccess,
      inject: [REDIS_CONNECTION, Clerk, APP_CONFIG],
      useFactory: (
        redis: RedisConnection | null,
        clerk: Clerk,
        config: AppConfig,
      ) => new ProAccess(redis, clerk, config.quota.checkoutGraceTtlSeconds),
    },
    {
      provide: Quota,
      inject: [REDIS_CONNECTION, Clerk, ProAccess, APP_CONFIG],
      useFactory: (
        redis: RedisConnection | null,
        clerk: Clerk,
        proAccess: ProAccess,
        config: AppConfig,
      ) => new Quota(redis, clerk, proAccess, config.quota),
    },
    {
      provide: CheckoutRateLimit,
      inject: [REDIS_CONNECTION, APP_CONFIG],
      useFactory: (redis: RedisConnection | null, config: AppConfig) =>
        new CheckoutRateLimit(redis, config.quota),
    },
  ],
  exports: [Clerk, ProAccess, Quota, CheckoutRateLimit],
})
export class UsageModule {}
