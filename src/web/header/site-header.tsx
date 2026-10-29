// Isomorphic. The `header` island: the children of a page's <header>, which
// hold the mobile menu.
import {
  Fragment,
  useEffect,
  useRef,
  useState,
  type ReactElement,
} from "react";

/** Absolute URLs on the request origin, as the templates' url_for built them. */
export interface HeaderLinks {
  readonly home: string;
  readonly mappingIndex: string;
  /** Classifier page URLs by type, in menu order. */
  readonly classifiers: Readonly<Record<string, string>>;
}

export interface StandardLink {
  readonly name: string;
  readonly url: string;
}

export interface SiteHeaderProps {
  readonly variant: "mapping";
  readonly links: HeaderLinks;
  /** The product page's two standards; null on the mapping index. */
  readonly standards: {
    readonly source: StandardLink;
    readonly target: StandardLink;
  } | null;
}

const NAV_LINK_CLASS =
  "text-gray-600 hover:text-sky-700 hover:underline underline-offset-2 transition-colors";

export function SiteHeader({
  links,
  standards,
}: SiteHeaderProps): ReactElement {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const button = buttonRef.current;
    const menu = menuRef.current;
    if (!open || !button || !menu) return;
    const document = button.ownerDocument;
    const closeOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!menu.contains(target) && !button.contains(target)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      button.focus();
    };
    document.addEventListener("click", closeOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("click", closeOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  const active = open ? " active" : "";
  return (
    <>
      <div className="container mx-auto flex min-h-14 justify-between items-center max-w-6xl px-4">
        <a href={links.home} className="flex items-center">
          <p className="text-xl font-bold text-gray-800 mr-6">
            Classi<span className="text-sky-600">fast</span>
          </p>{" "}
          <span className="text-sm md:text-xl font-medium text-slate-600">
            {standards === null ? (
              "Mapping"
            ) : (
              <>
                {standards.source.name} {"->"} {standards.target.name}
              </>
            )}
          </span>
        </a>{" "}
        {standards !== null && (
          <>
            <nav
              className="desktop-nav ml-auto mr-8"
              role="navigation"
              aria-label="Main navigation"
            >
              <ul className="flex space-x-6 items-center">
                <li>
                  <a href={standards.source.url} className={NAV_LINK_CLASS}>
                    {standards.source.name}
                  </a>
                </li>
                <li>
                  <a href={standards.target.url} className={NAV_LINK_CLASS}>
                    {standards.target.name}
                  </a>
                </li>
              </ul>
            </nav>{" "}
          </>
        )}
        <button
          ref={buttonRef}
          className={`hamburger${active}`}
          id="mobile-menu-button"
          aria-label="Toggle mobile menu"
          aria-expanded={open}
          aria-controls="mobile-menu"
          onClick={() => setOpen((wasOpen) => !wasOpen)}
        >
          <span></span> <span></span> <span></span>
        </button>
      </div>
      {/* Every link in the menu closes it; the click bubbles up to the nav. */}
      <nav
        ref={menuRef}
        className={`mobile-menu${active}`}
        id="mobile-menu"
        aria-label="Mobile navigation"
        onClick={(event) => {
          if ((event.target as Element).closest("a")) setOpen(false);
        }}
      >
        <div className="menu-panel">
          <section>
            <p className="menu-section-title">Current page</p>{" "}
            <a href={links.mappingIndex} className="menu-feature-link">
              {standards === null ? (
                <>
                  <strong>Mapping</strong>{" "}
                  <span>
                    Browse downloadable crosswalks and move between standards
                    quickly.
                  </span>
                </>
              ) : (
                <>
                  <strong>
                    {standards.source.name} to {standards.target.name}
                  </strong>{" "}
                  <span>
                    Stay on this mapping file or jump directly into a classifier
                    from here.
                  </span>
                </>
              )}
            </a>{" "}
            <div className="menu-link-list mt-3">
              <a href={links.home}>Home</a>{" "}
              {standards === null ? (
                <a
                  href="https://blog.classifast.com"
                  target="_blank"
                  rel="noopener"
                >
                  Blog
                </a>
              ) : (
                <a href={links.mappingIndex}>Mappings</a>
              )}
            </div>
          </section>
          <section>
            <p className="menu-section-title">Classifiers</p>
            <div className="menu-chip-grid">
              {Object.entries(links.classifiers).map(([type, url], index) => (
                <Fragment key={type}>
                  {index > 0 && " "}
                  <a href={url} className="menu-chip">
                    {type}
                  </a>
                </Fragment>
              ))}
            </div>
          </section>
        </div>
      </nav>
    </>
  );
}
