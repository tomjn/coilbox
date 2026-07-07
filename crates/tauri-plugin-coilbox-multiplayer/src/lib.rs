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
mod dmlog;
mod tls;

use std::collections::{BTreeMap, BTreeSet};
use std::sync::{Mutex, MutexGuard};

use coilbox_lobby_protocol::{
    command, default_battle_status, password_hash, team_color_rgb, BattleStatus, ClientStatus,
    LobbyState, LoginConfig, LoginMode,
};
use conn::{spawn_connection, LobbyEvent, Outbound, Registry};
use picoframe_core::CliResult;
use serde_json::{json, Value};
use tauri::{
    ipc::Channel,
    plugin::{Builder, TauriPlugin},
    Manager, Runtime, State,
};

/// Lock a mutex, recovering the guard if a previous holder panicked and poisoned
/// it. All 35 `mp_*` commands and the connection task share the registry/state/
/// sink/phase mutexes; a single panic while any is held would otherwise poison it,
/// and every later `.lock().unwrap()` would then panic too — bricking the whole
/// multiplayer surface until restart. The reducer/parser are panic-free today, so
/// this is defence-in-depth: recover the (possibly partially-updated) state in
/// place rather than cascade into a dead plugin.
pub(crate) fn lock_or_recover<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// Enqueue one raw wire line on a live connection. The shared body behind every
/// typed action command: look the connection up, push the line onto its writer
/// channel, and translate the two failure modes (unknown key / closed socket) into
/// a `CliResult` error.
fn enqueue(registry: &Registry, server_key: &str, line: String) -> CliResult {
    let map = lock_or_recover(registry);
    match map.get(server_key) {
        Some(conn) => match conn.tx.send(Outbound::Line(line)) {
            Ok(()) => CliResult::ok(json!({ "sent": true })),
            Err(_) => CliResult::err("connection is closed"),
        },
        None => CliResult::err(format!("not connected: {server_key}")),
    }
}

/// Record our intended battle status on the connection's state so the
/// `REQUESTBATTLESTATUS` auto-reply (in `conn.rs`) reflects it. Kept in sync with
/// every status push and seeded to player when we open a battle, so the server's
/// re-prompts can't revert us to the spectator default.
fn set_intended_battle_status(
    registry: &Registry,
    server_key: &str,
    status: BattleStatus,
    color: u32,
) {
    if let Some(conn) = lock_or_recover(registry).get(server_key) {
        lock_or_recover(&conn.state).my_intended_battle_status = Some((status, color));
    }
}

/// Open (and, for TLS servers, STLS-upgrade) the socket, then hand it to the
/// connection task which runs the login/registration handshake and streams events.
/// Shared by [`mp_connect`] and [`mp_register`], which differ only in `mode`.
/// Refuses a second connection under the same `server_key`. The password is hashed
/// here and never logged in plaintext (the outbound `LOGIN`/`REGISTER` console line
/// carries only the hash).
#[allow(clippy::too_many_arguments)]
async fn open_and_spawn<R: Runtime>(
    app: &tauri::AppHandle<R>,
    registry: &Registry,
    server_key: String,
    host: String,
    port: u16,
    tls: bool,
    allow_self_signed: bool,
    username: String,
    password: String,
    compat_flags: Vec<String>,
    mode: LoginMode,
    on_event: Channel<LobbyEvent>,
) -> CliResult {
    if lock_or_recover(registry).contains_key(&server_key) {
        return CliResult::err(format!("already connected: {server_key}"));
    }

    let dm_dir = match coilbox_portable::data_dir(app) {
        Ok(d) => d.join("coilbox").join("lobby-dms"),
        Err(e) => return CliResult::err(format!("no app data dir: {e}")),
    };
    let dm_log = dmlog::DmLog::new(&dm_dir, &server_key);

    let stream = match tls::connect_stream(&host, port, tls, allow_self_signed).await {
        Ok(s) => s,
        Err(e) => return CliResult::err(e),
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
        mode,
    };

    spawn_connection(
        registry.clone(),
        server_key,
        stream,
        login_cfg,
        on_event,
        dm_log,
    );
    CliResult::ok(json!({ "connected": true }))
}

