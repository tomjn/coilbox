//! Round trip: lines built by the `server` module, read back by the client half.
//!
//! The two halves are checked against each other rather than against a hand
//! written transcript. A builder that drifts from the parser fails here even if
//! both look right on their own, which is the failure a host with no lobby server
//! would otherwise only show on a second machine.

use std::collections::BTreeMap;

use coilbox_lobby_protocol::server::{line, BattleOpened};
use coilbox_lobby_protocol::{
    default_battle_status, parse_line, reduce, BattleStatus, ClientStatus, Delta, LobbyState,
};

/// Feed one built line through the client half, returning the deltas it produced.
fn feed(state: &mut LobbyState, built: &str) -> Vec<Delta> {
    reduce(state, parse_line(built))
}

fn room_battle() -> BattleOpened {
    BattleOpened {
        id: 1,
        battle_type: 0,
        nat_type: 0,
        host: "alice".into(),
        ip: "192.168.0.5".into(),
        port: 8452,
        max_players: 16,
        passworded: false,
        rank: 0,
        maphash: -1,
        engine: "spring".into(),
        version: "105.1.1".into(),
        map: "Red Comet".into(),
        title: "Tom's LAN game".into(),
        modname: "Beyond All Reason test-1234".into(),
        channel: Some("__battle__1".into()),
    }
}

/// The whole joiner path: handshake, room, options, boxes, bots, chat, launch.
#[test]
fn a_joiner_reads_back_the_room_the_host_built() {
    let mut state = LobbyState::new();
    let bob_status = BattleStatus {
        ally: 1,
        team_id: 1,
        mode: true,
        ..default_battle_status()
    };
    let mut tags = BTreeMap::new();
    tags.insert("game/startpostype".to_string(), "2".to_string());
    tags.insert("game/modoptions/maxunits".to_string(), "2000".to_string());

    feed(&mut state, &line::tas_server("0.38", "*", 8452, 0));
    feed(&mut state, &line::comp_flags(&["u", "sp"]));
    feed(&mut state, &line::accepted("bob"));
    feed(
        &mut state,
        &line::add_user("alice", "??", "1", "Coilbox 0.1"),
    );
    feed(&mut state, &line::add_user("bob", "??", "2", "Coilbox 0.1"));
    feed(&mut state, &line::battle_opened(&room_battle()));
    feed(&mut state, &line::login_info_end());

    // The join acknowledgement, then everything that depends on it.
    let deltas = feed(&mut state, &line::join_battle(1, -1, Some("__battle__1")));
    assert_eq!(deltas, vec![Delta::EnteredBattle { id: 1, own: false }]);
    feed(&mut state, &line::joined_battle(1, "bob", None));
    feed(
        &mut state,
        &line::client_battle_status("alice", default_battle_status(), 255),
    );
    feed(
        &mut state,
        &line::client_battle_status("bob", bob_status, 16_711_680),
    );
    feed(&mut state, &line::set_script_tags(&tags));
    feed(&mut state, &line::add_start_rect(0, 0, 0, 50, 200));
    feed(&mut state, &line::add_start_rect(1, 150, 0, 200, 200));
    feed(
        &mut state,
        &line::add_bot(1, "Barb", "alice", default_battle_status(), 255, "BARb"),
    );
    feed(
        &mut state,
        &line::update_battle_info(1, 1, false, -1, "Red Comet"),
    );
    feed(&mut state, &line::said_battle("alice", "hello   there"));

    // The room is what the host described.
    assert_eq!(state.my_username.as_deref(), Some("bob"));
    assert!(state.compflags.contains("sp"));
    assert_eq!(state.current_battle, Some(1));
    let battle = state.battles.get(&1).expect("battle 1 present");
    assert_eq!(battle.host, "alice");
    assert_eq!(battle.ip, "192.168.0.5");
    assert_eq!(battle.port, "8452");
    assert_eq!(battle.map, "Red Comet");
    assert_eq!(battle.title, "Tom's LAN game");
    assert_eq!(battle.modname, "Beyond All Reason test-1234");
    assert_eq!(battle.engine, "spring");
    assert_eq!(battle.version, "105.1.1");
    assert_eq!(battle.max_players, 16);
    assert_eq!(battle.spectator_count, 1);
    assert!(!battle.passworded);
    assert_eq!(battle.channel.as_deref(), Some("__battle__1"));

    // Both members, with the status and colour the room gave them.
    assert_eq!(battle.members.len(), 2);
    assert_eq!(battle.members["bob"].battle_status, bob_status);
    assert_eq!(battle.members["bob"].team_color, 16_711_680);
    assert_eq!(
        battle.members["alice"].battle_status,
        default_battle_status()
    );

    // Options, boxes and the bot.
    assert_eq!(battle.script_tags["game/startpostype"], "2");
    assert_eq!(battle.script_tags["game/modoptions/maxunits"], "2000");
    assert_eq!(battle.start_rects.len(), 2);
    assert_eq!(battle.start_rects[&1].left, 150);
    assert_eq!(battle.start_rects[&1].bottom, 200);
    assert_eq!(battle.bots["Barb"].owner, "alice");
    assert_eq!(battle.bots["Barb"].ai_dll, "BARb");

    // Battle chat landed in the battle's own channel, spacing intact.
    let chat = &state.channels["__battle__1"].messages;
    assert_eq!(chat.len(), 1);
    assert_eq!(chat[0].from, "alice");
    assert_eq!(chat[0].text, "hello   there");

    // Starting the match: the room sets the host's ingame bit and the joiner's
    // battle room launches off that. There is no start message to send.
    let ingame = ClientStatus {
        ingame: true,
        ..Default::default()
    };
    let deltas = feed(&mut state, &line::client_status("alice", ingame));
    assert!(deltas.contains(&Delta::PlayerWentIngame {
        name: "alice".into()
    }));
    assert!(state.users["alice"].status.ingame);
}

