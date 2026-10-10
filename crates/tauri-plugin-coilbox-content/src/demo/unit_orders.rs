//! One replay's build orders reduced to totals by who gave them and which unit
//! they asked for, for a count across a library of replays (#1167).
//!
//! A player's dossier adds up what they ordered over every replay they are in.
//! Sending each replay's orders to the frontend would mean walking every demo on
//! every visit, so each replay is walked here, once, and what leaves is a short
//! table: for each seat and each unit definition id, how many orders placed a
//! building, how many went to a factory queue, and how many units they asked
//! for.
//!
//! The ids mean something only against the unit list of the build the match was
//! played on (#1176). Nothing here names a unit. [`with_lists`] hands over the
//! list the unit definition store keeps for each replay, and the frontend
//! decides whether a replay can be named at all.
//!
//! For a match with a stored analysis the table gains what the simulation did:
//! how many of each unit a team finished, and how many of those died.
//!
//! A replay file does not change, so its totals are kept in the app's cache
//! directory, one small file per replay, the way `map_grids` keeps its counts.

use std::collections::{BTreeMap, HashMap, HashSet};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use flate2::read::GzDecoder;
use flate2::write::GzEncoder;
use flate2::Compression;
use picoframe_core::CliResult;
use serde::{Deserialize, Serialize};
use serde_json::json;
use tauri::{AppHandle, Runtime};

use super::analysis::store::{self, AnalysisState};
use super::build_orders::{build_orders_from_stream, player_teams};
use super::def_sets::{self, Ids, Link, UnitDef};
use super::{build_demo_info, find_game, parse_tdf, player_names, read_header_and_script, stream};
use crate::model::CommandOrigin;

/// Raised whenever a kept file would no longer be what this code writes: the
/// shape of [`ReplayUnitOrders`], which orders are counted, how a seat is told
/// from another, or which events count as finished and died. A file kept under
/// another version is not read, and the replay is walked again.
pub const UNIT_ORDERS_VERSION: u32 = 1;

/// The folder under the app's cache directory that holds the kept files. It is
/// in `caches::CACHE_SUBDIRS`, so the storage screen sizes it and clears it.
pub(crate) const CACHE_DIR: &str = "coilbox-replay-unit-orders";

const CACHE_EXTENSION: &str = ".json.gz";

/// What one seat ordered of one unit definition.
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DefOrders {
    /// The unit definition id, as the recorded game's engine numbered it.
    pub def: u32,
    /// Orders that placed a building: the ones with a position.
    pub placed: u32,
    /// Orders to a factory queue: the ones with none.
    pub queued: u32,
    /// Units asked for, the sum of each order's count. Queue removals are not
    /// orders and are not taken off.
    pub units: u32,
}

/// One seat's orders: a player's own, or those of a skirmish AI, which the
/// player hosting it sends.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Seat {
    /// The player number the orders arrived from.
    pub player: u8,
    /// The player's name, where the start script or the stream gives one.
    /// Absent for an AI's seat.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    /// The team of the skirmish AI the orders were for. Absent for a player's
    /// own orders.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ai_team: Option<i32>,
    /// In id order.
    pub defs: Vec<DefOrders>,
}

/// What the simulation did with one unit definition for one team.
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DefEvents {
    /// The unit definition id, as the analysis run's engine numbered it.
    pub def: u32,
    /// Units the team finished building.
    pub finished: u32,
    /// Finished units that were destroyed while the team had them.
    pub died: u32,
}

/// One team's finished and destroyed units in a stored analysis.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TeamEvents {
    pub team: i32,
    /// In id order.
    pub defs: Vec<DefEvents>,
}

/// One replay, reduced.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ReplayUnitOrders {
    pub path: String,
    /// The match's id, which the unit definition store and the analysis store
    /// file a match under. Absent for a remix, which carries its original's
    /// id, and for a header with none.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub game_id: Option<String>,
    pub remixed: bool,
    /// The game and version whose build numbered the ids in `seats`. For a
    /// remix that is the game it was recorded on, not the one it points at.
    pub game_type: String,
    /// The last frame the stream reached. 30 frames are one second.
    pub last_frame: i32,
    /// True when the walk stopped early, so later orders are missing.
    pub incomplete: bool,
    /// Factory queue orders that took units off a queue. Not in `seats`.
    pub removals: u32,
    /// Players first by number, then AIs by team.
    pub seats: Vec<Seat>,
    /// What each team finished and lost. Absent when the match has no stored
    /// analysis with events, which is a different thing from an analysis in
    /// which nothing was finished.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub events: Option<Vec<TeamEvents>>,
    /// Whether the orders came from a kept file and not from a walk. Never
    /// true in a kept file itself.
    #[serde(default)]
    pub from_cache: bool,
}

