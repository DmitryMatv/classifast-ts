import type { NestExpressApplication } from "@nestjs/platform-express";
import { Test } from "@nestjs/testing";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import request from "supertest";
import { vi } from "vitest";
import { AppModule } from "../src/app.module.js";
import {
  ClassificationError,
  type ClassificationResult,
  type RerankStatus,
} from "../src/classifier/classification.js";
import { ClassificationQueueFull } from "../src/classifier/classification-queue.js";
import {
  ClassificationService,
  type Authorize,
  type ClassificationOutcome,
  type ClassificationRequest,
} from "../src/classifier/classification-service.js";
import {
  buildClassifierConfig,
  classifierPage,
  getAllCollectionNames,
} from "../src/classifier/classifier-config.js";
import { GoogleCrawlerVerifier } from "../src/crawlers/google-crawlers.js";
import {
  cacheHeaders,
  type CacheProfileName,
} from "../src/http/cache-profiles.js";
import {
  configureHttpApp,
  createHttpAdapter,
  HTTP_APP_OPTIONS,
} from "../src/http-app.js";
import { REDIS_CONNECTION } from "../src/redis/redis-client.js";
import {
  Quota,
  QuotaUnavailableError,
  type Caller,
  type UsageStatus,
} from "../src/usage/quota.js";
import { jinjaEscape } from "../src/web/render.js";
import { Results } from "../src/web/results.js";
import {
  resultsApiPath,
  type ResultsResponse,
} from "../src/web/results-api.js";
import {
  startQdrantServer,
  validCollections,
  type QdrantServer,
} from "./support/qdrant-server.js";

const VERSION = classifierPage("UNSPSC").versions[0]!;
const ANON_LIMIT = 10;
const SIGNED_IN_LIMIT = 50;

const RESULTS: ClassificationResult[] = [
  {
    id: 1,
    score: 0.9,
    payload: {
      original_id: "43211503",
      id_level: "Commodity",
      class_name: "Notebook computers",
      definition: "A small portable computer",
      original_id_normalized: "43211503",
    },
    rerankRelevanceScore: 0.9,
  },
  { id: "two", score: 0.5, payload: { original_id: 4321, extra: [1] } },
];

type ClassifyMode = "success" | "queue_full" | "failure" | "missing_version";
type QuotaMode =
  | "allowed"
  | "denied_anonymous"
  | "denied_signed_in"
  | "unavailable"
  | "charge_denied";

const fake = {
  crawler: false,
  classify: "success" as ClassifyMode,
  quota: "allowed" as QuotaMode,
  rerank: "applied" as RerankStatus,
  events: [] as string[],
};

function fakeClassify(
  _signal: AbortSignal,
  request: ClassificationRequest,
  authorize?: Authorize,
): Promise<ClassificationOutcome> {
  fake.events.push("classify");
  return (async () => {
    if (fake.classify === "queue_full") throw new ClassificationQueueFull();
    await authorize?.();
    if (fake.classify === "failure") throw new Error("fake failure");
    if (fake.classify === "missing_version") {
      throw new ClassificationError(
        404,
        `Version '${request.version}' not found`,
      );
    }
    return {
      results: RESULTS,
      versionName: request.version!,
      version: {
        collectionName: "fake",
        baseUrl: "https://example.test/",
        tooltip: "Version note",
      },
      query: request.query,
      elapsedSeconds: 1.25,
      rerank: fake.rerank,
      idSearch: "ok",
    };
  })();
}

function usage(caller: Caller, allowed: boolean): UsageStatus {
  if (caller.kind === "pro") throw new Error("the fake quota has no Pro");
  const limit = caller.kind === "anonymous" ? ANON_LIMIT : SIGNED_IN_LIMIT;
  return {
    kind: "metered",
    allowed,
    remaining: allowed ? limit - 1 : 0,
    limit,
    caller,
  };
}

