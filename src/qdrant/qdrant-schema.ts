import { isDeepStrictEqual } from "node:util";
import type { Schemas } from "@qdrant/js-client-rest";
import type { CollectionLayout } from "../classifier/classifier-config.js";
import {
  ORIGINAL_ID_FIELD,
  ORIGINAL_ID_NORMALIZED_FIELD,
  ORIGINAL_ID_NORMALIZED_REVERSED_FIELD,
} from "./id-lookup.js";

export const PAYLOAD_INDEX_FIELDS = [
  ORIGINAL_ID_FIELD,
  ORIGINAL_ID_NORMALIZED_FIELD,
  ORIGINAL_ID_NORMALIZED_REVERSED_FIELD,
  "class_name",
] as const;

export type PayloadIndexField = (typeof PAYLOAD_INDEX_FIELDS)[number];
export type PayloadIndexInfo = Schemas["PayloadIndexInfo"];
type IndexParams = Schemas["KeywordIndexParams"] | Schemas["TextIndexParams"];

export interface CollectionSchemaInfo {
  readonly config: {
    readonly params: { readonly vectors?: Schemas["VectorsConfig"] };
    readonly quantization_config?: unknown;
  };
  readonly payload_schema: Readonly<
    Record<string, PayloadIndexInfo | undefined>
  >;
}

export interface QdrantSchemaReader {
  getCollections(): Promise<{
    readonly collections: readonly { readonly name: string }[];
  }>;
  getCollection(collectionName: string): Promise<CollectionSchemaInfo>;
}

// Values Qdrant assumes for unset parameters. Only these keys take part in
// the comparison, so parameters Qdrant adds later never force a replacement.
const KEYWORD_INDEX_DEFAULTS = {
  type: "keyword",
  is_tenant: false,
  on_disk: false,
  enable_hnsw: true,
};

const TEXT_INDEX_DEFAULTS = {
  type: "text",
  tokenizer: "word",
  min_token_len: 1,
  max_token_len: 30,
  lowercase: true,
  ascii_folding: false,
  phrase_matching: false,
  stopwords: null,
  on_disk: false,
  stemmer: null,
  enable_hnsw: true,
};

const NORMALIZED_ID_TEXT_INDEX: Schemas["TextIndexParams"] = {
  type: "text",
  tokenizer: "prefix",
  min_token_len: 1,
  max_token_len: 64,
  lowercase: true,
};

interface IndexSpec {
  readonly params: IndexParams;
  readonly defaults: Readonly<Record<string, unknown>>;
}

const INDEX_SPECS: Readonly<Record<PayloadIndexField, IndexSpec>> = {
  [ORIGINAL_ID_FIELD]: {
    params: { type: "keyword" },
    defaults: KEYWORD_INDEX_DEFAULTS,
  },
  [ORIGINAL_ID_NORMALIZED_FIELD]: {
    params: NORMALIZED_ID_TEXT_INDEX,
    defaults: TEXT_INDEX_DEFAULTS,
  },
  [ORIGINAL_ID_NORMALIZED_REVERSED_FIELD]: {
    params: NORMALIZED_ID_TEXT_INDEX,
    defaults: TEXT_INDEX_DEFAULTS,
  },
  class_name: {
    params: {
      type: "text",
      tokenizer: "word",
      min_token_len: 1,
      max_token_len: 30,
      lowercase: true,
    },
    defaults: TEXT_INDEX_DEFAULTS,
  },
};

export function getPayloadIndexSchema(field: PayloadIndexField): IndexParams {
  return { ...INDEX_SPECS[field].params };
}

function withDefaults(
  defaults: Readonly<Record<string, unknown>>,
  params: Readonly<Record<string, unknown>> | null | undefined,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(defaults).map(([key, fallback]) => [
      key,
      params?.[key] ?? fallback,
    ]),
  );
}

export function isExpectedPayloadIndex(
  field: PayloadIndexField,
  indexInfo: PayloadIndexInfo,
): boolean {
  const spec = INDEX_SPECS[field];
  if (indexInfo.data_type !== spec.params.type) return false;
  const params: Readonly<Record<string, unknown>> | null | undefined =
    indexInfo.params;
  if (params && params.type !== spec.params.type) return false;
  return isDeepStrictEqual(
    withDefaults(spec.defaults, params),
    withDefaults(spec.defaults, spec.params),
  );
}

export type QdrantValidationIssueCode =
  | "invalid_config"
  | "collection_list_failed"
  | "missing_collection"
  | "collection_unavailable"
  | "named_vectors_unsupported"
  | "vector_size_mismatch"
  | "missing_payload_index"
  | "payload_index_mismatch";