/// Walk one replay and total its build orders. The whole file is read and held
/// while it is walked, so call this for one replay at a time.
pub fn reduce_replay(demo: &Path) -> Result<ReplayUnitOrders, String> {
    let raw = read_header_and_script(demo)?;
    let game = find_game(&parse_tdf(&raw.script));
    let names = player_names(&game);
    let teams = player_teams(&game);
    let info = build_demo_info(raw, &game, None, None);
    let walked = stream::read_stream(demo)?;
    let read = build_orders_from_stream(&walked, names, teams);

    let named: HashMap<u8, &str> = read
        .players
        .iter()
        .map(|p| (p.player, p.name.as_str()))
        .collect();
    // An AI's seat sorts after every player's: `None` is less than `Some`.
    let mut seats: BTreeMap<(Option<i32>, u8), BTreeMap<u32, DefOrders>> = BTreeMap::new();
    for order in &read.orders {
        let ai_team = match order.origin {
            CommandOrigin::Ai { team, .. } => Some(i32::from(team)),
            _ => None,
        };
        // An id that is not a positive number names nothing in any list, and
        // 0 is one no list answers for.
        let def = u32::try_from(order.unit_def_id).unwrap_or(0);
        let entry = seats
            .entry((ai_team, order.player))
            .or_default()
            .entry(def)
            .or_insert(DefOrders {
                def,
                placed: 0,
                queued: 0,
                units: 0,
            });
        if order.position.is_some() {
            entry.placed += 1;
        } else {
            entry.queued += 1;
        }
        entry.units = entry.units.saturating_add(order.count);
    }

    Ok(ReplayUnitOrders {
        path: demo.to_string_lossy().into_owned(),
        game_id: info
            .game_id
            .as_deref()
            .filter(|_| !info.remixed)
            .and_then(|id| store::valid_game_id(id).ok()),
        remixed: info.remixed,
        game_type: info
            .source_gametype
            .filter(|_| info.remixed)
            .unwrap_or(info.game_type),
        last_frame: read.last_frame,
        incomplete: read.incomplete,
        removals: read.removals,
        seats: seats
            .into_iter()
            .map(|((ai_team, player), defs)| Seat {
                player,
                name: ai_team
                    .is_none()
                    .then(|| named.get(&player).map(|n| n.to_string()))
                    .flatten(),
                ai_team,
                defs: defs.into_values().collect(),
            })
            .collect(),
        events: None,
        from_cache: false,
    })
}

/// What says whether a match's stored analysis is the one a kept file counted:
/// when it was written. `None` when there is no analysis with events.
fn analysis_signature(analyses: &Path, game_id: &str) -> Option<u64> {
    let stored = store::read(analyses, game_id).ok().flatten()?;
    (stored.state != AnalysisState::Diverged).then_some(stored.provenance.analysed_at_ms)
}

/// Total what each team finished and lost in a match's stored analysis.
///
/// A unit is finished on its `unit_finished` line, for the team that line
/// names. It died when a `unit_destroyed` line names a unit that had been
/// finished, for the team that had it then. A unit destroyed before it was
/// finished is a build that was cancelled or shot down, and is neither.
pub fn reduce_events(analyses: &Path, game_id: &str) -> Option<Vec<TeamEvents>> {
    let kinds = ["unit_finished".to_string(), "unit_destroyed".to_string()];
    let page = store::read_events(analyses, game_id, Some(&kinds), 0, None).ok()?;
    let mut teams: BTreeMap<i32, BTreeMap<u32, DefEvents>> = BTreeMap::new();
    // The engine gives a dead unit's id to a later one, so a finished unit is
    // forgotten when it dies.
    let mut alive: HashSet<i64> = HashSet::new();
    for event in &page.events {
        let whole = |key: &str| event.get(key).and_then(|v| v.as_i64());
        let (Some(unit), Some(def), Some(team)) = (whole("unit"), whole("def"), whole("team"))
        else {
            continue;
        };
        let (Ok(def), Ok(team)) = (u32::try_from(def), i32::try_from(team)) else {
            continue;
        };
        let finished = match event.get("kind").and_then(|k| k.as_str()) {
            Some("unit_finished") => {
                alive.insert(unit);
                true
            }
            Some("unit_destroyed") if alive.remove(&unit) => false,
            _ => continue,
        };
        let entry = teams
            .entry(team)
            .or_default()
            .entry(def)
            .or_insert(DefEvents {
                def,
                finished: 0,
                died: 0,
            });
        if finished {
            entry.finished += 1;
        } else {
            entry.died += 1;
        }
    }
    Some(
        teams
            .into_iter()
            .map(|(team, defs)| TeamEvents {
                team,
                defs: defs.into_values().collect(),
            })
            .collect(),
    )
}

/// A kept file: one replay's totals and what they were counted from.
#[derive(Serialize, Deserialize)]
struct Kept {
    version: u32,
    /// The replay file's size and modified time when it was walked.
    size_bytes: u64,
    modified_ms: u64,
    /// When the analysis the events were counted from was written, or `None`
    /// when there was none.
    events_from: Option<u64>,
    orders: ReplayUnitOrders,
}

/// The name of a replay's kept file. From the path, so two folders holding the
/// same file name do not share one.
fn kept_name(demo: &Path) -> String {
    format!(
        "{}{CACHE_EXTENSION}",
        crate::hash_id(&[&demo.to_string_lossy()])
    )
}

