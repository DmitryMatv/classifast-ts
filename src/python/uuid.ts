import { pyIsHexInt } from "./numbers.js";
import { codePointLength, pyStrip } from "./str.js";

export function isPyUuid(value: string): boolean {
  const hex = pyStrip(
    value.replaceAll("urn:", "").replaceAll("uuid:", ""),
    "{}",
  ).replaceAll("-", "");
  return codePointLength(hex) === 32 && pyIsHexInt(hex);
}
