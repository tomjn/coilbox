//! Frame by frame tests of the matchmaking fold and the requests it produces.

use super::*;
use coilbox_tachyon_protocol::parse_frame;

/// A fixed clock, so a deadline a test asserts is the one the fold worked out
/// rather than whatever the machine's clock happened to say.
const NOW: u64 = 1_700_000_000_000;

/// Fold a frame the way the connection does.
fn feed(queues: &mut Queues, state: &mut LobbyState, frame: &str) -> Vec<Delta> {
    let message = parse_frame(frame);
    crate::tachyon_users::reduce(state, &message);
    reduce(queues, state, &message, NOW)
}

/// One playlist as the server lists it.
fn playlist(id: &str, name: &str, teams: i64, size: i64) -> Value {
    json!({
        "id": id,
        "version": format!("{id}-version"),
        "name": name,
        "numOfTeams": teams,
        "teamSize": size,
        "ranked": true,
        "engines": [{ "version": "2025.01.6" }],
        "games": [{ "springName": "Beyond All Reason test-27414" }],
        "maps": [{ "springName": "Theta Crystals 1.3" }],
    })
}

/// The answer to our own `matchmaking/list`, which carries the queues.
fn listed(playlists: Vec<Value>) -> String {
    json!({
        "type": "response",
        "messageId": "1",
        "commandId": "matchmaking/list",
        "status": "success",
        "data": { "playlists": playlists },
    })
    .to_string()
}

/// A bare event with no data of its own.
fn event(command: &str) -> String {
    json!({ "type": "event", "messageId": "2", "commandId": command }).to_string()
}

/// An event carrying `data`.
fn event_with(command: &str, data: Value) -> String {
    json!({ "type": "event", "messageId": "3", "commandId": command, "data": data }).to_string()
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
        "messageId": "4",
        "commandId": "user/self",
        "data": { "user": base },
    })
    .to_string()
}

/// A connection that has been told what the server offers.
fn with_queues() -> (Queues, LobbyState) {
    let mut queues = Queues::default();
    let mut state = LobbyState::new();
    feed(
        &mut queues,
        &mut state,
        &listed(vec![
            playlist("1v1", "Duel", 2, 1),
            playlist("2v2", "Pairs", 2, 2),
        ]),
    );
    (queues, state)
}

/// The match the state holds, for a test to assert against.
fn found(state: &LobbyState) -> &MatchFound {
    state
        .matchmaking
        .found
        .as_ref()
        .expect("no match has been found")
}

#[test]
fn the_list_answer_fills_the_queues_the_screen_shows() {
    let (_queues, state) = with_queues();

    let listed = &state.matchmaking.queues;
    assert_eq!(listed.len(), 2);
    assert_eq!(listed[0].id, "1v1");
    assert_eq!(listed[0].name, "Duel");
    assert_eq!(listed[0].teams, 2);
    assert_eq!(listed[0].team_size, 1);
    assert!(listed[0].ranked);
    assert_eq!(listed[0].maps, vec!["Theta Crystals 1.3".to_owned()]);
    assert_eq!(listed[1].name, "Pairs");
    assert!(state.matchmaking.supported);
}

/// The opaque version is the server's own, so a search can only name a queue the
/// list has already described.
#[test]
fn searching_names_the_queue_and_the_version_the_list_gave() {
    let (queues, _state) = with_queues();

    let request = request_for(&queues, &MatchmakingAction::Search("2v2".into())).unwrap();

    assert_eq!(request.command, "matchmaking/queue");
    assert_eq!(
        request.data,
        Some(json!({ "queues": [{ "id": "2v2", "version": "2v2-version" }] }))
    );
    assert_eq!(
        request.effect,
        Some(Effect::Searching(vec!["2v2".to_owned()]))
    );
}

#[test]
fn a_queue_we_have_not_been_told_about_is_refused_before_it_is_sent() {
    let (queues, _state) = with_queues();

    let refusal = request_for(&queues, &MatchmakingAction::Search("8v8".into())).unwrap_err();

    assert_eq!(
        refusal,
        "Coilbox has not been told about a 8v8 queue on this server."
    );
}

