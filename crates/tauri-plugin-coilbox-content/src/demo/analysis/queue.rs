//! The analysis queue: the replays a person has asked to have analysed, run
//! one at a time (issue #1157).
//!
//! An analysis runs the engine, so nothing starts one but a person asking for
//! that replay by name. What they ask for goes in here, and the queue belongs
//! to the app and not to a page: leaving the replay's page changes nothing,
//! and a page opened later asks for a [`QueueSnapshot`] and then listens for
//! [`QUEUE_EVENT`], which every window is sent whenever the queue changes.
//!
//! One worker thread takes jobs in order. It exists only while there is work.
//!
//! - It does not start a job while a game the player launched is running, and
//!   a job that is running when one starts is stopped and put back at the
//!   front. The game always wins: a run is cheap to do again and a stutter in
//!   a match is not. The play plugin says a game is running through
//!   `coilbox_proc::game_started`, since the two plugins do not depend on each
//!   other.
//! - A run that reproduced the match is stored with its events, and one that
//!   diverged is stored without. See [`store`]. Anything else is not a fact
//!   about the replay, so it is kept only here, as the last failure for that
//!   match this session, for the page to show.
//! - A match with a current analysis is not run again unless the job says to.
//!
//! This is separate from the play launch's `RunRegistry` on purpose. That one
//! refuses a second game. This one queues.

use std::collections::VecDeque;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Condvar, Mutex, MutexGuard};
use std::time::Duration;

use picoframe_core::CliResult;
use serde::Serialize;
use serde_json::json;
use tauri::{AppHandle, Emitter, Manager, Runtime, State};

use super::launch::RunControl;
use super::{
    analyse_replay, divergence, now_ms, run_timeout, store, AnalysisRequest, AnalysisRun,
    AnalysisStatus, RunPhase, RunProgress, SCRATCH_DIR,
};

/// The event every window is sent when the queue changes. Its payload is a
/// [`QueueSnapshot`].
pub const QUEUE_EVENT: &str = "coilbox-content://analysis-queue";

/// How often the worker looks again while it waits for a game to end. A
/// cadence, not a limit: nothing is given up on when it passes.
const GAME_POLL: Duration = Duration::from_millis(500);

/// How long the app waits on its way out for a stopped run to remove its
/// scratch folder. The engine is already dead by then: this is only the
/// tidying. A folder it does not wait long enough for is removed by
/// [`sweep_scratch`] at the next start, so neither a short nor a long wait
/// leaves anything behind for good.
const EXIT_TIDY_WAIT: Duration = Duration::from_secs(2);

/// One replay to analyse.
#[derive(Clone, Debug)]
pub struct JobSpec {
    pub replay: PathBuf,
    pub engine_dir: PathBuf,
    pub data_dirs: Vec<PathBuf>,
    /// The key the result is stored under. See [`store::replay_key`].
    pub game_id: String,
    /// The replay's file name, for a list to show.
    pub name: String,
    pub match_seconds: u32,
    /// Run even though a current analysis is stored. Only a person asking for
    /// a new analysis sets it.
    pub force: bool,
}

/// What runs the engine, and what knows whether a game is being played. A seam
/// so the queue's rules can be tested with neither.
pub trait Engine: Send + Sync + 'static {
    fn run(
        &self,
        job: &JobSpec,
        control: &RunControl,
        on_poll: &dyn Fn(RunProgress),
    ) -> Result<AnalysisRun, String>;

    fn game_running(&self) -> bool;
}

/// The real thing: a headless engine, with its scratch folders under the
/// app's cache directory.
struct HeadlessEngine {
    scratch_root: PathBuf,
}

impl Engine for HeadlessEngine {
    fn run(
        &self,
        job: &JobSpec,
        control: &RunControl,
        on_poll: &dyn Fn(RunProgress),
    ) -> Result<AnalysisRun, String> {
        // An engine left by a coilbox that was killed would be competing with
        // this run for the machine.
        sweep_scratch(&self.scratch_root);
        analyse_replay(
            &AnalysisRequest {
                replay: job.replay.clone(),
                engine_dir: job.engine_dir.clone(),
                data_dirs: job.data_dirs.clone(),
                scratch_root: self.scratch_root.clone(),
                timeout: run_timeout(job.match_seconds),
            },
            control,
            on_poll,
        )
    }

    fn game_running(&self) -> bool {
        coilbox_proc::game_running()
    }
}

/// Why a run produced nothing to store.
#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum FailureReason {
    /// The run reached its time limit and was killed. Not a divergence: it
    /// never got as far as being compared.
    TookTooLong,
    /// The engine stopped before the match ended, or never loaded the logger.
    EngineFailed,
    /// The run could not be started, or its result could not be stored.
    CouldNotRun,
}

/// The last run of a match that failed this session.
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Failure {
    pub game_id: String,
    pub name: String,
    pub reason: FailureReason,
    /// The detail: an error, or how the engine exited.
    pub message: String,
    /// The time limit, for a run that took too long.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub limit_seconds: Option<u64>,
    /// What the engine said: its fatal lines, or its last lines.
    pub log_excerpt: Vec<String>,
}

/// The job that is running.
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RunningJob {
    pub id: u64,
    pub game_id: String,
    pub name: String,
    pub replay_path: String,
    pub match_seconds: u32,
    pub started_at_ms: u64,
    pub phase: RunPhase,
    pub frame: i32,
    pub last_frame: i32,
    /// A cancel has been asked for and the run is on its way out.
    pub cancelling: bool,
}

/// A job that is waiting its turn.
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct QueuedJob {
    pub id: u64,
    pub game_id: String,
    pub name: String,
    pub replay_path: String,
}

/// The whole queue, as a page shows it.
#[derive(Serialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct QueueSnapshot {
    pub running: Option<RunningJob>,
    /// In the order they will run.
    pub queued: Vec<QueuedJob>,
    /// Nothing is running because a game is, and the queue starts again when
    /// it ends.
    pub waiting_for_game: bool,
    pub failures: Vec<Failure>,
    /// Counts up each time the store changes because of a run, so a listener
    /// knows to ask the store again.
    pub stored: u64,
}

/// What asking for an analysis came to.
#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum Enqueued {
    Queued,
    /// That match is already queued or running.
    AlreadyQueued,
    /// That match has a current analysis and the job did not ask for a new
    /// one. Nothing was queued.
    AlreadyAnalysed,
}

struct Job {
    id: u64,
    spec: JobSpec,
}

struct Running {
    job: Job,
    control: Arc<RunControl>,
    progress: RunProgress,
    started_at_ms: u64,
    cancelling: bool,
    /// Stopped because a game started, so it goes back in the queue.
    preempted: bool,
}

#[derive(Default)]
struct QueueState {
    next_id: u64,
    queued: VecDeque<Job>,
    running: Option<Running>,
    failures: Vec<Failure>,
    waiting_for_game: bool,
    stored: u64,
    /// A worker thread exists.
    working: bool,
    /// The app is on its way out. Nothing is queued or started again.
    closed: bool,
}

impl QueueState {
    fn snapshot(&self) -> QueueSnapshot {
        QueueSnapshot {
            running: self.running.as_ref().map(|running| RunningJob {
                id: running.job.id,
                game_id: running.job.spec.game_id.clone(),
                name: running.job.spec.name.clone(),
                replay_path: running.job.spec.replay.to_string_lossy().into_owned(),
                match_seconds: running.job.spec.match_seconds,
                started_at_ms: running.started_at_ms,
                phase: running.progress.phase,
                frame: running.progress.frame,
                last_frame: running.progress.last_frame,
                cancelling: running.cancelling,
            }),
            queued: self
                .queued
                .iter()
                .map(|job| QueuedJob {
                    id: job.id,
                    game_id: job.spec.game_id.clone(),
                    name: job.spec.name.clone(),
                    replay_path: job.spec.replay.to_string_lossy().into_owned(),
                })
                .collect(),
            waiting_for_game: self.waiting_for_game,
            failures: self.failures.clone(),
            stored: self.stored,
        }
    }

    fn holds(&self, game_id: &str) -> bool {
        self.queued.iter().any(|job| job.spec.game_id == game_id)
            || self
                .running
                .as_ref()
                .is_some_and(|running| running.job.spec.game_id == game_id)
    }
}

type Listener = Box<dyn Fn(&QueueSnapshot) + Send + Sync>;

