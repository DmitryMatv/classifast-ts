import { z } from "zod";
import { readGolden } from "../../test/support/golden.js";
import {
  resolveClassifierOptions,
  resolveClassifierType,
} from "./classifier-options.js";
import { buildClassifierConfig } from "./classifier-config.js";

const golden = readGolden(
  "classifier-options.json",
  z.object({
    versions: z.record(z.string(), z.array(z.string())),
    classifierTypes: z.array(
      z.union([
        z.object({
          input: z.string(),
          status: z.literal(200),
          upperType: z.string(),
        }),
        z.object({ input: z.string(), status: z.literal([404, 410]) }),
      ]),
    ),
    options: z.array(
      z.object({
        type: z.string(),
        version: z.string().nullable(),
        topK: z.number().int().nullable(),
        allowInvalidVersion: z.boolean(),
        resolved: z.tuple([z.string(), z.number().int(), z.string()]),
      }),
    ),
  }),
);

const config = buildClassifierConfig({});
const versionsByType = Object.fromEntries(
  Object.entries(config).map(([type, { versions }]) => [
    type,
    Object.keys(versions),
  ]),
);

describe("classifier options match Python", () => {
  it("configures the same classifiers and versions in the same order", () => {
    expect(versionsByType).toEqual(golden.versions);
    expect(Object.keys(versionsByType)).toEqual(Object.keys(golden.versions));
  });

  it.each(golden.classifierTypes)("resolves $input", (testCase) => {
    const resolution = resolveClassifierType(
      testCase.input,
      new Set(Object.keys(config)),
    );
    if (testCase.status === 200) {
      expect(resolution).toEqual({
        kind: "found",
        upperType: testCase.upperType,
      });
    } else {
      expect(resolution.kind).toBe(
        testCase.status === 410 ? "removed" : "unknown",
      );
    }
  });

  it.each(golden.options)(
    "resolves $type version=$version top_k=$topK allowInvalid=$allowInvalidVersion",
    ({ type, version, topK, allowInvalidVersion, resolved }) => {
      expect(
        resolveClassifierOptions(
          versionsByType[type]!,
          version ?? undefined,
          topK ?? undefined,
          10,
          { allowInvalidVersion },
        ),
      ).toEqual({
        version: resolved[0],
        topK: resolved[1],
        firstVersion: resolved[2],
      });
    },
  );
});
