//! Heightmap rendering: read a map's full-resolution 16-bit height infomap via
//! unitsync (`GetInfoMap "height"`, pure static SMF parsing) and turn it into a
//! picture of the terrain. Cached on disk (under `cache_dir`, keyed by a cheap
//! file identity of the map's archive) like minimaps, so the heavy read + encode
//! only runs on a cache miss, and reported by cache file name so the preview
//! loads it over the asset protocol.
//!
//! The picture is 8 bit grey WebP, rescaled into the window the map's own
//! samples occupy, and capped at the vocabulary's 512px edge (issue #1730). Both
//! halves of that are the same fact: nothing that draws terrain ever read more
//! than eight bits, because a browser flattens a 16 bit image to its high byte
//! on the way in, and nothing can draw past 512 samples a side because the
//! preview mesh has 513 vertices. A reader that needs the exact heights, rather
//! than a picture of them, asks [`crate::heightfield`] for the map's own words.
//!
//! With `--asset-dir` the same encode is also stored as the hub's
//! `overlay:height` asset. One `GetInfoMap` call and one encode serve both: a
//! height read costs a map archive open and the largest maps are 2049 by 2049
//! samples, so asking twice would double the most expensive read the worker
//! makes.
//!
//! Only [`crate::seed`] ever passes `--asset-dir` here. The `unitsync_heightmap`
//! command does not, and this overlay has no client upload path (#1685). The
//! minimap gained one at #2379 and the three overlays deliberately did not: what
//! a map is missing on the hub is a picture of itself, and these are the
//! expensive part of the corpus.

use crate::assetencode::{encode_height_picture, HeightWindow};
use crate::ffi::Unitsync;
use crate::minimap::{map_cache_key, rendered_image, sweep_pictures, RenderedImage, WEBP_MIME};
use crate::model::{HeightmapOutput, MapOverlayAsset, MapOverlaySkip};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

/// The samples as the bytes the map file holds: little endian `u16`, row major.
///
/// This is what `source_hash` is over, framed by the variant and the grid by
/// [`crate::assetencode::map_source_hash`]. unitsync's `GetInfoMap "height"`
/// reads the SMF's height map block straight into the caller's buffer and swaps
/// it into host order (`CSMFMapFile::ReadHeightmap`, and `swabWordInPlace` is a
/// no-op on a little endian host), so writing the samples back out little endian
/// gives the archive's own bytes on every architecture coilbox builds for. The
/// hash moves when the map moves, and not when `image`, the display colouring or
/// the host's endianness changes, which is what the have check at #1632 compares
/// on.
///
/// The frame is what keeps two maps apart, rather than the sample width and the
/// grid shape happening to differ. A flat height map is a run of one value like a
/// flat type map is, and two of those on transposed grids held the same bytes
/// until issue #1660.
fn source_bytes(samples: &[u16]) -> Vec<u8> {
    let mut out = Vec::with_capacity(samples.len() * 2);
    for sample in samples {
        out.extend_from_slice(&sample.to_le_bytes());
    }
    out
}

/// Encode a map's height samples as the hub's `overlay:height` asset and write
/// it into `asset_dir`, named after the hash of its own bytes like the hub's
/// object path.
///
/// No bounds, no asset. The picture is a 0..255 scale across the window the
/// encoder reports, and the map's two world heights are what turn that back into
/// elmos, so a picture stored without them is terrain nobody can measure.
///
/// `source_hash` stays over the map's full resolution samples rather than over
/// what the picture kept. The have check at #1632 compares on it, so it has to
/// move when the map moves and stay put when the encoder does, which a hash of a
/// downscaled grid would not.
fn encode_asset(
    asset_dir: &Path,
    samples: &[u16],
    w: u32,
    h: u32,
    bounds: Option<(f32, f32)>,
    source_archive: &str,
) -> Result<MapOverlayAsset, MapOverlaySkip> {
    use crate::assetencode::{
        ext_for_mime, map_source_hash, sha256_hex, EncodeError, EXTRACTED_ORIGIN,
        HEIGHT_OVERLAY_VARIANT,
    };

    let (map_min, map_max) = bounds.ok_or(MapOverlaySkip::NoBounds)?;
    let (encoded, window) = encode_height_picture(samples, w, h).map_err(|e| match e {
        EncodeError::TooLarge { .. } => MapOverlaySkip::TooLarge,
        _ => MapOverlaySkip::EncodeFailed,
    })?;
    let (min_height, max_height) = window.elmos(map_min, map_max);

    let hash = sha256_hex(&encoded.bytes);
    let path = asset_dir.join(format!("{hash}.{}", ext_for_mime(&encoded.mime)));
    std::fs::create_dir_all(asset_dir).map_err(|_| MapOverlaySkip::NotWritten)?;
    // Same content, same name, so a file already there is already this asset.
    if !path.exists() {
        std::fs::write(&path, &encoded.bytes).map_err(|_| MapOverlaySkip::NotWritten)?;
    }

    Ok(MapOverlayAsset {
        variant: HEIGHT_OVERLAY_VARIANT.to_string(),
        origin: EXTRACTED_ORIGIN.to_string(),
        source_archive: source_archive.to_string(),
        path: path.to_string_lossy().into_owned(),
        hash,
        source_hash: map_source_hash(HEIGHT_OVERLAY_VARIANT, w, h, &source_bytes(samples)),
        encode_profile: encoded.encode_profile,
        mime: encoded.mime,
        width: encoded.width,
        height: encoded.height,
        bytes: encoded.bytes.len() as u64,
        min_height: Some(min_height),
        max_height: Some(max_height),
    })
}

