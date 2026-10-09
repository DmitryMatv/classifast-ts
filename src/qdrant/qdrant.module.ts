import { Logger, Module } from "@nestjs/common";
import type { QdrantClient } from "@qdrant/js-client-rest";
import { classifierConfigFor } from "../classifier/classifier-config.js";
import { APP_CONFIG, type AppConfig } from "../config/app-config.js";
import { createQdrantClient } from "./qdrant-connection.js";
import {
  QdrantSchemaValidationError,
  formatValidationIssue,
  validateConfiguredCollections,
} from "./qdrant-schema.js";

export const QDRANT_CLIENT = Symbol("QDRANT_CLIENT");
/** Collection name to whether it is quantized, from the boot schema check. */
export const QUANTIZATION_CACHE = Symbol("QUANTIZATION_CACHE");

const QDRANT_TIMEOUT_MS = 30_000;
const logger = new Logger("Qdrant");

/** Boot fails, as Python's startup does, when the schema check fails. */
async function checkSchemaAtBoot(
  client: QdrantClient,
  { embedding }: AppConfig,
): Promise<ReadonlyMap<string, boolean>> {
  try {
    const cache = await validateConfiguredCollections(
      client,
      classifierConfigFor(embedding),
    );
    logger.log(
      `Qdrant schema validation succeeded for ${cache.size} configured collections.`,
    );
    return cache;
  } catch (error) {
    if (error instanceof QdrantSchemaValidationError) {
      for (const issue of error.issues) {
        logger.error(
          `Qdrant contract violation: ${formatValidationIssue(issue)}`,
        );
      }
    }
    throw error;
  }
}

@Module({
  providers: [
    {
      provide: QDRANT_CLIENT,
      inject: [APP_CONFIG],
      useFactory: ({ qdrant }: AppConfig) => {
        logger.log(`Connecting to Qdrant at ${qdrant.url}...`);
        return createQdrantClient(
          { QDRANT_URL: qdrant.url, QDRANT_API_KEY: qdrant.apiKey },
          QDRANT_TIMEOUT_MS,
        );
      },
    },
    {
      provide: QUANTIZATION_CACHE,
      inject: [QDRANT_CLIENT, APP_CONFIG],
      useFactory: checkSchemaAtBoot,
    },
  ],
  exports: [QDRANT_CLIENT, QUANTIZATION_CACHE],
})
export class QdrantModule {}
