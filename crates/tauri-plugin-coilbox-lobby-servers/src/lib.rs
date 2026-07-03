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

/// Keychain service name shared by every stored lobby secret.
const SERVICE: &str = "coilbox-lobby";

/// Keychain account key for a `{server, username}` pair. Kept as a pure function so
/// it can be unit-tested without touching the OS keychain.
fn account_key(server_id: &str, username: &str) -> String {
    format!("{server_id}:{username}")
}

/// Build the keyring [`Entry`](keyring::Entry) for a `{server, username}` pair.
/// `Entry::new` is fallible on some platforms, so its error is surfaced as a string.
fn entry(server_id: &str, username: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new(SERVICE, &account_key(server_id, username))
        .map_err(|e| format!("keychain entry error: {e}"))
}

/// `ls_store_credential` — store (or replace) a login secret for `{server, username}`
/// in the OS keychain.
#[tauri::command]
async fn ls_store_credential(server_id: String, username: String, secret: String) -> CliResult {
    let entry = match entry(&server_id, &username) {
        Ok(e) => e,
        Err(e) => return CliResult::err(e),
    };
    match entry.set_password(&secret) {
        Ok(()) => CliResult::ok(json!({})),
        Err(e) => CliResult::err(format!("failed to store credential: {e}")),
    }
}

/// `ls_get_credential` — read a stored secret. A missing entry is not an error; it
/// resolves with `{ "secret": null }`.
#[tauri::command]
async fn ls_get_credential(server_id: String, username: String) -> CliResult {
    let entry = match entry(&server_id, &username) {
        Ok(e) => e,
        Err(e) => return CliResult::err(e),
    };
    match entry.get_password() {
        Ok(pw) => CliResult::ok(json!({ "secret": pw })),
        Err(keyring::Error::NoEntry) => CliResult::ok(json!({ "secret": null })),
        Err(e) => CliResult::err(format!("failed to read credential: {e}")),
    }
}

/// `ls_delete_credential` — delete a stored secret. A missing entry is treated as
/// success (idempotent cleanup).
#[tauri::command]
async fn ls_delete_credential(server_id: String, username: String) -> CliResult {
    let entry = match entry(&server_id, &username) {
        Ok(e) => e,
        Err(e) => return CliResult::err(e),
    };
    match entry.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => CliResult::ok(json!({})),
        Err(e) => CliResult::err(format!("failed to delete credential: {e}")),
    }
}

/// Build the plugin. Registered as `"coilbox-lobby-servers"`.
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("coilbox-lobby-servers")
        .invoke_handler(tauri::generate_handler![
            ls_store_credential,
            ls_get_credential,
            ls_delete_credential
        ])
        .build()
}

#[cfg(test)]
mod tests {
    use super::account_key;

    #[test]
    fn account_key_joins_server_and_username() {
        assert_eq!(account_key("srv-1", "alice"), "srv-1:alice");
        assert_eq!(account_key("srv-1", ""), "srv-1:");
    }
}
