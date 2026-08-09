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
//! - the founder. Tachyon has no host or founder, so `Battle::host` stays empty.
//!   `Battle::bosses` carries the nearest thing the protocol has instead: who
//!   may change the lobby.
//! - team colours. Tachyon assigns them when the match starts, so `team_color`
//!   stays 0 rather than carrying a guess the engine would then contradict. The
//!   room shows an unset swatch rather than a black one, because 0 is black.
//! - `currentVote` and `voteHistory`. Votes are #1231.
//! - `joinQueuePosition` on a spectator, the `player` slot on a player and a
//!   bot, and a bot's `version` and `options`.
//! - `gameOptions`. `Battle::script_tags` is the engine's start-script key space
//!   and nothing says Tachyon's option keys are the same one, so mapping them
//!   would put unverified keys in front of the options editor.
//!
//! # Turning a control into a request
//!
//! The battle room's controls were built for TASServer, so they name an ally team
//! by index, a bot by the name on screen and a member by their username. Tachyon
//! names all three by a server-assigned string. [`requests_for`] is the one place
//! that translation happens, because the lobby we hold is the only thing that can
//! do it, and it is pure so each control's request can be read off a test rather
//! than off a live server.
//!
//! It returns a list because one control can move more than one thing, and it is
//! a short list on purpose. Teiserver disconnects a client that sends more than
//! ten requests a second, so a control that pushes our whole seat on every click
//! asks only for the parts that actually differ from the seat we hold.
//!
//! # Starting the match
//!
//! The lobby does not host the game. The server picks an autohost and sends each
//! player a `battle/start` request naming where to connect, so [`battle_start`]
//! is what answers it and [`battle_config`] is what the engine launches with.
//! Nothing in that config comes from the lobby, which is why the mapping reads
//! only the request.

use std::collections::HashMap;

use coilbox_lobby_protocol::{BattleStatus, Bot, Delta, LobbyState, MemberStatus, StartRect, User};
use coilbox_tachyon_protocol::merge_patch;
use coilbox_tachyon_protocol::types::{self, LobbyDetails, LobbyJoinResponse};
use coilbox_tachyon_protocol::TachyonMessage;
use serde_json::{json, Value};
use tokio::sync::mpsc;

use crate::tachyon_lobbies::handle_for;
use crate::tachyon_rpc::{Failure, FailureReason, HandlerResult};
use crate::tachyon_users::SUBSCRIBE_LIMIT;

/// The start rect space `Battle::start_rects` is in. Tachyon's start box is in
/// fractions of the map, so the two differ by this factor.
const START_RECT_SCALE: f64 = 200.0;

/// One Tachyon request a battle room control asks for.
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct Request {
    pub command: &'static str,
    pub data: Option<Value>,
}

/// What a battle room control asks of the lobby, in the terms the control
/// speaks. The room's pickers name an ally team by index, a bot by the name on
/// screen and a member by their username, because that is what the TASServer
/// protocol they were built for uses. Tachyon names all three by a string the
/// server assigned, so [`requests_for`] translates.
pub(crate) enum RoomAction {
    /// Our own seat, as the room pushes it: the whole battle status with one
    /// field changed.
    OwnStatus(BattleStatus),
    /// Add a bot on the ally team the index names.
    AddBot {
        name: String,
        ally: u8,
        ai: String,
    },
    /// Change the AI a bot runs, keeping its seat.
    ChangeBotAi {
        name: String,
        ai: String,
    },
    RemoveBot {
        name: String,
    },
    /// Kick a member out. Lobby-scoped and open to any member subject to a
    /// vote, so it is not the moderation surface the TASServer path has.
    Kick {
        username: String,
    },
    /// Change the lobby's map.
    SetMap {
        map: String,
    },
    AppointBoss {
        username: String,
    },
    Unboss {
        username: String,
    },
}

