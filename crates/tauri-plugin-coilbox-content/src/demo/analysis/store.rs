//! Where an analysed replay's events are kept (issue #1158).
//!
//! One file per match under the app's data directory, in
//! `content/replay-analyses/`, beside `stats.json`. The file is named after the
//! replay's game id, which the demo header carries and `StatRecord.game_id`
//! stores, so a replay that is moved or renamed keeps its analysis.
//!
//! The file is gzipped JSON lines. The first line is the [`Provenance`]: what
//! produced the file, when, and how many lines of each kind follow. So "is this
//! replay analysed, by what, and when" is answered by decoding one line, and a
//! reader that wants the events streams the rest. The lines after it are the
//! logger's own, in the order it wrote them.
//!
//! Only two outcomes of a run are a property of the replay and are stored:
//!
//! - It reproduced the match. The file holds the provenance and every event.
//! - It finished and saw a different match. The file holds the provenance,
//!   with the figures that disagreed, and no events. That is kept so the app
//!   does not invite the same run again without saying how the last one went.
//!
//! A run that crashed, ran out of time or was cancelled says nothing about the
//! replay and leaves no file.
//!
//! A file is written under a temporary name and renamed into place, so a file
//! with a replay's name is always a whole one. A remix shares its original's
//! game id and is refused a key: see [`replay_key`].

use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};

use flate2::read::GzDecoder;
use flate2::write::GzEncoder;
use flate2::Compression;
use picoframe_core::CliResult;
use serde::{Deserialize, Serialize};
use serde_json::json;
use tauri::{AppHandle, Runtime};

use super::divergence::Disagreement;
use super::log::{EventCounts, LogLine, FORMAT_VERSION, LOGGER_VERSION};
use super::{AnalysisRun, AnalysisStatus};

/// The folder under `<data dir>/content/` that holds the files.
const DIR: &str = "replay-analyses";

/// What a stored file's name ends in.
const EXTENSION: &str = ".jsonl.gz";

/// The shape of the provenance line. Raised when a field of it changes meaning
/// or goes, never for a new one.
pub const STORE_FORMAT: u32 = 1;

/// The `kind` of the first line, which no logger line uses.
const PROVENANCE_KIND: &str = "analysis";

/// How many hex digits a game id has: the header holds 16 bytes.
const GAME_ID_DIGITS: usize = 32;

/// The folder analyses are kept in, given the app's data directory.
pub fn store_dir(data_dir: &Path) -> PathBuf {
    data_dir.join("content").join(DIR)
}

/// The folder analyses are kept in for this app. The data directory is the
/// resolved one, so a portable coilbox keeps them in its own folder.
pub(crate) fn app_store_dir<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    Ok(store_dir(&coilbox_portable::data_dir(app)?))
}

/// A game id as a file name may use it: 32 lowercase hex digits, not all zero.
///
/// The id is read out of a replay, or handed over by the frontend, and becomes
/// part of a path, so anything else is refused here. That is what keeps a
/// separator or a `..` out of the path. An all zero id is refused because it is
/// what a header with no id holds, and every such replay would share one file.
pub fn valid_game_id(id: &str) -> Result<String, String> {
    if id.len() != GAME_ID_DIGITS || !id.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err(format!(
            "not a replay game id: expected {GAME_ID_DIGITS} hex digits"
        ));
    }
    if id.bytes().all(|b| b == b'0') {
        return Err(
            "this replay has no game id, so an analysis of it has nothing to be filed under".into(),
        );
    }
    Ok(id.to_ascii_lowercase())
}

/// The key a replay's analysis is stored under, or why it has none.
///
/// A remix is a copy of a replay pointed at a different game. It keeps the
/// original's game id and the original's recorded result, so it has no key of
/// its own and none is given: under the shared id a remix would show events
/// from the original's game, and a run of the remix checked against the
/// original's result would file "diverged" against the original.
pub fn replay_key(replay: &Path) -> Result<String, String> {
    let raw = super::super::read_header_and_script(replay)?;
    let game = super::super::find_game(&super::super::parse_tdf(&raw.script));
    if super::super::read_remix_marker(&game).remixed {
        return Err(
            "this replay is a remix, and the result it recorded belongs to the original match"
                .into(),
        );
    }
    valid_game_id(&raw.game_id)
}

/// Which of the two stored outcomes a file records.
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum StoredOutcome {
    Reproduced,
    Diverged,
}

