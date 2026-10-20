import { Module } from "@nestjs/common";
import { ClassificationModule } from "../classifier/classification.module.js";
import { QdrantModule } from "../qdrant/qdrant.module.js";
import { RapidApiAuthGuard } from "./rapidapi-auth.guard.js";
import { RapidApiController } from "./rapidapi.controller.js";

@Module({
  imports: [ClassificationModule, QdrantModule],
  controllers: [RapidApiController],
  providers: [RapidApiAuthGuard],
})
export class RapidApiModule {}
