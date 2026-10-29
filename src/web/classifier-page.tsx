import type { ClassificationResult } from "../classifier/classification.js";
import type {
  ClassifierPage as ClassifierPageConfig,
  ClassifierVersion,
} from "../classifier/classifier-config.js";
import type { PopularLookupLink } from "../classifier/popular-lookups.js";
import { pyTitle } from "../python/str.js";
import { assetUrl } from "./asset-url.js";
import { BODY_STYLE } from "./body-style.js";
import { CLASSIFIER_GUIDES } from "./classifier-guides.js";
import { CLASSIFIER_PAGE_CSS } from "./classifier-page-styles.js";
import type {
  ClassifierIslandProps,
  ClassifierResources,
} from "./classifier/classifier-island.js";
import { Island } from "./islands/render-island.js";
import { jinjaEscape, jsonLd } from "./render.js";
import { toResultsView } from "./results-view.js";
import { SiteFooter } from "./site-footer.js";
import { headerLinks, HOME_MENU, type SiteLinks } from "./site-links.js";
import { UnspscGuide } from "./unspsc-guide.js";

export interface ClassifierPageResults {
  /** The query the results are for; the textarea shows it. */
  readonly query: string;
  readonly results: readonly ClassificationResult[];
  readonly version?: ClassifierVersion;
  readonly elapsedSeconds?: number;
  readonly loaded: boolean;
}

export interface ClassifierPageProps {
  readonly links: SiteLinks;
  readonly currentYear: number;
  readonly classifierType: string;
  readonly page: ClassifierPageConfig;
  /** The decoded search query of a query page; empty on the base page. */
  readonly search: string;
  /** The selected version, or empty for the first one. */
  readonly version: string;
  readonly firstVersion: string;
  readonly topK: number;
  readonly canonicalUrl: string;
  readonly results: ClassifierPageResults;
  readonly defaultExamplePrefill: boolean;
  readonly triggerSearchOnLoad: boolean;
  readonly enhanceQuery: boolean;
  readonly popularLookupLinks: readonly PopularLookupLink[];
  readonly stripCodeDots: boolean;
}

const GTAG_SCRIPT = `
        window.dataLayer = window.dataLayer || [];
        function gtag() { dataLayer.push(arguments); }
        gtag('js', new Date());

        gtag('config', 'G-JK3ESE6CJR');
    `;

// Jinja autoescapes every value it interpolates, also inside the JSON-LD.
const e = jinjaEscape;

const FAQ_QUESTIONS: Readonly<
  Record<string, readonly (readonly [string, string])[]>
