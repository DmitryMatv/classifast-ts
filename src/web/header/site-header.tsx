// Isomorphic. The `header` island: the children of a page's <header>, which
// hold the mobile menu and, on pages that show auth, the Clerk slots.
import {
  Fragment,
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactElement,
} from "react";
import {
  accountsUrl,
  useAuth,
  useServices,
  type AuthSnapshot,
} from "../islands/services.js";

/** Absolute URLs on the request origin, as the templates' url_for built them. */
export interface HeaderLinks {
  readonly home: string;
  readonly mappingIndex: string;
  /** Classifier page URLs by menu chip label, in menu order. */
  readonly classifiers: Readonly<Record<string, string>>;
}

export interface StandardLink {
  readonly name: string;
  readonly url: string;
}

/** Each variant keeps its page family's header markup. */
export type SiteHeaderProps =
  | {
      readonly variant: "mapping";
      readonly links: HeaderLinks;
      /** The product page's two standards; null on the mapping index. */
      readonly standards: {
        readonly source: StandardLink;
        readonly target: StandardLink;
      } | null;
    }
  | { readonly variant: "home"; readonly links: HeaderLinks }
  | {
      readonly variant: "classifier";
      readonly links: HeaderLinks;
      /** The page's own classifier. */
      readonly classifier: StandardLink;
    };

type MappingHeaderProps = Extract<SiteHeaderProps, { variant: "mapping" }>;
type HomeHeaderProps = Extract<SiteHeaderProps, { variant: "home" }>;
type ClassifierHeaderProps = Extract<
  SiteHeaderProps,
  { variant: "classifier" }
>;

const NAV_LINK_CLASS =
  "text-gray-600 hover:text-sky-700 hover:underline underline-offset-2 transition-colors";
const BLOG_URL = "https://blog.classifast.com";
const API_URL = "https://rapidapi.com/DmitryMatv/api/classifast-api";
const AUTH_BUTTON_CLASS =
  "inline-flex shrink-0 items-center justify-center whitespace-nowrap rounded transition-all duration-150 ease-in-out transform cursor-pointer active:scale-95 h-9 px-4 leading-none";
const SIGN_IN_CLASS = `${AUTH_BUTTON_CLASS} bg-sky-50 text-sky-700 hover:bg-sky-100 active:bg-sky-100`;
const SIGN_UP_CLASS = `${AUTH_BUTTON_CLASS} bg-sky-700 hover:bg-sky-800 active:bg-sky-900 text-white ml-2`;

export function SiteHeader(props: SiteHeaderProps): ReactElement {
  switch (props.variant) {
    case "home":
      return <HomeHeader {...props} />;
    case "classifier":
      return <ClassifierHeader {...props} />;
    case "mapping":
      return <MappingHeader {...props} />;
  }
}

/** Starts Clerk, and offers One Tap to a signed-out visitor. */
function useAuthSlots(): AuthSnapshot {
  const { auth } = useServices();
  const snapshot = useAuth();
  useEffect(() => {
    auth.start();
  }, [auth]);
  useEffect(() => {
    if (snapshot.status === "signed-out") auth.openGoogleOneTap();
  }, [auth, snapshot.status]);
  return snapshot;
}

/**
 * The hamburger toggles the menu. A link click, an outside click and Escape
 * close it, and Escape returns focus to the button.
 */
function useMobileMenu() {
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
  return {
    button: {
      ref: buttonRef,
      className: `hamburger${active}`,
      id: "mobile-menu-button",
      "aria-label": "Toggle mobile menu",
      "aria-expanded": open,
      "aria-controls": "mobile-menu",
      onClick: () => setOpen((wasOpen) => !wasOpen),
    },
    menu: {
      ref: menuRef,
      className: `mobile-menu${active}`,
      id: "mobile-menu",
      // Every link in the menu closes it; the click bubbles up to the nav.
      onClick: (event: ReactMouseEvent) => {
        if ((event.target as Element).closest("a")) setOpen(false);
      },
    },
  };
}

