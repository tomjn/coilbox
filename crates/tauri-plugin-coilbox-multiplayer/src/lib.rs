//! Live lobby client (Rust half). A thin async IO shell around
//! `coilbox-lobby-protocol`: it owns the tokio TCP socket (with STLS/TLS upgrade),
//! runs the reply-driven login state machine, feeds each server line through the
//! protocol reducer, and streams the resulting state deltas to the frontend over a
//! Tauri `Channel`. Registered as `"coilbox-multiplayer"`; the frontend invokes
//! `plugin:coilbox-multiplayer|<cmd>`.
//!
//! Modules: [`tls`] establishes the (optionally TLS-upgraded) stream; [`conn`] owns
//! the per-connection event loop and the [`Registry`] of live connections; this
//! file exposes the Tauri commands over that registry.

mod conn;
mod tls;

use std::collections::{BTreeMap, BTreeSet};

use coilbox_lobby_protocol::{
    command, password_hash, team_color_rgb, BattleStatus, ClientStatus, LobbyState, LoginConfig,
};
use conn::{spawn_connection, LobbyEvent, Outbound, Registry, ServerConn};
use picoframe_core::CliResult;
use serde_json::{json, Value};
use tauri::{
    ipc::Channel,
    plugin::{Builder, TauriPlugin},
    Manager, Runtime, State,
};

/// Enqueue one raw wire line on a live connection. The shared body behind every
/// typed action command: look the connection up, push the line onto its writer
/// channel, and translate the two failure modes (unknown key / closed socket) into
/// a `CliResult` error.
fn enqueue(registry: &Registry, server_key: &str, line: String) -> CliResult {
    let map = registry.lock().unwrap();
    match map.get(server_key) {
        Some(conn) => match conn.tx.send(Outbound::Line(line)) {
            Ok(()) => CliResult::ok(json!({ "sent": true })),
            Err(_) => CliResult::err("connection is closed"),
        },
        None => CliResult::err(format!("not connected: {server_key}")),
    }
}

/// `mp_connect` — open (and, for TLS servers, STLS-upgrade) the socket, then hand
/// it to the connection task which runs the login handshake and streams events.
/// Refuses a second connection under the same `server_key`. The password is hashed
/// here and never logged in plaintext (the outbound `LOGIN` console line carries
/// only the hash).
#[tauri::command]
#[allow(clippy::too_many_arguments)]
async fn mp_connect(
    registry: State<'_, Registry>,
    server_key: String,
    host: String,
    port: u16,
    tls: bool,
    allow_self_signed: bool,
    username: String,
    password: String,
    compat_flags: Vec<String>,
    on_event: Channel<LobbyEvent>,
) -> Result<CliResult, ()> {
    if registry.lock().unwrap().contains_key(&server_key) {
        return Ok(CliResult::err(format!("already connected: {server_key}")));
    }

    let stream = match tls::connect_stream(&host, port, tls, allow_self_signed).await {
        Ok(s) => s,
        Err(e) => return Ok(CliResult::err(e)),
    };

    let login_cfg = LoginConfig {
        username,
        password_hash: password_hash(&password),
        // The server records this as the client's advertised local address; a
        // wildcard is accepted and avoids leaking a real LAN IP.
        local_ip: "*".into(),
        agent: format!("Coilbox {}", env!("CARGO_PKG_VERSION")),
        client_id: "0".into(),
        compat_flags,
        // TLS was already upgraded up-front in `connect_stream`, so the login
        // machine drives a plain greeting on the already-secured stream.
        use_stls: false,
    };

    spawn_connection(
        registry.inner().clone(),
        server_key,
        stream,
        login_cfg,
        on_event,
    );
    Ok(CliResult::ok(json!({ "connected": true })))
}

/// `mp_disconnect` — best-effort `EXIT`, then abort the connection task and evict
/// it. Aborting the task drops the socket, so this is idempotent for an
/// already-dead connection.
#[tauri::command]
fn mp_disconnect(registry: State<'_, Registry>, server_key: String) -> CliResult {
    let conn = registry.lock().unwrap().remove(&server_key);
    match conn {
        Some(ServerConn { tx, abort, .. }) => {
            let _ = tx.send(Outbound::Line(command::exit(None)));
            abort.abort();
            CliResult::ok(json!({ "disconnected": true }))
        }
        None => CliResult::ok(json!({ "disconnected": false })),
    }
}

