# AGENTS.md

This file lists the mistakes and surprises agents meet in this project. When
something surprises you, tell the developer and add it here.

## Project

Classifast classifies text, mostly product descriptions, into industry
classifications (UNSPSC, NAICS, CN/HS, ISIC, ETIM, CPV and more) with
embeddings and vector search.

- **Server:** NestJS in `src/`, rendering pages with React. `Dockerfile`
  builds the production image.
- **Frontend:** React islands and Tailwind in `app/assets/`, built by Vite
  into `app/static/`.
- **Services:** Qdrant (vectors), Redis (quota, caches), Hugging Face
  Inference (embeddings), OpenRouter (reranking, query enhancement), Clerk
  (auth), Polar (payments).
- **Offline tools:** Python scripts in `utilities/`, with their own
  virtualenv from `utilities/requirements.txt`. The `test_*.py` files there
  are manual live helpers, not a test suite.
- **Deploy:** a Raspberry Pi 4 (4 GB) runs the image through Coolify behind a
  Cloudflare Tunnel. Coolify builds `Dockerfile`, not `docker-compose.yaml`.
  Merging to `main` deploys production.

The app is a port of a FastAPI app, deleted after the cutover. "Python" in
this file and in `src/` comments means that app.

## Never

- Print, copy or commit `.env`. It is a personal cross-project secrets file.
- Run `npm run qdrant:indexes -- apply` unless asked. It backfills payloads
  and creates or replaces indexes in the configured (production) Qdrant
  collections. `-- check` is read-only.
- Flush Redis, in tests or anywhere else. The Redis specs share one server,
  and production keys (quota, `ssr-result:*`) live for months.
- Point a browser check at classifast.com. Use a local instance.

## Commands

- Install with `npm ci`; `node_modules` and the built assets are not
  committed. Use Node 24 (`.nvmrc`), the version production runs.
- `npm test` runs three Vitest projects: `assets` (frontend, jsdom),
  `server` (Nest unit specs) and `redis` (`*.redis.spec.ts`). Select one with
  `npx vitest run --project <name>`. `npm run test:e2e` runs `test/*.e2e-spec.ts`.
- `npm run typecheck`, `npm run lint` and `npm run format:check` cover the
  server, the tests and the frontend.
- `npm run build` builds the frontend; `npm run build:server` builds the
  server into `dist/`. There is no `tsx`: to run a one-off script against
  server code, build and import from `dist/`.
- `npm run test:contract:nest` starts a public-mode instance from the built
  app (run both builds first), runs the HTTP contract suite in
  `test/contract/` against it, and stops it. `npm run test:contract` needs `BASE_URL` and
  refuses a non-loopback host unless `CONTRACT_ALLOW_NON_LOOPBACK=1`, because
  it charges quota and increments rate limits. `CONTRACT_MODE=full` needs a
  server with live Qdrant, Redis and embeddings and has never run against
  them. `test/contract/support/env.ts` lists the variables that enable the
  cases needing more server configuration.
- `scripts/serve-fake-backend.mjs` serves the built app with fake services,
  so a browser can see every classifier panel. A word in the description
  picks the answer (`paywall`, `member`, `busy`, `error`, `degraded`,
  `empty`); `POST 127.0.0.1:<port+1>/mode` overrides it. The verify skill
  (`.agents/skills/verify/`) launches real instances.

## Tests and fixtures

- `test/fixtures/golden/` holds answers recorded from Python. They are
  frozen; the exporter is gone. When you change behavior on purpose, edit
  the expected values by hand or override the case in the spec (as `nestCase`
  and `apiExpectation` in `test/pages.e2e-spec.ts` do), and say why in the
  commit.
- `test/pages.e2e-spec.ts` compares every page with Python's recording,
  normalized by `test/support/html-normalizer.ts`. React 19 hoists `<title>`,
  `<meta>`, non-stylesheet `<link>` and async `<script src>` to the start of
  `<head>`, and adds an image preload per `<img>`; JSX drops a line break
  between inline elements, so write `{" "}` where the markup needs a space.
  `test/support/page-divergences.ts` lists each deliberate markup change as a
  named edit; an entry that no longer changes its page fails.
- The same spec sends Python's recorded fragment requests to the results
  API. Each case keeps the classification calls, the `events` list that pins
  the order of crawler check, caller, quota check, classification and charge,
  the cache headers and the rendered markup.
