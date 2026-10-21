# [Classifast.com](https://classifast.com)

TypeScript rewrite of [Classifast](https://github.com/DmitryMatv/classifast),
originally built with Python/FastAPI.

## Accurate classifier of UNSPSC, NAICS, HS/CN/HTS codes, NACE, EMDN, ETIM and more

### Get the right category codes from the most widely used classification standards.

Classifast is a web application that provides easy classification of any text input according to international product and service standards like UNSPSC, NAICS, ISIC, ETIM, HS, CN. Built with FastAPI and modern web technologies, it offers fast, accurate semantic search capabilities for automated yet intelligent categorization.

<a href="https://www.producthunt.com/products/classifast-com?embed=true&amp;utm_source=badge-featured&amp;utm_medium=badge&amp;utm_campaign=badge-classifast-com-2-0" target="_blank" rel="noopener noreferrer"><img alt="Classifast.com 2.0 - Introducing Mappings + More accurate results (re-ranking) | Product Hunt" width="250" height="54" src="https://api.producthunt.com/widgets/embed-image/v1/featured.svg?post_id=1189360&amp;theme=light&amp;t=1783342139980"></a>

![CodeRabbit Pull Request Reviews](https://img.shields.io/coderabbit/prs/github/DmitryMatv/classifast?utm_source=oss&utm_medium=github&utm_campaign=DmitryMatv%2Fclassifast&labelColor=171717&color=FF570A&link=https%3A%2F%2Fcoderabbit.ai&label=CodeRabbit+Reviews)

## Features

- **Fast Classification**: Semantic search using advanced embedding models
- **High Accuracy**: Confidence scores for each classification result
- **Multiple Standards**: Support for UNSPSC, ETIM, and NAICS classification standards
- **Modern Interface**: Clean, responsive design built with Tailwind CSS
- **SEO Optimized**: Structured data, meta tags, and performance optimized

## Supported classification standards (Top 3)

### UNSPSC (United Nations Standard Products and Services Codes)

- Global standard for product and service categorization
- Improves spend analytics and procurement processes
- Version: UNv260801 (August 14, 2023)

### ETIM (European Technical Information Model)

- B2B open standard for technical product classification
- Specialized for electrical and technical products
- Version: 10.0 (2024-12-10)

### NAICS 2022 (North American Industry Classification System)

- Industry classification for business activities
- Essential for government contracting and reporting

## Stack

- **Backend**: FastAPI with Python
- **Frontend**: TypeScript, Tailwind CSS, HTMX
- **Vector Database**: Qdrant for semantic search
- **Embedding Models**: Hugging Face Inference with Qwen embeddings
- **Deployment**: Docker containerized

## Demo

Visit the working instance at [classifast.com](https://classifast.com) to try.

## Installation

1. Clone the repository
2. Install dependencies: `npm ci`
3. Set environment variables for embedding inference, API keys, and payments/quota behavior
4. Run the frontend watcher and the NestJS app: `npm run dev`

The Python app in `app/` is kept for rollback. To run it, install
`requirements.txt` and run `uvicorn app.main:app --reload --port 8001`.

Relevant embedding environment variables:

- `HF_TOKEN`
- `HF_INFERENCE_PROVIDER` defaults to `auto`
- `HF_EMBEDDING_MODEL` defaults to `Qwen/Qwen3-Embedding-8B`
- `HF_EMBEDDING_DIMS` defaults to `2048`

Reranking is served by OpenRouter and uses its own API key and model:

- `OPENROUTER_API_KEY`
- `OPENROUTER_RERANK_MODEL` defaults to `voyageai/rerank-3`
- `OPENROUTER_RERANK_TIMEOUT_SECONDS` defaults to `30`

Embedding inference uses the configured `HF_INFERENCE_PROVIDER`. Reranking is
sent to OpenRouter's `/api/v1/rerank` endpoint with the `OPENROUTER_API_KEY`.

The classifier page also has an off-by-default **Expand query** beta switch.
When enabled, `google/gemini-3.1-flash-lite` adds a short description after the
original query for embedding and reranking. The beta model inputs put each
classification instruction after that semantic text. Exact ID matches skip the
model call. Code-like queries also skip it after an exact miss. The original
text stays in the input, result heading, URL, and ID lookup. If OpenRouter is
unavailable or the API key is absent, classification uses the original text and
the ordinary instruction-first format. Provider failures are not cached. Shared
beta searches use `?enhance_query=1` in the URL.

Relevant Qdrant environment variables:

- `QDRANT_URL` is preferred when set. Full HTTP(S) URLs are preserved; a bare
  hostname is treated as HTTPS.
- `QDRANT_HOST` and `QDRANT_PORT` (default `localhost:6333`) are the fallback
  when `QDRANT_URL` is unset.
- `QDRANT_API_KEY` is optional for unprotected local Qdrant deployments.

Relevant payment and quota environment variables:

- `POLAR_ACCESS_TOKEN`
- `POLAR_WEBHOOK_SECRET`
- `POLAR_PRO_PRODUCT_ID`
- `CHECKOUT_GRACE_TTL` defaults to `300`

Frontend JS/CSS files under `app/static/` are build artifacts. They are generated from `app/assets/` and are intentionally not committed to git.

## Deployment

For production, deploy from the repo root with the provided `Dockerfile`. It
builds the NestJS app on `node:24-bookworm-slim`. Builder stages compile the
frontend assets and the server, and the runtime stage receives only `dist/`,
`app/static/`, and the production `node_modules`. The container runs
`node dist/main.js` as the `node` user with `NODE_ENV=production`. Its
`HEALTHCHECK` requests `/health` every 10 minutes.

`Dockerfile.python` builds the previous FastAPI image. It stays in the
repository for rollback until the Nest release has soaked.

For Coolify, use these settings. The switch to Nest does not change them:

- Source directory: repo root
- Build pack: Dockerfile
- Dockerfile path: `./Dockerfile`
- Include Source Commit in Build: disabled

The image contains no `.env` file, so set every variable in Coolify. The Nest
app reads the same variable names as the Python app, with these differences:

- The app listens on `HOST` and `PORT`, which default to `0.0.0.0` and `8001`.
  The Python image hard-coded both and ignored the variables. Leave them unset,
  or keep `PORT` equal to the port that Coolify exposes. The `HEALTHCHECK`
  reads the same two variables.
- The app does not start when Qdrant is unreachable or a collection fails the
  schema check. Without `HF_TOKEN` it starts, but `/health` answers 503 and
  the container becomes unhealthy, as with the Python image.
- Google crawler verification uses the first `X-Forwarded-For` address, as
  the Python app did through uvicorn's `--forwarded-allow-ips "*"`. Set
  `GOOGLE_CRAWLER_TRUST_CF_CONNECTING_IP=true` to use Cloudflare's
  `CF-Connecting-IP` instead, which a client cannot forge through Cloudflare.
  Set it only when the origin receives requests through Cloudflare alone.
- The app does not log one line per request, as uvicorn did. It logs startup,
  warnings, errors, and classification steps.
- The app accepts request headers up to 64 KiB (`--max-http-header-size` in
  the `CMD`). Node's default of 16 KiB was below uvicorn's limit.

`docker-compose.yaml` runs the same image for local or manual container runs.
It pins `HOST` and `PORT`, because its port mapping and health check expect
port 8001. The recommended Coolify production path is the Dockerfile build directly.

To roll back to the Python app, use one of these methods:

- In Coolify, open the application's Rollback tab and redeploy the image of
  the last Python deployment. This works while Coolify still keeps that image.
- Set the Dockerfile path to `./Dockerfile.python` and redeploy. Set it back
  to `./Dockerfile` to return to Nest.

For a compose deployment, add `dockerfile: Dockerfile.python` under `build`.

Application startup validates every configured Qdrant collection, vector size,
and required payload index without modifying Qdrant. Startup fails when the
schema contract is invalid. Prepare and verify Qdrant explicitly before a
deployment:

```bash
npm ci
npm run qdrant:indexes -- apply
npm run qdrant:indexes -- check
```

`qdrant:indexes` builds the Nest project and runs the TypeScript CLI in
`src/cli/sync-payload-indexes.ts`. Add `--collection NAME` (repeatable) to
limit either command to configured collections. `apply` is a live migration
operation: it backfills normalized ID payloads and creates or replaces payload
indexes. `check` is read-only. Run `apply` from a controlled maintenance
environment, verify the resolved Qdrant target before confirming the
operation, then deploy only after `check` succeeds. The CLI loads the
repository `.env`; values already exported by the shell or supplied by the
container take precedence. It exits 0 on success, 1 on a schema violation or a
failed Qdrant operation, and 2 on invalid arguments.

Synchronous classification stages run on one dedicated background worker per
application process. Each process admits one active classification and up to
four waiting classifications. When the queue is full, fragment and RapidAPI
requests receive HTTP 503. Fragment callers already over quota receive the
paywall instead, without taking a queue slot. Server-rendered pages still return
200 to visitors and load results in the browser, while verified Google crawlers
receive HTTP 503 with `Retry-After`. An active classification retains its turn
through query enhancement and every synchronous stage. This bounds queued work
and keeps health checks, webhooks, and cached-page handling responsive.

## API

- `GET /` Homepage
- `GET /{classifier_type}` Classification page (unspsc, etim, naics)
- `POST /{classifier_type}` Submit classification request
- `GET /health` Health check endpoint

## Testing

- Run the unit tests (frontend and NestJS): `npm test`
- Run the NestJS end-to-end tests: `npm run test:e2e`
- Run the typecheck: `npm run typecheck`

The Python app's tests live under `tests/` and use pytest. Run them with
`pytest`, and the Python typecheck with `python -m mypy`.

`utilities/test_*.py` scripts are manual smoke/debug helpers for live integrations and are intentionally separate from the main regression suite.

## SEO

- Structured data markup (JSON-LD)
- FAQ schema for common questions
- Optimized meta descriptions and titles
- Breadcrumb navigation
- Semantic HTML structure
- Performance optimized loading
