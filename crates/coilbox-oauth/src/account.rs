//! Where a sign-in is kept between requests, and between runs.
//!
//! The refresh token goes to the OS keychain, the access token stays in this
//! process, and neither is ever handed back to the frontend.

use std::collections::{HashMap, HashSet};
use std::future::Future;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use crate::{AuthError, Tokens};

/// Refresh an access token this long before it expires, so a token that is about
/// to lapse is not handed to a request that then fails halfway through.
pub const REFRESH_MARGIN: Duration = Duration::from_secs(60);

/// How long a keychain read is given before coilbox stops waiting for it.
///
/// The read has no deadline of its own. On macOS it can raise a permission prompt
/// and answer only once somebody clicks it, which may be never, and a locked
/// keychain does the same. Ten seconds is far longer than a keychain that is
/// going to answer takes, and short enough that the reader is told what happened
/// rather than left in front of a spinner.
pub const KEYCHAIN_TIMEOUT: Duration = Duration::from_secs(10);

/// How the keychain, the access token cache and the refusal set all key an
/// account. The keychain crate builds the same string from the same two parts.
fn key(service: &str, account: &str) -> String {
    format!("{service}:{account}")
}

/// Access tokens held for the life of the process. These are never written to
/// disk. A restart signs back in from the stored refresh token instead.
static ACCESS_TOKENS: OnceLock<Mutex<HashMap<String, Tokens>>> = OnceLock::new();

fn access_tokens() -> &'static Mutex<HashMap<String, Tokens>> {
    ACCESS_TOKENS.get_or_init(Default::default)
}

/// Accounts whose stored refresh token the service has refused.
///
/// The refusal is remembered rather than acted on, because we cannot tell a
/// revoked token from a service that has misread one, and deleting somebody's
/// sign-in on a bad guess is not ours to do. Remembering it is enough: it stops a
/// retry loop asking for a grant that will be refused again, and [`signed_in`]
/// reports the account as needing the browser. A fresh sign-in clears it, and so
/// does a restart.
static REFUSED: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();

fn refused() -> &'static Mutex<HashSet<String>> {
    REFUSED.get_or_init(Default::default)
}

/// Run a keychain read off the calling thread, and stop waiting for it after
/// `deadline`.
///
/// The read cannot stay on the calling thread. It is a blocking OS call inside an
/// async command, so it holds a runtime worker for as long as the OS takes, and a
/// blocking call cannot be timed out at all: a deadline only ever cancels a future
/// that yields, and this one never gets the chance to.
///
/// A read that is given up on is not cancelled, because an OS call in flight
/// cannot be. It runs on, and fills the credential cache on its way out, so a
/// prompt answered late still spares the next caller the wait.
async fn read_within<F>(deadline: Duration, read: F) -> Result<Option<String>, AuthError>
where
    F: FnOnce() -> Result<Option<String>, String> + Send + 'static,
{
    match tokio::time::timeout(deadline, tokio::task::spawn_blocking(read)).await {
        Ok(Ok(Ok(stored))) => Ok(stored),
        Ok(Ok(Err(said))) => Err(AuthError::Storage(said)),
        Ok(Err(joined)) => Err(AuthError::Storage(format!(
            "the keychain read did not finish: {joined}"
        ))),
        Err(_) => Err(AuthError::StorageTimedOut),
    }
}

/// Run a keychain write off the calling thread, and stop waiting for it after
/// `deadline`, answering with `timed_out` when it does (issue #1469).
///
/// Same shape as [`read_within`] and for the same reason: a blocking OS call in
/// an async command cannot be timed out where it is, because a deadline only
/// cancels a future that yields.
///
/// What a deadline means here is not what it means for a read. A read that is
/// given up on has simply not answered. A write that is given up on may still
/// land, because an OS call in flight cannot be cancelled, so what is on disk
/// afterwards is unknown. `timed_out` is the caller's word for that, and neither
/// of the two says the write did or did not happen.
async fn write_within<F>(
    deadline: Duration,
    timed_out: AuthError,
    write: F,
) -> Result<(), AuthError>
where
    F: FnOnce() -> Result<(), String> + Send + 'static,
{
    match tokio::time::timeout(deadline, tokio::task::spawn_blocking(write)).await {
        Ok(Ok(Ok(()))) => Ok(()),
        Ok(Ok(Err(said))) => Err(AuthError::Storage(said)),
        Ok(Err(joined)) => Err(AuthError::Storage(format!(
            "the keychain write did not finish: {joined}"
        ))),
        Err(_) => Err(timed_out),
    }
}

