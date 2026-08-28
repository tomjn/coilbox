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

use std::collections::HashMap;
use std::io;
use std::net::{Ipv4Addr, Ipv6Addr, SocketAddr};
use std::sync::{Arc, Mutex};

use tokio::net::UdpSocket;
use tokio::sync::mpsc;

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

/// One datagram the engine sent, tagged with the peer whose socket it arrived
/// on. That tag is the whole reason for a socket per peer: the socket a reply
/// lands on is how the agent knows who to send it back to.
type FromEngine = (SocketAddr, Vec<u8>);

/// The peer address to loopback socket table, and the cap on how big it may
/// get.
struct PeerTable {
    /// Where the engine is listening, which every peer socket is connected to.
    engine: SocketAddr,
    /// Refuse to bind more sockets than the battle has seats. Without this a
    /// misbehaving relay could spoof peer addresses until the agent runs out of
    /// file descriptors.
    max_peers: usize,
    peers: Mutex<HashMap<SocketAddr, Arc<UdpSocket>>>,
    to_relay: mpsc::Sender<FromEngine>,
}

impl PeerTable {
    /// The socket that speaks to the engine on `peer`'s behalf, binding one on
    /// first sight.
    ///
    /// `None` means the table is full and this datagram is to be dropped. Note
    /// what this deliberately does not do: it never replaces an existing entry,
    /// because the port is the peer's identity as far as the engine is
    /// concerned.
    fn socket_for(&self, peer: SocketAddr) -> Option<Arc<UdpSocket>> {
        let mut peers = self.peers.lock().unwrap();
        if let Some(existing) = peers.get(&peer) {
            return Some(Arc::clone(existing));
        }
        if peers.len() >= self.max_peers {
            return None;
        }
        let socket = Arc::new(bind_towards(self.engine).ok()?);
        peers.insert(peer, Arc::clone(&socket));
        tokio::spawn(pump_replies(
            peer,
            Arc::clone(&socket),
            self.to_relay.clone(),
        ));
        Some(socket)
    }

    /// How many peers have a socket. Only the tests read this, because the
    /// forwarding path never needs to know.
    #[cfg(test)]
    fn len(&self) -> usize {
        self.peers.lock().unwrap().len()
    }
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
        let (to_relay, inbox) = mpsc::channel(UPLINK_QUEUE);
        Agent {
            table: PeerTable {
                engine,
                max_peers,
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
}
