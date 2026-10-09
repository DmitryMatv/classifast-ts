import type { QdrantClient, Schemas } from "@qdrant/js-client-rest";
import {
  ORIGINAL_ID_FIELD,
  ORIGINAL_ID_NORMALIZED_FIELD,
  ORIGINAL_ID_NORMALIZED_REVERSED_FIELD,
  reverseNormalizedId,
} from "../qdrant/id-lookup.js";
import {
  EXACT_ID_LIMIT,
  EXACT_ID_SCORE,
  PARTIAL_ID_LIMIT,
  partialIdMatches,
  pointResult,
  type ClassificationResult,
} from "./classification.js";
import { sanitizeSearchText } from "./query-text.js";

export type QdrantSearchClient = Pick<QdrantClient, "query" | "scroll">;

export interface SemanticSearchOptions {
  readonly limit: number;
  readonly quantized: boolean;
  readonly exact: boolean;
}

export async function semanticSearch(
  client: QdrantSearchClient,
  collectionName: string,
  vector: readonly number[],
  { limit, quantized, exact }: SemanticSearchOptions,
): Promise<ClassificationResult[]> {
  const params: Schemas["SearchParams"] = { hnsw_ef: 256, exact };
  if (quantized) {
    params.quantization = { ignore: false, rescore: true, oversampling: 3.0 };
  }
  const { points } = await client.query(collectionName, {
    query: [...vector],
    limit,
    with_payload: true,
    with_vector: false,
    params,
  });
  return points.map((point) => pointResult(point, point.score));
}

export async function exactIdSearch(
  client: QdrantSearchClient,
  collectionName: string,
  query: string,
): Promise<ClassificationResult[]> {
  const searchText = sanitizeSearchText(query);
  const value = searchText.kind === "valid" ? searchText.query : "";
  const { points } = await client.scroll(collectionName, {
    filter: { must: [{ key: ORIGINAL_ID_FIELD, match: { value } }] },
    limit: EXACT_ID_LIMIT,
    with_payload: true,
    with_vector: false,
  });
  return points.map((point) => pointResult(point, EXACT_ID_SCORE));
}

export async function partialIdSearch(
  client: QdrantSearchClient,
  collectionName: string,
  normalizedQuery: string,
): Promise<ClassificationResult[]> {
  const { points } = await client.scroll(collectionName, {
    filter: {
      should: [
        {
          key: ORIGINAL_ID_NORMALIZED_FIELD,
          match: { text: normalizedQuery },
        },
        {
          key: ORIGINAL_ID_NORMALIZED_REVERSED_FIELD,
          match: { text: reverseNormalizedId(normalizedQuery) },
        },
      ],
    },
    limit: PARTIAL_ID_LIMIT,
    with_payload: true,
    with_vector: false,
  });
  return partialIdMatches(points, normalizedQuery);
}
