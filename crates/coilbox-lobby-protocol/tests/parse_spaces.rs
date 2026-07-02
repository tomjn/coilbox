//! Golden test: the greedy-last-field trap. A SAID with embedded spaces must
//! round-trip through parse + reduce with the message intact.

use coilbox_lobby_protocol::{parse_line, reduce, LobbyState, ServerMessage};

#[test]
fn said_with_spaces_survives_parse() {
    let msg = parse_line("SAID main bob hello   world, spaces    kept  intact");
    assert_eq!(
        msg,
        ServerMessage::Said {
            channel: "main".into(),
            username: "bob".into(),
            message: "hello   world, spaces    kept  intact".into(),
        }
    );
}

#[test]
fn said_with_spaces_stored_verbatim() {
    let mut state = LobbyState::new();
    reduce(&mut state, parse_line("JOIN main"));
    reduce(
        &mut state,
        parse_line("SAID main bob hello   world, spaces    kept  intact"),
    );
    let stored = &state.channels["main"].messages[0];
    assert_eq!(stored.from, "bob");
    assert_eq!(stored.text, "hello   world, spaces    kept  intact");
}

#[test]
fn battleopened_title_with_spaces_survives() {
    let msg = parse_line(
        "BATTLEOPENED 1 0 0 h 1.1.1.1 8452 8 0 0 -1 spring\t105\tmap\tA Very Long Title Here\tBAR",
    );
    match msg {
        ServerMessage::BattleOpened { title, .. } => assert_eq!(title, "A Very Long Title Here"),
        other => panic!("expected BattleOpened, got {other:?}"),
    }
}
