import type { NestExpressApplication } from "@nestjs/platform-express";

// FastAPI sends neither header; Express would add both to every response.
export function configureHttpApp(app: NestExpressApplication): void {
  app.disable("x-powered-by");
  app.set("etag", false);
}
