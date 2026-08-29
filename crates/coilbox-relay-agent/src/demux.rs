//! One loopback socket per relayed player, which is the whole reason this
//! sidecar exists.
//!
//! `UDPListener::Update` in the engine keys its connection table on the full UDP
//! endpoint, address and port together: it looks the sender up in `connMap`
//! (`rts/System/Net/UDPListener.cpp:134`) and inserts a new connection under
//! that same endpoint (`:159`). An endpoint it has never seen only becomes a
//! connection when the datagram is a first chunk (`:155-161`), and anything else
//! from an unknown endpoint is counted and dropped (`:167-175`).
//!
//! So N relayed players have to reach the engine from N distinct endpoints, or
//! the engine sees one player behaving very strangely. Distinct ports on one
//! address satisfy that, which is what makes loopback work: bind
//! `127.0.0.1:0` per peer and the engine demuxes them exactly as it would N
//! distinct WAN addresses.
//!
//! Two properties this file is built around, both of which break a game in
//! progress if they slip:
//!
//! - A peer gets one socket for its whole life. Rebinding changes the source
//!   port and the engine reads that as a different player.
//! - The peer table outlives the relay connection. [`Agent::run`] borrows a
//!   [`RelayLink`] and returns when it fails, leaving every peer socket bound
//!   and every reader task running, so the caller can rebuild the relay and
//!   call `run` again. Tearing the table down instead would make every player
//!   look brand new to the engine, and it does not recover from that mid-game.
//!
//! ## A player whose own address changes (issue #2029)
//!
//! A home connection does not keep its public address for the length of a game.
//! A NAT mapping expires and the router picks another port, or the router
//! reboots, or a laptop moves to a phone hotspot. The relay reports the new
//! address and this table has never seen it, so that player is a stranger.
//!
//! What this table does about it is nothing, on purpose, and that is worth
//! spelling out because the obvious alternative is worse.
//!
//! The engine already recovers a player whose address changed, and it is the
//! only end that can, because it is the only end holding the player's password.
//! Its client notices it has heard nothing for `ReconnectTimeout` and sends a
//! fresh `ATTEMPTCONNECT` with the reconnect flag set
//! (`rts/Game/Game.cpp:1182`, `rts/Net/Protocol/NetProtocol.cpp:74-81`). That is
//! chunk 0 of a new sequence, so `UDPListener` accepts it from an endpoint it
//! has never seen even mid-game (`UDPListener.cpp:155-161`), and
//! `CGameServer::BindConnection` matches it to a player by name and password and
//! moves that player's existing connection onto the new endpoint
//! (`rts/Net/GameServer.cpp:2965-3070`). The player keeps their seat, their
//! units and their sequence numbers.
//!
//! All of which needs the moved player to reach the engine from an endpoint it
//! has never seen. So a fresh loopback socket is exactly right, and handing the
//! newcomer an existing peer's socket instead would break the recovery it was
//! meant to be. The engine discards a reconnection attempt that arrives on a
//! connection it already has (`UDPConnection.cpp:544-548`), so a guess that got
//! the wrong player would lock the newcomer out and feed their chunks into
//! somebody else's connection.
//!
//! This table has no evidence to guess with. A source address is all a TURN
//! allocation reports, there is no handshake between an agent and a TURN server
//! to carry a token, and two players in one house share a public address. So
//! identity stays where the password is.
//!
//! What is left for this file is the part the engine cannot see: the table is
//! capped at the battle's seat count, and a player who changes address twice
//! would otherwise spend three seats. [`QUIET_ENOUGH_TO_RECLAIM`] is the answer
//! to that.
//!
//! That covers a player who keeps their IP and changes only their port, which
//! is what an expiring NAT mapping does. A player whose IP changes is
//! dropped by the TURN server before any of this, for having no permission at
//! the new address, and nothing here can install one because nothing here knows
//! the address. That is issue #2082 and it needs the lobby.

use std::collections::HashMap;
use std::io;
use std::net::{Ipv4Addr, Ipv6Addr, SocketAddr};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use tokio::net::UdpSocket;
use tokio::sync::mpsc;
use tokio::task::JoinHandle;

