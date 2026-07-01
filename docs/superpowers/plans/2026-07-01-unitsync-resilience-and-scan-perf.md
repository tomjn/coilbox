# unitsync Resilience & Scan Performance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make unitsync content scanning fast (map/game lists return in seconds, matching other lobbies) and resilient (visible progress, retry, cancel, generous timeouts) instead of a silent multi-minute hang.

**Architecture:** Two levers. (1) **Progressive loading** — the blocking scan returns only cache-served enumeration (map/game names + grid fields); expensive per-map option parsing moves to a lazy `unitsync_map_info` call mirroring the existing `unitsync_game_info`. (2) **Resilience** — longer timeouts with descriptive messages, an operation-id cancel registry in the plugin, a visible startup status (progress + Retry + Cancel), detail pages that surface errors instead of hanging forever, and failure caching so navigation doesn't silently re-fire a timeout. A parallel worker pool for "everything after the lists" is included but **measurement-gated** — built only if the instrumentation spike proves it's needed on top of the progressive split.

**Tech Stack:** Rust (the `coilbox-unitsync-worker` sidecar + `tauri-plugin-coilbox-unitsync`), React + TypeScript frontend (`src/content`), Tauri commands with hand-written `defineCommand` bindings, biome + tsc + clippy for static checks.

---

## Conventions & Verification (read first)

This codebase has **no frontend test runner** (no vitest/jest) and the worker's scan is **FFI-bound** (needs a real `libunitsync`, not unit-testable). So the real verification gates are:

- Rust: `cargo fmt --all --check` and `cargo clippy --all-targets --all-features -- -D warnings`
- Frontend: `bunx biome ci .` and `bun run typecheck`
- Live smoke: `bun tauri dev`, then the Tauri MCP (`query_page`, `take_screenshot`) to reach the Content → Maps/Games pages and confirm behaviour. Capture screenshots for the PR (per project CLAUDE.md).

Where pure logic exists (arg parsing, the cancel registry, timeout-message formatting), add real Rust `#[cfg(test)]` unit tests. Everywhere else, "verify" means the static gates above plus a defined manual smoke. **Do not claim a scan is faster without the Phase 0 timing numbers.**

New plugin commands require three coordinated edits or they are ACL-blocked at runtime:
1. the `#[tauri::command]` fn + `generate_handler!` entry in `crates/tauri-plugin-coilbox-unitsync/src/lib.rs`
2. the command name in `COMMANDS` in `crates/tauri-plugin-coilbox-unitsync/build.rs`
3. an `allow-<cmd-kebab>` entry in `crates/tauri-plugin-coilbox-unitsync/permissions/default.toml`

---

## File Structure

**Worker (`crates/coilbox-unitsync-worker/src/`)**
- `main.rs` — MODIFY: drop per-map `read_options` from `collect_maps`; add a `--map <name> --map-info` mode that returns one map's options + attributed warnings; add opt-in phase timings to `scan()`.
- `model.rs` — MODIFY: `MapItem.options`/`warnings` become non-blocking (options removed from scan output; a new `MapInfoOutput` carries them); add `MapInfoOutput`.

**Plugin (`crates/tauri-plugin-coilbox-unitsync/src/`)**
- `lib.rs` — MODIFY: raise `SCAN_TIMEOUT`; descriptive timeout message; cancel registry + poll-loop check; `op_id` on scan/thumbnails; new `unitsync_map_info` + `unitsync_cancel` commands; forward worker stderr in debug builds (for Phase 0).
- `sidecar.rs` — MODIFY: `build_map_info_args`.
- `build.rs` — MODIFY: add `unitsync_map_info`, `unitsync_cancel` to `COMMANDS`.
- `permissions/default.toml` — MODIFY: add `allow-unitsync-map-info`, `allow-unitsync-cancel`.

**Frontend (`src/content/`)**
- `bindings.ts` — MODIFY: `ScanResult` map shape (options optional/removed); add `unitsyncMapInfo`, `unitsyncCancel`; `opId` on `unitsyncScan`/`unitsyncThumbnails`.
- `config.ts` — MODIFY: `primeScan` caches failures + accepts an `opId`; add `useUnitsyncMapInfo` hook; add a shared startup-scan store (`useContentStartup`).
- `ContentStartupProvider.tsx` — MODIFY: drive the startup store, render a visible status banner with Retry/Cancel instead of `console.error`.
- `pages/MapDetailPage.tsx` — MODIFY: load options + warnings via `useUnitsyncMapInfo`; error+retry instead of infinite `DetailLoading`.
- `pages/GameDetailPage.tsx` — MODIFY: error+retry instead of infinite `DetailLoading`.
- `pages/components/states.tsx` — MODIFY: add a `DetailError` state (message + Retry button).

---

## Phase 0 — Instrumentation & Measurement Spike (do first; gates the pool)

**Why:** other lobbies scan the same content in seconds, so our minutes are our own inefficiency. Before splitting or parallelising, get real per-phase numbers on the user's BAR root so decisions are data-driven, not guessed.

### Task 0.1: Emit per-phase timings from the worker scan

**Files:** Modify `crates/coilbox-unitsync-worker/src/main.rs`

