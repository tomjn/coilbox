//! Parties on a Tachyon connection: who is in ours, who has asked us into
//! theirs, and what the Party section asks of the server.
//!
//! Pure, in the same way as [`crate::tachyon_users`] and
//! [`crate::tachyon_friends`]: a message and a state go in, the state is updated
//! and the [`Delta`]s that moved come out. The outbound half is pure too, so the
//! request a click comes to can be read off a test rather than off a live server.
//!
//! # A party is Tachyon only
//!
//! TASServer has nothing like it, so [`LobbyState::party`] is a field that stays
//! empty there, the way `bosses` and `in_progress` stay empty on a battle. It is
//! on `LobbyState` rather than beside it because that is the one contract the
//! frontend reads, and a second one would need its own event path for no gain.
//!
//! # Ids here, names in the state
//!
//! Tachyon names a member by user id and the Party section shows people the way
//! the rest of the app does, so the ids are kept here and names are projected
//! onto the state. That is [`crate::tachyon_friends`]'s arrangement, and for the
//! same reason: a name is a rendering of an id which improves as the server says
//! who people are.
//!
//! A member the server has not named yet is shown under their user id, the same
//! fallback the battle roster and the direct message threads use, and the
//! connection subscribes to that id so a name arrives. A control that names such
//! a person still works, because [`Parties::id_of`] accepts an id the party
//! already holds.
//!
//! # Our own actions mostly produce no event
//!
//! `party/create` answers with the whole party, so that response is folded here
//! like any other frame. The other six answer with a bare success, so each
//! request carries the [`Effect`] it has once the server has taken it and the
//! connection applies that when the response arrives.

use std::collections::HashMap;

use coilbox_lobby_protocol::{Delta, LobbyState, Party};
use coilbox_tachyon_protocol::types::{PartyCreateResponse, PartyState};
use coilbox_tachyon_protocol::TachyonMessage;
use serde_json::{json, Value};

use crate::tachyon_users::{names_in, SUBSCRIBE_LIMIT};

/// The party we are in and the ones we have been asked into, by the user ids
/// Tachyon names people with, alongside every username the connection has been
/// told.
#[derive(Debug, Default)]
pub(crate) struct Parties {
    /// The party we are in.
    current: Option<PartyIds>,
    /// The parties we have been invited to, awaiting our answer.
    invites: Vec<PartyIds>,
    /// Username by user id, for everyone the connection has seen a record for.
    names: HashMap<String, String>,
}

/// One party by the user ids Tachyon names its people with, which is
/// [`coilbox_lobby_protocol::Party`] before the names are put on.
#[derive(Clone, Debug, Default, Eq, PartialEq)]
struct PartyIds {
    id: String,
    members: Vec<String>,
    invited: Vec<String>,
    max_members: u32,
}

/// What the Party section asks of the server. A person is named the way the
/// screen shows them and a party by its id, because a party has no name.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum PartyAction {
    /// Start a party of our own.
    Create,
    /// Leave the party we are in.
    Leave,
    /// Ask somebody into our party.
    Invite(String),
    /// Take up an invitation, by the id of the party that sent it.
    Accept(String),
    /// Turn down an invitation, by the id of the party that sent it.
    Decline(String),
    /// Withdraw an invitation we sent.
    CancelInvite(String),
    /// Put a member out of our party.
    Kick(String),
}

/// One Tachyon request the Party section asks for.
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct Request {
    pub command: &'static str,
    pub data: Option<Value>,
    /// What it changes once the server has taken it, for the six requests
    /// answered with a bare success. `None` for `party/create`, whose answer
    /// carries the party itself and is folded by [`reduce`].
    pub effect: Option<Effect>,
}

/// What one of our own requests changes, applied when the server answers it.
#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) enum Effect {
    /// The party we were in, which we are no longer.
    Left,
    /// Somebody we have asked in, by user id.
    Invited(String),
    /// An invitation we took up, by party id.
    Accepted(String),
    /// An invitation we turned down, by party id.
    Declined(String),
    /// An invitation we withdrew, by the user id it went to.
    Uninvited(String),
    /// A member we put out, by user id.
    Kicked(String),
}

