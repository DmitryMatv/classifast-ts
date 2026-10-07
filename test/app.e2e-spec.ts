import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { Test } from "@nestjs/testing";
import type { NestExpressApplication } from "@nestjs/platform-express";
import request from "supertest";
import { AppModule } from "../src/app.module.js";
import { APP_CONFIG, parseAppConfig } from "../src/config/app-config.js";
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

async function bootApp(env: NodeJS.ProcessEnv) {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(APP_CONFIG)
    .useValue(parseAppConfig(env))
    .compile();
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
});
