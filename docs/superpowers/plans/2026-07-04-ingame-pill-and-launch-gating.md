# In-game pill + app-wide launch gating Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show an orange pulsing "In game" pill in the top bar while a game/replay is running; clicking it refocuses the game window. Lift game-running state app-wide so every launcher (skirmish, multiplayer battle, replay) disables while any game runs.

**Architecture:** A new `PlayProvider` React context owns the single game-run lifecycle (running flag, active run id, kind) and the `playLaunch`/`playLaunchReplay` calls. The three existing launch call sites delegate to it. A `topbar.right` slot renders the pill from that shared state. A new Rust `play_focus(run_id)` command maps the run id to the live `Child`'s PID and raises its window per-platform (macOS/Windows/X11; Wayland is a graceful no-op).

**Tech Stack:** Tauri v2 plugin (Rust), React + TypeScript, Tailwind, picoframe plugin SDK. Per-platform window focus via `objc2-app-kit` (macOS), `windows` (Windows), `x11rb` (Linux/X11).

**Testing note (read first):** This repo's frontend test runner is `vitest` with **no DOM/testing-library harness**, so React context/component behaviour is not unit-testable here without adding dependencies (out of scope). OS window-focus is likewise not unit-testable. Verification for this feature is therefore: `cargo build`/`clippy`, `tsc` typecheck, `biome ci`, and a scripted **live** run via `bun tauri dev` (Task 9). Do not fabricate placeholder tests. The one genuinely testable unit — the provider's "refuse a second concurrent launch" guard — is covered by inspection in Task 3 (no DOM needed to reason about it, but no test harness exists to assert it; it is exercised live in Task 9).

**CI reality (ubuntu-22.04):** clippy in CI compiles the `x11rb` (Linux) path but NOT the macOS or Windows `cfg`-gated paths. macOS path is clippy-checked locally on the dev Mac. Windows path is checked via an optional cross-target clippy step (Task 1, Step 8); otherwise verified by inspection until the Windows release build.

---

## File structure

**Rust — `crates/tauri-plugin-coilbox-play/`:**
- Create `src/focus.rs` — per-platform `focus_pid(pid: u32) -> bool`.
- Modify `src/lib.rs` — add `mod focus;`, the `play_focus` command, register it in `generate_handler!`.
- Modify `Cargo.toml` — target-gated deps.
- Modify `build.rs` — add `play_focus` to `COMMANDS`.
- Modify `permissions/default.toml` — add `allow-play-focus`.

**Frontend — `src/play/`:**
- Modify `bindings.ts` — add `playFocus` binding.
- Create `PlayProvider.tsx` — the shared context.
- Create `InGameBadge.tsx` — the pill (default export).
- Modify `index.ts` — register `Provider` + the `topbar.right` slot.
- Modify `pages/SkirmishPage.tsx` — delegate launch to the provider.

**Frontend — other launchers:**
- Modify `src/multiplayer/battle/useBattleLaunch.ts` — delegate to the provider (public shape unchanged).
- Modify `src/content/pages/components/WatchButton.tsx` — delegate replay launch to the provider.

---

## Task 1: Rust `play_focus` command + per-platform focus module

**Files:**
- Create: `crates/tauri-plugin-coilbox-play/src/focus.rs`
- Modify: `crates/tauri-plugin-coilbox-play/Cargo.toml`
- Modify: `crates/tauri-plugin-coilbox-play/build.rs`
- Modify: `crates/tauri-plugin-coilbox-play/permissions/default.toml`
- Modify: `crates/tauri-plugin-coilbox-play/src/lib.rs`

- [ ] **Step 1: Add target-gated dependencies to `Cargo.toml`**

Append after the existing `[dependencies]` block:

```toml
[target.'cfg(target_os = "macos")'.dependencies]
objc2-app-kit = { version = "0.3", features = ["NSRunningApplication", "libc"] }

[target.'cfg(target_os = "windows")'.dependencies]
windows = { version = "0.62", features = [
  "Win32_Foundation",
  "Win32_UI_WindowsAndMessaging",
] }

[target.'cfg(target_os = "linux")'.dependencies]
x11rb = "0.13"
```

- [ ] **Step 2: Create `src/focus.rs`**