/// The requests a control's action comes to on the lobby we hold.
///
/// Empty means there is nothing to ask for: we are in no lobby, the action
/// names something the lobby does not have, or the seat already reads the way
/// the control wants it.
pub(crate) fn requests_for(
    room: &Option<Room>,
    state: &LobbyState,
    action: &RoomAction,
) -> Vec<Request> {
    let Some(room) = room else {
        return vec![];
    };
    let details = &room.details;
    match action {
        RoomAction::OwnStatus(status) => own_status(details, state, *status),
        RoomAction::AddBot { name, ally, ai } => one(ally_key_at(details, *ally).map(|ally| {
            request(
                "lobby/addBot",
                json!({ "allyTeam": ally, "name": name, "shortName": ai }),
            )
        })),
        RoomAction::ChangeBotAi { name, ai } => one(bot_id(details, name).map(|id| {
            request(
                "lobby/updateBot",
                json!({ "id": id, "shortName": ai, "name": name }),
            )
        })),
        RoomAction::RemoveBot { name } => {
            one(bot_id(details, name).map(|id| request("lobby/removeBot", json!({ "id": id }))))
        }
        RoomAction::Kick { username } => {
            one(user_id(state, username)
                .map(|id| request("lobby/kickban", json!({ "userId": id }))))
        }
        RoomAction::SetMap { map } => vec![request("lobby/update", json!({ "mapName": map }))],
        RoomAction::AppointBoss { username } => one(user_id(state, username)
            .map(|id| request("lobby/appointBoss", json!({ "userId": id })))),
        RoomAction::Unboss { username } => {
            one(user_id(state, username).map(|id| request("lobby/unboss", json!({ "userId": id }))))
        }
    }
}

/// The requests our own seat controls come to.
///
/// The room pushes the whole battle status on every click, so this asks only
/// for what differs from the seat we hold. Teiserver disconnects a client that
/// sends more than ten requests a second, and a control that sent three every
/// time would spend that budget on nothing.
///
/// A spectator has no ready flag and no assets to report, and
/// `lobby/updateClientStatus` refuses one with `not_a_player`, so the ready and
/// asset request is only ever sent while we are already a player. Taking a seat
/// and then reporting our assets is two clicks' worth of requests on one click,
/// so the seat move goes on its own and the room's own asset effect reports the
/// assets once the lobby comes back with us in it.
fn own_status(details: &LobbyDetails, state: &LobbyState, wanted: BattleStatus) -> Vec<Request> {
    let Some(me) = my_user_id(state) else {
        return vec![];
    };
    let player = details
        .players
        .values()
        .find(|player| player.id.as_str() == me);
    let spectating = details
        .spectators
        .values()
        .any(|spectator| spectator.id.as_str() == me);

    if !wanted.mode {
        // Already watching, so there is nothing to ask for.
        return one(player.map(|_| Request {
            command: "lobby/spectate",
            data: None,
        }));
    }

    let mut requests = Vec::new();
    if let Some(ally) = ally_key_at(details, wanted.ally) {
        let moving = player.is_none_or(|player| player.ally_team != ally);
        if moving && (player.is_some() || spectating) {
            requests.push(request("lobby/joinAllyTeam", json!({ "allyTeam": ally })));
        }
    }
    if let Some(player) = player {
        let assets = asset_status(wanted.sync);
        if player.is_ready != wanted.ready || player.asset_status != assets {
            requests.push(request(
                "lobby/updateClientStatus",
                json!({ "isReady": wanted.ready, "assetStatus": assets.to_string() }),
            ));
        }
    }
    requests
}

/// What the room's sync field says about our assets.
///
/// The room works out whether the map and the game are installed from its own
/// unitsync scan and reports it as the engine's sync field: 1 is synced and
/// anything else is not. `downloading` is never reported, because the room's
/// two-state signal cannot say it: whether a download is running is held inside
/// the missing-content cards rather than anywhere the seat can read.
fn asset_status(sync: u8) -> types::LobbyDetailsPlayersValueAssetStatus {
    if sync == 1 {
        types::LobbyDetailsPlayersValueAssetStatus::Complete
    } else {
        types::LobbyDetailsPlayersValueAssetStatus::Missing
    }
}