- [ ] **Step 1: Add timing around each scan phase.** In `scan()`, wrap the phases and print to stderr, gated by an env var so it's zero-cost/no-noise by default:

```rust
fn scan(lib: &str) -> Result<ScanOutput, String> {
    let timings = std::env::var("COILBOX_UNITSYNC_TIMINGS").is_ok();
    let t0 = std::time::Instant::now();
    let us = unsafe { Unitsync::load(Path::new(lib))? };

    let mut errors = Vec::new();
    if us.init(false, 0) == 0 {
        errors.push("unitsync Init returned 0 (failure); results may be empty".into());
    }
    errors.extend(us.drain_errors());
    if timings {
        eprintln!("[unitsync-timing] init={}ms", t0.elapsed().as_millis());
    }

    let sync_version = us.spring_version();

    let tm = std::time::Instant::now();
    let maps = collect_maps(&us);
    if timings {
        eprintln!(
            "[unitsync-timing] maps={} in {}ms",
            maps.len(),
            tm.elapsed().as_millis()
        );
    }

    let tg = std::time::Instant::now();
    let games = collect_games(&us);
    if timings {
        eprintln!(
            "[unitsync-timing] games={} in {}ms",
            games.len(),
            tg.elapsed().as_millis()
        );
    }

    us.uninit();
    Ok(ScanOutput { maps, games, errors, sync_version })
}
```

- [ ] **Step 2: Time the per-map option read specifically** (the suspected culprit). In `collect_maps`, accumulate the time spent in `read_options`/`map_option_count` vs the rest, and print the total when timings are on:

```rust
fn collect_maps(us: &Unitsync) -> Vec<MapItem> {
    let timings = std::env::var("COILBOX_UNITSYNC_TIMINGS").is_ok();
    let mut opt_nanos: u128 = 0;
    let count = us.map_count();
    let mut maps = Vec::with_capacity(count.max(0) as usize);
    for i in 0..count {
        let Some(name) = us.map_name(i) else { continue };
        let archives = us
            .map_archives(&name)
            .into_iter()
            .map(|a| archive(us, a, None))
            .collect();
        let dims = us.map_dimensions(&name);
        let to = std::time::Instant::now();
        let options = read_options(us, us.map_option_count(&name));
        opt_nanos += to.elapsed().as_nanos();
        let warnings = drain_attributed(us);
        maps.push(MapItem {
            file_name: us.map_file_name(i),
            checksum: us.map_checksum(i).map(|c| format!("{c:08x}")),
            archives,
            info: us.map_info(i),
            width: dims.map(|(w, _)| w),
            height: dims.map(|(_, h)| h),
            options,
            warnings,
            name: name.clone(),
        });
    }
    if timings {
        eprintln!("[unitsync-timing] map_options total={}ms", opt_nanos / 1_000_000);
    }
    maps
}
```

- [ ] **Step 3: Compile.** Run: `cargo build -p coilbox-unitsync-worker`. Expected: builds clean.

### Task 0.2: Surface worker stderr in debug builds so the timings reach the dev terminal

**Files:** Modify `crates/tauri-plugin-coilbox-unitsync/src/lib.rs`

- [ ] **Step 1:** In `run_worker_blocking`, after joining `err_handle`, forward non-empty stderr in debug builds:

```rust
    let out = out_handle.join().unwrap_or_default();
    let err = err_handle.join().unwrap_or_default();

    #[cfg(debug_assertions)]
    if !err.trim().is_empty() {
        eprintln!("[unitsync-worker stderr] {}", err.trim());
    }
```

- [ ] **Step 2: Compile.** Run: `cargo build -p tauri-plugin-coilbox-unitsync`. Expected: builds clean.

### Task 0.3: Measure on the real BAR root

- [ ] **Step 1:** `bun run sidecar:unitsync` (build the worker), then `COILBOX_UNITSYNC_TIMINGS=1 bun tauri dev`.
- [ ] **Step 2:** Trigger a scan (open Content → Maps), read the `[unitsync-timing]` lines in the dev terminal. Record: `init` ms, `maps N in` ms, `map_options total` ms, `games N in` ms.
- [ ] **Step 3: Decision gate.** Write the numbers into this plan under "Measurement Results" below.
  - If `map_options total` dominates (expected): Phase 1 (remove it from the blocking scan) is the fix; the parallel pool (Phase 4) is very likely **not needed** — defer it.
  - If `init` dominates and is many seconds: the pool won't help either (each worker re-pays Init); investigate `ArchiveCache` warmth instead.
  - Only if per-item work *after* the split is still the bottleneck and is parallelisable does Phase 4 get built.

**Measurement Results:** _(fill in during Task 0.3)_
- init: __ ms
- maps: __ maps in __ ms
- map_options total: __ ms
- games: __ games in __ ms
- Decision: __

---

## Phase 1 — Progressive Loading: unblock the lists

Move the expensive per-map option parsing out of the blocking scan into a lazy per-map call, mirroring the existing `unitsync_game_info` pattern. The map/game *lists* then return from cache-served fields only.

### Task 1.1: Add a `MapInfoOutput` and a `--map-info` worker mode