/// Apply a Tachyon message to the party state, returning the deltas produced.
///
/// Every frame is worth folding, not only the party ones: a user record names
/// someone we hold an id for, and that is what turns an id in the member list
/// into a name.
pub(crate) fn reduce(
    parties: &mut Parties,
    state: &mut LobbyState,
    msg: &TachyonMessage,
) -> Vec<Delta> {
    for (user_id, username) in names_in(msg) {
        parties
            .names
            .insert(user_id.to_owned(), username.to_owned());
    }

    match msg {
        // Our own record carries the lot, so it replaces what we hold rather
        // than adding to it.
        TachyonMessage::UserSelfEvent(event) => {
            let me = &event.data.user;
            parties.current = me.party.as_ref().map(ids_of);
            parties.invites = me.invited_to_parties.iter().map(ids_of).collect();
        }
        TachyonMessage::PartyCreateResponse(PartyCreateResponse::Success { data, .. }) => {
            parties.current = Some(ids_of(&data.party));
        }
        TachyonMessage::PartyInvitedEvent(event) => {
            parties.put(ids_of(&event.data.party));
        }
        // The one event covers both the party we are in and one we have been
        // asked into, so it goes wherever that party id already is. An id we
        // hold nowhere is a party we are neither in nor invited to, so there is
        // nothing it could update.
        TachyonMessage::PartyUpdatedEvent(event) => {
            let party = ids_of(&event.data);
            if parties
                .current
                .as_ref()
                .is_some_and(|held| held.id == party.id)
            {
                parties.current = Some(party);
            } else if parties.invites.iter().any(|held| held.id == party.id) {
                parties.put(party);
            }
        }
        TachyonMessage::PartyRemovedEvent(event) => {
            parties.drop_party(&event.data.party_id);
        }
        _ => {}
    }

    project(parties, state)
}

/// Apply what one of our own requests did, now that the server has taken it.
pub(crate) fn applied(
    parties: &mut Parties,
    state: &mut LobbyState,
    effect: &Effect,
) -> Vec<Delta> {
    match effect {
        Effect::Left => parties.current = None,
        Effect::Invited(id) => {
            if let Some(current) = parties.current.as_mut() {
                if !current.invited.contains(id) {
                    current.invited.push(id.clone());
                }
            }
        }
        // Accepting makes the party we were invited to the one we are in, and we
        // are a member of it from this moment. The server's own `party/updated`
        // says the same thing, so this is the same answer arriving sooner.
        Effect::Accepted(party_id) => {
            let Some(index) = parties.invites.iter().position(|held| held.id == *party_id) else {
                return vec![];
            };
            let mut party = parties.invites.remove(index);
            if let Some(me) = my_user_id(state) {
                party.invited.retain(|id| *id != me);
                if !party.members.contains(&me) {
                    party.members.push(me);
                }
            }
            parties.current = Some(party);
        }
        Effect::Declined(party_id) => parties.drop_party(party_id),
        Effect::Uninvited(user_id) => {
            if let Some(current) = parties.current.as_mut() {
                current.invited.retain(|id| id != user_id);
            }
        }
        Effect::Kicked(user_id) => {
            if let Some(current) = parties.current.as_mut() {
                current.members.retain(|id| id != user_id);
            }
        }
    }
    project(parties, state)
}

/// The Tachyon request one Party control comes to, or the sentence to put in
/// front of the user when it cannot be sent.
pub(crate) fn request_for(parties: &Parties, action: &PartyAction) -> Result<Request, String> {
    match action {
        // The answer carries the party, so there is nothing to apply on top of
        // it.
        PartyAction::Create => Ok(Request {
            command: "party/create",
            data: None,
            effect: None,
        }),
        PartyAction::Leave => Ok(Request {
            command: "party/leave",
            data: None,
            effect: Some(Effect::Left),
        }),
        PartyAction::Invite(name) => {
            let id = parties.id_of(name).ok_or_else(|| unknown(name))?;
            Ok(Request {
                command: "party/invite",
                data: Some(json!({ "userId": id.clone() })),
                effect: Some(Effect::Invited(id)),
            })
        }
        PartyAction::CancelInvite(name) => {
            let id = parties.id_of(name).ok_or_else(|| unknown(name))?;
            Ok(Request {
                command: "party/cancelInvite",
                data: Some(json!({ "userId": id.clone() })),
                effect: Some(Effect::Uninvited(id)),
            })
        }
        PartyAction::Kick(name) => {
            let id = parties.id_of(name).ok_or_else(|| unknown(name))?;
            Ok(Request {
                command: "party/kickMember",
                data: Some(json!({ "userId": id.clone() })),
                effect: Some(Effect::Kicked(id)),
            })
        }
        PartyAction::Accept(party_id) => Ok(Request {
            command: "party/acceptInvite",
            data: Some(json!({ "partyId": party_id })),
            effect: Some(Effect::Accepted(party_id.clone())),
        }),
        PartyAction::Decline(party_id) => Ok(Request {
            command: "party/declineInvite",
            data: Some(json!({ "partyId": party_id })),
            effect: Some(Effect::Declined(party_id.clone())),
        }),
    }
}

/// What to say when a control names somebody the connection holds no user id
/// for, which is the one thing that stops a party request being sent at all.
fn unknown(name: &str) -> String {
    format!("Coilbox has not been told who {name} is on this server.")
}

