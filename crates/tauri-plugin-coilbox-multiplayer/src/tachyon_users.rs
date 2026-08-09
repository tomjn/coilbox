//! Folding the Tachyon user commands into [`LobbyState::users`].
//!
//! The Tachyon counterpart of the user arms of `coilbox_lobby_protocol::reduce`,
//! and pure in the same way: a message and a state go in, the state is updated
//! and the [`Delta`]s that moved come out. No socket, so it can be tested a frame
//! at a time.
//!
//! Three messages carry a user record, in three shapes the schema keeps separate
//! but which describe the same person: `user/self` carries a `privateUser`,
//! `user/info` answers with a `user`, and `user/updated` carries a list of
//! partial users. [`Fields`] is the common part of the three, so the folding is
//! written once.
//!
//! # Keys, and what happens when someone renames
//!
//! Tachyon identifies a user by id and `LobbyState::users` is keyed by name, so a
//! `user/updated` naming only an id has to find its record by id. A record that
//! comes back under a new name moves rather than leaving a second copy behind.
//!
//! # Offline users are not in `users`
//!
//! Tachyon reports offline users, because a subscription covers a person rather
//! than a session. `LobbyState::users` means the people who are online, as it
//! does on the line protocol, where the server never mentions anyone else. So a
//! record that arrives offline is dropped, and one that goes offline is removed.

use coilbox_lobby_protocol::{Delta, LobbyState};
use coilbox_tachyon_protocol::types::{
    PrivateUser, UserInfoResponse, UserUpdatedEventDataUsersItem,
};
use coilbox_tachyon_protocol::TachyonMessage;

/// The most user ids `user/subscribeUpdates` accepts, from the schema.
pub(crate) const SUBSCRIBE_LIMIT: usize = 100;

/// The part of a Tachyon user record that has a home in
/// [`coilbox_lobby_protocol::User`].
///
/// Every field but the id is optional, because `user/updated` sends only what
/// changed. `None` means "not mentioned", so the stored value stays.
struct Fields<'a> {
    user_id: &'a str,
    username: Option<&'a str>,
    country: Option<&'a str>,
    /// Whether the person is signed in at all. `Some(false)` removes the record.
    online: Option<bool>,
    ingame: Option<bool>,
    moderator: Option<bool>,
}

/// Apply a Tachyon message to the lobby state, returning the deltas produced.
///
/// Messages that carry no user record produce nothing, so the connection can
/// hand every frame it receives to this.
pub(crate) fn reduce(state: &mut LobbyState, msg: &TachyonMessage) -> Vec<Delta> {
    match msg {
        TachyonMessage::UserSelfEvent(event) => self_event(state, &event.data.user),
        TachyonMessage::UserUpdatedEvent(event) => event
            .data
            .users
            .iter()
            .filter_map(from_updated)
            .flat_map(|fields| apply(state, fields))
            .collect(),
        TachyonMessage::UserInfoResponse(UserInfoResponse::Success { data, .. }) => {
            apply(state, from_user(data))
        }
        _ => vec![],
    }
}

/// Every user id and username a message names, in the order it named them.
///
/// The three shapes that carry a user record all say who somebody is, whether or
/// not [`reduce`] keeps the record. Offline people are dropped from
/// [`LobbyState::users`] but still named here, which is what lets
/// [`crate::tachyon_friends`] show a friend who is not signed in.
pub(crate) fn names_in(msg: &TachyonMessage) -> Vec<(&str, &str)> {
    let fields: Vec<Fields<'_>> = match msg {
        TachyonMessage::UserSelfEvent(event) => vec![from_private(&event.data.user)],
        TachyonMessage::UserUpdatedEvent(event) => {
            event.data.users.iter().filter_map(from_updated).collect()
        }
        TachyonMessage::UserInfoResponse(UserInfoResponse::Success { data, .. }) => {
            vec![from_user(data)]
        }
        _ => vec![],
    };
    fields
        .into_iter()
        .filter_map(|fields| Some((fields.user_id, fields.username?)))
        .collect()
}

