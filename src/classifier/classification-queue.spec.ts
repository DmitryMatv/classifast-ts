import {
  ClassificationQueue,
  ClassificationQueueClosed,
  ClassificationQueueFull,
  QUEUE_CAPACITY,
} from "./classification-queue.js";

type State = "pending" | "fulfilled" | "rejected";

interface Submitted {
  readonly result: Promise<string>;
  readonly controller: AbortController;
  state(): State;
  release(): void;
  fail(error: unknown): void;
}

function settle(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

function submit(
  queue: ClassificationQueue,
  name: string,
  ran: string[],
): Submitted {
  const controller = new AbortController();
  let release!: () => void;
  let fail!: (error: unknown) => void;
  const gate = new Promise<void>((resolve, reject) => {
    release = resolve;
    fail = reject;
  });
  let state: State = "pending";
  const result = queue.run(controller.signal, async () => {
    ran.push(name);
    await gate;
    return name;
  });
  result.then(
    () => (state = "fulfilled"),
    () => (state = "rejected"),
  );
  return { result, controller, state: () => state, release, fail };
}

describe("ClassificationQueue", () => {
  let queue: ClassificationQueue;
  let ran: string[];
  let jobs: Submitted[];

  const enqueue = async (name: string): Promise<Submitted> => {
    const job = submit(queue, name, ran);
    jobs.push(job);
    await settle();
    return job;
  };

  const fillQueue = async (): Promise<Submitted[]> => {
    const accepted = [await enqueue("active")];
    for (let index = 0; index < QUEUE_CAPACITY - 1; index += 1) {
      accepted.push(await enqueue(`waiting-${index}`));
    }
    return accepted;
  };

  const expectOverflow = async (): Promise<void> => {
    const overflow = submit(queue, "overflow", ran);
    await expect(overflow.result).rejects.toBeInstanceOf(
      ClassificationQueueFull,
    );
  };

  beforeEach(() => {
    queue = new ClassificationQueue();
    ran = [];
    jobs = [];
  });

  afterEach(async () => {
    for (const job of jobs) job.release();
    await queue.close();
  });

  it("two classifications never overlap", async () => {
    const first = await enqueue("first");
    const second = await enqueue("second");
    expect(ran).toEqual(["first"]);

    first.release();
    await first.result;
    await settle();
    expect(ran).toEqual(["first", "second"]);
    second.release();
    await expect(second.result).resolves.toBe("second");
  });

  it("one active four waiting reject sixth and run fifo", async () => {
    const accepted = await fillQueue();
    await expectOverflow();
    expect(ran).toEqual(["active"]);

    for (const job of accepted) job.release();
    const expected = [
      "active",
      "waiting-0",
      "waiting-1",
      "waiting-2",
      "waiting-3",
    ];
    await expect(
      Promise.all(accepted.map((job) => job.result)),
    ).resolves.toEqual(expected);
    expect(ran).toEqual(expected);
    const next = await enqueue("next");
    next.release();
    await expect(next.result).resolves.toBe("next");
  });

  it("a freed slot admits exactly one more job", async () => {
    const accepted = await fillQueue();
    accepted[0]!.release();
    await accepted[0]!.result;
    await settle();

    await enqueue("replacement");
    await expectOverflow();
    expect(ran).toEqual(["active", "waiting-0"]);
  });

  it("work errors propagate unchanged", async () => {
    const error = new Error("bad classification");
    const signal = new AbortController().signal;

    await expect(queue.run(signal, () => Promise.reject(error))).rejects.toBe(
      error,
    );
    await expect(
      queue.run(signal, () => {
        throw error;
      }),
    ).rejects.toBe(error);
    await expect(queue.run(signal, async () => "next")).resolves.toBe("next");
  });

  it("error and work abort allow waiting jobs to continue", async () => {
    for (const error of [
      new Error("worker failed"),
      new DOMException("stage aborted", "AbortError"),
    ]) {
      ran = [];
      const accepted = await fillQueue();
      await expectOverflow();

      accepted[0]!.fail(error);
      await expect(accepted[0]!.result).rejects.toBe(error);
      for (const job of accepted) job.release();
      await expect(
        Promise.all(accepted.slice(1).map((job) => job.result)),
      ).resolves.toEqual(["waiting-0", "waiting-1", "waiting-2", "waiting-3"]);
    }
  });

  it("cancelled waiting job frees capacity and never runs", async () => {
    const accepted = await fillQueue();
    const reason = new Error("client left");
    accepted[2]!.controller.abort(reason);
    await expect(accepted[2]!.result).rejects.toBe(reason);
    const replacement = await enqueue("replacement");
    await expectOverflow();

    for (const job of jobs) job.release();
    const survivors = [
      accepted[0]!,
      accepted[1]!,
      accepted[3]!,
      accepted[4]!,
      replacement,
    ];
    const expected = [
      "active",
      "waiting-0",
      "waiting-2",
      "waiting-3",
      "replacement",
    ];
    await expect(
      Promise.all(survivors.map((job) => job.result)),
    ).resolves.toEqual(expected);
    expect(ran).toEqual(expected);
  });

  it("an already aborted signal is rejected without taking a slot", async () => {
    await fillQueue();
    const controller = new AbortController();
    const reason = new Error("gone before admission");
    controller.abort(reason);
    const work = vi.fn(async () => "never");

    await expect(queue.run(controller.signal, work)).rejects.toBe(reason);
    expect(work).not.toHaveBeenCalled();
  });

  it("cancelled active response keeps capacity until work settles", async () => {
    const accepted = await fillQueue();
    const reason = new Error("client left");
    accepted[0]!.controller.abort(reason);
    await expect(accepted[0]!.result).rejects.toBe(reason);
    await expectOverflow();
    expect(ran).toEqual(["active"]);

    accepted[0]!.release();
    await settle();
    expect(ran).toEqual(["active", "waiting-0"]);
    for (const job of accepted) job.release();
    await Promise.all(accepted.slice(1).map((job) => job.result));
    const next = await enqueue("next");
    next.release();
    await expect(next.result).resolves.toBe("next");
  });

  it("aborting after completion changes nothing", async () => {
    const done = await enqueue("done");
    done.release();
    await expect(done.result).resolves.toBe("done");

    done.controller.abort(new Error("late"));
    await settle();
    expect(done.state()).toBe("fulfilled");
    await enqueue("next");
    expect(ran).toEqual(["done", "next"]);
  });

  it("one turn spans every stage of a classification", async () => {
    const events: string[] = [];
    let releaseEnhancement!: () => void;
    const enhancement = new Promise<void>((resolve) => {
      releaseEnhancement = resolve;
    });
    const active = queue.run(new AbortController().signal, async () => {
      events.push("prepare");
      await enhancement;
      events.push("complete");
      return "active";
    });
    const waiting = await enqueue("waiting");
    await settle();
    expect(events).toEqual(["prepare"]);
    expect(ran).toEqual([]);

    releaseEnhancement();
    await expect(active).resolves.toBe("active");
    await settle();
    expect(events).toEqual(["prepare", "complete"]);
    expect(ran).toEqual(["waiting"]);
    waiting.release();
  });

  it("cancelled enhancement stops completion and releases turn", async () => {
    const events: string[] = [];
    const controller = new AbortController();
    const active = queue.run(controller.signal, async (signal) => {
      events.push("prepare");
      await new Promise<void>((_, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), {
          once: true,
        });
      });
      events.push("complete");
    });
    const waiting = await enqueue("waiting");

    const reason = new Error("client left");
    controller.abort(reason);
    await expect(active).rejects.toBe(reason);
    await settle();
    expect(ran).toEqual(["waiting"]);
    expect(events).toEqual(["prepare"]);
    waiting.release();
    await expect(waiting.result).resolves.toBe("waiting");
  });

  it("aborted active job keeps its slot through a late failure without an unhandled rejection", async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on("unhandledRejection", onUnhandled);
    try {
      const accepted = await fillQueue();
      accepted[0]!.controller.abort(new Error("client left"));
      await expect(accepted[0]!.result).rejects.toThrow("client left");
      await expectOverflow();
      expect(ran).toEqual(["active"]);

      accepted[0]!.fail(new Error("stage failed after caller abort"));
      await settle();
      expect(ran).toEqual(["active", "waiting-0"]);
      for (const job of accepted) job.release();
      await Promise.all(accepted.slice(1).map((job) => job.result));
      await settle();
      expect(unhandled).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });

  it("cancelled waiting quota gate never charges and slot is reusable", async () => {
    const charged: string[] = [];
    const classify = (name: string, signal: AbortSignal) =>
      queue.run(signal, async () => {
        charged.push(name);
        return name;
      });
    const active = await enqueue("active");
    const controllers = [0, 1, 2, 3].map(() => new AbortController());
    const waiting = controllers.map((controller, index) =>
      classify(`waiting-${index}`, controller.signal),
    );
    await expect(
      classify("overflow", new AbortController().signal),
    ).rejects.toBeInstanceOf(ClassificationQueueFull);
    controllers[1]!.abort();
    await expect(waiting[1]).rejects.toThrow();
    const replacement = classify("replacement", new AbortController().signal);
    expect(charged).toEqual([]);

    active.release();
    await Promise.all([waiting[0], waiting[2], waiting[3], replacement]);
    expect(charged).toEqual([
      "waiting-0",
      "waiting-2",
      "waiting-3",
      "replacement",
    ]);
  });

  it("rejects new work after close", async () => {
    await queue.close();

    await expect(
      queue.run(new AbortController().signal, async () => "late"),
    ).rejects.toBeInstanceOf(ClassificationQueueClosed);
  });

  it("rejects work once shutdown begins", async () => {
    const active = await enqueue("active");
    const closing = queue.close();

    await expect(
      queue.run(new AbortController().signal, async () => "late"),
    ).rejects.toBeInstanceOf(ClassificationQueueClosed);
    active.release();
    await closing;
  });

  it("close waits for active work and cancels queued work", async () => {
    const accepted = await fillQueue();
    let closed = false;
    const closing = queue.close().then(() => (closed = true));

    for (const waiting of accepted.slice(1)) {
      await expect(waiting.result).rejects.toBeInstanceOf(
        ClassificationQueueClosed,
      );
    }
    await settle();
    expect(closed).toBe(false);

    accepted[0]!.release();
    await closing;
    await expect(accepted[0]!.result).resolves.toBe("active");
    for (const waiting of accepted.slice(1)) waiting.release();
    await settle();
    expect(ran).toEqual(["active"]);
  });

  it("close waits for an aborted active job to settle", async () => {
    const active = await enqueue("active");
    active.controller.abort();
    await expect(active.result).rejects.toThrow();
    let closed = false;
    const closing = queue.close().then(() => (closed = true));
    await settle();
    expect(closed).toBe(false);

    active.fail(new Error("stage failed during shutdown"));
    await closing;
  });

  it("close is idempotent", async () => {
    await queue.close();
    await queue.close();
  });

  it("concurrent close callers wait for the same shutdown", async () => {
    const active = await enqueue("active");
    const settled: string[] = [];
    const first = queue.close().then(() => settled.push("first"));
    const second = queue.close().then(() => settled.push("second"));
    await settle();
    expect(settled).toEqual([]);

    active.release();
    await Promise.all([first, second]);
    expect(settled).toEqual(["first", "second"]);
  });

  it("awaited stages run before and during shutdown", async () => {
    const events: string[] = [];
    let releaseSecond!: () => void;
    const secondGate = new Promise<void>((resolve) => {
      releaseSecond = resolve;
    });
    const active = queue.run(new AbortController().signal, async () => {
      events.push("first");
      await secondGate;
      events.push("second");
    });
    await settle();
    const cleanup = queue.close().then(() => events.push("clients"));
    await settle();
    expect(events).toEqual(["first"]);

    releaseSecond();
    await Promise.all([active, cleanup]);
    expect(events).toEqual(["first", "second", "clients"]);
  });
});
