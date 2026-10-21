import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { CLASSIFIER_TYPES } from "../../src/classifier/classifier-config.js";

export const APPS = ["python", "nest"] as const;
export type App = (typeof APPS)[number];
export type Mode = "public" | "full";

export type Probe = {
  readonly method: "GET" | "HEAD";
  readonly path: string;
  readonly headers?: Readonly<Record<string, string>>;
  // Revalidate with the ETag that each app returned for a plain GET.
  readonly conditional?: true;
};

export function probeLabel(probe: Probe): string {
  const headers = Object.entries(probe.headers ?? {}).map(
    ([name, value]) =>
      ` [${name}: ${value.length > 40 ? `<${value.length} bytes>` : value}]`,
  );
  const conditional = probe.conditional ? " [if-none-match: <etag>]" : "";
  return `${probe.method} ${probe.path}${headers.join("")}${conditional}`;
}

const root = resolve(import.meta.dirname, "../..");
const staticRoot = join(root, "app/static");

// Base classifier pages server-render the example through the live
// pipeline; pages.json pins them instead.
export function isBaseClassifierPage(path: string): boolean {
  const match = /^\/([^/?]+)\/(?:\?.*)?$/.exec(path);
  return match !== null && CLASSIFIER_TYPES.has(match[1]!);
}

function sitemapPaths(): string[] {
  const xml = readFileSync(join(staticRoot, "sitemap.xml"), "utf8");
  return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(
    (match) => new URL(match[1]!).pathname,
  );
}

function staticFiles(dir = staticRoot): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory()
      ? staticFiles(path)
      : [`/static/${relative(staticRoot, path)}`];
  });
}

const both = (path: string): Probe[] => [
  { method: "GET", path },
  { method: "HEAD", path },
];

export const rootFiles = ["/robots.txt", "/sitemap.xml", "/favicon.ico"];

export const retiredPaths = [
  "/docs",
  "/docs/oauth2-redirect",
  "/redoc",
  "/openapi.json",
  "/llms.txt",
];

export const paymentPaths = [
  "/api/create-checkout",
  "/api/create-mapping-checkout",
  "/api/webhooks/polar",
];

export const getOnlyPaths = [
  ...rootFiles,
  "/health",
  "/api/v1/rapid/ping",
  "/mapping/unspsc-to-cpv-mapping/sample",
  "/mapping/cpv-to-unspsc-mapping/sample",
];

const emptyFragment = "fragment?product_description=";

// Validation errors and empty descriptions only: none of these classify.
const fragmentProbes: Probe[] = [
  ...[...CLASSIFIER_TYPES].map((type): Probe => ({
    method: "GET",
    path: `/${type}/${emptyFragment}`,
  })),
  ...[
    "/UNSPSC/fragment",
    `/UNSPSC/${emptyFragment}&top_k=0`,
    `/UNSPSC/${emptyFragment}&top_k=101`,
    `/UNSPSC/${emptyFragment}&top_k=abc`,
    `/UNSPSC/${emptyFragment}&top_k=5`,
    `/UNSPSC/${emptyFragment}&version=nope`,
    `/UNSPSC/${emptyFragment}&push_url=false`,
    `/UNSPSC/${emptyFragment}&push_url=maybe`,
    `/UNSPSC/${emptyFragment}&url_change=false`,
    `/UNSPSC/${emptyFragment}&enhance_query=1`,
    `/UNSPSC/${emptyFragment}%20`,
    `/unspsc/${emptyFragment}`,
    `/GMDN/${emptyFragment}`,
    `/NOPE/${emptyFragment}`,
  ].map((path): Probe => ({ method: "GET", path })),
  { method: "HEAD", path: `/UNSPSC/${emptyFragment}` },
];

const redirectAndErrorPaths = [
  "/mapping",
  "/mapping?x=1",
  "/mappings",
  "/mappings/",
  "/mapping/unspsc-to-cpv-mapping",
  "/mappings/unspsc-to-cpv-mapping/",
  "/mappings/unspsc-to-cpv-mapping/sample",
  "/UNSPSC",
  "/unspsc",
  "/unspsc/",
  "/UNSPSC?top_k=5",
  "/UNSPSC//",
  "/UNSPSC/laptop_computer",
  "/UNSPSC/laptop_computer?top_k=5",
  "/unspsc/laptop_computer/",
  "/UNSPSC/laptop_computer/?top_k=5",
  "/UNSPSC/laptop_computer/?top_k=abc",
  "/UNSPSC/laptop%20computer/",
  "/UNSPSC/laptop-computer/",
  "/UNSPSC/laptop+computer/",
  "/UNSPSC/a%20%20b/",
  "/UNSPSC/foo/bar/",
  "/UNSPSC/caf%C3%A9/",
  "/UNSPSC/%E2%82%AC/",
  "/UNSPSC/a%2Fb/",
  "/UNSPSC/a%3Fb/",
  "/UNSPSC/a%23b/?x=1",
  "/?query=%20a",
  "/UNSPSC/laptop_computer/?query=%20a",
  "/NOPE/?q=%20x",
  "/GMDN",
  "/GMDN/",
  "/gmdn",
  "/GMDN/x/",
  "/NOPE",
  "/NOPE/",
  "/NOPE/x/",
  "/no-such-page",
  "/no-such-page/",
  "/mapping/nope",
  "/mapping/nope/",
  "/mapping/nope/sample",
  "/mappings/nope/sample",
  "/static/",
  "/static/nope.js",
  "/UNSPSC/copyOriginalId/",
  "/?q=%25%25%25",
  `/?q=${"1".repeat(50)}`,
];

/** Every probe whose path is known before the servers answer. */
export function staticCorpus(): Probe[] {
  const probes: Probe[] = [
    ...sitemapPaths()
      .filter((path) => !isBaseClassifierPage(path))
      .flatMap(both),
    ...staticFiles().flatMap((path): Probe[] => [
      { method: "GET", path },
      { method: "GET", path, conditional: true },
    ]),
    ...getOnlyPaths.flatMap(both),
    ...rootFiles.flatMap((path): Probe[] => [
      { method: "GET", path, conditional: true },
      { method: "GET", path, headers: { "if-none-match": "*" } },
    ]),
    ...fragmentProbes,
    ...redirectAndErrorPaths.map((path): Probe => ({ method: "GET", path })),
    ...["/UNSPSC", "/unspsc/", "/mapping", "/NOPE/", "/GMDN/"].map(
      (path): Probe => ({ method: "HEAD", path }),
    ),
    ...retiredPaths.flatMap(both),
    ...paymentPaths.map((path): Probe => ({ method: "GET", path })),
    // Node's default 16 KiB header limit answers 431 where uvicorn accepts.
    {
      method: "GET",
      path: "/mapping/",
      headers: { "x-parity-padding": "x".repeat(20_000) },
    },
  ];
  return probes;
}

/** Drops repeats and refuses a probe that would classify. */
export function checkedCorpus(probes: readonly Probe[]): Probe[] {
  const unique = new Map(probes.map((probe) => [probeLabel(probe), probe]));
  for (const probe of unique.values()) {
    if (isBaseClassifierPage(probe.path)) {
      throw new Error(`${probeLabel(probe)} would classify the example`);
    }
  }
  return [...unique.values()];
}
