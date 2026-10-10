//! Replay analysis: play a replay back in the engine, headless, with coilbox's
//! own Lua recording what happened (issues #1183, #1155, #1184 and #1159).
//!
//! The file a replay is holds orders and totals. It does not hold where a unit
//! died or what was really built, because those are results of the simulation,
//! and the simulation is reproduced, not recorded. So the match is simulated
//! again with something watching.
//!
//! One run, in order:
//!
//! 1. Refuse a replay with no recorded outcome. See [`divergence`].
//! 2. Write the analysis game into a scratch data directory. See [`game`].
//! 3. Write a copy of the replay pointed at that game. See [`retarget`].
//! 4. Run the engine headless on the copy. See [`launch`].
//! 5. Read the logger's file. See [`log`].
//! 6. Compare what the run saw with what the replay recorded, and hand the
//!    events back only when they agree. See [`divergence`].
//! 7. Delete the scratch folder, whatever happened.
//!
//! The replay itself is read and never written, and nothing is written under a
//! content folder or beside the replay.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

use serde::Serialize;

pub mod divergence;
pub mod game;
pub mod launch;
pub mod log;
pub mod queue;
pub mod retarget;
pub mod store;

use divergence::Disagreement;
use launch::{EngineExit, RunControl};
use log::{EventCounts, LogHeader, LogLine};

/// The folder under the app's cache directory that runs make their scratch
/// folders in.
const SCRATCH_DIR: &str = "replay-analysis";

/// How many lines of the engine's output a report carries when a run did not
/// reproduce the match, for whoever has to work out why. The whole output is
/// deleted with the scratch folder.
const LOG_EXCERPT_LINES: usize = 40;

/// What a run came to.
#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum AnalysisStatus {
    /// The run saw the match the replay recorded. Its events are good.
    Reproduced,
    /// The run finished and saw a different match. Its events are of a game
    /// nobody played and are not handed back.
    Diverged,
    /// The logger started and the run stopped before the game ended: the engine
    /// crashed, ran out of time or was cancelled.
    Incomplete,
    /// The logger never wrote its header, so the gadget did not load or the
    /// engine did not get as far as loading it.
    LoggerNotLoaded,
}

/// Everything a run found out except the events themselves.
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AnalysisReport {
    pub status: AnalysisStatus,
    /// The game the replay was recorded on, which the analysis game depended on.
    pub base_game: String,
    /// The match's length as the replay's header has it, to set against
    /// `exit.wallSeconds`.
    pub match_seconds: u32,
    pub exit: EngineExit,
    /// The logger's first line. Absent when the logger did not load.
    pub header: Option<LogHeader>,
    pub counts: EventCounts,
    /// Whole lines of the log that did not read. None in a healthy run.
    pub malformed_lines: usize,
    /// The log ended part way through a line.
    pub truncated: bool,
    /// Every figure the run and the replay disagree on. Empty when the run
    /// reproduced the match, and when it never got far enough to compare.
    pub disagreements: Vec<Disagreement>,
    /// What the engine said, for a run that did not reproduce: the lines it
    /// marked fatal, or its last lines when it marked none.
    pub log_excerpt: Vec<String>,
}

/// A finished run.
#[derive(Clone, Debug, PartialEq)]
pub struct AnalysisRun {
    pub report: AnalysisReport,
    /// Every line the logger wrote, in order. Only for a run that reproduced
    /// the match.
    pub events: Option<Vec<LogLine>>,
}

/// What a run needs.
pub struct AnalysisRequest {
    /// The replay, which is read and never written.
    pub replay: PathBuf,
    /// The folder of the engine the replay was recorded with.
    pub engine_dir: PathBuf,
    /// The content folders holding the replay's game and map.
    pub data_dirs: Vec<PathBuf>,
    /// Where to make this run's scratch folder. Under the app's cache directory
    /// in the app.
    pub scratch_root: PathBuf,
    /// How long the engine may run before it is killed.
    pub timeout: Duration,
}

/// One run's scratch folder, removed when this is dropped, which is on every
/// way out of [`analyse_replay`] including an error and a panic.
struct Scratch {
    dir: PathBuf,
}

impl Scratch {
    fn create(root: &Path) -> Result<Self, String> {
        static NEXT: AtomicU64 = AtomicU64::new(0);
        // Unique among the runs of this process by the counter, and among
        // processes sharing a cache directory by the process id.
        let name = format!(
            "run-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        );
        let dir = root.join(name);
        // A folder of that name is a leftover from a process that died mid run
        // and whose id has come round again.
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir)
            .map_err(|e| format!("could not create {}: {e}", dir.display()))?;
        Ok(Scratch { dir })
    }
}