use crate::relay::RelayLink;

/// Read buffer for every socket here.
///
/// `udpMaxPacketSize` in the engine is 4096
/// (`rts/System/Net/UDPConnection.cpp:27`), and it is the size of the stack
/// buffer the engine assembles outgoing datagrams into (`:717`) as well as the
/// ceiling `SetMTU` will accept (`:830`), so nothing larger than this can arrive
/// from either end.
const MAX_DATAGRAM: usize = 4096;

/// How many engine replies may be waiting for the relay before the agent starts
/// dropping them.
///
/// Dropping is the right answer rather than blocking: the engine has its own
/// reliability layer and will fight anything that buffers underneath it, and a
/// queue that grows while the relay is down delivers a burst of stale game
/// state the moment it comes back. 256 is a bounded amount of memory
/// (256 * 4 KiB worst case) and far more than a healthy relay ever holds.
const UPLINK_QUEUE: usize = 256;

/// How quiet a peer address has to have gone before the table will take its
/// socket back to make room for somebody else.
///
/// The engine's own `ReconnectTimeout`, which is 15 seconds unless a host has
/// changed it (`rts/System/GlobalConfig.cpp:23-31`). That is the number the
/// engine uses for this exact judgement: `BindConnection` refuses to move a
/// player onto a new endpoint unless the link they had has been silent for it
/// (`rts/Net/GameServer.cpp:2984`, and `CheckTimeout(-1)` measures against
/// `reconnectTimeout` in `UDPConnection.cpp:770-783`). So an address quieter
/// than this is one the engine is already willing to give up on, and taking its
/// socket cannot cost a player the engine is still listening to.
///
/// Reclaiming is not a decision that has to be right, which is the other reason
/// this can be a plain constant rather than something read out of the host's
/// engine configuration. A peer reclaimed too eagerly that starts sending again
/// simply gets another socket, and the engine puts them back exactly as it puts
/// back a player whose address changed. The cost of being wrong is the
/// reconnect they were already going to make.
const QUIET_ENOUGH_TO_RECLAIM: Duration = Duration::from_secs(15);

/// One datagram the engine sent, tagged with the peer whose socket it arrived
/// on. That tag is the whole reason for a socket per peer: the socket a reply
/// lands on is how the agent knows who to send it back to.
type FromEngine = (SocketAddr, Vec<u8>);

/// One peer's way into the engine.
struct Peer {
    socket: Arc<UdpSocket>,
    /// The task carrying the engine's replies back. Held so that reclaiming an
    /// entry really frees the socket: the reader owns the other half of the
    /// `Arc` and sits in `recv` forever, so dropping the table's half alone
    /// would leave the port bound for the life of the process.
    replies: JoinHandle<()>,
    /// When the relay last reported a datagram from this address.
    last_heard: Instant,
}

/// The peer address to loopback socket table, and the cap on how big it may
/// get.
struct PeerTable {
    /// Where the engine is listening, which every peer socket is connected to.
    engine: SocketAddr,
    /// Refuse to bind more sockets than the battle has seats. Without this a
    /// misbehaving relay could spoof peer addresses until the agent runs out of
    /// file descriptors.
    max_peers: usize,
    /// How quiet an entry has to be before it can be reclaimed. Always
    /// [`QUIET_ENOUGH_TO_RECLAIM`] outside the tests, which use a shorter one so
    /// they are not spent waiting on a clock.
    reclaim_after: Duration,
    peers: Mutex<HashMap<SocketAddr, Peer>>,
    to_relay: mpsc::Sender<FromEngine>,
}

