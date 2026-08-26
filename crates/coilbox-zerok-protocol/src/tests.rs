//! What the generator produced, checked against what the wire actually carries.
//!
//! The bodies here are shaped like real Zero-K traffic rather than invented, so
//! a rule the generator gets wrong shows up as a failing assertion instead of a
//! surprise on a live connection.

use super::*;
use types::*;

#[test]
fn the_pinned_commit_is_recorded() {
    let commit = UPSTREAM_COMMIT.trim();
    assert_eq!(commit.len(), 40, "a git commit is 40 hex characters");
    assert!(commit.chars().all(|c| c.is_ascii_hexdigit()));
}

#[test]
fn every_command_is_named_once() {
    let mut seen = std::collections::BTreeSet::new();
    for (name, _) in COMMANDS {
        assert!(seen.insert(*name), "{name} is in the table twice");
    }
    // The three the rest of this milestone is built on, so a refresh that loses
    // one fails here rather than three issues later.
    for wanted in [
        "Welcome",
        "Login",
        "LoginResponse",
        "Register",
        "RegisterResponse",
    ] {
        assert!(seen.contains(wanted), "the table has lost {wanted}");
    }
}

#[test]
fn a_command_knows_its_name_and_direction() {
    assert_eq!(Login::NAME, "Login");
    assert_eq!(Login::DIRECTION, Direction::Client);
    assert_eq!(Welcome::NAME, "Welcome");
    assert_eq!(Welcome::DIRECTION, Direction::Server);
    // `Say` travels both ways, which is what lets one type carry chat in and out.
    assert_eq!(Say::DIRECTION, Direction::Both);
}

#[test]
fn welcome_parses_as_the_server_sends_it() {
    // Doubled hashes because the faction colour is one, and `"#` would otherwise
    // end the raw string.
    let body = r##"{"Engine":"105.1.1-2511-g2c2c8ad","Game":"Zero-K v1.12.6.0",
        "UserCount":142,"Version":"1.5.0.0","Blacklist":[],
        "Factions":[{"Name":"Empire","Shortcut":"Emp","Color":"#4040FF"}],
        "UserCountLimited":false}"##;
    let ZerokMessage::Welcome(welcome) = ZerokMessage::decode("Welcome", body) else {
        panic!(
            "Welcome did not decode: {:?}",
            ZerokMessage::decode("Welcome", body)
        );
    };
    assert_eq!(welcome.user_count, 142);
    assert_eq!(welcome.engine.as_deref(), Some("105.1.1-2511-g2c2c8ad"));
    let factions = welcome.factions.expect("the faction list is there");
    assert_eq!(factions[0].shortcut.as_deref(), Some("Emp"));
    // A challenge token is only sent when the server wants one, so an absent
    // member has to read as absent rather than fail the whole message.
    assert_eq!(welcome.challenge_token, None);
}

#[test]
fn an_absent_member_reads_as_its_c_sharp_default() {
    // Json.NET leaves a member alone when the JSON does not mention it, which
    // for a value type means 0 or false. `{}` is the strongest form of that.
    let ZerokMessage::Welcome(welcome) = ZerokMessage::decode("Welcome", "{}") else {
        panic!("an empty body should still be a Welcome");
    };
    assert_eq!(welcome.user_count, 0);
    assert!(!welcome.user_count_limited);
    assert_eq!(welcome.blacklist, None);
}

#[test]
fn an_enum_travels_as_a_number() {
    let body = r#"{"Name":"someone","ResultCode":3}"#;
    let ZerokMessage::LoginResponse(response) = ZerokMessage::decode("LoginResponse", body) else {
        panic!("LoginResponse did not decode");
    };
    assert_eq!(response.result_code, LoginResponseCode::InvalidPassword);

    // And back out as one, which is what makes a client-sent enum readable.
    let sent = serde_json::to_value(&SetAccountRelation {
        relation: Relation::Friend,
        target_name: Some("someone".into()),
        steam_id: None,
    })
    .expect("SetAccountRelation serialises");
    assert_eq!(sent["Relation"], serde_json::json!(1));
}

#[test]
fn an_enum_value_we_do_not_know_survives() {
    // The whole point of the catch-all: a server ahead of the pinned commit
    // costs one field, not the message.
    let body = r#"{"ResultCode":9999}"#;
    let ZerokMessage::LoginResponse(response) = ZerokMessage::decode("LoginResponse", body) else {
        panic!("an unknown result code should not break the message");
    };
    assert_eq!(response.result_code, LoginResponseCode::Other(9999));
    let back = serde_json::to_value(&response).expect("it serialises");
    assert_eq!(back["ResultCode"], serde_json::json!(9999));
}

