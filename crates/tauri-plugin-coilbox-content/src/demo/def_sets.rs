//! The unit definitions a replay was read against, kept so the replay stays
//! readable when its game is updated or uninstalled (issue #1176).
//!
//! A replay names a unit by the number the engine gave its definition, and that
//! number only means something inside the build of the game that assigned it.
//! So the list itself is kept: for each id in order, the unit's key, its name
//! and the few numbers the replay page reads.
//!
//! Two things are stored under the app's data directory, in
//! `content/replay-unit-def-sets/`, beside the analyses:
//!
//! - One file per distinct list, named after the sha256 of its canonical form
//!   (see [`canonical`]). Two builds with the same definitions share a file,
//!   and so do any number of replays.
//! - `links.json`, which says for each replay's game id which lists were
//!   recorded for it, where each came from and when. A replay that is moved or
//!   renamed keeps its game id, so it keeps its link. A remix carries its
//!   original's game id and its original's unit ids, so it reads its
//!   original's link.
//!
//! A list comes from one of three places, and they are not equally good. See
//! [`Origin`]. A game id keeps at most one link from each, and [`chosen`] says
//! which one a reader gets.
//!
//! Everything that becomes part of a path is validated first: a game id by
//! [`valid_game_id`] and a digest by [`valid_digest`]. A file is written under
//! a temporary name and renamed into place.

use std::collections::BTreeMap;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use flate2::read::GzDecoder;
use flate2::write::GzEncoder;
use flate2::Compression;
use picoframe_core::CliResult;
use serde::{Deserialize, Serialize};
use serde_json::json;
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Runtime};

use super::analysis::store::valid_game_id;

/// The folder under `<data dir>/content/` that holds the files.
const DIR: &str = "replay-unit-def-sets";

/// What a stored list's file name ends in.
const SET_EXTENSION: &str = ".json.gz";

const LINKS_FILE: &str = "links.json";

/// The shape of a stored list and of the links file. Raised when a field
/// changes meaning or goes, never for a new one.
const STORE_FORMAT: u32 = 1;

/// The first line of the canonical form. Changing what follows it changes
/// every digest, so the number here goes up with it.
const CANONICAL_HEADER: &str = "coilbox-unit-def-set/1\n";

const DIGEST_PREFIX: &str = "sha256:";

/// How many hex digits a sha256 has.
const DIGEST_HEX: usize = 64;

/// The most definitions a list may hold.
///
/// A bound on what a caller may hand over, and not a measurement of any game.
/// The largest list measured is Beyond All Reason test-30922 at 564
/// definitions. The engine itself sets no limit. This only stops a malformed
/// call writing a file of any size.
pub const MAX_UNITS: usize = 65_536;

/// The longest a definition's key or name may be, in bytes. A bound of the
/// same kind as [`MAX_UNITS`].
pub const MAX_NAME_BYTES: usize = 256;

fn is_false(value: &bool) -> bool {
    !*value
}

/// One unit definition: what the replay page reads of it and no more.
///
/// The field order is the canonical form's, so it is part of every digest. A
/// new field goes at the end and is left out when it has nothing to say, which
/// keeps the digest of every list that does not use it.
///
/// A number that is absent is one the source did not give. A cost of zero is a
/// claim and is kept apart from that.
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct UnitDef {
    /// The definition's key, which is what the game's files call the unit.
    pub name: String,
    /// What a player calls it. Absent when the source gave none.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub human_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub metal_cost: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub energy_cost: Option<f64>,
    /// Whether it moves. A building does not.
    #[serde(default, skip_serializing_if = "is_false")]
    pub mobile: bool,
    /// Whether the definition says it builds.
    #[serde(default, skip_serializing_if = "is_false")]
    pub builder: bool,
    /// Whether it has a build menu.
    #[serde(default, skip_serializing_if = "is_false")]
    pub builds: bool,
    /// Whether it has a weapon.
    #[serde(default, skip_serializing_if = "is_false")]
    pub armed: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub transport_capacity: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub metal_make: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub energy_make: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub makes_metal: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub extracts_metal: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub wind_generator: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tidal_generator: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub metal_upkeep: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub energy_upkeep: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub metal_storage: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub energy_storage: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub radar_distance: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sonar_distance: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub radar_distance_jam: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sonar_distance_jam: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub seismic_distance: Option<f64>,
}

impl UnitDef {
    fn numbers(&self) -> [Option<f64>; 18] {
        [
            self.metal_cost,
            self.energy_cost,
            self.transport_capacity,
            self.metal_make,
            self.energy_make,
            self.makes_metal,
            self.extracts_metal,
            self.wind_generator,
            self.tidal_generator,
            self.metal_upkeep,
            self.energy_upkeep,
            self.metal_storage,
            self.energy_storage,
            self.radar_distance,
            self.sonar_distance,
            self.radar_distance_jam,
            self.sonar_distance_jam,
            self.seismic_distance,
        ]
    }
}

/// Refuse a list that is not one before anything is hashed or written. A list
/// arrives from the frontend or out of an engine's log, and both are input.
pub fn validate(units: &[UnitDef]) -> Result<(), String> {
    if units.is_empty() {
        return Err("a unit definition list with nothing in it is not kept".into());
    }
    if units.len() > MAX_UNITS {
        return Err(format!(
            "a unit definition list may hold {MAX_UNITS} definitions, and this one has {}",
            units.len()
        ));
    }
    for (index, unit) in units.iter().enumerate() {
        let id = index + 1;
        let text_ok =
            |text: &str| text.len() <= MAX_NAME_BYTES && !text.chars().any(char::is_control);
        if unit.name.is_empty() || !text_ok(&unit.name) {
            return Err(format!("unit definition {id} has no usable key"));
        }
        if unit
            .human_name
            .as_deref()
            .is_some_and(|name| !text_ok(name))
        {
            return Err(format!("unit definition {id} has no usable name"));
        }
        if unit.numbers().iter().flatten().any(|n| !n.is_finite()) {
            return Err(format!(
                "unit definition {id} holds a number that is not one"
            ));
        }
    }
    Ok(())
}

