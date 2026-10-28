import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { vi } from "vitest";
import { z } from "zod";
import { AppModule } from "../src/app.module.js";
import {
  ClassificationError,
  type IdSearchStatus,
  type RerankStatus,
} from "../src/classifier/classification.js";
import { ClassificationQueueFull } from "../src/classifier/classification-queue.js";
import {
  SITEMAP_RESULT_STORE,
  type ResultStore,
} from "../src/classifier/sitemap-result-cache.js";
import {
  ClassificationService,
  type Authorize,
  type ClassificationOutcome,
  type ClassificationRequest,
} from "../src/classifier/classification-service.js";
import {
  buildClassifierConfig,
  classifierConfigFor,
  getAllCollectionNames,
} from "../src/classifier/classifier-config.js";
import { get as httpGet, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { cacheHeaders } from "../src/http/cache-profiles.js";
import {
  GoogleCrawlerVerifier,
  type CrawlerRequest,
} from "../src/crawlers/google-crawlers.js";
import { parseIpNetwork } from "../src/crawlers/ip-network.js";
import {
  configureHttpApp,
  createHttpAdapter,
  HTTP_APP_OPTIONS,
} from "../src/http-app.js";
import { REDIS_CONNECTION } from "../src/redis/redis-client.js";
import { loadSitemapQueryPaths } from "../src/web/sitemap.js";
import {
  Quota,
  QuotaUnavailableError,
  type Caller,
  type UsageStatus,
} from "../src/usage/quota.js";
import { readGolden } from "./support/golden.js";
import { normalizeFragment, normalizeHtml } from "./support/html-normalizer.js";
import { normalizeRegions, pageRegions } from "./support/page-regions.js";
import {
  expectedFragment,
  expectedPage,
  expectedRegion,
  withoutIslandProps,
} from "./support/page-divergences.js";
import {
  startQdrantServer,
  validCollections,
  type QdrantServer,
} from "./support/qdrant-server.js";

// The exporter pins Python's asset version to "fixture" the same way, so the
// pages keep ?v= whether or not the frontend was built.
vi.mock("../src/web/asset-url.js", () => ({
  assetUrl: (path: string) => `/static${path}?v=fixture`,
}));

const golden = readGolden(
  "pages.json",
  z.object({
    now: z.iso.datetime({ local: true }),
    origin: z.url(),
    fake: z.object({
      results: z.array(
        z.object({
          id: z.number(),
          score: z.number(),
          payload: z.record(z.string(), z.unknown()),
        }),
      ),
      elapsedSeconds: z.number(),
      tooltips: z.record(z.string(), z.string()),
      quotaLimits: z.object({ anonymous: z.number(), signedIn: z.number() }),
    }),
    regions: z.array(z.string()),
    cases: z.array(
      z.object({
        method: z.enum(["GET", "HEAD", "POST"]),
        path: z.string(),
        status: z.number(),
        headers: z.record(z.string(), z.string()),
        crawler: z.boolean().optional(),
        classify: z
          .enum([
            "success",
            "queue_full",
            "failure",
            "empty",
            "enhancement_failed",
          ])
          .optional(),
        quota: z
          .enum([
            "allowed",
            "denied_anonymous",
            "denied_signed_in",
            "unavailable",
            "charge_denied",
            "charge_unavailable",
          ])
          .optional(),
        events: z.array(z.string()).optional(),
        calls: z
          .array(
            z.object({
              query: z.string(),
              classifierType: z.string(),
              version: z.string(),
              topK: z.number(),
              enhance: z.boolean().optional(),
            }),
          )
          .optional(),
        body: z.discriminatedUnion("kind", [
          z.object({ kind: z.literal("fragment"), region: z.number() }),
          z.object({ kind: z.literal("empty") }),
          z.object({ kind: z.literal("html"), file: z.string() }),
          z.object({ kind: z.literal("json"), value: z.unknown() }),
          z.object({ kind: z.literal("sha256"), value: z.string() }),
          z.object({
            kind: z.literal("regions"),
            groups: z.array(z.string()),
            regions: z.array(z.number()),
          }),
        ]),
      }),
    ),
  }),
);

type PageCase = (typeof golden.cases)[number];

const sitemapQueryPaths = loadSitemapQueryPaths();
const FRAGMENT_ROUTE = /^\/[^/]+\/fragment$/;
const noStoreHeaders = Object.fromEntries(
  Object.entries(cacheHeaders("NO_STORE")).map(([name, value]) => [
    name.toLowerCase(),
    value,
  ]),
);
const crawlerCases = new Map(
  golden.cases
    .filter((page) => page.crawler)
    .map((page) => [`${page.method} ${page.path}`, page]),
);

/**
 * Decided divergence (unit 12): Nest renders a sitemap query page's results
 * for every visitor, from a result cache, where Python renders them only
 * for a verified crawler. Nest verifies the crawler only after a full queue,
 * the one outcome where the answers differ. A visitor gets the crawler's
 * page, except that a full queue still gives a visitor a 200 shell that
 * loads results itself. A rendered page carries a Cache-Tag. The page
 * charges no quota either way.
 *
 * Decided divergence: a fragment whose classification a shared cache may
 * not keep (`isCacheableClassification`) answers NO_STORE, where Python
 * caches every result fragment. The parity cases reach that only with an
 * empty result list.
 */
function nestCase(page: PageCase): PageCase {
  const route = page.path.split("?")[0]!;
  if (
    FRAGMENT_ROUTE.test(route) &&
    page.status === 200 &&
    page.classify === "empty"
  ) {
    return { ...page, headers: { ...page.headers, ...noStoreHeaders } };
  }
  if (
    page.method !== "GET" ||
    page.path !== route ||
    route.split("/").length !== 4 ||
    !sitemapQueryPaths.has(route)
  ) {
    return page;
  }
  const crawler = crawlerCases.get(`GET ${route}`);
  if (crawler === undefined) {
    throw new Error(`no crawler case answers the visitor for ${route}`);
  }
  const mode = page.classify ?? "success";
  const events = mode === "queue_full" ? ["classify", "crawler"] : ["classify"];
  switch (mode) {
    case "success":
      return {
        ...crawler,
        crawler: page.crawler,
        headers: { ...crawler.headers, "cache-tag": "sitemap-results" },
        events,
      };
    case "queue_full": {
      if (page.crawler) return { ...page, events };
      const { "retry-after": _, ...headers } = crawler.headers;
      return { ...page, calls: crawler.calls, headers, events };
    }
    default:
      return { ...page, events };
  }
}

// Python's stacked @router.get/@router.head routes answer 405 with
// "Allow: HEAD"; Nest lists every method of the path. Unit 8 owns that.
const IGNORED_HEADERS = new Set(["allow"]);

function readFixtureHtml(file: string): string {
  return readFileSync(new URL(`fixtures/golden/${file}`, import.meta.url), {
    encoding: "utf8",
  });
}

function varyTokens(value: string | undefined): string[] {
  const tokens = (value ?? "")
    .split(",")
    .map((token) => token.trim().toLowerCase())
    .filter(Boolean);
  return [...new Set(tokens)].sort();
}

function rawBody(
  res: request.Response,
  done: (error: Error | null, body: Buffer) => void,
): void {
  const chunks: Buffer[] = [];
  res.on("data", (chunk: Buffer) => chunks.push(chunk));
  res.on("end", () => done(null, Buffer.concat(chunks)));
}

const sitemapResults = new Map<string, string>();
const memoryResultStore: ResultStore = {
  get: (key) => Promise.resolve(sitemapResults.get(key) ?? null),
  set: (key, value) => {
    sitemapResults.set(key, value);
    return Promise.resolve();
  },
};

// The exporter's fake classification service, crawler switch and quota, at
// the ClassificationService, GoogleCrawlerVerifier and Quota interfaces.
const fake = {
  crawler: false,
  mode: "success" as NonNullable<PageCase["classify"]>,
  quota: "allowed" as NonNullable<PageCase["quota"]>,
  calls: [] as NonNullable<PageCase["calls"]>,
  events: [] as string[],
  verify: undefined as
    ((crawler: CrawlerRequest) => Promise<boolean>) | undefined,
  rerank: "applied" as RerankStatus,
  idSearch: "ok" as IdSearchStatus,
  /** Holds every classification until it settles. */
  gate: Promise.resolve(),
};
const fakeClassifiers = classifierConfigFor({ model: "fake", dims: 1 });

// Like ClassificationService, it refuses a full queue before `authorize`
// and runs `authorize` before the pipeline.
async function fakeClassify(
  _signal: AbortSignal,
  request: ClassificationRequest,
  authorize?: Authorize,
): Promise<ClassificationOutcome> {
  const { query, classifierType, topK, enhance } = request;
  const versionName = request.version ?? "";
  fake.calls.push({
    query,
    classifierType,
    version: versionName,
    topK,
    ...(enhance === undefined ? {} : { enhance }),
  });
  fake.events.push("classify");
  if (fake.mode === "queue_full") throw new ClassificationQueueFull();
  await fake.gate;
  await authorize?.();
  if (fake.mode === "failure") throw new Error("fake classification failure");
  const { versions } = fakeClassifiers[classifierType]!;
  if (versionName && !Object.hasOwn(versions, versionName)) {
    throw new ClassificationError(
      404,
      `Version '${versionName}' for classifier '${classifierType}' not found`,
    );
  }
  const tooltip = golden.fake.tooltips[classifierType];
  return {
    results: fake.mode === "empty" ? [] : golden.fake.results,
    versionName,
    version: {
      ...versions[versionName]!,
      ...(tooltip === undefined ? {} : { tooltip }),
    },
    query,
    elapsedSeconds: golden.fake.elapsedSeconds,
    rerank: fake.rerank,
    idSearch: fake.idSearch,
    enhancementStatus:
      fake.mode === "enhancement_failed" ? "failed" : "applied",
  };
}

function fakeUsage(caller: Caller, allowed: boolean): UsageStatus {
  if (caller.kind === "pro") throw new Error("the fake quota has no Pro");
  const limit =
    golden.fake.quotaLimits[
      caller.kind === "anonymous" ? "anonymous" : "signedIn"
    ];
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
    return Promise.resolve(fakeUsage(caller, !fake.quota.startsWith("denied")));
  },
  charge: (caller) => {
    fake.events.push("charge");
    if (fake.quota === "charge_unavailable") {
      return Promise.reject(new QuotaUnavailableError());
    }
    return Promise.resolve(fakeUsage(caller, fake.quota !== "charge_denied"));
  },
};