> = {
  UNSPSC: [
    [
      "What is UNSPSC classification and how does the hierarchy work?",
      "UNSPSC (United Nations Standard Products and Services Code) is a global standard that organizes products and services into a four-level hierarchical structure: Segment (2 digits), Family (2 digits), Class (2 digits), and Commodity (2 digits). This 8-digit system enables precise categorization across all industries, from raw materials to finished services.",
    ],
    [
      "Which industries and platforms use UNSPSC codes most frequently?",
      "UNSPSC codes are extensively used by e-procurement platforms like SAP Ariba and Coupa, government procurement systems (GSA schedules), healthcare supply chains, manufacturing ERP systems, and B2B marketplaces. They enable spend analysis, vendor management, and cross-industry product standardization.",
    ],
    [
      "How often are UNSPSC codes updated and what's the latest version?",
      "UNSPSC codes are updated semi-annually by GS1 US. The current version (v26.0801 from August 2023) contains over 150,000 active codes covering both products and services across all sectors. Updates include new codes for emerging technologies and market changes.",
    ],
  ],
  ETIM: [
    [
      "What is ETIM classification and how do technical product classes work?",
      "ETIM (Technical Information Model) is an open standard specifically designed for technical and electrical products. It uses alphanumeric class codes (like EC000123 for electrical components) combined with detailed attributes and values. Each class includes technical specifications, dimensions, materials, and performance characteristics essential for B2B technical trade.",
    ],
    [
      "What's the difference between ETIM International, ETIM US, and ETIM Germany?",
      "ETIM International provides the global English standard, ETIM US adapts classes for North American electrical codes and standards, while ETIM Germany focuses on German-speaking markets with local technical regulations. Each maintains the core ETIM structure but includes region-specific requirements and translations.",
    ],
    [
      "Which types of technical products are classified using ETIM?",
      "ETIM covers electrical installation products, HVAC systems, lighting fixtures, cables and wires, industrial automation equipment, building automation systems, and renewable energy products. It's particularly strong in electrical, climate control, and building technology sectors.",
    ],
  ],
  NAICS: [
    [
      "How do NAICS codes differ from the older SIC system?",
      "NAICS replaced the Standard Industrial Classification (SIC) in 1997 with significant improvements: 6-digit codes vs 4-digit SIC codes, enhanced service sector coverage, North American trilateral cooperation (US, Canada, Mexico), and regular 5-year updates versus SIC's 1987 final revision.",
    ],
    [
      "How are NAICS codes used in government contracting and SAM.gov?",
      "NAICS codes are mandatory for federal contracting through SAM.gov registration. They're used to determine small business size standards, qualify for SBA certification programs (8(a), HUBZone, SDVOSB), identify contract opportunities, and ensure compliance with federal reporting requirements.",
    ],
    [
      "How often are NAICS codes updated and what's the current version?",
      "NAICS codes are updated every 5 years to reflect economic changes. The current 2022 revision includes 1,170 industries across 20 sectors. The next update is scheduled for 2027. Each revision adds new industries for emerging sectors like renewable energy and digital services.",
    ],
  ],
  ISIC: [
    [
      "What is ISIC and how does it enable global economic comparison?",
      "ISIC (International Standard Industrial Classification) is the UN's global standard for classifying economic activities, maintained by the UN Statistics Division since 1948. It enables consistent GDP comparisons, employment statistics alignment, and trade flow analysis across 200+ countries and territories.",
    ],
    [
      "How does ISIC Rev.4 compare to NAICS 2022?",
      "ISIC Rev.4 provides broader international comparability with 21 sections versus NAICS 2022's 20 sectors. While ISIC focuses on global standardization for UN member states, NAICS offers more granular detail for North American markets. ISIC is updated every 10 years versus NAICS 5-year cycle.",
    ],
    [
      "Which international organizations and countries use ISIC classification?",
      "ISIC is used by over 200 countries and territories through national statistical offices, the World Bank, IMF, OECD, and other international organizations. It's the foundation for national accounts compilation, development indicators, and cross-country economic policy analysis.",
    ],
  ],
  HS: [
    [
      "What are HS codes and why are they essential for international trade?",
      "HS (Harmonized System) codes are the global standard for classifying traded goods, developed by the World Customs Organization. They're essential for customs duty calculation, import/export licensing, trade statistics, and free trade agreement qualification. Used by 200+ countries, they ensure consistent classification for international commerce.",
    ],
    [
      "How is the HS system structured and how often is it updated?",
      "HS uses a 6-digit hierarchical structure: 21 Sections → 99 Chapters → 1000+ Headings → 5000+ Subheadings. Countries add 2-4 digit extensions for specific tariff lines. The system is updated every 5-6 years by the WCO, with the 2022 revision being the latest, containing over 5000 commodity groups.",
    ],
    [
      "What's the difference between HS codes and customs tariff codes?",
      "HS codes provide the 6-digit international standard, while customs tariff codes include country-specific extensions. For example, the US uses HTS codes (10 digits), EU uses TARIC codes (8-10 digits), and other countries add their own extensions to the base 6-digit HS code for detailed tariff schedules.",
    ],
  ],
};

interface WebApplicationText {
  readonly name: string;
  readonly description: string;
  readonly keywords: string;
}