/// `mp_snapshot` — clone and return the authoritative state for one connection so
/// the frontend can seed or resync its mirror.
#[tauri::command]
fn mp_snapshot(registry: State<'_, Registry>, server_key: String) -> CliResult {
    let map = registry.lock().unwrap();
    match map.get(&server_key) {
        Some(conn) => {
            let state = conn.state.lock().unwrap().clone();
            CliResult::ok(json!({ "state": state }))
        }
        None => CliResult::err(format!("not connected: {server_key}")),
    }
}

/// `mp_send` — raw escape hatch: enqueue an arbitrary wire line as-is.
#[tauri::command]
fn mp_send(registry: State<'_, Registry>, server_key: String, line: String) -> CliResult {
    enqueue(registry.inner(), &server_key, line)
}

/// `mp_say` — chat to a channel.
#[tauri::command]
fn mp_say(
    registry: State<'_, Registry>,
    server_key: String,
    channel: String,
    message: String,
) -> CliResult {
    enqueue(
        registry.inner(),
        &server_key,
        command::say(&channel, &message),
    )
}

/// `mp_say_private` — direct message to a user.
#[tauri::command]
fn mp_say_private(
    registry: State<'_, Registry>,
    server_key: String,
    username: String,
    message: String,
) -> CliResult {
    enqueue(
        registry.inner(),
        &server_key,
        command::say_private(&username, &message),
    )
}

/// `mp_join_channel` — join a chat channel (optional key).
#[tauri::command]
fn mp_join_channel(
    registry: State<'_, Registry>,
    server_key: String,
    channel: String,
    key: Option<String>,
) -> CliResult {
    enqueue(
        registry.inner(),
        &server_key,
        command::join_channel(&channel, key.as_deref()),
    )
}

/// `mp_leave_channel` — leave a chat channel.
#[tauri::command]
fn mp_leave_channel(
    registry: State<'_, Registry>,
    server_key: String,
    channel: String,
) -> CliResult {
    enqueue(
        registry.inner(),
        &server_key,
        command::leave_channel(&channel),
    )
}

/// `mp_join_battle` — join an open battle (optional battle key and script password).
#[tauri::command]
fn mp_join_battle(
    registry: State<'_, Registry>,
    server_key: String,
    id: u32,
    key: Option<String>,
    script_password: Option<String>,
) -> CliResult {
    enqueue(
        registry.inner(),
        &server_key,
        command::join_battle(id, key.as_deref(), script_password.as_deref()),
    )
}

/// `mp_leave_battle` — leave the current battle.
#[tauri::command]
fn mp_leave_battle(registry: State<'_, Registry>, server_key: String) -> CliResult {
    enqueue(registry.inner(), &server_key, command::leave_battle())
}

/// `mp_set_status` — set the client status. Only `ingame`/`away` are client-set;
/// rank/access/bot are server-authoritative so we always send them as `false`.
#[tauri::command]
fn mp_set_status(
    registry: State<'_, Registry>,
    server_key: String,
    ingame: bool,
    away: bool,
) -> CliResult {
    let status = ClientStatus {
        ingame,
        away,
        rank: 0,
        access: false,
        bot: false,
    };
    enqueue(registry.inner(), &server_key, command::my_status(status))
}

/// `mp_set_battle_status` — set our per-battle status and team color.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
fn mp_set_battle_status(
    registry: State<'_, Registry>,
    server_key: String,
    ready: bool,
    team_id: u8,
    ally: u8,
    mode: bool,
    handicap: u8,
    sync: u8,
    side: u8,
    color: u32,
) -> CliResult {
    let status = BattleStatus {
        ready,
        team_id,
        ally,
        mode,
        handicap,
        sync,
        side,
    };
    enqueue(
        registry.inner(),
        &server_key,
        command::my_battle_status(status, color),
    )
}

