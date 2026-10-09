import { Module } from "@nestjs/common";
import { ConfigModule } from "./config/config.module.js";
import { HealthModule } from "./health/health.module.js";
import { RapidApiModule } from "./rapidapi/rapidapi.module.js";
import { StaticModule } from "./static/static.module.js";

@Module({
  imports: [ConfigModule, HealthModule, RapidApiModule, StaticModule],
})
export class AppModule {}
