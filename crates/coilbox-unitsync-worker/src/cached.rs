//! Answers read straight off disk, with no unitsync and no worker (issue #3714).
//!
//! The worker writes an entry the first time it reads an archive. Everything here
//! finds that entry again from what the caller already knows about the archive,
//! so the plugin can answer a repeat read itself. The key is built by
//! [`crate::cachekey`], the same code the worker writes it with.
//!
//! Each function answers `None` for anything short of a whole, current answer: no
//! key, no entry, an entry that does not parse, an entry a newer or older build
//! wrote, or a file the entry points at that has gone. `None` is always safe, it
//! only sends the caller to a worker, which reads the archive and writes the
//! entry again.
//!
//! The archive is always statted here, never described by the caller. An archive
//! changed since the entry was written has a different size or time, so a
//! different key, so no entry: it cannot be answered from the old one.

use crate::cachekey::{self, ArchiveStamp};
use crate::model::{
    FactionLogoEntry, FactionLogosOutput, HeightWindow, HeightmapOutput, MapAppearance,
    MinimapOutput, StartPos, UnitBuildpicsOutput, UnitDisplay, UnitModelFile, UnitModelsOutput,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

/// A cached info blob, exactly as the worker wrote it. Anything that is not a
/// JSON object is not an answer.
///
/// Handed back as JSON rather than as the type it was written from, because the
/// plugin passes it straight on to the page and a round trip through the type
/// could only lose what the type does not name.
pub fn info_blob(dir: &Path, key: &str) -> Option<Value> {
    let raw = std::fs::read(dir.join(format!("{key}.json"))).ok()?;
    let value: Value = serde_json::from_slice(&raw).ok()?;
    value.is_object().then_some(value)
}

/// A game's info (its sides, unit count and sync checksum). `archive` is the
/// game's primary archive, as a path.
pub fn game_info(dir: &Path, archive: &Path) -> Option<Value> {
    let stamp = ArchiveStamp::of(archive)?;
    info_blob(dir, &cachekey::game_key(&stamp))
}

/// A game's unit dataset.
pub fn unit_dataset(dir: &Path, archive: &Path) -> Option<Value> {
    let stamp = ArchiveStamp::of(archive)?;
    info_blob(dir, &cachekey::dataset_key(&stamp))
}

/// A map's options and checksum.
///
/// `archive` is the map's own archive where its path resolved when the library
/// was scanned, which is almost never. `file_name` is the map file inside it, as
/// the scan reported it, and is what the usual name based key is made from.
pub fn map_info(
    dir: &Path,
    map_name: &str,
    archive: Option<&Path>,
    file_name: Option<&str>,
) -> Option<Value> {
    let key = cachekey::map_info_key(
        archive.and_then(ArchiveStamp::of).as_ref(),
        map_name,
        file_name,
    )?;
    info_blob(dir, &key)
}

/// The skirmish AIs available against an engine and, when one is named, a game.
/// `game` is that game's archive. The caller has no answer to look for when a
/// game is named and its archive is not known.
pub fn skirmish_ais(dir: &Path, engine_lib: &Path, game: Option<&Path>) -> Option<Value> {
    let engine = ArchiveStamp::of(engine_lib)?;
    let game = match game {
        Some(path) => Some(ArchiveStamp::of(path)?),
        None => None,
    };
    info_blob(dir, &cachekey::skirmish_key(&engine, game.as_ref()))
}

// ---- unit models

/// Bump when [`ModelEntry`] changes shape, so a record from an older build is
/// read again instead of returning an old answer.
pub const ENTRY_VERSION: u32 = 1;

/// What a unit's model came to, stored under the game's cache key (issue
/// #3724).
///
/// The model is written as JSON named after the archive member it came from, and
/// that name is only known once the archive is open. This is the lookup from the
/// unit's `objectname` to it, so a second read finds the file without mounting
/// anything. It also lists the texture files the model names, because a model
/// whose texture was swept away would draw bare, and a hit checks they are all
/// still there.
///
/// Named `.entry` beside the files it describes, under the same
/// `v<MODEL_CACHE_VERSION>-<key>_` prefix, so the startup sweep that removes a dead
/// key (`modelcache.rs`) removes these with it.
#[derive(Serialize, Deserialize)]
pub struct ModelEntry {
    pub version: u32,
    /// The `objectname` this answers, trimmed and lower case. Two names that
    /// sanitise to one file name are told apart by it.
    pub object: String,
    pub file: String,
    pub path: String,
    pub format: String,
    pub textures: Vec<String>,
}

pub fn entry_object(object: &str) -> String {
    object.trim().to_lowercase()
}

pub fn entry_file(base: &str, object: &str) -> String {
    cache_file_name(base, &format!("entry/{}", entry_object(object)), "entry")
}

/// The stored entry for `object`, if every file it names is still on disk.
pub fn read_model_entry(cache_dir: &Path, base: &str, object: &str) -> Option<ModelEntry> {
    let raw = std::fs::read(cache_dir.join(entry_file(base, object))).ok()?;
    let entry: ModelEntry = serde_json::from_slice(&raw).ok()?;
    let held = entry.version == ENTRY_VERSION
        && entry.object == entry_object(object)
        && std::iter::once(&entry.file)
            .chain(&entry.textures)
            .all(|file| cache_dir.join(file).is_file());
    held.then_some(entry)
}

/// The cache file for one archive member:
/// `v<MODEL_CACHE_VERSION>-<gamekey>_<sanitised path>.<ext>`. One flat segment,
/// because the asset protocol's root for these serves a single folder. The
/// extension is the one the file is written in, which is not the source's when
/// it was transcoded, so the webview can pick a loader from it and the asset
/// protocol can put a content type on it.
///
/// Every extension `to_webview_format` in the binary re-encodes is listed here. A file
/// written as PNG under its source's name is served as an octet stream, and a
/// webview that sniffs it anyway is doing us a favour rather than being asked.
///
/// The extension the archive gives is the artist's own case, and 1086 of the
/// installed games' 1680 `.bmp` textures are spelled `.BMP`. Every one of those
/// was written through raw while its lower-case neighbour was re-encoded, so the
/// name is settled in lower case before anything is decided from it.
///
/// The `v<MODEL_CACHE_VERSION>-` prefix is spelled out in the clear rather than left
/// folded into `base`'s hash, so the startup sweep (issue #1919) can tell a
/// current file from an orphan by string comparison alone, with no archive to
/// open and no hash to recompute.
pub fn cache_file_name(base: &str, member: &str, source_ext: &str) -> String {
    let lower = member.to_lowercase();
    let source_ext = source_ext.to_lowercase();
    // `source_ext` comes from `rsplit_once('.')` on the archive member's own
    // path, which can never hold a dot but can hold a `/`, `\` or `:`: a slash
    // sends the write to a directory that does not exist, and a colon fails
    // outright on Windows and picks an NTFS alternate data stream elsewhere.
    // Sanitised the same way `safe` below sanitises the stem.
    let ext = if !source_ext.is_empty() && source_ext.chars().all(|c| c.is_ascii_alphanumeric()) {
        match source_ext.as_str() {
            "bmp" | "tga" | "tif" | "tiff" | "pcx" => "png".to_string(),
            other => other.to_string(),
        }
    } else {
        "bin".to_string()
    };
    let safe: String = lower
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '_' })
        .collect();
    format!("v{}-{base}_{safe}.{ext}", cachekey::MODEL_CACHE_VERSION)
}

