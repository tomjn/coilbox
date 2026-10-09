//! Workers that stay running, and the queue in front of each (issue #3722).
//!
//! A read used to start a worker process of its own, and every one of them
//! loaded the engine's library and ran `Init` before it could answer. A worker
//! started with `--serve` answers one request after another on one `Init`. This
//! file is the plugin's end of that: it starts the worker, sends it a request,
//! waits for the reply, and replaces it when it has gone wrong. The frames are
//! `coilbox_unitsync_worker::protocol`.
//!
//! # One request at a time
//!
//! unitsync is one instance per process, so a worker answers requests in turn
//! and a [`Lane`] is the queue for one worker. Requests are served in the order
//! they arrived. A worker is only ever sent a request once the one before it
//! has been answered or the worker has been killed, so a reply on the pipe can
//! only be the answer to the request in hand. Its id is checked all the same.
//!
//! # Cancel, timeout, crash
//!
//! All three end the same way: the worker is killed, the request fails, and the
//! next request starts a fresh worker. A read inside unitsync is a C call with
//! nowhere to stop it, so killing the process is the only cancel there is. And a
//! process that has been killed cannot answer late, or leave unitsync half way
//! through something for the next request to find.
//!
//! # Exit
//!
//! The plugin closes a worker's input once it has sat idle for [`IDLE_EXIT`],
//! and the worker exits when its input closes. That is also what happens when
//! coilbox quits or crashes, since the pipe closes with the process. The quiet
//! spell is timed here rather than in the worker so the two cannot disagree
//! about whether a request is on its way.

use coilbox_unitsync_worker::protocol::{self, InitTiming, ReplyHead, Request};
use std::collections::{HashMap, VecDeque};
use std::hash::{BuildHasher, Hasher};
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError};
use std::sync::{Arc, Condvar, Mutex, MutexGuard, OnceLock};
use std::time::{Duration, Instant};

/// How long a worker sits idle before it is shut down: the longest any one read
/// is allowed to run (`SCAN_TIMEOUT`), so a worker that has been quiet that long
/// is not part of anything still on screen.
pub const IDLE_EXIT: Duration = crate::SCAN_TIMEOUT;

/// How long a worker is given to exit once its input is closed, before it is
/// killed. A clean exit runs `UnInit`, which queues for the engine's init lock
/// for up to this long (`initlock::WAIT` in the worker) before going ahead.
const EXIT_GRACE: Duration = Duration::from_secs(60);

/// How often a worker whose output has closed is asked whether it has exited
/// yet. It is in its exit path by then, so this runs a handful of times.
const EXIT_POLL: Duration = Duration::from_millis(5);

/// How often a request that can be cancelled looks at its cancel flag while it
/// waits. The reply itself is not polled for: it wakes the wait when it lands.
const CANCEL_POLL: Duration = Duration::from_millis(50);

/// Which of an engine's two workers a read goes to.
///
/// One worker would be enough for correctness. There are two because a walk of
/// the whole library can run for a long time when coilbox's own caches are
/// empty: measured on 103 maps and 30 games, thumbnails took 27.9s, map
/// metadata 14.4s and game headers 3.6s. A page the user has just opened must
/// not queue behind that.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Kind {
    /// A read of one map, game or archive, for a page.
    Page,
    /// A walk of every map or every game.
    Library,
}

impl Kind {
    /// For the dev log.
    #[cfg(debug_assertions)]
    pub fn name(self) -> &'static str {
        match self {
            Kind::Page => "page",
            Kind::Library => "library",
        }
    }
}

/// One read to send to a worker.
pub struct Job<'a> {
    /// The arguments a one-shot worker would be started with.
    pub args: &'a [String],
    pub timeout: Duration,
    /// Names the read in error messages.
    pub what: &'a str,
    pub cancel: Option<&'a AtomicBool>,
}

/// A request a worker answered.
#[derive(Debug)]
pub struct Served {
    /// The exit code a one-shot worker would have ended with.
    pub code: i32,
    pub output: Vec<u8>,
    /// Set when the worker ran `Init` to answer this.
    pub init: Option<InitTiming>,
    /// Set when this request started the worker process, to its pid.
    pub started: Option<u32>,
}

/// Starts a worker process, given the token it must put on its replies.
type Spawn = Box<dyn Fn(&str) -> std::io::Result<Child> + Send + Sync>;