impl PeerTable {
    /// The socket that speaks to the engine on `peer`'s behalf, binding one on
    /// first sight.
    ///
    /// `None` means there is no room and this datagram is to be dropped.
    ///
    /// Note what this deliberately does not do: it never hands an address a
    /// socket that belongs to another one. The port is the peer's identity as
    /// far as the engine is concerned, and a peer address that has moved is a
    /// player the engine has to re-identify with the password only it holds.
    /// The module comment has the whole of that.
    fn socket_for(&self, peer: SocketAddr) -> Option<Arc<UdpSocket>> {
        let mut peers = self.peers.lock().unwrap();
        let now = Instant::now();
        if let Some(existing) = peers.get_mut(&peer) {
            existing.last_heard = now;
            return Some(Arc::clone(&existing.socket));
        }
        if peers.len() >= self.max_peers {
            // A full table is not the same as a battle that is full. A player
            // whose address changed is holding two entries, one of which nobody
            // is behind any more, and without this the seat they used to be in
            // refuses them for the rest of the game.
            //
            // `checked_sub` because an `Instant` counts from something like the
            // machine booting, and on one that booted moments ago there is
            // nothing old enough to reclaim anyway.
            let cutoff = now.checked_sub(self.reclaim_after)?;
            let stale = quietest_since(&peers, cutoff)?;
            if let Some(gone) = peers.remove(&stale) {
                gone.replies.abort();
            }
        }
        let socket = Arc::new(bind_towards(self.engine).ok()?);
        let replies = tokio::spawn(pump_replies(
            peer,
            Arc::clone(&socket),
            self.to_relay.clone(),
        ));
        peers.insert(
            peer,
            Peer {
                socket: Arc::clone(&socket),
                replies,
                last_heard: now,
            },
        );
        Some(socket)
    }

    /// How many peers have a socket. Only the tests read this, because the
    /// forwarding path never needs to know.
    #[cfg(test)]
    fn len(&self) -> usize {
        self.peers.lock().unwrap().len()
    }

    /// The loopback port this peer reaches the engine from, which is the
    /// identity the engine knows them by. Only the tests ask, and they ask so
    /// they can watch that port come back when an entry is reclaimed.
    #[cfg(test)]
    fn port_of(&self, peer: SocketAddr) -> Option<u16> {
        let peers = self.peers.lock().unwrap();
        peers.get(&peer)?.socket.local_addr().ok().map(|a| a.port())
    }
}

/// The address that has been quiet the longest, as long as it has been quiet
/// since `cutoff`. `None` when every address in the table has been heard from
/// more recently than that, which is a table full of players rather than a
/// table full of addresses players have left behind.
///
/// One rather than all of them, because one is all the room the caller needs and
/// every entry left alone is a player who does not have to reconnect.
fn quietest_since(peers: &HashMap<SocketAddr, Peer>, cutoff: Instant) -> Option<SocketAddr> {
    peers
        .iter()
        .filter(|(_, peer)| peer.last_heard < cutoff)
        .min_by_key(|(_, peer)| peer.last_heard)
        .map(|(addr, _)| *addr)
}

/// Bind an ephemeral loopback port and connect it to the engine.
///
/// Connected rather than unconnected so the kernel filters replies for us: the
/// only thing this socket will ever hear is the engine, so a stray datagram from
/// anything else on the machine cannot be mistaken for one.
fn bind_towards(engine: SocketAddr) -> io::Result<UdpSocket> {
    let local = if engine.is_ipv4() {
        SocketAddr::from((Ipv4Addr::LOCALHOST, 0))
    } else {
        SocketAddr::from((Ipv6Addr::LOCALHOST, 0))
    };
    let socket = std::net::UdpSocket::bind(local)?;
    socket.set_nonblocking(true)?;
    socket.connect(engine)?;
    UdpSocket::from_std(socket)
}

