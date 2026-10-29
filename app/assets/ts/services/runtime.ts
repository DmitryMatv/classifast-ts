import type { BrowserRuntime } from "../../../../src/web/islands/services.js";

export function createBrowserRuntime(window: Window): BrowserRuntime {
  return {
    href: () => window.location.href,
    replaceUrl: (url) =>
      window.history.replaceState(window.history.state, "", url),
    navigate: (url) => window.location.assign(url),
  };
}

/**
 * Polar's return URL carries checkout_token and customer_session_token.
 * They leave the address bar, and with it history and shared links, before
 * any island runs. checkout=success stays for the islands that read it.
 */
export function stripCheckoutSecrets(window: Window): void {
  const url = new URL(window.location.href);
  const secrets = ["checkout_token", "customer_session_token"];
  if (!secrets.some((name) => url.searchParams.has(name))) return;
  for (const name of secrets) url.searchParams.delete(name);
  window.history.replaceState(
    window.history.state,
    "",
    `${url.pathname}${url.search}${url.hash}`,
  );
}
