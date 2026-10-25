import { Inject, Module, type BeforeApplicationShutdown } from "@nestjs/common";
import { ClassificationModule } from "../classifier/classification.module.js";
import {
  redisResultStore,
  SITEMAP_RESULT_STORE,
  SitemapResultCache,
  type ResultStore,
} from "../classifier/sitemap-result-cache.js";
import { CrawlersModule } from "../crawlers/crawlers.module.js";
import {
  REDIS_CONNECTION,
  type RedisConnection,
} from "../redis/redis-client.js";
import { RedisModule } from "../redis/redis.module.js";
import { UsageModule } from "../usage/usage.module.js";
import { ClassifierPageController } from "./classifier-page.controller.js";
import { FragmentController } from "./fragment.controller.js";
import { WebModule } from "./web.module.js";

// Its routes match any first path segment, so AppModule imports it last.
// FragmentController must precede the classifier page catch-all.
@Module({
  imports: [
    ClassificationModule,
    CrawlersModule,
    RedisModule,
    UsageModule,
    WebModule,
  ],
  controllers: [FragmentController, ClassifierPageController],
  providers: [
    {
      provide: SITEMAP_RESULT_STORE,
      inject: [REDIS_CONNECTION],
      useFactory: (redis: RedisConnection | null) =>
        redis ? redisResultStore(redis) : null,
    },
    {
      provide: SitemapResultCache,
      inject: [SITEMAP_RESULT_STORE],
      useFactory: (store: ResultStore | null) => new SitemapResultCache(store),
    },
  ],
})
export class ClassifierPageModule implements BeforeApplicationShutdown {
  constructor(
    @Inject(SitemapResultCache) private readonly cache: SitemapResultCache,
  ) {}

  beforeApplicationShutdown(): void {
    this.cache.close();
  }
}
