import type { NestExpressApplication } from "@nestjs/platform-express";

export function configureHttpApp(app: NestExpressApplication): void {
  app.disable("x-powered-by");
  app.set("etag", false);
}
