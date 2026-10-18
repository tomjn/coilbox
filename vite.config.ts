import { fileURLToPath } from "node:url";
import { lingui } from "@lingui/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// https://v2.tauri.app/start/frontend/vite/
export default defineConfig({
  // lingui() turns the `t` and `Trans` macros into runtime calls, in .ts files
  // as well as .tsx, and compiles a `.po` catalog when it is imported.
  plugins: [
    react(),
    lingui({ macroTransform: true, failOnCompileError: true }),
    tailwindcss(),
  ],
  clearScreen: false,
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: {
    port: 1430,
    strictPort: true,
  },
  optimizeDeps: { entries: ["index.html"] },
  envPrefix: ["VITE_", "TAURI_"],
  build: {
    target:
      process.env.TAURI_ENV_PLATFORM === "windows" ? "chrome120" : "safari15",
  },
});
