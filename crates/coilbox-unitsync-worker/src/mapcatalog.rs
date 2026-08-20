//! Everything coilbox knows about a map, gathered into the one entry the hub
//! takes (issue #1732).
//!
//! Nearly all of it was already being read, and nothing put it together. The
//! minimap mode reads the extent, the start positions, the wind and tidal
//! numbers and every appearance colour. The height mode reads the world height
//! range. `GetMapInfoEx` reads the description and the credits. This assembles
//! one [`MapCatalogEntry`] out of them, in the shape `POST /api/v1/maps` accepts.
//!
//! ## What is genuinely new here
//!
//! **`water_coverage`**, the share of height samples below zero. The hub cannot
//! derive it: `world_height_min` says a map reaches below zero somewhere and not
//! how much of it does, so only the side holding the height grid can count.
//!
//! **`source_hash`**, over the archive's own bytes, which is what tells a version
//! rollover from a corrupt install. Note this is a different hash from the one on
//! a map's pictures: a picture hashes the samples it was drawn from
//! ([`crate::assetencode::map_source_hash`]) so that it survives a repack, and an
//! entry hashes the archive because the archive is the thing whose identity is in
//! question.
//!
//! **`archive_filename`**, the file's real name on disk, which mirror templates
//! need. Not `source_archive`, which is the name the archive declares for itself.
//!
//! ## What it deliberately does not carry
//!
//! No slug, no split author list, no facts digest and no tags. The hub derives
//! all five and would not believe a client that sent them. Two coilbox releases
//! disagreeing about what makes a map a water map would otherwise produce two
//! vocabularies for one map, with nothing to say which was current.

use std::collections::BTreeMap;
use std::io::Read;

use coilbox_map_catalog::{AppearanceValue, MapCatalogEntry, MapPoint, MapPoints};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::archive::MapArchives;
use crate::ffi::{MapAppearance, Unitsync};
use crate::infocache;

/// What a density sample is worth on a map that says nothing about it, from
/// `CMapInfo::ReadGlobal`. The engine's default rather than coilbox's choice.
const ENGINE_DEFAULT_MAX_METAL: f32 = 0.02;

/// How much of the archive is hashed at a time. A map archive runs to hundreds
/// of megabytes, so the bytes stream through this rather than being read into
/// memory whole.
const HASH_CHUNK: usize = 1024 * 1024;

/// Why a map produced no entry. Each is a different answer, and none of them is
/// a reason to submit a worse entry instead.
#[derive(Serialize, Deserialize, Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "kebab-case")]
pub enum MapCatalogSkip {
    /// The map's archive is not a file that can be hashed: installed through the
    /// rapid pool, or unpacked as a directory. Without `source_hash` the hub
    /// cannot tell one install of the map from another, which is the whole of
    /// what the field is for.
    NoArchiveFile,
    /// The archive is a file and reading it failed.
    UnreadableArchive,
    /// No metal infomap, so the map's extent in elmos is unknown. Every
    /// coordinate an entry carries is in elmos, so an entry without the extent
    /// would be a set of coordinates in no space.
    NoExtent,
    /// unitsync reported no world height range, so the height samples cannot be
    /// turned into elmos and nothing can say what is under water.
    NoHeightRange,
    /// The library lists this map twice, from two installs, and the hub holds one
    /// row per name. The second one is dropped rather than sent, because a batch
    /// naming one map twice is refused whole.
    DuplicateMap,
}

/// What the `--map-catalog` mode prints: one map's entry, or why there is none.
///
/// Exactly one of `entry` and `skipped` is set.
#[derive(Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct MapCatalogOutput {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub entry: Option<MapCatalogEntry>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub skipped: Option<MapCatalogSkip>,
    pub errors: Vec<String>,
}

/// Which archive a map came out of, and what its bytes hash to.
///
/// The cheap half of an entry, and the half a have check is made of. Reading it
/// on its own is what lets a library walk ask the hub about three thousand maps
/// before doing the expensive work for the handful it still wants (issue #1737).
pub(crate) struct MapSource {
    pub archive_file: String,
    pub source_hash: String,
}

/// Find the map's archive and hash it.
///
/// `archives` is the walk's own index, and `None` is a caller asking about one
/// map, which pays a search of the map archives rather than a pass over all of
/// them. It only decides how the file is found, never which one.
pub(crate) fn source_in_session(
    us: &Unitsync,
    map_index: i32,
    map_name: &str,
    archives: Option<&MapArchives>,
    cache_dir: Option<&std::path::Path>,
) -> Result<MapSource, MapCatalogSkip> {
    let archive_file = match archives {
        Some(index) => index.file_for(us, map_index, map_name),
        None => crate::archive::map_archive_file(us, map_index, map_name),
    }
    .ok_or(MapCatalogSkip::NoArchiveFile)?;
    let source_hash =
        cached_hash(&archive_file, cache_dir).ok_or(MapCatalogSkip::UnreadableArchive)?;
    Ok(MapSource {
        archive_file,
        source_hash,
    })
}

