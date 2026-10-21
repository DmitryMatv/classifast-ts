import { cacheProfiles, securityHeaders } from "../contract/support/headers.js";
import {
  getOnlyPaths,
  rootFiles,
  retiredPaths,
  type Mode,
  type Probe,
} from "./corpus.js";

export const COMPARED_HEADERS = [
  "cache-control",
  "cloudflare-cdn-cache-control",
  "cache-tag",
  "vary",
  "location",
  "x-robots-tag",
  "link",
  "etag",
  "last-modified",
  "content-type",
  "content-encoding",
  "content-disposition",
  "set-cookie",
  ...(Object.keys(securityHeaders) as (keyof typeof securityHeaders)[]),
] as const;

export type Field = "status" | "body" | (typeof COMPARED_HEADERS)[number];

// A divergence can never excuse a missing security header or a cookie.
type ExplainableField = Exclude<
  Field,
  "set-cookie" | keyof typeof securityHeaders
>;

// A string or null matches exactly, a list matches any member, and a
// RegExp matches any present value it accepts.
type Single = string | null | RegExp;
type Expected = Single | readonly Single[];

export type Difference = {
  readonly field: Field;
  readonly python: string | null;
  readonly nest: string | null;
};

export type Divergence = {
  readonly name: string;
  readonly reason: string;
  readonly modes?: readonly Mode[];
  readonly matches: (probe: Probe) => boolean;
  // The fields allowed to differ, each with the [Python, Nest] values the
  // decision produces. Bodies compare as described in routes.parity.ts.
  readonly differences: Partial<
    Record<ExplainableField, readonly [python: Expected, nest: Expected]>
  >;
};

function fits(value: string | null, expected: Expected): boolean {
  if (expected instanceof RegExp) return value !== null && expected.test(value);
  if (Array.isArray(expected)) {
    return expected.some((option: Single) => fits(value, option));
  }
  return value === expected;
}

const present = /^[\s\S]+$/;
const pathOnly = (probe: Probe) => probe.path.split("?")[0]!;
const nestNotFound =
  /^\d+ bytes, sha256 \w+: \{"detail":"(Type|Classifier) '[^']+' not found"\}$/;

// Decided differences between the apps, each from AGENTS.md. A difference
// that no entry explains fails the suite, and so does an entry that no
// probe in its modes produces. The payment routes' NO_STORE divergence has
// no entry: it shows only on POST, which the corpus never sends.
export const KNOWN_DIVERGENCES: readonly Divergence[] = [
  {
    name: "retired routes",
    reason:
      "Nest does not port FastAPI's /docs, /redoc and /openapi.json, or " +
      "/llms.txt; the classifier catch-all answers them with 404 " +
      "(retiredRoutes in the contract suite). Python's /llms.txt route " +
      "answers its own 404, which is too short to gzip.",
    matches: (probe) => retiredPaths.includes(probe.path),
    differences: {
      status: ["200", "404"],
      "content-type": ["text/html; charset=utf-8", "application/json"],
      body: [
        /^line 1:\n<!DOCTYPE html>|^\d+ bytes, sha256 \w+: (\{"openapi":|\{"detail":"File not found"\}$)/,
        ["empty", nestNotFound],
      ],
      vary: [null, "accept-encoding"],
      "content-encoding": [null, "gzip"],
    },
  },
  {
    name: "HEAD on GET-only routes",
    reason:
      "Python declares HEAD only on page routes, so HEAD elsewhere falls " +
      "through to the classifier catch-all (404, or 301 for a fragment). " +
      "Nest answers HEAD like GET with an empty body; routes.parity.ts " +
      "checks that against Nest's own GET.",
    matches: (probe) =>
      probe.method === "HEAD" &&
      (getOnlyPaths.includes(probe.path) ||
        /^\/[^/]+\/fragment$/.test(pathOnly(probe))),
    differences: {
      status: [
        ["404", "301"],
        ["200", "503"],
      ],
      location: [/^\/[^/]+\/fragment\/\?/, null],
      "content-type": [["application/json", null], present],
      "content-encoding": ["gzip", null],
      vary: [
        ["accept-encoding", null],
        ["accept-encoding", null],
      ],
      "cache-control": [null, present],
      "cloudflare-cdn-cache-control": [null, present],
      "cache-tag": [null, "static-files"],
      etag: [null, /^"[^"]+"$/],
      "last-modified": [null, present],
      "content-disposition": [null, /^attachment; filename="[^"]+"$/],
    },
  },
  {
    name: ".gif and .webmanifest are STATIC_MEDIA",
    reason:
      "Python's get_static_cache_profile omits .gif and .webmanifest, so " +
      "they fall through to STATIC_TEXT; the Nest port serves them as media.",
    matches: (probe) => /^\/static\/.*\.(gif|webmanifest)$/.test(probe.path),
    differences: {
      "cache-control": [
        cacheProfiles.STATIC_TEXT.cacheControl,
        cacheProfiles.STATIC_MEDIA.cacheControl,
      ],
      "cloudflare-cdn-cache-control": [
        cacheProfiles.STATIC_TEXT.cloudflare,
        cacheProfiles.STATIC_MEDIA.cloudflare,
      ],
    },
  },
  {
    name: "If-None-Match on root files",
    reason:
      "Nest answers If-None-Match on /favicon.ico, /robots.txt and " +
      "/sitemap.xml with 304, as /static files do; Python's FileResponse " +
      "routes ignore the header and answer 200. HTTP allows both. AGENTS.md " +
      "names If-None-Match: *; a matching ETag takes the same path. The " +
      "304 omits the entity headers the 200 carries.",
    matches: (probe) =>
      rootFiles.includes(probe.path) &&
      (probe.conditional === true || probe.headers?.["if-none-match"] === "*"),
    differences: {
      status: ["200", "304"],
      "content-type": [present, null],
      "last-modified": [present, null],
      vary: ["accept-encoding", null],
      "content-encoding": ["gzip", null],
      body: [/^[1-9]\d* bytes/, "empty"],
    },
  },
  {
    name: "RapidAPI ping database in public mode",
    reason:
      "Nest cannot boot without Qdrant, so its public-mode ping reports the " +
      'database as "healthy" where Python, with no lifespan, reports ' +
      '"unavailable".',
    modes: ["public"],
    matches: (probe) =>
      probe.method === "GET" && probe.path === "/api/v1/rapid/ping",
    differences: {
      body: [/"database":"unavailable"/, /"database":"healthy"/],
    },
  },
  {
    name: "encoded ? or # in a classifier slug",
    reason:
      "Python rebuilds its redirect from the decoded URL, so an encoded ? " +
      "or # splits the path there; Nest keeps the request's own query string.",
    matches: (probe) => /%(3F|23)/i.test(pathOnly(probe)),
    differences: {
      location: [
        ["/UNSPSC/ab/?b/", "/UNSPSC/ab/"],
        ["/UNSPSC/ab/", "/UNSPSC/ab/?x=1"],
      ],
    },
  },
];

export function explain(
  mode: Mode,
  probe: Probe,
  { field, python, nest }: Difference,
): Divergence | undefined {
  return KNOWN_DIVERGENCES.find((divergence) => {
    if (!(divergence.modes?.includes(mode) ?? true)) return false;
    if (!divergence.matches(probe)) return false;
    const allowed =
      divergence.differences[field as keyof Divergence["differences"]];
    return (
      allowed !== undefined &&
      fits(python, allowed[0]) &&
      fits(nest, allowed[1])
    );
  });
}
