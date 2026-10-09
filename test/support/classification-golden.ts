import { z } from "zod";
import { readGolden } from "./golden.js";

const pointId = z.union([z.string(), z.number()]);
const payload = z.record(z.string(), z.unknown());

export const resultRecord = z.object({
  id: pointId,
  score: z.number(),
  rerankRelevanceScore: z.number().optional(),
});

const recordedRequest = z.object({
  method: z.string(),
  url: z.string(),
  authorization: z.string().nullable(),
  contentType: z.string().nullable(),
  body: z.unknown(),
});

export const classificationGolden = readGolden(
  "classification.json",
  z.object({
    classifiers: z.record(
      z.string(),
      z.object({
        embedModelName: z.string(),
        embedDims: z.number(),
        queryInstruction: z.string(),
        rerankInstruction: z.string(),
        versions: z.record(z.string(), z.string()),
      }),
    ),
    tiedResults: z.array(resultRecord),
    sorting: z.array(z.object({ topK: z.number(), ids: z.array(pointId) })),
    limits: z.array(
      z.object({ topK: z.number(), reranking: z.boolean(), limit: z.number() }),
    ),
    rerankCandidates: z.array(
      z.object({ id: z.string(), score: z.number(), payload }),
    ),
    rankingScores: z.array(z.number()),
    rerank: z.array(
      z.object({
        scores: z.array(z.number()).nullable(),
        topK: z.number(),
        rerankTopN: z.number(),
        instruction: z.string().nullable(),
        format: z.enum(["legacy", "input_first"]),
        calls: z.array(
          z.object({ query: z.string(), documents: z.array(z.string()) }),
        ),
        results: z.array(resultRecord),
      }),
    ),
    ranking: z.array(
      z.object({
        reranker: z.boolean(),
        idMatches: z.array(resultRecord),
        remainingSeconds: z.number().nullable(),
        semantic: z.array(resultRecord),
        rerankCalls: z.number(),
        ranked: z.array(resultRecord),
        merged: z.array(resultRecord),
      }),
    ),
    partialIdPoints: z.array(
      z.object({ id: pointId, payload: payload.nullable() }),
    ),
    partialIds: z.array(z.object({ query: z.string(), ids: z.array(pointId) })),
    rerankResponses: z.array(
      z.object({
        payload: z.unknown(),
        scores: z.array(z.number()).nullable(),
      }),
    ),
    enhancer: z.array(
      z.object({
        query: z.string(),
        status: z.number(),
        body: z.unknown(),
        requested: z.boolean(),
        text: z.string(),
        outcome: z.enum(["applied", "skipped", "failed"]),
      }),
    ),
    embedding: z.array(
      z.object({
        token: z.string(),
        provider: z.string(),
        model: z.string(),
        mapping: z.unknown(),
        modelInfo: z.record(z.string(), z.unknown()),
        response: z.unknown(),
        requests: z.array(recordedRequest),
        vector: z.array(z.number()).nullable(),
      }),
    ),
    openRouterRequests: z.object({
      rerank: z.array(recordedRequest),
      enhance: z.array(recordedRequest),
    }),
    qdrantRequests: z.array(
      z.discriminatedUnion("call", [
        z.object({
          call: z.literal("semantic"),
          quantized: z.boolean(),
          exact: z.boolean(),
          limit: z.number(),
          request: z.object({ path: z.string(), body: z.unknown() }),
        }),
        z.object({
          call: z.enum(["exact", "partial"]),
          text: z.string(),
          request: z.object({ path: z.string(), body: z.unknown() }),
        }),
      ]),
    ),
  }),
);
