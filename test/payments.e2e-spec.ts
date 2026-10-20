import type { NestExpressApplication } from "@nestjs/platform-express";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { vi } from "vitest";
import { AppModule } from "../src/app.module.js";
import {
  buildClassifierConfig,
  getAllCollectionNames,
} from "../src/classifier/classifier-config.js";
import {
  configureHttpApp,
  createHttpAdapter,
  HTTP_APP_OPTIONS,
} from "../src/http-app.js";
import { cacheHeaders } from "../src/http/cache-profiles.js";
import {
  startQdrantServer,
  validCollections,
  type QdrantServer,
} from "./support/qdrant-server.js";

let app: NestExpressApplication;
let qdrant: QdrantServer;

beforeAll(async () => {
  for (const name of [
    "HF_TOKEN",
    "HF_EMBEDDING_DIMS",
    "QDRANT_HOST",
    "QDRANT_PORT",
    "QDRANT_API_KEY",
    "POLAR_WEBHOOK_SECRET",
  ]) {
    vi.stubEnv(name, undefined);
  }
  // Boot runs the Qdrant schema check.
  qdrant = await startQdrantServer(
    validCollections(getAllCollectionNames(buildClassifierConfig({}))),
  );
  vi.stubEnv("QDRANT_URL", qdrant.url);
  // Nothing listens on port 1, so Redis stays unavailable.
  vi.stubEnv("REDIS_HOST", "127.0.0.1");
  vi.stubEnv("REDIS_PORT", "1");
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  app = moduleRef.createNestApplication<NestExpressApplication>(
    createHttpAdapter(),
    HTTP_APP_OPTIONS,
  );
  configureHttpApp(app);
  await app.init();
});

afterAll(async () => {
  await app?.close();
  await qdrant?.close();
  vi.unstubAllEnvs();
});

describe("payment routes on an unconfigured server", () => {
  it.each(["/api/create-checkout", "/api/create-mapping-checkout"])(
    "%s fails closed without Redis",
    async (path) => {
      const reply = await request(app.getHttpServer())
        .post(path)
        .set("content-type", "application/json")
        .send("{}");
      expect(reply.status).toBe(503);
      expect(reply.body).toEqual({ detail: "Service temporarily unavailable" });
      for (const [name, value] of Object.entries(cacheHeaders("NO_STORE"))) {
        expect(reply.headers[name.toLowerCase()], name).toBe(value);
      }
    },
  );

  it("answers the webhook with 500 without POLAR_WEBHOOK_SECRET", async () => {
    const reply = await request(app.getHttpServer())
      .post("/api/webhooks/polar")
      .set("content-type", "application/json")
      .send("{}");
    expect(reply.status).toBe(500);
    expect(reply.body).toEqual({ detail: "Webhook secret not configured" });
  });

  // As in Python, the classifier page route matches GET and 404s on "api".
  it("answers GET with the classifier page route's 404", async () => {
    const reply = await request(app.getHttpServer()).get("/api/webhooks/polar");
    expect(reply.status).toBe(404);
    expect(reply.body).toEqual({ detail: "Classifier 'api' not found" });
  });
});
