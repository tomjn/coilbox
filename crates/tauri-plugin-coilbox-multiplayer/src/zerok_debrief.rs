//! Reading Zero-K's post-match debriefing (issue #2003).
//!
//! When a Zero-K match ends the server pushes `BattleDebriefing` to everybody
//! who played it, carrying a row per player: what their rating did, whether they
//! moved a rank, what experience they earned, and whether they won. Coilbox
//! parsed it into a typed message and dropped it on the floor.
//!
//! This is the only post-match rating feedback either game offers over a lobby
//! protocol. Beyond All Reason has no equivalent, so nothing here is shared and
//! nothing here is written to be.
//!
//! # One row of it
//!
//! The message is about everybody in the match and this keeps our own row. The
//! rest belong to the people they are about, and a lobby client showing a table
//! of other people's rating changes is a scoreboard rather than a debriefing.
//! `DebriefingUsers` is keyed by player name, which is what upstream looks ours
//! up by too.
//!
//! # It is not a rating update
//!
//! Nothing here writes to [`coilbox_lobby_protocol::User::rating`]. The server
//! re-broadcasts the whole `User` record after a rated game, so the standing
//! arrives the ordinary way, and a debriefing is a statement about one match
//! rather than about where somebody stands now. Two writers for one number would
//! only be able to disagree.

use coilbox_lobby_protocol::{Debriefing, Delta, LobbyState};
use coilbox_zerok_protocol::types;
use coilbox_zerok_protocol::ZerokMessage;

/// Apply a Zero-K message to the lobby state, returning the deltas produced.
///
/// Nothing is stored: a match that has ended is news rather than a fact about
/// the lobby, so the whole of it rides on the delta. `state` is read for who we
/// are, which is the only way to know which row is ours.
pub(crate) fn reduce(state: &LobbyState, msg: &ZerokMessage) -> Vec<Delta> {
    let ZerokMessage::BattleDebriefing(debriefing) = msg else {
        return vec![];
    };
    match ours(state, debriefing) {
        Some(debriefing) => vec![Delta::Debriefed { debriefing }],
        None => vec![],
    }
}

/// Our own row of a debriefing, or nothing when it holds none.
///
/// A debriefing for a match we watched rather than played has no row for us, and
/// so has nothing to say. Same for one that arrives before the login response,
/// which cannot happen on a real connection and would otherwise be read against
/// an empty name.
fn ours(state: &LobbyState, debriefing: &types::BattleDebriefing) -> Option<Debriefing> {
    let me = state.my_username.as_deref()?;
    let mine = debriefing.debriefing_users.as_ref()?.get(me)?;
    Some(Debriefing {
        server_battle_id: debriefing.server_battle_id,
        // Upstream defaults this to "Unrated" rather than leaving it out, so an
        // absent one is a server that has stopped sending it rather than a game
        // that counted toward something.
        rating_category: debriefing
            .rating_category
            .clone()
            .unwrap_or_else(|| "Unrated".to_string()),
        won: mine.is_in_victory_team,
        elo_change: points(mine.elo_change),
        new_elo: points(mine.new_elo),
        // Three bits wide, the same range as the rank on a user record, and
        // clamped for the same reason.
        new_rank: u8::try_from(mine.new_rank.clamp(0, 7)).unwrap_or_default(),
        rank_up: mine.is_rankup,
        rank_down: mine.is_rankdown,
        prev_rank_elo: points(mine.prev_rank_elo),
        next_rank_elo: points(mine.next_rank_elo),
        xp_change: mine.xp_change,
        new_xp: mine.new_xp,
        chat_channel: named(debriefing.chat_channel.as_deref()),
        url: named(debriefing.url.as_deref()),
        message: named(debriefing.message.as_deref()),
    })
}

/// A rating as the whole points a lobby shows. See [`Debriefing`].
fn points(value: f32) -> i32 {
    value.round() as i32
}