// Python writes the out-of-band title after the results; React would hoist
// it to the front.
function oobTitle(html: string): string | undefined {
  return /<title\b[^>]*>[^<]*<\/title>/.exec(html)?.[0];
}

let qdrant: QdrantServer;
let app: NestExpressApplication;

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ["Date"], now: new Date(golden.now) });
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
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  })
    .overrideProvider(ClassificationService)
    .useValue({ classify: fakeClassify })
    .overrideProvider(GoogleCrawlerVerifier)
    .useValue({
      isVerified: (crawler: CrawlerRequest) => {
        fake.events.push("crawler");
        return fake.verify?.(crawler) ?? Promise.resolve(fake.crawler);
      },
    })
    .overrideProvider(Quota)
    .useValue(fakeQuota)
    .overrideProvider(REDIS_CONNECTION)
    .useValue(null)
    .overrideProvider(SITEMAP_RESULT_STORE)
    .useValue(memoryResultStore)
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
  vi.useRealTimers();
});

async function send(page: PageCase): Promise<request.Response> {
  fake.crawler = page.crawler ?? false;
  fake.mode = page.classify ?? "success";
  fake.quota = page.quota ?? "allowed";
  fake.calls = [];
  fake.events = [];
  sitemapResults.clear();
  const agent = request(app.getHttpServer());
  const method = page.method.toLowerCase() as "get" | "head" | "post";
  return agent[method](page.path)
    .set("Host", new URL(golden.origin).host)
    .set("Accept-Encoding", "identity")
    .buffer(true)
    .parse(rawBody);
}

