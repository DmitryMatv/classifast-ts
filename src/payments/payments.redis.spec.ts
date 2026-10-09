import type { NestExpressApplication } from "@nestjs/platform-express";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { inject, vi } from "vitest";
import {
  activeSession,
  clerkWithKey,
  signToken,
  type FakeClerkHttp,
  type SigningKey,
} from "../../test/support/clerk.js";
import {
  nonProProductId,
  nonProSubscriptionEvent,
  signWebhook,
} from "../../test/contract/support/polar.js";
import { connectTestRedis, uniqueId } from "../../test/support/redis.js";
import { Clerk } from "../auth/clerk.js";
import { APP_CONFIG, parseAppConfig } from "../config/app-config.js";
import { ConfigModule } from "../config/config.module.js";
import {
  configureHttpApp,
  createHttpAdapter,
  HTTP_APP_OPTIONS,
} from "../http-app.js";
import { cacheHeaders } from "../http/cache-profiles.js";
import type { RedisClient } from "../redis/redis-client.js";
import { ClerkUsers } from "./clerk-users.js";
import { MAPPING_PRODUCTS } from "./mapping-products.js";
import { PaymentsModule } from "./payments.module.js";
import { PolarCheckouts } from "./polar-checkouts.js";

const WEBHOOK_SECRET =
  "whsec_" + Buffer.from("redis-spec-key").toString("base64");
const CHECKOUT_LIMIT = 2;
const mapping = [...MAPPING_PRODUCTS.values()][0]!;

let app: NestExpressApplication;
let redis: RedisClient;
let clerkHttp: FakeClerkHttp;
let key: SigningKey;
const polarFetch = vi.fn<typeof fetch>();
const clerkApiFetch = vi.fn<typeof fetch>();

beforeAll(async () => {
  const { hostname, port } = new URL(inject("redisUrl"));
  const clerk = await clerkWithKey();
  clerkHttp = clerk.http;
  key = clerk.key;
  const moduleRef = await Test.createTestingModule({
    imports: [ConfigModule, PaymentsModule],
  })
    .overrideProvider(APP_CONFIG)
    .useValue(
      parseAppConfig({
        REDIS_HOST: hostname,
        REDIS_PORT: port,
        CHECKOUT_RATE_LIMIT: String(CHECKOUT_LIMIT),
        POLAR_ACCESS_TOKEN: "polar-token",
        POLAR_PRO_PRODUCT_ID: nonProProductId,
        POLAR_WEBHOOK_SECRET: WEBHOOK_SECRET,
      }),
    )
    .overrideProvider(Clerk)
    .useValue(clerk.clerk)
    .overrideProvider(ClerkUsers)
    .useValue(new ClerkUsers("sk_test", clerkApiFetch))
    .overrideProvider(PolarCheckouts)
    .useValue(new PolarCheckouts(polarFetch))
    .compile();
  app = moduleRef.createNestApplication<NestExpressApplication>(
    createHttpAdapter(),
    HTTP_APP_OPTIONS,
  );
  configureHttpApp(app);
  await app.init();
  redis = await connectTestRedis();
});

afterAll(async () => {
  await app.close();
  await redis.close();
});

beforeEach(() => {
  polarFetch.mockReset();
  polarFetch.mockImplementation(async () =>
    Response.json({ url: "https://polar.example/checkout" }, { status: 201 }),
  );
  clerkApiFetch.mockReset();
  clerkApiFetch.mockImplementation(async () => Response.json({}));
});

function expectNoStore(response: request.Response) {
  for (const [name, value] of Object.entries(cacheHeaders("NO_STORE"))) {
    expect(response.headers[name.toLowerCase()], name).toBe(value);
  }
}

const post = (path: string, ip: string) =>
  request(app.getHttpServer())
    .post(path)
    .set("cf-connecting-ip", ip)
    .set("content-type", "application/json");

