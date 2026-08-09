//! Chat a frame at a time, and the request each kind of send comes to.

use coilbox_lobby_protocol::{Battle, User};
use coilbox_tachyon_protocol::parse_frame;
use serde_json::{json, Value};

use super::*;

/// A time the tests can recognise, and the milliseconds it is.
const SENT_AT_MICROS: i64 = 1_705_432_698_000_000;
const SENT_AT_MILLIS: u64 = 1_705_432_698_000;

/// A state where we are alice, user 1, and bob is user 2.
fn signed_in() -> LobbyState {
    let mut state = LobbyState::new();
    state.my_username = Some("alice".into());
    add_user(&mut state, "alice", "1");
    add_user(&mut state, "bob", "2");
    state
}

fn add_user(state: &mut LobbyState, name: &str, user_id: &str) {
    state.users.insert(
        name.to_owned(),
        User {
            name: name.to_owned(),
            user_id: user_id.to_owned(),
            ..Default::default()
        },
    );
}

/// Put the state in a lobby, as the room's projection leaves it.
fn in_lobby(state: &mut LobbyState) {
    state.battles.insert(
        7,
        Battle {
            id: 7,
            tachyon_id: Some("lobby-a".into()),
            channel: Some(crate::tachyon_room::chat_channel(7)),
            ..Default::default()
        },
    );
    state.current_battle = Some(7);
}

/// A `messaging/received` frame carrying `source` and `message`.
fn received(source: Value, message: &str) -> String {
    json!({
        "type": "event",
        "messageId": "1",
        "commandId": "messaging/received",
        "data": {
            "message": message,
            "source": source,
            "timestamp": SENT_AT_MICROS,
            "marker": "-576460745805023",
        },
    })
    .to_string()
}

/// Fold a frame into the state the way the connection does.
fn feed(state: &mut LobbyState, frame: &str) -> Vec<Delta> {
    reduce(state, &parse_frame(frame), 999)
}

/// The lobby chat lines the battle room reads.
fn lobby_chat(state: &LobbyState) -> &[ChatMsg] {
    state.channels[&crate::tachyon_room::chat_channel(7)]
        .messages
        .as_slice()
}

#[test]
fn a_message_from_a_player_lands_in_their_thread() {
    let mut state = signed_in();

    let deltas = feed(
        &mut state,
        &received(
            json!({ "type": "player", "userId": "2" }),
            "are you playing",
        ),
    );

    let thread = &state.dms["bob"];
    assert_eq!(thread.len(), 1);
    assert_eq!(thread[0].from, "bob");
    assert_eq!(thread[0].text, "are you playing");
    assert_eq!(thread[0].kind, ChatKind::Private);
    // The server's own send time, in the milliseconds the log holds.
    assert_eq!(thread[0].at, SENT_AT_MILLIS);
    assert_eq!(deltas, vec![Delta::PrivateMessage { from: "bob".into() }]);
}

#[test]
fn a_message_from_someone_we_cannot_name_is_filed_under_their_id() {
    let mut state = signed_in();
    let frame = received(json!({ "type": "player", "userId": "99" }), "hello");

    let deltas = feed(&mut state, &frame);

    assert_eq!(state.dms["99"][0].from, "99");
    assert_eq!(deltas, vec![Delta::PrivateMessage { from: "99".into() }]);
    // And the connection is told to go and ask who they are.
    assert_eq!(
        sender_to_subscribe(&state, &parse_frame(&frame)),
        Some("99".into())
    );
}

#[test]
fn a_sender_we_can_already_name_is_not_asked_about() {
    let state = signed_in();
    let frame = received(json!({ "type": "player", "userId": "2" }), "hello");
    assert_eq!(sender_to_subscribe(&state, &parse_frame(&frame)), None);
}

#[test]
fn a_lobby_sender_is_not_asked_about() {
    let state = signed_in();
    let frame = received(
        json!({ "type": "lobby", "lobbyId": "lobby-a", "userId": "99" }),
        "hello",
    );
    assert_eq!(sender_to_subscribe(&state, &parse_frame(&frame)), None);
}