export interface QdrantValidationIssue {
  readonly collectionName: string;
  readonly code: QdrantValidationIssueCode;
  readonly detail: string;
}

export function formatValidationIssue(issue: QdrantValidationIssue): string {
  return `${issue.collectionName}: ${issue.detail} [${issue.code}]`;
}

export interface QdrantValidationReport {
  // Collection name to whether it has quantization, for valid collections.
  readonly quantizationCache: ReadonlyMap<string, boolean>;
  readonly issues: readonly QdrantValidationIssue[];
}

interface CollectionRequirement {
  readonly collectionName: string;
  readonly embedDims: number | undefined;
}

function buildCollectionRequirements(
  config: CollectionLayout,
  collectionNames: ReadonlySet<string> | undefined,
): { requirements: CollectionRequirement[]; issues: QdrantValidationIssue[] } {
  const dimensionsByCollection = new Map<string, Set<number>>();
  for (const classifier of Object.values(config)) {
    for (const { collectionName } of Object.values(classifier.versions)) {
      if (collectionNames && !collectionNames.has(collectionName)) continue;
      const dimensions =
        dimensionsByCollection.get(collectionName) ?? new Set<number>();
      dimensions.add(classifier.embedDims);
      dimensionsByCollection.set(collectionName, dimensions);
    }
  }

  const requirements: CollectionRequirement[] = [];
  const issues: QdrantValidationIssue[] = [];
  for (const [collectionName, dimensions] of dimensionsByCollection) {
    const [embedDims] = dimensions;
    if (dimensions.size === 1) {
      requirements.push({ collectionName, embedDims });
      continue;
    }
    requirements.push({ collectionName, embedDims: undefined });
    issues.push({
      collectionName,
      code: "invalid_config",
      detail: `conflicting embedding dimensions [${[...dimensions].sort((a, b) => a - b).join(", ")}]`,
    });
  }
  return { requirements, issues };
}

function validateCollectionInfo(
  requirement: CollectionRequirement,
  info: CollectionSchemaInfo,
): QdrantValidationIssue[] {
  const { collectionName, embedDims } = requirement;
  const issues: QdrantValidationIssue[] = [];
  const vectors = info.config.params.vectors;
  const size = vectors?.size;

  if (vectors !== undefined && typeof size !== "number") {
    issues.push({
      collectionName,
      code: "named_vectors_unsupported",
      detail:
        "uses named vectors, but classifier queries expect one unnamed vector",
    });
  } else if (embedDims !== undefined && size !== embedDims) {
    issues.push({
      collectionName,
      code: "vector_size_mismatch",
      detail: `vector size is ${typeof size === "number" ? size : "None"}; expected ${embedDims}`,
    });
  }

  for (const field of PAYLOAD_INDEX_FIELDS) {
    const indexInfo = info.payload_schema[field];
    if (indexInfo === undefined) {
      issues.push({
        collectionName,
        code: "missing_payload_index",
        detail: `missing payload index '${field}'`,
      });
    } else if (!isExpectedPayloadIndex(field, indexInfo)) {
      issues.push({
        collectionName,
        code: "payload_index_mismatch",
        detail: `payload index '${field}' does not match the required schema`,
      });
    }
  }
  return issues;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function inspectConfiguredCollections(
  client: QdrantSchemaReader,
  config: CollectionLayout,
  collectionNames?: ReadonlySet<string>,
): Promise<QdrantValidationReport> {
  const { requirements, issues } = buildCollectionRequirements(
    config,
    collectionNames,
  );
  const quantizationCache = new Map<string, boolean>();

  let existingNames: Set<string>;
  try {
    const { collections } = await client.getCollections();
    existingNames = new Set(collections.map((collection) => collection.name));
  } catch (error) {
    issues.push({
      collectionName: "<qdrant>",
      code: "collection_list_failed",
      detail: `could not list collections: ${errorMessage(error)}`,
    });
    return { quantizationCache, issues };
  }

  for (const requirement of requirements) {
    const { collectionName } = requirement;
    if (!existingNames.has(collectionName)) {
      issues.push({
        collectionName,
        code: "missing_collection",
        detail: "configured collection does not exist",
      });
      continue;
    }

    let info: CollectionSchemaInfo;
    try {
      info = await client.getCollection(collectionName);
    } catch (error) {
      issues.push({
        collectionName,
        code: "collection_unavailable",
        detail: `could not inspect collection: ${errorMessage(error)}`,
      });
      continue;
    }

    const collectionIssues = validateCollectionInfo(requirement, info);
    issues.push(...collectionIssues);
    if (collectionIssues.length === 0 && requirement.embedDims !== undefined) {
      quantizationCache.set(
        collectionName,
        info.config.quantization_config != null,
      );
    }
  }
  return { quantizationCache, issues };
}