/// The user ids `user/self` named that we have no record for, in the order the
/// event listed them, capped at what one subscription may ask for.
///
/// These are the friends, party members and invitees the event knows by id
/// alone. Subscribing to them is what turns them into names in `users`.
pub(crate) fn ids_to_subscribe(state: &LobbyState, me: &PrivateUser) -> Vec<String> {
    let party = me.party.iter().chain(me.invited_to_parties.iter());
    let ids = me
        .friend_ids
        .iter()
        .cloned()
        .chain(me.ignore_ids.iter().cloned())
        .chain(
            me.incoming_friend_request
                .iter()
                .map(|r| r.from.to_string()),
        )
        .chain(me.outgoing_friend_request.iter().map(|r| r.to.to_string()))
        .chain(party.flat_map(|p| {
            p.members
                .iter()
                .map(|m| m.user_id.to_string())
                .chain(p.invited.iter().map(|i| i.user_id.to_string()))
        }));

    let mut wanted: Vec<String> = Vec::new();
    for id in ids {
        let known = state.users.values().any(|u| u.user_id == id) || id == *me.user_id;
        if !known && !wanted.contains(&id) {
            wanted.push(id);
        }
        if wanted.len() == SUBSCRIBE_LIMIT {
            break;
        }
    }
    wanted
}

/// `user/self`, which says who we are as well as carrying our own record.
fn self_event(state: &mut LobbyState, me: &PrivateUser) -> Vec<Delta> {
    let mut deltas = Vec::new();
    if state.my_username.as_deref() != Some(me.username.as_str()) {
        state.my_username = Some(me.username.clone());
        deltas.push(Delta::LoggedIn {
            username: me.username.clone(),
        });
    }
    deltas.extend(apply(state, from_private(me)));
    deltas
}

/// Fold one user record into `users`.
fn apply(state: &mut LobbyState, fields: Fields<'_>) -> Vec<Delta> {
    // Whatever this person is currently filed under, which a rename changes and
    // a partial update does not repeat.
    let filed_as = state
        .users
        .iter()
        .find(|(_, user)| user.user_id == fields.user_id)
        .map(|(name, _)| name.clone());

    if fields.online == Some(false) {
        return match filed_as {
            Some(name) => {
                state.users.remove(&name);
                vec![Delta::UserRemoved { name }]
            }
            None => vec![],
        };
    }

    let name = match (fields.username, filed_as.as_deref()) {
        (Some(username), _) => username.to_owned(),
        (None, Some(current)) => current.to_owned(),
        // A partial update for someone we have never seen and cannot name. The
        // subscription that produced it will send a full record too.
        (None, None) => return vec![],
    };

    let mut user = filed_as
        .as_ref()
        .and_then(|current| state.users.remove(current))
        .unwrap_or_default();
    let before = user.clone();
    user.name = name.clone();
    user.user_id = fields.user_id.to_owned();
    if let Some(country) = fields.country {
        user.country = country.to_owned();
    }
    if let Some(ingame) = fields.ingame {
        user.status.ingame = ingame;
    }
    if let Some(moderator) = fields.moderator {
        user.status.access = moderator;
    }
    let unchanged = user == before;
    state.users.insert(name.clone(), user);

    match filed_as {
        None => vec![Delta::UserAdded { name }],
        Some(old) if old != name => {
            vec![Delta::UserRemoved { name: old }, Delta::UserAdded { name }]
        }
        Some(_) if unchanged => vec![],
        Some(_) => vec![Delta::UserStatusChanged { name }],
    }
}

/// `user/self`'s record of us.
fn from_private(me: &PrivateUser) -> Fields<'_> {
    let (online, ingame) = presence(&me.status.to_string());
    Fields {
        user_id: &me.user_id,
        username: Some(&me.username),
        country: me.country_code.as_deref(),
        online: Some(online),
        ingame: Some(ingame),
        moderator: me.roles.as_ref().map(|roles| moderator(roles)),
    }
}

/// `user/info`'s answer about someone else.
fn from_user(user: &coilbox_tachyon_protocol::types::User) -> Fields<'_> {
    let (online, ingame) = presence(&user.status.to_string());
    Fields {
        user_id: &user.user_id,
        username: Some(&user.username),
        country: user.country_code.as_deref(),
        online: Some(online),
        ingame: Some(ingame),
        moderator: user.roles.as_ref().map(|roles| moderator(roles)),
    }
}

