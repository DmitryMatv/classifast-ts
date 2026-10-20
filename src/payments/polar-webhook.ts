import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { pyFloat } from "../python/numbers.js";
import { PY_WHITESPACE } from "../python/str.js";

// polar/webhooks.py validate_event with the polar.v2026_10 payload types.

const TOLERANCE_SECONDS = 5 * 60;

export class WebhookVerificationError extends Error {}

export class WebhookPayloadError extends Error {}

const SUBSCRIPTION_EVENT_TYPES = [
  "subscription.active",
  "subscription.canceled",
  "subscription.created",
  "subscription.cycled",
  "subscription.migrated",
  "subscription.past_due",
  "subscription.paused",
  "subscription.resumed",
  "subscription.revoked",
  "subscription.uncanceled",
  "subscription.updated",
] as const;

const OTHER_EVENT_TYPES = new Set([
  "benefit.created",
  "benefit.updated",
  "benefit_grant.created",
  "benefit_grant.cycled",
  "benefit_grant.revoked",
  "benefit_grant.updated",
  "checkout.created",
  "checkout.expired",
  "checkout.updated",
  "customer.created",
  "customer.deleted",
  "customer.state_changed",
  "customer.updated",
  "customer_seat.assigned",
  "customer_seat.claimed",
  "customer_seat.revoked",
  "discount.created",
  "discount.deleted",
  "discount.updated",
  "member.created",
  "member.deleted",
  "member.updated",
  "order.created",
  "order.paid",
  "order.refunded",
  "order.updated",
  "organization.updated",
  "product.created",
  "product.updated",
  "refund.created",
  "refund.updated",
]);

export type SubscriptionEventType = (typeof SUBSCRIPTION_EVENT_TYPES)[number];

const nullableString = z.string().nullable();
const integer = z.number().int();
// MetadataOutputType: dict[str, str | int | float | bool]
const metadata = z.record(
  z.string(),
  z.union([z.string(), z.number(), z.boolean()]),
);

// polar.v2026_10.outputs.Subscription. The SDK drops keys it does not
// declare, as z.object does. Nested objects are checked only as far as the
// fields read here.
const subscriptionSchema = z.object({
  created_at: z.string(),
  modified_at: nullableString,
  id: z.string(),
  amount: integer,
  currency: z.string(),
  recurring_interval: z.enum(["day", "week", "month", "year"]),
  recurring_interval_count: integer,
  status: z.enum([
    "incomplete",
    "incomplete_expired",
    "trialing",
    "active",
    "past_due",
    "canceled",
    "unpaid",
    "paused",
  ]),
  current_period_start: z.string(),
  current_period_end: z.string(),
  current_meter_period_start: nullableString,
  current_meter_period_end: nullableString,
  trial_start: nullableString,
  trial_end: nullableString,
  cancel_at_period_end: z.boolean(),
  canceled_at: nullableString,
  started_at: nullableString,
  ends_at: nullableString,
  ended_at: nullableString,
  past_due_at: nullableString.optional(),
  pause_at_period_end: z.boolean(),
  paused_at: nullableString,
  resumes_at: nullableString,
  customer_id: z.string(),
  product_id: z.string(),
  discount_id: nullableString,
  checkout_id: nullableString,
  seats: integer.nullable().optional(),
  units: integer.nullable(),
  customer_cancellation_reason: z
    .enum([
      "customer_service",
      "low_quality",
      "missing_features",
      "switched_service",
      "too_complex",
      "too_expensive",
      "unused",
      "other",
    ])
    .nullable(),
  customer_cancellation_comment: nullableString,
  metadata,
  custom_field_data: z
    .record(
      z.string(),
      z.union([z.string(), z.number(), z.boolean(), z.null()]),
    )
    .nullable()
    .optional(),
  customer: z.object({}),
  product: z.object({ id: z.string() }),
  discount: z.object({}).nullable(),
  prices: z.array(z.object({ id: z.string(), product_id: z.string() })),
  meters: z.array(z.object({})),
  pending_update: z.object({}).nullable(),
});

export type Subscription = z.infer<typeof subscriptionSchema>;

const envelope = {
  timestamp: z.string(),
  api_version: z.string(),
};

const subscriptionEventSchema = z.object({
  ...envelope,
  type: z.enum(SUBSCRIPTION_EVENT_TYPES),
  data: subscriptionSchema,
});

const migratedFieldsSchema = z.object({
  provider: z.string(),
  provider_subscription_id: z.string(),
});

const otherEventSchema = z.object({ ...envelope, data: z.object({}) });