struct Shared {
    engine: Box<dyn Engine>,
    /// Where analyses are stored.
    analyses: PathBuf,
    /// Told about every change, outside the state's lock.
    listener: Listener,
    /// Held from taking a snapshot to the listener having it, so two changes
    /// announced from two threads arrive in the order they happened. Without
    /// it the older snapshot can arrive last and a page is left showing it.
    announcing: Mutex<()>,
    state: Mutex<QueueState>,
    /// Signalled when the queue changes, for the worker's wait and for the
    /// app's wait on its way out.
    changed: Condvar,
}

impl Shared {
    fn lock(&self) -> MutexGuard<'_, QueueState> {
        // A panic while the lock was held leaves the state as it was at some
        // instant, which is still a queue.
        self.state.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// Tell the listener how the queue looks now. Never with the lock held,
    /// and never once the app is on its way out: the listener reaches into
    /// windows that are being torn down.
    fn announce(&self) {
        let _in_order = self.announcing.lock().unwrap_or_else(|e| e.into_inner());
        let snapshot = {
            let state = self.lock();
            if state.closed {
                return;
            }
            state.snapshot()
        };
        (self.listener)(&snapshot);
    }
}

/// The queue. Cloning it gives another handle on the same one.
#[derive(Clone)]
pub struct AnalysisQueue(Arc<Shared>);

impl AnalysisQueue {
    pub fn new(
        engine: impl Engine,
        analyses: PathBuf,
        listener: impl Fn(&QueueSnapshot) + Send + Sync + 'static,
    ) -> Self {
        AnalysisQueue(Arc::new(Shared {
            engine: Box::new(engine),
            analyses,
            listener: Box::new(listener),
            announcing: Mutex::new(()),
            state: Mutex::new(QueueState::default()),
            changed: Condvar::new(),
        }))
    }

    pub fn snapshot(&self) -> QueueSnapshot {
        self.0.lock().snapshot()
    }

    /// Ask for a replay to be analysed.
    pub fn enqueue(&self, spec: JobSpec) -> Result<Enqueued, String> {
        // Looked up before the lock is taken: it reads a file.
        let current = !spec.force && store::is_current(&self.0.analyses, &spec.game_id);
        {
            let mut state = self.0.lock();
            if state.closed {
                return Err("coilbox is closing".into());
            }
            if state.holds(&spec.game_id) {
                return Ok(Enqueued::AlreadyQueued);
            }
            if current {
                return Ok(Enqueued::AlreadyAnalysed);
            }
            // Asking again is the answer to the last failure.
            state.failures.retain(|f| f.game_id != spec.game_id);
            state.next_id += 1;
            let id = state.next_id;
            state.queued.push_back(Job { id, spec });
            if !state.working {
                state.working = true;
                let shared = self.0.clone();
                std::thread::spawn(move || work(&shared));
            }
        }
        self.0.changed.notify_all();
        self.0.announce();
        Ok(Enqueued::Queued)
    }

    /// Cancel one job. A queued one is dropped. A running one has its engine
    /// killed, and has gone from the queue by the time its run has tidied up.
    /// Answers whether there was such a job.
    pub fn cancel(&self, id: u64) -> bool {
        let control = {
            let mut state = self.0.lock();
            let before = state.queued.len();
            state.queued.retain(|job| job.id != id);
            if state.queued.len() != before {
                None
            } else {
                match state.running.as_mut().filter(|r| r.job.id == id) {
                    Some(running) => {
                        running.cancelling = true;
                        // A cancel outranks standing aside for a game.
                        running.preempted = false;
                        Some(running.control.clone())
                    }
                    None => return false,
                }
            }
        };
        if let Some(control) = control {
            control.cancel();
        }
        self.0.changed.notify_all();
        self.0.announce();
        true
    }

    /// Cancel everything, queued and running.
    pub fn cancel_all(&self) {
        let control = {
            let mut state = self.0.lock();
            state.queued.clear();
            state.running.as_mut().map(|running| {
                running.cancelling = true;
                running.preempted = false;
                running.control.clone()
            })
        };
        if let Some(control) = control {
            control.cancel();
        }
        self.0.changed.notify_all();
        self.0.announce();
    }

    /// Forget a match's last failure, once a person has read it.
    pub fn dismiss_failure(&self, game_id: &str) {
        self.0.lock().failures.retain(|f| f.game_id != game_id);
        self.0.announce();
    }

    /// Stop everything, for the app on its way out.
    ///
    /// When this returns no engine this queue started is alive: the kill and
    /// the wait happen in [`RunControl::cancel`], on this thread, before it
    /// does. It then gives the stopped run a moment to remove its scratch
    /// folder. Nothing is announced, and nothing can be queued afterwards.
    pub fn shutdown(&self) {
        let control = {
            let mut state = self.0.lock();
            state.closed = true;
            state.queued.clear();
            state.running.as_mut().map(|running| {
                running.cancelling = true;
                running.preempted = false;
                running.control.clone()
            })
        };
        if let Some(control) = control {
            control.cancel();
        }
        self.0.changed.notify_all();
        let state = self.0.lock();
        let _ = self
            .0
            .changed
            .wait_timeout_while(state, EXIT_TIDY_WAIT, |state| state.running.is_some());
    }
}

/// What a finished run means for the queue.
enum Outcome {
    /// The store changed.
    Stored,
    /// Nothing to keep and nothing to say: it was cancelled, or the match
    /// turned out to be analysed already.
    Nothing,
    /// A game started under it, so it goes back to the front.
    Requeue,
    Failed(Failure),
}

fn failure(
    job: &JobSpec,
    reason: FailureReason,
    message: String,
    run: Option<&AnalysisRun>,
) -> Outcome {
    Outcome::Failed(Failure {
        game_id: job.game_id.clone(),
        name: job.name.clone(),
        reason,
        message,
        limit_seconds: (reason == FailureReason::TookTooLong)
            .then(|| run_timeout(job.match_seconds).as_secs()),
        log_excerpt: run
            .map(|run| run.report.log_excerpt.clone())
            .unwrap_or_default(),
    })
}

/// Work out what a run came to, storing it when it is one of the two outcomes
/// that are stored.
fn settle(
    analyses: &Path,
    job: &JobSpec,
    result: Result<AnalysisRun, String>,
    preempted: bool,
) -> Outcome {
    let run = match result {
        Ok(run) => run,
        Err(e) => return failure(job, FailureReason::CouldNotRun, e, None),
    };
    if let Some(provenance) = store::Provenance::of(&job.game_id, &run, now_ms()) {
        return match store::write(analyses, &provenance, run.events.as_deref()) {
            Ok(_) => Outcome::Stored,
            Err(e) => failure(job, FailureReason::CouldNotRun, e, None),
        };
    }
    let exit = &run.report.exit;
    if exit.cancelled {
        return if preempted {
            Outcome::Requeue
        } else {
            Outcome::Nothing
        };
    }
    if exit.timed_out {
        return failure(
            job,
            FailureReason::TookTooLong,
            "the playback did not finish in the time allowed".into(),
            Some(&run),
        );
    }
    let how = match (exit.code, exit.signal) {
        (Some(code), _) => format!("the engine exited with status {code}"),
        (None, Some(signal)) => format!("the engine was ended by signal {signal}"),
        (None, None) => "the engine stopped".to_string(),
    };
    let stage = if run.report.status == AnalysisStatus::LoggerNotLoaded {
        "before the replay logger loaded"
    } else {
        "before the match ended"
    };
    failure(
        job,
        FailureReason::EngineFailed,
        format!("{how} {stage}"),
        Some(&run),
    )
}