/// Every model in `objects`, as the worker would answer them, when each one has an
/// entry under `game_archive`'s key (issue #3714).
///
/// All or nothing. A request with one object the cache does not hold goes to a
/// worker whole, and the worker answers the ones it holds from disk itself and
/// reads only the rest.
pub fn unit_models(
    dir: &Path,
    game_archive: &Path,
    objects: &[String],
) -> Option<UnitModelsOutput> {
    let base = cachekey::model_key(&ArchiveStamp::of(game_archive)?);
    let mut models = BTreeMap::new();
    for object in objects {
        let entry = read_model_entry(dir, &base, object)?;
        models.insert(
            object.clone(),
            UnitModelFile {
                file: entry.file,
                path: entry.path,
                format: entry.format,
            },
        );
    }
    Some(UnitModelsOutput {
        models,
        ..Default::default()
    })
}

// ---- build icons

/// A unit's build icon record stem: `<gamekey>_<sanitized-unit>`.
pub fn unit_stem(base: &str, unit: &str) -> String {
    let safe: String = unit
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '_' })
        .collect();
    format!("{base}_{safe}")
}

/// A unit's cached build icon record. `Some(display)` = resolved (the display may
/// be empty, i.e. "resolved to nothing", still a hit that skips the mount). `None`
/// = cache miss. Present but unparseable files are treated as misses.
pub fn read_buildpic_record(dir: &Path, base: &str, unit: &str) -> Option<UnitDisplay> {
    let path = dir.join(format!("{}.json", unit_stem(base, unit)));
    let raw = std::fs::read_to_string(path).ok()?;
    serde_json::from_str(&raw).ok()
}

