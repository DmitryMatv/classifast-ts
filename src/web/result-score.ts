import { pyFormatFixed, pyRound } from "../python/numbers.js";

// Jinja's max and min filters keep the first argument on a tie, so a score
// of -0 stays -0 where Math.max(-0, 0) returns 0.
function firstMax(first: number, second: number): number {
  return second > first ? second : first;
}

function firstMin(first: number, second: number): number {
  return second < first ? second : first;
}

export interface ScoreDisplay {
  readonly width: string;
  readonly label: string;
}

export function formatScore(score: number | null): ScoreDisplay {
  const percent =
    score === null ? 0 : pyRound(firstMin(firstMax(score * 100, 0), 100), 2);
  return {
    width: pyFormatFixed(percent, 2),
    label: pyFormatFixed(percent, 1),
  };
}
