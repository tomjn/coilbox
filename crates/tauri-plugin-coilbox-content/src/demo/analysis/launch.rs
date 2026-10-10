//! The analysis launch: one headless engine run of a replay, with a write
//! directory of its own, its output kept, and a limit on how long it may take
//! (issue #1155).
//!
//! It is separate from `play_launch_replay` on purpose. That launch opens a
//! window, sends the engine's output nowhere, and shares a registry that
//! refuses a second game, all of which is right for playing and wrong for this.
//!
//! What keeps a run away from the player's own engine state:
//!
//! - `--write-dir` names a scratch folder, which makes it the first data
//!   directory and the only one the engine writes to. Its `infolog.txt`, its
//!   archive cache and the logger's file all land there. Without it the engine
//!   writes its archive cache into its own folder, and a run would leave the
//!   player's cache holding an entry for a scratch game.
//! - `--isolation` with the engine's own folder stops it looking in the
//!   player's home folders. The engine's folder is the one that has to be named,
//!   because its base content is there and the engine cannot read even a start
//!   script without it.
//! - `SPRING_DATADIR` then adds the folders the run does need: the scratch one
//!   holding the analysis game, and the content folders holding the base game
//!   and the map. They are read and never written.
//! - `--config` names a scratch file as the engine's only configuration file.
//!   Without it the engine opens a `springsettings.cfg` in every data
//!   directory, the player's content folders included, and rewrites each one as
//!   it starts: `ConfigHandlerImpl::FinalizeLoad` deletes every setting that
//!   equals a default and every deprecated one from all of them, and each
//!   delete writes the file out again. With it the engine opens that one file
//!   and no other, so a player's settings are neither read nor written.
//! - `--only-local` opens no listening socket, so a run does not collide with a
//!   game being played.
//!
//! A headless engine does not stop when a replay ends: it goes on simulating.
//! The logger tells it to quit once the game over line is written, so a run
//! that works exits by itself with status zero. The time limit is for the runs
//! that do not, and it kills the engine. Nothing is lost by that, because the
//! logger flushes every line. The engine handles no signal gracefully: an
//! interrupt aborts it, and a demo it was recording is left empty.

use std::path::{Path, PathBuf};
use std::process::{ExitStatus, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

use serde::Serialize;

/// How often a running engine is checked for having exited, been cancelled or
/// run out of time. The same interval the play launch polls at.
const POLL_INTERVAL: Duration = Duration::from_millis(150);

/// The headless engine in an engine folder.
pub fn headless_binary(engine_dir: &Path) -> PathBuf {
    engine_dir.join(if cfg!(windows) {
        "spring-headless.exe"
    } else {
        "spring-headless"
    })
}

/// How an engine run ended.
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct EngineExit {
    /// The exit status, when the engine exited by itself.
    pub code: Option<i32>,
    /// The signal that ended it, on unix. A crash, or the kill this launch sent.
    pub signal: Option<i32>,
    /// The run reached its time limit and was killed.
    pub timed_out: bool,
    /// The caller cancelled the run and it was killed.
    pub cancelled: bool,
    /// Wall clock time from spawn to exit.
    pub wall_seconds: f64,
}

impl EngineExit {
    fn new(status: &ExitStatus, started: Instant, timed_out: bool, cancelled: bool) -> Self {
        #[cfg(unix)]
        let signal = {
            use std::os::unix::process::ExitStatusExt;
            status.signal()
        };
        #[cfg(not(unix))]
        let signal = None;
        EngineExit {
            code: status.code(),
            signal,
            timed_out,
            cancelled,
            wall_seconds: started.elapsed().as_secs_f64(),
        }
    }
}

/// What one run needs.
pub struct Launch<'a> {
    /// The `spring-headless` binary.
    pub engine: &'a Path,
    /// The replay to play, already pointed at the analysis game.
    pub demo: &'a Path,
    /// The scratch folder the engine writes to.
    pub write_dir: &'a Path,
    /// The engine's only configuration file, in scratch. It need not exist.
    pub config: &'a Path,
    /// The folders the engine reads games and maps from, highest priority first.
    pub data_dirs: &'a [PathBuf],
    /// Where the engine's output goes, both streams.
    pub log: &'a Path,
    /// How long the run may take before it is killed.
    pub timeout: Duration,
}