describe("pages match the FastAPI app (parity)", () => {
  it.each(golden.cases.map(nestCase))(
    "$method $path -> $status",
    async (page) => {
      const response = await send(page);
      expect(response.status).toBe(page.status);
      if (page.calls !== undefined) expect(fake.calls).toEqual(page.calls);
      if (page.events !== undefined) expect(fake.events).toEqual(page.events);
      expect(response.headers["set-cookie"]).toBeUndefined();

      for (const [name, value] of Object.entries(page.headers)) {
        if (IGNORED_HEADERS.has(name)) continue;
        if (name === "vary") {
          expect(varyTokens(response.headers[name]), name).toEqual(
            varyTokens(value),
          );
        } else {
          expect(response.headers[name], name).toBe(value);
        }
      }
      for (const name of [
        "cache-tag",
        "content-disposition",
        "hx-push-url",
        "link",
        "location",
        "retry-after",
        "x-ratelimit-limit",
        "x-ratelimit-remaining",
      ]) {
        if (!(name in page.headers)) {
          expect(response.headers[name], name).toBeUndefined();
        }
      }

      const body = Buffer.isBuffer(response.body)
        ? response.body
        : Buffer.alloc(0);
      switch (page.body.kind) {
        case "empty":
          expect(body.length).toBe(0);
          break;
        case "html":
          expect(normalizeHtml(withoutIslandProps(body.toString("utf8")))).toBe(
            normalizeHtml(
              expectedPage(page.body.file, readFixtureHtml(page.body.file)),
            ),
          );
          break;
        case "json":
          expect(JSON.parse(body.toString("utf8"))).toEqual(page.body.value);
          break;
        case "regions":
          expect(
            normalizeRegions(
              pageRegions(body.toString("utf8"), page.body.groups),
            ),
          ).toEqual(
            normalizeRegions(
              page.body.regions.map((index) =>
                expectedRegion(golden.regions[index]!),
              ),
            ),
          );
          break;
        case "sha256":
          expect(createHash("sha256").update(body).digest("hex")).toBe(
            page.body.value,
          );
          break;
        case "fragment": {
          const recorded = golden.regions[page.body.region]!;
          expect(normalizeFragment(body.toString("utf8"))).toBe(
            normalizeFragment(expectedFragment(recorded)),
          );
          expect(oobTitle(body.toString("utf8"))).toBe(oobTitle(recorded));
          break;
        }
      }
      if (body.includes(" data-island=")) {
        expect(body.toString("utf8"), "islands need site.js").toContain(
          '<script type="module" src="/static/js/site.js?v=fixture">',
        );
      }
    },
  );
});

