//! Minimap rendering: turn unitsync's RGB565 minimap buffers into PNGs. Used two
//! ways, a single map's larger preview (`render`) and a batch of small thumbnails
//! for the whole map list (`render_all`), each in one `Init`.
//!
//! Rendered PNGs are cached on disk (under `cache_dir`, keyed by a cheap file
//! identity of the map's archive + mip) via `coilbox-thumb-cache`, so a map's
//! minimap is encoded once and reused across launches. The expensive `GetMinimap`
//! plus RGB565 to PNG encode only runs on a cache miss.
//!
//! Output reports the cache file name rather than the bytes, because the frontend
//! fetches it over `coilbox://unitsyncthumb/` instead of paying for base64 on the
//! bridge. A `data:` URL is only the fallback for a render that never reached
//! disk.
//!
//! With `--asset-dir` the single-map mode also produces the hub's `minimap`
//! asset (#1630), which is neither of the two sizes coilbox draws: it is always
//! mip 1, 512px square, because that is what the hub caps a minimap at. The
//! display render keeps whatever mip it was asked for.

use crate::ffi::Unitsync;
use crate::model::{MapOverlayAsset, MapOverlaySkip, MinimapOutput, StartPos};
use crate::model::{Thumbnail, ThumbnailsOutput};
use base64::Engine;
use image::{DynamicImage, ImageFormat, RgbImage};
use serde::{Deserialize, Serialize};
use std::io::Cursor;
use std::path::{Path, PathBuf};

/// The hub's variant name for a map's minimap. One of the vocabulary's closed
/// list of map variants, which a test below checks.
const MINIMAP_VARIANT: &str = "minimap";

/// The mip the hub's `minimap` asset is stored at.
///
/// unitsync's minimap is `1024 >> mip` on a side, so this is 512px, which is the
/// longest edge the `minimap` class allows. Neither of coilbox's own callers
/// wants that size, since the map page takes mip 0 because the same texture is
/// the diffuse map under the 3D preview and the map grid takes mip 3, so the
/// asset read is its own, at its own mip, rather than whatever the display asked
/// for.
const ASSET_MINIMAP_MIP: i32 = 1;

/// A cheap, stable cache identity for a map's rendered images: the archive's file
/// identity where it resolves, otherwise the map's versioned name. Neither route
/// hashes an archive, so building keys for the whole map list is effectively free.
/// `None` disables caching for that map, and it simply re-renders.
///
/// Note: a `.sdd` directory map edited in place may keep both its dir mtime and
/// its name, so a stale image can persist until a rescan. That is an acceptable
/// trade for a cosmetic minimap that re-renders in about 80ms.
pub(crate) fn map_cache_key(us: &Unitsync, index: Option<i32>, map_name: &str) -> Option<String> {
    archive_identity(us, map_name).or_else(|| name_identity(us, index, map_name))
}

/// File identity of the map's own archive: path + size + mtime.
///
/// Only resolves when `GetArchivePath` recognises the name `GetMapArchiveName`
/// gave us, which is not the general case: a map's archives come back under their
/// versioned *human* names ("AcidicQuarry 5.17") while `GetArchivePath` looks up
/// *file* names ("acidicquarry_5.17.sd7"). Kept as the preferred route because
/// where it does resolve it catches an in-place edit that the name route cannot.
fn archive_identity(us: &Unitsync, map_name: &str) -> Option<String> {
    use std::hash::{Hash, Hasher};
    let archive = us.map_archives(map_name).into_iter().next()?;
    let dir = us.archive_path(&archive)?;
    let path = Path::new(&dir).join(&archive);
    let md = std::fs::metadata(&path).ok()?;
    let mtime = md
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let mut h = std::collections::hash_map::DefaultHasher::new();
    path.hash(&mut h);
    md.len().hash(&mut h);
    mtime.hash(&mut h);
    Some(format!("{:016x}", h.finish()))
}

/// The map's versioned name plus the map file inside its archive.
///
/// Needs no path and no hashing, so it costs nothing on a cold library. It works
/// because the versioned name carries the archive version: installing a new
/// release of a map yields a new name, so the key changes with it. `GetMapChecksum`
/// would be a stronger identity but hashes the whole archive, which on a 5.5 GB
/// library takes minutes.
fn name_identity(us: &Unitsync, index: Option<i32>, map_name: &str) -> Option<String> {
    use std::hash::{Hash, Hasher};
    let i = index.or_else(|| map_index(us, map_name))?;
    let file = us.map_file_name(i)?;
    let mut h = std::collections::hash_map::DefaultHasher::new();
    map_name.hash(&mut h);
    file.hash(&mut h);
    Some(format!("n{:016x}", h.finish()))
}

/// A map's index, for callers that only have its name. `GetMapFileName` is
/// index-only, and names come from the archive scanner's index that `Init` has
/// already built, so this costs no archive reads.
pub(crate) fn map_index(us: &Unitsync, map_name: &str) -> Option<i32> {
    (0..us.map_count()).find(|&i| us.map_name(i).as_deref() == Some(map_name))
}