/// The hub's `overlay:height` asset from samples already read. Exactly one of
/// the two is set, which is what every asset-producing mode promises.
fn asset_from_samples(
    asset_dir: &Path,
    dims: Option<(u32, u32)>,
    raw: Option<&[u16]>,
    bounds: Option<(f32, f32)>,
    source_archive: &str,
) -> (Option<MapOverlayAsset>, Option<MapOverlaySkip>) {
    let stored = match (dims, raw) {
        (None, _) => Err(MapOverlaySkip::NoSource),
        (Some(_), None) => Err(MapOverlaySkip::ReadFailed),
        (Some((w, h)), Some(raw)) => encode_asset(asset_dir, raw, w, h, bounds, source_archive),
    };
    match stored {
        Ok(a) => (Some(a), None),
        Err(why) => (None, Some(why)),
    }
}

/// The hub's `overlay:height` asset for one map, in a session the caller has
/// already initialised. The seed walk's entry point (issue #1638).
pub(crate) fn asset_in_session(
    us: &Unitsync,
    map_name: &str,
    asset_dir: &Path,
) -> (Option<MapOverlayAsset>, Option<MapOverlaySkip>) {
    let dims = us.heightmap_size(map_name);
    let raw = dims.and_then(|(w, h)| us.heightmap_data(map_name, w, h));
    asset_from_samples(
        asset_dir,
        dims,
        raw.as_deref(),
        us.height_bounds(map_name),
        &crate::archive::archive_name_for_map(us, map_name),
    )
}

/// The longest edge a height picture may have, which the shared vocabulary
/// decides rather than the caller. It is in the cache file's name so a change to
/// it retires every picture already on disk instead of serving a mixture.
fn picture_edge() -> u32 {
    coilbox_assets::class_for_variant(crate::assetencode::HEIGHT_OVERLAY_VARIANT)
        .and_then(|class| class.max_edge_px)
        .unwrap_or(0)
}

/// Cache file for a height picture: `<cache_dir>/<key>-h<edge>.webp`. The `h`
/// keeps it from colliding with the minimap cache (`<key>-<mip>`).
fn cache_file(cache_dir: Option<&Path>, key: Option<&str>) -> Option<PathBuf> {
    let dir = cache_dir?;
    let key = key?;
    Some(dir.join(format!("{key}-h{}.webp", picture_edge())))
}

/// Cache file for the window that picture is drawn in:
/// `<cache_dir>/<key>-h<edge>.win.json`, beside it the way the minimap's
/// proportions sit beside the minimap.
///
/// A separate file rather than a field in the picture because the picture is
/// handed to the webview as an image over the asset protocol, so anything it
/// carries has to be pixels.
fn window_file(cache_dir: Option<&Path>, key: Option<&str>) -> Option<PathBuf> {
    let dir = cache_dir?;
    let key = key?;
    Some(dir.join(format!("{key}-h{}.win.json", picture_edge())))
}

/// The window a cached picture is drawn in, stored beside it.
#[derive(Serialize, Deserialize)]
struct CachedWindow {
    low: u16,
    high: u16,
}

