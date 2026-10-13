import { Module } from "@nestjs/common";
import { ClassificationModule } from "../classifier/classification.module.js";
import { CrawlersModule } from "../crawlers/crawlers.module.js";
import { UsageModule } from "../usage/usage.module.js";
import { ClassifierPageController } from "./classifier-page.controller.js";
import { FragmentController } from "./fragment.controller.js";
import { WebModule } from "./web.module.js";

// Its routes match any first path segment, so AppModule imports it last.
// FragmentController must precede the classifier page catch-all.
@Module({
  imports: [ClassificationModule, CrawlersModule, UsageModule, WebModule],
  controllers: [FragmentController, ClassifierPageController],
})
export class ClassifierPageModule {}
