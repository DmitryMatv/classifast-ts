import type { NestExpressApplication } from "@nestjs/platform-express";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { vi } from "vitest";
import { AppModule } from "../src/app.module.js";
import { ClassificationError } from "../src/classifier/classification.js";
import { ClassificationQueueFull } from "../src/classifier/classification-queue.js";
import {
  ClassificationService,
  type ClassificationOutcome,
} from "../src/classifier/classification-service.js";
import {
  buildClassifierConfig,
  getAllCollectionNames,
} from "../src/classifier/classifier-config.js";
import {
  cacheHeaders,
  classificationResultHeaders,
  type HeaderRecord,
} from "../src/http/cache-profiles.js";
import {
  configureHttpApp,
  createHttpAdapter,
  HTTP_APP_OPTIONS,
} from "../src/http-app.js";
import {
  startQdrantServer,
  validCollections,
  type QdrantServer,
} from "./support/qdrant-server.js";

const SECRET = "e2e-proxy-secret";
const authorized = { "X-RapidAPI-Proxy-Secret": SECRET };
const UNSPSC_VERSION = "UNSPSC UNv260801.1 (18 March 2025)";
const ENV_NAMES = [
  "HF_TOKEN",
  "QDRANT_URL",
  "QDRANT_HOST",
  "QDRANT_PORT",
  "QDRANT_API_KEY",
  "RAPIDAPI_SECRET",
  "DEBUG_MODE",
] as const;

const classify = vi.fn<ClassificationService["classify"]>();

function outcome(): ClassificationOutcome {
  const config = buildClassifierConfig({}).UNSPSC!;
  return {
    results: [
      {
        id: 7,
        score: 0.91,
        payload: { original_id: "12345", class_name: "Test classification" },
      },
    ],
    versionName: UNSPSC_VERSION,
    version: config.versions[UNSPSC_VERSION]!,
    query: "test widget",
    elapsedSeconds: 0.25,
    rerank: "applied",
  };
}

let qdrant: QdrantServer | undefined;
let app: NestExpressApplication | undefined;

async function boot(env: Partial<Record<(typeof ENV_NAMES)[number], string>>) {
  qdrant = await startQdrantServer(
    validCollections(getAllCollectionNames(buildClassifierConfig({}))),
  );
  for (const name of ENV_NAMES) vi.stubEnv(name, undefined);
  vi.stubEnv("QDRANT_URL", qdrant.url);
  for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value);
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(ClassificationService)
    .useValue({ classify })
    .compile();
  app = moduleRef.createNestApplication<NestExpressApplication>(
    createHttpAdapter(),
    HTTP_APP_OPTIONS,
  );
  configureHttpApp(app);
  await app.init();
  return request(app.getHttpServer());
}

afterEach(async () => {
  await app?.close();
  await qdrant?.close();
  app = undefined;
  qdrant = undefined;
  classify.mockReset();
  vi.unstubAllEnvs();
});

// Like Starlette's, the gzip middleware appends a second Accept-Encoding to
// Vary, so compare Vary as a token set.
function expectHeaders(response: request.Response, headers: HeaderRecord) {
  for (const [name, value] of Object.entries(headers)) {
    const received = response.headers[name.toLowerCase()];
    if (name === "Vary") {
      expect(new Set(received?.split(", ")), name).toEqual(new Set([value]));
    } else {
      expect(received, name).toBe(value);
    }
  }
}

function expectNoCaching(response: request.Response) {
  expect(response.headers["cache-control"]).toBeUndefined();
  expect(response.headers["cloudflare-cdn-cache-control"]).toBeUndefined();
}

function expectJson(response: request.Response) {
  expect(response.headers["content-type"]).toBe("application/json");
  expect(response.headers["set-cookie"]).toBeUndefined();
}

describe("RapidAPI without RAPIDAPI_SECRET (e2e)", () => {
  it.each(["/standards", "/classify?query=laptop&standard=UNSPSC"])(
    "answers %s with 503",
    async (path) => {
      const server = await boot({ HF_TOKEN: "test" });

      const response = await server.get(`/api/v1/rapid${path}`).set(authorized);

      expect(response.status).toBe(503);
      expect(response.body).toEqual({
        detail: "API authentication not configured",
      });
      expect(response.headers["www-authenticate"]).toBeUndefined();
      expectNoCaching(response);
      expectJson(response);
      expect(classify).not.toHaveBeenCalled();
    },
  );
});

