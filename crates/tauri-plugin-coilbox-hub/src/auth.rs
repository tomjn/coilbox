//! Signing in to the Coilbox hub with Discord.
//!
//! The flow itself is `coilbox-oauth`, the same one the lobby uses. What is here is
//! the part that is the hub's own.
//!
//! The hub does not run its own accounts. It hands them to a Supabase project,
//! which hands them to Discord, so coilbox has to be told which project before it
//! can start. `GET <hub>/api/v1/auth` is that answer, and it is the only thing
//! about the account service this build knows. There is deliberately no built-in
//! fallback: a hub whose `/api/v1/auth` does not answer cannot be signed in to, and
//! says so, rather than quietly signing the user in to somebody else's project.
//!
//! No token leaves this process. The refresh token goes to the OS keychain and the
//! access token stays in memory, exactly as the lobby's does. The frontend learns
//! whether it is signed in and as whom, and nothing else, because a token in
//! frontend JavaScript is a token any script injected into the webview can read.

use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};

use coilbox_oauth::{
    post_token, AuthError, AuthRequest, TokenBody, TokenRequest, TokenResponse, HTTP_TIMEOUT,
};
use serde::Serialize;
use serde_json::{json, Value};
use url::Url;

/// The hub route that says which account service to use. The one address here that
/// is not read from somewhere else, and it hangs off the configured hub base rather
/// than off any address of its own.
const DISCOVERY_PATH: &str = "/api/v1/auth";

/// The envelope that route answers with, from `app/api/v1/auth` in tomjn/coilbox-hub.
const AUTH_FORMAT: &str = "coilbox-hub-auth";

/// The version of that route this build was written against. A higher one is
/// refused, because a shipped desktop build sits on disk for months and guessing at
/// a newer service is worse than saying so.
const AUTH_VERSION: u64 = 1;

/// The only provider the hub offers.
const PROVIDER: &str = "discord";

/// The keychain's service name for a hub account.
///
/// A synthetic name in the vault the lobby already uses, rather than a vault of its
/// own. The keychain crate is a `{service, account}` pair over `keyring` and has
/// nothing lobby-specific in it beyond its name, and its name reaches into the ACL
/// identifier, the capability files and the frontend's invoke strings. Renaming it
/// would touch all three to store one more entry.
const SERVICE: &str = "coilbox-hub";

/// Which Supabase project a hub signs its users in through.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct HubAuth {
    supabase_url: String,
    /// The project's publishable key. Public by design: it identifies the project
    /// on every request and grants nothing on its own.
    publishable_key: String,
}

impl HubAuth {
    /// The headers Supabase wants on a token request, the pair supabase-js sends.
    fn headers(&self) -> Vec<(&'static str, String)> {
        vec![
            ("apikey", self.publishable_key.clone()),
            ("authorization", format!("Bearer {}", self.publishable_key)),
        ]
    }

    fn token_endpoint(&self, grant_type: &str) -> String {
        format!(
            "{}/auth/v1/token?grant_type={grant_type}",
            self.supabase_url
        )
    }
}

/// Who is signed in. No token, and nothing the frontend cannot already see on the
/// hub's own pages.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Identity {
    pub id: String,
    pub name: String,
    pub avatar_url: Option<String>,
}

// ---------------------------------------------------------------- discovery

/// The hub base with any trailing slashes taken off, which is both the keychain
/// account name and the base every hub address is built from. Two settings that
/// differ only by a trailing slash are the same hub, and should not be two
/// sign-ins.
fn account_key(hub_url: &str) -> String {
    hub_url.trim_end_matches('/').to_owned()
}

/// The host of a URL, for a message, or the URL itself if it will not parse.
fn host_of(url: &str) -> String {
    Url::parse(url)
        .ok()
        .and_then(|u| u.host_str().map(str::to_owned))
        .unwrap_or_else(|| url.to_owned())
}