#[test]
fn a_thread_moves_onto_the_name_once_it_arrives() {
    let mut state = signed_in();
    feed(
        &mut state,
        &received(json!({ "type": "player", "userId": "99" }), "hello"),
    );

    add_user(&mut state, "carol", "99");
    let deltas = rename_threads(&mut state);

    assert!(
        !state.dms.contains_key("99"),
        "the id thread is still there"
    );
    assert_eq!(state.dms["carol"].len(), 1);
    assert_eq!(state.dms["carol"][0].text, "hello");
    assert_eq!(
        deltas,
        vec![Delta::PrivateMessage {
            from: "carol".into()
        }]
    );
}

#[test]
fn a_thread_already_under_a_name_is_left_alone() {
    let mut state = signed_in();
    feed(
        &mut state,
        &received(json!({ "type": "player", "userId": "2" }), "hello"),
    );

    assert_eq!(rename_threads(&mut state), vec![]);
    assert_eq!(state.dms["bob"].len(), 1);
}

#[test]
fn a_lobby_message_lands_in_the_battle_chat() {
    let mut state = signed_in();
    in_lobby(&mut state);

    let deltas = feed(
        &mut state,
        &received(
            json!({ "type": "lobby", "lobbyId": "lobby-a", "userId": "2" }),
            "!vote start",
        ),
    );

    let messages = lobby_chat(&state);
    assert_eq!(messages.len(), 1);
    assert_eq!(messages[0].from, "bob");
    assert_eq!(messages[0].text, "!vote start");
    assert_eq!(messages[0].kind, ChatKind::SaidBattle);
    assert_eq!(
        deltas,
        vec![Delta::ChatMessage {
            channel: Some(crate::tachyon_room::chat_channel(7)),
            index: 0,
        }]
    );
}

#[test]
fn a_lobby_message_from_a_lobby_we_are_not_in_is_dropped() {
    let mut state = signed_in();
    in_lobby(&mut state);

    let deltas = feed(
        &mut state,
        &received(
            json!({ "type": "lobby", "lobbyId": "lobby-b", "userId": "2" }),
            "wrong room",
        ),
    );

    assert_eq!(deltas, vec![]);
    assert!(state.channels.is_empty());
}

#[test]
fn our_own_message_coming_back_is_dropped() {
    let mut state = signed_in();
    in_lobby(&mut state);

    // Both shapes: a lobby that echoes to everyone, and a replay of what we
    // sent. Either would otherwise be a second copy of a line we already have.
    let lobby = feed(
        &mut state,
        &received(
            json!({ "type": "lobby", "lobbyId": "lobby-a", "userId": "1" }),
            "mine",
        ),
    );
    let direct = feed(
        &mut state,
        &received(json!({ "type": "player", "userId": "1" }), "mine"),
    );

    assert_eq!(lobby, vec![]);
    assert_eq!(direct, vec![]);
    assert!(state.channels.is_empty());
    assert!(state.dms.is_empty());
}

#[test]
fn a_party_message_has_nowhere_to_go_and_is_dropped() {
    let mut state = signed_in();
    in_lobby(&mut state);

    let deltas = feed(
        &mut state,
        &received(
            json!({ "type": "party", "partyId": "p1", "userId": "2" }),
            "party up",
        ),
    );

    assert_eq!(deltas, vec![]);
    assert!(state.dms.is_empty());
    assert!(state.channels.is_empty());
}

