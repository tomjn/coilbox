//! Applying Tachyon's lobby merge patches.
//!
//! Tachyon sends the whole lobby once, as `lobbyDetails` in the `lobby/join`
//! response, and then sends RFC 7386 JSON merge patches as `lobby/updated`
//! events. This module holds the patch types and [`apply`], the pure function
//! that folds a patch into a [`types::LobbyDetails`]. That struct is the
//! authoritative Tachyon-side lobby. Projecting it into coilbox's own
//! `LobbyState` is a separate job.
//!
//! # Absent is not null
//!
//! A field missing from a patch means leave the current value alone. The same
//! field present and set to `null` means remove it. A plain `Option` collapses
//! the two into `None`, so a field that is both optional and nullable uses
//! [`Patched`] instead.
//!
//! Arrays arrive as objects keyed by an ordering string, because a merge patch
//! cannot address an array element. An entry holding an object merges into the
//! entry already there, an entry set to `null` is removed, a key the patch does
//! not name is untouched, and a key the lobby does not have is inserted.
//!
//! # The patch types are hand written
//!
//! Everything else in this crate is generated from the vendored schema. These
//! types are not, because typify writes `Option<T>` for a field that is both
//! optional and nullable, which is exactly the distinction a merge patch turns
//! on. The build script points the `lobby/updated` arm of the dispatch at
//! [`LobbyUpdatedEvent`] below, so parsing produces the lossless type and the
//! generated `types::LobbyUpdatedEvent` is left unused.
//!
//! A test asserts that these structs name every field the vendored schema has,
//! so re-vendoring a schema that has grown a field fails the build rather than
//! dropping it in silence.
//!
//! # What the two schemas disagree about
//!
//! `lobby/updated` carries three things `lobbyDetails` has no home for:
//! `restrictions`, `tags`, and the `quorum` and `majority` of `currentVote`.
//! They are read, so nothing is lost at the parse, and they are not applied.
//! `lobbyDetails` in turn has `areBossesEnabled`, which no patch can change.

use std::collections::HashMap;
use std::hash::Hash;

use serde::{Deserialize, Deserializer};
use serde_json::{Map, Value};

use crate::types;

/// A field of a merge patch, which is one of three things rather than two.
///
/// Every field of this type carries `#[serde(default)]`, because [`Absent`] is
/// what a missing field deserialises to.
///
/// [`Absent`]: Patched::Absent
#[derive(Clone, Debug, PartialEq)]
pub enum Patched<T> {
    /// Not in the patch. Leave the current value alone.
    Absent,
    /// In the patch, set to `null`. Remove the current value.
    Null,
    /// In the patch, with a value.
    Set(T),
}

// Written out rather than derived. A derive would bound `T: Default`, and the
// value a patch carries does not have to have a default. The variant this picks
// does not depend on `T` at all.
#[allow(clippy::derivable_impls)]
impl<T> Default for Patched<T> {
    fn default() -> Self {
        Self::Absent
    }
}

impl<'de, T> Deserialize<'de> for Patched<T>
where
    T: Deserialize<'de>,
{
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        // Absent never reaches here. Serde fills a missing field from Default.
        Ok(match Option::<T>::deserialize(deserializer)? {
            Some(value) => Self::Set(value),
            None => Self::Null,
        })
    }
}

/// A `lobby/updated` event, the frame that carries a merge patch.
///
/// Only the two fields that matter are read. The envelope has already been read
/// by [`crate::parse_frame`] by the time this deserialises.
#[derive(Clone, Debug, Deserialize)]
pub struct LobbyUpdatedEvent {
    /// Correlates a response with its request. Unique per connection.
    #[serde(rename = "messageId")]
    pub message_id: String,
    /// The patch itself.
    pub data: LobbyPatch,
}

