import { classificationGolden as golden } from "../../test/support/classification-golden.js";
import { fakeFetch, json } from "../../test/support/fake-http.js";
import { QUERY_ENHANCEMENT_MODEL, QueryEnhancer } from "./query-enhancer.js";

const signal = new AbortController().signal;

function description(content: unknown) {
  return json({ choices: [{ message: { content } }] });
}

describe("QueryEnhancer matches app/query_enhancer.py", () => {
  it.each(golden.enhancer)(
    "enhances $query when the model answers $status $body",
    async ({ query, status, body, requested, text, outcome }) => {
      const fake = fakeFetch(json(body, status));

      const actual = await new QueryEnhancer("k", fake.fetch).enhance(
        query,
        "UNSPSC",
        signal,
      );

      expect(actual).toEqual({ text, status: outcome });
      expect(fake.requests.length > 0).toBe(requested);
    },
  );

  it("sends the request Python sends", async () => {
    const fake = fakeFetch(description("A pump"));

    await new QueryEnhancer("or-key", fake.fetch).enhance(
      "industrial  pump",
      "UNSPSC",
      signal,
    );

    expect(
      fake.requests.map(({ signal: _signal, ...request }) => request),
    ).toEqual(golden.openRouterRequests.enhance);
  });

  it("turns a short term into bounded semantic text", async () => {
    const fake = fakeFetch(description("  Threaded metal fastener  "));

    const outcome = await new QueryEnhancer("k", fake.fetch).enhance(
      "bolt",
      "UNSPSC",
      signal,
    );

    expect(outcome).toEqual({
      text: "bolt\n\nThreaded metal fastener",
      status: "applied",
    });
    expect(fake.requests).toHaveLength(1);
    const body = fake.requests[0]!.body as {
      model: string;
      messages: { role: string; content: string }[];
    };
    expect(body.model).toBe(QUERY_ENHANCEMENT_MODEL);
    expect(body.messages).toHaveLength(1);
    expect(body.messages[0]!.role).toBe("user");
    expect(body.messages[0]!.content.startsWith("bolt\n\nFor a UNSPSC")).toBe(
      true,
    );
  });

  it.each([
    ["HTTP 503", json({}, 503), "failed"],
    ["no choices", json({ choices: [] }), "failed"],
    ["241 characters", description("x".repeat(241)), "failed"],
    ["a blank description", description(" "), "skipped"],
  ] as const)("keeps the original for %s", async (_name, reply, status) => {
    const fake = fakeFetch(reply);

    await expect(
      new QueryEnhancer("k", fake.fetch).enhance("bolt", "UNSPSC", signal),
    ).resolves.toEqual({ text: "bolt", status });
  });

  it("skips codes without a network request", async () => {
    const fake = fakeFetch(description("unused"));
    const enhancer = new QueryEnhancer("k", fake.fetch);

    for (const code of ["8471", "8471.50", "SH203-C20", "SH203"]) {
      await expect(enhancer.enhance(code, "HS", signal)).resolves.toEqual({
        text: code,
        status: "skipped",
      });
    }
    expect(fake.requests).toHaveLength(0);
  });

  it.each(["bolt 123 mm", "M8 bolt", "3D", "B2B"])(
    "sends %s to the model",
    async (query) => {
      const fake = fakeFetch(description("A common product term"));

      const outcome = await new QueryEnhancer("k", fake.fetch).enhance(
        query,
        "UNSPSC",
        signal,
      );

      expect(outcome.status).toBe("applied");
      expect(fake.requests).toHaveLength(1);
    },
  );

  it("sanitizes the model's text before semantic search", async () => {
    const fake = fakeFetch(description("Threaded fastener …"));

    const outcome = await new QueryEnhancer("k", fake.fetch).enhance(
      "bolt",
      "UNSPSC",
      signal,
    );

    expect(outcome.text).toBe("bolt\n\nThreaded fastener");
  });

  it("never sends an invalid original to the model", async () => {
    const fake = fakeFetch(description("unused"));

    const outcome = await new QueryEnhancer("k", fake.fetch).enhance(
      "x",
      "UNSPSC",
      signal,
    );

    expect(outcome).toEqual({ text: "x", status: "failed" });
    expect(fake.requests).toHaveLength(0);
  });

  it("rethrows when the caller aborts", async () => {
    const controller = new AbortController();
    controller.abort();
    const fake = fakeFetch(description("unused"));

    await expect(
      new QueryEnhancer("k", fake.fetch).enhance(
        "bolt",
        "UNSPSC",
        controller.signal,
      ),
    ).rejects.toThrow();
  });
});
