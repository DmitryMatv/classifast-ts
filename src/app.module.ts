import { Module } from "@nestjs/common";
import { ConfigModule } from "./config/config.module.js";
import { HealthModule } from "./health/health.module.js";
import { StaticModule } from "./static/static.module.js";

@Module({
  imports: [ConfigModule, HealthModule, StaticModule],
})
export class AppModule {}
