import { z } from "zod";
import { resolveQdrantUrl } from "../qdrant/qdrant-connection.js";

// Variable names, defaults, and parsing follow the Python app in app/*.py.
// Python requires no variable at boot. It fails at boot only when an
// integer it converts at import or startup is malformed; those variables use
// `integer` here. Missing secrets disable a feature, as in Python, and
// variables that Python reads leniently fall back to their defaults.

export const APP_CONFIG = Symbol("APP_CONFIG");

export class ConfigError extends Error {}

export type Toggle<T> =
  | ({ readonly enabled: true } & T)
  | { readonly enabled: false; readonly reason: string };

type DeepReadonly<T> = T extends (infer E)[]
  ? readonly DeepReadonly<E>[]
  : T extends object
    ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
    : T;

const INTEGER = /^[+-]?\d+$/;
const TRUE_ENV_VALUES = new Set(["1", "true", "yes", "on"]);

function integer(fallback: number) {
  return z
    .string()
    .trim()
    .regex(INTEGER, "must be an integer")
    .transform(Number)
    .default(fallback);
}

function decimal(fallback: number) {
  return z
    .string()
    .trim()
    .refine((value) => value !== "" && !Number.isNaN(Number(value)), {
      message: "must be a number",
    })
    .transform(Number)
    .default(fallback);
}

function lenientInteger(fallback: number) {
  return integer(fallback).catch(fallback);
}

function lenientDecimal(fallback: number) {
  return decimal(fallback).catch(fallback);
}

function flag(fallback: "true" | "false") {
  return z
    .string()
    .default(fallback)
    .transform((value) => TRUE_ENV_VALUES.has(value.trim().toLowerCase()));
}

// Python tests secrets with `if not value`, so an empty value means unset.
const secret = z
  .string()
  .optional()
  .transform((value) => value || undefined);

const text = (fallback: string) => z.string().default(fallback);

