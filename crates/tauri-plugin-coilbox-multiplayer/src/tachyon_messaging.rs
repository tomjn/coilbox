//! Chat on a Tachyon connection: direct messages and the lobby's own chat.
//!
//! Pure, in the same way as [`crate::tachyon_users`] and [`crate::tachyon_room`]:
//! a message and a state go in, the state is updated and the [`Delta`]s that
//! moved come out. The outbound half is pure too, so the request a chat send
//! comes to can be read off a test rather than off a live server.
//!
//! # Three targets, two of which we have a caller for
//!
//! `messaging/send` addresses a player, a party or a lobby, and there are no
//! named channels. Upstream means that, so this maps a player onto
//! [`LobbyState::dms`] and a lobby onto the joined battle's chat, and nothing
//! onto a channel. The party target has no caller because parties are not built
//! yet, so it is left out rather than written blind.
//!
//! # Naming the person a message came from
//!
//! Tachyon names a sender by user id and `dms` is keyed by username, and #1226
//! leaves offline users out of [`LobbyState::users`], so an id often has no name
//! yet. The thread is filed under the id, exactly as the roster files an unnamed
//! member, and the connection subscribes to that id. When the name arrives
//! [`rename_threads`] moves the thread onto it, so the conversation the user is
//! reading gains a name rather than staying a number.
//!
//! Replying is the one thing that needs the name: `messaging/send` names the
//! target by id, and an id we hold no record for is an id we cannot check is
//! online. The server delivers to online users only, so a send to someone we
//! cannot see is refused here with a reason rather than sent to be dropped.
//!
//! # Our own messages
//!
//! A sent message is recorded once its response comes back, so a message the
//! server refused is never shown as sent. A `messaging/received` whose source is
//! our own user id is dropped, which covers both a server that echoes lobby chat
//! to the whole lobby and a marker replay that carries our own lines back.

use coilbox_lobby_protocol::{push_chat, push_dm, ChatKind, ChatMsg, Delta, LobbyState};
use coilbox_tachyon_protocol::types::MessagingReceivedEventDataSource as Source;
use coilbox_tachyon_protocol::TachyonMessage;
use serde_json::{json, Value};

/// The most characters `messaging/send` accepts, from the schema. A longer
/// message is refused with `message_too_long`, so it is caught here instead and
/// never leaves the machine.
pub(crate) const MESSAGE_LIMIT: usize = 512;

/// Which conversation a message belongs to.
#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) enum Conversation {
    /// A direct message thread, under the key [`LobbyState::dms`] files it by.
    Peer(String),
    /// The lobby we are in, which is the battle room's chat.
    Lobby,
}

/// Why a message never left the machine.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum Refusal {
    /// Longer than the schema allows.
    TooLong,
    /// Nobody we can name, so nobody we can address by id.
    UnknownPeer,
    /// Lobby chat with no lobby to send it to.
    NotInLobby,
}

impl Refusal {
    /// Why, in words the user can act on.
    pub(crate) fn text(self) -> String {
        match self {
            Self::TooLong => format!("It is longer than {MESSAGE_LIMIT} characters."),
            Self::UnknownPeer => {
                "This server delivers to people who are online, and that person is not.".to_owned()
            }
            Self::NotInLobby => "You are not in a lobby.".to_owned(),
        }
    }
}

/// The `messaging/send` body one chat send comes to, or why it is not being
/// sent at all.
pub(crate) fn send_request(
    state: &LobbyState,
    conversation: &Conversation,
    text: &str,
) -> Result<Value, Refusal> {
    if text.chars().count() > MESSAGE_LIMIT {
        return Err(Refusal::TooLong);
    }
    let target = match conversation {
        Conversation::Peer(peer) => {
            let user = state.users.get(peer).ok_or(Refusal::UnknownPeer)?;
            json!({ "type": "player", "userId": user.user_id })
        }
        Conversation::Lobby => {
            if state.current_battle.is_none() {
                return Err(Refusal::NotInLobby);
            }
            json!({ "type": "lobby" })
        }
    };
    Ok(json!({ "target": target, "message": text }))
}

