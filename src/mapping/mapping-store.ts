export type FaqItem = {
  readonly question: string;
  readonly answer: string;
};

export type MappingProduct = {
  readonly slug: string;
  readonly title: string;
  readonly seoTitle: string;
  readonly metaDescription: string;
  readonly imageUrl: string;
  readonly sourceStandard: string;
  readonly targetStandard: string;
  readonly versionLabel: string;
  readonly priceUsd: string;
  readonly polarProductId: string;
  readonly sampleFilePath: string;
  readonly sampleFormatLabel: string;
  readonly paidFormatLabel: string;
  readonly heroCopy: string;
  readonly coverageSummary: string;
  readonly includedFields: readonly string[];
  readonly useCases: readonly string[];
  readonly faqItems: readonly FaqItem[];
  readonly disclaimer: string;
  readonly relatedSlugs: readonly string[];
  readonly keywords: readonly string[];
  readonly updatedAt: string;
  readonly featured: boolean;
};

const PRODUCTS: readonly MappingProduct[] = [
  {
    slug: "unspsc-to-cpv-mapping",
    title: "UNSPSC to CPV Mapping",
    seoTitle: "UNSPSC to CPV Mapping File | Classifast",
    metaDescription:
      "Direct UNSPSC to CPV mapping file covering UNSPSC Segments and Families (level 1+2, 617 categories) for procurement, finance, and reporting systems.",
    imageUrl: "https://classifast.com/static/images/preview.png",
    sourceStandard: "UNSPSC",
    targetStandard: "CPV",
    versionLabel: "UNSPSC UNv260801.1 -> CPV 2008",
    priceUsd: "265",
    polarProductId: "96ef9175-eb8b-408a-8e32-4fa803760f91",
    sampleFilePath:
      "app/static/mapping_samples/unspsc_to_cpv_mapping_sample.csv",
    sampleFormatLabel: "CSV sample",
    paidFormatLabel: "Full CSV mapping file",
    heroCopy:
      "Direct crosswalk from UNSPSC into CPV for organizations running different taxonomies across procurement systems, finance systems, ERP, and reporting workflows.",
    coverageSummary:
      "UNSPSC level 1+2 only, meaning only all Segments and all Families from UNSPSC UNv260801.1. Total scope is 617 categories. Class or Commodity levels are not used and are not mapped in this file.",
    includedFields: [
      "UNSPSC code",
      "UNSPSC level (Segment or Family)",
      "UNSPSC title",
      "UNSPSC definition",
      "CPV code",
      "CPV title",
    ],
    useCases: [
      "Align UNSPSC-coded finance or ERP masters with CPV-based procurement and tendering workflows.",
      "Build a level 1 and 2 reference crosswalk for spend analysis, reporting and category rollups.",
      "Avoid daisychaining UNSPSC to ProClass to CPV when a direct mapping file is the better fit.",
    ],
    faqItems: [
      {
        question: "Is this a full UNSPSC commodity-to-CPV mapping?",
        answer:
          "No. This file covers UNSPSC Segments and Families only (level 1+2). It maps 617 UNSPSC categories in total and does not attempt a full Class-level or Commodity-level crosswalk.",
      },
      {
        question: "Why use a direct UNSPSC to CPV mapping file?",
        answer:
          "A direct crosswalk reduces the category drift that can happen when teams convert through an intermediary taxonomy. It is useful when procurement and finance systems need a shared reference table across two coding standards.",
      },
    ],
    disclaimer:
      "Reference mapping file for taxonomy harmonization across procurement, finance, and reporting systems. Validate material mappings before contract notices, regulated reporting, or audit-sensitive use.",
    relatedSlugs: ["cpv-to-unspsc-mapping"],
    keywords: [
      "unspsc to cpv mapping",
      "unspsc cpv crosswalk",
      "unspsc segments families cpv mapping",
      "procurement finance taxonomy crosswalk",
    ],
    updatedAt: "March 16, 2026",
    featured: true,
  },
  {
    slug: "cpv-to-unspsc-mapping",
    title: "CPV to UNSPSC Mapping",
    seoTitle: "CPV to UNSPSC Mapping File | Classifast",
    metaDescription:
      "Convert CPV codes into UNSPSC-aligned categories for supplier master data, spend analysis, ERP harmonization, and catalog normalization.",
    imageUrl: "https://classifast.com/static/images/preview.png",
    sourceStandard: "CPV",
    targetStandard: "UNSPSC",
    versionLabel: "CPV 2008 -> UNSPSC UNv260801.1",
    priceUsd: "385",
    polarProductId: "cab2b78b-f1d6-4f2b-8859-dc95ca40a773",
    sampleFilePath:
      "app/static/mapping_samples/cpv_to_unspsc_mapping_sample.csv",
    sampleFormatLabel: "CSV sample",
    paidFormatLabel: "Full CSV mapping file",
    heroCopy:
      "Crosswalk CPV-coded tender, contract, and supplier data into UNSPSC so procurement, finance, ERP, and master-data systems can report against one internal taxonomy.",
    coverageSummary:
      "Each CPV 2008 code is mapped into the most relevant UNSPSC category for downstream normalization workflows. CPV code coverage is 100%.",
    includedFields: [
      "CPV code",
      "UNSPSC code",
      "CPV title",
      "UNSPSC title",
      "CPV level (1-5)",
      "UNSPSC level",
    ],
    useCases: [
      "Normalize TED or tender exports into UNSPSC for spend cube and category reporting.",
      "Align CPV coded supplier and contract data with UNSPSC-led ERP and P2P systems.",
      "Support taxonomy harmonization across procurement, finance and master data teams.",
    ],
    faqItems: [
      {
        question: "Why would I map CPV into UNSPSC?",
        answer:
          "UNSPSC is commonly the internal classification used in ERP, supplier master, P2P, and spend analytics environments, while CPV is the coding system attached to EU procurement notices.",
      },
      {
        question: "Is the mapping one-to-one?",
        answer:
          "Not always. Some CPV concepts are broader or narrower than the closest UNSPSC category, so review rules are still recommended for sensitive classification and reporting workflows.",
      },
    ],
    disclaimer:
      "Use as a mapping accelerator, not as a substitute for domain review in regulated procurement, financial reporting, or compliance workflows.",
    relatedSlugs: ["unspsc-to-cpv-mapping"],
    keywords: [
      "cpv to unspsc mapping",
      "cpv unspsc crosswalk",
      "cpv code conversion",
      "unspsc supplier mapping",
    ],
    updatedAt: "March 16, 2026",
    featured: true,
  },
];

export const MAPPING_PRODUCTS: ReadonlyMap<string, MappingProduct> = new Map(
  PRODUCTS.map((product) => [product.slug, product]),
);

// Python sorts by (not featured, title.lower()). Titles are ASCII, so
// toLowerCase and UTF-16 order agree with str.lower and code point order.
function byFeaturedThenTitle(
  left: MappingProduct,
  right: MappingProduct,
): number {
  if (left.featured !== right.featured) return left.featured ? -1 : 1;
  const leftTitle = left.title.toLowerCase();
  const rightTitle = right.title.toLowerCase();
  return leftTitle < rightTitle ? -1 : leftTitle > rightTitle ? 1 : 0;
}

export function listMappingProducts(): MappingProduct[] {
  return [...MAPPING_PRODUCTS.values()].sort(byFeaturedThenTitle);
}

export function getMappingProduct(slug: string): MappingProduct | undefined {
  return MAPPING_PRODUCTS.get(slug);
}

export function getRelatedMappingProducts(
  product: MappingProduct,
): MappingProduct[] {
  return product.relatedSlugs.flatMap(
    (slug) => MAPPING_PRODUCTS.get(slug) ?? [],
  );
}