/// The suffix every rendered picture in the thumb cache carries, and the whole
/// of what [`sweep_pictures`] is allowed to delete: minimaps `<key>-<mip>.png`,
/// heightmaps `<key>-h<side>.png` and metal maps `<key>-m<side>.png`.
///
/// The raw height grids in the same dir are bounded on their own much smaller
/// budget (issue #1535), and the `-dims.json` entries beside them are a few
/// bytes each and left alone.
pub(crate) const PICTURE_SUFFIX: &str = ".png";

/// How many bytes of rendered pictures the thumb cache holds, across every map
/// (issue #1550).
///
/// A whole library's pictures came to 72 MB in 200 files on the machine this was
/// measured on: a small thumbnail for every map, plus a 1024px minimap, a
/// heightmap and a metal map for each map whose page has been opened. So 512 MB
/// is seven of those, and what it bounds is years of switching engine and data
/// directory rather than any one library.
///
/// It has to be that generous because the consumer is nothing like the height
/// grids'. A grid is 3 to 33 MB and one map's, and one map is open at a time. A
/// picture is a few hundred kilobytes and fifty are on screen at once, so a
/// picture taken off a page in view is a blank box on it. Three things keep the
/// sweep off what is being looked at: every call keeps every file it is
/// answering with, a cache hit counts as a use so a list that was read back
/// moves as one, and a session that does lose a picture asks for it again
/// (issue #1551).
const PICTURE_BUDGET: u64 = 512 * 1024 * 1024;

/// Bound the rendered pictures in the thumb cache, keeping every file this call
/// is answering with. Called by each of the four renders that writes one.
pub(crate) fn sweep_pictures(cache_dir: Option<&Path>, keep: &[PathBuf]) {
    if let Some(dir) = cache_dir {
        coilbox_thumb_cache::sweep(dir, PICTURE_SUFFIX, PICTURE_BUDGET, keep);
    }
}

/// Cache file for a map's minimap: `<cache_dir>/<key>-<mip>.png`. `None` (no
/// cache dir, or no cache key) disables caching for that map.
fn cache_file(cache_dir: Option<&Path>, key: Option<&str>, mip: i32) -> Option<PathBuf> {
    let dir = cache_dir?;
    let key = key?;
    Some(dir.join(format!("{key}-{mip}.png")))
}

/// A map's proportions, cached beside its minimap PNG.
#[derive(Serialize, Deserialize)]
struct CachedDims {
    width: u32,
    height: u32,
}

/// Cache file for a map's proportions: `<cache_dir>/<key>-dims.json`. Unlike the
/// PNG this is mip-independent, because proportions don't vary with mip level.
fn dims_file(cache_dir: Option<&Path>, key: Option<&str>) -> Option<PathBuf> {
    let dir = cache_dir?;
    let key = key?;
    Some(dir.join(format!("{key}-dims.json")))
}

/// A map's size in elmos, from the same cached proportions the display path
/// uses (issue #1629).
///
/// Kept as a derivation rather than another cached field so the two can never
/// disagree, and so every `<key>-dims.json` already on disk answers this without
/// a rescan. What is cached is metal infomap samples, and
/// [`coilbox_assets::map_extent_elmos`] carries which of the map's several
/// sample counts that is and what one of them is worth.
fn dims_elmos(dims: Option<(u32, u32)>) -> (Option<u32>, Option<u32>) {
    match dims {
        Some((w, h)) => {
            let (width, height) = coilbox_assets::map_extent_elmos(w, h);
            (Some(width), Some(height))
        }
        None => (None, None),
    }
}

/// A map's proportions, from cache when `file` holds them and from `compute`
/// otherwise. `GetInfoMapSize` costs about 86ms per map, as much again as the
/// minimap render this sits beside, and `render_one`'s cache hit skips its own
/// work. Without this a warm thumbnail pass still pays for the whole library.
///
/// Caching is an optimization: an unwritable cache dir or an unparseable entry
/// just means `compute` runs.
fn cached_dims(
    file: Option<PathBuf>,
    compute: impl FnOnce() -> Option<(u32, u32)>,
) -> Option<(u32, u32)> {
    if let Some(raw) = file.as_deref().and_then(|f| std::fs::read(f).ok()) {
        if let Ok(d) = serde_json::from_slice::<CachedDims>(&raw) {
            return Some((d.width, d.height));
        }
    }
    let (width, height) = compute()?;
    if let Some(f) = file.as_deref() {
        if let Some(dir) = f.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        if let Ok(bytes) = serde_json::to_vec(&CachedDims { width, height }) {
            let _ = std::fs::write(f, bytes);
        }
    }
    Some((width, height))
}

/// The side of the square texture unitsync returns at `mip`, which is what
/// `GetMinimap` fills and how many words come back with it.
fn mip_side(mip: i32) -> u32 {
    1024u32 >> mip.clamp(0, 10) as u32
}

