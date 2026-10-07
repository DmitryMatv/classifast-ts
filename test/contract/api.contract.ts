import { z } from "zod";
import { contract, fullMode } from "./support/env.js";
import {
  expectCacheProfile,
  expectStatus,
  freshClientIp,
  parseJson,
  send,
  type Method,
} from "./support/http.js";
import { nonProSubscriptionEvent, signWebhook } from "./support/polar.js";

type JsonCase = {
  name: string;
  path: string;
  method?: Method;
  headers?: Record<string, string>;
  body?: string;
  status: number;
  json: unknown;
};

async function expectJsonCase(jsonCase: JsonCase) {
  const reply = await send(jsonCase.path, {
    method: jsonCase.method ?? "GET",
    headers: { "cf-connecting-ip": freshClientIp(), ...jsonCase.headers },
    ...(jsonCase.body === undefined ? {} : { body: jsonCase.body }),
  });
  expectStatus(reply, jsonCase.status);
  expect(parseJson(reply)).toEqual(jsonCase.json);
}

const anyTimestamp = expect.any(Number);
const json = { "content-type": "application/json" };
const unavailable = { detail: "Service temporarily unavailable" };

// Public mode runs Python without lifespan, Redis, or secrets: every
// dependency reports itself missing.
const unconfiguredCases: JsonCase[] = [
  {
    name: "health without clients",
    path: "/health",
    status: 503,
    json: { detail: "Service Unavailable" },
  },
  {
    name: "RapidAPI ping without clients",
    path: "/api/v1/rapid/ping",
    status: 503,
    json: {
      status: "healthy",
      timestamp: anyTimestamp,
      services: { embedding: "unavailable", database: "unavailable" },
    },
  },
  {
    name: "RapidAPI standards without RAPIDAPI_SECRET",
    path: "/api/v1/rapid/standards",
    status: 503,
    json: { detail: "API authentication not configured" },
  },
  {
    name: "RapidAPI classify without RAPIDAPI_SECRET",
    path: "/api/v1/rapid/classify?query=laptop&standard=UNSPSC",
    status: 503,
    json: { detail: "API authentication not configured" },
  },
  {
    name: "checkout without Redis",
    path: "/api/create-checkout",
    method: "POST",
    headers: json,
    body: "{}",
    status: 503,
    json: unavailable,
  },
  {
    name: "mapping checkout without Redis",
    path: "/api/create-mapping-checkout",
    method: "POST",
    headers: json,
    body: "{}",
    status: 503,
    json: unavailable,
  },
  {
    name: "webhook without POLAR_WEBHOOK_SECRET",
    path: "/api/webhooks/polar",
    method: "POST",
    headers: json,
    body: "{}",
    status: 500,
    json: { detail: "Webhook secret not configured" },
  },
];

describe.runIf(contract.mode === "public")("unconfigured server", () => {
  it.each(unconfiguredCases)("$name", expectJsonCase);
});

// Full-mode cases never send a valid mapping slug or a signed-in user, so
// no case can reach Polar's checkout API.
const configuredCases: JsonCase[] = [
  {
    name: "health",
    path: "/health",
    status: 200,
    json: { status: "healthy" },
  },
  {
    name: "RapidAPI ping",
    path: "/api/v1/rapid/ping",
    status: 200,
    json: {
      status: "healthy",
      timestamp: anyTimestamp,
      services: { embedding: "configured", database: "healthy" },
    },
  },
  {
    name: "RapidAPI without the proxy secret",
    path: "/api/v1/rapid/standards",
    status: 401,
    json: {
      detail: "Missing authentication - use RapidAPI to access this endpoint",
    },
  },
  {
    name: "RapidAPI with a wrong proxy secret",
    path: "/api/v1/rapid/standards",
    headers: { "x-rapidapi-proxy-secret": "contract-wrong-secret" },
    status: 401,
    json: { detail: "Invalid authentication" },
  },
  {
    name: "checkout without Authorization",
    path: "/api/create-checkout",
    method: "POST",
    headers: json,
    body: "{}",
    status: 401,
    json: { detail: "Missing Authorization header" },
  },
  {
    name: "checkout with a non-Bearer Authorization",
    path: "/api/create-checkout",
    method: "POST",
    headers: { ...json, authorization: "Basic abc" },
    body: "{}",
    status: 401,
    json: { detail: "Invalid Authorization header format" },
  },
  {
    name: "mapping checkout without a slug",
    path: "/api/create-mapping-checkout",
    method: "POST",
    headers: json,
    body: "{}",
    status: 400,
    json: { detail: "Missing slug" },
  },
  {
    name: "mapping checkout with an unknown slug",
    path: "/api/create-mapping-checkout",
    method: "POST",
    headers: json,
    body: JSON.stringify({ slug: "contract-unknown-mapping" }),
    status: 404,
    json: { detail: "Mapping product not found" },
  },
  {
    name: "mapping checkout with a foreign return_url",
    path: "/api/create-mapping-checkout",
    method: "POST",
    headers: json,
    body: JSON.stringify({
      slug: "contract-unknown-mapping",
      return_url: "https://example.com/",
    }),
    status: 400,
    json: { detail: "Invalid return_url" },
  },
  {
    name: "unsigned webhook",
    path: "/api/webhooks/polar",
    method: "POST",
    headers: json,
    body: "{}",
    status: 403,
    json: { detail: "Invalid webhook signature" },
  },
];

