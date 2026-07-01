# Game detail loadpicture hero banner - Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show a Steam-library-style hero banner at the top of the Game detail page, using the game's loading-screen art (`modinfo.lua` `loadpicture` first, then a random image from the archive's `bitmaps/loadpictures/` folder, else a generated gradient placeholder), with the resolved image persistently cached on disk.

**Architecture:** A new worker subcommand resolves the image (opening the archive VFS once) and owns a persistent on-disk cache of the resolved `data:` URL keyed by the game's checksum - identical in shape to the existing minimap cache. A thin plugin command (`unitsync_game_header`) spawns the worker with the app cache dir, mirroring `unitsync_minimap`. The frontend adds a shared `useGameHeaderImage` hook (session `Map` cache) and a `GameHeader` component that renders the banner, replacing the plain-text header block in `GameDetailPage`.

**Tech Stack:** Rust (`coilbox-unitsync-worker` binary, `tauri-plugin-coilbox-unitsync`), React + TypeScript + Tailwind (Vite), Tauri v2, picoframe.

**Baseline:** Branch `feat/game-header-loadpicture` is already cut from `origin/main` (includes `e61f759`, the merged Play button). All work lands here.

**Spec:** `docs/superpowers/specs/2026-07-01-game-header-loadpicture-design.md`

**Note on testing:** The worker's unitsync code path needs a live `libunitsync`, so it is verified live (Task 13), not unit-tested - matching the repo's existing convention (`minimap.rs`/`archive.rs` have no unitsync unit tests). Pure helpers ARE unit-tested inline (`#[cfg(test)]`), like `heightmap.rs`/`lua.rs`/`coilbox-thumb-cache`. The frontend has no test runner (no vitest); it is verified by `bun run typecheck`, `bunx biome ci .`, and live Tauri MCP screenshots.

---

## Task 1: Worker output struct `GameHeaderOutput`

**Files:**
- Modify: `crates/coilbox-unitsync-worker/src/model.rs` (add struct near `MinimapOutput`, ~line 125)

- [ ] **Step 1: Add the struct**

Add after the `MinimapOutput` struct (after its closing `}` at ~line 125):

```rust
/// A resolved game header image, returned by the `game-header` mode. `data_url`
/// is absent when the game has no usable loadpicture/folder art (the frontend
/// then shows a gradient placeholder).
#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct GameHeaderOutput {
    /// Image `data:` URL, ready to drop into an `<img src>`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data_url: Option<String>,
    pub errors: Vec<String>,
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cargo check -p coilbox-unitsync-worker`
Expected: compiles (the struct is not yet referenced; `dead_code` is allowed at crate scope for models — if a warning appears it is resolved once Task 3 uses it).

- [ ] **Step 3: Commit**

```bash
git add crates/coilbox-unitsync-worker/src/model.rs
git commit -m "feat(unitsync-worker): add GameHeaderOutput model"
```

---

## Task 2: Worker pure helpers + tests (candidate filter, pick, cache read/write)

**Files:**
- Modify: `crates/coilbox-unitsync-worker/src/archive.rs` (add helpers + inline `#[cfg(test)]` module)

These helpers have no unitsync dependency, so they are unit-tested. Add them near the bottom of `archive.rs`, before the `emit_*` functions.

- [ ] **Step 1: Write the failing tests**

Add at the end of `crates/coilbox-unitsync-worker/src/archive.rs`:

```rust
#[cfg(test)]
mod header_tests {
    use super::*;

    #[test]
    fn loadpictures_filter_matches_images_only() {
        assert!(is_loadpicture_image("bitmaps/loadpictures/load01.jpg"));
        assert!(is_loadpicture_image("bitmaps/loadpictures/deep/art.PNG"));
        assert!(is_loadpicture_image("BITMAPS/LOADPICTURES/x.tga"));
        // wrong folder
        assert!(!is_loadpicture_image("bitmaps/other/load01.jpg"));
        // right folder, non-image
        assert!(!is_loadpicture_image("bitmaps/loadpictures/readme.txt"));
        // the folder entry itself
        assert!(!is_loadpicture_image("bitmaps/loadpictures/"));
    }

    #[test]
    fn pick_index_is_bounded() {
        assert_eq!(pick_index(0), None);
        for len in 1..=8usize {
            let i = pick_index(len).unwrap();
            assert!(i < len, "index {i} out of bounds for len {len}");
        }
    }

    #[test]
    fn cache_lookup_reports_hit_none_and_miss() {
        let dir = std::env::temp_dir().join("coilbox_header_cache_test");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();

        // Miss when neither file exists.
        assert!(matches!(read_header_cache(&dir, "aaaa"), CacheState::Miss));

        // Positive hit.
        std::fs::write(dir.join("bbbb.dataurl"), "data:image/png;base64,ZZ").unwrap();
        match read_header_cache(&dir, "bbbb") {
            CacheState::Hit(url) => assert_eq!(url, "data:image/png;base64,ZZ"),
            other => panic!("expected hit, got {other:?}"),
        }

        // Negative hit.
        std::fs::write(dir.join("cccc.none"), "").unwrap();
        assert!(matches!(read_header_cache(&dir, "cccc"), CacheState::Negative));

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn write_helpers_create_expected_files() {
        let dir = std::env::temp_dir().join("coilbox_header_write_test");
        let _ = std::fs::remove_dir_all(&dir);

        write_header_hit(&dir, "dddd", "data:image/jpeg;base64,QQ");
        assert_eq!(
            std::fs::read_to_string(dir.join("dddd.dataurl")).unwrap(),
            "data:image/jpeg;base64,QQ"
        );

        write_header_negative(&dir, "eeee");
        assert!(dir.join("eeee.none").exists());

        let _ = std::fs::remove_dir_all(&dir);
    }
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cargo test -p coilbox-unitsync-worker header_tests`
Expected: FAIL — `is_loadpicture_image`, `pick_index`, `read_header_cache`, `CacheState`, `write_header_hit`, `write_header_negative` not found.

