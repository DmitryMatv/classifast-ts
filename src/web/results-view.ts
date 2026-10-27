import type { ClassificationResult } from "../classifier/classification.js";
import type { ClassifierVersion } from "../classifier/classifier-config.js";
import { pyRepr } from "../python/float-repr.js";
import { pyFormatFixed } from "../python/numbers.js";
import { pyStrip } from "../python/str.js";
import { groupOriginalIdTokens } from "./original-id-tokens.js";
import { formatScore } from "./result-score.js";
import type { ResultView, ResultsView } from "./results-api.js";

// Classifiers whose codes read better without visual separators.
const UNSPACED_CLASSIFIERS: ReadonlySet<string> = new Set([
  "ETIM",
  "HTS",
  "NSN",
]);

// Jinja prints a payload value with Python's str(); a missing key is empty.
function pyText(value: unknown): string {
  if (value === undefined) return "";
  if (value === null) return "None";
  if (typeof value === "boolean") return value ? "True" : "False";
  if (typeof value === "number") {
    return Number.isInteger(value) ? String(value) : pyRepr(value);
  }
  // Qdrant payload values are JSON; lists and objects are not expected here.
  return typeof value === "string" ? value : JSON.stringify(value);
}

function isFilled(value: unknown): boolean {
  return typeof value === "string" && pyStrip(value) !== "";
}

// Python truthiness of a JSON payload value.
function isTruthy(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object" && value !== null) {
    return Object.keys(value).length > 0;
  }
  return Boolean(value);
}

export interface ResultsViewContext {
  readonly classifierType: string;
  readonly version?: ClassifierVersion;
  readonly elapsedSeconds?: number;
  /** Python's 'NACE' in request.url.path: link codes without their dots. */
  readonly stripCodeDots: boolean;
}

function resultView(
  result: ClassificationResult,
  context: ResultsViewContext,
): ResultView {
  const { payload } = result;
  const { version } = context;
  const originalId = pyText(payload["original_id"]);
  const spaced = !UNSPACED_CLASSIFIERS.has(context.classifierType);
  const score = formatScore(result.score);
  const baseUrl = version?.baseUrl;
  const codeForUrl = context.stripCodeDots
    ? originalId.replaceAll(".", "")
    : originalId;
  return {
    originalId,
    // Jinja renders a missing original_id as an empty string.
    codeTokens: groupOriginalIdTokens(
      payload["original_id"] === undefined ? "" : payload["original_id"],
    ).map((token) => ({
      char: token.char,
      gapAfter: token.gapAfter && spaced,
    })),
    ...(baseUrl !== undefined &&
      isFilled(baseUrl) && {
        detailUrl:
          baseUrl +
          ((version?.appendCodeToUrl ?? true) ? codeForUrl : "") +
          (version?.codeUrlSuffix ?? ""),
      }),
    ...(isTruthy(payload["id_level"]) && {
      idLevel: pyText(payload["id_level"]),
    }),
    ...(isFilled(payload["class_name"]) && {
      className: pyText(payload["class_name"]),
    }),
    definition: pyText(payload["definition"]),
    scoreLabel: score.label,
    scoreWidth: score.width,
  };
}

/** The results as the results list shows them. */
export function toResultsView(
  results: readonly ClassificationResult[],
  context: ResultsViewContext,
): ResultsView {
  const tooltip = context.version?.tooltip;
  return {
    results: results.map((result) => resultView(result, context)),
    ...(tooltip !== undefined && isFilled(tooltip) && { tooltip }),
    ...(context.elapsedSeconds !== undefined && {
      elapsed: pyFormatFixed(context.elapsedSeconds, 2),
    }),
  };
}
