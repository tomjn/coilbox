//! The TURN allocation: a public address on somebody else's machine, for a
//! host whose own router will not let anybody in.
//!
//! The `turn` crate does the protocol. What this module adds is the one thing
//! it does not do, which is tell anybody when the allocation has gone.
//!
//! ## Why the agent reads the server's answers itself
//!
//! An allocation only exists for as long as Refresh keeps succeeding. The
//! `turn` crate refreshes on its own timer at half the lifetime, which is
//! correct, but it swallows the outcome: a Refresh the server answers with an
//! error returns `Ok` unless the error is 438 Stale Nonce
//! (`client/relay_conn.rs:497-508`), and a Refresh nothing answers at all is
//! retried three times and then logged at warn level and forgotten
//! (`:594-605`). Either way `recv_from` goes on waiting for datagrams that a
//! deleted allocation will never deliver, and the host sits in a battle nobody
//! can join.
//!
//! So the agent reads over the client's shoulder. It owns the UDP socket the
//! client talks to the server over, so [`WatchedSocket`] sees every request go
//! out and every answer come back, and [`Health`] turns those into one rule:
//!
//! > the allocation is alive for as long as the server said it would be
//! > without another Refresh, and dead the moment the server refuses a request
//! > the client signed.
//!
//! That covers an expired credential, a restarted server and a network that
//! went away, without having to tell them apart.
//!
//! ## The credential is the part that cannot be recovered from
//!
//! coturn checks the credential's expiry on every request, Refresh included.
//! Once coilbox has closed, this process has no way to ask the lobby for
//! another one (that is issue #2016, and it needs the app running). A refusal
//! aimed at the credential is therefore final, which is why
//! [`AllocationFailure::is_credential_failure`] exists: everything else is
//! worth retrying and that one is not.

use std::io;
use std::net::SocketAddr;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use async_trait::async_trait;
use stun::attributes::ATTR_MESSAGE_INTEGRITY;
use stun::error_code::{ErrorCodeAttribute, CODE_STALE_NONCE};
use stun::message::{
    is_message, Getter, Message, MessageType, CLASS_ERROR_RESPONSE, CLASS_REQUEST,
    CLASS_SUCCESS_RESPONSE, METHOD_ALLOCATE, METHOD_REFRESH,
};
use tokio::net::UdpSocket;
use tokio::sync::watch;
use tokio::time::Instant;
use turn::client::{Client, ClientConfig};
use turn::proto::lifetime::Lifetime;
use webrtc_util::Conn;

use crate::relay::RelayLink;

/// What the sidecar needs to open an allocation.
///
/// These come from the lobby, which mints them per battle. Fetching them is
/// coilbox's job, and issue #2016's. The sidecar is handed the answer.
#[derive(Clone, Debug)]
pub struct TurnCredentials {
    /// `host:port` of the TURN server.
    pub server: String,
    pub username: String,
    pub password: String,
}

/// Why an allocation is not usable, whether it never opened or stopped being
/// open later.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum AllocationFailure {
    /// The server answered a request the client had signed with an error.
    /// `code` is the STUN error code it gave.
    Refused { code: u16, reason: String },
    /// Nothing answered, and the lifetime the server granted has run out. The
    /// server deleted the allocation when that happened whether or not it ever
    /// managed to say so.
    Expired,
    /// The far end was never reached at all: the socket would not bind, the
    /// name would not resolve, the server did not answer.
    Unreachable(String),
}

impl AllocationFailure {
    /// Whether the credential itself is what the server objected to.
    ///
    /// This is the one failure there is no point retrying. 401 and 441 are the
    /// server saying the credential does not check out, and 403 is it saying
    /// the credential is real but not allowed to do this. None of those change
    /// on their own, and the sidecar cannot go and get a better credential.
    pub fn is_credential_failure(&self) -> bool {
        matches!(self, AllocationFailure::Refused { code, .. } if matches!(code, 401 | 403 | 441))
    }
}

