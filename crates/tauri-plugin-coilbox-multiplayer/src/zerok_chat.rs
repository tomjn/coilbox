//! Zero-K's chat: channels, the battle room, direct messages, friends and
//! ignores.
//!
//! The Zero-K counterpart of [`crate::tachyon_messaging`] and
//! [`crate::tachyon_friends`] in one module, because on this protocol they are
//! one subject: what somebody has flagged you as is what decides whether their
//! chat reaches you.
//!
//! # One command each way
//!
//! Everything anybody says travels as `Say`, in both directions. `Place` is what
//! decides whether it is a channel, a battle room, a direct message or a server
//! notice, and it comes from upstream's own enum rather than being invented
//! here.
//!
//! The server relays our own `Say` back to us, private ones included, so nothing
//! is recorded locally when it goes out. Doing that as well would double every
//! line we sent. That is the opposite of the TASServer path, where the server
//! does not echo a private message and the connection has to record its own.
//!
//! # Relations are one-sided and the server owns the list
//!
//! Zero-K has no friend request. `SetAccountRelation` sets what you have flagged
//! somebody as, the server answers with a fresh `FriendList` or `IgnoreList`,
//! and nothing here is edited locally: showing a friend the server rejected
//! would be worse than a moment's lag.

use coilbox_lobby_protocol::{
    push_chat, push_dm, ChannelState, ChatKind, ChatMsg, Delta, LobbyState,
};
use coilbox_zerok_protocol::types::{self, Relation, SayPlace};
use coilbox_zerok_protocol::ZerokMessage;

/// The bucket battle chat is filed in, which is what the chat surface reads a
/// battle conversation out of.
///
/// TASServer auto-joins a real channel of this name and Zero-K has no such
/// thing, so the name is built rather than told to us. It is the same shape
/// either way, which is what lets one chat screen show both.
pub(crate) fn battle_channel(id: u32) -> String {
    format!("__battle__{id}")
}

/// Something a chat control asks of a Zero-K connection.
pub(crate) enum ChatAction {
    /// Say something in a channel, in the battle room, or to one person.
    Say {
        place: Place,
        /// Whether this is a `/me` action rather than a plain line.
        emote: bool,
        text: String,
    },
    JoinChannel {
        channel: String,
        password: Option<String>,
    },
    LeaveChannel {
        channel: String,
    },
    /// Flag somebody as a friend, as ignored, or as neither.
    Relation {
        username: String,
        relation: Relation,
    },
}

/// Where a line is going. Narrower than [`SayPlace`], which also names places
/// only the server sends from.
pub(crate) enum Place {
    Channel(String),
    Battle,
    Peer(String),
}

/// What [`reduce`] produced: the state changes to tell the frontend about, and
/// the commands the connection has to send in answer.
pub(crate) type Reduced = (Vec<Delta>, Vec<ChatAction>);

/// Apply a Zero-K message to the lobby state.
///
/// `now_ms` stamps any chat message created. Zero-K puts a `Time` on a `Say` and
/// it is not read: it is the server's clock, the rest of coilbox stamps a line
/// when it arrives, and mixing the two would sort a backlog against live chat by
/// two different clocks.
pub(crate) fn reduce(state: &mut LobbyState, msg: &ZerokMessage, now_ms: u64) -> Reduced {
    match msg {
        ZerokMessage::Say(say) => (said(state, say, now_ms), vec![]),
        ZerokMessage::ChannelHeader(header) => (
            put_channel(state, header.channel_name.as_deref(), Some(header)),
            vec![],
        ),
        ZerokMessage::JoinChannelResponse(response) => joined_channel(state, response),
        ZerokMessage::ChannelUserAdded(added) => (
            channel_user(
                state,
                added.channel_name.as_deref(),
                added.user_name.as_deref(),
                true,
                now_ms,
            ),
            vec![],
        ),
        ZerokMessage::ChannelUserRemoved(removed) => (
            channel_user(
                state,
                removed.channel_name.as_deref(),
                removed.user_name.as_deref(),
                false,
                now_ms,
            ),
            vec![],
        ),
        ZerokMessage::ChangeTopic(change) => (
            set_topic(state, change.channel_name.as_deref(), change.topic.as_ref()),
            vec![],
        ),
        ZerokMessage::KickFromChannel(kick) => (
            channel_user(
                state,
                kick.channel_name.as_deref(),
                kick.user_name.as_deref(),
                false,
                now_ms,
            ),
            vec![],
        ),
        // The server putting us in a channel. It expects the join to follow, so
        // the header and the membership arrive the ordinary way.
        ZerokMessage::ForceJoinChannel(force) => {
            let (Some(channel), true) = (
                named(force.channel_name.as_deref()),
                aimed_at_us(state, force.user_name.as_deref()),
            ) else {
                return (vec![], vec![]);
            };
            (
                vec![],
                vec![ChatAction::JoinChannel {
                    channel,
                    password: None,
                }],
            )
        }
        ZerokMessage::FriendList(list) => (set_friends(state, list), vec![]),
        ZerokMessage::IgnoreList(list) => (set_ignores(state, list), vec![]),
        _ => (vec![], vec![]),
    }
}