function webApplicationText(
  classifierType: string,
  search: string,
  title: string,
  description: string,
): WebApplicationText {
  const type = e(classifierType);
  if (search) {
    const query = e(search);
    return {
      name: `${type} Code for ${query} | Classifast`,
      description: `Find accurate ${type} codes for ${query} with fastest classification tool. Semantic search technology for precise results.`,
      keywords: `${type} code ${query}, ${query} ${type}, find ${type} code ${query}, ${e(classifierType.toLowerCase())} classification ${query}, semantic search ${type}`,
    };
  }
  if (classifierType === "UNSPSC") {
    return {
      name: "UNSPSC Code Lookup & Classification | Classifast",
      description:
        "Find UNSPSC codes quickly with Classifast. Accurate UNSPSC code lookup, search, and classification for products and services. Explore UNSPSC categories and commodity codes.",
      keywords: `UNSPSC code, UNSPSC code lookup, UNSPSC codes list, UNSPSC code search, find UNSPSC code, UNSPSC classification, commodity code UNSPSC, UNSPSC categories, ${e(title)}, automated classifier, product classification, service classification, semantic search`,
    };
  }
  if (classifierType === "ETIM") {
    return {
      name: "ETIM Product Classification & Lookup | Classifast",
      description:
        "Accurate ETIM product classification with Classifast. Search and identify ETIM classes for technical and electrical products. Streamline your product data management.",
      keywords: `ETIM classification, ETIM product codes, ETIM classes, ETIM lookup, ${e(title)}, technical product classification, electrical product data, automated classifier, product data management, semantic search`,
    };
  }
  return {
    name: `Fast ${type} Classification, Code Lookup, Search | Classifast`,
    description: `${e(description)} Use Classifast for precise and fast product classification with the ${type} standard.`,
    keywords: `${e(title)}, ${type} Lookup, ${type} Classifier, ${type} Standard, Data Categorization, Semantic Search, Product Matching, ${type} Codes, Automated Classification`,
  };
}

function jsonLdScripts({
  classifierType,
  search,
  page: { title, description },
  canonicalUrl,
}: ClassifierPageProps): string[] {
  const type = e(classifierType);
  const faq = FAQ_QUESTIONS[classifierType] ?? [
    [`What is ${type} classification?`, e(description)],
    [
      `How accurate is ${type} classification?`,
      `Our ${type} classification uses state-of-the-art embedding models to deliver high accuracy results. Each classification includes a confidence score for transparency.`,
    ],
  ];
  return [
    {
      "@context": "https://schema.org",
      "@type": "WebApplication",
      ...webApplicationText(classifierType, search, title, description),
      url: e(canonicalUrl),
      applicationCategory: "BusinessApplication",
      operatingSystem: "Web",
      offers: {
        "@type": "Offer",
        price: "0.10",
        priceCurrency: "USD",
        description: "Per classification request",
      },
      author: { "@type": "Person", name: "Dmitry Matv" },
      provider: {
        "@type": "Organization",
        name: "Classifast",
        url: "https://classifast.com/",
      },
      featureList: [
        `${type} code lookup and classification`,
        "Semantic search technology",
        "Bulk classification support",
        "High accuracy matching",
        "Real-time classification results",
      ],
      mainEntity: {
        "@type": "Thing",
        name: `${type} Classification`,
        description: e(description),
      },
    },
    {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: faq.map(([name, text]) => ({
        "@type": "Question",
        name,
        acceptedAnswer: { "@type": "Answer", text },
      })),
    },
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        {
          "@type": "ListItem",
          position: 1,
          name: "Home",
          item: "https://classifast.com/",
        },
        {
          "@type": "ListItem",
          position: 2,
          name: e(title),
          item: e(canonicalUrl),
        },
      ],
    },
    {
      "@context": "https://schema.org",
      "@type": "HowTo",
      name: `How to find ${type} codes using Classifast`,
      description: `Use Classifast code finder tool to quickly find correct ${type} code for any product or service.`,
      totalTime: "PT30S",
      tool: { "@type": "HowToTool", name: `Classifast ${type} Classifier` },
      step: [
        {
          "@type": "HowToStep",
          position: 1,
          name: "Enter product or service description",
          text: "Type a description of your product or service into the search box. Be as specific as possible for better results.",
        },
        {
          "@type": "HowToStep",
          position: 2,
          name: "Submit",
          text: "Press the 'Submit' button to submit your description. The search will process your query in about 1 second.",
        },
        {
          "@type": "HowToStep",
          position: 3,
          name: "Review ranked results",
          text: `Browse the list of matching ${type} codes, ranked by relevance. Click any result to copy the code or view more details.`,
        },
      ],
    },
    {
      "@context": "https://schema.org",
      "@type": "Organization",
      name: "Classifast",
      url: "https://classifast.com",
      logo: "https://classifast.com/static/images/preview.png",
      description:
        "Instant classification tool for UNSPSC, NAICS, HS, ETIM, and other industry standard codes.",
      founder: {
        "@type": "Person",
        name: "Dmitry Matv",
        url: "https://github.com/DmitryMatv",
      },
      sameAs: [
        "https://github.com/DmitryMatv/classifast",
        "https://rapidapi.com/DmitryMatv/api/classifast-api",
      ],
    },
  ].map(jsonLd);
}

