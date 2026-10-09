import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Controller, Get, Req } from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { Test } from "@nestjs/testing";
import type { Request } from "express";
import request from "supertest";
import { vi } from "vitest";
import { AppModule } from "../src/app.module.js";
import { configureHttpApp, createHttpAdapter } from "../src/http-app.js";
import {
  cacheHeaders,
  type CacheProfileName,
} from "../src/http/cache-profiles.js";
import {
  SECURITY_HEADERS,
  splitRequestTarget,
} from "../src/http/middleware.js";

@Controller()
class EchoController {
  @Get("echo")
  echo(@Req() req: Request) {
    return {
      q: req.query["q"] ?? "",
      query: splitRequestTarget(req.originalUrl).rawQuery,
    };
  }
}

async function bootApp(staticRoot?: string): Promise<NestExpressApplication> {
  for (const name of ["HF_TOKEN", "QDRANT_URL", "QDRANT_HOST", "QDRANT_PORT"]) {
    vi.stubEnv(name, undefined);
  }
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
    controllers: [EchoController],
  }).compile();
  const app =
    moduleRef.createNestApplication<NestExpressApplication>(
      createHttpAdapter(),
    );
  configureHttpApp(app, staticRoot);
  await app.init();
  return app;
}

function expectProfile(
  response: request.Response,
  profile: CacheProfileName,
): void {
  for (const [name, value] of Object.entries(cacheHeaders(profile))) {
    expect(response.headers[name.toLowerCase()], name).toBe(value);
  }
  expect(response.headers["expires"]).toBeUndefined();
  expect(response.headers["cache-tag"]).toBe("static-files");
  expect(response.headers["set-cookie"]).toBeUndefined();
}

function varyTokens(response: request.Response): string[] {
  return (response.headers["vary"] ?? "")
    .split(",")
    .map((token: string) => token.trim().toLowerCase());
}

// Starlette's add_vary_header appends without deduplicating, so a static
// file says Accept-Encoding twice on both servers.
function varySet(response: request.Response): string[] {
  return [...new Set(varyTokens(response))];
}

describe("mounted static files (e2e)", () => {
  let app: NestExpressApplication;
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "classifast-static-"));
    app = await bootApp(root);
  });

  afterEach(async () => {
    await app.close();
    await rm(root, { recursive: true, force: true });
    vi.unstubAllEnvs();
  });

  it.each([
    ["app.js", "STATIC_CODE"],
    ["favicon.png", "STATIC_MEDIA"],
    ["robots.txt", "STATIC_TEXT"],
  ] as const)("revalidates %s to 304 with its ETag", async (asset, profile) => {
    const contents = Buffer.from("static asset contents");
    await writeFile(join(root, asset), contents);
    const server = app.getHttpServer();

    const original = await request(server)
      .get(`/static/${asset}`)
      .buffer(true)
      .parse((res, done) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => done(null, Buffer.concat(chunks)));
      });
    const revalidated = await request(server)
      .get(`/static/${asset}`)
      .set("If-None-Match", original.headers["etag"]!);

    expect(original.status).toBe(200);
    expect(original.body).toEqual(contents);
    expect(revalidated.status).toBe(304);
    expect(revalidated.text).toBe("");
    expect(revalidated.headers["etag"]).toBe(original.headers["etag"]);
    for (const response of [original, revalidated]) {
      expectProfile(response, profile);
      expect(varySet(response)).toEqual(["accept-encoding"]);
    }
  });

  it("returns a new ETag once the file changes", async () => {
    const asset = join(root, "app.js");
    await writeFile(asset, "original contents");
    const server = app.getHttpServer();
    const original = await request(server).get("/static/app.js");

    await writeFile(asset, "updated contents with a different size");
    const changed = await request(server)
      .get("/static/app.js")
      .set("If-None-Match", original.headers["etag"]!);
    const revalidated = await request(server)
      .get("/static/app.js")
      .set("If-None-Match", changed.headers["etag"]!);

    expect(changed.status).toBe(200);
    expect(changed.text).toBe("updated contents with a different size");
    expect(changed.headers["etag"]).not.toBe(original.headers["etag"]);
    expect(revalidated.status).toBe(304);
    expect(revalidated.headers["etag"]).toBe(changed.headers["etag"]);
  });

  it("refuses paths that climb out of the mount", async () => {
    const response = await request(app.getHttpServer()).get(
      "/static/%2E%2E/%2E%2E/package.json",
    );

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ detail: "Not Found" });
  });
});

