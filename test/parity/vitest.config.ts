import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["test/parity/**/*.parity.ts"],
    globalSetup: ["test/parity/servers.global-setup.ts"],
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
});