/// One worker and the requests waiting for it.
pub struct Lane {
    spawn: Spawn,
    idle_exit: Duration,
    state: Mutex<State>,
    changed: Condvar,
}

#[derive(Default)]
struct State {
    /// Requests in arrival order. The one at the front is being served.
    waiting: VecDeque<u64>,
    next_ticket: u64,
    /// The worker, when no request has it.
    worker: Option<Worker>,
    idle_since: Option<Instant>,
    /// Whether a thread is watching for the worker to go idle.
    watched: bool,
}

struct Worker {
    child: Child,
    /// `None` once it has been closed, which is how the worker is told to exit.
    stdin: Option<ChildStdin>,
    events: Receiver<Event>,
    next_id: u64,
    /// What the worker has written to its standard error since the request in
    /// hand was sent, for the message when it dies.
    stderr: Arc<Mutex<String>>,
    stderr_reader: Option<std::thread::JoinHandle<()>>,
}

enum Event {
    Reply(ReplyHead, Vec<u8>),
    /// The worker's output closed. With a reason when what closed it was a frame
    /// that did not read as one.
    Closed(Option<String>),
}

/// The engine's worker of this kind, started on first use.
pub fn lane(
    bin: &Path,
    lib: &str,
    datadir: &str,
    envs: &[(String, String)],
    kind: Kind,
) -> Arc<Lane> {
    type Key = (PathBuf, String, String, Vec<(String, String)>, Kind);
    static LANES: OnceLock<Mutex<HashMap<Key, Arc<Lane>>>> = OnceLock::new();
    let key: Key = (
        bin.to_path_buf(),
        lib.to_string(),
        datadir.to_string(),
        envs.to_vec(),
        kind,
    );
    let mut lanes = LANES
        .get_or_init(Default::default)
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    lanes
        .entry(key)
        .or_insert_with(|| {
            let (bin, lib, datadir, envs) = (
                bin.to_path_buf(),
                lib.to_string(),
                datadir.to_string(),
                envs.to_vec(),
            );
            Lane::new(
                Box::new(move |token| {
                    // `coilbox_proc::command` leaves the worker in coilbox's
                    // Job Object on Windows, so it dies with coilbox and an
                    // update can replace its file.
                    let mut cmd = coilbox_proc::command(&bin);
                    cmd.arg(protocol::SERVE_FLAG)
                        .args(["--lib", &lib, "--datadir", &datadir])
                        .env(protocol::TOKEN_ENV, token);
                    for (k, v) in &envs {
                        cmd.env(k, v);
                    }
                    spawn_piped(cmd)
                }),
                IDLE_EXIT,
            )
        })
        .clone()
}

/// Start `cmd` with all three of its streams piped.
fn spawn_piped(mut cmd: Command) -> std::io::Result<Child> {
    cmd.stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
}

/// A token no archive could guess: 128 bits from the standard library's
/// randomly keyed hasher, which the operating system seeds.
fn new_token() -> String {
    let random = || {
        std::collections::hash_map::RandomState::new()
            .build_hasher()
            .finish()
    };
    format!("{:016x}{:016x}", random(), random())
}

impl Lane {
    fn new(spawn: Spawn, idle_exit: Duration) -> Arc<Lane> {
        Arc::new(Lane {
            spawn,
            idle_exit,
            state: Mutex::new(State::default()),
            changed: Condvar::new(),
        })
    }

    fn lock(&self) -> MutexGuard<'_, State> {
        self.state.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// Send one read to the worker and wait for its answer.
    ///
    /// `Err` is a read that got no answer, with the reason: cancelled, timed
    /// out, or a worker that died or stopped making sense. Each of those leaves
    /// the lane without a worker, and the next call starts one.
    pub fn run(self: &Arc<Self>, job: &Job) -> Result<Served, String> {
        let mut turn = self.wait_for_turn(job)?;
        // A worker that died while it sat idle, killed by hand say, is replaced
        // here without the request ever knowing.
        let mut kept = turn.worker.take();
        if kept.as_mut().is_some_and(|worker| !worker.is_alive()) {
            kept = None;
        }
        let (mut worker, started) = match kept {
            Some(worker) => (worker, None),
            None => {
                let worker = Worker::start(&self.spawn)?;
                let pid = worker.child.id();
                (worker, Some(pid))
            }
        };
        let (head, output) = worker.ask(job)?;
        // Only a worker that answered is kept. Every `Err` above dropped it,
        // which kills it.
        turn.worker = Some(worker);
        Ok(Served {
            code: head.code,
            output,
            init: head.init,
            started,
        })
    }

