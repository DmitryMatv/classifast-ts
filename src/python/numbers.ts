import { PY_WHITESPACE } from "./str.js";

const DECIMAL = /^\p{Nd}$/u;
const UNICODE_SPACE = new RegExp(`^[${PY_WHITESPACE}]$`);
// int() and float() strip only ASCII whitespace. U+001C to U+001F stay put,
// so int("\x1c5") fails although "\x1c5".strip() is "5".
const ASCII_SPACE_RUN = /^[\t\n\v\f\r ]+|[\t\n\v\f\r ]+$/g;
const INT_LITERAL = /^[+-]?\d(?:_?\d)*$/;
const FLOAT_LITERAL =
  /^[+-]?(?:(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?|inf|infinity|nan)$/i;
// sys.get_int_max_str_digits() default.
const MAX_INT_DIGITS = 4300;

// Unicode encodes every Nd digit in a run of ten, ascending from zero.
function decimalDigit(codePoint: number): number {
  let zero = codePoint;
  while (DECIMAL.test(String.fromCodePoint(zero - 1))) zero -= 1;
  return (codePoint - zero) % 10;
}

function toAsciiLiteral(text: string): string | undefined {
  let ascii = "";
  for (const character of text) {
    const codePoint = character.codePointAt(0)!;
    if (codePoint < 0x80) ascii += character;
    else if (UNICODE_SPACE.test(character)) ascii += " ";
    else if (DECIMAL.test(character)) ascii += decimalDigit(codePoint);
    else return undefined;
  }
  return ascii.replace(ASCII_SPACE_RUN, "");
}

export function pyInt(text: string): bigint | undefined {
  const literal = toAsciiLiteral(text);
  if (literal === undefined || !INT_LITERAL.test(literal)) return undefined;
  const digits = literal.replace(/^[+-]|_/g, "");
  if (digits.length > MAX_INT_DIGITS) return undefined;
  return BigInt(literal.replaceAll("_", ""));
}

export function pyFloat(text: string): number | undefined {
  const literal = toAsciiLiteral(text);
  if (literal === undefined || /_(?!\d)|(?<!\d)_/.test(literal)) {
    return undefined;
  }
  const number = literal.replaceAll("_", "");
  if (!FLOAT_LITERAL.test(number)) return undefined;
  const negative = number.startsWith("-");
  switch (number.replace(/^[+-]/, "").toLowerCase()) {
    case "nan":
      return NaN;
    case "inf":
    case "infinity":
      return negative ? -Infinity : Infinity;
    default:
      return Number(number);
  }
}

// Python rounds the exact binary value half to even. toFixed() rounds ties
// away from zero and Math.round() rounds them toward +Infinity.
function scaledHalfEven(value: number, digits: number): bigint {
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, Math.abs(value));
  const bits = view.getBigUint64(0);
  const biasedExponent = Number(bits >> 52n);
  const fraction = bits & ((1n << 52n) - 1n);
  const mantissa = biasedExponent ? fraction | (1n << 52n) : fraction;
  const exponent = (biasedExponent || 1) - 1075;
  const numerator = mantissa * 10n ** BigInt(digits);
  if (exponent >= 0) return numerator << BigInt(exponent);
  const denominator = 1n << BigInt(-exponent);
  const quotient = numerator / denominator;
  const twiceRemainder = (numerator % denominator) * 2n;
  const roundUp =
    twiceRemainder > denominator ||
    (twiceRemainder === denominator && quotient % 2n === 1n);
  return roundUp ? quotient + 1n : quotient;
}

function isNegative(value: number): boolean {
  return value < 0 || Object.is(value, -0);
}

export function pyRound(value: number, digits: number): number {
  if (!Number.isFinite(value) || value === 0) return value;
  const rounded = Number(`${scaledHalfEven(value, digits)}e-${digits}`);
  return isNegative(value) ? -rounded : rounded;
}

export function pyFormatFixed(value: number, digits: number): string {
  if (Number.isNaN(value)) return "nan";
  const sign = isNegative(value) ? "-" : "";
  if (!Number.isFinite(value)) return `${sign}inf`;
  const scaled = scaledHalfEven(value, digits)
    .toString()
    .padStart(digits + 1, "0");
  const integer = scaled.slice(0, scaled.length - digits);
  return digits
    ? `${sign}${integer}.${scaled.slice(scaled.length - digits)}`
    : `${sign}${integer}`;
}
