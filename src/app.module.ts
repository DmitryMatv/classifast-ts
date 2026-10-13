import { Module } from "@nestjs/common";
import { ConfigModule } from "./config/config.module.js";
import { HealthModule } from "./health/health.module.js";
import { StaticModule } from "./static/static.module.js";
import { ClassifierPageModule } from "./web/classifier-page.module.js";
import { WebModule } from "./web/web.module.js";

@Module({
  imports: [
    ConfigModule,
    HealthModule,
    StaticModule,
    WebModule,
    ClassifierPageModule,
  ],
})
export class AppModule {}
