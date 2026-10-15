//! The loop of a worker that stays running (issue #3722).
//!
//! Started as `--serve --lib <libunitsync> --datadir <content root>`, it reads
//! requests from its standard input, answers each in turn, and exits when that
//! input closes. Each request is the argument list of a one-shot run, so every
//! mode is answered by the code that answers it one-shot, with `Init` shared
//! between them by `session`. The frames are `coilbox_unitsync_worker::protocol`.
//!
//! # When it exits
//!
//! When its standard input closes, which is the plugin shutting it down after
//! a quiet spell, coilbox quitting, or coilbox crashing. Between requests it
//! runs `UnInit` first, so a checksum it worked out reaches the archive cache.
//! In the middle of a request it does not wait for the read to end, because
//! nobody is left to take the answer and a read can run for minutes. It waits
//! only for an `Init` or `UnInit` in flight, since stopping one of those cuts
//! the archive cache short for every other process (`initlock`).
//!
//! # What it will not answer
//!
//! `--config` and `--config-set` set unitsync's config handler up themselves,
//! in place of `Init`, which under a live `Init` would swap the handler out
//! from under it. `--convert-3do` prints progress as it goes, and `--seed` is a
//! maintainer's tool. All four stay one-shot.

use crate::ffi::Unitsync;
use crate::{out, session, Args};
use coilbox_unitsync_worker::protocol::{self, ReplyHead, Request};
use std::io::Write;
use std::path::Path;
use std::sync::mpsc::{self, Receiver};
use std::sync::{Arc, Mutex};

/// What the thread reading requests and the thread answering them agree on.
#[derive(Default)]
struct Gate {
    /// A request is being answered.
    busy: bool,
    /// The input has closed, so no further request may start.
    closed: bool,
}

pub fn run(raw: &[String]) -> i32 {
    let Ok(token) = std::env::var(protocol::TOKEN_ENV) else {
        eprintln!("--serve needs {} set", protocol::TOKEN_ENV);
        return 2;
    };
    let mut base = match crate::parse_args(raw) {
        Ok(args) => args,
        Err(e) => {
            eprintln!("--serve: {e}");
            return 2;
        }
    };
    crate::absolutize(&mut base);
    crate::enter_engine(&base.lib, &base.datadir);
    session::begin();

    let gate = Arc::new(Mutex::new(Gate::default()));
    let requests = read_requests(gate.clone());
    // Held for the life of the process, so the library a mode loads and drops
    // is never unloaded between requests.
    let library = unsafe { Unitsync::load(Path::new(&base.lib)) }.ok();

    let mut stdout = std::io::stdout();
    answer_all(
        &requests,
        &gate,
        &token,
        &mut stdout,
        |args| {
            let code = answer(&base, args);
            if let Some(us) = &library {
                us.reset();
            }
            code
        },
        || {
            if let Some(us) = &library {
                us.release();
            }
        },
    );

    if let Some(us) = &library {
        us.shutdown();
    }
    0
}

/// Read requests on a thread of their own, so the input closing is noticed
/// while a request is being answered.
fn read_requests(gate: Arc<Mutex<Gate>>) -> Receiver<Request> {
    let (tx, rx) = mpsc::channel();
    std::thread::spawn(move || {
        let mut input = std::io::stdin().lock();
        // A line that is not a request ends the worker the same as a closed
        // input: there is no id to answer it with, and no knowing what was
        // meant by whatever follows.
        while let Ok(Some(request)) = protocol::read_request(&mut input) {
            if tx.send(request).is_err() {
                return;
            }
        }
        let busy = {
            let mut gate = gate.lock().unwrap_or_else(|e| e.into_inner());
            gate.closed = true;
            gate.busy
        };
        drop(tx);
        if busy {
            let _not_mid_write = crate::ffi::CACHE_WRITE
                .lock()
                .unwrap_or_else(|e| e.into_inner());
            std::process::exit(0);
        }
    });
    rx
}

