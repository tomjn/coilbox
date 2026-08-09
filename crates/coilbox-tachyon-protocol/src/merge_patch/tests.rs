use super::*;

/// A lobby as `lobby/join` hands it over, which is what every patch below
/// starts from.
const LOBBY: &str = r#"{
    "id": "lobby-1",
    "name": "Comet Catcher 8v8",
    "mapName": "Comet Catcher Remake 1.8",
    "engineVersion": "2025.01.4",
    "gameVersion": "Beyond All Reason test-1234",
    "gameOptions": { "startmetal": { "value": "1000" }, "startenergy": { "value": "1000" } },
    "allyTeamConfig": {
        "01": {
            "startBox": { "top": 0, "bottom": 0.3, "left": 0, "right": 1 },
            "maxTeams": 8,
            "teams": { "01": { "maxPlayers": 1 }, "02": { "maxPlayers": 1 } }
        }
    },
    "areBossesEnabled": false,
    "bosses": {},
    "players": {
        "01": {
            "id": "351", "allyTeam": "01", "team": "01", "player": "01",
            "isReady": false, "assetStatus": "complete"
        },
        "02": {
            "id": "352", "allyTeam": "01", "team": "02", "player": "01",
            "isReady": true, "assetStatus": "downloading"
        }
    },
    "spectators": { "01": { "id": "400", "joinQueuePosition": 1 } },
    "bots": {
        "01": {
            "id": "bot-1", "hostUserId": "351", "allyTeam": "02", "team": "01",
            "player": "01", "shortName": "BARb", "name": "Barbarian",
            "version": "stable", "options": { "difficulty": "hard" }
        }
    },
    "currentBattle": { "id": "battle-9", "startedAt": 1705432698 },
    "voteHistory": {}
}"#;

fn lobby() -> types::LobbyDetails {
    serde_json::from_str(LOBBY).expect("the sample lobby matches lobbyDetails")
}

/// The lobby before any patch, as JSON, because the generated types have no
/// `PartialEq`.
fn baseline() -> Value {
    serde_json::to_value(lobby()).expect("the lobby serialises")
}

