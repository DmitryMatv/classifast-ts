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
import { buildFragmentPageTitle } from "../classifier/classifier-urls.js";
import { GoogleCrawlerVerifier } from "../crawlers/google-crawlers.js";
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
import { unquote } from "../python/urllib.js";
import { Quota } from "../usage/quota.js";
import { starletteUrlPath } from "./classifier-page-delivery.js";
import {
  classifyFragmentRequest,
  fragmentPageUrl,
  paywallHeaders,
  refuseHead,
  resolveFragmentPushUrl,
  resolveFragmentRequest,
  resultsFragmentHeaders,
  type FragmentOutcome,
  type FragmentServices,
} from "./fragment-delivery.js";
import {
  renderPaywall,
  renderResultsFragment,
  renderStatusMessage,
} from "./fragments.js";
import { parseQueryString } from "./request-url.js";
import { disconnectSignal, rawQuery } from "./responses.js";
import { toResultsView } from "./results-view.js";
import { SITEMAP_QUERY_PATHS } from "./sitemap.js";

const logger = new Logger("Web");

// Starlette matches /{classifier_type}/fragment against the decoded path.
const FRAGMENT_PATH = /^\/([^/]+)\/fragment$/s;

/**
 * Python's GET /{classifier_type}/fragment. It registers before
 * ClassifierPageController and hands that controller every other two-segment
 * path. HEAD answers like GET for validation errors and empty descriptions,
 * and 405 where GET would classify; FastAPI routes HEAD to the classifier
 * page instead.
 */
@Controller()
export class FragmentController {
  private readonly services: FragmentServices;

  constructor(
    @Inject(SITEMAP_QUERY_PATHS)
    private readonly sitemapQueryPaths: ReadonlySet<string>,
    @Inject(ClassificationService) classifier: FragmentServices["classifier"],
    @Inject(GoogleCrawlerVerifier) crawlers: FragmentServices["crawlers"],
    @Inject(Quota) quota: FragmentServices["quota"],
  ) {
    this.services = { classifier, crawlers, quota };
  }

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
    const request = resolveFragmentRequest(
      match[1]!,
      parseQueryString(rawQuery(req)),
    );
    const { query, upperType, description } = request;
    logger.log(
      `WEB received GET fragment request for '${upperType}' with version '${request.version}'. Push URL: ${pyBool(query.pushUrl)}`,
    );
    const pushUrl = resolveFragmentPushUrl(query.pushUrl, query.urlChange)
      ? fragmentPageUrl(request, this.sitemapQueryPaths)
      : undefined;

    if (!description) {
      res
        .status(200)
        .set(classificationResultHeaders())
        .send(
          renderResultsFragment(
            { query: "", results: [], loaded: false },
            undefined,
          ),
        );
      return;
    }

    if (req.method === "HEAD") {
      refuseHead(res);
      return;
    }

    // Listen before the crawler, Clerk and quota checks, which can wait on
    // the network.
    const signal = disconnectSignal(res);
    const result = await classifyFragmentRequest(
      req,
      this.services,
      request,
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
            ...toResultsView(outcome.results, {
              classifierType: upperType,
              version: outcome.version,
              elapsedSeconds: outcome.elapsedSeconds,
              stripCodeDots: context.stripCodeDots,
            }),
            query: description,
            loaded: false,
          },
          pushUrl === undefined
            ? undefined
            : buildFragmentPageTitle(upperType, description),
        );
        res
          .status(200)
          .set(resultsFragmentHeaders(pushUrl, outcome))
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
