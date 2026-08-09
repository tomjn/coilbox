//! Friends on a Tachyon connection: who they are, and what the Friends section
//! asks of them.
//!
//! Pure, in the same way as [`crate::tachyon_users`] and
//! [`crate::tachyon_messaging`]: a message and a state go in, the state is
//! updated and the [`Delta`]s that moved come out. The outbound half is pure
//! too, so the request a click comes to can be read off a test rather than off a
//! live server.
//!
//! # Ids here, names in the state
//!
//! Tachyon names a friend by user id and [`LobbyState::friends`] holds
//! usernames. The ids are kept here and the names are projected onto the state,
//! because every friend command names a person by id and the name is a rendering
//! of that id which improves as the server says who people are.
//!
//! # A friends list has to include the friends who are offline
//!
//! [`crate::tachyon_users`] leaves offline people out of [`LobbyState::users`],
//! so a friend id often has no name there and, for someone who never signs in
//! while we are connected, never will. A list of only the friends who happen to
//! be online is not a friends list, so the names are collected here from every
//! user record that goes past, offline ones included, and kept for the life of
//! the connection.
//!
//! An offline friend is therefore in `LobbyState::friends` under their username
//! while being absent from `LobbyState::users`. That is what the line protocol
//! does too, and the Friends section already renders such a person as offline.
//!
//! A friend we have never been told a name for is shown under their user id, the
//! same fallback the battle roster and the direct message threads use, and the
//! connection subscribes to that id so a name arrives.
//!
//! # Our own actions produce no event
//!
//! All five events report what somebody else did. Accepting a request sends us
//! nothing back but a success, so a click would otherwise leave the list
//! unchanged until the next connection. Each request therefore carries the
//! [`Effect`] it has once the server has taken it, and the connection applies
//! that when the response arrives.
//!
//! # Outgoing requests have no surface
//!
//! `LobbyState` has room for friends and for incoming requests, which is what
//! the TASServer protocol carries. Outgoing requests are tracked here anyway,
//! because the server hands them to us and because they decide what removing
//! someone means: a person we have only asked is withdrawn with
//! `friend/cancelRequest` rather than removed with `friend/remove`.

use std::collections::{BTreeSet, HashMap};

use coilbox_lobby_protocol::{Delta, LobbyState};
use coilbox_tachyon_protocol::types::FriendListResponse;
use coilbox_tachyon_protocol::TachyonMessage;
use serde_json::{json, Value};

use crate::tachyon_users::{names_in, SUBSCRIBE_LIMIT};

/// Who our friends are and who has asked, by the user ids Tachyon names them
/// with, alongside every username the connection has been told.
#[derive(Debug, Default)]
pub(crate) struct Friends {
    /// Established friendships.
    friends: BTreeSet<String>,
    /// People who have asked to be our friend, awaiting our answer.
    incoming: BTreeSet<String>,
    /// People we have asked, awaiting theirs.
    outgoing: BTreeSet<String>,
    /// Username by user id, for everyone the connection has seen a record for.
    names: HashMap<String, String>,
}

/// What the Friends section asks of the server, in the terms it speaks. It names
/// a person by username, because that is what the TASServer protocol it was
/// built for uses, so [`request_for`] translates.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum FriendAction {
    /// Ask to be someone's friend.
    Send(String),
    /// Take up a request someone sent us.
    Accept(String),
    /// Turn down a request someone sent us.
    Reject(String),
    /// End a friendship, or withdraw a request we sent.
    Remove(String),
    /// Ask the server for the lot, replacing what we hold.
    List,
}

/// One Tachyon request the Friends section asks for.
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct Request {
    pub command: &'static str,
    pub data: Option<Value>,
    /// What it changes once the server has taken it, since the person who acted
    /// is sent no event of their own.
    pub effect: Option<Effect>,
}

/// What one of our own requests changes, applied when the server answers it.
#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) enum Effect {
    /// A request we have just sent, by the user id it went to.
    Sent(String),
    /// A request we took up, which makes them a friend.
    Accepted(String),
    /// A request we turned down.
    Rejected(String),
    /// A friendship we ended, or a request we withdrew.
    Dropped(String),
}

