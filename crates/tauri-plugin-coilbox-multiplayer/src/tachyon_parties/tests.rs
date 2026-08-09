//! Frame by frame tests of the party fold and the requests it produces.

use super::*;
use coilbox_tachyon_protocol::parse_frame;

/// Fold a frame into both states the way the connection does: the user fold
/// first, so a name that has just arrived is in `users` by the time the party
/// fold projects it.
fn feed(parties: &mut Parties, state: &mut LobbyState, frame: &str) -> Vec<Delta> {
    let message = parse_frame(frame);
    crate::tachyon_users::reduce(state, &message);
    reduce(parties, state, &message)
}

/// One party as the server describes it, with a member and invitee list given as
/// user ids.
fn party_of(id: &str, members: &[&str], invited: &[&str]) -> Value {
    json!({
        "id": id,
        "maxMembers": 4,
        "members": members
            .iter()
            .map(|user_id| json!({ "userId": user_id, "joinedAt": 1 }))
            .collect::<Vec<Value>>(),
        "invited": invited
            .iter()
            .map(|user_id| json!({ "userId": user_id, "invitedAt": 1 }))
            .collect::<Vec<Value>>(),
    })
}

/// A `user/self` frame carrying `user`, with the fields the schema requires and
/// nothing else, so a test only spells out what it cares about.
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
    let (Some(base_object), Some(patch)) = (base.as_object_mut(), user.as_object()) else {
        panic!("both sides of the merge are objects");
    };
    for (key, value) in patch {
        base_object.insert(key.clone(), value.clone());
    }
    json!({
        "type": "event",
        "messageId": "1",
        "commandId": "user/self",
        "data": { "user": base },
    })
    .to_string()
}

/// A `user/updated` frame naming one person, which is how a member id becomes a
/// member name.
fn named(user_id: &str, username: &str, status: &str) -> String {
    json!({
        "type": "event",
        "messageId": "2",
        "commandId": "user/updated",
        "data": { "users": [
            { "userId": user_id, "username": username, "status": status },
        ] },
    })
    .to_string()
}

/// A `party/invited`, which carries the whole party it is inviting us to.
fn invited_frame(party: Value) -> String {
    json!({
        "type": "event",
        "messageId": "3",
        "commandId": "party/invited",
        "data": { "party": party },
    })
    .to_string()
}

/// A `party/updated`, which carries the party itself as its data.
fn updated_frame(party: Value) -> String {
    json!({
        "type": "event",
        "messageId": "4",
        "commandId": "party/updated",
        "data": party,
    })
    .to_string()
}

/// A `party/removed`, which names only the party that has gone.
fn removed_frame(party_id: &str) -> String {
    json!({
        "type": "event",
        "messageId": "5",
        "commandId": "party/removed",
        "data": { "partyId": party_id },
    })
    .to_string()
}

/// The answer to our own `party/create`, which carries the party the server made.
fn created_frame(party: Value) -> String {
    json!({
        "type": "response",
        "messageId": "6",
        "commandId": "party/create",
        "status": "success",
        "data": { "party": party },
    })
    .to_string()
}

/// A state that is signed in as alice and knows bob is user 2 and carol is user
/// 3, both signed in.
fn signed_in() -> (Parties, LobbyState) {
    let mut parties = Parties::default();
    let mut state = LobbyState::new();
    feed(&mut parties, &mut state, &self_frame(json!({})));
    feed(&mut parties, &mut state, &named("2", "bob", "menu"));
    feed(&mut parties, &mut state, &named("3", "carol", "menu"));
    (parties, state)
}

/// The party the state holds, for a test to assert against.
fn held(state: &LobbyState) -> &Party {
    state.party.as_ref().expect("we are not in a party")
}

#[test]
fn user_self_fills_the_party_we_are_already_in() {
    let (mut parties, mut state) = signed_in();

    let deltas = feed(
        &mut parties,
        &mut state,
        &self_frame(json!({ "party": party_of("p1", &["1", "2"], &["3"]) })),
    );

    let party = held(&state);
    assert_eq!(party.id, "p1");
    assert_eq!(party.members, vec!["alice".to_owned(), "bob".to_owned()]);
    assert_eq!(party.invited, vec!["carol".to_owned()]);
    assert_eq!(party.max_members, 4);
    assert_eq!(deltas, vec![Delta::PartyChanged]);
}

