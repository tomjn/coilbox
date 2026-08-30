//! The control channel between coilbox and the relay agent sidecar.
//!
//! A relayed battle is two processes that each know half of what is needed.
//! coilbox learns from the lobby which addresses belong to the players it is
//! expecting. The sidecar owns the TURN allocation those players have to be let
//! through. Neither is much use without the other, so they need to talk, and
//! this crate is what they say.
//!
//! ## The framing
//!
//! One JSON object per line, UTF-8, `\n` terminated. Requests go down the
//! sidecar's stdin, events come back up its stdout. stderr stays what it has
//! always been: sentences for a human reading a log, never parsed.
//!
//! A line is the frame because it needs no length prefix, both ends already
//! have a line reader (`tauri-plugin-coilbox-downloads` reads pr-downloader's
//! stdout this way), and somebody debugging a stuck battle can read the
//! conversation with `tee`. The alternative, a length-prefixed binary frame,
//! buys nothing here: the traffic is a handful of short messages per battle,
//! not a hot path.
//!
//! ## Three files are part of the contract as well
//!
//! [`RunFile`] is how a running agent is found once coilbox has been closed and
//! reopened, and [`StopNote`] is the only thing that coilbox can say to one it
//! finds, because a child's pipes cannot be taken over by a new parent.
//! [`Carrying`] is what such an agent says back without being asked. All three
//! are here rather than on one side for the same reason the messages are.
//!
//! ## Why the shapes live in a crate of their own
//!
//! Both halves derive their wire shape from these declarations, so a field that
//! changes name or type breaks both builds at once rather than one of them at
//! runtime, in a released sidecar, during somebody's game. That is the whole
//! reason this is not two copies of a struct.
//!
//! [`run_file_is_still_held`] and [`carrying_now`] are here for the same
//! reason. They are the only things in this crate that touch a file, and what
//! they read is the contract: the sidecar promises to hold a shared lock on its
//! run file for as long as it runs and to rewrite [`Carrying`] every
//! [`TRAFFIC_EVERY`], and these two are coilbox reading those promises. Split
//! across the two crates, one end could stop making a promise while the other
//! went on believing it.
//!
//! Otherwise it is deliberately IO-free and deliberately has no tokio. The
//! coilbox side can depend on it without pulling in the sidecar's TURN stack,
//! and each end carries the lines however it already carries lines.
//!
//! ## Adding to it later
//!
//! Both enums are internally tagged on `type`, so a new variant is additive:
//! an end that does not know it reads the tag, fails to match, and says so
//! rather than misreading the message as something else. Three issues are
//! already queued to add variants, and the shape here is chosen for them:
//!
//! - Traffic figures for the in-game badge are [`Event::Traffic`], pushed
//!   rather than polled (issue #2024).
//! - "This new address is the player who was at that old one" (issue #2029) was
//!   going to be a new [`Request`] and turned out not to need one. The engine
//!   re-identifies a player who moved by name and password, which is evidence
//!   neither end of this channel holds, so the sidecar stays out of it.
//!   `demux.rs` in `coilbox-relay-agent` has the reasoning.
//! - A relayed address that changed because the sidecar rebuilt its allocation
//!   (issue #2031) is already [`Event::RelayOpen`], which is sent every time a
//!   relay opens rather than only the first.
//!
//! Answers are keyed on the request's `id` rather than being a per-request
//! variant, which is what lets a new request type reuse them.

use std::net::{IpAddr, SocketAddr};
use std::path::{Path, PathBuf};
use std::time::Duration;

use serde::{Deserialize, Serialize};

/// How often the agent says how much it is carrying.
///
/// Here rather than in the agent because both ends need it. The agent sleeps
/// it, and coilbox multiplies it to decide when a figure it is holding has gone
/// stale, so a number that lived on one side would be a number the other side
/// guessed at.
///
/// A second because that is the rate a person reads a moving number at, and
/// because the reader is a pill on screen while a game is running. Faster would
/// be a number nobody can follow, redrawn more often, on a machine that is busy
/// running the game. Slower and a relay that stopped carrying anything would sit
/// there looking healthy for longer than it takes somebody to notice their game
/// has stopped.
pub const TRAFFIC_EVERY: Duration = Duration::from_secs(1);

/// A caller's own number for one request, echoed back in the answer.
///
/// Only the side that sends requests ever mints one, so a plain counter is
/// enough and there is nothing to co-ordinate.
pub type RequestId = u64;

