# AGENTS.md

The role of this file is to describe common mistakes and confusion points that agents might encounter as they work in this project. If you ever encounter something in this project that surprises you, please alert the developer working with you and indicate that this is the case in the AGENTS.md file to help prevent future agents from having the same issue.

## Testing

Always use `npm test` or `npm run test:watch` for TypeScript tests. `npm test`
runs three Vitest projects: `assets` (frontend, jsdom, `app/assets/ts`),
`server` (Nest unit specs in `src/`), and `redis` (`src/**/*.redis.spec.ts`
against a real Redis). Select one with `npx vitest run --project assets`.
Run the Nest e2e tests with `npm run test:e2e`. `npm run typecheck` checks both the root `tsconfig.json`
(Nest, `src/` and `test/`) and `app/assets/tsconfig.json` (frontend and the
Vite and Vitest configs).

The NestJS app in `src/` is what production runs. Start it with
`npm run start:dev`. The root `test/` directory holds the e2e specs, the
contract suite and the golden fixtures.

The app is a port of a FastAPI app, deleted after the cutover. "Python" in
this file and in `src/` comments means that app. The fixtures in
`test/fixtures/golden/` recorded its answers and are now frozen: the exporter
went with it. When you change behavior on purpose, edit the fixture's
expected values by hand or override the case in the spec, as `nestCase` in
`test/pages.e2e-spec.ts` does, and say why in the commit.

The Nest app listens on `HOST` and `PORT` (default `0.0.0.0:8001`). Like Python's
`load_dotenv()`, it loads the repository-root `.env` when the file exists, and
variables already in the environment win. A worktree has no `.env`, so pass
`node --env-file=<path> dist/main.js` there. Node's `.env` grammar differs
from python-dotenv: it does not expand `${VAR}`, and it treats `#` as a
comment start in more places. On 2026-10-08 every key in the local `.env`
parsed the same under both. Production is unaffected, because the image has
no `.env` and Coolify or compose supplies the variables.
`src/config/app-config.ts` parses every variable the app reads; add new
variables to that schema instead of reading `process.env` elsewhere.
`Dockerfile` builds the image that production runs.

The `redis` project's globalSetup starts Redis 7.4.2 through
`redis-memory-server`. Because `.npmrc` sets `ignore-scripts=true`, the first
run in a checkout downloads the source from download.redis.io and compiles it
with `make`, then caches it in
`node_modules/.cache/redis-memory-server`. All Redis specs share that one
server: isolate a spec with unique ids in its keys (`uniqueId` in
`test/support/redis.ts`), and never flush the database. Quota and rate-limit
specs must not mock Redis; MULTI, `EXPIRE NX` and `SET EX NX` are the behavior
under test.

node-redis waits forever by default: `connect()` retries until it succeeds and
commands queue while the client is disconnected. Its command `timeout` stops
counting once a command is written, and its `socketTimeout` is an idle
timeout, so neither fails a command that a hung Redis never answers.
Reconnecting a node-redis client in place is also unsafe: the replacement
`connect()` has no deadline, `multi().exec()` queues during it despite
`disableOfflineQueue`, overlapping reconnects leave two live sockets, and a
`destroy()` during TCP setup does not stop the socket from being installed.
Never call `connect()` on a used client. Use `RedisConnection` in
`src/redis/redis-client.ts`: run every command through `run()`, which applies
redis-py's five-second `socket_timeout` and drops a client that times out or
breaks. The next call makes a new client with one bounded connect attempt.
`close()` destroys an in-flight attempt and bounds shutdown to five seconds.

`TextDecoder` and `Response.text()` strip a leading UTF-8 BOM; Python's
`.decode()` keeps it. Decode Redis bytes with `ignoreBOM: true` (a cached tier
of `\ufeffpro` is not Pro in Python). `httpx`'s `response.json()` parses bytes
and does strip a leading body BOM, so `Response.text()` matches it there.

Python's `check_usage` and `reserve_usage` each call
`get_or_create_tracking_id`. A request without a valid `cf_track` cookie
therefore reads one random tracking key and charges another; only the IP
counter limits it. The TypeScript `Quota` resolves the tracking id once per
request. The IP counter decides the same outcome either way.

Node joins repeated request headers such as `CF-Connecting-IP` into one
comma-separated string, while Starlette's `headers.get` returns the first
value. Read `req.headersDistinct`, not `req.headers`, to read the first value
as Python does; `clientIp` in `src/usage/client-identity.ts` does.

