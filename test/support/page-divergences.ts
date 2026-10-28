// The golden pages stay frozen. Each deliberate Phase 2 markup change is one
// named edit of the expected document, the way nestCase overrides cases, so
// this list is the record of what changed and why.
import {
  defaultTreeAdapter,
  parse,
  parseFragment,
  serialize,
  type DefaultTreeAdapterTypes,
} from "parse5";
import { ISLANDS, type IslandName } from "../../src/web/islands/registry.js";

type Document = DefaultTreeAdapterTypes.Document;
type Element = DefaultTreeAdapterTypes.Element;
type ParentNode = DefaultTreeAdapterTypes.ParentNode;

export interface PageDivergence {
  /** Golden page files (`pages/*.html`) it edits. */
  readonly pages: readonly string[];
  /** It also edits each classifier page region case. */
  readonly regions?: true;
  /** It also edits each result fragment case. */
  readonly fragments?: true;
  readonly why: string;
  /** Edits whatever of its elements the expected page or snippet has. */
  readonly apply: (expected: ParentNode) => void;
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

const CLASSIFIER_PAGES = [
  "pages/classifier-unspsc.html",
  "pages/classifier-gpc.html",
  "pages/classifier-emdn.html",
  "pages/classifier-cpv.html",
  "pages/classifier-hts.html",
];

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

function siblingIndex(element: Element): number {
  return element
    .parentNode!.childNodes.filter((child) => "tagName" in child)
    .indexOf(element);
}

const FORM_HOOKS = [
  "hx-get",
  "hx-target",
  "hx-swap",
  "hx-indicator",
  "hx-sync",
  "data-initial-query-present",
  "data-default-example-prefill",
  "data-autoload-enabled",
  "data-default-top-k",
  "data-default-version",
];

const OLD_SPINNER_AND_SCORE_CSS = `        /* HTMX loading indicator styles */
        #loading-indicator {
            display: none;
            opacity: 0;
            transition: opacity 0.3s ease-out;
        }

        #loading-indicator.htmx-indicator {
            display: flex;
        }

        #loading-indicator.htmx-indicator.htmx-request {
            opacity: 1;
        }

        .score-bar {
            background: linear-gradient(to right, #f9fafb, #e5e7eb);
        }

        .classifier-surface {
            background-color: #c6ecff;
        }

        .js-score-animations [data-score-bar] {
            transform: scaleX(0);
            transform-origin: left center;
            transition: transform 700ms cubic-bezier(0.2, 0.8, 0.2, 1);
            transition-delay: var(--score-animation-delay, 0ms);
            will-change: transform;
        }

        .js-score-animations [data-score-bar].is-score-bar-visible {
            transform: scaleX(1);
        }

        @media (prefers-reduced-motion: reduce) {
            .js-score-animations [data-score-bar] {
                transform: none;
                transition: none;
                will-change: auto;
            }
        }
`;

const NEW_SPINNER_AND_SCORE_CSS = `        #loading-indicator {
            display: flex;
            opacity: 0;
            transition: opacity 0.3s ease-out;
        }

        #loading-indicator[data-active] {
            opacity: 1;
        }

        .score-bar {
            background: linear-gradient(to right, #f9fafb, #e5e7eb);
            transform-origin: left center;
            animation: score-bar-grow 700ms cubic-bezier(0.2, 0.8, 0.2, 1) both;
        }

        @keyframes score-bar-grow {
            from {
                transform: scaleX(0);
            }
        }

        @media (prefers-reduced-motion: reduce) {
            .score-bar {
                animation: none;
            }
        }

        .classifier-surface {
            background-color: #c6ecff;
        }
`;

function withId(id: string) {
  return (element: Element) => attribute(element, "id") === id;
}

/** The deliberate changes of the classifier page switch (Phase 2 PR 4). */
const CLASSIFIER_DIVERGENCES: readonly PageDivergence[] = [
  {
    pages: CLASSIFIER_PAGES,
    why: "Classifier pages load only site.js: htmx.min.js, common.js, paywall.js, classifier.js, the static Clerk tags, the js-score-animations script and the inline cf_track script go. The header island injects Clerk, and the API client writes cf_track before its first lookup.",
    apply(page) {
      setAttribute(
        only(page, scriptNamed("common.js")),
        "src",
        "/static/js/site.js?v=fixture",
      );
      const dropped = elements(
        page,
        (element) =>
          element.tagName === "script" &&
          (/^\/static\/(htmx\.min|js\/(paywall|classifier))\.js\?/.test(
            attribute(element, "src") ?? "",
          ) ||
            (attribute(element, "src") ?? "").startsWith(
              "https://clerk.classifast.com/",
            ) ||
            /js-score-animations|cf_track/.test(
              element.childNodes
                .map((node) => ("value" in node ? node.value : ""))
                .join(""),
            )),
      );
      if (dropped.length !== 7) {
        throw new Error(
          `expected seven dropped scripts, found ${dropped.length}`,
        );
      }
      dropped.forEach((script) => defaultTreeAdapter.detachNode(script));
    },
  },
  {
    pages: CLASSIFIER_PAGES,
    why: "The spinner shows while the island marks it data-active, and score bars grow through a CSS animation from their inline width, replacing HTMX's indicator classes and the rAF reveal.",
    apply(page) {
      const style = only(page, (element) => element.tagName === "style");
      const text = style.childNodes[0];
      if (text === undefined || !("value" in text)) {
        throw new Error("the page style has no text");
      }
      if (!text.value.includes(OLD_SPINNER_AND_SCORE_CSS)) {
        throw new Error("the page style lacks the HTMX spinner and score CSS");
      }
      text.value = text.value.replace(
        OLD_SPINNER_AND_SCORE_CSS,
        NEW_SPINNER_AND_SCORE_CSS,
      );
    },
  },
  {
    pages: CLASSIFIER_PAGES,
    regions: true,
    why: "The <title> loses id=page-title, which only the fragment's out-of-band title swap targeted.",
    apply(page) {
      for (const title of elements(
        page,
        (element) => element.tagName === "title",
      )) {
        removeAttribute(title, "id");
      }
    },
  },
  {
    pages: CLASSIFIER_PAGES,
    regions: true,
    why: "#classifier-form-section hosts the classifier island.",
    apply(page) {
      for (const section of elements(page, withId("classifier-form-section"))) {
        section.attrs.push(...islandAttributes("classifier"));
      }
    },
  },
  {
    pages: CLASSIFIER_PAGES,
    regions: true,
    why: "The server labels the description toggle 'Learn more about TYPE', which classifier.js used to set at runtime, and the toggle and logo lose the hooks only classifier.js read.",
    apply(page) {
      for (const toggle of elements(page, withId("description-toggle"))) {
        const type = attribute(toggle, "data-classifier-type")!;
        removeAttribute(toggle, "data-classifier-type");
        toggle.childNodes = [];
        defaultTreeAdapter.insertText(toggle, `Learn more about ${type}`);
      }
      for (const logo of elements(
        page,
        (element) => attribute(element, "data-classifier-logo") !== undefined,
      )) {
        removeAttribute(logo, "data-classifier-logo");
      }
    },
  },
  {
    pages: CLASSIFIER_PAGES,
    regions: true,
    why: "The form loses its hx-* and data-* hooks; the island reads its options from props. The base page renders the textarea empty with the example as its placeholder, instead of a prefill classifier.js cleared after 100 ms.",
    apply(page) {
      for (const form of elements(page, withId("classifier-form"))) {
        if (attribute(form, "data-default-example-prefill") === "true") {
          only(form, (element) => element.tagName === "textarea").childNodes =
            [];
        }
        FORM_HOOKS.forEach((name) => removeAttribute(form, name));
      }
      for (const spinner of elements(page, withId("loading-indicator"))) {
        setAttribute(spinner, "class", "justify-center items-center");
      }
    },
  },
];

export const PAGE_DIVERGENCES: readonly PageDivergence[] = [
  ...CLASSIFIER_DIVERGENCES,
  {
    pages: CLASSIFIER_PAGES,
    regions: true,
    fragments: true,
    why: "Each score bar carries its width and, from the second row, its stagger (100 ms a row, at most 1 s) inline; CSS grows it. The legacy classifier.js read data-score-width and set both at runtime.",
    apply(page) {
      for (const bar of elements(
        page,
        (element) => attribute(element, "data-score-bar") !== undefined,
      )) {
        const index = siblingIndex(bar.parentNode as Element);
        const width = `width:${attribute(bar, "data-score-width")}%`;
        setAttribute(
          bar,
          "style",
          index === 0
            ? width
            : `${width};animation-delay:${Math.min(index * 100, 1000)}ms`,
        );
      }
    },
  },
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
    pages: [...MAPPING_PAGES, "pages/home.html", ...CLASSIFIER_PAGES],
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

/**
 * The golden page with every divergence that names it applied. A
 * divergence that no longer changes its page fails, so the list cannot
 * keep stale entries.
 */
export function expectedPage(file: string, golden: string): string {
  const page = parse(golden);
  for (const divergence of PAGE_DIVERGENCES) {
    if (!divergence.pages.includes(file)) continue;
    const before = serialize(page);
    divergence.apply(page);
    if (serialize(page) === before) {
      throw new Error(`no change on ${file}: ${divergence.why}`);
    }
  }
  return serialize(page);
}

function expectedSnippet(
  golden: string,
  applies: (divergence: PageDivergence) => boolean,
): string {
  const snippet = parseFragment(golden);
  for (const divergence of PAGE_DIVERGENCES.filter(applies)) {
    divergence.apply(snippet);
  }
  return serialize(snippet);
}

/** A classifier page region with the divergences for regions applied. */
export function expectedRegion(golden: string): string {
  return expectedSnippet(golden, (divergence) => divergence.regions === true);
}

/** A result fragment with the divergences for fragments applied. */
export function expectedFragment(golden: string): string {
  return expectedSnippet(golden, (divergence) => divergence.fragments === true);
}

/**
 * The actual page without its island props, which have no golden
 * counterpart. The island tests prove the props hydrate. React escapes
 * quotes inside attribute values, so the value ends at the first quote.
 */
export function withoutIslandProps(actual: string): string {
  return actual.replaceAll(/ data-island-props="[^"]*"/g, "");
}

/** Whether the page's classifier island loads its results after hydration. */
export function autoloads(html: string): boolean {
  const host = only(
    parse(html),
    (element) => attribute(element, "data-island") === "classifier",
  );
  const props = JSON.parse(attribute(host, "data-island-props") ?? "") as {
    start: { autoload: boolean };
  };
  return props.start.autoload;
}
