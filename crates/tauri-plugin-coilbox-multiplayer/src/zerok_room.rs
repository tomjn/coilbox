//! The Zero-K battle room: the roster, the AIs, the options and the poll.
//!
//! The Zero-K counterpart of [`crate::tachyon_room`], and pure in the same way:
//! a message and a state go in, the state is updated and what comes out is the
//! [`Delta`]s that moved plus anything the room has to say back.
//!
//! # Joining is two steps, and the order is not optional
//!
//! `JoinBattle` goes out, and nothing about your presence can be set until
//! `JoinBattleSuccess` comes back. A status update sent before that point is
//! dropped, because the server looks you up in the room's roster first and you
//! are not in it yet. So joining as a spectator is joining, waiting, and then
//! saying so, which is why [`reduce`] answers a join with a status of its own
//! rather than the command that sent the join doing it.
//!
//! # The sync flag is not optional either
//!
//! `UpdateUserBattleStatus::Sync` is nullable in the generated types because it
//! is nullable in the C#, and that is the whole of why it looks optional. A
//! client that never sends it stays `Unknown` for the life of the room, and
//! `CmdStart` gathers everyone who is not `Synced`, announces them as still
//! downloading the map and delays the start by ten seconds. Every status this
//! module sends carries it.
//!
//! `Name` is the same trap one field along. The server indexes the roster by it
//! before it does anything else, so a status sent without one arrives as a null
//! key and throws inside the server rather than reporting an unknown state.
//!
//! # Leaving has no message of its own
//!
//! `LeaveBattle` carries a battle id and is only ever about yourself. Somebody
//! else leaving arrives as their `User` record with `BattleID` cleared, which
//! [`crate::zerok_users`] acts on.
//!
//! # What is parsed and not kept
//!
//! A `BattlePoll` that is not a yes or no vote has nowhere to go.
//! [`coilbox_lobby_protocol::Vote`] counts two answers, and a Zero-K map poll
//! offers a list of maps, so one would have to be squeezed into the other and
//! read wrong. It is parsed and left, which is what the `lobby-protocol-gap`
//! label tracks.

use std::collections::BTreeMap;

use coilbox_lobby_protocol::{
    default_battle_status, Battle, BattleStatus, Bot, Delta, LobbyState, MemberStatus, Vote,
};
use coilbox_zerok_protocol::types::{self, SayPlace, SyncStatuses};
use coilbox_zerok_protocol::ZerokMessage;

use crate::tachyon_room::VoteChoice;

/// The prefixes a battle's script tags file mod and map options under, which is
/// where the room's options panel and the launch config both read them from.
const MOD_OPTIONS: &str = "game/modoptions/";
const MAP_OPTIONS: &str = "game/mapoptions/";

/// Something a room control asks of a Zero-K connection.
///
/// Turned into a wire line by [`build`], which needs the state as well as the
/// action: Zero-K names you and the room you are in on messages the other two
/// protocols leave that to the connection for.
pub(crate) enum RoomAction {
    /// Ask to be put in a battle. The roster arrives as `JoinBattleSuccess`.
    Join {
        battle: u32,
        password: Option<String>,
    },
    /// Leave the room we are in.
    Leave,
    /// Our own seat, as the room's controls set it.
    OwnStatus(BattleStatus),
    /// Seat an AI, or move one that is already there.
    Bot {
        name: String,
        ally: u8,
        ai: String,
    },
    /// Take an AI out.
    RemoveBot {
        name: String,
    },
    /// Replace the room's game options, or its map options.
    ///
    /// The whole dictionary rather than a patch: upstream's `SetModOptions`
    /// assigns what it is handed, so a key left out is a key removed.
    ModOptions(BTreeMap<String, String>),
    MapOptions(BTreeMap<String, String>),
    /// Put somebody out of the room.
    Kick {
        username: String,
    },
    /// One line of battle chat. The room's own commands go this way: Zero-K has
    /// no message for starting a match or for voting, and its autohost reads
    /// both out of chat.
    Say {
        text: String,
    },
}

/// What [`reduce`] produced: the state changes to tell the frontend about, and
/// the commands the room has to send in answer.
pub(crate) type Reduced = (Vec<Delta>, Vec<RoomAction>);

