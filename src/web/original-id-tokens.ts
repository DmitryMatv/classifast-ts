import { pyIsAlpha, pyIsDigit } from "../python/str.js";

export interface OriginalIdToken {
  readonly char: string;
  readonly gapAfter: boolean;
}

export function groupOriginalIdTokens(originalId: string): OriginalIdToken[] {
  const characters = Array.from(originalId);
  const gapAfter = characters.map(
    (character, index) =>
      pyIsAlpha(character) &&
      index + 1 < characters.length &&
      pyIsDigit(characters[index + 1]!),
  );

  let runStart: number | undefined;
  for (let index = 0; index <= characters.length; index += 1) {
    if (index < characters.length && pyIsDigit(characters[index]!)) {
      runStart ??= index;
      continue;
    }
    if (runStart === undefined) continue;
    const firstGroupSize = (index - runStart) % 2 ? 1 : 2;
    for (let gap = runStart + firstGroupSize - 1; gap < index - 1; gap += 2) {
      gapAfter[gap] = true;
    }
    runStart = undefined;
  }

  return characters.map((char, index) => ({
    char,
    gapAfter: gapAfter[index]!,
  }));
}