/// Hand the keychain a refresh token to keep, off the calling thread and with
/// [`KEYCHAIN_TIMEOUT`] to answer in.
async fn store_credential(service: &str, account: &str, refresh: &str) -> Result<(), AuthError> {
    let (service, account, refresh) = (service.to_owned(), account.to_owned(), refresh.to_owned());
    write_within(
        KEYCHAIN_TIMEOUT,
        AuthError::StorageKeepTimedOut,
        move || tauri_plugin_coilbox_lobby_servers::store_credential(&service, &account, &refresh),
    )
    .await
}

/// What the keychain holds for an account, read off the calling thread and given
/// [`KEYCHAIN_TIMEOUT`] to answer in.
async fn stored_credential(service: &str, account: &str) -> Result<Option<String>, AuthError> {
    let (service, account) = (service.to_owned(), account.to_owned());
    read_within(KEYCHAIN_TIMEOUT, move || {
        tauri_plugin_coilbox_lobby_servers::get_credential(&service, &account)
    })
    .await
}

/// Whether a request can get a token without opening a browser: something is
/// stored for this account and the service has not refused it.
///
/// A keychain that does not answer is [`AuthError::StorageTimedOut`] rather than
/// `false`, because a prompt nobody has clicked says nothing about whether there
/// is a sign-in behind it, and telling somebody who is signed in that they are not
/// would be a lie.
pub async fn signed_in(service: &str, account: &str) -> Result<bool, AuthError> {
    if refused().lock().unwrap().contains(&key(service, account)) {
        return Ok(false);
    }
    Ok(stored_credential(service, account).await?.is_some())
}

/// Keep the result of a sign-in: the refresh token to the OS keychain, the access
/// token to memory.
///
/// Memory first, keychain second, which is the order the failures want. The
/// sign-in has already happened by the time this is called, so a keychain that
/// will not take it does not undo it: the session works, and only the next run
/// is in doubt. Doing it the other way round threw away a token the user had
/// just spent a browser trip on.
pub async fn remember(service: &str, account: &str, tokens: Tokens) -> Result<(), AuthError> {
    let refresh = tokens.refresh.clone();
    // A refusal is about the token that has just been replaced, so it goes with it.
    refused().lock().unwrap().remove(&key(service, account));
    access_tokens()
        .lock()
        .unwrap()
        .insert(key(service, account), tokens);
    store_credential(service, account, &refresh).await
}

/// Forget an account on this machine: the stored refresh token and any access
/// token in memory.
///
/// This machine is as far as it goes. RFC 7009 revocation is what would tell the
/// service to throw its copy away, and neither service coilbox signs in to
/// advertises a revocation endpoint, so signing out means this machine can no
/// longer use the token, not that it has stopped working.
///
/// The keychain delete is given [`KEYCHAIN_TIMEOUT`] to answer in and runs off
/// the calling thread, so a permission prompt nobody clicks ends the sign-out
/// rather than leaving the button spinning for the rest of the session (issue
/// #1469). A delete that is given up on may still land, so
/// [`AuthError::StorageForgetTimedOut`] says the stored token's fate is unknown
/// rather than claiming either.
pub async fn forget(service: &str, account: &str) -> Result<(), AuthError> {
    access_tokens()
        .lock()
        .unwrap()
        .remove(&key(service, account));
    refused().lock().unwrap().remove(&key(service, account));
    let (service, account) = (service.to_owned(), account.to_owned());
    write_within(
        KEYCHAIN_TIMEOUT,
        AuthError::StorageForgetTimedOut,
        move || tauri_plugin_coilbox_lobby_servers::delete_credential(&service, &account),
    )
    .await
}

/// Whether an access token has enough life left to make a request with.
///
/// [`REFRESH_MARGIN`] is the gap, so a token that is about to lapse is refreshed
/// rather than handed to a request that then fails.
fn usable(tokens: &Tokens, now: Instant) -> bool {
    tokens.expires_at > now + REFRESH_MARGIN
}

