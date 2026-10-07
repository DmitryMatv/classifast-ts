import type { Schemas } from "@qdrant/js-client-rest";
import { vi } from "vitest";
import type { QdrantIndexClient } from "../../src/qdrant/payload-index-migration.js";
import {
  getPayloadIndexSchema,
  type CollectionSchemaInfo,
  type PayloadIndexInfo,
} from "../../src/qdrant/qdrant-schema.js";

export function keywordIndex(
  params: Partial<Schemas["KeywordIndexParams"]> = {},
): PayloadIndexInfo {
  return {
    data_type: "keyword",
    params: { type: "keyword", ...params },
    points: 10,
  };
}

export function textIndex(
  params: Partial<Schemas["TextIndexParams"]> = {},
): PayloadIndexInfo {
  return {
    data_type: "text",
    params: {
      type: "text",
      tokenizer: "word",
      min_token_len: 1,
      max_token_len: 30,
      lowercase: true,
      ...params,
    },
    points: 10,
  };
}

export function normalizedIdIndex(): PayloadIndexInfo {
  return {
    data_type: "text",
    params: getPayloadIndexSchema("original_id_normalized"),
    points: 10,
  };
}

export function expectedPayloadSchema(): Record<string, PayloadIndexInfo> {
  return {
    original_id: keywordIndex(),
    original_id_normalized: normalizedIdIndex(),
    original_id_normalized_reversed: normalizedIdIndex(),
    class_name: textIndex(),
  };
}

export function collectionInfo({
  vectors = { size: 128, distance: "Cosine" },
  payloadSchema = expectedPayloadSchema(),
  quantized = false,
}: {
  vectors?: Schemas["VectorsConfig"];
  payloadSchema?: Record<string, PayloadIndexInfo>;
  quantized?: boolean;
} = {}): CollectionSchemaInfo {
  return {
    config: {
      params: { vectors },
      quantization_config: quantized ? { scalar: { type: "int8" } } : null,
    },
    payload_schema: payloadSchema,
  };
}

export function fakeQdrant({
  names = ["products"],
  info = collectionInfo(),
}: { names?: string[]; info?: CollectionSchemaInfo } = {}) {
  return {
    getCollections: vi.fn<QdrantIndexClient["getCollections"]>(async () => ({
      collections: names.map((name) => ({ name })),
    })),
    getCollection: vi.fn<QdrantIndexClient["getCollection"]>(async () => info),
    createPayloadIndex: vi.fn<QdrantIndexClient["createPayloadIndex"]>(
      async () => ({}),
    ),
    deletePayloadIndex: vi.fn<QdrantIndexClient["deletePayloadIndex"]>(
      async () => ({}),
    ),
    scroll: vi.fn<QdrantIndexClient["scroll"]>(async () => ({
      points: [],
      next_page_offset: null,
    })),
    batchUpdate: vi.fn<QdrantIndexClient["batchUpdate"]>(async () => []),
  } satisfies QdrantIndexClient;
}

export type FakeQdrant = ReturnType<typeof fakeQdrant>;

export function writeCalls(client: FakeQdrant): number {
  return (
    client.createPayloadIndex.mock.calls.length +
    client.deletePayloadIndex.mock.calls.length +
    client.batchUpdate.mock.calls.length
  );
}
