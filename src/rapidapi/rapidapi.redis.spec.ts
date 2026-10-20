import type { NestExpressApplication } from "@nestjs/platform-express";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { inject } from "vitest";
import { commandsSentBy, uniqueId } from "../../test/support/redis.js";
import { ClassificationService } from "../classifier/classification-service.js";
import { APP_CONFIG, parseAppConfig } from "../config/app-config.js";
import { ConfigModule } from "../config/config.module.js";
import {
  configureHttpApp,
  createHttpAdapter,
  HTTP_APP_OPTIONS,
} from "../http-app.js";
import { QDRANT_CLIENT, QUANTIZATION_CACHE } from "../qdrant/qdrant.module.js";
import {
  REDIS_CONNECTION,
  type RedisConnection,
} from "../redis/redis-client.js";
import { Quota } from "../usage/quota.js";
import { UsageModule } from "../usage/usage.module.js";
import { RapidApiModule } from "./rapidapi.module.js";

const SECRET = "redis-spec-secret";

describe("RapidAPI quota bypass", () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    const { hostname, port } = new URL(inject("redisUrl"));
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule, RapidApiModule, UsageModule],
    })
      .overrideProvider(APP_CONFIG)
      .useValue(
        parseAppConfig({
          REDIS_HOST: hostname,
          REDIS_PORT: port,
          RAPIDAPI_SECRET: SECRET,
          ANON_LIMIT: "1",
        }),
      )
      .overrideProvider(QDRANT_CLIENT)
      .useValue({ getCollections: async () => ({ collections: [] }) })
      .overrideProvider(QUANTIZATION_CACHE)
      .useValue(new Map())
      .overrideProvider(ClassificationService)
      .useValue({
        classify: async () => ({
          results: [],
          versionName: "v1",
          version: { collectionName: "c" },
          query: "widget",
          elapsedSeconds: 0,
        }),
      })
      .compile();
    app = moduleRef.createNestApplication<NestExpressApplication>(
      createHttpAdapter(),
      HTTP_APP_OPTIONS,
    );
    configureHttpApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it("classifies without reading or charging the website quota", async () => {
    const connection = app.get<RedisConnection>(REDIS_CONNECTION);
    const clientIp = uniqueId("ip");
    const classify = () =>
      request(app.getHttpServer())
        .get("/api/v1/rapid/classify?query=widget&standard=UNSPSC")
        .set("X-RapidAPI-Proxy-Secret", SECRET)
        .set("CF-Connecting-IP", clientIp);

    const responses: request.Response[] = [];
    const commands = await commandsSentBy(connection, async () => {
      responses.push(await classify(), await classify());
    });

    expect(commands).toEqual([]);
    for (const response of responses) {
      expect(response.status).toBe(200);
      expect(response.headers["x-ratelimit-remaining"]).toBeUndefined();
      expect(response.headers["x-ratelimit-limit"]).toBeUndefined();
    }
    const quota = app.get(Quota);
    const charged = await commandsSentBy(connection, async () => {
      const caller = await quota.resolveCaller({
        authorization: undefined,
        sessionCookie: undefined,
        trackingCookie: undefined,
        clientIp,
      });
      await quota.charge(caller);
    });
    expect(charged).not.toEqual([]);
  });
});
