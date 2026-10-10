// Python's int() and float() accept underscores between digits, which
// Number() rejects, and reject hex and binary, which Number() accepts. They
// strip the same whitespace as trim() except U+FEFF.

const DIGITS = String.raw`\d(?:_?\d)*`;
const PYTHON_INT = new RegExp(`^[+-]?${DIGITS}$`);
const PYTHON_FLOAT = new RegExp(
  `^[+-]?(?:(?:${DIGITS}\\.(?:${DIGITS})?|\\.${DIGITS}|${DIGITS})(?:[eE][+-]?${DIGITS})?)$`,
);
const PYTHON_EDGE_WHITESPACE = /^[^\S\uFEFF]+|[^\S\uFEFF]+$/g;

function stripPythonWhitespace(raw: string): string {
  return raw.replace(PYTHON_EDGE_WHITESPACE, "");
}

export function parsePythonInt(raw: string): number | undefined {
  const value = stripPythonWhitespace(raw);
  return PYTHON_INT.test(value) ? Number(value.replaceAll("_", "")) : undefined;
}

export function parsePythonFloat(raw: string): number | undefined {
  const value = stripPythonWhitespace(raw);
  if (!PYTHON_FLOAT.test(value)) return undefined;
  const number = Number(value.replaceAll("_", ""));
  return Number.isFinite(number) ? number : undefined;
}