impl Drop for Scratch {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.dir);
    }
}

/// The part of the engine's output worth keeping from a run that went wrong.
///
/// The lines the engine marked fatal when it has any, earliest first, because
/// the first is the cause and an engine that gives up then logs a screen of
/// shutdown after it. The last lines otherwise.
fn excerpt(output: &str) -> Vec<String> {
    let fatal: Vec<&str> = output
        .lines()
        .filter(|line| line.contains("Fatal: "))
        .take(LOG_EXCERPT_LINES)
        .collect();
    let lines = if fatal.is_empty() {
        let all: Vec<&str> = output.lines().collect();
        all[all.len().saturating_sub(LOG_EXCERPT_LINES)..].to_vec()
    } else {
        fatal
    };
    lines.into_iter().map(str::to_string).collect()
}

/// How far a run has got.
#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum RunPhase {
    /// The engine is starting and the logger has written nothing.
    Starting,
    /// The logger has loaded and the match has not begun.
    Loading,
    /// The match is being played back.
    Playing,
}

/// Where a run is, read from the logger's file as it grows.
///
/// `frame` is the frame of the last event the logger wrote, so it is where the
/// playback had got to when something last happened, and it stands still
/// through a stretch of the match in which no unit is made or lost.
#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RunProgress {
    pub phase: RunPhase,
    pub frame: i32,
    /// The match's last frame, from the length in the replay's header. The
    /// header holds whole seconds, so the real last frame can be up to a
    /// second past it.
    pub last_frame: i32,
}

/// How much of the end of the logger's file is read to find its last line. A
/// unit's line in the logger's fixture is under 200 bytes.
const PROGRESS_TAIL_BYTES: u64 = 4096;

/// Reads a run's progress from the logger's file, again only when the file has
/// grown.
struct ProgressProbe {
    events: PathBuf,
    seen: std::cell::Cell<u64>,
    progress: std::cell::Cell<RunProgress>,
}

impl ProgressProbe {
    fn new(events: PathBuf, match_seconds: u32) -> Self {
        ProgressProbe {
            events,
            seen: std::cell::Cell::new(0),
            progress: std::cell::Cell::new(RunProgress {
                phase: RunPhase::Starting,
                frame: 0,
                last_frame: match_seconds as i32 * divergence::FRAMES_PER_SECOND,
            }),
        }
    }

    fn read(&self) -> RunProgress {
        let mut progress = self.progress.get();
        let Ok(len) = std::fs::metadata(&self.events).map(|m| m.len()) else {
            return progress;
        };
        if len == self.seen.get() {
            return progress;
        }
        self.seen.set(len);
        if let Some(found) = tail_progress(&self.events, len) {
            // The header is the only line with no frame.
            match found {
                Some(frame) => {
                    progress.phase = RunPhase::Playing;
                    progress.frame = frame;
                }
                None if progress.phase == RunPhase::Starting => {
                    progress.phase = RunPhase::Loading;
                }
                None => {}
            }
            self.progress.set(progress);
        }
        progress
    }
}

/// The frame on the last whole line of the logger's file. The outer `None` is
/// a file with no whole line in its tail, and the inner one a last line with
/// no frame.
fn tail_progress(events: &Path, len: u64) -> Option<Option<i32>> {
    use std::io::{Read, Seek, SeekFrom};
    let mut file = std::fs::File::open(events).ok()?;
    file.seek(SeekFrom::Start(len.saturating_sub(PROGRESS_TAIL_BYTES)))
        .ok()?;
    let mut tail = Vec::new();
    file.read_to_end(&mut tail).ok()?;
    let tail = String::from_utf8_lossy(&tail);
    // Text after the last newline is a line still being written.
    let whole = &tail[..tail.rfind('\n')?];
    let last = whole.rsplit('\n').next()?;
    let line: serde_json::Value = serde_json::from_str(last).ok()?;
    Some(
        line.get("frame")
            .and_then(|frame| frame.as_i64())
            .map(|frame| frame as i32),
    )
}

/// How long the engine is allowed to load before the match begins.
///
/// An allowance, not a measurement. What has been measured is one Mac: 9 to
/// 11 seconds for the engine to load a match, and 23.4 seconds more to scan
/// every archive when its cache is cold. Nothing has been measured on a slow
/// machine or a large game, so this is several times that sum. Too short kills
/// a run that was going to finish. Too long only delays giving up on an engine
/// that has hung, which a person can cancel in the meantime.
const START_UP_ALLOWANCE: Duration = Duration::from_secs(300);

