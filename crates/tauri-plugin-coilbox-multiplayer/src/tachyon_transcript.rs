//! Golden test: a Tachyon session through parse and reduce, then assertions
//! about the resulting [`LobbyState`].
//!
//! The counterpart of `coilbox-lobby-protocol`'s `tests/login_transcript.rs`,
//! which does the same for the line protocol. The three Tachyon reducers each
//! have their own tests, a frame at a time. This is the one that runs all three
//! in the order [`crate::tachyon_conn`] runs them, over a whole session, so a
//! change that quietly alters the shape the frontend reads has somewhere to
//! fail.
//!
//! # This transcript is constructed, not captured
//!
//! Nobody has managed to connect to a live Teiserver yet, so these frames were
//! built from the vendored schema at
//! `crates/coilbox-tachyon-protocol/schema/compiled.json` rather than recorded
//! off a socket. Every frame carries the fields its command schema requires and
//! is shaped the way the schema says, and the merge patches follow the
//! `lobby/updated` schema, which is looser than `lobbyDetails` and is what makes
//! a partial update legal.
//!
//! So this proves the pipeline is self-consistent with the specification. It
//! does not prove Teiserver sends any of this. Read a failure here as "the
//! reducers changed", not as "the server changed", and replace the transcript
//! with a capture once one exists.

use coilbox_lobby_protocol::{Battle, LobbyState, User};
use coilbox_tachyon_protocol::{parse_frame, TachyonMessage};

use crate::tachyon_room::Room;
use crate::{tachyon_lobbies, tachyon_room, tachyon_users};

/// The session, from the first event after the socket opened to the last patch
/// of the lobby we are in.
///
/// alice is us, user id 1. bob is 2, carol is 3, and dave is 4 and is in the
/// lobby before the server has told us his name.
const TRANSCRIPT: &[&str] = &[
    // `user/self`, which says who we are. The shape is the schema's
    // `privateUser`: a `user` plus the friends, party and matchmaking fields.
    r#"{"type":"event","messageId":"1","commandId":"user/self","data":{"user":{"userId":"1","username":"alice","displayName":"Alice","clanBaseData":null,"countryCode":"GB","status":"menu","roles":["contributor"],"party":null,"invitedToParties":[],"friendIds":["2"],"outgoingFriendRequest":[],"incomingFriendRequest":[],"ignoreIds":[],"currentLobby":null,"clanInvites":[],"matchmaking":{"state":"no_matchmaking"}}}}"#,
    // The answer to the `user/subscribeUpdates` the connection sends for the
    // ids `user/self` named. Every field of a `user/updated` entry is optional,
    // so a full record and a partial one are the same shape.
    r#"{"type":"event","messageId":"2","commandId":"user/updated","data":{"users":[{"userId":"2","username":"bob","displayName":"Bob","clanBaseData":null,"countryCode":"DE","status":"menu"},{"userId":"3","username":"carol","displayName":"Carol","clanBaseData":null,"countryCode":"US","status":"lobby"}]}}"#,
    // The lobby list, which the connection's own `lobby/subscribeList` asks for.
    // Two whole `lobbyOverview`s, keyed by lobby id.
    r#"{"type":"event","messageId":"3","commandId":"lobby/listReset","data":{"lobbies":{"0198a1f0-lobby-a":{"id":"0198a1f0-lobby-a","name":"Comet Catcher 8v8","playerCount":2,"maxPlayerCount":16,"mapName":"Comet Catcher Remake 1.8","engineVersion":"2025.01.4","gameVersion":"Beyond All Reason test-1234","currentBattle":null},"0198a1f0-lobby-b":{"id":"0198a1f0-lobby-b","name":"Quicksilver 4v4","playerCount":5,"maxPlayerCount":8,"mapName":"Quicksilver Remake 1.24","engineVersion":"2025.01.4","gameVersion":"Beyond All Reason test-1234","currentBattle":null}}}}"#,
    // A list patch. Only `id` is required of an entry, so lobby-a's player count
    // moves and the fields the entry leaves out keep their values. lobby-b is
    // set to null, which is how a merge patch says the lobby is gone.
    r#"{"type":"event","messageId":"4","commandId":"lobby/listUpdated","data":{"lobbies":{"0198a1f0-lobby-a":{"id":"0198a1f0-lobby-a","playerCount":3},"0198a1f0-lobby-b":null}}}"#,
    // A command the vendored schema does not have. The protocol is at v0 and the
    // server is free to be ahead of us, so this has to parse rather than stop
    // the session.
    r#"{"type":"event","messageId":"5","commandId":"lobby/chatMessage","data":{"id":"0198a1f0-lobby-a","text":"hello"}}"#,
    // The `lobby/join` response, which carries the whole lobby as
    // `lobbyDetails`. alice and dave are playing on opposite ally teams, bob is
    // spectating, and alice is hosting a bot.
    r#"{"type":"response","messageId":"6","commandId":"lobby/join","status":"success","data":{"id":"0198a1f0-lobby-a","name":"Comet Catcher 8v8","mapName":"Comet Catcher Remake 1.8","engineVersion":"2025.01.4","gameVersion":"Beyond All Reason test-1234","gameOptions":{},"areBossesEnabled":false,"bosses":{},"allyTeamConfig":{"01":{"startBox":{"left":0,"top":0,"right":0.25,"bottom":1},"maxTeams":1,"teams":{"01":{"maxPlayers":8}}},"02":{"startBox":{"left":0.75,"top":0,"right":1,"bottom":1},"maxTeams":1,"teams":{"01":{"maxPlayers":8}}}},"players":{"01":{"id":"1","allyTeam":"01","team":"01","player":"01","isReady":false,"assetStatus":"complete"},"02":{"id":"4","allyTeam":"02","team":"01","player":"01","isReady":false,"assetStatus":"downloading"}},"spectators":{"01":{"id":"2"}},"bots":{"01":{"id":"bot-1","hostUserId":"1","allyTeam":"02","team":"01","player":"02","name":"Fast Barb","shortName":"BARb","version":"stable"}}}}"#,
    // A room patch, which is where the merge patch rules bite. The map changes
    // and the name beside it does not, dave's ready flag is set without
    // repeating his ally team, bob's spectator slot is set to null and goes,
    // carol takes a fresh slot, and the bot's display name is set to null so the
    // roster falls back to its short name.
    r#"{"type":"event","messageId":"7","commandId":"lobby/updated","data":{"id":"0198a1f0-lobby-a","mapName":"Supreme Isthmus 1.5","players":{"02":{"id":"4","isReady":true}},"spectators":{"01":null,"02":{"id":"3"}},"bots":{"01":{"id":"bot-1","name":null,"version":null,"options":null}}}}"#,
    // The answer to the subscription the join sent for the member ids we could
    // not name. dave was in the roster under his id until this arrived.
    r#"{"type":"event","messageId":"8","commandId":"user/updated","data":{"users":[{"userId":"4","username":"dave","displayName":"Dave","clanBaseData":null,"countryCode":"FR","status":"lobby"}]}}"#,
];

