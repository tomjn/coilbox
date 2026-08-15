//! Heightmap rendering: read a map's full-resolution 16-bit height infomap via
//! unitsync (`GetInfoMap "height"`, pure static SMF parsing) and turn it into a
//! downscaled grayscale PNG for the 3D terrain preview. Cached on disk (under
//! `cache_dir`, keyed by a cheap file identity of the map's archive + max-side)
//! like minimaps, so the heavy read + encode only runs on a cache miss, and
//! reported by cache file name so the preview loads it over the asset protocol.
//!
//! With `--asset-dir` the same read also produces the hub's `overlay:height`
//! asset, which is those samples at full resolution and full precision rather
//! than the downscaled picture above (#1627). Both come off one `GetInfoMap`
//! call: a height read costs a map archive open and the largest maps are 2049 by
//! 2049 samples, so asking twice would double the most expensive read the worker
//! makes.

use crate::ffi::Unitsync;
use crate::minimap::{map_cache_key, rendered_image, sweep_pictures, RenderedImage};
use crate::model::{HeightmapOutput, MapOverlayAsset, MapOverlaySkip};
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

/// Encode a map's height samples as the hub's `overlay:height` asset and write it
/// into `asset_dir`, named after the hash of its own bytes like the hub's object
/// path.
///
/// 16 bit grayscale PNG rather than the WebP the rest of the corpus is, because
/// WebP's lossless mode is 8 bit and would halve the precision without looking
/// broken. `assetencode::encode_variant` refuses this variant for that reason.
///
/// No bounds, no asset. The samples are a 0..65535 scale and the two world
/// heights are what turn them into elmos, so a grid stored without them is a
/// picture of terrain nobody can measure.
fn encode_asset(
    asset_dir: &Path,
    samples: &[u16],
    w: u32,
    h: u32,
    bounds: Option<(f32, f32)>,
    source_archive: &str,
) -> Result<MapOverlayAsset, MapOverlaySkip> {
    use crate::assetencode::{
        encode_height_overlay, ext_for_mime, map_source_hash, sha256_hex, EncodeError,
        EXTRACTED_ORIGIN, HEIGHT_OVERLAY_VARIANT,
    };

    let (min_height, max_height) = bounds.ok_or(MapOverlaySkip::NoBounds)?;
    let encoded = encode_height_overlay(samples, w, h).map_err(|e| match e {
        EncodeError::TooLarge { .. } => MapOverlaySkip::TooLarge,
        _ => MapOverlaySkip::EncodeFailed,
    })?;

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
    match (dims, raw) {
        (None, _) => (None, Some(MapOverlaySkip::NoSource)),
        (Some(_), None) => (None, Some(MapOverlaySkip::ReadFailed)),
        (Some((w, h)), Some(raw)) => {
            match encode_asset(asset_dir, raw, w, h, bounds, source_archive) {
                Ok(a) => (Some(a), None),
                Err(why) => (None, Some(why)),
            }
        }
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

/// Cache file for a heightmap PNG: `<cache_dir>/<key>-h<max_side>.png`. The `h`
/// prefix keeps it from colliding with the minimap cache (`<key>-<mip>`).
fn cache_file(cache_dir: Option<&Path>, key: Option<&str>, max_side: u32) -> Option<PathBuf> {
    let dir = cache_dir?;
    let key = key?;
    Some(dir.join(format!("{key}-h{max_side}.png")))
}

/// Render `map_name`'s heightmap to a grayscale PNG data URL plus its world-height
/// bounds (standalone unitsync session).
///
/// `asset_dir` `Some` additionally stores the full resolution samples as the
/// hub's `overlay:height` asset. Off by default: the 3D preview wants the
/// downscaled picture and nothing else, and a height overlay for a 32x32 map is
/// megabytes, so encoding a whole map library for nobody is real work with no
/// reader.
pub fn render(
    lib: &str,
    map_name: &str,
    max_side: u32,
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
    let cache = cache_file(
        cache_dir,
        map_cache_key(&us, None, map_name).as_deref(),
        max_side,
    );

    let dims = us.heightmap_size(map_name);
    // The sample read, done once and shared. Only an asset run needs it up front:
    // the display path reads it inside the cache miss below, so a map whose
    // preview PNG is already cached still costs nothing when nobody wants an
    // asset.
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

    let result = (|| -> Result<(RenderedImage, u32, u32), String> {
        let (w, h) = dims.ok_or_else(|| "no heightmap available".to_string())?;
        // Only the cache miss pays for the full GetInfoMap read + encode.
        let (png, on_disk) =
            coilbox_thumb_cache::cached_at(cache.clone(), || match raw.as_deref() {
                Some(raw) => heightmap_png(raw, w, h, max_side),
                None => {
                    let raw = us
                        .heightmap_data(map_name, w, h)
                        .ok_or_else(|| "failed to read heightmap".to_string())?;
                    heightmap_png(&raw, w, h, max_side)
                }
            })?;
        Ok((rendered_image(&png, on_disk), w, h))
    })();
    sweep_pictures(cache_dir, cache.as_slice());

    let errors = us.drain_errors();
    us.uninit();

    match result {
        Ok((image, w, h)) => HeightmapOutput {
            file: image.file,
            data_url: image.data_url,
            width: Some(w),
            height: Some(h),
            min_height: bounds.map(|(lo, _)| lo),
            max_height: bounds.map(|(_, hi)| hi),
            asset,
            asset_skipped,
            errors,
        },
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

    /// The whole point of #1627: what comes back out of the stored asset is the
    /// height that went in, sample for sample and bit for bit. The preview PNG
    /// beside it is downscaled and cannot answer "how high is this vertex".
    #[test]
    fn the_stored_asset_gives_back_the_heights_that_went_in() {
        let dir = asset_dir("roundtrip");
        let (w, h) = (65u32, 33u32);
        let samples = heights(w, h);
        let asset =
            encode_asset(&dir, &samples, w, h, Some((-40.0, 620.5)), ARCHIVE).expect("encode");

        let on_disk = std::fs::read(&asset.path).expect("asset file written");
        let decoded = image::load_from_memory(&on_disk).expect("decode png");
        assert_eq!((decoded.width(), decoded.height()), (w, h));
        let gray = decoded.as_luma16().expect("not 16 bit grayscale");
        assert_eq!(gray.as_raw().as_slice(), samples.as_slice());
    }

    #[test]
    fn writes_the_asset_as_a_file_named_after_its_own_bytes() {
        let dir = asset_dir("write");
        let asset = encode_asset(&dir, &heights(32, 32), 32, 32, Some((0.0, 100.0)), ARCHIVE)
            .expect("code");
        let on_disk = std::fs::read(&asset.path).expect("asset file written");

        assert_eq!(
            asset.path,
            dir.join(format!("{}.png", asset.hash)).to_string_lossy()
        );
        assert_eq!(asset.hash, sha256_hex(&on_disk));
        assert_eq!(asset.bytes, on_disk.len() as u64);
        assert_eq!(asset.mime, "image/png");
        assert_eq!(asset.encode_profile, "png16-lossless-source");
        assert_eq!(asset.variant, "overlay:height");
        assert_eq!((asset.width, asset.height), (32, 32));
    }

    /// The bounds are the difference between a grid of numbers and terrain. They
    /// go on the asset because whatever uploads the bytes has to send them in the
    /// same request, and nothing can recover them from the PNG.
    #[test]
    fn carries_the_bounds_that_turn_the_samples_into_elmos() {
        let dir = asset_dir("bounds");
        let asset = encode_asset(
            &dir,
            &heights(64, 64),
            64,
            64,
            Some((-73.5, 412.0)),
            ARCHIVE,
        )
        .expect("ok");
        assert_eq!(
            (asset.min_height, asset.max_height),
            (Some(-73.5), Some(412.0))
        );
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
    /// not the encode. Hashing the PNG there would report every map as changed
    /// the first time the encoder's filtering moved.
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

    /// The picture budget is a suffix, so a heightmap named anything else would
    /// quietly stop being bounded (issue #1550).
    #[test]
    fn the_picture_sweep_covers_what_this_writes() {
        let file = cache_file(Some(Path::new("/cache")), Some("abc"), 512).expect("cache file");
        assert!(file
            .to_string_lossy()
            .ends_with(crate::minimap::PICTURE_SUFFIX));
    }
}