/// The engine's arguments, apart from the binary.
pub fn engine_args(engine_dir: &Path, write_dir: &Path, config: &Path, demo: &Path) -> Vec<String> {
    vec![
        "--isolation".into(),
        "--isolation-dir".into(),
        engine_dir.to_string_lossy().into_owned(),
        "--write-dir".into(),
        write_dir.to_string_lossy().into_owned(),
        "--config".into(),
        config.to_string_lossy().into_owned(),
        "--only-local".into(),
        demo.to_string_lossy().into_owned(),
    ]
}

/// The `SPRING_DATADIR` for a run. A folder with the separator in its name
/// cannot go in the list, because the engine would split it in two.
pub fn data_dir_list(data_dirs: &[PathBuf]) -> String {
    data_dirs
        .iter()
        .map(|dir| dir.to_string_lossy().into_owned())
        .filter(|dir| !dir.is_empty() && !dir.contains(coilbox_proc::DATADIR_SEP))
        .collect::<Vec<_>>()
        .join(&coilbox_proc::DATADIR_SEP.to_string())
}

/// Run the engine headless on a replay and wait for it.
///
/// Blocks until the engine exits, the time limit passes or `cancel` is set, and
/// kills the engine in the last two cases. Call it from a blocking task.
pub fn run_headless(launch: &Launch, cancel: &AtomicBool) -> Result<EngineExit, String> {
    let engine_dir = launch
        .engine
        .parent()
        .ok_or("the engine binary has no folder")?;
    std::fs::create_dir_all(launch.write_dir)
        .map_err(|e| format!("could not create {}: {e}", launch.write_dir.display()))?;
    let log = std::fs::File::create(launch.log)
        .map_err(|e| format!("could not create {}: {e}", launch.log.display()))?;
    let log_err = log
        .try_clone()
        .map_err(|e| format!("could not open {}: {e}", launch.log.display()))?;

    let mut cmd = coilbox_proc::command(launch.engine);
    cmd.args(engine_args(
        engine_dir,
        launch.write_dir,
        launch.config,
        launch.demo,
    ))
    .env("SPRING_DATADIR", data_dir_list(launch.data_dirs))
    // A write directory handed down from whatever started coilbox would be
    // added as a second one.
    .env_remove("SPRING_WRITEDIR")
    .stdin(Stdio::null())
    .stdout(Stdio::from(log))
    .stderr(Stdio::from(log_err));

    let started = Instant::now();
    let mut child = cmd
        .spawn()
        .map_err(|e| format!("failed to launch engine: {e}"))?;

    loop {
        if let Some(status) = child.try_wait().map_err(|e| e.to_string())? {
            return Ok(EngineExit::new(&status, started, false, false));
        }
        let cancelled = cancel.load(Ordering::Relaxed);
        let timed_out = started.elapsed() >= launch.timeout;
        if cancelled || timed_out {
            // Already gone is fine: it exited between the two checks.
            let _ = child.kill();
            let status = child.wait().map_err(|e| e.to_string())?;
            return Ok(EngineExit::new(&status, started, timed_out, cancelled));
        }
        std::thread::sleep(POLL_INTERVAL);
    }
}

