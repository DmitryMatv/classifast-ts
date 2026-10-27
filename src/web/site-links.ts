import type { HeaderLinks } from "./header/site-header.js";

export interface SiteLinks {
  readonly home: string;
  readonly mappingIndex: string;
  classifier(classifierType: string): string;
  fragment(classifierType: string): string;
  mappingProduct(slug: string): string;
  mappingSample(slug: string): string;
  staticFile(path: string): string;
}

// The templates' url_for links are absolute URLs on the request's origin.
export function siteLinks(origin: string): SiteLinks {
  return {
    home: `${origin}/`,
    mappingIndex: `${origin}/mapping/`,
    classifier: (classifierType) => `${origin}/${classifierType}/`,
    fragment: (classifierType) => `${origin}/${classifierType}/fragment`,
    mappingProduct: (slug) => `${origin}/mapping/${slug}/`,
    mappingSample: (slug) => `${origin}/mapping/${slug}/sample`,
    staticFile: (path) => `${origin}/static/${path}`,
  };
}

const MENU_CLASSIFIERS = [
  "UNSPSC",
  "GPC",
  "NAICS",
  "CN",
  "ETIM",
  "ISIC",
  "HS",
  "HTS",
  "NACE",
  "CPV",
  "NSN",
] as const;

export function headerLinks(links: SiteLinks): HeaderLinks {
  return {
    home: links.home,
    mappingIndex: links.mappingIndex,
    classifiers: Object.fromEntries(
      MENU_CLASSIFIERS.map((type) => [type, links.classifier(type)]),
    ),
  };
}
