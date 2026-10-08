import { Module } from "@nestjs/common";
import { APP_CONFIG, type AppConfig } from "../config/app-config.js";
import {
  GoogleCrawlerRanges,
  GoogleCrawlerVerifier,
} from "./google-crawlers.js";

@Module({
  providers: [
    {
      provide: GoogleCrawlerVerifier,
      inject: [APP_CONFIG],
      useFactory: ({ googleCrawler }: AppConfig) =>
        new GoogleCrawlerVerifier(
          googleCrawler,
          new GoogleCrawlerRanges(googleCrawler),
        ),
    },
  ],
  exports: [GoogleCrawlerVerifier],
})
export class CrawlersModule {}
