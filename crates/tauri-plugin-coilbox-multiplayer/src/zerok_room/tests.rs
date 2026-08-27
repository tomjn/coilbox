//! The room a message at a time, and the lines it answers with.

use coilbox_zerok_protocol::line;

use super::*;

/// Fold a wire line into the state the way the connection does.
fn feed(state: &mut LobbyState, raw: &str) -> Reduced {
    let message = line::parse_line(raw).expect("the line parses");
    reduce(state, &message)
}

/// The lines a fold answered with, built against the state it produced.
fn replies(state: &LobbyState, actions: &[RoomAction]) -> Vec<String> {
    actions
        .iter()
        .flat_map(|action| build(state, action).expect("the command serialises"))
        .collect()
}

/// A state logged in as `someone`, with one open battle to join.
fn ready() -> LobbyState {
    let mut state = LobbyState::new();
    state.my_username = Some("someone".into());
    state.battles.insert(
        42,
        Battle {
            id: 42,
            ..Default::default()
        },
    );
    state
}

/// A state already in battle 42.
fn in_room() -> LobbyState {
    let mut state = ready();
    feed(
        &mut state,
        r#"JoinBattleSuccess {"BattleID":42,"Players":[{"Name":"someone"}]}"#,
    );
    state
}

#[test]
fn a_join_puts_us_in_the_room_with_its_whole_roster() {
    let mut state = ready();
    let (deltas, actions) = feed(
        &mut state,
        r#"JoinBattleSuccess {"BattleID":42,"Players":[{"Name":"someone","AllyNumber":0,"IsSpectator":false},{"Name":"another","AllyNumber":1,"IsSpectator":true}],"Bots":[{"Name":"CAI (1)","AiLib":"CAI","AllyNumber":1,"Owner":"another"}],"Options":{"MaxUnits":"2000"},"MapOptions":{"WaterLevel":"-50"}}"#,
    );

    assert_eq!(state.current_battle, Some(42));
    let battle = &state.battles[&42];
    assert_eq!(battle.members.len(), 2);
    assert!(battle.members["someone"].battle_status.mode, "a player");
    assert!(!battle.members["another"].battle_status.mode, "a spectator");
    assert_eq!(battle.members["another"].battle_status.ally, 1);
    assert_eq!(battle.bots["CAI (1)"].ai_dll, "CAI");
    assert_eq!(battle.bots["CAI (1)"].owner, "another");
    assert_eq!(battle.bots["CAI (1)"].battle_status.ally, 1);
    // The room's options panel and the launch config both read script tags, so
    // the two dictionaries land under the namespaces they expect.
    assert_eq!(battle.script_tags["game/modoptions/maxunits"], "2000");
    assert_eq!(battle.script_tags["game/mapoptions/waterlevel"], "-50");
    assert_eq!(deltas, vec![Delta::EnteredBattle { id: 42, own: false }]);

    // The whole reason the join is answered rather than left alone: nothing
    // about a seat can be sent until the server has confirmed we are in the
    // room, and a room that never hears a sync holds us at unknown.
    assert_eq!(
        replies(&state, &actions),
        vec![
            r#"UpdateUserBattleStatus {"AllyNumber":0,"IsSpectator":true,"Name":"someone","Sync":2}"#
        ]
    );
}