/// Reads a patch through the real parse path, so the tests exercise the frame
/// the server actually sends rather than a struct built by hand.
fn patch(data: &str) -> LobbyPatch {
    let raw =
        format!(r#"{{"type":"event","messageId":"m1","commandId":"lobby/updated","data":{data}}}"#);
    match crate::parse_frame(&raw) {
        crate::TachyonMessage::LobbyUpdatedEvent(event) => event.data,
        other => panic!("expected a lobby/updated event, got {other:?}"),
    }
}

/// Applies one patch to the sample lobby and hands back the result as JSON.
fn patched(data: &str) -> Value {
    let mut lobby = lobby();
    apply(&mut lobby, &patch(data));
    serde_json::to_value(&lobby).expect("the lobby serialises")
}

#[derive(Deserialize)]
struct Held {
    #[serde(default)]
    value: Patched<u32>,
}

#[test]
fn patched_tells_an_absent_field_from_a_null_one() {
    let held = |raw: &str| {
        serde_json::from_str::<Held>(raw)
            .expect("the sample struct reads")
            .value
    };

    assert_eq!(held("{}"), Patched::Absent);
    assert_eq!(held(r#"{"value":null}"#), Patched::Null);
    assert_eq!(held(r#"{"value":7}"#), Patched::Set(7));
}

#[test]
fn a_field_the_patch_leaves_out_is_left_alone() {
    assert_eq!(patched(r#"{"id":"lobby-1"}"#), baseline());
}

#[test]
fn a_field_with_a_value_is_replaced() {
    let after = patched(r#"{"id":"lobby-1","mapName":"Supreme Isthmus 1.2"}"#);

    assert_eq!(after["mapName"], "Supreme Isthmus 1.2");
    assert_eq!(after["name"], baseline()["name"]);
}

#[test]
fn a_field_set_to_null_is_removed_where_leaving_it_out_keeps_it() {
    // The pair that matters. Both patches are the same size on the wire and
    // they have to mean different things.
    let removed = patched(r#"{"id":"lobby-1","currentBattle":null}"#);
    assert!(
        removed.get("currentBattle").is_none(),
        "the battle survived a null: {removed}"
    );

    let untouched = patched(r#"{"id":"lobby-1","mapName":"Supreme Isthmus 1.2"}"#);
    assert_eq!(untouched["currentBattle"]["id"], "battle-9");
}

#[test]
fn a_nested_object_merges_rather_than_replacing() {
    let after = patched(r#"{"id":"lobby-1","players":{"01":{"id":"351","isReady":true}}}"#);

    assert_eq!(after["players"]["01"]["isReady"], true);
    assert_eq!(after["players"]["01"]["team"], "01");
    assert_eq!(after["players"]["01"]["assetStatus"], "complete");
    assert_eq!(after["players"]["02"], baseline()["players"]["02"]);
}

#[test]
fn a_keyed_entry_set_to_null_is_removed_and_its_siblings_survive() {
    let after = patched(r#"{"id":"lobby-1","players":{"02":null}}"#);

    assert!(
        after["players"].get("02").is_none(),
        "the player survived a null: {after}"
    );
    assert_eq!(after["players"]["01"], baseline()["players"]["01"]);
}

#[test]
fn a_new_key_is_inserted() {
    let after = patched(
        r#"{"id":"lobby-1","players":{"03":{
            "id":"353","allyTeam":"02","team":"03","player":"01",
            "isReady":false,"assetStatus":"missing"
        }}}"#,
    );

    assert_eq!(after["players"]["03"]["id"], "353");
    assert_eq!(after["players"]["03"]["assetStatus"], "missing");
    assert_eq!(after["players"].as_object().expect("an object").len(), 3);
}

#[test]
fn an_insert_the_patch_cannot_complete_is_skipped() {
    // A player the lobby does not have yet, patched with too little to build a
    // whole one. lobbyDetails requires the team and the asset status.
    let after = patched(
        r#"{"id":"lobby-1","mapName":"Supreme Isthmus 1.2","players":{"03":{"id":"353","isReady":true}}}"#,
    );

    assert!(
        after["players"].get("03").is_none(),
        "half a player was inserted: {after}"
    );
    assert_eq!(after["mapName"], "Supreme Isthmus 1.2");
}

#[test]
fn an_unknown_field_does_not_lose_the_fields_beside_it() {
    let after = patched(
        r#"{"id":"lobby-1","teleporters":{"01":{"x":1}},"mapName":"Supreme Isthmus 1.2",
            "players":{"01":{"id":"351","isReady":true}}}"#,
    );

    assert_eq!(after["mapName"], "Supreme Isthmus 1.2");
    assert_eq!(after["players"]["01"]["isReady"], true);
}

#[test]
fn a_patch_reaches_several_levels_down() {
    let after =
        patched(r#"{"id":"lobby-1","allyTeamConfig":{"01":{"teams":{"02":{"maxPlayers":4}}}}}"#);

    assert_eq!(
        after["allyTeamConfig"]["01"]["teams"]["02"]["maxPlayers"],
        4
    );
    assert_eq!(
        after["allyTeamConfig"]["01"]["teams"]["01"]["maxPlayers"],
        1
    );
    assert_eq!(after["allyTeamConfig"]["01"]["maxTeams"], 8);
    assert_eq!(
        after["allyTeamConfig"]["01"]["startBox"],
        baseline()["allyTeamConfig"]["01"]["startBox"]
    );
}

#[test]
fn a_nullable_field_inside_an_entry_can_be_cleared() {
    let cleared =
        patched(r#"{"id":"lobby-1","spectators":{"01":{"id":"400","joinQueuePosition":null}}}"#);
    assert!(
        cleared["spectators"]["01"]
            .get("joinQueuePosition")
            .is_none(),
        "the queue position survived a null: {cleared}"
    );
    assert_eq!(cleared["spectators"]["01"]["id"], "400");

    let untouched = patched(r#"{"id":"lobby-1","spectators":{"01":{"id":"400"}}}"#);
    assert_eq!(untouched["spectators"]["01"]["joinQueuePosition"], 1.0);
}

#[test]
fn a_bot_keeps_the_options_the_patch_does_not_name() {
    let merged = patched(
        r#"{"id":"lobby-1","bots":{"01":{"id":"bot-1","options":{"personality":"rush"}}}}"#,
    );
    assert_eq!(merged["bots"]["01"]["options"]["difficulty"], "hard");
    assert_eq!(merged["bots"]["01"]["options"]["personality"], "rush");
    assert_eq!(merged["bots"]["01"]["name"], "Barbarian");

    let cleared =
        patched(r#"{"id":"lobby-1","bots":{"01":{"id":"bot-1","options":null,"version":null}}}"#);
    assert!(
        cleared["bots"]["01"].get("options").is_none(),
        "the options survived a null: {cleared}"
    );
    assert!(
        cleared["bots"]["01"].get("version").is_none(),
        "the version survived a null: {cleared}"
    );
    assert_eq!(cleared["bots"]["01"]["shortName"], "BARb");
}

#[test]
fn a_game_option_is_replaced_or_removed_one_key_at_a_time() {
    let after = patched(
        r#"{"id":"lobby-1","gameOptions":{"startmetal":{"value":"2000"},"startenergy":null,"maxunits":{"value":"2000"}}}"#,
    );

    assert_eq!(after["gameOptions"]["startmetal"]["value"], "2000");
    assert_eq!(after["gameOptions"]["maxunits"]["value"], "2000");
    assert!(
        after["gameOptions"].get("startenergy").is_none(),
        "the option survived a null: {after}"
    );
}

#[test]
fn a_vote_is_inserted_whole_then_merged_then_removed() {
    let mut lobby = lobby();
    assert!(baseline().get("currentVote").is_none());

    // Too little to build a whole vote, so nothing lands.
    apply(
        &mut lobby,
        &patch(r#"{"id":"lobby-1","currentVote":{"id":"vote-1"}}"#),
    );
    let after = serde_json::to_value(&lobby).expect("the lobby serialises");
    assert!(after.get("currentVote").is_none(), "half a vote: {after}");

    apply(
        &mut lobby,
        &patch(
            r#"{"id":"lobby-1","currentVote":{
                "id":"vote-1","action":{"type":"start"},"initiator":"351",
                "until":1705432800,"voters":{"351":{"vote":"pending"}}
            }}"#,
        ),
    );
    let after = serde_json::to_value(&lobby).expect("the lobby serialises");
    assert_eq!(after["currentVote"]["voters"]["351"]["vote"], "pending");

    apply(
        &mut lobby,
        &patch(
            r#"{"id":"lobby-1","currentVote":{"id":"vote-1","voters":{"351":{"vote":"yes"},"352":{"vote":"no"}}}}"#,
        ),
    );
    let after = serde_json::to_value(&lobby).expect("the lobby serialises");
    assert_eq!(after["currentVote"]["voters"]["351"]["vote"], "yes");
    assert_eq!(after["currentVote"]["voters"]["352"]["vote"], "no");
    assert_eq!(after["currentVote"]["initiator"], "351");
    assert_eq!(after["currentVote"]["until"], 1705432800);

    apply(&mut lobby, &patch(r#"{"id":"lobby-1","currentVote":null}"#));
    let after = serde_json::to_value(&lobby).expect("the lobby serialises");
    assert!(
        after.get("currentVote").is_none(),
        "the vote survived a null: {after}"
    );
}

#[test]
fn patches_in_sequence_reach_the_same_state_as_the_single_patch() {
    let mut stepwise = lobby();
    apply(
        &mut stepwise,
        &patch(r#"{"id":"lobby-1","mapName":"Supreme Isthmus 1.2"}"#),
    );
    apply(
        &mut stepwise,
        &patch(r#"{"id":"lobby-1","players":{"01":{"id":"351","isReady":true}}}"#),
    );
    apply(
        &mut stepwise,
        &patch(r#"{"id":"lobby-1","currentBattle":null}"#),
    );

    let at_once = patched(
        r#"{"id":"lobby-1","mapName":"Supreme Isthmus 1.2",
            "players":{"01":{"id":"351","isReady":true}},"currentBattle":null}"#,
    );

    assert_eq!(
        serde_json::to_value(&stepwise).expect("the lobby serialises"),
        at_once
    );
}

#[test]
fn the_patch_types_name_every_field_the_schema_has() {
    // Top level only. This is a guard against a re-vendored schema growing a
    // field the hand-written patch types would drop in silence.
    let text =
        std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/schema/compiled.json"))
            .expect("read the vendored schema");
    let bundle: Value = serde_json::from_str(&text).expect("parse the vendored schema");
    let event = bundle["anyOf"]
        .as_array()
        .expect("the bundle is a top-level anyOf")
        .iter()
        .find(|member| member["title"] == "LobbyUpdatedEvent")
        .expect("the bundle has lobby/updated");

    let mut fields: Vec<&str> = event["properties"]["data"]["properties"]
        .as_object()
        .expect("the event data is an object")
        .keys()
        .map(String::as_str)
        .collect();
    fields.sort_unstable();

    assert_eq!(
        fields,
        [
            "allyTeamConfig",
            "bosses",
            "bots",
            "currentBattle",
            "currentVote",
            "engineVersion",
            "gameOptions",
            "gameVersion",
            "id",
            "mapName",
            "name",
            "players",
            "restrictions",
            "spectators",
            "tags",
            "voteHistory",
        ]
    );
}
