import { ORIGIN, T0 } from "../../../test/support/classifier-fixtures.js";
import { readStoredPaywall, storedPaywallWrites } from "./paywall-machine.js";

const COFFEE = `${ORIGIN}/NAICS/coffee/?top_k=30`;
const RETURN_PAGE = `${ORIGIN}/NAICS/industrial_pump/?checkout=success`;

describe("paywall storage", () => {
  it("reads the records paywall.ts wrote", () => {
    const written = new Map([
      ["classifast:upgrade-intent", COFFEE],
      [
        "classifast:checkout-recovery",
        JSON.stringify({ returnUrl: RETURN_PAGE, deadline: T0 }),
      ],
    ]);
    expect(readStoredPaywall((key) => written.get(key) ?? null)).toEqual({
      upgradeIntent: COFFEE,
      activation: { returnUrl: RETURN_PAGE, deadline: T0 },
    });
  });

  it.each([
    "not json",
    "null",
    '{"returnUrl":"http://localhost:3000/"}',
    '{"returnUrl":"http://localhost:3000/","deadline":"1"}',
    '{"returnUrl":"http://localhost:3000/","deadline":1e999}',
  ])("ignores the activation record %s", (raw) => {
    expect(
      readStoredPaywall((key) =>
        key === "classifast:checkout-recovery" ? raw : null,
      ),
    ).toEqual({ upgradeIntent: null, activation: null });
  });

  it("writes the records in the shape paywall.ts reads", () => {
    expect(
      storedPaywallWrites({
        upgradeIntent: COFFEE,
        activation: { returnUrl: RETURN_PAGE, deadline: T0 },
      }),
    ).toEqual([
      ["classifast:upgrade-intent", COFFEE],
      [
        "classifast:checkout-recovery",
        `{"returnUrl":"${RETURN_PAGE}","deadline":${T0}}`,
      ],
    ]);
    expect(
      storedPaywallWrites({ upgradeIntent: null, activation: null }),
    ).toEqual([
      ["classifast:upgrade-intent", null],
      ["classifast:checkout-recovery", null],
    ]);
    expect(storedPaywallWrites({})).toEqual([]);
  });
});