/// File one line of chat wherever its place says it belongs.
fn said(state: &mut LobbyState, say: &types::Say, now_ms: u64) -> Vec<Delta> {
    let Some(text) = say.text.clone() else {
        return vec![];
    };
    let from = say.user.clone().unwrap_or_default();

    match say.place {
        SayPlace::Channel => {
            let Some(channel) = named(say.target.as_deref()) else {
                return vec![];
            };
            push_chat(
                state,
                &channel,
                ChatMsg {
                    channel: Some(channel.clone()),
                    from,
                    text,
                    kind: kind_of(say, ChatKind::Said),
                    at: now_ms,
                    // Zero-K replays a channel's backlog as ordinary `Say`
                    // lines with nothing to mark them, so there is no id to set
                    // and no way to tell a replayed line from a live one.
                    id: None,
                },
            )
        }
        // A private message is echoed to both parties, so the thread is named
        // after whichever end is not us.
        SayPlace::User => {
            let Some(peer) = peer_of(state, say) else {
                return vec![];
            };
            push_dm(
                state,
                &peer,
                ChatMsg {
                    channel: None,
                    from,
                    text,
                    kind: kind_of(say, ChatKind::Private),
                    at: now_ms,
                    id: None,
                },
            )
        }
        // All three render as battle chat. `BattlePrivate` is the server talking
        // to one person in the room and `Game` is a line relayed out of a
        // running match, and both belong beside the room's own conversation.
        SayPlace::Battle | SayPlace::BattlePrivate | SayPlace::Game => {
            let Some(id) = state.current_battle else {
                return vec![];
            };
            let channel = battle_channel(id);
            push_chat(
                state,
                &channel,
                ChatMsg {
                    channel: Some(channel.clone()),
                    from,
                    text,
                    kind: kind_of(say, ChatKind::SaidBattle),
                    at: now_ms,
                    id: None,
                },
            )
        }
        // Not chat. A mute, a ban or an announcement, which upstream's own
        // client shows in a box rather than scrolling past.
        SayPlace::MessageBox => vec![Delta::ServerMessage { text, boxed: true }],
        // A place added upstream since the pinned commit. The line is already in
        // the protocol console, which is as much as can be done with it.
        SayPlace::Other(_) => vec![],
    }
}

/// The other end of a private message.
fn peer_of(state: &LobbyState, say: &types::Say) -> Option<String> {
    let me = state.my_username.as_deref();
    let from = say.user.as_deref();
    if me.is_some() && me == from {
        named(say.target.as_deref())
    } else {
        named(from)
    }
}

fn kind_of(say: &types::Say, plain: ChatKind) -> ChatKind {
    if say.is_emote {
        ChatKind::SaidEx
    } else {
        plain
    }
}

/// The server confirming a join, or refusing one.
fn joined_channel(state: &mut LobbyState, response: &types::JoinChannelResponse) -> Reduced {
    let Some(channel) = named(response.channel_name.as_deref()).or_else(|| {
        response
            .channel
            .as_ref()
            .and_then(|header| named(header.channel_name.as_deref()))
    }) else {
        return (vec![], vec![]);
    };

    if !response.success {
        return (
            vec![Delta::JoinChannelFailed {
                channel,
                reason: response
                    .reason
                    .clone()
                    .unwrap_or_else(|| "the server refused the channel".to_string()),
            }],
            vec![],
        );
    }
    (
        put_channel(state, Some(&channel), response.channel.as_ref()),
        vec![],
    )
}

/// Create or update a channel from a header.
///
/// The header is a patch in the one way that matters: a member list it does not
/// carry is a list that did not change, so a header sent for a new topic alone
/// must not empty the channel.
fn put_channel(
    state: &mut LobbyState,
    channel: Option<&str>,
    header: Option<&types::ChannelHeader>,
) -> Vec<Delta> {
    let Some(channel) = named(channel) else {
        return vec![];
    };

    let fresh = !state.channels.contains_key(&channel);
    let held = state
        .channels
        .entry(channel.clone())
        .or_insert_with(|| ChannelState {
            name: channel.clone(),
            ..Default::default()
        });
    let before = held.clone();
    if let Some(header) = header {
        if let Some(users) = &header.users {
            held.users = users.iter().cloned().collect();
        }
        if let Some(topic) = header.topic.as_ref().and_then(|t| t.text.clone()) {
            held.topic = Some(topic);
        }
    }
    let changed = *held != before;

    match (fresh, changed) {
        (true, _) => vec![Delta::ChannelJoined { channel }],
        (false, true) => vec![Delta::ChannelTopicChanged { channel }],
        (false, false) => vec![],
    }
}