describe("classifier page lifecycle", () => {
  afterEach(() => {
    fake.verify = undefined;
  });

  it.each([["fragment", "/UNSPSC/fragment?product_description=laptop", false]])(
    "skips the %s's quota and classification when the client leaves during crawler verification",
    async (_, path, verified) => {
      let started!: () => void;
      let finish!: (verified: boolean) => void;
      const verificationStarted = new Promise<void>((resolve) => {
        started = resolve;
      });
      fake.verify = () => {
        started();
        return new Promise((resolve) => {
          finish = resolve;
        });
      };
      fake.calls = [];
      fake.events = [];
      const server: Server = app.getHttpServer();
      await new Promise<void>((resolve) =>
        server.listen(0, "127.0.0.1", resolve),
      );
      try {
        const { port } = server.address() as AddressInfo;
        const client = httpGet({ host: "127.0.0.1", port, path });
        client.on("error", () => {});
        await verificationStarted;
        client.destroy();
        await new Promise((resolve) => setTimeout(resolve, 50));
        finish(verified);
        await new Promise((resolve) => setTimeout(resolve, 50));
        expect(fake.calls).toEqual([]);
        expect(fake.events).toEqual(["crawler"]);
      } finally {
        await new Promise((resolve) => server.close(resolve));
      }
    },
  );

  it("refuses HEAD where the fragment would classify, before any check", async () => {
    fake.calls = [];
    fake.events = [];
    const reply = await request(app.getHttpServer()).head(
      "/UNSPSC/fragment?product_description=laptop",
    );
    expect(reply.status).toBe(405);
    expect(reply.headers["allow"]).toBe("GET");
    expect(reply.headers["cache-control"]).toBe(
      cacheHeaders("NO_STORE")["Cache-Control"],
    );
    expect(fake.calls).toEqual([]);
    expect(fake.events).toEqual([]);
  });
});