/// The bytes a list is hashed as: [`CANONICAL_HEADER`], then each definition
/// in id order as one line of JSON with its fields in the order [`UnitDef`]
/// declares them and a field with nothing to say left out.
///
/// `a_known_list_has_a_known_digest` pins this to a literal digest, so a change
/// here that would rename every stored list fails a test first.
pub fn canonical(units: &[UnitDef]) -> Vec<u8> {
    let mut out = CANONICAL_HEADER.as_bytes().to_vec();
    for unit in units {
        // A struct of strings, booleans and finite numbers always serialises.
        out.extend(serde_json::to_vec(unit).unwrap_or_default());
        out.push(b'\n');
    }
    out
}

/// A list's name: `sha256:` and the lowercase hex of its canonical form, as
/// the map catalog and the asset vocabulary name theirs.
pub fn digest(units: &[UnitDef]) -> String {
    let hash = Sha256::digest(canonical(units));
    let hex: String = hash.iter().map(|byte| format!("{byte:02x}")).collect();
    format!("{DIGEST_PREFIX}{hex}")
}

/// The hex of a digest, as a file name may use it. A digest is read out of a
/// file or handed over by the frontend and becomes part of a path, so anything
/// but `sha256:` and 64 lowercase hex digits is refused here.
pub fn valid_digest(digest: &str) -> Result<&str, String> {
    let hex = digest
        .strip_prefix(DIGEST_PREFIX)
        .filter(|hex| {
            hex.len() == DIGEST_HEX
                && hex
                    .bytes()
                    .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
        })
        .ok_or("not a unit definition list digest: expected sha256 and 64 hex digits")?;
    Ok(hex)
}

/// Where a list came from, least trusted first.
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "camelCase")]
pub enum Origin {
    /// Read through unitsync from an installed game that is a loose folder,
    /// matched by name. A folder can change under the same name, so this is
    /// what the folder held on the day it was read and no more.
    Folder,
    /// Read through unitsync from an installed packaged archive, matched by
    /// name. An archive does not change under its name. Unitsync runs the
    /// definitions with default mod options and no map.
    Archive,
    /// Written by the engine itself during an analysis run: its own list, with
    /// the match's mod options and map applied.
    Engine,
}

impl Origin {
    /// An installed game is a loose folder when its archive is an `.sdd`.
    pub fn of_archive(archive: &str) -> Origin {
        if archive.to_ascii_lowercase().ends_with(".sdd") {
            Origin::Folder
        } else {
            Origin::Archive
        }
    }
}

/// One list recorded for a replay.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Link {
    pub digest: String,
    pub origin: Origin,
    /// The game the list was read from, name and version.
    pub game: String,
    /// When it was recorded, in milliseconds since the Unix epoch.
    pub taken_at_ms: u64,
    /// For an engine's list: whether the run used a game other than the one
    /// the replay names. `None` when that is not known.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub game_differs: Option<bool>,
}

#[derive(Serialize, Deserialize, Default)]
struct Links {
    format: u32,
    /// Game id to the lists recorded for it, at most one from each origin.
    links: BTreeMap<String, Vec<Link>>,
}

/// Which ids a reader wants to name.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Ids {
    /// The ids in the replay's own stream: build orders. They are the
    /// recorded game's.
    Stream,
    /// The ids in an analysis run's events. They are whatever game the run
    /// used, which is not always the recorded one.
    Events,
}

/// The list a reader gets, out of those recorded for a replay.
///
/// An engine's list is the run's own numbering, so it always answers for that
/// run's events. It answers for the replay's stream only when the run used the
/// recorded game. Past that the most trusted origin wins.
pub fn chosen(links: &[Link], ids: Ids) -> Option<&Link> {
    links
        .iter()
        .filter(|link| {
            link.origin != Origin::Engine || ids == Ids::Events || link.game_differs == Some(false)
        })
        .max_by_key(|link| link.origin)
}

/// The folder the lists are kept in, given the app's data directory.
pub fn store_dir(data_dir: &Path) -> PathBuf {
    data_dir.join("content").join(DIR)
}

/// The folder the lists are kept in, given the folder the analyses are kept
/// in. The two are side by side.
pub fn dir_beside(analyses: &Path) -> PathBuf {
    analyses.with_file_name(DIR)
}

fn app_store_dir<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    Ok(store_dir(&coilbox_portable::data_dir(app)?))
}

/// A stored list as its file holds it.
#[derive(Serialize, Deserialize)]
struct StoredSet {
    format: u32,
    digest: String,
    units: Vec<UnitDef>,
}

fn set_path(dir: &Path, digest: &str) -> Result<PathBuf, String> {
    Ok(dir.join(format!("{}{SET_EXTENSION}", valid_digest(digest)?)))
}

