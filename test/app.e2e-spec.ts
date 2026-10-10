import {
  buildClassifierConfig,
  getAllCollectionNames,
} from "../src/classifier/classifier-config.js";
import { ClassificationService } from "../src/classifier/classification-service.js";
import { QdrantSchemaValidationError } from "../src/qdrant/qdrant-schema.js";
import {
  startQdrantServer,
  validCollections,
  type QdrantServer,
} from "./support/qdrant-server.js";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { Test } from "@nestjs/testing";
import type { NestExpressApplication } from "@nestjs/platform-express";
import request from "supertest";
import { vi } from "vitest";
import { AppModule } from "../src/app.module.js";
import { ConfigError } from "../src/config/app-config.js";
import {
  configureHttpApp,
  createHttpAdapter,
  HTTP_APP_OPTIONS,
} from "../src/http-app.js";

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

const COLLECTIONS = getAllCollectionNames(buildClassifierConfig({}));

function fakeQdrant(collections: readonly string[] = COLLECTIONS) {
  return startQdrantServer(validCollections(collections));
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
  "HF_EMBEDDING_DIMS",
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
  const app = moduleRef.createNestApplication<NestExpressApplication>(
    createHttpAdapter(),
    HTTP_APP_OPTIONS,
  );
  configureHttpApp(app);
  await app.init();
  return app;
}

describe("/health (e2e)", () => {
  let app: NestExpressApplication | undefined;
  let qdrant: QdrantServer | undefined;

  afterEach(async () => {
    await app?.close();
    await qdrant?.close();
    app = undefined;
    qdrant = undefined;
    vi.unstubAllEnvs();
  });

  it("answers 200 when embedding is configured and Qdrant is reachable", async () => {
    qdrant = await fakeQdrant();
    app = await bootApp({ HF_TOKEN: "test", QDRANT_URL: qdrant.url });

    const response = await request(app.getHttpServer()).get("/health");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: "healthy" });
    expect(response.headers["cache-control"]).toBeUndefined();
    expect(response.headers["etag"]).toBeUndefined();
    expect(response.headers["x-powered-by"]).toBeUndefined();
  });

  it("answers 503 when Qdrant goes away after boot", async () => {
    qdrant = await fakeQdrant();
    app = await bootApp({ HF_TOKEN: "test", QDRANT_URL: qdrant.url });
    await qdrant.close();
    qdrant = undefined;

    const response = await request(app.getHttpServer()).get("/health");

    expect(response.status).toBe(503);
    expect(response.body).toEqual({ detail: "Service Unavailable" });
    expect(response.headers["cache-control"]).toBeUndefined();
  });

  it("answers 503 without HF_TOKEN even when Qdrant is reachable", async () => {
    qdrant = await fakeQdrant();
    app = await bootApp({ QDRANT_URL: qdrant.url });

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

describe("boot-time Qdrant schema check (e2e)", () => {
  let qdrant: QdrantServer | undefined;

  afterEach(async () => {
    await qdrant?.close();
    qdrant = undefined;
    vi.unstubAllEnvs();
  });

  it("boots with the classification service after reading the schema only", async () => {
    qdrant = await fakeQdrant();
    const app = await bootApp({ HF_TOKEN: "test", QDRANT_URL: qdrant.url });
    try {
      expect(app.get(ClassificationService)).toBeInstanceOf(
        ClassificationService,
      );
    } finally {
      await app.close();
    }
    expect(qdrant.requests.map((r) => r.method)).toEqual(
      Array(COLLECTIONS.length + 1).fill("GET"),
    );
  });

  it("fails boot when a configured collection is missing", async () => {
    qdrant = await fakeQdrant(COLLECTIONS.slice(1));

    await expect(
      bootApp({ HF_TOKEN: "test", QDRANT_URL: qdrant.url }),
    ).rejects.toThrow(QdrantSchemaValidationError);
    expect(qdrant.requests.every((r) => r.method === "GET")).toBe(true);
  });

  it("fails boot when Qdrant is unreachable", async () => {
    await expect(
      bootApp({ HF_TOKEN: "test", QDRANT_URL: await unreachableUrl() }),
    ).rejects.toMatchObject({
      issues: [{ code: "collection_list_failed" }],
    });
  });
});
