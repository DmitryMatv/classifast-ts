import { Logger } from "@nestjs/common";
import type { Request, Response } from "express";
import { ClassificationQueueFull } from "../classifier/classification-queue.js";
import {
  isCacheableClassification,
  type Authorize,
  type ClassificationOutcome,
  type ClassificationRequest,
  type ClassificationService,
} from "../classifier/classification-service.js";
import { classifierPage } from "../classifier/classifier-config.js";
import { resolveClassifierOptions } from "../classifier/classifier-options.js";
import { buildResultsPageUrl } from "../classifier/classifier-urls.js";
import {
  crawlerRequestOf,
  type GoogleCrawlerVerifier,
} from "../crawlers/google-crawlers.js";
import {
  cacheHeaders,
  classificationResultHeaders,
  type HeaderRecord,
} from "../http/cache-profiles.js";
import {
  intParsingError,
  lastQueryValue,
  parsePydanticInt,
  queryValidationFailed,
  type QueryValidationError,
} from "../http/query-params.js";
import { collapseWhitespace } from "../python/str.js";
import {
  QuotaUnavailableError,
  quotaHeaders,
  type Caller,
  type Quota,
  type UsageStatus,
} from "../usage/quota.js";
import { callerCredentialsOf } from "./caller-credentials.js";
import {
  classifierTypeOr404,
  DEFAULT_TOP_K,
} from "./classifier-page-delivery.js";
import type { QueryItem } from "./request-url.js";

const logger = new Logger("Web");

export interface ResultsParams {
  readonly productDescription: string;
  readonly topK: number | undefined;
  readonly version: string | undefined;
  readonly enhanceQuery: string | undefined;
}

function topKQuery(
  items: readonly QueryItem[],
  errors: QueryValidationError[],
): number | undefined {
  const text = lastQueryValue(items, "top_k");
  if (text === undefined) return undefined;
  const value = parsePydanticInt(text);
  const loc = ["query", "top_k"] as const;
  if (value === undefined) {
    errors.push(intParsingError("top_k", text));
  } else if (value < 1) {
    errors.push({
      type: "greater_than_equal",
      loc,
      msg: "Input should be greater than or equal to 1",
      input: text,
      ctx: { ge: 1 },
    });
  } else if (value > 100) {
    errors.push({
      type: "less_than_equal",
      loc,
      msg: "Input should be less than or equal to 100",
      input: text,
      ctx: { le: 100 },
    });
  }
  return value;
}

/**
 * The results request's query parameters, or FastAPI's 422 listing every
 * invalid one in declaration order, as Python's fragment route did.
 */
export function parseResultsParams(items: readonly QueryItem[]): ResultsParams {
  const errors: QueryValidationError[] = [];
  const productDescription = lastQueryValue(items, "product_description");
  if (productDescription === undefined) {
    errors.push({
      type: "missing",
      loc: ["query", "product_description"],
      msg: "Field required",
      input: null,
    });
  }
  const topK = topKQuery(items, errors);
  if (productDescription === undefined || errors.length > 0) {
    throw queryValidationFailed(errors);
  }
  return {
    productDescription,
    topK,
    version: lastQueryValue(items, "version"),
    enhanceQuery: lastQueryValue(items, "enhance_query"),
  };
}

export interface ResultsRequest {
  readonly query: ResultsParams;
  readonly upperType: string;
  readonly description: string;
  readonly enhance: boolean;
  readonly version: string;
  readonly topK: number;
  readonly firstVersion: string;
}

/**
 * The classification a results request asks for. Like Python's fragment
 * route, it validates the query parameters (422) before it looks up the
 * type (404 or 410).
 */
export function resolveResultsRequest(
  classifierType: string,
  items: readonly QueryItem[],
): ResultsRequest {
  const query = parseResultsParams(items);
  const upperType = classifierTypeOr404(classifierType);
  const { version, topK, firstVersion } = resolveClassifierOptions(
    classifierPage(upperType).versions,
    query.version,
    query.topK,
    DEFAULT_TOP_K,
    { allowInvalidVersion: true },
  );
  return {
    query,
    upperType,
    description: collapseWhitespace(query.productDescription),
    enhance: query.enhanceQuery === "1",
    version,
    topK,
    firstVersion,
  };
}

/** The classifier page URL that shows the request's results. */
export function resultsPageUrl(
  request: ResultsRequest,
  sitemapQueryPaths: ReadonlySet<string>,
): string {
  return buildResultsPageUrl(
    request.upperType,
    request.description,
    {
      version: request.version,
      defaultVersion: request.firstVersion,
      topK: request.topK,
      defaultTopK: DEFAULT_TOP_K,
      enhanceQuery: request.enhance,
    },
    sitemapQueryPaths,
  );
}