/// The texture as unitsync handed it over: RGB565 words, little endian, row
/// major.
///
/// This is what `source_hash` is over, framed by the variant and the texture's
/// side by [`crate::assetencode::map_source_hash`], and it is one step further
/// from the archive than the infomap overlays' is. There are no verbatim minimap
/// bytes to hash: the SMF stores its minimap as a DXT1 mip chain, and
/// `GetMinimap` decompresses the requested level into RGB565 through a fixed
/// decoder (`GetMinimapSMF` in unitsync). So the identity is the decompressed
/// texture, which moves when the map moves and does not move when coilbox's
/// expansion to RGB8, `image` or libwebp changes. That is the property the have
/// check at #1632 needs. It does move if the engine's DXT1 decode ever changes,
/// which the overlays are immune to and this cannot be.
///
/// Little endian rather than the host's `u16` layout, for the same reason as the
/// height overlay (#1627): the hash has to be the same on every architecture
/// coilbox builds for.
///
/// A minimap is square, so it cannot collide the way #1660's transposed overlays
/// did, and the mip was already part of the identity through the word count. It
/// goes through the same framing anyway: one rule for every map layer beats a
/// rule with an exception that has to be re-derived each time, and the mip is now
/// stated rather than implied. It costs a hash move, which is free before the
/// corpus is committed and not free after.
fn source_bytes(pixels: &[u16]) -> Vec<u8> {
    let mut out = Vec::with_capacity(pixels.len() * 2);
    for p in pixels {
        out.extend_from_slice(&p.to_le_bytes());
    }
    out
}

/// Encode a map's minimap texture as the hub's `minimap` asset and write it into
/// `asset_dir`, named after the hash of its own bytes like the hub's object path.
///
/// The square texture goes in as it comes out of unitsync, stretched over the
/// map the way `GetMinimap` produced it, and it is not cropped to the map's
/// aspect. The proportions travel beside it as the elmos on the same output
/// (#1629) and the consumer stretches, which is why the class leaves aspect
/// unconstrained. Cropping here would throw away samples for a presentation
/// choice this end cannot make.
///
/// This is the one map class that is lossy: q80 WebP, from the vocabulary rather
/// than from anything spelled here.
fn encode_asset(
    asset_dir: &Path,
    pixels: &[u16],
    side: u32,
    source_archive: &str,
) -> Result<MapOverlayAsset, MapOverlaySkip> {
    use crate::assetencode::{
        encode_variant, ext_for_mime, map_source_hash, sha256_hex, EncodeError, EXTRACTED_ORIGIN,
    };

    let texture = RgbImage::from_raw(side, side, expand_rgb565(pixels))
        .ok_or(MapOverlaySkip::EncodeFailed)?;
    let encoded = encode_variant(MINIMAP_VARIANT, &DynamicImage::ImageRgb8(texture)).map_err(
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
        variant: MINIMAP_VARIANT.to_string(),
        origin: EXTRACTED_ORIGIN.to_string(),
        source_archive: source_archive.to_string(),
        path: path.to_string_lossy().into_owned(),
        hash,
        source_hash: map_source_hash(MINIMAP_VARIANT, side, side, &source_bytes(pixels)),
        encode_profile: encoded.encode_profile,
        mime: encoded.mime,
        width: encoded.width,
        height: encoded.height,
        bytes: encoded.bytes.len() as u64,
        // Bounds belong to the height layer. A minimap is already colour.
        min_height: None,
        max_height: None,
    })
}

/// A texture that is one repeated colour, whatever that colour is.
///
/// unitsync returns an entirely black minimap for a map that ships none, and
/// coilbox has always drawn it that way (issue #1658). Stored as the hub's
/// asset it is worse than storing nothing: the hub cannot tell a blank square
/// from a picture, so it draws the square instead of falling back to the
/// placeholder it generates from the map's name.
///
/// The test is one repeated value rather than a darkness threshold, because a
/// night map is dark and is still a picture of a map. A single value carries no
/// information at any exposure, which is the only thing that can be said about a
/// texture without deciding what a map ought to look like.
///
/// Only the minimap is judged this way. A metal map of all zeroes is a map with
/// no metal on it and a type map of one index is ground that is the same
/// everywhere: both are answers a consumer needs, and neither is a missing
/// picture.
fn is_blank(pixels: &[u16]) -> bool {
    match pixels.split_first() {
        Some((first, rest)) => rest.iter().all(|p| p == first),
        None => true,
    }
}

/// The hub's `minimap` asset for one map, from a texture already read at
/// [`ASSET_MINIMAP_MIP`]. Exactly one of the two is set, which is what every
/// asset-producing mode promises.
fn asset_from_pixels(
    asset_dir: &Path,
    pixels: Option<&[u16]>,
    source_archive: &str,
) -> (Option<MapOverlayAsset>, Option<MapOverlaySkip>) {
    let Some(pixels) = pixels else {
        return (None, Some(MapOverlaySkip::NoSource));
    };
    if is_blank(pixels) {
        return (None, Some(MapOverlaySkip::Blank));
    }
    match encode_asset(
        asset_dir,
        pixels,
        mip_side(ASSET_MINIMAP_MIP),
        source_archive,
    ) {
        Ok(a) => (Some(a), None),
        Err(why) => (None, Some(why)),
    }
}

