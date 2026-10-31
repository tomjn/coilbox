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
//! - Every job also records the match as a track (issues #3785 and #3962), so
//!   one run of the engine makes the analysis and the track. The logger's
//!   figures are what decides whether the run played the match that was
//!   recorded, and the rewind recorder rides in the same run. After the engine
//!   exits a run that reproduced the match has its dump thinned into a track,
//!   as a stage of its own that can be cancelled. The dump is deleted however
//!   the run ended.
//! - A match with a current analysis and a current track is not run again
//!   unless the job says to. One with only one of the two is run for both.
//! - A job can instead ask only for the engine's unit list (issue #3906). The
//!   engine is stopped as soon as the list is written, nothing is analysed or
//!   recorded, and the list is kept as an analysis's is. It queues, yields to a
//!   game and cancels like any other job.
//!
//! This is separate from the play launch's `RunRegistry` on purpose. That one
//! refuses a second game. This one queues.

use std::collections::{HashSet, VecDeque};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Condvar, Mutex, MutexGuard};
use std::time::{Duration, Instant};

use picoframe_core::CliResult;
use serde::Serialize;
use serde_json::json;
use tauri::{AppHandle, Emitter, Manager, Runtime, State};

use coilbox_track_thin::{thin_dump_cancellable, ThinError, ThinOptions, ThinReport};

use super::super::def_sets;
use super::super::recording_costs;
use super::super::track_budget;
use super::super::track_store;
use super::launch::RunControl;
use super::RecordingOutcome;
use super::{
    analyse_replay, divergence, now_ms, read_unit_list, run_timeout, store, AnalysisRequest,
    AnalysisRun, AnalysisStatus, RunPhase, RunProgress, UnitListRun, SCRATCH_DIR,
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
/// The folder under the app's cache directory that a recorder's dump waits in
/// until it has been thinned.
const RECORDINGS_DIR: &str = "replay-recording";

const EXIT_TIDY_WAIT: Duration = Duration::from_secs(2);

/// What a job asks of the engine.
#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum JobKind {
    /// Play the match back, analyse it and record it as a track.
    Analyse,
    /// Start the match, keep the engine's own unit list and stop the engine
    /// (issue #3906). It needs no recorded outcome, and it plays no match.
    UnitList,
}

/// One replay to analyse and record, or to read the unit list of.
#[derive(Clone, Debug)]
pub struct JobSpec {
    pub kind: JobKind,
    pub replay: PathBuf,
    pub engine_dir: PathBuf,
    pub data_dirs: Vec<PathBuf>,
    /// Another installed version of the replay's game to depend on, when the
    /// exact one is not installed.
    pub game: Option<String>,
    /// The key the result is stored under. See [`store::replay_key`].
    pub game_id: String,
    /// The replay's file name, for a list to show.
    pub name: String,
    pub match_seconds: u32,
    /// Run even though a current analysis and track are stored. Only a person
    /// asking for new ones sets it.
    pub force: bool,
}