- [ ] **Step 3: Implement the helpers**

Add just above the `emit_tree_error` function in `crates/coilbox-unitsync-worker/src/archive.rs`:

```rust
/// Image extensions we can turn into a `data:` URL for the header (matches the
/// formats `encode_preview_image` handles).
const HEADER_IMAGE_EXTS: &[&str] = &["jpg", "jpeg", "png", "gif", "bmp", "tga"];

/// Whether an archive member is an image inside `bitmaps/loadpictures/`.
fn is_loadpicture_image(path: &str) -> bool {
    let lower = path.to_lowercase();
    if !lower.starts_with("bitmaps/loadpictures/") {
        return false;
    }
    HEADER_IMAGE_EXTS
        .iter()
        .any(|ext| lower.ends_with(&format!(".{ext}")))
}

/// Pick an index in `0..len`, or `None` when `len == 0`. Uses wall-clock nanos as
/// a cheap one-time seed: the chosen image is frozen in the disk cache after the
/// first resolve, so this only needs to vary run-to-run, not be cryptographic.
fn pick_index(len: usize) -> Option<usize> {
    if len == 0 {
        return None;
    }
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    Some((nanos % len as u128) as usize)
}

/// State of the header disk cache for one checksum.
#[derive(Debug)]
enum CacheState {
    /// `<checksum>.dataurl` exists; contains the resolved `data:` URL.
    Hit(String),
    /// `<checksum>.none` marker exists; the game has no usable art.
    Negative,
    /// Neither file exists; the archive must be opened to resolve.
    Miss,
}

/// Look up the header cache for `checksum` under `dir`.
fn read_header_cache(dir: &Path, checksum: &str) -> CacheState {
    if let Ok(url) = std::fs::read_to_string(dir.join(format!("{checksum}.dataurl"))) {
        return CacheState::Hit(url);
    }
    if dir.join(format!("{checksum}.none")).exists() {
        return CacheState::Negative;
    }
    CacheState::Miss
}

/// Best-effort write of a resolved `data:` URL to the header cache.
fn write_header_hit(dir: &Path, checksum: &str, data_url: &str) {
    let _ = std::fs::create_dir_all(dir);
    let _ = std::fs::write(dir.join(format!("{checksum}.dataurl")), data_url);
}

/// Best-effort write of the "no art" negative marker.
fn write_header_negative(dir: &Path, checksum: &str) {
    let _ = std::fs::create_dir_all(dir);
    let _ = std::fs::write(dir.join(format!("{checksum}.none")), b"");
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cargo test -p coilbox-unitsync-worker header_tests`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add crates/coilbox-unitsync-worker/src/archive.rs
git commit -m "feat(unitsync-worker): add header cache + candidate helpers with tests"
```

---

## Task 3: Worker `game_header` resolver (unitsync path)

**Files:**
- Modify: `crates/coilbox-unitsync-worker/src/archive.rs` (add public `game_header` + `emit_game_header_error`; import the new model type)

This is the unitsync-dependent orchestration; verified live in Task 13.

- [ ] **Step 1: Update the model import**

At the top of `archive.rs`, change the `use crate::model::{...}` line (line 7) to include `GameHeaderOutput`:

```rust
use crate::model::{
    ArchiveExtractOutput, ArchiveFileEntry, ArchiveFileOutput, ArchiveTreeOutput, GameHeaderOutput,
};
```

- [ ] **Step 2: Add the resolver**

Add after the `extract` function (after its closing `}` at ~line 319), before the `emit_tree_error` group:

```rust
/// Resolve one game's header image: the `loadpicture` member first, else a random
/// image from `bitmaps/loadpictures/`, returned as a `data:` URL. Result is cached
/// on disk under `cache_dir/<checksum>.dataurl` (or a `.none` marker), so repeat
/// calls never re-open the archive. Caching is skipped when `checksum` is empty or
/// `cache_dir` is `None`.
pub fn game_header(
    lib: &str,
    archive_name: &str,
    loadpicture: &str,
    checksum: &str,
    cache_dir: Option<&Path>,
) -> GameHeaderOutput {
    // Cache lookup first — a hit avoids loading unitsync entirely.
    let cache = cache_dir.filter(|_| !checksum.is_empty());
    if let Some(dir) = cache {
        match read_header_cache(dir, checksum) {
            CacheState::Hit(url) => {
                return GameHeaderOutput {
                    data_url: Some(url),
                    errors: Vec::new(),
                }
            }
            CacheState::Negative => {
                return GameHeaderOutput {
                    data_url: None,
                    errors: Vec::new(),
                }
            }
            CacheState::Miss => {}
        }
    }

    let us = match unsafe { Unitsync::load(Path::new(lib)) } {
        Ok(u) => u,
        Err(e) => {
            return GameHeaderOutput {
                data_url: None,
                errors: vec![e],
            }
        }
    };
    us.init(false, 0);
    let mut errors = us.drain_errors();

    let open_path = resolve_open_path(&us, archive_name);
    let _ = us.drain_errors();
    let data_url = match open_path.as_deref().and_then(|p| us.open_archive(p)) {
        Some(handle) => {
            let url = resolve_header_member(&us, handle, loadpicture);
            us.close_archive(handle);
            url
        }
        None => {
            errors.push(format!("could not open archive {archive_name}"));
            None
        }
    };

    errors.extend(us.drain_errors());
    us.uninit();

    // Persist the outcome (positive or negative) so later launches skip the open.
    if let Some(dir) = cache {
        match &data_url {
            Some(url) => write_header_hit(dir, checksum, url),
            None => write_header_negative(dir, checksum),
        }
    }

    GameHeaderOutput { data_url, errors }
}

