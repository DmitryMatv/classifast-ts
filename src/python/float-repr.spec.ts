import { z } from "zod";
import { readGolden } from "../../test/support/golden.js";
import { pyRepr } from "./float-repr.js";

const golden = readGolden(
  "python-float-repr.json",
  z.object({
    finite: z.array(z.object({ value: z.number(), repr: z.string() })),
    nonFinite: z.array(z.string()),
  }),
);

const nonFiniteValues: Record<string, number> = {
  inf: Infinity,
  "-inf": -Infinity,
  nan: NaN,
};

describe("pyRepr matches repr() of a float", () => {
  it.each(golden.finite)("formats $repr", ({ value, repr }) => {
    expect(pyRepr(value)).toBe(repr);
  });

  it.each(golden.nonFinite)("formats %s", (repr) => {
    expect(pyRepr(nonFiniteValues[repr]!)).toBe(repr);
  });
});