fn load_kept(path: &Path) -> Option<Kept> {
    let mut json = Vec::new();
    GzDecoder::new(std::fs::File::open(path).ok()?)
        .read_to_end(&mut json)
        .ok()?;
    serde_json::from_slice(&json).ok()
}

fn save_kept(path: &Path, kept: &Kept) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let mut gz = GzEncoder::new(Vec::new(), Compression::default());
    gz.write_all(&serde_json::to_vec(kept)?)?;
    coilbox_gamebackup::write_atomic(path, &gz.finish()?)
}

fn file_signature(demo: &Path) -> Result<(u64, u64), String> {
    let md = std::fs::metadata(demo).map_err(|e| format!("read demo: {e}"))?;
    let modified_ms = md
        .modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    Ok((md.len(), modified_ms))
}

/// One replay's totals, from its kept file when that is still good.
///
/// `cache_dir` is where kept files live, and `None` keeps nothing. `analyses`
/// is the analysis store, and `None` gives no events.
///
/// A kept file answers for the orders when it was written by this
/// [`UNIT_ORDERS_VERSION`] from a file of this size and modified time, which
/// is the test the stats store and the replay list use for "this file has not
/// changed". Its events answer when the match's stored analysis is the one
/// they were counted from. An analysis that arrived, changed or went since
/// then costs a read of the analysis and no walk of the replay.
///
/// Failing to write a kept file is not an error: the next call walks again.
pub fn replay_unit_orders(
    demo: &Path,
    cache_dir: Option<&Path>,
    analyses: Option<&Path>,
) -> Result<ReplayUnitOrders, String> {
    let (size_bytes, modified_ms) = file_signature(demo)?;
    let kept_path = cache_dir.map(|dir| dir.join(kept_name(demo)));
    let kept = kept_path.as_deref().and_then(load_kept).filter(|k| {
        k.version == UNIT_ORDERS_VERSION
            && k.size_bytes == size_bytes
            && k.modified_ms == modified_ms
    });
    let (mut orders, walked, kept_events_from) = match kept {
        Some(k) => (k.orders, false, k.events_from),
        None => (reduce_replay(demo)?, true, None),
    };

    let game_id = orders.game_id.clone();
    let analysis = analyses
        .zip(game_id.as_deref())
        .and_then(|(dir, id)| analysis_signature(dir, id).map(|sig| (dir, id, sig)));
    let events_from = analysis.map(|(_, _, at)| at);
    if walked || kept_events_from != events_from {
        orders.events = analysis.and_then(|(dir, id, _)| reduce_events(dir, id));
        if let Some(path) = &kept_path {
            let _ = save_kept(
                path,
                &Kept {
                    version: UNIT_ORDERS_VERSION,
                    size_bytes,
                    modified_ms,
                    events_from,
                    orders: ReplayUnitOrders {
                        from_cache: false,
                        ..orders.clone()
                    },
                },
            );
        }
    }
    orders.from_cache = !walked;
    Ok(orders)
}

/// A replay that was asked for and not reduced, and why.
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Failure {
    pub path: String,
    pub error: String,
}

/// [`replay_unit_orders`] for paths the frontend handed over, one replay at a
/// time.
///
/// A path is input, so each must be a replay in a folder the Replays list
/// reads under `roots`, by the same test the delete commands apply
/// ([`super::is_listed_replay`]). One that is not is refused and nothing of it
/// is opened. A replay that will not read is a failure of its own and does not
/// stop the rest.
pub fn listed_unit_orders(
    paths: &[PathBuf],
    cache_dir: Option<&Path>,
    analyses: Option<&Path>,
    roots: &[PathBuf],
) -> (Vec<ReplayUnitOrders>, Vec<Failure>) {
    let mut replays = Vec::new();
    let mut failed = Vec::new();
    for demo in paths {
        let read = if super::is_listed_replay(demo, roots) {
            replay_unit_orders(demo, cache_dir, analyses)
        } else {
            Err("not in a folder the Replays list reads".to_string())
        };
        match read {
            Ok(orders) => replays.push(orders),
            Err(error) => failed.push(Failure {
                path: demo.to_string_lossy().into_owned(),
                error,
            }),
        }
    }
    (replays, failed)
}

/// A replay's totals with the unit lists that name its ids.
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Listed {
    #[serde(flatten)]
    pub orders: ReplayUnitOrders,
    /// The kept list that names the ids in `seats`, if one is kept.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stream_list: Option<Link>,
    /// The kept list that names the ids in `events`, if one is kept. Only on a
    /// replay that has events.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub events_list: Option<Link>,
}

