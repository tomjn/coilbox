//! Starting Open Annihilation and reading what it says about itself (issue
//! #4944).
//!
//! Open Annihilation (OA) is started with `--status-stdout`, which makes it
//! write one JSON object per line to standard output: a `hello` line first, then
//! one line each for a screen change, the match starting or ending, the game
//! being over, and the process leaving. Each line becomes an [`OaEvent`] on the
//! channel the frontend gave the launch command.
//!
//! The program is spawned directly. `open -a` would lose both the arguments of a
//! second start and the stream.
//!
//! OA refuses an option or a launch by printing one line starting
//! `open-annihilation: ` on standard error and exiting with status 1 or 2 before
//! a window opens. That line is the error the launch command answers when the
//! process ends before `hello`. OA also refuses a player name over 16
//! characters, a game name over 16 and a password over 10. Coilbox does not
//! repeat those checks, so OA's own refusal is what the player reads.

use crate::{launch_result, ExitOutcome, POLL_INTERVAL};
use picoframe_core::CliResult;
use serde::Serialize;
use serde_json::{json, Map, Value};
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read};
use std::path::{Path, PathBuf};
use std::process::{Child, Stdio};
use std::sync::{Arc, Mutex};
use tauri::{ipc::Channel, State};

/// The running Open Annihilation, keyed by the frontend's run id like the
/// Recoil registry. OA's discovery port is one per machine, so this holds at
/// most one entry. A launch removes its own entry when the process exits.
pub(crate) type OaRegistry = Arc<Mutex<HashMap<String, Child>>>;

const STATUS_FLAG: &str = "--status-stdout";

/// What OA's refusal line on standard error starts with.
const REFUSAL_PREFIX: &str = "open-annihilation: ";

/// The fields every status line after `hello` carries, passed on as OA wrote
/// them. They are numbers, but coilbox does not need to know which kind.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Stamp {
    seq: Value,
    frame: Value,
    tick: Value,
}

/// One line of OA's status stream. Fields coilbox has no use for yet stay in
/// `rest` and reach the frontend unchanged, so a field OA adds later is not
/// lost on the way. `game_over` carries what the results page needs: its
/// `results` and, in `rest`, `outcome`, `winner` and whatever else OA reports.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum OaEvent {
    Hello {
        version: String,
        pid: u64,
        #[serde(flatten)]
        rest: Map<String, Value>,
    },
    Screen {
        #[serde(flatten)]
        stamp: Stamp,
        name: String,
        #[serde(flatten)]
        rest: Map<String, Value>,
    },
    /// `change` is `started` or `ended`. It is not narrowed to those two so a
    /// third value does not turn the line into something unreadable.
    Match {
        #[serde(flatten)]
        stamp: Stamp,
        change: String,
        #[serde(flatten)]
        rest: Map<String, Value>,
    },
    GameOver {
        #[serde(flatten)]
        stamp: Stamp,
        results: Vec<Value>,
        #[serde(flatten)]
        rest: Map<String, Value>,
    },
    /// `reason` is one of `game-ended`, `left`, `connection-lost`, `quit` and
    /// `refused`. A refusal after the stream began also has `code` in `rest`.
    Exit {
        #[serde(flatten)]
        stamp: Stamp,
        reason: String,
        #[serde(flatten)]
        rest: Map<String, Value>,
    },
    /// A line with an `event` coilbox does not know, or a known one whose
    /// fields were not the expected kind. The stream carries on.
    Unknown {
        event: String,
        #[serde(flatten)]
        stamp: Stamp,
        #[serde(flatten)]
        rest: Map<String, Value>,
    },
    /// A line that was not a JSON object with an `event`. OA writes nothing else
    /// to standard output, so seeing one means something is wrong.
    Unreadable { line: String },
}

/// Remove `key` from `map` only when it holds a string, so a field of the wrong
/// kind stays in the map for the event that falls back to [`OaEvent::Unknown`].
fn take_string(map: &mut Map<String, Value>, key: &str) -> Option<String> {
    if !matches!(map.get(key), Some(Value::String(_))) {
        return None;
    }
    match map.remove(key) {
        Some(Value::String(s)) => Some(s),
        _ => None,
    }
}