/// The worker: take jobs in order until there are none.
fn work(shared: &Arc<Shared>) {
    loop {
        // Wait for there to be no game, then take the next job. One lock
        // scope from the look at the queue to the job being marked running,
        // so a shutdown sees either a queued job or a running one.
        let (job_id, spec, control) = {
            let mut state = shared.lock();
            loop {
                if state.closed || state.queued.is_empty() {
                    state.working = false;
                    state.waiting_for_game = false;
                    drop(state);
                    shared.changed.notify_all();
                    shared.announce();
                    return;
                }
                if !shared.engine.game_running() {
                    break;
                }
                if !state.waiting_for_game {
                    state.waiting_for_game = true;
                    drop(state);
                    shared.announce();
                    state = shared.lock();
                    continue;
                }
                state = shared
                    .changed
                    .wait_timeout(state, GAME_POLL)
                    .unwrap_or_else(|e| e.into_inner())
                    .0;
            }
            state.waiting_for_game = false;
            let job = state.queued.pop_front().expect("checked not empty");
            let control = Arc::new(RunControl::default());
            let (id, spec) = (job.id, job.spec.clone());
            state.running = Some(Running {
                progress: RunProgress {
                    phase: RunPhase::Starting,
                    frame: 0,
                    last_frame: spec.match_seconds as i32 * divergence::FRAMES_PER_SECOND,
                },
                job,
                control: control.clone(),
                started_at_ms: now_ms(),
                cancelling: false,
                preempted: false,
            });
            (id, spec, control)
        };
        shared.announce();

        // Never twice: it may have been analysed since it was queued.
        let result = if !spec.force && store::is_current(&shared.analyses, &spec.game_id) {
            None
        } else {
            Some(shared.engine.run(&spec, &control, &|progress| {
                on_poll(shared, job_id, &control, progress)
            }))
        };

        let preempted = shared
            .lock()
            .running
            .as_ref()
            .is_some_and(|running| running.preempted);
        let outcome = match result {
            None => Outcome::Nothing,
            Some(result) => settle(&shared.analyses, &spec, result, preempted),
        };
        {
            let mut state = shared.lock();
            let running = state.running.take().expect("this worker's job");
            match outcome {
                Outcome::Stored => state.stored += 1,
                Outcome::Nothing => {}
                Outcome::Requeue => {
                    if !state.closed {
                        state.queued.push_front(running.job);
                    }
                }
                Outcome::Failed(failure) => {
                    state.failures.retain(|f| f.game_id != failure.game_id);
                    state.failures.push(failure);
                }
            }
        }
        shared.changed.notify_all();
        shared.announce();
    }
}

/// Called a few times a second while a job's engine runs.
fn on_poll(shared: &Shared, job_id: u64, control: &RunControl, progress: RunProgress) {
    let mut moved = false;
    let mut stand_aside = false;
    {
        let mut state = shared.lock();
        let Some(running) = state.running.as_mut().filter(|r| r.job.id == job_id) else {
            return;
        };
        if running.progress != progress {
            running.progress = progress;
            moved = true;
        }
        if !running.cancelling && !running.preempted && shared.engine.game_running() {
            running.preempted = true;
            stand_aside = true;
        }
    }
    if stand_aside {
        control.cancel();
    }
    if moved || stand_aside {
        shared.announce();
    }
}

/// Clear up after a coilbox that died mid run: kill its engine if it is still
/// going, then remove its scratch folder. Returns how many engines it killed.
///
/// A run's folder is named after the process that made it. One whose process
/// is gone has nothing using it, except an engine that carried on when
/// coilbox was killed outright. [`launch::kill_leftover_engine`] finds that
/// engine through the pid file in the folder and checks the process before
/// signalling it. Run at startup and before each run, so a leftover engine
/// lives until the next start of coilbox on macOS, and not at all past the
/// moment of death on Linux (see [`coilbox_proc::die_with_parent`]).
pub fn sweep_scratch(scratch_root: &Path) -> usize {
    let Ok(entries) = std::fs::read_dir(scratch_root) else {
        return 0;
    };
    let mut killed = 0;
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        let pid = name
            .strip_prefix("run-")
            .and_then(|rest| rest.split('-').next())
            .and_then(|pid| pid.parse::<u32>().ok());
        if let Some(pid) = pid {
            if pid != std::process::id() && !coilbox_proc::is_running(pid) {
                if super::launch::kill_leftover_engine(&entry.path()) {
                    killed += 1;
                }
                let _ = std::fs::remove_dir_all(entry.path());
            }
        }
    }
    killed
}

/// Make the app's queue and hand it to Tauri. Called once, at plugin setup.
pub(crate) fn manage<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    let scratch_root = coilbox_portable::cache_dir(app)?.join(SCRATCH_DIR);
    let analyses = store::app_store_dir(app)?;
    {
        let scratch_root = scratch_root.clone();
        std::thread::spawn(move || {
            sweep_scratch(&scratch_root);
        });
    }
    let handle = app.clone();
    app.manage(AnalysisQueue::new(
        HeadlessEngine { scratch_root },
        analyses,
        move |snapshot| {
            let _ = handle.emit(QUEUE_EVENT, snapshot);
        },
    ));
    Ok(())
}

/// Stop the app's queue, for `RunEvent::Exit`.
pub(crate) fn shutdown<R: Runtime>(app: &AppHandle<R>) {
    if let Some(queue) = app.try_state::<AnalysisQueue>() {
        queue.shutdown();
    }
}

/// Why a replay cannot be analysed, whatever is installed.
#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum CannotAnalyse {
    /// It is a remix. See [`store::replay_key`].
    Remix,
    /// Its header holds no game id to file a result under.
    NoGameId,
    /// It never recorded a game over, so there is nothing to check a run of
    /// it against.
    NoGameOver,
    /// The file does not read as a replay.
    Unreadable,
}

impl CannotAnalyse {
    fn message(self) -> &'static str {
        match self {
            CannotAnalyse::Remix => {
                "this replay is a remix, and the result it recorded belongs to the original match"
            }
            CannotAnalyse::NoGameId => {
                "this replay has no game id, so an analysis of it has nothing to be filed under"
            }
            CannotAnalyse::NoGameOver => {
                "this replay never recorded a game over, so there is nothing to check a run of it against"
            }
            CannotAnalyse::Unreadable => "this file does not read as a replay",
        }
    }
}

/// What the replay itself says about being analysed: its key and its length,
/// or why it cannot be. Reads the replay and nothing else, so a page can ask
/// before it offers the button.
pub fn check_replay(replay: &Path) -> Result<(String, u32), CannotAnalyse> {
    let raw =
        super::super::read_header_and_script(replay).map_err(|_| CannotAnalyse::Unreadable)?;
    let game = super::super::find_game(&super::super::parse_tdf(&raw.script));
    if super::super::read_remix_marker(&game).remixed {
        return Err(CannotAnalyse::Remix);
    }
    let game_id = store::valid_game_id(&raw.game_id).map_err(|_| CannotAnalyse::NoGameId)?;
    let finished = super::super::read_trailer(replay)
        .is_ok_and(|trailer| divergence::has_recorded_outcome(&trailer));
    if !finished {
        return Err(CannotAnalyse::NoGameOver);
    }
    Ok((game_id, raw.game_time))
}

/// A job for a replay, or the reason it cannot be analysed in words a page
/// can show.
pub fn job_for(
    replay: &Path,
    engine_dir: &Path,
    data_dirs: Vec<PathBuf>,
    force: bool,
) -> Result<JobSpec, String> {
    let (game_id, match_seconds) = check_replay(replay).map_err(|why| why.message().to_string())?;
    if !super::launch::headless_binary(engine_dir).is_file() {
        return Err(format!("no headless engine in {}", engine_dir.display()));
    }
    Ok(JobSpec {
        replay: replay.to_path_buf(),
        engine_dir: engine_dir.to_path_buf(),
        data_dirs,
        game_id,
        name: replay
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_default(),
        match_seconds,
        force,
    })
}

const NO_QUEUE: &str = "replay analysis is not available: the app's folders could not be resolved";

/// `content_analysis_enqueue`: ask for a replay to be analysed. This is the
/// only command that leads to an engine being run for an analysis, and it is
/// only ever called because a person pressed the button for that replay.
///
/// `replayPath` is a `ReplayFile.path`. `enginePath` is the `Engine.path` of
/// the engine the replay was recorded with and `dataDir` the content folder it
/// plays from, resolved the way a replay launch resolves them. Every other
/// content folder coilbox knows is offered to the engine too. `force` asks for
/// a run of a match that already has a current analysis.
///
/// Answers `{ outcome, queue }`, where `outcome` is `queued`, `alreadyQueued`
/// or `alreadyAnalysed`. It rejects, with the reason, for a replay that cannot
/// be analysed: a remix, one with no game id, one with no recorded game over,
/// or an engine folder with no headless engine in it. The time limit is not
/// the caller's to choose: see `run_timeout`.
#[tauri::command]
pub(crate) async fn content_analysis_enqueue<R: Runtime>(
    app: AppHandle<R>,
    replay_path: String,
    engine_path: String,
    data_dir: String,
    force: Option<bool>,
) -> CliResult {
    let Some(queue) = app.try_state::<AnalysisQueue>().map(|q| q.inner().clone()) else {
        return CliResult::err(NO_QUEUE);
    };
    let mut data_dirs = vec![PathBuf::from(&data_dir)];
    data_dirs.extend(
        coilbox_proc::extra_datadirs(&data_dir)
            .split(coilbox_proc::DATADIR_SEP)
            .filter(|dir| !dir.is_empty())
            .map(PathBuf::from),
    );
    let asked = tauri::async_runtime::spawn_blocking(move || {
        let spec = job_for(
            Path::new(&replay_path),
            Path::new(&engine_path),
            data_dirs,
            force.unwrap_or(false),
        )?;
        let outcome = queue.enqueue(spec)?;
        Ok::<_, String>((outcome, queue.snapshot()))
    })
    .await;
    match asked {
        Ok(Ok((outcome, queue))) => CliResult::ok(json!({ "outcome": outcome, "queue": queue })),
        Ok(Err(e)) => CliResult::err(e),
        Err(e) => CliResult::err(format!("replay analysis task failed: {e}")),
    }
}