/// Something coilbox is asking the relay agent to do.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum Request {
    /// Let this address through the relay, so their first packet is not
    /// dropped by the TURN server before they have ever been heard of.
    ///
    /// An IP address and not a socket address, because a TURN permission is
    /// per-IP: the `turn` crate's server keys its permission table on
    /// `addr.ip().to_string()` (`allocation/mod.rs:94-96`), and its client
    /// refreshes permissions at port 0 (`client/permission.rs`, `addrs`),
    /// which is RFC 5766 section 9.1 saying the port portion is ignored. So
    /// the port coilbox may or may not know about a joiner would make no
    /// difference to the answer, and asking for it would only invite somebody
    /// to think it did.
    #[serde(rename_all = "camelCase")]
    AllowPeer { id: RequestId, ip: IpAddr },
    /// The engine serving this battle is process `pid` on this machine.
    ///
    /// Sent once coilbox has launched it, which is always after the sidecar
    /// started: the battle advertises the relay's address, so the allocation
    /// has to be live before anybody can be invited to a game that does not
    /// exist yet. Until this arrives the sidecar has no engine to watch, and
    /// that gap is exactly why it cannot simply exit with the engine
    /// (issue #2027).
    ///
    /// A pid rather than a run id because the sidecar is a different process
    /// and a run id means nothing to it.
    #[serde(rename_all = "camelCase")]
    WatchEngine { id: RequestId, pid: u32 },
    /// Stop relaying and exit.
    ///
    /// The one signal that beats every other, because it is coilbox saying the
    /// battle is over rather than the sidecar guessing. Answered with
    /// [`Event::Done`] before the sidecar goes, so a caller knows the
    /// allocation is being given up rather than being left to infer it from a
    /// closed pipe.
    ///
    /// Only for a relay that is provably carrying nothing. coilbox sends it
    /// when a battle it was opening never opened, which is the whole of issue
    /// #2058, and the sidecar obeys it without asking any questions of its own.
    /// A battle that did open and is now over is [`Request::BattleOver`]
    /// instead, because by then coilbox cannot tell whether a game is still
    /// being played through the relay and the sidecar can.
    #[serde(rename_all = "camelCase")]
    Stop { id: RequestId },
    /// The lobby battle this relay was opened for has ended.
    ///
    /// Not an instruction to exit, and the difference is the point. A host who
    /// leaves their battle in the lobby has not necessarily ended the game: the
    /// engine keeps running and the other players are still playing through
    /// this relay. So this hands the decision to the sidecar rather than making
    /// it, in exactly the way coilbox closing does (issue #2018).
    ///
    /// What the sidecar does with it is in `coilbox-relay-agent`'s `stopping`
    /// module. The short version is that a relay no player has ever been heard
    /// through was never carrying a game, so it goes at once, and any other
    /// relay is left to the engine and the traffic backstop.
    #[serde(rename_all = "camelCase")]
    BattleOver { id: RequestId },
    /// A fresh relay credential, to sign the next allocation with.
    ///
    /// The lobby mints these with a lifetime on them and a game can outlive
    /// one. That costs nothing while the allocation stays up, because the TURN
    /// server worked the key out when it created the session and checks every
    /// later request against the key it kept. What it costs is the next
    /// allocation: a rebuild opens a new session, the credential is judged
    /// again, and a dead one answers 401 and ends the game (issue #2092).
    ///
    /// So coilbox asks the lobby for another one before the old one runs out
    /// and sends it down here. The sidecar keeps it for the next rebuild and
    /// does not touch the allocation it already has, which does not need it.
    ///
    /// ## Why the password goes down the pipe
    ///
    /// The one at startup deliberately does not: it arrives in
    /// `COILBOX_TURN_PASSWORD` rather than as an argument, because `ps` shows
    /// one process's arguments to every other process on the machine. This pipe
    /// is between the two processes and nothing else, so it is the stricter of
    /// the two channels rather than a relaxation of the rule. Nothing echoes a
    /// request back: an unreadable one is answered with the parser's complaint,
    /// which names the field that was wrong and never its contents.
    ///
    /// The relay is carried as well as the credential because the lobby names
    /// one every time it mints, and a lobby that has moved its relay would
    /// otherwise hand out a credential for a server the sidecar is not talking
    /// to. A rebuilt allocation is at a new address whatever happens, and
    /// `relay_host::readvertise` in coilbox is what tells the lobby about that.
    #[serde(rename_all = "camelCase")]
    RenewCredential {
        id: RequestId,
        /// `host:port` of the TURN server, as `--turn-server` takes it.
        server: String,
        user: String,
        password: String,
    },
}

impl Request {
    /// Which request this is, for answering it.
    pub fn id(&self) -> RequestId {
        match self {
            Request::AllowPeer { id, .. } => *id,
            Request::WatchEngine { id, .. } => *id,
            Request::Stop { id } => *id,
            Request::BattleOver { id } => *id,
            Request::RenewCredential { id, .. } => *id,
        }
    }
}

