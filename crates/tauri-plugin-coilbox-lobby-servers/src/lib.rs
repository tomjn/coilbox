//! Lobby server directory + OS-keychain credential vault (Rust half).
//!
//! The server *directory* (names/hosts/ports/usernames) is persisted frontend-side
//! through the frame settings store; this crate exists to keep the *secrets*
//! (passwords / tokens) out of that plaintext JSON, in the OS keychain via the
//! `keyring` crate. Registered as `"coilbox-lobby-servers"`; the frontend invokes
//! `plugin:coilbox-lobby-servers|<cmd>`.

use picoframe_core::CliResult;
use serde_json::json;
use tauri::{
    plugin::{Builder, TauriPlugin},
    Runtime,
};

// Scaffold stubs — real keyring bodies land in the implementation pass.
#[tauri::command]
async fn ls_store_credential(_server_id: String, _username: String, _secret: String) -> CliResult {
    CliResult::err("ls_store_credential not yet implemented")
}

#[tauri::command]
async fn ls_get_credential(_server_id: String, _username: String) -> CliResult {
    CliResult::err("ls_get_credential not yet implemented")
}

#[tauri::command]
async fn ls_delete_credential(_server_id: String, _username: String) -> CliResult {
    CliResult::err("ls_delete_credential not yet implemented")
}

/// Build the plugin. Registered as `"coilbox-lobby-servers"`.
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    let _ = json!({});
    Builder::new("coilbox-lobby-servers")
        .invoke_handler(tauri::generate_handler![
            ls_store_credential,
            ls_get_credential,
            ls_delete_credential
        ])
        .build()
}