describe("HTTP layer (e2e)", () => {
  let app: NestExpressApplication;
  let server: ReturnType<NestExpressApplication["getHttpServer"]>;

  beforeAll(async () => {
    app = await bootApp();
    server = app.getHttpServer();
  });

  afterAll(async () => {
    await app.close();
    vi.unstubAllEnvs();
  });

  it.each([
    ["/favicon.ico", "STATIC_MEDIA"],
    ["/robots.txt", "STATIC_TEXT"],
    ["/sitemap.xml", "STATIC_TEXT"],
  ] as const)("serves %s with %s", async (path, profile) => {
    const response = await request(server).get(path);

    expect(response.status).toBe(200);
    expectProfile(response, profile);
  });

  it.each(["/robots.txt", "/sitemap.xml"])("never gzips %s", async (path) => {
    const response = await request(server)
      .get(path)
      .set("Accept-Encoding", "gzip");

    expect(response.headers["content-encoding"]).toBeUndefined();
    expect(response.headers["vary"]).toBeUndefined();
  });

  it("gzips other bodies for clients that accept gzip", async () => {
    const response = await request(server)
      .get("/static/htmx.min.js")
      .set("Accept-Encoding", "gzip");

    expect(response.headers["content-encoding"]).toBe("gzip");
    expect(varySet(response)).toEqual(["accept-encoding"]);
  });

  it("answers HEAD like GET without a body", async () => {
    const get = await request(server).get("/robots.txt");
    const head = await request(server).head("/robots.txt");

    expect(head.status).toBe(200);
    expect(head.text).toBeUndefined();
    expect(head.headers["content-length"]).toBe(get.headers["content-length"]);
    expect(head.headers["etag"]).toBe(get.headers["etag"]);
  });

  it.each([
    ["/robots.txt", true],
    ["/no-such-page", true],
    ["/echo?q=%25%25%25", false],
    ["/echo?q=a%20%20b", false],
  ])(
    "sets the security headers on %s (X-Process-Time: %s)",
    async (path, timed) => {
      const response = await request(server).get(path).redirects(0);

      for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
        expect(response.headers[name.toLowerCase()], name).toBe(value);
      }
      if (timed) {
        expect(response.headers["x-process-time"]).toMatch(
          /^\d+\.\d+(e-\d+)?$/,
        );
      } else {
        expect(response.headers["x-process-time"]).toBeUndefined();
      }
      expect(response.headers["set-cookie"]).toBeUndefined();
    },
  );

  it("answers unknown paths with FastAPI's 404 body", async () => {
    const response = await request(server).get("/no-such-page");

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ detail: "Not Found" });
  });

  it("answers an unsupported method with 405 and Allow", async () => {
    const response = await request(server).post("/robots.txt");

    expect(response.status).toBe(405);
    expect(response.body).toEqual({ detail: "Method Not Allowed" });
    expect(response.headers["allow"]).toBe("GET, HEAD");
  });

  describe("query normalization", () => {
    it("redirects with 308 only to normalize whitespace", async () => {
      const response = await request(server)
        .get("/echo?q=%20industrial%20%20pump%20")
        .set("Host", "testserver")
        .redirects(0);

      expect(response.status).toBe(308);
      expect(response.headers["location"]).toBe(
        "http://testserver/echo?q=industrial%20pump",
      );
    });

    it("builds the redirect with the forwarded scheme", async () => {
      const response = await request(server)
        .get("/echo?q=pump%20%20")
        .set("Host", "classifast.com")
        .set("X-Forwarded-Proto", "https")
        .redirects(0);

      expect(response.headers["location"]).toBe(
        "https://classifast.com/echo?q=pump",
      );
    });

    it("does not redirect a canonical query again", async () => {
      const response = await request(server)
        .get("/echo?q=industrial%20pump")
        .redirects(0);

      expect(response.status).toBe(200);
      expect(response.body.q).toBe("industrial pump");
    });

    it("keeps semantic parameters without redirecting", async () => {
      const response = await request(server)
        .get("/echo?product_description=pump&push_url=false&top_k=30")
        .redirects(0);

      expect(response.status).toBe(200);
      expect(response.body.query).toBe(
        "product_description=pump&push_url=false&top_k=30",
      );
    });
  });

  describe("URL encoding validation", () => {
    it("accepts a long benign query", async () => {
      const longQuery = "industrial-pump-".repeat(240).replace(/-$/, "");
      const response = await request(server)
        .get("/echo")
        .query({ q: longQuery });

      expect(response.status).toBe(200);
      expect(response.body.q).toBe(longQuery);
    });

    it.each([
      ["an oversized query key", `/echo?${"k".repeat(5001)}=1`],
      ["a suspicious encoding pattern", "/echo?q=%25%25%25"],
      [
        "Cloudflare bypass spam",
        "/echo?q=cfRLUnblockHandlers2920return20false253B20window.copyOriginalId28274321161927252C20this29",
      ],
      [
        "copyOriginalId spam",
        "/echo?q=copyOriginalId25282527114125272C2520this25292520return2520false3B2520window.copyOriginalId25282527114125272C2520this2529",
      ],
    ])("rejects %s with 400", async (_name, path) => {
      const response = await request(server).get(path);

      expect(response.status).toBe(400);
      expect(response.body).toEqual({
        detail: "Request rejected due to suspicious URL encoding patterns",
        error: "INVALID_ENCODING",
      });
    });
  });
});
