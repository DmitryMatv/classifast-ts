import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { vi } from "vitest";
import { z } from "zod";
import { AppModule } from "../src/app.module.js";
import {
  buildClassifierConfig,
  getAllCollectionNames,
} from "../src/classifier/classifier-config.js";
import {
  configureHttpApp,
  createHttpAdapter,
  HTTP_APP_OPTIONS,
} from "../src/http-app.js";
import { readGolden } from "./support/golden.js";
import { normalizeHtml } from "./support/html-normalizer.js";
import {
  startQdrantServer,
  validCollections,
  type QdrantServer,
} from "./support/qdrant-server.js";

const golden = readGolden(
  "pages.json",
  z.object({
    now: z.iso.datetime({ local: true }),
    origin: z.url(),
    cases: z.array(
      z.object({
        method: z.enum(["GET", "HEAD", "POST"]),
        path: z.string(),
        status: z.number(),
        headers: z.record(z.string(), z.string()),
        body: z.discriminatedUnion("kind", [
          z.object({ kind: z.literal("empty") }),
          z.object({ kind: z.literal("html"), file: z.string() }),
          z.object({ kind: z.literal("json"), value: z.unknown() }),
          z.object({ kind: z.literal("sha256"), value: z.string() }),
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
  }).compile();
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
    for (const name of ["content-disposition", "location", "link"]) {
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
      case "sha256":
        expect(createHash("sha256").update(body).digest("hex")).toBe(
          page.body.value,
        );
        break;
    }
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
});