Production ran uvicorn with `--forwarded-allow-ips "*"`, so Python's
`request.client.host` was the first X-Forwarded-For entry. The TCP peer counts
only when that entry has no host. Behind Coolify's proxy the peer is the
proxy. For the client host, such as in crawler verification, call
`clientHost` in `src/usage/client-identity.ts`; never read
`req.socket.remoteAddress`. `proxy-client.json` recorded uvicorn's
`ProxyHeadersMiddleware`.

The Qdrant JS client requests `GET /` to check the server version when it is
constructed, and logs a warning when that fails. Fake Qdrant servers in tests
must answer `GET /` with a compatible `version` to keep the output clean.

Like Python's startup, Nest boot runs the read-only Qdrant schema check
(`QdrantModule`) and fails when Qdrant is unreachable or any configured
collection breaks the contract. A Nest e2e test that boots `AppModule` needs a
fake Qdrant that serves every configured collection: use `startQdrantServer`
with `validCollections` from `test/support/qdrant-server.ts`. Pipeline Qdrant
calls do not take the queue's `AbortSignal`, because the JS client has no
per-call signal, so a Qdrant stage runs to completion after cancellation.

The repository has no `tsx`. To run a one-off script against the Nest code,
build with `npx nest build` and import the compiled modules from `dist/`.

`npm run test:contract` runs the HTTP contract suite in `test/contract/`
against the server at `BASE_URL`, which is required. `npm test` does not run
it. The suite refuses a `BASE_URL` host other than `localhost`, `127.0.0.0/8`,
or `::1`, because its checkout probes increment Redis rate-limit counters and
full mode charges quota and runs live classifications. Set
`CONTRACT_ALLOW_NON_LOOPBACK=1` to target another host deliberately.
`npm run test:contract:nest` launches a public-mode instance through the
verify driver in a temporary run directory, runs the suite, stops the
instance, and exits with the suite's code. Its arguments go to
`control.mjs launch`, such as `--env-file <path>`. Both modes require
`DEBUG_MODE=false`. Set
`CONTRACT_MODE=full` only against a server with Qdrant, Redis, and
embeddings. Full mode has not been verified against configured live
dependencies. A full-mode case that needs more server configuration runs only
when a variable declares that the server has it, and otherwise reports the
missing variable as its skip reason:

- `CONTRACT_RAPIDAPI_SECRET` holds the server's `RAPIDAPI_SECRET`. It enables
  the RapidAPI 401 and JSON cases.
- `CONTRACT_POLAR_WEBHOOK_SECRET` holds the server's `POLAR_WEBHOOK_SECRET`.
  It enables the unsigned and signed webhook cases.
- `CONTRACT_POLAR_PRO_PRODUCT_ID` holds the server's `POLAR_PRO_PRODUCT_ID`.
  It enables the signed event for another product, which the server answers
  with 500 when it has no Pro product.
- `CONTRACT_NO_OPENROUTER_KEY=1` declares a server without
  `OPENROUTER_API_KEY`. It enables the failed query enhancement case. That
  server has no enhancer, so every enhanced lookup fails without calling
  OpenRouter. No request makes a configured enhancer fail deterministically.
- `CONTRACT_ANON_LIMIT` and `CONTRACT_CHECKOUT_RATE_LIMIT` default to 10 and
  must equal the server's `ANON_LIMIT` and `CHECKOUT_RATE_LIMIT`.

Polar's Python SDK accepts both raw UTF-8 secrets and base64-decoded Standard
Webhooks keys. Canonical fixtures decode base64 secrets after removing the
optional `whsec_` prefix. Non-base64 legacy secrets use UTF-8 bytes. A separate
fixture covers raw-key compatibility.

Two properties stay outside the suite because HTTP cannot observe them. The
queue overflow case checks that at least five lookups in a burst succeed and
that any refusal is the queue-full 503, but staggered admission can hide both
the capacity and the refusal; `ClassificationQueue`'s specs pin them. The
signed non-Pro webhook carries no user, so it cannot show that a missing
product filter would grant Pro.

Some cases pin decisions where Nest departed from Python. FastAPI's `/docs`,
`/redoc`, `/openapi.json` and `/llms.txt` answer 404 (`retiredRoutes`).
HEAD on a GET-only route answers like GET with an empty body; Python sent it
to the classifier catch-all. `.gif` and `.webmanifest` static files are
`STATIC_MEDIA`, where Python served them as `STATIC_TEXT`. The public-mode
RapidAPI ping expects `database: "healthy"`, because Nest refuses to boot
without Qdrant. A GET of a sitemap query page such as `/UNSPSC/laptop_computer/` expects
`NO_STORE` and `noindex, nofollow` in public mode, because Nest tries to
render its results and cannot classify there. In full mode it expects
`HTML_PAGE` with `Cache-Tag: sitemap-results`, and two GETs must render the
same results and "Finished in" time. With `CONTRACT_NO_OPENROUTER_KEY=1` the
results are degraded, so the full-mode GET expects `NO_STORE`,
`index, follow` and no `Cache-Tag`, and the two-GET case skips; the
full-mode result fragments expect `NO_STORE` too. HEAD on a
sitemap query page never classifies and answers `HTML_PAGE` without a
`Cache-Tag`; that is accepted.