impl std::fmt::Display for AllocationFailure {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            AllocationFailure::Refused { code, reason } => {
                write!(f, "the server refused it (error {code} {reason})")
            }
            AllocationFailure::Expired => {
                write!(f, "its lifetime ran out with no refresh answered")
            }
            AllocationFailure::Unreachable(why) => write!(f, "the server was not reachable: {why}"),
        }
    }
}

/// What the agent has worked out about the allocation from watching the wire.
struct Health {
    state: Mutex<HealthState>,
    /// Set once, to the first failure noticed. Everything that has to react to
    /// a lost allocation watches this.
    failure: watch::Sender<Option<AllocationFailure>>,
}

#[derive(Default)]
struct HealthState {
    /// Whether a request carrying MESSAGE-INTEGRITY has gone out yet.
    ///
    /// This is what separates the 401 the exchange is supposed to start with
    /// from the 401 that means the credential is no good. The first Allocate
    /// is deliberately unsigned, because the server has to be asked for the
    /// challenge before a key can be derived from it.
    signed_a_request: bool,
    /// The lifetime the server last granted, and when it granted it. Together
    /// they are the moment the server will delete the allocation if nothing
    /// else is heard.
    granted_for: Option<Duration>,
    granted_at: Option<Instant>,
}

impl Health {
    fn new() -> Health {
        Health {
            state: Mutex::new(HealthState::default()),
            failure: watch::channel(None).0,
        }
    }

    /// Note a datagram on its way to the server.
    fn saw_outbound(&self, datagram: &[u8]) {
        let Some(typ) = interesting_type(datagram) else {
            return;
        };
        if typ.class != CLASS_REQUEST {
            return;
        }
        let Some(msg) = decode(datagram) else {
            return;
        };
        if msg.get(ATTR_MESSAGE_INTEGRITY).is_ok() {
            self.state.lock().unwrap().signed_a_request = true;
        }
    }

    /// Note a datagram on its way back from the server.
    fn saw_inbound(&self, datagram: &[u8]) {
        let Some(typ) = interesting_type(datagram) else {
            return;
        };
        let Some(msg) = decode(datagram) else {
            return;
        };
        if typ.class == CLASS_SUCCESS_RESPONSE {
            let mut lifetime = Lifetime::default();
            if lifetime.get_from(&msg).is_ok() {
                let mut state = self.state.lock().unwrap();
                state.granted_for = Some(lifetime.0);
                state.granted_at = Some(Instant::now());
            }
            return;
        }
        if typ.class != CLASS_ERROR_RESPONSE {
            return;
        }
        if !self.state.lock().unwrap().signed_a_request {
            // The challenge, which is how a long-term credential exchange is
            // meant to begin.
            return;
        }
        let mut code = ErrorCodeAttribute::default();
        if code.get_from(&msg).is_err() {
            self.report(AllocationFailure::Refused {
                code: 0,
                reason: format!("{typ} with no error code in it"),
            });
            return;
        }
        if code.code == CODE_STALE_NONCE {
            // The server handing out a new nonce, not a refusal. The client
            // signs the next attempt with it and carries on.
            return;
        }
        self.report(AllocationFailure::Refused {
            code: code.code.0,
            reason: String::from_utf8_lossy(&code.reason).into_owned(),
        });
    }

    /// When the server will delete the allocation if nothing refreshes it.
    fn deadline(&self) -> Option<Instant> {
        let state = self.state.lock().unwrap();
        Some(state.granted_at? + state.granted_for?)
    }

    /// Record `failure`, unless something has already gone wrong.
    ///
    /// First one wins, because the later ones are consequences of it. An
    /// allocation the server refused will also stop being refreshed, and
    /// "refused with error 401" is the useful half of that pair.
    fn report(&self, failure: AllocationFailure) {
        self.failure.send_if_modified(|held| {
            if held.is_some() {
                return false;
            }
            *held = Some(failure);
            true
        });
    }

