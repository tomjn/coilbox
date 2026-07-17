# Replay "Watch" Button Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a top-right **Watch** button on the replay detail view that launches the engine to play back the selected `.sdfz` demo.

**Architecture:** The engine plays a replay when the demo file is passed as its positional argument — the same arg slot the skirmish launcher fills with a generated `script.txt`. A thin new backend command (`play_launch_replay`) reuses the existing `launch_blocking` + single-game run-registry to spawn the engine with the demo path (no start-script generated). The frontend resolves the best-matching installed engine (exact version match, else fallback to the selected engine) and drives launch/running/error state from a small `WatchButton` component.

**Tech Stack:** Rust (Tauri plugin `tauri-plugin-coilbox-play`), TypeScript/React frontend, picoframe `Button`, existing `coilbox-content` engine discovery + `compareEngineVersions` helper.

**Spec:** `docs/superpowers/specs/2026-07-02-replay-watch-button-design.md`

---

## File Structure

- `crates/tauri-plugin-coilbox-play/src/lib.rs` — add `play_launch_replay` command + register it in `generate_handler!`.
- `crates/tauri-plugin-coilbox-play/build.rs` — add `play_launch_replay` to `COMMANDS`.
- `crates/tauri-plugin-coilbox-play/permissions/default.toml` — add `allow-play-launch-replay`.
- `crates/tauri-plugin-coilbox-play/src/launch.rs` — existing arg builder; extend its tests only (no behaviour change — the demo path reuses `build_engine_args`).
- `src/play/bindings.ts` — add `playLaunchReplay` binding.
- `src/play/config.ts` — add `useReplayTarget` hook: resolve the launch `PlayTarget` (carrying the engine `executable`) for a demo's recorded engine version. Colocated with `PlayTarget` / `usePreferredTarget`.
- `src/content/pages/components/WatchButton.tsx` — **new** component owning launch/running/error UI.
- `src/content/pages/ReplayDetailPage.tsx` — restructure header (title-left / actions-right); replace disabled `Launch` seam with `WatchButton`.

---

### Task 1: Backend `play_launch_replay` command

**Files:**
- Modify: `crates/tauri-plugin-coilbox-play/src/lib.rs`
- Modify: `crates/tauri-plugin-coilbox-play/build.rs:5`
- Modify: `crates/tauri-plugin-coilbox-play/permissions/default.toml:5-9`
- Test: `crates/tauri-plugin-coilbox-play/src/launch.rs` (tests module)

- [ ] **Step 1: Write a failing test for the replay arg vector**

The demo file is launched exactly like a script: positional, last, with no `--write-dir`. Add this test to the `tests` module in `crates/tauri-plugin-coilbox-play/src/launch.rs`:

```rust
    #[test]
    fn replay_demo_path_is_positional_last() {
        // A replay reuses build_engine_args with the demo path in the script slot.
        let a = build_engine_args("/data/demos/2026.sdfz", None);
        assert_eq!(a, vec!["/data/demos/2026.sdfz".to_string()]);
    }
```

- [ ] **Step 2: Run the test to verify it passes (proves the arg path is already correct)**

Run: `cargo test -p tauri-plugin-coilbox-play replay_demo_path_is_positional_last` Expected: PASS. (This test documents the contract the new command relies on; `build_engine_args` already satisfies it, so no production change is needed in `launch.rs`.)

- [ ] **Step 3: Add the `play_launch_replay` command in `lib.rs`**

Insert this command immediately after `play_launch` (after its closing brace, before `play_cancel`) in `crates/tauri-plugin-coilbox-play/src/lib.rs`:

```rust
/// `play_launch_replay` — launch the engine to play back a demo (`.sdfz`). Unlike
/// `play_launch` this writes no start script: the engine reads map/game/players
/// from the demo when it's passed as the positional argument. Shares the run
/// registry, so it refuses to start while any game/replay is already running.
#[tauri::command]
async fn play_launch_replay<R: Runtime>(
    _app: AppHandle<R>,
    reg: State<'_, RunRegistry>,
    demo_path: String,
    executable: String,
    data_dir: String,
    run_id: String,
    on_event: Channel<LaunchEvent>,
) -> Result<CliResult, ()> {
    let bin = PathBuf::from(&executable);
    if !bin.is_file() {
        return Ok(CliResult::err(format!(
            "engine executable not found: {executable}"
        )));
    }
    if !PathBuf::from(&demo_path).is_file() {
        return Ok(CliResult::err(format!("replay not found: {demo_path}")));
    }
    // Single game/replay at a time.
    if !reg.lock().unwrap().is_empty() {
        return Ok(CliResult::err("a game is already running"));
    }

    let args = build_engine_args(&demo_path, None);
    let reg = reg.inner().clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        launch_blocking(bin, args, data_dir, run_id, reg, on_event)
    })
    .await;

    Ok(match result {
        Ok(Ok(Some(code))) => CliResult::ok(json!({ "exitCode": code })),
        Ok(Ok(None)) => CliResult::ok(json!({ "exitCode": serde_json::Value::Null })),
        Ok(Err(e)) => CliResult::err(e),
        Err(e) => CliResult::err(format!("launch task failed: {e}")),
    })
}
```