/// Apply a Tachyon message to the friend state, returning the deltas produced.
///
/// Every frame is worth folding, not only the friend ones: a user record names
/// someone we hold an id for, and that is what turns the id in the Friends
/// section into a name.
pub(crate) fn reduce(
    friends: &mut Friends,
    state: &mut LobbyState,
    msg: &TachyonMessage,
) -> Vec<Delta> {
    for (user_id, username) in names_in(msg) {
        friends
            .names
            .insert(user_id.to_owned(), username.to_owned());
    }

    match msg {
        // Our own record carries the lot, so it replaces what we hold rather
        // than adding to it.
        TachyonMessage::UserSelfEvent(event) => {
            let me = &event.data.user;
            friends.friends = me.friend_ids.iter().cloned().collect();
            friends.incoming = me
                .incoming_friend_request
                .iter()
                .map(|r| r.from.to_string())
                .collect();
            friends.outgoing = me
                .outgoing_friend_request
                .iter()
                .map(|r| r.to.to_string())
                .collect();
        }
        TachyonMessage::FriendListResponse(FriendListResponse::Success { data, .. }) => {
            friends.friends = data.friends.iter().map(|f| f.user_id.to_string()).collect();
            friends.incoming = data
                .incoming_pending_requests
                .iter()
                .map(|r| r.from.to_string())
                .collect();
            friends.outgoing = data
                .outgoing_pending_requests
                .iter()
                .map(|r| r.to.to_string())
                .collect();
        }
        TachyonMessage::FriendRequestReceivedEvent(event) => {
            friends.incoming.insert(event.data.from.to_string());
        }
        TachyonMessage::FriendRequestCancelledEvent(event) => {
            friends.incoming.remove(&event.data.from.to_string());
        }
        TachyonMessage::FriendRequestAcceptedEvent(event) => {
            let from = event.data.from.to_string();
            friends.outgoing.remove(&from);
            friends.friends.insert(from);
        }
        // They said no. There is no outgoing surface to take it off, so the only
        // thing that changes is that removing them now means nothing to cancel.
        TachyonMessage::FriendRequestRejectedEvent(event) => {
            friends.outgoing.remove(&event.data.from.to_string());
        }
        TachyonMessage::FriendRemovedEvent(event) => {
            friends.friends.remove(&event.data.from.to_string());
        }
        _ => {}
    }

    project(friends, state)
}

/// Apply what one of our own requests did, now that the server has taken it.
pub(crate) fn applied(
    friends: &mut Friends,
    state: &mut LobbyState,
    effect: &Effect,
) -> Vec<Delta> {
    match effect {
        Effect::Sent(id) => {
            friends.outgoing.insert(id.clone());
        }
        Effect::Accepted(id) => {
            friends.incoming.remove(id);
            friends.friends.insert(id.clone());
        }
        Effect::Rejected(id) => {
            friends.incoming.remove(id);
        }
        Effect::Dropped(id) => {
            friends.friends.remove(id);
            friends.outgoing.remove(id);
        }
    }
    project(friends, state)
}

