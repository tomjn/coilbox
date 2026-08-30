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
//! ## Four requests never reach the relay loop
//!
//! [`Request::Stop`], [`Request::BattleOver`], [`Request::WatchEngine`] and
//! [`Request::RenewCredential`] are answered here, in the reading task, because
//! none of them needs a relay to carry out. Everything else waits for one, and
//! waiting is right for those: an `allowPeer` answered while there is no relay
//! would be a lie either way round.
//!
//! Answering them here is what makes them prompt. A relay being rebuilt can
//! take 32 seconds (`LONGEST_BACKOFF` in `main`), and a coilbox that has said
//! "stop" should not spend that holding an allocation for a battle that is
//! over.
//!
//! The renewal is the one where being prompt is the whole point rather than a
//! courtesy. It exists to be in place before the next rebuild, so queueing it
//! for the relay loop would hold it until after the rebuild it was sent to
//! sign, which is exactly the game issue #2092 is about losing.
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
use crate::HeldCredential;

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
    pub fn listen(
        reporter: std::sync::Arc<Reporter>,
        stopping: Arc<Stopping>,
        turn: HeldCredential,
    ) -> Requests {
        Requests::reading(tokio::io::stdin(), reporter, stopping, turn)
    }

    /// The same reader pointed somewhere other than stdin, which is how a test
    /// feeds the agent requests without a process in the way.
    pub fn reading(
        from: impl AsyncRead + Send + Unpin + 'static,
        reporter: std::sync::Arc<Reporter>,
        stopping: Arc<Stopping>,
        turn: HeldCredential,
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
                    Ok(Request::BattleOver { id }) => {
                        reporter.say(Event::Done { id }).await;
                        stopping.battle_is_over();
                        // Nothing more to read. A battle that has gone from the
                        // lobby has no joiners left to vouch for, coilbox lets
                        // go of the channel as it sends this, and an agent
                        // still sitting on a blocking read of stdin would keep
                        // the process alive after it had decided to go.
                        //
                        // Unlike `stop` this is not a promise that the process
                        // is going. A game still being played through the relay
                        // keeps it running, and now decides for itself when to
                        // stop.
                        eprintln!(
                            "coilbox-relay-agent: coilbox says the battle is over. If a game is \
                             still being played through this relay it carries on until the game \
                             ends, and nobody new can be let through from now on."
                        );
                        return;
                    }
                    // Answered here for the sharpest version of the reason the
                    // three above are: a renewal queued for the relay loop
                    // would be read after the rebuild it exists to sign.
                    Ok(Request::RenewCredential {
                        id,
                        server,
                        user,
                        password,
                    }) => {
                        let swapped = {
                            let mut held = turn.lock().unwrap_or_else(|e| e.into_inner());
                            held.as_mut().map(|held| {
                                held.server = server;
                                held.username = user;
                                held.password = password;
                            })
                        };
                        match swapped {
                            Some(()) => {
                                // Worth a line, because the log is where
                                // somebody looks after a battle that ended
                                // badly and "the credential was renewed at
                                // 14:02" is what says whether it did. No part
                                // of the credential, for the same reason it is
                                // not an argument.
                                eprintln!(
                                    "coilbox-relay-agent: coilbox sent a fresh relay credential. \
                                     The allocation that is open is unaffected and the next \
                                     rebuild will be signed with the new one."
                                );
                                reporter.say(Event::Done { id }).await;
                            }
                            None => {
                                reporter
                                    .say(Event::Failed {
                                        id,
                                        reason: "this relay is not going through a TURN server, \
                                                 so there is no credential to renew"
                                            .to_string(),
                                    })
                                    .await;
                            }
                        }
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
    use crate::allocation::TurnCredentials;
    use crate::stopping::{Reason, IDLE_TIMEOUT};

    /// The credential a sidecar was started with.
    fn started_with() -> TurnCredentials {
        TurnCredentials {
            server: "relay.example.org:3478".to_string(),
            username: "1786086400:alice".to_string(),
            password: "the-old-one".to_string(),
        }
    }

    /// A reader over the agent's control channel, with the credential it holds
    /// and a way to read back what it said.
    struct Wired {
        to_agent: tokio::io::DuplexStream,
        said: tokio::io::DuplexStream,
        turn: HeldCredential,
        _requests: Requests,
    }

    fn wired(holding: Option<TurnCredentials>) -> Wired {
        let (to_agent, agent_stdin) = tokio::io::duplex(1024);
        let (agent_stdout, said) = tokio::io::duplex(1024);
        let turn: HeldCredential = Arc::new(std::sync::Mutex::new(holding));
        let requests = Requests::reading(
            agent_stdin,
            Arc::new(Reporter::writing(agent_stdout)),
            Arc::new(Stopping::new()),
            Arc::clone(&turn),
        );
        Wired {
            to_agent,
            said,
            turn,
            _requests: requests,
        }
    }

    impl Wired {
        async fn asked(&mut self, request: &Request) {
            self.to_agent
                .write_all(coilbox_relay_protocol::to_line(request).as_bytes())
                .await
                .expect("the agent is reading");
        }

        /// The one answer the agent gave, which every request gets exactly one
        /// of.
        async fn answer(&mut self) -> Event {
            let mut line = String::new();
            BufReader::new(&mut self.said)
                .read_line(&mut line)
                .await
                .expect("the agent answered");
            coilbox_relay_protocol::read_event(line.trim()).expect("an event this build knows")
        }

        fn holding(&self) -> Option<TurnCredentials> {
            self.turn.lock().unwrap().clone()
        }
    }

    /// Issue #2092, at the seam where a renewal lands. The credential the next
    /// rebuild will sign with is the one coilbox last sent, not the one this
    /// process was started with.
    ///
    /// There is no relay anywhere in this test, and that is the assertion as much
    /// as the swap is. A renewal is served in the reading task rather than queued
    /// for the relay loop, so one that arrives while an allocation is being
    /// rebuilt is in place before the rebuild it has to sign, which is the only
    /// moment it was ever needed.
    #[tokio::test]
    async fn a_renewal_replaces_the_credential_the_next_rebuild_will_sign_with() {
        let mut w = wired(Some(started_with()));

        w.asked(&Request::RenewCredential {
            id: 3,
            server: "relay2.example.org:3478".to_string(),
            user: "1786090000:alice".to_string(),
            password: "the-new-one".to_string(),
        })
        .await;

        assert_eq!(w.answer().await, Event::Done { id: 3 });
        let held = w.holding().expect("a credential is still held");
        assert_eq!(held.server, "relay2.example.org:3478");
        assert_eq!(held.username, "1786090000:alice");
        assert_eq!(held.password, "the-new-one");
    }

    /// A relay that is not going through a TURN server has no credential to
    /// replace, so the renewal is refused rather than quietly inventing one.
    ///
    /// coilbox never sends one of these, because it only renews for a battle it
    /// opened on a credential. Storing it anyway would turn a plain UDP relay
    /// into one that tries to allocate on a TURN server the moment it was
    /// rebuilt, which is a working relay swapped for a failing one.
    #[tokio::test]
    async fn a_renewal_for_a_relay_with_no_credential_is_refused() {
        let mut w = wired(None);

        w.asked(&Request::RenewCredential {
            id: 4,
            server: "relay.example.org:3478".to_string(),
            user: "1786090000:alice".to_string(),
            password: "the-new-one".to_string(),
        })
        .await;

        let Event::Failed { id, reason } = w.answer().await else {
            panic!("a renewal with nothing to renew has to be refused");
        };
        assert_eq!(id, 4);
        assert!(
            reason.contains("not going through a TURN server"),
            "{reason}"
        );
        assert!(w.holding().is_none(), "nothing may be invented here");
        assert!(
            !reason.contains("the-new-one"),
            "the refusal must not quote the credential: {reason}"
        );
    }

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
        let mut requests = Requests::reading(
            agent_stdin,
            Arc::clone(&reporter),
            Arc::clone(&stopping),
            Arc::new(std::sync::Mutex::new(None)),
        );

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
