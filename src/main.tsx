import { AppFrame } from "@picoframe/frame";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { plugins } from "./app.plugins";
import { createTauriSettingsStorage } from "./settings-storage";
import "./index.css";

const root = document.getElementById("root");
if (!root) throw new Error("missing #root element");

// Hydrate the settings cache from app-data before first render, so useSetting
// reads return persisted values synchronously on mount.
const settingsStorage = await createTauriSettingsStorage();

// Dev-only: install the tauri-plugin-mcp webview bridge so the Tauri MCP server's
// execute_js / query_page / type_text / wait_for / manage_storage tools work.
// Statically dropped from release builds (import.meta.env.DEV === false).
if (import.meta.env.DEV) {
  const { setupTauriMcpBridge } = await import("./dev/setup-tauri-mcp");
  await setupTauriMcpBridge();
}

createRoot(root).render(
  <StrictMode>
    <AppFrame
      plugins={plugins}
      title="Coilbox"
      settingsStorage={settingsStorage}
    />
  </StrictMode>,
);
