use super::*;
use coilbox_lobby_protocol::Battle;
use coilbox_tachyon_protocol::parse_frame;
use serde_json::{json, Value};

/// A whole `lobbyDetails`, with the fields the schema requires and nothing else,
/// so a test only spells out what it cares about.
///
/// Two players facing each other: user 1 ready with the content, user 2 not
/// ready and missing it.
fn details(patch: Value) -> Value {
    let mut base = json!({
        "id": "lobby-a",
        "name": "Comet Catcher 8v8",
        "mapName": "Comet Catcher Remake 1.8",
        "engineVersion": "2025.01.4",
        "gameVersion": "Beyond All Reason test-1234",
        "areBossesEnabled": false,
        "gameOptions": {},
        "bosses": {},
        "bots": {},
        "spectators": {},
        "players": {
            "01": {
                "id": "1",
                "allyTeam": "01",
                "team": "01",
                "player": "01",
                "isReady": true,
                "assetStatus": "complete",
            },
            "02": {
                "id": "2",
                "allyTeam": "02",
                "team": "01",
                "player": "01",
                "isReady": false,
                "assetStatus": "missing",
            },
        },
        "allyTeamConfig": {
            "01": {
                "maxTeams": 1,
                "startBox": { "left": 0.0, "top": 0.0, "right": 0.25, "bottom": 1.0 },
                "teams": { "01": { "maxPlayers": 8 } },
            },
            "02": {
                "maxTeams": 1,
                "startBox": { "left": 0.75, "top": 0.0, "right": 1.0, "bottom": 1.0 },
                "teams": { "01": { "maxPlayers": 8 } },
            },
        },
    });
    merge(&mut base, patch);
    base
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

/// The `lobby/join` response, which carries the whole lobby.
fn join_frame(details: Value) -> String {
    json!({
        "type": "response",
        "messageId": "1",
        "commandId": "lobby/join",
        "status": "success",
        "data": details,
    })
    .to_string()
}

/// A `lobby/updated` event carrying the given merge patch verbatim.
fn updated_frame(patch: Value) -> String {
    json!({
        "type": "event",
        "messageId": "2",
        "commandId": "lobby/updated",
        "data": patch,
    })
    .to_string()
}

/// A `lobby/left` event, which is the server taking us out.
fn left_frame(id: &str, reason: &str) -> String {
    json!({
        "type": "event",
        "messageId": "3",
        "commandId": "lobby/left",
        "data": { "id": id, "reason": reason },
    })
    .to_string()
}

/// A `user/updated` event naming one person, the way `users` learns a name.
fn user_frame(id: &str, username: &str) -> String {
    json!({
        "type": "event",
        "messageId": "4",
        "commandId": "user/updated",
        "data": { "users": [{ "userId": id, "username": username, "status": "menu" }] },
    })
    .to_string()
}

/// Fold a frame into the room the way the connection does.
fn feed(room: &mut Option<Room>, state: &mut LobbyState, frame: &str) -> Vec<Delta> {
    reduce(room, state, &parse_frame(frame))
}

/// Someone the connection can name, which is what a subscription produces.
fn known(state: &mut LobbyState, id: &str, name: &str) {
    state.users.insert(
        name.to_owned(),
        User {
            name: name.to_owned(),
            user_id: id.to_owned(),
            ..Default::default()
        },
    );
}

/// A room with both players named, which is the ordinary case. We are alice,
/// so the seat controls have someone to act for.
fn joined_room() -> (Option<Room>, LobbyState) {
    joined_as(details(json!({})))
}

/// A room built from `details`, joined as alice.
fn joined_as(details: Value) -> (Option<Room>, LobbyState) {
    let mut state = LobbyState::new();
    state.my_username = Some("alice".into());
    known(&mut state, "1", "alice");
    known(&mut state, "2", "bob");
    let mut room = None;
    feed(&mut room, &mut state, &join_frame(details));
    (room, state)
}

/// The seat the room pushes: a player on ally 0, ready, with the content.
fn seated() -> BattleStatus {
    BattleStatus {
        ready: true,
        team_id: 0,
        ally: 0,
        mode: true,
        handicap: 0,
        sync: 1,
        side: 0,
    }
}

/// What one control's action asks of the server.
fn asked(room: &Option<Room>, state: &LobbyState, action: RoomAction) -> Vec<(String, Value)> {
    requests_for(room, state, &action)
        .into_iter()
        .map(|request| {
            (
                request.command.to_owned(),
                request.data.unwrap_or(Value::Null),
            )
        })
        .collect()
}

/// The battle the room reads.
fn battle(state: &LobbyState) -> &Battle {
    let id = state.current_battle.expect("we are not in a battle");
    state
        .battles
        .get(&id)
        .unwrap_or_else(|| panic!("no battle {id}: {:?}", state.battles.keys()))
}

#[test]
fn a_join_puts_us_in_the_room() {
    let (_room, state) = joined_room();

    let battle = battle(&state);
    assert_eq!(battle.tachyon_id.as_deref(), Some("lobby-a"));
    assert_eq!(battle.title, "Comet Catcher 8v8");
    assert_eq!(battle.map, "Comet Catcher Remake 1.8");
    assert_eq!(battle.version, "2025.01.4");
    assert_eq!(battle.modname, "Beyond All Reason test-1234");
    assert_eq!(battle.player_count, Some(2));
    assert_eq!(state.last_battle, state.current_battle);
    assert_eq!(
        battle.members.keys().cloned().collect::<Vec<_>>().len(),
        2,
        "the roster is {:?}",
        battle.members
    );
}

#[test]
fn a_join_says_the_room_is_open_before_it_says_we_are_in_it() {
    // The frontend navigates off `enteredBattle`, so the battle it navigates to
    // has to be in the snapshot by then.
    let mut state = LobbyState::new();
    let mut room = None;
    let deltas = feed(&mut room, &mut state, &join_frame(details(json!({}))));

    let id = state.current_battle.expect("we are not in a battle");
    assert_eq!(
        deltas,
        vec![
            Delta::BattleOpened { id },
            Delta::EnteredBattle { id, own: false },
        ]
    );
}

#[test]
fn a_join_keeps_the_handle_and_the_fields_the_list_carries() {
    // The lobby list holds `maxPlayerCount` and `lobbyDetails` does not, so the
    // room must not blank it, and the handle the deep link and the frontend hold
    // must not move.
    let mut state = LobbyState::new();
    let listed = crate::tachyon_lobbies::handle_for("lobby-a", &state.battles);
    state.battles.insert(
        listed,
        Battle {
            id: listed,
            tachyon_id: Some("lobby-a".into()),
            max_players: 16,
            ..Default::default()
        },
    );

    let mut room = None;
    let deltas = feed(&mut room, &mut state, &join_frame(details(json!({}))));

    assert_eq!(state.current_battle, Some(listed));
    assert_eq!(battle(&state).max_players, 16);
    assert_eq!(
        deltas,
        vec![
            Delta::BattleInfoChanged { id: listed },
            Delta::EnteredBattle {
                id: listed,
                own: false
            },
        ]
    );
}

#[test]
fn the_projection_fills_what_the_battle_room_reads() {
    let (_room, state) = joined_room();
    let battle = battle(&state);

    let alice = &battle.members["alice"].battle_status;
    assert!(alice.ready);
    assert!(alice.mode, "a player is not a spectator");
    assert_eq!(alice.ally, 0);
    assert_eq!(alice.team_id, 0);
    assert_eq!(alice.sync, 1, "complete assets read as synced");

    let bob = &battle.members["bob"].battle_status;
    assert!(!bob.ready);
    assert_eq!(bob.ally, 1);
    assert_eq!(bob.team_id, 1, "a team is numbered across the lobby");
    assert_eq!(bob.sync, 2, "missing assets read as unsynced");

    // The start box is a fraction of the map, and a start rect is 0 to 200.
    assert_eq!(
        battle.start_rects[&0],
        StartRect {
            left: 0,
            top: 0,
            right: 50,
            bottom: 200,
        }
    );
    assert_eq!(battle.start_rects[&1].left, 150);
}

#[test]
fn a_spectator_is_in_the_roster_and_is_not_a_player() {
    let mut state = LobbyState::new();
    known(&mut state, "3", "carol");
    let mut room = None;
    feed(
        &mut room,
        &mut state,
        &join_frame(details(
            json!({ "spectators": { "01": { "id": "3", "joinQueuePosition": 2 } } }),
        )),
    );

    let battle = battle(&state);
    assert_eq!(battle.spectator_count, 1);
    assert!(!battle.members["carol"].battle_status.mode);
}

#[test]
fn a_bot_reaches_the_roster_under_the_name_it_shows() {
    let mut state = LobbyState::new();
    known(&mut state, "1", "alice");
    let mut room = None;
    feed(
        &mut room,
        &mut state,
        &join_frame(details(json!({
            "bots": { "01": {
                "id": "bot-1",
                "hostUserId": "1",
                "allyTeam": "02",
                "team": "01",
                "player": "01",
                "shortName": "BARb",
                "name": "Barbarian",
            } },
        }))),
    );

    let bot = &battle(&state).bots["Barbarian"];
    assert_eq!(bot.owner, "alice");
    assert_eq!(bot.ai_dll, "BARb");
    assert_eq!(bot.battle_status.ally, 1);
}

#[test]
fn a_patch_changes_one_player_and_leaves_the_rest() {
    let (mut room, mut state) = joined_room();

    let deltas = feed(
        &mut room,
        &mut state,
        &updated_frame(json!({
            "id": "lobby-a",
            "players": { "02": { "id": "2", "isReady": true } },
        })),
    );

    let battle = battle(&state);
    assert!(battle.members["bob"].battle_status.ready);
    // The fields the patch did not mention are still there.
    assert_eq!(battle.members["bob"].battle_status.ally, 1);
    assert_eq!(battle.members["bob"].battle_status.sync, 2);
    assert!(battle.members["alice"].battle_status.ready);
    assert_eq!(battle.player_count, Some(2));
    assert_eq!(deltas, vec![Delta::BattleInfoChanged { id: battle.id }]);
}

#[test]
fn a_patch_with_a_null_takes_a_player_out_of_the_roster() {
    let (mut room, mut state) = joined_room();

    let deltas = feed(
        &mut room,
        &mut state,
        &updated_frame(json!({ "id": "lobby-a", "players": { "02": null } })),
    );

    let battle = battle(&state);
    assert!(!battle.members.contains_key("bob"));
    assert!(battle.members.contains_key("alice"));
    assert_eq!(battle.player_count, Some(1));
    assert_eq!(deltas, vec![Delta::BattleInfoChanged { id: battle.id }]);
}

#[test]
fn a_patch_changes_the_map_the_room_shows() {
    let (mut room, mut state) = joined_room();

    feed(
        &mut room,
        &mut state,
        &updated_frame(json!({ "id": "lobby-a", "mapName": "Red Comet Remake 1.8" })),
    );

    assert_eq!(battle(&state).map, "Red Comet Remake 1.8");
    assert_eq!(battle(&state).title, "Comet Catcher 8v8");
}

#[test]
fn a_patch_for_another_lobby_is_dropped() {
    let (mut room, mut state) = joined_room();

    let deltas = feed(
        &mut room,
        &mut state,
        &updated_frame(json!({ "id": "another-lobby", "name": "Not ours" })),
    );

    assert_eq!(battle(&state).title, "Comet Catcher 8v8");
    assert_eq!(deltas, vec![]);
}

#[test]
fn a_repeat_of_what_we_already_hold_produces_no_delta() {
    let (mut room, mut state) = joined_room();

    let deltas = feed(
        &mut room,
        &mut state,
        &updated_frame(json!({ "id": "lobby-a", "players": { "02": { "id": "2" } } })),
    );
    assert_eq!(deltas, vec![]);
}

#[test]
fn leaving_clears_the_room() {
    let (mut room, mut state) = joined_room();
    let id = state.current_battle.expect("we are not in a battle");
    state.my_intended_battle_status = Some((BattleStatus::default(), 7));

    let deltas = left(&mut room, &mut state);

    assert!(room.is_none());
    assert_eq!(state.current_battle, None);
    assert_eq!(state.my_intended_battle_status, None);
    // The lobby is still listed, and the parts only the room filled in are gone.
    let battle = &state.battles[&id];
    assert_eq!(battle.title, "Comet Catcher 8v8");
    assert!(battle.members.is_empty());
    assert!(battle.start_rects.is_empty());
    assert_eq!(deltas, vec![Delta::BattleInfoChanged { id }]);
}

#[test]
fn a_patch_after_leaving_changes_nothing() {
    let (mut room, mut state) = joined_room();
    left(&mut room, &mut state);

    let deltas = feed(
        &mut room,
        &mut state,
        &updated_frame(json!({ "id": "lobby-a", "name": "Still patching" })),
    );

    assert_eq!(deltas, vec![]);
    assert_eq!(state.current_battle, None);
}

#[test]
fn being_thrown_out_clears_the_room_and_says_why() {
    let (mut room, mut state) = joined_room();
    let id = state.current_battle.expect("we are not in a battle");

    let deltas = feed(
        &mut room,
        &mut state,
        &left_frame("lobby-a", "kicked by a boss"),
    );

    assert!(room.is_none());
    assert_eq!(state.current_battle, None);
    assert!(state.battles[&id].members.is_empty());
    assert_eq!(
        deltas,
        vec![
            Delta::BattleInfoChanged { id },
            Delta::ServerMessage {
                text: "You are out of the lobby: kicked by a boss".into(),
                boxed: false,
            },
        ]
    );
}

#[test]
fn a_left_that_answers_our_own_leaving_says_nothing() {
    let (mut room, mut state) = joined_room();
    let id = state.current_battle.expect("we are not in a battle");
    mark_leaving(&mut room, true);

    let deltas = feed(&mut room, &mut state, &left_frame("lobby-a", "left"));

    assert!(room.is_none());
    assert_eq!(deltas, vec![Delta::BattleInfoChanged { id }]);
}

#[test]
fn a_left_for_another_lobby_leaves_us_where_we_are() {
    let (mut room, mut state) = joined_room();

    let deltas = feed(
        &mut room,
        &mut state,
        &left_frame("another-lobby", "kicked"),
    );

    assert!(room.is_some());
    assert!(state.current_battle.is_some());
    assert_eq!(deltas, vec![]);
}

#[test]
fn a_member_we_cannot_name_is_filed_under_their_id() {
    // #1226 drops offline users from `users`, and a lobby names its members by
    // id, so leaving them out of the roster would hide a real person.
    let mut state = LobbyState::new();
    known(&mut state, "1", "alice");
    let mut room = None;
    feed(&mut room, &mut state, &join_frame(details(json!({}))));

    assert!(battle(&state).members.contains_key("2"));
    assert!(battle(&state).members.contains_key("alice"));
}

#[test]
fn a_name_arriving_later_moves_the_member_off_their_id() {
    let mut state = LobbyState::new();
    known(&mut state, "1", "alice");
    let mut room = None;
    feed(&mut room, &mut state, &join_frame(details(json!({}))));
    let id = state.current_battle.expect("we are not in a battle");

    // What the subscription the connection sends on joining answers with. The
    // user reducer files the name, and the room re-projects off the same frame.
    let mut state_and_room = |frame: &str| {
        let mut deltas = crate::tachyon_users::reduce(&mut state, &parse_frame(frame));
        deltas.extend(reduce(&mut room, &mut state, &parse_frame(frame)));
        deltas
    };
    let deltas = state_and_room(&user_frame("2", "bob"));

    let battle = battle(&state);
    assert!(battle.members.contains_key("bob"));
    assert!(!battle.members.contains_key("2"));
    assert!(
        deltas.contains(&Delta::BattleInfoChanged { id }),
        "the roster changed and nothing said so: {deltas:?}"
    );
}

#[test]
fn the_ids_worth_subscribing_to_are_the_ones_we_cannot_name() {
    let mut state = LobbyState::new();
    known(&mut state, "1", "alice");
    let mut room = None;
    feed(
        &mut room,
        &mut state,
        &join_frame(details(json!({
            "spectators": { "01": { "id": "3" } },
            "bosses": { "4": {} },
            "bots": { "01": {
                "id": "bot-1",
                "hostUserId": "5",
                "allyTeam": "01",
                "team": "01",
                "player": "02",
                "shortName": "BARb",
            } },
        }))),
    );

    // Not 1, we know their name already.
    assert_eq!(ids_to_subscribe(&state, &room), vec!["2", "3", "5", "4"]);
}

#[test]
fn a_subscription_asks_for_no_more_than_the_schema_allows() {
    let mut state = LobbyState::new();
    let spectators: serde_json::Map<String, Value> = (0..150)
        .map(|n| (format!("{n:03}"), json!({ "id": (n + 100).to_string() })))
        .collect();
    let mut room = None;
    feed(
        &mut room,
        &mut state,
        &join_frame(details(json!({ "spectators": spectators }))),
    );

    assert_eq!(ids_to_subscribe(&state, &room).len(), SUBSCRIBE_LIMIT);
}

#[test]
fn the_bosses_reach_the_roster_under_their_names() {
    let (_room, state) = joined_as(details(
        json!({ "areBossesEnabled": true, "bosses": { "2": {}, "9": {} } }),
    ));

    let battle = battle(&state);
    assert!(battle.bosses_enabled);
    // 9 is nobody we can name yet, so they stand under their id until a
    // subscription answers, exactly as a member does.
    assert_eq!(battle.bosses, vec!["bob".to_owned(), "9".to_owned()]);
}

#[test]
fn a_lobby_with_no_bosses_says_so() {
    let (_room, state) = joined_room();

    assert!(!battle(&state).bosses_enabled);
    assert!(battle(&state).bosses.is_empty());
}

#[test]
fn turning_off_the_player_toggle_asks_to_spectate() {
    let (room, state) = joined_room();

    let asked = asked(
        &room,
        &state,
        RoomAction::OwnStatus(BattleStatus {
            mode: false,
            ..seated()
        }),
    );

    assert_eq!(asked, vec![("lobby/spectate".to_owned(), Value::Null)]);
}

#[test]
fn a_spectator_asked_to_spectate_again_asks_for_nothing() {
    let (room, state) = joined_as(details(json!({
        "players": {},
        "spectators": { "01": { "id": "1" } },
    })));

    let asked = asked(
        &room,
        &state,
        RoomAction::OwnStatus(BattleStatus {
            mode: false,
            ..seated()
        }),
    );

    assert!(asked.is_empty(), "{asked:?}");
}

#[test]
fn the_ally_picker_names_the_ally_team_the_index_stands_for() {
    let (room, state) = joined_room();

    let asked = asked(
        &room,
        &state,
        RoomAction::OwnStatus(BattleStatus {
            ally: 1,
            ..seated()
        }),
    );

    assert_eq!(
        asked,
        vec![("lobby/joinAllyTeam".to_owned(), json!({ "allyTeam": "02" }))]
    );
}

#[test]
fn a_seat_push_that_changes_nothing_asks_for_nothing() {
    // Every control pushes the whole status, so most pushes carry no news. One
    // request each would spend the server's ten a second on nothing.
    let (room, state) = joined_room();

    let asked = asked(&room, &state, RoomAction::OwnStatus(seated()));

    assert!(asked.is_empty(), "{asked:?}");
}

#[test]
fn a_spectator_taking_a_seat_asks_for_the_ally_team_alone() {
    // The server has no assets on file for someone who was not playing, so
    // reporting them is the room's next push rather than this one.
    let (room, state) = joined_as(details(json!({
        "players": {},
        "spectators": { "01": { "id": "1" } },
    })));

    let asked = asked(
        &room,
        &state,
        RoomAction::OwnStatus(BattleStatus {
            ready: false,
            sync: 2,
            ..seated()
        }),
    );

    assert_eq!(
        asked,
        vec![("lobby/joinAllyTeam".to_owned(), json!({ "allyTeam": "01" }))]
    );
}

#[test]
fn the_ready_toggle_reports_our_assets_with_it() {
    // Both travel on one command, and the room knows whether the map and game
    // are installed, so it says so rather than leaving the server to guess.
    let (room, state) = joined_room();

    let asked = asked(
        &room,
        &state,
        RoomAction::OwnStatus(BattleStatus {
            ready: false,
            ..seated()
        }),
    );

    assert_eq!(
        asked,
        vec![(
            "lobby/updateClientStatus".to_owned(),
            json!({ "isReady": false, "assetStatus": "complete" })
        )]
    );
}

#[test]
fn missing_content_is_reported_as_missing_assets() {
    let (room, state) = joined_room();

    let asked = asked(
        &room,
        &state,
        RoomAction::OwnStatus(BattleStatus {
            sync: 2,
            ..seated()
        }),
    );

    assert_eq!(
        asked,
        vec![(
            "lobby/updateClientStatus".to_owned(),
            json!({ "isReady": true, "assetStatus": "missing" })
        )]
    );
}

#[test]
fn a_seat_control_with_nobody_signed_in_asks_for_nothing() {
    let (room, mut state) = joined_room();
    state.my_username = None;

    assert!(asked(&room, &state, RoomAction::OwnStatus(seated())).is_empty());
}

#[test]
fn adding_a_bot_names_the_ally_team_and_the_ai() {
    let (room, state) = joined_room();

    let asked = asked(
        &room,
        &state,
        RoomAction::AddBot {
            name: "BARb1".into(),
            ally: 1,
            ai: "BARb".into(),
        },
    );

    assert_eq!(
        asked,
        vec![(
            "lobby/addBot".to_owned(),
            json!({ "allyTeam": "02", "name": "BARb1", "shortName": "BARb" })
        )]
    );
}

#[test]
fn adding_a_bot_to_an_ally_team_the_lobby_lacks_asks_for_nothing() {
    let (room, state) = joined_room();

    let asked = asked(
        &room,
        &state,
        RoomAction::AddBot {
            name: "BARb1".into(),
            ally: 9,
            ai: "BARb".into(),
        },
    );

    assert!(asked.is_empty(), "{asked:?}");
}

/// A lobby holding one bot, which the roster shows as Barbarian.
fn with_a_bot() -> Value {
    details(json!({
        "bots": { "01": {
            "id": "bot-1",
            "hostUserId": "1",
            "allyTeam": "02",
            "team": "01",
            "player": "01",
            "shortName": "BARb",
            "name": "Barbarian",
        } },
    }))
}

#[test]
fn changing_a_bots_ai_names_the_bot_by_the_id_the_server_gave_it() {
    // The TASServer path removes the bot and adds it back, because its protocol
    // carries the AI on the add alone. Tachyon changes it in place, which is one
    // request rather than two and keeps the bot's seat.
    let (room, state) = joined_as(with_a_bot());

    let asked = asked(
        &room,
        &state,
        RoomAction::ChangeBotAi {
            name: "Barbarian".into(),
            ai: "NullAI".into(),
        },
    );

    assert_eq!(
        asked,
        vec![(
            "lobby/updateBot".to_owned(),
            json!({ "id": "bot-1", "shortName": "NullAI", "name": "Barbarian" })
        )]
    );
}

#[test]
fn removing_a_bot_names_the_bot_by_the_id_the_server_gave_it() {
    let (room, state) = joined_as(with_a_bot());

    let asked = asked(
        &room,
        &state,
        RoomAction::RemoveBot {
            name: "Barbarian".into(),
        },
    );

    assert_eq!(
        asked,
        vec![("lobby/removeBot".to_owned(), json!({ "id": "bot-1" }))]
    );
}

#[test]
fn a_bot_the_roster_had_to_key_by_id_is_still_the_one_removed() {
    // Two bots share a display name, so the roster files the second under its
    // id. A control naming that row has to reach that bot and not the first.
    let bot = |id: &str, ally: &str| {
        json!({
            "id": id, "hostUserId": "1", "allyTeam": ally, "team": "01",
            "player": "01", "shortName": "BARb", "name": "Barbarian",
        })
    };
    let (room, state) = joined_as(details(json!({
        "bots": { "01": bot("bot-1", "01"), "02": bot("bot-2", "02") },
    })));

    assert_eq!(
        battle(&state)
            .bots
            .keys()
            .collect::<std::collections::BTreeSet<_>>(),
        ["Barbarian".to_owned(), "bot-2".to_owned()]
            .iter()
            .collect()
    );
    assert_eq!(
        asked(
            &room,
            &state,
            RoomAction::RemoveBot {
                name: "bot-2".into()
            }
        ),
        vec![("lobby/removeBot".to_owned(), json!({ "id": "bot-2" }))]
    );
}

#[test]
fn kicking_names_the_member_by_their_user_id() {
    // No `banUntil`, which is what makes it a kick rather than a ban.
    let (room, state) = joined_room();

    let asked = asked(
        &room,
        &state,
        RoomAction::Kick {
            username: "bob".into(),
        },
    );

    assert_eq!(
        asked,
        vec![("lobby/kickban".to_owned(), json!({ "userId": "2" }))]
    );
}

#[test]
fn kicking_someone_we_cannot_name_asks_for_nothing() {
    let (room, state) = joined_room();

    let asked = asked(
        &room,
        &state,
        RoomAction::Kick {
            username: "nobody".into(),
        },
    );

    assert!(asked.is_empty(), "{asked:?}");
}

#[test]
fn changing_the_map_carries_the_map_alone() {
    // `lobby/update` also carries the lobby's name, its ally team config and its
    // game options, and a field it does not name is left alone.
    let (room, state) = joined_room();

    let asked = asked(
        &room,
        &state,
        RoomAction::SetMap {
            map: "Red Comet Remake 1.8".into(),
        },
    );

    assert_eq!(
        asked,
        vec![(
            "lobby/update".to_owned(),
            json!({ "mapName": "Red Comet Remake 1.8" })
        )]
    );
}

#[test]
fn appointing_and_standing_down_a_boss_name_them_by_user_id() {
    let (room, state) = joined_room();

    assert_eq!(
        asked(
            &room,
            &state,
            RoomAction::AppointBoss {
                username: "bob".into()
            }
        ),
        vec![("lobby/appointBoss".to_owned(), json!({ "userId": "2" }))]
    );
    assert_eq!(
        asked(
            &room,
            &state,
            RoomAction::Unboss {
                username: "bob".into()
            }
        ),
        vec![("lobby/unboss".to_owned(), json!({ "userId": "2" }))]
    );
}

#[test]
fn a_control_outside_a_lobby_asks_for_nothing() {
    let state = LobbyState::new();

    assert!(asked(&None, &state, RoomAction::OwnStatus(seated())).is_empty());
}

#[test]
fn a_patch_moving_us_changes_what_the_next_seat_push_asks_for() {
    // The requests are read off the lobby we hold, so a patch that moves us has
    // to change them. Otherwise a control would keep asking for a move already
    // made, or stop asking for one still needed.
    let (mut room, mut state) = joined_room();
    feed(
        &mut room,
        &mut state,
        &updated_frame(json!({
            "id": "lobby-a",
            "players": { "01": { "id": "1", "allyTeam": "02" } },
        })),
    );

    assert!(asked(
        &room,
        &state,
        RoomAction::OwnStatus(BattleStatus {
            ally: 1,
            ..seated()
        })
    )
    .is_empty());
    assert_eq!(
        asked(&room, &state, RoomAction::OwnStatus(seated())),
        vec![("lobby/joinAllyTeam".to_owned(), json!({ "allyTeam": "01" }))]
    );
}

#[test]
fn a_message_that_carries_no_lobby_leaves_the_room_alone() {
    let (mut room, mut state) = joined_room();

    let deltas = feed(&mut room, &mut state, r#"{"not":"a tachyon frame"}"#);

    assert_eq!(deltas, vec![]);
    assert!(room.is_some());
}

/// What `battle/start` carries: where the game server is, and the name and
/// password to present to it.
fn private_battle(patch: Value) -> Value {
    let mut base = json!({
        "username": "alice",
        "password": "s3cret",
        "ip": "203.0.113.7",
        "port": 8452,
        "engine": { "version": "2025.01.4" },
        "game": { "springName": "Beyond All Reason test-1234" },
        "map": { "springName": "Comet Catcher Remake 1.8" },
    });
    merge(&mut base, patch);
    base
}

/// Answer a `battle/start` the way the connection does, reporting the answer
/// and the match it handed on.
fn started(data: Value) -> (HandlerResult, Option<types::PrivateBattle>) {
    let (tx, mut rx) = mpsc::unbounded_channel();
    let answer = battle_start(&data, &tx);
    (answer, rx.try_recv().ok())
}

#[test]
fn a_battle_start_is_answered_before_anything_launches() {
    // The answer is what keeps the connection open, so it cannot wait on the
    // launch. Nothing has read the channel at the point the answer is made, and
    // the match is still waiting on it afterwards.
    let (tx, mut rx) = mpsc::unbounded_channel();

    let answer = battle_start(&private_battle(json!({})), &tx);

    // A successful battle/start response has no data at all.
    assert_eq!(answer, Ok(None));
    let handed_on = rx.try_recv().expect("the match was not handed on");
    assert_eq!(handed_on.ip, "203.0.113.7");
}

#[test]
fn a_battle_start_we_cannot_read_is_refused_rather_than_taken() {
    let (answer, handed_on) = started(json!({ "username": "alice" }));

    assert_eq!(
        answer,
        Err(Failure::new(FailureReason::InvalidRequest)),
        "an unreadable payload was taken",
    );
    assert!(handed_on.is_none());
}

#[test]
fn a_battle_start_reads_an_address_where_the_spec_says_uuid() {
    // The upstream schema types `privateBattle.ip` as a reference to `battleId`,
    // which is a uuid, while the live server sends an address. This parses only
    // because the vendored schema is patched, and it is the one message that
    // breaks without it.
    let (answer, handed_on) = started(private_battle(json!({ "ip": "203.0.113.7" })));

    assert_eq!(answer, Ok(None));
    assert_eq!(handed_on.expect("no match").ip, "203.0.113.7");
}

/// The launch config a `battle/start` payload comes to.
fn config_for(patch: Value) -> Value {
    let private: types::PrivateBattle =
        serde_json::from_value(private_battle(patch)).expect("the payload does not parse");
    battle_config(&private)
}

#[test]
fn a_started_battle_becomes_a_config_the_engine_can_join_with() {
    let config = config_for(json!({}));

    // Everything a client start script holds, straight off the wire.
    assert_eq!(config["isHost"], false);
    assert_eq!(config["myPlayerName"], "alice");
    assert_eq!(config["hostIp"], "203.0.113.7");
    assert_eq!(config["hostPort"], 8452);
    assert_eq!(config["myPasswd"], "s3cret");
    assert_eq!(config["mapName"], "Comet Catcher Remake 1.8");
    assert_eq!(config["gameType"], "Beyond All Reason test-1234");
}

#[test]
fn a_started_battle_fills_every_field_the_play_plugin_requires() {
    // `BattleConfig` defaults the rest, but these seven have no default, so a
    // config missing one of them is refused before it reaches the engine.
    let config = config_for(json!({}));

    for field in [
        "mapName",
        "gameType",
        "myPlayerName",
        "startPosType",
        "players",
        "teams",
        "allyTeams",
    ] {
        assert!(config.get(field).is_some(), "{field} is missing: {config}");
    }
    // The game server relays the real layout once the engine connects, and
    // nothing on the wire names it, so the three lists go out empty rather than
    // carrying a guess.
    assert_eq!(config["players"], json!([]));
    assert_eq!(config["teams"], json!([]));
    assert_eq!(config["allyTeams"], json!([]));
}

#[test]
fn a_port_that_is_not_a_port_is_left_out_rather_than_wrapped() {
    assert_eq!(config_for(json!({ "port": 70000 }))["hostPort"], Value::Null);
    assert_eq!(config_for(json!({ "port": -1 }))["hostPort"], Value::Null);
    assert_eq!(config_for(json!({ "port": 65535 }))["hostPort"], 65535);
}

#[test]
fn a_lobby_playing_a_match_is_one_to_ask_to_join() {
    // A late joiner is sent no `battle/start` off the back of joining the lobby,
    // so this is what tells the connection to ask with `lobby/joinBattle`.
    let (room, _state) = joined_as(details(json!({
        "currentBattle": { "id": "battle-a", "startedAt": 1_754_000_000 },
    })));

    assert!(match_running(&room));
}

#[test]
fn a_lobby_with_no_match_is_not_asked_to_join_one() {
    let (room, _state) = joined_room();

    assert!(!match_running(&room));
    assert!(!match_running(&None));
}
