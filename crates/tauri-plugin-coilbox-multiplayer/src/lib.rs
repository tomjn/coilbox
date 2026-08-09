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
mod probe;
/// The OAuth browser sign-in that produces a Tachyon bearer token.
pub mod tachyon_auth;
mod tachyon_conn;
/// The console drawer's send path, the one place a request is sent by hand.
mod tachyon_debug;
mod tachyon_lobbies;
/// The lobby we are in, held as Tachyon describes it and projected into the
/// battle room.
mod tachyon_room;
/// Matching Tachyon responses to requests, over the transport below.
pub mod tachyon_rpc;
/// A whole Tachyon session through parse and reduce, asserting the state it
/// builds. The counterpart of the line protocol's `login_transcript` test.
#[cfg(test)]
mod tachyon_transcript;
mod tachyon_users;
/// The WebSocket transport for the newer Tachyon protocol, built alongside the
/// line protocol above.
pub mod tachyon_ws;
mod tls;

use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::Duration;

use coilbox_lobby_protocol::{
    command, default_battle_status, password_hash, team_color_rgb, BattleStatus, ClientStatus,
    LobbyState, LoginConfig, LoginMode, LoginPhase,
};
use conn::{spawn_connection, LobbyEvent, Outbound, Registry, TachyonAction};
use picoframe_core::CliResult;
use serde_json::{json, Value};
use tachyon_room::RoomAction;
use tauri::{
    ipc::Channel,
    plugin::{Builder, TauriPlugin},
    Manager, Runtime, State,
};
use tls::ConnectError;
use tokio_util::sync::CancellationToken;

/// Hard ceiling on a single connect attempt (TCP + STLS + TLS handshake). A stuck
/// server otherwise leaves the UI parked on "Connecting…" indefinitely; past this
/// the attempt self-aborts even if the user never hits Cancel.
const CONNECT_TIMEOUT: Duration = Duration::from_secs(30);

/// Cancellation tokens for connects still in their TCP/TLS handshake, so not yet in
/// the live [`Registry`]. Keyed by the same `serverKey`. [`open_and_spawn`] inserts
/// one on entry and removes it once the handshake resolves; `mp_cancel_connect`
/// fires it to abandon a stuck connect that `mp_disconnect` can't reach yet.
pub(crate) type PendingConnects = Arc<Mutex<HashMap<String, CancellationToken>>>;

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

/// The two lobby chat-log directories under the app data dir: DM history and
/// channel history. Both hold one `<sanitized serverKey>.jsonl` per account.
fn log_dirs<R: Runtime>(
    app: &tauri::AppHandle<R>,
) -> Result<(std::path::PathBuf, std::path::PathBuf), String> {
    let base = coilbox_portable::data_dir(app)?.join("coilbox");
    Ok((base.join("lobby-dms"), base.join("lobby-channels")))
}

/// Enqueue one raw wire line on a live connection. The shared body behind every
/// typed action command: look the connection up, push the line onto its writer
/// channel, and translate the failure modes (embedded line break / unknown key /
/// closed socket) into a `CliResult` error.
///
/// The break check lives here rather than in each builder because this is the one
/// path every command's arguments take to the socket, and the writer appends the
/// delimiter without looking at the payload (see `command::is_wire_safe`).
fn enqueue(registry: &Registry, server_key: &str, line: String) -> CliResult {
    if !command::is_wire_safe(&line) {
        return CliResult::err("refusing to send a line containing a line break");
    }
    let map = lock_or_recover(registry);
    match map.get(server_key) {
        Some(conn) => match conn.tx.send(Outbound::Line(line)) {
            Ok(()) => CliResult::ok(json!({ "sent": true })),
            Err(_) => CliResult::err("connection is closed"),
        },
        None => CliResult::err(format!("not connected: {server_key}")),
    }
}

