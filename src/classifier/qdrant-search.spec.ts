import { classificationGolden as golden } from "../../test/support/classification-golden.js";
import {
  pointsRoute,
  startQdrantServer,
  type QdrantServer,
} from "../../test/support/qdrant-server.js";
import { createQdrantClient } from "../qdrant/qdrant-connection.js";
import { normalizeOriginalIdForLookup } from "../qdrant/id-lookup.js";
import {
  exactIdSearch,
  partialIdSearch,
  semanticSearch,
  type QdrantSearchClient,
} from "./qdrant-search.js";

describe("Qdrant searches send qdrant-client's requests", () => {
  let server: QdrantServer;

  beforeEach(async () => {
    server = await startQdrantServer(
      pointsRoute("query", () => [
        { id: "b", version: 1, score: 0.8, payload: { original_id: "2" } },
        { id: 7, version: 1, score: 0.8, payload: { original_id: "1" } },
        { id: "c", version: 1, score: 0.3, payload: null },
      ]),
      pointsRoute("scroll", () => [
        { id: "x", payload: { original_id: "8471.30" } },
      ]),
    );
  });

  afterEach(async () => {
    await server.close();
  });

  it.each(golden.qdrantRequests)(
    "sends the $call request for $text",
    async (golden) => {
      const client = createQdrantClient({ QDRANT_URL: server.url }, 5_000);

      if (golden.call === "semantic") {
        await semanticSearch(client, "products", [0.5, -0.25, 1.0], {
          limit: golden.limit,
          quantized: golden.quantized,
          exact: golden.exact,
        });
      } else {
        await partialIdSearch(client, "products", golden.text);
      }

      expect(server.requests).toHaveLength(1);
      expect(server.requests[0]).toMatchObject({
        method: "POST",
        path: golden.request.path,
      });
      expect(server.requests[0]!.body).toEqual(golden.request.body);
    },
  );

  it("returns semantic hits in Qdrant's order with their scores", async () => {
    const client = createQdrantClient({ QDRANT_URL: server.url }, 5_000);

    const results = await semanticSearch(client, "products", [0.1], {
      limit: 3,
      quantized: false,
      exact: true,
    });

    expect(results).toEqual([
      { id: "b", score: 0.8, payload: { original_id: "2" } },
      { id: 7, score: 0.8, payload: { original_id: "1" } },
      { id: "c", score: 0.3, payload: {} },
    ]);
  });

  it("looks up the normalized key field with every probed key", async () => {
    const client = createQdrantClient({ QDRANT_URL: server.url }, 5_000);

    await expect(exactIdSearch(client, "products", "8471.30")).resolves.toEqual(
      {
        exact: [{ id: "x", score: 1.0, payload: { original_id: "8471.30" } }],
        sameNode: [],
      },
    );
    expect(server.requests.map(({ path, body }) => ({ path, body }))).toEqual([
      {
        path: "/collections/products/points/scroll",
        body: {
          filter: {
            must: [
              { key: "original_id_normalized_key", match: { any: ["84713"] } },
            ],
          },
          limit: 100,
          with_payload: true,
          with_vector: false,
        },
      },
    ]);
  });
});

describe("exactIdSearch matches perform_exact_id_search", () => {
  // Python's recorded stub answers a page of the stored codes whose key the
  // filter names, and an offset while more remain.
  function bucketClient(stored: readonly (readonly [string, string])[]) {
    const scrolls: unknown[] = [];
    const scroll = vi.fn(
      async (
        _collection: string,
        request: {
          filter: { must: [{ key: string; match: { any: string[] } }] };
          limit: number;
          offset?: number;
        },
      ) => {
        const [condition] = request.filter.must;
        scrolls.push({
          key: condition.key,
          any: condition.match.any,
          limit: request.limit,
          offset: request.offset ?? null,
        });
        const wanted = new Set(condition.match.any);
        const points = stored
          .filter(([, originalId]) =>
            wanted.has(normalizeOriginalIdForLookup(originalId)),
          )
          .map(([id, originalId]) => ({
            id,
            payload: { original_id: originalId },
          }));
        const start = request.offset ?? 0;
        const end = start + request.limit;
        return {
          points: points.slice(start, end),
          next_page_offset: end < points.length ? end : null,
        };
      },
    );
    return { client: { scroll, query: vi.fn() }, scrolls };
  }

  it.each(golden.exactIdSearches)(
    "sorts the bucket of $query",
    async ({ query, stored, scrolls, exact, sameNode }) => {
      const { client, scrolls: sent } = bucketClient(stored);

      const matches = await exactIdSearch(
        client as unknown as QdrantSearchClient,
        "products",
        query,
      );

      expect(sent).toEqual(scrolls);
      expect(matches.exact.map((result) => result.id)).toEqual(exact);
      expect(matches.sameNode.map((result) => result.id)).toEqual(sameNode);
      expect(matches.exact.every((result) => result.score === 1.0)).toBe(true);
      expect(matches.sameNode.every((result) => result.score === 0.9)).toBe(
        true,
      );
    },
  );
});