/// `mp_open_battle` — host a new battle (mirrors the `OPENBATTLE` field order).
#[tauri::command]
#[allow(clippy::too_many_arguments)]
fn mp_open_battle(
    registry: State<'_, Registry>,
    server_key: String,
    battle_type: u8,
    nat_type: u8,
    key: String,
    port: u16,
    max_players: u32,
    modhash: i32,
    rank: u8,
    maphash: i32,
    engine: String,
    version: String,
    map: String,
    title: String,
    modname: String,
) -> CliResult {
    let line = command::open_battle(
        battle_type,
        nat_type,
        &key,
        port,
        max_players,
        modhash,
        rank,
        maphash,
        &engine,
        &version,
        &map,
        &title,
        &modname,
    );
    enqueue(registry.inner(), &server_key, line)
}

/// `mp_add_bot` — add an AI bot. `battle_status` is the packed status integer.
#[tauri::command]
fn mp_add_bot(
    registry: State<'_, Registry>,
    server_key: String,
    name: String,
    battle_status: i32,
    color: u32,
    ai_dll: String,
) -> CliResult {
    let status = BattleStatus::from_int(battle_status);
    enqueue(
        registry.inner(),
        &server_key,
        command::add_bot(&name, status, color, &ai_dll),
    )
}

/// `mp_update_bot` — update a bot's status/color.
#[tauri::command]
fn mp_update_bot(
    registry: State<'_, Registry>,
    server_key: String,
    name: String,
    battle_status: i32,
    color: u32,
) -> CliResult {
    let status = BattleStatus::from_int(battle_status);
    enqueue(
        registry.inner(),
        &server_key,
        command::update_bot(&name, status, color),
    )
}

/// `mp_remove_bot` — remove a bot.
#[tauri::command]
fn mp_remove_bot(registry: State<'_, Registry>, server_key: String, name: String) -> CliResult {
    enqueue(registry.inner(), &server_key, command::remove_bot(&name))
}

/// `mp_force_team` — host: move a user to a team.
#[tauri::command]
fn mp_force_team(
    registry: State<'_, Registry>,
    server_key: String,
    username: String,
    team: u8,
) -> CliResult {
    enqueue(
        registry.inner(),
        &server_key,
        command::force_team_no(&username, team),
    )
}

/// `mp_force_ally` — host: move a user to an ally team.
#[tauri::command]
fn mp_force_ally(
    registry: State<'_, Registry>,
    server_key: String,
    username: String,
    ally: u8,
) -> CliResult {
    enqueue(
        registry.inner(),
        &server_key,
        command::force_ally_no(&username, ally),
    )
}

/// `mp_force_color` — host: set a user's team color.
#[tauri::command]
fn mp_force_color(
    registry: State<'_, Registry>,
    server_key: String,
    username: String,
    color: u32,
) -> CliResult {
    enqueue(
        registry.inner(),
        &server_key,
        command::force_team_color(&username, color),
    )
}

/// `mp_force_spectator` — host: force a user to spectate.
#[tauri::command]
fn mp_force_spectator(
    registry: State<'_, Registry>,
    server_key: String,
    username: String,
) -> CliResult {
    enqueue(
        registry.inner(),
        &server_key,
        command::force_spectator_mode(&username),
    )
}

/// `mp_kick` — host: kick a user from the battle.
#[tauri::command]
fn mp_kick(registry: State<'_, Registry>, server_key: String, username: String) -> CliResult {
    enqueue(
        registry.inner(),
        &server_key,
        command::kick_from_battle(&username),
    )
}

/// `mp_set_start_rect` — host: set an ally team's start rectangle.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
fn mp_set_start_rect(
    registry: State<'_, Registry>,
    server_key: String,
    ally: u8,
    left: i32,
    top: i32,
    right: i32,
    bottom: i32,
) -> CliResult {
    enqueue(
        registry.inner(),
        &server_key,
        command::add_start_rect(ally, left, top, right, bottom),
    )
}

/// `mp_set_script_tags` — host: set game script tags.
#[tauri::command]
fn mp_set_script_tags(
    registry: State<'_, Registry>,
    server_key: String,
    tags: BTreeMap<String, String>,
) -> CliResult {
    enqueue(
        registry.inner(),
        &server_key,
        command::set_script_tags(&tags),
    )
}

