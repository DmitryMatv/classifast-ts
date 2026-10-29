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

/** A mobile menu's classifier chips: [label, classifier type], in order. */
type MenuChips = readonly (readonly [label: string, classifierType: string])[];

const MAPPING_MENU: MenuChips = [
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
].map((type) => [type, type]);

export const HOME_MENU: MenuChips = [
  ["UNSPSC", "UNSPSC"],
  ["GS1 GPC", "GPC"],
  ["EMDN", "EMDN"],
  ["NAICS", "NAICS"],
  ["CN", "CN"],
  ["ETIM", "ETIM"],
  ["ISIC", "ISIC"],
  ["HS", "HS"],
  ["HTS", "HTS"],
  ["NACE", "NACE"],
  ["CPV", "CPV"],
  ["NSN", "NSN"],
];

export function headerLinks(
  links: SiteLinks,
  menu: MenuChips = MAPPING_MENU,
): HeaderLinks {
  return {
    home: links.home,
    mappingIndex: links.mappingIndex,
    classifiers: Object.fromEntries(
      menu.map(([label, type]) => [label, links.classifier(type)]),
    ),
  };
}
