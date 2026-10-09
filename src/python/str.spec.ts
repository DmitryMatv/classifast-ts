import { z } from "zod";
import {
  codePointRangesSchema,
  codePointSet,
  readGolden,
  sweepMismatches,
  unicodeDrift,
} from "../../test/support/golden.js";
import {
  PY_WHITESPACE,
  PY_WORD,
  codePointLength,
  collapseWhitespace,
  pyIsAlpha,
  pyIsDigit,
  pyRstrip,
  pyStrip,
  sliceCodePoints,
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
    strip: z.array(
      z.object({
        input: z.string(),
        stripped: z.string(),
        rstripped: z.string(),
        splitJoined: z.string(),
      }),
    ),
    stripChars: z.array(
      z.object({
        input: z.string(),
        chars: z.string(),
        stripped: z.string(),
        rstripped: z.string(),
      }),
    ),
    codePoints: z.array(
      z.object({
        input: z.string(),
        length: z.number(),
        firstThree: z.string(),
      }),
    ),
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
  tolerated?: ReadonlySet<number>,
): void {
  const set = codePointSet(ranges);
  expect(
    sweepMismatches(matches, (codePoint) => set[codePoint] === 1, tolerated),
  ).toEqual([]);
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
    expectClassMatches(
      (c) => /^\p{Cased}$/u.test(c),
      golden.casedRanges,
      unicodeDrift(),
    );
    expectClassMatches(
      (c) => /^\p{Case_Ignorable}$/u.test(c),
      golden.caseIgnorableRanges,
      unicodeDrift(),
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
        unicodeDrift(),
      ),
    ).toEqual([]);
  });

  it("titlecase matches the str.title() mapping of every code point", () => {
    expect(
      sweepMismatches(
        titlecase,
        (codePoint) => {
          return (
            title.get(codePoint) ??
            upper.get(codePoint) ??
            String.fromCodePoint(codePoint)
          );
        },
        unicodeDrift(),
      ),
    ).toEqual([]);
  });

  it.each(golden.title)("titles $input as $title", ({ input, title }) => {
    expect(pyTitle(input)).toBe(title);
  });

  it.each(golden.upper)("uppercases $input", ({ input, upper }) => {
    expect(input.toUpperCase()).toBe(upper);
  });
});

describe("strip, rstrip and split", () => {
  it.each(golden.strip)(
    "strips $input",
    ({ input, stripped, rstripped, splitJoined }) => {
      expect(pyStrip(input)).toBe(stripped);
      expect(pyRstrip(input)).toBe(rstripped);
      expect(collapseWhitespace(input)).toBe(splitJoined);
    },
  );

  it.each(golden.stripChars)(
    "strips $chars from $input",
    ({ input, chars, stripped, rstripped }) => {
      expect(pyStrip(input, chars)).toBe(stripped);
      expect(pyRstrip(input, chars)).toBe(rstripped);
    },
  );
});

describe("len() and slicing", () => {
  it.each(golden.codePoints)(
    "counts and slices $input",
    ({ input, length, firstThree }) => {
      expect(codePointLength(input)).toBe(length);
      expect(sliceCodePoints(input, 3)).toBe(firstThree);
    },
  );
});