describe("RapidAPI proxy secret (e2e)", () => {
  it("asks for the ApiKey scheme when the secret is missing, before validating the query", async () => {
    const server = await boot({ HF_TOKEN: "test", RAPIDAPI_SECRET: SECRET });

    const response = await server.get("/api/v1/rapid/classify?top_k=0");

    expect(response.status).toBe(401);
    expect(response.body).toEqual({
      detail: "Missing authentication - use RapidAPI to access this endpoint",
    });
    expect(response.headers["www-authenticate"]).toBe("ApiKey");
    expectNoCaching(response);
    expectJson(response);
  });

  it.each([
    ["a wrong secret", "e2e-proxy-secreT"],
    ["a longer secret", `${SECRET}-and-more`],
  ])("refuses %s without a challenge", async (_label, secret) => {
    const server = await boot({ HF_TOKEN: "test", RAPIDAPI_SECRET: SECRET });

    const response = await server
      .get("/api/v1/rapid/standards")
      .set("X-RapidAPI-Proxy-Secret", secret);

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ detail: "Invalid authentication" });
    expect(response.headers["www-authenticate"]).toBeUndefined();
    expectNoCaching(response);
    expectJson(response);
  });
});

describe("RapidAPI with the proxy secret (e2e)", () => {
  it("lists the standards with the classification cache profile", async () => {
    const server = await boot({ HF_TOKEN: "test", RAPIDAPI_SECRET: SECRET });

    const response = await server
      .get("/api/v1/rapid/standards")
      .set(authorized);

    expect(response.status).toBe(200);
    expectHeaders(response, classificationResultHeaders());
    expectJson(response);
    expect(Object.keys(response.body.standards)).toEqual(
      Object.keys(buildClassifierConfig({})),
    );
    expect(response.body.standards.UNSPSC).toEqual({
      title: "UNSPSC Code Finder",
      description: expect.stringContaining("UNSPSC"),
      versions: [UNSPSC_VERSION],
      example: "Apple MacBook Air (13-inch, M3, 2024)",
    });
    expect(response.body.timestamp).toBeCloseTo(Date.now() / 1000, -1);
  });

  it("classifies through ClassificationService without quota headers", async () => {
    const server = await boot({ HF_TOKEN: "test", RAPIDAPI_SECRET: SECRET });
    classify.mockResolvedValue(outcome());

    const response = await server
      .get("/api/v1/rapid/classify?query=test%20widget&standard=unspsc&top_k=1")
      .set(authorized);

    expect(response.status).toBe(200);
    expectHeaders(response, classificationResultHeaders());
    expectJson(response);
    expect(response.headers["x-ratelimit-remaining"]).toBeUndefined();
    expect(response.headers["x-ratelimit-limit"]).toBeUndefined();
    expect(response.body).toEqual({
      query: "test widget",
      standard: "unspsc",
      version: UNSPSC_VERSION,
      results: [
        {
          code: "12345",
          name: "Test classification",
          score: 0.91,
          url: "https://usa.databasesets.com/unspsc/search?keywords=12345",
        },
      ],
      processing_time: expect.any(Number),
    });
    expect(classify).toHaveBeenCalledOnce();
    expect(classify).toHaveBeenCalledWith(expect.any(AbortSignal), {
      query: "test widget",
      classifierType: "UNSPSC",
      topK: 1,
    });
    expect(classify.mock.calls[0]).toHaveLength(2);
  });

  it("passes the version through untouched", async () => {
    const server = await boot({ HF_TOKEN: "test", RAPIDAPI_SECRET: SECRET });
    classify.mockResolvedValue(outcome());

    await server
      .get("/api/v1/rapid/classify?query=x&standard=isic&version=ISIC+Rev.+5")
      .set(authorized)
      .expect(200);

    expect(classify).toHaveBeenCalledWith(expect.any(AbortSignal), {
      query: "x",
      classifierType: "ISIC",
      version: "ISIC Rev. 5",
      topK: 3,
    });
  });

  it("answers an out-of-range top_k with FastAPI's 422", async () => {
    const server = await boot({ HF_TOKEN: "test", RAPIDAPI_SECRET: SECRET });

    const response = await server
      .get("/api/v1/rapid/classify?query=laptop&standard=UNSPSC&top_k=0")
      .set(authorized);

    expect(response.status).toBe(422);
    expect(response.body).toEqual({
      detail: [
        {
          type: "greater_than_equal",
          loc: ["query", "top_k"],
          msg: "Input should be greater than or equal to 1",
          input: "0",
          ctx: { ge: 1 },
        },
      ],
    });
    expectNoCaching(response);
    expectJson(response);
    expect(classify).not.toHaveBeenCalled();
  });

  it("answers an empty query with 400", async () => {
    const server = await boot({ HF_TOKEN: "test", RAPIDAPI_SECRET: SECRET });

    const response = await server
      .get("/api/v1/rapid/classify?query=&standard=UNSPSC")
      .set(authorized);

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ detail: "Query cannot be empty" });
    expectNoCaching(response);
  });

  it("answers a full queue with 503 and no-store", async () => {
    const server = await boot({ HF_TOKEN: "test", RAPIDAPI_SECRET: SECRET });
    classify.mockRejectedValue(new ClassificationQueueFull());

    const response = await server
      .get("/api/v1/rapid/classify?query=laptop&standard=UNSPSC")
      .set(authorized);

    expect(response.status).toBe(503);
    expect(response.body).toEqual({
      detail: "Classification queue is full. Please try again later.",
    });
    expectHeaders(response, cacheHeaders("NO_STORE"));
    expectJson(response);
  });

  it("passes a classification error's status and detail through", async () => {
    const server = await boot({ HF_TOKEN: "test", RAPIDAPI_SECRET: SECRET });
    classify.mockRejectedValue(
      new ClassificationError(404, "Classifier type 'NOPE' not found"),
    );

    const response = await server
      .get("/api/v1/rapid/classify?query=laptop&standard=nope")
      .set(authorized);

    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      detail: "Classifier type 'NOPE' not found",
    });
    expectNoCaching(response);
  });

  it.each([
    ["the pipeline throws", () => Promise.reject(new Error("boom"))],
    [
      "a payload code is not a string",
      () =>
        Promise.resolve({
          ...outcome(),
          results: [{ id: 1, score: 1, payload: { original_id: 12345 } }],
        }),
    ],
  ])("answers 500 when %s", async (_label, result) => {
    const server = await boot({ HF_TOKEN: "test", RAPIDAPI_SECRET: SECRET });
    classify.mockImplementation(result);

    const response = await server
      .get("/api/v1/rapid/classify?query=laptop&standard=UNSPSC")
      .set(authorized);

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ detail: "Classification failed" });
    expectNoCaching(response);
  });
});