Inside test files Vitest replaces `process.env.BASE_URL` with Vite's base
path, so the config passes the URL on as `CONTRACT_BASE_URL`.

The public-mode cases expect a server without `POLAR_WEBHOOK_SECRET`,
`RAPIDAPI_SECRET`, or Redis. The verify driver's public mode
(`.agents/skills/verify/scripts/control.mjs`) sets every credential to an
empty value, which the app treats as absent, and points Redis at the
unreachable `127.0.0.1:1`. The cases therefore hold even when an env file
supplies those keys. Public mode also starts a detached fake Qdrant;
`instance.json` records it with the server, and `cleanup` stops both. The
driver starts the app with `NODE_ENV=production` and
`--max-http-header-size=65536`, as `Dockerfile` does. React's development
build is not what production renders, and Node's default 16 KiB header limit
answers 431 to requests uvicorn accepted.

Starlette's `add_vary_header` appends without deduplicating, so Python sent
`Vary: Accept-Encoding, Accept-Encoding` on gzipped static files. The Nest
port matches it; compare `Vary` as a token set.

The Nest app is created with `bodyParser: false` (`HTTP_APP_OPTIONS` in
`src/http-app.ts`). Nest's global parsers run before routing, so a malformed
or oversized JSON body sent to `/robots.txt` answered 400 or 413 where Python
answers 405. A route that reads a body, such as the checkout JSON or the raw
Polar webhook body, must add its own parser. Pass `HTTP_APP_OPTIONS` to every
`NestFactory.create` and `createNestApplication` call. The payment routes read
the raw stream with `readRawBody` (`src/payments/raw-body.ts`), capped at
1 MiB with 413; Starlette has no cap.

The exception filter renders `{"detail": ...}` from an error's `detail`.
`HttpStatusError` exposes its message as `detail`; before that, unit 6's
errors (rate limit, Clerk, quota) rendered only the reason phrase.

The Polar webhook port (`src/payments/`) mirrors Python's `polar.v2026_10`
SDK module, not just the FastAPI route. The SDK decodes the body as UTF-8 before it checks the
signature, so an unsigned non-UTF-8 body gets 400, not 403. The SDK drops
payload keys that `Subscription` does not declare. Python's product-id probes
of `items`, `products`, `subscriptions`, and `order_items` therefore never see
data; only `product_id`, `product.id`, `prices`, and the metadata keys count.
The zod schema checks nested objects only as far as the fields it reads, and
known non-subscription events only by envelope. Python rejects deeper schema
errors in those with 400. `test/fixtures/golden/payments.json` holds 83
webhook requests and the FastAPI route's answers. Python's payment routes
sent no cache headers; the Nest routes send `NO_STORE` on every answer.

Nest answers `If-None-Match: *` on `/favicon.ico`, `/robots.txt`, and
`/sitemap.xml` with 304, as `/static` files do. Python's `FileResponse`
routes ignored the header and answered 200. HTTP allows both.

Fresh checkouts may lack `node_modules` and the generated frontend assets
because they are ignored. Run `npm ci` before tests or builds. The
verification driver (`.agents/skills/verify/`) and the contract suite's
static and DOM cases need `npm run build`, and the driver also needs
`npm run build:server`.

The scripts in `utilities/` are offline Python tools. Install
`utilities/requirements.txt` into a virtualenv to run them. The
`utilities/test_*.py` files are manual live or debug helpers, not a test
suite. The ignored `embedders/` tree holds separate experiments.

HTTP e2e tests that import `AppModule` need a fake Qdrant server with valid
schemas for every configured collection, because startup validates them.
Use `test/support/qdrant-server.ts` and clear inherited Qdrant and
embedding-dimension configuration.

The pages in `src/web/` are React components that ported the Jinja
templates. `test/pages.e2e-spec.ts` compares each page, redirect and error
with responses recorded from the FastAPI app in
`test/fixtures/golden/pages.json` and `pages/*.html`, which the exporter
rendered without the app's lifespan and with a fixed date. Compare HTML with
`test/support/html-normalizer.ts`, which accounts for these React 19
behaviors:

- React moves `<title>`, `<meta>`, non-stylesheet `<link>` and async
  `<script src>` to the start of `<head>`, so the normalizer compares those
  as a set.
