# Coilbox Self-Updater - Design

Date: 2026-07-01
Status: Approved (design), pending implementation plan

## Goal

Let Coilbox detect when a newer GitHub release exists and update itself in-app:
download, verify, install, and relaunch. Replace the current state where a user
has no in-GUI signal that a new version is out and no way to update without
manually finding and downloading a release.

## Non-goals

- macOS notarization / removing the "unidentified developer" first-run friction
  (orthogonal; the updater's signature verification is independent of Apple
  signing).
- Self-update for Linux `.deb` / `.rpm` packaging (not currently shipped; the
  plugin would no-op there). AppImage self-update is in scope.
- Auto-download or fully-automatic install. Install is always an explicit user
  action.

## Chosen approach

Use Tauri v2's official updater plugin against GitHub Releases as the manifest
host. This is an integration of a maintained package, not custom update logic.

- Rust: `tauri-plugin-updater` and `tauri-plugin-process` (for `relaunch()`),
  registered in `src-tauri/src/main.rs` alongside the existing plugins.
- JS: `@tauri-apps/plugin-updater` and `@tauri-apps/plugin-process`.

## Architecture

### App-side: a new frame-level `updater` plugin

The app is composed purely of feature plugins in `src/app.plugins.ts`, with no
app-level plugin and nothing update-related in `main.tsx`. Add a small plugin
under `src/updater/` following the same picoframe convention, exporting a
`FramePlugin`, and register it in `app.plugins.ts`.

The plugin owns:

1. **State/logic module** wrapping the plugin API:
   - `check()` -> `Update | null` (carries target version + release notes).
   - `update.downloadAndInstall(onEvent)` streaming `Started` (content length),
     `Progress` (chunk), `Finished`.
   - `relaunch()` from `@tauri-apps/plugin-process` after install.
   - `getVersion()` from `@tauri-apps/api/app` for the current version display.
   - A shared store (React context or a small store) holding: current version,
     last-checked time, found update (or null), download progress, and error.

2. **`topbar.right` slot contribution** - a compact indicator. Rendered as
   nothing when up to date; when an update is found, an "Update available" pill
   that navigates to the About / Updates settings section.

3. **`settings` section ("About / Updates")** showing:
   - Current version.
   - "Check for updates" button + last-checked timestamp.
   - When an update is found: target version and release notes.
   - "Download & install" button -> progress bar (Started/Progress/Finished) ->
     "Restart now" (calls `relaunch()`).
   - Inline error display for manual checks.

### Behaviour

- **Launch check:** in release builds only, fire one background `check()` on
  startup. On an update, reveal the pill and populate the settings section. Do
  not download.
- **Manual:** the settings button re-runs `check()` and surfaces errors inline.
- **Install:** only ever on explicit user click.
- **Dev guard:** gate the launch auto-check behind `import.meta.env.DEV` being
  false. Source version is the `0.0.0` placeholder (real version is injected
  from the git tag in CI), so a dev build would treat every release as newer.
  In dev, the section may show but the auto-check does not fire.
- **Errors:** the launch check fails silently (offline, or 404 before the first
  release with a manifest is published). Manual checks show the error.

### Release-side (GitHub Releases as host)

- **Endpoint** in `tauri.conf.json` under `plugins.updater.endpoints`:
  `https://github.com/tomjn/coilbox/releases/latest/download/latest.json`.
  This URL resolves only to the latest **published, non-draft, non-prerelease**
  release. The existing manual "publish the draft" step remains the release gate
  - no workflow restructuring needed.
- **`plugins.updater.pubkey`**: the public key content (not a path) from
  `tauri signer generate`.
- **CI (`.github/workflows/release.yml`):** `tauri-action` auto-generates
  `latest.json` and per-artifact `.sig` files and uploads them to the release
  **when signing env vars are set**. Add `TAURI_SIGNING_PRIVATE_KEY` (and
  `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`) to the build job's env from repo
  secrets. Bundle is already `"targets": "all"`; with the updater active plus a
  signing key, Tauri emits the updater artifacts (macOS `.app.tar.gz`, Linux
  AppImage, Windows NSIS) and their signatures.
- **Capabilities:** add the updater + process permissions to a capabilities file
  (e.g. `updater:default`, `process:allow-restart`). Per the Tauri plugin ACL
  model, plugin commands are runtime-blocked without an allowing capability.

## One-time human-owned prerequisite

`tauri signer generate` produces a minisign keypair. This is done once by a
human who holds the private key; it cannot be automated by the implementation:

- Paste the **public** key into `tauri.conf.json` `plugins.updater.pubkey`.
- Store the **private** key and its password as GitHub Actions repository
  secrets (`TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`).

Until this is done, CI cannot sign artifacts and the updater will reject
unsigned updates. The plan will surface this as a blocking checklist item, not
as code.

## Risks / must-validate

- **macOS**: minisign verification is independent of Apple code signing, so the
  update mechanism works with the current ad-hoc (`signingIdentity: "-"`),
  unnotarized build. But self-replacing the unnotarized `.app` and relaunching
  past Gatekeeper must be validated on real Apple Silicon hardware - treat "the
  updated app reopens cleanly" as a required manual test, not an assumption.
- **Linux**: self-update works for the AppImage (the current Linux artifact). If
  `.deb`/`.rpm` are ever shipped, the plugin must no-op on those install
  methods.
- **First publish**: the endpoint 404s until the first release carrying a
  `latest.json` is published; the launch check must tolerate this quietly.

## Success criteria

1. A release build launched at an older version shows the `topbar.right` pill
   and populates the About / Updates section with the new version + notes.
2. "Download & install" shows real progress and, on Restart, relaunches into the
   new version (verified on macOS arm64, Linux AppImage, Windows).
3. Dev builds do not fire the launch check and never show a false "update
   available".
4. With no network / before first publish, launch check fails silently; manual
   check reports the error inline.