/// Attach to each replay the lists the unit definition store keeps for it, and
/// answer every list named, once, by digest.
///
/// Which list names which ids is the store's own rule ([`def_sets::chosen`]):
/// an engine's list answers for the stream only when its run used the recorded
/// game. A link whose list is gone or does not read is passed over for the
/// next best, as on the replay's own page. A replay with no game id has
/// nothing filed under it, and with no store (`lists` is `None`) no replay has
/// a list.
///
/// The lists are not in the kept file, because the store gains one whenever a
/// replay is read against its game or analysed.
pub fn with_lists(
    lists: Option<&Path>,
    replays: Vec<ReplayUnitOrders>,
) -> (Vec<Listed>, BTreeMap<String, Vec<UnitDef>>) {
    // Every digest looked at, with its list when it read.
    let mut read: HashMap<String, Option<Vec<UnitDef>>> = HashMap::new();
    let mut sets: BTreeMap<String, Vec<UnitDef>> = BTreeMap::new();
    let listed = replays
        .into_iter()
        .map(|orders| {
            let links = lists
                .zip(orders.game_id.as_deref())
                .and_then(|(dir, id)| def_sets::links_for(dir, id).ok())
                .unwrap_or_default();
            let readable: Vec<Link> = links
                .into_iter()
                .filter(|link| {
                    read.entry(link.digest.clone())
                        .or_insert_with(|| {
                            lists.and_then(|dir| {
                                def_sets::read_set(dir, &link.digest).ok().flatten()
                            })
                        })
                        .is_some()
                })
                .collect();
            let stream_list = def_sets::chosen(&readable, Ids::Stream).cloned();
            let events_list = orders
                .events
                .as_ref()
                .and_then(|_| def_sets::chosen(&readable, Ids::Events).cloned());
            for link in [&stream_list, &events_list].into_iter().flatten() {
                if let Some(Some(units)) = read.get(&link.digest) {
                    sets.entry(link.digest.clone())
                        .or_insert_with(|| units.clone());
                }
            }
            Listed {
                orders,
                stream_list,
                events_list,
            }
        })
        .collect();
    (listed, sets)
}

/// Delete every kept file that is not for one of `live`, and say how many
/// went. This is what bounds the folder: after it there is at most one file
/// for each replay in the library.
pub fn sweep(cache_dir: &Path, live: impl IntoIterator<Item = PathBuf>) -> usize {
    let wanted: HashSet<String> = live.into_iter().map(|p| kept_name(&p)).collect();
    let Ok(entries) = std::fs::read_dir(cache_dir) else {
        return 0;
    };
    entries
        .flatten()
        .filter(|e| !wanted.contains(e.file_name().to_string_lossy().as_ref()))
        .filter(|e| e.file_type().is_ok_and(|t| t.is_file()))
        .filter(|e| std::fs::remove_file(e.path()).is_ok())
        .count()
}

/// Drop the kept totals of replays that have left the library, once for each
/// run of the app. It needs a listing of every replay folder, which is too
/// much to do on every call and enough to do once.
fn sweep_once(cache: &Path, roots: &[PathBuf]) {
    static SWEPT: std::sync::Once = std::sync::Once::new();
    SWEPT.call_once(|| {
        let live = roots
            .iter()
            .flat_map(|root| super::demo_file_entries(root))
            .map(|entry| entry.path);
        sweep(cache, live);
    });
}

/// `content_replay_unit_orders`, each replay in `paths` reduced to what every
/// seat ordered of every unit definition, for a count across many replays
/// (#1167). See [`ReplayUnitOrders`] for the totals and [`with_lists`] for the
/// unit lists that come with them.
///
/// Answers `{ replays, sets, failed }`. A path must be a replay in a folder
/// the Replays list reads, as the delete commands require, and one that is not
/// is answered in `failed` beside any that would not read.
#[tauri::command]
pub(crate) async fn content_replay_unit_orders<R: Runtime>(
    app: AppHandle<R>,
    paths: Vec<String>,
) -> CliResult {
    let cache = coilbox_portable::cache_dir(&app)
        .ok()
        .map(|dir| dir.join(CACHE_DIR));
    let analyses = store::app_store_dir(&app).ok();
    let lists = coilbox_portable::data_dir(&app)
        .ok()
        .map(|dir| def_sets::store_dir(&dir));
    match tauri::async_runtime::spawn_blocking(move || {
        let roots = super::library_roots();
        if let Some(cache) = &cache {
            sweep_once(cache, &roots);
        }
        let paths: Vec<PathBuf> = paths.iter().map(PathBuf::from).collect();
        let (replays, failed) =
            listed_unit_orders(&paths, cache.as_deref(), analyses.as_deref(), &roots);
        let (replays, sets) = with_lists(lists.as_deref(), replays);
        (replays, sets, failed)
    })
    .await
    {
        Ok((replays, sets, failed)) => {
            CliResult::ok(json!({ "replays": replays, "sets": sets, "failed": failed }))
        }
        Err(e) => CliResult::err(format!("replay unit orders task failed: {e}")),
    }
}

#[cfg(test)]
mod tests {
    use super::super::analysis::log::{LogLine, UnitEvent};
    use super::super::def_sets::{Origin, Source};
    use super::super::stream::fixture::Packets;
    use super::super::tests::DemoFixture;
    use super::*;
    use crate::model::Order;

