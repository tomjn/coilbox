//! The IO half of a host-run room: a listener, one task per socket, and one task
//! that owns the room's state.
//!
//! [`RoomState`] decides what every peer is told and knows nothing about sockets.
//! This decides what a socket is. The split is the same one the lobby client
//! already uses, where `coilbox-lobby-protocol` owns the protocol and the plugin
//! owns the wire.
//!
//! # Why one task owns the state
//!
//! [`RoomState::apply`] answers one command with an ordered list of lines, and
//! that order is load bearing: a joiner's start boxes are dropped in silence if
//! they arrive before their join acknowledgement, and a peer being closed has to
//! see the refusal that closed it first. A single owning task delivers a batch
//! start to finish before it looks at the next command, which is what makes the
//! order the room decided the order the peer reads. A shared lock would not.
//!
//! # Keeping peers alive
//!
//! The room answers a client's `PING` with `PONG` and never pings first: our
//! client sends its own keepalive every 30 seconds and expects nothing back.
//! That keepalive is also how a room notices a peer that is gone rather than
//! quiet. A closed laptop lid does not close a TCP connection, and the name on
//! that connection would block its owner from reconnecting under it, so a peer
//! that has said nothing for [`IDLE_TIMEOUT`] is treated as disconnected.

use std::collections::BTreeMap;
use std::time::Duration;

use coilbox_lobby_protocol::server::{
    line, parse_client_line, ClientCommand, Outbound, PeerId, RoomConfig, RoomState,
};
use coilbox_lobby_protocol::Battle;
use futures_util::{SinkExt, StreamExt};
use serde::Serialize;
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::{mpsc, oneshot};
use tokio::task::JoinHandle;
use tokio::time::Instant;
use tokio_util::codec::{Framed, LinesCodec};

use crate::beacon::{self, Beacon, BEACON_INTERVAL};
use crate::discovery::announce_once;

/// The port a room listens on unless the host picks another. Distinct from the
/// engine's game port (8452), which the engine binds itself and this never
/// touches.
pub const DEFAULT_LOBBY_PORT: u16 = 8200;

/// How long a peer may say nothing before the room treats it as gone.
///
/// Three of our client's 30 second keepalives. Long enough that a stalled
/// machine is not thrown out for one late ping, short enough that a name is
/// free again while its owner is still trying to get back in.
const IDLE_TIMEOUT: Duration = Duration::from_secs(90);

/// How often idle peers are looked for.
const SWEEP_INTERVAL: Duration = Duration::from_secs(15);

/// What the caller has to decide before a room can listen.
#[derive(Clone, Debug)]
pub struct RoomOptions {
    /// The player who holds host powers. Their client connects over loopback
    /// like anybody else, so the name is the only thing that marks them out.
    pub host: String,
    /// The address a joining engine dials, announced in `BATTLEOPENED`. The
    /// host's LAN address on a LAN, the mapped public one behind a router.
    pub ip: String,
    /// The port to listen on.
    pub port: u16,
    /// Whether a join waits for the host to answer it.
    pub approve_joins: bool,
    /// Whether the room announces itself on the local network, so somebody on
    /// the same network finds it without being told an address.
    pub advertise: bool,
}

/// A running room, as the frontend sees it.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RoomStatus {
    /// The port the room is listening on, which is what the host's own client
    /// dials over loopback and what a joiner has to be given.
    pub port: u16,
    pub host: String,
    pub ip: String,
    pub approve_joins: bool,
    /// Open sockets, logged in or not.
    pub peers: usize,
    /// Names waiting on the host's answer, oldest first. Empty unless
    /// `approve_joins` is on.
    pub pending: Vec<String>,
    /// The battle as the room believes it, script passwords included. This is
    /// the host's own room, and the host is the only one it is shown to.
    pub battle: Option<Battle>,
}

/// A handle on a running room. Dropping it does not stop the room, so end one
/// with [`Room::stop`].
pub struct Room {
    port: u16,
    options: RoomOptions,
    /// Names this run of this room in its beacons, so the host can pick its own
    /// room out of the list it hears.
    beacon_id: String,
    requests: mpsc::UnboundedSender<Request>,
    listener: JoinHandle<()>,
    /// The task announcing this room, if it is being announced.
    announcer: Option<JoinHandle<()>>,
}

