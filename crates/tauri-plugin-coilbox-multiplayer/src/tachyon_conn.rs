//! The Tachyon connection task, alongside the line protocol's in [`crate::conn`].
//!
//! Both produce the same thing: a [`ServerConn`] in the one [`Registry`], keyed the
//! same way, streaming the same [`LobbyEvent`]s to the frontend. So `mp_snapshot`,
//! `mp_disconnect` and `mp_reattach` work on either without knowing which they
//! have. One task owns the socket and is the only writer of its [`LobbyState`],
//! exactly as the line protocol's task is.
//!
//! Three things differ.
//!
//! There is no login exchange. Tachyon presents its token on the HTTP upgrade, so a
//! socket that opened at all is already authenticated and the connection starts at
//! [`LoginPhase::Ready`]. The phases before that belong to the connect command,
//! which emits them while it is still getting a token and opening the socket.
//!
//! The state carries users, the battle list and the lobby we are in. Every frame
//! the correlator hands up is folded through [`crate::tachyon_users`], which
//! populates `users` and `my_username`, through [`crate::tachyon_lobbies`],
//! which populates `battles`, and through [`crate::tachyon_room`], which
//! populates `current_battle` and the joined lobby's detail, and through
//! [`crate::tachyon_messaging`], which populates the direct message threads and
//! the joined lobby's chat. Friends come later, so the rest of the state is
//! still empty.
//!
//! Every queued action other than a shutdown and the lobby ones is a
//! TASServer wire line with no Tachyon equivalent. Issue #1235 hides the
//! surfaces that offer them, and until then they are dropped and noted in the
//! console rather than put on the socket.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use coilbox_lobby_protocol::{Delta, LobbyState, LoginPhase};
use coilbox_tachyon_protocol::{parse_frame, TachyonMessage};
use serde_json::{json, Value};
use tauri::ipc::Channel;
use tokio::sync::mpsc;

use crate::conn::{
    emit, now_ms, EventSink, LobbyEvent, Outbound, Registry, ServerConn, TachyonAction,
    TachyonHandle,
};
use crate::lock_or_recover;
use crate::tachyon_messaging::Conversation;
use crate::tachyon_rpc::{spawn as spawn_rpc, Handlers, RequestError, TachyonClient};
use crate::tachyon_ws::{TachyonSocket, WsError};
use crate::{tachyon_lobbies, tachyon_messaging, tachyon_room, tachyon_users};

/// The path the WebSocket sits at. The specification carries an open question about
/// advertising it in the OAuth metadata, and nothing advertises it today, so this
/// convention is hardcoded (see `docs/tachyon-protocol.md`).
const TACHYON_PATH: &str = "/tachyon";

/// How long a graceful disconnect waits for the close handshake before dropping the
/// socket. The user has already left, so a server that never answers must not hold
/// the task open behind them.
const SHUTDOWN_GRACE: Duration = Duration::from_secs(2);

/// Where each Tachyon server's chat history got to, by `serverKey`.
///
/// `messaging/subscribeReceived` takes an opaque marker and replays from it, so
/// a reconnect can pick up what arrived while the socket was down. The marker
/// outlives the connection that learned it, which is why it is held here rather
/// than on the connection, and it is held for the run rather than on disk,
/// because the server keeps a limited window of history anyway.
pub(crate) type TachyonMarkers = Arc<Mutex<HashMap<String, String>>>;

/// The two URLs a Tachyon server entry resolves to: the origin its OAuth discovery
/// document sits under, and the WebSocket endpoint itself.
///
/// A `LobbyServer` stores a host, a port and a TLS flag, because that is what the
/// line protocol needs and every consumer of `serverKey` already assumes. A Tachyon
/// server's identity is really a URL origin, so it is rebuilt here rather than
/// stored twice. The default port is left out, so the origin matches the one the
/// server names in its own discovery document.
pub(crate) fn urls(host: &str, port: u16, tls: bool) -> (String, String) {
    let authority = if port == if tls { 443 } else { 80 } {
        host.to_owned()
    } else {
        format!("{host}:{port}")
    };
    let (http, ws) = if tls {
        ("https", "wss")
    } else {
        ("http", "ws")
    };
    (
        format!("{http}://{authority}"),
        format!("{ws}://{authority}{TACHYON_PATH}"),
    )
}

/// Spawn the connection task for an already-open Tachyon socket, registering its
/// [`ServerConn`] so the shared commands can act on it. Returns once the task is
/// spawned and registered.
pub fn spawn_connection(
    registry: Registry,
    server_key: String,
    socket: TachyonSocket,
    on_event: Channel<LobbyEvent>,
    markers: TachyonMarkers,
) {
    let (tx, rx) = mpsc::unbounded_channel::<Outbound>();
    let state = Arc::new(Mutex::new(LobbyState::new()));
    let sink: EventSink = Arc::new(Mutex::new(on_event));
    // Filled by the task once the correlator is running. Registered empty rather
    // than waited for, so the connection is reachable by key from the moment this
    // returns, exactly as it was before.
    let tachyon = TachyonHandle::default();

    tokio::spawn(run_loop(
        registry.clone(),
        server_key.clone(),
        socket,
        sink.clone(),
        rx,
        state.clone(),
        tachyon.clone(),
        markers,
    ));

    lock_or_recover(&registry).insert(
        server_key,
        ServerConn {
            tx,
            state,
            sink,
            tachyon,
            // The socket is open, so the connection is past every phase there is.
            phase: Arc::new(Mutex::new(LoginPhase::Ready)),
            // Tachyon has no agreement handshake. The terms are accepted in the
            // browser, before a token exists.
            agreement: Arc::new(Mutex::new(None)),
        },
    );
}

