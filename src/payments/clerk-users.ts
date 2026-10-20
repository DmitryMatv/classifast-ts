import { Logger } from "@nestjs/common";
import { z } from "zod";
import { pyStrip } from "../python/str.js";

const logger = new Logger("Payments");

const CLERK_API_URL = "https://api.clerk.com/v1";
const CLERK_API_VERSION = "2025-11-10";
const TIMEOUT_MS = 10_000;

export type Tier = "pro" | "free";

export type CheckoutPrefill = {
  readonly email: string | null;
  readonly name: string | null;
};

const NO_PREFILL: CheckoutPrefill = { email: null, name: null };

const userSchema = z.object({
  email_addresses: z
    .array(z.object({ id: z.string(), email_address: z.string() }))
    .default([]),
  primary_email_address_id: z.string().nullish(),
  first_name: z.string().nullish(),
  last_name: z.string().nullish(),
});

function prefillFrom(user: z.infer<typeof userSchema>): CheckoutPrefill {
  const emails = user.email_addresses;
  const primary = emails.find(
    (email) => email.id === user.primary_email_address_id,
  );
  const name = pyStrip(`${user.first_name || ""} ${user.last_name || ""}`);
  return {
    email: (primary ?? emails[0])?.email_address ?? null,
    name: name || null,
  };
}

// The Clerk Backend API calls of app/payments.py.
export class ClerkUsers {
  constructor(
    private readonly secretKey: string | undefined,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async checkoutPrefill(userId: string): Promise<CheckoutPrefill> {
    if (!this.secretKey) {
      logger.warn("CLERK_SECRET_KEY missing, cannot fetch user details");
      return NO_PREFILL;
    }
    try {
      const response = await this.#request(`users/${userId}`, this.secretKey);
      const body = await response.text();
      if (response.status !== 200) {
        logger.warn(`Failed to fetch Clerk user details: ${response.status}`);
        return NO_PREFILL;
      }
      return prefillFrom(userSchema.parse(JSON.parse(body)));
    } catch (error) {
      logger.error(`Error fetching Clerk user details: ${String(error)}`);
      return NO_PREFILL;
    }
  }

  // A network failure propagates, as httpx's does in Python.
  async updateTier(userId: string, tier: Tier): Promise<boolean> {
    if (!this.secretKey) {
      logger.error("CLERK_SECRET_KEY missing, cannot update user metadata");
      return false;
    }
    const response = await this.#request(
      `users/${userId}/metadata`,
      this.secretKey,
      { method: "PATCH", body: { public_metadata: { tier } } },
    );
    await response.arrayBuffer();
    if (response.status === 200) {
      logger.log(`Successfully updated Clerk metadata for user ${userId}`);
      return true;
    }
    logger.error(`Failed to update Clerk metadata: ${response.status}`);
    return false;
  }

  #request(
    path: string,
    secretKey: string,
    { method = "GET", body }: { method?: string; body?: unknown } = {},
  ): Promise<Response> {
    return this.fetchImpl(`${CLERK_API_URL}/${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${secretKey}`,
        "Clerk-API-Version": CLERK_API_VERSION,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  }
}
