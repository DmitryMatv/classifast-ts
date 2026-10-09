import { Logger } from "@nestjs/common";
import type { AppConfig } from "../config/app-config.js";
import { HttpStatusError } from "../http-status-error.js";
import { urlsplitNetloc } from "../python/urllib.js";
import type { ClerkUsers } from "./clerk-users.js";
import { MAPPING_PRODUCTS } from "./mapping-products.js";
import { PaymentError, proProductNotConfigured } from "./payment-error.js";
import type { CheckoutRequest, PolarCheckouts } from "./polar-checkouts.js";

const logger = new Logger("Payments");

// Python's truthiness for a JSON value.
function truthy(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object" && value !== null) {
    return Object.keys(value).length > 0;
  }
  return Boolean(value);
}

const strictUtf8 = new TextDecoder("utf-8", { fatal: true });

// Starlette's request.json() is json.loads(body), which drops a UTF-8 BOM;
// TextDecoder strips it by default. Anything json.loads rejects ends as a
// 500 there, so the caller lets the SyntaxError through.
function parseBody(body: Buffer): Record<string, unknown> {
  const parsed: unknown = JSON.parse(strictUtf8.decode(body));
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new TypeError("Checkout body is not a JSON object");
  }
  return parsed as Record<string, unknown>;
}

export function validateReturnUrl(
  returnUrl: unknown,
  baseUrl: string,
  extraHosts: readonly string[],
): string | undefined {
  if (!truthy(returnUrl)) return undefined;
  if (typeof returnUrl !== "string") {
    throw new TypeError("return_url is not a string");
  }
  const netloc = urlsplitNetloc(returnUrl);
  const allowedHosts = [urlsplitNetloc(baseUrl) ?? "", ...extraHosts];
  if (!netloc || !allowedHosts.includes(netloc)) {
    logger.warn(
      `Invalid return_url rejected: ${Array.from(returnUrl).slice(0, 50).join("")}`,
    );
    throw new PaymentError(400, "Invalid return_url");
  }
  return returnUrl;
}

function successUrl(returnUrl: string | undefined, baseUrl: string): string {
  const url = returnUrl ?? baseUrl;
  return `${url}${url.includes("?") ? "&" : "?"}checkout=success`;
}

export type CheckoutReply = { readonly url: string };

export class Checkouts {
  constructor(
    private readonly config: AppConfig["polar"],
    private readonly polar: PolarCheckouts,
    private readonly clerkUsers: ClerkUsers,
  ) {}

  async createPro(
    userId: string,
    body: Buffer,
    baseUrl: string,
  ): Promise<CheckoutReply> {
    try {
      const request = parseBody(body);
      const returnUrl = validateReturnUrl(
        request["return_url"],
        baseUrl,
        this.config.allowedRedirectHosts,
      );
      const accessToken = this.#accessToken();
      const productId = this.config.proProductId;
      if (!productId) throw proProductNotConfigured();
      const success = successUrl(returnUrl, baseUrl);
      const customer = await this.clerkUsers.checkoutPrefill(userId);
      const url = await this.polar.create(accessToken, {
        products: [productId],
        metadata: { user_id: userId },
        success_url: success,
        customer_email: customer.email,
        customer_name: customer.name,
      });
      return { url };
    } catch (error) {
      if (error instanceof HttpStatusError) throw error;
      logger.error(`Error creating checkout: ${String(error)}`);
      throw new PaymentError(500, "Failed to create checkout", {
        cause: error,
      });
    }
  }

  async createMapping(body: Buffer, baseUrl: string): Promise<CheckoutReply> {
    try {
      const request = parseBody(body);
      const slug = request["slug"];
      const returnUrl = validateReturnUrl(
        request["return_url"],
        baseUrl,
        this.config.allowedRedirectHosts,
      );
      if (!truthy(slug)) throw new PaymentError(400, "Missing slug");
      // dict.get raises TypeError for an unhashable list or dict slug.
      if (typeof slug === "object") throw new TypeError("unhashable slug");
      const product =
        typeof slug === "string" ? MAPPING_PRODUCTS.get(slug) : undefined;
      if (!product) throw new PaymentError(404, "Mapping product not found");
      const accessToken = this.#accessToken();
      const checkout: CheckoutRequest = {
        products: [product.polarProductId],
        metadata: {
          mapping_slug: product.slug,
          source_standard: product.sourceStandard,
          target_standard: product.targetStandard,
        },
        success_url: successUrl(returnUrl, baseUrl),
      };
      return { url: await this.polar.create(accessToken, checkout) };
    } catch (error) {
      if (error instanceof HttpStatusError) throw error;
      logger.error(
        `Error creating mapping checkout: ${String(error)}`,
        error instanceof Error ? error.stack : undefined,
      );
      throw new PaymentError(500, "Failed to create mapping checkout", {
        cause: error,
      });
    }
  }

  #accessToken(): string {
    const token = this.config.accessToken;
    if (!token)
      throw new PaymentError(500, "Polar Access Token not configured");
    return token;
  }
}
