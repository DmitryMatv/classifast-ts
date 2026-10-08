import { Global, Module } from "@nestjs/common";
import { APP_CONFIG, parseAppConfig } from "./app-config.js";

@Global()
@Module({
  providers: [
    { provide: APP_CONFIG, useFactory: () => parseAppConfig(process.env) },
  ],
  exports: [APP_CONFIG],
})
export class ConfigModule {}