/// An access token good for the next minute at least, refreshed through `refresh`
/// when the one in memory is spent or missing.
///
/// The browser is never opened from here: a stored refresh token is all this
/// needs, and an account that has none is told to sign in rather than sent to the
/// browser behind the user's back. `refresh` is handed the stored refresh token
/// and is where each service puts its own token request.
pub async fn access_token<F, Fut>(
    service: &str,
    account: &str,
    refresh: F,
) -> Result<String, AuthError>
where
    F: FnOnce(String) -> Fut,
    Fut: Future<Output = Result<Tokens, AuthError>>,
{
    let key = key(service, account);
    if let Some(tokens) = access_tokens().lock().unwrap().get(&key) {
        if usable(tokens, Instant::now()) {
            return Ok(tokens.access.clone());
        }
    }
    if refused().lock().unwrap().contains(&key) {
        return Err(AuthError::SignInRefused(
            "it was refused earlier this session".into(),
        ));
    }
    let stored = stored_credential(service, account)
        .await?
        .ok_or(AuthError::NotSignedIn)?;
    let tokens = refresh(stored.clone()).await.map_err(|error| {
        // A refused grant is refused for good, so remember it rather than let a
        // retry loop ask again every few seconds until it gives up.
        if error.needs_sign_in() {
            refused().lock().unwrap().insert(key.clone());
            return AuthError::SignInRefused(error.to_string());
        }
        error
    })?;
    // Teiserver's refresh tokens do not rotate, Supabase's do. A service that
    // rotates them would otherwise leave us holding a dead one. Same deadline as
    // every other keychain call, so a prompt nobody clicks cannot hold up the
    // request this token was fetched for (issue #1469).
    if tokens.refresh != stored {
        store_credential(service, account, &tokens.refresh).await?;
    }
    let access = tokens.access.clone();
    access_tokens().lock().unwrap().insert(key, tokens);
    Ok(access)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Issue #1456: a keychain read that never answers used to leave the command
    /// pending for good, and a person looking at a spinner with no way out. On
    /// macOS that is a permission prompt behind the window, and a locked keychain
    /// reaches the same place. The only way to prove the deadline fires is a read
    /// that never answers on its own.
    #[tokio::test]
    async fn a_keychain_that_never_answers_is_given_up_on() {
        let (answer, waiting) = std::sync::mpsc::channel::<()>();
        let started = Instant::now();
        let error = read_within(Duration::from_millis(50), move || {
            // Returns when the test drops its end, which is as close as a test
            // gets to a prompt nobody has clicked.
            let _ = waiting.recv();
            Ok(None)
        })
        .await
        .unwrap_err();
        assert!(matches!(error, AuthError::StorageTimedOut), "{error:?}");
        assert!(
            started.elapsed() < Duration::from_secs(1),
            "waited {:?}",
            started.elapsed()
        );
        // Lets the abandoned read finish, the way the OS eventually answers.
        drop(answer);
    }

    /// Issue #1469: the other half of #1456. Signing out writes, and a write
    /// blocks on the same prompt a read does, so the Sign out button could spin
    /// for good.
    #[tokio::test]
    async fn a_keychain_write_that_never_answers_is_given_up_on() {
        let (answer, waiting) = std::sync::mpsc::channel::<()>();
        let started = Instant::now();
        let error = write_within(
            Duration::from_millis(50),
            AuthError::StorageForgetTimedOut,
            move || {
                let _ = waiting.recv();
                Ok(())
            },
        )
        .await
        .unwrap_err();
        assert!(
            matches!(error, AuthError::StorageForgetTimedOut),
            "{error:?}"
        );
        assert!(
            started.elapsed() < Duration::from_secs(1),
            "waited {:?}",
            started.elapsed()
        );
        drop(answer);
    }

    /// The words the two writes end on. Neither may claim the write happened or
    /// that it did not, because a write given up on is not cancelled and may yet
    /// land.
    #[test]
    fn a_write_given_up_on_claims_nothing_about_what_is_stored() {
        let kept = AuthError::StorageKeepTimedOut.to_string();
        assert!(kept.contains("signed in for this session"), "{kept}");
        assert!(kept.contains("may not have been kept"), "{kept}");
        let forgotten = AuthError::StorageForgetTimedOut.to_string();
        assert!(forgotten.contains("is not known"), "{forgotten}");
        assert!(!forgotten.contains("signed out"), "{forgotten}");
    }

    #[tokio::test]
    async fn a_keychain_that_answers_in_time_is_read_as_it_answered() {
        let read = read_within(Duration::from_secs(30), || Ok(Some("a-token".into())))
            .await
            .unwrap();
        assert_eq!(read.as_deref(), Some("a-token"));
        let refused = read_within(Duration::from_secs(30), || Err("locked".into()))
            .await
            .unwrap_err();
        assert!(
            matches!(&refused, AuthError::Storage(m) if m == "locked"),
            "{refused:?}"
        );
    }

    /// The only deadline that matters for a token that is about to be used.
    #[test]
    fn a_token_inside_the_margin_is_refreshed_rather_than_used() {
        let now = Instant::now();
        let token = |life: Duration| Tokens {
            access: "an-access-token".into(),
            refresh: "a-refresh-token".into(),
            expires_at: now + life,
        };
        // What a fresh Teiserver access token looks like.
        assert!(usable(&token(Duration::from_secs(1800)), now));
        assert!(usable(&token(REFRESH_MARGIN * 2), now));
        // Still valid, but not for long enough to make a request with.
        assert!(!usable(&token(REFRESH_MARGIN / 2), now));
        assert!(!usable(&token(Duration::ZERO), now));
    }

    #[test]
    fn an_account_is_keyed_the_way_the_keychain_keys_it() {
        assert_eq!(
            key("coilbox-hub", "https://example.test"),
            "coilbox-hub:https://example.test"
        );
    }
}
