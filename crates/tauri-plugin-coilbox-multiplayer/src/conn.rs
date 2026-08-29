//! The live connection task: framing, the login handshake, PING/PONG keepalive,
//! and streaming state deltas to the frontend.
//!
//! One `tokio` task owns the whole duplex: it reads server lines, drives the
//! `LoginMachine`, feeds each parsed message through the pure `reduce`r, and writes
//! outbound lines. Keeping IO in a single task means a graceful `Shutdown` (on
//! disconnect) writes `EXIT`, then drops the socket and every timer at once, with no
//! cross-task shutdown handshake to get wrong.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use coilbox_lobby_protocol::{
    command, parse_line, record_outgoing_private, redact_line, reduce_at, ChatKind, Delta,
    LobbyState, LoginConfig, LoginMachine, LoginPhase, ServerMessage,
};
use futures_util::{SinkExt, StreamExt};
use serde::Serialize;
use tauri::ipc::Channel;
use tokio::sync::mpsc::{self, UnboundedSender};
use tokio::sync::watch;
use tokio_util::codec::{Framed, LinesCodec};

use crate::dmlog::DmLog;
use crate::lock_or_recover;
use crate::relay_host::{OpenAnswer, OpenSlot};
use crate::tachyon_rpc::TachyonClient;
use crate::tls::AsyncReadWrite;
use crate::turn::{TurnAnswer, TurnSlot};

/// Unix-millis now, saturating to 0 on the (impossible) pre-epoch case.
pub(crate) fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// How often we send an unsolicited `PING`. The server drops idle clients, so this
/// is a keepalive, not latency measurement; a coarse interval is plenty.
const PING_INTERVAL: Duration = Duration::from_secs(30);

/// A queued outbound action for the connection task. `Line` is a raw wire line;
/// `SayPrivate` is recorded into DM state + persisted + emitted as a delta by the
/// task before the wire line is sent, keeping the task the single state writer;
/// `Shutdown` requests a graceful logout (write `EXIT`, flush, then exit);
/// `ConfirmAgreement` resumes a login parked awaiting the emailed verification
/// code by driving the login machine (`CONFIRMAGREEMENT` + re-`LOGIN`).
/// `Tachyon` is an action with no wire line at all, carried out by the Tachyon
/// task in [`crate::tachyon_conn`]. `Zerok` is an action turned into one of
/// Zero-K's own commands by [`crate::zerok_conn`], which owns the types it is
/// built from.
pub enum Outbound {
    Line(String),
    SayPrivate { peer: String, text: String },
    SayPrivateEx { peer: String, text: String },
    ConfirmAgreement { code: Option<String> },
    Tachyon(TachyonAction),
    Zerok(crate::zerok_conn::ZerokAction),
    Shutdown,
}

/// An action only a Tachyon connection can carry out, because it is a request
/// rather than a line and its answer has to reach the task that owns the state.
pub enum TachyonAction {
    /// Join the lobby the battle handle names. The task turns the handle back
    /// into the lobby's uuid, which is what `lobby/join` names.
    JoinLobby { battle: u32 },
    /// Leave the lobby we are in.
    LeaveLobby,
    /// Make a lobby of our own. The answer carries the whole lobby, so the task
    /// folds it exactly as it folds a join and we end up in the room we asked
    /// for. It is not hosting: nothing runs here until the server allocates an
    /// autohost and sends everyone its address.
    CreateLobby(crate::tachyon_room::NewLobby),
    /// Something a battle room control asks of the lobby we are in. The task
    /// turns it into requests against the lobby it holds, because that is the
    /// only thing that can name an ally team, a bot or a member the way Tachyon
    /// does.
    Room(crate::tachyon_room::RoomAction),
    /// Something the Friends section asks of the server. The task turns the
    /// username it names into the user id every friend command uses, and applies
    /// what the request did once the server has taken it.
    Friend(crate::tachyon_friends::FriendAction),
    /// Something the Party section asks of the server. The task turns the name
    /// it shows a person under into the user id every party command uses, and
    /// applies what the request did once the server has taken it.
    Party(crate::tachyon_parties::PartyAction),
    /// Something the matchmaking screen asks of the server. The task turns the
    /// queue id it names into the id and opaque version a search request needs,
    /// and applies what the request did once the server has taken it.
    Matchmaking(crate::tachyon_matchmaking::MatchmakingAction),
    /// One chat message, to a person or to the lobby. The task records it once
    /// the server has taken it, so a message the server refused is never shown
    /// as sent.
    Say {
        conversation: crate::tachyon_messaging::Conversation,
        text: String,
    },
}

/// The frontend event channel, wrapped so a webview reload can swap in a fresh
/// `Channel` (via `mp_reattach`) without disturbing the running connection task.
pub type EventSink = Arc<Mutex<Channel<LobbyEvent>>>;