/// The first line of a stored file: what produced it.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Provenance {
    /// Always `analysis`. It is what tells this line from a logger's.
    pub kind: String,
    pub store_format: u32,
    pub outcome: StoredOutcome,
    pub game_id: String,
    /// The logger's line format, from its header line.
    pub logger_format: u32,
    /// Which logger wrote the events: [`LOGGER_VERSION`] as it was then. A
    /// later logger records more, and a file from before it does not hold it.
    pub logger_version: u32,
    /// The engine the run used, as it named itself.
    pub engine: String,
    /// The game the replay was recorded on, name and version, which the run
    /// loaded under the analysis game.
    pub game: String,
    pub map: String,
    /// When the run finished, in milliseconds since the Unix epoch.
    pub analysed_at_ms: u64,
    /// The match's length, and how long the engine took to play it back. Kept
    /// so a later estimate can come from this machine's own runs.
    pub match_seconds: u32,
    pub wall_seconds: f64,
    /// How many lines of each kind the run wrote. For a run that reproduced
    /// the match these are the lines that follow.
    #[serde(default)]
    pub counts: EventCounts,
    /// The figures the run and the replay disagreed on. Empty unless the
    /// outcome is `diverged`. This is the divergence report the run passed or
    /// failed.
    #[serde(default)]
    pub disagreements: Vec<Disagreement>,
}

impl Provenance {
    /// The provenance of a finished run, when the run is one that is stored.
    pub fn of(game_id: &str, run: &AnalysisRun, analysed_at_ms: u64) -> Option<Provenance> {
        let outcome = match run.report.status {
            AnalysisStatus::Reproduced => StoredOutcome::Reproduced,
            AnalysisStatus::Diverged => StoredOutcome::Diverged,
            AnalysisStatus::Incomplete | AnalysisStatus::LoggerNotLoaded => return None,
        };
        let header = run.report.header.clone().unwrap_or_default();
        Some(Provenance {
            kind: PROVENANCE_KIND.into(),
            store_format: STORE_FORMAT,
            outcome,
            game_id: game_id.into(),
            logger_format: header.format,
            logger_version: LOGGER_VERSION,
            engine: header.engine,
            game: run.report.base_game.clone(),
            map: header.map,
            analysed_at_ms,
            match_seconds: run.report.match_seconds,
            wall_seconds: run.report.exit.wall_seconds,
            counts: run.report.counts,
            disagreements: run.report.disagreements.clone(),
        })
    }
}

/// What a stored file means to a reader today.
#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum AnalysisState {
    /// Events from the logger this coilbox ships.
    Current,
    /// Events from an earlier logger or an earlier file shape. They still
    /// read, and a view that needs something newer should offer a new run.
    Outdated,
    /// A run finished and did not reproduce the match. There are no events.
    Diverged,
}

/// A stored file's provenance, with what it means now and what it costs.
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct StoredAnalysis {
    pub state: AnalysisState,
    /// The file's size on disk, compressed.
    pub size_bytes: u64,
    #[serde(flatten)]
    pub provenance: Provenance,
}

fn state_of(provenance: &Provenance) -> AnalysisState {
    if provenance.outcome == StoredOutcome::Diverged {
        AnalysisState::Diverged
    } else if provenance.store_format != STORE_FORMAT
        || provenance.logger_format != FORMAT_VERSION
        || provenance.logger_version < LOGGER_VERSION
    {
        AnalysisState::Outdated
    } else {
        AnalysisState::Current
    }
}

/// The path of a game id's file. The id is validated first, always.
fn file_path(dir: &Path, game_id: &str) -> Result<PathBuf, String> {
    Ok(dir.join(format!("{}{EXTENSION}", valid_game_id(game_id)?)))
}

