//! What a debriefing off the wire turns into, rated and unrated.

use coilbox_zerok_protocol::line;

use super::*;

/// Fold a wire line into the state the way the connection does.
fn feed(state: &mut LobbyState, raw: &str) -> Vec<Delta> {
    let message = line::parse_line(raw).expect("the line parses");
    reduce(state, &message)
}

/// A rated game, which is the one this is all for. Everything on the row is
/// filled in, and the category names which rating it counted toward.
#[test]
fn a_rated_game_says_what_it_did_to_the_rating() {
    let mut state = LobbyState::new();
    let deltas = feed(
        &mut state,
        r#"BattleDebriefing {"ServerBattleID":1234567,"RatingCategory":"MatchMaking","Url":"https://zero-k.info/Battles/Detail/1234567","ChatChannel":"debriefing_1234567","DebriefingUsers":{"winner":{"AccountID":1,"AllyNumber":0,"IsInVictoryTeam":true,"EloChange":7.4,"NewElo":1672.2,"NewRank":4,"IsRankup":true,"NextRankElo":1800.0,"PrevRankElo":1600.0,"XpChange":120,"NewXp":9000}}}"#,
    );

    assert_eq!(
        deltas,
        vec![Delta::DebriefingReceived { battle_id: 1234567 }]
    );
    let report = state.debriefing.expect("the debriefing is held");
    assert_eq!(report.battle_id, 1234567);
    assert_eq!(report.rating_category.as_deref(), Some("MatchMaking"));
    assert_eq!(report.chat_channel.as_deref(), Some("debriefing_1234567"));
    assert_eq!(
        report.url.as_deref(),
        Some("https://zero-k.info/Battles/Detail/1234567")
    );

    let row = &report.players[0];
    assert_eq!(row.name, "winner");
    assert!(row.won);
    assert_eq!(row.rating_change, Some(7));
    assert_eq!(row.rating, Some(1672));
    assert_eq!(row.rank, 4);
    assert!(row.ranked_up);
    assert!(!row.ranked_down);
    assert_eq!(row.next_rank_rating, Some(1800));
    assert_eq!(row.prev_rank_rating, Some(1600));
    assert_eq!(row.xp_change, 120);
    assert_eq!(row.xp, 9000);
}

/// The whole reason the category is read rather than `EloChange`. An unrated
/// game arrives with the placeholders the first pass wrote, and showing those
/// would put "+0" beside everybody as though the game had been rated.
#[test]
fn an_unrated_game_has_no_rating_to_change() {
    let mut state = LobbyState::new();
    feed(
        &mut state,
        r#"BattleDebriefing {"ServerBattleID":42,"RatingCategory":"Unrated","DebriefingUsers":{"someone":{"AllyNumber":0,"EloChange":0.0,"NewElo":-1.0,"NextRankElo":-1.0,"PrevRankElo":-1.0,"XpChange":40,"NewXp":500}}}"#,
    );

    let report = state.debriefing.expect("the debriefing is held");
    assert_eq!(report.rating_category, None);
    let row = &report.players[0];
    assert_eq!(row.rating_change, None);
    assert_eq!(row.rating, None);
    assert_eq!(row.next_rank_rating, None);
    assert_eq!(row.prev_rank_rating, None);
    // Experience goes up for playing rather than for winning, so it moves on a
    // game that counted toward no rating at all.
    assert_eq!(row.xp_change, 40);
}

/// A rated game whose rank progress could not be worked out for one player.
/// The server reports that as the same -1 an unrated game carries, so the row
/// keeps its rating change and loses the numbers around it.
#[test]
fn a_rating_the_server_could_not_work_out_is_left_out() {
    let mut state = LobbyState::new();
    feed(
        &mut state,
        r#"BattleDebriefing {"ServerBattleID":42,"RatingCategory":"Casual","DebriefingUsers":{"someone":{"AllyNumber":0,"EloChange":-4.6,"NewElo":-1.0,"NextRankElo":-1.0,"PrevRankElo":-1.0}}}"#,
    );

    let row = &state.debriefing.expect("the debriefing is held").players[0];
    assert_eq!(row.rating_change, Some(-5));
    assert_eq!(row.rating, None);
}

/// The server sends a map, and a map has no order. Side first so the two teams
/// read as two teams.
#[test]
fn the_rows_come_out_by_side_and_then_by_name() {
    let mut state = LobbyState::new();
    feed(
        &mut state,
        r#"BattleDebriefing {"ServerBattleID":42,"DebriefingUsers":{"zoe":{"AllyNumber":0},"adam":{"AllyNumber":1},"beth":{"AllyNumber":0}}}"#,
    );

    let names: Vec<&str> = state
        .debriefing
        .as_ref()
        .expect("the debriefing is held")
        .players
        .iter()
        .map(|row| row.name.as_str())
        .collect();
    assert_eq!(names, vec!["beth", "zoe", "adam"]);
}

/// A game the server would not count carries the reason and nobody at all, and
/// that reason is the whole of what there is to show.
#[test]
fn a_game_that_did_not_count_still_says_why() {
    let mut state = LobbyState::new();
    let deltas = feed(
        &mut state,
        r#"BattleDebriefing {"ServerBattleID":42,"Message":"Cheats were enabled during this game"}"#,
    );

    assert_eq!(deltas, vec![Delta::DebriefingReceived { battle_id: 42 }]);
    let report = state.debriefing.expect("the debriefing is held");
    assert_eq!(
        report.message.as_deref(),
        Some("Cheats were enabled during this game")
    );
    assert!(report.players.is_empty());
}

/// Nobody and nothing to say is nothing to show, so no drawer opens on it.
#[test]
fn a_debriefing_with_nothing_in_it_is_not_worth_raising() {
    let mut state = LobbyState::new();
    let deltas = feed(&mut state, r#"BattleDebriefing {"ServerBattleID":42}"#);

    assert_eq!(deltas, vec![]);
    assert!(state.debriefing.is_none());
}

/// Awards are untyped on the wire, because upstream declares the member
/// `object`. The key and the game's own wording are what a player reads.
#[test]
fn awards_come_through_with_the_game_s_own_wording() {
    let mut state = LobbyState::new();
    feed(
        &mut state,
        r#"BattleDebriefing {"ServerBattleID":42,"DebriefingUsers":{"someone":{"Awards":[{"Key":"mostDamage","Description":"Most damage dealt: 45123"},{"Key":"","Description":"nameless"}]}}}"#,
    );

    let row = &state.debriefing.expect("the debriefing is held").players[0];
    assert_eq!(row.awards.len(), 1);
    assert_eq!(row.awards[0].key, "mostDamage");
    assert_eq!(row.awards[0].description, "Most damage dealt: 45123");
}

/// A shape that is not the list upstream assigns costs the awards, not the
/// debriefing.
#[test]
fn an_award_member_that_is_not_a_list_costs_only_the_awards() {
    let mut state = LobbyState::new();
    feed(
        &mut state,
        r#"BattleDebriefing {"ServerBattleID":42,"DebriefingUsers":{"someone":{"AllyNumber":0,"Awards":"nonsense"}}}"#,
    );

    let row = &state.debriefing.expect("the debriefing is held").players[0];
    assert!(row.awards.is_empty());
}

#[test]
fn a_message_that_carries_no_debriefing_leaves_the_state_alone() {
    let mut state = LobbyState::new();
    let deltas = feed(&mut state, r#"BattleRemoved {"BattleID":42}"#);

    assert_eq!(deltas, vec![]);
    assert!(state.debriefing.is_none());
}
