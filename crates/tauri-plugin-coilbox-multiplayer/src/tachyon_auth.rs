//! Signing in to a Tachyon server through the system browser.
//!
//! Tachyon has no password grant and no device code flow, so the only interactive
//! sign-in is OAuth 2.0 authorization code with PKCE and a loopback redirect, as
//! profiled by RFC 8252 for native apps. This module owns that flow and nothing
//! above it: it discovers the server's endpoints, runs the browser handoff,
//! exchanges the code for tokens, refreshes them, and keeps the refresh token in
//! the OS keychain. Opening the WebSocket with the access token is later work.
//!
//! Four rules shape the code.
//!
//! Nothing is hardcoded except the well-known discovery path. The authorization and
//! token endpoints come from the server's RFC 8414 document, and the document's
//! `Cache-Control` header decides whether we may reuse it. Production answers
//! `max-age=0`, so in practice every attempt refetches.
//!
//! The loopback listener is the soft spot in this flow, because any process on the
//! machine can post to it. So [`sign_in`] sends a random `state` and refuses a
//! callback that does not carry the same value back.
//!
//! The browser is only ever handed a URL on the origin we just discovered. A
//! discovery document that pointed the authorization endpoint somewhere else would
//! otherwise send the user's credentials to that somewhere else.
//!
//! Nothing here logs a token, an authorization code or a PKCE verifier, and none of
//! the three crosses the Tauri IPC boundary. [`Tokens`] redacts itself when printed
//! so a stray `{:?}` cannot leak one either.

use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use base64::Engine as _;
use serde_json::Value;
use sha2::{Digest as _, Sha256};
use tokio::io::{AsyncReadExt as _, AsyncWriteExt as _};
use tokio::net::{TcpListener, TcpStream};
use url::Url;

/// The public client every lobby may use. Teiserver creates it at setup time, so it
/// needs no registration and no secret, and its `token_endpoint_auth_method` is
/// `none`. A dedicated registration is only required for scopes beyond
/// [`SCOPE`], which we do not ask for.
const CLIENT_ID: &str = "generic_lobby";

/// The only scope a lobby client needs.
const SCOPE: &str = "tachyon.lobby";

/// The one path we are allowed to hardcode. Everything else is read from what it
/// returns.
const DISCOVERY_PATH: &str = "/.well-known/oauth-authorization-server";

/// Path the browser is redirected back to. The generic client registers
/// `http://localhost/oauth2callback` with no port, and Teiserver skips the port
/// comparison when both sides are loopback, so an ephemeral port matches.
const CALLBACK_PATH: &str = "/oauth2callback";

/// How long the loopback listener waits for the browser before giving up. The
/// reference client uses a minute, and an abandoned sign-in must not leave a
/// listener bound for the rest of the session.
const CALLBACK_TIMEOUT: Duration = Duration::from_secs(60);

/// Budget for a single request to the server, discovery or token.
const HTTP_TIMEOUT: Duration = Duration::from_secs(30);

/// Refresh an access token this long before it expires, so a token that is about to
/// lapse is not handed to a connect that then fails mid-handshake.
const REFRESH_MARGIN: Duration = Duration::from_secs(60);

/// Why a sign-in did not produce a token.
#[derive(Debug)]
pub enum AuthError {
    /// The discovery document was missing, unreadable, or lacked something we need.
    Discovery(String),
    /// A request to the server failed before it could answer.
    Http(String),
    /// The loopback listener could not be bound or read.
    Listener(String),
    /// The browser came back to the callback without the parameters we need.
    BadCallback(String),
    /// The callback carried a `state` that was not the one we sent, so it did not
    /// come from the sign-in we started.
    StateMismatch,
    /// The authorization server redirected back with an error instead of a code,
    /// most often because the user cancelled.
    Denied {
        error: String,
        description: Option<String>,
    },
    /// Nobody hit the callback within [`CALLBACK_TIMEOUT`].
    TimedOut,
    /// The system browser would not open.
    Browser(String),
    /// The token endpoint answered with an OAuth error.
    Token {
        error: String,
        description: Option<String>,
    },
    /// The OS keychain refused to store or return the refresh token.
    Storage(String),
    /// There is no stored refresh token for this account, so the user has to sign
    /// in through the browser again.
    NotSignedIn,
}

impl std::fmt::Display for AuthError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Discovery(m) => write!(f, "the server did not describe its sign-in: {m}"),
            Self::Http(m) => write!(f, "could not reach the server: {m}"),
            Self::Listener(m) => write!(f, "could not listen for the browser: {m}"),
            Self::BadCallback(m) => write!(f, "the browser came back with {m}"),
            Self::StateMismatch => {
                write!(f, "the sign-in that came back was not the one we started")
            }
            Self::Denied { error, description } => match description {
                Some(d) => write!(f, "sign-in refused: {error}: {d}"),
                None => write!(f, "sign-in refused: {error}"),
            },
            Self::TimedOut => write!(f, "the sign-in was not finished in time"),
            Self::Browser(m) => write!(f, "could not open the browser: {m}"),
            Self::Token { error, description } => match description {
                Some(d) => write!(f, "the server refused the token request: {error}: {d}"),
                None => write!(f, "the server refused the token request: {error}"),
            },
            Self::Storage(m) => write!(f, "keychain error: {m}"),
            Self::NotSignedIn => write!(f, "not signed in to this server"),
        }
    }
}