/// The hub's `minimap` asset for one map, in a session the caller has already
/// initialised. The seed walk's entry point, so a whole library's minimaps come
/// off one `Init` (issue #1638).
pub(crate) fn asset_in_session(
    us: &Unitsync,
    map_name: &str,
    asset_dir: &Path,
) -> (Option<MapOverlayAsset>, Option<MapOverlaySkip>) {
    asset_from_pixels(
        asset_dir,
        us.minimap(map_name, ASSET_MINIMAP_MIP).as_deref(),
        &crate::archive::archive_name_for_map(us, map_name),
    )
}

/// A map's size in elmos, from the same `<key>-dims.json` the thumbnail pass
/// writes, so a library that has drawn its map grid once pays nothing (issue
/// #1629). A miss costs the 86ms `GetInfoMapSize` the batch pays.
pub(crate) fn map_elmos(
    us: &Unitsync,
    map_name: &str,
    cache_dir: Option<&Path>,
) -> (Option<u32>, Option<u32>) {
    let key = map_cache_key(us, None, map_name);
    dims_elmos(cached_dims(dims_file(cache_dir, key.as_deref()), || {
        us.map_dimensions(map_name)
    }))
}

/// Render `map_name`'s minimap at `mip` to a PNG data URL (standalone session).
///
/// `asset_dir` `Some` additionally stores the mip 1 texture as the hub's
/// `minimap` asset, whatever `mip` the display render was asked for. Off by
/// default: coilbox draws mip 0 and mip 3, so encoding a third size for nobody
/// is a second `GetMinimap` per map with no reader.
pub fn render(
    lib: &str,
    map_name: &str,
    mip: i32,
    cache_dir: Option<&Path>,
    asset_dir: Option<&Path>,
) -> MinimapOutput {
    let us = match unsafe { Unitsync::load(Path::new(lib)) } {
        Ok(u) => u,
        Err(e) => {
            return MinimapOutput {
                errors: vec![e],
                ..Default::default()
            }
        }
    };
    us.init(false, 0);
    let _ = us.drain_errors();
    let key = map_cache_key(&us, None, map_name);
    let file = cache_file(cache_dir, key.as_deref(), mip);

    // The asset's own read, at its own mip. Only an asset run pays for it, and
    // when the display was asked for the same mip the two share the one read
    // rather than opening the map archive twice.
    let asset_pixels = match asset_dir {
        Some(_) => us.minimap(map_name, ASSET_MINIMAP_MIP),
        None => None,
    };
    let (asset, asset_skipped) = match asset_dir {
        None => (None, None),
        Some(dir) => asset_from_pixels(
            dir,
            asset_pixels.as_deref(),
            &crate::archive::archive_name_for_map(&us, map_name),
        ),
    };

    let shared = asset_pixels.as_deref().filter(|_| mip == ASSET_MINIMAP_MIP);
    let result = render_one(&us, map_name, mip, file.clone(), shared);
    sweep_pictures(cache_dir, file.as_slice());

    let (width_elmos, height_elmos) = map_elmos(&us, map_name, cache_dir);

    // Start positions, environment (wind/tidal) and appearance (water/sky/sun) all
    // live in mapinfo.lua, so load the map's archives and parse them via unitsync's
    // Lua parser.
    let mut start_positions = Vec::new();
    let mut wind = None;
    let mut tidal = None;
    let mut app = crate::ffi::MapAppearance::default();
    if let Some(first_archive) = us.map_archives(map_name).into_iter().next() {
        us.add_all_archives(&first_archive);
        start_positions = us
            .start_positions()
            .into_iter()
            .map(|(x, z)| StartPos { x, z })
            .collect();
        (wind, tidal) = us.map_env();
        app = us.map_appearance();
    }

    let errors = us.drain_errors();
    us.uninit();
    let (min_wind, max_wind) = match wind {
        Some((mn, mx)) => (Some(mn), Some(mx)),
        None => (None, None),
    };

    let base = MinimapOutput {
        width_elmos,
        height_elmos,
        asset,
        asset_skipped,
        start_positions,
        min_wind,
        max_wind,
        tidal_strength: tidal,
        void_water: app.void_water,
        void_ground: app.void_ground,
        void_alpha_min: app.void_alpha_min,
        water_color: app.water_color,
        water_alpha: app.water_alpha,
        water_plane_color: app.water_plane_color,
        water_absorb: app.water_absorb,
        water_base_color: app.water_base_color,
        water_min_color: app.water_min_color,
        force_rendering: app.force_rendering,
        sky_color: app.sky_color,
        fog_color: app.fog_color,
        cloud_color: app.cloud_color,
        cloud_density: app.cloud_density,
        sun_dir: app.sun_dir,
        sun_color: app.sun_color,
        ground_ambient_color: app.ground_ambient_color,
        ground_diffuse_color: app.ground_diffuse_color,
        ground_specular_color: app.ground_specular_color,
        ground_shadow_density: app.ground_shadow_density,
        ..Default::default()
    };
    match result {
        Ok((image, side)) => MinimapOutput {
            file: image.file,
            data_url: image.data_url,
            side: Some(side),
            errors,
            ..base
        },
        Err(e) => MinimapOutput {
            errors: std::iter::once(e).chain(errors).collect(),
            ..base
        },
    }
}

