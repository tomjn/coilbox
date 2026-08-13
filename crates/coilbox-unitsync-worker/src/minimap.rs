//! Minimap rendering: turn unitsync's RGB565 minimap buffers into PNGs. Used two
//! ways, a single map's larger preview (`render`) and a batch of small thumbnails
//! for the whole map list (`render_all`), each in one `Init`.
//!
//! Rendered PNGs are cached on disk (under `cache_dir`, keyed by a cheap file
//! identity of the map's archive + mip) via `coilbox-thumb-cache`, so a map's
//! minimap is encoded once and reused across launches. The expensive `GetMinimap`
//! plus RGB565 to PNG encode only runs on a cache miss.
//!
//! Output reports the cache file name rather than the bytes, because the frontend
//! fetches it over `coilbox://unitsyncthumb/` instead of paying for base64 on the
//! bridge. A `data:` URL is only the fallback for a render that never reached
//! disk.

use crate::ffi::Unitsync;
use crate::model::{MinimapOutput, StartPos, Thumbnail, ThumbnailsOutput};
use base64::Engine;
use image::{DynamicImage, ImageFormat, RgbImage};
use serde::{Deserialize, Serialize};
use std::io::Cursor;
use std::path::{Path, PathBuf};

/// A cheap, stable cache identity for a map's rendered images: the archive's file
/// identity where it resolves, otherwise the map's versioned name. Neither route
/// hashes an archive, so building keys for the whole map list is effectively free.
/// `None` disables caching for that map, and it simply re-renders.
///
/// Note: a `.sdd` directory map edited in place may keep both its dir mtime and
/// its name, so a stale image can persist until a rescan. That is an acceptable
/// trade for a cosmetic minimap that re-renders in about 80ms.
pub(crate) fn map_cache_key(us: &Unitsync, index: Option<i32>, map_name: &str) -> Option<String> {
    archive_identity(us, map_name).or_else(|| name_identity(us, index, map_name))
}

/// File identity of the map's own archive: path + size + mtime.
///
/// Only resolves when `GetArchivePath` recognises the name `GetMapArchiveName`
/// gave us, which is not the general case: a map's archives come back under their
/// versioned *human* names ("AcidicQuarry 5.17") while `GetArchivePath` looks up
/// *file* names ("acidicquarry_5.17.sd7"). Kept as the preferred route because
/// where it does resolve it catches an in-place edit that the name route cannot.
fn archive_identity(us: &Unitsync, map_name: &str) -> Option<String> {
    use std::hash::{Hash, Hasher};
    let archive = us.map_archives(map_name).into_iter().next()?;
    let dir = us.archive_path(&archive)?;
    let path = Path::new(&dir).join(&archive);
    let md = std::fs::metadata(&path).ok()?;
    let mtime = md
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let mut h = std::collections::hash_map::DefaultHasher::new();
    path.hash(&mut h);
    md.len().hash(&mut h);
    mtime.hash(&mut h);
    Some(format!("{:016x}", h.finish()))
}

/// The map's versioned name plus the map file inside its archive.
///
/// Needs no path and no hashing, so it costs nothing on a cold library. It works
/// because the versioned name carries the archive version: installing a new
/// release of a map yields a new name, so the key changes with it. `GetMapChecksum`
/// would be a stronger identity but hashes the whole archive, which on a 5.5 GB
/// library takes minutes.
fn name_identity(us: &Unitsync, index: Option<i32>, map_name: &str) -> Option<String> {
    use std::hash::{Hash, Hasher};
    let i = index.or_else(|| map_index(us, map_name))?;
    let file = us.map_file_name(i)?;
    let mut h = std::collections::hash_map::DefaultHasher::new();
    map_name.hash(&mut h);
    file.hash(&mut h);
    Some(format!("n{:016x}", h.finish()))
}

/// A map's index, for callers that only have its name. `GetMapFileName` is
/// index-only, and names come from the archive scanner's index that `Init` has
/// already built, so this costs no archive reads.
pub(crate) fn map_index(us: &Unitsync, map_name: &str) -> Option<i32> {
    (0..us.map_count()).find(|&i| us.map_name(i).as_deref() == Some(map_name))
}

/// The suffix every rendered picture in the thumb cache carries, and the whole
/// of what [`sweep_pictures`] is allowed to delete: minimaps `<key>-<mip>.png`,
/// heightmaps `<key>-h<side>.png` and metal maps `<key>-m<side>.png`.
///
/// The raw height grids in the same dir are bounded on their own much smaller
/// budget (issue #1535), and the `-dims.json` entries beside them are a few
/// bytes each and left alone.
pub(crate) const PICTURE_SUFFIX: &str = ".png";