- A test that boots `AppModule` needs a fake Qdrant serving every configured
  collection, because startup validates them: `startQdrantServer` with
  `validCollections` from `test/support/qdrant-server.ts`. Fake Qdrant
  servers must answer `GET /` with a version, which the JS client checks.
- The `redis` project compiles Redis 7.4.2 from source on first use
  (`.npmrc` sets `ignore-scripts`) and keeps it in
  `~/.cache/redis-memory-server`. Isolate a spec with unique key ids
  (`uniqueId` in `test/support/redis.ts`). Quota and rate-limit specs must
  not mock Redis: MULTI, `EXPIRE NX` and `SET EX NX` are what they test.
- jsdom prints an exception thrown in an event listener, but the test still
  passes. Read the output, and to prove a listener does not throw, capture
  `window` `error` events as `app/assets/ts/test/islands.tsx` does.
- Inside test files Vitest replaces `process.env.BASE_URL`, so the contract
  config passes the URL as `CONTRACT_BASE_URL`.
- `src/redis/redis-client.redis.spec.ts` has failed a socket-timing test
  intermittently; rerun before chasing it.

## Porting Python logic

- Text, URL and number logic must use `src/python/` (`str.ts`, `urllib.ts`,
  `numbers.ts`), not JavaScript built-ins: `\s`, `\w`, `\d`, `trim`,
  `encodeURIComponent`, `Number()` and `toFixed` all disagree with Python on
  some inputs. Each port has a spec reading a Python-recorded fixture.
- The fixtures record Python's Unicode 16.0; Node 24.21 ships 17.0. The
  code-point sweeps in `test/support/golden.ts` skip what Unicode 17 changed
  and fail if Node's Unicode is older than the fixtures'.
- `TextDecoder` and `Response.text()` strip a leading BOM; decode Redis bytes
  with `ignoreBOM: true`.
- Node joins repeated headers into one string; read `req.headersDistinct`
  for the first value.

## HTTP and routing

- Every `NestFactory.create` and `createNestApplication` call takes
  `HTTP_APP_OPTIONS` (`src/http-app.ts`), which disables Nest's global body
  parsers. A route that reads a body adds its own; the payment routes use
  `readRawBody` (`src/payments/raw-body.ts`, 1 MiB cap).
- Nest strips a trailing slash from route paths, so `@Get("mapping/")`
  matches `/mapping`. A route that tells `/x` from `/x/` takes `{/}` and
  checks `req.path`.
- `ClassifierPageController` matches every path with a non-empty first
  segment, so an unknown path answers the classifier 404. Nest registers
  controllers in import order: `AppModule` imports `ClassifierPageModule`
  last, and every new route must register before it.
- Errors render `{"detail": ...}` from the error's `detail`. To send a header
  with an error, set it on the response before throwing.
- Client identity lives in `src/usage/client-identity.ts`. `clientIp` trusts
  `CF-Connecting-IP`. `clientHost` is the first X-Forwarded-For entry, as
  uvicorn's proxy middleware had it; never read `req.socket.remoteAddress`,
  and never trust `clientHost` for anything a caller gains from.
- Crawler verification (`src/crawlers/google-crawlers.ts`) reads only
  `CF-Connecting-IP`, and only with `GOOGLE_CRAWLER_TRUST_CF_CONNECTING_IP`;
  without it no crawler is verified. It never falls back to the client host,
  which a caller controls.
- `src/config/app-config.ts` parses every environment variable; add new ones
  there instead of reading `process.env`. The app loads the root `.env` when
  present (a worktree has none: pass `node --env-file=<path>`). Node's `.env`
  grammar does not expand `${VAR}`.
- The Content-Security-Policy (`SECURITY_HEADERS` in `src/http/middleware.ts`)
  has no `'unsafe-inline'` for scripts. It allows the one inline script,
  `GTAG_SCRIPT` in `src/web/analytics.tsx`, by its SHA-256 hash, computed at
  startup. `test/pages.e2e-spec.ts` fails a page whose inline script the
  policy would block. Cloudflare's JavaScript detections inject an inline
  script that only a nonce or `'unsafe-inline'` allows, so with them on the
  browser blocks it and logs a CSP error.

## Caching

Cache headers come from the profiles in `src/http/cache-profiles.ts`; never
hand-roll them. Cloudflare caches HTML pages (`HTML_PAGE`) for an hour plus a
day stale, and result answers (`CLASSIFICATION_RESULT`) for a week.