- React adds `<link rel="preload" as="image">` for each `<img>`.
- JSX drops a line break between an inline element and its neighbour. Write
  `{" "}` where the template had whitespace between inline elements; the
  normalizer reports the missing space.

Nest removes a trailing slash from every route path, so `@Get("mapping/")`
matches `/mapping`. Routes that tell `/x` from `/x/` take an optional slash
(`@Get("mapping{/}")`) and check `req.path` in the handler.

`ClassifierPageController` (`src/web/classifier-page.module.ts`) ports
Python's `/{classifier_type}` routes and matches every path with a non-empty
first segment, so `/no-such-page` answers the classifier 404
(`Type 'no-such-page' not found`), as in Python. Nest registers controllers in
module import order: `AppModule` imports `ClassifierPageModule` last, and any
new route, including `/{classifier_type}/fragment`, must register before it.
The handler reads the decoded path itself instead of Express params.
Python rebuilds its redirect from the decoded URL, so an encoded `?` or `#`
in a classifier slug splits the path there: `/UNSPSC/a%3Fb/` redirects to
`/UNSPSC/ab/?b/`, and `/UNSPSC/a%23b/?x=1` loses its query. Nest keeps the
request's own query string. This is a decided divergence.

Classifier page parity cases use a recording fake classification service and
a crawler switch: `test/pages.e2e-spec.ts` overrides `ClassificationService`
and `GoogleCrawlerVerifier`, as the exporter patched the FastAPI app. Five
base pages keep full HTML; the other cases keep only selected element groups
(`body.kind == "regions"`, stored once in the fixture's `regions` table),
which `test/support/page-regions.ts` selects.

Nest renders a sitemap query page's results for every visitor; Python
renders them only for a verified Google crawler. This is a decided
divergence (plan unit 12). `nestCase` in `test/pages.e2e-spec.ts` rewrites
the golden visitor cases for those pages from the crawler case at the same
path. The results come from
`SitemapResultCache` (`src/classifier/sitemap-result-cache.ts`) in Redis:

- The key is `ssr-result:v1:{collectionName}:{topK}:{query}`, with the
  whitespace-collapsed query. The value is JSON
  `{results, versionName, query, elapsedSeconds, computedAt}`, parsed with
  zod on read. A malformed value or a Redis error is a miss.
- The TTL is 30 days, plus or minus 20%. Never flush these keys. The key
  does not include the embedding model or the rerank and query
  instructions, so bump `v1` after changing them or the value shape; the
  old keys expire by TTL.
- Only complete results are stored: `rerank` is `applied` or `not_needed`,
  `idSearch` is `ok`, and at least one result was found
  (`isCacheableClassification`, which the fragment also uses). An incomplete
  result still renders, but with `NO_STORE` on both cache headers, no
  `Cache-Tag`, and `index, follow`, so neither Redis nor Cloudflare keeps
  it.
- The process remembers an incomplete result, and a complete one that Redis
  could not store, for 10 minutes (at most 2,000 keys). A view in that window
  does not classify. Without this, an OpenRouter or Redis outage would make
  every crawler view a free classification that fills the queue paying
  fragment users share. A remembered result keeps the headers of its first
  view.
- A miss runs one fill per key through `ClassificationQueue`. No signal
  cancels a fill: a visitor who leaves does not stop it, and at shutdown the
  queue rejects waiting fills and lets the active one finish and store.
  Waiters get the result when it is classified, not when the Redis write
  settles; the key stays claimed until then.
- A full queue or a queue closed for shutdown is `overloaded`, not a
  failure: a verified crawler gets 503 with `Retry-After` and a visitor a
  200 `NO_STORE` loading shell. Only genuine failures send `noindex`.
- These views charge no quota. The page verifies a crawler only when the
  queue is full or closed, the one case where a crawler gets a different
  answer. The base `/{TYPE}/` page follows the same rule. It never uses the
  result cache, but Cloudflare still caches it as `HTML_PAGE`.
- A page rendered from complete results sends `Cache-Tag: sitemap-results`,
  so a Cloudflare purge by tag drops every such page.
- A stored result keeps the "Finished in" time of the classification that
  filled it, so every view of the page shows the same time. This is a
  decided choice.

`test/pages.e2e-spec.ts` replaces the store with an in-memory map
(`SITEMAP_RESULT_STORE`) and clears it before each parity case.

`FragmentController` registers before `ClassifierPageController` in the same
module with the pattern `:classifierType/:leaf`; it checks the decoded path
for `/{type}/fragment` and calls `next()` for every other two-segment path.
HEAD answers like GET there for validation errors and empty descriptions, but
answers 405 `Allow: GET` where GET would classify, so a probe never takes a
queue turn or charges quota. Python sent HEAD to the classifier page (301).
Fragment parity cases (`body.kind == "fragment"`) also fake `Quota` and
record an `events` list (crawler, caller, check, classify, charge) that pins
the order of quota checks and queue admission.

React 19 hoists a `<title>` to the front of markup rendered without
`<html>`, so the fragment's out-of-band `<title>` is appended as a string
escaped by `jinjaEscape`. Python's fragment never sets `results_loaded`, so a
classification with no results renders `Loading...`; the port copies that.

A result fragment sends `NO_STORE` on both cache headers, instead of
`CLASSIFICATION_RESULT` (a week at Cloudflare), when its classification is
not cacheable: the rerank `failed` or was `skipped`, an ID search `failed`,
the requested enhancement `failed`, or the list is empty. It still renders
the results and keeps `Cache-Tag` and `HX-Push-Url`. Python cached every
result fragment except a failed enhancement.
An empty list is not a genuine answer: the semantic search has no filter or
score threshold, so it returns nothing only for an empty collection, such as
one being rebuilt. `isCacheableClassification` in
`src/classifier/classification-service.ts` is the one rule for the fragment
and the sitemap result store. The parity case with `classify: "empty"`
expects `NO_STORE` through `nestCase`.

Git rerere may automatically stage an old conflict resolution. Inspect every
conflicted file even when no conflict markers remain.

jsdom prints an exception thrown inside an event listener, but the test still
passes and `npm test` exits 0. Read the test output as well as the exit status.
To prove a listener does not throw, capture `window` `error` events in the test,
as `common.test.ts` does for `ResultCopier`.

`utilities/qdrant_config.py` is an executable migration-style script, not passive configuration. Importing or running it updates a hardcoded Qdrant collection, so review it carefully before execution.

`npm run qdrant:indexes -- check` is read-only.
`npm run qdrant:indexes -- apply` is a migration-style command that
backfills payloads and creates or replaces indexes in configured Qdrant
collections. Runtime startup must validate Qdrant without creating, replacing,
or deleting indexes. The CLI lives in `src/cli/sync-payload-indexes.ts`; the
Python `utilities/sync_payload_indexes.py` no longer exists.

The ID normalization in `src/qdrant/id-lookup.ts` must keep producing what
Python's did, because the payloads already in Qdrant hold Python's values
and the runtime looks IDs up with the same function that `apply` writes.
Python casefolds, so `ß` becomes `ss`; JavaScript's `toLowerCase` does not.
The fixture covers every code point that Python folds to ASCII.
Python normalizes `str()` of any `original_id` payload value.
`originalIdLookupText` converts only the JSON values whose `String()` matches
it after normalization, and `apply` fails on the rest, including `0`, because
`JSON.parse` reads Python's `0.0` as `0`.

Ports of Python text, URL and number logic must use `src/python/` (`str.ts`,
`urllib.ts`, `numbers.ts`) instead of JavaScript built-ins. JavaScript's `\s`,
`\w`, `\d`, `trim`, `encodeURIComponent`, `Number()` and `toFixed` all
disagree with Python on some inputs. Each ported function has a spec that
reads a fixture recorded from Python, one file per area. Parity with
Python holds only where Node and Python implement the same Unicode version.
The fixtures record Python's Unicode 16.0, while Node 24.21 (the `node:24`
line in `Dockerfile`, verified locally) and Node 26 ship Unicode 17.0
(ICU 78). Code-point sweeps (`test/support/golden.ts`) therefore skip the
code points unassigned in the fixtures' version, plus the assigned ones whose
general category or case mapping Node's newer data changed (U+0295, U+A7D3
and U+A7D5 at Unicode 17). They fail if Node's Unicode is older than the
fixtures' or any other code point differs. Two Python quirks surprised the port. In
`URLEncodingValidationMiddleware`, `(\d{2,4})\1{15,}` refers back to the
`(%25)` group and never matches; a verbatim JavaScript copy rejects any URL
with two adjacent digits. `QueryNormalizationMiddleware` answers 500 when the
redirect would carry a non-Latin-1 path or the raw query bytes are not UTF-8,
and its `Location` holds the percent-decoded path. Ignore patterns for
root-only directories must start with `/`. An unanchored `mapping/` once kept
`src/mapping/` out of git without a warning.