/// A merge patch for one lobby, the `data` of a `lobby/updated` event.
#[derive(Clone, Debug, Deserialize)]
pub struct LobbyPatch {
    /// Which lobby this patch is for. Always present. Matching it against the
    /// lobby being patched is the caller's job.
    pub id: String,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(rename = "mapName", default)]
    pub map_name: Option<String>,
    #[serde(rename = "engineVersion", default)]
    pub engine_version: Option<String>,
    #[serde(rename = "gameVersion", default)]
    pub game_version: Option<String>,
    #[serde(rename = "gameOptions", default)]
    pub game_options: HashMap<types::LobbyDetailsGameOptionsKey, Option<GameOptionPatch>>,
    /// Unit restrictions. Read but not applied, because `lobbyDetails` has no
    /// field for them.
    #[serde(default)]
    pub restrictions: HashMap<String, Option<f64>>,
    /// Read but not applied, because `lobbyDetails` has no field for them.
    #[serde(default)]
    pub tags: HashMap<String, Option<Map<String, Value>>>,
    #[serde(rename = "allyTeamConfig", default)]
    pub ally_team_config: HashMap<types::LobbyDetailsAllyTeamConfigKey, Option<AllyTeamPatch>>,
    #[serde(default)]
    pub bosses: HashMap<types::LobbyDetailsBossesKey, Option<Map<String, Value>>>,
    #[serde(default)]
    pub players: HashMap<types::LobbyDetailsPlayersKey, Option<PlayerPatch>>,
    #[serde(default)]
    pub spectators: HashMap<types::LobbyDetailsSpectatorsKey, Option<SpectatorPatch>>,
    #[serde(default)]
    pub bots: HashMap<types::LobbyDetailsBotsKey, Option<BotPatch>>,
    #[serde(rename = "currentBattle", default)]
    pub current_battle: Patched<CurrentBattlePatch>,
    #[serde(rename = "currentVote", default)]
    pub current_vote: Patched<CurrentVotePatch>,
    #[serde(rename = "voteHistory", default)]
    pub vote_history: HashMap<types::LobbyDetailsVoteHistoryKey, Option<VoteHistoryPatch>>,
}

/// One game option. The schema requires the value, so this is always a whole
/// option rather than a partial one.
#[derive(Clone, Debug, Deserialize)]
pub struct GameOptionPatch {
    pub value: String,
}

/// One ally team, which carries the start box, the team cap and the teams.
#[derive(Clone, Debug, Deserialize)]
pub struct AllyTeamPatch {
    #[serde(rename = "startBox", default)]
    pub start_box: Option<types::StartBox>,
    #[serde(rename = "maxTeams", default)]
    pub max_teams: Option<std::num::NonZeroU64>,
    #[serde(default)]
    pub teams: HashMap<types::LobbyDetailsAllyTeamConfigValueTeamsKey, Option<TeamPatch>>,
}

/// One team inside an ally team.
#[derive(Clone, Debug, Deserialize)]
pub struct TeamPatch {
    #[serde(rename = "maxPlayers", default)]
    pub max_players: Option<std::num::NonZeroU64>,
}

/// One player. Only the id is required, so the rest is a partial update.
#[derive(Clone, Debug, Deserialize)]
pub struct PlayerPatch {
    pub id: types::UserId,
    #[serde(rename = "allyTeam", default)]
    pub ally_team: Option<String>,
    #[serde(default)]
    pub team: Option<String>,
    #[serde(default)]
    pub player: Option<String>,
    #[serde(rename = "isReady", default)]
    pub is_ready: Option<bool>,
    #[serde(rename = "assetStatus", default)]
    pub asset_status: Option<types::LobbyDetailsPlayersValueAssetStatus>,
}

/// One spectator.
#[derive(Clone, Debug, Deserialize)]
pub struct SpectatorPatch {
    pub id: types::UserId,
    #[serde(rename = "joinQueuePosition", default)]
    pub join_queue_position: Patched<f64>,
}

/// One bot.
#[derive(Clone, Debug, Deserialize)]
pub struct BotPatch {
    pub id: String,
    #[serde(rename = "hostUserId", default)]
    pub host_user_id: Option<types::UserId>,
    #[serde(rename = "allyTeam", default)]
    pub ally_team: Option<String>,
    #[serde(default)]
    pub team: Option<String>,
    #[serde(default)]
    pub player: Option<String>,
    #[serde(default)]
    pub name: Patched<String>,
    #[serde(rename = "shortName", default)]
    pub short_name: Option<String>,
    #[serde(default)]
    pub version: Patched<String>,
    #[serde(default)]
    pub options: Patched<HashMap<types::LobbyDetailsBotsValueOptionsKey, Option<String>>>,
}

/// The battle in progress. Both fields are required, so this is always whole.
#[derive(Clone, Debug, Deserialize)]
pub struct CurrentBattlePatch {
    pub id: String,
    #[serde(rename = "startedAt")]
    pub started_at: types::UnixTime,
}