    /// Queue behind the requests already here, and return once this one is at
    /// the front, holding the worker.
    fn wait_for_turn(self: &Arc<Self>, job: &Job) -> Result<Turn, String> {
        let mut state = self.lock();
        let ticket = state.next_ticket;
        state.next_ticket += 1;
        state.waiting.push_back(ticket);
        loop {
            if state.waiting.front() == Some(&ticket) {
                return Ok(Turn {
                    lane: self.clone(),
                    ticket,
                    worker: state.worker.take(),
                });
            }
            if job.cancel.is_some_and(|c| c.load(Ordering::Relaxed)) {
                state.waiting.retain(|t| *t != ticket);
                self.changed.notify_all();
                return Err(format!("unitsync {} cancelled", job.what));
            }
            state = match job.cancel {
                Some(_) => {
                    self.changed
                        .wait_timeout(state, CANCEL_POLL)
                        .unwrap_or_else(|e| e.into_inner())
                        .0
                }
                None => self.changed.wait(state).unwrap_or_else(|e| e.into_inner()),
            };
        }
    }

    /// Shut the worker down once it has sat idle for the lane's idle period.
    /// Runs on a thread of its own, which ends when the lane has no worker.
    fn watch_for_idle(self: Arc<Self>) {
        let mut state = self.lock();
        loop {
            if !state.waiting.is_empty() {
                // A request has the worker. Its turn ending wakes this.
                state = self.changed.wait(state).unwrap_or_else(|e| e.into_inner());
                continue;
            }
            let Some(since) = state.worker.as_ref().and(state.idle_since) else {
                state.watched = false;
                return;
            };
            let idle = since.elapsed();
            if idle < self.idle_exit {
                state = self
                    .changed
                    .wait_timeout(state, self.idle_exit - idle)
                    .unwrap_or_else(|e| e.into_inner())
                    .0;
                continue;
            }
            let worker = state.worker.take();
            state.watched = false;
            drop(state);
            if let Some(worker) = worker {
                worker.shut_down();
            }
            return;
        }
    }
}

/// A request's place at the front of the queue. Dropping it hands the worker
/// back, if the request left one, and lets the next request go.
struct Turn {
    lane: Arc<Lane>,
    ticket: u64,
    worker: Option<Worker>,
}

impl Drop for Turn {
    fn drop(&mut self) {
        let mut state = self.lane.lock();
        state.waiting.retain(|t| *t != self.ticket);
        state.worker = self.worker.take();
        state.idle_since = Some(Instant::now());
        if state.worker.is_some() && !state.watched {
            state.watched = true;
            let lane = self.lane.clone();
            std::thread::spawn(move || lane.watch_for_idle());
        }
        self.lane.changed.notify_all();
    }
}

impl Worker {
    fn start(spawn: &Spawn) -> Result<Worker, String> {
        let token = new_token();
        let mut child =
            spawn(&token).map_err(|e| format!("failed to start unitsync worker: {e}"))?;
        let (Some(stdin), Some(stdout), Some(stderr)) =
            (child.stdin.take(), child.stdout.take(), child.stderr.take())
        else {
            let _ = child.kill();
            let _ = child.wait();
            return Err("failed to start unitsync worker: its pipes are missing".into());
        };

        let (tx, events) = mpsc::channel();
        std::thread::spawn(move || {
            let mut stdout = BufReader::new(stdout);
            loop {
                let event = match protocol::read_reply(&mut stdout, &token) {
                    Ok(Some((head, payload))) => Event::Reply(head, payload),
                    Ok(None) => Event::Closed(None),
                    Err(e) => Event::Closed(Some(e.to_string())),
                };
                let closed = matches!(event, Event::Closed(_));
                if tx.send(event).is_err() || closed {
                    return;
                }
            }
        });

        let said = Arc::new(Mutex::new(String::new()));
        let keep = said.clone();
        let stderr_reader = std::thread::spawn(move || {
            for line in BufReader::new(stderr).lines().map_while(Result::ok) {
                #[cfg(debug_assertions)]
                eprintln!("[unitsync-worker stderr] {line}");
                let mut kept = keep.lock().unwrap_or_else(|e| e.into_inner());
                kept.push_str(&line);
                kept.push('\n');
            }
        });

        Ok(Worker {
            child,
            stdin: Some(stdin),
            events,
            next_id: 1,
            stderr: said,
            stderr_reader: Some(stderr_reader),
        })
    }

