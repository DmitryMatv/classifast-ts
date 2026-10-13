import { renderToStaticMarkup } from "react-dom/server";
import type { UsageStatus } from "../usage/quota.js";
import { jinjaEscape } from "./render.js";
import { Results, type ResultsProps } from "./results.js";

/**
 * Port of app/templates/results.html as a fragment. React 19 hoists a
 * <title> to the front of the markup, so the out-of-band title is written
 * after the results the way Jinja writes it.
 */
export function renderResultsFragment(
  props: ResultsProps,
  pageTitle: string | undefined,
): string {
  const results = renderToStaticMarkup(<Results {...props} />);
  if (pageTitle === undefined) return results;
  return `${results}\n<title id="page-title" hx-swap-oob="true">${jinjaEscape(pageTitle)}</title>\n`;
}

interface PaywallProps {
  readonly limit: number;
  readonly isAuthenticated: boolean;
}

/** Port of app/templates/paywall.html. */
function Paywall({ limit, isAuthenticated }: PaywallProps) {
  return (
    <div
      id="paywall-warning"
      className="bg-white border border-sky-200 rounded-lg p-6 shadow"
    >
      <div className="flex flex-col items-center text-center space-y-4">
        <div className="shrink-0">
          <svg
            className="h-12 w-12 text-sky-600"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            aria-label="Free trial limit reached"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="1.5"
              d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
            />
          </svg>
        </div>
        <div className="space-y-2">
          <h3 className="text-lg font-semibold text-gray-800">
            Free trial limit reached
          </h3>
          {isAuthenticated ? (
            <p className="text-gray-600 max-w-md">
              You&apos;ve used your {limit} free trial searches. Upgrade to Pro
              for unlimited searches.
            </p>
          ) : (
            <p className="text-gray-600 max-w-md">
              You&apos;ve used your free searches. Sign in to continue, or go
              Pro for unlimited searches.
            </p>
          )}
        </div>
        <div
          id="paywall-buttons"
          className="flex flex-col sm:flex-row gap-3 pt-2"
        >
          {!isAuthenticated && (
            <>
              <button
                type="button"
                id="signin-button"
                className="bg-white border border-sky-600 text-sky-600 hover:bg-sky-50 active:bg-sky-100 active:scale-95 px-6 py-2 rounded font-semibold transition-all duration-150 ease-in-out transform cursor-pointer"
              >
                Sign In
              </button>{" "}
            </>
          )}
          <button
            type="button"
            id="upgrade-button"
            className="inline-flex items-center justify-center bg-sky-700 hover:bg-sky-800 active:bg-sky-900 active:scale-95 text-white px-6 py-2 rounded font-semibold transition-all duration-150 ease-in-out transform cursor-pointer"
          >
            <svg
              className="w-4 h-4 mr-2"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              aria-label="Upgrade to Pro"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                d="M13 10V3L4 14h7v7l9-11h-7z"
              />
            </svg>{" "}
            Upgrade to Pro
          </button>
        </div>{" "}
        <button
          type="button"
          id="retry-button"
          className="inline-flex items-center justify-center px-4 py-2 text-sm text-sky-600 hover:text-sky-700 hover:underline transition-colors"
        >
          <svg
            className="w-4 h-4 mr-1"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            aria-label="Retry"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
            />
          </svg>{" "}
          Try again
        </button>
      </div>
    </div>
  );
}

export function renderPaywall(usage: UsageStatus): string {
  return renderToStaticMarkup(
    <Paywall
      limit={usage.kind === "metered" ? usage.limit : -1}
      isAuthenticated={usage.caller.kind !== "anonymous"}
    />,
  );
}

// Python's inline status fragment, classes included.
export function renderStatusMessage(message: string): string {
  return renderToStaticMarkup(
    <div className="bg-white border border-amber-200 rounded-lg p-6 shadow">
      <p className="text-gray-700">{message}</p>
    </div>,
  );
}
