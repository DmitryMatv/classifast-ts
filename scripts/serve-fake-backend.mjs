#!/usr/bin/env node
// Dev-only: serves the built app (dist/ and app/static/) with fake
// classification, quota and crawler services, so a browser can see every
// answer the classifier page renders without Redis, Qdrant or embeddings.
// Not part of the image: the Dockerfile copies neither scripts/ nor this.
//
//   npm run build && npm run build:server
//   node scripts/serve-fake-backend.mjs [--port 8765]
//
// Each lookup's answer follows a word in its description:
//   paywall      402 for an anonymous visitor ("Sign in to continue")
//   member       402 for a signed-in free visitor ("You've used your N ...")
//   busy         503, the queue is full
//   error        500 from a failing classification
//   degraded     results whose rerank failed (NO_STORE)
//   empty        no results
//   anything else: results, up to Top-K
// A control server on port + 1 overrides that for every lookup:
//   curl -X POST 127.0.0.1:8766/mode -d '{"answer":"paywall"}'
//   curl -X POST 127.0.0.1:8766/mode -d '{"answer":null,"delayMs":0}'
//   curl 127.0.0.1:8766/mode
// Fields: answer (a word above, or null for per-query), delayMs (default
// 700, so the spinner shows), crawler (the crawler check's answer).
import { AsyncLocalStorage } from "node:async_hooks";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const { values } = parseArgs({
  options: { port: { type: "string", default: "8765" } },
});
const port = Number(values.port);

// No credentials and no Redis, like the verify driver's public mode, and
// the production React build that the Dockerfile runs.
process.env.NODE_ENV ??= "production";
for (const name of [
  "HF_TOKEN",
  "HF_EMBEDDING_DIMS",
  "OPENROUTER_API_KEY",
  "QDRANT_HOST",
  "QDRANT_PORT",
  "QDRANT_API_KEY",
  "CLERK_SECRET_KEY",
  "POLAR_ACCESS_TOKEN",
  "POLAR_WEBHOOK_SECRET",
  "RAPIDAPI_SECRET",
]) {
  delete process.env[name];
}

const dist = (path) => import(pathToFileURL(join(ROOT, "dist", path)).href);

const mode = { answer: null, delayMs: 700, crawler: false };
const ANSWERS = [
  "paywall",
  "member",
  "busy",
  "error",
  "degraded",
  "empty",
  "results",
];

function answerFor(query) {
  if (mode.answer !== null) return mode.answer;
  const words = new Set(query.toLowerCase().split(/\W+/));
  return ANSWERS.find((answer) => words.has(answer)) ?? "results";
}

// Stable per query, so two lookups of one description look alike and two
// descriptions differ.
function fakeResults(query, topK) {
  let seed = [...query].reduce((sum, char) => sum * 31 + char.charCodeAt(0), 7);
  const next = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed;
  };
  return Array.from({ length: topK }, (_, index) => {
    const code = String(10000000 + (next() % 89999999));
    return {
      id: index,
      score: Math.max(0.97 - index * 0.06 - (next() % 5) / 100, 0.02),
      payload: {
        original_id: code,
        id_level: index % 2 === 0 ? "Commodity" : "Class",
        class_name: `${query} (match ${index + 1})`,
        definition: `A fake definition for '${query}', result ${index + 1}.`,
      },
    };
  });
}

