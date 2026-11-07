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
import { buildResultsPageTitle } from "../classifier/classifier-urls.js";
import { GoogleCrawlerVerifier } from "../crawlers/google-crawlers.js";
import { cacheHeaders, type HeaderRecord } from "../http/cache-profiles.js";
import { errorReply, isUnexpectedError } from "../http/error-filter.js";
import { splitRequestTarget } from "../http/middleware.js";
import { unquote } from "../python/urllib.js";
import { Quota } from "../usage/quota.js";
import { starletteUrlPath } from "./classifier-page-delivery.js";
import {
  classifyResultsRequest,
  resultsPageUrl,
  paywallHeaders,
  paywallLimit,
  refuseHead,
  resolveResultsRequest,
  resultsHeaders,
  type ResultsOutcome,
  type ResultsRequest,
  type ResultsServices,
} from "./results-delivery.js";
import { parseQueryString } from "./request-url.js";
import { disconnectSignal, rawQuery } from "./responses.js";
import type { QueryPage, ResultsResponse } from "./results-api.js";
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
 * The classifier page's lookups. It resolves the request and checks quota
 * as Python's fragment route did, answers the paywall with 402 and every
 * failure with an `error` body, and refuses HEAD where GET would classify.
 */
@Controller()
export class ResultsApiController {
  private readonly services: ResultsServices;

  constructor(
    @Inject(SITEMAP_QUERY_PATHS)
    private readonly sitemapQueryPaths: ReadonlySet<string>,
    @Inject(ClassificationService) classifier: ResultsServices["classifier"],
    @Inject(GoogleCrawlerVerifier) crawlers: ResultsServices["crawlers"],
    @Inject(Quota) quota: ResultsServices["quota"],
  ) {
    this.services = { classifier, crawlers, quota };
  }

  @Get("api/results/:classifierType")
  async results(
    @Param("classifierType") classifierType: string,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    let request: ResultsRequest;
    try {
      request = resolveResultsRequest(
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
    const result = await classifyResultsRequest(
      req,
      this.services,
      request,
      signal,
    );
    if (signal.aborted) return;
    // Python's fragment rule for linking a NACE code.
    const stripCodeDots = starletteUrlPath(
      unquote(splitRequestTarget(req.originalUrl).rawPath),
    ).includes("NACE");
    send(res, this.#reply(result, request, stripCodeDots));
  }

  #queryPage(request: ResultsRequest): QueryPage {
    return {
      url: resultsPageUrl(request, this.sitemapQueryPaths),
      title: buildResultsPageTitle(request.upperType, request.description),
    };
  }

  #reply(
    result: ResultsOutcome,
    request: ResultsRequest,
    stripCodeDots: boolean,
  ): Reply {
    const { upperType } = request;
    switch (result.kind) {
      case "results": {
        const { outcome } = result;
        return {
          status: 200,
          headers: resultsHeaders(outcome),
          body: {
            kind: "results",
            version: outcome.versionName,
            query: request.description,
            ...this.#queryPage(request),
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
          headers: paywallHeaders(result.usage),
          body: {
            kind: "paywall",
            signedIn: result.usage.caller.kind !== "anonymous",
            limit: paywallLimit(result.usage),
            ...this.#queryPage(request),
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