/// The Tachyon request one Friends control comes to, or the sentence to put in
/// front of the user when it cannot be sent.
///
/// Removing someone is two commands. A friendship ends with `friend/remove`, and
/// a request we sent and they have not answered is withdrawn with
/// `friend/cancelRequest`, so the same control does the right one.
pub(crate) fn request_for(friends: &Friends, action: &FriendAction) -> Result<Request, String> {
    match action {
        // The answer replaces what we hold, so there is nothing to apply on top
        // of it.
        FriendAction::List => Ok(Request {
            command: "friend/list",
            data: None,
            effect: None,
        }),
        FriendAction::Send(name) => {
            let id = friends.id_of(name).ok_or_else(|| unknown(name))?;
            Ok(Request {
                command: "friend/sendRequest",
                data: Some(json!({ "to": id.clone() })),
                effect: Some(Effect::Sent(id)),
            })
        }
        FriendAction::Accept(name) => {
            let id = friends.id_of(name).ok_or_else(|| unknown(name))?;
            Ok(Request {
                command: "friend/acceptRequest",
                data: Some(json!({ "from": id.clone() })),
                effect: Some(Effect::Accepted(id)),
            })
        }
        FriendAction::Reject(name) => {
            let id = friends.id_of(name).ok_or_else(|| unknown(name))?;
            Ok(Request {
                command: "friend/rejectRequest",
                data: Some(json!({ "from": id.clone() })),
                effect: Some(Effect::Rejected(id)),
            })
        }
        FriendAction::Remove(name) => {
            let id = friends.id_of(name).ok_or_else(|| unknown(name))?;
            let (command, data) = if friends.outgoing.contains(&id) {
                ("friend/cancelRequest", json!({ "to": id.clone() }))
            } else {
                ("friend/remove", json!({ "userId": id.clone() }))
            };
            Ok(Request {
                command,
                data: Some(data),
                effect: Some(Effect::Dropped(id)),
            })
        }
    }
}

/// What to say when a control names somebody the connection holds no user id
/// for, which is the one thing that stops a friend request being sent at all.
fn unknown(name: &str) -> String {
    format!("Coilbox has not been told who {name} is on this server.")
}

/// The user ids a friend message named that we cannot put a name to, so the
/// connection can ask the server who they are.
///
/// Message driven, like the sender of a direct message, so an id is asked about
/// once when it arrives rather than on every frame while the answer is on its
/// way. The ids `user/self` names are already asked for by
/// [`crate::tachyon_users::ids_to_subscribe`].
pub(crate) fn ids_to_subscribe(friends: &Friends, msg: &TachyonMessage) -> Vec<String> {
    let ids: Vec<String> = match msg {
        TachyonMessage::FriendRequestReceivedEvent(event) => vec![event.data.from.to_string()],
        TachyonMessage::FriendRequestAcceptedEvent(event) => vec![event.data.from.to_string()],
        TachyonMessage::FriendListResponse(FriendListResponse::Success { data, .. }) => data
            .friends
            .iter()
            .map(|f| f.user_id.to_string())
            .chain(
                data.incoming_pending_requests
                    .iter()
                    .map(|r| r.from.to_string()),
            )
            .collect(),
        // The other three events take somebody off a list, so a name for them is
        // no longer worth a subscription.
        _ => vec![],
    };

    let mut wanted: Vec<String> = Vec::new();
    for id in ids {
        if !friends.names.contains_key(&id) && !wanted.contains(&id) {
            wanted.push(id);
        }
        if wanted.len() == SUBSCRIBE_LIMIT {
            break;
        }
    }
    wanted
}

impl Friends {
    /// The user id we hold for a username, for a control that names a person the
    /// way the screen does.
    fn id_of(&self, name: &str) -> Option<String> {
        self.names
            .iter()
            .find(|(_, known)| *known == name)
            .map(|(id, _)| id.clone())
    }

    /// What to show for a user id: their username, or the id itself for someone
    /// we have not been told about.
    fn name_of(&self, id: &str) -> String {
        self.names.get(id).cloned().unwrap_or_else(|| id.to_owned())
    }
}

/// Write the friends and the incoming requests onto the state as names,
/// reporting the sets that moved.
fn project(friends: &Friends, state: &mut LobbyState) -> Vec<Delta> {
    let mut deltas = Vec::new();
    let named = |ids: &BTreeSet<String>| -> BTreeSet<String> {
        ids.iter().map(|id| friends.name_of(id)).collect()
    };

    let names = named(&friends.friends);
    if state.friends != names {
        state.friends = names;
        deltas.push(Delta::FriendsChanged);
    }
    let names = named(&friends.incoming);
    if state.friend_requests != names {
        state.friend_requests = names;
        deltas.push(Delta::FriendRequestsChanged);
    }
    deltas
}

#[cfg(test)]
mod tests;
