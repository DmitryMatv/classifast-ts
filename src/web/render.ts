import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

export function renderPage(page: ReactElement): string {
  return `<!DOCTYPE html>${renderToStaticMarkup(page)}`;
}

const JSON_HTML_ESCAPES: Readonly<Record<string, string>> = {
  "<": "\\u003c",
  ">": "\\u003e",
  "&": "\\u0026",
  "'": "\\u0027",
};

// Jinja's tojson escapes the same characters, so a value cannot close the
// <script> element that holds it.
export function jsonLd(value: unknown): string {
  return JSON.stringify(value, null, 2).replace(
    /[<>&']/g,
    (character) => JSON_HTML_ESCAPES[character]!,
  );
}