/// Carry everything the engine says on one peer's socket back up towards the
/// relay, tagged with that peer.
///
/// Lives for the life of the peer, which is the life of the process: the table
/// holds the other half of the `Arc` and never removes an entry.
async fn pump_replies(
    peer: SocketAddr,
    socket: Arc<UdpSocket>,
    to_relay: mpsc::Sender<FromEngine>,
) {
    let mut buf = vec![0u8; MAX_DATAGRAM];
    loop {
        let read = match socket.recv(&mut buf).await {
            Ok(read) => read,
            // A connected UDP socket surfaces the ICMP port-unreachable it gets
            // when the engine is not listening yet as an error on the next
            // read. That is normal during launch and says nothing about this
            // socket, so keep reading. Anything else is a broken socket and
            // there is nothing useful left for this task to do.
            Err(e)
                if e.kind() == io::ErrorKind::ConnectionRefused
                    || e.kind() == io::ErrorKind::ConnectionReset =>
            {
                continue
            }
            Err(_) => return,
        };
        // `try_send` rather than `send`: see UPLINK_QUEUE. A full queue means
        // the relay is not draining, and waiting here would stall this peer's
        // reads behind it.
        if to_relay.try_send((peer, buf[..read].to_vec())).is_err() && to_relay.is_closed() {
            // A full queue is a dropped datagram and nothing more. Only a
            // closed channel is fatal, and the table holds the sender for as
            // long as the process lives, so that is the shutdown path.
            return;
        }
    }
}

/// The demultiplexer: a peer table that outlives any one relay connection.
pub struct Agent {
    table: PeerTable,
    /// Engine replies waiting to go up to the relay. Owned here rather than by
    /// [`Agent::run`] so a rebuilt relay picks up the same queue and the reader
    /// tasks never learn that anything changed.
    inbox: mpsc::Receiver<FromEngine>,
}

impl Agent {
    /// A new agent with an empty table, forwarding to the engine at `engine`
    /// and binding at most `max_peers` sockets.
    pub fn new(engine: SocketAddr, max_peers: usize) -> Self {
        Agent::reclaiming_after(engine, max_peers, QUIET_ENOUGH_TO_RECLAIM)
    }

    /// The same, with the wait before a quiet peer's socket can be taken back
    /// spelled out. [`QUIET_ENOUGH_TO_RECLAIM`] is the only value a running
    /// agent uses, and the tests pass a short one so they are about the rule
    /// rather than about a clock.
    fn reclaiming_after(engine: SocketAddr, max_peers: usize, reclaim_after: Duration) -> Self {
        let (to_relay, inbox) = mpsc::channel(UPLINK_QUEUE);
        Agent {
            table: PeerTable {
                engine,
                max_peers,
                reclaim_after,
                peers: Mutex::new(HashMap::new()),
                to_relay,
            },
            inbox,
        }
    }

    /// Forward both ways over `relay` until it fails.
    ///
    /// Returns on the first relay error and leaves the table alone, so the
    /// caller rebuilds the relay and calls this again. Cancelling this future
    /// is equally safe and means the same thing.
    pub async fn run<R: RelayLink>(&mut self, relay: &R) -> io::Result<()> {
        // Split the borrow: the downlink needs the table, the uplink needs the
        // queue, and they run at the same time.
        let Agent { table, inbox } = self;
        tokio::try_join!(to_engine(table, relay), to_relay(inbox, relay))?;
        Ok(())
    }
}

/// Relay to engine: every datagram goes out of the socket that belongs to the
/// peer it came from.
async fn to_engine<R: RelayLink>(table: &PeerTable, relay: &R) -> io::Result<()> {
    let mut buf = vec![0u8; MAX_DATAGRAM];
    loop {
        let (read, peer) = relay.recv_from(&mut buf).await?;
        let Some(socket) = table.socket_for(peer) else {
            // Over the seat count. Dropping is the only safe answer: binding
            // would let a misbehaving relay spend our file descriptors, and
            // reusing another peer's socket would confuse the engine far worse.
            continue;
        };
        // A send failure here is the engine not being up yet, which is a
        // dropped datagram and nothing more. The relay is still fine, so the
        // loop is too.
        let _ = socket.send(&buf[..read]).await;
    }
}

/// Engine to relay: whatever the peer sockets have collected, addressed back to
/// the peer whose socket collected it.
async fn to_relay<R: RelayLink>(
    inbox: &mut mpsc::Receiver<FromEngine>,
    relay: &R,
) -> io::Result<()> {
    while let Some((peer, payload)) = inbox.recv().await {
        relay.send_to(&payload, peer).await?;
    }
    // Only reachable once every peer socket has gone, which cannot happen while
    // the table is alive.
    Ok(())
}

