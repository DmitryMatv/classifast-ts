import { fetchJson, timeoutMilliseconds } from "./outbound.js";

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
