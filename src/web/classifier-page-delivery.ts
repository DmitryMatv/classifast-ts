import { HttpException } from "@nestjs/common";
import { CLASSIFIER_TYPES } from "../classifier/classifier-config.js";
import { resolveClassifierType } from "../classifier/classifier-options.js";
import {
  ClassificationQueueClosed,
  ClassificationQueueFull,
} from "../classifier/classification-queue.js";
import {
  cacheHeaders,
  pageHeaders,
  type HeaderRecord,
} from "../http/cache-profiles.js";
import { collapseWhitespace } from "../python/str.js";
import type { ClassifierPageResults } from "./classifier-page.js";

export const DEFAULT_TOP_K = 10;
export const QUEUE_FULL_RETRY_AFTER_SECONDS = 120;
/** Purges every cached sitemap query page at Cloudflare. */
export const SITEMAP_RESULTS_CACHE_TAG = "sitemap-results";

export function removedClassifier(classifierType: string): HttpException {
  return new HttpException(
    { detail: `Classifier '${classifierType}' is no longer available` },
    410,
  );
}

/** Python's get_classifier_or_404: the upper-cased type, or 404 or 410. */
export function classifierTypeOr404(classifierType: string): string {
  const resolution = resolveClassifierType(classifierType, CLASSIFIER_TYPES);
  if (resolution.kind === "removed") throw removedClassifier(classifierType);
  if (resolution.kind === "unknown") {
    throw new HttpException(
      { detail: `Classifier '${classifierType}' not found` },
      404,
    );
  }
  return resolution.upperType;
}

export type ClassifierRoute =
  | { readonly kind: "no-slash"; readonly classifierType: string }
  | {
      readonly kind: "page";
      readonly classifierType: string;
      readonly searchQuery: string;
    };

/**
 * Matches Starlette's /{classifier_type} and /{classifier_type}/{search_query:path}
 * routes against the percent-decoded request path.
 */
export function matchClassifierRoute(
  decodedPath: string,
): ClassifierRoute | undefined {
  const match = /^\/([^/]+)(?:(\/)(.*))?$/s.exec(decodedPath);
  if (match === null) return undefined;
  const [, classifierType, slash, searchQuery] = match;
  return slash === undefined
    ? { kind: "no-slash", classifierType: classifierType! }
    : {
        kind: "page",
        classifierType: classifierType!,
        searchQuery: searchQuery!,
      };
}

/**
 * Starlette's request.url.path: the decoded path reparsed as a URL, so a
 * decoded "?" or "#" ends it and tab, CR and LF disappear.
 */
export function starletteUrlPath(decodedPath: string): string {
  return decodedPath.replace(/[\t\r\n]/g, "").replace(/[?#].*$/s, "");
}

/** `degraded`: results rendered, but their ranking is too weak to cache. */
export type SsrState =
  "not_attempted" | "success" | "degraded" | "failure" | "overloaded";

export interface SeededResults {
  readonly results: ClassifierPageResults;
  readonly defaultExamplePrefill: boolean;
  readonly triggerSearchOnLoad: boolean;
  readonly state: SsrState;
}

export type SsrFailureLogger = (state: SsrState, error: unknown) => void;

export type PageClassification = Pick<
  ClassifierPageResults,
  "results" | "version" | "elapsedSeconds"
> & {
  /** False when the ranking is too degraded to cache. */
  readonly complete?: boolean;
};

/**
 * Port of maybe_seed_classifier_page_results. A base page classifies the
 * example; a query page classifies only when `allowQuerySsr` is set.
 */
export async function seedClassifierPageResults(
  classify: (query: string) => Promise<PageClassification>,
  decodedQuery: string,
  exampleQuery: string,
  allowQuerySsr: boolean,
  logFailure: SsrFailureLogger,
): Promise<SeededResults> {
  const empty = (query: string): ClassifierPageResults => ({
    query,
    results: [],
    loaded: false,
  });
  if (decodedQuery && !allowQuerySsr) {
    return {
      results: empty(decodedQuery),
      defaultExamplePrefill: false,
      triggerSearchOnLoad: true,
      state: "not_attempted",
    };
  }
  const query = collapseWhitespace(decodedQuery || exampleQuery);
  if (!query) {
    return {
      results: empty(decodedQuery),
      defaultExamplePrefill: false,
      triggerSearchOnLoad: false,
      state: "not_attempted",
    };
  }
  try {
    const outcome = await classify(query);
    return {
      results: {
        query,
        results: outcome.results,
        version: outcome.version,
        elapsedSeconds: outcome.elapsedSeconds,
        loaded: true,
      },
      defaultExamplePrefill: !decodedQuery,
      triggerSearchOnLoad: false,
      state: outcome.complete === false ? "degraded" : "success",
    };
  } catch (error) {
    const state =
      // A queue closed for shutdown is busy, not broken: a crawler must get
      // 503, not a 200 marked noindex.
      error instanceof ClassificationQueueFull ||
      error instanceof ClassificationQueueClosed
        ? "overloaded"
        : "failure";
    logFailure(state, error);
    return {
      results: empty(query),
      defaultExamplePrefill: !decodedQuery,
      triggerSearchOnLoad: true,
      state,
    };
  }
}

/**
 * A failed SSR attempt is not cached. A verified crawler that met a full
 * queue gets 503 with Retry-After, because Google retries a 503 but drops a
 * 200 marked noindex; only a genuine failure sends noindex. `cacheTag` marks
 * a page whose results rendered.
 */
export function classifierPageResponse(
  state: SsrState,
  isVerifiedCrawler: boolean,
  canonicalUrl: string,
  cacheTag?: string,
): { readonly status: number; readonly headers: HeaderRecord } {
  const retryLater = state === "overloaded" && isVerifiedCrawler;
  const headers = pageHeaders(canonicalUrl);
  if (state === "success" && cacheTag) headers["Cache-Tag"] = cacheTag;
  if (state === "degraded" || state === "failure" || state === "overloaded") {
    Object.assign(headers, cacheHeaders("NO_STORE"));
  }
  if (state === "failure") headers["X-Robots-Tag"] = "noindex, nofollow";
  if (retryLater) {
    headers["Retry-After"] = String(QUEUE_FULL_RETRY_AFTER_SECONDS);
  }
  return { status: retryLater ? 503 : 200, headers };
}
