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
    command, parse_line, record_outgoing_private, reduce_at, ChatKind, Delta, LobbyState,
    LoginConfig, LoginMachine, LoginPhase, ServerMessage,
};
use futures_util::{SinkExt, StreamExt};
use serde::Serialize;
use tauri::ipc::Channel;
use tokio::sync::mpsc::{self, UnboundedSender};
use tokio_util::codec::{Framed, LinesCodec};

use crate::dmlog::DmLog;
use crate::lock_or_recover;
use crate::tls::AsyncReadWrite;

/// Unix-millis now, saturating to 0 on the (impossible) pre-epoch case.
fn now_ms() -> u64 {
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
pub enum Outbound {
    Line(String),
    SayPrivate { peer: String, text: String },
    SayPrivateEx { peer: String, text: String },
    ConfirmAgreement { code: Option<String> },
    Shutdown,
}

/// The frontend event channel, wrapped so a webview reload can swap in a fresh
/// `Channel` (via `mp_reattach`) without disturbing the running connection task.
pub type EventSink = Arc<Mutex<Channel<LobbyEvent>>>;

/// Send one event to the current frontend channel, ignoring a detached/dead one.
fn emit(sink: &EventSink, ev: LobbyEvent) {
    let _ = lock_or_recover(sink).send(ev);
}

/// One live connection, held in the plugin registry so commands can push lines and
/// disconnect. `state` is the shared authoritative mirror the read task mutates and
/// `mp_snapshot` clones; `sink` is the swappable event channel and `phase` the last
/// login phase, both so a reload can re-adopt the connection via `mp_reattach`.
pub struct ServerConn {
    pub tx: UnboundedSender<Outbound>,
    pub state: Arc<Mutex<LobbyState>>,
    pub sink: EventSink,
    pub phase: Arc<Mutex<LoginPhase>>,
    /// The agreement text sent by the server while parked on `AwaitAgreement`, so
    /// `mp_reattach` can replay it alongside the phase after a webview reload.
    pub agreement: Arc<Mutex<Option<String>>>,
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
    let phase = Arc::new(Mutex::new(LoginPhase::AwaitGreeting));
    let agreement = Arc::new(Mutex::new(None));

    tokio::spawn(run_loop(
        registry.clone(),
        server_key.clone(),
        stream,
        login_cfg,
        sink.clone(),
        phase.clone(),
        agreement.clone(),
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
            tx,
            state,
            sink,
            phase,
            agreement,
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
    phase_slot: Arc<Mutex<LoginPhase>>,
    agreement_slot: Arc<Mutex<Option<String>>>,
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
                    emit(&sink, LobbyEvent::Console {
                        direction: "in".into(),
                        line: line.clone(),
                    });
                    let msg = parse_line(&line);

                    let before = login.phase();
                    outbound.extend(login.on_message(&msg));
                    if login.phase() != before {
                        let agreement = (login.phase() == LoginPhase::AwaitAgreement)
                            .then(|| login.agreement_text());
                        *lock_or_recover(&phase_slot) = login.phase();
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
                            if let Some(m) = m {
                                chan_log.append(ch, &m);
                            }
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
                        *lock_or_recover(&phase_slot) = login.phase();
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
            emit(
                &sink,
                LobbyEvent::Console {
                    direction: "out".into(),
                    line: line.clone(),
                },
            );
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
