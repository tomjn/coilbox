//! Golden test: joining a channel and receiving its stored backlog, as the
//! server replays it in answer to `GETCHANNELMESSAGES`.

use coilbox_lobby_protocol::{parse_line, reduce_at, ChatKind, LobbyState};

/// A join followed by the server's history burst. The backlog arrives oldest
/// first as `JSON SAID` frames; `SAID` is ordinary live chat.
///
/// Note the live line landing *mid-burst*: the request is answered off the
/// server's DB thread, so a message said in that window is both broadcast live
/// and present in the backlog behind it. Rare, but it must not misplace anything.
const TRANSCRIPT: &[&str] = &[
    "ACCEPTED alice",
    "JOIN main",
    r#"JSON {"SAID":{"chanName":"main","time":"1718200000","userName":"bob","msg":"first","ex_msg":false,"id":10}}"#,
    r#"JSON {"SAID":{"chanName":"main","time":"1718200060","userName":"carol","msg":"waves","ex_msg":true,"id":11}}"#,
    "SAID main dave live one",
    r#"JSON {"SAID":{"chanName":"main","time":"1718200120","userName":"bob","msg":"last","ex_msg":false,"id":12}}"#,
];

const NOW_MS: u64 = 1_718_300_000_000;

#[test]
fn backlog_lands_in_order_and_is_marked_as_history() {
    let mut state = LobbyState::new();
    for line in TRANSCRIPT {
        reduce_at(&mut state, parse_line(line), NOW_MS);
    }

    let msgs = &state.channels["main"].messages;
    assert_eq!(msgs.len(), 4, "three history lines plus one live");

    // Arrival order is preserved verbatim - no sorting, no prepending.
    let texts: Vec<&str> = msgs.iter().map(|m| m.text.as_str()).collect();
    assert_eq!(texts, ["first", "waves", "live one", "last"]);

    // History carries the server's id and its *send* time.
    assert_eq!(msgs[0].id, Some(10));
    assert_eq!(msgs[0].from, "bob");
    assert_eq!(msgs[0].at, 1_718_200_000_000);
    assert_eq!(msgs[0].kind, ChatKind::Said);

    // ex_msg distinguishes an action from speech, as SAYEX does live.
    assert_eq!(msgs[1].kind, ChatKind::SaidEx);
    assert_eq!(msgs[1].id, Some(11));

    // The live line has no id and is stamped with our receive clock. That
    // distinction is what stops a backlog being re-logged, re-notified, or
    // counted as unread.
    assert_eq!(msgs[2].id, None);
    assert_eq!(msgs[2].at, NOW_MS);
    assert_eq!(msgs[2].from, "dave");

    assert_eq!(msgs[3].id, Some(12));
}

/// A channel that stores no history simply says nothing back, which must leave
/// the channel joined and empty rather than looking like an error.
#[test]
fn a_silent_backlog_leaves_the_channel_empty() {
    let mut state = LobbyState::new();
    for line in ["ACCEPTED alice", "JOIN quiet"] {
        reduce_at(&mut state, parse_line(line), NOW_MS);
    }
    assert!(state.channels.contains_key("quiet"));
    assert!(state.channels["quiet"].messages.is_empty());
}
