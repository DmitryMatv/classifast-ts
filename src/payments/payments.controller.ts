import { Controller, HttpCode, Post, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import { Clerk } from "../auth/clerk.js";
import { cacheHeaders } from "../http/cache-profiles.js";
import { requestBaseUrl } from "../http/middleware.js";
import { CheckoutRateLimit } from "../rate-limit/checkout-rate-limit.js";
import { clientIp } from "../usage/client-identity.js";
import { Checkouts, type CheckoutReply } from "./checkout.js";
import { PolarWebhooks, type WebhookReply } from "./polar-webhooks.js";
import { readRawBody } from "./raw-body.js";

// Python's routes run enforce_checkout_rate_limit before resolving the Clerk
// user, so an unauthenticated flood still counts against the IP.
@Controller("api")
export class PaymentsController {
  constructor(
    private readonly rateLimit: CheckoutRateLimit,
    private readonly clerk: Clerk,
    private readonly checkouts: Checkouts,
    private readonly webhooks: PolarWebhooks,
  ) {}

  @Post("create-checkout")
  @HttpCode(200)
  async createCheckout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<CheckoutReply> {
    res.set(cacheHeaders("NO_STORE"));
    await this.rateLimit.enforce(clientIp(req));
    const userId = await this.clerk.requireSessionUser(
      req.headers.authorization,
    );
    return this.checkouts.createPro(
      userId,
      await readRawBody(req),
      requestBaseUrl(req),
    );
  }

  @Post("create-mapping-checkout")
  @HttpCode(200)
  async createMappingCheckout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<CheckoutReply> {
    res.set(cacheHeaders("NO_STORE"));
    await this.rateLimit.enforce(clientIp(req));
    return this.checkouts.createMapping(
      await readRawBody(req),
      requestBaseUrl(req),
    );
  }

  // Starlette's dict(request.headers) keeps the first of repeated headers.
  @Post("webhooks/polar")
  @HttpCode(200)
  async polarWebhook(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<WebhookReply> {
    res.set(cacheHeaders("NO_STORE"));
    return this.webhooks.handle(
      () => readRawBody(req),
      (name) => req.headersDistinct[name]?.[0],
    );
  }
}
