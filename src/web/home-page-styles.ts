export const HOME_PAGE_CSS = `
        /* Ensure consistent container behavior across all browsers */
        .container {
            width: 100%;
            margin-left: auto;
            margin-right: auto;
        }

        :root {
            --ink: #0f172a;
            --body: #475569;
            --muted: #64748b;
            --accent: #0369a1;
            --accent-strong: #075985;
            --rule: #e2e8f0;
            --paper: #ffffff;
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

        /* Mobile menu */
        .mobile-menu {
            display: none;
            position: absolute;
            top: calc(100% + 0.75rem);
            right: 1rem;
            width: min(44rem, calc(100vw - 2rem));
            background: rgba(255, 255, 255, 0.99);
            border: 1px solid var(--rule);
            box-shadow: 0 24px 60px -28px rgba(15, 23, 42, 0.3);
            border-radius: 0.5rem;
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

        .hamburger span {
            width: 24px;
            height: 2px;
            background-color: var(--ink);
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

        .menu-panel {
            display: grid;
            grid-template-columns: minmax(0, 1.25fr) minmax(0, 1.75fr);
            gap: 1.25rem;
            padding: 1.25rem;
        }

        .menu-section-title {
            margin: 0 0 0.75rem 0;
            font-size: 0.78rem;
            font-weight: 600;
            color: var(--muted);
        }

        .menu-feature-link {
            display: block;
            padding: 0.85rem 1rem;
            border: 1px solid var(--rule);
            border-radius: 0.375rem;
            color: var(--ink);
            transition: border-color 0.15s ease, background-color 0.15s ease;
        }

        .menu-feature-link:hover {
            border-color: var(--accent);
            background: #f8fafc;
        }

        .menu-feature-link strong {
            display: block;
            font-size: 0.95rem;
            margin-bottom: 0.2rem;
        }

        .menu-feature-link span {
            display: block;
            font-size: 0.85rem;
            color: var(--body);
            line-height: 1.45;
        }

        .menu-link-list {
            display: grid;
            gap: 0.25rem;
        }

        .menu-link-list a {
            display: block;
            padding: 0.5rem 0.75rem;
            border-radius: 0.25rem;
            color: var(--body);
            transition: background-color 0.15s ease, color 0.15s ease;
        }

        .menu-link-list a:hover {
            background-color: #f8fafc;
            color: var(--accent);
        }

        .menu-chip-grid {
            display: grid;
            grid-template-columns: repeat(3, minmax(0, 1fr));
            gap: 1px;
            background: var(--rule);
            border: 1px solid var(--rule);
            border-radius: 0.375rem;
            overflow: hidden;
        }

        .menu-chip {
            display: flex;
            align-items: center;
            justify-content: center;
            min-height: 2.75rem;
            padding: 0.6rem;
            background: #fff;
            color: var(--ink);
            font-family: 'JetBrains Mono', monospace;
            font-size: 0.85rem;
            font-weight: 700;
            transition: color 0.15s ease, background-color 0.15s ease;
        }

        .menu-chip:hover {
            color: var(--accent);
            background: #f8fafc;
        }

        /* Page surface: single light-blue wash fading to white.
           Deliberately one gradient layer — no grid overlays. */
        body.home-surface {
            background: linear-gradient(180deg, #c6ecff 0%, #ebf8ff 38%, #ffffff 78%);
        }

        .site-masthead {
            position: relative;
            z-index: 2;
            background: var(--paper);
            border-bottom: none;
        }

        /* Hero */
        .hero-section {
            padding: 4.5rem 0 5.5rem;
        }

        .hero-grid {
            display: grid;
            gap: 3rem;
            align-items: center;
        }

        @media (min-width: 992px) {
            .hero-grid {
                grid-template-columns: minmax(0, 1.05fr) minmax(0, 0.95fr);
                gap: 4.5rem;
            }
        }

        .hero-title {
            margin: 0 0 1.25rem;
            color: var(--ink);
            font-weight: 800;
            font-size: clamp(2rem, 3.4vw, 3rem);
            line-height: 1.08;
            letter-spacing: -0.03em;
            max-width: 24ch;
        }

        @media (max-width: 480px) {
            .hero-title br {
                display: none;
            }
        }

        .hero-lede {
            margin: 0 0 2rem;
            color: var(--body);
            font-size: clamp(1.05rem, 1.3vw, 1.2rem);
            line-height: 1.6;
            max-width: 42ch;
        }

        .hero-lede a {
            color: var(--accent);
            font-weight: 500;
            text-decoration: underline;
            text-decoration-thickness: 1px;
            text-underline-offset: 2px;
        }

        .hero-lede a:hover,
        .hero-lede a:focus-visible {
            color: var(--accent-strong);
        }

        .hero-cta-row {
            display: flex;
            flex-wrap: wrap;
            align-items: center;
            gap: 0.9rem;
        }

        .cta-primary {
            display: inline-flex;
            align-items: center;
            padding: 0.7rem 1.1rem;
            border-radius: 0.375rem;
            background: var(--accent);
            color: #fff;
            font-weight: 600;
            font-size: 0.95rem;
            text-decoration: none;
            transition: background-color 0.15s ease;
        }

        .cta-primary:hover,
        .cta-primary:focus-visible {
            background: var(--accent-strong);
        }

        .cta-secondary {
            display: inline-flex;
            align-items: center;
            padding: 0.7rem 1.1rem;
            border: 1px solid var(--rule);
            border-radius: 0.375rem;
            color: var(--ink);
            font-weight: 600;
            font-size: 0.95rem;
            text-decoration: none;
            background: #fff;
            transition: border-color 0.15s ease, color 0.15s ease;
        }

        .cta-secondary:hover,
        .cta-secondary:focus-visible {
            color: var(--accent);
            border-color: var(--accent);
        }

        .hero-note {
            margin-top: 1.5rem;
            color: var(--muted);
            font-size: 0.85rem;
        }

        /* Demo card: shows what a result actually looks like */
        .demo-card {
            background: var(--paper);
            border: 1px solid var(--rule);
            border-radius: 0.5rem;
            max-width: 34rem;
        }

        .demo-head {
            display: flex;
            justify-content: space-between;
            align-items: baseline;
            padding: 0.9rem 1.25rem;
            border-bottom: 1px solid var(--rule);
            font-size: 0.8rem;
            color: var(--muted);
        }

        .demo-head .demo-kind {
            font-family: 'JetBrains Mono', monospace;
            font-weight: 700;
            color: var(--ink);
        }

        .demo-query {
            padding: 1rem 1.25rem;
            border-bottom: 1px solid var(--rule);
        }

        .demo-query-label {
            font-size: 0.75rem;
            color: var(--muted);
            margin-bottom: 0.25rem;
        }

        .demo-query-text {
            font-family: 'JetBrains Mono', monospace;
            font-size: 0.95rem;
            color: var(--ink);
            background: #f8fafc;
            border: 1px solid var(--rule);
            border-radius: 0.375rem;
            padding: 0.55rem 0.75rem;
        }

        .demo-rows {
            list-style: none;
            margin: 0;
            padding: 0;
        }

        .demo-row {
            padding: 0.75rem 1.25rem;
            border-bottom: 1px solid var(--rule);
        }

        .demo-row:last-child {
            border-bottom: none;
        }

        .demo-row-top {
            display: flex;
            align-items: baseline;
            gap: 0.75rem;
        }

        .demo-code {
            font-family: 'JetBrains Mono', monospace;
            font-weight: 700;
            font-size: 1.05rem;
            color: var(--accent-strong);
        }

        .demo-score {
            margin-left: auto;
            font-family: 'JetBrains Mono', monospace;
            font-size: 0.8rem;
            color: var(--muted);
        }

        .demo-name {
            margin-top: 0.15rem;
            color: var(--ink);
            font-size: 0.95rem;
            font-weight: 600;
        }

        .demo-foot {
            padding: 0.9rem 1.25rem;
            background: #f8fafc;
            border-top: 1px solid var(--rule);
            font-size: 0.85rem;
        }

        .demo-foot a {
            color: var(--accent);
            text-decoration: underline;
            text-underline-offset: 2px;
        }

        /* Section scaffold */
        .page-section {
            background: var(--paper);
        }

        .section-title {
            color: var(--ink);
            font-weight: 700;
            font-size: clamp(1.5rem, 2.2vw, 2rem);
            letter-spacing: -0.02em;
            margin: 0 0 0.75rem;
            text-align: left;
        }

        .section-lede {
            color: var(--body);
            max-width: 60ch;
            margin: 0 0 2rem;
        }

        /* Standards index */
        .standards-index {
            padding: 4.5rem 0 5.5rem;
        }

        .standards-list {
            list-style: none;
            margin: 0;
            padding: 0;
            display: grid;
            gap: 0;
            border-top: 1px solid var(--rule);
        }

        @media (min-width: 640px) {
            .standards-list {
                grid-template-columns: 1fr 1fr;
            }
        }

        @media (min-width: 992px) {
            .standards-list {
                grid-template-columns: 1fr 1fr 1fr;
            }
        }

        .standards-list a {
            display: flex;
            flex-direction: column;
            gap: 0.2rem;
            padding: 1rem 0.2rem;
            border-bottom: 1px solid var(--rule);
            text-decoration: none;
        }

        .standards-list abbr {
            font-family: 'JetBrains Mono', monospace;
            font-weight: 700;
            font-size: 1rem;
            color: var(--ink);
        }

        .standards-list .full-name {
            color: var(--muted);
            font-size: 0.85rem;
            line-height: 1.35;
        }

        .standards-list a:hover,
        .standards-list a:focus-visible {
            background: #f8fafc;
        }

        .standards-list a:hover abbr,
        .standards-list a:focus-visible abbr {
            color: var(--accent);
        }

        /* Features */
        .features-section {
            padding: 4.5rem 0;
            border-top: 1px solid var(--rule);
        }

        .feature-grid {
            display: grid;
            gap: 2rem;
        }

        @media (min-width: 768px) {
            .feature-grid {
                grid-template-columns: repeat(2, minmax(0, 1fr));
            }
        }

        @media (min-width: 992px) {
            .feature-grid {
                grid-template-columns: repeat(4, minmax(0, 1fr));
            }
        }

        .feature h3 {
            color: var(--ink);
            font-size: 1.05rem;
            font-weight: 700;
            margin: 0 0 0.4rem;
            text-align: left;
        }

        @media (min-width: 992px) {
            .feature {
                border-left: 1px solid var(--rule);
                padding-left: 1.25rem;
            }

            .feature:first-child {
                border-left: none;
                padding-left: 0;
            }
        }

        .feature p {
            color: var(--body);
            font-size: 0.95rem;
            line-height: 1.55;
            margin: 0;
        }

        .feature p a {
            color: var(--accent);
            text-decoration: underline;
            text-underline-offset: 2px;
        }

        /* Testimonials */
        .testimonials-section {
            padding: 4.5rem 0 5rem;
            border-top: 1px solid var(--rule);
        }

        .testimonial-grid {
            display: grid;
            gap: 2.5rem;
        }

        @media (min-width: 768px) {
            .testimonial-grid {
                grid-template-columns: repeat(2, minmax(0, 1fr));
            }
        }

        @media (min-width: 992px) {
            .testimonial-grid {
                grid-template-columns: repeat(3, minmax(0, 1fr));
            }
        }

        .testimonial-quote {
            position: relative;
            margin: 0;
            padding-top: 1rem;
            border-top: 2px solid var(--ink);
        }

        .testimonial-quote p {
            color: var(--body);
            font-size: 0.95rem;
            line-height: 1.6;
        }

        /* Popular lookups */
        .popular-section {
            padding: 4.5rem 0 5.5rem;
            border-top: 1px solid var(--rule);
        }

        .popular-grid {
            list-style: none;
            margin: 0;
            padding: 0;
            display: grid;
            gap: 0.9rem;
            border-top: 1px solid var(--rule);
            padding-top: 1.25rem;
        }

        @media (min-width: 640px) {
            .popular-grid {
                grid-template-columns: 1fr 1fr;
                column-gap: 2rem;
            }
        }

        @media (min-width: 992px) {
            .popular-grid {
                grid-template-columns: repeat(4, 1fr);
                column-gap: 2rem;
            }
        }

        .popular-grid a {
            color: var(--body);
            font-size: 0.9rem;
            text-decoration: none;
        }

        .popular-grid a:hover,
        .popular-grid a:focus-visible {
            color: var(--accent);
            text-decoration: underline;
            text-underline-offset: 2px;
        }

        .popular-grid .classifier-mark {
            font-family: 'JetBrains Mono', monospace;
            font-weight: 700;
            color: var(--ink);
        }

        @media (max-width: 768px) {
            .desktop-nav {
                display: none;
            }

            .mobile-menu {
                width: 95vw;
                right: 50%;
                transform: translateX(50%);
            }

            .menu-panel {
                grid-template-columns: 1fr;
                gap: 1rem;
                padding: 1rem;
            }

            .menu-chip-grid {
                grid-template-columns: repeat(2, minmax(0, 1fr));
            }

            .hero-section {
                padding: 2.75rem 0 4rem;
            }

            .standards-index,
            .features-section,
            .testimonials-section,
            .popular-section {
                padding-top: 3rem;
                padding-bottom: 3.5rem;
            }
        }

        @media (prefers-reduced-motion: reduce) {

            .cta-primary,
            .cta-secondary,
            .standards-list a,
            .menu-feature-link,
            .menu-chip,
            .menu-link-list a,
            .hero-lede a,
            .popular-grid a {
                transition: none;
            }
        }
    `;
