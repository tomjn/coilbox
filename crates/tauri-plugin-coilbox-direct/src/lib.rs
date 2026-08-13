//! Direct and LAN hosting (Rust half): a TASServer subset the host runs in
//! process, so two people on one network can play with no lobby server at all.
//!
//! The principle is that joiners use the existing client path, unchanged, and the
//! host's own client connects to this over loopback. Everything above the socket
//! is then one code path: the same battle room, the same host powers, the same
//! start script, the same launch. Coilbox never hosts the *game*, which the
//! engine has always done. This replaces the lobby layer only.
//!
//! Registered as `"coilbox-direct"`, so the frontend invokes
//! `plugin:coilbox-direct|<cmd>`.
//!
//! # What lives where
//!
//! - `coilbox-lobby-protocol::server` decides what every peer is told.
//! - [`room`] owns the listener, the sockets and the disconnects.
//! - This file is the IPC surface over one running room.

use std::sync::Arc;

use picoframe_core::CliResult;
use serde_json::json;
use tauri::{
    plugin::{Builder, TauriPlugin},
    Runtime, State,
};
use tokio::sync::Mutex;

pub mod room;

pub use room::{Room, RoomOptions, RoomStatus, DEFAULT_LOBBY_PORT};

/// The reason a stopped room gives its joiners when the host did not name one.
const DEFAULT_STOP_REASON: &str = "the host stopped hosting this room";

/// The one room this client hosts, if it is hosting.
///
/// One rather than many: a second room would be a second battle nobody could
/// reach from the first, and the host has one engine to launch either way. An
/// async mutex because stopping a room waits for its sockets to close.
#[derive(Default)]
pub struct ActiveRoom(Arc<Mutex<Option<Room>>>);

/// `direct_start_room`: bind the lobby port and start hosting.
///
/// Answers with the port the host's own client should then connect to over
/// loopback. Nothing else happens here: the battle itself is opened by that
/// client sending `OPENBATTLE`, exactly as it would to a real server.
#[tauri::command]
async fn direct_start_room(
    active: State<'_, ActiveRoom>,
    host: String,
    ip: Option<String>,
    port: Option<u16>,
    approve_joins: Option<bool>,
) -> Result<CliResult, ()> {
    let mut slot = active.0.lock().await;
    if let Some(running) = slot.as_ref() {
        return Ok(CliResult::err(format!(
            "already hosting a room on port {}",
            running.port()
        )));
    }
    let options = RoomOptions {
        host,
        // Loopback is the honest default: it is the only address this crate can
        // be sure of. The LAN address comes from discovery and the public one
        // from port mapping, both of which are somebody else's work.
        ip: ip.unwrap_or_else(|| "127.0.0.1".to_string()),
        port: port.unwrap_or(DEFAULT_LOBBY_PORT),
        approve_joins: approve_joins.unwrap_or(false),
    };
    Ok(match Room::start(options).await {
        Ok(room) => {
            let port = room.port();
            *slot = Some(room);
            CliResult::ok(json!({ "port": port }))
        }
        Err(e) => CliResult::err(e),
    })
}

/// `direct_stop_room`: stop hosting, telling everybody why.
///
/// Stopping a room a joiner is sitting in has to reach them in words. A socket
/// that simply goes quiet leaves them looking at a battle that no longer exists.
#[tauri::command]
async fn direct_stop_room(
    active: State<'_, ActiveRoom>,
    reason: Option<String>,
) -> Result<CliResult, ()> {
    let room = active.0.lock().await.take();
    Ok(match room {
        Some(room) => {
            room.stop(reason.as_deref().unwrap_or(DEFAULT_STOP_REASON))
                .await;
            CliResult::ok(json!({ "stopped": true }))
        }
        None => CliResult::ok(json!({ "stopped": false })),
    })
}

/// `direct_room_status`: what the room holds, or `null` when not hosting.
#[tauri::command]
async fn direct_room_status(active: State<'_, ActiveRoom>) -> Result<CliResult, ()> {
    let slot = active.0.lock().await;
    let status = match slot.as_ref() {
        Some(room) => room.status().await,
        None => None,
    };
    Ok(CliResult::ok(json!({ "room": status })))
}

/// Build the plugin. Registered as `"coilbox-direct"`.
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("coilbox-direct")
        .setup(|app, _api| {
            tauri::Manager::manage(app, ActiveRoom::default());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            direct_start_room,
            direct_stop_room,
            direct_room_status
        ])
        .build()
}
