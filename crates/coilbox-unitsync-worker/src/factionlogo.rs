//! `--faction-logos` mode: resolve a per-side faction emblem for one game.
//!
//! Games ship faction art under a `Sidepics/<SideName>.<ext>` folder — an older
//! lobby convention (metal_factions, XTA, SplinterFaction all use it). unitsync
//! never surfaces it, so we read it ourselves: for each requested side name, find
//! `Sidepics/<side>.{png,bmp,tga,dds}` in the primary archive (case-insensitive),
//! decode it (via `crate::texture`, reused from the build-pic path), chroma-key
//! pure white to transparent for the BMP variant of the convention, and PNG-encode
//! a small `data:` URL. Each entry also reports the source image's longest pixel
//! side so the frontend can prefer a crisper curated image over a 16px upscale.
//!
//! Disk-cached per (game-identity, side) like the build-pic cache, so re-runs skip
//! the archive mount.

use crate::ffi::Unitsync;
use crate::model::{FactionLogoEntry, FactionLogosOutput};
use std::path::Path;

/// Salts the faction-logo cache key. Bump when the encoding, chroma-key rule, or
/// cache format changes so stale entries are ignored.
const CACHE_VERSION: u32 = 1;

/// Extensions probed for a side's emblem, in preference order (PNG first: it keeps
/// its own alpha; BMP is the white-keyed legacy case).
const SIDEPIC_EXTS: &[&str] = &["png", "tga", "dds", "bmp"];

/// Sidepics are tiny (16px), but bound the read anyway.
const READ_CAP: usize = 4 * 1024 * 1024;

/// Print a `FactionLogosOutput` carrying only an error (used on panic/setup fail).
pub fn emit_error(msg: String) {
    let out = FactionLogosOutput {
        logos: Vec::new(),
        errors: vec![msg],
    };
    println!("{}", serde_json::to_string(&out).unwrap_or_default());
}

/// A cached per-side record. An empty `data_uri` means "resolved to nothing" — a
/// hit that still skips the mount (mirrors the build-pic cache's empty records).
#[derive(serde::Serialize, serde::Deserialize, Default)]
struct CachedLogo {
    data_uri: String,
    max_dim: u32,
}

/// Resolve faction emblems for `sides` in `game_archive`. Cache hits/negatives skip
/// the unitsync session; otherwise mount the archive once and resolve the misses.
/// `cache_dir` `None` disables caching.
pub fn render(
    lib: &str,
    game_archive: &str,
    sides: &[String],
    cache_dir: Option<&Path>,
) -> FactionLogosOutput {
    let mut logos: Vec<FactionLogoEntry> = Vec::new();
    let mut errors = Vec::new();

    let us = match unsafe { Unitsync::load(Path::new(lib)) } {
        Ok(u) => u,
        Err(e) => {
            return FactionLogosOutput {
                errors: vec![e],
                ..Default::default()
            }
        }
    };
    us.init(false, 0);
    errors.extend(us.drain_errors());

    let key_base = cache_key_base(&us, game_archive);
    let cache = cache_dir.zip(key_base.as_ref());

    // Partition into cache hits (done) and misses (need the archive mounted).
    let mut misses: Vec<String> = Vec::new();
    for side in sides {
        if let Some((dir, base)) = cache {
            if let Some(cached) = read_cache(dir, base, side) {
                push_entry(&mut logos, side, cached);
                continue;
            }
        }
        misses.push(side.clone());
    }

    if misses.is_empty() {
        us.uninit();
        return FactionLogosOutput { logos, errors };
    }

    if !us.add_all_archives(game_archive) {
        errors.push("this engine's libunitsync can't load game archives".into());
        us.uninit();
        return FactionLogosOutput { logos, errors };
    }
    errors.extend(us.drain_errors());

    match crate::archive::resolve_open_path(&us, game_archive)
        .as_deref()
        .and_then(|p| us.open_archive(p))
    {
        Some(handle) => {
            let list: Vec<(String, String)> = us
                .list_archive_files(handle)
                .into_iter()
                .map(|(path, _)| (path.to_lowercase(), path))
                .collect();
            for side in &misses {
                let resolved = resolve_side(&us, handle, &list, side);
                let cached = resolved.unwrap_or_default();
                if let Some((dir, base)) = cache {
                    write_cache(dir, base, side, &cached);
                }
                push_entry(&mut logos, side, cached);
            }
            us.close_archive(handle);
        }
        None => errors.push(format!("could not open archive {game_archive}")),
    }

    errors.extend(us.drain_errors());
    us.remove_all_archives();
    us.uninit();

    FactionLogosOutput { logos, errors }
}

