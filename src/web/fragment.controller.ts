import {
  Controller,
  Get,
  Inject,
  Logger,
  Next,
  Req,
  Res,
} from "@nestjs/common";
import type { NextFunction, Request, Response } from "express";
import { ClassificationService } from "../classifier/classification-service.js";
import { classifierPage } from "../classifier/classifier-config.js";
import { resolveClassifierOptions } from "../classifier/classifier-options.js";
import {
  buildFragmentPageTitle,
  buildFragmentPushUrl,
} from "../classifier/classifier-urls.js";
import {
  crawlerRequestOf,
  GoogleCrawlerVerifier,
} from "../crawlers/google-crawlers.js";
import {
  cacheHeaders,
  classificationResultHeaders,
} from "../http/cache-profiles.js";
import {
  errorReply,
  isUnexpectedError,
  sendJson,
} from "../http/error-filter.js";
import { splitRequestTarget } from "../http/middleware.js";
import { collapseWhitespace } from "../python/str.js";
import { unquote } from "../python/urllib.js";
import { Quota } from "../usage/quota.js";
import { callerCredentialsOf } from "./caller-credentials.js";
import {
  classifierTypeOr404,
  DEFAULT_TOP_K,
  starletteUrlPath,
} from "./classifier-page-delivery.js";
import {
  classifyFragment,
  parseFragmentQuery,
  paywallHeaders,
  resolveFragmentPushUrl,
  resultsFragmentHeaders,
  type FragmentOutcome,
} from "./fragment-delivery.js";
import {
  renderPaywall,
  renderResultsFragment,
  renderStatusMessage,
} from "./fragments.js";
import { parseQueryString } from "./request-url.js";
import { disconnectSignal, rawQuery } from "./responses.js";
import { SITEMAP_QUERY_PATHS } from "./sitemap.js";

const logger = new Logger("Web");

// Starlette matches /{classifier_type}/fragment against the decoded path.
const FRAGMENT_PATH = /^\/([^/]+)\/fragment$/s;

/**
 * Python's GET /{classifier_type}/fragment. It registers before
 * ClassifierPageController and hands that controller every other two-segment
 * path. HEAD answers like GET, a decided divergence from FastAPI, which
 * routes HEAD to the classifier page.
 */
@Controller()
export class FragmentController {
  constructor(
    @Inject(SITEMAP_QUERY_PATHS)
    private readonly sitemapQueryPaths: ReadonlySet<string>,
    @Inject(ClassificationService)
    private readonly classifier: Pick<ClassificationService, "classify">,
    @Inject(GoogleCrawlerVerifier)
    private readonly crawlers: Pick<GoogleCrawlerVerifier, "isVerified">,
    @Inject(Quota)
    private readonly quota: Pick<Quota, "resolveCaller" | "check" | "charge">,
  ) {}

  @Get(":classifierType/:leaf")
  async fragment(
    @Req() req: Request,
    @Res() res: Response,
    @Next() next: NextFunction,
  ): Promise<void> {
    const decodedPath = unquote(splitRequestTarget(req.originalUrl).rawPath);
    const match = FRAGMENT_PATH.exec(decodedPath);
    if (match === null) {
      next();
      return;
    }
    // FastAPI validates query parameters before the handler runs.
    const query = parseFragmentQuery(parseQueryString(rawQuery(req)));
    const description = collapseWhitespace(query.productDescription);
    const enhance = query.enhanceQuery === "1";
    const upperType = classifierTypeOr404(match[1]!);
    const { version, topK, firstVersion } = resolveClassifierOptions(
      classifierPage(upperType).versions,
      query.version,
      query.topK,
      DEFAULT_TOP_K,
      { allowInvalidVersion: true },
    );
    logger.log(
      `WEB received GET fragment request for '${upperType}' with version '${version}'. Push URL: ${pyBool(query.pushUrl)}`,
    );
    const pushUrl = resolveFragmentPushUrl(query.pushUrl, query.urlChange)
      ? buildFragmentPushUrl(
          upperType,
          description,
          {
            version,
            defaultVersion: firstVersion,
            topK,
            defaultTopK: DEFAULT_TOP_K,
            enhanceQuery: enhance,
          },
          this.sitemapQueryPaths,
        )
      : undefined;

    if (!description) {
      res
        .status(200)
        .set(classificationResultHeaders())
        .send(
          renderResultsFragment(
            {
              query: "",
              results: [],
              classifierType: upperType,
              loaded: false,
              stripCodeDots: false,
            },
            undefined,
          ),
        );
      return;
    }

    // Listen before the crawler, Clerk and quota checks, which can wait on
    // the network.
    const signal = disconnectSignal(res);
    const result = await classifyFragment(
      {
        isVerifiedCrawler: () =>
          this.crawlers.isVerified(crawlerRequestOf(req)),
        resolveCaller: () => this.quota.resolveCaller(callerCredentialsOf(req)),
        quota: this.quota,
        classify: (...args) => this.classifier.classify(...args),
      },
      { query: description, classifierType: upperType, version, topK, enhance },
      signal,
    );
    if (signal.aborted) return;
    this.#send(res, result, {
      upperType,
      description,
      pushUrl,
      stripCodeDots: starletteUrlPath(decodedPath).includes("NACE"),
    });
  }

  #send(
    res: Response,
    result: FragmentOutcome,
    context: {
      readonly upperType: string;
      readonly description: string;
      readonly pushUrl: string | undefined;
      readonly stripCodeDots: boolean;
    },
  ): void {
    const { upperType, description, pushUrl } = context;
    switch (result.kind) {
      case "results": {
        const { outcome } = result;
        // results.html says "Loading..." for an empty list: the fragment
        // context never sets results_loaded.
        const html = renderResultsFragment(
          {
            query: description,
            results: outcome.results,
            classifierType: upperType,
            version: outcome.version,
            elapsedSeconds: outcome.elapsedSeconds,
            loaded: false,
            stripCodeDots: context.stripCodeDots,
          },
          pushUrl === undefined
            ? undefined
            : buildFragmentPageTitle(upperType, description),
        );
        res
          .status(200)
          .set(
            resultsFragmentHeaders(
              pushUrl,
              outcome.enhancementStatus === "failed",
            ),
          )
          .send(html);
        return;
      }
      case "paywall":
        res
          .status(200)
          .set(paywallHeaders(result.usage, pushUrl))
          .send(renderPaywall(result.usage));
        return;
      case "quota-unavailable":
      case "queue-full":
        logger.warn(
          result.kind === "queue-full"
            ? `Classification queue full for '${upperType}' fragment`
            : `Quota unavailable for '${upperType}' fragment: ${result.message}`,
        );
        res
          .status(503)
          .set(cacheHeaders("NO_STORE"))
          .send(renderStatusMessage(result.message));
        return;
      case "error": {
        const { error } = result;
        if (isUnexpectedError(error)) {
          logger.error(
            `Error during '${upperType}' fragment classification: ${error instanceof Error ? error.message : String(error)}`,
          );
          sendJson(res, {
            status: 500,
            body: { detail: "Error processing request" },
            headers: cacheHeaders("NO_STORE"),
          });
          return;
        }
        sendJson(res, {
          ...errorReply(error),
          headers: cacheHeaders("NO_STORE"),
        });
        return;
      }
    }
  }
}

function pyBool(value: boolean | undefined): string {
  if (value === undefined) return "None";
  return value ? "True" : "False";
}