#[test]
fn user_self_fills_the_invitations_we_have_not_answered() {
    let (mut parties, mut state) = signed_in();

    feed(
        &mut parties,
        &mut state,
        &self_frame(json!({ "invitedToParties": [party_of("p2", &["2"], &["1"])] })),
    );

    assert!(state.party.is_none());
    assert_eq!(state.party_invites.len(), 1);
    assert_eq!(state.party_invites[0].id, "p2");
    assert_eq!(state.party_invites[0].members, vec!["bob".to_owned()]);
}

/// The point of the module's projection. A member the server has not named yet
/// is shown as their user id, and swaps to the name the moment one arrives.
#[test]
fn a_member_we_cannot_name_is_shown_by_id_until_we_can() {
    let (mut parties, mut state) = signed_in();

    feed(
        &mut parties,
        &mut state,
        &self_frame(json!({ "party": party_of("p1", &["1", "9"], &[]) })),
    );
    assert_eq!(
        held(&state).members,
        vec!["alice".to_owned(), "9".to_owned()]
    );

    let deltas = feed(&mut parties, &mut state, &named("9", "dave", "menu"));

    assert_eq!(
        held(&state).members,
        vec!["alice".to_owned(), "dave".to_owned()]
    );
    assert_eq!(deltas, vec![Delta::PartyChanged]);
}

/// A member who is offline is not in `users` at all, so their name has to come
/// from the record itself and stay there.
#[test]
fn a_member_who_is_offline_is_in_the_party_under_their_name() {
    let (mut parties, mut state) = signed_in();
    feed(&mut parties, &mut state, &named("9", "dave", "offline"));

    feed(
        &mut parties,
        &mut state,
        &self_frame(json!({ "party": party_of("p1", &["1", "9"], &[]) })),
    );

    assert_eq!(
        held(&state).members,
        vec!["alice".to_owned(), "dave".to_owned()]
    );
    assert!(!state.users.contains_key("dave"));
}

#[test]
fn being_invited_adds_the_party_to_the_invitations() {
    let (mut parties, mut state) = signed_in();

    let deltas = feed(
        &mut parties,
        &mut state,
        &invited_frame(party_of("p2", &["2"], &["1"])),
    );

    assert_eq!(state.party_invites.len(), 1);
    assert_eq!(state.party_invites[0].members, vec!["bob".to_owned()]);
    assert_eq!(state.party_invites[0].invited, vec!["alice".to_owned()]);
    assert_eq!(deltas, vec![Delta::PartyChanged]);
}

/// A second invitation from the same party replaces the first, so a party that
/// changes while we think about it does not appear twice.
#[test]
fn a_repeat_invitation_replaces_the_one_we_hold() {
    let (mut parties, mut state) = signed_in();
    feed(
        &mut parties,
        &mut state,
        &invited_frame(party_of("p2", &["2"], &["1"])),
    );

    feed(
        &mut parties,
        &mut state,
        &invited_frame(party_of("p2", &["2", "3"], &["1"])),
    );

    assert_eq!(state.party_invites.len(), 1);
    assert_eq!(
        state.party_invites[0].members,
        vec!["bob".to_owned(), "carol".to_owned()]
    );
}

#[test]
fn an_update_changes_the_party_we_are_in() {
    let (mut parties, mut state) = signed_in();
    feed(
        &mut parties,
        &mut state,
        &self_frame(json!({ "party": party_of("p1", &["1"], &[]) })),
    );

    let deltas = feed(
        &mut parties,
        &mut state,
        &updated_frame(party_of("p1", &["1", "2"], &["3"])),
    );

    assert_eq!(
        held(&state).members,
        vec!["alice".to_owned(), "bob".to_owned()]
    );
    assert_eq!(held(&state).invited, vec!["carol".to_owned()]);
    assert_eq!(deltas, vec![Delta::PartyChanged]);
}

#[test]
fn an_update_changes_a_party_we_have_only_been_invited_to() {
    let (mut parties, mut state) = signed_in();
    feed(
        &mut parties,
        &mut state,
        &invited_frame(party_of("p2", &["2"], &["1"])),
    );

    feed(
        &mut parties,
        &mut state,
        &updated_frame(party_of("p2", &["2", "3"], &["1"])),
    );

    assert!(state.party.is_none());
    assert_eq!(
        state.party_invites[0].members,
        vec!["bob".to_owned(), "carol".to_owned()]
    );
}

/// A party we are neither in nor invited to is one we have nothing to update, so
/// it is dropped rather than guessed at.
#[test]
fn an_update_for_a_party_we_hold_nowhere_changes_nothing() {
    let (mut parties, mut state) = signed_in();
    feed(
        &mut parties,
        &mut state,
        &self_frame(json!({ "party": party_of("p1", &["1"], &[]) })),
    );

    let deltas = feed(
        &mut parties,
        &mut state,
        &updated_frame(party_of("p9", &["2", "3"], &[])),
    );

    assert_eq!(held(&state).id, "p1");
    assert_eq!(held(&state).members, vec!["alice".to_owned()]);
    assert!(state.party_invites.is_empty());
    assert_eq!(deltas, vec![]);
}

