// Isomorphic. Islands reach the browser only through this context, never
// through window globals, so the server render imports no browser code and
// tests hydrate islands with fakes instead of module mocks.
import {
  createContext,
  useContext,
  useLayoutEffect,
  useSyncExternalStore,
  type ReactElement,
  type ReactNode,
} from "react";
import type { ResultsQuery, ResultsResponse } from "../results-api.js";

/**
 * What the page knows about the visitor. `pending` until Clerk settles or a
 * bounded bootstrap stage gives up. It is also the server snapshot, so an
 * island hydrates with the markup the server rendered.
 */
export type AuthSnapshot =
  | { readonly status: "pending" }
  | { readonly status: "signed-out" }
  | {
      readonly status: "signed-in";
      readonly userId: string;
      /** False while Clerk has a user but has lost the session. */
      readonly sessionUsable: boolean;
    }
  /** Clerk failed to load: anonymous, with links to the accounts site. */
  | { readonly status: "unavailable" };

/**
 * Why a sign-in opens. A plain sign-in anywhere on the page drops an
 * Upgrade that waits for one; an `upgrade` sign-in is that wait.
 */
export type SignInPurpose = "plain" | "upgrade";

export interface AuthService {
  /** useSyncExternalStore calls these two unbound. */
  readonly subscribe: (listener: () => void) => () => void;
  readonly getSnapshot: () => AuthSnapshot;
  /** Loads Clerk once per page. Only an island of a page that shows auth calls it. */
  start(): void;
  /** Tells every onSignInRequested listener, then opens Clerk's sign-in or the accounts site. */
  openSignIn(purpose: SignInPurpose): void;
  /** Returns the unsubscribe. */
  onSignInRequested(listener: (purpose: SignInPurpose) => void): () => void;
  openSignUp(): void;
  /** Mounts Clerk's UserButton into an element React renders empty. Returns the unmount. */
  mountUserButton(element: HTMLElement): () => void;
  /** At most once per page, in a top-level window, for a signed-out visitor. */
  openGoogleOneTap(): void;
}

/** The accounts site's own page, which returns the visitor to `returnUrl`. */
export function accountsUrl(
  page: "sign-in" | "sign-up",
  returnUrl: string,
): string {
  return `https://accounts.classifast.com/${page}?redirect_url=${encodeURIComponent(returnUrl)}`;
}

export type CheckoutOutcome =
  | { readonly kind: "redirect"; readonly url: string }
  | { readonly kind: "failed" };

/** Same-origin JSON API. */
export interface ApiClient {
  /** POST /api/create-mapping-checkout; anonymous. Never rejects. */
  mappingCheckout(slug: string, returnUrl: string): Promise<CheckoutOutcome>;
  /**
   * GET /api/results/{type} once auth has settled, as the visitor. A
   * network failure, a body that is not a ResultsResponse and an auth
   * failure all answer `error`. Rejects only when `signal` aborts.
   */
  results(
    classifierType: string,
    query: ResultsQuery,
    signal: AbortSignal,
  ): Promise<ResultsResponse>;
  /**
   * POST /api/create-checkout as the signed-in visitor, bounded by 30 s.
   * Without a bearer token it fails. Rejects only when `signal` aborts.
   */
  checkout(returnUrl: string, signal: AbortSignal): Promise<CheckoutOutcome>;
}

export interface BrowserRuntime {
  href(): string;
  /** Replaces the current URL and keeps history.state. */
  replaceUrl(url: string): void;
  navigate(url: string): void;
  now(): number;
  /** The clipboard, else a selected textarea and execCommand. False when both fail. */
  copyText(text: string): Promise<boolean>;
  historyState(): unknown;
  pushHistory(state: unknown, url: string): void;
  /** A null url keeps the current one. */
  replaceHistory(state: unknown, url: string | null): void;
  setTitle(title: string): void;
  /** sessionStorage; null when the key is missing or storage is unavailable. */
  readSession(key: string): string | null;
  /** Null removes the key. Storage errors are ignored. */
  writeSession(key: string, value: string | null): void;
  /** Each returns the unsubscribe. */
  onPopState(listener: (state: unknown) => void): () => void;
  onPageHide(listener: () => void): () => void;
  onPageShow(listener: (persisted: boolean) => void): () => void;
}

export interface ClientServices {
  readonly auth: AuthService;
  readonly api: ApiClient;
  readonly runtime: BrowserRuntime;
}

function unavailable(): never {
  throw new Error("Island services are unavailable during server rendering");
}

const PENDING: AuthSnapshot = { status: "pending" };

/** The server render's services. Effects never run there, so nothing calls them. */
export const SERVER_SERVICES: ClientServices = {
  auth: {
    subscribe: () => () => {},
    getSnapshot: () => PENDING,
    start: unavailable,
    openSignIn: unavailable,
    onSignInRequested: unavailable,
    openSignUp: unavailable,
    mountUserButton: unavailable,
    openGoogleOneTap: unavailable,
  },
  api: {
    mappingCheckout: unavailable,
    results: unavailable,
    checkout: unavailable,
  },
  runtime: {
    href: unavailable,
    replaceUrl: unavailable,
    navigate: unavailable,
    now: unavailable,
    copyText: unavailable,
    historyState: unavailable,
    pushHistory: unavailable,
    replaceHistory: unavailable,
    setTitle: unavailable,
    readSession: unavailable,
    writeSession: unavailable,
    onPopState: unavailable,
    onPageHide: unavailable,
    onPageShow: unavailable,
  },
};

const ServicesContext = createContext<ClientServices>(SERVER_SERVICES);

/**
 * Wraps every island on both sides, so the server and client trees have
 * the same shape. `restoreEdits` runs once, right after hydration commits:
 * React 19 resets a prefilled textarea to its server text, and the client
 * writes back what the visitor typed before the bundle ran.
 */
export function IslandRoot(props: {
  readonly services: ClientServices;
  readonly restoreEdits: () => void;
  readonly children: ReactNode;
}): ReactElement {
  const { restoreEdits } = props;
  useLayoutEffect(() => restoreEdits(), [restoreEdits]);
  return (
    <ServicesContext.Provider value={props.services}>
      {props.children}
    </ServicesContext.Provider>
  );
}

export function useServices(): ClientServices {
  return useContext(ServicesContext);
}

const serverSnapshot = () => PENDING;

/** The visitor's auth state. Every island hydrates under `pending`. */
export function useAuth(): AuthSnapshot {
  const { auth } = useServices();
  return useSyncExternalStore(auth.subscribe, auth.getSnapshot, serverSnapshot);
}
