import { Module } from "@nestjs/common";
import { ClassificationModule } from "../classifier/classification.module.js";
import { CrawlersModule } from "../crawlers/crawlers.module.js";
import { ClassifierPageController } from "./classifier-page.controller.js";
import { WebModule } from "./web.module.js";

// Its routes match any first path segment, so AppModule imports it last.
@Module({
  imports: [ClassificationModule, CrawlersModule, WebModule],
  controllers: [ClassifierPageController],
})
export class ClassifierPageModule {}