function ClassifierChips({ links }: { readonly links: HeaderLinks }) {
  return (
    <div className="menu-chip-grid">
      {Object.entries(links.classifiers).map(([label, url], index) => (
        <Fragment key={label}>
          {index > 0 && " "}
          <a href={url} className="menu-chip">
            {label}
          </a>
        </Fragment>
      ))}
    </div>
  );
}

function HomeHeader({ links }: HomeHeaderProps): ReactElement {
  const menu = useMobileMenu();
  const snapshot = useAuthSlots();

  return (
    <>
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
                className={NAV_LINK_CLASS}
                role="link"
                aria-label="Mapping Files"
              >
                Mapping
              </a>
            </li>
            <li>
              <a
                href={BLOG_URL}
                target="_blank"
                rel="noopener"
                className={NAV_LINK_CLASS}
                role="link"
                aria-label="Blog"
              >
                Blog
              </a>
            </li>
            <li className="hidden md:block">
              <a
                href={API_URL}
                target="_blank"
                rel="noopener"
                className={NAV_LINK_CLASS}
                role="link"
                aria-label="API Documentation"
              >
                API
              </a>
            </li>
            <li className="auth-slot" data-auth-slot="desktop">
              <AuthControls slot="desktop" snapshot={snapshot} />
            </li>
          </ul>
        </nav>
        <div className="auth-slot" data-auth-slot="mobile">
          <AuthControls slot="mobile" snapshot={snapshot} />
        </div>{" "}
        <button {...menu.button} role="button">
          <span></span> <span></span> <span></span>
        </button>
      </div>
      <nav {...menu.menu} role="navigation" aria-label="Mobile navigation">
        <div className="menu-panel">
          <section>
            <p className="menu-section-title">Explore</p>{" "}
            <a href={links.mappingIndex} className="menu-feature-link">
              <strong>Mapping Files</strong>{" "}
              <span>
                Open crosswalk files and jump between classification systems.
              </span>
            </a>{" "}
            <div className="menu-link-list mt-3">
              <a href={BLOG_URL} target="_blank" rel="noopener">
                Blog
              </a>{" "}
              <a href={API_URL} target="_blank" rel="noopener">
                API
              </a>
            </div>
          </section>
          <section>
            <p className="menu-section-title">Classifiers</p>
            <ClassifierChips links={links} />
          </section>
        </div>
      </nav>
      <div id="google-one-tap" className="absolute top-20 right-4 z-50"></div>
    </>
  );
}

function ClassifierHeader({
  links,
  classifier,
}: ClassifierHeaderProps): ReactElement {
  const menu = useMobileMenu();
  const snapshot = useAuthSlots();
  return (
    <>
      <div className="container mx-auto flex min-h-14 justify-between items-center max-w-6xl px-4">
        <a href={links.home} className="flex items-center">
          <p className="text-xl font-bold text-gray-800 mr-6">
            Classi<span className="text-sky-600">fast</span>
          </p>
        </a>{" "}
        <h1 className="text-sm md:text-xl font-medium text-slate-600 mobile-hidden">
          <a
            href={classifier.url}
            className="hover:text-sky-700 hover:underline underline-offset-2 transition-colors"
            aria-label={`${classifier.name} classification page`}
          >
            {classifier.name}
          </a>
        </h1>
        <nav
          className="desktop-nav ml-auto mr-8"
          role="navigation"
          aria-label="Main navigation"
        >
          <ul className="flex space-x-6 items-center">
            <li>
              <a
                href={links.home}
                className={NAV_LINK_CLASS}
                role="link"
                aria-label="Home"
              >
                Home
              </a>
            </li>
            <li>
              <a
                href={links.mappingIndex}
                className={NAV_LINK_CLASS}
                role="link"
                aria-label="Mapping Files"
              >
                Mapping
              </a>
            </li>
            <li>
              <a
                href={API_URL}
                target="_blank"
                rel="noopener"
                className={NAV_LINK_CLASS}
                role="link"
                aria-label="API Documentation"
              >
                API
              </a>
            </li>
            <li className="auth-slot" data-auth-slot="desktop">
              <AuthControls slot="desktop" snapshot={snapshot} />
            </li>
          </ul>
        </nav>
        <div className="auth-slot" data-auth-slot="mobile">
          <AuthControls slot="mobile" snapshot={snapshot} />
        </div>{" "}
        <button {...menu.button}>
          <span></span> <span></span> <span></span>
        </button>
      </div>
      <nav {...menu.menu} aria-label="Mobile navigation">
        <div className="menu-panel">
          <section>
            <p className="menu-section-title">Current page</p>{" "}
            <a href={classifier.url} className="menu-feature-link">
              <strong>{classifier.name}</strong>{" "}
              <span>
                Stay on this classifier or jump into mappings and other
                standards.
              </span>
            </a>{" "}
            <div className="menu-link-list mt-3">
              <a href={links.home}>Home</a>{" "}
              <a href={links.mappingIndex}>Mapping</a>
            </div>
          </section>
          <section>
            <p className="menu-section-title">All classifiers</p>
            <ClassifierChips links={links} />
          </section>
        </div>
      </nav>
      <div id="google-one-tap" className="absolute top-20 right-4 z-50"></div>
    </>
  );
}

