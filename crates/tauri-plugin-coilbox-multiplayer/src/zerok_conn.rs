//! The Zero-K connection: the socket, the line framing, and the task that owns
//! both.
//!
//! Zero-K's server is at `zero-k.info` on port 8200, which the frontend's server
//! catalog holds like every other address. That is the port number TASServer
//! conventionally uses, which is a good way to talk yourself into thinking it is
//! the same protocol. It is not. The connection is plain TCP with no TLS at all,
//! and each line is a command name, one space, and a JSON object.
//!
//! Three things about it cost time if they are not known up front:
//!
//! - The server speaks first. A `Welcome` arrives unprompted on connect and is
//!   what a client answers, rather than the client opening with a greeting.
//! - There is no application-level keepalive. Zero-K's protocol has no `Ping`
//!   command at all, so sending one is a protocol error and spends the
//!   connection's throttle budget on nothing. The socket is held open with TCP
//!   keepalive instead, set in [`connect`].
//! - There is no TLS, so nothing on this connection is private, the password
//!   hash included.
//!
//! The task follows [`crate::conn`]: one tokio task owns the whole duplex, so a
//! shutdown drops the socket and everything waiting on it at once, with no
//! cross-task handshake to get wrong.

use std::sync::{Arc, Mutex};
use std::time::Duration;

use coilbox_lobby_protocol::{Delta, LobbyState, LoginMode, LoginPhase};
use coilbox_zerok_protocol::types::{LoginResponseCode, RegisterResponseCode};
use coilbox_zerok_protocol::{line, types, ZerokMessage};
use futures_util::{SinkExt, StreamExt};
use tauri::ipc::Channel;
use tokio::net::TcpStream;
use tokio::sync::mpsc;
use tokio::sync::watch;
use tokio_util::codec::{Framed, LinesCodec};
use tokio_util::sync::CancellationToken;

use crate::conn::now_ms;
use crate::conn::{
    emit, ConnProtocol, EventSink, LobbyEvent, Outbound, Registry, ServerConn, StartedBattle,
    TachyonHandle,
};
use crate::dmlog::DmLog;
use crate::tls::ConnectError;
use crate::{lock_or_recover, zerok_battles, zerok_chat, zerok_room, zerok_users};

/// How long the socket may be idle before the kernel starts probing, and how far
/// apart the probes go.
///
/// Zero-K has no application-level keepalive to lean on, so this is the only
/// thing keeping a NAT or a firewall from dropping the mapping under a
/// connection that is simply quiet. Two minutes is under the 5 minute mapping
/// timeout RFC 5382 requires of a NAT for an established TCP connection, so a
/// conforming one is refreshed before it can forget.
const KEEPALIVE_IDLE: Duration = Duration::from_secs(120);
const KEEPALIVE_INTERVAL: Duration = Duration::from_secs(30);

/// Open the socket to a Zero-K server, with TCP keepalive set before anything is
/// read from it.
///
/// No TLS: Zero-K's server offers none on this port, so there is no mode to
/// choose and nothing to upgrade.
pub async fn connect(
    host: &str,
    port: u16,
    timeout: Duration,
    cancel: &CancellationToken,
) -> Result<TcpStream, ConnectError> {
    let opened = tokio::select! {
        biased;
        _ = cancel.cancelled() => return Err(ConnectError::Cancelled),
        opened = tokio::time::timeout(timeout, TcpStream::connect((host, port))) => opened,
    };
    let stream = match opened {
        Ok(Ok(stream)) => stream,
        Ok(Err(e)) => {
            return Err(ConnectError::Failed(format!(
                "connect {host}:{port} failed: {e}"
            )))
        }
        Err(_elapsed) => return Err(ConnectError::TimedOut),
    };

    let keepalive = socket2::TcpKeepalive::new()
        .with_time(KEEPALIVE_IDLE)
        .with_interval(KEEPALIVE_INTERVAL);
    // A socket that will not take keepalive still carries the protocol, so this
    // is reported rather than fatal. What it costs is a quiet connection being
    // dropped by something in the middle with no warning, which is exactly the
    // failure the reconnect loop is there for.
    if let Err(e) = socket2::SockRef::from(&stream).set_tcp_keepalive(&keepalive) {
        eprintln!("zero-k: could not set TCP keepalive on {host}:{port}: {e}");
    }
    Ok(stream)
}