/// Whether the icon file a cached record names is still on disk. A cache clean
/// removes the PNG and leaves the record, and a hit on that record would draw a
/// broken picture, so it has to re-resolve. A record naming no file (nothing
/// resolved, or the icon is inline) has nothing to miss.
pub fn icon_file_present(display: &UnitDisplay, dir: &Path) -> bool {
    display
        .icon_file
        .as_ref()
        .is_none_or(|name| dir.join(name).exists())
}

/// The build icons for `units` in `game_archive` when every one has a record and
/// its icon file, as the worker answers them without `--asset-dir`. Units that
/// resolved to nothing are left out of the answer, exactly as the worker leaves
/// them out.
pub fn unit_buildpics(
    dir: &Path,
    game_archive: &Path,
    units: &[String],
) -> Option<UnitBuildpicsOutput> {
    let base = cachekey::buildpic_key(&ArchiveStamp::of(game_archive)?);
    let mut resolved = BTreeMap::new();
    for unit in units {
        let display = read_buildpic_record(dir, &base, unit)?;
        if !icon_file_present(&display, dir) {
            return None;
        }
        if !display.is_empty() {
            resolved.insert(unit.clone(), display);
        }
    }
    Some(UnitBuildpicsOutput {
        units: resolved,
        errors: Vec::new(),
    })
}

// ---- faction logos

/// A cached per-side faction logo record. Neither picture set means "resolved to
/// nothing", a hit that still skips the mount (mirrors the build-pic cache's empty
/// records). `file` is the normal answer and `data_uri` the fallback for a side
/// whose PNG had nowhere to go, so the two are never both set.
#[derive(Serialize, Deserialize, Default)]
pub struct CachedLogo {
    #[serde(default)]
    pub file: Option<String>,
    #[serde(default)]
    pub data_uri: Option<String>,
    pub max_dim: u32,
}

/// Per-side cache file stem: `<gamekey>_<sanitized-side>`.
pub fn side_stem(base: &str, side: &str) -> String {
    let safe: String = side
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '_' })
        .collect();
    format!("{base}_{safe}")
}

/// A side's emblem file name: its cache record's stem, as a PNG.
pub fn logo_file_name(base: &str, side: &str) -> String {
    format!("{}.png", side_stem(base, side))
}