/// A seat set before the join went out is applied when the join lands, which is
/// the only moment the server will take it.
#[test]
fn a_seat_asked_for_before_the_join_is_sent_when_the_join_lands() {
    let mut state = ready();
    state.my_intended_battle_status = Some((
        BattleStatus {
            mode: true,
            ally: 1,
            sync: 1,
            ..default_battle_status()
        },
        0,
    ));

    let (_, actions) = feed(&mut state, r#"JoinBattleSuccess {"BattleID":42}"#);

    assert_eq!(
        replies(&state, &actions),
        vec![
            r#"UpdateUserBattleStatus {"AllyNumber":1,"IsSpectator":false,"Name":"someone","Sync":1}"#
        ]
    );
}

/// The join is a snapshot, so it replaces rather than merging. A stale roster
/// from the room before it would otherwise show players who are not here.
#[test]
fn a_second_join_replaces_the_room_rather_than_adding_to_it() {
    let mut state = in_room();
    state.battles.insert(
        43,
        Battle {
            id: 43,
            ..Default::default()
        },
    );

    feed(
        &mut state,
        r#"JoinBattleSuccess {"BattleID":43,"Players":[{"Name":"third"}]}"#,
    );

    assert_eq!(state.current_battle, Some(43));
    assert_eq!(state.last_battle, Some(42));
    assert!(state.battles[&43].members.contains_key("third"));
    assert!(
        !state.battles[&42].members.contains_key("someone"),
        "we are no longer in the room we left"
    );
}

#[test]
fn a_status_update_is_a_patch_over_the_seat_we_hold() {
    let mut state = in_room();
    feed(
        &mut state,
        r#"UpdateUserBattleStatus {"Name":"someone","AllyNumber":2,"IsSpectator":false,"Sync":1}"#,
    );

    let (deltas, _) = feed(
        &mut state,
        r#"UpdateUserBattleStatus {"Name":"someone","Sync":2}"#,
    );

    let seat = state.battles[&42].members["someone"].battle_status;
    assert_eq!(seat.sync, 2);
    assert_eq!(seat.ally, 2, "the ally team was not named, so it stayed");
    assert!(seat.mode, "and neither was the spectator flag");
    assert_eq!(
        deltas,
        vec![Delta::MemberStatusChanged {
            battle_id: 42,
            name: "someone".into()
        }]
    );
}

#[test]
fn a_status_for_somebody_new_seats_them() {
    let mut state = in_room();
    let (deltas, _) = feed(
        &mut state,
        r#"UpdateUserBattleStatus {"Name":"another","AllyNumber":1}"#,
    );

    assert_eq!(state.battles[&42].members["another"].battle_status.ally, 1);
    assert_eq!(
        deltas,
        vec![Delta::MemberJoined {
            battle_id: 42,
            name: "another".into()
        }]
    );
}

#[test]
fn a_status_outside_a_room_is_the_tail_of_one_we_have_left() {
    let mut state = ready();
    let (deltas, _) = feed(
        &mut state,
        r#"UpdateUserBattleStatus {"Name":"someone","AllyNumber":1}"#,
    );
    assert_eq!(deltas, vec![]);
}

#[test]
fn a_bot_is_seated_moved_and_taken_out() {
    let mut state = in_room();
    let (deltas, _) = feed(
        &mut state,
        r#"UpdateBotStatus {"Name":"CAI (1)","AiLib":"CAI","AllyNumber":1,"Owner":"someone"}"#,
    );
    assert_eq!(state.battles[&42].bots["CAI (1)"].ai_dll, "CAI");
    assert!(
        state.battles[&42].bots["CAI (1)"].battle_status.mode,
        "a bot is never a spectator"
    );
    assert_eq!(
        deltas,
        vec![Delta::BotChanged {
            battle_id: 42,
            name: "CAI (1)".into()
        }]
    );

    // The same command moves it and changes its AI, because it is a patch keyed
    // by the name rather than a fresh record.
    feed(
        &mut state,
        r#"UpdateBotStatus {"Name":"CAI (1)","AiLib":"Null AI","AllyNumber":0}"#,
    );
    let bot = &state.battles[&42].bots["CAI (1)"];
    assert_eq!(bot.ai_dll, "Null AI");
    assert_eq!(bot.battle_status.ally, 0);
    assert_eq!(
        bot.owner, "someone",
        "the owner was not named, so it stayed"
    );

    let (deltas, _) = feed(&mut state, r#"RemoveBot {"Name":"CAI (1)"}"#);
    assert!(state.battles[&42].bots.is_empty());
    assert_eq!(
        deltas,
        vec![Delta::BotRemoved {
            battle_id: 42,
            name: "CAI (1)".into()
        }]
    );
}

/// Upstream assigns the dictionary it is handed, so a key that is gone from the
/// message is gone from the room.
#[test]
fn setting_the_options_replaces_that_namespace_and_leaves_the_others() {
    let mut state = in_room();
    feed(
        &mut state,
        r#"SetModOptions {"Options":{"MaxUnits":"2000","Commanders":"1"}}"#,
    );
    feed(
        &mut state,
        r#"SetMapOptions {"Options":{"WaterLevel":"-50"}}"#,
    );

    let (deltas, _) = feed(
        &mut state,
        r#"SetModOptions {"Options":{"MaxUnits":"500"}}"#,
    );

    let tags = &state.battles[&42].script_tags;
    assert_eq!(tags["game/modoptions/maxunits"], "500");
    assert!(!tags.contains_key("game/modoptions/commanders"));
    assert_eq!(
        tags["game/mapoptions/waterlevel"], "-50",
        "the map options were not touched"
    );
    assert_eq!(deltas, vec![Delta::ScriptTagsChanged]);
}

#[test]
fn a_yes_or_no_poll_opens_the_vote_panel() {
    let mut state = in_room();
    let (deltas, _) = feed(
        &mut state,
        r#"BattlePoll {"Topic":"Start the game?","YesNoVote":true,"VotesToWin":3,"Options":[{"Name":"Yes","Votes":2,"Id":1},{"Name":"No","Votes":1,"Id":2}]}"#,
    );

    let vote = state.current_vote.as_ref().expect("a vote is open");
    assert_eq!(vote.subject, "Start the game?");
    assert_eq!(vote.yes, 2);
    assert_eq!(vote.no, 1);
    assert_eq!(vote.yes_needed, 3);
    assert_eq!(vote.no_needed, 3);
    assert!(!vote.allow_abstain, "there is no third answer to give");
    assert_eq!(deltas, vec![Delta::VoteChanged]);
}

/// Matched by name rather than by position, because nothing on the wire says
/// which order they arrive in.
#[test]
fn the_two_answers_are_found_by_name_whichever_order_they_come_in() {
    let mut state = in_room();
    feed(
        &mut state,
        r#"BattlePoll {"Topic":"Kick someone?","YesNoVote":true,"Options":[{"Name":"No","Votes":4,"Id":2},{"Name":"Yes","Votes":1,"Id":1}]}"#,
    );

    let vote = state.current_vote.as_ref().expect("a vote is open");
    assert_eq!(vote.yes, 1);
    assert_eq!(vote.no, 4);
}

/// A map poll offers a list of maps. Squeezing that into two counters would put
/// a Yes and a No panel on a question that has neither.
#[test]
fn a_poll_that_is_not_a_yes_or_no_opens_no_panel() {
    let mut state = in_room();
    let (deltas, _) = feed(
        &mut state,
        r#"BattlePoll {"Topic":"Pick a map","YesNoVote":false,"MapSelection":true,"Options":[{"Name":"Comet Catcher","Votes":2,"Id":1},{"Name":"Icy Run","Votes":1,"Id":2}]}"#,
    );

    assert!(state.current_vote.is_none());
    assert_eq!(deltas, vec![]);
}

#[test]
fn a_poll_that_ends_closes_the_panel_and_says_how_it_went() {
    let mut state = in_room();
    feed(
        &mut state,
        r#"BattlePoll {"Topic":"Start the game?","YesNoVote":true,"Options":[{"Name":"Yes","Votes":1,"Id":1}]}"#,
    );

    let (deltas, _) = feed(
        &mut state,
        r#"BattlePollOutcome {"Topic":"Start the game?","Success":true,"YesNoVote":true,"Message":"Poll passed."}"#,
    );

    assert!(state.current_vote.is_none());
    assert_eq!(
        deltas,
        vec![
            Delta::VoteChanged,
            Delta::ServerMessage {
                text: "Poll passed.".into(),
                boxed: false
            },
        ]
    );
}

/// A poll with no topic is the server saying there is no longer one, which is
/// how a cancelled poll arrives.
#[test]
fn a_poll_with_no_topic_closes_the_panel() {
    let mut state = in_room();
    feed(
        &mut state,
        r#"BattlePoll {"Topic":"Start the game?","YesNoVote":true}"#,
    );

    let (deltas, _) = feed(&mut state, r#"BattlePoll {"VotesToWin":-1}"#);
    assert!(state.current_vote.is_none());
    assert_eq!(deltas, vec![Delta::VoteChanged]);
}

#[test]
fn a_kick_aimed_at_us_takes_us_out_of_the_room() {
    let mut state = in_room();
    let (deltas, _) = feed(
        &mut state,
        r#"KickFromBattle {"BattleID":42,"Name":"someone","Reason":"afk"}"#,
    );

    assert_eq!(state.current_battle, None);
    assert_eq!(
        deltas,
        vec![Delta::MemberLeft {
            battle_id: 42,
            name: "someone".into()
        }]
    );
}

/// `LeaveBattle` is a client message and the server has no answer for it, so
/// our own record with the battle gone is the only thing that says we left.
/// Without this the room stays open on a battle we are no longer in.
#[test]
fn our_own_record_with_no_battle_takes_us_out_of_the_room() {
    let mut state = in_room();
    let (deltas, _) = feed(&mut state, r#"User {"Name":"someone"}"#);

    assert_eq!(state.current_battle, None);
    assert_eq!(state.last_battle, Some(42));
    assert_eq!(
        deltas,
        vec![Delta::MemberLeft {
            battle_id: 42,
            name: "someone".into()
        }]
    );
}

/// Somebody else leaving is theirs to be taken out of, and [`crate::zerok_users`]
/// does that. The room we are in is untouched.
#[test]
fn somebody_else_leaving_leaves_us_where_we_are() {
    let mut state = in_room();
    let (deltas, _) = feed(&mut state, r#"User {"Name":"another"}"#);

    assert_eq!(state.current_battle, Some(42));
    assert_eq!(deltas, vec![]);
}

/// The record is re-broadcast on every change, so most of them arrive while we
/// are sitting in the room it names.
#[test]
fn our_own_record_still_naming_our_room_leaves_us_in_it() {
    let mut state = in_room();
    let (deltas, _) = feed(&mut state, r#"User {"Name":"someone","BattleID":42}"#);

    assert_eq!(state.current_battle, Some(42));
    assert_eq!(deltas, vec![]);
}

/// The connection folds the directory before the room, and both act on the same
/// record. Only one of them announces the departure.
#[test]
fn leaving_is_announced_once_across_the_two_folds() {
    let mut state = in_room();
    // The directory already holds everybody by the time a room is joined, so a
    // record arriving now is an update rather than a first sighting.
    let seen = line::parse_line(r#"User {"Name":"someone","BattleID":42}"#).expect("it parses");
    crate::zerok_users::reduce(&mut state, &seen);

    let message = line::parse_line(r#"User {"Name":"someone"}"#).expect("the line parses");
    let mut deltas = crate::zerok_users::reduce(&mut state, &message);
    let (room, _) = reduce(&mut state, &message);
    deltas.extend(room);

    assert_eq!(state.current_battle, None);
    assert_eq!(
        deltas,
        vec![Delta::MemberLeft {
            battle_id: 42,
            name: "someone".into()
        }]
    );
}

/// A kick is broadcast to the whole room, so it has to be read as being about
/// somebody else.
#[test]
fn a_kick_aimed_at_somebody_else_leaves_us_where_we_are() {
    let mut state = in_room();
    let (deltas, _) = feed(
        &mut state,
        r#"KickFromBattle {"BattleID":42,"Name":"another"}"#,
    );

    assert_eq!(state.current_battle, Some(42));
    assert_eq!(deltas, vec![]);
}

#[test]
fn being_moved_by_the_server_joins_the_room_it_names() {
    let mut state = in_room();
    let (_, actions) = feed(
        &mut state,
        r#"ForceJoinBattle {"BattleID":43,"Name":"someone"}"#,
    );

    assert_eq!(
        replies(&state, &actions),
        vec![r#"JoinBattle {"BattleID":43}"#]
    );
}

#[test]
fn being_moved_names_who_is_being_moved() {
    let mut state = in_room();
    let (_, actions) = feed(
        &mut state,
        r#"ForceJoinBattle {"BattleID":43,"Name":"another"}"#,
    );
    assert!(actions.is_empty());
}

// -------------------------------------------------------------------------
// The lines the room's controls send.
// -------------------------------------------------------------------------

#[test]
fn a_join_names_the_battle_and_leaves_an_empty_password_out() {
    let state = ready();
    assert_eq!(
        replies(
            &state,
            &[RoomAction::Join {
                battle: 42,
                password: Some(String::new()),
            }]
        ),
        vec![r#"JoinBattle {"BattleID":42}"#]
    );
    assert_eq!(
        replies(
            &state,
            &[RoomAction::Join {
                battle: 42,
                password: Some("hunter2".into()),
            }]
        ),
        vec![r#"JoinBattle {"BattleID":42,"Password":"hunter2"}"#]
    );
}

/// A mode upstream does not know is answered with "Incorrect battle type" and
/// opens nothing, so a name we cannot place is refused here rather than sent as
/// a number nobody has. Planet Wars is one of those names: the server runs that
/// campaign and hands out its rooms itself.
#[test]
fn the_battle_modes_are_the_ones_a_person_may_open_a_room_in() {
    assert_eq!(autohost_mode("custom"), Some(types::AutohostMode::None));
    assert_eq!(autohost_mode("teams"), Some(types::AutohostMode::Teams));
    assert_eq!(autohost_mode("1v1"), Some(types::AutohostMode::Game1v1));
    assert_eq!(autohost_mode("ffa"), Some(types::AutohostMode::GameFFA));
    assert_eq!(
        autohost_mode("coop"),
        Some(types::AutohostMode::GameChickens)
    );
    assert_eq!(autohost_mode("planetwars"), None);
    assert_eq!(autohost_mode(""), None);
}

/// The server fills in the rest. `ServerBattle.ValidateAndFillDetails` upstream
/// overwrites the engine with its own for every mode but Custom, and resolves
/// the game against its own resources, so neither is ours to ask for. What is
/// not there at all is the port, the NAT mode and the two content hashes
/// `OPENBATTLE` carries: nothing about this room runs on this machine.
#[test]
fn opening_a_room_asks_for_a_title_a_map_a_size_and_a_mode() {
    let state = ready();
    assert_eq!(
        replies(
            &state,
            &[RoomAction::Open {
                title: "someone's game".into(),
                map: Some("Comet Catcher Remake 1.8".into()),
                mode: types::AutohostMode::None,
                max_players: 8,
                password: Some("hunter2".into()),
            }]
        ),
        vec![
            r#"OpenBattle {"Header":{"Map":"Comet Catcher Remake 1.8","MaxPlayers":8,"Mode":0,"Password":"hunter2","Title":"someone's game"}}"#
        ]
    );
}

/// An empty password is a room anyone may join, and upstream tests the field
/// with `IsNullOrEmpty`, so an empty string would read the same as none. It is
/// left out rather than sent empty, as it is on a join.
#[test]
fn opening_a_room_without_a_password_or_a_map_leaves_both_out() {
    let state = ready();
    assert_eq!(
        replies(
            &state,
            &[RoomAction::Open {
                title: "someone's game".into(),
                map: None,
                mode: types::AutohostMode::Teams,
                max_players: 16,
                password: Some(String::new()),
            }]
        ),
        vec![r#"OpenBattle {"Header":{"MaxPlayers":16,"Mode":6,"Title":"someone's game"}}"#]
    );
}

/// Upstream's `Process(OpenBattle)` answers somebody who is already in a room
/// with "You are already in a battle" and opens nothing, and its own client
/// leaves first for that reason. The refusal comes back as a message box rather
/// than as a failure, so a client that did not leave would be left waiting on a
/// room that is never coming.
#[test]
fn opening_a_room_leaves_the_one_we_are_already_in() {
    assert_eq!(
        replies(
            &in_room(),
            &[RoomAction::Open {
                title: "someone's game".into(),
                map: None,
                mode: types::AutohostMode::None,
                max_players: 8,
                password: None,
            }]
        ),
        vec![
            r#"LeaveBattle {"BattleID":42}"#,
            r#"OpenBattle {"Header":{"MaxPlayers":8,"Mode":0,"Title":"someone's game"}}"#,
        ]
    );
}

#[test]
fn leaving_names_the_room_we_are_in_and_says_nothing_when_we_are_in_none() {
    let state = in_room();
    assert_eq!(
        replies(&state, &[RoomAction::Leave]),
        vec![r#"LeaveBattle {"BattleID":42}"#]
    );
    assert!(replies(&ready(), &[RoomAction::Leave]).is_empty());
}

/// The two fields the server throws on. Both go out on every status, whatever
/// the room control that produced it was actually changing.
#[test]
fn every_status_carries_our_name_and_the_sync_flag() {
    let state = in_room();
    let sent = replies(
        &state,
        &[RoomAction::OwnStatus(BattleStatus {
            mode: true,
            ally: 3,
            sync: 1,
            // None of these has anywhere to go on Zero-K, and carrying them
            // must not stop the three that do.
            ready: true,
            team_id: 7,
            handicap: 50,
            side: 2,
        })],
    );
    assert_eq!(
        sent,
        vec![
            r#"UpdateUserBattleStatus {"AllyNumber":3,"IsSpectator":false,"Name":"someone","Sync":1}"#
        ]
    );
}

/// A status with nobody to name arrives at the server as a null dictionary key
/// and throws inside it, so it is not sent at all.
#[test]
fn a_status_before_we_know_our_own_name_is_not_sent() {
    let mut state = in_room();
    state.my_username = None;
    assert!(replies(&state, &[RoomAction::OwnStatus(default_battle_status())]).is_empty());
}

#[test]
fn seating_a_bot_names_it_and_says_who_owns_it() {
    let state = in_room();
    assert_eq!(
        replies(
            &state,
            &[RoomAction::Bot {
                name: "CAI (1)".into(),
                ally: 1,
                ai: "CAI".into(),
            }]
        ),
        vec![
            r#"UpdateBotStatus {"AiLib":"CAI","AllyNumber":1,"Name":"CAI (1)","Owner":"someone"}"#
        ]
    );
}

#[test]
fn the_options_go_out_whole_rather_than_as_a_patch() {
    let state = in_room();
    let mut options = BTreeMap::new();
    options.insert("MaxUnits".to_string(), "2000".to_string());
    assert_eq!(
        replies(&state, &[RoomAction::ModOptions(options.clone())]),
        vec![r#"SetModOptions {"Options":{"MaxUnits":"2000"}}"#]
    );
    assert_eq!(
        replies(&state, &[RoomAction::MapOptions(options)]),
        vec![r#"SetMapOptions {"Options":{"MaxUnits":"2000"}}"#]
    );
}

#[test]
fn a_kick_names_the_room_as_well_as_the_person() {
    let state = in_room();
    assert_eq!(
        replies(
            &state,
            &[RoomAction::Kick {
                username: "another".into()
            }]
        ),
        vec![r#"KickFromBattle {"BattleID":42,"Name":"another"}"#]
    );
}

/// The room's own commands. Zero-K has no message for starting a match or for
/// voting, so both are typed into battle chat where its autohost reads them.
#[test]
fn a_room_command_goes_out_as_battle_chat() {
    let state = in_room();
    assert_eq!(
        replies(
            &state,
            &[RoomAction::Say {
                text: "!start".into()
            }]
        ),
        vec![r#"Say {"IsEmote":false,"Place":1,"Ring":false,"Text":"!start"}"#]
    );
}

#[test]
fn a_vote_is_typed_the_way_the_official_client_types_it() {
    assert_eq!(vote_text(VoteChoice::Yes), Some("!y"));
    assert_eq!(vote_text(VoteChoice::No), Some("!n"));
    // A Zero-K poll offers two answers, so there is no third to type.
    assert_eq!(vote_text(VoteChoice::Abstain), None);
}