#[cfg(test)]
mod tests {
    //! Real sockets on loopback rather than mocks, for the reason
    //! `tauri-plugin-coilbox-multiplayer/src/direct_loopback.rs` gives: the
    //! property under test is what a socket does, and a mock of a socket is a
    //! statement of what we already believe.
    //!
    //! Nothing here needs an engine or a TURN server. The "relay" is an
    //! unconnected UDP socket, the "engine" is a UDP echo, and the "players"
    //! are UDP sockets that dial the relay.

    use super::*;
    use std::collections::BTreeSet;
    use std::time::Duration;

    /// How long a test waits for a loopback round trip before deciding it is
    /// never coming. Generous next to the tens of microseconds one actually
    /// takes, and spent in full only when a test is about to fail.
    const PATIENCE: Duration = Duration::from_secs(5);

    /// A UDP echo that remembers every source address it was spoken to from.
    ///
    /// That list is the assertion the whole design turns on. The engine's
    /// `connMap` is keyed on exactly this, so "each peer arrived from a
    /// different source port" is the property, stated in the same terms the
    /// engine states it in.
    struct FakeEngine {
        addr: SocketAddr,
        callers: Arc<Mutex<Vec<SocketAddr>>>,
    }

    impl FakeEngine {
        async fn start() -> FakeEngine {
            let socket = UdpSocket::bind((Ipv4Addr::LOCALHOST, 0))
                .await
                .expect("a free loopback port");
            let addr = socket.local_addr().expect("a bound address");
            let callers: Arc<Mutex<Vec<SocketAddr>>> = Arc::default();
            let record = Arc::clone(&callers);
            tokio::spawn(async move {
                let mut buf = vec![0u8; MAX_DATAGRAM];
                loop {
                    let Ok((read, from)) = socket.recv_from(&mut buf).await else {
                        return;
                    };
                    record.lock().unwrap().push(from);
                    let _ = socket.send_to(&buf[..read], from).await;
                }
            });
            FakeEngine { addr, callers }
        }

        /// The distinct source ports the engine has been spoken to from, which
        /// is how many clients it thinks it has.
        fn distinct_ports(&self) -> BTreeSet<u16> {
            self.callers
                .lock()
                .unwrap()
                .iter()
                .map(|a| a.port())
                .collect()
        }
    }

    /// One remote player, as far as the agent can tell: a socket that sends to
    /// the relay and expects its own words back.
    struct FakePlayer {
        socket: UdpSocket,
    }

    impl FakePlayer {
        async fn dialling(relay: SocketAddr) -> FakePlayer {
            let socket = UdpSocket::bind((Ipv4Addr::LOCALHOST, 0))
                .await
                .expect("a free loopback port");
            socket.connect(relay).await.expect("a loopback address");
            FakePlayer { socket }
        }

        /// Point this player at a rebuilt relay, keeping its own port. The
        /// player's address is its identity here, exactly as the peer address a
        /// TURN allocation reports is the identity the agent keys on.
        async fn redial(&self, relay: SocketAddr) {
            self.socket
                .connect(relay)
                .await
                .expect("a loopback address");
        }

        /// Send `what` and wait for the engine's echo of it to come back.
        async fn round_trip(&self, what: &[u8]) {
            self.socket.send(what).await.expect("the relay is bound");
            let mut buf = vec![0u8; MAX_DATAGRAM];
            let read = tokio::time::timeout(PATIENCE, self.socket.recv(&mut buf))
                .await
                .expect("the echo to come back before the test gives up")
                .expect("a readable socket");
            assert_eq!(
                &buf[..read],
                what,
                "the reply reached the wrong player, so the agent lost track of whose socket is whose"
            );
        }

        /// The address the relay reports this player at, which is the only
        /// thing the agent knows them by.
        fn address(&self) -> SocketAddr {
            self.socket.local_addr().expect("a bound address")
        }

