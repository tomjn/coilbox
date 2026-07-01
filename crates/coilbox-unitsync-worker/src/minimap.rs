//! Minimap rendering: turn unitsync's RGB565 minimap buffers into PNG `data:`
//! URLs. Used two ways — a single map's larger preview (`render`) and a batch of
//! small thumbnails for the whole map list (`render_all`), each in one `Init`.
//!
//! Rendered PNGs are cached on disk (under `cache_dir`, keyed by a cheap file
//! identity of the map's archive + mip) via `coilbox-thumb-cache`, so a map's
//! minimap is encoded once and reused across launches; the expensive
//! `GetMinimap` + RGB565→PNG encode only runs on a cache miss.

use crate::ffi::Unitsync;
use crate::model::{MinimapOutput, StartPos, Thumbnail, ThumbnailsOutput};
use base64::Engine;
use image::{DynamicImage, ImageFormat, RgbImage};
use std::io::Cursor;
use std::path::{Path, PathBuf};

/// A cheap, stable cache identity for a map's minimap: a hash of its own
/// archive's path + size + mtime. Unlike the sync checksum this needs no
/// whole-archive hashing, so building cache keys for the whole map list is
/// effectively free. `None` (map has no resolvable archive, or stat fails)
/// disables caching for that map — it simply re-renders.
///
/// Note: for a `.sdd` directory map edited in place the dir mtime may not change,
/// so a stale minimap can persist until a rescan — an acceptable trade for a
/// cosmetic minimap that re-renders in ~80ms.
pub(crate) fn map_cache_key(us: &Unitsync, map_name: &str) -> Option<String> {
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

/// Cache file for a map's minimap: `<cache_dir>/<key>-<mip>.png`. `None` (no
/// cache dir, or no cache key) disables caching for that map.
fn cache_file(cache_dir: Option<&Path>, key: Option<&str>, mip: i32) -> Option<PathBuf> {
    let dir = cache_dir?;
    let key = key?;
    Some(dir.join(format!("{key}-{mip}.png")))
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
    let result = render_one(
        &us,
        map_name,
        mip,
        cache_file(cache_dir, map_cache_key(&us, map_name).as_deref(), mip),
    );

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
        water_color: app.water_color,
        water_alpha: app.water_alpha,
        sky_color: app.sky_color,
        fog_color: app.fog_color,
        sun_dir: app.sun_dir,
        sun_color: app.sun_color,
        ..Default::default()
    };
    match result {
        Ok((data_url, side)) => MinimapOutput {
            data_url: Some(data_url),
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
    for i in 0..us.map_count() {
        let Some(name) = us.map_name(i) else {
            continue;
        };
        let file = cache_file(cache_dir, map_cache_key(&us, &name).as_deref(), mip);
        match render_one(&us, &name, mip, file) {
            Ok((data_url, _)) => {
                let dims = us.map_dimensions(&name);
                thumbnails.push(Thumbnail {
                    name,
                    data_url,
                    width: dims.map(|(w, _)| w),
                    height: dims.map(|(_, h)| h),
                });
            }
            Err(e) => errors.push(format!("{name}: {e}")),
        }
    }
    errors.extend(us.drain_errors());
    us.uninit();

    ThumbnailsOutput { thumbnails, errors }
}

/// Render one map's minimap to `(data_url, side)` using an already-initialised
/// session. The caller owns the `Init`/`UnInit` lifecycle. `cache_file`, when set,
/// serves a previously-encoded PNG and skips the render entirely.
fn render_one(
    us: &Unitsync,
    map_name: &str,
    mip: i32,
    cache_file: Option<PathBuf>,
) -> Result<(String, u32), String> {
    let side = 1024u32 >> mip.clamp(0, 10) as u32;
    let png = coilbox_thumb_cache::cached(cache_file, || {
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
    Ok((png_to_data_url(&png), side))
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
pub(crate) fn png_to_data_url(png: &[u8]) -> String {
    let b64 = base64::engine::general_purpose::STANDARD.encode(png);
    format!("data:image/png;base64,{b64}")
}

/// Print a minimap error envelope to stdout (used on panic).
pub fn emit_error(msg: String) {
    let out = MinimapOutput {
        errors: vec![msg],
        ..Default::default()
    };
    println!("{}", serde_json::to_string(&out).unwrap_or_default());
}
