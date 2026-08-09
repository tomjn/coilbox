//! Lobby server directory + OS-keychain credential vault (Rust half).
//!
//! The server *directory* (names/hosts/ports/usernames) is persisted frontend-side
//! through the frame settings store; this crate exists to keep the *secrets*
//! (passwords / tokens) out of that plaintext JSON, in the OS keychain via the
//! `keyring` crate. Registered as `"coilbox-lobby-servers"`; the frontend invokes
//! `plugin:coilbox-lobby-servers|<cmd>`.

use std::{
    collections::HashMap,
    sync::{Mutex, OnceLock},
};

use picoframe_core::CliResult;
use serde_json::json;
use tauri::{
    plugin::{Builder, TauriPlugin},
    Runtime,
};

/// Keychain service name shared by every stored lobby secret.
const SERVICE: &str = "coilbox-lobby";

/// Process-lifetime cache of secrets already read from (or written to) the
/// keychain, keyed by [`account_key`]. The Rust process survives webview
/// reloads and reconnect loops, so the OS keychain (and its macOS auth
/// prompt) is hit at most once per `{server, username}` per app run. See
/// `read_via_security_tool` for why macOS dev builds need more than that.
///
/// A process-wide static rather than Tauri managed state, because the Rust-side
/// callers below have no `AppHandle` to reach managed state through, and two caches
/// over one keychain would mean two macOS prompts.
static CACHE: OnceLock<Mutex<HashMap<String, String>>> = OnceLock::new();

fn cache() -> &'static Mutex<HashMap<String, String>> {
    CACHE.get_or_init(Default::default)
}

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

/// Store (or replace) a login secret for `{server, username}` in the OS keychain
/// and the in-process cache.
pub fn store_credential(server_id: &str, username: &str, secret: &str) -> Result<(), String> {
    let entry = entry(server_id, username)?;
    entry
        .set_password(secret)
        .map_err(|e| format!("failed to store credential: {e}"))?;
    cache()
        .lock()
        .unwrap()
        .insert(account_key(server_id, username), secret.to_owned());
    Ok(())
}

/// `ls_store_credential`: [`store_credential`] over IPC.
#[tauri::command]
async fn ls_store_credential(
    server_id: String,
    username: String,
    secret: String,
) -> Result<CliResult, ()> {
    Ok(match store_credential(&server_id, &username, &secret) {
        Ok(()) => CliResult::ok(json!({})),
        Err(e) => CliResult::err(e),
    })
}

/// Read a secret through `/usr/bin/security` instead of the in-process API.
///
/// macOS grants keychain access per calling binary, and a dev build is
/// re-signed on every rebuild, so an "Always Allow" answer is invalidated as
/// soon as you touch any Rust file. Signing dev builds with a stable
/// certificate does not fix it, because macOS only derives the stable
/// `teamid:` grant from an Apple-issued certificate and falls back to the
/// per-build code hash otherwise.
///
/// `/usr/bin/security` is Apple-signed and never changes, so a grant given to
/// it holds for good. Anything unexpected returns `None` and falls through to
/// the in-process read, which keeps the "no entry" and error cases in one
/// place. Release builds never take this path.
#[cfg(all(target_os = "macos", debug_assertions))]
fn read_via_security_tool(account: &str) -> Option<String> {
    let out = std::process::Command::new("/usr/bin/security")
        .args(["find-generic-password", "-w", "-s", SERVICE, "-a", account])
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    let secret = String::from_utf8(out.stdout).ok()?;
    // `security -w` terminates the secret with a newline of its own.
    Some(secret.strip_suffix('\n').unwrap_or(&secret).to_owned())
}

/// Read a stored secret, serving repeats from the cache. A missing entry is not an
/// error, it is `Ok(None)`.
pub fn get_credential(server_id: &str, username: &str) -> Result<Option<String>, String> {
    let key = account_key(server_id, username);
    if let Some(secret) = cache().lock().unwrap().get(&key) {
        return Ok(Some(secret.clone()));
    }
    #[cfg(all(target_os = "macos", debug_assertions))]
    if let Some(secret) = read_via_security_tool(&key) {
        cache().lock().unwrap().insert(key, secret.clone());
        return Ok(Some(secret));
    }
    let entry = entry(server_id, username)?;
    match entry.get_password() {
        Ok(pw) => {
            cache().lock().unwrap().insert(key, pw.clone());
            Ok(Some(pw))
        }
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(format!("failed to read credential: {e}")),
    }
}

/// `ls_get_credential`: [`get_credential`] over IPC. A missing entry resolves with
/// `{ "secret": null }`.
#[tauri::command]
async fn ls_get_credential(server_id: String, username: String) -> Result<CliResult, ()> {
    Ok(match get_credential(&server_id, &username) {
        Ok(secret) => CliResult::ok(json!({ "secret": secret })),
        Err(e) => CliResult::err(e),
    })
}

/// Delete a stored secret from the keychain and the cache. A missing entry is
/// treated as success, so this can be re-run safely.
pub fn delete_credential(server_id: &str, username: &str) -> Result<(), String> {
    cache()
        .lock()
        .unwrap()
        .remove(&account_key(server_id, username));
    let entry = entry(server_id, username)?;
    match entry.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(format!("failed to delete credential: {e}")),
    }
}

/// `ls_delete_credential`: [`delete_credential`] over IPC.
#[tauri::command]
async fn ls_delete_credential(server_id: String, username: String) -> Result<CliResult, ()> {
    Ok(match delete_credential(&server_id, &username) {
        Ok(()) => CliResult::ok(json!({})),
        Err(e) => CliResult::err(e),
    })
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
