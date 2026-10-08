import type { NestExpressApplication } from "@nestjs/platform-express";
import { FastApiErrorFilter } from "./http/error-filter.js";
import {
  gzipResponses,
  recordProcessTime,
  redirectToCanonicalQuery,
  rejectSuspiciousUrls,
  setSecurityHeaders,
} from "./http/middleware.js";
import { STATIC_ROOT, staticFilesMount } from "./static/static-files.js";

export function configureHttpApp(
  app: NestExpressApplication,
  staticRoot = STATIC_ROOT,
): void {
  app.disable("x-powered-by");
  app.set("etag", false);
  app.set("case sensitive routing", true);
  app.set("strict routing", true);
  app.use(
    setSecurityHeaders,
    redirectToCanonicalQuery,
    rejectSuspiciousUrls,
    gzipResponses,
    recordProcessTime,
    staticFilesMount(staticRoot),
  );
  app.useGlobalFilters(new FastApiErrorFilter());
}