/// The login phase of a connection, as the connection task keeps it.
///
/// A watch rather than a lock, because the phase is not only read: a caller about
/// to send something a logged-out client cannot send has to be able to wait for
/// it (see [`wait_until_ready`]). The sending half lives in the connection task,
/// so a channel that has closed is that task having ended, which is the other
/// answer a waiter needs.
pub type PhaseSlot = watch::Receiver<LoginPhase>;

/// How long [`wait_until_ready`] waits before calling a login failed.
///
/// Generous, because a real server behind a slow link is not a failure, and
/// bounded because there is no read timeout anywhere below this: a server that
/// simply never sends `LOGININFOEND` would otherwise be waited on forever.
pub const READY_TIMEOUT: Duration = Duration::from_secs(20);

/// Wait until the connection under `server_key` has finished logging in.
///
/// `mp_connect` answers as soon as the socket is up and the connection task is
/// spawned, which is not the same as being logged in. Anything sent in between is
/// sent by a client the server does not yet know, and a room refuses it (issue
/// #1590). So a caller that opens a battle the moment it connects waits here
/// first, rather than relying on a handshake over loopback being quicker than the
/// round trips that follow it.
pub async fn wait_until_ready(
    registry: &Registry,
    server_key: &str,
    timeout: Duration,
) -> Result<(), String> {
    let mut phase = match lock_or_recover(registry).get(server_key) {
        Some(conn) => conn.phase.clone(),
        None => return Err(format!("not connected: {server_key}")),
    };
    // Mapped to unit here rather than matched on, because what `wait_for` answers
    // with borrows the receiver the failure arm below reads.
    let waited = tokio::time::timeout(timeout, phase.wait_for(|p| *p == LoginPhase::Ready))
        .await
        .map(|reached| reached.map(|_| ()));
    match waited {
        Ok(Ok(())) => Ok(()),
        // The sending half is the connection task's, so a closed channel means
        // that task has ended: a refused login, a dropped socket, or a logout.
        Ok(Err(_)) => Err(if *phase.borrow() == LoginPhase::Denied {
            "the server refused the login".to_string()
        } else {
            "the connection ended before the login finished".to_string()
        }),
        Err(_) => Err(format!(
            "the login did not finish within {}s",
            timeout.as_secs()
        )),
    }
}

/// A slot for the Tachyon request client, shared because the connection task fills
/// it after registering and a command reads it later. Empty on a line-protocol
/// connection, and on a Tachyon one for the moment between registering and the
/// correlator starting.
pub type TachyonHandle = Arc<Mutex<Option<TachyonClient>>>;

/// A slot for the `BattleConfig` of the match a Tachyon server has told us to
/// play, shared because the connection task fills it from a `battle/start`
/// request and the command that builds a launch config reads it.
///
/// It outlives the request, so an engine that exited mid-match can be launched
/// again from the room, and it is emptied when the lobby it belongs to goes.
/// Always empty on a line-protocol connection, where the battle carries the
/// host's address itself.
pub type StartedBattle = Arc<Mutex<Option<serde_json::Value>>>;

/// A slot for the relay a battle on this connection is being hosted through,
/// filled by `mp_open_battle` once the allocation is open and read by whatever
/// needs to know that this host is relayed.
///
/// Empty on every connection that is not hosting a relayed battle, which today
/// is all of them, and emptied again at the start of each attempt so a host that
/// failed leaves nothing behind for the next reader to believe.
///
/// It is here rather than in [`coilbox_lobby_protocol::LobbyState`] because it
/// is not something the lobby said. The engine's own port and the control
/// channel are facts about this machine, and the state is a mirror of the
/// server.
pub type HostedRelay = Arc<Mutex<Option<crate::relay_host::RelayHost>>>;

/// Send one event to the current frontend channel, ignoring a detached/dead one.
pub(crate) fn emit(sink: &EventSink, ev: LobbyEvent) {
    let _ = lock_or_recover(sink).send(ev);
}

/// Put one wire line in the frontend's protocol console.
///
/// The only way a TASServer line is allowed to reach the frontend, because it is
/// the only place [`redact_line`] is applied to one. The console is what people
/// copy into a bug report, so a relay credential shown here is a relay
/// credential pasted into a public issue (issue #2019).
fn console(sink: &EventSink, direction: &str, line: &str) {
    emit(
        sink,
        LobbyEvent::Console {
            direction: direction.to_string(),
            line: redact_line(line).into_owned(),
        },
    );
}

/// The protocol a live connection speaks.
///
/// Coilbox talks to three kinds of server and only one of them reads a TASServer
/// line, so a command that builds one has to be able to tell them apart. An
/// empty [`TachyonHandle`] answered that on its own back when the two
/// possibilities were Tachyon and not-Tachyon. Zero-K is a second line protocol
/// and leaves the same slot empty, so which one it is gets recorded rather than
/// inferred.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ConnProtocol {
    /// TASServer, or one of the servers speaking it, including a room we host.
    TasServer,
    /// Teiserver's Tachyon, over a WebSocket.
    Tachyon,
    /// Zero-K, over its own line protocol.
    Zerok,
}

