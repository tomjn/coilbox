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

/// A room with both players named, which is the ordinary case.
fn joined_room() -> (Option<Room>, LobbyState) {
    let mut state = LobbyState::new();
    known(&mut state, "1", "alice");
    known(&mut state, "2", "bob");
    let mut room = None;
    feed(&mut room, &mut state, &join_frame(details(json!({}))));
    (room, state)
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
fn a_message_that_carries_no_lobby_leaves_the_room_alone() {
    let (mut room, mut state) = joined_room();

    let deltas = feed(&mut room, &mut state, r#"{"not":"a tachyon frame"}"#);

    assert_eq!(deltas, vec![]);
    assert!(room.is_some());
}