/// A height picture and the window it is drawn in, from cache when both are
/// there and from `compute` otherwise.
///
/// Both or neither, on purpose. The bytes are a shape and the window is what
/// makes them terrain, so a picture whose window went missing is one nothing can
/// read back, and it is encoded again rather than served as a height it is not.
fn cached_picture(
    picture_at: Option<PathBuf>,
    window_at: Option<PathBuf>,
    compute: impl FnOnce() -> Result<(Vec<u8>, HeightWindow), String>,
) -> Result<(Vec<u8>, Option<PathBuf>, HeightWindow), String> {
    let cached = picture_at.as_deref().zip(window_at.as_deref()).and_then(
        |(picture, window)| -> Option<(Vec<u8>, HeightWindow)> {
            let bytes = std::fs::read(picture).ok()?;
            let held: CachedWindow = serde_json::from_slice(&std::fs::read(window).ok()?).ok()?;
            Some((
                bytes,
                HeightWindow {
                    low: held.low,
                    high: held.high,
                },
            ))
        },
    );
    if let (Some((bytes, window)), Some(picture)) = (cached, picture_at.as_deref()) {
        // Serving an entry is using it, and the sweep reads recency off the file.
        coilbox_thumb_cache::touch(picture);
        return Ok((bytes, Some(picture.to_path_buf()), window));
    }

    let (bytes, window) = compute()?;
    let mut on_disk = None;
    if let Some(picture) = picture_at.as_deref() {
        if let Some(dir) = picture.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        if std::fs::write(picture, &bytes).is_ok() {
            on_disk = Some(picture.to_path_buf());
        }
    }
    if let Some(window_file) = window_at.as_deref() {
        let held = CachedWindow {
            low: window.low,
            high: window.high,
        };
        if let Ok(json) = serde_json::to_vec(&held) {
            let _ = std::fs::write(window_file, json);
        }
    }
    Ok((bytes, on_disk, window))
}

