import type { BrowserRuntime } from "../../../../src/web/islands/services.js";

function copyBySelection(document: Document, text: string): boolean {
  const area = document.createElement("textarea");
  area.value = text;
  area.style.position = "fixed";
  area.style.opacity = "0";
  const focused = document.activeElement;
  document.body.append(area);
  area.focus();
  area.select();
  try {
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    area.remove();
    if (focused instanceof HTMLElement) focused.focus();
  }
}

function listen<K extends keyof WindowEventMap>(
  window: Window,
  type: K,
  listener: (event: WindowEventMap[K]) => void,
): () => void {
  window.addEventListener(type, listener);
  return () => window.removeEventListener(type, listener);
}

export function createBrowserRuntime(window: Window): BrowserRuntime {
  const { document, history } = window;
  return {
    href: () => window.location.href,
    replaceUrl: (url) => history.replaceState(history.state, "", url),
    navigate: (url) => window.location.assign(url),
    now: () => Date.now(),
    async copyText(text) {
      try {
        await window.navigator.clipboard.writeText(text);
        return true;
      } catch {
        // No clipboard API outside a secure context, or permission denied.
        return copyBySelection(document, text);
      }
    },
    historyState: () => history.state as unknown,
    pushHistory: (state, url) => history.pushState(state, "", url),
    replaceHistory: (state, url) =>
      history.replaceState(state, "", url ?? undefined),
    setTitle: (title) => {
      document.title = title;
    },
    readSession(key) {
      try {
        return window.sessionStorage.getItem(key);
      } catch {
        return null;
      }
    },
    writeSession(key, value) {
      try {
        if (value === null) window.sessionStorage.removeItem(key);
        else window.sessionStorage.setItem(key, value);
      } catch {
        // Storage disabled or full: the record is a convenience.
      }
    },
    onPopState: (listener) =>
      listen(window, "popstate", (event) => listener(event.state)),
    onPageHide: (listener) => listen(window, "pagehide", () => listener()),
    onPageShow: (listener) =>
      listen(window, "pageshow", (event) => listener(event.persisted)),
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