/// Read what `/api/v1/auth` answered. Split out from the request so every refusal
/// can be tested without a server, the way `src/hub/api.ts` reads its two routes.
fn read_auth_document(hub_url: &str, status: u16, body: &str) -> Result<HubAuth, AuthError> {
    let host = host_of(hub_url);
    if status == 404 {
        return Err(AuthError::Discovery(format!(
            "The hub at {host} does not offer signing in."
        )));
    }
    if !(200..300).contains(&status) {
        return Err(AuthError::Discovery(format!(
            "The hub at {host} could not say how to sign in (HTTP {status})."
        )));
    }
    let not_a_hub = || {
        AuthError::Discovery(
            "That address answered, but it is not a coilbox hub. Check the hub address in Settings."
                .into(),
        )
    };
    let doc: Value = serde_json::from_str(body).map_err(|_| not_a_hub())?;
    if doc.get("format").and_then(Value::as_str) != Some(AUTH_FORMAT) {
        return Err(not_a_hub());
    }
    match doc.get("version").and_then(Value::as_u64) {
        Some(version) if version <= AUTH_VERSION => {}
        Some(_) => {
            return Err(AuthError::Discovery(
                "This hub is newer than this copy of coilbox understands. Update coilbox to sign in to it."
                    .into(),
            ))
        }
        None => return Err(not_a_hub()),
    }

    let field = |name: &str| {
        doc.get(name)
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_owned)
    };
    let supabase_url = field("supabase_url").ok_or_else(|| {
        AuthError::Discovery(format!(
            "The hub at {host} did not say which account service to sign in through."
        ))
    })?;
    // The address the browser is about to be sent to, so it has to be one a browser
    // can follow. Which project it names is the hub's to decide, and trusting the
    // hub with that is the same trust as pointing coilbox at it in the first place.
    let scheme = Url::parse(&supabase_url)
        .map(|u| u.scheme().to_owned())
        .unwrap_or_default();
    if scheme != "https" && scheme != "http" {
        return Err(AuthError::Discovery(format!(
            "The hub at {host} named an account service coilbox cannot open."
        )));
    }
    let publishable_key = field("publishable_key").ok_or_else(|| {
        AuthError::Discovery(format!(
            "The hub at {host} named an account service but no key to reach it with."
        ))
    })?;
    Ok(HubAuth {
        supabase_url: supabase_url.trim_end_matches('/').to_owned(),
        publishable_key,
    })
}

/// Ask the hub which Supabase project to sign in through.
///
/// Not cached. It is one small request per sign-in or refresh, and caching it would
/// mean a hub that has moved its project stays wrong until the app restarts.
pub async fn discover(hub_url: &str) -> Result<HubAuth, AuthError> {
    let url = format!("{}{DISCOVERY_PATH}", account_key(hub_url));
    let client = reqwest::Client::builder()
        .timeout(HTTP_TIMEOUT)
        .build()
        .map_err(|e| AuthError::Http(e.to_string()))?;
    let resp = client
        .get(&url)
        .header(reqwest::header::ACCEPT, "application/json")
        .send()
        .await
        .map_err(|e| AuthError::Http(e.to_string()))?;
    let status = resp.status().as_u16();
    let body = resp
        .text()
        .await
        .map_err(|e| AuthError::Http(e.to_string()))?;
    read_auth_document(hub_url, status, &body)
}

// ----------------------------------------------------------------- identity

/// Who each hub account belongs to, for the life of the process. Learned from the
/// token answer, which carries the user beside the tokens, so knowing who you are
/// costs no extra request.
static IDENTITIES: OnceLock<Mutex<HashMap<String, Identity>>> = OnceLock::new();

fn identities() -> &'static Mutex<HashMap<String, Identity>> {
    IDENTITIES.get_or_init(Default::default)
}

/// The user Supabase returned beside the tokens, if it returned one.
///
/// Discord fills `user_metadata` differently depending on what the account has set,
/// so the name is the first of the fields it might land in. The email is the last
/// resort and the least welcome to show, which is why it is last.
fn identity_from(extra: &Value) -> Option<Identity> {
    let user = extra.get("user")?;
    let id = user.get("id").and_then(Value::as_str)?.to_owned();
    let metadata = user.get("user_metadata");
    let named = |name: &str| {
        metadata
            .and_then(|m| m.get(name))
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_owned)
    };
    let name = named("full_name")
        .or_else(|| named("name"))
        .or_else(|| named("user_name"))
        .or_else(|| named("preferred_username"))
        .or_else(|| {
            user.get("email")
                .and_then(Value::as_str)
                .filter(|s| !s.is_empty())
                .map(str::to_owned)
        })
        .unwrap_or_else(|| "Your Discord account".to_owned());
    Some(Identity {
        id,
        name,
        avatar_url: named("avatar_url"),
    })
}

