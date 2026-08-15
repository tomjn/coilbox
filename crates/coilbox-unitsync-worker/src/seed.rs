//! `--seed` mode: walk the local library once and write the hub's seed corpus
//! to a directory, with a manifest describing every file (issue #1638).
//!
//! The seed is the maintainer's own map collection and game installs, committed
//! straight into the hub's assets repo rather than uploaded, because seeding two
//! thousand minimaps is a month's entire upload allowance. Extraction cannot
//! happen at that end: reading a minimap, an overlay or a build pic out of an
//! archive means unitsync, which lives here.
//!
//! Coilbox encodes and the hub commits what it is handed. Two encoders on one
//! corpus would disagree about alpha and about what q80 means, and
//! `encodeProfile` would name two different things, so every byte in the corpus
//! comes out of [`crate::assetencode`] and nothing is left half-done for a
//! script at the other end.
//!
//! ## What it enumerates
//!
//! Through unitsync's own `GetMapCount` and `GetPrimaryModCount`, never by
//! globbing the filesystem for archives. Beyond All Reason installs through the
//! rapid pool as a `.sdp` package, so a walker that looked for `.sd7`, `.sdz`
//! and `.sdd` would miss the single most played game and still look like it
//! worked (`archive.rs:127`).
//!
//! ## What it writes
//!
//! ```text
//! <root>/manifest.json      every asset, in a stable order, with both hashes
//! <root>/batch-0001/<sha256>.webp
//! <root>/batch-0002/...
//! ```
//!
//! Batching is the hub's problem and a real one: a GitHub Pages deploy times out
//! at ten minutes and the height overlays alone run to a hundred megabytes. Each
//! batch is a directory the hub can commit and publish on its own, and every row
//! names the batch it is in, so a consumer records the last batch it committed
//! and starts at the next one. Re-committing a batch it already has is harmless,
//! because a file is named after the hash of its own bytes.
//!
//! ## Renders are not here
//!
//! `render:<angle>` scales with units times angles and needs a GPU pass nothing
//! in this worker has. The seed is maps and build pics.

use crate::ffi::Unitsync;
use crate::model::{BuildpicSkip, MapOverlayAsset, MapOverlaySkip};
use serde::Serialize;
use std::collections::{BTreeMap, HashMap};
use std::path::{Path, PathBuf};

/// The manifest format. Bumped when a consumer would read the same document
/// wrongly, not when a field is added.
const MANIFEST_VERSION: u32 = 1;

/// Which tier the hub files these rows under. The seed is committed to the
/// assets repo and never passes through the staging store (spec section 4.7).
const SEED_TIER: &str = "static";

/// How many bytes of assets go in one batch directory before the next one
/// starts.
///
/// The consumer publishes a batch per deploy against a ten minute timeout, and
/// the whole corpus on this machine is about 160 MB, so this is a handful of
/// deploys rather than one that will not finish. It is a soft cap: an asset is
/// never split, so a batch overshoots by at most one file.
const BATCH_BYTES: u64 = 32 * 1024 * 1024;

/// Where an extractor writes before the walk files it into a batch. Assets are
/// named after their own hash, which is not known until the bytes exist, so the
/// batch is chosen after the encode rather than before it.
const STAGING_DIR: &str = "staging";

/// One asset in the corpus: everything the hub needs to write its row and
/// commit the file, and nothing it would have to derive.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SeedAsset {
    /// `unit` or `map`, which is also which of the two key shapes is filled in.
    /// They do not unify: a unit is `(game, unitName, variant)` and a map is
    /// `(mapName, variant)`.
    pub kind: &'static str,
    /// The game's modinfo shortname, never its archive name and never a
    /// version. Unit assets only.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub game: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub unit_name: Option<String>,
    /// unitsync's versioned name for the map, version string included and never
    /// split off. Map assets only.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub map_name: Option<String>,
    pub variant: String,
    /// How the bytes were produced, off the asset rather than assumed here, so
    /// the manifest cannot disagree with what the extractor said (#1678).
    pub origin: String,
    pub tier: &'static str,
    /// Which batch directory holds the file, and what a resuming consumer
    /// counts in.
    pub batch: u32,
    /// Where the bytes are, relative to the seed root.
    pub file: String,
    /// sha256 of the encoded bytes, and the file's name.
    pub hash: String,
    /// sha256 of the archive bytes or infomap samples this came from. What
    /// identity and dedupe compare on, because it does not move when the
    /// encoder does.
    pub source_hash: String,
    pub encode_profile: String,
    pub mime: String,
    /// The encoded picture's own pixels.
    pub width: u32,
    pub height: u32,
    pub bytes: u64,
    /// The map's size in elmos, which is what an overlay is lined up against
    /// and what the hub's `map_width` and `map_height` hold. Map assets only.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub map_width: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub map_height: Option<u32>,
    /// World height at sample 0 and at sample 65535, for `overlay:height`.
    /// Nothing downstream can recover them from the image.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub min_height: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_height: Option<f32>,
    /// The name the archive the bytes came out of declares for itself. Off the
    /// asset, so this is the archive the extractor read rather than the one the
    /// walk went looking for. Provenance, never identity.
    pub source_archive: String,
    /// The member inside that archive, for a build pic. A map overlay has none:
    /// unitsync derives it from the map file rather than handing back a member.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_member: Option<String>,
}

