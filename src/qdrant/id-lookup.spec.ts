import { readFileSync } from "node:fs";
import { z } from "zod";
import {
  normalizeOriginalIdForLookup,
  originalIdLookupText,
  reverseNormalizedId,
} from "./id-lookup.js";

const goldenSchema = z.object({
  normalize: z.array(z.object({ input: z.string(), normalized: z.string() })),
  payloadIds: z.array(z.object({ json: z.string(), normalized: z.string() })),
  reverse: z.array(z.object({ input: z.string(), reversed: z.string() })),
  nonAsciiFolds: z.array(
    z.object({ codePoint: z.number().int(), normalized: z.string() }),
  ),
});

const golden = goldenSchema.parse(
  JSON.parse(
    readFileSync(
      new URL("../../test/fixtures/golden/id-lookup.json", import.meta.url),
      "utf8",
    ),
  ),
);

describe("ID lookup normalization matches the Python golden fixtures", () => {
  it.each(golden.normalize)(
    "normalizes $input to $normalized",
    ({ input, normalized }) => {
      expect(normalizeOriginalIdForLookup(input)).toBe(normalized);
    },
  );

  it.each(
    golden.payloadIds.filter(
      ({ json }) => originalIdLookupText(JSON.parse(json)) !== undefined,
    ),
  )(
    "normalizes the payload value $json to $normalized",
    ({ json, normalized }) => {
      const text = originalIdLookupText(JSON.parse(json));
      expect(text && normalizeOriginalIdForLookup(text)).toBe(normalized);
    },
  );

  it("refuses only the payload values whose Python str() it cannot reproduce", () => {
    expect(
      golden.payloadIds
        .filter(
          ({ json }) => originalIdLookupText(JSON.parse(json)) === undefined,
        )
        .map(({ json }) => json),
    ).toEqual([
      "0",
      "0.0",
      "-0.0",
      "0.00001",
      "1e16",
      "9007199254740993",
      "1.5e300",
      '["A", 1]',
      '{"a": 1}',
    ]);
  });

  it.each(golden.reverse)(
    "reverses $input to $reversed",
    ({ input, reversed }) => {
      expect(reverseNormalizedId(input)).toBe(reversed);
    },
  );

  it("folds exactly the non-ASCII code points that Python folds to ASCII", () => {
    const expected = new Map(
      golden.nonAsciiFolds.map(({ codePoint, normalized }) => [
        codePoint,
        normalized,
      ]),
    );
    const mismatches: string[] = [];
    for (let codePoint = 0x80; codePoint <= 0x10ffff; codePoint += 1) {
      if (codePoint >= 0xd800 && codePoint <= 0xdfff) continue;
      const actual = normalizeOriginalIdForLookup(
        String.fromCodePoint(codePoint),
      );
      const wanted = expected.get(codePoint) ?? "";
      if (actual !== wanted) {
        mismatches.push(
          `U+${codePoint.toString(16).toUpperCase()}: ${JSON.stringify(actual)} != ${JSON.stringify(wanted)}`,
        );
      }
    }
    expect(mismatches).toEqual([]);
  });
});