        /// The same person, arriving from somewhere else.
        ///
        /// A new source port on the same machine, which is what a NAT mapping
        /// expiring looks like from the far side of a relay. The player's engine
        /// has no idea any of this happened.
        async fn moves_to_a_new_address(&self, relay: SocketAddr) -> FakePlayer {
            FakePlayer::dialling(relay).await
        }

        /// Send `what` without waiting to hear anything back.
        async fn keeps_playing(&self, what: &[u8]) {
            self.socket.send(what).await.expect("the relay is bound");
        }

        /// Send `what` and assert nothing comes back, for the players the agent
        /// is supposed to refuse.
        async fn gets_nowhere(&self, what: &[u8], long_enough: Duration) {
            self.socket.send(what).await.expect("the relay is bound");
            let mut buf = vec![0u8; MAX_DATAGRAM];
            let heard = tokio::time::timeout(long_enough, self.socket.recv(&mut buf)).await;
            assert!(
                heard.is_err(),
                "a player past the seat count was let through anyway"
            );
        }
    }

    /// Run `agent` over `relay` for as long as `work` takes, then stop it.
    ///
    /// Cancelling `run` rather than letting it finish is the point: it is what
    /// a relay connection dying looks like, and the agent has to survive it
    /// with its table intact.
    async fn while_running<T>(
        agent: &mut Agent,
        relay: &UdpSocket,
        work: impl std::future::Future<Output = T>,
    ) -> T {
        tokio::select! {
            stopped = agent.run(relay) => panic!("the agent stopped forwarding: {stopped:?}"),
            done = work => done,
        }
    }

    /// A relay socket, and the address players send to.
    async fn fake_relay() -> (UdpSocket, SocketAddr) {
        let socket = UdpSocket::bind((Ipv4Addr::LOCALHOST, 0))
            .await
            .expect("a free loopback port");
        let addr = socket.local_addr().expect("a bound address");
        (socket, addr)
    }

    /// The property everything else is plumbing around: four players down one
    /// relay reach the engine as four clients, and each one's reply finds its
    /// way home.
    ///
    /// Feed the engine through a single socket instead and `distinct_ports`
    /// here is 1, which is the failure this sidecar exists to prevent.
    #[tokio::test]
    async fn each_player_reaches_the_engine_from_its_own_port() {
        let engine = FakeEngine::start().await;
        let (relay, relay_addr) = fake_relay().await;
        let mut agent = Agent::new(engine.addr, 8);

        let mut players = Vec::new();
        for _ in 0..4 {
            players.push(FakePlayer::dialling(relay_addr).await);
        }

        while_running(&mut agent, &relay, async {
            for (i, player) in players.iter().enumerate() {
                player
                    .round_trip(format!("hello from {i}").as_bytes())
                    .await;
            }
        })
        .await;

        assert_eq!(
            engine.distinct_ports().len(),
            4,
            "the engine has to see one endpoint per player, not one for all of them"
        );
        assert!(
            engine
                .callers
                .lock()
                .unwrap()
                .iter()
                .all(|a| a.ip() == Ipv4Addr::LOCALHOST),
            "every peer socket is bound on loopback"
        );
    }

    /// The relay dies and comes back mid-game, and the engine never finds out.
    ///
    /// This is the hazard that costs a game rather than a connection. Rebuilding
    /// the peer sockets alongside the relay would hand the engine three brand
    /// new endpoints, and `UDPListener::Update` only opens a connection for a
    /// first chunk, so mid-game they would be counted and dropped
    /// (`UDPListener.cpp:167-175`) with every player timing out.
    #[tokio::test]
    async fn a_rebuilt_relay_leaves_the_players_ports_alone() {
        let engine = FakeEngine::start().await;
        let mut agent = Agent::new(engine.addr, 8);

        let (first, first_addr) = fake_relay().await;
        let mut players = Vec::new();
        for _ in 0..3 {
            players.push(FakePlayer::dialling(first_addr).await);
        }
        while_running(&mut agent, &first, async {
            for player in &players {
                player.round_trip(b"before").await;
            }
        })
        .await;

        let before = engine.distinct_ports();
        assert_eq!(before.len(), 3, "three players, three endpoints");

        // The allocation goes away and a new one takes its place on a different
        // port, which is what a NAT rebind or a relay restart looks like from
        // here.
        drop(first);
        let (second, second_addr) = fake_relay().await;
        assert_ne!(
            first_addr, second_addr,
            "a genuinely different relay socket"
        );
        for player in &players {
            player.redial(second_addr).await;
        }

        while_running(&mut agent, &second, async {
            for player in &players {
                player.round_trip(b"after").await;
            }
        })
        .await;

        assert_eq!(
            engine.distinct_ports(),
            before,
            "the engine saw a new client, so a peer socket was rebound across the reconnect"
        );
    }