/// `content_analysis_check`: whether a replay can be analysed at all, read
/// from the replay and nothing else, so a page can say why not beside a
/// disabled button. Answers `{ cannot, gameId, matchSeconds }`. `cannot` is
/// null for a replay that can be, and otherwise `remix`, `noGameId`,
/// `noGameOver` or `unreadable`. Whether its engine, game and map are
/// installed is a separate question, which the page already answers.
#[tauri::command]
pub(crate) async fn content_analysis_check(replay_path: String) -> CliResult {
    let checked =
        tauri::async_runtime::spawn_blocking(move || check_replay(Path::new(&replay_path))).await;
    match checked {
        Ok(Ok((game_id, match_seconds))) => CliResult::ok(
            json!({ "cannot": null, "gameId": game_id, "matchSeconds": match_seconds }),
        ),
        Ok(Err(why)) => CliResult::ok(json!({ "cannot": why, "gameId": null, "matchSeconds": 0 })),
        Err(e) => CliResult::err(format!("replay analysis task failed: {e}")),
    }
}

/// `content_analysis_queue`: the queue as it is now. A page asks once when it
/// opens and then listens for [`QUEUE_EVENT`].
#[tauri::command]
pub(crate) async fn content_analysis_queue(
    queue: State<'_, AnalysisQueue>,
) -> Result<CliResult, ()> {
    Ok(CliResult::ok(json!({ "queue": queue.snapshot() })))
}

/// `content_analysis_cancel`: cancel one job by its id, queued or running.
/// With no `id`, cancel every job. A running job's engine is killed, its
/// scratch folder removed and nothing of it stored.
#[tauri::command]
pub(crate) async fn content_analysis_cancel(
    queue: State<'_, AnalysisQueue>,
    id: Option<u64>,
) -> Result<CliResult, ()> {
    let queue = queue.inner().clone();
    // Off the async runtime: cancelling a running job waits for its engine
    // to be gone.
    let cancelled = tauri::async_runtime::spawn_blocking(move || match id {
        Some(id) => queue.cancel(id),
        None => {
            queue.cancel_all();
            true
        }
    })
    .await;
    Ok(match cancelled {
        Ok(cancelled) => CliResult::ok(json!({ "cancelled": cancelled })),
        Err(e) => CliResult::err(format!("replay analysis task failed: {e}")),
    })
}

/// `content_analysis_dismiss`: forget a match's last failed run, once it has
/// been read.
#[tauri::command]
pub(crate) async fn content_analysis_dismiss(
    queue: State<'_, AnalysisQueue>,
    game_id: String,
) -> Result<CliResult, ()> {
    queue.dismiss_failure(&game_id);
    Ok(CliResult::ok(json!({ "ok": true })))
}

#[cfg(test)]
mod tests {
    use super::super::launch::EngineExit;
    use super::super::store::tests::{run_with, ID};
    use super::*;
    use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
    use std::time::Instant;

    const OTHER: &str = "00000000000000000000000000000002";
    const THIRD: &str = "00000000000000000000000000000003";

    /// How long a test waits for the worker before calling it stuck.
    const PATIENCE: Duration = Duration::from_secs(20);

    /// What a fake engine does with a job.
    #[derive(Clone, Copy, PartialEq)]
    enum Script {
        /// Finish at once with this status.
        Finish(AnalysisStatus),
        /// Run until cancelled, like an engine that is still simulating.
        UntilCancelled,
        /// Run until `release` is set, then reproduce the match.
        UntilReleased,
        TimeOut,
        Crash,
        Refuse,
    }

    /// Stands in for the engine. It records how many runs were started and how
    /// many were going at once, which is what the queue's rules are about.
    struct FakeEngine {
        script: Mutex<Script>,
        started: AtomicUsize,
        active: AtomicUsize,
        most_at_once: AtomicUsize,
        game: AtomicBool,
        release: AtomicBool,
    }

    impl FakeEngine {
        fn new(script: Script) -> Arc<Self> {
            Arc::new(FakeEngine {
                script: Mutex::new(script),
                started: AtomicUsize::new(0),
                active: AtomicUsize::new(0),
                most_at_once: AtomicUsize::new(0),
                game: AtomicBool::new(false),
                release: AtomicBool::new(false),
            })
        }

        fn set(&self, script: Script) {
            *self.script.lock().unwrap() = script;
        }
    }

    fn with_exit(
        mut run: AnalysisRun,
        timed_out: bool,
        cancelled: bool,
        code: Option<i32>,
    ) -> AnalysisRun {
        run.report.exit = EngineExit {
            code,
            signal: None,
            timed_out,
            cancelled,
            wall_seconds: 1.0,
        };
        run
    }

    impl Engine for Arc<FakeEngine> {
        fn run(
            &self,
            job: &JobSpec,
            control: &RunControl,
            on_poll: &dyn Fn(RunProgress),
        ) -> Result<AnalysisRun, String> {
            // Read before the run counts as started, so a test that waits for
            // the count knows which script this run took.
            let script = *self.script.lock().unwrap();
            let now = self.active.fetch_add(1, Ordering::SeqCst) + 1;
            self.most_at_once.fetch_max(now, Ordering::SeqCst);
            self.started.fetch_add(1, Ordering::SeqCst);
            let progress = |frame| RunProgress {
                phase: RunPhase::Playing,
                frame,
                last_frame: job.match_seconds as i32 * 30,
            };
            let result = match script {
                Script::Finish(status) => {
                    on_poll(progress(60));
                    Ok(run_with(status))
                }
                Script::UntilCancelled | Script::UntilReleased => {
                    // The real launch finds out it was cancelled from the
                    // control. This asks it the way a test can.
                    let began = Instant::now();
                    loop {
                        on_poll(progress(90));
                        if control.was_cancelled() {
                            break Ok(with_exit(
                                run_with(AnalysisStatus::Incomplete),
                                false,
                                true,
                                None,
                            ));
                        }
                        if script == Script::UntilReleased && self.release.load(Ordering::SeqCst) {
                            break Ok(run_with(AnalysisStatus::Reproduced));
                        }
                        assert!(
                            began.elapsed() < PATIENCE,
                            "the fake engine was never stopped"
                        );
                        std::thread::sleep(Duration::from_millis(5));
                    }
                }
                Script::TimeOut => Ok(with_exit(
                    run_with(AnalysisStatus::Incomplete),
                    true,
                    false,
                    None,
                )),
                Script::Crash => {
                    let mut run = with_exit(
                        run_with(AnalysisStatus::LoggerNotLoaded),
                        false,
                        false,
                        Some(3),
                    );
                    run.report.log_excerpt = vec!["GAME-section missing".into()];
                    Ok(run)
                }
                Script::Refuse => Err("no headless engine in /nowhere".into()),
            };
            self.active.fetch_sub(1, Ordering::SeqCst);
            result
        }

        fn game_running(&self) -> bool {
            self.game.load(Ordering::SeqCst)
        }
    }

    struct World {
        dir: tempfile::TempDir,
        engine: Arc<FakeEngine>,
        queue: AnalysisQueue,
        heard: Arc<Mutex<Vec<QueueSnapshot>>>,
    }

    impl World {
        fn new(script: Script) -> Self {
            let dir = tempfile::tempdir().unwrap();
            let engine = FakeEngine::new(script);
            let heard = Arc::new(Mutex::new(Vec::new()));
            let listener = heard.clone();
            let queue = AnalysisQueue::new(
                engine.clone(),
                dir.path().join("analyses"),
                move |snapshot: &QueueSnapshot| listener.lock().unwrap().push(snapshot.clone()),
            );
            World {
                dir,
                engine,
                queue,
                heard,
            }
        }

