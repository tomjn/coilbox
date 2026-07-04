import { AppFrame, type HomeOverride } from "@picoframe/frame";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { plugins } from "./app.plugins";
import BrandedWelcome from "./profile/BrandedWelcome";
import { applyProfileSettingsHiding } from "./profile/hidden";
import { forceProfileTheme, loadProfile } from "./profile/profile";
import { createTauriSettingsStorage } from "./settings-storage";
import "./index.css";

const root = document.getElementById("root");
if (!root) throw new Error("missing #root element");

// Hydrate the settings cache from app-data before first render, so useSetting
// reads return persisted values synchronously on mount.
const settingsStorage = await createTauriSettingsStorage();

// Load the distribution profile (a bundler-supplied .coilbox/profile.json) before
// first render so the title, theme, and welcome are applied without a flash of the
// default. Absent profile => empty, so vanilla Coilbox is untouched.
const { profile } = await loadProfile();
const appTitle = profile.title ?? "Coilbox";

// Force the profile's colour scheme / accent (if set) before render — pre-seeds
// picoframe's persisted theme so the brand wins even over a player's prior choice.
forceProfileTheme();

// Hide any settings sections the profile lists (uses SettingsSection.useVisible,
// injected centrally so no plugin needs to opt in). No-op without a profile.
const appPlugins = applyProfileSettingsHiding(plugins);

// The OS title bar is a separate surface from the AppFrame `title` prop (which
// drives in-app chrome), and is otherwise fixed by tauri.conf.json. Best-effort:
// a failure here must not block startup.
getCurrentWindow()
  .setTitle(appTitle)
  .catch((e) => console.warn("profile: could not set window title", e));

// Theme overrides re-point picoframe's CSS variables app-wide (every colour token
// is a CSS var), so a branded build recolours the whole shell, not just the welcome.
if (profile.theme) {
  for (const [name, value] of Object.entries(profile.theme)) {
    document.documentElement.style.setProperty(name, value);
  }
}

// A profile with a `welcome` block replaces the default launcher home with the
// branded landing page; without one, the default home is kept.
const home: HomeOverride | undefined = profile.welcome
  ? { Component: BrandedWelcome }
  : undefined;

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
      plugins={appPlugins}
      title={appTitle}
      home={home}
      settingsStorage={settingsStorage}
    />
  </StrictMode>,
);