/// One live connection, held in the plugin registry so commands can push lines and
/// disconnect. `state` is the shared authoritative mirror the read task mutates and
/// `mp_snapshot` clones; `sink` is the swappable event channel and `phase` the last
/// login phase, both so a reload can re-adopt the connection via `mp_reattach`.
pub struct ServerConn {
    /// What this connection speaks, so a command can refuse rather than send
    /// syntax the server cannot read.
    pub protocol: ConnProtocol,
    pub tx: UnboundedSender<Outbound>,
    pub state: Arc<Mutex<LobbyState>>,
    pub sink: EventSink,
    /// The login phase, watched rather than locked so it can be waited on. See
    /// [`PhaseSlot`].
    pub phase: PhaseSlot,
    /// The Tachyon request client, on a connection that has one. Set by
    /// [`crate::tachyon_conn`] once the correlator is running, and left empty on a
    /// line-protocol connection, which is what tells the two apart from a command.
    pub tachyon: TachyonHandle,
    /// Where the match this connection is playing wants the engine pointed, as a
    /// `play` `BattleConfig`. Only ever filled on a Tachyon connection.
    pub started: StartedBattle,
    /// The agreement text sent by the server while parked on `AwaitAgreement`, so
    /// `mp_reattach` can replay it alongside the phase after a webview reload.
    pub agreement: Arc<Mutex<Option<String>>>,
    /// The lobby's last answer about a relay credential, watched rather than
    /// locked for the same reason [`PhaseSlot`] is: somebody about to host a
    /// relayed battle has to be able to wait for the next one. Stays at
    /// [`TurnAnswer::Unasked`] on a connection to a server without the command,
    /// which today is all of them.
    pub turn: TurnSlot,
    /// The relay this connection's battle is being hosted through, if it is
    /// being hosted through one. See [`HostedRelay`].
    pub relay: HostedRelay,
    /// The lobby's last answer about a battle we asked it to open, watched for
    /// the same reason [`TurnSlot`] is: queueing `OPENBATTLE` is not opening a
    /// battle, and a relayed host has an allocation riding on which of the two
    /// happened. Stays at [`crate::relay_host::OpenAnswer::Unasked`] on a
    /// connection nobody hosts on.
    pub opened: OpenSlot,
}

/// The registry of live connections, keyed by a frontend-supplied `serverKey`
/// (e.g. `"user@host:port"`).
pub type Registry = Arc<Mutex<HashMap<String, ServerConn>>>;

/// An event streamed to the frontend over the connect `Channel`. `Console` carries
/// raw wire lines (both directions) for a debug view; the frontend refreshes its
/// state mirror from `Delta`/`Phase` and pulls a full snapshot when it needs one.
#[derive(Clone, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum LobbyEvent {
    Connected,
    Phase {
        phase: LoginPhase,
        /// The server's agreement text when `phase` is `AwaitAgreement`, else null,
        /// so the confirmation dialog can show what the user is accepting.
        agreement: Option<String>,
    },
    Delta {
        delta: Delta,
    },
    Console {
        direction: String,
        line: String,
    },
    /// A Tachyon server has told us where the match is and we have said we will
    /// be there, so the room launches the engine. The config itself is fetched
    /// with `mp_build_battle_config` rather than carried here, so a room that
    /// launches again after our engine exits reads the same one.
    BattleStarting,
    Disconnected {
        reason: Option<String>,
    },
}

