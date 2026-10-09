import { contract, readRepoFile } from "./support/env.js";
import type { CacheProfileName } from "./support/headers.js";
import {
  expectCacheProfile,
  expectStatus,
  send,
  varyTokens,
  type Reply,
} from "./support/http.js";

type FileCase = {
  path: string;
  repoFile: string;
  contentType: string;
  profile: CacheProfileName;
  vary: string[];
};

const gzipVary = ["accept-encoding"];

// Python's get_static_cache_profile omits .gif and .webmanifest, so they fall
// through to STATIC_TEXT. The Nest port serves them as media on purpose.
const mediaOnNest: CacheProfileName =
  contract.target === "nest" ? "STATIC_MEDIA" : "STATIC_TEXT";

const rootFiles: (FileCase & { gzip: boolean })[] = [
  {
    path: "/robots.txt",
    repoFile: "app/static/robots.txt",
    contentType: "text/plain; charset=utf-8",
    profile: "STATIC_TEXT",
    vary: [],
    gzip: false,
  },
  {
    path: "/sitemap.xml",
    repoFile: "app/static/sitemap.xml",
    contentType: "text/xml; charset=utf-8",
    profile: "STATIC_TEXT",
    vary: [],
    gzip: false,
  },
  {
    path: "/favicon.ico",
    repoFile: "app/static/images/favicon.ico",
    contentType: "image/vnd.microsoft.icon",
    profile: "STATIC_MEDIA",
    vary: gzipVary,
    gzip: true,
  },
];

const staticFiles: FileCase[] = [
  {
    path: "/static/js/common.js",
    repoFile: "app/static/js/common.js",
    contentType: "text/javascript; charset=utf-8",
    profile: "STATIC_CODE",
    vary: gzipVary,
  },
  {
    path: "/static/css/styles.css",
    repoFile: "app/static/css/styles.css",
    contentType: "text/css; charset=utf-8",
    profile: "STATIC_CODE",
    vary: gzipVary,
  },
  {
    path: "/static/htmx.min.js",
    repoFile: "app/static/htmx.min.js",
    contentType: "text/javascript; charset=utf-8",
    profile: "STATIC_CODE",
    vary: gzipVary,
  },
  {
    path: "/static/images/favicon.ico",
    repoFile: "app/static/images/favicon.ico",
    contentType: "image/vnd.microsoft.icon",
    profile: "STATIC_MEDIA",
    vary: gzipVary,
  },
  {
    path: "/static/images/preview.png",
    repoFile: "app/static/images/preview.png",
    contentType: "image/png",
    profile: "STATIC_MEDIA",
    vary: gzipVary,
  },
  {
    path: "/static/images/hts-logo.jpg",
    repoFile: "app/static/images/hts-logo.jpg",
    contentType: "image/jpeg",
    profile: "STATIC_MEDIA",
    vary: gzipVary,
  },
  {
    path: "/static/images/unspsc-logo.gif",
    repoFile: "app/static/images/unspsc-logo.gif",
    contentType: "image/gif",
    profile: mediaOnNest,
    vary: gzipVary,
  },
  {
    path: "/static/images/site.webmanifest",
    repoFile: "app/static/images/site.webmanifest",
    contentType: "application/manifest+json",
    profile: mediaOnNest,
    vary: gzipVary,
  },
  {
    path: "/static/mapping_samples/unspsc_to_cpv_mapping_sample.csv",
    repoFile: "app/static/mapping_samples/unspsc_to_cpv_mapping_sample.csv",
    contentType: "text/csv; charset=utf-8",
    profile: "STATIC_TEXT",
    vary: gzipVary,
  },
];

const sampleDownloads = [
  {
    path: "/mapping/unspsc-to-cpv-mapping/sample",
    repoFile: "app/static/mapping_samples/unspsc_to_cpv_mapping_sample.csv",
  },
  {
    path: "/mapping/cpv-to-unspsc-mapping/sample",
    repoFile: "app/static/mapping_samples/cpv_to_unspsc_mapping_sample.csv",
  },
];

function expectFile(reply: Reply, file: FileCase, body: "full" | "empty") {
  expectStatus(reply, 200);
  expect(reply.headers.get("content-type")).toBe(file.contentType);
  expectCacheProfile(reply, file.profile);
  expect(varyTokens(reply), `${reply.label} Vary`).toEqual(file.vary);
  expect(reply.headers.get("cache-tag")).toBe("static-files");
  expect(reply.headers.get("etag")).toMatch(/^"[^"]+"$/);
  expect(
    reply.bytes.equals(
      body === "full" ? readRepoFile(file.repoFile) : Buffer.alloc(0),
    ),
    `${reply.label} body`,
  ).toBe(true);
}

describe("root files", () => {
  it.each(rootFiles)("GET $path", async (file) => {
    expectFile(await send(file.path), file, "full");
  });

  it.each(rootFiles.filter((file) => !file.gzip))(
    "GET $path is never gzipped",
    async ({ path }) => {
      const reply = await send(path, {
        headers: { "accept-encoding": "gzip" },
      });
      expect(reply.headers.get("content-encoding")).toBeNull();
    },
  );
});

describe("/static files", () => {
  it.each(staticFiles)("GET $path", async (file) => {
    expectFile(await send(file.path), file, "full");
  });

  it.each(staticFiles)("HEAD $path", async (file) => {
    expectFile(await send(file.path, { method: "HEAD" }), file, "empty");
  });

  it.each(staticFiles)(
    "GET $path with a matching If-None-Match is 304",
    async (file) => {
      const etag = (await send(file.path)).headers.get("etag") ?? "";
      const reply = await send(file.path, {
        headers: { "if-none-match": etag },
      });
      expectStatus(reply, 304);
      expect(reply.body).toBe("");
      expect(reply.headers.get("etag")).toBe(etag);
      expectCacheProfile(reply, file.profile);
      expect(reply.headers.get("cache-tag")).toBe("static-files");
    },
  );

  it.each(staticFiles)(
    "GET $path with a stale If-None-Match is 200",
    async (file) => {
      const reply = await send(file.path, {
        headers: { "if-none-match": '"stale"' },
      });
      expectFile(reply, file, "full");
    },
  );
});

describe("mapping sample downloads", () => {
  it.each(sampleDownloads)("GET $path", async ({ path, repoFile }) => {
    const reply = await send(path);
    expectStatus(reply, 200);
    expect(reply.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(reply.headers.get("content-disposition")).toBe(
      `attachment; filename="${repoFile.split("/").at(-1)}"`,
    );
    expectCacheProfile(reply, "STATIC_TEXT");
    expect(varyTokens(reply)).toEqual(gzipVary);
    expect(reply.headers.get("etag")).toMatch(/^"[^"]+"$/);
    expect(reply.bytes.equals(readRepoFile(repoFile))).toBe(true);
  });
});
