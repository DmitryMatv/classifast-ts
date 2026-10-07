import { randomInt } from "node:crypto";
import { contract } from "./env.js";
import {
  cacheProfiles,
  securityHeaders,
  type CacheProfileName,
} from "./headers.js";

export type Method = "GET" | "HEAD" | "POST";

export type Reply = {
  label: string;
  status: number;
  headers: Headers;
  body: string;
  bytes: Buffer;
};

type SendOptions = {
  method?: Method;
  headers?: Record<string, string>;
  body?: string;
};

// Every response the suite receives must carry the security headers and no
// Set-Cookie, so the check lives here instead of in each case.
export async function send(
  path: string,
  options: SendOptions = {},
): Promise<Reply> {
  const method = options.method ?? "GET";
  const response = await fetch(new URL(path, contract.baseUrl), {
    method,
    headers: options.headers,
    body: options.body,
    redirect: "manual",
  });
  const bytes = Buffer.from(await response.arrayBuffer());
  const reply: Reply = {
    label: `${method} ${path.length > 100 ? `${path.slice(0, 100)}...` : path}`,
    status: response.status,
    headers: response.headers,
    body: bytes.toString("utf8"),
    bytes,
  };
  expect(reply.headers.getSetCookie(), `${reply.label} Set-Cookie`).toEqual([]);
  for (const [name, value] of Object.entries(securityHeaders)) {
    expect(reply.headers.get(name), `${reply.label} ${name}`).toBe(value);
  }
  return reply;
}

export function expectStatus(reply: Reply, status: number) {
  expect(reply.status, `${reply.label} status`).toBe(status);
}

export function expectCacheProfile(reply: Reply, name: CacheProfileName) {
  const profile = cacheProfiles[name];
  expect(
    {
      "cache-control": reply.headers.get("cache-control"),
      "cloudflare-cdn-cache-control": reply.headers.get(
        "cloudflare-cdn-cache-control",
      ),
    },
    `${reply.label} cache profile ${name}`,
  ).toEqual({
    "cache-control": profile.cacheControl,
    "cloudflare-cdn-cache-control": profile.cloudflare,
  });
}

// Python repeats tokens ("Accept-Encoding, Accept-Encoding") because GZip
// middleware appends to a route-set Vary; caches treat Vary as a set.
export function varyTokens(reply: Reply): string[] {
  const tokens = (reply.headers.get("vary") ?? "")
    .split(",")
    .map((token) => token.trim().toLowerCase())
    .filter(Boolean);
  return [...new Set(tokens)].sort();
}

// Python answers some redirects with absolute URLs on the request origin and
// others with bare paths; the contract is the path and query.
export function locationOf(reply: Reply): string | null {
  const location = reply.headers.get("location");
  if (location === null) return null;
  const url = new URL(location, contract.baseUrl);
  return `${url.pathname}${url.search}`;
}

export function pathOf(url: string): string {
  return new URL(url, contract.baseUrl).pathname;
}

export function parseHtml(reply: Reply): Document {
  return new DOMParser().parseFromString(reply.body, "text/html");
}

export function parseJson(reply: Reply): unknown {
  expect(
    reply.headers.get("content-type"),
    `${reply.label} content-type`,
  ).toMatch(/^application\/json/);
  return JSON.parse(reply.body);
}

// The Python app trusts CF-Connecting-IP for quota and rate-limit keys. A
// fresh address per run keeps full-mode counters from earlier runs out of the
// way. 198.18.0.0/15 is reserved for benchmarking.
export function freshClientIp(): string {
  return `198.${randomInt(18, 20)}.${randomInt(0, 256)}.${randomInt(1, 255)}`;
}