    fn is_alive(&mut self) -> bool {
        matches!(self.child.try_wait(), Ok(None))
    }

    /// Send `job` and wait for its reply. After an `Err` the worker is of no
    /// further use and the caller drops it, which kills it.
    fn ask(&mut self, job: &Job) -> Result<(ReplyHead, Vec<u8>), String> {
        let id = self.next_id;
        self.next_id += 1;
        self.stderr
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clear();
        let request = Request {
            id,
            args: job.args.to_vec(),
        };
        let sent = match self.stdin.as_mut() {
            Some(stdin) => protocol::write_request(stdin, &request),
            None => Err(std::io::ErrorKind::BrokenPipe.into()),
        };
        if let Err(e) = sent {
            return Err(self.gone(job.what, &format!("would not take a request ({e})")));
        }

        let deadline = Instant::now() + job.timeout;
        loop {
            if job.cancel.is_some_and(|c| c.load(Ordering::Relaxed)) {
                return Err(format!("unitsync {} cancelled", job.what));
            }
            let left = deadline.saturating_duration_since(Instant::now());
            if left.is_zero() {
                return Err(crate::fmt_timeout(job.what, job.timeout));
            }
            let wait = match job.cancel {
                Some(_) => left.min(CANCEL_POLL),
                None => left,
            };
            match self.events.recv_timeout(wait) {
                Ok(Event::Reply(head, output)) if head.id == id => return Ok((head, output)),
                Ok(Event::Reply(head, _)) => {
                    return Err(format!(
                        "unitsync worker answered request {} when {} was request {id}",
                        head.id, job.what
                    ));
                }
                Ok(Event::Closed(Some(why))) => {
                    let _ = self.child.kill();
                    let how = format!("sent a reply that cannot be read ({why})");
                    return Err(self.gone(job.what, &how));
                }
                Ok(Event::Closed(None)) | Err(RecvTimeoutError::Disconnected) => {
                    return Err(self.gone(job.what, "exited"));
                }
                Err(RecvTimeoutError::Timeout) => {}
            }
        }
    }

    /// The error for a worker whose output has closed: what it did, how it
    /// ended, and what it wrote to its standard error on the way.
    fn gone(&mut self, what: &str, how: &str) -> String {
        self.stdin = None;
        let ended = match self.wait_for_exit(EXIT_GRACE) {
            Some(status) => match status.code() {
                Some(code) => format!("exit {code}"),
                None => "terminated by signal".into(),
            },
            None => "it had to be killed".into(),
        };
        // Its standard error closed when it exited, so this is all of it.
        if let Some(reader) = self.stderr_reader.take() {
            let _ = reader.join();
        }
        let said = self.stderr.lock().unwrap_or_else(|e| e.into_inner());
        let said = said.trim();
        if said.is_empty() {
            format!("unitsync worker {how} during {what} ({ended})")
        } else {
            format!("unitsync worker {how} during {what} ({ended}): {said}")
        }
    }

    /// Close the worker's input, which tells it to run `UnInit` and exit, and
    /// kill it if it has not gone within [`EXIT_GRACE`].
    fn shut_down(mut self) {
        self.stdin = None;
        self.wait_for_exit(EXIT_GRACE);
    }

    /// Wait up to `grace` for the worker to exit by itself, then make sure it
    /// has gone. `None` when it had to be killed.
    fn wait_for_exit(&mut self, grace: Duration) -> Option<std::process::ExitStatus> {
        let deadline = Instant::now() + grace;
        // Its output closing is the sign it is on its way out, and that wakes
        // this without polling.
        loop {
            let left = deadline.saturating_duration_since(Instant::now());
            match self.events.recv_timeout(left) {
                Ok(Event::Reply(..)) => {}
                Ok(Event::Closed(_)) | Err(RecvTimeoutError::Disconnected) => break,
                Err(RecvTimeoutError::Timeout) => break,
            }
        }
        // From there to the process being gone is its exit path.
        while Instant::now() < deadline {
            if let Ok(Some(status)) = self.child.try_wait() {
                return Some(status);
            }
            std::thread::sleep(EXIT_POLL);
        }
        let _ = self.child.kill();
        let _ = self.child.wait();
        None
    }
}