/// The archive\'s sha256, from the cache when the file has not moved since it was
/// last read.
///
/// Keyed on the file\'s own path, size and mtime, which is what every other cache
/// in this worker is keyed on. Without it a sweep re-reads every byte of a map
/// library on every run, which is tens of gigabytes to learn that nothing has
/// changed. With it a second sweep reads no archives at all.
fn cached_hash(path: &str, cache_dir: Option<&std::path::Path>) -> Option<String> {
    let key = cache_dir.and_then(|_| infocache::archive_hash_key(std::path::Path::new(path)));
    if let (Some(dir), Some(key)) = (cache_dir, key.as_deref()) {
        if let Some(hit) = infocache::read::<String>(dir, key) {
            return Some(hit);
        }
    }
    let hash = hash_file(path)?;
    if let (Some(dir), Some(key)) = (cache_dir, key.as_deref()) {
        infocache::write(dir, key, &hash);
    }
    Some(hash)
}

/// One map's entry, in a session the caller has already initialised.
///
/// `map_index` is the map's position in unitsync's own list, which is what
/// `GetMapInfoEx` is keyed on. The caller has it from enumerating the library,
/// so it is passed rather than searched for again.
///
/// The map's archives are mounted and unmounted around the `mapinfo.lua` reads,
/// because the Lua parser resolves that file through the VFS rather than being
/// handed it.
pub(crate) fn entry_in_session(
    us: &Unitsync,
    map_index: i32,
    map_name: &str,
    archives: Option<&MapArchives>,
    cache_dir: Option<&std::path::Path>,
) -> Result<MapCatalogEntry, MapCatalogSkip> {
    let source = source_in_session(us, map_index, map_name, archives, cache_dir)?;
    let MapSource {
        archive_file,
        source_hash,
    } = source;
    let archive_filename = std::path::Path::new(&archive_file)
        .file_name()
        .map(|n| n.to_string_lossy().into_owned());

    let (width_elmos, height_elmos) = us
        .map_dimensions(map_name)
        .map(|(w, h)| coilbox_assets::map_extent_elmos(w, h))
        .ok_or(MapCatalogSkip::NoExtent)?;
    let (world_height_min, world_height_max) = us
        .height_bounds(map_name)
        .ok_or(MapCatalogSkip::NoHeightRange)?;

    // The description and the credits come from `GetMapInfoEx` rather than from
    // the parser below, because the engine synthesises them for a map that ships
    // no `mapinfo.lua` at all, and a direct read would report an SMD era map as
    // having no author.
    let info = us.map_info(map_index);

    let mut start_positions = Vec::new();
    let mut wind = None;
    let mut tidal = None;
    let mut appearance = MapAppearance::default();
    let mut display_name = None;
    let mut map_version = None;
    if let Some(first_archive) = us.map_archives(map_name).into_iter().next() {
        us.add_all_archives(&first_archive);
        start_positions = us.start_positions();
        (wind, tidal) = us.map_env();
        appearance = us.map_appearance();
        (display_name, map_version) = us.map_identity();
        us.remove_all_archives();
    }

    // `mapinfo.lua` first, because it carries what the map declared and the
    // engine's own map info rounds these three to whole numbers. The engine's
    // second, because it synthesises the block for a map that ships no
    // `mapinfo.lua` at all: without the fallback the twelve SMD era maps on this
    // machine report no wind and no tidal, and Beyond All Reason publishes both
    // for one of them.
    let engine_number = |key: &str| us.map_number(map_index, key);
    let (min_wind, max_wind) = match wind {
        Some((mn, mx)) => (Some(mn), Some(mx)),
        None => (engine_number("minWind"), engine_number("maxWind")),
    };
    let tidal = tidal.or_else(|| engine_number("tidalStrength"));

    Ok(MapCatalogEntry {
        map_name: map_name.to_string(),
        display_name,
        description: some_text(info.get("description")),
        map_version,
        author: some_text(info.get("author")),
        archive_filename,
        source_archive: crate::archive::archive_name_for_map(us, map_name),
        source_hash,
        catalog_version: coilbox_map_catalog::catalog_version(),
        width_elmos,
        height_elmos,
        world_height_min,
        world_height_max,
        min_wind,
        max_wind,
        tidal_strength: tidal,
        void_water: appearance.void_water,
        void_ground: appearance.void_ground,
        water_coverage: water_coverage(
            height_samples(us, map_name).as_deref(),
            (world_height_min, world_height_max),
            appearance.void_water,
        ),
        appearance: appearance_blob(&appearance),
        points: MapPoints {
            start: start_positions
                .into_iter()
                .map(|(x, z)| MapPoint::at(x, z))
                .collect(),
            metal: metal_spots(us, map_index, map_name),
            geo: geo_vents(us, &archive_file, map_index),
        },
    })
}

