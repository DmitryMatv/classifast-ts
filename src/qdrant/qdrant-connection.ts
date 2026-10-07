import { QdrantClient, type QdrantClientParams } from "@qdrant/js-client-rest";
import { z } from "zod";

const trimmed = z.string().trim();

const qdrantEnvSchema = z.object({
  QDRANT_URL: trimmed.default(""),
  QDRANT_HOST: trimmed.default(""),
  QDRANT_PORT: trimmed.default("6333"),
  QDRANT_API_KEY: trimmed.default(""),
});

const portSchema = z
  .string()
  .regex(/^\d+$/, "QDRANT_PORT must be a port number")
  .transform(Number);

export function resolveQdrantUrl(env: NodeJS.ProcessEnv): string {
  const { QDRANT_URL, QDRANT_HOST, QDRANT_PORT } = qdrantEnvSchema.parse(env);
  if (QDRANT_URL) {
    if (QDRANT_URL.startsWith("http://") || QDRANT_URL.startsWith("https://")) {
      return QDRANT_URL.replace(/\/+$/, "");
    }
    return `https://${QDRANT_URL.replace(/\/+$/, "")}`;
  }
  const port = portSchema.parse(QDRANT_PORT);
  return `http://${QDRANT_HOST || "localhost"}:${port}`;
}

export function qdrantClientParams(
  env: NodeJS.ProcessEnv,
  timeoutMs: number,
): QdrantClientParams {
  const apiKey = qdrantEnvSchema.parse(env).QDRANT_API_KEY;
  const url = new URL(resolveQdrantUrl(env));
  // Like the Python client, the JS client uses port 6333 for a portless URL,
  // and it drops the URL path unless it arrives as `prefix`.
  const defaultPort = url.protocol === "https:" ? 443 : 80;
  return {
    url: url.origin,
    port: url.port ? Number(url.port) : defaultPort,
    ...(url.pathname === "/" ? {} : { prefix: url.pathname }),
    ...(apiKey ? { apiKey } : {}),
    timeout: timeoutMs,
  };
}

export function createQdrantClient(
  env: NodeJS.ProcessEnv,
  timeoutMs: number,
): QdrantClient {
  return new QdrantClient(qdrantClientParams(env, timeoutMs));
}