/// Within an open archive, read the `loadpicture` member if given and decodable,
/// else a random `bitmaps/loadpictures/` image. Returns the `data:` URL or `None`.
fn resolve_header_member(us: &Unitsync, handle: i32, loadpicture: &str) -> Option<String> {
    if !loadpicture.is_empty() {
        if let Some(url) = read_image_member(us, handle, loadpicture) {
            return Some(url);
        }
    }
    let mut candidates: Vec<String> = us
        .list_archive_files(handle)
        .into_iter()
        .map(|(path, _)| path)
        .filter(|p| is_loadpicture_image(p))
        .collect();
    candidates.sort();
    let idx = pick_index(candidates.len())?;
    read_image_member(us, handle, &candidates[idx])
}

/// Read one member and encode it as an image `data:` URL, or `None` if it isn't a
/// decodable image. Capped at `IMAGE_CAP` like the preview path.
fn read_image_member(us: &Unitsync, handle: i32, inner: &str) -> Option<String> {
    let ext = inner.rsplit('.').next().unwrap_or("").to_lowercase();
    let (size, bytes) = us.read_archive_member(handle, inner, IMAGE_CAP)?;
    if size as usize > IMAGE_CAP {
        return None;
    }
    encode_preview_image(&ext, &bytes)
}
```

- [ ] **Step 3: Add the panic error emitter**

Add alongside the other `emit_*` functions at the end of `archive.rs`:

```rust
/// Print a game-header error envelope to stdout (used on panic).
pub fn emit_game_header_error(msg: String) {
    let out = GameHeaderOutput {
        data_url: None,
        errors: vec![msg],
    };
    println!("{}", serde_json::to_string(&out).unwrap_or_default());
}
```

- [ ] **Step 4: Verify it compiles**

Run: `cargo check -p coilbox-unitsync-worker`
Expected: compiles clean (the new fns are referenced by the tests and, after Task 4, by `main.rs`). If `game_header`/`emit_game_header_error` warn as unused, that is resolved by Task 4.

- [ ] **Step 5: Run the helper tests again (no regression)**

Run: `cargo test -p coilbox-unitsync-worker header_tests`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add crates/coilbox-unitsync-worker/src/archive.rs
git commit -m "feat(unitsync-worker): resolve game header image with disk cache"
```

---

## Task 4: Worker CLI wiring (`--game-header`, `--checksum`)

**Files:**
- Modify: `crates/coilbox-unitsync-worker/src/main.rs` (Args struct, parse_args, dispatch)