describe("partialIdSearch ranks the whole bucket", () => {
  // Scroll pages follow point IDs. Here the shallow codes have the highest
  // IDs, so a search that ranked only its first page would miss them.
  const commodities = Array.from({ length: 1_500 }, (_, index) => ({
    id: index,
    originalId: `50391${String(index).padStart(4, "0")}1`,
  }));
  const stored = [
    ...commodities,
    { id: 2_000, originalId: "50310000" },
    { id: 2_001, originalId: "50320000" },
    { id: 2_002, originalId: "11150300" },
    { id: 2_003, originalId: "99999999" },
  ];

  function scriptedClient(deleted: ReadonlySet<number> = new Set()) {
    const scroll = vi.fn(
      async (
        _collection: string,
        request: { limit: number; offset?: number; with_payload: string[] },
      ) => {
        const matches = stored.filter(({ originalId }) => {
          const normalized = normalizeOriginalIdForLookup(originalId);
          return normalized.startsWith("503") || normalized.endsWith("503");
        });
        const start = request.offset ?? 0;
        const end = start + request.limit;
        return {
          points: matches.slice(start, end).map(({ id, originalId }) => ({
            id,
            payload: {
              original_id: originalId,
              original_id_normalized: normalizeOriginalIdForLookup(originalId),
            },
          })),
          next_page_offset: end < matches.length ? end : null,
        };
      },
    );
    const retrieve = vi.fn(
      async (_collection: string, request: { ids: number[] }) =>
        stored
          .filter(({ id }) => request.ids.includes(id) && !deleted.has(id))
          .map(({ id, originalId }) => ({
            id,
            payload: { original_id: originalId, class_name: `name ${id}` },
          })),
    );
    return { client: { scroll, retrieve, query: vi.fn() }, scroll, retrieve };
  }

  it("pages through every match, then fetches the best 100", async () => {
    const { client, scroll, retrieve } = scriptedClient();

    const results = await partialIdSearch(
      client as unknown as QdrantSearchClient,
      "products",
      "503",
    );

    expect(scroll.mock.calls.map(([, request]) => request.offset)).toEqual([
      undefined,
      1_000,
    ]);
    expect(retrieve).toHaveBeenCalledOnce();
    expect(retrieve.mock.calls[0]![1].ids).toHaveLength(100);
    expect(results).toHaveLength(100);
    expect(results.slice(0, 4).map((result) => result.id)).toEqual([
      2_000, 2_001, 0, 1,
    ]);
    expect(results.at(-1)!.id).toBe(97);
    expect(results.every((result) => result.score === 0.9)).toBe(true);
    expect(results[0]!.payload).toEqual({
      original_id: "50310000",
      class_name: "name 2000",
    });
  });

  it("drops a point deleted before its payload was fetched", async () => {
    const { client } = scriptedClient(new Set([2_001]));

    const results = await partialIdSearch(
      client as unknown as QdrantSearchClient,
      "products",
      "503",
    );

    expect(results.slice(0, 3).map((result) => result.id)).toEqual([
      2_000, 0, 1,
    ]);
    expect(results).toHaveLength(99);
  });

  it("fetches no payloads when nothing matches", async () => {
    const { client, retrieve } = scriptedClient();

    await expect(
      partialIdSearch(
        client as unknown as QdrantSearchClient,
        "products",
        "888",
      ),
    ).resolves.toEqual([]);
    expect(retrieve).not.toHaveBeenCalled();
  });
});