/// Queue a lobby action on a Tachyon connection, or `None` when this connection
/// is not one and the caller should send its TASServer line instead.
///
/// Having a request client is what makes a connection a Tachyon one, which is
/// the same test `mp_tachyon_request` makes.
fn tachyon_action(
    registry: &Registry,
    server_key: &str,
    action: TachyonAction,
) -> Option<CliResult> {
    let map = lock_or_recover(registry);
    let conn = map.get(server_key)?;
    lock_or_recover(&conn.tachyon).as_ref()?;
    Some(match conn.tx.send(Outbound::Tachyon(action)) {
        Ok(()) => CliResult::ok(json!({ "sent": true })),
        Err(_) => CliResult::err("connection is closed"),
    })
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
    pending: &PendingConnects,
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

    let (dm_dir, chan_dir) = match log_dirs(app) {
        Ok(dirs) => dirs,
        Err(e) => return CliResult::err(format!("no app data dir: {e}")),
    };
    let dm_log = dmlog::DmLog::new(&dm_dir, &server_key);
    let chan_log = dmlog::DmLog::new(&chan_dir, &server_key);

    // Publish a cancel token before the (potentially stalling) handshake so
    // `mp_cancel_connect` can abort it, and always retract it once the connect
    // resolves — success, failure, timeout, or cancel — so a later reconnect under
    // the same key starts clean. A pre-existing entry means a connect is already in
    // flight for this key; refuse rather than clobber its token.
    let token = CancellationToken::new();
    {
        let mut map = lock_or_recover(pending);
        if map.contains_key(&server_key) {
            return CliResult::err(format!("already connecting: {server_key}"));
        }
        map.insert(server_key.clone(), token.clone());
    }
    let result = tls::connect_stream_cancellable(
        &host,
        port,
        tls,
        allow_self_signed,
        CONNECT_TIMEOUT,
        &token,
    )
    .await;
    lock_or_recover(pending).remove(&server_key);
    let stream = match result {
        Ok(s) => s,
        Err(ConnectError::Cancelled) => return CliResult::err("connection cancelled"),
        Err(ConnectError::TimedOut) => {
            return CliResult::err(format!(
                "connection timed out after {}s",
                CONNECT_TIMEOUT.as_secs()
            ))
        }
        Err(ConnectError::Failed(e)) => return CliResult::err(e),
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
        chan_log,
    );
    CliResult::ok(json!({ "connected": true }))
}

