import { Module } from "@nestjs/common";
import { PagesController } from "./pages.controller.js";
import { loadSitemapQueryPaths, SITEMAP_QUERY_PATHS } from "./sitemap.js";

@Module({
  controllers: [PagesController],
  providers: [
    { provide: SITEMAP_QUERY_PATHS, useFactory: () => loadSitemapQueryPaths() },
  ],
  exports: [SITEMAP_QUERY_PATHS],
})
export class WebModule {}
