import type {
  ApiClient,
  CheckoutOutcome,
} from "../../../../src/web/islands/services.js";

async function checkoutUrl(response: Response): Promise<CheckoutOutcome> {
  if (!response.ok) return { kind: "failed" };
  const body = (await response.json()) as { url?: unknown } | null;
  return typeof body?.url === "string" && body.url !== ""
    ? { kind: "redirect", url: body.url }
    : { kind: "failed" };
}

export function createApiClient(window: Window): ApiClient {
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
        return { kind: "failed" };
      }
    },
  };
}
