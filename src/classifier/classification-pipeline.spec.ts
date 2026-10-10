import {
  pipelineFixture,
  type FakePoint,
  type PipelineFixture,
  type PipelineOptions,
} from "../../test/support/classification-pipeline.js";
import {
  ClassificationError,
  DEFAULT_RERANK_CANDIDATE_LIMIT,
} from "./classification.js";
import {
  performClassification,
  type ClassificationInput,
} from "./classification-pipeline.js";
import { buildClassifierConfig } from "./classifier-config.js";
import { buildQueryEmbeddingText } from "./model-text.js";

const CONFIG = buildClassifierConfig({});
const ETIM_VERSION = Object.keys(CONFIG.ETIM!.versions)[0]!;

const pumpBody: FakePoint = {
  id: "semantic-1",
  score: 0.41,
  payload: { original_id: "1234", class_name: "Pump body" },
};
const pumpCasing: FakePoint = {
  id: "semantic-2",
  score: 0.39,
  payload: { original_id: "5678", class_name: "Pump casing" },
};

let fixture: PipelineFixture | undefined;

async function setUp(options: PipelineOptions = {}) {
  fixture = await pipelineFixture(options);
  return fixture;
}

afterEach(async () => {
  await fixture?.qdrant.close();
  fixture = undefined;
});

function classify(
  { deps }: PipelineFixture,
  input: Partial<ClassificationInput> = {},
  signal = new AbortController().signal,
) {
  return performClassification(
    deps,
    {
      query: "industrial pump",
      classifierType: "ETIM",
      version: ETIM_VERSION,
      topK: 2,
      ...input,
    },
    signal,
  );
}

function ids(results: readonly { id: unknown }[]) {
  return results.map((result) => result.id);
}

describe("performClassification ID shortcuts", () => {
  it("answers an exact ID match without partial or semantic search", async () => {
    const exact: FakePoint = {
      id: "exact-1",
      payload: { original_id: "8471", class_name: "Portable computers" },
    };
    const f = await setUp({ exact: [exact], rerank: [0.5] });

    const outcome = await classify(f, { query: "8471", topK: 10 });

    expect(outcome.results).toEqual([
      {
        id: "exact-1",
        score: 1.0,
        payload: exact.payload,
        rerankRelevanceScore: 0.0,
      },
    ]);
    expect(f.requests("partial")).toHaveLength(0);
    expect(f.embedCalls).toHaveLength(0);
    expect(f.requests("semantic")).toHaveLength(0);
  });

  it("keeps the semantic path but skips reranking when partial IDs match", async () => {
    const f = await setUp({
      partial: [{ id: "partial-1", payload: { original_id: "00084710" } }],
      semantic: [
        {
          id: "semantic-1",
          score: 0.42,
          payload: { original_id: "12345678" },
        },
      ],
      rerank: [0.9],
    });

    const outcome = await classify(f, { query: "0008471000", topK: 10 });

    expect(ids(outcome.results)).toEqual(["partial-1", "semantic-1"]);
    expect(outcome.results[0]!.score).toBe(0.9);
    expect(f.embedCalls).toHaveLength(1);
    expect(f.requests("semantic")[0]!.limit).toBe(10);
    expect(f.rerankCalls).toHaveLength(0);
  });

  it("drops semantic hits that an ID search already returned", async () => {
    const f = await setUp({
      partial: [{ id: "same", payload: { original_id: "084710" } }],
      semantic: [{ id: "same", score: 0.99, payload: {} }, pumpBody],
    });

    const outcome = await classify(f, { query: "8471", topK: 5 });

    expect(ids(outcome.results)).toEqual(["same", "semantic-1"]);
    expect(outcome.results[0]!.score).toBe(0.9);
  });

  it("searches IDs with the query and embeds and reranks the semantic query", async () => {
    const f = await setUp({ semantic: [pumpBody], rerank: [0.7] });

    const outcome = await classify(f, {
      query: "bolt",
      semanticQuery: "bolt. Threaded fastener",
    });

    expect(outcome.query).toBe("bolt");
    expect(f.requests("exact")[0]!.filter).toEqual({
      must: [{ key: "original_id", match: { value: "bolt" } }],
    });
    expect(JSON.stringify(f.requests("partial")[0]!.filter)).toContain(
      '"text":"bolt"',
    );
    expect(f.embedCalls[0]!.text).toContain("bolt. Threaded fastener");
    expect(f.rerankCalls[0]!.query).toContain("bolt. Threaded fastener");
  });

  it("skips the partial search for normalized IDs shorter than 3 characters", async () => {
    const f = await setUp({ semantic: [pumpBody] });

    await classify(f, { query: "0a0" });

    expect(f.requests("partial")).toHaveLength(0);
  });
});

