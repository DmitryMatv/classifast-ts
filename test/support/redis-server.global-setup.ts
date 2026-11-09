import { homedir } from "node:os";
import { join } from "node:path";
import { RedisMemoryServer } from "redis-memory-server";
import type { TestProject } from "vitest/node";

declare module "vitest" {
  export interface ProvidedContext {
    redisUrl: string;
  }
}

const REDIS_7_FOR_EXPIRE_NX = "7.4.2";

// redis-memory-server compiles Redis from source on first use (`.npmrc` sets
// ignore-scripts, so nothing prebuilds it). Its default cache lives in
// node_modules, which every `npm ci` deletes; this one survives.
const DOWNLOAD_DIR =
  process.env.REDISMS_DOWNLOAD_DIR ??
  join(
    process.env.XDG_CACHE_HOME ?? join(homedir(), ".cache"),
    "redis-memory-server",
    "redis-binaries",
  );

export default async function setup(project: TestProject) {
  const server = new RedisMemoryServer({
    binary: { version: REDIS_7_FOR_EXPIRE_NX, downloadDir: DOWNLOAD_DIR },
  });
  project.provide(
    "redisUrl",
    `redis://${await server.getHost()}:${await server.getPort()}`,
  );
  return async () => {
    await server.stop();
  };
}
