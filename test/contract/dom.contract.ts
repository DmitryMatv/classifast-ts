import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { contract, repoRoot } from "./support/env.js";
import {
  expectStatus,
  parseHtml,
  sameOriginPath,
  send,
} from "./support/http.js";

type Region = {
  selector: string;
  count?: number | "some";
  attributes?: Record<string, string>;
  sameOriginPaths?: Record<string, string>;
  text?: string;
};

type PageDom = { path: string; regions: Region[] };

const shell: Region[] = [
  { selector: "#mobile-menu-button.hamburger" },
  { selector: "#mobile-menu" },
  { selector: "#mobile-menu a", count: "some" },
  { selector: 'script[type="module"][src^="/static/js/common.js?v="]' },
];

const clerkAuth: Region[] = [
  { selector: "#desktop-auth-container" },
  { selector: "#mobile-auth-container" },
  { selector: "body:not([data-auth-ui])" },
  {
    selector: 'script[src*="clerk.browser.js"][data-clerk-publishable-key]',
  },
];

const authDisabled: Region[] = [
  { selector: "body", attributes: { "data-auth-ui": "disabled" } },
];

function classifierRegions(query: {
  initialQueryPresent: boolean;
  text?: string;
}): Region[] {
  return [
    {
      selector: "form[hx-get]",
      attributes: {
        id: "classifier-form",
        "hx-target": "#results-container",
        "hx-swap": "innerHTML",
        "hx-indicator": "#loading-indicator",
        "hx-sync": "this:replace",
        "data-initial-query-present": String(query.initialQueryPresent),
        "data-default-example-prefill": String(!query.initialQueryPresent),
        "data-autoload-enabled": "true",
        "data-default-top-k": "10",
        "data-default-version": "UNSPSC UNv260801.1 (18 March 2025)",
      },
      sameOriginPaths: { "hx-get": "/UNSPSC/fragment" },
    },
    {
      selector: "#classifier-form textarea#product_description_area[required]",
      attributes: { name: "product_description" },
      ...(query.text === undefined ? {} : { text: query.text }),
    },
    {
      selector: "#classifier-form select#version_selector",
      attributes: { name: "version" },
    },
    {
      selector: "#classifier-form select#show_top_k_categories",
      attributes: { name: "top_k" },
    },
    {
      selector: "#show_top_k_categories option[selected]",
      attributes: { value: "10" },
    },
    {
      selector: "#classifier-form input#enhance-query-switch",
      attributes: { type: "checkbox", name: "enhance_query", value: "1" },
    },
    { selector: '#classifier-form button[type="submit"]' },
    { selector: "#loading-indicator" },
    { selector: "#results-section #results-container" },
    {
      selector: "#description-toggle",
      attributes: {
        "aria-controls": "description-content",
        "aria-expanded": "false",
        "data-classifier-type": "UNSPSC",
      },
    },
    { selector: "#description-container #description-content" },
    { selector: '[data-classifier-logo="true"]', count: "some" },
    { selector: "title#page-title" },
    { selector: 'script[src^="/static/htmx.min.js?v="]' },
    { selector: 'script[type="module"][src^="/static/js/paywall.js?v="]' },
    { selector: 'script[type="module"][src^="/static/js/classifier.js?v="]' },
  ];
}

// The product page posts its canonical production URL as the checkout return
// URL; the index uses the request origin.
function buyButton(
  slug: string,
  returnUrl: "canonical" | "same-origin",
): Region {
  const path = `/mapping/${slug}/`;
  return {
    selector: `[data-mapping-buy-button][data-mapping-slug="${slug}"]`,
    ...(returnUrl === "canonical"
      ? {
          attributes: {
            type: "button",
            "data-return-url": `https://classifast.com${path}`,
          },
        }
      : {
          attributes: { type: "button" },
          sameOriginPaths: { "data-return-url": path },
        }),
  };
}

function sampleLink(slug: string): Region {
  return {
    selector: `a[href$="/mapping/${slug}/sample"]`,
    sameOriginPaths: { href: `/mapping/${slug}/sample` },
  };
}

const storefrontScript: Region = {
  selector: 'script[type="module"][src^="/static/js/storefront.js?v="]',
};

