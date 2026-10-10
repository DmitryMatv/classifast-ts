import { classificationGolden as golden } from "../../test/support/classification-golden.js";
import {
  FakeClock,
  fakeFetch,
  json,
  type Reply,
} from "../../test/support/fake-http.js";
import type { Fetch } from "./outbound.js";
import {
  OpenRouterReranker,
  RerankerResponseError,
  parseRerankScores,
  requestTimeoutSeconds,
} from "./openrouter-reranker.js";

const signal = new AbortController().signal;

function reranker(...replies: Reply[]) {
  const fake = fakeFetch(...replies);
  const clock = new FakeClock();
  return {
    reranker: new OpenRouterReranker(
      { apiKey: "or-key", model: "voyageai/rerank-3", timeoutSeconds: 30 },
      fake.fetch,
      clock,
    ),
    requests: fake.requests,
    clock,
  };
}

const oneScore = json({ results: [{ index: 0, relevance_score: 0.6 }] });

describe("OpenRouterReranker matches app/reranker.py", () => {
  it("sends the request Python sends", async () => {
    const fake = fakeFetch(
      json({
        results: [
          { index: 0, relevance_score: 0.5 },
          { index: 1, relevance_score: 0.25 },
        ],
      }),
    );
    const client = new OpenRouterReranker(
      { apiKey: "or-key", model: "voyageai/rerank-3", timeoutSeconds: 30 },
      fake.fetch,
    );

    await client.rerank(
      "Find codes.\nQuery: pump",
      ["Pump body", "Pump casing"],
      {
        timeoutSeconds: 12.5,
        signal,
      },
    );

    expect(
      fake.requests.map(({ signal: _signal, ...request }) => request),
    ).toEqual(golden.openRouterRequests.rerank);
  });

  it.each(golden.rerankResponses)(
    "parses $payload like Python",
    ({ payload, scores }) => {
      if (scores === null) {
        expect(() => parseRerankScores(payload, 2)).toThrow(
          RerankerResponseError,
        );
      } else {
        expect(parseRerankScores(payload, 2)).toEqual(scores);
      }
    },
  );

  it("returns scores in document order", async () => {
    const { reranker: client } = reranker(
      json({
        results: [
          { index: 1, relevance_score: 0.9 },
          { index: 0, relevance_score: 0.4 },
        ],
      }),
    );

    await expect(
      client.rerank("query", ["first", "second"], { signal }),
    ).resolves.toEqual([0.4, 0.9]);
  });

  it("makes no request for no documents", async () => {
    const { reranker: client, requests } = reranker(oneScore);

    await expect(client.rerank("query", [], { signal })).resolves.toEqual([]);
    expect(requests).toHaveLength(0);
  });

  it.each([undefined, 8])(
    "retries a 503 once it recovers (budget %s s)",
    async (timeoutSeconds) => {
      const {
        reranker: client,
        requests,
        clock,
      } = reranker(json({}, 503), oneScore);

      await expect(
        client.rerank("query", ["document"], { timeoutSeconds, signal }),
      ).resolves.toEqual([0.6]);
      expect(requests).toHaveLength(2);
      expect(clock.sleeps).toEqual([1000]);
    },
  );

  it("does not retry a 403", async () => {
    const { reranker: client, requests } = reranker(json({}, 403));

    await expect(
      client.rerank("query", ["document"], { signal }),
    ).rejects.toThrow("HTTP 403");
    expect(requests).toHaveLength(1);
  });

  it("stops retrying once the budget has passed", async () => {
    const clock = new FakeClock();
    const fake = fakeFetch(() => {
      clock.advance(3_000);
      return json({}, 503);
    });
    const client = new OpenRouterReranker(
      { apiKey: "or-key", model: "m", timeoutSeconds: 30 },
      fake.fetch,
      clock,
    );

    await expect(
      client.rerank("query", ["document"], { timeoutSeconds: 3, signal }),
    ).rejects.toThrow("HTTP 503");
    expect(fake.requests).toHaveLength(1);
  });

  it("caps the request timeout at the configured timeout with a 0.1 s floor", () => {
    expect(requestTimeoutSeconds(30, undefined)).toBe(30);
    expect(requestTimeoutSeconds(30, 8)).toBe(8);
    expect(requestTimeoutSeconds(5, 999)).toBe(5);
    expect(requestTimeoutSeconds(30, 0)).toBe(0.1);
  });

  it("reranks with a fractional remaining budget", async () => {
    const { reranker: client } = reranker(oneScore);

    await expect(
      client.rerank("query", ["document"], {
        timeoutSeconds: 5.989834,
        signal,
      }),
    ).resolves.toEqual([0.6]);
  });

  it("aborts and retries a request that outlasts the timeout", async () => {
    let attempts = 0;
    const hanging: Fetch = async (_input, init) => {
      attempts += 1;
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(init.signal?.reason),
        );
      });
    };
    const client = new OpenRouterReranker(
      { apiKey: "or-key", model: "m", timeoutSeconds: 0.1 },
      hanging,
      new FakeClock(),
    );

    await expect(
      client.rerank("query", ["document"], { signal }),
    ).rejects.toMatchObject({ name: "TimeoutError" });
    expect(attempts).toBe(3);
  });
});
