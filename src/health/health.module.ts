import { Module } from "@nestjs/common";
import { ClassificationModule } from "../classifier/classification.module.js";
import { QdrantModule } from "../qdrant/qdrant.module.js";
import { HealthController } from "./health.controller.js";

@Module({
  imports: [ClassificationModule, QdrantModule],
  controllers: [HealthController],
})
export class HealthModule {}
