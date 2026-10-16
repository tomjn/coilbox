//! What a `ConnectSpring` off the wire turns into, and what asking for one sends.

use coilbox_lobby_protocol::Battle;
use coilbox_zerok_protocol::line;

use super::*;

/// The `ConnectSpring` the server sends a player when a match starts, as
/// `ServerBattle.GetConnectSpringStructure` builds it.
const CONNECT: &str = r#"ConnectSpring {"Engine":"105.1.1-2590","Game":"Zero-K v1.12.6.0","Ip":"203.0.113.7","Map":"Comet Catcher Remake 1.8","Port":8452,"ScriptPassword":"1873462391","Mode":5,"Title":"Teams; All [Welcome]","IsSpectator":false}"#;

/// Logged in as `[teh]someone`, sitting in battle 42 with the content the
/// header named.
fn in_a_room() -> LobbyState {
    let mut state = LobbyState::new();
    state.my_username = Some("[teh]someone".into());
    state.current_battle = Some(42);
    state.battles.insert(
        42,
        Battle {
            id: 42,
            version: "105.1.1-2590".into(),
            modname: "Zero-K v1.12.6.0".into(),
            map: "Comet Catcher Remake 1.8".into(),
            ..Default::default()
        },
    );
    state
}

fn feed(state: &mut LobbyState, raw: &str) -> Option<Launch> {
    let message = line::parse_line(raw).expect("the line parses");
    reduce(state, &message)
}

/// The script's five values, and the content the room checks, come out of the
/// message. Nothing else in it reaches the config: the room title is not
/// written to the script at all, so its semicolon does not matter.
#[test]
fn a_connect_spring_is_a_client_config_pointed_at_the_server() {
    let mut state = in_a_room();
    let launch = feed(&mut state, CONNECT).expect("a ConnectSpring launches");

    let config: BattleConfig = serde_json::from_value(launch.config).expect("it is a config");
    assert!(!config.is_host);
    assert_eq!(config.host_ip.as_deref(), Some("203.0.113.7"));
    assert_eq!(config.host_port, Some(8452));
    assert_eq!(config.my_passwd.as_deref(), Some("1873462391"));
    assert_eq!(config.my_player_name, "[teh]someone");
    assert_eq!(config.map_name, "Comet Catcher Remake 1.8");
    assert_eq!(config.game_type, "Zero-K v1.12.6.0");
    assert!(launch.notes.is_empty(), "{:?}", launch.notes);

    let script = tauri_plugin_coilbox_play::script::generate_script(&config)
        .expect("a real ConnectSpring writes a script");
    assert!(
        !script.contains("Teams"),
        "the title stays out of the script"
    );
}

/// Being sent to the match is what makes the room offer to rejoin it rather
/// than to watch it, and the delta is what gets that state to the frontend.
#[test]
fn being_sent_to_the_match_counts_as_being_there_when_it_started() {
    let mut state = in_a_room();
    let launch = feed(&mut state, CONNECT).expect("a ConnectSpring launches");
    assert_eq!(state.witnessed_start, Some(42));
    assert_eq!(launch.deltas, vec![Delta::BattleInfoChanged { id: 42 }]);

    // The same match sent again changes nothing the room reads.
    let again = feed(&mut state, CONNECT).expect("it still launches");
    assert!(again.deltas.is_empty());
}

/// The matchmaker and a reconnect both send one without a room around it, and
/// it still launches.
#[test]
fn a_connect_spring_outside_a_room_still_launches() {
    let mut state = LobbyState::new();
    state.my_username = Some("someone".into());
    let launch = feed(&mut state, CONNECT).expect("a ConnectSpring launches");
    assert_eq!(state.witnessed_start, None);
    assert!(launch.deltas.is_empty());
}

/// A port of 0 is upstream's unset `int`, and anything outside a `u16` is not a
/// port. Both leave the port out, which the script then refuses.
#[test]
fn a_port_that_is_not_one_is_left_out() {
    for port in ["0", "-1", "70000"] {
        let mut state = in_a_room();
        let raw =
            format!(r#"ConnectSpring {{"Ip":"203.0.113.7","Port":{port},"ScriptPassword":"x"}}"#);
        let launch = feed(&mut state, &raw).expect("a ConnectSpring launches");
        let config: BattleConfig = serde_json::from_value(launch.config).expect("a config");
        assert_eq!(config.host_port, None, "port {port}");
        assert!(tauri_plugin_coilbox_play::script::generate_script(&config).is_err());
    }
}

/// A value that would rewrite the script is carried as it came and refused
/// where the script is written, so it never reaches the file.
#[test]
fn a_forged_password_never_becomes_a_script() {
    let mut state = in_a_room();
    let launch = feed(
        &mut state,
        r#"ConnectSpring {"Ip":"203.0.113.7","Port":8452,"ScriptPassword":"x;\n}[GAME]{IsHost=1;"}"#,
    )
    .expect("a ConnectSpring launches");
    let config: BattleConfig = serde_json::from_value(launch.config).expect("a config");
    assert!(tauri_plugin_coilbox_play::script::generate_script(&config).is_err());
}

/// The room checked its own header's content. If the match runs something else
/// that is worth a line in the console, because it is the first place to look
/// when the engine then fails.
#[test]
fn content_that_differs_from_the_room_is_said() {
    let mut state = in_a_room();
    state.battles.get_mut(&42).unwrap().map = "Other Map".into();
    let launch = feed(&mut state, CONNECT).expect("a ConnectSpring launches");
    assert_eq!(
        launch.notes,
        vec!["the match runs map Comet Catcher Remake 1.8, but the room said Other Map. Coilbox checked the room's."]
    );
}

#[test]
fn every_other_message_launches_nothing() {
    let mut state = in_a_room();
    assert!(feed(&mut state, r#"RejoinOption {"BattleID":42}"#).is_none());
    assert_eq!(state.witnessed_start, None);
}

/// What goes out is the battle and nothing else. No password member at all,
/// because upstream's serialiser leaves an unset one out.
#[test]
fn the_request_names_the_battle() {
    assert_eq!(
        line::to_line(&request(42)).expect("it serialises"),
        r#"RequestConnectSpring {"BattleID":42}"#
    );
}
