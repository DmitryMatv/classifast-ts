// The one owner of Clerk on a page. Clerk keeps the session token fresh by
// itself: its token cache refreshes a token before it expires, and it polls
// and refreshes on focus. So nothing here refreshes on a timer.
import {
  accountsUrl,
  type AuthService,
  type AuthSnapshot,
  type BrowserRuntime,
  type SignInPurpose,
} from "../../../../src/web/islands/services.js";

export const CLERK_UI_SRC =
  "https://clerk.classifast.com/npm/@clerk/ui@1/dist/ui.browser.js";
export const CLERK_JS_SRC =
  "https://clerk.classifast.com/npm/@clerk/clerk-js@6/dist/clerk.browser.js";
const CLERK_PUBLISHABLE_KEY = "pk_live_Y2xlcmsuY2xhc3NpZmFzdC5jb20k";

/** Bounds each bootstrap stage and each token request. */
export const STAGE_TIMEOUT_MS = 10_000;

const USER_BUTTON_APPEARANCE = {
  elements: {
    userButtonTrigger:
      "inline-flex h-9 w-9 items-center justify-center overflow-hidden rounded-full border-0 bg-transparent p-0 leading-none shadow-none outline-none hover:bg-transparent focus:bg-transparent focus:shadow-none focus:outline-none active:bg-transparent active:shadow-none focus-visible:bg-transparent focus-visible:shadow-none focus-visible:outline-none focus-visible:ring-0",
    userButtonAvatarBox:
      "h-9 w-9 rounded-full overflow-hidden border-0 bg-transparent p-0 shadow-none",
    userButtonBox:
      "h-9 w-9 rounded-full overflow-hidden border-0 bg-transparent p-0 shadow-none",
  },
};

/** The part of clerk.browser.js's `window.Clerk` this service uses. */
interface Clerk {
  readonly user?: { readonly id: string } | null;
  readonly session?: { getToken(): Promise<string | null> } | null;
  load(options: { ui: { ClerkUI: unknown } }): Promise<void>;
  addListener(listener: () => void): () => void;
  mountUserButton(element: HTMLElement, options: object): void;
  unmountUserButton(element: HTMLElement): void;
  openSignIn(options: { redirectUrl: string }): void;
  openSignUp(options: { redirectUrl: string }): void;
  openGoogleOneTap(params: object): void;
}

interface ClerkGlobals {
  readonly Clerk?: Clerk;
  readonly __internal_ClerkUICtor?: unknown;
}

export const AUTH_FAILED_MESSAGE = "Authentication failed. Please try again.";

export class AuthUnavailableError extends Error {
  override readonly name = "AuthUnavailableError";
  constructor() {
    super(AUTH_FAILED_MESSAGE);
  }
}

export type Authorization =
  | { readonly kind: "anonymous" }
  | { readonly kind: "bearer"; readonly token: string };

/** The auth service plus the one method only the API client may call. */
export interface ClientAuth extends AuthService {
  /**
   * Waits until the snapshot settles. A signed-out or unavailable visitor
   * is anonymous. A signed-in visitor gets a fresh token, or the last
   * unexpired one for the same user, and is never sent anonymously: without
   * either it throws AuthUnavailableError.
   */
  authorization(signal: AbortSignal): Promise<Authorization>;
}

const SIGNED_OUT: AuthSnapshot = { status: "signed-out" };
const UNAVAILABLE: AuthSnapshot = { status: "unavailable" };
const ANONYMOUS: Authorization = { kind: "anonymous" };

function sameSnapshot(left: AuthSnapshot, right: AuthSnapshot): boolean {
  if (left.status !== "signed-in" || right.status !== "signed-in") {
    return left.status === right.status;
  }
  return (
    left.userId === right.userId && left.sessionUsable === right.sessionUsable
  );
}

function snapshotOf(clerk: Clerk): AuthSnapshot {
  return clerk.user
    ? {
        status: "signed-in",
        userId: clerk.user.id,
        sessionUsable: Boolean(clerk.session),
      }
    : SIGNED_OUT;
}

function abortable<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
    work
      .then(resolve, reject)
      .finally(() => signal.removeEventListener("abort", onAbort));
  });
}