/// Apply a Zero-K message to the lobby state.
///
/// Messages that are not about the room we are in produce nothing, so the
/// connection can hand every line it receives to this.
pub(crate) fn reduce(state: &mut LobbyState, msg: &ZerokMessage) -> Reduced {
    match msg {
        ZerokMessage::JoinBattleSuccess(joined) => joined_battle(state, joined),
        ZerokMessage::UpdateUserBattleStatus(status) => (seat(state, status), vec![]),
        ZerokMessage::UpdateBotStatus(status) => (seat_bot(state, status), vec![]),
        ZerokMessage::RemoveBot(bot) => (remove_bot(state, bot.name.as_deref()), vec![]),
        ZerokMessage::SetModOptions(options) => (
            set_options(state, MOD_OPTIONS, options.options.as_ref()),
            vec![],
        ),
        ZerokMessage::SetMapOptions(options) => (
            set_options(state, MAP_OPTIONS, options.options.as_ref()),
            vec![],
        ),
        ZerokMessage::BattlePoll(poll) => (put_poll(state, poll), vec![]),
        // A poll that has ended. The outcome carries what won and a line to show
        // for it, and the panel is for a vote that is open, so it closes.
        ZerokMessage::BattlePollOutcome(outcome) => (
            clear_poll(state)
                .into_iter()
                .chain(outcome.message.as_deref().map(|text| Delta::ServerMessage {
                    text: text.to_owned(),
                    boxed: false,
                }))
                .collect(),
            vec![],
        ),
        // Broadcast to the whole room, so it has to be checked that it is us.
        ZerokMessage::KickFromBattle(kick) => {
            if aimed_at_us(state, kick.name.as_deref()) {
                (leave(state), vec![])
            } else {
                (vec![], vec![])
            }
        }
        // The server moving us: a match forming, a moderator, or a command from
        // the website. There is nothing to confirm, so we go.
        ZerokMessage::ForceJoinBattle(force) => {
            if !aimed_at_us(state, force.name.as_deref()) {
                return (vec![], vec![]);
            }
            let Ok(battle) = u32::try_from(force.battle_id) else {
                return (vec![], vec![]);
            };
            (
                vec![],
                vec![RoomAction::Join {
                    battle,
                    password: None,
                }],
            )
        }
        _ => (vec![], vec![]),
    }
}

/// The server has put us in a room. `JoinBattleSuccess` is a whole snapshot, so
/// it replaces what we hold rather than merging into it.
fn joined_battle(state: &mut LobbyState, joined: &types::JoinBattleSuccess) -> Reduced {
    let Ok(id) = u32::try_from(joined.battle_id) else {
        return (vec![], vec![]);
    };

    // We may be moved straight from one room to another, and what we told the
    // last one is not true of this one.
    let mut deltas = leave(state);

    let battle = state.battles.entry(id).or_insert_with(|| Battle {
        id,
        ..Default::default()
    });
    battle.members.clear();
    battle.bots.clear();
    battle.script_tags.clear();
    for player in joined.players.iter().flatten() {
        if let Some(name) = named(player.name.as_deref()) {
            battle.members.insert(name, member_from(player));
        }
    }
    for bot in joined.bots.iter().flatten() {
        if let Some(name) = named(bot.name.as_deref()) {
            battle.bots.insert(name.clone(), bot_from(&name, bot));
        }
    }
    fill_options(battle, MOD_OPTIONS, joined.options.as_ref());
    fill_options(battle, MAP_OPTIONS, joined.map_options.as_ref());

    state.current_battle = Some(id);
    state.current_vote = None;
    deltas.push(Delta::EnteredBattle {
        id,
        // Zero-K hosts every battle on its own server, so a client never opens
        // one and this is never our own room.
        own: false,
    });

    // The seat the room's controls last asked for, or the protocol default.
    // Sent unprompted, because Zero-K has no `REQUESTBATTLESTATUS` to answer and
    // a room that hears nothing holds us at an unknown sync forever.
    let status = state
        .my_intended_battle_status
        .map_or_else(default_battle_status, |(status, _)| status);
    (deltas, vec![RoomAction::OwnStatus(status)])
}