describe("sitemap query pages (decided divergence from Python)", () => {
  const path = "/UNSPSC/laptop_computer/";
  const crawlerPage = crawlerCases.get(`GET ${path}`)!;

  beforeEach(() => {
    sitemapResults.clear();
    fake.crawler = false;
    fake.mode = "success";
    fake.quota = "denied_anonymous";
    fake.rerank = "applied";
    fake.calls = [];
    fake.events = [];
  });

  afterEach(() => {
    fake.verify = undefined;
    fake.gate = Promise.resolve();
  });

  async function visit(
    method: "get" | "head" = "get",
    target = path,
  ): Promise<{ response: request.Response; events: string[] }> {
    fake.events = [];
    const response = await request(app.getHttpServer())
      [method](target)
      .set("Host", new URL(golden.origin).host)
      .set("Accept-Encoding", "identity");
    return { response, events: fake.events };
  }

  function regions(html: string): string[] {
    if (crawlerPage.body.kind !== "regions")
      throw new Error("expected regions");
    return normalizeRegions(pageRegions(html, crawlerPage.body.groups));
  }

  it("renders a visitor the crawler's results, then serves them from the cache", async () => {
    const first = await visit();
    const second = await visit();

    expect(first.events).toEqual(["classify"]);
    expect(second.events).toEqual([]);
    for (const { response } of [first, second]) {
      expect(response.status).toBe(200);
      expect(response.headers["cache-control"]).toBe(
        cacheHeaders("HTML_PAGE")["Cache-Control"],
      );
      expect(response.headers["x-robots-tag"]).toBe("index, follow");
      expect(response.headers["cache-tag"]).toBe("sitemap-results");
    }
    expect(regions(first.response.text)).toEqual(
      normalizeRegions(
        crawlerPage.body.kind === "regions"
          ? crawlerPage.body.regions.map((index) =>
              expectedRegion(golden.regions[index]!),
            )
          : [],
      ),
    );
    expect(second.response.text).toBe(first.response.text);
    expect(second.response.text).toContain("Finished in 0.46 seconds.");
    // The client does not fetch the fragment, so no quota is charged.
    expect(first.response.text).toContain('data-autoload-enabled="false"');
  });

  it("serves a verified crawler the cached page without verifying it", async () => {
    await visit();
    fake.crawler = true;

    const { response, events } = await visit();

    expect(events).toEqual([]);
    expect(response.status).toBe(200);
    expect(response.headers["cache-tag"]).toBe("sitemap-results");
  });

  it("gives a visitor a loading shell and a verified crawler 503 when the queue is full", async () => {
    fake.mode = "queue_full";

    const visitor = await visit();
    fake.crawler = true;
    const crawler = await visit();

    expect(visitor.events).toEqual(["classify", "crawler"]);
    expect(visitor.response.status).toBe(200);
    expect(visitor.response.headers["cache-control"]).toBe(
      cacheHeaders("NO_STORE")["Cache-Control"],
    );
    expect(visitor.response.headers["x-robots-tag"]).toBe("index, follow");
    expect(visitor.response.headers["retry-after"]).toBeUndefined();
    expect(visitor.response.headers["cache-tag"]).toBeUndefined();
    expect(visitor.response.text).toContain('data-autoload-enabled="true"');
    expect(crawler.response.status).toBe(503);
    expect(crawler.response.headers["retry-after"]).toBe("120");
  });

  it("marks a failed classification noindex and does not store it", async () => {
    fake.mode = "failure";
    const failed = await visit();
    fake.mode = "success";
    const retried = await visit();

    expect(failed.response.status).toBe(200);
    expect(failed.response.headers["cache-control"]).toBe(
      cacheHeaders("NO_STORE")["Cache-Control"],
    );
    expect(failed.response.headers["x-robots-tag"]).toBe("noindex, nofollow");
    expect(failed.response.headers["cache-tag"]).toBeUndefined();
    expect(retried.events).toEqual(["classify"]);
  });

  // The process remembers a degraded result for 10 minutes, so each case
  // takes a sitemap page that no other case visits.
  it.each([
    ["failed", "/UNSPSC/laser_printer/"],
    ["skipped", "/UNSPSC/label_printer/"],
  ] as const)(
    "renders a ranking whose rerank %s, but keeps it out of every cache",
    async (rerank, degradedPath) => {
      fake.rerank = rerank;
      const degraded = await visit("get", degradedPath);
      const again = await visit("get", degradedPath);

      expect(degraded.events).toEqual(["classify"]);
      expect(again.events).toEqual([]);
      expect(sitemapResults.size).toBe(0);
      expect(again.response.text).toBe(degraded.response.text);
      expect(again.response.headers["cache-control"]).toBe(
        cacheHeaders("NO_STORE")["Cache-Control"],
      );
      expect(degraded.response.status).toBe(200);
      expect(degraded.response.headers["cache-control"]).toBe(
        cacheHeaders("NO_STORE")["Cache-Control"],
      );
      expect(degraded.response.headers["cloudflare-cdn-cache-control"]).toBe(
        cacheHeaders("NO_STORE")["Cloudflare-CDN-Cache-Control"],
      );
      expect(degraded.response.headers["cache-tag"]).toBeUndefined();
      expect(degraded.response.headers["x-robots-tag"]).toBe("index, follow");
      expect(degraded.response.text).toContain('data-autoload-enabled="false"');
      expect(
        degraded.response.text.match(/role="listitem"/g) ?? [],
      ).toHaveLength(golden.fake.results.length);
    },
  );

  it.each(["applied", "not_needed"] as const)(
    "lets the edge cache a ranking whose rerank is %s",
    async (rerank) => {
      fake.rerank = rerank;
      const { response } = await visit();

      expect(response.headers["cloudflare-cdn-cache-control"]).toBe(
        cacheHeaders("HTML_PAGE")["Cloudflare-CDN-Cache-Control"],
      );
      expect(response.headers["cache-tag"]).toBe("sitemap-results");
    },
  );

  it("answers HEAD without classifying", async () => {
    const { response, events } = await visit("head");

    expect(events).toEqual([]);
    expect(response.status).toBe(200);
    expect(response.headers["cache-control"]).toBe(
      cacheHeaders("HTML_PAGE")["Cache-Control"],
    );
  });

  it("keys results by query", async () => {
    await visit();
    const other = await visit("get", "/UNSPSC/office_chair/");

    expect(other.events).toEqual(["classify"]);
    expect(fake.calls.map((call) => call.query)).toEqual([
      "laptop computer",
      "office chair",
    ]);
  });

  it("finishes and stores the classification after the visitor leaves", async () => {
    let release!: () => void;
    fake.gate = new Promise((resolve) => {
      release = resolve;
    });
    const server: Server = app.getHttpServer();
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    try {
      const { port } = server.address() as AddressInfo;
      const client = httpGet({ host: "127.0.0.1", port, path });
      client.on("error", () => {});
      await vi.waitUntil(() => fake.events.includes("classify"));
      client.destroy();
      await new Promise((resolve) => setTimeout(resolve, 50));
      release();
      await vi.waitUntil(() => sitemapResults.size > 0);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }

    const { response, events } = await visit();
    expect(events).toEqual([]);
    expect(response.headers["cache-tag"]).toBe("sitemap-results");
  });
});

