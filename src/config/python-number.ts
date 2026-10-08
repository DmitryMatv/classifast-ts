// Python's int() and float() accept underscores between digits, which
// Number() rejects, and reject hex and binary, which Number() accepts.

const DIGITS = String.raw`\d(?:_?\d)*`;
const PYTHON_INT = new RegExp(`^[+-]?${DIGITS}$`);
const PYTHON_FLOAT = new RegExp(
  `^[+-]?(?:(?:${DIGITS}\\.(?:${DIGITS})?|\\.${DIGITS}|${DIGITS})(?:[eE][+-]?${DIGITS})?)$`,
);

export function parsePythonInt(raw: string): number | undefined {
  const value = raw.trim();
  return PYTHON_INT.test(value) ? Number(value.replaceAll("_", "")) : undefined;
}

export function parsePythonFloat(raw: string): number | undefined {
  const value = raw.trim();
  if (!PYTHON_FLOAT.test(value)) return undefined;
  const number = Number(value.replaceAll("_", ""));
  return Number.isFinite(number) ? number : undefined;
}