const fakeQuota: Pick<Quota, "resolveCaller" | "check" | "charge"> = {
  resolveCaller: () => {
    fake.events.push("caller");
    return Promise.resolve(
      fake.quota === "denied_signed_in"
        ? { kind: "free", userId: "user-1" }
        : { kind: "anonymous", trackingId: "fake", ipHash: "fake" },
    );
  },
  check: (caller) => {
    fake.events.push("check");
    if (fake.quota === "unavailable") {
      return Promise.reject(new QuotaUnavailableError());
    }
    return Promise.resolve(usage(caller, !fake.quota.startsWith("denied")));
  },
  charge: (caller) => {
    fake.events.push("charge");
    return Promise.resolve(usage(caller, fake.quota !== "charge_denied"));
  },
};

let qdrant: QdrantServer;
let app: NestExpressApplication;

beforeAll(async () => {
  for (const name of [
    "HF_TOKEN",
    "HF_EMBEDDING_DIMS",
    "QDRANT_URL",
    "QDRANT_HOST",
    "QDRANT_PORT",
    "QDRANT_API_KEY",
  ]) {
    vi.stubEnv(name, undefined);
  }
  qdrant = await startQdrantServer(
    validCollections(getAllCollectionNames(buildClassifierConfig({}))),
  );
  vi.stubEnv("QDRANT_URL", qdrant.url);
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(ClassificationService)
    .useValue({ classify: fakeClassify })
    .overrideProvider(GoogleCrawlerVerifier)
    .useValue({
      isVerified: () => {
        fake.events.push("crawler");
        return Promise.resolve(fake.crawler);
      },
    })
    .overrideProvider(Quota)
    .useValue(fakeQuota)
    .overrideProvider(REDIS_CONNECTION)
    .useValue(null)
    .compile();
  app = moduleRef.createNestApplication<NestExpressApplication>(
    createHttpAdapter(),
    HTTP_APP_OPTIONS,
  );
  configureHttpApp(app);
  await app.init();
});

afterAll(async () => {
  await app?.close();
  await qdrant?.close();
  vi.unstubAllEnvs();
});

beforeEach(() => {
  fake.crawler = false;
  fake.classify = "success";
  fake.quota = "allowed";
  fake.rerank = "applied";
  fake.events = [];
});

function apiPath(
  query: string,
  options: { topK?: number; enhance?: boolean } = {},
) {
  return resultsApiPath("UNSPSC", {
    query,
    version: VERSION,
    topK: options.topK ?? 10,
    enhance: options.enhance ?? false,
  });
}

async function get(path: string): Promise<request.Response> {
  const response = await request(app.getHttpServer())
    .get(path)
    .set("Accept-Encoding", "identity");
  expect(response.headers["set-cookie"]).toBeUndefined();
  return response;
}

async function getJson(
  path: string,
): Promise<{ response: request.Response; body: ResultsResponse }> {
  const response = await get(path);
  expect(response.headers["content-type"]).toBe(
    "application/json; charset=utf-8",
  );
  return { response, body: response.body as ResultsResponse };
}

function expectProfile(response: request.Response, name: CacheProfileName) {
  const profile = cacheHeaders(name);
  expect({
    cacheControl: response.headers["cache-control"],
    cloudflare: response.headers["cloudflare-cdn-cache-control"],
  }).toEqual({
    cacheControl: profile["Cache-Control"],
    cloudflare: profile["Cloudflare-CDN-Cache-Control"],
  });
}

