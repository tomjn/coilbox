//! The lobby we are in, and how it reaches the battle room.
//!
//! Tachyon sends the whole lobby once, as the `lobby/join` response, and then
//! sends RFC 7386 merge patches as `lobby/updated` events. So this module holds
//! a [`types::LobbyDetails`] as the authoritative Tachyon-side lobby, applies
//! each patch to it with `coilbox_tachyon_protocol::merge_patch::apply`, and
//! projects the result into the [`Battle`] the battle room already reads.
//!
//! Pure, in the same way as [`crate::tachyon_users`] and
//! [`crate::tachyon_lobbies`]: a message and a state go in, the state is updated
//! and the [`Delta`]s that moved come out. The projection is a separate function
//! under it, so it can be tested without a frame at all.
//!
//! # Membership is the subscription
//!
//! There is no subscribe call for a lobby. Joining is what subscribes us, and
//! leaving is what ends it, so a `lobby/updated` only ever arrives for the lobby
//! we are in. A patch naming any other lobby is dropped.
//!
//! # Naming the people in the room
//!
//! A lobby names its members by user id. [`LobbyState::users`] is keyed by
//! username and holds only the people who are signed in, because #1226 drops
//! offline users, so a member the connection has never been told about cannot be
//! named from `users` alone.
//!
//! Two things together. On joining, the connection subscribes to the ids it
//! cannot name, which is what [`ids_to_subscribe`] works out, and Teiserver
//! answers a subscription with each user's record whether they are online or
//! not. Until those answers arrive, and for anyone they do not cover, the member
//! is filed under their user id rather than left out of the roster. The
//! projection is a function of the lobby and of `users`, so re-running it when a
//! name arrives moves the member from their id to their name.
//!
//! # What has no home in `Battle`
//!
//! `Battle` came from the TASServer protocol and Tachyon's lobby is richer, so
//! these are read and not projected rather than being invented a field:
//!
//! - the founder. Tachyon has no host or founder, so `Battle::host` stays empty
//!   and the room reads as nobody's.
//! - team colours. Tachyon assigns them when the match starts, so `team_color`
//!   stays 0 rather than carrying a guess the engine would then contradict.
//! - `currentBattle`, the match in progress. Launching is #1233.
//! - `currentVote` and `voteHistory`. Votes are #1231.
//! - `bosses` and `areBossesEnabled`, `joinQueuePosition` on a spectator, the
//!   `player` slot on a player and a bot, and a bot's `version` and `options`.
//! - `gameOptions`. `Battle::script_tags` is the engine's start-script key space
//!   and nothing says Tachyon's option keys are the same one, so mapping them
//!   would put unverified keys in front of the options editor. Editing options
//!   is #1230.

use std::collections::HashMap;

use coilbox_lobby_protocol::{BattleStatus, Bot, Delta, LobbyState, MemberStatus, StartRect, User};
use coilbox_tachyon_protocol::merge_patch;
use coilbox_tachyon_protocol::types::{self, LobbyDetails, LobbyJoinResponse};
use coilbox_tachyon_protocol::TachyonMessage;

use crate::tachyon_lobbies::handle_for;
use crate::tachyon_users::SUBSCRIBE_LIMIT;

/// The start rect space `Battle::start_rects` is in. Tachyon's start box is in
/// fractions of the map, so the two differ by this factor.
const START_RECT_SCALE: f64 = 200.0;

/// The lobby we are in.
pub(crate) struct Room {
    /// The authoritative Tachyon-side lobby, patched in place.
    details: LobbyDetails,
    /// Whether we have asked to leave. A `lobby/left` that follows our own
    /// request is not us being thrown out, so it says nothing to the user.
    leaving: bool,
}