function HeadMetadata({
  classifierType,
  search,
  page: { title },
}: ClassifierPageProps) {
  const type = classifierType;
  if (search) {
    const titled = pyTitle(search);
    const upper = search.toUpperCase();
    const description = `Find ${type} category codes for ${upper}. Accurate classification results in 1 second. Code search & lookup made easy.`;
    return (
      <>
        <title>{`${documentTitle(type, search)}\n    `}</title>
        <meta name="description" content={description} />
        <meta
          name="keywords"
          content={`${type} codes for ${upper}, ${type} ${upper}, find ${type} codes ${upper}`}
        />
        <meta property="og:title" content={`${type} codes for '${titled}'`} />
        <meta property="og:description" content={description} />
        <meta name="twitter:title" content={`${type} codes for '${titled}'`} />
        <meta name="twitter:description" content={description} />
      </>
    );
  }
  if (type === "UNSPSC") {
    return (
      <>
        <title>{documentTitle(type, search)}</title>
        <meta
          name="description"
          content="Find UNSPSC codes quickly. Accurate UNSPSC code lookup, category search, and classification of products and services."
        />
        <meta
          name="keywords"
          content={`UNSPSC mapping, UNSPSC code lookup, UNSPSC codes list, UNSPSC code search, find UNSPSC code, UNSPSC classification, commodity code UNSPSC, UNSPSC categories, ${title}, automated classifier, product classification, service classification`}
        />
      </>
    );
  }
  return (
    <>
      <title>{documentTitle(type, search)}</title>
      <meta
        name="description"
        content={`Find ${type} codes quickly. Precise and fast ${type} standard classification, search, and mapping.`}
      />
      <meta
        name="keywords"
        content={`${title}, ${type} code, ${type} code lookup, ${type} code search, ${type} code search, ${type} lookup, ${type} codes, number, categories, search`}
      />
    </>
  );
}

function OpenGraphText({ classifierType: type }: { classifierType: string }) {
  if (type === "UNSPSC") {
    return (
      <>
        <meta
          property="og:title"
          content="UNSPSC Code Lookup, Search, Classify, Map | Classifast"
        />
        <meta
          property="og:description"
          content="Find UNSPSC codes quickly. Accurate UNSPSC code lookup, category search, and classification of products and services."
        />
      </>
    );
  }
  return (
    <>
      <meta
        property="og:title"
        content={`${type} Code Lookup, Search, Classify, Map | Classifast`}
      />
      <meta
        property="og:description"
        content={`Find ${type} codes quickly. Precise and fast ${type} standard classification, search, and mapping.`}
      />
    </>
  );
}

