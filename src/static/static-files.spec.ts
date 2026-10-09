import type { BigIntStats } from "node:fs";
import { z } from "zod";
import { readGolden } from "../../test/support/golden.js";
import { cacheHeaders } from "../http/cache-profiles.js";
import {
  contentTypeFor,
  fileValidators,
  isNotModified,
  normalizeRoutePath,
  staticFileProfile,
} from "./static-files.js";

const golden = readGolden(
  "static-files.json",
  z.object({
    validators: z.array(
      z.object({
        mtimeNs: z.string(),
        size: z.number(),
        etag: z.string(),
        lastModified: z.string(),
      }),
    ),
  }),
);

function stats(mtimeNs: bigint, size: number): BigIntStats {
  return { mtimeNs, size: BigInt(size) } as BigIntStats;
}

describe("fileValidators matches Starlette's FileResponse", () => {
  it.each(golden.validators)(
    "mtime $mtimeNs ns, $size bytes",
    ({ mtimeNs, size, etag, lastModified }) => {
      expect(fileValidators(stats(BigInt(mtimeNs), size))).toEqual({
        etag,
        lastModified,
      });
    },
  );
});

describe("isNotModified", () => {
  const validators = fileValidators(stats(1759952481123456789n, 5639));

  it.each([
    [validators.etag, true],
    [`W/${validators.etag}`, true],
    [`"other", ${validators.etag}`, true],
    [" * ", true],
    ['"other"', false],
  ])("If-None-Match %s -> %s", (ifNoneMatch, expected) => {
    expect(isNotModified({ "if-none-match": ifNoneMatch }, validators)).toBe(
      expected,
    );
  });

  it("ignores If-Modified-Since when If-None-Match is present", () => {
    const headers = {
      "if-none-match": '"other"',
      "if-modified-since": validators.lastModified,
    };
    expect(isNotModified(headers, validators)).toBe(false);
  });

  it.each([
    ["Wed, 08 Oct 2025 19:41:21 GMT", true],
    ["Thu, 09 Oct 2025 00:00:00 GMT", true],
    ["Wed, 08 Oct 2025 19:41:20 GMT", false],
    ["not a date", false],
  ])("If-Modified-Since %s -> %s", (ifModifiedSince, expected) => {
    expect(
      isNotModified({ "if-modified-since": ifModifiedSince }, validators),
    ).toBe(expected);
  });
});

describe("staticFileProfile", () => {
  it("serves JavaScript and CSS with STATIC_CODE", () => {
    expect(staticFileProfile("htmx.min.js")).toBe("STATIC_CODE");
    expect(staticFileProfile("css/styles.css")).toBe("STATIC_CODE");
    expect(cacheHeaders("STATIC_CODE")).toEqual({
      "Cache-Control": "public, max-age=300, stale-while-revalidate=3600",
      "Cloudflare-CDN-Cache-Control":
        "max-age=43200, stale-while-revalidate=86400",
    });
  });

  it("serves media with STATIC_MEDIA, never immutable", () => {
    expect(staticFileProfile("images/favicon-32x32.png")).toBe("STATIC_MEDIA");
    expect(cacheHeaders("STATIC_MEDIA")["Cache-Control"]).toBe(
      "public, max-age=3600, stale-while-revalidate=86400",
    );
    expect(cacheHeaders("STATIC_MEDIA")["Cache-Control"]).not.toContain(
      "immutable",
    );
  });

  it.each([
    "exports/example.xlsx",
    "exports/example.pdf",
    "exports/example.zip",
    "images/favicon.ico",
    "images/unspsc-logo.gif",
    "images/site.webmanifest",
  ])("serves %s with STATIC_MEDIA", (path) => {
    expect(staticFileProfile(path)).toBe("STATIC_MEDIA");
  });

  it.each([
    "mapping_samples/example.csv",
    "robots.txt",
    "sitemap.xml",
    "a.svg",
  ])("serves %s with STATIC_TEXT", (path) => {
    expect(staticFileProfile(path)).toBe("STATIC_TEXT");
  });
});

describe("contentTypeFor uses Python's mimetypes table", () => {
  it.each([
    ["app.js", "text/javascript; charset=utf-8"],
    ["robots.txt", "text/plain; charset=utf-8"],
    ["sitemap.xml", "text/xml; charset=utf-8"],
    ["favicon.ico", "image/vnd.microsoft.icon"],
    ["site.webmanifest", "application/manifest+json"],
    ["LOGO.PNG", "image/png"],
    ["no-extension", "application/octet-stream"],
  ])("%s -> %s", (path, expected) => {
    expect(contentTypeFor(path)).toBe(expected);
  });
});

describe("normalizeRoutePath mirrors os.path.normpath under the mount", () => {
  it.each([
    ["/js/app.js", "js/app.js"],
    ["//js/./app.js", "js/app.js"],
    ["/js/../css/styles.css", "css/styles.css"],
    ["/", ""],
    ["/../app/main.py", undefined],
    ["/js/../../.env", undefined],
  ])("%s -> %s", (routePath, expected) => {
    expect(normalizeRoutePath(routePath)).toBe(expected);
  });
});