## Project Snapshot

Classifast is a classification service web application that uses embeddings and vector search (Qdrant) to classify any text input (mostly product descriptions) into categories of various industry standard classifications, like UNSPSC, NAICS, CN/HS codes, ISIC, ETIM, CPV, etc.

## Tech Stack

- Backend: NestJS (`src/`), built by `Dockerfile`. `app/` holds only the
  frontend sources (`app/assets`) and the static files (`app/static`).
- Offline tools: Python scripts in `utilities/`.
- Frontend: TypeScript with Tailwind CSS (built with Node/npm and Vite, served by the backend)
- Infrastructure: Redis (usage tracking), Qdrant (vector database), Hugging Face Inference (embeddings), OpenRouter (deployed-service reranking and opt-in query enhancement), Clerk (authentication), Polar (payments)

## Hardware, Deployment, Cache

Self-hosted from Raspberry Pi 4 (4GB) via Coolify behind Cloudflare Tunnel (Full HTTPS/TLS Setup for All Resources). Coolify builds `./Dockerfile` with its Dockerfile build pack, not `docker-compose.yaml`. The app uses Cloudflare's CDN edge caching to reduce API costs and improve performance. Classification results are cached at edge for 7 days.

## When Modifying Cache Behaviour

Cache headers are defined in `src/http/cache-profiles.ts` - edit the profiles there instead of hand-rolling headers.

