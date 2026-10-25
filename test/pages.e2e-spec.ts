import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { vi } from "vitest";
import { z } from "zod";
import { AppModule } from "../src/app.module.js";
import { ClassificationError } from "../src/classifier/classification.js";
import { ClassificationQueueFull } from "../src/classifier/classification-queue.js";
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
    rerank: "applied",
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
  const agent = request(app.getHttpServer());
  const method = page.method.toLowerCase() as "get" | "head" | "post";
  return agent[method](page.path)
    .set("Host", new URL(golden.origin).host)
    .set("Accept-Encoding", "identity")
    .buffer(true)
    .parse(rawBody);
}

describe("pages match the FastAPI app (parity)", () => {
  it.each(golden.cases)("$method $path -> $status", async (page) => {
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
        expect(normalizeHtml(body.toString("utf8"))).toBe(
          normalizeHtml(readFixtureHtml(page.body.file)),
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
            page.body.regions.map((index) => golden.regions[index]!),
          ),
        );
        break;
      case "sha256":
        expect(createHash("sha256").update(body).digest("hex")).toBe(
          page.body.value,
        );
        break;
      case "fragment": {
        const expected = golden.regions[page.body.region]!;
        expect(normalizeFragment(body.toString("utf8"))).toBe(
          normalizeFragment(expected),
        );
        expect(oobTitle(body.toString("utf8"))).toBe(oobTitle(expected));
        break;
      }
    }
  });
});

describe("classifier page lifecycle", () => {
  afterEach(() => {
    fake.verify = undefined;
  });

  it.each([
    ["page", "/UNSPSC/", true],
    ["fragment", "/UNSPSC/fragment?product_description=laptop", false],
  ])(
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