/// Something for the task that owns the room state to do.
enum Request {
    /// A socket has been accepted, with the channel its writer reads from. Sent
    /// before the peer's task starts, so no line of theirs can overtake it.
    Accept {
        peer: PeerId,
        out: mpsc::UnboundedSender<PeerMsg>,
    },
    /// One line read off a peer's socket.
    Line {
        peer: PeerId,
        line: String,
    },
    /// A peer's socket has ended, politely or otherwise.
    Gone {
        peer: PeerId,
    },
    Status(oneshot::Sender<RoomStatus>),
    /// The host's answer to a queued join, applied as though they had sent it.
    AnswerJoin {
        name: String,
        allow: bool,
        reason: Option<String>,
    },
    /// Say why, close every socket, and stop.
    Stop {
        reason: String,
        done: oneshot::Sender<()>,
    },
}

/// Something for one peer's task to write, or to stop on.
enum PeerMsg {
    Line(String),
    /// Close this connection once the lines already queued for it have gone out.
    Close,
}

/// One connected socket.
struct Peer {
    out: mpsc::UnboundedSender<PeerMsg>,
    /// When this peer last said anything. See [`IDLE_TIMEOUT`]. The runtime's
    /// clock rather than the system one, so it is the same clock the sweep
    /// interval runs on.
    heard: Instant,
}

impl Room {
    /// Bind the listener and start the room.
    ///
    /// Fails if the port is taken, which is the failure a host meets most: a
    /// second coilbox, or a room they forgot they left running.
    pub async fn start(options: RoomOptions) -> Result<Room, String> {
        // 0.0.0.0 rather than loopback: the host's own client is not the only
        // one that has to reach this, and a LAN peer cannot dial 127.0.0.1.
        let bind = format!("0.0.0.0:{}", options.port);
        let listener = TcpListener::bind(&bind)
            .await
            .map_err(|e| format!("cannot listen on port {}: {e}", options.port))?;
        // Asked for port 0, the OS picks one, and this is the only place that
        // learns which.
        let port = listener
            .local_addr()
            .map_err(|e| format!("cannot read the listening address: {e}"))?
            .port();

        let state = RoomState::new(RoomConfig {
            host: options.host.clone(),
            ip: options.ip.clone(),
            approve_joins: options.approve_joins,
        });
        let (requests, rx) = mpsc::unbounded_channel();
        tokio::spawn(run_room(state, options.clone(), port, rx));
        let listener = tokio::spawn(accept_loop(listener, requests.clone()));

        let beacon_id = beacon::room_id();
        let announcer = options
            .advertise
            .then(|| tokio::spawn(announce_loop(beacon_id.clone(), requests.clone())));

        Ok(Room {
            port,
            options,
            beacon_id,
            requests,
            listener,
            announcer,
        })
    }

    /// The port the room is listening on. The host's own client dials this on
    /// loopback, and a joiner is given it alongside [`RoomOptions::ip`].
    pub fn port(&self) -> u16 {
        self.port
    }

    /// What this room calls itself in its beacons. A listener hearing this id is
    /// hearing us, which is how the host's own room is marked in a list of rooms
    /// on the network rather than shown as somebody else's.
    pub fn beacon_id(&self) -> &str {
        &self.beacon_id
    }

    /// What the room holds right now. `None` once the room has stopped.
    pub async fn status(&self) -> Option<RoomStatus> {
        let (tx, rx) = oneshot::channel();
        self.requests.send(Request::Status(tx)).ok()?;
        rx.await.ok()
    }

    /// Answer a join the room has queued, as the host would.
    ///
    /// Approval is deliberately absent from the wire: `JOINBATTLEREQUEST` is how
    /// a real server would ask the host, but our own client answers that with an
    /// automatic accept, which would wave every join through before the host saw
    /// it. So the host's answer is applied here instead, against the peer they
    /// are logged in on.
    ///
    /// The room ignores an answer to a join it is not holding, so a stale one is
    /// harmless.
    pub fn answer_join(&self, name: &str, allow: bool, reason: Option<String>) {
        let _ = self.requests.send(Request::AnswerJoin {
            name: name.to_string(),
            allow,
            reason,
        });
    }

