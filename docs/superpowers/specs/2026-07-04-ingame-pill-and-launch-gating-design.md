# In-game pill + app-wide launch gating

**Date:** 2026-07-04 **Status:** Approved, ready for implementation plan

## Problem

While a game is running, coilbox is alt-tabbed to the background. Two gaps:

1. **No way back to the game.** The user has to hunt for the game window in the OS window switcher. We want a visible, one-click "return to the game" control.
2. **Launch buttons lie.** Each launcher (single-player skirmish, multiplayer battle, replay playback) keeps its *own* local `running` flag. So while a game is live, the *other* launchers still look clickable, and clicking them just hits a backend rejection ("a game is already running"). The user asked to "prevent launching single player if we're in a multiplayer game and vice versa" — which is really this UX gap.

## Key finding that shapes the design

All three launch paths funnel through the **same** backend:

- `SkirmishPage` → `playLaunch`
- `useBattleLaunch` (multiplayer) → `playLaunch`
- `WatchButton` (replay) → `playLaunchReplay`

…all landing in the `coilbox-play` plugin's `RunRegistry` (`Arc<Mutex<HashMap<run_id, std::process::Child>>>`). Both launch commands already reject a second launch while the registry is non-empty. **So mutual exclusion is already correct at the backend** — regardless of game type. There is no new backend gating logic to write. The missing piece is purely frontend: there is no app-wide "a game is running" state; it lives and dies inside each launcher.

Therefore both features share one foundation: **lift game-running state into an app-wide provider** (mirroring the existing `UpdaterProvider` + `UpdateBadge` slot pattern), which the pill and every launcher read from.

## Architecture

```
PlayProvider  (new React context, mirrors src/updater/UpdaterProvider)
  state:
    running:     boolean
    activeRunId: string | null
    kind:        "skirmish" | "battle" | "replay" | null
  actions:
    launch(opts)     // owns Channel<LaunchEvent> + playLaunch/playLaunchReplay
                     // + running lifecycle (set running on start, clear in finally)
    focusGame()      // invoke play_focus(activeRunId)

  consumed by:
    InGameBadge    (topbar.right slot)  -> pill; focusGame() on click
    SkirmishPage   -> running gates its controls (existing freeze) + start button
    useBattleLaunch-> delegates running/launch to provider
    WatchButton    -> disabled while running; routes replay launch through provider
```

Registered in `src/play/index.ts`:

```ts
Provider: PlayProvider,
slots: [{ slot: "topbar.right", order: -10, Component: InGameBadge }],
```

`order: -10` places the pill left of the existing `UpdateBadge` (`order: 0`) in the right slot — slots sort ascending, so the pill is the leftmost item there.

### Feature 1 — the pill (`src/play/InGameBadge.tsx`)

- Returns `null` unless `usePlay().running`.
- Orange pulsing pill, styled after `UpdateBadge.tsx` but with orange tokens and a pulse: `rounded-full bg-orange-500/15 text-orange-500 animate-pulse`, a filled dot + label "In game". `onClick={focusGame}`. Tooltip: "Return to the game".
- `orange-*` are Tailwind literal color utilities (the theme's CSS-var tokens have no orange); `animate-pulse` is a built-in Tailwind animation.

### Feature 2 — launch gating

Every launch button reads `usePlay().running` and is `disabled` when true:

- `SkirmishPage` start button (page already freezes its settings via local `running`; that local flag is replaced by the shared one).
- Multiplayer battle launch (`useBattleLaunch` consumers).
- `WatchButton` replay playback.

No new backend logic — this only makes the UI reflect the constraint the backend already enforces.

## Refocus (Rust, `coilbox-play` plugin)

New command; PID never crosses IPC (frontend passes `run_id`, Rust resolves it to the live `Child`):

```
play_focus(run_id: String) -> CliResult
  let pid = registry.lock().get(&run_id).map(|c| c.id());   // None -> "no such run"
  focus::focus_pid(pid)
```

New `src/focus.rs`, cfg-gated per platform:

- **macOS:** `NSRunningApplication::runningApplicationWithProcessIdentifier(pid)` then `.activateWithOptions(.activateAllWindows)` — via `objc2` + `objc2-app-kit`.
- **Windows:** `EnumWindows`, match each window's owning PID (`GetWindowThreadProcessId`) against the target, `SetForegroundWindow` the match — via the `windows` crate.
- **Linux / X11:** find the top-level window whose `_NET_WM_PID` equals the target and send a `_NET_ACTIVE_WINDOW` client message to the root — via `x11rb`.
- **Wayland / anything else:** no-op returning ok (Wayland forbids one app force-focusing another). The pill still shows; the click simply does nothing. This limitation is called out in the command's doc comment.

ACL wiring (required, per this project's plugin-command-ACL rule): add `play_focus` to `build.rs` `COMMANDS` and to `permissions/default.toml`, else it is blocked at runtime.

### New dependencies (approved)

All target-gated so they don't affect other platforms:

- `objc2`, `objc2-app-kit` — `[target.'cfg(target_os = "macos")'.dependencies]`
- `windows` (features for `Win32_UI_WindowsAndMessaging` / `Win32_Foundation`) — `[target.'cfg(target_os = "windows")'.dependencies]`
- `x11rb` — `[target.'cfg(target_os = "linux")'.dependencies]`

## Out of scope

- Detecting whether the game window actually came to the foreground (fire-and-forget).
- Multiple simultaneous games (backend is single-slot by design).
- Any change to the backend mutual-exclusion rule (already correct).

## Verification

- Static: `cargo fmt --all --check`, `cargo clippy --all-targets --all-features -D warnings`, `bunx biome ci .`, `bun run typecheck`.
- Live (macOS, `bun tauri dev`): launch a skirmish, alt-tab back to coilbox, confirm the orange pill appears in the top bar and that other launch buttons (battle, replay) are disabled; click the pill and confirm focus returns to the game; on game exit confirm the pill disappears and buttons re-enable.
- Windows / X11 refocus verified best-effort (not testable on the dev Mac; note this explicitly rather than claiming it works).
