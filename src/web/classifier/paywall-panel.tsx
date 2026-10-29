// Isomorphic. The answers the results panel shows besides results. One
// source for the classifier island and, until unit 5 deletes it, the
// static fragment, whose ids the legacy paywall.js drives.
import type { ReactElement } from "react";
import type { UpgradeButtonView } from "./paywall-machine.js";

const ACTIVATION_HEADING = "Payment activation is pending";
const ACTIVATION_CHECKING =
  "Payment activation is pending. Checking automatically...";
export const ACTIVATION_STILL_PENDING =
  "Payment activation is still pending. Try again.";

export type PaywallPanelProps =
  | {
      readonly kind: "paywall";
      readonly signedIn: boolean;
      readonly limit: number;
      readonly upgrade: UpgradeButtonView;
      /** A stopped activation's notice, which replaces the heading and copy. */
      readonly notice: string | null;
      readonly onSignIn?: () => void;
      readonly onUpgrade?: () => void;
      readonly onRetry?: () => void;
    }
  | {
      readonly kind: "activation";
      readonly phase: "checking" | "delayed" | "stopped";
      readonly onRetry?: () => void;
    };

function LockIcon() {
  return (
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
  );
}

function UpgradeLabel({ view }: { readonly view: UpgradeButtonView }) {
  if (view === "preparing") return "Preparing...";
  if (view === "failed") return "Error - Try again";
  return (
    <>
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
    </>
  );
}

function RetryButton(props: {
  readonly disabled: boolean;
  readonly onRetry: (() => void) | undefined;
}) {
  return (
    <button
      type="button"
      id="retry-button"
      className="inline-flex items-center justify-center px-4 py-2 text-sm text-sky-600 hover:text-sky-700 hover:underline transition-colors"
      disabled={props.disabled}
      onClick={props.onRetry}
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
  );
}

/**
 * Port of app/templates/paywall.html. Sign In shows only to an anonymous
 * visitor. While an activation is checking or delayed, the card says so,
 * hides Upgrade and Sign In, and enables Try again only once delayed;
 * after it stopped, the paywall comes back with the notice.
 */
export function PaywallPanel(props: PaywallPanelProps): ReactElement {
  const checking = props.kind === "activation" && props.phase === "checking";
  const notice =
    props.kind === "paywall"
      ? props.notice
      : checking
        ? ACTIVATION_CHECKING
        : ACTIVATION_STILL_PENDING;
  return (
    <div
      id="paywall-warning"
      className="bg-white border border-sky-200 rounded-lg p-6 shadow"
    >
      <div className="flex flex-col items-center text-center space-y-4">
        <div className="shrink-0">
          <LockIcon />
        </div>
        <div className="space-y-2">
          <h3 className="text-lg font-semibold text-gray-800">
            {notice === null ? "Free trial limit reached" : ACTIVATION_HEADING}
          </h3>
          {notice !== null ? (
            <p className="text-gray-600 max-w-md" role="status">
              {notice}
            </p>
          ) : props.kind === "paywall" && props.signedIn ? (
            <p className="text-gray-600 max-w-md">
              You&apos;ve used your {props.limit} free trial searches. Upgrade
              to Pro for unlimited searches.
            </p>
          ) : (
            <p className="text-gray-600 max-w-md">
              You&apos;ve used your free searches. Sign in to continue, or go
              Pro for unlimited searches.
            </p>
          )}
        </div>
        {props.kind === "paywall" && (
          <>
            <div
              id="paywall-buttons"
              className="flex flex-col sm:flex-row gap-3 pt-2"
            >
              {!props.signedIn && (
                <>
                  <button
                    type="button"
                    id="signin-button"
                    className="bg-white border border-sky-600 text-sky-600 hover:bg-sky-50 active:bg-sky-100 active:scale-95 px-6 py-2 rounded font-semibold transition-all duration-150 ease-in-out transform cursor-pointer"
                    onClick={props.onSignIn}
                  >
                    Sign In
                  </button>{" "}
                </>
              )}
              <button
                type="button"
                id="upgrade-button"
                className="inline-flex items-center justify-center bg-sky-700 hover:bg-sky-800 active:bg-sky-900 active:scale-95 text-white px-6 py-2 rounded font-semibold transition-all duration-150 ease-in-out transform cursor-pointer"
                disabled={props.upgrade === "preparing"}
                onClick={props.onUpgrade}
              >
                <UpgradeLabel view={props.upgrade} />
              </button>
            </div>{" "}
          </>
        )}
        <RetryButton disabled={checking} onRetry={props.onRetry} />
      </div>
    </div>
  );
}

/** Python's inline status card: busy, and an error the server or the network gave. */
export function StatusMessage(props: {
  readonly message: string;
}): ReactElement {
  return (
    <div className="bg-white border border-amber-200 rounded-lg p-6 shadow">
      <p className="text-gray-700">{props.message}</p>
    </div>
  );
}