Note: `_app` is unused (a replay writes no script, so no app-data path is resolved) but kept in the signature for symmetry and future use; the leading underscore silences the unused-variable clippy lint.

- [ ] **Step 4: Register the command in the plugin handler**

In `crates/tauri-plugin-coilbox-play/src/lib.rs`, update the `invoke_handler` list in `init()`:

```rust
        .invoke_handler(tauri::generate_handler![
            play_generate_script,
            play_launch,
            play_launch_replay,
            play_cancel
        ])
```

- [ ] **Step 5: Add the command to `build.rs` COMMANDS**

In `crates/tauri-plugin-coilbox-play/build.rs`, change line 5:

```rust
const COMMANDS: &[&str] = &[
    "play_generate_script",
    "play_launch",
    "play_launch_replay",
    "play_cancel",
];
```

- [ ] **Step 6: Add the permission to `default.toml`**

In `crates/tauri-plugin-coilbox-play/permissions/default.toml`, add `"allow-play-launch-replay"` to the permissions array:

```toml
permissions = [
  "allow-play-generate-script",
  "allow-play-launch",
  "allow-play-launch-replay",
  "allow-play-cancel",
]
```

(The `allow-play-launch-replay` / `deny-play-launch-replay` autogenerated permission files are produced by the tauri-plugin build helper from `build.rs` — do not hand-write them.)

- [ ] **Step 7: Build the plugin and confirm the command + ACL compile**

Run: `cargo build -p tauri-plugin-coilbox-play` Expected: builds clean; the build helper regenerates `permissions/autogenerated/commands/play_launch_replay.toml`.

- [ ] **Step 8: Run the plugin tests**

Run: `cargo test -p tauri-plugin-coilbox-play` Expected: PASS (both the new and existing `launch.rs` tests).

- [ ] **Step 9: Commit**

```bash
git add crates/tauri-plugin-coilbox-play/src/lib.rs crates/tauri-plugin-coilbox-play/src/launch.rs crates/tauri-plugin-coilbox-play/build.rs crates/tauri-plugin-coilbox-play/permissions/default.toml crates/tauri-plugin-coilbox-play/permissions/autogenerated/commands/play_launch_replay.toml
git commit -m "feat(play): add play_launch_replay command"
```

---

### Task 2: Frontend `playLaunchReplay` binding

**Files:**
- Modify: `src/play/bindings.ts` (after `playLaunch`, before `playCancel`)

- [ ] **Step 1: Add the binding**

In `src/play/bindings.ts`, insert after the `playLaunch` definition (after its closing `);`):

```ts
/**
 * Launch the engine to play back a demo (`.sdfz`). No start script is written —
 * the engine reads map/game/players from the demo. Resolves when the engine
 * exits. Shares the single-game guard with `playLaunch`.
 */
export const playLaunchReplay = defineCommand<
  {
    demoPath: string;
    executable: string;
    dataDir: string;
    runId: string;
    onEvent: Channel<LaunchEvent>;
  },
  { exitCode: number | null }
>("coilbox-play", "play_launch_replay");
```

- [ ] **Step 2: Typecheck**

Run: `bun run typecheck` Expected: PASS (no errors).

- [ ] **Step 3: Commit**

```bash
git add src/play/bindings.ts
git commit -m "feat(play): add playLaunchReplay binding"
```

---

### Task 3: `useReplayTarget` hook

Resolves which installed engine to launch a demo with, given its recorded version, and produces a `PlayTarget` carrying the engine **executable** (which `ScanTarget` omits — the executable lives on the `Engine` records in content state). Colocated with `usePreferredTarget` in `src/play/config.ts` because it produces the same `PlayTarget` shape and shares its content-state derivation.

**Files:**
- Modify: `src/play/config.ts` (add import at top; add hook after `usePreferredTarget`, ~line 68)

- [ ] **Step 1: Add the `compareEngineVersions` import**

At the top of `src/play/config.ts`, add to the existing content imports:

```ts
import { compareEngineVersions } from "../content/engineVersion";
```