function TwitterText({
  classifierType: type,
  search,
}: {
  classifierType: string;
  search: string;
}) {
  if (search) {
    return (
      <>
        <meta
          name="twitter:title"
          content={`${type} codes for '${pyTitle(search)}'`}
        />
        <meta
          name="twitter:description"
          content={`Find ${type} category codes for ${search.toUpperCase()}. Accurate classification results in 1 second.`}
        />
      </>
    );
  }
  if (type === "UNSPSC") {
    return (
      <>
        <meta
          name="twitter:title"
          content="UNSPSC Code Lookup, Search, Classify | Classifast"
        />
        <meta
          name="twitter:description"
          content="Find UNSPSC codes quickly. Instant UNSPSC code lookup, category search, and classification of products and services."
        />
      </>
    );
  }
  return (
    <>
      <meta
        name="twitter:title"
        content={`${type} Code Lookup, Search, Classify | Classifast`}
      />
      <meta
        name="twitter:description"
        content={`Find ${type} codes quickly. Instant ${type} classification, search, and mapping.`}
      />
    </>
  );
}

interface Logo {
  readonly path: string;
  readonly alt: string;
  readonly className: string;
}

const LOGOS: Readonly<Record<string, Logo>> = {
  NACE: {
    path: "images/Eurostat_Newlogo.png",
    alt: "NACE classification standard logo",
    className:
      "hidden lg:block pointer-events-none absolute right-8 top-2 h-28 w-auto",
  },
  CN: {
    path: "images/logo_en_brand.png",
    alt: "CN classification standard logo",
    className:
      "hidden lg:block pointer-events-none absolute right-8 top-2 w-auto",
  },
  HS: {
    path: "images/cl09nx0ml001578c25z5411if.png",
    alt: "HS classification standard logo",
    className:
      "hidden lg:block pointer-events-none absolute right-8 top-0 h-24 w-auto",
  },
  NAICS: {
    path: "images/naics-logo.png",
    alt: "NAICS classification standard logo",
    className:
      "hidden lg:block pointer-events-none absolute right-8 -top-4 h-32 w-auto",
  },
  UNSPSC: {
    path: "images/unspsc-logo.gif",
    alt: "UNSPSC classification standard logo",
    className:
      "hidden lg:block pointer-events-none absolute right-8 top-1 h-24 w-auto",
  },
  GPC: {
    path: "images/GS1.png",
    alt: "GS1 GPC classification standard logo",
    className:
      "hidden lg:block pointer-events-none absolute right-8 top-1 h-24 w-auto",
  },
  ETIM: {
    path: "images/ETIM-International_logo.svg",
    alt: "ETIM International classification standard logo",
    className:
      "hidden lg:block pointer-events-none absolute right-8 top-4 h-20 w-auto",
  },
  HTS: {
    path: "images/hts-logo.jpg",
    alt: "HTS classification standard logo",
    className:
      "hidden lg:block pointer-events-none absolute right-8 top-0 h-24 w-auto",
  },
};

