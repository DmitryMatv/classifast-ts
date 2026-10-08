import { Controller, Get, HttpException, Inject } from "@nestjs/common";
import type { QdrantClient } from "@qdrant/js-client-rest";
import { isHealthy } from "./health.js";

export const QDRANT_CLIENT = Symbol("QDRANT_CLIENT");
export const EMBEDDING_CLIENT = Symbol("EMBEDDING_CLIENT");

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