/// The connection event loop. Interleaves the frames the correlator hands up, the
/// actions commands queue, and the correlator's own ending. On exit it reports the
/// reason and evicts itself from the registry.
#[allow(clippy::too_many_arguments)]
async fn run_loop(
    registry: Registry,
    server_key: String,
    mut socket: TachyonSocket,
    sink: EventSink,
    mut rx: mpsc::UnboundedReceiver<Outbound>,
    state: Arc<Mutex<LobbyState>>,
    tachyon: TachyonHandle,
    markers: TachyonMarkers,
) {
    // The console is fed from the socket rather than from here, because the socket
    // is the one place every frame passes through in both directions. Watching from
    // above would miss the responses and requests the correlator answers itself.
    let console = sink.clone();
    socket.watch(Box::new(move |direction, frame| {
        emit(
            &console,
            LobbyEvent::Console {
                direction: direction.to_owned(),
                line: frame.to_owned(),
            },
        );
    }));

    emit(&sink, LobbyEvent::Connected);
    emit(
        &sink,
        LobbyEvent::Phase {
            phase: LoginPhase::Ready,
            agreement: None,
        },
    );

    let (inbound_tx, mut inbound_rx) = mpsc::unbounded_channel::<String>();
    // The `lobby/join` response is folded like any other frame, so the task that
    // asks for one puts it back on this channel.
    let joined_tx = inbound_tx.clone();
    // No handlers yet. A server-to-client request is answered
    // `command_unimplemented`, which is a real protocol answer, so an unhandled
    // command costs a rejection rather than the connection. `battle/start` gets its
    // handler with the battle launch work.
    let (client, mut task) = spawn_rpc(socket, Handlers::new(), inbound_tx);
    // Hand the client to the registry, so a command can send a request over this
    // connection. Cleared below when the connection ends, so a request that lands
    // in the moment before the registry entry goes is refused rather than queued
    // for a socket that has closed.
    *lock_or_recover(&tachyon) = Some(client.clone());
    // The battle list is a subscription, and nothing else asks for it, so the
    // connection asks as soon as it is up. The answer is an ack: the list itself
    // follows as `lobby/listReset`.
    ask(client.clone(), sink.clone(), "lobby/subscribeList", None);
    // Chat is a subscription too, and it resumes: the marker an earlier
    // connection to this server got to is what makes a reconnect replay the
    // messages that arrived while it was down.
    let resume = lock_or_recover(&markers).get(&server_key).cloned();
    subscribe_messages(client.clone(), sink.clone(), resume);

    // One task sends the chat messages, in the order the loop hands them over.
    // Each carries its own client handle, so between messages the task holds
    // nothing and a shutdown is not waiting on it.
    let (say_tx, say_rx) = mpsc::unbounded_channel::<Say>();
    let (sent_tx, mut sent_rx) = mpsc::unbounded_channel::<SendOutcome>();
    tokio::spawn(sending(say_rx, sent_tx));
    let mut client = Some(client);

    // The lobby we are in, written here and nowhere else, exactly as the state
    // is. A request that finishes off the loop reports back rather than writing.
    let mut room = None;
    let (left_tx, mut left_rx) = mpsc::unbounded_channel::<LeaveOutcome>();

    let reason: Option<String> = loop {
        tokio::select! {
            // Every frame the correlator did not consume: the events, and anything
            // it could not place. The console already has them, from the tap above.
            // The `lobby/join` response comes back through here too, put on this
            // channel by the task that asked for it.
            Some(frame) = inbound_rx.recv() => {
                let message = parse_frame(&frame);
                let deltas = {
                    let mut state = lock_or_recover(&state);
                    let mut deltas = tachyon_users::reduce(&mut state, &message);
                    // A name that has just arrived may be the name of a thread
                    // filed under a user id, so this follows the user fold.
                    deltas.extend(tachyon_messaging::rename_threads(&mut state));
                    deltas.extend(tachyon_lobbies::reduce(&mut state, &message));
                    deltas.extend(tachyon_room::reduce(&mut room, &mut state, &message));
                    deltas.extend(tachyon_messaging::reduce(&mut state, &message, now_ms()));
                    deltas
                };
                for delta in deltas {
                    emit(&sink, LobbyEvent::Delta { delta });
                }
                // Where this server's history has got to, so a reconnect asks
                // to resume from here.
                if let Some(marker) = tachyon_messaging::marker_of(&message) {
                    lock_or_recover(&markers)
                        .insert(server_key.clone(), marker.to_owned());
                }
                // A direct message from someone we cannot name leaves the
                // thread filed under their user id until we can.
                if let Some(id) = tachyon_messaging::sender_to_subscribe(
                    &lock_or_recover(&state),
                    &message,
                ) {
                    if let Some(client) = client.clone() {
                        subscribe(client, sink.clone(), vec![id]);
                    }
                }
                // `user/self` names our friends, ignores and party by id alone.
                // Subscribing is what turns those ids into names in `users`.
                if let TachyonMessage::UserSelfEvent(event) = &message {
                    let ids = tachyon_users::ids_to_subscribe(
                        &lock_or_recover(&state),
                        &event.data.user,
                    );
                    if let Some(client) = client.clone() {
                        subscribe(client, sink.clone(), ids);
                    }
                }
                // A lobby names its members by id, and an offline one is not in
                // `users` at all, so the roster needs the same subscription.
                if joined(&message) {
                    let ids = tachyon_room::ids_to_subscribe(&lock_or_recover(&state), &room);
                    if let Some(client) = client.clone() {
                        subscribe(client, sink.clone(), ids);
                    }
                }
            }
            // Our own `lobby/leave` finished. The room is the loop's, so the task
            // that asked reports the outcome rather than acting on it.
            Some(outcome) = left_rx.recv() => match outcome {
                LeaveOutcome::Done => {
                    let deltas = tachyon_room::left(&mut room, &mut lock_or_recover(&state));
                    for delta in deltas {
                        emit(&sink, LobbyEvent::Delta { delta });
                    }
                }
                // Still in the lobby, so a `lobby/left` from here on is the
                // server throwing us out and worth telling the user about.
                LeaveOutcome::Failed => tachyon_room::mark_leaving(&mut room, false),
            },
            // A chat message the server has answered for. The conversation is
            // the state's, so the sending task reports back rather than writing.
            Some(outcome) = sent_rx.recv() => {
                let deltas = record(&state, &outcome.conversation, &outcome.text, outcome.problem);
                for delta in deltas {
                    emit(&sink, LobbyEvent::Delta { delta });
                }
            }
            Some(out) = rx.recv() => match out {
                Outbound::Tachyon(TachyonAction::JoinLobby { battle }) => {
                    let lobby = lock_or_recover(&state)
                        .battles
                        .get(&battle)
                        .and_then(|battle| battle.tachyon_id.clone());
                    match (lobby, client.clone()) {
                        (Some(lobby), Some(client)) => {
                            join(client, sink.clone(), joined_tx.clone(), lobby);
                        }
                        // The list moved under the click, so the lobby the user
                        // chose is not one we can name any more.
                        (None, _) => emit(&sink, LobbyEvent::Delta {
                            delta: Delta::JoinBattleFailed {
                                reason: "That battle is no longer open.".into(),
                            },
                        }),
                        (_, None) => {}
                    }
                }
                Outbound::Tachyon(TachyonAction::LeaveLobby) => {
                    tachyon_room::mark_leaving(&mut room, true);
                    if let Some(client) = client.clone() {
                        leave(client, sink.clone(), left_tx.clone());
                    }
                }
                Outbound::Tachyon(TachyonAction::Room(action)) => {
                    let requests = {
                        let state = lock_or_recover(&state);
                        tachyon_room::requests_for(&room, &state, &action)
                    };
                    for request in requests {
                        if let Some(client) = client.clone() {
                            act(client, sink.clone(), request);
                        }
                    }
                }
                Outbound::Tachyon(TachyonAction::Say { conversation, text }) => {
                    let body = {
                        let state = lock_or_recover(&state);
                        tachyon_messaging::send_request(&state, &conversation, &text)
                    };
                    match (body, client.clone()) {
                        (Ok(data), Some(client)) => {
                            let _ = say_tx.send(Say { client, conversation, text, data });
                        }
                        // Nothing reached the server, so the message is put in
                        // front of the user rather than lost.
                        (Err(refusal), _) => {
                            let deltas = record(
                                &state,
                                &conversation,
                                &text,
                                Some(refusal.text()),
                            );
                            for delta in deltas {
                                emit(&sink, LobbyEvent::Delta { delta });
                            }
                        }
                        (_, None) => {}
                    }
                }
                Outbound::Shutdown => {
                    // Letting the last client handle go is what asks the correlator
                    // to close politely, so the registry's copy has to go with ours
                    // or the close would wait out the grace period every time.
                    // Bounded either way, so a server that never answers the close
                    // cannot hold this task open.
                    lock_or_recover(&tachyon).take();
                    let _ = client.take();
                    let _ = tokio::time::timeout(SHUTDOWN_GRACE, &mut task).await;
                    break None;
                }
                Outbound::Line(line) => not_sent(&sink, &line),
                Outbound::SayPrivate { peer, .. } => not_sent(&sink, &format!("SAYPRIVATE {peer}")),
                Outbound::SayPrivateEx { peer, .. } => {
                    not_sent(&sink, &format!("SAYPRIVATEEX {peer}"))
                }
                Outbound::ConfirmAgreement { .. } => not_sent(&sink, "CONFIRMAGREEMENT"),
            },
            ended = &mut task => break ended
                .map(|e| match e {
                    // A peer that went away without closing has nothing to report.
                    WsError::Closed { code: None, ref reason } if reason.is_empty() => None,
                    other => Some(other.to_string()),
                })
                .unwrap_or_else(|e| Some(format!("the connection task stopped: {e}"))),
        }
    };

    // Drop the shared client before the registry entry goes, so a command holding
    // the handle cannot send over a connection that has ended.
    lock_or_recover(&tachyon).take();
    emit(&sink, LobbyEvent::Disconnected { reason });
    lock_or_recover(&registry).remove(&server_key);
}

/// What our own `lobby/leave` did, reported back because the connection loop
/// owns the room.
enum LeaveOutcome {
    /// The server took us out, so the room is gone.
    Done,
    /// The request did not succeed, so we are still in the lobby.
    Failed,
}

/// Whether a message is the answer to a `lobby/join` we sent, which is the one
/// that puts us in a room.
fn joined(message: &TachyonMessage) -> bool {
    matches!(
        message,
        TachyonMessage::LobbyJoinResponse(
            coilbox_tachyon_protocol::types::LobbyJoinResponse::Success { .. }
        )
    )
}

