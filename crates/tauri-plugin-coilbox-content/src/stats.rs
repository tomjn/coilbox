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
/// 2: records carry the match's skirmish AIs (`ais`), which the start-script
/// parser did not read before.
pub const STATS_SCHEMA_VERSION: u32 = 2;

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

/// One skirmish AI as recorded in a game. `shortName` is the AI's identity (the
/// `name` is usually just a slot label like `AI 1`), and `won` follows the same
/// rule as a player's.
#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct StatAi {
    pub name: String,
    pub short_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ally_team: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub side: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub won: Option<bool>,
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
    /// False when this file has no answer (the recording never reached a
    /// game over, or its trailer's format could not be decoded and demotool
    /// couldn't say either), so a view shows "result unknown" rather than
    /// counting the game as a loss for everyone.
    pub winners_known: bool,
    pub winning_ally_teams: Vec<u32>,
    pub remixed: bool,
    pub players: Vec<StatPlayer>,
    /// The skirmish AIs the match was played against. Kept out of `players` so a
    /// bot never becomes a name in the player list, but present so a view can
    /// count opponents (and so #543's "beat distinct AIs" has something to read).
    #[serde(default)]
    pub ais: Vec<StatAi>,
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
    let ais = info
        .ais
        .into_iter()
        .map(|a| StatAi {
            name: a.name,
            short_name: a.short_name,
            version: a.version,
            ally_team: a.ally_team,
            side: a.side,
            won: a.won,
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
        ais,
        ingested_at: now_ms(),
    }
}

/// Whether an existing record still matches the file on disk (same identity + size
/// + mtime) — if so, re-ingest skips the expensive decode.
fn unchanged(existing: &StatRecord, entry: &DemoFileEntry) -> bool {
    existing.size_bytes == entry.size_bytes && existing.modified_ms == entry.modified_ms
}