/// How long a run of a match may take before it is killed.
///
/// The rule: the match's own length, plus [`START_UP_ALLOWANCE`]. The logger
/// asks the server to play as fast as the machine can, and the server never
/// plays slower than the match was played, so a run that has taken longer than
/// the match did is not going to finish.
pub fn run_timeout(match_seconds: u32) -> Duration {
    Duration::from_secs(u64::from(match_seconds)) + START_UP_ALLOWANCE
}

/// Analyse one replay. Blocks for as long as the engine runs, so call it from a
/// blocking task. Cancelling `control` kills the engine and ends the run.
/// `on_poll` is called a few times a second while the engine runs, with how far
/// the playback has got.
pub fn analyse_replay(
    request: &AnalysisRequest,
    control: &RunControl,
    on_poll: &dyn Fn(RunProgress),
) -> Result<AnalysisRun, String> {
    analyse_with(request, control, on_poll, game::LOGGER)
}

fn analyse_with(
    request: &AnalysisRequest,
    control: &RunControl,
    on_poll: &dyn Fn(RunProgress),
    logger: &str,
) -> Result<AnalysisRun, String> {
    let trailer = super::read_trailer(&request.replay)?;
    if !divergence::has_recorded_outcome(&trailer) {
        return Err(
            "this replay never recorded a game over, so there is nothing to check a run of it against"
                .into(),
        );
    }
    let raw = super::read_header_and_script(&request.replay)?;
    let base_game = super::find_game(&super::parse_tdf(&raw.script))
        .get("gametype")
        .unwrap_or("")
        .to_string();
    let engine = launch::headless_binary(&request.engine_dir);
    if !engine.is_file() {
        return Err(format!(
            "no headless engine in {}",
            request.engine_dir.display()
        ));
    }

    let scratch = Scratch::create(&request.scratch_root)?;
    let data = scratch.dir.join("data");
    let write_dir = scratch.dir.join("write");
    let demo = scratch.dir.join("replay.sdfz");
    let engine_log = scratch.dir.join("engine.log");

    game::write_game(&data, &base_game, logger)?;
    retarget::write_retargeted(&request.replay, &demo, &game::gametype())?;

    // The scratch folder first, so nothing in a content folder can stand in
    // for the analysis game.
    let mut data_dirs = vec![data];
    data_dirs.extend(request.data_dirs.iter().cloned());
    let probe = ProgressProbe::new(write_dir.join(game::EVENTS_FILE), raw.game_time);
    let exit = launch::run_headless(
        &launch::Launch {
            engine: &engine,
            demo: &demo,
            write_dir: &write_dir,
            config: &scratch.dir.join("engine.cfg"),
            data_dirs: &data_dirs,
            log: &engine_log,
            timeout: request.timeout,
            on_poll: &|| on_poll(probe.read()),
        },
        control,
    )?;

    // A file that is not there is a logger that never started, and reads as an
    // empty log.
    let events = std::fs::read(write_dir.join(game::EVENTS_FILE)).unwrap_or_default();
    let parsed = log::parse_log(&String::from_utf8_lossy(&events));
    let output = std::fs::read(&engine_log).unwrap_or_default();
    let output = String::from_utf8_lossy(&output);

    if let Some(header) = parsed.header().filter(|h| h.format != log::FORMAT_VERSION) {
        return Err(format!(
            "the replay logger wrote format {}, and this reader knows format {}",
            header.format,
            log::FORMAT_VERSION
        ));
    }

    let (status, disagreements) = if parsed.header().is_none() {
        (AnalysisStatus::LoggerNotLoaded, Vec::new())
    } else if parsed.game_over().is_none() {
        (AnalysisStatus::Incomplete, Vec::new())
    } else {
        let found = divergence::compare(
            &trailer,
            raw.game_time,
            &parsed,
            divergence::desync_warnings(&output),
        );
        if found.is_empty() {
            (AnalysisStatus::Reproduced, found)
        } else {
            (AnalysisStatus::Diverged, found)
        }
    };
    let reproduced = status == AnalysisStatus::Reproduced;

    Ok(AnalysisRun {
        report: AnalysisReport {
            status,
            base_game,
            match_seconds: raw.game_time,
            exit,
            header: parsed.header().cloned(),
            counts: parsed.counts(),
            malformed_lines: parsed.malformed,
            truncated: parsed.truncated,
            disagreements,
            log_excerpt: if reproduced {
                Vec::new()
            } else {
                excerpt(&output)
            },
        },
        events: reproduced.then_some(parsed.lines),
    })
}