/// The map's metal spots, as points the hub stores under `metal`.
///
/// The density grid and the map's own `maxMetal` are what a spot is worked out
/// from, and the rules for working it out come from the shared catalog document
/// rather than from here (issue #1734). See [`crate::metalspots`].
///
/// `maxMetal` comes off the engine's own map info rather than out of
/// `mapinfo.lua`, so an SMD era map answers with the value from its `.smd`. A map
/// that declares none has no metal to extract whatever its grid says, and
/// produces no spots.
fn metal_spots(us: &Unitsync, map_index: i32, map_name: &str) -> Vec<MapPoint> {
    let Some((width, height)) = us.map_dimensions(map_name) else {
        return Vec::new();
    };
    let Some(density) = us.metalmap_data(map_name, width, height) else {
        return Vec::new();
    };
    // A map that declares no `maxMetal` still has metal, because the engine
    // supplies one. unitsync's own map info defaults the field to 0 where
    // `CMapInfo::ReadGlobal` defaults it to 0.02, so taking unitsync's answer
    // literally reports no spots at all on a map that plays with plenty: this
    // machine's Grts_Messa_008 is one, an SMD era map whose `.smd` says nothing
    // about metal.
    let max_metal = us
        .map_number(map_index, "maxMetal")
        .filter(|declared| *declared > 0.0)
        .unwrap_or(ENGINE_DEFAULT_MAX_METAL);
    let spots = crate::metalspots::find(
        &density,
        width,
        height,
        f64::from(max_metal),
        &coilbox_map_catalog::catalog().metal_clustering,
    );
    crate::metalspots::points(&spots)
}

/// The map's geothermal vents, as points the hub stores under `geo`.
///
/// Read out of the map file's own feature block rather than from unitsync, which
/// exposes nothing about features. Which of a map's features is a vent is the
/// engine's rule and not a guess: `CFeatureDefHandler::LoadFeatureDefsFromMap`
/// gives a default geothermal def to any map feature type whose name contains
/// `geovent`. See [`crate::smf::is_geovent`].
///
/// The type name travels on the point as `feature`, which is what the catalog's
/// `geo` kind carries, so a map naming its vents something unusual can still be
/// read back and understood rather than being reduced to a coordinate.
///
/// An empty list is the ordinary answer: half of this library's maps place no
/// features at all. A map file that will not read gives an empty list too, since
/// a fact that could not be read is not a fact about the map, and the rest of the
/// entry is still worth having.
fn geo_vents(us: &Unitsync, archive_file: &str, map_index: i32) -> Vec<MapPoint> {
    let Some(smf_name) = us.map_file_name(map_index) else {
        return Vec::new();
    };
    let Some(bytes) =
        crate::archive::read_archive_member(us, archive_file, &smf_name, crate::smf::MAX_SMF_BYTES)
    else {
        return Vec::new();
    };
    let Ok(features) = crate::smf::features(&bytes) else {
        return Vec::new();
    };
    features
        .into_iter()
        .filter(|feature| crate::smf::is_geovent(&feature.kind))
        .map(|feature| MapPoint {
            x: feature.x,
            z: feature.z,
            y: Some(feature.y),
            meta: BTreeMap::from([("feature".to_string(), serde_json::json!(feature.kind))]),
        })
        .collect()
}

/// A field the archive filled in, or `None` for one it left blank.
///
/// `GetMapInfoEx` answers with an empty string for a map that declares no
/// author, and the hub reads a blank as absent anyway, so the two are settled
/// here rather than differently at each end.
fn some_text(value: Option<&String>) -> Option<String> {
    let trimmed = value?.trim();
    (!trimmed.is_empty()).then(|| trimmed.to_string())
}

/// sha256 of a file's bytes, hex, streamed a megabyte at a time.
fn hash_file(path: &str) -> Option<String> {
    let mut file = std::fs::File::open(path).ok()?;
    let mut hasher = Sha256::new();
    let mut buf = vec![0u8; HASH_CHUNK];
    loop {
        let read = file.read(&mut buf).ok()?;
        if read == 0 {
            break;
        }
        hasher.update(&buf[..read]);
    }
    Some(crate::assetencode::hex(&hasher.finalize()))
}

