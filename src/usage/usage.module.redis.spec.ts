import { Test } from "@nestjs/testing";
import { inject } from "vitest";
import { connectTestRedis, uniqueId } from "../../test/support/redis.js";
import { APP_CONFIG, parseAppConfig } from "../config/app-config.js";
import { ConfigModule } from "../config/config.module.js";
import { REDIS_CLIENT, type RedisClient } from "../redis/redis-client.js";
import { hashIp } from "./client-identity.js";
import { Quota } from "./quota.js";
import { UsageModule } from "./usage.module.js";

describe("UsageModule", () => {
  it("charges the configured Redis and closes it on shutdown", async () => {
    const { hostname, port } = new URL(inject("redisUrl"));
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule, UsageModule],
    })
      .overrideProvider(APP_CONFIG)
      .useValue(
        parseAppConfig({
          REDIS_HOST: hostname,
          REDIS_PORT: port,
          ANON_LIMIT: "3",
        }),
      )
      .compile();
    const app = await moduleRef.init();
    const quota = app.get(Quota);
    const client = app.get<RedisClient>(REDIS_CLIENT);
    const clientIp = uniqueId("ip");

    const caller = await quota.resolveCaller({
      authorization: undefined,
      sessionCookie: undefined,
      trackingCookie: undefined,
      clientIp,
    });
    const status = await quota.charge(caller);
    await app.close();

    const redis = await connectTestRedis();
    expect(status).toMatchObject({ allowed: true, remaining: 2, limit: 3 });
    expect(await redis.get(`anon:ip:${hashIp(clientIp)}:usage_count`)).toBe(
      "1",
    );
    expect(client.isOpen).toBe(false);
    await redis.close();
  });
});