        fn analyses(&self) -> PathBuf {
            self.dir.path().join("analyses")
        }

        fn ask(&self, game_id: &str) -> Enqueued {
            self.queue.enqueue(job(game_id, false)).unwrap()
        }

        /// Wait for the queue to look some way, and hand back how it looked.
        fn until(&self, what: &str, done: impl Fn(&QueueSnapshot) -> bool) -> QueueSnapshot {
            let began = Instant::now();
            loop {
                let snapshot = self.queue.snapshot();
                if done(&snapshot) {
                    return snapshot;
                }
                assert!(
                    began.elapsed() < PATIENCE,
                    "never saw: {what}. The queue: {snapshot:?}"
                );
                std::thread::sleep(Duration::from_millis(5));
            }
        }

        /// Wait for the engine to have been started `runs` times and for the
        /// running job's first progress to have reached the listener, so
        /// nothing about the run is still on its way.
        fn until_playing(&self, runs: usize) -> QueueSnapshot {
            self.until("the engine to be playing", |s| {
                self.started() == runs
                    && s.running.as_ref().is_some_and(|r| r.frame == 90)
                    && self
                        .heard
                        .lock()
                        .unwrap()
                        .last()
                        .is_some_and(|last| last.running.as_ref().is_some_and(|r| r.frame == 90))
            })
        }

        fn until_idle(&self) -> QueueSnapshot {
            self.until("an idle queue", |s| {
                s.running.is_none() && s.queued.is_empty()
            })
        }

        fn started(&self) -> usize {
            self.engine.started.load(Ordering::SeqCst)
        }
    }

    fn job(game_id: &str, force: bool) -> JobSpec {
        JobSpec {
            replay: PathBuf::from(format!("/replays/{game_id}.sdfz")),
            engine_dir: PathBuf::from("/engines/1"),
            data_dirs: Vec::new(),
            game_id: game_id.into(),
            name: format!("{game_id}.sdfz"),
            match_seconds: 50,
            force,
        }
    }

    #[test]
    fn a_reproduced_run_is_stored_and_the_queue_says_the_store_changed() {
        let world = World::new(Script::Finish(AnalysisStatus::Reproduced));

        assert_eq!(world.ask(ID), Enqueued::Queued);
        let idle = world.until_idle();

        assert_eq!(world.started(), 1);
        assert_eq!(idle.stored, 1);
        assert!(idle.failures.is_empty());
        let stored = store::read(&world.analyses(), ID).unwrap().expect("stored");
        assert_eq!(stored.state, store::AnalysisState::Current);
        assert_eq!(stored.provenance.counts.unit_destroyed, 4);
        assert_eq!(
            store::read_events(&world.analyses(), ID, None, 0, None)
                .unwrap()
                .total,
            18
        );
    }

    #[test]
    fn a_diverged_run_is_remembered_and_is_not_a_failure() {
        let world = World::new(Script::Finish(AnalysisStatus::Diverged));

        world.ask(ID);
        let idle = world.until_idle();

        assert_eq!(idle.stored, 1);
        assert!(idle.failures.is_empty());
        let stored = store::read(&world.analyses(), ID).unwrap().expect("stored");
        assert_eq!(stored.state, store::AnalysisState::Diverged);
        assert_eq!(stored.provenance.disagreements.len(), 1);
    }

    /// The rule that stops an analysis being produced twice.
    #[test]
    fn a_match_with_a_current_analysis_is_not_run_again_unless_asked() {
        let world = World::new(Script::Finish(AnalysisStatus::Reproduced));
        world.ask(ID);
        world.until_idle();
        assert_eq!(world.started(), 1);

        assert_eq!(world.ask(ID), Enqueued::AlreadyAnalysed);
        world.until_idle();
        assert_eq!(world.started(), 1, "the engine ran a second time");

        // A person asking for a new analysis is the one way round it.
        assert_eq!(
            world.queue.enqueue(job(ID, true)).unwrap(),
            Enqueued::Queued
        );
        let idle = world.until("a second stored run", |s| s.stored == 2);
        assert_eq!(world.started(), 2);
        assert!(idle.failures.is_empty());
    }

    /// A diverged record does not stop a new run: the game may have been
    /// installed properly since. The page is what says how the last one went.
    #[test]
    fn a_diverged_match_can_be_asked_for_again() {
        let world = World::new(Script::Finish(AnalysisStatus::Diverged));
        world.ask(ID);
        world.until_idle();

        world.engine.set(Script::Finish(AnalysisStatus::Reproduced));
        assert_eq!(world.ask(ID), Enqueued::Queued);
        world.until("a second stored run", |s| s.stored == 2);

        assert!(store::is_current(&world.analyses(), ID));
    }

