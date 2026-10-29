import { renderToStaticMarkup } from "react-dom/server";
import type { UsageStatus } from "../usage/quota.js";
import { PaywallPanel, StatusMessage } from "./classifier/paywall-panel.js";
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

// A Pro caller has no limit and never gets the paywall.
export function paywallLimit(usage: UsageStatus): number {
  return usage.kind === "metered" ? usage.limit : -1;
}

export function renderPaywall(usage: UsageStatus): string {
  return renderToStaticMarkup(
    <PaywallPanel
      kind="paywall"
      limit={paywallLimit(usage)}
      signedIn={usage.caller.kind !== "anonymous"}
      upgrade="ready"
      notice={null}
    />,
  );
}

export function renderStatusMessage(message: string): string {
  return renderToStaticMarkup(<StatusMessage message={message} />);
}