describe("RapidAPI ping (e2e)", () => {
  it("is public and healthy with embedding configured and Qdrant up", async () => {
    const server = await boot({ HF_TOKEN: "test" });

    const response = await server.get("/api/v1/rapid/ping");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      status: "healthy",
      timestamp: expect.any(Number),
      services: { embedding: "configured", database: "healthy" },
    });
    expectNoCaching(response);
    expectJson(response);
  });

  it("answers 503 without an embedding client", async () => {
    const server = await boot({});

    const response = await server.get("/api/v1/rapid/ping");

    expect(response.status).toBe(503);
    expect(response.body.services).toEqual({
      embedding: "unavailable",
      database: "healthy",
    });
  });

  it("answers 503 when Qdrant goes away after boot", async () => {
    const server = await boot({ HF_TOKEN: "test" });
    await qdrant!.close();
    qdrant = undefined;

    const response = await server.get("/api/v1/rapid/ping");

    expect(response.status).toBe(503);
    expect(response.body.services).toEqual({
      embedding: "configured",
      database: "unhealthy",
    });
  });
});

describe("RapidAPI debug headers (e2e)", () => {
  it("is not available unless DEBUG_MODE is true", async () => {
    const server = await boot({ HF_TOKEN: "test", DEBUG_MODE: "false" });

    const response = await server.get("/api/v1/rapid/debug-headers");

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ detail: "Debug endpoint not available" });
  });

  it("echoes the headers with credentials redacted in DEBUG_MODE", async () => {
    const server = await boot({ HF_TOKEN: "test", DEBUG_MODE: "True" });

    const response = await server
      .get("/api/v1/rapid/debug-headers")
      .set(authorized)
      .set("User-Agent", "e2e-agent")
      .set("Authorization", "Bearer token");

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      received_headers: {
        "x-rapidapi-proxy-secret": "[REDACTED]",
        authorization: "[REDACTED]",
        "user-agent": "e2e-agent",
      },
      user_agent: "e2e-agent",
      host: expect.stringMatching(/^127\.0\.0\.1:\d+$/),
    });
  });
});