- The server never sets a cookie on any response. A cookie would break the
  edge cache of pages and results; per-user state (the `cf_track` tracking
  id) is set by client-side JavaScript.
- Paywalls and every per-user or degraded answer use `NO_STORE`.
- `Cloudflare-CDN-Cache-Control` controls Cloudflare apart from
  `Cache-Control`. A response that may carry `Authorization` must say
  `public` there.
- Cloudflare caches `/api/results/*` only if a dashboard cache rule covers it.
- Asset `?v=` hashes are computed once per process (`src/web/asset-url.ts`);
  restart the server after `npm run build`.
- `app/static/sitemap.xml` is parsed at startup (`src/web/sitemap.ts`) and
  decides which query pages render results; editing it needs a restart.

## Classification

- **Queue.** `ClassificationQueue` admits one active and four waiting
  classifications per process (`QUEUE_CAPACITY`); the next gets
  `ClassificationQueueFull`, a 503. Cancelling a waiting job frees its slot.
  An aborted active job returns at once but keeps the slot until its work
  settles, so pass the `AbortSignal` to every abortable call and call
  `signal.throwIfAborted()` between stages. Qdrant calls cannot take a
  signal. Shutdown rejects waiting jobs and drains the active one.
- **Quota order.** A results API request runs crawler verification, Clerk
  caller resolution, a read-only `Quota.check`, request validation
  (`validateClassification`), queue admission, then in the turn
  `Quota.charge` and the pipeline. Over-quota callers get the paywall
  without a queue slot; racing requests can all pass the check, so the charge
  decides. Overflowed, cancelled and invalid requests (an unknown version, a
  refused query) are never charged. A query may hold any character except
  non-whitespace controls and lone surrogates. Keep network
  calls out of the charge, which holds the only turn: a Clerk key fetch can
  take 30 seconds.
- **Cacheable results.** `isCacheableClassification`
  (`src/classifier/classification-service.ts`) is the one rule for the
  results API and the sitemap store: rerank `applied` or `not_needed`, ID
  search `ok`, no failed enhancement, and at least one result. Anything else
  is shown with `NO_STORE` and no `Cache-Tag`.
- **Results API.** `GET /api/results/{TYPE}` (`ResultsApiController`,
  request handling in `results-delivery.ts`) answers the classifier island
  with a `ResultsResponse` (`src/web/results-api.ts`): `results` 200,
  `paywall` 402, `busy` 503 or `error`. HEAD answers 405 where GET would
  classify, so a probe never spends a turn. Build URLs with `resultsApiPath`,
  whose fixed parameter order gives one edge cache key per query.
- **Sitemap query pages** (`/UNSPSC/laptop_computer/`) render results for
  every visitor from `SitemapResultCache` in Redis. The key is
  `ssr-result:v2:{collection}:{topK}:{query}`, kept 30 days ±20%. It does not
  include the embedding or rerank model or their instructions: bump the
  version when you change those or the value shape. Only cacheable results
  are stored; the process remembers a failed or unstored result for 10
  minutes so an outage does not turn every crawler view into a free
  classification. These views charge no quota. A full queue is `overloaded`:
  a verified crawler gets 503 with `Retry-After`, a visitor a `NO_STORE`
  loading shell. Only genuine failures send `noindex`.
- **Code lookups.** IDs are matched through `original_id_normalized_key`, a
  keyword copy of the normalized ID with zeros stripped at both ends, so
  unrelated codes share a key and `exactIdSearch` pages the whole bucket.
  Only code-shaped queries (`isCodeShaped`: ASCII letters and digits between
  punctuation and spaces) are looked up. `partialIdSearch` ranks every match
  and fetches full payloads for the best 100.
- **ID normalization** (`src/qdrant/id-lookup.ts`) must keep producing
  Python's values, because the payloads in Qdrant hold them. Python
  casefolds (`ß` becomes `ss`).
- **Payload indexes.** Startup validates every configured collection
  read-only and fails on a missing index. Adding a field to
  `PAYLOAD_INDEX_FIELDS` therefore needs `apply` run against production
  before the deploy. Collection builders (the ignored `embedders/` tree)
  must write every field of `buildNormalizedIdPayload`.
- `HfEmbeddingClient` gives the hf-inference task-discovery GET the whole
  remaining outbound budget on purpose; keep that exception and its test.

## Frontend

