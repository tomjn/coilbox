//! Terrain-type infomap extraction: read a map's type infomap via unitsync
//! (`GetInfoMap "type"`, 8-bit terrain type index per sample) and store it as the
//! hub's `overlay:type` asset, a lossless WebP at the map's own grid (#1628).
//!
//! Unlike the metal and height modes there is no picture beside it. Nothing in
//! coilbox draws a type map, so this mode exists only to feed the seed walk at
//! #1638, and without `--asset-dir` it has nothing to do.
//!
//! A type sample is a label, not an amount: it indexes the `terrainTypes` table
//! in the map's `mapinfo.lua`, which is what gives speed, hardness and
//! buildability at that square. Nothing here interprets it. Whatever finally
//! reads one needs the map's own table to say what index 3 means, and no ramp
//! applied here could carry that.

use crate::ffi::Unitsync;
use crate::model::{MapOverlayAsset, MapOverlaySkip, TypemapOutput};
use image::{DynamicImage, GrayImage};
use std::path::Path;

/// The hub's variant name for the layer this module extracts. One of the
/// vocabulary's closed list of map variants, which a test below checks, so a typo
/// here cannot mint an identity the hub would refuse.
const TYPE_OVERLAY_VARIANT: &str = "overlay:type";

/// Encode a map's raw terrain types as the hub's `overlay:type` asset and write
/// it into `asset_dir`, named after the hash of its own bytes like the hub's
/// object path.
///
/// The samples go in as 8-bit grayscale, one pixel per infomap sample, and the
/// class is lossless with no edge cap, so the index that went in is the index
/// that comes back out. That matters more here than it does for metal: a type
/// index has no ordering, so a lossy pass or a resample would not blur a value,
/// it would name a different terrain.
///
/// `source_hash` is over `raw`, the samples exactly as `GetInfoMap` returned
/// them. Those bytes are a verbatim copy of the SMF's type map block
/// (`CSMFMapFile::ReadInfoMap` seeks `typeMapPtr` and reads `mapx/2 * mapy/2`
/// bytes with no conversion), so the hash moves when the map moves and not when
/// coilbox's encoder, `image` or libwebp changes. That is what the have check at
/// #1632 compares on.
fn encode_asset(
    asset_dir: &Path,
    raw: &[u8],
    w: u32,
    h: u32,
) -> Result<MapOverlayAsset, MapOverlaySkip> {
    use crate::assetencode::{encode_variant, ext_for_mime, sha256_hex, EncodeError};

    let grid = GrayImage::from_raw(w, h, raw.to_vec()).ok_or(MapOverlaySkip::EncodeFailed)?;
    let encoded = encode_variant(TYPE_OVERLAY_VARIANT, &DynamicImage::ImageLuma8(grid)).map_err(
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
        variant: TYPE_OVERLAY_VARIANT.to_string(),
        path: path.to_string_lossy().into_owned(),
        hash,
        source_hash: sha256_hex(raw),
        encode_profile: encoded.encode_profile,
        mime: encoded.mime,
        width: encoded.width,
        height: encoded.height,
        bytes: encoded.bytes.len() as u64,
        // Bounds belong to the height layer. A type index spans nothing.
        min_height: None,
        max_height: None,
    })
}

/// Read `map_name`'s type infomap and store it as the hub's `overlay:type`
/// asset in `asset_dir` (standalone unitsync session).
pub fn render(lib: &str, map_name: &str, asset_dir: &Path) -> TypemapOutput {
    let us = match unsafe { Unitsync::load(Path::new(lib)) } {
        Ok(u) => u,
        Err(e) => {
            return TypemapOutput {
                errors: vec![e],
                ..Default::default()
            }
        }
    };
    us.init(false, 0);
    let _ = us.drain_errors();

    // A map with no type infomap is a normal answer, not a failure: unitsync
    // reports a zero-sized bitmap for anything that is not an SMF it can open.
    let dims = us.typemap_size(map_name);
    let raw = dims.and_then(|(w, h)| us.typemap_data(map_name, w, h));

    let (asset, asset_skipped) = match (dims, raw.as_deref()) {
        (None, _) => (None, Some(MapOverlaySkip::NoSource)),
        (Some(_), None) => (None, Some(MapOverlaySkip::ReadFailed)),
        (Some((w, h)), Some(raw)) => match encode_asset(asset_dir, raw, w, h) {
            Ok(a) => (Some(a), None),
            Err(why) => (None, Some(why)),
        },
    };

    let errors = us.drain_errors();
    us.uninit();

    TypemapOutput {
        width: dims.map(|(w, _)| w),
        height: dims.map(|(_, h)| h),
        asset,
        asset_skipped,
        errors,
    }
}

