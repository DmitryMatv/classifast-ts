import { readFileSync } from "node:fs";
import { Logger } from "@nestjs/common";
import { join } from "node:path";
import { CLASSIFIER_TYPES } from "../classifier/classifier-config.js";
import { parseSitemapQueryPaths } from "../classifier/sitemap-query-paths.js";
import { STATIC_ROOT } from "../static/static-files.js";

export const SITEMAP_QUERY_PATHS = Symbol("SITEMAP_QUERY_PATHS");

// Read once at startup, like Python's import-time SITEMAP_QUERY_PATHS; a
// sitemap edit takes effect after a restart.
// Like Python, a missing sitemap leaves the allowlist empty instead of
// stopping the app.
export function loadSitemapQueryPaths(staticRoot = STATIC_ROOT): Set<string> {
  let xml: string;
  try {
    xml = readFileSync(join(staticRoot, "sitemap.xml"), "utf8");
  } catch (error) {
    new Logger("Sitemap").warn(
      `Unable to load sitemap SEO query allowlist: ${String(error)}`,
    );
    return new Set();
  }
  return parseSitemapQueryPaths(xml, CLASSIFIER_TYPES);
}