    #[test]
    fn jobs_run_one_at_a_time_and_in_the_order_they_were_asked_for() {
        let world = World::new(Script::UntilReleased);

        world.ask(ID);
        world.ask(OTHER);
        world.ask(THIRD);
        let busy = world.until("the first job running", |s| s.running.is_some());

        assert_eq!(busy.running.as_ref().unwrap().game_id, ID);
        let waiting: Vec<&str> = busy.queued.iter().map(|j| j.game_id.as_str()).collect();
        assert_eq!(waiting, vec![OTHER, THIRD]);
        // The same match twice is one job.
        assert_eq!(world.ask(OTHER), Enqueued::AlreadyQueued);
        assert_eq!(world.ask(ID), Enqueued::AlreadyQueued);
        assert_eq!(world.queue.snapshot().queued.len(), 2);

        world.engine.release.store(true, Ordering::SeqCst);
        let idle = world.until_idle();

        assert_eq!(idle.stored, 3);
        assert_eq!(world.started(), 3);
        assert_eq!(world.engine.most_at_once.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn progress_reaches_the_snapshot_and_the_listener() {
        let world = World::new(Script::UntilReleased);

        world.ask(ID);
        let playing = world.until("a frame", |s| {
            s.running.as_ref().is_some_and(|r| r.frame == 90)
        });

        let running = playing.running.unwrap();
        assert_eq!(running.phase, RunPhase::Playing);
        assert_eq!((running.frame, running.last_frame), (90, 1500));
        assert_eq!(running.match_seconds, 50);
        assert!(world
            .heard
            .lock()
            .unwrap()
            .iter()
            .any(|s| s.running.as_ref().is_some_and(|r| r.frame == 90)));

        world.engine.release.store(true, Ordering::SeqCst);
        world.until_idle();
        // The last thing every window heard is an empty queue.
        let heard = world.heard.lock().unwrap();
        let last = heard.last().unwrap();
        assert!(last.running.is_none() && last.queued.is_empty());
        assert_eq!(last.stored, 1);
    }

    #[test]
    fn cancelling_a_running_job_stores_nothing_and_leaves_no_failure() {
        let world = World::new(Script::UntilCancelled);
        world.ask(ID);
        world.ask(OTHER);
        let busy = world.until_playing(1);
        let id = busy.running.unwrap().id;
        world.engine.set(Script::Finish(AnalysisStatus::Reproduced));

        assert!(world.queue.cancel(id));
        let idle = world.until_idle();

        // The cancelled match has nothing stored and nothing said about it,
        // and the one behind it still ran.
        assert_eq!(store::read(&world.analyses(), ID).unwrap(), None);
        assert!(idle.failures.is_empty());
        assert!(store::is_current(&world.analyses(), OTHER));
        assert_eq!(idle.stored, 1);
        assert!(
            !world.queue.cancel(id),
            "a finished job is not there to cancel"
        );
    }

    #[test]
    fn cancelling_a_queued_job_takes_it_out_without_running_it() {
        let world = World::new(Script::UntilReleased);
        world.ask(ID);
        world.ask(OTHER);
        let busy = world.until("the first job running", |s| s.running.is_some());
        let queued = busy.queued[0].id;

        assert!(world.queue.cancel(queued));
        assert!(world.queue.snapshot().queued.is_empty());
        world.engine.release.store(true, Ordering::SeqCst);
        world.until_idle();

        assert_eq!(world.started(), 1);
        assert_eq!(store::read(&world.analyses(), OTHER).unwrap(), None);
    }

    #[test]
    fn cancelling_everything_empties_the_queue() {
        let world = World::new(Script::UntilCancelled);
        world.ask(ID);
        world.ask(OTHER);
        world.ask(THIRD);
        world.until_playing(1);

        world.queue.cancel_all();
        let idle = world.until_idle();

        assert_eq!(world.started(), 1);
        assert_eq!(idle.stored, 0);
        assert!(idle.failures.is_empty());
        assert!(store::list(&world.analyses()).is_empty());
    }

    /// A run that ran out of time is a failure that says so, and is not a
    /// divergence: it stores nothing.
    #[test]
    fn a_run_that_took_too_long_says_so_and_is_not_a_divergence() {
        let world = World::new(Script::TimeOut);

        world.ask(ID);
        let idle = world.until_idle();

        assert_eq!(idle.failures.len(), 1);
        let failure = &idle.failures[0];
        assert_eq!(failure.reason, FailureReason::TookTooLong);
        assert_eq!(failure.game_id, ID);
        assert_eq!(failure.limit_seconds, Some(run_timeout(50).as_secs()));
        assert_eq!(store::read(&world.analyses(), ID).unwrap(), None);
        assert_eq!(idle.stored, 0);
    }

    #[test]
    fn a_crashed_engine_is_a_failure_with_what_the_engine_said() {
        let world = World::new(Script::Crash);

        world.ask(ID);
        let idle = world.until_idle();

        let failure = &idle.failures[0];
        assert_eq!(failure.reason, FailureReason::EngineFailed);
        assert_eq!(
            failure.message,
            "the engine exited with status 3 before the replay logger loaded"
        );
        assert_eq!(failure.log_excerpt, vec!["GAME-section missing"]);
        assert_eq!(failure.limit_seconds, None);
        assert_eq!(store::read(&world.analyses(), ID).unwrap(), None);
    }

    #[test]
    fn a_failure_is_kept_until_it_is_dismissed_or_the_match_is_asked_for_again() {
        let world = World::new(Script::Refuse);
        world.ask(ID);
        world.ask(OTHER);
        let idle = world.until_idle();
        assert_eq!(idle.failures.len(), 2);
        assert_eq!(idle.failures[0].reason, FailureReason::CouldNotRun);
        assert_eq!(idle.failures[0].message, "no headless engine in /nowhere");

        world.queue.dismiss_failure(ID);
        assert_eq!(world.queue.snapshot().failures.len(), 1);

        world.engine.set(Script::Finish(AnalysisStatus::Reproduced));
        world.ask(OTHER);
        let idle = world.until("the second match stored", |s| s.stored == 1);
        assert!(idle.failures.is_empty());
    }

    /// An analysis does not start under a game somebody is playing.
    #[test]
    fn nothing_starts_while_a_game_is_running() {
        let world = World::new(Script::Finish(AnalysisStatus::Reproduced));
        world.engine.game.store(true, Ordering::SeqCst);

        world.ask(ID);
        // Until every window has been told, not only until it is so.
        let waiting = world.until("the queue to say it is waiting", |s| {
            s.waiting_for_game
                && world
                    .heard
                    .lock()
                    .unwrap()
                    .last()
                    .is_some_and(|last| last.waiting_for_game)
        });

        assert!(waiting.running.is_none());
        assert_eq!(waiting.queued.len(), 1);
        assert_eq!(world.started(), 0);

        world.engine.game.store(false, Ordering::SeqCst);
        let idle = world.until_idle();

        assert_eq!(world.started(), 1);
        assert_eq!(idle.stored, 1);
        assert!(!idle.waiting_for_game);
    }

    /// A game that starts under a running analysis stops it, and the analysis
    /// goes back to the front and runs again once the game is over.
    #[test]
    fn a_game_starting_stops_the_running_job_and_it_runs_again_afterwards() {
        let world = World::new(Script::UntilCancelled);
        world.ask(ID);
        world.ask(OTHER);
        world.until_playing(1);

        world.engine.game.store(true, Ordering::SeqCst);
        let waiting = world.until("the job put back", |s| {
            s.running.is_none() && s.waiting_for_game
        });

        let order: Vec<&str> = waiting.queued.iter().map(|j| j.game_id.as_str()).collect();
        assert_eq!(order, vec![ID, OTHER]);
        assert!(waiting.failures.is_empty());
        assert_eq!(world.started(), 1);
        assert!(store::list(&world.analyses()).is_empty());

        world.engine.set(Script::Finish(AnalysisStatus::Reproduced));
        world.engine.game.store(false, Ordering::SeqCst);
        let idle = world.until_idle();

        assert_eq!(idle.stored, 2);
        assert_eq!(world.started(), 3);
        assert_eq!(world.engine.most_at_once.load(Ordering::SeqCst), 1);
    }

    /// A cancel that lands while the job is standing aside for a game is
    /// still a cancel. The job does not come back.
    #[test]
    fn a_cancel_outranks_standing_aside_for_a_game() {
        let world = World::new(Script::UntilCancelled);
        world.ask(ID);
        let busy = world.until("the job running", |s| s.running.is_some());

        assert!(world.queue.cancel(busy.running.unwrap().id));
        world.engine.game.store(true, Ordering::SeqCst);
        let idle = world.until_idle();

        assert!(idle.queued.is_empty());
        assert_eq!(world.started(), 1);
    }

    /// The app on its way out: the running job is stopped before `shutdown`
    /// returns, nothing behind it starts, and nothing is stored.
    #[test]
    fn shutting_down_stops_the_running_job_and_starts_nothing_else() {
        let world = World::new(Script::UntilCancelled);
        world.ask(ID);
        world.ask(OTHER);
        world.until_playing(1);
        let heard_before = world.heard.lock().unwrap().len();

        world.queue.shutdown();

        let after = world.queue.snapshot();
        assert!(after.running.is_none(), "{after:?}");
        assert!(after.queued.is_empty());
        assert_eq!(world.engine.active.load(Ordering::SeqCst), 0);
        assert_eq!(world.started(), 1);
        assert!(store::list(&world.analyses()).is_empty());
        // Nothing reaches a window that is being torn down.
        assert_eq!(world.heard.lock().unwrap().len(), heard_before);
        assert!(world.queue.enqueue(job(THIRD, false)).is_err());
    }

    #[test]
    fn a_scratch_folder_left_by_a_dead_process_is_swept_and_a_live_ones_is_kept() {
        let dir = tempfile::tempdir().unwrap();
        // A process that has exited and been waited on, so its id names
        // nothing.
        let mut gone = coilbox_proc::command(std::env::current_exe().unwrap())
            .arg("--list")
            .stdout(std::process::Stdio::null())
            .spawn()
            .unwrap();
        let dead = gone.id();
        gone.wait().unwrap();
        let ours = std::process::id();
        for name in [
            format!("run-{dead}-0"),
            format!("run-{ours}-0"),
            "something-else".to_string(),
        ] {
            std::fs::create_dir_all(dir.path().join(name).join("write")).unwrap();
        }

        sweep_scratch(dir.path());

        assert!(!dir.path().join(format!("run-{dead}-0")).exists());
        assert!(dir.path().join(format!("run-{ours}-0")).is_dir());
        assert!(dir.path().join("something-else").is_dir());
    }

    /// The id of a process that has exited and been waited on, so it names
    /// nothing.
    fn dead_pid() -> u32 {
        let mut gone = coilbox_proc::command(std::env::current_exe().unwrap())
            .arg("--list")
            .stdout(std::process::Stdio::null())
            .spawn()
            .unwrap();
        let dead = gone.id();
        gone.wait().unwrap();
        dead
    }

    /// A long running stand in for the engine that has `scratch` in its
    /// arguments and records itself the way a real run does.
    fn stand_in_engine(scratch: &Path) -> std::process::Child {
        std::fs::create_dir_all(scratch).unwrap();
        let child = std::process::Command::new("/bin/sh")
            .args(["-c", "while :; do sleep 1; done", "stand-in"])
            .arg(scratch)
            // Its `sleep` outlives the shell when that is killed, and would
            // hold the test runner's output open.
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .spawn()
            .unwrap();
        std::fs::write(
            scratch.join(super::super::launch::PID_FILE),
            format!("{}\n/bin/sh\n", child.id()),
        )
        .unwrap();
        child
    }

    /// The coilbox that started the engine is gone and the engine is not. The
    /// sweep kills it and removes its folder.
    #[cfg(unix)]
    #[test]
    fn the_sweep_kills_an_engine_left_by_a_dead_coilbox_and_removes_its_folder() {
        let dir = tempfile::tempdir().unwrap();
        let scratch = dir.path().join(format!("run-{}-0", dead_pid()));
        let mut engine = stand_in_engine(&scratch);
        assert!(engine.try_wait().unwrap().is_none());

        assert_eq!(sweep_scratch(dir.path()), 1);

        let status = engine.wait().unwrap();
        assert!(!status.success(), "the engine was killed: {status:?}");
        assert!(!scratch.exists());
    }

    /// A pid in a pid file that now belongs to something else, such as a game
    /// the player is running, is not signalled.
    #[cfg(unix)]
    #[test]
    fn the_sweep_leaves_a_process_that_is_not_that_runs_engine() {
        let dir = tempfile::tempdir().unwrap();
        let scratch = dir.path().join(format!("run-{}-0", dead_pid()));
        // Same binary, same pid in the file, a different folder in its arguments.
        let elsewhere = dir.path().join("somebody-elses-game");
        let mut bystander = stand_in_engine(&elsewhere);
        std::fs::create_dir_all(&scratch).unwrap();
        std::fs::write(
            scratch.join(super::super::launch::PID_FILE),
            format!("{}\n/bin/sh\n", bystander.id()),
        )
        .unwrap();

        assert_eq!(sweep_scratch(dir.path()), 0);

        assert!(bystander.try_wait().unwrap().is_none(), "left running");
        assert!(!scratch.exists(), "the folder is still removed");
        bystander.kill().unwrap();
        bystander.wait().unwrap();
    }

    /// A live coilbox's engine is never touched, whatever its folder holds.
    #[cfg(unix)]
    #[test]
    fn the_sweep_leaves_the_engine_of_a_live_coilbox() {
        let dir = tempfile::tempdir().unwrap();
        let scratch = dir.path().join(format!("run-{}-0", std::process::id()));
        let mut engine = stand_in_engine(&scratch);

        assert_eq!(sweep_scratch(dir.path()), 0);

        assert!(engine.try_wait().unwrap().is_none());
        assert!(scratch.is_dir());
        engine.kill().unwrap();
        engine.wait().unwrap();
    }

    /// The case #3863 is about, with the real run code: a process runs an
    /// engine and is killed with SIGKILL, so nothing of its own runs. Where the
    /// kernel can kill the engine with it (Linux) the engine goes. Elsewhere
    /// it carries on, and the next sweep kills it.
    #[cfg(unix)]
    #[test]
    fn a_coilbox_killed_outright_leaves_its_engine_for_the_next_sweep() {
        let root = tempfile::tempdir().unwrap();
        let mut coilbox = std::process::Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "demo::analysis::launch::tests::the_coilbox_that_gets_killed",
                "--ignored",
            ])
            .env("COILBOX_KILLED_RUN_ROOT", root.path())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .spawn()
            .unwrap();
        let scratch = root.path().join(format!("run-{}-0", coilbox.id()));
        let pid_file = scratch.join(super::super::launch::PID_FILE);
        let until = |what: &str, done: &dyn Fn() -> bool| {
            let began = Instant::now();
            while !done() {
                assert!(began.elapsed() < PATIENCE, "{what}");
                std::thread::sleep(Duration::from_millis(20));
            }
        };
        until("the run never recorded its engine", &|| {
            std::fs::read_to_string(&pid_file).is_ok_and(|r| r.ends_with('\n'))
        });
        let engine: u32 = std::fs::read_to_string(&pid_file)
            .unwrap()
            .lines()
            .next()
            .unwrap()
            .parse()
            .unwrap();
        assert!(coilbox_proc::is_running(engine));

        coilbox.kill().unwrap();
        coilbox.wait().unwrap();

        if cfg!(target_os = "linux") {
            until("the kernel did not kill the engine", &|| {
                !coilbox_proc::is_running(engine)
            });
        } else {
            // Give a signal that is not coming time to arrive.
            std::thread::sleep(Duration::from_millis(500));
            assert!(
                coilbox_proc::is_running(engine),
                "the engine should outlive its killed coilbox here"
            );
            assert_eq!(sweep_scratch(root.path()), 1);
            until("the sweep did not end the engine", &|| {
                !coilbox_proc::is_running(engine)
            });
            assert!(!scratch.exists());
        }
    }

