# Migrate Classifast to NestJS and React

This plan replaces the Python FastAPI backend and the Jinja/HTMX frontend with
TypeScript. It ships as two production releases. Release 1 puts NestJS behind
today's HTML and scripts. Release 2 replaces the classifier page's HTMX with
React. Each unit below is one pull request that passes its checks before the
next unit starts.

## Decisions

The user made these decisions on 2026-10-07.

1. Ship the backend first, in its own release. The Python app stays the
   reference until the Nest app matches it.
2. Nest renders React itself. Controllers call `renderToString`, and Vite builds
   one client entry per page that calls `hydrateRoot`. No React Router, no
   Next.js.
3. Render classification results in the HTML for every visitor on sitemap query
   pages, not only for verified Googlebot.
4. Keep the offline Python scripts in `utilities/`. The web service runs only
   TypeScript.
5. Do not port these items: the public `/docs`, `/redoc` and `/openapi.json`;
   the `/llms.txt` route; `python-multipart`; the `htmx:authRefreshFailed` and
   `clerk:loaded` listeners; the fragment's 429 branches; unused window globals;
   the legacy `track_usage` parameter.
6. The Nest app lives at the repo root in `src/` and `test/`. It was created
   with `nest new` from `@nestjs/cli` 12.0.8: npm, ESM, Vitest, no
   `@nestjs/observe`.

## Definition of done

- Release 1 is done when production serves every route from the Nest
  container, the contract suite passes against it, and the Python runtime code
  is deleted after a soak period.
- Release 2 is done when the repo has no `htmx.min.js`, no `hx-` attributes and
  no `htmx:` listeners, the classifier page runs on hydrated React, and the
  contract suite and the live verification pass.

## Rigor

Rigor is high. Payments, quotas and search rankings break in ways that are
expensive to undo. Each unit passes the checks that apply to it before the
next unit starts:

- Unit tests and golden fixtures for every function whose output must match
  Python byte for byte.
- The contract-suite cases for the routes the unit ports, run against Python
  and against Nest.
- A live browser check through `.agents/skills/verify/` for any unit that
  changes what a browser receives.

The cutover gate (unit 11) adds the full contract suite against Nest and a
side-by-side diff of Python and Nest responses on unmetered routes.

## Phase 0. Build the harness

Phase 0 runs after Phase 1 unit 1, because the contract suite uses the Vitest
setup that the scaffold adds. The user asked to start with the scaffold.

- [ ] Write the contract suite in `test/contract/`. It reads `BASE_URL` and
      checks routes, status codes, redirects (301, 308, 410), cache headers per
      profile, canonical and robots headers, the DOM regions that the scripts
      depend on, the RapidAPI JSON, and signed webhook fixtures. It must pass
      against the Python app first.
- [ ] Write a Python script that exports golden fixtures to
      `test/fixtures/golden/`. It covers `normalize_original_id_for_lookup`,
      `sanitize_query_text`, `slugify`, `decode_search_query`, the canonical
      and push URL builders, the page titles that use `str.title()`, and
      `group_original_id_tokens`. Include Cyrillic, CJK, emoji, `ß` and
      CPV-style IDs in the inputs.

## Phase 1. Run NestJS behind today's frontend

1. [x] Scaffold the Nest app with `nest new` and merge it with the Vite and
       Vitest setup. The Python Docker build must keep working.
2. [ ] Parse the environment with zod at boot. Add `/health`. Build a Node 24
       image next to the Python one.
3. [ ] Port the shared pure functions and check them against the golden
       fixtures.
4. [ ] Port the classification pipeline: Qdrant, Hugging Face embeddings,
       OpenRouter rerank and query enhancement, the outbound budget, and the
       read-only Qdrant schema check at startup.
5. [ ] Port the admission queue: one active job, four waiting, FIFO, 503 on
       overflow, cancellation through `AbortSignal`.
6. [ ] Port Clerk verification, the quota, the tier cache, checkout grace and
       the checkout rate limit. Keep every Redis key name and format.
7. [ ] Port Polar checkout and the webhook. Verify the raw body and validate
       the payload with a schema.
8. [ ] Port the middleware (security headers, query normalization, URL
       validation), the cache profiles, static files with ETag 304s, and crawler
       verification.
9. [ ] Port the pages and fragments as React components rendered to static
       HTML. Keep the ids, `data-` and `hx-` attributes that the scripts use.
10. [ ] Port the RapidAPI routes.
11. [ ] Cut over. Switch the Dockerfile and compose file to Node, port the
        verify driver, run the side-by-side diff, deploy, and keep the Python
        image for rollback. After the soak, delete the Python runtime code and
        update AGENTS.md and the README.
12. [ ] Render results for every visitor on sitemap query pages (decision 3),
        backed by a result cache. Deploy this unit on its own after the
        cutover soak, with contract cases for the new page output and a check
        of Cloudflare cache behavior for those URLs.

## Phase 2. Replace HTMX with React

1. [ ] Add a JSON results endpoint. Keep it a cacheable GET with canonical query
       parameters. Return a typed union of results, paywall, busy and error.
2. [ ] Hydrate the classifier page: the form, the results and Clerk auth.
3. [ ] Port the paywall and checkout recovery as a reducer.
4. [ ] Hydrate only the interactive parts of the home and mapping pages.
5. [ ] Delete `htmx.min.js`, the HTMX listeners and the old scripts. Port the
       behavior tests. Remove the HTMX entries from AGENTS.md.

## Fixes outside the phases

- [x] Show a Sign In button and the Clerk avatar in the mobile header
      (current app).
- [x] Stop the base classifier page from submitting an empty form. When
      `/{TYPE}/` cannot server-render its example results (an SSR failure or a
      full queue), the script clears the example text and then auto-submits.
      `getEffectiveQuery` in `classifier.ts` falls back to the example, but
      htmx calls `form.reportValidity()` first and the textarea is `required`,
      so no request goes out. The browser shows "Please fill in this field"
      and the results stay at "Loading...". Reproduced in public mode;
      the production trigger is inferred from the code. Changing Top-K after
      the example clears hit the same block. Fixed in `classifier.ts`
      `submitForm`, which skips htmx validation only when the query lives
      outside the textarea.
- [ ] Charge the quota after the query passes validation, not before.
- [ ] Check whether a Cloudflare cache rule covers `/api/v1/rapid/*`. Those
      responses are public for 7 days and do not vary on the proxy secret.
- [ ] Give the 503 status fragment its amber border. Its class lives in
      `app/web.py`, which Tailwind never scans, so production CSS lacks
      `border-amber-200`. The Nest port of the fragment fixes this only if the
      pages unit adds a `@source` line for its markup in `src/`.

## Open decisions

- [ ] Choose what happens to the Python utilities that import `app` modules
      before unit 11 deletes them: `sync_payload_indexes.py` (`id_lookup`,
      `qdrant_connection`, `qdrant_schema`), `test_openrouter_reranker_live.py`
      (`classifier`), and `test_subscription_events.py` (`payments`,
      `usage_tracker`). The ID normalization that `sync_payload_indexes.py
      apply` writes into Qdrant must match the TypeScript runtime byte for byte.
- [ ] Accept that the Python Docker image's frontend stage installs the Nest
      dependencies until unit 11 replaces the Dockerfile. Its `node_modules`
      grows from 108 MB to 201 MB, and every Pi build installs it.

## Decision log

`docs/nest-migration/decisions.tsv` records each decision with its evidence.
