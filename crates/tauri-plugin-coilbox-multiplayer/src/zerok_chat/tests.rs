//! Chat a message at a time, and the lines it sends.

use coilbox_lobby_protocol::Battle;
use coilbox_zerok_protocol::line;

use super::*;

/// A fixed stamp, so a test asserting one is not asserting the clock.
const AT: u64 = 1_772_000_000_000;

/// Fold a wire line into the state the way the connection does.
fn feed(state: &mut LobbyState, raw: &str) -> Reduced {
    let message = line::parse_line(raw).expect("the line parses");
    reduce(state, &message, AT)
}

/// The lines a fold answered with.
fn replies(state: &LobbyState, actions: &[ChatAction]) -> Vec<String> {
    actions
        .iter()
        .flat_map(|action| build(state, action).expect("the command serialises"))
        .collect()
}

fn ready() -> LobbyState {
    let mut state = LobbyState::new();
    state.my_username = Some("someone".into());
    state
}

/// The same, in battle 42 so battle chat has somewhere to go.
fn in_room() -> LobbyState {
    let mut state = ready();
    state.battles.insert(
        42,
        Battle {
            id: 42,
            channel: Some(battle_channel(42)),
            ..Default::default()
        },
    );
    state.current_battle = Some(42);
    state
}

/// The lines of a channel, as `(from, text, kind)`.
fn lines(state: &LobbyState, channel: &str) -> Vec<(String, String, ChatKind)> {
    state.channels[channel]
        .messages
        .iter()
        .map(|m| (m.from.clone(), m.text.clone(), m.kind))
        .collect()
}

#[test]
fn a_channel_line_lands_in_that_channel() {
    let mut state = ready();
    let (deltas, _) = feed(
        &mut state,
        r#"Say {"Place":0,"Target":"zk","User":"another","Text":"good game all"}"#,
    );

    assert_eq!(
        lines(&state, "zk"),
        vec![(
            "another".to_string(),
            "good game all".to_string(),
            ChatKind::Said
        )]
    );
    assert_eq!(state.channels["zk"].messages[0].at, AT);
    assert_eq!(
        deltas,
        vec![Delta::ChatMessage {
            channel: Some("zk".into()),
            index: 0
        }]
    );
}

#[test]
fn an_emote_is_an_action_wherever_it_is_said() {
    let mut state = ready();
    feed(
        &mut state,
        r#"Say {"Place":0,"Target":"zk","User":"another","Text":"waves","IsEmote":true}"#,
    );
    assert_eq!(state.channels["zk"].messages[0].kind, ChatKind::SaidEx);
}

/// A private message is echoed to both ends, so the thread is named after
/// whichever of the two is not us.
#[test]
fn a_direct_message_is_filed_under_the_other_person_whichever_way_it_went() {
    let mut state = ready();
    feed(
        &mut state,
        r#"Say {"Place":2,"User":"another","Target":"someone","Text":"hello"}"#,
    );
    let (deltas, _) = feed(
        &mut state,
        r#"Say {"Place":2,"User":"someone","Target":"another","Text":"hello yourself"}"#,
    );

    let thread = &state.dms["another"];
    assert_eq!(thread.len(), 2, "one thread, not two: {:?}", state.dms);
    assert_eq!(thread[0].from, "another");
    assert_eq!(thread[1].from, "someone");
    assert_eq!(thread[1].kind, ChatKind::Private);
    assert_eq!(
        deltas,
        vec![Delta::PrivateMessage {
            from: "another".into()
        }]
    );
}