```rust
//! Best-effort "bring the running engine's window to the foreground" per platform.
//!
//! The frontend never sees a PID: `play_focus` maps a run id to the live child and
//! calls [`focus_pid`]. Wayland (and any unsupported target) is a graceful no-op
//! returning `false` — the pill still shows, the click just does nothing, because
//! no application can force-focus another under Wayland.

/// Raise the window owned by `pid`. Returns whether a focus request was dispatched
/// (not a guarantee the OS honoured it — foreground policy can still refuse).
#[cfg(target_os = "macos")]
pub fn focus_pid(pid: u32) -> bool {
    use objc2_app_kit::{NSApplicationActivationOptions, NSRunningApplication};
    // `runningApplicationWithProcessIdentifier` takes `libc::pid_t` (= i32 on Apple).
    match NSRunningApplication::runningApplicationWithProcessIdentifier(pid as i32) {
        Some(app) => app.activateWithOptions(NSApplicationActivationOptions::ActivateAllWindows),
        None => false,
    }
}

#[cfg(target_os = "windows")]
pub fn focus_pid(pid: u32) -> bool {
    use windows::Win32::Foundation::{BOOL, FALSE, HWND, LPARAM, TRUE};
    use windows::Win32::UI::WindowsAndMessaging::{
        EnumWindows, GetWindowThreadProcessId, IsWindowVisible, SetForegroundWindow,
    };

    struct Search {
        pid: u32,
        hwnd: HWND,
    }

    unsafe extern "system" fn cb(hwnd: HWND, lparam: LPARAM) -> BOOL {
        let search = &mut *(lparam.0 as *mut Search);
        let mut wpid: u32 = 0;
        GetWindowThreadProcessId(hwnd, Some(&mut wpid));
        if wpid == search.pid && IsWindowVisible(hwnd).as_bool() {
            search.hwnd = hwnd;
            return FALSE; // found a visible top-level window; stop enumerating
        }
        TRUE // keep going
    }

    let mut search = Search {
        pid,
        hwnd: HWND(std::ptr::null_mut()),
    };
    unsafe {
        // `EnumWindows` returns Err when the callback stops early — expected here.
        let _ = EnumWindows(Some(cb), LPARAM(&mut search as *mut _ as isize));
        if !search.hwnd.0.is_null() {
            return SetForegroundWindow(search.hwnd).as_bool();
        }
    }
    false
}

#[cfg(target_os = "linux")]
x11rb::atom_manager! {
    Atoms: AtomsCookie {
        _NET_CLIENT_LIST,
        _NET_WM_PID,
        _NET_ACTIVE_WINDOW,
    }
}

#[cfg(target_os = "linux")]
pub fn focus_pid(pid: u32) -> bool {
    focus_x11(pid).unwrap_or(false)
}

/// X11 activation via EWMH: find the managed window whose `_NET_WM_PID` matches and
/// send `_NET_ACTIVE_WINDOW` to the root. Under pure Wayland `connect` fails and we
/// return `Ok(false)`; only XWayland clients that set `_NET_WM_PID` are reachable.
#[cfg(target_os = "linux")]
fn focus_x11(pid: u32) -> Result<bool, Box<dyn std::error::Error>> {
    use x11rb::connection::Connection;
    use x11rb::protocol::xproto::{AtomEnum, ClientMessageEvent, ConnectionExt, EventMask};

    let (conn, screen_num) = x11rb::connect(None)?;
    let root = conn.setup().roots[screen_num].root;
    let atoms = Atoms::new(&conn)?.reply()?;

    let clients = conn
        .get_property(false, root, atoms._NET_CLIENT_LIST, AtomEnum::WINDOW, 0, u32::MAX)?
        .reply()?;
    let windows = match clients.value32() {
        Some(w) => w,
        None => return Ok(false),
    };

    for win in windows {
        let prop = conn
            .get_property(false, win, atoms._NET_WM_PID, AtomEnum::CARDINAL, 0, 1)?
            .reply()?;
        if prop.value32().and_then(|mut v| v.next()) == Some(pid) {
            // data: [source=1 (application), timestamp, requestor active win, 0, 0]
            let event = ClientMessageEvent::new(
                32,
                win,
                atoms._NET_ACTIVE_WINDOW,
                [1u32, x11rb::CURRENT_TIME, 0, 0, 0],
            );
            conn.send_event(
                false,
                root,
                EventMask::SUBSTRUCTURE_NOTIFY | EventMask::SUBSTRUCTURE_REDIRECT,
                event,
            )?;
            conn.flush()?;
            return Ok(true);
        }
    }
    Ok(false)
}

/// Wayland-only Unixes and any other target: no-op.
#[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
pub fn focus_pid(_pid: u32) -> bool {
    false
}
```

