//! Metal-map rendering: read a map's metal infomap via unitsync (`GetInfoMap
//! "metal"`, 8-bit density per pixel) and turn it into a downscaled green-on-
//! transparent RGBA PNG for overlaying on a minimap. Cached on disk (under
//! `cache_dir`, keyed by the map's archive identity + max-side) like heightmaps,
//! so the read + encode only runs on a cache miss, and reported by cache file
//! name so the overlay loads it over the asset protocol.

use crate::ffi::Unitsync;
use crate::minimap::{map_cache_key, rendered_image, sweep_pictures, RenderedImage};
use crate::model::MetalmapOutput;
use image::{DynamicImage, ImageBuffer, ImageFormat, Rgba};
use std::io::Cursor;
use std::path::{Path, PathBuf};

/// Build a green-on-transparent RGBA PNG from a raw 8-bit metal grid
/// (`raw.len() == w*h`), downscaled so its longest side is at most `max_side`
/// (aspect preserved). Metal density maps to alpha (so no-metal areas are fully
/// transparent and the minimap shows through), on a fixed green fill — the
/// convention peer lobbies use to mark extractable spots.
fn metalmap_png(raw: &[u8], w: u32, h: u32, max_side: u32) -> Result<Vec<u8>, String> {
    if raw.len() != (w as usize) * (h as usize) {
        return Err(format!(
            "metalmap size mismatch: got {} px, expected {}",
            raw.len(),
            w * h
        ));
    }
    // Expand density -> RGBA (bright green, alpha = density). A generous floor on
    // non-zero density keeps even faint spots clearly readable — the overlay is
    // meant to stand out against the (dimmed) minimap underneath it.
    let mut rgba = Vec::with_capacity(raw.len() * 4);
    for &v in raw {
        let alpha = if v == 0 { 0 } else { v.max(140) };
        rgba.extend_from_slice(&[40, 255, 90, alpha]);
    }
    let img =
        ImageBuffer::<Rgba<u8>, _>::from_raw(w, h, rgba).ok_or("failed to build metalmap image")?;
    let dyn_img = DynamicImage::ImageRgba8(img);
    let scaled = if w > max_side || h > max_side {
        dyn_img.thumbnail(max_side, max_side)
    } else {
        dyn_img
    };
    let mut png = Cursor::new(Vec::new());
    scaled
        .write_to(&mut png, ImageFormat::Png)
        .map_err(|e| format!("failed to encode metalmap PNG: {e}"))?;
    Ok(png.into_inner())
}

/// Cache file for a metalmap PNG: `<cache_dir>/<key>-m<max_side>.png`. The `m`
/// prefix keeps it from colliding with the minimap (`<key>-<mip>`) and heightmap
/// (`<key>-h<max_side>`) caches.
fn cache_file(cache_dir: Option<&Path>, key: Option<&str>, max_side: u32) -> Option<PathBuf> {
    let dir = cache_dir?;
    let key = key?;
    Some(dir.join(format!("{key}-m{max_side}.png")))
}

/// Render `map_name`'s metal infomap to a green-on-transparent RGBA PNG data URL
/// (standalone unitsync session).
pub fn render(
    lib: &str,
    map_name: &str,
    max_side: u32,
    cache_dir: Option<&Path>,
) -> MetalmapOutput {
    let us = match unsafe { Unitsync::load(Path::new(lib)) } {
        Ok(u) => u,
        Err(e) => {
            return MetalmapOutput {
                errors: vec![e],
                ..Default::default()
            }
        }
    };
    us.init(false, 0);
    let _ = us.drain_errors();

    let cache = cache_file(
        cache_dir,
        map_cache_key(&us, None, map_name).as_deref(),
        max_side,
    );

    let result = (|| -> Result<(RenderedImage, u32, u32), String> {
        let (w, h) = us
            .map_dimensions(map_name)
            .ok_or_else(|| "no metal infomap available".to_string())?;
        // Only the cache miss pays for the full GetInfoMap read + encode.
        let (png, on_disk) = coilbox_thumb_cache::cached_at(cache.clone(), || {
            let raw = us
                .metalmap_data(map_name, w, h)
                .ok_or_else(|| "failed to read metal infomap".to_string())?;
            metalmap_png(&raw, w, h, max_side)
        })?;
        Ok((rendered_image(&png, on_disk), w, h))
    })();
    sweep_pictures(cache_dir, cache.as_slice());

    let errors = us.drain_errors();
    us.uninit();

    match result {
        Ok((image, w, h)) => MetalmapOutput {
            file: image.file,
            data_url: image.data_url,
            width: Some(w),
            height: Some(h),
            errors,
        },
        Err(e) => MetalmapOutput {
            errors: std::iter::once(e).chain(errors).collect(),
            ..Default::default()
        },
    }
}

/// Print a metalmap error envelope to stdout (used on panic).
pub fn emit_error(msg: String) {
    let out = MetalmapOutput {
        errors: vec![msg],
        ..Default::default()
    };
    println!("{}", serde_json::to_string(&out).unwrap_or_default());
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn metalmap_png_downscales_and_preserves_aspect() {
        // 4x2 grid, max longest side 2 -> thumbnail to 2x1, decodable RGBA PNG.
        let raw: Vec<u8> = vec![0, 80, 160, 255, 0, 80, 160, 255];
        let png = metalmap_png(&raw, 4, 2, 2).expect("encode");
        let decoded = image::load_from_memory(&png).expect("decode");
        assert_eq!(decoded.width(), 2);
        assert_eq!(decoded.height(), 1);
    }

    #[test]
    fn metalmap_png_zero_density_is_transparent() {
        let raw: Vec<u8> = vec![0, 0, 0, 0];
        let png = metalmap_png(&raw, 2, 2, 8).expect("encode");
        let decoded = image::load_from_memory(&png).expect("decode").to_rgba8();
        assert!(decoded.pixels().all(|p| p.0[3] == 0));
    }

    #[test]
    fn metalmap_png_rejects_size_mismatch() {
        let raw: Vec<u8> = vec![0, 1, 2];
        assert!(metalmap_png(&raw, 4, 2, 2).is_err());
    }

    /// The picture budget is a suffix, so a metal map named anything else would
    /// quietly stop being bounded (issue #1550).
    #[test]
    fn the_picture_sweep_covers_what_this_writes() {
        let file = cache_file(Some(Path::new("/cache")), Some("abc"), 512).expect("cache file");
        assert!(file
            .to_string_lossy()
            .ends_with(crate::minimap::PICTURE_SUFFIX));
    }
}
