//! Lobby server directory + OS-keychain credential vault (Rust half).
//!
//! The server *directory* (names/hosts/ports/usernames) is persisted frontend-side
//! through the frame settings store; this crate exists to keep the *secrets*
//! (passwords / tokens) out of that plaintext JSON, in the OS keychain via the
//! `keyring` crate. Registered as `"coilbox-lobby-servers"`; the frontend invokes
//! `plugin:coilbox-lobby-servers|<cmd>`.

use std::{
    collections::HashMap,
    sync::{Arc, Mutex, OnceLock},
};

use picoframe_core::CliResult;
use serde_json::json;
use tauri::{
    plugin::{Builder, TauriPlugin},
    Runtime,
};

/// Keychain service name shared by every stored lobby secret.
const SERVICE: &str = "coilbox-lobby";

/// Process-lifetime cache of what the keychain holds for each [`account_key`],
/// including the accounts it holds nothing for. The Rust process survives
/// webview reloads and reconnect loops, so the OS keychain (and its macOS auth
/// prompt) is hit at most once per `{server, username}` per app run. See
/// `read_via_security_tool` for why macOS dev builds need more than that.
///
/// `None` means "asked, and there is nothing stored". Caching that matters as
/// much as caching a secret: a signed-out account is asked about just as often,
/// and every one of those was reaching the keychain.
///
/// A process-wide static rather than Tauri managed state, because the Rust-side
/// callers below have no `AppHandle` to reach managed state through, and two caches
/// over one keychain would mean two macOS prompts.
static CACHE: OnceLock<Mutex<HashMap<String, Option<String>>>> = OnceLock::new();

fn cache() -> &'static Mutex<HashMap<String, Option<String>>> {
    CACHE.get_or_init(Default::default)
}

/// One lock per account, held across a keychain read so concurrent callers wait
/// for the first answer instead of each asking the OS themselves. See
/// [`read_once`].
static READ_GATES: OnceLock<Mutex<HashMap<String, Arc<Mutex<()>>>>> = OnceLock::new();

fn read_gate(key: &str) -> Arc<Mutex<()>> {
    READ_GATES
        .get_or_init(Default::default)
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .entry(key.to_owned())
        .or_default()
        .clone()
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
        .insert(account_key(server_id, username), Some(secret.to_owned()));
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
    read_once(&key, || read_from_keychain(server_id, username, &key))
}

/// Read a secret at most once per account, however many callers ask at once.
///
/// The cache alone was not enough. It only fills once a read has returned, so
/// three callers asking in the same moment all missed it and all reached the
/// keychain, which on macOS is three auth prompts in a row. Opening the hub did
/// exactly that: its header, its publish form and its settings section each
/// asked who was signed in.
///
/// So each account gets a lock, held across the read. Whoever arrives second
/// waits, then finds the answer already cached. The lock is per account rather
/// than global, because two different accounts have no reason to wait on each
/// other.
fn read_once(
    key: &str,
    read: impl FnOnce() -> Result<Option<String>, String>,
) -> Result<Option<String>, String> {
    if let Some(cached) = cache().lock().unwrap().get(key) {
        return Ok(cached.clone());
    }
    let gate = read_gate(key);
    let _held = gate.lock().unwrap_or_else(|e| e.into_inner());
    // Whoever we queued behind has answered by now, and their answer is ours.
    if let Some(cached) = cache().lock().unwrap().get(key) {
        return Ok(cached.clone());
    }
    let secret = read()?;
    cache()
        .lock()
        .unwrap()
        .insert(key.to_owned(), secret.clone());
    Ok(secret)
}

/// The keychain read itself. A missing entry is `Ok(None)`, not an error.
fn read_from_keychain(
    server_id: &str,
    username: &str,
    key: &str,
) -> Result<Option<String>, String> {
    #[cfg(all(target_os = "macos", debug_assertions))]
    if let Some(secret) = read_via_security_tool(key) {
        return Ok(Some(secret));
    }
    #[cfg(not(all(target_os = "macos", debug_assertions)))]
    let _ = key;
    let entry = entry(server_id, username)?;
    match entry.get_password() {
        Ok(pw) => Ok(Some(pw)),
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
    // Recorded as "nothing stored" rather than dropped, so the next reader is
    // answered from here instead of going back to the keychain to be told the
    // same thing.
    cache()
        .lock()
        .unwrap()
        .insert(account_key(server_id, username), None);
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
    use super::{account_key, read_once};
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Arc;
    use std::time::Duration;

    #[test]
    fn account_key_joins_server_and_username() {
        assert_eq!(account_key("srv-1", "alice"), "srv-1:alice");
        assert_eq!(account_key("srv-1", ""), "srv-1:");
    }

    /// The bug this exists for: three components asking who is signed in at the
    /// same moment, and macOS asking the user three times.
    #[test]
    fn callers_arriving_together_produce_one_keychain_read() {
        let reads = Arc::new(AtomicUsize::new(0));
        let key = "one-read:alice";
        let answers: Vec<_> = std::thread::scope(|scope| {
            let handles: Vec<_> = (0..3)
                .map(|_| {
                    let reads = Arc::clone(&reads);
                    scope.spawn(move || {
                        read_once(key, || {
                            reads.fetch_add(1, Ordering::SeqCst);
                            // Long enough that the others are certainly waiting,
                            // which is the case the lock is for.
                            std::thread::sleep(Duration::from_millis(50));
                            Ok(Some("a-secret".to_owned()))
                        })
                    })
                })
                .collect();
            handles.into_iter().map(|h| h.join().unwrap()).collect()
        });

        assert_eq!(reads.load(Ordering::SeqCst), 1);
        for answer in answers {
            assert_eq!(answer.unwrap().as_deref(), Some("a-secret"));
        }
    }

    /// An account with nothing stored is asked about as often as one with a
    /// secret, and used to reach the keychain every time.
    #[test]
    fn an_account_with_nothing_stored_is_only_asked_about_once() {
        let reads = Arc::new(AtomicUsize::new(0));
        let key = "absent:bob";
        for _ in 0..3 {
            let reads = Arc::clone(&reads);
            let answer = read_once(key, || {
                reads.fetch_add(1, Ordering::SeqCst);
                Ok(None)
            });
            assert_eq!(answer.unwrap(), None);
        }
        assert_eq!(reads.load(Ordering::SeqCst), 1);
    }

    /// A failed read is not an answer, so it is not remembered as one.
    #[test]
    fn a_failed_read_is_tried_again() {
        let reads = Arc::new(AtomicUsize::new(0));
        let key = "failing:carol";
        for _ in 0..2 {
            let reads = Arc::clone(&reads);
            let answer = read_once(key, || {
                reads.fetch_add(1, Ordering::SeqCst);
                Err("the keychain was locked".to_owned())
            });
            assert!(answer.is_err());
        }
        assert_eq!(reads.load(Ordering::SeqCst), 2);
    }
}
