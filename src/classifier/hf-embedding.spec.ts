import { setTimeout as delay } from "node:timers/promises";
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

async function delayedResponse(
  response: Response,
  ms: number,
  signal: AbortSignal | null | undefined,
): Promise<Response> {
  try {
    await delay(ms, undefined, { signal: signal ?? undefined });
  } catch (error) {
    signal?.throwIfAborted();
    throw error;
  }
  return response;
}

function delayedFetch(
  fetchFn: typeof fetch,
  method: "GET" | "POST",
): typeof fetch {
  return async (input, init) => {
    const response = await fetchFn(input, init);
    return (init?.method ?? "GET") === method
      ? delayedResponse(response, 150, init?.signal)
      : response;
  };
}

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

describe("HfEmbeddingClient outbound budget", () => {
  it.each(["auto", "scaleway"])(
    "sends no request for uncached %s mapping when the budget is spent",
    async (provider) => {
      const fake = fakeFetch(mappingReply(), vector);
      const embedder = new HfEmbeddingClient(
        { token: "hf_test", provider, timeoutSeconds: 20 },
        fake.fetch,
        new FakeClock(),
      );

      await expect(embed(embedder, 0)).rejects.toMatchObject({
        name: "TimeoutError",
      });
      expect(fake.requests).toHaveLength(0);
    },
  );

  it("sends no POST with cached mapping when the budget is spent", async () => {
    const { embedder, requests } = client(undefined, mappingReply(), vector);
    await embed(embedder);

    await expect(embed(embedder, 0)).rejects.toMatchObject({
      name: "TimeoutError",
    });
    expect(requests.map((request) => request.method)).toEqual(["GET", "POST"]);
  });

  it.each([0.0004, 0, -0.0004])(
    "sends no direct endpoint POST with a %s second budget",
    async (maxSeconds) => {
      const fake = fakeFetch(json([0.1, 0.2, 0.3]));
      const embedder = new HfEmbeddingClient(
        { token: "hf_test", provider: "auto", timeoutSeconds: 20 },
        fake.fetch,
        new FakeClock(),
      );

      await expect(
        embedder.embed(
          {
            model: "https://endpoint.test/embeddings",
            text: "industrial pump",
            dims: 3,
            maxSeconds,
          },
          signal,
        ),
      ).rejects.toMatchObject({ name: "TimeoutError" });
      expect(fake.requests).toHaveLength(0);
    },
  );

  it.each(["auto", "hf-inference"])(
    "sends no POST after %s discovery spends the remaining budget",
    async (provider) => {
      const clock = new FakeClock();
      const fake = fakeFetch(
        () => {
          clock.advance(100);
          return json({
            id: MODEL,
            inferenceProviderMapping: MAPPING,
            pipeline_tag: "feature-extraction",
          });
        },
        provider === "hf-inference" ? json([0.1, 0.2, 0.3]) : vector,
      );
      const embedder = new HfEmbeddingClient(
        { token: "hf_test", provider, timeoutSeconds: 20 },
        fake.fetch,
        clock,
      );

      await expect(embed(embedder, 0.1)).rejects.toMatchObject({
        name: "TimeoutError",
      });
      expect(fake.requests.map((request) => request.method)).toEqual(["GET"]);
    },
  );

  it.each(["GET", "POST"] as const)(
    "aborts an active %s before it can outlast the budget",
    async (method) => {
      const clock = new FakeClock();
      const fake = fakeFetch(mappingReply(), vector);
      const embedder = new HfEmbeddingClient(
        { token: "hf_test", provider: "auto", timeoutSeconds: 20 },
        delayedFetch(fake.fetch, method),
        clock,
      );

      await expect(embed(embedder, 0.03)).rejects.toMatchObject({
        name: "TimeoutError",
      });
      expect(fake.requests.map((request) => request.method)).toEqual(
        method === "GET" ? ["GET"] : ["GET", "POST"],
      );
      expect(fake.requests.at(-1)?.signal?.aborted).toBe(true);
      expect(clock.sleeps).toEqual([]);
    },
  );

  it("gives a retry only the time left after the first attempt and wait", async () => {
    const clock = new FakeClock();
    const fake = fakeFetch(
      mappingReply(),
      () => {
        clock.advance(100);
        return json({}, 503);
      },
      vector,
    );
    const fetchFn: typeof fetch = async (input, init) => {
      const response = await fake.fetch(input, init);
      return fake.requests.length === 3
        ? delayedResponse(response, 150, init?.signal)
        : response;
    };
    const embedder = new HfEmbeddingClient(
      { token: "hf_test", provider: "auto", timeoutSeconds: 20 },
      fetchFn,
      clock,
    );

    await expect(embed(embedder, 1.13)).rejects.toMatchObject({
      name: "TimeoutError",
    });
    expect(fake.requests.map((request) => request.method)).toEqual([
      "GET",
      "POST",
      "POST",
    ]);
    expect(fake.requests.at(-1)?.signal?.aborted).toBe(true);
    expect(clock.sleeps).toEqual([1000]);
  });

  it.each<{
    method: "GET" | "POST";
    maxSeconds: number | undefined;
  }>([
    { method: "GET", maxSeconds: 5 },
    { method: "POST", maxSeconds: 5 },
    { method: "POST", maxSeconds: undefined },
  ])(
    "keeps the configured $method timeout with maxSeconds=$maxSeconds",
    async ({ method, maxSeconds }) => {
      const clock = new FakeClock();
      const fake = fakeFetch((request) =>
        request.method === "GET" ? mappingReply() : vector.clone(),
      );
      const embedder = new HfEmbeddingClient(
        { token: "hf_test", provider: "auto", timeoutSeconds: 0.03 },
        delayedFetch(fake.fetch, method),
        clock,
      );

      await expect(embed(embedder, maxSeconds)).rejects.toMatchObject({
        name: "TimeoutError",
      });
      expect(fake.requests.map((request) => request.method)).toEqual(
        method === "GET"
          ? ["GET", "GET", "GET"]
          : ["GET", "POST", "POST", "POST"],
      );
      expect(clock.sleeps).toEqual([1000, 2000]);
    },
  );

  it("preserves caller cancellation during a budgeted POST without retrying", async () => {
    const controller = new AbortController();
    const reason = new DOMException("The operation was aborted.", "AbortError");
    const clock = new FakeClock();
    const fake = fakeFetch(mappingReply(), () => {
      setTimeout(() => controller.abort(reason), 5);
      return vector.clone();
    });
    const embedder = new HfEmbeddingClient(
      { token: "hf_test", provider: "auto", timeoutSeconds: 20 },
      delayedFetch(fake.fetch, "POST"),
      clock,
    );

    await expect(
      embedder.embed(
        { model: MODEL, text: "industrial pump", dims: 3, maxSeconds: 5 },
        controller.signal,
      ),
    ).rejects.toBe(reason);
    expect(fake.requests.map((request) => request.method)).toEqual([
      "GET",
      "POST",
    ]);
    expect(clock.sleeps).toEqual([]);
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