/// One chat message waiting for the sending task, with the client it goes out
/// over.
struct Say {
    client: TachyonClient,
    conversation: Conversation,
    text: String,
    data: Value,
}

/// What became of a chat message we sent. `problem` is `None` when the server
/// took it.
struct SendOutcome {
    conversation: Conversation,
    text: String,
    problem: Option<String>,
}

/// Send the queued chat messages one at a time, reporting each outcome.
///
/// One at a time because the order lines appear in is the order they were
/// typed, and a task per message would race: a burst of them waits on the send
/// queue and the answers would come back in whichever order they finished.
async fn sending(
    mut queue: mpsc::UnboundedReceiver<Say>,
    outcome: mpsc::UnboundedSender<SendOutcome>,
) {
    while let Some(say) = queue.recv().await {
        let problem = match say.client.request("messaging/send", Some(say.data)).await {
            Ok(_) => None,
            Err(error) => Some(refusal(&error)),
        };
        let sent = SendOutcome {
            conversation: say.conversation,
            text: say.text,
            problem,
        };
        if outcome.send(sent).is_err() {
            return;
        }
    }
}

/// Put a chat message, or the note that it did not go, into its conversation.
fn record(
    state: &Arc<Mutex<LobbyState>>,
    conversation: &Conversation,
    text: &str,
    problem: Option<String>,
) -> Vec<Delta> {
    let mut state = lock_or_recover(state);
    let now = now_ms();
    match problem {
        None => tachyon_messaging::record_sent(&mut state, conversation, text, now),
        Some(why) => tachyon_messaging::record_not_sent(&mut state, conversation, text, &why, now),
    }
}

/// Subscribe to the chat this account is sent, off the connection loop.
///
/// A marker that the server no longer holds history for means there is a gap,
/// which is worth saying: the alternative is a conversation that silently skips
/// what was said while we were away.
fn subscribe_messages(client: TachyonClient, sink: EventSink, marker: Option<String>) {
    tokio::spawn(async move {
        let data = tachyon_messaging::subscribe_request(marker.as_deref());
        let answer = client
            .request("messaging/subscribeReceived", Some(data))
            .await;
        let response = match answer {
            Ok(response) => response,
            Err(error) => {
                emit(
                    &sink,
                    LobbyEvent::Console {
                        direction: "in".into(),
                        line: format!("messaging/subscribeReceived: {error}"),
                    },
                );
                return;
            }
        };
        let missed = matches!(
            parse_frame(&response),
            TachyonMessage::MessagingSubscribeReceivedResponse(
                coilbox_tachyon_protocol::types::MessagingSubscribeReceivedResponse::Success {
                    ref data,
                    ..
                },
            ) if data.has_missed_messages
        );
        if missed && marker.is_some() {
            emit(
                &sink,
                LobbyEvent::Delta {
                    delta: Delta::ServerMessage {
                        text: "Some messages sent while you were away have not been kept by the \
                               server."
                            .into(),
                        boxed: false,
                    },
                },
            );
        }
    });
}

/// Ask to join a lobby, off the connection loop.
///
/// The whole lobby comes back in the response, so the answer goes onto the
/// inbound channel and is folded by the loop like any other frame. That keeps
/// the loop the only writer of the room.
fn join(
    client: TachyonClient,
    sink: EventSink,
    inbound: mpsc::UnboundedSender<String>,
    lobby: String,
) {
    tokio::spawn(async move {
        match client
            .request("lobby/join", Some(json!({ "id": lobby })))
            .await
        {
            Ok(response) => {
                let _ = inbound.send(response);
            }
            Err(error) => emit(
                &sink,
                LobbyEvent::Delta {
                    delta: Delta::JoinBattleFailed {
                        reason: refusal(&error),
                    },
                },
            ),
        }
    });
}

/// Ask to leave the lobby, off the connection loop.
fn leave(client: TachyonClient, sink: EventSink, outcome: mpsc::UnboundedSender<LeaveOutcome>) {
    tokio::spawn(async move {
        match client.request("lobby/leave", None).await {
            Ok(_) => {
                let _ = outcome.send(LeaveOutcome::Done);
            }
            Err(error) => {
                let _ = outcome.send(LeaveOutcome::Failed);
                emit(
                    &sink,
                    LobbyEvent::Console {
                        direction: "in".into(),
                        line: format!("lobby/leave: {error}"),
                    },
                );
            }
        }
    });
}

/// Carry out one battle room control's request, off the connection loop.
///
/// A refusal goes in front of the user rather than only into the console. The
/// command the control called returned as soon as the action was queued, so
/// there is nothing left for it to report back to.
///
/// An ally team that is full is the one refusal the room can still do something
/// about. Tachyon has a queue for that case, so a seat request that finds the
/// ally team full asks for a place in the queue instead. Two requests on one
/// click at worst, and only after the first was refused.
fn act(client: TachyonClient, sink: EventSink, request: tachyon_room::Request) {
    tokio::spawn(async move {
        let Err(error) = client.request(request.command, request.data).await else {
            return;
        };
        if request.command == "lobby/joinAllyTeam" && is_full(&error) {
            ask(client, sink, "lobby/joinQueue", None);
            return;
        }
        refused(&sink, request.command, &error);
    });
}

/// Whether a refusal was "there is no room on that ally team".
fn is_full(error: &RequestError) -> bool {
    matches!(error, RequestError::Failed(failure) if failure.reason.as_wire() == "ally_team_full")
}

/// Tell the user a room action did not happen, and why.
fn refused(sink: &EventSink, command: &str, error: &RequestError) {
    emit(
        sink,
        LobbyEvent::Delta {
            delta: Delta::ServerMessage {
                text: format!("{} failed. {}", what(command), refusal(error)),
                boxed: false,
            },
        },
    );
}

/// What a lobby command does, in the words the control that sent it uses.
fn what(command: &str) -> &str {
    match command {
        "lobby/spectate" => "Moving to the spectators",
        "lobby/joinAllyTeam" => "Taking a seat",
        "lobby/joinQueue" => "Joining the queue for a seat",
        "lobby/updateClientStatus" => "Reporting your status",
        "lobby/addBot" => "Adding the bot",
        "lobby/updateBot" => "Changing the bot",
        "lobby/removeBot" => "Removing the bot",
        "lobby/kickban" => "Kicking that player",
        "lobby/update" => "Changing the lobby",
        "lobby/appointBoss" => "Making that player a boss",
        "lobby/unboss" => "Standing that boss down",
        other => other,
    }
}

/// Why a request was refused, in words the user can act on.
///
/// The frontend puts this straight in front of the user, so a reason is spelled
/// out rather than shown as its wire value. Each lobby command adds its own
/// reasons to the four every command can fail with, and no two commands give the
/// same reason a different meaning, so one table covers them all.
fn refusal(error: &RequestError) -> String {
    let RequestError::Failed(failure) = error else {
        return error.to_string();
    };
    let reason = match failure.reason.as_wire() {
        "lobby_full" => "The battle is full.",
        "ally_team_full" => "That ally team is full.",
        "not_in_lobby" => "You are not in this lobby.",
        "not_a_player" => "Only a player can do that.",
        "bosses_not_allowed" => "This lobby does not allow bosses.",
        "message_too_long" => "The message is too long.",
        "invalid_target" => "That person or lobby cannot be messaged.",
        "banned" => "You are banned from this battle.",
        "unauthorized" => "The server did not allow that.",
        "internal_error" => "The server failed on its own side.",
        "invalid_request" => "The server rejected the request.",
        "command_unimplemented" => "This server cannot do that yet.",
        other => other,
    };
    match &failure.details {
        Some(details) => format!("{reason} {details}"),
        None => reason.to_owned(),
    }
}