/// The vote in progress. Only the id is required, so the rest is a partial
/// update.
#[derive(Clone, Debug, Deserialize)]
pub struct CurrentVotePatch {
    pub id: String,
    #[serde(default)]
    pub action: Option<types::VoteActions>,
    #[serde(default)]
    pub initiator: Option<types::UserId>,
    #[serde(default)]
    pub voters: HashMap<types::LobbyDetailsCurrentVoteVotersKey, Option<VoterPatch>>,
    #[serde(default)]
    pub until: Option<types::UnixTime>,
    /// Read but not applied, because `lobbyDetails` has no field for it.
    #[serde(default)]
    pub quorum: Option<u64>,
    /// Read but not applied, because `lobbyDetails` has no field for it.
    #[serde(default)]
    pub majority: Option<u64>,
}

/// One voter. The schema does not allow a null here, but a null is read as a
/// removal anyway rather than throwing the whole patch away.
#[derive(Clone, Debug, Deserialize)]
pub struct VoterPatch {
    #[serde(default)]
    pub vote: Option<types::LobbyDetailsCurrentVoteVotersValueVote>,
}

/// One finished vote.
#[derive(Clone, Debug, Deserialize)]
pub struct VoteHistoryPatch {
    #[serde(default)]
    pub vote: Option<types::VoteActions>,
    #[serde(default)]
    pub outcome: Option<types::VoteOutcomes>,
    #[serde(rename = "finishedAt", default)]
    pub finished_at: Option<types::UnixTime>,
}

/// Folds a merge patch into a lobby.
///
/// The patch's `id` is ignored. The caller knows which lobby it is holding.
///
/// A patch that would insert an entry the schema cannot complete, such as a
/// player the lobby does not have yet whose patch carries no team, is skipped.
/// Nothing else in the patch is affected. Fields the patch names that this
/// crate does not know about were already dropped at the parse, so they cannot
/// reach here.
pub fn apply(lobby: &mut types::LobbyDetails, patch: &LobbyPatch) {
    if let Some(name) = &patch.name {
        lobby.name = name.clone();
    }
    if let Some(map_name) = &patch.map_name {
        lobby.map_name = map_name.clone();
    }
    if let Some(engine_version) = &patch.engine_version {
        lobby.engine_version = engine_version.clone();
    }
    if let Some(game_version) = &patch.game_version {
        lobby.game_version = game_version.clone();
    }
    merge_keyed(
        &mut lobby.game_options,
        &patch.game_options,
        merge_game_option,
        insert_game_option,
    );
    merge_keyed(
        &mut lobby.ally_team_config,
        &patch.ally_team_config,
        merge_ally_team,
        insert_ally_team,
    );
    merge_keyed(&mut lobby.bosses, &patch.bosses, merge_object, |patch| {
        Some(patch.clone())
    });
    merge_keyed(
        &mut lobby.players,
        &patch.players,
        merge_player,
        insert_player,
    );
    merge_keyed(
        &mut lobby.spectators,
        &patch.spectators,
        merge_spectator,
        insert_spectator,
    );
    merge_keyed(&mut lobby.bots, &patch.bots, merge_bot, insert_bot);
    merge_keyed(
        &mut lobby.vote_history,
        &patch.vote_history,
        merge_vote_history,
        insert_vote_history,
    );
    merge_optional(
        &mut lobby.current_battle,
        &patch.current_battle,
        merge_current_battle,
        insert_current_battle,
    );
    merge_optional(
        &mut lobby.current_vote,
        &patch.current_vote,
        merge_current_vote,
        insert_current_vote,
    );
}

/// Folds a patched keyed collection into the one the lobby holds.
///
/// `merge` updates an entry that is already there. `insert` builds a new one,
/// and returns `None` if the patch does not carry enough to build a whole
/// entry, in which case the key is skipped.
fn merge_keyed<K, V, P>(
    current: &mut HashMap<K, V>,
    patch: &HashMap<K, Option<P>>,
    merge: fn(&mut V, &P),
    insert: fn(&P) -> Option<V>,
) where
    K: Clone + Eq + Hash,
{
    for (key, entry) in patch {
        let Some(entry) = entry else {
            current.remove(key);
            continue;
        };
        match current.get_mut(key) {
            Some(value) => merge(value, entry),
            None => {
                if let Some(value) = insert(entry) {
                    current.insert(key.clone(), value);
                }
            }
        }
    }
}

/// The same as [`merge_keyed`] for a field that is one optional value rather
/// than a collection.
fn merge_optional<T, P>(
    current: &mut Option<T>,
    patch: &Patched<P>,
    merge: fn(&mut T, &P),
    insert: fn(&P) -> Option<T>,
) {
    match patch {
        Patched::Absent => {}
        Patched::Null => *current = None,
        Patched::Set(patch) => match current {
            Some(current) => merge(current, patch),
            None => *current = insert(patch),
        },
    }
}

