// Mirrors app/cache_profiles.py.
export const cacheProfiles = {
  HTML_PAGE: {
    cacheControl: "public, max-age=600, stale-while-revalidate=3600",
    cloudflare: "max-age=3600, stale-while-revalidate=86400",
  },
  CLASSIFICATION_RESULT: {
    cacheControl: "public, max-age=86400, stale-while-revalidate=604800",
    cloudflare: "public, max-age=604800, stale-while-revalidate=604800",
  },
  STATIC_CODE: {
    cacheControl: "public, max-age=300, stale-while-revalidate=3600",
    cloudflare: "max-age=43200, stale-while-revalidate=86400",
  },
  STATIC_MEDIA: {
    cacheControl: "public, max-age=3600, stale-while-revalidate=86400",
    cloudflare: "max-age=604800, stale-while-revalidate=86400",
  },
  STATIC_TEXT: {
    cacheControl: "public, max-age=600, stale-while-revalidate=3600",
    cloudflare: "max-age=7200, stale-while-revalidate=86400",
  },
  NO_STORE: {
    cacheControl: "no-store, max-age=0",
    cloudflare: "no-store",
  },
} as const;

export type CacheProfileName = keyof typeof cacheProfiles;

// SecurityHeadersMiddleware in app/main.py sets these on every response.
export const securityHeaders = {
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "strict-transport-security": "max-age=31536000; includeSubDomains",
  "x-xss-protection": "1; mode=block",
  "referrer-policy": "strict-origin-when-cross-origin",
  "permissions-policy": "geolocation=(), microphone=(), camera=()",
  "content-security-policy":
    "default-src 'self'; " +
    "script-src 'self' 'unsafe-inline' https://cdn.tailwindcss.com https://unpkg.com https://www.googletagmanager.com https://www.google-analytics.com https://static.cloudflareinsights.com https://*.clerk.com https://clerk.classifast.com https://accounts.google.com https://challenges.cloudflare.com https://ajax.cloudflare.com; " +
    "script-src-elem 'self' 'unsafe-inline' https://cdn.tailwindcss.com https://unpkg.com https://www.googletagmanager.com https://www.google-analytics.com https://static.cloudflareinsights.com https://*.clerk.com https://clerk.classifast.com https://accounts.google.com https://challenges.cloudflare.com https://ajax.cloudflare.com; " +
    "worker-src 'self' blob:; " +
    "style-src 'self' 'unsafe-inline' https://cdn.tailwindcss.com https://fonts.googleapis.com; " +
    "style-src-elem 'self' 'unsafe-inline' https://cdn.tailwindcss.com https://fonts.googleapis.com https://accounts.google.com/gsi/style; " +
    "img-src 'self' data: https: https://*.googleapis.com https://*.gstatic.com https://*.clerk.com https://clerk.classifast.com; " +
    "font-src 'self' https://fonts.gstatic.com https://*.googleapis.com https://*.gstatic.com; " +
    "connect-src 'self' https: https://*.clerk.com https://accounts.google.com https://accounts.google.com/gsi/ https://*.googleapis.com https://challenges.cloudflare.com; " +
    "frame-src 'self' https://accounts.google.com https://challenges.cloudflare.com; " +
    "base-uri 'self'; " +
    "form-action 'self'; " +
    "manifest-src 'self'; " +
    "object-src 'none'; " +
    "frame-ancestors 'none'; " +
    "upgrade-insecure-requests;",
} as const;
