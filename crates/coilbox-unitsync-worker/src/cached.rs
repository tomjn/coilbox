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
use crate::matchsetup::{MatchFacts, MatchListEntry, MatchSetup};
use crate::model::{
    ArchiveFileEntry, ArchiveTreeOutput, FactionLogoEntry, FactionLogosOutput, GameHeaderItem,
    GameHeadersOutput, HeightWindow, HeightmapOutput, MapAppearance, MapMeta, MapMetaOutput,
    MapSkyboxOutput, MinimapOutput, StartPos, Thumbnail, ThumbnailsOutput, UnitBuildpicsOutput,
    UnitDisplay, UnitModelFile, UnitModelsOutput,
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

/// The unit list a game gives for one match's setup (issue #3847), when the
/// cache can say without running the game's definitions.
///
/// A setup read before is found under its own key. One not read before can
/// still be answered when the game's facts are kept and say the setup changes
/// nothing: it is then the empty setup's list, which every such replay of the
/// game shares, and which is the game's own unit dataset unless the engine
/// refuses one of its definitions.
pub fn match_unit_list(dir: &Path, archive: &Path, setup: &MatchSetup) -> Option<Value> {
    match_unit_list_at(dir, &ArchiveStamp::of(archive)?, setup)
}

/// [`match_unit_list`] for a stamp already in hand, which is how the worker
/// asks: it has the archive's stamp from unitsync.
pub fn match_unit_list_at(dir: &Path, stamp: &ArchiveStamp, setup: &MatchSetup) -> Option<Value> {
    if let Some(list) = match_list_entry(dir, stamp, setup) {
        return Some(list);
    }
    let facts: MatchFacts = info_blob(dir, &cachekey::match_facts_key(stamp))
        .and_then(|value| serde_json::from_value(value).ok())?;
    let reduced = setup.reduced(&facts);
    if reduced == *setup {
        return None;
    }
    match_list_entry(dir, stamp, &reduced)
}

/// What is kept under exactly this setup's key, with a pointer to the game's
/// unit dataset followed.
fn match_list_entry(dir: &Path, stamp: &ArchiveStamp, setup: &MatchSetup) -> Option<Value> {
    let key = cachekey::match_list_key(stamp, &setup.canonical());
    let entry: MatchListEntry<Value> = serde_json::from_value(info_blob(dir, &key)?).ok()?;
    match entry {
        MatchListEntry::SameAsDefault => info_blob(dir, &cachekey::dataset_key(stamp)),
        MatchListEntry::List { dataset } => dataset.is_object().then_some(dataset),
    }
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

/// The marker the worker leaves when it read a map cleanly and found no
/// proportions: `<cache_dir>/<key>-dims.none`. Without it that map looks like one
/// that has not been read yet, and would send every thumbnail call to a worker.
pub fn dims_none_file(dir: &Path, key: &str) -> PathBuf {
    dir.join(format!("{key}-dims.none"))
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

// ---- batch reads over a list the caller names (issue #3736)

/// One map of the last scan, as the caller names it: its name, and what the
/// map's cache key is made from.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MapRef {
    pub name: String,
    #[serde(default)]
    pub archive_path: Option<String>,
    #[serde(default)]
    pub file_name: Option<String>,
}

/// One game of the last scan: its display name, and its primary archive's path.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GameRef {
    pub name: String,
    pub archive_path: String,
}

/// A stored blob read as `T`, or `None` when there is none or it does not parse.
fn read_record<T: serde::de::DeserializeOwned>(dir: &Path, key: &str) -> Option<T> {
    serde_json::from_slice(&std::fs::read(dir.join(format!("{key}.json"))).ok()?).ok()
}

/// Every thumbnail in `maps` at `mip`, as `--thumbnails` answers them, when each
/// map has its picture and its proportions on disk.
///
/// All or nothing, like the reads above. The worker walks the whole library, so
/// a caller that names only some of it gets an answer for only those, which is
/// the right answer for a page that draws only those. A call with one map that
/// has no picture, or no proportions (the worker only records those when it can
/// read them), goes to a worker whole.
pub fn thumbnails(dir: &Path, mip: i32, maps: &[MapRef]) -> Option<ThumbnailsOutput> {
    if maps.is_empty() {
        return None;
    }
    let mut thumbnails = Vec::with_capacity(maps.len());
    for map in maps {
        let key = thumb_key_for(
            &map.name,
            map.archive_path.as_deref().map(Path::new),
            map.file_name.as_deref(),
        )?;
        let dims: Option<CachedDims> = match std::fs::read(dims_file(dir, &key)) {
            Ok(raw) => Some(serde_json::from_slice(&raw).ok()?),
            Err(_) if dims_none_file(dir, &key).exists() => None,
            Err(_) => return None,
        };
        let picture = minimap_file(dir, &key, mip);
        if !picture_held(&picture) {
            return None;
        }
        let dims = dims.map(|d| (d.width, d.height));
        let (width_elmos, height_elmos) = dims_elmos(dims);
        thumbnails.push(Thumbnail {
            name: map.name.clone(),
            file: picture
                .file_name()
                .map(|n| n.to_string_lossy().into_owned()),
            data_url: None,
            width: dims.map(|(w, _)| w),
            height: dims.map(|(_, h)| h),
            width_elmos,
            height_elmos,
        });
    }
    Some(ThumbnailsOutput {
        thumbnails,
        errors: Vec::new(),
    })
}

/// Every map's `mapinfo` metadata in `maps`, as `--map-meta` answers them, when
/// each has a saved record. The worker records one only when the read gave it
/// something, so a map that read empty sends the call to a worker whole.
pub fn map_metas(dir: &Path, maps: &[MapRef]) -> Option<MapMetaOutput> {
    if maps.is_empty() {
        return None;
    }
    let mut metas = Vec::with_capacity(maps.len());
    for map in maps {
        let key = cachekey::map_meta_key(
            map.archive_path
                .as_deref()
                .and_then(|p| ArchiveStamp::of(Path::new(p)))
                .as_ref(),
            &map.name,
            map.file_name.as_deref(),
        )?;
        let meta: MapMeta = read_record(dir, &key)?;
        if meta.name != map.name {
            return None;
        }
        metas.push(meta);
    }
    Some(MapMetaOutput {
        maps: metas,
        errors: Vec::new(),
    })
}

/// The state of one game's header art on disk.
#[derive(Debug)]
pub enum HeaderState {
    /// `<key>.jpg` exists. Carries its file name, which is what the webview
    /// appends to `coilbox://unitsyncheader/`.
    Hit(String),
    /// `<key>.none` exists, so the game has no usable art.
    Negative,
    /// Neither does, so the archive has to be opened to resolve it.
    Miss,
}

/// Look up the header cache for `key` under `dir`.
pub fn read_header_cache(dir: &Path, key: &str) -> HeaderState {
    let file = format!("{key}.jpg");
    if dir.join(&file).is_file() {
        return HeaderState::Hit(file);
    }
    if dir.join(format!("{key}.none")).exists() {
        return HeaderState::Negative;
    }
    HeaderState::Miss
}

/// Every game's header art in `games`, as `--game-headers` answers it, when each
/// has either its art or the marker for none.
///
/// The art a game has is the one the worker picked and saved. A game with no
/// `loadpicture` gets a random picture the first time it is read and keeps it,
/// so two fresh reads can differ and this returns the saved one.
pub fn game_headers(dir: &Path, games: &[GameRef]) -> Option<GameHeadersOutput> {
    if games.is_empty() {
        return None;
    }
    let mut headers = Vec::with_capacity(games.len());
    for game in games {
        let key = cachekey::header_key(&ArchiveStamp::of(Path::new(&game.archive_path))?);
        let file = match read_header_cache(dir, &key) {
            HeaderState::Hit(file) => Some(file),
            HeaderState::Negative => None,
            HeaderState::Miss => return None,
        };
        headers.push(GameHeaderItem {
            name: game.name.clone(),
            file,
            data_url: None,
        });
    }
    Some(GameHeadersOutput {
        headers,
        errors: Vec::new(),
    })
}

// ---- archive trees and map skyboxes

/// Bump when [`CachedTree`] changes shape or the way a tree is read changes.
pub const TREE_VERSION: u32 = 1;

/// Bump when [`CachedSkybox`] changes shape or the way a skybox is read changes.
pub const SKYBOX_VERSION: u32 = 1;

/// The archive a record was read from, as it was when it was read.
///
/// A name keyed record cannot tell from its key that the archive behind the name
/// was replaced, so the record carries the archive it came from and the plugin
/// stats that archive itself. A record whose archive has changed, or is gone, is
/// not an answer.
///
/// A file archive is its size and modified time. A directory archive (`.sdd`) is
/// walked, because its own modified time does not move when a file inside it is
/// edited, and a game or map being worked on is exactly that. Its `size` is the
/// bytes of every file in it, `entries` the number of files and folders, and
/// `mtime` the latest modified time of any of them, folders included, so an
/// edit, an addition, a removal and a rename each change one of the three. The
/// walk does not follow links.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Source {
    pub path: String,
    pub size: u64,
    pub mtime: u64,
    /// Files and folders in a directory archive. Zero for a file.
    #[serde(default)]
    pub entries: u64,
}