/// Answer each request in turn until there are no more, writing one frame per
/// request to `out`. `answer` prints the answer and returns the exit code a
/// one-shot worker would have ended with.
///
/// A request that is `protocol::RELEASE_FLAG` alone runs `release` and gets no
/// frame.
fn answer_all(
    requests: &Receiver<Request>,
    gate: &Mutex<Gate>,
    token: &str,
    out: &mut impl Write,
    mut answer: impl FnMut(&[String]) -> i32,
    mut release: impl FnMut(),
) {
    while let Ok(request) = requests.recv() {
        if request.args == [protocol::RELEASE_FLAG] {
            release();
            continue;
        }
        {
            let mut gate = gate.lock().unwrap_or_else(|e| e.into_inner());
            if gate.closed {
                break;
            }
            gate.busy = true;
        }
        let (code, payload) = out::collect(|| answer(&request.args));
        let head = ReplyHead {
            id: request.id,
            code,
            init: session::take_init(),
            mount_ms: session::take_mounts(),
        };
        // Not busy before the reply goes out. The reader has no way to tell the
        // answer is done, and a client that closes the input on seeing the
        // reply would otherwise find the worker busy and cut it off before
        // its `UnInit`.
        gate.lock().unwrap_or_else(|e| e.into_inner()).busy = false;
        // Written from the thread that calls unitsync, so nothing the library
        // prints can land inside a frame.
        let sent = protocol::write_reply(out, token, &head, &payload);
        if sent.is_err() {
            break;
        }
    }
}