describe("results", () => {
  it("answers 200 with the formatted results, cacheable at the edge", async () => {
    const { response, body } = await getJson(apiPath("laptop computer"));
    expect(response.status).toBe(200);
    expectProfile(response, "CLASSIFICATION_RESULT");
    expect(response.headers["cache-tag"]).toBe("classification-results");
    expect(response.headers["hx-push-url"]).toBeUndefined();
    expect(response.headers["x-ratelimit-limit"]).toBeUndefined();
    if (body.kind !== "results") throw new Error(`got ${body.kind}`);
    expect(
      body.results.map(({ codeTokens }) =>
        codeTokens.map((token) => token.char).join(""),
      ),
    ).toEqual(["43211503", "4321"]);
    expect({
      ...body,
      results: body.results.map((result) => ({
        ...result,
        codeTokens: undefined,
      })),
    }).toEqual({
      kind: "results",
      version: VERSION,
      query: "laptop computer",
      results: [
        {
          originalId: "43211503",
          detailUrl: "https://example.test/43211503",
          idLevel: "Commodity",
          className: "Notebook computers",
          definition: "A small portable computer",
          scoreLabel: "90.0",
          scoreWidth: "90.00",
        },
        {
          originalId: "4321",
          detailUrl: "https://example.test/4321",
          definition: "",
          scoreLabel: "50.0",
          scoreWidth: "50.00",
        },
      ],
      tooltip: "Version note",
      elapsed: "1.25",
      url: "/UNSPSC/laptop_computer/",
      title: "UNSPSC codes for 'Laptop Computer'",
    });
  });

  it("keeps a degraded classification out of every cache", async () => {
    fake.rerank = "failed";
    const { response, body } = await getJson(apiPath("laptop computer"));
    expect(response.status).toBe(200);
    expect(body.kind).toBe("results");
    expectProfile(response, "NO_STORE");
    expect(response.headers["cache-tag"]).toBe("classification-results");
  });

  it("checks quota and admits to the queue in the fragment's order", async () => {
    const fragment = await get(
      `/UNSPSC/fragment?product_description=laptop&version=${encodeURIComponent(VERSION)}`,
    );
    expect(fragment.status).toBe(200);
    const fragmentEvents = fake.events;
    fake.events = [];
    await getJson(apiPath("laptop"));
    expect(fake.events).toEqual([
      "crawler",
      "caller",
      "check",
      "classify",
      "charge",
    ]);
    expect(fake.events).toEqual(fragmentEvents);
  });

  it("charges a verified crawler nothing", async () => {
    fake.crawler = true;
    const { response } = await getJson(apiPath("laptop"));
    expect(response.status).toBe(200);
    expect(fake.events).toEqual(["crawler", "classify"]);
  });

  it("compresses the JSON body", async () => {
    const response = await request(app.getHttpServer())
      .get(apiPath("laptop"))
      .set("Accept-Encoding", "gzip");
    expect(response.headers["content-encoding"]).toBe("gzip");
    expect(response.headers["vary"]).toContain("Accept-Encoding");
    // superagent gunzips the body before parsing it.
    expect((response.body as ResultsResponse).kind).toBe("results");
  });
});

describe("the results, url and title match the fragment's", () => {
  it.each<[string, string, { topK?: number; enhance?: boolean }]>([
    ["the default options", "laptop computer", {}],
    ["a non-default top_k", "laptop computer", { topK: 3 }],
    ["an enhanced query", "office chair", { enhance: true }],
    ["a hyphenated sitemap query", "laptop-computer", {}],
    ["a query with quotes", "Bob's <b> & co", {}],
  ])("for %s", async (_, query, options) => {
    const { body } = await getJson(apiPath(query, options));
    if (body.kind !== "results") throw new Error(`got ${body.kind}`);

    const fragmentQuery = new URLSearchParams({
      product_description: query,
      version: VERSION,
      top_k: String(options.topK ?? 10),
      ...(options.enhance ? { enhance_query: "1" } : {}),
    });
    const fragment = await get(`/UNSPSC/fragment?${fragmentQuery.toString()}`);
    expect(fragment.status).toBe(200);
    expect(body.url).toBe(fragment.headers["hx-push-url"]);
    // The classifier page's client renders Results from this body.
    expect(fragment.text).toContain(
      renderToStaticMarkup(
        createElement(Results, { ...body, query, loaded: false }),
      ),
    );
    expect(fragment.text).toContain(
      `<title id="page-title" hx-swap-oob="true">${jinjaEscape(body.title)}</title>`,
    );
  });

  it("uses the sitemap's underscore path for a hyphenated query", async () => {
    const { body } = await getJson(apiPath("laptop-computer"));
    expect(body).toMatchObject({ url: "/UNSPSC/laptop_computer/" });
  });
});