fn seconds(md: &std::fs::Metadata) -> u64 {
    md.modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map_or(0, |d| d.as_secs())
}

/// Add everything under `dir` to `source`, or `None` when something cannot be
/// read, since a walk that missed part of the archive would hold for the wrong
/// one.
fn walk(dir: &Path, source: &mut Source) -> Option<()> {
    for entry in std::fs::read_dir(dir).ok()? {
        let entry = entry.ok()?;
        let md = entry.metadata().ok()?;
        source.entries += 1;
        source.mtime = source.mtime.max(seconds(&md));
        if md.is_dir() {
            walk(&entry.path(), source)?;
        } else {
            source.size += md.len();
        }
    }
    Some(())
}

impl Source {
    /// The source of the archive at `path`: a file, or a directory archive.
    /// `None` for anything else, and for one that cannot be read.
    pub fn of(path: &Path) -> Option<Source> {
        let md = std::fs::metadata(path).ok()?;
        let mut source = Source {
            path: path.to_string_lossy().into_owned(),
            size: 0,
            mtime: seconds(&md),
            entries: 0,
        };
        if md.is_file() {
            source.size = md.len();
        } else if md.is_dir() {
            walk(path, &mut source)?;
        } else {
            return None;
        }
        Some(source)
    }

    /// Whether the archive is still the one the record was read from.
    pub fn holds(&self) -> bool {
        Source::of(Path::new(&self.path)).is_some_and(|now| now == *self)
    }
}

