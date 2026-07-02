//! Live lobby client (Rust half). A thin async IO shell around
//! `coilbox-lobby-protocol`: it owns the tokio TCP socket (with STLS/TLS upgrade),
//! runs the reply-driven login state machine, feeds each server line through the
//! protocol reducer, and streams the resulting state deltas to the frontend over a
//! Tauri `Channel`. Registered as `"coilbox-multiplayer"`; the frontend invokes
//! `plugin:coilbox-multiplayer|<cmd>`.

use picoframe_core::CliResult;
use tauri::{
    plugin::{Builder, TauriPlugin},
    Runtime,
};

// Scaffold stubs — real connection/state bodies land in the implementation pass.
#[tauri::command]
async fn mp_connect() -> CliResult {
    CliResult::err("mp_connect not yet implemented")
}

#[tauri::command]
async fn mp_disconnect() -> CliResult {
    CliResult::err("mp_disconnect not yet implemented")
}

#[tauri::command]
async fn mp_snapshot() -> CliResult {
    CliResult::err("mp_snapshot not yet implemented")
}

/// Build the plugin. Registered as `"coilbox-multiplayer"`.
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("coilbox-multiplayer")
        .invoke_handler(tauri::generate_handler![
            mp_connect,
            mp_disconnect,
            mp_snapshot
        ])
        .build()
}