/// Spawn the connection task for an already-connected (and, if requested, already
/// TLS-upgraded) `stream`, registering its [`ServerConn`] so other commands can act
/// on it. Returns once the task is spawned and registered; the task itself runs
/// until the socket closes or a `Shutdown` from `mp_disconnect` ends it.
pub fn spawn_connection(
    registry: Registry,
    server_key: String,
    stream: Box<dyn AsyncReadWrite>,
    login_cfg: LoginConfig,
    on_event: Channel<LobbyEvent>,
    dm_log: DmLog,
    chan_log: DmLog,
) {
    let (tx, rx) = mpsc::unbounded_channel::<Outbound>();
    let mut initial = LobbyState::new();
    initial.dms = dm_log.load();
    let state = Arc::new(Mutex::new(initial));
    let sink: EventSink = Arc::new(Mutex::new(on_event));
    // The sending half goes to the task and nowhere else, so it is dropped when
    // the connection ends and everything waiting on the phase is woken.
    let (phase_tx, phase) = watch::channel(LoginPhase::AwaitGreeting);
    let agreement = Arc::new(Mutex::new(None));
    // Same arrangement as the phase: the task holds the only sender, so a
    // connection that ends wakes anybody waiting on a relay credential rather
    // than leaving them to wait out their own deadline.
    let (turn_tx, turn) = watch::channel(TurnAnswer::Unasked);
    // And the same again for the battle we asked the lobby to open, which is
    // the other thing somebody hosting through the relay is waiting on. A
    // connection that ends while they wait is a battle that did not open, and
    // they have an allocation to take down over it.
    let (opened_tx, opened) = watch::channel(OpenAnswer::Unasked);

    tokio::spawn(run_loop(
        registry.clone(),
        server_key.clone(),
        stream,
        login_cfg,
        sink.clone(),
        phase_tx,
        agreement.clone(),
        turn_tx,
        opened_tx,
        rx,
        state.clone(),
        dm_log,
        chan_log,
    ));

    // Register after spawning. The task's first action is a network read (the
    // greeting), so it will not have removed itself before this insert completes
    // for any real connection.
    lock_or_recover(&registry).insert(
        server_key,
        ServerConn {
            protocol: ConnProtocol::TasServer,
            tx,
            state,
            sink,
            phase,
            agreement,
            // The line protocol has no Tachyon client, and that empty slot is what
            // a Tachyon-only command reads to refuse this connection.
            tachyon: TachyonHandle::default(),
            // Nothing tells a line-protocol client where to connect out of band:
            // the battle it joined carries the host's address.
            started: StartedBattle::default(),
            turn,
            // Filled only by a host that takes the relay route, which is
            // decided when they press Host and not when they connect.
            relay: HostedRelay::default(),
            opened,
        },
    );
}

