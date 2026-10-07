import { parsePythonFloat, parsePythonInt } from "./python-number.js";

// Expected values from Python 3.14 int() and float(), except inf, which
// parsePythonFloat rejects on purpose.
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
  ["inf", undefined, undefined],
  ["-Infinity", undefined, undefined],
  ["", undefined, undefined],
  ["abc", undefined, undefined],
  ["1 0", undefined, undefined],
];

describe("Python number parsing", () => {
  it.each(cases)("%j parses like Python", (raw, int, float) => {
    expect(parsePythonInt(raw)).toBe(int);
    expect(parsePythonFloat(raw)).toBe(float);
  });
});