describe("paywall", () => {
  it("answers an anonymous caller over quota with 402 before the queue", async () => {
    fake.quota = "denied_anonymous";
    const { response, body } = await getJson(apiPath("laptop"));
    expect(response.status).toBe(402);
    expectProfile(response, "NO_STORE");
    expect(response.headers["cache-tag"]).toBeUndefined();
    expect(response.headers["x-ratelimit-limit"]).toBe(String(ANON_LIMIT));
    expect(response.headers["x-ratelimit-remaining"]).toBe("0");
    expect(body).toEqual({
      kind: "paywall",
      signedIn: false,
      limit: ANON_LIMIT,
      url: "/UNSPSC/laptop/",
      title: "UNSPSC codes for 'Laptop'",
    });
    expect(fake.events).toEqual(["crawler", "caller", "check"]);
  });

  it("tells a signed-in caller apart", async () => {
    fake.quota = "denied_signed_in";
    const { response, body } = await getJson(apiPath("laptop"));
    expect(response.status).toBe(402);
    expect(body).toEqual({
      kind: "paywall",
      signedIn: true,
      limit: SIGNED_IN_LIMIT,
      url: "/UNSPSC/laptop/",
      title: "UNSPSC codes for 'Laptop'",
    });
  });

  it("answers a charge lost to a racing request with 402", async () => {
    fake.quota = "charge_denied";
    const { response, body } = await getJson(apiPath("laptop"));
    expect(response.status).toBe(402);
    expect(body.kind).toBe("paywall");
    expect(fake.events).toEqual([
      "crawler",
      "caller",
      "check",
      "classify",
      "charge",
    ]);
  });
});

describe("busy", () => {
  it.each([
    [
      "queue_full",
      "allowed",
      "Classification queue is full. Please try again later.",
    ],
    ["success", "unavailable", "Usage tracking is temporarily unavailable"],
  ] as const)(
    "classify %s with quota %s answers 503",
    async (classify, quota, message) => {
      fake.classify = classify;
      fake.quota = quota;
      const { response, body } = await getJson(apiPath("laptop"));
      expect(response.status).toBe(503);
      expectProfile(response, "NO_STORE");
      expect(response.headers["cache-tag"]).toBeUndefined();
      expect(body).toEqual({ kind: "busy", message });
    },
  );
});

describe("errors", () => {
  it.each([
    ["an unexpected failure", "failure", 500, "Error processing request"],
    [
      "a missing version",
      "missing_version",
      404,
      `Version '${VERSION}' not found`,
    ],
  ] as const)("%s answers %i", async (_, classify, status, message) => {
    fake.classify = classify;
    const { response, body } = await getJson(apiPath("laptop"));
    expect(response.status).toBe(status);
    expectProfile(response, "NO_STORE");
    expect(response.headers["cache-tag"]).toBeUndefined();
    expect(body).toEqual({ kind: "error", message });
  });

  it.each([
    [
      "an unknown type",
      "/api/results/NOPE?product_description=laptop",
      404,
      "Classifier 'NOPE' not found",
    ],
    [
      "a removed type",
      "/api/results/GMDN?product_description=laptop",
      410,
      "Classifier 'GMDN' is no longer available",
    ],
    [
      "a missing description",
      "/api/results/UNSPSC?top_k=3",
      422,
      "Invalid query parameters",
    ],
    [
      "an out-of-range top_k",
      "/api/results/UNSPSC?product_description=laptop&top_k=0",
      422,
      "Invalid query parameters",
    ],
    [
      "an empty description",
      "/api/results/UNSPSC?product_description=",
      422,
      "Please enter a query",
    ],
  ])("%s answers %i before any check", async (_, path, status, message) => {
    const { response, body } = await getJson(path);
    expect(response.status).toBe(status);
    expectProfile(response, "NO_STORE");
    expect(body).toEqual({ kind: "error", message });
    expect(fake.events).toEqual([]);
  });
});

describe("HEAD", () => {
  it("refuses where GET would classify, before any check", async () => {
    const response = await request(app.getHttpServer()).head(apiPath("laptop"));
    expect(response.status).toBe(405);
    expect(response.headers["allow"]).toBe("GET");
    expectProfile(response, "NO_STORE");
    expect(response.text ?? "").toBe("");
    expect(fake.events).toEqual([]);
  });
});