- Never add `Set-Cookie` to fragment responses - breaks CDN caching
- Paywalls must use `no-store` - prevents serving cached paywall to allowed users
- Never set cookies on full pages either - the server has a blanket no-cookie
  policy; set per-user state from client-side JavaScript instead
- Generate per-user state client-side when possible (e.g., tracking IDs via `crypto.randomUUID()`) instead of server-side templating - keeps HTML cacheable across all users
- `Cloudflare-CDN-Cache-Control` controls Cloudflare independently of browser
  `Cache-Control`. Responses that may be requested with `Authorization` must
  explicitly include `public` (or another authorization-compatible shared-cache
  directive) in the Cloudflare-specific header.

## Built Frontend Files

The root `.dockerignore` pattern `*.csv` excludes root-level CSVs only.
The nested public samples in `app/static/mapping_samples/` remain in the Docker
build context and are copied by `Dockerfile`. Check Docker's context
archive before assuming an ignore pattern excludes a nested asset.

`app/static/js/*.js` and `app/static/css/styles.css` are Vite build outputs
from `app/assets/ts/` and `app/assets/css/`. Never hand-edit them; edit the TS
sources and run `npm run build`.

`app/assets/css/input.css` limits Tailwind's class scan to `app/assets/ts` and
`src/web`, the only markup the Docker frontend stage copies. Local and Docker
builds therefore produce the same `styles.css`. A Tailwind class written
anywhere else in `src/` is not generated. When markup moves to a new
directory, add a `@source` line for it and a `COPY` to the frontend stage.

## Islands

Pages stay `renderToStaticMarkup`; their interactive parts are React islands.
`<Island name props>` (`src/web/islands/render-island.tsx`) renders the
component as its own `renderToString` root inside a host element with
`data-island`, `data-island-version` and `data-island-props`. The one client
entry, `app/assets/ts/site.tsx`, hydrates every host whose name and version
`ISLANDS` (`src/web/islands/registry.ts`) knows. Islands reach the browser only
through `useServices()`; tests hydrate them with fakes
(`app/assets/ts/test/islands.tsx`) and assert zero hydration errors first.

- Cloudflare serves HTML about a day old to browsers that load the newest
  `site.js`. Bump an island's `version` on any props or markup change that
  old HTML would not hydrate under; the old host then stays static.
- The first render must depend on props alone. Read the URL, storage or time
  in an effect, never during render.
- `site.js` is one file. The `check-bundle` plugin in `vite.config.ts` fails
  the build if it imports anything, because a chunk would have no `?v=`.
- `vite.legacy.config.ts` builds `common.js`, `classifier.js`, `paywall.js`
  and `storefront.js` byte for byte as before, for cached pre-island HTML.
  `npm run build` runs both configs.
- `src/web/client-boundary.spec.ts` walks the imports from `site.tsx` and
  fails on server-only modules (`asset-url.ts`, `src/python/urllib.ts`,
  Nest), on files the Dockerfile frontend stage does not copy, and on `.tsx`
  files Tailwind does not scan.
- Golden page fixtures stay frozen. `test/support/page-divergences.ts` lists
  each deliberate markup change as a named edit of the expected page.

## Rapid API

`src/rapidapi/` serves the `/api/v1/rapid/` endpoints for the Rapid API
platform. Ignore it unless explicitly asked to work on Rapid API service
integration.

