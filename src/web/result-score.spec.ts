import { z } from "zod";
import { readGolden } from "../../test/support/golden.js";
import { formatScore } from "./result-score.js";

const golden = readGolden(
  "result-score.json",
  z.object({
    scores: z.array(
      z.object({
        score: z.number().nullable(),
        width: z.string(),
        label: z.string(),
      }),
    ),
  }),
);

describe("formatScore matches the results.html score bar and label", () => {
  it.each(golden.scores)(
    "formats $score as $width and $label",
    ({ score, width, label }) => {
      expect(formatScore(score)).toEqual({ width, label });
    },
  );
});
