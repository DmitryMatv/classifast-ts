export const ORIGINAL_ID_FIELD = "original_id";
export const ORIGINAL_ID_NORMALIZED_FIELD = "original_id_normalized";
export const ORIGINAL_ID_NORMALIZED_REVERSED_FIELD =
  "original_id_normalized_reversed";

// Python casefolds before it strips everything but ASCII letters and digits.
// These are the only non-ASCII code points whose case folding (Unicode 16)
// yields ASCII letters; JavaScript's toLowerCase keeps most of them non-ASCII.
const NON_ASCII_ASCII_FOLDS: ReadonlyMap<string, string> = new Map([
  ["ß", "ss"],
  ["İ", "i"],
  ["ŉ", "n"],
  ["ſ", "s"],
  ["ǰ", "j"],
  ["ẖ", "h"],
  ["ẗ", "t"],
  ["ẘ", "w"],
  ["ẙ", "y"],
  ["ẚ", "a"],
  ["ẞ", "ss"],
  ["K", "k"],
  ["ﬀ", "ff"],
  ["ﬁ", "fi"],
  ["ﬂ", "fl"],
  ["ﬃ", "ffi"],
  ["ﬄ", "ffl"],
  ["ﬅ", "st"],
  ["ﬆ", "st"],
]);

const ASCII_ALNUM = /^[0-9A-Za-z]$/;

function foldToAsciiAlnum(value: string): string {
  let folded = "";
  for (const character of value) {
    folded += ASCII_ALNUM.test(character)
      ? character.toLowerCase()
      : (NON_ASCII_ASCII_FOLDS.get(character) ?? "");
  }
  return folded;
}

// Python normalizes str(original_id) for any payload value. String() matches
// it after normalization only for these JSON values. JSON.parse reads 0.0 as
// 0 although Python writes "00" for it, writes 1e-05 and 1e+16 in exponent
// form, and parses integers past 2^53 exactly.
export function originalIdLookupText(value: unknown): string | undefined {
  if (typeof value === "string" || typeof value === "boolean") {
    return String(value);
  }
  if (typeof value !== "number" || value === 0) return undefined;
  if (Number.isSafeInteger(value)) return String(value);
  const magnitude = Math.abs(value);
  return magnitude >= 1e-4 && magnitude < 1e16 && !Number.isInteger(value)
    ? String(value)
    : undefined;
}

function stripZeros(value: string): string {
  return value.replace(/^0+/, "").replace(/0+$/, "");
}

export function normalizeOriginalIdForLookup(value: string): string {
  const compacted = foldToAsciiAlnum(value);
  if (/^0\d{6}0[1-9]$/.test(compacted)) {
    return compacted.slice(1, -2) + compacted.slice(-1);
  }
  return stripZeros(compacted) || compacted;
}

export function reverseNormalizedId(value: string): string {
  return Array.from(value).reverse().join("");
}
