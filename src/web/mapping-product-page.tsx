import { Fragment } from "react";
import type { MappingProduct } from "../mapping/mapping-store.js";
import { assetUrl } from "./asset-url.js";
import { BODY_STYLE } from "./body-style.js";
import { MAPPING_PRODUCT_PAGE_CSS } from "./mapping-product-page-styles.js";
import { jsonLd } from "./render.js";
import { SiteFooter } from "./site-footer.js";
import type { SiteLinks } from "./site-links.js";

export interface MappingProductPageProps {
  readonly links: SiteLinks;
  readonly currentYear: number;
  readonly product: MappingProduct;
  readonly canonicalUrl: string;
  readonly relatedProducts: readonly MappingProduct[];
}

function productJsonLd(product: MappingProduct, canonicalUrl: string): string {
  return jsonLd({
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.title,
    description: product.metaDescription,
    image: product.imageUrl,
    url: canonicalUrl,
    category: `${product.sourceStandard} to ${product.targetStandard} mapping`,
    offers: {
      "@type": "Offer",
      price: product.priceUsd,
      priceCurrency: "USD",
      availability: "https://schema.org/InStock",
      url: canonicalUrl,
    },
  });
}

function breadcrumbJsonLd(
  product: MappingProduct,
  canonicalUrl: string,
): string {
  return jsonLd({
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
        name: "Mappings",
        item: "https://classifast.com/mapping/",
      },
      {
        "@type": "ListItem",
        position: 3,
        name: product.title,
        item: canonicalUrl,
      },
    ],
  });
}

function faqJsonLd(product: MappingProduct): string {
  return jsonLd({
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: product.faqItems.map((faq) => ({
      "@type": "Question",
      name: faq.question,
      acceptedAnswer: { "@type": "Answer", text: faq.answer },
    })),
  });
}

