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
});