/// Write `bytes` to `path` through a temporary name in the same folder, so a
/// file with the real name is always a whole one. The temporary name ends in
/// neither way a stored file does.
fn write_atomic(dir: &Path, path: &Path, bytes: &[u8]) -> Result<(), String> {
    std::fs::create_dir_all(dir).map_err(|e| format!("could not create {}: {e}", dir.display()))?;
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    let temp = dir.join(format!("{name}.tmp-{}", std::process::id()));
    let result = (|| -> std::io::Result<()> {
        let mut file = std::fs::File::create(&temp)?;
        file.write_all(bytes)?;
        file.sync_all()?;
        std::fs::rename(&temp, path)
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(&temp);
    }
    result.map_err(|e| format!("could not write {}: {e}", path.display()))
}

/// Keep a list, and answer its digest. A list that is already kept is left as
/// it is, which is what makes any number of replays share one file.
pub fn store_set(dir: &Path, units: &[UnitDef]) -> Result<String, String> {
    validate(units)?;
    let digest = digest(units);
    let path = set_path(dir, &digest)?;
    if read_set(dir, &digest)?.is_some() {
        return Ok(digest);
    }
    let mut gz = GzEncoder::new(Vec::new(), Compression::default());
    serde_json::to_writer(
        &mut gz,
        &StoredSet {
            format: STORE_FORMAT,
            digest: digest.clone(),
            units: units.to_vec(),
        },
    )
    .map_err(|e| format!("could not encode the unit definitions: {e}"))?;
    let bytes = gz
        .finish()
        .map_err(|e| format!("could not compress the unit definitions: {e}"))?;
    write_atomic(dir, &path, &bytes)?;
    Ok(digest)
}

/// A kept list, or `None` when there is no such file or it does not hold what
/// its name says. The digest is worked out again from what was read, so a file
/// that was damaged or edited is not handed back as the list it was.
pub fn read_set(dir: &Path, digest: &str) -> Result<Option<Vec<UnitDef>>, String> {
    let path = set_path(dir, digest)?;
    let Ok(file) = std::fs::File::open(&path) else {
        return Ok(None);
    };
    let mut text = String::new();
    if GzDecoder::new(file).read_to_string(&mut text).is_err() {
        return Ok(None);
    }
    let Ok(stored) = serde_json::from_str::<StoredSet>(&text) else {
        return Ok(None);
    };
    let whole = stored.format == STORE_FORMAT
        && validate(&stored.units).is_ok()
        && self::digest(&stored.units) == digest;
    Ok(whole.then_some(stored.units))
}

/// One at a time through the links file, which is read, changed and written
/// back whole.
static LINKS_LOCK: Mutex<()> = Mutex::new(());

/// A missing, unreadable or other-format file is no links.
fn load_links(dir: &Path) -> Links {
    std::fs::read_to_string(dir.join(LINKS_FILE))
        .ok()
        .and_then(|text| serde_json::from_str::<Links>(&text).ok())
        .filter(|links| links.format == STORE_FORMAT)
        .unwrap_or_default()
}

fn save_links(dir: &Path, links: &Links) -> Result<(), String> {
    let stored = Links {
        format: STORE_FORMAT,
        links: links.links.clone(),
    };
    let bytes = serde_json::to_vec(&stored)
        .map_err(|e| format!("could not encode the unit definition links: {e}"))?;
    write_atomic(dir, &dir.join(LINKS_FILE), &bytes)
}

/// Record that `link`'s list was read for a replay, and answer every list now
/// recorded for it.
///
/// A list already recorded is never quietly swapped for a different one. A
/// link from another origin is added beside those there, and [`chosen`]
/// decides between them. A second link from the same origin is dropped when
/// the origin is unitsync, because the first was read nearer the match and
/// nothing says the second is better. An engine's replaces the last engine's,
/// because the stored analysis is that run's and its events carry that run's
/// ids.
#[cfg(test)]
pub fn link(dir: &Path, game_id: &str, link: Link) -> Result<Vec<Link>, String> {
    let _guard = LINKS_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    link_locked(dir, game_id, link)
}

fn link_locked(dir: &Path, game_id: &str, link: Link) -> Result<Vec<Link>, String> {
    let game_id = valid_game_id(game_id)?;
    valid_digest(&link.digest)?;
    let mut links = load_links(dir);
    let recorded = links.links.entry(game_id).or_default();
    match recorded.iter_mut().find(|l| l.origin == link.origin) {
        Some(earlier) if link.origin == Origin::Engine => *earlier = link,
        Some(_) => return Ok(recorded.clone()),
        None => recorded.push(link),
    }
    let recorded = recorded.clone();
    save_links(dir, &links)?;
    Ok(recorded)
}

/// Every list recorded for a replay.
pub fn links_for(dir: &Path, game_id: &str) -> Result<Vec<Link>, String> {
    let game_id = valid_game_id(game_id)?;
    Ok(load_links(dir).links.remove(&game_id).unwrap_or_default())
}

/// What a list was read from, and when.
pub struct Source<'a> {
    pub origin: Origin,
    /// The game it was read from, name and version.
    pub game: &'a str,
    pub game_differs: Option<bool>,
    pub taken_at_ms: u64,
}

/// Keep a list and record it for a replay, in one step, so nothing can clear
/// the list away between the two. Answers every list now recorded for the
/// replay. See [`link`] for what happens to one already recorded.
pub fn record(
    dir: &Path,
    game_id: &str,
    units: &[UnitDef],
    source: &Source,
) -> Result<Vec<Link>, String> {
    // Before anything is written, so a bad id leaves no list behind.
    valid_game_id(game_id)?;
    let _guard = LINKS_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let digest = store_set(dir, units)?;
    let recorded = link_locked(
        dir,
        game_id,
        Link {
            digest,
            origin: source.origin,
            game: source.game.to_string(),
            taken_at_ms: source.taken_at_ms,
            game_differs: source.game_differs,
        },
    )?;
    // The list just kept is left with no link when an earlier one stood, and
    // an engine's earlier list is left with none when this one replaced it.
    sweep_unlinked(dir, &load_links(dir));
    Ok(recorded)
}

