import { Controller, Get, HttpException, Inject } from "@nestjs/common";
import type { QdrantClient } from "@qdrant/js-client-rest";
import { APP_CONFIG, type AppConfig } from "../config/app-config.js";
import { isHealthy } from "./health.js";

export const QDRANT_CLIENT = Symbol("QDRANT_CLIENT");

@Controller()
export class HealthController {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(QDRANT_CLIENT)
    private readonly qdrant: Pick<QdrantClient, "getCollections">,
  ) {}

  @Get("health")
  async health(): Promise<{ status: "healthy" }> {
    const healthy = await isHealthy({
      // Unit 4 replaces this with the initialized embedding client.
      embeddingReady: this.config.embedding.client.enabled,
      probeQdrant: () => this.qdrant.getCollections(),
    });
    if (!healthy) {
      throw new HttpException({ detail: "Service Unavailable" }, 503);
    }
    return { status: "healthy" };
  }
}
