// The browser bundles this module, so it imports only pure modules.
import { collapseWhitespace } from "../python/str.js";

export interface ResultsQuery {
  readonly query: string;
  readonly version: string;
  readonly topK: number;
  readonly enhance: boolean;
}

/**
 * The results endpoint for a query. The parameters always come in one order
 * and always include version and top_k, so equal queries share one edge
 * cache key. The description is collapsed first because the canonical-query
 * middleware answers 308 to uncollapsed whitespace.
 */
export function resultsApiPath(
  classifierType: string,
  query: ResultsQuery,
): string {
  const params = new URLSearchParams([
    ["product_description", collapseWhitespace(query.query)],
    ["version", query.version],
    ["top_k", String(query.topK)],
  ]);
  if (query.enhance) params.append("enhance_query", "1");
  return `/api/results/${classifierType}?${params.toString()}`;
}

export interface CodeToken {
  readonly char: string;
  /** Always false for classifiers whose codes read better unspaced. */
  readonly gapAfter: boolean;
}

/**
 * One result, formatted on the server: the formatting ports Python's text
 * and number rules, whose Unicode data a browser may not share.
 */
export interface ResultView {
  readonly originalId: string;
  readonly codeTokens: readonly CodeToken[];
  /** Absent when the version has no base URL. */
  readonly detailUrl?: string;
  readonly idLevel?: string;
  readonly className?: string;
  readonly definition: string;
  readonly scoreLabel: string;
  readonly scoreWidth: string;
}

export interface ResultsView {
  readonly results: readonly ResultView[];
  readonly tooltip?: string;
  /** The classification time with two decimals. */
  readonly elapsed?: string;
}

/** 200 results, 402 paywall, 503 busy, and 4xx or 5xx error. */
export type ResultsResponse =
  | ({
      readonly kind: "results";
      readonly version: string;
      /** The page URL the fragment pushes as HX-Push-Url. */
      readonly url: string;
      readonly title: string;
    } & ResultsView)
  | {
      readonly kind: "paywall";
      readonly signedIn: boolean;
      readonly limit: number;
    }
  | { readonly kind: "busy"; readonly message: string }
  | { readonly kind: "error"; readonly message: string };
