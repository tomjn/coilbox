//! Where a sign-in is kept between requests, and between runs.
//!
//! The refresh token goes to the OS keychain, the access token stays in this
//! process, and neither is ever handed back to the frontend.

use std::collections::{HashMap, HashSet};
use std::future::Future;
use std::sync::{Arc, Mutex, OnceLock};
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

/// One lock per account, held across a whole refresh, so callers arriving
/// together collapse into one (issue #1647).
///
/// The access token cache is not enough on its own. It only fills once a refresh
/// has returned, so callers that arrive in the same moment all miss it and all
/// spend the same stored refresh token. Supabase rotates: each of those requests
/// invalidates the token the others are using, only the last answer survives in
/// the keychain, and a refresh token used twice is what a stolen one looks like,
/// so the service may revoke the whole family and sign the user out.
///
/// A tokio lock rather than a std one, because it is held across awaits. Waiting
/// on it parks the task rather than the thread, so a caller queued behind a
/// refresh is not holding a runtime worker while it waits (issue #1407).
static REFRESH_GATES: OnceLock<Mutex<HashMap<String, Arc<tokio::sync::Mutex<()>>>>> =
    OnceLock::new();

fn refresh_gate(key: &str) -> Arc<tokio::sync::Mutex<()>> {
    REFRESH_GATES
        .get_or_init(Default::default)
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .entry(key.to_owned())
        .or_default()
        .clone()
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

/// Where a refresh token is kept between runs.
///
/// There is one of these in the app, the OS keychain. The tests have another,
/// which is the point: a test that reached the real keychain would raise a
/// permission prompt in front of whoever ran it, and counting the writes is how
/// "stored exactly once" gets checked at all.
///
/// The futures are spelled out as `impl Future + Send` rather than left to
/// `async fn`, because the callers are Tauri commands and their futures have to
/// be `Send`.
trait Keychain {
    fn load(
        &self,
        service: &str,
        account: &str,
    ) -> impl Future<Output = Result<Option<String>, AuthError>> + Send;

    fn keep(
        &self,
        service: &str,
        account: &str,
        refresh: &str,
    ) -> impl Future<Output = Result<(), AuthError>> + Send;
}

/// The OS keychain, through the lobby plugin's keyring wrapper.
struct SystemKeychain;

impl Keychain for SystemKeychain {
    async fn load(&self, service: &str, account: &str) -> Result<Option<String>, AuthError> {
        stored_credential(service, account).await
    }

    async fn keep(&self, service: &str, account: &str, refresh: &str) -> Result<(), AuthError> {
        store_credential(service, account, refresh).await
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

/// The access token held for `key`, when there is one with enough life left.
fn held_access(key: &str) -> Option<String> {
    let held = access_tokens().lock().unwrap();
    let tokens = held.get(key)?;
    usable(tokens, Instant::now()).then(|| tokens.access.clone())
}

/// What a caller is told once the service has refused this account's stored
/// token. See [`REFUSED`].
fn refusal(key: &str) -> Option<AuthError> {
    refused()
        .lock()
        .unwrap()
        .contains(key)
        .then(|| AuthError::SignInRefused("it was refused earlier this session".into()))
}

/// An access token good for the next minute at least, refreshed through `refresh`
/// when the one in memory is spent or missing.
///
/// The browser is never opened from here: a stored refresh token is all this
/// needs, and an account that has none is told to sign in rather than sent to the
/// browser behind the user's back. `refresh` is handed the stored refresh token
/// and is where each service puts its own token request.
///
/// One account refreshes once at a time, however many callers ask together. See
/// [`REFRESH_GATES`] for why that matters more than it sounds.
pub async fn access_token<F, Fut>(
    service: &str,
    account: &str,
    refresh: F,
) -> Result<String, AuthError>
where
    F: FnOnce(String) -> Fut,
    Fut: Future<Output = Result<Tokens, AuthError>>,
{
    access_token_from(&SystemKeychain, service, account, refresh).await
}

/// [`access_token`], with where the refresh token is kept as an argument so the
/// tests can stand in for the keychain.
async fn access_token_from<K, F, Fut>(
    keychain: &K,
    service: &str,
    account: &str,
    refresh: F,
) -> Result<String, AuthError>
where
    K: Keychain,
    F: FnOnce(String) -> Fut,
    Fut: Future<Output = Result<Tokens, AuthError>>,
{
    let key = key(service, account);
    if let Some(access) = held_access(&key) {
        return Ok(access);
    }
    if let Some(refusal) = refusal(&key) {
        return Err(refusal);
    }

    let gate = refresh_gate(&key);
    let _held = gate.lock().await;
    // Whoever we queued behind has refreshed by now, and their token is ours. This
    // is the whole point of the gate: a caller that got here second must use the
    // first one's result, not spend the stored token a second time.
    if let Some(access) = held_access(&key) {
        return Ok(access);
    }
    if let Some(refusal) = refusal(&key) {
        return Err(refusal);
    }

    let stored = keychain
        .load(service, account)
        .await?
        .ok_or(AuthError::NotSignedIn)?;
    let tokens = refresh(stored.clone()).await.map_err(|error| {
        // A refused grant is refused for good, so remember it rather than let a
        // retry loop ask again every few seconds until it gives up. Anything else
        // is left alone, so a service that is down for a minute does not read as a
        // sign-in that has to be done again.
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
    let rotated = (tokens.refresh != stored).then(|| tokens.refresh.clone());
    let access = tokens.access.clone();
    // Memory before the keychain, the order [`remember`] uses and for the same
    // reason. The refresh has already happened, so a keychain that will not take
    // the new token must not throw away the one thing this process can still use.
    // Dropping it would leave the next caller reading a stored token the service
    // has already rotated away, which is the failure this whole gate exists to
    // avoid.
    access_tokens().lock().unwrap().insert(key, tokens);
    if let Some(rotated) = rotated {
        keychain.keep(service, account, &rotated).await?;
    }
    Ok(access)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testing::TokenServer;
    use crate::{post_token, TokenBody, TokenRequest};
    use serde_json::json;
    use tokio::sync::Semaphore;

    /// A refresh token in a variable rather than in the OS keychain, so a test
    /// never puts a permission prompt in front of whoever is running it, and so
    /// the writes can be counted.
    #[derive(Clone, Default)]
    struct Kept {
        held: Arc<Mutex<Option<String>>>,
        writes: Arc<Mutex<usize>>,
        /// A keychain that will not answer a write, which on macOS is a prompt
        /// nobody clicked.
        deaf: bool,
    }

    impl Kept {
        fn holding(refresh: &str) -> Self {
            Self {
                held: Arc::new(Mutex::new(Some(refresh.to_owned()))),
                writes: Arc::default(),
                deaf: false,
            }
        }

        fn that_will_not_write(self) -> Self {
            Self { deaf: true, ..self }
        }

        fn held(&self) -> Option<String> {
            self.held.lock().unwrap().clone()
        }

        fn writes(&self) -> usize {
            *self.writes.lock().unwrap()
        }
    }

    impl Keychain for Kept {
        async fn load(&self, _service: &str, _account: &str) -> Result<Option<String>, AuthError> {
            Ok(self.held())
        }

        async fn keep(
            &self,
            _service: &str,
            _account: &str,
            refresh: &str,
        ) -> Result<(), AuthError> {
            *self.writes.lock().unwrap() += 1;
            if self.deaf {
                return Err(AuthError::StorageKeepTimedOut);
            }
            *self.held.lock().unwrap() = Some(refresh.to_owned());
            Ok(())
        }
    }

    /// The refresh grant a service would post, held at `start` until the test
    /// hands out permits.
    ///
    /// Holding it is what makes the count mean something. Without it a refresh
    /// against a loopback server can finish before the other callers have even
    /// looked at the token cache, and a test that only ever had one caller in
    /// flight would pass with no gate at all.
    fn refresh_through(
        endpoint: String,
        start: Arc<Semaphore>,
    ) -> impl FnOnce(String) -> std::pin::Pin<Box<dyn Future<Output = Result<Tokens, AuthError>> + Send>>
    {
        move |stored: String| {
            Box::pin(async move {
                start.acquire().await.unwrap().forget();
                post_token(TokenRequest {
                    endpoint: &endpoint,
                    body: TokenBody::Form(vec![
                        ("grant_type".into(), "refresh_token".into()),
                        ("refresh_token".into(), stored),
                    ]),
                    headers: vec![],
                    previous_refresh: None,
                })
                .await
                .map(|answer| answer.tokens)
            })
        }
    }

    /// Ask for a token from `callers` tasks at once, and answer with what each
    /// one got.
    async fn asked_together(
        callers: usize,
        keychain: &Kept,
        account: &'static str,
        endpoint: String,
    ) -> Vec<Result<String, AuthError>> {
        let start = Arc::new(Semaphore::new(0));
        let asking: Vec<_> = (0..callers)
            .map(|_| {
                let (keychain, start, endpoint) =
                    (keychain.clone(), start.clone(), endpoint.clone());
                tokio::spawn(async move {
                    access_token_from(
                        &keychain,
                        "a-service",
                        account,
                        refresh_through(endpoint, start),
                    )
                    .await
                })
            })
            .collect();
        // Long enough for every caller to have reached either the refresh or the
        // gate. Permits rather than a notification, so a caller that is late to
        // arrive still finds its permit waiting rather than hanging for good.
        tokio::time::sleep(Duration::from_millis(200)).await;
        start.add_permits(callers);
        let mut answers = Vec::new();
        for asked in asking {
            answers.push(asked.await.unwrap());
        }
        answers
    }

    /// Issue #1647. Supabase rotates refresh tokens: every refresh returns a new
    /// one and invalidates the one it was asked with. Callers that arrive together
    /// all miss the token cache, so without a gate they all spend the same stored
    /// token, only the last answer survives in the keychain, and the rest of them
    /// are holding tokens that have been rotated away. A refresh token used twice
    /// is also what a stolen one looks like, and Supabase's answer to that is to
    /// revoke the whole family, which signs the user out.
    #[tokio::test(flavor = "multi_thread")]
    async fn callers_arriving_together_share_one_refresh() {
        let server = TokenServer::answering(json!({
            "access_token": "an-access-token",
            "refresh_token": "the-rotated-one",
            "expires_in": 1800,
        }));
        let kept = Kept::holding("the-stored-one");

        let answers = asked_together(3, &kept, "arriving-together", server.url()).await;

        assert_eq!(answers.len(), 3);
        for answer in answers {
            assert_eq!(answer.unwrap(), "an-access-token");
        }
        assert_eq!(
            server.requests(),
            1,
            "the stored refresh token was spent more than once"
        );
        assert_eq!(
            kept.writes(),
            1,
            "the rotated token was stored more than once"
        );
        assert_eq!(kept.held().as_deref(), Some("the-rotated-one"));
    }

    /// The other half of #1647. A refusal has to reach the callers queued behind
    /// it, or each of them posts the same token the service has just said no to.
    #[tokio::test(flavor = "multi_thread")]
    async fn a_refusal_stops_the_callers_behind_it_asking_again() {
        let server = TokenServer::refusing(json!({
            "error": "invalid_grant",
            "error_description": "the stand-in server said no",
        }));
        let kept = Kept::holding("the-stored-one");

        let answers = asked_together(3, &kept, "refused-together", server.url()).await;

        for answer in answers {
            let error = answer.unwrap_err();
            assert!(matches!(error, AuthError::SignInRefused(_)), "{error:?}");
        }
        assert_eq!(server.requests(), 1);
        // A refusal is not a rotation. Nothing was stored, and what is stored is
        // what was there before: deleting somebody's sign-in on the service's say
        // so is not ours to do.
        assert_eq!(kept.writes(), 0);
        assert_eq!(kept.held().as_deref(), Some("the-stored-one"));

        // And a caller arriving afterwards is answered from the refusal rather
        // than sent to ask again.
        let start = Arc::new(Semaphore::new(1));
        let error = access_token_from(
            &kept,
            "a-service",
            "refused-together",
            refresh_through(server.url(), start),
        )
        .await
        .unwrap_err();
        assert!(matches!(error, AuthError::SignInRefused(_)), "{error:?}");
        assert_eq!(server.requests(), 1);
    }

    /// A refresh that failed for a reason that clears itself must not be
    /// remembered as a refusal, or a service that was down for a minute would
    /// leave the user signed out until they restart.
    #[tokio::test]
    async fn a_service_fault_is_not_remembered_as_a_refusal() {
        let server = TokenServer::faulting();
        let kept = Kept::holding("the-stored-one");
        let ask = || async {
            let start = Arc::new(Semaphore::new(1));
            access_token_from(
                &kept,
                "a-service",
                "a-service-fault",
                refresh_through(server.url(), start),
            )
            .await
        };

        let error = ask().await.unwrap_err();
        assert!(
            matches!(&error, AuthError::Http(m) if m.contains("500")),
            "{error:?}"
        );
        assert_eq!(server.requests(), 1);

        // The next caller tries again rather than being told to sign in, and the
        // failed refresh left nothing cached as if it had worked.
        let error = ask().await.unwrap_err();
        assert!(
            matches!(&error, AuthError::Http(m) if m.contains("500")),
            "{error:?}"
        );
        assert_eq!(server.requests(), 2);
        assert_eq!(kept.writes(), 0);
        assert_eq!(kept.held().as_deref(), Some("the-stored-one"));
    }

    /// A keychain that will not take the rotated token must not cost us the
    /// tokens the refresh has already produced. Throwing them away would leave
    /// the next caller reading a stored token the service has rotated away, and
    /// spending it is the reuse the gate exists to prevent.
    #[tokio::test]
    async fn a_rotated_token_the_keychain_will_not_take_is_still_usable() {
        let server = TokenServer::answering(json!({
            "access_token": "an-access-token",
            "refresh_token": "the-rotated-one",
            "expires_in": 1800,
        }));
        let kept = Kept::holding("the-stored-one").that_will_not_write();
        let ask = || async {
            let start = Arc::new(Semaphore::new(1));
            access_token_from(
                &kept,
                "a-service",
                "a-deaf-keychain",
                refresh_through(server.url(), start),
            )
            .await
        };

        // The next run is in doubt, which is what this error says, and it is the
        // caller's to hear.
        let error = ask().await.unwrap_err();
        assert!(matches!(error, AuthError::StorageKeepTimedOut), "{error:?}");
        assert_eq!(server.requests(), 1);

        // This run is not in doubt. The token that came back is in memory, so the
        // next caller uses it rather than spending the stored one again.
        assert_eq!(ask().await.unwrap(), "an-access-token");
        assert_eq!(server.requests(), 1);
    }

    /// The gate must not become a cache with no expiry. A token with life left is
    /// served from memory, and one inside [`REFRESH_MARGIN`] is replaced before it
    /// is handed to a request that would then fail halfway through.
    #[tokio::test]
    async fn a_token_is_reused_until_it_reaches_the_margin() {
        let long = TokenServer::answering(json!({
            "access_token": "a-long-lived-token",
            "refresh_token": "the-stored-one",
            "expires_in": 1800,
        }));
        let kept = Kept::holding("the-stored-one");
        let ask = |server: &TokenServer, account: &'static str, kept: &Kept| {
            let (endpoint, kept) = (server.url(), kept.clone());
            async move {
                let start = Arc::new(Semaphore::new(1));
                access_token_from(
                    &kept,
                    "a-service",
                    account,
                    refresh_through(endpoint, start),
                )
                .await
            }
        };

        assert_eq!(
            ask(&long, "a-long-life", &kept).await.unwrap(),
            "a-long-lived-token"
        );
        assert_eq!(
            ask(&long, "a-long-life", &kept).await.unwrap(),
            "a-long-lived-token"
        );
        assert_eq!(
            long.requests(),
            1,
            "a token with life left was refreshed anyway"
        );

        // Nothing rotated, so nothing was written. Teiserver's case.
        assert_eq!(kept.writes(), 0);

        let brief = TokenServer::answering(json!({
            "access_token": "a-nearly-spent-token",
            "refresh_token": "the-stored-one",
            "expires_in": 30,
        }));
        ask(&brief, "a-short-life", &kept).await.unwrap();
        ask(&brief, "a-short-life", &kept).await.unwrap();
        assert_eq!(
            brief.requests(),
            2,
            "a token inside the margin was handed out"
        );
    }

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