/// The share of the map's height samples that sit below the sea plane, between
/// 0 and 1.
///
/// `None` on a void water map, which has no water for a share to be of, and
/// which the hub refuses an entry carrying both for. `None` again when the grid
/// will not read, because a map whose heights are unknown is not a map with no
/// water.
///
/// Counted rather than measured, so the answer is the same on every machine: the
/// engine's conversion is `min + word * (max - min) / 65536`, which makes "below
/// zero" a comparison against one threshold, and the result is a ratio of two
/// integers rather than a sum of floats.
fn water_coverage(
    samples: Option<&[u16]>,
    (min, max): (f32, f32),
    void_water: Option<bool>,
) -> Option<f64> {
    if void_water == Some(true) {
        return None;
    }
    let samples = samples.filter(|s| !s.is_empty())?;
    Some(below_sea_level_share(samples, min, max))
}

/// The map's height grid, or `None` when it has none or the read failed.
///
/// A read of its own rather than the one `overlay:height` pays for, because a
/// catalog walk is not an asset walk and nothing here writes a picture. The two
/// are joined up in issue #1737, where one archive is opened once for both.
fn height_samples(us: &Unitsync, map_name: &str) -> Option<Vec<u16>> {
    let (w, h) = us.heightmap_size(map_name)?;
    us.heightmap_data(map_name, w, h)
}

/// The counting half of [`water_coverage`], without a map to read.
fn below_sea_level_share(samples: &[u16], min: f32, max: f32) -> f64 {
    // A flat map is entirely above or entirely below, and there is no threshold
    // to compute because every sample converts to the same height.
    let span = (max - min) as f64;
    if span <= 0.0 {
        return if min < 0.0 { 1.0 } else { 0.0 };
    }
    let threshold = -(min as f64) * 65536.0 / span;
    if threshold <= 0.0 {
        return 0.0;
    }
    let under = samples
        .iter()
        .filter(|&&word| (word as f64) < threshold)
        .count();
    under as f64 / samples.len() as f64
}

/// The appearance fields as a blob, under the names `mapinfo.lua` gives them.
///
/// `voidWater` and `voidGround` are not in here. They are facts of their own on
/// the entry, and a value in two places is a value that can disagree with
/// itself.
fn appearance_blob(app: &MapAppearance) -> BTreeMap<String, AppearanceValue> {
    let mut blob = BTreeMap::new();
    let mut put = |key: &str, value: Option<AppearanceValue>| {
        if let Some(value) = value {
            blob.insert(key.to_string(), value);
        }
    };
    let number = |v: Option<f32>| v.map(AppearanceValue::Number);
    let colour = |v: Option<[f32; 3]>| v.map(AppearanceValue::Colour);

    put("voidAlphaMin", number(app.void_alpha_min));
    put("waterColor", colour(app.water_color));
    put("waterAlpha", number(app.water_alpha));
    put("waterPlaneColor", colour(app.water_plane_color));
    put("waterAbsorb", colour(app.water_absorb));
    put("waterBaseColor", colour(app.water_base_color));
    put("waterMinColor", colour(app.water_min_color));
    put(
        "forceRendering",
        app.force_rendering.map(AppearanceValue::Flag),
    );
    put("skyColor", colour(app.sky_color));
    put("fogColor", colour(app.fog_color));
    put("cloudColor", colour(app.cloud_color));
    put("cloudDensity", number(app.cloud_density));
    put("sunDir", colour(app.sun_dir));
    put("sunColor", colour(app.sun_color));
    put("groundAmbientColor", colour(app.ground_ambient_color));
    put("groundDiffuseColor", colour(app.ground_diffuse_color));
    put("groundSpecularColor", colour(app.ground_specular_color));
    put("groundShadowDensity", number(app.ground_shadow_density));
    blob
}

/// One map in a library walk: what a have check needs, and the facts themselves
/// when they were asked for.
///
/// The three key fields are always here, because they are the cheap half and the
/// half the hub is asked about first. `entry` is absent on a keys-only pass, and
/// present when the caller asked for the facts of the maps the hub said it
/// wanted.
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MapCatalogRow {
    pub map_name: String,
    pub source_hash: String,
    pub catalog_version: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub entry: Option<MapCatalogEntry>,
}

/// A map the walk produced nothing for, and why.
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MapCatalogSkipped {
    pub map_name: String,
    pub reason: MapCatalogSkip,
}