export type WebhookEvent =
  | {
      readonly kind: "subscription";
      readonly type: SubscriptionEventType;
      readonly subscription: Subscription;
    }
  | { readonly kind: "other"; readonly type: string }
  | { readonly kind: "unknown"; readonly type: string };

export type WebhookHeaders = (name: string) => string | undefined;

const strictUtf8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
const SIGNATURE_SEPARATOR = new RegExp(`[${PY_WHITESPACE}]+`, "u");
const BASE64 =
  /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

// base64.b64decode(value, validate=True)
function strictBase64(value: string): Buffer | undefined {
  return BASE64.test(value) ? Buffer.from(value, "base64") : undefined;
}

// A secret works both as its UTF-8 bytes and, without the whsec_ prefix, as
// base64 with the padding restored.
function signingKeys(secret: string): Buffer[] {
  const raw = Buffer.from(secret, "utf8");
  const remainder = secret.replace(/^whsec_/, "");
  const decoded = strictBase64(
    remainder + "=".repeat((4 - (remainder.length % 4)) % 4),
  );
  return decoded && decoded.length > 0 && !decoded.equals(raw)
    ? [raw, decoded]
    : [raw];
}

function verifySignature(
  body: Buffer,
  headers: WebhookHeaders,
  secret: string,
  nowSeconds: number,
): void {
  const id = headers("webhook-id");
  const timestampHeader = headers("webhook-timestamp");
  const signatures = headers("webhook-signature");
  if (!id || !timestampHeader || !signatures) {
    throw new WebhookVerificationError("Missing required headers");
  }
  const timestamp = pyFloat(timestampHeader);
  if (timestamp === undefined || !Number.isFinite(timestamp)) {
    throw new WebhookVerificationError("Invalid signature headers");
  }
  if (timestamp < nowSeconds - TOLERANCE_SECONDS) {
    throw new WebhookVerificationError("Message timestamp too old");
  }
  if (timestamp > nowSeconds + TOLERANCE_SECONDS) {
    throw new WebhookVerificationError("Message timestamp too new");
  }
  // Header values arrive Latin-1 decoded, as Starlette's do, and Python
  // signs their UTF-8 encoding.
  const signedContent = Buffer.concat([
    Buffer.from(`${id}.${Math.floor(timestamp)}.`, "utf8"),
    body,
  ]);
  for (const key of signingKeys(secret)) {
    const expected = createHmac("sha256", key).update(signedContent).digest();
    for (const versioned of signatures.split(SIGNATURE_SEPARATOR)) {
      const comma = versioned.indexOf(",");
      if (comma === -1 || versioned.slice(0, comma) !== "v1") continue;
      const signature = strictBase64(versioned.slice(comma + 1));
      if (
        signature?.length === expected.length &&
        timingSafeEqual(signature, expected)
      ) {
        return;
      }
    }
  }
  throw new WebhookVerificationError("No matching signature found");
}

function parseEvent(text: string): WebhookEvent {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (cause) {
    throw new WebhookPayloadError("Failed to parse webhook payload", { cause });
  }
  const type =
    typeof data === "object" && data !== null && !Array.isArray(data)
      ? (data as Record<string, unknown>)["type"]
      : undefined;
  // Python acknowledges an unknown type only when it is a non-empty string.
  if (typeof type !== "string" || !type) {
    throw new WebhookPayloadError(
      `Unknown webhook event type: ${String(type)}`,
    );
  }
  if ((SUBSCRIPTION_EVENT_TYPES as readonly string[]).includes(type)) {
    const event = subscriptionEventSchema.safeParse(data);
    const migrated =
      type !== "subscription.migrated" ||
      migratedFieldsSchema.safeParse(data).success;
    if (!event.success || !migrated) {
      throw new WebhookPayloadError("Failed to parse webhook payload", {
        cause: event.error,
      });
    }
    return {
      kind: "subscription",
      type: event.data.type,
      subscription: event.data.data,
    };
  }
  if (OTHER_EVENT_TYPES.has(type)) {
    if (!otherEventSchema.safeParse(data).success) {
      throw new WebhookPayloadError("Failed to parse webhook payload");
    }
    return { kind: "other", type };
  }
  return { kind: "unknown", type };
}

export function verifyWebhook(
  body: Buffer,
  headers: WebhookHeaders,
  secret: string,
  nowSeconds: number,
): WebhookEvent {
  let text: string;
  try {
    text = strictUtf8.decode(body);
  } catch (cause) {
    throw new WebhookPayloadError("Failed to parse webhook payload", { cause });
  }
  verifySignature(body, headers, secret, nowSeconds);
  return parseEvent(text);
}
