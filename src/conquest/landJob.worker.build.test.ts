import { fileURLToPath } from "node:url";
import { build } from "vite";
import { expect, test } from "vitest";

/**
 * Vite bundles a worker with its own plugin list, and only for a production
 * build. The dev server and vitest both run the macro transform on a worker's
 * modules, so only a real build shows what a release ships.
 */
test("the production land worker has its Lingui macros compiled", async () => {
  const root = fileURLToPath(new URL("../..", import.meta.url));
  const result = await build({
    root,
    configFile: "vite.config.ts",
    logLevel: "silent",
    build: {
      write: false,
      rollupOptions: { input: "src/conquest/landJobs.ts" },
    },
  });
  if (!("output" in result)) throw new Error("expected one bundle");

  const worker = result.output.find((file) =>
    file.fileName.includes("landJob.worker"),
  );
  if (!worker) throw new Error("the build emitted no land worker");
  const code = worker.type === "asset" ? String(worker.source) : worker.code;

  expect(code).not.toContain("outside the context of compilation");
});
