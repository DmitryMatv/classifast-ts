import {
  collectionInfo,
  expectedPayloadSchema,
  fakeQdrant,
  keywordIndex,
  textIndex,
  writeCalls,
} from "../../test/support/fake-qdrant.js";
import type { ClassifierConfigMap } from "../classifier/classifier-config.js";
import {
  formatValidationIssue,
  getPayloadIndexSchema,
  inspectConfiguredCollections,
  isExpectedPayloadIndex,
} from "./qdrant-schema.js";

function testConfig(collectionName = "products", dims = 128) {
  return {
    TEST: { embedDims: dims, versions: { v1: { collectionName } } },
  } satisfies ClassifierConfigMap;
}

describe("payload index contract", () => {
  it("indexes original_id as a keyword for exact and partial lookup", () => {
    expect(getPayloadIndexSchema("original_id")).toEqual({ type: "keyword" });
  });

  it.each([
    "original_id_normalized",
    "original_id_normalized_reversed",
  ] as const)(
    "indexes %s as lowercase prefix text up to 64 characters",
    (field) => {
      expect(getPayloadIndexSchema(field)).toEqual({
        type: "text",
        tokenizer: "prefix",
        min_token_len: 1,
        max_token_len: 64,
        lowercase: true,
      });
    },
  );

  it("indexes class_name as lowercase word text up to 30 characters", () => {
    expect(getPayloadIndexSchema("class_name")).toEqual({
      type: "text",
      tokenizer: "word",
      min_token_len: 1,
      max_token_len: 30,
      lowercase: true,
    });
  });

  it("treats parameters Qdrant reports at their default values as matching", () => {
    expect(
      isExpectedPayloadIndex(
        "class_name",
        textIndex({
          ascii_folding: false,
          phrase_matching: false,
          on_disk: false,
          enable_hnsw: true,
          stopwords: null,
        }),
      ),
    ).toBe(true);
    expect(
      isExpectedPayloadIndex("original_id", {
        data_type: "keyword",
        params: null,
        points: 1,
      }),
    ).toBe(true);
  });

  it("ignores parameters outside the compared set", () => {
    expect(
      isExpectedPayloadIndex("original_id", keywordIndex({ prefix: true })),
    ).toBe(true);
  });

  it("rejects params of another index type under the expected data type", () => {
    expect(
      isExpectedPayloadIndex("original_id", {
        data_type: "keyword",
        params: { type: "text" },
        points: 1,
      }),
    ).toBe(false);
  });
});

