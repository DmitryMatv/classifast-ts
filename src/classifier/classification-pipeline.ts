import { Logger } from "@nestjs/common";
import { normalizeOriginalIdForLookup } from "../qdrant/id-lookup.js";
import {
  ClassificationError,
  MIN_RERANK_BUDGET_SECONDS,
  applyRerankScores,
  excludeIdMatches,
  exactIdShortcutResults,
  isPartialIdQuery,
  mergeClassificationResults,
  semanticRetrieveLimit,
  useRerankScores,
  withRerankScore,
  type ClassificationResult,
  type RerankedResult,
} from "./classification.js";
import type {
  ClassifierConfig,
  ClassifierConfigMap,
  ClassifierVersion,
} from "./classifier-config.js";
import type { HfEmbeddingClient } from "./hf-embedding.js";
import {
  buildQueryEmbeddingText,
  buildRerankQueryText,
  defaultRerankDocument,
  type QueryFormat,
} from "./model-text.js";
import type { OpenRouterReranker } from "./openrouter-reranker.js";
import type { Clock } from "./outbound.js";
import {
  exactIdSearch,
  partialIdSearch,
  semanticSearch,
  type QdrantSearchClient,
} from "./qdrant-search.js";
import { sanitizeQueryText } from "./query-text.js";

const logger = new Logger("Classifier");

export type Embedder = Pick<HfEmbeddingClient, "embed">;
export type Reranker = Pick<OpenRouterReranker, "rerank">;

export interface PipelineDeps {
  readonly classifiers: ClassifierConfigMap;
  readonly embedder: Embedder | null;
  readonly qdrant: QdrantSearchClient;
  readonly quantizationCache: ReadonlyMap<string, boolean>;
  readonly reranker: Reranker | null;
  readonly outboundBudgetSeconds: number;
  readonly clock: Clock;
}

export interface Classification {
  readonly results: readonly ClassificationResult[];
  readonly versionName: string;
  readonly version: ClassifierVersion;
  /** The sanitized query that the ID searches used. */
  readonly query: string;
}

export interface PreparedClassification {
  readonly classifierType: string;
  readonly config: ClassifierConfig;
  readonly versionName: string;
  readonly version: ClassifierVersion;
  readonly query: string;
  readonly exactResults: readonly ClassificationResult[];
  readonly exactMs: number;
}