/// Turn one line of standard output into an event. `first` is true for the
/// first line, the only one that can be `hello`, which also passes when it has
/// no `event` field because only its `version` and `pid` are documented.
pub(crate) fn parse_line(text: &str, first: bool) -> OaEvent {
    let unreadable = || OaEvent::Unreadable {
        line: text.to_string(),
    };
    let Ok(Value::Object(mut map)) = serde_json::from_str::<Value>(text) else {
        return unreadable();
    };
    let event = match map.remove("event") {
        Some(Value::String(event)) => Some(event),
        None => None,
        Some(_) => return unreadable(),
    };

    if first && event.as_deref().is_none_or(|e| e == "hello") {
        let pid = map.get("pid").and_then(Value::as_u64);
        if let (Some(pid), Some(version)) = (pid, take_string(&mut map, "version")) {
            map.remove("pid");
            return OaEvent::Hello {
                version,
                pid,
                rest: map,
            };
        }
    }

    let Some(event) = event else {
        return unreadable();
    };
    let mut field = |key: &str| map.remove(key).unwrap_or(Value::Null);
    let stamp = Stamp {
        seq: field("seq"),
        frame: field("frame"),
        tick: field("tick"),
    };
    match event.as_str() {
        "screen" => {
            if let Some(name) = take_string(&mut map, "name") {
                return OaEvent::Screen {
                    stamp,
                    name,
                    rest: map,
                };
            }
        }
        "match" => {
            if let Some(change) = take_string(&mut map, "change") {
                return OaEvent::Match {
                    stamp,
                    change,
                    rest: map,
                };
            }
        }
        "game_over" => {
            if matches!(map.get("results"), Some(Value::Array(_))) {
                if let Some(Value::Array(results)) = map.remove("results") {
                    return OaEvent::GameOver {
                        stamp,
                        results,
                        rest: map,
                    };
                }
            }
        }
        "exit" => {
            if let Some(reason) = take_string(&mut map, "reason") {
                return OaEvent::Exit {
                    stamp,
                    reason,
                    rest: map,
                };
            }
        }
        _ => {}
    }
    OaEvent::Unknown {
        event,
        stamp,
        rest: map,
    }
}

/// What standard error said, kept without storing all of it: the first refusal
/// line, and the last line of any kind for a program that fails some other way.
#[derive(Default)]
struct StderrNotes {
    refusal: Option<String>,
    last: Option<String>,
}

/// Read standard error to its end. It is always drained, because a program
/// that fills the pipe stops writing and would never exit.
fn read_stderr(stderr: impl Read) -> StderrNotes {
    let mut notes = StderrNotes::default();
    for line in BufReader::new(stderr).split(b'\n') {
        let Ok(bytes) = line else { break };
        let text = String::from_utf8_lossy(&bytes);
        let text = text.trim();
        if text.is_empty() {
            continue;
        }
        if notes.refusal.is_none() {
            if let Some(reason) = text.strip_prefix(REFUSAL_PREFIX) {
                notes.refusal = Some(reason.to_string());
            }
        }
        notes.last = Some(text.to_string());
    }
    notes
}

/// What the launch answers when the process ended before `hello` without
/// success: OA's refusal line, else the last thing it said, else the status.
fn failure_before_hello(notes: StderrNotes, outcome: &ExitOutcome) -> String {
    notes
        .refusal
        .or(notes.last)
        .unwrap_or_else(|| match (outcome.code, outcome.signal) {
            (Some(code), _) => {
                format!("Open Annihilation exited with status {code} before it started.")
            }
            (None, Some(signal)) => {
                format!("Open Annihilation was stopped by signal {signal} before it started.")
            }
            (None, None) => "Open Annihilation ended before it started.".to_string(),
        })
}