/// The endpoints we take from the discovery document, and nothing else.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Endpoints {
    pub authorization: String,
    pub token: String,
}

/// An access token with the refresh token that will replace it.
///
/// `Debug` prints placeholders. The whole point of this type is to carry two
/// secrets, and a struct that carries secrets should not be printable by accident.
#[derive(Clone)]
pub struct Tokens {
    pub access: String,
    pub refresh: String,
    /// When the access token stops working.
    pub expires_at: Instant,
}

impl std::fmt::Debug for Tokens {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Tokens")
            .field("access", &"<redacted>")
            .field("refresh", &"<redacted>")
            .field(
                "expires_in",
                &self.expires_at.saturating_duration_since(Instant::now()),
            )
            .finish()
    }
}

// ---------------------------------------------------------------- discovery

/// Discovery documents we may still reuse, keyed by base URL, with the instant the
/// server's `Cache-Control` stops allowing it.
static DISCOVERY_CACHE: OnceLock<Mutex<HashMap<String, (Instant, Endpoints)>>> = OnceLock::new();

fn discovery_cache() -> &'static Mutex<HashMap<String, (Instant, Endpoints)>> {
    DISCOVERY_CACHE.get_or_init(Default::default)
}

/// How long a response may be reused, from its `Cache-Control` header. `no-store`
/// and `no-cache` mean never, and so does a missing or unparseable `max-age`.
/// Production sends `max-age=0, private, must-revalidate`, which lands on zero.
fn cacheable_for(header: Option<&str>) -> Duration {
    let Some(value) = header else {
        return Duration::ZERO;
    };
    let lower = value.to_ascii_lowercase();
    let mut max_age = Duration::ZERO;
    for part in lower.split(',') {
        let part = part.trim();
        if part == "no-store" || part == "no-cache" {
            return Duration::ZERO;
        }
        if let Some(secs) = part.strip_prefix("max-age=") {
            max_age = secs
                .trim()
                .parse()
                .map(Duration::from_secs)
                .unwrap_or(Duration::ZERO);
        }
    }
    max_age
}

/// Read the RFC 8414 document at `base_url` and take the two endpoints from it.
///
/// Every failure names what was missing, because the alternative is a sign-in that
/// dies with no explanation on a server that simply does not speak OAuth.
pub async fn discover(base_url: &str) -> Result<Endpoints, AuthError> {
    let base = base_url.trim_end_matches('/').to_owned();
    if let Some((until, endpoints)) = discovery_cache().lock().unwrap().get(&base) {
        if *until > Instant::now() {
            return Ok(endpoints.clone());
        }
    }

    let url = format!("{base}{DISCOVERY_PATH}");
    let client = reqwest::Client::builder()
        .timeout(HTTP_TIMEOUT)
        .build()
        .map_err(|e| AuthError::Http(e.to_string()))?;
    let resp = client
        .get(&url)
        .send()
        .await
        .map_err(|e| AuthError::Http(e.to_string()))?;
    let status = resp.status();
    let cache_for = cacheable_for(
        resp.headers()
            .get(reqwest::header::CACHE_CONTROL)
            .and_then(|v| v.to_str().ok()),
    );
    let body = resp
        .text()
        .await
        .map_err(|e| AuthError::Http(e.to_string()))?;
    if !status.is_success() {
        return Err(AuthError::Discovery(format!(
            "{url} answered HTTP {}",
            status.as_u16()
        )));
    }
    let doc: Value = serde_json::from_str(&body)
        .map_err(|e| AuthError::Discovery(format!("{url} is not JSON: {e}")))?;

    let endpoint = |name: &str| -> Result<String, AuthError> {
        doc.get(name)
            .and_then(Value::as_str)
            .filter(|s| !s.is_empty())
            .map(str::to_owned)
            .ok_or_else(|| AuthError::Discovery(format!("{url} has no {name}")))
    };
    let endpoints = Endpoints {
        authorization: endpoint("authorization_endpoint")?,
        token: endpoint("token_endpoint")?,
    };

    // The server has to accept the only challenge method we send. A server that
    // advertises plain-only would silently get an S256 challenge treated as a
    // literal verifier, so refuse instead.
    let supports_s256 = doc
        .get("code_challenge_methods_supported")
        .and_then(Value::as_array)
        .is_some_and(|m| m.iter().any(|v| v.as_str() == Some("S256")));
    if !supports_s256 {
        return Err(AuthError::Discovery(format!(
            "{url} does not offer the S256 code challenge method"
        )));
    }

    if !cache_for.is_zero() {
        discovery_cache()
            .lock()
            .unwrap()
            .insert(base, (Instant::now() + cache_for, endpoints.clone()));
    }
    Ok(endpoints)
}

// --------------------------------------------------------------------- PKCE

/// A PKCE verifier and the challenge derived from it.
///
/// `Debug` is deliberately not derived. The verifier is the secret half.
pub struct Pkce {
    verifier: String,
    challenge: String,
}

impl Pkce {
    /// 32 bytes from the OS random source, base64url encoded to a 43 character
    /// verifier, which is the length RFC 7636 recommends.
    fn generate() -> Result<Self, AuthError> {
        let verifier = random_token(32)?;
        let challenge = challenge_for(&verifier);
        Ok(Self {
            verifier,
            challenge,
        })
    }
}

