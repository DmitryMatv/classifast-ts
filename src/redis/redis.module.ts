import {
  Global,
  Inject,
  Module,
  type OnApplicationShutdown,
} from "@nestjs/common";
import { APP_CONFIG, type AppConfig } from "../config/app-config.js";
import {
  connectRedis,
  REDIS_CONNECTION,
  type RedisConnection,
} from "./redis-client.js";

@Global()
@Module({
  providers: [
    {
      provide: REDIS_CONNECTION,
      inject: [APP_CONFIG],
      useFactory: ({ redis }: AppConfig) => connectRedis(redis),
    },
  ],
  exports: [REDIS_CONNECTION],
})
export class RedisModule implements OnApplicationShutdown {
  constructor(
    @Inject(REDIS_CONNECTION) private readonly redis: RedisConnection | null,
  ) {}

  async onApplicationShutdown(): Promise<void> {
    if (this.redis) await this.redis.close();
  }
}
