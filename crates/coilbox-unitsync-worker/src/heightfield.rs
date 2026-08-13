//! The map's heights as the engine holds them, for the terrain check (issue
//! #1490).
//!
//! `heightmap.rs` renders the same infomap as a PNG for the 3D preview, and a
//! PNG read back through a canvas comes out eight bits deep. That cost the
//! check a tolerance of one step of the map's whole range, 2.7 elmos on Bismuth
//! Valley against the 7 a solar collector allows, spent on the reading rather
//! than on the ground.
//!
//! So the raw grid is written out as it comes off `GetInfoMap "height"`:
//! `(mapx+1) * (mapy+1)` little endian 16 bit words, row major, north row
//! first. `height = minHeight + word * (maxHeight - minHeight) / 65536`, which
//! is `CSMFMapFile::ReadHeightmap`'s own arithmetic, so a reader that follows it
//! holds exactly the number the engine holds and needs no tolerance at all.
//!
//! Cached on disk beside the PNGs and served over the asset protocol, because a
//! 32 by 32 elmo map is 33 MB of words and base64 on the bridge is no way to
//! move that.

use crate::ffi::Unitsync;
use crate::minimap::map_cache_key;
use crate::model::HeightFieldOutput;
use std::path::{Path, PathBuf};

/// Cache file for one map's raw heights: `<cache_dir>/<key>-hf.bin`. The `hf`
/// suffix keeps it clear of the minimap (`<key>-<mip>`) and heightmap
/// (`<key>-h<max_side>`) caches, which are PNGs of the same map.
fn cache_file(cache_dir: Option<&Path>, key: Option<&str>) -> Option<PathBuf> {
    Some(cache_dir?.join(format!("{}-hf.bin", key?)))
}

/// The raw grid as little endian bytes, which is what a `Uint16Array` in the
/// webview reads without a conversion pass.
fn to_le_bytes(raw: &[u16]) -> Vec<u8> {
    let mut out = Vec::with_capacity(raw.len() * 2);
    for word in raw {
        out.extend_from_slice(&word.to_le_bytes());
    }
    out
}

/// Write `map_name`'s full resolution heights to the cache and report the file,
/// with the world height bounds the words span (standalone unitsync session).
pub fn render(lib: &str, map_name: &str, cache_dir: Option<&Path>) -> HeightFieldOutput {
    let us = match unsafe { Unitsync::load(Path::new(lib)) } {
        Ok(u) => u,
        Err(e) => {
            return HeightFieldOutput {
                errors: vec![e],
                ..Default::default()
            }
        }
    };
    us.init(false, 0);
    let _ = us.drain_errors();

    let bounds = us.height_bounds(map_name);
    let cache = cache_file(cache_dir, map_cache_key(&us, None, map_name).as_deref());

    let result = (|| -> Result<(String, u32, u32), String> {
        let (w, h) = us
            .heightmap_size(map_name)
            .ok_or_else(|| "no heightmap available".to_string())?;
        let file =
            cache.ok_or_else(|| "no cache directory to write the map's heights to".to_string())?;
        let name = file
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .ok_or_else(|| "the heights cache file has no name".to_string())?;
        // Only a miss pays for the read: on a hit the file is already the
        // answer, and it is measured in tens of megabytes, so it is not read
        // back only to be thrown away.
        if !file.is_file() {
            let raw = us
                .heightmap_data(map_name, w, h)
                .ok_or_else(|| "failed to read heightmap".to_string())?;
            if let Some(dir) = file.parent() {
                let _ = std::fs::create_dir_all(dir);
            }
            std::fs::write(&file, to_le_bytes(&raw))
                .map_err(|e| format!("failed to write the map's heights: {e}"))?;
        }
        Ok((name, w, h))
    })();

    let errors = us.drain_errors();
    us.uninit();

    match result {
        Ok((file, w, h)) => HeightFieldOutput {
            file: Some(file),
            width: Some(w),
            height: Some(h),
            min_height: bounds.map(|(lo, _)| lo),
            max_height: bounds.map(|(_, hi)| hi),
            errors,
        },
        Err(e) => HeightFieldOutput {
            min_height: bounds.map(|(lo, _)| lo),
            max_height: bounds.map(|(_, hi)| hi),
            errors: std::iter::once(e).chain(errors).collect(),
            ..Default::default()
        },
    }
}

/// Print a height field error envelope to stdout (used on panic).
pub fn emit_error(msg: String) {
    let out = HeightFieldOutput {
        errors: vec![msg],
        ..Default::default()
    };
    println!("{}", serde_json::to_string(&out).unwrap_or_default());
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn writes_words_little_endian() {
        // The order a `Uint16Array` reads on every platform coilbox ships on.
        assert_eq!(
            to_le_bytes(&[0, 1, 65535, 258]),
            vec![0, 0, 1, 0, 255, 255, 2, 1]
        );
    }

    #[test]
    fn names_the_cache_file_apart_from_the_pngs() {
        let file = cache_file(Some(Path::new("/cache")), Some("abc"));
        assert_eq!(file, Some(PathBuf::from("/cache/abc-hf.bin")));
    }

    #[test]
    fn has_no_cache_file_without_a_directory_or_a_key() {
        assert_eq!(cache_file(None, Some("abc")), None);
        assert_eq!(cache_file(Some(Path::new("/cache")), None), None);
    }
}
