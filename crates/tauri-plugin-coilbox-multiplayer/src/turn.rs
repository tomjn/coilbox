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
//! Nothing is asked of a server that has not said it has a relay. It says so in
//! its compatibility flags, before login, so the answer is already held by the
//! time anybody wants to host, and asking anyway would cost a round trip that
//! ends in silence.
//!
//! No server implements either half yet. ScarylePoo/uberserver#26 is the flag
//! and #27 is the command, both open, so today every ask ends in
//! [`NoCredential::NoRelay`] without a line being sent.

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

/// How much life a credential has to have left, on top of the game itself,
/// before it is worth taking to the relay.
///
/// The relay agent rebuilds an allocation it has lost, backing off up to 32
/// seconds between tries (`LONGEST_BACKOFF` in `coilbox-relay-agent`'s
/// `main.rs`), and it signs each try with this same credential. One with less
/// than that left would be dead before the rebuild it has to sign, so a battle
/// that survived losing its allocation would not survive getting it back.
const REBUILD_HEADROOM: Duration = Duration::from_secs(32);

/// How long a game coilbox refuses to host below.
///
/// A credential running out under a live allocation costs nothing. #2041 staged
/// that against coturn 4.17.2: coturn works the key out once when it creates the
/// session and checks every later request against the key it kept, so an
/// allocation opened on a two second credential was still relaying at 2.7
/// seconds. What ends a game is the credential being dead when the relay has to
/// be **rebuilt**, because a rebuild opens a new session, the credential is
/// judged again, and a dead one answers 401. Nothing renews it: the agent
/// outlives the coilbox window on purpose (#2013), so once coilbox is closed
/// there is no lobby connection left to ask on. The only lever left is refusing
/// at hosting time.
///
/// A rebuild can happen at any moment, so the credential has to still be alive
/// at the end of the game. That makes this a question about how long games run,
/// which is measurable rather than arguable.
///
/// 5083 seconds is the 99th percentile of 18,418 multiplayer games, taken from
/// `api.bar-rts.com/replays` on 30 August 2026: 20,000 replays covering 22 to 29
/// August 2026, keeping the 18,418 with at least two human players and a
/// recorded duration. Median 1302s, p90 3051s, p95 3597s, p99 5083s, p99.9
/// 8437s, longest 26,396s.
///
/// The 99th percentile rather than anything further out because that is where
/// the tail stops being measured and starts being one game. Split by day, p99
/// sat between 4899s and 5529s across all eight days, while p99.9 swung from
/// 7004s to 9593s and the maximum is a single 7.3 hour game. A threshold built
/// on 14 games would move every time somebody played a long one.
///
/// The 23 replays in `~/.spring/demos` on the development machine were checked
/// first and are not what this rests on: five are not demo files, ten recorded
/// no game time, and three are copies of one match, leaving six distinct games
/// with a longest of 2356s. Consistent with the figures above, far too few to
/// take a percentile from.
const LONGEST_GAME: Duration = Duration::from_secs(5083);

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
    /// The server has no relay, so there is nothing to ask it for. Far and away
    /// the likeliest answer today, because the flag that says otherwise is
    /// ScarylePoo/uberserver#26 and no server names it yet.
    NoRelay,
    /// Nothing came back at all: a server that advertised a relay and then said
    /// nothing when asked for a credential.
    Silent(Duration),
    /// The lobby minted one too short to see a game out, so the battle would end
    /// the first time the relay had to be rebuilt. `left` is what the lobby gave
    /// and `needed` is [`hosting_needs`].
    TooShort { left: Duration, needed: Duration },
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
            NoCredential::NoRelay => write!(
                f,
                "this server has no relay, so there is no credential for one to ask it for"
            ),
            NoCredential::Refused(why) => write!(f, "the lobby would not hand out a relay credential: {why}"),
            NoCredential::Silent(waited) => write!(
                f,
                "the lobby did not answer within {} seconds, so it probably does not hand out relay credentials at all",
                waited.as_secs()
            ),
            NoCredential::TooShort { left, needed } => write!(
                f,
                "the lobby's relay credential lasts {}, and hosting a relayed battle needs {}. \
                 99 games in 100 finish inside that, and a relayed battle ends the moment its \
                 relay has to be rebuilt on a credential that has run out",
                plainly(*left),
                plainly(round_up_to_a_minute(*needed)),
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
/// A credential is never handed back unless it has [`hosting_needs`] left on
/// it. Anything shorter would open a battle that ends the first time its relay
/// has to be rebuilt, which is a game lost rather than a battle that failed to
/// open.
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
        let state = lock_or_recover(&conn.state);
        // Whether there is a relay at all is settled before login, so it is
        // known by the time anybody asks. A server without one is not asked:
        // the command means nothing to it, the answer would be silence, and the
        // caller would wait out the whole patience budget to learn what its own
        // state could have told it straight away.
        if !state.relay_hosting_available() {
            return Err(NoCredential::NoRelay);
        }
        let held = state.live_turn_credentials(usable_until(now_ms)).cloned();
        drop(state);
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
                return Err(NoCredential::TooShort {
                    left: Duration::from_millis(minted.expires_at.saturating_sub(now_ms)),
                    needed: hosting_needs(),
                });
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

/// How much life a credential needs on it before a relayed battle can be opened
/// on it: a game of [`LONGEST_GAME`], and the rebuild that might be needed at
/// the very end of it.
fn hosting_needs() -> Duration {
    LONGEST_GAME.saturating_add(REBUILD_HEADROOM)
}

/// The moment a credential has to still be live at for it to be worth using.
fn usable_until(now_ms: u64) -> u64 {
    now_ms.saturating_add(hosting_needs().as_millis() as u64)
}

/// A duration as a person would say it, for a sentence about hosting.
fn plainly(d: Duration) -> String {
    let seconds = d.as_secs();
    if seconds < 60 {
        format!("{seconds} seconds")
    } else {
        format!("{} minutes", seconds / 60)
    }
}

/// Up to the next whole minute, for the figure somebody would act on. Rounding
/// the requirement down would name a lifetime that still fails the gate.
fn round_up_to_a_minute(d: Duration) -> Duration {
    Duration::from_secs(d.as_secs().div_ceil(60) * 60)
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

    /// A connection to a server with a relay, which is what every test bar the
    /// one about the gate is about.
    fn wired(protocol: ConnProtocol) -> Wired {
        wired_with_flags(protocol, "COMPFLAGS u sp r")
    }

    /// `compflags` is the server's answer to `LISTCOMPFLAGS`, folded through the
    /// real parser and reducer, because it is what decides whether the lobby is
    /// asked for a credential at all.
    fn wired_with_flags(protocol: ConnProtocol, compflags: &str) -> Wired {
        let registry = Registry::default();
        let (tx, sent) = mpsc::unbounded_channel::<Outbound>();
        let (answers, turn) = watch::channel(TurnAnswer::Unasked);
        let state = Arc::new(Mutex::new(LobbyState::new()));
        reduce_at(&mut lock_or_recover(&state), parse_line(compflags), NOW);
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
                relay: crate::conn::HostedRelay::default(),
                opened: watch::channel(crate::relay_host::OpenAnswer::Unasked).1,
                relay_refused: crate::relay_host::RefusedRelayAddress::default(),
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

    /// Issue #2042. A credential that comfortably outlives a rebuild starting
    /// now is still no good if it dies before the end of the game, because the
    /// rebuild that matters is the one three hours in. Ten minutes is longer
    /// than the agent's whole backoff and shorter than most games.
    #[tokio::test]
    async fn a_credential_that_survives_a_rebuild_now_but_not_a_whole_game_is_asked_for_again() {
        let mut w = wired(ConnProtocol::TasServer);
        minted(&w.state, 600, NOW);

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
        assert!(
            matches!(refused, NoCredential::TooShort { .. }),
            "got: {refused}"
        );
    }

    /// Issue #2042's first done-when. The refusal is the whole feature, so it
    /// has to name what the lobby gave, what hosting needs, and why, rather than
    /// leave somebody who cannot host guessing at any of the three.
    #[tokio::test]
    async fn the_refusal_names_what_was_given_what_is_needed_and_why() {
        let w = wired(ConnProtocol::TasServer);
        let state = w.state.clone();
        let answers = w.answers.clone();
        tokio::spawn(async move {
            let _ = answers.send(TurnAnswer::Granted(minted(&state, 600, NOW)));
        });

        let refused = credentials(&w.registry, "alice@bar:8200", NOW, PATIENCE)
            .await
            .expect_err("ten minutes will not see a game out");
        let said = refused.to_string();
        assert!(said.contains("lasts 10 minutes"), "got: {said}");
        assert!(said.contains("needs 86 minutes"), "got: {said}");
        assert!(said.contains("has to be rebuilt"), "got: {said}");
    }

    /// The boundary the measurement puts the gate at, from both sides, so a
    /// change to [`LONGEST_GAME`] cannot pass unnoticed.
    ///
    /// A lobby minting for the 99th percentile game plus the agent's rebuild
    /// backoff is a lobby coilbox hosts on. One second less is not.
    #[tokio::test]
    async fn the_gate_sits_at_a_game_plus_the_rebuild_that_might_end_it() {
        let needs = hosting_needs().as_secs();
        assert_eq!(needs, 5_115, "5083s of game and 32s of rebuild backoff");

        for (ttl, hosts) in [(needs + 1, true), (needs - 1, false)] {
            let w = wired(ConnProtocol::TasServer);
            let state = w.state.clone();
            let answers = w.answers.clone();
            tokio::spawn(async move {
                let _ = answers.send(TurnAnswer::Granted(minted(&state, ttl, NOW)));
            });

            let got = credentials(&w.registry, "alice@bar:8200", NOW, PATIENCE).await;
            assert_eq!(got.is_ok(), hosts, "for a {ttl} second credential: {got:?}");
        }
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

    /// Issue #2021, and every server today. A server that never advertised a
    /// relay is not asked for a credential: not asked and told no, not asked and
    /// waited out, just not asked.
    #[tokio::test]
    async fn a_server_without_a_relay_is_not_asked_for_a_credential() {
        let mut w = wired_with_flags(ConnProtocol::TasServer, "COMPFLAGS u sp b");

        let refused = credentials(&w.registry, "alice@bar:8200", NOW, PATIENCE)
            .await
            .expect_err("there is no relay to get a credential for");
        assert!(matches!(refused, NoCredential::NoRelay), "got: {refused}");
        assert!(
            w.sent.try_recv().is_err(),
            "nothing may go on the wire to a server with no relay"
        );
    }

    /// A server that advertised a relay and then said nothing. Saying nothing
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
                    // A lobby with a relay, so it names the flag from
                    // ScarylePoo/uberserver#26 alongside the two every server
                    // has. Without it nothing here would ever be asked.
                    ClientCommand::ListCompFlags => line::comp_flags(&["u", "sp", "r"]),
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
        logged_in_watching(registry, addr, Channel::new(|_| Ok(()))).await
    }

    /// The same, with the frontend's end of the event channel handed in, for a
    /// test that cares what the frontend was told.
    async fn logged_in_watching(
        registry: &Registry,
        addr: std::net::SocketAddr,
        events: Channel<crate::conn::LobbyEvent>,
    ) -> String {
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
            events,
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

    /// Issue #2019. The credential must not reach the frontend, because the
    /// protocol console is what somebody copies into a bug report when their
    /// battle will not open, and anybody holding the copy holds the lobby's
    /// bandwidth until the credential runs out.
    ///
    /// Driven over a real socket through the real connection task, and asserted
    /// against every event the frontend was sent rather than against the console
    /// alone. So a second code path that put the raw line somewhere else on the
    /// event stream fails here too, which is the point: the assertion is "the
    /// frontend was never told the secret", not "the redactor was called".
    #[tokio::test]
    async fn a_credential_off_the_wire_never_reaches_the_frontend() {
        // Distinct from anything else in the session, so a hit is this
        // credential and not the login name echoed back by `ACCEPTED`.
        let username = "1786086400:z9wq4k";
        let password = "hVsLm3xQ7f=";

        let addr = lobby_answering(Some(format!(
            "TURNCREDENTIALS turn:relay.example.org:3478 {username} {password} 86400"
        )))
        .await;

        // Every event the frontend would have seen, as the JSON it would have
        // seen it as, so the assertion covers every field of every event kind
        // and not only the ones this test knows the shape of.
        let seen: Arc<Mutex<Vec<String>>> = Arc::default();
        let recorder = seen.clone();
        let events = Channel::new(move |body| {
            let json = match body {
                tauri::ipc::InvokeResponseBody::Json(s) => s,
                tauri::ipc::InvokeResponseBody::Raw(b) => String::from_utf8_lossy(&b).into_owned(),
            };
            lock_or_recover(&recorder).push(json);
            Ok(())
        });

        let registry = Registry::default();
        let key = logged_in_watching(&registry, addr, events).await;
        let turn = credentials(&registry, &key, NOW, PATIENCE)
            .await
            .expect("the lobby minted one");

        // The credential did arrive, so the absence below is redaction rather
        // than a line that never got read.
        assert_eq!(turn.user, username);
        assert_eq!(turn.password, password);

        let sent = lock_or_recover(&seen).join("\n");
        assert!(
            !sent.contains(username) && !sent.contains(password),
            "the frontend was told the credential:\n{sent}"
        );
        // And the line is still there, with the half of it worth showing.
        assert!(
            sent.contains(
                "TURNCREDENTIALS turn:relay.example.org:3478 <redacted> <redacted> 86400"
            ),
            "the console should still show the relay and the lifetime:\n{sent}"
        );
    }

    /// Issue #2042 over a real socket. A lobby minting ten minutes is a lobby
    /// that has read #2016 and sized the lifetime against opening a battle
    /// rather than playing one, which is the mistake ScarylePoo/uberserver#27
    /// exists to stop. Nothing about it looks wrong until a game is three hours
    /// in, so the refusal has to happen here, before the battle is advertised.
    #[tokio::test]
    async fn a_lobby_minting_for_the_battle_rather_than_the_game_is_refused_over_a_socket() {
        let addr = lobby_answering(Some(
            "TURNCREDENTIALS turn:relay.example.org:3478 1786086400:alice bWFj= 600".to_string(),
        ))
        .await;
        let registry = Registry::default();
        let key = logged_in(&registry, addr).await;

        // The lobby's own clock, because the reducer stamped the lifetime with
        // it inside the connection task rather than with this test's `NOW`.
        let refused = credentials(&registry, &key, crate::conn::now_ms(), PATIENCE)
            .await
            .expect_err("ten minutes will not see a game out");
        assert!(
            matches!(refused, NoCredential::TooShort { .. }),
            "got: {refused}"
        );
        assert!(
            refused.to_string().contains("lasts 10 minutes"),
            "got: {refused}"
        );
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
