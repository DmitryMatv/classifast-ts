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
