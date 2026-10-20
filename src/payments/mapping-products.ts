// The checkout fields of app/mapping_store.py MAPPING_PRODUCTS.
export type MappingProduct = {
  readonly slug: string;
  readonly sourceStandard: string;
  readonly targetStandard: string;
  readonly polarProductId: string;
};

export const MAPPING_PRODUCTS: ReadonlyMap<string, MappingProduct> = new Map(
  [
    {
      slug: "unspsc-to-cpv-mapping",
      sourceStandard: "UNSPSC",
      targetStandard: "CPV",
      polarProductId: "96ef9175-eb8b-408a-8e32-4fa803760f91",
    },
    {
      slug: "cpv-to-unspsc-mapping",
      sourceStandard: "CPV",
      targetStandard: "UNSPSC",
      polarProductId: "cab2b78b-f1d6-4f2b-8859-dc95ca40a773",
    },
  ].map((product) => [product.slug, product]),
);
