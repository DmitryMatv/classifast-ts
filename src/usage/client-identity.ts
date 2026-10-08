import { createHash, randomUUID } from "node:crypto";

type Headers = Readonly<Record<string, string | string[] | undefined>>;

function header(headers: Headers, name: string): string | undefined {
  const value = headers[name];
  return Array.isArray(value) ? value[0] : value;
}

/**
 * The quota's client IP: Cloudflare's header, then the first X-Forwarded-For
 * hop, then the socket peer. app/google_crawlers.py trusts CF-Connecting-IP
 * only behind an opt-in; this policy always trusts it.
 */
export function clientIp(
  headers: Headers,
  remoteAddress: string | undefined,
): string {
  const cloudflareIp = header(headers, "cf-connecting-ip");
  if (cloudflareIp) return cloudflareIp;
  const forwarded = header(headers, "x-forwarded-for");
  if (forwarded) {
    const [firstHop = ""] = forwarded.split(",");
    return firstHop.trim();
  }
  return remoteAddress ?? "unknown";
}

export function hashIp(ip: string): string {
  return createHash("sha256").update(ip).digest("hex").slice(0, 16);
}

// The spellings Python's uuid.UUID() accepts: optional braces, URN prefix
// and hyphens around 32 hex digits.
function isPythonUuid(value: string): boolean {
  const hex = value
    .replaceAll("urn:", "")
    .replaceAll("uuid:", "")
    .replace(/^[{}]+|[{}]+$/g, "")
    .replaceAll("-", "");
  return /^[0-9a-f]{32}$/i.test(hex);
}

/** The `cf_track` cookie when it holds a UUID, else a fresh one. */
export function trackingId(cookie: string | undefined): string {
  return cookie && isPythonUuid(cookie) ? cookie : randomUUID();
}