/// The connection event loop. Interleaves inbound lines, queued outbound lines
/// (from commands), and the keepalive timer over one socket; on exit it reports the
/// reason and evicts itself from the registry.
#[allow(clippy::too_many_arguments)]
async fn run_loop(
    registry: Registry,
    server_key: String,
    stream: Box<dyn AsyncReadWrite>,
    login_cfg: LoginConfig,
    sink: EventSink,
    phase_slot: watch::Sender<LoginPhase>,
    agreement_slot: Arc<Mutex<Option<String>>>,
    turn_slot: watch::Sender<TurnAnswer>,
    opened_slot: watch::Sender<OpenAnswer>,
    mut rx: mpsc::UnboundedReceiver<Outbound>,
    state: Arc<Mutex<LobbyState>>,
    dm_log: DmLog,
    chan_log: DmLog,
) {
    emit(&sink, LobbyEvent::Connected);

    let mut framed = Framed::new(stream, LinesCodec::new());
    let mut login = LoginMachine::new(login_cfg);
    let mut ping = tokio::time::interval(PING_INTERVAL);
    // The first tick fires immediately; skip it so we don't PING before the
    // greeting/login has even started.
    ping.tick().await;

    let reason: Option<String> = 'conn: loop {
        // Each iteration collects the lines to write, then flushes them at the end,
        // so the single owned sink is only ever borrowed in one place.
        let mut outbound: Vec<String> = Vec::new();
        let mut shutdown = false;

        tokio::select! {
            item = framed.next() => match item {
                Some(Ok(line)) => {
                    console(&sink, "in", &line);
                    let msg = parse_line(&line);

                    let before = login.phase();
                    outbound.extend(login.on_message(&msg));
                    if login.phase() != before {
                        let agreement = (login.phase() == LoginPhase::AwaitAgreement)
                            .then(|| login.agreement_text());
                        let _ = phase_slot.send(login.phase());
                        *lock_or_recover(&agreement_slot) = agreement.clone();
                        emit(
                            &sink,
                            LobbyEvent::Phase {
                                phase: login.phase(),
                                agreement,
                            },
                        );
                    }

                    // A rejected login (e.g. wrong password) leaves the socket open
                    // but useless — we tear it down (below) so the frontend returns to
                    // the connect screen and the registry slot frees for a retry.
                    // Capture the server's reason before `msg` is moved into `reduce`,
                    // but defer the teardown until AFTER the reducer runs so its
                    // LoginDenied/RegistrationDenied delta reaches the login/
                    // registration form ahead of the Disconnected event — otherwise
                    // breaking here would skip `reduce` and the delta would never emit.
                    let denied_reason = (login.phase() == LoginPhase::Denied).then(|| match &msg {
                        ServerMessage::Denied { reason } => reason.clone(),
                        ServerMessage::RegistrationDenied { reason } => reason.clone(),
                        _ => "login denied".to_string(),
                    });

                    // The server's PING must be answered promptly or it drops us.
                    if let ServerMessage::Ping { token } = &msg {
                        outbound.push(command::pong(token.as_deref()));
                    }

                    // On joining/opening a battle the server prompts us for our
                    // battle status; reply with our current (or default) status so we
                    // register as a participant. The frontend refines it afterwards.
                    if matches!(&msg, ServerMessage::RequestBattleStatus) {
                        let (bs, color) = lock_or_recover(&state).my_battle_status_or_default();
                        outbound.push(command::my_battle_status(bs, color));
                    }

                    // As a host, the server relays every client's join through us as
                    // JOINBATTLEREQUEST (carrying their IP for NAT hole punching); auto-
                    // accept so joins complete. Only hosts receive this, so it's safe to
                    // answer unconditionally.
                    if let ServerMessage::JoinBattleRequest { username, .. } = &msg {
                        outbound.push(command::join_battle_accept(username));
                    }

                    // We just joined a channel and it starts empty: ask for its stored
                    // backlog so the conversation has some history behind it. Safe to
                    // ask unconditionally — a channel that stores no history (the
                    // default) replies with nothing rather than an error — except for
                    // battle channels, which are never registered and so never have any.
                    //
                    // Cursor 0 asks for the channel's whole retained window. How much
                    // that is, is the server's call: some cap the read, some don't.
                    if let ServerMessage::Join { channel } = &msg {
                        if !channel.starts_with("__battle__") {
                            outbound.push(command::get_channel_messages(channel, 0));
                        }
                    }

                    let now = now_ms();
                    let deltas = reduce_at(&mut lock_or_recover(&state), msg, now);
                    for delta in deltas {
                        if let Delta::PrivateMessage { from } = &delta {
                            let last = lock_or_recover(&state)
                                .dms
                                .get(from)
                                .and_then(|t| t.last())
                                .cloned();
                            if let Some(m) = last {
                                dm_log.append(from, &m);
                            }
                        }
                        // Named-channel chat: log to the channel store (the server
                        // echoes our own SAID too, so this covers both directions).
                        // A `None` channel is transient battle chat — not logged.
                        if let Delta::ChatMessage {
                            channel: Some(ch),
                            index,
                        } = &delta
                        {
                            let m = lock_or_recover(&state)
                                .channels
                                .get(ch)
                                .and_then(|c| c.messages.get(*index))
                                .cloned();
                            // An id means the server replayed this from its own history,
                            // so it is already in the log from when it was live. Writing
                            // it again would grow a fresh duplicate copy of the backlog
                            // on every connect.
                            if let Some(m) = m.filter(|m| m.id.is_none()) {
                                chan_log.append(ch, &m);
                            }
                        }
                        // Somebody may be waiting on this line to open a relayed
                        // battle, so wake them with what it said.
                        if let Some(answer) = crate::turn::answer_in(&delta, &state) {
                            let _ = turn_slot.send(answer);
                        }
                        // And somebody may be waiting on it to find out whether
                        // the battle they advertised exists. On the relay route
                        // that is the difference between a sidecar carrying a
                        // battle and one holding an allocation for nothing.
                        if let Some(answer) = crate::relay_host::open_answer_in(&delta, &state) {
                            let _ = opened_slot.send(answer);
                        }
                        emit(&sink, LobbyEvent::Delta { delta });
                    }

                    // Now that the denial delta has been emitted, tear the
                    // connection down (the socket is open but useless).
                    if let Some(reason) = denied_reason {
                        break 'conn Some(reason);
                    }
                }
                Some(Err(e)) => break 'conn Some(e.to_string()),
                None => break 'conn None,
            },
            Some(out) = rx.recv() => match out {
                Outbound::Line(line) => outbound.push(line),
                Outbound::ConfirmAgreement { code } => {
                    let before = login.phase();
                    outbound.extend(login.submit_agreement_code(code.as_deref()));
                    if login.phase() != before {
                        let agreement = (login.phase() == LoginPhase::AwaitAgreement)
                            .then(|| login.agreement_text());
                        let _ = phase_slot.send(login.phase());
                        *lock_or_recover(&agreement_slot) = agreement.clone();
                        emit(
                            &sink,
                            LobbyEvent::Phase {
                                phase: login.phase(),
                                agreement,
                            },
                        );
                    }
                }
                // Only queued for a connection whose protocol it belongs to, so
                // a TASServer one never sees either.
                Outbound::Tachyon(_) | Outbound::Zerok(_) => {}
                Outbound::Shutdown => {
                    outbound.push(command::exit(None));
                    shutdown = true;
                }
                Outbound::SayPrivate { peer, text } => {
                    let now = now_ms();
                    let deltas = record_outgoing_private(
                        &mut lock_or_recover(&state),
                        &peer,
                        &text,
                        ChatKind::Private,
                        now,
                    );
                    let last = lock_or_recover(&state)
                        .dms
                        .get(&peer)
                        .and_then(|t| t.last())
                        .cloned();
                    if let Some(m) = last {
                        dm_log.append(&peer, &m);
                    }
                    for delta in deltas {
                        emit(&sink, LobbyEvent::Delta { delta });
                    }
                    outbound.push(command::say_private(&peer, &text));
                }
                Outbound::SayPrivateEx { peer, text } => {
                    // A private `/me` action. Mirrors SayPrivate but records the local
                    // copy as an emote and sends the SAYPRIVATEEX verb.
                    let now = now_ms();
                    let deltas = record_outgoing_private(
                        &mut lock_or_recover(&state),
                        &peer,
                        &text,
                        ChatKind::SaidEx,
                        now,
                    );
                    let last = lock_or_recover(&state)
                        .dms
                        .get(&peer)
                        .and_then(|t| t.last())
                        .cloned();
                    if let Some(m) = last {
                        dm_log.append(&peer, &m);
                    }
                    for delta in deltas {
                        emit(&sink, LobbyEvent::Delta { delta });
                    }
                    outbound.push(command::say_private_ex(&peer, &text));
                }
            },
            _ = ping.tick() => outbound.push(command::ping(None)),
        }

        for line in outbound {
            console(&sink, "out", &line);
            // A write failure means the socket is gone; report it and stop.
            if let Err(e) = framed.send(line).await {
                break 'conn Some(e.to_string());
            }
        }

        // A `Shutdown` request wrote its `EXIT` above; now exit cleanly.
        if shutdown {
            break 'conn None;
        }
    };

    emit(&sink, LobbyEvent::Disconnected { reason });
    lock_or_recover(&registry).remove(&server_key);
}