/// The wall clock, in milliseconds since the Unix epoch.
pub(crate) fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

#[cfg(all(test, unix))]
mod tests {
    use super::super::tests::DemoFixture;
    use super::divergence::tests::{fixture_trailer, FIXTURE_SECONDS};
    use super::launch::tests::fake_engine;
    use super::log::tests::FIXTURE;
    use super::retarget::tests::{hash_of, stream_with_game_data};
    use super::*;

    const SCRIPT: &str = "[game]\n{\n\
        [player0]\n{\nteam=0;\nname=You;\n}\n\
        [team0]\n{\nallyteam=0;\nteamleader=0;\n}\n\
        [team1]\n{\nallyteam=1;\nteamleader=0;\n}\n\
        [allyteam0]\n{\nnumallies=0;\n}\n[allyteam1]\n{\nnumallies=0;\n}\n\
        gametype=Some Game 1.0;\nmapname=Some Map;\n}\n";

    /// A replay of the match the logger's fixture file records, so a fake
    /// engine that writes that file has reproduced it.
    fn replay_bytes() -> Vec<u8> {
        let trailer = fixture_trailer();
        DemoFixture {
            script: SCRIPT.into(),
            stream: stream_with_game_data(SCRIPT, b""),
            winning_ally_teams: vec![0],
            team_samples: trailer.teams.into_iter().map(|t| t.samples).collect(),
            team_stat_period: 16,
            game_time: FIXTURE_SECONDS as i32,
            ..Default::default()
        }
        .gzipped()
    }

    /// A player's library with one replay in it, an engine folder, and an empty
    /// place for scratch folders, all under one temporary directory.
    struct World {
        dir: tempfile::TempDir,
        replay: PathBuf,
    }

    impl World {
        fn new(replay: Vec<u8>) -> Self {
            let dir = tempfile::tempdir().unwrap();
            let replay_path = dir.path().join("library").join("match.sdfz");
            std::fs::create_dir_all(replay_path.parent().unwrap()).unwrap();
            std::fs::write(&replay_path, replay).unwrap();
            World {
                dir,
                replay: replay_path,
            }
        }

        fn scratch_root(&self) -> PathBuf {
            self.dir.path().join("cache").join(SCRATCH_DIR)
        }

        /// Where a fake engine copies what it was given, so a test can look at
        /// it after the scratch folder has gone.
        fn witness(&self) -> PathBuf {
            self.dir.path().join("witness")
        }

        fn analyse(&self, engine_body: &str, timeout: Duration) -> Result<AnalysisRun, String> {
            fake_engine(self.dir.path(), engine_body);
            analyse_replay(
                &AnalysisRequest {
                    replay: self.replay.clone(),
                    engine_dir: self.dir.path().join("engine"),
                    data_dirs: vec![self.dir.path().join("content")],
                    scratch_root: self.scratch_root(),
                    timeout,
                },
                &RunControl::default(),
                &|_| {},
            )
        }

        /// What is left under the scratch root once a run is over.
        fn leftovers(&self) -> Vec<String> {
            std::fs::read_dir(self.scratch_root())
                .map(|entries| {
                    entries
                        .flatten()
                        .map(|e| e.file_name().to_string_lossy().into_owned())
                        .collect()
                })
                .unwrap_or_default()
        }

        fn library(&self) -> Vec<String> {
            std::fs::read_dir(self.replay.parent().unwrap())
                .unwrap()
                .flatten()
                .map(|e| e.file_name().to_string_lossy().into_owned())
                .collect()
        }
    }

    /// The start of every fake engine: find the write directory and the replay
    /// among the arguments, the way the real one does.
    const FIND_ARGS: &str = "while [ $# -gt 1 ]; do\n\
        case \"$1\" in --write-dir) write=\"$2\";; esac\n\
        shift\n\
        done\n\
        demo=\"$1\"";

    /// A fake engine that writes `events` as the logger's file and exits.
    fn writes(events: &str) -> String {
        format!(
            "{FIND_ARGS}\ncat > \"$write/{}\" <<'COILBOX_FIXTURE'\n{events}COILBOX_FIXTURE\n",
            game::EVENTS_FILE
        )
    }

    const LONG: Duration = Duration::from_secs(60);

    /// A limit a fake engine is meant to hit. Long enough that a loaded machine
    /// has started the shell and written the file well before it passes.
    const SHORT: Duration = Duration::from_secs(3);