/// Forget links, then remove every list nothing links to any more. `keep`
/// says which of a game id's links stay. Answers how many lists went.
fn forget(dir: &Path, game_ids: &[String], keep: impl Fn(&Link) -> bool) -> Result<usize, String> {
    let _guard = LINKS_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let mut links = load_links(dir);
    let mut changed = false;
    for game_id in game_ids {
        let game_id = valid_game_id(game_id)?;
        let Some(recorded) = links.links.get_mut(&game_id) else {
            continue;
        };
        let before = recorded.len();
        recorded.retain(&keep);
        changed |= recorded.len() != before;
        if recorded.is_empty() {
            links.links.remove(&game_id);
        }
    }
    if changed {
        save_links(dir, &links)?;
    }
    Ok(sweep_unlinked(dir, &links))
}

/// Forget everything recorded for these replays. For a replay that has been
/// deleted with no other copy of its match left.
pub fn unlink(dir: &Path, game_ids: &[String]) -> Result<usize, String> {
    forget(dir, game_ids, |_| false)
}

/// Forget the engine's list for a replay. For when its analysis goes or is
/// replaced by a run that did not reproduce the match.
pub fn unlink_engine(dir: &Path, game_id: &str) -> Result<usize, String> {
    forget(dir, &[game_id.to_string()], |link| {
        link.origin != Origin::Engine
    })
}

/// Remove every stored list no link names. Answers how many went.
fn sweep_unlinked(dir: &Path, links: &Links) -> usize {
    let linked: std::collections::BTreeSet<&str> = links
        .links
        .values()
        .flatten()
        .filter_map(|link| valid_digest(&link.digest).ok())
        .collect();
    let Ok(entries) = std::fs::read_dir(dir) else {
        return 0;
    };
    entries
        .flatten()
        .filter(|entry| {
            let name = entry.file_name().to_string_lossy().into_owned();
            name.strip_suffix(SET_EXTENSION)
                .is_some_and(|hex| hex.len() == DIGEST_HEX && !linked.contains(hex))
                && std::fs::remove_file(entry.path()).is_ok()
        })
        .count()
}

/// What the store holds and what it costs.
#[derive(Serialize, Clone, Copy, Debug, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Usage {
    /// Distinct lists kept.
    pub sets: usize,
    /// Replays with at least one list recorded.
    pub replays: usize,
    /// Every file's size on disk, the links file included.
    pub bytes: u64,
}

pub fn usage(dir: &Path) -> Usage {
    let mut usage = Usage {
        replays: load_links(dir).links.len(),
        ..Default::default()
    };
    for entry in std::fs::read_dir(dir).into_iter().flatten().flatten() {
        let Ok(meta) = entry.metadata() else {
            continue;
        };
        if !meta.is_file() {
            continue;
        }
        usage.bytes += meta.len();
        if entry.file_name().to_string_lossy().ends_with(SET_EXTENSION) {
            usage.sets += 1;
        }
    }
    usage
}

/// What a replay's page needs: every list recorded for the replay, which one
/// names each kind of id, and the lists themselves, each once.
#[derive(Serialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ReplayDefSets {
    pub links: Vec<Link>,
    /// The link that names the ids in the replay's own stream, if any.
    pub stream: Option<Link>,
    /// The link that names the ids in the replay's analysis events, if any.
    pub events: Option<Link>,
    /// The lists `stream` and `events` name, by digest.
    pub sets: BTreeMap<String, Vec<UnitDef>>,
}

/// Read what is recorded for a replay. A link whose list is gone or does not
/// read is passed over for the next best.
pub fn for_replay(dir: &Path, game_id: &str) -> Result<ReplayDefSets, String> {
    let links = links_for(dir, game_id)?;
    let mut sets: BTreeMap<String, Vec<UnitDef>> = BTreeMap::new();
    let mut readable: Vec<Link> = Vec::new();
    for link in &links {
        if let Some(units) = read_set(dir, &link.digest)? {
            sets.insert(link.digest.clone(), units);
            readable.push(link.clone());
        }
    }
    let stream = chosen(&readable, Ids::Stream).cloned();
    let events = chosen(&readable, Ids::Events).cloned();
    sets.retain(|digest, _| {
        [&stream, &events]
            .iter()
            .any(|link| link.as_ref().is_some_and(|l| &l.digest == digest))
    });
    Ok(ReplayDefSets {
        links,
        stream,
        events,
        sets,
    })
}

/// `content_unit_def_set`: what is recorded for one replay. See
/// [`ReplayDefSets`]. `gameId` is the replay's own, which for a remix is its
/// original's.
#[tauri::command]
pub(crate) async fn content_unit_def_set<R: Runtime>(
    app: AppHandle<R>,
    game_id: String,
) -> CliResult {
    let dir = match app_store_dir(&app) {
        Ok(dir) => dir,
        Err(e) => return CliResult::err(e),
    };
    match tauri::async_runtime::spawn_blocking(move || for_replay(&dir, &game_id)).await {
        Ok(Ok(found)) => CliResult::ok(json!(found)),
        Ok(Err(e)) => CliResult::err(e),
        Err(e) => CliResult::err(format!("unit definition read task failed: {e}")),
    }
}