- [ ] **Step 3: Wire the module + command into `src/lib.rs`**

Add the module declaration next to the existing ones (near line 10):

```rust
mod focus;
mod launch;
mod script;
```

Add the command after `play_cancel` (after line 225):

```rust
/// `play_focus` — bring the running game's window back to the foreground (the user
/// alt-tabbed to Coilbox mid-game). Maps the run id to the live child's PID so the
/// PID never crosses the IPC boundary. Best-effort: returns `focused: false` when
/// no window could be raised (e.g. Wayland, or the process has no window yet).
#[tauri::command]
async fn play_focus(reg: State<'_, RunRegistry>, run_id: String) -> Result<CliResult, ()> {
    let pid = reg.lock().unwrap().get(&run_id).map(|c| c.id());
    Ok(match pid {
        Some(pid) => CliResult::ok(json!({ "focused": focus::focus_pid(pid) })),
        None => CliResult::err("no running game with that id"),
    })
}
```

Register it in `generate_handler!` (line 235-240):

```rust
        .invoke_handler(tauri::generate_handler![
            play_generate_script,
            play_launch,
            play_launch_replay,
            play_cancel,
            play_focus
        ])
```

- [ ] **Step 4: Add `play_focus` to `build.rs` `COMMANDS`**

```rust
const COMMANDS: &[&str] = &[
    "play_generate_script",
    "play_launch",
    "play_launch_replay",
    "play_cancel",
    "play_focus",
];
```

- [ ] **Step 5: Add the permission to `permissions/default.toml`**

```toml
permissions = [
  "allow-play-generate-script",
  "allow-play-launch",
  "allow-play-launch-replay",
  "allow-play-cancel",
  "allow-play-focus",
]
```

- [ ] **Step 6: Build the crate (macOS path compiles locally)**

Run: `cargo build -p tauri-plugin-coilbox-play`
Expected: PASS. First build downloads `objc2-app-kit`. If `runningApplicationWithProcessIdentifier` / `activateWithOptions` / `NSApplicationActivationOptions::ActivateAllWindows` fail to resolve, the installed `objc2-app-kit` minor differs from 0.3.2 — check `cargo doc --open -p objc2-app-kit` for the current method/variant names and adjust (do not guess).

- [ ] **Step 7: Format + clippy (Linux path compiles via clippy on any host? No — verify)**

Run: `cargo fmt --all` then `cargo clippy -p tauri-plugin-coilbox-play --all-targets --all-features -- -D warnings`
Expected: PASS on the host platform (macOS). Note the `x11rb` path is NOT compiled on macOS (cfg linux); it is compiled by CI on ubuntu. The `windows` path is compiled by neither — see Step 8.

- [ ] **Step 8: (Optional, recommended) cross-check the Windows path**

Run: `rustup target add x86_64-pc-windows-msvc` then
`cargo clippy -p tauri-plugin-coilbox-play --target x86_64-pc-windows-msvc -- -D warnings`
Expected: PASS (clippy type-checks without linking, so no MSVC toolchain is needed). If the target/toolchain can't be set up in this environment, skip this step and record in the commit/PR that the Windows focus path is verified by inspection only until the Windows release build compiles it.

- [ ] **Step 9: Commit**

```bash
git add crates/tauri-plugin-coilbox-play/src/focus.rs \
        crates/tauri-plugin-coilbox-play/src/lib.rs \
        crates/tauri-plugin-coilbox-play/Cargo.toml \
        crates/tauri-plugin-coilbox-play/build.rs \
        crates/tauri-plugin-coilbox-play/permissions/default.toml \
        Cargo.lock
git commit -m "feat(play): play_focus command to raise the running game window"
```

---

## Task 2: Frontend `playFocus` binding

**Files:**
- Modify: `src/play/bindings.ts`

- [ ] **Step 1: Add the binding after `playCancel` (end of file)**

