import { z } from "zod";
import { readGolden, sweepMismatches } from "../../test/support/golden.js";
import { isPyUuid } from "./uuid.js";

const golden = readGolden(
  "python-uuid.json",
  z.object({
    uuids: z.array(z.object({ input: z.string(), valid: z.boolean() })),
    validWithLastCharacter: z.record(z.string(), z.literal("1")),
  }),
);

const UUID_HEAD = "23e4567e89b12d3a456426614174000";
const validLastCharacters = new Set(
  Object.keys(golden.validWithLastCharacter).map((hex) => parseInt(hex, 16)),
);

describe("isPyUuid matches uuid.UUID(value)", () => {
  it.each(golden.uuids)("reads $input", ({ input, valid }) => {
    expect(isPyUuid(input)).toBe(valid);
  });

  it("accepts every last character that uuid.UUID accepts", () => {
    expect(
      sweepMismatches(
        (c) => isPyUuid(UUID_HEAD + c),
        (codePoint) => validLastCharacters.has(codePoint),
      ),
    ).toEqual([]);
  });
});
