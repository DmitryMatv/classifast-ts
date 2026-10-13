import { Fragment } from "react";
import type { ClassificationResult } from "../classifier/classification.js";
import type { ClassifierVersion } from "../classifier/classifier-config.js";
import { pyRepr } from "../python/float-repr.js";
import { pyFormatFixed } from "../python/numbers.js";
import { pyStrip } from "../python/str.js";
import { groupOriginalIdTokens } from "./original-id-tokens.js";
import { formatScore } from "./result-score.js";

export interface ResultsProps {
  /** Python's results.html renders nothing but a prompt without a query. */
  readonly query: string;
  readonly results: readonly ClassificationResult[];
  readonly classifierType: string;
  readonly version?: ClassifierVersion;
  readonly elapsedSeconds?: number;
  /** A completed classification: no results means none matched. */
  readonly loaded: boolean;
  /** Python's 'NACE' in request.url.path: link codes without their dots. */
  readonly stripCodeDots: boolean;
}

const DIGIT_COLORS: Readonly<Record<string, string>> = {
  "0": "text-[#1f77b4]",
  "1": "text-[#17becf]",
  "2": "text-[#e377c2]",
  "3": "text-[#8c564b]",
  "4": "text-[#bcbd22]",
  "5": "text-[#9467bd]",
  "6": "text-[#2ca02c]",
  "7": "text-[#7f7f7f]",
  "8": "text-[#ff7f0e]",
  "9": "text-[#d62728]",
};

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

function CopyIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="inline align-middle relative -top-0.5 lucide lucide-copy-icon lucide-copy"
    >
      <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
      <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
    </svg>
  );
}

function ExternalLinkIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="inline align-middle relative -top-0.5 ml-2 lucide lucide-external-link-icon lucide-external-link"
    >
      <path d="M15 3h6v6" />
      <path d="M10 14 21 3" />
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
    </svg>
  );
}

function CodeDigits({
  originalId,
  classifierType,
}: {
  readonly originalId: unknown;
  readonly classifierType: string;
}) {
  const spaced = !UNSPACED_CLASSIFIERS.has(classifierType);
  // Jinja renders a missing original_id as an empty string.
  const id = originalId === undefined ? "" : originalId;
  return groupOriginalIdTokens(id).map((token, index) => (
    <Fragment key={index}>
      <span className={DIGIT_COLORS[token.char] ?? "text-gray-600"}>
        {token.char}
      </span>
      {token.gapAfter && spaced && (
        <span aria-hidden="true" className="code-spacer-halves"></span>
      )}
    </Fragment>
  ));
}

interface ResultItemProps {
  readonly result: ClassificationResult;
  readonly classifierType: string;
  readonly version: ClassifierVersion | undefined;
  readonly stripCodeDots: boolean;
}