    fn failure(&self) -> Option<AllocationFailure> {
        self.failure.borrow().clone()
    }
}

/// The message types worth decoding, which is the two that carry the state of
/// the allocation. Read straight out of the header so that relayed game
/// traffic, which shares this socket, costs a two byte comparison rather than a
/// parse.
fn interesting_type(datagram: &[u8]) -> Option<MessageType> {
    if !is_message(datagram) {
        return None;
    }
    let mut typ = MessageType::default();
    typ.read_value(u16::from_be_bytes([datagram[0], datagram[1]]));
    (typ.method == METHOD_ALLOCATE || typ.method == METHOD_REFRESH).then_some(typ)
}

fn decode(datagram: &[u8]) -> Option<Message> {
    let mut msg = Message::new();
    msg.raw = datagram.to_vec();
    msg.decode().ok().map(|()| msg)
}

/// Hold the allocation open by watching the clock the server runs it on.
///
/// The client is doing the refreshing. This only decides when to stop believing
/// that it worked.
async fn watch_lifetime(health: Arc<Health>) {
    loop {
        let Some(deadline) = health.deadline() else {
            // Only reachable if this is started before the first grant, which
            // it never is.
            return;
        };
        if Instant::now() >= deadline {
            health.report(AllocationFailure::Expired);
            return;
        }
        // A refresh that lands while this sleeps moves the deadline out, so the
        // next time round the loop there is more waiting to do.
        tokio::time::sleep_until(deadline).await;
    }
}

/// The UDP socket the TURN client speaks to the server over, with the agent
/// reading along.
///
/// Everything here is the socket's own behaviour apart from the two lines that
/// hand each datagram to [`Health`] on the way past.
struct WatchedSocket {
    socket: UdpSocket,
    health: Arc<Health>,
}

#[async_trait]
impl Conn for WatchedSocket {
    async fn connect(&self, addr: SocketAddr) -> Result<(), webrtc_util::Error> {
        Conn::connect(&self.socket, addr).await
    }

    async fn recv(&self, buf: &mut [u8]) -> Result<usize, webrtc_util::Error> {
        let read = Conn::recv(&self.socket, buf).await?;
        self.health.saw_inbound(&buf[..read]);
        Ok(read)
    }

    async fn recv_from(&self, buf: &mut [u8]) -> Result<(usize, SocketAddr), webrtc_util::Error> {
        let (read, from) = Conn::recv_from(&self.socket, buf).await?;
        self.health.saw_inbound(&buf[..read]);
        Ok((read, from))
    }

    async fn send(&self, buf: &[u8]) -> Result<usize, webrtc_util::Error> {
        self.health.saw_outbound(buf);
        Conn::send(&self.socket, buf).await
    }

    async fn send_to(&self, buf: &[u8], target: SocketAddr) -> Result<usize, webrtc_util::Error> {
        self.health.saw_outbound(buf);
        Conn::send_to(&self.socket, buf, target).await
    }

    fn local_addr(&self) -> Result<SocketAddr, webrtc_util::Error> {
        Conn::local_addr(&self.socket)
    }

    fn remote_addr(&self) -> Option<SocketAddr> {
        Conn::remote_addr(&self.socket)
    }

    async fn close(&self) -> Result<(), webrtc_util::Error> {
        Conn::close(&self.socket).await
    }

    fn as_any(&self) -> &(dyn std::any::Any + Send + Sync) {
        self
    }
}

/// A live TURN allocation, and the address it gave us.
pub struct TurnAllocation {
    client: Client,
    relayed: Box<dyn Conn + Send + Sync>,
    relayed_addr: SocketAddr,
    health: Arc<Health>,
}

