import { pyIsAlpha, pyIsDigit } from "../python/str.js";

export interface OriginalIdToken {
  readonly char: string;
  readonly gapAfter: boolean;
}

function originalIdDisplayText(originalId: unknown): string {
  if (originalId === null) return "";
  switch (typeof originalId) {
    case "string":
      return originalId;
    case "boolean":
      return originalId ? "True" : "False";
    case "number":
      if (
        !Number.isFinite(originalId) ||
        Object.is(originalId, -0) ||
        (Number.isInteger(originalId)
          ? !Number.isSafeInteger(originalId)
          : Math.abs(originalId) < 1e-4 || Math.abs(originalId) >= 1e16)
      ) {
        throw new RangeError("Original ID number cannot be displayed safely");
      }
      return String(originalId);
    default:
      throw new TypeError(
        "Original ID must be a string, null, boolean or number",
      );
  }
}

/**
 * Group strings or parsed scalar IDs. Null is empty; booleans use Python casing.
 * Safe integral numbers mean integer IDs, since JSON parsing loses a float's .0.
 * Fractions require absolute values in [1e-4, 1e16). Other numbers throw
 * RangeError; unsupported types throw TypeError.
 */
export function groupOriginalIdTokens(originalId: unknown): OriginalIdToken[] {
  const characters = Array.from(originalIdDisplayText(originalId));
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
