import { AppFrame, type HomeOverride } from "@picoframe/frame";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { plugins } from "./app.plugins";
import { ErrorBoundary } from "./general/ErrorBoundary";
import { SPLASH_ENABLED_KEY } from "./general/splash";
import CoilboxHome from "./home/CoilboxHome";
import { loadHomeMarkup } from "./home/markup";
import { applyProfilePages } from "./profile/CustomPage";
import { applyProfileSettingsHiding } from "./profile/hidden";
import { applyProfileSlots, buildLayoutConfig } from "./profile/layout";
import { applyProfileLinks } from "./profile/links";
import { loadProfilePages } from "./profile/pages";
import {
  applyBootBackground,
  applyProfileSidebarSeed,
  forceProfileTheme,
  loadProfile,
  resolveProfileImage,
  resolveSplashSrc,
  resolveWelcome,
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

// Seed the sidebar-collapsed state from the profile (only when the user has no
// stored value), before render so the sidebar starts in the intended state.
applyProfileSidebarSeed();

// Resolve the profile's layout images (popover menu logo + the three top-bar slot
// logos) before first render, like the splash — a `.coilbox`-relative path round-
// trips to a data URI, so it must be awaited before building the layout config /
// slot contributions. All null without a profile (or when the paths don't resolve).
const menuImageSrc = await resolveProfileImage(profile.layout?.menu?.image);
const logoImages = {
  left: await resolveProfileImage(profile.layout?.left?.image),
  center: await resolveProfileImage(profile.layout?.center?.image),
  right: await resolveProfileImage(profile.layout?.right?.image),
};

// Load the profile's custom markdown pages (.coilbox/pages/*.md) before finalizing
// the plugin list, so their routes + nav items can be injected below. No-op (empty)
// without a profile or a pages folder.
await loadProfilePages();

// Resolve the welcome's html/css `@.coilbox/...` file references to text before render
// so BrandedWelcome has its content ready (like the splash/logo resolves above). No-op
// when the profile has no welcome; inline fragments resolve to themselves.
await resolveWelcome();

// Read the `@.coilbox/...` markup the profile's `home` zones reference, for the
// same reason and by the same route: rendering is synchronous, so a distribution's
// intro sentence has to be in memory before the home page draws. A no-op (no file
// IO at all) for a profile with no `home` key.
await loadHomeMarkup(profile.home);

// Hide any settings sections the profile lists (uses SettingsSection.useVisible,
// injected centrally so no plugin needs to opt in). No-op without a profile.
// applyProfileSlots injects the profile's top-bar logos (left/center/right slots);
// a no-op when the profile sets none. applyProfilePages adds the custom-page routes
// and their sidebar nav; a no-op when the profile ships no pages.
const appPlugins = applyProfilePages(
  applyProfileSlots(
    applyProfileLinks(applyProfileSettingsHiding(plugins)),
    logoImages,
  ),
);

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

// Coilbox owns `/` for everyone, branded or not (issue #985). CoilboxHome picks
// the arm: a profile with a `welcome` gets that welcome as the whole page, and
// everything else gets Coilbox's own layout, which still renders the `home.top`
// and `home.bottom` slots picoframe plugins inject into. Unconditional because
// picoframe's launcher is a placeholder we've outgrown, and because leaving it
// installed for vanilla builds would mean maintaining two homes.
const home: HomeOverride = { Component: CoilboxHome };

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
        layout={buildLayoutConfig(profile, menuImageSrc)}
        settingsStorage={settingsStorage}
      />
    </ErrorBoundary>
    {profile.splash && splashSrc && (
      <Splash config={profile.splash} src={splashSrc} />
    )}
  </StrictMode>,
);
