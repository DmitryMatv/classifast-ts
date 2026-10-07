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
        },
      },
    ],
  },
});