describe("performClassification semantic search", () => {
  it("reranks 100 candidates when no ID matches", async () => {
    const f = await setUp({
      semantic: [pumpBody, pumpCasing],
      rerank: [0.52, 0.91],
    });

    const outcome = await classify(f);

    expect(ids(outcome.results)).toEqual(["semantic-2", "semantic-1"]);
    expect(outcome.results[0]!.score).toBe(0.91);
    expect(outcome.query).toBe("industrial pump");
    expect(f.embedCalls[0]!.text).toBe(
      buildQueryEmbeddingText("industrial pump", CONFIG.ETIM!.queryInstruction),
    );
    expect(f.requests("semantic")[0]!.limit).toBe(
      DEFAULT_RERANK_CANDIDATE_LIMIT,
    );
    expect(f.rerankCalls).toEqual([
      {
        query: `${CONFIG.ETIM!.rerankInstruction}\nQuery: industrial pump`,
        documents: ["Pump body", "Pump casing"],
      },
    ]);
  });

  it("fetches only the displayed results without a reranker", async () => {
    const f = await setUp({ semantic: [pumpBody, pumpCasing] });

    const outcome = await classify(f);

    expect(ids(outcome.results)).toEqual(["semantic-1", "semantic-2"]);
    expect(outcome.results.map((result) => result.score)).toEqual([0.41, 0.39]);
    expect(f.requests("semantic")[0]!.limit).toBe(2);
  });

  it("keeps semantic scores when the reranker fails", async () => {
    const f = await setUp({
      semantic: [pumpBody, pumpCasing],
      rerank: new Error("down"),
    });

    const outcome = await classify(f);

    expect(outcome.results.map((result) => result.score)).toEqual([0.41, 0.39]);
    expect(
      outcome.results.every((r) => r.rerankRelevanceScore === undefined),
    ).toBe(true);
  });

  it.each([
    ["ETIM", true],
    ["UNSPSC", false],
  ])("searches %s with exact=%s", async (classifierType, exact) => {
    const f = await setUp({ semantic: [pumpBody] });

    await classify(f, { classifierType, version: undefined, topK: 1 });

    expect(f.requests("semantic")[0]!.params).toEqual({ hnsw_ef: 256, exact });
  });

  it("rescores a quantized collection with oversampling", async () => {
    const collection = CONFIG.ETIM!.versions[ETIM_VERSION]!.collectionName;
    const f = await setUp({ semantic: [pumpBody], quantized: [collection] });

    await classify(f);

    expect(f.requests("semantic")[0]!.params).toEqual({
      hnsw_ef: 256,
      exact: true,
      quantization: { ignore: false, rescore: true, oversampling: 3.0 },
    });
  });

  it("embeds with the classifier's model and dimensions", async () => {
    const f = await setUp({ semantic: [pumpBody] });

    await classify(f);

    expect(f.embedCalls[0]).toMatchObject({
      model: "Qwen/Qwen3-Embedding-8B",
      dims: 2048,
    });
  });
});

