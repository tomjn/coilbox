# Replay "Watch" button — design

## Goal

Add a **Watch** button to the top-right of the replay detail view
(`ReplayDetailPage`) that launches the engine to play back the selected `.sdfz`
demo. This realises the disabled `Launch` seam that already sits in the header
(`ReplayDetailPage.tsx:445`).

## Mechanism

A Spring/Recoil engine plays a replay when the demo file is passed to it **as a
positional argument** — the same argument slot the skirmish launcher fills with
a generated `script.txt`. The engine reads map, game, players and start-boxes
from inside the demo, so **no start-script needs generating**.

`build_engine_args(script_path, write_dir)` in
`crates/tauri-plugin-coilbox-play/src/launch.rs` already appends its positional
path last. Passing the demo path there is all the arg-building that watching a
replay requires.

## Approach

Reuse the `coilbox-play` plugin. Add a thin new backend command that spawns the
engine with the demo path through the **same** `launch_blocking` +
single-game run-registry that `play_launch` uses.

Routing Watch through the shared registry means a replay and a skirmish cannot
run at the same time (the registry refuses a second launch while one is live) —
that guard comes for free.

### Alternatives considered

- **Generate a spectator start-script** — unnecessary; the engine reads
  everything from the demo. Rejected.
- **A separate launcher plugin** — duplicates the registry/lifecycle machinery
  for no benefit. Rejected.

## Backend — `crates/tauri-plugin-coilbox-play`

New command:

```rust
play_launch_replay(demoPath, executable, dataDir, runId, onEvent)
```

- Validates `demoPath` (and `executable`) exist, mirroring `play_launch`'s
  guards.
- Builds args with `build_engine_args(&demo_path, None)` — no script written.
- Spawns via the existing `launch_blocking`, sharing the `RunRegistry`
  (single game at a time) and the `LaunchEvent` channel (`Started` / `Exited`).
- Resolves when the engine process exits, like `play_launch`.

ACL wiring (required, or the command is runtime-blocked):

- Add `play_launch_replay` to `build.rs` `COMMANDS`.
- Add it to `permissions/default.toml`.

Test: extend the `launch.rs` unit tests to cover the demo-path-positional path
(the demo path is the last, positional argument, with no `--write-dir` when none
is supplied).

## Frontend

### Binding

`playLaunchReplay` in `src/play/bindings.ts`, mirroring `playLaunch`:

```ts
playLaunchReplay({ demoPath, executable, dataDir, runId, onEvent }): { exitCode: number | null }
```

### Engine resolution

Given the demo's recorded `engineVersion` (from `useDemoInfo`) and every
installed target (`useContentTargets()` → `ScanTarget[]`), resolve which engine
to launch with:

1. **Exact match** — a target whose engine label
   (`syncVersion ?? version`) satisfies
   `compareEngineVersions(demoVersion, label) === 0`. This comparison keys off
   the dotted release + commit count and ignores the trailing branch label
   (e.g. `BAR105`), which is what actually determines replay compatibility.
2. **Fallback** — the selected/preferred target
   (`useScanTargetSelection().selected`) when no exact match exists.
3. **None** — no installed engine at all.

Returns `{ target, matched: boolean }` (or `null` when no engine exists).

### `WatchButton` component

New: `src/content/pages/components/WatchButton.tsx`, props
`{ replayPath: string; engineVersion: string }`. Owns launch, running and error
state so the 500-line `ReplayDetailPage` stays lean.

States:

- **No engine installed** → button disabled, tooltip
  "Install an engine to watch replays."
- **Version mismatch (fallback in use)** → button enabled, with a small amber
  note beneath: "Recorded on `<recorded>`; watching with `<installed>` — may not
  sync."
- **Ready (exact match)** → enabled, label "Watch", `Play` icon.
- **Running** → disabled, label "Watching…"; a nonzero engine exit surfaces as
  an inline error.

Launch flow copies `SkirmishPage.onStart`: create a `Channel<LaunchEvent>`, call
`playLaunchReplay`, treat the promise resolving as the authoritative
"finished" signal, show `Engine exited with code N` on nonzero exit.

**Not guarded:** whether the demo's game/map are installed. `gameType` is a
display string, not a rapid/archive key (the page's existing Game download is
explicitly "best effort — an exact version match isn't guaranteed"), so there is
no reliable "is this game installed" check. If content is missing the engine
surfaces its own error, which the button shows. This is stated honestly rather
than presented as a full readiness guard.

### Header restructure

In `ReplayDetailPage.tsx`, change the `flex flex-col` header to a
title-left / actions-right layout (`flex items-start justify-between`), matching
`SkirmishPage` and `GameHeader`. Place `WatchButton` in the top-right, wired with
`replay.path` and `info.engineVersion`.

The disabled `Launch` seam (line 445) is **replaced** by `WatchButton`. The
disabled `Delete` seam stays untouched (out of scope).

## Scope

Watch only. Out of scope: Delete, auto-download-then-watch, engine auto-install,
any game/map readiness guard beyond surfacing the engine's own error.

## Verification

- Rust: extended `launch.rs` unit test passes; full lint suite
  (`cargo fmt --all --check`, `cargo clippy --all-targets --all-features -D
  warnings`, `bunx biome ci .`, `bun run typecheck`) green.
- Manual (`bun tauri dev`): open a replay whose engine is installed → Watch
  launches the engine into playback; a version mismatch shows the amber note and
  still launches on fallback; with no engine installed the button is disabled
  with its tooltip.
</content>
</invoke>