    const SHIFT_KEY: u8 = 1 << 5;
    const NO_AI: u8 = 255;

    fn order(id: i32, options: u8, params: &[f32]) -> Order {
        Order {
            id,
            options,
            params: params.to_vec(),
        }
    }

    /// A replay file in `dir` with these packets as its stream.
    fn replay(dir: &Path, name: &str, packets: Packets, game_id: u8) -> PathBuf {
        let path = dir.join(name);
        let fixture = DemoFixture {
            stream: packets.bytes(),
            game_id: [game_id; 16],
            ..Default::default()
        };
        std::fs::write(&path, fixture.gzipped()).unwrap();
        path
    }

    /// Player 0 places unit 42 twice and queues unit 30 once plain and once
    /// with shift, which is five. Player 1 places unit 42 once. A skirmish AI
    /// on team 5, hosted by player 0, places unit 7. One queue removal.
    fn short_match() -> Packets {
        Packets::default()
            .keyframe(0)
            .newframes(10)
            .command(0, &order(-42, 0, &[100.0, 0.0, 1000.0, 0.0]))
            .command(0, &order(-42, 0, &[200.0, 0.0, 1000.0, 0.0]))
            .command(0, &order(-30, 0, &[]))
            .command(0, &order(-30, SHIFT_KEY, &[]))
            .command(0, &order(-30, 1 << 4, &[]))
            .command(1, &order(-42, 0, &[300.0, 0.0, 1000.0, 0.0]))
            .unit_command(0, 2, 5, 41, &order(-7, 0, &[400.0, 0.0, 1000.0, 0.0]), None)
    }

    fn def(def: u32, placed: u32, queued: u32, units: u32) -> DefOrders {
        DefOrders {
            def,
            placed,
            queued,
            units,
        }
    }

    #[test]
    fn a_replay_reduces_to_each_seats_totals_by_unit() {
        let tmp = tempfile::tempdir().unwrap();
        let demo = replay(tmp.path(), "a.sdfz", short_match(), 7);
        let got = reduce_replay(&demo).unwrap();

        assert_eq!(got.game_id.as_deref(), Some("07".repeat(16).as_str()));
        assert_eq!(got.game_type, "Beyond All Reason test-30018");
        assert!(!got.remixed && !got.incomplete);
        assert_eq!(got.removals, 1);
        assert_eq!(
            got.seats,
            vec![
                Seat {
                    player: 0,
                    name: Some("Alice".into()),
                    ai_team: None,
                    defs: vec![def(30, 0, 2, 6), def(42, 2, 0, 2)],
                },
                Seat {
                    player: 1,
                    name: Some("Bob".into()),
                    ai_team: None,
                    defs: vec![def(42, 1, 0, 1)],
                },
                // The AI's orders are its own seat, not its host's.
                Seat {
                    player: 0,
                    name: None,
                    ai_team: Some(5),
                    defs: vec![def(7, 1, 0, 1)],
                },
            ]
        );
        assert_eq!(got.events, None);
    }

    #[test]
    fn a_widgets_orders_are_the_players_own() {
        let tmp = tempfile::tempdir().unwrap();
        let packets = Packets::default()
            .command(0, &order(-42, 0, &[100.0, 0.0, 1000.0, 0.0]))
            .unit_command(
                0,
                NO_AI,
                0,
                40,
                &order(-42, 0, &[500.0, 0.0, 1000.0, 0.0]),
                None,
            );
        let got = reduce_replay(&replay(tmp.path(), "a.sdfz", packets, 7)).unwrap();
        assert_eq!(got.seats.len(), 1);
        assert_eq!(got.seats[0].defs, vec![def(42, 2, 0, 2)]);
    }

    // ---- events --------------------------------------------------------

    fn provenance(game_id: &str, outcome: &str, analysed_at_ms: u64) -> store::Provenance {
        serde_json::from_value(serde_json::json!({
            "kind": "analysis",
            "storeFormat": store::STORE_FORMAT,
            "outcome": outcome,
            "gameId": game_id,
            "loggerFormat": super::super::analysis::log::FORMAT_VERSION,
            "loggerVersion": super::super::analysis::log::LOGGER_VERSION,
            "engine": "2025.06.19",
            "game": "Some Game 1.0",
            "map": "Some Map",
            "analysedAtMs": analysed_at_ms,
            "matchSeconds": 600,
            "wallSeconds": 12.0,
        }))
        .unwrap()
    }

    fn event(unit: i32, def: i32, team: i32) -> UnitEvent {
        UnitEvent {
            unit,
            def,
            team,
            ..Default::default()
        }
    }

