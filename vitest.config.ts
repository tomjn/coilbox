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
    include: ["src/**/*.test.ts", "scripts/**/*.test.mjs"],
  },
});