    /// The table is bounded, so a relay that invents peers cannot spend the
    /// host's file descriptors.
    #[tokio::test]
    async fn players_past_the_seat_count_are_refused() {
        let engine = FakeEngine::start().await;
        let (relay, relay_addr) = fake_relay().await;
        let mut agent = Agent::new(engine.addr, 2);

        let seated = [
            FakePlayer::dialling(relay_addr).await,
            FakePlayer::dialling(relay_addr).await,
        ];
        let gatecrasher = FakePlayer::dialling(relay_addr).await;

        while_running(&mut agent, &relay, async {
            for player in &seated {
                player.round_trip(b"seated").await;
            }
            // Short, because it is waited out in full every run and the two
            // round trips above already showed a working path takes far less.
            gatecrasher
                .gets_nowhere(b"gatecrash", Duration::from_millis(250))
                .await;
        })
        .await;

        assert_eq!(engine.distinct_ports().len(), 2);
        assert_eq!(agent.table.len(), 2, "no socket was bound for the third");
    }

    /// How long the tests below make an address wait before its socket can be
    /// taken back.
    ///
    /// A tenth of a second, so a test is about the rule rather than about
    /// [`QUIET_ENOUGH_TO_RECLAIM`]'s clock. The waits either side of it are
    /// multiples of this, so nothing here depends on a real duration.
    const RECLAIM_IN: Duration = Duration::from_millis(100);

    /// A player whose address changed reaches the engine as somebody it has
    /// never heard of, and that is the point rather than a bug (issue #2029).
    ///
    /// The engine is the only end holding the player's password, so it is the
    /// only end that can say the newcomer is the player who used to be
    /// somewhere else. Its own reconnect does exactly that, and it needs the
    /// moved player to arrive from an endpoint it has never seen before
    /// (`UDPListener.cpp:155-161`, `GameServer.cpp:2965-3070`). Hand them
    /// somebody else's socket instead and that recovery has nothing to work
    /// with.
    #[tokio::test]
    async fn a_player_whose_address_changed_arrives_as_a_new_client() {
        let engine = FakeEngine::start().await;
        let (relay, relay_addr) = fake_relay().await;
        let mut agent = Agent::new(engine.addr, 8);

        let player = FakePlayer::dialling(relay_addr).await;
        let moved = player.moves_to_a_new_address(relay_addr).await;
        assert_ne!(
            player.address(),
            moved.address(),
            "the same address twice is not a player who moved"
        );

        while_running(&mut agent, &relay, async {
            player.round_trip(b"before my router rebooted").await;
            moved.round_trip(b"after my router rebooted").await;
        })
        .await;

        assert_eq!(
            engine.distinct_ports().len(),
            2,
            "the moved player has to reach the engine from an endpoint it has never seen, or the \
             engine's own reconnect has nothing to accept"
        );
    }