    /// Changes are announced from the worker and from whoever asked, at once.
    /// The last snapshot a listener holds has to be the newest, or a page is
    /// left showing a job that has finished.
    #[test]
    fn the_last_snapshot_a_listener_hears_is_how_the_queue_is() {
        for _ in 0..20 {
            let world = World::new(Script::Finish(AnalysisStatus::Reproduced));
            world.ask(ID);
            world.ask(OTHER);
            world.ask(THIRD);
            let idle = world.until("everything stored", |s| {
                s.stored == 3 && s.running.is_none() && s.queued.is_empty()
            });
            // The worker's last act is an announcement. Wait for it.
            let began = Instant::now();
            while world.queue.0.lock().working {
                assert!(began.elapsed() < PATIENCE);
                std::thread::sleep(Duration::from_millis(1));
            }
            let _settled = world.queue.0.announcing.lock().unwrap();

            assert_eq!(world.heard.lock().unwrap().last(), Some(&idle));
        }
    }

    #[test]
    fn the_snapshot_is_camel_case_json() {
        let world = World::new(Script::TimeOut);
        world.ask(ID);
        let idle = world.until_idle();
        let json = serde_json::to_value(&idle).unwrap();

        assert_eq!(json["waitingForGame"], false);
        assert_eq!(json["failures"][0]["reason"], "tookTooLong");
        assert_eq!(json["failures"][0]["gameId"], ID);
        assert!(json["failures"][0]["limitSeconds"].is_u64());
        assert_eq!(
            serde_json::to_value(Enqueued::AlreadyAnalysed).unwrap(),
            "alreadyAnalysed"
        );
    }

    /// Counts the runs the real engine is asked for.
    struct Counted {
        engine: HeadlessEngine,
        runs: Arc<AtomicUsize>,
    }

    impl Engine for Counted {
        fn run(
            &self,
            job: &JobSpec,
            control: &RunControl,
            on_poll: &dyn Fn(RunProgress),
        ) -> Result<AnalysisRun, String> {
            self.runs.fetch_add(1, Ordering::SeqCst);
            self.engine.run(job, control, on_poll)
        }

        fn game_running(&self) -> bool {
            false
        }
    }

