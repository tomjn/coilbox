//! coilbox's end of the relay agent's control channel.
//!
//! A TURN server drops traffic from any address the host's allocation has no
//! permission for, silently, with nothing sent back. So in a relayed battle
//! every joiner has to be let through the relay before their engine sends
//! anything, or their first packets vanish and the join looks broken for no
//! visible reason. The sidecar is what installs the permission
//! (`coilbox-relay-agent`, `allowlist.rs`). This is what tells it who to
//! install one for.
//!
//! `coilbox_relay_protocol` owns the messages and carries the reasoning for
//! their shape. This module is the driver: it writes requests, matches answers
//! back to whoever is waiting on them, and hands everything else to a listener.
//!
//! ## Where the address comes from, and why nothing calls this yet
//!
//! This is the honest gap in relay hosting today, and it is worth stating
//! plainly rather than leaving somebody to find it.
//!
//! coilbox does not currently learn any joiner's public address. There are two
//! routes to one and neither is available:
//!
//! - The lobby server telling the host, by extending `CLIENTIPPORT` to relayed
//!   battles (ScarylePoo/uberserver#28). That is the clean route and it is the
//!   one to take. The pull request is open and unmerged, and no server runs it.
//! - `JOINBATTLEREQUEST`, which already carries the joiner's IP and which
//!   `coilbox-lobby-protocol` already parses into
//!   `ServerMessage::JoinBattleRequest` (`message.rs:157`). It only fires for a
//!   host that sent the `b` compatibility flag at login, and coilbox sends `u`
//!   and `sp` (`src/multiplayer/store.tsx:1259`). Turning `b` on makes every
//!   join in the session wait for the host to approve it, which changes
//!   ordinary non-relay hosting for everybody, and that is too broad a change
//!   to make for a feature nobody can use until the server side lands anyway.
//!
//! So [`RelayAgent::allow_joiner`] is deliberately the single seam. Whichever
//! route arrives, it arrives here, with an `IpAddr` and nothing else, and
//! nothing above or below it has to change. The tests drive it directly, and
//! issue #2025 drives it against a real coturn.
//!
//! Spawning the sidecar is issue #2017's, along with the TURN credentials and
//! advertising the relayed address, so this takes pipes rather than a process.

use std::collections::HashMap;
use std::io::{self, BufRead, BufReader, Read, Write};
use std::net::IpAddr;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use coilbox_relay_protocol::{read_event, to_line, Event, Request, RequestId};

/// Why a joiner could not be let through the relay.
///
/// Every one of these names something a host can act on, which is the point.
/// The failure this replaces was the join simply not happening.
#[derive(Debug)]
pub enum NotAllowed {
    /// The agent read the request and said no, with its reason.
    Refused(String),
    /// The agent has stopped, or its end of the channel has closed, so nothing
    /// is going to answer.
    AgentGone(String),
    /// The request could not be written to the agent at all.
    Unreachable(io::Error),
    /// The agent is still there and still has not answered.
    NoAnswer(Duration),
}

impl std::fmt::Display for NotAllowed {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            NotAllowed::Refused(why) => write!(f, "the relay agent refused: {why}"),
            NotAllowed::AgentGone(why) => write!(f, "the relay agent has stopped: {why}"),
            NotAllowed::Unreachable(e) => write!(f, "the relay agent could not be reached: {e}"),
            NotAllowed::NoAnswer(waited) => write!(
                f,
                "the relay agent did not answer within {} seconds",
                waited.as_secs()
            ),
        }
    }
}

impl std::error::Error for NotAllowed {}

/// Answers still being waited on, by request id.
type Waiting = Arc<Mutex<HashMap<RequestId, mpsc::Sender<Result<(), NotAllowed>>>>>;

/// The relay agent, as coilbox talks to it.
pub struct RelayAgent {
    /// The agent's stdin. Behind a lock because a request is one whole line and
    /// two half lines are not two requests.
    to_agent: Mutex<Box<dyn Write + Send>>,
    /// Request ids are ours to mint and nobody else's, so a counter is enough.
    next_id: AtomicU64,
    waiting: Waiting,
}

