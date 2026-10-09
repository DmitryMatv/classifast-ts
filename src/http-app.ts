import type { NestApplicationOptions } from "@nestjs/common";
import express from "express";
import {
  ExpressAdapter,
  type NestExpressApplication,
} from "@nestjs/platform-express";
import { FastApiErrorFilter } from "./http/error-filter.js";
import {
  gzipResponses,
  recordProcessTime,
  redirectToCanonicalQuery,
  rejectSuspiciousUrls,
  routeOnDecodedPath,
  setSecurityHeaders,
} from "./http/middleware.js";
import { STATIC_ROOT, staticFilesMount } from "./static/static-files.js";

// Express reads the routing settings when it creates its router, and
// ExpressAdapter's constructor already registers middleware on it.
export function createHttpAdapter(): ExpressAdapter {
  const server = express();
  server.disable("x-powered-by");
  server.set("etag", false);
  server.set("case sensitive routing", true);
  server.set("strict routing", true);
  return new ExpressAdapter(server);
}

// Nest's global body parsers run before routing, so a bad JSON body sent to
// a GET-only route answers 400 or 413 instead of Python's 405. Routes that
// read a body parse it themselves.
export const HTTP_APP_OPTIONS = {
  bodyParser: false,
} as const satisfies NestApplicationOptions;

// Starlette runs the last added middleware first, so this is Python's
// add_middleware order reversed, ending with the /static mount.
export function configureHttpApp(
  app: NestExpressApplication,
  staticRoot = STATIC_ROOT,
): void {
  app.use(
    routeOnDecodedPath,
    setSecurityHeaders,
    redirectToCanonicalQuery,
    rejectSuspiciousUrls,
    gzipResponses,
    recordProcessTime,
    staticFilesMount(staticRoot),
  );
  app.useGlobalFilters(new FastApiErrorFilter());
}