/// Print a typemap error envelope to stdout (used on panic and on a missing
/// `--asset-dir`).
pub fn emit_error(msg: String) {
    let out = TypemapOutput {
        errors: vec![msg],
        ..Default::default()
    };
    println!("{}", serde_json::to_string(&out).unwrap_or_default());
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::assetencode::sha256_hex;
    use std::path::PathBuf;

    /// A type grid shaped like a real one: a handful of distinct indices in
    /// runs, the way terrain comes in patches, including neighbouring indices
    /// that any resample would average into a type the map does not have.
    fn types(w: u32, h: u32) -> Vec<u8> {
        (0..w * h)
            .map(|i| match (i / 7) % 5 {
                0 => 0,
                1 => 1,
                2 => 2,
                3 => 15,
                _ => 255,
            })
            .collect()
    }

    fn asset_dir(tag: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("coilbox-type-asset-{}-{tag}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        dir
    }

    /// The point of the whole mode: what comes back out of the stored asset is
    /// the terrain type index that went in, sample for sample. An index is a
    /// label, so a value that is one off is a different terrain rather than a
    /// slightly wrong one.
    #[test]
    fn the_stored_asset_gives_back_the_type_indices_that_went_in() {
        let dir = asset_dir("roundtrip");
        let (w, h) = (64u32, 48u32);
        let raw = types(w, h);
        let asset = encode_asset(&dir, &raw, w, h).expect("encode");

        let on_disk = std::fs::read(&asset.path).expect("asset file written");
        let decoded = webp::Decoder::new(&on_disk).decode().expect("decode webp");
        assert_eq!((decoded.width(), decoded.height()), (w, h));

        // Grayscale in, so every channel carries the sample and any one of them
        // reads back as the index.
        let pixels: Vec<&[u8]> = decoded.chunks_exact(3).collect();
        assert_eq!(pixels.len(), raw.len());
        for (px, want) in pixels.iter().zip(&raw) {
            assert_eq!(px, &[*want, *want, *want]);
        }
    }

    #[test]
    fn writes_the_asset_as_a_file_named_after_its_own_bytes() {
        let dir = asset_dir("write");
        let asset = encode_asset(&dir, &types(32, 32), 32, 32).expect("encode");
        let on_disk = std::fs::read(&asset.path).expect("asset file written");

        assert_eq!(
            asset.path,
            dir.join(format!("{}.webp", asset.hash)).to_string_lossy()
        );
        assert_eq!(asset.hash, sha256_hex(&on_disk));
        assert_eq!(asset.bytes, on_disk.len() as u64);
        assert_eq!(asset.mime, "image/webp");
        assert_eq!(asset.encode_profile, "webp-lossless-source");
        assert_eq!(asset.variant, "overlay:type");
        assert_eq!((asset.width, asset.height), (32, 32));
    }

    /// The have check compares on `source_hash`, so it has to be the samples and
    /// not the encode.
    #[test]
    fn identity_is_the_samples_and_the_path_is_the_encoded_bytes() {
        let dir = asset_dir("hashes");
        let raw = types(32, 32);
        let asset = encode_asset(&dir, &raw, 32, 32).expect("encode");
        assert_eq!(asset.source_hash, sha256_hex(&raw));
        assert_ne!(asset.source_hash, asset.hash);
    }

    /// The type and metal layers are on the same grid and both 8 bit, so the
    /// only thing keeping a map's two overlays apart is the samples themselves.
    /// A map whose types happen to equal its densities would legitimately share
    /// an identity, and nothing else would.
    #[test]
    fn a_grid_of_one_value_hashes_to_what_that_grid_is() {
        let dir = asset_dir("shared-grid");
        let flat = vec![0u8; 32 * 32];
        let asset = encode_asset(&dir, &flat, 32, 32).expect("encode");
        assert_eq!(asset.source_hash, sha256_hex(&flat));
    }

    /// An overlay class has no edge cap, so the grid is stored at the resolution
    /// the map has. Resampling would blend neighbouring indices into terrain
    /// types that are not on the map at all.
    #[test]
    fn keeps_the_grid_the_map_has_rather_than_capping_it() {
        let dir = asset_dir("size");
        let asset = encode_asset(&dir, &types(1024, 512), 1024, 512).expect("encode");
        assert_eq!((asset.width, asset.height), (1024, 512));
    }

    #[test]
    fn refuses_a_grid_that_is_not_the_size_it_says_it_is() {
        let dir = asset_dir("mismatch");
        assert_eq!(
            encode_asset(&dir, &types(8, 8), 8, 9).unwrap_err(),
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
            .any(|v| v == TYPE_OVERLAY_VARIANT));
    }

    /// Type and metal share the `webp-lossless-source` profile in the vocabulary
    /// because they share an encoding exactly. If one ever moves, this says so.
    #[test]
    fn encodes_the_same_way_the_metal_layer_does() {
        let classes = &coilbox_assets::vocabulary().classes;
        let metal = classes.get("overlay:metal").expect("metal class");
        let ty = classes.get(TYPE_OVERLAY_VARIANT).expect("type class");
        assert_eq!(ty.encode_profile, metal.encode_profile);
        assert_eq!(ty.mime, metal.mime);
        assert_eq!(ty.lossless, metal.lossless);
        assert_eq!(ty.max_edge_px, metal.max_edge_px);
    }
}
