//! Getting a relay credential out of the lobby and into the relay agent.
//!
//! A TURN server will not open an allocation for anybody who asks, or it
//! becomes free bandwidth for the internet. The lobby vouches for its own users
//! instead, by minting a username and password the relay can check on its own.
//! `coilbox_lobby_protocol` owns the wire side of that exchange. This is the
//! part that decides when to ask, waits for the answer, and turns it into what
//! [`crate::relay_sidecar::Turn`] needs.
//!
//! [`credentials`] is the whole seam. Whatever opens a relayed battle calls it,
//! gets a credential or a sentence explaining why there is not one, and never
//! has to know whether it came off the wire just now or was already held.
//!
//! No server implements the command yet. ScarylePoo/uberserver#27 is the server
//! half and it is open, so today every ask ends in [`NoCredential::Silent`],
//! which is deliberately worded for exactly that.

use std::sync::Mutex;
use std::time::Duration;

use coilbox_lobby_protocol::{command, Delta, LobbyState, TurnCredentials};
use tokio::sync::watch;

use crate::conn::{ConnProtocol, Outbound, Registry};
use crate::lock_or_recover;
use crate::relay_sidecar::Turn;

/// The lobby's last answer about a relay credential, so a caller waiting on one
/// can be woken by the connection task that read it.
///
/// The credential is also held in [`coilbox_lobby_protocol::LobbyState`], which
/// is where it is read from once it is no longer news. This is the wake-up.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum TurnAnswer {
    /// The lobby has not answered on this connection. Every connection starts
    /// here and a connection to a server without the command stays here.
    Unasked,
    Granted(TurnCredentials),
    /// The lobby said no, in its own words.
    Refused(String),
}

/// A connection's slot for [`TurnAnswer`], watched rather than locked so a
/// caller can wait on the next answer rather than poll for it.
pub type TurnSlot = watch::Receiver<TurnAnswer>;

/// How much life a credential has to have left before it is worth taking to the
/// relay.
///
/// The relay agent rebuilds an allocation it has lost, backing off up to 32
/// seconds between tries (`LONGEST_BACKOFF` in `coilbox-relay-agent`'s
/// `main.rs`), and it signs each try with this same credential. One with less
/// than that left would be dead before the rebuild it has to sign, so a battle
/// that survived losing its allocation would not survive getting it back.
///
/// This is not headroom for a long game. Nothing here can offer that: once
/// coilbox is closed there is no lobby connection left to ask on, and issue
/// #2042 is where that gap is written down.
const REBUILD_HEADROOM: Duration = Duration::from_secs(32);

/// Why there is no relay credential.
///
/// Every one of these is something to tell the person who was trying to host,
/// because each of them is the difference between hosting and not.
#[derive(Debug)]
pub enum NoCredential {
    /// No connection under that key, so there is no lobby to ask.
    NotConnected(String),
    /// The connection is to a server that does not speak the lobby line
    /// protocol, so there is nothing to ask with.
    WrongProtocol,
    /// The connection ended before the ask could be written.
    Closed,
    /// The lobby refused, in its own words.
    Refused(String),
    /// Nothing came back at all. Far and away the likeliest answer today,
    /// because a server that has never heard of the command says nothing.
    Silent(Duration),
    /// The lobby minted one that was already spent, or so nearly spent that it
    /// would not outlive the first thing that went wrong.
    TooShort,
    /// The lobby named a relay coilbox cannot use, and why.
    Unusable(String),
}

