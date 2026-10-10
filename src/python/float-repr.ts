// Python's repr() of a float: the shortest round-trip digits, as JavaScript
// prints them, in Python's layout. JavaScript drops ".0" from integral values
// and switches to exponents at 1e21 and 1e-7 instead of 1e16 and 1e-4.
export function pyRepr(value: number): string {
  if (Number.isNaN(value)) return "nan";
  if (!Number.isFinite(value)) return value > 0 ? "inf" : "-inf";
  const sign = value < 0 || Object.is(value, -0) ? "-" : "";
  const [mantissa = "", exponentText = ""] = Math.abs(value)
    .toExponential()
    .split("e");
  const exponent = Number(exponentText);
  const digits = mantissa.replace(".", "");
  if (exponent < -4 || exponent >= 16) {
    const exponentSign = exponent < 0 ? "-" : "+";
    const magnitude = String(Math.abs(exponent)).padStart(2, "0");
    return `${sign}${mantissa}e${exponentSign}${magnitude}`;
  }
  if (exponent < 0) {
    return `${sign}0.${"0".repeat(-exponent - 1)}${digits}`;
  }
  const integer = digits.slice(0, exponent + 1).padEnd(exponent + 1, "0");
  const fraction = digits.slice(exponent + 1) || "0";
  return `${sign}${integer}.${fraction}`;
}
