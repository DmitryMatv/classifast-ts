import { z } from "zod";
import { readGolden } from "../../test/support/golden.js";
import {
  getHomepagePopularLookupLinks,
  getPopularLookupLinks,
} from "./popular-lookups.js";

const linkSchema = z.object({
  classifier_type: z.string(),
  label: z.string(),
  url: z.string(),
});

const golden = readGolden(
  "popular-lookups.json",
  z.object({
    sitemaps: z.array(
      z.object({
        sitemapQueryPaths: z.array(z.string()),
        byType: z.array(
          z.object({ input: z.string(), links: z.array(linkSchema) }),
        ),
        homepage: z.array(linkSchema),
      }),
    ),
  }),
);

function toPython(links: ReturnType<typeof getPopularLookupLinks>) {
  return links.map(({ classifierType, label, url }) => ({
    classifier_type: classifierType,
    label,
    url,
  }));
}

describe.each(golden.sitemaps.map((sitemap, index) => ({ index, sitemap })))(
  "popular lookup links match Python with sitemap $index",
  ({ sitemap }) => {
    const paths = new Set(sitemap.sitemapQueryPaths);

    it.each(sitemap.byType)(
      "lists the links for $input",
      ({ input, links }) => {
        expect(toPython(getPopularLookupLinks(input, paths))).toEqual(links);
      },
    );

    it("lists the homepage links", () => {
      expect(toPython(getHomepagePopularLookupLinks(paths))).toEqual(
        sitemap.homepage,
      );
    });
  },
);
