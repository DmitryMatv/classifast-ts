import {
  classificationTimeout,
  contract,
  type ContractMode,
} from "./support/env.js";
import {
  expectStatus,
  parseHtml,
  sameOriginPath,
  send,
} from "./support/http.js";
import { islandNamed } from "../../src/web/islands/registry.js";

type Region = {
  selector: string;
  count?: number | "some";
  attributes?: Record<string, string>;
  sameOriginPaths?: Record<string, string>;
  /** Values in the island's data-island-props. */
  islandProps?: Record<string, string>;
  sameOriginIslandProps?: Record<string, string>;
  text?: string;
};

type PageDom = { path: string; regions: Region[] };

const menu: Region[] = [
  { selector: "#mobile-menu-button.hamburger" },
  { selector: "#mobile-menu" },
  { selector: "#mobile-menu a", count: "some" },
];

// A page of islands loads only site.js, and its header island starts Clerk
// when the page needs it.
const islandShell: Region[] = [
  ...menu,
  { selector: 'header[data-island="header"] #mobile-menu' },
  { selector: 'script[type="module"][src^="/static/js/site.js?v="]' },
  { selector: 'script[src*="/static/js/"]', count: 1 },
  { selector: "body:not([data-auth-ui])" },
];

// The home header island renders the auth slots empty and injects Clerk's
// scripts itself; the classifier variant does too.
const islandAuth: Region[] = [
  {
    selector: 'header[data-island="header"]',
    islandProps: { variant: "home" },
  },
  { selector: 'header[data-island="header"] #desktop-auth-container:empty' },
  { selector: 'header[data-island="header"] #mobile-auth-container:empty' },
  { selector: 'script[src*="clerk"]', count: 0 },
];