#[cfg(test)]
mod tests {
    use super::*;
    use coilbox_lobby_protocol::server::{line, parse_client_line, ClientCommand};
    use coilbox_lobby_protocol::{password_hash, LoginMode};

    /// How long a test waits for the handshake to finish.
    const PATIENCE: Duration = Duration::from_secs(5);

    /// A lobby that greets, answers `LISTCOMPFLAGS`, and finishes whichever
    /// of `LOGIN` or `REGISTER` the client sends: `ACCEPTED` then
    /// `LOGININFOEND` for a login, `REGISTRATIONACCEPTED` for a
    /// registration. Driving the handshake this way, rather than pushing a
    /// hand-built `Outbound::Line` at the task, is what makes the test below
    /// prove something about the `LOGIN`/`REGISTER` lines `LoginMachine`
    /// itself builds, and not about a line the test invented.
    async fn lobby_finishing_login_or_registration() -> std::net::SocketAddr {
        lobby_advertising(&["u", "sp"], Arc::default()).await
    }

    /// The same lobby, saying what it likes about its own compatibility flags
    /// and keeping the flags the client's `LOGIN` came back with. Which is the
    /// pair issue #2021 turns on: what the server offered, and what we claimed.
    async fn lobby_advertising(
        compflags: &[&str],
        login_flags: Arc<Mutex<Vec<String>>>,
    ) -> std::net::SocketAddr {
        let compflags = line::comp_flags(compflags);
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .expect("a free port");
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
                    ClientCommand::ListCompFlags => compflags.clone(),
                    ClientCommand::Login {
                        username, flags, ..
                    } => {
                        *lock_or_recover(&login_flags) = flags;
                        if framed.send(line::accepted(&username)).await.is_err() {
                            return;
                        }
                        line::login_info_end()
                    }
                    ClientCommand::Register { .. } => "REGISTRATIONACCEPTED".to_string(),
                    _ => continue,
                };
                if framed.send(reply).await.is_err() {
                    return;
                }
            }
        });
        addr
    }

    /// Connect, drive `mode`'s handshake through the real connection task
    /// over a real socket, and hand back every console event the frontend
    /// would have seen, as the JSON it would have seen it as. Waits for the
    /// handshake's own terminal phase, so by the time it returns, every line
    /// the handshake sent (including the `LOGIN`/`REGISTER` line itself) has
    /// already been through `console` and recorded.
    async fn console_lines_seen_during(mode: LoginMode) -> Vec<String> {
        let addr = lobby_finishing_login_or_registration().await;

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
        handshake(addr, mode, events).await;

        let recorded = lock_or_recover(&seen).clone();
        recorded
    }

    /// Run `mode`'s handshake against `addr` through the real connection task,
    /// over a real socket, returning once it has reached its terminal phase. By
    /// then every line the handshake sent, the `LOGIN` included, has been
    /// written and has been through `console`.
    async fn handshake(addr: std::net::SocketAddr, mode: LoginMode, events: Channel<LobbyEvent>) {
        let stream = tokio::net::TcpStream::connect(addr)
            .await
            .expect("the lobby is listening");
        let registry: Registry = Registry::default();
        let key = format!("alice@{addr}");

        let terminal = match mode {
            LoginMode::Login => LoginPhase::Ready,
            LoginMode::Register { .. } => LoginPhase::Registered,
        };

        let logs = std::env::temp_dir().join("coilbox-login-redaction-tests");
        spawn_connection(
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
                mode,
            },
            events,
            crate::dmlog::DmLog::new(&logs, &key),
            crate::dmlog::DmLog::new(&logs, &key),
        );

        let mut phase = lock_or_recover(&registry)
            .get(&key)
            .expect("spawn_connection registered it")
            .phase
            .clone();
        tokio::time::timeout(PATIENCE, phase.wait_for(|p| *p == terminal))
            .await
            .expect("the handshake did not finish in time")
            .expect("the connection task is still running");
    }

    /// The acceptance test for issue #2021, on the wire, where it matters. A
    /// server that never offered the relay flag must not be sent it: uberserver
    /// answers a flag it does not know with `MOTD Your client has compatibility
    /// errors`, shown to the person logging in, so getting this wrong is a
    /// warning for every coilbox user on every server that has no relay.
    #[tokio::test]
    async fn the_relay_flag_is_on_the_login_only_when_the_lobby_offered_it() {
        for (advertised, claimed) in [
            (vec!["u", "sp", "r"], vec!["u", "r"]),
            // Every server today.
            (vec!["u", "sp"], vec!["u"]),
        ] {
            let sent: Arc<Mutex<Vec<String>>> = Arc::default();
            let addr = lobby_advertising(&advertised, sent.clone()).await;
            handshake(addr, LoginMode::Login, Channel::new(|_| Ok(()))).await;
            assert_eq!(
                *lock_or_recover(&sent),
                claimed,
                "the lobby advertised {advertised:?}"
            );
        }
    }

    /// The acceptance test for issue #2044. A real login, driven through the
    /// real connection task over a real socket, must not leave a usable
    /// password hash anywhere in what the frontend was sent, because a
    /// TASServer takes that hash as the login itself: holding it is holding
    /// the account.
    #[tokio::test]
    async fn a_login_never_reaches_the_frontend_with_its_password_hash() {
        let hash = password_hash("hunter2");
        let seen = console_lines_seen_during(LoginMode::Login).await.join("\n");

        assert!(
            !seen.contains(&hash),
            "the frontend was told the login hash:\n{seen}"
        );
        // The absence above is redaction, not a line that never arrived: the
        // username and the rest of the LOGIN line are still there.
        assert!(
            seen.contains("LOGIN alice <redacted> 0 127.0.0.1 Coilbox test"),
            "the console should still show the rest of the LOGIN line:\n{seen}"
        );
    }

    /// The same, for `REGISTER`, which sends the same hash `LOGIN` does.
    #[tokio::test]
    async fn a_registration_never_reaches_the_frontend_with_its_password_hash() {
        let hash = password_hash("hunter2");
        let seen = console_lines_seen_during(LoginMode::Register { email: None })
            .await
            .join("\n");

        assert!(
            !seen.contains(&hash),
            "the frontend was told the registration hash:\n{seen}"
        );
        assert!(
            seen.contains("REGISTER alice <redacted>"),
            "the console should still show the username:\n{seen}"
        );
    }

    /// The acceptance test for issue #2046. A real `JOINBATTLE` and a real
    /// `OPENBATTLE`, built by `command::join_battle` and
    /// `command::open_battle` and driven through the real connection task
    /// over the same TCP fixture the login tests above use, must not leave
    /// the room key or the script password anywhere in what the frontend
    /// was sent. Neither secret is the account itself the way the login
    /// hash is, but both let somebody into a room they were not invited to.
    #[tokio::test]
    async fn joining_and_opening_a_battle_never_reach_the_frontend_with_their_secrets() {
        let addr = lobby_finishing_login_or_registration().await;
        let stream = tokio::net::TcpStream::connect(addr)
            .await
            .expect("the lobby is listening");
        let registry: Registry = Registry::default();
        let key = format!("alice@{addr}");

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

        let logs = std::env::temp_dir().join("coilbox-battle-redaction-tests");
        spawn_connection(
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

        // Wait for the login this fixture drives to finish, the same way
        // `console_lines_seen_during` does, then read the task's own sender
        // back out of the registry so this test can queue lines the way a
        // real command would, rather than reaching into the task directly.
        let mut phase = lock_or_recover(&registry)
            .get(&key)
            .expect("spawn_connection registered it")
            .phase
            .clone();
        tokio::time::timeout(PATIENCE, phase.wait_for(|p| *p == LoginPhase::Ready))
            .await
            .expect("the handshake did not finish in time")
            .expect("the connection task is still running");
        let tx = lock_or_recover(&registry)
            .get(&key)
            .expect("still registered")
            .tx
            .clone();

        tx.send(Outbound::Line(command::join_battle(
            3,
            Some("roomkey"),
            Some("scriptpw"),
        )))
        .expect("the connection task is still receiving");
        tx.send(Outbound::Line(command::open_battle(
            0,
            0,
            "hostkey",
            8452,
            16,
            -1,
            0,
            -1,
            "spring",
            "105",
            "Map",
            "Title Here",
            "BAR",
        )))
        .expect("the connection task is still receiving");

        // Both lines are queued rather than replied to (the fixture ignores
        // anything but LOGIN/REGISTER/LISTCOMPFLAGS), so wait for the
        // console to have recorded them rather than for a reply that never
        // comes.
        let deadline = tokio::time::Instant::now() + PATIENCE;
        loop {
            let recorded = lock_or_recover(&seen).clone();
            if recorded.iter().any(|l| l.contains("JOINBATTLE"))
                && recorded.iter().any(|l| l.contains("OPENBATTLE"))
            {
                break;
            }
            if tokio::time::Instant::now() >= deadline {
                panic!("timed out waiting for the JOINBATTLE/OPENBATTLE console lines");
            }
            tokio::time::sleep(Duration::from_millis(2)).await;
        }

        let text = lock_or_recover(&seen).join("\n");
        assert!(!text.contains("roomkey"), "the room key leaked:\n{text}");
        assert!(
            !text.contains("scriptpw"),
            "the script password leaked:\n{text}"
        );
        assert!(
            !text.contains("hostkey"),
            "the host's room key leaked:\n{text}"
        );
        // The absence above is redaction, not lines that never arrived: the
        // battle id, the type, the NAT mode, the port and the rest of the
        // OPENBATTLE tab block are all still there.
        assert!(
            text.contains("JOINBATTLE 3 <redacted> <redacted>"),
            "the console should still show the rest of the JOINBATTLE line:\n{text}"
        );
        // Stops short of the tab-separated block: the recorded line is JSON,
        // which escapes a literal tab as the two characters `\` and `t`
        // rather than the byte this Rust string literal would produce, so a
        // real tab here would never match.
        assert!(
            text.contains("OPENBATTLE 0 0 <redacted> 8452 16 -1 0 -1 spring"),
            "the console should still show the rest of the OPENBATTLE line:\n{text}"
        );
    }

    /// The acceptance test for issue #2048. A real `JOIN` with a key, built
    /// by `command::join_channel` and driven through the real connection
    /// task over the same TCP fixture the tests above use, must not leave
    /// the channel key anywhere in what the frontend was sent: whoever
    /// holds it can join a locked channel they were not invited to. A
    /// second `JOIN` with no key, the bare shape `join_channel` sends for
    /// an unlocked channel, must show as-is: there was never a key to hide,
    /// so nothing here should print `<redacted>` for it.
    #[tokio::test]
    async fn joining_a_channel_never_reaches_the_frontend_with_its_key() {
        let addr = lobby_finishing_login_or_registration().await;
        let stream = tokio::net::TcpStream::connect(addr)
            .await
            .expect("the lobby is listening");
        let registry: Registry = Registry::default();
        let key = format!("alice@{addr}");

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

        let logs = std::env::temp_dir().join("coilbox-join-redaction-tests");
        spawn_connection(
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

        let mut phase = lock_or_recover(&registry)
            .get(&key)
            .expect("spawn_connection registered it")
            .phase
            .clone();
        tokio::time::timeout(PATIENCE, phase.wait_for(|p| *p == LoginPhase::Ready))
            .await
            .expect("the handshake did not finish in time")
            .expect("the connection task is still running");
        let tx = lock_or_recover(&registry)
            .get(&key)
            .expect("still registered")
            .tx
            .clone();

        tx.send(Outbound::Line(command::join_channel(
            "locked",
            Some("chankey"),
        )))
        .expect("the connection task is still receiving");
        tx.send(Outbound::Line(command::join_channel("open", None)))
            .expect("the connection task is still receiving");

        // Neither line gets a reply from the fixture (it only answers
        // LOGIN/REGISTER/LISTCOMPFLAGS), so wait for the console to have
        // recorded both rather than for a reply that never comes.
        let deadline = tokio::time::Instant::now() + PATIENCE;
        loop {
            let recorded = lock_or_recover(&seen).clone();
            if recorded.iter().any(|l| l.contains("JOIN locked"))
                && recorded.iter().any(|l| l.contains("JOIN open"))
            {
                break;
            }
            if tokio::time::Instant::now() >= deadline {
                panic!("timed out waiting for the JOIN console lines");
            }
            tokio::time::sleep(Duration::from_millis(2)).await;
        }

        let text = lock_or_recover(&seen).join("\n");
        assert!(!text.contains("chankey"), "the channel key leaked:\n{text}");
        // The absence above is redaction, not a line that never arrived: the
        // channel name is still there.
        assert!(
            text.contains("JOIN locked <redacted>"),
            "the console should still show the rest of the JOIN line:\n{text}"
        );
        // A channel with no key was never sent one, so nothing should show
        // as redacted for it.
        assert!(
            text.contains("JOIN open") && !text.contains("JOIN open <redacted>"),
            "a keyless JOIN should not show a redaction:\n{text}"
        );
    }
}