export interface CompletionOptions {
  readonly topK: number;
  /** Text to embed and rerank instead of the query; ID searches keep the query. */
  readonly semanticQuery?: string;
  readonly queryFormat?: QueryFormat;
  /** `clock.now()` milliseconds by which outbound calls must finish. */
  readonly deadline?: number;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function resolveVersion(
  deps: PipelineDeps,
  classifierType: string,
  version: string | undefined,
): Pick<PreparedClassification, "config" | "versionName" | "version"> {
  const config = deps.classifiers[classifierType.toUpperCase()];
  if (!config) {
    throw new ClassificationError(
      404,
      `Classifier '${classifierType}' not found`,
    );
  }
  if (version && !Object.hasOwn(config.versions, version)) {
    throw new ClassificationError(
      404,
      `Version '${version}' for classifier '${classifierType}' not found`,
    );
  }
  const versionName = version || (Object.keys(config.versions)[0] ?? "");
  return { config, versionName, version: config.versions[versionName]! };
}

export async function prepareClassification(
  deps: PipelineDeps,
  query: string,
  classifierType: string,
  version: string | undefined,
): Promise<PreparedClassification> {
  const resolved = resolveVersion(deps, classifierType, version);
  if (!deps.embedder) {
    throw new ClassificationError(
      503,
      "Backend services not available. Please check server logs.",
    );
  }
  const sanitized = sanitizeQueryText(query);
  if (sanitized.kind === "invalid") {
    throw new ClassificationError(400, sanitized.detail);
  }
  logger.log(
    `CLASSIFICATION_QUERY: classifier=${classifierType} query='${sanitized.query}'`,
  );

  const exactStart = deps.clock.now();
  let exactResults: ClassificationResult[];
  try {
    exactResults = await exactIdSearch(
      deps.qdrant,
      resolved.version.collectionName,
      sanitized.query,
    );
  } catch (error) {
    logger.warn(`Exact ID search failed: ${errorText(error)}`);
    exactResults = [];
  }
  return {
    ...resolved,
    classifierType,
    query: sanitized.query,
    exactResults,
    exactMs: deps.clock.now() - exactStart,
  };
}

function classification(
  prepared: PreparedClassification,
  results: readonly ClassificationResult[],
): Classification {
  return {
    results,
    versionName: prepared.versionName,
    version: prepared.version,
    query: prepared.query,
  };
}

/** The finished classification when an exact ID matched, else undefined. */
export function exactOutcome(
  prepared: PreparedClassification,
  topK: number,
): Classification | undefined {
  if (prepared.exactResults.length === 0) return undefined;
  logger.log(
    `ID_SEARCH: exact=${prepared.exactResults.length} partial=0 exact_ms=${prepared.exactMs.toFixed(2)} partial_ms=0.00`,
  );
  logger.log(
    `ID_SEARCH_SHORTCUT: classifier=${prepared.classifierType} query='${prepared.query}' matches=${prepared.exactResults.length}`,
  );
  return classification(
    prepared,
    exactIdShortcutResults(prepared.exactResults, topK),
  );
}

async function partialIdResults(
  deps: PipelineDeps,
  collectionName: string,
  query: string,
): Promise<ClassificationResult[]> {
  const normalizedIdQuery = normalizeOriginalIdForLookup(query);
  if (!isPartialIdQuery(normalizedIdQuery)) return [];
  try {
    return await partialIdSearch(
      deps.qdrant,
      collectionName,
      normalizedIdQuery,
    );
  } catch (error) {
    logger.warn(`Partial ID search failed: ${errorText(error)}`);
    return [];
  }
}

async function embedQuery(
  deps: PipelineDeps & { embedder: Embedder },
  config: ClassifierConfig,
  text: string,
  maxSeconds: number,
  signal: AbortSignal,
): Promise<number[]> {
  try {
    return await deps.embedder.embed(
      {
        model: config.embedModelName,
        text,
        dims: config.embedDims,
        maxSeconds,
      },
      signal,
    );
  } catch (error) {
    if (signal.aborted) throw error;
    logger.error(`Embedding generation failed: ${errorText(error)}`);
    throw new ClassificationError(
      500,
      "Failed to generate embedding for classification",
    );
  }
}

export interface RerankOptions {
  readonly topK: number;
  readonly rerankTopN: number;
  readonly instruction?: string;
  readonly queryFormat?: QueryFormat;
  readonly timeoutSeconds?: number;
}

/**
 * Reranks the first `rerankTopN` candidates. The rest follow with a rerank
 * score of 0. When the reranker fails, returns the first `topK` candidates
 * unchanged.
 */
export async function rerankCandidates(
  reranker: Reranker,
  query: string,
  candidates: readonly ClassificationResult[],
  { topK, rerankTopN, instruction, queryFormat, timeoutSeconds }: RerankOptions,
  signal: AbortSignal,
): Promise<ClassificationResult[]> {
  if (candidates.length === 0) return [];
  const toRerank = candidates.slice(0, rerankTopN);
  const remaining = candidates.slice(toRerank.length);
  let reranked: RerankedResult[];
  try {
    logger.log(
      `RERANK: OpenRouter reranking ${toRerank.length} candidates for query='${Array.from(query).slice(0, 50).join("")}'`,
    );
    const scores = await reranker.rerank(
      buildRerankQueryText(query, instruction, queryFormat),
      toRerank.map((candidate) => defaultRerankDocument(candidate.payload)),
      { timeoutSeconds, signal },
    );
    reranked = applyRerankScores(toRerank, scores);
    const top = reranked[0];
    if (top) {
      logger.log(
        `RERANK_COMPLETE: Top result=${String(top.payload.original_id ?? "N/A")} score=${(top.rerankRelevanceScore * 100).toFixed(2)} (reranked ${toRerank.length} docs)`,
      );
    }
  } catch (error) {
    if (signal.aborted) throw error;
    logger.warn(
      `RERANK_FAILED: OpenRouter reranking failed: ${errorText(error)}, using semantic search scores`,
    );
    return candidates.slice(0, topK);
  }
  return [...reranked, ...withRerankScore(remaining, 0.0)].slice(0, topK);
}

export async function rankSemanticResults(
  deps: PipelineDeps,
  query: string,
  semantic: readonly ClassificationResult[],
  idMatches: readonly ClassificationResult[],
  options: Omit<RerankOptions, "timeoutSeconds"> & { deadline: number },
  signal: AbortSignal,
): Promise<ClassificationResult[]> {
  const { topK, deadline } = options;
  if (deps.reranker && idMatches.length === 0 && semantic.length > 0) {
    const remainingSeconds = (deadline - deps.clock.now()) / 1000;
    if (remainingSeconds < MIN_RERANK_BUDGET_SECONDS) {
      logger.warn(
        `RERANK_STATUS: Skipped - outbound budget exhausted (${Math.max(0, remainingSeconds).toFixed(2)}s left)`,
      );
      return withRerankScore(semantic.slice(0, topK), 0.0);
    }
    logger.log(
      `RERANK_STATUS: Using OpenRouter for ${semantic.length} semantic candidates`,
    );
    return useRerankScores(
      await rerankCandidates(
        deps.reranker,
        query,
        semantic,
        { ...options, timeoutSeconds: remainingSeconds },
        signal,
      ),
    );
  }
  if (idMatches.length > 0) {
    logger.log("RERANK_STATUS: Skipped - ID matches present");
  } else if (!deps.reranker) {
    logger.log("RERANK_STATUS: Skipped - OpenRouter reranker not available");
  }
  return withRerankScore(semantic.slice(0, topK), 0.0);
}

export async function completeClassification(
  deps: PipelineDeps,
  prepared: PreparedClassification,
  options: CompletionOptions,
  signal: AbortSignal,
): Promise<Classification> {
  const { topK, semanticQuery, queryFormat = "legacy" } = options;
  const shortcut = exactOutcome(prepared, topK);
  if (shortcut) return shortcut;
  const { embedder } = deps;
  if (!embedder) {
    throw new ClassificationError(
      503,
      "Backend services not available. Please check server logs.",
    );
  }

  const deadline =
    options.deadline ?? deps.clock.now() + deps.outboundBudgetSeconds * 1000;
  const { config, version, classifierType } = prepared;
  try {
    const partialStart = deps.clock.now();
    const partialResults = await partialIdResults(
      deps,
      version.collectionName,
      prepared.query,
    );
    logger.log(
      `ID_SEARCH: exact=0 partial=${partialResults.length} exact_ms=${prepared.exactMs.toFixed(2)} partial_ms=${(deps.clock.now() - partialStart).toFixed(2)}`,
    );
    signal.throwIfAborted();
    const rerankingEnabled =
      deps.reranker !== null && partialResults.length === 0;
    const limit = semanticRetrieveLimit(topK, rerankingEnabled);
    logger.log(
      `SEMANTIC_SEARCH: Fetching top ${limit} candidates (reranking=${rerankingEnabled ? "enabled" : "disabled"}, id_matches=${partialResults.length})`,
    );
    const semanticText = semanticQuery || prepared.query;

    const vector = await embedQuery(
      { ...deps, embedder },
      config,
      buildQueryEmbeddingText(
        semanticText,
        config.queryInstruction,
        queryFormat,
      ),
      (deadline - deps.clock.now()) / 1000,
      signal,
    );
    signal.throwIfAborted();
    let semanticResults: ClassificationResult[];
    try {
      semanticResults = await semanticSearch(
        deps.qdrant,
        version.collectionName,
        vector,
        {
          limit,
          quantized:
            deps.quantizationCache.get(version.collectionName) ?? false,
          exact: classifierType.toUpperCase() !== "UNSPSC",
        },
      );
    } catch (error) {
      logger.error(`Semantic search failed: ${errorText(error)}`);
      throw new ClassificationError(
        500,
        "Semantic search failed. Please try again.",
      );
    }
    signal.throwIfAborted();

    const ranked = await rankSemanticResults(
      deps,
      semanticText,
      excludeIdMatches(semanticResults, partialResults),
      partialResults,
      {
        topK,
        rerankTopN: limit,
        instruction: config.rerankInstruction,
        queryFormat,
        deadline,
      },
      signal,
    );
    return classification(
      prepared,
      mergeClassificationResults(partialResults, ranked, topK),
    );
  } catch (error) {
    if (error instanceof ClassificationError || signal.aborted) throw error;
    logger.error(
      `Classification error for '${classifierType}': ${errorText(error)}`,
    );
    throw new ClassificationError(500, "Error processing request");
  }
}

export interface ClassificationInput {
  readonly query: string;
  readonly classifierType: string;
  readonly version?: string;
  readonly topK: number;
  readonly semanticQuery?: string;
}

export async function performClassification(
  deps: PipelineDeps,
  { query, classifierType, version, topK, semanticQuery }: ClassificationInput,
  signal: AbortSignal,
): Promise<Classification> {
  const deadline = deps.clock.now() + deps.outboundBudgetSeconds * 1000;
  const prepared = await prepareClassification(
    deps,
    query,
    classifierType,
    version,
  );
  signal.throwIfAborted();
  return completeClassification(
    deps,
    prepared,
    { topK, semanticQuery, deadline },
    signal,
  );
}
