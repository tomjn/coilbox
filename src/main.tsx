import { AppFrame, type HomeOverride } from "@picoframe/frame";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { plugins } from "./app.plugins";
import SetupHome from "./content/pages/SetupHome";
import { ErrorBoundary } from "./general/ErrorBoundary";
import { SPLASH_ENABLED_KEY } from "./general/splash";
import { applyProfileSettingsHiding } from "./profile/hidden";
import { applyProfileLinks } from "./profile/links";
import {
  applyBootBackground,
  forceProfileTheme,
  loadProfile,
  resolveSplashSrc,
} from "./profile/profile";
import Splash from "./profile/Splash";
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

// Paint the profile's boot background immediately (ending any white flash this
// session) and cache it so the index.html boot script applies it before first paint
// next launch. No-op when the profile sets no background.
applyBootBackground();

// Force the profile's colour scheme / accent (if set) before render — pre-seeds
// picoframe's persisted theme so the brand wins even over a player's prior choice.
forceProfileTheme();

// Hide any settings sections the profile lists (uses SettingsSection.useVisible,
// injected centrally so no plugin needs to opt in). No-op without a profile.
const appPlugins = applyProfileLinks(applyProfileSettingsHiding(plugins));

// The OS title bar is a separate surface from the AppFrame `title` prop (which
// drives in-app chrome), and is otherwise fixed by tauri.conf.json. Best-effort:
// a failure here must not block startup.
getCurrentWindow()
  .setTitle(appTitle)
  .catch((e) => console.warn("profile: could not set window title", e));

// Apply the fullscreen state before render so a fullscreen session doesn't flash
// a windowed frame on launch. `fullscreenLocked` (kiosk) forces it on, overriding
// everything. Otherwise seed semantics apply: an unset key falls back to the
// profile's `fullscreen` default; once the user has toggled it the stored value
// wins. The settings cache holds JSON-serialized values, so the boolean is "true".
const fullscreenRaw = settingsStorage.get("window.fullscreen");
const fullscreenOn = profile.fullscreenLocked
  ? true
  : fullscreenRaw === null
    ? profile.fullscreen === true
    : fullscreenRaw === "true";
if (fullscreenOn) {
  getCurrentWindow()
    .setFullscreen(true)
    .catch((e) => console.warn("fullscreen: boot apply failed", e));
}

// Theme overrides re-point picoframe's CSS variables app-wide (every colour token
// is a CSS var), so a branded build recolours the whole shell, not just the welcome.
if (profile.theme) {
  for (const [name, value] of Object.entries(profile.theme)) {
    document.documentElement.style.setProperty(name, value);
  }
}

// Vanilla Coilbox uses picoframe's built-in launcher home; the content plugin
// contributes the first-run setup card via the `home.top` slot, so it rides above
// the launcher's tool grid. A branded build (profile.welcome present) instead
// overrides `/` with SetupHome, letting its welcome take over the page (with the
// setup card above it).
const home: HomeOverride | undefined = profile.welcome
  ? { Component: SetupHome }
  : undefined;

// Resolve the startup splash before first paint (so the image is ready and there's
// no empty-overlay flash). Skipped when the profile has no splash or the user turned
// it off — only an explicit "false" suppresses it, so an unset key still shows.
const splashOn =
  profile.splash != null && settingsStorage.get(SPLASH_ENABLED_KEY) !== "false";
const splashSrc = splashOn ? await resolveSplashSrc() : null;

// Dev-only: install the tauri-plugin-mcp webview bridge so the Tauri MCP server's
// execute_js / query_page / type_text / wait_for / manage_storage tools work.
// Statically dropped from release builds (import.meta.env.DEV === false).
if (import.meta.env.DEV) {
  const { setupTauriMcpBridge } = await import("./dev/setup-tauri-mcp");
  await setupTauriMcpBridge();
}

// A single logged choke-point for otherwise-silent failures: an un-`.catch`ed
// command rejection or a stray runtime error would otherwise be console-only (or
// nothing). We don't auto-surface these as UI — many rejections are best-effort
// boot calls already handled above — but we make sure they're never invisible.
window.addEventListener("unhandledrejection", (e) => {
  console.error("coilbox: unhandled promise rejection", e.reason);
});
window.addEventListener("error", (e) => {
  console.error("coilbox: uncaught error", e.error ?? e.message);
});

createRoot(root).render(
  <StrictMode>
    <ErrorBoundary>
      <AppFrame
        plugins={appPlugins}
        title={appTitle}
        home={home}
        settingsStorage={settingsStorage}
      />
    </ErrorBoundary>
    {profile.splash && splashSrc && (
      <Splash config={profile.splash} src={splashSrc} />
    )}
  </StrictMode>,
);
