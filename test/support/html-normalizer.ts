import { parse, type DefaultTreeAdapterTypes } from "parse5";

type ChildNode = DefaultTreeAdapterTypes.ChildNode;
type Element = DefaultTreeAdapterTypes.Element;

// Elements whose surrounding whitespace renders as a visible space.
const INLINE = new Set([
  "a",
  "abbr",
  "b",
  "button",
  "code",
  "em",
  "i",
  "img",
  "input",
  "kbd",
  "label",
  "select",
  "small",
  "span",
  "strong",
  "sub",
  "sup",
  "svg",
  "textarea",
  "time",
]);
const VERBATIM = new Set(["pre", "textarea", "style", "script"]);

function isElement(node: ChildNode): node is Element {
  return "tagName" in node;
}

function attribute(element: Element, name: string): string | undefined {
  return element.attrs.find((attr) => attr.name === name)?.value;
}

function sortedJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortedJson);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sortedJson((value as Record<string, unknown>)[key])]),
  );
}

// React serializes a style object as "name:value;name:value".
function styleDeclarations(style: string): string {
  return style
    .split(";")
    .filter((declaration) => declaration.trim() !== "")
    .map((declaration) => {
      const colon = declaration.indexOf(":");
      return `${declaration.slice(0, colon).trim()}:${declaration.slice(colon + 1).trim()}`;
    })
    .join(";");
}

// Asset hashes have their own spec (asset-url.spec.ts).
function attributeValue(name: string, value: string): string {
  if (name === "style") return styleDeclarations(value);
  return value.replace(/\?v=[^"&#\s]*/g, "?v=<hash>");
}

function openTag(element: Element): string {
  const attrs = [...element.attrs]
    .sort((left, right) => (left.name < right.name ? -1 : 1))
    .map(
      (attr) =>
        ` ${attr.name}=${JSON.stringify(attributeValue(attr.name, attr.value))}`,
    );
  return `<${element.tagName}${attrs.join("")}>`;
}

// Whitespace alone inside <script> or <style> does nothing.
function rawText(element: Element): string | undefined {
  const text = element.childNodes
    .map((node) => ("value" in node ? node.value : ""))
    .join("");
  const executable =
    element.tagName === "script" || element.tagName === "style";
  if (executable && text.trim() === "") return undefined;
  if (
    element.tagName === "script" &&
    attribute(element, "type") === "application/ld+json"
  ) {
    return JSON.stringify(sortedJson(JSON.parse(text)), null, 2);
  }
  return JSON.stringify(text);
}

type Item = { node: Element } | { text: string };

// Comments go; adjacent text merges; runs of HTML whitespace collapse to one
// space. A whitespace-only run survives as " " only between an inline
// element and its sibling, and the first and last text in an element is
// trimmed.
function normalizedChildren(nodes: readonly ChildNode[]): Item[] {
  const merged: Item[] = [];
  for (const node of nodes) {
    if (isElement(node)) {
      merged.push({ node });
    } else if (node.nodeName === "#text" && "value" in node) {
      const last = merged.at(-1);
      if (last && "text" in last) last.text += node.value;
      else merged.push({ text: node.value });
    }
  }
  const items: Item[] = [];
  merged.forEach((item, index) => {
    if ("node" in item) {
      items.push(item);
      return;
    }
    let text = item.text.replace(/[ \t\n\f\r]+/g, " ");
    if (index === 0) text = text.trimStart();
    if (index === merged.length - 1) text = text.trimEnd();
    if (text === "") return;
    if (text === " ") {
      const neighbours = [merged[index - 1], merged[index + 1]];
      const nextToInline = neighbours.some(
        (neighbour) =>
          neighbour !== undefined &&
          "node" in neighbour &&
          INLINE.has(neighbour.node.tagName),
      );
      if (!nextToInline) return;
    }
    items.push({ text });
  });
  return items;
}

// React 19 hoists <title>, <meta>, non-stylesheet <link> and async scripts
// to the start of <head> and keeps everything else in place, so head
// metadata compares as a set and the rest in document order.
function isHoistedByReact(element: Element): boolean {
  switch (element.tagName) {
    case "title":
    case "meta":
      return true;
    case "link":
      return attribute(element, "rel") !== "stylesheet";
    case "script":
      return (
        attribute(element, "async") !== undefined &&
        attribute(element, "src") !== undefined
      );
    default:
      return false;
  }
}

// React 19 adds <link rel="preload" as="image"> for every <img> it renders.
function isReactImagePreload(element: Element, imageSources: Set<string>) {
  return (
    element.tagName === "link" &&
    attribute(element, "rel") === "preload" &&
    attribute(element, "as") === "image" &&
    imageSources.has(attribute(element, "href") ?? "")
  );
}

function imageSourcesOf(nodes: readonly ChildNode[], into: Set<string>) {
  for (const node of nodes) {
    if (!isElement(node)) continue;
    const src = attribute(node, "src");
    if (node.tagName === "img" && src !== undefined) into.add(src);
    imageSourcesOf(node.childNodes, into);
  }
  return into;
}

class Printer {
  readonly lines: string[] = [];

  constructor(private readonly imageSources: Set<string>) {}

  element(element: Element, depth: number): void {
    const indent = "  ".repeat(depth);
    this.lines.push(`${indent}${openTag(element)}`);
    if (VERBATIM.has(element.tagName)) {
      const text = rawText(element);
      if (text !== undefined) this.lines.push(`${indent}  ${text}`);
      return;
    }
    let items = normalizedChildren(element.childNodes).filter(
      (item) =>
        !("node" in item) || !isReactImagePreload(item.node, this.imageSources),
    );
    if (element.tagName === "head") {
      const hoisted = items.filter(
        (item) => "node" in item && isHoistedByReact(item.node),
      );
      const rest = items.filter((item) => !hoisted.includes(item));
      const sortedHoisted = hoisted
        .map((item) => {
          const printer = new Printer(this.imageSources);
          printer.item(item, depth + 1);
          return printer.lines.join("\n");
        })
        .sort();
      this.lines.push(...sortedHoisted);
      items = rest;
    }
    for (const item of items) this.item(item, depth + 1);
  }

  item(item: Item, depth: number): void {
    if ("node" in item) this.element(item.node, depth);
    else this.lines.push(`${"  ".repeat(depth)}${JSON.stringify(item.text)}`);
  }
}

// A canonical, line-per-node rendering of an HTML document for parity
// comparisons between the Python templates and the React pages.
export function normalizeHtml(html: string): string {
  const document = parse(html);
  const printer = new Printer(imageSourcesOf(document.childNodes, new Set()));
  for (const node of document.childNodes) {
    if (node.nodeName === "#documentType" && "name" in node) {
      printer.lines.push(`<!DOCTYPE ${node.name}>`);
    } else if (isElement(node)) {
      printer.element(node, 0);
    }
  }
  return printer.lines.join("\n");
}