- [ ] **Step 2: Add the hook after `usePreferredTarget`**

Insert after the `usePreferredTarget` function (after its closing brace, ~line 68) in `src/play/config.ts`:

```ts
/** A resolved replay launch target plus whether its engine exactly matches the
 * version the demo was recorded on. */
export interface ReplayTarget {
  target: PlayTarget;
  matched: boolean;
}

/**
 * The target to watch a replay with, for a demo's recorded engine version.
 *
 * A demo replays cleanly only under its recording engine version, so an engine
 * whose label (`syncVersion ?? version`) matches `demoVersion` wins
 * (`compareEngineVersions` keys off the dotted release + commit count and ignores
 * the trailing branch label like `BAR105`). With no exact match it falls back to
 * the preferred engine — surfaced as `matched: false` so the UI can warn. Returns
 * `null` when no engine is installed at all.
 */
export function useReplayTarget(demoVersion: string): {
  resolved: ReplayTarget | null;
  loading: boolean;
} {
  const { state, loading } = useContentState();
  const roots = state?.roots ?? [];
  const engines = roots.flatMap((r) =>
    r.engines.map((e) => ({ id: e.id, version: e.syncVersion ?? e.version })),
  );
  const { resolvedId } = usePreferredEngine(engines);

  const build = (
    rootPath: string,
    e: (typeof roots)[number]["engines"][number],
  ): PlayTarget => ({
    enginePath: e.path,
    executable: e.executable,
    dataDir: rootPath,
    engineVersion: e.syncVersion ?? e.version,
  });

  // Exact version match wins.
  for (const r of roots) {
    for (const e of r.engines) {
      if (compareEngineVersions(demoVersion, e.syncVersion ?? e.version) === 0) {
        return { resolved: { target: build(r.path, e), matched: true }, loading };
      }
    }
  }
  // Fallback: preferred engine, else the first engine in any root.
  for (const r of roots) {
    const e = r.engines.find((en) => en.id === resolvedId);
    if (e) return { resolved: { target: build(r.path, e), matched: false }, loading };
  }
  const first = roots.find((r) => r.engines.length > 0);
  if (first) {
    return {
      resolved: { target: build(first.path, first.engines[0]), matched: false },
      loading,
    };
  }
  return { resolved: null, loading };
}
```

(All hooks — `useContentState`, `usePreferredEngine` — are called unconditionally before the early returns, satisfying the rules of hooks.)

- [ ] **Step 3: Typecheck**

Run: `bun run typecheck` Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/play/config.ts
git commit -m "feat(play): add useReplayTarget hook"
```

---

### Task 4: `WatchButton` component

Owns the launch call, running state and error/mismatch messaging. Kept out of `ReplayDetailPage` so that page stays lean.

**Files:**
- Create: `src/content/pages/components/WatchButton.tsx`

- [ ] **Step 1: Write the component**

Create `src/content/pages/components/WatchButton.tsx`:

```tsx
import { Button } from "@picoframe/frame";
import { Channel } from "@tauri-apps/api/core";
import { Play } from "lucide-react";
import { useState } from "react";
import { type LaunchEvent, playLaunchReplay } from "../../../play/bindings";
import { useReplayTarget } from "../../../play/config";

/**
 * Launch the engine to watch a replay. Resolves the best-matching installed
 * engine for the demo's recorded version (exact match, else the preferred engine
 * as a fallback with a sync warning). Disabled with a reason when no engine is
 * installed, and while a game/replay is already running.
 */
