//! The worker as a process that stays running, against a library that
//! initialises (issue #3722).
//!
//! The unit tests count calls on a stand-in inside the worker's own process.
//! These start the real binary with `--serve`, have it load
//! `examples/fake_unitsync.rs` as its `libunitsync`, and talk to it over its
//! pipes the way the plugin does. The stand-in reads its maps from the disk
//! during `Init` and at no other time, as the engine does, so whether an `Init`
//! was reused or run again shows in the answers and not only in a count.

use coilbox_unitsync_worker::protocol::{self, ReplyHead, Request};
use std::io::BufReader;
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};
use std::time::{Duration, Instant};

const TOKEN: &str = "a-token-for-the-serve-tests";

/// The stand-in library, which `cargo test` builds beside the test binaries:
/// they are in `target/<profile>/deps` and examples in `target/<profile>/examples`.
fn fake_library() -> PathBuf {
    let mut path = std::env::current_exe().expect("a test binary knows where it is");
    path.pop();
    if path.ends_with("deps") {
        path.pop();
    }
    path.push("examples");
    path.push(format!(
        "{}fake_unitsync{}",
        std::env::consts::DLL_PREFIX,
        std::env::consts::DLL_SUFFIX
    ));
    assert!(
        path.exists(),
        "no stand-in library at {}. A whole `cargo test` builds it, and a run narrowed to \
         `--test serve` does not: `cargo build -p coilbox-unitsync-worker --example fake_unitsync`",
        path.display()
    );
    path
}

/// A data directory with one map in it, and a log for the stand-in to write.
struct World {
    dir: PathBuf,
}

impl World {
    fn new(tag: &str) -> World {
        let dir = Path::new(env!("CARGO_TARGET_TMPDIR")).join(format!("serve-{tag}"));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("maps")).expect("maps folder");
        let world = World { dir };
        world.add_map("alpha");
        // A worker trusts its first `Init` only when nothing in the scanned
        // folders is as new as the second that `Init` started in. So let that
        // second pass before any worker starts.
        std::thread::sleep(Duration::from_millis(1100));
        world
    }

    fn add_map(&self, name: &str) {
        std::fs::write(self.dir.join("maps").join(format!("{name}.sd7")), b"a map").expect("map");
    }

    fn log_path(&self) -> PathBuf {
        self.dir.join("calls.log")
    }

    fn log(&self) -> Vec<String> {
        std::fs::read_to_string(self.log_path())
            .unwrap_or_default()
            .lines()
            .map(str::to_string)
            .collect()
    }

    fn calls(&self, name: &str) -> usize {
        self.log().iter().filter(|line| *line == name).count()
    }

    /// Wait for the stand-in to have logged `name`.
    fn wait_for_call(&self, name: &str) {
        let start = Instant::now();
        while self.calls(name) == 0 {
            assert!(
                start.elapsed() < Duration::from_secs(30),
                "the library was never asked for {name}. It logged {:?}",
                self.log()
            );
            std::thread::sleep(Duration::from_millis(10));
        }
    }

    /// The arguments every run starts with.
    fn base(&self) -> Vec<String> {
        vec![
            "--lib".to_string(),
            fake_library().to_string_lossy().into_owned(),
            "--datadir".to_string(),
            self.dir.to_string_lossy().into_owned(),
        ]
    }

    fn command(&self, envs: &[(&str, &str)]) -> Command {
        let mut cmd = Command::new(env!("CARGO_BIN_EXE_coilbox-unitsync-worker"));
        cmd.env("FAKE_UNITSYNC_DATADIR", &self.dir)
            .env("FAKE_UNITSYNC_LOG", self.log_path())
            .env(protocol::TOKEN_ENV, TOKEN);
        for (key, value) in envs {
            cmd.env(key, value);
        }
        cmd
    }

    fn serve(&self, envs: &[(&str, &str)]) -> Worker {
        let mut child = self
            .command(envs)
            .arg(protocol::SERVE_FLAG)
            .args(self.base())
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .spawn()
            .expect("start the worker");
        Worker {
            stdin: child.stdin.take(),
            stdout: BufReader::new(child.stdout.take().expect("stdout")),
            child,
            base: self.base(),
            next_id: 1,
        }
    }
}

struct Worker {
    child: Child,
    stdin: Option<ChildStdin>,
    stdout: BufReader<ChildStdout>,
    base: Vec<String>,
    next_id: u64,
}

impl Worker {
    /// Send a scan without waiting for its answer.
    fn send_scan(&mut self) -> u64 {
        let id = self.next_id;
        self.next_id += 1;
        let request = Request {
            id,
            args: self.base.clone(),
        };
        protocol::write_request(self.stdin.as_mut().expect("open input"), &request)
            .expect("send the request");
        id
    }