```ts
/**
 * Bring the running game's window back to the foreground. Maps the run id to the
 * live engine process on the Rust side. Best-effort — resolves `focused:false`
 * when no window could be raised (e.g. Wayland).
 */
export const playFocus = defineCommand<
  { runId: string },
  { focused: boolean }
>("coilbox-play", "play_focus");
```

- [ ] **Step 2: Typecheck**

Run: `bun run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/play/bindings.ts
git commit -m "feat(play): playFocus binding"
```

---

## Task 3: `PlayProvider` shared context

**Files:**
- Create: `src/play/PlayProvider.tsx`

The provider owns the single run lifecycle. `runningRef` mirrors the backend's
single-game guard on the frontend so a second concurrent `launch` throws
immediately **without** clobbering the first run's `running`/`activeRunId` state
(e.g. the joined-battle auto-launch effect firing while a skirmish already runs).

- [ ] **Step 1: Create `src/play/PlayProvider.tsx`**

```tsx
import { Channel } from "@tauri-apps/api/core";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useRef,
  useState,
} from "react";
import {
  type BattleConfig,
  type LaunchEvent,
  playFocus,
  playLaunch,
  playLaunchReplay,
} from "./bindings";

/** Which kind of run is live, for labelling. */
export type RunKind = "skirmish" | "battle" | "replay";

interface LaunchOpts {
  config: BattleConfig;
  executable: string;
  dataDir: string;
}

interface ReplayOpts {
  demoPath: string;
  executable: string;
  dataDir: string;
}

interface PlayContextValue {
  /** True while any game/replay is running (app-wide — only one at a time). */
  running: boolean;
  /** Run id of the live game, for `focusGame`. Null when idle. */
  activeRunId: string | null;
  kind: RunKind | null;
  /** Launch a skirmish or battle; resolves when the engine exits. */
  launch: (
    kind: "skirmish" | "battle",
    opts: LaunchOpts,
  ) => Promise<{ exitCode: number | null }>;
  /** Launch a replay; resolves when the engine exits. */
  launchReplay: (opts: ReplayOpts) => Promise<{ exitCode: number | null }>;
  /** Bring the running game's window to the foreground (best-effort). */
  focusGame: () => void;
}

const PlayContext = createContext<PlayContextValue | null>(null);

/** Access shared game-run state. Must be used within <PlayProvider>. */
export function usePlay(): PlayContextValue {
  const ctx = useContext(PlayContext);
  if (!ctx) throw new Error("usePlay must be used within PlayProvider");
  return ctx;
}

export function PlayProvider({ children }: { children: ReactNode }) {
  const [running, setRunning] = useState(false);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [kind, setKind] = useState<RunKind | null>(null);
  // Synchronous guard: `running` state lags a render behind, so gate on a ref to
  // reject a second launch without disturbing the in-flight run.
  const runningRef = useRef(false);

  const start = useCallback(
    async (
      runKind: RunKind,
      run: (
        runId: string,
        onEvent: Channel<LaunchEvent>,
      ) => Promise<{ exitCode: number | null }>,
    ) => {
      if (runningRef.current) throw new Error("a game is already running");
      runningRef.current = true;
      const runId = crypto.randomUUID();
      const onEvent = new Channel<LaunchEvent>();
      // The authoritative unfreeze is the launch promise resolving; the channel is
      // required by the command signature but unused here.
      onEvent.onmessage = () => {};
      setRunning(true);
      setActiveRunId(runId);
      setKind(runKind);
      try {
        return await run(runId, onEvent);
      } finally {
        runningRef.current = false;
        setRunning(false);
        setActiveRunId(null);
        setKind(null);
      }
    },
    [],
  );

  const launch = useCallback(
    (runKind: "skirmish" | "battle", opts: LaunchOpts) =>
      start(runKind, (runId, onEvent) =>
        playLaunch({ ...opts, runId, onEvent }),
      ),
    [start],
  );

  const launchReplay = useCallback(
    (opts: ReplayOpts) =>
      start("replay", (runId, onEvent) =>
        playLaunchReplay({ ...opts, runId, onEvent }),
      ),
    [start],
  );

  const focusGame = useCallback(() => {
    if (!activeRunId) return;
    void playFocus({ runId: activeRunId }).catch(() => {});
  }, [activeRunId]);

  return (
    <PlayContext.Provider
      value={{ running, activeRunId, kind, launch, launchReplay, focusGame }}
    >
      {children}
    </PlayContext.Provider>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `bun run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/play/PlayProvider.tsx
