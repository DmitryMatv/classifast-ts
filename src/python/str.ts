// Ports of the Python str and re behaviors that the app's text handling
// relies on. JavaScript's \s, \w, \d, trim() and case mappings differ.

// str.isspace(), str.strip() and re's \s. Unlike JavaScript's \s, this
// includes U+001C to U+001F and U+0085 and excludes U+FEFF.
export const PY_WHITESPACE =
  "\\t\\n\\v\\f\\r\\x1c-\\x20\\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000";
// re's Unicode \w (str.isalnum() or "_"). Use inside a "u" flag class.
export const PY_WORD = "\\p{L}\\p{N}_";

const WHITESPACE_CHARACTER = new RegExp(`^[${PY_WHITESPACE}]$`);
const WHITESPACE_RUN = new RegExp(`[${PY_WHITESPACE}]+`, "g");
const ALPHA = /^\p{L}$/u;
// str.isdigit() also accepts Numeric_Type=Digit characters such as
// superscripts and circled digits, which have no JavaScript property.
const DIGIT =
  /^[\p{Nd}\u00b2\u00b3\u00b9\u1369-\u1371\u19da\u2070\u2074-\u2079\u2080-\u2089\u2460-\u2468\u2474-\u247c\u2488-\u2490\u24ea\u24f5-\u24fd\u24ff\u2776-\u277e\u2780-\u2788\u278a-\u2792\u{10a40}-\u{10a43}\u{10e60}-\u{10e68}\u{11052}-\u{1105a}\u{1f100}-\u{1f10a}]$/u;
const CASED = /^\p{Cased}$/u;
const CASE_IGNORABLE = /^\p{Case_Ignorable}$/u;

// Python counts and slices strings by code point, JavaScript by UTF-16 unit.
export function codePointLength(value: string): number {
  let length = 0;
  for (const _ of value) length += 1;
  return length;
}

export function sliceCodePoints(value: string, end: number): string {
  let index = 0;
  for (const character of value) {
    if (end === 0) return value.slice(0, index);
    index += character.length;
    end -= 1;
  }
  return value;
}

// Every whitespace character is in the BMP, so testing UTF-16 units is safe.
// Explicit chars must be BMP characters too.
function isStripped(unit: string, chars: string | undefined): boolean {
  return chars === undefined
    ? WHITESPACE_CHARACTER.test(unit)
    : chars.includes(unit);
}

export function pyRstrip(value: string, chars?: string): string {
  let end = value.length;
  while (end > 0 && isStripped(value[end - 1]!, chars)) end -= 1;
  return value.slice(0, end);
}

export function pyStrip(value: string, chars?: string): string {
  const stripped = pyRstrip(value, chars);
  let start = 0;
  while (start < stripped.length && isStripped(stripped[start]!, chars)) {
    start += 1;
  }
  return stripped.slice(start);
}

// re.sub(r"\s+", " ", value).strip()
export function collapseWhitespace(value: string): string {
  return pyStrip(value.replace(WHITESPACE_RUN, " "));
}

export function pyIsAlpha(character: string): boolean {
  return ALPHA.test(character);
}

export function pyIsDigit(character: string): boolean {
  return DIGIT.test(character);
}

// Full titlecase mappings that differ from the uppercase mapping, apart from
// the Georgian and Greek ranges that titlecase() handles by rule.
const TITLECASE_EXCEPTIONS: ReadonlyMap<string, string> = new Map([
  ["\u00df", "Ss"],
  ["\u01c4", "\u01c5"],
  ["\u01c5", "\u01c5"],
  ["\u01c6", "\u01c5"],
  ["\u01c7", "\u01c8"],
  ["\u01c8", "\u01c8"],
  ["\u01c9", "\u01c8"],
  ["\u01ca", "\u01cb"],
  ["\u01cb", "\u01cb"],
  ["\u01cc", "\u01cb"],
  ["\u01f1", "\u01f2"],
  ["\u01f2", "\u01f2"],
  ["\u01f3", "\u01f2"],
  ["\u0587", "\u0535\u0582"],
  ["\u1fb2", "\u1fba\u0345"],
  ["\u1fb3", "\u1fbc"],
  ["\u1fb4", "\u0386\u0345"],
  ["\u1fb7", "\u0391\u0342\u0345"],
  ["\u1fbc", "\u1fbc"],
  ["\u1fc2", "\u1fca\u0345"],
  ["\u1fc3", "\u1fcc"],
  ["\u1fc4", "\u0389\u0345"],
  ["\u1fc7", "\u0397\u0342\u0345"],
  ["\u1fcc", "\u1fcc"],
  ["\u1ff2", "\u1ffa\u0345"],
  ["\u1ff3", "\u1ffc"],
  ["\u1ff4", "\u038f\u0345"],
  ["\u1ff7", "\u03a9\u0342\u0345"],
  ["\u1ffc", "\u1ffc"],
  ["\ufb00", "Ff"],
  ["\ufb01", "Fi"],
  ["\ufb02", "Fl"],
  ["\ufb03", "Ffi"],
  ["\ufb04", "Ffl"],
  ["\ufb05", "St"],
  ["\ufb06", "St"],
  ["\ufb13", "\u0544\u0576"],
  ["\ufb14", "\u0544\u0565"],
  ["\ufb15", "\u0544\u056b"],
  ["\ufb16", "\u054e\u0576"],
  ["\ufb17", "\u0544\u056d"],
]);

export function titlecase(character: string): string {
  const exception = TITLECASE_EXCEPTIONS.get(character);
  if (exception !== undefined) return exception;
  const codePoint = character.codePointAt(0)!;
  // Georgian Mkhedruli uppercases to Mtavruli but titlecases to itself.
  if (codePoint >= 0x10d0 && codePoint <= 0x10ff) return character;
  // Greek letters with ypogegrammeni titlecase to the prosgegrammeni form.
  if (codePoint >= 0x1f80 && codePoint <= 0x1faf) {
    return String.fromCodePoint(codePoint | 0x8);
  }
  return character.toUpperCase();
}

const CAPITAL_SIGMA = "\u03a3";

function isFinalSigma(characters: readonly string[], index: number): boolean {
  let before = index - 1;
  while (before >= 0 && CASE_IGNORABLE.test(characters[before]!)) before -= 1;
  if (before < 0 || !CASED.test(characters[before]!)) return false;
  let after = index + 1;
  while (after < characters.length && CASE_IGNORABLE.test(characters[after]!)) {
    after += 1;
  }
  return after === characters.length || !CASED.test(characters[after]!);
}

// str.title(): a character that follows a cased character is lowercased,
// any other is titlecased, so "they're 3rd" becomes "They'Re 3Rd".
export function pyTitle(value: string): string {
  const characters = Array.from(value);
  let title = "";
  let previousIsCased = false;
  characters.forEach((character, index) => {
    if (!previousIsCased) {
      title += titlecase(character);
    } else if (character === CAPITAL_SIGMA) {
      title += isFinalSigma(characters, index) ? "\u03c2" : "\u03c3";
    } else {
      title += character.toLowerCase();
    }
    previousIsCased = CASED.test(character);
  });
  return title;
}
