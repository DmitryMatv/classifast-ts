import { z } from "zod";
import {
  codePointRangesSchema,
  codePointSet,
  readGolden,
  sweepMismatches,
} from "../../test/support/golden.js";
import {
  PY_WHITESPACE,
  PY_WORD,
  pyIsAlpha,
  pyIsDigit,
  pyStrip,
  pyTitle,
  titlecase,
} from "./str.js";

const golden = readGolden(
  "python-str.json",
  z.object({
    whitespaceRanges: codePointRangesSchema,
    wordRanges: codePointRangesSchema,
    decimalRanges: codePointRangesSchema,
    alphaRanges: codePointRangesSchema,
    digitRanges: codePointRangesSchema,
    casedRanges: codePointRangesSchema,
    caseIgnorableRanges: codePointRangesSchema,
    upperMappings: z.record(z.string(), z.string()),
    titleMappings: z.record(z.string(), z.string()),
    title: z.array(z.object({ input: z.string(), title: z.string() })),
    upper: z.array(z.object({ input: z.string(), upper: z.string() })),
    strip: z.array(z.object({ input: z.string(), stripped: z.string() })),
  }),
);

function byCodePoint(mappings: Record<string, string>): Map<number, string> {
  return new Map(
    Object.entries(mappings).map(([hex, value]) => [parseInt(hex, 16), value]),
  );
}

function expectClassMatches(
  matches: (character: string) => boolean,
  ranges: readonly string[],
): void {
  const set = codePointSet(ranges);
  expect(sweepMismatches(matches, (codePoint) => set[codePoint] === 1)).toEqual(
    [],
  );
}

describe("Python character classes", () => {
  it("whitespace matches str.isspace(), re \\s and str.strip()", () => {
    const whitespace = new RegExp(`^[${PY_WHITESPACE}]$`, "u");
    expectClassMatches((c) => whitespace.test(c), golden.whitespaceRanges);
  });

  it("word characters match re \\w", () => {
    const word = new RegExp(`^[${PY_WORD}]$`, "u");
    expectClassMatches((c) => word.test(c), golden.wordRanges);
  });

  it("\\p{Nd} matches re \\d", () => {
    expectClassMatches((c) => /^\p{Nd}$/u.test(c), golden.decimalRanges);
  });

  it("pyIsAlpha matches str.isalpha()", () => {
    expectClassMatches(pyIsAlpha, golden.alphaRanges);
  });

  it("pyIsDigit matches str.isdigit()", () => {
    expectClassMatches(pyIsDigit, golden.digitRanges);
  });

  it("\\p{Cased} and \\p{Case_Ignorable} match the properties str.title() reads", () => {
    expectClassMatches((c) => /^\p{Cased}$/u.test(c), golden.casedRanges);
    expectClassMatches(
      (c) => /^\p{Case_Ignorable}$/u.test(c),
      golden.caseIgnorableRanges,
    );
  });
});

describe("Python case mappings", () => {
  const upper = byCodePoint(golden.upperMappings);
  const title = byCodePoint(golden.titleMappings);

  it("toUpperCase matches str.upper() on every code point", () => {
    expect(
      sweepMismatches(
        (c) => c.toUpperCase(),
        (codePoint) => upper.get(codePoint) ?? String.fromCodePoint(codePoint),
      ),
    ).toEqual([]);
  });

  it("titlecase matches the str.title() mapping of every code point", () => {
    expect(
      sweepMismatches(titlecase, (codePoint) => {
        return (
          title.get(codePoint) ??
          upper.get(codePoint) ??
          String.fromCodePoint(codePoint)
        );
      }),
    ).toEqual([]);
  });

  it.each(golden.title)("titles $input as $title", ({ input, title }) => {
    expect(pyTitle(input)).toBe(title);
  });

  it.each(golden.upper)("uppercases $input", ({ input, upper }) => {
    expect(input.toUpperCase()).toBe(upper);
  });
});

describe("pyStrip", () => {
  it.each(golden.strip)("strips $input", ({ input, stripped }) => {
    expect(pyStrip(input)).toBe(stripped);
  });
});