/// The server answers `matchmaking/queue` with a bare success, so the request
/// carries what it did and the state moves when it lands.
#[test]
fn our_own_search_puts_us_in_the_queue_when_the_server_takes_it() {
    let (mut queues, mut state) = with_queues();
    let request = request_for(&queues, &MatchmakingAction::Search("1v1".into())).unwrap();

    let deltas = applied(&mut queues, &mut state, &request.effect.unwrap());

    assert_eq!(state.matchmaking.searching, vec!["1v1".to_owned()]);
    assert_eq!(deltas, vec![Delta::MatchmakingChanged]);
}

/// A party searches as one. A member who clicked nothing is told by the server
/// which queues they are now in, and that is as good a source as our own
/// request.
#[test]
fn a_party_members_search_puts_us_in_the_queue_without_a_request_of_our_own() {
    let (mut queues, mut state) = with_queues();

    let deltas = feed(
        &mut queues,
        &mut state,
        &event_with(
            "matchmaking/queuesJoined",
            json!({ "queues": ["1v1", "2v2"] }),
        ),
    );

    assert_eq!(
        state.matchmaking.searching,
        vec!["1v1".to_owned(), "2v2".to_owned()]
    );
    assert_eq!(deltas, vec![Delta::MatchmakingChanged]);
}

#[test]
fn a_found_match_carries_the_deadline_it_has_to_be_accepted_by() {
    let (mut queues, mut state) = with_queues();

    let deltas = feed(
        &mut queues,
        &mut state,
        &event_with(
            "matchmaking/found",
            json!({ "queueId": "1v1", "timeoutMs": 30_000 }),
        ),
    );

    let match_found = found(&state);
    assert_eq!(match_found.queue_id, "1v1");
    assert_eq!(match_found.ready_by, NOW + 30_000);
    assert_eq!(match_found.ready_count, 0);
    assert!(!match_found.readied);
    assert_eq!(deltas, vec![Delta::MatchmakingChanged]);
}

#[test]
fn accepting_is_recorded_when_the_server_takes_it_and_the_count_follows() {
    let (mut queues, mut state) = with_queues();
    feed(
        &mut queues,
        &mut state,
        &event_with(
            "matchmaking/found",
            json!({ "queueId": "1v1", "timeoutMs": 30_000 }),
        ),
    );
    let request = request_for(&queues, &MatchmakingAction::Accept).unwrap();
    assert_eq!(request.command, "matchmaking/ready");
    assert_eq!(request.data, None);

    applied(&mut queues, &mut state, &request.effect.unwrap());
    assert!(found(&state).readied);

    feed(
        &mut queues,
        &mut state,
        &event_with("matchmaking/foundUpdate", json!({ "readyCount": 2 })),
    );
    assert_eq!(found(&state).ready_count, 2);
    assert!(found(&state).readied);
}

/// Somebody did not accept. The match goes, the search stays, and the user is
/// told, because a panel that simply vanished would say nothing.
#[test]
fn a_lost_match_leaves_us_searching_and_says_what_happened() {
    let (mut queues, mut state) = with_queues();
    feed(
        &mut queues,
        &mut state,
        &event_with("matchmaking/queuesJoined", json!({ "queues": ["1v1"] })),
    );
    feed(
        &mut queues,
        &mut state,
        &event_with(
            "matchmaking/found",
            json!({ "queueId": "1v1", "timeoutMs": 30_000 }),
        ),
    );

    let deltas = feed(&mut queues, &mut state, &event("matchmaking/lost"));

    assert!(state.matchmaking.found.is_none());
    assert_eq!(state.matchmaking.searching, vec!["1v1".to_owned()]);
    assert_eq!(deltas.len(), 2);
    assert_eq!(deltas[0], Delta::MatchmakingChanged);
    let Delta::ServerMessage { text, .. } = &deltas[1] else {
        panic!("the user was not told: {deltas:?}");
    };
    assert!(text.contains("did not accept"), "unexpected text: {text}");
}