/// RFC 7386 over a JSON object, for the parts of the lobby the schema leaves
/// open.
fn merge_object(current: &mut Map<String, Value>, patch: &Map<String, Value>) {
    for (key, value) in patch {
        match (current.get_mut(key), value) {
            (_, Value::Null) => {
                current.remove(key);
            }
            (Some(Value::Object(current)), Value::Object(patch)) => merge_object(current, patch),
            _ => {
                current.insert(key.clone(), value.clone());
            }
        }
    }
}

fn merge_game_option(current: &mut types::LobbyDetailsGameOptionsValue, patch: &GameOptionPatch) {
    current.value = patch.value.clone();
}

fn insert_game_option(patch: &GameOptionPatch) -> Option<types::LobbyDetailsGameOptionsValue> {
    Some(types::LobbyDetailsGameOptionsValue {
        value: patch.value.clone(),
    })
}

fn merge_ally_team(current: &mut types::LobbyDetailsAllyTeamConfigValue, patch: &AllyTeamPatch) {
    if let Some(start_box) = &patch.start_box {
        current.start_box = start_box.clone();
    }
    if let Some(max_teams) = patch.max_teams {
        current.max_teams = max_teams;
    }
    merge_keyed(&mut current.teams, &patch.teams, merge_team, insert_team);
}

fn insert_ally_team(patch: &AllyTeamPatch) -> Option<types::LobbyDetailsAllyTeamConfigValue> {
    let mut teams = HashMap::new();
    merge_keyed(&mut teams, &patch.teams, merge_team, insert_team);
    Some(types::LobbyDetailsAllyTeamConfigValue {
        start_box: patch.start_box.clone()?,
        max_teams: patch.max_teams?,
        teams,
    })
}

fn merge_team(current: &mut types::LobbyDetailsAllyTeamConfigValueTeamsValue, patch: &TeamPatch) {
    if let Some(max_players) = patch.max_players {
        current.max_players = max_players;
    }
}

fn insert_team(patch: &TeamPatch) -> Option<types::LobbyDetailsAllyTeamConfigValueTeamsValue> {
    Some(types::LobbyDetailsAllyTeamConfigValueTeamsValue {
        max_players: patch.max_players?,
    })
}

fn merge_player(current: &mut types::LobbyDetailsPlayersValue, patch: &PlayerPatch) {
    current.id = patch.id.clone();
    if let Some(ally_team) = &patch.ally_team {
        current.ally_team = ally_team.clone();
    }
    if let Some(team) = &patch.team {
        current.team = team.clone();
    }
    if let Some(player) = &patch.player {
        current.player = player.clone();
    }
    if let Some(is_ready) = patch.is_ready {
        current.is_ready = is_ready;
    }
    if let Some(asset_status) = patch.asset_status {
        current.asset_status = asset_status;
    }
}

fn insert_player(patch: &PlayerPatch) -> Option<types::LobbyDetailsPlayersValue> {
    Some(types::LobbyDetailsPlayersValue {
        id: patch.id.clone(),
        ally_team: patch.ally_team.clone()?,
        team: patch.team.clone()?,
        player: patch.player.clone()?,
        is_ready: patch.is_ready?,
        asset_status: patch.asset_status?,
    })
}

fn merge_spectator(current: &mut types::LobbyDetailsSpectatorsValue, patch: &SpectatorPatch) {
    current.id = patch.id.clone();
    merge_optional(
        &mut current.join_queue_position,
        &patch.join_queue_position,
        |current, patch| *current = *patch,
        |patch| Some(*patch),
    );
}

fn insert_spectator(patch: &SpectatorPatch) -> Option<types::LobbyDetailsSpectatorsValue> {
    let mut spectator = types::LobbyDetailsSpectatorsValue {
        id: patch.id.clone(),
        join_queue_position: None,
    };
    merge_spectator(&mut spectator, patch);
    Some(spectator)
}

