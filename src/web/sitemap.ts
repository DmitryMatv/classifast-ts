import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CLASSIFIER_TYPES } from "../classifier/classifier-config.js";
import { parseSitemapQueryPaths } from "../classifier/sitemap-query-paths.js";
import { STATIC_ROOT } from "../static/static-files.js";

export const SITEMAP_QUERY_PATHS = Symbol("SITEMAP_QUERY_PATHS");

// Read once at startup, like Python's import-time SITEMAP_QUERY_PATHS; a
// sitemap edit takes effect after a restart.
export function loadSitemapQueryPaths(staticRoot = STATIC_ROOT): Set<string> {
  return parseSitemapQueryPaths(
    readFileSync(join(staticRoot, "sitemap.xml"), "utf8"),
    CLASSIFIER_TYPES,
  );
}