/// How many bytes of rendered pictures the thumb cache holds, across every map
/// (issue #1550).
///
/// A whole library's pictures came to 72 MB in 200 files on the machine this was
/// measured on: a small thumbnail for every map, plus a 1024px minimap, a
/// heightmap and a metal map for each map whose page has been opened. So 512 MB
/// is seven of those, and what it bounds is years of switching engine and data
/// directory rather than any one library.
///
/// It has to be that generous because the consumer is nothing like the height
/// grids'. A grid is 3 to 33 MB and one map's, and one map is open at a time. A
/// picture is a few hundred kilobytes and fifty are on screen at once, so a
/// picture taken off a page in view is a blank box on it. Three things keep the
/// sweep off what is being looked at: every call keeps every file it is
/// answering with, a cache hit counts as a use so a list that was read back
/// moves as one, and a session that does lose a picture asks for it again
/// (issue #1551).
const PICTURE_BUDGET: u64 = 512 * 1024 * 1024;

/// Bound the rendered pictures in the thumb cache, keeping every file this call
/// is answering with. Called by each of the four renders that writes one.
pub(crate) fn sweep_pictures(cache_dir: Option<&Path>, keep: &[PathBuf]) {
    if let Some(dir) = cache_dir {
        coilbox_thumb_cache::sweep(dir, PICTURE_SUFFIX, PICTURE_BUDGET, keep);
    }
}

/// Cache file for a map's minimap: `<cache_dir>/<key>-<mip>.png`. `None` (no
/// cache dir, or no cache key) disables caching for that map.
fn cache_file(cache_dir: Option<&Path>, key: Option<&str>, mip: i32) -> Option<PathBuf> {
    let dir = cache_dir?;
    let key = key?;
    Some(dir.join(format!("{key}-{mip}.png")))
}

/// A map's proportions, cached beside its minimap PNG.
#[derive(Serialize, Deserialize)]
struct CachedDims {
    width: u32,
    height: u32,
}

/// Cache file for a map's proportions: `<cache_dir>/<key>-dims.json`. Unlike the
/// PNG this is mip-independent, because proportions don't vary with mip level.
fn dims_file(cache_dir: Option<&Path>, key: Option<&str>) -> Option<PathBuf> {
    let dir = cache_dir?;
    let key = key?;
    Some(dir.join(format!("{key}-dims.json")))
}

/// A map's proportions, from cache when `file` holds them and from `compute`
/// otherwise. `GetInfoMapSize` costs about 86ms per map, as much again as the
/// minimap render this sits beside, and `render_one`'s cache hit skips its own
/// work. Without this a warm thumbnail pass still pays for the whole library.
///
/// Caching is an optimization: an unwritable cache dir or an unparseable entry
/// just means `compute` runs.
fn cached_dims(
    file: Option<PathBuf>,
    compute: impl FnOnce() -> Option<(u32, u32)>,
) -> Option<(u32, u32)> {
    if let Some(raw) = file.as_deref().and_then(|f| std::fs::read(f).ok()) {
        if let Ok(d) = serde_json::from_slice::<CachedDims>(&raw) {
            return Some((d.width, d.height));
        }
    }
    let (width, height) = compute()?;
    if let Some(f) = file.as_deref() {
        if let Some(dir) = f.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        if let Ok(bytes) = serde_json::to_vec(&CachedDims { width, height }) {
            let _ = std::fs::write(f, bytes);
        }
    }
    Some((width, height))
}