/// Apply a Tachyon message to the room, returning the deltas produced.
///
/// Every message ends in a projection, whether it touched the room or not,
/// because the projection reads `users` as well as the lobby and a `user/updated`
/// is what turns a member's id into their name.
pub(crate) fn reduce(
    room: &mut Option<Room>,
    state: &mut LobbyState,
    msg: &TachyonMessage,
) -> Vec<Delta> {
    let mut deltas = match msg {
        TachyonMessage::LobbyJoinResponse(LobbyJoinResponse::Success { data, .. }) => {
            joined(room, state, data)
        }
        TachyonMessage::LobbyUpdatedEvent(event) => {
            // A patch naming any other lobby is dropped. Membership is the
            // subscription, so one should never arrive, and applying it to the
            // lobby we are in would be worse than losing it.
            let held = room
                .as_mut()
                .filter(|held| held.details.id == event.data.id);
            if let Some(held) = held {
                merge_patch::apply(&mut held.details, &event.data);
            }
            vec![]
        }
        TachyonMessage::LobbyLeftEvent(event) => left_event(room, state, &event.data),
        _ => vec![],
    };
    // The projection goes first, so a delta the frontend acts on, such as
    // entering the room, arrives once the room is there to be read.
    let mut projected = project(room.as_ref(), state);
    projected.append(&mut deltas);
    projected
}

/// Note that we have asked to leave, so the `lobby/left` that may follow reads
/// as our own doing.
pub(crate) fn mark_leaving(room: &mut Option<Room>, leaving: bool) {
    if let Some(room) = room {
        room.leaving = leaving;
    }
}

/// Take us out of the room, which is what our own `lobby/leave` succeeding does.
pub(crate) fn left(room: &mut Option<Room>, state: &mut LobbyState) -> Vec<Delta> {
    let Some(room) = room.take() else {
        return vec![];
    };
    let handle = handle_for(&room.details.id, &state.battles);
    state.current_battle = None;
    state.my_intended_battle_status = None;
    state.current_vote = None;

    // The lobby is still listed, so only the parts the room filled in go. The
    // list keeps it up to date from here.
    let Some(battle) = state.battles.get_mut(&handle) else {
        return vec![];
    };
    battle.members.clear();
    battle.bots.clear();
    battle.start_rects.clear();
    vec![Delta::BattleInfoChanged { id: handle }]
}

/// The user ids in the room that `users` cannot name, in a stable order.
///
/// Subscribing to these is what turns them into names. The cap is the schema's,
/// and the server's is a total across the connection rather than a per-request
/// one, so a long friends list and a full lobby together can still be refused. A
/// refusal costs names rather than the connection: the members it covered stay
/// filed under their ids.
pub(crate) fn ids_to_subscribe(state: &LobbyState, room: &Option<Room>) -> Vec<String> {
    let Some(room) = room else {
        return vec![];
    };
    let mut wanted: Vec<String> = Vec::new();
    for id in member_ids(&room.details) {
        let known = state.users.values().any(|user| user.user_id == id);
        if !known && !wanted.contains(&id) {
            wanted.push(id);
        }
        if wanted.len() == SUBSCRIBE_LIMIT {
            break;
        }
    }
    wanted
}

/// Every user id the lobby names, in a stable order.
fn member_ids(details: &LobbyDetails) -> Vec<String> {
    let players = sorted(&details.players)
        .into_iter()
        .map(|(_, player)| player.id.to_string());
    let spectators = sorted(&details.spectators)
        .into_iter()
        .map(|(_, spectator)| spectator.id.to_string());
    let bots = sorted(&details.bots)
        .into_iter()
        .map(|(_, bot)| bot.host_user_id.to_string());
    let bosses = sorted(&details.bosses)
        .into_iter()
        .map(|(key, _)| key.to_string());
    players
        .chain(spectators)
        .chain(bots)
        .chain(bosses)
        .collect()
}

/// The `lobby/join` response, which carries the whole lobby.
fn joined(room: &mut Option<Room>, state: &mut LobbyState, details: &LobbyDetails) -> Vec<Delta> {
    let handle = handle_for(&details.id, &state.battles);
    *room = Some(Room {
        details: details.clone(),
        leaving: false,
    });
    state.current_battle = Some(handle);
    state.last_battle = Some(handle);
    state.current_vote = None;
    vec![Delta::EnteredBattle {
        id: handle,
        own: false,
    }]
}