/// The ally team key an ally index names, or `None` when the lobby has no such
/// ally team. The index is the key's place in the sorted list, which is the same
/// order the projection groups the roster by.
fn ally_key_at(details: &LobbyDetails, index: u8) -> Option<&str> {
    sorted(&details.ally_team_config)
        .get(usize::from(index))
        .map(|(key, _)| *key)
}

/// The server's id for the bot the roster shows under `name`.
fn bot_id<'a>(details: &'a LobbyDetails, name: &str) -> Option<&'a str> {
    bot_keys(details)
        .into_iter()
        .find(|(key, _)| key == name)
        .map(|(_, bot)| bot.id.as_str())
}

/// The user id behind a username, which is how Tachyon names a member.
fn user_id<'a>(state: &'a LobbyState, username: &str) -> Option<&'a str> {
    state.users.get(username).map(|user| user.user_id.as_str())
}

/// Our own user id, which every seat request needs and which the room only has
/// once we are signed in and named.
fn my_user_id(state: &LobbyState) -> Option<&str> {
    let name = state.my_username.as_deref()?;
    user_id(state, name)
}

fn request(command: &'static str, data: Value) -> Request {
    Request {
        command,
        data: Some(data),
    }
}

/// A request that may not exist, as the list [`requests_for`] returns.
fn one(request: Option<Request>) -> Vec<Request> {
    request.into_iter().collect()
}

/// Answer the server's `battle/start` request, handing the match on to be
/// launched.
///
/// The answer means "I have taken this", not "the game is running". Teiserver
/// closes the connection with code 1008 if a request of its own goes
/// unanswered, and working out whether the map and the game are on disk, then
/// starting an engine, takes far longer than that. So this parses the payload,
/// passes it to the connection loop, and answers at once. A player who turns out
/// to be missing the content launches when the download finishes.
///
/// The only failure it can report is one of the four every command has. None of
/// them means "I do not have the map", so a payload we understand is always
/// taken.
pub(crate) fn battle_start(
    data: &Value,
    launch: &mpsc::UnboundedSender<types::PrivateBattle>,
) -> HandlerResult {
    // `privateBattle.ip` is typed upstream as a uuid while the live server sends
    // an address, so this parses only because the vendored schema is patched.
    // See `crates/coilbox-tachyon-protocol/schema/README.md`.
    let Ok(private) = serde_json::from_value::<types::PrivateBattle>(data.clone()) else {
        return Err(Failure::new(FailureReason::InvalidRequest));
    };
    if launch.send(private).is_err() {
        // The connection loop has gone, so nothing will launch this and saying
        // otherwise would be a lie the server acts on.
        return Err(Failure::new(FailureReason::InternalError));
    }
    // A successful battle/start response has no data at all.
    Ok(None)
}

/// Map a `battle/start` payload into the play plugin's `BattleConfig`.
///
/// A joining client gets a minimal start script holding its name, the address
/// and its password, because the game server relays the real layout once the
/// engine connects. So `players`, `teams` and `allyTeams` go out empty: the play
/// plugin requires the fields, and nothing on the wire fills them.
///
/// Two parts of the payload have no slot in a `BattleConfig`. `engine.version`
/// does not, because which engine runs is chosen before the launch, from the
/// lobby's own engine version. `map.springName` and `game.springName` do, and
/// are carried, though a client script leaves both out.
pub(crate) fn battle_config(private: &types::PrivateBattle) -> Value {
    json!({
        "mapName": private.map.spring_name,
        "gameType": private.game.spring_name,
        "myPlayerName": private.username,
        // Where players start is the game server's business on a client script,
        // so this is the field's default rather than a claim about the match.
        "startPosType": 0,
        "players": [],
        "teams": [],
        "allyTeams": [],
        "isHost": false,
        "hostIp": private.ip,
        "hostPort": port(private.port),
        "myPasswd": private.password,
    })
}

/// The port to connect on. It is a JSON number on the wire and a port is a
/// `u16`, so anything outside that range is not one.
fn port(value: f64) -> Option<u16> {
    let rounded = value.round();
    (rounded >= 0.0 && rounded <= f64::from(u16::MAX)).then_some(rounded as u16)
}