`rapidapi-query.json` recorded the FastAPI router, so it pins FastAPI's 422
bodies and pydantic's lax `top_k` parsing: `3.0`, `1_0` and `3` padded with
any Unicode `White_Space` are accepted, while `3.`, `1e1`, a zero-width space
and fullwidth digits are rejected.
`classifier-config.json` pins the display and link fields of the classifier
table in `src/classifier/classifier-config.ts`. `FastApiErrorFilter` writes
only the status and the `detail` body. To send a header with an error, such as
`WWW-Authenticate` or the no-store profile, set it on the response before
throwing. The canonical-query middleware answers 308 to `?query=%20a` before
the route strips the value. The app cannot boot without
Qdrant, so `/ping` reports the database as `healthy` or `unhealthy` and never
as `unavailable`.

## Gotchas and Non-Obvious Behaviors

- `HfEmbeddingClient` deliberately gives a budgeted hf-inference task-discovery
  GET the entire remaining outbound budget, even when the configured embedding
  timeout is shorter. Provider-mapping GETs and embedding POSTs use the smaller
  limit. Keep the task-discovery timeout exception and its regression test.
- `src/auth/clerk.ts` refetches Clerk's JWKS for an unknown key ID at most
  once per 30 seconds after a successful fetch, as PyJWT 2.14 and later do,
  to prevent unauthenticated JWKS request amplification. The owner adopted
  this cooldown, including brief rejection of newly rotated keys.
  `src/auth/clerk.spec.ts` covers rotation and cached-key reuse.
- The `polar.v2026_10` webhook schema requires `api_version` and complete
  subscription fields even when their values are null. Check the dashboard
  endpoint version when migrating older webhook payloads.
  Invalid signatures return 403. Verified unknown event types are acknowledged
  without changing entitlements; malformed webhook payloads return 400.
- `data/`, `embedders/`, and `mapping/` are gitignored and may be absent from
  a checkout. Ripgrep silently returns zero hits inside them because it
  respects `.gitignore`; use `--no-ignore` or explicit paths.
- `groupOriginalIdTokens` accepts a narrower parsed-scalar domain than Python's
  object helper: strings, null, booleans, safe integers and ordinary fractions
  with absolute values in [1e-4, 1e16). Other types and numbers throw.
  Parsed integral numbers mean integer IDs; JSON parsing cannot recover the
  distinction between `12` and `12.0`, or `0` and `0.0`. Preserve source numeric
  metadata or Python display text if a future decoder needs that distinction.
- `loadSitemapQueryPaths` (`src/web/sitemap.ts`) parses
  `app/static/sitemap.xml` at startup to build `SITEMAP_QUERY_PATHS`, which
  gates SSR eligibility and homepage anchor links. Editing the sitemap only
  changes app behavior after a restart.
- Asset `?v=` hashes are cached per process (`src/web/asset-url.ts`). After
  `npm run build`, restart the server or the browser keeps loading the old
  JS with stale `?v=` values.
- The server never sets cookies on any response, cacheable or not. `cf_track`
  is set by client-side JavaScript. On HTML or fragment routes a server-side
  cookie additionally breaks the `HTML_PAGE`/`CLASSIFICATION_RESULT` CDN cache
  profiles; on other routes it is still forbidden by design, so use
  client-side JavaScript for any per-user state.
- Two client-IP trust policies coexist: `clientIp` in
  `src/usage/client-identity.ts` always trusts `CF-Connecting-IP`;
  `src/crawlers/google-crawlers.ts` requires the explicit
  `GOOGLE_CRAWLER_TRUST_CF_CONNECTING_IP` opt-in. Pick one policy deliberately
  for new IP-dependent code.
- `paywall.ts` is wrapped in a parse guard on purpose (class declarations
  re-execute on bfcache/history-restore re-parsing). Do not remove the guard.
- System classification retries must use `requestCurrentClassifierSubmission`
  so the current classifier owner can submit a remembered example after the
  required textarea clears. Native `requestSubmit` stops at validation before
  HTMX can supply the query; mocked `requestSubmit` hides this failure.
- HTMX 4's submit handler does not check `defaultPrevented`. The auth-readiness
  gate must capture submission and stop immediate propagation until auth is ready,
  even when HTMX processed the form before the classifier mounted.
- Vendored HTMX tests in jsdom need an explicit XPath result type, `CSS.escape`,
  and `includeIndicatorCSS: false`. `paywall-retry.test.ts` supplies these while
  retaining native form validation and recording final request parameters.
- HTMX 4 history restore preserves `document.body` and replaces its children.
  Initialize restored controls after the BODY `htmx:after:swap` with
  `HX-History-Restore-Request`, and retire handlers for the previous form.
  Restored result autoload must use `push_url=false` to preserve Forward.
- `common.ts` can load through both a versioned template URL and the classifier's
  unversioned module import. Both instances must share one document owner for
  Clerk bootstrap, token refresh, and global handlers.