    #[test]
    fn finished_and_died_come_from_the_stored_analysis_by_team_and_unit() {
        let tmp = tempfile::tempdir().unwrap();
        let analyses = tmp.path().join("analyses");
        let id = "07".repeat(16);
        let events = [
            LogLine::UnitCreated(event(1, 42, 0)),
            LogLine::UnitFinished(event(1, 42, 0)),
            LogLine::UnitFinished(event(2, 42, 0)),
            LogLine::UnitFinished(event(3, 30, 1)),
            // Unit 1 dies. Unit 9 was never finished, so its end is a build
            // that was cancelled or shot down.
            LogLine::UnitDestroyed(event(1, 42, 0)),
            LogLine::UnitDestroyed(event(9, 42, 0)),
            // The engine hands unit 1's id to a new unit, which is finished
            // and dies too.
            LogLine::UnitFinished(event(1, 30, 0)),
            LogLine::UnitDestroyed(event(1, 30, 0)),
        ];
        store::write(
            &analyses,
            &provenance(&id, "reproduced", 5),
            Some(&events[..]),
        )
        .unwrap();

        let demo = replay(tmp.path(), "a.sdfz", short_match(), 7);
        let got = replay_unit_orders(&demo, None, Some(&analyses)).unwrap();
        let ev = |def, finished, died| DefEvents {
            def,
            finished,
            died,
        };
        assert_eq!(
            got.events,
            Some(vec![
                TeamEvents {
                    team: 0,
                    defs: vec![ev(30, 1, 1), ev(42, 2, 1)],
                },
                TeamEvents {
                    team: 1,
                    defs: vec![ev(30, 1, 0)],
                },
            ])
        );
    }

    #[test]
    fn a_match_with_no_analysis_or_a_diverged_one_has_no_events() {
        let tmp = tempfile::tempdir().unwrap();
        let analyses = tmp.path().join("analyses");
        let demo = replay(tmp.path(), "a.sdfz", short_match(), 7);
        assert_eq!(
            replay_unit_orders(&demo, None, Some(&analyses))
                .unwrap()
                .events,
            None
        );
        store::write(
            &analyses,
            &provenance(&"07".repeat(16), "diverged", 5),
            None,
        )
        .unwrap();
        assert_eq!(
            replay_unit_orders(&demo, None, Some(&analyses))
                .unwrap()
                .events,
            None
        );
    }

    // ---- the kept file -------------------------------------------------

    #[test]
    fn a_second_read_comes_from_the_kept_file_and_is_the_same() {
        let tmp = tempfile::tempdir().unwrap();
        let cache = tmp.path().join("cache");
        let demo = replay(tmp.path(), "a.sdfz", short_match(), 7);
        let first = replay_unit_orders(&demo, Some(&cache), None).unwrap();
        assert!(!first.from_cache);
        let second = replay_unit_orders(&demo, Some(&cache), None).unwrap();
        assert!(second.from_cache);
        assert_eq!(
            ReplayUnitOrders {
                from_cache: false,
                ..second
            },
            first
        );
        assert_eq!(std::fs::read_dir(&cache).unwrap().count(), 1);
    }

    /// Rewrite a kept file with one field changed.
    fn edit_kept(cache: &Path, demo: &Path, edit: impl FnOnce(&mut Kept)) {
        let path = cache.join(kept_name(demo));
        let mut kept = load_kept(&path).unwrap();
        edit(&mut kept);
        save_kept(&path, &kept).unwrap();
    }

    /// A kept file from another version is not believed. The marker is a count
    /// no walk of this replay produces, so reading it back would show.
    #[test]
    fn a_kept_file_from_another_version_is_walked_again() {
        let tmp = tempfile::tempdir().unwrap();
        let cache = tmp.path().join("cache");
        let demo = replay(tmp.path(), "a.sdfz", short_match(), 7);
        replay_unit_orders(&demo, Some(&cache), None).unwrap();

        edit_kept(&cache, &demo, |k| k.orders.removals = 999);
        assert_eq!(
            replay_unit_orders(&demo, Some(&cache), None)
                .unwrap()
                .removals,
            999,
            "the edited file is read while its version is current"
        );

        edit_kept(&cache, &demo, |k| k.version = UNIT_ORDERS_VERSION + 1);
        let got = replay_unit_orders(&demo, Some(&cache), None).unwrap();
        assert!(!got.from_cache);
        assert_eq!(got.removals, 1);
        // And the walk replaced the file, so the next read is kept again.
        assert!(
            replay_unit_orders(&demo, Some(&cache), None)
                .unwrap()
                .from_cache
        );
    }

    #[test]
    fn a_changed_replay_file_is_walked_again() {
        let tmp = tempfile::tempdir().unwrap();
        let cache = tmp.path().join("cache");
        let demo = replay(tmp.path(), "a.sdfz", short_match(), 7);
        assert_eq!(
            replay_unit_orders(&demo, Some(&cache), None).unwrap().seats[1].defs,
            vec![def(42, 1, 0, 1)]
        );
        // One more order, so the file is a different size.
        let longer = short_match().command(1, &order(-42, 0, &[50.0, 0.0, 50.0, 0.0]));
        replay(tmp.path(), "a.sdfz", longer, 7);
        let got = replay_unit_orders(&demo, Some(&cache), None).unwrap();
        assert!(!got.from_cache);
        assert_eq!(got.seats[1].defs, vec![def(42, 2, 0, 2)]);
    }