    #[test]
    fn a_run_that_matches_its_replay_hands_back_its_events() {
        let world = World::new(replay_bytes());

        let run = world.analyse(&writes(FIXTURE), LONG).unwrap();

        assert_eq!(run.report.status, AnalysisStatus::Reproduced);
        assert_eq!(run.report.disagreements, Vec::new());
        assert_eq!(run.report.base_game, "Some Game 1.0");
        assert_eq!(run.report.match_seconds, FIXTURE_SECONDS);
        assert_eq!(run.report.exit.code, Some(0));
        // Counts, not the absence of errors.
        assert_eq!(
            (
                run.report.counts.header,
                run.report.counts.unit_created,
                run.report.counts.unit_finished,
                run.report.counts.unit_destroyed,
                run.report.counts.game_over
            ),
            (1, 6, 5, 4, 1)
        );
        assert_eq!(run.report.header.as_ref().unwrap().game, "Test Game");
        assert_eq!(run.events.as_ref().unwrap().len(), 18);
        assert!(run.report.log_excerpt.is_empty());
    }

    #[test]
    fn a_run_that_diverged_names_the_figures_and_hands_back_no_events() {
        let world = World::new(replay_bytes());
        let other_match = FIXTURE
            .replace("\"metalProduced\":1500,", "\"metalProduced\":1750,")
            .replace("\"winners\":[0]", "\"winners\":[1]");

        let run = world.analyse(&writes(&other_match), LONG).unwrap();

        assert_eq!(run.report.status, AnalysisStatus::Diverged);
        assert!(run.events.is_none());
        let figures: Vec<_> = run
            .report
            .disagreements
            .iter()
            .map(|d| (d.figure.as_str(), d.team, d.difference))
            .collect();
        assert_eq!(
            figures,
            vec![
                ("winners", None, None),
                ("metalProduced", Some(0), Some(250.0))
            ]
        );
        // The counts are still reported, so the report says how far it got.
        assert_eq!(run.report.counts.unit_destroyed, 4);
    }

    /// The failure that reads like success: an engine that never started the
    /// logger writes no events and no errors about events.
    #[test]
    fn an_engine_that_never_started_the_logger_is_not_a_quiet_match() {
        let world = World::new(replay_bytes());

        let run = world
            .analyse("echo 'GAME-section missing'; exit 3", LONG)
            .unwrap();

        assert_eq!(run.report.status, AnalysisStatus::LoggerNotLoaded);
        assert_eq!(run.report.counts, EventCounts::default());
        assert!(run.report.header.is_none());
        assert!(run.events.is_none());
        assert_eq!(run.report.exit.code, Some(3));
        assert_eq!(run.report.log_excerpt, vec!["GAME-section missing"]);
    }

    /// An engine that gives up says why once and then logs its whole shutdown,
    /// so the end of its output is the wrong part to keep.
    #[test]
    fn the_engines_fatal_lines_are_kept_in_place_of_its_shutdown() {
        let world = World::new(replay_bytes());
        let body = "echo starting\n\
            echo '[t=00:00:00.3] Fatal: [ExitSpringProcess] duplicate base content detected'\n\
            echo shutting down\n\
            exit 21";

        let run = world.analyse(body, LONG).unwrap();

        assert_eq!(run.report.status, AnalysisStatus::LoggerNotLoaded);
        assert_eq!(run.report.exit.code, Some(21));
        assert_eq!(
            run.report.log_excerpt,
            vec!["[t=00:00:00.3] Fatal: [ExitSpringProcess] duplicate base content detected"]
        );
    }

    #[test]
    fn a_run_that_runs_out_of_time_is_killed_and_reports_what_it_had() {
        let world = World::new(replay_bytes());
        let cut = FIXTURE.rfind("{\"kind\":\"game_over\"").unwrap();
        let body = format!("{}exec sleep 600", writes(&FIXTURE[..cut]));

        let run = world.analyse(&body, SHORT).unwrap();

        assert_eq!(run.report.status, AnalysisStatus::Incomplete);
        assert!(run.report.exit.timed_out);
        assert_eq!(run.report.counts.unit_destroyed, 4);
        assert_eq!(run.report.counts.game_over, 0);
        assert!(run.events.is_none());
    }

