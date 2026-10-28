import { act, type ReactElement } from "react";
import type { Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, vi } from "vitest";
import type {
  AuthService,
  AuthSnapshot,
  CheckoutOutcome,
  ClientServices,
  SignInPurpose,
} from "../../../../src/web/islands/services.js";
import type {
  ResultsQuery,
  ResultsResponse,
} from "../../../../src/web/results-api.js";
import { hydrateIslands } from "../hydrate-islands.js";
import { createBrowserRuntime } from "../services/runtime.js";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

export interface FakeAuth extends AuthService {
  /** Each call the islands made, in order, such as "start" or "sign-in:plain". */
  readonly calls: string[];
  /** Elements handed to mountUserButton and not yet unmounted. */
  readonly userButtons: Set<HTMLElement>;
  /** Publishes a new snapshot, as Clerk's listener would. */
  set(snapshot: AuthSnapshot): Promise<void>;
}

export function fakeAuth(): FakeAuth {
  const listeners = new Set<() => void>();
  const signInListeners = new Set<(purpose: SignInPurpose) => void>();
  const calls: string[] = [];
  const userButtons = new Set<HTMLElement>();
  let snapshot: AuthSnapshot = { status: "pending" };
  return {
    calls,
    userButtons,
    async set(next) {
      await act(async () => {
        snapshot = next;
        for (const listener of listeners) listener();
      });
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => snapshot,
    start: () => void calls.push("start"),
    openSignIn(purpose) {
      calls.push(`sign-in:${purpose}`);
      for (const listener of signInListeners) listener(purpose);
    },
    onSignInRequested(listener) {
      signInListeners.add(listener);
      return () => signInListeners.delete(listener);
    },
    openSignUp: () => void calls.push("sign-up"),
    openGoogleOneTap: () => void calls.push("one-tap"),
    mountUserButton(element) {
      userButtons.add(element);
      return () => void userButtons.delete(element);
    },
  };
}

export interface ResultsCall {
  readonly classifierType: string;
  readonly query: ResultsQuery;
  readonly signal: AbortSignal;
}

export interface FakeServices extends ClientServices {
  readonly auth: FakeAuth;
  readonly checkouts: [slug: string, returnUrl: string][];
  /** Each api.results call, in order. */
  readonly lookups: ResultsCall[];
  /** Each api.checkout return URL, in order. */
  readonly upgrades: string[];
  readonly navigations: string[];
  readonly replacedUrls: string[];
}

/**
 * Fakes for the API, auth and navigation. The rest of the runtime is the
 * real one over jsdom's window: history, title, sessionStorage, clipboard.
 */
export function fakeServices(
  options: {
    /** Fixed; otherwise jsdom's location.href. */
    readonly href?: string;
    readonly checkout?: () => Promise<CheckoutOutcome>;
    /** Unanswered by default. */
    readonly results?: (call: ResultsCall) => Promise<ResultsResponse>;
    readonly upgrade?: (returnUrl: string) => Promise<CheckoutOutcome>;
  } = {},
): FakeServices {
  const checkouts: [string, string][] = [];
  const lookups: ResultsCall[] = [];
  const upgrades: string[] = [];
  const navigations: string[] = [];
  const replacedUrls: string[] = [];
  return {
    checkouts,
    lookups,
    upgrades,
    navigations,
    replacedUrls,
    auth: fakeAuth(),
    api: {
      mappingCheckout(slug, returnUrl) {
        checkouts.push([slug, returnUrl]);
        return options.checkout?.() ?? Promise.resolve({ kind: "failed" });
      },
      results(classifierType, query, signal) {
        const call = { classifierType, query, signal };
        lookups.push(call);
        return options.results?.(call) ?? new Promise(() => {});
      },
      checkout(returnUrl) {
        upgrades.push(returnUrl);
        return (
          options.upgrade?.(returnUrl) ?? Promise.resolve({ kind: "failed" })
        );
      },
    },
    runtime: {
      ...createBrowserRuntime(window),
      href: () => options.href ?? window.location.href,
      replaceUrl: (url) => void replacedUrls.push(url),
      navigate: (url) => void navigations.push(url),
    },
  };
}

let mounted: Root[] = [];

afterEach(() => {
  act(() => mounted.forEach((root) => root.unmount()));
  mounted = [];
});

/**
 * Puts the server's markup for `page` in the document, hydrates it, and
 * returns every error React or the page reported meanwhile. React reports a
 * hydration mismatch through console.error or a window error event.
 */
export function hydratePage(
  page: ReactElement,
  services: ClientServices,
): Promise<unknown[]> {
  return hydrateHtml(renderToStaticMarkup(page), services);
}

export async function hydrateHtml(
  html: string,
  services: ClientServices,
): Promise<unknown[]> {
  document.body.innerHTML = html;
  const errors: unknown[] = [];
  const onError = (event: ErrorEvent) => errors.push(event.error);
  window.addEventListener("error", onError);
  const consoleError = vi
    .spyOn(console, "error")
    .mockImplementation((...args: unknown[]) => errors.push(args));
  try {
    await act(async () => {
      mounted.push(...hydrateIslands(document, services));
    });
  } finally {
    window.removeEventListener("error", onError);
    consoleError.mockRestore();
  }
  return errors;
}

export async function click(element: Element): Promise<void> {
  await act(async () => {
    element.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true }),
    );
  });
}

export async function press(key: string): Promise<void> {
  await act(async () => {
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key, bubbles: true }),
    );
  });
}

export function element<E extends Element = HTMLElement>(selector: string): E {
  const found = document.querySelector<E>(selector);
  if (!found) throw new Error(`no element matches ${selector}`);
  return found;
}
