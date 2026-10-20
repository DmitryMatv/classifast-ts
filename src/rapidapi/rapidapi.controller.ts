import {
  Controller,
  Get,
  HttpException,
  Inject,
  Logger,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import type { QdrantClient } from "@qdrant/js-client-rest";
import type { Request, Response } from "express";
import { ClassificationError } from "../classifier/classification.js";
import { ClassificationQueueFull } from "../classifier/classification-queue.js";
import { ClassificationService } from "../classifier/classification-service.js";
import { EMBEDDING_CLIENT } from "../classifier/classification.module.js";
import {
  classifierConfigFor,
  type ClassifierConfigMap,
} from "../classifier/classifier-config.js";
import { APP_CONFIG, type AppConfig } from "../config/app-config.js";
import { probeSucceeds } from "../health/health.js";
import {
  cacheHeaders,
  classificationResultHeaders,
} from "../http/cache-profiles.js";
import { sendJson } from "../http/error-filter.js";
import { splitRequestTarget } from "../http/middleware.js";
import { QDRANT_CLIENT } from "../qdrant/qdrant.module.js";
import { parseQueryString } from "../web/request-url.js";
import { RapidApiAuthGuard } from "./rapidapi-auth.guard.js";
import {
  classifyBody,
  debugHeadersBody,
  parseClassifyQuery,
  pingReply,
  standardsBody,
} from "./rapidapi.js";

const unixSeconds = () => Date.now() / 1000;

/**
 * RapidAPI meters requests upstream, so these routes never touch the
 * website quota.
 */
@Controller("api/v1/rapid")
export class RapidApiController {
  private readonly logger = new Logger("RapidAPI");
  private readonly classifiers: ClassifierConfigMap;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(ClassificationService)
    private readonly classification: Pick<ClassificationService, "classify">,
    @Inject(EMBEDDING_CLIENT) private readonly embeddingClient: object | null,
    @Inject(QDRANT_CLIENT)
    private readonly qdrant: Pick<QdrantClient, "getCollections">,
  ) {
    this.classifiers = classifierConfigFor(config.embedding);
  }

  @Get("classify")
  @UseGuards(RapidApiAuthGuard)
  async classify(@Req() req: Request, @Res() res: Response): Promise<void> {
    const parsed = parseClassifyQuery(
      parseQueryString(splitRequestTarget(req.originalUrl).rawQuery),
    );
    if (!parsed.ok) {
      throw new HttpException({ detail: parsed.detail }, parsed.status);
    }
    const request = parsed.value;
    this.logger.log(
      `RapidAPI classification request: ${request.classifierType} <- ${request.query}`,
    );
    const started = performance.now();
    const disconnected = new AbortController();
    res.on("close", () => {
      if (!res.writableFinished) disconnected.abort();
    });
    try {
      const outcome = await this.classification.classify(disconnected.signal, {
        query: request.query,
        classifierType: request.classifierType,
        ...(request.version === undefined ? {} : { version: request.version }),
        topK: request.topK,
      });
      const body = classifyBody(
        request,
        outcome,
        (performance.now() - started) / 1000,
      );
      sendJson(res, {
        status: 200,
        body,
        headers: classificationResultHeaders(),
      });
    } catch (error) {
      if (disconnected.signal.aborted) return;
      if (error instanceof ClassificationQueueFull) {
        this.logger.warn(
          `RapidAPI classification queue full for ${request.classifierType}`,
        );
        for (const [name, value] of Object.entries(cacheHeaders("NO_STORE"))) {
          res.setHeader(name, value);
        }
        throw new HttpException({ detail: error.message }, 503);
      }
      if (error instanceof ClassificationError) throw error;
      this.logger.error(`RapidAPI classification error: ${String(error)}`);
      throw new HttpException({ detail: "Classification failed" }, 500);
    }
  }

  @Get("standards")
  @UseGuards(RapidApiAuthGuard)
  standards(@Res() res: Response): void {
    sendJson(res, {
      status: 200,
      body: standardsBody(this.classifiers, unixSeconds()),
      headers: classificationResultHeaders(),
    });
  }

  @Get("ping")
  async ping(@Res() res: Response): Promise<void> {
    const databaseHealthy = await probeSucceeds(() =>
      this.qdrant.getCollections(),
    );
    sendJson(
      res,
      pingReply(
        { embeddingConfigured: this.embeddingClient !== null, databaseHealthy },
        unixSeconds(),
      ),
    );
  }

  @Get("debug-headers")
  debugHeaders(@Req() req: Request, @Res() res: Response): void {
    if (!this.config.rapidApi.debugMode) {
      throw new HttpException({ detail: "Debug endpoint not available" }, 404);
    }
    sendJson(res, {
      status: 200,
      body: debugHeadersBody(req.rawHeaders, unixSeconds()),
    });
  }
}
