import { CANONICAL_ORIGIN } from "../classifier/classifier-urls.js";
import { quote } from "../python/urllib.js";

export function buildMappingCanonicalUrl(slug?: string): string {
  return slug
    ? `${CANONICAL_ORIGIN}/mapping/${quote(slug, "")}/`
    : `${CANONICAL_ORIGIN}/mapping/`;
}
