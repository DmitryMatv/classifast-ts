import { FakeClock } from "../../test/support/fake-http.js";
import {
  HttpStatusError,
  fetchJson,
  isTransientHttpError,
  timeoutMilliseconds,
  withRetry,
} from "./outbound.js";

describe("timeoutMilliseconds", () => {
  it("rounds down so the request never outlasts the budget", () => {
    expect(timeoutMilliseconds(5989.834)).toBe(5989);
    expect(timeoutMilliseconds(100)).toBe(100);
  });
});

describe("fetchJson with an exhausted budget", () => {
  it.each([0.4, 0, -0.4])(
    "makes no request for a %s ms budget and fails like a timeout",
    async (budgetMs) => {
      const fetchFn = vi.fn<typeof fetch>();

      await expect(
        fetchJson(
          fetchFn,
          "https://example.test",
          {},
          budgetMs,
          new AbortController().signal,
        ),
      ).rejects.toMatchObject({ name: "TimeoutError" });
      expect(fetchFn).not.toHaveBeenCalled();
    },
  );
});

describe("withRetry with a budget", () => {
  class DelayedClock extends FakeClock {
    constructor(private readonly delayMs: number) {
      super();
    }

    override async sleep(ms: number, signal: AbortSignal): Promise<void> {
      await super.sleep(ms, signal);
      this.advance(this.delayMs);
    }
  }

  function retryFailing503(maxSeconds: number) {
    const clock = new FakeClock();
    const attempt = vi.fn(async () => {
      clock.advance(500);
      throw new HttpStatusError(503, "https://example.test");
    });
    const result = withRetry(attempt, isTransientHttpError, {
      clock,
      signal: new AbortController().signal,
      maxSeconds,
    });
    return { result, attempt, clock };
  }

  it("does not wait past the budget to start another attempt", async () => {
    const { result, attempt, clock } = retryFailing503(1);

    await expect(result).rejects.toThrow("HTTP 503");
    expect(attempt).toHaveBeenCalledTimes(1);
    expect(clock.sleeps).toEqual([]);
  });

  it("retries when the wait ends inside the budget", async () => {
    const { result, attempt, clock } = retryFailing503(1.6);

    await expect(result).rejects.toThrow("HTTP 503");
    expect(attempt).toHaveBeenCalledTimes(2);
    expect(clock.sleeps).toEqual([1000]);
  });

  it.each([100, 101])(
    "does not retry when sleep wakes %s ms late at or past the deadline",
    async (delayMs) => {
      const clock = new DelayedClock(delayMs);
      const error = new HttpStatusError(503, "https://example.test");
      const attempt = vi
        .fn<() => Promise<string>>()
        .mockRejectedValueOnce(error)
        .mockResolvedValue("retry");
      const result = withRetry(attempt, isTransientHttpError, {
        clock,
        signal: new AbortController().signal,
        maxSeconds: 1.1,
      });

      await expect(result).rejects.toBe(error);
      expect(attempt).toHaveBeenCalledTimes(1);
      expect(clock.sleeps).toEqual([1000]);
    },
  );

  it("retries when a delayed sleep wakes one millisecond before the deadline", async () => {
    const clock = new DelayedClock(99);
    const attempt = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new HttpStatusError(503, "https://example.test"))
      .mockResolvedValue("retry");
    const result = withRetry(attempt, isTransientHttpError, {
      clock,
      signal: new AbortController().signal,
      maxSeconds: 1.1,
    });

    await expect(result).resolves.toBe("retry");
    expect(attempt).toHaveBeenCalledTimes(2);
    expect(clock.sleeps).toEqual([1000]);
  });

  it("retries after a delayed sleep when no budget is set", async () => {
    const clock = new DelayedClock(10_000);
    const attempt = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new HttpStatusError(503, "https://example.test"))
      .mockResolvedValue("retry");
    const result = withRetry(attempt, isTransientHttpError, {
      clock,
      signal: new AbortController().signal,
    });

    await expect(result).resolves.toBe("retry");
    expect(attempt).toHaveBeenCalledTimes(2);
    expect(clock.sleeps).toEqual([1000]);
  });

  it("preserves cancellation from sleep without starting another attempt", async () => {
    const clock = new FakeClock();
    const controller = new AbortController();
    const error = new DOMException("The operation was aborted.", "AbortError");
    vi.spyOn(clock, "sleep").mockImplementation(async (_ms, signal) => {
      controller.abort(error);
      signal.throwIfAborted();
    });
    const attempt = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new HttpStatusError(503, "https://example.test"))
      .mockResolvedValue("retry");
    const result = withRetry(attempt, isTransientHttpError, {
      clock,
      signal: controller.signal,
      maxSeconds: 1.1,
    });

    await expect(result).rejects.toBe(error);
    expect(attempt).toHaveBeenCalledTimes(1);
  });
});