/// What runs the engine, and what knows whether a game is being played. A seam
/// so the queue's rules can be tested with neither.
pub trait Engine: Send + Sync + 'static {
    /// `record_to` is where the recorder's dump is to be left, and the queue
    /// deletes it afterwards.
    fn run(
        &self,
        job: &JobSpec,
        record_to: &Path,
        control: &RunControl,
        on_poll: &dyn Fn(RunProgress),
    ) -> Result<AnalysisRun, String>;

    /// Start the match, keep the engine's unit list and stop. See
    /// [`read_unit_list`]. An engine that cannot do this says so.
    fn list(
        &self,
        _job: &JobSpec,
        _control: &RunControl,
        _on_poll: &dyn Fn(RunProgress),
    ) -> Result<UnitListRun, String> {
        Err("this engine cannot read a unit list".into())
    }

    /// Thin a dump into a track. Blocks for as long as that takes, and gives up
    /// with [`ThinError::Cancelled`] soon after `cancelled` answers true.
    fn thin(
        &self,
        dump: &Path,
        track: &Path,
        options: &ThinOptions,
        cancelled: &dyn Fn() -> bool,
    ) -> Result<ThinReport, ThinError> {
        thin_dump_cancellable(dump, track, options, cancelled)
    }

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
        record_to: &Path,
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
                game: job.game.clone(),
                game_short_name: None,
                scratch_root: self.scratch_root.clone(),
                timeout: run_timeout(job.match_seconds),
                record: Some(record_to.to_path_buf()),
            },
            control,
            on_poll,
        )
    }

    fn list(
        &self,
        job: &JobSpec,
        control: &RunControl,
        on_poll: &dyn Fn(RunProgress),
    ) -> Result<UnitListRun, String> {
        sweep_scratch(&self.scratch_root);
        read_unit_list(
            &AnalysisRequest {
                replay: job.replay.clone(),
                engine_dir: job.engine_dir.clone(),
                data_dirs: job.data_dirs.clone(),
                game: job.game.clone(),
                game_short_name: None,
                scratch_root: self.scratch_root.clone(),
                // The analysis run's own limit, until a measured load time
                // says a shorter one is safe.
                timeout: run_timeout(job.match_seconds),
                record: None,
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
    /// A run that reads only the unit list did not get one. The message says
    /// whether the engine ran out of time or stopped first.
    ListFailed,
    /// The playback was good and its recording could not be made into a track.
    ThinFailed,
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
    pub kind: JobKind,
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
    pub kind: JobKind,
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
    /// The same for the tracks, so a listener knows to ask for them again.
    pub tracks: u64,
}

/// What asking for a replay to be analysed and recorded came to.
#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum Enqueued {
    Queued,
    /// That match is already queued or running.
    AlreadyQueued,
    /// That match has a current analysis and a current track, and the job did
    /// not ask for new ones. Nothing was queued.
    AlreadyDone,
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
    tracks: u64,
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
                kind: running.job.spec.kind,
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
                    kind: job.spec.kind,
                    game_id: job.spec.game_id.clone(),
                    name: job.spec.name.clone(),
                    replay_path: job.spec.replay.to_string_lossy().into_owned(),
                })
                .collect(),
            waiting_for_game: self.waiting_for_game,
            failures: self.failures.clone(),
            stored: self.stored,
            tracks: self.tracks,
        }
    }

    /// Whether a job for this match is already waiting or running.
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
    /// Where tracks are stored. See [`track_store`].
    tracks: PathBuf,
    /// Where a recorder's dump is left until it has been thinned. Outside a
    /// run's scratch folder, which is deleted before the dump is read.
    recordings: PathBuf,
    /// How many bytes tracks may use, asked for each time a track is stored so
    /// a change in settings takes effect on the next recording.
    track_budget: Box<dyn Fn() -> u64 + Send + Sync>,
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
    /// Whether there is nothing for this job to do: the analysis and the
    /// track are both current. A match with only one of them is run again,
    /// because one run makes both.
    fn is_current(&self, spec: &JobSpec) -> bool {
        if spec.kind == JobKind::UnitList {
            return self.has_engine_list(&spec.game_id);
        }
        store::is_current(&self.analyses, &spec.game_id)
            && track_store::state(&self.tracks, &spec.game_id)
                .is_ok_and(|state| state == Some(track_store::TrackState::Current))
    }

    /// Whether a unit list run has nothing to do: the replay has an engine list
    /// already, or a reproduced analysis whose events a new list could renumber
    /// (issue #3906). A diverged analysis keeps no events, so it does not count.
    fn has_engine_list(&self, game_id: &str) -> bool {
        let reproduced = matches!(
            store::read(&self.analyses, game_id),
            Ok(Some(stored)) if stored.provenance.outcome == store::StoredOutcome::Reproduced
        );
        reproduced
            || def_sets::links_for(&def_sets::dir_beside(&self.analyses), game_id)
                .is_ok_and(|links| links.iter().any(|l| l.origin == def_sets::Origin::Engine))
    }

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
        tracks: PathBuf,
        recordings: PathBuf,
        track_budget: impl Fn() -> u64 + Send + Sync + 'static,
        listener: impl Fn(&QueueSnapshot) + Send + Sync + 'static,
    ) -> Self {
        AnalysisQueue(Arc::new(Shared {
            engine: Box::new(engine),
            analyses,
            tracks,
            recordings,
            track_budget: Box::new(track_budget),
            listener: Box::new(listener),
            announcing: Mutex::new(()),
            state: Mutex::new(QueueState::default()),
            changed: Condvar::new(),
        }))
    }

    pub fn snapshot(&self) -> QueueSnapshot {
        self.0.lock().snapshot()
    }

    /// Ask for a replay to be analysed and recorded.
    pub fn enqueue(&self, spec: JobSpec) -> Result<Enqueued, String> {
        // Looked up before the lock is taken: it reads a file.
        let current = !spec.force && self.0.is_current(&spec);
        {
            let mut state = self.0.lock();
            if state.closed {
                return Err("coilbox is closing".into());
            }
            if state.holds(&spec.game_id) {
                return Ok(Enqueued::AlreadyQueued);
            }
            if current {
                return Ok(Enqueued::AlreadyDone);
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

    /// What the engine of a running job has said most recently, or `None` when
    /// that job is not the one running.
    pub fn engine_output(&self, id: u64) -> Option<Vec<String>> {
        let control = self
            .0
            .lock()
            .running
            .as_ref()
            .filter(|running| running.job.id == id)
            .map(|running| running.control.clone())?;
        Some(control.output_tail())
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
    Outcome::Failed(make_failure(job, reason, message, run))
}

fn make_failure(
    job: &JobSpec,
    reason: FailureReason,
    message: String,
    run: Option<&AnalysisRun>,
) -> Failure {
    Failure {
        game_id: job.game_id.clone(),
        name: job.name.clone(),
        reason,
        message,
        limit_seconds: (reason == FailureReason::TookTooLong)
            .then(|| run_timeout(job.match_seconds).as_secs()),
        log_excerpt: run
            .map(|run| run.report.log_excerpt.clone())
            .unwrap_or_default(),
    }
}

/// Make the unit definition store agree with the analysis just stored.
///
/// A run that reproduced the match wrote the engine's own list of unit
/// definitions, which is the numbering every `def` in its events uses. That
/// list is kept and linked to the replay. A run that left no whole list, which
/// includes every run that diverged, leaves the replay with no engine list,
/// because the one from an earlier run no longer describes the stored file.
///
/// Failing here loses names and not the analysis, so it is logged and the run
/// still counts as stored.
fn keep_engine_unit_defs(
    analyses: &Path,
    provenance: &store::Provenance,
    events: Option<&[String]>,
) {
    let dir = def_sets::dir_beside(analyses);
    let result = match events.and_then(super::log::unit_defs_of_raw) {
        Some(units) => def_sets::record(
            &dir,
            &provenance.game_id,
            &units,
            &def_sets::Source {
                origin: def_sets::Origin::Engine,
                game: &provenance.game,
                game_differs: provenance.game_differs,
                taken_at_ms: provenance.analysed_at_ms,
                list_version: 0,
            },
        )
        .map(|_| ()),
        None => def_sets::unlink_engine(&dir, &provenance.game_id).map(|_| ()),
    };
    if let Err(e) = result {
        eprintln!("replay analysis: the engine's unit definitions were not kept: {e}");
    }
}

/// Work out what a run came to, storing it when it is one of the two outcomes
/// that are stored.
fn settle(
    analyses: &Path,
    job: &JobSpec,
    result: &Result<AnalysisRun, String>,
    preempted: bool,
) -> Outcome {
    let run = match result {
        Ok(run) => run,
        Err(e) => return failure(job, FailureReason::CouldNotRun, e.clone(), None),
    };
    if let Some(provenance) = store::Provenance::of(&job.game_id, run, now_ms()) {
        return match store::write(analyses, &provenance, run.events.as_deref()) {
            Ok(_) => {
                keep_engine_unit_defs(analyses, &provenance, run.events.as_deref());
                Outcome::Stored
            }
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
            Some(run),
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
        Some(run),
    )
}

/// Work out what a unit list run came to, keeping the list when it got one.
///
/// The list is kept as an analysis's is: as the engine's own, linked to the
/// replay, with whether the run used a game other than the recorded one (see
/// [`keep_engine_unit_defs`]). A run that was stopped for a game starting goes
/// back in the queue, and one that was cancelled keeps nothing.
fn settle_list(
    analyses: &Path,
    job: &JobSpec,
    result: &Result<UnitListRun, String>,
    preempted: bool,
) -> Outcome {
    let failed = |message: String, log_excerpt: Vec<String>| {
        Outcome::Failed(Failure {
            game_id: job.game_id.clone(),
            name: job.name.clone(),
            reason: FailureReason::ListFailed,
            message,
            limit_seconds: None,
            log_excerpt,
        })
    };
    let run = match result {
        Ok(run) => run,
        Err(e) => return failed(e.clone(), Vec::new()),
    };
    if let Some(units) = &run.units {
        let game_differs =
            (!run.recorded_game.is_empty()).then(|| run.base_game != run.recorded_game);
        return match def_sets::record(
            &def_sets::dir_beside(analyses),
            &job.game_id,
            units,
            &def_sets::Source {
                origin: def_sets::Origin::Engine,
                game: &run.base_game,
                game_differs,
                taken_at_ms: now_ms(),
                list_version: 0,
            },
        ) {
            Ok(_) => Outcome::Stored,
            Err(e) => failed(e, Vec::new()),
        };
    }
    let exit = &run.exit;
    if exit.cancelled {
        return if preempted {
            Outcome::Requeue
        } else {
            Outcome::Nothing
        };
    }
    let how = if exit.timed_out {
        format!(
            "the engine had not written the unit list after {} seconds",
            run_timeout(job.match_seconds).as_secs()
        )
    } else {
        match (exit.code, exit.signal) {
            (Some(code), _) => {
                format!("the engine exited with status {code} before it wrote the unit list")
            }
            (None, Some(signal)) => {
                format!("the engine was ended by signal {signal} before it wrote the unit list")
            }
            (None, None) => "the engine stopped before it wrote the unit list".to_string(),
        }
    };
    failed(how, run.log_excerpt.clone())
}

/// Run a unit list job: the engine is started, the list is kept and the engine
/// is stopped. Never twice, as for an analysis: the replay may have been given
/// a list since the job was queued.
fn unit_list_job(shared: &Shared, job_id: u64, spec: &JobSpec, control: &RunControl) -> Outcome {
    if shared.is_current(spec) {
        return Outcome::Nothing;
    }
    let result = shared.engine.list(spec, control, &|progress| {
        on_poll(shared, job_id, control, progress)
    });
    let preempted = shared
        .lock()
        .running
        .as_ref()
        .is_some_and(|running| running.preempted);
    settle_list(&shared.analyses, spec, &result, preempted)
}

/// What became of the track a job was to make.
enum Recorded {
    Stored,
    /// Nothing to keep and nothing to say: it was cancelled, the engine run
    /// failed and [`settle`] has said so, or the playback diverged and the
    /// stored analysis says so.
    Nothing,
    Failed(Failure),
}

/// Turn the recorder's dump from a finished run into a stored track.
///
/// The run is the one [`settle`] has already judged. Only a run that reproduced
/// the match is recorded, because the dump of any other is of a game nobody
/// played. The thinning is a stage of its own, announced as one, and it stops
/// when the job is cancelled.
fn record_track(
    shared: &Shared,
    job_id: u64,
    spec: &JobSpec,
    control: &RunControl,
    run: &AnalysisRun,
    dump: &Path,
) -> Recorded {
    let report = &run.report;
    if report.exit.cancelled {
        return Recorded::Nothing;
    }
    let could_not = |message: String| {
        Recorded::Failed(make_failure(
            spec,
            FailureReason::CouldNotRun,
            message,
            Some(run),
        ))
    };
    match report.status {
        AnalysisStatus::Reproduced => {}
        // A dump of a playback that diverged is of a game nobody played. The
        // analysis [`settle`] stored says it diverged and how, so there is no
        // failure to add. An engine that failed or ran out of time is
        // [`settle`]'s to report too.
        AnalysisStatus::Diverged | AnalysisStatus::Incomplete | AnalysisStatus::LoggerNotLoaded => {
            return Recorded::Nothing
        }
    }
    match &run.recording {
        Some(RecordingOutcome::Kept { .. }) => {}
        Some(RecordingOutcome::NotWritten) => {
            return could_not(
                "the recorder wrote no file, so it did not load or could not open one".into(),
            )
        }
        Some(RecordingOutcome::NotKept(why)) => return could_not(why.clone()),
        None => return could_not("the run was not asked to record".into()),
    }
    let Some(game_id) = track_store::id_bytes(&spec.game_id) else {
        return could_not(format!("{:?} is not a game id", spec.game_id));
    };
    set_phase(shared, job_id, RunPhase::Thinning);
    let options = ThinOptions {
        game_id,
        // The dump names the generated game it was recorded in.
        game: Some(report.recorded_game.clone()).filter(|game| !game.trim().is_empty()),
        ..ThinOptions::default()
    };
    let stored = track_store::store(&shared.tracks, &spec.game_id, |track| {
        shared
            .engine
            .thin(dump, track, &options, &|| control.was_cancelled())
            .map(|_| ())
    });
    match stored {
        Ok(_) => {
            // Only now that the track is whole and in place, so a recording
            // that fails never costs the only copy of an earlier track.
            // Nothing plays a track yet, so none is in use.
            track_budget::enforce(
                &shared.tracks,
                Some(&spec.game_id),
                (shared.track_budget)(),
                &HashSet::new(),
            );
            Recorded::Stored
        }
        // The store removed the half-written track.
        Err(_) if control.was_cancelled() => Recorded::Nothing,
        Err(message) => Recorded::Failed(make_failure(
            spec,
            FailureReason::ThinFailed,
            message,
            Some(run),
        )),
    }
}

/// Move the running job to a new stage and tell the windows.
fn set_phase(shared: &Shared, job_id: u64, phase: RunPhase) {
    {
        let mut state = shared.lock();
        let Some(running) = state.running.as_mut().filter(|r| r.job.id == job_id) else {
            return;
        };
        running.progress.phase = phase;
    }
    shared.announce();
}

/// A recorder's dump, deleted when this is dropped: on every way out of a job,
/// including a panic. A dump of a long match is hundreds of megabytes.
struct DumpFile(PathBuf);

impl Drop for DumpFile {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.0);
    }
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
        if spec.kind == JobKind::UnitList {
            let outcome = unit_list_job(shared, job_id, &spec, &control);
            finish(shared, outcome, Recorded::Nothing);
            continue;
        }
        let began = Instant::now();

        // Never twice: it may have been analysed and recorded since it was
        // queued.
        let dump = DumpFile(
            shared
                .recordings
                .join(format!("dump-{}-{job_id}", std::process::id())),
        );
        let result = if !spec.force && shared.is_current(&spec) {
            None
        } else {
            Some(shared.engine.run(&spec, &dump.0, &control, &|progress| {
                on_poll(shared, job_id, &control, progress)
            }))
        };

        let preempted = shared
            .lock()
            .running
            .as_ref()
            .is_some_and(|running| running.preempted);
        let outcome = match &result {
            None => Outcome::Nothing,
            Some(result) => settle(&shared.analyses, &spec, result, preempted),
        };
        let recorded = match &result {
            Some(Ok(run)) => record_track(shared, job_id, &spec, &control, run, &dump.0),
            _ => Recorded::Nothing,
        };
        // Whatever happened, the dump goes before the job is over.
        drop(dump);
        if matches!(recorded, Recorded::Stored) {
            keep_cost(shared, &spec, &result, began.elapsed());
        }
        finish(shared, outcome, recorded);
    }
}

/// Take the finished job off the running slot, apply what it came to and tell
/// the windows.
fn finish(shared: &Shared, outcome: Outcome, recorded: Recorded) {
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
        match recorded {
            Recorded::Stored => state.tracks += 1,
            Recorded::Nothing => {}
            Recorded::Failed(failure) => {
                state.failures.retain(|f| f.game_id != failure.game_id);
                state.failures.push(failure);
            }
        }
    }
    shared.changed.notify_all();
    shared.announce();
}

