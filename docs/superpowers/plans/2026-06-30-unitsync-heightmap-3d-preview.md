# unitsync Heightmap → 3D Map Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract an installed map's heightmap through unitsync (`GetInfoMap "height"`) and reuse the existing `MapPreview3D` three.js component to show a physically-correct 3D terrain preview on the map detail page — no engine, no decompile.

**Architecture:** A new `heightmap` worker mode binds three already-stable unitsync symbols (`GetInfoMap`, `GetMapMinHeight`, `GetMapMaxHeight`), reads the full-resolution 16-bit heightmap by pure static SMF parsing, downscales it to a grayscale PNG `data:` URL, and returns it with the map's world `minHeight`/`maxHeight`. A new `unitsync_heightmap` Tauri command exposes it. On the frontend, `MapDetailPage` drapes the existing colour minimap over the heightmap displacement via `MapPreview3D`, which gains additive `heightSrc`/`textureSrc` props so it can take pre-resolved data URLs (the mapconv file-path flow is untouched).

**Tech Stack:** Rust (libloading FFI, `image` crate, base64), Tauri plugin (ACL autogen), TypeScript/React, three.js.

**Key facts verified against engine source (`spring/spring develop`):**
- `GetInfoMap(mapName, "height", buf, typeHint)` fills `(mapx+1)*(mapy+1)` raw 16-bit values (0..65535), endian-swabbed only — no normalisation. `typeHint` enum `bm_grayscale_16 = 2` (from `tools/unitsync/unitsync.h`).
- `GetInfoMapSize(mapName, "height", &w, &h)` reports those dims cheaply (no data read).
- `GetMapMinHeight(mapName)` / `GetMapMaxHeight(mapName)` return `float` world heights, prefer the `mapinfo.lua` `smf{minHeight/maxHeight}` override and fall back to the SMF header. Pure static parse, return `0.0f` on error.
- World height = `minHeight + raw/65536 * (maxHeight - minHeight)`. Encoding raw→grayscale linearly preserves this mapping, which is exactly what `MapPreview3D`'s `displacementScale = (maxHeight-minHeight)*s` / `displacementBias = minHeight*s` already assume.
- All three symbols are decade-old, ubiquitous unitsync exports; bind them as **optional** (matching the existing `GetInfoMapSize`/`GetMinimap` treatment) so a freak build that lacks one degrades gracefully rather than failing the load.

---

### Task 1: Worker FFI — bind GetInfoMap / GetMapMinHeight / GetMapMaxHeight

**Files:**
- Modify: `crates/coilbox-unitsync-worker/src/ffi.rs`

- [ ] **Step 1: Add the C-ABI type aliases**

After the `InfoMapSizeFn` alias (`ffi.rs:35-36`), add:

```rust
// GetInfoMap(mapName, infoType, *data, typeHint) -> nonzero on success. `data`
// is filled with width*height samples; for "height" they are raw 16-bit values.
type InfoMapFn =
    unsafe extern "C" fn(*const c_char, *const c_char, *mut u8, c_int) -> c_int;
// GetMapMinHeight(mapName) / GetMapMaxHeight(mapName) -> world height (float).
type FloatByStrFn = unsafe extern "C" fn(*const c_char) -> c_float;
```

- [ ] **Step 2: Add the `bm_grayscale_16` constant**

Just above `impl Unitsync {` (`ffi.rs:150`), add:

```rust
/// unitsync `BitmapType::bm_grayscale_16` — request the native 16-bit height
/// infomap so `GetInfoMap` copies raw values rather than down-converting to 8-bit.
const BM_GRAYSCALE_16: c_int = 2;
```

- [ ] **Step 3: Add the struct fields**

After `info_map_size_fn: Option<InfoMapSizeFn>,` (`ffi.rs:78`), add:

```rust
    info_map_fn: Option<InfoMapFn>,
    map_min_height_fn: Option<FloatByStrFn>,
    map_max_height_fn: Option<FloatByStrFn>,
```

- [ ] **Step 4: Resolve the symbols in `load`**

After `info_map_size_fn: opt(&lib, b"GetInfoMapSize\0"),` (`ffi.rs:170`), add:

```rust
            info_map_fn: opt(&lib, b"GetInfoMap\0"),
            map_min_height_fn: opt(&lib, b"GetMapMinHeight\0"),
            map_max_height_fn: opt(&lib, b"GetMapMaxHeight\0"),
```

- [ ] **Step 5: Add the accessor methods**

After `map_dimensions` (`ffi.rs:361`), add:

```rust
    /// Dimensions of the map's full-resolution height infomap, `(mapx+1, mapy+1)`.
    /// Cheap (no pixel read) — call before `heightmap_data` so a cache hit can skip
    /// the heavy read entirely. `None` if the build lacks `GetInfoMapSize` or the
    /// map has no height infomap.
    pub fn heightmap_size(&self, map_name: &str) -> Option<(u32, u32)> {
        let f = self.info_map_size_fn?;
        let name = CString::new(map_name).ok()?;
        let which = CString::new("height").ok()?;
        let mut w: c_int = 0;
        let mut h: c_int = 0;
        let ok = unsafe { f(name.as_ptr(), which.as_ptr(), &mut w, &mut h) };
        (ok != 0 && w > 0 && h > 0).then_some((w as u32, h as u32))
    }

    /// The map's full-resolution heightmap as raw 16-bit values (`w*h` long, row
    /// major). Values are the stored SMF heightmap (0..65535), spanning
    /// `min_height`..`max_height` in world units. `w`/`h` must come from
    /// `heightmap_size`. `None` if the build lacks `GetInfoMap` or the read fails.
    pub fn heightmap_data(&self, map_name: &str, w: u32, h: u32) -> Option<Vec<u16>> {
        let f = self.info_map_fn?;
        let name = CString::new(map_name).ok()?;
        let which = CString::new("height").ok()?;
        let mut buf = vec![0u16; (w as usize) * (h as usize)];
        let got = unsafe {
            f(
                name.as_ptr(),
                which.as_ptr(),
                buf.as_mut_ptr() as *mut u8,
                BM_GRAYSCALE_16,
            )
        };
        (got != 0).then_some(buf)
    }

    /// The map's `(min_height, max_height)` in world units (the heights at height
    /// infomap values 0 and 65535), honouring any `mapinfo.lua` `smf` override.
    /// `None` if the build lacks the accessors.
    pub fn height_bounds(&self, map_name: &str) -> Option<(f32, f32)> {
        let (min_f, max_f) = (self.map_min_height_fn?, self.map_max_height_fn?);
        let name = CString::new(map_name).ok()?;
        let lo = unsafe { min_f(name.as_ptr()) };
        let hi = unsafe { max_f(name.as_ptr()) };
        Some((lo, hi))
    }
```

- [ ] **Step 6: Compile-check the crate**

