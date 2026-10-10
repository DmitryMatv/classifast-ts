import {
  fetchJson,
  isTransientHttpError,
  systemClock,
  withRetry,
  type Clock,
  type Fetch,
} from "./outbound.js";

export const OPENROUTER_RERANK_URL = "https://openrouter.ai/api/v1/rerank";

export interface OpenRouterRerankConfig {
  readonly apiKey: string;
  readonly model: string;
  readonly timeoutSeconds: number;
}

export class RerankerResponseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RerankerResponseError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Returns the scores in document order, or throws like Python's parser. */
export function parseRerankScores(
  responsePayload: unknown,
  documentCount: number,
): number[] {
  if (!isRecord(responsePayload) || !("results" in responsePayload)) {
    throw new RerankerResponseError(
      "Reranking response is missing a 'results' array",
    );
  }
  const { results } = responsePayload;
  if (!Array.isArray(results) || results.length !== documentCount) {
    throw new RerankerResponseError(
      "Reranking response count does not match requested document count",
    );
  }

  const scoresByIndex = new Map<number, number>();
  for (const entry of results) {
    if (!isRecord(entry)) {
      throw new RerankerResponseError("Reranking response item is malformed");
    }
    const { index, relevance_score: score } = entry;
    if (typeof index !== "number" || !Number.isInteger(index)) {
      throw new RerankerResponseError(
        "Reranking response index is not an integer",
      );
    }
    if (typeof score !== "number") {
      throw new RerankerResponseError(
        "Reranking response score is not numeric",
      );
    }
    if (!(score >= 0 && score <= 1)) {
      throw new RerankerResponseError(
        "Reranking response score is outside [0, 1]",
      );
    }
    scoresByIndex.set(index, score);
  }

  const scores = Array.from({ length: documentCount }, (_, index) =>
    scoresByIndex.get(index),
  );
  if (
    scoresByIndex.size !== documentCount ||
    scores.some((score) => score === undefined)
  ) {
    throw new RerankerResponseError(
      "Reranking response indices are not unique or do not cover every document",
    );
  }
  return scores as number[];
}

/** A budget lowers the configured timeout but never raises it. */
export function requestTimeoutSeconds(
  configuredSeconds: number,
  budgetSeconds: number | undefined,
): number {
  return budgetSeconds === undefined
    ? configuredSeconds
    : Math.max(0.1, Math.min(budgetSeconds, configuredSeconds));
}

export class OpenRouterReranker {
  constructor(
    private readonly config: OpenRouterRerankConfig,
    private readonly fetchFn: Fetch = fetch,
    private readonly clock: Clock = systemClock,
  ) {}

  /**
   * Returns a relevance score in [0, 1] for each document, in document order.
   * `timeoutSeconds` caps each attempt and the time spent retrying; it never
   * raises the configured timeout.
   */
  async rerank(
    query: string,
    documents: readonly string[],
    {
      timeoutSeconds,
      signal,
    }: { timeoutSeconds?: number; signal: AbortSignal },
  ): Promise<number[]> {
    if (documents.length === 0) return [];
    const requestTimeout = requestTimeoutSeconds(
      this.config.timeoutSeconds,
      timeoutSeconds,
    );
    const body = JSON.stringify({
      model: this.config.model,
      query,
      documents,
      top_n: documents.length,
    });
    const responsePayload = await withRetry(
      () =>
        fetchJson(
          this.fetchFn,
          OPENROUTER_RERANK_URL,
          {
            method: "POST",
            headers: {
              authorization: `Bearer ${this.config.apiKey}`,
              "content-type": "application/json",
            },
            body,
          },
          requestTimeout * 1000,
          signal,
        ),
      isTransientHttpError,
      {
        clock: this.clock,
        signal,
        ...(timeoutSeconds === undefined ? {} : { maxSeconds: requestTimeout }),
      },
    );
    return parseRerankScores(responsePayload, documents.length);
  }
}
