import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "assets",
          environment: "jsdom",
          include: ["app/assets/ts/**/*.test.ts"],
          setupFiles: ["app/assets/ts/test/setup.ts"],
          restoreMocks: true,
          clearMocks: true,
          mockReset: true,
        },
      },
      {
        test: {
          name: "server",
          globals: true,
          include: ["src/**/*.spec.ts"],
          setupFiles: ["test/support/quiet-nest-logger.ts"],
          exclude: ["src/**/*.redis.spec.ts"],
        },
      },
      {
        test: {
          name: "redis",
          globals: true,
          include: ["src/**/*.redis.spec.ts"],
          globalSetup: ["test/support/redis-server.global-setup.ts"],
        },
      },
    ],
  },
});