/// `mp_connect` — open a lobby connection and run the login handshake.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
async fn mp_connect<R: Runtime>(
    app: tauri::AppHandle<R>,
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
    Ok(open_and_spawn(
        &app,
        registry.inner(),
        server_key,
        host,
        port,
        tls,
        allow_self_signed,
        username,
        password,
        compat_flags,
        LoginMode::Login,
        on_event,
    )
    .await)
}

/// `mp_register` — open a connection and register a new account (`REGISTER` instead
/// of `LOGIN`). Streams the same events; the frontend watches for the `registered`
/// phase (success) then disconnects, or a `disconnected` reason (denial). It does
/// NOT log in — the caller connects normally afterwards, which is when a
/// verification server issues its agreement/code challenge.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
async fn mp_register<R: Runtime>(
    app: tauri::AppHandle<R>,
    registry: State<'_, Registry>,
    server_key: String,
    host: String,
    port: u16,
    tls: bool,
    allow_self_signed: bool,
    username: String,
    password: String,
    email: Option<String>,
    compat_flags: Vec<String>,
    on_event: Channel<LobbyEvent>,
) -> Result<CliResult, ()> {
    Ok(open_and_spawn(
        &app,
        registry.inner(),
        server_key,
        host,
        port,
        tls,
        allow_self_signed,
        username,
        password,
        compat_flags,
        LoginMode::Register { email },
        on_event,
    )
    .await)
}

/// `mp_confirm_agreement` — resume a login parked awaiting the emailed verification
/// code. Drives the connection's login machine to send `CONFIRMAGREEMENT [code]`
/// and re-`LOGIN`. `code` is omitted for agreements that need no code.
#[tauri::command]
fn mp_confirm_agreement(
    registry: State<'_, Registry>,
    server_key: String,
    code: Option<String>,
) -> CliResult {
    let map = lock_or_recover(&registry);
    match map.get(&server_key) {
        Some(conn) => match conn.tx.send(Outbound::ConfirmAgreement { code }) {
            Ok(()) => CliResult::ok(json!({ "sent": true })),
            Err(_) => CliResult::err("connection is closed"),
        },
        None => CliResult::err(format!("not connected: {server_key}")),
    }
}

/// `mp_disconnect` — request a graceful logout: the connection task writes `EXIT`,
/// flushes it, and exits (self-evicting). Evicting from the registry here as well
/// makes it idempotent; the queued `Shutdown` still reaches the task's receiver.
#[tauri::command]
fn mp_disconnect(registry: State<'_, Registry>, server_key: String) -> CliResult {
    let conn = lock_or_recover(&registry).remove(&server_key);
    match conn {
        Some(conn) => {
            let _ = conn.tx.send(Outbound::Shutdown);
            CliResult::ok(json!({ "disconnected": true }))
        }
        None => CliResult::ok(json!({ "disconnected": false })),
    }
}

/// `mp_reattach` — after a webview reload the connect `Channel` is dead but the
/// connection task keeps running. Swap in the fresh `Channel` and replay
/// `Connected` + the current login phase so the frontend can re-adopt the live
/// connection (it then pulls a snapshot to refill its mirror).
#[tauri::command]
fn mp_reattach(
    registry: State<'_, Registry>,
    server_key: String,
    on_event: Channel<LobbyEvent>,
) -> CliResult {
    let map = lock_or_recover(&registry);
    match map.get(&server_key) {
        Some(conn) => {
            *lock_or_recover(&conn.sink) = on_event.clone();
            let _ = on_event.send(LobbyEvent::Connected);
            let phase = *lock_or_recover(&conn.phase);
            let _ = on_event.send(LobbyEvent::Phase { phase });
            CliResult::ok(json!({ "reattached": true }))
        }
        None => CliResult::err(format!("not connected: {server_key}")),
    }
}

