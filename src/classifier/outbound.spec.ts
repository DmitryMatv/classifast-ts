import { timeoutMilliseconds } from "./outbound.js";

describe("timeoutMilliseconds", () => {
  it("rounds down so the request never outlasts the budget", () => {
    expect(timeoutMilliseconds(5989.834)).toBe(5989);
    expect(timeoutMilliseconds(100)).toBe(100);
  });

  it("keeps at least 1 ms while any budget remains", () => {
    expect(timeoutMilliseconds(0.4)).toBe(1);
  });
});