/// Read a side's cached record. `Some` = resolved (may be empty = "nothing here",
/// still a hit). `None` = miss. Unparseable files are treated as misses.
pub fn read_logo_record(dir: &Path, base: &str, side: &str) -> Option<CachedLogo> {
    let path = dir.join(format!("{}.json", side_stem(base, side)));
    let raw = std::fs::read_to_string(path).ok()?;
    serde_json::from_str(&raw).ok()
}

/// Whether the PNG a cached record names is still on disk. A cache clean removes
/// the picture and leaves the record, and a hit on that record would draw a broken
/// emblem, so it has to re-resolve.
pub fn logo_file_present(cached: &CachedLogo, dir: &Path) -> bool {
    cached
        .file
        .as_ref()
        .is_none_or(|name| dir.join(name).exists())
}

/// Append a resolved record to the output, skipping empty ones (the UI then falls
/// through to its curated/bundled layers for that side).
pub fn push_logo(out: &mut Vec<FactionLogoEntry>, side: &str, cached: CachedLogo) {
    if cached.file.is_none() && cached.data_uri.is_none() {
        return;
    }
    out.push(FactionLogoEntry {
        side: side.to_string(),
        file: cached.file,
        data_uri: cached.data_uri,
        max_dim: cached.max_dim,
    });
}

/// The faction logos for `sides` in `game_archive` when every side has a record
/// and its picture.
pub fn faction_logos(
    dir: &Path,
    game_archive: &Path,
    sides: &[String],
) -> Option<FactionLogosOutput> {
    let base = cachekey::faction_logo_key(&ArchiveStamp::of(game_archive)?);
    let mut logos = Vec::new();
    for side in sides {
        let cached = read_logo_record(dir, &base, side)?;
        if !logo_file_present(&cached, dir) {
            return None;
        }
        push_logo(&mut logos, side, cached);
    }
    Some(FactionLogosOutput {
        logos,
        errors: Vec::new(),
    })
}

// ---- minimaps and heightmaps

/// The side of the square texture unitsync returns at `mip`, which is what
/// `GetMinimap` fills and how many words come back with it.
pub fn mip_side(mip: i32) -> u32 {
    1024u32 >> mip.clamp(0, 10) as u32
}

/// A map's minimap picture: `<cache_dir>/<key>-<mip>.png`.
pub fn minimap_file(dir: &Path, key: &str, mip: i32) -> PathBuf {
    dir.join(format!("{key}-{mip}.png"))
}

/// A map's proportions, cached beside its minimap PNG.
#[derive(Serialize, Deserialize)]
pub struct CachedDims {
    pub width: u32,
    pub height: u32,
}

/// A map's proportions: `<cache_dir>/<key>-dims.json`. Unlike the PNG this is
/// mip-independent, because proportions don't vary with mip level.
pub fn dims_file(dir: &Path, key: &str) -> PathBuf {
    dir.join(format!("{key}-dims.json"))
}

/// A map's size in elmos, from the same cached proportions the display path
/// uses (issue #1629).
///
/// Kept as a derivation rather than another cached field so the two can never
/// disagree, and so every `<key>-dims.json` already on disk answers this without
/// a rescan. What is cached is metal infomap samples, and
/// [`coilbox_assets::map_extent_elmos`] carries which of the map's several
/// sample counts that is and what one of them is worth.
pub fn dims_elmos(dims: Option<(u32, u32)>) -> (Option<u32>, Option<u32>) {
    match dims {
        Some((w, h)) => {
            let (width, height) = coilbox_assets::map_extent_elmos(w, h);
            (Some(width), Some(height))
        }
        None => (None, None),
    }
}

/// Bump when [`CachedDetail`] changes shape or the way it is read changes, so a
/// record from an older build is read again instead of returning an old answer.
pub const DETAIL_VERSION: u32 = 1;

