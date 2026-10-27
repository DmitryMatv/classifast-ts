import { assetUrl } from "./asset-url.js";
import { BODY_STYLE } from "./body-style.js";
import { Island } from "./islands/render-island.js";
import type { MappingProduct } from "../mapping/mapping-store.js";
import { MAPPING_INDEX_PAGE_CSS } from "./mapping-index-page-styles.js";
import { jsonLd } from "./render.js";
import { SiteFooter } from "./site-footer.js";
import { headerLinks, type SiteLinks } from "./site-links.js";

export interface MappingIndexPageProps {
  readonly links: SiteLinks;
  readonly currentYear: number;
  readonly products: readonly MappingProduct[];
  readonly canonicalUrl: string;
}

function catalogJsonLd(
  products: readonly MappingProduct[],
  canonicalUrl: string,
): string {
  return jsonLd({
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: "Classification Mapping Files",
    description:
      "Storefront for Classifast direct mapping files and taxonomy crosswalks.",
    url: canonicalUrl,
    mainEntity: products.map((product) => ({
      "@type": "Product",
      name: product.title,
      url: `https://classifast.com/mapping/${product.slug}/`,
      description: product.metaDescription,
      image: product.imageUrl,
      offers: {
        "@type": "Offer",
        price: product.priceUsd,
        priceCurrency: "USD",
        availability: "https://schema.org/InStock",
      },
    })),
  });
}

export function MappingIndexPage({
  links,
  currentYear,
  products,
  canonicalUrl,
}: MappingIndexPageProps) {
  return (
    <html lang="en">
      <head>
        <meta charSet="UTF-8" />
        <title>Mappings, Crosswalks, Correspondence | Classifast</title>
        <meta
          name="description"
          content="Taxonomy mapping files (crosswalks) for procurement, finance, ERP, reporting systems, data conversion workflows. Free sample CSVs."
        />
        <meta
          name="keywords"
          content="classification mapping files, code crosswalk, procurement mapping, finance taxonomy mapping, UNSPSC mapping, CPV mapping, taxonomy crosswalk"
        />
        <meta name="author" content="Dmitry Matv" />
        <meta name="creator" content="Dmitry Matv" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
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
        <meta
          property="og:title"
          content="Classification Mapping Files and Crosswalks | Classifast"
        />
        <meta
          property="og:description"
          content="Direct mapping files for procurement, finance, ERP, and taxonomy conversion workflows, with sample CSV downloads and easy checkout."
        />
        <meta property="og:url" content={canonicalUrl} />
        <meta property="og:site_name" content="classifast.com" />
        <meta
          property="og:image"
          content="https://classifast.com/static/images/preview.png"
        />
        <meta name="twitter:card" content="summary_large_image" />
        <meta
          name="twitter:title"
          content="Classification Mapping Files and Crosswalks | Classifast"
        />
        <meta
          name="twitter:description"
          content="Browse direct crosswalk files, download sample CSVs, and buy full mapping files for UNSPSC, CPV, and related standards."
        />
        <meta
          name="twitter:image"
          content="https://classifast.com/static/images/preview.png"
        />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin=""
        />
        <link
          href={
            "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;700&display=swap"
          }
          rel="stylesheet"
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: catalogJsonLd(products, canonicalUrl),
          }}
        />
        <link href={assetUrl("/css/styles.css")} rel="stylesheet" />
        <script type="module" src={assetUrl("/js/site.js")}></script>
        <style dangerouslySetInnerHTML={{ __html: MAPPING_INDEX_PAGE_CSS }} />
      </head>
      <body
        className="mapping-index-surface text-gray-800 min-h-screen"
        style={BODY_STYLE}
      >
        <Island
          name="header"
          as="header"
          className="bg-white border-b border-slate-200 relative"
          props={{
            variant: "mapping",
            links: headerLinks(links),
            standards: null,
          }}
        />
        <main>
          <section className="container mx-auto max-w-6xl px-4 pt-8 pb-6 md:pt-10">
            <div className="catalog-panel px-5 py-6 md:px-7 md:py-7">
              <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-slate-900 mb-4">
                Mapping tables for cross-referencing, procurement, finance, and
                more
              </h1>
              <p className="max-w-3xl text-[1rem] md:text-[1.04rem] leading-7 text-slate-600 mb-6">
                Browse direct classification crosswalks used to align coding
                standards across sourcing, ERP, supplier master, reporting, and
                spend-analysis processes. Each mapping includes a sample CSV and
                a full downloadable file.
              </p>
              <div className="catalog-meta-grid">
                <div className="catalog-meta-card">
                  <p className="section-label mb-2">Format</p>
                  <p className="text-slate-700 leading-6">
                    Fill mapping files and structured CSV samples for
                    operational review before purchase.
                  </p>
                </div>
                <div className="catalog-meta-card">
                  <p className="section-label mb-2">Access</p>
                  <p className="text-slate-700 leading-6">
                    Review the product detail page, inspect the sample
                    structure, and purchase the full crosswalk.
                  </p>
                </div>
                <div className="catalog-meta-card">
                  <p className="section-label mb-2">Use</p>
                  <p className="text-slate-700 leading-6">
                    Suitable for cross-referencing, taxonomy harmonization,
                    supplier normalization, tender classification, and internal
                    reporting.
                  </p>
                </div>
              </div>
            </div>
          </section>
          <section className="container mx-auto max-w-6xl px-4 pb-12 md:pb-14">
            <div className="catalog-listing">
              {products.map((product) => (
                <article key={product.slug} className="listing-row">
                  <div className="listing-data">
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div className="min-w-0">
                        <p className="section-label mb-2">CROSSWALK TABLE</p>
                        <h2 className="text-xl md:text-2xl font-bold text-slate-900 leading-tight">
                          <a
                            href={links.mappingProduct(product.slug)}
                            className="hover:text-[#1b5f8e] transition-colors"
                          >
                            {product.title}
                          </a>
                        </h2>
                      </div>
                      <div className="shrink-0 text-left md:text-right">
                        <p className="text-[0.72rem] font-bold uppercase tracking-[0.12em] text-slate-500 mb-1">
                          Price
                        </p>
                        <p className="text-[1.8rem] font-bold text-slate-900">
                          ${product.priceUsd}
                        </p>
                      </div>
                    </div>
                    <p className="text-slate-600 leading-7">
                      {product.heroCopy}
                    </p>
                    <dl className="listing-specs">
                      <div>
                        <dt>Coverage</dt>
                        <dd>{product.coverageSummary}</dd>
                      </div>
                      <div>
                        <dt>Version</dt>
                        <dd>{product.versionLabel}</dd>
                      </div>
                    </dl>
                  </div>
                  <div className="listing-actions">
                    <div className="grid gap-3">
                      <Island
                        name="buy-button"
                        className="contents"
                        props={{
                          slug: product.slug,
                          returnUrl: links.mappingProduct(product.slug),
                          className: "action-button",
                        }}
                      />{" "}
                      <a
                        href={links.mappingSample(product.slug)}
                        className="action-link"
                      >
                        Download sample CSV
                      </a>{" "}
                      <a
                        href={links.mappingProduct(product.slug)}
                        className="secondary-link text-center"
                      >
                        Learn more
                      </a>
                    </div>
                  </div>
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
