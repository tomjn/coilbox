//! Frame by frame tests of the friend fold and the requests it produces.

use super::*;
use coilbox_tachyon_protocol::parse_frame;

/// Fold a frame into both states the way the connection does: the user fold
/// first, so a name that has just arrived is in `users` by the time the friend
/// fold projects it.
fn feed(friends: &mut Friends, state: &mut LobbyState, frame: &str) -> Vec<Delta> {
    let message = parse_frame(frame);
    crate::tachyon_users::reduce(state, &message);
    reduce(friends, state, &message)
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

/// A `user/updated` frame naming one person, which is how a friend id becomes a
/// friend name.
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

/// One of the five friend events, all of which name a person by `from`.
fn event(command: &str, from: &str) -> String {
    json!({
        "type": "event",
        "messageId": "3",
        "commandId": command,
        "data": { "from": from },
    })
    .to_string()
}

/// A state that knows bob is user 2 and carol is user 3, both signed in.
fn knowing_bob_and_carol() -> (Friends, LobbyState) {
    let mut friends = Friends::default();
    let mut state = LobbyState::new();
    feed(&mut friends, &mut state, &named("2", "bob", "menu"));
    feed(&mut friends, &mut state, &named("3", "carol", "menu"));
    (friends, state)
}

#[test]
fn user_self_fills_the_friends_list_and_the_pending_requests() {
    let (mut friends, mut state) = knowing_bob_and_carol();

    let deltas = feed(
        &mut friends,
        &mut state,
        &self_frame(json!({
            "friendIds": ["2"],
            "incomingFriendRequest": [{ "from": "3", "sentAt": 1 }],
            "outgoingFriendRequest": [{ "to": "4", "sentAt": 1 }],
        })),
    );

    assert_eq!(state.friends, ["bob".to_owned()].into());
    assert_eq!(state.friend_requests, ["carol".to_owned()].into());
    assert_eq!(
        deltas,
        vec![Delta::FriendsChanged, Delta::FriendRequestsChanged]
    );
}

/// The point of the module. A friend who is not signed in is never in `users`,
/// so the name has to come from the record itself and stay there.
#[test]
fn a_friend_who_is_offline_is_in_the_list_under_their_name() {
    let mut friends = Friends::default();
    let mut state = LobbyState::new();

    feed(&mut friends, &mut state, &named("2", "bob", "offline"));
    feed(
        &mut friends,
        &mut state,
        &self_frame(json!({ "friendIds": ["2"] })),
    );

    assert_eq!(state.friends, ["bob".to_owned()].into());
    // Offline, so the roster does not carry them and the Friends section shows
    // them as away rather than as online.
    assert!(!state.users.contains_key("bob"));
}

/// A friend who goes offline keeps their name, because the record that named
/// them is gone from `users` by the time the friend fold runs.
#[test]
fn a_friend_going_offline_keeps_their_name() {
    let (mut friends, mut state) = knowing_bob_and_carol();
    feed(
        &mut friends,
        &mut state,
        &self_frame(json!({ "friendIds": ["2"] })),
    );

    let deltas = feed(
        &mut friends,
        &mut state,
        &json!({
            "type": "event",
            "messageId": "4",
            "commandId": "user/updated",
            "data": { "users": [{ "userId": "2", "status": "offline" }] },
        })
        .to_string(),
    );

    assert_eq!(state.friends, ["bob".to_owned()].into());
    assert!(!state.users.contains_key("bob"));
    assert_eq!(deltas, vec![]);
}

/// A friend the server has not named yet shows as their user id, and swaps to
/// the name the moment one arrives.
#[test]
fn a_friend_we_cannot_name_is_shown_by_id_until_we_can() {
    let mut friends = Friends::default();
    let mut state = LobbyState::new();

    feed(
        &mut friends,
        &mut state,
        &self_frame(json!({ "friendIds": ["2"] })),
    );
    assert_eq!(state.friends, ["2".to_owned()].into());

    let deltas = feed(&mut friends, &mut state, &named("2", "bob", "menu"));
    assert_eq!(state.friends, ["bob".to_owned()].into());
    assert_eq!(deltas, vec![Delta::FriendsChanged]);
}

#[test]
fn a_received_request_is_added_to_the_pending_ones() {
    let (mut friends, mut state) = knowing_bob_and_carol();

    let deltas = feed(
        &mut friends,
        &mut state,
        &event("friend/requestReceived", "2"),
    );

    assert_eq!(state.friend_requests, ["bob".to_owned()].into());
    assert_eq!(deltas, vec![Delta::FriendRequestsChanged]);
}

#[test]
fn a_request_they_accepted_makes_them_a_friend() {
    let (mut friends, mut state) = knowing_bob_and_carol();
    feed(
        &mut friends,
        &mut state,
        &self_frame(json!({ "outgoingFriendRequest": [{ "to": "2", "sentAt": 1 }] })),
    );

    let deltas = feed(
        &mut friends,
        &mut state,
        &event("friend/requestAccepted", "2"),
    );

    assert_eq!(state.friends, ["bob".to_owned()].into());
    assert_eq!(deltas, vec![Delta::FriendsChanged]);
    // No longer outstanding, so removing them ends a friendship rather than
    // withdrawing a request.
    assert_eq!(
        request_for(&friends, &FriendAction::Remove("bob".into()))
            .unwrap()
            .command,
        "friend/remove"
    );
}

/// Nothing on screen holds an outgoing request, so a refusal changes nothing a
/// user can see. It still has to leave the friends alone.
#[test]
fn a_request_they_rejected_leaves_the_lists_alone() {
    let (mut friends, mut state) = knowing_bob_and_carol();
    feed(
        &mut friends,
        &mut state,
        &self_frame(json!({
            "friendIds": ["3"],
            "outgoingFriendRequest": [{ "to": "2", "sentAt": 1 }],
        })),
    );

    let deltas = feed(
        &mut friends,
        &mut state,
        &event("friend/requestRejected", "2"),
    );

    assert_eq!(state.friends, ["carol".to_owned()].into());
    assert!(state.friend_requests.is_empty());
    assert_eq!(deltas, vec![]);
    // There is no longer a request of ours to withdraw.
    assert_eq!(
        request_for(&friends, &FriendAction::Remove("bob".into()))
            .unwrap()
            .command,
        "friend/remove"
    );
}

#[test]
fn a_request_they_cancelled_is_taken_off_the_pending_ones() {
    let (mut friends, mut state) = knowing_bob_and_carol();
    feed(
        &mut friends,
        &mut state,
        &self_frame(json!({ "incomingFriendRequest": [{ "from": "2", "sentAt": 1 }] })),
    );

    let deltas = feed(
        &mut friends,
        &mut state,
        &event("friend/requestCancelled", "2"),
    );

    assert!(state.friend_requests.is_empty());
    assert_eq!(deltas, vec![Delta::FriendRequestsChanged]);
}

#[test]
fn being_removed_takes_them_out_of_the_friends_list() {
    let (mut friends, mut state) = knowing_bob_and_carol();
    feed(
        &mut friends,
        &mut state,
        &self_frame(json!({ "friendIds": ["2", "3"] })),
    );

    let deltas = feed(&mut friends, &mut state, &event("friend/removed", "2"));

    assert_eq!(state.friends, ["carol".to_owned()].into());
    assert_eq!(deltas, vec![Delta::FriendsChanged]);
}

#[test]
fn friend_list_replaces_everything_we_hold() {
    let (mut friends, mut state) = knowing_bob_and_carol();
    feed(
        &mut friends,
        &mut state,
        &self_frame(json!({ "friendIds": ["3"] })),
    );

    let frame = json!({
        "type": "response",
        "messageId": "9",
        "commandId": "friend/list",
        "status": "success",
        "data": {
            "friends": [{ "userId": "2", "addedAt": 1 }],
            "incomingPendingRequests": [{ "from": "3", "sentAt": 1 }],
            "outgoingPendingRequests": [{ "to": "4", "sentAt": 1 }],
        },
    })
    .to_string();
    let deltas = feed(&mut friends, &mut state, &frame);

    assert_eq!(state.friends, ["bob".to_owned()].into());
    assert_eq!(state.friend_requests, ["carol".to_owned()].into());
    assert_eq!(
        deltas,
        vec![Delta::FriendsChanged, Delta::FriendRequestsChanged]
    );
}

#[test]
fn a_message_that_is_nothing_to_do_with_friends_changes_nothing() {
    let (mut friends, mut state) = knowing_bob_and_carol();
    let deltas = feed(&mut friends, &mut state, r#"{"not":"a tachyon frame"}"#);
    assert_eq!(deltas, vec![]);
    assert!(state.friends.is_empty());
}

#[test]
fn each_control_asks_the_server_the_right_thing() {
    let (mut friends, mut state) = knowing_bob_and_carol();
    feed(
        &mut friends,
        &mut state,
        &self_frame(json!({
            "friendIds": ["3"],
            "incomingFriendRequest": [{ "from": "2", "sentAt": 1 }],
        })),
    );
    let asks = |action: FriendAction| {
        let request = request_for(&friends, &action).unwrap();
        (request.command, request.data)
    };

    assert_eq!(
        asks(FriendAction::Send("bob".into())),
        ("friend/sendRequest", Some(json!({ "to": "2" })))
    );
    assert_eq!(
        asks(FriendAction::Accept("bob".into())),
        ("friend/acceptRequest", Some(json!({ "from": "2" })))
    );
    assert_eq!(
        asks(FriendAction::Reject("bob".into())),
        ("friend/rejectRequest", Some(json!({ "from": "2" })))
    );
    assert_eq!(
        asks(FriendAction::Remove("carol".into())),
        ("friend/remove", Some(json!({ "userId": "3" })))
    );
    assert_eq!(asks(FriendAction::List), ("friend/list", None));
}

/// Removing somebody we have only asked withdraws the request, because there is
/// no friendship to end and `friend/remove` would be refused.
#[test]
fn removing_someone_we_have_only_asked_withdraws_the_request() {
    let (mut friends, mut state) = knowing_bob_and_carol();
    feed(
        &mut friends,
        &mut state,
        &self_frame(json!({ "outgoingFriendRequest": [{ "to": "2", "sentAt": 1 }] })),
    );

    let request = request_for(&friends, &FriendAction::Remove("bob".into())).unwrap();

    assert_eq!(request.command, "friend/cancelRequest");
    assert_eq!(request.data, Some(json!({ "to": "2" })));
}

#[test]
fn a_person_we_hold_no_id_for_is_reported_rather_than_asked_about() {
    let (friends, _) = knowing_bob_and_carol();

    let refusal = request_for(&friends, &FriendAction::Send("dave".into())).unwrap_err();

    assert!(refusal.contains("dave"), "unhelpful refusal: {refusal}");
}

/// Our own accept is answered with a bare success, so the list has to move on
/// the strength of the request we sent.
#[test]
fn accepting_a_request_ourselves_moves_them_into_the_friends_list() {
    let (mut friends, mut state) = knowing_bob_and_carol();
    feed(
        &mut friends,
        &mut state,
        &self_frame(json!({ "incomingFriendRequest": [{ "from": "2", "sentAt": 1 }] })),
    );
    let effect = request_for(&friends, &FriendAction::Accept("bob".into()))
        .unwrap()
        .effect
        .unwrap();

    let deltas = applied(&mut friends, &mut state, &effect);

    assert_eq!(state.friends, ["bob".to_owned()].into());
    assert!(state.friend_requests.is_empty());
    assert_eq!(
        deltas,
        vec![Delta::FriendsChanged, Delta::FriendRequestsChanged]
    );
}

#[test]
fn turning_a_request_down_ourselves_takes_it_off_the_list() {
    let (mut friends, mut state) = knowing_bob_and_carol();
    feed(
        &mut friends,
        &mut state,
        &self_frame(json!({ "incomingFriendRequest": [{ "from": "2", "sentAt": 1 }] })),
    );
    let effect = request_for(&friends, &FriendAction::Reject("bob".into()))
        .unwrap()
        .effect
        .unwrap();

    let deltas = applied(&mut friends, &mut state, &effect);

    assert!(state.friend_requests.is_empty());
    assert_eq!(deltas, vec![Delta::FriendRequestsChanged]);
}

#[test]
fn removing_a_friend_ourselves_takes_them_out_of_the_list() {
    let (mut friends, mut state) = knowing_bob_and_carol();
    feed(
        &mut friends,
        &mut state,
        &self_frame(json!({ "friendIds": ["2"] })),
    );
    let effect = request_for(&friends, &FriendAction::Remove("bob".into()))
        .unwrap()
        .effect
        .unwrap();

    let deltas = applied(&mut friends, &mut state, &effect);

    assert!(state.friends.is_empty());
    assert_eq!(deltas, vec![Delta::FriendsChanged]);
}

/// Sending a request changes nothing on screen, but it does decide that removing
/// them next withdraws it rather than ending a friendship.
#[test]
fn sending_a_request_ourselves_makes_it_one_we_can_withdraw() {
    let (mut friends, mut state) = knowing_bob_and_carol();
    let effect = request_for(&friends, &FriendAction::Send("bob".into()))
        .unwrap()
        .effect
        .unwrap();

    let deltas = applied(&mut friends, &mut state, &effect);

    assert_eq!(deltas, vec![]);
    assert_eq!(
        request_for(&friends, &FriendAction::Remove("bob".into()))
            .unwrap()
            .command,
        "friend/cancelRequest"
    );
}

#[test]
fn a_friend_event_naming_someone_we_cannot_name_asks_who_they_are() {
    let (friends, _) = knowing_bob_and_carol();

    let unknown = parse_frame(&event("friend/requestReceived", "9"));
    assert_eq!(ids_to_subscribe(&friends, &unknown), vec!["9".to_owned()]);

    // Somebody we can already name is not worth a subscription.
    let known = parse_frame(&event("friend/requestReceived", "2"));
    assert!(ids_to_subscribe(&friends, &known).is_empty());

    // Nor is somebody who has just left a list, whatever we know about them.
    let gone = parse_frame(&event("friend/removed", "9"));
    assert!(ids_to_subscribe(&friends, &gone).is_empty());
}