/// Keep what a stored recording cost, for the page's estimate (#3788). The
/// time runs from the job starting, so it includes the thinning. Failing to
/// keep it loses the estimate and nothing else, so it is logged.
fn keep_cost(
    shared: &Shared,
    spec: &JobSpec,
    result: &Option<Result<AnalysisRun, String>>,
    took: Duration,
) {
    let Some(Ok(run)) = result else { return };
    let Ok(track_bytes) = track_store::track_path(&shared.tracks, &spec.game_id)
        .and_then(|path| std::fs::metadata(path).map_err(|e| e.to_string()))
        .map(|meta| meta.len())
    else {
        return;
    };
    let cost = recording_costs::Cost {
        game_id: spec.game_id.clone(),
        game: run.report.recorded_game.clone(),
        frames: u64::from(spec.match_seconds) * divergence::FRAMES_PER_SECOND.unsigned_abs() as u64,
        millis: took.as_millis() as u64,
        track_bytes,
    };
    if let Err(e) = recording_costs::record(&shared.tracks, cost) {
        eprintln!("replay recording: {e}");
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

/// Remove the dumps a coilbox that died mid run left behind. A dump is named
/// after the process that made it, and one whose process is gone has nothing
/// using it. Returns how many it removed.
pub fn sweep_recordings(recordings: &Path) -> usize {
    let Ok(entries) = std::fs::read_dir(recordings) else {
        return 0;
    };
    let mut removed = 0;
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        let pid = name
            .strip_prefix("dump-")
            .and_then(|rest| rest.split('-').next())
            .and_then(|pid| pid.parse::<u32>().ok());
        if let Some(pid) = pid {
            if pid != std::process::id()
                && !coilbox_proc::is_running(pid)
                && std::fs::remove_file(entry.path()).is_ok()
            {
                removed += 1;
            }
        }
    }
    removed
}

/// Make the app's queue and hand it to Tauri. Called once, at plugin setup.
pub(crate) fn manage<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    let scratch_root = coilbox_portable::cache_dir(app)?.join(SCRATCH_DIR);
    let analyses = store::app_store_dir(app)?;
    let tracks = track_store::app_store_dir(app)?;
    let recordings = coilbox_portable::cache_dir(app)?.join(RECORDINGS_DIR);
    let settings = coilbox_portable::settings_file(app)?;
    {
        let scratch_root = scratch_root.clone();
        let recordings = recordings.clone();
        let tracks = tracks.clone();
        std::thread::spawn(move || {
            sweep_scratch(&scratch_root);
            sweep_recordings(&recordings);
            track_store::sweep_temporaries(&tracks);
        });
    }
    let handle = app.clone();
    app.manage(AnalysisQueue::new(
        HeadlessEngine { scratch_root },
        analyses,
        tracks,
        recordings,
        move || track_budget::read_budget(&settings),
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
    /// It was recorded on the playback game. A replay binds to its game by
    /// name only, so a replay of the playback has the track of the match it
    /// showed but nothing of its own to record (issue #3793).
    PlaybackGame,
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
            CannotAnalyse::PlaybackGame => {
                "this replay was recorded on the playback game, which has no match of its own to record"
            }
        }
    }
}

/// What the replay itself says about being analysed: its key and its length,
/// or why it cannot be. Reads the replay and nothing else, so a page can ask
/// before it offers the button.
pub fn check_replay(replay: &Path) -> Result<(String, u32), CannotAnalyse> {
    check_replay_for(replay, JobKind::Analyse)
}

