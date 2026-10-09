//! `--faction-logos` mode: resolve a per-side faction emblem for one game.
//!
//! Games ship faction art under a `Sidepics/<SideName>.<ext>` folder — an older
//! lobby convention (metal_factions, XTA, SplinterFaction all use it). unitsync
//! never surfaces it, so we read it ourselves: for each requested side name, find
//! `Sidepics/<side>.{png,bmp,tga,dds}` in the primary archive (case-insensitive),
//! decode it (via `crate::texture`, reused from the build-pic path), chroma-key
//! pure white to transparent for the BMP variant of the convention, and PNG-encode
//! a small icon. Each entry also reports the source image's longest pixel side so
//! the frontend can prefer a crisper curated image over a 16px upscale.
//!
//! Disk-cached per (game-identity, side) like the build-pic cache, so re-runs skip
//! the archive mount. The PNG is written beside its JSON record and named in it,
//! so what crosses the bridge is a file name the webview fetches over
//! `coilbox://unitsyncfactionlogo/` rather than base64.

use crate::ffi::Unitsync;
use crate::model::{FactionLogoEntry, FactionLogosOutput};
use coilbox_unitsync_worker::cached::{
    logo_file_name, logo_file_present, push_logo as push_entry, read_logo_record as read_cache,
    side_stem, CachedLogo,
};
use coilbox_unitsync_worker::cachekey;
use std::path::Path;

/// Extensions probed for a side's emblem, in preference order. PNG first, since
/// it keeps its own alpha. BMP and PCX are the white-keyed legacy cases.
const SIDEPIC_EXTS: &[&str] = &["png", "tga", "dds", "bmp", "pcx"];

/// The extensions whose emblem is painted on an opaque white field rather than
/// carrying alpha of its own, so it needs keying out. See [`chroma_key_white`].
const WHITE_FIELD_EXTS: &[&str] = &["bmp", "pcx"];

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

/// One side's emblem as it comes out of the archive, before it is put anywhere.
struct ResolvedLogo {
    png: Vec<u8>,
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
                if logo_file_present(&cached, dir) {
                    push_entry(&mut logos, side, cached);
                    continue;
                }
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
                let cached = store_logo(cache, side, resolve_side(&us, handle, &list, side));
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
) -> Option<ResolvedLogo> {
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
        // The legacy BMP and PCX variants of the convention paint the emblem on
        // an opaque white field, so key pure white out and it sits on the dark
        // UI. PNG/TGA/DDS carry their own alpha and are left untouched.
        if WHITE_FIELD_EXTS.contains(ext) {
            chroma_key_white(&mut img);
        }
        let png = crate::texture::encode_icon_png(img)?;
        return Some(ResolvedLogo { png, max_dim });
    }
    None
}

/// Put a side's emblem where the webview can fetch it: a PNG beside the side's
/// cache record, sharing its stem. Inlining is the fallback for the two cases
/// with no file to point at, no cache dir at all and a write that failed. A side
/// that resolved to nothing yields the empty record, which is still a cache hit.
fn store_logo(
    cache: Option<(&Path, &String)>,
    side: &str,
    resolved: Option<ResolvedLogo>,
) -> CachedLogo {
    let Some(ResolvedLogo { png, max_dim }) = resolved else {
        return CachedLogo::default();
    };
    if let Some((dir, base)) = cache {
        let name = logo_file_name(base, side);
        let _ = std::fs::create_dir_all(dir);
        if std::fs::write(dir.join(&name), &png).is_ok() {
            return CachedLogo {
                file: Some(name),
                data_uri: None,
                max_dim,
            };
        }
    }
    CachedLogo {
        file: None,
        data_uri: Some(crate::texture::png_data_url(&png)),
        max_dim,
    }
}

