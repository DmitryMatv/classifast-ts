import { Logger } from "@nestjs/common";
import type { AppConfig } from "../config/app-config.js";
import type { ClerkUsers } from "./clerk-users.js";
import { decideEntitlement } from "./entitlement.js";
import { PaymentError } from "./payment-error.js";
import {
  verifyWebhook,
  WebhookPayloadError,
  WebhookVerificationError,
  type Subscription,
  type WebhookEvent,
  type WebhookHeaders,
} from "./polar-webhook.js";

const logger = new Logger("Payments");

export type WebhookReply = { readonly status: "received" };

const RECEIVED: WebhookReply = { status: "received" };

export interface TierRecorder {
  recordSubscriptionTier(userId: string, tier: string): Promise<void>;
}

export class PolarWebhooks {
  constructor(
    private readonly config: AppConfig["polar"],
    private readonly clerkUsers: Pick<ClerkUsers, "updateTier">,
    private readonly tiers: TierRecorder,
    private readonly nowSeconds: () => number = () => Date.now() / 1000,
  ) {}

  async handle(
    readBody: () => Promise<Buffer>,
    headers: WebhookHeaders,
  ): Promise<WebhookReply> {
    const secret = this.config.webhookSecret;
    if (!secret) {
      logger.error("POLAR_WEBHOOK_SECRET not set");
      throw new PaymentError(500, "Webhook secret not configured");
    }
    const event = this.#verify(await readBody(), headers, secret);
    if (event.kind === "unknown") {
      logger.log(`Ignoring unsupported Polar webhook type: ${event.type}`);
      return RECEIVED;
    }
    logger.log(`Received Polar webhook: ${event.type}`);
    const decision = decideEntitlement(event, this.config.proProductId);
    if (decision.action === "set_tier") {
      await this.#setTier(decision.subscription, decision.tier);
    }
    return RECEIVED;
  }

  #verify(body: Buffer, headers: WebhookHeaders, secret: string): WebhookEvent {
    try {
      return verifyWebhook(body, headers, secret, this.nowSeconds());
    } catch (error) {
      if (error instanceof WebhookVerificationError) {
        logger.warn(`Webhook verification failed: ${error.message}`);
        throw new PaymentError(403, "Invalid webhook signature");
      }
      if (error instanceof WebhookPayloadError) {
        logger.warn(`Invalid Polar webhook payload: ${error.message}`);
        throw new PaymentError(400, "Invalid webhook payload", {
          cause: error,
        });
      }
      throw error;
    }
  }

  // The tier cache and checkout grace follow Clerk, never lead it.
  async #setTier(subscription: Subscription, tier: "pro" | "free") {
    const userId = subscription.metadata["user_id"];
    if (typeof userId !== "string" || !userId) {
      logger.warn(
        userId
          ? `Ignoring non-string user_id in subscription metadata: ${String(userId)}`
          : "No user_id found in subscription metadata",
      );
      return;
    }
    logger.log(`Updating user ${userId} to tier ${tier}`);
    if (!(await this.clerkUsers.updateTier(userId, tier))) {
      logger.error(
        `Failed to update Clerk metadata for user ${userId}, tier=${tier}`,
      );
      throw new PaymentError(502, "Failed to update user metadata");
    }
    await this.tiers.recordSubscriptionTier(userId, tier);
  }
}
