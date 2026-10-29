import {
  classificationTimeout,
  contract,
  fullMode,
  unmetPrerequisites,
} from "./support/env.js";
import {
  expectCacheProfile,
  expectStatus,
  freshClientIp,
  parseJson,
  send,
  type Reply,
} from "./support/http.js";

const VERSION = "UNSPSC UNv260801.1 (18 March 2025)";

// The order the classifier page's client sends, so the URL is canonical.
function resultsPath(
  description: string,
  { topK = 10, enhance = false } = {},
): string {
  const params = new URLSearchParams([
    ["product_description", description],
    ["version", VERSION],
    ["top_k", String(topK)],
  ]);
  if (enhance) params.append("enhance_query", "1");
  return `/api/results/UNSPSC?${params.toString()}`;
}

function results(path: string, ip = freshClientIp()) {
  return send(path, { headers: { "cf-connecting-ip": ip } });
}

type Body = { kind: string; [key: string]: unknown };

function expectBody(reply: Reply, status: number, kind: string): Body {
  expectStatus(reply, status);
  expect(reply.headers.get("content-type")).toBe(
    "application/json; charset=utf-8",
  );
  const body = parseJson(reply) as Body;
  expect(body.kind, `${reply.label} kind`).toBe(kind);
  return body;
}

function expectError(reply: Reply, status: number, message: string) {
  const body = expectBody(reply, status, "error");
  expectCacheProfile(reply, "NO_STORE");
  expect(reply.headers.get("cache-tag")).toBeNull();
  expect(body).toEqual({ kind: "error", message });
}

describe.runIf(contract.mode === "public")(
  "results API without usage tracking",
  () => {
    it("a description gets busy before any classification", async () => {
      const reply = await results(resultsPath("laptop computer"));
      const body = expectBody(reply, 503, "busy");
      expectCacheProfile(reply, "NO_STORE");
      expect(body).toEqual({
        kind: "busy",
        message: "Usage tracking is temporarily unavailable",
      });
    });
  },
);

describe("results API refusals", () => {
  it("an empty description is a 422 error", async () => {
    expectError(await results(resultsPath("")), 422, "Please enter a query");
  });

  it("a missing description is a 422 error", async () => {
    expectError(
      await results("/api/results/UNSPSC?top_k=3"),
      422,
      "Invalid query parameters",
    );
  });

  it("an unknown classifier is a 404 error", async () => {
    expectError(
      await results("/api/results/NOPE?product_description=laptop"),
      404,
      "Classifier 'NOPE' not found",
    );
  });

  it("uncollapsed whitespace redirects to the canonical query", async () => {
    const reply = await results(
      "/api/results/UNSPSC?product_description=laptop%20%20computer",
    );
    expectStatus(reply, 308);
  });

  it("HEAD never classifies", async () => {
    const reply = await send(resultsPath("laptop computer"), {
      method: "HEAD",
    });
    expectStatus(reply, 405);
    expect(reply.headers.get("allow")).toBe("GET");
    expectCacheProfile(reply, "NO_STORE");
    expect(reply.bytes.length).toBe(0);
  });
});

// Semantic-only results stay out of every cache.
const resultProfile = contract.noOpenRouterKey
  ? "NO_STORE"
  : "CLASSIFICATION_RESULT";

describe.runIf(fullMode)(
  "results API results",
  { timeout: classificationTimeout(2) },
  () => {
    it.each([
      [{}, 10, "/UNSPSC/laptop_computer/"],
      [{ topK: 3 }, 3, "/UNSPSC/laptop_computer/?top_k=3"],
    ])("options %o give %i results", async (options, items, url) => {
      const reply = await results(resultsPath("laptop computer", options));
      const body = expectBody(reply, 200, "results");
      expectCacheProfile(reply, resultProfile);
      expect(reply.headers.get("cache-tag")).toBe("classification-results");
      expect(reply.headers.get("hx-push-url")).toBeNull();
      expect(body).toMatchObject({
        version: VERSION,
        query: "laptop computer",
        url,
        title: "UNSPSC codes for 'Laptop Computer'",
      });
      expect(body["elapsed"]).toMatch(/^\d+\.\d\d$/);
      const list = body["results"] as Record<string, unknown>[];
      expect(list).toHaveLength(items);
      for (const result of list) {
        expect(result["originalId"]).toMatch(/\S/);
        expect(result["scoreWidth"]).toMatch(/^\d+\.\d\d$/);
        expect(result["scoreLabel"]).toMatch(/^\d+\.\d$/);
      }
    });

    it("a failed enhancement returns the plain results uncached", async ({
      skip,
    }) => {
      const unmet = unmetPrerequisites(["noOpenRouterKey"]);
      skip(unmet.length > 0, unmet.join(", "));
      const reply = await results(
        resultsPath("laptop computer", { enhance: true }),
      );
      const body = expectBody(reply, 200, "results");
      expectCacheProfile(reply, "NO_STORE");
      expect(body["url"]).toBe("/UNSPSC/laptop_computer/?enhance_query=1");
    });
  },
);

describe.runIf(fullMode)(
  "results API paywall",
  { timeout: classificationTimeout(contract.anonLimit + 1) },
  () => {
    it(`the request after ${contract.anonLimit} anonymous lookups gets 402`, async () => {
      const ip = freshClientIp();
      for (let lookup = 1; lookup <= contract.anonLimit; lookup += 1) {
        expectBody(
          await results(resultsPath("laptop computer"), ip),
          200,
          "results",
        );
      }
      const reply = await results(resultsPath("laptop computer"), ip);
      const body = expectBody(reply, 402, "paywall");
      expectCacheProfile(reply, "NO_STORE");
      expect(reply.headers.get("cache-tag")).toBeNull();
      expect(reply.headers.get("x-ratelimit-limit")).toBe(
        String(contract.anonLimit),
      );
      expect(reply.headers.get("x-ratelimit-remaining")).toBe("0");
      expect(body).toEqual({
        kind: "paywall",
        signedIn: false,
        limit: contract.anonLimit,
        url: "/UNSPSC/laptop_computer/",
        title: "UNSPSC codes for 'Laptop Computer'",
      });
    });
  },
);