    /// The whole route against a real engine, a real game and a real replay:
    /// queue, run, progress, store, read back, refuse a second run, delete.
    ///
    /// Reads what to run from the environment and does nothing without it:
    ///
    /// - `COILBOX_ANALYSIS_REPLAY`: the replay.
    /// - `COILBOX_ANALYSIS_ENGINE_DIR`: the folder of the engine it was
    ///   recorded with.
    /// - `COILBOX_ANALYSIS_DATA_DIRS`: the content folders holding its game and
    ///   map, separated the way `SPRING_DATADIR` is. Scratch folders, never a
    ///   player's own.
    ///
    /// The store and the scratch folders are in a temporary directory. The
    /// time limit is the one the app uses.
    #[test]
    #[ignore = "needs an engine, a game, a map and a replay recorded with them"]
    fn a_real_replay_goes_through_the_queue_into_the_store_and_out_again() {
        let var = |name: &str| std::env::var(name).ok().filter(|v| !v.is_empty());
        let (Some(replay), Some(engine_dir), Some(data_dirs)) = (
            var("COILBOX_ANALYSIS_REPLAY"),
            var("COILBOX_ANALYSIS_ENGINE_DIR"),
            var("COILBOX_ANALYSIS_DATA_DIRS"),
        ) else {
            eprintln!(
                "did nothing: set COILBOX_ANALYSIS_REPLAY, COILBOX_ANALYSIS_ENGINE_DIR and \
                 COILBOX_ANALYSIS_DATA_DIRS to run it"
            );
            return;
        };
        let replay = PathBuf::from(replay);
        let data_dirs: Vec<PathBuf> = data_dirs
            .split(coilbox_proc::DATADIR_SEP)
            .map(PathBuf::from)
            .collect();
        let dir = tempfile::tempdir().unwrap();
        let analyses = dir.path().join("analyses");
        let scratch_root = dir.path().join("scratch");
        let runs = Arc::new(AtomicUsize::new(0));
        let heard = Arc::new(Mutex::new(Vec::<QueueSnapshot>::new()));
        let listener = heard.clone();
        let queue = AnalysisQueue::new(
            Counted {
                engine: HeadlessEngine {
                    scratch_root: scratch_root.clone(),
                },
                runs: runs.clone(),
            },
            analyses.clone(),
            move |snapshot: &QueueSnapshot| listener.lock().unwrap().push(snapshot.clone()),
        );
        let spec = job_for(&replay, Path::new(&engine_dir), data_dirs.clone(), false)
            .expect("a replay that can be analysed");
        let game_id = store::replay_key(&replay).unwrap();
        let limit = run_timeout(spec.match_seconds);
        let wait_idle = |what: &str| {
            let began = Instant::now();
            loop {
                let snapshot = queue.snapshot();
                if snapshot.running.is_none() && snapshot.queued.is_empty() {
                    return snapshot;
                }
                assert!(began.elapsed() < limit + PATIENCE, "{what} never finished");
                std::thread::sleep(Duration::from_millis(50));
            }
        };

        let began = Instant::now();
        assert_eq!(queue.enqueue(spec.clone()).unwrap(), Enqueued::Queued);
        let idle = wait_idle("the run");
        let wall = began.elapsed();

        assert_eq!(idle.failures, Vec::new(), "the run failed");
        assert_eq!(idle.stored, 1);
        assert_eq!(runs.load(Ordering::SeqCst), 1);

        // Progress: frames that only go forward, and reach the match.
        let frames: Vec<i32> = heard
            .lock()
            .unwrap()
            .iter()
            .filter_map(|s| s.running.as_ref())
            .filter(|r| r.phase == RunPhase::Playing)
            .map(|r| r.frame)
            .collect();
        let mut steps = frames.clone();
        steps.dedup();
        assert!(steps.len() > 1, "progress never moved: {steps:?}");
        assert!(
            steps.windows(2).all(|w| w[0] < w[1]),
            "progress went backwards"
        );
        let last_frame = spec.match_seconds as i32 * divergence::FRAMES_PER_SECOND;

        // The store: one file, with the right provenance and every event.
        let stored = store::read(&analyses, &game_id).unwrap().expect("stored");
        let p = &stored.provenance;
        assert_eq!(stored.state, store::AnalysisState::Current);
        assert_eq!(p.outcome, store::StoredOutcome::Reproduced);
        assert_eq!(p.game_id, game_id);
        assert_eq!(p.logger_version, super::super::log::LOGGER_VERSION);
        assert_eq!(p.logger_format, super::super::log::FORMAT_VERSION);
        assert_eq!(p.match_seconds, spec.match_seconds);
        assert!(!p.engine.is_empty() && !p.game.is_empty() && !p.map.is_empty());
        assert!(p.disagreements.is_empty());
        assert!(p.wall_seconds > 0.0);
        assert_eq!((p.counts.header, p.counts.game_over), (1, 1));
        assert!(p.counts.unit_created > 0 && p.counts.unit_destroyed > 0);
        let lines = p.counts.header
            + p.counts.game_start
            + p.counts.unit_created
            + p.counts.unit_finished
            + p.counts.unit_destroyed
            + p.counts.game_over
            + p.counts.unknown;
        let all = store::read_events(&analyses, &game_id, None, 0, None).unwrap();
        assert_eq!((all.total, all.events.len()), (lines, lines));
        let destroyed = store::read_events(
            &analyses,
            &game_id,
            Some(&["unit_destroyed".to_string()]),
            0,
            None,
        )
        .unwrap();
        assert_eq!(destroyed.total, p.counts.unit_destroyed);
        assert!(destroyed
            .events
            .iter()
            .all(|e| e["x"].is_number() && e["def"].is_number()));
        let raw_bytes: usize = all
            .events
            .iter()
            .map(|e| serde_json::to_string(e).unwrap().len() + 1)
            .sum();
        assert_eq!(store::list(&analyses).len(), 1);

        // Never twice.
        assert_eq!(
            queue.enqueue(spec.clone()).unwrap(),
            Enqueued::AlreadyAnalysed
        );
        wait_idle("the second ask");
        assert_eq!(
            runs.load(Ordering::SeqCst),
            1,
            "the engine ran a second time"
        );

        // Nothing left in scratch, and the replay's folders were not written.
        let leftovers: Vec<_> = std::fs::read_dir(&scratch_root)
            .map(|entries| entries.flatten().map(|e| e.file_name()).collect())
            .unwrap_or_default();
        assert_eq!(leftovers, Vec::<std::ffi::OsString>::new());

        eprintln!(
            "match {}s, wall {:.1}s (engine {:.1}s), limit {}s\n\
             events: {} lines ({} created, {} finished, {} destroyed)\n\
             progress: {} steps, last frame seen {} of {}\n\
             stored: {} bytes on disk, {} bytes of JSON lines\n\
             engine: {}\ngame: {}\nmap: {}",
            spec.match_seconds,
            wall.as_secs_f64(),
            p.wall_seconds,
            limit.as_secs(),
            lines,
            p.counts.unit_created,
            p.counts.unit_finished,
            p.counts.unit_destroyed,
            steps.len(),
            steps.last().unwrap(),
            last_frame,
            stored.size_bytes,
            raw_bytes,
            p.engine,
            p.game,
            p.map,
        );

        // Deleting it removes the file.
        assert_eq!(store::delete(&analyses, &game_id), Ok(true));
        assert_eq!(store::read(&analyses, &game_id).unwrap(), None);
        assert_eq!(std::fs::read_dir(&analyses).unwrap().count(), 0);
    }

    #[cfg(unix)]
    mod job_for {
        use super::super::super::super::tests::DemoFixture;
        use super::super::super::divergence::tests::fixture_trailer;
        use super::super::super::launch::tests::fake_engine;
        use super::super::*;

        const SCRIPT: &str = "[game]\n{\ngametype=Some Game 1.0;\nmapname=Some Map;\n}\n";

        fn finished() -> DemoFixture {
            DemoFixture {
                script: SCRIPT.into(),
                winning_ally_teams: vec![0],
                team_samples: fixture_trailer()
                    .teams
                    .into_iter()
                    .map(|t| t.samples)
                    .collect(),
                game_time: 50,
                ..Default::default()
            }
        }

        fn world(replay: Vec<u8>) -> (tempfile::TempDir, PathBuf, PathBuf) {
            let dir = tempfile::tempdir().unwrap();
            let path = dir.path().join("match.sdfz");
            std::fs::write(&path, replay).unwrap();
            fake_engine(dir.path(), "exit 0");
            let engine_dir = dir.path().join("engine");
            (dir, path, engine_dir)
        }

        #[test]
        fn a_finished_replay_becomes_a_job_keyed_by_its_game_id() {
            let (_dir, replay, engine) = world(finished().gzipped());

            let spec = job_for(&replay, &engine, vec![PathBuf::from("/content")], false).unwrap();

            assert_eq!(spec.game_id, super::ID);
            assert_eq!(spec.name, "match.sdfz");
            assert_eq!(spec.match_seconds, 50);
            assert!(!spec.force);
        }

        #[test]
        fn a_replay_that_cannot_be_analysed_is_refused_with_the_reason() {
            let unfinished = DemoFixture {
                script: SCRIPT.into(),
                ..Default::default()
            };
            let (_dir, replay, engine) = world(unfinished.gzipped());
            let err = job_for(&replay, &engine, Vec::new(), false).unwrap_err();
            assert!(err.contains("never recorded a game over"), "{err}");

            let no_id = DemoFixture {
                game_id: [0; 16],
                ..finished()
            };
            let (_dir, replay, engine) = world(no_id.gzipped());
            let err = job_for(&replay, &engine, Vec::new(), false).unwrap_err();
            assert!(err.contains("no game id"), "{err}");

            let (dir, replay, engine) = world(finished().gzipped());
            let remix =
                super::super::super::super::rewrite_demo(&replay, "Other Game", None).unwrap();
            let err = job_for(&remix, &engine, Vec::new(), false).unwrap_err();
            assert!(err.contains("remix"), "{err}");

            let err =
                job_for(&replay, &dir.path().join("no-engine"), Vec::new(), false).unwrap_err();
            assert!(err.contains("no headless engine"), "{err}");

            let junk = dir.path().join("junk.sdfz");
            std::fs::write(&junk, b"not a replay").unwrap();
            assert_eq!(check_replay(&junk), Err(CannotAnalyse::Unreadable));
            assert_eq!(check_replay(&remix), Err(CannotAnalyse::Remix));
            assert_eq!(check_replay(&replay), Ok((super::ID.to_string(), 50)));
            assert_eq!(
                serde_json::to_value(CannotAnalyse::NoGameOver).unwrap(),
                "noGameOver"
            );
        }
    }
}
