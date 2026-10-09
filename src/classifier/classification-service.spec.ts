import {
  pipelineFixture,
  type FakePoint,
  type PipelineFixture,
  type PipelineOptions,
} from "../../test/support/classification-pipeline.js";
import { connectionRefused, fakeFetch } from "../../test/support/fake-http.js";
import type { EnhancementStatus } from "./classification.js";
import {
  ClassificationQueue,
  ClassificationQueueFull,
  QUEUE_CAPACITY,
} from "./classification-queue.js";
import {
  ClassificationService,
  type ClassificationRequest,
} from "./classification-service.js";
import { buildClassifierConfig } from "./classifier-config.js";
import { QueryEnhancer, type EnhancementOutcome } from "./query-enhancer.js";

const UNSPSC = buildClassifierConfig({}).UNSPSC!;

const exactPoint: FakePoint = {
  id: "exact",
  payload: { original_id: "SH203-C20" },
};
const partialPoint: FakePoint = {
  id: "partial",
  payload: { original_id: "SH203-C20" },
};
const semanticPoint: FakePoint = {
  id: "semantic",
  score: 0.4,
  payload: { original_id: "31161500", class_name: "Bolts" },
};

let fixture: PipelineFixture | undefined;

afterEach(async () => {
  await fixture?.qdrant.close();
  fixture = undefined;
});

interface ServiceSetup extends PipelineOptions {
  readonly enhancer?: Pick<QueryEnhancer, "enhance"> | null;
  readonly queue?: ClassificationQueue;
}

async function setUp({
  enhancer = null,
  queue = new ClassificationQueue(),
  ...options
}: ServiceSetup = {}) {
  fixture = await pipelineFixture(options);
  return {
    fixture,
    service: new ClassificationService(fixture.deps, queue, enhancer),
  };
}

function request(
  overrides: Partial<ClassificationRequest> = {},
): ClassificationRequest {
  return { query: "bolt", classifierType: "UNSPSC", topK: 3, ...overrides };
}

function stubEnhancer(text: string, status: EnhancementStatus) {
  const calls: unknown[][] = [];
  return {
    calls,
    enhance: async (...args: unknown[]): Promise<EnhancementOutcome> => {
      calls.push(args.slice(0, 2));
      return { text, status };
    },
  };
}

function never(): Promise<void> {
  return new Promise(() => {});
}

describe("ClassificationService enhancement", () => {
  it("skips enhancement, the partial search and embedding on an exact alphanumeric ID", async () => {
    const enhancer = stubEnhancer("unused", "applied");
    const { fixture, service } = await setUp({
      enhancer,
      exact: [exactPoint],
    });
    const outcome = await service.classify(
      new AbortController().signal,
      request({ query: "SH203-C20", classifierType: "ETIM", enhance: true }),
    );
    expect(outcome.results[0]!.payload.original_id).toBe("SH203-C20");
    expect(outcome.query).toBe("SH203-C20");
    expect(outcome.enhancementStatus).toBe("skipped");
    expect(fixture.requests("exact")).toHaveLength(1);
    expect(fixture.requests("partial")).toHaveLength(0);
    expect(fixture.embedCalls).toHaveLength(0);
    expect(enhancer.calls).toHaveLength(0);
  });

  it("embeds and reranks an applied description in the input-first format", async () => {
    const semantic = "bolt\n\nA threaded fastener";
    const enhancer = stubEnhancer(semantic, "applied");
    const { fixture, service } = await setUp({
      enhancer,
      semantic: [semanticPoint],
      rerank: [0.8],
    });
    const outcome = await service.classify(
      new AbortController().signal,
      request({ enhance: true }),
    );
    expect(outcome.query).toBe("bolt");
    expect(outcome.enhancementStatus).toBe("applied");
    expect(fixture.requests("exact")).toHaveLength(1);
    expect(enhancer.calls).toEqual([["bolt", "UNSPSC"]]);
    expect(fixture.embedCalls[0]!.text).toBe(
      `${semantic}\n\n${UNSPSC.queryInstruction}`,
    );
    expect(fixture.rerankCalls[0]!.query).toBe(
      `${semantic}\n\n${UNSPSC.rerankInstruction}`,
    );
  });

  it("keeps the original query in the legacy format when enhancement fails", async () => {
    const { fixture, service } = await setUp({
      enhancer: stubEnhancer("bolt", "failed"),
    });
    const outcome = await service.classify(
      new AbortController().signal,
      request({ enhance: true }),
    );
    expect(outcome.enhancementStatus).toBe("failed");
    expect(fixture.embedCalls[0]!.text).toBe(
      `Instruct: ${UNSPSC.queryInstruction}\nQuery:bolt`,
    );
  });

  it("reports a missing enhancer as a failure", async () => {
    const { service } = await setUp();
    const outcome = await service.classify(
      new AbortController().signal,
      request({ enhance: true }),
    );
    expect(outcome.enhancementStatus).toBe("failed");
  });

  it("skips OpenRouter for a partial code and keeps the ID result", async () => {
    const openRouter = fakeFetch(connectionRefused());
    const { fixture, service } = await setUp({
      enhancer: new QueryEnhancer("test", openRouter.fetch),
      partial: [partialPoint],
    });
    const outcome = await service.classify(
      new AbortController().signal,
      request({ query: "SH203", classifierType: "ETIM", enhance: true }),
    );
    expect(openRouter.requests).toHaveLength(0);
    expect(outcome.enhancementStatus).toBe("skipped");
    expect(outcome.results[0]!.payload.original_id).toBe("SH203-C20");
    expect(outcome.query).toBe("SH203");
    expect(fixture.requests("exact")).toHaveLength(1);
    expect(fixture.requests("partial")).toHaveLength(1);
    expect(fixture.embedCalls[0]!.text.startsWith("Instruct: ")).toBe(true);
  });

  it("leaves the status undefined when enhancement was not requested", async () => {
    const enhancer = stubEnhancer("unused", "applied");
    const { service } = await setUp({ enhancer });
    const outcome = await service.classify(
      new AbortController().signal,
      request(),
    );
    expect(outcome.enhancementStatus).toBeUndefined();
    expect(enhancer.calls).toHaveLength(0);
  });
});