git commit -m "feat(play): PlayProvider shared game-run context"
```

---

## Task 4: `InGameBadge` pill + plugin registration

**Files:**
- Create: `src/play/InGameBadge.tsx`
- Modify: `src/play/index.ts`

- [ ] **Step 1: Create `src/play/InGameBadge.tsx`**

`animate-pulse` provides the pulse; `motion-reduce:animate-none` respects the
reduced-motion setting. Orange uses Tailwind literal color utilities (the theme's
CSS-var tokens have no orange). The visible "In game" text is the accessible name.

```tsx
import { usePlay } from "./PlayProvider";

/**
 * topbar.right slot: an orange pulsing "In game" pill, shown only while a game or
 * replay is running. Clicking returns focus to the game window (best-effort).
 */
export default function InGameBadge() {
  const { running, focusGame } = usePlay();
  if (!running) return null;
  return (
    <button
      type="button"
      onClick={focusGame}
      title="Return to the game"
      className="flex animate-pulse items-center gap-1.5 rounded-full bg-orange-500/15 px-3 py-1 text-xs font-medium text-orange-600 hover:bg-orange-500/25 motion-reduce:animate-none dark:text-orange-400"
    >
      <span className="size-2 rounded-full bg-orange-500" />
      In game
    </button>
  );
}
```

- [ ] **Step 2: Register the Provider + slot in `src/play/index.ts`**

Add imports at the top (after the existing `lucide-react` import):

```ts
import InGameBadge from "./InGameBadge";
import { PlayProvider } from "./PlayProvider";
```

Add `Provider` and `slots` to the `playPlugin` object (after `routes`). Order
`-10` places the pill left of the updater's "Update available" pill (`order: 0`)
in the shared `topbar.right` slot:

```ts
  routes: [
    {
      path: "play/skirmish",
      lazy: () => import("./pages/SkirmishPage"),
      crumb: "Singleplayer",
    },
  ],
  Provider: PlayProvider,
  slots: [{ slot: "topbar.right", order: -10, Component: InGameBadge }],
};
```

- [ ] **Step 3: Typecheck + biome**

Run: `bun run typecheck` then `bunx biome ci src/play`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/play/InGameBadge.tsx src/play/index.ts
git commit -m "feat(play): in-game pill in the top bar"
```

---

## Task 5: Skirmish page delegates to the provider

**Files:**
- Modify: `src/play/pages/SkirmishPage.tsx`

- [ ] **Step 1: Swap imports**

Remove the now-unused `Channel` import (line 2) and the `type LaunchEvent, playLaunch` import (line 13). Replace the bindings import line with the provider hook:

Delete line 2:
```tsx
import { Channel } from "@tauri-apps/api/core";
```
Delete line 13:
```tsx
import { type LaunchEvent, playLaunch } from "../bindings";
```
Add (next to the other `../` imports, e.g. after the `../config` import block):
```tsx
import { usePlay } from "../PlayProvider";
```

- [ ] **Step 2: Replace local `running` state with the provider**

Delete line 55:
```tsx
  const [running, setRunning] = useState(false);
```
Add near the top of the component body (after `const dataDir = target?.dataDir;`, line 37):
```tsx
  const { running, launch } = usePlay();
```
(`useState` is still used by other state, so keep its import.)

- [ ] **Step 3: Rewrite `onStart` to delegate**

Replace the whole `onStart` function (lines 198-236) with:

```tsx
  async function onStart() {
    if (!target || !selectedGame || !selectedMap) return;
    setError(null);
    try {
      // Only send options the user actually changed from their default; the
      // engine applies the rest.
      const overrides: Record<string, string> = {};
      for (const o of modOptions) {
        const v = modOptionValues[o.key];
        if (v !== undefined && v !== (o.default ?? "")) overrides[o.key] = v;
      }
      const config = toBattleConfig({
        participants,
        mapName: selectedMap.name,
        gameType: selectedGame.name,
        startPosType,
        modOptions: overrides,
      });
      const res = await launch("skirmish", {
        config,
        executable: target.executable,
        dataDir: target.dataDir,
      });
      if (res.exitCode && res.exitCode !== 0) {
        setError(`Engine exited with code ${res.exitCode}.`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }
```

