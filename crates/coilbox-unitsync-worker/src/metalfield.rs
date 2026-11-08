//! The map's metal density as the engine holds it, for readers that need the
//! numbers and not a picture.
//!
//! `metalmap.rs` renders the same infomap as a green PNG for the minimap
//! overlay, which turns density into alpha and floors every non zero sample at
//! 140. A reader that wants to know how much metal sits under a spot cannot
//! get that back out of the picture.
//!
//! So the raw grid is written out as it comes off `GetInfoMap "metal"`: one
//! byte per sample, `width * height` of them, row major, with the dimensions
//! `GetInfoMapSize "metal"` gives. The bytes are exactly what
//! [`crate::ffi::Unitsync::metalmap_data`] returns.
//!
//! Cached on disk beside the PNGs and the height grids and served over the
//! asset protocol, like [`crate::heightfield`]. It has a budget of its own,
//! apart from both of theirs, and every call sweeps the least recently used of
//! these files out of the way, keeping the one it is answering with.
//!
//! The output also carries the map's `extractorRadius`, read off the engine's
//! map info. unitsync answers 0 both for a map that declares none and for one
//! that declares 0, and it truncates the value to a whole number, so a value of
//! 0 or less is reported as absent. The caller applies the engine's default
//! (500) then. It is deliberately not applied here.

use crate::ffi::Unitsync;
use crate::minimap::{map_cache_key, map_index};
use crate::model::MetalFieldOutput;
use std::path::{Path, PathBuf};

/// The suffix every one of these files carries, which is also the whole of what
/// the sweep below is allowed to delete.
const SUFFIX: &str = "-mf.bin";

/// How many bytes of raw metal grids the cache holds, across every map.
///
/// A metal grid is `mapx/2` by `mapy/2` bytes, an eighth of the same map's
/// height grid (see `heightfield::BUDGET`). 32 MiB is a guess and not a
/// measurement. Measuring it means summing the `-mf.bin` files in the thumb
/// cache of a machine that has opened a library of maps.
const BUDGET: u64 = 32 * 1024 * 1024;

/// Cache file for one map's raw metal grid: `<cache_dir>/<key>-mf.bin`. The `mf`
/// suffix keeps it clear of the minimap (`<key>-<mip>`), heightmap
/// (`<key>-h<max_side>`) and metalmap (`<key>-m<max_side>.png`) pictures, and of
/// the raw height grid (`<key>-hf.bin`).
fn cache_file(cache_dir: Option<&Path>, key: Option<&str>) -> Option<PathBuf> {
    Some(cache_dir?.join(format!("{}{SUFFIX}", key?)))
}

/// A declared extractor radius, or `None` when the map did not declare one.
/// Anything at or below 0 counts as not declared, because unitsync cannot tell
/// the two apart.
fn declared_radius(answer: Option<f32>) -> Option<f32> {
    answer.filter(|radius| *radius > 0.0)
}

/// Write `map_name`'s raw metal grid to the cache and report the file, with the
/// extractor radius the map declares (standalone unitsync session).
pub fn render(lib: &str, map_name: &str, cache_dir: Option<&Path>) -> MetalFieldOutput {
    let us = match unsafe { Unitsync::load(Path::new(lib)) } {
        Ok(u) => u,
        Err(e) => {
            return MetalFieldOutput {
                errors: vec![e],
                ..Default::default()
            }
        }
    };
    us.init(false, 0);
    let _ = us.drain_errors();

    let extractor_radius = declared_radius(
        map_index(&us, map_name).and_then(|index| us.map_number(index, "extractorRadius")),
    );
    let cache = cache_file(cache_dir, map_cache_key(&us, None, map_name).as_deref());

    let result = (|| -> Result<(String, u32, u32), String> {
        let (w, h) = us
            .map_dimensions(map_name)
            .ok_or_else(|| "no metal infomap available".to_string())?;
        let file = cache
            .ok_or_else(|| "no cache directory to write the map's metal grid to".to_string())?;
        let name = file
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .ok_or_else(|| "the metal grid cache file has no name".to_string())?;
        // Only a miss pays for the read. A hit is still a use, and the sweep
        // below reads recency off the file, so say so.
        // A file of the wrong length is a write that did not finish.
        if std::fs::metadata(&file).is_ok_and(|m| m.len() == u64::from(w) * u64::from(h)) {
            coilbox_thumb_cache::touch(&file);
        } else {
            let raw = us
                .metalmap_data(map_name, w, h)
                .ok_or_else(|| "failed to read metal infomap".to_string())?;
            if let Some(dir) = file.parent() {
                let _ = std::fs::create_dir_all(dir);
            }
            std::fs::write(&file, raw)
                .map_err(|e| format!("failed to write the map's metal grid: {e}"))?;
        }
        // Now that this map's grid is the most recently used one, drop whatever
        // no longer fits. This file is never a candidate: it is about to be
        // fetched.
        if let Some(dir) = file.parent() {
            coilbox_thumb_cache::sweep(dir, &[SUFFIX], BUDGET, std::slice::from_ref(&file));
        }
        Ok((name, w, h))
    })();

    let errors = us.drain_errors();
    us.uninit();

    match result {
        Ok((file, w, h)) => MetalFieldOutput {
            file: Some(file),
            width: Some(w),
            height: Some(h),
            extractor_radius,
            errors,
        },
        Err(e) => MetalFieldOutput {
            extractor_radius,
            errors: std::iter::once(e).chain(errors).collect(),
            ..Default::default()
        },
    }
}

/// Print a metal field error envelope to stdout (used on panic).
pub fn emit_error(msg: String) {
    let out = MetalFieldOutput {
        errors: vec![msg],
        ..Default::default()
    };
    println!("{}", serde_json::to_string(&out).unwrap_or_default());
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_the_cache_file_apart_from_the_pngs_and_the_height_grid() {
        let file = cache_file(Some(Path::new("/cache")), Some("abc"));
        assert_eq!(file, Some(PathBuf::from("/cache/abc-mf.bin")));
    }

    #[test]
    fn has_no_cache_file_without_a_directory_or_a_key() {
        assert_eq!(cache_file(None, Some("abc")), None);
        assert_eq!(cache_file(Some(Path::new("/cache")), None), None);
    }

    /// The picture sweep deletes by suffix, so a grid named like a picture would
    /// be swept on the pictures' budget instead of its own.
    #[test]
    fn the_picture_sweep_leaves_the_grid_alone() {
        let file = cache_file(Some(Path::new("/cache")), Some("abc")).expect("cache file");
        assert!(!crate::minimap::is_swept_picture(&file));
    }

    #[test]
    fn a_declared_radius_is_reported() {
        assert_eq!(declared_radius(Some(110.0)), Some(110.0));
    }

    /// unitsync answers 0 for both "not declared" and "declared 0", so neither
    /// is reported and the caller applies the engine's default.
    #[test]
    fn a_radius_of_zero_or_less_or_no_answer_is_not_reported() {
        assert_eq!(declared_radius(Some(0.0)), None);
        assert_eq!(declared_radius(Some(-1.0)), None);
        assert_eq!(declared_radius(None), None);
    }
}
