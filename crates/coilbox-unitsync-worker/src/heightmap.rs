//! Heightmap rendering: read a map's full-resolution 16-bit height infomap via
//! unitsync (`GetInfoMap "height"`, pure static SMF parsing) and turn it into a
//! downscaled grayscale PNG `data:` URL for the 3D terrain preview. Cached on disk
//! (under `cache_dir`, keyed by a cheap file identity of the map's archive +
//! max-side) like minimaps, so the heavy read + encode only runs on a cache
//! miss.

use crate::ffi::Unitsync;
use crate::minimap::{map_cache_key, png_to_data_url};
use crate::model::HeightmapOutput;
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

/// Cache file for a heightmap PNG: `<cache_dir>/<key>-h<max_side>.png`. The `h`
/// prefix keeps it from colliding with the minimap cache (`<key>-<mip>`).
fn cache_file(cache_dir: Option<&Path>, key: Option<&str>, max_side: u32) -> Option<PathBuf> {
    let dir = cache_dir?;
    let key = key?;
    Some(dir.join(format!("{key}-h{max_side}.png")))
}

/// Render `map_name`'s heightmap to a grayscale PNG data URL plus its world-height
/// bounds (standalone unitsync session).
pub fn render(
    lib: &str,
    map_name: &str,
    max_side: u32,
    cache_dir: Option<&Path>,
) -> HeightmapOutput {
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
    let cache = cache_file(cache_dir, map_cache_key(&us, map_name).as_deref(), max_side);

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
