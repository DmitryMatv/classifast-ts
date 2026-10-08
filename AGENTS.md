# AGENTS.md

The role of this file is to describe common mistakes and confusion points that agents might encounter as they work in this project. If you ever encounter something in this project that surprises you, please alert the developer working with you and indicate that this is the case in the AGENTS.md file to help prevent future agents from having the same issue.

## Testing

Always use `npm test` or `npm run test:watch` for TypeScript tests. `npm test`
runs two Vitest projects: `assets` (frontend, jsdom, `app/assets/ts`) and
`server` (Nest unit specs in `src/`). Select one with
`npx vitest run --project assets`. Run the Nest e2e tests with
`npm run test:e2e`. `npm run typecheck` checks both the root `tsconfig.json`
(Nest, `src/` and `test/`) and `app/assets/tsconfig.json` (frontend and the
Vite and Vitest configs).

The NestJS app in `src/` is an early migration scaffold. Start it with
`npm run start:dev`. It does not serve the site yet; production still runs the
FastAPI app. The root `test/` directory holds Nest e2e specs for Vitest; the
Python suite lives in `tests/`.

`npm run test:contract` runs the HTTP contract suite in `test/contract/`
against the server at `BASE_URL`, which is required. `npm test` does not run
it. The suite refuses a `BASE_URL` host other than `localhost`, `127.0.0.0/8`,
or `::1`, because its checkout probes increment Redis rate-limit counters and
full mode charges quota and runs live classifications. Set
`CONTRACT_ALLOW_NON_LOOPBACK=1` to target another host deliberately. Point it
at a public-mode Python instance from the verify driver. Set
`CONTRACT_MODE=full` only against a server with Qdrant, Redis, and
embeddings. A full-mode case that needs more server configuration runs only
when a variable declares that the server has it, and otherwise reports the
missing variable as its skip reason:

- `CONTRACT_RAPIDAPI_SECRET` holds the server's `RAPIDAPI_SECRET`. It enables
  the RapidAPI 401 and JSON cases.
- `CONTRACT_POLAR_WEBHOOK_SECRET` holds the server's `POLAR_WEBHOOK_SECRET`.
  It enables the unsigned and signed webhook cases.
- `CONTRACT_POLAR_PRO_PRODUCT_ID` holds the server's `POLAR_PRO_PRODUCT_ID`.
  It enables the signed event for another product, which Python answers with
  500 when the server has no Pro product.
- `CONTRACT_NO_OPENROUTER_KEY=1` declares a server without
  `OPENROUTER_API_KEY`. It enables the failed query enhancement case. That
  server has no enhancer, so every enhanced lookup fails without calling
  OpenRouter. No request makes a configured enhancer fail deterministically.
- `CONTRACT_ANON_LIMIT` and `CONTRACT_CHECKOUT_RATE_LIMIT` default to 10 and
  must equal the server's `ANON_LIMIT` and `CHECKOUT_RATE_LIMIT`.

Two properties stay outside the suite because HTTP cannot observe them. The
queue overflow case checks that at least five lookups in a burst succeed and
some are refused, but staggered admission hides the exact capacity;
`ClassificationQueue`'s specs pin it. The signed non-Pro webhook carries no
user, so it cannot show that a missing product filter would grant Pro.

With `CONTRACT_TARGET=nest`, the `retiredRoutes` table expects 404 instead of
Python's status. Inside test files Vitest replaces `process.env.BASE_URL`
with Vite's base path, so the config passes the URL on as
`CONTRACT_BASE_URL`.

The public-mode cases expect a server without `POLAR_WEBHOOK_SECRET`,
`RAPIDAPI_SECRET`, or Redis. The app's `load_dotenv()` searches upward from
`app/`, so a worktree nested under the main checkout also loads the main
checkout's `.env`. A key added there changes what a public-mode instance
answers.

Python declares HEAD only on page routes. HEAD on a GET-only route, such as
`/robots.txt` or `/health`, falls through to the classifier catch-all and
answers 404. HEAD on `/{TYPE}/fragment` answers 301. The contract suite pins
this behavior.

Always use `pytest` for backend tests. The suite retains `unittest`-compatible
test classes and standard-library mocks, but pytest is the official runner.

Fresh checkouts may lack `.venv`, `node_modules`, and generated frontend assets
because they are ignored. If `.venv` is absent, run `python -m venv .venv` and
`.venv/bin/pip install -r requirements-dev.txt` before `pytest`. If
`node_modules` is absent, run `npm ci` before frontend tests or builds. The
verification driver (`.agents/skills/verify/`) also requires a frontend build
(`npm run build`).

pytest.ini scopes pytest collection to `tests/`. The `utilities/test_*.py` files are
manual live/debug helpers, and the ignored `embedders/tests/` tree contains
separate experimental tests that are not part of the maintained backend suite.
`tests/test_emdn_embedder.py` imports the ignored
`embedders/embedder_remote_EMDN_hf.py`; a checkout without that local file cannot
collect the full suite. Report that limitation when excluding this test.