const RESOURCES: Readonly<Record<string, ClassifierResources>> = {
  UNSPSC: {
    className: " text-gray-800",
    listClassName: "flex flex-wrap items-center gap-x-3 mb-6",
    links: [
      ["https://www.undp.org/unspsc", "UNDP"],
      ["https://www.ungm.org/public/unspsc", "UNGM Search"],
      [
        "https://help.ungm.org/hc/en-us/articles/360012816160-What-are-UNSPSC-codes",
        "UNGM Help",
      ],
      ["https://developer.ungm.org/Article/UNSPSC", "UNGM API"],
      ["https://en.wikipedia.org/wiki/UNSPSC", "Wiki"],
    ],
  },
  EMDN: {
    className: "text-gray-800",
    listClassName: "flex flex-wrap items-center gap-x-3",
    links: [
      [
        "https://health.ec.europa.eu/medical-devices-topics-interest/european-medical-devices-nomenclature-emdn_en",
        "European Commission EMDN",
      ],
      [
        "https://webgate.ec.europa.eu/dyna2/emdn/build/EMDN%20v2026_EN.xlsx",
        "Download EMDN",
      ],
      ["https://ec.europa.eu/tools/eudamed/eudamed", "EUDAMED"],
      ["https://webgate.ec.europa.eu/eudamed", "Sign in to EUDAMED"],
    ],
  },
  NAICS: {
    className: " text-gray-800",
    listClassName: "flex flex-wrap items-center gap-x-3",
    links: [
      ["https://www.census.gov/naics/", "U.S. Census Bureau"],
      ["https://www.naics.com/search/", "NAICS Search"],
      [
        "https://en.wikipedia.org/wiki/North_American_Industry_Classification_System",
        "Wiki",
      ],
    ],
  },
  NACE: {
    className: " text-gray-800",
    listClassName: "flex flex-wrap items-center gap-x-3",
    links: [
      ["https://ec.europa.eu/eurostat/web/nace", "Eurostat"],
      [
        "https://en.wikipedia.org/wiki/Statistical_Classification_of_Economic_Activities_in_the_European_Community",
        "Wiki",
      ],
    ],
  },
  ETIM: {
    className: " text-gray-800",
    listClassName: "flex flex-wrap items-center gap-x-3",
    links: [
      ["https://www.etim-international.com/", "ETIM International"],
      ["https://en.wikipedia.org/wiki/ETIM_(standard)", "Wiki"],
    ],
  },
  ISIC: {
    className: " text-gray-800",
    listClassName: "flex flex-wrap items-center gap-x-3",
    links: [
      [
        "https://unstats.un.org/unsd/classifications/Econ",
        "UN Statistics Division",
      ],
      [
        "https://en.wikipedia.org/wiki/International_Standard_Industrial_Classification",
        "Wiki",
      ],
    ],
  },
  CN: {
    className: " text-gray-800",
    listClassName: "flex flex-wrap items-center gap-x-3",
    links: [
      [
        "https://taxation-customs.ec.europa.eu/customs/common-customs-tariff-cct/tariff-classification-goods/combined-nomenclature_en",
        "EU Combined Nomenclature",
      ],
      [
        "https://trade.ec.europa.eu/access-to-markets/en/content/combined-nomenclature-0",
        "Access2Markets",
      ],
      [
        "https://taxation-customs.ec.europa.eu/customs/common-customs-tariff-cct/tariff-classification-goods/eu-customs-tariff-taric_en",
        "EU TARIC",
      ],
      ["https://www.tariffnumber.com/", "Tariffnumber"],
      ["https://en.wikipedia.org/wiki/Combined_Nomenclature", "Wiki"],
    ],
  },
};

interface ComparisonCard {
  readonly classifierType: string;
  readonly label: string;
  readonly ariaLabel: string;
  readonly description: string;
}

const COMPARISON_CARDS: readonly ComparisonCard[] = [
  {
    classifierType: "UNSPSC",
    label: "UNSPSC",
    ariaLabel: "UNSPSC Classification Tool",
    description:
      "Global product/service classification for procurement and supply chain management.",
  },
  {
    classifierType: "GPC",
    label: "GS1 GPC",
    ariaLabel: "GS1 GPC Classification Tool",
    description: "Find the right GPC brick code by essential characteristics.",
  },
  {
    classifierType: "EMDN",
    label: "EMDN",
    ariaLabel: "EMDN Classification Tool",
    description:
      "European nomenclature for assigning medical device codes used with EUDAMED.",
  },
  {
    classifierType: "ETIM",
    label: "ETIM",
    ariaLabel: "ETIM Classification Tool",
    description:
      "Technical product classification for electrical and building technology sectors.",
  },
  {
    classifierType: "NAICS",
    label: "NAICS",
    ariaLabel: "NAICS Classification Tool",
    description:
      "North American business classification for government contracting and statistics.",
  },
  {
    classifierType: "ISIC",
    label: "ISIC",
    ariaLabel: "ISIC Classification Tool",
    description:
      "UN global standard for economic activity classification and international statistics.",
  },
  {
    classifierType: "HS",
    label: "HS",
    ariaLabel: "HS Classification Tool",
    description:
      "Harmonized System codes for international trade and customs classification.",
  },
  {
    classifierType: "HTS",
    label: "HTS",
    ariaLabel: "HTS Classification Tool",
    description:
      "Harmonized Tariff Schedule codes for US imports and customs classification.",
  },
  {
    classifierType: "CN",
    label: "CN",
    ariaLabel: "CN Classification Tool",
    description:
      "EU Combined Nomenclature for customs and trade within the European Union.",
  },
  {
    classifierType: "NACE",
    label: "NACE",
    ariaLabel: "NACE Classification Tool",
    description:
      "EU statistical classification of economic activities for business statistics.",
  },
  {
    classifierType: "CPV",
    label: "CPV",
    ariaLabel: "CPV Classification Tool",
    description:
      "Common Procurement Vocabulary for EU public procurement and tenders.",
  },
  {
    classifierType: "NSN",
    label: "NSN",
    ariaLabel: "NSN Classification Tool",
    description:
      "NATO Stock Number classification for defense and military logistics.",
  },
];

