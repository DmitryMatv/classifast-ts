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

// Code points whose data changed between the fixtures' Unicode version and a
// newer Node's, reviewed by hand. Only sweeps that pass `unicodeDrift()` may
// differ from Python there; a different drift set fails until reviewed.
const REVIEWED_UNICODE_DRIFT: Readonly<Record<string, readonly number[]>> = {
  "16.0.0 -> 17.0": [0x0295, 0xa7d3, 0xa7d5],
};

interface Sweep {
  readonly swept: readonly number[];
  readonly drift: ReadonlySet<number>;
}

// The code points assigned in the fixtures' Unicode version. Code points the
// fixtures leave unassigned are not swept; Node may assign them.
function computeSweep(): Sweep {
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
      swept.push(codePoint);
      if (!inCategory.test(character) || mapsIntoSet(character, unassigned)) {
        changed.push(codePoint);
      }
    });
  }
  const reviewed =
    order === 0
      ? []
      : (REVIEWED_UNICODE_DRIFT[`${unicodeVersion} -> ${runtimeVersion}`] ??
        null);
  const describe = (codePoints: readonly number[]) =>
    codePoints.map(formatCodePoint).join(", ") || "none";
  if (
    reviewed === null ||
    describe(reviewed) !== describe([...changed].sort((a, b) => a - b))
  ) {
    throw new Error(
      `Node's Unicode ${runtimeVersion} data differs from the fixtures' Unicode ${unicodeVersion} at ${describe(changed)}; review it and update REVIEWED_UNICODE_DRIFT`,
    );
  }
  return {
    swept: swept.sort((left, right) => left - right),
    drift: new Set(changed),
  };
}

let sweep: Sweep | undefined;

export function* assignedCodePoints(): Generator<number> {
  sweep ??= computeSweep();
  yield* sweep.swept;
}

export function unicodeDrift(): ReadonlySet<number> {
  sweep ??= computeSweep();
  return sweep.drift;
}

export function formatCodePoint(codePoint: number): string {
  return `U+${codePoint.toString(16).toUpperCase().padStart(4, "0")}`;
}

export function sweepMismatches<T>(
  actual: (character: string) => T,
  expected: (codePoint: number) => T,
  tolerated: ReadonlySet<number> = new Set(),
): string[] {
  const mismatches: string[] = [];
  for (const codePoint of assignedCodePoints()) {
    if (tolerated.has(codePoint)) continue;
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
