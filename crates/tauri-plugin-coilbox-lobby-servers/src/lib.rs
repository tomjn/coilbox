//! Lobby server directory + OS-keychain credential vault (Rust half).
//!
//! The server *directory* (names/hosts/ports/usernames) is persisted frontend-side
//! through the frame settings store; this crate exists to keep the *secrets*
//! (passwords / tokens) out of that plaintext JSON, in the OS keychain via the
//! `keyring` crate. Registered as `"coilbox-lobby-servers"`; the frontend invokes
//! `plugin:coilbox-lobby-servers|<cmd>`.

use std::{collections::HashMap, sync::Mutex};

use picoframe_core::CliResult;
use serde_json::json;
use tauri::{
    plugin::{Builder, TauriPlugin},
    Manager, Runtime, State,
};

/// Keychain service name shared by every stored lobby secret.
const SERVICE: &str = "coilbox-lobby";

/// Process-lifetime cache of secrets already read from (or written to) the
/// keychain, keyed by [`account_key`]. The Rust process survives webview
/// reloads and reconnect loops, so the OS keychain (and its macOS auth
/// prompt) is hit at most once per `{server, username}` per app run — on
/// macOS dev builds "Always Allow" never sticks because the ad-hoc code
/// signature changes on every rebuild, making repeat reads especially noisy.
#[derive(Default)]
struct CredCache(Mutex<HashMap<String, String>>);

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
/// in the OS keychain (and the in-process cache).
#[tauri::command]
async fn ls_store_credential(
    cache: State<'_, CredCache>,
    server_id: String,
    username: String,
    secret: String,
) -> Result<CliResult, ()> {
    let entry = match entry(&server_id, &username) {
        Ok(e) => e,
        Err(e) => return Ok(CliResult::err(e)),
    };
    Ok(match entry.set_password(&secret) {
        Ok(()) => {
            cache
                .0
                .lock()
                .unwrap()
                .insert(account_key(&server_id, &username), secret);
            CliResult::ok(json!({}))
        }
        Err(e) => CliResult::err(format!("failed to store credential: {e}")),
    })
}

/// `ls_get_credential` — read a stored secret, serving repeats from the cache. A
/// missing entry is not an error; it resolves with `{ "secret": null }`.
#[tauri::command]
async fn ls_get_credential(
    cache: State<'_, CredCache>,
    server_id: String,
    username: String,
) -> Result<CliResult, ()> {
    let key = account_key(&server_id, &username);
    if let Some(secret) = cache.0.lock().unwrap().get(&key) {
        return Ok(CliResult::ok(json!({ "secret": secret })));
    }
    let entry = match entry(&server_id, &username) {
        Ok(e) => e,
        Err(e) => return Ok(CliResult::err(e)),
    };
    Ok(match entry.get_password() {
        Ok(pw) => {
            cache.0.lock().unwrap().insert(key, pw.clone());
            CliResult::ok(json!({ "secret": pw }))
        }
        Err(keyring::Error::NoEntry) => CliResult::ok(json!({ "secret": null })),
        Err(e) => CliResult::err(format!("failed to read credential: {e}")),
    })
}

/// `ls_delete_credential` — delete a stored secret (keychain and cache). A missing
/// entry is treated as success (idempotent cleanup).
#[tauri::command]
async fn ls_delete_credential(
    cache: State<'_, CredCache>,
    server_id: String,
    username: String,
) -> Result<CliResult, ()> {
    cache
        .0
        .lock()
        .unwrap()
        .remove(&account_key(&server_id, &username));
    let entry = match entry(&server_id, &username) {
        Ok(e) => e,
        Err(e) => return Ok(CliResult::err(e)),
    };
    Ok(match entry.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => CliResult::ok(json!({})),
        Err(e) => CliResult::err(format!("failed to delete credential: {e}")),
    })
}

/// Build the plugin. Registered as `"coilbox-lobby-servers"`.
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("coilbox-lobby-servers")
        .setup(|app, _| {
            app.manage(CredCache::default());
            Ok(())
        })
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
