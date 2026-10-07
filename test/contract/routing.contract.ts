import { z } from "zod";
import {
  expectStatus,
  locationOf,
  parseJson,
  send,
  type Method,
} from "./support/http.js";

type RedirectCase = {
  path: string;
  status: 301 | 308;
  location: string;
  methods: readonly Method[];
};

const both = ["GET", "HEAD"] as const;
const getOnly = ["GET"] as const;

const redirects: RedirectCase[] = [
  // Trailing slash and legacy /mappings paths, query string preserved.
  { path: "/mapping", status: 301, location: "/mapping/", methods: both },
  {
    path: "/mapping?x=1",
    status: 301,
    location: "/mapping/?x=1",
    methods: both,
  },
  { path: "/mappings", status: 301, location: "/mapping/", methods: both },
  { path: "/mappings/", status: 301, location: "/mapping/", methods: both },
  {
    path: "/mapping/unspsc-to-cpv-mapping",
    status: 301,
    location: "/mapping/unspsc-to-cpv-mapping/",
    methods: both,
  },
  {
    path: "/mapping/unspsc-to-cpv-mapping?x=1",
    status: 301,
    location: "/mapping/unspsc-to-cpv-mapping/?x=1",
    methods: both,
  },
  {
    path: "/mappings/unspsc-to-cpv-mapping",
    status: 301,
    location: "/mapping/unspsc-to-cpv-mapping/",
    methods: both,
  },
  {
    path: "/mappings/unspsc-to-cpv-mapping/",
    status: 301,
    location: "/mapping/unspsc-to-cpv-mapping/",
    methods: both,
  },
  {
    path: "/mappings/unspsc-to-cpv-mapping/sample",
    status: 301,
    location: "/mapping/unspsc-to-cpv-mapping/sample",
    methods: getOnly,
  },
  // Classifier type case and trailing slash.
  { path: "/UNSPSC", status: 301, location: "/UNSPSC/", methods: both },
  { path: "/unspsc", status: 301, location: "/UNSPSC/", methods: both },
  { path: "/unspsc/", status: 301, location: "/UNSPSC/", methods: both },
  {
    path: "/UNSPSC?top_k=5",
    status: 301,
    location: "/UNSPSC/?top_k=5",
    methods: both,
  },
  { path: "/UNSPSC//", status: 301, location: "/UNSPSC/", methods: both },
  // Query slugs: spaces and slashes become underscores, a hyphenated slug
  // whose underscore form is in the sitemap moves there.
  {
    path: "/UNSPSC/laptop_computer",
    status: 301,
    location: "/UNSPSC/laptop_computer/",
    methods: both,
  },
  {
    path: "/UNSPSC/laptop_computer?top_k=5",
    status: 301,
    location: "/UNSPSC/laptop_computer/?top_k=5",
    methods: both,
  },
  {
    path: "/unspsc/laptop_computer/",
    status: 301,
    location: "/UNSPSC/laptop_computer/",
    methods: both,
  },
  {
    path: "/UNSPSC/laptop%20computer/",
    status: 301,
    location: "/UNSPSC/laptop_computer/",
    methods: both,
  },
  {
    path: "/UNSPSC/laptop-computer/",
    status: 301,
    location: "/UNSPSC/laptop_computer/",
    methods: both,
  },
  {
    path: "/UNSPSC/a%20%20b/",
    status: 301,
    location: "/UNSPSC/a_b/",
    methods: both,
  },
  {
    path: "/UNSPSC/foo/bar/",
    status: 301,
    location: "/UNSPSC/foo_bar/",
    methods: both,
  },
  // Query normalization: collapse whitespace runs, strip ends, re-encode
  // spaces as %20 and keep ()*,: literal. It runs before routing.
  {
    path: "/UNSPSC/?a=%20x(1),y:z*%20",
    status: 308,
    location: "/UNSPSC/?a=x(1),y:z*",
    methods: both,
  },
  {
    path: "/UNSPSC/?a=x%20%20y&b=1&a=%20z",
    status: 308,
    location: "/UNSPSC/?a=x%20y&b=1&a=z",
    methods: both,
  },
  {
    path: "/UNSPSC/laptop_computer/?top_k=%205",
    status: 308,
    location: "/UNSPSC/laptop_computer/?top_k=5",
    methods: both,
  },
  {
    path: "/?q=caf%C3%A9%20%20",
    status: 308,
    location: "/?q=caf%C3%A9",
    methods: both,
  },
  { path: "/?q=a++b", status: 308, location: "/?q=a%20b", methods: both },
  {
    path: "/UNSPSC/fragment?product_description=%20laptop%0A%20computer%20",
    status: 308,
    location: "/UNSPSC/fragment?product_description=laptop%20computer",
    methods: getOnly,
  },
  { path: "/NOPE/?q=%20x", status: 308, location: "/NOPE/?q=x", methods: both },
];

const redirectRequests = redirects.flatMap((redirect) =>
  redirect.methods.map((method) => ({ ...redirect, method })),
);

describe("redirects", () => {
  it.each(redirectRequests)(
    "$method $path -> $status $location",
    async ({ path, method, status, location }) => {
      const reply = await send(path, { method });
      expectStatus(reply, status);
      expect(locationOf(reply), `${reply.label} Location`).toBe(location);
    },
  );
});

type ErrorCase = { path: string; status: number; method?: Method };