impl Drop for Worker {
    /// A worker is dropped when its request failed, when it has been shut down,
    /// or when its lane goes. In none of those may it be left running. Killing
    /// one that has already exited does nothing.
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The worker these tests talk to: this test binary, run again as a child
    /// with `FAKE_WORKER` set. It speaks the real protocol and misbehaves on
    /// request, where the request's first argument says how.
    ///
    /// Not a test. It is marked ignored so a normal run skips it, and the
    /// children are started with `--ignored --exact` to reach it. The test
    /// harness prints its own lines around it on standard output, which every
    /// test here therefore has to read past, as it would the engine's.
    #[test]
    #[ignore = "the fake worker the other tests start, not a test"]
    fn fake_worker() {
        if std::env::var_os("FAKE_WORKER").is_none() {
            return;
        }
        use std::io::Write;
        let token = std::env::var(protocol::TOKEN_ENV).expect("a token");
        let pid = std::process::id();
        let mut input = std::io::stdin().lock();
        let mut out = std::io::stdout();
        let reply = |out: &mut std::io::Stdout, id: u64, token: &str, text: &str| {
            let head = ReplyHead {
                id,
                code: 0,
                init: None,
            };
            protocol::write_reply(out, token, &head, text.as_bytes()).unwrap();
        };
        while let Ok(Some(request)) = protocol::read_request(&mut input) {
            let how = request.args.first().map(String::as_str).unwrap_or("");
            let said = request.args.get(1).cloned().unwrap_or_default();
            let echo = format!("{pid} {said}");
            match how {
                "echo" => reply(&mut out, request.id, &token, &echo),
                "slow" => {
                    std::thread::sleep(Duration::from_millis(300));
                    reply(&mut out, request.id, &token, &echo);
                }
                "noisy" => {
                    // What an engine might print, then a whole frame under a
                    // token that is not this worker's, then the real answer.
                    print!("Scanning: /maps\nhalf a line with no end");
                    out.flush().unwrap();
                    reply(&mut out, request.id, "not-the-token", "forged");
                    reply(&mut out, request.id, &token, &echo);
                }
                "crash" => {
                    eprintln!("unitsync aborted on a bad archive");
                    std::process::exit(3);
                }
                "hang" => loop {
                    std::thread::sleep(Duration::from_secs(60));
                },
                "garbage" => {
                    println!("\n{} {token} this is not a header", protocol::MARKER);
                    loop {
                        std::thread::sleep(Duration::from_secs(60));
                    }
                }
                "wrong-id" => {
                    reply(&mut out, request.id + 1000, &token, &echo);
                    loop {
                        std::thread::sleep(Duration::from_secs(60));
                    }
                }
                "cut-short" => {
                    print!(
                        "\n{} {token} {{\"id\":{},\"code\":0,\"len\":4096}}\nonly this much",
                        protocol::MARKER,
                        request.id
                    );
                    out.flush().unwrap();
                    std::process::exit(0);
                }
                "answer-then-die" => {
                    reply(&mut out, request.id, &token, &echo);
                    std::process::exit(0);
                }
                other => panic!("the fake worker was asked to {other}"),
            }
        }
        // The input closed: exit, as the real worker does.
        std::process::exit(0);
    }

    fn fake_lane(idle_exit: Duration) -> Arc<Lane> {
        Lane::new(
            Box::new(|token| {
                let mut cmd = Command::new(std::env::current_exe()?);
                cmd.args([
                    "pool::tests::fake_worker",
                    "--exact",
                    "--ignored",
                    "--nocapture",
                ])
                .env("FAKE_WORKER", "1")
                .env(protocol::TOKEN_ENV, token);
                spawn_piped(cmd)
            }),
            idle_exit,
        )
    }

    const LONG: Duration = Duration::from_secs(30);

    fn ask_for(
        lane: &Arc<Lane>,
        how: &str,
        said: &str,
        timeout: Duration,
        cancel: Option<&AtomicBool>,
    ) -> Result<Served, String> {
        let args = vec![how.to_string(), said.to_string()];
        lane.run(&Job {
            args: &args,
            timeout,
            what: "test read",
            cancel,
        })
    }