/// The `lobby/left` event, which is the server taking us out.
fn left_event(
    room: &mut Option<Room>,
    state: &mut LobbyState,
    event: &types::LobbyLeftEventData,
) -> Vec<Delta> {
    if room.as_ref().is_none_or(|held| held.details.id != event.id) {
        return vec![];
    }
    // Whether this is news depends on whether we asked, so read it before the
    // room goes.
    let told_us = room.as_ref().is_some_and(|held| !held.leaving);
    let mut deltas = left(room, state);
    if told_us {
        deltas.push(Delta::ServerMessage {
            text: format!("You are out of the lobby: {}", event.reason),
            boxed: false,
        });
    }
    deltas
}

/// Fold the lobby we hold into the battle the room reads, reporting whether
/// anything moved.
fn project(room: Option<&Room>, state: &mut LobbyState) -> Vec<Delta> {
    let Some(room) = room else {
        return vec![];
    };
    let details = &room.details;
    let handle = handle_for(&details.id, &state.battles);
    let held = state.battles.remove(&handle);
    let known = held.is_some();

    let names = names_by_id(&state.users);
    let mut battle = held.unwrap_or_default();
    let before = battle.clone();
    battle.id = handle;
    battle.tachyon_id = Some(details.id.clone());
    battle.title = details.name.clone();
    battle.map = details.map_name.clone();
    battle.version = details.engine_version.clone();
    battle.modname = details.game_version.clone();
    battle.player_count = Some(count(details.players.len()));
    battle.spectator_count = count(details.spectators.len());
    battle.members = members(details, &names);
    battle.bots = bots(details, &names);
    battle.start_rects = start_rects(details);
    let changed = battle != before;
    state.battles.insert(handle, battle);

    match (known, changed) {
        (false, _) => vec![Delta::BattleOpened { id: handle }],
        (true, true) => vec![Delta::BattleInfoChanged { id: handle }],
        (true, false) => vec![],
    }
}

/// The players and the spectators, under the names the roster shows.
fn members(details: &LobbyDetails, names: &HashMap<&str, &str>) -> HashMap<String, MemberStatus> {
    let allies = ally_indices(details);
    let teams = team_indices(details);
    let mut members = HashMap::new();

    for (_, player) in sorted(&details.players) {
        let status = BattleStatus {
            ready: player.is_ready,
            team_id: team_of(&teams, &player.ally_team, &player.team),
            ally: ally_of(&allies, &player.ally_team),
            mode: true,
            handicap: 0,
            sync: sync_of(player.asset_status),
            side: 0,
        };
        members.insert(
            name_of(&player.id, names),
            MemberStatus {
                battle_status: status,
                team_color: 0,
                script_password: None,
            },
        );
    }
    for (_, spectator) in sorted(&details.spectators) {
        // The default battle status is a spectator with nothing chosen, which is
        // all Tachyon says about one.
        members.insert(name_of(&spectator.id, names), MemberStatus::default());
    }
    members
}

/// The bots, keyed the way the roster reads them: by the name it shows.
fn bots(details: &LobbyDetails, names: &HashMap<&str, &str>) -> HashMap<String, Bot> {
    let allies = ally_indices(details);
    let teams = team_indices(details);
    let mut bots: HashMap<String, Bot> = HashMap::new();

    for (_, bot) in sorted(&details.bots) {
        let shown = bot
            .name
            .as_ref()
            .map_or_else(|| bot.short_name.to_string(), |name| name.to_string());
        // Tachyon lets two bots share a display name and the roster is keyed by
        // it, so the second one falls back to the id the server assigned it
        // rather than replacing the first.
        let key = if bots.contains_key(&shown) {
            bot.id.clone()
        } else {
            shown
        };
        bots.insert(
            key.clone(),
            Bot {
                name: key,
                owner: name_of(&bot.host_user_id, names),
                ai_dll: bot.short_name.to_string(),
                battle_status: BattleStatus {
                    ready: true,
                    team_id: team_of(&teams, &bot.ally_team, &bot.team),
                    ally: ally_of(&allies, &bot.ally_team),
                    mode: true,
                    handicap: 0,
                    sync: 1,
                    side: 0,
                },
                team_color: 0,
            },
        );
    }
    bots
}

