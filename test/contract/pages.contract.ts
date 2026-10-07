import { readRepoFile, runsInMode, type ContractMode } from "./support/env.js";
import type { CacheProfileName } from "./support/headers.js";
import {
  expectCacheProfile,
  expectStatus,
  parseHtml,
  send,
  varyTokens,
  type Method,
  type Reply,
} from "./support/http.js";

type PageCase = {
  path: string;
  canonical: string;
  methods: readonly Method[];
  profile?: CacheProfileName;
  robots?: string;
  modes?: readonly ContractMode[];
};

const site = "https://classifast.com";
const both = ["GET", "HEAD"] as const;

const pages: PageCase[] = [
  { path: "/", canonical: `${site}/`, methods: both },
  { path: "/mapping/", canonical: `${site}/mapping/`, methods: both },
  {
    path: "/mapping/unspsc-to-cpv-mapping/",
    canonical: `${site}/mapping/unspsc-to-cpv-mapping/`,
    methods: both,
  },
  {
    path: "/mapping/cpv-to-unspsc-mapping/",
    canonical: `${site}/mapping/cpv-to-unspsc-mapping/`,
    methods: both,
  },
  {
    path: "/UNSPSC/laptop_computer/",
    canonical: `${site}/UNSPSC/laptop_computer/`,
    methods: both,
  },
  {
    path: "/UNSPSC/laptop_computer/?top_k=5",
    canonical: `${site}/UNSPSC/laptop_computer/`,
    methods: both,
  },
  {
    path: "/UNSPSC/Laptop-Computer/",
    canonical: `${site}/UNSPSC/Laptop-Computer/`,
    methods: both,
  },
  {
    path: "/UNSPSC/caf%C3%A9/",
    canonical: `${site}/UNSPSC/caf%C3%A9/`,
    methods: both,
  },
  { path: "/UNSPSC/", canonical: `${site}/UNSPSC/`, methods: ["HEAD"] },
  {
    path: "/UNSPSC/",
    canonical: `${site}/UNSPSC/`,
    methods: ["GET"],
    profile: "NO_STORE",
    robots: "noindex, nofollow",
    modes: ["public"],
  },
  {
    path: "/UNSPSC/",
    canonical: `${site}/UNSPSC/`,
    methods: ["GET"],
    modes: ["full"],
  },
];

const pageRequests = pages
  .filter((page) => runsInMode(page.modes))
  .flatMap((page) => page.methods.map((method) => ({ ...page, method })));

function expectPageHeaders(
  reply: Reply,
  canonical: string,
  profile: CacheProfileName,
  robots: string,
) {
  expectStatus(reply, 200);
  expectCacheProfile(reply, profile);
  expect(varyTokens(reply), `${reply.label} Vary`).toEqual(["accept-encoding"]);
  expect(reply.headers.get("content-type")).toBe("text/html; charset=utf-8");
  expect(reply.headers.get("link"), `${reply.label} Link`).toBe(
    `<${canonical}>; rel="canonical"`,
  );
  expect(reply.headers.get("x-robots-tag"), `${reply.label} X-Robots-Tag`).toBe(
    robots,
  );
}

describe("HTML pages", () => {
  it.each(pageRequests)(
    "$method $path",
    async ({ path, method, canonical, profile, robots }) => {
      const reply = await send(path, { method });
      expectPageHeaders(
        reply,
        canonical,
        profile ?? "HTML_PAGE",
        robots ?? "index, follow",
      );
      if (method === "HEAD") {
        expect(reply.body).toBe("");
        return;
      }
      const document = parseHtml(reply);
      const links = [...document.querySelectorAll('link[rel="canonical"]')];
      expect(links.map((link) => link.getAttribute("href"))).toEqual([
        canonical,
      ]);
      expect(document.querySelector('meta[name="robots"]')).toBeNull();
    },
  );
});

const sitemapLocations = [
  ...readRepoFile("app/static/sitemap.xml")
    .toString("utf8")
    .matchAll(/<loc>([^<]+)<\/loc>/g),
]
  .map((match) => match[1] ?? "")
  .filter((location) => location.startsWith(`${site}/`));

describe("every sitemap URL is a canonical, indexable page", () => {
  it("the sitemap lists URLs", () => {
    expect(sitemapLocations.length).toBeGreaterThan(400);
  });

  it.each(sitemapLocations)("HEAD %s", async (location) => {
    const reply = await send(new URL(location).pathname, { method: "HEAD" });
    expectPageHeaders(reply, location, "HTML_PAGE", "index, follow");
  });
});