/// Everything a map's page asks for beside its picture, stored under the same
/// key (issue #3724).
///
/// The picture alone was cached, so every call still opened the map's archive to
/// parse `mapinfo.lua` for these. Holding them with it makes a hit the whole
/// answer, readable without unitsync, which is what lets the plugin answer from
/// the cache with no worker at all (issue #3714).
///
/// The size is elmos, derived from the same cached proportions as the
/// thumbnails, and is mip independent like they are.
#[derive(Serialize, Deserialize)]
pub struct CachedDetail {
    pub version: u32,
    pub width_elmos: Option<u32>,
    pub height_elmos: Option<u32>,
    pub start_positions: Vec<StartPos>,
    pub wind: Option<(f32, f32)>,
    pub tidal: Option<f32>,
    pub appearance: MapAppearance,
}

impl CachedDetail {
    /// The minimap answer this detail makes up, less the picture and the hub
    /// asset, which the caller adds.
    pub fn into_output(self) -> MinimapOutput {
        let (min_wind, max_wind) = match self.wind {
            Some((mn, mx)) => (Some(mn), Some(mx)),
            None => (None, None),
        };
        let app = self.appearance;
        MinimapOutput {
            width_elmos: self.width_elmos,
            height_elmos: self.height_elmos,
            start_positions: self.start_positions,
            min_wind,
            max_wind,
            tidal_strength: self.tidal,
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
        }
    }
}

/// A map's detail: `<cache_dir>/<key>-detail.json`. Not a picture, so the sweep
/// of rendered pictures leaves it alone.
pub fn detail_file(dir: &Path, key: &str) -> PathBuf {
    dir.join(format!("{key}-detail.json"))
}

/// A stored detail, or `None` when there is none, it does not parse, or it was
/// written by another version.
pub fn read_detail(file: &Path) -> Option<CachedDetail> {
    let detail: CachedDetail = serde_json::from_slice(&std::fs::read(file).ok()?).ok()?;
    (detail.version == DETAIL_VERSION).then_some(detail)
}

/// Whether `file` is a picture on disk, marking it used so the sweep that bounds
/// the thumbnail cache counts a hit as a use and not only a write.
fn picture_held(file: &Path) -> bool {
    let held = std::fs::metadata(file).is_ok_and(|m| m.is_file());
    if held {
        coilbox_thumb_cache::touch(file);
    }
    held
}

/// A map's minimap at `mip`, with everything that goes with it, when its picture
/// and its detail are both held under `key`.
///
/// `key` comes from [`cachekey::thumb_key`]. Both or neither: a picture without
/// its detail would be an answer with the start positions missing.
pub fn minimap(dir: &Path, key: &str, mip: i32) -> Option<MinimapOutput> {
    let detail = read_detail(&detail_file(dir, key))?;
    let picture = minimap_file(dir, key, mip);
    if !picture_held(&picture) {
        return None;
    }
    Some(MinimapOutput {
        file: picture
            .file_name()
            .map(|n| n.to_string_lossy().into_owned()),
        side: Some(mip_side(mip)),
        ..detail.into_output()
    })
}

/// The one variant the height picture is, and the one the generic encoder
/// refuses. Spelled once so the row's `variant` and the class the bytes were
/// encoded to cannot come apart.
pub const HEIGHT_OVERLAY_VARIANT: &str = "overlay:height";

/// The longest edge a height picture may have, which the shared vocabulary
/// decides rather than the caller. It is in the cache file's name so a change to
/// it retires every picture already on disk instead of serving a mixture.
pub fn picture_edge() -> u32 {
    coilbox_assets::class_for_variant(HEIGHT_OVERLAY_VARIANT)
        .and_then(|class| class.max_edge_px)
        .unwrap_or(0)
}

/// A height picture: `<cache_dir>/<key>-h<edge>.webp`. The `h` keeps it from
/// colliding with the minimap cache (`<key>-<mip>`).
pub fn height_picture_file(dir: &Path, key: &str) -> PathBuf {
    dir.join(format!("{key}-h{}.webp", picture_edge()))
}

