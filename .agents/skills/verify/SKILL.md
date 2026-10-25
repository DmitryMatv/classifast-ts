---
name: verify
description: Drive Classifast's web pages and classification flow in an isolated browser run, and keep evidence of user-visible behavior.
---

# Verify Classifast

Read [the feature map](features/README.md) and the feature file for the path you are checking. The primary product is the web UI. The HTTP routes are useful for checking downloads and response status. The RapidAPI integration (`src/rapidapi/`) is outside these recipes.

The driver launches the NestJS app by default. `--app python` launches the FastAPI app instead, with production's `--forwarded-allow-ips "*"`. Use it only to compare the two apps; the Python app goes away when production switches to Nest.

## Launch

From the repo root, build the frontend assets and the Nest server:

```bash
npm run build
npm run build:server
mkdir -p .cache/verify
RUN_DIR=$(mktemp -d "$PWD/.cache/verify/run-XXXXXX")
node .agents/skills/verify/scripts/control.mjs launch "$RUN_DIR" --env-file /path/to/.env
```

The command prints the instance URL and `run_dir`. Copy the printed `run_dir` into `RUN_DIR` at the start of every later shell tool call; shell variables do not persist between calls. The server binds to a free `127.0.0.1` port and writes `instance.json` under `RUN_DIR`. That file records the PID and `/proc` start time of every process the launch started. Launch refuses a run directory that already has `instance.json`. Run one launch or cleanup per run directory at a time; the script does not lock the directory. Nest starts with `--max-http-header-size=65536`, as the `Dockerfile` CMD does, because uvicorn accepts request headers past Node's 16 KiB default.

`--env-file <path>` passes the file to the app: `node --env-file` for Nest and `uvicorn --env-file` for Python. Variables already in the environment win over the file. Nest also loads the checkout's own `.env` when one exists. A worktree has none, so pass the main checkout's `.env` explicitly. Python's `load_dotenv()` searches upward from `app/`, so a worktree nested under the main checkout loads the main checkout's `.env` even without `--env-file`. Never print, copy, or commit the env file.

Full mode is the default. It loads the configured Qdrant, Hugging Face, and OpenRouter targets from the environment, and startup validates the Qdrant collections read-only. Do not run `utilities/qdrant_config.py` or `npm run qdrant:indexes -- apply` as part of verification. Full mode requires a Redis `PING` at `127.0.0.1:16379` and points the app there, even if the env file names a different Redis host. `health_gate_passed: true` and `local_redis_ready: true` are required before a lookup; only a completed lookup proves the external classification path. Concurrent full-mode runs share Redis quota keys and external service credentials.

Start a disposable Redis at that address before a full-mode launch. Without Docker, use the Redis 7.4.2 binary that the `redis` test project compiles into `node_modules/.cache/redis-memory-server/` on its first run (`npx vitest run --project redis`):

```bash
mkdir -p .cache/verify/redis
setsid node_modules/.cache/redis-memory-server/redis-binaries/7.4.2/redis-server \
  --port 16379 --bind 127.0.0.1 --save "" --appendonly no \
  > .cache/verify/redis/redis.log 2>&1 < /dev/null &
sleep 1
ss -ltnp | grep ':16379 '
```

Record the PID that `ss` reports and its start time (`cut -d' ' -f22 /proc/<pid>/stat`). After the run, check that the start time still matches, then stop only that PID with `kill <pid>`. The Redis lives outside any run directory, so several runs can share it. With Docker, `sudo docker run --rm -d --name classifast-verify-redis -p 127.0.0.1:16379:6379 redis:7.4 redis-server --save "" --appendonly no` works too; Docker may ask for a sudo password, so never copy credentials into a tool call. If a Redis already answers on 16379, check that it is a disposable instance before you use it.

For page and download checks without live classification, launch a fresh run directory with `--mode public`. Public mode answers like a server with no credentials and no Redis, even when an env file supplies them: it sets `HF_TOKEN`, `OPENROUTER_API_KEY`, `QDRANT_API_KEY`, `CLERK_SECRET_KEY`, `POLAR_ACCESS_TOKEN`, `POLAR_WEBHOOK_SECRET`, `RAPIDAPI_SECRET`, `REDIS_USERNAME` and `REDIS_PASSWORD` to empty values, which both apps treat as absent, and points Redis at the unreachable `127.0.0.1:1`. Nest refuses to boot without Qdrant, so public mode first starts a detached fake Qdrant (`control.mjs fake-qdrant`) that serves the configured collections and logs every request to `evidence/fake-qdrant.log`. Python public mode disables the FastAPI lifespan instead and connects to nothing. Public mode cannot prove classification results or checkout; a fragment with a description answers 503 `Usage tracking is temporarily unavailable`. `npm run test:contract:nest` runs the contract suite against this mode. Do not drive another instance or use the deployed site as a substitute.

