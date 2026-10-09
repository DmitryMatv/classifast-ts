import { createHash, timingSafeEqual } from "node:crypto";
import type { ClassificationOutcome } from "../classifier/classification-service.js";
import type { ClassifierConfigMap } from "../classifier/classifier-config.js";
import type { JsonReply } from "../http/error-filter.js";
import { pyStrip } from "../python/str.js";
import type { QueryItem } from "../web/request-url.js";

export const PROXY_SECRET_HEADER = "x-rapidapi-proxy-secret";

export type ProxySecretVerdict =
  "accepted" | "unconfigured" | "missing" | "invalid";

function sha256(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

export function checkProxySecret(
  configured: string | undefined,
  presented: string | undefined,
): ProxySecretVerdict {
  if (!configured) return "unconfigured";
  if (!presented) return "missing";
  // Equal-length digests let timingSafeEqual compare secrets of any length.
  return timingSafeEqual(sha256(presented), sha256(configured))
    ? "accepted"
    : "invalid";
}

/** One entry of FastAPI's 422 `detail` list. */
export type ValidationIssue = {
  readonly type: string;
  readonly loc: readonly ["query", string];
  readonly msg: string;
  readonly input: string | null;
  readonly ctx?: Readonly<Record<string, number>>;
};

export const TOP_K_DEFAULT = 3;
const TOP_K_MIN = 1;
const TOP_K_MAX = 100;
// jiter refuses a longer leading integer before parsing it.
const MAX_INT_STRING_LENGTH = 4300;
const UNICODE_WHITESPACE = /^\p{White_Space}+|\p{White_Space}+$/gu;
const JSON_INT_PREFIX = /^-?(?:0|[1-9][0-9]*)/;

/** jiter's `NumberInt::try_from`: a whole JSON integer, nothing else. */
function jsonInt(text: string): bigint | "too-long" | undefined {
  const prefix = JSON_INT_PREFIX.exec(text)?.[0];
  if (prefix === undefined) return undefined;
  if (prefix.length > MAX_INT_STRING_LENGTH) return "too-long";
  return prefix.length === text.length ? BigInt(text) : undefined;
}

/** pydantic-core's `strip_leading_zeros`, underscores included. */
function stripLeadingZeros(text: string): string | undefined {
  const first = text[0];
  if (first !== "0") {
    return first !== undefined && /[1-9-]/.test(first) ? text : undefined;
  }
  for (let i = 1; i < text.length; i++) {
    const character = text[i]!;
    if (character === "0" || character === "_") continue;
    if (/[1-9-]/.test(character)) return text.slice(i);
    if (character === ".") return text.slice(i - 1);
    return undefined;
  }
  return text.slice(-1);
}

/** pydantic-core's `clean_int_str`, quirks included: `0-3` becomes `-3`. */
function cleanIntString(raw: string): string | undefined {
  let text = raw.replace(UNICODE_WHITESPACE, "");
  if (text.startsWith("+")) {
    text = text.slice(1);
    if (text.startsWith("-")) return undefined;
  }
  const negative = text.startsWith("-");
  if (negative) {
    text = text.slice(1);
    if (text.startsWith("-") || text.startsWith("+")) return undefined;
  }
  const stripped = stripLeadingZeros(text);
  if (stripped === undefined) return undefined;
  text = stripped;
  const dot = text.indexOf(".");
  if (dot !== -1 && /^0+$/.test(text.slice(dot + 1))) text = text.slice(0, dot);
  const sign = negative ? "-" : "";
  if (
    text.includes("_") &&
    !text.startsWith("_") &&
    !text.endsWith("_") &&
    !text.includes("__")
  ) {
    return sign + text.replaceAll("_", "");
  }
  return text.length === raw.length ? undefined : sign + text;
}

/** FastAPI's `top_k: int = Query(3, ge=1, le=100)` in pydantic's lax mode. */
export function parseTopK(raw: string): number | ValidationIssue {
  const issue = (
    type: string,
    msg: string,
    ctx?: Record<string, number>,
  ): ValidationIssue => ({
    type,
    loc: ["query", "top_k"],
    msg,
    input: raw,
    ...(ctx ? { ctx } : {}),
  });
  const direct = jsonInt(raw);
  if (direct === "too-long") {
    return issue(
      "int_parsing_size",
      "Unable to parse input string as an integer, exceeded maximum size",
    );
  }
  const cleaned = direct === undefined ? cleanIntString(raw) : undefined;
  const value =
    direct ?? (cleaned === undefined ? undefined : jsonInt(cleaned));
  if (typeof value !== "bigint") {
    return issue(
      "int_parsing",
      "Input should be a valid integer, unable to parse string as an integer",
    );
  }
  if (value < TOP_K_MIN) {
    return issue(
      "greater_than_equal",
      `Input should be greater than or equal to ${TOP_K_MIN}`,
      { ge: TOP_K_MIN },
    );
  }
  if (value > TOP_K_MAX) {
    return issue(
      "less_than_equal",
      `Input should be less than or equal to ${TOP_K_MAX}`,
      { le: TOP_K_MAX },
    );
  }
  return Number(value);
}

export type ClassifyQuery = {
  readonly query: string;
  /** Upper-cased, as the classifier table keys are. */
  readonly classifierType: string;
  readonly version: string | undefined;
  readonly topK: number;
};

export type ClassifyQueryResult =
  | { readonly ok: true; readonly value: ClassifyQuery }
  | {
      readonly ok: false;
      readonly status: 400 | 422;
      readonly detail: unknown;
    };

function missing(name: string): ValidationIssue {
  return {
    type: "missing",
    loc: ["query", name],
    msg: "Field required",
    input: null,
  };
}

export function parseClassifyQuery(
  items: readonly QueryItem[],
): ClassifyQueryResult {
  // Starlette keeps the last value of a repeated query parameter.
  const params = new Map(items);
  const query = params.get("query");
  const standard = params.get("standard");
  const rawTopK = params.get("top_k");
  const topK = rawTopK === undefined ? TOP_K_DEFAULT : parseTopK(rawTopK);
  const issues = [
    ...(query === undefined ? [missing("query")] : []),
    ...(standard === undefined ? [missing("standard")] : []),
    ...(typeof topK === "number" ? [] : [topK]),
  ];
  if (
    query === undefined ||
    standard === undefined ||
    typeof topK !== "number"
  ) {
    return { ok: false, status: 422, detail: issues };
  }
  const normalizedQuery = pyStrip(query);
  const classifierType = pyStrip(standard).toUpperCase();
  if (!normalizedQuery) {
    return { ok: false, status: 400, detail: "Query cannot be empty" };
  }
  if (!classifierType) {
    return { ok: false, status: 400, detail: "Standard cannot be empty" };
  }
  return {
    ok: true,
    value: {
      query: normalizedQuery,
      classifierType,
      version: params.get("version"),
      topK,
    },
  };
}

export type RapidApiResult = {
  readonly code: string;
  readonly name: string;
  readonly score: number;
  readonly url: string | null;
};

export type RapidApiClassifyBody = {
  readonly query: string;
  readonly standard: string;
  readonly version: string;
  readonly results: readonly RapidApiResult[];
  readonly processing_time: number;
};

// Python's response model declares these payload fields as `str`, so any
// other stored type fails validation and the route answers 500.
function payloadText(
  payload: Readonly<Record<string, unknown>>,
  field: string,
): string {
  const value = field in payload ? payload[field] : "";
  if (typeof value !== "string") {
    throw new TypeError(`payload ${field} is not a string`);
  }
  return value;
}

export function classifyBody(
  request: ClassifyQuery,
  outcome: Pick<ClassificationOutcome, "results" | "version" | "versionName">,
  processingTime: number,
): RapidApiClassifyBody {
  const { baseUrl, appendCodeToUrl = true } = outcome.version;
  return {
    query: request.query,
    standard: request.classifierType.toLowerCase(),
    version: outcome.versionName,
    results: outcome.results.map(({ payload, score }) => {
      const code = payloadText(payload, "original_id");
      return {
        code,
        name: payloadText(payload, "class_name"),
        score,
        url:
          baseUrl && code
            ? appendCodeToUrl
              ? `${baseUrl}${code}`
              : baseUrl
            : null,
      };
    }),
    processing_time: processingTime,
  };
}

export function standardsBody(
  classifiers: ClassifierConfigMap,
  timestamp: number,
) {
  return {
    standards: Object.fromEntries(
      Object.entries(classifiers).map(([type, config]) => [
        type,
        {
          title: config.title,
          description: config.description,
          versions: Object.keys(config.versions),
          example: pyStrip(config.example.replaceAll("Example:", "")),
        },
      ]),
    ),
    timestamp,
  };
}

/**
 * Python reports "unavailable" for a missing Qdrant client; the Nest app
 * cannot boot without one, so the database is only healthy or unhealthy.
 */
export function pingReply(
  services: {
    readonly embeddingConfigured: boolean;
    readonly databaseHealthy: boolean;
  },
  timestamp: number,
): JsonReply {
  const embedding = services.embeddingConfigured ? "configured" : "unavailable";
  const database = services.databaseHealthy ? "healthy" : "unhealthy";
  return {
    status:
      services.embeddingConfigured && services.databaseHealthy ? 200 : 503,
    body: { status: "healthy", timestamp, services: { embedding, database } },
  };
}

const SENSITIVE_HEADERS: ReadonlySet<string> = new Set([
  "authorization",
  "cookie",
  "x-api-key",
  "x-rapidapi-key",
  PROXY_SECRET_HEADER,
]);

/** `dict(request.headers)` keeps the first value of a repeated header. */
export function debugHeadersBody(
  rawHeaders: readonly string[],
  timestamp: number,
) {
  const headers = new Map<string, string>();
  for (let index = 0; index + 1 < rawHeaders.length; index += 2) {
    const name = rawHeaders[index]!.toLowerCase();
    if (!headers.has(name)) headers.set(name, rawHeaders[index + 1]!);
  }
  return {
    received_headers: Object.fromEntries(
      [...headers].map(([name, value]) => [
        name,
        SENSITIVE_HEADERS.has(name) ? "[REDACTED]" : value,
      ]),
    ),
    timestamp,
    host: headers.get("host") ?? null,
    user_agent: headers.get("user-agent") ?? null,
  };
}