/// Set pure-white pixels fully transparent (the `Sidepics` BMP convention).
fn chroma_key_white(img: &mut image::RgbaImage) {
    for px in img.pixels_mut() {
        if px[0] == 255 && px[1] == 255 && px[2] == 255 {
            px[3] = 0;
        }
    }
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
    Some(cachekey::faction_logo_key(
        &crate::infocache::archive_stamp(us, archive_name)?,
    ))
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

    /// A PCX emblem is the same era as the BMP one and has no alpha of its own,
    /// so it needs the white field keying out too. The formats that carry alpha
    /// must not be touched.
    #[test]
    fn the_legacy_formats_are_the_keyed_ones() {
        assert!(WHITE_FIELD_EXTS.contains(&"pcx"));
        assert!(WHITE_FIELD_EXTS.contains(&"bmp"));
        for carries_alpha in ["png", "tga", "dds"] {
            assert!(!WHITE_FIELD_EXTS.contains(&carries_alpha));
            assert!(SIDEPIC_EXTS.contains(&carries_alpha));
        }
        // PNG is preferred over every legacy form, whichever a game ships.
        assert_eq!(SIDEPIC_EXTS[0], "png");
        assert!(SIDEPIC_EXTS.contains(&"pcx"));
    }

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

    fn temp_dir(tag: &str) -> std::path::PathBuf {
        let dir =
            std::env::temp_dir().join(format!("coilbox-factionlogo-{}-{tag}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        dir
    }

    fn emblem() -> ResolvedLogo {
        let img = image::RgbaImage::from_pixel(16, 16, image::Rgba([10, 20, 30, 255]));
        ResolvedLogo {
            png: crate::texture::encode_icon_png(img).unwrap(),
            max_dim: 16,
        }
    }

    /// The whole of #1694: a resolved side carries a file name, and the bytes
    /// are on disk under it rather than base64 in the record.
    #[test]
    fn an_emblem_is_written_as_a_file_and_named_rather_than_inlined() {
        let dir = temp_dir("write");
        let base = "0123456789abcdef".to_string();
        let png = emblem().png.clone();

        let cached = store_logo(Some((&dir, &base)), "Aven", Some(emblem()));
        assert_eq!(cached.data_uri, None);
        assert_eq!(cached.max_dim, 16);
        let name = cached.file.expect("the emblem is named");
        assert_eq!(name, "0123456789abcdef_Aven.png");
        assert_eq!(std::fs::read(dir.join(&name)).unwrap(), png);

        let _ = std::fs::remove_dir_all(&dir);
    }

    /// With no cache dir there is no file to point at, and a side with no
    /// sidepic at all still caches as the empty record that skips the mount.
    #[test]
    fn an_emblem_with_nowhere_to_go_falls_back_to_base64() {
        let inline = store_logo(None, "Aven", Some(emblem()));
        assert_eq!(inline.file, None);
        assert!(inline
            .data_uri
            .unwrap()
            .starts_with("data:image/png;base64,"));

        let nothing = store_logo(None, "Aven", None);
        assert!(nothing.file.is_none() && nothing.data_uri.is_none());
        let mut out = Vec::new();
        push_entry(&mut out, "Aven", nothing);
        assert!(out.is_empty(), "a side with no emblem is simply absent");
    }

    /// Issue #3714: the plugin answers from the records this module wrote, given
    /// only the game archive's path.
    #[test]
    fn the_plugin_names_the_emblems_the_worker_wrote_without_a_worker() {
        let dir = temp_dir("plugin-hit");
        let cache = dir.join("cache");
        let archive = dir.join("game.sdz");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(&archive, b"a game").unwrap();
        let base = cachekey::faction_logo_key(&cachekey::ArchiveStamp::of(&archive).unwrap());

        for (side, resolved) in [("Aven", Some(emblem())), ("Gear", None)] {
            let cached = store_logo(Some((&cache, &base)), side, resolved);
            write_cache(&cache, &base, side, &cached);
        }

        let sides = vec!["Aven".to_string(), "Gear".to_string()];
        let answered = coilbox_unitsync_worker::cached::faction_logos(&cache, &archive, &sides)
            .expect("a hit");
        assert_eq!(answered.logos.len(), 1, "a side with no emblem is absent");
        assert_eq!(answered.logos[0].side, "Aven");
        assert_eq!(
            answered.logos[0].file.as_deref(),
            Some(format!("{base}_Aven.png").as_str())
        );
        assert_eq!(answered.logos[0].max_dim, 16);

        // A side nobody has resolved, a cleaned picture and a changed archive all
        // go to a worker.
        let more = vec!["Aven".to_string(), "Other".to_string()];
        assert!(coilbox_unitsync_worker::cached::faction_logos(&cache, &archive, &more).is_none());
        std::fs::write(&archive, b"a longer game archive").unwrap();
        assert!(coilbox_unitsync_worker::cached::faction_logos(&cache, &archive, &sides).is_none());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn the_plugin_leaves_an_emblem_whose_file_was_cleaned_to_a_worker() {
        let dir = temp_dir("plugin-cleaned");
        let cache = dir.join("cache");
        let archive = dir.join("game.sdz");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(&archive, b"a game").unwrap();
        let base = cachekey::faction_logo_key(&cachekey::ArchiveStamp::of(&archive).unwrap());
        let cached = store_logo(Some((&cache, &base)), "Aven", Some(emblem()));
        write_cache(&cache, &base, "Aven", &cached);
        std::fs::remove_file(cache.join(cached.file.as_ref().unwrap())).unwrap();

        assert!(coilbox_unitsync_worker::cached::faction_logos(
            &cache,
            &archive,
            &["Aven".to_string()]
        )
        .is_none());
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// A cache clean takes the PNG and leaves the record, and answering from
    /// that record would draw a broken emblem.
    #[test]
    fn a_record_whose_emblem_file_is_gone_re_resolves() {
        let dir = temp_dir("gone");
        let base = "0123456789abcdef".to_string();
        let cached = store_logo(Some((&dir, &base)), "Aven", Some(emblem()));
        assert!(logo_file_present(&cached, &dir));
        std::fs::remove_file(dir.join(cached.file.as_ref().unwrap())).unwrap();
        assert!(!logo_file_present(&cached, &dir));
        // A record naming no file has nothing to miss.
        assert!(logo_file_present(&CachedLogo::default(), &dir));

        let _ = std::fs::remove_dir_all(&dir);
    }
}
