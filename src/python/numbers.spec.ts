import { z } from "zod";
import { readGolden, sweepMismatches } from "../../test/support/golden.js";
import { pyFloat, pyFormatFixed, pyInt, pyRound } from "./numbers.js";

const golden = readGolden(
  "python-numbers.json",
  z.object({
    parse: z.array(
      z.object({
        input: z.string(),
        int: z.string().nullable(),
        float: z.string().nullable(),
      }),
    ),
    intSuffixValues: z.record(z.string(), z.string()),
    round: z.array(
      z.object({
        value: z.number(),
        round4: z.number(),
        round2: z.number(),
        fixed2: z.string(),
      }),
    ),
    nonFinite: z.array(
      z.object({ repr: z.string(), round4: z.string(), fixed2: z.string() }),
    ),
  }),
);

function fromRepr(repr: string | null): number | undefined {
  if (repr === null) return undefined;
  if (repr === "nan") return NaN;
  if (repr.endsWith("inf")) return repr.startsWith("-") ? -Infinity : Infinity;
  return Number(repr);
}

const intSuffixValues = new Map(
  Object.entries(golden.intSuffixValues).map(([hex, value]) => [
    parseInt(hex, 16),
    BigInt(value),
  ]),
);

describe("pyInt and pyFloat match int() and float()", () => {
  it.each(golden.parse)("parses $input", (testCase) => {
    expect(pyInt(testCase.input)).toBe(
      testCase.int === null ? undefined : BigInt(testCase.int),
    );
    expect(pyFloat(testCase.input)).toBe(fromRepr(testCase.float));
  });

  it("reads every code point after a digit as int() does", () => {
    expect(
      sweepMismatches(
        (c) => pyInt(`1${c}`),
        (codePoint) => intSuffixValues.get(codePoint),
      ),
    ).toEqual([]);
  });
});

describe("pyInt and pyFloat take linear time on adversarial input", () => {
  const length = 100_000;
  it.each([
    ["spaces before a trailing letter", `1${" ".repeat(length)}x`],
    ["digits before a trailing letter", `${"1".repeat(length)}x`],
  ])("rejects %s within 100 ms", (_, input) => {
    const start = performance.now();
    expect(pyInt(input)).toBeUndefined();
    expect(pyFloat(input)).toBeUndefined();
    expect(performance.now() - start).toBeLessThan(100);
  });
});

describe("pyRound and pyFormatFixed match round() and %.2f", () => {
  it.each(golden.round)(
    "rounds $value",
    ({ value, round4, round2, fixed2 }) => {
      expect(pyRound(value, 4)).toBe(round4);
      expect(pyRound(value, 2)).toBe(round2);
      expect(pyFormatFixed(value, 2)).toBe(fixed2);
    },
  );

  it.each(golden.nonFinite)("rounds $repr", ({ repr, round4, fixed2 }) => {
    expect(pyRound(fromRepr(repr)!, 4)).toBe(fromRepr(round4));
    expect(pyFormatFixed(fromRepr(repr)!, 2)).toBe(fixed2);
  });

  it.each([-1, 0.5, NaN])("rejects %s digits for every value", (digits) => {
    for (const value of [0, 1.5, NaN]) {
      expect(() => pyRound(value, digits)).toThrow(
        `pyRound supports only non-negative integer digits, got ${digits}`,
      );
      expect(() => pyFormatFixed(value, digits)).toThrow(
        `pyFormatFixed supports only non-negative integer digits, got ${digits}`,
      );
    }
  });
});
