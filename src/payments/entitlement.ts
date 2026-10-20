import { Logger } from "@nestjs/common";
import { pyStrip } from "../python/str.js";
import type { Tier } from "./clerk-users.js";
import { proProductNotConfigured } from "./payment-error.js";
import type { Subscription, WebhookEvent } from "./polar-webhook.js";

const logger = new Logger("Payments");

export type EntitlementDecision =
  | { readonly action: "keep" }
  | {
      readonly action: "set_tier";
      readonly tier: Tier;
      readonly subscription: Subscription;
    };

const KEEP: EntitlementDecision = { action: "keep" };

const CANDIDATE_KEYS = ["id", "product_id", "polar_product_id"] as const;
const METADATA_PRODUCT_KEYS = [
  "product_id",
  "polar_product_id",
  "product_ids",
  "polar_product_ids",
] as const;

// _normalize_candidate_ids over JSON values: comma-separated strings, lists,
// and the id fields of objects. Numbers and booleans carry no ids.
export function normalizeCandidateIds(value: unknown): Set<string> {
  if (typeof value === "string") {
    return new Set(
      value
        .split(",")
        .map((part) => pyStrip(part))
        .filter(Boolean),
    );
  }
  if (Array.isArray(value)) {
    return new Set(value.flatMap((item) => [...normalizeCandidateIds(item)]));
  }
  if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>;
    return new Set(
      CANDIDATE_KEYS.flatMap((key) =>
        Object.hasOwn(record, key)
          ? [...normalizeCandidateIds(record[key])]
          : [],
      ),
    );
  }
  return new Set();
}

// The parsed Subscription keeps only its declared fields, so of the
// attributes Python probes, product_id, product and prices exist.
export function extractSubscriptionProductIds(
  subscription: Subscription,
): Set<string> {
  const { metadata } = subscription;
  return new Set(
    [
      subscription.product_id,
      ...METADATA_PRODUCT_KEYS.map((key) =>
        Object.hasOwn(metadata, key) ? metadata[key] : undefined,
      ),
      subscription.product,
      subscription.prices,
    ].flatMap((value) => [...normalizeCandidateIds(value)]),
  );
}

function matchesProEntitlement(
  subscription: Subscription,
  proProductId: string | undefined,
): boolean {
  if (!proProductId) {
    logger.error(
      "POLAR_PRO_PRODUCT_ID not configured; refusing entitlement update",
    );
    throw proProductNotConfigured();
  }
  const productIds = extractSubscriptionProductIds(subscription);
  if (productIds.size === 0) {
    logger.warn("Ignoring Polar subscription without product identity");
    return false;
  }
  if (!productIds.has(proProductId)) {
    logger.log(
      `Ignoring Polar subscription outside configured Pro product: ${[...productIds].sort().join(", ")}`,
    );
    return false;
  }
  return true;
}

export function decideEntitlement(
  event: WebhookEvent,
  proProductId: string | undefined,
): EntitlementDecision {
  if (event.kind !== "subscription") return KEEP;
  const { subscription } = event;
  const setTier = (tier: Tier): EntitlementDecision => ({
    action: "set_tier",
    tier,
    subscription,
  });
  switch (event.type) {
    case "subscription.created":
    case "subscription.active":
      return matchesProEntitlement(subscription, proProductId)
        ? setTier("pro")
        : KEEP;
    case "subscription.canceled":
    case "subscription.revoked":
      // The user keeps Pro until Polar's subscription.updated reports the
      // trial or period has ended.
      if (matchesProEntitlement(subscription, proProductId)) {
        logger.log(
          "Subscription canceled - skipping tier update, waiting for trial expiry",
        );
      }
      return KEEP;
    case "subscription.updated":
      break;
    default:
      return KEEP;
  }
  if (!matchesProEntitlement(subscription, proProductId)) return KEEP;
  switch (subscription.status) {
    case "active":
    case "trialing":
      return setTier("pro");
    case "canceled":
    case "unpaid":
    case "past_due":
    case "incomplete_expired":
      return setTier("free");
    case "incomplete":
      logger.log(`Subscription in pending state: ${subscription.status}`);
      return KEEP;
    case "paused":
      logger.warn(`Unknown subscription status: ${subscription.status}`);
      return KEEP;
  }
}