Run: `cargo build -p coilbox-unitsync-worker`
Expected: builds clean (no warnings about the new fields — they're read in Task 3).

> Note: there are no unit tests here — FFI requires a real `libunitsync`, so these methods are exercised by the `bun tauri dev` smoke in Task 12, matching how `minimap`/`map_dimensions` are covered today.

---

### Task 2: Worker model — `HeightmapOutput`

**Files:**
- Modify: `crates/coilbox-unitsync-worker/src/model.rs`

- [ ] **Step 1: Add the output struct**

After `MinimapOutput` (`model.rs:93`), add:

```rust
/// A rendered heightmap, returned by the lazy `heightmap` mode: a downscaled
/// grayscale PNG plus the world-height bounds needed for correct displacement.
#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct HeightmapOutput {
    /// Grayscale PNG `data:` URL of the (downscaled) heightmap, for a displacement map.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data_url: Option<String>,
    /// Full heightmap dimensions `(mapx+1, mapy+1)` before downscaling (its ratio
    /// is the map's true aspect ratio).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub width: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub height: Option<u32>,
    /// World height at infomap value 0 (where the flat water plane sits).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub min_height: Option<f32>,
    /// World height at infomap value 65535.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_height: Option<f32>,
    pub errors: Vec<String>,
}
```

- [ ] **Step 2: Compile-check**

Run: `cargo build -p coilbox-unitsync-worker`
Expected: builds clean.

---

### Task 3: Worker `heightmap` module — PNG encode + render

**Files:**
- Create: `crates/coilbox-unitsync-worker/src/heightmap.rs`
- Modify: `crates/coilbox-unitsync-worker/src/minimap.rs` (make `map_checksum` reusable)

- [ ] **Step 1: Make `map_checksum` reusable**

In `minimap.rs`, change the helper's visibility (`minimap.rs:109`) from:

```rust
fn map_checksum(us: &Unitsync, map_name: &str) -> Option<u32> {
```

to:

```rust
pub(crate) fn map_checksum(us: &Unitsync, map_name: &str) -> Option<u32> {
```

- [ ] **Step 2: Write the failing test for the PNG helper**

Create `crates/coilbox-unitsync-worker/src/heightmap.rs` with imports and a test module only:

```rust
//! Heightmap rendering: read a map's full-resolution 16-bit height infomap via
//! unitsync (`GetInfoMap "height"`, pure static SMF parsing) and turn it into a
//! downscaled grayscale PNG `data:` URL for the 3D terrain preview. Cached on disk
//! (under `cache_dir`, keyed by the map's checksum + max-side) like minimaps, so
//! the heavy read + encode only runs on a cache miss.

use crate::ffi::Unitsync;
use crate::minimap::map_checksum;
use crate::model::HeightmapOutput;
use base64::Engine;
use image::{DynamicImage, ImageBuffer, ImageFormat, Luma};
use std::io::Cursor;
use std::path::{Path, PathBuf};

/// Build a 16-bit grayscale PNG from a raw heightmap grid (`raw.len() == w*h`),
/// downscaled with `thumbnail` so its longest side is at most `max_side` (aspect
/// preserved). The linear value→grayscale mapping preserves the engine's
/// value→world-height relation, so the preview's displacement stays correct.
fn heightmap_png(raw: &[u16], w: u32, h: u32, max_side: u32) -> Result<Vec<u8>, String> {
    if raw.len() != (w as usize) * (h as usize) {
        return Err(format!(
            "heightmap size mismatch: got {} px, expected {}",
            raw.len(),
            w * h
        ));
    }
    let img = ImageBuffer::<Luma<u16>, _>::from_raw(w, h, raw.to_vec())
        .ok_or("failed to build heightmap image")?;
    let dyn_img = DynamicImage::ImageLuma16(img);
    let scaled = if w > max_side || h > max_side {
        dyn_img.thumbnail(max_side, max_side)
    } else {
        dyn_img
    };
    let mut png = Cursor::new(Vec::new());
    scaled
        .write_to(&mut png, ImageFormat::Png)
        .map_err(|e| format!("failed to encode heightmap PNG: {e}"))?;
    Ok(png.into_inner())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn heightmap_png_downscales_and_preserves_aspect() {
        // 4x2 grid, max longest side 2 -> thumbnail to 2x1, decodable grayscale PNG.
        let raw: Vec<u16> = vec![0, 21845, 43690, 65535, 0, 21845, 43690, 65535];
        let png = heightmap_png(&raw, 4, 2, 2).expect("encode");
        let decoded = image::load_from_memory(&png).expect("decode");
        assert_eq!(decoded.width(), 2);
        assert_eq!(decoded.height(), 1);
    }

    #[test]
    fn heightmap_png_rejects_size_mismatch() {
        let raw: Vec<u16> = vec![0, 1, 2];
        assert!(heightmap_png(&raw, 4, 2, 2).is_err());
    }
}
```

- [ ] **Step 3: Run the tests to verify they pass**

Run: `cargo test -p coilbox-unitsync-worker heightmap_png`
Expected: 2 passed. (The helper is fully implemented in Step 2; these lock its contract before the FFI-dependent `render` is added.)

- [ ] **Step 4: Add the cache helper, data-URL helper, `render`, and `emit_error`**

Append to `heightmap.rs` (before the `#[cfg(test)]` module):

```rust
/// Cache file for a heightmap PNG: `<cache_dir>/<checksum>-h<max_side>.png`. The
/// `h` prefix keeps it from colliding with the minimap cache (`<checksum>-<mip>`).
fn cache_file(cache_dir: Option<&Path>, checksum: Option<u32>, max_side: u32) -> Option<PathBuf> {
    let dir = cache_dir?;
    let crc = checksum?;
    Some(dir.join(format!("{crc:08x}-h{max_side}.png")))
}

/// Wrap PNG bytes in a base64 `data:` URL.
fn png_to_data_url(png: &[u8]) -> String {
    let b64 = base64::engine::general_purpose::STANDARD.encode(png);
    format!("data:image/png;base64,{b64}")
}

/// Render `map_name`'s heightmap to a grayscale PNG data URL plus its world-height
/// bounds (standalone unitsync session).
pub fn render(lib: &str, map_name: &str, max_side: u32, cache_dir: Option<&Path>) -> HeightmapOutput {
    let us = match unsafe { Unitsync::load(Path::new(lib)) } {
        Ok(u) => u,
        Err(e) => {
            return HeightmapOutput {
                errors: vec![e],
                ..Default::default()
            }
        }
    };
    us.init(false, 0);
    let _ = us.drain_errors();

    let bounds = us.height_bounds(map_name);
    let cache = cache_file(cache_dir, map_checksum(&us, map_name), max_side);

    let result = (|| -> Result<(String, u32, u32), String> {
        let (w, h) = us
            .heightmap_size(map_name)
            .ok_or_else(|| "no heightmap available".to_string())?;
        // Only the cache miss pays for the full GetInfoMap read + encode.
        let png = coilbox_thumb_cache::cached(cache, || {
            let raw = us
                .heightmap_data(map_name, w, h)
                .ok_or_else(|| "failed to read heightmap".to_string())?;
            heightmap_png(&raw, w, h, max_side)
        })?;
        Ok((png_to_data_url(&png), w, h))
    })();

    let errors = us.drain_errors();
    us.uninit();

    match result {
        Ok((data_url, w, h)) => HeightmapOutput {
            data_url: Some(data_url),
            width: Some(w),
            height: Some(h),
            min_height: bounds.map(|(lo, _)| lo),
            max_height: bounds.map(|(_, hi)| hi),
            errors,
        },
        Err(e) => HeightmapOutput {
            min_height: bounds.map(|(lo, _)| lo),
            max_height: bounds.map(|(_, hi)| hi),
            errors: std::iter::once(e).chain(errors).collect(),
            ..Default::default()
        },
    }
}

/// Print a heightmap error envelope to stdout (used on panic).
pub fn emit_error(msg: String) {
    let out = HeightmapOutput {
        errors: vec![msg],
        ..Default::default()
    };
    println!("{}", serde_json::to_string(&out).unwrap_or_default());
}
```

- [ ] **Step 5: Run tests + compile-check (module not yet wired into `main`)**

Run: `cargo build -p coilbox-unitsync-worker`
Expected: an `unused` warning for `heightmap::render`/`emit_error` is acceptable here; it clears in Task 4. No errors.

- [ ] **Step 6: Commit**

```bash
git add crates/coilbox-unitsync-worker/src/ffi.rs crates/coilbox-unitsync-worker/src/model.rs crates/coilbox-unitsync-worker/src/heightmap.rs crates/coilbox-unitsync-worker/src/minimap.rs
git commit -m "feat(unitsync-worker): read map heightmap via GetInfoMap, encode grayscale PNG"
```

---

### Task 4: Worker CLI — `--heightmap` / `--max-side` dispatch

**Files:**
- Modify: `crates/coilbox-unitsync-worker/src/main.rs`

- [ ] **Step 1: Register the module**

After `mod game;` (`main.rs:19`), add:

```rust
mod heightmap;
```

- [ ] **Step 2: Add the CLI fields**

In `struct Args` (`main.rs:31-43`), after `thumbnails: bool,`, add:

```rust
    heightmap: bool,
```

and after `mip: i32,`, add:

```rust
    /// Longest-side pixel cap for the heightmap PNG downscale (heightmap mode).
    max_side: u32,
```

- [ ] **Step 3: Parse the new flags**

In `parse_args` (`main.rs:179-223`), after `let mut thumbnails = false;`, add:

```rust
    let mut heightmap = false;
```

and after `let mut mip = 1; // 512x512 by default`, add:

```rust
    let mut max_side = 512u32;
```

In the `match a.as_str()` arm list, after `"--thumbnails" => thumbnails = true,`, add:

```rust
            "--heightmap" => heightmap = true,
            "--max-side" => {
                max_side = it
                    .next()
                    .and_then(|s| s.parse().ok())
                    .ok_or("--max-side needs an integer")?
            }
```

In the returned `Ok(Args { ... })`, after `thumbnails,`, add `heightmap,`; after `mip,`, add `max_side,`.

- [ ] **Step 4: Dispatch the mode**

In `run()`, immediately before the `// Single minimap renders one map;` block (`main.rs:147`), add:

```rust
    // Heightmap: render one map's height infomap to a grayscale PNG data URL.
    if args.heightmap {
        if let Some(map) = args.map.clone() {
            return match std::panic::catch_unwind(|| {
                heightmap::render(&args.lib, &map, args.max_side, cache_dir)
            }) {
                Ok(out) => {
                    println!("{}", serde_json::to_string(&out).unwrap_or_default());
                    0
                }
                Err(_) => {
                    heightmap::emit_error("worker panicked while rendering heightmap".into());
                    1
                }
            };
        }
        emit_error("missing --map <name> for --heightmap".into());
        return 1;
    }

```

- [ ] **Step 5: Build and smoke the CLI arg surface**

Run: `cargo build -p coilbox-unitsync-worker`
Expected: builds clean, no unused-function warnings.

Run: `cargo run -p coilbox-unitsync-worker -- --lib /nonexistent --datadir /tmp --map Foo --heightmap`
Expected: a JSON line on stdout whose `errors` array mentions failing to load the library (proves the mode is wired and emits the `HeightmapOutput` envelope rather than crashing).

- [ ] **Step 6: Commit**

```bash
git add crates/coilbox-unitsync-worker/src/main.rs
git commit -m "feat(unitsync-worker): add --heightmap CLI mode"
```

---

### Task 5: Plugin sidecar — `build_heightmap_args`

**Files:**
- Modify: `crates/tauri-plugin-coilbox-unitsync/src/sidecar.rs`

- [ ] **Step 1: Write the failing test**

In the `#[cfg(test)] mod tests`, after `minimap_args_append_cache_dir_when_present` (`sidecar.rs:169`), add:

```rust
    #[test]
    fn heightmap_args_carry_map_flag_and_max_side() {
        let a = build_heightmap_args(
            "/eng/libunitsync.dylib",
            "/data",
            "Map v1",
            512,
            Some("/cache/thumbs"),
        );
        assert!(a.contains(&"--heightmap".to_string()));
        assert_eq!(
            &a[a.len() - 2..],
            &["--cache-dir".to_string(), "/cache/thumbs".to_string()]
        );
        // map name and max-side present
        let i = a.iter().position(|x| x == "--map").unwrap();
        assert_eq!(a[i + 1], "Map v1");
        let j = a.iter().position(|x| x == "--max-side").unwrap();
        assert_eq!(a[j + 1], "512");
    }
```

- [ ] **Step 2: Run to verify it fails**

Run: `cargo test -p tauri-plugin-coilbox-unitsync heightmap_args_carry_map_flag_and_max_side`
Expected: FAIL — `build_heightmap_args` not found.

- [ ] **Step 3: Implement `build_heightmap_args`**

After `build_minimap_args` (`sidecar.rs:80`), add:

```rust
/// Build args for heightmap mode: scan args plus the map name, the `--heightmap`
/// flag, the longest-side pixel cap, and the optional on-disk PNG cache directory.
pub fn build_heightmap_args(
    lib: &str,
    datadir: &str,
    map: &str,
    max_side: i32,
    cache_dir: Option<&str>,
) -> Vec<String> {
    let mut args = build_args(lib, datadir);
    args.push("--map".into());
    args.push(map.into());
    args.push("--heightmap".into());
    args.push("--max-side".into());
    args.push(max_side.to_string());
    push_cache_dir(&mut args, cache_dir);
    args
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cargo test -p tauri-plugin-coilbox-unitsync heightmap_args_carry_map_flag_and_max_side`
Expected: PASS.

---

### Task 6: Plugin command — `unitsync_heightmap`

**Files:**
- Modify: `crates/tauri-plugin-coilbox-unitsync/src/lib.rs`

- [ ] **Step 1: Import the arg builder**

In the `use sidecar::{ ... }` block (`lib.rs:14-17`), add `build_heightmap_args,` to the import list (keep alphabetical: after `build_game_args,`).

- [ ] **Step 2: Add the command**

After `unitsync_minimap` (`lib.rs:225`), add:

```rust
/// `unitsync_heightmap` — render one map's height infomap as a downscaled
/// grayscale PNG data URL, with the world `minHeight`/`maxHeight` for correct 3D
/// displacement. `max_side` caps the PNG's longest side (defaults to 512).
#[tauri::command]
async fn unitsync_heightmap<R: Runtime>(
    app: AppHandle<R>,
    engine_path: String,
    data_dir: String,
    map_name: String,
    max_side: Option<i32>,
) -> Result<CliResult, ()> {
    let (bin, libpath, engine_dir) = match prepare(&engine_path) {
        Ok(v) => v,
        Err(e) => return Ok(CliResult::err(e)),
    };
    let cache_dir = thumb_cache_dir(&app).map(|p| p.to_string_lossy().into_owned());
    let args = build_heightmap_args(
        &libpath.to_string_lossy(),
        &data_dir,
        &map_name,
        max_side.unwrap_or(512),
        cache_dir.as_deref(),
    );
    let envs = loader_envs(&engine_dir, &data_dir);
    Ok(run_worker(bin, args, envs, MINIMAP_TIMEOUT, "heightmap").await)
}
```

- [ ] **Step 3: Register the handler**

In `generate_handler![ ... ]` (`lib.rs:321-329`), add `unitsync_heightmap,` after `unitsync_minimap,`.

- [ ] **Step 4: Compile-check (ACL still missing — see Task 7)**

Run: `cargo build -p tauri-plugin-coilbox-unitsync`
Expected: builds clean.

---

### Task 7: Plugin ACL — autogenerated permission + default aggregation

**Files:**
- Modify: `crates/tauri-plugin-coilbox-unitsync/build.rs`
- Modify: `crates/tauri-plugin-coilbox-unitsync/permissions/default.toml`

- [ ] **Step 1: Add the command to the build manifest**

In `build.rs`, append `"unitsync_heightmap",` to the `COMMANDS` array (after `"unitsync_minimap",`).

- [ ] **Step 2: Aggregate the new permission into `:default`**

In `permissions/default.toml`, add `"allow-unitsync-heightmap",` to the `permissions` list (after `"allow-unitsync-minimap",`), and update the `description` to mention heightmap:

```toml
description = "Allows the unitsync plugin's content-scan, minimap, heightmap, thumbnail, game-info and engine-config commands."
```

- [ ] **Step 3: Build to regenerate the autogenerated permission file**

Run: `cargo build -p tauri-plugin-coilbox-unitsync`
Expected: builds clean and creates `permissions/autogenerated/commands/unitsync_heightmap.toml` (the build helper emits one `allow-`/`deny-` pair per `COMMANDS` entry).

- [ ] **Step 4: Confirm the autogenerated file exists**

Run: `ls crates/tauri-plugin-coilbox-unitsync/permissions/autogenerated/commands/unitsync_heightmap.toml`
Expected: the path prints (no "No such file").

> The app capability `src-tauri/capabilities/unitsync.json` already grants `coilbox-unitsync:default`, which now includes `allow-unitsync-heightmap` — no capability edit needed.

- [ ] **Step 5: Commit the Rust + ACL side**

```bash
git add crates/tauri-plugin-coilbox-unitsync/src/sidecar.rs crates/tauri-plugin-coilbox-unitsync/src/lib.rs crates/tauri-plugin-coilbox-unitsync/build.rs crates/tauri-plugin-coilbox-unitsync/permissions/default.toml crates/tauri-plugin-coilbox-unitsync/permissions/autogenerated/commands/unitsync_heightmap.toml
git commit -m "feat(unitsync-plugin): add unitsync_heightmap command + ACL"
```

---

### Task 8: Frontend binding — `unitsyncHeightmap`

**Files:**
- Modify: `src/content/bindings.ts`

- [ ] **Step 1: Add the result interface + command**

After the `unitsyncMinimap` definition (`bindings.ts:251`), add:

```typescript
export interface HeightmapResult {
  /** Grayscale PNG `data:` URL of the (downscaled) heightmap, for a displacement map. */
  dataUrl?: string;
  /** Full heightmap dimensions `(mapx+1, mapy+1)`; the ratio is the map's aspect ratio. */
  width?: number;
  height?: number;
  /** World height at heightmap value 0 (the flat water plane sits here). */
  minHeight?: number;
  /** World height at heightmap value 65535. */
  maxHeight?: number;
  errors: string[];
}

/**
 * Render one map's height infomap as a grayscale PNG data URL plus its world
 * `minHeight`/`maxHeight` (for physically-correct 3D displacement). Lazy — a
 * separate unitsync session, cached on disk. `maxSide` caps the PNG's longest side
 * (default 512).
 */
export const unitsyncHeightmap = defineCommand<
  { enginePath: string; dataDir: string; mapName: string; maxSide?: number },
  HeightmapResult
>("coilbox-unitsync", "unitsync_heightmap");
```

- [ ] **Step 2: Typecheck**

Run: `bun run typecheck`
Expected: no errors.

---

### Task 9: Frontend hook — `useUnitsyncHeightmap`

**Files:**
- Modify: `src/content/config.ts`

- [ ] **Step 1: Import the new types**

In the bindings import block near the top of `config.ts` (the one exposing `MinimapResult` at line ~11), add `type HeightmapResult,` and `unitsyncHeightmap,` to the import list.

- [ ] **Step 2: Add the cache + hook**

After `useUnitsyncMinimap` (`config.ts:608`), add:

```typescript
/** Session cache of heightmap results, keyed by `dataDir::enginePath::mapName`. */
const heightmapCache = new Map<string, HeightmapResult>();

/** Lazily render and cache a map's heightmap (PNG data URL + world-height bounds). */
export function useUnitsyncHeightmap(
  enginePath?: string,
  dataDir?: string,
  mapName?: string,
) {
  const [data, setData] = useState<HeightmapResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enginePath || !dataDir || !mapName) {
      setData(null);
      return;
    }
    const key = `${dataDir}::${enginePath}::${mapName}`;
    const apply = (res: HeightmapResult) => {
      setData(res);
      if (!res.dataUrl && res.errors?.length) setError(res.errors.join("; "));
    };
    const cached = heightmapCache.get(key);
    if (cached) {
      apply(cached);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    unitsyncHeightmap({ enginePath, dataDir, mapName })
      .then((res) => {
        if (cancelled) return;
        heightmapCache.set(key, res);
        apply(res);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [enginePath, dataDir, mapName]);

  return { data, loading, error };
}
```

- [ ] **Step 3: Typecheck**

Run: `bun run typecheck`
Expected: no errors.

---

### Task 10: `MapPreview3D` — additive pre-resolved source props

**Files:**
- Modify: `src/mapconv/pages/components/MapPreview3D.tsx`

Rationale: the mapconv compile/decompile flow passes file paths and relies on `getImageInfo` to downscale them. The content flow already has downscaled `data:` URLs (from the worker + the minimap), so it should bypass the file fetch. This is purely additive — the existing path props keep working unchanged.

- [ ] **Step 1: Make path props optional and add source props**

In the props type (`MapPreview3D.tsx:52-62`), change:

```typescript
  heightmapPath: string;
  texturePath: string;
```

to:

```typescript
  /** File path to the heightmap image (mapconv flow); resolved via `mc_image_info`. */
  heightmapPath?: string;
  /** File path to the colour/texture image (mapconv flow). */
  texturePath?: string;
  /** Pre-resolved heightmap source (data URL); used instead of `heightmapPath`. */
  heightSrc?: string;
  /** Pre-resolved colour source (data URL); used instead of `texturePath`. */
  textureSrc?: string;
```

and add the two new names to the destructured params (`MapPreview3D.tsx:43-51`), after `texturePath,`:

```typescript
  heightSrc,
  textureSrc,
```

- [ ] **Step 2: Bypass the fetch when sources are pre-resolved**

Replace the fetch effect body (`MapPreview3D.tsx:94-112`) with:

```typescript
  // Fetch both maps as downscaled data URLs whenever the inputs change. When
  // pre-resolved sources are supplied (the content flow already has downscaled
  // data URLs), use them directly and skip the file-path fetch.
  useEffect(() => {
    let cancelled = false;
    setSrcs(null);
    setFailed(false);
    if (heightSrc && textureSrc) {
      setSrcs({ height: heightSrc, texture: textureSrc });
      return;
    }
    if (!heightmapPath || !texturePath) return;
    Promise.all([
      getImageInfo(heightmapPath, HEIGHT_MAX),
      getImageInfo(texturePath, TEXTURE_MAX),
    ])
      .then(([h, t]) => {
        if (!cancelled) setSrcs({ height: h.thumb, texture: t.thumb });
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [heightmapPath, texturePath, heightSrc, textureSrc]);
```

- [ ] **Step 3: Typecheck + lint the component**

Run: `bun run typecheck`
Expected: no errors (existing mapconv callers still satisfy the now-optional props).

Run: `bunx biome ci src/mapconv/pages/components/MapPreview3D.tsx`
Expected: no findings.

---

### Task 11: Wire the 3D preview into `MapDetailPage`

**Files:**
- Modify: `src/content/pages/MapDetailPage.tsx`

- [ ] **Step 1: Import the hook + component**

Add `useUnitsyncHeightmap` to the existing `../config` import (`MapDetailPage.tsx:3-8`), and add a new import:

```typescript
import { MapPreview3D } from "../../mapconv/pages/components/MapPreview3D";
```

- [ ] **Step 2: Call the hook**

After the `minimap` hook call (`MapDetailPage.tsx:26-30`), add:

```typescript
  const heightmap = useUnitsyncHeightmap(
    selected?.enginePath,
    selected?.rootPath,
    decoded,
  );
```

- [ ] **Step 3: Render a 3D preview section**

Immediately after the closing `</section>` of the 2D Preview block (`MapDetailPage.tsx:122`), add:

```tsx
      {heightmap.data?.dataUrl && minimap.dataUrl && (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-medium">3D preview</h2>
          <MapPreview3D
            className="max-w-2xl"
            heightSrc={heightmap.data.dataUrl}
            textureSrc={minimap.dataUrl}
            minHeight={heightmap.data.minHeight ?? 0}
            maxHeight={heightmap.data.maxHeight ?? 0}
            worldWidth={heightmap.data.width ?? map.width ?? 1}
            worldHeight={heightmap.data.height ?? map.height ?? 1}
          />
        </section>
      )}
```

Notes for the implementer:
- `worldWidth`/`worldHeight` only set the plane's aspect ratio in `MapPreview3D`, so the raw heightmap dims (`width`/`height` = `mapx+1`/`mapy+1`) are exactly right; the `map.width`/`map.height` fallback (metal dims) has the same ratio.
- `appearance` is intentionally omitted — unitsync doesn't surface water/sky colours here, so the preview uses `MapPreview3D`'s defaults (translucent water plane at world height 0, which is meaningful because heights are absolute world units).
- The colour texture is the square-sampled minimap stretched across the aspect-correct plane (same trade-off the 2D `<img object-fill>` already makes) — adequate for a preview.

- [ ] **Step 4: Typecheck + lint**

Run: `bun run typecheck`
Expected: no errors.

Run: `bunx biome ci src/content/pages/MapDetailPage.tsx src/content/config.ts src/content/bindings.ts`
Expected: no findings.

- [ ] **Step 5: Commit the frontend**

```bash
git add src/content/bindings.ts src/content/config.ts src/mapconv/pages/components/MapPreview3D.tsx src/content/pages/MapDetailPage.tsx
git commit -m "feat(content): show 3D heightmap preview on the map detail page"
```

---

### Task 12: Full verification — lint suite, sidecar build, live smoke

**Files:** none (verification only)

- [ ] **Step 1: Rebuild the unitsync sidecar so the app crate sees the new worker**

Run: `bun run sidecar:unitsync`
Expected: builds and places `coilbox-unitsync-worker-<triple>` under `src-tauri/binaries/`.

- [ ] **Step 2: Run the exact CI lint commands**

Run: `cargo fmt --all --check`
Run: `cargo clippy --all-targets --all-features -- -D warnings`
Run: `bunx biome ci .`
Run: `bun run typecheck`
Expected: all pass. (Run `cargo fmt --all` first if the check reports diffs — let rustfmt own formatting.)

- [ ] **Step 3: Run the worker + plugin unit tests**

Run: `cargo test -p coilbox-unitsync-worker -p tauri-plugin-coilbox-unitsync`
Expected: all pass (includes `heightmap_png_*` and `heightmap_args_*`).

- [ ] **Step 4: Live smoke in the app**

Run: `bun tauri dev`
Then, in the app:
1. Open Content → Maps, click into a map's detail page.
2. Confirm the existing 2D minimap still renders (no regression).
3. Confirm a new "3D preview" section appears below it with an orbitable terrain whose vertical relief matches the map, the water plane sits at sea level, and the Water/Wireframe toggles work.
4. Open the mapconv Compile and Decompile pages and confirm their 3D previews still work (the path-based flow is unchanged).
5. Re-open the same map detail page and confirm the heightmap loads instantly (disk cache hit).

Report honestly: if `GetInfoMap`/`GetMapMinHeight` are absent on the bundled engine's `libunitsync` (unexpected, but the binding is optional), the section simply won't appear and `heightmap.data.errors` will explain why — surface that rather than claiming success.

- [ ] **Step 5: Capture screenshots for the PR**

Per project `CLAUDE.md`, the change touches the GUI: capture the map detail page (with the 3D preview) via the Tauri MCP and include it in the PR description.

---

## Self-Review

**Spec coverage:** The goal — extract heightmap via unitsync and feed the existing 3D preview across the app — is covered: worker read (Task 1/3), CLI mode (Task 4), command + ACL (Tasks 5-7), frontend binding/hook (Tasks 8-9), component reuse (Task 10), and the new map-detail surface (Task 11). Verification closes it (Task 12).

**Type consistency:** `HeightmapOutput` (Rust, camelCase serde) ↔ `HeightmapResult` (TS) match field-for-field (`dataUrl`, `width`, `height`, `minHeight`, `maxHeight`, `errors`). `build_heightmap_args(lib, datadir, map, max_side: i32, cache_dir)` matches its only caller in Task 6. `heightmap_size`/`heightmap_data`/`height_bounds` defined in Task 1 are the exact names used in Task 3's `render`. `MapPreview3D`'s new `heightSrc`/`textureSrc` (Task 10) are exactly what `MapDetailPage` passes (Task 11).

**Placeholder scan:** No TBD/TODO/"handle errors"; every code step is complete and copy-pasteable.

**Open risk (flagged, not a blocker):** the `bm_grayscale_16 = 2` value and `GetInfoMap` returning nonzero-on-success are confirmed against `spring/spring develop`; if a specific Recoil/BAR engine build differs, Task 12 Step 4 surfaces it through the empty-section + error path rather than a crash.
```
