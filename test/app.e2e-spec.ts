import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { Test } from "@nestjs/testing";
import type { NestExpressApplication } from "@nestjs/platform-express";
import request from "supertest";
import { vi } from "vitest";
import { AppModule } from "../src/app.module.js";
import { ConfigError } from "../src/config/app-config.js";
import { configureHttpApp } from "../src/http-app.js";

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return `http://127.0.0.1:${port}`;
}

async function close(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}

function fakeQdrantServer(): Server {
  return createServer((req, res) => {
    if (req.method === "GET" && req.url === "/") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ title: "qdrant", version: "1.19.0" }));
      return;
    }
    if (req.method === "GET" && req.url === "/collections") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({ result: { collections: [] }, status: "ok", time: 0 }),
      );
      return;
    }
    res.writeHead(404).end();
  });
}

async function unreachableUrl(): Promise<string> {
  const server = createServer();
  const url = await listen(server);
  await close(server);
  return url;
}

const BOOT_ENV_NAMES = [
  "HF_TOKEN",
  "HF_EMBEDDING_TIMEOUT_SECONDS",
  "QDRANT_URL",
  "QDRANT_HOST",
  "QDRANT_PORT",
  "QDRANT_API_KEY",
] as const;

function stubBootEnv(env: Partial<Record<string, string>>): void {
  for (const name of BOOT_ENV_NAMES) vi.stubEnv(name, undefined);
  for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value);
}

async function bootApp(env: Partial<Record<string, string>>) {
  stubBootEnv(env);
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>();
  configureHttpApp(app);
  await app.init();
  return app;
}

describe("/health (e2e)", () => {
  let app: NestExpressApplication | undefined;
  let qdrant: Server | undefined;

  afterEach(async () => {
    await app?.close();
    if (qdrant) await close(qdrant);
    app = undefined;
    qdrant = undefined;
    vi.unstubAllEnvs();
  });

  it("answers 200 when embedding is configured and Qdrant is reachable", async () => {
    qdrant = fakeQdrantServer();
    app = await bootApp({ HF_TOKEN: "test", QDRANT_URL: await listen(qdrant) });

    const response = await request(app.getHttpServer()).get("/health");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: "healthy" });
    expect(response.headers["cache-control"]).toBeUndefined();
    expect(response.headers["etag"]).toBeUndefined();
    expect(response.headers["x-powered-by"]).toBeUndefined();
  });

  it("answers 503 when Qdrant is unreachable", async () => {
    app = await bootApp({
      HF_TOKEN: "test",
      QDRANT_URL: await unreachableUrl(),
    });

    const response = await request(app.getHttpServer()).get("/health");

    expect(response.status).toBe(503);
    expect(response.body).toEqual({ detail: "Service Unavailable" });
    expect(response.headers["cache-control"]).toBeUndefined();
  });

  it("answers 503 without HF_TOKEN even when Qdrant is reachable", async () => {
    qdrant = fakeQdrantServer();
    app = await bootApp({ QDRANT_URL: await listen(qdrant) });

    const response = await request(app.getHttpServer()).get("/health");

    expect(response.status).toBe(503);
    expect(response.body).toEqual({ detail: "Service Unavailable" });
  });

  it("fails boot naming a malformed variable without echoing its value", async () => {
    const value = "not-a-port-5521";
    stubBootEnv({ QDRANT_PORT: value });

    const boot = Test.createTestingModule({ imports: [AppModule] }).compile();

    await expect(boot).rejects.toThrow(ConfigError);
    await expect(boot).rejects.toThrow(/QDRANT_PORT must be an integer/);
    await expect(boot).rejects.not.toThrow(value);
  });
});