impl RelayAgent {
    /// Drive an agent over its pipes.
    ///
    /// `from_agent` is its stdout and `to_agent` its stdin. Reading runs on a
    /// thread of its own, matching how this repo already reads a sidecar
    /// (`tauri-plugin-coilbox-downloads`, `run_sidecar_streaming`).
    ///
    /// `on_event` gets everything that is not an answer to a request:
    /// [`Event::RelayOpen`] when a relay opens or is rebuilt at a new address
    /// (issue #2031), [`Event::RelayDown`] when there is not one, and
    /// [`Event::Stopping`] when the agent is exiting. Answers are consumed
    /// here and never reach it.
    pub fn driving<R, W>(
        from_agent: R,
        to_agent: W,
        on_event: impl Fn(Event) + Send + 'static,
    ) -> RelayAgent
    where
        R: Read + Send + 'static,
        W: Write + Send + 'static,
    {
        let waiting: Waiting = Arc::default();
        let heard = Arc::clone(&waiting);
        std::thread::spawn(move || read_events(from_agent, &heard, on_event));
        RelayAgent {
            to_agent: Mutex::new(Box::new(to_agent)),
            next_id: AtomicU64::new(1),
            waiting,
        }
    }

    /// Let `ip` through the relay, and wait to hear that it worked.
    ///
    /// This is the one place coilbox says who is allowed into a relayed
    /// battle. See the note at the top of this module for why nothing calls it
    /// yet and what would.
    ///
    /// `patience` has to clear the agent's own worst case, which is the
    /// rebuild backoff it waits out when its allocation has been lost:
    /// `LONGEST_BACKOFF` in `coilbox-relay-agent`, 32 seconds, plus however
    /// long the new allocation takes to open. A shorter value turns a relay
    /// that is coming back into a join that failed. It is a parameter rather
    /// than a constant because the caller is the one with a budget: a host
    /// opening a battle can afford to wait and a mid-game join cannot.
    ///
    /// Blocking, because the answer is what the caller needs before it can let
    /// the player in.
    pub fn allow_joiner(&self, ip: IpAddr, patience: Duration) -> Result<(), NotAllowed> {
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        let (answered, answer) = mpsc::channel();
        self.waiting.lock().unwrap().insert(id, answered);

        let asked = self.write(&Request::AllowPeer { id, ip });
        if let Err(e) = asked {
            self.waiting.lock().unwrap().remove(&id);
            return Err(NotAllowed::Unreachable(e));
        }

        match answer.recv_timeout(patience) {
            Ok(outcome) => outcome,
            // The reader thread hands out the answer and drops the sender, so a
            // disconnect without an answer means the thread has gone, which is
            // the agent's stdout having closed.
            Err(RecvTimeoutError::Disconnected) => {
                Err(NotAllowed::AgentGone("its output ended".to_string()))
            }
            Err(RecvTimeoutError::Timeout) => {
                self.waiting.lock().unwrap().remove(&id);
                Err(NotAllowed::NoAnswer(patience))
            }
        }
    }

    fn write(&self, request: &Request) -> io::Result<()> {
        let line = to_line(request);
        let mut out = self.to_agent.lock().unwrap();
        out.write_all(line.as_bytes())?;
        out.flush()
    }
}

/// Read the agent's stdout until it ends, answering whoever is waiting.
///
/// Ending is not an error. It is what coilbox sees when the agent exits, and
/// the important part is what happens next: everybody still waiting is told,
/// rather than being left to wait out their own deadline for an answer that is
/// never coming.
fn read_events<R: Read>(from_agent: R, waiting: &Waiting, on_event: impl Fn(Event)) {
    let mut ending = "its output ended".to_string();
    for line in BufReader::new(from_agent).lines() {
        let line = match line {
            Ok(line) => line,
            Err(e) => {
                ending = format!("its output could not be read: {e}");
                break;
            }
        };
        if line.trim().is_empty() {
            continue;
        }
        let event = match read_event(&line) {
            Ok(event) => event,
            // An event from a newer agent than this coilbox. Nothing to answer
            // and nothing to do, and taking the channel down over it would be
            // far worse than not understanding one line.
            Err(_) => continue,
        };
        match event {
            Event::Done { id } => hand_over(waiting, id, Ok(())),
            Event::Failed { id, reason } => {
                hand_over(waiting, id, Err(NotAllowed::Refused(reason)))
            }
            Event::Stopping { ref reason } => {
                ending = reason.clone();
                on_event(event);
            }
            other => on_event(other),
        }
    }
    // Whatever the agent was doing, it is not doing it any more.
    let stranded: Vec<_> = waiting.lock().unwrap().drain().collect();
    for (_, answered) in stranded {
        let _ = answered.send(Err(NotAllowed::AgentGone(ending.clone())));
    }
}

fn hand_over(waiting: &Waiting, id: RequestId, outcome: Result<(), NotAllowed>) {
    let answered = waiting.lock().unwrap().remove(&id);
    if let Some(answered) = answered {
        let _ = answered.send(outcome);
    }
}