impl TurnAllocation {
    /// Ask `credentials.server` for an allocation, talking to it from a socket
    /// bound at `bind`.
    ///
    /// `bind` is the agent's own address, not the relayed one. `0.0.0.0:0` is
    /// the usual answer, because nothing has to reach this socket except the
    /// TURN server replying to us.
    pub async fn open(
        bind: SocketAddr,
        credentials: &TurnCredentials,
    ) -> Result<TurnAllocation, AllocationFailure> {
        let socket = UdpSocket::bind(bind)
            .await
            .map_err(|e| AllocationFailure::Unreachable(format!("could not bind {bind}: {e}")))?;
        let health = Arc::new(Health::new());
        let client = Client::new(ClientConfig {
            // Empty because the agent has no use for a reflexive address: the
            // relayed one is the whole point, and asking a STUN server for the
            // other one is what the direct paths are for.
            stun_serv_addr: String::new(),
            turn_serv_addr: credentials.server.clone(),
            username: credentials.username.clone(),
            password: credentials.password.clone(),
            // The server names its own in the challenge, and the client
            // replaces whatever it was configured with before it derives a key
            // (`client/mod.rs:539-546`), so there is nothing useful to put
            // here.
            realm: String::new(),
            software: String::new(),
            rto_in_ms: 0,
            conn: Arc::new(WatchedSocket {
                socket,
                health: Arc::clone(&health),
            }),
            vnet: None,
        })
        .await
        .map_err(|e| unreachable_server(&credentials.server, &e))?;

        client
            .listen()
            .await
            .map_err(|e| unreachable_server(&credentials.server, &e))?;

        let relayed = match client.allocate().await {
            Ok(relayed) => relayed,
            Err(e) => {
                let _ = client.close().await;
                // What the server actually said, if it said anything, beats the
                // client's rendering of it: the STUN error code is the thing
                // worth deciding on.
                return Err(health
                    .failure()
                    .unwrap_or_else(|| unreachable_server(&credentials.server, &e)));
            }
        };
        let relayed_addr = relayed.local_addr().map_err(|e| {
            AllocationFailure::Unreachable(format!("allocation has no address: {e}"))
        })?;

        tokio::spawn(watch_lifetime(Arc::clone(&health)));

        Ok(TurnAllocation {
            client,
            relayed: Box::new(relayed),
            relayed_addr,
            health,
        })
    }

    /// The address on the TURN server that players send to. This is what the
    /// battle advertises.
    pub fn relayed_addr(&self) -> SocketAddr {
        self.relayed_addr
    }

    /// Why the allocation stopped working, once it has.
    pub fn failure(&self) -> Option<AllocationFailure> {
        self.health.failure()
    }

    /// Give the allocation back, so the server is not holding a port for a
    /// battle that has finished with it.
    pub async fn close(&self) {
        let _ = self.relayed.close().await;
        let _ = self.client.close().await;
    }
}

impl RelayLink for TurnAllocation {
    async fn recv_from(&self, buf: &mut [u8]) -> io::Result<(usize, SocketAddr)> {
        let mut lost = self.health.failure.subscribe();
        tokio::select! {
            arrived = self.relayed.recv_from(buf) => arrived.map_err(as_io),
            // Without this the demux would wait out a game on an allocation the
            // server deleted minutes ago. A lost allocation has to look like a
            // broken relay, because that is what it is.
            () = wait_for_loss(&mut lost) => Err(io::Error::other(format!(
                "the TURN allocation is gone: {}",
                self.health
                    .failure()
                    .map_or_else(|| "no reason recorded".to_string(), |f| f.to_string())
            ))),
        }
    }

    async fn send_to(&self, buf: &[u8], peer: SocketAddr) -> io::Result<usize> {
        self.relayed.send_to(buf, peer).await.map_err(as_io)
    }
}

async fn wait_for_loss(lost: &mut watch::Receiver<Option<AllocationFailure>>) {
    // The sender lives as long as the allocation, so the error case cannot
    // happen while anything is reading this.
    let _ = lost.wait_for(Option::is_some).await;
}

fn as_io(e: webrtc_util::Error) -> io::Error {
    io::Error::other(e.to_string())
}

