import { Logger } from "@nestjs/common";
import { ClassificationQueueFull } from "../classifier/classification-queue.js";
import {
  isCacheableClassification,
  type Authorize,
  type ClassificationOutcome,
  type ClassificationRequest,
  type ClassificationService,
} from "../classifier/classification-service.js";
import {
  cacheHeaders,
  classificationResultHeaders,
  type HeaderRecord,
} from "../http/cache-profiles.js";
import {
  intParsingError,
  lastQueryValue,
  parsePydanticBool,
  parsePydanticInt,
  queryValidationFailed,
  type QueryValidationError,
} from "../http/query-params.js";
import {
  QuotaUnavailableError,
  quotaHeaders,
  type Caller,
  type Quota,
  type UsageStatus,
} from "../usage/quota.js";
import type { QueryItem } from "./request-url.js";

const logger = new Logger("Web");

export interface FragmentQuery {
  readonly productDescription: string;
  readonly topK: number | undefined;
  readonly version: string | undefined;
  readonly pushUrl: boolean | undefined;
  readonly urlChange: boolean | undefined;
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

function boolQuery(
  items: readonly QueryItem[],
  name: string,
  errors: QueryValidationError[],
): boolean | undefined {
  const text = lastQueryValue(items, name);
  if (text === undefined) return undefined;
  const value = parsePydanticBool(text);
  if (value === undefined) {
    errors.push({
      type: "bool_parsing",
      loc: ["query", name],
      msg: "Input should be a valid boolean, unable to interpret input",
      input: text,
    });
  }
  return value;
}

/**
 * The fragment route's query parameters, or FastAPI's 422 listing every
 * invalid one in declaration order.
 */
export function parseFragmentQuery(items: readonly QueryItem[]): FragmentQuery {
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
  const pushUrl = boolQuery(items, "push_url", errors);
  const urlChange = boolQuery(items, "url_change", errors);
  if (productDescription === undefined || errors.length > 0) {
    throw queryValidationFailed(errors);
  }
  return {
    productDescription,
    topK,
    version: lastQueryValue(items, "version"),
    pushUrl,
    urlChange,
    enhanceQuery: lastQueryValue(items, "enhance_query"),
  };
}

/** An explicit push_url wins over the legacy url_change; both default on. */
export function resolveFragmentPushUrl(
  pushUrl: boolean | undefined,
  urlChange: boolean | undefined,
): boolean {
  return pushUrl ?? urlChange ?? true;
}

export interface FragmentDeps {
  readonly isVerifiedCrawler: () => Promise<boolean>;
  readonly resolveCaller: () => Promise<Caller>;
  readonly quota: Pick<Quota, "check" | "charge">;
  readonly classify: ClassificationService["classify"];
}

export type FragmentOutcome =
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
  deps: FragmentDeps,
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

/** The quota and classification steps of Python's fragment route. */
export async function classifyFragment(
  deps: FragmentDeps,
  request: ClassificationRequest,
  signal: AbortSignal,
): Promise<FragmentOutcome> {
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

export function resultsFragmentHeaders(
  pushUrl: string | undefined,
  outcome: ClassificationOutcome,
): HeaderRecord {
  return {
    ...classificationResultHeaders(),
    "Cache-Tag": "classification-results",
    ...(pushUrl === undefined ? {} : { "HX-Push-Url": pushUrl }),
    ...(isCacheableClassification(outcome) ? {} : cacheHeaders("NO_STORE")),
  };
}

export function paywallHeaders(
  usage: UsageStatus,
  pushUrl: string | undefined,
): HeaderRecord {
  return {
    ...cacheHeaders("NO_STORE"),
    ...(pushUrl === undefined ? {} : { "HX-Push-Url": pushUrl }),
    ...quotaHeaders(usage),
  };
}