describe.runIf(fullMode)("configured server", () => {
  it.each(configuredCases)("$name", expectJsonCase);

  it("RapidAPI 401 names the ApiKey scheme", async () => {
    const reply = await send("/api/v1/rapid/standards");
    expect(reply.headers.get("www-authenticate")).toBe("ApiKey");
  });

  // CHECKOUT_RATE_LIMIT defaults to 10 per IP per hour; the counter runs
  // before any other check.
  it("the 11th checkout request from one IP is 429", async () => {
    const ip = freshClientIp();
    const post = () =>
      send("/api/create-mapping-checkout", {
        method: "POST",
        headers: { ...json, "cf-connecting-ip": ip },
        body: "{}",
      });
    for (let attempt = 1; attempt <= 10; attempt += 1) {
      expectStatus(await post(), 400);
    }
    const reply = await post();
    expectStatus(reply, 429);
    expect(parseJson(reply)).toEqual({
      detail: "Too many checkout requests. Please try again later.",
    });
  });
});

const standardsBody = z.object({
  standards: z.record(
    z.string(),
    z.object({
      title: z.string(),
      description: z.string(),
      versions: z.array(z.string()).min(1),
      example: z.string(),
    }),
  ),
  timestamp: z.number(),
});

const classifyBody = z.strictObject({
  query: z.literal("laptop computer"),
  standard: z.literal("unspsc"),
  version: z.string().min(1),
  results: z
    .array(
      z.strictObject({
        code: z.string().min(1),
        name: z.string().min(1),
        score: z.number(),
        url: z.string().nullable(),
      }),
    )
    .length(3),
  processing_time: z.number(),
});

describe.runIf(fullMode && contract.rapidApiSecret)("RapidAPI JSON", () => {
  const authorized = () => ({
    "x-rapidapi-proxy-secret": contract.rapidApiSecret ?? "",
  });

  it("GET /standards", async () => {
    const reply = await send("/api/v1/rapid/standards", {
      headers: authorized(),
    });
    expectStatus(reply, 200);
    expectCacheProfile(reply, "CLASSIFICATION_RESULT");
    expect(
      Object.keys(standardsBody.parse(parseJson(reply)).standards),
    ).toContain("UNSPSC");
  });

  it("GET /classify", async () => {
    const reply = await send(
      "/api/v1/rapid/classify?query=laptop%20computer&standard=unspsc&top_k=3",
      { headers: authorized() },
    );
    expectStatus(reply, 200);
    expectCacheProfile(reply, "CLASSIFICATION_RESULT");
    classifyBody.parse(parseJson(reply));
  });

  it("GET /classify with an empty query is 400", async () => {
    const reply = await send("/api/v1/rapid/classify?query=&standard=UNSPSC", {
      headers: authorized(),
    });
    expectStatus(reply, 400);
    expect(parseJson(reply)).toEqual({ detail: "Query cannot be empty" });
  });

  it("GET /classify with top_k=0 is 422", async () => {
    const reply = await send(
      "/api/v1/rapid/classify?query=laptop&standard=UNSPSC&top_k=0",
      { headers: authorized() },
    );
    expectStatus(reply, 422);
  });
});

type WebhookCase = {
  name: string;
  body: string;
  sign: (body: string, secret: string) => Record<string, string>;
  status: number;
  json: unknown;
};

const validEvent = JSON.stringify(nonProSubscriptionEvent());
const received = { status: "received" };
const invalidSignature = { detail: "Invalid webhook signature" };
const invalidPayload = { detail: "Invalid webhook payload" };
const signed = (body: string, secret: string) => signWebhook(body, secret);

const webhookCases: WebhookCase[] = [
  {
    name: "valid event for another product",
    body: validEvent,
    sign: signed,
    status: 200,
    json: received,
  },
  {
    name: "unknown event type",
    body: JSON.stringify({
      type: "contract.future_event",
      timestamp: "2026-10-02T09:00:00Z",
      api_version: "2026-10",
      data: {},
    }),
    sign: signed,
    status: 200,
    json: received,
  },
  {
    name: "body changed after signing",
    body: validEvent,
    sign: (body, secret) => signWebhook(`${body} `, secret),
    status: 403,
    json: invalidSignature,
  },
  {
    name: "wrong secret",
    body: validEvent,
    sign: (body) => signWebhook(body, "contract-wrong-secret"),
    status: 403,
    json: invalidSignature,
  },
  {
    name: "timestamp over five minutes old",
    body: validEvent,
    sign: (body, secret) =>
      signWebhook(body, secret, Math.floor(Date.now() / 1000) - 3600),
    status: 403,
    json: invalidSignature,
  },
  {
    name: "invalid JSON",
    body: "{",
    sign: signed,
    status: 400,
    json: invalidPayload,
  },
  {
    name: "missing type",
    body: "{}",
    sign: signed,
    status: 400,
    json: invalidPayload,
  },
  {
    name: "non-object",
    body: "[]",
    sign: signed,
    status: 400,
    json: invalidPayload,
  },
  {
    name: "incomplete subscription",
    body: JSON.stringify({ type: "subscription.updated", data: {} }),
    sign: signed,
    status: 400,
    json: invalidPayload,
  },
];

describe.runIf(fullMode && contract.polarWebhookSecret)(
  "signed Polar webhooks",
  () => {
    it.each(webhookCases)("$name", async ({ body, sign, status, json }) => {
      const reply = await send("/api/webhooks/polar", {
        method: "POST",
        headers: sign(body, contract.polarWebhookSecret ?? ""),
        body,
      });
      expectStatus(reply, status);
      expect(parseJson(reply)).toEqual(json);
    });
  },
);
