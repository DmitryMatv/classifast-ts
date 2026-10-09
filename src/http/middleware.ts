import { gzip } from "node:zlib";
import { HttpException, Logger } from "@nestjs/common";
import type { Request, RequestHandler, Response } from "express";
import { pyRepr } from "../python/float-repr.js";
import { pyStrip } from "../python/str.js";
import { unquote } from "../python/urllib.js";
import {
  canonicalQuery,
  isSuspiciousRequestUrl,
  parseQueryString,
} from "../web/request-url.js";
import type { HeaderRecord } from "./cache-profiles.js";
import { compressionPlan, GZIP_EXCLUDED_PATHS } from "./gzip.js";

const logger = new Logger("HTTP");

export const SECURITY_HEADERS: HeaderRecord = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
  "X-XSS-Protection": "1; mode=block",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "geolocation=(), microphone=(), camera=()",
  "Content-Security-Policy":
    "default-src 'self'; " +
    "script-src 'self' 'unsafe-inline' https://cdn.tailwindcss.com https://unpkg.com https://www.googletagmanager.com https://www.google-analytics.com https://static.cloudflareinsights.com https://*.clerk.com https://clerk.classifast.com https://accounts.google.com https://challenges.cloudflare.com https://ajax.cloudflare.com; " +
    "script-src-elem 'self' 'unsafe-inline' https://cdn.tailwindcss.com https://unpkg.com https://www.googletagmanager.com https://www.google-analytics.com https://static.cloudflareinsights.com https://*.clerk.com https://clerk.classifast.com https://accounts.google.com https://challenges.cloudflare.com https://ajax.cloudflare.com; " +
    "worker-src 'self' blob:; " +
    "style-src 'self' 'unsafe-inline' https://cdn.tailwindcss.com https://fonts.googleapis.com; " +
    "style-src-elem 'self' 'unsafe-inline' https://cdn.tailwindcss.com https://fonts.googleapis.com https://accounts.google.com/gsi/style; " +
    "img-src 'self' data: https: https://*.googleapis.com https://*.gstatic.com https://*.clerk.com https://clerk.classifast.com; " +
    "font-src 'self' https://fonts.gstatic.com https://*.googleapis.com https://*.gstatic.com; " +
    "connect-src 'self' https: https://*.clerk.com https://accounts.google.com https://accounts.google.com/gsi/ https://*.googleapis.com https://challenges.cloudflare.com; " +
    "frame-src 'self' https://accounts.google.com https://challenges.cloudflare.com; " +
    "base-uri 'self'; " +
    "form-action 'self'; " +
    "manifest-src 'self'; " +
    "object-src 'none'; " +
    "frame-ancestors 'none'; " +
    "upgrade-insecure-requests;",
};

export const INVALID_ENCODING_BODY = {
  detail: "Request rejected due to suspicious URL encoding patterns",
  error: "INVALID_ENCODING",
} as const;

export function splitRequestTarget(target: string): {
  rawPath: string;
  rawQuery: string;
} {
  const question = target.indexOf("?");
  return question === -1
    ? { rawPath: target, rawQuery: "" }
    : {
        rawPath: target.slice(0, question),
        rawQuery: target.slice(question + 1),
      };
}

const FORWARDED_SCHEMES: ReadonlySet<string> = new Set([
  "http",
  "https",
  "ws",
  "wss",
]);

// uvicorn runs with --forwarded-allow-ips "*", so Python trusts the last
// X-Forwarded-Proto header when it builds the redirect URL.
function requestScheme(req: Request): string {
  const forwarded = req.headersDistinct["x-forwarded-proto"]?.at(-1);
  const scheme = forwarded === undefined ? undefined : pyStrip(forwarded);
  if (scheme !== undefined && FORWARDED_SCHEMES.has(scheme)) return scheme;
  return "encrypted" in req.socket && req.socket.encrypted ? "https" : "http";
}

