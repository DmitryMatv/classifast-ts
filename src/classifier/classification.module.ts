import {
  Inject,
  Logger,
  Module,
  type BeforeApplicationShutdown,
} from "@nestjs/common";
import type { QdrantClient } from "@qdrant/js-client-rest";
import { APP_CONFIG, type AppConfig } from "../config/app-config.js";
import {
  QDRANT_CLIENT,
  QUANTIZATION_CACHE,
  QdrantModule,
} from "../qdrant/qdrant.module.js";
import { ClassificationQueue } from "./classification-queue.js";
import { ClassificationService } from "./classification-service.js";
import { classifierConfigFor } from "./classifier-config.js";
import { HfEmbeddingClient } from "./hf-embedding.js";
import { OpenRouterReranker } from "./openrouter-reranker.js";
import { systemClock } from "./outbound.js";
import { QueryEnhancer } from "./query-enhancer.js";

export const EMBEDDING_CLIENT = Symbol("EMBEDDING_CLIENT");
const RERANKER = Symbol("RERANKER");
const QUERY_ENHANCER = Symbol("QUERY_ENHANCER");

const logger = new Logger("ClassificationModule");

@Module({
  imports: [QdrantModule],
  providers: [
    {
      provide: EMBEDDING_CLIENT,
      inject: [APP_CONFIG],
      useFactory: ({ embedding: { client } }: AppConfig) => {
        if (!client.enabled) {
          logger.error(`Embedding client unavailable: ${client.reason}`);
          return null;
        }
        logger.log(
          `Hugging Face Inference client initialized with provider=${client.provider} timeout=${client.timeoutSeconds.toFixed(1)}s.`,
        );
        return new HfEmbeddingClient(client);
      },
    },
    {
      provide: RERANKER,
      inject: [APP_CONFIG],
      useFactory: ({ openRouter: { rerank } }: AppConfig) => {
        if (!rerank.enabled) {
          logger.warn(`OpenRouter reranker disabled: ${rerank.reason}`);
          return null;
        }
        logger.log(
          `OpenRouter reranker initialized with model=${rerank.model} provider=openrouter.`,
        );
        return new OpenRouterReranker(rerank);
      },
    },
    {
      provide: QUERY_ENHANCER,
      inject: [APP_CONFIG],
      useFactory: ({ openRouter: { queryEnhancer } }: AppConfig) =>
        queryEnhancer.enabled ? new QueryEnhancer(queryEnhancer.apiKey) : null,
    },
    {
      provide: ClassificationQueue,
      useFactory: () => new ClassificationQueue(),
    },
    {
      provide: ClassificationService,
      inject: [
        APP_CONFIG,
        EMBEDDING_CLIENT,
        QDRANT_CLIENT,
        QUANTIZATION_CACHE,
        RERANKER,
        QUERY_ENHANCER,
        ClassificationQueue,
      ],
      useFactory: (
        { embedding, classification }: AppConfig,
        embedder: HfEmbeddingClient | null,
        qdrant: QdrantClient,
        quantizationCache: ReadonlyMap<string, boolean>,
        reranker: OpenRouterReranker | null,
        enhancer: QueryEnhancer | null,
        queue: ClassificationQueue,
      ) =>
        new ClassificationService(
          {
            classifiers: classifierConfigFor(embedding),
            embedder,
            qdrant,
            quantizationCache,
            reranker,
            outboundBudgetSeconds: classification.outboundBudgetSeconds,
            clock: systemClock,
          },
          queue,
          enhancer,
        ),
    },
  ],
  exports: [EMBEDDING_CLIENT, ClassificationService],
})
export class ClassificationModule implements BeforeApplicationShutdown {
  constructor(
    @Inject(ClassificationQueue) private readonly queue: ClassificationQueue,
  ) {}

  /** Rejects waiting classifications and lets the active one finish. */
  beforeApplicationShutdown(): Promise<void> {
    return this.queue.close();
  }
}