export function WatchButton({
  replayPath,
  engineVersion,
}: {
  replayPath: string;
  engineVersion: string;
}) {
  const { resolved } = useReplayTarget(engineVersion);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onWatch() {
    if (!resolved) return;
    setRunning(true);
    setError(null);
    const onEvent = new Channel<LaunchEvent>();
    // The authoritative "finished" signal is the promise resolving; the channel
    // just lets the engine report its lifecycle.
    onEvent.onmessage = () => {};
    try {
      const res = await playLaunchReplay({
        demoPath: replayPath,
        executable: resolved.target.executable,
        dataDir: resolved.target.dataDir,
        runId: crypto.randomUUID(),
        onEvent,
      });
      if (res.exitCode && res.exitCode !== 0) {
        setError(`Engine exited with code ${res.exitCode}.`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        onClick={onWatch}
        disabled={!resolved || running}
        title={resolved ? undefined : "Install an engine to watch replays."}
        className="gap-1.5"
      >
        <Play className="size-4" />
        {running ? "Watching…" : "Watch"}
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

Note: `resolved.target.dataDir` is the content root (`SPRING_DATADIR`) — the same value `SkirmishPage` passes as `target.dataDir`.

- [ ] **Step 2: Typecheck**

Run: `bun run typecheck` Expected: PASS.

- [ ] **Step 3: Lint the new file**

Run: `bunx biome ci src/content/pages/components/WatchButton.tsx` Expected: PASS (no lint errors).

- [ ] **Step 4: Commit**

```bash
git add src/content/pages/components/WatchButton.tsx
git commit -m "feat(content): add WatchButton for replay playback"
```

---

### Task 5: Wire `WatchButton` into the replay detail header

**Files:**
- Modify: `src/content/pages/ReplayDetailPage.tsx:3` (import), `:429-452` (header)

- [ ] **Step 1: Import the component**

In `src/content/pages/ReplayDetailPage.tsx`, add this import near the other local imports (e.g. after the `states` import on line 31):

```tsx
import { WatchButton } from "./components/WatchButton";
```

- [ ] **Step 2: Restructure the header to title-left / actions-right and mount WatchButton**

Replace the entire `<header>...</header>` block (lines 430-452) with:

```tsx
      <header className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1">
          <Link
            to="/content/replays"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:underline"
          >
            <ArrowLeft className="size-3.5" /> Replays
          </Link>
          <h1 className="break-words text-lg font-semibold">
            {info?.mapName || filename}
          </h1>
          <p className="break-all font-mono text-xs text-muted-foreground">
            {filename}
          </p>
          {/* Delete lands in a later iteration. */}
          <div className="mt-2">
            <Button disabled title="Coming soon">
              Delete
            </Button>
          </div>
        </div>
        {replay && info && (
          <WatchButton replayPath={replay.path} engineVersion={info.engineVersion} />
        )}
      </header>
```

(The `WatchButton` renders only once the replay is found and its demo decoded, so `info.engineVersion` and `replay.path` are available. `Button` is already imported at the top of the file.)

- [ ] **Step 3: Typecheck**

Run: `bun run typecheck` Expected: PASS.

- [ ] **Step 4: Lint**

Run: `bunx biome ci src/content/pages/ReplayDetailPage.tsx` Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/content/pages/ReplayDetailPage.tsx
git commit -m "feat(content): add Watch button to replay detail header"
```

---

### Task 6: Full verification (lint suite + manual smoke)

**Files:** none (verification only).

- [ ] **Step 1: Rust format check**

Run: `cargo fmt --all --check` Expected: PASS (no diff). If it fails, run `cargo fmt --all` and re-commit the changed files.

- [ ] **Step 2: Rust clippy (full, as CI runs it)**

Run: `cargo clippy --all-targets --all-features -- -D warnings` Expected: PASS (no warnings). CI compiles the Tauri app crate, so ensure sidecars exist per CLAUDE.md (`bun run sidecar:unitsync` if clippy complains about a missing externalBin).

- [ ] **Step 3: Frontend lint (full, as CI runs it)**

Run: `bunx biome ci .` Expected: PASS.

- [ ] **Step 4: Frontend typecheck**

Run: `bun run typecheck` Expected: PASS.

- [ ] **Step 5: Manual smoke via the running app**

Run: `bun tauri dev`

Verify, on a content root that has replays:
1. Open a replay whose recorded engine **is** installed → the top-right shows **Watch** (no amber note); clicking it launches the engine into playback; the button reads "Watching…" until the engine exits.
2. Open a replay whose recorded engine is **not** installed but another engine is → **Watch** is enabled with the amber "may not sync" note showing both versions.
3. With **no** engine installed on the selected root → **Watch** is disabled; hovering shows "Install an engine to watch replays."

Report each result honestly (pass/fail with what was observed). Do not claim the feature works without having launched the app and seen playback start.

- [ ] **Step 6: Final commit (only if fmt/lint fixes were needed above)**

```bash
git add -p
git commit -m "chore: lint fixes for replay watch button"
```

---

## Notes for the implementer

- **Not guarded:** whether the demo's game/map are installed. `gameType` is a display string, not a rapid/archive key, so there is no reliable "is this game installed" check. If content is missing the engine surfaces its own error, which `WatchButton` shows via the nonzero-exit / catch paths. This is intentional (see spec) — do not add a fake readiness check.
- **Detached HEAD:** this worktree may be on a detached `HEAD`. Before the first commit, confirm with the user which branch to commit to (per their global rule that commits happen only when asked, on a named branch).
- **ACL is load-bearing:** skipping Task 1 Steps 5-6 makes `play_launch_replay` compile but be blocked at runtime with an ACL error. Both `build.rs` and `default.toml` must be updated.
</content>