impl std::fmt::Display for NoCredential {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            NoCredential::NotConnected(key) => write!(f, "not connected: {key}"),
            NoCredential::WrongProtocol => write!(
                f,
                "this server does not speak the TASServer line protocol, so it has no relay to ask about"
            ),
            NoCredential::Closed => write!(f, "the connection closed before the lobby was asked"),
            NoCredential::Refused(why) => write!(f, "the lobby would not hand out a relay credential: {why}"),
            NoCredential::Silent(waited) => write!(
                f,
                "the lobby did not answer within {} seconds, so it probably does not hand out relay credentials at all",
                waited.as_secs()
            ),
            NoCredential::TooShort => write!(
                f,
                "the lobby handed out a relay credential with too little time left on it to host with"
            ),
            NoCredential::Unusable(why) => write!(f, "the lobby named a relay coilbox cannot use: {why}"),
        }
    }
}

impl std::error::Error for NoCredential {}

/// A relay credential for `server_key`, asking the lobby for a fresh one if the
/// held one has run out or there is not one.
///
/// `now_ms` is unix millis and `patience` is how long to wait for an answer.
/// Both are parameters because the caller is the one with a budget and the
/// tests are the one place there is no clock.
///
/// A credential is never handed back past its lifetime. The relay checks the
/// expiry on every request, so reusing a spent one would not fail at hosting
/// time, it would fail somewhere in the middle of a game.
pub async fn credentials(
    registry: &Registry,
    server_key: &str,
    now_ms: u64,
    patience: Duration,
) -> Result<Turn, NoCredential> {
    // Everything that touches the registry happens here, in one place, because
    // the lock must not be held across the wait below.
    let (held, mut answers, tx) = {
        let map = lock_or_recover(registry);
        let conn = map
            .get(server_key)
            .ok_or_else(|| NoCredential::NotConnected(server_key.to_string()))?;
        if conn.protocol != ConnProtocol::TasServer {
            return Err(NoCredential::WrongProtocol);
        }
        let held = lock_or_recover(&conn.state)
            .live_turn_credentials(usable_until(now_ms))
            .cloned();
        (held, conn.turn.clone(), conn.tx.clone())
    };

    if let Some(held) = held {
        return usable(&held);
    }

    // Mark whatever is in the slot as seen before asking, so an answer that
    // arrives while the ask is still being written is not missed.
    answers.borrow_and_update();
    tx.send(Outbound::Line(command::turn_credentials()))
        .map_err(|_| NoCredential::Closed)?;

    let answer = tokio::time::timeout(patience, next_answer(&mut answers))
        .await
        .map_err(|_| NoCredential::Silent(patience))?;
    match answer {
        // The connection ended while we waited, which is the same shape of
        // nothing as a server that never answers.
        None => Err(NoCredential::Closed),
        Some(TurnAnswer::Granted(minted)) => {
            if !minted.live_at(usable_until(now_ms)) {
                return Err(NoCredential::TooShort);
            }
            usable(&minted)
        }
        Some(TurnAnswer::Refused(why)) => Err(NoCredential::Refused(why)),
        // The slot only ever changes to an answer, so this is unreachable in
        // practice. Treating it as no answer beats waiting again.
        Some(TurnAnswer::Unasked) => Err(NoCredential::Silent(patience)),
    }
}

/// The answer, if any, a delta the reducer just produced carries.
///
/// The connection task calls this on every delta and puts what comes back in
/// the connection's slot, which is what wakes [`credentials`]. The credential
/// itself is read back out of the state rather than carried in the delta,
/// because a password is not something to put on the event channel to the
/// frontend.
pub(crate) fn answer_in(delta: &Delta, state: &Mutex<LobbyState>) -> Option<TurnAnswer> {
    match delta {
        Delta::TurnCredentials { .. } => Some(TurnAnswer::Granted(
            lock_or_recover(state).turn_credentials.clone()?,
        )),
        Delta::TurnCredentialsRefused { reason } => Some(TurnAnswer::Refused(reason.clone())),
        _ => None,
    }
}

/// The moment a credential has to still be live at for it to be worth using.
fn usable_until(now_ms: u64) -> u64 {
    now_ms.saturating_add(REBUILD_HEADROOM.as_millis() as u64)
}