/// Store a run's outcome, replacing whatever was stored for that match.
///
/// `events` is every line of a run that reproduced the match, and `None` for
/// one that diverged. Returns the size of the file written.
pub fn write(
    dir: &Path,
    provenance: &Provenance,
    events: Option<&[LogLine]>,
) -> Result<u64, String> {
    let path = file_path(dir, &provenance.game_id)?;
    std::fs::create_dir_all(dir).map_err(|e| format!("could not create {}: {e}", dir.display()))?;
    // In the same folder, so the rename cannot cross a filesystem. The name
    // does not end the way a stored file does, so a temporary file a crash
    // left behind is never read as an analysis.
    let temp = dir.join(format!("{}.tmp-{}", provenance.game_id, std::process::id()));
    let result = (|| -> std::io::Result<u64> {
        let mut gz = GzEncoder::new(std::fs::File::create(&temp)?, Compression::default());
        serde_json::to_writer(&mut gz, provenance)?;
        gz.write_all(b"\n")?;
        for line in events.unwrap_or_default() {
            serde_json::to_writer(&mut gz, line)?;
            gz.write_all(b"\n")?;
        }
        let file = gz.finish()?;
        file.sync_all()?;
        let size = file.metadata()?.len();
        std::fs::rename(&temp, &path)?;
        Ok(size)
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(&temp);
    }
    result.map_err(|e| format!("could not store the analysis: {e}"))
}

/// Open a stored file as lines.
fn lines_of(path: &Path) -> std::io::Result<impl Iterator<Item = std::io::Result<String>>> {
    Ok(BufReader::new(GzDecoder::new(std::fs::File::open(path)?)).lines())
}

fn read_stored(path: &Path) -> Option<StoredAnalysis> {
    let size_bytes = std::fs::metadata(path).ok()?.len();
    // Only the first line is decoded, however long the file is.
    let first = lines_of(path).ok()?.next()?.ok()?;
    let provenance: Provenance = serde_json::from_str(&first).ok()?;
    if provenance.kind != PROVENANCE_KIND {
        return None;
    }
    Some(StoredAnalysis {
        state: state_of(&provenance),
        size_bytes,
        provenance,
    })
}

/// What is stored for a match, if anything. A file that does not read is
/// treated as not there, and the next run replaces it.
pub fn read(dir: &Path, game_id: &str) -> Result<Option<StoredAnalysis>, String> {
    Ok(read_stored(&file_path(dir, game_id)?))
}

/// Whether a match has events from the current logger, which is what stops a
/// second run of it.
pub fn is_current(dir: &Path, game_id: &str) -> bool {
    matches!(
        read(dir, game_id),
        Ok(Some(StoredAnalysis {
            state: AnalysisState::Current,
            ..
        }))
    )
}

/// Everything stored, in no particular order. The library joins this to its
/// records by game id.
pub fn list(dir: &Path) -> Vec<StoredAnalysis> {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return Vec::new();
    };
    entries
        .flatten()
        .filter_map(|entry| {
            let name = entry.file_name().to_string_lossy().into_owned();
            let id = name.strip_suffix(EXTENSION)?;
            let stored = read_stored(&file_path(dir, id).ok()?)?;
            // A file renamed by hand answers for the id inside it, not for the
            // one in its name, so it is left out.
            (stored.provenance.game_id == id).then_some(stored)
        })
        .collect()
}

/// Some of a match's events.
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct EventPage {
    /// The lines asked for, each as the logger wrote it.
    pub events: Vec<serde_json::Value>,
    /// How many lines matched `kinds` in the whole file, so a caller knows
    /// whether there is more.
    pub total: usize,
}

/// A match's events, in file order.
///
/// `kinds` keeps only lines of those kinds, and `None` keeps every line.
/// `offset` and `limit` take a window of what was kept, so a caller that wants
/// a page does not receive the file. The file is streamed: nothing is held
/// but the window.
pub fn read_events(
    dir: &Path,
    game_id: &str,
    kinds: Option<&[String]>,
    offset: usize,
    limit: Option<usize>,
) -> Result<EventPage, String> {
    let path = file_path(dir, game_id)?;
    let lines =
        lines_of(&path).map_err(|e| format!("no analysis is stored for this replay: {e}"))?;
    let mut page = EventPage {
        events: Vec::new(),
        total: 0,
    };
    // The first line is the provenance.
    for line in lines.skip(1) {
        let line = line.map_err(|e| format!("could not read the stored analysis: {e}"))?;
        let Ok(value) = serde_json::from_str::<serde_json::Value>(&line) else {
            continue;
        };
        let kind = value.get("kind").and_then(|k| k.as_str()).unwrap_or("");
        if kinds.is_some_and(|kinds| !kinds.iter().any(|k| k == kind)) {
            continue;
        }
        if page.total >= offset && limit.is_none_or(|limit| page.events.len() < limit) {
            page.events.push(value);
        }
        page.total += 1;
    }
    Ok(page)
}

/// Delete what is stored for a match. Answers whether there was anything.
pub fn delete(dir: &Path, game_id: &str) -> Result<bool, String> {
    match std::fs::remove_file(file_path(dir, game_id)?) {
        Ok(()) => Ok(true),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(e) => Err(format!("could not delete the analysis: {e}")),
    }
}

/// The stored file a replay's deletion would take with it, and its size.
///
/// None for a replay with no key, which includes a remix: deleting a remix
/// must leave its original's analysis alone.
pub fn stored_for_replay(dir: &Path, replay: &Path) -> Option<(String, u64)> {
    let game_id = replay_key(replay).ok()?;
    let size = std::fs::metadata(file_path(dir, &game_id).ok()?)
        .ok()?
        .len();
    Some((game_id, size))
}

