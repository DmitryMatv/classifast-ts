import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { AppModule } from "./app.module.js";
import { APP_CONFIG, type AppConfig } from "./config/app-config.js";
import { loadEnvFileIfPresent } from "./config/env-file.js";
import { configureHttpApp } from "./http-app.js";

loadEnvFileIfPresent(new URL("../.env", import.meta.url));

const app = await NestFactory.create<NestExpressApplication>(AppModule);
configureHttpApp(app);
app.enableShutdownHooks();
const { host, port } = app.get<AppConfig>(APP_CONFIG).server;
await app.listen(port, host);
