// The browser bundles this module, so it imports nothing.

/**
 * The longest request URL the server accepts: `isSuspiciousRequestUrl`
 * answers 400 to more code points of decoded path and raw query, not
 * counting the "?".
 */
export const MAX_URL_LENGTH = 4000;

/**
 * Whether the server accepts a path and query that is ASCII and has no
 * escapes in its path, as `resultsApiPath` builds, so its length counts the
 * code points the server counts.
 */
export function fitsUrlLimit(pathAndQuery: string): boolean {
  return pathAndQuery.length - "?".length <= MAX_URL_LENGTH;
}
