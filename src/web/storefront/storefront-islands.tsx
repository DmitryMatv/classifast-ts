// Isomorphic. The mapping pages' islands.
import { useEffect, useState, type ReactElement } from "react";
import { useServices } from "../islands/services.js";

const BUY_LABEL = "Buy full mapping file";
const ERROR_LABEL = "Error - Try again";
const ERROR_SHOWN_MS = 3000;

export interface BuyButtonProps {
  readonly slug: string;
  /** Absolute; the product page, so the success banner shows there. */
  readonly returnUrl: string;
  readonly className: string;
}

type BuyState = "idle" | "preparing" | "failed";

export function BuyButton({
  slug,
  returnUrl,
  className,
}: BuyButtonProps): ReactElement {
  const { api, runtime } = useServices();
  const [state, setState] = useState<BuyState>("idle");

  useEffect(() => {
    if (state !== "failed") return;
    const timer = setTimeout(() => setState("idle"), ERROR_SHOWN_MS);
    return () => clearTimeout(timer);
  }, [state]);

  async function buy(): Promise<void> {
    setState("preparing");
    const outcome = await api.mappingCheckout(slug, returnUrl);
    // The button stays "Preparing..." while the browser leaves the page.
    if (outcome.kind === "redirect") runtime.navigate(outcome.url);
    else setState("failed");
  }

  return (
    <button
      type="button"
      className={className}
      disabled={state === "preparing"}
      onClick={() => void buy()}
    >
      {state === "idle"
        ? BUY_LABEL
        : state === "preparing"
          ? "Preparing..."
          : ERROR_LABEL}
    </button>
  );
}

const CHECKOUT_PARAMS = [
  "checkout",
  "checkout_token",
  "customer_session_token",
];

/**
 * The product page's success banner. The server renders it hidden; after
 * hydration `?checkout=success` shows it and leaves the URL without the
 * checkout parameters.
 */
export function CheckoutBanner(): ReactElement {
  const { runtime } = useServices();
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const url = new URL(runtime.href());
    if (url.searchParams.get("checkout") !== "success") return;
    setShown(true);
    for (const name of CHECKOUT_PARAMS) url.searchParams.delete(name);
    runtime.replaceUrl(`${url.pathname}${url.search}${url.hash}`);
  }, [runtime]);

  return (
    <div
      id="storefront-success-message"
      className={`${shown ? "" : "hidden "}mb-6 rounded-[0.8rem] border border-emerald-200 bg-emerald-50 px-5 py-4 text-emerald-800`}
    >
      Checkout started successfully. Polar will handle payment and secure file
      delivery after purchase.
    </div>
  );
}
