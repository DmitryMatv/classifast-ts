import type { PopularLookupLink } from "../classifier/popular-lookups.js";
import { assetUrl } from "./asset-url.js";
import { BODY_STYLE } from "./body-style.js";
import { HOME_PAGE_CSS } from "./home-page-styles.js";
import { SiteFooter } from "./site-footer.js";
import type { SiteLinks } from "./site-links.js";

export interface HomePageProps {
  readonly links: SiteLinks;
  readonly currentYear: number;
  readonly popularLookupLinks: readonly PopularLookupLink[];
}

const GTAG_SCRIPT = `
        window.dataLayer = window.dataLayer || [];
        function gtag() { dataLayer.push(arguments); }
        gtag('js', new Date());

        gtag('config', 'G-JK3ESE6CJR');
    `;

const WEB_APPLICATION_JSON_LD = `
    {
        "@context": "https://schema.org",
        "@type": "WebApplication",
        "name": "Classifast | AI-Powered UNSPSC Code Lookup, ETIM & NAICS Classification Tool",
        "url": "https://classifast.com/",
        "description": "AI-powered classification tool providing fast and accurate UNSPSC code lookup, ETIM classification, and NAICS code search. Streamline your product and service categorization with semantic search technology.",
        "author": {
            "@type": "Person",
            "name": "Dmitry Matv"
        },
        "keywords": "UNSPSC code, UNSPSC code lookup, UNSPSC codes list, find UNSPSC code, UNSPSC classification, commodity code UNSPSC, UNSPSC categories, NAICS code, NAICS code search, find NAICS code, NAICS industry code lookup, ETIM classification, product classification, service classification, classifier, data management, semantic search",
        "applicationCategory": "BusinessApplication",
        "operatingSystem": "Web",
        "offers": {
            "@type": "Offer",
            "price": "0.10",
            "priceCurrency": "USD",
            "description": "Per classification request"
        },
        "provider": {
            "@type": "Organization",
            "name": "Classifast",
            "url": "https://classifast.com/"
        },
        "featureList": [
            "UNSPSC code lookup and classification",
            "ETIM product classification",
            "NAICS industry code search",
            "Semantic search technology",
            "Bulk classification support",
            "High accuracy matching"
        ]
    }
    `;

const FAQ_JSON_LD = `
    {
        "@context": "https://schema.org",
        "@type": "FAQPage",
        "mainEntity": [
            {
                "@type": "Question",
                "name": "What is UNSPSC classification?",
                "acceptedAnswer": {
                    "@type": "Answer",
                    "text": "UNSPSC (United Nations Standard Products and Services Code) is a global standard used to organize products and services into hierarchical categories. It helps businesses improve spend analytics, streamline procurement, and enhance data governance."
                }
            },
            {
                "@type": "Question",
                "name": "How does ETIM classification work?",
                "acceptedAnswer": {
                    "@type": "Answer",
                    "text": "ETIM (Technical Information Model) is an open standard for the unambiguous grouping and specification of products in the technical sector. It provides a uniform classification system for electronic exchange of product data, especially for technical and electrical products."
                }
            },
            {
                "@type": "Question",
                "name": "What are NAICS codes used for?",
                "acceptedAnswer": {
                    "@type": "Answer",
                    "text": "NAICS (North American Industry Classification System) codes are used to classify businesses by their primary economic activity. They're essential for government contracting, statistical analysis, and business reporting across North America."
                }
            },
            {
                "@type": "Question",
                "name": "How accurate is AI-powered classification?",
                "acceptedAnswer": {
                    "@type": "Answer",
                    "text": "Our AI-powered classification uses state-of-the-art embedding models to deliver high accuracy results. Each classification includes a confidence score, and detailed product descriptions typically yield better matches than generic terms."
                }
            },
            {
                "@type": "Question",
                "name": "Can I classify products in bulk?",
                "acceptedAnswer": {
                    "@type": "Answer",
                    "text": "Yes, Classifast supports bulk classification for large datasets. This feature is perfect for businesses looking to categorize their entire product catalog or service offerings efficiently."
                }
            }
        ]
    }
    `;