/// Something the relay agent is telling coilbox.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum Event {
    /// A relay is open and players can be told to send to `addr`.
    ///
    /// Sent every time one opens, not only the first. The agent rebuilds a
    /// lost allocation and the new one is at a different address, so a second
    /// `relayOpen` means the battle is being advertised at an address that has
    /// gone (issue #2031).
    #[serde(rename_all = "camelCase")]
    RelayOpen { addr: SocketAddr },
    /// There is no relay at the moment, for this reason. The agent is either
    /// about to try again or about to stop, and says which.
    #[serde(rename_all = "camelCase")]
    RelayDown { reason: String },
    /// How much the relay carried in the last [`TRAFFIC_EVERY`], both
    /// directions together, so a host can tell a game that is working from one
    /// that has stopped (issue #2024).
    ///
    /// Sent every interval whether or not anything moved, and the zero is the
    /// half that matters. A relay that has quietly stopped carrying a game says
    /// nothing at all, so an agent that only spoke up when it had a number to
    /// report would look identical to one that had died, and the reader would
    /// be left showing the last figure it heard forever.
    ///
    /// A rate rather than a running total because the question is whether the
    /// game is working now. A total answers "has this relay ever done anything",
    /// which the host already knows, and it would make the reader do the
    /// subtraction and hold the previous figure to do it with.
    ///
    /// One number rather than one per direction. A relay carrying a game moves
    /// traffic both ways or neither, since the engine at the far end answers
    /// what it is sent, so splitting it would offer a distinction that does not
    /// arise and put a second number in a pill that has room for one.
    #[serde(rename_all = "camelCase")]
    Traffic { bytes_per_second: u64 },
    /// The request with this id is done.
    #[serde(rename_all = "camelCase")]
    Done { id: RequestId },
    /// The request with this id will not happen, for this reason.
    ///
    /// Every request gets exactly one of this or [`Event::Done`], including a
    /// request the agent could not understand, so a caller waiting on an
    /// answer never waits forever for one that was never coming.
    #[serde(rename_all = "camelCase")]
    Failed { id: RequestId, reason: String },
    /// The agent is exiting and nothing else will arrive. Anything still
    /// waiting on an answer is not going to get one.
    #[serde(rename_all = "camelCase")]
    Stopping { reason: String },
}

/// What a running sidecar leaves on disk so it can be found again.
///
/// The other half of the contract, and here for the same reason the messages
/// are: both ends have to agree on it or a coilbox that reopens mid-game
/// spawns a second sidecar over the top of the first, and the players in that
/// game are relayed by a process nobody is talking to any more (issue #2027).
///
/// The sidecar owns the file. It creates it at startup and removes it on the
/// way out, so the file existing means a sidecar was running and its `pid` is
/// how you tell whether one still is. A sidecar killed outright leaves the file
/// behind, which is why the pid is in it rather than the file's mere existence
/// being the answer.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunFile {
    /// The sidecar's process id.
    pub pid: u32,
    /// Whether the sidecar that wrote this keeps a shared lock on the file for
    /// as long as it runs, so that [`run_file_is_still_held`] answers for it
    /// (issue #2078).
    ///
    /// A promise about behaviour, not a reading of the current state. Never
    /// treat it as "the file is locked": the file cannot know that, and the
    /// only thing that does is the kernel.
    ///
    /// False in a file from a build before the lock existed, and false when
    /// the sidecar asked for the lock and the filesystem would not give it
    /// one. Both mean the same thing to a reader, which is that a free lock
    /// proves nothing about that record and the pid is all there is to go on.
    #[serde(default)]
    pub locked: bool,
}

/// Whether the sidecar that claimed the run file at `path` is still the one
/// holding it.
///
/// ## The question this answers
///
/// A process id is unique only while its process lives. Once a sidecar has
/// gone the OS is free to hand its number to anything else, and when it does,
/// the run file names a process that is running and is not the relay agent.
/// coilbox then refuses every relayed battle for the rest of that machine's
/// uptime (issue #2078).
///
/// The pid cannot tell those apart and neither can a note: an agent reads
/// notes only once its own coilbox has closed, so a note left where nothing
/// takes it is an inference rather than proof. The lock is proof. The kernel
/// gives it up when the process that took it ends, however it ends, and it
/// gives it to nobody else in the meantime. So a free lock on a record whose
/// writer promised to hold one means the writer is dead and the pid belongs to
/// somebody else.
///
/// ## What "cannot tell" answers
///
/// True, meaning held, meaning leave it alone. A file that will not open, a
/// filesystem with no locking, or an error from the lock itself all land here,
/// because the cost of being wrong the other way is a second sidecar started
/// over a game people are playing.
///
/// Only ask this about a record whose [`RunFile::locked`] is true. A record
/// from an older build never took a lock, so its lock is free whether the
/// sidecar is alive or not.
///
/// ## Why the sidecar's lock is a shared one
///
/// So that the file it is on stays readable. Windows range locks are mandatory
/// rather than advisory, and an exclusive one denies other processes reads of
/// the locked range as well as writes. A sidecar holding the file exclusively
/// would therefore make every read of its own record fail, which reads as a
/// record that cannot be parsed, which reads as no relay running. coilbox would
/// start a second sidecar over a game people were playing, which is the failure
/// the run file exists to prevent.
///
/// A shared lock denies writes and allows reads, and an exclusive attempt still
/// fails while one is held, so the question here is answered either way.
pub fn run_file_is_still_held(path: &Path) -> bool {
    let Ok(file) = std::fs::OpenOptions::new()
        .read(true)
        .write(true)
        .open(path)
    else {
        return true;
    };
    // Write access as well as read, because Windows will not give an exclusive
    // range lock to a handle that only has read. Taking the lock here is how
    // the question is asked, and dropping the handle at the end of this
    // function gives it straight back.
    file.try_lock().is_err()
}

