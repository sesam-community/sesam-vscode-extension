import { defineConfig } from "vite";
import { resolve } from "path";
import { builtinModules } from "module";

export default defineConfig({
  resolve: {
    alias: {
      "@sesam/core": resolve(__dirname, "../core/src/index.ts"),
    },
    extensions: [".mts", ".ts", ".tsx", ".mjs", ".js", ".jsx", ".json"],
  },
  build: {
    lib: {
      entry: resolve(__dirname, "client/src/extension.ts"),
      formats: ["cjs"],
    },
    outDir: "dist/client",
    emptyOutDir: true,
    sourcemap: true,
    minify: false,
    target: "node20",
    rollupOptions: {
      external: ["vscode", ...builtinModules, ...builtinModules.map((m) => `node:${m}`)],
      output: {
        entryFileNames: "[name].js",
        chunkFileNames: "[name].js",
      },
    },
  },
});