// HEAD never classifies or charges quota: a probe must not spend a queue
// turn or a paid lookup.
export function refuseHead(res: Response): void {
  res
    .status(405)
    .set({ Allow: "GET", ...cacheHeaders("NO_STORE") })
    .end();
}

export interface ResultsDeps {
  readonly isVerifiedCrawler: () => Promise<boolean>;
  readonly resolveCaller: () => Promise<Caller>;
  readonly quota: Pick<Quota, "check" | "charge">;
  readonly classify: ClassificationService["classify"];
}

export type ResultsOutcome =
  | { readonly kind: "results"; readonly outcome: ClassificationOutcome }
  | { readonly kind: "paywall"; readonly usage: UsageStatus }
  | { readonly kind: "quota-unavailable"; readonly message: string }
  | { readonly kind: "queue-full"; readonly message: string }
  | { readonly kind: "error"; readonly error: unknown };

class QuotaDenied extends Error {
  constructor(readonly usage: UsageStatus) {
    super("Classification quota denied");
  }
}

/**
 * Crawler verification and Clerk lookups can be slow, so they and the
 * read-only quota check run before queue admission. The returned charge
 * runs while holding the only classification turn; a verified crawler has
 * none.
 */
async function prepareCharge(
  deps: ResultsDeps,
  signal: AbortSignal,
): Promise<Authorize | undefined> {
  const isCrawler = await deps.isVerifiedCrawler();
  signal.throwIfAborted();
  if (isCrawler) {
    logger.log("Bypassing quota for verified Google search crawler");
    return undefined;
  }
  const caller = await deps.resolveCaller();
  signal.throwIfAborted();
  const usage = await deps.quota.check(caller);
  if (!usage.allowed) throw new QuotaDenied(usage);
  return async () => {
    const charged = await deps.quota.charge(caller);
    if (!charged.allowed) throw new QuotaDenied(charged);
  };
}

/** The quota and classification steps, in the order of Python's fragment route. */
export async function classifyResults(
  deps: ResultsDeps,
  request: ClassificationRequest,
  signal: AbortSignal,
): Promise<ResultsOutcome> {
  try {
    const authorize = await prepareCharge(deps, signal);
    signal.throwIfAborted();
    const outcome = await deps.classify(signal, request, authorize);
    return { kind: "results", outcome };
  } catch (error) {
    if (error instanceof QuotaDenied) {
      return { kind: "paywall", usage: error.usage };
    }
    if (error instanceof QuotaUnavailableError) {
      return { kind: "quota-unavailable", message: error.message };
    }
    if (error instanceof ClassificationQueueFull) {
      return { kind: "queue-full", message: error.message };
    }
    return { kind: "error", error };
  }
}

export interface ResultsServices {
  readonly crawlers: Pick<GoogleCrawlerVerifier, "isVerified">;
  readonly quota: Pick<Quota, "resolveCaller" | "check" | "charge">;
  readonly classifier: Pick<ClassificationService, "classify">;
}

export function classifyResultsRequest(
  req: Request,
  services: ResultsServices,
  request: ResultsRequest,
  signal: AbortSignal,
): Promise<ResultsOutcome> {
  const { crawlers, quota, classifier } = services;
  return classifyResults(
    {
      isVerifiedCrawler: () => crawlers.isVerified(crawlerRequestOf(req)),
      resolveCaller: () => quota.resolveCaller(callerCredentialsOf(req)),
      quota,
      classify: (...args) => classifier.classify(...args),
    },
    {
      query: request.description,
      classifierType: request.upperType,
      version: request.version,
      topK: request.topK,
      enhance: request.enhance,
    },
    signal,
  );
}

export function resultsHeaders(outcome: ClassificationOutcome): HeaderRecord {
  return {
    ...classificationResultHeaders(),
    "Cache-Tag": "classification-results",
    ...(isCacheableClassification(outcome) ? {} : cacheHeaders("NO_STORE")),
  };
}

export function paywallHeaders(usage: UsageStatus): HeaderRecord {
  return {
    ...cacheHeaders("NO_STORE"),
    ...quotaHeaders(usage),
  };
}

// A Pro caller has no limit and never gets the paywall.
export function paywallLimit(usage: UsageStatus): number {
  return usage.kind === "metered" ? usage.limit : -1;
}