/// How often an agent whose coilbox has closed looks for a note asking it to
/// stop.
///
/// Here rather than in the agent because both ends need it: the agent sleeps
/// it, and coilbox multiplies it to decide how long to give a note before
/// concluding that nothing is reading them. A number that lived on one side
/// would be a number the other side guessed at.
///
/// A second, because it is the interval the agent already wakes on to decide
/// whether it should stop (`LOOK_EVERY` in `coilbox-relay-agent`'s `stopping`),
/// so a note is acted on in the same turn as everything else that could end this
/// process. The reader is a host standing in front of a hosting form waiting to
/// hear, which rules out anything much longer.
pub const NOTE_LOOKED_FOR_EVERY: Duration = Duration::from_secs(1);

/// Where coilbox leaves a note for an agent it has no pipe to.
///
/// Beside the run file, because the agent already has that path and a note in
/// any other directory would be a second thing to agree about.
pub fn stop_note_path(run_file: &Path) -> PathBuf {
    run_file.with_file_name("stop.json")
}

/// coilbox asking an agent it cannot speak to whether it would stop.
///
/// ## Why this exists at all
///
/// The control channel is the agent's stdin and stdout, and there is no
/// reattaching to a child's pipes from a process that did not spawn it
/// (issue #2074). So a coilbox that has been closed and reopened can find the
/// agent through [`RunFile`] and can say nothing to it. The only way it had of
/// clearing one was ending the process by hand, outside coilbox, which needs
/// somebody who knows what a process id is (issue #2062).
///
/// A note on disk is the channel that survives that. The agent reads it on the
/// interval above, and reads it only once its own coilbox has closed, so the
/// note is what a coilbox with no pipe says and the pipe is what a coilbox with
/// one says.
///
/// ## Why it is a request and not an order
///
/// A running agent may be carrying a game other people are still playing, which
/// is the entire reason it outlives coilbox. So this asks, and the agent
/// answers with its own stopping rule: an agent no player has ever been heard
/// through was never carrying a game and goes at once, and one that has carried
/// players keeps running. That rule is in `coilbox-relay-agent`'s `stopping`
/// module and it is the same one that already decides a battle ending.
///
/// The alternative was for coilbox to end the process itself, and it is worse
/// twice over. It could end a match, and it could end something else entirely:
/// a process id is unique only while its process lives, so a run file naming a
/// number the OS has since handed to somebody's browser would have coilbox
/// killing the browser.
///
/// ## Why it names the process it is for
///
/// So that a note nobody took cannot be acted on by the next agent to start.
/// The agent takes a note addressed to itself and leaves any other alone, which
/// makes a leftover note inert rather than a stop somebody did not ask for.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StopNote {
    /// The process the note is for, which is the `pid` in the run file coilbox
    /// read it out of.
    pub pid: u32,
}

/// What a running sidecar writes down about what it is carrying, so that a
/// coilbox which has no pipe to it can still say something true about it.
///
/// ## Why this is a file rather than a message
///
/// [`Event::Traffic`] already carries the same figure, and it goes down a pipe
/// that belongs to the coilbox which spawned the sidecar. Close that coilbox
/// and open another and the pipe is a dead process's, so the next coilbox finds
/// the sidecar through [`RunFile`], knows a relay is running, and has nothing to
/// say about it beyond that (issue #2074).
///
/// So the sidecar writes the figure down as well as saying it. A file is the
/// one channel that outlives the process that was listening, and this crate
/// already has two of them going the other way.
///
/// ## Why it is not in the run file
///
/// The run file has to mean "a relay is running" and must never read as
/// anything else, because a coilbox that reads it as absent starts a second
/// sidecar over a game people are playing. Rewriting it once a second would put
/// a torn read in the way of that, and a torn run file reads as no relay at all.
///
/// This record fails the other way round. Everything that can go wrong with it,
/// a missing file, a half written one, one from a sidecar that has since gone,
/// means coilbox does not know what the relay is carrying, and not knowing is
/// drawn as nothing rather than as a figure.
///
/// ## What it deliberately does not carry
///
/// Whether the engine is still running, which the sidecar does know: coilbox
/// names the engine's process (issue #2065) and the sidecar watches it. It is
/// left out because it is a weaker fact than the rate and answers the same
/// question worse. A process id reads as alive again once the OS hands the
/// number on, where a rate is measured from datagrams that really moved.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Carrying {
    /// The sidecar that wrote it, which is the `pid` in the run file beside it.
    ///
    /// Here so that a record left behind by a sidecar that was killed cannot be
    /// read as the current one's. The same reason [`StopNote`] names a process,
    /// and the same failure if it did not: a figure from a relay that has gone,
    /// shown as one from the relay that is there.
    pub pid: u32,
    /// How much the relay carried in the last [`TRAFFIC_EVERY`], both
    /// directions together. The same figure [`Event::Traffic`] carries and from
    /// the same count, so a host watching the pipe and a host reading the file
    /// cannot be shown different numbers.
    pub bytes_per_second: u64,
}

impl Carrying {
    /// The record's contents. Serialising cannot fail for the same reason
    /// [`to_line`] cannot.
    pub fn to_json(&self) -> String {
        match serde_json::to_string(self) {
            Ok(json) => json,
            Err(e) => unreachable!("a carrying record that will not serialise: {e}"),
        }
    }