const pageDoms: PageDom[] = [
  { path: "/", regions: [...shell, ...clerkAuth] },
  {
    path: "/UNSPSC/",
    regions: [
      ...shell,
      ...clerkAuth,
      ...classifierRegions({ initialQueryPresent: false }),
    ],
  },
  {
    path: "/UNSPSC/laptop_computer/",
    regions: [
      ...shell,
      ...clerkAuth,
      ...classifierRegions({
        initialQueryPresent: true,
        text: "laptop computer",
      }),
    ],
  },
  {
    path: "/mapping/",
    regions: [
      ...shell,
      ...authDisabled,
      buyButton("unspsc-to-cpv-mapping", "same-origin"),
      buyButton("cpv-to-unspsc-mapping", "same-origin"),
      sampleLink("unspsc-to-cpv-mapping"),
      sampleLink("cpv-to-unspsc-mapping"),
      storefrontScript,
    ],
  },
  {
    path: "/mapping/unspsc-to-cpv-mapping/",
    regions: [
      ...shell,
      ...authDisabled,
      buyButton("unspsc-to-cpv-mapping", "canonical"),
      sampleLink("unspsc-to-cpv-mapping"),
      { selector: "[data-storefront-success].hidden" },
      storefrontScript,
    ],
  },
];

const regionChecks = pageDoms.flatMap(({ path, regions }) =>
  regions.map((region) => ({ path, ...region })),
);

const documents = new Map<string, Promise<Document>>();

function documentAt(path: string): Promise<Document> {
  let document = documents.get(path);
  if (!document) {
    document = send(path).then((reply) => {
      expectStatus(reply, 200);
      return parseHtml(reply);
    });
    documents.set(path, document);
  }
  return document;
}

describe("DOM regions the scripts depend on", () => {
  it.each(regionChecks)(
    "$path $selector",
    async ({ path, selector, count, attributes, sameOriginPaths, text }) => {
      const elements = [...(await documentAt(path)).querySelectorAll(selector)];
      if (count === "some") {
        expect(elements.length, selector).toBeGreaterThan(0);
      } else {
        expect(elements.length, selector).toBe(count ?? 1);
      }
      for (const element of elements) {
        for (const [name, value] of Object.entries(attributes ?? {})) {
          expect(element.getAttribute(name), `${selector} ${name}`).toBe(value);
        }
        for (const [name, value] of Object.entries(sameOriginPaths ?? {})) {
          const label = `${path} ${selector} ${name}`;
          expect(
            sameOriginPath(element.getAttribute(name) ?? "", label),
            label,
          ).toBe(value);
        }
        if (text !== undefined) {
          expect(element.textContent?.trim()).toBe(text);
        }
      }
    },
  );
});

describe("same-origin scripts and stylesheets load", () => {
  it.each(pageDoms.map(({ path }) => path))("%s", async (path) => {
    const document = await documentAt(path);
    const urls = [
      ...[...document.querySelectorAll("script[src]")].map((element) =>
        element.getAttribute("src"),
      ),
      ...[...document.querySelectorAll('link[rel="stylesheet"]')].map(
        (element) => element.getAttribute("href"),
      ),
    ]
      .map((url) => new URL(url ?? "", contract.baseUrl))
      .filter((url) => url.origin === contract.baseUrl.origin);
    expect(urls.length).toBeGreaterThan(1);
    for (const url of urls) {
      expect(url.searchParams.get("v"), url.href).toMatch(/^[0-9a-f]{10}$/);
      expectStatus(await send(`${url.pathname}${url.search}`), 200);
    }
  });
});

const fragmentIds = new Set([
  "share-button",
  "paywall-warning",
  "paywall-buttons",
  "signin-button",
  "upgrade-button",
  "retry-button",
]);

function idsLookedUpByScripts(): string[] {
  const sources = readdirSync(join(repoRoot, "app/assets/ts"))
    .filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"))
    .map((name) => readFileSync(join(repoRoot, "app/assets/ts", name), "utf8"));
  const ids = sources.flatMap((source) => [
    ...[...source.matchAll(/getElementById\(\s*["']([\w-]+)["']/g)].map(
      (match) => match[1] ?? "",
    ),
    ...[...source.matchAll(/["'][^"'\n]*?#([\w-]+)/g)].map(
      (match) => match[1] ?? "",
    ),
  ]);
  return [...new Set(ids)].sort();
}

it("the region tables cover every id the scripts look up", () => {
  const covered = regionChecks.map(({ selector }) => selector).join(" ");
  const uncovered = idsLookedUpByScripts().filter(
    (id) => !fragmentIds.has(id) && !new RegExp(`#${id}\\b`).test(covered),
  );
  expect(uncovered).toEqual([]);
});
