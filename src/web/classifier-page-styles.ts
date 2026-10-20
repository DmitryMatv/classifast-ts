export const CLASSIFIER_PAGE_CSS = `
        /* Ensure consistent container behavior across all browsers */
        .container {
            width: 100%;
            margin-left: auto;
            margin-right: auto;
        }

        /* Hide scrollbar when modal is active (like other Clerk implementations) */
        body.clerk-modal-open {
            overflow: hidden;
        }

        html.clerk-modal-open {
            scrollbar-width: none;
        }

        .auth-slot {
            display: inline-flex;
            align-items: center;
            justify-content: flex-end;
            width: auto;
            min-width: 0;
            min-height: 2.25rem;
            margin-left: 0.75rem;
            flex: 0 0 auto;
            line-height: 1;
        }

        .auth-slot [id$="-auth-container"] {
            display: flex;
            align-items: center;
            justify-content: flex-end;
            width: auto;
            min-width: 0;
            min-height: 2.25rem;
            line-height: 1;
        }

        .auth-slot[data-auth-slot="mobile"] {
            display: none;
        }

        @media (max-width: 768px) {
            .auth-slot[data-auth-slot="mobile"] {
                display: inline-flex;
                min-width: 2.25rem;
                margin-left: auto;
                margin-right: 0.75rem;
            }
        }

        /* HTMX loading indicator styles */
        #loading-indicator {
            display: none;
            opacity: 0;
            transition: opacity 0.3s ease-out;
        }

        #loading-indicator.htmx-indicator {
            display: flex;
        }

        #loading-indicator.htmx-indicator.htmx-request {
            opacity: 1;
        }

        .score-bar {
            background: linear-gradient(to right, #f9fafb, #e5e7eb);
        }

        .classifier-surface {
            background-color: #c6ecff;
        }

        .js-score-animations [data-score-bar] {
            transform: scaleX(0);
            transform-origin: left center;
            transition: transform 700ms cubic-bezier(0.2, 0.8, 0.2, 1);
            transition-delay: var(--score-animation-delay, 0ms);
            will-change: transform;
        }

        .js-score-animations [data-score-bar].is-score-bar-visible {
            transform: scaleX(1);
        }

        @media (prefers-reduced-motion: reduce) {
            .js-score-animations [data-score-bar] {
                transform: none;
                transition: none;
                will-change: auto;
            }
        }

        /* Mobile menu styles */
        .mobile-menu {
            display: none;
            position: absolute;
            top: calc(100% + 0.75rem);
            right: 1rem;
            width: min(44rem, calc(100vw - 2rem));
            background: rgba(255, 255, 255, 0.98);
            border: 1px solid rgba(226, 232, 240, 0.95);
            box-shadow: 0 24px 60px -24px rgba(15, 23, 42, 0.35);
            border-radius: 1.25rem;
            z-index: 60;
            backdrop-filter: blur(16px);
            overflow: hidden;
        }

        .mobile-menu.active {
            display: block;
        }

        .hamburger {
            display: flex;
            flex-direction: column;
            cursor: pointer;
            padding: 4px;
            background: transparent;
            border: 0;
            appearance: none;
            -webkit-appearance: none;
            position: relative;
            z-index: 70;
            touch-action: manipulation;
        }

        .menu-panel {
            display: grid;
            grid-template-columns: minmax(0, 1.25fr) minmax(0, 1.75fr);
            gap: 1.25rem;
            padding: 1.25rem;
        }

        .menu-section-title {
            margin: 0 0 0.75rem 0;
            font-size: 0.72rem;
            font-weight: 800;
            letter-spacing: 0.22em;
            text-transform: uppercase;
            color: #64748b;
        }

        .menu-feature-link {
            display: block;
            padding: 0.95rem 1rem;
            border-radius: 1rem;
            background: linear-gradient(135deg, #eff6ff 0%, #f8fafc 100%);
            border: 1px solid #dbeafe;
            color: #0f172a;
            transition: transform 0.18s ease, box-shadow 0.18s ease, border-color 0.18s ease;
        }

        .menu-feature-link:hover {
            transform: translateY(-1px);
            box-shadow: 0 12px 28px -20px rgba(14, 116, 144, 0.5);
            border-color: #7dd3fc;
        }

        .menu-feature-link strong {
            display: block;
            font-size: 1rem;
            margin-bottom: 0.25rem;
        }

        .menu-feature-link span {
            display: block;
            font-size: 0.9rem;
            color: #475569;
            line-height: 1.45;
        }

        .menu-link-list {
            display: grid;
            gap: 0.5rem;
        }

        .menu-link-list a {
            display: block;
            padding: 0.72rem 0.85rem;
            border-radius: 0.85rem;
            color: #334155;
            transition: background-color 0.18s ease, color 0.18s ease, transform 0.18s ease;
        }

        .menu-link-list a:hover {
            background-color: #f8fafc;
            color: #0369a1;
            transform: translateX(2px);
        }

        .menu-chip-grid {
            display: grid;
            grid-template-columns: repeat(3, minmax(0, 1fr));
            gap: 0.6rem;
        }

        .menu-chip {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            min-height: 2.75rem;
            padding: 0.65rem 0.8rem;
            border-radius: 999px;
            border: 1px solid #dbeafe;
            background: #f8fbff;
            color: #0f172a;
            font-size: 0.9rem;
            font-weight: 700;
            letter-spacing: 0.02em;
            transition: transform 0.18s ease, border-color 0.18s ease, background-color 0.18s ease;
        }

        .menu-chip:hover {
            transform: translateY(-1px);
            border-color: #7dd3fc;
            background: #eff6ff;
        }

        .hamburger span {
            width: 24px;
            height: 2px;
            background-color: #374151;
            margin: 3px 0;
            transition: 0.3s;
            border-radius: 1px;
        }

        .hamburger.active span:nth-child(1) {
            transform: rotate(-45deg) translate(-5px, 6px);
        }

        .hamburger.active span:nth-child(2) {
            opacity: 0;
        }

        .hamburger.active span:nth-child(3) {
            transform: rotate(45deg) translate(-5px, -6px);
        }

        @media (max-width: 768px) {
            .desktop-nav {
                display: none;
            }

            .mobile-hidden {
                display: none;
            }

            .mobile-menu {
                width: 95vw;
                right: 50%;
                transform: translateX(50%);
                border-radius: 1rem;
            }

            .menu-panel {
                grid-template-columns: 1fr;
                gap: 1rem;
                padding: 1rem;
            }

            .menu-chip-grid {
                grid-template-columns: repeat(2, minmax(0, 1fr));
            }
        }
    `;