/// `mp_connect` — open a lobby connection and run the login handshake.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
async fn mp_connect<R: Runtime>(
    app: tauri::AppHandle<R>,
    registry: State<'_, Registry>,
    pending: State<'_, PendingConnects>,
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
        pending.inner(),
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
    pending: State<'_, PendingConnects>,
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
        pending.inner(),
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

/// `mp_connect_tachyon`: open a lobby connection to a Tachyon server.
///
/// The counterpart to [`mp_connect`], and deliberately a separate command. There is
/// no password, no compatibility flags and no handshake to run, and the credential
/// never crosses this boundary in either direction: it is a bearer token, held on
/// the Rust side, presented as an HTTP header on the upgrade.
///
/// Two phases go out over `on_event` before the connection exists, so the UI can
/// say which part is slow: getting a token, then opening the socket. A connection
/// that opens at all is already authenticated, so it starts at `ready`.
///
/// The user has to have signed in through the browser first (`mp_tachyon_sign_in`).
/// This only ever refreshes the token that sign-in stored, so a reconnect never
/// opens a browser.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
async fn mp_connect_tachyon(
    registry: State<'_, Registry>,
    pending: State<'_, PendingConnects>,
    server_key: String,
    host: String,
    port: u16,
    tls: bool,
    server_id: String,
    username: String,
    on_event: Channel<LobbyEvent>,
) -> Result<CliResult, ()> {
    if lock_or_recover(&registry).contains_key(&server_key) {
        return Ok(CliResult::err(format!("already connected: {server_key}")));
    }
    let (base_url, ws_url) = tachyon_conn::urls(&host, port, tls);

    // The same cancel token the line protocol publishes, so `mp_cancel_connect`
    // reaches a Tachyon connect that is still opening.
    let token = CancellationToken::new();
    {
        let mut map = lock_or_recover(&pending);
        if map.contains_key(&server_key) {
            return Ok(CliResult::err(format!("already connecting: {server_key}")));
        }
        map.insert(server_key.clone(), token.clone());
    }
    let phase = |phase| {
        let _ = on_event.send(LobbyEvent::Phase {
            phase,
            agreement: None,
        });
    };

    phase(LoginPhase::TachyonAuthorizing);
    let access = match tachyon_auth::access_token(&base_url, &server_id, &username).await {
        Ok(token) => token,
        Err(e) => {
            lock_or_recover(&pending).remove(&server_key);
            return Ok(CliResult::err(e.to_string()));
        }
    };

    phase(LoginPhase::TachyonOpening);
    let opened = tachyon_ws::connect(&ws_url, &access, CONNECT_TIMEOUT, &token).await;
    lock_or_recover(&pending).remove(&server_key);
    let socket = match opened {
        Ok(socket) => socket,
        Err(e) => return Ok(CliResult::err(e.to_string())),
    };

    tachyon_conn::spawn_connection(registry.inner().clone(), server_key, socket, on_event);
    Ok(CliResult::ok(json!({ "connected": true })))
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

/// `mp_cancel_connect` — abort a connect that is still mid-handshake (before it
/// registers as a live connection, which is when `mp_disconnect` takes over). Fires
/// the pending cancel token; `open_and_spawn` then unwinds with "connection
/// cancelled" and never spawns a task, leaving no lingering socket. Idempotent: a
/// no-op if the connect already completed or was already cancelled.
#[tauri::command]
fn mp_cancel_connect(pending: State<'_, PendingConnects>, server_key: String) -> CliResult {
    match lock_or_recover(&pending).remove(&server_key) {
        Some(token) => {
            token.cancel();
            CliResult::ok(json!({ "cancelled": true }))
        }
        None => CliResult::ok(json!({ "cancelled": false })),
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
            let agreement = lock_or_recover(&conn.agreement).clone();
            let _ = on_event.send(LobbyEvent::Phase { phase, agreement });
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

/// `mp_say_ex` — a channel action / `/me` via `SAYEX`. The server echoes `SAIDEX`,
/// so (like `mp_say`) we just enqueue the wire line and let the echo render it.
#[tauri::command]
fn mp_say_ex(
    registry: State<'_, Registry>,
    server_key: String,
    channel: String,
    message: String,
) -> CliResult {
    enqueue(
        registry.inner(),
        &server_key,
        command::say_ex(&channel, &message),
    )
}

/// `mp_say_battle_ex` — a battle-chat action / `/me` via `SAYBATTLEEX`. Echoed back
/// as `SAIDBATTLEEX`, like `mp_say_battle`.
#[tauri::command]
fn mp_say_battle_ex(
    registry: State<'_, Registry>,
    server_key: String,
    message: String,
) -> CliResult {
    enqueue(
        registry.inner(),
        &server_key,
        command::say_battle_ex(&message),
    )
}

/// `mp_say_private_ex` — a private action / `/me` via `SAYPRIVATEEX`. Posts a typed
/// `SayPrivateEx` so the connection task records the local emote copy and emits a
/// delta before sending (the server does not echo it back to us in a parsed form).
#[tauri::command]
fn mp_say_private_ex(
    registry: State<'_, Registry>,
    server_key: String,
    username: String,
    message: String,
) -> CliResult {
    let map = lock_or_recover(&registry);
    match map.get(&server_key) {
        Some(conn) => match conn.tx.send(Outbound::SayPrivateEx {
            peer: username,
            text: message,
        }) {
            Ok(()) => CliResult::ok(json!({ "sent": true })),
            Err(_) => CliResult::err("connection is closed"),
        },
        None => CliResult::err(format!("not connected: {server_key}")),
    }
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

/// `mp_ignore` — ask the server to ignore a user (`IGNORE`), so it stops relaying
/// their chat/rings to us. Best-effort: servers without ignore support drop it and
/// the client's local hiding still applies.
#[tauri::command]
fn mp_ignore(
    registry: State<'_, Registry>,
    server_key: String,
    username: String,
    reason: Option<String>,
) -> CliResult {
    enqueue(
        registry.inner(),
        &server_key,
        command::ignore(&username, reason.as_deref()),
    )
}

/// `mp_unignore` — ask the server to stop ignoring a user (`UNIGNORE`).
#[tauri::command]
fn mp_unignore(registry: State<'_, Registry>, server_key: String, username: String) -> CliResult {
    enqueue(registry.inner(), &server_key, command::unignore(&username))
}

/// `mp_ignore_list` — request the server's stored ignore list (`IGNORELIST`); the
/// reply streams as `IGNORELISTBEGIN...IGNORELISTEND` and rebuilds `server_ignores`.
#[tauri::command]
fn mp_ignore_list(registry: State<'_, Registry>, server_key: String) -> CliResult {
    enqueue(registry.inner(), &server_key, command::ignore_list())
}

/// `mp_friend_request` — send a friend request (optional message).
#[tauri::command]
fn mp_friend_request(
    registry: State<'_, Registry>,
    server_key: String,
    username: String,
    message: Option<String>,
) -> CliResult {
    enqueue(
        registry.inner(),
        &server_key,
        command::friend_request(&username, message.as_deref()),
    )
}

/// `mp_accept_friend_request` — accept an incoming friend request.
#[tauri::command]
fn mp_accept_friend_request(
    registry: State<'_, Registry>,
    server_key: String,
    username: String,
) -> CliResult {
    enqueue(
        registry.inner(),
        &server_key,
        command::accept_friend_request(&username),
    )
}

/// `mp_decline_friend_request` — decline an incoming friend request.
#[tauri::command]
fn mp_decline_friend_request(
    registry: State<'_, Registry>,
    server_key: String,
    username: String,
) -> CliResult {
    enqueue(
        registry.inner(),
        &server_key,
        command::decline_friend_request(&username),
    )
}

/// `mp_unfriend` — remove an existing friendship.
#[tauri::command]
fn mp_unfriend(registry: State<'_, Registry>, server_key: String, username: String) -> CliResult {
    enqueue(registry.inner(), &server_key, command::unfriend(&username))
}

/// `mp_friend_list` — request the mutual-friend list (streams
/// `FRIENDLISTBEGIN..FRIENDLISTEND`). No-ops on servers without friend support.
#[tauri::command]
fn mp_friend_list(registry: State<'_, Registry>, server_key: String) -> CliResult {
    enqueue(registry.inner(), &server_key, command::friend_list())
}

/// `mp_friend_request_list` — request pending incoming friend requests (streams
/// `FRIENDREQUESTLISTBEGIN..FRIENDREQUESTLISTEND`).
#[tauri::command]
fn mp_friend_request_list(registry: State<'_, Registry>, server_key: String) -> CliResult {
    enqueue(
        registry.inner(),
        &server_key,
        command::friend_request_list(),
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
    // On a Tachyon connection this becomes `lobby/join`, which names the lobby
    // by its uuid and takes neither a key nor a script password: the schema has
    // no passworded lobby, so both are dropped there.
    if let Some(result) = tachyon_action(
        registry.inner(),
        &server_key,
        TachyonAction::JoinLobby { battle: id },
    ) {
        return result;
    }
    enqueue(
        registry.inner(),
        &server_key,
        command::join_battle(id, key.as_deref(), script_password.as_deref()),
    )
}

/// `mp_leave_battle` — leave the current battle.
#[tauri::command]
fn mp_leave_battle(registry: State<'_, Registry>, server_key: String) -> CliResult {
    if let Some(result) = tachyon_action(registry.inner(), &server_key, TachyonAction::LeaveLobby) {
        return result;
    }
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
    // On a Tachyon connection the seat is three separate requests, so the task
    // works out which of them this push actually changed. Colour, faction and
    // handicap have no Tachyon equivalent and the room hides those controls
    // there, so nothing is lost by a push that carries them.
    if let Some(result) = tachyon_action(
        registry.inner(),
        &server_key,
        TachyonAction::Room(RoomAction::OwnStatus(status)),
    ) {
        return result;
    }
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
    // `lobby/update` changes one field at a time and has no lock, so only the
    // map crosses over. The room hides the lock toggle on a Tachyon connection.
    if let Some(result) = tachyon_action(
        registry.inner(),
        &server_key,
        TachyonAction::Room(RoomAction::SetMap { map: map.clone() }),
    ) {
        return result;
    }
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
    // `lobby/addBot` seats a bot on an ally team and lets the server pick the
    // team within it, so the ally index is the only part of the status it takes.
    if let Some(result) = tachyon_action(
        registry.inner(),
        &server_key,
        TachyonAction::Room(RoomAction::AddBot {
            name: name.clone(),
            ally,
            ai: ai_dll.clone(),
        }),
    ) {
        return result;
    }
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
    ai_dll: Option<String>,
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
    // `lobby/updateBot` carries the AI, the display name and the bot's options,
    // and nothing about where the bot sits, so the room hides a bot's team and
    // ally pickers on a Tachyon connection and only an AI change comes through.
    // On a TASServer connection there is no such command, so the caller changes
    // a bot's AI by removing it and adding it back (see `changeBotAi`).
    if let Some(ai) = ai_dll {
        if let Some(result) = tachyon_action(
            registry.inner(),
            &server_key,
            TachyonAction::Room(RoomAction::ChangeBotAi {
                name: name.clone(),
                ai,
            }),
        ) {
            return result;
        }
    }
    enqueue(
        registry.inner(),
        &server_key,
        command::update_bot(&name, status, color),
    )
}

/// `mp_remove_bot` — remove a bot.
#[tauri::command]
fn mp_remove_bot(registry: State<'_, Registry>, server_key: String, name: String) -> CliResult {
    if let Some(result) = tachyon_action(
        registry.inner(),
        &server_key,
        TachyonAction::Room(RoomAction::RemoveBot { name: name.clone() }),
    ) {
        return result;
    }
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
    // `lobby/kickban` is lobby-scoped and open to any member subject to a vote,
    // so on a Tachyon connection this is not a host power and the room offers it
    // to everyone. Sent without `banUntil`, which is what makes it a kick.
    if let Some(result) = tachyon_action(
        registry.inner(),
        &server_key,
        TachyonAction::Room(RoomAction::Kick {
            username: username.clone(),
        }),
    ) {
        return result;
    }
    enqueue(
        registry.inner(),
        &server_key,
        command::kick_from_battle(&username),
    )
}

/// `mp_appoint_boss`, Tachyon only: make a member a boss, so they may change the
/// lobby. Tachyon has no founder, and a boss is the nearest thing it has.
#[tauri::command]
fn mp_appoint_boss(
    registry: State<'_, Registry>,
    server_key: String,
    username: String,
) -> CliResult {
    tachyon_action(
        registry.inner(),
        &server_key,
        TachyonAction::Room(RoomAction::AppointBoss { username }),
    )
    .unwrap_or_else(|| CliResult::err("this server does not have bosses"))
}

/// `mp_unboss`, Tachyon only: stand a boss down.
#[tauri::command]
fn mp_unboss(registry: State<'_, Registry>, server_key: String, username: String) -> CliResult {
    tachyon_action(
        registry.inner(),
        &server_key,
        TachyonAction::Room(RoomAction::Unboss { username }),
    )
    .unwrap_or_else(|| CliResult::err("this server does not have bosses"))
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
/// The engine option maps parsed out of a battle's script tags: start-pos type,
/// mod options, map options, and unit restrictions (unit name -> limit).
type SplitTags = (
    u8,
    BTreeMap<String, String>,
    BTreeMap<String, String>,
    BTreeMap<String, u32>,
);

/// Split a battle's opaque `script_tags` into the engine option maps the `play`
/// `BattleConfig` consumes. Keys are matched case-insensitively (SPADS lowercases
/// tag paths, but the engine is case-insensitive): `game/startpostype`,
/// `game/modoptions/<k>`, `game/mapoptions/<k>`, and the engine-native unit
/// restrictions `game/restrict/unit<N>` + `game/restrict/limit<N>` (paired by
/// index into a unit-name -> limit map; `numrestrictions` is advisory and
/// ignored — we key off the actual `unit<N>` tags). Anything else is ignored.
fn split_script_tags(tags: &BTreeMap<String, String>) -> SplitTags {
    const MOD: &str = "game/modoptions/";
    const MAP: &str = "game/mapoptions/";
    const RESTRICT: &str = "game/restrict/";
    let mut start_pos_type = 0u8;
    let mut mod_opts = BTreeMap::new();
    let mut map_opts = BTreeMap::new();
    // Restrictions arrive as parallel `unit<N>`/`limit<N>` tags; collect each by
    // index, then pair them (a limit missing its unit is dropped; a unit missing
    // its limit disables fully, limit 0).
    let mut units: BTreeMap<u32, String> = BTreeMap::new();
    let mut limits: BTreeMap<u32, u32> = BTreeMap::new();
    for (k, v) in tags {
        let lk = k.to_ascii_lowercase();
        if lk == "game/startpostype" {
            start_pos_type = v.trim().parse().unwrap_or(0);
        } else if let Some(name) = lk.strip_prefix(MOD) {
            mod_opts.insert(name.to_string(), v.clone());
        } else if let Some(name) = lk.strip_prefix(MAP) {
            map_opts.insert(name.to_string(), v.clone());
        } else if let Some(rest) = lk.strip_prefix(RESTRICT) {
            if let Some(idx) = rest
                .strip_prefix("unit")
                .and_then(|n| n.parse::<u32>().ok())
            {
                units.insert(idx, v.clone());
            } else if let Some(idx) = rest
                .strip_prefix("limit")
                .and_then(|n| n.parse::<u32>().ok())
            {
                limits.insert(idx, v.trim().parse().unwrap_or(0));
            }
        }
    }
    let mut restricted_units = BTreeMap::new();
    for (idx, name) in units {
        if name.is_empty() {
            continue;
        }
        restricted_units.insert(name, limits.get(&idx).copied().unwrap_or(0));
    }
    (start_pos_type, mod_opts, map_opts, restricted_units)
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

    // Joiners get a minimal client script from the host engine and RESTRICT is
    // host-authoritative (engine-level), so the join config drops restrictions.
    let (start_pos_type, mod_options, map_options, _restricted_units) =
        split_script_tags(&battle.script_tags);

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

    // `[PLAYERn]` is positional, so a member's index in this (sorted) list *is* its
    // engine player number. `AI.Host` and `Team.TeamLeader` are both player numbers
    // and have to be looked up here rather than assumed: sorting by name means the
    // host is rarely player 0.
    let player_index: BTreeMap<&str, usize> = members
        .iter()
        .enumerate()
        .map(|(i, (name, _))| (name.as_str(), i))
        .collect();
    let my_index = player_index.get(me.as_str()).copied().unwrap_or(0);

    let mut teams: BTreeMap<usize, Value> = BTreeMap::new();
    let mut players = Vec::new();
    for (i, (name, ms)) in members.iter().enumerate() {
        let bs = ms.battle_status;
        let mut player = json!({ "name": name, "spectator": !bs.mode });
        if bs.mode {
            let pos = team_index[&bs.team_id];
            player["team"] = json!(pos);
            teams
                .entry(pos)
                .or_insert_with(|| host_team_value(ally_index[&bs.ally], ms.team_color, i));
        }
        players.push(player);
    }

    let mut ais = Vec::new();
    for (name, bot) in &bots {
        let bs = bot.battle_status;
        let pos = team_index[&bs.team_id];
        // The engine runs an AI only on the machine whose player number matches
        // `Host` (SkirmishAIHandler::IsLocalSkirmishAI), so it must name the bot's
        // owner. An owner who has since left the battle has no [PLAYER] section, and
        // a Host naming one is a fatal content_error, so fall back to ourselves.
        let owner = player_index
            .get(bot.owner.as_str())
            .copied()
            .unwrap_or(my_index);
        ais.push(json!({
            "name": name,
            "shortName": bot.ai_dll,
            "team": pos,
            "host": owner,
        }));
        // Members are walked first, so this only fires for an AI-only team, whose
        // leader is by convention the player hosting the AI.
        teams
            .entry(pos)
            .or_insert_with(|| host_team_value(ally_index[&bs.ally], bot.team_color, owner));
    }

    let (start_pos_type, mod_options, map_options, restricted_units) =
        split_script_tags(&battle.script_tags);

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
        "restrictedUnits": restricted_units,
        "players": players,
        "ais": ais,
        "teams": teams.into_values().collect::<Vec<_>>(),
        "allyTeams": ally_teams,
        "isHost": true,
        "hostIp": "0.0.0.0",
        "hostPort": state.host_port.or_else(|| battle.port.parse::<u16>().ok()),
    }))
}

/// One host-mode `teams[]` entry, with an already-renumbered ally index and the
/// player number leading the team.
fn host_team_value(ally: usize, color: u32, leader: usize) -> Value {
    let (r, g, b) = team_color_rgb(color);
    json!({
        "teamLeader": leader,
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
                // The NAT mode rides alongside the config rather than inside it:
                // it is a lobby-level fact about how to reach the host, not
                // something the engine's start script has a slot for.
                Ok(config) => {
                    let nat_type = state
                        .current_battle
                        .and_then(|id| state.battles.get(&id))
                        .map(|b| b.nat_type.clone())
                        .unwrap_or_default();
                    CliResult::ok(json!({ "config": config, "natType": nat_type }))
                }
                Err(e) => CliResult::err(e),
            }
        }
        None => CliResult::err(format!("not connected: {server_key}")),
    }
}

/// `mp_probe_host`: ask whether a battle host's game port refuses us outright.
///
/// Read the [`probe`] module docs before acting on the result. Only `refused`
/// and `unresolved` mean anything. `silent` is the normal answer from a
/// perfectly healthy host, so it must never be surfaced as a problem.
#[tauri::command]
async fn mp_probe_host(host: String, port: u16) -> CliResult {
    let outcome = tauri::async_runtime::spawn_blocking(move || {
        probe::probe(&host, port, probe::PROBE_TIMEOUT).as_str()
    })
    .await;
    match outcome {
        Ok(o) => CliResult::ok(json!({ "outcome": o })),
        Err(e) => CliResult::err(format!("probe failed to run: {e}")),
    }
}

/// `mp_chat_logs` — enumerate saved chat logs (DM + channel threads) across every
/// account, for the log viewer. Reads the log dirs directly, so it works with no
/// active connection. Each account's threads are newest-activity first.
#[tauri::command]
fn mp_chat_logs<R: Runtime>(app: tauri::AppHandle<R>) -> CliResult {
    let (dm_dir, chan_dir) = match log_dirs(&app) {
        Ok(d) => d,
        Err(e) => return CliResult::err(e),
    };
    let mut accounts: BTreeMap<String, Vec<Value>> = BTreeMap::new();
    for (dir, kind) in [(&dm_dir, "dm"), (&chan_dir, "channel")] {
        for stem in dmlog::account_stems(dir) {
            let log = dmlog::DmLog::new(dir, &stem);
            for (name, count, last_at) in log.summaries() {
                accounts.entry(stem.clone()).or_default().push(json!({
                    "kind": kind,
                    "name": name,
                    "messageCount": count,
                    "lastAt": last_at,
                }));
            }
        }
    }
    let out: Vec<Value> = accounts
        .into_iter()
        .map(|(account, mut threads)| {
            threads.sort_by(|a, b| b["lastAt"].as_u64().cmp(&a["lastAt"].as_u64()));
            json!({ "account": account, "threads": threads })
        })
        .collect();
    CliResult::ok(json!({ "accounts": out }))
}

/// `mp_chat_log_open` — load one saved thread's messages (a DM peer or a channel)
/// for `account` (a log file stem from `mp_chat_logs`). `kind` selects the store.
#[tauri::command]
fn mp_chat_log_open<R: Runtime>(
    app: tauri::AppHandle<R>,
    account: String,
    kind: String,
    name: String,
) -> CliResult {
    let (dm_dir, chan_dir) = match log_dirs(&app) {
        Ok(d) => d,
        Err(e) => return CliResult::err(e),
    };
    let dir = if kind == "channel" { chan_dir } else { dm_dir };
    let log = dmlog::DmLog::new(&dir, &account);
    CliResult::ok(json!({ "messages": log.thread(&name) }))
}

/// `mp_tachyon_sign_in`: run the OAuth browser sign-in against a Tachyon server and
/// keep the result.
///
/// `base_url` is the server's own origin, for example
/// `https://server4.beyondallreason.info`. Nothing below it is hardcoded: the
/// endpoints come from the server's discovery document.
///
/// This resolves only once the user has finished in the browser, which can take a
/// minute, or fails if they never do. No token comes back over IPC. The refresh
/// token goes to the OS keychain under `{serverId}:{username}` and the access token
/// stays in memory on the Rust side.
#[tauri::command]
async fn mp_tachyon_sign_in(base_url: String, server_id: String, username: String) -> CliResult {
    let open =
        |url: &str| tauri_plugin_opener::open_url(url, None::<&str>).map_err(|e| e.to_string());
    match tachyon_auth::sign_in_and_store(&base_url, &server_id, &username, open).await {
        Ok(()) => CliResult::ok(json!({})),
        Err(e) => CliResult::err(e.to_string()),
    }
}

/// `mp_tachyon_sign_out`: forget a Tachyon account, both the stored refresh token
/// and any access token still in memory.
#[tauri::command]
async fn mp_tachyon_sign_out(server_id: String, username: String) -> CliResult {
    match tachyon_auth::sign_out(&server_id, &username) {
        Ok(()) => CliResult::ok(json!({})),
        Err(e) => CliResult::err(e.to_string()),
    }
}

/// Build the plugin. Registered as `"coilbox-multiplayer"`.
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("coilbox-multiplayer")
        .setup(|app, _api| {
            app.manage(Registry::default());
            app.manage(PendingConnects::default());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            mp_connect,
            mp_connect_tachyon,
            mp_register,
            mp_confirm_agreement,
            mp_disconnect,
            mp_cancel_connect,
            mp_reattach,
            mp_active_keys,
            mp_snapshot,
            mp_send,
            mp_say,
            mp_say_private,
            mp_say_battle,
            mp_say_ex,
            mp_say_battle_ex,
            mp_say_private_ex,
            mp_join_channel,
            mp_leave_channel,
            mp_list_channels,
            mp_ignore,
            mp_unignore,
            mp_ignore_list,
            mp_friend_request,
            mp_accept_friend_request,
            mp_decline_friend_request,
            mp_unfriend,
            mp_friend_list,
            mp_friend_request_list,
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
            mp_appoint_boss,
            mp_unboss,
            mp_set_start_rect,
            mp_remove_start_rect,
            mp_set_script_tags,
            mp_remove_script_tags,
            mp_build_battle_config,
            mp_build_host_config,
            mp_probe_host,
            mp_chat_logs,
            mp_chat_log_open,
            mp_tachyon_sign_in,
            mp_tachyon_sign_out,
            tachyon_debug::mp_tachyon_request,
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

        // Two engine-native unit restrictions (both fully disabled, limit 0).
        battle
            .script_tags
            .insert("game/restrict/numrestrictions".into(), "2".into());
        battle
            .script_tags
            .insert("game/restrict/unit0".into(), "armcom".into());
        battle
            .script_tags
            .insert("game/restrict/limit0".into(), "0".into());
        battle
            .script_tags
            .insert("game/restrict/unit1".into(), "armflash".into());
        battle
            .script_tags
            .insert("game/restrict/limit1".into(), "0".into());

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

    /// The engine runs an AI only where `AI.Host` matches the local player number,
    /// so a hardcoded 0 hands our bots to whoever sorts first by name, and they then
    /// never get placed. `me` hosts but is player 1 here, which is the whole point.
    #[test]
    fn host_config_points_ai_host_at_the_owning_player() {
        let cfg = battle_to_host_config(&hosted_state()).unwrap();
        let players = cfg["players"].as_array().unwrap();
        assert_eq!(players[0]["name"], "ally", "the host does not sort first");
        assert_eq!(players[1]["name"], "me");

        // BARb is owned by `me`, so it runs on player 1's machine, not player 0's.
        assert_eq!(cfg["ais"][0]["host"], 1);
    }

    #[test]
    fn host_config_leads_an_ai_only_team_with_the_ai_host() {
        let cfg = battle_to_host_config(&hosted_state()).unwrap();
        let teams = cfg["teams"].as_array().unwrap();
        // Team pos 0 holds only BARb, owned by `me` -> player 1.
        assert_eq!(teams[0]["teamLeader"], 1);
    }

    #[test]
    fn host_config_leads_human_teams_with_their_own_player() {
        let cfg = battle_to_host_config(&hosted_state()).unwrap();
        let teams = cfg["teams"].as_array().unwrap();
        // pos 1 is `me` (player 1); pos 2 is `ally` (player 0).
        assert_eq!(teams[1]["teamLeader"], 1);
        assert_eq!(teams[2]["teamLeader"], 0);
    }

    /// A bot whose owner left has no [PLAYER] section; naming it in `Host` is a
    /// fatal content_error in the engine, so we take the team over instead.
    #[test]
    fn host_config_falls_back_to_us_for_an_orphaned_bot() {
        let mut state = hosted_state();
        let battle = state.battles.get_mut(&9).unwrap();
        battle.bots.get_mut("BARb").unwrap().owner = "departed".into();

        let cfg = battle_to_host_config(&state).unwrap();
        assert_eq!(cfg["ais"][0]["host"], 1, "falls back to us, not player 0");
        assert_eq!(cfg["teams"][0]["teamLeader"], 1);
    }

    /// A non-host member's bot runs on that member's machine, matching skylobby and
    /// springlobby.
    #[test]
    fn host_config_points_a_guests_bot_at_the_guest() {
        let mut state = hosted_state();
        let battle = state.battles.get_mut(&9).unwrap();
        battle.bots.get_mut("BARb").unwrap().owner = "ally".into();

        let cfg = battle_to_host_config(&state).unwrap();
        assert_eq!(cfg["ais"][0]["host"], 0);
        assert_eq!(cfg["teams"][0]["teamLeader"], 0);
    }

    /// Every emitted TeamLeader/Host must name a real [PLAYERn], or the engine
    /// throws "invalid AI.Host" / "Team N has invalid leader" and the script dies.
    #[test]
    fn host_config_player_references_are_all_in_range() {
        let cfg = battle_to_host_config(&hosted_state()).unwrap();
        let n = cfg["players"].as_array().unwrap().len();
        for team in cfg["teams"].as_array().unwrap() {
            assert!(team["teamLeader"].as_u64().unwrap() < n as u64);
        }
        for ai in cfg["ais"].as_array().unwrap() {
            assert!(ai["host"].as_u64().unwrap() < n as u64);
        }
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

    #[test]
    fn host_config_includes_unit_restrictions() {
        let cfg = battle_to_host_config(&hosted_state()).unwrap();
        // Both restricted units surface as a name -> limit map the play crate
        // renders into the [RESTRICT] block.
        assert_eq!(cfg["restrictedUnits"]["armcom"], 0);
        assert_eq!(cfg["restrictedUnits"]["armflash"], 0);
        assert_eq!(cfg["restrictedUnits"].as_object().unwrap().len(), 2);
    }

    #[test]
    fn split_script_tags_pairs_restrict_indices() {
        let mut tags = BTreeMap::new();
        tags.insert("game/restrict/numrestrictions".into(), "2".into());
        tags.insert("game/restrict/unit0".into(), "armcom".into());
        tags.insert("game/restrict/limit0".into(), "0".into());
        tags.insert("game/restrict/unit1".into(), "corak".into());
        tags.insert("game/restrict/limit1".into(), "5".into());
        // A limit with no matching unit is ignored; numrestrictions is advisory.
        tags.insert("game/restrict/limit9".into(), "0".into());

        let (_, _, _, restricted) = split_script_tags(&tags);
        assert_eq!(restricted.len(), 2);
        assert_eq!(restricted["armcom"], 0);
        assert_eq!(restricted["corak"], 5);
    }
}