(`running` is unchanged in `canStart` and the button label — it now reflects
app-wide state, so the skirmish Start disables while a multiplayer battle or
replay runs too. The freeze banner and frozen inputs likewise reflect any running
game, which is correct: you cannot start a second game regardless.)

- [ ] **Step 4: Typecheck + biome**

Run: `bun run typecheck` then `bunx biome ci src/play`
Expected: PASS. Typecheck confirms no dangling references to the removed
`Channel`/`playLaunch`/`setRunning`.

- [ ] **Step 5: Commit**

```bash
git add src/play/pages/SkirmishPage.tsx
git commit -m "refactor(play): skirmish launch via PlayProvider"
```

---

## Task 6: Multiplayer battle launch delegates to the provider

**Files:**
- Modify: `src/multiplayer/battle/useBattleLaunch.ts`

The public shape `{ running, error, launch }` is preserved, so `BattleRoomPage`
needs no change. `running` becomes app-wide; `error` stays local.

- [ ] **Step 1: Rewrite `useBattleLaunch.ts`**

```ts
import { useCallback, useState } from "react";
import type { PlayTarget } from "@/play/config";
import { usePlay } from "@/play/PlayProvider";
import { mpBuildBattleConfig, mpBuildHostConfig } from "../bindings";

/**
 * Launch the current battle: ask the backend to map it to a `play` `BattleConfig`
 * then launch the engine via the shared `PlayProvider` — the same launch path the
 * singleplayer skirmish uses. When `host` is set we build a host-mode config
 * (`isHost:true`, bound to our HOSTPORT); otherwise a client config pointing at
 * the host. `running` is app-wide (one game at a time); `error` is local; the
 * launch resolves when the engine exits.
 */
export function useBattleLaunch(
  serverKey: string | null,
  target: PlayTarget | null,
  host = false,
) {
  const { running, launch } = usePlay();
  const [error, setError] = useState<string | null>(null);

  const doLaunch = useCallback(async () => {
    if (!serverKey || !target) return;
    setError(null);
    try {
      const { config } = host
        ? await mpBuildHostConfig({ serverKey })
        : await mpBuildBattleConfig({ serverKey });
      const res = await launch("battle", {
        config,
        executable: target.executable,
        dataDir: target.dataDir,
      });
      if (res.exitCode && res.exitCode !== 0) {
        setError(`Engine exited with code ${res.exitCode}.`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [serverKey, target, host, launch]);

  return { running, error, launch: doLaunch };
}
```

- [ ] **Step 2: Typecheck + biome**

Run: `bun run typecheck` then `bunx biome ci src/multiplayer`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/multiplayer/battle/useBattleLaunch.ts
git commit -m "refactor(multiplayer): battle launch via PlayProvider"
```

---

## Task 7: Replay Watch button delegates to the provider

**Files:**
- Modify: `src/content/pages/components/WatchButton.tsx`

`running` (app-wide) drives `disabled`; a local `pending` flag preserves the
per-button "Watching…" feedback and a distinct title so other replay rows show
"a game is running" rather than all claiming to be watching.

- [ ] **Step 1: Rewrite `WatchButton.tsx`**

```tsx
import { Button } from "@picoframe/frame";
import { Play } from "lucide-react";
import { useState } from "react";
import { usePlay } from "../../../play/PlayProvider";
import { useReplayTarget } from "../../../play/config";

/**
 * Launch the engine to watch a replay. Resolves the best-matching installed engine
 * for the demo's recorded version (exact match, else the preferred engine as a
 * fallback with a sync warning). Disabled with a reason when no engine is
 * installed, and while any game/replay is already running.
 */