/// Render `map_name`'s heightmap to a grey WebP plus the world heights that turn
/// it back into terrain (standalone unitsync session).
///
/// `asset_dir` `Some` additionally stores the same picture as the hub's
/// `overlay:height` asset. Off by default: encoding a whole map library for
/// nobody is real work with no reader.
pub fn render(
    lib: &str,
    map_name: &str,
    cache_dir: Option<&Path>,
    asset_dir: Option<&Path>,
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
    let key = map_cache_key(&us, None, map_name);
    let cache = cache_file(cache_dir, key.as_deref());
    let window_cache = window_file(cache_dir, key.as_deref());

    let dims = us.heightmap_size(map_name);
    // The sample read, done once and shared. Only an asset run needs it up front:
    // the display path reads it inside the cache miss below, so a map whose
    // picture is already cached still costs nothing when nobody wants an asset.
    let raw = match (asset_dir, dims) {
        (Some(_), Some((w, h))) => us.heightmap_data(map_name, w, h),
        _ => None,
    };

    let (asset, asset_skipped) = match asset_dir {
        None => (None, None),
        Some(dir) => asset_from_samples(
            dir,
            dims,
            raw.as_deref(),
            bounds,
            &crate::archive::archive_name_for_map(&us, map_name),
        ),
    };

    let result = (|| -> Result<(RenderedImage, u32, u32, HeightWindow), String> {
        let (w, h) = dims.ok_or_else(|| "no heightmap available".to_string())?;
        // Only the cache miss pays for the full GetInfoMap read + encode.
        let (bytes, on_disk, window) = cached_picture(cache.clone(), window_cache, || {
            let read;
            let samples = match raw.as_deref() {
                Some(raw) => raw,
                None => {
                    read = us
                        .heightmap_data(map_name, w, h)
                        .ok_or_else(|| "failed to read heightmap".to_string())?;
                    &read
                }
            };
            encode_height_picture(samples, w, h)
                .map(|(encoded, window)| (encoded.bytes, window))
                .map_err(|e| e.to_string())
        })?;
        Ok((rendered_image(&bytes, WEBP_MIME, on_disk), w, h, window))
    })();
    sweep_pictures(cache_dir, cache.as_slice());

    let errors = us.drain_errors();
    us.uninit();

    match result {
        Ok((image, w, h, window)) => {
            let picture = bounds.map(|(lo, hi)| window.elmos(lo, hi));
            HeightmapOutput {
                file: image.file,
                data_url: image.data_url,
                width: Some(w),
                height: Some(h),
                min_height: bounds.map(|(lo, _)| lo),
                max_height: bounds.map(|(_, hi)| hi),
                picture_min_height: picture.map(|(lo, _)| lo),
                picture_max_height: picture.map(|(_, hi)| hi),
                asset,
                asset_skipped,
                errors,
            }
        }
        Err(e) => HeightmapOutput {
            min_height: bounds.map(|(lo, _)| lo),
            max_height: bounds.map(|(_, hi)| hi),
            asset,
            asset_skipped,
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
    use crate::assetencode::{map_source_hash, sha256_hex, HEIGHT_OVERLAY_VARIANT};

    /// A map archive's own versioned name, which is what `asset_in_session`
    /// resolves and hands the encoder.
    const ARCHIVE: &str = "Mediterraneum V1";

    /// Heights with the shape real terrain has: a slope whose neighbouring
    /// vertices differ by less than 256, so any 8 bit storage would flatten it
    /// into steps.
    fn heights(w: u32, h: u32) -> Vec<u16> {
        (0..w * h)
            .map(|i| {
                let (x, y) = (i % w, i / w);
                ((x * 400) as u16).wrapping_add((y * 37) as u16)
            })
            .collect()
    }

    fn asset_dir(tag: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("coilbox-height-asset-{}-{tag}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        dir
    }

    #[test]
    fn writes_the_asset_as_a_file_named_after_its_own_bytes() {
        let dir = asset_dir("write");
        let asset = encode_asset(&dir, &heights(32, 32), 32, 32, Some((0.0, 100.0)), ARCHIVE)
            .expect("code");
        let on_disk = std::fs::read(&asset.path).expect("asset file written");

        assert_eq!(
            asset.path,
            dir.join(format!("{}.webp", asset.hash)).to_string_lossy()
        );
        assert_eq!(asset.hash, sha256_hex(&on_disk));
        assert_eq!(asset.bytes, on_disk.len() as u64);
        assert_eq!(asset.mime, "image/webp");
        assert_eq!(asset.encode_profile, "webp-lossless-512");
        assert_eq!(asset.variant, "overlay:height");
        assert_eq!((asset.width, asset.height), (32, 32));
    }

    /// The bounds are the difference between a grid of numbers and terrain, and
    /// they are the picture's own rather than the map's (issue #1730). These
    /// samples reach nowhere near 65535, so a reader handed the map's own
    /// ceiling would stretch the picture over relief the map does not have.
    #[test]
    fn carries_the_bounds_the_picture_is_drawn_between() {
        let dir = asset_dir("bounds");
        let samples = heights(64, 64);
        let asset =
            encode_asset(&dir, &samples, 64, 64, Some((-73.5, 412.0)), ARCHIVE).expect("ok");

        let step = (412.0f32 - -73.5) / 65536.0;
        let want = |word: u16| -73.5 + f32::from(word) * step;
        assert_eq!(
            (asset.min_height, asset.max_height),
            (
                Some(want(*samples.iter().min().unwrap())),
                Some(want(*samples.iter().max().unwrap()))
            )
        );
        assert!(asset.max_height < Some(412.0), "took the map's own ceiling");
    }

    #[test]
    fn stores_nothing_when_the_bounds_did_not_read() {
        let dir = asset_dir("nobounds");
        assert_eq!(
            encode_asset(&dir, &heights(16, 16), 16, 16, None, ARCHIVE).unwrap_err(),
            MapOverlaySkip::NoBounds
        );
        assert!(!dir.exists(), "wrote an asset nothing can convert to elmos");
    }

    /// The have check compares on `source_hash`, so it has to be the samples and
    /// not the encode. Hashing the picture there would report every map as
    /// changed the first time the encoder moved.
    #[test]
    fn identity_is_the_samples_and_the_path_is_the_encoded_bytes() {
        let dir = asset_dir("hashes");
        let samples = heights(32, 32);
        let asset =
            encode_asset(&dir, &samples, 32, 32, Some((0.0, 1.0)), ARCHIVE).expect("encode");
        assert_eq!(
            asset.source_hash,
            map_source_hash(HEIGHT_OVERLAY_VARIANT, 32, 32, &source_bytes(&samples))
        );
        assert_ne!(asset.source_hash, asset.hash);
    }

    /// A flat height map is a run of one value like a flat type map is, so two
    /// of them on transposed grids collided before #1660 framed the grid in.
    #[test]
    fn a_flat_layer_on_a_transposed_grid_is_a_different_identity() {
        let dir = asset_dir("transposed");
        let flat = vec![0u16; 33 * 65];
        let tall =
            encode_asset(&dir, &flat, 33, 65, Some((0.0, 1.0)), ARCHIVE).expect("encode tall");
        let wide =
            encode_asset(&dir, &flat, 65, 33, Some((0.0, 1.0)), ARCHIVE).expect("encode wide");
        assert_ne!(tall.source_hash, wide.source_hash);
    }

    /// The bounds scale the samples into elmos and are not the samples, so two
    /// maps whose grids agree and whose world heights differ are one picture and
    /// one identity. They are also the only thing on this path that is not the
    /// map's own bytes, so if anything were going to leak into the identity it
    /// would be these.
    #[test]
    fn the_bounds_are_not_part_of_the_identity() {
        let dir = asset_dir("bounds-identity");
        let samples = heights(64, 64);
        let shallow =
            encode_asset(&dir, &samples, 64, 64, Some((0.0, 100.0)), ARCHIVE).expect("encode");
        let deep =
            encode_asset(&dir, &samples, 64, 64, Some((-500.0, 900.0)), ARCHIVE).expect("encode");
        assert_eq!(shallow.source_hash, deep.source_hash);
        assert_ne!(shallow.min_height, deep.min_height);
    }

    /// `source_hash` is over the map file's own bytes, so the serialisation has
    /// to be the SMF's little endian words rather than whatever this host's
    /// `u16` layout happens to be.
    #[test]
    fn hashes_the_samples_in_the_byte_order_the_map_file_stores_them() {
        assert_eq!(
            source_bytes(&[0x0000, 0x1234, 0xffff]),
            vec![0x00, 0x00, 0x34, 0x12, 0xff, 0xff]
        );
    }

    /// The picture budget is a set of suffixes, so a heightmap named anything
    /// else would quietly stop being bounded (issue #1550), and the window
    /// beside it is a few bytes that must stay out of a budget measured in
    /// pictures.
    #[test]
    fn the_picture_sweep_covers_the_picture_and_not_its_window() {
        let dir = Some(Path::new("/cache"));
        let picture = cache_file(dir, Some("abc")).expect("cache file");
        let window = window_file(dir, Some("abc")).expect("window file");
        assert!(crate::minimap::is_swept_picture(&picture));
        assert!(!crate::minimap::is_swept_picture(&window));
    }

    /// The cap is in the name, so raising or lowering the vocabulary's edge
    /// retires every picture already on disk rather than serving a mixture of
    /// two sizes under one key.
    #[test]
    fn names_the_cached_picture_after_the_edge_it_was_capped_at() {
        let file = cache_file(Some(Path::new("/cache")), Some("abc")).expect("cache file");
        assert_eq!(file, PathBuf::from(format!("/cache/abc-h{}.webp", 512)));
        assert_eq!(picture_edge(), 512);
    }

    #[test]
    fn has_no_cache_file_without_a_directory_or_a_key() {
        assert_eq!(cache_file(None, Some("abc")), None);
        assert_eq!(cache_file(Some(Path::new("/cache")), None), None);
    }

    fn cache_dir(tag: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("coilbox-height-pic-{}-{tag}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("cache dir");
        dir
    }

    /// A hit has to hand back the window as well as the bytes, because the
    /// bytes on their own are a shape rather than terrain.
    #[test]
    fn serves_the_window_back_with_the_picture_it_belongs_to() {
        let dir = cache_dir("hit");
        let picture = cache_file(Some(&dir), Some("abc"));
        let window = window_file(Some(&dir), Some("abc"));
        let made = HeightWindow {
            low: 1234,
            high: 54321,
        };

        let first = cached_picture(picture.clone(), window.clone(), || {
            Ok((b"pretend webp".to_vec(), made))
        })
        .expect("first");
        assert_eq!((first.0.as_slice(), first.2), (&b"pretend webp"[..], made));

        let second =
            cached_picture(picture, window, || panic!("re-encoded on a hit")).expect("hit");
        assert_eq!(
            (second.0.as_slice(), second.2),
            (&b"pretend webp"[..], made)
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// A picture whose window was lost is one nothing can read a height off, so
    /// it is encoded again rather than served with a window that is a guess.
    #[test]
    fn re_encodes_a_picture_whose_window_went_missing() {
        let dir = cache_dir("halfhit");
        let picture = cache_file(Some(&dir), Some("abc"));
        let window = window_file(Some(&dir), Some("abc"));
        cached_picture(picture.clone(), window.clone(), || {
            Ok((b"stale".to_vec(), HeightWindow { low: 0, high: 1 }))
        })
        .expect("first");
        std::fs::remove_file(window.as_ref().unwrap()).expect("drop the window");

        let again = cached_picture(picture, window, || {
            Ok((b"fresh".to_vec(), HeightWindow { low: 7, high: 9 }))
        })
        .expect("second");
        assert_eq!(again.0.as_slice(), b"fresh");
        assert_eq!(again.2, HeightWindow { low: 7, high: 9 });
        let _ = std::fs::remove_dir_all(&dir);
    }
}