/// Fold a status update into the roster of the room we are in.
///
/// A patch, not a record: a field the update leaves out is a field that did not
/// change.
fn seat(state: &mut LobbyState, update: &types::UpdateUserBattleStatus) -> Vec<Delta> {
    let (Some(id), Some(name)) = (state.current_battle, named(update.name.as_deref())) else {
        // Outside a room these are the tail of one we have already left.
        return vec![];
    };
    let Some(battle) = state.battles.get_mut(&id) else {
        return vec![];
    };

    let held = battle.members.get(&name).cloned();
    let mut member = held.clone().unwrap_or_else(|| MemberStatus {
        battle_status: default_battle_status(),
        ..Default::default()
    });
    apply_status(&mut member.battle_status, update);
    battle.members.insert(name.clone(), member.clone());

    match held {
        None => vec![Delta::MemberJoined {
            battle_id: id,
            name,
        }],
        Some(held) if held != member => vec![Delta::MemberStatusChanged {
            battle_id: id,
            name,
        }],
        Some(_) => vec![],
    }
}

/// Fold a bot update into the room. Also a patch, and also keyed by name.
fn seat_bot(state: &mut LobbyState, update: &types::UpdateBotStatus) -> Vec<Delta> {
    let (Some(id), Some(name)) = (state.current_battle, named(update.name.as_deref())) else {
        return vec![];
    };
    let Some(battle) = state.battles.get_mut(&id) else {
        return vec![];
    };

    let held = battle.bots.get(&name).cloned();
    let mut bot = held.clone().unwrap_or_else(|| bot_from(&name, update));
    if let Some(owner) = &update.owner {
        bot.owner.clone_from(owner);
    }
    if let Some(ai) = &update.ai_lib {
        bot.ai_dll.clone_from(ai);
    }
    if let Some(ally) = update.ally_number {
        bot.battle_status.ally = ally_of(ally);
    }
    battle.bots.insert(name.clone(), bot.clone());

    if held.as_ref() == Some(&bot) {
        vec![]
    } else {
        vec![Delta::BotChanged {
            battle_id: id,
            name,
        }]
    }
}

fn remove_bot(state: &mut LobbyState, name: Option<&str>) -> Vec<Delta> {
    let (Some(id), Some(name)) = (state.current_battle, named(name)) else {
        return vec![];
    };
    let gone = state
        .battles
        .get_mut(&id)
        .is_some_and(|battle| battle.bots.remove(&name).is_some());
    if gone {
        vec![Delta::BotRemoved {
            battle_id: id,
            name,
        }]
    } else {
        vec![]
    }
}

/// Replace one namespace of the room's script tags.
///
/// Upstream assigns the whole dictionary, so everything under the prefix goes
/// and what arrived takes its place. The other namespaces are untouched: Zero-K
/// never sends a start-position type or a unit restriction, and clearing those
/// would empty a launch config the room had already built.
fn set_options(
    state: &mut LobbyState,
    prefix: &str,
    options: Option<&BTreeMap<String, String>>,
) -> Vec<Delta> {
    let Some(id) = state.current_battle else {
        return vec![];
    };
    let Some(battle) = state.battles.get_mut(&id) else {
        return vec![];
    };

    let before = battle.script_tags.clone();
    battle.script_tags.retain(|key, _| !key.starts_with(prefix));
    fill_options(battle, prefix, options);
    if battle.script_tags == before {
        vec![]
    } else {
        vec![Delta::ScriptTagsChanged]
    }
}

/// Put a dictionary of options into a battle's script tags under `prefix`.
///
/// Lowercased, because the engine reads a script tag path case-insensitively and
/// everything that reads these back matches on the lower-case form.
fn fill_options(battle: &mut Battle, prefix: &str, options: Option<&BTreeMap<String, String>>) {
    for (key, value) in options.into_iter().flatten() {
        battle
            .script_tags
            .insert(format!("{prefix}{}", key.to_lowercase()), value.clone());
    }
}

