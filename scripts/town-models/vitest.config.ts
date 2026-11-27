import { mkdirSync } from "node:fs";
import { lingui } from "@lingui/vite-plugin";
import { defineConfig } from "vitest/config";

// Everything the bakes write goes to the gitignored reports folder.
mkdirSync(new URL("../../docs/reports/town-models/", import.meta.url), {
  recursive: true,
});

export default defineConfig({
  plugins: [lingui({ macroTransform: true })],
  resolve: {
    alias: { "@": new URL("../../src", import.meta.url).pathname },
  },
  test: {
    root: new URL(".", import.meta.url).pathname,
    include: ["*.test.ts"],
    environment: "node",
    testTimeout: 600000,
  },
});