    /// Ask the fake worker to do `how`, and split its `"<pid> <said>"` answer.
    fn ask(lane: &Arc<Lane>, how: &str, said: &str) -> Result<(u32, String), String> {
        let served = ask_for(lane, how, said, LONG, None)?;
        let text = String::from_utf8(served.output).expect("utf8");
        let (pid, said) = text.split_once(' ').expect("a pid and the echo");
        Ok((pid.parse().expect("a pid"), said.to_string()))
    }

    /// Wait for the lane's idle worker to have exited, without reaping it the
    /// way a kill would, so the next request is the one that finds it dead.
    fn wait_until_idle_worker_exits(lane: &Arc<Lane>) {
        let start = Instant::now();
        loop {
            let alive = lane.lock().worker.as_mut().is_some_and(Worker::is_alive);
            if !alive {
                return;
            }
            assert!(start.elapsed() < Duration::from_secs(20));
            std::thread::sleep(Duration::from_millis(20));
        }
    }

    fn wait_until_gone(pid: u32) {
        let start = Instant::now();
        while coilbox_proc::is_running(pid) {
            assert!(
                start.elapsed() < Duration::from_secs(20),
                "worker {pid} is still running"
            );
            std::thread::sleep(Duration::from_millis(20));
        }
    }

    #[test]
    fn requests_are_answered_by_one_process() {
        let lane = fake_lane(LONG);
        let (first, said) = ask(&lane, "echo", "one").unwrap();
        assert_eq!(said, "one");
        for word in ["two", "three", "four"] {
            let (pid, said) = ask(&lane, "echo", word).unwrap();
            assert_eq!(said, word);
            assert_eq!(pid, first, "the same worker answered");
        }
    }

    #[test]
    fn only_the_first_request_reports_starting_the_worker() {
        let lane = fake_lane(LONG);
        let first = ask_for(&lane, "echo", "a", LONG, None).unwrap();
        let second = ask_for(&lane, "echo", "b", LONG, None).unwrap();
        assert!(first.started.is_some());
        assert!(second.started.is_none());
    }

    #[test]
    fn requests_sent_at_once_each_get_their_own_answer() {
        let lane = fake_lane(LONG);
        let threads: Vec<_> = (0..16)
            .map(|i| {
                let lane = lane.clone();
                std::thread::spawn(move || {
                    let word = format!("request-{i}");
                    let how = if i % 3 == 0 { "slow" } else { "echo" };
                    let (pid, said) = ask(&lane, how, &word).unwrap();
                    assert_eq!(said, word, "request {i} got another request's answer");
                    pid
                })
            })
            .collect();
        let pids: Vec<u32> = threads.into_iter().map(|t| t.join().unwrap()).collect();
        assert!(
            pids.iter().all(|p| *p == pids[0]),
            "one worker answered all of them: {pids:?}"
        );
    }

    #[test]
    fn what_the_worker_prints_is_not_taken_for_an_answer() {
        let lane = fake_lane(LONG);
        let (_, said) = ask(&lane, "noisy", "the real answer").unwrap();
        assert_eq!(said, "the real answer");
        // And the leftovers are not handed to the next request either.
        let (_, said) = ask(&lane, "echo", "next").unwrap();
        assert_eq!(said, "next");
    }

    #[test]
    fn a_crash_fails_the_request_and_the_next_starts_a_fresh_worker() {
        let lane = fake_lane(LONG);
        let (first, _) = ask(&lane, "echo", "before").unwrap();
        let err = ask(&lane, "crash", "").unwrap_err();
        assert!(err.contains("exited"), "got: {err}");
        assert!(err.contains("exit 3"), "got: {err}");
        assert!(
            err.contains("unitsync aborted on a bad archive"),
            "the worker's last words are in the error: {err}"
        );
        let (second, said) = ask(&lane, "echo", "after").unwrap();
        assert_eq!(said, "after");
        assert_ne!(first, second);
    }

