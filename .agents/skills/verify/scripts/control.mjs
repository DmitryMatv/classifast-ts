#!/usr/bin/env node
// Start, inspect, and stop a Classifast verification instance.
import { spawn, execFileSync } from "node:child_process";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { createServer, createConnection } from "node:net";
import { createServer as createHttpServer } from "node:http";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs, parseEnv } from "node:util";

const SCRIPT = fileURLToPath(import.meta.url);
const ROOT = resolve(dirname(SCRIPT), "../../../..");
const STATE_NAME = "instance.json";
const LOCAL_REDIS = { host: "127.0.0.1", port: 16379 };
const READY_ATTEMPTS = 300;
const READY_INTERVAL_MS = 200;
const STOP_GRACE_MS = 10_000;

// Public mode answers like a server with no credentials and no Redis, even
// when an env file or the repository-root .env supplies them. Both apps
// treat an empty value as absent.
const CREDENTIALS = [
  "HF_TOKEN",
  "OPENROUTER_API_KEY",
  "QDRANT_API_KEY",
  "CLERK_SECRET_KEY",
  "POLAR_ACCESS_TOKEN",
  "POLAR_WEBHOOK_SECRET",
  "RAPIDAPI_SECRET",
  "REDIS_USERNAME",
  "REDIS_PASSWORD",
];
const UNREACHABLE_REDIS_PORT = "1";

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

function fail(message) {
  throw new Error(message);
}

function processStart(pid) {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    const fields = stat.slice(stat.lastIndexOf(") ") + 2).split(" ");
    return fields[0] === "Z" ? undefined : fields[19];
  } catch {
    return undefined;
  }
}

function owns(proc) {
  return processStart(proc.pid) === proc.process_start;
}

async function stopProcess(proc) {
  if (!owns(proc)) return;
  process.kill(proc.pid, "SIGTERM");
  for (let waited = 0; waited < STOP_GRACE_MS; waited += 100) {
    await sleep(100);
    if (!owns(proc)) return;
  }
  if (owns(proc)) process.kill(proc.pid, "SIGKILL");
  for (let waited = 0; waited < 2_000 && owns(proc); waited += 100) {
    await sleep(100);
  }
}

async function stopAll(state) {
  for (const proc of [...state.processes].reverse()) await stopProcess(proc);
}

function localRedisReady() {
  return new Promise((done) => {
    const socket = createConnection(LOCAL_REDIS);
    let reply = "";
    const finish = (ready) => {
      socket.destroy();
      done(ready);
    };
    socket.setTimeout(2_000, () => finish(false));
    socket.on("error", () => finish(false));
    socket.on("connect", () => socket.write("*1\r\n$4\r\nPING\r\n"));
    socket.on("data", (chunk) => {
      reply += chunk.toString("latin1");
      if (reply.includes("\r\n")) finish(reply === "+PONG\r\n");
    });
  });
}

function freePort() {
  return new Promise((done, reject) => {
    const listener = createServer();
    listener.on("error", reject);
    listener.listen(0, "127.0.0.1", () => {
      const { port } = listener.address();
      listener.close(() => done(port));
    });
  });
}

async function request(url) {
  const response = await fetch(url, {
    redirect: "manual",
    signal: AbortSignal.timeout(8_000),
  });
  return { status: response.status, body: await response.text() };
}

function stateFile(runDir) {
  return join(runDir, STATE_NAME);
}

function loadState(runDir) {
  return JSON.parse(readFileSync(stateFile(runDir), "utf8"));
}

function saveState(runDir, state, flag = "w") {
  writeFileSync(stateFile(runDir), `${JSON.stringify(state, null, 2)}\n`, {
    flag,
  });
}

async function inspect(state) {
  const gone = state.processes.filter((proc) => !owns(proc));
  if (gone.length > 0) {
    fail(
      `Recorded process gone or PID reused: ${gone.map((proc) => `${proc.role} ${proc.pid}`).join(", ")}`,
    );
  }
  const base = state.url;
  const page = await request(`${base}/mapping/`);
  const health = await request(`${base}/health`);
  const pageReady =
    page.status === 200 &&
    page.body.includes("Mapping tables for cross-referencing");
  const healthReady =
    health.status === 200 && health.body.includes('"healthy"');
  const redisReady = state.mode === "full" ? await localRedisReady() : null;
  if (!pageReady || (state.mode === "full" && !(healthReady && redisReady))) {
    fail(
      `Doctor failed: mapping page=${page.status}, health=${health.status}, ` +
        `local Redis ready=${redisReady}, expected mode=${state.mode}`,
    );
  }
  return {
    url: base,
    app: state.app,
    mode: state.mode,
    env_file: state.env_file,
    processes: state.processes,
    revision_at_launch: state.revision,
    mapping_page_ready: pageReady,
    health_status: health.status,
    health_gate_passed: healthReady,
    local_redis_ready: redisReady,
  };
}

