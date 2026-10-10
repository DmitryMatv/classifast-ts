import { z } from "zod";
import { readGolden } from "../../test/support/golden.js";
import { buildClassifierConfig } from "./classifier-config.js";

const golden = readGolden(
  "classifier-config.json",
  z.record(z.string(), z.record(z.string(), z.unknown())),
);

describe("buildClassifierConfig", () => {
  it("matches Python's CLASSIFIER_CONFIG apart from the embedding settings", () => {
    const config = buildClassifierConfig({});
    const withoutEmbedding = Object.fromEntries(
      Object.entries(config).map(
        ([type, { embedModelName: _model, embedDims: _dims, ...rest }]) => [
          type,
          rest,
        ],
      ),
    );
    expect(withoutEmbedding).toStrictEqual(golden);
    expect(Object.keys(config)).toEqual(Object.keys(golden));
  });
});