/// Wait for the slot to change, or for the connection task to drop its end.
async fn next_answer(answers: &mut TurnSlot) -> Option<TurnAnswer> {
    answers.changed().await.ok()?;
    Some(answers.borrow().clone())
}

/// The credential as the relay agent takes it.
fn usable(minted: &TurnCredentials) -> Result<Turn, NoCredential> {
    Ok(Turn {
        server: relay_address(&minted.uri)?,
        user: minted.username.clone(),
        password: minted.password.clone(),
    })
}

/// The `host:port` the relay agent's `--turn-server` takes, out of the URI the
/// lobby named the relay with.
///
/// The lobby names it the way TURN servers are named everywhere else, as
/// `turn:host:port` (RFC 7065), and the agent takes a bare `host:port`. A
/// `?transport=` on the end is dropped: the agent speaks UDP and there is
/// nothing to select.
///
/// `turns:` is refused rather than quietly treated as `turn:`. It is TURN over
/// TLS on a different port, the agent has no TLS, and sending UDP at a TLS port
/// would fail as a relay that never answers rather than as anything a person
/// could read.
fn relay_address(uri: &str) -> Result<String, NoCredential> {
    let unusable = |why: String| Err(NoCredential::Unusable(why));
    if let Some(rest) = uri.strip_prefix("turns:") {
        return unusable(format!(
            "{rest} is TURN over TLS, and the relay agent speaks plain UDP"
        ));
    }
    // A scheme is optional, so that a lobby naming a bare host and port is read
    // as the same thing rather than as a host called "turn".
    let authority = uri.strip_prefix("turn:").unwrap_or(uri);
    let authority = authority.split('?').next().unwrap_or(authority);
    // From the right, so an IPv6 address written `[2001:db8::1]:3478` keeps its
    // colons and gives up only the port.
    let Some((host, port)) = authority.rsplit_once(':') else {
        return unusable(format!("{uri} names no port"));
    };
    if host.is_empty() || port.parse::<u16>().is_err() {
        return unusable(format!("{uri} is not a host and a port"));
    }
    Ok(authority.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::conn::{EventSink, ServerConn, StartedBattle, TachyonHandle};
    use coilbox_lobby_protocol::{parse_line, reduce_at, LoginPhase};
    use std::sync::Arc;
    use tauri::ipc::Channel;
    use tokio::sync::mpsc;

    /// A moment with room either side of it, so a test can talk about a
    /// credential that has run out without arithmetic underflowing.
    const NOW: u64 = 1_786_000_000_000;

    /// How long a test waits before deciding an answer is never coming.
    const PATIENCE: Duration = Duration::from_secs(5);

    /// The ends of a registered connection a test drives: what it sent, and the
    /// slot the connection task would be answering into.
    struct Wired {
        registry: Registry,
        sent: mpsc::UnboundedReceiver<Outbound>,
        answers: watch::Sender<TurnAnswer>,
        state: Arc<Mutex<LobbyState>>,
    }

    fn wired(protocol: ConnProtocol) -> Wired {
        let registry = Registry::default();
        let (tx, sent) = mpsc::unbounded_channel::<Outbound>();
        let (answers, turn) = watch::channel(TurnAnswer::Unasked);
        let state = Arc::new(Mutex::new(LobbyState::new()));
        lock_or_recover(&registry).insert(
            "alice@bar:8200".to_string(),
            ServerConn {
                protocol,
                tx,
                state: state.clone(),
                sink: Arc::new(Mutex::new(Channel::new(|_| Ok(())))) as EventSink,
                phase: watch::channel(LoginPhase::Ready).1,
                agreement: Arc::new(Mutex::new(None)),
                tachyon: TachyonHandle::default(),
                started: StartedBattle::default(),
                turn,
            },
        );
        Wired {
            registry,
            sent,
            answers,
            state,
        }
    }

    /// The answer a lobby running ScarylePoo/uberserver#27 would send, folded
    /// through the real parser and reducer rather than hand-built, so a change
    /// to either shows up here.
    fn minted(state: &Arc<Mutex<LobbyState>>, ttl_seconds: u64, at: u64) -> TurnCredentials {
        reduce_at(
            &mut lock_or_recover(state),
            parse_line(&format!(
                "TURNCREDENTIALS turn:relay.example.org:3478 1786086400:alice bWFj= {ttl_seconds}"
            )),
            at,
        );
        lock_or_recover(state)
            .turn_credentials
            .clone()
            .expect("the reducer held it")
    }

    /// The whole point: nothing held, so the lobby is asked, and its answer
    /// comes back as something the relay agent can be started with.
    #[tokio::test]
    async fn asking_the_lobby_produces_a_credential_the_agent_can_use() {
        let mut w = wired(ConnProtocol::TasServer);
        let state = w.state.clone();
        let answers = w.answers.clone();
        tokio::spawn(async move {
            let _ = answers.send(TurnAnswer::Granted(minted(&state, 86_400, NOW)));
        });

        let turn = credentials(&w.registry, "alice@bar:8200", NOW, PATIENCE)
            .await
            .expect("the lobby answered with a credential");

        assert_eq!(turn.server, "relay.example.org:3478");
        assert_eq!(turn.user, "1786086400:alice");
        assert_eq!(turn.password, "bWFj=");
        // Not awaited: the ask is written before the wait begins, so by the
        // time an answer is back the line is already in the channel. Waiting
        // for it would hang rather than fail when it was never sent.
        assert!(matches!(
            w.sent.try_recv(),
            Ok(Outbound::Line(line)) if line == "TURNCREDENTIALS"
        ));
    }

    /// A credential already in hand is used rather than asked for again, so
    /// hosting twice in one session does not mint twice.
    #[tokio::test]
    async fn a_credential_we_already_hold_is_not_asked_for_again() {
        let mut w = wired(ConnProtocol::TasServer);
        minted(&w.state, 86_400, NOW);

        credentials(&w.registry, "alice@bar:8200", NOW, PATIENCE)
            .await
            .expect("the held credential was good");

        assert!(
            w.sent.try_recv().is_err(),
            "nothing should have been sent to the lobby"
        );
    }

    /// The load-bearing one. A credential past its lifetime is not reused: the
    /// relay checks the expiry on every request, so reusing one would not fail
    /// at hosting time, it would end a game already being played.
    #[tokio::test]
    async fn a_credential_that_has_run_out_is_asked_for_again() {
        let mut w = wired(ConnProtocol::TasServer);
        minted(&w.state, 600, NOW);
        let later = NOW + 601_000;

        let state = w.state.clone();
        let answers = w.answers.clone();
        tokio::spawn(async move {
            let _ = answers.send(TurnAnswer::Granted(minted(&state, 86_400, later)));
        });

        credentials(&w.registry, "alice@bar:8200", later, PATIENCE)
            .await
            .expect("a fresh credential was minted");

        // Not awaited: the ask is written before the wait begins, so by the
        // time an answer is back the line is already in the channel. Waiting
        // for it would hang rather than fail when it was never sent.
        assert!(matches!(
            w.sent.try_recv(),
            Ok(Outbound::Line(line)) if line == "TURNCREDENTIALS"
        ));
    }

    /// One with seconds left is as good as one that has run out. The relay
    /// agent's rebuild backs off up to 32 seconds and signs the rebuild with
    /// this credential, so anything shorter cannot survive the one failure the
    /// agent is built to recover from.
    #[tokio::test]
    async fn a_credential_about_to_run_out_is_asked_for_again() {
        let mut w = wired(ConnProtocol::TasServer);
        minted(&w.state, 20, NOW);

        let state = w.state.clone();
        let answers = w.answers.clone();
        tokio::spawn(async move {
            let _ = answers.send(TurnAnswer::Granted(minted(&state, 86_400, NOW)));
        });

        credentials(&w.registry, "alice@bar:8200", NOW, PATIENCE)
            .await
            .expect("a fresh credential was minted");

        // Not awaited: the ask is written before the wait begins, so by the
        // time an answer is back the line is already in the channel. Waiting
        // for it would hang rather than fail when it was never sent.
        assert!(matches!(
            w.sent.try_recv(),
            Ok(Outbound::Line(line)) if line == "TURNCREDENTIALS"
        ));
    }

    /// And a fresh one that short is refused rather than taken to the relay,
    /// because asking again would only get the same one.
    #[tokio::test]
    async fn a_freshly_minted_credential_that_is_too_short_is_refused() {
        let w = wired(ConnProtocol::TasServer);
        let state = w.state.clone();
        let answers = w.answers.clone();
        tokio::spawn(async move {
            let _ = answers.send(TurnAnswer::Granted(minted(&state, 5, NOW)));
        });

        let refused = credentials(&w.registry, "alice@bar:8200", NOW, PATIENCE)
            .await
            .expect_err("five seconds is not long enough to host with");
        assert!(matches!(refused, NoCredential::TooShort), "got: {refused}");
    }

    /// A refusal has to reach the caller in the lobby's own words, because the
    /// caller is a person who is about to be told they cannot host.
    #[tokio::test]
    async fn a_refusal_carries_the_lobbys_reason() {
        let w = wired(ConnProtocol::TasServer);
        let answers = w.answers.clone();
        tokio::spawn(async move {
            let _ = answers.send(TurnAnswer::Refused("you have asked too often".to_string()));
        });

        let refused = credentials(&w.registry, "alice@bar:8200", NOW, PATIENCE)
            .await
            .expect_err("the lobby said no");
        assert!(
            refused.to_string().contains("you have asked too often"),
            "the lobby's words have to reach the host, got: {refused}"
        );
    }

    /// Every server today, because none of them has the command. Saying nothing
    /// must end in a sentence rather than a wait with no end.
    #[tokio::test]
    async fn a_lobby_that_has_never_heard_of_the_command_says_so_rather_than_hanging() {
        let w = wired(ConnProtocol::TasServer);

        let waited = Duration::from_millis(50);
        let quiet = credentials(&w.registry, "alice@bar:8200", NOW, waited)
            .await
            .expect_err("nothing answered");
        assert!(matches!(quiet, NoCredential::Silent(_)), "got: {quiet}");
        assert!(
            quiet.to_string().contains("does not hand out relay"),
            "the host has to be told what the silence means, got: {quiet}"
        );
    }

    /// The other two protocols have their own hosting and no such command, so
    /// asking is refused before a line is built rather than waited out.
    #[tokio::test]
    async fn a_connection_to_another_protocol_is_refused_rather_than_asked() {
        for protocol in [ConnProtocol::Tachyon, ConnProtocol::Zerok] {
            let w = wired(protocol);
            let refused = credentials(&w.registry, "alice@bar:8200", NOW, PATIENCE)
                .await
                .expect_err("this connection cannot be asked");
            assert!(
                matches!(refused, NoCredential::WrongProtocol),
                "got: {refused}"
            );
        }
    }

    #[tokio::test]
    async fn a_key_naming_no_connection_has_no_lobby_to_ask() {
        let w = wired(ConnProtocol::TasServer);
        let missing = credentials(&w.registry, "alice@elsewhere:443", NOW, PATIENCE)
            .await
            .expect_err("there is no such connection");
        assert!(
            matches!(missing, NoCredential::NotConnected(_)),
            "got: {missing}"
        );
    }

    /// The connection task's half of the seam, on the two lines that matter and
    /// on one that does not. Driven through the real parser and reducer, so this
    /// is the whole path from a server line to something a caller can be woken
    /// with.
    /// A lobby that logs a client in and answers `TURNCREDENTIALS` with
    /// `answer`, or with nothing at all when there is none.
    async fn lobby_answering(answer: Option<String>) -> std::net::SocketAddr {
        use coilbox_lobby_protocol::server::{line, parse_client_line, ClientCommand};
        use futures_util::{SinkExt, StreamExt};
        use tokio::net::TcpListener;
        use tokio_util::codec::{Framed, LinesCodec};

        let listener = TcpListener::bind("127.0.0.1:0").await.expect("a free port");
        let addr = listener.local_addr().expect("a bound address");
        tokio::spawn(async move {
            let Ok((stream, _)) = listener.accept().await else {
                return;
            };
            let mut framed = Framed::new(stream, LinesCodec::new());
            if framed
                .send(line::tas_server("0.38", "*", 8452, 0))
                .await
                .is_err()
            {
                return;
            }
            while let Some(Ok(read)) = framed.next().await {
                let reply = match parse_client_line(&read) {
                    ClientCommand::ListCompFlags => line::comp_flags(&["u", "sp"]),
                    ClientCommand::Login { username, .. } => {
                        if framed.send(line::accepted(&username)).await.is_err() {
                            return;
                        }
                        line::login_info_end()
                    }
                    // The room server this parser is written for has no relay to
                    // hand out, so the ask arrives as a command it does not know.
                    _ if read.trim() == "TURNCREDENTIALS" => match &answer {
                        Some(answer) => answer.clone(),
                        None => continue,
                    },
                    _ => continue,
                };
                if framed.send(reply).await.is_err() {
                    return;
                }
            }
        });
        addr
    }

    /// Connect and log in the way `mp_connect` does, and hand back the key.
    async fn logged_in(registry: &Registry, addr: std::net::SocketAddr) -> String {
        use coilbox_lobby_protocol::{password_hash, LoginConfig, LoginMode};

        let stream = tokio::net::TcpStream::connect(addr)
            .await
            .expect("the lobby is listening");
        let key = format!("alice@{addr}");
        let logs = std::env::temp_dir().join("coilbox-turn-credentials-tests");
        crate::conn::spawn_connection(
            registry.clone(),
            key.clone(),
            Box::new(stream),
            LoginConfig {
                username: "alice".to_string(),
                password_hash: password_hash("hunter2"),
                local_ip: "127.0.0.1".to_string(),
                agent: "Coilbox test".to_string(),
                client_id: "1".to_string(),
                compat_flags: vec!["u".to_string()],
                use_stls: false,
                mode: LoginMode::Login,
            },
            Channel::new(|_| Ok(())),
            crate::dmlog::DmLog::new(&logs, &key),
            crate::dmlog::DmLog::new(&logs, &key),
        );
        crate::conn::wait_until_ready(registry, &key, PATIENCE)
            .await
            .expect("the lobby logged us in");
        key
    }

    /// The whole exchange over a real socket, through the real connection task,
    /// which is the only place the ask, the wire and the wake-up meet.
    #[tokio::test]
    async fn a_lobby_that_answers_over_a_socket_ends_in_a_credential() {
        let addr = lobby_answering(Some(
            "TURNCREDENTIALS turn:relay.example.org:3478 1786086400:alice bWFj= 86400".to_string(),
        ))
        .await;
        let registry = Registry::default();
        let key = logged_in(&registry, addr).await;

        let turn = credentials(&registry, &key, NOW, PATIENCE)
            .await
            .expect("the lobby minted one");
        assert_eq!(turn.server, "relay.example.org:3478");
        assert_eq!(turn.user, "1786086400:alice");
        assert_eq!(turn.password, "bWFj=");
    }

    /// The same path, refused. The lobby's words have to survive the socket, the
    /// reducer and the wake-up to reach whoever was trying to host.
    #[tokio::test]
    async fn a_lobby_that_refuses_over_a_socket_says_why() {
        let addr = lobby_answering(Some(
            "TURNCREDENTIALSFAILED you asked too often".to_string(),
        ))
        .await;
        let registry = Registry::default();
        let key = logged_in(&registry, addr).await;

        let refused = credentials(&registry, &key, NOW, PATIENCE)
            .await
            .expect_err("the lobby said no");
        assert!(
            refused.to_string().contains("you asked too often"),
            "got: {refused}"
        );
    }

    /// Every real server today. Nothing answers, and the ask has to end in a
    /// sentence rather than a client stuck waiting on a command the server has
    /// never heard of.
    #[tokio::test]
    async fn a_lobby_without_the_command_over_a_socket_is_not_an_error_it_is_a_silence() {
        let addr = lobby_answering(None).await;
        let registry = Registry::default();
        let key = logged_in(&registry, addr).await;

        let quiet = credentials(&registry, &key, NOW, Duration::from_millis(250))
            .await
            .expect_err("nothing answered");
        assert!(matches!(quiet, NoCredential::Silent(_)), "got: {quiet}");
        // And the connection is still perfectly usable afterwards.
        assert!(lock_or_recover(&registry).contains_key(&key));
    }

    #[test]
    fn a_line_off_the_wire_becomes_the_answer_a_waiting_caller_gets() {
        let state = Mutex::new(LobbyState::new());

        let minted = reduce_at(
            &mut lock_or_recover(&state),
            parse_line("TURNCREDENTIALS turn:relay.example.org:3478 alice bWFj= 86400"),
            NOW,
        );
        let answer = answer_in(&minted[0], &state).expect("a credential is an answer");
        let TurnAnswer::Granted(granted) = answer else {
            panic!("expected a credential, got {answer:?}");
        };
        assert_eq!(granted.password, "bWFj=");
        assert_eq!(granted.expires_at, NOW + 86_400_000);

        let refused = reduce_at(
            &mut lock_or_recover(&state),
            parse_line("TURNCREDENTIALSFAILED you asked too often"),
            NOW,
        );
        assert_eq!(
            answer_in(&refused[0], &state),
            Some(TurnAnswer::Refused("you asked too often".to_string()))
        );

        // Everything else on the connection leaves a waiting caller waiting.
        let unrelated = reduce_at(
            &mut lock_or_recover(&state),
            parse_line("HOSTPORT 8452"),
            NOW,
        );
        assert_eq!(answer_in(&unrelated[0], &state), None);
    }

    #[test]
    fn a_relay_uri_becomes_the_host_and_port_the_agent_takes() {
        for (uri, expected) in [
            ("turn:relay.example.org:3478", "relay.example.org:3478"),
            ("turn:198.51.100.9:3478", "198.51.100.9:3478"),
            // The query coturn's own REST answers carry.
            (
                "turn:relay.example.org:3478?transport=udp",
                "relay.example.org:3478",
            ),
            // A lobby that named it the way the agent wants it already.
            ("relay.example.org:3478", "relay.example.org:3478"),
            // IPv6 keeps its colons and gives up only the port.
            ("turn:[2001:db8::1]:3478", "[2001:db8::1]:3478"),
        ] {
            assert_eq!(
                relay_address(uri).expect("a usable relay"),
                expected,
                "for {uri}"
            );
        }
    }

    #[test]
    fn a_relay_coilbox_cannot_reach_is_refused_in_words() {
        for uri in [
            // TLS on a different port, and the agent has no TLS.
            "turns:relay.example.org:5349",
            // No port to send to.
            "turn:relay.example.org",
            "turn:[2001:db8::1]",
            // A port that is not one.
            "turn:relay.example.org:https",
            // Nothing at all.
            "turn:",
            "",
        ] {
            let refused = relay_address(uri).expect_err("not a relay coilbox can use");
            assert!(
                matches!(refused, NoCredential::Unusable(_)),
                "for {uri}, got: {refused}"
            );
        }
    }
}
