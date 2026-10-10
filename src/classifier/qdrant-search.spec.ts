import { classificationGolden as golden } from "../../test/support/classification-golden.js";
import {
  pointsRoute,
  startQdrantServer,
  type QdrantServer,
} from "../../test/support/qdrant-server.js";
import { createQdrantClient } from "../qdrant/qdrant-connection.js";
import {
  exactIdSearch,
  partialIdSearch,
  semanticSearch,
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
      } else if (golden.call === "exact") {
        await exactIdSearch(client, "products", golden.text);
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

  it("scores exact ID matches 1.0", async () => {
    const client = createQdrantClient({ QDRANT_URL: server.url }, 5_000);

    await expect(exactIdSearch(client, "products", "8471.30")).resolves.toEqual(
      [{ id: "x", score: 1.0, payload: { original_id: "8471.30" } }],
    );
  });
});
