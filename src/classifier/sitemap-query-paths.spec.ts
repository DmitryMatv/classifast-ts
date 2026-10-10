import { readFileSync } from "node:fs";
import { z } from "zod";
import { readGolden } from "../../test/support/golden.js";
import { buildClassifierConfig } from "./classifier-config.js";
import { parseSitemapQueryPaths } from "./sitemap-query-paths.js";

const golden = readGolden(
  "sitemap.json",
  z.object({
    queryPaths: z.array(z.string()),
    syntheticXml: z.string(),
    syntheticQueryPaths: z.array(z.string()),
  }),
);

const classifierTypes = new Set(Object.keys(buildClassifierConfig({})));

describe("parseSitemapQueryPaths matches _load_sitemap_query_paths", () => {
  it("reads the query pages of app/static/sitemap.xml", () => {
    const sitemap = readFileSync(
      new URL("../../app/static/sitemap.xml", import.meta.url),
      "utf8",
    );
    expect(
      [...parseSitemapQueryPaths(sitemap, classifierTypes)].sort(),
    ).toEqual(golden.queryPaths);
  });

  it("handles comments, entities, query strings and other namespaces", () => {
    expect(
      [...parseSitemapQueryPaths(golden.syntheticXml, classifierTypes)].sort(),
    ).toEqual(golden.syntheticQueryPaths);
  });
});