/// A Zero-K poll as the vote panel reads it, when it is one the panel can show.
///
/// A poll with no topic is the server saying there is no poll, which is how one
/// that was cancelled arrives.
fn put_poll(state: &mut LobbyState, poll: &types::BattlePoll) -> Vec<Delta> {
    let Some(topic) = named(poll.topic.as_deref()) else {
        return clear_poll(state);
    };
    if !poll.yes_no_vote {
        // A map poll offers a list rather than two answers. Showing it as a
        // yes or no would ask the wrong question.
        return clear_poll(state);
    }

    let (yes, no) = yes_and_no(poll);
    // Both sides need the same number of votes: `VotesToWin` is what any single
    // option needs to win outright, and there are only two of them.
    let needed = u32::try_from(poll.votes_to_win).unwrap_or_default();
    let vote = Vote {
        subject: topic,
        // Zero-K's poll does not say who called it.
        caller: String::new(),
        yes,
        no,
        yes_needed: needed,
        no_needed: needed,
        // A Zero-K yes or no poll has two answers and no third one.
        allow_abstain: false,
        // And no deadline on the wire, which the field documents as 0.
        ends_at: 0,
    };

    if state.current_vote.as_ref() == Some(&vote) {
        vec![]
    } else {
        state.current_vote = Some(vote);
        vec![Delta::VoteChanged]
    }
}

/// The votes cast for each answer.
///
/// Matched by name rather than by position, because nothing says which order the
/// two arrive in. A poll whose answers are named something else falls back to
/// the order it listed them, which is the only other thing there is to go on.
fn yes_and_no(poll: &types::BattlePoll) -> (u32, u32) {
    let options: Vec<&types::PollOption> = poll.options.iter().flatten().collect();
    let named_yes = options.iter().find(|option| {
        option
            .name
            .as_deref()
            .is_some_and(|n| n.eq_ignore_ascii_case("yes"))
    });
    let named_no = options.iter().find(|option| {
        option
            .name
            .as_deref()
            .is_some_and(|n| n.eq_ignore_ascii_case("no"))
    });

    let votes = |option: Option<&&types::PollOption>| {
        option.map_or(0, |option| u32::try_from(option.votes).unwrap_or_default())
    };
    match (named_yes, named_no) {
        (None, None) => (votes(options.first()), votes(options.get(1))),
        (yes, no) => (votes(yes), votes(no)),
    }
}

fn clear_poll(state: &mut LobbyState) -> Vec<Delta> {
    if state.current_vote.take().is_some() {
        vec![Delta::VoteChanged]
    } else {
        vec![]
    }
}

/// Take ourselves out of the room we are in.
fn leave(state: &mut LobbyState) -> Vec<Delta> {
    let Some(id) = state.current_battle.take() else {
        return vec![];
    };
    state.last_battle = Some(id);
    state.current_vote = None;
    let name = state.my_username.clone().unwrap_or_default();
    if let Some(battle) = state.battles.get_mut(&id) {
        battle.members.remove(&name);
    }
    vec![Delta::MemberLeft {
        battle_id: id,
        name,
    }]
}

/// Whether a message naming somebody is naming us. A message that names nobody
/// is about the room as a whole, so it counts.
fn aimed_at_us(state: &LobbyState, name: Option<&str>) -> bool {
    match (name, state.my_username.as_deref()) {
        (None, _) => true,
        (Some(name), Some(me)) => name == me,
        (Some(_), None) => false,
    }
}

/// A name worth filing something under, which is one that is there and not
/// empty.
fn named(name: Option<&str>) -> Option<String> {
    name.map(str::trim)
        .filter(|name| !name.is_empty())
        .map(str::to_owned)
}

/// Apply the three seat fields Zero-K carries, leaving the rest alone.
///
/// Colour, faction, team number, handicap and readiness have no Zero-K
/// equivalent: the server assigns colours and teams when the match starts, and
/// there is nothing on the wire to carry the others. The room hides those
/// controls on this protocol.
fn apply_status(status: &mut BattleStatus, update: &types::UpdateUserBattleStatus) {
    if let Some(ally) = update.ally_number {
        status.ally = ally_of(ally);
    }
    if let Some(spectator) = update.is_spectator {
        // `mode` is true for a player, which is the opposite way round.
        status.mode = !spectator;
    }
    if let Some(sync) = update.sync {
        status.sync = sync_of(sync);
    }
}

fn member_from(player: &types::UpdateUserBattleStatus) -> MemberStatus {
    let mut status = default_battle_status();
    apply_status(&mut status, player);
    MemberStatus {
        battle_status: status,
        team_color: 0,
        script_password: None,
    }
}

