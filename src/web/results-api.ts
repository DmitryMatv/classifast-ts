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

/**
 * The classifier page that shows a query, as the fragment pushes it in
 * HX-Push-Url, and its document title. A paywall carries it too, so the
 * page can show the query's URL and return there after checkout.
 */
export interface QueryPage {
  readonly url: string;
  readonly title: string;
}

/** 200 results, 402 paywall, 503 busy, and 4xx or 5xx error. */
export type ResultsResponse =
  | ({
      readonly kind: "results";
      readonly version: string;
      /** The description as the server classified it. */
      readonly query: string;
    } & QueryPage &
      ResultsView)
  | ({
      readonly kind: "paywall";
      readonly signedIn: boolean;
      readonly limit: number;
    } & QueryPage)
  | { readonly kind: "busy"; readonly message: string }
  | { readonly kind: "error"; readonly message: string };

export type ResultsAnswer = Extract<ResultsResponse, { kind: "results" }>;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isOptionalString(value: unknown): boolean {
  return value === undefined || isString(value);
}

function isResultView(value: unknown): value is ResultView {
  return (
    isObject(value) &&
    isString(value["originalId"]) &&
    isString(value["definition"]) &&
    isString(value["scoreLabel"]) &&
    isString(value["scoreWidth"]) &&
    isOptionalString(value["detailUrl"]) &&
    isOptionalString(value["idLevel"]) &&
    isOptionalString(value["className"]) &&
    Array.isArray(value["codeTokens"]) &&
    value["codeTokens"].every(
      (token) =>
        isObject(token) &&
        isString(token["char"]) &&
        typeof token["gapAfter"] === "boolean",
    )
  );
}

function isQueryPage(value: Record<string, unknown>): boolean {
  return isString(value["url"]) && isString(value["title"]);
}

export function isResultsAnswer(value: unknown): value is ResultsAnswer {
  return (
    isObject(value) &&
    value["kind"] === "results" &&
    isString(value["version"]) &&
    isString(value["query"]) &&
    isQueryPage(value) &&
    isOptionalString(value["tooltip"]) &&
    isOptionalString(value["elapsed"]) &&
    Array.isArray(value["results"]) &&
    value["results"].every(isResultView)
  );
}

/**
 * Narrows an untrusted body, the endpoint's JSON or a history entry an
 * older site.js wrote, down to each ResultView field. Null when it is not
 * one of the four answers.
 */
export function parseResultsResponse(value: unknown): ResultsResponse | null {
  if (isResultsAnswer(value)) return value;
  if (!isObject(value)) return null;
  switch (value["kind"]) {
    case "paywall":
      return typeof value["signedIn"] === "boolean" &&
        typeof value["limit"] === "number" &&
        isQueryPage(value)
        ? (value as ResultsResponse)
        : null;
    case "busy":
    case "error":
      return isString(value["message"]) ? (value as ResultsResponse) : null;
    default:
      return null;
  }
}