#[cfg(all(test, unix))]
pub(super) mod tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;

    /// A shell script standing in for `spring-headless`. CI has no engine, and
    /// what is under test here is what this launch does around one: the
    /// arguments, the environment, the captured output, the limit and the kill.
    pub(in super::super) fn fake_engine(dir: &Path, body: &str) -> PathBuf {
        let engine_dir = dir.join("engine");
        std::fs::create_dir_all(&engine_dir).unwrap();
        let bin = engine_dir.join("spring-headless");
        std::fs::write(&bin, format!("#!/bin/sh\n{body}\n")).unwrap();
        std::fs::set_permissions(&bin, std::fs::Permissions::from_mode(0o755)).unwrap();
        bin
    }

    struct Run {
        dir: tempfile::TempDir,
        exit: EngineExit,
    }

    impl Run {
        fn log(&self) -> String {
            std::fs::read_to_string(self.dir.path().join("engine.log")).unwrap()
        }
    }

    fn run(body: &str, timeout: Duration, cancel: bool) -> Run {
        let dir = tempfile::tempdir().unwrap();
        let engine = fake_engine(dir.path(), body);
        let exit = run_headless(
            &Launch {
                engine: &engine,
                demo: &dir.path().join("replay.sdfz"),
                write_dir: &dir.path().join("write"),
                config: &dir.path().join("engine.cfg"),
                data_dirs: &[dir.path().join("data"), PathBuf::from("/content/root")],
                log: &dir.path().join("engine.log"),
                timeout,
            },
            &AtomicBool::new(cancel),
        )
        .unwrap();
        Run { dir, exit }
    }

    const LONG: Duration = Duration::from_secs(60);

    #[test]
    fn the_engine_is_run_isolated_with_a_write_directory_and_a_config_file_of_its_own() {
        let run = run("echo \"$@\"", LONG, false);
        let dir = run.dir.path().to_string_lossy().into_owned();

        assert_eq!(
            run.log().trim(),
            format!(
                "--isolation --isolation-dir {dir}/engine --write-dir {dir}/write --config {dir}/engine.cfg --only-local {dir}/replay.sdfz"
            )
        );
        assert_eq!(run.exit.code, Some(0));
        assert!(!run.exit.timed_out && !run.exit.cancelled);
        assert!(run.dir.path().join("write").is_dir());
    }

    #[test]
    fn the_engine_is_given_the_scratch_folder_then_the_content_folders() {
        let run = run("echo \"$SPRING_DATADIR\"", LONG, false);
        let dir = run.dir.path().to_string_lossy().into_owned();

        assert_eq!(run.log().trim(), format!("{dir}/data:/content/root"));
    }

    #[test]
    fn both_of_the_engines_output_streams_are_kept() {
        let run = run("echo to stdout; echo to stderr >&2", LONG, false);

        assert!(run.log().contains("to stdout"));
        assert!(run.log().contains("to stderr"));
    }

    #[test]
    fn a_failing_engine_reports_its_exit_status() {
        let run = run("echo broken; exit 3", LONG, false);

        assert_eq!(run.exit.code, Some(3));
        assert!(!run.exit.timed_out);
        assert!(run.log().contains("broken"));
    }

    /// The engine that never stops is the ordinary case, because a headless
    /// engine does not stop at the end of a replay. `exec` so the process this
    /// launch started is the one sleeping, as the engine would be.
    #[test]
    fn an_engine_that_outlives_its_limit_is_killed() {
        let started = Instant::now();
        let run = run(
            "echo started; exec sleep 600",
            Duration::from_secs(3),
            false,
        );

        assert!(run.exit.timed_out);
        assert_eq!(run.exit.code, None);
        assert_eq!(run.exit.signal, Some(libc_sigkill()));
        // Killed at the limit, not left to finish its ten minutes.
        assert!(started.elapsed() < Duration::from_secs(30));
        assert!(run.log().contains("started"));
    }

    #[test]
    fn a_cancelled_run_is_killed_and_says_so() {
        let run = run("exec sleep 600", LONG, true);

        assert!(run.exit.cancelled);
        assert!(!run.exit.timed_out);
    }

    #[test]
    fn an_engine_that_is_not_there_is_an_error() {
        let dir = tempfile::tempdir().unwrap();
        let result = run_headless(
            &Launch {
                engine: &dir.path().join("engine/spring-headless"),
                demo: &dir.path().join("replay.sdfz"),
                write_dir: &dir.path().join("write"),
                config: &dir.path().join("engine.cfg"),
                data_dirs: &[],
                log: &dir.path().join("engine.log"),
                timeout: LONG,
            },
            &AtomicBool::new(false),
        );

        assert!(result.unwrap_err().contains("failed to launch engine"));
    }

    #[test]
    fn a_folder_the_engine_would_split_is_left_out_of_the_list() {
        let dirs = [
            PathBuf::from("/a"),
            PathBuf::from(format!("/b{}c", coilbox_proc::DATADIR_SEP)),
            PathBuf::from("/d"),
        ];

        assert_eq!(
            data_dir_list(&dirs),
            format!("/a{}/d", coilbox_proc::DATADIR_SEP)
        );
    }

    /// `SIGKILL`, which is what `Child::kill` sends on unix.
    fn libc_sigkill() -> i32 {
        9
    }
}