Activate the Python environment with `source .venv/bin/activate` before backend
tests or the verification driver.

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

The ID normalization that `apply` writes into Qdrant
(`src/qdrant/id-lookup.ts`) must match `app/id_lookup.py` exactly. Python
casefolds, so `ß` becomes `ss`; JavaScript's `toLowerCase` does not. After
changing either side, rerun `python utilities/export_golden_fixtures.py` and
`npm test`. The fixture covers every code point that Python folds to ASCII.
Python normalizes `str()` of any `original_id` payload value.
`originalIdLookupText` converts only the JSON values whose `String()` matches
it after normalization, and `apply` fails on the rest, including `0`, because
`JSON.parse` reads Python's `0.0` as `0`.

## Project Snapshot

Classifast is a classification service web application that uses embeddings and vector search (Qdrant) to classify any text input (mostly product descriptions) into categories of various industry standard classifications, like UNSPSC, NAICS, CN/HS codes, ISIC, ETIM, CPV, etc.

## Tech Stack

- Backend: Python FastAPI
- Frontend: TypeScript with Tailwind CSS (built with Node/npm and Vite, served via FastAPI)
- Infrastructure: Redis (usage tracking), Qdrant (vector database), Hugging Face Inference (embeddings), OpenRouter (deployed-service reranking and opt-in query enhancement), Clerk (authentication), Polar (payments)

## Hardware, Deployment, Cache

Self-hosted from Raspberry Pi 4 (4GB) via Coolify behind Cloudflare Tunnel (Full HTTPS/TLS Setup for All Resources). The app uses Cloudflare's CDN edge caching to reduce API costs and improve performance. Classification results are cached at edge for 7 days.

## When Modifying Cache Behaviour

Cache headers are defined in `app/cache_profiles.py` - edit the profiles there instead of hand-rolling headers.

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

`app/static/js/*.js` and `app/static/css/styles.css` are Vite build outputs
from `app/assets/ts/` and `app/assets/css/`. Never hand-edit them; edit the TS
sources and run `npm run build`.

`app/assets/css/input.css` limits Tailwind's class scan to `app/assets/ts` and
`app/templates`, the only markup the Docker frontend stage copies. Local and
Docker builds therefore produce the same `styles.css`. A Tailwind class written
anywhere else, such as in `app/web.py` or `src/`, is not generated. When
markup moves to a new directory, add a `@source` line for it.

## Rapid API (API.py)

`app/api.py` is specifically made for the Rapid API platform. It contains endpoints that make the classification service accessible on that platform. Ignore api.py unless explicitly asked to work on Rapid API service integration.

## Gotchas and Non-Obvious Behaviors

- Polar SDK version range is declared in `requirements.txt`.
  SDK 1.x uses versioned `polar` imports, direct checkout keyword arguments, and
  webhook dataclasses with `event.type` instead of `event.TYPE`.
  The `polar.v2026_10` webhook parser requires `api_version` and complete
  subscription fields even when their values are null. Check the dashboard
  endpoint version when migrating older webhook payloads.
  Invalid signatures return 403. Verified unknown event types are acknowledged
  without changing entitlements; malformed webhook payloads return 400.
- `data/`, `embedders/`, and `mapping/` are gitignored and may be absent from
  a checkout. Ripgrep silently returns zero hits inside them because it
  respects `.gitignore`; use `--no-ignore` or explicit paths. If `embedders/`
  is absent, `pytest` fails while collecting `tests/test_emdn_embedder.py`.
  Run `pytest --ignore=tests/test_emdn_embedder.py` for the remaining suite.
- `app/classifier_page_delivery.py` parses `app/static/sitemap.xml` at import
  time to build `SITEMAP_QUERY_PATHS`, which gates SSR eligibility and homepage
  anchor links. Editing the sitemap only changes app behavior after a restart.
- `asset_url` hashes are cached per process (`app/dependencies.py`). After
  `npm run build`, restart the FastAPI process or the browser keeps loading
  the old JS with stale `?v=` values.
- The server never sets cookies on any response, cacheable or not. `cf_track`
  is set by client-side JavaScript. On HTML or fragment routes a server-side
  cookie additionally breaks the `HTML_PAGE`/`CLASSIFICATION_RESULT` CDN cache
  profiles; on other routes it is still forbidden by design, so use
  client-side JavaScript for any per-user state.
- Two client-IP trust policies coexist: `app/usage_tracker.py` always trusts
  `CF-Connecting-IP`; `app/google_crawlers.py` requires the explicit
  `GOOGLE_CRAWLER_TRUST_CF_CONNECTING_IP` opt-in. Pick one policy deliberately
  for new IP-dependent code.