const errors: ErrorCase[] = [
  // Removed classifiers answer 410 Gone so crawlers deindex them.
  { path: "/GMDN", status: 410 },
  { path: "/GMDN/", status: 410 },
  { path: "/gmdn", status: 410 },
  { path: "/GMDN/x/", status: 410 },
  { path: "/GMDN/", status: 410, method: "HEAD" },
  { path: "/GMDN/fragment?product_description=", status: 410 },
  { path: "/NOPE", status: 404 },
  { path: "/NOPE/", status: 404 },
  { path: "/NOPE/x/", status: 404 },
  { path: "/NOPE/", status: 404, method: "HEAD" },
  { path: "/NOPE/fragment?product_description=", status: 404 },
  { path: "/mapping/nope", status: 404 },
  { path: "/mapping/nope/", status: 404 },
  { path: "/mapping/nope/sample", status: 404 },
  { path: "/mappings/nope", status: 404 },
  { path: "/mappings/nope/", status: 404 },
  { path: "/mappings/nope/sample", status: 404 },
  { path: "/static/nope.js", status: 404 },
  { path: "/static/", status: 404 },
  // POST-only routes do not answer GET.
  { path: "/api/webhooks/polar", status: 404 },
  { path: "/api/create-checkout", status: 404 },
  { path: "/api/create-mapping-checkout", status: 404 },
  // Debug headers stay hidden unless DEBUG_MODE=true.
  { path: "/api/v1/rapid/debug-headers", status: 404 },
];

const detailBody = z.object({ detail: z.string().min(1) });

describe("error statuses", () => {
  it.each(errors)(
    "$method $path -> $status",
    async ({ path, status, method }) => {
      const reply = await send(path, { method: method ?? "GET" });
      expectStatus(reply, status);
      if (method === "HEAD") return;
      expect(() => detailBody.parse(parseJson(reply))).not.toThrow();
    },
  );
});

const invalidFragmentQueries = [
  "/UNSPSC/fragment",
  "/UNSPSC/fragment?product_description=&top_k=0",
  "/UNSPSC/fragment?product_description=&top_k=101",
  "/UNSPSC/fragment?product_description=&top_k=abc",
];

describe("fragment query validation", () => {
  it.each(invalidFragmentQueries)("GET %s -> 422", async (path) => {
    const reply = await send(path);
    expectStatus(reply, 422);
    parseJson(reply);
  });
});

function urlOfLength(length: number): string {
  return `/UNSPSC/?q=${"z".repeat(length - "/UNSPSC/q=".length)}`;
}

const suspiciousUrls = [
  // The limit counts the raw path plus query: "/UNSPSC/" and "q=" are 10.
  { name: "path and query over 4000 characters", path: urlOfLength(4001) },
  { name: "triple-encoded percent", path: "/?q=%25%25%25" },
  { name: "50 consecutive digits", path: `/?q=${"1".repeat(50)}` },
  { name: "repeated digit pattern", path: `/?q=${"12".repeat(17)}` },
  { name: "encoded <<", path: "/?q=%3c%3c" },
  { name: "64 hex characters", path: `/?q=${"a".repeat(64)}` },
  { name: "spam signature in a path", path: "/UNSPSC/copyOriginalId/" },
  { name: "spam signature in a query", path: "/?q=UnblockHandlers" },
];

describe("URL validation", () => {
  it.each(suspiciousUrls)("$name -> 400", async ({ path }) => {
    const reply = await send(path);
    expectStatus(reply, 400);
    expect(parseJson(reply)).toEqual({
      detail: "Request rejected due to suspicious URL encoding patterns",
      error: "INVALID_ENCODING",
    });
  });

  it("path and query of exactly 4000 characters pass", async () => {
    const reply = await send(urlOfLength(4000));
    expectStatus(reply, 200);
  });
});

// Python declares HEAD only on page routes. HEAD on a GET-only route falls
// through to the classifier catch-all, which answers as if the first path
// segment were a classifier type.
const headOnGetOnlyRoutes: {
  path: string;
  status: number;
  location?: string;
}[] = [
  { path: "/robots.txt", status: 404 },
  { path: "/sitemap.xml", status: 404 },
  { path: "/favicon.ico", status: 404 },
  { path: "/health", status: 404 },
  { path: "/mapping/unspsc-to-cpv-mapping/sample", status: 404 },
  { path: "/api/v1/rapid/ping", status: 404 },
  {
    path: "/UNSPSC/fragment?product_description=",
    status: 301,
    location: "/UNSPSC/fragment/?product_description=",
  },
];

describe("HEAD on GET-only routes", () => {
  it.each(headOnGetOnlyRoutes)(
    "HEAD $path -> $status",
    async ({ path, status, location }) => {
      const reply = await send(path, { method: "HEAD" });
      expectStatus(reply, status);
      expect(locationOf(reply), `${reply.label} Location`).toBe(
        location ?? null,
      );
    },
  );
});

const methodNotAllowed = [
  "/",
  "/UNSPSC/",
  "/UNSPSC/laptop_computer/",
  "/mapping/",
  "/robots.txt",
  "/health",
];

describe("unsupported methods", () => {
  it.each(methodNotAllowed)("POST %s -> 405", async (path) => {
    const reply = await send(path, { method: "POST" });
    expectStatus(reply, 405);
    expect(parseJson(reply)).toEqual({ detail: "Method Not Allowed" });
  });
});
