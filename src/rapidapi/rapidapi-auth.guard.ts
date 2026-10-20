import {
  HttpException,
  Inject,
  Injectable,
  Logger,
  type CanActivate,
  type ExecutionContext,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { APP_CONFIG, type AppConfig } from "../config/app-config.js";
import { checkProxySecret, PROXY_SECRET_HEADER } from "./rapidapi.js";

/**
 * RapidAPI checks API keys itself and forwards requests with its proxy
 * secret, so the secret proves a request came through RapidAPI.
 */
@Injectable()
export class RapidApiAuthGuard implements CanActivate {
  private readonly logger = new Logger("RapidAPI");

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  canActivate(context: ExecutionContext): boolean {
    const http = context.switchToHttp();
    const req = http.getRequest<Request>();
    const verdict = checkProxySecret(
      this.config.rapidApi.secret,
      req.headersDistinct[PROXY_SECRET_HEADER]?.[0],
    );
    switch (verdict) {
      case "accepted":
        return true;
      case "unconfigured":
        this.logger.warn(
          "RAPIDAPI_SECRET not configured - API authentication disabled",
        );
        throw new HttpException(
          { detail: "API authentication not configured" },
          503,
        );
      case "missing":
        http.getResponse<Response>().setHeader("WWW-Authenticate", "ApiKey");
        throw new HttpException(
          {
            detail:
              "Missing authentication - use RapidAPI to access this endpoint",
          },
          401,
        );
      case "invalid":
        this.logger.warn("Invalid RapidAPI proxy secret received");
        throw new HttpException({ detail: "Invalid authentication" }, 401);
    }
  }
}
