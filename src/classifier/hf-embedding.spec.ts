import { classificationGolden as golden } from "../../test/support/classification-golden.js";
import {
  FakeClock,
  connectionRefused,
  fakeFetch,
  json,
  type Reply,
} from "../../test/support/fake-http.js";
import { HfEmbeddingClient } from "./hf-embedding.js";

const MODEL = "Qwen/Qwen3-Embedding-8B";
const MAPPING = {
  scaleway: {
    status: "live",
    providerId: "qwen3-embedding-8b",
    task: "feature-extraction",
  },
};
const signal = new AbortController().signal;

function client(clock = new FakeClock(), ...replies: Reply[]) {
  const fake = fakeFetch(...replies);
  const embedder = new HfEmbeddingClient(
    { token: "hf_test", provider: "auto", timeoutSeconds: 20 },
    fake.fetch,
    clock,
  );
  return { embedder, requests: fake.requests, clock };
}

function mappingReply(): Response {
  return json({ id: MODEL, inferenceProviderMapping: MAPPING });
}

function embed(embedder: HfEmbeddingClient, maxSeconds?: number) {
  return embedder.embed(
    { model: MODEL, text: "industrial pump", dims: 3, maxSeconds },
    signal,
  );
}

const vector = json({ data: [{ embedding: [0.1, 0.2, 0.3] }] });

describe("HfEmbeddingClient matches huggingface_hub", () => {
  it.each(golden.embedding)(
    "embeds $model with a $token token and provider $provider",
    async ({
      token,
      provider,
      model,
      mapping,
      modelInfo,
      response,
      requests,
      vector,
    }) => {
      const fake = fakeFetch((request) =>
        request.method === "GET"
          ? json({ id: MODEL, inferenceProviderMapping: mapping, ...modelInfo })
          : json(response),
      );
      const embedder = new HfEmbeddingClient(
        { token, provider, timeoutSeconds: 20 },
        fake.fetch,
        new FakeClock(),
      );

      const actual = await embedder
        .embed({ model, text: "industrial pump", dims: 3 }, signal)
        .catch(() => null);

      expect(actual).toEqual(vector);
      expect(
        fake.requests.map(({ signal: _signal, ...request }) => request),
      ).toEqual(requests);
    },
  );

  it("fetches the provider mapping once per model", async () => {
    const { embedder, requests } = client(
      undefined,
      mappingReply(),
      vector,
      vector,
    );

    await embed(embedder);
    await embed(embedder);

    expect(requests.map((request) => request.method)).toEqual([
      "GET",
      "POST",
      "POST",
    ]);
  });

  it("checks the hf-inference task once per model", async () => {
    const fake = fakeFetch(
      json({ id: MODEL, pipeline_tag: "feature-extraction" }),
      json([0.1, 0.2, 0.3]),
    );
    const embedder = new HfEmbeddingClient(
      { token: "hf_test", provider: "hf-inference", timeoutSeconds: 20 },
      fake.fetch,
      new FakeClock(),
    );

    await embed(embedder);
    await embed(embedder);

    expect(fake.requests.map((request) => request.method)).toEqual([
      "GET",
      "POST",
      "POST",
    ]);
  });
});

describe("HfEmbeddingClient hf-inference task check", () => {
  it("is bounded by the outbound budget, not the embedding timeout", async () => {
    const taskInfo = json({ id: MODEL, pipeline_tag: "feature-extraction" });
    const fetchFn: typeof fetch = async (_input, init) => {
      if ((init?.method ?? "GET") === "POST") return json([0.1, 0.2, 0.3]);
      await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, 150);
        init?.signal?.addEventListener("abort", () => {
          clearTimeout(timer);
          reject(init.signal?.reason);
        });
      });
      return taskInfo.clone();
    };
    const embedder = new HfEmbeddingClient(
      { token: "hf_test", provider: "hf-inference", timeoutSeconds: 0.05 },
      fetchFn,
      new FakeClock(),
    );

    await expect(embed(embedder, 5)).resolves.toHaveLength(3);
  });

  it("sends no request when the outbound budget is already spent", async () => {
    const fake = fakeFetch(json({}, 503));
    const embedder = new HfEmbeddingClient(
      { token: "hf_test", provider: "hf-inference", timeoutSeconds: 20 },
      fake.fetch,
      new FakeClock(),
    );

    await expect(embed(embedder, 0)).rejects.toMatchObject({
      name: "TimeoutError",
    });
    expect(fake.requests).toHaveLength(0);
  });
});

describe("HfEmbeddingClient retries like tenacity", () => {
  it.each([
    ["a timeout", new DOMException("timed out", "TimeoutError")],
    ["a refused connection", connectionRefused()],
    ["HTTP 503", json({}, 503)],
    ["HTTP 429", json({}, 429)],
  ] as const)("retries %s", async (_name, failure) => {
    const { embedder, requests, clock } = client(
      undefined,
      mappingReply(),
      failure,
      vector,
    );

    await expect(embed(embedder)).resolves.toEqual([
      Math.fround(0.1),
      Math.fround(0.2),
      Math.fround(0.3),
    ]);
    expect(requests.filter((r) => r.method === "POST")).toHaveLength(2);
    expect(clock.sleeps).toEqual([1000]);
  });

  it("gives up after three attempts, waiting 1 s and then 2 s", async () => {
    const { embedder, requests, clock } = client(
      undefined,
      mappingReply(),
      json({}, 502),
    );

    await expect(embed(embedder)).rejects.toThrow("HTTP 502");
    expect(requests.filter((r) => r.method === "POST")).toHaveLength(3);
    expect(clock.sleeps).toEqual([1000, 2000]);
  });

  it("does not retry a client error", async () => {
    const { embedder, requests } = client(
      undefined,
      mappingReply(),
      json({}, 400),
    );

    await expect(embed(embedder)).rejects.toThrow("HTTP 400");
    expect(requests.filter((r) => r.method === "POST")).toHaveLength(1);
  });

  it("starts no new attempt once the budget has passed", async () => {
    const clock = new FakeClock();
    const { embedder, requests } = client(clock, mappingReply(), () => {
      clock.advance(5_000);
      return json({}, 503);
    });

    await expect(embed(embedder, 5)).rejects.toThrow("HTTP 503");
    expect(requests.filter((r) => r.method === "POST")).toHaveLength(1);
  });

  it("retries while the budget lasts", async () => {
    const clock = new FakeClock();
    const { embedder, requests } = client(clock, mappingReply(), () => {
      clock.advance(1_000);
      return json({}, 503);
    });

    await expect(embed(embedder, 2.5)).rejects.toThrow("HTTP 503");
    expect(requests.filter((r) => r.method === "POST")).toHaveLength(2);
  });

  it("passes the caller's abort signal to fetch and stops retrying once it aborts", async () => {
    const controller = new AbortController();
    const fake = fakeFetch(mappingReply(), () => {
      controller.abort();
      return json({}, 503);
    });
    const embedder = new HfEmbeddingClient(
      { token: "hf_test", provider: "auto", timeoutSeconds: 20 },
      fake.fetch,
      new FakeClock(),
    );

    await expect(
      embedder.embed(
        { model: MODEL, text: "industrial pump", dims: 3 },
        controller.signal,
      ),
    ).rejects.toThrow();
    expect(fake.requests).toHaveLength(2);
    expect(fake.requests[1]!.signal?.aborted).toBe(true);
  });
});
