import { createHash } from "node:crypto";
import { pyStrip } from "../python/str.js";

export interface ClientAddress {
  readonly cfConnectingIp: string | undefined;
  readonly xForwardedFor: string | undefined;
  readonly peerHost: string | undefined;
}

export function clientIp({
  cfConnectingIp,
  xForwardedFor,
  peerHost,
}: ClientAddress): string {
  if (cfConnectingIp) return cfConnectingIp;
  if (xForwardedFor) return pyStrip(xForwardedFor.split(",")[0]!);
  return peerHost ?? "unknown";
}

export function hashIp(ip: string): string {
  return createHash("sha256").update(ip, "utf8").digest("hex").slice(0, 16);
}

export type UsageCounterOwner =
  | {
      readonly kind: "anonymous";
      readonly trackingId: string;
      readonly ipHash: string;
    }
  | { readonly kind: "signedIn"; readonly userId: string };

export function usageCounterKeys(owner: UsageCounterOwner): string[] {
  return owner.kind === "anonymous"
    ? [
        `anon:${owner.trackingId}:usage_count`,
        `anon:ip:${owner.ipHash}:usage_count`,
      ]
    : [`user:${owner.userId}:usage_count`];
}

export function checkoutGraceKey(userId: string): string {
  return `checkout_grace:${userId}`;
}

export function userTierKey(userId: string): string {
  return `user_tier:${userId}`;
}

export function checkoutRateLimitKey(ipHash: string): string {
  return `checkout_rl:${ipHash}`;
}