/// The server taking us out of the lobby, which ends the session.
const LEAVING: &str = r#"{"type":"event","messageId":"9","commandId":"lobby/left","data":{"id":"0198a1f0-lobby-a","reason":"the lobby was closed"}}"#;

/// The lobby the session joins.
const LOBBY_A: &str = "0198a1f0-lobby-a";

/// Fold a run of frames the way the connection loop does: parse, then the three
/// reducers in the order [`crate::tachyon_conn`] runs them.
fn play(frames: &[&str]) -> (LobbyState, Option<Room>) {
    let mut state = LobbyState::new();
    let mut room = None;
    for frame in frames {
        let message = parse_frame(frame);
        tachyon_users::reduce(&mut state, &message);
        tachyon_lobbies::reduce(&mut state, &message);
        tachyon_room::reduce(&mut room, &mut state, &message);
    }
    (state, room)
}

/// The record `users` holds for `name`.
fn user_named<'a>(state: &'a LobbyState, name: &str) -> &'a User {
    state
        .users
        .get(name)
        .unwrap_or_else(|| panic!("no user named {name}: {:?}", state.users.keys()))
}

/// The battle filed under the Tachyon lobby `id`. The handle is a hash of the
/// uuid, so a test looks a battle up by the id it came from rather than by a
/// number written down here.
fn battle_for<'a>(state: &'a LobbyState, id: &str) -> &'a Battle {
    state
        .battles
        .values()
        .find(|battle| battle.tachyon_id.as_deref() == Some(id))
        .unwrap_or_else(|| panic!("no battle for {id}: {:?}", state.battles))
}

