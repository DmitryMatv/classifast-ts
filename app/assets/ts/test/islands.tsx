import { act, type ReactElement } from "react";
import type { Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, vi } from "vitest";
import type {
  AuthService,
  AuthSnapshot,
  CheckoutOutcome,
  ClientServices,
} from "../../../../src/web/islands/services.js";
import { hydrateIslands } from "../hydrate-islands.js";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

export interface FakeAuth extends AuthService {
  /** Each call the islands made, in order, such as "start" or "one-tap". */
  readonly calls: string[];
  /** Elements handed to mountUserButton and not yet unmounted. */
  readonly userButtons: Set<HTMLElement>;
  /** Publishes a new snapshot, as Clerk's listener would. */
  set(snapshot: AuthSnapshot): Promise<void>;
}

export function fakeAuth(): FakeAuth {
  const listeners = new Set<() => void>();
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
    openSignIn: () => void calls.push("sign-in"),
    openSignUp: () => void calls.push("sign-up"),
    openGoogleOneTap: () => void calls.push("one-tap"),
    mountUserButton(element) {
      userButtons.add(element);
      return () => void userButtons.delete(element);
    },
  };
}

export interface FakeServices extends ClientServices {
  readonly auth: FakeAuth;
  readonly checkouts: [slug: string, returnUrl: string][];
  readonly navigations: string[];
  readonly replacedUrls: string[];
}

export function fakeServices(
  options: {
    readonly href?: string;
    readonly checkout?: () => Promise<CheckoutOutcome>;
  } = {},
): FakeServices {
  const checkouts: [string, string][] = [];
  const navigations: string[] = [];
  const replacedUrls: string[] = [];
  return {
    checkouts,
    navigations,
    replacedUrls,
    auth: fakeAuth(),
    api: {
      mappingCheckout(slug, returnUrl) {
        checkouts.push([slug, returnUrl]);
        return options.checkout?.() ?? Promise.resolve({ kind: "failed" });
      },
    },
    runtime: {
      href: () => options.href ?? "https://classifast.test/",
      replaceUrl: (url) => replacedUrls.push(url),
      navigate: (url) => navigations.push(url),
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
