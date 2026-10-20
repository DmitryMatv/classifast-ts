import type { SiteLinks } from "./site-links.js";

export interface SiteFooterProps {
  readonly links: SiteLinks;
  readonly currentYear: number;
}

export function SiteFooter({ links, currentYear }: SiteFooterProps) {
  return (
    <footer
      className="bg-gray-800 text-white"
      role="contentinfo"
      aria-label="Site footer"
    >
      <div className="container mx-auto max-w-6xl px-4 py-12">
        <div className="grid md:grid-cols-4 gap-8">
          <div className="md:col-span-2">
            <p className="text-md font-semibold mb-4">
              <a
                href={links.home}
                className="hover:text-sky-600 transition-colors"
                role="link"
                aria-label="Classifast Homepage"
              >
                Instant category code search and classifier for UNSPSC, NAICS,
                NACE, HS/CN codes, and other classification standards.
              </a>
            </p>
          </div>
          <div>
            <h2 className="text-lg font-semibold mb-4">
              Classification Standards
            </h2>
            <ul className="space-y-2">
              <li>
                <a
                  href={links.classifier("ETIM")}
                  className="text-gray-400 hover:text-white transition-colors"
                >
                  ETIM Technical Information Model
                </a>
              </li>
              <li>
                <a
                  href={links.classifier("UNSPSC")}
                  className="text-gray-400 hover:text-white transition-colors"
                >
                  United Nations Standard Products and Services Code (UNSPSC)
                </a>
              </li>
              <li>
                <a
                  href={links.classifier("GPC")}
                  className="text-gray-400 hover:text-white transition-colors"
                >
                  GS1 Global Product Classification (GPC)
                </a>
              </li>
              <li>
                <a
                  href={links.classifier("NAICS")}
                  className="text-gray-400 hover:text-white transition-colors"
                >
                  North American Industry Classification System (NAICS)
                </a>
              </li>
              <li>
                <a
                  href={links.classifier("ISIC")}
                  className="text-gray-400 hover:text-white transition-colors"
                >
                  International Standard Industrial Classification of All
                  Economic Activities (ISIC)
                </a>
              </li>
              <li>
                <a
                  href={links.classifier("HS")}
                  className="text-gray-400 hover:text-white transition-colors"
                >
                  Harmonized System (HS)
                </a>
              </li>
              <li>
                <a
                  href={links.classifier("HTS")}
                  className="text-gray-400 hover:text-white transition-colors"
                >
                  Harmonized Tariff Schedule (HTS)
                </a>
              </li>
              <li>
                <a
                  href={links.classifier("CN")}
                  className="text-gray-400 hover:text-white transition-colors"
                >
                  Combined Nomenclature (CN)
                </a>
              </li>
              <li>
                <a
                  href={links.classifier("NACE")}
                  className="text-gray-400 hover:text-white transition-colors"
                >
                  Statistical Classification of Economic Activities in the
                  European Community (NACE)
                </a>
              </li>
              <li>
                <a
                  href={links.classifier("CPV")}
                  className="text-gray-400 hover:text-white transition-colors"
                >
                  Common Procurement Vocabulary (CPV)
                </a>
              </li>
              <li>
                <a
                  href={links.classifier("NSN")}
                  className="text-gray-400 hover:text-white transition-colors"
                >
                  NATO Stock Number or National Stock Number (NSN)
                </a>
              </li>
            </ul>
          </div>
          <div>
            <h2 className="text-lg font-semibold mb-4">Resources</h2>
            <ul className="space-y-2">
              <li>
                <a
                  href={links.mappingIndex}
                  className="text-gray-400 hover:text-white transition-colors"
                >
                  Mapping CSVs
                </a>
              </li>
              <li>
                <a
                  href="https://blog.classifast.com"
                  target="_blank"
                  rel="noopener"
                  className="text-gray-400 hover:text-white transition-colors"
                >
                  Classifast Blog
                </a>
              </li>
              <li>
                <a
                  href="https://github.com/DmitryMatv/classifast"
                  target="_blank"
                  rel="noopener"
                  className="text-gray-400 hover:text-white transition-colors"
                >
                  Code on GitHub
                </a>
              </li>
              <li>
                <a
                  href="https://rapidapi.com/DmitryMatv/api/classifast-api"
                  target="_blank"
                  rel="noopener"
                  className="text-gray-400 hover:text-white transition-colors"
                >
                  API on RapidAPI Hub
                </a>
              </li>
              <li>
                <a
                  href="https://converter.classifast.com"
                  target="_blank"
                  rel="noopener"
                  className="text-gray-400 hover:text-white transition-colors"
                >
                  BMEcat to ETIM xChange
                </a>
              </li>
            </ul>
          </div>
        </div>
        <div className="border-t border-gray-700 mt-8 pt-8 text-center">
          <p className="text-gray-400">
            <a
              href="https://github.com/DmitryMatv"
              className="hover:text-white"
            >
              Dmitry Matv
            </a>
            <br /> {currentYear}
          </p>
        </div>
      </div>
    </footer>
  );
}
