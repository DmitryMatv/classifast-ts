const COMMENT = /<!--[\s\S]*?-->/g;
const LOC = /<loc>([^<]*)<\/loc>/g;
const XML_ENTITIES: Readonly<Record<string, string>> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};
const URL_PATH = /^(?:[A-Za-z][A-Za-z0-9+.-]*:)?(?:\/\/[^/?#]*)?([^?#]*)/;

function decodeXmlText(text: string): string {
  return text.replace(
    /&(?:#x([0-9A-Fa-f]+)|#(\d+)|(\w+));/g,
    (entity, hex?: string, decimal?: string, name?: string) => {
      if (hex !== undefined) return String.fromCodePoint(parseInt(hex, 16));
      if (decimal !== undefined) return String.fromCodePoint(Number(decimal));
      return XML_ENTITIES[name!] ?? entity;
    },
  );
}

// Python's urlparse splits ";params" off the last path segment only.
function urlPath(url: string): string {
  const path = URL_PATH.exec(url)![1]!;
  const params = path.indexOf(";", path.lastIndexOf("/"));
  return params === -1 ? path : path.slice(0, params);
}

// Reads the repo's own fixed-format app/static/sitemap.xml with regular
// expressions; it is not a parser for arbitrary sitemap XML (no CDATA, no
// namespaced or attribute-bearing <loc> tags).
export function parseSitemapQueryPaths(
  sitemapXml: string,
  classifierTypes: ReadonlySet<string>,
): Set<string> {
  const paths = new Set<string>();
  for (const [, text] of sitemapXml.replace(COMMENT, "").matchAll(LOC)) {
    const path = urlPath(decodeXmlText(text!));
    const parts = path.split("/").filter(Boolean);
    if (parts.length === 2 && classifierTypes.has(parts[0]!)) paths.add(path);
  }
  return paths;
}