    /// Scan, and return the reply's header with the map names it lists.
    fn scan(&mut self) -> (ReplyHead, Vec<String>) {
        let id = self.send_scan();
        let (head, payload) = protocol::read_reply(&mut self.stdout, TOKEN)
            .expect("a readable reply")
            .expect("a reply before the output closed");
        assert_eq!(head.id, id);
        (head, map_names(&payload))
    }

    /// Close the worker's input and wait for it to exit, returning how long
    /// that took. Kills it after a minute so a worker that never exits fails
    /// the test and does not hang it.
    fn close_and_wait(&mut self) -> Duration {
        let closed = Instant::now();
        self.stdin = None;
        loop {
            if let Some(status) = self.child.try_wait().expect("wait") {
                assert!(status.success(), "the worker exited with {status}");
                return closed.elapsed();
            }
            if closed.elapsed() > Duration::from_secs(60) {
                let _ = self.child.kill();
                panic!("the worker was still running a minute after its input closed");
            }
            std::thread::sleep(Duration::from_millis(10));
        }
    }
}

impl Drop for Worker {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

fn map_names(scan: &[u8]) -> Vec<String> {
    let json: serde_json::Value = serde_json::from_slice(scan).expect("the scan is JSON");
    let errors = json["errors"].as_array().cloned().unwrap_or_default();
    assert!(errors.is_empty(), "the scan reported {errors:?}");
    json["maps"]
        .as_array()
        .expect("a list of maps")
        .iter()
        .map(|map| map["name"].as_str().expect("a name").to_string())
        .collect()
}

#[test]
fn ten_reads_share_one_init_and_uninit_runs_once_on_the_way_out() {
    let world = World::new("share");
    let mut worker = world.serve(&[]);
    for read in 0..10 {
        let (head, maps) = worker.scan();
        assert_eq!(maps, ["alpha"]);
        assert_eq!(
            head.init.is_some(),
            read == 0,
            "only the first read reports an Init"
        );
    }
    assert_eq!(
        world.calls("UnInit"),
        0,
        "UnInit waits for the worker to exit"
    );
    worker.close_and_wait();
    assert_eq!(world.calls("Init end"), 1);
    assert_eq!(world.calls("UnInit"), 1);
    assert!(
        world.calls("RemoveAllArchives") >= 10,
        "the file system is emptied for each read: {:?}",
        world.log()
    );
}

#[test]
fn a_map_added_while_the_worker_runs_is_seen_at_the_cost_of_one_init() {
    let world = World::new("new-map");
    let mut worker = world.serve(&[]);
    assert_eq!(worker.scan().1, ["alpha"]);
    assert_eq!(worker.scan().1, ["alpha"]);

    world.add_map("bravo");
    let (head, maps) = worker.scan();
    // The library only looks at the disk in `Init`, so `bravo` being here is
    // an `Init` having run.
    assert_eq!(maps, ["alpha", "bravo"]);
    assert!(head.init.is_some());

    let (head, maps) = worker.scan();
    assert_eq!(maps, ["alpha", "bravo"]);
    assert!(head.init.is_none(), "and only the one");
    assert_eq!(world.calls("Init end"), 2);
}

#[test]
fn a_one_shot_run_still_inits_reads_and_uninits() {
    let world = World::new("one-shot");
    let out = world
        .command(&[])
        .args(world.base())
        .output()
        .expect("run the worker");
    assert!(out.status.success());
    assert_eq!(map_names(&out.stdout), ["alpha"]);
    assert_eq!(world.calls("Init end"), 1);
    assert_eq!(world.calls("UnInit"), 1);
}

#[test]
fn closing_the_input_in_the_middle_of_a_read_does_not_wait_for_the_read() {
    let world = World::new("mid-read");
    // A read that takes two minutes, so a worker that waited for it would
    // outlast `close_and_wait`.
    let mut worker = world.serve(&[("FAKE_UNITSYNC_READ_MS", "120000")]);
    worker.send_scan();
    world.wait_for_call("GetMapCount");
    worker.close_and_wait();
    assert_eq!(world.calls("Init end"), 1);
    assert_eq!(
        world.calls("UnInit"),
        0,
        "it left without waiting to tidy up, since nobody is left to answer"
    );
}

#[test]
fn closing_the_input_in_the_middle_of_init_lets_init_finish() {
    let world = World::new("mid-init");
    let mut worker = world.serve(&[
        ("FAKE_UNITSYNC_INIT_MS", "1500"),
        ("FAKE_UNITSYNC_READ_MS", "120000"),
    ]);
    worker.send_scan();
    world.wait_for_call("Init begin");
    let took = worker.close_and_wait();
    // `Init` rewrites the archive cache, and a worker that exited part way
    // through would leave it cut short for every other process.
    assert_eq!(
        world.calls("Init end"),
        1,
        "Init ran to its end before the worker exited: {:?}",
        world.log()
    );
    assert!(
        took >= Duration::from_millis(1000),
        "it waited for Init, and exited after {took:?}"
    );
}