/// Spawn OA and pass each status line to `on_event` until the process ends.
///
/// Answers `Ok(None)` when [`cancel`] ended it, as the Recoil launch does, and
/// the exit status otherwise. A process that ends without success before it
/// said `hello` is an error carrying OA's refusal line. Runs on a blocking
/// thread.
pub(crate) fn run_blocking(
    bin: &Path,
    args: &[String],
    run_id: &str,
    reg: &OaRegistry,
    mut on_event: impl FnMut(OaEvent),
) -> Result<Option<ExitOutcome>, String> {
    // The check and the insert share one hold of the lock, so two starts that
    // arrive together cannot both pass.
    let (stdout, stderr) = {
        let mut map = reg.lock().unwrap();
        if !map.is_empty() {
            return Err("Open Annihilation is already running.".to_string());
        }
        let mut cmd = coilbox_proc::command(bin);
        cmd.args(args);
        if !args.iter().any(|a| a == STATUS_FLAG) {
            cmd.arg(STATUS_FLAG);
        }
        cmd.stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        let mut child = cmd
            .spawn()
            .map_err(|e| format!("failed to launch Open Annihilation: {e}"))?;
        let stdout = child.stdout.take().expect("stdout was piped");
        let stderr = child.stderr.take().expect("stderr was piped");
        map.insert(run_id.to_string(), child);
        (stdout, std::thread::spawn(move || read_stderr(stderr)))
    };

    let mut seen_a_line = false;
    let mut said_hello = false;
    for line in BufReader::new(stdout).split(b'\n') {
        let Ok(bytes) = line else { break };
        let text = String::from_utf8_lossy(&bytes);
        let text = text.trim();
        if text.is_empty() {
            continue;
        }
        let event = parse_line(text, !seen_a_line);
        seen_a_line = true;
        said_hello |= matches!(event, OaEvent::Hello { .. });
        on_event(event);
    }

    // Standard output closes when the process ends, so this is normally one
    // check. The registry entry stays until then so a cancel can still find it.
    let outcome = loop {
        let exited = {
            let mut map = reg.lock().unwrap();
            match map.get_mut(run_id) {
                Some(child) => match child.try_wait().map_err(|e| e.to_string())? {
                    Some(status) => {
                        map.remove(run_id);
                        Some(ExitOutcome::from_status(&status))
                    }
                    None => None,
                },
                None => return Ok(None),
            }
        };
        if let Some(outcome) = exited {
            break outcome;
        }
        std::thread::sleep(POLL_INTERVAL);
    };

    let notes = stderr.join().unwrap_or_default();
    if !said_hello && (outcome.code != Some(0)) {
        return Err(failure_before_hello(notes, &outcome));
    }
    Ok(Some(outcome))
}

/// End the OA that `run_id` started. Answers whether there was one.
pub(crate) fn cancel(reg: &OaRegistry, run_id: &str) -> bool {
    let child = reg.lock().unwrap().remove(run_id);
    match child {
        Some(mut child) => {
            let _ = child.kill();
            let _ = child.wait();
            true
        }
        None => false,
    }
}

/// `play_oa_launch` starts the Open Annihilation program at `executable` with
/// `args`, always adding `--status-stdout`, and sends each line of its status
/// stream down `on_event`. It resolves when the process exits, as
/// `play_launch` does, with `exitCode` and `signal` both null when
/// `play_oa_cancel` ended it.
///
/// It is refused while another Open Annihilation runs, because its discovery
/// port is one per machine. It rejects with OA's own words when OA refuses an
/// option before it opens a window.
#[tauri::command]
pub async fn play_oa_launch(
    reg: State<'_, OaRegistry>,
    executable: String,
    args: Vec<String>,
    run_id: String,
    on_event: Channel<OaEvent>,
) -> Result<CliResult, ()> {
    let bin = PathBuf::from(&executable);
    if !bin.is_file() {
        return Ok(CliResult::err(format!(
            "Open Annihilation not found: {executable}"
        )));
    }
    let reg = reg.inner().clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        run_blocking(&bin, &args, &run_id, &reg, |event| {
            let _ = on_event.send(event);
        })
    })
    .await;
    Ok(launch_result(result))
}

