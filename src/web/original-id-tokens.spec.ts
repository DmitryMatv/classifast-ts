import { z } from "zod";
import { readGolden } from "../../test/support/golden.js";
import { groupOriginalIdTokens } from "./original-id-tokens.js";

const tokenOutputSchema = z.object({
  chars: z.array(z.string()),
  gapsAfter: z.array(z.number().int()),
});

const golden = readGolden(
  "original-id-tokens.json",
  z.object({
    tokens: z.array(
      tokenOutputSchema.extend({
        input: z.union([z.string(), z.number(), z.boolean(), z.null()]),
      }),
    ),
    sourceLoss: z.array(
      z.object({
        inputJson: z.string(),
        source: tokenOutputSchema,
        parsedInteger: tokenOutputSchema,
      }),
    ),
  }),
);

describe("groupOriginalIdTokens matches group_original_id_tokens", () => {
  it.each(golden.tokens)("groups $input", ({ input, chars, gapsAfter }) => {
    const tokens = groupOriginalIdTokens(input);
    expect(tokens.map(({ char }) => char)).toEqual(chars);
    expect(
      tokens.flatMap(({ gapAfter }, index) => (gapAfter ? [index] : [])),
    ).toEqual(gapsAfter);
    for (const { char } of tokens) {
      expect(Array.from(char)).toHaveLength(1);
    }
  });
});

describe("groupOriginalIdTokens parsed-scalar policy", () => {
  it.each(golden.sourceLoss)(
    "treats parsed $inputJson as an integer ID",
    ({ inputJson, source, parsedInteger }) => {
      const input: unknown = JSON.parse(inputJson);
      const tokens = groupOriginalIdTokens(input);
      expect(source.chars.join("")).toBe(inputJson);
      expect(tokens.map(({ char }) => char)).toEqual(parsedInteger.chars);
      expect(
        tokens.flatMap(({ gapAfter }, index) => (gapAfter ? [index] : [])),
      ).toEqual(parsedInteger.gapsAfter);
      for (const { char } of tokens) {
        expect(Array.from(char)).toHaveLength(1);
      }
    },
  );

  it.each([
    { name: "undefined", input: undefined },
    { name: "array", input: [] },
    { name: "nested array", input: ["A", ["12"]] },
    { name: "object", input: { id: 12 } },
    { name: "bigint", input: 12n },
    { name: "symbol", input: Symbol("12") },
    { name: "function", input: () => "12" },
  ])("rejects $name with TypeError", ({ input }) => {
    expect(() => groupOriginalIdTokens(input)).toThrow(TypeError);
  });

  it.each([
    { name: "negative zero", input: -0 },
    { name: "NaN", input: NaN },
    { name: "positive infinity", input: Infinity },
    { name: "negative infinity", input: -Infinity },
    { name: "positive unsafe integer", input: 9007199254740992 },
    { name: "negative unsafe integer", input: -9007199254740992 },
    { name: "positive upper limit", input: 1e16 },
    { name: "negative upper limit", input: -1e16 },
    {
      name: "positive fraction below the decimal window",
      input: 0.00009999999999999999,
    },
    {
      name: "negative fraction below the decimal window",
      input: -0.00009999999999999999,
    },
    { name: "positive exponent fraction", input: 1e-7 },
    { name: "negative exponent fraction", input: -1e-7 },
    { name: "smallest positive fraction", input: Number.MIN_VALUE },
    { name: "smallest negative fraction", input: -Number.MIN_VALUE },
  ])("rejects $name with RangeError", ({ input }) => {
    expect(() => groupOriginalIdTokens(input)).toThrow(RangeError);
  });
});