/// Keep whoever the last token answer named.
fn remember_identity(account: &str, answer: &TokenResponse) -> Option<Identity> {
    let identity = identity_from(&answer.extra)?;
    identities()
        .lock()
        .unwrap()
        .insert(account.to_owned(), identity.clone());
    Some(identity)
}

/// Who is signed in to this hub, as far as this process already knows, without
/// asking anybody.
pub fn cached_identity(hub_url: &str) -> Option<Identity> {
    identities()
        .lock()
        .unwrap()
        .get(&account_key(hub_url))
        .cloned()
}

// ----------------------------------------------------------------- the flow

/// Build the Supabase authorization URL the browser is sent to.
///
/// `redirect_to` carries the `state` rather than a parameter of its own, because
/// Supabase runs its own handshake with Discord and its own `state` with it, and
/// hands back only what it was given to redirect to. Supabase preserves the query
/// on that address and appends `code`, so the value comes back with the callback.
fn authorize_url(config: &HubAuth, request: &AuthRequest) -> Result<Url, AuthError> {
    let mut redirect_to = Url::parse(&request.redirect_uri)
        .map_err(|e| AuthError::Listener(format!("loopback address is not a URL: {e}")))?;
    redirect_to
        .query_pairs_mut()
        .append_pair("state", &request.state);

    let mut url =
        Url::parse(&format!("{}/auth/v1/authorize", config.supabase_url)).map_err(|e| {
            AuthError::Discovery(format!(
                "the hub named an account service that is not a URL: {e}"
            ))
        })?;
    url.query_pairs_mut()
        .append_pair("provider", PROVIDER)
        .append_pair("code_challenge_method", "s256")
        .append_pair("code_challenge", &request.challenge)
        .append_pair("redirect_to", redirect_to.as_str());
    Ok(url)
}

/// The browser handoff and the PKCE grant that follows it.
///
/// Split from [`sign_in`] so the whole round trip can be tested against a stand-in
/// Supabase without a test writing to the real OS keychain.
async fn authorize_and_exchange<F>(
    config: &HubAuth,
    open_browser: F,
) -> Result<TokenResponse, AuthError>
where
    F: FnOnce(&str) -> Result<(), String>,
{
    let authorization = coilbox_oauth::authorize(
        &config.supabase_url,
        |request| authorize_url(config, request),
        open_browser,
    )
    .await?;
    let endpoint = config.token_endpoint("pkce");
    post_token(TokenRequest {
        endpoint: &endpoint,
        body: TokenBody::Json(json!({
            "auth_code": authorization.code,
            "code_verifier": authorization.verifier,
        })),
        headers: config.headers(),
        previous_refresh: None,
    })
    .await
}

/// Sign in through the browser and keep the result. Returns who signed in, and
/// nothing else.
pub async fn sign_in<F>(hub_url: &str, open_browser: F) -> Result<Identity, AuthError>
where
    F: FnOnce(&str) -> Result<(), String>,
{
    let config = discover(hub_url).await?;
    let answer = authorize_and_exchange(&config, open_browser).await?;
    let account = account_key(hub_url);
    let identity = remember_identity(&account, &answer).ok_or_else(|| AuthError::Token {
        error: "invalid_response".into(),
        description: Some("no user".into()),
    })?;
    coilbox_oauth::remember(SERVICE, &account, answer.tokens)?;
    Ok(identity)
}

/// Forget this machine's sign-in to a hub.
///
/// Supabase has no revocation endpoint coilbox can reach with a publishable key, so
/// this is as far as it goes: the token is gone from here, not from the project.
pub fn sign_out(hub_url: &str) -> Result<(), AuthError> {
    let account = account_key(hub_url);
    identities().lock().unwrap().remove(&account);
    coilbox_oauth::forget(SERVICE, &account)
}