    /// Read one, or say why it is not one.
    pub fn from_json(text: &str) -> Result<Carrying, String> {
        serde_json::from_str(text).map_err(|e| format!("not a relay agent carrying record: {e}"))
    }
}

/// Where the sidecar writes down what it is carrying.
///
/// Beside the run file, like the stop note, because that is the one path both
/// ends already have.
pub fn carrying_path(run_file: &Path) -> PathBuf {
    run_file.with_file_name("carrying.json")
}

/// How old a [`Carrying`] record may be before it is no news rather than news.
///
/// Three of the sidecar's own reporting intervals, which is the same rule
/// `STALE_AFTER` in `tauri-plugin-coilbox-multiplayer`'s `relay_agent` applies
/// to the figure that comes down the pipe, and it is derived from
/// [`TRAFFIC_EVERY`] rather than picked. The sidecar rewrites this every
/// interval whether or not anything moved, so one interval missed is a
/// scheduler having a bad moment on a machine that is running a game, and three
/// in a row is something wrong with the sidecar.
///
/// It has to exist even though the run file already proves the sidecar is
/// alive, because those are different questions. The lock says the process is
/// there. This says the process is still measuring. A sidecar whose reporting
/// has stopped while the process lives would otherwise leave the last healthy
/// rate on screen for the rest of the game, which is the opposite of what the
/// figure is for.
pub const CARRYING_STALE_AFTER: Duration = TRAFFIC_EVERY.saturating_mul(3);

/// What the sidecar running as `pid` is carrying right now, as far as anybody
/// out here can tell.
///
/// `None` is every way of not knowing, and they all mean the same thing to the
/// caller: no record, one that will not read, one from a different sidecar, one
/// older than [`CARRYING_STALE_AFTER`], and a clock that has moved backwards
/// under it. Draw nothing for all of them. Zero is a different answer and a real
/// one, and means the relay is there and carrying nothing.
///
/// `pid` comes from [`RunFile`] rather than being taken on trust from the
/// record, so a record a dead sidecar left behind cannot be read as the live
/// one's.
///
/// The age is the file's own modification time rather than a timestamp inside
/// it. The writer would have to read a clock to put one there and the reader
/// would have to trust it, where this is the one the filesystem stamped on the
/// write itself.
pub fn carrying_now(run_file: &Path, pid: u32) -> Option<u64> {
    let path = carrying_path(run_file);
    let written = std::fs::metadata(&path).ok()?.modified().ok()?;
    // `duration_since` fails when the file is stamped in the future, which is a
    // clock that has moved. That is not knowing, so it lands with the rest.
    if std::time::SystemTime::now().duration_since(written).ok()? >= CARRYING_STALE_AFTER {
        return None;
    }
    let record = Carrying::from_json(&std::fs::read_to_string(&path).ok()?).ok()?;
    (record.pid == pid).then_some(record.bytes_per_second)
}

impl StopNote {
    /// The note's contents. Serialising cannot fail for the same reason
    /// [`to_line`] cannot.
    pub fn to_json(&self) -> String {
        match serde_json::to_string(self) {
            Ok(json) => json,
            Err(e) => unreachable!("a stop note that will not serialise: {e}"),
        }
    }

    /// Read one, or say why it is not one.
    ///
    /// An unreadable note is treated as a note for somebody else, so a half
    /// written file or one from another version never stops an agent.
    pub fn from_json(text: &str) -> Result<StopNote, String> {
        serde_json::from_str(text).map_err(|e| format!("not a relay agent stop note: {e}"))
    }
}

impl RunFile {
    /// The file's contents. Serialising cannot fail for the same reason
    /// [`to_line`] cannot.
    pub fn to_json(&self) -> String {
        match serde_json::to_string(self) {
            Ok(json) => json,
            Err(e) => unreachable!("a run file that will not serialise: {e}"),
        }
    }

    /// Read one, or say why it is not one.
    ///
    /// A file left behind by a different version of coilbox is unreadable
    /// rather than fatal, and the caller treats that the same as no file: the
    /// worst it can do is spawn a sidecar when one was already there, which is
    /// the behaviour before any of this existed.
    pub fn from_json(text: &str) -> Result<RunFile, String> {
        serde_json::from_str(text).map_err(|e| format!("not a relay agent run file: {e}"))
    }
}

/// One message as a line, `\n` included.
///
/// Serialising a [`Request`] or an [`Event`] cannot fail: both are plain data
/// with no map keys that are not strings, so the error case here is
/// unreachable rather than swallowed.
pub fn to_line<T: Serialize>(message: &T) -> String {
    match serde_json::to_string(message) {
        Ok(json) => format!("{json}\n"),
        Err(e) => unreachable!("a control message that will not serialise: {e}"),
    }
}

/// A request line the agent could not act on, and the id to blame it on.
///
/// The id is the point. A newer coilbox sending a request an older sidecar has
/// never heard of is exactly the case that must not hang, so the id is dug out
/// of the raw JSON before the shape is checked.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Unreadable {
    /// The `id` field if the line had a usable one, so the sender can be told
    /// which of its requests this was.
    pub id: Option<RequestId>,
    /// A sentence, for a human reading a log or a failure message.
    pub reason: String,
}

