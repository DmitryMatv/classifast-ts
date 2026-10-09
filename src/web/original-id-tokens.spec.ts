import { z } from "zod";
import { readGolden } from "../../test/support/golden.js";
import { groupOriginalIdTokens } from "./original-id-tokens.js";

const golden = readGolden(
  "original-id-tokens.json",
  z.object({
    tokens: z.array(
      z.object({
        input: z.union([z.string(), z.number(), z.boolean(), z.null()]),
        chars: z.array(z.string()),
        gapsAfter: z.array(z.number().int()),
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
  });
});