#[test]
fn transcript_builds_expected_state() {
    let (state, _room) = play(TRANSCRIPT);

    // Logged in as alice.
    assert_eq!(state.my_username.as_deref(), Some("alice"));

    // Four users present: us, the friend we subscribed to, and the two the
    // lobby taught us about.
    assert_eq!(state.users.len(), 4);
    assert_eq!(user_named(&state, "alice").user_id, "1");
    assert_eq!(user_named(&state, "bob").country, "DE");
    assert_eq!(user_named(&state, "carol").user_id, "3");
    assert_eq!(user_named(&state, "dave").country, "FR");
    // contributor is not a moderator, so the access bit stays down.
    assert!(!user_named(&state, "alice").status.access);

    // One battle. lobby-b was set to null in the list patch and is gone.
    assert_eq!(state.battles.len(), 1);
    let battle = battle_for(&state, LOBBY_A);
    assert_eq!(state.current_battle, Some(battle.id));
    assert_eq!(state.last_battle, Some(battle.id));

    assert_eq!(battle.title, "Comet Catcher 8v8");
    assert_eq!(battle.modname, "Beyond All Reason test-1234");
    assert_eq!(battle.version, "2025.01.4");
    // The room patch changed the map. The name beside it was not in the patch,
    // so it is still the one the join carried.
    assert_eq!(battle.map, "Supreme Isthmus 1.5");
    // The list is the only thing that carries a cap, and joining does not
    // overwrite what the list filled in.
    assert_eq!(battle.max_players, 16);
    // The room counts the players itself, so it wins over the 3 the list patch
    // last said.
    assert_eq!(battle.player_count, Some(2));
    assert_eq!(battle.spectator_count, 1);

    // Two players and one spectator. bob's spectator slot was set to null in
    // the room patch, and carol took a fresh one.
    assert_eq!(battle.members.len(), 3);
    let alice = &battle.members["alice"].battle_status;
    assert!(alice.mode, "alice is playing");
    assert_eq!(alice.ally, 0);
    assert_eq!(alice.team_id, 0);
    assert_eq!(alice.sync, 1, "alice has the content");
    let dave = &battle.members["dave"].battle_status;
    assert!(dave.ready, "the room patch set dave ready");
    // The patch named dave's id and his ready flag and nothing else, so the
    // ally team the join carried is still there.
    assert_eq!(dave.ally, 1);
    assert_eq!(dave.team_id, 1);
    assert_eq!(dave.sync, 2, "dave is still downloading");
    assert!(
        !battle.members["carol"].battle_status.mode,
        "carol is spectating"
    );
    assert!(!battle.members.contains_key("bob"));

    // The bot's display name was set to null, so the roster shows its short
    // name instead.
    assert_eq!(battle.bots.len(), 1);
    let bot = &battle.bots["BARb"];
    assert_eq!(bot.owner, "alice");
    assert_eq!(bot.ai_dll, "BARb");
    assert_eq!(bot.battle_status.ally, 1);
    assert_eq!(bot.battle_status.team_id, 1);

    // One start box per ally team, in the 0 to 200 space `Battle` uses.
    assert_eq!(battle.start_rects.len(), 2);
    assert_eq!(battle.start_rects[&0].left, 0);
    assert_eq!(battle.start_rects[&0].right, 50);
    assert_eq!(battle.start_rects[&1].left, 150);
    assert_eq!(battle.start_rects[&1].right, 200);
}

#[test]
fn leaving_empties_the_room_and_leaves_the_lobby_listed() {
    let frames: Vec<&str> = TRANSCRIPT.iter().copied().chain([LEAVING]).collect();
    let (state, room) = play(&frames);

    assert!(room.is_none(), "the room should be gone");
    assert_eq!(state.current_battle, None);

    // The lobby is still in the list, so only the parts the room filled in go.
    let battle = battle_for(&state, LOBBY_A);
    assert_eq!(state.last_battle, Some(battle.id));
    assert!(battle.members.is_empty());
    assert!(battle.bots.is_empty());
    assert!(battle.start_rects.is_empty());
    assert_eq!(battle.title, "Comet Catcher 8v8");
    assert_eq!(battle.max_players, 16);
}

/// Parsing is total. A command id the vendored schema does not have lands in
/// `Unknown` with the frame kept raw, so a server ahead of us costs one frame
/// rather than the session.
#[test]
fn an_unrecognised_command_parses_rather_than_failing() {
    let unknown: Vec<&&str> = TRANSCRIPT
        .iter()
        .filter(|frame| matches!(parse_frame(frame), TachyonMessage::Unknown { .. }))
        .collect();

    assert_eq!(unknown.len(), 1, "the transcript should hold exactly one");
    assert!(unknown[0].contains("lobby/chatMessage"));
    // Nothing else in the transcript fell back to Unknown or Invalid, which is
    // what a frame this crate should have understood would do.
    assert!(
        !TRANSCRIPT
            .iter()
            .any(|frame| matches!(parse_frame(frame), TachyonMessage::Invalid { .. })),
        "a frame the schema covers did not parse"
    );
}