function ResultItem({
  result,
  classifierType,
  version,
  stripCodeDots,
}: ResultItemProps) {
  const { payload } = result;
  const originalId = pyText(payload["original_id"]);
  const score = formatScore(result.score);
  const baseUrl = version?.baseUrl;
  const digits = (
    <CodeDigits
      originalId={payload["original_id"]}
      classifierType={classifierType}
    />
  );
  let code;
  if (baseUrl !== undefined && isFilled(baseUrl)) {
    const codeForUrl = stripCodeDots
      ? originalId.replaceAll(".", "")
      : originalId;
    const detailUrl =
      baseUrl +
      ((version?.appendCodeToUrl ?? true) ? codeForUrl : "") +
      (version?.codeUrlSuffix ?? "");
    code = (
      <a
        href={detailUrl}
        target="_blank"
        className="text-gray-600 text-2xl font-bold font-mono hover:text-sky-600 hover:underline hover:decoration-sky-600"
        rel="noopener"
        aria-label={`View details for ${originalId} (opens in new tab)`}
      >
        {digits}
        <ExternalLinkIcon />
      </a>
    );
  } else {
    code = (
      <span className="text-gray-600 text-2xl font-bold font-mono">
        {digits}
      </span>
    );
  }
  return (
    <li
      className="rounded shadow border border-gray-200 relative overflow-hidden"
      role="listitem"
    >
      <div
        className="absolute inset-y-0 left-0 score-bar"
        data-score-bar=""
        data-score-width={score.width}
      ></div>
      <div className="relative p-3">
        <div className="flex-1">
          <div className="flex items-baseline gap-2">
            <button
              type="button"
              data-copy-original-id={originalId}
              title="Copy ID to clipboard"
              aria-label={`Copy classification ID ${originalId} to clipboard`}
              className="text-2xl font-mono text-gray-600 hover:text-sky-600 cursor-pointer"
            >
              <CopyIcon />
            </button>{" "}
            {code}{" "}
            {isTruthy(payload["id_level"]) && (
              <>
                <span className="text-gray-600 text-lg">
                  {pyText(payload["id_level"])}
                </span>{" "}
              </>
            )}
            <span className="ml-auto text-gray-600">{score.label}%</span>
          </div>
          {isFilled(payload["class_name"]) && (
            <div className="flex items-baseline gap-x-2 flex-wrap">
              <h3 className="text-gray-800 text-lg font-semibold">
                {pyText(payload["class_name"])}
              </h3>
            </div>
          )}
          <p className="text-gray-600">{pyText(payload["definition"])}</p>
        </div>
      </div>
    </li>
  );
}

function ResultList({
  results,
  classifierType,
  version,
  elapsedSeconds,
  stripCodeDots,
}: Omit<ResultsProps, "query" | "loaded">) {
  const tooltip = version?.tooltip;
  return (
    <>
      <p className="hidden text-xl font-semibold text-gray-800 mb-4">
        Classification Results
      </p>
      {tooltip !== undefined && isFilled(tooltip) && (
        <p className="text-gray-600 mb-4">{tooltip}</p>
      )}
      <ul className="space-y-3" role="list">
        {results.map((result, index) => (
          <ResultItem
            key={index}
            result={result}
            classifierType={classifierType}
            version={version}
            stripCodeDots={stripCodeDots}
          />
        ))}
      </ul>
      <div className="mt-8 text-gray-600">
        {elapsedSeconds !== undefined && (
          <span>Finished in {pyFormatFixed(elapsedSeconds, 2)} seconds.</span>
        )}
      </div>
      <div className="mt-4 prose max-w-none">
        <p id="description-pro-tip" className="text-gray-600">
          Classifast can make mistakes. Double-check important data. For best
          results, provide the most relevant and accurate description (in any
          language). Product specifications, raw unformatted text, tables, and
          lists; any input data is acceptable as long as it clearly and
          unambiguously defines what exactly you want to classify.
        </p>
      </div>
      <div className="mt-8">
        <button
          type="button"
          id="share-button"
          className="bg-gray-600 hover:bg-gray-700 text-white font-semibold px-8 py-2 rounded text-base transition-colors duration-150 ease-in-out transform"
          title="Copy shareable link to clipboard"
        >
          Copy link
        </button>
      </div>
    </>
  );
}

/** Port of app/templates/results.html, without the fragment's page title. */
export function Results(props: ResultsProps) {
  const { query, results, loaded } = props;
  if (!query) {
    return (
      <section>
        <p className="text-left text-gray-600">Please enter a query</p>
      </section>
    );
  }
  let body;
  if (results.length > 0) {
    body = <ResultList {...props} />;
  } else {
    body = (
      <div>
        <p className="text-left text-gray-600">
          {loaded ? "No matching classification results found." : "Loading..."}
        </p>
      </div>
    );
  }
  return (
    <section aria-labelledby="results-heading">
      <figure className="mb-2" hidden>
        <figcaption id="results-heading" className="font-semibold">
          Results for:
        </figcaption>
        <pre className="mt-2 p-3 bg-gray-50 rounded shadow border border-gray-200  whitespace-pre-wrap">
          {`"${query}"`}
        </pre>
      </figure>
      {body}
    </section>
  );
}
