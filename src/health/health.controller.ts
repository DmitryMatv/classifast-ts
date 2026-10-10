import { Controller, Get, HttpException, Inject } from "@nestjs/common";
import type { QdrantClient } from "@qdrant/js-client-rest";
import { EMBEDDING_CLIENT } from "../classifier/classification.module.js";
import { QDRANT_CLIENT } from "../qdrant/qdrant.module.js";
import { isHealthy } from "./health.js";

@Controller()
export class HealthController {
  constructor(
    @Inject(EMBEDDING_CLIENT) private readonly embeddingClient: object | null,
    @Inject(QDRANT_CLIENT)
    private readonly qdrant: Pick<QdrantClient, "getCollections">,
  ) {}

  @Get("health")
  async health(): Promise<{ status: "healthy" }> {
    const healthy = await isHealthy({
      embeddingReady: this.embeddingClient !== null,
      probeQdrant: () => this.qdrant.getCollections(),
    });
    if (!healthy) {
      throw new HttpException({ detail: "Service Unavailable" }, 503);
    }
    return { status: "healthy" };
  }
}
