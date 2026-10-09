import { z } from "zod";
import { readGolden } from "../../test/support/golden.js";
import {
  UnicodeEncodeError,
  quote,
  quotePlus,
  unquote,
  unquotePlus,
  urlencode,
} from "./urllib.js";

const golden = readGolden(
  "python-urllib.json",
  z.object({
    quote: z.array(
      z.object({
        input: z.string(),
        safe: z.string(),
        quoted: z.string().nullable(),
      }),
    ),
    quotePlus: z.array(
      z.object({ input: z.string(), quoted: z.string().nullable() }),
    ),
    unquote: z.record(z.string(), z.string()),
    unquotePlus: z.record(z.string(), z.string()),
    urlencode: z.array(
      z.object({
        pairs: z.array(z.tuple([z.string(), z.string()])),
        encoded: z.string().nullable(),
      }),
    ),
  }),
);

function expectEncoded(encode: () => string, encoded: string | null): void {
  if (encoded === null) expect(encode).toThrow(UnicodeEncodeError);
  else expect(encode()).toBe(encoded);
}

describe("urllib.parse ports match the Python golden fixtures", () => {
  it.each(golden.quote)(
    "quotes $input with safe=$safe",
    ({ input, safe, quoted }) => {
      expectEncoded(() => quote(input, safe), quoted);
    },
  );

  it.each(golden.quotePlus)("quote_plus($input)", ({ input, quoted }) => {
    expectEncoded(() => quotePlus(input), quoted);
  });

  it.each(Object.entries(golden.unquote))("unquotes %s", (input, unquoted) => {
    expect(unquote(input)).toBe(unquoted);
  });

  it.each(Object.entries(golden.unquotePlus))(
    "unquote_plus(%s)",
    (input, unquoted) => {
      expect(unquotePlus(input)).toBe(unquoted);
    },
  );

  it.each(golden.urlencode)("urlencodes $pairs", ({ pairs, encoded }) => {
    expectEncoded(() => urlencode(pairs), encoded);
  });
});
