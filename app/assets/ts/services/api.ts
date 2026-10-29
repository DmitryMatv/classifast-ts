// Client-only. Same-origin JSON calls, with auth attached in one place.
import type {
  ApiClient,
  CheckoutOutcome,
} from "../../../../src/web/islands/services.js";
import {
  parseResultsResponse,
  resultsApiPath,
  type ResultsResponse,
} from "../../../../src/web/results-api.js";
import {
  AUTH_FAILED_MESSAGE,
  type Authorization,
  type ClientAuth,
} from "./auth.js";

const CHECKOUT_TIMEOUT_MS = 30_000;
const FAILED: CheckoutOutcome = { kind: "failed" };
const NETWORK_ERROR: ResultsResponse = {
  kind: "error",
  message: "Network error. Check your connection and try again.",
};
const UNEXPECTED_ANSWER: ResultsResponse = {
  kind: "error",
  message: "Something went wrong. Please try again.",
};

const TRACKING_COOKIE = "cf_track";
// A year, the TTL of the anonymous usage counters in Redis.
const TRACKING_MAX_AGE_SECONDS = 365 * 24 * 60 * 60;

function uuidV4(crypto: Crypto): string {
  // randomUUID exists only in secure contexts.
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * The anonymous quota key. The server never sets cookies, so HTML stays
 * cacheable; the browser writes it once, before its first lookup.
 */
export function ensureTrackingCookie(document: Document, crypto: Crypto): void {
  const present = document.cookie
    .split("; ")
    .some((row) => row.startsWith(`${TRACKING_COOKIE}=`));
  if (present) return;
  document.cookie = `${TRACKING_COOKIE}=${encodeURIComponent(uuidV4(crypto))}; max-age=${TRACKING_MAX_AGE_SECONDS}; path=/; secure; samesite=lax`;
}

function authorizationHeaders(
  authorization: Authorization,
): Record<string, string> {
  return authorization.kind === "bearer"
    ? { Authorization: `Bearer ${authorization.token}` }
    : {};
}

async function checkoutUrl(response: Response): Promise<CheckoutOutcome> {
  if (!response.ok) return FAILED;
  const body = (await response.json()) as { url?: unknown } | null;
  return typeof body?.url === "string" && body.url !== ""
    ? { kind: "redirect", url: body.url }
    : FAILED;
}

export function createApiClient(
  window: Window,
  auth: Pick<ClientAuth, "authorization">,
): ApiClient {
  return {
    async mappingCheckout(slug, returnUrl) {
      try {
        const response = await window.fetch("/api/create-mapping-checkout", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ slug, return_url: returnUrl }),
        });
        return await checkoutUrl(response);
      } catch {
        return FAILED;
      }
    },

    async results(classifierType, query, signal) {
      let authorization: Authorization;
      try {
        authorization = await auth.authorization(signal);
      } catch {
        signal.throwIfAborted();
        return { kind: "error", message: AUTH_FAILED_MESSAGE };
      }
      ensureTrackingCookie(window.document, window.crypto);
      let response: Response;
      try {
        response = await window.fetch(resultsApiPath(classifierType, query), {
          headers: authorizationHeaders(authorization),
          signal,
        });
      } catch {
        signal.throwIfAborted();
        return NETWORK_ERROR;
      }
      try {
        return parseResultsResponse(await response.json()) ?? UNEXPECTED_ANSWER;
      } catch {
        signal.throwIfAborted();
        // A proxy's HTML error page, or a body cut off mid-stream.
        return UNEXPECTED_ANSWER;
      }
    },

    async checkout(returnUrl, signal) {
      const bounded = new AbortController();
      const timer = window.setTimeout(
        () => bounded.abort(),
        CHECKOUT_TIMEOUT_MS,
      );
      const abort = () => bounded.abort(signal.reason);
      signal.addEventListener("abort", abort, { once: true });
      try {
        signal.throwIfAborted();
        const authorization = await auth.authorization(bounded.signal);
        if (authorization.kind !== "bearer") return FAILED;
        const response = await window.fetch("/api/create-checkout", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...authorizationHeaders(authorization),
          },
          body: JSON.stringify({ return_url: returnUrl }),
          signal: bounded.signal,
        });
        return await checkoutUrl(response);
      } catch {
        signal.throwIfAborted();
        return FAILED;
      } finally {
        window.clearTimeout(timer);
        signal.removeEventListener("abort", abort);
      }
    },
  };
}
