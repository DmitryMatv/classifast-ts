import { basename, dirname, join } from "node:path";
import {
  Controller,
  Get,
  HttpException,
  Inject,
  Param,
  Req,
  Res,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { createElement } from "react";
import {
  getHomepagePopularLookupLinks,
  type PopularLookupLink,
} from "../classifier/popular-lookups.js";
import {
  cacheHeaders,
  pageHeaders,
  sampleDownloadProfile,
} from "../http/cache-profiles.js";
import { requestOrigin, splitRequestTarget } from "../http/middleware.js";
import {
  getMappingProduct,
  getRelatedMappingProducts,
  listMappingProducts,
  type MappingProduct,
} from "../mapping/mapping-store.js";
import { buildMappingCanonicalUrl } from "../mapping/mapping-urls.js";
import { quote } from "../python/urllib.js";
import {
  sendStaticFile,
  STATIC_ROOT,
  statRegularFile,
} from "../static/static-files.js";
import { HomePage } from "./home-page.js";
import { MappingIndexPage } from "./mapping-index-page.js";
import { MappingProductPage } from "./mapping-product-page.js";
import { renderPage } from "./render.js";
import { siteLinks } from "./site-links.js";
import { SITEMAP_QUERY_PATHS } from "./sitemap.js";

const HOME_CANONICAL_URL = "https://classifast.com/";
const REPO_ROOT = dirname(dirname(STATIC_ROOT));

// Starlette's RedirectResponse percent-encodes the URL with these as safe.
const REDIRECT_SAFE = ":/%#?=@[]!$&'()*+,;";

function sendPage(res: Response, canonicalUrl: string, html: string): void {
  res.status(200).set(pageHeaders(canonicalUrl)).send(html);
}

function redirect(res: Response, url: string): void {
  res.status(301).set({
    Location: quote(url, REDIRECT_SAFE),
    "Content-Length": "0",
  });
  res.end();
}

function querySuffix(req: Request): string {
  const { rawQuery } = splitRequestTarget(req.originalUrl);
  return rawQuery ? `?${rawQuery}` : "";
}

function mappingProductOr404(slug: string): MappingProduct {
  const product = getMappingProduct(slug);
  if (product === undefined) {
    throw new HttpException({ detail: "Mapping product not found" }, 404);
  }
  return product;
}

// Starlette's FileResponse Content-Disposition for a download filename.
function attachment(filename: string): string {
  const quoted = quote(filename);
  return quoted === filename
    ? `attachment; filename="${filename}"`
    : `attachment; filename*=utf-8''${quoted}`;
}

// Nest strips a trailing slash from route paths, so each route takes an
// optional one ("{/}") and the handler tells the two forms apart.
@Controller()
export class PagesController {
  private readonly popularLookupLinks: readonly PopularLookupLink[];

  constructor(
    @Inject(SITEMAP_QUERY_PATHS) sitemapQueryPaths: ReadonlySet<string>,
  ) {
    this.popularLookupLinks = getHomepagePopularLookupLinks(sitemapQueryPaths);
  }

  @Get()
  home(@Req() req: Request, @Res() res: Response): void {
    const html = renderPage(
      createElement(HomePage, {
        links: siteLinks(requestOrigin(req)),
        currentYear: new Date().getFullYear(),
        popularLookupLinks: this.popularLookupLinks,
      }),
    );
    sendPage(res, HOME_CANONICAL_URL, html);
  }

  @Get("mappings{/}")
  legacyMappingIndex(@Req() req: Request, @Res() res: Response): void {
    redirect(res, `/mapping/${querySuffix(req)}`);
  }

  @Get("mapping{/}")
  mappingIndex(@Req() req: Request, @Res() res: Response): void {
    if (!req.path.endsWith("/")) {
      redirect(res, `/mapping/${querySuffix(req)}`);
      return;
    }
    const canonicalUrl = buildMappingCanonicalUrl();
    const html = renderPage(
      createElement(MappingIndexPage, {
        links: siteLinks(requestOrigin(req)),
        currentYear: new Date().getFullYear(),
        products: listMappingProducts(),
        canonicalUrl,
      }),
    );
    sendPage(res, canonicalUrl, html);
  }

  @Get("mappings/:slug{/}")
  legacyMappingProduct(
    @Param("slug") slug: string,
    @Req() req: Request,
    @Res() res: Response,
  ): void {
    const product = mappingProductOr404(slug);
    redirect(res, `/mapping/${product.slug}/${querySuffix(req)}`);
  }

  @Get("mapping/:slug{/}")
  mappingProduct(
    @Param("slug") slug: string,
    @Req() req: Request,
    @Res() res: Response,
  ): void {
    const product = mappingProductOr404(slug);
    if (!req.path.endsWith("/")) {
      redirect(res, `/mapping/${product.slug}/${querySuffix(req)}`);
      return;
    }
    const canonicalUrl = buildMappingCanonicalUrl(product.slug);
    const html = renderPage(
      createElement(MappingProductPage, {
        links: siteLinks(requestOrigin(req)),
        currentYear: new Date().getFullYear(),
        product,
        canonicalUrl,
        relatedProducts: getRelatedMappingProducts(product),
      }),
    );
    sendPage(res, canonicalUrl, html);
  }

  @Get("mappings/:slug/sample")
  legacyMappingSample(@Param("slug") slug: string, @Res() res: Response): void {
    const product = mappingProductOr404(slug);
    redirect(res, `/mapping/${product.slug}/sample`);
  }

  @Get("mapping/:slug/sample")
  async mappingSample(
    @Param("slug") slug: string,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const product = mappingProductOr404(slug);
    const file = await statRegularFile(join(REPO_ROOT, product.sampleFilePath));
    if (file === undefined) {
      throw new HttpException({ detail: "Sample file not found" }, 404);
    }
    await sendStaticFile(req, res, file, {
      ...cacheHeaders(sampleDownloadProfile(product.sampleFilePath)),
      Vary: "Accept-Encoding",
      "Content-Disposition": attachment(basename(file.path)),
    });
  }
}
