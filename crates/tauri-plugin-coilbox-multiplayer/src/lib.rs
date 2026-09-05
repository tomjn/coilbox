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
/// This client against a room the direct-hosting plugin is listening for. It
/// lives here rather than beside that plugin because [`conn::run_loop`] is
/// private, and driving anything less than the real one would prove nothing.
#[cfg(test)]
mod direct_loopback;
mod dmlog;
mod probe;
/// Telling the relay agent sidecar which addresses may reach a relayed battle.
/// Public because the seam it exposes is the one thing relay hosting cannot
/// work without, and it is waiting on a lobby that can name a joiner's address.
pub mod relay_agent;
/// Hosting a battle through the relay: the credential, the sidecar, the wait
/// for an allocation, and the address the battle is then advertised at. The
/// join between everything else in this milestone.
///
/// Private, like [`turn`] and for the same reason: its entry point takes a
/// [`Registry`].
mod relay_host;
/// Where the relay agent binary is, what to start it with, and how to tell
/// whether one is already relaying a battle. Public for the same reason
/// [`relay_agent`] is: it is half of the seam relay hosting is waiting on.
pub mod relay_sidecar;
/// The OAuth browser sign-in that produces a Tachyon bearer token.
pub mod tachyon_auth;
mod tachyon_conn;
/// The console drawer's send path, the one place a request is sent by hand.
mod tachyon_debug;
/// Who our friends are on a Tachyon connection, and who has asked to be.
mod tachyon_friends;
mod tachyon_lobbies;
/// The queues a Tachyon server matches players in, and the match it finds.
mod tachyon_matchmaking;
/// Direct messages and lobby chat, which is all the chat Tachyon has.
mod tachyon_messaging;
/// The party we are in on a Tachyon connection, and who has asked us into
/// theirs.
mod tachyon_parties;
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
/// Getting a relay credential out of the lobby, holding it until it runs out,
/// and turning it into what the relay agent takes. The other half of the seam
/// [`relay_agent`] exposes: issue #2017 asks here for what it starts a sidecar
/// with.
///
/// Private, unlike its two neighbours, because its seam takes a [`Registry`] and
/// a public function taking one would make every type reachable through a
/// connection part of this crate's public API.
mod turn;
/// Reading uberserver's sentence for a command it did not run, which is what
/// three of coilbox's relay waits would otherwise sit out in silence.
mod uberserver;
/// Zero-K's battle stream, folded into the same battle list the other two
/// protocols fill.
mod zerok_battles;
/// Channels, direct messages, friends and ignores on a Zero-K connection, which
/// are one subject there because a relation decides what chat reaches you.
mod zerok_chat;
/// Zero-K's line protocol over plain TCP, built alongside the two above.
/// Private, like the other two connection modules: exporting it would drag the
/// registry's `pub(crate)` action types out with it.
mod zerok_conn;
/// What a Zero-K game did to everybody's rating, which is the one post-match
/// report any protocol coilbox speaks sends at all.
mod zerok_debriefing;
/// The Zero-K battle room we are in, held as that protocol describes it and
/// projected into the same room the other two fill.
mod zerok_room;
/// Who is online on a Zero-K connection, and which battle each of them is in.
mod zerok_users;

use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::path::Path;
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::Duration;

use coilbox_lobby_protocol::{
    command, default_battle_status, password_hash, team_color_rgb, BattleStatus, ClientStatus,
    LobbyState, LoginConfig, LoginMode, LoginPhase,
};
use coilbox_zerok_protocol::types::Relation as ZerokRelation;
use conn::{
    spawn_connection, wait_until_ready, ConnProtocol, LobbyEvent, Outbound, Registry,
    TachyonAction, READY_TIMEOUT,
};
use picoframe_core::CliResult;
use serde_json::{json, Value};
use tachyon_conn::TachyonMarkers;
use tachyon_friends::FriendAction;
use tachyon_messaging::Conversation;
use tachyon_room::{RoomAction, VoteChoice};
use tauri::{
    ipc::Channel,
    plugin::{Builder, TauriPlugin},
    AppHandle, Manager, RunEvent, Runtime, State,
};
use tauri_plugin_coilbox_play::script::{Ai, AllyTeam, BattleConfig, Player, Team};
use tls::{ConnectError, TlsMode};
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
        // Every line this builds is TASServer syntax. Zero-K's server reads a
        // command name and a JSON object, so one of these would be a protocol
        // error rather than a command it happens not to support, and its
        // throttle counts protocol errors. Refusing here says so once, in the
        // one place every typed command passes through.
        Some(conn) if conn.protocol == ConnProtocol::Zerok => {
            CliResult::err("this server does not speak the TASServer line protocol")
        }
        Some(conn) => match conn.tx.send(Outbound::Line(line)) {
            Ok(()) => CliResult::ok(json!({ "sent": true })),
            Err(_) => CliResult::err("connection is closed"),
        },
        None => CliResult::err(format!("not connected: {server_key}")),
    }
}

/// Queue several lines as one command, stopping at the first refusal so a
/// caller sees the failure rather than a partial send reported as success.
///
/// For a command the protocol splits across lines because one would be too long
/// (see `command::SCRIPT_TAG_LINE_BUDGET`). No lines at all is a success: there
/// was nothing to say.
fn enqueue_all(registry: &Registry, server_key: &str, lines: Vec<String>) -> CliResult {
    let mut last = CliResult::ok(json!({ "sent": true }));
    for line in lines {
        last = enqueue(registry, server_key, line);
        if !last.success {
            return last;
        }
    }
    last
}