/// Name the server that did not work.
///
/// The `turn` crate reports a server that never answered by whatever it could
/// not find in the answer, so on its own "attribute not found" is what somebody
/// reads when they typed the address wrong.
fn unreachable_server(server: &str, why: &turn::Error) -> AllocationFailure {
    AllocationFailure::Unreachable(format!("{server} did not grant an allocation: {why}"))
}

#[cfg(test)]
mod tests {
    //! A UDP socket answering just enough of RFC 5766 to be a TURN server:
    //! challenge, check the signature, grant an allocation, then do whatever
    //! the test asked with the refreshes that follow.
    //!
    //! Written rather than mocked because the thing under test is what the
    //! agent reads off the wire, and a mock of the wire would only repeat what
    //! this file already believes. The real coturn round trip is issue #2025.

    use super::*;
    use std::net::Ipv4Addr;
    use stun::attributes::{ATTR_NONCE, ATTR_REALM};
    use stun::error_code::{ErrorCode, CODE_UNAUTHORIZED};
    use stun::integrity::MessageIntegrity;
    use stun::message::{Method, Setter};
    use stun::textattrs::{Nonce, Realm};
    use tokio::sync::mpsc;
    use turn::proto::relayaddr::RelayedAddress;

    /// How long a test waits for a datagram before deciding it is never
    /// coming.
    const PATIENCE: Duration = Duration::from_secs(5);

    /// The shortest lifetime the protocol can express, because LIFETIME is a
    /// count of whole seconds. The client refreshes at half of it, so a test
    /// that has to watch a refresh happen waits about 500 ms for it.
    const SHORTEST_LIFETIME: Duration = Duration::from_secs(1);

    const USER: &str = "battle-host";
    const PASSWORD: &str = "a-short-lived-secret";
    const SERVER_NAME: &str = "relay.example";

    /// What the fake server does with a Refresh.
    #[derive(Clone, Copy)]
    enum OnRefresh {
        /// Grant it, which is what a healthy server does.
        Grant,
        /// Answer with this error code, which is what a server does when the
        /// credential has expired underneath a live allocation.
        Refuse(ErrorCode),
    }

    /// Something the fake server was asked to do.
    #[derive(Debug, PartialEq, Eq)]
    enum Asked {
        /// An unsigned Allocate, which gets the challenge.
        AllocateUnsigned,
        /// An Allocate signed with a key that checks out.
        AllocateSigned,
        /// An Allocate signed with a key that does not.
        AllocateBadlySigned,
        Refresh,
    }

    struct FakeTurn {
        addr: SocketAddr,
        /// The address it hands out, which the test asserts the agent reports.
        relayed: SocketAddr,
        asked: mpsc::UnboundedReceiver<Asked>,
    }

    impl FakeTurn {
        async fn start(on_refresh: OnRefresh, lifetime: Duration) -> FakeTurn {
            let socket = UdpSocket::bind((Ipv4Addr::LOCALHOST, 0))
                .await
                .expect("a free loopback port");
            let addr = socket.local_addr().expect("a bound address");
            // Any address will do. Nothing sends to it in these tests, and the
            // point is only that the agent reports back what it was given
            // rather than anything of its own.
            let relayed = SocketAddr::from(([198, 51, 100, 7], 41641));
            let (say, asked) = mpsc::unbounded_channel();

            tokio::spawn(async move {
                let mut buf = vec![0u8; 4096];
                loop {
                    let Ok((read, from)) = socket.recv_from(&mut buf).await else {
                        return;
                    };
                    let Some(request) = decode(&buf[..read]) else {
                        continue;
                    };
                    let Some(reply) = answer(&request, relayed, lifetime, on_refresh, &say) else {
                        continue;
                    };
                    let _ = socket.send_to(&reply.raw, from).await;
                }
            });

            FakeTurn {
                addr,
                relayed,
                asked,
            }
        }

