import { pyFormatFixed, pyRound } from "../python/numbers.js";

// Jinja's max and min filters keep the first argument on a tie, so a score
// of -0 stays -0 where Math.max(-0, 0) returns 0.
function firstMax(first: number, second: number): number {
  return second > first ? second : first;
}

function firstMin(first: number, second: number): number {
  return second < first ? second : first;
}

export function formatScoreWidth(score: number | null): string {
  if (score === null) return "0.00";
  const percent = firstMin(firstMax(score * 100, 0), 100);
  return pyFormatFixed(pyRound(percent, 2), 2);
}