/// Queue a lobby action on a Tachyon connection, or `None` when this connection
/// is not one and the caller should send its TASServer line instead.
///
/// Having a request client is what makes a connection a Tachyon one, which is
/// the same test `mp_tachyon_request` makes.
pub(crate) fn tachyon_action(
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

/// Queue an action on a Zero-K connection, or `None` when this connection is not
/// one and the caller should send its TASServer line instead.
///
/// The counterpart of [`tachyon_action`], and it tests the recorded protocol
/// rather than a handle: a Zero-K connection has no client of its own to check
/// for, and leaves the same slot empty a TASServer one does.
fn zerok_action(
    registry: &Registry,
    server_key: &str,
    action: zerok_conn::ZerokAction,
) -> Option<CliResult> {
    let map = lock_or_recover(registry);
    let conn = map.get(server_key)?;
    if conn.protocol != ConnProtocol::Zerok {
        return None;
    }
    Some(match conn.tx.send(Outbound::Zerok(action)) {
        Ok(()) => CliResult::ok(json!({ "sent": true })),
        Err(_) => CliResult::err("connection is closed"),
    })
}

/// Whether this connection speaks Zero-K, for the one command that has to
/// answer differently rather than fall through to its TASServer line.
fn is_zerok(registry: &Registry, server_key: &str) -> bool {
    lock_or_recover(registry)
        .get(server_key)
        .is_some_and(|conn| conn.protocol == ConnProtocol::Zerok)
}

/// Queue one chat action on a Zero-K connection.
fn zerok_chat_action(
    registry: &Registry,
    server_key: &str,
    action: zerok_chat::ChatAction,
) -> Option<CliResult> {
    zerok_action(registry, server_key, zerok_conn::ZerokAction::Chat(action))
}

/// Queue one line of chat on a Zero-K connection.
///
/// The six say commands differ only in where the line goes and whether it is an
/// action, so the shape is written once.
fn zerok_say(
    registry: &Registry,
    server_key: &str,
    place: zerok_chat::Place,
    emote: bool,
    text: &str,
) -> Option<CliResult> {
    zerok_chat_action(
        registry,
        server_key,
        zerok_chat::ChatAction::Say {
            place,
            emote,
            text: text.to_owned(),
        },
    )
}

/// Answer a request for a list Zero-K sends unasked.
///
/// `FriendList` and `IgnoreList` arrive on connect and again after every change,
/// so there is nothing to ask for. Answered as sent rather than refused, because
/// the caller wanted the list to be current and it already is.
fn zerok_pushed_list(registry: &Registry, server_key: &str) -> Option<CliResult> {
    is_zerok(registry, server_key).then(|| CliResult::ok(json!({ "sent": true })))
}

/// Queue one relation change on a Zero-K connection.
///
/// Zero-K has one command for friends and ignores both. It is one-sided and
/// needs no answer: `SetAccountRelation` says what we have flagged somebody as,
/// and the server replies with a fresh list.
fn zerok_relation(
    registry: &Registry,
    server_key: &str,
    username: &str,
    relation: coilbox_zerok_protocol::types::Relation,
) -> Option<CliResult> {
    zerok_chat_action(
        registry,
        server_key,
        zerok_chat::ChatAction::Relation {
            username: username.to_owned(),
            relation,
        },
    )
}

/// Queue one battle-room action on a Zero-K connection, for the commands that
/// have a Zero-K equivalent as well as a TASServer one.
fn zerok_room_action(
    registry: &Registry,
    server_key: &str,
    action: zerok_room::RoomAction,
) -> Option<CliResult> {
    zerok_action(registry, server_key, zerok_conn::ZerokAction::Room(action))
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
    tls_mode: TlsMode,
    allow_self_signed: bool,
    username: String,
    password: String,
    client_id: String,
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
        tls_mode,
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
        client_id,
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
    tls_mode: TlsMode,
    allow_self_signed: bool,
    username: String,
    password: String,
    client_id: String,
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
        tls_mode,
        allow_self_signed,
        username,
        password,
        client_id,
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
    tls_mode: TlsMode,
    allow_self_signed: bool,
    username: String,
    password: String,
    email: Option<String>,
    client_id: String,
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
        tls_mode,
        allow_self_signed,
        username,
        password,
        client_id,
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
    markers: State<'_, TachyonMarkers>,
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

    tachyon_conn::spawn_connection(
        registry.inner().clone(),
        server_key,
        socket,
        on_event,
        markers.inner().clone(),
    );
    Ok(CliResult::ok(json!({ "connected": true })))
}

/// `mp_connect_zerok`: open a lobby connection to Zero-K's server.
///
/// The third connect command, and deliberately separate again. Zero-K's protocol
/// shares neither the TASServer handshake nor Tachyon's bearer token, and its
/// port carries no TLS at all, so there is no mode to pass and nothing to
/// upgrade.
///
/// The server speaks first: a `Welcome` arrives unprompted and the connection
/// task answers it with `Login`, so there is no handshake to drive from here.
/// The password is hashed here and never logged in plaintext.
///
/// `install_id` is the caller's per-install identifier, which Zero-K's server
/// uses for multi-account and ban-evasion checks. `LobbyVersion` is built from
/// the running app's version rather than from `CARGO_PKG_VERSION`, which stays a
/// placeholder in source because coilbox takes its release version from the git
/// tag.
///
/// Streams the same `LobbyEvent`s as the other two, so everything above the
/// connection is unchanged.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
async fn mp_connect_zerok<R: Runtime>(
    app: tauri::AppHandle<R>,
    registry: State<'_, Registry>,
    pending: State<'_, PendingConnects>,
    server_key: String,
    host: String,
    port: u16,
    username: String,
    password: String,
    install_id: String,
    on_event: Channel<LobbyEvent>,
) -> Result<CliResult, ()> {
    Ok(open_zerok(
        &app,
        registry.inner(),
        pending.inner(),
        server_key,
        host,
        port,
        username,
        password,
        install_id,
        LoginMode::Login,
        on_event,
    )
    .await)
}

/// `mp_register_zerok`: open a connection and create a Zero-K account on it.
///
/// A connection of its own, thrown away afterwards. Registering does not log
/// anybody in, so the caller drops this one on success and connects normally,
/// which is what upstream's own client does.
///
/// The frontend watches for the `registered` phase, and a refusal arrives as a
/// `registrationDenied` delta ahead of the `disconnected` that follows it. There
/// is no verification step: Zero-K stores the email against the account and
/// never checks it, so the login after this one is ordinary.
///
/// A refusal must not be retried on a loop. `LoginChecker.cs` counts attempts
/// per IP address and answers a run of them with `BannedTooManyAttempts`, so a
/// retry bans the address rather than telling anyone what was wrong.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
async fn mp_register_zerok<R: Runtime>(
    app: tauri::AppHandle<R>,
    registry: State<'_, Registry>,
    pending: State<'_, PendingConnects>,
    server_key: String,
    host: String,
    port: u16,
    username: String,
    password: String,
    email: Option<String>,
    install_id: String,
    on_event: Channel<LobbyEvent>,
) -> Result<CliResult, ()> {
    Ok(open_zerok(
        &app,
        registry.inner(),
        pending.inner(),
        server_key,
        host,
        port,
        username,
        password,
        install_id,
        LoginMode::Register { email },
        on_event,
    )
    .await)
}

/// Open the socket to a Zero-K server and hand it to the connection task, which
/// answers the greeting according to `mode`. Shared by the two commands above,
/// which differ only in that.
#[allow(clippy::too_many_arguments)]
async fn open_zerok<R: Runtime>(
    app: &tauri::AppHandle<R>,
    registry: &Registry,
    pending: &PendingConnects,
    server_key: String,
    host: String,
    port: u16,
    username: String,
    password: String,
    install_id: String,
    mode: LoginMode,
    on_event: Channel<LobbyEvent>,
) -> CliResult {
    if lock_or_recover(registry).contains_key(&server_key) {
        return CliResult::err(format!("already connected: {server_key}"));
    }

    // The same store the other two connections use, so a direct-message thread
    // is where it was left whichever server it was on. Only the direct-message
    // half: see the note in [`zerok_conn::run_loop`] on why a Zero-K channel is
    // not written down.
    let dm_dir = match log_dirs(app) {
        Ok((dm_dir, _)) => dm_dir,
        Err(e) => return CliResult::err(format!("no app data dir: {e}")),
    };
    let dm_log = dmlog::DmLog::new(&dm_dir, &server_key);

    // The same cancel token the other two publish, so `mp_cancel_connect`
    // reaches a Zero-K connect that is still opening.
    let token = CancellationToken::new();
    {
        let mut map = lock_or_recover(pending);
        if map.contains_key(&server_key) {
            return CliResult::err(format!("already connecting: {server_key}"));
        }
        map.insert(server_key.clone(), token.clone());
    }
    let opened = zerok_conn::connect(&host, port, CONNECT_TIMEOUT, &token).await;
    lock_or_recover(pending).remove(&server_key);
    let stream = match opened {
        Ok(stream) => stream,
        Err(ConnectError::Cancelled) => return CliResult::err("connection cancelled"),
        Err(ConnectError::TimedOut) => {
            return CliResult::err(format!(
                "connection timed out after {}s",
                CONNECT_TIMEOUT.as_secs()
            ))
        }
        Err(ConnectError::Failed(e)) => return CliResult::err(e),
    };

    let login = zerok_conn::ZerokLogin {
        username,
        password_hash: password_hash(&password),
        lobby_version: format!("Coilbox {}", app.package_info().version),
        install_id,
        mode,
    };
    zerok_conn::spawn_connection(
        registry.clone(),
        server_key,
        stream,
        login,
        on_event,
        dm_log,
    );
    CliResult::ok(json!({ "connected": true }))
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

/// `mp_wait_until_ready`: resolve once a connection has finished logging in.
///
/// For a caller whose next act is a command only a logged-in client may send, and
/// which cannot watch the phase events itself because it is inside one `await`
/// (see `connectDirect`, which starts a room and opens a battle in it before React
/// has re-rendered once). Fails rather than waits forever on a login that is
/// refused, dropped, or never finished.
#[tauri::command]
async fn mp_wait_until_ready(
    registry: State<'_, Registry>,
    server_key: String,
) -> Result<CliResult, ()> {
    Ok(
        match wait_until_ready(registry.inner(), &server_key, READY_TIMEOUT).await {
            Ok(()) => CliResult::ok(json!({ "ready": true })),
            Err(e) => CliResult::err(e),
        },
    )
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
            let phase = *conn.phase.borrow();
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
    if let Some(result) = zerok_say(
        registry.inner(),
        &server_key,
        zerok_chat::Place::Channel(channel.clone()),
        false,
        &message,
    ) {
        return result;
    }
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
    // On a Tachyon connection this becomes `messaging/send` to the player, and
    // the line is recorded once the server has taken it rather than before.
    if let Some(result) = tachyon_action(
        registry.inner(),
        &server_key,
        TachyonAction::Say {
            conversation: Conversation::Peer(username.clone()),
            text: message.clone(),
        },
    ) {
        return result;
    }
    // Zero-K echoes our own `Say` back to us, private ones included, so nothing
    // is recorded here. Doing it as well would double every line we sent.
    if let Some(result) = zerok_say(
        registry.inner(),
        &server_key,
        zerok_chat::Place::Peer(username.clone()),
        false,
        &message,
    ) {
        return result;
    }
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
    // On a Tachyon connection this becomes `messaging/send` to the lobby, which
    // is the nearest thing it has to battle chat.
    if let Some(result) = tachyon_action(
        registry.inner(),
        &server_key,
        TachyonAction::Say {
            conversation: Conversation::Lobby,
            text: message.clone(),
        },
    ) {
        return result;
    }
    if let Some(result) = zerok_say(
        registry.inner(),
        &server_key,
        zerok_chat::Place::Battle,
        false,
        &message,
    ) {
        return result;
    }
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
    if let Some(result) = zerok_say(
        registry.inner(),
        &server_key,
        zerok_chat::Place::Channel(channel.clone()),
        true,
        &message,
    ) {
        return result;
    }
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
    // Tachyon has one kind of message and no action form, so a `/me` goes out
    // as its body and reads the same to everyone, us included.
    if let Some(result) = tachyon_action(
        registry.inner(),
        &server_key,
        TachyonAction::Say {
            conversation: Conversation::Lobby,
            text: message.clone(),
        },
    ) {
        return result;
    }
    if let Some(result) = zerok_say(
        registry.inner(),
        &server_key,
        zerok_chat::Place::Battle,
        true,
        &message,
    ) {
        return result;
    }
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
    // Tachyon has no action form, so a private `/me` is sent as its body.
    if let Some(result) = tachyon_action(
        registry.inner(),
        &server_key,
        TachyonAction::Say {
            conversation: Conversation::Peer(username.clone()),
            text: message.clone(),
        },
    ) {
        return result;
    }
    // Echoed back to us like the plain form above, so it is not recorded here.
    if let Some(result) = zerok_say(
        registry.inner(),
        &server_key,
        zerok_chat::Place::Peer(username.clone()),
        true,
        &message,
    ) {
        return result;
    }
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
    if let Some(result) = zerok_chat_action(
        registry.inner(),
        &server_key,
        zerok_chat::ChatAction::JoinChannel {
            channel: channel.clone(),
            password: key.clone(),
        },
    ) {
        return result;
    }
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
    if let Some(result) = zerok_chat_action(
        registry.inner(),
        &server_key,
        zerok_chat::ChatAction::LeaveChannel {
            channel: channel.clone(),
        },
    ) {
        return result;
    }
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
    // Zero-K's relation carries no note, so the reason the line protocol can
    // send is dropped there.
    if let Some(result) = zerok_relation(
        registry.inner(),
        &server_key,
        &username,
        ZerokRelation::Ignore,
    ) {
        return result;
    }
    enqueue(
        registry.inner(),
        &server_key,
        command::ignore(&username, reason.as_deref()),
    )
}

/// `mp_unignore` — ask the server to stop ignoring a user (`UNIGNORE`).
#[tauri::command]
fn mp_unignore(registry: State<'_, Registry>, server_key: String, username: String) -> CliResult {
    if let Some(result) = zerok_relation(
        registry.inner(),
        &server_key,
        &username,
        ZerokRelation::None,
    ) {
        return result;
    }
    enqueue(registry.inner(), &server_key, command::unignore(&username))
}

/// `mp_ignore_list` — request the server's stored ignore list (`IGNORELIST`); the
/// reply streams as `IGNORELISTBEGIN...IGNORELISTEND` and rebuilds `server_ignores`.
#[tauri::command]
fn mp_ignore_list(registry: State<'_, Registry>, server_key: String) -> CliResult {
    if let Some(result) = zerok_pushed_list(registry.inner(), &server_key) {
        return result;
    }
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
    // `friend/sendRequest` names the person and nothing else, so the note the
    // line protocol can carry is dropped on a Tachyon connection.
    if let Some(result) = tachyon_action(
        registry.inner(),
        &server_key,
        TachyonAction::Friend(FriendAction::Send(username.clone())),
    ) {
        return result;
    }
    // Zero-K has no friend request. A relation is one-sided and takes effect at
    // once, so asking is befriending and the note goes nowhere.
    if let Some(result) = zerok_relation(
        registry.inner(),
        &server_key,
        &username,
        ZerokRelation::Friend,
    ) {
        return result;
    }
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
    if let Some(result) = tachyon_action(
        registry.inner(),
        &server_key,
        TachyonAction::Friend(FriendAction::Accept(username.clone())),
    ) {
        return result;
    }
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
    if let Some(result) = tachyon_action(
        registry.inner(),
        &server_key,
        TachyonAction::Friend(FriendAction::Reject(username.clone())),
    ) {
        return result;
    }
    enqueue(
        registry.inner(),
        &server_key,
        command::decline_friend_request(&username),
    )
}

/// `mp_unfriend` — remove an existing friendship.
#[tauri::command]
fn mp_unfriend(registry: State<'_, Registry>, server_key: String, username: String) -> CliResult {
    // Tachyon splits this in two: a friendship ends with `friend/remove` and a
    // request we sent is withdrawn with `friend/cancelRequest`. The connection
    // holds which of the two this person is, so it picks.
    if let Some(result) = tachyon_action(
        registry.inner(),
        &server_key,
        TachyonAction::Friend(FriendAction::Remove(username.clone())),
    ) {
        return result;
    }
    if let Some(result) = zerok_relation(
        registry.inner(),
        &server_key,
        &username,
        ZerokRelation::None,
    ) {
        return result;
    }
    enqueue(registry.inner(), &server_key, command::unfriend(&username))
}

/// `mp_friend_list` — request the mutual-friend list (streams
/// `FRIENDLISTBEGIN..FRIENDLISTEND`). No-ops on servers without friend support.
#[tauri::command]
fn mp_friend_list(registry: State<'_, Registry>, server_key: String) -> CliResult {
    if let Some(result) = tachyon_action(
        registry.inner(),
        &server_key,
        TachyonAction::Friend(FriendAction::List),
    ) {
        return result;
    }
    if let Some(result) = zerok_pushed_list(registry.inner(), &server_key) {
        return result;
    }
    enqueue(registry.inner(), &server_key, command::friend_list())
}

/// `mp_friend_request_list` — request pending incoming friend requests (streams
/// `FRIENDREQUESTLISTBEGIN..FRIENDREQUESTLISTEND`).
#[tauri::command]
fn mp_friend_request_list(registry: State<'_, Registry>, server_key: String) -> CliResult {
    // One Tachyon request answers both this and `mp_friend_list`: `friend/list`
    // carries the friends and the pending requests together.
    if let Some(result) = tachyon_action(
        registry.inner(),
        &server_key,
        TachyonAction::Friend(FriendAction::List),
    ) {
        return result;
    }
    if let Some(result) = zerok_pushed_list(registry.inner(), &server_key) {
        return result;
    }
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
    // Zero-K takes the battle's password and no script password: the server
    // hands one out itself, in the `ConnectSpring` that says where the match is.
    // Nothing about our seat can go with the join, so the connection sends it
    // once `JoinBattleSuccess` confirms we are in the room.
    if let Some(result) = zerok_room_action(
        registry.inner(),
        &server_key,
        zerok_room::RoomAction::Join {
            battle: id,
            password: key.clone(),
        },
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
///
/// A host leaving their own battle closes it, so a relay opened for that battle
/// is carrying one that no longer exists and the sidecar has to hear about it
/// (issue #2018). [`forget_relay`] is what says so, and what explains why this
/// cannot cut off a game that is still being played. It runs before the
/// protocol branches below because a relayed host is always a TASServer host,
/// and it is a no-op on every connection that is not hosting through a relay.
#[tauri::command]
fn mp_leave_battle(registry: State<'_, Registry>, server_key: String) -> CliResult {
    forget_relay(registry.inner(), &server_key);
    if let Some(result) = tachyon_action(registry.inner(), &server_key, TachyonAction::LeaveLobby) {
        return result;
    }
    if let Some(result) =
        zerok_room_action(registry.inner(), &server_key, zerok_room::RoomAction::Leave)
    {
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
    // Zero-K has no status bitfield. `ChangeUserStatus` carries the two flags on
    // their own, and the server owns rank, moderator and bot outright, so there
    // is nothing to send it about those.
    if let Some(result) = zerok_action(
        registry.inner(),
        &server_key,
        zerok_conn::ZerokAction::Status { ingame, away },
    ) {
        return result;
    }
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
    // The intent is recorded before the send on every protocol, and on Zero-K it
    // is also what the connection sends when a join lands: the server takes
    // nothing about a seat until it has confirmed we are in the room.
    set_intended_battle_status(registry.inner(), &server_key, status, color);
    // Zero-K carries the ally team, the spectator flag and the sync flag, and
    // has nothing for the colour, the faction, the team number, the handicap or
    // readiness. The room hides those controls there, so a push that carries
    // them loses nothing.
    if let Some(result) = zerok_room_action(
        registry.inner(),
        &server_key,
        zerok_room::RoomAction::OwnStatus(status),
    ) {
        return result;
    }
    enqueue(
        registry.inner(),
        &server_key,
        command::my_battle_status(status, color),
    )
}

/// `mp_open_battle` — host a new battle (mirrors the `OPENBATTLE` field order).
#[tauri::command]
#[allow(clippy::too_many_arguments)]
async fn mp_open_battle<R: Runtime>(
    app: tauri::AppHandle<R>,
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
    relay: bool,
) -> Result<CliResult, ()> {
    // The run file is the only thing here that needs to know where coilbox is
    // installed, so it is resolved before the work and handed down as a path.
    let run_file = if relay {
        match relay_sidecar::run_file_path(&app) {
            Ok(path) => Some(path),
            Err(e) => return Ok(CliResult::err(e)),
        }
    } else {
        None
    };
    Ok(open_battle(
        registry.inner(),
        &server_key,
        port,
        BattleToOpen {
            battle_type,
            nat_type,
            key,
            max_players,
            modhash,
            rank,
            maphash,
            engine,
            version,
            map,
            title,
            modname,
        },
        run_file.as_deref(),
    )
    .await)
}

/// Everything an `OPENBATTLE` line carries except where the battle is.
///
/// Split out so that the address and the port live in exactly one place, which
/// is [`advertising`]. A battle's content and a battle's whereabouts are decided
/// by different things, and the only bug that matters here is mixing them up.
struct BattleToOpen {
    battle_type: u8,
    nat_type: u8,
    key: String,
    max_players: u32,
    modhash: i32,
    rank: u8,
    maphash: i32,
    engine: String,
    version: String,
    map: String,
    title: String,
    modname: String,
}

/// The lines that open `battle` at `advertised`, in the order they go on the
/// wire. Pure.
///
/// One port, taken from `advertised`, so there is no second one for the
/// `OPENBATTLE` line to be built from by mistake. On a relayed battle that is
/// the relay's allocated port and the host's own engine port is nowhere in
/// scope.
///
/// The address line comes first because the lobby has to know where the battle
/// is before it is told there is one. It works a host's address out from the
/// connection it is talking to, and for a relayed host that answer is this
/// machine, which is the address nobody can reach and the reason any of this
/// exists. `RELAYEDHOST` is the only place coilbox contradicts it, and it is
/// absent on every other route because on those the lobby is right.
fn advertising(advertised: relay_host::Advertised, battle: &BattleToOpen) -> Vec<String> {
    let open = command::open_battle(
        battle.battle_type,
        battle.nat_type,
        &battle.key,
        advertised.port,
        battle.max_players,
        battle.modhash,
        battle.rank,
        battle.maphash,
        &battle.engine,
        &battle.version,
        &battle.map,
        &battle.title,
        &battle.modname,
    );
    match advertised.ip {
        Some(ip) => vec![command::relayed_host(ip, advertised.port), open],
        None => vec![open],
    }
}

/// The body of [`mp_open_battle`], with the app handle taken out.
///
/// `relay` is the sidecar's run file when this battle is to be relayed and
/// `None` when it is not, so "which route" and "where the run file is" are one
/// value rather than two that could disagree.
///
/// ## Why the ordering cannot go wrong here
///
/// A relayed battle is advertised at the relay's allocation, and advertising it
/// before that allocation exists gives players a battle they cannot enter. The
/// guarantee is not the order of the statements below, it is that the port every
/// line is built from comes out of a [`relay_host::Advertised`], and the only way
/// to build a relayed one is from a [`relay_host::RelayHost`], which only
/// [`relay_host::allocate`] returns and only once the agent has said its relay is
/// open. Rearranging this function cannot produce an advertisement that runs
/// ahead of the allocation, because there is no value to advertise until there is
/// one.
///
/// `port` is the port the host's own engine will bind. On a relayed battle that
/// is not the port anybody dials, so it stays out of the wire lines and goes to
/// the relay agent instead, as `--engine-port`.
///
/// ## Why a relayed open waits for the lobby and a direct one does not
///
/// Queueing two lines is not opening a battle. The lobby can still refuse, and
/// on the relay route a refusal leaves a sidecar holding an allocation for a
/// battle that never existed, plus a run file that turns the host's next
/// attempt into "a relay agent is already running as process 12345" with no way
/// out but ending it by hand (issue #2058).
///
/// So the relay route waits to hear which happened and stops the agent unless
/// the answer is a battle. A direct host has nothing running to stop, so
/// nothing there changes.
///
/// The lobby refusing the address, `RELAYEDHOSTFAILED`, is the same wait and the
/// same stop, with one thing more to do: the lobby usually opens the battle
/// anyway, at the address the route ladder measured as unreachable, so that room
/// is closed rather than left for players to fail to join (issue #2064).
async fn open_battle(
    registry: &Registry,
    server_key: &str,
    port: u16,
    battle: BattleToOpen,
    relay: Option<&std::path::Path>,
) -> CliResult {
    // Refused rather than sent, because a key with whitespace in it moves the
    // port, the player limit and both content hashes into the wrong slots, and
    // the battle that opens is one nobody can join. Neither end can tell
    // afterwards, so it has to stop here.
    if !command::fits_one_field(&battle.key) {
        return CliResult::err("a battle password cannot contain spaces");
    }

    // Dropped before the attempt rather than after it, so a host whose relay
    // fails is not left described as relayed. The frontend clears its own record
    // of the route in the same place and for the same reason.
    forget_relay(registry, server_key);

    let (advertised, hosted) = match relay {
        Some(run_file) => {
            // The budget the lobby round trip gets is the login handshake's,
            // because it is the same round trip to the same server. Waiting for
            // the allocation afterwards has a budget of its own, in
            // `relay_host::ALLOCATION_PATIENCE`.
            let opened = relay_host::allocate(
                registry,
                server_key,
                run_file,
                port,
                battle.max_players as usize,
                conn::now_ms(),
                READY_TIMEOUT,
            )
            .await;
            match opened {
                Ok(host) => (relay_host::Advertised::relayed(&host), Some(host)),
                // The one thing that must not happen is a battle at an address
                // nobody can reach, so nothing is sent and the host is told why
                // in the form they pressed Host in.
                Err(e) => return CliResult::err(e.to_string()),
            }
        }
        None => (relay_host::Advertised::direct(port), None),
    };

    // Seat the host as a player by default (protocol default is spectator). The
    // frontend's colour/sync/spectate pushes then refine this via mp_set_battle_status.
    let seat = BattleStatus {
        mode: true,
        ..default_battle_status()
    };
    set_intended_battle_status(registry, server_key, seat, 0);

    advertise(
        registry,
        server_key,
        advertising(advertised, &battle),
        hosted,
        READY_TIMEOUT,
    )
    .await
}

/// Queue the lines that advertise a battle, and on the relay route wait to hear
/// whether the lobby opened one.
///
/// Split from [`open_battle`] because this is the half that can be driven
/// without a sidecar and without a TURN server: hand it a `hosted` whose control
/// channel is a pipe a test can read, and it is the whole of the decision issue
/// #2058 is about.
///
/// `patience` is a parameter for the same reason [`turn::credentials`] takes
/// one: the caller owns the budget and the tests own the clock.
async fn advertise(
    registry: &Registry,
    server_key: &str,
    lines: Vec<String>,
    hosted: Option<relay_host::RelayHost>,
    patience: Duration,
) -> CliResult {
    // Not a relayed battle, so there is no allocation riding on the answer and
    // no reason to make the host wait for one. This is every host today.
    let Some(host) = hosted else {
        return enqueue_all(registry, server_key, lines);
    };

    // Taken before a line is queued and marked seen in the same breath, so an
    // answer that lands while the lines are still being written is read as this
    // attempt's rather than missed or mistaken for the last one's. The refusal
    // note is cleared here for the same reason.
    let (mut answers, refused) = match watched(registry, server_key) {
        Some((mut answers, refused)) => {
            answers.borrow_and_update();
            relay_host::forget_refused_address(&refused);
            (answers, refused)
        }
        // The connection went while the allocation was being opened. There is
        // nothing to advertise on, so the relay is carrying nothing.
        None => {
            let _ = host.agent.stop();
            return CliResult::err(format!("not connected: {server_key}"));
        }
    };

    let sent = enqueue_all(registry, server_key, lines);
    if !sent.success {
        // The line never left, so there is no battle and the allocation is
        // holding the relay's bandwidth for nothing.
        let _ = host.agent.stop();
        return sent;
    }

    let opened = relay_host::confirmed(&mut answers, patience).await;
    // Read after the answer about the battle, never waited on. The server writes
    // `RELAYEDHOSTFAILED` where it reads the line and only then handles the
    // `OPENBATTLE` behind it, so a refusal that is coming has already been
    // written down by the time there is anything to read here.
    let address_refused = relay_host::refused_address(&refused);

    match (opened, address_refused) {
        // Held against the connection so the host's own start script knows to
        // point the engine at loopback rather than at the relay. From here on
        // the relay is carrying a battle, it is out of this function's reach,
        // and stopping it is issue #2018's with rules of its own.
        (Ok(_), None) => {
            remember_relay(registry, server_key, host);
            // Started here rather than in `allocate`, because until the lobby
            // has said the battle exists there is nothing in the slot for the
            // renewal loop to recognise as its own. Issue #2092.
            relay_host::renewing(registry, server_key, patience);
            sent
        }
        // A battle opened, and it is not going through the relay. It is at this
        // machine's own address, which is the address the route ladder measured
        // as unreachable, and measuring it that way is the only reason the relay
        // route was taken at all. So the room is a door that does not open, and
        // leaving it in the battle list sends players at it. Closing it costs a
        // room that existed for a fraction of a second and that no engine has
        // been launched into, because nothing launches until `mp_open_battle`
        // has returned (issue #2064).
        (Ok(_), Some(reason)) => {
            let _ = host.agent.stop();
            let _ = enqueue(registry, server_key, command::leave_battle());
            CliResult::err(relay_host::NoBattle::NotRelayed(reason).to_string())
        }
        // No battle and a refused address. Nothing to close, and both reasons
        // are said rather than one of them chosen.
        //
        // This arm used to report the address and drop the other, from when the
        // other was only ever "the lobby said nothing". It is not: uberserver
        // turns a battle down from six places in `in_OPENBATTLE`, none of which
        // has anything to do with the address line ahead of it. A host whose
        // coturn sits on a LAN and whose game hash came out zero has two
        // separate faults and was told about both, so choosing between them
        // throws away the one that may be the reason there is no battle (issue
        // #2145).
        (Err(why), Some(reason)) => {
            let _ = host.agent.stop();
            CliResult::err(
                relay_host::NoBattle::NotRelayedNorOpened {
                    reason,
                    why: Box::new(why),
                }
                .to_string(),
            )
        }
        // A refusal, a lobby that went quiet, or the connection ending: three
        // ways of having advertised a battle that does not exist. Each of them
        // leaves a sidecar that would hold its allocation and then refuse the
        // host's next attempt, and none of them leaves a game to protect.
        (Err(why), None) => {
            let _ = host.agent.stop();
            CliResult::err(why.to_string())
        }
    }
}

/// The two places the lobby's verdict on a battle we are opening shows up: the
/// slot its answer arrives in, and the note saying it would not take the address
/// we said the battle lives at. `None` when there is no such connection.
///
/// Taken together in one lock rather than one at a time, so they cannot come
/// from different connections under the same key.
fn watched(
    registry: &Registry,
    server_key: &str,
) -> Option<(relay_host::OpenSlot, relay_host::RefusedRelayAddress)> {
    let registry = lock_or_recover(registry);
    let conn = registry.get(server_key)?;
    Some((conn.opened.clone(), conn.relay_refused.clone()))
}

/// Hold the relay a battle is being hosted through against its connection.
fn remember_relay(registry: &Registry, server_key: &str, host: relay_host::RelayHost) {
    if let Some(conn) = lock_or_recover(registry).get(server_key) {
        *lock_or_recover(&conn.relay) = Some(host);
    }
}

/// Forget whatever relay this connection was last hosting through, telling the
/// sidecar the battle is over on the way.
///
/// The one place coilbox lets go of a relay, so the one place that has to say
/// so. Both callers are a battle ending as far as the lobby is concerned: the
/// host leaving it, and the host opening another one over the top of it.
///
/// What it deliberately does not do is stop the sidecar. Leaving a battle room
/// is not the end of a game, and a host who does it mid-match still has an
/// engine running with every other player connected through this relay.
/// [`relay_agent::RelayAgent::battle_over`] says what coilbox knows and leaves
/// the sidecar to decide, which is issue #2018 and the reason this is not a
/// `stop`.
///
/// Sent before the handle is dropped and not waited on. A write that fails is a
/// sidecar that has already gone, which is the outcome we wanted anyway.
fn forget_relay(registry: &Registry, server_key: &str) {
    let held = lock_or_recover(registry)
        .get(server_key)
        .and_then(|conn| lock_or_recover(&conn.relay).take());
    if let Some(host) = held {
        let _ = host.agent.battle_over();
    }
}

/// How much the relay is carrying right now, for whichever connection is
/// hosting through one. `None` when nothing is.
///
/// No server key, and that is a fact about the sidecar rather than a shortcut.
/// One run file means one sidecar on this machine, and
/// [`relay_agent::RelayAgent::spawn`] refuses to start a second over a battle
/// that is already being relayed, so there is at most one relay to ask about
/// however many lobbies are connected. Making the caller name a connection
/// would mean the in-game pill had to know which lobby a game came from, which
/// it has no other reason to.
///
/// `None` also covers a relay whose sidecar has stopped saying anything. See
/// [`relay_agent::RelayAgent::carrying`], which is where that decision is made
/// and why.
fn relay_traffic(registry: &Registry) -> Option<u64> {
    lock_or_recover(registry).values().find_map(|conn| {
        lock_or_recover(&conn.relay)
            .as_ref()
            .and_then(|host| host.agent.carrying())
    })
}

/// What coilbox can say about the relay carrying the game that is running.
///
/// Two answers, because they go missing separately and the in-game pill uses
/// them for different things (issue #2094). That a relay is carrying the game
/// is what decides whether ending it here ends it for everybody else, so it is
/// what the X's warning hangs on. The rate is evidence that the relay is
/// working, and a rate coilbox cannot read is not a reason to stop warning.
#[derive(Debug, PartialEq, Eq)]
struct RelayBehindTheGame {
    /// A relay on this machine is up and this game's traffic goes through it.
    relaying: bool,
    /// What it last said it was carrying, or `None` if it has not said.
    bytes_per_second: Option<u64>,
}

/// The relay behind the running game: from the handle while coilbox holds one,
/// and from the sidecar's own run file once it does not.
///
/// The second half is the whole of issue #2094. A host who leaves their battle
/// room mid-game has the handle taken off them by [`forget_relay`], and that is
/// right: the lobby battle really is over and the sidecar has been told so. The
/// game is not over. The engine is still running, every other player is still
/// connected through this machine, and ending it here still ends it for all of
/// them, so the topbar has to carry on saying so. The run file the sidecar
/// holds a lock on is the only thing left that knows.
///
/// It asks the handle first rather than only reading the file, because the file
/// cannot tell a relay this coilbox is hosting through from one left over by a
/// previous session, and [`relay_left_running`] needs that difference to stay
/// out of the topbar of a host who is in their own battle.
///
/// `run_file` is `None` only when the data directory could not be resolved.
/// That leaves the handle's answer standing rather than turning a path problem
/// into "no relay", which would be a missing warning on a destructive button.
fn relay_behind_the_game(registry: &Registry, run_file: Option<&Path>) -> RelayBehindTheGame {
    if hosting_through_the_relay(registry) {
        return RelayBehindTheGame {
            relaying: true,
            bytes_per_second: relay_traffic(registry),
        };
    }
    // The outer `Option` is whether a sidecar is there, the inner one is
    // whether it has written down what it is carrying lately, and they are not
    // the same question.
    let left_running = run_file.and_then(|path| {
        relay_sidecar::already_relaying(path)
            .map(|pid| coilbox_relay_protocol::carrying_now(path, pid))
    });
    RelayBehindTheGame {
        relaying: left_running.is_some(),
        bytes_per_second: left_running.flatten(),
    }
}

/// `mp_relay_traffic`: whether a relay on this machine is carrying the game
/// that is running and how much it is carrying, so the in-game pill can show
/// that a relayed game is still working and can ask before its X ends that game
/// for everybody (issues #2024 and #2094).
///
/// Polled rather than pushed, once a second, by the one component that draws
/// it. An event would go through the lobby event channel and redraw everything
/// mirroring it, once a second, on a machine that is busy running a game.
///
/// `relaying` is false only when there is no relay on this machine at all.
/// `bytesPerSecond` is null when there is no figure to give, which includes a
/// relay that is up and has not been heard from lately. Zero is a different
/// answer and a real one, and means the relay is there and carrying nothing.
#[tauri::command]
fn mp_relay_traffic<R: Runtime>(
    app: tauri::AppHandle<R>,
    registry: State<'_, Registry>,
) -> CliResult {
    let run_file = relay_sidecar::run_file_path(&app).ok();
    let relay = relay_behind_the_game(&registry, run_file.as_deref());
    CliResult::ok(json!({
        "relaying": relay.relaying,
        "bytesPerSecond": relay.bytes_per_second,
    }))
}

/// Whether this coilbox is itself hosting a battle through the relay sidecar.
///
/// The one thing that tells a leftover from the sidecar this coilbox started
/// seconds ago. There is at most one sidecar on the machine, so a run file
/// naming a live process while a connection holds a relay is naming that relay,
/// and asking it to stop would end a battle the host is in the middle of
/// opening.
fn hosting_through_the_relay(registry: &Registry) -> bool {
    lock_or_recover(registry)
        .values()
        .any(|conn| lock_or_recover(&conn.relay).is_some())
}

/// What came of asking a leftover relay sidecar to stop.
///
/// Five answers because the host needs five different things said to them, and
/// two of them are opposites that look identical from out here until the
/// sidecar has answered.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum StopAnswer {
    /// There was no sidecar to ask. Either nothing was running or it has gone
    /// since the host was told about it, and either way they can host now.
    Gone,
    /// It is this coilbox's own relay, for a battle it is hosting. Not a
    /// leftover, and ending it would end that battle.
    Ours,
    /// It took the note and stopped. Nothing was ever played through it.
    Stopped,
    /// It took the note and kept running, which it does when a player has been
    /// heard through the relay. Stopping it would have cut off a game.
    Carrying,
    /// Nothing took the note, and coilbox cannot show that the process is not
    /// the sidecar.
    ///
    /// The residual case, and it is genuinely two. Either something is holding
    /// the run file open, which means the sidecar is there and has stopped
    /// reading notes, or the record is from a build that took no lock and there
    /// is nothing to read. Neither can be cleared from here and both need the
    /// same thing said about them (issue #2078).
    ///
    /// A record naming a process id the OS has handed on is no longer one of
    /// these. [`relay_sidecar::already_relaying`] does not report it as a relay
    /// at all, so it arrives here as [`StopAnswer::Gone`].
    NoAnswer,
}

impl StopAnswer {
    /// The word the frontend switches on.
    fn word(self) -> &'static str {
        match self {
            StopAnswer::Gone => "gone",
            StopAnswer::Ours => "ours",
            StopAnswer::Stopped => "stopped",
            StopAnswer::Carrying => "carrying",
            StopAnswer::NoAnswer => "noAnswer",
        }
    }
}

/// Ask the sidecar named in `run_file` to stop, and wait to see what it did.
///
/// The body of [`mp_ask_leftover_relay_to_stop`], with the app handle taken out
/// so the whole rule can be tested against real files.
///
/// ## Why this cannot end somebody's match
///
/// Three separate things, and any one of them would be enough on its own.
///
/// Nothing here ends a process. It writes a note and reads the answer, and the
/// sidecar decides, because the sidecar is the only thing that knows whether a
/// game is being played through the relay. Its rule is in `stopping.rs` in
/// `coilbox-relay-agent`: a relay a player has ever been heard through keeps
/// running.
///
/// A sidecar this coilbox is hosting through is not asked at all, because it is
/// not a leftover. That is `we_are_hosting`, and without it a host who opened a
/// relayed battle and then tried to open a second one could end the first.
///
/// And the sidecar ignores a note while its own coilbox is still there, so even
/// a note written by mistake reaches a process that will not act on it.
async fn ask_the_leftover_sidecar_to_stop(
    run_file: &Path,
    we_are_hosting: bool,
) -> Result<StopAnswer, String> {
    if we_are_hosting {
        return Ok(StopAnswer::Ours);
    }
    let Some(pid) = relay_sidecar::already_relaying(run_file) else {
        return Ok(StopAnswer::Gone);
    };
    relay_sidecar::leave_a_stop_note(run_file, pid)
        .map_err(|e| format!("could not leave a note for the relay agent: {e}"))?;

    let until = tokio::time::Instant::now() + relay_sidecar::NOTE_PATIENCE;
    while tokio::time::Instant::now() < until {
        tokio::time::sleep(coilbox_relay_protocol::NOTE_LOOKED_FOR_EVERY).await;
        // The run file going is the sidecar's own last act, so this is the
        // answer rather than an inference from one.
        if relay_sidecar::already_relaying(run_file).is_none() {
            return Ok(StopAnswer::Stopped);
        }
    }
    // Still running, so the difference is whether anything read the note. A
    // sidecar carrying a game takes it and stays. A process id that is not the
    // sidecar's leaves it where it is.
    Ok(if relay_sidecar::note_was_taken(run_file) {
        StopAnswer::Carrying
    } else {
        StopAnswer::NoAnswer
    })
}

/// `mp_leftover_relay_agent`: whether a relay sidecar from an earlier session is
/// still running on this machine (issue #2062).
///
/// Asked by the hosting form when a battle would not open, so the host who was
/// told "a relay agent is already running as process 12345" gets somewhere to go
/// rather than a number. Reading the run file rather than matching on the
/// refusal's wording, because the sentence is for a person and is not a
/// protocol.
///
/// `pid` is null when there is nothing running to talk about. `ours` says the
/// sidecar belongs to a battle this coilbox is hosting, which is a different
/// problem with a different answer: end that battle first.
#[tauri::command]
fn mp_leftover_relay_agent<R: Runtime>(
    app: tauri::AppHandle<R>,
    registry: State<'_, Registry>,
) -> CliResult {
    let run_file = match relay_sidecar::run_file_path(&app) {
        Ok(path) => path,
        Err(e) => return CliResult::err(e),
    };
    CliResult::ok(json!({
        "pid": relay_sidecar::already_relaying(&run_file),
        "ours": hosting_through_the_relay(&registry),
    }))
}

/// The sidecar relaying a battle this coilbox did not start, if there is one.
///
/// The one question a reopened coilbox can answer about a game it knows nothing
/// about (issue #2074). Somebody who closes coilbox mid-game and opens it again
/// is still carrying every other player's traffic on their machine, and until
/// this there was nothing on screen to say so.
///
/// `we_are_hosting` is what keeps a host's own battle out of it. There is one
/// sidecar per machine, so the relay this coilbox started and a relay left over
/// from a previous one are the same run file, and only the registry tells them
/// apart. Without the check, opening a relayed battle would put a second pill in
/// the topbar telling the host about their own game in the third person.
///
/// That check goes false the moment the host leaves their battle room, which is
/// the window [`relay_behind_the_game`] covers, so for that window both readers
/// answer yes about the same sidecar. Two pills do not appear, because the
/// caller here stops asking the first time it hears no and a coilbox that could
/// host through the relay had already heard one: a sidecar is refused while
/// another is relaying, so there was nothing to find when this coilbox opened.
///
/// The pid stays in Rust. It is what [`coilbox_relay_protocol::carrying_now`]
/// checks the figure against, and it has no other reader.
fn relay_left_running(run_file: &Path, we_are_hosting: bool) -> Option<u32> {
    if we_are_hosting {
        return None;
    }
    relay_sidecar::already_relaying(run_file)
}

/// `mp_relay_left_running`: whether a relay this coilbox did not start is
/// running on this machine, and what it says it is carrying (issue #2074).
///
/// ## What it can and cannot know
///
/// That a relay is running is proved rather than inferred: the sidecar holds a
/// shared lock on its run file for as long as it lives, so the record naming a
/// live process is the sidecar and not a process id the OS handed on
/// (issue #2078).
///
/// The rate is the sidecar's own measurement, read from the record it writes
/// beside that run file every second. `bytesPerSecond` is null whenever coilbox
/// cannot read a current one, which the caller draws as nothing at all rather
/// than as a figure.
///
/// What is not here is anything about the game. coilbox did not launch this
/// engine, has no handle on it and no record of it, so it cannot say a game is
/// running, cannot say which battle it is, and cannot end it. The relay ends on
/// its own when the game does, which is `stopping.rs` in `coilbox-relay-agent`.
#[tauri::command]
fn mp_relay_left_running<R: Runtime>(
    app: tauri::AppHandle<R>,
    registry: State<'_, Registry>,
) -> CliResult {
    let run_file = match relay_sidecar::run_file_path(&app) {
        Ok(path) => path,
        Err(e) => return CliResult::err(e),
    };
    let found = relay_left_running(&run_file, hosting_through_the_relay(&registry));
    CliResult::ok(json!({
        "relaying": found.is_some(),
        "bytesPerSecond": found
            .and_then(|pid| coilbox_relay_protocol::carrying_now(&run_file, pid)),
    }))
}

/// `mp_ask_leftover_relay_to_stop`: ask a leftover relay sidecar to stop, and
/// say what it did (issue #2062).
///
/// The way out of the dead end. A sidecar that outlived its coilbox cannot be
/// spoken to over the control channel, because that is a dead process's pipes,
/// so this leaves a note beside the run file and reads the answer.
///
/// It asks rather than ends, and [`ask_the_leftover_sidecar_to_stop`] carries
/// the three reasons that makes it safe to offer as a button. The short version
/// is that a running sidecar may be carrying a match, and the one process that
/// knows is the one that decides.
///
/// Takes up to [`relay_sidecar::NOTE_PATIENCE`], which is spent in full only
/// when the answer is that the sidecar kept going.
#[tauri::command]
async fn mp_ask_leftover_relay_to_stop<R: Runtime>(
    app: tauri::AppHandle<R>,
    registry: State<'_, Registry>,
) -> Result<CliResult, ()> {
    let run_file = match relay_sidecar::run_file_path(&app) {
        Ok(path) => path,
        Err(e) => return Ok(CliResult::err(e)),
    };
    let we_are_hosting = hosting_through_the_relay(&registry);
    Ok(
        match ask_the_leftover_sidecar_to_stop(&run_file, we_are_hosting).await {
            Ok(answer) => CliResult::ok(json!({ "outcome": answer.word() })),
            Err(e) => CliResult::err(e),
        },
    )
}

/// Tell the relay this connection's battle is hosted through which process the
/// engine is. Answers whether there was one to tell.
///
/// Named by connection rather than found by looking, which is the difference
/// between "the relay for the battle that was launched" and "a relay". Those
/// are the same thing today only because [`relay_agent::RelayAgent::spawn`]
/// refuses to start a second sidecar over a run file that already names a live
/// one, so a scan of the registry has at most one thing to find. That is a
/// check on a file made by a process that has not written it yet, in a plugin
/// two layers down, and the thing riding on it is which game's players get cut
/// off. So this asks the connection whose engine it is (issue #2099).
///
/// [`relay_traffic`] still takes no key, and that is not an inconsistency. It
/// answers "is there a relay on this machine", which the in-game pill asks
/// without knowing which lobby a game came from. This one names a process to a
/// specific sidecar and has a caller that always knows.
///
/// The agent is taken out of the registry before the write, so the lock is not
/// held across it. Nothing here waits for an answer and a write that fails is
/// not reported, both for the reason on
/// [`relay_agent::RelayAgent::watch_engine`]: a sidecar that cannot be reached
/// has already stopped, and one that never hears this stops on its traffic
/// backstop rather than leaking.
fn watch_engine(registry: &Registry, server_key: &str, pid: u32) -> bool {
    let agent = lock_or_recover(registry).get(server_key).and_then(|conn| {
        lock_or_recover(&conn.relay)
            .as_ref()
            .map(|host| Arc::clone(&host.agent))
    });
    match agent {
        Some(agent) => {
            let _ = agent.watch_engine(pid);
            true
        }
        None => false,
    }
}

/// `mp_watch_engine`: name the engine coilbox has just launched to the relay
/// sidecar, so it knows the game is over once that process has gone (issue
/// #2065).
///
/// Without this the sidecar has only its traffic backstop to go on, and a host
/// who finishes a relayed game and leaves the battle holds the relay server's
/// port and bandwidth for the four minutes of
/// `coilbox_relay_agent::stopping::IDLE_TIMEOUT`. With it the allocation goes
/// back about a second after the engine exits.
///
/// ## Why this takes a run id and not a pid
///
/// Because the sidecar stops relaying when the process it was told to watch
/// exits. A pid that is not the engine's, or one belonging to something that
/// ends early, cuts off a game other people are still playing, which is the
/// failure the whole sidecar exists to prevent. So the pid is never a number
/// somebody passes in. It is looked up here, at the moment of asking, in the
/// launcher plugin's registry of running engines
/// ([`tauri_plugin_coilbox_play::engine_pid`]), which only ever holds a child
/// nothing has waited on. A run that has finished has no pid to give and this
/// says so rather than sending the one it used to have.
///
/// A pid the OS later gives to something unrelated is the other way round and
/// is safe: the sidecar reads it as an engine that is still running, so it
/// falls back to the backstop it would have used anyway. `run_file.rs` in the
/// agent reasons about a recycled pid the same way.
///
/// ## Why it also takes a server key
///
/// Because "which engine" and "which relay" are two halves of one pairing and
/// both have to be about the same battle. The run id settles the engine. The
/// key settles the relay, so a launch on a connection that is hosting nothing
/// through a relay answers `watching: false` and writes no line, rather than
/// handing its pid to a sidecar carrying a different battle (issue #2099).
///
/// ## What calls it
///
/// Only a host whose battle went through the relay, on the launch of the engine
/// that is playing it. An ordinary game never reaches here at all, and one that
/// does with no relay to tell answers `watching: false` rather than failing.
#[tauri::command]
fn mp_watch_engine<R: Runtime>(
    app: tauri::AppHandle<R>,
    registry: State<'_, Registry>,
    server_key: String,
    run_id: String,
) -> CliResult {
    match tauri_plugin_coilbox_play::engine_pid(&app, &run_id) {
        Some(pid) => {
            CliResult::ok(json!({ "watching": watch_engine(&registry, &server_key, pid) }))
        }
        None => CliResult::err("no running game with that id"),
    }
}

/// `mp_zerok_open_battle`, Zero-K only: ask the server to open a room for us.
///
/// The Zero-K counterpart of [`mp_open_battle`], and a different thing under the
/// same word. Opening a battle on TASServer makes this machine the host, so the
/// line carries a port, a NAT mode and the hashes joiners check themselves
/// against. Zero-K's server runs every match itself, so none of those exist and
/// what is left is what the room is: a title, a map, a size, a mode and an
/// optional password. Being its founder is the right to run the room's commands
/// without a vote, not a game running here.
///
/// The map is a request rather than a setting. The server resolves it against
/// its own content and picks a recommended one when it cannot, which is also
/// why the game is not asked for at all.
#[tauri::command]
fn mp_zerok_open_battle(
    registry: State<'_, Registry>,
    server_key: String,
    title: String,
    map: Option<String>,
    mode: String,
    max_players: u32,
    password: Option<String>,
) -> CliResult {
    let Some(mode) = zerok_room::autohost_mode(&mode) else {
        return CliResult::err(format!("{mode} is not a battle mode"));
    };
    zerok_room_action(
        registry.inner(),
        &server_key,
        zerok_room::RoomAction::Open {
            title,
            map,
            mode,
            max_players,
            password,
        },
    )
    .unwrap_or_else(|| CliResult::err("this server does not open battles for its players"))
}

/// `mp_start_battle`: ask for the match to begin.
#[tauri::command]
fn mp_start_battle(registry: State<'_, Registry>, server_key: String) -> CliResult {
    // On Tachyon any member may ask, and the server allocates a machine to run
    // the match and sends every player its address. SPADS has no command for it,
    // so on the line protocol this stays `!start` in battle chat for the
    // autohost bot in the room to read.
    if let Some(result) = tachyon_action(
        registry.inner(),
        &server_key,
        TachyonAction::Room(RoomAction::StartBattle),
    ) {
        return result;
    }
    // Zero-K has no command for it either, and its autohost reads `!start` out
    // of battle chat the same way SPADS does.
    if let Some(result) = zerok_room_action(
        registry.inner(),
        &server_key,
        zerok_room::RoomAction::Say {
            text: "!start".into(),
        },
    ) {
        return result;
    }
    enqueue(registry.inner(), &server_key, command::say_battle("!start"))
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
    // `UpdateBotStatus` both seats a bot and moves one, keyed by the name, so
    // adding and updating are the same command on Zero-K. The name is ours to
    // pick: the server looks it straight up in the room's bot dictionary and
    // throws on an absent one rather than generating anything.
    if let Some(result) = zerok_room_action(
        registry.inner(),
        &server_key,
        zerok_room::RoomAction::Bot {
            name: name.clone(),
            ally,
            ai: ai_dll.clone(),
        },
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
    if let Some(ai) = ai_dll.clone() {
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
    // Zero-K's `UpdateBotStatus` is a patch keyed by the name, so it moves a bot
    // and changes its AI in one command rather than needing a remove and a
    // re-add. The AI it is already running goes back out when the caller is only
    // moving it, because the message carries both.
    if let Some(conn_ai) = ai_dll.or_else(|| {
        let map = lock_or_recover(&registry);
        let conn = map.get(&server_key)?;
        let held = lock_or_recover(&conn.state);
        let battle = held.battles.get(&held.current_battle?)?;
        Some(battle.bots.get(&name)?.ai_dll.clone())
    }) {
        if let Some(result) = zerok_room_action(
            registry.inner(),
            &server_key,
            zerok_room::RoomAction::Bot {
                name: name.clone(),
                ally,
                ai: conn_ai,
            },
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
    if let Some(result) = zerok_room_action(
        registry.inner(),
        &server_key,
        zerok_room::RoomAction::RemoveBot { name: name.clone() },
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
    if let Some(result) = zerok_room_action(
        registry.inner(),
        &server_key,
        zerok_room::RoomAction::Kick {
            username: username.clone(),
        },
    ) {
        return result;
    }
    enqueue(
        registry.inner(),
        &server_key,
        command::kick_from_battle(&username),
    )
}

/// `mp_cast_vote`: vote yes, no or abstain in the battle's open vote.
#[tauri::command]
fn mp_cast_vote(
    registry: State<'_, Registry>,
    server_key: String,
    choice: VoteChoice,
) -> CliResult {
    // Tachyon holds the vote itself, so this is `lobby/voteSubmit` against the
    // vote the lobby is holding. SPADS has no command for it: a vote there is
    // battle chat to the autohost, which is what the scraper reads back.
    if let Some(result) = tachyon_action(
        registry.inner(),
        &server_key,
        TachyonAction::Room(RoomAction::CastVote { choice }),
    ) {
        return result;
    }
    // Zero-K has no vote command either. Its official client puts a vote in
    // battle chat, which is why its autohost reads one there. There is no third
    // answer to type, and the room does not offer one because a Zero-K poll
    // never advertises an abstain.
    if is_zerok(registry.inner(), &server_key) {
        return match zerok_room::vote_text(choice) {
            Some(text) => zerok_room_action(
                registry.inner(),
                &server_key,
                zerok_room::RoomAction::Say { text: text.into() },
            )
            .unwrap_or_else(|| CliResult::err("connection is closed")),
            None => CliResult::err("a Zero-K poll has only two answers"),
        };
    }
    let letter = match choice {
        VoteChoice::Yes => "y",
        VoteChoice::No => "n",
        VoteChoice::Abstain => "b",
    };
    enqueue(
        registry.inner(),
        &server_key,
        command::say_battle(&format!("!vote {letter}")),
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
///
/// Several lines for a long tag list, since a battle publishes its game's whole
/// option list (#1837) and SPADS packs script tags to 900 characters a line.
#[tauri::command]
fn mp_set_script_tags(
    registry: State<'_, Registry>,
    server_key: String,
    tags: BTreeMap<String, String>,
) -> CliResult {
    // Zero-K splits this in two and takes each whole. `SetModOptions` and
    // `SetMapOptions` assign the dictionary they are handed, so a key left out
    // is a key removed, which is why the caller's tags are read as the whole of
    // each namespace rather than as a patch over it. It has nothing for a start
    // position type or a unit restriction, so those go nowhere.
    if is_zerok(registry.inner(), &server_key) {
        return zerok_option_actions(registry.inner(), &server_key, &tags);
    }
    enqueue_all(
        registry.inner(),
        &server_key,
        command::set_script_tags(&tags),
    )
}

/// Send a tag map to a Zero-K connection as its two option commands.
///
/// Only the namespaces Zero-K has a command for, and only when the caller named
/// something in them, so a push that carried nothing but unit restrictions sends
/// nothing rather than clearing the room's options.
fn zerok_option_actions(
    registry: &Registry,
    server_key: &str,
    tags: &BTreeMap<String, String>,
) -> CliResult {
    let under = |prefix: &str| -> BTreeMap<String, String> {
        tags.iter()
            .filter_map(|(key, value)| {
                let key = key.to_lowercase();
                let name = key.strip_prefix(prefix)?.to_owned();
                Some((name, value.clone()))
            })
            .collect()
    };

    let mod_options = under("game/modoptions/");
    let map_options = under("game/mapoptions/");
    let mut last = CliResult::ok(json!({ "sent": true }));
    for action in [
        (!mod_options.is_empty()).then_some(zerok_room::RoomAction::ModOptions(mod_options)),
        (!map_options.is_empty()).then_some(zerok_room::RoomAction::MapOptions(map_options)),
    ]
    .into_iter()
    .flatten()
    {
        last = zerok_room_action(registry, server_key, action)
            .unwrap_or_else(|| CliResult::err("connection is closed"));
        if !last.success {
            return last;
        }
    }
    last
}

/// `mp_remove_script_tags` — host: clear game script tags by key.
///
/// Several lines for a long key list, the same as setting them. Cutting a unit
/// restriction list back removes two tags per unit (#1867), so a hundred units
/// is 201 keys and four times the budget SPADS packs a removal line to.
#[tauri::command]
fn mp_remove_script_tags(
    registry: State<'_, Registry>,
    server_key: String,
    tags: Vec<String>,
) -> CliResult {
    let refs: Vec<&str> = tags.iter().map(String::as_str).collect();
    enqueue_all(
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
    let mut teams: BTreeMap<u8, Team> = BTreeMap::new();
    let mut allies: BTreeSet<u8> = BTreeSet::new();

    for (name, ms) in members {
        let bs = ms.battle_status;
        let is_player = bs.mode; // mode == true -> playing, false -> spectating
        let mut player = Player {
            name: name.clone(),
            spectator: !is_player,
            team: None,
        };
        if is_player {
            player.team = Some(u32::from(bs.team_id));
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
        ais.push(Ai {
            name: name.clone(),
            short_name: bot.ai_dll.clone(),
            team: u32::from(bs.team_id),
            host: 0,
            ..Default::default()
        });
        teams
            .entry(bs.team_id)
            .or_insert_with(|| team_value(bs.ally, bot.team_color));
        allies.insert(bs.ally);
    }

    // Joiners get a minimal client script from the host engine and RESTRICT is
    // host-authoritative (engine-level), so the join config drops restrictions.
    let (start_pos_type, mod_options, map_options, _restricted_units) =
        split_script_tags(&battle.script_tags);

    let ally_teams: Vec<AllyTeam> = allies
        .iter()
        .map(|_| AllyTeam {
            num_allies: 0,
            start_rect: None,
        })
        .collect();
    let my_passwd = battle
        .members
        .get(&me)
        .and_then(|m| m.script_password.clone());

    to_config_value(BattleConfig {
        map_name: battle.map.clone(),
        game_type: battle.modname.clone(),
        my_player_name: me,
        start_pos_type,
        mod_options,
        map_options,
        players,
        ais,
        teams: teams.into_values().collect(),
        ally_teams,
        is_host: false,
        host_ip: Some(battle.ip.clone()),
        host_port: battle.port.parse::<u16>().ok(),
        my_passwd,
        ..Default::default()
    })
}

/// Serialize a typed `BattleConfig` to the `Value` these builders hand back, the
/// one boundary where a `BattleConfig` becomes JSON instead of being built as
/// JSON by hand field by field.
fn to_config_value(cfg: BattleConfig) -> Result<Value, String> {
    serde_json::to_value(cfg).map_err(|e| format!("failed to serialize battle config: {e}"))
}

/// One `teams[]` entry: RGB normalized to the engine's 0..1 floats.
fn team_value(ally: u8, color: u32) -> Team {
    let (r, g, b) = team_color_rgb(color);
    Team {
        team_leader: 0,
        ally_team: u32::from(ally),
        rgb_color: [r as f32 / 255.0, g as f32 / 255.0, b as f32 / 255.0],
        ..Default::default()
    }
}

/// Map the current battle into a HOST-mode `BattleConfig` (`isHost:true`), binding
/// the engine to our assigned `HOSTPORT`. Unlike the join builder this renumbers the
/// wire `team_id`/`ally` bitfields into the contiguous 0..N index space the engine's
/// positional `[TEAMn]`/`[ALLYTEAMn]` blocks require (see `TODO(host)` above), so
/// `players[].team` indexes the `teams[]` array directly.
///
/// `relay` is set when this battle is being hosted through the lobby's relay, and
/// it changes both halves of where the engine listens. Read the comment at the
/// bottom of this function before changing either.
fn battle_to_host_config(
    state: &LobbyState,
    relay: Option<&relay_host::RelayHost>,
) -> Result<Value, String> {
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

    let mut teams: BTreeMap<usize, Team> = BTreeMap::new();
    let mut players = Vec::new();
    for (i, (name, ms)) in members.iter().enumerate() {
        let bs = ms.battle_status;
        let mut player = Player {
            name: (*name).clone(),
            spectator: !bs.mode,
            team: None,
        };
        if bs.mode {
            let pos = team_index[&bs.team_id];
            player.team = Some(pos as u32);
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
        ais.push(Ai {
            name: (*name).clone(),
            short_name: bot.ai_dll.clone(),
            team: pos as u32,
            host: owner as u32,
            ..Default::default()
        });
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
    let ally_teams: Vec<AllyTeam> = ally_ids
        .iter()
        .map(|raw| AllyTeam {
            num_allies: 0,
            start_rect: battle.start_rects.get(raw).map(|r| {
                [
                    r.top as f32 / 200.0,
                    r.left as f32 / 200.0,
                    r.bottom as f32 / 200.0,
                    r.right as f32 / 200.0,
                ]
            }),
        })
        .collect();

    // Where the host's engine listens, which is not where the battle is
    // advertised once a relay is involved.
    //
    // Without a relay these are the same thing: the engine binds every interface
    // on the port the battle was opened at, and joiners arrive on it straight
    // from the internet.
    //
    // With one they are two different machines. The battle is advertised at an
    // allocation on the relay server, so `battle.port` is the relay's port and
    // binding the engine to it would put the engine on a number that means
    // nothing here. The relay agent sends every player's traffic to
    // `127.0.0.1:<engine port>` (`coilbox-relay-agent`, `main.rs:380`), so that
    // is the only address the engine can usefully be at, and the port has to be
    // the one the agent was started with rather than anything the lobby echoed
    // back.
    //
    // The host still plays in their own battle, and does not go through the relay
    // to do it. `CPreGame` gives a host `InitLocalClient()`
    // (`rts/Game/PreGame.cpp:92`), an in-process connection, so `HostIP` only
    // ever decides where the host's own server binds. Narrowing it to loopback
    // costs the host's client nothing.
    //
    // The engine logs `opening socket on loopback address, other users will not
    // be able to connect!` when it binds one (`rts/System/Net/UDPListener.cpp`,
    // `TryBindSocket`). It is a warning rather than a refusal, and under a relay
    // it is untrue: other users connect to the relay, and the relay agent
    // connects here. Nothing can stop the engine saying it, so
    // `hostLoopbackReason` puts the explanation into the start script as a
    // comment, which is the file sitting next to the infolog somebody has just
    // read the warning in.
    let (host_ip, host_port) = match relay {
        Some(relay) => ("127.0.0.1", Some(relay.engine_port)),
        None => (
            "0.0.0.0",
            state.host_port.or_else(|| battle.port.parse::<u16>().ok()),
        ),
    };

    let host_loopback_reason = relay.map(|relay| {
        format!(
            "This battle is relayed through {}, so the engine listens on loopback and the relay \
             agent carries every player to it. The engine's warning about a loopback socket does \
             not apply.",
            relay.relayed
        )
    });

    to_config_value(BattleConfig {
        map_name: battle.map.clone(),
        game_type: battle.modname.clone(),
        my_player_name: me,
        start_pos_type,
        mod_options,
        map_options,
        restricted_units,
        players,
        ais,
        teams: teams.into_values().collect(),
        ally_teams,
        is_host: true,
        host_ip: Some(host_ip.to_string()),
        host_port,
        host_loopback_reason,
        ..Default::default()
    })
}

/// One host-mode `teams[]` entry, with an already-renumbered ally index and the
/// player number leading the team.
fn host_team_value(ally: usize, color: u32, leader: usize) -> Team {
    let (r, g, b) = team_color_rgb(color);
    Team {
        team_leader: leader as u32,
        ally_team: ally as u32,
        rgb_color: [r as f32 / 255.0, g as f32 / 255.0, b as f32 / 255.0],
        ..Default::default()
    }
}

/// `mp_build_host_config` — return the current (hosted) battle as a host-mode
/// `play` `BattleConfig`, and say whether that battle is going through a relay.
///
/// `relayed` is the same handle the config is built from, said out loud. The
/// launch needs it: the in-game pill's warning and the engine it names to the
/// sidecar both turn on whether this game is the relayed one, and until issue
/// #2099 the launch worked that out from a module singleton holding the route
/// of the last battle this client hosted anywhere. Here it is a fact about the
/// connection whose battle is being launched, read under the same lock as the
/// config, so the two cannot come from different battles.
///
/// The handle is exactly "the relay the battle currently open on this
/// connection is hosted through". [`open_battle`] drops it before every attempt
/// and [`forget_relay`] drops it when the host leaves, so it never outlives the
/// battle it describes.
#[tauri::command]
fn mp_build_host_config(registry: State<'_, Registry>, server_key: String) -> CliResult {
    let map = lock_or_recover(&registry);
    match map.get(&server_key) {
        Some(conn) => {
            let relay = lock_or_recover(&conn.relay);
            let state = lock_or_recover(&conn.state);
            match host_config_answer(&state, relay.as_ref()) {
                Ok(answer) => CliResult::ok(answer),
                Err(e) => CliResult::err(e),
            }
        }
        None => CliResult::err(format!("not connected: {server_key}")),
    }
}

/// Both halves of [`mp_build_host_config`]'s answer, built from one relay
/// handle so they cannot disagree about whether this battle is relayed.
fn host_config_answer(
    state: &LobbyState,
    relay: Option<&relay_host::RelayHost>,
) -> Result<Value, String> {
    Ok(json!({
        "config": battle_to_host_config(state, relay)?,
        "relayed": relay.is_some(),
    }))
}

/// `mp_build_battle_config` — return the current battle as a `play` `BattleConfig`.
///
/// A Tachyon battle is not built from the lobby at all. The server picks an
/// autohost and tells each player where to connect in a `battle/start` request,
/// so the config the connection built from that request is the only one there
/// is, and until one arrives there is nothing to launch.
#[tauri::command]
fn mp_build_battle_config(registry: State<'_, Registry>, server_key: String) -> CliResult {
    let map = lock_or_recover(&registry);
    match map.get(&server_key) {
        Some(conn) if lock_or_recover(&conn.tachyon).is_some() => {
            match lock_or_recover(&conn.started).clone() {
                // Nothing needs opening through a router: the address is the
                // server's own autohost.
                Some(config) => CliResult::ok(json!({ "config": config, "natType": "0" })),
                None => CliResult::err("this lobby has not started a battle"),
            }
        }
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

/// How long quitting waits for the lobby to mint one last relay credential.
///
/// A budget for the quit rather than a deadline the lobby has to meet. Half a
/// second is more than twice the slowest lobby round trip anybody has measured
/// for this repo, 234 ms across 90 `LISTCOMPFLAGS` exchanges with three real
/// TASServer lobbies on 30 August 2026, recorded on
/// [`relay_host::MOVE_ANSWER_PATIENCE`]. It is also the half second
/// `tauri-plugin-coilbox-direct` already spends handing router ports back on
/// the way out, and the two never fire together: a host takes the relay route
/// precisely because their ports do not work.
///
/// Being mean costs the renewal, which leaves the sidecar holding what it holds
/// today. Being generous costs a slow quit, and an app that hangs on quit is the
/// worse bug.
const EXIT_RENEWAL_BUDGET: Duration = Duration::from_millis(500);

/// Top a relayed battle's credential up on the way out, so the sidecar carries a
/// whole lifetime into the part of the game coilbox will not see (issue #2105).
///
/// [`relay_host::renew_before_quitting`] is what it does and why it is all that
/// can be done. This is the wiring: the same shape as
/// `tauri-plugin-coilbox-direct`'s port release, because it has the same
/// problem. The work is async, `RunEvent::Exit` is not, and the runtime is still
/// turning while this thread waits, so the ask makes progress and the app quits
/// regardless once the budget is gone.
///
/// Nothing is spawned on a quit with no relayed battle, which is every quit but
/// a host's.
///
/// `quitting_hands_a_relayed_battle_one_last_credential` drives this through a
/// real `RunEvent::Exit`. The sentence above has no test of its own and issue
/// #2136 asked for one: a version that spawned regardless would find nothing to
/// renew and finish just as fast, so there is no difference between the two to
/// assert on.
fn renew_relays_on_exit<R: Runtime>(app: &AppHandle<R>) {
    let Some(registry) = app.try_state::<Registry>() else {
        return;
    };
    let registry = Registry::clone(&registry);
    if relay_host::relaying_on(&registry).is_empty() {
        return;
    }
    let (done, finished) = std::sync::mpsc::channel();
    tauri::async_runtime::spawn(async move {
        relay_host::renew_before_quitting(&registry, EXIT_RENEWAL_BUDGET).await;
        let _ = done.send(());
    });
    let _ = finished.recv_timeout(EXIT_RENEWAL_BUDGET);
}

/// Build the plugin. Registered as `"coilbox-multiplayer"`.
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("coilbox-multiplayer")
        .on_event(|app, event| {
            if matches!(event, RunEvent::Exit) {
                renew_relays_on_exit(app);
            }
        })
        .setup(|app, _api| {
            app.manage(Registry::default());
            app.manage(PendingConnects::default());
            app.manage(TachyonMarkers::default());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            mp_connect,
            mp_connect_tachyon,
            mp_connect_zerok,
            mp_register_zerok,
            mp_register,
            mp_confirm_agreement,
            mp_disconnect,
            mp_cancel_connect,
            mp_wait_until_ready,
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
            tachyon_parties::mp_party_create,
            tachyon_parties::mp_party_leave,
            tachyon_parties::mp_party_invite,
            tachyon_parties::mp_party_cancel_invite,
            tachyon_parties::mp_party_kick_member,
            tachyon_parties::mp_party_accept_invite,
            tachyon_parties::mp_party_decline_invite,
            tachyon_matchmaking::mp_matchmaking_list,
            tachyon_matchmaking::mp_matchmaking_queue,
            tachyon_matchmaking::mp_matchmaking_ready,
            tachyon_matchmaking::mp_matchmaking_cancel,
            mp_join_battle,
            mp_join_battle_deny,
            mp_leave_battle,
            mp_set_status,
            mp_set_battle_status,
            mp_open_battle,
            mp_zerok_open_battle,
            tachyon_room::mp_create_lobby,
            mp_start_battle,
            mp_update_battle_info,
            mp_add_bot,
            mp_remove_bot,
            mp_update_bot,
            mp_force_team,
            mp_force_ally,
            mp_force_color,
            mp_force_spectator,
            mp_kick,
            mp_cast_vote,
            tachyon_room::mp_appoint_boss,
            tachyon_room::mp_unboss,
            mp_set_start_rect,
            mp_remove_start_rect,
            mp_set_script_tags,
            mp_remove_script_tags,
            mp_build_battle_config,
            mp_build_host_config,
            probe::mp_probe_host,
            turn::mp_turn_credentials,
            mp_relay_traffic,
            mp_leftover_relay_agent,
            mp_relay_left_running,
            mp_ask_leftover_relay_to_stop,
            mp_watch_engine,
            mp_chat_logs,
            mp_chat_log_open,
            tachyon_auth::mp_tachyon_sign_in,
            tachyon_auth::mp_tachyon_sign_out,
            tachyon_auth::mp_tachyon_signed_in,
            tachyon_debug::mp_tachyon_request,
        ])
        .build()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::relay_host::tests::hosting_and_renewing;
    use crate::turn::tests::{KEY, NOW};
    use coilbox_lobby_protocol::{Battle, Bot, MemberStatus, StartRect};
    use std::sync::Arc;
    use tauri::test::{mock_app, mock_builder, mock_context, noop_assets, MockRuntime};
    use tauri::WebviewWindowBuilder;

    /// Build the plugin into an app and quit it, so the handler is reached the
    /// way a real quit reaches it rather than by being called by hand.
    ///
    /// `fill` runs once the plugin's setup has, which is where the state the
    /// handler reads comes from. Closing the only window is how this runtime is
    /// asked to quit: `request_exit` is unimplemented on it, so `AppHandle::exit`
    /// is not a route.
    fn quit(fill: impl Fn(&AppHandle<MockRuntime>) + 'static) {
        let app = mock_builder()
            .plugin(init())
            .build(mock_context(noop_assets()))
            .expect("the plugin builds into an app");
        WebviewWindowBuilder::new(&app, "main", Default::default())
            .build()
            .expect("a window, because closing the last one is the quit");
        app.run(move |handle, event| {
            if matches!(event, RunEvent::Ready) {
                fill(handle);
                handle
                    .get_webview_window("main")
                    .expect("the window is still open")
                    .close()
                    .expect("closing it asks the app to quit");
            }
        });
    }

    /// Issue #2105's wiring. A host who closes coilbox mid-battle hands the
    /// sidecar one last credential on the way out, so it carries a whole
    /// lifetime into the part of the game coilbox will not see.
    ///
    /// [`relay_host::renew_before_quitting`] is what happens and has its own
    /// tests. This one is about the quit reaching it at all, so it fails if the
    /// handler stops being wired to `RunEvent::Exit`, if the [`Registry`] stops
    /// being managed, and if the ask is spawned but the quit no longer waits
    /// for it.
    #[test]
    fn quitting_hands_a_relayed_battle_one_last_credential() {
        let mut w = hosting_and_renewing();
        // Nothing due for the better part of an hour, so a schedule is not what
        // makes this happen.
        w.credential_runs_out_at(NOW + 5_115_000);
        // `EXIT_RENEWAL_BUDGET` is spent on the runtime the handler spawns onto,
        // so the lobby has to be answering on that same runtime rather than on
        // one of the test's own.
        let runtime = tauri::async_runtime::handle();
        let inside = runtime.inner().enter();
        w.lobby_answers_when_asked(86_400, NOW);
        drop(inside);

        // `hosting_and_renewing` builds its own registry, and the plugin manages
        // its own, so the relaying connection is moved across into the one the
        // handler will look up.
        let hosting = Mutex::new(lock_or_recover(&w.registry).remove(KEY));
        quit(move |handle| {
            let taken = lock_or_recover(&hosting)
                .take()
                .expect("the app is ready once, so this is the only call");
            lock_or_recover(&handle.state::<Registry>()).insert(KEY.to_string(), taken);
        });

        let sent = w.written.sent();
        assert!(
            sent.contains("\"type\":\"renewCredential\"")
                && sent.contains("\"user\":\"1786086400:alice\"")
                && sent.contains("\"password\":\"bWFj=\""),
            "quitting has to put a fresh credential in the sidecar's hands: {sent}"
        );
    }

    /// The plugin's setup has not run, so there is no [`Registry`] to read.
    /// Quitting has to be nothing at all rather than a panic on the way out.
    #[test]
    fn quitting_with_nothing_managed_is_not_a_panic() {
        renew_relays_on_exit(mock_app().handle());
    }

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
        let cfg = battle_to_host_config(&hosted_state(), None).unwrap();
        assert_eq!(cfg["isHost"], true);
        assert_eq!(cfg["hostIp"], "0.0.0.0");
        assert_eq!(cfg["hostPort"], 8452);
        assert_eq!(cfg["myPlayerName"], "me");
        // Host scripts carry no client script password.
        assert!(cfg.get("myPasswd").is_none());
    }

    /// The engine's port on a relayed host, which the lobby knows nothing about.
    const RELAYED_ENGINE_PORT: u16 = 8452;

    /// A battle the lobby is advertising at the relay, which is what it looks
    /// like from this end once `mp_open_battle` has opened one.
    ///
    /// `battle.port` is the relay's port, because that is the port the lobby was
    /// sent and the port it echoes back in `BATTLEOPENED`. `host_port` is empty
    /// because `HOSTPORT` only ever arrives for a client that sent
    /// `UDPSOURCEPORT`, which coilbox does not.
    fn relayed_state() -> LobbyState {
        let mut state = hosted_state();
        state.host_port = None;
        if let Some(battle) = state.battles.get_mut(&9) {
            battle.port = "30001".into();
        }
        state
    }

    /// A relay carrying that battle, with a control channel that goes nowhere.
    fn a_relay() -> relay_host::RelayHost {
        a_relay_writing_to(Vec::new())
    }

    /// The same relay, with its control channel pointed somewhere a test can
    /// read. Which is how every test about issue #2058 asks its question: not
    /// "was a flag set" but "did a `stop` reach the sidecar's stdin".
    fn a_relay_writing_to(to_agent: impl std::io::Write + Send + 'static) -> relay_host::RelayHost {
        struct Nothing;
        impl std::io::Read for Nothing {
            fn read(&mut self, _: &mut [u8]) -> std::io::Result<usize> {
                Ok(0)
            }
        }
        relay_host::RelayHost {
            engine_port: RELAYED_ENGINE_PORT,
            relayed: "198.51.100.9:30001".parse().expect("an address"),
            agent: Arc::new(relay_agent::RelayAgent::driving(Nothing, to_agent, |_| {})),
            moves: relay_host::MoveWatch::default(),
            credential: relay_host::CredentialWatch::default(),
        }
    }

    /// Everything coilbox wrote to a relay agent's stdin, readable while the
    /// agent still holds its end.
    #[derive(Clone, Default)]
    struct Channelled(Arc<Mutex<Vec<u8>>>);

    impl Channelled {
        fn sent(&self) -> String {
            String::from_utf8(lock_or_recover(&self.0).clone()).expect("the channel is UTF-8")
        }

        fn was_stopped(&self) -> bool {
            self.sent().contains("\"type\":\"stop\"")
        }

        fn was_told_the_battle_is_over(&self) -> bool {
            self.sent().contains("\"type\":\"battleOver\"")
        }
    }

    impl std::io::Write for Channelled {
        fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
            lock_or_recover(&self.0).extend_from_slice(buf);
            Ok(buf.len())
        }

        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }

    /// The third acceptance criterion of issue #2017, and the easiest thing in
    /// it to get wrong.
    ///
    /// A relayed battle is advertised at the relay's port, so that is the port
    /// the lobby hands back. Binding the host's own engine to it would put the
    /// engine on a number that means nothing on this machine, while the relay
    /// agent went on delivering every player to the port it was started with. The
    /// host would then be relaying a battle their own engine is not in.
    #[test]
    fn a_relayed_host_binds_its_own_engine_port_and_not_the_relays() {
        let cfg = battle_to_host_config(&relayed_state(), Some(&a_relay())).unwrap();
        assert_eq!(cfg["hostPort"], RELAYED_ENGINE_PORT);
        assert_ne!(
            cfg["hostPort"], 30001,
            "the relay's port is where players send, not where this engine listens"
        );
    }

    /// And the other half: the same battle with no relay is read the way it
    /// always was, off the port the lobby named. This is what says the line above
    /// is the relay changing the answer rather than the answer having been
    /// nothing to do with the lobby all along.
    #[test]
    fn the_same_battle_without_a_relay_still_binds_the_port_the_lobby_named() {
        let cfg = battle_to_host_config(&relayed_state(), None).unwrap();
        assert_eq!(cfg["hostPort"], 30001);
        assert_eq!(cfg["hostIp"], "0.0.0.0");
    }

    /// The agent sends every player's traffic to `127.0.0.1:<engine port>`, so
    /// that is the only address a relayed engine can usefully be listening at.
    #[test]
    fn a_relayed_host_listens_where_the_relay_agent_sends() {
        let cfg = battle_to_host_config(&relayed_state(), Some(&a_relay())).unwrap();
        assert_eq!(cfg["hostIp"], "127.0.0.1");
    }

    /// The engine warns about a loopback socket and is wrong to under a relay.
    /// The start script is the file next to the infolog, so the explanation goes
    /// in it, naming the relay so the note is about this battle rather than
    /// relaying in general.
    #[test]
    fn a_relayed_host_says_in_its_script_why_loopback_is_deliberate() {
        let cfg = battle_to_host_config(&relayed_state(), Some(&a_relay())).unwrap();
        let note = cfg["hostLoopbackReason"]
            .as_str()
            .expect("a relayed host explains its loopback bind");
        assert!(note.contains("198.51.100.9:30001"), "got: {note}");

        // And a host that is not relayed says nothing, because for them the
        // engine's warning would be true.
        let direct = battle_to_host_config(&hosted_state(), None).unwrap();
        assert!(direct.get("hostLoopbackReason").is_none());
    }

    /// The launch is told whether its own battle is relayed, rather than
    /// working it out from the route of the last battle hosted anywhere
    /// (issue #2099).
    ///
    /// This is what the in-game pill's warning and the engine named to the
    /// sidecar both turn on, and the two directions cost different things. Said
    /// falsely, an unrelated process decides when a relayed match ends. Not
    /// said at all, the X on the pill ends a relayed game for everybody in it
    /// with no warning, which is issue #2094.
    ///
    /// Asserted next to the config rather than on its own, because the point is
    /// that one relay handle produces both and a caller cannot pair the config
    /// for one battle with the verdict for another.
    #[test]
    fn a_host_config_says_whether_that_battle_is_going_through_a_relay() {
        let relayed = host_config_answer(&relayed_state(), Some(&a_relay())).unwrap();
        assert_eq!(relayed["relayed"], true);
        assert_eq!(relayed["config"]["hostIp"], "127.0.0.1");

        let direct = host_config_answer(&hosted_state(), None).unwrap();
        assert_eq!(direct["relayed"], false);
        assert_eq!(direct["config"]["hostIp"], "0.0.0.0");
    }

    /// A battle with nothing interesting in it, so the tests below are about the
    /// address and nothing else.
    fn a_battle_to_open() -> BattleToOpen {
        BattleToOpen {
            battle_type: 0,
            nat_type: 0,
            key: "*".into(),
            max_players: 8,
            modhash: -1,
            rank: 0,
            maphash: -1,
            engine: "spring".into(),
            version: "105".into(),
            map: "Comet Catcher".into(),
            title: "Title".into(),
            modname: "BAR".into(),
        }
    }

    /// The headline of issue #2017. A relayed battle is advertised at the
    /// relay's address and the relay's port, and the address is said before the
    /// battle is.
    #[test]
    fn a_relayed_battle_names_the_relay_before_it_opens_the_battle() {
        let relay = a_relay();
        let lines = advertising(relay_host::Advertised::relayed(&relay), &a_battle_to_open());

        assert_eq!(lines.len(), 2);
        assert_eq!(lines[0], "RELAYEDHOST 198.51.100.9 30001");
        assert!(
            lines[1].starts_with("OPENBATTLE 0 0 * 30001 8"),
            "the port a joiner dials is the relay's, got: {}",
            lines[1]
        );
    }

    /// And the host's own engine port never reaches the wire, because a joiner
    /// dialling it would be dialling a port on the host's machine, which is the
    /// machine nothing can reach.
    #[test]
    fn a_relayed_battle_never_puts_the_hosts_own_port_on_the_wire() {
        let relay = a_relay();
        let lines = advertising(relay_host::Advertised::relayed(&relay), &a_battle_to_open());
        assert!(
            !lines
                .iter()
                .any(|l| l.contains(&RELAYED_ENGINE_PORT.to_string())),
            "the engine's own port is for the relay agent, not the lobby: {lines:?}"
        );
    }

    /// Every other route says nothing about an address, because the lobby works
    /// it out from the connection and is right to.
    #[test]
    fn a_battle_that_is_not_relayed_names_no_address() {
        let lines = advertising(relay_host::Advertised::direct(8452), &a_battle_to_open());
        assert_eq!(lines.len(), 1);
        assert!(lines[0].starts_with("OPENBATTLE 0 0 * 8452 8"));
    }

    /// A registered TASServer connection whose compatibility flags are
    /// `compflags`, the receiving end of everything it sends, and the slot the
    /// connection task would be answering into about a battle of ours opening.
    ///
    /// Built here rather than shared with `turn.rs` because what these tests care
    /// about is the wire, and what those care about is the credential.
    fn a_connection(
        compflags: &str,
    ) -> (
        Registry,
        tokio::sync::mpsc::UnboundedReceiver<Outbound>,
        tokio::sync::watch::Sender<relay_host::OpenAnswer>,
    ) {
        use coilbox_lobby_protocol::{parse_line, reduce_at};
        use tokio::sync::watch;

        let registry = Registry::default();
        let (tx, sent) = tokio::sync::mpsc::unbounded_channel::<Outbound>();
        let (answers, opened) = watch::channel(relay_host::OpenAnswer::Unasked);
        let state = Arc::new(Mutex::new(LobbyState::new()));
        reduce_at(&mut lock_or_recover(&state), parse_line(compflags), 0);
        lock_or_recover(&registry).insert(
            "alice@bar:8200".to_string(),
            conn::ServerConn {
                protocol: ConnProtocol::TasServer,
                tx,
                state,
                sink: Arc::new(Mutex::new(Channel::new(|_| Ok(())))) as conn::EventSink,
                phase: watch::channel(LoginPhase::Ready).1,
                agreement: Arc::new(Mutex::new(None)),
                tachyon: conn::TachyonHandle::default(),
                started: conn::StartedBattle::default(),
                turn: watch::channel(turn::TurnAnswer::Unasked).1,
                relay: conn::HostedRelay::default(),
                opened,
                relay_refused: relay_host::RefusedRelayAddress::default(),
            },
        );
        (registry, sent, answers)
    }

    /// How long a test waits for an answer that is already in the slot before
    /// deciding it is never coming. Spent in full only by the one test that is
    /// about a lobby saying nothing.
    const HOSTING_PATIENCE: Duration = Duration::from_secs(5);

    /// The lines a relayed battle advertises itself with. What they say is
    /// tested above, so these tests only need something to queue.
    fn relayed_lines(relay: &relay_host::RelayHost) -> Vec<String> {
        advertising(relay_host::Advertised::relayed(relay), &a_battle_to_open())
    }

    /// Issue #2058, and the whole of it. The lobby refuses the battle after the
    /// lines are already queued, which is the one failure `enqueue_all` cannot
    /// see, and the relay it was opened on has to be told.
    ///
    /// The reason this is not a small leak: the sidecar's run file is what makes
    /// the next attempt to host fail with the pid of a process nobody in coilbox
    /// will end, so one refused battle costs hosting for the rest of the session.
    #[tokio::test]
    async fn a_battle_the_lobby_refuses_stops_the_relay_it_was_opened_on() {
        let (registry, _sent, answers) = a_connection("COMPFLAGS u sp r");
        let channel = Channelled::default();
        let relay = a_relay_writing_to(channel.clone());
        let lines = relayed_lines(&relay);

        tokio::spawn(async move {
            let _ = answers.send(relay_host::OpenAnswer::Refused(
                "you already have a battle open".to_string(),
            ));
        });
        let refused = advertise(
            &registry,
            "alice@bar:8200",
            lines,
            Some(relay),
            HOSTING_PATIENCE,
        )
        .await;

        assert!(
            channel.was_stopped(),
            "the relay has to be stopped, got: {:?}",
            channel.sent()
        );
        assert!(!refused.success);
        assert!(
            refused
                .error
                .as_deref()
                .unwrap_or_default()
                .contains("you already have a battle open"),
            "the lobby's own words have to reach the host, got: {:?}",
            refused.error
        );
        // And nothing is left describing this connection as relayed, so the next
        // start script does not point an engine at an allocation that has gone.
        assert!(lock_or_recover(&registry)
            .get("alice@bar:8200")
            .map(|conn| lock_or_recover(&conn.relay).is_none())
            .unwrap_or_default());
    }

    /// The other half of the rule, and the one that makes the rest safe. A
    /// battle the lobby did open is a relay with a game to carry, so nothing
    /// here may touch it. Getting this wrong cuts a match off mid-play, which is
    /// what the whole sidecar exists to prevent.
    #[tokio::test]
    async fn a_battle_the_lobby_opens_leaves_its_relay_running() {
        let (registry, _sent, answers) = a_connection("COMPFLAGS u sp r");
        let channel = Channelled::default();
        let relay = a_relay_writing_to(channel.clone());
        let lines = relayed_lines(&relay);

        tokio::spawn(async move {
            let _ = answers.send(relay_host::OpenAnswer::Opened(9));
        });
        let opened = advertise(
            &registry,
            "alice@bar:8200",
            lines,
            Some(relay),
            HOSTING_PATIENCE,
        )
        .await;

        assert!(opened.success, "got: {:?}", opened.error);
        assert!(
            !channel.was_stopped(),
            "a relay carrying a battle must never be stopped here, got: {:?}",
            channel.sent()
        );
        // And it is held against the connection, which is what takes it out of
        // this function's reach for good.
        assert!(lock_or_recover(&registry)
            .get("alice@bar:8200")
            .map(|conn| lock_or_recover(&conn.relay).is_some())
            .unwrap_or_default());
    }

    /// Issue #2031, from the sidecar's event to the wire. The relay agent says
    /// its allocation came back somewhere else and a `MOVERELAYEDHOST` naming
    /// the new address goes out on the lobby connection, without the battle
    /// being reopened.
    ///
    /// Driven through the listener `allocate` installs, because that is the seam:
    /// the event arrives on the agent's own thread long after anybody was waiting
    /// for an address.
    #[test]
    fn a_relay_rebuilt_elsewhere_re_advertises_the_battle_it_is_carrying() {
        let (registry, mut sent, _answers) = a_connection("COMPFLAGS u sp r");
        remember_relay(&registry, "alice@bar:8200", a_relay());

        let (saw, heard) = std::sync::mpsc::channel();
        let listener = relay_host::listening(
            &registry,
            "alice@bar:8200",
            saw,
            relay_host::MOVE_ANSWER_PATIENCE,
        );
        listener(coilbox_relay_protocol::Event::RelayOpen {
            addr: "198.51.100.9:30002".parse().expect("an address"),
        });

        assert_eq!(
            queued(&mut sent),
            vec!["MOVERELAYEDHOST 198.51.100.9 30002"]
        );
        // And the event still reaches whoever is waiting for an address, because
        // the same listener is what tells a host their first allocation is up.
        assert!(matches!(
            heard.try_recv(),
            Ok(coilbox_relay_protocol::Event::RelayOpen { .. })
        ));
    }

    /// And the case that must not fire. A host who is not relaying anything gets
    /// the same events from a sidecar that is still coming up, and a
    /// `MOVERELAYEDHOST` on the wire before there is a battle would ask the
    /// lobby to move a battle the host has not opened yet.
    #[test]
    fn a_relay_that_is_still_opening_advertises_nothing_on_its_own() {
        let (registry, mut sent, _answers) = a_connection("COMPFLAGS u sp r");

        let (saw, heard) = std::sync::mpsc::channel();
        let listener = relay_host::listening(
            &registry,
            "alice@bar:8200",
            saw,
            relay_host::MOVE_ANSWER_PATIENCE,
        );
        listener(coilbox_relay_protocol::Event::RelayOpen {
            addr: "198.51.100.9:30001".parse().expect("an address"),
        });

        assert_eq!(queued(&mut sent), Vec::<String>::new());
        drop(heard);
    }

    /// Every event a connection sent the frontend, by swapping the channel
    /// `a_connection` installs, which throws them away, for one that keeps them.
    fn recording_events(registry: &Registry, server_key: &str) -> Arc<Mutex<Vec<String>>> {
        let seen: Arc<Mutex<Vec<String>>> = Arc::default();
        let recorder = Arc::clone(&seen);
        let sink = lock_or_recover(registry)
            .get(server_key)
            .expect("the connection is registered")
            .sink
            .clone();
        *lock_or_recover(&sink) = Channel::new(move |body| {
            let json = match body {
                tauri::ipc::InvokeResponseBody::Json(s) => s,
                tauri::ipc::InvokeResponseBody::Raw(b) => String::from_utf8_lossy(&b).into_owned(),
            };
            lock_or_recover(&recorder).push(json);
            Ok(())
        });
        seen
    }

    /// Issue #2102, from the sidecar's event to the host's screen, and the case
    /// that is every lobby server alive today. Nobody implements
    /// `MOVERELAYEDHOST` (ScarylePoo/uberserver#43), so nobody refuses it
    /// either, and the battle is left in the list at an allocation that has gone
    /// with the host hearing nothing.
    ///
    /// Driven with a patience a test can afford rather than
    /// `MOVE_ANSWER_PATIENCE`, because what is under test is that the silence is
    /// noticed and reaches the frontend, not how long the real budget is. The
    /// budget's own derivation is on the constant.
    #[test]
    fn a_move_no_lobby_answers_tells_the_host_the_battle_cannot_be_reached() {
        let (registry, mut sent, _answers) = a_connection("COMPFLAGS u sp r");
        remember_relay(&registry, "alice@bar:8200", a_relay());
        let seen = recording_events(&registry, "alice@bar:8200");

        let (saw, heard) = std::sync::mpsc::channel();
        let listener =
            relay_host::listening(&registry, "alice@bar:8200", saw, Duration::from_millis(50));
        listener(coilbox_relay_protocol::Event::RelayOpen {
            addr: "198.51.100.9:30002".parse().expect("an address"),
        });

        assert_eq!(
            queued(&mut sent),
            vec!["MOVERELAYEDHOST 198.51.100.9 30002"],
            "the line has to go out before anybody can call it unanswered"
        );
        // And nothing is said on the way out. A verdict passed at the moment the
        // line was written would condemn a lobby that answers instantly.
        assert!(
            !lock_or_recover(&seen)
                .join("\n")
                .contains("relayedHostMove"),
            "the host must not be warned before the lobby has had its turn"
        );

        let deadline = std::time::Instant::now() + HOSTING_PATIENCE;
        let told = loop {
            let told = lock_or_recover(&seen).join("\n");
            if told.contains("relayedHostMoveUnanswered") || std::time::Instant::now() > deadline {
                break told;
            }
            std::thread::sleep(Duration::from_millis(5));
        };
        assert!(
            told.contains(r#""kind":"relayedHostMoveUnanswered""#),
            "a lobby that says nothing leaves the same unreachable battle as one that refuses, \
             and the frontend was sent: {told}"
        );
        drop(heard);
    }

    /// The lines a connection has queued, oldest first.
    fn queued(sent: &mut tokio::sync::mpsc::UnboundedReceiver<Outbound>) -> Vec<String> {
        std::iter::from_fn(|| match sent.try_recv() {
            Ok(Outbound::Line(line)) => Some(line),
            _ => None,
        })
        .collect()
    }

    /// The note the connection task writes the lobby's refusal of our address
    /// into. Taken out of the registry because that is where `advertise` reads
    /// it from, and writing to it is exactly what the connection task does.
    fn refusal_note(registry: &Registry, server_key: &str) -> relay_host::RefusedRelayAddress {
        lock_or_recover(registry)
            .get(server_key)
            .expect("the connection is registered")
            .relay_refused
            .clone()
    }

    /// Issue #2064, and the case the issue is really about. The lobby refuses
    /// the relay's address and then opens the battle anyway, at this machine's
    /// own address, which is the address the route ladder already measured as
    /// unreachable. That room is a door that does not open, so it is closed and
    /// the host is told why in the lobby's own words.
    ///
    /// The relay agent has to stop too. Without it the sidecar holds an
    /// allocation for a battle it is not carrying, and its run file turns the
    /// host's next attempt into a pid nobody in coilbox will end (issue #2058).
    #[tokio::test]
    async fn a_refused_relay_address_closes_the_room_the_lobby_opened_anyway() {
        let (registry, mut sent, answers) = a_connection("COMPFLAGS u sp r");
        let note = refusal_note(&registry, "alice@bar:8200");
        let channel = Channelled::default();
        let relay = a_relay_writing_to(channel.clone());
        let lines = relayed_lines(&relay);

        tokio::spawn(async move {
            // Both in one go, which is what the connection task does with a read
            // holding both lines: the refusal is written down and the ack goes
            // into the slot with nothing polled in between.
            relay_host::note_refused_address(
                &note,
                "203.0.113.7 is this lobby server, not a relay",
            );
            let _ = answers.send(relay_host::OpenAnswer::Opened(9));
        });
        let refused = advertise(
            &registry,
            "alice@bar:8200",
            lines,
            Some(relay),
            HOSTING_PATIENCE,
        )
        .await;

        assert!(
            channel.was_stopped(),
            "a relay carrying nothing has to be stopped, got: {:?}",
            channel.sent()
        );
        assert!(!refused.success);
        let why = refused.error.as_deref().unwrap_or_default();
        assert!(
            why.contains("203.0.113.7 is this lobby server, not a relay"),
            "the lobby's own words have to reach the host, got: {why}"
        );

        // The two advertising lines, and then the one that closes the room they
        // opened. Last, because the close has to come after them.
        let lines = queued(&mut sent);
        assert_eq!(
            lines.last().map(String::as_str),
            Some("LEAVEBATTLE"),
            "the room nobody can join has to be closed, queued: {lines:?}"
        );
        assert!(lock_or_recover(&registry)
            .get("alice@bar:8200")
            .map(|conn| lock_or_recover(&conn.relay).is_none())
            .unwrap_or_default());
    }

    /// The lobby refused the address and then refused the battle too, so there
    /// is no room to close. Sending `LEAVEBATTLE` here would be aimed at a
    /// battle this client is not in, and on a host who is in an earlier battle
    /// it would throw them out of that one.
    #[tokio::test]
    async fn a_refused_relay_address_closes_nothing_when_no_battle_opened() {
        let (registry, mut sent, answers) = a_connection("COMPFLAGS u sp r");
        let note = refusal_note(&registry, "alice@bar:8200");
        let channel = Channelled::default();
        let relay = a_relay_writing_to(channel.clone());
        let lines = relayed_lines(&relay);

        tokio::spawn(async move {
            relay_host::note_refused_address(&note, "This server has no relay configured");
            let _ = answers.send(relay_host::OpenAnswer::Refused(
                "you already have a battle open".to_string(),
            ));
        });
        let refused = advertise(
            &registry,
            "alice@bar:8200",
            lines,
            Some(relay),
            HOSTING_PATIENCE,
        )
        .await;

        assert!(channel.was_stopped(), "got: {:?}", channel.sent());
        assert!(!refused.success);
        let told = refused.error.as_deref().unwrap_or_default();
        assert!(
            told.contains("This server has no relay configured"),
            "the address answer has to reach the host, got: {told}"
        );
        // Issue #2145. Two lines were turned down for two unrelated reasons and
        // the host was told one of them, so the one that stopped their battle
        // could be the one they never saw.
        assert!(
            told.contains("you already have a battle open"),
            "the battle answer has to reach the host too, got: {told}"
        );
        let lines = queued(&mut sent);
        assert!(
            !lines.iter().any(|l| l == "LEAVEBATTLE"),
            "there is no room to close, queued: {lines:?}"
        );
    }

    /// The refusal is per attempt. A host whose first attempt was refused and
    /// who then hosts somewhere the lobby is happy with must keep that battle:
    /// reading the stale note would close a working room and stop a relay with
    /// a game about to run through it.
    #[tokio::test]
    async fn a_second_attempt_ignores_the_last_ones_refused_address() {
        let (registry, mut sent, answers) = a_connection("COMPFLAGS u sp r");
        relay_host::note_refused_address(
            &refusal_note(&registry, "alice@bar:8200"),
            "the attempt before this one",
        );

        let channel = Channelled::default();
        let relay = a_relay_writing_to(channel.clone());
        let lines = relayed_lines(&relay);
        tokio::spawn(async move {
            let _ = answers.send(relay_host::OpenAnswer::Opened(9));
        });
        let opened = advertise(
            &registry,
            "alice@bar:8200",
            lines,
            Some(relay),
            HOSTING_PATIENCE,
        )
        .await;

        assert!(opened.success, "got: {:?}", opened.error);
        assert!(
            !channel.was_stopped(),
            "the last attempt's refusal must not take this battle's relay down, got: {:?}",
            channel.sent()
        );
        let lines = queued(&mut sent);
        assert!(
            !lines.iter().any(|l| l == "LEAVEBATTLE"),
            "this battle is relayed and must not be closed, queued: {lines:?}"
        );
    }

    /// Issue #2018's coilbox half. A battle that ends has to tell the sidecar,
    /// because otherwise the allocation stands until the relay server's own
    /// timeout notices, and until then the sidecar's run file refuses the next
    /// attempt to host.
    ///
    /// What it must not say is `stop`. Leaving a battle room is not the end of
    /// a game, and coilbox cannot tell from here whether an engine is still
    /// playing through this relay, so it says what it knows and lets the
    /// sidecar decide.
    #[test]
    fn a_relay_this_connection_lets_go_of_is_told_the_battle_is_over() {
        let (registry, _sent, _answers) = a_connection("COMPFLAGS u sp r");
        let channel = Channelled::default();
        remember_relay(
            &registry,
            "alice@bar:8200",
            a_relay_writing_to(channel.clone()),
        );

        forget_relay(&registry, "alice@bar:8200");

        assert!(
            channel.was_told_the_battle_is_over(),
            "a relay nobody is holding any more has to hear the battle ended, got: {:?}",
            channel.sent()
        );
        assert!(
            !channel.was_stopped(),
            "stopping a relay coilbox cannot see the engine behind would cut off a game that is \
             still being played, got: {:?}",
            channel.sent()
        );
        assert!(
            lock_or_recover(&registry)
                .get("alice@bar:8200")
                .map(|conn| lock_or_recover(&conn.relay).is_none())
                .unwrap_or_default(),
            "the connection is no longer hosting through a relay"
        );
    }

    /// A connection that was never hosting through a relay has nothing to let
    /// go of, which is every host today and every join ever. Leaving a battle
    /// must not need one.
    #[test]
    fn letting_go_of_a_relay_there_never_was_does_nothing() {
        let (registry, _sent, _answers) = a_connection("COMPFLAGS u sp");
        forget_relay(&registry, "alice@bar:8200");
        forget_relay(&registry, "nobody@nowhere:8200");
    }

    /// Hosting twice on one connection, where the first attempt was refused.
    /// The second attempt must wait for its own answer rather than reading the
    /// one still sitting in the slot, because the answer it would read is a
    /// refusal and the relay it would take down is carrying a battle.
    ///
    /// A fresh reader of the slot has seen nothing that was ever put in it, so
    /// without the `borrow_and_update` in `advertise` this reads the last
    /// attempt's refusal the moment it starts waiting.
    #[tokio::test]
    async fn a_second_attempt_does_not_read_the_last_ones_answer() {
        let (registry, _sent, answers) = a_connection("COMPFLAGS u sp r");
        answers
            .send(relay_host::OpenAnswer::Refused(
                "the attempt before this one".to_string(),
            ))
            .expect("the slot is open");

        let channel = Channelled::default();
        let relay = a_relay_writing_to(channel.clone());
        let lines = relayed_lines(&relay);
        tokio::spawn(async move {
            let _ = answers.send(relay_host::OpenAnswer::Opened(9));
        });
        let opened = advertise(
            &registry,
            "alice@bar:8200",
            lines,
            Some(relay),
            HOSTING_PATIENCE,
        )
        .await;

        assert!(opened.success, "got: {:?}", opened.error);
        assert!(
            !channel.was_stopped(),
            "the last attempt's refusal must not take this battle's relay down, got: {:?}",
            channel.sent()
        );
    }

    /// The second case the issue names: the connection dropping between the
    /// lines being queued and the server reading them. Nobody is ever going to
    /// say whether that battle opened, and the allocation is held either way.
    #[tokio::test]
    async fn a_connection_that_ends_before_the_answer_stops_the_relay() {
        let (registry, _sent, answers) = a_connection("COMPFLAGS u sp r");
        let channel = Channelled::default();
        let relay = a_relay_writing_to(channel.clone());
        let lines = relayed_lines(&relay);

        // Dropping the sender is what the connection task does when the socket
        // closes, which is how anybody waiting learns the connection has gone.
        tokio::spawn(async move { drop(answers) });
        let closed = advertise(
            &registry,
            "alice@bar:8200",
            lines,
            Some(relay),
            HOSTING_PATIENCE,
        )
        .await;

        assert!(channel.was_stopped(), "got: {:?}", channel.sent());
        assert!(!closed.success);
        assert!(
            closed
                .error
                .as_deref()
                .unwrap_or_default()
                .contains("the connection closed"),
            "got: {:?}",
            closed.error
        );
    }

    /// A lobby that reads the lines and says nothing at all. Waiting forever
    /// would leave the host in front of a spinner with an allocation running
    /// behind it, so the wait ends and takes the relay with it.
    #[tokio::test]
    async fn a_lobby_that_never_answers_stops_the_relay_rather_than_waiting() {
        let (registry, _sent, _answers) = a_connection("COMPFLAGS u sp r");
        let channel = Channelled::default();
        let relay = a_relay_writing_to(channel.clone());
        let lines = relayed_lines(&relay);

        let quiet = advertise(
            &registry,
            "alice@bar:8200",
            lines,
            Some(relay),
            Duration::from_millis(50),
        )
        .await;

        assert!(channel.was_stopped(), "got: {:?}", channel.sent());
        assert!(!quiet.success);
    }

    /// The connection going while the allocation was being opened, which is a
    /// wait of up to `relay_host::ALLOCATION_PATIENCE` for the host to
    /// disconnect in. There is nothing to advertise on, so the relay that just
    /// came up is carrying nothing.
    #[tokio::test]
    async fn a_relay_with_no_connection_left_to_advertise_on_is_stopped() {
        let registry = Registry::default();
        let channel = Channelled::default();
        let relay = a_relay_writing_to(channel.clone());
        let lines = relayed_lines(&relay);

        let gone = advertise(
            &registry,
            "alice@bar:8200",
            lines,
            Some(relay),
            HOSTING_PATIENCE,
        )
        .await;

        assert!(channel.was_stopped(), "got: {:?}", channel.sent());
        assert!(!gone.success);
    }

    /// A lobby that logs a client in, says it has a relay, and answers an
    /// `OPENBATTLE` with `answer`.
    ///
    /// `RELAYEDHOST` arrives first and is read and ignored, which is what a
    /// server that has not landed ScarylePoo/uberserver#29 does with it.
    async fn lobby_answering_an_open(answer: fn(u32) -> String) -> std::net::SocketAddr {
        lobby_scripted(answer, |_| None).await
    }

    /// The same lobby, plus what it says to the `RELAYEDHOST` in front of the
    /// open. `None` is a server that reads the line and says nothing.
    async fn lobby_scripted(
        answer: fn(u32) -> String,
        to_relayed_host: fn(&str) -> Option<String>,
    ) -> std::net::SocketAddr {
        use coilbox_lobby_protocol::server::{line, parse_client_line, ClientCommand};
        use futures_util::{SinkExt, StreamExt};
        use tokio_util::codec::{Framed, LinesCodec};

        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .expect("a free port");
        let addr = listener.local_addr().expect("a bound address");
        tokio::spawn(async move {
            let Ok((stream, _)) = listener.accept().await else {
                return;
            };
            let mut framed = Framed::new(stream, LinesCodec::new());
            if framed
                .send(line::tas_server("0.38", "*", 8452, 0))
                .await
                .is_err()
            {
                return;
            }
            while let Some(Ok(read)) = framed.next().await {
                let reply = match parse_client_line(&read) {
                    ClientCommand::ListCompFlags => line::comp_flags(&["u", "sp", "r"]),
                    ClientCommand::Login { username, .. } => {
                        if framed.send(line::accepted(&username)).await.is_err() {
                            return;
                        }
                        line::login_info_end()
                    }
                    _ if read.starts_with("OPENBATTLE ") => answer(9),
                    // Answered where it is read and before the `OPENBATTLE`
                    // behind it, which is the ordering the whole refusal note
                    // depends on.
                    _ if read.starts_with("RELAYEDHOST ") => match to_relayed_host(&read) {
                        Some(said) => said,
                        None => continue,
                    },
                    _ => continue,
                };
                if framed.send(reply).await.is_err() {
                    return;
                }
            }
        });
        addr
    }

    /// Connect and log in the way `mp_connect` does, and hand back the key and
    /// the connection's conversation logs, which the caller has to hold for as
    /// long as it uses the connection.
    async fn logged_in(
        registry: &Registry,
        addr: std::net::SocketAddr,
    ) -> (String, dmlog::ScratchLogs) {
        use coilbox_lobby_protocol::{password_hash, LoginConfig, LoginMode};

        let stream = tokio::net::TcpStream::connect(addr)
            .await
            .expect("the lobby is listening");
        let key = format!("alice@{addr}");
        let logs = dmlog::ScratchLogs::new();
        conn::spawn_connection(
            registry.clone(),
            key.clone(),
            Box::new(stream),
            LoginConfig {
                username: "alice".to_string(),
                password_hash: password_hash("hunter2"),
                local_ip: "127.0.0.1".to_string(),
                agent: "Coilbox test".to_string(),
                client_id: "1".to_string(),
                compat_flags: vec!["u".to_string()],
                use_stls: false,
                mode: LoginMode::Login,
            },
            Channel::new(|_| Ok(())),
            logs.dms(&key),
            logs.channels(&key),
        );
        conn::wait_until_ready(registry, &key, HOSTING_PATIENCE)
            .await
            .expect("the lobby logged us in");
        (key, logs)
    }

    /// The acceptance criterion of issue #2058, over a real socket and through
    /// the real connection task. This is the only test here that covers the
    /// whole chain: a refusal off the wire, the parser, the reducer, the slot
    /// the connection task fills, and a `stop` arriving on the sidecar's stdin.
    #[tokio::test]
    async fn a_lobby_refusing_over_a_socket_stops_the_relay_the_battle_was_opened_on() {
        let addr =
            lobby_answering_an_open(|_| "OPENBATTLEFAILED you are not logged in yet".to_string())
                .await;
        let registry = Registry::default();
        let (key, _logs) = logged_in(&registry, addr).await;

        let channel = Channelled::default();
        let relay = a_relay_writing_to(channel.clone());
        let lines = relayed_lines(&relay);
        let refused = advertise(&registry, &key, lines, Some(relay), HOSTING_PATIENCE).await;

        assert!(
            channel.was_stopped(),
            "a battle the lobby refused leaves a relay to take down, got: {:?}",
            channel.sent()
        );
        assert!(!refused.success);
        assert!(
            refused
                .error
                .as_deref()
                .unwrap_or_default()
                .contains("you are not logged in yet"),
            "got: {:?}",
            refused.error
        );
    }

    /// The same socket, the same code, and a lobby that opens the battle. The
    /// relay is left running and held against the connection, which is what
    /// says the test above is a refusal being acted on rather than every
    /// relayed open being taken down.
    #[tokio::test]
    async fn a_lobby_opening_over_a_socket_leaves_the_relay_carrying_the_battle() {
        let addr = lobby_answering_an_open(|id| format!("OPENBATTLE {id}")).await;
        let registry = Registry::default();
        let (key, _logs) = logged_in(&registry, addr).await;

        let channel = Channelled::default();
        let relay = a_relay_writing_to(channel.clone());
        let lines = relayed_lines(&relay);
        let opened = advertise(&registry, &key, lines, Some(relay), HOSTING_PATIENCE).await;

        assert!(opened.success, "got: {:?}", opened.error);
        assert!(
            !channel.was_stopped(),
            "the battle opened, so the relay carrying it must be left alone, got: {:?}",
            channel.sent()
        );
        assert!(lock_or_recover(&registry)
            .get(&key)
            .map(|conn| lock_or_recover(&conn.relay).is_some())
            .unwrap_or_default());
    }

    /// Issue #2141, over a real socket and through the real connection task.
    ///
    /// This is not the twenty second wait the issue was written about, and the
    /// difference is worth being exact about. `RELAYEDHOST` goes out
    /// immediately ahead of `OPENBATTLE`, and a lobby that will not run the
    /// first still answers the second, promptly. So nothing here waits. What
    /// happens without the rejection being read is worse than a wait: the
    /// battle opens at this machine's own address, which is the address the
    /// route ladder measured as unreachable, and the host is told it is up and
    /// relayed.
    ///
    /// Reading the rejection puts it where `RELAYEDHOSTFAILED` already goes, so
    /// the room is closed and the host is told the truth.
    #[tokio::test]
    async fn a_lobby_that_will_not_advertise_at_the_relay_does_not_leave_a_battle_nobody_can_join()
    {
        let addr = lobby_scripted(
            |id| format!("OPENBATTLE {id}"),
            |read| {
                let args = read.strip_prefix("RELAYEDHOST ").unwrap_or_default();
                Some(format!(
                    "SERVERMSG RELAYEDHOST failed. Unknown command. (args='{args}')"
                ))
            },
        )
        .await;
        let registry = Registry::default();
        let (key, _logs) = logged_in(&registry, addr).await;

        let channel = Channelled::default();
        let relay = a_relay_writing_to(channel.clone());
        let lines = relayed_lines(&relay);
        let refused = advertise(&registry, &key, lines, Some(relay), HOSTING_PATIENCE).await;

        assert!(
            !refused.success,
            "the lobby opened a battle at an address nobody can reach, and the host was told it \
             had worked"
        );
        assert!(
            refused
                .error
                .as_deref()
                .unwrap_or_default()
                .contains("would not advertise your battle at the relay's address"),
            "got: {:?}",
            refused.error
        );
        assert!(
            channel.was_stopped(),
            "a battle that is not going through the relay leaves an allocation to take down, \
             got: {:?}",
            channel.sent()
        );
        assert!(
            lock_or_recover(&registry)
                .get(&key)
                .map(|conn| lock_or_recover(&conn.relay).is_none())
                .unwrap_or_default(),
            "nothing may be held against the connection as a relayed battle"
        );
    }

    /// Issue #2145, over a real socket and through the real connection task.
    ///
    /// Two lines turned down for two unrelated reasons, both of which the
    /// uberserver in `~/dev/uberserver` at `6a3868f` can give an account it has
    /// already handed a relay credential to. `_validRelayedHostAddress` refuses
    /// an allocation whose address is not public, which is a coturn on a LAN or
    /// one whose reflexive address came back private. `in_OPENBATTLE` behind it
    /// refuses a game hash of zero, one of six places it turns a battle down
    /// from and none of them about the address line ahead of it.
    ///
    /// So neither answer explains the other, and a host told only the address
    /// goes looking for a relay problem behind a battle a bad hash stopped.
    /// Both reasons are lines this server read and understood, so neither needs
    /// a malformed one.
    #[tokio::test]
    async fn a_lobby_that_turns_down_both_lines_gives_the_host_both_reasons() {
        let addr = lobby_scripted(
            |_| "OPENBATTLEFAILED Invalid game hash 0".to_string(),
            |_| {
                Some(
                    "RELAYEDHOSTFAILED 192.168.1.5 is not a public address, so nobody could join \
                     a battle there"
                        .to_string(),
                )
            },
        )
        .await;
        let registry = Registry::default();
        let (key, _logs) = logged_in(&registry, addr).await;

        let channel = Channelled::default();
        let relay = a_relay_writing_to(channel.clone());
        let lines = relayed_lines(&relay);
        let refused = advertise(&registry, &key, lines, Some(relay), HOSTING_PATIENCE).await;

        assert!(!refused.success, "no battle was opened");
        let told = refused.error.as_deref().unwrap_or_default();
        assert!(
            told.contains("Invalid game hash 0"),
            "the reason no battle opened has to reach the host, got: {told}"
        );
        assert!(
            told.contains("192.168.1.5 is not a public address"),
            "the reason the address was refused has to reach the host, got: {told}"
        );
        assert!(
            channel.was_stopped(),
            "a battle that never opened leaves an allocation held for nothing, got: {:?}",
            channel.sent()
        );
    }

    /// Issue #2143, over a real socket and through the real connection task.
    ///
    /// The wait is armed with the real [`READY_TIMEOUT`] and the answer is given
    /// [`HOSTING_PATIENCE`], which is a quarter of it. So a refusal that arrives
    /// here arrived because the lobby named the command, with fifteen seconds
    /// still on the clock. Without the rejection being read this test does not
    /// fail on the words, it hangs until the quarter runs out.
    #[tokio::test]
    async fn a_lobby_that_will_not_run_the_open_says_so_rather_than_being_waited_out() {
        assert!(
            READY_TIMEOUT > HOSTING_PATIENCE,
            "this test only means anything while the budget outlasts what it waits"
        );
        let addr = lobby_answering_an_open(|_| {
            "SERVERMSG OPENBATTLE failed. Incorrect arguments.".to_string()
        })
        .await;
        let registry = Registry::default();
        let (key, _logs) = logged_in(&registry, addr).await;

        let channel = Channelled::default();
        let relay = a_relay_writing_to(channel.clone());
        let lines = relayed_lines(&relay);
        let refused = tokio::time::timeout(
            HOSTING_PATIENCE,
            advertise(&registry, &key, lines, Some(relay), READY_TIMEOUT),
        )
        .await
        .expect("the lobby answered at once, so there is nothing left here to wait for");

        assert!(!refused.success, "no battle was opened");
        let told = refused.error.as_deref().unwrap_or_default();
        assert!(
            told.contains("coilbox sent an OPENBATTLE line this lobby would not run"),
            "got: {told}"
        );
        assert!(told.contains("Incorrect arguments."), "got: {told}");
        assert!(
            channel.was_stopped(),
            "a battle that never opened leaves an allocation held for nothing, got: {:?}",
            channel.sent()
        );
        assert!(
            lock_or_recover(&registry)
                .get(&key)
                .map(|conn| lock_or_recover(&conn.relay).is_none())
                .unwrap_or_default(),
            "nothing may be held against the connection as a relayed battle"
        );
    }

    /// A line that never reached the writer, which is the one failure this could
    /// already see. Kept because it is the same rule and the easiest to lose in
    /// a rearrangement.
    #[tokio::test]
    async fn a_line_that_never_leaves_stops_the_relay_it_would_have_advertised() {
        let (registry, sent, _answers) = a_connection("COMPFLAGS u sp r");
        let channel = Channelled::default();
        let relay = a_relay_writing_to(channel.clone());
        let lines = relayed_lines(&relay);
        // The writer's receiving end going is a closed connection as far as
        // `enqueue` can tell, which is the failure it reports.
        drop(sent);

        let unsent = advertise(
            &registry,
            "alice@bar:8200",
            lines,
            Some(relay),
            HOSTING_PATIENCE,
        )
        .await;

        assert!(channel.was_stopped(), "got: {:?}", channel.sent());
        assert!(!unsent.success);
    }

    /// The second acceptance criterion of issue #2017, and the failure that
    /// matters most: a relay that cannot be had stops the open with a reason,
    /// rather than advertising a battle at an address nobody can reach.
    ///
    /// The refusal used here is the one every server gives today, which is a
    /// lobby that never said it has a relay. It is settled before login, so
    /// nothing goes on the wire at all, and that is what the second assertion is
    /// about: not "the OPENBATTLE was withheld", but "the wire is untouched".
    #[tokio::test]
    async fn a_host_who_cannot_get_a_relay_is_told_why_and_opens_nothing() {
        let (registry, mut sent, _answers) = a_connection("COMPFLAGS u sp");

        let refused = open_battle(
            &registry,
            "alice@bar:8200",
            8452,
            a_battle_to_open(),
            Some(std::path::Path::new("/nowhere/agent.json")),
        )
        .await;

        assert!(!refused.success);
        assert!(
            refused
                .error
                .as_deref()
                .unwrap_or_default()
                .contains("this server has no relay"),
            "the host has to be told what stopped them, got: {:?}",
            refused.error
        );
        assert!(
            sent.try_recv().is_err(),
            "nothing may reach the lobby when there is no relay to host through"
        );
    }

    /// And the same connection hosting without a relay is untouched by any of
    /// this: one line, the port it was given, and no address.
    #[tokio::test]
    async fn hosting_without_a_relay_still_sends_one_ordinary_line() {
        let (registry, mut sent, _answers) = a_connection("COMPFLAGS u sp");

        let opened = open_battle(&registry, "alice@bar:8200", 8452, a_battle_to_open(), None).await;

        assert!(opened.success);
        assert!(matches!(
            sent.try_recv(),
            Ok(Outbound::Line(line)) if line.starts_with("OPENBATTLE 0 0 * 8452 8")
        ));
        assert!(sent.try_recv().is_err(), "one line and no more");
    }

    /// A password the line cannot carry is refused before anything else happens,
    /// including before a relay is asked for. Hosting is the expensive half and
    /// it must not be spent on a battle that was never going to open.
    #[tokio::test]
    async fn a_password_the_line_cannot_carry_is_refused_before_a_relay_is_asked_for() {
        let (registry, mut sent, _answers) = a_connection("COMPFLAGS u sp r");

        let refused = open_battle(
            &registry,
            "alice@bar:8200",
            8452,
            BattleToOpen {
                key: "let me in".into(),
                ..a_battle_to_open()
            },
            Some(std::path::Path::new("/nowhere/agent.json")),
        )
        .await;

        assert!(!refused.success);
        assert!(
            refused
                .error
                .as_deref()
                .unwrap_or_default()
                .contains("cannot contain spaces"),
            "got: {:?}",
            refused.error
        );
        assert!(
            sent.try_recv().is_err(),
            "a server with a relay was not even asked for a credential"
        );
    }

    #[test]
    fn host_config_renumbers_teams_and_allies_contiguously() {
        let cfg = battle_to_host_config(&hosted_state(), None).unwrap();

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
        let cfg = battle_to_host_config(&hosted_state(), None).unwrap();
        let players = cfg["players"].as_array().unwrap();
        assert_eq!(players[0]["name"], "ally", "the host does not sort first");
        assert_eq!(players[1]["name"], "me");

        // BARb is owned by `me`, so it runs on player 1's machine, not player 0's.
        assert_eq!(cfg["ais"][0]["host"], 1);
    }

    #[test]
    fn host_config_leads_an_ai_only_team_with_the_ai_host() {
        let cfg = battle_to_host_config(&hosted_state(), None).unwrap();
        let teams = cfg["teams"].as_array().unwrap();
        // Team pos 0 holds only BARb, owned by `me` -> player 1.
        assert_eq!(teams[0]["teamLeader"], 1);
    }

    #[test]
    fn host_config_leads_human_teams_with_their_own_player() {
        let cfg = battle_to_host_config(&hosted_state(), None).unwrap();
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

        let cfg = battle_to_host_config(&state, None).unwrap();
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

        let cfg = battle_to_host_config(&state, None).unwrap();
        assert_eq!(cfg["ais"][0]["host"], 0);
        assert_eq!(cfg["teams"][0]["teamLeader"], 0);
    }

    /// Every emitted TeamLeader/Host must name a real [PLAYERn], or the engine
    /// throws "invalid AI.Host" / "Team N has invalid leader" and the script dies.
    #[test]
    fn host_config_player_references_are_all_in_range() {
        let cfg = battle_to_host_config(&hosted_state(), None).unwrap();
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
        let cfg = battle_to_host_config(&hosted_state(), None).unwrap();
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
        assert!(battle_to_host_config(&joined_state(), None).is_err());
    }

    #[test]
    fn host_config_includes_unit_restrictions() {
        let cfg = battle_to_host_config(&hosted_state(), None).unwrap();
        // Both restricted units surface as a name -> limit map the play crate
        // renders into the [RESTRICT] block.
        assert_eq!(cfg["restrictedUnits"]["armcom"], 0);
        assert_eq!(cfg["restrictedUnits"]["armflash"], 0);
        assert_eq!(cfg["restrictedUnits"].as_object().unwrap().len(), 2);
    }

    /// A connection with nothing in its relay slot, which is every connection
    /// that is not hosting a relayed battle and so is all of them most of the
    /// time.
    fn a_connection_hosting_nothing() -> conn::ServerConn {
        conn::ServerConn {
            protocol: conn::ConnProtocol::TasServer,
            tx: tokio::sync::mpsc::unbounded_channel().0,
            state: Arc::new(Mutex::new(LobbyState::new())),
            sink: Arc::new(Mutex::new(Channel::new(|_| Ok(())))),
            phase: tokio::sync::watch::channel(LoginPhase::Ready).1,
            agreement: Arc::new(Mutex::new(None)),
            tachyon: conn::TachyonHandle::default(),
            started: conn::StartedBattle::default(),
            turn: tokio::sync::watch::channel(turn::TurnAnswer::Unasked).1,
            relay: conn::HostedRelay::default(),
            opened: tokio::sync::watch::channel(relay_host::OpenAnswer::Unasked).1,
            relay_refused: relay_host::RefusedRelayAddress::default(),
        }
    }

    /// The registry scan behind `mp_relay_traffic`.
    ///
    /// Worth its own test because the honest answer and the answer a broken
    /// version gives are the same shape. A scan that always found nothing would
    /// leave the pill drawing exactly what it draws for an ordinary game, which
    /// is the behaviour every other test in this feature is checking for, so
    /// nothing else would notice.
    #[test]
    fn the_relay_figure_comes_from_the_connection_that_is_hosting_through_one() {
        let registry = Registry::default();
        assert_eq!(
            relay_traffic(&registry),
            None,
            "nothing is being relayed, so there is nothing to say"
        );

        lock_or_recover(&registry)
            .insert("alice@bar:8200".to_string(), a_connection_hosting_nothing());
        assert_eq!(
            relay_traffic(&registry),
            None,
            "a connection that is not hosting through a relay has no figure either"
        );

        let _agent_said = hosting_through_a_relay(&registry, "alice@bar:8200", Some(41_984));

        let deadline = std::time::Instant::now() + Duration::from_secs(5);
        while relay_traffic(&registry) != Some(41_984) {
            assert!(
                std::time::Instant::now() < deadline,
                "the figure the relay reported has to reach the command, or the pill has \
                 nothing to draw for a battle that is being relayed"
            );
            std::thread::sleep(Duration::from_millis(5));
        }
    }

    /// A relay held against a connection that is already in `registry`, put
    /// together the way `mp_open_battle` does: an agent that has reported
    /// `bytes_per_second` if it has reported anything at all, and a relay it
    /// said was open.
    ///
    /// The writer comes back because dropping it closes the agent's pipe, so
    /// the caller has to hold it for as long as it reads anything off the
    /// agent.
    fn hosting_through_a_relay(
        registry: &Registry,
        server_key: &str,
        bytes_per_second: Option<u64>,
    ) -> std::io::PipeWriter {
        let (coilbox_reads, mut agent_said) = std::io::pipe().expect("a pipe");
        let agent = relay_agent::RelayAgent::driving(coilbox_reads, Vec::new(), |_| {});
        if let Some(bytes_per_second) = bytes_per_second {
            std::io::Write::write_all(
                &mut agent_said,
                coilbox_relay_protocol::to_line(&coilbox_relay_protocol::Event::Traffic {
                    bytes_per_second,
                })
                .as_bytes(),
            )
            .expect("the reading thread is still there");
        }
        let (saw, heard) = std::sync::mpsc::channel();
        saw.send(coilbox_relay_protocol::Event::RelayOpen {
            addr: "198.51.100.9:30001".parse().expect("an address"),
        })
        .expect("the channel is open");
        let host = relay_host::waiting_on(agent, heard, 8452, Duration::from_secs(5))
            .expect("the agent opened a relay");
        remember_relay(registry, server_key, host);
        agent_said
    }

    /// A run file naming a process that is definitely running and holding the
    /// file, which is what a live sidecar leaves. This test process stands in
    /// for it.
    ///
    /// The lock comes back with the path because it lives on the open handle:
    /// dropping it is the sidecar dying, so a caller that throws it away is
    /// testing a leftover rather than a sidecar.
    fn a_run_file_naming_a_live_sidecar(
        dir: &std::path::Path,
    ) -> (std::path::PathBuf, std::fs::File) {
        let run_file = dir.join("relay").join("agent.json");
        std::fs::create_dir_all(run_file.parent().expect("a parent")).expect("a writable temp dir");
        std::fs::write(
            &run_file,
            coilbox_relay_protocol::RunFile {
                pid: std::process::id(),
                locked: true,
            }
            .to_json(),
        )
        .expect("a writable temp dir");
        let held = std::fs::OpenOptions::new()
            .read(true)
            .write(true)
            .open(&run_file)
            .expect("the file is there");
        held.try_lock_shared().expect("nothing else has it");
        (run_file, held)
    }

    /// The note coilbox left, if it is still there.
    fn note_beside(run_file: &std::path::Path) -> std::path::PathBuf {
        coilbox_relay_protocol::stop_note_path(run_file)
    }

    /// Nothing to ask. The host was told a relay agent was running and by the
    /// time they pressed the button it had gone, which is the ordinary way a
    /// leftover from a crash clears itself.
    #[tokio::test(start_paused = true)]
    async fn asking_when_there_is_no_sidecar_says_so_rather_than_waiting() {
        let dir = tempfile::tempdir().expect("a temp dir");
        let run_file = dir.path().join("relay").join("agent.json");

        assert_eq!(
            ask_the_leftover_sidecar_to_stop(&run_file, false).await,
            Ok(StopAnswer::Gone)
        );
        assert!(
            !note_beside(&run_file).exists(),
            "a note for a sidecar that is not there would be read by the next one to start"
        );
    }

    /// The guard that keeps a host from ending their own battle. They opened a
    /// relayed battle, tried to open a second one over the top, and were told a
    /// relay agent was already running, which it is: theirs.
    #[tokio::test(start_paused = true)]
    async fn a_relay_this_coilbox_is_hosting_through_is_never_asked_to_stop() {
        let dir = tempfile::tempdir().expect("a temp dir");
        let (run_file, _held) = a_run_file_naming_a_live_sidecar(dir.path());

        assert_eq!(
            ask_the_leftover_sidecar_to_stop(&run_file, true).await,
            Ok(StopAnswer::Ours)
        );
        assert!(
            !note_beside(&run_file).exists(),
            "a note was left for the sidecar carrying this coilbox's own battle"
        );
    }

    /// The leftover this issue is about. The sidecar takes the note and goes,
    /// and its run file goes with it, which is what was refusing the host's next
    /// battle.
    #[tokio::test(start_paused = true)]
    async fn a_sidecar_that_takes_the_note_and_goes_is_reported_as_stopped() {
        let dir = tempfile::tempdir().expect("a temp dir");
        let (run_file, _held) = a_run_file_naming_a_live_sidecar(dir.path());

        // A sidecar that reads the note, decides it has nothing to carry, and
        // exits. One interval, which is what the real one takes.
        let stopping = run_file.clone();
        tokio::spawn(async move {
            tokio::time::sleep(coilbox_relay_protocol::NOTE_LOOKED_FOR_EVERY).await;
            std::fs::remove_file(note_beside(&stopping)).expect("coilbox left a note");
            std::fs::remove_file(&stopping).expect("the sidecar had a run file");
        });

        assert_eq!(
            ask_the_leftover_sidecar_to_stop(&run_file, false).await,
            Ok(StopAnswer::Stopped)
        );
    }

    /// The opposite case, and the one that costs a match if it is got wrong.
    /// The sidecar read the note and kept running, which it does when a player
    /// has been heard through the relay. The host has to be told that rather
    /// than told nothing happened.
    #[tokio::test(start_paused = true)]
    async fn a_sidecar_that_takes_the_note_and_stays_is_reported_as_carrying_a_game() {
        let dir = tempfile::tempdir().expect("a temp dir");
        let (run_file, _held) = a_run_file_naming_a_live_sidecar(dir.path());

        // Takes the note, keeps its run file, carries on relaying.
        let carrying = run_file.clone();
        tokio::spawn(async move {
            tokio::time::sleep(coilbox_relay_protocol::NOTE_LOOKED_FOR_EVERY).await;
            std::fs::remove_file(note_beside(&carrying)).expect("coilbox left a note");
        });

        assert_eq!(
            ask_the_leftover_sidecar_to_stop(&run_file, false).await,
            Ok(StopAnswer::Carrying)
        );
        assert!(
            run_file.exists(),
            "the sidecar carrying the game is still there, and coilbox must not have \
             cleared the record of it"
        );
    }

    /// Nothing read the note, and yet something is holding the run file open,
    /// so the process it names is the sidecar after all and coilbox must leave
    /// it alone. The residual case: a sidecar whose note reading has stopped
    /// while the process has not. Told apart from the case above only by the
    /// note still sitting there.
    #[tokio::test(start_paused = true)]
    async fn a_note_nothing_ever_reads_is_reported_as_no_answer() {
        let dir = tempfile::tempdir().expect("a temp dir");
        let (run_file, _held) = a_run_file_naming_a_live_sidecar(dir.path());

        assert_eq!(
            ask_the_leftover_sidecar_to_stop(&run_file, false).await,
            Ok(StopAnswer::NoAnswer)
        );
        assert_eq!(
            std::fs::read_to_string(note_beside(&run_file)).expect("the note is still there"),
            coilbox_relay_protocol::StopNote {
                pid: std::process::id()
            }
            .to_json(),
            "the note has to name the process the run file named, or a sidecar that is there \
             would leave it alone"
        );
    }

    /// The record issue #2078 is about, reached through the button rather than
    /// through hosting. The sidecar has gone and its number now belongs to
    /// something else, so nothing holds the file, and the host is told they can
    /// host rather than told to restart the machine.
    ///
    /// No note is left, because there is nobody to leave one for and the next
    /// sidecar to start would read it.
    #[tokio::test(start_paused = true)]
    async fn a_record_naming_a_process_that_is_not_the_sidecar_is_already_gone() {
        let dir = tempfile::tempdir().expect("a temp dir");
        let (run_file, held) = a_run_file_naming_a_live_sidecar(dir.path());
        // The sidecar dying, which is the kernel giving the lock back. The pid
        // in the file is this test process, which is very much still running.
        drop(held);

        assert_eq!(
            ask_the_leftover_sidecar_to_stop(&run_file, false).await,
            Ok(StopAnswer::Gone)
        );
        assert!(!note_beside(&run_file).exists());
    }

    /// The whole of issue #2074's first half. Somebody closed coilbox mid-game
    /// and opened it again, and the relay carrying everybody else's traffic is
    /// still there. coilbox has no pipe to it and never will, so the run file is
    /// the only thing that can say it is there, and it does.
    #[test]
    fn a_relay_from_an_earlier_session_is_found_by_a_coilbox_that_never_started_it() {
        let dir = tempfile::tempdir().expect("a temp dir");
        let (run_file, _held) = a_run_file_naming_a_live_sidecar(dir.path());

        assert_eq!(
            relay_left_running(&run_file, false),
            Some(std::process::id())
        );
    }

    /// The host's own battle, which is the same run file and needs the opposite
    /// answer. Without this the topbar would tell a host who is hosting a
    /// relayed battle about their own game as though somebody else had left it
    /// running.
    #[test]
    fn a_relay_this_coilbox_is_hosting_through_is_not_one_left_running() {
        let dir = tempfile::tempdir().expect("a temp dir");
        let (run_file, _held) = a_run_file_naming_a_live_sidecar(dir.path());

        assert_eq!(relay_left_running(&run_file, true), None);
    }

    /// A record naming a process id the OS has handed on to something else, so
    /// nothing holds the file. There is no relay, and claiming one would put a
    /// pill in the topbar for a game nobody is playing.
    #[test]
    fn a_record_nothing_is_holding_is_not_a_relay_left_running() {
        let dir = tempfile::tempdir().expect("a temp dir");
        let (run_file, held) = a_run_file_naming_a_live_sidecar(dir.path());
        // The sidecar dying, which is the kernel giving the lock back.
        drop(held);

        assert_eq!(relay_left_running(&run_file, false), None);
    }

    #[test]
    fn nothing_is_left_running_when_there_is_no_run_file() {
        let dir = tempfile::tempdir().expect("a temp dir");
        assert_eq!(
            relay_left_running(&dir.path().join("relay").join("agent.json"), false),
            None
        );
    }

    /// The second half, and the only figure a reopened coilbox has any right to
    /// show. The sidecar writes down what it is carrying beside its run file,
    /// and this is coilbox reading it back through the same pid the run file
    /// named.
    #[test]
    fn what_a_relay_left_running_is_carrying_is_read_from_the_record_it_wrote() {
        let dir = tempfile::tempdir().expect("a temp dir");
        let (run_file, _held) = a_run_file_naming_a_live_sidecar(dir.path());
        std::fs::write(
            coilbox_relay_protocol::carrying_path(&run_file),
            coilbox_relay_protocol::Carrying {
                pid: std::process::id(),
                bytes_per_second: 41_984,
            }
            .to_json(),
        )
        .expect("a writable temp dir");

        let found = relay_left_running(&run_file, false).expect("the sidecar is there");
        assert_eq!(
            coilbox_relay_protocol::carrying_now(&run_file, found),
            Some(41_984)
        );
    }

    /// A relay that is there and has written nothing, which is a sidecar from a
    /// build before the record existed. It is still a relay and the host still
    /// needs telling, and the figure is simply missing rather than invented.
    #[test]
    fn a_relay_left_running_that_says_nothing_is_still_a_relay_left_running() {
        let dir = tempfile::tempdir().expect("a temp dir");
        let (run_file, _held) = a_run_file_naming_a_live_sidecar(dir.path());

        let found = relay_left_running(&run_file, false).expect("the sidecar is there");
        assert_eq!(coilbox_relay_protocol::carrying_now(&run_file, found), None);
    }

    /// The whole of issue #2094. The host has left their battle room while the
    /// game is still being played, so [`forget_relay`] has taken the handle
    /// away and the sidecar is carrying every other player as it was a second
    /// ago. Both of those have to reach the topbar, or its X ends the game for
    /// all of them on the first press with nothing said.
    #[test]
    fn a_relay_is_still_behind_the_game_after_the_host_leaves_the_battle_room() {
        let dir = tempfile::tempdir().expect("a temp dir");
        let (run_file, _held) = a_run_file_naming_a_live_sidecar(dir.path());
        std::fs::write(
            coilbox_relay_protocol::carrying_path(&run_file),
            coilbox_relay_protocol::Carrying {
                pid: std::process::id(),
                bytes_per_second: 41_984,
            }
            .to_json(),
        )
        .expect("a writable temp dir");
        // Nothing holds a relay, which is exactly what leaving the battle room
        // leaves behind.
        let registry = Registry::default();

        assert_eq!(
            relay_behind_the_game(&registry, Some(&run_file)),
            RelayBehindTheGame {
                relaying: true,
                bytes_per_second: Some(41_984),
            }
        );
    }

    /// The same window with no figure to be had, which is a sidecar from a
    /// build before the record existed or one whose last word has gone stale.
    /// The warning is not the figure's to give. Everybody in that game is
    /// connected through this machine either way, which is the coupling that
    /// made #2094 a bug in the first place.
    #[test]
    fn a_relay_with_nothing_to_say_is_still_a_relay_behind_the_game() {
        let dir = tempfile::tempdir().expect("a temp dir");
        let (run_file, _held) = a_run_file_naming_a_live_sidecar(dir.path());
        let registry = Registry::default();

        assert_eq!(
            relay_behind_the_game(&registry, Some(&run_file)),
            RelayBehindTheGame {
                relaying: true,
                bytes_per_second: None,
            }
        );
    }

    /// The game ending. The sidecar has gone, nobody else is connected through
    /// this machine any more, and the X goes back to ending a game that is only
    /// this host's.
    #[test]
    fn nothing_is_behind_the_game_once_the_sidecar_has_gone() {
        let dir = tempfile::tempdir().expect("a temp dir");
        let (run_file, held) = a_run_file_naming_a_live_sidecar(dir.path());
        // The sidecar dying, which is the kernel giving the lock back.
        drop(held);
        let registry = Registry::default();

        assert_eq!(
            relay_behind_the_game(&registry, Some(&run_file)),
            RelayBehindTheGame {
                relaying: false,
                bytes_per_second: None,
            }
        );
    }

    /// The ordinary case, which must not regress on the way to fixing the one
    /// above. coilbox is hosting the battle and holds the handle, and the
    /// sidecar has not reported a rate yet, as it has not in the first second
    /// of every relayed game there has ever been. The warning is on from that
    /// first second, and it stays on with no run file to read at all, because a
    /// data directory coilbox could not resolve is not evidence that nobody
    /// else is in this game.
    #[test]
    fn the_handle_is_enough_to_warn_before_any_figure_arrives() {
        let registry = Registry::default();
        lock_or_recover(&registry)
            .insert("alice@bar:8200".to_string(), a_connection_hosting_nothing());
        let _agent_said = hosting_through_a_relay(&registry, "alice@bar:8200", None);

        assert_eq!(
            relay_behind_the_game(&registry, None),
            RelayBehindTheGame {
                relaying: true,
                bytes_per_second: None,
            }
        );
    }

    /// The registry scan behind the guard above, which is the only thing
    /// standing between a host and their own battle. A version that always said
    /// no would pass every test that has no connection in it, which is most of
    /// them.
    #[test]
    fn a_connection_hosting_through_the_relay_is_what_makes_the_sidecar_ours() {
        let registry = Registry::default();
        assert!(!hosting_through_the_relay(&registry));

        lock_or_recover(&registry)
            .insert("alice@bar:8200".to_string(), a_connection_hosting_nothing());
        assert!(
            !hosting_through_the_relay(&registry),
            "an ordinary battle has no sidecar of its own"
        );

        remember_relay(
            &registry,
            "alice@bar:8200",
            a_relay_writing_to(Channelled::default()),
        );
        assert!(hosting_through_the_relay(&registry));
    }

    /// The registry lookup behind `mp_watch_engine`, asked the way the sidecar
    /// will hear it: not "was a flag set" but "which line reached the agent's
    /// stdin".
    ///
    /// Both halves matter and they fail in opposite directions. Telling nobody
    /// costs four minutes of somebody else's bandwidth. Telling a relay about a
    /// process that is not the engine ends a game that is still being played,
    /// so the pid on the wire has to be the pid that was asked for and there
    /// has to be nothing else on there.
    #[test]
    fn the_engine_is_named_only_to_a_battle_that_is_being_relayed() {
        let registry = Registry::default();
        assert!(
            !watch_engine(&registry, "alice@bar:8200", 4242),
            "nothing is being relayed, so there is nobody to tell"
        );

        lock_or_recover(&registry)
            .insert("alice@bar:8200".to_string(), a_connection_hosting_nothing());
        assert!(
            !watch_engine(&registry, "alice@bar:8200", 4242),
            "an ordinary battle has no sidecar of its own, and every game that is not \
             relayed looks like this"
        );

        let channel = Channelled::default();
        remember_relay(
            &registry,
            "alice@bar:8200",
            a_relay_writing_to(channel.clone()),
        );
        assert!(watch_engine(&registry, "alice@bar:8200", 4242));
        assert_eq!(
            channel.sent().lines().collect::<Vec<_>>(),
            vec!["{\"type\":\"watchEngine\",\"id\":1,\"pid\":4242}"],
            "the sidecar has to be given the engine's pid and nothing else: it stops \
             relaying when the process it was told about exits"
        );
    }

    /// A second lobby connection cannot hand its engine to the first one's
    /// relay (issue #2099).
    ///
    /// The registry is keyed by server key and has always held one relay slot
    /// per connection, so two entries is the shape it is built for. What used
    /// to happen is that the pid went to whichever entry the scan reached
    /// first, and a `HashMap` has no first. The relay here is carrying alice's
    /// battle, and the engine being launched belongs to bob's, so the only safe
    /// answer is to send nothing at all: the sidecar stops when the process it
    /// was named exits, and bob's engine exiting has nothing to say about
    /// whether alice's game is over.
    ///
    /// Asserted on the wire rather than on the return value, because
    /// `watching: false` with a line already written would be the failure
    /// happening quietly.
    #[test]
    fn an_engine_is_never_named_to_another_connections_relay() {
        let registry = Registry::default();
        {
            let mut map = lock_or_recover(&registry);
            map.insert("alice@bar:8200".to_string(), a_connection_hosting_nothing());
            map.insert("bob@baz:8200".to_string(), a_connection_hosting_nothing());
        }
        let channel = Channelled::default();
        remember_relay(
            &registry,
            "alice@bar:8200",
            a_relay_writing_to(channel.clone()),
        );

        assert!(
            !watch_engine(&registry, "bob@baz:8200", 4242),
            "bob's battle is hosted through no relay, so there is nothing of bob's to tell"
        );
        assert_eq!(
            channel.sent(),
            "",
            "alice's relay is carrying alice's battle, and bob's engine exiting must not \
             be what ends it"
        );

        assert!(
            watch_engine(&registry, "alice@bar:8200", 4242),
            "the connection that does hold the relay is still told"
        );
        assert_eq!(
            channel.sent().lines().collect::<Vec<_>>(),
            vec!["{\"type\":\"watchEngine\",\"id\":1,\"pid\":4242}"]
        );
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
