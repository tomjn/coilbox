import { fileURLToPath } from "node:url";
import { lingui } from "@lingui/vite-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // The same macro transform and catalog loading as vite.config.ts, which
  // vitest does not read.
  plugins: [lingui({ macroTransform: true, failOnCompileError: true })],
  // Mirror the `@` → src alias from vite.config.ts so tests that transitively
  // import `@/components/ui/*` (e.g. multiplayer store → VerificationCodeDialog)
  // resolve it — vitest doesn't read vite.config.ts's resolve settings.
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    // Node everywhere by default. Most of this suite has no React in it, and a
    // DOM costs roughly 150ms per file to stand up, so the files that need one
    // ask for it themselves with a `// @vitest-environment happy-dom` docblock
    // on their first line (see `src/hub/assets/useMapPicture.test.tsx`). Vitest
    // 4 dropped `environmentMatchGlobs`, so a directory rule would mean a second
    // project rather than a pattern.
    environment: "node",
    // Activates the source locale, so a `t` call in a plain module works.
    setupFiles: ["./src/vitest.runtime.setup.ts", "./src/i18n/vitest.setup.ts"],
    // `.tsx` for the tests that render a component, which write JSX rather than
    // nesting `createElement` calls by hand.
    include: ["src/**/*.test.ts", "src/**/*.test.tsx", "scripts/**/*.test.mjs"],
    server: {
      deps: {
        // picoframe ships ESM with extensionless relative imports, which vite
        // resolves for the app but node does not for a test. Inlining it hands
        // those imports back to vite. Needed by any test that reaches the plugin
        // list, e.g. settingsTree.test.ts.
        inline: [/@picoframe\//],
      },
    },
  },
});