/// The `messaging/subscribeReceived` body, resuming from `marker` when we have
/// one from an earlier connection to this server.
///
/// The marker is opaque, so it is passed back exactly as the server gave it.
/// Without one the subscription starts at the latest message rather than at the
/// start of history, because a first connection has no gap to fill.
pub(crate) fn subscribe_request(marker: Option<&str>) -> Value {
    match marker {
        Some(marker) => json!({ "since": { "type": "marker", "value": marker } }),
        None => json!({ "since": { "type": "latest" } }),
    }
}

/// Apply a Tachyon message to the chat state, returning the deltas produced.
///
/// Messages that are not chat produce nothing, so the connection can hand every
/// frame it receives to this.
pub(crate) fn reduce(state: &mut LobbyState, msg: &TachyonMessage, now_ms: u64) -> Vec<Delta> {
    let TachyonMessage::MessagingReceivedEvent(event) = msg else {
        return vec![];
    };
    let data = &event.data;
    let mine: Option<String> = my_user_id(state).map(str::to_owned);
    // The server timestamps a message when it takes it, which beats our receive
    // time, the only thing the line protocol has. A timestamp we cannot read
    // falls back to now, so the line sits on today rather than at the epoch.
    let at = match millis(data.timestamp.0) {
        0 => now_ms,
        at => at,
    };

    match &data.source {
        Source::Player { user_id } => {
            if mine.as_deref() == Some(user_id.as_str()) {
                return vec![];
            }
            let peer = name_for(state, user_id);
            push_dm(
                state,
                &peer,
                ChatMsg {
                    channel: None,
                    from: peer.clone(),
                    text: data.message.clone(),
                    kind: ChatKind::Private,
                    at,
                    id: None,
                },
            )
        }
        Source::Lobby { lobby_id, user_id } => {
            if mine.as_deref() == Some(user_id.as_str()) {
                return vec![];
            }
            // A lobby we are not in has no chat surface, and a line from one
            // would read as though it came from the room on screen.
            let Some(channel) = lobby_channel(state, Some(lobby_id)) else {
                return vec![];
            };
            let from = name_for(state, user_id);
            let msg = ChatMsg {
                channel: Some(channel.clone()),
                from,
                text: data.message.clone(),
                kind: ChatKind::SaidBattle,
                at,
                id: None,
            };
            push_chat(state, &channel, msg)
        }
        // Parties are not built, so there is no conversation to put this in and
        // nowhere it would be read. Dropped rather than filed somewhere wrong.
        Source::Party { .. } => vec![],
    }
}

/// The history marker a chat message carries, which is where a later connection
/// asks the server to resume from.
pub(crate) fn marker_of(msg: &TachyonMessage) -> Option<&str> {
    match msg {
        TachyonMessage::MessagingReceivedEvent(event) => Some(&event.data.marker),
        _ => None,
    }
}

/// The sender of a direct message that [`LobbyState::users`] cannot name, so the
/// connection can ask the server who they are.
///
/// Direct messages only. A lobby's senders are its roster, which joining already
/// subscribed to, and a subscription per lobby line would spend the connection's
/// send budget asking for names we hold.
pub(crate) fn sender_to_subscribe(state: &LobbyState, msg: &TachyonMessage) -> Option<String> {
    let TachyonMessage::MessagingReceivedEvent(event) = msg else {
        return None;
    };
    let Source::Player { user_id } = &event.data.source else {
        return None;
    };
    let known = state.users.values().any(|user| user.user_id == **user_id);
    (!known).then(|| user_id.to_string())
}

/// Move a direct message thread filed under a user id onto the name that has
/// since arrived, and report the threads that moved.
///
/// A thread only ever sits under an id while nothing can name that id, so a
/// named thread and an id thread for one person cannot both be filling up. The
/// id thread's lines are therefore the older ones and go in front.
pub(crate) fn rename_threads(state: &mut LobbyState) -> Vec<Delta> {
    let keys: Vec<String> = state.dms.keys().cloned().collect();
    let mut deltas = Vec::new();
    for key in keys {
        // A thread already under a name is a thread already named, whatever
        // else that string might be an id for.
        if state.users.contains_key(&key) {
            continue;
        }
        let Some(name) = state
            .users
            .values()
            .find(|user| user.user_id == key)
            .map(|user| user.name.clone())
        else {
            continue;
        };
        let Some(mut thread) = state.dms.remove(&key) else {
            continue;
        };
        let named = state.dms.entry(name.clone()).or_default();
        thread.append(named);
        *named = thread;
        deltas.push(Delta::PrivateMessage { from: name });
    }
    deltas
}

