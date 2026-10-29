import tailwindcss from "@tailwindcss/vite";
import { defineConfig, type Plugin } from "vite";

const SITE_BUNDLE = "js/site.js";

// Pages version site.js with one ?v= content hash. A chunk it imported
// would have no ?v=, and Cloudflare keeps JS for 12 h (STATIC_CODE), so a
// new site.js could run against a stale chunk. Fail the build instead.
function checkBundle(): Plugin {
  return {
    name: "check-bundle",
    generateBundle(_options, bundle) {
      const site = bundle[SITE_BUNDLE];
      if (site?.type !== "chunk") {
        this.error(`${SITE_BUNDLE} was not built`);
      }
      const imports = [...site.imports, ...site.dynamicImports];
      if (imports.length > 0) {
        this.error(
          `${SITE_BUNDLE} must not import anything, but imports ${imports.join(", ")}`,
        );
      }
    },
  };
}

// vite.legacy.config.ts builds the scripts that cached pre-island HTML
// still loads. `npm run build` runs both configs.
export default defineConfig({
  plugins: [tailwindcss(), checkBundle()],
  oxc: { jsx: { runtime: "automatic" } },
  build: {
    outDir: "app/static",
    emptyOutDir: false,
    sourcemap: false,
    target: "es2022",
    rollupOptions: {
      input: {
        site: "app/assets/ts/site.tsx",
        styles: "app/assets/css/input.css",
      },
      output: {
        entryFileNames: "js/[name].js",
        assetFileNames: (assetInfo) =>
          assetInfo.names?.some((name) => name.endsWith(".css"))
            ? "css/styles.css"
            : "assets/[name][extname]",
      },
    },
  },
});