/// An archive's member tree, saved by the worker (issue #3736).
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CachedTree {
    pub version: u32,
    /// The name the tree was asked for by, checked on a hit.
    pub archive: String,
    pub source: Source,
    pub files: Vec<ArchiveFileEntry>,
    pub archive_path: Option<String>,
    pub checksum: Option<String>,
}

/// A map's skybox, saved by the worker (issue #3736). `data_url` is `None` for
/// the map that has no skybox, which is nearly every map and is an answer.
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CachedSkybox {
    pub version: u32,
    pub map: String,
    pub source: Source,
    pub data_url: Option<String>,
}

/// An archive's member tree when a current record of it is saved. `archive_path`
/// is the archive's own path where the scan placed it, `file_name` the map file
/// where `archive` is a map's name.
pub fn archive_tree(
    dir: &Path,
    archive: &str,
    archive_path: Option<&Path>,
    file_name: Option<&str>,
) -> Option<ArchiveTreeOutput> {
    let key = cachekey::archive_tree_key(
        archive_path.and_then(ArchiveStamp::of).as_ref(),
        archive,
        file_name,
    )?;
    current_tree(dir, &key, archive)
}

/// The tree saved under `key`, when it is for `archive`, is of this version and
/// its source file is unchanged. The worker asks this too, with the key it
/// built from unitsync, so a read that did reach a worker still skips the mount.
pub fn current_tree(dir: &Path, key: &str, archive: &str) -> Option<ArchiveTreeOutput> {
    let tree: CachedTree = read_record(dir, key)?;
    let current = tree.version == TREE_VERSION && tree.archive == archive && tree.source.holds();
    current.then(|| ArchiveTreeOutput {
        files: tree.files,
        archive_path: tree.archive_path,
        checksum: tree.checksum,
        errors: Vec::new(),
    })
}

/// A map's skybox answer when a current record of it is saved.
pub fn map_skybox(
    dir: &Path,
    map_name: &str,
    archive_path: Option<&Path>,
    file_name: Option<&str>,
) -> Option<MapSkyboxOutput> {
    let key = cachekey::map_skybox_key(
        archive_path.and_then(ArchiveStamp::of).as_ref(),
        map_name,
        file_name,
    )?;
    current_skybox(dir, &key, map_name)
}