/// `base64url(sha256(verifier))` with no padding, which is the `S256` method.
fn challenge_for(verifier: &str) -> String {
    let digest = Sha256::digest(verifier.as_bytes());
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(digest)
}

/// `len` bytes from the OS random source, base64url encoded without padding.
/// `getrandom` reads the platform CSPRNG, so this is safe for a PKCE verifier and
/// for `state`.
fn random_token(len: usize) -> Result<String, AuthError> {
    let mut bytes = vec![0u8; len];
    getrandom::fill(&mut bytes)
        .map_err(|e| AuthError::Listener(format!("no random source: {e}")))?;
    Ok(base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes))
}

// --------------------------------------------------------- loopback listener

/// The page the browser is left showing. Plain, because it is rendered by whatever
/// browser the user happens to have and nobody reads it twice.
const CLOSE_PAGE: &str = "<!doctype html><html><head><meta charset=\"utf-8\"><title>Signed in</title></head><body><p>Coilbox has your sign-in. You can close this window.</p></body></html>";

/// Write one HTTP response and close. Anything the browser sends after this is of
/// no interest to us.
async fn respond(sock: &mut TcpStream, status: &str, body: &str) {
    let head = format!(
        "HTTP/1.1 {status}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        body.len()
    );
    let _ = sock.write_all(head.as_bytes()).await;
    let _ = sock.write_all(body.as_bytes()).await;
    let _ = sock.flush().await;
}

/// Read the request line of an HTTP request and return its target, for example
/// `/oauth2callback?code=x`. Anything longer than 8 KiB before the first line break
/// is not a browser and is dropped.
async fn read_target(sock: &mut TcpStream) -> Option<String> {
    let mut buf = Vec::new();
    let mut chunk = [0u8; 512];
    while !buf.windows(2).any(|w| w == b"\r\n") {
        if buf.len() > 8192 {
            return None;
        }
        match sock.read(&mut chunk).await {
            Ok(0) | Err(_) => return None,
            Ok(n) => buf.extend_from_slice(&chunk[..n]),
        }
    }
    let line = String::from_utf8_lossy(&buf);
    let line = line.split("\r\n").next()?;
    let mut parts = line.split(' ');
    let _method = parts.next()?;
    Some(parts.next()?.to_owned())
}

/// Wait for the browser to arrive at the callback and return the authorization
/// code.
///
/// The listener is already bound, so the caller could build the redirect URI before
/// this is awaited. It answers every request it receives, because a browser left on
/// an unanswered socket shows an error page rather than the one we wrote, but only
/// a request to [`CALLBACK_PATH`] ends the wait.
///
/// A callback carrying the wrong `state` is refused rather than ignored. Ignoring
/// it would leave the real browser able to finish, but it would also mean a process
/// on this machine could keep guessing without us ever noticing.
async fn wait_for_callback(
    listener: TcpListener,
    state: &str,
    timeout: Duration,
) -> Result<String, AuthError> {
    let wait = async {
        loop {
            let (mut sock, _) = listener
                .accept()
                .await
                .map_err(|e| AuthError::Listener(e.to_string()))?;
            let Some(target) = read_target(&mut sock).await else {
                respond(&mut sock, "400 Bad Request", "Bad request.").await;
                continue;
            };
            // The target is a path, so it needs any origin to parse as a URL. Ours
            // is the one it arrived on.
            let Ok(url) = Url::parse(&format!("http://127.0.0.1{target}")) else {
                respond(&mut sock, "400 Bad Request", "Bad request.").await;
                continue;
            };
            if url.path() != CALLBACK_PATH {
                respond(&mut sock, "404 Not Found", "Not found.").await;
                continue;
            }
            let params: HashMap<String, String> = url.query_pairs().into_owned().collect();

            if let Some(error) = params.get("error") {
                respond(
                    &mut sock,
                    "200 OK",
                    "<!doctype html><html><head><meta charset=\"utf-8\"></head><body><p>Sign-in did not finish. You can close this window and try again in Coilbox.</p></body></html>",
                )
                .await;
                return Err(AuthError::Denied {
                    error: error.clone(),
                    description: params.get("error_description").cloned(),
                });
            }

            if params.get("state").map(String::as_str) != Some(state) {
                respond(
                    &mut sock,
                    "400 Bad Request",
                    "This sign-in was not the one Coilbox started.",
                )
                .await;
                return Err(AuthError::StateMismatch);
            }

            let Some(code) = params.get("code").filter(|c| !c.is_empty()) else {
                respond(&mut sock, "400 Bad Request", "Bad request.").await;
                return Err(AuthError::BadCallback("no code".into()));
            };
            let code = code.clone();
            respond(&mut sock, "200 OK", CLOSE_PAGE).await;
            return Ok(code);
        }
    };
    match tokio::time::timeout(timeout, wait).await {
        Ok(result) => result,
        Err(_) => Err(AuthError::TimedOut),
    }
}

// ------------------------------------------------------------- token requests

