import { HttpException } from "@nestjs/common";
import { pyStrip } from "../python/str.js";
import type { QueryItem } from "../web/request-url.js";

// FastAPI reads a scalar query parameter with QueryParams.get, which returns
// the last value of a repeated name.
export function lastQueryValue(
  items: readonly QueryItem[],
  name: string,
): string | undefined {
  return items.findLast(([itemName]) => itemName === name)?.[1];
}

// Pydantic's lax str-to-int parsing: surrounding whitespace, a sign,
// underscores between digits and a fraction of zeros are accepted.
const PYDANTIC_INT = /^[+-]?[0-9]+(?:_[0-9]+)*(?:\.0+)?$/;

export function parsePydanticInt(text: string): number | undefined {
  const stripped = pyStrip(text);
  if (!PYDANTIC_INT.test(stripped)) return undefined;
  // Python has no negative zero integer.
  return Number(stripped.replace(/_|\.0+$/g, "")) || 0;
}

/** One entry of the `detail` list in FastAPI's 422 body. */
export interface QueryValidationError {
  readonly type: string;
  readonly loc: readonly ["query", string];
  readonly msg: string;
  readonly input: string | null;
  readonly ctx?: Readonly<Record<string, number>>;
}

export function queryValidationFailed(
  errors: readonly QueryValidationError[],
): HttpException {
  return new HttpException({ detail: errors }, 422);
}

export function intParsingError(
  name: string,
  input: string,
): QueryValidationError {
  return {
    type: "int_parsing",
    loc: ["query", name],
    msg: "Input should be a valid integer, unable to parse string as an integer",
    input,
  };
}

/** An optional integer query parameter, or FastAPI's 422 for a bad one. */
export function optionalIntQuery(
  items: readonly QueryItem[],
  name: string,
): number | undefined {
  const text = lastQueryValue(items, name);
  if (text === undefined) return undefined;
  const value = parsePydanticInt(text);
  if (value === undefined) {
    throw queryValidationFailed([intParsingError(name, text)]);
  }
  return value;
}

const PYDANTIC_TRUE: ReadonlySet<string> = new Set([
  "1",
  "on",
  "t",
  "true",
  "y",
  "yes",
]);
const PYDANTIC_FALSE: ReadonlySet<string> = new Set([
  "0",
  "off",
  "f",
  "false",
  "n",
  "no",
]);

// Pydantic's lax str-to-bool parsing: case-insensitive, no whitespace.
export function parsePydanticBool(text: string): boolean | undefined {
  const lowered = text.toLowerCase();
  if (PYDANTIC_TRUE.has(lowered)) return true;
  if (PYDANTIC_FALSE.has(lowered)) return false;
  return undefined;
}
