import { HttpException } from "@nestjs/common";
import {
  ClassificationQueue,
  QUEUE_CAPACITY,
} from "../classifier/classification-queue.js";
import type {
  ClassificationOutcome,
  ClassificationService,
} from "../classifier/classification-service.js";
import { buildClassifierConfig } from "../classifier/classifier-config.js";
import {
  QuotaUnavailableError,
  type Caller,
  type Quota,
  type UsageStatus,
} from "../usage/quota.js";
import {
  classifyFragment,
  parseFragmentQuery,
  resolveFragmentPushUrl,
  type FragmentDeps,
  type FragmentOutcome,
} from "./fragment-delivery.js";

const UNSPSC = buildClassifierConfig({}).UNSPSC!;
const [versionName] = Object.keys(UNSPSC.versions);
const LIMIT = 3;

function settle(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function callerKey(caller: Caller): string {
  return caller.kind === "anonymous"
    ? `anon:${caller.trackingId}`
    : `user:${caller.userId}`;
}

/**
 * A Redis-like usage ledger. The charge of `hold` waits for `release`, so
 * that request keeps the only classification turn.
 */
class Ledger implements Pick<Quota, "check" | "charge"> {
  readonly counts = new Map<string, number>();
  readonly charged: string[] = [];
  readonly holdStarted = deferred();
  readonly release = deferred();

  constructor(private readonly hold?: string) {}

  #status(caller: Caller, count: number, allowed: boolean): UsageStatus {
    if (caller.kind === "pro") throw new Error("no Pro callers here");
    return {
      kind: "metered",
      allowed,
      remaining: Math.max(0, LIMIT - count),
      limit: LIMIT,
      caller,
    };
  }

  check(caller: Caller): Promise<UsageStatus> {
    const count = this.counts.get(callerKey(caller)) ?? 0;
    return Promise.resolve(this.#status(caller, count, count < LIMIT));
  }

  async charge(caller: Caller): Promise<UsageStatus> {
    const key = callerKey(caller);
    this.charged.push(key);
    if (key === `anon:${this.hold}`) {
      this.holdStarted.resolve();
      await this.release.promise;
    }
    const count = (this.counts.get(key) ?? 0) + 1;
    this.counts.set(key, count);
    return this.#status(caller, count, count <= LIMIT);
  }
}

interface Harness {
  readonly ledger: Ledger;
  readonly ran: string[];
  readonly submit: (
    query: string,
    overrides?: Partial<FragmentDeps>,
  ) => {
    readonly result: Promise<FragmentOutcome>;
    readonly controller: AbortController;
  };
}

// The classification turn as ClassificationService takes it: queue
// admission, then `authorize`, then the pipeline.
function harness(ledger: Ledger): Harness {
  const queue = new ClassificationQueue();
  const ran: string[] = [];
  const classify: ClassificationService["classify"] = (
    signal,
    request,
    authorize,
  ) =>
    queue.run(signal, async (turnSignal) => {
      await authorize?.();
      turnSignal.throwIfAborted();
      ran.push(request.query);
      return {
        results: [],
        versionName: versionName!,
        version: UNSPSC.versions[versionName!]!,
        query: request.query,
        elapsedSeconds: 0,
        rerank: "applied",
      } satisfies ClassificationOutcome;
    });
  return {
    ledger,
    ran,
    submit: (query, overrides = {}) => {
      const controller = new AbortController();
      const deps: FragmentDeps = {
        isVerifiedCrawler: () => Promise.resolve(false),
        resolveCaller: () =>
          Promise.resolve({
            kind: "anonymous",
            trackingId: query,
            ipHash: "ip",
          }),
        quota: ledger,
        classify,
        ...overrides,
      };
      const result = classifyFragment(
        deps,
        { query, classifierType: "UNSPSC", topK: 10 },
        controller.signal,
      );
      return { result, controller };
    },
  };
}

const kinds = (outcomes: FragmentOutcome[]) => outcomes.map((o) => o.kind);

describe("classifyFragment ordering (ports of tests/test_classification_queue.py)", () => {
  it("charges inside the turn, in arrival order, and never charges an overflowed request", async () => {
    const { ledger, ran, submit } = harness(new Ledger("active"));
    const active = submit("active");
    await ledger.holdStarted.promise;
    const waiting = [0, 1, 2, 3].map((index) => submit(`gate-${index}`));
    await settle();

    expect(await submit("overflow").result).toEqual({
      kind: "queue-full",
      message: "Classification queue is full. Please try again later.",
    });
    expect(ledger.charged).toEqual(["anon:active"]);
    expect(ran).toEqual([]);

    ledger.release.resolve();
    const outcomes = await Promise.all(
      [active, ...waiting].map(({ result }) => result),
    );
    const expected = ["active", "gate-0", "gate-1", "gate-2", "gate-3"];
    expect(kinds(outcomes)).toEqual(Array(QUEUE_CAPACITY).fill("results"));
    expect(ran).toEqual(expected);
    expect(ledger.charged).toEqual(expected.map((query) => `anon:${query}`));
    expect(ledger.counts.has("anon:overflow")).toBe(false);
  });

  it.each([
    [
      "anonymous",
      { kind: "anonymous", trackingId: "exhausted", ipHash: "ip" },
      "anon:exhausted",
    ],
    ["signed-in", { kind: "free", userId: "user-1" }, "user:user-1"],
  ] as const)(
    "gives an exhausted %s caller the paywall without a queue slot or a charge",
    async (_, caller, key) => {
      const { ledger, ran, submit } = harness(new Ledger("active"));
      ledger.counts.set(key, LIMIT);
      const active = submit("active");
      await ledger.holdStarted.promise;
      const waiting = [0, 1, 2, 3].map((index) => submit(`gate-${index}`));
      await settle();

      const paywall = await submit("exhausted", {
        resolveCaller: () => Promise.resolve(caller),
      }).result;
      expect(paywall).toEqual({
        kind: "paywall",
        usage: {
          kind: "metered",
          allowed: false,
          remaining: 0,
          limit: LIMIT,
          caller,
        },
      });

      ledger.release.resolve();
      const outcomes = await Promise.all(
        [active, ...waiting].map(({ result }) => result),
      );
      expect(kinds(outcomes)).toEqual(Array(QUEUE_CAPACITY).fill("results"));
      expect(ran).toEqual(["active", "gate-0", "gate-1", "gate-2", "gate-3"]);
      expect(ledger.charged).not.toContain(key);
      expect(ledger.counts.get(key)).toBe(LIMIT);
    },
  );

  it.each(["crawler", "clerk"] as const)(
    "does not hold the queue turn during a slow %s check",
    async (slow) => {
      const { ran, submit } = harness(new Ledger());
      const started = deferred();
      const finish = deferred<boolean>();
      const wait = <T>(value: T) => {
        started.resolve();
        return finish.promise.then(() => value);
      };
      const slowRequest = submit(
        "slow",
        slow === "crawler"
          ? { isVerifiedCrawler: () => wait(true) }
          : {
              resolveCaller: () =>
                wait<Caller>({ kind: "free", userId: "user-1" }),
            },
      );
      await started.promise;

      expect((await submit("visitor").result).kind).toBe("results");
      expect(ran).toEqual(["visitor"]);

      finish.resolve(true);
      expect((await slowRequest.result).kind).toBe("results");
      expect(ran).toEqual(["visitor", "slow"]);
    },
  );

  it("never charges a cancelled waiting request and reuses its slot", async () => {
    const { ledger, ran, submit } = harness(new Ledger("active"));
    const active = submit("active");
    await ledger.holdStarted.promise;
    const waiting = [0, 1, 2, 3].map((index) => submit(`gate-${index}`));
    await settle();

    waiting[1]!.controller.abort();
    expect((await waiting[1]!.result).kind).toBe("error");
    const replacement = submit("replacement");
    await settle();
    expect((await submit("overflow").result).kind).toBe("queue-full");
    expect(ledger.charged).toEqual(["anon:active"]);

    ledger.release.resolve();
    const outcomes = await Promise.all(
      [active, waiting[0]!, waiting[2]!, waiting[3]!, replacement].map(
        ({ result }) => result,
      ),
    );
    const expected = ["active", "gate-0", "gate-2", "gate-3", "replacement"];
    expect(kinds(outcomes)).toEqual(Array(QUEUE_CAPACITY).fill("results"));
    expect(ran).toEqual(expected);
    expect(ledger.charged).toEqual(expected.map((query) => `anon:${query}`));
    expect(ledger.counts.has("anon:gate-1")).toBe(false);
  });

  it("does not enter the queue when the client left during the quota check", async () => {
    const { ledger, ran, submit } = harness(new Ledger());
    const checked = deferred();
    const finish = deferred();
    const request = submit("gone", {
      quota: {
        check: async (caller) => {
          checked.resolve();
          await finish.promise;
          return ledger.check(caller);
        },
        charge: (caller) => ledger.charge(caller),
      },
    });
    await checked.promise;
    request.controller.abort();
    finish.resolve();

    expect((await request.result).kind).toBe("error");
    expect(ran).toEqual([]);
    expect(ledger.charged).toEqual([]);
  });

  it("reports a denied charge as the paywall and a failed one as unavailable", async () => {
    const { ledger, ran, submit } = harness(new Ledger());
    const denied = await submit("raced", {
      quota: {
        check: (caller) => ledger.check(caller),
        charge: (caller) => {
          ledger.counts.set(callerKey(caller), LIMIT);
          return ledger.charge(caller);
        },
      },
    }).result;
    expect(denied).toMatchObject({
      kind: "paywall",
      usage: { allowed: false, remaining: 0 },
    });

    const failed = await submit("redis-down", {
      quota: {
        check: (caller) => ledger.check(caller),
        charge: () => Promise.reject(new QuotaUnavailableError()),
      },
    }).result;
    expect(failed).toEqual({
      kind: "quota-unavailable",
      message: "Usage tracking is temporarily unavailable",
    });
    expect(ran).toEqual([]);
  });
});

describe("parseFragmentQuery", () => {
  it("reads the last value of each parameter", () => {
    expect(
      parseFragmentQuery([
        ["product_description", "a"],
        ["product_description", "b"],
        ["top_k", "10"],
        ["top_k", "+7"],
        ["push_url", "YES"],
        ["url_change", "off"],
        ["version", "v"],
        ["enhance_query", "1"],
      ]),
    ).toEqual({
      productDescription: "b",
      topK: 7,
      version: "v",
      pushUrl: true,
      urlChange: false,
      enhanceQuery: "1",
    });
  });

  it("lists every invalid parameter in FastAPI's 422 body", () => {
    let error: unknown;
    try {
      parseFragmentQuery([
        ["top_k", "101"],
        ["url_change", ""],
      ]);
    } catch (thrown) {
      error = thrown;
    }
    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getStatus()).toBe(422);
    expect((error as HttpException).getResponse()).toEqual({
      detail: [
        {
          type: "missing",
          loc: ["query", "product_description"],
          msg: "Field required",
          input: null,
        },
        {
          type: "less_than_equal",
          loc: ["query", "top_k"],
          msg: "Input should be less than or equal to 100",
          input: "101",
          ctx: { le: 100 },
        },
        {
          type: "bool_parsing",
          loc: ["query", "url_change"],
          msg: "Input should be a valid boolean, unable to interpret input",
          input: "",
        },
      ],
    });
  });
});

describe("resolveFragmentPushUrl", () => {
  it.each([
    [undefined, undefined, true],
    [undefined, false, false],
    [true, false, true],
    [false, true, false],
  ])("push_url=%s url_change=%s pushes %s", (pushUrl, urlChange, pushes) => {
    expect(resolveFragmentPushUrl(pushUrl, urlChange)).toBe(pushes);
  });
});
