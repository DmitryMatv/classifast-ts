import { createHash, randomUUID } from "node:crypto";
import { pyInt } from "../python/numbers.js";
import { pyStrip } from "../python/str.js";

/**
 * The parts of a Node request that identify its client. `headersDistinct`
 * keeps each header line, where plain `headers` joins repeated custom
 * headers with ", ". Behind a proxy, the socket's peer is the proxy.
 */
export type ClientRequest = {
  readonly headersDistinct: Readonly<
    Record<string, readonly string[] | undefined>
  >;
  readonly socket: { readonly remoteAddress?: string | undefined };
};

// uvicorn's _parse_host_port without the port. A malformed value stays
// whole, so "1.2.3.4:x" is not an address.
function forwardedHost(value: string): string {
  if (value.startsWith("[")) {
    const end = value.indexOf("]");
    if (end === -1) return value;
    const remainder = value.slice(end + 1);
    return remainder === "" || remainder.startsWith(":")
      ? value.slice(1, end)
      : value;
  }
  const [host = "", port, ...rest] = value.split(":");
  return port !== undefined && rest.length === 0 && pyInt(port) !== undefined
    ? host
    : value;
}

/**
 * Python's `request.client.host`. Production uvicorn runs with
 * --forwarded-allow-ips "*", so ProxyHeadersMiddleware replaces the peer
 * with the first X-Forwarded-For entry whenever that entry has a host.
 */
export function clientHost({
  headersDistinct,
  socket,
}: ClientRequest): string | undefined {
  const lines = headersDistinct["x-forwarded-for"] ?? [];
  const [first = ""] = lines.join(", ").split(",");
  return forwardedHost(pyStrip(first)) || socket.remoteAddress;
}

/** Python's `get_client_ip`, which reads the first of repeated headers. */
export function clientIp(request: ClientRequest): string {
  const { headersDistinct } = request;
  const cloudflareIp = headersDistinct["cf-connecting-ip"]?.[0];
  if (cloudflareIp) return cloudflareIp;
  const forwarded = headersDistinct["x-forwarded-for"]?.[0];
  if (forwarded) {
    const [firstHop = ""] = forwarded.split(",");
    return pyStrip(firstHop);
  }
  return clientHost(request) ?? "unknown";
}

export function hashIp(ip: string): string {
  return createHash("sha256").update(ip).digest("hex").slice(0, 16);
}

const PYTHON_SPACE = String.raw`[\t\n\v\f\r \x85\xa0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]`;
const PYTHON_HEX_INT = new RegExp(
  String.raw`^${PYTHON_SPACE}*\+?(?:0x_?)?[\p{Nd}a-f]+(?:_[\p{Nd}a-f]+)*${PYTHON_SPACE}*$`,
  "iu",
);

function isPythonUuid(value: string): boolean {
  const hex = value
    .replaceAll("urn:", "")
    .replaceAll("uuid:", "")
    .replace(/^[{}]+|[{}]+$/g, "")
    .replaceAll("-", "");
  return Array.from(hex).length === 32 && PYTHON_HEX_INT.test(hex);
}

export function trackingId(cookie: string | undefined): string {
  return cookie && isPythonUuid(cookie) ? cookie : randomUUID();
}