**Files:** Modify `crates/coilbox-unitsync-worker/src/model.rs`, `crates/coilbox-unitsync-worker/src/main.rs`

- [ ] **Step 1:** In `model.rs`, add the lazy map-info output (next to `GameInfoOutput`):

```rust
/// Output of the lazy `--map --map-info` mode: one map's options + any
/// diagnostics attributed while reading them (requires mounting the map
/// archive, so it's fetched on demand, not during the enumeration scan).
#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct MapInfoOutput {
    /// Map options (from mapoptions.lua), when present.
    pub options: Vec<ConfigOption>,
    /// Non-fatal unitsync diagnostics attributed to this map.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub warnings: Vec<String>,
    pub errors: Vec<String>,
}
```

- [ ] **Step 2:** In `model.rs`, drop `options` from `MapItem` (it now loads lazily). Keep `warnings` optional but it will be empty from the scan now (map warnings come from `MapInfoOutput`). Change:

```rust
pub struct MapItem {
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub checksum: Option<String>,
    pub archives: Vec<Archive>,
    pub info: BTreeMap<String, String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub width: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub height: Option<u32>,
    // options + per-map warnings now load lazily via MapInfoOutput.
}
```

- [ ] **Step 3:** In `main.rs` `collect_maps`, remove the `read_options`/`drain_attributed` calls and the `options`/`warnings` fields from the `MapItem` (and drop the Phase 0 timing scaffolding for options, keeping only the phase-level `[unitsync-timing]`):

```rust
fn collect_maps(us: &Unitsync) -> Vec<MapItem> {
    let count = us.map_count();
    let mut maps = Vec::with_capacity(count.max(0) as usize);
    for i in 0..count {
        let Some(name) = us.map_name(i) else { continue };
        let archives = us
            .map_archives(&name)
            .into_iter()
            .map(|a| archive(us, a, None))
            .collect();
        let dims = us.map_dimensions(&name);
        maps.push(MapItem {
            file_name: us.map_file_name(i),
            checksum: us.map_checksum(i).map(|c| format!("{c:08x}")),
            archives,
            info: us.map_info(i),
            width: dims.map(|(w, _)| w),
            height: dims.map(|(_, h)| h),
            name: name.clone(),
        });
    }
    maps
}
```

> NOTE: If Phase 0 showed `map_dimensions` (not just options) also triggers per-map archive mounts and dominates, additionally move `width`/`height` into `MapInfoOutput` and drop them here; the grid's size label then loads progressively. Only do this if the numbers demand it.

- [ ] **Step 4:** In `main.rs`, add a `--map-info` mode. Add `map_info: bool` to `Args` and its `--map-info` parse arm, then branch in `run()` (place it before the single-minimap `--map` branch so it wins when both `--map` and `--map-info` are present):

```rust
    // Lazy map info: one map's options + attributed warnings (mounts the map).
    if args.map_info {
        if let Some(map) = args.map.clone() {
            return match std::panic::catch_unwind(|| map_info(&args.lib, &map)) {
                Ok(out) => {
                    println!("{}", serde_json::to_string(&out).unwrap_or_default());
                    0
                }
                Err(_) => {
                    let out = model::MapInfoOutput {
                        errors: vec!["worker panicked while reading map info".into()],
                        ..Default::default()
                    };
                    println!("{}", serde_json::to_string(&out).unwrap_or_default());
                    1
                }
            };
        }
        emit_error("missing --map <name> for --map-info".into());
        return 1;
    }
```

- [ ] **Step 5:** Implement `map_info` in `main.rs` (Init, mount the one map, read its options, drain warnings):

```rust
/// Load one map's archive set and read its options (+ attributed diagnostics).
fn map_info(lib: &str, map_name: &str) -> model::MapInfoOutput {
    let us = match unsafe { Unitsync::load(Path::new(lib)) } {
        Ok(us) => us,
        Err(e) => {
            return model::MapInfoOutput { errors: vec![e], ..Default::default() };
        }
    };
    let mut errors = Vec::new();
    if us.init(false, 0) == 0 {
        errors.push("unitsync Init returned 0 (failure)".into());
    }
    let options = read_options(&us, us.map_option_count(map_name));
    let warnings = drain_attributed(&us);
    us.uninit();
    model::MapInfoOutput { options, warnings, errors }
}
```

- [ ] **Step 6: Compile.** Run: `cargo build -p coilbox-unitsync-worker`. Expected: builds clean.
- [ ] **Step 7: Commit.**

```bash
git add crates/coilbox-unitsync-worker/src/main.rs crates/coilbox-unitsync-worker/src/model.rs
git commit -m "feat(unitsync-worker): defer per-map options to lazy --map-info; slim the enumeration scan"
```

### Task 1.2: Wire `unitsync_map_info` through the plugin

**Files:** Modify `crates/tauri-plugin-coilbox-unitsync/src/sidecar.rs`, `lib.rs`, `build.rs`, `permissions/default.toml`

- [ ] **Step 1:** In `sidecar.rs`, add `build_map_info_args` next to `build_game_args`:

```rust
pub fn build_map_info_args(lib: &str, datadir: &str, map_name: &str) -> Vec<String> {
    vec![
        "--lib".into(), lib.into(),
        "--datadir".into(), datadir.into(),
        "--map".into(), map_name.into(),
        "--map-info".into(),
    ]
}
```

- [ ] **Step 2:** In `lib.rs`, import `build_map_info_args` in the `use sidecar::{...}` block and add the command (models on `unitsync_game_info`):

```rust
/// `unitsync_map_info` — load one map's archive set to read its options + any
/// attributed diagnostics. Fetched on demand (mounts the map), not during scan.
#[tauri::command]
async fn unitsync_map_info(
    engine_path: String,
    data_dir: String,
    map_name: String,
) -> Result<CliResult, ()> {
    let (bin, libpath, engine_dir) = match prepare(&engine_path) {
        Ok(v) => v,
        Err(e) => return Ok(CliResult::err(e)),
    };
    let args = build_map_info_args(&libpath.to_string_lossy(), &data_dir, &map_name);
    let envs = loader_envs(&engine_dir, &data_dir);
    Ok(run_worker(bin, args, envs, MINIMAP_TIMEOUT, "map info").await)
}
```

- [ ] **Step 3:** Add `unitsync_map_info` to `generate_handler![...]` in `init()`.
- [ ] **Step 4:** Add `"unitsync_map_info"` to `COMMANDS` in `build.rs`.
- [ ] **Step 5:** Add `"allow-unitsync-map-info"` to `permissions/default.toml`.
- [ ] **Step 6: Verify.** Run: `cargo build -p tauri-plugin-coilbox-unitsync` then `cargo clippy -p tauri-plugin-coilbox-unitsync --all-targets -- -D warnings`. Expected: clean.
- [ ] **Step 7: Commit.**

```bash
git add crates/tauri-plugin-coilbox-unitsync/src/sidecar.rs crates/tauri-plugin-coilbox-unitsync/src/lib.rs crates/tauri-plugin-coilbox-unitsync/build.rs crates/tauri-plugin-coilbox-unitsync/permissions/default.toml
git commit -m "feat(unitsync-plugin): add unitsync_map_info command"
```

### Task 1.3: Frontend — lazy map options via `useUnitsyncMapInfo`

**Files:** Modify `src/content/bindings.ts`, `src/content/config.ts`, `src/content/pages/MapDetailPage.tsx`

- [ ] **Step 1:** In `bindings.ts`, remove `options` (and the now-empty `warnings`) from the `ScanResult` map type, and add the new command + type. Update the map interface within `ScanResult` to drop `options`/`warnings`, then add:

```ts
export interface MapInfoResult {
  options: ConfigOption[];
  warnings?: string[];
  errors?: string[];
}

export const unitsyncMapInfo = defineCommand<
  { enginePath: string; dataDir: string; mapName: string },
  MapInfoResult
>("coilbox-unitsync", "unitsync_map_info");
```

- [ ] **Step 2:** In `config.ts`, add a session-cached hook mirroring `useUnitsyncGameInfo`:

```ts
/** Session cache of map info, keyed by `dataDir::enginePath::mapName`. */
const mapInfoCache = new Map<string, MapInfoResult>();

/** Lazily load one map's options + warnings (mounts the map's archive). */
export function useUnitsyncMapInfo(
  enginePath?: string,
  dataDir?: string,
  mapName?: string,
) {
  const [info, setInfo] = useState<MapInfoResult | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!enginePath || !dataDir || !mapName) {
      setInfo(null);
      return;
    }
    const key = `${dataDir}::${enginePath}::${mapName}`;
    const cached = mapInfoCache.get(key);
    if (cached) {
      setInfo(cached);
      return;
    }
    let cancelled = false;
    setLoading(true);
    unitsyncMapInfo({ enginePath, dataDir, mapName })
      .then((res) => {
        if (cancelled) return;
        mapInfoCache.set(key, res);
        setInfo(res);
      })
      .catch(() => {
        if (!cancelled) setInfo(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [enginePath, dataDir, mapName]);

  return { info, loading };
}
```

Add `MapInfoResult` and `unitsyncMapInfo` to the `./bindings` import list at the top of `config.ts`.

- [ ] **Step 3:** In `MapDetailPage.tsx`, load options/warnings lazily. Add the hook after `useUnitsyncHeightmap`:

```tsx
  const mapInfo = useUnitsyncMapInfo(
    selected?.enginePath,
    selected?.rootPath,
    decoded,
  );
```

Replace the warnings banner source (`map.warnings`) and the options list (`map.options`) with the lazy data:

```tsx
      {mapInfo.info?.warnings?.length ? (
        <WarningBanner warnings={mapInfo.info.warnings} noun="map" />
      ) : null}
```

```tsx
      <OptionsList options={mapInfo.info?.options ?? []} title="Map options" />
```

Import `useUnitsyncMapInfo` from `../config`.

- [ ] **Step 4: Verify.** Run: `bun run typecheck` and `bunx biome ci .`. Expected: clean (no remaining references to `map.options`/`map.warnings`).
- [ ] **Step 5: Live smoke.** `bun tauri dev`, open a map detail; confirm options appear (after a brief load) and the grid/list still render. Screenshot for the PR.
- [ ] **Step 6: Commit.**