#[test]
fn being_removed_takes_us_out_of_the_party() {
    let (mut parties, mut state) = signed_in();
    feed(
        &mut parties,
        &mut state,
        &self_frame(json!({ "party": party_of("p1", &["1", "2"], &[]) })),
    );

    let deltas = feed(&mut parties, &mut state, &removed_frame("p1"));

    assert!(state.party.is_none());
    assert_eq!(deltas, vec![Delta::PartyChanged]);
}

#[test]
fn a_removed_party_also_goes_from_the_invitations() {
    let (mut parties, mut state) = signed_in();
    feed(
        &mut parties,
        &mut state,
        &invited_frame(party_of("p2", &["2"], &["1"])),
    );

    let deltas = feed(&mut parties, &mut state, &removed_frame("p2"));

    assert!(state.party_invites.is_empty());
    assert_eq!(deltas, vec![Delta::PartyChanged]);
}

/// `party/create` is the one request whose answer carries the party, so the
/// answer is folded rather than applied as an effect.
#[test]
fn the_answer_to_our_own_create_is_the_party_we_are_now_in() {
    let (mut parties, mut state) = signed_in();

    let deltas = feed(
        &mut parties,
        &mut state,
        &created_frame(party_of("p3", &["1"], &[])),
    );

    assert_eq!(held(&state).id, "p3");
    assert_eq!(held(&state).members, vec!["alice".to_owned()]);
    assert_eq!(deltas, vec![Delta::PartyChanged]);
}

