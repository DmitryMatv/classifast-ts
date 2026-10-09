import { RedisMemoryServer } from "redis-memory-server";
import type { TestProject } from "vitest/node";

declare module "vitest" {
  export interface ProvidedContext {
    redisUrl: string;
  }
}

const REDIS_7_FOR_EXPIRE_NX = "7.4.2";

export default async function setup(project: TestProject) {
  const server = new RedisMemoryServer({
    binary: { version: REDIS_7_FOR_EXPIRE_NX },
  });
  project.provide(
    "redisUrl",
    `redis://${await server.getHost()}:${await server.getPort()}`,
  );
  return async () => {
    await server.stop();
  };
}