export function HomePage({
  links,
  currentYear,
  popularLookupLinks,
}: HomePageProps) {
  return (
    <html lang="en">
      <head>
        <meta charSet="UTF-8" />
        <title>
          Classify any description to UNSPSC, HS/CN codes, NAICS, etc.
        </title>
        <meta
          name="description"
          content="Code finder for UNSPSC, NAICS, HS, CN, and other standard codes. Accurate category search, lookup, mapping, classification of products and services."
        />
        <meta
          name="keywords"
          content="code lookup, code mapping, code crosswalk, code search, find code, classification, commodity code, UNSPSC categories, NAICS code search, find NAICS code, NAICS industry code lookup, product classification"
        />
        <meta name="author" content="Dmitry Matv" />
        <meta name="creator" content="Dmitry Matv" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <link rel="canonical" href="https://classifast.com/" />
        <link rel="home" href="https://classifast.com/" />
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
          content="Classify any description to UNSPSC, HS/CN code, NAICS, etc."
        />
        <meta
          property="og:description"
          content="Simple finder for UNSPSC, NAICS, HS, CN, and other standard codes. Accurate category search, lookup, mapping, classification of products and services."
        />
        <meta property="og:url" content="https://classifast.com/" />
        <meta property="og:site_name" content="classifast.com" />
        <meta
          property="og:image"
          content="https://classifast.com/static/images/preview.png"
        />
        <meta property="og:image:width" content="1200" />
        <meta property="og:image:height" content="630" />
        <meta
          property="og:image:alt"
          content={"Classifast - Instant Classification & Lookup"}
        />
        <meta name="twitter:card" content="summary_large_image" />
        <meta
          name="twitter:title"
          content="Classifast | Fast classification according to many industry standards"
        />
        <meta
          name="twitter:description"
          content="Find UNSPSC, NAICS, ISIC, and other classification codes. Semantic search to accurately lookup and classify products and services."
        />
        <meta
          name="twitter:image"
          content="https://classifast.com/static/images/preview.png"
        />
        <meta name="twitter:site" content="@DimonBitcoin" />
        <meta name="twitter:creator" content="@DimonBitcoin" />
        <meta name="msvalidate.01" content="047F82015E36CB871F2BCF50095278F1" />
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
          href={
            "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;700&display=swap"
          }
          rel="stylesheet"
        />
        <script
          async
          src="https://www.googletagmanager.com/gtag/js?id=G-JK3ESE6CJR"
        ></script>
        <script dangerouslySetInnerHTML={{ __html: GTAG_SCRIPT }} />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: WEB_APPLICATION_JSON_LD }}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: FAQ_JSON_LD }}
        />
        <link href={assetUrl("/css/styles.css")} rel="stylesheet" />
        <script type="module" src={assetUrl("/js/common.js")}></script>
        <style dangerouslySetInnerHTML={{ __html: HOME_PAGE_CSS }} />
      </head>
      <body
        className="home-surface text-gray-800 flex flex-col min-h-screen"
        style={BODY_STYLE}
      >
        <header className="site-masthead" role="banner">
          <div className="container mx-auto flex min-h-14 justify-between items-center max-w-6xl px-4">
            <div className="flex items-center">
              <a href={links.home} className="flex items-center">
                <p className="text-xl font-bold text-gray-800">
                  Classi<span className="text-sky-600">fast</span>
                </p>
              </a>
            </div>
            <nav
              className="desktop-nav ml-auto mr-8"
              role="navigation"
              aria-label="Main navigation"
            >
              <ul className="flex space-x-6 items-center">
                <li>
                  <a
                    href={links.mappingIndex}
                    className="text-gray-600 hover:text-sky-700 hover:underline underline-offset-2 transition-colors"
                    role="link"
                    aria-label="Mapping Files"
                  >
                    Mapping
                  </a>
                </li>
                <li>
                  <a
                    href="https://blog.classifast.com"
                    target="_blank"
                    rel="noopener"
                    className="text-gray-600 hover:text-sky-700 hover:underline underline-offset-2 transition-colors"
                    role="link"
                    aria-label="Blog"
                  >
                    Blog
                  </a>
                </li>
                <li className="hidden md:block">
                  <a
                    href="https://rapidapi.com/DmitryMatv/api/classifast-api"
                    target="_blank"
                    rel="noopener"
                    className="text-gray-600 hover:text-sky-700 hover:underline underline-offset-2 transition-colors"
                    role="link"
                    aria-label="API Documentation"
                  >
                    API
                  </a>
                </li>
                <li className="auth-slot" data-auth-slot="desktop">
                  <div id="desktop-auth-container"></div>
                </li>
              </ul>
            </nav>
            <div className="auth-slot" data-auth-slot="mobile">
              <div id="mobile-auth-container"></div>
            </div>{" "}
            <button
              className="hamburger"
              id="mobile-menu-button"
              aria-label="Toggle mobile menu"
              aria-expanded="false"
              role="button"
            >
              <span></span> <span></span> <span></span>
            </button>
          </div>
          <nav
            className="mobile-menu"
            id="mobile-menu"
            role="navigation"
            aria-label="Mobile navigation"
          >
            <div className="menu-panel">
              <section>
                <p className="menu-section-title">Explore</p>{" "}
                <a href={links.mappingIndex} className="menu-feature-link">
                  <strong>Mapping Files</strong>{" "}
                  <span>
                    Open crosswalk files and jump between classification
                    systems.
                  </span>
                </a>{" "}
                <div className="menu-link-list mt-3">
                  <a
                    href="https://blog.classifast.com"
                    target="_blank"
                    rel="noopener"
                  >
                    Blog
                  </a>{" "}
                  <a
                    href="https://rapidapi.com/DmitryMatv/api/classifast-api"
                    target="_blank"
                    rel="noopener"
                  >
                    API
                  </a>
                </div>
              </section>
              <section>
                <p className="menu-section-title">Classifiers</p>
                <div className="menu-chip-grid">
                  <a href={links.classifier("UNSPSC")} className="menu-chip">
                    UNSPSC
                  </a>{" "}
                  <a href={links.classifier("GPC")} className="menu-chip">
                    GS1 GPC
                  </a>{" "}
                  <a href={links.classifier("EMDN")} className="menu-chip">
                    EMDN
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
          <div
            id="google-one-tap"
            className="absolute top-20 right-4 z-50"
          ></div>
        </header>
        <main className="grow">
          <section className="hero-section">
            <div className="container mx-auto px-4 max-w-6xl">
              <div className="hero-grid">
                <div>
                  <h1 className="hero-title">
                    From text description
                    <br className="hidden md:inline" /> to category code
                    <br className="hidden md:inline" /> in 1 second.
                  </h1>
                  <p className="hero-lede">
                    Semantic search across UNSPSC, NAICS, CPV, HS/CN and many
                    other industry classification standards powered by{" "}
                    <a
                      href="https://developers.googleblog.com/en/gemini-embedding-text-model-now-available-gemini-api/"
                      target="_blank"
                      rel="noopener"
                    >
                      vector embeddings for text understanding
                    </a>
                    .
                  </p>
                  <div className="hero-cta-row">
                    <a
                      href={links.classifier("UNSPSC")}
                      className="cta-primary"
                    >
                      Find UNSPSC code
                    </a>{" "}
                    <a href="#standards" className="cta-secondary">
                      Browse all classifiers
                    </a>
                  </div>
                  <p className="hero-note">
                    10 free searches. 30 more with free account. Unlimited for
                    $50.
                  </p>
                </div>
                <div
                  className="demo-card"
                  aria-label="Sample classification result"
                >
                  <div className="demo-head">
                    <span>Example</span>{" "}
                    <span className="demo-kind">UNSPSC</span>
                  </div>
                  <div className="demo-query">
                    <p className="demo-query-label">Input description</p>
                    <p className="demo-query-text">
                      MacBook Air (13-inch, M3, 2024)
                    </p>
                  </div>
                  <ul className="demo-rows">
                    <li className="demo-row">
                      <div className="demo-row-top">
                        <span className="demo-code">43 21 15 03</span>{" "}
                        <span className="demo-score">97.0%</span>
                      </div>
                      <p className="demo-name">Notebook computers</p>
                    </li>
                    <li className="demo-row">
                      <div className="demo-row-top">
                        <span className="demo-code">43 21 15 08</span>{" "}
                        <span className="demo-score">93.0%</span>
                      </div>
                      <p className="demo-name">Personal computers</p>
                    </li>
                    <li className="demo-row">
                      <div className="demo-row-top">
                        <span className="demo-code">43 21 15 07</span>{" "}
                        <span className="demo-score">91.0%</span>
                      </div>
                      <p className="demo-name">Desktop computers</p>
                    </li>
                  </ul>
                  <div className="demo-foot">
                    <a href={links.classifier("UNSPSC")}>
                      Try it with your own description
                    </a>{" "}
                    or{" "}
                    <a
                      href="https://rapidapi.com/DmitryMatv/api/classifast-api"
                      target="_blank"
                      rel="noopener"
                    >
                      via the API
                    </a>
                    .
                  </div>
                </div>
              </div>
            </div>
          </section>
          <section id="standards" className="standards-index page-section">
            <div className="container mx-auto px-4 max-w-6xl">
              <h2 className="section-title">12 standards in 1 search box</h2>
              <ul className="standards-list">
                <li>
                  <a href={links.classifier("UNSPSC")}>
                    <abbr>UNSPSC</abbr>{" "}
                    <span className="full-name">
                      United Nations Standard Products and Services Code
                    </span>
                  </a>
                </li>
                <li>
                  <a href={links.classifier("GPC")}>
                    <abbr>GPC</abbr>{" "}
                    <span className="full-name">
                      GS1 Global Product Classification
                    </span>
                  </a>
                </li>
                <li>
                  <a href={links.classifier("EMDN")}>
                    <abbr>EMDN</abbr>{" "}
                    <span className="full-name">
                      European Medical Device Nomenclature
                    </span>
                  </a>
                </li>
                <li>
                  <a href={links.classifier("NAICS")}>
                    <abbr>NAICS</abbr>{" "}
                    <span className="full-name">
                      North American Industry Classification System
                    </span>
                  </a>
                </li>
                <li>
                  <a href={links.classifier("ISIC")}>
                    <abbr>ISIC</abbr>{" "}
                    <span className="full-name">
                      International Standard Industrial Classification
                    </span>
                  </a>
                </li>
                <li>
                  <a href={links.classifier("NACE")}>
                    <abbr>NACE</abbr>{" "}
                    <span className="full-name">
                      Statistical Classification of Economic Activities
                    </span>
                  </a>
                </li>
                <li>
                  <a href={links.classifier("ETIM")}>
                    <abbr>ETIM</abbr>{" "}
                    <span className="full-name">
                      ETIM Technical Information Model
                    </span>
                  </a>
                </li>
                <li>
                  <a href={links.classifier("HS")}>
                    <abbr>HS</abbr>{" "}
                    <span className="full-name">Harmonized System</span>
                  </a>
                </li>
                <li>
                  <a href={links.classifier("HTS")}>
                    <abbr>HTS</abbr>{" "}
                    <span className="full-name">
                      Harmonized Tariff Schedule
                    </span>
                  </a>
                </li>
                <li>
                  <a href={links.classifier("CN")}>
                    <abbr>CN</abbr>{" "}
                    <span className="full-name">Combined Nomenclature</span>
                  </a>
                </li>
                <li>
                  <a href={links.classifier("CPV")}>
                    <abbr>CPV</abbr>{" "}
                    <span className="full-name">
                      Common Procurement Vocabulary
                    </span>
                  </a>
                </li>
                <li>
                  <a href={links.classifier("NSN")}>
                    <abbr>NSN</abbr>{" "}
                    <span className="full-name">NATO Stock Number</span>
                  </a>
                </li>
              </ul>
            </div>
          </section>
          <section className="features-section page-section">
            <div className="container mx-auto px-4 max-w-6xl">
              <h2 className="section-title">Forget manual classification</h2>
              <div className="feature-grid mt-8" role="list">
                <article className="feature" role="listitem">
                  <h3>Cost-effective</h3>
                  <p>
                    Try free, then go unlimited for a flat $50. No per-match
                    fees.
                  </p>
                </article>
                <article className="feature" role="listitem">
                  <h3>Almost instant</h3>
                  <p>Results in about a second, without manual research.</p>
                </article>
                <article className="feature" role="listitem">
                  <h3>Simple</h3>
                  <p>
                    A basic lookup UI, with semantic search technology in the
                    backend.
                  </p>
                </article>
                <article className="feature" role="listitem">
                  <h3>Accurate</h3>
                  <p>
                    <a
                      href="https://developers.googleblog.com/gemini-embedding-available-gemini-api/"
                      target="_blank"
                      rel="noopener"
                    >
                      Vector embeddings
                    </a>{" "}
                    deliver SOTA performance without human bias.
                  </p>
                </article>
              </div>
            </div>
          </section>
          <section className="testimonials-section page-section">
            <div className="container mx-auto px-4 max-w-6xl">
              <h2 className="section-title">
                Real feedback from PMs and business owners
              </h2>
              <div className="testimonial-grid" role="list">
                <figure className="testimonial-quote" role="listitem">
                  <p>
                    I came to my company a couple years ago and I was shocked
                    they haven't implemented it company-wide, let alone for
                    e-commerce. One product manager asked me how the heck do I
                    look these things up? This is much better than looking on
                    the .org site's spreadsheet!
                  </p>
                </figure>
                <figure className="testimonial-quote" role="listitem">
                  <p>
                    I'm on annual leave until Friday, but will try some mappings
                    on these categories and let you know how it goes! You sir
                    are a hero. I'd definitely list this for sale elsewhere as
                    well, as I'm sure many organisations will be able to use it.
                  </p>
                </figure>
                <figure className="testimonial-quote" role="listitem">
                  <p>
                    I have been trying to figure out what NAICS to use for my
                    macrame/anything i can DIY shop ALL MORNING and i stumbled
                    upon your website and YOURE A GENIUS THANK YOU!!!!!! just
                    saved me an entire afternoon of rage!!!! sending nothing but
                    positive vibes to you and yours
                  </p>
                </figure>
                <figure className="testimonial-quote" role="listitem">
                  <p>
                    Surprised you stumbled across this. I can't even remember
                    the problem I was trying to solve back then, but I'll
                    certainly give this a look. Cheers!
                  </p>
                </figure>
                <figure className="testimonial-quote" role="listitem">
                  <p>Wow, denne var genial. Tusen takk!!!</p>
                </figure>
              </div>
            </div>
          </section>
          {popularLookupLinks.length > 0 && (
            <section
              className="popular-section page-section"
              aria-labelledby="popular-lookups-heading"
            >
              <div className="container mx-auto px-4 max-w-6xl">
                <h2 id="popular-lookups-heading" className="section-title">
                  Popular code lookups
                </h2>
                <p className="section-lede">
                  Jump straight to frequently searched classification examples.
                </p>
                <ul className="popular-grid" role="list">
                  {popularLookupLinks.map((item) => (
                    <li key={item.url}>
                      <a href={item.url}>
                        <span className="classifier-mark">
                          {item.classifierType}
                        </span>{" "}
                        codes for {item.label}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            </section>
          )}
        </main>
        <SiteFooter links={links} currentYear={currentYear} />
        <script
          defer
          crossOrigin="anonymous"
          src="https://clerk.classifast.com/npm/@clerk/ui@1/dist/ui.browser.js"
          type="text/javascript"
        ></script>
        <script
          defer
          crossOrigin="anonymous"
          data-clerk-publishable-key="pk_live_Y2xlcmsuY2xhc3NpZmFzdC5jb20k"
          src="https://clerk.classifast.com/npm/@clerk/clerk-js@6/dist/clerk.browser.js"
          type="text/javascript"
        ></script>
      </body>
    </html>
  );
}