#[cfg(test)]
mod tests {
    //! Real pipes rather than a mock of the agent, so what is under test is the
    //! bytes on the channel. The agent's own end is tested in its own crate,
    //! and issue #2025 puts the two together against a real coturn.

    use super::*;
    use std::net::Ipv4Addr;
    use std::sync::mpsc::Sender;

    /// How long a test waits for a thread to get round to something before
    /// deciding it never will. Generous next to a pipe write, and spent in full
    /// only when a test is about to fail.
    const PATIENCE: Duration = Duration::from_secs(5);

    fn joiner() -> IpAddr {
        IpAddr::V4(Ipv4Addr::new(198, 51, 100, 4))
    }

    /// A stand-in for the agent's stdout that a test feeds a line at a time.
    struct Scripted {
        say: Sender<Vec<u8>>,
    }

    impl Scripted {
        fn new() -> (Scripted, impl Read + Send + 'static) {
            let (say, heard) = mpsc::channel::<Vec<u8>>();
            (Scripted { say }, Spoken { heard, held: None })
        }

        fn line(&self, line: String) {
            let _ = self.say.send(line.into_bytes());
        }
    }

    /// The reading half of [`Scripted`]. A `Read` rather than a real pipe so a
    /// test can also close it, which is how the agent exiting is spelled here.
    struct Spoken {
        heard: mpsc::Receiver<Vec<u8>>,
        held: Option<std::vec::IntoIter<u8>>,
    }