/// The window that picture is drawn in: `<cache_dir>/<key>-h<edge>.win.json`,
/// beside it the way the minimap's proportions sit beside the minimap.
///
/// A separate file rather than a field in the picture because the picture is
/// handed to the webview as an image over the asset protocol, so anything it
/// carries has to be pixels.
pub fn height_window_file(dir: &Path, key: &str) -> PathBuf {
    dir.join(format!("{key}-h{}.win.json", picture_edge()))
}

/// The window a cached picture is drawn in, stored beside it.
#[derive(Serialize, Deserialize)]
pub struct CachedWindow {
    pub low: u16,
    pub high: u16,
}

/// Bump when [`CachedMeta`] changes shape or the way it is read changes, so a
/// record from an older build is read again instead of returning an old answer.
pub const META_VERSION: u32 = 1;

/// The grid and the world heights a height picture is stored with (issue #3724).
///
/// Read off the map's archive with the picture and kept under the same key, so a
/// hit is the whole answer and needs no unitsync. The window the picture is drawn
/// in is the file beside it, [`CachedWindow`].
#[derive(Serialize, Deserialize)]
pub struct CachedMeta {
    pub version: u32,
    pub width: u32,
    pub height: u32,
    pub min_height: f32,
    pub max_height: f32,
}

/// A height picture's grid and bounds: `<cache_dir>/<key>-h<edge>.meta.json`. Not
/// a picture, so the sweep leaves it alone, like the window.
pub fn height_meta_file(dir: &Path, key: &str) -> PathBuf {
    dir.join(format!("{key}-h{}.meta.json", picture_edge()))
}

/// A stored record, or `None` when there is none, it does not parse, or it was
/// written by another version.
pub fn read_meta(file: &Path) -> Option<CachedMeta> {
    let meta: CachedMeta = serde_json::from_slice(&std::fs::read(file).ok()?).ok()?;
    (meta.version == META_VERSION).then_some(meta)
}

/// A map's height picture with the grid and world heights that turn it back into
/// terrain, when the picture, its window and its record are all held under `key`.
pub fn heightmap(dir: &Path, key: &str) -> Option<HeightmapOutput> {
    let meta = read_meta(&height_meta_file(dir, key))?;
    let window: CachedWindow =
        serde_json::from_slice(&std::fs::read(height_window_file(dir, key)).ok()?).ok()?;
    let picture = height_picture_file(dir, key);
    if !picture_held(&picture) {
        return None;
    }
    let window = HeightWindow {
        low: window.low,
        high: window.high,
    };
    let (picture_min, picture_max) = window.elmos(meta.min_height, meta.max_height);
    Some(HeightmapOutput {
        file: picture
            .file_name()
            .map(|n| n.to_string_lossy().into_owned()),
        width: Some(meta.width),
        height: Some(meta.height),
        min_height: Some(meta.min_height),
        max_height: Some(meta.max_height),
        picture_min_height: Some(picture_min),
        picture_max_height: Some(picture_max),
        ..Default::default()
    })
}