/// `content_replay_analyses`: every stored analysis, for the library to join
/// to its records by game id. Each entry is a provenance with its `state`
/// (`current`, `outdated` or `diverged`) and `sizeBytes`. No events.
///
/// A remix shares its original's game id and has no analysis of its own, so a
/// caller joining by id leaves remixed records out.
#[tauri::command]
pub(crate) async fn content_replay_analyses<R: Runtime>(app: AppHandle<R>) -> CliResult {
    let dir = match app_store_dir(&app) {
        Ok(dir) => dir,
        Err(e) => return CliResult::err(e),
    };
    match tauri::async_runtime::spawn_blocking(move || list(&dir)).await {
        Ok(analyses) => CliResult::ok(json!({ "analyses": analyses })),
        Err(e) => CliResult::err(format!("replay analyses task failed: {e}")),
    }
}

/// `content_replay_analysis`: what is stored for one match, or null. The
/// answer carries the counts per kind, so a caller that wants numbers does not
/// ask for the events.
#[tauri::command]
pub(crate) async fn content_replay_analysis<R: Runtime>(
    app: AppHandle<R>,
    game_id: String,
) -> CliResult {
    match app_store_dir(&app).and_then(|dir| read(&dir, &game_id)) {
        Ok(analysis) => CliResult::ok(json!({ "analysis": analysis })),
        Err(e) => CliResult::err(e),
    }
}

/// `content_replay_analysis_events`: a match's stored events, in the order the
/// logger wrote them. `kinds` keeps only those kinds. `offset` and `limit` take
/// a window, and `total` in the answer is how many lines matched in all.
#[tauri::command]
pub(crate) async fn content_replay_analysis_events<R: Runtime>(
    app: AppHandle<R>,
    game_id: String,
    kinds: Option<Vec<String>>,
    offset: Option<usize>,
    limit: Option<usize>,
) -> CliResult {
    let dir = match app_store_dir(&app) {
        Ok(dir) => dir,
        Err(e) => return CliResult::err(e),
    };
    let page = tauri::async_runtime::spawn_blocking(move || {
        read_events(&dir, &game_id, kinds.as_deref(), offset.unwrap_or(0), limit)
    })
    .await;
    match page {
        Ok(Ok(page)) => CliResult::ok(json!({ "events": page.events, "total": page.total })),
        Ok(Err(e)) => CliResult::err(e),
        Err(e) => CliResult::err(format!("replay analysis events task failed: {e}")),
    }
}

/// `content_replay_analysis_delete`: delete what is stored for one match,
/// leaving the replay alone. Answers `{ deleted }`, false when nothing was
/// stored.
#[tauri::command]
pub(crate) async fn content_replay_analysis_delete<R: Runtime>(
    app: AppHandle<R>,
    game_id: String,
) -> CliResult {
    match app_store_dir(&app).and_then(|dir| delete(&dir, &game_id)) {
        Ok(deleted) => CliResult::ok(json!({ "deleted": deleted })),
        Err(e) => CliResult::err(e),
    }
}

#[cfg(test)]
pub(super) mod tests {
    use super::super::super::tests::DemoFixture;
    use super::super::launch::EngineExit;
    use super::super::log::tests::FIXTURE;
    use super::super::log::{parse_log, LogHeader};
    use super::super::AnalysisReport;
    use super::*;

    pub(in super::super) const ID: &str = "a0a1a2a3a4a5a6a7a8a9aaabacadaeaf";
    const OTHER: &str = "00000000000000000000000000000001";

    /// A finished run of the logger's fixture match.
    pub(in super::super) fn run_with(status: AnalysisStatus) -> AnalysisRun {
        let log = parse_log(FIXTURE);
        let reproduced = status == AnalysisStatus::Reproduced;
        AnalysisRun {
            report: AnalysisReport {
                status,
                base_game: "Some Game 1.0".into(),
                match_seconds: 50,
                exit: EngineExit {
                    code: Some(0),
                    signal: None,
                    timed_out: false,
                    cancelled: false,
                    wall_seconds: 4.5,
                },
                header: log.header().cloned(),
                counts: log.counts(),
                malformed_lines: 0,
                truncated: false,
                disagreements: if status == AnalysisStatus::Diverged {
                    vec![Disagreement {
                        figure: "metalProduced".into(),
                        team: Some(0),
                        recorded: "1500".into(),
                        observed: "1750".into(),
                        difference: Some(250.0),
                    }]
                } else {
                    Vec::new()
                },
                log_excerpt: Vec::new(),
            },
            events: reproduced.then_some(log.lines),
        }
    }

    fn store(dir: &Path, id: &str, status: AnalysisStatus) -> u64 {
        let run = run_with(status);
        let provenance = Provenance::of(id, &run, 1_700_000_000_000).expect("a stored outcome");
        write(dir, &provenance, run.events.as_deref()).unwrap()
    }