/** The <title> text, as document.title reads it. */
function documentTitle(classifierType: string, search: string): string {
  if (search) return `${classifierType} codes for '${pyTitle(search)}'`;
  return `${classifierType} Code Lookup, Search, Classify, Map | Classifast`;
}

function classifierIslandProps(
  props: ClassifierPageProps,
): ClassifierIslandProps {
  const { links, classifierType, page, results } = props;
  const logo = LOGOS[classifierType];
  return {
    classifierType,
    heading: page.heading,
    description: page.description.trim() ? page.description : "",
    logo: logo
      ? {
          src: links.staticFile(logo.path),
          alt: logo.alt,
          className: logo.className,
        }
      : null,
    resources: RESOURCES[classifierType] ?? null,
    form: {
      versions: page.versions,
      version: props.version || props.firstVersion,
      topK: props.topK,
      // The base page's example is the placeholder and the fallback query.
      text: props.defaultExamplePrefill ? "" : results.query,
      placeholder: page.example,
      enhance: props.enhanceQuery,
    },
    initial: {
      ...toResultsView(results.results, {
        classifierType,
        version: results.version,
        elapsedSeconds: results.elapsedSeconds,
        stripCodeDots: props.stripCodeDots,
      }),
      query: results.query,
      loaded: results.loaded,
    },
    start: {
      autoload: props.triggerSearchOnLoad && page.versions.length > 0,
      example: props.defaultExamplePrefill ? results.query : null,
      title: documentTitle(classifierType, props.search).replace(
        /[\t\n\f\r ]+/g,
        " ",
      ),
    },
  };
}