    /// An analysis that lands after the orders were kept is read without
    /// walking the replay again, and so is one that is replaced or deleted.
    #[test]
    fn an_analysis_that_arrives_changes_or_goes_refreshes_only_the_events() {
        let tmp = tempfile::tempdir().unwrap();
        let cache = tmp.path().join("cache");
        let analyses = tmp.path().join("analyses");
        let id = "07".repeat(16);
        let demo = replay(tmp.path(), "a.sdfz", short_match(), 7);
        let read = || replay_unit_orders(&demo, Some(&cache), Some(&analyses)).unwrap();
        let finished =
            |got: &ReplayUnitOrders| got.events.as_ref().map(|teams| teams[0].defs[0].finished);
        assert_eq!(read().events, None);

        let one = [LogLine::UnitFinished(event(1, 42, 0))];
        store::write(&analyses, &provenance(&id, "reproduced", 5), Some(&one[..])).unwrap();
        let got = read();
        assert!(got.from_cache, "the stream was not walked again");
        assert_eq!(finished(&got), Some(1));

        let two = [
            LogLine::UnitFinished(event(1, 42, 0)),
            LogLine::UnitFinished(event(2, 42, 0)),
        ];
        store::write(&analyses, &provenance(&id, "reproduced", 6), Some(&two[..])).unwrap();
        assert_eq!(finished(&read()), Some(2));
        // Unchanged since, so the kept events answer.
        assert_eq!(finished(&read()), Some(2));

        store::delete(&analyses, &id).unwrap();
        assert_eq!(read().events, None);
    }

    /// The check the delete commands make: only a replay in a folder the list
    /// reads. A file elsewhere is refused before it is opened.
    #[test]
    fn a_path_outside_the_replay_folders_is_refused() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().join("root");
        let demos = root.join("demos");
        std::fs::create_dir_all(&demos).unwrap();
        let cache = tmp.path().join("cache");
        let inside = replay(&demos, "in.sdfz", short_match(), 7);
        let outside = replay(tmp.path(), "out.sdfz", short_match(), 8);

