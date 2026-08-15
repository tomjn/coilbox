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

/// Run a blocking keychain call somewhere other than the thread polling this
/// future (issue #1407).
///
/// The three IPC commands below are `async fn`s, so Tauri polls them on a runtime
/// worker. A keychain call made there holds that worker for as long as the OS
/// takes, and on macOS that is as long as a permission dialog sits unanswered:
/// #1407 recorded a `security` process blocked for eleven minutes, during which
/// no other IPC call was answered either and the app looked dead. On the blocking
/// pool the same wait costs one call rather than the whole app.
///
/// There is deliberately no deadline. What a caller is waiting for here is a
/// person: a lobby password read, stored or deleted at their request, and behind
/// a prompt they may take a while to find. Telling them the login failed while
/// the dialog is still on screen would be wrong, and a write given up on may land
/// anyway, so there would be nothing true to say about it. `coilbox_oauth` does put
/// its own `KEYCHAIN_TIMEOUT` over these same calls, because a token refresh has
/// nobody watching it, so the caller that wants a deadline already has one.
async fn off_the_polling_thread<T, F>(call: F) -> Result<T, String>
where
    F: FnOnce() -> Result<T, String> + Send + 'static,
    T: Send + 'static,
{
    match tauri::async_runtime::spawn_blocking(call).await {
        Ok(answer) => answer,
        Err(joined) => Err(format!("the keychain call did not finish: {joined}")),
    }
}

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

/// One lock per account, held across every keychain call for that account, so
/// concurrent callers wait for the first one instead of each asking the OS
/// themselves. See [`read_once`], [`write_once`] and [`delete_once`].
static ACCOUNT_GATES: OnceLock<Mutex<HashMap<String, Arc<Mutex<()>>>>> = OnceLock::new();

fn account_gate(key: &str) -> Arc<Mutex<()>> {
    ACCOUNT_GATES
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
    let key = account_key(server_id, username);
    write_once(&key, secret, || {
        write_to_keychain(server_id, username, &key, secret)
    })
}

/// Whether the cache already holds exactly this secret for `key`.
fn already_stored(key: &str, secret: &str) -> bool {
    matches!(cache().lock().unwrap().get(key), Some(Some(held)) if held == secret)
}

/// Write a secret at most once per new value, however many callers ask at once.
///
/// Two things stop a keychain call getting here. A value the cache already holds
/// is not written at all: the hub is handed a refresh token on every refresh, and
/// one that came back unchanged has nothing to store. And the account's gate is
/// held across the write, so callers arriving together collapse into one call
/// instead of each making their own, which is what [`read_once`] does for reads
/// and for the same reason - on macOS each of those is a prompt.
///
/// A write that failed leaves the cache alone. Recording a secret that is not in
/// the keychain would have the next reader served a value that is not there.
fn write_once(
    key: &str,
    secret: &str,
    write: impl FnOnce() -> Result<(), String>,
) -> Result<(), String> {
    if already_stored(key, secret) {
        return Ok(());
    }
    let gate = account_gate(key);
    let _held = gate.lock().unwrap_or_else(|e| e.into_inner());
    // Whoever we queued behind may have stored this very value.
    if already_stored(key, secret) {
        return Ok(());
    }
    write()?;
    cache()
        .lock()
        .unwrap()
        .insert(key.to_owned(), Some(secret.to_owned()));
    Ok(())
}

/// The keychain write itself.
fn write_to_keychain(
    server_id: &str,
    username: &str,
    key: &str,
    secret: &str,
) -> Result<(), String> {
    #[cfg(all(target_os = "macos", debug_assertions))]
    if store_command(key, secret).is_some_and(|command| run_security_tool(&command)) {
        return Ok(());
    }
    #[cfg(not(all(target_os = "macos", debug_assertions)))]
    let _ = key;
    let entry = entry(server_id, username)?;
    entry
        .set_password(secret)
        .map_err(|e| format!("failed to store credential: {e}"))
}

