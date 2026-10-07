import { z } from "zod";
import {
  codePointRangesSchema,
  codePointSet,
  readGolden,
  sweepMismatches,
} from "../../test/support/golden.js";
import {
  buildClassifierCanonicalPath,
  buildClassifierCanonicalUrl,
  buildClassifierRedirectUrl,
  buildFragmentPageTitle,
  buildFragmentPushUrl,
  decodeSearchQuery,
  shouldSsr,
  slugify,
} from "./classifier-urls.js";

const golden = readGolden(
  "classifier-urls.json",
  z.object({
    sitemapQueryPaths: z.array(z.string()),
    slugify: z.array(z.object({ input: z.string(), slug: z.string() })),
    slugKeptRanges: codePointRangesSchema,
    slugSpaceRanges: codePointRangesSchema,
    decodeSearchQuery: z.array(
      z.object({ input: z.string(), decoded: z.string() }),
    ),
    redirectUrls: z.array(
      z.object({
        type: z.string(),
        searchQuery: z.string(),
        queryString: z.string(),
        url: z.string(),
      }),
    ),
    canonicalUrls: z.array(
      z.object({
        type: z.string(),
        decodedQuery: z.string(),
        url: z.string(),
        ssr: z.boolean(),
        ssrWithQueryParams: z.boolean(),
      }),
    ),
    fragmentPushUrls: z.array(
      z.object({
        type: z.string(),
        description: z.string(),
        version: z.string(),
        defaultVersion: z.string(),
        topK: z.number().int(),
        enhanceQuery: z.boolean(),
        url: z.string(),
      }),
    ),
    pageTitles: z.array(
      z.object({ type: z.string(), query: z.string(), title: z.string() }),
    ),
  }),
);

const sitemap: ReadonlySet<string> = new Set(golden.sitemapQueryPaths);

describe("slugify matches Python", () => {
  it.each(golden.slugify)("slugifies $input", ({ input, slug }) => {
    expect(slugify(input)).toBe(slug);
  });

  it("keeps, drops and joins the same characters as Python", () => {
    const kept = codePointSet(golden.slugKeptRanges);
    const spaces = codePointSet(golden.slugSpaceRanges);
    expect(
      sweepMismatches(
        (c) => slugify(`a${c}b`),
        (codePoint) => {
          if (spaces[codePoint]) return "a_b";
          if (kept[codePoint]) return `a${String.fromCodePoint(codePoint)}b`;
          return "ab";
        },
      ),
    ).toEqual([]);
  });
});

describe("decodeSearchQuery matches Python", () => {
  it.each(golden.decodeSearchQuery)("decodes $input", ({ input, decoded }) => {
    expect(decodeSearchQuery(input)).toBe(decoded);
  });
});

describe("classifier URLs match Python", () => {
  it.each(golden.redirectUrls)(
    "redirects /$type/$searchQuery to $url",
    ({ type, searchQuery, queryString, url }) => {
      expect(
        buildClassifierRedirectUrl(type, searchQuery, queryString, sitemap),
      ).toBe(url);
    },
  );

  it.each(golden.canonicalUrls)(
    "canonicalizes $type $decodedQuery to $url",
    ({ type, decodedQuery, url, ssr, ssrWithQueryParams }) => {
      expect(buildClassifierCanonicalUrl(type, decodedQuery, sitemap)).toBe(
        url,
      );
      const path = buildClassifierCanonicalPath(type, decodedQuery, sitemap);
      expect(shouldSsr(decodedQuery, false, path, sitemap)).toBe(ssr);
      expect(shouldSsr(decodedQuery, true, path, sitemap)).toBe(
        ssrWithQueryParams,
      );
    },
  );

  it("server-renders the sitemap query pages", () => {
    expect(
      golden.canonicalUrls.filter(({ ssr }) => ssr).length,
    ).toBeGreaterThan(sitemap.size);
  });

  it.each(golden.fragmentPushUrls)(
    "pushes $url",
    ({ type, description, url, ...options }) => {
      expect(
        buildFragmentPushUrl(
          type,
          description,
          { ...options, defaultTopK: 10 },
          sitemap,
        ),
      ).toBe(url);
    },
  );

  it.each(golden.pageTitles)("titles $query", ({ type, query, title }) => {
    expect(buildFragmentPageTitle(type, query)).toBe(title);
  });
});