/// Why something in the library produced no asset. Each reason is a different
/// answer and only some of them are anyone's bug.
#[derive(Serialize, Clone, Copy)]
#[serde(untagged)]
pub enum SeedSkipReason {
    Overlay(MapOverlaySkip),
    Buildpic(BuildpicSkip),
    /// A reason about the walk rather than about one picture.
    Walk(&'static str),
}

/// A game with no modinfo shortname, which the engine does not allow, so it is
/// broken rather than unusual.
const NO_SHORTNAME: &str = "no-shortname";

/// Another install of the same game won the shortname. The hub keeps one set of
/// unit assets per shortname (spec section 10), so several installed versions
/// of one game are one game here.
const SUPERSEDED: &str = "superseded";

/// The vocabulary lists a map variant this walk has no extractor for, which is
/// a coilbox bug and says so rather than reading as a map with no picture.
const NO_EXTRACTOR: &str = "no-extractor";

/// A second install of a map already in the corpus. The map's name is its whole
/// identity, so two archives answering to one name are one map here.
const DUPLICATE_MAP: &str = "duplicate-map";

/// One thing that is in the library and not in the corpus.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SeedSkip {
    pub kind: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub game: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub unit_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub map_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub variant: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_archive: Option<String>,
    pub reason: SeedSkipReason,
}

/// One batch directory: what a consumer commits and publishes in one go.
#[derive(Serialize, Default, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SeedBatch {
    pub index: u32,
    pub dir: String,
    pub files: u32,
    pub bytes: u64,
}

/// One game the walk considered, seeded or not.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SeedGame {
    /// The display name from modinfo, for a human reading the manifest.
    pub name: String,
    /// The identity key's game component. Absent means the game is broken and
    /// was skipped.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub shortname: Option<String>,
    pub archive: String,
    /// Units the game declares.
    pub units: u32,
    /// Build pics written for it.
    pub assets: u32,
    pub seeded: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<&'static str>,
}

/// Per variant totals, which is how a run is checked against what the layer it
/// came from measured on its own.
#[derive(Serialize, Default, Clone)]
#[serde(rename_all = "camelCase")]
pub struct VariantTotals {
    /// Rows carrying this variant.
    pub assets: u32,
    /// Distinct encoded files behind them. Lower when two maps share a layer.
    pub files: u32,
    /// Bytes those distinct files take on disk.
    pub bytes: u64,
    /// Rows that could have carried it and did not.
    pub skipped: u32,
}

/// The manifest written to `<root>/manifest.json`.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SeedManifest {
    pub manifest_version: u32,
    /// The engine whose unitsync read the archives.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sync_version: Option<String>,
    pub batch_bytes: u64,
    pub batches: Vec<SeedBatch>,
    pub variants: BTreeMap<String, VariantTotals>,
    pub games: Vec<SeedGame>,
    pub assets: Vec<SeedAsset>,
    pub skipped: Vec<SeedSkip>,
    pub errors: Vec<String>,
}

/// What a walk that wrote nothing would have produced.
#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SeedPlan {
    pub maps: u32,
    /// Four variants per map, which is every layer the vocabulary lists.
    pub map_assets: u32,
    pub units: u32,
    /// One per unit at most. A unit the game ships no build pic for produces
    /// none, and this cannot say which without reading the archives.
    pub unit_assets_at_most: u32,
    /// Every game that would be seeded, with the roster it declares. A game
    /// showing no units is one whose defs coilbox cannot read, which is worth
    /// seeing before a run rather than after it.
    pub games: Vec<SeedGame>,
    /// The installs that would not be, and why.
    pub skipped: Vec<SeedSkip>,
}

/// What the mode prints on stdout: the shape of the corpus, not the corpus.
#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SeedOutput {
    /// Where the manifest was written. Absent on a dry run.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub manifest: Option<String>,
    pub dry_run: bool,
    pub maps: u32,
    pub games: u32,
    pub assets: u32,
    pub skipped: u32,
    /// Distinct files written, which is below `assets` wherever two maps share
    /// a layer.
    pub files: u32,
    pub bytes: u64,
    pub batches: Vec<SeedBatch>,
    pub variants: BTreeMap<String, VariantTotals>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub planned: Option<SeedPlan>,
    pub errors: Vec<String>,
}

