import type { EnhancementStatus, RerankStatus } from "./classification.js";
import {
  completeClassification,
  exactOutcome,
  performClassification,
  prepareClassification,
  type Classification,
  type PipelineDeps,
} from "./classification-pipeline.js";
import type { ClassificationQueue } from "./classification-queue.js";
import type { EnhancementOutcome, QueryEnhancer } from "./query-enhancer.js";

export interface ClassificationRequest {
  readonly query: string;
  readonly classifierType: string;
  readonly version?: string;
  readonly topK: number;
  /** Ask the LLM for a product description to search with. */
  readonly enhance?: boolean;
}

export interface ClassificationOutcome extends Classification {
  readonly elapsedSeconds: number;
  /** Undefined unless the request asked for enhancement. */
  readonly enhancementStatus?: EnhancementStatus;
}

const CACHEABLE_RERANK_STATUSES: ReadonlySet<RerankStatus> = new Set([
  "applied",
  "not_needed",
]);

/**
 * Whether a shared cache may keep a classification: the fragment at the
 * edge for a week, a sitemap result in Redis for a month. A degraded one
 * (semantic-only ranking, a failed ID search or enhancement) or an empty
 * one, which an unfiltered nearest-neighbour search returns only for an
 * empty collection, is shown but not kept.
 */
export function isCacheableClassification(
  outcome: ClassificationOutcome,
): boolean {
  return (
    CACHEABLE_RERANK_STATUSES.has(outcome.rerank) &&
    outcome.idSearch === "ok" &&
    outcome.enhancementStatus !== "failed" &&
    outcome.results.length > 0
  );
}

export type Authorize = () => Promise<void>;

/**
 * Runs each classification inside one queue turn. `authorize` runs first in
 * that turn, so a request that waited in the queue is charged only when it
 * runs. It must not make network calls, because it holds the only turn.
 */
export class ClassificationService {
  constructor(
    private readonly deps: PipelineDeps,
    private readonly queue: ClassificationQueue,
    private readonly enhancer: Pick<QueryEnhancer, "enhance"> | null,
  ) {}

  async classify(
    signal: AbortSignal,
    request: ClassificationRequest,
    authorize?: Authorize,
  ): Promise<ClassificationOutcome> {
    const started = this.deps.clock.now();
    return this.queue.run(signal, async (turnSignal) => {
      await authorize?.();
      turnSignal.throwIfAborted();
      const { classification, enhancementStatus } = request.enhance
        ? await this.#classifyEnhanced(request, turnSignal)
        : {
            classification: await performClassification(
              this.deps,
              request,
              turnSignal,
            ),
            enhancementStatus: undefined,
          };
      return {
        ...classification,
        elapsedSeconds: (this.deps.clock.now() - started) / 1000,
        ...(enhancementStatus ? { enhancementStatus } : {}),
      };
    });
  }

  async #classifyEnhanced(
    { query, classifierType, version, topK }: ClassificationRequest,
    signal: AbortSignal,
  ): Promise<{
    classification: Classification;
    enhancementStatus: EnhancementStatus;
  }> {
    const prepared = await prepareClassification(
      this.deps,
      query,
      classifierType,
      version,
    );
    signal.throwIfAborted();
    const shortcut = exactOutcome(prepared, topK);
    if (shortcut) {
      return { classification: shortcut, enhancementStatus: "skipped" };
    }
    const enhancement: EnhancementOutcome = this.enhancer
      ? await this.enhancer.enhance(prepared.query, classifierType, signal)
      : { text: query, status: "failed" };
    signal.throwIfAborted();
    const applied = enhancement.status === "applied";
    const classification = await completeClassification(
      this.deps,
      prepared,
      {
        topK,
        ...(applied
          ? { semanticQuery: enhancement.text, queryFormat: "input_first" }
          : {}),
      },
      signal,
    );
    return { classification, enhancementStatus: enhancement.status };
  }
}