#[test]
fn a_frame_that_is_not_chat_leaves_the_state_alone() {
    let mut state = signed_in();
    assert_eq!(feed(&mut state, r#"{"not":"a tachyon frame"}"#), vec![]);
    assert!(state.dms.is_empty());
}

#[test]
fn every_chat_message_carries_the_marker_to_resume_from() {
    let frame = received(json!({ "type": "player", "userId": "2" }), "hello");
    assert_eq!(
        marker_of(&parse_frame(&frame)),
        Some("-576460745805023"),
        "the marker a reconnect resumes from"
    );
    assert_eq!(marker_of(&parse_frame(r#"{"not":"a frame"}"#)), None);
}

#[test]
fn a_direct_message_is_addressed_by_user_id() {
    let state = signed_in();

    let request = send_request(&state, &Conversation::Peer("bob".into()), "hello").unwrap();

    assert_eq!(
        request,
        json!({ "target": { "type": "player", "userId": "2" }, "message": "hello" })
    );
}

#[test]
fn lobby_chat_names_no_lobby_because_we_are_only_in_one() {
    let mut state = signed_in();
    in_lobby(&mut state);

    let request = send_request(&state, &Conversation::Lobby, "hello all").unwrap();

    assert_eq!(
        request,
        json!({ "target": { "type": "lobby" }, "message": "hello all" })
    );
}

#[test]
fn a_message_over_the_limit_is_refused_before_it_is_sent() {
    let state = signed_in();
    let long: String = "a".repeat(MESSAGE_LIMIT + 1);

    assert_eq!(
        send_request(&state, &Conversation::Peer("bob".into()), &long),
        Err(Refusal::TooLong)
    );
    // Exactly at the limit still goes.
    let at_limit = "a".repeat(MESSAGE_LIMIT);
    assert!(send_request(&state, &Conversation::Peer("bob".into()), &at_limit).is_ok());
}

#[test]
fn the_limit_counts_characters_rather_than_bytes() {
    let state = signed_in();
    // Four bytes each, so 512 of them is 2048 bytes and still one message.
    let emoji = "🙂".repeat(MESSAGE_LIMIT);
    assert!(send_request(&state, &Conversation::Peer("bob".into()), &emoji).is_ok());
}

#[test]
fn a_person_we_cannot_see_cannot_be_addressed() {
    let state = signed_in();
    assert_eq!(
        send_request(&state, &Conversation::Peer("carol".into()), "hello"),
        Err(Refusal::UnknownPeer)
    );
}

#[test]
fn lobby_chat_with_no_lobby_is_refused() {
    let state = signed_in();
    assert_eq!(
        send_request(&state, &Conversation::Lobby, "hello"),
        Err(Refusal::NotInLobby)
    );
}

#[test]
fn a_subscription_resumes_from_the_marker_when_there_is_one() {
    assert_eq!(
        subscribe_request(Some("-576460745805023")),
        json!({ "since": { "type": "marker", "value": "-576460745805023" } })
    );
    assert_eq!(
        subscribe_request(None),
        json!({ "since": { "type": "latest" } })
    );
}

#[test]
fn a_sent_direct_message_appears_in_the_thread_under_our_own_name() {
    let mut state = signed_in();

    let deltas = record_sent(&mut state, &Conversation::Peer("bob".into()), "hello", 500);

    let thread = &state.dms["bob"];
    assert_eq!(thread[0].from, "alice");
    assert_eq!(thread[0].text, "hello");
    assert_eq!(thread[0].at, 500);
    assert_eq!(deltas, vec![Delta::PrivateMessage { from: "bob".into() }]);
}

#[test]
fn a_sent_lobby_message_appears_in_the_battle_chat() {
    let mut state = signed_in();
    in_lobby(&mut state);

    record_sent(&mut state, &Conversation::Lobby, "hello all", 500);

    assert_eq!(lobby_chat(&state)[0].from, "alice");
    assert_eq!(lobby_chat(&state)[0].text, "hello all");
}

#[test]
fn a_message_that_did_not_go_says_so_where_it_would_have_gone() {
    let mut state = signed_in();

    let deltas = record_not_sent(
        &mut state,
        &Conversation::Peer("bob".into()),
        "hello",
        &Refusal::UnknownPeer.text(),
        500,
    );

    let thread = &state.dms["bob"];
    assert_eq!(thread.len(), 1);
    assert_eq!(thread[0].kind, ChatKind::System);
    // The text is still in front of the user, so nothing they typed is lost.
    assert!(
        thread[0].text.starts_with("Not sent.") && thread[0].text.ends_with("hello"),
        "unhelpful note: {}",
        thread[0].text
    );
    assert_eq!(deltas, vec![Delta::PrivateMessage { from: "bob".into() }]);
}

#[test]
fn a_lobby_message_that_did_not_go_says_so_in_the_battle_chat() {
    let mut state = signed_in();
    in_lobby(&mut state);

    record_not_sent(&mut state, &Conversation::Lobby, "hello", "No.", 500);

    assert_eq!(lobby_chat(&state)[0].kind, ChatKind::System);
    assert!(lobby_chat(&state)[0].text.contains("hello"));
}

#[test]
fn a_lobby_message_with_no_lobby_left_is_still_put_in_front_of_the_user() {
    let mut state = signed_in();

    let deltas = record_not_sent(&mut state, &Conversation::Lobby, "hello", "No.", 500);

    let Some(Delta::ServerMessage { text, .. }) = deltas.first() else {
        panic!("the message went nowhere: {deltas:?}");
    };
    assert!(text.contains("hello"));
}
