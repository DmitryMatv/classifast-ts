import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadSitemapQueryPaths } from "./sitemap.js";

describe("loadSitemapQueryPaths", () => {
  it("reads the committed sitemap", () => {
    expect(loadSitemapQueryPaths().size).toBeGreaterThan(0);
  });

  it("returns an empty allowlist without a sitemap, as Python does", () => {
    const root = mkdtempSync(join(tmpdir(), "no-sitemap-"));
    expect(loadSitemapQueryPaths(root)).toEqual(new Set());
  });
});