describe("performClassification failures", () => {
  it.each([
    [
      "an unknown classifier",
      { classifierType: "DOES_NOT_EXIST" },
      404,
      "Classifier 'DOES_NOT_EXIST' not found",
    ],
    [
      "an unknown version",
      { version: "missing-version" },
      404,
      "Version 'missing-version' for classifier 'ETIM' not found",
    ],
    [
      "a one-character query",
      { query: "x" },
      400,
      "Query too short (min 2 characters)",
    ],
  ] as const)("rejects %s", async (_name, input, status, detail) => {
    const f = await setUp();

    await expect(classify(f, input)).rejects.toEqual(
      new ClassificationError(status, detail),
    );
    expect(f.qdrant.requests).toHaveLength(0);
  });

  it("answers 503 without an embedding client", async () => {
    const f = await setUp({ embedder: null });

    await expect(classify(f)).rejects.toMatchObject({
      status: 503,
      detail: "Backend services not available. Please check server logs.",
    });
  });

  it("answers a stable 500 when embedding fails", async () => {
    const f = await setUp({
      embed: () => Promise.reject(new Error("Empty embedding generated")),
    });

    await expect(classify(f)).rejects.toMatchObject({
      status: 500,
      detail: "Failed to generate embedding for classification",
    });
  });

  it("answers a stable 500 when semantic search fails", async () => {
    const f = await setUp();
    await f.qdrant.close();
    const exactAndPartialSucceed = await setUp();
    const deps = {
      ...exactAndPartialSucceed.deps,
      qdrant: {
        scroll: exactAndPartialSucceed.deps.qdrant.scroll.bind(
          exactAndPartialSucceed.deps.qdrant,
        ),
        query: f.deps.qdrant.query.bind(f.deps.qdrant),
      },
    };

    await expect(
      performClassification(
        deps,
        { query: "industrial pump", classifierType: "ETIM", topK: 2 },
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({
      status: 500,
      detail: "Semantic search failed. Please try again.",
    });
  });

  it("treats failed ID searches as no matches", async () => {
    const f = await setUp({ semantic: [pumpBody] });
    const deps = {
      ...f.deps,
      qdrant: {
        scroll: () => Promise.reject(new Error("Qdrant down")),
        query: f.deps.qdrant.query.bind(f.deps.qdrant),
      },
    };

    const outcome = await performClassification(
      deps,
      { query: "8471 pump", classifierType: "ETIM", topK: 2 },
      new AbortController().signal,
    );

    expect(ids(outcome.results)).toEqual(["semantic-1"]);
  });
});

describe("performClassification outbound budget", () => {
  it("gives the embedding the budget left after the ID searches", async () => {
    const f = await setUp({
      semantic: [pumpBody],
      outboundBudgetSeconds: 60,
    });

    await classify(f);

    expect(f.embedCalls[0]!.maxSeconds).toBe(60);
  });

  it("skips reranking when less than 2 s of the budget is left", async () => {
    const f = await setUp({
      semantic: [pumpBody, pumpCasing],
      rerank: [0.52, 0.91],
      outboundBudgetSeconds: 10,
      embed: async () => {
        f.clock.advance(8_500);
        return [0.1];
      },
    });

    const outcome = await classify(f);

    expect(f.rerankCalls).toHaveLength(0);
    expect(outcome.results).toEqual([
      expect.objectContaining({
        id: "semantic-1",
        score: 0.41,
        rerankRelevanceScore: 0,
      }),
      expect.objectContaining({
        id: "semantic-2",
        score: 0.39,
        rerankRelevanceScore: 0,
      }),
    ]);
  });

  it("gives the reranker the budget left after embedding", async () => {
    const timeouts: (number | undefined)[] = [];
    const f = await setUp({
      semantic: [pumpBody],
      outboundBudgetSeconds: 10,
      embed: async () => {
        f.clock.advance(4_000);
        return [0.1];
      },
    });
    const deps = {
      ...f.deps,
      reranker: {
        rerank: async (
          _query: string,
          _documents: readonly string[],
          { timeoutSeconds }: { timeoutSeconds?: number },
        ) => {
          timeouts.push(timeoutSeconds);
          return [0.5];
        },
      },
    };

    await performClassification(
      deps,
      { query: "industrial pump", classifierType: "ETIM", topK: 2 },
      new AbortController().signal,
    );

    expect(timeouts).toEqual([6]);
  });
});

describe("performClassification cancellation", () => {
  it("stops between stages once the signal aborts", async () => {
    const controller = new AbortController();
    const f = await setUp({
      semantic: [pumpBody],
      rerank: [0.5],
      embed: async () => {
        controller.abort(new Error("client gone"));
        return [0.1];
      },
    });

    await expect(classify(f, {}, controller.signal)).rejects.toThrow(
      "client gone",
    );
    expect(f.requests("semantic")).toHaveLength(0);
    expect(f.rerankCalls).toHaveLength(0);
  });
});
