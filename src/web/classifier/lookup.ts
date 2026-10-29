// Pure and isomorphic. The classifier form as data: the query a lookup
// sends and the history entry Back/Forward restores.
import { collapseWhitespace } from "../../python/str.js";
import {
  isResultsAnswer,
  type ResultsAnswer,
  type ResultsQuery,
} from "../results-api.js";

export const TOP_K_CHOICES = [10, 30, 100] as const;
export type TopK = (typeof TOP_K_CHOICES)[number];

/**
 * The form as the browser holds it. The DOM is the only copy: the island
 * reads it for every event and writes it only on Back/Forward.
 */
export interface FormFields {
  readonly text: string;
  /** Empty when the classifier has no versions. */
  readonly version: string;
  readonly topK: TopK;
  readonly enhance: boolean;
}

/** The form as a lookup read it, which is what its history entry restores. */
export interface FormSnapshot {
  readonly fields: FormFields;
  /** The base page's example while it is the query (ClassifierState.fallbackQuery). */
  readonly fallbackQuery: string | null;
}

/**
 * The query a lookup sends: the textarea text, else the fallback; null when
 * both are blank. Whitespace follows Python's rules, as resultsApiPath
 * applies them, so the client's edge cache key equals the server's.
 */
export function lookupOf(
  fields: FormFields,
  fallbackQuery: string | null,
): ResultsQuery | null {
  const query =
    collapseWhitespace(fields.text) || collapseWhitespace(fallbackQuery ?? "");
  if (!query) return null;
  return {
    query,
    version: fields.version,
    topK: fields.topK,
    enhance: fields.enhance,
  };
}

/**
 * What Back/Forward to an entry shows.
 * - page: the document's first entry; the panel the server rendered.
 * - results: this answer again, with no request and no quota charge.
 * - lookup: a fresh request. A paywall, busy or error answer is never
 *   stored, so a paywall the visitor has since signed past is not replayed.
 */
export type ShownPanel =
  { readonly kind: "page" } | { readonly kind: "lookup" } | ResultsAnswer;

/** What the classifier keeps in `history.state[HISTORY_STATE_KEY]`. */
export interface HistoryEntry extends FormSnapshot {
  /** Bump when the shape changes; an entry of another version is not ours. */
  readonly v: 1;
  readonly title: string;
  readonly show: ShownPanel;
}

export const HISTORY_STATE_KEY = "classifast";

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function formFieldsOf(value: unknown): FormFields | null {
  if (!isObject(value)) return null;
  const { text, version, topK, enhance } = value;
  const topKs: readonly unknown[] = TOP_K_CHOICES;
  if (
    !isString(text) ||
    !isString(version) ||
    !topKs.includes(topK) ||
    typeof enhance !== "boolean"
  )
    return null;
  return { text, version, topK: topK as TopK, enhance };
}

function shownPanelOf(value: unknown): ShownPanel | null {
  if (isResultsAnswer(value)) return value;
  if (
    isObject(value) &&
    (value["kind"] === "page" || value["kind"] === "lookup")
  )
    return { kind: value["kind"] };
  return null;
}

/**
 * Parses `history.state` at the popstate boundary. Null means the entry is
 * not the classifier's: a fragment navigation, another script, or an entry
 * an older site.js wrote in another shape.
 */
export function historyEntryOf(state: unknown): HistoryEntry | null {
  if (!isObject(state)) return null;
  const entry = state[HISTORY_STATE_KEY];
  if (!isObject(entry) || entry["v"] !== 1 || !isString(entry["title"]))
    return null;
  const fields = formFieldsOf(entry["fields"]);
  const show = shownPanelOf(entry["show"]);
  const fallbackQuery = entry["fallbackQuery"];
  if (
    fields === null ||
    show === null ||
    !(fallbackQuery === null || isString(fallbackQuery))
  )
    return null;
  return { v: 1, fields, fallbackQuery, title: entry["title"], show };
}