/// POST a form to the token endpoint and read the tokens out of the answer.
///
/// `previous_refresh` is used when the server rotates nothing and leaves
/// `refresh_token` out of a refresh response, which RFC 6749 allows.
async fn post_token(
    token_endpoint: &str,
    form: &[(&str, &str)],
    previous_refresh: Option<&str>,
) -> Result<Tokens, AuthError> {
    let client = reqwest::Client::builder()
        .timeout(HTTP_TIMEOUT)
        .build()
        .map_err(|e| AuthError::Http(e.to_string()))?;
    let sent_at = Instant::now();
    let resp = client
        .post(token_endpoint)
        .form(form)
        .send()
        .await
        .map_err(|e| AuthError::Http(e.to_string()))?;
    let status = resp.status();
    let body = resp
        .text()
        .await
        .map_err(|e| AuthError::Http(e.to_string()))?;
    let doc: Value = serde_json::from_str(&body).unwrap_or(Value::Null);

    if let Some(error) = doc.get("error").and_then(Value::as_str) {
        return Err(AuthError::Token {
            error: error.to_owned(),
            description: doc
                .get("error_description")
                .and_then(Value::as_str)
                .map(str::to_owned),
        });
    }
    if !status.is_success() {
        return Err(AuthError::Token {
            error: format!("http_{}", status.as_u16()),
            description: None,
        });
    }

    let access = doc
        .get("access_token")
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| AuthError::Token {
            error: "invalid_response".into(),
            description: Some("no access_token".into()),
        })?
        .to_owned();
    let refresh = doc
        .get("refresh_token")
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
        .map(str::to_owned)
        .or_else(|| previous_refresh.map(str::to_owned))
        .ok_or_else(|| AuthError::Token {
            error: "invalid_response".into(),
            description: Some("no refresh_token".into()),
        })?;
    // Teiserver's access tokens last 30 minutes. A server that says nothing gets
    // the shortest sensible assumption rather than an unbounded one.
    let expires_in = doc.get("expires_in").and_then(Value::as_u64).unwrap_or(300);
    Ok(Tokens {
        access,
        refresh,
        expires_at: sent_at + Duration::from_secs(expires_in),
    })
}

/// Trade an authorization code for tokens. The body is form encoded, which the
/// specification made explicit, and carries no client secret because the generic
/// client has none.
async fn exchange_code(
    token_endpoint: &str,
    code: &str,
    verifier: &str,
    redirect_uri: &str,
) -> Result<Tokens, AuthError> {
    post_token(
        token_endpoint,
        &[
            ("client_id", CLIENT_ID),
            ("grant_type", "authorization_code"),
            ("code", code),
            ("code_verifier", verifier),
            ("redirect_uri", redirect_uri),
        ],
        None,
    )
    .await
}

/// Trade a refresh token for a fresh access token.
pub async fn refresh(token_endpoint: &str, refresh_token: &str) -> Result<Tokens, AuthError> {
    post_token(
        token_endpoint,
        &[
            ("client_id", CLIENT_ID),
            ("grant_type", "refresh_token"),
            ("refresh_token", refresh_token),
        ],
        Some(refresh_token),
    )
    .await
}

// ----------------------------------------------------------------- the flow

/// Build the authorization URL the browser is sent to.
fn authorize_url(
    endpoint: &str,
    challenge: &str,
    state: &str,
    redirect_uri: &str,
) -> Result<Url, AuthError> {
    let mut url = Url::parse(endpoint)
        .map_err(|e| AuthError::Discovery(format!("authorization_endpoint is not a URL: {e}")))?;
    url.query_pairs_mut()
        .append_pair("response_type", "code")
        .append_pair("client_id", CLIENT_ID)
        .append_pair("scope", SCOPE)
        .append_pair("redirect_uri", redirect_uri)
        .append_pair("state", state)
        .append_pair("code_challenge_method", "S256")
        .append_pair("code_challenge", challenge);
    Ok(url)
}

/// Whether two URLs share a scheme, host and port.
fn same_origin(a: &Url, b: &Url) -> bool {
    a.scheme() == b.scheme()
        && a.host() == b.host()
        && a.port_or_known_default() == b.port_or_known_default()
}

/// Run the whole browser sign-in against the server at `base_url`.
///
/// `open_browser` is a parameter rather than a call to the opener plugin so the
/// tests can play the part of the browser. Production passes the plugin.
pub async fn sign_in<F>(base_url: &str, open_browser: F) -> Result<Tokens, AuthError>
where
    F: FnOnce(&str) -> Result<(), String>,
{
    let base = base_url.trim_end_matches('/').to_owned();
    let endpoints = discover(&base).await?;

    // Bind before the browser opens, so the redirect URI in the authorization
    // request names a port that is already listening.
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|e| AuthError::Listener(e.to_string()))?;
    let port = listener
        .local_addr()
        .map_err(|e| AuthError::Listener(e.to_string()))?
        .port();
    let redirect_uri = format!("http://127.0.0.1:{port}{CALLBACK_PATH}");

    let pkce = Pkce::generate()?;
    let state = random_token(16)?;
    let url = authorize_url(
        &endpoints.authorization,
        &pkce.challenge,
        &state,
        &redirect_uri,
    )?;

    // The guard the reference client uses, with teeth. Checking the URL we built
    // against the endpoint we built it from proves little on its own, so the origin
    // both must be on is the server's own. A discovery document that named an
    // authorization endpoint elsewhere would otherwise put the user's password into
    // a sign-in page of somebody else's choosing.
    let server =
        Url::parse(&base).map_err(|e| AuthError::Discovery(format!("{base} is not a URL: {e}")))?;
    if !same_origin(&url, &server) {
        return Err(AuthError::Browser(format!(
            "refusing to open {}, which is not on {}",
            url.origin().ascii_serialization(),
            server.origin().ascii_serialization()
        )));
    }
    open_browser(url.as_str()).map_err(AuthError::Browser)?;

    let code = wait_for_callback(listener, &state, CALLBACK_TIMEOUT).await?;
    exchange_code(&endpoints.token, &code, &pkce.verifier, &redirect_uri).await
}