#[test]
fn being_cancelled_stops_the_search_and_says_why() {
    let (mut queues, mut state) = with_queues();
    feed(
        &mut queues,
        &mut state,
        &event_with("matchmaking/queuesJoined", json!({ "queues": ["1v1"] })),
    );

    let deltas = feed(
        &mut queues,
        &mut state,
        &event_with(
            "matchmaking/cancelled",
            json!({ "reason": "party_user_left" }),
        ),
    );

    assert!(state.matchmaking.searching.is_empty());
    assert!(state.matchmaking.found.is_none());
    let Delta::ServerMessage { text, .. } = &deltas[1] else {
        panic!("the user was not told: {deltas:?}");
    };
    assert!(text.contains("left your party"), "unexpected text: {text}");
}

/// Our own cancel answers with a bare success, so the request carries what it
/// did, exactly as a search does.
#[test]
fn our_own_cancel_stops_the_search_when_the_server_takes_it() {
    let (mut queues, mut state) = with_queues();
    feed(
        &mut queues,
        &mut state,
        &event_with("matchmaking/queuesJoined", json!({ "queues": ["1v1"] })),
    );
    let request = request_for(&queues, &MatchmakingAction::Cancel).unwrap();
    assert_eq!(request.command, "matchmaking/cancel");

    let deltas = applied(&mut queues, &mut state, &request.effect.unwrap());

    assert!(state.matchmaking.searching.is_empty());
    assert_eq!(deltas, vec![Delta::MatchmakingChanged]);
}

/// A reconnect picks the search back up, because our own record is what carries
/// it and no event repeats it.
#[test]
fn user_self_picks_a_search_back_up() {
    let (mut queues, mut state) = with_queues();

    feed(
        &mut queues,
        &mut state,
        &self_frame(json!({ "matchmaking": {
            "state": "queuing",
            "queues": [{ "id": "1v1", "version": "1v1-version" }],
        } })),
    );

    assert_eq!(state.matchmaking.searching, vec!["1v1".to_owned()]);
    assert!(state.matchmaking.found.is_none());
}

/// And a match that was found while we were away, with the deadline the server
/// holds rather than one counted from the reconnect.
#[test]
fn user_self_picks_a_found_match_back_up_with_its_own_deadline() {
    let (mut queues, mut state) = with_queues();

    feed(
        &mut queues,
        &mut state,
        &self_frame(json!({ "matchmaking": {
            "state": "found",
            "queue": {
                "id": "1v1",
                "version": "1v1-version",
                // Tachyon timestamps are microseconds.
                "timeoutAt": 1_700_000_030_000_000i64,
                "hasAlreadyReadied": true,
            },
            "otherQueues": [{ "id": "2v2", "version": "2v2-version" }],
        } })),
    );

    let match_found = found(&state);
    assert_eq!(match_found.queue_id, "1v1");
    assert_eq!(match_found.ready_by, 1_700_000_030_000);
    assert!(match_found.readied);
    assert_eq!(
        state.matchmaking.searching,
        vec!["1v1".to_owned(), "2v2".to_owned()]
    );
}

/// A server that has not built matchmaking turns the screen off rather than
/// leaving it showing an empty list of queues forever.
#[test]
fn a_server_without_matchmaking_says_so() {
    let (mut queues, mut state) = with_queues();

    let deltas = applied(&mut queues, &mut state, &Effect::Unsupported);

    assert!(!state.matchmaking.supported);
    assert_eq!(deltas, vec![Delta::MatchmakingChanged]);
}

/// Nothing folds `matchmaking/queueUpdate`, because Teiserver does not send one
/// and a display fed by it would have no data behind it.
#[test]
fn a_queue_update_moves_nothing() {
    let (mut queues, mut state) = with_queues();

    let deltas = feed(
        &mut queues,
        &mut state,
        &event_with("matchmaking/queueUpdate", json!({ "playersQueued": 12 })),
    );

    assert!(deltas.is_empty());
}