async function fakeQdrant(embedding, collections, schema) {
  const index = (field) => {
    const params = schema.getPayloadIndexSchema(field);
    return { data_type: params.type, params, points: 10 };
  };
  const info = {
    status: "green",
    config: {
      params: { vectors: { size: embedding.dims, distance: "Cosine" } },
      quantization_config: null,
    },
    payload_schema: Object.fromEntries(
      schema.PAYLOAD_INDEX_FIELDS.map((field) => [field, index(field)]),
    ),
  };
  const names = new Set(collections);
  const server = createServer((req, res) => {
    const reply = (status, body) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    const path = new URL(req.url, "http://fake").pathname;
    if (path === "/") return reply(200, { title: "qdrant", version: "1.19.0" });
    if (path === "/collections")
      return reply(200, {
        result: { collections: collections.map((name) => ({ name })) },
        status: "ok",
      });
    const match = /^\/collections\/([^/]+)$/.exec(path);
    if (match && names.has(decodeURIComponent(match[1])))
      return reply(200, { result: info, status: "ok", time: 0 });
    reply(404, { status: { error: "Not found" }, time: 0 });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${server.address().port}`;
}

function controlServer() {
  const server = createServer((req, res) => {
    const send = () => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(mode));
    };
    if (req.method === "GET") return send();
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      try {
        Object.assign(mode, JSON.parse(body || "{}"));
        console.log(`mode ${JSON.stringify(mode)}`);
        send();
      } catch (error) {
        res.writeHead(400).end(String(error));
      }
    });
  });
  server.listen(port + 1, "127.0.0.1");
}

const { parseAppConfig } = await dist("config/app-config.js");
const { classifierConfigFor, getAllCollectionNames } = await dist(
  "classifier/classifier-config.js",
);
const schema = await dist("qdrant/qdrant-schema.js");
const { embedding } = parseAppConfig(process.env);
process.env.QDRANT_URL = await fakeQdrant(
  embedding,
  getAllCollectionNames(classifierConfigFor(embedding)),
  schema,
);

const { Test } = await import("@nestjs/testing");
const { AppModule } = await dist("app.module.js");
const { ClassificationService } = await dist(
  "classifier/classification-service.js",
);
const { ClassificationQueueFull } = await dist(
  "classifier/classification-queue.js",
);
const { GoogleCrawlerVerifier } = await dist("crawlers/google-crawlers.js");
const { Quota } = await dist("usage/quota.js");
const { REDIS_CONNECTION } = await dist("redis/redis-client.js");
const { configureHttpApp, createHttpAdapter, HTTP_APP_OPTIONS } =
  await dist("http-app.js");

const LIMITS = { anonymous: 10, signedIn: 25 };
// The quota sees no request, so each request's answer rides along here.
const requested = new AsyncLocalStorage();

async function classify(signal, request, authorize) {
  const answer = answerFor(request.query);
  console.log(
    `classify ${JSON.stringify(request.query)} top_k=${request.topK} -> ${answer}`,
  );
  if (answer === "busy") throw new ClassificationQueueFull();
  await new Promise((resolve) => setTimeout(resolve, mode.delayMs));
  await authorize?.();
  if (answer === "error") throw new Error("fake classification failure");
  return {
    results: answer === "empty" ? [] : fakeResults(request.query, request.topK),
    versionName: request.version ?? "",
    version: {
      collectionName: "fake",
      baseUrl: "https://example.test/code/",
      tooltip: "Fake backend: results are made up.",
    },
    query: request.query,
    elapsedSeconds: mode.delayMs / 1000,
    rerank: answer === "degraded" ? "failed" : "applied",
    idSearch: "ok",
    enhancementStatus: "applied",
  };
}

function usage(caller, allowed) {
  const limit =
    caller.kind === "anonymous" ? LIMITS.anonymous : LIMITS.signedIn;
  return {
    kind: "metered",
    allowed,
    remaining: allowed ? limit - 1 : 0,
    limit,
    caller,
  };
}

const quota = {
  resolveCaller: () =>
    Promise.resolve(
      requested.getStore() === "member"
        ? { kind: "free", userId: "user_fake" }
        : { kind: "anonymous", trackingId: "fake", ipHash: "fake" },
    ),
  check: (caller) => {
    const answer = requested.getStore();
    return Promise.resolve(
      usage(caller, answer !== "paywall" && answer !== "member"),
    );
  },
  charge: (caller) => Promise.resolve(usage(caller, true)),
};

const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
  .overrideProvider(ClassificationService)
  .useValue({ classify })
  .overrideProvider(GoogleCrawlerVerifier)
  .useValue({ isVerified: () => Promise.resolve(mode.crawler) })
  .overrideProvider(Quota)
  .useValue(quota)
  .overrideProvider(REDIS_CONNECTION)
  .useValue(null)
  .compile();
const app = moduleRef.createNestApplication(
  createHttpAdapter(),
  HTTP_APP_OPTIONS,
);
app.use((req, _res, next) => {
  const query = new URL(req.url, "http://fake").searchParams.get(
    "product_description",
  );
  requested.run(answerFor(query ?? ""), next);
});
configureHttpApp(app);
app.enableShutdownHooks();
await app.listen(port, "127.0.0.1");
controlServer();
console.log(`fake backend at http://127.0.0.1:${port}/`);
console.log(`control at http://127.0.0.1:${port + 1}/mode`);