// -------------------------------------------------------------- token store

/// Access tokens held for the life of the process, keyed the way the keychain is.
/// These are never written to disk. A restart signs back in from the stored refresh
/// token instead.
static ACCESS_TOKENS: OnceLock<Mutex<HashMap<String, Tokens>>> = OnceLock::new();

fn access_tokens() -> &'static Mutex<HashMap<String, Tokens>> {
    ACCESS_TOKENS.get_or_init(Default::default)
}

/// Sign in and keep the result: the refresh token to the OS keychain, the access
/// token to memory. Neither is returned to the caller.
pub async fn sign_in_and_store<F>(
    base_url: &str,
    server_id: &str,
    username: &str,
    open_browser: F,
) -> Result<(), AuthError>
where
    F: FnOnce(&str) -> Result<(), String>,
{
    let tokens = sign_in(base_url, open_browser).await?;
    tauri_plugin_coilbox_lobby_servers::store_credential(server_id, username, &tokens.refresh)
        .map_err(AuthError::Storage)?;
    access_tokens()
        .lock()
        .unwrap()
        .insert(format!("{server_id}:{username}"), tokens);
    Ok(())
}

/// Forget an account: the stored refresh token and any access token in memory.
pub fn sign_out(server_id: &str, username: &str) -> Result<(), AuthError> {
    access_tokens()
        .lock()
        .unwrap()
        .remove(&format!("{server_id}:{username}"));
    tauri_plugin_coilbox_lobby_servers::delete_credential(server_id, username)
        .map_err(AuthError::Storage)
}

