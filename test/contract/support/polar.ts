import { createHmac, randomUUID } from "node:crypto";

// Standard Webhooks signing as Polar does it: HMAC-SHA256 keyed with the
// secret's UTF-8 bytes over "<id>.<timestamp>.<body>".
export function signWebhook(
  body: string,
  secret: string,
  timestamp = Math.floor(Date.now() / 1000),
): Record<string, string> {
  const id = `contract-${randomUUID()}`;
  const signature = createHmac("sha256", secret)
    .update(`${id}.${timestamp}.${body}`)
    .digest("base64");
  return {
    "content-type": "application/json",
    "webhook-id": id,
    "webhook-timestamp": String(timestamp),
    "webhook-signature": `v1,${signature}`,
  };
}

const createdAt = "2026-10-02T09:00:00Z";
const organizationId = "ae247836-4fc1-42ae-a4a6-3313b5c123d7";
const customerId = "917a921b-2790-43fb-a76b-6848ea973939";
export const nonProProductId = "00000000-0000-4000-8000-000000000000";

const price = {
  created_at: createdAt,
  modified_at: null,
  id: "c2905b01-177c-4e81-a38e-aa350df76e0d",
  source: "catalog",
  amount_type: "fixed",
  price_currency: "usd",
  tax_behavior: "exclusive",
  is_archived: false,
  product_id: nonProProductId,
  price_amount: 1900,
};

// The polar.v2026_10 SDK parser rejects a payload without every field, even
// the null ones.
export function nonProSubscriptionEvent() {
  return {
    type: "subscription.active",
    timestamp: createdAt,
    api_version: "2026-10",
    data: {
      created_at: createdAt,
      modified_at: null,
      id: "6dbd21e0-54c3-4e1b-9985-dded58f52403",
      amount: 1900,
      currency: "usd",
      recurring_interval: "month",
      recurring_interval_count: 1,
      status: "active",
      current_period_start: createdAt,
      current_period_end: "2026-11-02T09:00:00Z",
      current_meter_period_start: null,
      current_meter_period_end: null,
      trial_start: null,
      trial_end: null,
      cancel_at_period_end: false,
      canceled_at: null,
      started_at: createdAt,
      ends_at: null,
      ended_at: null,
      pause_at_period_end: false,
      paused_at: null,
      resumes_at: null,
      customer_id: customerId,
      product_id: nonProProductId,
      discount_id: null,
      checkout_id: "cd1f9dfe-5c58-43b9-beb7-542f048c193d",
      units: null,
      customer_cancellation_reason: null,
      customer_cancellation_comment: null,
      metadata: {},
      customer: {
        id: customerId,
        created_at: createdAt,
        modified_at: null,
        metadata: {},
        email: "contract@example.com",
        email_verified: true,
        type: "individual",
        name: "Contract Suite",
        billing_name: null,
        billing_address: null,
        tax_id: null,
        organization_id: organizationId,
        deleted_at: null,
        first_user_event_at: null,
        avatar_url: null,
      },
      product: {
        id: nonProProductId,
        created_at: createdAt,
        modified_at: null,
        trial_interval: null,
        trial_interval_count: null,
        name: "Contract suite product",
        description: "Not the Pro product",
        visibility: "public",
        recurring_interval: "month",
        recurring_interval_count: 1,
        meter_interval: null,
        meter_interval_count: null,
        is_recurring: true,
        is_archived: false,
        organization_id: organizationId,
        metadata: {},
        is_deletable: false,
        prices: [price],
        benefits: [],
        medias: [],
        attached_custom_fields: [],
      },
      discount: null,
      prices: [price],
      meters: [],
      pending_update: null,
    },
  };
}
