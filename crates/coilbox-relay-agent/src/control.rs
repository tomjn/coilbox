//! The agent's end of the control channel: requests in on stdin, events out on
//! stdout.
//!
//! `coilbox_relay_protocol` owns what the messages are and carries the
//! reasoning for the shape. This module is only how they get on and off the
//! pipes.
//!
//! Two things here are deliberate and worth not undoing.
//!
//! ## stdin closing is not a reason to stop
//!
//! coilbox can be closed mid-game and the engine plays on, which is the whole
//! reason this is a separate process. When that happens stdin reaches EOF. The
//! agent keeps relaying, because every player already in the game depends on
//! it, and it stops taking requests, because there is nobody left to make them.
//!
//! The cost is real and is worth saying out loud rather than leaving it to be
//! discovered: a player who joins after coilbox has closed cannot be let
//! through the relay, so they will not get in. Anybody already playing is
//! unaffected. [`Requests::listen`] writes that to stderr at the moment it
//! becomes true, so it lands in a log next to the join that failed.
//!
//! ## Every request gets exactly one answer
//!
//! Including a request this build cannot read, as long as it had an id, and
//! including one that arrives while there is no relay to act on. A request that
//! quietly goes nowhere reads to whoever asked as a join that timed out, which
//! is precisely the failure this issue exists to remove.

use std::io;

use coilbox_relay_protocol::{read_request, to_line, Event, Request, Unreadable};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::sync::{mpsc, Mutex};

/// How many requests may be waiting for a relay to open before the agent stops
/// taking them.
///
/// Requests are served only while a relay is up, so this queue is what a
/// battle's worth of joins sits in during a reconnect. The agent rebuilds a
/// relay within 32 seconds at worst (`LONGEST_BACKOFF` in `main`), and coilbox
/// sends one of these per player, so a battle cannot fill this. It is a bound
/// against a coilbox that has gone wrong, not a working one.
const QUEUED_REQUESTS: usize = 64;

/// The agent's voice: one event per line on stdout.
///
/// Behind a lock because events are written from the request loop and from the
/// relay loop, and half of one line inside another would be unreadable to both
/// a parser and a person.
pub struct Reporter {
    out: Mutex<tokio::io::Stdout>,
}

impl Default for Reporter {
    fn default() -> Reporter {
        Reporter::new()
    }
}

impl Reporter {
    pub fn new() -> Reporter {
        Reporter {
            out: Mutex::new(tokio::io::stdout()),
        }
    }

    /// Tell coilbox something, and do not care whether it was listening.
    ///
    /// A write that fails means coilbox has closed its end, which is a state
    /// this process is designed to keep running in. There is nothing useful to
    /// do about it and nowhere useful to report it to, since the only channel
    /// for reporting it is the one that just failed.
    pub async fn say(&self, event: Event) {
        let line = to_line(&event);
        let mut out = self.out.lock().await;
        if out.write_all(line.as_bytes()).await.is_ok() {
            let _ = out.flush().await;
        }
    }
}

/// Requests as they arrive, already parsed.
pub struct Requests {
    asked: mpsc::Receiver<Request>,
}

impl Requests {
    /// Start reading stdin, answering anything unreadable through `reporter`.
    ///
    /// The reading runs in a task of its own for the life of the process, so a
    /// request that arrives while the relay is being rebuilt waits in the queue
    /// rather than being lost, and is answered once there is a relay to answer
    /// it with.
    pub fn listen(reporter: std::sync::Arc<Reporter>) -> Requests {
        let (heard, asked) = mpsc::channel(QUEUED_REQUESTS);
        tokio::spawn(async move {
            let mut lines = BufReader::new(tokio::io::stdin()).lines();
            loop {
                let line = match lines.next_line().await {
                    Ok(Some(line)) => line,
                    Ok(None) => break,
                    Err(e) => {
                        eprintln!("coilbox-relay-agent: cannot read the control channel: {e}");
                        break;
                    }
                };
                if line.trim().is_empty() {
                    continue;
                }
                match read_request(&line) {
                    Ok(request) => {
                        if heard.send(request).await.is_err() {
                            return;
                        }
                    }
                    Err(Unreadable {
                        id: Some(id),
                        reason,
                    }) => {
                        reporter.say(Event::Failed { id, reason }).await;
                    }
                    Err(Unreadable { id: None, reason }) => {
                        // Nobody to answer, so the only thing left is to say it
                        // where a human will find it.
                        eprintln!("coilbox-relay-agent: ignoring a control line: {reason}");
                    }
                }
            }
            eprintln!(
                "coilbox-relay-agent: coilbox has closed the control channel. \
                 The players already in this game are unaffected and it will carry on \
                 relaying for them, but nobody new can be let through the relay from \
                 now on, so anybody trying to join will not get in."
            );
        });
        Requests { asked }
    }

    /// The next request, or nothing ever again because coilbox has gone.
    pub async fn next(&mut self) -> Option<Request> {
        self.asked.recv().await
    }
}

/// Answer one request that was carried out, or not.
pub async fn answer(
    reporter: &Reporter,
    id: coilbox_relay_protocol::RequestId,
    done: io::Result<()>,
) {
    match done {
        Ok(()) => reporter.say(Event::Done { id }).await,
        Err(e) => {
            reporter
                .say(Event::Failed {
                    id,
                    reason: e.to_string(),
                })
                .await
        }
    }
}
