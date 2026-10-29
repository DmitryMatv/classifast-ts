import { Fragment, type CSSProperties } from "react";
import type { CodeToken, ResultView, ResultsView } from "./results-api.js";
import { CopyIdButton, ShareButton } from "./results-interactions.js";

export type ResultsProps = ResultsView & {
  /** Python's results.html renders nothing but a prompt without a query. */
  readonly query: string;
  /** A completed classification: no results means none matched. */
  readonly loaded: boolean;
};

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

function CodeDigits({ tokens }: { readonly tokens: readonly CodeToken[] }) {
  return tokens.map((token, index) => (
    <Fragment key={index}>
      <span className={DIGIT_COLORS[token.char] ?? "text-gray-600"}>
        {token.char}
      </span>
      {token.gapAfter && (
        <span aria-hidden="true" className="code-spacer-halves"></span>
      )}
    </Fragment>
  ));
}

const STAGGER_MS = 100;
const MAX_DELAY_MS = 1000;

/**
 * The page's CSS grows each bar from zero to this width; rows after the
 * first start 100 ms apart, at most 1 s late. data-score-width stays for
 * the legacy classifier.js, which sizes bars in cached pre-island pages.
 */
function scoreBarStyle(width: string, index: number): CSSProperties {
  return {
    width: `${width}%`,
    ...(index > 0 && {
      animationDelay: `${Math.min(index * STAGGER_MS, MAX_DELAY_MS)}ms`,
    }),
  };
}

function ResultItem({
  result,
  index,
}: {
  readonly result: ResultView;
  readonly index: number;
}) {
  const { originalId } = result;
  const digits = <CodeDigits tokens={result.codeTokens} />;
  let code;
  if (result.detailUrl !== undefined) {
    code = (
      <a
        href={result.detailUrl}
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
        data-score-width={result.scoreWidth}
        style={scoreBarStyle(result.scoreWidth, index)}
      ></div>
      <div className="relative p-3">
        <div className="flex-1">
          <div className="flex items-baseline gap-2">
            <CopyIdButton originalId={originalId}>
              <CopyIcon />
            </CopyIdButton>{" "}
            {code}{" "}
            {result.idLevel !== undefined && (
              <>
                <span className="text-gray-600 text-lg">
                  {result.idLevel}
                </span>{" "}
              </>
            )}
            <span className="ml-auto text-gray-600">{result.scoreLabel}%</span>
          </div>
          {result.className !== undefined && (
            <div className="flex items-baseline gap-x-2 flex-wrap">
              <h3 className="text-gray-800 text-lg font-semibold">
                {result.className}
              </h3>
            </div>
          )}
          <p className="text-gray-600">{result.definition}</p>
        </div>
      </div>
    </li>
  );
}

function ResultList({ results, tooltip, elapsed }: ResultsView) {
  return (
    <>
      <p className="hidden text-xl font-semibold text-gray-800 mb-4">
        Classification Results
      </p>
      {tooltip !== undefined && <p className="text-gray-600 mb-4">{tooltip}</p>}
      <ul className="space-y-3" role="list">
        {results.map((result, index) => (
          <ResultItem key={index} result={result} index={index} />
        ))}
      </ul>
      <div className="mt-8 text-gray-600">
        {elapsed !== undefined && <span>Finished in {elapsed} seconds.</span>}
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
        <ShareButton />
      </div>
    </>
  );
}

/**
 * Port of app/templates/results.html, without the fragment's page title.
 * It renders preformatted strings only (see toResultsView), so the browser
 * can render it from the results API.
 */
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