    /// Stop listening and disconnect everybody, telling them why first.
    ///
    /// Returns once the port is free, so a host who stops and restarts on the
    /// same port is not told it is in use by the room they just closed.
    pub async fn stop(self, reason: &str) {
        // The beacon first: a room that is closing must stop telling the network
        // it is open, or it stays in everybody's list for another few seconds.
        if let Some(announcer) = self.announcer {
            announcer.abort();
            let _ = announcer.await;
        }
        // Then the listener: a socket accepted after the room task has gone
        // would be a connection nothing ever answers.
        self.listener.abort();
        let _ = self.listener.await;

        let (tx, rx) = oneshot::channel();
        if self
            .requests
            .send(Request::Stop {
                reason: reason.to_string(),
                done: tx,
            })
            .is_ok()
        {
            let _ = rx.await;
        }
    }

    /// The options the room was started with.
    pub fn options(&self) -> &RoomOptions {
        &self.options
    }
}

/// Accept sockets until the task is cancelled, giving each one its own peer id
/// and its own task.
async fn accept_loop(listener: TcpListener, requests: mpsc::UnboundedSender<Request>) {
    let mut next: PeerId = 1;
    loop {
        let Ok((stream, _)) = listener.accept().await else {
            // A per-connection accept error (a peer that went away between the
            // handshake and here) is not the listener's death, so keep going.
            continue;
        };
        // Nagle would hold a one line reply back waiting for a second one, and
        // every line here is a reply somebody is blocked on.
        let _ = stream.set_nodelay(true);

        let peer = next;
        next += 1;
        let (out, rx) = mpsc::unbounded_channel();
        if requests.send(Request::Accept { peer, out }).is_err() {
            // The room has stopped, so there is nobody to serve this socket.
            return;
        }
        tokio::spawn(run_peer(stream, peer, requests.clone(), rx));
    }
}

/// One socket, read and written by the one task, exactly as the client side does
/// it. A single owner means a close writes what it owes and then drops the
/// socket, with no shutdown handshake between two halves to get wrong.
async fn run_peer(
    stream: TcpStream,
    peer: PeerId,
    requests: mpsc::UnboundedSender<Request>,
    mut out: mpsc::UnboundedReceiver<PeerMsg>,
) {
    let mut framed = Framed::new(stream, LinesCodec::new());
    loop {
        tokio::select! {
            item = framed.next() => match item {
                Some(Ok(line)) => {
                    if requests.send(Request::Line { peer, line }).is_err() {
                        break;
                    }
                }
                // A malformed line is a dead socket's problem, not a protocol
                // one: `parse_client_line` has no error case.
                Some(Err(_)) | None => break,
            },
            msg = out.recv() => match msg {
                Some(PeerMsg::Line(line)) => {
                    if framed.send(line).await.is_err() {
                        break;
                    }
                }
                // The queue is drained in order, so anything the room owed this
                // peer has already been written by the time the close arrives.
                Some(PeerMsg::Close) | None => break,
            },
        }
    }
    let _ = requests.send(Request::Gone { peer });
}

/// The task that owns the room state. Every change to it happens here, one
/// batch at a time.
async fn run_room(
    mut state: RoomState,
    options: RoomOptions,
    port: u16,
    mut rx: mpsc::UnboundedReceiver<Request>,
) {
    let mut peers: BTreeMap<PeerId, Peer> = BTreeMap::new();
    let mut sweep = tokio::time::interval(SWEEP_INTERVAL);
    // The first tick fires at once, so skip it. Nobody should be swept before
    // they have had a chance to speak.
    sweep.tick().await;

    loop {
        tokio::select! {
            request = rx.recv() => {
                let Some(request) = request else { return };
                match request {
                    Request::Accept { peer, out } => {
                        peers.insert(peer, Peer { out, heard: Instant::now() });
                        deliver(&peers, state.connect(peer));
                    }
                    Request::Line { peer, line } => {
                        if let Some(p) = peers.get_mut(&peer) {
                            p.heard = Instant::now();
                        }
                        deliver(&peers, state.apply(peer, parse_client_line(&line)));
                    }
                    Request::Gone { peer } => {
                        peers.remove(&peer);
                        deliver(&peers, state.disconnect(peer));
                    }
                    Request::Status(reply) => {
                        let _ = reply.send(status_of(&state, &options, port, peers.len()));
                    }
                    Request::AnswerJoin { name, allow, reason } => {
                        let Some(host) = state.host_peer() else { continue };
                        let answer = if allow {
                            ClientCommand::JoinBattleAccept { username: name }
                        } else {
                            ClientCommand::JoinBattleDeny { username: name, reason }
                        };
                        deliver(&peers, state.apply(host, answer));
                    }
                    Request::Stop { reason, done } => {
                        for peer in peers.keys().copied() {
                            deliver(&peers, vec![
                                Outbound::To { peer, line: line::server_msg(&reason) },
                                Outbound::Close { peer },
                            ]);
                        }
                        let _ = done.send(());
                        return;
                    }
                }
            }
            _ = sweep.tick() => {
                for peer in idle_peers(&peers, Instant::now()) {
                    peers.remove(&peer);
                    deliver(&peers, state.disconnect(peer));
                }
            }
        }
    }
}