/// Somebody arriving in a channel or going from it.
///
/// Us going is us leaving: the channel is dropped rather than trimmed, so it
/// does not linger in the channel list as one we are still in.
fn channel_user(
    state: &mut LobbyState,
    channel: Option<&str>,
    user: Option<&str>,
    joined: bool,
    now_ms: u64,
) -> Vec<Delta> {
    let (Some(channel), Some(user)) = (named(channel), named(user)) else {
        return vec![];
    };
    if !joined && state.my_username.as_deref() == Some(user.as_str()) {
        return match state.channels.remove(&channel) {
            Some(_) => vec![Delta::ChannelLeft { channel }],
            None => vec![],
        };
    }
    let Some(held) = state.channels.get_mut(&channel) else {
        // A channel we are not in. Zero-K broadcasts membership for the ones we
        // are, so this is the tail of one we have just left.
        return vec![];
    };

    let moved = if joined {
        held.users.insert(user.clone())
    } else {
        held.users.remove(&user)
    };
    if !moved {
        return vec![];
    }
    push_chat(
        state,
        &channel,
        ChatMsg {
            channel: Some(channel.clone()),
            from: user,
            text: String::new(),
            kind: if joined {
                ChatKind::Join
            } else {
                ChatKind::Leave
            },
            at: now_ms,
            id: None,
        },
    )
}

fn set_topic(
    state: &mut LobbyState,
    channel: Option<&str>,
    topic: Option<&types::Topic>,
) -> Vec<Delta> {
    let (Some(channel), Some(text)) = (named(channel), topic.and_then(|t| t.text.clone())) else {
        return vec![];
    };
    let Some(held) = state.channels.get_mut(&channel) else {
        return vec![];
    };
    if held.topic.as_deref() == Some(text.as_str()) {
        return vec![];
    }
    held.topic = Some(text);
    vec![Delta::ChannelTopicChanged { channel }]
}

/// The friend list, which the server sends whole every time it changes.
fn set_friends(state: &mut LobbyState, list: &types::FriendList) -> Vec<Delta> {
    let friends = list
        .friends
        .iter()
        .flatten()
        .filter_map(|friend| named(friend.name.as_deref()))
        .collect();
    if state.friends == friends {
        return vec![];
    }
    state.friends = friends;
    vec![Delta::FriendsChanged]
}

/// The ignore list, sent the same way.
///
/// Carried in the delta as well as stored, because the frontend reconciles it
/// against the client-side list in one shot rather than reading it back.
fn set_ignores(state: &mut LobbyState, list: &types::IgnoreList) -> Vec<Delta> {
    state.server_ignores = list
        .ignores
        .iter()
        .flatten()
        .filter_map(|name| named(Some(name)))
        .collect();
    vec![Delta::ServerIgnoreList {
        ignores: state.server_ignores.iter().cloned().collect(),
    }]
}

/// Whether a message naming somebody is naming us. One that names nobody is
/// about everyone, so it counts.
fn aimed_at_us(state: &LobbyState, name: Option<&str>) -> bool {
    match (name, state.my_username.as_deref()) {
        (None, _) => true,
        (Some(name), Some(me)) => name == me,
        (Some(_), None) => false,
    }
}

fn named(name: Option<&str>) -> Option<String> {
    name.map(str::trim)
        .filter(|name| !name.is_empty())
        .map(str::to_owned)
}

/// The wire lines for one chat action.
///
/// Empty when there is nothing to send, which is how a battle line with no room
/// to say it in is dropped.
pub(crate) fn build(
    state: &LobbyState,
    action: &ChatAction,
) -> Result<Vec<String>, serde_json::Error> {
    Ok(match action {
        ChatAction::Say { place, emote, text } => {
            let (place, target) = match place {
                Place::Channel(channel) => (SayPlace::Channel, Some(channel.clone())),
                Place::Peer(peer) => (SayPlace::User, Some(peer.clone())),
                Place::Battle if state.current_battle.is_some() => (SayPlace::Battle, None),
                Place::Battle => return Ok(vec![]),
            };
            vec![line(&types::Say {
                place,
                target,
                text: Some(text.clone()),
                is_emote: *emote,
                // Reserved for a moderator and for the founder of a battle
                // ringing their own room. The server strips it from anybody
                // else, so setting it would be asking to be ignored.
                ring: false,
                ..types::Say::default()
            })?]
        }
        ChatAction::JoinChannel { channel, password } => vec![line(&types::JoinChannel {
            channel_name: Some(channel.clone()),
            password: password.clone().filter(|key| !key.is_empty()),
        })?],
        ChatAction::LeaveChannel { channel } => vec![line(&types::LeaveChannel {
            channel_name: Some(channel.clone()),
        })?],
        ChatAction::Relation { username, relation } => vec![line(&types::SetAccountRelation {
            relation: *relation,
            target_name: Some(username.clone()),
            // The Steam id is the other way to name an account, and coilbox
            // knows people by name.
            steam_id: None,
        })?],
    })
}

fn line<C: coilbox_zerok_protocol::Command>(command: &C) -> Result<String, serde_json::Error> {
    coilbox_zerok_protocol::line::to_line(command)
}

#[cfg(test)]
mod tests;