describe("ClassificationService outcome", () => {
  it("returns the results, version, query and elapsed time", async () => {
    const { service } = await setUp({ semantic: [semanticPoint] });
    const version = Object.keys(UNSPSC.versions)[0]!;
    const outcome = await service.classify(
      new AbortController().signal,
      request({ query: "  bolt  ", version }),
    );
    expect(outcome.results.map((result) => result.id)).toEqual(["semantic"]);
    expect(outcome.versionName).toBe(version);
    expect(outcome.version).toEqual(UNSPSC.versions[version]);
    expect(outcome.query).toBe("bolt");
    expect(outcome.elapsedSeconds).toBeGreaterThanOrEqual(0);
  });
});

describe("ClassificationService queue turn", () => {
  it("authorizes inside the turn, after the previous classification finishes", async () => {
    const queue = new ClassificationQueue();
    const { fixture, service } = await setUp({ queue });
    let release!: () => void;
    const holder = queue.run(
      new AbortController().signal,
      () => new Promise<void>((resolve) => (release = resolve)),
    );
    const events: string[] = [];
    const classified = service.classify(
      new AbortController().signal,
      request(),
      async () => {
        events.push(`authorize after ${fixture.qdrant.requests.length}`);
      },
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(events).toEqual([]);
    release();
    await holder;
    await classified;
    expect(events).toEqual(["authorize after 0"]);
    expect(fixture.qdrant.requests.length).toBeGreaterThan(0);
  });

  it("runs no stage when authorize rejects", async () => {
    const { fixture, service } = await setUp();
    const paywall = new Error("over quota");
    await expect(
      service.classify(new AbortController().signal, request(), async () => {
        throw paywall;
      }),
    ).rejects.toBe(paywall);
    expect(fixture.qdrant.requests).toHaveLength(0);
    expect(fixture.embedCalls).toHaveLength(0);
  });

  it("never authorizes a classification that overflows the queue", async () => {
    const queue = new ClassificationQueue();
    const { service } = await setUp({ queue });
    for (let i = 0; i < QUEUE_CAPACITY; i += 1) {
      void queue.run(new AbortController().signal, never);
    }
    let authorized = false;
    await expect(
      service.classify(new AbortController().signal, request(), async () => {
        authorized = true;
      }),
    ).rejects.toBeInstanceOf(ClassificationQueueFull);
    expect(authorized).toBe(false);
  });

  it("never authorizes a classification cancelled while waiting", async () => {
    const queue = new ClassificationQueue();
    const { service } = await setUp({ queue });
    void queue.run(new AbortController().signal, never);
    const controller = new AbortController();
    let authorized = false;
    const classified = service.classify(
      controller.signal,
      request(),
      async () => {
        authorized = true;
      },
    );
    controller.abort(new Error("client gone"));
    await expect(classified).rejects.toThrow("client gone");
    expect(authorized).toBe(false);
  });

  it("propagates pipeline errors to the caller", async () => {
    const { service } = await setUp({ embedder: null });
    await expect(
      service.classify(new AbortController().signal, request()),
    ).rejects.toMatchObject({ status: 503 });
  });
});
