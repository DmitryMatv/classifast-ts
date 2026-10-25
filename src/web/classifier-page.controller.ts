import {
  Controller,
  Get,
  HttpException,
  Inject,
  Logger,
  NotFoundException,
  Req,
  Res,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { createElement } from "react";
import {
  ClassificationService,
  type ClassificationRequest,
} from "../classifier/classification-service.js";
import {
  CLASSIFIER_TYPES,
  classifierPage,
  classifierVersion,
} from "../classifier/classifier-config.js";
import {
  resolveClassifierOptions,
  resolveClassifierType,
} from "../classifier/classifier-options.js";
import {
  buildClassifierCanonicalPath,
  buildClassifierRedirectUrl,
  CANONICAL_ORIGIN,
  decodeSearchQuery,
  shouldSsr,
} from "../classifier/classifier-urls.js";
import { getPopularLookupLinks } from "../classifier/popular-lookups.js";
import { SitemapResultCache } from "../classifier/sitemap-result-cache.js";
import {
  crawlerRequestOf,
  GoogleCrawlerVerifier,
} from "../crawlers/google-crawlers.js";
import { requestOrigin, splitRequestTarget } from "../http/middleware.js";
import { lastQueryValue, optionalIntQuery } from "../http/query-params.js";
import { pyRstrip, pyStrip } from "../python/str.js";
import { unquote } from "../python/urllib.js";
import { ClassifierPage } from "./classifier-page.js";
import {
  classifierPageResponse,
  classifierTypeOr404,
  DEFAULT_TOP_K,
  matchClassifierRoute,
  removedClassifier,
  seedClassifierPageResults,
  SITEMAP_RESULTS_CACHE_TAG,
  starletteUrlPath,
  type PageClassification,
  type SsrState,
} from "./classifier-page-delivery.js";
import { renderPage } from "./render.js";
import { parseQueryString } from "./request-url.js";
import {
  disconnectSignal,
  querySuffix,
  rawQuery,
  redirect,
} from "./responses.js";
import { siteLinks } from "./site-links.js";
import { SITEMAP_QUERY_PATHS } from "./sitemap.js";

const logger = new Logger("ClassifierPage");

type PageRequest = ClassificationRequest & { readonly version: string };

/**
 * Python's /{classifier_type} routes. Express gets every one-or-more segment
 * path here, so this controller must register after every other route.
 */
@Controller()
export class ClassifierPageController {
  constructor(
    @Inject(SITEMAP_QUERY_PATHS)
    private readonly sitemapQueryPaths: ReadonlySet<string>,
    @Inject(ClassificationService)
    private readonly classifier: Pick<ClassificationService, "classify">,
    @Inject(GoogleCrawlerVerifier)
    private readonly crawlers: Pick<GoogleCrawlerVerifier, "isVerified">,
    @Inject(SitemapResultCache)
    private readonly sitemapResults: Pick<SitemapResultCache, "get">,
  ) {}

  @Get([":classifierType{/}", ":classifierType/*searchQuery"])
  async classifierPage(
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const decodedPath = unquote(splitRequestTarget(req.originalUrl).rawPath);
    const route = matchClassifierRoute(decodedPath);
    if (route === undefined) throw new NotFoundException();
    if (route.kind === "no-slash") {
      this.redirectNoSlash(route.classifierType, req, res);
      return;
    }
    await this.showPage(route.classifierType, route.searchQuery, req, res);
  }

  private redirectNoSlash(
    classifierType: string,
    req: Request,
    res: Response,
  ): void {
    const resolution = resolveClassifierType(classifierType, CLASSIFIER_TYPES);
    if (resolution.kind === "removed") throw removedClassifier(classifierType);
    if (resolution.kind === "unknown") {
      throw new HttpException(
        { detail: `Type '${classifierType}' not found` },
        404,
      );
    }
    redirect(res, `/${resolution.upperType}/${querySuffix(req)}`);
  }

  private async showPage(
    classifierType: string,
    searchQuery: string,
    req: Request,
    res: Response,
  ): Promise<void> {
    const query = rawQuery(req);
    const params = parseQueryString(query);
    // FastAPI validates query parameters before the handler runs.
    const requestedTopK = optionalIntQuery(params, "top_k");

    const upperType = classifierTypeOr404(classifierType);

    const normalizedSearchQuery = pyRstrip(searchQuery, "/");
    const canonicalSearchQuery = normalizedSearchQuery
      ? `${normalizedSearchQuery}/`
      : "";
    const decodedQuery = decodeSearchQuery(searchQuery);
    const canonicalPath = buildClassifierCanonicalPath(
      upperType,
      decodedQuery,
      this.sitemapQueryPaths,
    );
    const urlPath = starletteUrlPath(
      unquote(splitRequestTarget(req.originalUrl).rawPath),
    );
    if (
      classifierType !== upperType ||
      searchQuery !== canonicalSearchQuery ||
      urlPath !== unquote(canonicalPath)
    ) {
      redirect(
        res,
        buildClassifierRedirectUrl(
          upperType,
          searchQuery,
          query,
          this.sitemapQueryPaths,
        ),
      );
      return;
    }

    const canonicalUrl = CANONICAL_ORIGIN + canonicalPath;
    if (req.method === "HEAD") {
      res
        .status(200)
        .set(
          classifierPageResponse("not_attempted", false, canonicalUrl).headers,
        )
        .end();
      return;
    }

    const page = classifierPage(upperType);
    const { version, topK, firstVersion } = resolveClassifierOptions(
      page.versions,
      lastQueryValue(params, "version"),
      requestedTopK,
      DEFAULT_TOP_K,
    );
    const signal = disconnectSignal(res);
    const sitemapQuery = shouldSsr(
      decodedQuery,
      params.length > 0,
      canonicalPath,
      this.sitemapQueryPaths,
    );
    const request = (text: string): PageRequest => ({
      query: text,
      classifierType: upperType,
      version,
      topK,
    });
    const seeded = await seedClassifierPageResults(
      sitemapQuery
        ? (text) => this.#sitemapResults(signal, request(text))
        : (text) => this.classifier.classify(signal, request(text)),
      decodedQuery,
      pyStrip(page.example),
      sitemapQuery,
      (state: SsrState, error: unknown) => {
        if (state === "overloaded") {
          logger.warn(
            `SSR deferred for '${upperType}' page: classification queue full`,
          );
        } else {
          const name = error instanceof Error ? error.name : typeof error;
          logger.warn(
            `SSR fallback for '${upperType}' page classification due to ${name}: ${String(error instanceof Error ? error.message : error)}`,
          );
        }
      },
    );
    if (signal.aborted) return;
    // Only a full queue answers a verified crawler differently.
    const isVerifiedCrawler =
      seeded.state === "overloaded" &&
      (await this.crawlers.isVerified(crawlerRequestOf(req)));
    if (signal.aborted) return;

    const html = renderPage(
      createElement(ClassifierPage, {
        links: siteLinks(requestOrigin(req)),
        currentYear: new Date().getFullYear(),
        classifierType: upperType,
        page,
        search: decodedQuery,
        version: version !== firstVersion ? version : "",
        firstVersion,
        topK,
        defaultTopK: DEFAULT_TOP_K,
        canonicalUrl,
        results: seeded.results,
        defaultExamplePrefill: seeded.defaultExamplePrefill,
        triggerSearchOnLoad: seeded.triggerSearchOnLoad,
        enhanceQuery: lastQueryValue(params, "enhance_query") === "1",
        popularLookupLinks: getPopularLookupLinks(
          upperType,
          this.sitemapQueryPaths,
        ),
        stripCodeDots: urlPath.includes("NACE"),
      }),
    );
    const { status, headers } = classifierPageResponse(
      seeded.state,
      isVerifiedCrawler,
      canonicalUrl,
      sitemapQuery ? SITEMAP_RESULTS_CACHE_TAG : undefined,
    );
    res.status(status).set(headers).send(html);
  }

  /**
   * A sitemap query page renders the same results for every visitor, from
   * the result cache, and charges no quota.
   */
  async #sitemapResults(
    signal: AbortSignal,
    request: PageRequest,
  ): Promise<PageClassification> {
    const version = classifierVersion(request.classifierType, request.version);
    const { result, complete } = await this.sitemapResults.get(
      {
        collectionName: version.collectionName,
        topK: request.topK,
        query: request.query,
      },
      signal,
      (fillSignal) => this.classifier.classify(fillSignal, request),
    );
    return {
      results: result.results,
      version,
      elapsedSeconds: result.elapsedSeconds,
      complete,
    };
  }
}
