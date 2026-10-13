import { HttpException } from "@nestjs/common";
import {
  lastQueryValue,
  optionalIntQuery,
  parsePydanticInt,
} from "./query-params.js";

// Results of pydantic's TypeAdapter(int).validate_python on each string.
describe("parsePydanticInt", () => {
  it.each([
    ["5", 5],
    [" 5 ", 5],
    ["\t5\n", 5],
    ["+7", 7],
    ["-3", -3],
    ["5.0", 5],
    ["5.00", 5],
    ["1_000", 1000],
    ["007", 7],
    ["-0", 0],
    ["99999999999999999999", 1e20],
  ])("parses %j", (text, value) => {
    expect(parsePydanticInt(text)).toBe(value);
  });

  it.each([
    "5.5",
    "1__0",
    "_1",
    "0x10",
    "1e2",
    "",
    " ",
    "٥",
    "5.",
    ".5",
    "5.0e0",
    "1 0",
    "+-1",
    "5.000000000000000000001",
  ])("rejects %j", (text) => {
    expect(parsePydanticInt(text)).toBeUndefined();
  });
});

describe("optionalIntQuery", () => {
  it("reads the last value of a repeated name", () => {
    const items = [
      ["top_k", "10"],
      ["top_k", "30"],
    ] as const;
    expect(lastQueryValue(items, "top_k")).toBe("30");
    expect(optionalIntQuery(items, "top_k")).toBe(30);
    expect(optionalIntQuery(items, "other")).toBeUndefined();
  });

  it("answers FastAPI's 422 for a value that is not an integer", () => {
    let error: unknown;
    try {
      optionalIntQuery([["top_k", "abc"]], "top_k");
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getStatus()).toBe(422);
    expect((error as HttpException).getResponse()).toEqual({
      detail: [
        {
          type: "int_parsing",
          loc: ["query", "top_k"],
          msg: "Input should be a valid integer, unable to parse string as an integer",
          input: "abc",
        },
      ],
    });
  });
});