/// `play_oa_cancel` ends the Open Annihilation a launch started, by run id. The
/// launch resolves shortly after.
#[tauri::command]
pub async fn play_oa_cancel(reg: State<'_, OaRegistry>, run_id: String) -> Result<CliResult, ()> {
    let cancelled = cancel(&reg, &run_id);
    Ok(CliResult::ok(json!({ "cancelled": cancelled })))
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;
    use std::sync::mpsc;
    use std::time::Duration;

    const A_FEW_SECONDS: Duration = Duration::from_secs(10);

    /// A folder for one test's stand-in programs, removed on drop.
    struct Dir(PathBuf);

    impl Dir {
        fn new(name: &str) -> Self {
            let dir = std::env::temp_dir()
                .join(format!("coilbox-oa-launch-{name}-{}", std::process::id()));
            let _ = std::fs::remove_dir_all(&dir);
            std::fs::create_dir_all(&dir).unwrap();
            Dir(dir)
        }

        /// A shell script standing in for OA, with its execute bit.
        fn program(&self, name: &str, body: &str) -> PathBuf {
            let path = self.0.join(name);
            std::fs::write(&path, format!("#!/bin/sh\n{body}\n")).unwrap();
            std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
            path
        }
    }

    impl Drop for Dir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    fn run(bin: &Path, args: &[&str]) -> (Result<Option<ExitOutcome>, String>, Vec<OaEvent>) {
        let reg = OaRegistry::default();
        let args: Vec<String> = args.iter().map(|a| a.to_string()).collect();
        let mut events = Vec::new();
        let result = run_blocking(bin, &args, "run", &reg, |e| events.push(e));
        (result, events)
    }

    const HELLO: &str = r#"echo '{"event":"hello","version":"0.8.9","pid":4242}'"#;

    #[test]
    fn a_whole_match_arrives_as_events_in_order() {
        let dir = Dir::new("whole");
        let oa = dir.program(
            "oa",
            &format!(
                r#"{HELLO}
echo '{{"event":"screen","seq":1,"frame":0,"tick":0,"name":"main-menu"}}'
echo '{{"event":"match","seq":2,"frame":0,"tick":0,"change":"started"}}'
echo '{{"event":"match","seq":3,"frame":900,"tick":900,"change":"ended"}}'
echo '{{"event":"game_over","seq":4,"frame":900,"tick":900,"outcome":"victory","winner":1,"results":[{{"slot":0,"name":"Tom","team":1,"side":"arm","outcome":"won","units":12,"kills":3,"losses":1}}]}}'
echo '{{"event":"exit","seq":5,"frame":901,"tick":901,"reason":"game-ended"}}'"#
            ),
        );
        let (result, events) = run(&oa, &[]);
        let outcome = result.unwrap().expect("not cancelled");
        assert_eq!(outcome.code, Some(0));

        let json: Vec<Value> = events
            .iter()
            .map(|e| serde_json::to_value(e).unwrap())
            .collect();
        assert_eq!(
            json[0],
            json!({"kind": "hello", "version": "0.8.9", "pid": 4242})
        );
        assert_eq!(
            json[1],
            json!({"kind": "screen", "seq": 1, "frame": 0, "tick": 0, "name": "main-menu"})
        );
        assert_eq!(
            json[2],
            json!({"kind": "match", "seq": 2, "frame": 0, "tick": 0, "change": "started"})
        );
        assert_eq!(json[3]["change"], "ended");
        // Everything game_over carries reaches the frontend, not only `results`.
        assert_eq!(
            json[4],
            json!({
                "kind": "gameOver", "seq": 4, "frame": 900, "tick": 900,
                "outcome": "victory", "winner": 1,
                "results": [{"slot": 0, "name": "Tom", "team": 1, "side": "arm",
                             "outcome": "won", "units": 12, "kills": 3, "losses": 1}],
            })
        );
        assert_eq!(
            json[5],
            json!({"kind": "exit", "seq": 5, "frame": 901, "tick": 901, "reason": "game-ended"})
        );
        assert_eq!(json.len(), 6);
    }

    #[test]
    fn a_hello_without_an_event_field_is_still_hello() {
        assert_eq!(
            parse_line(r#"{"version":"0.8.9","pid":7}"#, true),
            OaEvent::Hello {
                version: "0.8.9".into(),
                pid: 7,
                rest: Map::new()
            }
        );
        // Only the first line can be hello.
        assert!(matches!(
            parse_line(r#"{"version":"0.8.9","pid":7}"#, false),
            OaEvent::Unreadable { .. }
        ));
    }

    #[test]
    fn an_unknown_event_keeps_its_fields_and_does_not_stop_the_stream() {
        let dir = Dir::new("unknown");
        let oa = dir.program(
            "oa",
            &format!(
                r#"{HELLO}
echo '{{"event":"lobby-warmup","seq":1,"frame":0,"tick":0,"players":3}}'
echo '{{"event":"screen","seq":2,"frame":0,"tick":0,"name":"skirmish"}}'"#
            ),
        );
        let (result, events) = run(&oa, &[]);
        assert!(result.is_ok());
        assert_eq!(events.len(), 3);
        let unknown = serde_json::to_value(&events[1]).unwrap();
        assert_eq!(unknown["kind"], "unknown");
        assert_eq!(unknown["event"], "lobby-warmup");
        assert_eq!(unknown["players"], 3);
        assert!(matches!(events[2], OaEvent::Screen { .. }));
    }

    #[test]
    fn a_known_event_with_the_wrong_field_kind_falls_back_to_unknown() {
        let event = parse_line(
            r#"{"event":"screen","seq":1,"frame":0,"tick":0,"name":5}"#,
            false,
        );
        let OaEvent::Unknown { event, rest, .. } = event else {
            panic!("expected Unknown");
        };
        assert_eq!(event, "screen");
        assert_eq!(rest["name"], 5);
    }

    #[test]
    fn a_line_that_is_not_json_is_reported_and_skipped() {
        let dir = Dir::new("garbage");
        let oa = dir.program(
            "oa",
            &format!(
                r#"{HELLO}
echo 'not json at all'
echo '{{"event":"exit","seq":1,"frame":0,"tick":0,"reason":"quit"}}'"#
            ),
        );
        let (result, events) = run(&oa, &[]);
        assert!(result.is_ok());
        assert_eq!(
            events[1],
            OaEvent::Unreadable {
                line: "not json at all".into()
            }
        );
        assert!(matches!(events[2], OaEvent::Exit { .. }));
    }

    #[test]
    fn a_refusal_before_hello_is_the_error_without_its_prefix() {
        let dir = Dir::new("refused");
        let oa = dir.program(
            "oa",
            "echo 'open-annihilation: --metal: 20000 is above 10000' >&2; exit 2",
        );
        let (result, events) = run(&oa, &["--metal", "20000", "--host"]);
        assert_eq!(result.unwrap_err(), "--metal: 20000 is above 10000");
        assert!(events.is_empty());
    }

    #[test]
    fn a_failure_with_no_refusal_line_still_says_something() {
        let dir = Dir::new("plain-failure");
        let said = dir.program("said", "echo 'out of memory' >&2; exit 1");
        assert_eq!(run(&said, &[]).0.unwrap_err(), "out of memory");
        let silent = dir.program("silent", "exit 3");
        assert_eq!(
            run(&silent, &[]).0.unwrap_err(),
            "Open Annihilation exited with status 3 before it started."
        );
    }

    #[test]
    fn a_failure_after_hello_is_a_result_not_an_error() {
        let dir = Dir::new("refused-late");
        let oa = dir.program(
            "oa",
            &format!(
                r#"{HELLO}
echo '{{"event":"exit","seq":1,"frame":0,"tick":0,"reason":"refused","code":2}}'
echo 'open-annihilation: no such map' >&2
exit 2"#
            ),
        );
        let (result, events) = run(&oa, &[]);
        assert_eq!(result.unwrap().unwrap().code, Some(2));
        let exit = serde_json::to_value(&events[1]).unwrap();
        assert_eq!(exit["reason"], "refused");
        assert_eq!(exit["code"], 2);
    }

    #[test]
    fn the_status_flag_is_added_once_after_the_arguments_given() {
        let dir = Dir::new("flag");
        // Reports its own arguments as the screen name.
        let oa = dir.program(
            "oa",
            &format!(
                r#"{HELLO}
echo "{{\"event\":\"screen\",\"seq\":1,\"frame\":0,\"tick\":0,\"name\":\"$*\"}}""#
            ),
        );
        let name_of = |events: &[OaEvent]| match &events[1] {
            OaEvent::Screen { name, .. } => name.clone(),
            other => panic!("expected a screen, got {other:?}"),
        };
        let (_, events) = run(&oa, &["--skip-intro"]);
        assert_eq!(name_of(&events), "--skip-intro --status-stdout");
        let (_, events) = run(&oa, &["--status-stdout", "--skip-intro"]);
        assert_eq!(name_of(&events), "--status-stdout --skip-intro");
    }

    /// Start `body` as a running OA on its own thread, and return once its
    /// `hello` has arrived so the registry certainly holds it.
    fn start_running(
        dir: &Dir,
        reg: &OaRegistry,
    ) -> std::thread::JoinHandle<Result<Option<ExitOutcome>, String>> {
        let oa = dir.program("oa", &format!("{HELLO}\nexec sleep 60"));
        let (said_hello, heard) = mpsc::channel();
        let reg = reg.clone();
        let handle = std::thread::spawn(move || {
            run_blocking(&oa, &[], "first", &reg, |event| {
                if matches!(event, OaEvent::Hello { .. }) {
                    let _ = said_hello.send(());
                }
            })
        });
        heard.recv_timeout(A_FEW_SECONDS).expect("hello arrived");
        handle
    }

    #[test]
    fn a_second_start_is_refused_while_the_first_runs() {
        let dir = Dir::new("second");
        let reg = OaRegistry::default();
        let first = start_running(&dir, &reg);

        let other = dir.program("other", &format!("{HELLO}\nexit 0"));
        let refused = run_blocking(&other, &[], "second", &reg, |_| {});
        assert_eq!(
            refused.unwrap_err(),
            "Open Annihilation is already running."
        );

        assert!(cancel(&reg, "first"));
        assert!(first.join().unwrap().unwrap().is_none());

        // With the first gone a new start goes through.
        assert!(run_blocking(&other, &[], "second", &reg, |_| {}).is_ok());
    }

    #[test]
    fn cancel_ends_the_process_and_the_launch_reports_no_status() {
        let dir = Dir::new("cancel");
        let reg = OaRegistry::default();
        let launch = start_running(&dir, &reg);

        assert!(!cancel(&reg, "someone-else"));
        assert!(cancel(&reg, "first"));
        assert!(launch.join().unwrap().unwrap().is_none());
        assert!(reg.lock().unwrap().is_empty());
        assert!(!cancel(&reg, "first"));
    }

    /// The real OA, started in the one way that opens no window: an option it
    /// refuses. It needs Open Annihilation installed, and the program's path in
    /// `COILBOX_OA_PROGRAM` outside macOS.
    #[test]
    #[ignore = "needs Open Annihilation installed"]
    fn the_real_oa_refuses_a_metal_value_over_the_limit() {
        let program = std::env::var("COILBOX_OA_PROGRAM").unwrap_or_else(|_| {
            "/Applications/Open Annihilation.app/Contents/MacOS/open-annihilation".to_string()
        });
        let (result, events) = run(Path::new(&program), &["--metal", "20000", "--host"]);
        assert_eq!(result.unwrap_err(), "--metal: 20000 is above 10000");
        assert!(
            !events.iter().any(|e| matches!(e, OaEvent::Hello { .. })),
            "a refused start says no hello"
        );
    }
}