/// One entry of a `user/updated`, where every field including the id is
/// optional. Without an id there is nothing to file the update against.
fn from_updated(item: &UserUpdatedEventDataUsersItem) -> Option<Fields<'_>> {
    let presence = item.status.as_ref().map(|s| presence(&s.to_string()));
    Some(Fields {
        user_id: item.user_id.as_deref()?,
        username: item.username.as_deref(),
        country: item.country_code.as_deref(),
        online: presence.map(|(online, _)| online),
        ingame: presence.map(|(_, ingame)| ingame),
        moderator: item.roles.as_ref().map(|roles| moderator(roles)),
    })
}

/// Split a Tachyon status into the two bits [`coilbox_lobby_protocol::ClientStatus`]
/// has room for: signed in at all, and in a game.
///
/// Taken by wire value rather than by type, because the schema generates a
/// separate but identical enum for each of the three commands. An unrecognised
/// value counts as online and out of game, so a status the vendored schema has
/// not caught up with still leaves the person visible.
fn presence(status: &str) -> (bool, bool) {
    match status {
        "offline" => (false, false),
        "playing" => (true, true),
        _ => (true, false),
    }
}

/// Whether a role list makes this person a moderator, which is what
/// `ClientStatus::access` means.
fn moderator<R: std::fmt::Display>(roles: &[R]) -> bool {
    roles
        .iter()
        .any(|role| matches!(role.to_string().as_str(), "admin" | "moderator"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use coilbox_lobby_protocol::User;
    use coilbox_tachyon_protocol::parse_frame;
    use serde_json::{json, Value};

    /// The record `users` holds for `name`, for a test to assert against.
    fn user_named<'a>(state: &'a LobbyState, name: &str) -> &'a User {
        state
            .users
            .get(name)
            .unwrap_or_else(|| panic!("no user named {name}: {:?}", state.users.keys()))
    }

    /// A `user/self` frame carrying `user`, with the fields the schema requires
    /// and nothing else, so a test only spells out what it cares about.
    fn self_frame(user: Value) -> String {
        let mut base = json!({
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
        });
        merge(&mut base, user);
        json!({
            "type": "event",
            "messageId": "1",
            "commandId": "user/self",
            "data": { "user": base },
        })
        .to_string()
    }

    /// A `user/updated` frame carrying the given partial users verbatim.
    fn updated_frame(users: Value) -> String {
        json!({
            "type": "event",
            "messageId": "2",
            "commandId": "user/updated",
            "data": { "users": users },
        })
        .to_string()
    }

    /// Overwrite the keys `patch` names, leaving the rest of `base` alone.
    fn merge(base: &mut Value, patch: Value) {
        let (Some(base), Some(patch)) = (base.as_object_mut(), patch.as_object()) else {
            return;
        };
        for (key, value) in patch {
            base.insert(key.clone(), value.clone());
        }
    }

    /// Fold a frame into the state the way the connection does.
    fn feed(state: &mut LobbyState, frame: &str) -> Vec<Delta> {
        reduce(state, &parse_frame(frame))
    }

    #[test]
    fn user_self_says_who_we_are_and_adds_us_to_the_user_list() {
        let mut state = LobbyState::new();
        let deltas = feed(
            &mut state,
            &self_frame(json!({ "countryCode": "GB", "roles": ["contributor"] })),
        );

        assert_eq!(state.my_username.as_deref(), Some("alice"));
        let me = user_named(&state, "alice");
        assert_eq!(me.user_id, "1");
        assert_eq!(me.country, "GB");
        assert!(!me.status.access, "contributor is not a moderator");
        // Tachyon has no client agent, so the field stays empty rather than
        // carrying something invented.
        assert_eq!(me.agent, "");
        assert_eq!(
            deltas,
            vec![
                Delta::LoggedIn {
                    username: "alice".into()
                },
                Delta::UserAdded {
                    name: "alice".into()
                },
            ]
        );
    }

    #[test]
    fn a_moderator_role_becomes_the_access_bit() {
        let mut state = LobbyState::new();
        feed(&mut state, &self_frame(json!({ "roles": ["moderator"] })));
        assert!(user_named(&state, "alice").status.access);
    }

    #[test]
    fn playing_is_the_only_status_that_counts_as_ingame() {
        let mut state = LobbyState::new();
        feed(&mut state, &self_frame(json!({ "status": "playing" })));
        assert!(user_named(&state, "alice").status.ingame);

        feed(&mut state, &self_frame(json!({ "status": "lobby" })));
        assert!(!user_named(&state, "alice").status.ingame);
    }

    #[test]
    fn user_updated_changes_a_user_we_already_know() {
        let mut state = LobbyState::new();
        feed(&mut state, &self_frame(json!({})));
        feed(
            &mut state,
            &updated_frame(json!([
                { "userId": "2", "username": "bob", "status": "menu", "countryCode": "DE" },
            ])),
        );

        let deltas = feed(
            &mut state,
            &updated_frame(json!([{ "userId": "2", "status": "playing" }])),
        );

        let bob = user_named(&state, "bob");
        assert!(bob.status.ingame);
        // The fields the update did not mention are still there.
        assert_eq!(bob.country, "DE");
        assert_eq!(bob.name, "bob");
        assert_eq!(
            deltas,
            vec![Delta::UserStatusChanged { name: "bob".into() }]
        );
    }

    #[test]
    fn a_repeat_of_what_we_already_hold_produces_no_delta() {
        let mut state = LobbyState::new();
        feed(
            &mut state,
            &updated_frame(json!([{ "userId": "2", "username": "bob", "status": "menu" }])),
        );

        let deltas = feed(
            &mut state,
            &updated_frame(json!([{ "userId": "2", "username": "bob", "status": "menu" }])),
        );
        assert_eq!(deltas, vec![]);
    }

    #[test]
    fn user_updated_adds_a_user_we_have_not_seen() {
        let mut state = LobbyState::new();
        let deltas = feed(
            &mut state,
            &updated_frame(json!([
                { "userId": "7", "username": "carol", "status": "lobby" },
            ])),
        );

        assert_eq!(user_named(&state, "carol").user_id, "7");
        assert_eq!(
            deltas,
            vec![Delta::UserAdded {
                name: "carol".into()
            }]
        );
    }

    #[test]
    fn an_update_for_a_stranger_with_no_name_is_dropped() {
        let mut state = LobbyState::new();
        let deltas = feed(
            &mut state,
            &updated_frame(json!([{ "userId": "7", "status": "menu" }])),
        );

        assert!(state.users.is_empty());
        assert_eq!(deltas, vec![]);
    }

    #[test]
    fn an_update_with_no_user_id_is_dropped_without_touching_the_rest() {
        let mut state = LobbyState::new();
        let deltas = feed(
            &mut state,
            &updated_frame(json!([
                { "username": "nobody", "status": "menu" },
                { "userId": "7", "username": "carol", "status": "menu" },
            ])),
        );

        assert_eq!(state.users.len(), 1);
        assert_eq!(
            deltas,
            vec![Delta::UserAdded {
                name: "carol".into()
            }]
        );
    }

    #[test]
    fn going_offline_takes_a_user_out_of_the_list() {
        let mut state = LobbyState::new();
        feed(
            &mut state,
            &updated_frame(json!([{ "userId": "2", "username": "bob", "status": "menu" }])),
        );

        let deltas = feed(
            &mut state,
            &updated_frame(json!([{ "userId": "2", "status": "offline" }])),
        );

        assert!(state.users.is_empty());
        assert_eq!(deltas, vec![Delta::UserRemoved { name: "bob".into() }]);
    }

    #[test]
    fn a_user_who_arrives_offline_is_never_added() {
        let mut state = LobbyState::new();
        let deltas = feed(
            &mut state,
            &updated_frame(json!([
                { "userId": "2", "username": "bob", "status": "offline" },
            ])),
        );

        assert!(state.users.is_empty());
        assert_eq!(deltas, vec![]);
    }

    #[test]
    fn a_rename_moves_the_record_rather_than_copying_it() {
        let mut state = LobbyState::new();
        feed(
            &mut state,
            &updated_frame(json!([
                { "userId": "2", "username": "bob", "status": "menu", "countryCode": "DE" },
            ])),
        );

        let deltas = feed(
            &mut state,
            &updated_frame(json!([{ "userId": "2", "username": "robert" }])),
        );

        assert_eq!(state.users.len(), 1);
        assert_eq!(user_named(&state, "robert").country, "DE");
        assert_eq!(
            deltas,
            vec![
                Delta::UserRemoved { name: "bob".into() },
                Delta::UserAdded {
                    name: "robert".into()
                },
            ]
        );
    }

    #[test]
    fn a_field_the_vendored_schema_does_not_know_does_not_lose_the_ones_beside_it() {
        let mut state = LobbyState::new();
        let deltas = feed(
            &mut state,
            &updated_frame(json!([{
                "userId": "2",
                "username": "bob",
                "status": "menu",
                "countryCode": "DE",
                "favouriteUnit": "armcom",
            }])),
        );

        assert_eq!(user_named(&state, "bob").country, "DE");
        assert_eq!(deltas, vec![Delta::UserAdded { name: "bob".into() }]);
    }

    #[test]
    fn a_status_the_vendored_schema_does_not_know_leaves_the_person_visible() {
        let mut state = LobbyState::new();
        feed(
            &mut state,
            &updated_frame(json!([{ "userId": "2", "username": "bob", "status": "menu" }])),
        );
        feed(
            &mut state,
            &updated_frame(json!([{ "userId": "2", "status": "spectating" }])),
        );

        assert!(state.users.contains_key("bob"));
        assert!(!user_named(&state, "bob").status.ingame);
    }

    #[test]
    fn user_info_answers_with_a_full_record() {
        let mut state = LobbyState::new();
        let frame = json!({
            "type": "response",
            "messageId": "9",
            "commandId": "user/info",
            "status": "success",
            "data": {
                "userId": "3",
                "username": "dave",
                "displayName": "Dave",
                "clanBaseData": null,
                "countryCode": "FR",
                "status": "playing",
            },
        })
        .to_string();

        let deltas = feed(&mut state, &frame);

        let dave = user_named(&state, "dave");
        assert_eq!(dave.country, "FR");
        assert!(dave.status.ingame);
        assert_eq!(
            deltas,
            vec![Delta::UserAdded {
                name: "dave".into()
            }]
        );
    }

    #[test]
    fn a_failed_user_info_changes_nothing() {
        let mut state = LobbyState::new();
        let frame = json!({
            "type": "response",
            "messageId": "9",
            "commandId": "user/info",
            "status": "failed",
            "reason": "unknown_user",
        })
        .to_string();

        assert_eq!(feed(&mut state, &frame), vec![]);
        assert!(state.users.is_empty());
    }

    #[test]
    fn a_message_that_carries_no_user_leaves_the_state_alone() {
        let mut state = LobbyState::new();
        let deltas = feed(&mut state, r#"{"not":"a tachyon frame"}"#);
        assert_eq!(deltas, vec![]);
        assert!(state.users.is_empty());
    }

    /// What the connection asks the server about after `user/self`: the people
    /// the event named by id alone.
    #[test]
    fn the_ids_worth_subscribing_to_are_the_ones_we_cannot_name() {
        let mut state = LobbyState::new();
        feed(
            &mut state,
            &updated_frame(json!([{ "userId": "5", "username": "erin", "status": "menu" }])),
        );

        let frame = self_frame(json!({
            "friendIds": ["5", "6"],
            "ignoreIds": ["7"],
            "incomingFriendRequest": [{ "from": "8", "sentAt": 1 }],
            "outgoingFriendRequest": [{ "to": "9", "sentAt": 1 }],
            "party": {
                "id": "p1",
                "maxMembers": 4,
                "members": [{ "userId": "1", "joinedAt": 1 }, { "userId": "10", "joinedAt": 1 }],
                "invited": [{ "userId": "11", "invitedAt": 1 }],
            },
        }));
        feed(&mut state, &frame);

        let TachyonMessage::UserSelfEvent(event) = parse_frame(&frame) else {
            panic!("the frame did not parse as user/self");
        };
        // Not 5, we know their name already, and not 1, that is us.
        assert_eq!(
            ids_to_subscribe(&state, &event.data.user),
            vec!["6", "7", "8", "9", "10", "11"]
        );
    }

    #[test]
    fn a_subscription_asks_for_no_more_than_the_schema_allows() {
        let state = LobbyState::new();
        let ids: Vec<String> = (0..150).map(|n| (n + 100).to_string()).collect();
        let frame = self_frame(json!({ "friendIds": ids }));
        let TachyonMessage::UserSelfEvent(event) = parse_frame(&frame) else {
            panic!("the frame did not parse as user/self");
        };

        assert_eq!(
            ids_to_subscribe(&state, &event.data.user).len(),
            SUBSCRIBE_LIMIT
        );
    }
}