        /// Wait for the server to be asked to do `what`, failing the test
        /// rather than hanging if it never is.
        async fn waits_to_be_asked(&mut self, what: Asked) {
            let heard = tokio::time::timeout(PATIENCE, self.asked.recv())
                .await
                .unwrap_or_else(|_| panic!("the server was never asked for {what:?}"))
                .expect("the server is still running");
            assert_eq!(heard, what);
        }

        fn credentials(&self) -> TurnCredentials {
            TurnCredentials {
                server: self.addr.to_string(),
                username: USER.to_string(),
                password: PASSWORD.to_string(),
            }
        }
    }

    /// The server's whole protocol, such as it is.
    fn answer(
        request: &Message,
        relayed: SocketAddr,
        lifetime: Duration,
        on_refresh: OnRefresh,
        say: &mpsc::UnboundedSender<Asked>,
    ) -> Option<Message> {
        if request.typ.class != CLASS_REQUEST {
            return None;
        }
        if request.get(ATTR_MESSAGE_INTEGRITY).is_err() {
            let _ = say.send(Asked::AllocateUnsigned);
            return Some(challenge(request));
        }
        if !signature_checks_out(request) {
            let _ = say.send(Asked::AllocateBadlySigned);
            return Some(refusal(request, CODE_UNAUTHORIZED, "bad signature"));
        }
        if request.typ.method == METHOD_ALLOCATE {
            let _ = say.send(Asked::AllocateSigned);
            return Some(granted(request, METHOD_ALLOCATE, Some(relayed), lifetime));
        }
        if request.typ.method == METHOD_REFRESH {
            let _ = say.send(Asked::Refresh);
            return match on_refresh {
                OnRefresh::Grant => Some(granted(request, METHOD_REFRESH, None, lifetime)),
                OnRefresh::Refuse(code) => {
                    Some(refusal(request, code, "credential expired mid game"))
                }
            };
        }
        None
    }

    /// Check the client's MESSAGE-INTEGRITY the way a server would, so a test
    /// that says the agent authenticated is saying something.
    fn signature_checks_out(request: &Message) -> bool {
        let mut copy = request.clone();
        MessageIntegrity::new_long_term_integrity(
            USER.to_string(),
            SERVER_NAME.to_string(),
            PASSWORD.to_string(),
        )
        .check(&mut copy)
        .is_ok()
    }

    fn reply_to(request: &Message, typ: MessageType, attributes: Vec<Box<dyn Setter>>) -> Message {
        let mut reply = Message::new();
        let mut setters: Vec<Box<dyn Setter>> = vec![Box::new(typ)];
        setters.extend(attributes);
        reply.build(&setters).expect("a well formed reply");
        reply.transaction_id = request.transaction_id;
        reply.write_transaction_id();
        reply
    }

    fn challenge(request: &Message) -> Message {
        refusal(request, CODE_UNAUTHORIZED, "Unauthorized")
    }

    fn refusal(request: &Message, code: ErrorCode, reason: &str) -> Message {
        reply_to(
            request,
            MessageType::new(request.typ.method, CLASS_ERROR_RESPONSE),
            vec![
                Box::new(ErrorCodeAttribute {
                    code,
                    reason: reason.as_bytes().to_vec(),
                }),
                Box::new(Realm::new(ATTR_REALM, SERVER_NAME.to_string())),
                Box::new(Nonce::new(ATTR_NONCE, "a-nonce".to_string())),
            ],
        )
    }

    fn granted(
        request: &Message,
        method: Method,
        relayed: Option<SocketAddr>,
        lifetime: Duration,
    ) -> Message {
        let mut attributes: Vec<Box<dyn Setter>> = vec![Box::new(Lifetime(lifetime))];
        if let Some(relayed) = relayed {
            attributes.push(Box::new(RelayedAddress {
                ip: relayed.ip(),
                port: relayed.port(),
            }));
        }
        reply_to(
            request,
            MessageType::new(method, CLASS_SUCCESS_RESPONSE),
            attributes,
        )
    }