/// Put a message we sent into its conversation, now that the server has taken
/// it.
pub(crate) fn record_sent(
    state: &mut LobbyState,
    conversation: &Conversation,
    text: &str,
    now_ms: u64,
) -> Vec<Delta> {
    let me = state.my_username.clone().unwrap_or_default();
    match conversation {
        Conversation::Peer(peer) => push_dm(
            state,
            peer,
            ChatMsg {
                channel: None,
                from: me,
                text: text.to_owned(),
                kind: ChatKind::Private,
                at: now_ms,
                id: None,
            },
        ),
        Conversation::Lobby => match lobby_channel(state, None) {
            Some(channel) => {
                let msg = ChatMsg {
                    channel: Some(channel.clone()),
                    from: me,
                    text: text.to_owned(),
                    kind: ChatKind::SaidBattle,
                    at: now_ms,
                    id: None,
                };
                push_chat(state, &channel, msg)
            }
            // We left between pressing send and the answer, so the room the
            // line belongs to is gone.
            None => vec![gone(text, "You have left the lobby.")],
        },
    }
}

/// Note in the conversation that a message did not go out, carrying the text so
/// the user still has it.
///
/// It goes where the message would have gone, rather than into a toast, because
/// that is where the user is looking and where the gap in the conversation is.
pub(crate) fn record_not_sent(
    state: &mut LobbyState,
    conversation: &Conversation,
    text: &str,
    why: &str,
    now_ms: u64,
) -> Vec<Delta> {
    let note = ChatMsg {
        channel: None,
        // A notice has no sender: it is rendered as a centred line rather than
        // as someone's message.
        from: String::new(),
        text: format!("Not sent. {why} The message was: {text}"),
        kind: ChatKind::System,
        at: now_ms,
        id: None,
    };
    match conversation {
        Conversation::Peer(peer) => push_dm(state, peer, note),
        Conversation::Lobby => match lobby_channel(state, None) {
            Some(channel) => {
                let note = ChatMsg {
                    channel: Some(channel.clone()),
                    ..note
                };
                push_chat(state, &channel, note)
            }
            None => vec![gone(text, why)],
        },
    }
}

/// Tell the user about a lobby message with no lobby left to hold it.
fn gone(text: &str, why: &str) -> Delta {
    Delta::ServerMessage {
        text: format!("Not sent. {why} The message was: {text}"),
        boxed: false,
    }
}

/// The channel bucket the joined lobby's chat lives in, when `lobby_id` names
/// the lobby we are in. `None` for `lobby_id` accepts whichever lobby that is.
fn lobby_channel(state: &LobbyState, lobby_id: Option<&str>) -> Option<String> {
    let battle = state.battles.get(&state.current_battle?)?;
    if lobby_id.is_some_and(|id| battle.tachyon_id.as_deref() != Some(id)) {
        return None;
    }
    battle.channel.clone()
}

/// The name to show for a user id, falling back to the id itself for someone
/// [`LobbyState::users`] cannot name yet. The same fallback the roster uses.
fn name_for(state: &LobbyState, id: &str) -> String {
    state
        .users
        .values()
        .find(|user| user.user_id == id)
        .map_or_else(|| id.to_owned(), |user| user.name.clone())
}

/// Our own user id, which is what tells our own messages apart from everyone
/// else's.
fn my_user_id(state: &LobbyState) -> Option<&str> {
    let name = state.my_username.as_deref()?;
    state.users.get(name).map(|user| user.user_id.as_str())
}

/// A Tachyon timestamp, which is microseconds, as the milliseconds [`ChatMsg`]
/// holds. A time before the epoch is not a time a message was sent.
fn millis(micros: i64) -> u64 {
    u64::try_from(micros / 1000).unwrap_or(0)
}

#[cfg(test)]
mod tests;