/// What a Zero-K login needs beyond a socket.
///
/// Four of `Login`'s members are for Steam authentication and RSA challenge
/// signing, which the server does not currently require of a password login, so
/// they are not here and go out unset.
pub struct ZerokLogin {
    pub username: String,
    /// `base64(md5(password))`, the same scheme TASServer uses.
    pub password_hash: String,
    /// Free text naming this client and its version, sent as `LobbyVersion` and
    /// shown to other players. Built by the caller from the running app's
    /// version rather than from anything compiled in, because coilbox takes its
    /// release version from the git tag and the source keeps a placeholder.
    pub lobby_version: String,
    /// The per-install identifier, sent as `InstallID`. Zero-K's server uses it
    /// for multi-account and ban-evasion checks. It is not identity, it does not
    /// authenticate anything, and it is not meant to follow a person from one
    /// install to another.
    pub install_id: String,
    /// Whether the greeting is answered with `Login` or with `Register`. Sharing
    /// `LoginMode` with the TASServer path rather than a second enum, because
    /// the two connections make the same choice for the same reason.
    pub mode: LoginMode,
}

/// Spawn the connection task for an already-connected socket, registering its
/// [`ServerConn`] so other commands can reach it.
///
/// Returns once the task is spawned and registered. The task runs until the
/// socket closes or a `Shutdown` ends it.
pub fn spawn_connection(
    registry: Registry,
    server_key: String,
    stream: TcpStream,
    login: ZerokLogin,
    on_event: Channel<LobbyEvent>,
    dm_log: DmLog,
) {
    let (tx, rx) = mpsc::unbounded_channel::<Outbound>();
    let mut initial = LobbyState::new();
    // The same store the other two connections keep their threads in, so a
    // conversation is where it was left whichever server it was on.
    initial.dms = dm_log.load();
    let state = Arc::new(Mutex::new(initial));
    let sink: EventSink = Arc::new(Mutex::new(on_event));
    // The sending half goes to the task and nowhere else, so it is dropped when
    // the connection ends and everything waiting on the phase is woken.
    let (phase_tx, phase) = watch::channel(LoginPhase::AwaitGreeting);

    tokio::spawn(run_loop(
        registry.clone(),
        server_key.clone(),
        stream,
        login,
        sink.clone(),
        phase_tx,
        state.clone(),
        rx,
        dm_log,
    ));

    // Registered after spawning. The task's first act is a network read, so it
    // cannot have removed itself before this insert lands.
    lock_or_recover(&registry).insert(
        server_key,
        ServerConn {
            protocol: ConnProtocol::Zerok,
            tx,
            state,
            sink,
            phase,
            // Zero-K's terms are agreed on its website, so there is no agreement
            // handshake on the connection to park on.
            agreement: Arc::new(Mutex::new(None)),
            // Neither of these belongs to a Zero-K connection. There is no
            // Tachyon client, and a battle carries the host's address itself.
            tachyon: TachyonHandle::default(),
            started: StartedBattle::default(),
        },
    );
}

