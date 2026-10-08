import { z } from "zod";
import { readGolden } from "../../test/support/golden.js";
import { formatScoreWidth } from "./result-score.js";

const golden = readGolden(
  "result-score.json",
  z.object({
    scoreWidths: z.array(
      z.object({ score: z.number().nullable(), width: z.string() }),
    ),
  }),
);

describe("formatScoreWidth matches the results.html score bar", () => {
  it.each(golden.scoreWidths)(
    "formats $score as $width",
    ({ score, width }) => {
      expect(formatScoreWidth(score)).toBe(width);
    },
  );
});
