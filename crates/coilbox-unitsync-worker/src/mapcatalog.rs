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

use crate::ffi::{MapAppearance, Unitsync};

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
) -> Result<MapCatalogEntry, MapCatalogSkip> {
    let archive_file = crate::archive::map_archive_file(us, map_index, map_name)
        .ok_or(MapCatalogSkip::NoArchiveFile)?;
    let source_hash = hash_file(&archive_file).ok_or(MapCatalogSkip::UnreadableArchive)?;
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

    let (min_wind, max_wind) = match wind {
        Some((mn, mx)) => (Some(mn), Some(mx)),
        None => (None, None),
    };

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
            // Metal spots are issue #1734 and geothermal vents are #1733. An
            // empty list here says "this extraction did not read them" rather
            // than "this map has none", which is why both issues bump the
            // catalog version when they land: the hub then takes the fuller
            // entry as an improvement rather than as a conflict.
            metal: Vec::new(),
            geo: Vec::new(),
        },
    })
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
    Some(format!("{:x}", hasher.finalize()))
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

/// Read one map's entry in a session of its own, which is the `--map-catalog`
/// mode.
pub fn read(lib: &str, map_name: &str) -> MapCatalogOutput {
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
        Some(index) => entry_in_session(&us, index, map_name),
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