/// A string the server actually said, rather than an empty one.
fn named(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

#[cfg(test)]
mod tests {
    use super::*;
    use coilbox_zerok_protocol::line;

    /// Fold a wire line into the state the way the connection does.
    fn feed(state: &LobbyState, raw: &str) -> Vec<Delta> {
        let message = line::parse_line(raw).expect("the line parses");
        reduce(state, &message)
    }

    /// A state belonging to somebody who has logged in.
    fn signed_in_as(name: &str) -> LobbyState {
        let mut state = LobbyState::new();
        state.my_username = Some(name.to_string());
        state
    }

    /// One debriefing as the server sends one, with our row and somebody else's
    /// in it.
    ///
    /// Written over several lines because the body is JSON and JSON does not
    /// mind where its whitespace falls. The command name and the first space are
    /// all the framing reads.
    const DEBRIEFING: &str = r#"BattleDebriefing {
        "ServerBattleID": 1580342,
        "RatingCategory": "MatchMaking",
        "ChatChannel": "debriefing_1580342",
        "Url": "https://zero-k.info/Battles/Detail/1580342",
        "Message": "Match over",
        "DebriefingUsers": {
            "someone": {
                "AccountID": 4271, "AllyNumber": 0,
                "EloChange": 12.4, "NewElo": 1662.3,
                "NewRank": 4, "IsRankup": true, "IsRankdown": false,
                "NextRankElo": 1800.0, "PrevRankElo": 1600.0,
                "XpChange": 230, "NewXp": 41230,
                "IsInVictoryTeam": true
            },
            "another": {
                "AccountID": 9, "EloChange": -12.4, "NewElo": 1500.0,
                "IsInVictoryTeam": false
            }
        }
    }"#;

    #[test]
    fn a_debriefing_says_what_the_match_did_to_our_rating() {
        let deltas = feed(&signed_in_as("someone"), DEBRIEFING);

        let [Delta::Debriefed { debriefing }] = deltas.as_slice() else {
            panic!("expected one debriefing: {deltas:?}");
        };
        assert!(debriefing.won);
        // Whole points, rounded rather than truncated, which is what puts 12.4
        // at 12 and 1662.3 at 1662.
        assert_eq!(debriefing.elo_change, 12);
        assert_eq!(debriefing.new_elo, 1662);
        assert_eq!(debriefing.new_rank, 4);
        assert!(debriefing.rank_up);
        assert!(!debriefing.rank_down);
        assert_eq!(debriefing.prev_rank_elo, 1600);
        assert_eq!(debriefing.next_rank_elo, 1800);
        assert_eq!(debriefing.xp_change, 230);
        assert_eq!(debriefing.new_xp, 41230);
        // Which of Zero-K's ratings moved, in the server's own words. A client
        // that showed one number without saying which would be showing the
        // casual rating half the time and the matchmaking one the rest.
        assert_eq!(debriefing.rating_category, "MatchMaking");
        assert_eq!(debriefing.server_battle_id, 1580342);
        assert_eq!(
            debriefing.chat_channel.as_deref(),
            Some("debriefing_1580342")
        );
        assert_eq!(
            debriefing.url.as_deref(),
            Some("https://zero-k.info/Battles/Detail/1580342")
        );
        assert_eq!(debriefing.message.as_deref(), Some("Match over"));
    }

    /// The row is ours and nobody else's. The other player in that message lost
    /// 12 points, and reading their row would have said we did.
    #[test]
    fn it_reads_our_own_row_rather_than_the_first_one() {
        let deltas = feed(&signed_in_as("another"), DEBRIEFING);

        let [Delta::Debriefed { debriefing }] = deltas.as_slice() else {
            panic!("expected one debriefing: {deltas:?}");
        };
        assert!(!debriefing.won);
        assert_eq!(debriefing.elo_change, -12);
    }

    /// A match somebody watched rather than played. There is nothing to tell
    /// them about their rating, because nothing happened to it.
    #[test]
    fn a_debriefing_with_no_row_of_ours_says_nothing() {
        assert_eq!(feed(&signed_in_as("watcher"), DEBRIEFING), vec![]);
    }

    /// Most Zero-K games are custom games, which count toward nothing. The
    /// category still has to arrive, because "Unrated" is the answer to what
    /// this changed rather than the absence of an answer.
    #[test]
    fn an_unrated_match_is_still_a_debriefing() {
        let raw = r#"BattleDebriefing {
            "ServerBattleID": 7,
            "DebriefingUsers": { "someone": { "IsInVictoryTeam": true } }
        }"#;
        let deltas = feed(&signed_in_as("someone"), raw);

        let [Delta::Debriefed { debriefing }] = deltas.as_slice() else {
            panic!("expected one debriefing: {deltas:?}");
        };
        assert_eq!(debriefing.rating_category, "Unrated");
        assert_eq!(debriefing.elo_change, 0);
        // Nothing invented out of the fields the server left out.
        assert_eq!(debriefing.chat_channel, None);
        assert_eq!(debriefing.url, None);
    }

    #[test]
    fn a_message_that_is_not_a_debriefing_produces_nothing() {
        let state = signed_in_as("someone");
        assert_eq!(feed(&state, r#"BattleRemoved {"BattleID":42}"#), vec![]);
    }
}