```bash
git add src/content/bindings.ts src/content/config.ts src/content/pages/MapDetailPage.tsx
git commit -m "feat(content): load map options lazily via unitsync_map_info"
```

---

## Phase 2 — Resilience: timeouts, cancel, visible status, no infinite loading

### Task 2.1: Generous timeout with a descriptive message

**Files:** Modify `crates/tauri-plugin-coilbox-unitsync/src/lib.rs`

- [ ] **Step 1:** Raise the scan timeout and make the timeout error name the operation + elapsed. Change the constant and thread the operation label into `run_worker_blocking`:

```rust
/// Scans/thumbnails rebuild per-archive state on big content roots; give them
/// generous room. Cancellation (below) is the primary stop mechanism; this is a
/// safety net against a wedged worker, not a normal-path limit.
const SCAN_TIMEOUT: Duration = Duration::from_secs(300);
```

- [ ] **Step 2:** Add a `what: &str` parameter to `run_worker_blocking` (passed from `run_worker`) and use it in the timeout message:

```rust
                if start.elapsed() > timeout {
                    let _ = child.kill();
                    let _ = child.wait();
                    return Err(format!(
                        "unitsync {what} timed out after {}s",
                        timeout.as_secs()
                    ));
                }
```

Update the `spawn_blocking` call in `run_worker` to pass `what.to_string()` into `run_worker_blocking`.

- [ ] **Step 3: Unit test the message format.** Add a `#[cfg(test)]` test that a helper `fmt_timeout(what, timeout)` returns `"unitsync scan timed out after 300s"`; extract the format into that helper so it's testable. Run: `cargo test -p tauri-plugin-coilbox-unitsync`. Expected: PASS.
- [ ] **Step 4: Commit.**

```bash
git add crates/tauri-plugin-coilbox-unitsync/src/lib.rs
git commit -m "feat(unitsync-plugin): 5min timeout + descriptive timeout message"
```

### Task 2.2: Cancellation registry + `unitsync_cancel`

**Files:** Modify `crates/tauri-plugin-coilbox-unitsync/src/lib.rs`, `build.rs`, `permissions/default.toml`, `sidecar.rs` (scan/thumbnails arg builders unchanged — `op_id` is a plugin-side concern, not a worker arg)

- [ ] **Step 1:** Add a process-global cancel registry to `lib.rs`:

```rust
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};

/// Maps a caller-supplied operation id to its cancel flag, so `unitsync_cancel`
/// can signal a running scan/thumbnail worker to stop.
fn cancel_registry() -> &'static Mutex<HashMap<String, Arc<AtomicBool>>> {
    static REG: OnceLock<Mutex<HashMap<String, Arc<AtomicBool>>>> = OnceLock::new();
    REG.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Register a cancel flag for `op_id` (replacing any stale one) and return it.
fn register_cancel(op_id: &str) -> Arc<AtomicBool> {
    let flag = Arc::new(AtomicBool::new(false));
    cancel_registry()
        .lock()
        .unwrap()
        .insert(op_id.to_string(), flag.clone());
    flag
}

/// Drop the flag for `op_id` once its operation finishes.
fn unregister_cancel(op_id: &str) {
    cancel_registry().lock().unwrap().remove(op_id);
}
```

- [ ] **Step 2:** Give `run_worker_blocking` an optional cancel flag it checks in the poll loop, killing the child with a distinct message:

```rust
fn run_worker_blocking(
    bin: PathBuf,
    args: Vec<String>,
    envs: Vec<(String, String)>,
    timeout: Duration,
    what: String,
    cancel: Option<Arc<AtomicBool>>,
) -> Result<String, String> {
    // ... unchanged spawn ...
    let status = loop {
        match child.try_wait() {
            Ok(Some(st)) => break st,
            Ok(None) => {
                if cancel.as_ref().is_some_and(|c| c.load(Ordering::Relaxed)) {
                    let _ = child.kill();
                    let _ = child.wait();
                    return Err(format!("unitsync {what} cancelled"));
                }
                if start.elapsed() > timeout {
                    let _ = child.kill();
                    let _ = child.wait();
                    return Err(format!(
                        "unitsync {what} timed out after {}s",
                        timeout.as_secs()
                    ));
                }
                std::thread::sleep(Duration::from_millis(50));
            }
            Err(e) => return Err(format!("error waiting for unitsync worker: {e}")),
        }
    };
    // ... unchanged tail ...
}
```

- [ ] **Step 3:** Thread an optional `cancel` through `run_worker`, and add `op_id: Option<String>` to `unitsync_scan` and `unitsync_thumbnails` only. In those two commands, register the flag before the run and unregister after:

