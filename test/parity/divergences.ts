import { securityHeaders } from "../contract/support/headers.js";
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

export type Divergence = {
  readonly name: string;
  readonly reason: string;
  readonly modes?: readonly Mode[];
  readonly fields: "all" | readonly Field[];
  readonly matches: (probe: Probe) => boolean;
};

const cacheProfile: readonly Field[] = [
  "cache-control",
  "cloudflare-cdn-cache-control",
];

const pathOnly = (probe: Probe) => probe.path.split("?")[0]!;

// Decided differences between the apps, each from AGENTS.md. A difference
// that no entry explains fails the suite, and so does an entry that no
// probe in its modes produces. The payment routes' NO_STORE divergence has
// no entry: it shows only on POST, which the corpus never sends.
export const KNOWN_DIVERGENCES: readonly Divergence[] = [
  {
    name: "retired routes",
    reason:
      "Nest does not port FastAPI's /docs, /redoc and /openapi.json, or " +
      "/llms.txt; they answer 404 (retiredRoutes in the contract suite).",
    fields: "all",
    matches: (probe) => retiredPaths.includes(probe.path),
  },
  {
    name: "HEAD on GET-only routes",
    reason:
      "Python declares HEAD only on page routes, so HEAD elsewhere falls " +
      "through to the classifier catch-all (404, or 301 for a fragment). " +
      "Nest answers HEAD like GET with an empty body.",
    fields: "all",
    matches: (probe) =>
      probe.method === "HEAD" &&
      (getOnlyPaths.includes(probe.path) ||
        /^\/[^/]+\/fragment$/.test(pathOnly(probe))),
  },
  {
    name: ".gif and .webmanifest are STATIC_MEDIA",
    reason:
      "Python's get_static_cache_profile omits .gif and .webmanifest, so " +
      "they fall through to STATIC_TEXT; the Nest port serves them as media.",
    fields: cacheProfile,
    matches: (probe) => /^\/static\/.*\.(gif|webmanifest)$/.test(probe.path),
  },
  {
    name: "If-None-Match on root files",
    reason:
      "Nest answers If-None-Match on /favicon.ico, /robots.txt and " +
      "/sitemap.xml with 304, as /static files do; Python's FileResponse " +
      "routes ignore the header and answer 200. HTTP allows both. AGENTS.md " +
      "names If-None-Match: *; a matching ETag takes the same path.",
    fields: "all",
    matches: (probe) =>
      rootFiles.includes(probe.path) &&
      (probe.conditional === true || probe.headers?.["if-none-match"] === "*"),
  },
  {
    name: "RapidAPI ping database in public mode",
    reason:
      "Nest cannot boot without Qdrant, so its public-mode ping reports the " +
      'database as "healthy" where Python, with no lifespan, reports ' +
      '"unavailable".',
    modes: ["public"],
    fields: ["body"],
    matches: (probe) =>
      probe.method === "GET" && probe.path === "/api/v1/rapid/ping",
  },
  {
    name: "encoded ? or # in a classifier slug",
    reason:
      "Python rebuilds its redirect from the decoded URL, so an encoded ? " +
      "or # splits the path there; Nest keeps the request's own query string.",
    fields: ["location"],
    matches: (probe) => /%(3F|23)/i.test(pathOnly(probe)),
  },
];

export function explain(
  mode: Mode,
  probe: Probe,
  field: Field,
): Divergence | undefined {
  return KNOWN_DIVERGENCES.find(
    (divergence) =>
      (divergence.modes?.includes(mode) ?? true) &&
      (divergence.fields === "all" || divergence.fields.includes(field)) &&
      divergence.matches(probe),
  );
}
