import { parsePythonFloat, parsePythonInt } from "./python-number.js";

const cases: [string, number | undefined, number | undefined][] = [
  ["20", 20, 20],
  ["  20  ", 20, 20],
  ["+20", 20, 20],
  ["-5", -5, -5],
  ["007", 7, 7],
  ["1_000", 1000, 1000],
  ["2_048", 2048, 2048],
  ["1__0", undefined, undefined],
  ["_1", undefined, undefined],
  ["1_", undefined, undefined],
  ["0x14", undefined, undefined],
  ["0b1", undefined, undefined],
  ["1e3", undefined, 1000],
  ["1.5", undefined, 1.5],
  [".5", undefined, 0.5],
  ["5.", undefined, 5],
  ["2.0", undefined, 2],
  ["1E-2", undefined, 0.01],
  ["1_0.2_5", undefined, 10.25],
  ["1e1_0", undefined, 1e10],
  ["1e308", undefined, 1e308],
  ["-1e308", undefined, -1e308],
  ["1e-400", undefined, 0],
  ["inf", undefined, undefined],
  ["-Infinity", undefined, undefined],
  ["", undefined, undefined],
  ["abc", undefined, undefined],
  ["1 0", undefined, undefined],
];

describe("Python number parsing", () => {
  it.each(cases)(
    "%j parses according to the supported grammar",
    (raw, int, float) => {
      expect(parsePythonInt(raw)).toBe(int);
      expect(parsePythonFloat(raw)).toBe(float);
    },
  );

  it.each([
    ["a leading", "\ufeff20"],
    ["a trailing", "20\ufeff"],
  ])("rejects %s byte order mark, which Python does not strip", (_, raw) => {
    expect(parsePythonInt(raw)).toBeUndefined();
    expect(parsePythonFloat(raw)).toBeUndefined();
  });

  it.each([
    ["a positive exponent", "1e309"],
    ["a negative value", "-1e309"],
    ["a long positive mantissa", `${"9".repeat(400)}.0`],
    ["a long negative mantissa", `-${"9".repeat(400)}.0`],
  ])("rejects overflow from %s", (_, raw) => {
    expect(parsePythonFloat(raw)).toBeUndefined();
  });
});