/// All three battle places render beside the room's conversation: one is the
/// room, one is the server talking to one person in it, and one is relayed out
/// of the running match.
#[test]
fn every_battle_place_lands_in_the_room_s_conversation() {
    let mut state = in_room();
    for place in [1, 3, 4] {
        feed(
            &mut state,
            &format!(r#"Say {{"Place":{place},"User":"another","Text":"in the room"}}"#),
        );
    }

    assert_eq!(state.channels[&battle_channel(42)].messages.len(), 3);
}

#[test]
fn battle_chat_with_no_room_to_say_it_in_goes_nowhere() {
    let mut state = ready();
    let (deltas, _) = feed(
        &mut state,
        r#"Say {"Place":1,"User":"another","Text":"in the room"}"#,
    );
    assert!(state.channels.is_empty());
    assert_eq!(deltas, vec![]);
}

/// A mute, a ban or an announcement. Upstream's own client shows one in a box
/// rather than scrolling past it, which is where the place gets its name.
#[test]
fn a_message_box_is_a_notice_rather_than_chat() {
    let mut state = ready();
    let (deltas, _) = feed(
        &mut state,
        r#"Say {"Place":5,"Text":"You have been muted for 10 minutes."}"#,
    );

    assert!(state.channels.is_empty());
    assert_eq!(
        deltas,
        vec![Delta::ServerMessage {
            text: "You have been muted for 10 minutes.".into(),
            boxed: true
        }]
    );
}

#[test]
fn a_place_this_build_does_not_know_is_not_filed_anywhere() {
    let mut state = ready();
    let (deltas, _) = feed(&mut state, r#"Say {"Place":99,"Text":"from the future"}"#);
    assert!(state.channels.is_empty());
    assert_eq!(deltas, vec![]);
}

// -------------------------------------------------------------------------
// Channels.
// -------------------------------------------------------------------------

#[test]
fn joining_a_channel_brings_its_members_and_its_topic() {
    let mut state = ready();
    let (deltas, _) = feed(
        &mut state,
        r#"JoinChannelResponse {"Success":true,"ChannelName":"zk","Channel":{"ChannelName":"zk","Users":["someone","another"],"Topic":{"Text":"be nice","SetBy":"admin"}}}"#,
    );

    let channel = &state.channels["zk"];
    assert_eq!(channel.users.len(), 2);
    assert!(channel.users.contains("another"));
    assert_eq!(channel.topic.as_deref(), Some("be nice"));
    assert_eq!(
        deltas,
        vec![Delta::ChannelJoined {
            channel: "zk".into()
        }]
    );
}

#[test]
fn a_refused_channel_says_why() {
    let mut state = ready();
    let (deltas, _) = feed(
        &mut state,
        r#"JoinChannelResponse {"Success":false,"ChannelName":"secret","Reason":"invalid password"}"#,
    );

    assert!(state.channels.is_empty());
    assert_eq!(
        deltas,
        vec![Delta::JoinChannelFailed {
            channel: "secret".into(),
            reason: "invalid password".into()
        }]
    );
}

/// A header sent for a new topic alone must not empty the channel.
#[test]
fn a_header_without_a_member_list_leaves_the_one_we_hold() {
    let mut state = ready();
    feed(
        &mut state,
        r#"ChannelHeader {"ChannelName":"zk","Users":["someone","another"]}"#,
    );

    feed(
        &mut state,
        r#"ChannelHeader {"ChannelName":"zk","Topic":{"Text":"tournament on Saturday"}}"#,
    );

    let channel = &state.channels["zk"];
    assert_eq!(channel.users.len(), 2);
    assert_eq!(channel.topic.as_deref(), Some("tournament on Saturday"));
}

#[test]
fn somebody_arriving_and_going_is_a_line_in_the_channel() {
    let mut state = ready();
    feed(&mut state, r#"ChannelHeader {"ChannelName":"zk"}"#);

    feed(
        &mut state,
        r#"ChannelUserAdded {"ChannelName":"zk","UserName":"another"}"#,
    );
    assert!(state.channels["zk"].users.contains("another"));

    feed(
        &mut state,
        r#"ChannelUserRemoved {"ChannelName":"zk","UserName":"another"}"#,
    );
    assert!(state.channels["zk"].users.is_empty());
    assert_eq!(
        lines(&state, "zk"),
        vec![
            ("another".to_string(), String::new(), ChatKind::Join),
            ("another".to_string(), String::new(), ChatKind::Leave),
        ]
    );
}

/// Us going is us leaving. The channel is dropped rather than trimmed, so it
/// does not linger in the list as one we are still in.
#[test]
fn us_being_removed_takes_the_channel_out_of_the_list() {
    let mut state = ready();
    feed(
        &mut state,
        r#"ChannelHeader {"ChannelName":"zk","Users":["someone"]}"#,
    );

    let (deltas, _) = feed(
        &mut state,
        r#"ChannelUserRemoved {"ChannelName":"zk","UserName":"someone"}"#,
    );

    assert!(state.channels.is_empty());
    assert_eq!(
        deltas,
        vec![Delta::ChannelLeft {
            channel: "zk".into()
        }]
    );
}

#[test]
fn being_kicked_from_a_channel_takes_it_out_of_the_list_too() {
    let mut state = ready();
    feed(
        &mut state,
        r#"ChannelHeader {"ChannelName":"zk","Users":["someone"]}"#,
    );

    let (deltas, _) = feed(
        &mut state,
        r#"KickFromChannel {"ChannelName":"zk","UserName":"someone","Reason":"spam"}"#,
    );
    assert!(state.channels.is_empty());
    assert_eq!(
        deltas,
        vec![Delta::ChannelLeft {
            channel: "zk".into()
        }]
    );
}

#[test]
fn a_topic_change_is_a_topic_change() {
    let mut state = ready();
    feed(&mut state, r#"ChannelHeader {"ChannelName":"zk"}"#);

    let (deltas, _) = feed(
        &mut state,
        r#"ChangeTopic {"ChannelName":"zk","Topic":{"Text":"tournament on Saturday","SetBy":"admin"}}"#,
    );

    assert_eq!(
        state.channels["zk"].topic.as_deref(),
        Some("tournament on Saturday")
    );
    assert_eq!(
        deltas,
        vec![Delta::ChannelTopicChanged {
            channel: "zk".into()
        }]
    );

    // The same topic again says nothing new.
    let (deltas, _) = feed(
        &mut state,
        r#"ChangeTopic {"ChannelName":"zk","Topic":{"Text":"tournament on Saturday"}}"#,
    );
    assert_eq!(deltas, vec![]);
}

#[test]
fn being_put_in_a_channel_asks_to_join_it() {
    let mut state = ready();
    let (_, actions) = feed(
        &mut state,
        r#"ForceJoinChannel {"ChannelName":"zk","UserName":"someone"}"#,
    );
    assert_eq!(
        replies(&state, &actions),
        vec![r#"JoinChannel {"ChannelName":"zk"}"#]
    );
}

#[test]
fn being_put_in_a_channel_names_who_is_being_put_there() {
    let mut state = ready();
    let (_, actions) = feed(
        &mut state,
        r#"ForceJoinChannel {"ChannelName":"zk","UserName":"another"}"#,
    );
    assert!(actions.is_empty());
}

// -------------------------------------------------------------------------
// Friends and ignores.
// -------------------------------------------------------------------------

#[test]
fn the_friend_list_is_taken_whole() {
    let mut state = ready();
    let (deltas, _) = feed(
        &mut state,
        r#"FriendList {"Friends":[{"Name":"another"},{"Name":"third"}]}"#,
    );

    assert_eq!(
        state.friends.iter().cloned().collect::<Vec<_>>(),
        vec!["another", "third"]
    );
    assert_eq!(deltas, vec![Delta::FriendsChanged]);

    // The server sends the whole list after every change, so a shorter one means
    // somebody was dropped rather than left alone.
    feed(&mut state, r#"FriendList {"Friends":[{"Name":"third"}]}"#);
    assert_eq!(
        state.friends.iter().cloned().collect::<Vec<_>>(),
        vec!["third"]
    );
}

#[test]
fn the_ignore_list_is_carried_out_as_well_as_stored() {
    let mut state = ready();
    let (deltas, _) = feed(&mut state, r#"IgnoreList {"Ignores":["another","third"]}"#);

    assert_eq!(
        state.server_ignores.iter().cloned().collect::<Vec<_>>(),
        vec!["another", "third"]
    );
    // Carried in the delta so the frontend reconciles it against the local list
    // in one shot rather than reading it back.
    assert_eq!(
        deltas,
        vec![Delta::ServerIgnoreList {
            ignores: vec!["another".into(), "third".into()]
        }]
    );
}

// -------------------------------------------------------------------------
// The lines the chat controls send.
// -------------------------------------------------------------------------

#[test]
fn a_channel_line_names_the_channel_and_a_battle_line_names_nothing() {
    let state = in_room();
    assert_eq!(
        replies(
            &state,
            &[ChatAction::Say {
                place: Place::Channel("zk".into()),
                emote: false,
                text: "good game all".into(),
            }]
        ),
        vec![
            r#"Say {"IsEmote":false,"Place":0,"Ring":false,"Target":"zk","Text":"good game all"}"#
        ]
    );
    assert_eq!(
        replies(
            &state,
            &[ChatAction::Say {
                place: Place::Battle,
                emote: false,
                text: "hello room".into(),
            }]
        ),
        vec![r#"Say {"IsEmote":false,"Place":1,"Ring":false,"Text":"hello room"}"#]
    );
}

#[test]
fn a_private_line_names_the_person_and_an_action_is_flagged_as_one() {
    let state = ready();
    assert_eq!(
        replies(
            &state,
            &[ChatAction::Say {
                place: Place::Peer("another".into()),
                emote: true,
                text: "waves".into(),
            }]
        ),
        vec![r#"Say {"IsEmote":true,"Place":2,"Ring":false,"Target":"another","Text":"waves"}"#]
    );
}

/// A battle line with no room to say it in is dropped rather than sent to
/// whatever the server thinks we are in.
#[test]
fn a_battle_line_outside_a_room_is_not_sent() {
    let state = ready();
    assert!(replies(
        &state,
        &[ChatAction::Say {
            place: Place::Battle,
            emote: false,
            text: "hello room".into(),
        }]
    )
    .is_empty());
}

#[test]
fn joining_and_leaving_a_channel_name_it() {
    let state = ready();
    assert_eq!(
        replies(
            &state,
            &[ChatAction::JoinChannel {
                channel: "zk".into(),
                password: Some(String::new()),
            }]
        ),
        vec![r#"JoinChannel {"ChannelName":"zk"}"#]
    );
    assert_eq!(
        replies(
            &state,
            &[ChatAction::JoinChannel {
                channel: "zk".into(),
                password: Some("hunter2".into()),
            }]
        ),
        vec![r#"JoinChannel {"ChannelName":"zk","Password":"hunter2"}"#]
    );
    assert_eq!(
        replies(
            &state,
            &[ChatAction::LeaveChannel {
                channel: "zk".into()
            }]
        ),
        vec![r#"LeaveChannel {"ChannelName":"zk"}"#]
    );
}

/// One command covers friends and ignores both, and setting it to none is how
/// either is undone.
#[test]
fn a_relation_is_one_command_whichever_of_the_three_it_sets() {
    let state = ready();
    let sent = |relation| {
        replies(
            &state,
            &[ChatAction::Relation {
                username: "another".into(),
                relation,
            }],
        )
    };
    assert_eq!(
        sent(Relation::Friend),
        vec![r#"SetAccountRelation {"Relation":1,"TargetName":"another"}"#]
    );
    assert_eq!(
        sent(Relation::Ignore),
        vec![r#"SetAccountRelation {"Relation":2,"TargetName":"another"}"#]
    );
    assert_eq!(
        sent(Relation::None),
        vec![r#"SetAccountRelation {"Relation":0,"TargetName":"another"}"#]
    );
}