describe("checkout routes", () => {
  it("rate-limits the mapping checkout per IP before calling Polar", async () => {
    const ip = uniqueId("ip");
    const body = {
      slug: mapping.slug,
      return_url: `http://testserver/mapping/${mapping.slug}/`,
    };
    const replies = [];
    for (let attempt = 0; attempt <= CHECKOUT_LIMIT; attempt += 1) {
      replies.push(
        await post("/api/create-mapping-checkout", ip)
          .set("host", "testserver")
          .send(body),
      );
    }
    expect(replies.map((reply) => reply.status)).toEqual([200, 200, 429]);
    expect(replies[0]?.body).toEqual({ url: "https://polar.example/checkout" });
    expect(replies[2]?.body).toEqual({
      detail: "Too many checkout requests. Please try again later.",
    });
    replies.forEach(expectNoStore);
    expect(polarFetch).toHaveBeenCalledTimes(CHECKOUT_LIMIT);
  });

  it("counts unauthenticated Pro checkouts against the IP", async () => {
    const ip = uniqueId("ip");
    const statuses = [];
    for (let attempt = 0; attempt <= CHECKOUT_LIMIT; attempt += 1) {
      const reply = await post("/api/create-checkout", ip).send({});
      statuses.push([reply.status, reply.body]);
      expectNoStore(reply);
    }
    expect(statuses).toEqual([
      [401, { detail: "Missing Authorization header" }],
      [401, { detail: "Missing Authorization header" }],
      [429, { detail: "Too many checkout requests. Please try again later." }],
    ]);
  });

  it("creates a Pro checkout for a Clerk session user", async () => {
    clerkHttp.session("sess_123", () => activeSession("user_123"));
    const reply = await post("/api/create-checkout", uniqueId("ip"))
      .set("host", "classifast.test")
      .set("authorization", `Bearer ${await signToken(key)}`)
      .send({ return_url: "http://classifast.test/NAICS/?q=bolts" });

    expect(reply.status).toBe(200);
    expect(reply.body).toEqual({ url: "https://polar.example/checkout" });
    expectNoStore(reply);
    expect(JSON.parse(polarFetch.mock.calls[0]?.[1]?.body as string)).toEqual({
      products: [nonProProductId],
      metadata: { user_id: "user_123" },
      success_url: "http://classifast.test/NAICS/?q=bolts&checkout=success",
      customer_email: null,
      customer_name: null,
    });
  });
});

function subscriptionEvent(
  userId: string,
  type: string,
  status: string,
): string {
  const event = nonProSubscriptionEvent();
  return JSON.stringify({
    ...event,
    type,
    data: { ...event.data, status, metadata: { user_id: userId } },
  });
}

const sendWebhook = (
  body: string,
  headers = signWebhook(body, WEBHOOK_SECRET),
) =>
  request(app.getHttpServer())
    .post("/api/webhooks/polar")
    .set(headers)
    .send(body);

describe("POST /api/webhooks/polar", () => {
  it("updates Clerk, then caches Pro and opens checkout grace", async () => {
    const userId = uniqueId("user");
    const reply = await sendWebhook(
      subscriptionEvent(userId, "subscription.active", "active"),
    );

    expect(reply.status).toBe(200);
    expect(reply.body).toEqual({ status: "received" });
    expectNoStore(reply);
    const [url, init] = clerkApiFetch.mock.calls[0]!;
    expect(url).toBe(`https://api.clerk.com/v1/users/${userId}/metadata`);
    expect(init?.method).toBe("PATCH");
    expect(init?.headers).toMatchObject({
      Authorization: "Bearer sk_test",
      "Clerk-API-Version": "2025-11-10",
    });
    expect(JSON.parse(init?.body as string)).toEqual({
      public_metadata: { tier: "pro" },
    });
    expect(await redis.get(`user_tier:${userId}`)).toBe("pro");
    expect(await redis.ttl(`user_tier:${userId}`)).toBe(3600);
    expect(await redis.get(`checkout_grace:${userId}`)).toBe("1");
  });

  it("caches free without grace when the subscription ends", async () => {
    const userId = uniqueId("user");
    const reply = await sendWebhook(
      subscriptionEvent(userId, "subscription.updated", "canceled"),
    );

    expect(reply.status).toBe(200);
    expect(await redis.get(`user_tier:${userId}`)).toBe("free");
    expect(await redis.exists(`checkout_grace:${userId}`)).toBe(0);
  });

  it("answers 502 and writes nothing when Clerk rejects the update", async () => {
    clerkApiFetch.mockImplementation(
      async () => new Response(null, { status: 500 }),
    );
    const userId = uniqueId("user");
    const reply = await sendWebhook(
      subscriptionEvent(userId, "subscription.active", "active"),
    );

    expect(reply.status).toBe(502);
    expect(reply.body).toEqual({ detail: "Failed to update user metadata" });
    expect(await redis.exists(`user_tier:${userId}`)).toBe(0);
    expect(await redis.exists(`checkout_grace:${userId}`)).toBe(0);
  });

  it("verifies the raw bytes it received", async () => {
    const userId = uniqueId("user");
    const body = subscriptionEvent(userId, "subscription.active", "active");
    const reply = await sendWebhook(
      `${body} `,
      signWebhook(body, WEBHOOK_SECRET),
    );

    expect(reply.status).toBe(403);
    expect(reply.body).toEqual({ detail: "Invalid webhook signature" });
    expectNoStore(reply);
    expect(clerkApiFetch).not.toHaveBeenCalled();
    expect(await redis.exists(`user_tier:${userId}`)).toBe(0);
  });
});