    #[test]
    fn a_hang_times_out_and_the_next_starts_a_fresh_worker() {
        let lane = fake_lane(LONG);
        let (first, _) = ask(&lane, "echo", "before").unwrap();
        let started = Instant::now();
        let err = ask_for(&lane, "hang", "", Duration::from_millis(300), None).unwrap_err();
        assert!(err.contains("timed out"), "got: {err}");
        assert!(started.elapsed() < Duration::from_secs(10));
        wait_until_gone(first);
        let (second, said) = ask(&lane, "echo", "after").unwrap();
        assert_eq!(said, "after");
        assert_ne!(first, second);
    }

    #[test]
    fn a_reply_that_does_not_parse_fails_the_request() {
        let lane = fake_lane(LONG);
        let (first, _) = ask(&lane, "echo", "before").unwrap();
        let err = ask(&lane, "garbage", "").unwrap_err();
        assert!(err.contains("header does not parse"), "got: {err}");
        wait_until_gone(first);
        let (second, said) = ask(&lane, "echo", "after").unwrap();
        assert_eq!(said, "after");
        assert_ne!(first, second);
    }

    #[test]
    fn a_reply_to_another_request_fails_the_request() {
        let lane = fake_lane(LONG);
        let (first, _) = ask(&lane, "echo", "before").unwrap();
        let err = ask(&lane, "wrong-id", "not mine").unwrap_err();
        assert!(err.contains("answered request"), "got: {err}");
        wait_until_gone(first);
        let (_, said) = ask(&lane, "echo", "after").unwrap();
        assert_eq!(said, "after");
    }

    #[test]
    fn a_pipe_that_closes_mid_reply_fails_the_request() {
        let lane = fake_lane(LONG);
        let err = ask(&lane, "cut-short", "").unwrap_err();
        assert!(err.contains("middle of a reply"), "got: {err}");
        let (_, said) = ask(&lane, "echo", "after").unwrap();
        assert_eq!(said, "after");
    }

    #[test]
    fn a_worker_that_died_while_idle_is_replaced_without_an_error() {
        let lane = fake_lane(LONG);
        let (first, said) = ask(&lane, "answer-then-die", "last words").unwrap();
        assert_eq!(said, "last words");
        wait_until_idle_worker_exits(&lane);
        let (second, said) = ask(&lane, "echo", "after").unwrap();
        assert_eq!(said, "after");
        assert_ne!(first, second);
    }

    #[test]
    fn cancel_kills_the_worker_and_the_next_request_is_clean() {
        let lane = fake_lane(LONG);
        let (first, _) = ask(&lane, "echo", "before").unwrap();
        let cancel = Arc::new(AtomicBool::new(false));
        let canceller = {
            let cancel = cancel.clone();
            std::thread::spawn(move || {
                std::thread::sleep(Duration::from_millis(200));
                cancel.store(true, Ordering::Relaxed);
            })
        };
        let started = Instant::now();
        let err = ask_for(&lane, "hang", "", LONG, Some(&cancel)).unwrap_err();
        canceller.join().unwrap();
        assert_eq!(err, "unitsync test read cancelled");
        assert!(
            started.elapsed() < Duration::from_secs(10),
            "cancel does not wait for the read"
        );
        wait_until_gone(first);
        let (second, said) = ask(&lane, "echo", "after").unwrap();
        assert_eq!(said, "after", "the next request gets its own answer");
        assert_ne!(first, second);
    }

    #[test]
    fn a_request_cancelled_while_it_queues_leaves_the_worker_alone() {
        let lane = fake_lane(LONG);
        let (first, _) = ask(&lane, "echo", "before").unwrap();
        let slow = {
            let lane = lane.clone();
            std::thread::spawn(move || ask(&lane, "slow", "ahead in the queue"))
        };
        // Let the slow read reach the worker before the next one queues.
        std::thread::sleep(Duration::from_millis(100));
        let cancel = AtomicBool::new(true);
        let err = ask_for(&lane, "echo", "never sent", LONG, Some(&cancel)).unwrap_err();
        assert_eq!(err, "unitsync test read cancelled");
        let (pid, said) = slow.join().unwrap().unwrap();
        assert_eq!(said, "ahead in the queue");
        assert_eq!(pid, first, "the read in progress was not disturbed");
        let (pid, _) = ask(&lane, "echo", "after").unwrap();
        assert_eq!(pid, first);
    }

