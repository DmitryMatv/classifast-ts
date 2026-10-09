import type { Schemas } from "@qdrant/js-client-rest";
import { pyFloat, pyRound } from "../python/numbers.js";
import { codePointLength } from "../python/str.js";
import {
  ORIGINAL_ID_FIELD,
  ORIGINAL_ID_NORMALIZED_FIELD,
  normalizeOriginalIdForLookup,
  originalIdLookupText,
} from "../qdrant/id-lookup.js";

export type PointId = Schemas["ExtendedPointId"];
export type Payload = Readonly<Record<string, unknown>>;

/**
 * One match. `score` is what the page shows: 1.0 for an exact ID, 0.9 for a
 * partial ID, the rerank score when reranking succeeded, and the semantic
 * similarity otherwise.
 */
export interface ClassificationResult {
  readonly id: PointId;
  readonly score: number;
  readonly payload: Payload;
  /** Absent when the reranker failed and the semantic score stands. */
  readonly rerankRelevanceScore?: number;
}

export type RerankedResult = ClassificationResult & {
  readonly rerankRelevanceScore: number;
};

export interface StoredPoint {
  readonly id: PointId;
  readonly payload?: Readonly<Record<string, unknown>> | null;
}

export type EnhancementStatus = "applied" | "skipped" | "failed";

export const EXACT_ID_SCORE = 1.0;
export const PARTIAL_ID_SCORE = 0.9;
export const EXACT_ID_LIMIT = 3;
export const PARTIAL_ID_LIMIT = 100;
export const MIN_PARTIAL_ID_LENGTH = 3;
export const DEFAULT_RERANK_CANDIDATE_LIMIT = 100;
export const MIN_RERANK_BUDGET_SECONDS = 2.0;

export class ClassificationError extends Error {
  constructor(
    readonly status: 400 | 404 | 500 | 503,
    readonly detail: string,
  ) {
    super(detail);
    this.name = "ClassificationError";
  }
}

export function pointResult(
  point: StoredPoint,
  score: number,
): ClassificationResult {
  return { id: point.id, score, payload: point.payload ?? {} };
}

export function sortByScoreDesc(
  results: readonly ClassificationResult[],
  topK: number,
): ClassificationResult[] {
  return results.toSorted((a, b) => b.score - a.score).slice(0, topK);
}

export function withRerankScore(
  results: readonly ClassificationResult[],
  score: number,
): RerankedResult[] {
  return results.map((result) => ({ ...result, rerankRelevanceScore: score }));
}

export function exactIdShortcutResults(
  exactResults: readonly ClassificationResult[],
  topK: number,
): ClassificationResult[] {
  return withRerankScore(sortByScoreDesc(exactResults, topK), 0.0);
}

export function semanticRetrieveLimit(
  topK: number,
  rerankingEnabled: boolean,
): number {
  return rerankingEnabled
    ? Math.max(topK, DEFAULT_RERANK_CANDIDATE_LIMIT)
    : topK;
}

export function excludeIdMatches(
  semanticResults: readonly ClassificationResult[],
  idMatches: readonly ClassificationResult[],
): ClassificationResult[] {
  const matchIds = new Set(idMatches.map((result) => result.id));
  return semanticResults.filter((result) => !matchIds.has(result.id));
}

export function mergeClassificationResults(
  idMatches: readonly ClassificationResult[],
  semanticResults: readonly ClassificationResult[],
  topK: number,
): ClassificationResult[] {
  return sortByScoreDesc([...idMatches, ...semanticResults], topK);
}

/** Rounds like Python's round(score, 4) and sorts stably by that score. */
export function applyRerankScores(
  candidates: readonly ClassificationResult[],
  scores: readonly number[],
): RerankedResult[] {
  if (scores.length !== candidates.length) {
    throw new Error("Reranker score count does not match candidate count");
  }
  return candidates
    .map((candidate, index) => ({
      ...candidate,
      rerankRelevanceScore: pyRound(scores[index]!, 4),
    }))
    .toSorted((a, b) => b.rerankRelevanceScore - a.rerankRelevanceScore);
}

export function useRerankScores(
  results: readonly ClassificationResult[],
): ClassificationResult[] {
  return results.map((result) =>
    result.rerankRelevanceScore === undefined
      ? result
      : { ...result, score: result.rerankRelevanceScore },
  );
}

function pythonStr(value: unknown): string | undefined {
  if (value === null) return "None";
  if (typeof value === "boolean") return value ? "True" : "False";
  if (typeof value === "bigint") return String(value);
  return originalIdLookupText(value);
}

function storedNormalizedId(payload: Payload): string | undefined {
  const raw = payload[ORIGINAL_ID_NORMALIZED_FIELD];
  if (raw !== undefined && raw !== null) return pythonStr(raw);
  const originalId = pythonStr(
    Object.hasOwn(payload, ORIGINAL_ID_FIELD) ? payload[ORIGINAL_ID_FIELD] : "",
  );
  return originalId === undefined
    ? undefined
    : normalizeOriginalIdForLookup(originalId);
}

/** Keeps points whose normalized ID starts or ends with the query, once each. */
export function partialIdMatches(
  points: readonly StoredPoint[],
  normalizedQuery: string,
): ClassificationResult[] {
  const seen = new Set<PointId>();
  const matches: ClassificationResult[] = [];
  for (const point of points) {
    if (!point.payload || Object.keys(point.payload).length === 0) continue;
    if (seen.has(point.id)) continue;
    const normalizedId = storedNormalizedId(point.payload);
    if (
      normalizedId !== undefined &&
      (normalizedId.startsWith(normalizedQuery) ||
        normalizedId.endsWith(normalizedQuery))
    ) {
      matches.push(pointResult(point, PARTIAL_ID_SCORE));
      seen.add(point.id);
    }
  }
  return matches;
}

export function isPartialIdQuery(normalizedIdQuery: string): boolean {
  return codePointLength(normalizedIdQuery) >= MIN_PARTIAL_ID_LENGTH;
}

function embeddingValue(value: unknown): number {
  const number =
    typeof value === "number"
      ? value
      : typeof value === "boolean"
        ? Number(value)
        : typeof value === "string"
          ? pyFloat(value)
          : undefined;
  if (number === undefined) {
    throw new Error("Embedding response contains non-numeric values");
  }
  return Math.fround(number);
}

/**
 * Python reads the provider's embeddings into a float32 NumPy array and then
 * flattens a single pooled vector, so every value is rounded to float32.
 */
export function coerceEmbedding(response: unknown): number[] {
  if (!Array.isArray(response)) {
    throw new Error("Embedding response is not a list");
  }
  let vector: readonly unknown[] = response;
  if (vector.length === 1 && Array.isArray(vector[0])) {
    vector = vector[0] as unknown[];
  } else if (vector.length > 0 && Array.isArray(vector[0])) {
    throw new Error(
      "Embedding response is token-level; expected a pooled sentence vector",
    );
  }
  if (vector.length === 0) throw new Error("Empty embedding generated");
  return vector.map(embeddingValue);
}
