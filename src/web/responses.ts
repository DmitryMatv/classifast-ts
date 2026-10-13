import type { Request, Response } from "express";
import { pageHeaders } from "../http/cache-profiles.js";
import { splitRequestTarget } from "../http/middleware.js";
import { quote } from "../python/urllib.js";

// Starlette's RedirectResponse percent-encodes the URL with these as safe.
const REDIRECT_SAFE = ":/%#?=@[]!$&'()*+,;";

export function sendPage(res: Response, canonicalUrl: string, html: string) {
  res.status(200).set(pageHeaders(canonicalUrl)).send(html);
}

export function redirect(res: Response, url: string): void {
  res.status(301).set({
    Location: quote(url, REDIRECT_SAFE),
    "Content-Length": "0",
  });
  res.end();
}

export function rawQuery(req: Request): string {
  return splitRequestTarget(req.originalUrl).rawQuery;
}

export function querySuffix(req: Request): string {
  const query = rawQuery(req);
  return query ? `?${query}` : "";
}
