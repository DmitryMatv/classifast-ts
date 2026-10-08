export const GZIP_MINIMUM_SIZE = 1000;

export const GZIP_EXCLUDED_PATHS: ReadonlySet<string> = new Set([
  "/sitemap.xml",
  "/robots.txt",
]);

const EXCLUDED_CONTENT_TYPES: ReadonlySet<string> = new Set([
  "application/gzip",
  "application/x-gzip",
  "application/zip",
  "audio/*",
  "font/woff",
  "font/woff2",
  "image/avif",
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
  "text/event-stream",
  "video/*",
]);

export type CompressionPlan = "untouched" | "vary" | "gzip";

export type CompressionInput = {
  readonly acceptsGzip: boolean;
  readonly status: number;
  readonly contentType: string | undefined;
  readonly hasContentEncoding: boolean;
  readonly bodyLength: number;
};

function isExcludedContentType(contentType: string | undefined): boolean {
  const mediaType = (contentType ?? "").split(";")[0]!.trim().toLowerCase();
  const wildcard = `${mediaType.split("/")[0]}/*`;
  return (
    EXCLUDED_CONTENT_TYPES.has(mediaType) ||
    EXCLUDED_CONTENT_TYPES.has(wildcard)
  );
}

// Starlette's GZipMiddleware adds Vary: Accept-Encoding to every eligible body
// of minimum size, even when the client cannot take gzip.
export function compressionPlan(input: CompressionInput): CompressionPlan {
  if (
    input.hasContentEncoding ||
    input.status === 206 ||
    isExcludedContentType(input.contentType) ||
    input.bodyLength < GZIP_MINIMUM_SIZE
  ) {
    return "untouched";
  }
  return input.acceptsGzip ? "gzip" : "vary";
}
