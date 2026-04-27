import * as path from "node:path";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      vscode: path.resolve(__dirname, "tests/mock/vscode.ts"),
    },
    extensions: [".mts", ".ts", ".tsx", ".mjs", ".js", ".jsx", ".json"],
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