#[test]
fn a_message_that_is_nothing_to_do_with_parties_changes_nothing() {
    let (mut parties, mut state) = signed_in();
    let deltas = feed(&mut parties, &mut state, r#"{"not":"a tachyon frame"}"#);
    assert_eq!(deltas, vec![]);
    assert!(state.party.is_none());
}

#[test]
fn each_control_asks_the_server_the_right_thing() {
    let (mut parties, mut state) = signed_in();
    feed(
        &mut parties,
        &mut state,
        &self_frame(json!({
            "party": party_of("p1", &["1", "2"], &["3"]),
            "invitedToParties": [party_of("p2", &["9"], &["1"])],
        })),
    );
    let asks = |action: PartyAction| {
        let request = request_for(&parties, &action).unwrap();
        (request.command, request.data)
    };

    assert_eq!(asks(PartyAction::Create), ("party/create", None));
    assert_eq!(asks(PartyAction::Leave), ("party/leave", None));
    assert_eq!(
        asks(PartyAction::Invite("carol".into())),
        ("party/invite", Some(json!({ "userId": "3" })))
    );
    assert_eq!(
        asks(PartyAction::CancelInvite("carol".into())),
        ("party/cancelInvite", Some(json!({ "userId": "3" })))
    );
    assert_eq!(
        asks(PartyAction::Kick("bob".into())),
        ("party/kickMember", Some(json!({ "userId": "2" })))
    );
    assert_eq!(
        asks(PartyAction::Accept("p2".into())),
        ("party/acceptInvite", Some(json!({ "partyId": "p2" })))
    );
    assert_eq!(
        asks(PartyAction::Decline("p2".into())),
        ("party/declineInvite", Some(json!({ "partyId": "p2" })))
    );
}

/// A member shown as a number can still be put out, because the number is the
/// user id the request names them by.
#[test]
fn a_control_naming_a_member_we_cannot_name_still_works() {
    let (mut parties, mut state) = signed_in();
    feed(
        &mut parties,
        &mut state,
        &self_frame(json!({ "party": party_of("p1", &["1", "9"], &[]) })),
    );

    let request = request_for(&parties, &PartyAction::Kick("9".into())).unwrap();

    assert_eq!(request.command, "party/kickMember");
    assert_eq!(request.data, Some(json!({ "userId": "9" })));
}

#[test]
fn a_person_we_hold_no_id_for_is_reported_rather_than_asked_about() {
    let (parties, _) = signed_in();

    let refusal = request_for(&parties, &PartyAction::Invite("dave".into())).unwrap_err();

    assert!(refusal.contains("dave"), "unhelpful refusal: {refusal}");
}

/// Leaving is answered with a bare success, so the section has to move on the
/// strength of the request we sent.
#[test]
fn leaving_ourselves_takes_us_out_of_the_party() {
    let (mut parties, mut state) = signed_in();
    feed(
        &mut parties,
        &mut state,
        &self_frame(json!({ "party": party_of("p1", &["1", "2"], &[]) })),
    );
    let effect = effect_of(&parties, PartyAction::Leave);

    let deltas = applied(&mut parties, &mut state, &effect);

    assert!(state.party.is_none());
    assert_eq!(deltas, vec![Delta::PartyChanged]);
}

#[test]
fn inviting_someone_ourselves_puts_them_among_the_invited() {
    let (mut parties, mut state) = signed_in();
    feed(
        &mut parties,
        &mut state,
        &self_frame(json!({ "party": party_of("p1", &["1"], &[]) })),
    );
    let effect = effect_of(&parties, PartyAction::Invite("bob".into()));

    let deltas = applied(&mut parties, &mut state, &effect);

    assert_eq!(held(&state).invited, vec!["bob".to_owned()]);
    assert_eq!(deltas, vec![Delta::PartyChanged]);
}

#[test]
fn accepting_an_invitation_ourselves_makes_it_the_party_we_are_in() {
    let (mut parties, mut state) = signed_in();
    feed(
        &mut parties,
        &mut state,
        &self_frame(json!({ "invitedToParties": [party_of("p2", &["2"], &["1"])] })),
    );
    let effect = effect_of(&parties, PartyAction::Accept("p2".into()));

    let deltas = applied(&mut parties, &mut state, &effect);

    assert_eq!(held(&state).id, "p2");
    // We are a member from this moment, and no longer someone with an
    // invitation outstanding.
    assert_eq!(
        held(&state).members,
        vec!["bob".to_owned(), "alice".to_owned()]
    );
    assert!(held(&state).invited.is_empty());
    assert!(state.party_invites.is_empty());
    assert_eq!(deltas, vec![Delta::PartyChanged]);
}

#[test]
fn declining_an_invitation_ourselves_takes_it_off_the_list() {
    let (mut parties, mut state) = signed_in();
    feed(
        &mut parties,
        &mut state,
        &self_frame(json!({ "invitedToParties": [party_of("p2", &["2"], &["1"])] })),
    );
    let effect = effect_of(&parties, PartyAction::Decline("p2".into()));

    let deltas = applied(&mut parties, &mut state, &effect);

    assert!(state.party_invites.is_empty());
    assert_eq!(deltas, vec![Delta::PartyChanged]);
}

#[test]
fn withdrawing_an_invitation_ourselves_takes_them_off_the_invited() {
    let (mut parties, mut state) = signed_in();
    feed(
        &mut parties,
        &mut state,
        &self_frame(json!({ "party": party_of("p1", &["1"], &["2", "3"]) })),
    );
    let effect = effect_of(&parties, PartyAction::CancelInvite("bob".into()));

    let deltas = applied(&mut parties, &mut state, &effect);

    assert_eq!(held(&state).invited, vec!["carol".to_owned()]);
    assert_eq!(deltas, vec![Delta::PartyChanged]);
}

#[test]
fn putting_a_member_out_ourselves_takes_them_off_the_party() {
    let (mut parties, mut state) = signed_in();
    feed(
        &mut parties,
        &mut state,
        &self_frame(json!({ "party": party_of("p1", &["1", "2"], &[]) })),
    );
    let effect = effect_of(&parties, PartyAction::Kick("bob".into()));

    let deltas = applied(&mut parties, &mut state, &effect);

    assert_eq!(held(&state).members, vec!["alice".to_owned()]);
    assert_eq!(deltas, vec![Delta::PartyChanged]);
}

#[test]
fn a_party_event_naming_someone_we_cannot_name_asks_who_they_are() {
    let (parties, _) = signed_in();

    let unknown = parse_frame(&invited_frame(party_of("p2", &["9"], &["1", "8"])));
    assert_eq!(
        ids_to_subscribe(&parties, &unknown),
        vec!["9".to_owned(), "8".to_owned()]
    );

    // Somebody we can already name is not worth a subscription, and neither is a
    // party that has gone.
    let known = parse_frame(&updated_frame(party_of("p2", &["2", "3"], &[])));
    assert!(ids_to_subscribe(&parties, &known).is_empty());
    let gone = parse_frame(&removed_frame("p2"));
    assert!(ids_to_subscribe(&parties, &gone).is_empty());
}

/// The effect one control carries, which is what the connection applies when the
/// server answers.
fn effect_of(parties: &Parties, action: PartyAction) -> Effect {
    request_for(parties, &action)
        .unwrap()
        .effect
        .expect("this control carries an effect")
}