export function MappingProductPage({
  links,
  currentYear,
  product,
  canonicalUrl,
  relatedProducts,
}: MappingProductPageProps) {
  return (
    <html lang="en">
      <head>
        <meta charSet="UTF-8" />
        <title>{product.seoTitle}</title>
        <meta name="description" content={product.metaDescription} />
        <meta name="keywords" content={product.keywords.join(", ")} />
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
        <meta property="og:type" content="product" />
        <meta property="og:title" content={product.seoTitle} />
        <meta property="og:description" content={product.metaDescription} />
        <meta property="og:url" content={canonicalUrl} />
        <meta property="og:site_name" content="classifast.com" />
        <meta
          property="og:image"
          content="https://classifast.com/static/images/preview.png"
        />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content={product.seoTitle} />
        <meta name="twitter:description" content={product.metaDescription} />
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
            __html: productJsonLd(product, canonicalUrl),
          }}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: breadcrumbJsonLd(product, canonicalUrl),
          }}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: faqJsonLd(product) }}
        />
        <link href={assetUrl("/css/styles.css")} rel="stylesheet" />
        <script type="module" src={assetUrl("/js/common.js")}></script>
        <script type="module" src={assetUrl("/js/storefront.js")}></script>
        <style dangerouslySetInnerHTML={{ __html: MAPPING_PRODUCT_PAGE_CSS }} />
      </head>
      <body
        className="mapping-surface text-gray-800 min-h-screen"
        data-auth-ui="disabled"
        style={BODY_STYLE}
      >
        <header className="bg-white border-b border-slate-200 relative">
          <div className="container mx-auto flex min-h-14 justify-between items-center max-w-6xl px-4">
            <a href={links.home} className="flex items-center">
              <p className="text-xl font-bold text-gray-800 mr-6">
                Classi<span className="text-sky-600">fast</span>
              </p>{" "}
              <span className="text-sm md:text-xl font-medium text-slate-600">
                {product.sourceStandard} {"->"} {product.targetStandard}
              </span>
            </a>{" "}
            <nav
              className="desktop-nav ml-auto mr-8"
              role="navigation"
              aria-label="Main navigation"
            >
              <ul className="flex space-x-6 items-center">
                <li>
                  <a
                    href={links.classifier(product.sourceStandard)}
                    className="text-gray-600 hover:text-sky-700 hover:underline underline-offset-2 transition-colors"
                  >
                    {product.sourceStandard}
                  </a>
                </li>
                <li>
                  <a
                    href={links.classifier(product.targetStandard)}
                    className="text-gray-600 hover:text-sky-700 hover:underline underline-offset-2 transition-colors"
                  >
                    {product.targetStandard}
                  </a>
                </li>
              </ul>
            </nav>{" "}
            <button
              className="hamburger"
              id="mobile-menu-button"
              aria-label="Toggle mobile menu"
              aria-expanded="false"
            >
              <span></span> <span></span> <span></span>
            </button>
          </div>
          <nav
            className="mobile-menu"
            id="mobile-menu"
            aria-label="Mobile navigation"
          >
            <div className="menu-panel">
              <section>
                <p className="menu-section-title">Current page</p>{" "}
                <a href={links.mappingIndex} className="menu-feature-link">
                  <strong>
                    {product.sourceStandard} to {product.targetStandard}
                  </strong>{" "}
                  <span>
                    Stay on this mapping file or jump directly into a classifier
                    from here.
                  </span>
                </a>{" "}
                <div className="menu-link-list mt-3">
                  <a href={links.home}>Home</a>{" "}
                  <a href={links.mappingIndex}>Mappings</a>
                </div>
              </section>
              <section>
                <p className="menu-section-title">Classifiers</p>
                <div className="menu-chip-grid">
                  <a href={links.classifier("UNSPSC")} className="menu-chip">
                    UNSPSC
                  </a>{" "}
                  <a href={links.classifier("GPC")} className="menu-chip">
                    GPC
                  </a>{" "}
                  <a href={links.classifier("NAICS")} className="menu-chip">
                    NAICS
                  </a>{" "}
                  <a href={links.classifier("CN")} className="menu-chip">
                    CN
                  </a>{" "}
                  <a href={links.classifier("ETIM")} className="menu-chip">
                    ETIM
                  </a>{" "}
                  <a href={links.classifier("ISIC")} className="menu-chip">
                    ISIC
                  </a>{" "}
                  <a href={links.classifier("HS")} className="menu-chip">
                    HS
                  </a>{" "}
                  <a href={links.classifier("HTS")} className="menu-chip">
                    HTS
                  </a>{" "}
                  <a href={links.classifier("NACE")} className="menu-chip">
                    NACE
                  </a>{" "}
                  <a href={links.classifier("CPV")} className="menu-chip">
                    CPV
                  </a>{" "}
                  <a href={links.classifier("NSN")} className="menu-chip">
                    NSN
                  </a>
                </div>
              </section>
            </div>
          </nav>
        </header>
        <main className="container mx-auto max-w-7xl px-4 py-8 md:py-10">
          <nav className="mb-6 text-sm text-slate-500" aria-label="Breadcrumb">
            <ol className="flex items-center gap-2 flex-wrap">
              <li>
                <a
                  href={links.home}
                  className="hover:text-sky-700 transition-colors"
                >
                  Home
                </a>
              </li>
              <li>/</li>
              <li>
                <a
                  href={links.mappingIndex}
                  className="hover:text-sky-700 transition-colors"
                >
                  Mappings
                </a>
              </li>
              <li>/</li>
              <li className="text-slate-700">{product.title}</li>
            </ol>
          </nav>
          <div
            id="storefront-success-message"
            data-storefront-success=""
            className="hidden mb-6 rounded-[0.8rem] border border-emerald-200 bg-emerald-50 px-5 py-4 text-emerald-800"
          >
            Checkout started successfully. Polar will handle payment and secure
            file delivery after purchase.
          </div>
          <section className="grid gap-8 lg:grid-cols-[minmax(0,1.45fr)_22rem]">
            <article className="content-panel p-6 md:p-7">
              <header className="mb-8 border-b border-slate-200 pb-6">
                <h1 className="text-[2rem] md:text-[2.3rem] font-bold tracking-tight text-slate-900 mb-4">
                  {product.title}
                </h1>
                <p className="text-[1rem] md:text-[1.04rem] text-slate-600 leading-7 mb-6">
                  {product.heroCopy}
                </p>
                <div className="info-strip">
                  <div className="info-strip-item">
                    <p className="section-label mb-2">Version</p>
                    <p className="font-semibold text-slate-900">
                      {product.versionLabel}
                    </p>
                  </div>
                  <div className="info-strip-item">
                    <p className="section-label mb-2">Last Updated</p>
                    <p className="text-slate-700">{product.updatedAt}</p>
                  </div>
                  <div className="info-strip-item info-strip-item-wide">
                    <p className="section-label mb-2">Coverage</p>
                    <p className="text-slate-700">{product.coverageSummary}</p>
                  </div>
                </div>
              </header>
              <section className="mb-9">
                <h2 className="text-[1.35rem] md:text-[1.5rem] font-bold text-slate-900 mb-4">
                  Typical use cases
                </h2>
                <ul className="space-y-3 text-slate-700 leading-7">
                  {product.useCases.map((useCase) => (
                    <li
                      key={useCase}
                      className="border-l-2 border-slate-300 pl-4"
                    >
                      {useCase}
                    </li>
                  ))}
                </ul>
              </section>
              <section className="mb-9">
                <h2 className="text-[1.35rem] md:text-[1.5rem] font-bold text-slate-900 mb-4">
                  FAQ
                </h2>
                <div className="space-y-3">
                  {product.faqItems.map((faq) => (
                    <div key={faq.question} className="faq-item">
                      <h3 className="font-semibold text-slate-900 mb-2">
                        {faq.question}
                      </h3>
                      <p className="text-slate-600 leading-7">{faq.answer}</p>
                    </div>
                  ))}
                </div>
              </section>
              <section className="compliance-note rounded-[0.8rem] border border-slate-200 px-5 py-4">
                <h2 className="text-[1.05rem] font-semibold text-slate-900 mb-2">
                  Operational note
                </h2>
                <p className="text-slate-700 leading-7">{product.disclaimer}</p>
              </section>
            </article>
            <aside className="space-y-4">
              <section className="aside-box purchase-box">
                <p className="section-label mb-2">Full crosswalk table</p>
                <p className="text-[2rem] font-bold text-slate-900 mb-3">
                  ${product.priceUsd}
                </p>
                <p className="text-slate-700 leading-7 mb-4">
                  {product.paidFormatLabel} for {product.sourceStandard} and{" "}
                  {product.targetStandard} reference and conversion workflows.
                </p>
                <div className="rounded-xl border border-slate-200 bg-white px-4 py-4 mb-4">
                  <p className="section-label mb-2">Table columns</p>
                  <p className="text-sm leading-6 text-slate-600">
                    {product.includedFields.join(", ")}
                  </p>
                </div>
                <div className="space-y-2">
                  <button
                    type="button"
                    data-mapping-buy-button=""
                    data-mapping-slug={product.slug}
                    data-return-url={canonicalUrl}
                    className="primary-action"
                  >
                    Buy full mapping file
                  </button>{" "}
                  <a
                    href={links.mappingSample(product.slug)}
                    className="secondary-action"
                  >
                    Download sample CSV
                  </a>
                </div>
                <div className="sample-callout mt-4">
                  <img
                    src="https://cdn-icons-png.flaticon.com/512/8242/8242984.png"
                    alt="CSV icon"
                  />{" "}
                  <div>
                    <p className="font-semibold text-slate-900 mb-1">
                      Check before you buy
                    </p>
                    <p className="text-sm leading-6 text-slate-600">
                      Review the free CSV sample structure and data quality
                      before purchasing.
                    </p>
                  </div>
                </div>
              </section>
              {relatedProducts.length > 0 && (
                <section className="aside-box">
                  <h2 className="text-[1.15rem] font-bold text-slate-900 mb-4">
                    Related
                  </h2>
                  <div className="space-y-3">
                    {relatedProducts.map((relatedProduct, index) => (
                      <Fragment key={relatedProduct.slug}>
                        {index > 0 && " "}
                        <a
                          href={links.mappingProduct(relatedProduct.slug)}
                          className="related-link"
                        >
                          <p className="section-label mb-2">CROSSWALK TABLE</p>
                          <p className="font-semibold text-slate-900">
                            {relatedProduct.title}
                          </p>
                        </a>
                      </Fragment>
                    ))}
                  </div>
                </section>
              )}
            </aside>
          </section>
        </main>
        <SiteFooter links={links} currentYear={currentYear} />
      </body>
    </html>
  );
}