    fn names(dir: &Path) -> Vec<String> {
        let mut names: Vec<String> = std::fs::read_dir(dir)
            .unwrap()
            .flatten()
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .collect();
        names.sort();
        names
    }

    #[test]
    fn a_game_id_is_32_hex_digits_and_not_all_zero() {
        assert_eq!(valid_game_id(ID).unwrap(), ID);
        // An id is compared and named in lowercase whatever case it came in.
        assert_eq!(valid_game_id(&ID.to_uppercase()).unwrap(), ID);
        for bad in [
            "",
            "abc",
            "00000000000000000000000000000000",
            "../../../../../../../etc/passwd0",
            "a0a1a2a3a4a5a6a7a8a9aaabacadaea/",
            "a0a1a2a3a4a5a6a7a8a9aaabacadaeaf0",
            "g0a1a2a3a4a5a6a7a8a9aaabacadaeaf",
            "a0a1a2a3a4a5a6a7a8a9aaabacadae\u{e9}",
        ] {
            assert!(valid_game_id(bad).is_err(), "accepted {bad:?}");
        }
    }

    /// Every function that takes an id builds a path from it, so every one of
    /// them has to refuse an id that is not one.
    #[test]
    fn no_entry_point_builds_a_path_from_a_bad_id() {
        let dir = tempfile::tempdir().unwrap();
        let outside = dir.path().join("outside.jsonl.gz");
        std::fs::write(&outside, b"keep").unwrap();
        let store_dir = dir.path().join("store");
        std::fs::create_dir_all(&store_dir).unwrap();
        let bad = "../outside";

        assert!(read(&store_dir, bad).is_err());
        assert!(read_events(&store_dir, bad, None, 0, None).is_err());
        assert!(delete(&store_dir, bad).is_err());
        let mut provenance = Provenance::of(ID, &run_with(AnalysisStatus::Reproduced), 0).unwrap();
        provenance.game_id = bad.into();
        assert!(write(&store_dir, &provenance, None).is_err());

        assert_eq!(std::fs::read(&outside).unwrap(), b"keep");
        assert_eq!(names(&store_dir), Vec::<String>::new());
    }

    #[test]
    fn a_reproduced_run_is_stored_with_its_provenance_and_every_event() {
        let dir = tempfile::tempdir().unwrap();

        let size = store(dir.path(), ID, AnalysisStatus::Reproduced);

        assert_eq!(names(dir.path()), vec![format!("{ID}.jsonl.gz")]);
        let stored = read(dir.path(), ID).unwrap().expect("stored");
        assert_eq!(stored.state, AnalysisState::Current);
        assert_eq!(stored.size_bytes, size);
        let p = &stored.provenance;
        assert_eq!(p.outcome, StoredOutcome::Reproduced);
        assert_eq!(p.game_id, ID);
        assert_eq!(
            (p.logger_format, p.logger_version),
            (FORMAT_VERSION, LOGGER_VERSION)
        );
        assert_eq!(p.engine, "2026.01.0 test");
        assert_eq!(p.game, "Some Game 1.0");
        assert_eq!(p.map, "Test Map");
        assert_eq!(p.analysed_at_ms, 1_700_000_000_000);
        assert_eq!((p.match_seconds, p.wall_seconds), (50, 4.5));
        assert_eq!(
            (
                p.counts.unit_created,
                p.counts.unit_finished,
                p.counts.unit_destroyed
            ),
            (6, 5, 4)
        );
        assert!(p.disagreements.is_empty());

        let page = read_events(dir.path(), ID, None, 0, None).unwrap();
        assert_eq!(page.total, 18);
        assert_eq!(page.events.len(), 18);
        assert_eq!(page.events[0]["kind"], "header");
        assert_eq!(page.events[17]["kind"], "game_over");
        // What comes back is what the logger wrote.
        let original: Vec<serde_json::Value> = FIXTURE
            .lines()
            .map(|line| serde_json::from_str(line).unwrap())
            .collect();
        assert_eq!(page.events[3]["x"], original[3]["x"]);
        assert_eq!(page.events[3]["def"], original[3]["def"]);
    }

    #[test]
    fn a_diverged_run_is_remembered_with_its_figures_and_no_events() {
        let dir = tempfile::tempdir().unwrap();

        store(dir.path(), ID, AnalysisStatus::Diverged);

        let stored = read(dir.path(), ID).unwrap().expect("stored");
        assert_eq!(stored.state, AnalysisState::Diverged);
        assert_eq!(stored.provenance.disagreements.len(), 1);
        assert_eq!(stored.provenance.disagreements[0].figure, "metalProduced");
        assert_eq!(stored.provenance.disagreements[0].difference, Some(250.0));
        assert_eq!(read_events(dir.path(), ID, None, 0, None).unwrap().total, 0);
        assert!(!is_current(dir.path(), ID));
    }