/// Answer one request: the mode its arguments ask for, against the engine and
/// content root this worker was started for.
fn answer(base: &Args, raw: &[String]) -> i32 {
    let mut args = match crate::parse_args(raw) {
        Ok(args) => args,
        Err(e) => {
            crate::emit_error(e);
            return 1;
        }
    };
    crate::absolutize(&mut args);
    if args.lib != base.lib || args.datadir != base.datadir {
        crate::emit_error(format!(
            "this worker reads {} with {}, and was asked for {} with {}",
            base.datadir, base.lib, args.datadir, args.lib
        ));
        return 1;
    }
    if args.config.is_some() || args.config_set.is_some() || args.convert_3do.is_some() || args.seed
    {
        crate::emit_error("this read is not answered by a running worker, start one for it".into());
        return 1;
    }
    crate::dispatch(&args)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    const TOKEN: &str = "feedfacefeedface";

    fn request(id: u64, args: &[&str]) -> Request {
        Request {
            id,
            args: args.iter().map(|a| a.to_string()).collect(),
        }
    }

    /// Answer `requests` with `answer` and read the frames back.
    fn served(
        requests: Vec<Request>,
        answer: impl FnMut(&[String]) -> i32,
    ) -> Vec<(ReplyHead, String)> {
        let (tx, rx) = mpsc::channel();
        for request in requests {
            tx.send(request).unwrap();
        }
        drop(tx);
        let mut wire = Vec::new();
        answer_all(
            &rx,
            &Mutex::new(Gate::default()),
            TOKEN,
            &mut wire,
            answer,
            || {},
        );
        let mut input = Cursor::new(wire);
        let mut replies = Vec::new();
        while let Some((head, payload)) = protocol::read_reply(&mut input, TOKEN).unwrap() {
            replies.push((head, String::from_utf8(payload).unwrap()));
        }
        replies
    }

    #[test]
    fn each_request_is_answered_under_its_own_id() {
        let replies = served(
            vec![
                request(3, &["--map", "a"]),
                request(4, &["--map", "b"]),
                request(9, &["--map", "c"]),
            ],
            |args| {
                println!("{{\"map\":\"{}\"}}", args[1]);
                0
            },
        );
        let seen: Vec<(u64, &str)> = replies.iter().map(|(h, p)| (h.id, p.as_str())).collect();
        assert_eq!(
            seen,
            vec![
                (3, "{\"map\":\"a\"}\n"),
                (4, "{\"map\":\"b\"}\n"),
                (9, "{\"map\":\"c\"}\n")
            ]
        );
    }

    #[test]
    fn the_exit_code_travels_with_the_reply() {
        let replies = served(vec![request(1, &["ok"]), request(2, &["bad"])], |args| {
            println!("{}", args[0]);
            i32::from(args[0] == "bad")
        });
        assert_eq!(replies[0].0.code, 0);
        assert_eq!(replies[1].0.code, 1);
    }

    #[test]
    fn a_request_that_prints_nothing_still_gets_a_reply() {
        let replies = served(vec![request(1, &[])], |_| 1);
        assert_eq!(replies.len(), 1);
        assert_eq!(replies[0].1, "");
    }

    #[test]
    fn no_request_starts_once_the_input_has_closed() {
        let (tx, rx) = mpsc::channel();
        tx.send(request(1, &[])).unwrap();
        drop(tx);
        let gate = Mutex::new(Gate {
            busy: false,
            closed: true,
        });
        let mut wire = Vec::new();
        let mut answered = 0;
        answer_all(
            &rx,
            &gate,
            TOKEN,
            &mut wire,
            |_| {
                answered += 1;
                0
            },
            || {},
        );
        assert_eq!(answered, 0);
        assert!(wire.is_empty());
    }

    #[test]
    fn a_release_is_run_in_its_turn_and_gets_no_reply() {
        let (tx, rx) = mpsc::channel();
        for req in [
            request(1, &["--map", "a"]),
            request(0, &[protocol::RELEASE_FLAG]),
            request(2, &["--map", "b"]),
        ] {
            tx.send(req).unwrap();
        }
        drop(tx);
        let order = std::cell::RefCell::new(Vec::new());
        let mut wire = Vec::new();
        answer_all(
            &rx,
            &Mutex::new(Gate::default()),
            TOKEN,
            &mut wire,
            |args| {
                order.borrow_mut().push(args[1].clone());
                0
            },
            || order.borrow_mut().push("release".into()),
        );
        assert_eq!(*order.borrow(), ["a", "release", "b"]);
        let mut input = Cursor::new(wire);
        let mut ids = Vec::new();
        while let Some((head, _)) = protocol::read_reply(&mut input, TOKEN).unwrap() {
            ids.push(head.id);
        }
        assert_eq!(ids, [1, 2]);
    }

    #[test]
    fn a_request_for_another_engine_is_refused() {
        let base = crate::parse_args(&args(&["--lib", "/engines/a/lib", "--datadir", "/data"]))
            .expect("base args");
        let (code, printed) = out::collect(|| {
            answer(
                &base,
                &args(&["--lib", "/engines/b/lib", "--datadir", "/data"]),
            )
        });
        assert_eq!(code, 1);
        let printed = String::from_utf8(printed).unwrap();
        assert!(printed.contains("/engines/b/lib"), "got: {printed}");
    }

    #[test]
    fn a_read_that_must_be_one_shot_is_refused() {
        let base = crate::parse_args(&args(&["--lib", "/engines/a/lib", "--datadir", "/data"]))
            .expect("base args");
        for mode in ["--config", "--config-set", "--seed"] {
            let mut asked = args(&["--lib", "/engines/a/lib", "--datadir", "/data", mode]);
            if mode == "--config-set" {
                asked.extend(args(&["--config-key", "Fullscreen"]));
            }
            let (code, printed) = out::collect(|| answer(&base, &asked));
            assert_eq!(code, 1, "{mode}");
            assert!(
                String::from_utf8(printed)
                    .unwrap()
                    .contains("not answered by a running worker"),
                "{mode}"
            );
        }
    }

    fn args(list: &[&str]) -> Vec<String> {
        list.iter().map(|a| a.to_string()).collect()
    }
}
