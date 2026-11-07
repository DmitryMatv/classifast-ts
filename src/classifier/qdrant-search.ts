import type { QdrantClient, Schemas } from "@qdrant/js-client-rest";
import {
  exactIdLookupKeys,
  ORIGINAL_ID_FIELD,
  ORIGINAL_ID_NORMALIZED_FIELD,
  ORIGINAL_ID_NORMALIZED_KEY_FIELD,
  ORIGINAL_ID_NORMALIZED_REVERSED_FIELD,
  reverseNormalizedId,
} from "../qdrant/id-lookup.js";
import {
  EXACT_ID_PAGE_SIZE,
  exactIdMatches,
  PARTIAL_ID_LIMIT,
  PARTIAL_ID_PAGE_SIZE,
  PARTIAL_ID_SCORE,
  partialIdMatches,
  pointResult,
  type ClassificationResult,
  type ExactIdMatches,
  type StoredPoint,
} from "./classification.js";

export type QdrantSearchClient = Pick<
  QdrantClient,
  "query" | "scroll" | "retrieve"
>;

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
    query: { nearest: [...vector] },
    limit,
    with_payload: true,
    with_vector: false,
    params,
  });
  return points.map((point) => pointResult(point, point.score));
}

/** Looks up codes whose normalized ID equals the normalized query. */
export async function exactIdSearch(
  client: QdrantSearchClient,
  collectionName: string,
  query: string,
): Promise<ExactIdMatches> {
  const keys = exactIdLookupKeys(query);
  if (keys.length === 0) return { exact: [], sameNode: [] };
  // Page through the whole key bucket: an exact match can sit past the first
  // page when several codes differ only by padding zeros.
  const points = await scrollAll(client, collectionName, {
    filter: {
      must: [{ key: ORIGINAL_ID_NORMALIZED_KEY_FIELD, match: { any: keys } }],
    },
    limit: EXACT_ID_PAGE_SIZE,
    with_payload: true,
    with_vector: false,
  });
  return exactIdMatches(points, query);
}

/** Scrolls every page of a filter, in Qdrant's point-ID order. */
async function scrollAll(
  client: QdrantSearchClient,
  collectionName: string,
  request: Schemas["ScrollRequest"],
): Promise<StoredPoint[]> {
  const points: StoredPoint[] = [];
  let offset: Schemas["ExtendedPointId"] | undefined;
  do {
    const page = await client.scroll(collectionName, { ...request, offset });
    points.push(...page.points);
    offset = scrollOffset(page.next_page_offset);
  } while (offset !== undefined);
  return points;
}

function scrollOffset(
  offset: Schemas["ScrollResult"]["next_page_offset"],
): Schemas["ExtendedPointId"] | undefined {
  if (offset === null || offset === undefined) return undefined;
  if (typeof offset === "object") {
    throw new Error(`unexpected scroll offset ${JSON.stringify(offset)}`);
  }
  return offset;
}

/**
 * Looks up codes whose normalized ID starts or ends with the query. A short
 * prefix matches thousands of codes (`503` matches about 13,000 UNSPSC
 * codes), and scroll pages follow point IDs, not depth. So it ranks every
 * match from its ID fields alone, then fetches whole payloads for the best
 * `PARTIAL_ID_LIMIT`. Python ranked only the first 100 points scrolled.
 */
export async function partialIdSearch(
  client: QdrantSearchClient,
  collectionName: string,
  normalizedQuery: string,
): Promise<ClassificationResult[]> {
  const candidates = await scrollAll(client, collectionName, {
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
    limit: PARTIAL_ID_PAGE_SIZE,
    with_payload: [ORIGINAL_ID_FIELD, ORIGINAL_ID_NORMALIZED_FIELD],
    with_vector: false,
  });
  const best = partialIdMatches(candidates, normalizedQuery).slice(
    0,
    PARTIAL_ID_LIMIT,
  );
  if (best.length === 0) return [];
  const records = await client.retrieve(collectionName, {
    ids: best.map((match) => match.id),
    with_payload: true,
    with_vector: false,
  });
  const byId = new Map(records.map((record) => [record.id, record]));
  // A point deleted between the two requests drops out.
  return best.flatMap(({ id }) => {
    const record = byId.get(id);
    return record ? [pointResult(record, PARTIAL_ID_SCORE)] : [];
  });
}
