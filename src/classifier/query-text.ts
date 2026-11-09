import {
  PY_WHITESPACE,
  PY_WORD,
  codePointLength,
  collapseWhitespace,
  pyRstrip,
  pyStrip,
} from "../python/str.js";

export type QueryValidation =
  | { readonly kind: "valid"; readonly query: string }
  | { readonly kind: "invalid"; readonly detail: string };

const MAX_QUERY_LENGTH = 4000;
const SEARCH_DISALLOWED = new RegExp(
  `[^${PY_WORD}${PY_WHITESPACE}\\-.,:;(){}\\[\\]/'"&%#+=!@]+`,
  "gu",
);
const PURE_NUMERIC_CODE = new RegExp(`^[\\p{Nd}${PY_WHITESPACE}.\\-]+$`, "u");
const REPEATED_URL_ENCODING = /(?:25){2,}/;
const HEX_SEQUENCE = /[0-9A-Fa-f]{4,}/g;
const HEX_LETTER = /[A-Fa-f]/g;
const DECIMAL = /\p{Nd}/u;
// Python accepted only word characters, some ASCII punctuation and the
// rest of the Basic Multilingual Plane, so it refused `$`, `^`, `|` and
// emoji, which product listings carry. The port refuses only what no
// description needs: control characters that are not whitespace (whitespace
// is collapsed to spaces first) and lone surrogates.
const REFUSED_CHARACTER = /[\p{Cc}\p{Cs}]/u;

function invalid(detail: string): QueryValidation {
  return { kind: "invalid", detail };
}

function suspiciousEncodingDetail(query: string): string | undefined {
  if (REPEATED_URL_ENCODING.test(query)) {
    return "Query contains suspicious URL encoding patterns";
  }
  if (PURE_NUMERIC_CODE.test(query)) return undefined;
  if ((query.match(HEX_SEQUENCE)?.length ?? 0) >= 10) {
    return "Query contains suspicious hex encoding patterns";
  }
  const hexLetters = query.match(HEX_LETTER)?.length ?? 0;
  const nonSpaceCharacters = codePointLength(query.replaceAll(" ", ""));
  if (
    DECIMAL.test(query) &&
    nonSpaceCharacters > 0 &&
    hexLetters / nonSpaceCharacters > 0.7
  ) {
    return "Query appears to be encoded garbage";
  }
  return undefined;
}

export function sanitizeQueryText(raw: string): QueryValidation {
  if (!raw) return invalid("Query cannot be empty");
  const query = pyRstrip(pyStrip(raw), "/");
  const length = codePointLength(query);
  if (length > MAX_QUERY_LENGTH) {
    return invalid("Query too long (max 4000 characters)");
  }
  if (length < 2) return invalid("Query too short (min 2 characters)");
  const suspicious = suspiciousEncodingDetail(query);
  if (suspicious !== undefined) return invalid(suspicious);
  const collapsed = collapseWhitespace(query);
  if (REFUSED_CHARACTER.test(collapsed)) {
    return invalid(
      "Query contains invalid characters. Please use standard text characters only.",
    );
  }
  return { kind: "valid", query: collapsed };
}

export function sanitizeSearchText(raw: string): QueryValidation {
  if (!raw) return invalid("Query cannot be empty");
  return {
    kind: "valid",
    query: collapseWhitespace(
      pyRstrip(pyStrip(raw), "/").replace(SEARCH_DISALLOWED, " "),
    ),
  };
}

export function normalizeProductDescription(description: string): string {
  return collapseWhitespace(description);
}

// Python's case-insensitive [a-z] also matches U+0130 and U+0131, which
// JavaScript's simple case folding leaves alone.
const CODE_LIKE = /^[a-z\u0130\u0131\p{Nd}][a-z\u0130\u0131\p{Nd}._/-]*$/iu;
const CODE_LETTER = /[a-z\u0130\u0131]/iu;

export function isCodeLike(original: string): boolean {
  const stripped = pyStrip(original);
  if (PURE_NUMERIC_CODE.test(stripped)) return true;
  return (
    codePointLength(stripped) >= 5 &&
    CODE_LIKE.test(stripped) &&
    CODE_LETTER.test(stripped) &&
    DECIMAL.test(stripped)
  );
}
