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
