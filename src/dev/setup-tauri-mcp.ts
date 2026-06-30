// Dev-only: install the tauri-plugin-mcp webview bridge.
//
// The Rust plugin (registered behind `#[cfg(debug_assertions)]` in
// src-tauri/src/main.rs) drives the webview by emitting events such as
// `execute-js`, `get-page-map`, `wait-for` and `get-local-storage`, then waiting
// for a correlated `*-response`. Those listeners live in the vendored bridge's
// `setupPluginListeners()`. If nothing calls it, the plugin's `execute_js`,
// `query_page` (map/find_element), `type_text`, `navigate`, `wait_for` and
// `manage_storage` tools time out (only the Rust-only tools — screenshots,
// window management, logs — work). This wires the missing half.
//
// The bridge import is intentionally only reached under `import.meta.env.DEV`, so
// release builds tree-shake it out entirely.
export async function setupTauriMcpBridge(): Promise<void> {
  try {
    const { setupPluginListeners } = await import("./tauri-mcp-bridge");
    await setupPluginListeners();
  } catch (err) {
    console.error("[tauri-mcp] failed to install webview bridge", err);
  }
}