/// The thumbnail cache key for a map the caller names by what the scan knows of
/// it: its own archive's path where that resolved, and its map file's name.
pub fn thumb_key_for(
    map_name: &str,
    archive: Option<&Path>,
    file_name: Option<&str>,
) -> Option<String> {
    cachekey::thumb_key(
        archive.and_then(ArchiveStamp::of).as_ref(),
        map_name,
        file_name,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(tag: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("coilbox-cached-{}-{tag}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("temp dir");
        dir
    }

    fn write_blob(dir: &Path, key: &str, json: &str) {
        std::fs::write(dir.join(format!("{key}.json")), json).expect("write blob");
    }

    #[test]
    fn an_entry_under_the_archives_key_is_found() {
        let dir = temp_dir("game-hit");
        let archive = dir.join("game.sdz");
        std::fs::write(&archive, b"a game").expect("archive");
        let stamp = ArchiveStamp::of(&archive).expect("stamp");
        write_blob(
            &dir,
            &cachekey::game_key(&stamp),
            r#"{"sides":[],"checksum":"ab"}"#,
        );

        let hit = game_info(&dir, &archive).expect("a hit");
        assert_eq!(hit["checksum"], "ab");
        assert!(unit_dataset(&dir, &archive).is_none(), "another namespace");
    }

    #[test]
    fn a_changed_archive_is_not_answered_from_the_old_entry() {
        let dir = temp_dir("changed");
        let archive = dir.join("game.sdz");
        std::fs::write(&archive, b"a game").expect("archive");
        let stamp = ArchiveStamp::of(&archive).expect("stamp");
        write_blob(&dir, &cachekey::game_key(&stamp), r#"{"checksum":"old"}"#);
        assert!(game_info(&dir, &archive).is_some());

        std::fs::write(&archive, b"a longer game archive").expect("rewrite");
        assert!(game_info(&dir, &archive).is_none());
    }

    #[test]
    fn a_missing_archive_has_no_answer() {
        let dir = temp_dir("missing");
        assert!(game_info(&dir, &dir.join("gone.sdz")).is_none());
    }

    #[test]
    fn a_blob_that_does_not_parse_is_a_miss() {
        let dir = temp_dir("corrupt");
        write_blob(&dir, "k", "{ not json");
        assert!(info_blob(&dir, "k").is_none());
        write_blob(&dir, "k", "[1,2]");
        assert!(info_blob(&dir, "k").is_none(), "an array is not an answer");
    }

    #[test]
    fn a_map_is_found_by_name_when_it_has_no_archive_path() {
        let dir = temp_dir("map-name");
        let key = cachekey::map_info_key(None, "Some Map 1.0", Some("maps/some.smf")).unwrap();
        write_blob(&dir, &key, r#"{"options":[],"checksum":"cd"}"#);

        let hit = map_info(&dir, "Some Map 1.0", None, Some("maps/some.smf")).expect("a hit");
        assert_eq!(hit["checksum"], "cd");
        assert!(map_info(&dir, "Some Map 1.0", None, None).is_none());
        assert!(map_info(&dir, "Some Map 1.1", None, Some("maps/some.smf")).is_none());
    }

    #[test]
    fn a_map_with_an_archive_path_that_is_gone_falls_back_to_its_name() {
        let dir = temp_dir("map-gone");
        let key = cachekey::map_info_key(None, "Some Map 1.0", Some("maps/some.smf")).unwrap();
        write_blob(&dir, &key, r#"{"checksum":"cd"}"#);

        let gone = dir.join("gone.sd7");
        assert!(map_info(&dir, "Some Map 1.0", Some(&gone), Some("maps/some.smf")).is_some());
    }

    #[test]
    fn a_skirmish_list_needs_the_engine_and_a_named_games_archive() {
        let dir = temp_dir("skirmish");
        let lib = dir.join("libunitsync.so");
        let game = dir.join("game.sdz");
        std::fs::write(&lib, b"engine").expect("lib");
        std::fs::write(&game, b"game").expect("game");
        let engine = ArchiveStamp::of(&lib).unwrap();
        let game_stamp = ArchiveStamp::of(&game).unwrap();
        write_blob(
            &dir,
            &cachekey::skirmish_key(&engine, None),
            r#"{"ais":[]}"#,
        );
        write_blob(
            &dir,
            &cachekey::skirmish_key(&engine, Some(&game_stamp)),
            r#"{"ais":[{"shortName":"x"}]}"#,
        );

        assert_eq!(
            skirmish_ais(&dir, &lib, None).unwrap()["ais"],
            serde_json::json!([])
        );
        assert_eq!(
            skirmish_ais(&dir, &lib, Some(&game)).unwrap()["ais"][0]["shortName"],
            "x"
        );
        assert!(skirmish_ais(&dir, &lib, Some(&dir.join("gone.sdz"))).is_none());
    }
}