function pythonExecutable() {
  const venv = process.env.VIRTUAL_ENV ?? join(ROOT, ".venv");
  const python = join(venv, "bin", "python");
  if (!existsSync(python)) {
    fail(
      `No Python at ${python}; activate the virtualenv or create ${join(ROOT, ".venv")}`,
    );
  }
  return python;
}

function readEnvFile(path) {
  return existsSync(path) ? parseEnv(readFileSync(path, "utf8")) : {};
}

// The environment the Nest process will see: its own environment wins over
// --env-file, which wins over the repository-root .env that main.js loads.
function nestEffectiveEnv(serverEnv, envFile) {
  return {
    ...readEnvFile(join(ROOT, ".env")),
    ...(envFile ? readEnvFile(envFile) : {}),
    ...serverEnv,
  };
}

async function fakeQdrantSpec(effectiveEnv) {
  const dist = (path) => import(pathToFileURL(join(ROOT, "dist", path)).href);
  const { parseAppConfig } = await dist("config/app-config.js");
  const { classifierConfigFor, getAllCollectionNames } = await dist(
    "classifier/classifier-config.js",
  );
  const { getPayloadIndexSchema, PAYLOAD_INDEX_FIELDS } = await dist(
    "qdrant/qdrant-schema.js",
  );
  const { embedding } = parseAppConfig(effectiveEnv);
  const index = (field) => {
    const params = getPayloadIndexSchema(field);
    return { data_type: params.type, params, points: 10 };
  };
  return {
    collections: getAllCollectionNames(classifierConfigFor(embedding)),
    info: {
      status: "green",
      config: {
        params: { vectors: { size: embedding.dims, distance: "Cosine" } },
        quantization_config: null,
      },
      payload_schema: Object.fromEntries(
        PAYLOAD_INDEX_FIELDS.map((field) => [field, index(field)]),
      ),
    },
  };
}

// A read-only Qdrant that passes the Nest boot check and answers /health's
// collection listing. It logs every request it receives.
function serveFakeQdrant(port, specPath) {
  const spec = JSON.parse(readFileSync(specPath, "utf8"));
  const names = new Set(spec.collections);
  const server = createHttpServer((req, res) => {
    console.log(`${req.method} ${req.url}`);
    const reply = (status, body) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    const ok = (result) => reply(200, { result, status: "ok", time: 0 });
    const path = new URL(req.url, "http://fake").pathname;
    if (req.method === "GET" && path === "/") {
      return reply(200, { title: "qdrant", version: "1.19.0" });
    }
    if (req.method === "GET" && path === "/collections") {
      return ok({ collections: spec.collections.map((name) => ({ name })) });
    }
    const match = /^\/collections\/([^/]+)$/.exec(path);
    if (
      req.method === "GET" &&
      match &&
      names.has(decodeURIComponent(match[1]))
    ) {
      return ok(spec.info);
    }
    reply(404, { status: { error: "Not found" }, time: 0 });
  });
  server.listen(port, "127.0.0.1", () =>
    console.log(`fake Qdrant listening on 127.0.0.1:${port}`),
  );
  process.on("SIGTERM", () => server.close(() => process.exit(0)));
}

function startDetached(role, command, args, { env, log }) {
  const out = openSync(log, "a");
  try {
    const child = spawn(command, args, {
      cwd: ROOT,
      env,
      detached: true,
      stdio: ["ignore", out, out],
    });
    child.unref();
    if (child.pid === undefined) fail(`Could not start ${role}: ${command}`);
    return {
      child,
      record: { role, pid: child.pid, process_start: processStart(child.pid) },
    };
  } finally {
    closeSync(out);
  }
}

async function waitFor(child, label, log, probe) {
  for (let attempt = 0; attempt < READY_ATTEMPTS; attempt++) {
    if (child.exitCode !== null || child.signalCode !== null) {
      fail(
        `${label} exited with ${child.exitCode ?? child.signalCode}; see ${log}`,
      );
    }
    try {
      return await probe();
    } catch {
      await sleep(READY_INTERVAL_MS);
    }
  }
  fail(`${label} did not become ready; see ${log}`);
}

function serverCommand(app, mode, port, envFile) {
  if (app === "nest") {
    return {
      command: process.execPath,
      args: [...(envFile ? [`--env-file=${envFile}`] : []), "dist/main.js"],
    };
  }
  return {
    command: pythonExecutable(),
    args: [
      "-m",
      "uvicorn",
      "app.main:app",
      "--host",
      "127.0.0.1",
      "--port",
      String(port),
      "--forwarded-allow-ips",
      "*",
      "--lifespan",
      mode === "full" ? "on" : "off",
      ...(envFile ? ["--env-file", envFile] : []),
    ],
  };
}

