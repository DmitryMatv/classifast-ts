import { z } from "zod";
import { readGolden } from "../../test/support/golden.js";
import {
  canonicalQuery,
  isSuspiciousRequestUrl,
  parseQueryString,
} from "./request-url.js";

const golden = readGolden(
  "request-url.json",
  z.object({
    queries: z.array(
      z.union([
        z.object({
          query: z.string(),
          items: z.array(z.tuple([z.string(), z.string()])),
          canonicalQuery: z.string().nullable(),
        }),
        z.object({
          query: z.string(),
          items: z.array(z.tuple([z.string(), z.string()])),
          pythonError: z.literal("UnicodeDecodeError"),
        }),
      ]),
    ),
    suspicious: z.array(
      z.object({
        path: z.string(),
        query: z.string(),
        suspicious: z.boolean(),
      }),
    ),
  }),
);

describe("query normalization matches the Python middleware", () => {
  it.each(golden.queries)("parses and normalizes ?$query", (testCase) => {
    const items = parseQueryString(testCase.query);
    expect(items).toEqual(testCase.items);
    if ("pythonError" in testCase) return;
    expect(canonicalQuery(items)).toBe(testCase.canonicalQuery ?? undefined);
  });
});

describe("isSuspiciousRequestUrl matches URLEncodingValidationMiddleware", () => {
  it.each(golden.suspicious)(
    "judges $path?$query",
    ({ path, query, suspicious }) => {
      expect(isSuspiciousRequestUrl(path, query)).toBe(suspicious);
    },
  );
});
