import { createHash, randomBytes } from "node:crypto";
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
import { pyRepr } from "../python/float-repr.js";
import { pyInt } from "../python/numbers.js";
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

// Starlette's FileResponse range handling. Ranges are [start, end) pairs.
export type ByteRange = readonly [start: number, end: number];

export type RangeRequest =
  | { readonly kind: "whole" }
  | { readonly kind: "partial"; readonly ranges: readonly ByteRange[] }
  | { readonly kind: "malformed"; readonly message: string }
  | { readonly kind: "unsatisfiable" };

const MAX_RANGES = 100;

function parseRanges(spec: string, size: number): ByteRange[] {
  const ranges: ByteRange[] = [];
  for (const rawPart of spec.split(",")) {
    const part = pyStrip(rawPart);
    if (part === "" || part === "-" || !part.includes("-")) continue;
    const dash = part.indexOf("-");
    const startText = pyStrip(part.slice(0, dash));
    const endText = pyStrip(part.slice(dash + 1));
    const startValue = startText === "" ? undefined : pyInt(startText);
    const endValue = endText === "" ? undefined : pyInt(endText);
    if (startText !== "" && startValue === undefined) continue;
    if (endText !== "" && endValue === undefined) continue;
    if (startValue === undefined) {
      if (endValue === undefined) continue;
      ranges.push([Math.max(size - Number(endValue), 0), size]);
      continue;
    }
    const end =
      endValue !== undefined && endValue < BigInt(size)
        ? Number(endValue) + 1
        : size;
    ranges.push([Number(startValue), end]);
  }
  return ranges;
}

export function parseRangeHeader(header: string, size: number): RangeRequest {
  const equals = header.indexOf("=");
  if (equals === -1) {
    return { kind: "malformed", message: "Malformed range header." };
  }
  if (pyStrip(header.slice(0, equals)).toLowerCase() !== "bytes") {
    return { kind: "malformed", message: "Only support bytes range" };
  }
  const spec = header.slice(equals + 1);
  if (spec.split(",").length > MAX_RANGES) return { kind: "whole" };
  const ranges = parseRanges(spec, size);
  if (ranges.length === 0) {
    return {
      kind: "malformed",
      message: "Range header: range must be requested",
    };
  }
  if (ranges.some(([start]) => !(start >= 0 && start < size))) {
    return { kind: "unsatisfiable" };
  }
  if (ranges.some(([start, end]) => start >= end)) {
    return {
      kind: "malformed",
      message: "Range header: start must be less than end",
    };
  }
  if (ranges.length === 1) return { kind: "partial", ranges };
  const sorted = ranges.toSorted((a, b) => a[0] - b[0] || a[1] - b[1]);
  const merged: [number, number][] = [[...sorted[0]!]];
  for (const [start, end] of sorted.slice(1)) {
    const last = merged.at(-1)!;
    if (start <= last[1]) last[1] = Math.max(last[1], end);
    else merged.push([start, end]);
  }
  return { kind: "partial", ranges: merged };
}

function rangeRequest(
  req: Request,
  validators: Validators,
  size: number,
): RangeRequest {
  const range = req.headersDistinct["range"]?.[0];
  if (range === undefined) return { kind: "whole" };
  const ifRange = req.headersDistinct["if-range"]?.[0];
  if (
    ifRange !== undefined &&
    ifRange !== validators.lastModified &&
    ifRange !== validators.etag
  ) {
    return { kind: "whole" };
  }
  return parseRangeHeader(range, size);
}

// Starlette answers range errors with a fresh PlainTextResponse, so none of
// the file's cache or validator headers apply.
function sendPlainText(
  res: Response,
  status: number,
  text: string,
  headers: HeaderRecord = {},
): void {
  res.statusCode = status;
  for (const [name, value] of Object.entries(headers)) {
    res.setHeader(name, value);
  }
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Content-Length", Buffer.byteLength(text));
  res.end(text);
}

function multipartBody(
  ranges: readonly ByteRange[],
  size: number,
  contentType: string,
  body: Buffer | undefined,
): { boundary: string; parts: Buffer[]; length: number } {
  const boundary = randomBytes(13).toString("hex");
  const parts: Buffer[] = [];
  let length = 0;
  for (const [start, end] of ranges) {
    const head = Buffer.from(
      `--${boundary}\r\nContent-Type: ${contentType}\r\n` +
        `Content-Range: bytes ${start}-${end - 1}/${size}\r\n\r\n`,
      "latin1",
    );
    parts.push(head, body?.subarray(start, end) ?? Buffer.alloc(0));
    parts.push(Buffer.from("\r\n"));
    length += head.length + (end - start) + 2;
  }
  const tail = Buffer.from(`--${boundary}--`, "latin1");
  parts.push(tail);
  return { boundary, parts, length: length + tail.length };
}

export async function sendStaticFile(
  req: Request,
  res: Response,
  file: StaticFile,
  headers: HeaderRecord,
): Promise<void> {
  const validators = fileValidators(file.stats);
  const size = Number(file.stats.size);
  if (isNotModified(req.headers, validators)) {
    for (const [name, value] of Object.entries(headers)) {
      res.setHeader(name, value);
    }
    res.setHeader("ETag", validators.etag);
    res.statusCode = 304;
    res.end();
    return;
  }
  const range = rangeRequest(req, validators, size);
  if (range.kind === "malformed") {
    sendPlainText(res, 400, range.message);
    return;
  }
  if (range.kind === "unsatisfiable") {
    sendPlainText(res, 416, "", { "Content-Range": `bytes */${size}` });
    return;
  }
  const contentType = contentTypeFor(file.path);
  for (const [name, value] of Object.entries(headers)) {
    res.setHeader(name, value);
  }
  res.setHeader("ETag", validators.etag);
  res.setHeader("Content-Type", contentType);
  res.setHeader("Last-Modified", validators.lastModified);
  res.setHeader("Accept-Ranges", "bytes");
  const body = req.method === "HEAD" ? undefined : await readFile(file.path);
  if (range.kind === "whole") {
    res.setHeader("Content-Length", body?.length ?? size);
    res.end(body);
    return;
  }
  res.statusCode = 206;
  if (range.ranges.length === 1) {
    const [start, end] = range.ranges[0]!;
    res.setHeader("Content-Range", `bytes ${start}-${end - 1}/${size}`);
    res.setHeader("Content-Length", end - start);
    res.end(body?.subarray(start, end));
    return;
  }
  const multipart = multipartBody(range.ranges, size, contentType, body);
  res.setHeader(
    "Content-Type",
    `multipart/byteranges; boundary=${multipart.boundary}`,
  );
  res.setHeader("Content-Length", multipart.length);
  res.end(body && Buffer.concat(multipart.parts));
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
