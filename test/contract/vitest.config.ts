import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "jsdom",
    include: ["test/contract/**/*.contract.ts"],
    testTimeout: 30_000,
    // Python admits one classification at a time. Files run one after another
    // so the full-mode queue overflow case cannot starve another file's page.
    fileParallelism: false,
    // Vitest overwrites process.env.BASE_URL with Vite's base path ("/") inside
    // test files, so the server URL travels under another name.
    env: { CONTRACT_BASE_URL: process.env["BASE_URL"] ?? "" },
  },
});