    #[test]
    fn a_run_that_did_not_finish_is_not_a_stored_outcome() {
        for status in [AnalysisStatus::Incomplete, AnalysisStatus::LoggerNotLoaded] {
            assert_eq!(Provenance::of(ID, &run_with(status), 0), None);
        }
    }

    #[test]
    fn events_are_filtered_by_kind_and_windowed() {
        let dir = tempfile::tempdir().unwrap();
        store(dir.path(), ID, AnalysisStatus::Reproduced);
        let destroyed = vec!["unit_destroyed".to_string()];
        let units = vec!["unit_created".to_string(), "unit_destroyed".to_string()];

        let all = read_events(dir.path(), ID, Some(&destroyed), 0, None).unwrap();
        assert_eq!((all.total, all.events.len()), (4, 4));
        assert!(all.events.iter().all(|e| e["kind"] == "unit_destroyed"));

        let both = read_events(dir.path(), ID, Some(&units), 0, None).unwrap();
        assert_eq!(both.total, 10);

        let window = read_events(dir.path(), ID, Some(&destroyed), 1, Some(2)).unwrap();
        assert_eq!((window.total, window.events.len()), (4, 2));
        assert_eq!(window.events[0], all.events[1]);
        assert_eq!(window.events[1], all.events[2]);

        let past = read_events(dir.path(), ID, None, 100, Some(5)).unwrap();
        assert_eq!((past.total, past.events.len()), (18, 0));
    }

    /// What tells a reader to offer a new run: a file from a logger older than
    /// the one this coilbox ships, or from a line format it does not write.
    #[test]
    fn a_file_from_an_earlier_logger_is_outdated_and_still_reads() {
        let dir = tempfile::tempdir().unwrap();
        let run = run_with(AnalysisStatus::Reproduced);
        let current = Provenance::of(ID, &run, 0).unwrap();

        let older_logger = Provenance {
            logger_version: LOGGER_VERSION - 1,
            ..current.clone()
        };
        write(dir.path(), &older_logger, run.events.as_deref()).unwrap();
        assert_eq!(
            read(dir.path(), ID).unwrap().unwrap().state,
            AnalysisState::Outdated
        );
        assert!(!is_current(dir.path(), ID));
        assert_eq!(
            read_events(dir.path(), ID, None, 0, None).unwrap().total,
            18
        );

        let other_format = Provenance {
            logger_format: FORMAT_VERSION + 1,
            ..current.clone()
        };
        write(dir.path(), &other_format, run.events.as_deref()).unwrap();
        assert_eq!(
            read(dir.path(), ID).unwrap().unwrap().state,
            AnalysisState::Outdated
        );

        write(dir.path(), &current, run.events.as_deref()).unwrap();
        assert!(is_current(dir.path(), ID));
    }

