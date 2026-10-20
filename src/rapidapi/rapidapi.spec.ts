import { z } from "zod";
import { readGolden } from "../../test/support/golden.js";
import { buildClassifierConfig } from "../classifier/classifier-config.js";
import { parseQueryString } from "../web/request-url.js";
import {
  checkProxySecret,
  classifyBody,
  debugHeadersBody,
  parseClassifyQuery,
  pingReply,
  standardsBody,
} from "./rapidapi.js";

const outcomeSchema = z.union([
  z.object({
    status: z.literal(200),
    classify: z.object({
      query: z.string(),
      classifier_type: z.string(),
      version: z.string().nullable(),
      top_k: z.number().int(),
    }),
    body: z.record(z.string(), z.unknown()),
  }),
  z.object({
    status: z.literal([400, 422]),
    body: z.object({ detail: z.unknown() }),
  }),
]);

const golden = readGolden(
  "rapidapi-query.json",
  z.object({
    queries: z.array(z.object({ rawQuery: z.string() }).and(outcomeSchema)),
    topK: z.array(z.object({ input: z.string() }).and(outcomeSchema)),
  }),
);

const EMPTY_OUTCOME = {
  results: [],
  version: { collectionName: "c" },
  versionName: "v",
};

function expectPythonOutcome(
  rawQuery: string,
  expected: z.infer<typeof outcomeSchema>,
) {
  const parsed = parseClassifyQuery(parseQueryString(rawQuery));
  if (expected.status !== 200) {
    expect(parsed).toEqual({
      ok: false,
      status: expected.status,
      detail: expected.body.detail,
    });
    return;
  }
  if (!parsed.ok) throw new Error(`expected 200, got ${parsed.status}`);
  const { classify } = expected;
  expect(parsed.value).toEqual({
    query: classify.query,
    classifierType: classify.classifier_type,
    version: classify.version ?? undefined,
    topK: classify.top_k,
  });
  const { processing_time: _time, ...body } = classifyBody(
    parsed.value,
    EMPTY_OUTCOME,
    0,
  );
  expect(body).toEqual(expected.body);
}

describe("parseClassifyQuery", () => {
  it.for(golden.queries)("answers ?$rawQuery as Python does", (entry) => {
    expectPythonOutcome(entry.rawQuery, entry);
  });

  it.for(
    golden.topK.map((entry) => ({
      ...entry,
      label: JSON.stringify(entry.input).slice(0, 40),
    })),
  )("parses top_k=$label as pydantic does", (entry) => {
    expectPythonOutcome(
      `query=a&standard=x&top_k=${encodeURIComponent(entry.input)}`,
      entry,
    );
  });
});

describe("checkProxySecret", () => {
  it.each([
    [undefined, "anything", "unconfigured"],
    ["", "anything", "unconfigured"],
    ["secret", undefined, "missing"],
    ["secret", "", "missing"],
    ["secret", "secreT", "invalid"],
    ["secret", "secret-but-longer", "invalid"],
    ["secret", "secret", "accepted"],
  ] as const)(
    "configured %j, presented %j: %s",
    (configured, presented, verdict) => {
      expect(checkProxySecret(configured, presented)).toBe(verdict);
    },
  );
});

describe("classifyBody", () => {
  const request = {
    query: "pump",
    classifierType: "GPC",
    version: undefined,
    topK: 3,
  };
  const result = (payload: Record<string, unknown>) => ({
    id: 1,
    score: 0.5,
    payload,
  });

  it("links each code the way the version config says", () => {
    const body = (version: object) =>
      classifyBody(
        request,
        {
          results: [
            result({ original_id: "123", class_name: "Pump" }),
            result({ class_name: "No code" }),
          ],
          version: { collectionName: "c", ...version },
          versionName: "v1",
        },
        1.25,
      );

    expect(body({ baseUrl: "https://x/" })).toEqual({
      query: "pump",
      standard: "gpc",
      version: "v1",
      results: [
        { code: "123", name: "Pump", score: 0.5, url: "https://x/123" },
        { code: "", name: "No code", score: 0.5, url: null },
      ],
      processing_time: 1.25,
    });
    expect(
      body({ baseUrl: "https://x/", appendCodeToUrl: false }).results[0]!.url,
    ).toBe("https://x/");
    expect(body({}).results[0]!.url).toBeNull();
  });

  it("rejects a payload field that Python's str model rejects", () => {
    expect(() =>
      classifyBody(
        request,
        {
          results: [result({ original_id: 123, class_name: "Pump" })],
          version: { collectionName: "c" },
          versionName: "v1",
        },
        0,
      ),
    ).toThrow(TypeError);
  });
});

describe("standardsBody", () => {
  it("lists every classifier with its versions and example", () => {
    const body = standardsBody(buildClassifierConfig({}), 12.5);

    expect(body.timestamp).toBe(12.5);
    expect(body.standards.ISIC).toEqual({
      title: "ISIC Classifier",
      description: expect.stringContaining("ISIC"),
      versions: ["ISIC Rev. 4", "ISIC Rev. 5"],
      example: "Gas station operation",
    });
    expect(Object.keys(body.standards)).toEqual(
      Object.keys(buildClassifierConfig({})),
    );
  });
});

describe("pingReply", () => {
  it.each([
    [true, true, 200, "configured", "healthy"],
    [false, true, 503, "unavailable", "healthy"],
    [true, false, 503, "configured", "unhealthy"],
  ])(
    "embedding %s, database %s: %i",
    (embeddingConfigured, databaseHealthy, status, embedding, database) => {
      expect(pingReply({ embeddingConfigured, databaseHealthy }, 7)).toEqual({
        status,
        body: {
          status: "healthy",
          timestamp: 7,
          services: { embedding, database },
        },
      });
    },
  );
});

describe("debugHeadersBody", () => {
  it("redacts credentials and keeps the first of repeated headers", () => {
    expect(
      debugHeadersBody(
        [
          "Host",
          "example.test",
          "X-RapidAPI-Proxy-Secret",
          "s3cret",
          "Cookie",
          "a=1",
          "X-Seen",
          "first",
          "x-seen",
          "second",
        ],
        3,
      ),
    ).toEqual({
      received_headers: {
        host: "example.test",
        "x-rapidapi-proxy-secret": "[REDACTED]",
        cookie: "[REDACTED]",
        "x-seen": "first",
      },
      timestamp: 3,
      host: "example.test",
      user_agent: null,
    });
  });
});