    fn any_local_port() -> SocketAddr {
        SocketAddr::from((Ipv4Addr::LOCALHOST, 0))
    }

    /// The point of the whole module: ask, authenticate, and come back with an
    /// address on somebody else's machine.
    #[tokio::test]
    async fn an_allocation_reports_the_address_the_server_handed_out() {
        let mut server = FakeTurn::start(OnRefresh::Grant, Duration::from_secs(600)).await;
        let credentials = server.credentials();

        let allocation = TurnAllocation::open(any_local_port(), &credentials)
            .await
            .expect("the server granted an allocation");

        assert_eq!(
            allocation.relayed_addr(),
            server.relayed,
            "the battle has to advertise the server's address, not one of ours"
        );
        assert_eq!(allocation.failure(), None);
        // The exchange is the assertion: an unsigned ask, a challenge, then an
        // ask signed with a key the server checked for itself.
        server.waits_to_be_asked(Asked::AllocateUnsigned).await;
        server.waits_to_be_asked(Asked::AllocateSigned).await;
        allocation.close().await;
    }

    /// A credential the server will not take is refused at the door, and says
    /// so precisely enough for the caller to know not to try again.
    #[tokio::test]
    async fn a_credential_the_server_rejects_is_reported_as_refused() {
        let mut server = FakeTurn::start(OnRefresh::Grant, Duration::from_secs(600)).await;
        let credentials = TurnCredentials {
            password: "not-the-password".to_string(),
            ..server.credentials()
        };

        let failure = TurnAllocation::open(any_local_port(), &credentials)
            .await
            .err()
            .expect("a server that will not take the credential grants nothing");

        assert_eq!(
            failure,
            AllocationFailure::Refused {
                code: 401,
                reason: "bad signature".to_string()
            }
        );
        assert!(
            failure.is_credential_failure(),
            "retrying a credential the server has already refused only wastes the battle"
        );
        server.waits_to_be_asked(Asked::AllocateUnsigned).await;
        server.waits_to_be_asked(Asked::AllocateBadlySigned).await;
    }

    /// The allocation is held open, which is the difference between a battle
    /// that lasts and one that stops after the first lifetime.
    #[tokio::test]
    async fn a_granted_allocation_is_held_open_with_refresh() {
        let mut server = FakeTurn::start(OnRefresh::Grant, SHORTEST_LIFETIME).await;
        let allocation = TurnAllocation::open(any_local_port(), &server.credentials())
            .await
            .expect("the server granted an allocation");

        server.waits_to_be_asked(Asked::AllocateUnsigned).await;
        server.waits_to_be_asked(Asked::AllocateSigned).await;
        // Twice, so this is the client's own timer keeping the allocation
        // alive rather than one refresh that happened to go out.
        server.waits_to_be_asked(Asked::Refresh).await;
        server.waits_to_be_asked(Asked::Refresh).await;

        assert_eq!(
            allocation.failure(),
            None,
            "refreshes were being answered, so nothing was lost"
        );
        allocation.close().await;
    }

    /// A credential that expires under a live allocation takes the battle with
    /// it, so the agent has to notice rather than sit there.
    ///
    /// This is the failure the `turn` crate hides: its own refresh loop reads a
    /// non-438 error response as success and carries on refreshing an
    /// allocation the server has thrown away.
    #[tokio::test]
    async fn a_refused_refresh_loses_the_allocation_and_breaks_the_relay() {
        let mut server =
            FakeTurn::start(OnRefresh::Refuse(CODE_UNAUTHORIZED), SHORTEST_LIFETIME).await;
        let allocation = TurnAllocation::open(any_local_port(), &server.credentials())
            .await
            .expect("the server granted an allocation");
        server.waits_to_be_asked(Asked::AllocateUnsigned).await;
        server.waits_to_be_asked(Asked::AllocateSigned).await;
        server.waits_to_be_asked(Asked::Refresh).await;

        // The demux is sitting in exactly this call, so this returning is what
        // stops a lost allocation looking like a quiet game.
        let mut buf = vec![0u8; 4096];
        let stopped = tokio::time::timeout(PATIENCE, RelayLink::recv_from(&allocation, &mut buf))
            .await
            .expect("the relay gave up rather than waiting out the game")
            .expect_err("a deleted allocation cannot deliver datagrams");
        assert!(
            stopped.to_string().contains("error 401"),
            "the reason has to survive as far as the caller, got: {stopped}"
        );

        let failure = allocation.failure().expect("a recorded failure");
        assert!(
            failure.is_credential_failure(),
            "a refused credential is the one loss there is no point retrying, got: {failure}"
        );
    }