/// An access token good for the next minute at least, refreshed from the stored
/// refresh token if the one in memory is spent or missing.
///
/// This is what `mp_connect_tachyon` calls for the bearer token on the upgrade.
pub async fn access_token(
    base_url: &str,
    server_id: &str,
    username: &str,
) -> Result<String, AuthError> {
    let key = format!("{server_id}:{username}");
    if let Some(tokens) = access_tokens().lock().unwrap().get(&key) {
        if tokens.expires_at > Instant::now() + REFRESH_MARGIN {
            return Ok(tokens.access.clone());
        }
    }
    let stored = tauri_plugin_coilbox_lobby_servers::get_credential(server_id, username)
        .map_err(AuthError::Storage)?
        .ok_or(AuthError::NotSignedIn)?;
    let endpoints = discover(base_url).await?;
    let tokens = refresh(&endpoints.token, &stored).await?;
    // Teiserver's refresh tokens do not rotate today, but a server that starts
    // rotating them would otherwise leave us holding a dead one.
    if tokens.refresh != stored {
        tauri_plugin_coilbox_lobby_servers::store_credential(server_id, username, &tokens.refresh)
            .map_err(AuthError::Storage)?;
    }
    let access = tokens.access.clone();
    access_tokens().lock().unwrap().insert(key, tokens);
    Ok(access)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;

    /// What the stand-in authorization server should do, and what it saw. One
    /// struct because every test tweaks one field of it and reads another back.
    #[derive(Default)]
    struct Fake {
        /// Sent with the discovery document. `None` sends no header at all.
        cache_control: Option<&'static str>,
        /// Whether the document advertises the S256 challenge method.
        no_s256: bool,
        /// Whether the document names a token endpoint.
        no_token_endpoint: bool,
        /// An absolute authorization endpoint that overrides the server's own, so a
        /// test can point it at another origin.
        authorization_override: Option<String>,
        /// How many times the discovery document was fetched.
        discovery_hits: usize,
        /// The challenge the browser stand-in saw in the authorization URL, which
        /// the token endpoint checks the verifier against.
        challenge: Option<String>,
        /// The query the browser stand-in saw, for assertions.
        authorize_query: HashMap<String, String>,
        /// The form the token endpoint last received.
        token_form: HashMap<String, String>,
        /// Makes the token endpoint answer with this OAuth error instead.
        token_error: Option<&'static str>,
        /// Makes the token endpoint leave `refresh_token` out of its answer.
        omit_refresh: bool,
    }

    type Shared = Arc<Mutex<Fake>>;

    /// Read one HTTP request off the socket and return its target and body.
    async fn read_request(sock: &mut TcpStream) -> Option<(String, String)> {
        let mut buf = Vec::new();
        let mut chunk = [0u8; 1024];
        let head_end = loop {
            match sock.read(&mut chunk).await {
                Ok(0) | Err(_) => return None,
                Ok(n) => buf.extend_from_slice(&chunk[..n]),
            }
            if let Some(p) = buf.windows(4).position(|w| w == b"\r\n\r\n") {
                break p + 4;
            }
        };
        let head = String::from_utf8_lossy(&buf[..head_end]).into_owned();
        let target = head.split_whitespace().nth(1)?.to_owned();
        let len: usize = head
            .lines()
            .find_map(|l| {
                l.to_ascii_lowercase()
                    .strip_prefix("content-length:")
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
        Some((target, body))
    }

    async fn write_response(sock: &mut TcpStream, status: &str, extra: &str, body: &str) {
        let head = format!(
            "HTTP/1.1 {status}\r\nContent-Type: application/json\r\n{extra}Content-Length: {}\r\nConnection: close\r\n\r\n",
            body.len()
        );
        let _ = sock.write_all(head.as_bytes()).await;
        let _ = sock.write_all(body.as_bytes()).await;
        let _ = sock.flush().await;
    }

    /// Start a stand-in authorization server on loopback and return its base URL.
    /// It serves the discovery document and the token endpoint. The authorization
    /// endpoint is never fetched, because the browser is a closure in these tests.
    async fn start(shared: Shared) -> String {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base = format!("http://127.0.0.1:{}", listener.local_addr().unwrap().port());
        let served = base.clone();
        tokio::spawn(async move {
            while let Ok((mut sock, _)) = listener.accept().await {
                let shared = shared.clone();
                let base = served.clone();
                tokio::spawn(async move {
                    let Some((target, body)) = read_request(&mut sock).await else {
                        return;
                    };
                    if target.starts_with(DISCOVERY_PATH) {
                        let (doc, extra) = {
                            let mut f = shared.lock().unwrap();
                            f.discovery_hits += 1;
                            let mut doc = serde_json::Map::new();
                            doc.insert(
                                "authorization_endpoint".into(),
                                Value::String(
                                    f.authorization_override
                                        .clone()
                                        .unwrap_or(format!("{base}/oauth/authorize")),
                                ),
                            );
                            if !f.no_token_endpoint {
                                doc.insert(
                                    "token_endpoint".into(),
                                    Value::String(format!("{base}/oauth/token")),
                                );
                            }
                            if !f.no_s256 {
                                doc.insert(
                                    "code_challenge_methods_supported".into(),
                                    serde_json::json!(["S256"]),
                                );
                            }
                            let extra = match f.cache_control {
                                Some(v) => format!("Cache-Control: {v}\r\n"),
                                None => String::new(),
                            };
                            (Value::Object(doc).to_string(), extra)
                        };
                        write_response(&mut sock, "200 OK", &extra, &doc).await;
                        return;
                    }
                    if target.starts_with("/oauth/token") {
                        let form: HashMap<String, String> =
                            url::form_urlencoded::parse(body.as_bytes())
                                .into_owned()
                                .collect();
                        let outcome = {
                            let mut f = shared.lock().unwrap();
                            f.token_form = form.clone();
                            // The PKCE check the real server performs. Without it a
                            // client that sent the wrong verifier would still pass.
                            let wrong_verifier = form.get("grant_type").map(String::as_str)
                                == Some("authorization_code")
                                && Some(challenge_for(
                                    form.get("code_verifier").map(String::as_str).unwrap_or(""),
                                )) != f.challenge;
                            match (f.token_error, wrong_verifier) {
                                (Some(err), _) => Err(serde_json::json!({
                                    "error": err,
                                    "error_description": "the stand-in server said no",
                                })),
                                (None, true) => {
                                    Err(serde_json::json!({ "error": "invalid_grant" }))
                                }
                                (None, false) => {
                                    let mut answer = serde_json::json!({
                                        "access_token": "an-access-token",
                                        "token_type": "Bearer",
                                        "expires_in": 1800,
                                    });
                                    if !f.omit_refresh {
                                        answer["refresh_token"] =
                                            Value::String("a-refresh-token".into());
                                    }
                                    Ok(answer)
                                }
                            }
                        };
                        match outcome {
                            Ok(answer) => {
                                write_response(&mut sock, "200 OK", "", &answer.to_string()).await
                            }
                            Err(body) => {
                                write_response(&mut sock, "400 Bad Request", "", &body.to_string())
                                    .await
                            }
                        }
                        return;
                    }
                    write_response(&mut sock, "404 Not Found", "", "{}").await;
                });
            }
        });
        base
    }

    /// A browser stand-in. It records what the authorization URL carried, then hits
    /// the loopback callback with whatever `reply` builds from the state it saw.
    fn browser(
        shared: Shared,
        reply: fn(&str) -> String,
    ) -> impl FnOnce(&str) -> Result<(), String> {
        move |url: &str| {
            let parsed = Url::parse(url).unwrap();
            let query: HashMap<String, String> = parsed.query_pairs().into_owned().collect();
            let redirect = query.get("redirect_uri").cloned().unwrap();
            let state = query.get("state").cloned().unwrap();
            {
                let mut f = shared.lock().unwrap();
                f.challenge = query.get("code_challenge").cloned();
                f.authorize_query = query;
            }
            let target = format!("{redirect}?{}", reply(&state));
            tokio::spawn(async move {
                let _ = reqwest::get(&target).await;
            });
            Ok(())
        }
    }

    fn good_callback(state: &str) -> String {
        format!("code=an-authorization-code&state={state}")
    }

    // ------------------------------------------------------------------ PKCE

    /// The RFC 7636 appendix B vector. Self-consistency would not catch a base64
    /// alphabet or padding mistake, and this does.
    #[test]
    fn s256_challenge_matches_the_rfc_7636_vector() {
        assert_eq!(
            challenge_for("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
            "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
        );
    }

    #[test]
    fn a_generated_verifier_is_43_characters_and_never_repeats() {
        let a = Pkce::generate().unwrap();
        let b = Pkce::generate().unwrap();
        assert_eq!(a.verifier.len(), 43);
        assert_ne!(a.verifier, b.verifier);
        assert_eq!(a.challenge, challenge_for(&a.verifier));
    }

    // ------------------------------------------------------------- discovery

    #[test]
    fn cache_control_decides_how_long_a_document_may_be_reused() {
        // What production sends.
        assert_eq!(
            cacheable_for(Some("max-age=0, private, must-revalidate")),
            Duration::ZERO
        );
        assert_eq!(cacheable_for(Some("max-age=600")), Duration::from_secs(600));
        assert_eq!(
            cacheable_for(Some("public, max-age=60")),
            Duration::from_secs(60)
        );
        assert_eq!(cacheable_for(Some("no-store")), Duration::ZERO);
        assert_eq!(cacheable_for(Some("max-age=60, no-cache")), Duration::ZERO);
        assert_eq!(cacheable_for(Some("max-age=banana")), Duration::ZERO);
        assert_eq!(cacheable_for(None), Duration::ZERO);
    }

    #[tokio::test]
    async fn discovery_reads_both_endpoints() {
        let shared = Shared::default();
        let base = start(shared.clone()).await;
        let endpoints = discover(&base).await.unwrap();
        assert_eq!(endpoints.authorization, format!("{base}/oauth/authorize"));
        assert_eq!(endpoints.token, format!("{base}/oauth/token"));
    }

    #[tokio::test]
    async fn discovery_refuses_a_document_with_no_token_endpoint() {
        let shared = Shared::default();
        shared.lock().unwrap().no_token_endpoint = true;
        let base = start(shared).await;
        let err = discover(&base).await.unwrap_err();
        assert!(
            matches!(&err, AuthError::Discovery(m) if m.contains("no token_endpoint")),
            "{err:?}"
        );
    }

    #[tokio::test]
    async fn discovery_refuses_a_server_that_does_not_offer_s256() {
        let shared = Shared::default();
        shared.lock().unwrap().no_s256 = true;
        let base = start(shared).await;
        let err = discover(&base).await.unwrap_err();
        assert!(
            matches!(&err, AuthError::Discovery(m) if m.contains("S256")),
            "{err:?}"
        );
    }

    #[tokio::test]
    async fn discovery_is_refetched_when_the_server_forbids_caching() {
        let shared = Shared::default();
        shared.lock().unwrap().cache_control = Some("max-age=0, private, must-revalidate");
        let base = start(shared.clone()).await;
        discover(&base).await.unwrap();
        discover(&base).await.unwrap();
        assert_eq!(shared.lock().unwrap().discovery_hits, 2);
    }

    #[tokio::test]
    async fn discovery_is_reused_for_the_max_age_the_server_allows() {
        let shared = Shared::default();
        shared.lock().unwrap().cache_control = Some("max-age=600");
        let base = start(shared.clone()).await;
        discover(&base).await.unwrap();
        discover(&base).await.unwrap();
        assert_eq!(shared.lock().unwrap().discovery_hits, 1);
    }

    // ---------------------------------------------------------------- sign-in

    #[tokio::test]
    async fn sign_in_exchanges_the_code_for_tokens() {
        let shared = Shared::default();
        let base = start(shared.clone()).await;
        let tokens = sign_in(&base, browser(shared.clone(), good_callback))
            .await
            .unwrap();
        assert_eq!(tokens.access, "an-access-token");
        assert_eq!(tokens.refresh, "a-refresh-token");

        let f = shared.lock().unwrap();
        assert_eq!(f.authorize_query["response_type"], "code");
        assert_eq!(f.authorize_query["client_id"], "generic_lobby");
        assert_eq!(f.authorize_query["scope"], "tachyon.lobby");
        assert_eq!(f.authorize_query["code_challenge_method"], "S256");
        assert!(f.authorize_query["redirect_uri"].ends_with("/oauth2callback"));
        assert!(f.authorize_query["redirect_uri"].starts_with("http://127.0.0.1:"));

        assert_eq!(f.token_form["grant_type"], "authorization_code");
        assert_eq!(f.token_form["code"], "an-authorization-code");
        assert_eq!(f.token_form["client_id"], "generic_lobby");
        assert_eq!(
            f.token_form["redirect_uri"],
            f.authorize_query["redirect_uri"]
        );
    }

    #[tokio::test]
    async fn sign_in_refuses_a_callback_carrying_someone_else_s_state() {
        let shared = Shared::default();
        let base = start(shared.clone()).await;
        let err = sign_in(
            &base,
            browser(shared, |_state| {
                "code=a-code-from-nowhere&state=not-the-state-we-sent".into()
            }),
        )
        .await
        .unwrap_err();
        assert!(matches!(err, AuthError::StateMismatch), "{err:?}");
    }

    #[tokio::test]
    async fn sign_in_surfaces_an_error_redirect_rather_than_waiting_it_out() {
        let shared = Shared::default();
        let base = start(shared.clone()).await;
        let err = sign_in(
            &base,
            browser(shared, |state| {
                format!("error=access_denied&error_description=The+user+said+no&state={state}")
            }),
        )
        .await
        .unwrap_err();
        match err {
            AuthError::Denied { error, description } => {
                assert_eq!(error, "access_denied");
                assert_eq!(description.as_deref(), Some("The user said no"));
            }
            other => panic!("expected a denial, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn sign_in_refuses_to_send_the_browser_off_the_server_s_own_origin() {
        let shared = Shared::default();
        shared.lock().unwrap().authorization_override =
            Some("https://not-the-lobby-server.example/oauth/authorize".into());
        let base = start(shared).await;
        let err = sign_in(&base, |_url| panic!("the browser must not be opened"))
            .await
            .unwrap_err();
        assert!(matches!(err, AuthError::Browser(_)), "{err:?}");
    }

    #[tokio::test]
    async fn the_listener_gives_up_rather_than_waiting_for_a_browser_that_never_comes() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let err = wait_for_callback(listener, "some-state", Duration::from_millis(50))
            .await
            .unwrap_err();
        assert!(matches!(err, AuthError::TimedOut), "{err:?}");
    }

    // ----------------------------------------------------------------- tokens

    #[tokio::test]
    async fn a_token_endpoint_error_is_surfaced_with_its_description() {
        let shared = Shared::default();
        shared.lock().unwrap().token_error = Some("invalid_grant");
        let base = start(shared.clone()).await;
        let endpoints = discover(&base).await.unwrap();
        let err = refresh(&endpoints.token, "a-stale-refresh-token")
            .await
            .unwrap_err();
        match err {
            AuthError::Token { error, description } => {
                assert_eq!(error, "invalid_grant");
                assert_eq!(description.as_deref(), Some("the stand-in server said no"));
            }
            other => panic!("expected a token error, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn refreshing_sends_the_refresh_grant_and_returns_a_new_access_token() {
        let shared = Shared::default();
        let base = start(shared.clone()).await;
        let endpoints = discover(&base).await.unwrap();
        let tokens = refresh(&endpoints.token, "the-stored-refresh-token")
            .await
            .unwrap();
        assert_eq!(tokens.access, "an-access-token");
        let f = shared.lock().unwrap();
        assert_eq!(f.token_form["grant_type"], "refresh_token");
        assert_eq!(f.token_form["refresh_token"], "the-stored-refresh-token");
        assert_eq!(f.token_form["client_id"], "generic_lobby");
    }

    /// Teiserver does not rotate refresh tokens, so a refresh answer carries no
    /// `refresh_token` field. Losing the stored one there would sign the user out
    /// every thirty minutes.
    #[tokio::test]
    async fn refreshing_keeps_the_stored_token_when_the_server_returns_none() {
        let shared = Shared::default();
        shared.lock().unwrap().omit_refresh = true;
        let base = start(shared.clone()).await;
        let endpoints = discover(&base).await.unwrap();
        let tokens = refresh(&endpoints.token, "the-stored-refresh-token")
            .await
            .unwrap();
        assert_eq!(tokens.refresh, "the-stored-refresh-token");
    }

    #[test]
    fn tokens_do_not_print_themselves() {
        let tokens = Tokens {
            access: "secret-access".into(),
            refresh: "secret-refresh".into(),
            expires_at: Instant::now(),
        };
        let printed = format!("{tokens:?}");
        assert!(!printed.contains("secret"), "{printed}");
    }

    /// Read the real Beyond All Reason server's discovery document. It needs no
    /// account and opens nothing, but it does need the internet, so it is ignored
    /// rather than run in CI.
    ///
    /// ```text
    /// cargo test -p tauri-plugin-coilbox-multiplayer live_discovery -- --ignored --nocapture
    /// ```
    #[tokio::test]
    #[ignore = "reaches the live server, so it cannot run in CI"]
    async fn live_discovery() {
        let endpoints = discover("https://server4.beyondallreason.info")
            .await
            .expect("discovery failed");
        println!("{endpoints:#?}");
        assert!(endpoints.authorization.starts_with("https://"));
        assert!(endpoints.token.starts_with("https://"));
    }

    /// The one test that needs a real Beyond All Reason account. It opens your
    /// browser, waits for you to sign in, and prints whether a token came back.
    /// Nothing is stored and no token is printed.
    ///
    /// Run it with:
    ///
    /// ```text
    /// cargo test -p tauri-plugin-coilbox-multiplayer live_sign_in -- --ignored --nocapture
    /// ```
    #[tokio::test]
    #[ignore = "opens a browser and needs a real account, so it cannot run in CI"]
    async fn live_sign_in() {
        let base = "https://server4.beyondallreason.info";
        let endpoints = discover(base).await.expect("discovery failed");
        println!("authorization endpoint: {}", endpoints.authorization);
        println!("token endpoint: {}", endpoints.token);
        println!("opening your browser, sign in there within a minute");

        let tokens = sign_in(base, |url| {
            tauri_plugin_opener::open_url(url, None::<&str>).map_err(|e| e.to_string())
        })
        .await
        .expect("sign-in failed");

        println!(
            "got an access token of {} characters and a refresh token of {}, valid for {:?}",
            tokens.access.len(),
            tokens.refresh.len(),
            tokens.expires_at.saturating_duration_since(Instant::now())
        );

        let again = refresh(&endpoints.token, &tokens.refresh)
            .await
            .expect("refresh failed");
        println!(
            "the refresh grant works, it returned {} characters",
            again.access.len()
        );
    }
}