    /// Success, divergence, a crash and a kill all leave the scratch root as
    /// empty as an error before the engine ran does.
    #[test]
    fn nothing_is_left_in_scratch_however_a_run_ends() {
        let cut = FIXTURE.rfind("{\"kind\":\"game_over\"").unwrap();
        let endings = [
            (writes(FIXTURE), LONG),
            (
                writes(&FIXTURE.replace("\"winners\":[0]", "\"winners\":[1]")),
                LONG,
            ),
            ("echo broken; exit 3".to_string(), LONG),
            (format!("{}exec sleep 600", writes(&FIXTURE[..cut])), SHORT),
        ];
        for (body, timeout) in endings {
            let world = World::new(replay_bytes());
            world.analyse(&body, timeout).unwrap();
            assert_eq!(world.leftovers(), Vec::<String>::new(), "after: {body}");
        }
    }

    /// The scratch folder holds real things while the engine runs, so its being
    /// empty afterwards is a removal and not a folder nothing was ever put in.
    #[test]
    fn the_engine_is_given_the_analysis_game_and_a_copy_that_names_it() {
        let world = World::new(replay_bytes());
        let witness = world.witness();
        let body = format!(
            "{}mkdir -p '{w}'\n\
             cp \"${{SPRING_DATADIR%%:*}}/games/{folder}/modinfo.lua\" '{w}/modinfo.lua'\n\
             cp \"$demo\" '{w}/replay.sdfz'\n\
             echo \"$SPRING_DATADIR\" > '{w}/datadir'\n\
             echo \"$write\" > '{w}/write'\n",
            writes(FIXTURE),
            w = witness.display(),
            folder = game::FOLDER,
        );

        let run = world.analyse(&body, LONG).unwrap();

        assert_eq!(run.report.status, AnalysisStatus::Reproduced);
        let modinfo = std::fs::read_to_string(witness.join("modinfo.lua")).unwrap();
        assert!(modinfo.contains("    \"Some Game 1.0\","), "{modinfo}");

        // The copy the engine played names the analysis game in its header,
        // and still decodes to the match the original recorded.
        let copy = witness.join("replay.sdfz");
        let raw = super::super::read_header_and_script(&copy).unwrap();
        assert!(raw.script.contains("gametype=Coilbox replay analysis 1;"));
        assert_eq!(
            super::super::read_trailer(&copy).unwrap(),
            super::super::read_trailer(&world.replay).unwrap()
        );

        // Scratch first, then the content folder, and a write directory inside
        // the same scratch folder.
        let datadir = std::fs::read_to_string(witness.join("datadir")).unwrap();
        let write = std::fs::read_to_string(witness.join("write")).unwrap();
        let root = world.scratch_root().to_string_lossy().into_owned();
        let content = world.dir.path().join("content");
        assert!(datadir.starts_with(&root), "{datadir}");
        assert!(datadir
            .trim()
            .ends_with(&format!("/data:{}", content.display())));
        assert!(write.starts_with(&root), "{write}");
        assert_eq!(world.leftovers(), Vec::<String>::new());
    }

    #[test]
    fn the_original_replay_has_the_same_hash_before_and_after_a_run() {
        let world = World::new(replay_bytes());
        let before = hash_of(&world.replay);
        let modified = std::fs::metadata(&world.replay)
            .unwrap()
            .modified()
            .unwrap();

        world.analyse(&writes(FIXTURE), LONG).unwrap();

        assert_eq!(hash_of(&world.replay), before);
        assert_eq!(
            std::fs::metadata(&world.replay)
                .unwrap()
                .modified()
                .unwrap(),
            modified
        );
        // And nothing was written beside it: the copy never enters the library.
        assert_eq!(world.library(), vec!["match.sdfz"]);
    }

    /// A match that was quit has no totals to hold a run to, so it is refused
    /// before an engine is started or a folder made.
    #[test]
    fn a_replay_with_no_recorded_outcome_is_refused_before_anything_runs() {
        let unfinished = DemoFixture {
            script: SCRIPT.into(),
            stream: stream_with_game_data(SCRIPT, b""),
            ..Default::default()
        };
        let world = World::new(unfinished.gzipped());

        let err = world
            .analyse(&format!("touch '{}'", world.witness().display()), LONG)
            .unwrap_err();

        assert!(err.contains("never recorded a game over"), "{err}");
        assert!(!world.witness().exists());
        assert!(!world.scratch_root().exists());
    }

    #[test]
    fn an_engine_folder_with_no_headless_binary_is_refused() {
        let world = World::new(replay_bytes());
        let result = analyse_replay(
            &AnalysisRequest {
                replay: world.replay.clone(),
                engine_dir: world.dir.path().join("no-engine-here"),
                data_dirs: Vec::new(),
                scratch_root: world.scratch_root(),
                timeout: LONG,
            },
            &RunControl::default(),
            &|_| {},
        );

        assert!(result.unwrap_err().contains("no headless engine"));
        assert!(!world.scratch_root().exists());
    }