/// The connection event loop. Interleaves inbound lines with the ones commands
/// queue, over one socket. On exit it reports the reason and evicts itself from
/// the registry.
///
/// No keepalive timer, unlike [`crate::conn::run_loop`]. Zero-K's protocol has
/// no `Ping`, and the socket carries TCP keepalive instead.
#[allow(clippy::too_many_arguments)]
async fn run_loop(
    registry: Registry,
    server_key: String,
    stream: TcpStream,
    login: ZerokLogin,
    sink: EventSink,
    phase_slot: watch::Sender<LoginPhase>,
    state: Arc<Mutex<LobbyState>>,
    mut rx: mpsc::UnboundedReceiver<Outbound>,
    dm_log: DmLog,
) {
    emit(&sink, LobbyEvent::Connected);
    let mut phase = Phase {
        sink: sink.clone(),
        slot: phase_slot,
    };
    phase.set(LoginPhase::AwaitGreeting);

    let mut framed = Framed::new(stream, LinesCodec::new());

    let reason: Option<String> = 'conn: loop {
        let mut outbound: Vec<String> = Vec::new();
        let mut shutdown = false;

        tokio::select! {
            item = framed.next() => match item {
                Some(Ok(raw)) => {
                    emit(&sink, LobbyEvent::Console {
                        direction: "in".into(),
                        line: raw.clone(),
                    });
                    // A line with no space in it is not a line. Upstream throws
                    // on one. It is already in the console above, which is as
                    // much as can usefully be done with it.
                    let Some(message) = line::parse_line(&raw) else {
                        continue;
                    };
                    match &message {
                        // Zero-K's server speaks first. The greeting is the
                        // prompt to log in or to register, rather than the
                        // client opening with one of its own.
                        ZerokMessage::Welcome(_) => {
                            let (built, next) = match &login.mode {
                                LoginMode::Login => (
                                    line::to_line(&login_command(&login)),
                                    LoginPhase::AwaitAccepted,
                                ),
                                LoginMode::Register { email } => (
                                    line::to_line(&register_command(&login, email.as_deref())),
                                    LoginPhase::AwaitRegistration,
                                ),
                            };
                            match built {
                                Ok(line) => {
                                    outbound.push(line);
                                    phase.set(next);
                                }
                                // Nothing in either can fail to serialise, so
                                // this says the types have moved rather than
                                // that the credentials are wrong.
                                Err(e) => break 'conn Some(format!("could not build the login: {e}")),
                            }
                        }
                        ZerokMessage::RegisterResponse(response) => {
                            if response.result_code == RegisterResponseCode::Ok {
                                // Terminal success. Registering does not log
                                // anybody in, so the caller drops this
                                // connection and opens a fresh one to do that.
                                phase.set(LoginPhase::Registered);
                            } else {
                                let reason = register_refusal(response);
                                phase.set(LoginPhase::Denied);
                                emit(&sink, LobbyEvent::Delta {
                                    delta: Delta::RegistrationDenied { reason: reason.clone() },
                                });
                                break 'conn Some(reason);
                            }
                        }
                        ZerokMessage::LoginResponse(response) => {
                            if response.result_code == LoginResponseCode::Ok {
                                // Zero-K answers with the name it knows the
                                // account by, which is not always the one that
                                // was typed.
                                let username = response
                                    .name
                                    .clone()
                                    .unwrap_or_else(|| login.username.clone());
                                lock_or_recover(&state).my_username = Some(username.clone());
                                phase.set(LoginPhase::Ready);
                                emit(&sink, LobbyEvent::Delta {
                                    delta: Delta::LoggedIn { username },
                                });
                            } else {
                                let reason = refusal(response);
                                phase.set(LoginPhase::Denied);
                                // Emitted before the teardown below, so the
                                // login form has the reason ahead of the
                                // disconnect that follows it.
                                emit(&sink, LobbyEvent::Delta {
                                    delta: Delta::LoginDenied { reason: reason.clone() },
                                });
                                break 'conn Some(reason);
                            }
                        }
                        // Zero-K pushes its news at every client on connect and
                        // again whenever the site changes it, so the list is
                        // always the whole thing rather than a patch. The
                        // console is where a server's own greeting already
                        // lands, which is what `Motd` names.
                        ZerokMessage::NewsList(news) => {
                            for item in news.news_items.iter().flatten() {
                                if let Some(line) = news_line(item) {
                                    emit(&sink, LobbyEvent::Delta {
                                        delta: Delta::Motd { line },
                                    });
                                }
                            }
                        }
                        // Chat is its own issue in this milestone. Everything
                        // else is folded below.
                        _ => {}
                    }

                    // The battle list, the player directory, the room and chat,
                    // folded after the login arms so a `LoggedIn` reaches the
                    // frontend before anything that assumes we are.
                    let now = now_ms();
                    let (deltas, replies) = {
                        let mut held = lock_or_recover(&state);
                        let mut deltas = zerok_users::reduce(&mut held, &message);
                        deltas.extend(zerok_battles::reduce(&mut held, &message));
                        let (room, room_replies) = zerok_room::reduce(&mut held, &message);
                        deltas.extend(room);
                        let (chat, chat_replies) = zerok_chat::reduce(&mut held, &message, now);
                        deltas.extend(chat);
                        // Built here, under the same lock the fold ran under, so
                        // the answer to a join is the state that join produced
                        // rather than whatever a later line left behind.
                        let replies: Vec<String> = room_replies
                            .iter()
                            .filter_map(|action| zerok_room::build(&held, action).ok())
                            .chain(
                                chat_replies
                                    .iter()
                                    .filter_map(|action| zerok_chat::build(&held, action).ok()),
                            )
                            .flatten()
                            .collect();
                        (deltas, replies)
                    };
                    for delta in deltas {
                        // A conversation outlives the connection, so a message
                        // in one is written down as it arrives. Only direct
                        // messages: Zero-K replays a channel's backlog as
                        // ordinary lines with nothing to mark them, so a channel
                        // log would grow a fresh copy of it on every connect.
                        if let Delta::PrivateMessage { from } = &delta {
                            let last = lock_or_recover(&state)
                                .dms
                                .get(from)
                                .and_then(|thread| thread.last())
                                .cloned();
                            if let Some(message) = last {
                                dm_log.append(from, &message);
                            }
                        }
                        emit(&sink, LobbyEvent::Delta { delta });
                    }
                    outbound.extend(replies);
                }
                Some(Err(e)) => break 'conn Some(e.to_string()),
                None => break 'conn None,
            },
            Some(out) = rx.recv() => match out {
                Outbound::Line(line) => outbound.push(line),
                Outbound::Shutdown => shutdown = true,
                Outbound::Zerok(action) => {
                    let built = build(&lock_or_recover(&state), &action);
                    match built {
                        Ok(lines) => outbound.extend(lines),
                        // Nothing generated can fail to serialise, so this says
                        // the types have moved rather than that the action was
                        // wrong.
                        Err(e) => emit(&sink, LobbyEvent::Console {
                            direction: "out".into(),
                            line: format!("could not build the command: {e}"),
                        }),
                    }
                }
                // Zero-K has no `EXIT` to write and no agreement to confirm, and
                // a Tachyon action never reaches a connection without a Tachyon
                // client. A private message is queued by a command that refuses
                // this connection before it gets here.
                Outbound::ConfirmAgreement { .. }
                | Outbound::Tachyon(_)
                | Outbound::SayPrivate { .. }
                | Outbound::SayPrivateEx { .. } => {}
            },
        }

        for line in outbound {
            emit(
                &sink,
                LobbyEvent::Console {
                    direction: "out".into(),
                    line: line.clone(),
                },
            );
            if let Err(e) = framed.send(line).await {
                break 'conn Some(e.to_string());
            }
        }

        if shutdown {
            // Zero-K reads a closed socket as the client leaving, so dropping
            // the connection is the whole of a graceful logout.
            break 'conn None;
        }
    };

    emit(&sink, LobbyEvent::Disconnected { reason });
    lock_or_recover(&registry).remove(&server_key);
}

