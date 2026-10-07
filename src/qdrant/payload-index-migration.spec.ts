import {
  collectionInfo,
  expectedPayloadSchema,
  fakeQdrant,
  keywordIndex,
  textIndex,
} from "../../test/support/fake-qdrant.js";
import type { ClassifierConfigMap } from "../classifier/classifier-config.js";
import {
  backfillNormalizedIdPayloads,
  migrateCollectionPayloadIndexes,
  migrateConfiguredCollections,
} from "./payload-index-migration.js";
import { getPayloadIndexSchema } from "./qdrant-schema.js";

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

function logged(): string {
  return vi
    .mocked(console.log)
    .mock.calls.map((args) => args.join(" "))
    .join("\n");
}

function withPayloadSchema(
  overrides: Record<string, ReturnType<typeof keywordIndex>>,
) {
  return fakeQdrant({
    info: collectionInfo({
      payloadSchema: { ...expectedPayloadSchema(), ...overrides },
    }),
  });
}

describe("migrateCollectionPayloadIndexes", () => {
  it("creates every missing index with the expected schema and deletes nothing", async () => {
    const client = fakeQdrant({
      info: collectionInfo({ payloadSchema: {} }),
    });

    expect(await migrateCollectionPayloadIndexes(client, "products")).toBe(
      true,
    );

    expect(client.deletePayloadIndex).not.toHaveBeenCalled();
    expect(client.createPayloadIndex.mock.calls).toEqual(
      (
        [
          "original_id",
          "original_id_normalized",
          "original_id_normalized_reversed",
          "class_name",
        ] as const
      ).map((field) => [
        "products",
        {
          field_name: field,
          field_schema: getPayloadIndexSchema(field),
          wait: true,
        },
      ]),
    );
  });

  it("leaves matching indexes untouched", async () => {
    const client = fakeQdrant();

    expect(await migrateCollectionPayloadIndexes(client, "products")).toBe(
      true,
    );

    expect(client.deletePayloadIndex).not.toHaveBeenCalled();
    expect(client.createPayloadIndex).not.toHaveBeenCalled();
  });

  it.each([
    ["original_id", textIndex(), { type: "keyword" }],
    ["class_name", keywordIndex(), getPayloadIndexSchema("class_name")],
    [
      "class_name",
      textIndex({ tokenizer: "prefix" }),
      getPayloadIndexSchema("class_name"),
    ],
    [
      "original_id_normalized",
      keywordIndex(),
      getPayloadIndexSchema("original_id_normalized"),
    ],
  ] as const)(
    "replaces a mismatched %s index with the expected schema",
    async (field, existing, expectedSchema) => {
      const client = withPayloadSchema({ [field]: existing });

      expect(await migrateCollectionPayloadIndexes(client, "products")).toBe(
        true,
      );

      expect(client.deletePayloadIndex.mock.calls).toEqual([
        ["products", field, { wait: true }],
      ]);
      expect(client.createPayloadIndex.mock.calls).toEqual([
        [
          "products",
          { field_name: field, field_schema: expectedSchema, wait: true },
        ],
      ]);
    },
  );

  it("restores the previous index when creating the replacement fails", async () => {
    const previous = textIndex();
    const client = withPayloadSchema({ original_id: previous });
    client.createPayloadIndex.mockRejectedValueOnce(new Error("timeout"));

    expect(await migrateCollectionPayloadIndexes(client, "products")).toBe(
      false,
    );

    expect(client.deletePayloadIndex).toHaveBeenCalledTimes(1);
    expect(client.createPayloadIndex.mock.calls).toEqual([
      [
        "products",
        {
          field_name: "original_id",
          field_schema: { type: "keyword" },
          wait: true,
        },
      ],
      [
        "products",
        {
          field_name: "original_id",
          field_schema: previous.params,
          wait: true,
        },
      ],
    ]);
    expect(logged()).toContain("  ! Rollback succeeded for 'original_id'");
  });

  it("restores from the data type when the previous index has no params", async () => {
    const client = withPayloadSchema({
      original_id: { data_type: "text", params: null, points: 1 },
    });
    client.createPayloadIndex.mockRejectedValueOnce(new Error("timeout"));

    expect(await migrateCollectionPayloadIndexes(client, "products")).toBe(
      false,
    );

    expect(client.createPayloadIndex.mock.calls[1]).toEqual([
      "products",
      { field_name: "original_id", field_schema: "text", wait: true },
    ]);
  });

  it("warns that the field has no index when the rollback also fails", async () => {
    const client = withPayloadSchema({ original_id: textIndex() });
    client.createPayloadIndex
      .mockRejectedValueOnce(new Error("timeout"))
      .mockRejectedValueOnce(new Error("rollback failed"));

    expect(await migrateCollectionPayloadIndexes(client, "products")).toBe(
      false,
    );

    expect(client.deletePayloadIndex).toHaveBeenCalledTimes(1);
    expect(client.createPayloadIndex).toHaveBeenCalledTimes(2);
    expect(logged()).toContain(
      "  WARNING: 'original_id' left without any index!",
    );
  });

  it("keeps the old index when deleting it fails", async () => {
    const client = withPayloadSchema({ original_id: textIndex() });
    client.deletePayloadIndex.mockRejectedValueOnce(new Error("locked"));

    expect(await migrateCollectionPayloadIndexes(client, "products")).toBe(
      false,
    );

    expect(client.createPayloadIndex).not.toHaveBeenCalled();
  });

  it("writes nothing when the collection cannot be read", async () => {
    const client = fakeQdrant();
    client.getCollection.mockRejectedValueOnce(new Error("not found"));

    expect(await migrateCollectionPayloadIndexes(client, "products")).toBe(
      false,
    );

    expect(client.scroll).not.toHaveBeenCalled();
    expect(client.createPayloadIndex).not.toHaveBeenCalled();
  });

  it("fails the collection but still reconciles indexes when the backfill fails", async () => {
    const client = fakeQdrant({ info: collectionInfo({ payloadSchema: {} }) });
    client.scroll.mockRejectedValueOnce(new Error("scroll down"));

    expect(await migrateCollectionPayloadIndexes(client, "products")).toBe(
      false,
    );

    expect(client.createPayloadIndex).toHaveBeenCalledTimes(4);
  });
});