/// Walk the library and write the corpus under `root`.
///
/// `dry_run` reads the library and writes nothing: it reports how many maps and
/// games are installed, how many units those games declare, and which games are
/// skipped and why. It deliberately does not encode anything, so it cannot
/// report byte counts, because the only way to know what a picture encodes to
/// is to encode it.
pub fn run(lib: &str, root: &Path, cache_dir: Option<&Path>, dry_run: bool) -> SeedOutput {
    let us = match unsafe { Unitsync::load(Path::new(lib)) } {
        Ok(u) => u,
        Err(e) => {
            return SeedOutput {
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

    let sync_version = us.spring_version();
    let (maps, duplicates) = map_names(&us);
    let (games, mut skipped) = choose_games(&us);
    skipped.extend(duplicates);

    let mut walk = Walk::new(root.to_path_buf());
    let mut game_rows = Vec::new();

    if !dry_run {
        for map in &maps {
            walk.map(&us, map, cache_dir, &mut skipped);
        }
    }
    for game in &games {
        game_rows.push(walk.game(&us, game, cache_dir, dry_run, &mut skipped, &mut errors));
    }

    errors.extend(us.drain_errors());
    us.uninit();

    let planned = dry_run.then(|| SeedPlan {
        maps: maps.len() as u32,
        map_assets: maps.len() as u32 * coilbox_assets::vocabulary().map_variants.len() as u32,
        units: game_rows.iter().map(|g| g.units).sum(),
        unit_assets_at_most: game_rows.iter().map(|g| g.units).sum(),
        games: game_rows.clone(),
        skipped: skipped.clone(),
    });

    // A batch nobody wrote into is not a batch. The indices rows carry stay
    // valid, because only the trailing empty one can ever be dropped.
    walk.batches.retain(|b| b.files > 0);

    let manifest = SeedManifest {
        manifest_version: MANIFEST_VERSION,
        sync_version,
        batch_bytes: BATCH_BYTES,
        batches: walk.batches.clone(),
        variants: walk.variants.clone(),
        games: game_rows,
        assets: walk.assets,
        skipped,
        errors: errors.clone(),
    };

    let written = if dry_run {
        None
    } else {
        match write_manifest(root, &manifest) {
            Ok(path) => Some(path),
            Err(e) => {
                errors.push(e);
                None
            }
        }
    };

    SeedOutput {
        manifest: written,
        dry_run,
        maps: maps.len() as u32,
        games: manifest.games.iter().filter(|g| g.seeded).count() as u32,
        assets: manifest.assets.len() as u32,
        skipped: manifest.skipped.len() as u32,
        files: walk.batches.iter().map(|b| b.files).sum(),
        bytes: walk.batches.iter().map(|b| b.bytes).sum(),
        batches: walk.batches,
        variants: manifest.variants.clone(),
        planned,
        errors,
    }
}

/// Every map unitsync knows, in name order, and the second install of any map
/// listed twice.
///
/// Sorted rather than left in index order so two runs of the same library
/// produce the same batches, whatever order the archive scanner happened to
/// walk the directories in.
///
/// Deduped because the map's name is the whole of its identity: a library
/// holding the same map as both an `.sd7` and an unpacked directory lists it
/// twice, and the hub's key would collide on the second row. The one that is
/// dropped is reported rather than swallowed, since two installs of one map is
/// something a maintainer would want to know about their own library.
fn map_names(us: &Unitsync) -> (Vec<String>, Vec<SeedSkip>) {
    dedupe_map_names((0..us.map_count()).filter_map(|i| us.map_name(i)).collect())
}

/// The sort and the dedupe [`map_names`] applies, without the session it takes
/// to read a name.
fn dedupe_map_names(mut names: Vec<String>) -> (Vec<String>, Vec<SeedSkip>) {
    names.sort();

    let mut kept: Vec<String> = Vec::with_capacity(names.len());
    let mut duplicates = Vec::new();
    for name in names {
        if kept.last() == Some(&name) {
            duplicates.push(SeedSkip {
                kind: "map",
                game: None,
                unit_name: None,
                map_name: Some(name),
                variant: None,
                source_archive: None,
                reason: SeedSkipReason::Walk(DUPLICATE_MAP),
            });
            continue;
        }
        kept.push(name);
    }
    (kept, duplicates)
}

/// One installed game, before the walk decides whether to seed it.
struct GameInstall {
    name: String,
    shortname: String,
    archive: String,
    /// When the archive was last written, which is how two installs of one game
    /// are told apart.
    installed_at: u64,
}

/// The games to seed, and the ones that will not be, with the reason.
///
/// Two rules, both from the hub's key. A game with no modinfo shortname has no
/// key at all: the engine does not allow one, so the game is broken and is
/// flagged rather than filed under its archive name, which would pin the assets
/// to one build and is the opposite of what a key meant to survive a version
/// bump wants (issue #1383).
///
/// And the hub keeps one set of unit assets per shortname, so four installed
/// SplinterFaction releases are one game here. The newest install wins, by
/// archive mtime rather than by parsing the version string: a version is
/// whatever the game's author typed, `$VERSION` unexpanded in a development
/// checkout included, and an ordering invented for it would be a guess dressed
/// up as a rule. Ties break on the archive name so the choice is stable.
fn choose_games(us: &Unitsync) -> (Vec<GameInstall>, Vec<SeedSkip>) {
    let mut skipped = Vec::new();
    let mut by_shortname: HashMap<String, Vec<GameInstall>> = HashMap::new();

    for i in 0..us.mod_count() {
        let archive = us.mod_archive(i).unwrap_or_default();
        let info = us.mod_info(i);
        let name = info.get("name").cloned().unwrap_or_else(|| archive.clone());
        let shortname = info
            .get("shortname")
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty());
        let Some(shortname) = shortname else {
            skipped.push(SeedSkip {
                kind: "game",
                game: Some(name),
                unit_name: None,
                map_name: None,
                variant: None,
                source_archive: Some(archive),
                reason: SeedSkipReason::Walk(NO_SHORTNAME),
            });
            continue;
        };
        let installed_at = archive_mtime(us, &archive);
        by_shortname
            .entry(shortname.clone())
            .or_default()
            .push(GameInstall {
                name,
                shortname,
                archive,
                installed_at,
            });
    }

    let mut chosen = Vec::new();
    for (_, mut installs) in by_shortname {
        installs.sort_by(|a, b| {
            b.installed_at
                .cmp(&a.installed_at)
                .then_with(|| a.archive.cmp(&b.archive))
        });
        let mut it = installs.into_iter();
        let winner = it.next().expect("a shortname with no install");
        for loser in it {
            skipped.push(SeedSkip {
                kind: "game",
                game: Some(loser.shortname),
                unit_name: None,
                map_name: None,
                variant: None,
                source_archive: Some(loser.archive),
                reason: SeedSkipReason::Walk(SUPERSEDED),
            });
        }
        chosen.push(winner);
    }
    chosen.sort_by(|a, b| a.shortname.cmp(&b.shortname));
    (chosen, skipped)
}

/// When an archive was last written, or 0 when it does not resolve to a file.
fn archive_mtime(us: &Unitsync, archive: &str) -> u64 {
    let Some(dir) = us.archive_path(archive) else {
        return 0;
    };
    std::fs::metadata(Path::new(&dir).join(archive))
        .ok()
        .and_then(|md| md.modified().ok())
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// The walk's running state: the batch being filled, what has been written, and
/// the rows describing it.
struct Walk {
    root: PathBuf,
    batches: Vec<SeedBatch>,
    assets: Vec<SeedAsset>,
    variants: BTreeMap<String, VariantTotals>,
    /// Encoded hash to the file already holding those bytes, so the same layer
    /// on two maps is stored once rather than once per map.
    placed: HashMap<String, String>,
}

impl Walk {
    fn new(root: PathBuf) -> Self {
        Self {
            root,
            batches: vec![SeedBatch {
                index: 1,
                dir: batch_dir_name(1),
                files: 0,
                bytes: 0,
            }],
            assets: Vec::new(),
            variants: BTreeMap::new(),
            placed: HashMap::new(),
        }
    }

    /// Where extractors write before a file is filed into a batch.
    fn staging(&self) -> PathBuf {
        self.root.join(STAGING_DIR)
    }

    /// Every variant of one map, in the order the vocabulary lists them.
    ///
    /// The list is the vocabulary's rather than this module's, so a layer added
    /// there arrives here as an error naming it rather than as a map quietly
    /// missing a picture.
    fn map(
        &mut self,
        us: &Unitsync,
        map_name: &str,
        cache_dir: Option<&Path>,
        skipped: &mut Vec<SeedSkip>,
    ) {
        // Only the skips need this here. An asset carries its own, resolved by
        // the extractor that read it.
        let source_archive = crate::archive::archive_name_for_map(us, map_name);
        let (map_width, map_height) = crate::minimap::map_elmos(us, map_name, cache_dir);
        let staging = self.staging();

        for variant in &coilbox_assets::vocabulary().map_variants {
            let extracted = match variant.as_str() {
                "minimap" => Some(crate::minimap::asset_in_session(us, map_name, &staging)),
                "overlay:metal" => Some(crate::metalmap::asset_in_session(us, map_name, &staging)),
                "overlay:type" => Some(crate::typemap::asset_in_session(us, map_name, &staging)),
                "overlay:height" => {
                    Some(crate::heightmap::asset_in_session(us, map_name, &staging))
                }
                _ => None,
            };
            let reason = match extracted {
                Some((Some(asset), _)) => {
                    self.place_map_asset(map_name, asset, map_width, map_height);
                    continue;
                }
                Some((None, why)) => {
                    SeedSkipReason::Overlay(why.unwrap_or(MapOverlaySkip::NoSource))
                }
                None => SeedSkipReason::Walk(NO_EXTRACTOR),
            };
            self.count_skip(variant);
            skipped.push(SeedSkip {
                kind: "map",
                game: None,
                unit_name: None,
                map_name: Some(map_name.to_string()),
                variant: Some(variant.clone()),
                source_archive: Some(source_archive.clone()),
                reason,
            });
        }
    }

    /// One game's build pics: read its roster, then resolve a picture for every
    /// unit in it.
    fn game(
        &mut self,
        us: &Unitsync,
        game: &GameInstall,
        cache_dir: Option<&Path>,
        dry_run: bool,
        skipped: &mut Vec<SeedSkip>,
        errors: &mut Vec<String>,
    ) -> SeedGame {
        let dataset = crate::dataset::resolve(us, &game.archive, cache_dir);
        for e in &dataset.errors {
            errors.push(format!("{}: {e}", game.shortname));
        }
        let units: Vec<String> = dataset.units.iter().map(|u| u.name.clone()).collect();
        let mut row = SeedGame {
            name: game.name.clone(),
            shortname: Some(game.shortname.clone()),
            archive: game.archive.clone(),
            units: units.len() as u32,
            assets: 0,
            seeded: true,
            reason: None,
        };
        if dry_run || units.is_empty() {
            return row;
        }

        let staging = self.staging();
        let out = crate::buildpic::resolve(us, &game.archive, &units, cache_dir, Some(&staging));
        for e in &out.errors {
            errors.push(format!("{}: {e}", game.shortname));
        }
        let variant = coilbox_assets::vocabulary().unit.buildpic_variant.clone();
        for (unit, display) in out.units {
            match display.asset {
                Some(asset) => {
                    self.place_unit_asset(game, &unit, asset);
                    row.assets += 1;
                }
                None => {
                    self.count_skip(&variant);
                    skipped.push(SeedSkip {
                        kind: "unit",
                        game: Some(game.shortname.clone()),
                        unit_name: Some(unit),
                        map_name: None,
                        variant: Some(variant.clone()),
                        source_archive: Some(game.archive.clone()),
                        reason: SeedSkipReason::Buildpic(
                            display.asset_skipped.unwrap_or(BuildpicSkip::NoSource),
                        ),
                    });
                }
            }
        }
        row
    }

    fn place_map_asset(
        &mut self,
        map_name: &str,
        asset: MapOverlayAsset,
        map_width: Option<u32>,
        map_height: Option<u32>,
    ) {
        let (batch, file) = self.file_away(&asset.path, &asset.hash, asset.bytes, &asset.variant);
        self.assets.push(SeedAsset {
            kind: "map",
            game: None,
            unit_name: None,
            map_name: Some(map_name.to_string()),
            variant: asset.variant,
            origin: asset.origin,
            tier: SEED_TIER,
            batch,
            file,
            hash: asset.hash,
            source_hash: asset.source_hash,
            encode_profile: asset.encode_profile,
            mime: asset.mime,
            width: asset.width,
            height: asset.height,
            bytes: asset.bytes,
            map_width,
            map_height,
            min_height: asset.min_height,
            max_height: asset.max_height,
            source_archive: asset.source_archive,
            source_member: None,
        });
    }

    fn place_unit_asset(
        &mut self,
        game: &GameInstall,
        unit: &str,
        asset: crate::model::UnitBuildpicAsset,
    ) {
        let (batch, file) = self.file_away(&asset.path, &asset.hash, asset.bytes, &asset.variant);
        self.assets.push(SeedAsset {
            kind: "unit",
            game: Some(game.shortname.clone()),
            unit_name: Some(unit.to_string()),
            map_name: None,
            variant: asset.variant,
            origin: asset.origin,
            tier: SEED_TIER,
            batch,
            file,
            hash: asset.hash,
            source_hash: asset.source_hash,
            encode_profile: asset.encode_profile,
            mime: asset.mime,
            width: asset.width,
            height: asset.height,
            bytes: asset.bytes,
            map_width: None,
            map_height: None,
            min_height: None,
            max_height: None,
            source_archive: asset.source_archive,
            source_member: Some(asset.source_member),
        });
    }

    /// Move a freshly encoded file out of staging and into the current batch,
    /// returning the batch it landed in and its path relative to the seed root.
    ///
    /// Bytes already in the corpus are dropped rather than stored twice: 98 maps
    /// share 62 type maps between them, and a second copy would cost the
    /// consumer a commit for a file it already has.
    fn file_away(&mut self, staged: &str, hash: &str, bytes: u64, variant: &str) -> (u32, String) {
        let totals = self.variants.entry(variant.to_string()).or_default();
        totals.assets += 1;

        if let Some(existing) = self.placed.get(hash) {
            let existing = existing.clone();
            if Path::new(staged) != self.root.join(&existing) {
                let _ = std::fs::remove_file(staged);
            }
            let batch = batch_index_of(&existing);
            return (batch, existing);
        }

        let batch = self.current_batch();
        let name = Path::new(staged)
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_else(|| hash.to_string());
        let relative = format!("{}/{name}", batch_dir_name(batch));
        let destination = self.root.join(&relative);
        if let Some(dir) = destination.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        let _ = std::fs::rename(staged, &destination);

        self.placed.insert(hash.to_string(), relative.clone());
        if let Some(entry) = self.batches.last_mut() {
            entry.files += 1;
            entry.bytes += bytes;
        }
        let totals = self.variants.entry(variant.to_string()).or_default();
        totals.files += 1;
        totals.bytes += bytes;
        (batch, relative)
    }

    fn count_skip(&mut self, variant: &str) {
        self.variants
            .entry(variant.to_string())
            .or_default()
            .skipped += 1;
    }

    /// The batch to write into, starting a new one when the current is full.
    fn current_batch(&mut self) -> u32 {
        let full = self
            .batches
            .last()
            .map(|b| b.bytes >= BATCH_BYTES)
            .unwrap_or(true);
        if full {
            let index = self.batches.len() as u32 + 1;
            self.batches.push(SeedBatch {
                index,
                dir: batch_dir_name(index),
                files: 0,
                bytes: 0,
            });
        }
        self.batches.last().map(|b| b.index).unwrap_or(1)
    }
}

/// The directory one batch's files live in, zero padded so a directory listing
/// sorts the way the manifest does.
fn batch_dir_name(index: u32) -> String {
    format!("batch-{index:04}")
}

/// The batch a manifest path names, for a row pointing at bytes an earlier row
/// already filed.
fn batch_index_of(relative: &str) -> u32 {
    relative
        .split('/')
        .next()
        .and_then(|d| d.strip_prefix("batch-"))
        .and_then(|n| n.parse().ok())
        .unwrap_or(1)
}

/// Write the manifest, and clear the staging directory, which is empty once
/// every encoded file has been filed into a batch.
fn write_manifest(root: &Path, manifest: &SeedManifest) -> Result<String, String> {
    std::fs::create_dir_all(root)
        .map_err(|e| format!("could not create {}: {e}", root.display()))?;
    let path = root.join("manifest.json");
    let json = serde_json::to_vec_pretty(manifest)
        .map_err(|e| format!("could not serialize the manifest: {e}"))?;
    std::fs::write(&path, json).map_err(|e| format!("could not write {}: {e}", path.display()))?;
    let _ = std::fs::remove_dir(root.join(STAGING_DIR));
    Ok(path.to_string_lossy().into_owned())
}

/// Print a seed error envelope to stdout (used on panic, and when the mode is
/// asked for without somewhere to write).
pub fn emit_error(msg: String) {
    let out = SeedOutput {
        errors: vec![msg],
        ..Default::default()
    };
    println!("{}", serde_json::to_string(&out).unwrap_or_default());
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::assetencode::sha256_hex;

    /// A hash-shaped name, so a test can talk about bytes without encoding any.
    fn test_hash(seed: &str) -> String {
        sha256_hex(seed.as_bytes())
    }

    fn temp_root(tag: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("coilbox-seed-test-{}-{tag}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        dir
    }

    /// Put `bytes` in staging under a hash-named file, the way an extractor
    /// leaves one behind.
    fn stage(walk: &Walk, hash: &str, bytes: &[u8]) -> String {
        let dir = walk.staging();
        std::fs::create_dir_all(&dir).expect("staging");
        let path = dir.join(format!("{hash}.webp"));
        std::fs::write(&path, bytes).expect("write");
        path.to_string_lossy().into_owned()
    }

    /// Every variant the vocabulary lists has an extractor here. A layer added
    /// to the shared document with no walk behind it would otherwise show up as
    /// a map quietly missing a picture.
    #[test]
    fn the_walk_covers_every_map_variant_the_vocabulary_lists() {
        for variant in &coilbox_assets::vocabulary().map_variants {
            assert!(
                matches!(
                    variant.as_str(),
                    "minimap" | "overlay:metal" | "overlay:type" | "overlay:height"
                ),
                "no seed extractor for {variant}"
            );
        }
        // And the unit side's one variant, which is not in that list.
        assert_eq!(
            coilbox_assets::vocabulary().unit.buildpic_variant,
            "buildpic"
        );
    }

    #[test]
    fn files_are_written_into_batches_and_named_after_their_hash() {
        let root = temp_root("batches");
        let mut walk = Walk::new(root.clone());
        let hash = test_hash("one");
        let staged = stage(&walk, &hash, b"some encoded bytes");

        let (batch, file) = walk.file_away(&staged, &hash, 18, "minimap");
        assert_eq!(batch, 1);
        assert_eq!(file, format!("batch-0001/{hash}.webp"));
        assert!(
            root.join(&file).exists(),
            "the file did not reach its batch"
        );
        assert!(!Path::new(&staged).exists(), "staging still holds it");
        assert_eq!(walk.batches[0].files, 1);
        assert_eq!(walk.batches[0].bytes, 18);
        let _ = std::fs::remove_dir_all(&root);
    }

    /// 98 maps share 62 type maps here, so the same bytes arriving twice cost
    /// the consumer one commit rather than two.
    #[test]
    fn the_same_bytes_from_two_maps_are_stored_once() {
        let root = temp_root("dedupe");
        let mut walk = Walk::new(root.clone());
        let hash = test_hash("shared");

        let first = stage(&walk, &hash, b"identical");
        let (_, one) = walk.file_away(&first, &hash, 9, "overlay:type");
        let second = stage(&walk, &hash, b"identical");
        let (_, two) = walk.file_away(&second, &hash, 9, "overlay:type");

        assert_eq!(one, two);
        assert!(!Path::new(&second).exists(), "the second copy was kept");
        assert_eq!(walk.batches[0].files, 1, "counted the same file twice");
        assert_eq!(walk.batches[0].bytes, 9);
        // Both maps still get a row: two assets, one file.
        let totals = &walk.variants["overlay:type"];
        assert_eq!((totals.assets, totals.files), (2, 1));
        let _ = std::fs::remove_dir_all(&root);
    }

    /// The batch is what a consumer commits in one deploy, so it has to roll
    /// before a directory grows past what one deploy can publish.
    #[test]
    fn a_full_batch_rolls_over_to_the_next_one() {
        let root = temp_root("roll");
        let mut walk = Walk::new(root.clone());

        let big = test_hash("big");
        let staged = stage(&walk, &big, b"x");
        let (first, _) = walk.file_away(&staged, &big, BATCH_BYTES, "overlay:height");
        assert_eq!(first, 1);

        let next = test_hash("next");
        let staged = stage(&walk, &next, b"y");
        let (second, file) = walk.file_away(&staged, &next, 1, "overlay:height");
        assert_eq!(second, 2);
        assert!(file.starts_with("batch-0002/"));
        assert_eq!(walk.batches.len(), 2);
        assert_eq!(batch_index_of(&file), 2);
        let _ = std::fs::remove_dir_all(&root);
    }

    /// A dedupe hit points back at whichever batch the bytes are in, which is
    /// not always the one being filled.
    #[test]
    fn a_repeat_of_an_earlier_batchs_bytes_keeps_naming_that_batch() {
        let root = temp_root("back-reference");
        let mut walk = Walk::new(root.clone());

        let shared = test_hash("shared");
        let staged = stage(&walk, &shared, b"z");
        let (_, first) = walk.file_away(&staged, &shared, BATCH_BYTES, "minimap");

        let other = test_hash("other");
        let staged = stage(&walk, &other, b"w");
        let (batch, _) = walk.file_away(&staged, &other, 1, "minimap");
        assert_eq!(batch, 2);

        let staged = stage(&walk, &shared, b"z");
        let (again, path) = walk.file_away(&staged, &shared, BATCH_BYTES, "minimap");
        assert_eq!((again, path), (1, first));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn batch_directories_sort_the_way_the_manifest_is_ordered() {
        let mut names: Vec<String> = (1..=11).map(batch_dir_name).collect();
        let ordered = names.clone();
        names.sort();
        assert_eq!(names, ordered);
        assert_eq!(batch_dir_name(1), "batch-0001");
    }

    #[test]
    fn the_manifest_lands_beside_the_batches_and_staging_is_cleared() {
        let root = temp_root("manifest");
        let manifest = SeedManifest {
            manifest_version: MANIFEST_VERSION,
            sync_version: Some("test-engine".into()),
            batch_bytes: BATCH_BYTES,
            batches: Vec::new(),
            variants: BTreeMap::new(),
            games: Vec::new(),
            assets: Vec::new(),
            skipped: Vec::new(),
            errors: Vec::new(),
        };
        std::fs::create_dir_all(root.join(STAGING_DIR)).expect("staging");
        let path = write_manifest(&root, &manifest).expect("write");

        assert_eq!(path, root.join("manifest.json").to_string_lossy());
        assert!(!root.join(STAGING_DIR).exists(), "staging was left behind");
        let raw = std::fs::read_to_string(&path).expect("read");
        let parsed: serde_json::Value = serde_json::from_str(&raw).expect("parse");
        assert_eq!(parsed["manifestVersion"], MANIFEST_VERSION);
        assert_eq!(parsed["syncVersion"], "test-engine");
        let _ = std::fs::remove_dir_all(&root);
    }

    /// The manifest has to say enough for the hub to write its row without
    /// deriving anything: both hashes, the profile, the pixels, the map's size
    /// in elmos and where the bytes came from.
    #[test]
    fn a_map_row_carries_everything_the_hub_writes_on_its_row() {
        let root = temp_root("map-row");
        let mut walk = Walk::new(root.clone());
        let hash = test_hash("height");
        let staged = stage(&walk, &hash, b"height bytes");
        walk.place_map_asset(
            "Comet Catcher Remake 1.8",
            MapOverlayAsset {
                variant: "overlay:height".into(),
                origin: "extracted".into(),
                source_archive: "Comet Catcher Remake 1.8".into(),
                path: staged,
                hash: hash.clone(),
                source_hash: test_hash("samples"),
                encode_profile: "png16-lossless-source".into(),
                mime: "image/png".into(),
                width: 1025,
                height: 769,
                bytes: 12,
                min_height: Some(-40.0),
                max_height: Some(620.5),
            },
            Some(8192),
            Some(6144),
        );

        let json = serde_json::to_value(&walk.assets[0]).expect("serialize");
        assert_eq!(json["kind"], "map");
        assert_eq!(json["mapName"], "Comet Catcher Remake 1.8");
        assert_eq!(json["variant"], "overlay:height");
        assert_eq!(json["origin"], "extracted");
        assert_eq!(json["tier"], "static");
        assert_eq!(json["hash"], hash);
        assert_eq!(json["sourceHash"], test_hash("samples"));
        assert_eq!(json["encodeProfile"], "png16-lossless-source");
        assert_eq!(json["mapWidth"], 8192);
        assert_eq!(json["mapHeight"], 6144);
        assert_eq!(json["minHeight"], -40.0);
        assert_eq!(json["maxHeight"], 620.5);
        assert_eq!(json["sourceArchive"], "Comet Catcher Remake 1.8");
        assert_eq!(json["batch"], 1);
        assert_eq!(json["file"], format!("batch-0001/{hash}.webp"));
        // A map layer has no archive member behind it, so the field is absent
        // rather than empty.
        assert!(json.get("sourceMember").is_none());
        assert!(json.get("game").is_none());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn a_unit_row_is_keyed_on_the_shortname_and_never_the_archive() {
        let root = temp_root("unit-row");
        let mut walk = Walk::new(root.clone());
        let hash = test_hash("pic");
        let staged = stage(&walk, &hash, b"pic bytes");
        let game = GameInstall {
            name: "Beyond All Reason test-30922".into(),
            shortname: "BYAR".into(),
            archive: "ded9b29714a05164e4b4523b09809af2.sdp".into(),
            installed_at: 0,
        };
        walk.place_unit_asset(
            &game,
            "armcom",
            crate::model::UnitBuildpicAsset {
                variant: "buildpic".into(),
                origin: "extracted".into(),
                source_archive: "Beyond All Reason test-30922-8064a43".into(),
                path: staged,
                hash: hash.clone(),
                source_hash: test_hash("dds"),
                source_member: "unitpics/armcom.dds".into(),
                encode_profile: "webp-lossless-256".into(),
                mime: "image/webp".into(),
                width: 128,
                height: 128,
                bytes: 9,
            },
        );

        let json = serde_json::to_value(&walk.assets[0]).expect("serialize");
        assert_eq!(json["kind"], "unit");
        assert_eq!(json["game"], "BYAR");
        assert_eq!(json["unitName"], "armcom");
        assert_eq!(json["variant"], "buildpic");
        assert_eq!(json["sourceMember"], "unitpics/armcom.dds");
        assert_eq!(json["origin"], "extracted");
        // Off the asset, so it is the archive's own versioned name and not the
        // `GameInstall`'s file name, which for a rapid install is a pool hash.
        assert_eq!(
            json["sourceArchive"],
            "Beyond All Reason test-30922-8064a43"
        );
        // A unit is not a map: no map name, no elmos, no height bounds.
        assert!(json.get("mapName").is_none());
        assert!(json.get("mapWidth").is_none());
        assert!(json.get("minHeight").is_none());
        let _ = std::fs::remove_dir_all(&root);
    }

    /// A map's name is its whole identity, so a library holding the same map
    /// twice is one map in the corpus. Small_Supreme_Battlefield_V3 is
    /// installed twice on the machine this was written on, and without this
    /// every one of its four layers went in under a key the hub holds unique.
    #[test]
    fn a_map_installed_twice_is_one_map() {
        let names = ["Cc 3.0", "Bb 2.0", "Aa 1.0", "Bb 2.0"].map(str::to_string);
        let (kept, dropped) = dedupe_map_names(names.to_vec());

        // Sorted, so the batches a library produces do not depend on the order
        // the archive scanner happened to walk it in.
        assert_eq!(kept, ["Aa 1.0", "Bb 2.0", "Cc 3.0"]);
        assert_eq!(dropped.len(), 1);
        assert_eq!(dropped[0].map_name.as_deref(), Some("Bb 2.0"));
        assert_eq!(
            serde_json::to_value(dropped[0].reason).expect("serialize"),
            "duplicate-map"
        );
    }

    /// A skip reason serializes as the same string the layer it came from uses,
    /// so a consumer reads one vocabulary rather than three.
    #[test]
    fn a_skip_reads_as_the_reason_the_layer_gave() {
        let reason = |r: SeedSkipReason| serde_json::to_value(r).expect("serialize");
        assert_eq!(
            reason(SeedSkipReason::Overlay(MapOverlaySkip::Blank)),
            "blank"
        );
        assert_eq!(
            reason(SeedSkipReason::Overlay(MapOverlaySkip::NoSource)),
            "no-source"
        );
        assert_eq!(
            reason(SeedSkipReason::Buildpic(BuildpicSkip::NotSquare)),
            "not-square"
        );
        assert_eq!(reason(SeedSkipReason::Walk(NO_SHORTNAME)), "no-shortname");
        assert_eq!(reason(SeedSkipReason::Walk(SUPERSEDED)), "superseded");
    }

    /// A dry run reports the shape of the corpus and leaves the disk alone, so
    /// what it says has to be countable without any bytes existing.
    #[test]
    fn a_dry_run_counts_four_layers_for_every_map() {
        let plan = SeedPlan {
            maps: 98,
            map_assets: 98 * coilbox_assets::vocabulary().map_variants.len() as u32,
            units: 4123,
            unit_assets_at_most: 4123,
            games: Vec::new(),
            skipped: Vec::new(),
        };
        assert_eq!(plan.map_assets, 392);
        let json = serde_json::to_value(&plan).expect("serialize");
        assert_eq!(json["unitAssetsAtMost"], 4123);
    }
}