/// `SETSCRIPTTAGS` and `ADDSTARTRECT` carry no battle id, so they apply to
/// whatever the receiver's current battle is. Sent before the join
/// acknowledgement there is no current battle, and they are dropped without a
/// trace: the joiner sits in a room with no boxes and no options, and nothing in
/// the log says why.
#[test]
fn current_battle_scoped_lines_need_the_join_ack_first() {
    let mut tags = BTreeMap::new();
    tags.insert("game/startpostype".to_string(), "2".to_string());

    let mut early = LobbyState::new();
    feed(&mut early, &line::accepted("bob"));
    feed(&mut early, &line::battle_opened(&room_battle()));
    feed(&mut early, &line::set_script_tags(&tags));
    feed(&mut early, &line::add_start_rect(0, 0, 0, 50, 200));
    feed(&mut early, &line::join_battle(1, -1, Some("__battle__1")));
    let battle = &early.battles[&1];
    assert!(battle.script_tags.is_empty(), "tags landed with no battle");
    assert!(battle.start_rects.is_empty(), "rects landed with no battle");

    let mut ordered = LobbyState::new();
    feed(&mut ordered, &line::accepted("bob"));
    feed(&mut ordered, &line::battle_opened(&room_battle()));
    feed(&mut ordered, &line::join_battle(1, -1, Some("__battle__1")));
    feed(&mut ordered, &line::set_script_tags(&tags));
    feed(&mut ordered, &line::add_start_rect(0, 0, 0, 50, 200));
    let battle = &ordered.battles[&1];
    assert_eq!(battle.script_tags["game/startpostype"], "2");
    assert_eq!(battle.start_rects[&0].right, 50);

    // Removals are scoped the same way, so a box cleared before the ack would
    // leave the joiner holding one the host has already dropped.
    feed(&mut ordered, &line::remove_start_rect(0));
    feed(
        &mut ordered,
        &line::remove_script_tags(&["game/startpostype"]),
    );
    let battle = &ordered.battles[&1];
    assert!(battle.start_rects.is_empty());
    assert!(battle.script_tags.is_empty());
}

/// The host's own connection is a client too, so its acknowledgement has to build
/// the same state a real server's would.
#[test]
fn the_host_reads_back_its_own_room() {
    let mut state = LobbyState::new();
    feed(&mut state, &line::accepted("alice"));
    feed(
        &mut state,
        &line::add_user("alice", "??", "1", "Coilbox 0.1"),
    );
    feed(&mut state, &line::battle_opened(&room_battle()));

    let deltas = feed(&mut state, &line::open_battle(1));
    assert_eq!(deltas, vec![Delta::EnteredBattle { id: 1, own: true }]);
    feed(&mut state, &line::host_port(8452));
    assert_eq!(state.current_battle, Some(1));
    assert_eq!(state.host_port, Some(8452));

    // A joiner arrives, and only the host is told their script password.
    feed(&mut state, &line::add_user("bob", "??", "2", "Coilbox 0.1"));
    feed(&mut state, &line::joined_battle(1, "bob", Some("s3cret")));
    assert_eq!(
        state.battles[&1].members["bob"].script_password.as_deref(),
        Some("s3cret")
    );
}

/// Refusals and departures, which are the paths a room takes when something goes
/// wrong. Each has to reach the joiner as a named reason, not a silent drop.
#[test]
fn refusals_and_departures_reach_the_joiner_named() {
    let mut state = LobbyState::new();
    feed(&mut state, &line::accepted("bob"));

    let deltas = feed(&mut state, &line::denied("name already taken"));
    assert_eq!(
        deltas,
        vec![Delta::LoginDenied {
            reason: "name already taken".into()
        }]
    );

    let deltas = feed(&mut state, &line::join_battle_failed("wrong room password"));
    assert_eq!(
        deltas,
        vec![Delta::JoinBattleFailed {
            reason: "wrong room password".into()
        }]
    );

    feed(&mut state, &line::battle_opened(&room_battle()));
    feed(&mut state, &line::join_battle(1, -1, Some("__battle__1")));
    feed(&mut state, &line::joined_battle(1, "bob", None));

    // Kicked: the room takes us out of the battle it put us in.
    feed(&mut state, &line::left_battle(1, "bob"));
    assert_eq!(state.current_battle, None);
    assert!(!state.battles[&1].members.contains_key("bob"));

    // The host quit, so the battle goes with it.
    feed(&mut state, &line::battle_closed(1));
    assert!(state.battles.is_empty());
    feed(&mut state, &line::remove_user("alice"));
    assert!(!state.users.contains_key("alice"));
}
