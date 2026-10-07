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
// The \u00a0-\uffff range admits every BMP character from U+00A0 on, but no
// astral character that \w rejects, such as emoji.
const ALLOWED_QUERY = new RegExp(
  `^[${PY_WORD}${PY_WHITESPACE}\\-.,:;()\\[\\]{}/\\\\&@#%+=*?!~\`'"<>\\u00a0-\\uffff]+$`,
  "u",
);

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

// sanitize_query_text(query): the user's query before classification.
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
  if (!ALLOWED_QUERY.test(collapsed)) {
    return invalid(
      "Query contains invalid characters. Please use standard text characters only.",
    );
  }
  return { kind: "valid", query: collapsed };
}

// sanitize_query_text(query, for_search=True). Python rejects an empty
// query here too; every caller passes a validated, non-empty one.
export function sanitizeSearchText(raw: string): string {
  return collapseWhitespace(
    pyRstrip(pyStrip(raw), "/").replace(SEARCH_DISALLOWED, " "),
  );
}

// normalize_product_description
export function normalizeProductDescription(description: string): string {
  return collapseWhitespace(description);
}

// Python's case-insensitive [a-z] also matches U+0130 and U+0131, which
// JavaScript's simple case folding leaves alone.
const CODE_LIKE = /^[a-z\u0130\u0131\p{Nd}][a-z\u0130\u0131\p{Nd}._/-]*$/iu;
const CODE_LETTER = /[a-z\u0130\u0131]/iu;

// query_enhancer._is_code_like: codes skip query enhancement.
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