    impl Read for Spoken {
        fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
            loop {
                if let Some(held) = &mut self.held {
                    let mut wrote = 0;
                    for slot in buf.iter_mut() {
                        match held.next() {
                            Some(byte) => {
                                *slot = byte;
                                wrote += 1;
                            }
                            None => break,
                        }
                    }
                    if wrote > 0 {
                        return Ok(wrote);
                    }
                    self.held = None;
                }
                match self.heard.recv() {
                    Ok(next) => self.held = Some(next.into_iter()),
                    // Every sender dropped, which is the agent's stdout closing.
                    Err(_) => return Ok(0),
                }
            }
        }
    }

    /// A stand-in for the agent's stdin that a test can read back.
    #[derive(Clone, Default)]
    struct Written(Arc<Mutex<Vec<u8>>>);

    impl Written {
        fn lines(&self) -> Vec<String> {
            String::from_utf8(self.0.lock().unwrap().clone())
                .expect("the channel is UTF-8")
                .lines()
                .map(str::to_string)
                .collect()
        }
    }

    impl Write for Written {
        fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
            self.0.lock().unwrap().extend_from_slice(buf);
            Ok(buf.len())
        }

        fn flush(&mut self) -> io::Result<()> {
            Ok(())
        }
    }

    /// A write that always fails, which is what a sidecar that has already
    /// exited looks like from here.
    struct Broken;

    impl Write for Broken {
        fn write(&mut self, _buf: &[u8]) -> io::Result<usize> {
            Err(io::Error::new(
                io::ErrorKind::BrokenPipe,
                "the agent has gone",
            ))
        }

        fn flush(&mut self) -> io::Result<()> {
            Ok(())
        }
    }

    /// Answer whatever gets asked, so a test that cares about the answer does
    /// not have to hand-write the id.
    fn answering(written: Written, scripted: Arc<Scripted>, with: fn(RequestId) -> Event) {
        std::thread::spawn(move || {
            let deadline = std::time::Instant::now() + PATIENCE;
            while std::time::Instant::now() < deadline {
                if let Some(line) = written.lines().first() {
                    let asked: serde_json::Value =
                        serde_json::from_str(line).expect("a JSON request");
                    let id = asked["id"].as_u64().expect("a request carries its id");
                    scripted.line(to_line(&with(id)));
                    return;
                }
                std::thread::sleep(Duration::from_millis(5));
            }
        });
    }

    /// The whole point: coilbox names an address and the agent is told about it
    /// in the shape it reads.
    #[test]
    fn allowing_a_joiner_asks_the_agent_to_let_that_address_through() {
        let (scripted, reading) = Scripted::new();
        let scripted = Arc::new(scripted);
        let written = Written::default();
        let agent = RelayAgent::driving(reading, written.clone(), |_| {});

        answering(written.clone(), Arc::clone(&scripted), |id| Event::Done {
            id,
        });
        agent
            .allow_joiner(joiner(), PATIENCE)
            .expect("an agent that answered done let them through");

        assert_eq!(
            written.lines(),
            vec!["{\"type\":\"allowPeer\",\"id\":1,\"ip\":\"198.51.100.4\"}"]
        );
    }

    /// A join that cannot be allowed through has to fail with the agent's own
    /// reason. Anything vaguer and the host is left guessing at a battle nobody
    /// can enter.
    #[test]
    fn a_refusal_carries_the_agents_reason_back_to_the_caller() {
        let (scripted, reading) = Scripted::new();
        let scripted = Arc::new(scripted);
        let written = Written::default();
        let agent = RelayAgent::driving(reading, written.clone(), |_| {});

        answering(written.clone(), Arc::clone(&scripted), |id| Event::Failed {
            id,
            reason: "the TURN allocation is gone".to_string(),
        });
        let refused = agent
            .allow_joiner(joiner(), PATIENCE)
            .expect_err("an agent that answered failed did not let them through");

        assert!(
            refused.to_string().contains("the TURN allocation is gone"),
            "the reason has to survive as far as the caller, got: {refused}"
        );
    }

    /// The failure this whole issue is about, on this side of the channel: an
    /// agent that has stopped must not leave a join hanging until somebody
    /// gives up on it.
    #[test]
    fn an_agent_that_stops_fails_the_join_instead_of_leaving_it_waiting() {
        let (scripted, reading) = Scripted::new();
        let written = Written::default();
        let agent = RelayAgent::driving(reading, written, |_| {});

        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(20));
            scripted.line(to_line(&Event::Stopping {
                reason: "the TURN credential was refused".to_string(),
            }));
            // Dropping the sender closes the agent's stdout, which is what an
            // exiting process does.
        });

        let stranded = agent
            .allow_joiner(joiner(), PATIENCE)
            .expect_err("an agent that has gone cannot let anybody through");
        assert!(
            stranded
                .to_string()
                .contains("the TURN credential was refused"),
            "the reason the agent gave for stopping is the reason the join failed, got: {stranded}"
        );
    }

    /// An agent that is there but says nothing has to give up rather than
    /// holding the caller open, since the caller is a host waiting to admit
    /// somebody.
    #[test]
    fn an_agent_that_says_nothing_gives_up_rather_than_holding_the_caller() {
        let (scripted, reading) = Scripted::new();
        let written = Written::default();
        let agent = RelayAgent::driving(reading, written, |_| {});

        let waited = Duration::from_millis(50);
        let quiet = agent
            .allow_joiner(joiner(), waited)
            .expect_err("an agent that never answered did not let them through");
        assert!(matches!(quiet, NotAllowed::NoAnswer(_)), "got: {quiet}");
        drop(scripted);
    }

    /// A request that could not even be written is not worth waiting on.
    #[test]
    fn a_request_that_cannot_be_written_fails_at_once() {
        let (scripted, reading) = Scripted::new();
        let agent = RelayAgent::driving(reading, Broken, |_| {});

        let unreachable = agent
            .allow_joiner(joiner(), PATIENCE)
            .expect_err("a broken pipe lets nobody through");
        assert!(
            matches!(unreachable, NotAllowed::Unreachable(_)),
            "got: {unreachable}"
        );
        drop(scripted);
    }

    /// Everything that is not an answer goes to the listener, which is how the
    /// relayed address reaches whatever is advertising the battle, both the
    /// first time and after a rebuild.
    #[test]
    fn a_relay_address_reaches_the_listener_every_time_one_opens() {
        let (scripted, reading) = Scripted::new();
        let (saw, seen) = mpsc::channel();
        let _agent = RelayAgent::driving(reading, Written::default(), move |event| {
            let _ = saw.send(event);
        });

        for port in [41641u16, 41642] {
            scripted.line(to_line(&Event::RelayOpen {
                addr: (Ipv4Addr::new(198, 51, 100, 7), port).into(),
            }));
        }

        for port in [41641u16, 41642] {
            assert_eq!(
                seen.recv_timeout(PATIENCE).expect("an event arrived"),
                Event::RelayOpen {
                    addr: (Ipv4Addr::new(198, 51, 100, 7), port).into(),
                }
            );
        }
    }

    /// An event from a newer agent than this coilbox is ignored, not fatal.
    /// Issue #2024 is going to add one, and an older coilbox meeting it must
    /// keep working rather than losing the channel.
    #[test]
    fn an_event_this_coilbox_does_not_know_does_not_break_the_channel() {
        let (scripted, reading) = Scripted::new();
        let scripted = Arc::new(scripted);
        let written = Written::default();
        let agent = RelayAgent::driving(reading, written.clone(), |_| {});

        scripted.line("{\"type\":\"trafficSoFar\",\"bytes\":9001}\n".to_string());
        answering(written, Arc::clone(&scripted), |id| Event::Done { id });

        agent
            .allow_joiner(joiner(), PATIENCE)
            .expect("the unknown event was stepped over, not tripped on");
    }
}