describe("backfillNormalizedIdPayloads", () => {
  it("writes normalized and reversed IDs only for stale points", async () => {
    const client = fakeQdrant();
    client.scroll.mockResolvedValueOnce({
      points: [
        { id: "point-1", payload: { original_id: "03111000-2" } },
        {
          id: "point-2",
          payload: {
            original_id: "EC000123",
            original_id_normalized: "ec000123",
            original_id_normalized_reversed: "321000ce",
          },
        },
        { id: "point-3", payload: {} },
        { id: 4, payload: { original_id: 4300 } },
      ],
      next_page_offset: null,
    });

    expect(await backfillNormalizedIdPayloads(client, "products", 10)).toBe(
      true,
    );

    expect(client.scroll.mock.calls).toEqual([
      [
        "products",
        {
          offset: undefined,
          limit: 10,
          with_payload: [
            "original_id",
            "original_id_normalized",
            "original_id_normalized_reversed",
          ],
          with_vector: false,
        },
      ],
    ]);
    expect(client.batchUpdate.mock.calls).toEqual([
      [
        "products",
        {
          operations: [
            {
              set_payload: {
                payload: {
                  original_id_normalized: "3111002",
                  original_id_normalized_reversed: "2001113",
                },
                points: ["point-1"],
              },
            },
            {
              set_payload: {
                payload: {
                  original_id_normalized: "43",
                  original_id_normalized_reversed: "34",
                },
                points: [4],
              },
            },
          ],
          wait: true,
        },
      ],
    ]);
    expect(logged()).toContain(
      "  * Normalized ID payload backfill: scanned=4 updated=2 skipped=1 missing_original_id=1",
    );
  });

  it("follows scroll pages and writes in batches of the batch size", async () => {
    const client = fakeQdrant();
    client.scroll
      .mockResolvedValueOnce({
        points: [
          { id: 1, payload: { original_id: "A1" } },
          { id: 2, payload: { original_id: "A2" } },
        ],
        next_page_offset: 3,
      })
      .mockResolvedValueOnce({
        points: [{ id: 3, payload: { original_id: "A3" } }],
        next_page_offset: null,
      });

    expect(await backfillNormalizedIdPayloads(client, "products", 2)).toBe(
      true,
    );

    expect(
      client.scroll.mock.calls.map(([, request]) => request.offset),
    ).toEqual([undefined, 3]);
    expect(
      client.batchUpdate.mock.calls.map(([, { operations }]) =>
        operations.map((operation) => operation.set_payload.points),
      ),
    ).toEqual([[[1], [2]], [[3]]]);
  });

  it("flushes pending writes when scrolling fails mid-scan", async () => {
    const client = fakeQdrant();
    client.scroll
      .mockResolvedValueOnce({
        points: [{ id: "point-1", payload: { original_id: "03111000-2" } }],
        next_page_offset: "next-page",
      })
      .mockRejectedValueOnce(new Error("scroll down"));

    expect(await backfillNormalizedIdPayloads(client, "products", 10)).toBe(
      false,
    );

    expect(client.batchUpdate).toHaveBeenCalledTimes(1);
    expect(client.batchUpdate.mock.calls[0]?.[1].operations).toEqual([
      {
        set_payload: {
          payload: {
            original_id_normalized: "3111002",
            original_id_normalized_reversed: "2001113",
          },
          points: ["point-1"],
        },
      },
    ]);
    expect(logged()).toContain(
      "  ! Error scanning collection for normalized ID backfill: scroll down",
    );
  });

  it("fails without writing when the first scroll fails", async () => {
    const client = fakeQdrant();
    client.scroll.mockRejectedValueOnce(new Error("scroll down"));

    expect(await backfillNormalizedIdPayloads(client, "products", 10)).toBe(
      false,
    );

    expect(client.batchUpdate).not.toHaveBeenCalled();
  });

  it("keeps scanning but reports failure when a batch write fails", async () => {
    const client = fakeQdrant();
    client.scroll
      .mockResolvedValueOnce({
        points: [{ id: 1, payload: { original_id: "A1" } }],
        next_page_offset: 2,
      })
      .mockResolvedValueOnce({
        points: [{ id: 2, payload: { original_id: "A2" } }],
        next_page_offset: null,
      });
    client.batchUpdate.mockRejectedValueOnce(new Error("write failed"));

    expect(await backfillNormalizedIdPayloads(client, "products", 1)).toBe(
      false,
    );

    expect(client.batchUpdate).toHaveBeenCalledTimes(2);
  });

  it("backfills the other points but fails when an original_id cannot match Python", async () => {
    const client = fakeQdrant();
    client.scroll.mockResolvedValueOnce({
      points: [
        { id: 1, payload: { original_id: ["A", 1] } },
        { id: 2, payload: { original_id: 0 } },
        { id: 3, payload: { original_id: 101.21 } },
        { id: 4, payload: { original_id: true } },
      ],
      next_page_offset: null,
    });

    expect(await backfillNormalizedIdPayloads(client, "products", 10)).toBe(
      false,
    );

    expect(client.batchUpdate.mock.calls).toEqual([
      [
        "products",
        {
          operations: [
            {
              set_payload: {
                payload: {
                  original_id_normalized: "10121",
                  original_id_normalized_reversed: "12101",
                },
                points: [3],
              },
            },
            {
              set_payload: {
                payload: {
                  original_id_normalized: "true",
                  original_id_normalized_reversed: "eurt",
                },
                points: [4],
              },
            },
          ],
          wait: true,
        },
      ],
    ]);
    expect(logged()).toContain("Point 1 has an unsupported original_id");
    expect(logged()).toContain("Point 2 has an unsupported original_id: 0");
  });
});

describe("migrateConfiguredCollections", () => {
  const config: ClassifierConfigMap = {
    A: {
      embedDims: 128,
      versions: {
        v1: { collectionName: "collection_b" },
        v2: { collectionName: "collection_a" },
      },
    },
    B: {
      embedDims: 128,
      versions: {
        v1: { collectionName: "collection_b" },
        v2: { collectionName: "collection_c" },
      },
    },
  };

  it("processes every configured collection once in sorted order", async () => {
    const client = fakeQdrant();

    expect(await migrateConfiguredCollections(client, config)).toEqual({
      successCount: 3,
      errorCount: 0,
    });
    expect(client.getCollection.mock.calls).toEqual([
      ["collection_a"],
      ["collection_b"],
      ["collection_c"],
    ]);
  });

  it("counts failed collections and processes only the requested ones", async () => {
    const client = fakeQdrant();
    client.getCollection.mockRejectedValueOnce(new Error("missing"));

    expect(
      await migrateConfiguredCollections(
        client,
        config,
        new Set(["collection_c", "collection_a"]),
      ),
    ).toEqual({ successCount: 1, errorCount: 1 });
    expect(client.getCollection.mock.calls).toEqual([
      ["collection_a"],
      ["collection_c"],
    ]);
  });
});