    /// A server that stops answering is the same loss arriving quietly, and the
    /// only thing that catches it is the clock.
    ///
    /// The clock is the whole mechanism here, so this drives it directly with
    /// tokio's test clock rather than waiting out a real lifetime.
    #[tokio::test(start_paused = true)]
    async fn an_unanswered_refresh_expires_the_allocation_on_time() {
        let lifetime = Duration::from_secs(600);
        let health = Arc::new(Health::new());
        health.saw_inbound(&granted_out_of_thin_air(lifetime).raw);
        let watching = tokio::spawn(watch_lifetime(Arc::clone(&health)));

        // Half a lifetime in, a refresh has gone unanswered but the server has
        // not deleted anything yet, so neither has the agent.
        tokio::time::advance(lifetime / 2).await;
        assert_eq!(health.failure(), None);

        // Past the lifetime, the server has dropped it whether it said so or
        // not.
        tokio::time::advance(lifetime).await;
        watching.await.expect("the watchdog finished");
        assert_eq!(health.failure(), Some(AllocationFailure::Expired));
    }

    /// An answered refresh pushes the deadline out, or every allocation would
    /// die one lifetime after it was granted however healthy it was.
    #[tokio::test(start_paused = true)]
    async fn an_answered_refresh_pushes_the_expiry_out() {
        let lifetime = Duration::from_secs(600);
        let health = Arc::new(Health::new());
        health.saw_inbound(&granted_out_of_thin_air(lifetime).raw);
        let watching = tokio::spawn(watch_lifetime(Arc::clone(&health)));

        // Four half lifetimes of healthy refreshing, which is twice as long as
        // an unrefreshed allocation survives.
        for _ in 0..4 {
            tokio::time::advance(lifetime / 2).await;
            health.saw_inbound(&granted_out_of_thin_air(lifetime).raw);
        }
        assert_eq!(
            health.failure(),
            None,
            "the allocation was being refreshed the whole time"
        );

        // Then the refreshes stop.
        tokio::time::advance(lifetime * 2).await;
        watching.await.expect("the watchdog finished");
        assert_eq!(health.failure(), Some(AllocationFailure::Expired));
    }

    /// A Refresh success response, for the tests that drive [`Health`] on its
    /// own rather than through a server.
    fn granted_out_of_thin_air(lifetime: Duration) -> Message {
        let mut request = Message::new();
        request
            .build(&[Box::new(MessageType::new(METHOD_REFRESH, CLASS_REQUEST))])
            .expect("a well formed request");
        granted(&request, METHOD_REFRESH, None, lifetime)
    }

    /// The 401 that starts every long-term credential exchange is not a
    /// refusal, and reading it as one would mean no allocation ever opened.
    #[tokio::test]
    async fn the_opening_challenge_is_not_read_as_a_refusal() {
        let health = Health::new();
        let mut unsigned = Message::new();
        unsigned
            .build(&[Box::new(MessageType::new(METHOD_ALLOCATE, CLASS_REQUEST))])
            .expect("a well formed request");
        health.saw_outbound(&unsigned.raw);
        health.saw_inbound(&challenge(&unsigned).raw);

        assert_eq!(health.failure(), None);
    }
}