describe("inspectConfiguredCollections", () => {
  it("reports a valid collection with its quantization and writes nothing", async () => {
    const client = fakeQdrant({ info: collectionInfo({ quantized: true }) });

    const report = await inspectConfiguredCollections(client, testConfig());

    expect(report.issues).toEqual([]);
    expect(report.quantizationCache).toEqual(new Map([["products", true]]));
    expect(writeCalls(client)).toBe(0);
    expect(client.scroll).not.toHaveBeenCalled();
  });

  it("reports a missing collection", async () => {
    const client = fakeQdrant({ names: [] });

    const report = await inspectConfiguredCollections(client, testConfig());

    expect(report.issues).toEqual([
      {
        collectionName: "products",
        code: "missing_collection",
        detail: "configured collection does not exist",
      },
    ]);
    expect(client.getCollection).not.toHaveBeenCalled();
  });

  it("reports an unavailable collection", async () => {
    const client = fakeQdrant();
    client.getCollection.mockRejectedValueOnce(new Error("down"));

    const report = await inspectConfiguredCollections(client, testConfig());

    expect(report.issues.map(formatValidationIssue)).toEqual([
      "products: could not inspect collection: down [collection_unavailable]",
    ]);
  });

  it("stops with one issue when collections cannot be listed", async () => {
    const client = fakeQdrant();
    client.getCollections.mockRejectedValueOnce(new Error("refused"));

    const report = await inspectConfiguredCollections(client, testConfig());

    expect(report.issues.map(formatValidationIssue)).toEqual([
      "<qdrant>: could not list collections: refused [collection_list_failed]",
    ]);
    expect(client.getCollection).not.toHaveBeenCalled();
  });

  it("reports every missing and mismatched index", async () => {
    const payloadSchema = expectedPayloadSchema();
    delete payloadSchema.original_id_normalized;
    payloadSchema.class_name = keywordIndex();
    const client = fakeQdrant({ info: collectionInfo({ payloadSchema }) });

    const report = await inspectConfiguredCollections(client, testConfig());

    expect(report.issues.map(formatValidationIssue)).toEqual([
      "products: missing payload index 'original_id_normalized' [missing_payload_index]",
      "products: payload index 'class_name' does not match the required schema [payload_index_mismatch]",
    ]);
    expect(report.quantizationCache.size).toBe(0);
  });

  it("rejects a class_name text index with the wrong tokenizer", async () => {
    const payloadSchema = expectedPayloadSchema();
    payloadSchema.class_name = textIndex({ tokenizer: "prefix" });
    const client = fakeQdrant({ info: collectionInfo({ payloadSchema }) });

    const report = await inspectConfiguredCollections(client, testConfig());

    expect(report.issues.map((issue) => issue.code)).toEqual([
      "payload_index_mismatch",
    ]);
  });

  it("rejects a keyword index with a non-default parameter", async () => {
    const payloadSchema = expectedPayloadSchema();
    payloadSchema.original_id = keywordIndex({ is_tenant: true });
    const client = fakeQdrant({ info: collectionInfo({ payloadSchema }) });

    const report = await inspectConfiguredCollections(client, testConfig());

    expect(report.issues.map((issue) => issue.code)).toEqual([
      "payload_index_mismatch",
    ]);
  });

  it("reports a vector size that differs from the configured dimension", async () => {
    const client = fakeQdrant({
      info: collectionInfo({ vectors: { size: 64, distance: "Cosine" } }),
    });

    const report = await inspectConfiguredCollections(client, testConfig());

    expect(report.issues.map(formatValidationIssue)).toEqual([
      "products: vector size is 64; expected 128 [vector_size_mismatch]",
    ]);
  });

  it("rejects named vectors", async () => {
    const client = fakeQdrant({
      info: collectionInfo({
        vectors: { default: { size: 128, distance: "Cosine" } },
      }),
    });

    const report = await inspectConfiguredCollections(client, testConfig());

    expect(report.issues.map((issue) => issue.code)).toEqual([
      "named_vectors_unsupported",
    ]);
  });

  it("still inspects a collection whose configured dimensions conflict", async () => {
    const config: ClassifierConfigMap = {
      A: { embedDims: 128, versions: { v1: { collectionName: "products" } } },
      B: { embedDims: 256, versions: { v2: { collectionName: "products" } } },
      C: { embedDims: 128, versions: { v1: { collectionName: "other" } } },
    };
    const productsSchema = expectedPayloadSchema();
    delete productsSchema.original_id_normalized;
    const client = fakeQdrant({ names: ["products", "other"] });
    client.getCollection
      .mockResolvedValueOnce(collectionInfo({ payloadSchema: productsSchema }))
      .mockResolvedValueOnce(collectionInfo());

    const report = await inspectConfiguredCollections(client, config);

    expect(report.issues.map(formatValidationIssue)).toEqual([
      "products: conflicting embedding dimensions [128, 256] [invalid_config]",
      "products: missing payload index 'original_id_normalized' [missing_payload_index]",
    ]);
    expect(client.getCollection.mock.calls).toEqual([["products"], ["other"]]);
    expect(report.quantizationCache).toEqual(new Map([["other", false]]));
  });

  it("inspects only the requested collections", async () => {
    const config: ClassifierConfigMap = {
      A: { embedDims: 128, versions: { v1: { collectionName: "products" } } },
      B: { embedDims: 128, versions: { v1: { collectionName: "other" } } },
    };
    const client = fakeQdrant({ names: ["products"] });

    const report = await inspectConfiguredCollections(
      client,
      config,
      new Set(["products"]),
    );

    expect(report.issues).toEqual([]);
    expect(client.getCollection.mock.calls).toEqual([["products"]]);
  });
});
