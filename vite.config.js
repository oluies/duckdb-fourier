import { defineConfig } from "vite";

// Relative base so the built dist/ can be served from any path (or file server)
// on an offline machine without rewriting asset URLs.
export default defineConfig({
  base: "./",
  build: {
    target: "esnext",
  },
  optimizeDeps: {
    // duckdb-wasm ships its worker/wasm as separate assets; let Vite pre-bundle
    // the main module but we resolve the worker + wasm ourselves via ?url.
    exclude: ["@duckdb/duckdb-wasm"],
  },
});