- [ ] **Step 1: Add fields to the `Args` struct**

In the `struct Args { ... }` block, add after the `lua: bool,` / `source_file` fields (anywhere in the struct is fine; place after `skirmish_ais: bool,`):

```rust
    /// `--game-header`: resolve a game's loadpicture/`bitmaps/loadpictures` art.
    game_header: bool,
    /// Hex checksum used as the header cache key (game-header mode).
    checksum: Option<String>,
```

- [ ] **Step 2: Parse the new flags**

In `parse_args`, add the locals near the others:

```rust
    let mut game_header = false;
    let mut checksum = None;
```

Add the match arms in the `while let Some(a) = it.next()` loop (next to `--skirmish-ais`):

```rust
            "--game-header" => game_header = true,
            "--checksum" => checksum = it.next(),
```

And add both fields to the returned `Ok(Args { ... })` literal:

```rust
        game_header,
        checksum,
```

- [ ] **Step 3: Dispatch the mode**

In `run()`, add this block **before** the `if let Some(archive_name) = args.archive.clone() {` archive block (game-header also uses `--archive`, so it must be checked first), and after the `--thumbnails` block:

```rust
    // Game header: resolve one game's loadpicture / bitmaps/loadpictures art to a
    // cached data URL. Uses --archive (primary), --file (loadpicture hint),
    // --checksum (cache key), --cache-dir.
    if args.game_header {
        let archive_name = args.archive.clone().unwrap_or_default();
        let loadpicture = args.file.clone().unwrap_or_default();
        let checksum = args.checksum.clone().unwrap_or_default();
        return match std::panic::catch_unwind(|| {
            archive::game_header(&args.lib, &archive_name, &loadpicture, &checksum, cache_dir)
        }) {
            Ok(out) => {
                println!("{}", serde_json::to_string(&out).unwrap_or_default());
                0
            }
            Err(_) => {
                archive::emit_game_header_error("worker panicked while resolving game header".into());
                1
            }
        };
    }
```

- [ ] **Step 4: Verify it compiles**

Run: `cargo check -p coilbox-unitsync-worker`
Expected: compiles clean, no unused-code warnings for the header functions.

- [ ] **Step 5: Commit**

```bash
git add crates/coilbox-unitsync-worker/src/main.rs
git commit -m "feat(unitsync-worker): add --game-header CLI mode"
```

---

## Task 5: Plugin arg-builder `build_game_header_args`

**Files:**
- Modify: `crates/tauri-plugin-coilbox-unitsync/src/sidecar.rs` (add builder; follow `build_minimap_args`)

- [ ] **Step 1: Read the existing builder for the exact style**

Run: `rg -n "fn build_minimap_args" -A 20 crates/tauri-plugin-coilbox-unitsync/src/sidecar.rs`
Expected: shows a builder pushing `--lib`, `--datadir`, `--map`, `--mip`, and calling `push_cache_dir`.

- [ ] **Step 2: Add the builder**

Add after `build_minimap_args` in `sidecar.rs`:

```rust
/// Args for `--game-header`: resolve a game's loadpicture art to a cached data
/// URL. `loadpicture` is the modinfo hint (may be empty); `checksum` keys the
/// disk cache (empty disables caching).
pub fn build_game_header_args(
    lib: &str,
    datadir: &str,
    archive: &str,
    loadpicture: &str,
    checksum: &str,
    cache_dir: Option<&str>,
) -> Vec<String> {
    let mut args = vec![
        "--lib".into(),
        lib.into(),
        "--datadir".into(),
        datadir.into(),
        "--game-header".into(),
        "--archive".into(),
        archive.into(),
        "--file".into(),
        loadpicture.into(),
        "--checksum".into(),
        checksum.into(),
    ];
    push_cache_dir(&mut args, cache_dir);
    args
}
```

- [ ] **Step 3: Verify it compiles**

Run: `cargo check -p tauri-plugin-coilbox-unitsync`
Expected: compiles (unused-fn warning is fine until Task 6 wires it).

- [ ] **Step 4: Commit**

```bash
git add crates/tauri-plugin-coilbox-unitsync/src/sidecar.rs
git commit -m "feat(unitsync-plugin): add game-header sidecar arg builder"
```

---

## Task 6: Plugin command `unitsync_game_header` + ACL

**Files:**
- Modify: `crates/tauri-plugin-coilbox-unitsync/src/lib.rs` (import builder, add `header_cache_dir`, add command, register it)
- Modify: `crates/tauri-plugin-coilbox-unitsync/build.rs` (add to `COMMANDS`)
- Modify: `crates/tauri-plugin-coilbox-unitsync/permissions/default.toml` (add `allow-` line)

- [ ] **Step 1: Import the builder**

