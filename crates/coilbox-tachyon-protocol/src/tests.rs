use super::*;

/// Reads back what a variant serialises to, so a test can compare against the
/// frame it came from without caring about key order.
fn json(value: &impl Serialize) -> serde_json::Value {
    serde_json::to_value(value).expect("the generated types serialise")
}

#[test]
fn request_round_trips() {
    // battle/start is the message that tells us where to connect, and its `ip`
    // field is the one the vendored schema is patched for. An unpatched bundle
    // types it as a UUID and this frame lands in Invalid.
    let raw = r#"{
        "type": "request",
        "messageId": "m1",
        "commandId": "battle/start",
        "data": {
            "username": "coilbox",
            "password": "secret",
            "ip": "203.0.113.7",
            "port": 8452,
            "engine": { "version": "2025.01.4" },
            "game": { "springName": "Beyond All Reason test-1234" },
            "map": { "springName": "Comet Catcher Remake 1.8" }
        }
    }"#;

    let TachyonMessage::BattleStartRequest(request) = parse_frame(raw) else {
        panic!("expected a battle/start request");
    };
    assert_eq!(request.data.ip, "203.0.113.7");
    assert_eq!(request.data.port, 8452.0);
    assert_eq!(request.message_id, "m1");
    assert_eq!(request.data.engine.version, "2025.01.4");
    // The frame comes back with the same keys. The schema types `port` as a
    // number rather than an integer, so it makes the trip as a float and
    // serialises as 8452.0, which is why this compares the data field by field
    // above and only the shape here.
    let round_tripped = json(&request);
    let original = serde_json::from_str::<serde_json::Value>(raw).unwrap();
    assert_eq!(
        round_tripped
            .as_object()
            .unwrap()
            .keys()
            .collect::<Vec<_>>(),
        original.as_object().unwrap().keys().collect::<Vec<_>>()
    );
    assert_eq!(round_tripped["commandId"], original["commandId"]);
    assert_eq!(
        round_tripped["data"]["username"],
        original["data"]["username"]
    );
}

#[test]
fn success_response_carries_its_data() {
    let raw = r#"{
        "type": "response",
        "messageId": "m2",
        "commandId": "system/serverStats",
        "status": "success",
        "data": { "userCount": 412 }
    }"#;

    let TachyonMessage::SystemServerStatsResponse(types::SystemServerStatsResponse::Success {
        data,
        message_id,
        ..
    }) = parse_frame(raw)
    else {
        panic!("expected a successful system/serverStats response");
    };
    assert_eq!(data.user_count, 412);
    assert_eq!(message_id, "m2");
}

#[test]
fn failure_response_carries_a_typed_reason() {
    let raw = r#"{
        "type": "response",
        "messageId": "m3",
        "commandId": "lobby/join",
        "status": "failed",
        "reason": "lobby_full",
        "details": "the lobby is full"
    }"#;

    let TachyonMessage::LobbyJoinResponse(types::LobbyJoinResponse::Failed {
        reason, details, ..
    }) = parse_frame(raw)
    else {
        panic!("expected a failed lobby/join response");
    };
    // The reason enum is compared through Display rather than by name. Typify
    // numbers these types by position, so the name moves when the schema is
    // re-vendored while the wire value does not.
    assert_eq!(reason.to_string(), "lobby_full");
    assert_eq!(details.as_deref(), Some("the lobby is full"));
}

#[test]
fn event_round_trips() {
    let raw = r#"{
        "type": "event",
        "messageId": "m4",
        "commandId": "messaging/received",
        "data": {
            "message": "gg",
            "source": { "type": "player", "userId": "351" },
            "timestamp": 1705432698000000,
            "marker": "-576460745805023"
        }
    }"#;

    let TachyonMessage::MessagingReceivedEvent(event) = parse_frame(raw) else {
        panic!("expected a messaging/received event");
    };
    assert_eq!(event.data.message, "gg");
    assert_eq!(
        json(&event),
        serde_json::from_str::<serde_json::Value>(raw).unwrap()
    );
}

#[test]
fn an_unknown_command_id_is_not_an_error() {
    let raw = r#"{"type":"event","messageId":"m5","commandId":"lobby/teleported","data":{}}"#;

    let TachyonMessage::Unknown { raw: kept } = parse_frame(raw) else {
        panic!("expected an unknown command to be kept raw");
    };
    assert_eq!(kept, raw);
}

#[test]
fn a_known_command_id_in_the_wrong_direction_is_unknown() {
    // lobby/updated only exists as an event, so this pair is not in the schema.
    let raw = r#"{"type":"request","messageId":"m6","commandId":"lobby/updated","data":{}}"#;

    assert!(matches!(parse_frame(raw), TachyonMessage::Unknown { .. }));
}

#[test]
fn a_frame_that_is_not_an_envelope_is_unknown() {
    for raw in [
        "",
        "not json",
        "{}",
        r#"{"type":"shout","messageId":"m","commandId":"x"}"#,
    ] {
        let TachyonMessage::Unknown { raw: kept } = parse_frame(raw) else {
            panic!("expected {raw:?} to be unknown");
        };
        assert_eq!(kept, raw);
    }
}

#[test]
fn a_known_command_with_a_body_we_cannot_read_is_invalid() {
    let raw = r#"{"type":"request","messageId":"m7","commandId":"battle/start","data":{"ip":"203.0.113.7"}}"#;

    let TachyonMessage::Invalid {
        command_id,
        raw: kept,
        error,
    } = parse_frame(raw)
    else {
        panic!("expected an unreadable body to be invalid");
    };
    assert_eq!(command_id, "battle/start");
    assert_eq!(kept, raw);
    assert!(error.contains("missing field"), "unhelpful error: {error}");
}

#[test]
fn the_envelope_reads_on_its_own() {
    let raw = r#"{"type":"response","messageId":"m8","commandId":"lobby/join","status":"success"}"#;

    assert_eq!(
        serde_json::from_str::<Envelope>(raw).unwrap(),
        Envelope {
            kind: MessageKind::Response,
            message_id: "m8".to_string(),
            command_id: "lobby/join".to_string(),
        }
    );
}