/// The per-ally start boxes, in the 0 to 200 space `Battle` uses.
fn start_rects(details: &LobbyDetails) -> HashMap<u8, StartRect> {
    sorted(&details.ally_team_config)
        .into_iter()
        .enumerate()
        .map(|(index, (_, ally))| {
            (
                index_of(index),
                StartRect {
                    left: scale(ally.start_box.left),
                    top: scale(ally.start_box.top),
                    right: scale(ally.start_box.right),
                    bottom: scale(ally.start_box.bottom),
                },
            )
        })
        .collect()
}

/// Which ally team a member is on, as the index the roster groups by.
///
/// Tachyon keys an ally team by an ordering string rather than by a number, so
/// the index is the key's place in the sorted list. A member naming an ally the
/// lobby does not have falls to the first one.
fn ally_indices(details: &LobbyDetails) -> HashMap<&str, u8> {
    sorted(&details.ally_team_config)
        .into_iter()
        .enumerate()
        .map(|(index, (key, _))| (key, index_of(index)))
        .collect()
}

/// Which engine team a member is on, numbered across the whole lobby.
///
/// A team key is only unique inside its ally team, and `BattleStatus::team_id`
/// is one number for the whole battle, so the pair is what is numbered.
fn team_indices(details: &LobbyDetails) -> HashMap<(&str, &str), u8> {
    let mut indices = HashMap::new();
    let mut next = 0;
    for (ally_key, ally) in sorted(&details.ally_team_config) {
        for (team_key, _) in sorted(&ally.teams) {
            indices.insert((ally_key, team_key), index_of(next));
            next += 1;
        }
    }
    indices
}

fn ally_of(allies: &HashMap<&str, u8>, ally_team: &str) -> u8 {
    allies.get(ally_team).copied().unwrap_or_default()
}

fn team_of(teams: &HashMap<(&str, &str), u8>, ally_team: &str, team: &str) -> u8 {
    teams.get(&(ally_team, team)).copied().unwrap_or_default()
}

/// A keyed collection of the lobby, in key order, so the projection is the same
/// every time rather than depending on how the map happened to be walked.
fn sorted<K, V>(collection: &HashMap<K, V>) -> Vec<(&str, &V)>
where
    K: std::ops::Deref<Target = String>,
{
    let mut entries: Vec<(&str, &V)> = collection
        .iter()
        .map(|(key, value)| (key.as_str(), value))
        .collect();
    entries.sort_by_key(|(key, _)| *key);
    entries
}

/// The name to show for a user id, falling back to the id itself for someone
/// `users` cannot name yet.
fn name_of(id: &types::UserId, names: &HashMap<&str, &str>) -> String {
    names
        .get(id.as_str())
        .map_or_else(|| id.to_string(), |name| (*name).to_string())
}

/// A user id to username index, because a lobby names people by id and
/// [`LobbyState::users`] is keyed by name.
fn names_by_id(users: &HashMap<String, User>) -> HashMap<&str, &str> {
    users
        .values()
        .map(|user| (user.user_id.as_str(), user.name.as_str()))
        .collect()
}

/// What the engine's sync field makes of a player's assets. 1 is synced and 2 is
/// not, so anything short of having the content counts as unsynced.
fn sync_of(status: types::LobbyDetailsPlayersValueAssetStatus) -> u8 {
    match status {
        types::LobbyDetailsPlayersValueAssetStatus::Complete => 1,
        types::LobbyDetailsPlayersValueAssetStatus::Missing
        | types::LobbyDetailsPlayersValueAssetStatus::Downloading => 2,
    }
}

/// A start box edge, from a fraction of the map to the 0 to 200 space.
fn scale(edge: f64) -> i32 {
    let scaled = (edge * START_RECT_SCALE).round();
    scaled.clamp(0.0, START_RECT_SCALE) as i32
}

/// A count off the wire. More members than a `u32` can hold is not a lobby.
fn count(value: usize) -> u32 {
    u32::try_from(value).unwrap_or(u32::MAX)
}

/// An ally or team index. Both are four bits on the wire, so a lobby with more
/// than sixteen of either has nowhere to put the rest and they land on the last.
fn index_of(index: usize) -> u8 {
    u8::try_from(index).unwrap_or(u8::MAX).min(15)
}

#[cfg(test)]
mod tests;