describe("result fragment caching (decided divergence from Python)", () => {
  const parity = golden.cases.find(
    (page) =>
      page.method === "GET" &&
      page.path === "/UNSPSC/fragment?product_description=laptop%20computer" &&
      page.classify === "success" &&
      page.quota === "allowed" &&
      page.crawler === false,
  )!;

  afterEach(() => {
    fake.rerank = "applied";
    fake.idSearch = "ok";
  });

  it.each([
    ["applied", "ok", "CLASSIFICATION_RESULT"],
    ["not_needed", "ok", "CLASSIFICATION_RESULT"],
    ["failed", "ok", "NO_STORE"],
    ["skipped", "ok", "NO_STORE"],
    ["applied", "failed", "NO_STORE"],
  ] as const)(
    "rerank %s with ID search %s answers %s and still renders the results",
    async (rerank, idSearch, profile) => {
      fake.rerank = rerank;
      fake.idSearch = idSearch;

      const response = await send(parity);

      expect(response.status).toBe(200);
      expect(response.headers["cache-control"]).toBe(
        cacheHeaders(profile)["Cache-Control"],
      );
      expect(response.headers["cloudflare-cdn-cache-control"]).toBe(
        cacheHeaders(profile)["Cloudflare-CDN-Cache-Control"],
      );
      expect(response.headers["cache-tag"]).toBe("classification-results");
      expect(response.headers["hx-push-url"]).toBe(
        parity.headers["hx-push-url"],
      );
      expect(fake.events).toEqual(parity.events);
      if (parity.body.kind !== "fragment") throw new Error("expected fragment");
      const html = (response.body as Buffer).toString("utf8");
      const recorded = golden.regions[parity.body.region]!;
      expect(normalizeFragment(html)).toBe(
        normalizeFragment(expectedFragment(recorded)),
      );
      expect(oobTitle(html)).toBe(oobTitle(recorded));
    },
  );
});