/// Incrementally ingest every demo under `roots` into `store`, decoding only files
/// that are new or changed since the last pass. The winner comes from the
/// replay's own trailer. `engine_dir` locates `demotool` only as a fallback for
/// a trailer format the decoder refuses, and the native decode still yields
/// map/players/game either way (with `winners_known = false` when neither path
/// could answer). A file that fails to decode is skipped and
/// counted in `failed`, never aborting the pass. Records are keyed by filename, so
/// re-ingesting the same library is idempotent.
///
/// The store carries one `schema_version` for every record in it, not a per-record
/// version. A store written under an older version may be missing fields added
/// since, even for a file whose `(size, mtime)` signature has not changed, so this
/// pass ignores the unchanged-signature fast path and re-decodes every record when
/// the stored version is behind `STATS_SCHEMA_VERSION`. Once the pass completes the
/// store is stamped current, and later passes are back on the fast path. A
/// store-level flag is enough here because ingest only ever persists after a full
/// pass completes (load, then ingest, then save, in one call), so there is no
/// partial-pass state that could land on disk with the version bumped but records
/// still stale.
///
/// The store is only mutated in memory. The caller persists it, or discards it for
/// a dry run.
pub fn ingest(roots: &[PathBuf], engine_dir: &Path, store: &mut StatsStore) -> IngestSummary {
    let force_reingest = store.schema_version < STATS_SCHEMA_VERSION;
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
                if !force_reingest && unchanged(&store.records[i], &entry) {
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
            ais: Vec::new(),
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
    fn record_from_carries_the_ais_the_match_was_played_against() {
        let mut info = demo_info("Comet", true, vec![player("Alice", 0, Some(true))]);
        info.ais = vec![crate::model::AiInfo {
            name: "AI 1".into(),
            short_name: "BARb".into(),
            version: Some("stable".into()),
            team: Some(1),
            ally_team: Some(1),
            host: Some(0),
            side: Some("Cortex".into()),
            rgb_color: None,
            won: Some(false),
        }];
        let rec = record_from(&entry("a.sdfz", 10, 20), info);
        // A bot is an opponent, not a name in the player list.
        assert_eq!(rec.players.len(), 1);
        assert_eq!(rec.ais.len(), 1);
        assert_eq!(rec.ais[0].short_name, "BARb");
        assert_eq!(rec.ais[0].version.as_deref(), Some("stable"));
        assert_eq!(rec.ais[0].side.as_deref(), Some("Cortex"));
        assert_eq!(rec.ais[0].won, Some(false));
    }

    /// A store written before AIs were recorded has no `ais` key at all. It must
    /// still load, so the ingest that refills it can run.
    #[test]
    fn a_record_written_without_ais_still_loads() {
        let json = r#"{"schemaVersion":1,"records":[{"filename":"a.sdfz","path":"/demos/a.sdfz",
            "mapName":"M","gameType":"G","engineVersion":"105","durationSec":1,"startTimeMs":2,
            "sizeBytes":3,"modifiedMs":4,"winnersKnown":false,"winningAllyTeams":[],
            "remixed":false,"players":[],"ingestedAt":5}]}"#;
        let store: StatsStore = serde_json::from_str(json).unwrap();
        assert!(store.records[0].ais.is_empty());
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

    // ---- schema-version-driven re-ingest ---------------------------------
    //
    // A tiny synthetic `.sdfz` builder, mirroring demo.rs's own test fixture, so
    // `ingest()` can be exercised end to end without a real replay file. The
    // header offsets are private to demo.rs, so they are duplicated here rather
    // than shared.

    const TEST_MAGIC: &[u8] = b"spring demofile";
    const TEST_OFF_HEADER_SIZE: usize = 20;
    const TEST_OFF_VERSION_STRING: usize = 24;
    const TEST_OFF_GAME_ID: usize = 280;
    const TEST_OFF_UNIX_TIME: usize = 296;
    const TEST_OFF_SCRIPT_SIZE: usize = 304;
    const TEST_OFF_GAME_TIME: usize = 312;
    const TEST_OFF_WALLCLOCK: usize = 316;
    const TEST_SCRIPT: &str = "[game]\n{\nmapname=TestMap;\ngametype=TestGame;\n\
        [player0]\n{\nname=Alice;\nteam=0;\nspectator=0;\n}\n\
        [ai0]\n{\nname=AI 1;\nshortname=BARb;\nversion=stable;\nteam=1;\nhost=0;\n}\n\
        [team0]\n{\nallyteam=0;\n}\n[team1]\n{\nallyteam=1;\n}\n}\n";

    fn build_test_demo(script: &str) -> Vec<u8> {
        let mut h = vec![0u8; 352];
        h[..TEST_MAGIC.len()].copy_from_slice(TEST_MAGIC);
        h[16..20].copy_from_slice(&5i32.to_le_bytes());
        h[TEST_OFF_HEADER_SIZE..TEST_OFF_HEADER_SIZE + 4].copy_from_slice(&352i32.to_le_bytes());
        let ver = b"105.1.2 TEST";
        h[TEST_OFF_VERSION_STRING..TEST_OFF_VERSION_STRING + ver.len()].copy_from_slice(ver);
        for (k, b) in (0..16).zip(0xA0u8..) {
            h[TEST_OFF_GAME_ID + k] = b;
        }
        h[TEST_OFF_UNIX_TIME..TEST_OFF_UNIX_TIME + 8]
            .copy_from_slice(&1_777_320_845u64.to_le_bytes());
        h[TEST_OFF_SCRIPT_SIZE..TEST_OFF_SCRIPT_SIZE + 4]
            .copy_from_slice(&(script.len() as i32).to_le_bytes());
        h[TEST_OFF_GAME_TIME..TEST_OFF_GAME_TIME + 4].copy_from_slice(&2356i32.to_le_bytes());
        h[TEST_OFF_WALLCLOCK..TEST_OFF_WALLCLOCK + 4].copy_from_slice(&2531i32.to_le_bytes());
        h.extend_from_slice(script.as_bytes());
        h
    }

    /// Write a synthetic demo under `<dir>/demos/<name>` and return its on-disk
    /// `(size, mtime)` signature, matching what `demo::demo_file_entries` would see.
    fn write_test_demo(dir: &Path, name: &str) -> (u64, u64) {
        let demos = dir.join("demos");
        std::fs::create_dir_all(&demos).unwrap();
        let p = demos.join(name);
        std::fs::write(&p, build_test_demo(TEST_SCRIPT)).unwrap();
        let md = std::fs::metadata(&p).unwrap();
        let mtime = md
            .modified()
            .ok()
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);
        (md.len(), mtime)
    }

    #[test]
    fn ingest_redecodes_stale_schema_record_despite_unchanged_signature() {
        let dir = std::env::temp_dir().join("coilbox_stats_ingest_stale");
        let _ = std::fs::remove_dir_all(&dir);
        let (size, mtime) = write_test_demo(&dir, "a.sdfz");

        // A record whose (size, mtime) signature already matches the file on disk,
        // but whose shape stands in for a record written before a field was added
        // (here, an empty roster), stored under an older schema version.
        let stale = record_from(
            &entry("a.sdfz", size, mtime),
            demo_info("Stale", true, vec![]),
        );
        let mut store = StatsStore {
            schema_version: STATS_SCHEMA_VERSION - 1,
            records: vec![stale],
        };

        let summary = ingest(
            std::slice::from_ref(&dir),
            Path::new("/no/such/engine"),
            &mut store,
        );

        assert_eq!(summary.updated, 1);
        assert_eq!(summary.skipped, 0);
        assert_eq!(store.records[0].map_name, "TestMap");
        assert_eq!(store.records[0].players.len(), 1);
        // The field the version bump exists for: a record written before AI
        // sections were parsed gains its opponents on the forced re-decode.
        assert_eq!(store.records[0].ais.len(), 1);
        assert_eq!(store.records[0].ais[0].short_name, "BARb");
        assert_eq!(store.records[0].ais[0].ally_team, Some(1));
        assert_eq!(store.schema_version, STATS_SCHEMA_VERSION);

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn ingest_skips_unchanged_record_already_at_current_schema() {
        let dir = std::env::temp_dir().join("coilbox_stats_ingest_current");
        let _ = std::fs::remove_dir_all(&dir);
        let (size, mtime) = write_test_demo(&dir, "a.sdfz");

        let current = record_from(
            &entry("a.sdfz", size, mtime),
            demo_info("Current", true, vec![player("Alice", 0, Some(true))]),
        );
        let mut store = StatsStore {
            schema_version: STATS_SCHEMA_VERSION,
            records: vec![current],
        };

        let summary = ingest(
            std::slice::from_ref(&dir),
            Path::new("/no/such/engine"),
            &mut store,
        );

        assert_eq!(summary.skipped, 1);
        assert_eq!(summary.updated, 0);
        // Unchanged: still carries the pre-ingest (unreal) shape, since the fast
        // path never re-decoded it.
        assert_eq!(store.records[0].map_name, "Current");

        let _ = std::fs::remove_dir_all(&dir);
    }
}
