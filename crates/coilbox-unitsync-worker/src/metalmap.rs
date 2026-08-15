//! Metal-map rendering: read a map's metal infomap via unitsync (`GetInfoMap
//! "metal"`, 8-bit density per pixel) and turn it into a downscaled green-on-
//! transparent RGBA PNG for overlaying on a minimap. Cached on disk (under
//! `cache_dir`, keyed by the map's archive identity + max-side) like heightmaps,
//! so the read + encode only runs on a cache miss, and reported by cache file
//! name so the overlay loads it over the asset protocol.
//!
//! With `--asset-dir` the same read also produces the hub's `overlay:metal`
//! asset, which is those density values as a lossless WebP rather than the
//! green picture above (#1626). The two outputs come off one `GetInfoMap` call:
//! a metal infomap read costs a map archive open, and asking for it twice to
//! draw it twice would double that for nothing.

use crate::ffi::Unitsync;
use crate::minimap::{map_cache_key, rendered_image, sweep_pictures, RenderedImage};
use crate::model::{MapOverlayAsset, MapOverlaySkip, MetalmapOutput};
use image::{DynamicImage, GrayImage, ImageBuffer, ImageFormat, Rgba};
use std::io::Cursor;
use std::path::{Path, PathBuf};

/// The hub's variant name for the layer this module extracts. One of the
/// vocabulary's closed list of map variants, which a test below checks, so a
/// typo here cannot mint an identity the hub would refuse.
const METAL_OVERLAY_VARIANT: &str = "overlay:metal";

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

/// Encode a map's raw metal density as the hub's `overlay:metal` asset and write
/// it into `asset_dir`, named after the hash of its own bytes like the hub's
/// object path.
///
/// The samples go in as 8-bit grayscale, one pixel per infomap sample, and the
/// class is lossless with no edge cap, so what comes back out of the WebP is the
/// density that went in. Nothing here decides how to colour it: that is the
/// consumer's call, and baking it in is what this issue exists to undo.
///
/// `source_hash` is over `raw`, the samples exactly as `GetInfoMap` returned
/// them. Those bytes are a verbatim copy of the SMF's metal map block
/// (`CSMFMapFile::ReadInfoMap` seeks `metalmapPtr` and reads `mapx/2 * mapy/2`
/// bytes with no conversion), so the hash moves only when the map does, and not
/// when coilbox's encoder, `image` or libwebp changes. That is the property the
/// have check at #1632 needs, since it compares on `source_hash`.
fn encode_asset(
    asset_dir: &Path,
    raw: &[u8],
    w: u32,
    h: u32,
) -> Result<MapOverlayAsset, MapOverlaySkip> {
    use crate::assetencode::{encode_variant, ext_for_mime, sha256_hex, EncodeError};

    let grid = GrayImage::from_raw(w, h, raw.to_vec()).ok_or(MapOverlaySkip::EncodeFailed)?;
    let encoded = encode_variant(METAL_OVERLAY_VARIANT, &DynamicImage::ImageLuma8(grid)).map_err(
        |e| match e {
            EncodeError::TooLarge { .. } => MapOverlaySkip::TooLarge,
            _ => MapOverlaySkip::EncodeFailed,
        },
    )?;

    let hash = sha256_hex(&encoded.bytes);
    let path = asset_dir.join(format!("{hash}.{}", ext_for_mime(&encoded.mime)));
    std::fs::create_dir_all(asset_dir).map_err(|_| MapOverlaySkip::NotWritten)?;
    // Same content, same name, so a file already there is already this asset.
    if !path.exists() {
        std::fs::write(&path, &encoded.bytes).map_err(|_| MapOverlaySkip::NotWritten)?;
    }

    Ok(MapOverlayAsset {
        variant: METAL_OVERLAY_VARIANT.to_string(),
        path: path.to_string_lossy().into_owned(),
        hash,
        source_hash: sha256_hex(raw),
        encode_profile: encoded.encode_profile,
        mime: encoded.mime,
        width: encoded.width,
        height: encoded.height,
        bytes: encoded.bytes.len() as u64,
    })
}