/// Render a small thumbnail for every map in one `Init` session.
pub fn render_all(lib: &str, mip: i32, cache_dir: Option<&Path>) -> ThumbnailsOutput {
    let us = match unsafe { Unitsync::load(Path::new(lib)) } {
        Ok(u) => u,
        Err(e) => {
            return ThumbnailsOutput {
                errors: vec![e],
                ..Default::default()
            }
        }
    };
    us.init(false, 0);
    let mut errors = us.drain_errors();

    let mut thumbnails = Vec::new();
    // Every thumbnail this call answers with, which is the whole of a map list
    // and therefore the whole of what a page of it draws. None of them is a
    // candidate for the sweep below (issue #1550).
    let mut rendered = Vec::new();
    for i in 0..us.map_count() {
        let Some(name) = us.map_name(i) else {
            continue;
        };
        let key = map_cache_key(&us, Some(i), &name);
        let file = cache_file(cache_dir, key.as_deref(), mip);
        if let Some(f) = &file {
            rendered.push(f.clone());
        }
        match render_one(&us, &name, mip, file, None) {
            Ok((image, _)) => {
                let dims = cached_dims(dims_file(cache_dir, key.as_deref()), || {
                    us.map_dimensions(&name)
                });
                let (width_elmos, height_elmos) = dims_elmos(dims);
                thumbnails.push(Thumbnail {
                    name,
                    file: image.file,
                    data_url: image.data_url,
                    width: dims.map(|(w, _)| w),
                    height: dims.map(|(_, h)| h),
                    width_elmos,
                    height_elmos,
                });
            }
            Err(e) => errors.push(format!("{name}: {e}")),
        }
    }
    errors.extend(us.drain_errors());
    us.uninit();
    sweep_pictures(cache_dir, &rendered);

    ThumbnailsOutput { thumbnails, errors }
}

/// Render one map's minimap to `(image, side)` using an already-initialised
/// session. The caller owns the `Init`/`UnInit` lifecycle. `cache_file`, when set,
/// serves a previously-encoded PNG and skips the render entirely.
///
/// `pixels` is an already-read texture at this same `mip`, which the asset path
/// has when the two were asked for the same size. `None` reads one, and only on
/// a cache miss.
fn render_one(
    us: &Unitsync,
    map_name: &str,
    mip: i32,
    cache_file: Option<PathBuf>,
    pixels: Option<&[u16]>,
) -> Result<(RenderedImage, u32), String> {
    let side = mip_side(mip);
    let (png, on_disk) = coilbox_thumb_cache::cached_at(cache_file, || {
        let read;
        let pixels = match pixels {
            Some(p) => p,
            None => {
                read = us
                    .minimap(map_name, mip)
                    .ok_or_else(|| "no minimap available".to_string())?;
                &read
            }
        };
        if pixels.len() != (side * side) as usize {
            return Err(format!(
                "unexpected minimap size: got {} px, expected {}",
                pixels.len(),
                side * side
            ));
        }
        pixels_to_png(pixels, side)
    })?;
    Ok((rendered_image(&png, on_disk), side))
}

/// Expand an RGB565 buffer to 8 bit RGB triples, by shifting each channel up to
/// the top of its byte. Shared by the display PNG and the hub's asset so the two
/// cannot drift into different colours for the same map.
fn expand_rgb565(pixels: &[u16]) -> Vec<u8> {
    let mut rgb = Vec::with_capacity(pixels.len() * 3);
    for &p in pixels {
        rgb.push((((p >> 11) & 0x1f) << 3) as u8);
        rgb.push((((p >> 5) & 0x3f) << 2) as u8);
        rgb.push(((p & 0x1f) << 3) as u8);
    }
    rgb
}

/// Convert an RGB565 square buffer to PNG bytes.
fn pixels_to_png(pixels: &[u16], side: u32) -> Result<Vec<u8>, String> {
    let img = RgbImage::from_raw(side, side, expand_rgb565(pixels))
        .ok_or("failed to build minimap image")?;
    let mut png = Cursor::new(Vec::new());
    DynamicImage::ImageRgb8(img)
        .write_to(&mut png, ImageFormat::Png)
        .map_err(|e| format!("failed to encode minimap PNG: {e}"))?;
    Ok(png.into_inner())
}

/// Wrap PNG bytes in a base64 `data:` URL.
fn png_to_data_url(png: &[u8]) -> String {
    let b64 = base64::engine::general_purpose::STANDARD.encode(png);
    format!("data:image/png;base64,{b64}")
}

