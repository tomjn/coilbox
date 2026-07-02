//! Golden test: a representative login transcript through parse + reduce, then
//! assertions about the resulting `LobbyState`.

use coilbox_lobby_protocol::{parse_line, reduce, LobbyState};

const TRANSCRIPT: &[&str] = &[
    "TASSERVER 0.38 * 8201 0",
    "ACCEPTED alice",
    "MOTD Welcome to the server",
    "MOTD Have fun",
    "ADDUSER alice GB 1 Coilbox 0.1",
    "ADDUSER bob US 2 SpringLobby 0.2",
    "ADDUSER carol DE 3 Chobby 1.0",
    "BATTLEOPENED 7 0 0 bob 1.2.3.4 8452 16 0 0 -1 spring\t105\tDeltaSiegeDry\tBob's Cool Game\tBAR",
    "UPDATEBATTLEINFO 7 2 0 -1 DeltaSiegeDry",
    "JOINEDBATTLE 7 bob",
    "CLIENTSTATUS bob 1",
    "LOGININFOEND",
];

#[test]
fn transcript_builds_expected_state() {
    let mut state = LobbyState::new();
    for line in TRANSCRIPT {
        reduce(&mut state, parse_line(line));
    }

    // Logged in as alice.
    assert_eq!(state.my_username.as_deref(), Some("alice"));

    // Three users present.
    assert_eq!(state.users.len(), 3);
    assert!(state.users.contains_key("alice"));
    assert!(state.users.contains_key("bob"));
    assert!(state.users.contains_key("carol"));
    assert_eq!(state.users["bob"].country, "US");
    assert_eq!(state.users["bob"].user_id, "2");
    assert_eq!(state.users["bob"].agent, "SpringLobby 0.2");

    // bob's ingame bit was flipped by CLIENTSTATUS.
    assert!(state.users["bob"].status.ingame);

    // One battle, correct host/map/mod.
    assert_eq!(state.battles.len(), 1);
    let battle = state.battles.get(&7).expect("battle 7 present");
    assert_eq!(battle.host, "bob");
    assert_eq!(battle.ip, "1.2.3.4");
    assert_eq!(battle.map, "DeltaSiegeDry");
    assert_eq!(battle.modname, "BAR");
    assert_eq!(battle.engine, "spring");
    assert_eq!(battle.version, "105");
    assert_eq!(battle.title, "Bob's Cool Game");
    assert_eq!(battle.max_players, 16);
    assert_eq!(battle.spectator_count, 2);

    // bob joined battle 7.
    assert!(battle.members.contains_key("bob"));
}