/// Map the connection's current battle into the `play` plugin's `BattleConfig`
/// JSON shape, so the frontend can pass it straight to `playLaunch` to join the
/// game. This targets the JOIN-a-battle client case (`isHost: false`), where the
/// engine reads only `myPlayerName`/`hostIp`/`hostPort`/`myPasswd` — the host
/// relays the real team/player layout over the wire.
///
/// TODO(host): the `teams`/`allyTeams`/`players[].team` we synthesize key off the
/// wire `team_id`/`ally` bitfields rather than positional engine indices, so they
/// are only a best-effort approximation and are not consumed on the join path. A
/// hosting-side mapping would need to renumber teams into a contiguous 0..N index
/// space.
fn battle_to_config(state: &LobbyState) -> Result<Value, String> {
    let bid = state.current_battle.ok_or("not currently in a battle")?;
    let battle = state
        .battles
        .get(&bid)
        .ok_or("current battle missing from state")?;
    let me = state
        .my_username
        .clone()
        .ok_or("not logged in (no username)")?;

    // Deterministic ordering so the output (and its test) is stable.
    let mut members: Vec<_> = battle.members.iter().collect();
    members.sort_by(|a, b| a.0.cmp(b.0));

    let mut players = Vec::new();
    let mut teams: BTreeMap<u8, Value> = BTreeMap::new();
    let mut allies: BTreeSet<u8> = BTreeSet::new();

    for (name, ms) in members {
        let bs = ms.battle_status;
        let is_player = bs.mode; // mode == true -> playing, false -> spectating
        let mut player = json!({ "name": name, "spectator": !is_player });
        if is_player {
            player["team"] = json!(bs.team_id);
            teams
                .entry(bs.team_id)
                .or_insert_with(|| team_value(bs.ally, ms.team_color));
            allies.insert(bs.ally);
        }
        players.push(player);
    }

    let mut bots: Vec<_> = battle.bots.iter().collect();
    bots.sort_by(|a, b| a.0.cmp(b.0));
    let mut ais = Vec::new();
    for (name, bot) in bots {
        let bs = bot.battle_status;
        ais.push(json!({
            "name": name,
            "shortName": bot.ai_dll,
            "team": bs.team_id,
            "host": 0,
        }));
        teams
            .entry(bs.team_id)
            .or_insert_with(|| team_value(bs.ally, bot.team_color));
        allies.insert(bs.ally);
    }

    let ally_teams: Vec<Value> = allies.iter().map(|_| json!({ "numAllies": 0 })).collect();
    let my_passwd = battle
        .members
        .get(&me)
        .and_then(|m| m.script_password.clone());

    Ok(json!({
        "mapName": battle.map,
        "gameType": battle.modname,
        "myPlayerName": me,
        "startPosType": 0,
        "players": players,
        "ais": ais,
        "teams": teams.into_values().collect::<Vec<_>>(),
        "allyTeams": ally_teams,
        "isHost": false,
        "hostIp": battle.ip,
        "hostPort": battle.port.parse::<u16>().ok(),
        "myPasswd": my_passwd,
    }))
}

/// One `teams[]` entry: RGB normalized to the engine's 0..1 floats.
fn team_value(ally: u8, color: u32) -> Value {
    let (r, g, b) = team_color_rgb(color);
    json!({
        "teamLeader": 0,
        "allyTeam": ally,
        "rgbColor": [r as f32 / 255.0, g as f32 / 255.0, b as f32 / 255.0],
    })
}

/// `mp_build_battle_config` — return the current battle as a `play` `BattleConfig`.
#[tauri::command]
fn mp_build_battle_config(registry: State<'_, Registry>, server_key: String) -> CliResult {
    let map = registry.lock().unwrap();
    match map.get(&server_key) {
        Some(conn) => {
            let state = conn.state.lock().unwrap();
            match battle_to_config(&state) {
                Ok(config) => CliResult::ok(json!({ "config": config })),
                Err(e) => CliResult::err(e),
            }
        }
        None => CliResult::err(format!("not connected: {server_key}")),
    }
}