/// `content_unit_def_set_store`: keep the list a replay was just read against.
///
/// `units` is the installed game's list in id order, and `archive` the name of
/// the archive it was read from, which says whether the game is a loose
/// folder. `game` is that game's name and version. The caller hands this over
/// only for a game installed under the exact name the replay records.
///
/// Answers `{ digest, origin, links }`. A replay that already has a list from
/// that origin keeps it, and `digest` is then the one it kept.
#[tauri::command]
pub(crate) async fn content_unit_def_set_store<R: Runtime>(
    app: AppHandle<R>,
    game_id: String,
    game: String,
    archive: String,
    units: Vec<UnitDef>,
) -> CliResult {
    let dir = match app_store_dir(&app) {
        Ok(dir) => dir,
        Err(e) => return CliResult::err(e),
    };
    let stored = tauri::async_runtime::spawn_blocking(move || {
        if game.is_empty() || game.len() > MAX_NAME_BYTES || archive.len() > MAX_NAME_BYTES {
            return Err("the game a unit definition list came from has no usable name".to_string());
        }
        let origin = Origin::of_archive(&archive);
        let links = record(
            &dir,
            &game_id,
            &units,
            &Source {
                origin,
                game: &game,
                game_differs: None,
                taken_at_ms: super::analysis::now_ms(),
            },
        )?;
        let kept = links
            .iter()
            .find(|l| l.origin == origin)
            .map(|l| l.digest.clone());
        Ok(json!({ "digest": kept, "origin": origin, "links": links }))
    })
    .await;
    match stored {
        Ok(Ok(answer)) => CliResult::ok(answer),
        Ok(Err(e)) => CliResult::err(e),
        Err(e) => CliResult::err(format!("unit definition store task failed: {e}")),
    }
}

