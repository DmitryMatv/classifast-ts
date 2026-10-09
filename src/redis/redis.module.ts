import {
  Global,
  Inject,
  Module,
  type OnApplicationShutdown,
} from "@nestjs/common";
import { APP_CONFIG, type AppConfig } from "../config/app-config.js";
import {
  closeRedis,
  connectRedis,
  REDIS_CLIENT,
  type RedisClient,
} from "./redis-client.js";

@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      inject: [APP_CONFIG],
      useFactory: ({ redis }: AppConfig) => connectRedis(redis),
    },
  ],
  exports: [REDIS_CLIENT],
})
export class RedisModule implements OnApplicationShutdown {
  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: RedisClient | null,
  ) {}

  async onApplicationShutdown(): Promise<void> {
    if (this.redis) await closeRedis(this.redis);
  }
}