describe("the base classifier page", () => {
  beforeEach(() => {
    fake.crawler = true;
    fake.calls = [];
    fake.events = [];
  });

  afterEach(() => {
    fake.mode = "success";
  });

  it("verifies a crawler only when the queue is full", async () => {
    fake.mode = "success";
    await request(app.getHttpServer()).get("/UNSPSC/");
    const rendered = fake.events;
    fake.events = [];
    fake.mode = "queue_full";
    const full = await request(app.getHttpServer()).get("/UNSPSC/");

    expect(rendered).toEqual(["classify"]);
    expect(fake.events).toEqual(["classify", "crawler"]);
    expect(full.status).toBe(503);
  });

  it("classifies the example on every visit", async () => {
    fake.mode = "success";
    await request(app.getHttpServer()).get("/UNSPSC/");
    await request(app.getHttpServer()).get("/UNSPSC/");

    expect(fake.events).toEqual(["classify", "classify"]);
  });
});

describe("crawler verification behind a proxy", () => {
  // Production uvicorn runs with --forwarded-allow-ips "*", so Python reads
  // the client from X-Forwarded-For. Supertest's address stands in for the
  // proxy's, which is never Google's.
  const verifier = new GoogleCrawlerVerifier(
    {
      bypassEnabled: true,
      trustCfConnectingIp: false,
      ipRangeTtlSeconds: 60,
      ipRangeNegativeTtlSeconds: 300,
      ipRangeTimeoutSeconds: 2,
    },
    { current: () => Promise.resolve([parseIpNetwork("66.249.64.0/27")!]) },
  );

  beforeEach(() => {
    fake.verify = (crawler) => verifier.isVerified(crawler);
    fake.mode = "success";
    fake.quota = "denied_anonymous";
    fake.calls = [];
    fake.events = [];
  });

  afterEach(() => {
    fake.verify = undefined;
  });

  function googlebotFragment(forwardedFor: string): request.Test {
    return request(app.getHttpServer())
      .get("/UNSPSC/fragment?product_description=laptop")
      .set("User-Agent", "Googlebot/2.1 (+http://www.google.com/bot.html)")
      .set("X-Forwarded-For", forwardedFor);
  }

  it("serves results without quota to Googlebot whose first X-Forwarded-For entry is Google's", async () => {
    const response = await googlebotFragment("66.249.64.1, 172.18.0.5");

    expect(fake.events).toEqual(["crawler", "classify"]);
    expect(response.status).toBe(200);
    expect(response.headers["cache-tag"]).toBe("classification-results");
  });

  it("paywalls Googlebot whose Google address is not the first X-Forwarded-For entry", async () => {
    const response = await googlebotFragment("203.0.113.10, 66.249.64.1");

    expect(response.headers["cache-tag"]).toBeUndefined();
    expect(response.headers["x-ratelimit-remaining"]).toBe("0");
    expect(fake.events).toEqual(["crawler", "caller", "check"]);
  });
});