export function createAuthService(
  window: Window,
  runtime: Pick<BrowserRuntime, "href" | "navigate">,
): ClientAuth {
  const globals = window as unknown as ClerkGlobals;
  const listeners = new Set<() => void>();
  const signInListeners = new Set<(purpose: SignInPurpose) => void>();
  let snapshot: AuthSnapshot = { status: "pending" };
  let markSettled = () => {};
  const settled = new Promise<void>((resolve) => (markSettled = resolve));
  let started = false;
  /** Set once Clerk has loaded; null while pending and when unavailable. */
  let clerk: Clerk | null = null;
  let ClerkUI: unknown;
  let lastToken: { readonly userId: string; readonly token: string } | null =
    null;
  let oneTapOpened = false;

  function publish(next: AuthSnapshot): void {
    if (sameSnapshot(snapshot, next)) return;
    snapshot = next;
    markSettled();
    for (const listener of listeners) listener();
  }

  function withTimeout<T>(work: Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = window.setTimeout(
        () => reject(new Error("Timed out waiting for Clerk")),
        STAGE_TIMEOUT_MS,
      );
      work.then(resolve, reject).finally(() => window.clearTimeout(timer));
    });
  }

  function loadScript(
    src: string,
    attributes: Record<string, string> = {},
  ): Promise<void> {
    const script = window.document.createElement("script");
    script.src = src;
    script.crossOrigin = "anonymous";
    for (const [name, value] of Object.entries(attributes)) {
      script.setAttribute(name, value);
    }
    const loaded = new Promise<void>((resolve, reject) => {
      script.addEventListener("load", () => resolve(), { once: true });
      script.addEventListener(
        "error",
        () => reject(new Error(`${src} failed to load`)),
        { once: true },
      );
    });
    window.document.head.append(script);
    return loaded;
  }

  function expired(token: string): boolean {
    try {
      const payload = token.split(".")[1] ?? "";
      const { exp } = JSON.parse(
        window.atob(payload.replaceAll("-", "+").replaceAll("_", "/")),
      ) as { exp?: unknown };
      return typeof exp !== "number" || exp * 1000 <= Date.now();
    } catch {
      return true;
    }
  }

  /** Clerk's cached token for the current session, recovering a lost session once. */
  async function sessionToken(loaded: Clerk): Promise<string | null> {
    if (!loaded.session && loaded.user) {
      await loaded.load({ ui: { ClerkUI } });
    }
    const userId = loaded.user?.id;
    const token = (await loaded.session?.getToken()) ?? null;
    if (token && userId && loaded.user?.id === userId && !expired(token)) {
      lastToken = { userId, token };
    }
    return token;
  }

  // The two script loads run at once; a script error fails at once.
  async function bootstrap(): Promise<AuthSnapshot> {
    await withTimeout(
      Promise.all([
        loadScript(CLERK_UI_SRC),
        loadScript(CLERK_JS_SRC, {
          "data-clerk-publishable-key": CLERK_PUBLISHABLE_KEY,
        }),
      ]),
    );
    const loaded = globals.Clerk;
    ClerkUI = globals.__internal_ClerkUICtor;
    if (!loaded || !ClerkUI) throw new Error("Clerk's scripts set no globals");
    await withTimeout(loaded.load({ ui: { ClerkUI } }));
    await withTimeout(sessionToken(loaded).catch(() => null));
    clerk = loaded;
    loaded.addListener(() => publish(snapshotOf(loaded)));
    return snapshotOf(loaded);
  }

  function topLevel(): boolean {
    try {
      return window.top === window.self;
    } catch {
      return false;
    }
  }

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => snapshot,
    start() {
      if (started) return;
      started = true;
      bootstrap().then(publish, (error: unknown) => {
        console.warn("Clerk is unavailable; showing accounts links", error);
        publish(UNAVAILABLE);
      });
    },
    openSignIn(purpose) {
      for (const listener of signInListeners) listener(purpose);
      if (clerk) clerk.openSignIn({ redirectUrl: runtime.href() });
      else runtime.navigate(accountsUrl("sign-in", runtime.href()));
    },
    onSignInRequested(listener) {
      signInListeners.add(listener);
      return () => signInListeners.delete(listener);
    },
    openSignUp() {
      if (clerk) clerk.openSignUp({ redirectUrl: runtime.href() });
      else runtime.navigate(accountsUrl("sign-up", runtime.href()));
    },
    mountUserButton(element) {
      const loaded = clerk;
      if (!loaded) return () => {};
      // Called from an effect: a throw there would unmount the whole header.
      try {
        loaded.mountUserButton(element, { appearance: USER_BUTTON_APPEARANCE });
      } catch (error) {
        console.error("Could not mount Clerk's user button", error);
      }
      return () => loaded.unmountUserButton(element);
    },
    openGoogleOneTap() {
      if (oneTapOpened || !clerk || snapshot.status !== "signed-out") return;
      if (!topLevel()) return;
      oneTapOpened = true;
      try {
        clerk.openGoogleOneTap({
          cancelOnTapOutside: false,
          itpSupport: true,
          fedCmSupport: true,
        });
      } catch (error) {
        console.error("Could not open Google One Tap", error);
      }
    },
    async authorization(signal) {
      await abortable(settled, signal);
      const loaded = clerk;
      if (snapshot.status !== "signed-in" || !loaded) return ANONYMOUS;
      const { userId } = snapshot;
      let token: string | null = null;
      try {
        token = await abortable(withTimeout(sessionToken(loaded)), signal);
      } catch {
        signal.throwIfAborted();
      }
      if (loaded.user?.id === userId) {
        if (token && !expired(token)) return { kind: "bearer", token };
        if (lastToken?.userId === userId && !expired(lastToken.token)) {
          return { kind: "bearer", token: lastToken.token };
        }
      }
      throw new AuthUnavailableError();
    },
  };
}