// Starlette routes on the percent-decoded path, so /robots%2Etxt serves
// robots.txt and %2F separates segments. Express matches req.url, so it gets
// the decoded path with only the characters that would change its parse
// re-encoded. req.originalUrl keeps the raw target.
export const routeOnDecodedPath: RequestHandler = (req, _res, next) => {
  const { rawPath } = splitRequestTarget(req.originalUrl);
  const path = unquote(rawPath).replace(
    /[%?#]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  req.url = path + req.originalUrl.slice(rawPath.length);
  next();
};

export const setSecurityHeaders: RequestHandler = (_req, res, next) => {
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    res.setHeader(name, value);
  }
  next();
};

export const redirectToCanonicalQuery: RequestHandler = (req, res, next) => {
  const { rawPath, rawQuery } = splitRequestTarget(req.originalUrl);
  const query = canonicalQuery(parseQueryString(rawQuery));
  if (query === undefined) {
    next();
    return;
  }
  // Starlette builds request.url from the percent-decoded path. A character
  // above U+00FF makes setHeader throw, and Python answers 500 there too.
  const target = `${unquote(rawPath)}?${query}`;
  const host = req.headers.host;
  logger.log(`Redirecting to normalized URL for path: ${rawPath}`);
  res.statusCode = 308;
  res.setHeader(
    "Location",
    host ? `${requestScheme(req)}://${host}${target}` : target,
  );
  res.setHeader("Content-Length", 0);
  res.end();
};

export const rejectSuspiciousUrls: RequestHandler = (req, _res, next) => {
  const { rawPath, rawQuery } = splitRequestTarget(req.originalUrl);
  if (isSuspiciousRequestUrl(unquote(rawPath), rawQuery)) {
    logger.warn(`Rejected suspicious URL: ${req.originalUrl.slice(0, 100)}...`);
    throw new HttpException(INVALID_ENCODING_BODY, 400);
  }
  next();
};

type End = (
  chunk?: unknown,
  encoding?: unknown,
  callback?: unknown,
) => Response;

function bodyBytes(chunk: unknown, encoding: unknown): Buffer {
  if (typeof chunk === "string") {
    return Buffer.from(
      chunk,
      typeof encoding === "string" ? (encoding as BufferEncoding) : "utf8",
    );
  }
  return chunk instanceof Uint8Array ? Buffer.from(chunk) : Buffer.alloc(0);
}

// Responses written in several chunks pass through untouched. Every handler
// here sends its body with one end() call.
export const gzipResponses: RequestHandler = (req, res, next) => {
  if (GZIP_EXCLUDED_PATHS.has(req.path)) {
    next();
    return;
  }
  const acceptsGzip = (req.headers["accept-encoding"] ?? "").includes("gzip");
  const write = res.write.bind(res);
  const end = res.end.bind(res) as End;
  let streamed = false;
  res.write = ((...args: Parameters<typeof write>) => {
    streamed = true;
    return write(...args);
  }) as typeof res.write;
  res.end = ((chunk?: unknown, encoding?: unknown, callback?: unknown) => {
    if (streamed || res.headersSent || typeof chunk === "function") {
      return end(chunk, encoding, callback);
    }
    const body = bodyBytes(chunk, encoding);
    const plan = compressionPlan({
      acceptsGzip,
      status: res.statusCode,
      contentType: res.getHeader("Content-Type")?.toString(),
      hasContentEncoding: res.hasHeader("Content-Encoding"),
      bodyLength: body.length,
    });
    if (plan === "untouched") return end(chunk, encoding, callback);
    const vary = res.getHeader("Vary")?.toString();
    res.setHeader(
      "Vary",
      vary ? `${vary}, Accept-Encoding` : "Accept-Encoding",
    );
    if (plan === "vary") return end(chunk, encoding, callback);
    const done = typeof encoding === "function" ? encoding : callback;
    gzip(body, { level: 9 }, (error, compressed) => {
      if (error) {
        res.destroy(error);
        return;
      }
      res.setHeader("Content-Encoding", "gzip");
      res.setHeader("Content-Length", compressed.length);
      end(compressed, done);
    });
    return res;
  }) as typeof res.end;
  next();
};

export const recordProcessTime: RequestHandler = (_req, res, next) => {
  const started = performance.now();
  const writeHead = res.writeHead.bind(res);
  res.writeHead = ((...args: Parameters<typeof writeHead>) => {
    res.setHeader(
      "X-Process-Time",
      pyRepr((performance.now() - started) / 1000),
    );
    return writeHead(...args);
  }) as typeof res.writeHead;
  next();
};