/// Something a command asks of a Zero-K connection.
///
/// Zero-K's own commands are what a client sends here, so unlike
/// [`crate::conn::TachyonAction`] every one of these becomes a wire line and
/// nothing has to wait for an answer. It is an enum rather than a built line so
/// the building stays in this module, beside the types it builds from.
pub enum ZerokAction {
    /// Publish whether we are away or in a game. Zero-K has no status bitfield:
    /// each half is a nullable flag, and one left unset is left alone.
    Status { ingame: bool, away: bool },
    /// Something a battle room control asks of the room we are in.
    Room(zerok_room::RoomAction),
    /// Something a chat surface asks: a line to say, a channel to join or
    /// leave, or a relation to set.
    Chat(zerok_chat::ChatAction),
}

/// The wire lines for an action, in the order they go out.
///
/// Takes the state because Zero-K names the room and the player on messages the
/// other two protocols leave to the connection, so what a room action turns into
/// depends on which room we are in and who we are.
fn build(state: &LobbyState, action: &ZerokAction) -> Result<Vec<String>, serde_json::Error> {
    match action {
        ZerokAction::Status { ingame, away } => {
            Ok(vec![line::to_line(&types::ChangeUserStatus {
                is_afk: Some(*away),
                is_in_game: Some(*ingame),
            })?])
        }
        ZerokAction::Room(action) => zerok_room::build(state, action),
        ZerokAction::Chat(action) => zerok_chat::build(state, action),
    }
}