/// Ask the server to send us updates about `ids`, off the connection loop.
///
/// Teiserver answers a subscription with the current state of each user, offline
/// ones included, so this is how a friend or party member the server named by id
/// alone gets a name.
fn subscribe(client: TachyonClient, sink: EventSink, ids: Vec<String>) {
    // The schema requires at least one id, so an empty list is nothing to ask.
    if ids.is_empty() {
        return;
    }
    let data = json!({ "userIds": ids });
    ask(client, sink, "user/subscribeUpdates", Some(data));
}

/// Send a request off the connection loop, noting a failure in the console.
///
/// It runs in its own task because a request waits up to 15 seconds for its
/// answer and the loop has frames to read in the meantime. The task holds a
/// client handle, so a disconnect during those seconds falls back to the bounded
/// wait in [`SHUTDOWN_GRACE`] rather than a polite close.
fn ask(client: TachyonClient, sink: EventSink, command: &'static str, data: Option<Value>) {
    tokio::spawn(async move {
        if let Err(error) = client.request(command, data).await {
            emit(
                &sink,
                LobbyEvent::Console {
                    direction: "in".into(),
                    // Not "failed", because an unsupported command reads as
                    // "lobby/subscribeList failed: this server does not support
                    // that command", which says the same thing twice and blames
                    // the request rather than the server.
                    line: format!("{command}: {error}"),
                },
            );
        }
    });
}

/// Note a queued TASServer line that this connection cannot carry. It goes to the
/// console as an outbound entry, because that is where the user would otherwise
/// look for it and find nothing.
fn not_sent(sink: &EventSink, what: &str) {
    emit(
        sink,
        LobbyEvent::Console {
            direction: "out".into(),
            line: format!("not sent, this server speaks Tachyon: {what}"),
        },
    );
}

#[cfg(test)]
mod tests {
    use super::*;
    use coilbox_lobby_protocol::{LoginConfig, LoginMode};
    use futures_util::{SinkExt, StreamExt};
    use serde_json::{json, Value};
    use tokio::net::{TcpListener, TcpStream};
    use tokio_tungstenite::tungstenite::handshake::server::{
        ErrorResponse, Request as ServerRequest, Response as ServerResponse,
    };
    use tokio_tungstenite::tungstenite::http::HeaderValue;
    use tokio_tungstenite::tungstenite::protocol::frame::coding::CloseCode;
    use tokio_tungstenite::tungstenite::protocol::frame::CloseFrame;
    use tokio_tungstenite::tungstenite::{Message, Utf8Bytes};
    use tokio_tungstenite::WebSocketStream;
    use tokio_util::sync::CancellationToken;