    /// Progress is read from the logger's file while the engine runs, so the
    /// fake engine writes that file in three steps with a pause after each.
    #[test]
    fn progress_follows_the_logger_from_starting_to_the_last_event() {
        let world = World::new(replay_bytes());
        let lines: Vec<&str> = FIXTURE.lines().collect();
        let first_frame = serde_json::from_str::<serde_json::Value>(lines[2]).unwrap()["frame"]
            .as_i64()
            .unwrap() as i32;
        let body = format!(
            "{FIND_ARGS}\nout=\"$write/{file}\"\nsleep 1\n\
             cat > \"$out\" <<'COILBOX_ONE'\n{header}\nCOILBOX_ONE\nsleep 1\n\
             cat >> \"$out\" <<'COILBOX_TWO'\n{early}\nCOILBOX_TWO\nsleep 1\n\
             cat >> \"$out\" <<'COILBOX_THREE'\n{rest}\nCOILBOX_THREE\n",
            file = game::EVENTS_FILE,
            header = lines[0],
            early = lines[1..3].join("\n"),
            rest = lines[3..].join("\n"),
        );
        fake_engine(world.dir.path(), &body);
        let seen = std::sync::Mutex::new(Vec::new());

        let run = analyse_replay(
            &AnalysisRequest {
                replay: world.replay.clone(),
                engine_dir: world.dir.path().join("engine"),
                data_dirs: Vec::new(),
                scratch_root: world.scratch_root(),
                timeout: LONG,
            },
            &RunControl::default(),
            &|progress| {
                let mut seen = seen.lock().unwrap();
                if seen.last() != Some(&progress) {
                    seen.push(progress);
                }
            },
        )
        .unwrap();

        assert_eq!(run.report.status, AnalysisStatus::Reproduced);
        let seen = seen.into_inner().unwrap();
        let last_frame = FIXTURE_SECONDS as i32 * 30;
        let at = |phase, frame| RunProgress {
            phase,
            frame,
            last_frame,
        };
        assert_eq!(
            seen[..3],
            [
                at(RunPhase::Starting, 0),
                at(RunPhase::Loading, 0),
                at(RunPhase::Playing, first_frame),
            ]
        );
        // The engine exits as it writes the rest, so a fourth reading is rare.
        // When there is one it is further on.
        assert!(seen[3..]
            .iter()
            .all(|p| p.phase == RunPhase::Playing && p.frame > first_frame));
    }

    /// A line still being written is not read as the last one.
    #[test]
    fn a_half_written_line_does_not_move_the_progress() {
        let dir = tempfile::tempdir().unwrap();
        let events = dir.path().join("events.jsonl");
        let probe = ProgressProbe::new(events.clone(), 10);
        assert_eq!(probe.read().phase, RunPhase::Starting);

        std::fs::write(&events, "{\"kind\":\"header\",\"format\":1}\n").unwrap();
        assert_eq!(probe.read().phase, RunPhase::Loading);

        let whole =
            "{\"kind\":\"header\",\"format\":1}\n{\"kind\":\"unit_created\",\"frame\":120}\n";
        std::fs::write(
            &events,
            format!("{whole}{{\"kind\":\"unit_created\",\"frame\":99"),
        )
        .unwrap();
        let progress = probe.read();
        assert_eq!((progress.phase, progress.frame), (RunPhase::Playing, 120));
        assert_eq!(progress.last_frame, 300);
    }

    /// The rule, pinned: the match's own length plus the start-up allowance.
    #[test]
    fn a_run_is_allowed_the_matchs_length_and_time_to_start() {
        assert_eq!(run_timeout(0), START_UP_ALLOWANCE);
        assert_eq!(
            run_timeout(769),
            Duration::from_secs(769) + START_UP_ALLOWANCE
        );
    }

    #[test]
    fn two_runs_get_two_scratch_folders() {
        let root = tempfile::tempdir().unwrap();
        let first = Scratch::create(root.path()).unwrap();
        let second = Scratch::create(root.path()).unwrap();

        assert_ne!(first.dir, second.dir);
        assert!(first.dir.is_dir() && second.dir.is_dir());
        let (a, b) = (first.dir.clone(), second.dir.clone());
        drop(first);
        drop(second);
        assert!(!a.exists() && !b.exists());
    }

