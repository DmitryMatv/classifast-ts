import { ConfigError, parseAppConfig } from "./app-config.js";

const SECRET = "s3cr3t-value-9187";

function configError(env: NodeJS.ProcessEnv): ConfigError {
  try {
    parseAppConfig(env);
  } catch (error) {
    if (error instanceof ConfigError) return error;
    throw error;
  }
  throw new Error("expected parseAppConfig to throw");
}

describe("parseAppConfig", () => {
  it("applies the Python defaults to an empty environment", () => {
    expect(parseAppConfig({})).toEqual({
      server: { host: "0.0.0.0", port: 8001 },
      qdrant: { url: "http://localhost:6333", apiKey: undefined },
      embedding: {
        model: "Qwen/Qwen3-Embedding-8B",
        dims: 2048,
        client: { enabled: false, reason: "HF_TOKEN not found" },
      },
      openRouter: {
        rerank: { enabled: false, reason: "OPENROUTER_API_KEY not found" },
        queryEnhancer: {
          enabled: false,
          reason: "OPENROUTER_API_KEY not found",
        },
      },
      redis: { host: "localhost", port: 6379, auth: undefined },
      quota: {
        anonLimit: 10,
        freeUserLimit: 30,
        checkoutGraceTtlSeconds: 300,
        checkoutRateLimit: 10,
        checkoutRateLimitWindowSeconds: 3600,
      },
      clerk: { secretKey: undefined, frontendApi: "", permittedOrigins: [] },
      polar: {
        accessToken: undefined,
        webhookSecret: undefined,
        proProductId: undefined,
        allowedRedirectHosts: [],
      },
      rapidApi: { secret: undefined, debugMode: false },
      googleCrawler: {
        bypassEnabled: true,
        trustCfConnectingIp: false,
        ipRangeTtlSeconds: 86400,
        ipRangeNegativeTtlSeconds: 300,
        ipRangeTimeoutSeconds: 2,
      },
      classification: { outboundBudgetSeconds: 60 },
    });
  });

  it("parses configured values the way Python converts them", () => {
    const config = parseAppConfig({
      PORT: " 9000 ",
      QDRANT_URL: "qdrant.example.com/",
      QDRANT_API_KEY: " key ",
      HF_TOKEN: "hf",
      HF_INFERENCE_PROVIDER: " ",
      HF_EMBEDDING_TIMEOUT_SECONDS: "2.5",
      OPENROUTER_API_KEY: "or",
      OPENROUTER_RERANK_MODEL: " ",
      REDIS_PASSWORD: "pw",
      ANON_LIMIT: "-3",
      CLERK_FRONTEND_API: "https://clerk.example.com//",
      CLERK_PERMITTED_ORIGINS: " https://a.example , ,https://b.example",
      POLAR_PRO_PRODUCT_ID: "  ",
      DEBUG_MODE: "TRUE",
      GOOGLE_CRAWLER_BYPASS_ENABLED: " Off ",
      GOOGLE_CRAWLER_TRUST_CF_CONNECTING_IP: " YES ",
      GOOGLE_CRAWLER_IP_RANGE_TTL_SECONDS: "-5",
      GOOGLE_CRAWLER_IP_RANGE_TIMEOUT_SECONDS: "0.01",
      CLASSIFICATION_OUTBOUND_BUDGET_SECONDS: "-1",
    });

    expect(config.server.port).toBe(9000);
    expect(config.qdrant).toEqual({
      url: "https://qdrant.example.com",
      apiKey: "key",
    });
    expect(config.embedding.client).toEqual({
      enabled: true,
      token: "hf",
      provider: "auto",
      timeoutSeconds: 2.5,
    });
    expect(config.openRouter).toEqual({
      rerank: {
        enabled: true,
        apiKey: "or",
        model: "voyageai/rerank-3",
        timeoutSeconds: 30,
      },
      queryEnhancer: { enabled: true, apiKey: "or" },
    });
    expect(config.redis.auth).toEqual({ username: "default", password: "pw" });
    expect(config.quota.anonLimit).toBe(-3);
    expect(config.clerk.frontendApi).toBe("clerk.example.com");
    expect(config.clerk.permittedOrigins).toEqual([
      "https://a.example",
      "https://b.example",
    ]);
    expect(config.polar.proProductId).toBeUndefined();
    expect(config.rapidApi.debugMode).toBe(true);
    expect(config.googleCrawler).toMatchObject({
      bypassEnabled: false,
      trustCfConnectingIp: true,
      ipRangeTtlSeconds: 0,
      ipRangeTimeoutSeconds: 0.1,
    });
    expect(config.classification.outboundBudgetSeconds).toBe(60);
  });

  it("treats empty secrets as unset, as Python's `if not value` does", () => {
    const config = parseAppConfig({
      HF_TOKEN: "",
      OPENROUTER_API_KEY: "",
      REDIS_PASSWORD: "",
      CLERK_SECRET_KEY: "",
    });

    expect(config.embedding.client.enabled).toBe(false);
    expect(config.openRouter.queryEnhancer.enabled).toBe(false);
    expect(config.redis.auth).toBeUndefined();
    expect(config.clerk.secretKey).toBeUndefined();
  });

  it.each(["0", "-1", "soon", "", "1e309"])(
    "disables a client whose timeout is %j instead of failing boot",
    (timeout) => {
      const config = parseAppConfig({
        HF_TOKEN: "hf",
        HF_EMBEDDING_TIMEOUT_SECONDS: timeout,
        OPENROUTER_API_KEY: "or",
        OPENROUTER_RERANK_TIMEOUT_SECONDS: timeout,
      });

      expect(config.embedding.client).toEqual({
        enabled: false,
        reason:
          "HF_EMBEDDING_TIMEOUT_SECONDS must be a number greater than zero",
      });
      expect(config.openRouter.rerank.enabled).toBe(false);
      expect(config.openRouter.queryEnhancer.enabled).toBe(true);
    },
  );

  it("falls back to defaults for variables Python reads leniently", () => {
    const config = parseAppConfig({
      GOOGLE_CRAWLER_IP_RANGE_TTL_SECONDS: SECRET,
      GOOGLE_CRAWLER_IP_RANGE_NEGATIVE_TTL_SECONDS: SECRET,
      GOOGLE_CRAWLER_IP_RANGE_TIMEOUT_SECONDS: SECRET,
      CLASSIFICATION_OUTBOUND_BUDGET_SECONDS: SECRET,
    });

    expect(config.googleCrawler).toMatchObject({
      ipRangeTtlSeconds: 86400,
      ipRangeNegativeTtlSeconds: 300,
      ipRangeTimeoutSeconds: 2,
    });
    expect(config.classification.outboundBudgetSeconds).toBe(60);
  });

  it.each(["1e309", "-1e309"])(
    "falls back to defaults when duration conversion overflows for %j",
    (raw) => {
      const config = parseAppConfig({
        GOOGLE_CRAWLER_IP_RANGE_TIMEOUT_SECONDS: raw,
        CLASSIFICATION_OUTBOUND_BUDGET_SECONDS: raw,
      });

      expect(config.googleCrawler.ipRangeTimeoutSeconds).toBe(2);
      expect(config.classification.outboundBudgetSeconds).toBe(60);
    },
  );

  it.each([
    "PORT",
    "HF_EMBEDDING_DIMS",
    "REDIS_PORT",
    "ANON_LIMIT",
    "FREE_USER_LIMIT",
    "CHECKOUT_GRACE_TTL",
    "CHECKOUT_RATE_LIMIT",
    "CHECKOUT_RATE_LIMIT_WINDOW",
    "QDRANT_PORT",
  ])("fails boot on a malformed %s without echoing its value", (name) => {
    const error = configError({ [name]: SECRET });

    expect(error.message).toBe(
      `Invalid environment: ${name} must be an integer`,
    );
    expect(error.message).not.toContain(SECRET);
  });

  it("reads numbers with Python's int() and float() grammar", () => {
    const config = parseAppConfig({
      ANON_LIMIT: "1_000",
      HF_EMBEDDING_DIMS: "2_048",
      HF_TOKEN: "hf",
      HF_EMBEDDING_TIMEOUT_SECONDS: "2_0",
      CLASSIFICATION_OUTBOUND_BUDGET_SECONDS: "1_0",
      OPENROUTER_API_KEY: "or",
      OPENROUTER_RERANK_TIMEOUT_SECONDS: "0x14",
    });
    expect(config.quota.anonLimit).toBe(1000);
    expect(config.embedding.dims).toBe(2048);
    expect(config.embedding.client).toMatchObject({
      enabled: true,
      timeoutSeconds: 20,
    });
    expect(config.classification.outboundBudgetSeconds).toBe(10);
    expect(config.openRouter.rerank.enabled).toBe(false);
  });

  it("names every malformed variable in one error", () => {
    const error = configError({ REDIS_PORT: "x", ANON_LIMIT: "1.5" });

    expect(error.message).toContain("REDIS_PORT");
    expect(error.message).toContain("ANON_LIMIT");
  });

  it.each(["+6333", "6_333", " +6_333 "])(
    "normalizes the Python integer spelling %j in QDRANT_PORT",
    (port) => {
      expect(
        parseAppConfig({ QDRANT_HOST: "qdrant.local", QDRANT_PORT: port })
          .qdrant.url,
      ).toBe("http://qdrant.local:6333");
    },
  );

  it.each(["http://q:1", " http://q:1 "])(
    "ignores QDRANT_PORT when QDRANT_URL is %j, as Python does",
    (url) => {
      expect(
        parseAppConfig({ QDRANT_URL: url, QDRANT_PORT: "x" }).qdrant.url,
      ).toBe("http://q:1");
    },
  );

  it.each(["", "   "])(
    "rejects a malformed QDRANT_PORT when QDRANT_URL is %j",
    (url) => {
      const error = configError({ QDRANT_URL: url, QDRANT_PORT: SECRET });

      expect(error.message).toBe(
        "Invalid environment: QDRANT_PORT must be an integer",
      );
      expect(error.message).not.toContain(SECRET);
    },
  );

  it("returns a deeply frozen config", () => {
    const config = parseAppConfig({ HF_TOKEN: "hf" });

    expect(Object.isFrozen(config)).toBe(true);
    expect(Object.isFrozen(config.embedding.client)).toBe(true);
    expect(Object.isFrozen(config.clerk.permittedOrigins)).toBe(true);
  });
});