function commaList(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

// Python disables the client when its timeout is not a positive number.
function positiveSeconds(name: string, raw: string) {
  const seconds = Number(raw.trim());
  return raw.trim() !== "" && seconds > 0
    ? { ok: true as const, seconds }
    : {
        ok: false as const,
        reason: `${name} must be a number greater than zero`,
      };
}

const server = z
  .object({ HOST: text("0.0.0.0"), PORT: integer(8001) })
  .transform((env) => ({ host: env.HOST, port: env.PORT }));

const qdrant = z
  .object({
    QDRANT_URL: z.string().optional(),
    QDRANT_HOST: z.string().optional(),
    QDRANT_PORT: z.string().optional(),
    QDRANT_API_KEY: z.string().optional(),
  })
  .transform((env, ctx) => {
    try {
      return {
        url: resolveQdrantUrl(env),
        apiKey: env.QDRANT_API_KEY?.trim() || undefined,
      };
    } catch (error) {
      if (!(error instanceof z.ZodError)) throw error;
      ctx.addIssue({
        code: "custom",
        path: ["QDRANT_PORT"],
        message: "must be an integer",
      });
      return z.NEVER;
    }
  });

const embedding = z
  .object({
    HF_TOKEN: secret,
    HF_INFERENCE_PROVIDER: text(""),
    HF_EMBEDDING_TIMEOUT_SECONDS: text("20"),
    HF_EMBEDDING_MODEL: text("Qwen/Qwen3-Embedding-8B"),
    HF_EMBEDDING_DIMS: integer(2048),
  })
  .transform((env) => {
    const timeout = positiveSeconds(
      "HF_EMBEDDING_TIMEOUT_SECONDS",
      env.HF_EMBEDDING_TIMEOUT_SECONDS,
    );
    let client: Toggle<{
      token: string;
      provider: string;
      timeoutSeconds: number;
    }>;
    if (!env.HF_TOKEN) {
      client = { enabled: false, reason: "HF_TOKEN not found" };
    } else if (!timeout.ok) {
      client = { enabled: false, reason: timeout.reason };
    } else {
      client = {
        enabled: true,
        token: env.HF_TOKEN,
        provider: env.HF_INFERENCE_PROVIDER.trim() || "auto",
        timeoutSeconds: timeout.seconds,
      };
    }
    return {
      model: env.HF_EMBEDDING_MODEL,
      dims: env.HF_EMBEDDING_DIMS,
      client,
    };
  });

const openRouter = z
  .object({
    OPENROUTER_API_KEY: secret,
    OPENROUTER_RERANK_MODEL: text(""),
    OPENROUTER_RERANK_TIMEOUT_SECONDS: text("30"),
  })
  .transform((env) => {
    const apiKey = env.OPENROUTER_API_KEY;
    const missingKey = {
      enabled: false,
      reason: "OPENROUTER_API_KEY not found",
    } as const;
    const timeout = positiveSeconds(
      "OPENROUTER_RERANK_TIMEOUT_SECONDS",
      env.OPENROUTER_RERANK_TIMEOUT_SECONDS,
    );
    let rerank: Toggle<{
      apiKey: string;
      model: string;
      timeoutSeconds: number;
    }>;
    if (!apiKey) {
      rerank = missingKey;
    } else if (!timeout.ok) {
      rerank = { enabled: false, reason: timeout.reason };
    } else {
      rerank = {
        enabled: true,
        apiKey,
        model: env.OPENROUTER_RERANK_MODEL.trim() || "voyageai/rerank-3",
        timeoutSeconds: timeout.seconds,
      };
    }
    const queryEnhancer: Toggle<{ apiKey: string }> = apiKey
      ? { enabled: true, apiKey }
      : missingKey;
    return { rerank, queryEnhancer };
  });

const redis = z
  .object({
    REDIS_HOST: text("localhost"),
    REDIS_PORT: integer(6379),
    REDIS_PASSWORD: secret,
    REDIS_USERNAME: text("default"),
  })
  .transform((env) => ({
    host: env.REDIS_HOST,
    port: env.REDIS_PORT,
    auth: env.REDIS_PASSWORD
      ? { username: env.REDIS_USERNAME, password: env.REDIS_PASSWORD }
      : undefined,
  }));

const quota = z
  .object({
    ANON_LIMIT: integer(10),
    FREE_USER_LIMIT: integer(30),
    CHECKOUT_GRACE_TTL: integer(300),
    CHECKOUT_RATE_LIMIT: integer(10),
    CHECKOUT_RATE_LIMIT_WINDOW: integer(3600),
  })
  .transform((env) => ({
    anonLimit: env.ANON_LIMIT,
    freeUserLimit: env.FREE_USER_LIMIT,
    checkoutGraceTtlSeconds: env.CHECKOUT_GRACE_TTL,
    checkoutRateLimit: env.CHECKOUT_RATE_LIMIT,
    checkoutRateLimitWindowSeconds: env.CHECKOUT_RATE_LIMIT_WINDOW,
  }));

const clerk = z
  .object({
    CLERK_SECRET_KEY: secret,
    CLERK_FRONTEND_API: text(""),
    CLERK_PERMITTED_ORIGINS: text(""),
  })
  .transform((env) => ({
    secretKey: env.CLERK_SECRET_KEY,
    frontendApi: env.CLERK_FRONTEND_API.replaceAll("https://", "")
      .replaceAll("http://", "")
      .replace(/\/+$/, ""),
    permittedOrigins: commaList(env.CLERK_PERMITTED_ORIGINS),
  }));

const polar = z
  .object({
    POLAR_ACCESS_TOKEN: secret,
    POLAR_WEBHOOK_SECRET: secret,
    POLAR_PRO_PRODUCT_ID: text(""),
    ALLOWED_REDIRECT_HOSTS: text(""),
  })
  .transform((env) => ({
    accessToken: env.POLAR_ACCESS_TOKEN,
    webhookSecret: env.POLAR_WEBHOOK_SECRET,
    proProductId: env.POLAR_PRO_PRODUCT_ID.trim() || undefined,
    allowedRedirectHosts: commaList(env.ALLOWED_REDIRECT_HOSTS),
  }));

const rapidApi = z
  .object({ RAPIDAPI_SECRET: secret, DEBUG_MODE: text("false") })
  .transform((env) => ({
    secret: env.RAPIDAPI_SECRET,
    debugMode: env.DEBUG_MODE.toLowerCase() === "true",
  }));

const googleCrawler = z
  .object({
    GOOGLE_CRAWLER_BYPASS_ENABLED: flag("true"),
    GOOGLE_CRAWLER_TRUST_CF_CONNECTING_IP: flag("false"),
    GOOGLE_CRAWLER_IP_RANGE_TTL_SECONDS: lenientInteger(86400),
    GOOGLE_CRAWLER_IP_RANGE_NEGATIVE_TTL_SECONDS: lenientInteger(300),
    GOOGLE_CRAWLER_IP_RANGE_TIMEOUT_SECONDS: lenientDecimal(2),
  })
  .transform((env) => ({
    bypassEnabled: env.GOOGLE_CRAWLER_BYPASS_ENABLED,
    trustCfConnectingIp: env.GOOGLE_CRAWLER_TRUST_CF_CONNECTING_IP,
    ipRangeTtlSeconds: Math.max(0, env.GOOGLE_CRAWLER_IP_RANGE_TTL_SECONDS),
    ipRangeNegativeTtlSeconds: Math.max(
      0,
      env.GOOGLE_CRAWLER_IP_RANGE_NEGATIVE_TTL_SECONDS,
    ),
    ipRangeTimeoutSeconds: Math.max(
      0.1,
      env.GOOGLE_CRAWLER_IP_RANGE_TIMEOUT_SECONDS,
    ),
  }));

const DEFAULT_OUTBOUND_BUDGET_SECONDS = 60;

const classification = z
  .object({
    CLASSIFICATION_OUTBOUND_BUDGET_SECONDS: lenientDecimal(
      DEFAULT_OUTBOUND_BUDGET_SECONDS,
    ),
  })
  .transform((env) => ({
    outboundBudgetSeconds:
      env.CLASSIFICATION_OUTBOUND_BUDGET_SECONDS > 0
        ? env.CLASSIFICATION_OUTBOUND_BUDGET_SECONDS
        : DEFAULT_OUTBOUND_BUDGET_SECONDS,
  }));

const appConfigSchema = z.object({
  server,
  qdrant,
  embedding,
  openRouter,
  redis,
  quota,
  clerk,
  polar,
  rapidApi,
  googleCrawler,
  classification,
});

export type AppConfig = DeepReadonly<z.output<typeof appConfigSchema>>;

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

// Messages name variables but never echo their values, which may be secrets.
function describeIssue(issue: z.core.$ZodIssue): string {
  const variable = issue.path.at(-1);
  return `${String(variable)} ${issue.message}`;
}

export function parseAppConfig(env: NodeJS.ProcessEnv): AppConfig {
  const perGroup = Object.fromEntries(
    Object.keys(appConfigSchema.shape).map((group) => [group, env]),
  );
  const result = appConfigSchema.safeParse(perGroup);
  if (!result.success) {
    const problems = result.error.issues.map(describeIssue).join("; ");
    throw new ConfigError(`Invalid environment: ${problems}`);
  }
  return deepFreeze(result.data);
}
