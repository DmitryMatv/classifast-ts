// Python's int() and float() accept underscores between digits, which
// Number() rejects, and reject hex and binary, which Number() accepts.
// Unicode digits, inf and nan, which Python also accepts, are rejected here:
// every float setting is a duration, and a timer treats Infinity as 1 ms.

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
  return PYTHON_FLOAT.test(value)
    ? Number(value.replaceAll("_", ""))
    : undefined;
}