/// `mp_active_keys` — the server keys of all live connections, so the frontend can
/// discover and re-adopt one after a reload.
#[tauri::command]
fn mp_active_keys(registry: State<'_, Registry>) -> CliResult {
    let keys: Vec<String> = lock_or_recover(&registry).keys().cloned().collect();
    CliResult::ok(json!({ "keys": keys }))
}

/// `mp_snapshot` — clone and return the authoritative state for one connection so
/// the frontend can seed or resync its mirror.
#[tauri::command]
fn mp_snapshot(registry: State<'_, Registry>, server_key: String) -> CliResult {
    let map = lock_or_recover(&registry);
    match map.get(&server_key) {
        Some(conn) => {
            let state = lock_or_recover(&conn.state).clone();
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

/// `mp_say_private` - direct message to a user. Posts a typed `SayPrivate` so the
/// connection task records it into DM state, persists it, and emits a delta before
/// sending the wire line (the server does not echo SAYPRIVATE).
#[tauri::command]
fn mp_say_private(
    registry: State<'_, Registry>,
    server_key: String,
    username: String,
    message: String,
) -> CliResult {
    let map = lock_or_recover(&registry);
    match map.get(&server_key) {
        Some(conn) => match conn.tx.send(Outbound::SayPrivate {
            peer: username,
            text: message,
        }) {
            Ok(()) => CliResult::ok(json!({ "sent": true })),
            Err(_) => CliResult::err("connection is closed"),
        },
        None => CliResult::err(format!("not connected: {server_key}")),
    }
}

/// `mp_say_battle` — chat to the current battle via `SAYBATTLE`. Battle chat is
/// not a channel (no channel argument); the server echoes it back as `SAIDBATTLE`,
/// which the reducer parks in the battle's synthetic `__battle__<id>` bucket.
#[tauri::command]
fn mp_say_battle(registry: State<'_, Registry>, server_key: String, message: String) -> CliResult {
    enqueue(registry.inner(), &server_key, command::say_battle(&message))
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

/// `mp_list_channels` - clear the cached directory and request the server's public
/// channel list (`CHANNELS`); the reply streams as `CHANNEL...ENDOFCHANNELS`.
#[tauri::command]
fn mp_list_channels(registry: State<'_, Registry>, server_key: String) -> CliResult {
    if let Some(conn) = lock_or_recover(&registry).get(&server_key) {
        coilbox_lobby_protocol::begin_channel_list(&mut lock_or_recover(&conn.state));
    }
    enqueue(registry.inner(), &server_key, command::list_channels())
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
    set_intended_battle_status(registry.inner(), &server_key, status, color);
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
    // Seat the host as a player by default (protocol default is spectator). The
    // frontend's colour/sync/spectate pushes then refine this via mp_set_battle_status.
    let seat = BattleStatus {
        mode: true,
        ..default_battle_status()
    };
    set_intended_battle_status(registry.inner(), &server_key, seat, 0);
    enqueue(registry.inner(), &server_key, line)
}

/// `mp_update_battle_info` — host: change the open battle's map, lock flag, and
/// advertised spectator count via `UPDATEBATTLEINFO`. The four fields travel
/// together, so callers resend the current values for whichever they aren't
/// changing (the frontend `setMap`/`setLocked` helpers do this). The server
/// echoes the change back as `UPDATEBATTLEINFO`, which the reducer applies (and
/// turns into a system chat notice).
#[tauri::command]
fn mp_update_battle_info(
    registry: State<'_, Registry>,
    server_key: String,
    spectators: u32,
    locked: bool,
    maphash: i32,
    map: String,
) -> CliResult {
    enqueue(
        registry.inner(),
        &server_key,
        command::update_battle_info(spectators, locked, maphash, &map),
    )
}

/// `mp_join_battle_deny` — host: reject a pending join request (`JOINBATTLEDENY`).
#[tauri::command]
fn mp_join_battle_deny(
    registry: State<'_, Registry>,
    server_key: String,
    username: String,
    reason: Option<String>,
) -> CliResult {
    enqueue(
        registry.inner(),
        &server_key,
        command::join_battle_deny(&username, reason.as_deref()),
    )
}

/// `mp_add_bot` — add an AI bot. Takes decoded battle-status fields (packed here,
/// the single source of truth) mirroring `mp_set_battle_status`.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
fn mp_add_bot(
    registry: State<'_, Registry>,
    server_key: String,
    name: String,
    ready: bool,
    team_id: u8,
    ally: u8,
    mode: bool,
    handicap: u8,
    sync: u8,
    side: u8,
    color: u32,
    ai_dll: String,
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
        command::add_bot(&name, status, color, &ai_dll),
    )
}

/// `mp_update_bot` — update a bot's status/color (decoded fields, as `mp_add_bot`).
#[tauri::command]
#[allow(clippy::too_many_arguments)]
fn mp_update_bot(
    registry: State<'_, Registry>,
    server_key: String,
    name: String,
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

/// `mp_remove_start_rect` — host: clear an ally team's start rectangle.
#[tauri::command]
fn mp_remove_start_rect(registry: State<'_, Registry>, server_key: String, ally: u8) -> CliResult {
    enqueue(
        registry.inner(),
        &server_key,
        command::remove_start_rect(ally),
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

/// `mp_remove_script_tags` — host: clear game script tags by key.
#[tauri::command]
fn mp_remove_script_tags(
    registry: State<'_, Registry>,
    server_key: String,
    tags: Vec<String>,
) -> CliResult {
    let refs: Vec<&str> = tags.iter().map(String::as_str).collect();
    enqueue(
        registry.inner(),
        &server_key,
        command::remove_script_tags(&refs),
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
/// Split a battle's opaque `script_tags` into the engine option maps the `play`
/// `BattleConfig` consumes. Keys are matched case-insensitively (SPADS lowercases
/// tag paths, but the engine is case-insensitive): `game/startpostype`,
/// `game/modoptions/<k>`, `game/mapoptions/<k>`. Anything else is ignored.
fn split_script_tags(
    tags: &BTreeMap<String, String>,
) -> (u8, BTreeMap<String, String>, BTreeMap<String, String>) {
    const MOD: &str = "game/modoptions/";
    const MAP: &str = "game/mapoptions/";
    let mut start_pos_type = 0u8;
    let mut mod_opts = BTreeMap::new();
    let mut map_opts = BTreeMap::new();
    for (k, v) in tags {
        let lk = k.to_ascii_lowercase();
        if lk == "game/startpostype" {
            start_pos_type = v.trim().parse().unwrap_or(0);
        } else if let Some(name) = lk.strip_prefix(MOD) {
            mod_opts.insert(name.to_string(), v.clone());
        } else if let Some(name) = lk.strip_prefix(MAP) {
            map_opts.insert(name.to_string(), v.clone());
        }
    }
    (start_pos_type, mod_opts, map_opts)
}

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

    let (start_pos_type, mod_options, map_options) = split_script_tags(&battle.script_tags);

    let ally_teams: Vec<Value> = allies.iter().map(|_| json!({ "numAllies": 0 })).collect();
    let my_passwd = battle
        .members
        .get(&me)
        .and_then(|m| m.script_password.clone());

    Ok(json!({
        "mapName": battle.map,
        "gameType": battle.modname,
        "myPlayerName": me,
        "startPosType": start_pos_type,
        "modOptions": mod_options,
        "mapOptions": map_options,
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

/// Map the current battle into a HOST-mode `BattleConfig` (`isHost:true`), binding
/// the engine to our assigned `HOSTPORT`. Unlike the join builder this renumbers the
/// wire `team_id`/`ally` bitfields into the contiguous 0..N index space the engine's
/// positional `[TEAMn]`/`[ALLYTEAMn]` blocks require (see `TODO(host)` above), so
/// `players[].team` indexes the `teams[]` array directly.
fn battle_to_host_config(state: &LobbyState) -> Result<Value, String> {
    let bid = state.current_battle.ok_or("not currently in a battle")?;
    let battle = state
        .battles
        .get(&bid)
        .ok_or("current battle missing from state")?;
    let me = state
        .my_username
        .clone()
        .ok_or("not logged in (no username)")?;
    if battle.host != me {
        return Err("not the host of this battle".into());
    }

    // Deterministic ordering so the output (and its test) is stable.
    let mut members: Vec<_> = battle.members.iter().collect();
    members.sort_by(|a, b| a.0.cmp(b.0));
    let mut bots: Vec<_> = battle.bots.iter().collect();
    bots.sort_by(|a, b| a.0.cmp(b.0));

    // The distinct wire team ids + ally numbers actually in play, each mapped to a
    // contiguous engine index (BTreeSet keeps the mapping stable + gap-free).
    let mut team_ids: BTreeSet<u8> = BTreeSet::new();
    let mut ally_ids: BTreeSet<u8> = BTreeSet::new();
    for (_, ms) in &members {
        if ms.battle_status.mode {
            team_ids.insert(ms.battle_status.team_id);
            ally_ids.insert(ms.battle_status.ally);
        }
    }
    for (_, bot) in &bots {
        team_ids.insert(bot.battle_status.team_id);
        ally_ids.insert(bot.battle_status.ally);
    }
    let team_index: BTreeMap<u8, usize> =
        team_ids.iter().enumerate().map(|(i, t)| (*t, i)).collect();
    let ally_index: BTreeMap<u8, usize> =
        ally_ids.iter().enumerate().map(|(i, a)| (*a, i)).collect();

    let mut teams: BTreeMap<usize, Value> = BTreeMap::new();
    let mut players = Vec::new();
    for (name, ms) in &members {
        let bs = ms.battle_status;
        let mut player = json!({ "name": name, "spectator": !bs.mode });
        if bs.mode {
            let pos = team_index[&bs.team_id];
            player["team"] = json!(pos);
            teams
                .entry(pos)
                .or_insert_with(|| host_team_value(ally_index[&bs.ally], ms.team_color));
        }
        players.push(player);
    }

    let mut ais = Vec::new();
    for (name, bot) in &bots {
        let bs = bot.battle_status;
        let pos = team_index[&bs.team_id];
        ais.push(json!({
            "name": name,
            "shortName": bot.ai_dll,
            "team": pos,
            "host": 0,
        }));
        teams
            .entry(pos)
            .or_insert_with(|| host_team_value(ally_index[&bs.ally], bot.team_color));
    }

    let (start_pos_type, mod_options, map_options) = split_script_tags(&battle.script_tags);

    // One [ALLYTEAM] per distinct ally, in contiguous order, carrying its start box
    // (converted from the 0..200 wire grid to the engine's 0..1
    // `[top, left, bottom, right]`).
    let ally_teams: Vec<Value> = ally_ids
        .iter()
        .map(|raw| {
            let mut v = json!({ "numAllies": 0 });
            if let Some(r) = battle.start_rects.get(raw) {
                v["startRect"] = json!([
                    r.top as f32 / 200.0,
                    r.left as f32 / 200.0,
                    r.bottom as f32 / 200.0,
                    r.right as f32 / 200.0,
                ]);
            }
            v
        })
        .collect();

    Ok(json!({
        "mapName": battle.map,
        "gameType": battle.modname,
        "myPlayerName": me,
        "startPosType": start_pos_type,
        "modOptions": mod_options,
        "mapOptions": map_options,
        "players": players,
        "ais": ais,
        "teams": teams.into_values().collect::<Vec<_>>(),
        "allyTeams": ally_teams,
        "isHost": true,
        "hostIp": "0.0.0.0",
        "hostPort": state.host_port.or_else(|| battle.port.parse::<u16>().ok()),
    }))
}

/// One host-mode `teams[]` entry, with an already-renumbered ally index.
fn host_team_value(ally: usize, color: u32) -> Value {
    let (r, g, b) = team_color_rgb(color);
    json!({
        "teamLeader": 0,
        "allyTeam": ally,
        "rgbColor": [r as f32 / 255.0, g as f32 / 255.0, b as f32 / 255.0],
    })
}

/// `mp_build_host_config` — return the current (hosted) battle as a host-mode
/// `play` `BattleConfig`.
#[tauri::command]
fn mp_build_host_config(registry: State<'_, Registry>, server_key: String) -> CliResult {
    let map = lock_or_recover(&registry);
    match map.get(&server_key) {
        Some(conn) => {
            let state = lock_or_recover(&conn.state);
            match battle_to_host_config(&state) {
                Ok(config) => CliResult::ok(json!({ "config": config })),
                Err(e) => CliResult::err(e),
            }
        }
        None => CliResult::err(format!("not connected: {server_key}")),
    }
}

/// `mp_build_battle_config` — return the current battle as a `play` `BattleConfig`.
#[tauri::command]
fn mp_build_battle_config(registry: State<'_, Registry>, server_key: String) -> CliResult {
    let map = lock_or_recover(&registry);
    match map.get(&server_key) {
        Some(conn) => {
            let state = lock_or_recover(&conn.state);
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
            mp_register,
            mp_confirm_agreement,
            mp_disconnect,
            mp_reattach,
            mp_active_keys,
            mp_snapshot,
            mp_send,
            mp_say,
            mp_say_private,
            mp_say_battle,
            mp_join_channel,
            mp_leave_channel,
            mp_list_channels,
            mp_join_battle,
            mp_join_battle_deny,
            mp_leave_battle,
            mp_set_status,
            mp_set_battle_status,
            mp_open_battle,
            mp_update_battle_info,
            mp_add_bot,
            mp_remove_bot,
            mp_update_bot,
            mp_force_team,
            mp_force_ally,
            mp_force_color,
            mp_force_spectator,
            mp_kick,
            mp_set_start_rect,
            mp_remove_start_rect,
            mp_set_script_tags,
            mp_remove_script_tags,
            mp_build_battle_config,
            mp_build_host_config,
        ])
        .build()
}

#[cfg(test)]
mod tests {
    use super::*;
    use coilbox_lobby_protocol::{Battle, Bot, MemberStatus, StartRect};
    use std::sync::Arc;

    #[test]
    fn lock_or_recover_survives_poison() {
        let m = Arc::new(Mutex::new(0u32));
        let m2 = m.clone();
        // Poison the mutex by panicking while holding the guard.
        let panicked = std::thread::spawn(move || {
            let _g = m2.lock().unwrap();
            panic!("poison the lock");
        })
        .join();
        assert!(panicked.is_err(), "the holder thread panicked");
        assert!(m.lock().is_err(), "mutex is now poisoned");

        // The plain unwrap would panic here; lock_or_recover yields a usable guard.
        let mut g = lock_or_recover(&m);
        *g += 1;
        assert_eq!(*g, 1, "recovered state is usable and mutable");
    }

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

        battle
            .script_tags
            .insert("game/startpostype".into(), "2".into());
        battle
            .script_tags
            .insert("game/modoptions/maxunits".into(), "2000".into());
        battle
            .script_tags
            .insert("game/mapoptions/waterlevel".into(), "-50".into());

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
    fn build_config_maps_script_tags_to_options() {
        let cfg = battle_to_config(&joined_state()).unwrap();
        assert_eq!(cfg["startPosType"], 2);
        assert_eq!(cfg["modOptions"]["maxunits"], "2000");
        assert_eq!(cfg["mapOptions"]["waterlevel"], "-50");
    }

    #[test]
    fn build_config_errors_when_not_in_battle() {
        let mut state = LobbyState::new();
        state.my_username = Some("me".into());
        assert!(battle_to_config(&state).is_err());
    }

    /// A battle WE host, with deliberately non-contiguous wire team ids/allies so the
    /// renumbering is actually exercised: us (team 3/ally 5), an ally (team 7/ally 5),
    /// a spectator, and a bot (team 2/ally 9). `HOSTPORT` is 8452.
    fn hosted_state() -> LobbyState {
        let mut state = LobbyState::new();
        state.my_username = Some("me".into());
        state.host_port = Some(8452);

        let mut battle = Battle {
            id: 9,
            host: "me".into(),
            port: "0".into(),
            map: "Comet Catcher".into(),
            modname: "BAR test".into(),
            ..Default::default()
        };
        let player = |team_id, ally, color| MemberStatus {
            battle_status: BattleStatus {
                mode: true,
                team_id,
                ally,
                ..Default::default()
            },
            team_color: color,
            script_password: None,
        };
        battle.members.insert("me".into(), player(3, 5, 0x0000FF));
        battle.members.insert("ally".into(), player(7, 5, 0x00FF00));
        battle.members.insert(
            "spec".into(),
            MemberStatus {
                battle_status: BattleStatus {
                    mode: false,
                    ..Default::default()
                },
                team_color: 0,
                script_password: None,
            },
        );
        battle.bots.insert(
            "BARb".into(),
            Bot {
                name: "BARb".into(),
                owner: "me".into(),
                ai_dll: "BARb".into(),
                battle_status: BattleStatus {
                    mode: true,
                    team_id: 2,
                    ally: 9,
                    ..Default::default()
                },
                team_color: 0xFF0000,
            },
        );
        battle.start_rects.insert(
            5,
            StartRect {
                left: 0,
                top: 0,
                right: 100,
                bottom: 200,
            },
        );
        battle.start_rects.insert(
            9,
            StartRect {
                left: 100,
                top: 0,
                right: 200,
                bottom: 200,
            },
        );

        state.battles.insert(9, battle);
        state.current_battle = Some(9);
        state
    }

    #[test]
    fn host_config_is_host_and_binds_hostport() {
        let cfg = battle_to_host_config(&hosted_state()).unwrap();
        assert_eq!(cfg["isHost"], true);
        assert_eq!(cfg["hostIp"], "0.0.0.0");
        assert_eq!(cfg["hostPort"], 8452);
        assert_eq!(cfg["myPlayerName"], "me");
        // Host scripts carry no client script password.
        assert!(cfg.get("myPasswd").is_none());
    }

    #[test]
    fn host_config_renumbers_teams_and_allies_contiguously() {
        let cfg = battle_to_host_config(&hosted_state()).unwrap();

        // Wire teams {2,3,7} -> positions {0,1,2}; wire allies {5,9} -> {0,1}.
        let teams = cfg["teams"].as_array().unwrap();
        assert_eq!(teams.len(), 3);
        let ally_teams = cfg["allyTeams"].as_array().unwrap();
        assert_eq!(ally_teams.len(), 2);

        // Players (sorted by name): ally, me, spec. `me` (wire team 3) -> pos 1;
        // `ally` (wire team 7) -> pos 2; `spec` spectates (no team).
        let players = cfg["players"].as_array().unwrap();
        let by_name = |n: &str| players.iter().find(|p| p["name"] == n).unwrap();
        assert_eq!(by_name("me")["team"], 1);
        assert_eq!(by_name("ally")["team"], 2);
        assert_eq!(by_name("spec")["spectator"], true);
        assert!(by_name("spec").get("team").is_none());

        // The bot (wire team 2) renumbers to position 0.
        assert_eq!(cfg["ais"][0]["team"], 0);

        // Each team references a contiguous ally index (0 or 1): pos 0 = bot's
        // ally 9 -> 1; pos 1 = our ally 5 -> 0.
        assert_eq!(teams[0]["allyTeam"], 1);
        assert_eq!(teams[1]["allyTeam"], 0);
    }

    #[test]
    fn host_config_converts_start_rects_to_unit_grid() {
        let cfg = battle_to_host_config(&hosted_state()).unwrap();
        // Ally 5 -> index 0: rect (l0,t0,r100,b200) -> [top,left,bottom,right] in 0..1.
        let rect = &cfg["allyTeams"][0]["startRect"];
        assert_eq!(rect[0], 0.0); // top
        assert_eq!(rect[1], 0.0); // left
        assert_eq!(rect[2], 1.0); // bottom (200/200)
        assert_eq!(rect[3], 0.5); // right (100/200)
    }

    #[test]
    fn host_config_errors_when_not_the_host() {
        // The join fixture is founded by "hoster", not us.
        assert!(battle_to_host_config(&joined_state()).is_err());
    }
}
