import { z } from "zod";

// polar.v2026_10's Polar() client: the production server, this API version,
// and httpx's five-second timeout.
export const POLAR_CHECKOUTS_URL = "https://api.polar.sh/v1/checkouts/";
const POLAR_API_VERSION = "2026-10";
const TIMEOUT_MS = 5_000;

export type CheckoutRequest = {
  readonly products: readonly [string];
  readonly metadata: Readonly<Record<string, string>>;
  readonly success_url: string;
  readonly customer_email?: string | null;
  readonly customer_name?: string | null;
};

const checkoutSchema = z.object({ url: z.string() });

export class PolarCheckouts {
  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  async create(accessToken: string, request: CheckoutRequest): Promise<string> {
    const response = await this.fetchImpl(POLAR_CHECKOUTS_URL, {
      method: "POST",
      headers: {
        "Polar-Version": POLAR_API_VERSION,
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(request),
      redirect: "manual",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const text = await response.text();
    if (response.status < 200 || response.status > 299) {
      throw new Error(`Polar answered ${response.status}: ${text}`);
    }
    return checkoutSchema.parse(JSON.parse(text)).url;
  }
}