/// Find and encode `Sidepics/<side>.<ext>` for one side, or `None` if no candidate
/// resolves. The side name is used verbatim as the file stem (the `Sidepics/`
/// convention names files after the side, e.g. `Sidepics/Aven.bmp`).
fn resolve_side(
    us: &Unitsync,
    handle: i32,
    list: &[(String, String)],
    side: &str,
) -> Option<CachedLogo> {
    for ext in SIDEPIC_EXTS {
        let target = format!("sidepics/{}.{ext}", side.to_lowercase());
        let Some(actual) = find_member(list, &target) else {
            continue;
        };
        let (size, bytes) = us.read_archive_member(handle, &actual, READ_CAP)?;
        if size as usize > READ_CAP {
            continue;
        }
        let mut img = match crate::texture::decode_texture(ext, &bytes) {
            Some(i) => i,
            None => continue,
        };
        let max_dim = img.width().max(img.height());
        // The legacy BMP variant of the convention paints the emblem on an opaque
        // white field; key pure white out so it sits on the dark UI. PNG/TGA/DDS
        // carry their own alpha and are left untouched.
        if *ext == "bmp" {
            chroma_key_white(&mut img);
        }
        let data_uri = crate::texture::encode_icon_png(img)?;
        return Some(CachedLogo { data_uri, max_dim });
    }
    None
}

/// Set pure-white pixels fully transparent (the `Sidepics` BMP convention).
fn chroma_key_white(img: &mut image::RgbaImage) {
    for px in img.pixels_mut() {
        if px[0] == 255 && px[1] == 255 && px[2] == 255 {
            px[3] = 0;
        }
    }
}

/// Append a resolved record to the output, skipping empty ones (the UI then falls
/// through to its curated/bundled layers for that side).
fn push_entry(out: &mut Vec<FactionLogoEntry>, side: &str, cached: CachedLogo) {
    if cached.data_uri.is_empty() {
        return;
    }
    out.push(FactionLogoEntry {
        side: side.to_string(),
        data_uri: cached.data_uri,
        max_dim: cached.max_dim,
    });
}

/// Find an archive member whose path equals or ends with `/<target_lc>`
/// (case-insensitive; `list` holds `(lowercased, actual)` pairs). Returns the
/// actual stored path. Mirrors the build-pic resolver's member lookup.
fn find_member(list: &[(String, String)], target_lc: &str) -> Option<String> {
    let suffix = format!("/{target_lc}");
    list.iter()
        .find(|(lower, _)| lower == target_lc || lower.ends_with(&suffix))
        .map(|(_, real)| real.clone())
}

/// Cheap, stable per-game cache identity (path + size + mtime + version salt).
/// `None` disables caching. Mirrors `buildpic::cache_key_base`.
fn cache_key_base(us: &Unitsync, archive_name: &str) -> Option<String> {
    use std::hash::{Hash, Hasher};
    let dir = us.archive_path(archive_name)?;
    let path = Path::new(&dir).join(archive_name);
    let md = std::fs::metadata(&path).ok()?;
    let mtime = md
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let mut h = std::collections::hash_map::DefaultHasher::new();
    CACHE_VERSION.hash(&mut h);
    path.hash(&mut h);
    md.len().hash(&mut h);
    mtime.hash(&mut h);
    Some(format!("{:016x}", h.finish()))
}

/// Per-side cache file stem: `<gamekey>_<sanitized-side>`.
fn side_stem(base: &str, side: &str) -> String {
    let safe: String = side
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '_' })
        .collect();
    format!("{base}_{safe}")
}

/// Read a side's cached record. `Some` = resolved (may be empty = "nothing here",
/// still a hit); `None` = miss. Unparseable files are treated as misses.
fn read_cache(dir: &Path, base: &str, side: &str) -> Option<CachedLogo> {
    let path = dir.join(format!("{}.json", side_stem(base, side)));
    let raw = std::fs::read_to_string(path).ok()?;
    serde_json::from_str(&raw).ok()
}

/// Best-effort cache write. An empty record is still written so a re-run doesn't
/// re-mount the archive for a side we already know has no sidepic.
fn write_cache(dir: &Path, base: &str, side: &str, cached: &CachedLogo) {
    let _ = std::fs::create_dir_all(dir);
    let path = dir.join(format!("{}.json", side_stem(base, side)));
    if let Ok(json) = serde_json::to_string(cached) {
        let _ = std::fs::write(path, json);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// White pixels become transparent; non-white keep their alpha.
    #[test]
    fn chroma_key_clears_white_only() {
        let mut img = image::RgbaImage::from_pixel(2, 1, image::Rgba([255, 255, 255, 255]));
        img.put_pixel(1, 0, image::Rgba([10, 20, 30, 255]));
        chroma_key_white(&mut img);
        assert_eq!(img.get_pixel(0, 0)[3], 0, "white -> transparent");
        assert_eq!(img.get_pixel(1, 0)[3], 255, "colour kept");
    }

    /// Case-insensitive member match against the stored (lower, actual) list.
    #[test]
    fn find_member_is_case_insensitive() {
        let list = vec![("sidepics/aven.bmp".into(), "Sidepics/Aven.bmp".into())];
        assert_eq!(
            find_member(&list, "sidepics/aven.bmp").as_deref(),
            Some("Sidepics/Aven.bmp")
        );
        assert_eq!(find_member(&list, "sidepics/gear.bmp"), None);
    }
}
