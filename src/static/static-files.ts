import { createHash } from "node:crypto";
import { realpathSync, type BigIntStats } from "node:fs";
import { readFile, realpath, stat } from "node:fs/promises";
import { extname, join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { HttpException } from "@nestjs/common";
import type { Request, RequestHandler, Response } from "express";
import {
  cacheHeaders,
  type CacheProfileName,
  type HeaderRecord,
} from "../http/cache-profiles.js";
import { splitRequestTarget } from "../http/middleware.js";
import { pyRepr } from "../python/numbers.js";
import { pyStrip } from "../python/str.js";
import { unquote } from "../python/urllib.js";

export const STATIC_ROOT = fileURLToPath(
  new URL("../../app/static", import.meta.url),
);

// Python's mimetypes table for the extensions a static file can have.
const MEDIA_TYPES: Readonly<Record<string, string>> = {
  ".avif": "image/avif",
  ".css": "text/css",
  ".csv": "text/csv",
  ".gif": "image/gif",
  ".htm": "text/html",
  ".html": "text/html",
  ".ico": "image/vnd.microsoft.icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript",
  ".json": "application/json",
  ".mjs": "text/javascript",
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain",
  ".webmanifest": "application/manifest+json",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".xml": "text/xml",
  ".zip": "application/zip",
};

export function contentTypeFor(path: string): string {
  const extension = extname(path);
  const mediaType =
    MEDIA_TYPES[extension] ??
    MEDIA_TYPES[extension.toLowerCase()] ??
    "application/octet-stream";
  return mediaType.startsWith("text/")
    ? `${mediaType}; charset=utf-8`
    : mediaType;
}

// Python's get_static_cache_profile leaves .gif and .webmanifest on
// STATIC_TEXT; the Nest port serves them as media on purpose.
const MEDIA_SUFFIXES = [
  ".png",
  ".jpg",
  ".gif",
  ".ico",
  ".webmanifest",
  ".pdf",
  ".zip",
  ".xlsx",
];
const CODE_SUFFIXES = [".css", ".js"];

export function staticFileProfile(path: string): CacheProfileName {
  if (MEDIA_SUFFIXES.some((suffix) => path.endsWith(suffix))) {
    return "STATIC_MEDIA";
  }
  if (CODE_SUFFIXES.some((suffix) => path.endsWith(suffix))) {
    return "STATIC_CODE";
  }
  return "STATIC_TEXT";
}

export type StaticFile = { readonly path: string; readonly stats: BigIntStats };

type Validators = { readonly etag: string; readonly lastModified: string };

// CPython derives st_mtime as sec + nsec * 1e-9 in double arithmetic.
function pythonMtime(stats: BigIntStats): number {
  const nanosecondsPerSecond = 1_000_000_000n;
  return (
    Number(stats.mtimeNs / nanosecondsPerSecond) +
    Number(stats.mtimeNs % nanosecondsPerSecond) * 1e-9
  );
}

export function fileValidators(stats: BigIntStats): Validators {
  const mtime = pythonMtime(stats);
  const digest = createHash("md5")
    .update(`${pyRepr(mtime)}-${stats.size}`)
    .digest("hex");
  return {
    etag: `"${digest}"`,
    lastModified: new Date(Math.floor(mtime) * 1000).toUTCString(),
  };
}

export function isNotModified(
  headers: Request["headers"],
  validators: Validators,
): boolean {
  const ifNoneMatch = headers["if-none-match"];
  if (ifNoneMatch) {
    if (pyStrip(ifNoneMatch) === "*") return true;
    return ifNoneMatch
      .split(",")
      .map((tag) => pyStrip(tag).replace(/^W\//, ""))
      .includes(validators.etag);
  }
  const ifModifiedSince = Date.parse(headers["if-modified-since"] ?? "");
  return (
    !Number.isNaN(ifModifiedSince) &&
    ifModifiedSince >= Date.parse(validators.lastModified)
  );
}

export async function sendStaticFile(
  req: Request,
  res: Response,
  file: StaticFile,
  headers: HeaderRecord,
): Promise<void> {
  const validators = fileValidators(file.stats);
  for (const [name, value] of Object.entries(headers)) {
    res.setHeader(name, value);
  }
  res.setHeader("ETag", validators.etag);
  if (isNotModified(req.headers, validators)) {
    res.statusCode = 304;
    res.end();
    return;
  }
  res.setHeader("Content-Type", contentTypeFor(file.path));
  res.setHeader("Last-Modified", validators.lastModified);
  if (req.method === "HEAD") {
    res.setHeader("Content-Length", String(file.stats.size));
    res.end();
    return;
  }
  const body = await readFile(file.path);
  res.setHeader("Content-Length", body.length);
  res.end(body);
}

const NOT_FOUND_CODES: ReadonlySet<unknown> = new Set([
  "ENOENT",
  "ENOTDIR",
  "ENAMETOOLONG",
  "ERR_INVALID_ARG_VALUE",
]);
const FORBIDDEN_CODES: ReadonlySet<unknown> = new Set(["EACCES", "EPERM"]);

async function unlessMissing<T>(operation: Promise<T>): Promise<T | undefined> {
  try {
    return await operation;
  } catch (error) {
    const code =
      typeof error === "object" && error !== null && "code" in error
        ? error.code
        : undefined;
    if (NOT_FOUND_CODES.has(code)) return undefined;
    if (FORBIDDEN_CODES.has(code)) {
      throw new HttpException({ detail: "Unauthorized" }, 401);
    }
    throw error;
  }
}

export async function statRegularFile(
  path: string,
): Promise<StaticFile | undefined> {
  const stats = await unlessMissing(stat(path, { bigint: true }));
  return stats?.isFile() ? { path, stats } : undefined;
}

// Mirrors os.path.normpath(os.path.join(*route_path.split("/"))). A path
// that climbs above the root is undefined, as Starlette's commonpath check
// rejects it.
export function normalizeRoutePath(routePath: string): string | undefined {
  const segments: string[] = [];
  for (const segment of routePath.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment !== "..") segments.push(segment);
    else if (segments.pop() === undefined) return undefined;
  }
  return segments.join("/");
}

export async function lookupStaticFile(
  root: string,
  relativePath: string,
): Promise<StaticFile | undefined> {
  const path = await unlessMissing(realpath(join(root, relativePath)));
  if (path === undefined) return undefined;
  if (path !== root && !path.startsWith(`${root}${sep}`)) return undefined;
  return statRegularFile(path);
}

const MOUNT_PREFIX = "/static";

export function staticFilesMount(directory: string): RequestHandler {
  const root = realpathSync(directory);
  return async (req, res, next) => {
    const { rawPath } = splitRequestTarget(req.originalUrl);
    if (!rawPath.startsWith(`${MOUNT_PREFIX}/`)) {
      next();
      return;
    }
    if (req.method !== "GET" && req.method !== "HEAD") {
      throw new HttpException({ detail: "Method Not Allowed" }, 405);
    }
    const relativePath = normalizeRoutePath(
      unquote(rawPath).slice(MOUNT_PREFIX.length),
    );
    const file =
      relativePath === undefined
        ? undefined
        : await lookupStaticFile(root, relativePath);
    if (relativePath === undefined || file === undefined) {
      throw new HttpException({ detail: "Not Found" }, 404);
    }
    await sendStaticFile(req, res, file, {
      ...cacheHeaders(staticFileProfile(relativePath)),
      Vary: "Accept-Encoding",
      "Cache-Tag": "static-files",
    });
  };
}
