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
use std::process::{Child, ExitStatus, Stdio};
use std::sync::Mutex;
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

/// The hold something outside a run has on it: the way to stop it.
///
/// The engine is spawned, polled and killed under one lock, and a cancel is
/// recorded under the same lock. So once [`RunControl::cancel`] has returned,
/// the engine this run started is dead and reaped, and the run will not start
/// one. That is what lets the app call it on its way out and know no headless
/// engine is left simulating at full speed with nothing to stop it.
#[derive(Default)]
pub struct RunControl {
    state: Mutex<ControlState>,
}

#[derive(Default)]
struct ControlState {
    child: Option<Child>,
    cancelled: bool,
    /// A cancel found the engine running and killed it.
    killed: bool,
}

impl RunControl {
    /// Stop the run: kill its engine if it has one and wait for it to be gone,
    /// and refuse it one if it has not started it yet.
    pub fn cancel(&self) {
        let mut state = self.state.lock().unwrap_or_else(|e| e.into_inner());
        state.cancelled = true;
        if let Some(child) = state.child.as_mut() {
            // An engine that has already exited by itself was not ended by
            // this, and its run is judged on what it wrote.
            if matches!(child.try_wait(), Ok(None)) {
                let _ = child.kill();
                let _ = child.wait();
                state.killed = true;
            }
        }
    }

    /// Whether the run has been cancelled, for a test's stand-in engine to
    /// stop on.
    #[cfg(test)]
    pub(super) fn was_cancelled(&self) -> bool {
        self.state
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .cancelled
    }