describe("normalizeHtml", () => {
  const page = (head: string, body: string) =>
    `<!DOCTYPE html><html lang="en"><head>${head}</head><body>${body}</body></html>`;

  it("renders every element of a fixture page", () => {
    const lines = normalizeHtml(readFixtureHtml("pages/home.html"));
    expect(lines.split("\n").length).toBeGreaterThan(500);
    expect(lines).toContain('<button aria-expanded="false"');
    expect(lines).toContain('"@type": "FAQPage"');
  });

  it("ignores comments, indentation, attribute order and JSON key order", () => {
    expect(
      normalizeHtml(
        page(
          '<script type="application/ld+json">{"b": 1, "a": [2]}</script>',
          '<!-- c -->\n  <div class="x" id="y">\n    Text\n  </div>\n',
        ),
      ),
    ).toBe(
      normalizeHtml(
        page(
          '<script type="application/ld+json">{"a":[2],"b":1}</script>',
          '<div id="y" class="x">Text</div>',
        ),
      ),
    );
  });

  it("allows React's head order and image preloads", () => {
    expect(
      normalizeHtml(
        page(
          '<meta charset="UTF-8"><link rel="preload" as="image" href="/i.png"><script async src="/a.js"></script><title>T</title><link rel="stylesheet" href="/s.css"><script>x()</script>',
          '<img src="/i.png">',
        ),
      ),
    ).toBe(
      normalizeHtml(
        page(
          '<meta charset="UTF-8"><title>T</title><link rel="stylesheet" href="/s.css"><script async src="/a.js"></script><script>x()</script>',
          '<img src="/i.png">',
        ),
      ),
    );
  });

  it.each([
    ["an attribute", '<a class="x">a</a>', '<a class="y">a</a>'],
    [
      "a space between inline elements",
      "<a>a</a> <a>b</a>",
      "<a>a</a><a>b</a>",
    ],
    ["a space before text", "<b>a</b> b", "<b>a</b>b"],
    ["a data- attribute", "<button data-x>a</button>", "<button>a</button>"],
    ["an inline script", "<script>a()</script>", "<script>b()</script>"],
    [
      "whitespace in <pre>",
      "<pre><b>a</b>\n  b</pre>",
      "<pre><b>a</b> b</pre>",
    ],
  ])("detects a changed %s", (_, left, right) => {
    expect(normalizeHtml(page("", left))).not.toBe(
      normalizeHtml(page("", right)),
    );
  });

  it("keeps stylesheet and style order in the head", () => {
    expect(
      normalizeHtml(
        page('<link rel="stylesheet" href="/a.css"><style>b{}</style>', ""),
      ),
    ).not.toBe(
      normalizeHtml(
        page('<style>b{}</style><link rel="stylesheet" href="/a.css">', ""),
      ),
    );
  });

  it("keeps nonbreaking spaces and asset versions", () => {
    expect(normalizeHtml(page("", "<p>\u00a0Title</p>"))).not.toBe(
      normalizeHtml(page("", "<p>Title</p>")),
    );
    expect(
      normalizeHtml(
        page('<script src="/static/js/a.js?v=fixture"></script>', ""),
      ),
    ).not.toBe(
      normalizeHtml(page('<script src="/static/js/a.js"></script>', "")),
    );
  });
});