/// What the library walk prints.
#[derive(Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct MapCatalogWalkOutput {
    pub maps: Vec<MapCatalogRow>,
    pub skipped: Vec<MapCatalogSkipped>,
    pub errors: Vec<String>,
}

/// Walk the installed map library in one session.
///
/// Two passes over one library, and which one this is decides what it costs.
/// `keys_only` finds each map's archive and hashes it, which is what a have
/// check compares on. Without it, every map named also has its infomaps read,
/// its `mapinfo.lua` parsed and its whole height grid counted, which is tens of
/// megabytes a map.
///
/// That split is the point of the mode. A library of three thousand maps is
/// almost entirely maps the hub already holds, so the expensive half is paid for
/// the handful it does not (issue #1737).
///
/// `only` restricts the walk to these names, which is how the second pass is
/// told what the hub wanted. `None` walks everything.
pub fn walk(
    lib: &str,
    only: Option<&[String]>,
    keys_only: bool,
    cache_dir: Option<&std::path::Path>,
) -> MapCatalogWalkOutput {
    let us = match unsafe { Unitsync::load(std::path::Path::new(lib)) } {
        Ok(u) => u,
        Err(e) => {
            return MapCatalogWalkOutput {
                errors: vec![e],
                ..Default::default()
            }
        }
    };
    let mut errors = Vec::new();
    if us.init(false, 0) == 0 {
        errors.push("unitsync Init returned 0 (failure); the library looks empty".into());
    }
    errors.extend(us.drain_errors());

    let (wanted, mut skipped) = map_list(&us, only);
    // One pass over the map archives, so resolving three thousand maps is three
    // thousand archive opens rather than three thousand times three thousand.
    let archives = MapArchives::index(&us);
    let _ = us.drain_errors();

    let mut maps = Vec::with_capacity(wanted.len());
    for (index, map_name) in wanted {
        let read = if keys_only {
            source_in_session(&us, index, &map_name, Some(&archives), cache_dir).map(|source| {
                MapCatalogRow {
                    map_name: map_name.clone(),
                    source_hash: source.source_hash,
                    catalog_version: coilbox_map_catalog::catalog_version(),
                    entry: None,
                }
            })
        } else {
            entry_in_session(&us, index, &map_name, Some(&archives), cache_dir).map(|entry| {
                MapCatalogRow {
                    map_name: map_name.clone(),
                    source_hash: entry.source_hash.clone(),
                    catalog_version: entry.catalog_version,
                    entry: Some(entry),
                }
            })
        };
        // Whatever unitsync said while reading this map belongs to this map.
        let _ = us.drain_errors();
        match read {
            Ok(row) => maps.push(row),
            Err(reason) => skipped.push(MapCatalogSkipped { map_name, reason }),
        }
    }

    errors.extend(us.drain_errors());
    us.uninit();

    MapCatalogWalkOutput {
        maps,
        skipped,
        errors,
    }
}

/// The maps to walk, with the index unitsync knows each by, and the ones dropped
/// before any of them is read.
///
/// Sorted by name so two runs of one library produce the same order, and deduped
/// because the hub holds one row per name and refuses a batch that names one map
/// twice. A library listing a map as both an `.sd7` and an unpacked directory
/// lists it twice, and this machine has two such maps.
fn map_list(
    us: &Unitsync,
    only: Option<&[String]>,
) -> (Vec<(i32, String)>, Vec<MapCatalogSkipped>) {
    choose(
        (0..us.map_count())
            .filter_map(|index| us.map_name(index).map(|name| (index, name)))
            .collect(),
        only,
    )
}

/// The filter, the sort and the dedupe [`map_list`] applies, without the session
/// it takes to read a name.
fn choose(
    named: Vec<(i32, String)>,
    only: Option<&[String]>,
) -> (Vec<(i32, String)>, Vec<MapCatalogSkipped>) {
    let mut named: Vec<(i32, String)> = named
        .into_iter()
        .filter(|(_, name)| only.is_none_or(|only| only.iter().any(|wanted| wanted == name)))
        .collect();
    named.sort_by(|a, b| a.1.cmp(&b.1).then(a.0.cmp(&b.0)));

    let mut kept: Vec<(i32, String)> = Vec::with_capacity(named.len());
    let mut duplicates = Vec::new();
    for (index, name) in named {
        if kept.last().map(|(_, last)| last) == Some(&name) {
            duplicates.push(MapCatalogSkipped {
                map_name: name,
                reason: MapCatalogSkip::DuplicateMap,
            });
            continue;
        }
        kept.push((index, name));
    }
    (kept, duplicates)
}