    /// The whole of issue #2029 that this side can fix. The table is capped at
    /// the battle's seat count, so an address nobody is behind any more is a
    /// seat nobody can sit in, and the player who left it behind is the one
    /// refused.
    ///
    /// Without this a full battle survives exactly zero address changes: the
    /// first player whose router picks a new port is dropped for the rest of the
    /// game, silently, and reconnecting cannot help because every reconnect is
    /// another address the table has no room for.
    #[tokio::test]
    async fn an_address_nobody_is_behind_any_more_gives_its_seat_up() {
        let engine = FakeEngine::start().await;
        let (relay, relay_addr) = fake_relay().await;
        let mut agent = Agent::reclaiming_after(engine.addr, 2, RECLAIM_IN);

        let seated = [
            FakePlayer::dialling(relay_addr).await,
            FakePlayer::dialling(relay_addr).await,
        ];
        while_running(&mut agent, &relay, async {
            for player in &seated {
                player.round_trip(b"a full battle").await;
            }
        })
        .await;

        let left_behind = seated[0].address();
        let loopback_port = agent
            .table
            .port_of(left_behind)
            .expect("the first player has a socket");

        // Long enough that both seats are quiet by the engine's own measure,
        // which is what makes either of them fair game.
        tokio::time::sleep(RECLAIM_IN * 2).await;

        let moved = seated[1].moves_to_a_new_address(relay_addr).await;
        while_running(&mut agent, &relay, async {
            moved.round_trip(b"my address changed mid-game").await;
        })
        .await;

        assert_eq!(
            agent.table.len(),
            2,
            "the table has to stay inside the seat count, or a relay inventing addresses spends \
             the host's file descriptors"
        );
        assert_eq!(
            agent.table.port_of(left_behind),
            None,
            "the seat that was given up is still held"
        );
        assert!(
            port_comes_back(loopback_port).await,
            "loopback port {loopback_port} is still bound, so the reclaimed socket and its \
             reader are still there and the table only looks smaller"
        );
    }

    /// The half that must not happen. Everybody in the table is still playing,
    /// so there is no seat to give up and the newcomer is refused, however long
    /// the game has been going on.
    ///
    /// Asserted over three times the reclaim wait, because a table that simply
    /// evicted whoever it had heard from least recently would pass a shorter
    /// run and then throw a player out of a real game.
    #[tokio::test]
    async fn a_table_of_players_who_are_all_still_playing_gives_nothing_up() {
        let engine = FakeEngine::start().await;
        let (relay, relay_addr) = fake_relay().await;
        let mut agent = Agent::reclaiming_after(engine.addr, 2, RECLAIM_IN);

        let seated = [
            FakePlayer::dialling(relay_addr).await,
            FakePlayer::dialling(relay_addr).await,
        ];
        let gatecrasher = FakePlayer::dialling(relay_addr).await;

        while_running(&mut agent, &relay, async {
            for player in &seated {
                player.round_trip(b"a full battle").await;
            }
            for _ in 0..6 {
                tokio::time::sleep(RECLAIM_IN / 2).await;
                for player in &seated {
                    player.keeps_playing(b"still here").await;
                }
                gatecrasher.keeps_playing(b"let me in").await;
            }
            // Anything that reached the engine on somebody else's seat has
            // already been echoed back and is waiting on this socket, so this
            // covers every attempt above rather than only the last.
            gatecrasher.gets_nowhere(b"let me in", RECLAIM_IN).await;
        })
        .await;

        assert_eq!(
            agent.table.len(),
            2,
            "somebody who was still playing lost their socket to a stranger"
        );
        assert_eq!(
            engine.distinct_ports().len(),
            2,
            "the engine saw a third client, so a player who was still playing was thrown out to \
             make room"
        );
    }

    /// Wait for a loopback port to be bindable again, which is the only way from
    /// out here to tell a socket that was closed from one that is still open
    /// with nobody reading it.
    ///
    /// A wait rather than a single try because aborting the reader task is what
    /// drops the last handle on the socket, and an abort lands on the runtime's
    /// own schedule rather than on this line.
    async fn port_comes_back(port: u16) -> bool {
        let deadline = std::time::Instant::now() + PATIENCE;
        while std::time::Instant::now() < deadline {
            if std::net::UdpSocket::bind((Ipv4Addr::LOCALHOST, port)).is_ok() {
                return true;
            }
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
        false
    }
}