/// Whether the lobby we have just joined is already playing a match.
///
/// A late joiner is not sent `battle/start` off the back of joining the lobby,
/// so this is what tells the connection to ask for it with `lobby/joinBattle`.
pub(crate) fn match_running(room: &Option<Room>) -> bool {
    room.as_ref()
        .is_some_and(|room| room.details.current_battle.is_some())
}

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
    // Lobby chat is the room's, as it is on the line protocol, where leaving
    // the battle takes us out of its channel.
    state.channels.remove(&chat_channel(handle));

    // The lobby is still listed, so only the parts the room filled in go. The
    // list keeps it up to date from here.
    let Some(battle) = state.battles.get_mut(&handle) else {
        return vec![];
    };
    battle.channel = None;
    battle.members.clear();
    battle.bots.clear();
    battle.start_rects.clear();
    battle.bosses.clear();
    battle.bosses_enabled = false;
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
    battle.channel = Some(chat_channel(handle));
    battle.title = details.name.clone();
    battle.map = details.map_name.clone();
    battle.version = details.engine_version.clone();
    battle.modname = details.game_version.clone();
    battle.player_count = Some(count(details.players.len()));
    battle.spectator_count = count(details.spectators.len());
    battle.members = members(details, &names);
    battle.bots = bots(details, &names);
    battle.start_rects = start_rects(details);
    battle.bosses = bosses(details, &names);
    battle.bosses_enabled = details.are_bosses_enabled;
    let changed = battle != before;
    state.battles.insert(handle, battle);

    match (known, changed) {
        (false, _) => vec![Delta::BattleOpened { id: handle }],
        (true, true) => vec![Delta::BattleInfoChanged { id: handle }],
        (true, false) => vec![],
    }
}

/// The bucket the lobby's chat lives in.
///
/// Tachyon has no channels, so nothing on the wire names one. The battle room
/// and the chat sidebar both read a battle's chat out of `LobbyState::channels`
/// under `Battle::channel`, and both already know a `__battle__` name is a
/// battle's own rather than a channel to list, so this follows the TASServer
/// convention rather than inventing a second one.
pub(crate) fn chat_channel(handle: u32) -> String {
    format!("__battle__{handle}")
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

/// The key the roster reads each bot by: the name it shows, or the id the server
/// gave it.
///
/// Tachyon lets two bots share a display name and the roster is keyed by it, so
/// the second one falls back to its id rather than replacing the first. This is
/// also how a control naming a bot on screen finds the bot a request has to
/// name, so the two cannot drift apart.
fn bot_keys(details: &LobbyDetails) -> Vec<(String, &types::LobbyDetailsBotsValue)> {
    let mut keys: Vec<(String, &types::LobbyDetailsBotsValue)> = Vec::new();
    for (_, bot) in sorted(&details.bots) {
        let shown = bot
            .name
            .as_ref()
            .map_or_else(|| bot.short_name.to_string(), |name| name.to_string());
        let taken = keys.iter().any(|(key, _)| *key == shown);
        keys.push((if taken { bot.id.clone() } else { shown }, bot));
    }
    keys
}

/// The bots, keyed the way the roster reads them.
fn bots(details: &LobbyDetails, names: &HashMap<&str, &str>) -> HashMap<String, Bot> {
    let allies = ally_indices(details);
    let teams = team_indices(details);
    let mut bots: HashMap<String, Bot> = HashMap::new();

    for (key, bot) in bot_keys(details) {
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

/// The bosses, under the names the roster shows, in a stable order.
///
/// A boss is the nearest thing a Tachyon lobby has to a host: the lobby has no
/// founder, and this is who may change it. `bosses` is keyed by user id.
fn bosses(details: &LobbyDetails, names: &HashMap<&str, &str>) -> Vec<String> {
    sorted(&details.bosses)
        .into_iter()
        .map(|(id, _)| {
            names
                .get(id)
                .map_or_else(|| id.to_owned(), |name| (*name).to_owned())
        })
        .collect()
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
