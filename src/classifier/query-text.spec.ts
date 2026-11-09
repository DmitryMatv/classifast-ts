import { z } from "zod";
import {
  codePointRangesSchema,
  codePointSet,
  readGolden,
  sweepMismatches,
} from "../../test/support/golden.js";
import {
  isCodeLike,
  normalizeProductDescription,
  sanitizeQueryText,
  sanitizeSearchText,
  type QueryValidation,
} from "./query-text.js";

const sanitizeCase = z.union([
  z.object({ input: z.string(), query: z.string() }),
  z.object({ input: z.string(), detail: z.string() }),
]);

const golden = readGolden(
  "query-text.json",
  z.object({
    sanitize: z.array(sanitizeCase),
    sanitizeForSearch: z.array(sanitizeCase),
    sanitizeAcceptedRanges: codePointRangesSchema,
    searchKeptRanges: codePointRangesSchema,
    normalizeProductDescription: z.array(
      z.object({ input: z.string(), normalized: z.string() }),
    ),
    isCodeLike: z.array(z.object({ input: z.string(), codeLike: z.boolean() })),
    codeLikeLetterRanges: codePointRangesSchema,
    codeLikeDigitRanges: codePointRangesSchema,
  }),
);

function expectedValidation(
  testCase: z.infer<typeof sanitizeCase>,
): QueryValidation {
  return "query" in testCase
    ? { kind: "valid", query: testCase.query }
    : { kind: "invalid", detail: testCase.detail };
}

function expectSweep(
  matches: (character: string) => boolean,
  ranges: readonly string[],
): void {
  const set = codePointSet(ranges);
  expect(sweepMismatches(matches, (codePoint) => set[codePoint] === 1)).toEqual(
    [],
  );
}

describe("sanitizeQueryText matches sanitize_query_text", () => {
  it.each(golden.sanitize)("sanitizes $input", (testCase) => {
    expect(sanitizeQueryText(testCase.input)).toEqual(
      expectedValidation(testCase),
    );
  });

  // Decided divergence: Python refused `$`, `^`, `|` and everything outside
  // the Basic Multilingual Plane. The port refuses only non-whitespace
  // control characters and lone surrogates.
  it("accepts every character Python accepts between two letters", () => {
    const pythonAccepted = codePointSet(golden.sanitizeAcceptedRanges);
    expect(
      sweepMismatches(
        (c) =>
          isValidBetweenLetters(c) || pythonAccepted[c.codePointAt(0)!] !== 1,
        () => true,
      ),
    ).toEqual([]);
  });

  it("refuses only control characters and lone surrogates between two letters", () => {
    expectSweep((c) => !isValidBetweenLetters(c), REFUSED_RANGES);
  });
});

// Python's whitespace (U+0009-U+000D, U+001C-U+001F, U+0085) collapses to a
// space before the check, so those controls pass.
const REFUSED_RANGES = [
  "0000-0008",
  "000E-001B",
  "007F-0084",
  "0086-009F",
  "D800-DFFF",
];

function isValidBetweenLetters(character: string): boolean {
  return sanitizeQueryText(`a${character}b`).kind === "valid";
}

describe("sanitizeSearchText matches sanitize_query_text(for_search=True)", () => {
  it.each(golden.sanitizeForSearch)(
    "sanitizes $input for search",
    (testCase) => {
      expect(sanitizeSearchText(testCase.input)).toEqual(
        expectedValidation(testCase),
      );
    },
  );

  it("keeps exactly the characters Python keeps between two letters", () => {
    expectSweep((c) => {
      const result = sanitizeSearchText(`a${c}b`);
      return result.kind === "valid" && result.query === `a${c}b`;
    }, golden.searchKeptRanges);
  });
});

describe("normalizeProductDescription", () => {
  it.each(golden.normalizeProductDescription)(
    "normalizes $input",
    ({ input, normalized }) => {
      expect(normalizeProductDescription(input)).toBe(normalized);
    },
  );
});

describe("isCodeLike matches query_enhancer._is_code_like", () => {
  it.each(golden.isCodeLike)("$input is code-like: $codeLike", (testCase) => {
    expect(isCodeLike(testCase.input)).toBe(testCase.codeLike);
  });

  it("treats the same characters as code letters and digits", () => {
    expectSweep((c) => isCodeLike(`${c}1234`), golden.codeLikeLetterRanges);
    expectSweep((c) => isCodeLike(`abcd${c}`), golden.codeLikeDigitRanges);
  });
});
