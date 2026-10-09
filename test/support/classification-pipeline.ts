import type { Schemas } from "@qdrant/js-client-rest";
import { buildClassifierConfig } from "../../src/classifier/classifier-config.js";
import type {
  Embedder,
  PipelineDeps,
  Reranker,
} from "../../src/classifier/classification-pipeline.js";
import type { EmbeddingRequest } from "../../src/classifier/hf-embedding.js";
import { createQdrantClient } from "../../src/qdrant/qdrant-connection.js";
import { FakeClock } from "./fake-http.js";
import {
  pointsRoute,
  startQdrantServer,
  type QdrantServer,
} from "./qdrant-server.js";

export interface FakePoint {
  readonly id: string | number;
  readonly score?: number;
  readonly payload: Record<string, unknown>;
}

export interface PipelineFixture {
  readonly deps: PipelineDeps;
  readonly clock: FakeClock;
  readonly qdrant: QdrantServer;
  readonly embedCalls: EmbeddingRequest[];
  readonly rerankCalls: { query: string; documents: string[] }[];
  /** Qdrant request bodies by kind. */
  requests(kind: "exact" | "partial" | "semantic"): Schemas["QueryRequest"][];
}

export interface PipelineOptions {
  readonly exact?: readonly FakePoint[];
  readonly partial?: readonly FakePoint[];
  readonly semantic?: readonly FakePoint[];
  readonly embed?: (request: EmbeddingRequest) => Promise<number[]>;
  /** Scores to return, an Error to throw, or null for no reranker. */
  readonly rerank?: readonly number[] | Error | null;
  readonly embedder?: null;
  readonly outboundBudgetSeconds?: number;
  readonly quantized?: readonly string[];
  readonly onRerank?: () => void;
}

function scrollKind(body: unknown): "exact" | "partial" {
  return (body as { filter: { must?: unknown } }).filter.must
    ? "exact"
    : "partial";
}

/**
 * Pipeline dependencies over an HTTP Qdrant fake: a scroll with a `must`
 * filter is the exact ID search and a `should` filter the partial one.
 */
export async function pipelineFixture({
  exact = [],
  partial = [],
  semantic = [],
  embed = async () => [0.1, 0.2, 0.3],
  rerank = null,
  embedder,
  outboundBudgetSeconds = 60,
  quantized = [],
  onRerank,
}: PipelineOptions = {}): Promise<PipelineFixture> {
  const qdrant = await startQdrantServer(
    pointsRoute("scroll", (body) =>
      scrollKind(body) === "exact" ? exact : partial,
    ),
    pointsRoute("query", () =>
      semantic.map((point) => ({ version: 1, score: 0, ...point })),
    ),
  );
  const clock = new FakeClock();
  const embedCalls: EmbeddingRequest[] = [];
  const rerankCalls: { query: string; documents: string[] }[] = [];
  const fakeEmbedder: Embedder = {
    embed: async (request) => {
      embedCalls.push(request);
      return embed(request);
    },
  };
  const reranker: Reranker | null =
    rerank === null
      ? null
      : {
          rerank: async (query, documents) => {
            rerankCalls.push({ query, documents: [...documents] });
            onRerank?.();
            if (rerank instanceof Error) throw rerank;
            return [...rerank];
          },
        };
  return {
    deps: {
      classifiers: buildClassifierConfig({}),
      embedder: embedder === null ? null : fakeEmbedder,
      qdrant: createQdrantClient({ QDRANT_URL: qdrant.url }, 5_000),
      quantizationCache: new Map(quantized.map((name) => [name, true])),
      reranker,
      outboundBudgetSeconds,
      clock,
    },
    clock,
    qdrant,
    embedCalls,
    rerankCalls,
    requests: (kind) =>
      qdrant.requests
        .filter(({ path, body }) =>
          kind === "semantic"
            ? path.endsWith("/points/query")
            : path.endsWith("/points/scroll") && scrollKind(body) === kind,
        )
        .map(({ body }) => body as Schemas["QueryRequest"]),
  };
}
