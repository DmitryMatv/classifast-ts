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
import { ClassificationService } from "../classifier/classification-service.js";
import {
  CLASSIFIER_TYPES,
  classifierPage,
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
  DEFAULT_TOP_K,
  matchClassifierRoute,
  seedClassifierPageResults,
  starletteUrlPath,
  type SsrState,
} from "./classifier-page-delivery.js";
import { renderPage } from "./render.js";
import { parseQueryString } from "./request-url.js";
import { querySuffix, rawQuery, redirect } from "./responses.js";
import { siteLinks } from "./site-links.js";
import { SITEMAP_QUERY_PATHS } from "./sitemap.js";

const logger = new Logger("ClassifierPage");

function removedClassifier(classifierType: string): HttpException {
  return new HttpException(
    { detail: `Classifier '${classifierType}' is no longer available` },
    410,
  );
}

// Aborts when the client goes away before the response is written.
function disconnectSignal(res: Response): AbortSignal {
  const controller = new AbortController();
  res.on("close", () => {
    if (!res.writableFinished) controller.abort();
  });
  return controller.signal;
}

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

    const resolution = resolveClassifierType(classifierType, CLASSIFIER_TYPES);
    if (resolution.kind === "removed") throw removedClassifier(classifierType);
    if (resolution.kind === "unknown") {
      throw new HttpException(
        { detail: `Classifier '${classifierType}' not found` },
        404,
      );
    }
    const { upperType } = resolution;

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
    // Listen before crawler verification, which can wait on the network.
    const signal = disconnectSignal(res);
    const isVerifiedCrawler = await this.crawlers.isVerified(
      crawlerRequestOf(req),
    );
    if (signal.aborted) return;
    const allowQuerySsr =
      isVerifiedCrawler &&
      shouldSsr(
        decodedQuery,
        params.length > 0,
        canonicalPath,
        this.sitemapQueryPaths,
      );
    const seeded = await seedClassifierPageResults(
      (text) =>
        this.classifier.classify(signal, {
          query: text,
          classifierType: upperType,
          version,
          topK,
        }),
      decodedQuery,
      pyStrip(page.example),
      allowQuerySsr,
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
    );
    res.status(status).set(headers).send(html);
  }
}
