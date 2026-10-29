// The golden pages stay frozen. Each deliberate Phase 2 markup change is one
// named edit of the expected document, the way nestCase overrides cases, so
// this list is the record of what changed and why.
import {
  defaultTreeAdapter,
  parse,
  serialize,
  type DefaultTreeAdapterTypes,
} from "parse5";
import { ISLANDS, type IslandName } from "../../src/web/islands/registry.js";

type Document = DefaultTreeAdapterTypes.Document;
type Element = DefaultTreeAdapterTypes.Element;
type ParentNode = DefaultTreeAdapterTypes.ParentNode;

export interface PageDivergence {
  readonly pages: readonly string[];
  readonly why: string;
  readonly apply: (expected: Document) => void;
}

function elements(node: ParentNode, matches: (element: Element) => boolean) {
  const found: Element[] = [];
  for (const child of node.childNodes) {
    if (!("tagName" in child)) continue;
    if (matches(child)) found.push(child);
    found.push(...elements(child, matches));
  }
  return found;
}

function only(node: ParentNode, matches: (element: Element) => boolean) {
  const found = elements(node, matches);
  if (found.length !== 1) {
    throw new Error(`expected one element, found ${found.length}`);
  }
  return found[0]!;
}

function attribute(element: Element, name: string): string | undefined {
  return element.attrs.find((attr) => attr.name === name)?.value;
}

function setAttribute(element: Element, name: string, value: string): void {
  removeAttribute(element, name);
  element.attrs.push({ name, value });
}

function removeAttribute(element: Element, name: string): void {
  element.attrs = element.attrs.filter((attr) => attr.name !== name);
}

function islandAttributes(name: IslandName) {
  return [
    { name: "data-island", value: name },
    { name: "data-island-version", value: String(ISLANDS[name].version) },
  ];
}

/** Puts `element` inside a new island host in its place. */
function wrapInIsland(
  element: Element,
  name: IslandName,
  className: string | null,
): void {
  const parent = element.parentNode!;
  const host = defaultTreeAdapter.createElement("div", element.namespaceURI, [
    ...(className === null ? [] : [{ name: "class", value: className }]),
    ...islandAttributes(name),
  ]);
  parent.childNodes[parent.childNodes.indexOf(element)] = host;
  host.parentNode = parent;
  defaultTreeAdapter.appendChild(host, element);
}

const MAPPING_PAGES = [
  "pages/mapping-index.html",
  "pages/mapping-unspsc-to-cpv.html",
  "pages/mapping-cpv-to-unspsc.html",
];

function scriptNamed(file: string) {
  return (element: Element) =>
    element.tagName === "script" &&
    (attribute(element, "src") ?? "").startsWith(`/static/js/${file}?`);
}

function islandBuyButtons(hostClass: string | null) {
  return (page: Document) => {
    for (const button of elements(
      page,
      (element) => attribute(element, "data-mapping-buy-button") !== undefined,
    )) {
      for (const name of [
        "data-mapping-buy-button",
        "data-mapping-slug",
        "data-return-url",
      ]) {
        removeAttribute(button, name);
      }
      wrapInIsland(button, "buy-button", hostClass);
    }
  };
}

export const PAGE_DIVERGENCES: readonly PageDivergence[] = [
  {
    pages: MAPPING_PAGES,
    why: "The mapping pages load the one island bundle, site.js, instead of common.js and storefront.js.",
    apply(page) {
      setAttribute(
        only(page, scriptNamed("common.js")),
        "src",
        "/static/js/site.js?v=fixture",
      );
      const storefront = only(page, scriptNamed("storefront.js"));
      defaultTreeAdapter.detachNode(storefront);
    },
  },
  {
    pages: MAPPING_PAGES,
    why: "body loses data-auth-ui, which only told common.js not to start Clerk; site.js never starts Clerk on these pages.",
    apply(page) {
      removeAttribute(
        only(page, (element) => element.tagName === "body"),
        "data-auth-ui",
      );
    },
  },
  {
    pages: ["pages/home.html"],
    why: "Home loads only site.js. Its header island starts the auth service, which injects Clerk's two scripts, so the static Clerk tags go.",
    apply(page) {
      setAttribute(
        only(page, scriptNamed("common.js")),
        "src",
        "/static/js/site.js?v=fixture",
      );
      const clerkScripts = elements(page, (element) =>
        (attribute(element, "src") ?? "").startsWith(
          "https://clerk.classifast.com/",
        ),
      );
      if (clerkScripts.length !== 2) {
        throw new Error(
          `expected two Clerk scripts, found ${clerkScripts.length}`,
        );
      }
      clerkScripts.forEach((script) => defaultTreeAdapter.detachNode(script));
    },
  },
  {
    pages: [...MAPPING_PAGES, "pages/home.html"],
    why: "The page header hosts the header island. The menu button renders the aria-controls that common.js added at runtime.",
    apply(page) {
      const body = only(page, (element) => element.tagName === "body");
      const header = only(
        body,
        (element) =>
          element.tagName === "header" && element.parentNode === body,
      );
      header.attrs.push(...islandAttributes("header"));
      setAttribute(
        only(
          header,
          (element) => attribute(element, "id") === "mobile-menu-button",
        ),
        "aria-controls",
        "mobile-menu",
      );
    },
  },
  {
    pages: ["pages/mapping-index.html"],
    why: "Each Buy button is a buy-button island in a display: contents host, so it stays a grid item; its data-* attributes moved into the island props.",
    apply: islandBuyButtons("contents"),
  },
  {
    pages: [
      "pages/mapping-unspsc-to-cpv.html",
      "pages/mapping-cpv-to-unspsc.html",
    ],
    why: "The Buy button is a buy-button island in a block host, which keeps the space-y-2 margin below it; its data-* attributes moved into the island props.",
    apply: islandBuyButtons(null),
  },
  {
    pages: [
      "pages/mapping-unspsc-to-cpv.html",
      "pages/mapping-cpv-to-unspsc.html",
    ],
    why: "The checkout success banner is a checkout-banner island in a display: contents host and loses data-storefront-success, which only storefront.js read.",
    apply(page) {
      const banner = only(
        page,
        (element) => attribute(element, "id") === "storefront-success-message",
      );
      removeAttribute(banner, "data-storefront-success");
      wrapInIsland(banner, "checkout-banner", "contents");
    },
  },
];

/** The golden page with every divergence that names it applied. */
export function expectedPage(file: string, golden: string): string {
  const divergences = PAGE_DIVERGENCES.filter(({ pages }) =>
    pages.includes(file),
  );
  if (divergences.length === 0) return golden;
  const page = parse(golden);
  for (const divergence of divergences) divergence.apply(page);
  return serialize(page);
}

/**
 * The actual page without its island props, which have no golden
 * counterpart. The island tests prove the props hydrate. React escapes
 * quotes inside attribute values, so the value ends at the first quote.
 */
export function withoutIslandProps(actual: string): string {
  return actual.replaceAll(/ data-island-props="[^"]*"/g, "");
}