- `paywall.ts` is wrapped in a parse guard on purpose (class declarations
  re-execute on bfcache/history-restore re-parsing). Do not remove the guard.
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
- The app assumes a single uvicorn worker. The JWKS client, asset versions,
  crawler IP ranges, and the classification queue capacity are all
  process-local. Scaling workers changes their semantics.
- There is no integration test suite. Most tests use mocks, including the checkout
  rate-limit tests. The suite does not prove deployed Qdrant, Redis, or Hugging
  Face connectivity. Manual live helpers live in `utilities/test_*.py`, which
  pytest excludes from collection.
- `/health` requires initialized embedding and Qdrant clients, then probes
  Qdrant only. If `HF_TOKEN` is missing, public pages can still serve while
  `/health` returns 503, provided Qdrant startup succeeds. It does not check
  Redis or live Hugging Face requests. A Qdrant startup failure stops the app.
- `.env` is a personal cross-project secrets file (it contains keys unrelated
  to classifast too). Never print, copy, or commit it.
- Checkout endpoints are rate limited per IP via `app/rate_limit.py`
  (fixed-window Redis counter, fails closed with 503). Checkout grace
  (`checkout_grace:*` in Redis) is activated only by the signature-verified
  Polar webhook; the success URL carries no token and grants nothing.
- The homepage and classifier templates load production Clerk scripts and
  Google Analytics. Production Clerk rejects localhost, while analytics may
  still send traffic. The UI can render a fallback `Sign In` link when Clerk
  fails; that link does not prove authentication works. Use a Clerk test
  configuration that accepts the local origin to verify sign-in.
  On localhost the page renders the signed-out Clerk buttons rather than the
  fallback links, and their Sign In opens an empty Clerk modal backdrop. To see
  the fallback locally, block the `clerk.browser.js` request.
- Template `url_for` links render as absolute URLs with the request origin.
  Browser checks should use accessible names or inspect the URL pathname,
  rather than match an exact relative `href`.
- `CachedStaticFiles` must not replace the `ETag` that Starlette sets.
  Starlette compares `If-None-Match` with its own ETag inside `file_response`,
  before `CachedStaticFiles.get_response` adds headers. A replaced ETag turns
  every revalidation into a 200. `tests/test_static_headers.py` covers 304
  responses and changed-file revalidation on the real mount.
- Checkout rate limiting requires Redis 7+ for `EXPIRE NX`. Queue `INCR` and
  `EXPIRE NX` in one transactional pipeline. This assigns missing TTLs, including
  on stranded counters, while preserving existing deadlines. Redis errors must
  still return 503, and counters above the allowance must still return 429.
- Tier-cache lookup fills use `SET EX NX` and reread the winning value.
  Webhook tier updates use authoritative `SETEX`; a lookup completing afterward
  must preserve and return that tier. Upgrade and downgrade overlap tests also
  verify quota behavior without checkout grace.
- `ClassificationExecutor` holds one turn per complete classification, not per
  thread stage. Asynchronous query enhancement between stages keeps the turn.
  Each process admits one active and four waiting classifications
  (`QUEUE_CAPACITY`). The next request raises `ClassificationQueueFull`. The
  fragment and RapidAPI routes log a warning and return 503 with `no-store`.
  An overloaded SSR page falls back to client-side loading with `no-store`
  but stays indexable. Verified Google crawlers get that page as a 503 with
  `Retry-After` instead. Only genuine SSR failures send `noindex`, because
  Google drops a 200 page marked `noindex` but retries a 503.
- A fragment request runs crawler verification, Clerk caller resolution, a
  read-only quota check (`check_usage`), queue admission, the turn, the quota
  charge (`authorize`), and the pipeline. Over-quota callers get the paywall
  without a queue slot. Racing requests can all pass the check, so the charge
  decides. Overflowed and cancelled waiting requests are never charged. Keep
  networked checks out of `authorize`, which holds the only turn. A Clerk key
  fetch can take 30 seconds.
- Cancelling a waiting classification frees its slot without running it.
  Cancelling the active one returns immediately, but the job keeps its slot
  until the running thread stage finishes. Shutdown cancels waiting jobs and
  drains the active one before shared clients close.
- Python 3.14's `asyncio.shield` logs a late failure of the shielded future
  after its waiter is cancelled, even when code retrieves that failure. The
  executor waits with `_wait_through_cancellation` (`asyncio.wait` plus
  explicit retrieval) instead. Keep the raced worker-error regression tests
  when changing these waits.
- Checkout recovery retries two seconds after each completed request and has a
  60-second deadline. An input or change inside the form cancels recovery,
  switches to the existing manual-retry message, and enables Try again.
  Keep displayed status consistent with whether automatic checks are running;
  update only the recovery status paragraph, preserving a fresh ordinary paywall.
  Successful recovery must leave results visible without recreating a warning.