/// Read one request line.
pub fn read_request(line: &str) -> Result<Request, Unreadable> {
    let value: serde_json::Value = serde_json::from_str(line).map_err(|e| Unreadable {
        id: None,
        reason: format!("not a JSON object: {e}"),
    })?;
    // Pulled out before the shape is checked, so an unknown request type is
    // still answerable. Without this, teaching coilbox a new request would make
    // every older sidecar swallow it silently.
    let id = value.get("id").and_then(serde_json::Value::as_u64);
    serde_json::from_value(value).map_err(|e| Unreadable {
        id,
        reason: format!("not a request this agent knows: {e}"),
    })
}

/// Read one event line.
///
/// No id salvage here, because events are not answered. A caller that cannot
/// read one has nothing to say back and should log it and carry on, which is
/// how an older coilbox survives a newer sidecar.
pub fn read_event(line: &str) -> Result<Event, String> {
    serde_json::from_str(line).map_err(|e| format!("not an event this coilbox knows: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::Ipv4Addr;

    /// The wire text itself, spelled out.
    ///
    /// Both halves of a relayed battle ship separately: somebody can be running
    /// a sidecar from one release and a coilbox from another, and three more
    /// issues are going to add to these enums. So the assertion is the exact
    /// bytes, not a round trip, because a round trip passes happily while a
    /// field is being renamed under both ends at once.
    #[test]
    fn the_wire_text_is_what_both_ends_agreed_on() {
        assert_eq!(
            to_line(&Request::AllowPeer {
                id: 7,
                ip: IpAddr::V4(Ipv4Addr::new(198, 51, 100, 4)),
            }),
            "{\"type\":\"allowPeer\",\"id\":7,\"ip\":\"198.51.100.4\"}\n"
        );
        assert_eq!(
            to_line(&Request::WatchEngine { id: 8, pid: 4021 }),
            "{\"type\":\"watchEngine\",\"id\":8,\"pid\":4021}\n"
        );
        assert_eq!(
            to_line(&Request::Stop { id: 9 }),
            "{\"type\":\"stop\",\"id\":9}\n"
        );
        assert_eq!(
            to_line(&Request::BattleOver { id: 10 }),
            "{\"type\":\"battleOver\",\"id\":10}\n"
        );
        assert_eq!(
            to_line(&Request::RenewCredential {
                id: 11,
                server: "relay.example.org:3478".to_string(),
                user: "1786086400:alice".to_string(),
                password: "bWFj=".to_string(),
            }),
            "{\"type\":\"renewCredential\",\"id\":11,\"server\":\"relay.example.org:3478\",\
             \"user\":\"1786086400:alice\",\"password\":\"bWFj=\"}\n"
        );
        assert_eq!(
            to_line(&Event::RelayOpen {
                addr: SocketAddr::from(([198, 51, 100, 7], 41641)),
            }),
            "{\"type\":\"relayOpen\",\"addr\":\"198.51.100.7:41641\"}\n"
        );
        assert_eq!(
            to_line(&Event::Traffic {
                bytes_per_second: 41_984,
            }),
            "{\"type\":\"traffic\",\"bytesPerSecond\":41984}\n"
        );
        assert_eq!(
            to_line(&Event::Done { id: 7 }),
            "{\"type\":\"done\",\"id\":7}\n"
        );
        assert_eq!(
            to_line(&Event::Failed {
                id: 7,
                reason: "no relay".to_string(),
            }),
            "{\"type\":\"failed\",\"id\":7,\"reason\":\"no relay\"}\n"
        );
    }

    #[test]
    fn a_request_survives_the_trip() {
        let asked = Request::AllowPeer {
            id: 12,
            ip: IpAddr::V4(Ipv4Addr::new(203, 0, 113, 9)),
        };
        assert_eq!(read_request(to_line(&asked).trim()), Ok(asked));
    }

    #[test]
    fn an_event_survives_the_trip() {
        let said = Event::RelayDown {
            reason: "the server refused it".to_string(),
        };
        assert_eq!(read_event(to_line(&said).trim()), Ok(said));
    }

    /// The forward compatibility that makes adding a variant safe: a request
    /// from a newer coilbox is refused with its own id attached, so the newer
    /// coilbox learns this sidecar cannot do it rather than waiting on an
    /// answer that is never coming.
    #[test]
    fn a_request_this_agent_has_never_heard_of_is_still_answerable() {
        let unreadable = read_request("{\"type\":\"rebindPeer\",\"id\":31,\"ip\":\"203.0.113.9\"}")
            .expect_err("a type from the future is not a request this build knows");
        assert_eq!(unreadable.id, Some(31));
    }

    /// A renewal a sidecar cannot read must not quote it back.
    ///
    /// The answer goes to coilbox, which already has the credential, but it is
    /// written to the sidecar's log on the way and that log is what somebody
    /// attaches to a bug report. So the reason has to name the shape and not the
    /// contents. This is the whole of why the password is safe on this channel.
    #[test]
    fn a_renewal_that_cannot_be_read_is_refused_without_repeating_the_password() {
        let unreadable = read_request(
            "{\"type\":\"renewCredential\",\"id\":11,\"server\":\"relay.example.org:3478\",\
             \"user\":\"1786086400:alice\"}",
        )
        .expect_err("a renewal with no password is not one");
        assert_eq!(unreadable.id, Some(11));
        assert!(
            !unreadable.reason.contains("1786086400:alice"),
            "the reason must not carry the credential: {}",
            unreadable.reason
        );
    }

    /// The same line with no id at all, which is a genuinely broken sender
    /// rather than a newer one. There is nobody to answer, and saying so is
    /// all that can be done.
    #[test]
    fn a_request_with_no_id_has_nobody_to_answer() {
        let unreadable =
            read_request("{\"type\":\"allowPeer\"}").expect_err("a request with no id is not one");
        assert_eq!(unreadable.id, None);
    }

    /// The run file both ends read, spelled out for the same reason the
    /// messages are: coilbox writing one shape and the sidecar reading another
    /// is a relay that cannot be found, which costs a game rather than a
    /// message.
    #[test]
    fn the_run_file_is_what_both_ends_agreed_on() {
        assert_eq!(
            RunFile {
                pid: 4021,
                locked: true,
            }
            .to_json(),
            "{\"pid\":4021,\"locked\":true}"
        );
        assert_eq!(
            RunFile::from_json("{\"pid\":4021,\"locked\":true}").expect("its own output"),
            RunFile {
                pid: 4021,
                locked: true,
            }
        );
        assert!(
            RunFile::from_json("4021").is_err(),
            "a file from some other version is unreadable rather than misread"
        );
    }

    /// A file written before the lock existed. It has to keep reading, and it
    /// has to read as a record whose lock says nothing, or upgrading coilbox
    /// while a relay agent from the old build is carrying a game would have the
    /// new coilbox clear a record belonging to a live sidecar.
    #[test]
    fn a_run_file_from_before_the_lock_reads_as_one_that_never_took_one() {
        assert_eq!(
            RunFile::from_json("{\"pid\":4021}").expect("a file an older build wrote"),
            RunFile {
                pid: 4021,
                locked: false,
            }
        );
    }

    /// The proof itself, in the two states that matter. Nothing holding the
    /// file is what tells a record left over from a dead sidecar apart from one
    /// naming a sidecar that is still relaying.
    #[test]
    fn a_run_file_nothing_has_open_is_not_being_held() {
        let dir = tempfile::tempdir().expect("a temp dir");
        let path = dir.path().join("agent.json");
        std::fs::write(
            &path,
            RunFile {
                pid: 4021,
                locked: true,
            }
            .to_json(),
        )
        .expect("a writable temp dir");

        assert!(!run_file_is_still_held(&path));

        let held = std::fs::OpenOptions::new()
            .read(true)
            .write(true)
            .open(&path)
            .expect("the file is there");
        held.try_lock_shared().expect("nothing else has it");
        assert!(
            run_file_is_still_held(&path),
            "a sidecar that is still running holds its own run file, and clearing that record \
             would start a second sidecar over a game people are playing"
        );
        assert!(
            RunFile::from_json(&std::fs::read_to_string(&path).expect("a readable record")).is_ok(),
            "the record has to stay readable under the sidecar's lock. Windows range locks are \
             mandatory, so an exclusive one would make this read fail, and a record that will \
             not read is a record coilbox treats as no relay running"
        );
    }

    /// No file at all. Nothing here can open it, and the safe answer to a
    /// question that cannot be asked is the one that changes nothing.
    #[test]
    fn a_run_file_that_will_not_open_is_treated_as_held() {
        let dir = tempfile::tempdir().expect("a temp dir");
        assert!(run_file_is_still_held(
            &dir.path().join("nothing-here.json")
        ));
    }

    /// The note, spelled out for the same reason the run file is. coilbox
    /// writing one shape and the agent reading another is a note nobody takes,
    /// which reads to a host exactly like an agent that will not stop.
    #[test]
    fn the_stop_note_is_what_both_ends_agreed_on() {
        assert_eq!(StopNote { pid: 4021 }.to_json(), "{\"pid\":4021}");
        assert_eq!(
            StopNote::from_json("{\"pid\":4021}").expect("its own output"),
            StopNote { pid: 4021 }
        );
        assert!(
            StopNote::from_json("{\"pid\":").is_err(),
            "a half written note is unreadable rather than misread, because misreading one \
             stops an agent that was never asked to stop"
        );
    }

    /// The note sits beside the run file, so the agent that reads one has the
    /// path to the other already.
    #[test]
    fn the_stop_note_sits_beside_the_run_file() {
        assert_eq!(
            stop_note_path(Path::new("/data/relay/agent.json")),
            Path::new("/data/relay/stop.json")
        );
    }

    /// The carrying record, spelled out for the same reason the run file is.
    /// The sidecar and coilbox ship separately, and a field that means one thing
    /// on one side and nothing on the other is a host shown no figure at all.
    #[test]
    fn the_carrying_record_is_what_both_ends_agreed_on() {
        assert_eq!(
            Carrying {
                pid: 4021,
                bytes_per_second: 41_984,
            }
            .to_json(),
            "{\"pid\":4021,\"bytesPerSecond\":41984}"
        );
        assert_eq!(
            Carrying::from_json("{\"pid\":4021,\"bytesPerSecond\":41984}").expect("its own output"),
            Carrying {
                pid: 4021,
                bytes_per_second: 41_984,
            }
        );
        assert!(
            Carrying::from_json("{\"pid\":4021").is_err(),
            "a half written record is unreadable rather than misread"
        );
    }

    /// It sits beside the run file, so a coilbox that found one has the path to
    /// the other already.
    #[test]
    fn the_carrying_record_sits_beside_the_run_file() {
        assert_eq!(
            carrying_path(Path::new("/data/relay/agent.json")),
            Path::new("/data/relay/carrying.json")
        );
    }

    /// Write a carrying record where a sidecar running as `pid` would have.
    fn a_relay_says_it_is_carrying(run_file: &Path, pid: u32, bytes_per_second: u64) {
        std::fs::write(
            carrying_path(run_file),
            Carrying {
                pid,
                bytes_per_second,
            }
            .to_json(),
        )
        .expect("a writable temp dir");
    }

    /// The whole point: a coilbox with no pipe to the sidecar reads the figure
    /// the sidecar wrote down, rather than having nothing to say.
    #[test]
    fn a_fresh_record_from_this_sidecar_is_what_it_is_carrying() {
        let dir = tempfile::tempdir().expect("a temp dir");
        let run_file = dir.path().join("agent.json");
        a_relay_says_it_is_carrying(&run_file, 4021, 41_984);

        assert_eq!(carrying_now(&run_file, 4021), Some(41_984));
    }

    /// Zero is a real answer and not a missing one. A relay that is up and
    /// quiet is exactly what somebody reopening coilbox mid-game wants to be
    /// told apart from a relay that has died.
    #[test]
    fn a_relay_carrying_nothing_is_not_the_same_as_no_record() {
        let dir = tempfile::tempdir().expect("a temp dir");
        let run_file = dir.path().join("agent.json");
        a_relay_says_it_is_carrying(&run_file, 4021, 0);

        assert_eq!(carrying_now(&run_file, 4021), Some(0));
    }

    /// A record a sidecar that has since gone left behind. The pid in the run
    /// file is the only one worth believing, so a figure from a relay that is
    /// not there is no figure at all.
    #[test]
    fn a_record_from_a_different_sidecar_says_nothing_about_this_one() {
        let dir = tempfile::tempdir().expect("a temp dir");
        let run_file = dir.path().join("agent.json");
        a_relay_says_it_is_carrying(&run_file, 4021, 41_984);

        assert_eq!(carrying_now(&run_file, 4022), None);
    }

    /// A sidecar that is alive and has stopped measuring. The run file lock
    /// still says the process is there, so without the age check the last
    /// healthy rate would sit on screen for the rest of the game.
    #[test]
    fn a_record_older_than_the_sidecar_would_ever_leave_it_is_no_news() {
        let dir = tempfile::tempdir().expect("a temp dir");
        let run_file = dir.path().join("agent.json");
        a_relay_says_it_is_carrying(&run_file, 4021, 41_984);
        let long_ago = std::time::SystemTime::now() - CARRYING_STALE_AFTER - Duration::from_secs(1);
        std::fs::File::open(carrying_path(&run_file))
            .expect("the record is there")
            .set_modified(long_ago)
            .expect("a temp dir that takes a modification time");

        assert_eq!(carrying_now(&run_file, 4021), None);
    }

    /// No record at all, which is a sidecar from a build before this existed
    /// and is the ordinary answer for most of coilbox's life. Nothing to say
    /// rather than something to guess.
    #[test]
    fn no_record_is_nothing_to_say_rather_than_a_figure() {
        let dir = tempfile::tempdir().expect("a temp dir");
        assert_eq!(carrying_now(&dir.path().join("agent.json"), 4021), None);
    }

    /// Half a record, which is what a reader can catch mid-write if the writer
    /// ever stops replacing the file whole. Not a figure, and not a crash.
    #[test]
    fn a_record_that_will_not_read_is_nothing_to_say() {
        let dir = tempfile::tempdir().expect("a temp dir");
        let run_file = dir.path().join("agent.json");
        std::fs::write(carrying_path(&run_file), "{\"pid\":4021,\"bytesPer")
            .expect("a writable temp dir");

        assert_eq!(carrying_now(&run_file, 4021), None);
    }

    #[test]
    fn a_line_that_is_not_json_is_refused_rather_than_guessed_at() {
        let unreadable = read_request("coilbox-relay-agent: a log line").expect_err("not JSON");
        assert_eq!(unreadable.id, None);
    }

    /// An older coilbox reading a newer sidecar. Nothing to answer, so the
    /// only requirement is that it does not take the connection down with it.
    #[test]
    fn an_event_this_coilbox_has_never_heard_of_is_refused_not_guessed_at() {
        assert!(read_event("{\"type\":\"trafficSoFar\",\"bytes\":9001}").is_err());
    }
}
