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

export function sameOriginPath(url: string, label: string): string {
  const resolved = new URL(url, contract.baseUrl);
  expect(resolved.origin, `${label} origin`).toBe(contract.baseUrl.origin);
  return `${resolved.pathname}${resolved.search}`;
}

export function locationOf(reply: Reply): string | null {
  const location = reply.headers.get("location");
  return location === null
    ? null
    : sameOriginPath(location, `${reply.label} Location`);
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

const benchmarkingRangeSecondOctets = [18, 19] as const;

export function freshClientIp(): string {
  const second = benchmarkingRangeSecondOctets[randomInt(0, 2)];
  return `198.${second}.${randomInt(0, 256)}.${randomInt(1, 255)}`;
}