/// The user ids a party message named that we cannot put a name to, so the
/// connection can ask the server who they are.
///
/// Message driven, like the sender of a direct message, so an id is asked about
/// once when it arrives rather than on every frame while the answer is on its
/// way. The ids `user/self` names are already asked for by
/// [`crate::tachyon_users::ids_to_subscribe`].
pub(crate) fn ids_to_subscribe(parties: &Parties, msg: &TachyonMessage) -> Vec<String> {
    let party = match msg {
        TachyonMessage::PartyInvitedEvent(event) => Some(ids_of(&event.data.party)),
        TachyonMessage::PartyUpdatedEvent(event) => Some(ids_of(&event.data)),
        TachyonMessage::PartyCreateResponse(PartyCreateResponse::Success { data, .. }) => {
            Some(ids_of(&data.party))
        }
        // A party that has gone takes nobody's name with it.
        _ => None,
    };
    let Some(party) = party else {
        return vec![];
    };

    let mut wanted: Vec<String> = Vec::new();
    for id in party.members.into_iter().chain(party.invited) {
        if !parties.names.contains_key(&id) && !wanted.contains(&id) {
            wanted.push(id);
        }
        if wanted.len() == SUBSCRIBE_LIMIT {
            break;
        }
    }
    wanted
}

impl Parties {
    /// The user id we hold for the way a control names a person, which is their
    /// username, or their user id for somebody the party shows as a number
    /// because the server has not named them.
    fn id_of(&self, shown: &str) -> Option<String> {
        if let Some((id, _)) = self.names.iter().find(|(_, known)| *known == shown) {
            return Some(id.clone());
        }
        self.people()
            .any(|id| id == shown)
            .then(|| shown.to_owned())
    }

    /// Every user id the parties we hold name, members and invitees alike.
    fn people(&self) -> impl Iterator<Item = &str> {
        self.current
            .iter()
            .chain(self.invites.iter())
            .flat_map(|party| {
                party
                    .members
                    .iter()
                    .chain(party.invited.iter())
                    .map(String::as_str)
            })
    }

    /// What to show for a user id: their username, or the id itself for someone
    /// we have not been told about.
    fn name_of(&self, id: &str) -> String {
        self.names.get(id).cloned().unwrap_or_else(|| id.to_owned())
    }

    /// File an invitation, replacing the one we hold for the same party so a
    /// party that changes while we think about it does not appear twice.
    fn put(&mut self, party: PartyIds) {
        match self.invites.iter_mut().find(|held| held.id == party.id) {
            Some(held) => *held = party,
            None => self.invites.push(party),
        }
    }

    /// Forget a party, whether it is the one we are in or one we were asked
    /// into.
    fn drop_party(&mut self, party_id: &str) {
        if self
            .current
            .as_ref()
            .is_some_and(|held| held.id == party_id)
        {
            self.current = None;
        }
        self.invites.retain(|held| held.id != party_id);
    }
}

/// One party as Tachyon sent it, reduced to the ids we file it under.
fn ids_of(party: &PartyState) -> PartyIds {
    PartyIds {
        id: party.id.to_string(),
        members: party
            .members
            .iter()
            .map(|m| m.user_id.to_string())
            .collect(),
        invited: party
            .invited
            .iter()
            .map(|i| i.user_id.to_string())
            .collect(),
        // The schema caps this well below what a u32 holds, so a value that will
        // not fit is not a number of members and is better shown as none.
        max_members: u32::try_from(party.max_members.get()).unwrap_or(0),
    }
}

/// Our own user id, which is the member accepting an invitation adds.
///
/// `user/self` is the only thing that sets `my_username`, and it files our own
/// record in `users` in the same breath, so a name here has a record behind it.
fn my_user_id(state: &LobbyState) -> Option<String> {
    let name = state.my_username.as_deref()?;
    state.users.get(name).map(|user| user.user_id.clone())
}

/// Write the party and the invitations onto the state as names, reporting
/// whether either moved.
///
/// One delta covers both, because they are one section on screen and the
/// frontend refreshes the whole state from it either way.
fn project(parties: &Parties, state: &mut LobbyState) -> Vec<Delta> {
    let named = |party: &PartyIds| Party {
        id: party.id.clone(),
        members: party.members.iter().map(|id| parties.name_of(id)).collect(),
        invited: party.invited.iter().map(|id| parties.name_of(id)).collect(),
        max_members: party.max_members,
    };

    let current = parties.current.as_ref().map(&named);
    let invites: Vec<Party> = parties.invites.iter().map(&named).collect();
    if state.party == current && state.party_invites == invites {
        return vec![];
    }
    state.party = current;
    state.party_invites = invites;
    vec![Delta::PartyChanged]
}

#[cfg(test)]
mod tests;