/// Render `map_name`'s minimap at `mip` to a PNG data URL (standalone session).
pub fn render(lib: &str, map_name: &str, mip: i32, cache_dir: Option<&Path>) -> MinimapOutput {
    let us = match unsafe { Unitsync::load(Path::new(lib)) } {
        Ok(u) => u,
        Err(e) => {
            return MinimapOutput {
                errors: vec![e],
                ..Default::default()
            }
        }
    };
    us.init(false, 0);
    let _ = us.drain_errors();
    let file = cache_file(
        cache_dir,
        map_cache_key(&us, None, map_name).as_deref(),
        mip,
    );
    let result = render_one(&us, map_name, mip, file.clone());
    sweep_pictures(cache_dir, file.as_slice());

    // Start positions, environment (wind/tidal) and appearance (water/sky/sun) all
    // live in mapinfo.lua, so load the map's archives and parse them via unitsync's
    // Lua parser.
    let mut start_positions = Vec::new();
    let mut wind = None;
    let mut tidal = None;
    let mut app = crate::ffi::MapAppearance::default();
    if let Some(first_archive) = us.map_archives(map_name).into_iter().next() {
        us.add_all_archives(&first_archive);
        start_positions = us
            .start_positions()
            .into_iter()
            .map(|(x, z)| StartPos { x, z })
            .collect();
        (wind, tidal) = us.map_env();
        app = us.map_appearance();
    }

    let errors = us.drain_errors();
    us.uninit();
    let (min_wind, max_wind) = match wind {
        Some((mn, mx)) => (Some(mn), Some(mx)),
        None => (None, None),
    };

    let base = MinimapOutput {
        start_positions,
        min_wind,
        max_wind,
        tidal_strength: tidal,
        void_water: app.void_water,
        void_ground: app.void_ground,
        void_alpha_min: app.void_alpha_min,
        water_color: app.water_color,
        water_alpha: app.water_alpha,
        water_plane_color: app.water_plane_color,
        water_absorb: app.water_absorb,
        water_base_color: app.water_base_color,
        water_min_color: app.water_min_color,
        force_rendering: app.force_rendering,
        sky_color: app.sky_color,
        fog_color: app.fog_color,
        cloud_color: app.cloud_color,
        cloud_density: app.cloud_density,
        sun_dir: app.sun_dir,
        sun_color: app.sun_color,
        ground_ambient_color: app.ground_ambient_color,
        ground_diffuse_color: app.ground_diffuse_color,
        ground_specular_color: app.ground_specular_color,
        ground_shadow_density: app.ground_shadow_density,
        ..Default::default()
    };
    match result {
        Ok((image, side)) => MinimapOutput {
            file: image.file,
            data_url: image.data_url,
            side: Some(side),
            errors,
            ..base
        },
        Err(e) => MinimapOutput {
            errors: std::iter::once(e).chain(errors).collect(),
            ..base
        },
    }
}

/// Render a small thumbnail for every map in one `Init` session.
pub fn render_all(lib: &str, mip: i32, cache_dir: Option<&Path>) -> ThumbnailsOutput {
    let us = match unsafe { Unitsync::load(Path::new(lib)) } {
        Ok(u) => u,
        Err(e) => {
            return ThumbnailsOutput {
                errors: vec![e],
                ..Default::default()
            }
        }
    };
    us.init(false, 0);
    let mut errors = us.drain_errors();

    let mut thumbnails = Vec::new();
    // Every thumbnail this call answers with, which is the whole of a map list
    // and therefore the whole of what a page of it draws. None of them is a
    // candidate for the sweep below (issue #1550).
    let mut rendered = Vec::new();
    for i in 0..us.map_count() {
        let Some(name) = us.map_name(i) else {
            continue;
        };
        let key = map_cache_key(&us, Some(i), &name);
        let file = cache_file(cache_dir, key.as_deref(), mip);
        if let Some(f) = &file {
            rendered.push(f.clone());
        }
        match render_one(&us, &name, mip, file) {
            Ok((image, _)) => {
                let dims = cached_dims(dims_file(cache_dir, key.as_deref()), || {
                    us.map_dimensions(&name)
                });
                thumbnails.push(Thumbnail {
                    name,
                    file: image.file,
                    data_url: image.data_url,
                    width: dims.map(|(w, _)| w),
                    height: dims.map(|(_, h)| h),
                });
            }
            Err(e) => errors.push(format!("{name}: {e}")),
        }
    }
    errors.extend(us.drain_errors());
    us.uninit();
    sweep_pictures(cache_dir, &rendered);

    ThumbnailsOutput { thumbnails, errors }
}

/// Render one map's minimap to `(image, side)` using an already-initialised
/// session. The caller owns the `Init`/`UnInit` lifecycle. `cache_file`, when set,
/// serves a previously-encoded PNG and skips the render entirely.
fn render_one(
    us: &Unitsync,
    map_name: &str,
    mip: i32,
    cache_file: Option<PathBuf>,
) -> Result<(RenderedImage, u32), String> {
    let side = 1024u32 >> mip.clamp(0, 10) as u32;
    let (png, on_disk) = coilbox_thumb_cache::cached_at(cache_file, || {
        let pixels = us
            .minimap(map_name, mip)
            .ok_or_else(|| "no minimap available".to_string())?;
        if pixels.len() != (side * side) as usize {
            return Err(format!(
                "unexpected minimap size: got {} px, expected {}",
                pixels.len(),
                side * side
            ));
        }
        pixels_to_png(&pixels, side)
    })?;
    Ok((rendered_image(&png, on_disk), side))
}

/// Convert an RGB565 square buffer to PNG bytes.
fn pixels_to_png(pixels: &[u16], side: u32) -> Result<Vec<u8>, String> {
    let mut rgb = Vec::with_capacity(pixels.len() * 3);
    for &p in pixels {
        rgb.push((((p >> 11) & 0x1f) << 3) as u8);
        rgb.push((((p >> 5) & 0x3f) << 2) as u8);
        rgb.push(((p & 0x1f) << 3) as u8);
    }
    let img = RgbImage::from_raw(side, side, rgb).ok_or("failed to build minimap image")?;
    let mut png = Cursor::new(Vec::new());
    DynamicImage::ImageRgb8(img)
        .write_to(&mut png, ImageFormat::Png)
        .map_err(|e| format!("failed to encode minimap PNG: {e}"))?;
    Ok(png.into_inner())
}