## Doctor

Run this read-only check before a browser session and whenever a page looks wrong:

```bash
node .agents/skills/verify/scripts/control.mjs doctor "$RUN_DIR" | tee "$RUN_DIR/evidence/doctor.json"
```

It checks every recorded process identity, the mapping page, and `/health`. Full mode also requires a local Redis `PING`, `/health` 200, and `health_gate_passed: true`. Public mode expects the mapping page to work and reports `/health` as 503 `{"detail":"Service Unavailable"}`. In Nest that is because public mode clears `HF_TOKEN`, so no embedding client exists and the health check fails before it probes the fake Qdrant; in Python no clients start. If a process is gone or the port shows the wrong app, launch a new run rather than driving an existing process.

## Drive

Use Codex's collaborative browser preview tools for the real UI. Pass the exact `url` printed by launch, plus `/`, to `mcp__t3_code__preview_open`. Inspect it with `mcp__t3_code__preview_snapshot({"includeImage":false})`, then act with `preview_click`, `preview_type`, and `preview_wait_for`. Keep the returned `tabId` and pass it to later calls. For example, the homepage mapping entry is `role=link[name='Mapping Files']`, the catalog product is `role=link[name='UNSPSC to CPV Mapping']`, and the classifier input is `role=textbox[name='Product description']`. The [feature files](features/README.md) give each exact route, selector, and expected state. Navigate the browser to the instance port, never to `classifast.com`.

If preview tools are unavailable, use a browser with Playwright selectors against this same local URL. Save Playwright screenshots and the observed URL, input, and visible results under `$RUN_DIR/evidence/`. If `preview_snapshot` fails while other preview actions work, use read-only `preview_evaluate` calls to record those values before and after the action. Note the missing screenshot in the evidence. If navigation also fails, run doctor again and reset the browser or switch to a fresh local browser session. A `curl` response alone proves an HTTP route, not the browser interaction. For sample downloads, resolve the exact visible link's `href` against the current page URL and save the response as a CSV artifact.

The homepage and classifier pages load production Clerk scripts and Google Analytics. Clerk rejects a localhost origin and logs a browser error; that does not prevent public navigation or mapping downloads. Do not count a local sign-in check as passed on this setup, and expect outbound analytics traffic unless the browser blocks it.

## Evidence

Put proof under `$RUN_DIR/evidence/`; cleanup preserves it. Record the feature ID and entry point in `evidence/notes.md`. Capture a browser snapshot before the action and after the result, using `preview_snapshot({"save":true,"includeImage":false})` and copy each returned `screenshotPath` into the evidence directory when snapshots work. Record the browser URL and visible text after each action. Save HTTP headers or downloaded files for HTTP side effects, such as the sample CSV. Check that the file has a CSV header and data rows. For classification, capture the submitted description, the resulting list or explicit empty state, and the URL change. A loading indicator, mock response, or `/health` result alone is not proof of classification.

Use production user paths. Never set DOM state or call a test-only endpoint to manufacture success. Mock external services only at a boundary already isolated by the app, and say so in the proof. Do not assume a dry-run skips external work: inspect its actual network calls and side effects before relying on it. Sign-in requires a Clerk test configuration that accepts the local origin. Payment routes currently construct Polar clients with the default production server; a sandbox token alone does not select the sandbox. Treat successful checkout as unreachable until a dedicated sandbox integration is available, and record the entry page and missing prerequisite without creating a production checkout.

## Cleanup

Stop only the processes this run started:

```bash
node .agents/skills/verify/scripts/control.mjs cleanup "$RUN_DIR"
test -f "$RUN_DIR/evidence/doctor.json"
```

The script checks each recorded PID against its process start time, stops the server and then the fake Qdrant, and removes `instance.json` only while it still names the instance it loaded, so a late cleanup never deletes a newer launch's state. It attempts every process even when one fails, and keeps `instance.json` when any process could not be stopped. Keep `$RUN_DIR/evidence/` and its screenshots, downloads, and logs. Never use `pkill` or remove another run's directory. After a failed or interrupted launch (Ctrl-C, SIGTERM or SIGHUP), the script stops every process it started and removes `instance.json`; inspect `evidence/server.log` before retrying in a new run directory.

Stop the Redis you started by its recorded PID after checking that its start time still matches, or remove the exact container with `sudo docker rm -f classifast-verify-redis`. Leave a Redis running if someone else started it.
