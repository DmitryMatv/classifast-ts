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

// Python's int(text, 16): surrounding whitespace, a plus sign, a 0x
// prefix, any Unicode decimal digit, and single underscores between digits.
const PYTHON_SPACE = String.raw`[\t\n\v\f\r \x85\xa0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]`;
const PYTHON_HEX_INT = new RegExp(
  String.raw`^${PYTHON_SPACE}*\+?(?:0x_?)?[\p{Nd}a-f]+(?:_[\p{Nd}a-f]+)*${PYTHON_SPACE}*$`,
  "iu",
);

// Python's uuid.UUID() drops "urn:", "uuid:", outer braces and hyphens, then
// needs 32 code points that int(text, 16) parses.
function isPythonUuid(value: string): boolean {
  const hex = value
    .replaceAll("urn:", "")
    .replaceAll("uuid:", "")
    .replace(/^[{}]+|[{}]+$/g, "")
    .replaceAll("-", "");
  return Array.from(hex).length === 32 && PYTHON_HEX_INT.test(hex);
}

/** The `cf_track` cookie when it holds a UUID, else a fresh one. */
export function trackingId(cookie: string | undefined): string {
  return cookie && isPythonUuid(cookie) ? cookie : randomUUID();
}
