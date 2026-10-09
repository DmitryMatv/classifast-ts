export type CacheProfile = {
  readonly browser: string;
  readonly cloudflare: string;
};

export const CACHE_PROFILES = {
  HTML_PAGE: {
    browser: "public, max-age=600, stale-while-revalidate=3600",
    cloudflare: "max-age=3600, stale-while-revalidate=86400",
  },
  CLASSIFICATION_RESULT: {
    browser: "public, max-age=86400, stale-while-revalidate=604800",
    cloudflare: "public, max-age=604800, stale-while-revalidate=604800",
  },
  STATIC_CODE: {
    browser: "public, max-age=300, stale-while-revalidate=3600",
    cloudflare: "max-age=43200, stale-while-revalidate=86400",
  },
  STATIC_MEDIA: {
    browser: "public, max-age=3600, stale-while-revalidate=86400",
    cloudflare: "max-age=604800, stale-while-revalidate=86400",
  },
  STATIC_TEXT: {
    browser: "public, max-age=600, stale-while-revalidate=3600",
    cloudflare: "max-age=7200, stale-while-revalidate=86400",
  },
  NO_STORE: {
    browser: "no-store, max-age=0",
    cloudflare: "no-store",
  },
} as const satisfies Record<string, CacheProfile>;

export type CacheProfileName = keyof typeof CACHE_PROFILES;

export type HeaderRecord = Record<string, string>;

export function cacheHeaders(name: CacheProfileName): HeaderRecord {
  const profile = CACHE_PROFILES[name];
  return {
    "Cache-Control": profile.browser,
    "Cloudflare-CDN-Cache-Control": profile.cloudflare,
  };
}

export function addVary(existing: string | undefined, value: string): string {
  const tokens = (existing ?? "")
    .split(",")
    .map((token) => token.trim().toLowerCase())
    .filter(Boolean);
  if (tokens.includes(value.toLowerCase())) return existing!;
  return existing ? `${existing}, ${value}` : value;
}

export function pageHeaders(canonicalUrl: string): HeaderRecord {
  return {
    ...cacheHeaders("HTML_PAGE"),
    Vary: "Accept-Encoding",
    "Content-Type": "text/html; charset=utf-8",
    Link: `<${canonicalUrl}>; rel="canonical"`,
    "X-Robots-Tag": "index, follow",
  };
}

export function classificationResultHeaders(): HeaderRecord {
  return { ...cacheHeaders("CLASSIFICATION_RESULT"), Vary: "Accept-Encoding" };
}

export function sampleDownloadProfile(samplePath: string): CacheProfileName {
  return samplePath.endsWith(".csv") ? "STATIC_TEXT" : "STATIC_MEDIA";
}