export function ClassifierPage(props: ClassifierPageProps) {
  const {
    links,
    currentYear,
    classifierType,
    page,
    search,
    canonicalUrl,
    popularLookupLinks,
  } = props;
  return (
    <html lang="en">
      <head>
        <meta charSet="UTF-8" />
        <HeadMetadata {...props} />
        <meta name="author" content="Dmitry Matv" />
        <meta name="creator" content="Dmitry Matv" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <link rel="canonical" href={canonicalUrl} />
        <link rel="home" href={links.home} />
        <link
          rel="icon"
          href="/static/images/favicon-32x32.png"
          type="image/png"
          sizes="32x32"
        />
        <link
          rel="icon"
          href="/static/images/favicon-16x16.png"
          type="image/png"
          sizes="16x16"
        />
        <link
          rel="apple-touch-icon"
          sizes="180x180"
          href="/static/images/apple-touch-icon.png"
        />
        <meta property="og:type" content="website" />
        <OpenGraphText classifierType={classifierType} />
        <meta property="og:url" content={canonicalUrl} />
        <meta property="og:site_name" content="classifast.com" />
        <meta
          property="og:image"
          content={links.staticFile("images/preview_classifybox.png")}
        />
        <meta property="og:image:width" content="1200" />
        <meta property="og:image:height" content="630" />
        <meta
          property="og:image:alt"
          content={`${classifierType} Automatic Classification`}
        />
        <meta name="twitter:card" content="summary_large_image" />
        <TwitterText classifierType={classifierType} search={search} />
        <meta
          name="twitter:image"
          content="https://classifast.com/static/images/preview_classifybox.png"
        />
        <meta name="twitter:site" content="@DimonBitcoin" />
        <meta name="twitter:creator" content="@DimonBitcoin" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin=""
        />
        <link
          rel="preconnect"
          href="https://clerk.classifast.com"
          crossOrigin=""
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;700&display=swap"
          rel="stylesheet"
        />
        <script
          async
          src="https://www.googletagmanager.com/gtag/js?id=G-JK3ESE6CJR"
        ></script>
        <script dangerouslySetInnerHTML={{ __html: GTAG_SCRIPT }} />
        {jsonLdScripts(props).map((script, index) => (
          <script
            key={index}
            type="application/ld+json"
            dangerouslySetInnerHTML={{ __html: script }}
          />
        ))}
        <link href={assetUrl("/css/styles.css")} rel="stylesheet" />
        <script type="module" src={assetUrl("/js/site.js")}></script>
        <style dangerouslySetInnerHTML={{ __html: CLASSIFIER_PAGE_CSS }} />
      </head>
      <body
        className="classifier-surface text-gray-800 min-h-screen"
        style={BODY_STYLE}
      >
        <Island
          name="header"
          as="header"
          className="bg-white relative"
          props={{
            variant: "classifier",
            links: headerLinks(links, HOME_MENU),
            classifier: {
              name: classifierType,
              url: links.classifier(classifierType),
            },
          }}
        />
        <main className="container mx-auto p-3 max-w-5xl mb-4">
          <nav className="mb-4" aria-label="Breadcrumb">
            <ol className="flex items-center text-gray-500">
              <li>
                <a
                  href={links.home}
                  className="hover:text-sky-700 hover:underline underline-offset-2 transition-colors"
                >
                  Home
                </a>
              </li>
              <li className="flex items-center">
                <span className="mx-2 text-gray-500">/</span>{" "}
                <span className="text-gray-800">{page.title}</span>
              </li>
            </ol>
          </nav>
          <Island
            name="classifier"
            as="section"
            id="classifier-form-section"
            className="bg-white p-6 rounded-lg shadow mb-4"
            aria-labelledby="classifier-form-heading"
            props={classifierIslandProps(props)}
          />
          {classifierType === "UNSPSC" && <UnspscGuide />}
          {CLASSIFIER_GUIDES[classifierType]}
          {!search && popularLookupLinks.length > 0 && (
            <section
              id="popular-lookups"
              className="bg-white p-6 rounded-lg shadow max-w-5xl mx-auto mt-4"
              aria-labelledby="popular-lookups-heading"
            >
              <h2
                id="popular-lookups-heading"
                className="text-xl font-bold text-gray-800 mb-4"
              >
                Popular {classifierType} code lookups
              </h2>
              <ul
                className="grid gap-x-6 gap-y-2 sm:grid-cols-2 lg:grid-cols-3"
                role="list"
              >
                {popularLookupLinks.map((item) => (
                  <li key={item.url}>
                    <a
                      href={item.url}
                      className="text-sky-700 hover:text-sky-800 hover:underline underline-offset-2"
                    >
                      {classifierType} codes for {item.label}
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          )}
          <section
            id="comparison-guide"
            className="bg-white p-6 rounded-lg shadow max-w-5xl mx-auto mt-4"
            role="complementary"
            aria-label="Other Classification Standards"
          >
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
              {COMPARISON_CARDS.filter(
                (card) => card.classifierType !== classifierType,
              ).map((card) => (
                <article
                  key={card.classifierType}
                  className="border border-gray-200 rounded p-3 shadow"
                  role="article"
                >
                  <h3 className="font-semibold text-gray-800 mb-2">
                    <a
                      href={links.classifier(card.classifierType)}
                      className="text-sky-700 hover:text-sky-800 underline decoration-sky-700 underline-offset-2"
                      role="link"
                      aria-label={card.ariaLabel}
                    >
                      {card.label}
                    </a>
                  </h3>
                  <p className="text-gray-600">{card.description}</p>
                </article>
              ))}
            </div>
          </section>
        </main>
        <SiteFooter links={links} currentYear={currentYear} />
      </body>
    </html>
  );
}
