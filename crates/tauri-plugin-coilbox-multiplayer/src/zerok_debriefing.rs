//! Reading Zero-K's `BattleDebriefing` into [`LobbyState::debriefing`], so a
//! player can see what the game they just played did to their rating (issue
//! #2003).
//!
//! Pure in the same way as [`crate::zerok_users`]: a message and a state go in,
//! the state is updated and the [`Delta`]s that moved come out.
//!
//! # Why there is nothing shared about this
//!
//! Zero-K is the only protocol coilbox speaks that reports a result at all.
//! TASServer has no such message and Tachyon's specification has none either, so
//! there is no second filler for this state and nothing to design around.
//!
//! # An unrated game arrives looking like a rated one
//!
//! The server builds the debriefing in two passes. `BattleResultHandler` fills
//! in who played, who won and what experience they earned, and sets every rating
//! member to a placeholder: `NewElo`, `NextRankElo` and `PrevRankElo` to -1, and
//! `EloChange` to 0. The rating system fills those in afterwards and names the
//! category it rated the game under. A game that counted toward no rating skips
//! that second pass entirely and goes out with the placeholders still in it and
//! the category still at its default of `Unrated`.
//!
//! So the category is what says whether there is a rating change to show, and
//! -1 is what says a rating itself is missing. Reading `EloChange` on its own
//! would put "+0" beside every player of an unrated game, which reads as a game
//! that was rated and changed nothing.

use coilbox_lobby_protocol::{Debriefing, DebriefingAward, DebriefingPlayer, Delta, LobbyState};
use coilbox_zerok_protocol::types;
use coilbox_zerok_protocol::ZerokMessage;

/// What the server calls the category of a game it rated nobody for.
const UNRATED: &str = "Unrated";

/// Apply a Zero-K message to the lobby state, returning the deltas produced.
///
/// Messages that carry no debriefing produce nothing, so the connection can hand
/// every line it receives to this.
pub(crate) fn reduce(state: &mut LobbyState, msg: &ZerokMessage) -> Vec<Delta> {
    let ZerokMessage::BattleDebriefing(report) = msg else {
        return vec![];
    };

    let category = named(report.rating_category.as_deref())
        .filter(|category| !category.eq_ignore_ascii_case(UNRATED));
    let message = named(report.message.as_deref());
    let mut players: Vec<DebriefingPlayer> = report
        .debriefing_users
        .iter()
        .flatten()
        .map(|(name, row)| player(name, row, category.is_some()))
        .collect();
    // A map has no order, so one is put on here. Side first, so the two teams
    // read as two teams rather than as one alphabetical list.
    players.sort_by(|a, b| (a.ally, &a.name).cmp(&(b.ally, &b.name)));

    // A debriefing with nobody in it and nothing to say has nothing to show. The
    // server always sends one or the other: a game it would not count still
    // carries the reason as a message.
    if players.is_empty() && message.is_none() {
        return vec![];
    }

    let battle_id = report.server_battle_id;
    state.debriefing = Some(Debriefing {
        battle_id,
        url: named(report.url.as_deref()),
        message,
        rating_category: category,
        chat_channel: named(report.chat_channel.as_deref()),
        players,
    });
    vec![Delta::DebriefingReceived { battle_id }]
}

/// One player's row, as the rest of the app reads it.
///
/// `rated` is whether the server named a rating category for the game, which is
/// what decides whether any of the rating members mean anything. See the module
/// docs.
fn player(name: &str, row: &types::DebriefingUser, rated: bool) -> DebriefingPlayer {
    DebriefingPlayer {
        name: name.to_owned(),
        ally: row.ally_number,
        won: row.is_in_victory_team,
        rating_change: rated.then(|| points(row.elo_change)),
        rating: rating(rated, row.new_elo),
        // Zero-K's ranks run 0 to 7 and `Ranks.ValidateRank` refuses anything
        // else, so a number outside that would draw an insignia the server does
        // not have.
        rank: row.new_rank.clamp(0, 7),
        ranked_up: row.is_rankup,
        ranked_down: row.is_rankdown,
        next_rank_rating: rating(rated, row.next_rank_elo),
        prev_rank_rating: rating(rated, row.prev_rank_elo),
        xp_change: row.xp_change,
        xp: row.new_xp,
        awards: awards(row.awards.as_ref()),
    }
}

/// One rating from an unrated game's placeholder, or from a real one.
///
/// Two ways to be missing and both have to be caught. The whole game can be
/// unrated, and one player's rating can fail to be worked out on a game that was
/// rated, which the server reports as the same -1 it uses for the first.
fn rating(rated: bool, value: f32) -> Option<i32> {
    (rated && value > 0.0).then(|| points(value))
}

/// A rating in whole points, which is what a lobby shows.
///
/// Upstream clips a ladder change to between 1 and 50 points either way
/// (`GlobalConst.LadderEloMinChange` and `LadderEloMaxChange`), so the fraction
/// it sends is smaller than anything worth reading.
fn points(value: f32) -> i32 {
    value.round() as i32
}

/// The awards on a row, as key and wording.
///
/// The member is untyped on the wire, because upstream declares it `object` and
/// assigns a list of awards to it. A shape that is not that list is one award
/// nobody sees rather than a debriefing nobody sees, so it comes back empty.
fn awards(value: Option<&serde_json::Value>) -> Vec<DebriefingAward> {
    let Some(list) = value.and_then(serde_json::Value::as_array) else {
        return vec![];
    };
    list.iter()
        .filter_map(|award| {
            let key = named(award.get("Key").and_then(serde_json::Value::as_str))?;
            Some(DebriefingAward {
                key,
                description: named(award.get("Description").and_then(serde_json::Value::as_str))
                    .unwrap_or_default(),
            })
        })
        .collect()
}

/// A string the server actually filled in, trimmed.
fn named(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_owned)
}

#[cfg(test)]
mod tests;
