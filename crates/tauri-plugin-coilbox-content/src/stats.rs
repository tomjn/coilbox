//! Local replay-stats database — the offline data layer behind every stats view
//! (personal profile, per-player head-to-head #375, per-map/faction records).
//!
//! It ingests each replay in the demos folders once, via the same native decode
//! the Replays screen uses (`demo::demo_info`), and stores a flat, denormalized
//! record per game (map, game, players + sides, winner, duration, date) in a
//! `stats.json` under app-data. This mirrors the content plugin's own `state.json`
//! approach — a serde JSON store, no database dependency — which is plenty for one
//! machine's replay library. Consumers read the whole record set and aggregate in
//! the frontend, so each view is a thin projection over the same table.
//!
//! Ingest is incremental and idempotent: a record is keyed by filename and carries
//! its `(size, mtime)` signature, so a re-ingest re-decodes only files that are new
//! or changed. A file that fails to decode (corrupt/truncated) is counted and
//! skipped, never fatal.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use crate::demo::{self, DemoFileEntry};
use crate::model::DemoInfo;

/// The current stats-store schema. Bumped when the record shape changes in a way a
/// stale store couldn't be read as (today: a straight re-ingest rebuilds it).
pub const STATS_SCHEMA_VERSION: u32 = 1;

/// One player (or spectator) as recorded in a game, flattened from the demo's
/// start-script. `side` is the faction; `won` is set only for a decided game where
/// the player wasn't a spectator.
#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct StatPlayer {
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ally_team: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub side: Option<String>,
    pub spectator: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub won: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub skill: Option<String>,
}

/// One ingested game: the denormalized row every stats view reads. `filename` is the
/// record's identity (stable within a library); `sizeBytes`/`modifiedMs` are the
/// change signature used to skip an unchanged file on re-ingest.
#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct StatRecord {
    pub filename: String,
    pub path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub game_id: Option<String>,
    pub map_name: String,
    pub game_type: String,
    pub engine_version: String,
    pub duration_sec: u32,
    pub start_time_ms: u64,
    pub size_bytes: u64,
    pub modified_ms: u64,
    /// False when demotool was absent/failed, so a view shows "result unknown"
    /// rather than counting the game as a loss for everyone.
    pub winners_known: bool,
    pub winning_ally_teams: Vec<u32>,
    pub remixed: bool,
    pub players: Vec<StatPlayer>,
    /// When this record was written (epoch-ms).
    pub ingested_at: u64,
}

/// The durable stats store: a schema version plus the flat record set.
#[derive(Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct StatsStore {
    #[serde(default)]
    pub schema_version: u32,
    #[serde(default)]
    pub records: Vec<StatRecord>,
}

/// What an ingest pass did, for the UI's status line.
#[derive(Serialize, Default, Clone)]
#[serde(rename_all = "camelCase")]
pub struct IngestSummary {
    /// New records written.
    pub added: u32,
    /// Existing records replaced (file changed since last ingest).
    pub updated: u32,
    /// Unchanged files skipped (same size + mtime).
    pub skipped: u32,
    /// Files that couldn't be decoded (corrupt/truncated) — skipped, not fatal.
    pub failed: u32,
    /// Total records in the store after the pass.
    pub total: u32,
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Read the stats store from `path`, returning an empty store when it's absent.
pub fn load(path: &Path) -> Result<StatsStore, String> {
    match std::fs::read_to_string(path) {
        Ok(s) => serde_json::from_str(&s).map_err(|e| format!("invalid stats store json: {e}")),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(StatsStore::default()),
        Err(e) => Err(format!("could not read stats store: {e}")),
    }
}

/// Write the whole stats store to `path`, creating the parent dir if needed.
pub fn save(path: &Path, store: &StatsStore) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("could not create stats store dir: {e}"))?;
    }
    let json = serde_json::to_string(store).map_err(|e| e.to_string())?;
    std::fs::write(path, json).map_err(|e| format!("could not write stats store: {e}"))
}

/// Build a record from a decoded demo + its file entry.
fn record_from(entry: &DemoFileEntry, info: DemoInfo) -> StatRecord {
    let players = info
        .players
        .into_iter()
        .map(|p| StatPlayer {
            name: p.name,
            ally_team: p.ally_team,
            side: p.side,
            spectator: p.spectator,
            won: p.won,
            skill: p.skill,
        })
        .collect();
    StatRecord {
        filename: entry.filename.clone(),
        path: entry.path.to_string_lossy().into_owned(),
        game_id: info.game_id,
        map_name: info.map_name,
        game_type: info.game_type,
        engine_version: info.engine_version,
        duration_sec: info.duration_sec,
        start_time_ms: info.start_time_ms,
        size_bytes: entry.size_bytes,
        modified_ms: entry.modified_ms,
        winners_known: info.winners_known,
        winning_ally_teams: info.winning_ally_teams,
        remixed: info.remixed,
        players,
        ingested_at: now_ms(),
    }
}

/// Whether an existing record still matches the file on disk (same identity + size
/// + mtime) — if so, re-ingest skips the expensive decode.
fn unchanged(existing: &StatRecord, entry: &DemoFileEntry) -> bool {
    existing.size_bytes == entry.size_bytes && existing.modified_ms == entry.modified_ms
}

