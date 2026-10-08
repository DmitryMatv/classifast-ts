import { RedisMemoryServer } from "redis-memory-server";
import type { TestProject } from "vitest/node";

declare module "vitest" {
  export interface ProvidedContext {
    redisUrl: string;
  }
}

// Production needs Redis 7+ for EXPIRE NX. A pinned 7.x server proves that
// floor. redis-memory-server builds it from source on first use.
const REDIS_VERSION = "7.4.2";

export default async function setup(project: TestProject) {
  const server = new RedisMemoryServer({
    binary: { version: REDIS_VERSION },
  });
  project.provide(
    "redisUrl",
    `redis://${await server.getHost()}:${await server.getPort()}`,
  );
  return async () => {
    await server.stop();
  };
}