    #[test]
    fn an_idle_worker_exits_and_the_next_request_starts_another() {
        let lane = fake_lane(Duration::from_millis(200));
        let (first, _) = ask(&lane, "echo", "before").unwrap();
        wait_until_gone(first);
        let (second, said) = ask(&lane, "echo", "after").unwrap();
        assert_eq!(said, "after");
        assert_ne!(first, second);
    }

    #[test]
    fn a_worker_in_use_is_not_shut_down_for_being_idle() {
        let lane = fake_lane(Duration::from_millis(500));
        let (first, _) = ask(&lane, "echo", "before").unwrap();
        // Busy for longer than the idle period, with no gap to speak of.
        for _ in 0..3 {
            let (pid, said) = ask(&lane, "slow", "still here").unwrap();
            assert_eq!(said, "still here");
            assert_eq!(pid, first);
        }
    }

    #[test]
    fn a_worker_that_cannot_start_fails_the_request() {
        let lane = Lane::new(
            Box::new(|_| Command::new("/no/such/coilbox-unitsync-worker").spawn()),
            LONG,
        );
        let err = ask(&lane, "echo", "").unwrap_err();
        assert!(
            err.contains("failed to start unitsync worker"),
            "got: {err}"
        );
    }

    /// The worker binary itself, found the way `sidecar.rs`'s test finds it:
    /// test binaries sit in `target/<profile>/deps` and ordinary ones a level up.
    fn real_worker() -> PathBuf {
        let mut path = std::env::current_exe().expect("a test binary knows where it is");
        path.pop();
        if path.ends_with("deps") {
            path.pop();
        }
        path.push(format!(
            "coilbox-unitsync-worker{}",
            std::env::consts::EXE_SUFFIX
        ));
        assert!(
            path.exists(),
            "no worker at {}. Build it first with `cargo build -p coilbox-unitsync-worker`",
            path.display()
        );
        path
    }

    /// The real worker, end to end, without an engine: every read fails at
    /// loading the library, which is an answer like any other. What this checks
    /// is the loop around the reads.
    #[test]
    fn the_real_worker_answers_in_turn_and_exits_when_its_input_closes() {
        let lib = std::env::temp_dir()
            .join("coilbox-no-such-libunitsync")
            .to_string_lossy()
            .into_owned();
        let datadir = std::env::temp_dir().to_string_lossy().into_owned();
        let lane = {
            let (lib, datadir) = (lib.clone(), datadir.clone());
            Lane::new(
                Box::new(move |token| {
                    let mut cmd = Command::new(real_worker());
                    cmd.arg(protocol::SERVE_FLAG)
                        .args(["--lib", &lib, "--datadir", &datadir])
                        .env(protocol::TOKEN_ENV, token);
                    spawn_piped(cmd)
                }),
                Duration::from_millis(300),
            )
        };
        let read = |lib: &str, extra: &[&str]| {
            let mut args = vec![
                "--lib".to_string(),
                lib.to_string(),
                "--datadir".to_string(),
                datadir.clone(),
            ];
            args.extend(extra.iter().map(|a| a.to_string()));
            let served = lane
                .run(&Job {
                    args: &args,
                    timeout: LONG,
                    what: "test read",
                    cancel: None,
                })
                .expect("an answer");
            let json: serde_json::Value =
                serde_json::from_slice(&served.output).expect("the worker printed JSON");
            (served.started, json.to_string())
        };

        let (started, skybox) = read(&lib, &["--map-skybox", "--map", "Some Map"]);
        let pid = started.expect("the first read starts the worker");
        assert!(skybox.contains("failed to load"), "got: {skybox}");

        // Each of these is refused in words only its own request could have
        // caused, so an answer left over from another could not pass for it.
        for other in ["engine-two", "engine-three"] {
            let asked = format!("{lib}-{other}");
            let (started, refused) = read(&asked, &[]);
            assert!(started.is_none(), "the same worker answered");
            assert!(refused.contains("this worker reads"), "got: {refused}");
            assert!(refused.contains(other), "got: {refused}");
        }

        let (started, refused) = read(&lib, &["--config"]);
        assert!(started.is_none());
        assert!(
            refused.contains("not answered by a running worker"),
            "got: {refused}"
        );

        // Idle now, so the lane closes its input, and that is its cue to exit.
        wait_until_gone(pid);
    }

    #[test]
    fn tokens_differ() {
        assert_ne!(new_token(), new_token());
        assert_eq!(new_token().len(), 32);
    }
}