/// Incrementally ingest every demo under `roots` into `store`, decoding only files
/// that are new or changed since the last pass. `engine_dir` locates `demotool` for
/// the winner read; when it's absent the native decode still yields map/players/
/// game (with `winners_known = false`). A file that fails to decode is skipped and
/// counted in `failed`, never aborting the pass. Records are keyed by filename, so
/// re-ingesting the same library is idempotent.
///
/// The store is only mutated in memory; the caller persists it (or discards it, for
/// a dry run).
pub fn ingest(roots: &[PathBuf], engine_dir: &Path, store: &mut StatsStore) -> IngestSummary {
    store.schema_version = STATS_SCHEMA_VERSION;
    // filename -> index into records, for O(1) upsert.
    let mut index: HashMap<String, usize> = store
        .records
        .iter()
        .enumerate()
        .map(|(i, r)| (r.filename.clone(), i))
        .collect();

    let mut summary = IngestSummary::default();
    for root in roots {
        for entry in demo::demo_file_entries(root) {
            if let Some(&i) = index.get(&entry.filename) {
                if unchanged(&store.records[i], &entry) {
                    summary.skipped += 1;
                    continue;
                }
                match demo::demo_info(engine_dir, &entry.path) {
                    Ok(info) => {
                        store.records[i] = record_from(&entry, info);
                        summary.updated += 1;
                    }
                    Err(_) => summary.failed += 1,
                }
            } else {
                match demo::demo_info(engine_dir, &entry.path) {
                    Ok(info) => {
                        index.insert(entry.filename.clone(), store.records.len());
                        store.records.push(record_from(&entry, info));
                        summary.added += 1;
                    }
                    Err(_) => summary.failed += 1,
                }
            }
        }
    }
    summary.total = store.records.len() as u32;
    summary
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::PlayerInfo;

    fn demo_info(map: &str, winners_known: bool, players: Vec<PlayerInfo>) -> DemoInfo {
        DemoInfo {
            engine_version: "105".into(),
            game_id: Some("abc".into()),
            start_time_ms: 1000,
            duration_sec: 600,
            wallclock_sec: 610,
            map_name: map.into(),
            game_type: "BAR".into(),
            start_pos_type: None,
            winning_ally_teams: vec![0],
            winners_known,
            num_ally_teams: 2,
            ally_teams: Vec::new(),
            players,
            remixed: false,
            source_gametype: None,
            origin_filename: None,
            mod_options: std::collections::HashMap::new(),
        }
    }

    fn player(name: &str, ally: i32, won: Option<bool>) -> PlayerInfo {
        PlayerInfo {
            name: name.into(),
            team: Some(ally),
            ally_team: Some(ally),
            side: Some("Armada".into()),
            rgb_color: None,
            spectator: false,
            won,
            skill: None,
            country_code: None,
        }
    }

    fn entry(name: &str, size: u64, mtime: u64) -> DemoFileEntry {
        DemoFileEntry {
            filename: name.into(),
            path: PathBuf::from(format!("/demos/{name}")),
            size_bytes: size,
            modified_ms: mtime,
        }
    }

    #[test]
    fn record_from_flattens_players() {
        let info = demo_info(
            "Comet",
            true,
            vec![
                player("Alice", 0, Some(true)),
                player("Bob", 1, Some(false)),
            ],
        );
        let rec = record_from(&entry("a.sdfz", 10, 20), info);
        assert_eq!(rec.filename, "a.sdfz");
        assert_eq!(rec.map_name, "Comet");
        assert_eq!(rec.players.len(), 2);
        assert_eq!(rec.players[0].name, "Alice");
        assert_eq!(rec.players[0].won, Some(true));
        assert_eq!(rec.size_bytes, 10);
        assert_eq!(rec.modified_ms, 20);
    }

    #[test]
    fn unchanged_matches_signature() {
        let rec = record_from(&entry("a.sdfz", 10, 20), demo_info("M", true, vec![]));
        assert!(unchanged(&rec, &entry("a.sdfz", 10, 20)));
        assert!(!unchanged(&rec, &entry("a.sdfz", 11, 20))); // size changed
        assert!(!unchanged(&rec, &entry("a.sdfz", 10, 21))); // mtime changed
    }

    #[test]
    fn store_roundtrips_through_disk() {
        let dir = std::env::temp_dir().join("coilbox_stats_test");
        let p = dir.join("stats.json");
        let _ = std::fs::remove_dir_all(&dir);
        let mut store = StatsStore::default();
        store.records.push(record_from(
            &entry("a.sdfz", 1, 2),
            demo_info("M", true, vec![]),
        ));
        save(&p, &store).unwrap();
        let back = load(&p).unwrap();
        assert_eq!(back.records.len(), 1);
        assert_eq!(back.records[0].filename, "a.sdfz");
    }

    #[test]
    fn missing_store_loads_empty() {
        let p = std::env::temp_dir().join("coilbox_stats_absent_xyz.json");
        let _ = std::fs::remove_file(&p);
        let store = load(&p).unwrap();
        assert!(store.records.is_empty());
    }
}
