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

function compareVersions(left: string, right: string): number {
  const leftParts = left.split(".").map(Number);
  const rightParts = right.split(".").map(Number);
  for (let i = 0; i < Math.max(leftParts.length, rightParts.length); i += 1) {
    const difference = (leftParts[i] ?? 0) - (rightParts[i] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

function forEachCodePoint(
  ranges: readonly string[],
  visit: (codePoint: number) => void,
): void {
  for (const range of ranges) {
    const [start, end = start] = range.split("-");
    for (
      let codePoint = parseInt(start!, 16);
      codePoint <= parseInt(end!, 16);
      codePoint += 1
    ) {
      visit(codePoint);
    }
  }
}

function mapsIntoSet(character: string, set: Uint8Array): boolean {
  return [character.toUpperCase(), character.toLowerCase()].some(
    (mapped) =>
      mapped !== character &&
      Array.from(mapped).some((target) => set[target.codePointAt(0)!] === 1),
  );
}

// The code points assigned in the fixtures' Unicode version, minus those
// whose data a newer Node changed: a different general category, or a case
// mapping into a code point the fixtures' version leaves unassigned. Any
// other difference from Python fails the sweeps.
function computeSweptCodePoints(): readonly number[] {
  const { unicodeVersion, generalCategoryRanges } = readGolden(
    "python-str.json",
    z.object({
      unicodeVersion: z.string(),
      generalCategoryRanges: z.record(z.string(), codePointRangesSchema),
    }),
  );
  const runtimeVersion = process.versions.unicode;
  if (runtimeVersion === undefined) {
    throw new Error("Code-point sweeps need a Node built with ICU");
  }
  const order = compareVersions(runtimeVersion, unicodeVersion);
  if (order < 0) {
    throw new Error(
      `Node implements Unicode ${runtimeVersion}, older than the fixtures' Unicode ${unicodeVersion}; run the specs on a newer Node`,
    );
  }
  const unassigned = codePointSet(generalCategoryRanges.Cn ?? []);
  const swept: number[] = [];
  const changed: number[] = [];
  for (const [category, ranges] of Object.entries(generalCategoryRanges)) {
    if (category === "Cn") continue;
    const inCategory = new RegExp(`^\\p{gc=${category}}$`, "u");
    forEachCodePoint(ranges, (codePoint) => {
      const character = String.fromCodePoint(codePoint);
      if (inCategory.test(character) && !mapsIntoSet(character, unassigned)) {
        swept.push(codePoint);
      } else {
        changed.push(codePoint);
      }
    });
  }
  if (order === 0 && changed.length > 0) {
    throw new Error(
      `Node's Unicode ${runtimeVersion} data differs from the fixtures' at ${changed.map(formatCodePoint).join(", ")}`,
    );
  }
  return swept.sort((left, right) => left - right);
}

let sweptCodePoints: readonly number[] | undefined;

export function* assignedCodePoints(): Generator<number> {
  sweptCodePoints ??= computeSweptCodePoints();
  yield* sweptCodePoints;
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