In `lib.rs`, add `build_game_header_args` to the `use sidecar::{...}` list (keep alphabetical-ish, next to `build_game_args`).

- [ ] **Step 2: Add a header cache-dir helper**

Add a constant next to `THUMB_CACHE_SUBDIR` and a helper next to `thumb_cache_dir`:

```rust
/// Subdirectory of the app cache dir holding resolved game-header `data:` URLs.
const HEADER_CACHE_SUBDIR: &str = "coilbox-unitsync-headers";

/// The on-disk header cache directory, under the app cache dir. `None` when the
/// platform can't resolve a cache dir (caching is then skipped).
fn header_cache_dir<R: Runtime>(app: &AppHandle<R>) -> Option<PathBuf> {
    app.path()
        .app_cache_dir()
        .ok()
        .map(|d| d.join(HEADER_CACHE_SUBDIR))
}
```

- [ ] **Step 3: Add the command**

Add after `unitsync_archive_file` (mirrors `unitsync_minimap`'s `app`/cache-dir pattern):

```rust
/// `unitsync_game_header` — resolve a game's loading-screen art (modinfo
/// `loadpicture` first, else a random `bitmaps/loadpictures/` image) to a `data:`
/// URL, cached on disk under the app cache dir keyed by `checksum`. `archive` is
/// the game's primary archive name; `loadpicture` is the modinfo hint (may be
/// empty); `checksum` is the game's hex CRC (empty disables caching).
#[tauri::command]
async fn unitsync_game_header<R: Runtime>(
    app: AppHandle<R>,
    engine_path: String,
    data_dir: String,
    archive: String,
    checksum: Option<String>,
    loadpicture: Option<String>,
) -> Result<CliResult, ()> {
    let (bin, libpath, engine_dir) = match prepare(&engine_path) {
        Ok(v) => v,
        Err(e) => return Ok(CliResult::err(e)),
    };
    let cache_dir = header_cache_dir(&app).map(|p| p.to_string_lossy().into_owned());
    let args = build_game_header_args(
        &libpath.to_string_lossy(),
        &data_dir,
        &archive,
        loadpicture.as_deref().unwrap_or(""),
        checksum.as_deref().unwrap_or(""),
        cache_dir.as_deref(),
    );
    let envs = loader_envs(&engine_dir, &data_dir);
    Ok(run_worker(bin, args, envs, MINIMAP_TIMEOUT, "game header").await)
}
```

- [ ] **Step 4: Register the command**

In `init()`, add `unitsync_game_header,` to the `generate_handler![...]` list (after `unitsync_archive_file,`).

- [ ] **Step 5: Add to ACL COMMANDS**

In `build.rs`, add `"unitsync_game_header",` to the `COMMANDS` array (after `"unitsync_archive_file",`).

- [ ] **Step 6: Add the permission**

In `permissions/default.toml`, add to the `permissions = [ ... ]` list (after `"allow-unitsync-archive-file",`):

```toml
  "allow-unitsync-game-header",
```

- [ ] **Step 7: Verify it builds (this regenerates the ACL)**

Run: `cargo build -p tauri-plugin-coilbox-unitsync`
Expected: builds clean; `permissions/autogenerated/` gains `allow-unitsync-game-header` / `deny-unitsync-game-header`.

- [ ] **Step 8: Commit**

```bash
git add crates/tauri-plugin-coilbox-unitsync/src/lib.rs crates/tauri-plugin-coilbox-unitsync/build.rs crates/tauri-plugin-coilbox-unitsync/permissions/
git commit -m "feat(unitsync-plugin): add unitsync_game_header command + ACL"
```

---

## Task 7: Rust format + clippy + build the worker sidecar

**Files:** none (verification + generated sidecar binary)

- [ ] **Step 1: Format**

Run: `cargo fmt --all`
Then: `cargo fmt --all --check`
Expected: no diff.

- [ ] **Step 2: Clippy (the exact CI command)**

Run: `cargo clippy --all-targets --all-features -- -D warnings`
Expected: no warnings/errors.

- [ ] **Step 3: Build the worker sidecar so the app crate can bundle it**

Run: `bun run sidecar:unitsync`
Expected: builds and places the `coilbox-unitsync-worker` binary under `src-tauri/binaries/` (per the memory note; the script handles the target triple). Required before `bun tauri dev`/clippy on the app crate.

- [ ] **Step 4: Commit (if fmt changed anything)**

```bash
git add -u crates/
git commit -m "style: cargo fmt" || echo "nothing to format"
```

---

## Task 8: Frontend binding `unitsyncGameHeader`

**Files:**
- Modify: `src/content/bindings.ts` (add `GameHeaderResult` + command after `unitsyncArchiveFile`, ~line 502)

- [ ] **Step 1: Add the type and command**

Add after the `unitsyncArchiveFile` command definition (~line 502):

```ts
export interface GameHeaderResult {
  /** Image `data:` URL. Absent when the game has no usable loadpicture/folder art. */
  dataUrl?: string;
  errors: string[];
}

/**
 * Resolve a game's loading-screen art to a `data:` URL: the modinfo `loadpicture`
 * first, else a random image from the archive's `bitmaps/loadpictures/` folder.
 * Resolved images are cached on disk (keyed by `checksum`), so repeat calls are
 * cheap and stable across launches. `archive` is the game's primary archive name.
 */
export const unitsyncGameHeader = defineCommand<
  {
    enginePath: string;
    dataDir: string;
    archive: string;
    checksum?: string;
    loadpicture?: string;
  },
  GameHeaderResult
>("coilbox-unitsync", "unitsync_game_header");
```

- [ ] **Step 2: Typecheck**

Run: `bun run typecheck`
Expected: passes.

- [ ] **Step 3: Commit**

```bash
git add src/content/bindings.ts
git commit -m "feat(content): add unitsyncGameHeader binding"
```

---

## Task 9: Frontend hook `useGameHeaderImage`

**Files:**
- Modify: `src/content/config.ts` (import the new binding/type; add hook after `useUnitsyncArchiveFile`, ~line 560)

- [ ] **Step 1: Extend the imports**

In `config.ts`, add `type GameHeaderResult,` to the type imports and `unitsyncGameHeader,` to the value imports from `./bindings` (the block near lines 5-21).

- [ ] **Step 2: Add the hook**

Add after the `useUnitsyncArchiveFile` hook:

```ts
/** Session cache of resolved header images, keyed by `dataDir::enginePath::checksum`. */
const gameHeaderCache = new Map<string, GameHeaderResult>();

/**
 * Lazily resolve a game's header image (loadpicture / bitmaps/loadpictures),
 * shared across the app via a session cache. No-ops until `archive` and
 * `checksum` are both set. The Rust command also caches the result on disk, so a
 * cold cache is still cheap on later launches.
 */
export function useGameHeaderImage(
  enginePath?: string,
  dataDir?: string,
  archive?: string,
  checksum?: string,
  loadpicture?: string,
) {
  const [data, setData] = useState<GameHeaderResult | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!enginePath || !dataDir || !archive || !checksum) {
      setData(null);
      return;
    }
    const key = `${dataDir}::${enginePath}::${checksum}`;
    const cached = gameHeaderCache.get(key);
    if (cached) {
      setData(cached);
      return;
    }
    let cancelled = false;
    setLoading(true);
    unitsyncGameHeader({ enginePath, dataDir, archive, checksum, loadpicture })
      .then((res) => {
        if (cancelled) return;
        gameHeaderCache.set(key, res);
        setData(res);
      })
      .catch(() => {
        if (!cancelled) setData(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [enginePath, dataDir, archive, checksum, loadpicture]);

  return { data, loading };
}
```

- [ ] **Step 3: Typecheck**

Run: `bun run typecheck`
Expected: passes.

- [ ] **Step 4: Commit**

```bash
git add src/content/config.ts
git commit -m "feat(content): add useGameHeaderImage hook with session cache"
```

---

## Task 10: `GameHeader` component

**Files:**
- Create: `src/content/pages/components/GameHeader.tsx`

The banner is always rendered (gradient placeholder base + optional art on top), with the back-link, title, version and Play button overlaid.

- [ ] **Step 1: Create the component**

Create `src/content/pages/components/GameHeader.tsx`:

```tsx
import { Button } from "@picoframe/frame";
import { ArrowLeft, Play } from "lucide-react";
import { Link } from "react-router";
import type { GameItem } from "../../bindings";
import { useGameHeaderImage } from "../../config";
import { isSdd } from "../../format";
import { SddBadge } from "./SddBadge";

/**
 * Steam-library-style hero banner for a game. Always renders a full-bleed 192px
 * banner: a deterministic gradient placeholder as the base layer, with the game's
 * resolved loading-screen art (when available) cropped over it. The back-link,
 * title, version and Play button overlay the banner.
 */
export function GameHeader({
  game,
  enginePath,
  dataDir,
  onPlay,
}: {
  game: GameItem;
  enginePath?: string;
  dataDir?: string;
  onPlay: () => void;
}) {
  const { data } = useGameHeaderImage(
    enginePath,
    dataDir,
    game.primaryArchive.name,
    game.checksum,
    game.info.loadpicture,
  );
  const artUrl = data?.dataUrl;

  return (
    <header className="relative -mx-4 -mt-4 h-48 w-full overflow-hidden">
      {/* Base layer: deterministic gradient so every game has a hero. */}
      <div
        className="absolute inset-0"
        style={{ background: gradientFor(game.name) }}
        aria-hidden
      />
      {/* Art layer: loading-screen image cropped to the wide/short strip. */}
      {artUrl && (
        <img
          src={artUrl}
          alt={`${game.name} loading screen`}
          className="absolute inset-0 size-full animate-[fadein_240ms_ease-out] object-cover object-center motion-reduce:animate-none"
        />
      )}
      {/* Scrim: fade into the page background along the bottom for text contrast. */}
      <div
        className="absolute inset-0 bg-gradient-to-t from-background via-background/40 to-transparent"
        aria-hidden
      />

      <Link
        to="/content/games"
        className="absolute left-3 top-3 inline-flex items-center gap-1 rounded bg-black/40 px-2 py-1 text-xs text-white backdrop-blur-sm hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"
      >
        <ArrowLeft className="size-3.5" /> Games
      </Link>

      <div className="absolute inset-x-4 bottom-3 flex items-end justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex items-center gap-2">
            <h1 className="break-words text-lg font-semibold text-white drop-shadow-[0_1px_3px_rgba(0,0,0,0.9)]">
              {game.name}
            </h1>
            {isSdd(game.primaryArchive) && <SddBadge />}
          </div>
          {game.info.version && (
            <span className="text-xs text-white/90 drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)]">
              v{game.info.version}
            </span>
          )}
        </div>
        <Button size="sm" className="shrink-0 gap-1.5" onClick={onPlay}>
          <Play className="size-4" /> Play
        </Button>
      </div>
    </header>
  );
}

/** A stable dark diagonal gradient derived from the game name (placeholder art). */
function gradientFor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) | 0;
  }
  const h1 = Math.abs(hash) % 360;
  const h2 = (h1 + 40) % 360;
  return `linear-gradient(135deg, hsl(${h1} 45% 22%), hsl(${h2} 50% 12%))`;
}
```

- [ ] **Step 2: Add the fade-in keyframe**

The `animate-[fadein_...]` utility needs a `fadein` keyframe. Confirm whether one exists:

Run: `rg -n "fadein|@keyframes|keyframes:" src/index.css tailwind.config.* 2>/dev/null`

If none exists, add to the global stylesheet (the file that holds `@tailwind`/`@theme`; typically `src/index.css`):

```css
@keyframes fadein {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}
```

(If the project uses Tailwind v4 `@theme`, add it as plain CSS in the same file — a bare `@keyframes` block works regardless.)

- [ ] **Step 3: Typecheck + lint**

Run: `bun run typecheck`
Then: `bunx biome ci .`
Expected: both pass.

- [ ] **Step 4: Commit**

```bash
git add src/content/pages/components/GameHeader.tsx src/index.css
git commit -m "feat(content): add GameHeader hero banner component"
```

---

## Task 11: Integrate `GameHeader` into `GameDetailPage`

**Files:**
- Modify: `src/content/pages/GameDetailPage.tsx`

Replace the plain-text `<header>` block with `<GameHeader>`, keeping `shortname`/`checksum`/`description` below the banner. The banner overlays the back-link, title, version and Play button, so those move out of the old header.

- [ ] **Step 1: Add the import**

Add to the imports at the top of `GameDetailPage.tsx`:

```tsx
import { GameHeader } from "./components/GameHeader";
```

- [ ] **Step 2: Drop now-unused header-only imports**

`ArrowLeft` and `Play` (from `lucide-react`) and the `Link` import (from `react-router`) are used only by the old header. After Step 3 they are unused. Update the imports:

- Change `import { ArrowLeft, FolderOpen, Play } from "lucide-react";` to `import { FolderOpen } from "lucide-react";`
- Change `import { Link, useNavigate, useParams } from "react-router";` to `import { useNavigate, useParams } from "react-router";`

(Keep `useNavigate`/`useParams`; `SddBadge` stays imported — it is still used by `GameHeader`, but `GameDetailPage` no longer references it directly, so also remove `import { SddBadge } from "./components/SddBadge";` if biome flags it as unused. Verify with typecheck in Step 4.)

- [ ] **Step 3: Replace the header block**

Replace the entire `<header className="flex flex-col gap-1">…</header>` block (the one containing the back `Link`, the title row with the Play button, the version/shortname/checksum row, and the description `<p>`) with:

```tsx
      <GameHeader
        game={game}
        enginePath={selected?.enginePath}
        dataDir={selected?.rootPath}
        onPlay={play}
      />

      <div className="flex flex-col gap-1">
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
          {game.info.shortname && (
            <span className="font-mono">{game.info.shortname}</span>
          )}
          {game.checksum && (
            <span className="font-mono">checksum {game.checksum}</span>
          )}
        </div>
        {game.info.description && (
          <p className="max-w-prose text-sm text-muted-foreground">
            {game.info.description}
          </p>
        )}
      </div>
```

Note: `version` now lives in the banner overlay, so it is intentionally dropped from the row below to avoid duplication.

- [ ] **Step 4: Typecheck + lint (catches any leftover unused imports)**

Run: `bun run typecheck`
Then: `bunx biome ci .`
Expected: both pass. If biome reports an unused import (`SddBadge`, `Link`, etc.), remove it and re-run.

- [ ] **Step 5: Commit**

```bash
git add src/content/pages/GameDetailPage.tsx
git commit -m "feat(content): render GameHeader hero on game detail page"
```

---

## Task 12: Full lint suite (the exact CI commands)

**Files:** none (verification)

- [ ] **Step 1: Rust format check**

Run: `cargo fmt --all --check`
Expected: no diff.

- [ ] **Step 2: Rust clippy**

Run: `cargo clippy --all-targets --all-features -- -D warnings`
Expected: clean. (Requires the sidecar from Task 7 Step 3 to exist, since CI's clippy compiles the app crate.)

- [ ] **Step 3: Frontend biome (CI mode)**

Run: `bunx biome ci .`
Expected: clean.

- [ ] **Step 4: Frontend typecheck**

Run: `bun run typecheck`
Expected: clean.

- [ ] **Step 5: Commit any fixes**

```bash
git add -u
git commit -m "chore: satisfy lint suite" || echo "nothing to fix"
```

---

## Task 13: Live verification with Tauri MCP

**Files:** none (manual/live verification; captures PR screenshots)

Per `CLAUDE.md`, GUI changes must be verified live and screenshotted for the PR. Give the user a chance to run `bun tauri dev`, or drive it via the Tauri MCP.

- [ ] **Step 1: Launch the app**

Run: `bun tauri dev` (or restart via the Tauri MCP `restart_app`).
Expected: app boots; a content root + engine are selected (Content plugin).

- [ ] **Step 2: Verify a game WITH loadpicture art**

- Navigate to Content → Games → a game known to ship a `loadpicture` or `bitmaps/loadpictures/` (e.g. Balanced Annihilation / BAR).
- Confirm: the 192px banner shows the loading-screen image cropped to the strip; the "← Games" link, title, `v<version>`, and Play button overlay it and are legible.
- Capture a screenshot (Tauri MCP `take_screenshot`) for the PR.

- [ ] **Step 3: Verify a game with NO art (placeholder)**

- Open a game with no loadpicture and no `bitmaps/loadpictures/` (e.g. a minimal `.sdd`).
- Confirm: a colored gradient banner shows with title + Play overlaid (no blank strip, no old plain header).
- Capture a screenshot.

- [ ] **Step 4: Verify Play still works**

- Click Play on a game; confirm it routes to `/play/skirmish` with that game preselected (unchanged merged behaviour).

- [ ] **Step 5: Verify the disk cache**

- Confirm files appear under the app cache dir `coilbox-unitsync-headers/` (`<checksum>.dataurl` for art, `<checksum>.none` for the placeholder game).
  Run: `ls "$(echo ~)/Library/Caches"/*/coilbox-unitsync-headers 2>/dev/null || rg --files ~ -g 'coilbox-unitsync-headers/*' 2>/dev/null | head`
  (macOS path; the exact app-cache location depends on the bundle identifier.)
- Restart the app, reopen the same game, and confirm the banner appears immediately (served from cache).

- [ ] **Step 6: Verify reduced motion (optional)**

- With OS "reduce motion" enabled, confirm the art appears without the fade-in.

---

## Self-Review (completed during planning)

- **Spec coverage:** loadpicture-first + folder-random-fallback (Task 3), gradient placeholder (Task 10), 192px full-bleed banner with overlaid back-link/title/version/Play (Tasks 10-11), worker-owned disk cache keyed by checksum with `.dataurl`/`.none` (Tasks 2-3), plugin command + ACL (Tasks 5-6), shared reusable hook (Task 9), build-on-`origin/main` baseline (branch already cut), live verification + screenshots (Task 13). Eviction is explicitly deferred in the spec and noted at handoff.
- **Type consistency:** `GameHeaderOutput { data_url: Option<String>, errors }` (Rust) ↔ `GameHeaderResult { dataUrl?, errors }` (TS, via `rename_all = "camelCase"`); command name `unitsync_game_header` consistent across worker CLI (`--game-header`), `build_game_header_args`, plugin command, `build.rs`, `default.toml`, and the TS binding `"unitsync_game_header"`; `useGameHeaderImage(enginePath, dataDir, archive, checksum, loadpicture)` signature matches its call site in `GameHeader.tsx`.
- **Placeholder scan:** none — every code step contains complete code.
```
