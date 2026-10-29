// Isomorphic. Islands reach the browser only through this context, never
// through window globals, so the server render imports no browser code and
// tests hydrate islands with fakes instead of module mocks.
import {
  createContext,
  useContext,
  useLayoutEffect,
  type ReactElement,
  type ReactNode,
} from "react";

export type CheckoutOutcome =
  | { readonly kind: "redirect"; readonly url: string }
  | { readonly kind: "failed" };

/** Same-origin JSON API. */
export interface ApiClient {
  /** POST /api/create-mapping-checkout; anonymous. Never rejects. */
  mappingCheckout(slug: string, returnUrl: string): Promise<CheckoutOutcome>;
}

export interface BrowserRuntime {
  href(): string;
  /** Replaces the current URL and keeps history.state. */
  replaceUrl(url: string): void;
  navigate(url: string): void;
}

export interface ClientServices {
  readonly api: ApiClient;
  readonly runtime: BrowserRuntime;
}

function unavailable(): never {
  throw new Error("Island services are unavailable during server rendering");
}

/** The server render's services. Effects never run there, so nothing calls them. */
export const SERVER_SERVICES: ClientServices = {
  api: { mappingCheckout: unavailable },
  runtime: {
    href: unavailable,
    replaceUrl: unavailable,
    navigate: unavailable,
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