/// `content_unit_def_sets_usage`: how many lists are kept, for how many
/// replays, and their size on disk.
#[tauri::command]
pub(crate) async fn content_unit_def_sets_usage<R: Runtime>(app: AppHandle<R>) -> CliResult {
    match app_store_dir(&app) {
        Ok(dir) => CliResult::ok(json!(usage(&dir))),
        Err(e) => CliResult::err(e),
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    const ID: &str = "a0a1a2a3a4a5a6a7a8a9aaabacadaeaf";
    const OTHER: &str = "00000000000000000000000000000001";

    fn unit(name: &str, metal: f64) -> UnitDef {
        UnitDef {
            name: name.into(),
            metal_cost: Some(metal),
            ..Default::default()
        }
    }

    /// Three definitions that use every kind of field.
    pub(crate) fn known() -> Vec<UnitDef> {
        vec![
            UnitDef {
                name: "tgcom".into(),
                human_name: Some("Commander".into()),
                metal_cost: Some(2500.0),
                energy_cost: Some(25000.5),
                mobile: true,
                builder: true,
                builds: true,
                armed: true,
                metal_make: Some(1.5),
                energy_storage: Some(500.0),
                ..Default::default()
            },
            UnitDef {
                name: "tgmex".into(),
                human_name: Some("Metal Extractor".into()),
                metal_cost: Some(50.0),
                energy_cost: Some(0.0),
                extracts_metal: Some(0.001),
                energy_upkeep: Some(-3.0),
                ..Default::default()
            },
            UnitDef {
                name: "tgwall".into(),
                ..Default::default()
            },
        ]
    }

    fn link_of(digest: &str, origin: Origin, taken_at_ms: u64) -> Link {
        Link {
            digest: digest.into(),
            origin,
            game: "Some Game 1.0".into(),
            taken_at_ms,
            game_differs: (origin == Origin::Engine).then_some(false),
        }
    }

    fn names(dir: &Path) -> Vec<String> {
        let mut names: Vec<String> = std::fs::read_dir(dir)
            .map(|entries| {
                entries
                    .flatten()
                    .map(|e| e.file_name().to_string_lossy().into_owned())
                    .collect()
            })
            .unwrap_or_default();
        names.sort();
        names
    }

    /// The digest is a stored file's name and what a replay's link holds, so it
    /// must not move between versions of coilbox. This is the canonical form
    /// written out, and its sha256 as a literal.
    #[test]
    fn a_known_list_has_a_known_digest() {
        let expected = concat!(
            "coilbox-unit-def-set/1\n",
            "{\"name\":\"tgcom\",\"humanName\":\"Commander\",\"metalCost\":2500.0,\"energyCost\":25000.5,",
            "\"mobile\":true,\"builder\":true,\"builds\":true,\"armed\":true,\"metalMake\":1.5,",
            "\"energyStorage\":500.0}\n",
            "{\"name\":\"tgmex\",\"humanName\":\"Metal Extractor\",\"metalCost\":50.0,\"energyCost\":0.0,",
            "\"extractsMetal\":0.001,\"energyUpkeep\":-3.0}\n",
            "{\"name\":\"tgwall\"}\n",
        );
        assert_eq!(String::from_utf8(canonical(&known())).unwrap(), expected);
        assert_eq!(
            digest(&known()),
            "sha256:6d2fd5654fb9ddb251c15b44f38ae58863229cee1c3576b4199a898f03ac1c52"
        );
    }

    #[test]
    fn the_same_definitions_share_a_digest_and_any_difference_gets_its_own() {
        let base = known();
        assert_eq!(digest(&base), digest(&known()));

        let mut repriced = known();
        repriced[1].metal_cost = Some(51.0);
        let mut reordered = known();
        reordered.swap(0, 1);
        let mut longer = known();
        longer.push(unit("tgextra", 1.0));
        // A cost of nothing is a claim, and no cost at all is not one.
        let mut unpriced = known();
        unpriced[1].energy_cost = None;

        let digests = [
            digest(&base),
            digest(&repriced),
            digest(&reordered),
            digest(&longer),
            digest(&unpriced),
        ];
        for (i, a) in digests.iter().enumerate() {
            for b in &digests[i + 1..] {
                assert_ne!(a, b);
            }
        }
    }

    #[test]
    fn a_digest_is_sha256_and_64_lowercase_hex_digits() {
        let good = digest(&known());
        assert_eq!(valid_digest(&good).unwrap().len(), 64);
        let hex = &good[7..];
        for bad in [
            "",
            hex,
            "sha256:",
            "sha256:abc",
            &format!("sha256:{}", hex.to_uppercase()),
            &format!("sha256:{hex}0"),
            &format!("md5:{hex}"),
            "sha256:../../../../../../../../../../../../../../../../../../../../etc/pass",
            &format!("sha256:{}/", &hex[..63]),
        ] {
            assert!(valid_digest(bad).is_err(), "accepted {bad:?}");
        }
    }

    #[test]
    fn a_list_that_is_not_one_is_refused() {
        assert!(validate(&known()).is_ok());
        assert!(validate(&[]).is_err());
        assert!(validate(&[unit("", 1.0)]).is_err());
        assert!(validate(&[unit("tab\there", 1.0)]).is_err());
        assert!(validate(&[unit(&"x".repeat(MAX_NAME_BYTES + 1), 1.0)]).is_err());
        assert!(validate(&[unit("ok", f64::NAN)]).is_err());
        assert!(validate(&[unit("ok", f64::INFINITY)]).is_err());
        let mut named = unit("ok", 1.0);
        named.human_name = Some("line\nbreak".into());
        assert!(validate(&[named]).is_err());
        assert!(validate(&vec![unit("u", 1.0); MAX_UNITS]).is_ok());
        assert!(validate(&vec![unit("u", 1.0); MAX_UNITS + 1]).is_err());
    }

    /// Every function that takes a game id or a digest builds a path or a key
    /// from it, so every one of them has to refuse one that is not one.
    #[test]
    fn no_entry_point_takes_a_bad_id_or_digest() {
        let dir = tempfile::tempdir().unwrap();
        let outside = dir.path().join("outside.json.gz");
        std::fs::write(&outside, b"keep").unwrap();
        let store = dir.path().join("store");
        let good = store_set(&store, &known()).unwrap();

        assert!(read_set(&store, "sha256:../outside").is_err());
        assert!(link(&store, "../outside", link_of(&good, Origin::Archive, 1)).is_err());
        assert!(link(&store, ID, link_of("../outside", Origin::Archive, 1)).is_err());
        assert!(links_for(&store, "../outside").is_err());
        assert!(for_replay(&store, "../outside").is_err());
        assert!(unlink(&store, &["../outside".to_string()]).is_err());
        assert!(unlink_engine(&store, "nope").is_err());

        assert_eq!(std::fs::read(&outside).unwrap(), b"keep");
        assert_eq!(names(&store), vec![format!("{}.json.gz", &good[7..])]);
    }

    #[test]
    fn a_list_is_stored_once_and_reads_back_as_it_went_in() {
        let dir = tempfile::tempdir().unwrap();

        let first = store_set(dir.path(), &known()).unwrap();
        let modified = |digest: &str| {
            std::fs::metadata(set_path(dir.path(), digest).unwrap())
                .unwrap()
                .modified()
                .unwrap()
        };
        let written = modified(&first);
        let second = store_set(dir.path(), &known()).unwrap();

        assert_eq!(first, second);
        assert_eq!(first, digest(&known()));
        assert_eq!(names(dir.path()), vec![format!("{}.json.gz", &first[7..])]);
        assert_eq!(modified(&first), written, "the file was written twice");
        assert_eq!(read_set(dir.path(), &first).unwrap(), Some(known()));
        assert_eq!(
            read_set(dir.path(), &digest(&[unit("x", 1.0)])).unwrap(),
            None
        );
    }

    /// A file that does not hold what its name says is not handed back as the
    /// list it was named for.
    #[test]
    fn a_file_that_does_not_match_its_name_reads_as_nothing() {
        let dir = tempfile::tempdir().unwrap();
        let real = store_set(dir.path(), &known()).unwrap();
        let other = store_set(dir.path(), &[unit("x", 1.0)]).unwrap();

        std::fs::copy(
            set_path(dir.path(), &other).unwrap(),
            set_path(dir.path(), &real).unwrap(),
        )
        .unwrap();
        assert_eq!(read_set(dir.path(), &real).unwrap(), None);

        std::fs::write(set_path(dir.path(), &real).unwrap(), b"not gzip").unwrap();
        assert_eq!(read_set(dir.path(), &real).unwrap(), None);
        // And storing it again puts the real one back.
        assert_eq!(store_set(dir.path(), &known()).unwrap(), real);
        assert_eq!(read_set(dir.path(), &real).unwrap(), Some(known()));
    }

    #[test]
    fn an_installed_game_is_a_loose_folder_when_its_archive_is_an_sdd() {
        assert_eq!(Origin::of_archive("SplinterFaction.sdd"), Origin::Folder);
        assert_eq!(Origin::of_archive("Dev.SDD"), Origin::Folder);
        assert_eq!(
            Origin::of_archive("metal_factions-v2.58.sdz"),
            Origin::Archive
        );
        assert_eq!(Origin::of_archive("xta-9.65.sd7"), Origin::Archive);
        assert_eq!(
            Origin::of_archive("06860629e67e11ef60760893bbfb60d5.sdp"),
            Origin::Archive
        );
    }

    /// The order of trust: the engine's own list, then a packaged archive,
    /// then a loose folder.
    #[test]
    fn the_most_trusted_origin_wins_whatever_order_they_arrived_in() {
        let a = digest(&[unit("a", 1.0)]);
        let b = digest(&[unit("b", 1.0)]);
        let c = digest(&[unit("c", 1.0)]);
        let orders: [[(&str, Origin); 3]; 3] = [
            [
                (&a, Origin::Folder),
                (&b, Origin::Archive),
                (&c, Origin::Engine),
            ],
            [
                (&c, Origin::Engine),
                (&b, Origin::Archive),
                (&a, Origin::Folder),
            ],
            [
                (&b, Origin::Archive),
                (&c, Origin::Engine),
                (&a, Origin::Folder),
            ],
        ];
        for order in orders {
            let dir = tempfile::tempdir().unwrap();
            let mut seen = Vec::new();
            for (step, (digest, origin)) in order.iter().enumerate() {
                seen = link(dir.path(), ID, link_of(digest, *origin, step as u64)).unwrap();
            }

            // All three facts are kept, and the engine's is the one read.
            assert_eq!(seen.len(), 3);
            assert_eq!(chosen(&seen, Ids::Stream).unwrap().digest, c);
            assert_eq!(chosen(&seen, Ids::Events).unwrap().digest, c);
            let without_engine: Vec<Link> = seen
                .iter()
                .filter(|l| l.origin != Origin::Engine)
                .cloned()
                .collect();
            assert_eq!(chosen(&without_engine, Ids::Stream).unwrap().digest, b);
            assert_eq!(
                chosen(&without_engine[..1], Ids::Stream).unwrap().digest,
                without_engine[0].digest
            );
        }
        assert_eq!(chosen(&[], Ids::Stream), None);
    }

    /// A list already recorded is never swapped for a different one from the
    /// same kind of read.
    #[test]
    fn a_second_unitsync_read_does_not_replace_the_first() {
        let dir = tempfile::tempdir().unwrap();
        let first = digest(&[unit("a", 1.0)]);
        let later = digest(&[unit("b", 1.0)]);

        for origin in [Origin::Folder, Origin::Archive] {
            link(dir.path(), ID, link_of(&first, origin, 100)).unwrap();
            let after = link(dir.path(), ID, link_of(&later, origin, 200)).unwrap();
            let kept = after.iter().find(|l| l.origin == origin).unwrap();
            assert_eq!(
                (kept.digest.as_str(), kept.taken_at_ms),
                (first.as_str(), 100)
            );
        }
        assert_eq!(links_for(dir.path(), ID).unwrap().len(), 2);
    }

    /// The stored analysis is the latest run's, and its events carry that
    /// run's ids, so the engine's list follows it.
    #[test]
    fn a_later_engine_list_replaces_the_earlier_one() {
        let dir = tempfile::tempdir().unwrap();
        let first = digest(&[unit("a", 1.0)]);
        let later = digest(&[unit("b", 1.0)]);

        link(dir.path(), ID, link_of(&first, Origin::Engine, 100)).unwrap();
        let after = link(dir.path(), ID, link_of(&later, Origin::Engine, 200)).unwrap();

        assert_eq!(after.len(), 1);
        assert_eq!(
            (after[0].digest.as_str(), after[0].taken_at_ms),
            (later.as_str(), 200)
        );
    }

    /// A run on another version of the game numbers its own events and not
    /// the replay's orders.
    #[test]
    fn an_engine_list_from_another_game_version_names_events_and_not_orders() {
        let engine = digest(&[unit("a", 1.0)]);
        let archive = digest(&[unit("b", 1.0)]);
        for differs in [Some(true), None] {
            let mut from_engine = link_of(&engine, Origin::Engine, 1);
            from_engine.game_differs = differs;
            let links = vec![from_engine, link_of(&archive, Origin::Archive, 2)];

            assert_eq!(chosen(&links, Ids::Events).unwrap().digest, engine);
            assert_eq!(chosen(&links, Ids::Stream).unwrap().digest, archive);
            assert_eq!(chosen(&links[..1], Ids::Stream), None);
        }
    }

    #[test]
    fn a_replay_reads_the_lists_its_links_name_each_once() {
        let dir = tempfile::tempdir().unwrap();
        let folder = store_set(dir.path(), &[unit("a", 1.0)]).unwrap();
        let engine = store_set(dir.path(), &known()).unwrap();
        link(dir.path(), ID, link_of(&folder, Origin::Folder, 1)).unwrap();
        let mut other_version = link_of(&engine, Origin::Engine, 2);
        other_version.game_differs = Some(true);
        link(dir.path(), ID, other_version).unwrap();

        let found = for_replay(dir.path(), ID).unwrap();

        assert_eq!(found.links.len(), 2);
        assert_eq!(found.stream.as_ref().unwrap().digest, folder);
        assert_eq!(found.events.as_ref().unwrap().digest, engine);
        assert_eq!(found.sets.len(), 2);
        assert_eq!(found.sets[&engine], known());

        // A replay nothing was recorded for.
        assert_eq!(
            for_replay(dir.path(), OTHER).unwrap(),
            ReplayDefSets::default()
        );
    }

    /// A link whose file has gone must not leave the replay with no names
    /// when a lesser list is still there.
    #[test]
    fn a_link_whose_list_is_gone_is_passed_over_for_the_next_best() {
        let dir = tempfile::tempdir().unwrap();
        let folder = store_set(dir.path(), &[unit("a", 1.0)]).unwrap();
        let archive = store_set(dir.path(), &known()).unwrap();
        link(dir.path(), ID, link_of(&folder, Origin::Folder, 1)).unwrap();
        link(dir.path(), ID, link_of(&archive, Origin::Archive, 2)).unwrap();
        std::fs::remove_file(set_path(dir.path(), &archive).unwrap()).unwrap();

        let found = for_replay(dir.path(), ID).unwrap();

        assert_eq!(found.stream.unwrap().digest, folder);
        assert_eq!(found.sets.len(), 1);
    }

    #[test]
    fn two_replays_of_one_build_share_one_list() {
        let dir = tempfile::tempdir().unwrap();
        let digest = store_set(dir.path(), &known()).unwrap();
        link(dir.path(), ID, link_of(&digest, Origin::Archive, 1)).unwrap();
        let again = store_set(dir.path(), &known()).unwrap();
        link(dir.path(), OTHER, link_of(&again, Origin::Archive, 2)).unwrap();

        assert_eq!(
            usage(dir.path()),
            Usage {
                sets: 1,
                replays: 2,
                bytes: std::fs::metadata(set_path(dir.path(), &digest).unwrap())
                    .unwrap()
                    .len()
                    + std::fs::metadata(dir.path().join(LINKS_FILE))
                        .unwrap()
                        .len(),
            }
        );
    }

    /// A list goes when the last replay that links to it does, and not before.
    #[test]
    fn a_list_goes_with_its_last_link() {
        let dir = tempfile::tempdir().unwrap();
        let shared = store_set(dir.path(), &known()).unwrap();
        let own = store_set(dir.path(), &[unit("a", 1.0)]).unwrap();
        link(dir.path(), ID, link_of(&shared, Origin::Archive, 1)).unwrap();
        link(dir.path(), ID, link_of(&own, Origin::Folder, 1)).unwrap();
        link(dir.path(), OTHER, link_of(&shared, Origin::Archive, 2)).unwrap();

        assert_eq!(unlink(dir.path(), &[ID.to_string()]).unwrap(), 1);
        assert_eq!(links_for(dir.path(), ID).unwrap(), Vec::new());
        assert_eq!(read_set(dir.path(), &own).unwrap(), None);
        assert_eq!(read_set(dir.path(), &shared).unwrap(), Some(known()));

        assert_eq!(unlink(dir.path(), &[OTHER.to_string()]).unwrap(), 1);
        assert_eq!(usage(dir.path()).sets, 0);
        // Forgetting a replay nothing was recorded for is not an error.
        assert_eq!(unlink(dir.path(), &[ID.to_string()]).unwrap(), 0);
    }

    #[test]
    fn forgetting_the_engines_list_leaves_the_others() {
        let dir = tempfile::tempdir().unwrap();
        let engine = store_set(dir.path(), &known()).unwrap();
        let archive = store_set(dir.path(), &[unit("a", 1.0)]).unwrap();
        link(dir.path(), ID, link_of(&engine, Origin::Engine, 1)).unwrap();
        link(dir.path(), ID, link_of(&archive, Origin::Archive, 2)).unwrap();

        assert_eq!(unlink_engine(dir.path(), ID).unwrap(), 1);

        let left = links_for(dir.path(), ID).unwrap();
        assert_eq!(left.len(), 1);
        assert_eq!(left[0].origin, Origin::Archive);
        assert_eq!(read_set(dir.path(), &engine).unwrap(), None);
    }

    /// A links file from a later format, or one that does not read, is no
    /// links, and the next write replaces it.
    #[test]
    fn a_links_file_that_does_not_read_is_no_links() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join(LINKS_FILE), b"{\"format\":99,\"links\":{}}").unwrap();
        assert_eq!(links_for(dir.path(), ID).unwrap(), Vec::new());
        std::fs::write(dir.path().join(LINKS_FILE), b"not json").unwrap();
        assert_eq!(links_for(dir.path(), ID).unwrap(), Vec::new());

        let digest = store_set(dir.path(), &known()).unwrap();
        link(dir.path(), ID, link_of(&digest, Origin::Archive, 1)).unwrap();
        assert_eq!(links_for(dir.path(), ID).unwrap().len(), 1);
    }

    /// Keeping and recording in one step: a second read from the same origin
    /// keeps the first list and leaves no file for the second, and a second
    /// engine run leaves none for the first.
    #[test]
    fn recording_a_list_leaves_no_list_without_a_link() {
        let dir = tempfile::tempdir().unwrap();
        let source = |origin| Source {
            origin,
            game: "Some Game 1.0",
            game_differs: None,
            taken_at_ms: 5,
        };
        let later = [unit("later", 1.0)];

        let first = record(dir.path(), ID, &known(), &source(Origin::Folder)).unwrap();
        let second = record(dir.path(), ID, &later, &source(Origin::Folder)).unwrap();
        assert_eq!(first, second);
        assert_eq!(first[0].digest, digest(&known()));
        assert_eq!(read_set(dir.path(), &digest(&later)).unwrap(), None);

        record(dir.path(), ID, &known(), &source(Origin::Engine)).unwrap();
        let replaced = record(dir.path(), ID, &later, &source(Origin::Engine)).unwrap();
        assert_eq!(replaced.len(), 2);
        assert_eq!(
            chosen(&replaced, Ids::Events).unwrap().digest,
            digest(&later)
        );
        // The folder's link still holds the first list.
        assert_eq!(usage(dir.path()).sets, 2);

        assert!(record(dir.path(), "../outside", &known(), &source(Origin::Archive)).is_err());
        assert!(record(dir.path(), OTHER, &[], &source(Origin::Archive)).is_err());
        assert_eq!(usage(dir.path()).sets, 2);
    }

    #[test]
    fn the_store_sits_beside_the_analyses() {
        let data = Path::new("/data");
        assert_eq!(
            dir_beside(&super::super::analysis::store::store_dir(data)),
            store_dir(data)
        );
    }

    #[test]
    fn nothing_is_left_under_a_temporary_name() {
        let dir = tempfile::tempdir().unwrap();
        let digest = store_set(dir.path(), &known()).unwrap();
        link(dir.path(), ID, link_of(&digest, Origin::Archive, 1)).unwrap();

        assert_eq!(
            names(dir.path()),
            vec![format!("{}.json.gz", &digest[7..]), LINKS_FILE.to_string()]
        );
    }
}