// The classifier island covers #classifier-form-section; its props carry
// what the HTMX-era form held in hx-* and data-* attributes.
function classifierRegions(query: { text: string }): Region[] {
  return [
    {
      selector: 'header[data-island="header"]',
      islandProps: { variant: "classifier" },
    },
    { selector: 'header[data-island="header"] #desktop-auth-container:empty' },
    { selector: 'header[data-island="header"] #mobile-auth-container:empty' },
    { selector: 'script[src*="clerk"]', count: 0 },
    {
      selector: 'section#classifier-form-section[data-island="classifier"]',
      islandProps: { classifierType: "UNSPSC" },
    },
    { selector: "#classifier-form-section form#classifier-form" },
    { selector: "form[hx-get], [hx-target], [hx-swap-oob]", count: 0 },
    {
      selector: "#classifier-form textarea#product_description_area[required]",
      attributes: { name: "product_description" },
      text: query.text,
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
    { selector: "#loading-indicator:not([data-active])" },
    { selector: "#results-section #results-container" },
    {
      selector: "#description-toggle",
      attributes: {
        "aria-controls": "description-content",
        "aria-expanded": "false",
      },
      text: "Learn more about UNSPSC",
    },
    { selector: "#description-container #description-content" },
    { selector: "#classifier-form-section img", count: "some" },
    { selector: 'script[src*="htmx"]', count: 0 },
  ];
}

function buyButton(
  slug: string,
  returnUrl: "canonical" | "same-origin",
): Region {
  const path = `/mapping/${slug}/`;
  return {
    selector: `[data-island="buy-button"][data-island-props*='"slug":"${slug}"']`,
    ...(returnUrl === "canonical"
      ? { islandProps: { returnUrl: `https://classifast.com${path}` } }
      : { sameOriginIslandProps: { returnUrl: path } }),
  };
}

function sampleLink(slug: string): Region {
  return {
    selector: `a[href$="/mapping/${slug}/sample"]`,
    sameOriginPaths: { href: `/mapping/${slug}/sample` },
  };
}

const pageDoms: PageDom[] = [
  { path: "/", regions: [...islandShell, ...islandAuth] },
  {
    path: "/UNSPSC/",
    regions: [...islandShell, ...classifierRegions({ text: "" })],
  },
  {
    path: "/UNSPSC/laptop_computer/",
    regions: [
      ...islandShell,
      ...classifierRegions({ text: "laptop computer" }),
    ],
  },
  {
    path: "/mapping/",
    regions: [
      ...islandShell,
      buyButton("unspsc-to-cpv-mapping", "same-origin"),
      buyButton("cpv-to-unspsc-mapping", "same-origin"),
      sampleLink("unspsc-to-cpv-mapping"),
      sampleLink("cpv-to-unspsc-mapping"),
      {
        selector: '[data-island="buy-button"] > button[type="button"]',
        count: 2,
      },
    ],
  },
  {
    path: "/mapping/unspsc-to-cpv-mapping/",
    regions: [
      ...islandShell,
      buyButton("unspsc-to-cpv-mapping", "canonical"),
      { selector: '[data-island="buy-button"] > button[type="button"]' },
      sampleLink("unspsc-to-cpv-mapping"),
      {
        selector:
          '[data-island="checkout-banner"] > #storefront-success-message.hidden',
      },
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

describe(
  "DOM regions the scripts depend on",
  { timeout: classificationTimeout(1) },
  () => {
    it.each(regionChecks)(
      "$path $selector",
      async ({
        path,
        selector,
        count,
        attributes,
        sameOriginPaths,
        islandProps,
        sameOriginIslandProps,
        text,
      }) => {
        const elements = [
          ...(await documentAt(path)).querySelectorAll(selector),
        ];
        if (count === "some") {
          expect(elements.length, selector).toBeGreaterThan(0);
        } else {
          expect(elements.length, selector).toBe(count ?? 1);
        }
        for (const element of elements) {
          for (const [name, value] of Object.entries(attributes ?? {})) {
            expect(element.getAttribute(name), `${selector} ${name}`).toBe(
              value,
            );
          }
          for (const [name, value] of Object.entries(sameOriginPaths ?? {})) {
            const label = `${path} ${selector} ${name}`;
            expect(
              sameOriginPath(element.getAttribute(name) ?? "", label),
              label,
            ).toBe(value);
          }
          const props = JSON.parse(
            element.getAttribute("data-island-props") ?? "{}",
          ) as Record<string, unknown>;
          for (const [name, value] of Object.entries(islandProps ?? {})) {
            expect(props[name], `${selector} ${name}`).toBe(value);
          }
          for (const [name, value] of Object.entries(
            sameOriginIslandProps ?? {},
          )) {
            const label = `${path} ${selector} ${name}`;
            expect(sameOriginPath(String(props[name]), label), label).toBe(
              value,
            );
          }
          if (text !== undefined) {
            expect(element.textContent?.trim()).toBe(text);
          }
        }
      },
    );
  },
);

const autoloadCases: { path: string; seeded: Record<ContractMode, boolean> }[] =
  [
    { path: "/UNSPSC/", seeded: { public: false, full: true } },
    {
      path: "/UNSPSC/laptop_computer/",
      seeded: { public: false, full: true },
    },
  ];

describe(
  "classifier autoload follows the server-rendered results",
  { timeout: classificationTimeout(1) },
  () => {
    it.each(autoloadCases)("$path", async ({ path, seeded }) => {
      const document = await documentAt(path);
      const results = document.querySelectorAll(
        '#results-container [role="listitem"]',
      );
      expect(results.length > 0, "server-rendered results").toBe(
        seeded[contract.mode],
      );
      const props = JSON.parse(
        document
          .querySelector('[data-island="classifier"]')
          ?.getAttribute("data-island-props") ?? "",
      ) as { start: { autoload: boolean } };
      expect(props.start.autoload).toBe(!seeded[contract.mode]);
    });
  },
);

describe("every island host names an island this server's site.js hydrates", () => {
  it.each(pageDoms.map(({ path }) => path))("%s", async (path) => {
    for (const host of (await documentAt(path)).querySelectorAll(
      "[data-island]",
    )) {
      const name = host.getAttribute("data-island") ?? "";
      const label = `${path} [data-island="${name}"]`;
      expect(islandNamed(name), label).toBeDefined();
      expect(host.getAttribute("data-island-version"), label).toBe(
        String(islandNamed(name)?.version),
      );
      expect(
        JSON.parse(host.getAttribute("data-island-props") ?? ""),
        label,
      ).toBeTypeOf("object");
    }
  });
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