#[test]
fn a_none_member_is_left_out_rather_than_sent_as_null() {
    // Upstream sets NullValueHandling.Ignore, so this is what its own client
    // does and what its server expects to read.
    let login = Login {
        name: Some("someone".into()),
        password_hash: Some("X03MO1qnZdYdgyfeuILPmQ==".into()),
        client_type: ClientTypes::ZeroKLobby,
        lobby_version: Some("coilbox 0.0.0".into()),
        install_id: Some("d34db33f".into()),
        user_id: 0,
        ..Login::default()
    };
    let sent = serde_json::to_value(&login).expect("Login serialises");
    let object = sent.as_object().expect("it is an object");
    assert!(!object.contains_key("SteamAuthToken"));
    assert!(!object.contains_key("EncryptedPasswordHash"));
    assert!(!object.contains_key("Dlc"));
    // A value member is written whatever it holds, including zero.
    assert_eq!(object["UserID"], serde_json::json!(0));
    assert_eq!(object["ClientType"], serde_json::json!(1));
    assert_eq!(object["Name"], serde_json::json!("someone"));
}

#[test]
fn a_date_stays_the_string_the_server_wrote() {
    // Json.NET round-trips the kind, so all three of these are things a server
    // can send and a type insisting on RFC 3339 would refuse the last.
    for written in [
        "2026-05-11T18:53:17Z",
        "2026-05-11T18:53:17+02:00",
        "2026-05-11T18:53:17",
    ] {
        let body = format!(r#"{{"Name":"someone","AwaySince":"{written}"}}"#);
        let ZerokMessage::User(user) = ZerokMessage::decode("User", &body) else {
            panic!("User did not decode with a date of {written}");
        };
        assert_eq!(user.away_since.as_deref(), Some(written));
    }
}

#[test]
fn a_computed_property_is_not_a_field() {
    // `User.IsAway` is `AwaySince != null` on the server. Carrying it would
    // invent a field the server cannot read back, and an extra one arriving
    // must not break the message either.
    let body = r#"{"Name":"someone","AwaySince":"2026-05-11T18:53:17Z","IsAway":true}"#;
    let ZerokMessage::User(user) = ZerokMessage::decode("User", body) else {
        panic!("an extra member should not break the message");
    };
    assert!(user.away_since.is_some());
    let back = serde_json::to_value(&user).expect("User serialises");
    assert!(back.as_object().expect("an object").get("IsAway").is_none());
}

#[test]
fn a_dictionary_is_a_json_object() {
    let body = r#"{"BattleID":7,"Options":{"maxspeed":"3","startmetal":"1000"},"Players":[]}"#;
    let ZerokMessage::JoinBattleSuccess(joined) = ZerokMessage::decode("JoinBattleSuccess", body)
    else {
        panic!("JoinBattleSuccess did not decode");
    };
    assert_eq!(joined.battle_id, 7);
    let options = joined.options.expect("the options are there");
    assert_eq!(options["maxspeed"], "3");
    assert_eq!(joined.players.expect("an empty player list").len(), 0);
}

#[test]
fn a_nested_type_keeps_its_shape() {
    let body = r#"{"Header":{"BattleID":12,"Title":"Team game","Mode":6,"MaxPlayers":16,
        "Map":"Comet Catcher Redux","IsRunning":false}}"#;
    let ZerokMessage::BattleAdded(added) = ZerokMessage::decode("BattleAdded", body) else {
        panic!("BattleAdded did not decode");
    };
    let header = added.header.expect("the header is there");
    assert_eq!(header.battle_id, Some(12));
    assert_eq!(header.mode, Some(AutohostMode::Teams));
    assert_eq!(header.is_running, Some(false));
}

#[test]
fn an_unknown_command_is_shown_rather_than_dropped() {
    let decoded = ZerokMessage::decode("SomethingNewUpstream", r#"{"a":1}"#);
    match &decoded {
        ZerokMessage::Unknown { name, body } => {
            assert_eq!(name, "SomethingNewUpstream");
            assert_eq!(body, r#"{"a":1}"#);
        }
        other => panic!("expected Unknown, got {other:?}"),
    }
    assert_eq!(decoded.name(), "SomethingNewUpstream");
}

#[test]
fn a_body_that_does_not_fit_names_the_command_it_came_under() {
    let decoded = ZerokMessage::decode("Welcome", r#"{"UserCount":"not a number"}"#);
    match &decoded {
        ZerokMessage::Invalid { name, error, .. } => {
            assert_eq!(name, "Welcome");
            assert!(!error.is_empty(), "the parse failure is worth showing");
        }
        other => panic!("expected Invalid, got {other:?}"),
    }
    assert_eq!(decoded.name(), "Welcome");
}
