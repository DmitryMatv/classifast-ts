import type { Request } from "express";
import { pyStrip } from "../python/str.js";
import { clientIp } from "../usage/client-identity.js";
import type { CallerCredentials } from "../usage/quota.js";

const COOKIE_ESCAPE = /\\(?:([0-3][0-7][0-7])|(.))/g;

// http.cookies._unquote: a double-quoted value loses its quotes and escapes.
function unquoteCookie(value: string): string {
  if (value.length < 2 || !value.startsWith('"') || !value.endsWith('"')) {
    return value;
  }
  return value
    .slice(1, -1)
    .replace(COOKIE_ESCAPE, (_, octal: string | undefined, char: string) =>
      octal === undefined ? char : String.fromCharCode(parseInt(octal, 8)),
    );
}

/** Starlette's cookie_parser: a later cookie of the same name wins. */
export function parseCookies(header: string | undefined): Map<string, string> {
  const cookies = new Map<string, string>();
  for (const chunk of (header ?? "").split(";")) {
    const equals = chunk.indexOf("=");
    const key = pyStrip(equals === -1 ? "" : chunk.slice(0, equals));
    const value = pyStrip(equals === -1 ? chunk : chunk.slice(equals + 1));
    if (key || value) cookies.set(key, unquoteCookie(value));
  }
  return cookies;
}

// Starlette reads the first Cookie and Authorization header.
export function callerCredentialsOf(req: Request): CallerCredentials {
  const cookies = parseCookies(req.headersDistinct.cookie?.[0]);
  return {
    authorization: req.headersDistinct.authorization?.[0],
    sessionCookie: cookies.get("__session"),
    trackingCookie: cookies.get("cf_track"),
    clientIp: clientIp(req.headersDistinct, req.socket.remoteAddress),
  };
}
