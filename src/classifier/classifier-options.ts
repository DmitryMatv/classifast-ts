import { pyStrip } from "../python/str.js";

// Removed classifiers answer 410 Gone so crawlers deindex them quickly.
const REMOVED_CLASSIFIER_TYPES: ReadonlySet<string> = new Set(["GMDN"]);

export type ClassifierTypeResolution =
  | { readonly kind: "found"; readonly upperType: string }
  | { readonly kind: "removed" }
  | { readonly kind: "unknown" };

export function resolveClassifierType(
  classifierType: string,
  knownTypes: ReadonlySet<string>,
): ClassifierTypeResolution {
  const upperType = pyStrip(classifierType).toUpperCase();
  if (REMOVED_CLASSIFIER_TYPES.has(upperType)) return { kind: "removed" };
  return knownTypes.has(upperType)
    ? { kind: "found", upperType }
    : { kind: "unknown" };
}

export interface ResolvedClassifierOptions {
  readonly version: string;
  readonly topK: number;
  readonly firstVersion: string;
}

// Page requests fall back to the first version; fragment requests pass
// allowInvalidVersion so the pipeline rejects an unknown one.
export function resolveClassifierOptions(
  versions: readonly string[],
  version: string | undefined,
  topK: number | undefined,
  defaultTopK: number,
  { allowInvalidVersion = false } = {},
): ResolvedClassifierOptions {
  const firstVersion = versions[0] ?? "";
  const useFirstVersion =
    version === undefined ||
    (!allowInvalidVersion && !versions.includes(version));
  return {
    version: useFirstVersion ? firstVersion : version,
    topK: topK === undefined || topK < 1 || topK > 100 ? defaultTopK : topK,
    firstVersion,
  };
}