export function WatchButton({
  replayPath,
  engineVersion,
}: {
  replayPath: string;
  engineVersion: string;
}) {
  const { resolved } = useReplayTarget(engineVersion);
  const { running, launchReplay } = usePlay();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onWatch() {
    if (!resolved) return;
    setPending(true);
    setError(null);
    try {
      const res = await launchReplay({
        demoPath: replayPath,
        executable: resolved.target.executable,
        dataDir: resolved.target.dataDir,
      });
      if (res.exitCode && res.exitCode !== 0) {
        setError(`Engine exited with code ${res.exitCode}.`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPending(false);
    }
  }

  const title = !resolved
    ? "Install an engine to watch replays."
    : running && !pending
      ? "A game is already running."
      : undefined;

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        onClick={onWatch}
        disabled={!resolved || running}
        title={title}
        className="gap-1.5"
      >
        <Play className="size-4" />
        {pending ? "Watching…" : "Watch"}
      </Button>
      {resolved && !resolved.matched && (
        <p className="max-w-xs text-right text-xs text-amber-600 dark:text-amber-400">
          Recorded on {engineVersion || "an unknown engine"}; watching with{" "}
          {resolved.target.engineVersion} — may not sync.
        </p>
      )}
      {error && (
        <p className="max-w-xs text-right text-xs text-destructive">{error}</p>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck + biome**

Run: `bun run typecheck` then `bunx biome ci src/content`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/content/pages/components/WatchButton.tsx
git commit -m "refactor(content): replay Watch launch via PlayProvider"
```

---

## Task 8: Full static suite (matches CI)

**Files:** none (verification only).

- [ ] **Step 1: Frontend checks (same as CI)**

Run: `bunx biome ci .` then `bun run typecheck`
Expected: PASS both.

- [ ] **Step 2: Rust checks (same as CI)**

Run: `cargo fmt --all --check` then
`cargo clippy --all-targets --all-features -- -D warnings`
Expected: PASS. (This compiles the macOS focus path locally. The Linux path is
compiled by CI on ubuntu; the Windows path only by Step 8 of Task 1 or the
Windows release build.)

- [ ] **Step 3: Commit any formatting fixes**

```bash
git add -u
git commit -m "chore: fmt"
```

(Skip if nothing changed.)

---

## Task 9: Live verification (macOS, `bun tauri dev`)

**Files:** none. This is the real behavioural gate — do not claim the feature works without it.

- [ ] **Step 1: Launch the app**

Run: `bun tauri dev`
Expected: app boots; the top bar shows no "In game" pill (no game running).

- [ ] **Step 2: Start a skirmish and alt-tab back**

Go to Play → Singleplayer, pick a game/map/opponent, click Start Game. When the
engine window appears, alt-tab (or Cmd-Tab) back to Coilbox.
Expected: an **orange, pulsing "In game" pill** is visible in the top bar, to the
LEFT of the "Update available" pill's position. The skirmish form is frozen with
the "Game running — settings are frozen…" banner.

- [ ] **Step 3: Confirm gating across launchers**

While the skirmish runs, navigate to the Replays list.
Expected: every Watch button is disabled with the title "A game is already
running." (Hover to confirm the title.)

- [ ] **Step 4: Click the pill → refocus**

Click the "In game" pill.
Expected: the game window comes to the foreground (Coilbox is no longer frontmost).
On macOS this uses `NSRunningApplication.activate` and should reliably raise the
engine. If it does not, report exactly what happened — do not claim success.

- [ ] **Step 5: Exit the game**

Quit the engine (or use the game's exit).
Expected: within ~150ms the pill disappears, the skirmish form unfreezes, and the
Watch buttons re-enable.

- [ ] **Step 6: Record platform coverage honestly**

In the PR description, state: refocus verified live on macOS; Windows/X11 code
present and compiled where possible (X11 in CI; Windows via cross-target clippy or
release build) but not behaviourally tested on this machine. Wayland is a
documented no-op.

---

## Self-review notes (author)

- **Spec coverage:** pill (Task 4/5–7 render + gating), click-to-refocus (Task 1 Rust + Task 2 binding + Task 3 `focusGame` + Task 4 pill onClick), app-wide gating / "no SP while MP and vice versa" (Task 3 shared `running` consumed by Tasks 5/6/7), replay inclusion (Task 7). All present.
- **Types:** `launch(kind, opts)`, `launchReplay(opts)`, `focusGame()`, `usePlay()`, `PlayProvider`, `playFocus({runId})`, `focus_pid(pid: u32) -> bool`, `play_focus(reg, run_id)` are consistent across tasks.
- **Placeholders:** none — every code step is complete.
- **Known honest gaps (not defects):** no unit tests (no DOM harness — stated up front); Windows focus path compile-checked only via optional cross-target step; refocus is fire-and-forget (no foreground-success confirmation), per spec "out of scope".
