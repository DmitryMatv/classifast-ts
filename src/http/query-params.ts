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
  return Number(stripped.replace(/_|\.0+$/g, ""));
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
    throw new HttpException(
      {
        detail: [
          {
            type: "int_parsing",
            loc: ["query", name],
            msg: "Input should be a valid integer, unable to parse string as an integer",
            input: text,
          },
        ],
      },
      422,
    );
  }
  return value;
}