/// The skybox saved under `key`, when it is for `map_name`, is of this version
/// and its source file is unchanged.
pub fn current_skybox(dir: &Path, key: &str, map_name: &str) -> Option<MapSkyboxOutput> {
    let skybox: CachedSkybox = read_record(dir, key)?;
    let current =
        skybox.version == SKYBOX_VERSION && skybox.map == map_name && skybox.source.holds();
    current.then(|| MapSkyboxOutput {
        data_url: skybox.data_url,
        errors: Vec::new(),
    })
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

    // ---- batch reads over a named list (issue #3736)

    fn named(name: &str, file: &str) -> MapRef {
        MapRef {
            name: name.into(),
            archive_path: None,
            file_name: Some(file.into()),
        }
    }

    /// What the worker leaves for a map it rendered at `mip`: the picture and
    /// the proportions, under the map's thumbnail key.
    fn leave_thumbnail(dir: &Path, map: &MapRef, mip: i32, dims: Option<(u32, u32)>) {
        let key = thumb_key_for(
            &map.name,
            map.archive_path.as_deref().map(Path::new),
            map.file_name.as_deref(),
        )
        .expect("a key");
        std::fs::write(minimap_file(dir, &key, mip), b"png").expect("picture");
        if let Some((width, height)) = dims {
            // Exactly the text the worker writes.
            std::fs::write(
                dims_file(dir, &key),
                format!(r#"{{"width":{width},"height":{height}}}"#),
            )
            .expect("dims");
        }
    }

    #[test]
    fn thumbnails_are_answered_from_disk_when_every_map_has_one() {
        let dir = temp_dir("thumbs-hit");
        let maps = [
            named("Alpha 1.0", "maps/alpha.smf"),
            named("Beta 2.1", "maps/beta.smf"),
        ];
        leave_thumbnail(&dir, &maps[0], 3, Some((384, 256)));
        leave_thumbnail(&dir, &maps[1], 3, Some((128, 128)));

        let out = thumbnails(&dir, 3, &maps).expect("a hit");
        assert_eq!(out.thumbnails.len(), 2);
        assert!(out.errors.is_empty());
        let alpha = &out.thumbnails[0];
        assert_eq!(alpha.name, "Alpha 1.0");
        assert!(alpha.file.as_deref().is_some_and(|f| f.ends_with("-3.png")));
        assert!(alpha.data_url.is_none());
        assert_eq!((alpha.width, alpha.height), (Some(384), Some(256)));
        let (w, h) = coilbox_assets::map_extent_elmos(384, 256);
        assert_eq!((alpha.width_elmos, alpha.height_elmos), (Some(w), Some(h)));
        assert_eq!(out.thumbnails[1].name, "Beta 2.1");
    }

    #[test]
    fn one_map_without_a_picture_sends_the_whole_call_to_a_worker() {
        let dir = temp_dir("thumbs-missing");
        let maps = [
            named("Alpha 1.0", "maps/alpha.smf"),
            named("Beta 2.1", "maps/beta.smf"),
        ];
        leave_thumbnail(&dir, &maps[0], 3, Some((384, 256)));
        assert!(thumbnails(&dir, 3, &maps).is_none());
        // A picture at another size is not this size's picture.
        leave_thumbnail(&dir, &maps[1], 1, Some((128, 128)));
        assert!(thumbnails(&dir, 3, &maps).is_none());
    }

    #[test]
    fn a_picture_without_its_proportions_is_not_an_answer() {
        let dir = temp_dir("thumbs-no-dims");
        let maps = [named("Alpha 1.0", "maps/alpha.smf")];
        leave_thumbnail(&dir, &maps[0], 3, None);
        assert!(thumbnails(&dir, 3, &maps).is_none());
    }

    #[test]
    fn a_picture_the_worker_found_no_proportions_for_is_still_an_answer() {
        let dir = temp_dir("thumbs-no-dims-marker");
        let maps = [named("Alpha 1.0", "maps/alpha.smf")];
        leave_thumbnail(&dir, &maps[0], 3, None);
        let key = thumb_key_for("Alpha 1.0", None, Some("maps/alpha.smf")).unwrap();
        std::fs::write(dims_none_file(&dir, &key), b"").expect("marker");

        let out = thumbnails(&dir, 3, &maps).expect("a hit");
        let thumb = &out.thumbnails[0];
        assert!(thumb.file.is_some());
        assert_eq!((thumb.width, thumb.height), (None, None));
        assert_eq!((thumb.width_elmos, thumb.height_elmos), (None, None));
    }

    #[test]
    fn an_empty_or_unkeyable_list_is_never_answered() {
        let dir = temp_dir("thumbs-edges");
        assert!(thumbnails(&dir, 3, &[]).is_none());
        let keyless = MapRef {
            name: "Alpha 1.0".into(),
            archive_path: None,
            file_name: None,
        };
        assert!(thumbnails(&dir, 3, &[keyless]).is_none());
    }

    #[test]
    fn a_changed_map_archive_misses_its_thumbnail() {
        let dir = temp_dir("thumbs-changed");
        let archive = dir.join("alpha_1.0.sd7");
        std::fs::write(&archive, b"a map").expect("archive");
        let map = MapRef {
            name: "Alpha 1.0".into(),
            archive_path: Some(archive.to_string_lossy().into_owned()),
            file_name: Some("maps/alpha.smf".into()),
        };
        leave_thumbnail(&dir, &map, 3, Some((384, 256)));
        assert!(thumbnails(&dir, 3, std::slice::from_ref(&map)).is_some());

        std::fs::write(&archive, b"a different, longer map").expect("rewrite");
        assert!(thumbnails(&dir, 3, &[map]).is_none());
    }

    fn leave_meta(dir: &Path, map: &MapRef, json: &str) {
        let key = cachekey::map_meta_key(
            map.archive_path
                .as_deref()
                .and_then(|p| ArchiveStamp::of(Path::new(p)))
                .as_ref(),
            &map.name,
            map.file_name.as_deref(),
        )
        .expect("a key");
        write_blob(dir, &key, json);
    }

    #[test]
    fn map_metadata_is_answered_from_the_records_the_worker_wrote() {
        let dir = temp_dir("meta-hit");
        let maps = [
            named("Alpha 1.0", "maps/alpha.smf"),
            named("Beta 2.1", "maps/beta.smf"),
        ];
        // The text the worker writes for a `MapMeta` today.
        leave_meta(
            &dir,
            &maps[0],
            r#"{"name":"Alpha 1.0","info":{"author":"A"}}"#,
        );
        leave_meta(
            &dir,
            &maps[1],
            r#"{"name":"Beta 2.1","info":{"author":"B"}}"#,
        );

        let out = map_metas(&dir, &maps).expect("a hit");
        assert_eq!(out.maps.len(), 2);
        assert_eq!(out.maps[1].name, "Beta 2.1");
        assert_eq!(out.maps[1].info["author"], "B");
        assert!(out.errors.is_empty());
    }

    #[test]
    fn a_map_whose_metadata_read_empty_is_an_answer_when_the_worker_saved_it() {
        let dir = temp_dir("meta-empty");
        let maps = [named("Alpha 1.0", "maps/alpha.smf")];
        // What the worker writes for a map that read cleanly and held nothing.
        leave_meta(&dir, &maps[0], r#"{"name":"Alpha 1.0","info":{}}"#);
        let out = map_metas(&dir, &maps).expect("a hit");
        assert!(out.maps[0].info.is_empty());
    }

    #[test]
    fn one_map_without_metadata_sends_the_whole_call_to_a_worker() {
        let dir = temp_dir("meta-missing");
        let maps = [
            named("Alpha 1.0", "maps/alpha.smf"),
            named("Beta 2.1", "maps/beta.smf"),
        ];
        leave_meta(
            &dir,
            &maps[0],
            r#"{"name":"Alpha 1.0","info":{"author":"A"}}"#,
        );
        assert!(map_metas(&dir, &maps).is_none());
        leave_meta(&dir, &maps[1], "{ not json");
        assert!(map_metas(&dir, &maps).is_none());
        assert!(map_metas(&dir, &[]).is_none());
    }

    #[test]
    fn a_record_under_a_maps_key_that_names_another_map_is_a_miss() {
        let dir = temp_dir("meta-wrong-name");
        let maps = [named("Alpha 1.0", "maps/alpha.smf")];
        leave_meta(
            &dir,
            &maps[0],
            r#"{"name":"Someone Else","info":{"a":"b"}}"#,
        );
        assert!(map_metas(&dir, &maps).is_none());
    }

    #[test]
    fn a_changed_map_archive_misses_its_metadata() {
        let dir = temp_dir("meta-changed");
        let archive = dir.join("alpha_1.0.sd7");
        std::fs::write(&archive, b"a map").expect("archive");
        let map = MapRef {
            name: "Alpha 1.0".into(),
            archive_path: Some(archive.to_string_lossy().into_owned()),
            file_name: Some("maps/alpha.smf".into()),
        };
        leave_meta(&dir, &map, r#"{"name":"Alpha 1.0","info":{"a":"b"}}"#);
        assert!(map_metas(&dir, std::slice::from_ref(&map)).is_some());

        std::fs::write(&archive, b"a different, longer map").expect("rewrite");
        assert!(map_metas(&dir, &[map]).is_none());
    }

    fn game_in(dir: &Path, file: &str, name: &str) -> (GameRef, String) {
        let archive = dir.join(file);
        std::fs::write(&archive, format!("game {file}")).expect("archive");
        let key = cachekey::header_key(&ArchiveStamp::of(&archive).expect("stamp"));
        (
            GameRef {
                name: name.into(),
                archive_path: archive.to_string_lossy().into_owned(),
            },
            key,
        )
    }

    #[test]
    fn game_headers_are_answered_from_the_art_and_markers_on_disk() {
        let dir = temp_dir("headers-hit");
        let (art, art_key) = game_in(&dir, "art.sdz", "Game With Art");
        let (bare, bare_key) = game_in(&dir, "bare.sdz", "Game Without");
        std::fs::write(dir.join(format!("{art_key}.jpg")), b"jpeg").expect("art");
        std::fs::write(dir.join(format!("{bare_key}.none")), b"").expect("marker");

        let out = game_headers(&dir, &[art, bare]).expect("a hit");
        assert_eq!(out.headers.len(), 2);
        assert_eq!(out.headers[0].name, "Game With Art");
        assert_eq!(
            out.headers[0].file.as_deref(),
            Some(format!("{art_key}.jpg").as_str())
        );
        assert!(out.headers[0].data_url.is_none());
        assert_eq!(out.headers[1].name, "Game Without");
        assert!(out.headers[1].file.is_none() && out.headers[1].data_url.is_none());
        assert!(out.errors.is_empty());
    }

    #[test]
    fn one_game_not_yet_read_sends_the_whole_call_to_a_worker() {
        let dir = temp_dir("headers-miss");
        let (art, art_key) = game_in(&dir, "art.sdz", "Game With Art");
        let (unread, _) = game_in(&dir, "unread.sdz", "Unread");
        std::fs::write(dir.join(format!("{art_key}.jpg")), b"jpeg").expect("art");
        assert!(game_headers(&dir, &[art, unread]).is_none());
        assert!(game_headers(&dir, &[]).is_none());
    }

    #[test]
    fn a_changed_game_archive_misses_its_header() {
        let dir = temp_dir("headers-changed");
        let (game, key) = game_in(&dir, "art.sdz", "Game With Art");
        std::fs::write(dir.join(format!("{key}.jpg")), b"jpeg").expect("art");
        assert!(game_headers(&dir, std::slice::from_ref(&game)).is_some());

        std::fs::write(&game.archive_path, "a different, longer game").expect("rewrite");
        assert!(game_headers(&dir, &[game]).is_none());
    }

    #[test]
    fn a_game_whose_archive_is_gone_is_not_answered() {
        let dir = temp_dir("headers-gone");
        let game = GameRef {
            name: "Gone".into(),
            archive_path: dir.join("gone.sdz").to_string_lossy().into_owned(),
        };
        assert!(game_headers(&dir, &[game]).is_none());
    }

    // ---- archive trees and skyboxes (issue #3736)

    fn a_tree(archive: &str, source: Source) -> CachedTree {
        CachedTree {
            version: TREE_VERSION,
            archive: archive.into(),
            source,
            files: vec![
                ArchiveFileEntry {
                    path: "maps/a.smf".into(),
                    size: 10,
                },
                ArchiveFileEntry {
                    path: "mapinfo.lua".into(),
                    size: 4,
                },
            ],
            archive_path: Some("/somewhere/a.sd7".into()),
            checksum: Some("0badf00d".into()),
        }
    }

    fn save<T: Serialize>(dir: &Path, key: &str, record: &T) {
        write_blob(dir, key, &serde_json::to_string(record).expect("json"));
    }

    fn a_map_archive(dir: &Path) -> (PathBuf, Source) {
        let archive = dir.join("alpha_1.0.sd7");
        std::fs::write(&archive, b"a map archive").expect("archive");
        let source = Source::of(&archive).expect("a source");
        (archive, source)
    }

    #[test]
    fn a_source_is_the_file_it_was_read_from() {
        let dir = temp_dir("source");
        let (archive, source) = a_map_archive(&dir);
        assert_eq!(source.size, 13);
        assert!(source.holds());

        std::fs::write(&archive, b"a longer map archive").expect("rewrite");
        assert!(!source.holds(), "a different size is a different file");
        std::fs::remove_file(&archive).expect("remove");
        assert!(!source.holds(), "a file that is gone holds nothing");
    }

    #[test]
    fn a_directory_archive_is_held_by_everything_inside_it() {
        let dir = temp_dir("source-dir");
        let sdd = dir.join("game.sdd");
        std::fs::create_dir_all(sdd.join("units")).expect("dir");
        std::fs::write(sdd.join("modinfo.lua"), b"return {}").expect("file");
        std::fs::write(sdd.join("units/a.lua"), b"a").expect("file");
        let source = Source::of(&sdd).expect("a directory has a source");
        assert!(source.holds());
        assert!(Source::of(&dir.join("missing.sdz")).is_none());

        // A directory's own time does not move when a file deeper in it is
        // edited, so the walk has to.
        std::fs::write(sdd.join("units/a.lua"), b"edited, and longer").expect("edit");
        assert!(!source.holds(), "an edited file is a different archive");
    }

    #[test]
    fn a_file_added_to_or_removed_from_a_directory_archive_changes_its_source() {
        let dir = temp_dir("source-dir-members");
        let sdd = dir.join("game.sdd");
        std::fs::create_dir_all(sdd.join("units")).expect("dir");
        std::fs::write(sdd.join("units/a.lua"), b"a").expect("file");
        let source = Source::of(&sdd).expect("a source");

        std::fs::write(sdd.join("units/b.lua"), b"b").expect("add");
        assert!(!source.holds());
        let with_b = Source::of(&sdd).expect("a source");
        assert!(with_b.holds());
        std::fs::remove_file(sdd.join("units/b.lua")).expect("remove");
        assert!(!with_b.holds());
    }

    #[test]
    fn a_game_s_tree_is_found_from_its_archive_path() {
        let dir = temp_dir("tree-game");
        let (archive, source) = a_map_archive(&dir);
        let stamp = ArchiveStamp::of(&archive).expect("stamp");
        let key = cachekey::archive_tree_key(Some(&stamp), "alpha_1.0.sd7", None).expect("key");
        save(&dir, &key, &a_tree("alpha_1.0.sd7", source));

        let out = archive_tree(&dir, "alpha_1.0.sd7", Some(&archive), None).expect("a hit");
        assert_eq!(out.files.len(), 2);
        assert_eq!(out.files[1].path, "mapinfo.lua");
        assert_eq!(out.archive_path.as_deref(), Some("/somewhere/a.sd7"));
        assert_eq!(out.checksum.as_deref(), Some("0badf00d"));
        assert!(out.errors.is_empty());
    }

    #[test]
    fn a_map_s_tree_is_found_from_its_name_and_file() {
        let dir = temp_dir("tree-map");
        let (_, source) = a_map_archive(&dir);
        let key =
            cachekey::archive_tree_key(None, "Alpha 1.0", Some("maps/alpha.smf")).expect("key");
        save(&dir, &key, &a_tree("Alpha 1.0", source));

        assert!(archive_tree(&dir, "Alpha 1.0", None, Some("maps/alpha.smf")).is_some());
        assert!(archive_tree(&dir, "Alpha 1.0", None, None).is_none());
        assert!(archive_tree(&dir, "Alpha 1.1", None, Some("maps/alpha.smf")).is_none());
    }

    #[test]
    fn a_changed_archive_misses_its_tree() {
        let dir = temp_dir("tree-changed");
        let (archive, source) = a_map_archive(&dir);
        let stamp = ArchiveStamp::of(&archive).expect("stamp");
        let key = cachekey::archive_tree_key(Some(&stamp), "alpha_1.0.sd7", None).expect("key");
        save(&dir, &key, &a_tree("alpha_1.0.sd7", source));
        assert!(archive_tree(&dir, "alpha_1.0.sd7", Some(&archive), None).is_some());

        std::fs::write(&archive, b"a longer map archive").expect("rewrite");
        assert!(archive_tree(&dir, "alpha_1.0.sd7", Some(&archive), None).is_none());
    }

    #[test]
    fn a_replaced_archive_behind_a_name_misses_its_tree() {
        let dir = temp_dir("tree-replaced");
        let (archive, source) = a_map_archive(&dir);
        let key =
            cachekey::archive_tree_key(None, "Alpha 1.0", Some("maps/alpha.smf")).expect("key");
        save(&dir, &key, &a_tree("Alpha 1.0", source));
        assert!(archive_tree(&dir, "Alpha 1.0", None, Some("maps/alpha.smf")).is_some());

        // The name key does not change, the file it was read from does.
        std::fs::write(&archive, b"a rebuilt map archive").expect("rewrite");
        assert!(archive_tree(&dir, "Alpha 1.0", None, Some("maps/alpha.smf")).is_none());
    }

    #[test]
    fn a_tree_from_another_version_or_for_another_archive_is_a_miss() {
        let dir = temp_dir("tree-version");
        let (_, source) = a_map_archive(&dir);
        let key =
            cachekey::archive_tree_key(None, "Alpha 1.0", Some("maps/alpha.smf")).expect("key");

        let mut old = a_tree("Alpha 1.0", source.clone());
        old.version = TREE_VERSION - 1;
        save(&dir, &key, &old);
        assert!(archive_tree(&dir, "Alpha 1.0", None, Some("maps/alpha.smf")).is_none());

        let mut newer = a_tree("Alpha 1.0", source.clone());
        newer.version = TREE_VERSION + 1;
        save(&dir, &key, &newer);
        assert!(archive_tree(&dir, "Alpha 1.0", None, Some("maps/alpha.smf")).is_none());

        save(&dir, &key, &a_tree("Someone Else", source));
        assert!(archive_tree(&dir, "Alpha 1.0", None, Some("maps/alpha.smf")).is_none());

        write_blob(&dir, &key, "{ not json");
        assert!(archive_tree(&dir, "Alpha 1.0", None, Some("maps/alpha.smf")).is_none());
    }

    fn a_skybox(map: &str, source: Source, data_url: Option<&str>) -> CachedSkybox {
        CachedSkybox {
            version: SKYBOX_VERSION,
            map: map.into(),
            source,
            data_url: data_url.map(String::from),
        }
    }

    #[test]
    fn a_map_with_no_skybox_is_a_saved_answer() {
        let dir = temp_dir("sky-none");
        let (_, source) = a_map_archive(&dir);
        let key = cachekey::map_skybox_key(None, "Alpha 1.0", Some("maps/alpha.smf")).expect("key");
        save(&dir, &key, &a_skybox("Alpha 1.0", source, None));

        let out = map_skybox(&dir, "Alpha 1.0", None, Some("maps/alpha.smf")).expect("a hit");
        assert!(out.data_url.is_none());
        assert!(out.errors.is_empty());
    }

    #[test]
    fn a_saved_skybox_is_returned_whole() {
        let dir = temp_dir("sky-some");
        let (archive, source) = a_map_archive(&dir);
        let stamp = ArchiveStamp::of(&archive).expect("stamp");
        let key = cachekey::map_skybox_key(Some(&stamp), "Alpha 1.0", None).expect("key");
        save(
            &dir,
            &key,
            &a_skybox(
                "Alpha 1.0",
                source,
                Some("data:application/octet-stream;base64,AAAA"),
            ),
        );

        let out = map_skybox(&dir, "Alpha 1.0", Some(&archive), None).expect("a hit");
        assert_eq!(
            out.data_url.as_deref(),
            Some("data:application/octet-stream;base64,AAAA")
        );
    }

    #[test]
    fn a_changed_map_archive_misses_its_skybox() {
        let dir = temp_dir("sky-changed");
        let (archive, source) = a_map_archive(&dir);
        let key = cachekey::map_skybox_key(None, "Alpha 1.0", Some("maps/alpha.smf")).expect("key");
        save(&dir, &key, &a_skybox("Alpha 1.0", source, None));
        assert!(map_skybox(&dir, "Alpha 1.0", None, Some("maps/alpha.smf")).is_some());

        std::fs::write(&archive, b"a rebuilt map archive").expect("rewrite");
        assert!(map_skybox(&dir, "Alpha 1.0", None, Some("maps/alpha.smf")).is_none());
    }

    #[test]
    fn a_skybox_from_another_version_or_map_is_a_miss() {
        let dir = temp_dir("sky-version");
        let (_, source) = a_map_archive(&dir);
        let key = cachekey::map_skybox_key(None, "Alpha 1.0", Some("maps/alpha.smf")).expect("key");

        let mut old = a_skybox("Alpha 1.0", source.clone(), None);
        old.version = SKYBOX_VERSION - 1;
        save(&dir, &key, &old);
        assert!(map_skybox(&dir, "Alpha 1.0", None, Some("maps/alpha.smf")).is_none());

        save(&dir, &key, &a_skybox("Someone Else", source, None));
        assert!(map_skybox(&dir, "Alpha 1.0", None, Some("maps/alpha.smf")).is_none());
    }
}