/// [`check_replay`] for a kind of job. A unit list run compares nothing with
/// the replay's result, so it does not need one.
fn check_replay_for(replay: &Path, kind: JobKind) -> Result<(String, u32), CannotAnalyse> {
    let raw =
        super::super::read_header_and_script(replay).map_err(|_| CannotAnalyse::Unreadable)?;
    let game = super::super::find_game(&super::super::parse_tdf(&raw.script));
    if super::super::read_remix_marker(&game).remixed {
        return Err(CannotAnalyse::Remix);
    }
    if game.get("gametype") == Some(super::super::playback::gametype().as_str()) {
        return Err(CannotAnalyse::PlaybackGame);
    }
    let game_id = store::valid_game_id(&raw.game_id).map_err(|_| CannotAnalyse::NoGameId)?;
    let finished = super::super::read_trailer(replay)
        .is_ok_and(|trailer| divergence::has_recorded_outcome(&trailer));
    if kind == JobKind::Analyse && !finished {
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
    game: Option<String>,
    force: bool,
) -> Result<JobSpec, String> {
    spec_for(replay, engine_dir, data_dirs, game, force, JobKind::Analyse)
}

/// A job that reads only the engine's unit list, or the reason it cannot, in
/// words a page can show. It never forces: a replay that has its list is done.
pub fn unit_list_job_for(
    replay: &Path,
    engine_dir: &Path,
    data_dirs: Vec<PathBuf>,
    game: Option<String>,
) -> Result<JobSpec, String> {
    spec_for(
        replay,
        engine_dir,
        data_dirs,
        game,
        false,
        JobKind::UnitList,
    )
}

fn spec_for(
    replay: &Path,
    engine_dir: &Path,
    data_dirs: Vec<PathBuf>,
    game: Option<String>,
    force: bool,
    kind: JobKind,
) -> Result<JobSpec, String> {
    let (game_id, match_seconds) =
        check_replay_for(replay, kind).map_err(|why| why.message().to_string())?;
    if !super::launch::headless_binary(engine_dir).is_file() {
        return Err(format!("no headless engine in {}", engine_dir.display()));
    }
    Ok(JobSpec {
        kind,
        replay: replay.to_path_buf(),
        engine_dir: engine_dir.to_path_buf(),
        data_dirs,
        game: game.filter(|game| !game.trim().is_empty()),
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

/// `content_analysis_enqueue`: ask for a replay to be analysed and recorded as
/// a track, in one run of the engine (issues #1157, #3785 and #3962). This is
/// the only command that leads to an engine being run for either, and it is
/// only ever called because a person pressed the button for that replay.
///
/// `replayPath` is a `ReplayFile.path`. `enginePath` is the `Engine.path` of
/// the engine the replay was recorded with and `dataDir` the content folder it
/// plays from, resolved the way a replay launch resolves them. Every other
/// content folder coilbox knows is offered to the engine too. `force` asks for
/// a run of a match that already has a current analysis and track.
///
/// Answers `{ outcome, queue }`, where `outcome` is `queued`, `alreadyQueued`
/// or `alreadyDone`. It rejects, with the reason, for a replay that cannot be
/// analysed: a remix, one with no game id, one with no recorded game over, or
/// an engine folder with no headless engine in it. The time limit is not the
/// caller's to choose: see `run_timeout`.
///
/// `unitListOnly` asks for a shorter run (issue #3906): the engine is started,
/// its own unit list is kept and it is stopped. That needs no recorded game
/// over, never forces, and answers `alreadyDone` for a replay that has an engine
/// list or a reproduced analysis.
#[tauri::command]
pub(crate) async fn content_analysis_enqueue<R: Runtime>(
    app: AppHandle<R>,
    replay_path: String,
    engine_path: String,
    data_dir: String,
    game: Option<String>,
    force: Option<bool>,
    unit_list_only: Option<bool>,
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
        let spec = if unit_list_only.unwrap_or(false) {
            unit_list_job_for(
                Path::new(&replay_path),
                Path::new(&engine_path),
                data_dirs,
                game,
            )?
        } else {
            job_for(
                Path::new(&replay_path),
                Path::new(&engine_path),
                data_dirs,
                game,
                force.unwrap_or(false),
            )?
        };
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

/// The engine folders among `paths` that hold a headless engine, which is what
/// an analysis runs. Other folders hold an engine that can only open a window.
pub fn headless_engines(paths: Vec<String>) -> Vec<String> {
    paths
        .into_iter()
        .filter(|path| super::launch::headless_binary(Path::new(path)).is_file())
        .collect()
}

/// `content_analysis_check`: whether a replay can be analysed at all, read
/// from the replay, so a page can say why not beside a disabled button.
/// `enginePaths` are the installed engine folders the page is considering, and
/// `headless` answers which of them hold a headless engine. Answers `{ cannot,
/// gameId, matchSeconds, headless }`. `cannot` is
/// null for a replay that can be, and otherwise `remix`, `noGameId`,
/// `noGameOver`, `playbackGame` or `unreadable`. Whether its engine, game and map are
/// installed is a separate question, which the page already answers.
#[tauri::command]
pub(crate) async fn content_analysis_check(
    replay_path: String,
    engine_paths: Option<Vec<String>>,
) -> CliResult {
    let checked = tauri::async_runtime::spawn_blocking(move || {
        let headless = headless_engines(engine_paths.unwrap_or_default());
        (check_replay(Path::new(&replay_path)), headless)
    })
    .await;
    match checked {
        Ok((Ok((game_id, match_seconds)), headless)) => CliResult::ok(json!({
            "cannot": null,
            "gameId": game_id,
            "matchSeconds": match_seconds,
            "headless": headless,
        })),
        Ok((Err(why), headless)) => CliResult::ok(
            json!({ "cannot": why, "gameId": null, "matchSeconds": 0, "headless": headless }),
        ),
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

/// `content_analysis_engine_output`: the last lines the engine of a running
/// job has written, oldest first, for a page to show while the run goes on.
/// `lines` is null when that job is not the one running.
#[tauri::command]
pub(crate) async fn content_analysis_engine_output(
    queue: State<'_, AnalysisQueue>,
    id: u64,
) -> Result<CliResult, ()> {
    let queue = queue.inner().clone();
    // Off the async runtime: it reads a file.
    let lines = tauri::async_runtime::spawn_blocking(move || queue.engine_output(id)).await;
    Ok(match lines {
        Ok(lines) => CliResult::ok(json!({ "lines": lines })),
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
    use coilbox_track::{Settings, Track, TrackReader};
    use coilbox_track_thin::{thin_dump_cancellable, ThinError, ThinOptions, ThinReport};
    use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};
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
        /// What the thinning does.
        thin_script: Mutex<ThinScript>,
        thinned: AtomicUsize,
        /// Whether the recorder leaves a file. Off is a recorder that did not
        /// load.
        recorder_writes: AtomicBool,
    }

    /// What a fake thinning does with a dump.
    #[derive(Clone, Copy, PartialEq)]
    enum ThinScript {
        /// Thin it for real. Every dump the fake engine leaves is a small whole
        /// one.
        Real,
        /// Wait this long, then thin it for real.
        Slow(Duration),
        /// Write half a track and fail.
        Fail,
        /// Write half a track and go on until cancelled.
        UntilCancelled,
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
                thin_script: Mutex::new(ThinScript::Real),
                thinned: AtomicUsize::new(0),
                recorder_writes: AtomicBool::new(true),
            })
        }

        fn set(&self, script: Script) {
            *self.script.lock().unwrap() = script;
        }

        fn set_thin(&self, script: ThinScript) {
            *self.thin_script.lock().unwrap() = script;
        }

        /// What the recorder leaves when the run ends: nothing, half a file
        /// from a run that was stopped, or a whole dump.
        fn leave_dump(&self, to: &Path, whole: bool) -> Option<RecordingOutcome> {
            if !self.recorder_writes.load(Ordering::SeqCst) {
                return Some(RecordingOutcome::NotWritten);
            }
            let bytes = if whole {
                fixture_dump()
            } else {
                b"CBRD half a dump".to_vec()
            };
            std::fs::create_dir_all(to.parent().unwrap()).unwrap();
            std::fs::write(to, &bytes).unwrap();
            Some(RecordingOutcome::Kept {
                path: to.to_path_buf(),
                bytes: bytes.len() as u64,
            })
        }
    }

    fn block(out: &mut Vec<u8>, kind: u32, payload: &[u8]) {
        out.extend(kind.to_le_bytes());
        out.extend((payload.len() as u32).to_le_bytes());
        out.extend(payload);
    }

    /// A whole dump of a match with nothing in it, written from the byte layout
    /// in `lua/rewind-recorder/README.md`: a header, a piece tree, a block for
    /// each of 301 frames and the end.
    fn fixture_dump() -> Vec<u8> {
        let mut out = b"CBRD".to_vec();
        out.extend(1u32.to_le_bytes());
        block(
            &mut out,
            1,
            br#"{"format":1,"engine":"2026.01.0 test","game":"Coilbox replay analysis","gameVersion":"1","map":"Some Map","mapSizeX":4096,"mapSizeZ":4096,"squareSize":8,"gameSpeed":30,"maxUnits":32000,"unitFrames":3,"lastFrame":300,"terrain":true,"teams":[{"team":0,"allyTeam":0,"side":"arm","leader":"Ada","color":[10,20,30]}],"unitDefs":["tank"],"unitRadii":[10],"unitFootprints":[[4,4]],"featureDefs":["tree"],"weaponDefs":["nothing"]}"#,
        );
        block(
            &mut out,
            2,
            br#"{"def":1,"pieces":["base"],"parents":[0],"modelType":"s3o","offsets":[[0,0,0]],"bounds":[[-8,0,-12,8,5,12]]}"#,
        );
        for frame in 0..=300u32 {
            block(&mut out, 3, &(frame as f32).to_le_bytes());
        }
        block(
            &mut out,
            4,
            br#"{"reason":"game_over","frame":300,"frames":301,"winners":[0]}"#,
        );
        out
    }

    /// The names of the files in a folder, sorted. None when it is not there.
    fn files_in(dir: &Path) -> Vec<String> {
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
            record_to: &Path,
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
                    let mut run = run_with(status);
                    run.recording = self.leave_dump(record_to, true);
                    Ok(run)
                }
                Script::UntilCancelled | Script::UntilReleased => {
                    // The recorder has its file open from the first frame.
                    let partial = self.leave_dump(record_to, false);
                    // The real launch finds out it was cancelled from the
                    // control. This asks it the way a test can.
                    let began = Instant::now();
                    loop {
                        on_poll(progress(90));
                        if control.was_cancelled() {
                            let mut run =
                                with_exit(run_with(AnalysisStatus::Incomplete), false, true, None);
                            run.recording = partial;
                            break Ok(run);
                        }
                        if script == Script::UntilReleased && self.release.load(Ordering::SeqCst) {
                            let mut run = run_with(AnalysisStatus::Reproduced);
                            run.recording = self.leave_dump(record_to, true);
                            break Ok(run);
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

        fn thin(
            &self,
            dump: &Path,
            track: &Path,
            options: &ThinOptions,
            cancelled: &dyn Fn() -> bool,
        ) -> Result<ThinReport, ThinError> {
            self.thinned.fetch_add(1, Ordering::SeqCst);
            let script = *self.thin_script.lock().unwrap();
            match script {
                ThinScript::Real => thin_dump_cancellable(dump, track, options, cancelled),
                ThinScript::Slow(wait) => {
                    std::thread::sleep(wait);
                    thin_dump_cancellable(dump, track, options, cancelled)
                }
                ThinScript::Fail => {
                    std::fs::write(track, b"half a track").unwrap();
                    Err(ThinError::Dump("the recording is damaged".into()))
                }
                ThinScript::UntilCancelled => {
                    std::fs::write(track, b"half a track").unwrap();
                    let began = Instant::now();
                    while !cancelled() {
                        assert!(began.elapsed() < PATIENCE, "the thinning was never stopped");
                        std::thread::sleep(Duration::from_millis(5));
                    }
                    Err(ThinError::Cancelled)
                }
            }
        }

        fn list(
            &self,
            _job: &JobSpec,
            _control: &RunControl,
            _on_poll: &dyn Fn(RunProgress),
        ) -> Result<UnitListRun, String> {
            let script = *self.script.lock().unwrap();
            self.started.fetch_add(1, Ordering::SeqCst);
            let (units, timed_out, code) = match script {
                Script::Finish(_) => (Some(def_sets::tests::known()), false, None),
                Script::TimeOut => (None, true, None),
                Script::Crash => (None, false, Some(3)),
                _ => return Err("no headless engine in /nowhere".into()),
            };
            Ok(UnitListRun {
                units,
                base_game: "Some Game 1.0".into(),
                recorded_game: "Some Game 1.0".into(),
                exit: EngineExit {
                    code,
                    signal: None,
                    timed_out,
                    cancelled: false,
                    wall_seconds: 1.0,
                },
                header: None,
                log_excerpt: Vec::new(),
            })
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
        /// The disk budget for tracks, in bytes. No limit until a test sets one.
        budget: Arc<AtomicU64>,
    }

    impl World {
        fn new(script: Script) -> Self {
            let dir = tempfile::tempdir().unwrap();
            let engine = FakeEngine::new(script);
            let heard = Arc::new(Mutex::new(Vec::new()));
            let listener = heard.clone();
            let budget = Arc::new(AtomicU64::new(u64::MAX));
            let limit = budget.clone();
            let queue = AnalysisQueue::new(
                engine.clone(),
                dir.path().join("analyses"),
                dir.path().join("tracks"),
                dir.path().join("recordings"),
                move || limit.load(Ordering::SeqCst),
                move |snapshot: &QueueSnapshot| listener.lock().unwrap().push(snapshot.clone()),
            );
            World {
                dir,
                engine,
                queue,
                heard,
                budget,
            }
        }

        fn analyses(&self) -> PathBuf {
            self.dir.path().join("analyses")
        }

        fn tracks(&self) -> PathBuf {
            self.dir.path().join("tracks")
        }

        fn recordings(&self) -> PathBuf {
            self.dir.path().join("recordings")
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
            kind: JobKind::Analyse,
            replay: PathBuf::from(format!("/replays/{game_id}.sdfz")),
            engine_dir: PathBuf::from("/engines/1"),
            data_dirs: Vec::new(),
            game: None,
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
            24
        );
    }

    /// A run by a logger that lists the engine's unit definitions: the four of
    /// the logger's own fixture, then the fixture match.
    fn run_with_unit_defs(status: AnalysisStatus) -> AnalysisRun {
        use super::super::log::tests::{FIXTURE, UNIT_DEFS_FIXTURE};
        let match_lines = FIXTURE.split_once('\n').expect("a header line").1;
        let log = super::super::log::parse_log(&format!("{UNIT_DEFS_FIXTURE}{match_lines}"));
        let mut run = run_with(status);
        run.report.header = log.header().cloned();
        run.report.counts = log.counts();
        if run.events.is_some() {
            run.events = Some(log.raw);
        }
        run
    }

    /// The engine's own list is the numbering the stored events use, so it is
    /// kept when they are, once for every replay that shares it, and it goes
    /// when the stored file stops being that run's.
    #[test]
    fn a_reproduced_run_keeps_the_engines_unit_definitions_beside_its_events() {
        let dir = tempfile::tempdir().unwrap();
        let analyses = store::store_dir(dir.path());
        let sets = def_sets::dir_beside(&analyses);
        let stored = |game_id: &str, status| {
            matches!(
                settle(
                    &analyses,
                    &job(game_id, false),
                    &Ok(run_with_unit_defs(status)),
                    false
                ),
                Outcome::Stored
            )
        };

        assert!(stored(ID, AnalysisStatus::Reproduced));

        let found = def_sets::for_replay(&sets, ID).unwrap();
        assert_eq!(found.links.len(), 1);
        let link = found.events.clone().expect("a list for the events");
        assert_eq!(link.origin, def_sets::Origin::Engine);
        assert_eq!(link.game, "Some Game 1.0");
        assert_eq!(link.game_differs, Some(false));
        assert_eq!(link.taken_at_ms, {
            let p = store::read(&analyses, ID).unwrap().unwrap().provenance;
            p.analysed_at_ms
        });
        // The run used the recorded game, so the list names the orders too.
        assert_eq!(found.stream, Some(link.clone()));
        let names: Vec<&str> = found.sets[&link.digest]
            .iter()
            .map(|unit| unit.name.as_str())
            .collect();
        assert_eq!(names, vec!["tgcom", "tgmex", "tgwind", "tg\"odd"]);

        // The stored file says how many there were and holds none of them.
        let provenance = store::read(&analyses, ID).unwrap().unwrap().provenance;
        assert_eq!(provenance.counts.unit_def, 4);
        let events = store::read_events(&analyses, ID, None, 0, None).unwrap();
        assert_eq!(events.total, 24);
        assert!(events.events.iter().all(|e| e["kind"] != "unit_def"));

        // A second match on the same build shares the one list.
        assert!(stored(OTHER, AnalysisStatus::Reproduced));
        let usage = def_sets::usage(&sets);
        assert_eq!((usage.sets, usage.replays), (1, 2));

        // A later run that did not reproduce the match leaves no events, so
        // the first replay has no engine list any more. The other keeps its.
        assert!(stored(ID, AnalysisStatus::Diverged));
        assert_eq!(def_sets::for_replay(&sets, ID).unwrap().links, Vec::new());
        let usage = def_sets::usage(&sets);
        assert_eq!((usage.sets, usage.replays), (1, 1));
    }

    /// A stored analysis from a logger that listed no unit definitions has
    /// nothing to keep, and that is not a failure.
    #[test]
    fn a_run_with_no_unit_definitions_keeps_none() {
        let dir = tempfile::tempdir().unwrap();
        let analyses = store::store_dir(dir.path());

        let outcome = settle(
            &analyses,
            &job(ID, false),
            &Ok(run_with(AnalysisStatus::Reproduced)),
            false,
        );

        assert!(matches!(outcome, Outcome::Stored));
        let sets = def_sets::dir_beside(&analyses);
        assert_eq!(def_sets::for_replay(&sets, ID).unwrap().links, Vec::new());
        assert_eq!(def_sets::usage(&sets).sets, 0);
    }

    fn list_job(game_id: &str) -> JobSpec {
        JobSpec {
            kind: JobKind::UnitList,
            ..job(game_id, false)
        }
    }

    /// The engine's list is kept as an analysis's is, with nothing analysed, and
    /// a replay that has it is not run again.
    #[test]
    fn a_unit_list_job_keeps_the_engines_list_and_nothing_else() {
        let world = World::new(Script::Finish(AnalysisStatus::Reproduced));

        assert_eq!(world.queue.enqueue(list_job(ID)).unwrap(), Enqueued::Queued);
        let idle = world.until_idle();

        assert_eq!(world.started(), 1);
        assert_eq!(idle.stored, 1);
        assert_eq!(idle.tracks, 0);
        assert!(idle.failures.is_empty());
        assert!(store::read(&world.analyses(), ID).unwrap().is_none());
        let sets = def_sets::dir_beside(&world.analyses());
        let found = def_sets::for_replay(&sets, ID).unwrap();
        let link = found.events.expect("a list for the events");
        assert_eq!(link.origin, def_sets::Origin::Engine);
        assert_eq!(link.game, "Some Game 1.0");
        assert_eq!(link.game_differs, Some(false));
        assert_eq!(
            found.sets[&link.digest].len(),
            def_sets::tests::known().len()
        );

        assert_eq!(
            world.queue.enqueue(list_job(ID)).unwrap(),
            Enqueued::AlreadyDone
        );
        assert_eq!(world.started(), 1);
    }

    /// A reproduced analysis's events are numbered by its own run's list, which
    /// a new list from another run could renumber.
    #[test]
    fn a_unit_list_job_leaves_a_reproduced_analysis_alone() {
        let world = World::new(Script::Finish(AnalysisStatus::Reproduced));
        world.ask(ID);
        world.until_idle();

        assert_eq!(
            world.queue.enqueue(list_job(ID)).unwrap(),
            Enqueued::AlreadyDone
        );
        assert_eq!(world.started(), 1);
    }

    #[test]
    fn a_unit_list_job_that_timed_out_is_a_failure_and_keeps_nothing() {
        let world = World::new(Script::TimeOut);

        world.queue.enqueue(list_job(ID)).unwrap();
        let idle = world.until_idle();

        assert_eq!(idle.stored, 0);
        assert_eq!(idle.failures.len(), 1);
        assert_eq!(idle.failures[0].reason, FailureReason::ListFailed);
        assert!(
            idle.failures[0]
                .message
                .contains("had not written the unit list"),
            "{}",
            idle.failures[0].message
        );
        let sets = def_sets::dir_beside(&world.analyses());
        assert_eq!(def_sets::for_replay(&sets, ID).unwrap().links, Vec::new());
    }

    #[test]
    fn a_unit_list_job_whose_engine_exited_early_says_so() {
        let world = World::new(Script::Crash);

        world.queue.enqueue(list_job(ID)).unwrap();
        let idle = world.until_idle();

        assert_eq!(idle.failures.len(), 1);
        assert_eq!(
            idle.failures[0].message,
            "the engine exited with status 3 before it wrote the unit list"
        );
    }

    #[test]
    fn a_unit_list_job_that_was_cancelled_or_stood_aside_for_a_game_keeps_nothing() {
        let dir = tempfile::tempdir().unwrap();
        let analyses = store::store_dir(dir.path());
        let cancelled = || {
            Ok::<_, String>(UnitListRun {
                units: None,
                base_game: "Some Game 1.0".into(),
                recorded_game: "Some Game 1.0".into(),
                exit: EngineExit {
                    code: None,
                    signal: None,
                    timed_out: false,
                    cancelled: true,
                    wall_seconds: 1.0,
                },
                header: None,
                log_excerpt: Vec::new(),
            })
        };

        assert!(matches!(
            settle_list(&analyses, &list_job(ID), &cancelled(), false),
            Outcome::Nothing
        ));
        assert!(matches!(
            settle_list(&analyses, &list_job(ID), &cancelled(), true),
            Outcome::Requeue
        ));
        assert_eq!(
            def_sets::for_replay(&def_sets::dir_beside(&analyses), ID)
                .unwrap()
                .links,
            Vec::new()
        );
    }

    #[test]
    fn a_run_that_differs_from_the_recorded_game_says_so_beside_its_list() {
        let dir = tempfile::tempdir().unwrap();
        let analyses = store::store_dir(dir.path());
        let run = Ok::<_, String>(UnitListRun {
            units: Some(def_sets::tests::known()),
            base_game: "Some Game 1.1".into(),
            recorded_game: "Some Game 1.0".into(),
            exit: EngineExit {
                code: None,
                signal: Some(9),
                timed_out: false,
                cancelled: true,
                wall_seconds: 1.0,
            },
            header: None,
            log_excerpt: Vec::new(),
        });

        assert!(matches!(
            settle_list(&analyses, &list_job(ID), &run, false),
            Outcome::Stored
        ));

        let found = def_sets::for_replay(&def_sets::dir_beside(&analyses), ID).unwrap();
        let link = found.events.expect("a list for the events");
        assert_eq!(link.game, "Some Game 1.1");
        assert_eq!(link.game_differs, Some(true));
        // It names the events of its own run and not the replay's orders.
        assert_eq!(found.stream, None);
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

        assert_eq!(world.ask(ID), Enqueued::AlreadyDone);
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
        // The snapshot shows the frame before the worker has announced it, so
        // wait for the listener as well.
        let playing = world.until("a frame", |s| {
            s.running.as_ref().is_some_and(|r| r.frame == 90)
                && world
                    .heard
                    .lock()
                    .unwrap()
                    .iter()
                    .any(|s| s.running.as_ref().is_some_and(|r| r.frame == 90))
        });

        let running = playing.running.unwrap();
        assert_eq!(running.phase, RunPhase::Playing);
        assert_eq!((running.frame, running.last_frame), (90, 1500));
        assert_eq!(running.match_seconds, 50);
        world.engine.release.store(true, Ordering::SeqCst);
        // The queue is idle when its state says so, which is before the
        // worker has announced that to the listener. Wait for the listener.
        world.until("the listener to hear an empty queue", |_| {
            world.heard.lock().unwrap().last().is_some_and(|last| {
                last.running.is_none() && last.queued.is_empty() && last.stored == 1
            })
        });
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
    fn the_engines_output_is_only_given_for_the_job_that_is_running() {
        let world = World::new(Script::UntilCancelled);
        world.ask(ID);
        world.ask(OTHER);
        let playing = world.until_playing(1);
        let running = playing.running.unwrap().id;
        let queued = playing.queued[0].id;

        // The stand in engine writes no output, so there are no lines yet.
        assert_eq!(world.queue.engine_output(running), Some(Vec::new()));
        assert_eq!(world.queue.engine_output(queued), None);

        world.queue.cancel_all();
        world.until_idle();
        assert_eq!(world.queue.engine_output(running), None);
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
            serde_json::to_value(Enqueued::AlreadyDone).unwrap(),
            "alreadyDone"
        );
    }

    // ---- recording a replay (issue #3785) ----

    /// A whole track for a match, as the writer makes it, to stand in for one
    /// made earlier.
    fn earlier_track(game_id: &str) -> Vec<u8> {
        earlier_track_from(game_id, coilbox_track_thin::RECORDER_VERSION)
    }

    fn earlier_track_from(game_id: &str, recorder_version: u16) -> Vec<u8> {
        let mut id = [0u8; 16];
        for (i, byte) in id.iter_mut().enumerate() {
            *byte = u8::from_str_radix(&game_id[i * 2..i * 2 + 2], 16).unwrap();
        }
        let mut track = Track::new(Settings {
            game_id: id,
            recorder_version,
            last_frame: 90,
            ..Settings::default()
        });
        track.info.game = "An earlier game 1".into();
        track.to_bytes().expect("a small track writes")
    }

    fn store_earlier_track(world: &World, game_id: &str) -> Vec<u8> {
        let bytes = earlier_track(game_id);
        track_store::store(&world.tracks(), game_id, |path| {
            std::fs::write(path, &bytes)
        })
        .expect("an earlier track stores");
        bytes
    }

    fn track_info(path: &Path) -> coilbox_track::Info {
        TrackReader::open(std::io::BufReader::new(std::fs::File::open(path).unwrap()))
            .unwrap()
            .info()
            .unwrap()
    }

    /// Acceptance: recording a replay from the queue ends with one track file
    /// and no dump left behind.
    #[test]
    fn recording_a_replay_ends_with_one_track_and_no_dump_left_behind() {
        let world = World::new(Script::Finish(AnalysisStatus::Reproduced));

        assert_eq!(world.ask(ID), Enqueued::Queued);
        let idle = world.until_idle();

        assert_eq!(world.started(), 1);
        assert!(idle.failures.is_empty(), "{:?}", idle.failures);
        assert_eq!(idle.tracks, 1);
        assert_eq!(files_in(&world.tracks()), vec![format!("{ID}.cbtrack")]);
        assert_eq!(files_in(&world.recordings()), Vec::<String>::new());
        assert_eq!(
            track_store::state(&world.tracks(), ID).unwrap(),
            Some(track_store::TrackState::Current)
        );
        // The track says which game it is of: the one the replay was recorded
        // on, and not the generated game the dump names.
        let info = track_info(&track_store::track_path(&world.tracks(), ID).unwrap());
        assert_eq!(info.game, "Some Game 1.0");
        // The same run kept the analysis, because its logger had played the
        // same match.
        assert!(store::is_current(&world.analyses(), ID));
    }

    /// Acceptance: cancelling part way leaves no files.
    #[test]
    fn cancelling_a_recording_part_way_leaves_no_files() {
        let world = World::new(Script::UntilCancelled);
        world.ask(ID);
        let busy = world.until_playing(1);
        assert_eq!(
            files_in(&world.recordings()).len(),
            1,
            "the recorder had a file open"
        );

        assert!(world.queue.cancel(busy.running.unwrap().id));
        let idle = world.until_idle();

        assert_eq!(files_in(&world.recordings()), Vec::<String>::new());
        assert_eq!(files_in(&world.tracks()), Vec::<String>::new());
        assert_eq!(store::read(&world.analyses(), ID).unwrap(), None);
        assert!(idle.failures.is_empty());
        assert_eq!((idle.stored, idle.tracks), (0, 0));
        assert_eq!(world.engine.thinned.load(Ordering::SeqCst), 0);
    }

    /// Acceptance: two requests run one after the other, never together.
    #[test]
    fn two_recordings_run_one_after_the_other_and_never_together() {
        let world = World::new(Script::UntilReleased);

        world.ask(ID);
        world.ask(OTHER);
        let busy = world.until("the first job running", |s| s.running.is_some());
        assert_eq!(busy.running.as_ref().unwrap().game_id, ID);
        assert_eq!(busy.queued.len(), 1);

        world.engine.release.store(true, Ordering::SeqCst);
        let idle = world.until_idle();

        assert_eq!(world.started(), 2);
        assert_eq!(world.engine.most_at_once.load(Ordering::SeqCst), 1);
        assert_eq!(idle.tracks, 2);
        assert_eq!(
            files_in(&world.tracks()),
            vec![format!("{OTHER}.cbtrack"), format!("{ID}.cbtrack")]
        );
        assert_eq!(files_in(&world.recordings()), Vec::<String>::new());
    }

    /// A playback that did not reproduce the match is a recording of a match
    /// nobody played. Nothing is stored for it but the mark on the replay.
    #[test]
    fn a_diverged_recording_stores_no_track_and_marks_the_replay_diverged() {
        let world = World::new(Script::Finish(AnalysisStatus::Diverged));

        world.ask(ID);
        let idle = world.until_idle();

        assert_eq!(files_in(&world.tracks()), Vec::<String>::new());
        assert_eq!(files_in(&world.recordings()), Vec::<String>::new());
        assert_eq!(world.engine.thinned.load(Ordering::SeqCst), 0);
        assert_eq!(idle.tracks, 0);
        // The mark: a stored analysis in the diverged state, which is what the
        // replay's page already shows.
        let stored = store::read(&world.analyses(), ID).unwrap().expect("marked");
        assert_eq!(stored.state, store::AnalysisState::Diverged);
        // The mark says what disagreed, so the queue has no failure to add
        // and the page says it once.
        assert_eq!(stored.provenance.disagreements.len(), 1);
        assert_eq!(stored.provenance.disagreements[0].figure, "metalProduced");
        assert!(idle.failures.is_empty(), "{:?}", idle.failures);
    }

    /// An earlier track is the only copy until the new one is whole.
    #[test]
    fn a_thinning_that_fails_deletes_the_dump_and_keeps_the_earlier_track() {
        let world = World::new(Script::Finish(AnalysisStatus::Reproduced));
        let earlier = store_earlier_track(&world, ID);
        world.engine.set_thin(ThinScript::Fail);

        assert_eq!(
            world.queue.enqueue(job(ID, true)).unwrap(),
            Enqueued::Queued
        );
        let idle = world.until_idle();

        assert_eq!(files_in(&world.recordings()), Vec::<String>::new());
        assert_eq!(files_in(&world.tracks()), vec![format!("{ID}.cbtrack")]);
        assert_eq!(
            std::fs::read(track_store::track_path(&world.tracks(), ID).unwrap()).unwrap(),
            earlier
        );
        assert_eq!(idle.tracks, 0);
        assert_eq!(idle.failures.len(), 1);
        assert_eq!(idle.failures[0].reason, FailureReason::ThinFailed);
        assert!(
            idle.failures[0]
                .message
                .contains("the recording is damaged"),
            "{}",
            idle.failures[0].message
        );
    }

    /// One run makes the analysis and the track, so a match with only the
    /// analysis is run for both (issue #3962). Tracks go when the disk budget
    /// is reached or a person clears them, and the analysis stays.
    #[test]
    fn a_match_with_an_analysis_and_no_track_is_run_again_for_both() {
        let world = World::new(Script::Finish(AnalysisStatus::Reproduced));
        world.ask(ID);
        world.until_idle();
        track_store::remove(&world.tracks(), ID).expect("the track goes");
        assert!(store::is_current(&world.analyses(), ID));

        assert_eq!(world.ask(ID), Enqueued::Queued);
        let idle = world.until("a second track", |s| s.tracks == 2);

        assert_eq!(world.started(), 2);
        assert_eq!(idle.stored, 2);
        assert_eq!(files_in(&world.tracks()), vec![format!("{ID}.cbtrack")]);
        assert_eq!(world.ask(ID), Enqueued::AlreadyDone);
    }

    /// The reverse: a person deleted the analysis and kept the track.
    #[test]
    fn a_match_with_a_track_and_no_analysis_is_run_again_for_both() {
        let world = World::new(Script::Finish(AnalysisStatus::Reproduced));
        world.ask(ID);
        world.until_idle();
        store::delete(&world.analyses(), ID).expect("the analysis goes");

        assert_eq!(world.ask(ID), Enqueued::Queued);
        let idle = world.until("a second stored run", |s| s.stored == 2);

        assert_eq!(world.started(), 2);
        assert_eq!(idle.tracks, 2);
        assert!(store::is_current(&world.analyses(), ID));
    }

    /// Cancelling the thinning removes the temporary track, the dump and the
    /// run, and the track from before stays.
    #[test]
    fn cancelling_during_the_thinning_leaves_no_files() {
        let world = World::new(Script::Finish(AnalysisStatus::Reproduced));
        let earlier = store_earlier_track(&world, ID);
        world.engine.set_thin(ThinScript::UntilCancelled);

        world.queue.enqueue(job(ID, true)).expect("asking again");
        let thinning = world.until("the thinning", |s| {
            s.running
                .as_ref()
                .is_some_and(|r| r.phase == RunPhase::Thinning)
        });
        // The temporary track exists while it runs, so this is a test of
        // something.
        assert_eq!(files_in(&world.tracks()).len(), 2);
        assert_eq!(files_in(&world.recordings()).len(), 1);

        assert!(world.queue.cancel(thinning.running.unwrap().id));
        let idle = world.until_idle();

        assert_eq!(files_in(&world.recordings()), Vec::<String>::new());
        assert_eq!(files_in(&world.tracks()), vec![format!("{ID}.cbtrack")]);
        assert_eq!(
            std::fs::read(track_store::track_path(&world.tracks(), ID).unwrap()).unwrap(),
            earlier
        );
        assert!(idle.failures.is_empty(), "{:?}", idle.failures);
        assert_eq!(idle.tracks, 0);
        assert_eq!(world.started(), 1);
    }

    // ---- the disk budget for tracks (issue #3787) ----

    fn track_size(world: &World, game_id: &str) -> u64 {
        std::fs::metadata(track_store::track_path(&world.tracks(), game_id).unwrap())
            .unwrap()
            .len()
    }

    /// Set when a stored track was last watched.
    fn watched_at(world: &World, game_id: &str, when: std::time::SystemTime) {
        std::fs::File::options()
            .write(true)
            .open(track_store::track_path(&world.tracks(), game_id).unwrap())
            .unwrap()
            .set_modified(when)
            .unwrap();
    }

    /// The names the tracks of these matches are stored under, sorted.
    fn track_files(game_ids: &[&str]) -> Vec<String> {
        let mut names: Vec<String> = game_ids.iter().map(|id| format!("{id}.cbtrack")).collect();
        names.sort();
        names
    }

    /// Record a match with no limit, and say how big its track is. Takes the
    /// track away again, so the folder is as it was.
    fn measure_a_track(world: &World, game_id: &str) -> u64 {
        world.ask(game_id);
        world.until_idle();
        let size = track_size(world, game_id);
        assert!(track_store::remove(&world.tracks(), game_id).unwrap());
        size
    }

    /// Acceptance: with room for less than two tracks, recording a second
    /// removes the first. The limit is read again for each recording, so it is
    /// the lowered one that is applied.
    #[test]
    fn recording_a_second_track_with_room_for_less_than_two_removes_the_first() {
        let world = World::new(Script::Finish(AnalysisStatus::Reproduced));
        world.ask(ID);
        world.until_idle();
        let one = track_size(&world, ID);
        assert_eq!(files_in(&world.tracks()), track_files(&[ID]));

        world.budget.store(one + one / 2, Ordering::SeqCst);
        world.ask(OTHER);
        let idle = world.until_idle();

        assert!(track_size(&world, OTHER) <= one + one / 2);
        assert_eq!(files_in(&world.tracks()), track_files(&[OTHER]));
        assert_eq!(idle.tracks, 2);
        assert!(idle.failures.is_empty(), "{:?}", idle.failures);
    }

    /// An earlier track may be the only copy. Nothing is removed for a
    /// recording that does not end in a stored track.
    #[test]
    fn a_recording_whose_thinning_fails_removes_no_track_to_make_room() {
        let world = World::new(Script::Finish(AnalysisStatus::Reproduced));
        store_earlier_track(&world, ID);
        store_earlier_track(&world, OTHER);
        world.budget.store(0, Ordering::SeqCst);
        world.engine.set_thin(ThinScript::Fail);

        world.ask(THIRD);
        let idle = world.until_idle();

        assert_eq!(files_in(&world.tracks()), track_files(&[ID, OTHER]));
        assert_eq!(idle.tracks, 0);
        assert_eq!(idle.failures.len(), 1);
        assert_eq!(idle.failures[0].reason, FailureReason::ThinFailed);
    }

    #[test]
    fn a_recording_that_diverged_removes_no_track_to_make_room() {
        let world = World::new(Script::Finish(AnalysisStatus::Diverged));
        store_earlier_track(&world, ID);
        world.budget.store(0, Ordering::SeqCst);

        world.ask(OTHER);
        world.until_idle();

        assert_eq!(files_in(&world.tracks()), track_files(&[ID]));
    }

    #[test]
    fn a_recording_cancelled_in_the_thinning_removes_no_track_to_make_room() {
        let world = World::new(Script::Finish(AnalysisStatus::Reproduced));
        store_earlier_track(&world, ID);
        world.budget.store(0, Ordering::SeqCst);
        world.engine.set_thin(ThinScript::UntilCancelled);

        world.ask(OTHER);
        let thinning = world.until("the thinning", |s| {
            s.running
                .as_ref()
                .is_some_and(|r| r.phase == RunPhase::Thinning)
        });
        assert!(world.queue.cancel(thinning.running.unwrap().id));
        world.until_idle();

        assert_eq!(files_in(&world.tracks()), track_files(&[ID]));
    }

    /// What a recording cost is kept for the page's estimate (#3788): the
    /// match's length in frames, the game it was recorded on and the track's
    /// size.
    #[test]
    fn a_recording_keeps_what_it_cost() {
        let world = World::new(Script::Finish(AnalysisStatus::Reproduced));

        world.ask(ID);
        world.until_idle();

        let costs = recording_costs::list(&world.tracks());
        assert_eq!(costs.len(), 1, "{costs:?}");
        assert_eq!(costs[0].game_id, ID);
        assert_eq!(costs[0].game, "Some Game 1.0");
        assert_eq!(
            costs[0].frames,
            50 * u64::from(divergence::FRAMES_PER_SECOND.unsigned_abs())
        );
        assert_eq!(costs[0].track_bytes, track_size(&world, ID));
    }

    /// The time includes the thinning: a recording whose thinning takes a
    /// while costs at least that while.
    #[test]
    fn the_time_a_recording_cost_includes_the_thinning() {
        let world = World::new(Script::Finish(AnalysisStatus::Reproduced));
        world
            .engine
            .set_thin(ThinScript::Slow(Duration::from_millis(200)));

        world.ask(ID);
        world.until_idle();

        let costs = recording_costs::list(&world.tracks());
        assert!(costs[0].millis >= 200, "{costs:?}");
    }

    #[test]
    fn a_recording_that_made_no_track_keeps_no_cost() {
        for (script, thin) in [
            (Script::Finish(AnalysisStatus::Diverged), ThinScript::Real),
            (Script::Finish(AnalysisStatus::Reproduced), ThinScript::Fail),
        ] {
            let world = World::new(script);
            world.engine.set_thin(thin);

            world.ask(ID);
            world.until_idle();

            assert_eq!(recording_costs::list(&world.tracks()), Vec::new());
        }
    }

    /// The player asked for the recording, so it is kept and the rest go.
    #[test]
    fn a_track_larger_than_the_whole_budget_is_kept_and_every_other_track_goes() {
        let world = World::new(Script::Finish(AnalysisStatus::Reproduced));
        store_earlier_track(&world, OTHER);
        store_earlier_track(&world, THIRD);
        world.budget.store(1, Ordering::SeqCst);

        world.ask(ID);
        let idle = world.until_idle();

        assert!(track_size(&world, ID) > 1);
        assert_eq!(files_in(&world.tracks()), track_files(&[ID]));
        assert_eq!(idle.tracks, 1);
        assert!(idle.failures.is_empty(), "{:?}", idle.failures);
    }

    /// The new track is the oldest by time here, because the other track is
    /// marked as watched an hour from now.
    #[test]
    fn the_track_just_recorded_is_never_the_one_removed_to_make_room_for_it() {
        let world = World::new(Script::Finish(AnalysisStatus::Reproduced));
        let new = measure_a_track(&world, ID);
        store_earlier_track(&world, OTHER);
        watched_at(
            &world,
            OTHER,
            std::time::SystemTime::now() + Duration::from_secs(3600),
        );
        world.budget.store(new, Ordering::SeqCst);

        world.ask(ID);
        world.until_idle();

        assert_eq!(files_in(&world.tracks()), track_files(&[ID]));
    }

    /// Recording a replay again replaces its track, so the old one is not
    /// counted as well as the new.
    #[test]
    fn recording_a_replay_again_does_not_count_its_old_track_twice() {
        let world = World::new(Script::Finish(AnalysisStatus::Reproduced));
        world.ask(ID);
        world.until_idle();
        let new = track_size(&world, ID);
        let other = store_earlier_track(&world, OTHER).len() as u64;
        world.budget.store(new + other, Ordering::SeqCst);

        assert_eq!(
            world.queue.enqueue(job(ID, true)).unwrap(),
            Enqueued::Queued
        );
        let idle = world.until_idle();

        assert_eq!(idle.tracks, 2);
        assert_eq!(files_in(&world.tracks()), track_files(&[ID, OTHER]));
    }

    /// A stale track cannot be played, so it goes before a current one that
    /// was watched longer ago.
    #[test]
    fn a_stale_track_is_removed_before_a_current_one_watched_longer_ago() {
        let world = World::new(Script::Finish(AnalysisStatus::Reproduced));
        let new = measure_a_track(&world, ID);
        let current = store_earlier_track(&world, OTHER).len() as u64;
        watched_at(
            &world,
            OTHER,
            std::time::SystemTime::now() - Duration::from_secs(7200),
        );
        std::fs::write(
            track_store::track_path(&world.tracks(), THIRD).unwrap(),
            earlier_track_from(THIRD, coilbox_track_thin::RECORDER_VERSION - 1),
        )
        .unwrap();
        assert_eq!(
            track_store::state(&world.tracks(), THIRD).unwrap(),
            Some(track_store::TrackState::Stale)
        );
        world.budget.store(new + current, Ordering::SeqCst);

        world.ask(ID);
        world.until_idle();

        assert_eq!(files_in(&world.tracks()), track_files(&[ID, OTHER]));
    }

    /// Progress is the frame the playback has reached, and the thinning after
    /// it is a stage of its own and not a bar stuck at the end.
    #[test]
    fn a_recording_shows_the_playback_and_then_the_thinning_as_a_stage_of_its_own() {
        let world = World::new(Script::UntilReleased);
        world.ask(ID);
        world.until_playing(1);

        world.engine.release.store(true, Ordering::SeqCst);
        world.until_idle();

        let phases: Vec<(RunPhase, i32)> = world
            .heard
            .lock()
            .unwrap()
            .iter()
            .filter_map(|s| s.running.as_ref())
            .map(|r| (r.phase, r.frame))
            .collect();
        assert!(phases.contains(&(RunPhase::Playing, 90)), "{phases:?}");
        let thinning = phases
            .iter()
            .position(|(phase, _)| *phase == RunPhase::Thinning)
            .expect("the thinning was announced");
        let playing = phases
            .iter()
            .rposition(|(phase, _)| *phase == RunPhase::Playing)
            .unwrap();
        assert!(playing < thinning, "{phases:?}");
        // The playback ended where it ended. The stage does not claim frames.
        assert_eq!(phases[thinning].1, phases[playing].1);
    }

    /// A recorder that wrote nothing leaves nothing to thin. Saying so beats
    /// a job that ends with no track and no word.
    #[test]
    fn a_run_whose_recorder_wrote_no_file_fails_and_says_so() {
        let world = World::new(Script::Finish(AnalysisStatus::Reproduced));
        world.engine.recorder_writes.store(false, Ordering::SeqCst);

        world.ask(ID);
        let idle = world.until_idle();

        assert_eq!(files_in(&world.tracks()), Vec::<String>::new());
        assert_eq!(idle.failures.len(), 1);
        assert_eq!(idle.failures[0].reason, FailureReason::CouldNotRun);
        assert!(
            idle.failures[0].message.contains("recorder"),
            "{}",
            idle.failures[0].message
        );
        assert_eq!(world.engine.thinned.load(Ordering::SeqCst), 0);
    }

    /// A crash mid run leaves its dump, and it can be 661 MB.
    #[test]
    fn a_dump_left_by_a_dead_process_is_swept_and_a_live_ones_is_kept() {
        let dir = tempfile::tempdir().unwrap();
        let mut gone = coilbox_proc::command(std::env::current_exe().unwrap())
            .arg("--list")
            .stdout(std::process::Stdio::null())
            .spawn()
            .unwrap();
        let dead = gone.id();
        gone.wait().unwrap();
        let ours = std::process::id();
        for name in [
            format!("dump-{dead}-1"),
            format!("dump-{ours}-1"),
            "something-else".to_string(),
        ] {
            std::fs::write(dir.path().join(name), b"CBRD").unwrap();
        }

        assert_eq!(sweep_recordings(dir.path()), 1);

        assert_eq!(
            files_in(dir.path()),
            vec![format!("dump-{ours}-1"), "something-else".to_string()]
        );
    }

    #[test]
    fn the_recording_words_in_the_snapshot_json_are_camel_case() {
        let world = World::new(Script::UntilReleased);
        world.ask(ID);
        let busy = world.until("the recording running", |s| s.running.is_some());
        let json = serde_json::to_value(&busy).unwrap();

        assert_eq!(json["tracks"], 0);
        for (value, word) in [
            (serde_json::to_value(RunPhase::Thinning), "thinning"),
            (
                serde_json::to_value(FailureReason::ThinFailed),
                "thinFailed",
            ),
        ] {
            assert_eq!(value.unwrap(), word);
        }
        world.queue.cancel_all();
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
            record_to: &Path,
            control: &RunControl,
            on_poll: &dyn Fn(RunProgress),
        ) -> Result<AnalysisRun, String> {
            self.runs.fetch_add(1, Ordering::SeqCst);
            self.engine.run(job, record_to, control, on_poll)
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
            dir.path().join("tracks"),
            dir.path().join("recordings"),
            || u64::MAX,
            move |snapshot: &QueueSnapshot| listener.lock().unwrap().push(snapshot.clone()),
        );
        let spec = job_for(
            &replay,
            Path::new(&engine_dir),
            data_dirs.clone(),
            None,
            false,
        )
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
        // Every line the run wrote but the unit definitions, which are kept
        // in their own store.
        let lines = p.counts.header
            + p.counts.game_start
            + p.counts.unit_created
            + p.counts.unit_finished
            + p.counts.unit_destroyed
            + p.counts.unit_given
            + p.counts.start_unit_position
            + p.counts.game_over
            + p.counts.unknown;
        let sets = def_sets::dir_beside(&analyses);
        let kept = def_sets::for_replay(&sets, &game_id).unwrap();
        let engine_list = kept.events.as_ref().expect("the engine's own unit list");
        assert_eq!(engine_list.origin, def_sets::Origin::Engine);
        assert_eq!(kept.sets[&engine_list.digest].len(), p.counts.unit_def);
        assert!(
            p.counts.unit_def > 0,
            "the logger listed no unit definitions"
        );
        eprintln!(
            "the engine listed {} unit definitions, kept as {} in {} bytes",
            p.counts.unit_def,
            engine_list.digest,
            def_sets::usage(&sets).bytes
        );
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
        assert_eq!(queue.enqueue(spec.clone()).unwrap(), Enqueued::AlreadyDone);
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

    /// The whole route for a recording against a real engine, a real game and
    /// a real replay: queue, run with the recorder, thin, store as a track.
    /// The end is one track, no dump, nothing in scratch, and a track that
    /// names the game the replay was recorded on.
    ///
    /// Reads what to run from the same variables as
    /// `a_real_replay_goes_through_the_queue_into_the_store_and_out_again`, and
    /// does nothing without them. `scripts/rewind-headless.sh` runs it on a
    /// scripted Splinter Faction match.
    #[test]
    #[ignore = "needs an engine, a game, a map and a replay recorded with them"]
    fn a_real_replay_is_recorded_through_the_queue_into_a_track() {
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
        let (analyses, tracks) = (dir.path().join("analyses"), dir.path().join("tracks"));
        let (scratch_root, recordings) = (dir.path().join("scratch"), dir.path().join("dumps"));
        let heard = Arc::new(Mutex::new(Vec::<QueueSnapshot>::new()));
        let listener = heard.clone();
        let queue = AnalysisQueue::new(
            HeadlessEngine {
                scratch_root: scratch_root.clone(),
            },
            analyses.clone(),
            tracks.clone(),
            recordings.clone(),
            || u64::MAX,
            move |snapshot: &QueueSnapshot| listener.lock().unwrap().push(snapshot.clone()),
        );
        let spec = job_for(&replay, Path::new(&engine_dir), data_dirs, None, false)
            .expect("a replay that can be analysed");
        let game_id = store::replay_key(&replay).unwrap();
        let limit = run_timeout(spec.match_seconds);

        let began = Instant::now();
        assert_eq!(queue.enqueue(spec.clone()).unwrap(), Enqueued::Queued);
        let idle = loop {
            let snapshot = queue.snapshot();
            if snapshot.running.is_none() && snapshot.queued.is_empty() {
                break snapshot;
            }
            assert!(
                began.elapsed() < limit + PATIENCE,
                "the recording never finished"
            );
            std::thread::sleep(Duration::from_millis(50));
        };
        let wall = began.elapsed();

        assert_eq!(idle.failures, Vec::new(), "the recording failed");
        assert_eq!((idle.stored, idle.tracks), (1, 1));
        // One track and no dump. Nothing in scratch.
        assert_eq!(files_in(&tracks), vec![format!("{game_id}.cbtrack")]);
        assert_eq!(files_in(&recordings), Vec::<String>::new());
        assert_eq!(files_in(&scratch_root), Vec::<String>::new());
        // The run shows the playback moving and then the thinning.
        let phases: Vec<(RunPhase, i32)> = heard
            .lock()
            .unwrap()
            .iter()
            .filter_map(|s| s.running.as_ref())
            .map(|r| (r.phase, r.frame))
            .collect();
        let mut frames: Vec<i32> = phases
            .iter()
            .filter(|(phase, _)| *phase == RunPhase::Playing)
            .map(|(_, frame)| *frame)
            .collect();
        frames.dedup();
        assert!(frames.len() > 1, "progress never moved: {frames:?}");
        assert!(
            phases.iter().any(|(phase, _)| *phase == RunPhase::Thinning),
            "the thinning was never announced"
        );
        // The track is the replay's and names its game.
        let path = track_store::track_path(&tracks, &game_id).unwrap();
        assert_eq!(
            track_store::state(&tracks, &game_id).unwrap(),
            Some(track_store::TrackState::Current)
        );
        let raw = super::super::super::read_header_and_script(&replay).unwrap();
        let recorded_game =
            super::super::super::find_game(&super::super::super::parse_tdf(&raw.script))
                .get("gametype")
                .unwrap_or("")
                .to_string();
        let mut reader =
            TrackReader::open(std::io::BufReader::new(std::fs::File::open(&path).unwrap()))
                .unwrap();
        let (last_frame, bytes) = (
            reader.header().last_frame,
            std::fs::metadata(&path).unwrap().len(),
        );
        let info = reader.info().unwrap();
        assert_eq!(info.game, recorded_game);
        assert!(last_frame > 0);
        eprintln!(
            "recorded in {:.1}s (limit {}s): {} frames, track {} bytes\n\
             game: {}\nmap: {}\nengine: {}\nphases seen: {} playing steps, thinning announced",
            wall.as_secs_f64(),
            limit.as_secs(),
            last_frame,
            bytes,
            info.game,
            info.map,
            info.engine_version,
            frames.len(),
        );
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
                stream: super::super::super::super::retarget::tests::stream_with_game_data(
                    SCRIPT,
                    &[],
                ),
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

            let spec = job_for(
                &replay,
                &engine,
                vec![PathBuf::from("/content")],
                None,
                false,
            )
            .unwrap();

            assert_eq!(spec.game_id, super::ID);
            assert_eq!(spec.name, "match.sdfz");
            assert_eq!(spec.match_seconds, 50);
            assert!(!spec.force);
            assert_eq!(spec.kind, JobKind::Analyse);
        }

        /// An analysis compares the run with the replay's result, so it refuses
        /// a replay with none. A unit list run keeps nothing but the list.
        #[test]
        fn a_replay_with_no_recorded_game_over_can_still_be_read_for_its_unit_list() {
            let unfinished = DemoFixture {
                script: SCRIPT.into(),
                ..Default::default()
            };
            let (_dir, replay, engine) = world(unfinished.gzipped());

            let spec = unit_list_job_for(&replay, &engine, Vec::new(), None).unwrap();

            assert_eq!(spec.kind, JobKind::UnitList);
            assert_eq!(spec.game_id, super::ID);
            assert!(!spec.force);
            assert!(job_for(&replay, &engine, Vec::new(), None, false).is_err());
        }

        /// A replay binds to its game by name, so one recorded on the playback
        /// game cannot be told from the playback by anything but that name.
        #[test]
        fn a_replay_of_the_playback_game_is_refused_for_recording() {
            let script = SCRIPT.replace(
                "Some Game 1.0",
                &super::super::super::super::playback::gametype(),
            );
            let playback = DemoFixture {
                script: script.clone(),
                stream: super::super::super::super::retarget::tests::stream_with_game_data(
                    &script,
                    &[],
                ),
                ..finished()
            };
            let (_dir, replay, engine) = world(playback.gzipped());

            assert_eq!(check_replay(&replay), Err(CannotAnalyse::PlaybackGame));
            let err = job_for(&replay, &engine, Vec::new(), None, false).unwrap_err();
            assert!(err.contains("recorded on the playback game"), "{err}");
            assert_eq!(
                serde_json::to_value(CannotAnalyse::PlaybackGame).unwrap(),
                "playbackGame"
            );
        }

        #[test]
        fn a_replay_that_cannot_be_analysed_is_refused_with_the_reason() {
            let unfinished = DemoFixture {
                script: SCRIPT.into(),
                ..Default::default()
            };
            let (_dir, replay, engine) = world(unfinished.gzipped());
            let err = job_for(&replay, &engine, Vec::new(), None, false).unwrap_err();
            assert!(err.contains("never recorded a game over"), "{err}");

            let no_id = DemoFixture {
                game_id: [0; 16],
                ..finished()
            };
            let (_dir, replay, engine) = world(no_id.gzipped());
            let err = job_for(&replay, &engine, Vec::new(), None, false).unwrap_err();
            assert!(err.contains("no game id"), "{err}");

            let (dir, replay, engine) = world(finished().gzipped());
            let remix =
                super::super::super::super::rewrite_demo(&replay, "Other Game", None).unwrap();
            let err = job_for(&remix, &engine, Vec::new(), None, false).unwrap_err();
            assert!(err.contains("remix"), "{err}");

            let err = job_for(
                &replay,
                &dir.path().join("no-engine"),
                Vec::new(),
                None,
                false,
            )
            .unwrap_err();
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

    #[test]
    fn only_engine_folders_with_a_headless_binary_are_offered() {
        let dir = tempfile::tempdir().unwrap();
        let with = dir.path().join("with");
        let without = dir.path().join("without");
        std::fs::create_dir_all(&with).unwrap();
        std::fs::create_dir_all(&without).unwrap();
        std::fs::write(super::super::launch::headless_binary(&with), b"").unwrap();
        let paths = |dirs: &[&Path]| -> Vec<String> {
            dirs.iter()
                .map(|d| d.to_string_lossy().into_owned())
                .collect()
        };

        let missing = dir.path().join("missing");
        let offered = headless_engines(paths(&[&without, &with, &missing]));

        assert_eq!(offered, paths(&[&with]));
        assert!(headless_engines(Vec::new()).is_empty());
    }
}
