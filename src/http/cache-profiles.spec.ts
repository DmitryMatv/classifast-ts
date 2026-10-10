import {
  addVary,
  cacheHeaders,
  classificationResultHeaders,
  pageHeaders,
  sampleDownloadProfile,
} from "./cache-profiles.js";

describe("cacheHeaders matches app/cache_profiles.py", () => {
  it.each([
    [
      "HTML_PAGE",
      "public, max-age=600, stale-while-revalidate=3600",
      "max-age=3600, stale-while-revalidate=86400",
    ],
    [
      "CLASSIFICATION_RESULT",
      "public, max-age=86400, stale-while-revalidate=604800",
      "public, max-age=604800, stale-while-revalidate=604800",
    ],
    [
      "STATIC_CODE",
      "public, max-age=300, stale-while-revalidate=3600",
      "max-age=43200, stale-while-revalidate=86400",
    ],
    [
      "STATIC_MEDIA",
      "public, max-age=3600, stale-while-revalidate=86400",
      "max-age=604800, stale-while-revalidate=86400",
    ],
    [
      "STATIC_TEXT",
      "public, max-age=600, stale-while-revalidate=3600",
      "max-age=7200, stale-while-revalidate=86400",
    ],
    ["NO_STORE", "no-store, max-age=0", "no-store"],
  ] as const)("%s", (name, browser, cloudflare) => {
    expect(cacheHeaders(name)).toEqual({
      "Cache-Control": browser,
      "Cloudflare-CDN-Cache-Control": cloudflare,
    });
  });
});

describe("route header builders", () => {
  it("builds the page headers of build_page_headers", () => {
    expect(
      pageHeaders("https://classifast.com/NAICS/industrial_pump/"),
    ).toEqual({
      "Cache-Control": "public, max-age=600, stale-while-revalidate=3600",
      "Cloudflare-CDN-Cache-Control":
        "max-age=3600, stale-while-revalidate=86400",
      Vary: "Accept-Encoding",
      "Content-Type": "text/html; charset=utf-8",
      Link: '<https://classifast.com/NAICS/industrial_pump/>; rel="canonical"',
      "X-Robots-Tag": "index, follow",
    });
  });

  it("builds the classification headers of get_classification_cache_headers", () => {
    expect(classificationResultHeaders()).toEqual({
      "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800",
      "Cloudflare-CDN-Cache-Control":
        "public, max-age=604800, stale-while-revalidate=604800",
      Vary: "Accept-Encoding",
    });
  });

  it.each([
    ["mapping_samples/example.csv", "STATIC_TEXT"],
    ["exports/example.xlsx", "STATIC_MEDIA"],
    ["exports/example.zip", "STATIC_MEDIA"],
  ])("serves the sample %s with %s", (path, profile) => {
    expect(sampleDownloadProfile(path)).toBe(profile);
  });
});

describe("addVary merges a token like add_vary", () => {
  it.each([
    [undefined, "Accept-Encoding", "Accept-Encoding"],
    ["", "Accept-Encoding", "Accept-Encoding"],
    ["Origin", "Accept-Encoding", "Origin, Accept-Encoding"],
    ["accept-encoding", "Accept-Encoding", "accept-encoding"],
    ["Origin, Accept-Encoding ", "accept-encoding", "Origin, Accept-Encoding "],
  ])("merges %j and %s into %j", (existing, value, merged) => {
    expect(addVary(existing, value)).toBe(merged);
  });
});