/**
 * One header slot. The mobile bar fits one control between the logo and the
 * menu button, so it has no Sign Up; Clerk's sign-in modal links to it.
 */
function AuthControls({
  slot,
  snapshot,
}: {
  readonly slot: "desktop" | "mobile";
  readonly snapshot: AuthSnapshot;
}): ReactElement {
  const { auth, runtime } = useServices();
  const withSignUp = slot === "desktop";
  return (
    <div id={`${slot}-auth-container`}>
      {snapshot.status === "signed-in" && <ClerkUserButton slot={slot} />}
      {snapshot.status === "signed-out" && (
        <>
          <button
            type="button"
            id={`clerk-sign-in-button-${slot}`}
            className={SIGN_IN_CLASS}
            onClick={() => auth.openSignIn("plain")}
          >
            Sign In
          </button>
          {withSignUp && (
            <button
              type="button"
              id={`clerk-sign-up-button-${slot}`}
              className={SIGN_UP_CLASS}
              onClick={() => auth.openSignUp()}
            >
              Sign Up
            </button>
          )}
        </>
      )}
      {/* Never rendered during hydration, so reading the URL here is safe. */}
      {snapshot.status === "unavailable" && (
        <>
          <a
            href={accountsUrl("sign-in", runtime.href())}
            className={SIGN_IN_CLASS}
            onClick={(event) => {
              // A plain click leaves through openSignIn, which drops a
              // pending Upgrade first; a new-tab click keeps the page and it.
              const modified =
                event.metaKey ||
                event.ctrlKey ||
                event.shiftKey ||
                event.altKey;
              if (event.button !== 0 || modified) return;
              event.preventDefault();
              auth.openSignIn("plain");
            }}
          >
            Sign In
          </a>
          {withSignUp && (
            <a
              href={accountsUrl("sign-up", runtime.href())}
              className={SIGN_UP_CLASS}
            >
              Sign Up
            </a>
          )}
        </>
      )}
    </div>
  );
}

/** React renders the element empty and never touches what Clerk mounts in it. */
function ClerkUserButton({
  slot,
}: {
  readonly slot: "desktop" | "mobile";
}): ReactElement {
  const { auth } = useServices();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => auth.mountUserButton(ref.current!), [auth]);
  return (
    <div
      ref={ref}
      id={`clerk-user-button-${slot}`}
      className="flex h-9 w-9 shrink-0 items-center justify-center leading-none"
    />
  );
}

function MappingHeader({ links, standards }: MappingHeaderProps): ReactElement {
  const menu = useMobileMenu();
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
        <button {...menu.button}>
          <span></span> <span></span> <span></span>
        </button>
      </div>
      <nav {...menu.menu} aria-label="Mobile navigation">
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
                <a href={BLOG_URL} target="_blank" rel="noopener">
                  Blog
                </a>
              ) : (
                <a href={links.mappingIndex}>Mappings</a>
              )}
            </div>
          </section>
          <section>
            <p className="menu-section-title">Classifiers</p>
            <ClassifierChips links={links} />
          </section>
        </div>
      </nav>
    </>
  );
}
