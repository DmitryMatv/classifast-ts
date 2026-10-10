import { STATUS_CODES, type ServerResponse } from "node:http";
import {
  Catch,
  HttpException,
  Logger,
  NotFoundException,
  type ArgumentsHost,
  type ExceptionFilter,
} from "@nestjs/common";
import type { Request, Response } from "express";
import type { HeaderRecord } from "./cache-profiles.js";

export type ErrorBody = {
  readonly detail: unknown;
  readonly [key: string]: unknown;
};

export type ErrorReply = {
  readonly status: number;
  readonly body: ErrorBody;
  readonly headers?: HeaderRecord;
};

function reasonPhrase(status: number): string {
  return STATUS_CODES[status] ?? "Error";
}

function isErrorBody(value: unknown): value is ErrorBody {
  return typeof value === "object" && value !== null && "detail" in value;
}

export function isUnexpectedError(error: unknown): boolean {
  return !(error instanceof HttpException) && statusOf(error) === undefined;
}

function statusOf(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null || !("status" in error)) {
    return undefined;
  }
  const { status } = error;
  return typeof status === "number" && status >= 400 && status <= 599
    ? status
    : undefined;
}

export function errorReply(error: unknown): ErrorReply {
  if (error instanceof HttpException) {
    const status = error.getStatus();
    const response = error.getResponse();
    if (typeof response === "string")
      return { status, body: { detail: response } };
    if (isErrorBody(response)) return { status, body: response };
    return { status, body: { detail: reasonPhrase(status) } };
  }
  const status = statusOf(error);
  if (status === undefined) {
    return { status: 500, body: { detail: reasonPhrase(500) } };
  }
  const detail =
    isErrorBody(error) && typeof error.detail === "string"
      ? error.detail
      : reasonPhrase(status);
  return { status, body: { detail } };
}

export function sendJson(res: ServerResponse, reply: ErrorReply): void {
  const payload = Buffer.from(JSON.stringify(reply.body));
  res.statusCode = reply.status;
  for (const [name, value] of Object.entries(reply.headers ?? {})) {
    res.setHeader(name, value);
  }
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Content-Length", payload.length);
  res.end(payload);
}

type RouteLayer = {
  readonly route?: { readonly methods: Readonly<Record<string, boolean>> };
  match(path: string): boolean;
};

function allowedMethods(req: Request): string[] {
  const { stack } = (req.app as unknown as { router: { stack: RouteLayer[] } })
    .router;
  const methods = new Set<string>();
  for (const layer of stack) {
    if (!layer.route || !layer.match(req.path)) continue;
    for (const [method, handled] of Object.entries(layer.route.methods)) {
      if (handled) methods.add(method.toUpperCase());
    }
  }
  if (methods.has("GET")) methods.add("HEAD");
  return [...methods].sort();
}

// Nest's fallback for unmatched requests runs as middleware, so Express never
// assigns req.route; a NotFoundException thrown by a route handler has one.
function routerMissReply(req: Request): ErrorReply {
  const allowed = allowedMethods(req);
  if (allowed.length === 0) {
    return { status: 404, body: { detail: reasonPhrase(404) } };
  }
  return {
    status: 405,
    body: { detail: reasonPhrase(405) },
    headers: { Allow: allowed.join(", ") },
  };
}

@Catch()
export class FastApiErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger("HTTP");

  catch(error: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();
    const reply =
      error instanceof NotFoundException && req.route === undefined
        ? routerMissReply(req)
        : errorReply(error);
    if (isUnexpectedError(error)) {
      this.logger.error(
        `${req.method} ${req.path} failed`,
        error instanceof Error ? error.stack : String(error),
      );
    }
    if (res.headersSent) {
      res.destroy();
      return;
    }
    sendJson(res, reply);
  }
}
