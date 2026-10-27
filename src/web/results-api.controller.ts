import {
  Controller,
  Get,
  Inject,
  Logger,
  Param,
  Req,
  Res,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { ClassificationService } from "../classifier/classification-service.js";
import { buildFragmentPageTitle } from "../classifier/classifier-urls.js";
import { GoogleCrawlerVerifier } from "../crawlers/google-crawlers.js";
import { cacheHeaders, type HeaderRecord } from "../http/cache-profiles.js";
import { errorReply, isUnexpectedError } from "../http/error-filter.js";
import { splitRequestTarget } from "../http/middleware.js";
import { unquote } from "../python/urllib.js";
import { Quota } from "../usage/quota.js";
import { starletteUrlPath } from "./classifier-page-delivery.js";
import {
  classifyFragmentRequest,
  fragmentPageUrl,
  paywallHeaders,
  refuseHead,
  resolveFragmentRequest,
  resultsFragmentHeaders,
  type FragmentOutcome,
  type FragmentRequest,
  type FragmentServices,
} from "./fragment-delivery.js";
import { paywallLimit } from "./fragments.js";
import { parseQueryString } from "./request-url.js";
import { disconnectSignal, rawQuery } from "./responses.js";
import type { ResultsResponse } from "./results-api.js";
import { toResultsView } from "./results-view.js";
import { SITEMAP_QUERY_PATHS } from "./sitemap.js";

const logger = new Logger("Web");

interface Reply {
  readonly status: number;
  readonly headers: HeaderRecord;
  readonly body: ResultsResponse;
}

function errorMessage(status: number, message: string): Reply {
  return {
    status,
    headers: cacheHeaders("NO_STORE"),
    body: { kind: "error", message },
  };
}

function failure(error: unknown, upperType: string): Reply {
  if (isUnexpectedError(error)) {
    logger.error(
      `Error during '${upperType}' results classification: ${error instanceof Error ? error.message : String(error)}`,
    );
    return errorMessage(500, "Error processing request");
  }
  const { status, body } = errorReply(error);
  // FastAPI's 422 detail lists the invalid parameters.
  return errorMessage(
    status,
    typeof body.detail === "string" ? body.detail : "Invalid query parameters",
  );
}

/**
 * The JSON twin of the result fragment, for the classifier page's client.
 * It classifies, checks quota and refuses HEAD as the fragment does, but
 * answers the paywall with 402 and every failure with an `error` body.
 */
@Controller()
export class ResultsApiController {
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

  @Get("api/results/:classifierType")
  async results(
    @Param("classifierType") classifierType: string,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    let request: FragmentRequest;
    try {
      request = resolveFragmentRequest(
        classifierType,
        parseQueryString(rawQuery(req)),
      );
    } catch (error) {
      send(res, failure(error, classifierType));
      return;
    }
    logger.log(
      `WEB received GET results request for '${request.upperType}' with version '${request.version}'`,
    );
    if (!request.description) {
      send(res, errorMessage(422, "Please enter a query"));
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
    // The fragment's rule, so both link a NACE code the same way.
    const stripCodeDots = starletteUrlPath(
      unquote(splitRequestTarget(req.originalUrl).rawPath),
    ).includes("NACE");
    send(res, this.#reply(result, request, stripCodeDots));
  }

  #reply(
    result: FragmentOutcome,
    request: FragmentRequest,
    stripCodeDots: boolean,
  ): Reply {
    const { upperType, description } = request;
    switch (result.kind) {
      case "results": {
        const { outcome } = result;
        return {
          status: 200,
          headers: resultsFragmentHeaders(undefined, outcome),
          body: {
            kind: "results",
            version: outcome.versionName,
            url: fragmentPageUrl(request, this.sitemapQueryPaths),
            title: buildFragmentPageTitle(upperType, description),
            ...toResultsView(outcome.results, {
              classifierType: upperType,
              version: outcome.version,
              elapsedSeconds: outcome.elapsedSeconds,
              stripCodeDots,
            }),
          },
        };
      }
      case "paywall":
        return {
          status: 402,
          headers: paywallHeaders(result.usage, undefined),
          body: {
            kind: "paywall",
            signedIn: result.usage.caller.kind !== "anonymous",
            limit: paywallLimit(result.usage),
          },
        };
      case "quota-unavailable":
      case "queue-full":
        logger.warn(
          result.kind === "queue-full"
            ? `Classification queue full for '${upperType}' results`
            : `Quota unavailable for '${upperType}' results: ${result.message}`,
        );
        return {
          status: 503,
          headers: cacheHeaders("NO_STORE"),
          body: { kind: "busy", message: result.message },
        };
      case "error":
        return failure(result.error, upperType);
    }
  }
}

function send(res: Response, reply: Reply): void {
  res.status(reply.status).set(reply.headers).json(reply.body);
}