    /// The process id of the engine the run is running, for a test to look
    /// for afterwards.
    #[cfg(test)]
    pub(super) fn engine_pid(&self) -> Option<u32> {
        let state = self.state.lock().unwrap_or_else(|e| e.into_inner());
        state.child.as_ref().map(Child::id)
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
    /// Where to record the engine's process id once it is running, so that a
    /// later start can find it if this coilbox is killed outright. See
    /// [`kill_leftover_engine`].
    pub pid_file: &'a Path,
    /// The folders the engine reads games and maps from, highest priority first.
    pub data_dirs: &'a [PathBuf],
    /// Where the engine's output goes, both streams.
    pub log: &'a Path,
    /// How long the run may take before it is killed.
    pub timeout: Duration,
    /// Called each time the engine is checked, for as long as it runs.
    pub on_poll: &'a dyn Fn(),
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

/// Kills the engine a dead coilbox left running in `scratch`, if it is still
/// there. Returns whether it sent the kill.
///
/// Reads the pid file [`run_headless`] wrote. A pid alone is never enough,
/// because the OS reuses them, so the process must also be running the binary
/// the file names with this scratch folder in its arguments. A person playing
/// a game on the same engine binary has a different command line and is left
/// alone. Only unix can check that, so elsewhere this does nothing: on Windows
/// the job object ends the engine with coilbox.
pub fn kill_leftover_engine(scratch: &Path) -> bool {
    let Ok(record) = std::fs::read_to_string(scratch.join(PID_FILE)) else {
        return false;
    };
    let mut lines = record.lines();
    let (Some(pid), Some(engine)) = (
        lines.next().and_then(|p| p.parse::<u32>().ok()),
        lines.next(),
    ) else {
        return false;
    };
    coilbox_proc::kill_if_command_line_has(pid, &[engine, &scratch.to_string_lossy()])
}

/// The pid file's name in a run's scratch folder.
pub const PID_FILE: &str = "engine.pid";

/// Run the engine headless on a replay and wait for it.
///
/// Blocks until the engine exits, the time limit passes or `control` is
/// cancelled, and kills the engine in the last two cases. Call it from a
/// blocking task.
pub fn run_headless(launch: &Launch, control: &RunControl) -> Result<EngineExit, String> {
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

    // Only effective on Linux, and only because this thread is also the one that
    // waits for the engine below.
    coilbox_proc::die_with_parent(&mut cmd);

    let started = Instant::now();
    {
        // Spawned under the lock a cancel takes, so a cancel either comes
        // first and nothing is spawned, or finds the engine and kills it.
        let mut state = control.state.lock().unwrap_or_else(|e| e.into_inner());
        if state.cancelled {
            return Ok(EngineExit {
                code: None,
                signal: None,
                timed_out: false,
                cancelled: true,
                wall_seconds: 0.0,
            });
        }
        let child = cmd
            .spawn()
            .map_err(|e| format!("failed to launch engine: {e}"))?;
        // Best effort. Without it only the engine's own end of the replay
        // stops an engine left by a killed coilbox. The scratch folder was
        // made a moment ago, so a failure here means the disk is in trouble
        // and the run is about to fail anyway.
        let _ = std::fs::write(
            launch.pid_file,
            format!("{}\n{}\n", child.id(), launch.engine.display()),
        );
        state.child = Some(child);
    }

    loop {
        {
            let mut state = control.state.lock().unwrap_or_else(|e| e.into_inner());
            let killed = state.killed;
            let child = state.child.as_mut().expect("the engine this run spawned");
            let mut timed_out = false;
            let mut status = child.try_wait().map_err(|e| e.to_string())?;
            if status.is_none() && started.elapsed() >= launch.timeout {
                // Already gone is fine: it exited between the two checks.
                let _ = child.kill();
                status = Some(child.wait().map_err(|e| e.to_string())?);
                timed_out = true;
            }
            if let Some(status) = status {
                state.child = None;
                return Ok(EngineExit::new(&status, started, timed_out, killed));
            }
        }
        (launch.on_poll)();
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
        let control = RunControl::default();
        if cancel {
            control.cancel();
        }
        let exit = run_headless(
            &Launch {
                engine: &engine,
                demo: &dir.path().join("replay.sdfz"),
                write_dir: &dir.path().join("write"),
                config: &dir.path().join("engine.cfg"),
                pid_file: &dir.path().join(PID_FILE),
                data_dirs: &[dir.path().join("data"), PathBuf::from("/content/root")],
                log: &dir.path().join("engine.log"),
                timeout,
                on_poll: &|| {},
            },
            &control,
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

    /// The record a later start reads to find an engine a killed coilbox left.
    /// The script prints its own id, which is the id in the file.
    #[test]
    fn the_engines_process_id_and_binary_are_recorded_in_scratch() {
        let run = run("echo $$", LONG, false);
        let record = std::fs::read_to_string(run.dir.path().join(PID_FILE)).unwrap();
        let mut lines = record.lines();

        assert_eq!(lines.next(), Some(run.log().trim()));
        assert!(lines.next().unwrap().ends_with("spring-headless"));
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

    /// A run cancelled before it got as far as starting the engine starts
    /// none. The fake engine would leave a file if it ran.
    #[test]
    fn a_run_cancelled_before_it_starts_spawns_no_engine() {
        let run = run("touch \"$(dirname \"$0\")/ran\"", LONG, true);

        assert!(run.exit.cancelled);
        assert!(!run.exit.timed_out);
        assert!(!run.dir.path().join("engine").join("ran").exists());
    }

    /// The promise the app's exit rests on: when `cancel` returns, the engine
    /// is dead. The process is looked for by its id, which is still this
    /// run's to ask about because nothing has waited on it but the cancel.
    #[test]
    fn cancelling_a_running_engine_kills_it_before_cancel_returns() {
        let dir = tempfile::tempdir().unwrap();
        let engine = fake_engine(dir.path(), "echo started; exec sleep 600");
        let control = std::sync::Arc::new(RunControl::default());
        let pid = std::sync::Arc::new(Mutex::new(None));
        let started = Instant::now();

        let exit = std::thread::scope(|scope| {
            let run = scope.spawn(|| {
                run_headless(
                    &Launch {
                        engine: &engine,
                        demo: &dir.path().join("replay.sdfz"),
                        write_dir: &dir.path().join("write"),
                        config: &dir.path().join("engine.cfg"),
                        pid_file: &dir.path().join(PID_FILE),
                        data_dirs: &[],
                        log: &dir.path().join("engine.log"),
                        timeout: LONG,
                        on_poll: &|| {},
                    },
                    &control,
                )
            });
            // Wait for the engine to be there to kill.
            while control.engine_pid().is_none() {
                assert!(started.elapsed() < LONG, "the engine never started");
                std::thread::sleep(Duration::from_millis(10));
            }
            *pid.lock().unwrap() = control.engine_pid();
            let alive = pid.lock().unwrap().unwrap();
            assert!(coilbox_proc::is_running(alive));

            control.cancel();

            // No sleep between the cancel and the look.
            assert!(
                !coilbox_proc::is_running(alive),
                "the engine outlived the cancel"
            );
            run.join().unwrap().unwrap()
        });

        assert!(exit.cancelled);
        assert!(!exit.timed_out);
        assert_eq!(exit.signal, Some(libc_sigkill()));
        // Killed, not left to finish its ten minutes.
        assert!(started.elapsed() < Duration::from_secs(30));
    }

    /// The one thing between an analysis and a player's settings. Without
    /// `--config` the engine rewrites `springsettings.cfg` in every data
    /// directory it is shown, which is how one was emptied.
    #[test]
    fn the_engine_is_always_given_a_config_file_of_its_own() {
        let args = engine_args(
            Path::new("/engines/1"),
            Path::new("/scratch/write"),
            Path::new("/scratch/engine.cfg"),
            Path::new("/scratch/replay.sdfz"),
        );

        let at = args
            .iter()
            .position(|arg| arg == "--config")
            .expect("--config is gone from the analysis launch");
        assert_eq!(args[at + 1], "/scratch/engine.cfg");
        let write = args.iter().position(|arg| arg == "--write-dir").unwrap();
        assert_eq!(args[write + 1], "/scratch/write");
        assert!(args.iter().any(|arg| arg == "--isolation"));
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
                pid_file: &dir.path().join(PID_FILE),
                data_dirs: &[],
                log: &dir.path().join("engine.log"),
                timeout: LONG,
                on_poll: &|| {},
            },
            &RunControl::default(),
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