        let (replays, failed) = listed_unit_orders(
            &[inside.clone(), outside, demos.join("gone.sdfz")],
            Some(&cache),
            None,
            std::slice::from_ref(&root),
        );
        assert_eq!(replays.len(), 1);
        assert_eq!(replays[0].path, inside.to_string_lossy());
        assert_eq!(failed.len(), 2);
        assert_eq!(failed[0].error, "not in a folder the Replays list reads");
        // In the folder and missing: let through, and it fails to read.
        assert!(failed[1].error.starts_with("read demo"), "{:?}", failed[1]);
        // Nothing was kept for a refused path.
        assert_eq!(std::fs::read_dir(&cache).unwrap().count(), 1);
    }

    #[test]
    fn the_sweep_leaves_one_file_for_each_live_replay() {
        let tmp = tempfile::tempdir().unwrap();
        let cache = tmp.path().join("cache");
        let a = replay(tmp.path(), "a.sdfz", short_match(), 7);
        let b = replay(tmp.path(), "b.sdfz", short_match(), 8);
        replay_unit_orders(&a, Some(&cache), None).unwrap();
        replay_unit_orders(&b, Some(&cache), None).unwrap();
        assert_eq!(std::fs::read_dir(&cache).unwrap().count(), 2);

        assert_eq!(sweep(&cache, [a.clone()]), 1);
        assert!(cache.join(kept_name(&a)).is_file());
        assert!(!cache.join(kept_name(&b)).exists());
        // A folder that is not there is nothing to sweep.
        assert_eq!(sweep(&tmp.path().join("absent"), [a]), 0);
    }

    // ---- the unit lists ------------------------------------------------

    fn list(names: &[&str]) -> Vec<UnitDef> {
        names
            .iter()
            .map(|name| UnitDef {
                name: (*name).into(),
                ..Default::default()
            })
            .collect()
    }

    fn source(origin: Origin, game_differs: Option<bool>) -> Source<'static> {
        Source {
            origin,
            game: "Some Game 1.0",
            game_differs,
            taken_at_ms: 1,
        }
    }

    /// Two replays that share a list get it once. One with nothing kept gets
    /// no list, and is still answered.
    #[test]
    fn each_replay_gets_the_list_the_store_keeps_for_it_and_a_shared_list_comes_once() {
        let tmp = tempfile::tempdir().unwrap();
        let lists = tmp.path().join("lists");
        let shared = list(&["alpha", "beta"]);
        for id in [7u8, 8] {
            let id = format!("{id:02x}").repeat(16);
            def_sets::record(&lists, &id, &shared, &source(Origin::Archive, None)).unwrap();
        }
        let replays = [7u8, 8, 9]
            .map(|id| {
                reduce_replay(&replay(
                    tmp.path(),
                    &format!("{id}.sdfz"),
                    short_match(),
                    id,
                ))
                .unwrap()
            })
            .to_vec();

        let (listed, sets) = with_lists(Some(&lists), replays);
        let digest = def_sets::digest(&shared);
        assert_eq!(sets.keys().collect::<Vec<_>>(), vec![&digest]);
        assert_eq!(sets[&digest], shared);
        let streams: Vec<_> = listed
            .iter()
            .map(|l| l.stream_list.as_ref().map(|link| link.digest.clone()))
            .collect();
        assert_eq!(streams, vec![Some(digest.clone()), Some(digest), None]);
        // No replay here has events, so none has a list for them.
        assert!(listed.iter().all(|l| l.events_list.is_none()));
    }

    /// An analysis run on another version of the game numbers its own events
    /// and not the replay's orders, so its list never names the stream.
    #[test]
    fn an_engine_list_from_another_game_version_names_the_events_and_not_the_orders() {
        let tmp = tempfile::tempdir().unwrap();
        let lists = tmp.path().join("lists");
        let analyses = tmp.path().join("analyses");
        let id = "07".repeat(16);
        let engines = list(&["alpha", "beta", "gamma"]);
        def_sets::record(&lists, &id, &engines, &source(Origin::Engine, Some(true))).unwrap();
        let one = [LogLine::UnitFinished(event(1, 2, 0))];
        store::write(&analyses, &provenance(&id, "reproduced", 5), Some(&one[..])).unwrap();
        let demo = replay(tmp.path(), "a.sdfz", short_match(), 7);
        let orders = replay_unit_orders(&demo, None, Some(&analyses)).unwrap();

        let (listed, sets) = with_lists(Some(&lists), vec![orders]);
        assert_eq!(listed[0].stream_list, None);
        assert_eq!(
            listed[0].events_list.as_ref().map(|l| l.digest.clone()),
            Some(def_sets::digest(&engines))
        );
        assert_eq!(sets.len(), 1);
    }

    #[test]
    fn the_answer_serialises_camel_case_and_flat() {
        let tmp = tempfile::tempdir().unwrap();
        let demo = replay(tmp.path(), "a.sdfz", short_match(), 7);
        let (listed, _) = with_lists(None, vec![reduce_replay(&demo).unwrap()]);
        let json = serde_json::to_value(&listed[0]).unwrap();
        for key in [
            "path",
            "gameId",
            "remixed",
            "gameType",
            "lastFrame",
            "incomplete",
            "removals",
            "seats",
            "fromCache",
        ] {
            assert!(json.get(key).is_some(), "{key} is missing");
        }
        for absent in ["events", "streamList", "eventsList", "orders"] {
            assert!(json.get(absent).is_none(), "{absent} should be left out");
        }
        assert_eq!(
            json["seats"][0],
            serde_json::json!({
                "player": 0,
                "name": "Alice",
                "defs": [
                    { "def": 30, "placed": 0, "queued": 2, "units": 6 },
                    { "def": 42, "placed": 2, "queued": 0, "units": 2 },
                ],
            })
        );
        assert_eq!(json["seats"][2]["aiTeam"], 5);
    }

    /// Every replay in `~/.spring/demos`, read only: what one costs to reduce
    /// and to keep. Run with
    /// `cargo nextest run -p tauri-plugin-coilbox-content real_replay_unit_orders --run-ignored only --no-capture`.
    /// Prints no names.
    #[test]
    #[ignore = "reads the replays on this machine"]
    fn real_replay_unit_orders() {
        let Some(home) = std::env::var_os("HOME") else {
            return;
        };
        let dir = Path::new(&home).join(".spring/demos");
        let mut files: Vec<PathBuf> = std::fs::read_dir(&dir)
            .map(|d| d.flatten().map(|e| e.path()).collect())
            .unwrap_or_default();
        files.retain(|f| super::super::is_replay_path(f));
        files.sort();
        let cache = tempfile::tempdir().unwrap();
        println!("bytes\twalk ms\tkept ms\tkept bytes\tseats\tunit rows\torders");
        for file in &files {
            let bytes = std::fs::metadata(file).map(|m| m.len()).unwrap_or(0);
            let started = std::time::Instant::now();
            let Ok(got) = replay_unit_orders(file, Some(cache.path()), None) else {
                println!("{bytes}\tdid not read");
                continue;
            };
            let walk = started.elapsed();
            let started = std::time::Instant::now();
            let again = replay_unit_orders(file, Some(cache.path()), None).unwrap();
            let kept = started.elapsed();
            assert!(again.from_cache);
            let kept_bytes = std::fs::metadata(cache.path().join(kept_name(file)))
                .map(|m| m.len())
                .unwrap_or(0);
            let rows: usize = got.seats.iter().map(|s| s.defs.len()).sum();
            let orders: u32 = got
                .seats
                .iter()
                .flat_map(|s| &s.defs)
                .map(|d| d.placed + d.queued)
                .sum();
            println!(
                "{bytes}\t{}\t{}\t{kept_bytes}\t{}\t{rows}\t{orders}",
                walk.as_millis(),
                kept.as_millis(),
                got.seats.len(),
            );
        }
    }
}