/// Report a failure that stopped the walk running at all, in the walk's own
/// shape.
pub fn emit_walk_error(msg: String) {
    let out = MapCatalogWalkOutput {
        errors: vec![msg],
        ..Default::default()
    };
    println!("{}", serde_json::to_string(&out).unwrap_or_default());
}

/// Read one map's entry in a session of its own, which is the `--map-catalog`
/// mode.
pub fn read(lib: &str, map_name: &str, cache_dir: Option<&std::path::Path>) -> MapCatalogOutput {
    let us = match unsafe { Unitsync::load(std::path::Path::new(lib)) } {
        Ok(u) => u,
        Err(e) => {
            return MapCatalogOutput {
                errors: vec![e],
                ..Default::default()
            }
        }
    };
    us.init(false, 0);
    let _ = us.drain_errors();

    let map_index = (0..us.map_count()).find(|&i| us.map_name(i).as_deref() == Some(map_name));
    let assembled = match map_index {
        Some(index) => entry_in_session(&us, index, map_name, None, cache_dir),
        None => Err(MapCatalogSkip::NoArchiveFile),
    };
    let mut errors = us.drain_errors();
    if map_index.is_none() {
        errors.push(format!("no map named {map_name} is installed"));
    }
    us.uninit();

    match assembled {
        Ok(entry) => MapCatalogOutput {
            entry: Some(entry),
            skipped: None,
            errors,
        },
        Err(why) => MapCatalogOutput {
            entry: None,
            skipped: Some(why),
            errors,
        },
    }
}