/// Wrap PNG bytes in a base64 `data:` URL.
fn png_to_data_url(png: &[u8]) -> String {
    let b64 = base64::engine::general_purpose::STANDARD.encode(png);
    format!("data:image/png;base64,{b64}")
}

/// How a rendered PNG reaches the frontend: the cache file name the webview
/// fetches over `coilbox://unitsyncthumb/`, or the base64 fallback.
#[derive(Default)]
pub(crate) struct RenderedImage {
    pub file: Option<String>,
    pub data_url: Option<String>,
}

/// Describe a render by its cache file when the bytes are on disk, else inline
/// them. Only one of the two is ever set, so the normal case puts a short name on
/// the bridge instead of a megabyte of base64.
pub(crate) fn rendered_image(png: &[u8], on_disk: Option<PathBuf>) -> RenderedImage {
    match on_disk.as_deref().and_then(Path::file_name) {
        Some(name) => RenderedImage {
            file: Some(name.to_string_lossy().into_owned()),
            data_url: None,
        },
        None => RenderedImage {
            file: None,
            data_url: Some(png_to_data_url(png)),
        },
    }
}

/// Print a minimap error envelope to stdout (used on panic).
pub fn emit_error(msg: String) {
    let out = MinimapOutput {
        errors: vec![msg],
        ..Default::default()
    };
    println!("{}", serde_json::to_string(&out).unwrap_or_default());
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::Cell;

    fn temp_dir(tag: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("coilbox-minimap-test-{}-{tag}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        dir
    }

    #[test]
    fn cached_dims_computes_once_then_serves_the_cache() {
        let dir = temp_dir("dims-hit");
        let file = dims_file(Some(dir.as_path()), Some("abc"));
        let calls = Cell::new(0);
        let compute = || {
            calls.set(calls.get() + 1);
            Some((384, 256))
        };

        assert_eq!(cached_dims(file.clone(), compute), Some((384, 256)));
        assert_eq!(calls.get(), 1);

        // Second read must not run the expensive call again.
        assert_eq!(cached_dims(file, compute), Some((384, 256)));
        assert_eq!(calls.get(), 1);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn cached_dims_recomputes_when_there_is_no_cache_file() {
        let calls = Cell::new(0);
        let compute = || {
            calls.set(calls.get() + 1);
            Some((512, 512))
        };
        assert_eq!(cached_dims(None, compute), Some((512, 512)));
        assert_eq!(cached_dims(None, compute), Some((512, 512)));
        assert_eq!(calls.get(), 2);
    }

    #[test]
    fn cached_dims_recomputes_when_the_entry_is_unreadable() {
        let dir = temp_dir("dims-corrupt");
        let file = dims_file(Some(dir.as_path()), Some("abc")).expect("cache file");
        std::fs::create_dir_all(&dir).expect("create cache dir");
        std::fs::write(&file, b"not json").expect("write corrupt entry");

        let calls = Cell::new(0);
        let got = cached_dims(Some(file), || {
            calls.set(calls.get() + 1);
            Some((128, 64))
        });
        assert_eq!(got, Some((128, 64)));
        assert_eq!(calls.get(), 1);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_map_without_dimensions_is_not_cached() {
        let dir = temp_dir("dims-none");
        let file = dims_file(Some(dir.as_path()), Some("abc")).expect("cache file");
        assert_eq!(cached_dims(Some(file.clone()), || None), None);
        assert!(!file.exists(), "a failed read must not be cached");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn dims_and_png_cache_files_never_collide() {
        let dir = temp_dir("dims-collide");
        let png = cache_file(Some(dir.as_path()), Some("abc"), 3);
        let dims = dims_file(Some(dir.as_path()), Some("abc"));
        assert_ne!(png, dims);
    }

    /// The picture budget is a suffix, so a minimap that stopped being named
    /// one would quietly stop being bounded (issue #1550), and the proportions
    /// beside it must stay out of a budget measured in pictures.
    #[test]
    fn the_picture_sweep_covers_a_minimap_and_not_its_proportions() {
        let dir = temp_dir("sweep-scope");
        let png = cache_file(Some(dir.as_path()), Some("abc"), 3).expect("cache file");
        let dims = dims_file(Some(dir.as_path()), Some("abc")).expect("dims file");
        assert!(png.to_string_lossy().ends_with(PICTURE_SUFFIX));
        assert!(!dims.to_string_lossy().ends_with(PICTURE_SUFFIX));
    }
}