fn merge_bot(current: &mut types::LobbyDetailsBotsValue, patch: &BotPatch) {
    current.id = patch.id.clone();
    if let Some(host_user_id) = &patch.host_user_id {
        current.host_user_id = host_user_id.clone();
    }
    if let Some(ally_team) = &patch.ally_team {
        current.ally_team = ally_team.clone();
    }
    if let Some(team) = &patch.team {
        current.team = team.clone();
    }
    if let Some(player) = &patch.player {
        current.player = player.clone();
    }
    if let Some(short_name) = patch.short_name.clone().and_then(short_name) {
        current.short_name = short_name;
    }
    match &patch.name {
        Patched::Absent => {}
        Patched::Null => current.name = None,
        // The patch schema puts no length cap on the display name and
        // lobbyDetails caps it at 20 characters, so a longer one is left as it
        // was rather than throwing the rest of the patch away.
        Patched::Set(name) => {
            if let Some(name) = display_name(name.clone()) {
                current.name = Some(name);
            }
        }
    }
    merge_optional(
        &mut current.version,
        &patch.version,
        |current, patch| *current = patch.clone(),
        |patch| Some(patch.clone()),
    );
    match &patch.options {
        Patched::Absent => {}
        Patched::Null => current.options.clear(),
        Patched::Set(options) => merge_keyed(
            &mut current.options,
            options,
            |current, patch| *current = patch.clone(),
            |patch| Some(patch.clone()),
        ),
    }
}

fn insert_bot(patch: &BotPatch) -> Option<types::LobbyDetailsBotsValue> {
    let mut bot = types::LobbyDetailsBotsValue {
        id: patch.id.clone(),
        host_user_id: patch.host_user_id.clone()?,
        ally_team: patch.ally_team.clone()?,
        team: patch.team.clone()?,
        player: patch.player.clone()?,
        short_name: patch.short_name.clone().and_then(short_name)?,
        name: None,
        version: None,
        options: HashMap::new(),
    };
    merge_bot(&mut bot, patch);
    Some(bot)
}

/// Reads a bot's display name back into the capped type `lobbyDetails` uses.
fn display_name(name: String) -> Option<types::LobbyDetailsBotsValueName> {
    types::LobbyDetailsBotsValueName::try_from(name).ok()
}

/// Reads a bot's short name back into the capped type `lobbyDetails` uses.
fn short_name(name: String) -> Option<types::LobbyDetailsBotsValueShortName> {
    types::LobbyDetailsBotsValueShortName::try_from(name).ok()
}

fn merge_current_battle(
    current: &mut types::LobbyDetailsCurrentBattle,
    patch: &CurrentBattlePatch,
) {
    current.id = patch.id.clone();
    current.started_at = patch.started_at.clone();
}

fn insert_current_battle(patch: &CurrentBattlePatch) -> Option<types::LobbyDetailsCurrentBattle> {
    Some(types::LobbyDetailsCurrentBattle {
        id: patch.id.clone(),
        started_at: patch.started_at.clone(),
    })
}

fn merge_current_vote(current: &mut types::LobbyDetailsCurrentVote, patch: &CurrentVotePatch) {
    current.id = patch.id.clone();
    if let Some(action) = &patch.action {
        current.action = action.clone();
    }
    if let Some(initiator) = &patch.initiator {
        current.initiator = initiator.clone();
    }
    if let Some(until) = &patch.until {
        current.until = until.clone();
    }
    merge_keyed(
        &mut current.voters,
        &patch.voters,
        merge_voter,
        insert_voter,
    );
}

fn insert_current_vote(patch: &CurrentVotePatch) -> Option<types::LobbyDetailsCurrentVote> {
    let mut voters = HashMap::new();
    merge_keyed(&mut voters, &patch.voters, merge_voter, insert_voter);
    Some(types::LobbyDetailsCurrentVote {
        id: patch.id.clone(),
        action: patch.action.clone()?,
        initiator: patch.initiator.clone()?,
        until: patch.until.clone()?,
        voters,
    })
}

fn merge_voter(current: &mut types::LobbyDetailsCurrentVoteVotersValue, patch: &VoterPatch) {
    if let Some(vote) = patch.vote {
        current.vote = vote;
    }
}

fn insert_voter(patch: &VoterPatch) -> Option<types::LobbyDetailsCurrentVoteVotersValue> {
    Some(types::LobbyDetailsCurrentVoteVotersValue { vote: patch.vote? })
}

fn merge_vote_history(current: &mut types::LobbyDetailsVoteHistoryValue, patch: &VoteHistoryPatch) {
    if let Some(vote) = &patch.vote {
        current.vote = vote.clone();
    }
    if let Some(outcome) = patch.outcome {
        current.outcome = outcome;
    }
    if let Some(finished_at) = &patch.finished_at {
        current.finished_at = finished_at.clone();
    }
}

fn insert_vote_history(patch: &VoteHistoryPatch) -> Option<types::LobbyDetailsVoteHistoryValue> {
    Some(types::LobbyDetailsVoteHistoryValue {
        vote: patch.vote.clone()?,
        outcome: patch.outcome?,
        finished_at: patch.finished_at.clone()?,
    })
}

#[cfg(test)]
mod tests;
