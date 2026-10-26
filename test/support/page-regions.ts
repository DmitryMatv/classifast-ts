import { parse, serializeOuter, type DefaultTreeAdapterTypes } from "parse5";
import { normalizeHtml } from "./html-normalizer.js";

type ParentNode = DefaultTreeAdapterTypes.ParentNode;
type Element = DefaultTreeAdapterTypes.Element;

export type RegionGroup =
  "head" | "form-section" | "form" | "results" | "guides" | "popular";

function attribute(element: Element, name: string): string | undefined {
  return element.attrs.find((attr) => attr.name === name)?.value;
}

// The groups the retired Python exporter selected when it recorded pages.json.
function groupOf(element: Element): RegionGroup | undefined {
  const id = attribute(element, "id") ?? "";
  const { tagName } = element;
  if (
    tagName === "title" ||
    tagName === "meta" ||
    (tagName === "link" && attribute(element, "rel") === "canonical") ||
    (tagName === "script" &&
      attribute(element, "type") === "application/ld+json")
  ) {
    return "head";
  }
  if (id === "classifier-form-section") return "form-section";
  if (id === "classifier-form") return "form";
  if (id === "results-container") return "results";
  if (id === "popular-lookups") return "popular";
  if (id.endsWith("-guide") && id !== "comparison-guide") return "guides";
  return undefined;
}

function collect(
  node: ParentNode,
  groups: ReadonlySet<string>,
  into: string[],
): string[] {
  for (const child of node.childNodes) {
    if (!("tagName" in child)) continue;
    const group = groupOf(child);
    if (group !== undefined && groups.has(group)) {
      into.push(serializeOuter(child));
    } else {
      collect(child, groups, into);
    }
  }
  return into;
}

/** The outer HTML of every element in `groups`, in document order. */
export function pageRegions(html: string, groups: readonly string[]): string[] {
  return collect(parse(html), new Set(groups), []);
}

/**
 * Each region normalized on its own and sorted, because React reorders the
 * head metadata.
 */
export function normalizeRegions(regions: readonly string[]): string[] {
  return regions
    .map((region) =>
      normalizeHtml(
        `<!DOCTYPE html><html><head></head><body>${region}</body></html>`,
      ),
    )
    .sort();
}
