export interface SiteLinks {
  readonly home: string;
  readonly mappingIndex: string;
  classifier(classifierType: string): string;
  mappingProduct(slug: string): string;
  mappingSample(slug: string): string;
}

// The templates' url_for links are absolute URLs on the request's origin.
export function siteLinks(origin: string): SiteLinks {
  return {
    home: `${origin}/`,
    mappingIndex: `${origin}/mapping/`,
    classifier: (classifierType) => `${origin}/${classifierType}/`,
    mappingProduct: (slug) => `${origin}/mapping/${slug}/`,
    mappingSample: (slug) => `${origin}/mapping/${slug}/sample`,
  };
}
