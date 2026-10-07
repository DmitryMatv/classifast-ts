import { readFileSync } from "node:fs";
import { z } from "zod";

export function readGolden<Schema extends z.ZodType>(
  name: string,
  schema: Schema,
): z.infer<Schema> {
  return schema.parse(
    JSON.parse(
      readFileSync(
        new URL(`../fixtures/golden/${name}`, import.meta.url),
        "utf8",
      ),
    ),
  );
}

// Ranges are written as "0009-000D" or "00A0" by the Python exporter.
export const codePointRangesSchema = z.array(
  z.string().regex(/^[0-9A-F]{4,6}(-[0-9A-F]{4,6})?$/),
);

export function codePointSet(ranges: readonly string[]): Uint8Array {
  const set = new Uint8Array(0x110000);
  for (const range of ranges) {
    const [start, end = start] = range.split("-");
    set.fill(1, parseInt(start!, 16), parseInt(end!, 16) + 1);
  }
  return set;
}

const pythonUnicode = readGolden(
  "python-str.json",
  z.object({
    unicodeVersion: z.string(),
    unassignedRanges: codePointRangesSchema,
  }),
);
const unassigned = codePointSet(pythonUnicode.unassignedRanges);

// Assigned characters whose properties Unicode 17 changed: U+0295 became
// Cased, and U+A7D3 and U+A7D5 gained the new capitals U+A7D2 and U+A7D4.
const UNICODE_17_CHANGES: ReadonlySet<number> = new Set([
  0x0295, 0xa7d3, 0xa7d5,
]);
const runtimeUnicodeDiffers =
  process.versions.unicode?.split(".")[0] !==
  pythonUnicode.unicodeVersion.split(".")[0];

// Node's ICU can implement a newer Unicode version than Python. Sweeps skip
// the code points Python treats as unassigned, which a newer version may
// assign, and the known changes when the versions differ.
export function* assignedCodePoints(): Generator<number> {
  for (let codePoint = 0; codePoint <= 0x10ffff; codePoint += 1) {
    if (codePoint >= 0xd800 && codePoint <= 0xdfff) continue;
    if (unassigned[codePoint]) continue;
    if (runtimeUnicodeDiffers && UNICODE_17_CHANGES.has(codePoint)) continue;
    yield codePoint;
  }
}

export function formatCodePoint(codePoint: number): string {
  return `U+${codePoint.toString(16).toUpperCase().padStart(4, "0")}`;
}

export function sweepMismatches<T>(
  actual: (character: string) => T,
  expected: (codePoint: number) => T,
): string[] {
  const mismatches: string[] = [];
  for (const codePoint of assignedCodePoints()) {
    const got = actual(String.fromCodePoint(codePoint));
    const wanted = expected(codePoint);
    if (got !== wanted) {
      mismatches.push(
        `${formatCodePoint(codePoint)}: ${JSON.stringify(got)} != ${JSON.stringify(wanted)}`,
      );
    }
  }
  return mismatches.length > 20
    ? [...mismatches.slice(0, 20), `${mismatches.length} mismatches in total`]
    : mismatches;
}
