import { z } from "zod";
import { coerceEmbedding } from "./classification.js";
import {
  fetchJson,
  isTransientHttpError,
  systemClock,
  withRetry,
  type Clock,
  type Fetch,
} from "./outbound.js";

export interface HfEmbeddingConfig {
  readonly token: string;
  /** A provider name, or "auto" for the first one the Hub lists. */
  readonly provider: string;
  readonly timeoutSeconds: number;
}

export interface EmbeddingRequest {
  readonly model: string;
  readonly text: string;
  readonly dims: number;
  /** Budget across retries; an attempt in progress is not cut short. */
  readonly maxSeconds?: number;
}

const HUB_URL = "https://huggingface.co";
const ROUTER_URL = "https://router.huggingface.co";

const HF_INFERENCE = "hf-inference";

// The other feature-extraction providers that huggingface_hub routes to with
// an OpenAI-style embeddings body. Each answers `{data: [{embedding}]}`.
const OPENAI_STYLE_ROUTES: Readonly<
  Record<string, { readonly directUrl: string; readonly route: string }>
> = {
  scaleway: { directUrl: "https://api.scaleway.ai", route: "/v1/embeddings" },
  deepinfra: {
    directUrl: "https://api.deepinfra.com",
    route: "/v1/openai/embeddings",
  },
  together: { directUrl: "https://api.together.xyz", route: "/v1/embeddings" },
};

interface ProviderRequest {
  readonly url: string;
  readonly body: Record<string, unknown>;
  /** hf-inference answers with the bare array; the others wrap it. */
  readonly raw: boolean;
}

const mappingEntry = z.object({
  providerId: z.string(),
  status: z.string(),
  task: z.string(),
});

const modelInfoSchema = z.object({
  inferenceProviderMapping: z
    .union([
      z.record(z.string(), mappingEntry),
      z.array(mappingEntry.extend({ provider: z.string() })),
    ])
    .nullish(),
});

interface ProviderMapping {
  readonly provider: string;
  readonly providerId: string;
  readonly task: string;
}

const modelTaskSchema = z.object({
  pipeline_tag: z.string().nullish(),
  tags: z.array(z.string()).nullish(),
});

const embeddingsSchema = z.object({
  data: z.array(z.object({ embedding: z.unknown() })),
});

export class HfEmbeddingClient {
  readonly #mappings = new Map<string, readonly ProviderMapping[]>();
  readonly #hfInferenceModels = new Set<string>();

  constructor(
    private readonly config: HfEmbeddingConfig,
    private readonly fetchFn: Fetch = fetch,
    private readonly clock: Clock = systemClock,
  ) {}

  async embed(
    { model, text, dims, maxSeconds }: EmbeddingRequest,
    signal: AbortSignal,
  ): Promise<number[]> {
    const response = await withRetry(
      () => this.#featureExtraction(model, text, dims, signal),
      isTransientHttpError,
      { clock: this.clock, signal, maxSeconds },
    );
    const vector = coerceEmbedding(response);
    if (vector.length !== dims) {
      throw new Error(
        `Embedding dimension mismatch: expected ${dims}, got ${vector.length}`,
      );
    }
    return vector;
  }

  async #featureExtraction(
    model: string,
    text: string,
    dims: number,
    signal: AbortSignal,
  ): Promise<unknown> {
    const request = await this.#providerRequest(model, text, dims, signal);
    const body = await fetchJson(
      this.fetchFn,
      request.url,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.config.token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(request.body),
      },
      this.config.timeoutSeconds * 1000,
      signal,
    );
    return request.raw
      ? body
      : embeddingsSchema.parse(body).data.map((item) => item.embedding);
  }

  /** huggingface_hub's get_provider_helper and prepare_request. */
  async #providerRequest(
    model: string,
    text: string,
    dims: number,
    signal: AbortSignal,
  ): Promise<ProviderRequest> {
    const hfInferenceBody = { inputs: text, dimensions: dims };
    if (/^https?:\/\//.test(model)) {
      return { url: model, body: hfInferenceBody, raw: true };
    }
    const provider =
      this.config.provider === "auto"
        ? (await this.#providerMappings(model, signal))[0]?.provider
        : this.config.provider;
    if (provider === undefined) {
      throw new Error(`No provider mapping found for model ${model}`);
    }
    if (provider === HF_INFERENCE) {
      await this.#checkHfInferenceTask(model, signal);
      return {
        url: `${ROUTER_URL}/${HF_INFERENCE}/models/${model}/pipeline/feature-extraction`,
        body: hfInferenceBody,
        raw: true,
      };
    }
    const route = OPENAI_STYLE_ROUTES[provider];
    if (route === undefined) {
      throw new Error(
        `Task 'feature-extraction' not supported for provider '${provider}'`,
      );
    }
    const mapping = (await this.#providerMappings(model, signal)).find(
      (entry) => entry.provider === provider,
    );
    if (mapping === undefined) {
      throw new Error(
        `Model ${model} is not supported by provider ${provider}`,
      );
    }
    if (mapping.task !== "feature-extraction") {
      throw new Error(
        `Model ${model} is not supported for task feature-extraction and provider ${provider}`,
      );
    }
    const baseUrl = this.config.token.startsWith("hf_")
      ? `${ROUTER_URL}/${provider}`
      : route.directUrl;
    return {
      url: `${baseUrl}${route.route}`,
      body: { input: text, model: mapping.providerId, dimensions: dims },
      raw: false,
    };
  }

  /** hf_inference._check_supported_task for feature-extraction. */
  async #checkHfInferenceTask(
    model: string,
    signal: AbortSignal,
  ): Promise<void> {
    if (this.#hfInferenceModels.has(model)) return;
    const info = modelTaskSchema.parse(
      await fetchJson(
        this.fetchFn,
        `${HUB_URL}/api/models/${model}`,
        { headers: { authorization: `Bearer ${this.config.token}` } },
        this.config.timeoutSeconds * 1000,
        signal,
      ),
    );
    const supported =
      info.pipeline_tag === "feature-extraction" ||
      (info.pipeline_tag === "sentence-similarity" &&
        (info.tags ?? []).includes("feature-extraction"));
    if (!supported) {
      throw new Error(
        `Model '${model}' doesn't support task 'feature-extraction'`,
      );
    }
    this.#hfInferenceModels.add(model);
  }

  async #providerMappings(
    model: string,
    signal: AbortSignal,
  ): Promise<readonly ProviderMapping[]> {
    const cached = this.#mappings.get(model);
    if (cached) return cached;
    const body = await fetchJson(
      this.fetchFn,
      `${HUB_URL}/api/models/${model}?expand=inferenceProviderMapping`,
      { headers: { authorization: `Bearer ${this.config.token}` } },
      this.config.timeoutSeconds * 1000,
      signal,
    );
    const mapping = modelInfoSchema.parse(body).inferenceProviderMapping;
    if (mapping === undefined || mapping === null) {
      throw new Error(`No provider mapping found for model ${model}`);
    }
    const mappings = Array.isArray(mapping)
      ? mapping
      : Object.entries(mapping).map(([provider, entry]) => ({
          provider,
          ...entry,
        }));
    this.#mappings.set(model, mappings);
    return mappings;
  }
}