    /// The whole route against a real engine, a real game and a real replay.
    ///
    /// Reads what to run from the environment and does nothing without it:
    ///
    /// - `COILBOX_ANALYSIS_REPLAY`: the replay.
    /// - `COILBOX_ANALYSIS_ENGINE_DIR`: the folder of the engine it was
    ///   recorded with.
    /// - `COILBOX_ANALYSIS_DATA_DIRS`: the content folders holding its game and
    ///   map, separated the way `SPRING_DATADIR` is.
    /// - `COILBOX_ANALYSIS_TIMEOUT_SECS`: how long the engine may run.
    /// - `COILBOX_ANALYSIS_LOGGER`: a gadget to run in place of the logger, for
    ///   proving the divergence check catches one that changes the match. The
    ///   run is then expected to diverge.
    ///
    /// The scratch folder is a temporary directory, never the app's own cache.
    #[test]
    #[ignore = "needs an engine, a game, a map and a replay recorded with them"]
    fn a_real_replay_reproduces_under_the_analysis_game() {
        let var = |name: &str| std::env::var(name).ok().filter(|v| !v.is_empty());
        let (Some(replay), Some(engine_dir), Some(data_dirs), Some(timeout)) = (
            var("COILBOX_ANALYSIS_REPLAY"),
            var("COILBOX_ANALYSIS_ENGINE_DIR"),
            var("COILBOX_ANALYSIS_DATA_DIRS"),
            var("COILBOX_ANALYSIS_TIMEOUT_SECS"),
        ) else {
            eprintln!(
                "did nothing: set COILBOX_ANALYSIS_REPLAY, COILBOX_ANALYSIS_ENGINE_DIR, \
                 COILBOX_ANALYSIS_DATA_DIRS and COILBOX_ANALYSIS_TIMEOUT_SECS to run it"
            );
            return;
        };
        let perturbed = var("COILBOX_ANALYSIS_LOGGER")
            .map(|path| std::fs::read_to_string(path).expect("the substitute gadget"));
        let replay = PathBuf::from(replay);
        let before = hash_of(&replay);
        let scratch = tempfile::tempdir().unwrap();
        // An engine left to find its own configuration rewrites this file in
        // every data directory it is given.
        let settings: Vec<(PathBuf, u64, std::time::SystemTime)> = data_dirs
            .split(coilbox_proc::DATADIR_SEP)
            .map(|dir| PathBuf::from(dir).join("springsettings.cfg"))
            .filter(|path| path.is_file())
            .map(|path| {
                let modified = std::fs::metadata(&path).unwrap().modified().unwrap();
                (path.clone(), hash_of(&path), modified)
            })
            .collect();

        let run = analyse_with(
            &AnalysisRequest {
                replay: replay.clone(),
                engine_dir: PathBuf::from(engine_dir),
                data_dirs: data_dirs
                    .split(coilbox_proc::DATADIR_SEP)
                    .map(PathBuf::from)
                    .collect(),
                scratch_root: scratch.path().to_path_buf(),
                timeout: Duration::from_secs(timeout.parse().expect("seconds")),
            },
            &RunControl::default(),
            &|_| {},
            perturbed.as_deref().unwrap_or(game::LOGGER),
        )
        .expect("the run");

        eprintln!("{}", serde_json::to_string_pretty(&run.report).unwrap());
        assert_eq!(hash_of(&replay), before, "the replay was changed");
        for (path, hash, modified) in settings {
            assert_eq!(hash_of(&path), hash, "{} was changed", path.display());
            assert_eq!(
                std::fs::metadata(&path).unwrap().modified().unwrap(),
                modified,
                "{} was rewritten",
                path.display()
            );
        }
        assert_eq!(
            std::fs::read_dir(scratch.path()).unwrap().count(),
            0,
            "the scratch folder was left behind"
        );
        // Counts, never the absence of errors.
        assert_eq!(run.report.counts.header, 1, "the logger did not load");
        assert_eq!(run.report.counts.game_over, 1, "the game never ended");
        assert!(run.report.counts.unit_created > 0);
        assert!(run.report.counts.unit_destroyed > 0);
        if perturbed.is_some() {
            assert_eq!(run.report.status, AnalysisStatus::Diverged);
            assert!(run.events.is_none());
        } else {
            assert_eq!(run.report.status, AnalysisStatus::Reproduced);
            assert_eq!(
                run.events.expect("events").len(),
                run.report.counts.header
                    + run.report.counts.game_start
                    + run.report.counts.unit_created
                    + run.report.counts.unit_finished
                    + run.report.counts.unit_destroyed
                    + run.report.counts.game_over
                    + run.report.counts.unknown
            );
        }
    }
}