/// One news item as a line for the console, or `None` when it carries nothing
/// worth showing.
///
/// The header is the headline and the text is the body, which runs to
/// paragraphs. A console line is one line, so the headline and the link to the
/// rest of it are what goes in.
fn news_line(item: &types::NewsItem) -> Option<String> {
    let headline = item
        .header
        .as_deref()
        .or(item.text.as_deref())
        .map(str::trim)
        .filter(|headline| !headline.is_empty())?;
    Some(
        match item.url.as_deref().map(str::trim).filter(|u| !u.is_empty()) {
            Some(url) => format!("{headline} ({url})"),
            None => headline.to_owned(),
        },
    )
}

/// The login phase, written to both places that have to hear about it: the watch
/// anything waiting on the connection reads, and the frontend.
struct Phase {
    sink: EventSink,
    slot: watch::Sender<LoginPhase>,
}

impl Phase {
    fn set(&mut self, phase: LoginPhase) {
        let _ = self.slot.send(phase);
        emit(
            &self.sink,
            LobbyEvent::Phase {
                phase,
                // Zero-K's terms are agreed on its website, so a connection never
                // parks on an agreement.
                agreement: None,
            },
        );
    }
}

/// Build the `Login` for a set of credentials.
///
/// `ClientType` is 1, which upstream names `ZeroKLobby`. There is no value for a
/// third-party client, and a client type the server does not know is worse than
/// one that is not strictly true, so coilbox sends 1 like every other client
/// does. `UserID` is always 0. The four Steam and RSA members go out unset,
/// because the server does not currently ask a password login for any of them
/// and `NullValueHandling.Ignore` leaves an unset member out of the JSON.
fn login_command(login: &ZerokLogin) -> types::Login {
    types::Login {
        name: Some(login.username.clone()),
        password_hash: Some(login.password_hash.clone()),
        client_type: types::ClientTypes::ZeroKLobby,
        lobby_version: Some(login.lobby_version.clone()),
        install_id: Some(login.install_id.clone()),
        user_id: 0,
        ..types::Login::default()
    }
}

/// Build the `Register` for a set of credentials.
///
/// The email is stored against the account and never verified, so unlike every
/// TASServer this talks to, Zero-K issues no code and the login that follows
/// registering is an ordinary one. It goes out only when there is one to send.
fn register_command(login: &ZerokLogin, email: Option<&str>) -> types::Register {
    types::Register {
        name: Some(login.username.clone()),
        password_hash: Some(login.password_hash.clone()),
        email: email
            .map(str::trim)
            .filter(|email| !email.is_empty())
            .map(str::to_string),
        install_id: Some(login.install_id.clone()),
        user_id: 0,
        ..types::Register::default()
    }
}

/// What to show somebody whose login was refused.
///
/// The wording comes from upstream's own `[Description]` on the code, generated
/// rather than transcribed, so a reworded reason arrives with the next refresh.
/// A ban carries its own text as well, which is the part that says why.
fn refusal(response: &types::LoginResponse) -> String {
    let code = response.result_code;
    let reason = code.description().map_or_else(
        || format!("the server refused the login (code {})", i32::from(code)),
        str::to_string,
    );
    with_ban(reason, response.ban_reason.as_deref())
}

/// The same, for a registration the server would not take.
///
/// A separate function rather than one over both, because the two result codes
/// are separate C# enums with overlapping numbers that mean different things.
/// Code 2 is `InvalidName` on a login and `NameAlreadyTaken` on a registration.
fn register_refusal(response: &types::RegisterResponse) -> String {
    let code = response.result_code;
    let reason = code.description().map_or_else(
        || {
            format!(
                "the server refused the registration (code {})",
                i32::from(code)
            )
        },
        str::to_string,
    );
    with_ban(reason, response.ban_reason.as_deref())
}

/// Add the server's own words for a ban, when it gave any. The code says that
/// somebody is banned, and this is the part that says why.
fn with_ban(reason: String, ban: Option<&str>) -> String {
    match ban.map(str::trim).filter(|ban| !ban.is_empty()) {
        Some(ban) => format!("{reason}: {ban}"),
        None => reason,
    }
}

#[cfg(test)]
mod tests;
