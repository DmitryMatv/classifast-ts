import { Module } from "@nestjs/common";
import { APP_CONFIG, type AppConfig } from "../config/app-config.js";
import { createQdrantClient } from "../qdrant/qdrant-connection.js";
import {
  EMBEDDING_CLIENT,
  HealthController,
  QDRANT_CLIENT,
} from "./health.controller.js";

const QDRANT_TIMEOUT_MS = 30_000;

@Module({
  controllers: [HealthController],
  providers: [
    {
      provide: EMBEDDING_CLIENT,
      inject: [APP_CONFIG],
      useFactory: ({ embedding }: AppConfig) =>
        embedding.client.enabled ? embedding.client : null,
    },
    {
      provide: QDRANT_CLIENT,
      inject: [APP_CONFIG],
      useFactory: ({ qdrant }: AppConfig) =>
        createQdrantClient(
          { QDRANT_URL: qdrant.url, QDRANT_API_KEY: qdrant.apiKey },
          QDRANT_TIMEOUT_MS,
        ),
    },
  ],
})
export class HealthModule {}