/// Announce this room every [`BEACON_INTERVAL`] until the task is aborted.
///
/// The room is asked what it holds on every tick rather than being described
/// once, because the player count, the map and the game all change while a room
/// runs, and a beacon that says otherwise sends people to a room that is not
/// there any more. It is the same answer `direct_room_status` gives the host's
/// own screen, so there is one source of truth and not two.
///
/// A room with no battle in it yet is not announced. See
/// [`Beacon::from_status`].
async fn announce_loop(id: String, requests: mpsc::UnboundedSender<Request>) {
    let mut tick = tokio::time::interval(BEACON_INTERVAL);
    loop {
        tick.tick().await;
        let (tx, rx) = oneshot::channel();
        // The room has stopped, so there is nothing left to announce.
        if requests.send(Request::Status(tx)).is_err() {
            return;
        }
        let Ok(status) = rx.await else { return };
        let Some(beacon) = Beacon::from_status(&status, &id) else {
            continue;
        };
        let bytes = beacon::encode(&beacon).into_bytes();
        // Sending is a handful of blocking socket calls, so it happens off the
        // runtime's worker threads.
        let _ = tokio::task::spawn_blocking(move || announce_once(&bytes)).await;
    }
}

/// Peers that have said nothing for [`IDLE_TIMEOUT`].
fn idle_peers(peers: &BTreeMap<PeerId, Peer>, now: Instant) -> Vec<PeerId> {
    peers
        .iter()
        .filter(|(_, p)| now.duration_since(p.heard) >= IDLE_TIMEOUT)
        .map(|(id, _)| *id)
        .collect()
}

/// Hand one batch of the room's answers to the peers they are addressed to,
/// in the order the room produced them.
///
/// A peer whose socket has already gone is skipped rather than reported: the
/// room learns it has gone from that peer's own task, not from a failed write.
fn deliver(peers: &BTreeMap<PeerId, Peer>, out: Vec<Outbound>) {
    for o in &out {
        for (id, peer) in peers {
            if let Some(line) = o.line_for(*id) {
                let _ = peer.out.send(PeerMsg::Line(line.to_string()));
            }
        }
        if let Outbound::Close { peer } = o {
            if let Some(p) = peers.get(peer) {
                let _ = p.out.send(PeerMsg::Close);
            }
        }
    }
}

fn status_of(state: &RoomState, options: &RoomOptions, port: u16, peers: usize) -> RoomStatus {
    RoomStatus {
        port,
        host: options.host.clone(),
        ip: options.ip.clone(),
        approve_joins: options.approve_joins,
        peers,
        pending: state
            .pending_joins()
            .iter()
            .map(|p| p.name.clone())
            .collect(),
        battle: state.battle_view(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn peers_last_heard(ages: &[Duration]) -> BTreeMap<PeerId, Peer> {
        ages.iter()
            .enumerate()
            .map(|(i, ago)| {
                let (out, rx) = mpsc::unbounded_channel();
                // Kept alive so the channel is not closed under the peer it
                // describes, which is all this fixture needs it for.
                std::mem::forget(rx);
                (
                    i as PeerId + 1,
                    Peer {
                        out,
                        heard: Instant::now() - *ago,
                    },
                )
            })
            .collect()
    }

    /// A closed laptop lid leaves a live TCP connection and a name nobody can
    /// reuse. The client's own keepalive is what tells the two apart.
    #[tokio::test]
    async fn a_peer_that_has_missed_three_keepalives_is_idle() {
        let peers = peers_last_heard(&[
            Duration::from_secs(0),
            Duration::from_secs(45),
            Duration::from_secs(120),
        ]);
        assert_eq!(idle_peers(&peers, Instant::now()), vec![3]);
    }
}
