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

// Python's repr of a float, which Number() reads except for inf and nan.
function fromRepr(repr: string | null): number | undefined {
  if (repr === null) return undefined;
  if (repr === "nan") return NaN;
  if (repr.endsWith("inf")) return repr.startsWith("-") ? -Infinity : Infinity;
  return Number(repr);
}

const intSuffixValues = new Map(
  Object.entries(golden.intSuffixValues).map(([hex, value]) => [
    parseInt(hex, 16),
    Number(value),
  ]),
);

describe("pyInt and pyFloat match int() and float()", () => {
  it.each(golden.parse)("parses $input", (testCase) => {
    expect(pyInt(testCase.input)).toBe(fromRepr(testCase.int));
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
});
