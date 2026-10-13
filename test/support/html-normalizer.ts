import { parse, parseFragment, type DefaultTreeAdapterTypes } from "parse5";

type ChildNode = DefaultTreeAdapterTypes.ChildNode;
type Element = DefaultTreeAdapterTypes.Element;

// Elements whose surrounding whitespace renders as a visible space.
const INLINE = new Set([
  "a",
  "abbr",
  "audio",
  "b",
  "bdi",
  "bdo",
  "br",
  "button",
  "canvas",
  "cite",
  "code",
  "data",
  "del",
  "dfn",
  "em",
  "i",
  "iframe",
  "img",
  "input",
  "ins",
  "kbd",
  "label",
  "mark",
  "meter",
  "object",
  "output",
  "picture",
  "progress",
  "q",
  "s",
  "samp",
  "select",
  "small",
  "span",
  "strong",
  "sub",
  "sup",
  "svg",
  "textarea",
  "time",
  "u",
  "var",
  "video",
  "wbr",
]);
const VERBATIM = new Set(["textarea", "style", "script"]);

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

function attributeValue(name: string, value: string): string {
  return name === "style" ? styleDeclarations(value) : value;
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

// Comments go and adjacent text merges. Outside <pre>, runs of HTML
// whitespace collapse to one space, the first and last text in an element
// lose edge spaces, and a whitespace-only run survives as " " only next to
// an inline element. Edge trimming cannot tell `<span>a </span><span>b`
// from `<span>a</span><span>b`; the templates indent inline text so widely
// that keeping edge spaces would flag dozens of invisible differences.
function normalizedChildren(
  nodes: readonly ChildNode[],
  preformatted: boolean,
): Item[] {
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
  if (preformatted) return merged;
  const items: Item[] = [];
  merged.forEach((item, index) => {
    if ("node" in item) {
      items.push(item);
      return;
    }
    let text = item.text.replace(/[ \t\n\f\r]+/g, " ");
    // Only HTML whitespace collapses; a nonbreaking space renders.
    if (index === 0) text = text.replace(/^ /, "");
    if (index === merged.length - 1) text = text.replace(/ $/, "");
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

  element(element: Element, depth: number, preformatted = false): void {
    const indent = "  ".repeat(depth);
    this.lines.push(`${indent}${openTag(element)}`);
    if (VERBATIM.has(element.tagName)) {
      const text = rawText(element);
      if (text !== undefined) this.lines.push(`${indent}  ${text}`);
      return;
    }
    const inPre = preformatted || element.tagName === "pre";
    let items = normalizedChildren(element.childNodes, inPre).filter(
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
          printer.item(item, depth + 1, inPre);
          return printer.lines.join("\n");
        })
        .sort();
      this.lines.push(...sortedHoisted);
      items = rest;
    }
    for (const item of items) this.item(item, depth + 1, inPre);
  }

  item(item: Item, depth: number, preformatted: boolean): void {
    if ("node" in item) this.element(item.node, depth, preformatted);
    else this.lines.push(`${"  ".repeat(depth)}${JSON.stringify(item.text)}`);
  }
}

/** normalizeHtml for a fragment that the browser swaps into a page. */
export function normalizeFragment(html: string): string {
  const fragment = parseFragment(html);
  const printer = new Printer(imageSourcesOf(fragment.childNodes, new Set()));
  for (const item of normalizedChildren(fragment.childNodes, false)) {
    printer.item(item, 0, false);
  }
  return printer.lines.join("\n");
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