/// Report a failure that stopped the mode running at all, in the mode's own
/// shape, so a caller parses one thing either way.
pub fn emit_error(msg: String) {
    let out = MapCatalogOutput {
        errors: vec![msg],
        ..Default::default()
    };
    println!("{}", serde_json::to_string(&out).unwrap_or_default());
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The 16 bit word that converts to `height` under the engine's own
    /// conversion, for building grids a test can reason about in elmos.
    fn word_at(height: f32, min: f32, max: f32) -> u16 {
        (((height - min) / (max - min)) * 65536.0).round() as u16
    }

    #[test]
    fn a_map_with_no_terrain_below_zero_reports_no_water() {
        let samples: Vec<u16> = (0..16).map(|_| word_at(50.0, 0.0, 100.0)).collect();
        assert_eq!(below_sea_level_share(&samples, 0.0, 100.0), 0.0);
    }

    /// The ordinary case: a quarter of the samples under the sea plane is 0.25,
    /// and not 25.
    #[test]
    fn a_quarter_under_water_is_a_quarter_rather_than_a_percentage() {
        let mut samples: Vec<u16> = (0..3).map(|_| word_at(40.0, -100.0, 100.0)).collect();
        samples.push(word_at(-40.0, -100.0, 100.0));
        assert_eq!(below_sea_level_share(&samples, -100.0, 100.0), 0.25);
    }

    /// A sample sitting exactly at the sea plane is at the water's edge rather
    /// than under it, which is what keeps a flat map at sea level from reading
    /// as entirely flooded.
    #[test]
    fn a_sample_at_the_sea_plane_is_not_under_water() {
        let samples = vec![word_at(0.0, -100.0, 100.0)];
        assert_eq!(below_sea_level_share(&samples, -100.0, 100.0), 0.0);
    }

    #[test]
    fn a_map_entirely_below_the_sea_plane_is_all_water() {
        let samples: Vec<u16> = (0..8).map(|_| word_at(-20.0, -100.0, -10.0)).collect();
        assert_eq!(below_sea_level_share(&samples, -100.0, -10.0), 1.0);
    }

    /// A map with one height everywhere has no range to place a threshold in, so
    /// it is read off the height itself rather than divided by zero.
    #[test]
    fn a_flat_map_is_all_water_or_none_of_it() {
        assert_eq!(below_sea_level_share(&[0], -30.0, -30.0), 1.0);
        assert_eq!(below_sea_level_share(&[0], 30.0, 30.0), 0.0);
    }

    /// The count is over integers and the divide is one operation, so the same
    /// grid gives the same share bit for bit however many times it is read.
    #[test]
    fn the_same_grid_gives_the_same_share_twice() {
        let samples: Vec<u16> = (0..1000).map(|i| (i * 61) as u16).collect();
        let once = below_sea_level_share(&samples, -50.0, 50.0);
        let twice = below_sea_level_share(&samples, -50.0, 50.0);
        assert_eq!(once.to_bits(), twice.to_bits());
    }

    /// A blank field is absent rather than an empty string the hub would refuse.
    #[test]
    fn a_map_that_names_no_author_sends_none() {
        assert_eq!(some_text(Some(&"  ".to_string())), None);
        assert_eq!(some_text(None), None);
        assert_eq!(
            some_text(Some(&" Beherith ".to_string())),
            Some("Beherith".to_string())
        );
    }

    /// The blob carries what the map declared and nothing it did not, so a map
    /// that says nothing about its water produces no water keys rather than a
    /// set of defaults nobody chose.
    #[test]
    fn the_appearance_blob_holds_only_what_the_map_declared() {
        let app = MapAppearance {
            water_color: Some([0.1, 0.2, 0.3]),
            cloud_density: Some(0.5),
            ..Default::default()
        };
        let blob = appearance_blob(&app);
        assert_eq!(
            blob.keys().collect::<Vec<_>>(),
            ["cloudDensity", "waterColor"]
        );
        assert_eq!(blob["waterColor"], AppearanceValue::Colour([0.1, 0.2, 0.3]));
        // And it reaches the wire as the map wrote it rather than widened into a
        // JSON double.
        assert_eq!(
            serde_json::to_string(&blob).unwrap(),
            r#"{"cloudDensity":0.5,"waterColor":[0.1,0.2,0.3]}"#
        );
    }

    /// The two flags are facts of their own on the entry, so they are not also
    /// in the blob where they could disagree with themselves.
    #[test]
    fn the_void_flags_are_not_in_the_blob() {
        let app = MapAppearance {
            void_water: Some(true),
            void_ground: Some(true),
            ..Default::default()
        };
        assert!(appearance_blob(&app).is_empty());
    }

    /// A space map has no water plane at all, so it has no share of water to
    /// report. The hub refuses an entry carrying both, which makes this the one
    /// rule here that turns a good entry into a rejected one when it is wrong.
    #[test]
    fn a_void_water_map_reports_no_water_share() {
        let samples = vec![0u16; 16];
        assert_eq!(
            water_coverage(Some(&samples), (-50.0, 50.0), Some(true)),
            None
        );
        assert_eq!(
            water_coverage(Some(&samples), (-50.0, 50.0), Some(false)),
            Some(1.0)
        );
        assert_eq!(
            water_coverage(Some(&samples), (-50.0, 50.0), None),
            Some(1.0)
        );
    }

    /// A map whose heights will not read is not a map with no water, so the
    /// share is absent rather than zero.
    #[test]
    fn a_map_with_no_height_grid_reports_no_share_rather_than_none_of_it() {
        assert_eq!(water_coverage(None, (-50.0, 50.0), Some(false)), None);
        assert_eq!(water_coverage(Some(&[]), (-50.0, 50.0), Some(false)), None);
    }

    #[test]
    fn a_skip_reads_as_the_reason_it_names() {
        assert_eq!(
            serde_json::to_value(MapCatalogSkip::NoArchiveFile).unwrap(),
            serde_json::json!("no-archive-file")
        );
        assert_eq!(
            serde_json::to_value(MapCatalogSkip::NoHeightRange).unwrap(),
            serde_json::json!("no-height-range")
        );
    }

    fn listed(names: &[&str]) -> Vec<(i32, String)> {
        names
            .iter()
            .enumerate()
            .map(|(index, name)| (index as i32, (*name).to_string()))
            .collect()
    }

    /// The hub holds one row per map name and refuses a batch that names one
    /// twice, so a library listing a map as both an archive and an unpacked
    /// directory has to lose one before anything is sent. This machine has two
    /// such maps.
    #[test]
    fn a_map_installed_twice_is_walked_once_and_the_other_is_reported() {
        let (kept, dropped) = choose(
            listed(&["Isis 1.3", "AcidicQuarry 5.17", "AcidicQuarry 5.17"]),
            None,
        );
        assert_eq!(
            kept.iter()
                .map(|(_, name)| name.as_str())
                .collect::<Vec<_>>(),
            ["AcidicQuarry 5.17", "Isis 1.3"]
        );
        assert_eq!(dropped.len(), 1);
        assert_eq!(dropped[0].map_name, "AcidicQuarry 5.17");
        assert_eq!(dropped[0].reason, MapCatalogSkip::DuplicateMap);
    }

    /// Sorted by name, so two runs over one library produce the same order and
    /// the hub sees the same batches.
    #[test]
    fn the_walk_is_in_name_order_rather_than_in_scan_order() {
        let (kept, _) = choose(listed(&["Tabula 3", "Isis 1.3", "AcidicQuarry 5.17"]), None);
        assert_eq!(
            kept.iter()
                .map(|(_, name)| name.as_str())
                .collect::<Vec<_>>(),
            ["AcidicQuarry 5.17", "Isis 1.3", "Tabula 3"]
        );
        // And each keeps the index unitsync knows it by, which is what the facts
        // are read against.
        assert_eq!(kept[0].0, 2);
    }

    /// The second pass is told which maps the hub wanted, and reads no others.
    #[test]
    fn a_named_list_walks_those_maps_and_nothing_else() {
        let only = vec!["Tabula 3".to_string()];
        let (kept, dropped) = choose(
            listed(&["Isis 1.3", "Tabula 3", "Comet Catcher Remake 1.8"]),
            Some(&only),
        );
        assert_eq!(
            kept.iter()
                .map(|(_, name)| name.as_str())
                .collect::<Vec<_>>(),
            ["Tabula 3"]
        );
        assert!(dropped.is_empty());
    }

    /// A name nothing on this machine answers to is not an error and not a
    /// guess. The hub asked about a map this library no longer has.
    #[test]
    fn a_name_the_library_does_not_have_is_simply_absent() {
        let only = vec!["A Map Nobody Installed".to_string()];
        let (kept, dropped) = choose(listed(&["Isis 1.3"]), Some(&only));
        assert!(kept.is_empty());
        assert!(dropped.is_empty());
    }

    /// One real archive, read twice, against a real unitsync.
    ///
    /// Three claims at once: every field the hub requires is filled in, the two
    /// runs produce the same entry rather than a similar one, and the
    /// `source_hash` is the archive's own sha256 rather than something only this
    /// code agrees with. The last one is checked against the file directly, so a
    /// hash over the wrong bytes fails here rather than looking plausible.
    ///
    /// Runs the worker binary rather than calling in, because unitsync is a
    /// global C singleton that does not survive being loaded twice in one
    /// process, and because that is how a caller reaches this mode anyway.
    ///
    /// ```text
    /// COILBOX_LIVE_WORKER=target/release/coilbox-unitsync-worker \
    /// COILBOX_LIVE_UNITSYNC=~/.spring/libunitsync.dylib \
    /// COILBOX_LIVE_DATADIR=~/.spring \
    /// COILBOX_LIVE_MAP="AcidicQuarry 5.17" \
    ///   cargo test -p coilbox-unitsync-worker live_entry -- --ignored --nocapture
    /// ```
    #[test]
    #[ignore = "needs an engine and a map on the machine, so it cannot run in CI"]
    fn live_entry_is_complete_and_the_same_twice() {
        let env = |name: &str| {
            std::env::var(name).unwrap_or_else(|_| panic!("{name} names what to run against"))
        };
        let worker = env("COILBOX_LIVE_WORKER");
        let lib = env("COILBOX_LIVE_UNITSYNC");
        let datadir = env("COILBOX_LIVE_DATADIR");
        let map = env("COILBOX_LIVE_MAP");

        let run = || -> MapCatalogOutput {
            let out = std::process::Command::new(&worker)
                .args(["--lib", &lib, "--datadir", &datadir])
                .args(["--map", &map, "--map-catalog"])
                .output()
                .expect("the worker ran");
            assert!(out.status.success(), "the worker exited {}", out.status);
            serde_json::from_slice(&out.stdout).expect("the worker printed one JSON document")
        };

        let first = run();
        assert!(first.errors.is_empty(), "{:?}", first.errors);
        let entry = first.entry.expect("an entry");

        // Every field the hub's `parseMapSubmitBody` will not accept an entry
        // without.
        assert_eq!(entry.map_name, map);
        assert!(!entry.source_archive.is_empty());
        assert_eq!(entry.source_hash.len(), 64);
        assert_eq!(
            entry.catalog_version,
            coilbox_map_catalog::catalog_version()
        );
        assert!(entry.width_elmos > 0 && entry.height_elmos > 0);
        assert!(entry.world_height_max >= entry.world_height_min);
        let filename = entry.archive_filename.clone().expect("an archive file");
        println!(
            "{map}: {} x {} elmos, {} to {}, water {:?}, from {filename}",
            entry.width_elmos,
            entry.height_elmos,
            entry.world_height_min,
            entry.world_height_max,
            entry.water_coverage,
        );

        // The hash is the file's, checked against the file rather than against
        // this module's own opinion of it.
        let on_disk = std::path::Path::new(&datadir).join("maps").join(&filename);
        assert_eq!(
            hash_file(&on_disk.to_string_lossy()).expect("the archive reads"),
            entry.source_hash
        );

        let second = run().entry.expect("an entry");
        assert_eq!(second, entry, "two reads of one archive disagree");
    }
}