```rust
async fn unitsync_scan(
    engine_path: String,
    data_dir: String,
    op_id: Option<String>,
) -> Result<CliResult, ()> {
    let (bin, libpath, engine_dir) = match prepare(&engine_path) {
        Ok(v) => v,
        Err(e) => return Ok(CliResult::err(e)),
    };
    let args = build_args(&libpath.to_string_lossy(), &data_dir);
    let envs = loader_envs(&engine_dir, &data_dir);
    let cancel = op_id.as_deref().map(register_cancel);
    let res = run_worker(bin, args, envs, SCAN_TIMEOUT, "scan", cancel).await;
    if let Some(id) = op_id.as_deref() {
        unregister_cancel(id);
    }
    Ok(res)
}
```

(Extend `run_worker`'s signature with `cancel: Option<Arc<AtomicBool>>` and pass it into `run_worker_blocking`. Other callers pass `None`.)

- [ ] **Step 4:** Add the cancel command:

```rust
/// `unitsync_cancel` — signal the scan/thumbnail worker registered under `op_id`
/// to stop. No-op if the id is unknown (already finished).
#[tauri::command]
async fn unitsync_cancel(op_id: String) -> Result<CliResult, ()> {
    if let Some(flag) = cancel_registry().lock().unwrap().get(&op_id) {
        flag.store(true, Ordering::Relaxed);
    }
    Ok(CliResult::ok(serde_json::json!({ "cancelled": true })))
}
```

Add `unitsync_cancel` to `generate_handler!`, to `COMMANDS` in `build.rs`, and `allow-unitsync-cancel` to `default.toml`.

- [ ] **Step 5: Unit-test the registry.** `#[cfg(test)]`: `register_cancel("x")` then set it, assert a second lookup sees `true`; `unregister_cancel("x")` removes it. Run: `cargo test -p tauri-plugin-coilbox-unitsync`. Expected: PASS.
- [ ] **Step 6: Verify.** `cargo clippy -p tauri-plugin-coilbox-unitsync --all-targets -- -D warnings`. Expected: clean.
- [ ] **Step 7: Commit.**

```bash
git add crates/tauri-plugin-coilbox-unitsync/src/lib.rs crates/tauri-plugin-coilbox-unitsync/build.rs crates/tauri-plugin-coilbox-unitsync/permissions/default.toml
git commit -m "feat(unitsync-plugin): cancellable scan/thumbnails via op-id registry"
```

### Task 2.3: Frontend — op-id, failure caching, shared startup store

**Files:** Modify `src/content/bindings.ts`, `src/content/config.ts`

- [ ] **Step 1:** In `bindings.ts`, add `opId` to `unitsyncScan`/`unitsyncThumbnails` arg types and add `unitsyncCancel`:

```ts
export const unitsyncCancel = defineCommand<{ opId: string }, unknown>(
  "coilbox-unitsync",
  "unitsync_cancel",
);
```

(Extend `unitsyncScan`'s and `unitsyncThumbnails`'s arg object types with `opId?: string`.)

- [ ] **Step 2:** In `config.ts`, make `primeScan` cache failures and accept an `opId`, so navigation doesn't silently re-fire the timeout. Use a separate error cache keyed the same way; `force` clears it:

```ts
/** Session cache of scan *failures*, so a failed target doesn't silently re-run
 * a multi-minute scan on every navigation. Cleared by a forced retry. */
const scanErrorCache = new Map<string, string>();

export async function primeScan(
  enginePath: string,
  dataDir: string,
  force = false,
  opId?: string,
): Promise<ScanResult> {
  const key = `${dataDir}::${enginePath}`;
  if (force) scanErrorCache.delete(key);
  const cached = scanCache.get(key);
  if (!force && cached) return cached;
  const cachedErr = scanErrorCache.get(key);
  if (!force && cachedErr) throw new Error(cachedErr);
  try {
    const res = await unitsyncScan({ enginePath, dataDir, opId });
    scanCache.set(key, res);
    return res;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    scanErrorCache.set(key, msg);
    throw e;
  }
}
```

- [ ] **Step 3:** Add a shared startup-scan store so a global banner can reflect state and offer Retry/Cancel. A tiny external store (module-level) subscribed via `useSyncExternalStore`:

```ts
import { useSyncExternalStore } from "react";
// ... (add to existing react import)

type StartupStatus = "idle" | "scanning" | "error" | "done";
interface StartupState {
  status: StartupStatus;
  error?: string;
  opId?: string;
}

let startupState: StartupState = { status: "idle" };
const startupListeners = new Set<() => void>();

/** Update the shared startup state and notify subscribers. */
export function setStartupState(next: StartupState) {
  startupState = next;
  for (const l of startupListeners) l();
}

/** Subscribe a component to the launch warm-up status. */
export function useContentStartup() {
  return useSyncExternalStore(
    (cb) => {
      startupListeners.add(cb);
      return () => startupListeners.delete(cb);
    },
    () => startupState,
  );
}

/** Cancel the in-flight warm-up scan, if any. */
export function cancelStartupScan() {
  if (startupState.opId) unitsyncCancel({ opId: startupState.opId });
}
```

Add `unitsyncCancel` to the `./bindings` imports.

- [ ] **Step 4: Verify.** `bun run typecheck` and `bunx biome ci .`. Expected: clean.
- [ ] **Step 5: Commit.**

```bash
git add src/content/bindings.ts src/content/config.ts
git commit -m "feat(content): cache scan failures, add op-id cancel + startup-scan store"
```

### Task 2.4: Visible startup status with Retry + Cancel

**Files:** Modify `src/content/ContentStartupProvider.tsx`

- [ ] **Step 1:** Drive the store and render a banner. Replace the silent `console.error` warm-up with one that sets state, generates an `opId`, and offers Retry/Cancel. Full replacement of the effect body + return:

```tsx
import { Button } from "@picoframe/frame";
import { useSetting } from "@picoframe/frame";
import { type ReactNode, useCallback, useEffect, useRef } from "react";
import { contentRescan, contentStateLoad } from "./bindings";
import {
  cancelStartupScan,
  primeScan,
  primeThumbnails,
  setStartupState,
  targetKey,
  targetsFromState,
  useContentPrefs,
  useContentStartup,
} from "./config";

export default function ContentStartupProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [prefs] = useContentPrefs();
  const [selectedKey] = useSetting<string>("content.scanTarget", "");
  const ran = useRef(false);
  const startup = useContentStartup();

  const warmUp = useCallback(async () => {
    const opId = crypto.randomUUID();
    setStartupState({ status: "scanning", opId });
    try {
      let { state } = await contentStateLoad(undefined);
      if (state.lastScanAt == null) {
        ({ state } = await contentRescan({
          withCounts: true,
          includeZerok: prefs.probeZeroK,
        }));
      }
      const targets = targetsFromState(state);
      const target =
        targets.find((t) => targetKey(t) === selectedKey) ?? targets[0];
      if (!target) {
        setStartupState({ status: "done" });
        return;
      }
      await primeScan(target.enginePath, target.rootPath, false, opId);
      // Thumbnails are the slow "everything after"; don't block done on them.
      setStartupState({ status: "done" });
      primeThumbnails(target.enginePath, target.rootPath).catch(() => {});
    } catch (e) {
      setStartupState({
        status: "error",
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }, [prefs.probeZeroK, selectedKey]);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    if (!prefs.autoScanOnStartup) return;
    warmUp();
  }, [prefs.autoScanOnStartup, warmUp]);

  return (
    <>
      {startup.status === "scanning" && (
        <div className="flex items-center justify-between gap-3 border-b border-border/50 bg-muted/40 px-4 py-2 text-sm">
          <span className="text-muted-foreground">Scanning content…</span>
          <Button variant="ghost" size="sm" onClick={cancelStartupScan}>
            Cancel
          </Button>
        </div>
      )}
      {startup.status === "error" && (
        <div className="flex items-center justify-between gap-3 border-b border-destructive/40 bg-destructive/10 px-4 py-2 text-sm">
          <span className="break-words text-destructive">
            Content scan failed: {startup.error}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              // Forced retry clears the cached failure inside primeScan.
              void (async () => {
                const target = /* re-derive below */ null;
                warmUp();
              })();
            }}
          >
            Retry
          </Button>
        </div>
      )}
      {children}
    </>
  );
}
```

> NOTE: the Retry handler above simplifies to just `onClick={() => warmUp()}` — `warmUp` re-runs the whole warm-up; because a plain re-run hits the cached failure, make `warmUp` pass `force = true` to `primeScan` when retrying. Implement by adding a `force` param to `warmUp(force = false)` and calling `primeScan(target.enginePath, target.rootPath, force, opId)`; the Retry button calls `warmUp(true)`.

- [ ] **Step 2:** Apply the `warmUp(force = false)` refinement from the note so Retry actually clears the cached failure:

```tsx
  const warmUp = useCallback(
    async (force = false) => {
      const opId = crypto.randomUUID();
      setStartupState({ status: "scanning", opId });
      try {
        let { state } = await contentStateLoad(undefined);
        if (state.lastScanAt == null) {
          ({ state } = await contentRescan({
            withCounts: true,
            includeZerok: prefs.probeZeroK,
          }));
        }
        const targets = targetsFromState(state);
        const target =
          targets.find((t) => targetKey(t) === selectedKey) ?? targets[0];
        if (!target) {
          setStartupState({ status: "done" });
          return;
        }
        await primeScan(target.enginePath, target.rootPath, force, opId);
        setStartupState({ status: "done" });
        primeThumbnails(target.enginePath, target.rootPath).catch(() => {});
      } catch (e) {
        setStartupState({
          status: "error",
          error: e instanceof Error ? e.message : String(e),
        });
      }
    },
    [prefs.probeZeroK, selectedKey],
  );
```

Retry button: `onClick={() => warmUp(true)}`.

- [ ] **Step 3: Verify.** `bun run typecheck` and `bunx biome ci .`. Expected: clean.
- [ ] **Step 4: Live smoke.** `bun tauri dev`: confirm the "Scanning content…" banner shows on launch with a working Cancel, and that forcing a failure (e.g. point at a bad engine) shows the error banner with a working Retry. Screenshots for the PR.
- [ ] **Step 5: Commit.**

```bash
git add src/content/ContentStartupProvider.tsx
git commit -m "feat(content): visible startup scan status with Retry and Cancel"
```

### Task 2.5: Detail pages surface errors instead of hanging

**Files:** Modify `src/content/pages/components/states.tsx`, `pages/MapDetailPage.tsx`, `pages/GameDetailPage.tsx`

- [ ] **Step 1:** In `states.tsx`, add a `DetailError` component (mirror `DetailLoading`'s layout; a message + Retry button):

```tsx
export function DetailError({
  backTo,
  message,
  onRetry,
}: {
  backTo: string;
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="flex flex-col gap-3 p-4">
      <Link
        to={backTo}
        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:underline"
      >
        <ArrowLeft className="size-3.5" /> Back
      </Link>
      <div className="flex items-center justify-between gap-3 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm">
        <span className="break-words text-destructive">{message}</span>
        <Button variant="outline" size="sm" onClick={onRetry}>
          Retry
        </Button>
      </div>
    </div>
  );
}
```

(Reuse the existing `Link`/`ArrowLeft`/`Button` imports in `states.tsx`; add any that are missing.)

- [ ] **Step 2:** In `MapDetailPage.tsx`, pull `error` + `run` from `useUnitsyncScan` and branch to `DetailError` before the `DetailLoading` guard:

```tsx
  const { data, loading, error, run } = useUnitsyncScan(
    selected?.enginePath,
    selected?.rootPath,
  );
  // ...
  if (error && !data)
    return (
      <DetailError
        backTo="/content/maps"
        message={error}
        onRetry={() => run(true)}
      />
    );
  if (!data || loading) return <DetailLoading backTo="/content/maps" />;
```

Import `DetailError` from `./components/states`.

- [ ] **Step 3:** Apply the identical pattern to `GameDetailPage.tsx` (`backTo="/content/games"`), pulling `error` + `run` from its `useUnitsyncScan`.
- [ ] **Step 4: Verify.** `bun run typecheck` and `bunx biome ci .`. Expected: clean.
- [ ] **Step 5: Live smoke.** Trigger a scan failure, navigate to a map/game detail, confirm the error+Retry renders instead of an endless spinner, and Retry recovers. Screenshot.
- [ ] **Step 6: Commit.**

```bash
git add src/content/pages/components/states.tsx src/content/pages/MapDetailPage.tsx src/content/pages/GameDetailPage.tsx
git commit -m "feat(content): detail pages show scan error + Retry instead of hanging"
```

---

## Phase 3 — Full verification pass

- [ ] **Step 1:** `cargo fmt --all --check` — expected: clean (run `cargo fmt --all` first if not).
- [ ] **Step 2:** `cargo clippy --all-targets --all-features -- -D warnings` — expected: clean.
- [ ] **Step 3:** `bunx biome ci .` — expected: clean.
- [ ] **Step 4:** `bun run typecheck` — expected: clean.
- [ ] **Step 5:** `bun tauri dev` end-to-end: launch → lists appear quickly (confirm against the Phase 0 numbers that the blocking scan is now seconds), map/game details load options progressively, Cancel + Retry work, thumbnails fill in after. Capture screenshots of Maps, Games, a Map detail, and the scanning/error banners for the PR.

---

## Phase 4 — Parallel worker pool (MEASUREMENT-GATED — build only if Phase 0/3 justify it)

**Do not build this unless** Phase 0's numbers (and the Phase 3 end-to-end) show that, *after* the progressive split, per-item work the user waits on (e.g. batch thumbnail rendering, or a still-slow list) is the bottleneck **and** is parallelisable across independent-VFS worker processes for a net win despite each worker re-paying `Init`.

**If justified, design sketch (author detailed tasks after the numbers land):**
- Add a plugin helper that spawns up to `min(N, available_parallelism())` workers, each handling a slice of the work items (e.g. a subset of maps for thumbnail rendering), and merges their JSON outputs.
- First worker warms `ArchiveCache`; measure whether staggering the first spawn before fanning out beats a cold parallel burst.
- Keep each worker one-archive-scoped where possible (isolation is the correctness win, per the out-of-process rationale in the worker's module doc).
- Thread the same `op_id` cancel flag to the whole pool so Cancel stops all children.

**If not justified:** record the numbers and the decision here, and close this phase as "not needed — progressive split was sufficient."

---

## Self-Review Notes

- **Spec coverage:** higher timeouts (2.1), GUI failure handling (2.4, 2.5), retry (2.4, 2.5), cancel (2.2, 2.4), splitting/perf (Phase 1 + 0), "list ASAP, rest after" (Phase 1 progressive split + 2.4 non-blocking thumbnails), "keep archive internals lazy" (untouched by design), parallel pool (Phase 4, gated). Covered.
- **Type consistency:** `MapInfoResult`/`MapInfoOutput` fields (`options`, `warnings`, `errors`) match across worker/plugin/frontend; `useUnitsyncMapInfo` returns `{ info, loading }` consumed as `mapInfo.info?.options`. `op_id`↔`opId` casing crosses the Tauri boundary (snake in Rust arg, camel in the JS binding) — Tauri converts automatically, consistent with existing commands.
- **Placeholders:** the two Task 2.4 blocks are intentionally shown as first-draft-then-refinement (the note + Step 2) to make the cache-clearing subtlety explicit; the final code is Step 2's `warmUp(force)` version.
