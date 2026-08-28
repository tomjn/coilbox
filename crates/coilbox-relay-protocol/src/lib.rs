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
//! ## Why the shapes live in a crate of their own
//!
//! Both halves derive their wire shape from these declarations, so a field that
//! changes name or type breaks both builds at once rather than one of them at
//! runtime, in a released sidecar, during somebody's game. That is the whole
//! reason this is not two copies of a struct.
//!
//! It is deliberately IO-free and deliberately has no tokio. The coilbox side
//! can depend on it without pulling in the sidecar's TURN stack, and each end
//! carries the lines however it already carries lines.
//!
//! ## Adding to it later
//!
//! Both enums are internally tagged on `type`, so a new variant is additive:
//! an end that does not know it reads the tag, fails to match, and says so
//! rather than misreading the message as something else. Three issues are
//! already queued to add variants, and the shape here is chosen for them:
//!
//! - Traffic figures for the in-game badge (issue #2024) are a new [`Event`],
//!   pushed rather than polled.
//! - "This new address is the player who was at that old one" (issue #2029) is
//!   a new [`Request`], answered by the same [`Event::Done`] and
//!   [`Event::Failed`] pair as any other.
//! - A relayed address that changed because the sidecar rebuilt its allocation
//!   (issue #2031) is already [`Event::RelayOpen`], which is sent every time a
//!   relay opens rather than only the first.
//!
//! Answers are keyed on the request's `id` rather than being a per-request
//! variant, which is what lets a new request type reuse them.

use std::net::{IpAddr, SocketAddr};

use serde::{Deserialize, Serialize};

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
    #[serde(rename_all = "camelCase")]
    Stop { id: RequestId },
}

impl Request {
    /// Which request this is, for answering it.
    pub fn id(&self) -> RequestId {
        match self {
            Request::AllowPeer { id, .. } => *id,
            Request::WatchEngine { id, .. } => *id,
            Request::Stop { id } => *id,
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
            to_line(&Event::RelayOpen {
                addr: SocketAddr::from(([198, 51, 100, 7], 41641)),
            }),
            "{\"type\":\"relayOpen\",\"addr\":\"198.51.100.7:41641\"}\n"
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
        assert_eq!(RunFile { pid: 4021 }.to_json(), "{\"pid\":4021}");
        assert_eq!(
            RunFile::from_json("{\"pid\":4021}").expect("its own output"),
            RunFile { pid: 4021 }
        );
        assert!(
            RunFile::from_json("4021").is_err(),
            "a file from some other version is unreadable rather than misread"
        );
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