fn bot_from(name: &str, update: &types::UpdateBotStatus) -> Bot {
    Bot {
        name: name.to_owned(),
        owner: update.owner.clone().unwrap_or_default(),
        ai_dll: update.ai_lib.clone().unwrap_or_default(),
        battle_status: BattleStatus {
            // A bot is never a spectator.
            mode: true,
            ally: update.ally_number.map(ally_of).unwrap_or_default(),
            ..default_battle_status()
        },
        team_color: 0,
    }
}

/// An ally team number off the wire. The field is four bits wide where it is
/// stored, and a room with sixteen ally teams is already at the engine's limit.
fn ally_of(ally: i32) -> u8 {
    u8::try_from(ally.clamp(0, 15)).unwrap_or_default()
}

/// Zero-K's sync value as the two bits the rest of the app stores it in. The
/// numbers agree: 0 unknown, 1 synced, 2 unsynced.
fn sync_of(sync: SyncStatuses) -> u8 {
    u8::try_from(i32::from(sync).clamp(0, 3)).unwrap_or_default()
}

/// The wire lines for one room action, in the order they go out.
///
/// Empty when there is nothing to send, which is how an action against a room we
/// are not in is refused: the state is what says whether we are.
pub(crate) fn build(
    state: &LobbyState,
    action: &RoomAction,
) -> Result<Vec<String>, serde_json::Error> {
    let battle_id = state.current_battle.and_then(|id| i32::try_from(id).ok());
    Ok(match action {
        RoomAction::Join { battle, password } => {
            let Ok(battle_id) = i32::try_from(*battle) else {
                return Ok(vec![]);
            };
            vec![line(&types::JoinBattle {
                battle_id,
                password: password.clone().filter(|key| !key.is_empty()),
            })?]
        }
        RoomAction::Leave => match battle_id {
            Some(battle_id) => vec![line(&types::LeaveBattle {
                battle_id: Some(battle_id),
            })?],
            None => vec![],
        },
        RoomAction::OwnStatus(status) => match own_status(state, *status) {
            Some(update) => vec![line(&update)?],
            None => vec![],
        },
        RoomAction::Bot { name, ally, ai } => vec![line(&types::UpdateBotStatus {
            ai_lib: Some(ai.clone()),
            ally_number: Some(i32::from(*ally)),
            name: Some(name.clone()),
            owner: state.my_username.clone(),
        })?],
        RoomAction::RemoveBot { name } => vec![line(&types::RemoveBot {
            name: Some(name.clone()),
        })?],
        RoomAction::ModOptions(options) => vec![line(&types::SetModOptions {
            options: Some(options.clone()),
        })?],
        RoomAction::MapOptions(options) => vec![line(&types::SetMapOptions {
            options: Some(options.clone()),
        })?],
        RoomAction::Kick { username } => vec![line(&types::KickFromBattle {
            battle_id,
            name: Some(username.clone()),
            reason: None,
        })?],
        RoomAction::Say { text } => vec![line(&types::Say {
            place: SayPlace::Battle,
            text: Some(text.clone()),
            ..types::Say::default()
        })?],
    })
}

/// What a vote is typed as. Zero-K has no vote command: the official client puts
/// it in battle chat and so does its autohost, which is how anything in a room
/// gets decided.
pub(crate) fn vote_text(choice: VoteChoice) -> Option<&'static str> {
    match choice {
        VoteChoice::Yes => Some("!y"),
        VoteChoice::No => Some("!n"),
        // A Zero-K poll has two answers, so there is nothing to type for a third.
        VoteChoice::Abstain => None,
    }
}

/// Our own seat as a status update, or `None` when there is nobody to name.
///
/// The sync flag always goes out, whatever the caller asked to change. See the
/// module header for what a room does with a client it never hears one from.
fn own_status(state: &LobbyState, status: BattleStatus) -> Option<types::UpdateUserBattleStatus> {
    Some(types::UpdateUserBattleStatus {
        name: Some(state.my_username.clone()?),
        ally_number: Some(i32::from(status.ally)),
        is_spectator: Some(!status.mode),
        sync: Some(SyncStatuses::from(i32::from(status.sync))),
        queue_order: None,
        join_time: None,
    })
}

fn line<C: coilbox_zerok_protocol::Command>(command: &C) -> Result<String, serde_json::Error> {
    coilbox_zerok_protocol::line::to_line(command)
}

#[cfg(test)]
mod tests;