    /// A write that stops part way leaves a temporary file. It must not read
    /// as an analysis, and must not hide or damage the whole one beside it.
    #[test]
    fn an_interrupted_write_is_never_mistaken_for_a_whole_file() {
        let dir = tempfile::tempdir().unwrap();
        store(dir.path(), ID, AnalysisStatus::Reproduced);
        // What a write of another match would leave if it died before its
        // rename, and what one of this match would.
        std::fs::write(
            dir.path().join(format!("{OTHER}.tmp-123")),
            b"\x1f\x8b half",
        )
        .unwrap();
        std::fs::write(dir.path().join(format!("{ID}.tmp-123")), b"\x1f\x8b half").unwrap();

        assert_eq!(read(dir.path(), OTHER).unwrap(), None);
        let listed = list(dir.path());
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].provenance.game_id, ID);
        assert_eq!(
            read_events(dir.path(), ID, None, 0, None).unwrap().total,
            18
        );
    }

    #[test]
    fn a_write_leaves_no_temporary_file_and_replaces_what_was_there() {
        let dir = tempfile::tempdir().unwrap();
        store(dir.path(), ID, AnalysisStatus::Diverged);

        store(dir.path(), ID, AnalysisStatus::Reproduced);

        assert_eq!(names(dir.path()), vec![format!("{ID}.jsonl.gz")]);
        assert!(is_current(dir.path(), ID));
    }

    /// A file whose first line is not a provenance: cut short, not gzip, or
    /// something else entirely. Not there, as far as any reader is concerned.
    #[test]
    fn a_file_that_does_not_read_is_treated_as_not_there() {
        let dir = tempfile::tempdir().unwrap();
        store(dir.path(), ID, AnalysisStatus::Reproduced);
        let path = dir.path().join(format!("{ID}.jsonl.gz"));
        let whole = std::fs::read(&path).unwrap();

        for broken in [&whole[..10], b"not gzip at all".as_slice(), b"".as_slice()] {
            std::fs::write(&path, broken).unwrap();
            assert_eq!(read(dir.path(), ID).unwrap(), None);
            assert!(list(dir.path()).is_empty());
            assert!(!is_current(dir.path(), ID));
        }
    }

    #[test]
    fn listing_gives_every_stored_match_and_its_state() {
        let dir = tempfile::tempdir().unwrap();
        assert!(list(&dir.path().join("never-made")).is_empty());
        store(dir.path(), ID, AnalysisStatus::Reproduced);
        store(dir.path(), OTHER, AnalysisStatus::Diverged);
        std::fs::write(dir.path().join("notes.txt"), b"not ours").unwrap();

        let mut listed: Vec<(String, AnalysisState)> = list(dir.path())
            .into_iter()
            .map(|s| (s.provenance.game_id, s.state))
            .collect();
        listed.sort_by(|a, b| a.0.cmp(&b.0));

        assert_eq!(
            listed,
            vec![
                (OTHER.to_string(), AnalysisState::Diverged),
                (ID.to_string(), AnalysisState::Current),
            ]
        );
    }

    #[test]
    fn deleting_removes_the_file_and_says_whether_there_was_one() {
        let dir = tempfile::tempdir().unwrap();
        store(dir.path(), ID, AnalysisStatus::Reproduced);

        assert_eq!(delete(dir.path(), ID), Ok(true));
        assert_eq!(names(dir.path()), Vec::<String>::new());
        assert_eq!(read(dir.path(), ID).unwrap(), None);
        assert_eq!(delete(dir.path(), ID), Ok(false));
    }

    /// The first line has to be enough: a state must not cost a decode of the
    /// events. A file whose events are damaged still answers for its state.
    #[test]
    fn the_state_is_read_from_the_first_line_alone() {
        let dir = tempfile::tempdir().unwrap();
        let run = run_with(AnalysisStatus::Reproduced);
        let provenance = Provenance::of(ID, &run, 0).unwrap();
        let path = dir.path().join(format!("{ID}.jsonl.gz"));
        let mut gz = GzEncoder::new(
            std::fs::File::create(&path).unwrap(),
            Compression::default(),
        );
        serde_json::to_writer(&mut gz, &provenance).unwrap();
        gz.write_all(b"\n{not json\n\xff\xfe\n").unwrap();
        gz.finish().unwrap();

        let stored = read(dir.path(), ID).unwrap().expect("stored");
        assert_eq!(stored.state, AnalysisState::Current);
        assert_eq!(stored.provenance.counts.unit_destroyed, 4);
    }

    const SCRIPT: &str = "[game]\n{\ngametype=Some Game 1.0;\nmapname=Some Map;\n}\n";

    fn replay(game_id: [u8; 16]) -> Vec<u8> {
        DemoFixture {
            script: SCRIPT.into(),
            game_id,
            ..Default::default()
        }
        .gzipped()
    }

    fn fixture_id() -> [u8; 16] {
        DemoFixture::default().game_id
    }

    #[test]
    fn a_replays_key_is_the_game_id_in_its_header() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("match.sdfz");
        std::fs::write(&path, replay(fixture_id())).unwrap();

        assert_eq!(replay_key(&path).unwrap(), ID);
    }

    /// A header with no id would put every such replay under one file.
    #[test]
    fn a_replay_with_a_zeroed_game_id_has_no_key() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("match.sdfz");
        std::fs::write(&path, replay([0; 16])).unwrap();

        assert!(replay_key(&path).unwrap_err().contains("no game id"));
        assert_eq!(stored_for_replay(dir.path(), &path), None);
    }

    /// A remix is made by the real rewrite, so this follows whatever that
    /// writes: today, the original's game id unchanged.
    #[test]
    fn a_remix_carries_its_originals_game_id_and_is_given_no_key() {
        let dir = tempfile::tempdir().unwrap();
        let original = dir.path().join("match.sdfz");
        std::fs::write(&original, replay(fixture_id())).unwrap();
        let remix = super::super::super::rewrite_demo(&original, "Other Game 2.0", None).unwrap();

        let raw = super::super::super::read_header_and_script(&remix).unwrap();
        assert_eq!(raw.game_id, ID);
        assert!(replay_key(&remix).unwrap_err().contains("remix"));
        assert_eq!(replay_key(&original).unwrap(), ID);
    }

    #[test]
    fn deleting_a_replay_takes_its_analysis_and_a_preview_takes_nothing() {
        let dir = tempfile::tempdir().unwrap();
        let analyses = dir.path().join("analyses");
        let analysed = dir.path().join("analysed.sdfz");
        let plain = dir.path().join("plain.sdfz");
        std::fs::write(&analysed, replay(fixture_id())).unwrap();
        std::fs::write(&plain, replay([7; 16])).unwrap();
        let size = store(&analyses, ID, AnalysisStatus::Reproduced);
        let paths = [analysed.clone(), plain.clone()];

        let preview = super::super::super::delete_replays(&paths, false, Some(&analyses));
        assert_eq!((preview.deleted, preview.analyses), (2, 1));
        assert_eq!(preview.analysis_bytes, size);
        assert!(analysed.is_file() && is_current(&analyses, ID));

        let applied = super::super::super::delete_replays(&paths, true, Some(&analyses));
        assert_eq!((applied.deleted, applied.analyses), (2, 1));
        assert_eq!(applied.analysis_bytes, size);
        assert!(applied.skipped.is_empty(), "{:?}", applied.skipped);
        assert!(!analysed.exists() && !plain.exists());
        assert_eq!(names(&analyses), Vec::<String>::new());
    }

    /// The remix and the original hold the same id. Deleting the remix must
    /// not take the original's analysis.
    #[test]
    fn deleting_a_remix_leaves_its_originals_analysis() {
        let dir = tempfile::tempdir().unwrap();
        let analyses = dir.path().join("analyses");
        let original = dir.path().join("match.sdfz");
        std::fs::write(&original, replay(fixture_id())).unwrap();
        let remix = super::super::super::rewrite_demo(&original, "Other Game 2.0", None).unwrap();
        store(&analyses, ID, AnalysisStatus::Reproduced);

        let summary = super::super::super::delete_replays(
            std::slice::from_ref(&remix),
            true,
            Some(&analyses),
        );

        assert_eq!((summary.deleted, summary.analyses), (1, 0));
        assert!(!remix.exists());
        assert!(is_current(&analyses, ID));
    }

    /// Two files of one match share one analysis, which is counted once.
    #[test]
    fn two_copies_of_one_match_count_one_analysis() {
        let dir = tempfile::tempdir().unwrap();
        let analyses = dir.path().join("analyses");
        let paths = [dir.path().join("a.sdfz"), dir.path().join("b.sdfz")];
        for path in &paths {
            std::fs::write(path, replay(fixture_id())).unwrap();
        }
        store(&analyses, ID, AnalysisStatus::Reproduced);

        let preview = super::super::super::delete_replays(&paths, false, Some(&analyses));
        assert_eq!((preview.deleted, preview.analyses), (2, 1));
        let applied = super::super::super::delete_replays(&paths, true, Some(&analyses));
        assert_eq!((applied.deleted, applied.analyses), (2, 1));
        assert!(applied.skipped.is_empty(), "{:?}", applied.skipped);
    }

    /// Gathering moves a replay out of an engine's folder. The key is in the
    /// file and not in its path, so the analysis is still the moved file's.
    #[test]
    fn a_gathered_replay_keeps_its_analysis() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("root");
        let engine = root.join("engine").join("1.0");
        std::fs::create_dir_all(engine.join("demos")).unwrap();
        std::fs::write(engine.join("spring"), b"x").unwrap();
        let before = engine.join("demos").join("match.sdfz");
        std::fs::write(&before, replay(fixture_id())).unwrap();
        let analyses = dir.path().join("analyses");
        store(&analyses, ID, AnalysisStatus::Reproduced);
        let far_future = u64::MAX;

        let summary = super::super::super::gather_replays(&root, true, far_future);

        assert_eq!(summary.moved, vec!["match.sdfz"]);
        let after = root.join("demos").join("match.sdfz");
        assert!(after.is_file() && !before.exists());
        let key = replay_key(&after).unwrap();
        assert_eq!(key, ID);
        assert_eq!(
            read(&analyses, &key).unwrap().unwrap().state,
            AnalysisState::Current
        );
    }

    #[test]
    fn the_provenance_line_is_camel_case_json_with_its_kind_first() {
        let run = run_with(AnalysisStatus::Reproduced);
        let json = serde_json::to_string(&Provenance::of(ID, &run, 7).unwrap()).unwrap();

        assert!(
            json.starts_with("{\"kind\":\"analysis\",\"storeFormat\":1,"),
            "{json}"
        );
        assert!(json.contains("\"loggerVersion\":"));
        assert!(json.contains("\"analysedAtMs\":7"));
        // A header the logger never wrote leaves the fields empty, not absent.
        let mut bare = run_with(AnalysisStatus::Diverged);
        bare.report.header = None;
        let provenance = Provenance::of(ID, &bare, 0).unwrap();
        assert_eq!(provenance.engine, LogHeader::default().engine);
    }
}
