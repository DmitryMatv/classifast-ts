import { defineConfig } from "vite";

// The pre-island scripts, built byte for byte as before. Cloudflare serves
// HTML up to about a day old, and that HTML loads these files, so they stay
// until no cached page references them.
export default defineConfig({
  build: {
    outDir: "app/static",
    emptyOutDir: false,
    sourcemap: false,
    target: "es2022",
    rollupOptions: {
      input: {
        common: "app/assets/ts/common.ts",
        classifier: "app/assets/ts/classifier.ts",
        paywall: "app/assets/ts/paywall.ts",
        storefront: "app/assets/ts/storefront.ts",
      },
      output: {
        entryFileNames: "js/[name].js",
        chunkFileNames: "js/[name].js",
      },
    },
  },
});