function checkPrerequisites(app, envFile) {
  for (const asset of [
    "app/static/js/common.js",
    "app/static/css/styles.css",
  ]) {
    if (!existsSync(join(ROOT, asset))) {
      fail(`Missing ${asset}; run npm run build first`);
    }
  }
  if (app === "nest" && !existsSync(join(ROOT, "dist/main.js"))) {
    fail("Missing dist/main.js; run npm run build:server first");
  }
  if (envFile && !existsSync(envFile)) fail(`No env file at ${envFile}`);
}

async function launch(runDir, { app, mode, envFile }) {
  if (existsSync(stateFile(runDir))) {
    fail(`Instance state already exists: ${stateFile(runDir)}`);
  }
  checkPrerequisites(app, envFile);
  if (mode === "full" && !(await localRedisReady())) {
    fail(
      `Start disposable Redis at ${LOCAL_REDIS.host}:${LOCAL_REDIS.port} before full verification`,
    );
  }
  const evidence = join(runDir, "evidence");
  mkdirSync(evidence, { recursive: true });
  const port = await freePort();
  const state = {
    app,
    mode,
    url: `http://127.0.0.1:${port}`,
    env_file: envFile ?? null,
    revision: execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: ROOT,
      encoding: "utf8",
    }).trim(),
    processes: [],
  };
  saveState(runDir, state, "wx");

  const serverEnv = {
    ...process.env,
    HOST: "127.0.0.1",
    PORT: String(port),
    NO_COLOR: "1",
  };
  // Dockerfile.node sets it; React's development build renders differently.
  if (app === "nest") serverEnv.NODE_ENV = "production";
  if (mode === "full") {
    Object.assign(serverEnv, {
      REDIS_HOST: LOCAL_REDIS.host,
      REDIS_PORT: String(LOCAL_REDIS.port),
      REDIS_USERNAME: "",
      REDIS_PASSWORD: "",
    });
  } else {
    for (const name of CREDENTIALS) serverEnv[name] = "";
    Object.assign(serverEnv, {
      REDIS_HOST: "127.0.0.1",
      REDIS_PORT: UNREACHABLE_REDIS_PORT,
      DEBUG_MODE: "false",
    });
  }

  try {
    if (app === "nest" && mode === "public") {
      const qdrantPort = await freePort();
      const specPath = join(runDir, "fake-qdrant.json");
      const spec = await fakeQdrantSpec(nestEffectiveEnv(serverEnv, envFile));
      writeFileSync(specPath, `${JSON.stringify(spec, null, 2)}\n`);
      const log = join(evidence, "fake-qdrant.log");
      const qdrant = startDetached(
        "fake-qdrant",
        process.execPath,
        [SCRIPT, "fake-qdrant", specPath, "--port", String(qdrantPort)],
        { env: { PATH: process.env.PATH ?? "" }, log },
      );
      state.processes.push(qdrant.record);
      saveState(runDir, state);
      const qdrantUrl = `http://127.0.0.1:${qdrantPort}`;
      await waitFor(qdrant.child, "Fake Qdrant", log, () =>
        request(`${qdrantUrl}/`),
      );
      serverEnv.QDRANT_URL = qdrantUrl;
    }

    const log = join(evidence, "server.log");
    const { command, args } = serverCommand(app, mode, port, envFile);
    const server = startDetached("server", command, args, {
      env: serverEnv,
      log,
    });
    state.processes.push(server.record);
    saveState(runDir, state);
    return await waitFor(server.child, "Server", log, () => inspect(state));
  } catch (error) {
    await stopAll(state);
    unlinkSync(stateFile(runDir));
    throw error;
  }
}

async function cleanup(runDir) {
  const state = loadState(runDir);
  await stopAll(state);
  unlinkSync(stateFile(runDir));
  return {
    stopped: state.processes,
    evidence: join(runDir, "evidence"),
  };
}

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    app: { type: "string", default: "nest" },
    mode: { type: "string", default: "full" },
    "env-file": { type: "string" },
    port: { type: "string" },
  },
});
const [action, target] = positionals;
const usage =
  "Usage: control.mjs launch|doctor|cleanup <run_dir> " +
  "[--app nest|python] [--mode full|public] [--env-file <path>]";

async function main() {
  if (action === "fake-qdrant") {
    serveFakeQdrant(Number(values.port), target);
    return;
  }
  if (!["launch", "doctor", "cleanup"].includes(action) || !target) fail(usage);
  if (!["nest", "python"].includes(values.app)) fail(usage);
  if (!["full", "public"].includes(values.mode)) fail(usage);
  const runDir = resolve(target);
  let result;
  if (action === "launch") {
    result = await launch(runDir, {
      app: values.app,
      mode: values.mode,
      envFile: values["env-file"] && resolve(values["env-file"]),
    });
  } else if (action === "doctor") {
    result = await inspect(loadState(runDir));
  } else {
    result = await cleanup(runDir);
  }
  console.log(JSON.stringify({ ...result, run_dir: runDir }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