/// Whether there is a stored sign-in for this hub that has not been refused.
pub fn signed_in(hub_url: &str) -> Result<bool, AuthError> {
    coilbox_oauth::signed_in(SERVICE, &account_key(hub_url))
}

/// An access token for the hub, good for the next minute at least.
///
/// This is what anything that publishes to the hub asks for. It refreshes from the
/// stored refresh token when the one in memory is spent, and never opens a browser:
/// an account with nothing stored gets [`AuthError::NotSignedIn`] rather than a
/// window appearing behind the user's back.
pub async fn access_token(hub_url: &str) -> Result<String, AuthError> {
    let account = account_key(hub_url);
    let hub = hub_url.to_owned();
    let cache_under = account.clone();
    coilbox_oauth::access_token(SERVICE, &account, move |stored| async move {
        let config = discover(&hub).await?;
        let endpoint = config.token_endpoint("refresh_token");
        let answer = post_token(TokenRequest {
            endpoint: &endpoint,
            body: TokenBody::Json(json!({ "refresh_token": stored })),
            headers: config.headers(),
            previous_refresh: Some(&stored),
        })
        .await?;
        remember_identity(&cache_under, &answer);
        Ok(answer.tokens)
    })
    .await
}

/// Turn a failure into a sentence meant to be shown to the reader as-is.
///
/// [`AuthError`]'s own `Display` talks about "the server", which is the lobby's
/// word. The hub is a hub, and half of these are worth naming its address in.
pub fn explain(error: &AuthError, hub_url: &str) -> String {
    let host = host_of(hub_url);
    match error {
        // Already written as a sentence, by `read_auth_document`.
        AuthError::Discovery(said) => said.clone(),
        AuthError::Http(_) => format!(
            "Could not reach the hub at {host}. Check your connection, and give it a moment if it is waking up after a quiet spell."
        ),
        AuthError::Listener(said) => format!("Coilbox could not listen for your browser: {said}"),
        AuthError::Browser(said) => format!("Coilbox could not open your browser: {said}"),
        AuthError::TimedOut => {
            "The sign-in was not finished in time. Try again, and complete it in the browser window that opens.".into()
        }
        AuthError::Denied { .. } => {
            "The sign-in was not completed. Try again if you meant to sign in.".into()
        }
        AuthError::StateMismatch => {
            "That sign-in was not the one coilbox started, so it was refused. Try again.".into()
        }
        AuthError::BadCallback(_) => {
            "Your browser came back without a sign-in. Try again.".into()
        }
        AuthError::Token { error, .. } => {
            format!("The hub's account service refused the sign-in ({error}).")
        }
        AuthError::Storage(said) => {
            format!("Coilbox could not use the system keychain, so your sign-in cannot be kept: {said}")
        }
        AuthError::NotSignedIn => format!("You are not signed in to the hub at {host}."),
        AuthError::SignInRefused(_) => {
            "Your saved sign-in is no longer valid. Sign in again.".into()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{AsyncReadExt as _, AsyncWriteExt as _};

    fn document(body: &str) -> Result<HubAuth, AuthError> {
        read_auth_document("https://hub.example", 200, body)
    }

    fn good_document() -> String {
        json!({
            "format": "coilbox-hub-auth",
            "version": 1,
            "supabase_url": "https://project.supabase.co",
            "publishable_key": "sb_publishable_abc",
        })
        .to_string()
    }

    // ------------------------------------------------------------- discovery

    #[test]
    fn discovery_reads_the_project_and_its_key() {
        let config = document(&good_document()).unwrap();
        assert_eq!(config.supabase_url, "https://project.supabase.co");
        assert_eq!(config.publishable_key, "sb_publishable_abc");
    }

    /// A hub with no sign-in at all is the ordinary case, not a fault, and there is
    /// no built-in project to fall back to.
    #[test]
    fn a_hub_with_no_auth_route_says_so_plainly() {
        let err = read_auth_document("https://hub.example", 404, "").unwrap_err();
        assert!(
            matches!(&err, AuthError::Discovery(m) if m.contains("does not offer signing in")),
            "{err:?}"
        );
    }

    #[test]
    fn an_address_that_is_not_a_hub_is_named_as_such() {
        for body in ["<html>hello</html>", "{}", r#"{"format":"something-else"}"#] {
            let err = document(body).unwrap_err();
            assert!(
                matches!(&err, AuthError::Discovery(m) if m.contains("not a coilbox hub")),
                "{body}: {err:?}"
            );
        }
    }

    #[test]
    fn a_newer_hub_is_named_as_newer_rather_than_read_anyway() {
        let body = json!({
            "format": "coilbox-hub-auth",
            "version": 2,
            "supabase_url": "https://project.supabase.co",
            "publishable_key": "sb_publishable_abc",
        })
        .to_string();
        let err = document(&body).unwrap_err();
        assert!(
            matches!(&err, AuthError::Discovery(m) if m.contains("newer than this copy")),
            "{err:?}"
        );
    }

    #[test]
    fn a_document_missing_either_half_is_refused() {
        let without = |name: &str| {
            let mut doc: Value = serde_json::from_str(&good_document()).unwrap();
            doc.as_object_mut().unwrap().remove(name);
            document(&doc.to_string()).unwrap_err()
        };
        assert!(matches!(without("supabase_url"), AuthError::Discovery(_)));
        assert!(matches!(
            without("publishable_key"),
            AuthError::Discovery(_)
        ));
    }

    /// The address goes straight to the system browser, so a scheme a browser
    /// should not be handed is refused before it gets there.
    #[test]
    fn an_account_service_a_browser_cannot_open_is_refused() {
        let body = json!({
            "format": "coilbox-hub-auth",
            "version": 1,
            "supabase_url": "javascript:alert(1)",
            "publishable_key": "sb_publishable_abc",
        })
        .to_string();
        let err = document(&body).unwrap_err();
        assert!(
            matches!(&err, AuthError::Discovery(m) if m.contains("cannot open")),
            "{err:?}"
        );
    }

    // ----------------------------------------------------------- authorize URL

    #[test]
    fn the_authorization_url_asks_supabase_for_discord_and_carries_the_state_home() {
        let config = document(&good_document()).unwrap();
        let request = AuthRequest {
            challenge: "a-challenge".into(),
            state: "a-state".into(),
            redirect_uri: "http://127.0.0.1:41234/oauth2callback".into(),
        };
        let url = authorize_url(&config, &request).unwrap();
        assert_eq!(
            url.origin().ascii_serialization(),
            "https://project.supabase.co"
        );
        assert_eq!(url.path(), "/auth/v1/authorize");
        let query: HashMap<String, String> = url.query_pairs().into_owned().collect();
        assert_eq!(query["provider"], "discord");
        assert_eq!(query["code_challenge_method"], "s256");
        assert_eq!(query["code_challenge"], "a-challenge");
        // Supabase keeps the query on the address it redirects to and appends the
        // code, so this is how the state comes back.
        assert_eq!(
            query["redirect_to"],
            "http://127.0.0.1:41234/oauth2callback?state=a-state"
        );
    }

    // --------------------------------------------------------------- identity

    #[test]
    fn the_signed_in_user_is_read_out_of_the_token_answer() {
        let identity = identity_from(&json!({
            "user": {
                "id": "a-user-id",
                "email": "someone@example.test",
                "user_metadata": {
                    "full_name": "Tom",
                    "avatar_url": "https://cdn.discordapp.com/avatars/1/2.png",
                },
            },
        }))
        .unwrap();
        assert_eq!(identity.id, "a-user-id");
        assert_eq!(identity.name, "Tom");
        assert_eq!(
            identity.avatar_url.as_deref(),
            Some("https://cdn.discordapp.com/avatars/1/2.png")
        );
    }

    /// Discord fills these differently depending on what the account has set, and
    /// an account with none of them still has to be called something.
    #[test]
    fn a_name_is_found_wherever_discord_put_it() {
        let named = |metadata: Value, email: Value| {
            identity_from(&json!({
                "user": { "id": "a-user-id", "email": email, "user_metadata": metadata },
            }))
            .unwrap()
            .name
        };
        assert_eq!(named(json!({ "name": "Tom" }), Value::Null), "Tom");
        assert_eq!(named(json!({ "user_name": "tomjn" }), Value::Null), "tomjn");
        assert_eq!(
            named(json!({ "preferred_username": "tomjn" }), Value::Null),
            "tomjn"
        );
        assert_eq!(
            named(json!({}), json!("someone@example.test")),
            "someone@example.test"
        );
        assert_eq!(named(json!({}), Value::Null), "Your Discord account");
    }

    #[test]
    fn an_answer_with_no_user_names_nobody() {
        assert!(identity_from(&json!({ "token_type": "bearer" })).is_none());
        assert!(identity_from(&json!({ "user": { "email": "no-id@example.test" } })).is_none());
    }

    // ------------------------------------------------------------------ other

    #[test]
    fn a_trailing_slash_is_not_a_different_hub() {
        assert_eq!(
            account_key("https://hub.example/"),
            account_key("https://hub.example")
        );
    }

    /// Every failure the reader can see has to read as a sentence, because these go
    /// straight onto the screen.
    #[test]
    fn every_failure_is_explained_in_words() {
        let hub = "https://hub.example";
        let cases = [
            AuthError::Http("connection refused".into()),
            AuthError::TimedOut,
            AuthError::Denied {
                error: "access_denied".into(),
                description: None,
            },
            AuthError::StateMismatch,
            AuthError::BadCallback("no code".into()),
            AuthError::Token {
                error: "invalid_grant".into(),
                description: None,
            },
            AuthError::NotSignedIn,
            AuthError::SignInRefused("revoked".into()),
            AuthError::Storage("locked".into()),
            AuthError::Listener("port in use".into()),
            AuthError::Browser("no handler".into()),
        ];
        for error in cases {
            let said = explain(&error, hub);
            assert!(
                said.chars().next().is_some_and(char::is_uppercase),
                "{error:?} -> {said}"
            );
            // The lobby's word for the other end, which would read as nonsense here.
            assert!(!said.contains("the server"), "{error:?} -> {said}");
        }
        assert!(explain(&AuthError::Http("x".into()), hub).contains("hub.example"));
    }

    // ------------------------------------------------------- the whole round trip

    /// A stand-in that is both the hub and its Supabase project: it serves
    /// `/api/v1/auth` naming itself, and the PKCE grant at
    /// `/auth/v1/token`. Returns its base URL and what the token endpoint saw.
    async fn stand_in_hub() -> (String, std::sync::Arc<Mutex<Vec<(String, String)>>>) {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base = format!("http://127.0.0.1:{}", listener.local_addr().unwrap().port());
        let seen = std::sync::Arc::new(Mutex::new(Vec::new()));
        let recorded = seen.clone();
        let served = base.clone();
        tokio::spawn(async move {
            while let Ok((mut sock, _)) = listener.accept().await {
                let recorded = recorded.clone();
                let base = served.clone();
                tokio::spawn(async move {
                    let mut buf = Vec::new();
                    let mut chunk = [0u8; 1024];
                    let head_end = loop {
                        match sock.read(&mut chunk).await {
                            Ok(0) | Err(_) => return,
                            Ok(n) => buf.extend_from_slice(&chunk[..n]),
                        }
                        if let Some(p) = buf.windows(4).position(|w| w == b"\r\n\r\n") {
                            break p + 4;
                        }
                    };
                    let head = String::from_utf8_lossy(&buf[..head_end]).into_owned();
                    let target = head.split_whitespace().nth(1).unwrap_or("/").to_owned();
                    let len: usize = head
                        .to_ascii_lowercase()
                        .lines()
                        .find_map(|l| {
                            l.strip_prefix("content-length:")
                                .map(|v| v.trim().to_owned())
                        })
                        .and_then(|v| v.parse().ok())
                        .unwrap_or(0);
                    while buf.len() < head_end + len {
                        match sock.read(&mut chunk).await {
                            Ok(0) | Err(_) => break,
                            Ok(n) => buf.extend_from_slice(&chunk[..n]),
                        }
                    }
                    let body = String::from_utf8_lossy(&buf[head_end..]).into_owned();

                    let answer = if target.starts_with(DISCOVERY_PATH) {
                        json!({
                            "format": AUTH_FORMAT,
                            "version": 1,
                            "supabase_url": base,
                            "publishable_key": "sb_publishable_abc",
                        })
                    } else {
                        recorded
                            .lock()
                            .unwrap()
                            .push((head.to_ascii_lowercase(), body));
                        json!({
                            "access_token": "an-access-token",
                            "refresh_token": "a-refresh-token",
                            "expires_in": 3600,
                            "user": {
                                "id": "a-user-id",
                                "user_metadata": { "full_name": "Tom" },
                            },
                        })
                    };
                    let answer = answer.to_string();
                    let response = format!(
                        "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{answer}",
                        answer.len()
                    );
                    let _ = sock.write_all(response.as_bytes()).await;
                    let _ = sock.flush().await;
                });
            }
        });
        (base, seen)
    }

    /// The one test that walks the whole thing: ask the hub which project to use,
    /// send the browser there, take the callback, and trade the code for tokens.
    /// It stops short of the keychain, which is the shared crate's and would write
    /// to the real one.
    #[tokio::test]
    async fn a_sign_in_goes_from_the_hub_s_answer_to_a_named_user() {
        let (base, seen) = stand_in_hub().await;
        let config = discover(&base).await.unwrap();
        let answer = authorize_and_exchange(&config, |url| {
            // The browser's part: follow the redirect back to the loopback with a
            // code, the way Supabase does once Discord is done.
            let parsed = Url::parse(url).unwrap();
            let query: HashMap<String, String> = parsed.query_pairs().into_owned().collect();
            let target = format!("{}&code=an-authorization-code", query["redirect_to"]);
            tokio::spawn(async move {
                let _ = reqwest::get(&target).await;
            });
            Ok(())
        })
        .await
        .unwrap();

        assert_eq!(identity_from(&answer.extra).unwrap().name, "Tom");
        let requests = seen.lock().unwrap();
        let (head, body) = requests.first().expect("the token endpoint was not called");
        assert!(head.contains("grant_type=pkce"), "{head}");
        assert!(head.contains("apikey: sb_publishable_abc"), "{head}");
        assert!(head.contains("content-type: application/json"), "{head}");
        let sent: Value = serde_json::from_str(body).unwrap();
        assert_eq!(sent["auth_code"], "an-authorization-code");
        assert_eq!(sent["code_verifier"].as_str().unwrap().len(), 43);
    }

    // ------------------------------------------------------------------- live

    /// Read the real hub's discovery route. It needs no account and opens nothing,
    /// but it does need the internet, so it is ignored rather than run in CI.
    ///
    /// ```text
    /// cargo test -p tauri-plugin-coilbox-hub live_discovery -- --ignored --nocapture
    /// ```
    #[tokio::test]
    #[ignore = "reaches the live hub, so it cannot run in CI"]
    async fn live_discovery() {
        let config = discover("https://coilbox-hub.vercel.app")
            .await
            .expect("discovery failed");
        println!("account service: {}", config.supabase_url);
        println!("key length: {}", config.publishable_key.len());
        assert!(config.supabase_url.starts_with("https://"));
    }

    /// The one test that needs a real Discord account. It opens your browser, waits
    /// for you to sign in, and prints who came back. Nothing is stored and no token
    /// is printed.
    ///
    /// ```text
    /// cargo test -p tauri-plugin-coilbox-hub live_sign_in -- --ignored --nocapture
    /// ```
    #[tokio::test]
    #[ignore = "opens a browser and needs a real account, so it cannot run in CI"]
    async fn live_sign_in() {
        let config = discover("https://coilbox-hub.vercel.app")
            .await
            .expect("discovery failed");
        println!("opening your browser, sign in there within a minute");
        let answer = authorize_and_exchange(&config, |url| {
            tauri_plugin_opener::open_url(url, None::<&str>).map_err(|e| e.to_string())
        })
        .await
        .expect("sign-in failed");
        let identity = identity_from(&answer.extra).expect("no user came back");
        println!("signed in as {} ({})", identity.name, identity.id);
        println!(
            "the access token is {} characters, valid for {:?}",
            answer.tokens.access.len(),
            answer
                .tokens
                .expires_at
                .saturating_duration_since(std::time::Instant::now())
        );
    }
}
