import { z } from "zod";
import { readGolden } from "../../test/support/golden.js";
import { buildMappingCanonicalUrl } from "./mapping-urls.js";

const golden = readGolden(
  "mapping-urls.json",
  z.object({
    canonicalUrls: z.array(
      z.object({ slug: z.string().nullable(), url: z.string() }),
    ),
  }),
);

describe("buildMappingCanonicalUrl matches build_mapping_canonical_url", () => {
  it.each(golden.canonicalUrls)("builds $url", ({ slug, url }) => {
    expect(buildMappingCanonicalUrl(slug ?? undefined)).toBe(url);
  });
});