/// `ls_store_credential`: [`store_credential`] over IPC, off the polling thread.
#[tauri::command]
async fn ls_store_credential(
    server_id: String,
    username: String,
    secret: String,
) -> Result<CliResult, ()> {
    let stored =
        off_the_polling_thread(move || store_credential(&server_id, &username, &secret)).await;
    Ok(match stored {
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

/// The longest secret the `security` route will carry.
///
/// The tool reads a command line into a fixed buffer and truncates past about
/// 4 KB, reporting failure but leaving the short value stored. 512 bytes is far
/// more than any token coilbox keeps and far short of where the cutting starts.
/// Anything longer takes the in-process path.
#[cfg(all(target_os = "macos", debug_assertions))]
const LONGEST_SECRET_FOR_SECURITY_TOOL: usize = 512;

/// Whether `text` reaches `security` as itself.
///
/// The tool splits what it reads into arguments, so a value with a space or a
/// quote in it would arrive as something else, or as more arguments than were
/// meant. Rather than reproduce the tool's quoting, this allows only characters
/// that need none, which covers every token and account key coilbox stores.
/// Anything else takes the in-process path.
#[cfg(all(target_os = "macos", debug_assertions))]
fn survives_argument_splitting(text: &str) -> bool {
    !text.is_empty()
        && text
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"-_.~+/=:@".contains(&b))
}

/// The `security` command that stores `secret` under `account`, or `None` when
/// this route cannot carry it. `-U` replaces an item that is already there rather
/// than failing on the duplicate, which is the case that matters: a rotating
/// refresh token is written over its predecessor every time.
#[cfg(all(target_os = "macos", debug_assertions))]
fn store_command(account: &str, secret: &str) -> Option<String> {
    (survives_argument_splitting(account)
        && survives_argument_splitting(secret)
        && secret.len() <= LONGEST_SECRET_FOR_SECURITY_TOOL)
        .then(|| format!("add-generic-password -U -s {SERVICE} -a {account} -w {secret}"))
}

/// The `security` command that removes `account`, or `None` when this route
/// cannot carry it.
#[cfg(all(target_os = "macos", debug_assertions))]
fn delete_command(account: &str) -> Option<String> {
    survives_argument_splitting(account)
        .then(|| format!("delete-generic-password -s {SERVICE} -a {account}"))
}

/// Run one `security` command and say whether it succeeded.
///
/// The command goes in on stdin, not in `argv`. `security -i` reads commands from
/// stdin, and that is what keeps a secret out of the process list, where anything
/// running as this user could read it. The read route above has no such problem,
/// because an account name is not a secret.
///
/// Nothing the tool prints is kept. A message about a command that carries a
/// secret is the last thing to put in a log line, so its output goes nowhere and
/// the exit status is the whole answer. False means the caller falls through to
/// the in-process path, which is where the error cases are handled.
#[cfg(all(target_os = "macos", debug_assertions))]
fn run_security_tool(command: &str) -> bool {
    use std::io::Write;

    let Ok(mut child) = std::process::Command::new("/usr/bin/security")
        .arg("-i")
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
    else {
        return false;
    };
    // Dropping the pipe is what tells the tool there are no more commands.
    let wrote = match child.stdin.take() {
        Some(mut stdin) => writeln!(stdin, "{command}").is_ok(),
        None => false,
    };
    let finished = matches!(child.wait(), Ok(status) if status.success());
    wrote && finished
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
///
/// A caller giving up does not undo the read. `coilbox_oauth` puts a deadline
/// over these calls, and an OS call in flight cannot be cancelled, so an
/// abandoned read runs on. It fills the cache before it lets go of the gate,
/// which is what leaves whoever queued behind it an answer instead of a second
/// trip to the OS.
fn read_once(
    key: &str,
    read: impl FnOnce() -> Result<Option<String>, String>,
) -> Result<Option<String>, String> {
    if let Some(cached) = cache().lock().unwrap().get(key) {
        return Ok(cached.clone());
    }
    let gate = account_gate(key);
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

/// `ls_get_credential`: [`get_credential`] over IPC, off the polling thread. A
/// missing entry resolves with `{ "secret": null }`.
#[tauri::command]
async fn ls_get_credential(server_id: String, username: String) -> Result<CliResult, ()> {
    let read = off_the_polling_thread(move || get_credential(&server_id, &username)).await;
    Ok(match read {
        Ok(secret) => CliResult::ok(json!({ "secret": secret })),
        Err(e) => CliResult::err(e),
    })
}

/// Delete a stored secret from the keychain and the cache. A missing entry is
/// treated as success, so this can be re-run safely.
pub fn delete_credential(server_id: &str, username: &str) -> Result<(), String> {
    let key = account_key(server_id, username);
    delete_once(&key, || delete_from_keychain(server_id, username, &key))
}

/// Delete under the account's gate, so a delete and a read cannot both be asking
/// the OS about one account at the same moment.
///
/// "Nothing stored" is recorded rather than dropped, so the next reader is
/// answered from here instead of going back to the keychain to be told the same
/// thing. It is recorded only once the delete has gone through: a delete that
/// failed leaves the secret in the keychain, and saying otherwise would report
/// somebody as signed out who is not.
fn delete_once(key: &str, delete: impl FnOnce() -> Result<(), String>) -> Result<(), String> {
    let gate = account_gate(key);
    let _held = gate.lock().unwrap_or_else(|e| e.into_inner());
    delete()?;
    cache().lock().unwrap().insert(key.to_owned(), None);
    Ok(())
}

/// The keychain delete itself. A missing entry is success, not an error: the tool
/// reports one as a failure, which falls through to the in-process delete, and
/// there is nothing there for the OS to ask about.
fn delete_from_keychain(server_id: &str, username: &str, key: &str) -> Result<(), String> {
    #[cfg(all(target_os = "macos", debug_assertions))]
    if delete_command(key).is_some_and(|command| run_security_tool(&command)) {
        return Ok(());
    }
    #[cfg(not(all(target_os = "macos", debug_assertions)))]
    let _ = key;
    let entry = entry(server_id, username)?;
    match entry.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(format!("failed to delete credential: {e}")),
    }
}

/// `ls_delete_credential`: [`delete_credential`] over IPC, off the polling thread.
#[tauri::command]
async fn ls_delete_credential(server_id: String, username: String) -> Result<CliResult, ()> {
    let deleted = off_the_polling_thread(move || delete_credential(&server_id, &username)).await;
    Ok(match deleted {
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
    use super::{
        account_key, already_stored, delete_once, off_the_polling_thread, read_once, write_once,
    };
    use std::future::Future;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Arc;
    use std::task::{Context, Poll, Waker};
    use std::time::{Duration, Instant};

    /// Poll a future once from this thread, the way a runtime worker would, and
    /// say how it answered. Nothing wakes it afterwards, so a test that needs the
    /// answer polls it again through a real runtime.
    fn polled_once<F: Future>(future: &mut std::pin::Pin<Box<F>>) -> Poll<F::Output> {
        future
            .as_mut()
            .poll(&mut Context::from_waker(Waker::noop()))
    }

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

    /// Issue #1645: the hub is handed a refresh token every time it refreshes,
    /// and writes it. One that came back unchanged has nothing to store.
    #[test]
    fn a_value_already_held_is_not_written_again() {
        let writes = Arc::new(AtomicUsize::new(0));
        let key = "unchanged:dave";
        for _ in 0..3 {
            let writes = Arc::clone(&writes);
            write_once(key, "same-token", || {
                writes.fetch_add(1, Ordering::SeqCst);
                Ok(())
            })
            .unwrap();
        }
        assert_eq!(writes.load(Ordering::SeqCst), 1);
    }

    /// The write half of [`callers_arriving_together_produce_one_keychain_read`],
    /// and the same symptom: on macOS every one of these is a prompt.
    #[test]
    fn callers_writing_together_produce_one_keychain_write() {
        let writes = Arc::new(AtomicUsize::new(0));
        let key = "one-write:erin";
        std::thread::scope(|scope| {
            for _ in 0..3 {
                let writes = Arc::clone(&writes);
                scope.spawn(move || {
                    write_once(key, "a-token", || {
                        writes.fetch_add(1, Ordering::SeqCst);
                        // Long enough that the others are certainly waiting.
                        std::thread::sleep(Duration::from_millis(50));
                        Ok(())
                    })
                    .unwrap();
                });
            }
        });
        assert_eq!(writes.load(Ordering::SeqCst), 1);
    }

    /// A rotated token is a different value, so it does have to be stored.
    #[test]
    fn a_new_value_is_written() {
        let writes = Arc::new(AtomicUsize::new(0));
        let key = "rotating:frank";
        for token in ["first", "second"] {
            let writes = Arc::clone(&writes);
            write_once(key, token, || {
                writes.fetch_add(1, Ordering::SeqCst);
                Ok(())
            })
            .unwrap();
        }
        assert_eq!(writes.load(Ordering::SeqCst), 2);
        assert!(already_stored(key, "second"));
    }

    /// A secret that is not in the keychain must not be served to the next reader
    /// as though it were.
    #[test]
    fn a_failed_write_is_not_remembered() {
        let writes = Arc::new(AtomicUsize::new(0));
        let key = "write-fails:grace";
        for _ in 0..2 {
            let writes = Arc::clone(&writes);
            let outcome = write_once(key, "a-token", || {
                writes.fetch_add(1, Ordering::SeqCst);
                Err("the keychain was locked".to_owned())
            });
            assert!(outcome.is_err());
        }
        assert_eq!(writes.load(Ordering::SeqCst), 2);
        assert!(!already_stored(key, "a-token"));
    }

    /// Signing out is remembered as "nothing stored", so the next reader is
    /// answered from the cache rather than from the keychain.
    #[test]
    fn a_delete_is_remembered_as_nothing_stored() {
        let key = "signed-out:heidi";
        write_once(key, "a-token", || Ok(())).unwrap();
        delete_once(key, || Ok(())).unwrap();

        let reads = Arc::new(AtomicUsize::new(0));
        let counted = Arc::clone(&reads);
        let answer = read_once(key, move || {
            counted.fetch_add(1, Ordering::SeqCst);
            Ok(Some("a-token".to_owned()))
        });
        assert_eq!(answer.unwrap(), None);
        assert_eq!(reads.load(Ordering::SeqCst), 0);
    }

    /// A delete that failed leaves the secret in the keychain, so the cache has
    /// to keep saying so rather than report a sign-out that did not happen.
    #[test]
    fn a_failed_delete_leaves_the_secret_in_the_cache() {
        let key = "delete-fails:ivan";
        write_once(key, "a-token", || Ok(())).unwrap();
        let outcome = delete_once(key, || Err("the keychain was locked".to_owned()));
        assert!(outcome.is_err());
        assert!(already_stored(key, "a-token"));
    }

    /// Issue #1407: a keychain call made where the command is polled holds that
    /// runtime worker until the OS answers, and the rest of the app's IPC waits
    /// with it. The property is about the thread, not the answer, so this asks
    /// what one poll costs: it has to come back pending while the call is still
    /// going, leaving the worker free for everything else.
    #[test]
    fn a_slow_keychain_call_does_not_hold_the_thread_polling_it() {
        let call = off_the_polling_thread(|| {
            std::thread::sleep(Duration::from_millis(300));
            Ok(Some("a-secret".to_owned()))
        });
        let mut call = Box::pin(call);

        let started = Instant::now();
        assert!(
            polled_once(&mut call).is_pending(),
            "one poll answered, so the keychain call ran on the polling thread"
        );
        let polling_cost = started.elapsed();
        assert!(
            polling_cost < Duration::from_millis(100),
            "one poll held the thread for {polling_cost:?}, so the keychain call is still on it"
        );

        // The answer still arrives, once whoever is waiting for the OS gets it.
        let answer = tauri::async_runtime::block_on(call);
        assert_eq!(answer.unwrap().as_deref(), Some("a-secret"));
        assert!(started.elapsed() >= Duration::from_millis(300));
    }

    /// A caller that gives up does not take the answer with it. `coilbox_oauth`
    /// puts a deadline over these calls, and an OS call in flight cannot be
    /// cancelled, so the read runs on and the next caller is served what it
    /// found rather than asking the OS again.
    #[test]
    fn a_read_its_caller_gave_up_on_still_answers_the_next_caller() {
        let reads = Arc::new(AtomicUsize::new(0));
        let key = "given-up-on:judy";
        let (started, reading) = std::sync::mpsc::channel();

        let counted = Arc::clone(&reads);
        let abandoned = off_the_polling_thread(move || {
            read_once(key, || {
                counted.fetch_add(1, Ordering::SeqCst);
                // Sent from under the account's gate, so the caller below is
                // certainly queued behind this read rather than racing it.
                started.send(()).unwrap();
                std::thread::sleep(Duration::from_millis(100));
                Ok(Some("a-secret".to_owned()))
            })
        });
        let mut abandoned = Box::pin(abandoned);
        assert!(
            polled_once(&mut abandoned).is_pending(),
            "one poll answered, so the read ran on the polling thread and was never abandoned"
        );
        reading.recv().unwrap();
        drop(abandoned);

        let counted = Arc::clone(&reads);
        let answer = read_once(key, move || {
            counted.fetch_add(1, Ordering::SeqCst);
            Ok(Some("a-second-read".to_owned()))
        });
        assert_eq!(answer.unwrap().as_deref(), Some("a-secret"));
        assert_eq!(reads.load(Ordering::SeqCst), 1);
    }

    /// The macOS dev-build route. These are the exact commands `security -i` is
    /// fed, and `-U` is what makes a rewrite replace the item rather than fail.
    #[cfg(all(target_os = "macos", debug_assertions))]
    #[test]
    fn the_security_commands_name_the_service_and_account() {
        use super::{delete_command, store_command};

        assert_eq!(
            store_command("coilbox-hub:https://hub.example", "a-token").unwrap(),
            "add-generic-password -U -s coilbox-lobby -a coilbox-hub:https://hub.example -w a-token"
        );
        assert_eq!(
            delete_command("coilbox-hub:https://hub.example").unwrap(),
            "delete-generic-password -s coilbox-lobby -a coilbox-hub:https://hub.example"
        );
    }

    /// Anything the tool would split, cut short or read as another argument takes
    /// the in-process path instead, because a mangled secret would be stored
    /// without anything saying so.
    #[cfg(all(target_os = "macos", debug_assertions))]
    #[test]
    fn a_value_the_security_tool_would_mangle_takes_the_in_process_path() {
        use super::{delete_command, store_command, LONGEST_SECRET_FOR_SECURITY_TOOL};

        let account = "coilbox-hub:https://hub.example";
        for secret in [
            "",
            "two words",
            "quoted\"token",
            "back\\slash",
            "two\nlines",
            "pound£token",
            &"x".repeat(LONGEST_SECRET_FOR_SECURITY_TOOL + 1),
        ] {
            assert!(
                store_command(account, secret).is_none(),
                "should not have gone to the tool: {secret:?}"
            );
        }
        assert!(store_command(account, &"x".repeat(LONGEST_SECRET_FOR_SECURITY_TOOL)).is_some());

        for bad_account in ["", "a name", "quoted\"name"] {
            assert!(store_command(bad_account, "a-token").is_none());
            assert!(delete_command(bad_account).is_none());
        }
    }

    /// What the tool actually does with those commands, against a service name of
    /// this test's own so it cannot touch a real sign-in.
    ///
    /// Ignored by default because it writes to whoever runs it's login keychain.
    /// Run it by hand on macOS after changing anything above:
    ///
    /// cargo test -p tauri-plugin-coilbox-lobby-servers security_tool -- --ignored --nocapture
    #[cfg(all(target_os = "macos", debug_assertions))]
    #[test]
    #[ignore]
    fn the_security_tool_replaces_and_removes() {
        use super::{read_via_security_tool, run_security_tool, SERVICE};

        let probe = "coilbox-agent-probe:tests";
        let store = |secret: &str| {
            run_security_tool(&format!(
                "add-generic-password -U -s {SERVICE} -a {probe} -w {secret}"
            ))
        };
        let remove =
            || run_security_tool(&format!("delete-generic-password -s {SERVICE} -a {probe}"));

        // Whatever a previous run left behind, if anything.
        let _ = remove();
        assert!(store("first-token"), "a new item is added");
        assert_eq!(
            read_via_security_tool(probe).as_deref(),
            Some("first-token")
        );
        // The case this whole route exists for: rewriting an item that is there.
        assert!(store("second-token"), "an existing item is replaced");
        assert_eq!(
            read_via_security_tool(probe).as_deref(),
            Some("second-token")
        );
        assert!(remove(), "the item is removed");
        assert_eq!(read_via_security_tool(probe), None);
        // A missing item is a failure to the tool, which is why the caller falls
        // through to the in-process delete rather than treating it as done.
        assert!(!remove(), "removing what is not there fails");
    }
}
