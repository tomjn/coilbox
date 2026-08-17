import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // Mirror the `@` → src alias from vite.config.ts so tests that transitively
  // import `@/components/ui/*` (e.g. multiplayer store → VerificationCodeDialog)
  // resolve it — vitest doesn't read vite.config.ts's resolve settings.
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
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