- `htmx.min.js` is vendored in `app/static` and must use `asset_url` like the
  application scripts. An unversioned URL can pair cached HTMX with incompatible
  event handlers after an upgrade. `emptyOutDir: false` in `vite.config.ts`
  protects it from build cleanup.
- The app assumes a single Node process. The JWKS client, asset versions,
  crawler IP ranges, and the classification queue capacity are all
  process-local. Scaling workers changes their semantics.
- No test proves deployed Qdrant, Redis, or Hugging Face connectivity. The
  e2e specs use fakes, and the contract suite's full mode has not run
  against live dependencies. Manual live helpers live in
  `utilities/test_*.py`.
- `/health` requires initialized embedding and Qdrant clients, then probes
  Qdrant only. If `HF_TOKEN` is missing, public pages can still serve while
  `/health` returns 503, provided Qdrant startup succeeds. It does not check
  Redis or live Hugging Face requests. A Qdrant startup failure stops the app.
- `.env` is a personal cross-project secrets file (it contains keys unrelated
  to classifast too). Never print, copy, or commit it.
- Checkout endpoints are rate limited per IP via
  `src/rate-limit/checkout-rate-limit.ts`
  (fixed-window Redis counter, fails closed with 503). Checkout grace
  (`checkout_grace:*` in Redis) is activated only by the signature-verified
  Polar webhook; the success URL carries no token and grants nothing.
- The homepage and classifier pages load production Clerk scripts and
  Google Analytics. Production Clerk rejects localhost, while analytics may
  still send traffic. The UI can render a fallback `Sign In` link when Clerk
  fails; that link does not prove authentication works. Use a Clerk test
  configuration that accepts the local origin to verify sign-in.
  On localhost the page renders the signed-out Clerk buttons rather than the
  fallback links, and their Sign In opens an empty Clerk modal backdrop. To see
  the fallback locally, block the `clerk.browser.js` request.
- Page links render as absolute URLs with the request origin, as the
  templates' `url_for` did.
  Browser checks should use accessible names or inspect the URL pathname,
  rather than match an exact relative `href`.
- Checkout rate limiting requires Redis 7+ for `EXPIRE NX`. Queue `INCR` and
  `EXPIRE NX` in one transactional pipeline. This assigns missing TTLs, including
  on stranded counters, while preserving existing deadlines. Redis errors must
  still return 503, and counters above the allowance must still return 429.
- Tier-cache lookup fills use `SET EX NX` and reread the winning value.
  Webhook tier updates use authoritative `SETEX`; a lookup completing afterward
  must preserve and return that tier. Upgrade and downgrade overlap tests also
  verify quota behavior without checkout grace.
- `ClassificationQueue` (`src/classifier/classification-queue.ts`) holds one
  turn per complete classification, query enhancement included. Each process
  admits one active and four waiting classifications (`QUEUE_CAPACITY`). The
  next request fails with `ClassificationQueueFull`. The
  fragment and RapidAPI routes log a warning and return 503 with `no-store`.
  An overloaded SSR page falls back to client-side loading with `no-store`
  but stays indexable. Verified Google crawlers get that page as a 503 with
  `Retry-After` instead. Only genuine SSR failures send `noindex`, because
  Google drops a 200 page marked `noindex` but retries a 503.
- A fragment request runs crawler verification, Clerk caller resolution, a
  read-only quota check (`Quota.check`), queue admission, the turn, the quota
  charge (`Quota.charge`), and the pipeline. Over-quota callers get the
  paywall without a queue slot. Racing requests can all pass the check, so
  the charge decides. Overflowed and cancelled waiting requests are never
  charged. Keep networked checks out of the charge, which holds the only
  turn. A Clerk key fetch can take 30 seconds.
- Cancelling a waiting classification frees its slot without running it.
  `ClassificationQueue` cancels through an `AbortSignal` and cannot see stage
  boundaries. An aborted active job returns immediately but keeps its slot
  until the promise returned by `work` settles. Pass the signal to every
  abortable call, such as `fetch`, and call `signal.throwIfAborted()` between
  stages; a stage that ignores the signal holds the slot until it finishes.
  Shutdown rejects waiting jobs and drains the active one before shared
  clients close. Waiting jobs rejected at shutdown and `run` calls made after
  shutdown begins both fail with `ClassificationQueueClosed`.
- Checkout recovery retries two seconds after each completed request and has a
  60-second deadline. An input or change inside the form cancels recovery,
  switches to the existing manual-retry message, and enables Try again.
  Keep displayed status consistent with whether automatic checks are running;
  update only the recovery status paragraph, preserving a fresh ordinary paywall.
  Successful recovery must leave results visible without recreating a warning.
