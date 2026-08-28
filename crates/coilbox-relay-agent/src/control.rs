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
//! It is however the moment the agent starts deciding for itself when to stop,
//! so EOF is reported to [`crate::stopping`] rather than only logged. That
//! module owns the decision and carries the reasoning.
//!
//! The cost is real and is worth saying out loud rather than leaving it to be
//! discovered: a player who joins after coilbox has closed cannot be let
//! through the relay, so they will not get in. Anybody already playing is
//! unaffected. [`Requests::listen`] writes that to stderr at the moment it
//! becomes true, so it lands in a log next to the join that failed.
//!
//! ## Two requests never reach the relay loop
//!
//! [`Request::Stop`] and [`Request::WatchEngine`] are answered here, in the
//! reading task, because neither needs a relay to carry out. Everything else
//! waits for one, and waiting is right for those: an `allowPeer` answered
//! while there is no relay would be a lie either way round.
//!
//! Answering them here is what makes them prompt. A relay being rebuilt can
//! take 32 seconds (`LONGEST_BACKOFF` in `main`), and a coilbox that has said
//! "stop" should not spend that holding an allocation for a battle that is
//! over.
//!
//! ## Every request gets exactly one answer
//!
//! Including a request this build cannot read, as long as it had an id, and
//! including one that arrives while there is no relay to act on. A request that
//! quietly goes nowhere reads to whoever asked as a join that timed out, which
//! is precisely the failure this issue exists to remove.

use std::io;
use std::sync::Arc;

use coilbox_relay_protocol::{read_request, to_line, Event, Request, Unreadable};
use tokio::io::{AsyncBufReadExt, AsyncRead, AsyncWrite, AsyncWriteExt, BufReader};
use tokio::sync::{mpsc, Mutex};

use crate::stopping::Stopping;

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
    out: Mutex<Box<dyn AsyncWrite + Send + Unpin>>,
}

impl Default for Reporter {
    fn default() -> Reporter {
        Reporter::new()
    }
}

impl Reporter {
    pub fn new() -> Reporter {
        Reporter::writing(tokio::io::stdout())
    }

    /// The same voice pointed somewhere other than stdout, which is how a test
    /// reads what the agent said without a process in the way.
    pub fn writing(out: impl AsyncWrite + Send + Unpin + 'static) -> Reporter {
        Reporter {
            out: Mutex::new(Box::new(out)),
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
    pub fn listen(reporter: std::sync::Arc<Reporter>, stopping: Arc<Stopping>) -> Requests {
        Requests::reading(tokio::io::stdin(), reporter, stopping)
    }

    /// The same reader pointed somewhere other than stdin, which is how a test
    /// feeds the agent requests without a process in the way.
    pub fn reading(
        from: impl AsyncRead + Send + Unpin + 'static,
        reporter: std::sync::Arc<Reporter>,
        stopping: Arc<Stopping>,
    ) -> Requests {
        let (heard, asked) = mpsc::channel(QUEUED_REQUESTS);
        tokio::spawn(async move {
            let mut lines = BufReader::new(from).lines();
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
                    // Answered here rather than forwarded, because neither
                    // needs a relay and both are about the process itself.
                    Ok(Request::WatchEngine { id, pid }) => {
                        stopping.engine_is(pid);
                        reporter.say(Event::Done { id }).await;
                    }
                    Ok(Request::Stop { id }) => {
                        // Answered before the flag is set, so the answer is on
                        // its way out before anything starts tearing down.
                        reporter.say(Event::Done { id }).await;
                        stopping.coilbox_asked();
                        return;
                    }
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
            // Whatever the agent does from here it decides on its own, so this
            // has to be said before anything else.
            stopping.coilbox_has_gone();
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::stopping::{Reason, IDLE_TIMEOUT};

    /// The handover, and the one piece of wiring nothing else can reach. The
    /// agent's own tests prove what it decides once coilbox has gone, and the
    /// integration tests prove what a running one does while coilbox is still
    /// there. This is the line between them: EOF on stdin is what moves the
    /// agent from one to the other, and an agent that never notices would sit
    /// there holding an allocation forever.
    ///
    /// On a paused clock, because the backstop it hands over to is four
    /// minutes out.
    #[tokio::test(start_paused = true)]
    async fn coilbox_closing_the_channel_hands_the_decision_to_the_agent() {
        let (to_agent, agent_stdin) = tokio::io::duplex(64);
        let reporter = Arc::new(Reporter::writing(tokio::io::sink()));
        let stopping = Arc::new(Stopping::new());
        let mut requests =
            Requests::reading(agent_stdin, Arc::clone(&reporter), Arc::clone(&stopping));

        tokio::time::sleep(IDLE_TIMEOUT).await;
        assert_eq!(
            stopping.reason(),
            None,
            "an agent with coilbox still on the other end never stops on a timer"
        );

        // coilbox closing, which is a window shutting rather than a battle
        // ending.
        drop(to_agent);
        assert!(
            requests.next().await.is_none(),
            "the channel has to end when coilbox does"
        );

        assert_eq!(
            stopping.reason(),
            Some(Reason::NothingLeftToCarry),
            "coilbox going away is what starts the agent judging for itself"
        );
    }
}