    /// A stand-in server that agrees to the Tachyon subprotocol and runs `body`.
    async fn serve<F, Fut>(body: F) -> String
    where
        F: FnOnce(WebSocketStream<TcpStream>) -> Fut + Send + 'static,
        Fut: std::future::Future<Output = ()> + Send,
    {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        tokio::spawn(async move {
            let (sock, _) = listener.accept().await.unwrap();
            #[allow(
                clippy::result_large_err,
                reason = "the callback signature is tungstenite's"
            )]
            let on_upgrade = |_req: &ServerRequest, mut res: ServerResponse| {
                res.headers_mut().insert(
                    "Sec-WebSocket-Protocol",
                    HeaderValue::from_static(crate::tachyon_ws::SUBPROTOCOL),
                );
                Ok::<_, ErrorResponse>(res)
            };
            let ws = tokio_tungstenite::accept_hdr_async(sock, on_upgrade)
                .await
                .unwrap();
            body(ws).await;
        });
        format!("ws://127.0.0.1:{port}/tachyon")
    }

    /// A `Channel` that puts every event it is sent onto a queue, so a test can read
    /// what the frontend would have seen. An unbounded channel, because the
    /// `Channel` callback is synchronous and must not block the runtime the
    /// connection task is running on.
    fn recording() -> (Channel<LobbyEvent>, mpsc::UnboundedReceiver<Value>) {
        let (tx, rx) = mpsc::unbounded_channel();
        let channel = Channel::new(move |body| {
            let json = match body {
                tauri::ipc::InvokeResponseBody::Json(s) => s,
                tauri::ipc::InvokeResponseBody::Raw(b) => String::from_utf8_lossy(&b).into_owned(),
            };
            let _ = tx.send(serde_json::from_str::<Value>(&json).unwrap());
            Ok(())
        });
        (channel, rx)
    }

    /// Wait for the first event of `kind`, giving up rather than hanging if the
    /// task never produces one.
    async fn wait_for(rx: &mut mpsc::UnboundedReceiver<Value>, kind: &str) -> Value {
        let find = async {
            while let Some(ev) = rx.recv().await {
                if ev["kind"] == kind {
                    return ev;
                }
            }
            panic!("the event channel closed before a {kind} event arrived");
        };
        tokio::time::timeout(Duration::from_secs(5), find)
            .await
            .unwrap_or_else(|_| panic!("no {kind} event arrived within 5 seconds"))
    }

    /// Wait for the first frame the connection sends for `command`, giving up
    /// rather than hanging if none arrives.
    async fn wait_for_sent(rx: &mut mpsc::UnboundedReceiver<String>, command: &str) -> Value {
        let find = async {
            while let Some(text) = rx.recv().await {
                let frame: Value = serde_json::from_str(&text).unwrap();
                if frame["commandId"] == command {
                    return frame;
                }
            }
            panic!("the server task ended before a {command} frame arrived");
        };
        tokio::time::timeout(Duration::from_secs(5), find)
            .await
            .unwrap_or_else(|_| panic!("no {command} frame arrived within 5 seconds"))
    }

    /// Open a connection to `url` and register it under `server_key`, with no
    /// chat history behind it.
    async fn connect(
        registry: &Registry,
        server_key: &str,
        url: &str,
    ) -> mpsc::UnboundedReceiver<Value> {
        connect_with(registry, server_key, url, TachyonMarkers::default()).await
    }

    /// The same, carrying whatever earlier connections to these servers got to.
    async fn connect_with(
        registry: &Registry,
        server_key: &str,
        url: &str,
        markers: TachyonMarkers,
    ) -> mpsc::UnboundedReceiver<Value> {
        let socket = crate::tachyon_ws::connect(
            url,
            "test-token",
            Duration::from_secs(5),
            &CancellationToken::new(),
        )
        .await
        .unwrap_or_else(|e| panic!("connect failed: {e}"));
        let (channel, rx) = recording();
        spawn_connection(
            registry.clone(),
            server_key.to_owned(),
            socket,
            channel,
            markers,
        );
        rx
    }

    /// The queued-action sender for a live connection.
    fn sender(registry: &Registry, server_key: &str) -> mpsc::UnboundedSender<Outbound> {
        lock_or_recover(registry)
            .get(server_key)
            .expect("the connection is not registered")
            .tx
            .clone()
    }

    #[test]
    fn a_tachyon_entry_resolves_to_an_origin_and_a_websocket() {
        // What the Beyond All Reason built-in stores. The port is dropped, so the
        // origin is the one the server names in its own discovery document.
        assert_eq!(
            urls("server4.beyondallreason.info", 443, true),
            (
                "https://server4.beyondallreason.info".into(),
                "wss://server4.beyondallreason.info/tachyon".into()
            )
        );
        // A non-default port is kept, on both.
        assert_eq!(
            urls("teiserver.example", 8443, true),
            (
                "https://teiserver.example:8443".into(),
                "wss://teiserver.example:8443/tachyon".into()
            )
        );
        // Plaintext, which the transport allows on loopback only.
        assert_eq!(
            urls("localhost", 4000, false),
            (
                "http://localhost:4000".into(),
                "ws://localhost:4000/tachyon".into()
            )
        );
        assert_eq!(
            urls("localhost", 80, false),
            ("http://localhost".into(), "ws://localhost/tachyon".into())
        );
    }

    #[tokio::test]
    async fn connecting_registers_and_reports_itself_ready() {
        let url = serve(|ws| async move {
            // Holding the socket, so the connection stays open rather than
            // ending the moment the server task drops it.
            let _held = ws;
            std::future::pending::<()>().await
        })
        .await;
        let registry = Registry::default();
        let mut rx = connect(&registry, "alice@bar:443", &url).await;

        assert_eq!(wait_for(&mut rx, "connected").await["kind"], "connected");
        assert_eq!(wait_for(&mut rx, "phase").await["phase"], "ready");
        assert!(lock_or_recover(&registry).contains_key("alice@bar:443"));
    }

    /// The point of sharing the registry: `mp_snapshot`, `mp_disconnect` and
    /// `mp_reattach` look a connection up by key and act on it without knowing
    /// which protocol it speaks, so both have to be able to sit in there at once.
    #[tokio::test]
    async fn the_registry_holds_a_tachyon_and_a_tasserver_connection_at_once() {
        let registry = Registry::default();

        let url = serve(|ws| async move {
            // Holding the socket, so the connection stays open rather than
            // ending the moment the server task drops it.
            let _held = ws;
            std::future::pending::<()>().await
        })
        .await;
        let mut rx = connect(&registry, "alice@bar:443", &url).await;
        wait_for(&mut rx, "phase").await;

        // A TASServer connection to a listener that says nothing, which is enough
        // to register it. Its login machine simply waits for a greeting.
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        tokio::spawn(async move {
            let _held = listener.accept().await.unwrap();
            std::future::pending::<()>().await;
        });
        let stream = TcpStream::connect(("127.0.0.1", port)).await.unwrap();
        let logs = std::env::temp_dir().join("coilbox-tachyon-conn-test");
        let (line_channel, _line_rx) = recording();
        crate::conn::spawn_connection(
            registry.clone(),
            "alice@bar:8200".into(),
            Box::new(stream),
            LoginConfig {
                username: "alice".into(),
                password_hash: "aGFzaA==".into(),
                local_ip: "*".into(),
                agent: "Coilbox test".into(),
                client_id: "0".into(),
                compat_flags: vec![],
                use_stls: false,
                mode: LoginMode::Login,
            },
            line_channel,
            crate::dmlog::DmLog::new(&logs, "alice@bar:8200"),
            crate::dmlog::DmLog::new(&logs, "alice@bar:8200"),
        );

        let map = lock_or_recover(&registry);
        assert_eq!(map.len(), 2);
        // The Tachyon one is connected, the line one is still waiting to be
        // greeted, and each carries its own phase and its own state.
        assert_eq!(
            *lock_or_recover(&map["alice@bar:443"].phase),
            LoginPhase::Ready
        );
        assert_eq!(
            *lock_or_recover(&map["alice@bar:8200"].phase),
            LoginPhase::AwaitGreeting
        );
    }

    #[tokio::test]
    async fn an_inbound_frame_reaches_the_console() {
        let url = serve(|mut ws| async move {
            ws.send(Message::text(
                json!({
                    "type": "event",
                    "messageId": "1",
                    "commandId": "user/updated",
                    "data": { "users": [] },
                })
                .to_string(),
            ))
            .await
            .unwrap();
            std::future::pending::<()>().await;
        })
        .await;
        let mut rx = connect(&Registry::default(), "alice@bar:443", &url).await;

        // Past our own subscriptions, which the same tap reports going out.
        let console = loop {
            let event = wait_for(&mut rx, "console").await;
            if event["direction"] == "in" {
                break event;
            }
        };
        assert!(
            console["line"].as_str().unwrap().contains("user/updated"),
            "unexpected console line: {console}"
        );
    }

    /// The reduction is tested a frame at a time in [`crate::tachyon_users`].
    /// This is the wiring: a real frame off a real socket reaches the state, its
    /// delta reaches the frontend, and the ids it named are subscribed to.
    #[tokio::test]
    async fn a_user_self_event_populates_the_state_and_subscribes_to_the_ids_it_names() {
        let (seen_tx, mut seen_rx) = mpsc::unbounded_channel::<String>();
        let url = serve(move |mut ws| async move {
            ws.send(Message::text(
                json!({
                    "type": "event",
                    "messageId": "1",
                    "commandId": "user/self",
                    "data": { "user": {
                        "userId": "1",
                        "username": "alice",
                        "displayName": "Alice",
                        "clanBaseData": null,
                        "status": "menu",
                        "party": null,
                        "invitedToParties": [],
                        "friendIds": ["2"],
                        "outgoingFriendRequest": [],
                        "incomingFriendRequest": [],
                        "ignoreIds": [],
                        "currentLobby": null,
                        "clanInvites": [],
                        "matchmaking": { "state": "no_matchmaking" },
                    } },
                })
                .to_string(),
            ))
            .await
            .unwrap();
            while let Some(Ok(msg)) = ws.next().await {
                if let Message::Text(text) = msg {
                    let _ = seen_tx.send(text.to_string());
                }
            }
        })
        .await;
        let registry = Registry::default();
        let mut rx = connect(&registry, "alice@bar:443", &url).await;

        assert_eq!(
            wait_for(&mut rx, "delta").await["delta"]["username"],
            "alice"
        );

        let frame = wait_for_sent(&mut seen_rx, "user/subscribeUpdates").await;
        assert_eq!(frame["data"]["userIds"], json!(["2"]));

        let state = lock_or_recover(&registry)["alice@bar:443"].state.clone();
        let state = lock_or_recover(&state);
        assert_eq!(state.my_username.as_deref(), Some("alice"));
        assert_eq!(state.users["alice"].user_id, "1");
    }

    /// The reduction is tested a frame at a time in [`crate::tachyon_lobbies`].
    /// This is the wiring: the connection asks for the list, and the list it
    /// gets back reaches the state and the frontend.
    #[tokio::test]
    async fn the_connection_subscribes_to_the_lobby_list_and_folds_what_comes_back() {
        let (seen_tx, mut seen_rx) = mpsc::unbounded_channel::<String>();
        let url = serve(move |mut ws| async move {
            ws.send(Message::text(
                json!({
                    "type": "event",
                    "messageId": "1",
                    "commandId": "lobby/listReset",
                    "data": { "lobbies": { "lobby-a": {
                        "id": "lobby-a",
                        "name": "Comet Catcher 8v8",
                        "playerCount": 3,
                        "maxPlayerCount": 16,
                        "mapName": "Comet Catcher Remake 1.8",
                        "engineVersion": "2025.01.4",
                        "gameVersion": "Beyond All Reason test-1234",
                        "currentBattle": null,
                    } } },
                })
                .to_string(),
            ))
            .await
            .unwrap();
            while let Some(Ok(msg)) = ws.next().await {
                if let Message::Text(text) = msg {
                    let _ = seen_tx.send(text.to_string());
                }
            }
        })
        .await;
        let registry = Registry::default();
        let mut rx = connect(&registry, "alice@bar:443", &url).await;

        wait_for_sent(&mut seen_rx, "lobby/subscribeList").await;
        assert_eq!(
            wait_for(&mut rx, "delta").await["delta"]["kind"],
            "battleOpened"
        );

        let state = lock_or_recover(&registry)["alice@bar:443"].state.clone();
        let state = lock_or_recover(&state);
        let battle = state.battles.values().next().expect("the list is empty");
        assert_eq!(battle.tachyon_id.as_deref(), Some("lobby-a"));
        assert_eq!(battle.title, "Comet Catcher 8v8");
        assert_eq!(battle.player_count, Some(3));
    }

    /// The whole lobby, as `lobby/join` answers with it: two players, one of
    /// whom the connection has never been told a name for.
    fn lobby_details() -> Value {
        json!({
            "id": "lobby-a",
            "name": "Comet Catcher 8v8",
            "mapName": "Comet Catcher Remake 1.8",
            "engineVersion": "2025.01.4",
            "gameVersion": "Beyond All Reason test-1234",
            "areBossesEnabled": false,
            "gameOptions": {},
            "bosses": {},
            "bots": {},
            "spectators": {},
            "players": {
                "01": {
                    "id": "1", "allyTeam": "01", "team": "01", "player": "01",
                    "isReady": true, "assetStatus": "complete",
                },
                "02": {
                    "id": "2", "allyTeam": "02", "team": "01", "player": "01",
                    "isReady": false, "assetStatus": "missing",
                },
            },
            "allyTeamConfig": {
                "01": {
                    "maxTeams": 1,
                    "startBox": { "left": 0.0, "top": 0.0, "right": 0.25, "bottom": 1.0 },
                    "teams": { "01": { "maxPlayers": 8 } },
                },
                "02": {
                    "maxTeams": 1,
                    "startBox": { "left": 0.75, "top": 0.0, "right": 1.0, "bottom": 1.0 },
                    "teams": { "01": { "maxPlayers": 8 } },
                },
            },
        })
    }

    /// The `lobby/listReset` the connection's own subscription answers with, so
    /// a test has a battle handle to join by.
    fn list_reset() -> Message {
        Message::text(
            json!({
                "type": "event",
                "messageId": "1",
                "commandId": "lobby/listReset",
                "data": { "lobbies": { "lobby-a": {
                    "id": "lobby-a",
                    "name": "Comet Catcher 8v8",
                    "playerCount": 2,
                    "maxPlayerCount": 16,
                    "mapName": "Comet Catcher Remake 1.8",
                    "engineVersion": "2025.01.4",
                    "gameVersion": "Beyond All Reason test-1234",
                    "currentBattle": null,
                } } },
            })
            .to_string(),
        )
    }

    /// A server that lists one lobby and then answers `lobby/join` and
    /// `lobby/leave` with `answer`, reporting every frame it reads.
    async fn lobby_server(seen: mpsc::UnboundedSender<String>, answer: Value) -> String {
        serve(move |mut ws| async move {
            ws.send(list_reset()).await.unwrap();
            while let Some(Ok(msg)) = ws.next().await {
                let Message::Text(text) = msg else { continue };
                let _ = seen.send(text.to_string());
                let request: Value = serde_json::from_str(&text).unwrap();
                let mut response = answer.clone();
                let body = response.as_object_mut().unwrap();
                body.insert("messageId".into(), request["messageId"].clone());
                body.insert("commandId".into(), request["commandId"].clone());
                ws.send(Message::text(response.to_string())).await.unwrap();
            }
        })
        .await
    }

    /// The handle the lobby list filed `lobby-a` under, once it has arrived.
    async fn listed_handle(registry: &Registry, rx: &mut mpsc::UnboundedReceiver<Value>) -> u32 {
        let delta = wait_for(rx, "delta").await;
        assert_eq!(delta["delta"]["kind"], "battleOpened");
        let state = lock_or_recover(registry)["alice@bar:443"].state.clone();
        let state = lock_or_recover(&state);
        state
            .battles
            .values()
            .find(|battle| battle.tachyon_id.as_deref() == Some("lobby-a"))
            .expect("the lobby was not listed")
            .id
    }

    /// The reduction is tested a frame at a time in [`crate::tachyon_room`].
    /// This is the wiring: a queued join reaches the server as `lobby/join`, its
    /// answer reaches the state, and the members it named by id alone are
    /// subscribed to.
    #[tokio::test]
    async fn joining_a_lobby_asks_the_server_and_folds_what_comes_back() {
        let (seen_tx, mut seen_rx) = mpsc::unbounded_channel::<String>();
        let url = lobby_server(
            seen_tx,
            json!({ "type": "response", "status": "success", "data": lobby_details() }),
        )
        .await;
        let registry = Registry::default();
        let mut rx = connect(&registry, "alice@bar:443", &url).await;
        let handle = listed_handle(&registry, &mut rx).await;

        sender(&registry, "alice@bar:443")
            .send(Outbound::Tachyon(TachyonAction::JoinLobby {
                battle: handle,
            }))
            .unwrap();

        let frame = wait_for_sent(&mut seen_rx, "lobby/join").await;
        assert_eq!(frame["data"]["id"], "lobby-a");
        loop {
            let delta = wait_for(&mut rx, "delta").await;
            if delta["delta"]["kind"] == "enteredBattle" {
                assert_eq!(delta["delta"]["id"], handle);
                break;
            }
        }

        let held = lock_or_recover(&registry)["alice@bar:443"].state.clone();
        {
            let state = lock_or_recover(&held);
            assert_eq!(state.current_battle, Some(handle));
            let battle = &state.battles[&handle];
            // The list's own field survived the join, and the roster arrived.
            assert_eq!(battle.max_players, 16);
            assert_eq!(battle.members.len(), 2);
        }

        // Nobody in the lobby has a name yet, so both ids are asked about.
        let frame = wait_for_sent(&mut seen_rx, "user/subscribeUpdates").await;
        assert_eq!(frame["data"]["userIds"], json!(["1", "2"]));
    }

    #[tokio::test]
    async fn a_refused_join_says_why_rather_than_failing_silently() {
        let (seen_tx, _seen_rx) = mpsc::unbounded_channel::<String>();
        let url = lobby_server(
            seen_tx,
            json!({ "type": "response", "status": "failed", "reason": "lobby_full" }),
        )
        .await;
        let registry = Registry::default();
        let mut rx = connect(&registry, "alice@bar:443", &url).await;
        let handle = listed_handle(&registry, &mut rx).await;

        sender(&registry, "alice@bar:443")
            .send(Outbound::Tachyon(TachyonAction::JoinLobby {
                battle: handle,
            }))
            .unwrap();

        let delta = loop {
            let delta = wait_for(&mut rx, "delta").await;
            if delta["delta"]["kind"] == "joinBattleFailed" {
                break delta;
            }
        };
        assert_eq!(delta["delta"]["reason"], "The battle is full.");
        assert_eq!(
            lock_or_recover(&lock_or_recover(&registry)["alice@bar:443"].state).current_battle,
            None
        );
    }

    #[tokio::test]
    async fn leaving_a_lobby_asks_the_server_and_clears_the_room() {
        let (seen_tx, mut seen_rx) = mpsc::unbounded_channel::<String>();
        // The same answer serves both requests: `lobby/join` reads the data and
        // `lobby/leave` has none to read.
        let url = lobby_server(
            seen_tx,
            json!({ "type": "response", "status": "success", "data": lobby_details() }),
        )
        .await;
        let registry = Registry::default();
        let mut rx = connect(&registry, "alice@bar:443", &url).await;
        let handle = listed_handle(&registry, &mut rx).await;
        let sender = sender(&registry, "alice@bar:443");

        sender
            .send(Outbound::Tachyon(TachyonAction::JoinLobby {
                battle: handle,
            }))
            .unwrap();
        wait_for_sent(&mut seen_rx, "lobby/join").await;
        loop {
            if wait_for(&mut rx, "delta").await["delta"]["kind"] == "enteredBattle" {
                break;
            }
        }

        sender
            .send(Outbound::Tachyon(TachyonAction::LeaveLobby))
            .unwrap();
        wait_for_sent(&mut seen_rx, "lobby/leave").await;

        let state = lock_or_recover(&registry)["alice@bar:443"].state.clone();
        // The room is cleared on the connection task, so wait for the delta that
        // says so rather than reading the state straight away.
        loop {
            wait_for(&mut rx, "delta").await;
            if lock_or_recover(&state).current_battle.is_none() {
                break;
            }
        }
        assert!(lock_or_recover(&state).battles[&handle].members.is_empty());
    }

    /// The `user/self` event that tells the connection we are alice, user 1,
    /// which is the first player in [`lobby_details`].
    fn self_frame() -> Message {
        Message::text(
            json!({
                "type": "event",
                "messageId": "0",
                "commandId": "user/self",
                "data": { "user": {
                    "userId": "1",
                    "username": "alice",
                    "displayName": "Alice",
                    "clanBaseData": null,
                    "status": "menu",
                    "party": null,
                    "invitedToParties": [],
                    "friendIds": [],
                    "outgoingFriendRequest": [],
                    "incomingFriendRequest": [],
                    "ignoreIds": [],
                    "currentLobby": null,
                    "clanInvites": [],
                    "matchmaking": { "state": "no_matchmaking" },
                } },
            })
            .to_string(),
        )
    }

    /// A seat control's push moving us to the second ally team, reaching the
    /// server through the same path a click does.
    ///
    /// A full ally team is the one refusal the room can still do something
    /// about, so this proves the fallback: the seat request is refused and a
    /// queue place is asked for instead, without the user clicking again.
    #[tokio::test]
    async fn a_seat_request_refused_for_a_full_ally_team_asks_for_a_queue_place() {
        let (seen_tx, mut seen_rx) = mpsc::unbounded_channel::<String>();
        let url = serve(move |mut ws| async move {
            // The list first, so the first delta is the one `listed_handle`
            // waits for.
            ws.send(list_reset()).await.unwrap();
            ws.send(self_frame()).await.unwrap();
            while let Some(Ok(msg)) = ws.next().await {
                let Message::Text(text) = msg else { continue };
                let _ = seen_tx.send(text.to_string());
                let request: Value = serde_json::from_str(&text).unwrap();
                let mut response = match request["commandId"].as_str() {
                    Some("lobby/join") => {
                        json!({ "type": "response", "status": "success", "data": lobby_details() })
                    }
                    Some("lobby/joinAllyTeam") => {
                        json!({ "type": "response", "status": "failed", "reason": "ally_team_full" })
                    }
                    _ => json!({ "type": "response", "status": "success" }),
                };
                let body = response.as_object_mut().unwrap();
                body.insert("messageId".into(), request["messageId"].clone());
                body.insert("commandId".into(), request["commandId"].clone());
                ws.send(Message::text(response.to_string())).await.unwrap();
            }
        })
        .await;
        let registry = Registry::default();
        let mut rx = connect(&registry, "alice@bar:443", &url).await;
        let handle = listed_handle(&registry, &mut rx).await;
        let sender = sender(&registry, "alice@bar:443");

        sender
            .send(Outbound::Tachyon(TachyonAction::JoinLobby {
                battle: handle,
            }))
            .unwrap();
        wait_for_sent(&mut seen_rx, "lobby/join").await;
        loop {
            if wait_for(&mut rx, "delta").await["delta"]["kind"] == "enteredBattle" {
                break;
            }
        }

        // Alice sits on the first ally team, so ally 1 is a move.
        sender
            .send(Outbound::Tachyon(TachyonAction::Room(
                crate::tachyon_room::RoomAction::OwnStatus(coilbox_lobby_protocol::BattleStatus {
                    ready: true,
                    team_id: 0,
                    ally: 1,
                    mode: true,
                    handicap: 0,
                    sync: 1,
                    side: 0,
                }),
            )))
            .unwrap();

        let frame = wait_for_sent(&mut seen_rx, "lobby/joinAllyTeam").await;
        assert_eq!(frame["data"]["allyTeam"], "02");
        wait_for_sent(&mut seen_rx, "lobby/joinQueue").await;
    }

    /// The `user/updated` that gives user 2 a name, so a message from them
    /// lands under it rather than under the id.
    fn bob_frame() -> Message {
        Message::text(
            json!({
                "type": "event",
                "messageId": "0",
                "commandId": "user/updated",
                "data": { "users": [
                    { "userId": "2", "username": "bob", "status": "menu" },
                ] },
            })
            .to_string(),
        )
    }

    /// A `messaging/received` from user 2.
    fn chat_frame() -> Message {
        Message::text(
            json!({
                "type": "event",
                "messageId": "3",
                "commandId": "messaging/received",
                "data": {
                    "message": "are you playing",
                    "source": { "type": "player", "userId": "2" },
                    "timestamp": 1_705_432_698_000_000_i64,
                    "marker": "m-2",
                },
            })
            .to_string(),
        )
    }

    /// The chat reduction is tested a frame at a time in
    /// [`crate::tachyon_messaging`]. This is the wiring: a real message off a
    /// real socket reaches the thread, and the marker it carried is kept for the
    /// next connection to resume from.
    #[tokio::test]
    async fn a_direct_message_off_the_socket_reaches_its_thread_and_leaves_a_marker() {
        let url = serve(move |mut ws| async move {
            ws.send(self_frame()).await.unwrap();
            ws.send(bob_frame()).await.unwrap();
            ws.send(chat_frame()).await.unwrap();
            std::future::pending::<()>().await;
        })
        .await;
        let registry = Registry::default();
        let markers = TachyonMarkers::default();
        let mut rx = connect_with(&registry, "alice@bar:443", &url, markers.clone()).await;

        let state = loop {
            wait_for(&mut rx, "delta").await;
            let state = lock_or_recover(&registry)["alice@bar:443"].state.clone();
            if lock_or_recover(&state).dms.contains_key("bob") {
                break state;
            }
        };
        let state = lock_or_recover(&state);
        assert_eq!(state.dms["bob"][0].text, "are you playing");
        assert_eq!(state.dms["bob"][0].from, "bob");
        assert_eq!(
            lock_or_recover(&markers).get("alice@bar:443").cloned(),
            Some("m-2".into())
        );
    }

    /// A reconnect asks the server to replay from where the last one got to.
    #[tokio::test]
    async fn the_connection_subscribes_to_chat_from_the_marker_it_was_given() {
        let (seen_tx, mut seen_rx) = mpsc::unbounded_channel::<String>();
        let url = serve(move |mut ws| async move {
            while let Some(Ok(msg)) = ws.next().await {
                if let Message::Text(text) = msg {
                    let _ = seen_tx.send(text.to_string());
                }
            }
        })
        .await;
        let markers = TachyonMarkers::default();
        lock_or_recover(&markers).insert("alice@bar:443".into(), "m-1".into());
        let mut rx = connect_with(&Registry::default(), "alice@bar:443", &url, markers).await;
        wait_for(&mut rx, "phase").await;

        let frame = wait_for_sent(&mut seen_rx, "messaging/subscribeReceived").await;
        assert_eq!(
            frame["data"]["since"],
            json!({ "type": "marker", "value": "m-1" })
        );
    }

    /// A server that names us and bob, then answers `messaging/send` with
    /// `answer`, reporting every frame it reads.
    async fn chat_server(seen: mpsc::UnboundedSender<String>, answer: Value) -> String {
        serve(move |mut ws| async move {
            ws.send(self_frame()).await.unwrap();
            ws.send(bob_frame()).await.unwrap();
            while let Some(Ok(msg)) = ws.next().await {
                let Message::Text(text) = msg else { continue };
                let _ = seen.send(text.to_string());
                let request: Value = serde_json::from_str(&text).unwrap();
                let mut response = if request["commandId"] == "messaging/send" {
                    answer.clone()
                } else {
                    json!({ "type": "response", "status": "success" })
                };
                let body = response.as_object_mut().unwrap();
                body.insert("messageId".into(), request["messageId"].clone());
                body.insert("commandId".into(), request["commandId"].clone());
                ws.send(Message::text(response.to_string())).await.unwrap();
            }
        })
        .await
    }

    /// The thread `dms` holds for `peer`, once it has something in it.
    async fn thread_for(
        registry: &Registry,
        rx: &mut mpsc::UnboundedReceiver<Value>,
        peer: &str,
    ) -> Vec<coilbox_lobby_protocol::ChatMsg> {
        loop {
            wait_for(rx, "delta").await;
            let state = lock_or_recover(registry)["alice@bar:443"].state.clone();
            let thread = lock_or_recover(&state).dms.get(peer).cloned();
            if let Some(thread) = thread.filter(|thread| !thread.is_empty()) {
                return thread;
            }
        }
    }

    #[tokio::test]
    async fn sending_a_direct_message_asks_the_server_and_records_what_it_took() {
        let (seen_tx, mut seen_rx) = mpsc::unbounded_channel::<String>();
        let url = chat_server(seen_tx, json!({ "type": "response", "status": "success" })).await;
        let registry = Registry::default();
        let mut rx = connect(&registry, "alice@bar:443", &url).await;
        wait_for(&mut rx, "phase").await;

        sender(&registry, "alice@bar:443")
            .send(Outbound::Tachyon(TachyonAction::Say {
                conversation: Conversation::Peer("bob".into()),
                text: "hello".into(),
            }))
            .unwrap();

        let frame = wait_for_sent(&mut seen_rx, "messaging/send").await;
        assert_eq!(
            frame["data"],
            json!({ "target": { "type": "player", "userId": "2" }, "message": "hello" })
        );

        let thread = thread_for(&registry, &mut rx, "bob").await;
        assert_eq!(thread[0].from, "alice");
        assert_eq!(thread[0].text, "hello");
    }

    /// A message the server would not take has to be visible as one, or the
    /// user is left thinking they said something they did not.
    #[tokio::test]
    async fn a_refused_message_is_shown_as_unsent_rather_than_lost() {
        let (seen_tx, _seen_rx) = mpsc::unbounded_channel::<String>();
        let url = chat_server(
            seen_tx,
            json!({ "type": "response", "status": "failed", "reason": "invalid_target" }),
        )
        .await;
        let registry = Registry::default();
        let mut rx = connect(&registry, "alice@bar:443", &url).await;
        wait_for(&mut rx, "phase").await;

        sender(&registry, "alice@bar:443")
            .send(Outbound::Tachyon(TachyonAction::Say {
                conversation: Conversation::Peer("bob".into()),
                text: "hello".into(),
            }))
            .unwrap();

        let thread = thread_for(&registry, &mut rx, "bob").await;
        assert_eq!(thread.len(), 1);
        assert_eq!(thread[0].kind, coilbox_lobby_protocol::ChatKind::System);
        assert!(
            thread[0].text.contains("hello"),
            "the message was lost: {}",
            thread[0].text
        );
    }

    /// The limit is the schema's, so nothing longer is worth a round trip and
    /// the send budget it costs.
    #[tokio::test]
    async fn a_message_over_the_limit_never_reaches_the_server() {
        let (seen_tx, mut seen_rx) = mpsc::unbounded_channel::<String>();
        let url = chat_server(seen_tx, json!({ "type": "response", "status": "success" })).await;
        let registry = Registry::default();
        let mut rx = connect(&registry, "alice@bar:443", &url).await;
        wait_for(&mut rx, "phase").await;

        let long = "a".repeat(crate::tachyon_messaging::MESSAGE_LIMIT + 1);
        sender(&registry, "alice@bar:443")
            .send(Outbound::Tachyon(TachyonAction::Say {
                conversation: Conversation::Peer("bob".into()),
                text: long.clone(),
            }))
            .unwrap();

        let thread = thread_for(&registry, &mut rx, "bob").await;
        assert_eq!(thread[0].kind, coilbox_lobby_protocol::ChatKind::System);
        assert!(thread[0].text.contains(&long), "the message was lost");
        assert!(
            std::iter::from_fn(|| seen_rx.try_recv().ok())
                .all(|frame| !frame.contains("messaging/send")),
            "the message reached the server"
        );
    }

    #[tokio::test]
    async fn a_server_close_ends_the_connection_and_frees_its_key() {
        let url = serve(|mut ws| async move {
            ws.send(Message::Close(Some(CloseFrame {
                code: CloseCode::Policy,
                reason: Utf8Bytes::from_static("Rate limited"),
            })))
            .await
            .unwrap();
            std::future::pending::<()>().await;
        })
        .await;
        let registry = Registry::default();
        let mut rx = connect(&registry, "alice@bar:443", &url).await;

        let ev = wait_for(&mut rx, "disconnected").await;
        assert_eq!(ev["reason"], "closed with code 1008: Rate limited");
        assert!(
            !lock_or_recover(&registry).contains_key("alice@bar:443"),
            "the connection did not evict itself"
        );
    }

    /// The console drawer's send path reads the client off the registry, so a live
    /// Tachyon connection has to publish one and a request over it has to reach
    /// the server.
    #[tokio::test]
    async fn the_registry_carries_a_client_a_command_can_send_over() {
        let (seen_tx, mut seen_rx) = mpsc::unbounded_channel::<String>();
        let url = serve(move |mut ws| async move {
            while let Some(Ok(msg)) = ws.next().await {
                if let Message::Text(text) = msg {
                    let _ = seen_tx.send(text.to_string());
                }
            }
        })
        .await;
        let registry = Registry::default();
        let mut rx = connect(&registry, "alice@bar:443", &url).await;
        wait_for(&mut rx, "phase").await;

        // The subscriptions the connection sends on its own go first, so read
        // past them before asking for anything.
        wait_for_sent(&mut seen_rx, "lobby/subscribeList").await;
        wait_for_sent(&mut seen_rx, "messaging/subscribeReceived").await;

        let client = lock_or_recover(&lock_or_recover(&registry)["alice@bar:443"].tachyon)
            .clone()
            .expect("the connection published no client");
        // The answer never comes, so this is only about what left the machine.
        let asking = tokio::spawn(async move { client.request("lobby/list", None).await });

        let sent = wait_for_sent(&mut seen_rx, "lobby/list").await;
        assert_eq!(sent["type"], "request");
        asking.abort();
    }

    #[tokio::test]
    async fn a_shutdown_closes_the_socket_and_evicts_the_connection() {
        let (closed_tx, mut closed_rx) = mpsc::unbounded_channel::<()>();
        let url = serve(move |mut ws| async move {
            while let Some(Ok(msg)) = ws.next().await {
                match msg {
                    Message::Close(_) => {
                        let _ = closed_tx.send(());
                        break;
                    }
                    // Answering the connection's own subscriptions lets their
                    // tasks let go of their client handles, so the shutdown is
                    // the last one and the close is the polite kind.
                    Message::Text(text) => {
                        let request: Value = serde_json::from_str(&text).unwrap();
                        ws.send(Message::text(
                            json!({
                                "type": "response",
                                "messageId": request["messageId"],
                                "commandId": request["commandId"],
                                "status": "success",
                            })
                            .to_string(),
                        ))
                        .await
                        .unwrap();
                    }
                    _ => {}
                }
            }
            std::future::pending::<()>().await;
        })
        .await;
        let registry = Registry::default();
        let mut rx = connect(&registry, "alice@bar:443", &url).await;
        wait_for(&mut rx, "phase").await;

        let asked = tokio::time::Instant::now();
        sender(&registry, "alice@bar:443")
            .send(Outbound::Shutdown)
            .unwrap();

        tokio::time::timeout(Duration::from_secs(5), closed_rx.recv())
            .await
            .expect("the socket was never closed")
            .expect("the server task ended first");
        // Politely, rather than by waiting out the grace period. Anything still
        // holding a client handle, the registry's copy included, would show up
        // here as a shutdown that took the full two seconds.
        assert!(
            asked.elapsed() < SHUTDOWN_GRACE,
            "the shutdown waited {:?}, so something was still holding a client",
            asked.elapsed()
        );
        assert_eq!(
            wait_for(&mut rx, "disconnected").await["reason"],
            Value::Null
        );
        assert!(!lock_or_recover(&registry).contains_key("alice@bar:443"));
    }

    #[tokio::test]
    async fn a_tasserver_line_is_noted_rather_than_put_on_the_wire() {
        // The frontend fires JOIN, IGNORELIST and FRIENDLIST at every connection
        // that reaches `ready`. None of them means anything here, and sending one
        // would be a frame of nonsense to a server that closes on a bad one.
        let (seen_tx, mut seen_rx) = mpsc::unbounded_channel::<String>();
        let url = serve(move |mut ws| async move {
            while let Some(Ok(msg)) = ws.next().await {
                if let Message::Text(text) = msg {
                    let _ = seen_tx.send(text.to_string());
                }
            }
        })
        .await;
        let registry = Registry::default();
        let mut rx = connect(&registry, "alice@bar:443", &url).await;
        wait_for(&mut rx, "phase").await;

        sender(&registry, "alice@bar:443")
            .send(Outbound::Line("JOIN #main".into()))
            .unwrap();

        // Past our own subscriptions, which the console tap also reports as out.
        let console = loop {
            let event = wait_for(&mut rx, "console").await;
            if event["line"]
                .as_str()
                .is_some_and(|line| line.starts_with("not sent"))
            {
                break event;
            }
        };
        assert_eq!(console["direction"], "out");
        assert_eq!(
            console["line"],
            "not sent, this server speaks Tachyon: JOIN #main"
        );
        assert!(
            std::iter::from_fn(|| seen_rx.try_recv().ok()).all(|frame| !frame.contains("JOIN")),
            "the line reached the server"
        );
    }
}
