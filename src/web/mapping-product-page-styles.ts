export const MAPPING_PRODUCT_PAGE_CSS = `
        .container {
            width: 100%;
            margin-left: auto;
            margin-right: auto;
        }

        .mobile-menu {
            display: none;
            position: absolute;
            top: calc(100% + 0.75rem);
            right: 1rem;
            width: min(44rem, calc(100vw - 2rem));
            background: rgba(255, 255, 255, 0.98);
            border: 1px solid #d6dee8;
            box-shadow: 0 18px 40px -28px rgba(15, 23, 42, 0.34);
            border-radius: 0.85rem;
            z-index: 60;
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
            grid-template-columns: minmax(0, 1.15fr) minmax(0, 1.85fr);
            gap: 1rem;
            padding: 1rem;
        }

        .menu-section-title {
            margin: 0 0 0.7rem 0;
            font-size: 0.72rem;
            font-weight: 700;
            letter-spacing: 0.14em;
            text-transform: uppercase;
            color: #64748b;
        }

        .menu-feature-link {
            display: block;
            padding: 0.9rem 1rem;
            border-radius: 0.7rem;
            background: #f8fbfd;
            border: 1px solid #d8e3ee;
            color: #0f172a;
            transition: background-color 0.18s ease, border-color 0.18s ease;
        }

        .menu-feature-link:hover {
            background: #f2f7fb;
            border-color: #bcd0e2;
        }

        .menu-feature-link strong {
            display: block;
            font-size: 1rem;
            margin-bottom: 0.25rem;
        }

        .menu-feature-link span {
            display: block;
            font-size: 1rem;
            color: #475569;
            line-height: 1.45;
        }

        .menu-link-list {
            display: grid;
            gap: 0.4rem;
        }

        .menu-link-list a {
            display: block;
            padding: 0.65rem 0.8rem;
            border-radius: 0.65rem;
            color: #334155;
            transition: background-color 0.18s ease, color 0.18s ease;
        }

        .menu-link-list a:hover {
            background-color: #f8fafc;
            color: #0f5f94;
        }

        .menu-chip-grid {
            display: grid;
            grid-template-columns: repeat(3, minmax(0, 1fr));
            gap: 0.55rem;
        }

        .menu-chip {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            min-height: 2.5rem;
            padding: 0.55rem 0.7rem;
            border-radius: 0.65rem;
            border: 1px solid #d8e3ee;
            background: #fbfdff;
            color: #1e293b;
            font-size: 0.88rem;
            font-weight: 600;
            transition: background-color 0.18s ease, border-color 0.18s ease, color 0.18s ease;
        }

        .menu-chip:hover {
            border-color: #bcd0e2;
            background: #f2f7fb;
            color: #0f5f94;
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

        .mapping-surface {
            background-color: #c6ecff;
            background-image: linear-gradient(180deg, #c6ecff 0%, #ebf8ff 30%, #ffffff 100%);
        }

        .section-label {
            font-size: 0.76rem;
            font-weight: 700;
            letter-spacing: 0.14em;
            text-transform: uppercase;
            color: #46647d;
        }

        .content-panel {
            border: 1px solid #d7e1ea;
            border-radius: 0.85rem;
            background: #ffffff;
            box-shadow: 0 12px 28px -28px rgba(15, 23, 42, 0.38);
        }

        .info-strip {
            display: grid;
            grid-template-columns: minmax(0, 2fr) minmax(0, 1fr);
            gap: 0.9rem;
        }

        .info-strip-item {
            border: 1px solid #dce5ed;
            border-radius: 0.75rem;
            background: #f8fbfd;
            padding: 0.9rem 1rem;
        }

        .info-strip-item-wide {
            grid-column: 1 / -1;
        }

        .aside-box {
            border: 1px solid #d7e1ea;
            border-radius: 0.85rem;
            background: #fdfefe;
            padding: 1.25rem;
            box-shadow: 0 12px 28px -28px rgba(15, 23, 42, 0.38);
        }

        .purchase-box {
            background: linear-gradient(180deg, #fcfeff 0%, #f6fafc 100%);
        }

        .primary-action,
        .secondary-action {
            display: inline-flex;
            width: 100%;
            align-items: center;
            justify-content: center;
            min-height: 2.9rem;
            border-radius: 0.7rem;
            font-weight: 600;
            transition: background-color 0.18s ease, border-color 0.18s ease, color 0.18s ease;
        }

        .primary-action {
            border: 1px solid #1d5d8c;
            background: #215f8e;
            color: #ffffff;
            cursor: pointer;
        }

        .primary-action:hover {
            background: #194e76;
            border-color: #194e76;
        }

        .secondary-action {
            border: 1px solid #c7d7e6;
            background: #ffffff;
            color: #174b74;
        }

        .secondary-action:hover {
            background: #f4f9fd;
            border-color: #a9c2d9;
        }

        .sample-callout {
            display: flex;
            align-items: center;
            gap: 0.9rem;
            border: 1px solid #dce5ed;
            border-radius: 0.75rem;
            background: #ffffff;
            padding: 0.95rem 1rem;
        }

        .sample-callout img {
            width: 3.5rem;
            height: 3.5rem;
            flex-shrink: 0;
            object-fit: contain;
        }

        .faq-item {
            border: 1px solid #dde6ee;
            border-radius: 0.75rem;
            background: #ffffff;
            padding: 1rem 1.05rem;
        }

        .compliance-note {
            border-left: 4px solid #7ea0ba;
            background: #f7fafc;
        }

        .related-link {
            display: block;
            border: 1px solid #dce5ed;
            border-radius: 0.75rem;
            padding: 0.95rem 1rem;
            transition: background-color 0.18s ease, border-color 0.18s ease;
        }

        .related-link:hover {
            background: #f6fafc;
            border-color: #bfd1e2;
        }

        @media (max-width: 1024px) {
            .info-strip {
                grid-template-columns: 1fr;
            }
        }

        @media (max-width: 768px) {
            .desktop-nav {
                display: none;
            }

            .mobile-menu {
                width: 95vw;
                right: 50%;
                transform: translateX(50%);
                border-radius: 0.85rem;
            }

            .menu-panel {
                grid-template-columns: 1fr;
                gap: 1rem;
                padding: 1rem;
            }

            .menu-chip-grid {
                grid-template-columns: repeat(2, minmax(0, 1fr));
            }

            .info-strip {
                grid-template-columns: 1fr;
            }
        }
    `;