Pages render with `renderToStaticMarkup`; interactive parts are islands.
`<Island name props>` (`src/web/islands/render-island.tsx`) renders a
component inside a host with `data-island`, `data-island-version` and
`data-island-props`. `app/assets/ts/site.tsx`, the one client entry,
hydrates every host whose name and version `ISLANDS`
(`src/web/islands/registry.ts`) knows.

- Cloudflare serves HTML up to a day old to browsers running the newest
  `site.js`. Bump an island's `version` on any props or markup change that
  old HTML would not hydrate under.
- The first render depends on props alone. Read the URL, storage or time in
  an effect.
- `site.js` is one file: the `check-bundle` plugin in `vite.config.ts` fails
  the build if it imports a chunk, which would have no `?v=`.
- `src/web/client-boundary.spec.ts` fails when `site.tsx` reaches a
  server-only module, a file the Dockerfile frontend stage does not copy, or
  a `.tsx` file Tailwind does not scan.
- Tailwind scans only `app/assets/ts` and `src/web` (`input.css`), comments
  and specs included: a word like `truncate` anywhere there adds a rule.
  Compare `styles.css` with `cmp` after a change to comments or tests. Markup
  in a new directory needs a `@source` line and a `COPY` in the frontend
  stage.
- `app/static/js/*.js` and `app/static/css/styles.css` are build outputs;
  never edit them.
- Islands reach the browser only through `useServices()`. Tests hydrate them
  with fakes (`app/assets/ts/test/islands.tsx`) and assert zero hydration
  errors first.
- `app/assets/ts/services/auth.ts` owns Clerk and injects its scripts.
  Islands read `useAuth()`; only the API client calls `authorization()`.
  Clerk refreshes its token itself.

The classifier island (`src/web/classifier/`):

- `classifier-machine.ts` and the nested `paywall-machine.ts` decide;
  `createInterpreter` in the island is the only code that runs their
  commands. Keep effects there.
- Form fields are uncontrolled: React would reset a prefilled textarea on
  hydration. `captureEdits` reports what a visitor typed before `site.js`
  ran.
- Every lookup goes through `ApiClient.results`. A description whose URL
  would exceed the server's URL guard (`fitsUrlLimit`) gets "too long"
  without a request.
- History entries live under `history.state.classifast`. A results entry
  replays with no request.
- Checkout recovery keeps its state in sessionStorage
  (`classifast:upgrade-intent`, `classifast:checkout-recovery`) and needs a
  signed-in visitor.

## Local browser checks

Production Clerk rejects localhost. On `127.0.0.1`, `Clerk.load` fails and
the header shows fallback `Sign In` links after about 1.5 s; those prove
nothing about sign-in. A signed-in flow needs a stand-in `window.Clerk`.
Pages also load Google Analytics, which may send traffic. Page links are
absolute, so match them by accessible name or pathname.

## Other gotchas

- `data/`, `embedders/` and `mapping/` are gitignored; ripgrep skips them
  silently. Ignore patterns for root-only directories must start with `/`: an
  unanchored `mapping/` once hid `src/mapping/` from git.
- Git rerere may stage an old conflict resolution. Inspect every conflicted
  file even without markers.
- The app assumes one Node process: the JWKS cache, asset versions, crawler
  ranges and queue are process-local.
- `/health` needs the embedding and Qdrant clients and probes Qdrant only.
  The app refuses to boot when Qdrant is unreachable or a collection fails
  validation.
- No test proves live Qdrant, Redis or Hugging Face connectivity.
- `src/auth/clerk.ts` refetches Clerk's JWKS for an unknown key at most once
  per 30 seconds, so a newly rotated key can be refused briefly. This is
  deliberate.
- Checkout is rate limited per IP with a Redis counter that fails closed
  (503); it needs Redis 7 for `EXPIRE NX`. Checkout grace is granted only by
  the signed Polar webhook.
- The Polar webhook (`src/payments/`) mirrors Python's `polar.v2026_10` SDK:
  it needs `api_version` and complete subscription fields, answers 403 to a
  bad signature and 400 to a malformed payload, and acknowledges unknown
  verified events without acting. `payments.json` holds 83 recorded cases.
- The Qdrant JS client pins an `undici` with advisories, so `package.json`
  overrides it. Drop the override once the client pins 7.30.1 or later.
- `src/rapidapi/` serves the RapidAPI endpoints. Leave it alone unless asked;
  `rapidapi-query.json` pins FastAPI's 422 bodies and lax `top_k` parsing.