/// Build the plugin. Registered as `"coilbox-multiplayer"`.
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("coilbox-multiplayer")
        .setup(|app, _api| {
            app.manage(Registry::default());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            mp_connect,
            mp_disconnect,
            mp_snapshot,
            mp_send,
            mp_say,
            mp_say_private,
            mp_join_channel,
            mp_leave_channel,
            mp_join_battle,
            mp_leave_battle,
            mp_set_status,
            mp_set_battle_status,
            mp_open_battle,
            mp_add_bot,
            mp_remove_bot,
            mp_update_bot,
            mp_force_team,
            mp_force_ally,
            mp_force_color,
            mp_force_spectator,
            mp_kick,
            mp_set_start_rect,
            mp_set_script_tags,
            mp_build_battle_config,
        ])
        .build()
}

#[cfg(test)]
mod tests {
    use super::*;
    use coilbox_lobby_protocol::{Battle, Bot, MemberStatus};

    /// A battle we've joined: us playing on team 0/ally 0 with a script password,
    /// plus one AI bot on team 1/ally 1.
    fn joined_state() -> LobbyState {
        let mut state = LobbyState::new();
        state.my_username = Some("me".into());

        let mut battle = Battle {
            id: 7,
            host: "hoster".into(),
            ip: "203.0.113.5".into(),
            port: "8452".into(),
            map: "Comet Catcher".into(),
            modname: "BAR test".into(),
            ..Default::default()
        };

        let me_status = MemberStatus {
            battle_status: BattleStatus {
                mode: true,
                team_id: 0,
                ally: 0,
                ..Default::default()
            },
            team_color: 0x0000FF, // pure red in 0xBBGGRR
            script_password: Some("sekret".into()),
        };
        battle.members.insert("me".into(), me_status);

        battle.bots.insert(
            "BARb".into(),
            Bot {
                name: "BARb".into(),
                owner: "me".into(),
                ai_dll: "BARb".into(),
                battle_status: BattleStatus {
                    mode: true,
                    team_id: 1,
                    ally: 1,
                    ..Default::default()
                },
                team_color: 0xFF0000, // pure blue in 0xBBGGRR
            },
        );

        state.battles.insert(7, battle);
        state.current_battle = Some(7);
        state
    }

    #[test]
    fn build_config_maps_join_case() {
        let cfg = battle_to_config(&joined_state()).unwrap();
        assert_eq!(cfg["mapName"], "Comet Catcher");
        assert_eq!(cfg["gameType"], "BAR test");
        assert_eq!(cfg["myPlayerName"], "me");
        assert_eq!(cfg["isHost"], false);
        assert_eq!(cfg["hostIp"], "203.0.113.5");
        assert_eq!(cfg["hostPort"], 8452);
        assert_eq!(cfg["myPasswd"], "sekret");

        // One human player (us), not spectating, on team 0.
        let players = cfg["players"].as_array().unwrap();
        assert_eq!(players.len(), 1);
        assert_eq!(players[0]["name"], "me");
        assert_eq!(players[0]["spectator"], false);
        assert_eq!(players[0]["team"], 0);

        // The bot becomes an AI on team 1.
        let ais = cfg["ais"].as_array().unwrap();
        assert_eq!(ais.len(), 1);
        assert_eq!(ais[0]["shortName"], "BARb");
        assert_eq!(ais[0]["team"], 1);

        // Two teams (0 and 1) and two ally teams (0 and 1).
        assert_eq!(cfg["teams"].as_array().unwrap().len(), 2);
        assert_eq!(cfg["allyTeams"].as_array().unwrap().len(), 2);

        // 0x0000FF (0xBBGGRR) is pure red -> rgb [1, 0, 0].
        let red = &cfg["teams"][0]["rgbColor"];
        assert_eq!(red[0], 1.0);
        assert_eq!(red[1], 0.0);
        assert_eq!(red[2], 0.0);
    }

    #[test]
    fn build_config_errors_when_not_in_battle() {
        let mut state = LobbyState::new();
        state.my_username = Some("me".into());
        assert!(battle_to_config(&state).is_err());
    }
}