/// Render `map_name`'s metal infomap to a green-on-transparent RGBA PNG data URL
/// (standalone unitsync session).
///
/// `asset_dir` `Some` additionally encodes the raw density as the hub's
/// `overlay:metal` asset and writes it there. That is off by default because the
/// overlay coilbox draws needs the picture and nothing else, and encoding a
/// whole map library losslessly for nobody is work with no reader.
pub fn render(
    lib: &str,
    map_name: &str,
    max_side: u32,
    cache_dir: Option<&Path>,
    asset_dir: Option<&Path>,
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

    let dims = us.map_dimensions(map_name);
    // The density read, done once and shared. Only an asset run needs it up
    // front: the display path reads it inside the cache miss below, so a map
    // whose PNG is already cached still costs nothing when nobody wants an asset.
    let raw = match (asset_dir, dims) {
        (Some(_), Some((w, h))) => us.metalmap_data(map_name, w, h),
        _ => None,
    };

    let (asset, asset_skipped) = match (asset_dir, dims, raw.as_deref()) {
        (None, _, _) => (None, None),
        (Some(_), None, _) => (None, Some(MapOverlaySkip::NoSource)),
        (Some(_), Some(_), None) => (None, Some(MapOverlaySkip::ReadFailed)),
        (Some(dir), Some((w, h)), Some(raw)) => match encode_asset(dir, raw, w, h) {
            Ok(a) => (Some(a), None),
            Err(why) => (None, Some(why)),
        },
    };

    let result = (|| -> Result<(RenderedImage, u32, u32), String> {
        let (w, h) = dims.ok_or_else(|| "no metal infomap available".to_string())?;
        // Only the cache miss pays for the full GetInfoMap read + encode.
        let (png, on_disk) =
            coilbox_thumb_cache::cached_at(cache.clone(), || match raw.as_deref() {
                Some(raw) => metalmap_png(raw, w, h, max_side),
                None => {
                    let raw = us
                        .metalmap_data(map_name, w, h)
                        .ok_or_else(|| "failed to read metal infomap".to_string())?;
                    metalmap_png(&raw, w, h, max_side)
                }
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
            asset,
            asset_skipped,
            errors,
        },
        Err(e) => MetalmapOutput {
            asset,
            asset_skipped,
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
    use crate::assetencode::sha256_hex;

    /// A density grid with the shape a real metal map has: mostly nothing, a few
    /// spots, and every one of the values in between that a colour ramp would
    /// round away.
    fn density(w: u32, h: u32) -> Vec<u8> {
        (0..w * h)
            .map(|i| match i % 17 {
                0 => 255,
                1 => 1,
                2 => 128,
                3 => (i % 251) as u8,
                _ => 0,
            })
            .collect()
    }

    fn asset_dir(tag: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("coilbox-metal-asset-{}-{tag}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        dir
    }

    /// The whole point of #1626: what comes back out of the stored asset is the
    /// density that went in, sample for sample. A green channel and an alpha
    /// ramp cannot answer "how much metal is at this spot", and this can.
    #[test]
    fn the_stored_asset_gives_back_the_density_that_went_in() {
        let dir = asset_dir("roundtrip");
        let (w, h) = (64u32, 48u32);
        let raw = density(w, h);
        let asset = encode_asset(&dir, &raw, w, h).expect("encode");

        let on_disk = std::fs::read(&asset.path).expect("asset file written");
        let decoded = webp::Decoder::new(&on_disk).decode().expect("decode webp");
        assert_eq!((decoded.width(), decoded.height()), (w, h));

        // Grayscale in, so every channel carries the sample and any one of them
        // reads back as the amount.
        let pixels: Vec<&[u8]> = decoded.chunks_exact(3).collect();
        assert_eq!(pixels.len(), raw.len());
        for (px, want) in pixels.iter().zip(&raw) {
            assert_eq!(px, &[*want, *want, *want]);
        }
    }

    #[test]
    fn writes_the_asset_as_a_file_named_after_its_own_bytes() {
        let dir = asset_dir("write");
        let asset = encode_asset(&dir, &density(32, 32), 32, 32).expect("encode");
        let on_disk = std::fs::read(&asset.path).expect("asset file written");

        assert_eq!(
            asset.path,
            dir.join(format!("{}.webp", asset.hash)).to_string_lossy()
        );
        assert_eq!(asset.hash, sha256_hex(&on_disk));
        assert_eq!(asset.bytes, on_disk.len() as u64);
        assert_eq!(asset.mime, "image/webp");
        assert_eq!(asset.encode_profile, "webp-lossless-source");
        assert_eq!(asset.variant, "overlay:metal");
        assert_eq!((asset.width, asset.height), (32, 32));
    }

    /// The have check compares on `source_hash`, so it has to be the samples and
    /// not the encode. Hashing the WebP there would report every map as changed
    /// the first time libwebp or the colouring moved.
    #[test]
    fn identity_is_the_samples_and_the_path_is_the_encoded_bytes() {
        let dir = asset_dir("hashes");
        let raw = density(32, 32);
        let asset = encode_asset(&dir, &raw, 32, 32).expect("encode");
        assert_eq!(asset.source_hash, sha256_hex(&raw));
        assert_ne!(asset.source_hash, asset.hash);
    }

    /// An overlay class has no edge cap, so a grid bigger than any picture class
    /// allows is stored at the resolution the map has rather than resampled,
    /// which would average neighbouring spots into amounts no mex sits on.
    #[test]
    fn keeps_the_grid_the_map_has_rather_than_capping_it() {
        let dir = asset_dir("size");
        let asset = encode_asset(&dir, &density(1024, 512), 1024, 512).expect("encode");
        assert_eq!((asset.width, asset.height), (1024, 512));
    }

    #[test]
    fn refuses_a_grid_that_is_not_the_size_it_says_it_is() {
        let dir = asset_dir("mismatch");
        assert_eq!(
            encode_asset(&dir, &density(8, 8), 8, 9).unwrap_err(),
            MapOverlaySkip::EncodeFailed
        );
    }

    /// The variant is the hub's own string and the vocabulary holds the list, so
    /// a typo here would be an upload the hub refuses rather than a build error.
    #[test]
    fn names_a_variant_the_hub_stores() {
        assert!(coilbox_assets::vocabulary()
            .map_variants
            .iter()
            .any(|v| v == METAL_OVERLAY_VARIANT));
    }

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
