import {
  PY_WHITESPACE,
  PY_WORD,
  codePointLength,
  collapseWhitespace,
  pyRstrip,
  pyStrip,
  pyTitle,
  sliceCodePoints,
} from "../python/str.js";
import { quote, unquotePlus, urlencode } from "../python/urllib.js";

export const CANONICAL_ORIGIN = "https://classifast.com";

const WHITESPACE_RUN = new RegExp(`[${PY_WHITESPACE}]+`, "g");
// Keeps the punctuation sanitizeQueryText accepts so slugs round-trip into
// the classifier textbox.
const SLUG_DISALLOWED = new RegExp(
  `[^${PY_WORD}${PY_WHITESPACE}.,:;'()-]`,
  "gu",
);

export function slugify(text: string): string {
  const slug = sliceCodePoints(text, 200)
    .replace(WHITESPACE_RUN, " ")
    .replace(SLUG_DISALLOWED, "")
    .replace(WHITESPACE_RUN, "_");
  return pyStrip(slug, "_");
}

// A hyphenated query uses the underscore slug when that page is a sitemap
// canonical.
function classifierSearchSlug(
  decodedQuery: string,
  classifierType: string,
  sitemapQueryPaths: ReadonlySet<string>,
): string {
  const slug = slugify(decodedQuery);
  const underscoreSlug = slugify(decodedQuery.replaceAll("-", " "));
  const underscorePath = `/${classifierType}/${quote(underscoreSlug, "")}/`;
  return underscoreSlug !== slug && sitemapQueryPaths.has(underscorePath)
    ? underscoreSlug
    : slug;
}

export function decodeSearchQuery(searchQuery: string): string {
  if (!pyStrip(searchQuery)) return "";
  const decoded = collapseWhitespace(
    pyRstrip(unquotePlus(searchQuery), "/").replace(/[/_]/g, " "),
  );
  return codePointLength(decoded) > 4000
    ? pyStrip(sliceCodePoints(decoded, 4000))
    : decoded;
}

export function buildClassifierRedirectUrl(
  upperType: string,
  searchQuery: string,
  queryString: string,
  sitemapQueryPaths: ReadonlySet<string>,
): string {
  let url = `/${upperType}/`;
  const normalizedSearchQuery = pyRstrip(searchQuery, "/");
  if (normalizedSearchQuery) {
    const slug = classifierSearchSlug(
      decodeSearchQuery(normalizedSearchQuery),
      upperType,
      sitemapQueryPaths,
    );
    url += `${quote(slug, "")}/`;
  }
  return queryString ? `${url}?${queryString}` : url;
}

export function buildClassifierCanonicalPath(
  classifierType: string,
  decodedQuery: string,
  sitemapQueryPaths: ReadonlySet<string>,
): string {
  const slug = decodedQuery
    ? classifierSearchSlug(decodedQuery, classifierType, sitemapQueryPaths)
    : "";
  return slug
    ? `/${classifierType}/${quote(slug, "")}/`
    : `/${classifierType}/`;
}

export function buildClassifierCanonicalUrl(
  classifierType: string,
  decodedQuery: string,
  sitemapQueryPaths: ReadonlySet<string>,
): string {
  return (
    CANONICAL_ORIGIN +
    buildClassifierCanonicalPath(
      classifierType,
      decodedQuery,
      sitemapQueryPaths,
    )
  );
}

export interface FragmentPushOptions {
  readonly version: string;
  readonly defaultVersion: string;
  readonly topK: number;
  readonly defaultTopK: number;
  readonly enhanceQuery: boolean;
}

export function buildFragmentPushUrl(
  upperType: string,
  normalizedDescription: string,
  options: FragmentPushOptions,
  sitemapQueryPaths: ReadonlySet<string>,
): string {
  const slug = classifierSearchSlug(
    normalizedDescription.replaceAll("/", " "),
    upperType,
    sitemapQueryPaths,
  );
  const path = slug ? `/${upperType}/${quote(slug, "")}/` : `/${upperType}/`;
  const params: [string, string][] = [];
  if (options.version && options.version !== options.defaultVersion) {
    params.push(["version", options.version]);
  }
  if (options.topK !== options.defaultTopK) {
    params.push(["top_k", String(options.topK)]);
  }
  if (options.enhanceQuery) params.push(["enhance_query", "1"]);
  return params.length ? `${path}?${urlencode(params)}` : path;
}

export function buildFragmentPageTitle(
  classifierType: string,
  query: string,
): string {
  return `${classifierType} codes for '${pyTitle(query)}'`;
}

export function shouldSsr(
  decodedQuery: string,
  hasQueryParams: boolean,
  canonicalPath: string,
  sitemapQueryPaths: ReadonlySet<string>,
): boolean {
  return (
    Boolean(decodedQuery) &&
    !hasQueryParams &&
    sitemapQueryPaths.has(canonicalPath)
  );
}
