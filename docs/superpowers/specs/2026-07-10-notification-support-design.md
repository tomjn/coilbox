# Notification support (issue #169)

## Goal

Give Coilbox two complementary notification layers:

- **In-app toasts** — transient feedback inside the webview (sonner).
- **OS notifications** — native desktop banners delivered even when Coilbox is unfocused or minimized (`@tauri-apps/plugin-notification`).

Scope for this pass: build the shared infrastructure **and** wire three high-value triggers to prove it end to end.

## Decisions (locked during brainstorming)

- **Scope:** infrastructure + a few triggers.
- **Toast library:** sonner, pulled via the shadcn registry into `src/components/ui/sonner.tsx` (picoframe's `@picoframe` registry has no sonner, so the generic shadcn registry is used). The `sonner` npm package comes in underneath.
- **Routing:** a single focus-aware `notify()` helper. Window focused → in-app toast only. Window unfocused/minimized → OS notification (falling back to a toast if permission is not granted). No duplicate banners.
- **Settings:** a small "Notifications" settings section — enable/disable toggle plus a permission request / test button.
- **Download trigger:** wrapped at the binding layer (one file), not per call site.
- **Deferred:** lobby / multiplayer notifications (feature still unfinished, noisier) — not in this pass.

## Architecture

A new `src/notify/` plugin, shaped like the existing `updater` plugin (a `Provider` for app-wide mount + a `settings` section, registered in `src/app.plugins.ts`).

### Units

**`src/notify/notify.ts`** — the imperative core, importable from anywhere (React or plain modules like `bindings.ts`).

- `type NotifyLevel = "info" | "success" | "error"`
- `route(focused: boolean, osEnabled: boolean, permGranted: boolean): "toast" | "os"` — **pure**, the single unit-tested decision function:
  - `focused` → `"toast"`
  - `!focused && osEnabled && permGranted` → `"os"`
  - otherwise → `"toast"` (fallback: OS disabled, or permission not granted)
- `async notify({ title, body?, level? }): Promise<void>` — the IO wrapper:
  1. read `notifications.os.enabled` from settings storage (default `true` when unset),
  2. read window focus via `getCurrentWindow().isFocused()`,
  3. read cached OS permission state,
  4. call `route(...)`; then either `toast[level](title, { description: body })` (sonner) or `sendNotification({ title, body })` followed by a best-effort `requestUserAttention` (dock bounce / taskbar flash),
  5. never throws — any OS-send failure is caught and downgraded to a toast.
- Re-exports `toast` (sonner) for direct foreground-only use (e.g. the settings "test" button, or plain success/error toasts that never need an OS banner).

Permission handling: `notify()` only routes to the OS path when permission is **already granted**. Granting is an explicit user action in the settings section (`requestPermission()`), not a lazy prompt mid-flow. Until granted, everything falls back to toasts — no functionality is blocked.

**`src/components/ui/sonner.tsx`** — the shadcn sonner `Toaster`, themed to picoframe's CSS variables (matching the existing registry components' theming approach). Pulled via `npx shadcn@latest add`.

**`src/notify/Toaster.tsx`** — thin wrapper around the registry `Toaster` if any app-specific defaults (position, richColors) are needed; otherwise the registry component is used directly from the plugin `Provider`.

**`src/notify/NotificationsSettings.tsx`** — the settings section:

- an enable/disable OS-notifications `switch` (registry `switch` component + `useSetting("notifications.os.enabled")`),
- a permission status line (granted / denied / not yet requested),
- a "Grant permission" button (calls `requestPermission()`, refreshes status) shown when not granted,
- a "Send test notification" button (calls `notify(...)`), so the user can confirm the whole path.

**`src/notify/index.ts`** — the `FramePlugin`:

- `Provider`: renders `{children}` plus the sonner `<Toaster/>` (mounts the toast host once, app-wide),
- `settings`: one entry `{ id: "notifications", title: "Notifications", icon: Bell, Component: NotificationsSettings }`.

Registered in `src/app.plugins.ts` alongside the other frame-level plugins (`generalPlugin`, `profilePlugin`, `updaterPlugin`, `gameUpdatesPlugin`).

### Backend wiring

- npm dependency: `@tauri-apps/plugin-notification`.
- Cargo dependency: `tauri-plugin-notification` (v2) in `src-tauri/Cargo.toml`.
- Register in `src-tauri/src/main.rs`: `.plugin(tauri_plugin_notification::init())` alongside the other core plugins (dialog/opener/process/updater).
- Capability: add `notification:default` to `src-tauri/capabilities/default.json`. (`core:window:allow-request-user-attention` is already present, so the dock-bounce needs no new permission.)

## Triggers

1. **Download complete / failed** — wrap the download-start bindings in `src/downloads/bindings.ts`:
   `dlDownload`, `dlDownloadMap`, `dlDownloadFile`, `dlDownloadEngineRecoil`, `dlDownloadEngineSpring`.
   Each wrapped function fires `notify({ level: "success" | "error", ... })` when the underlying command settles, deriving a human-readable label from the call's `tag` / `springname` / URL / engine version. This covers all ~8 call sites (GamesPage, MapsPage, ExplorerPage, ReplayDetailPage, SuggestionsList, BattleOverlay, game-updates, engine install, branding) with no call-site edits. Automatic/background downloads also toast, but focus-aware routing keeps those to an in-app toast (window is focused), never an OS banner.

2. **App update available** — in `src/updater/UpdaterProvider.tsx` `runCheck`, `notify(...)` when `found` is non-null (a new release was detected). Complements the existing topbar pill.

3. **Game update available** — in `src/game-updates/GameUpdatesProvider.tsx`, `notify(...)` when `updateAvailable` transitions to `true`. Mirrors the app-update case.

Each trigger fires once per event (guard against React effect re-runs / repeated checks re-notifying the same state).

## Error handling

- `notify()` never throws; OS-send failures downgrade to a toast and log.
- Permission is only requested via explicit user action; denial is a permanent (until OS-reset) fallback to toasts, surfaced in the settings status line.
- Download-binding wrappers must re-throw the original error after notifying, so existing callers' `catch` blocks and progress UIs are unaffected — the notification is a side effect, not a behavior change.

## Testing

- **Unit:** `route()` — the focus/enabled/permission truth table (vitest, mirroring the repo's existing vitest usage).
- **Unit:** the download-binding wrapper — success notifies with a success level, failure notifies with an error level **and re-throws**.
- **Manual (via `bun tauri dev`):** grant permission in settings; send a test notification; trigger a real download and confirm a toast when focused and an OS banner when the window is backgrounded; confirm the enable/disable toggle suppresses OS banners.

## Out of scope

- Lobby / multiplayer / chat notifications.
- A notification history / center.
- Per-trigger granular toggles (single global OS on/off only).
- Sound customization beyond the OS default.