/// How a rendered PNG reaches the frontend: the cache file name the webview
/// fetches over `coilbox://unitsyncthumb/`, or the base64 fallback.
#[derive(Default)]
pub(crate) struct RenderedImage {
    pub file: Option<String>,
    pub data_url: Option<String>,
}

/// Describe a render by its cache file when the bytes are on disk, else inline
/// them. Only one of the two is ever set, so the normal case puts a short name on
/// the bridge instead of a megabyte of base64.
pub(crate) fn rendered_image(png: &[u8], on_disk: Option<PathBuf>) -> RenderedImage {
    match on_disk.as_deref().and_then(Path::file_name) {
        Some(name) => RenderedImage {
            file: Some(name.to_string_lossy().into_owned()),
            data_url: None,
        },
        None => RenderedImage {
            file: None,
            data_url: Some(png_to_data_url(png)),
        },
    }
}

/// Print a minimap error envelope to stdout (used on panic).
pub fn emit_error(msg: String) {
    let out = MinimapOutput {
        errors: vec![msg],
        ..Default::default()
    };
    println!("{}", serde_json::to_string(&out).unwrap_or_default());
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::assetencode::{map_source_hash, sha256_hex};
    use std::cell::Cell;

    /// A map archive's own versioned name, which is what `asset_in_session`
    /// resolves and hands the encoder.
    const ARCHIVE: &str = "Mediterraneum V1";

    fn temp_dir(tag: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("coilbox-minimap-test-{}-{tag}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        dir
    }

    /// An RGB565 texture with the shape a minimap has: large smooth regions a
    /// lossy pass reproduces well, and hard coastlines it has to work at.
    fn texture(side: u32) -> Vec<u16> {
        (0..side * side)
            .map(|i| {
                let (x, y) = (i % side, i / side);
                // Land in blocks tens of pixels across, the scale terrain comes
                // in on a minimap, rather than per-pixel noise no map has.
                let land = ((x / 37) * 7 + (y / 41) * 13) % 5 > 1;
                if land {
                    let r = (x * 31 / side.max(1)) as u16;
                    let g = 20 + (y * 20 / side.max(1)) as u16;
                    (r << 11) | (g << 5) | 4
                } else {
                    // Water: near-constant deep blue, the easiest thing to encode.
                    2 << 11 | (6 << 5) | 21
                }
            })
            .collect()
    }

    /// Mean absolute channel error between the stored asset and the texture that
    /// went in, in 0..255 units. The class is lossy, so the test is that the
    /// picture is the map rather than that the bytes match.
    fn channel_error(decoded: &[u8], pixels: &[u16]) -> f64 {
        let want = expand_rgb565(pixels);
        assert_eq!(decoded.len(), want.len());
        let total: u64 = decoded
            .iter()
            .zip(&want)
            .map(|(a, b)| u64::from(a.abs_diff(*b)))
            .sum();
        total as f64 / want.len() as f64
    }

    /// The size the hub takes, checked against the vocabulary rather than
    /// against the shift arithmetic on its own. Mip 1 is only the right level
    /// because it lands on the class's edge cap.
    #[test]
    fn the_asset_mip_is_the_size_the_hub_caps_a_minimap_at() {
        assert_eq!(mip_side(ASSET_MINIMAP_MIP), 512);
        let class = coilbox_assets::class_for_variant(MINIMAP_VARIANT).expect("minimap class");
        assert_eq!(class.max_edge_px, Some(mip_side(ASSET_MINIMAP_MIP)));
        // And it is neither of the sizes coilbox itself draws.
        assert_eq!(mip_side(0), 1024);
        assert_eq!(mip_side(3), 128);
    }

    #[test]
    fn writes_the_asset_as_a_file_named_after_its_own_bytes() {
        let dir = temp_dir("asset-write");
        let asset = encode_asset(&dir, &texture(512), 512, ARCHIVE).expect("encode");
        let on_disk = std::fs::read(&asset.path).expect("asset file written");

        assert_eq!(
            asset.path,
            dir.join(format!("{}.webp", asset.hash)).to_string_lossy()
        );
        assert_eq!(asset.hash, sha256_hex(&on_disk));
        assert_eq!(asset.bytes, on_disk.len() as u64);
        assert_eq!(asset.mime, "image/webp");
        assert_eq!(asset.encode_profile, "webp-q80-512");
        assert_eq!(asset.variant, "minimap");
        assert_eq!((asset.width, asset.height), (512, 512));
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// The stored bytes are the map, not noise, and they really did lose
    /// something: this is the one map class that is lossy, so an exact round trip
    /// would mean the profile was not applied.
    #[test]
    fn the_stored_asset_is_the_map_and_is_lossy() {
        let dir = temp_dir("asset-roundtrip");
        let pixels = texture(512);
        let asset = encode_asset(&dir, &pixels, 512, ARCHIVE).expect("encode");

        let on_disk = std::fs::read(&asset.path).expect("asset file written");
        let decoded = webp::Decoder::new(&on_disk).decode().expect("decode webp");
        assert_eq!((decoded.width(), decoded.height()), (512, 512));
        assert!(
            !decoded.is_alpha(),
            "an opaque texture gained a alpha plane"
        );

        let error = channel_error(&decoded, &pixels);
        assert!(error < 8.0, "stored picture is not the map: error {error}");
        assert!(error > 0.0, "q80 was exact, so nothing lossy happened");
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// The square texture is stored as unitsync produced it. The map's real
    /// proportions ride beside it as elmos, and cropping to them here would
    /// throw away samples for a presentation choice the consumer makes.
    #[test]
    fn stores_the_square_texture_rather_than_the_maps_shape() {
        let dir = temp_dir("asset-square");
        let asset = encode_asset(&dir, &texture(512), 512, ARCHIVE).expect("encode");
        assert_eq!(asset.width, asset.height);
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// The have check compares on `source_hash`, so it has to be the texture and
    /// not the encode. Hashing the WebP there would report every map as changed
    /// the first time libwebp moved.
    #[test]
    fn identity_is_the_texture_and_the_path_is_the_encoded_bytes() {
        let dir = temp_dir("asset-hashes");
        let pixels = texture(512);
        let asset = encode_asset(&dir, &pixels, 512, ARCHIVE).expect("encode");
        assert_eq!(
            asset.source_hash,
            map_source_hash(MINIMAP_VARIANT, 512, 512, &source_bytes(&pixels))
        );
        assert_ne!(asset.source_hash, asset.hash);
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// `source_hash` has to be the same on every architecture coilbox builds
    /// for, so the words are serialised rather than reinterpreted.
    #[test]
    fn hashes_the_texture_in_a_fixed_byte_order() {
        assert_eq!(
            source_bytes(&[0x0000, 0x1234, 0xffff]),
            vec![0x00, 0x00, 0x34, 0x12, 0xff, 0xff]
        );
    }

    /// The mip is part of the identity twice over now: the texture differs, and
    /// since #1660 the side it was read at is in the frame as well, so the level
    /// is stated rather than left to be inferred from the word count.
    #[test]
    fn the_same_map_at_another_mip_is_a_different_identity() {
        let side_one = mip_side(ASSET_MINIMAP_MIP);
        let side_zero = mip_side(0);
        let one = map_source_hash(
            MINIMAP_VARIANT,
            side_one,
            side_one,
            &source_bytes(&texture(side_one)),
        );
        let zero = map_source_hash(
            MINIMAP_VARIANT,
            side_zero,
            side_zero,
            &source_bytes(&texture(side_zero)),
        );
        assert_ne!(one, zero);

        // And the same words at two sides are two identities, which the word
        // count alone could not say.
        let flat = source_bytes(&vec![0u16; 64 * 64]);
        assert_ne!(
            map_source_hash(MINIMAP_VARIANT, 64, 64, &flat),
            map_source_hash(MINIMAP_VARIANT, 32, 128, &flat)
        );
    }

    /// The variant is the hub's own string and the vocabulary holds the list, so
    /// a typo here would be an upload the hub refuses rather than a build error.
    #[test]
    fn names_a_variant_the_hub_stores() {
        assert!(coilbox_assets::vocabulary()
            .map_variants
            .iter()
            .any(|v| v == MINIMAP_VARIANT));
    }

    /// The asset is square and the map is not, so what the consumer needs to
    /// stretch it back is in the same output rather than a second call away
    /// (issue #1629).
    #[test]
    fn the_size_in_elmos_travels_in_the_same_output_as_the_asset() {
        let dir = temp_dir("asset-elmos");
        let out = MinimapOutput {
            width_elmos: Some(8192),
            height_elmos: Some(6144),
            asset: Some(encode_asset(&dir, &texture(512), 512, ARCHIVE).expect("encode")),
            ..Default::default()
        };
        let json: serde_json::Value = serde_json::to_value(&out).expect("serialize");
        assert_eq!(json["widthElmos"], 8192);
        assert_eq!(json["heightElmos"], 6144);
        assert_eq!(json["asset"]["variant"], "minimap");
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// The display PNG and the asset expand the same words the same way, so a
    /// map cannot come out one colour on the page and another in the hub.
    #[test]
    fn the_picture_and_the_asset_expand_the_texture_the_same_way() {
        let pixels = texture(8);
        let png = pixels_to_png(&pixels, 8).expect("encode");
        let decoded = image::load_from_memory(&png).expect("decode").to_rgb8();
        assert_eq!(decoded.as_raw().as_slice(), expand_rgb565(&pixels));
    }

    /// Issue #1658: Hex Farm 8's minimap comes back entirely black, and one
    /// black square in the hub outranks the placeholder a consumer would draw
    /// from the map's name.
    #[test]
    fn a_texture_of_one_colour_is_skipped_rather_than_stored() {
        let dir = temp_dir("asset-blank");
        let black = vec![0u16; 512 * 512];
        let (asset, skipped) = asset_from_pixels(&dir, Some(&black), ARCHIVE);
        assert!(asset.is_none());
        assert_eq!(skipped, Some(MapOverlaySkip::Blank));
        assert!(!dir.exists(), "wrote a blank square as a map's picture");

        // Not a darkness test: a map that is all one colour of anything is the
        // same non-picture, and a map with any variation in it is a picture.
        let white = vec![0xffffu16; 64];
        assert_eq!(
            asset_from_pixels(&dir, Some(&white), ARCHIVE).1,
            Some(MapOverlaySkip::Blank)
        );
        assert!(is_blank(&[]));
        assert!(!is_blank(&[0, 0, 1]));
    }

    /// A dark map is still a map. The check has to survive one that a
    /// brightness threshold would have thrown away.
    #[test]
    fn a_dark_texture_with_detail_in_it_is_still_stored() {
        let dir = temp_dir("asset-dark");
        let night: Vec<u16> = (0..512 * 512).map(|i| u16::from(i % 3 == 0)).collect();
        assert!(!is_blank(&night));
        let (asset, skipped) = asset_from_pixels(&dir, Some(&night), ARCHIVE);
        assert!(skipped.is_none());
        assert_eq!(asset.expect("asset").variant, "minimap");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_map_with_no_texture_at_all_says_so() {
        let dir = temp_dir("asset-nosource");
        let (asset, skipped) = asset_from_pixels(&dir, None, ARCHIVE);
        assert!(asset.is_none());
        assert_eq!(skipped, Some(MapOverlaySkip::NoSource));
    }

    #[test]
    fn cached_dims_computes_once_then_serves_the_cache() {
        let dir = temp_dir("dims-hit");
        let file = dims_file(Some(dir.as_path()), Some("abc"));
        let calls = Cell::new(0);
        let compute = || {
            calls.set(calls.get() + 1);
            Some((384, 256))
        };

        assert_eq!(cached_dims(file.clone(), compute), Some((384, 256)));
        assert_eq!(calls.get(), 1);

        // Second read must not run the expensive call again.
        assert_eq!(cached_dims(file, compute), Some((384, 256)));
        assert_eq!(calls.get(), 1);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn cached_dims_recomputes_when_there_is_no_cache_file() {
        let calls = Cell::new(0);
        let compute = || {
            calls.set(calls.get() + 1);
            Some((512, 512))
        };
        assert_eq!(cached_dims(None, compute), Some((512, 512)));
        assert_eq!(cached_dims(None, compute), Some((512, 512)));
        assert_eq!(calls.get(), 2);
    }

    #[test]
    fn cached_dims_recomputes_when_the_entry_is_unreadable() {
        let dir = temp_dir("dims-corrupt");
        let file = dims_file(Some(dir.as_path()), Some("abc")).expect("cache file");
        std::fs::create_dir_all(&dir).expect("create cache dir");
        std::fs::write(&file, b"not json").expect("write corrupt entry");

        let calls = Cell::new(0);
        let got = cached_dims(Some(file), || {
            calls.set(calls.get() + 1);
            Some((128, 64))
        });
        assert_eq!(got, Some((128, 64)));
        assert_eq!(calls.get(), 1);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_map_without_dimensions_is_not_cached() {
        let dir = temp_dir("dims-none");
        let file = dims_file(Some(dir.as_path()), Some("abc")).expect("cache file");
        assert_eq!(cached_dims(Some(file.clone()), || None), None);
        assert!(!file.exists(), "a failed read must not be cached");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn dims_and_png_cache_files_never_collide() {
        let dir = temp_dir("dims-collide");
        let png = cache_file(Some(dir.as_path()), Some("abc"), 3);
        let dims = dims_file(Some(dir.as_path()), Some("abc"));
        assert_ne!(png, dims);
    }

    /// The proportions the cache holds are metal infomap samples, and the size
    /// carried beside the minimap is elmos, so this is where the two are told
    /// apart (issue #1629). Comet Catcher Remake 1.8 is 512 by 384 samples on
    /// this machine's library, and BAR publishes it as 16 by 12, which is
    /// 8192 by 6144 elmos.
    #[test]
    fn a_maps_size_in_elmos_comes_off_its_cached_metal_samples() {
        assert_eq!(dims_elmos(Some((512, 384))), (Some(8192), Some(6144)));
    }

    #[test]
    fn a_map_with_no_proportions_reports_no_size() {
        assert_eq!(dims_elmos(None), (None, None));
    }

    /// The picture budget is a suffix, so a minimap that stopped being named
    /// one would quietly stop being bounded (issue #1550), and the proportions
    /// beside it must stay out of a budget measured in pictures.
    #[test]
    fn the_picture_sweep_covers_a_minimap_and_not_its_proportions() {
        let dir = temp_dir("sweep-scope");
        let png = cache_file(Some(dir.as_path()), Some("abc"), 3).expect("cache file");
        let dims = dims_file(Some(dir.as_path()), Some("abc")).expect("dims file");
        assert!(png.to_string_lossy().ends_with(PICTURE_SUFFIX));
        assert!(!dims.to_string_lossy().ends_with(PICTURE_SUFFIX));
    }
}
