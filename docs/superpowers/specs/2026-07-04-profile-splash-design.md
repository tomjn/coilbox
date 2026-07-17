# Distribution-profile startup splash

## Goal

Let a distribution `profile.json` show a brand splash at startup: a centered image that fades in on a solid background and then fades out, covering the window completely, over a configurable total duration (default 2s). Plays on every launch, but the user can turn it off and can click (or press a key) to dismiss it early.

Vanilla Coilbox (no profile, or a profile without `splash`) is unaffected.

## Config schema (`src/profile/profile.ts`)

```ts
/** Startup brand splash: a centered image over a solid backdrop, fade in -> hold -> fade out. */
interface SplashConfig {
  /**
   * Image to show centered. Either a `.coilbox/`-relative path (read by the Rust
   * `coilbox-profile` plugin into a data URI), OR an inline `data:` / `http(s):`
   * URL used verbatim.
   */
  image: string;
  /** Solid backdrop CSS color. Defaults to the theme background token. */
  background?: string;
  /** Total splash duration in ms (fade in + hold + fade out). Default 2000. */
  duration?: number;
}

// Profile gains:
//   /** Brand splash shown once per launch, over the whole window. */
//   splash?: SplashConfig;
```

One string field covers both the offline local-file case and an inline data/URL, with no schema fork.

## Rust: `profile_asset` command (`crates/tauri-plugin-coilbox-profile`)

New command that serves a file from the portable root as a data URI, so the webview (which cannot read `.coilbox/` files directly) can display it offline.

- Input: a relative path string.
- Reads `<portable_root>/<path>`, base64-encodes into `data:<mime>;base64,...`. MIME inferred from extension (webp/png/jpg/jpeg/gif/svg), default `application/octet-stream`.
- Guards: reject absolute paths and any component equal to `..`, so it can only serve files inside `.coilbox/`. Non-portable install or missing file returns an empty string (splash silently skipped). Never hard-fails, matching the crate's existing "fail soft" contract.
- Wiring: add `"profile_asset"` to `build.rs` COMMANDS and `allow-profile-asset` to `permissions/default.toml`. The capability already grants `coilbox-profile:default` to the main window.

Pure core (`read_asset_from(root, path, read)`) split out for unit tests covering: serves a present file, rejects `..`, rejects absolute path, empty when not portable.

## User toggle (`splash.enabled`)

A user preference to silence the splash. Key `splash.enabled`, boolean, default `true` (unset == on).

- `useSplashSetting()` helper in `src/general/` (or `profile.ts`) wrapping `useSetting<boolean>("splash.enabled", true)`, mirroring `useFullscreenSetting`.
- A `Switch` row under the General settings **Display** section (next to Fullscreen), rendered only when `getProfile().splash` exists — no dead toggle in vanilla Coilbox.
- Boot read in `main.tsx`: treat only an explicit `"false"` as off (`settingsStorage.get("splash.enabled") !== "false"`), so an unset key still shows.

## Startup resolution (`src/main.tsx`)

In the existing pre-render `await` block, after `loadProfile()`:

- If `profile.splash` is absent, or the user disabled it -> no splash.
- Else resolve `splash.image` to a usable `src`:
  - starts with `data:` or `http` -> use verbatim.
  - otherwise -> `await` the `profile_asset` invoke; empty result -> no splash.
- Resolving before first paint means the image is ready immediately (no empty-overlay flash that an in-component fetch would cause).

A small helper in `profile.ts` (`resolveSplashSrc()`) owns the data:/http/relative branching and the `profile_asset` command binding, keeping `main.tsx` thin.

## Component (`src/profile/Splash.tsx`)

- `position: fixed` full-window overlay, high `z-index`, solid `background` (from config, default `hsl(var(--background))`), image centered and size-capped (e.g. `max-width/height` with padding so it never touches the edges).
- Self-timed lifecycle over `duration` (default 2000ms), phases as fractions:
  - `0 -> 20%`: image opacity 0 -> 1 (backdrop already opaque)
  - `20% -> 70%`: hold
  - `70% -> 100%`: whole overlay opacity 1 -> 0
  - at `100%`: component unmounts itself (via internal state + timers).
- **Dismiss early**: a click/pointer-down anywhere on the overlay, or pressing `Escape`/`Enter`/`Space`, jumps straight to the fade-out phase and then unmounts (a quick fade rather than an abrupt cut). Timers are cleared on dismiss and on unmount. The overlay is a `<button>`-like focusable surface with an accessible label ("Dismiss splash") so the interaction is keyboard-reachable, not mouse-only.
- `prefers-reduced-motion: reduce`: skip the fades; show briefly, then remove. Click/key dismiss still removes it immediately.
- Rendered as a sibling above `<AppFrame>` in `main.tsx`, only when a resolved splash src exists. Fully decoupled from app load state — it's a timed flash, not a readiness-gated loading screen.

## Non-goals

- No "show once" persistence (plays every launch, unless the user disables it).
- No multiple images / slideshow, no sound.
- No asset serving beyond the splash use case (command is general but only wired for this).

## Testing

- Rust unit tests on `read_asset_from` (present / `..` / absolute / non-portable).
- Live: portable `.coilbox/profile.json` with a `splash` block (local webp and/or the Splinter Faction logo URL) via `bun tauri dev`; confirm fade in -> hold -> fade out over ~2s covering the window, then normal app. Confirm click/Escape dismisses early, and the General-settings toggle suppresses it next launch.
- Full lint suite per CLAUDE.md before PR (cargo fmt/clippy, biome ci, typecheck).
