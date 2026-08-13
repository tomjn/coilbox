//! Signing in to a Tachyon server through the system browser.
//!
//! The flow itself lives in `coilbox-oauth`: PKCE, the loopback listener, the
//! `state` check, the token request and the keychain. What is here is the part that
//! is Tachyon's own. It discovers the server's endpoints from its RFC 8414
//! document, names the client and scope on the authorization URL, and posts the
//! form-encoded grants Teiserver expects.
//!
//! Nothing is hardcoded except the well-known discovery path. The authorization and
//! token endpoints come from the server's own document, and the document's
//! `Cache-Control` header decides whether we may reuse it. Production answers
//! `max-age=0`, so in practice every attempt refetches.
//!
//! Nothing here logs a token, an authorization code or a PKCE verifier, and none of
//! the three crosses the Tauri IPC boundary.

use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use coilbox_oauth::{
    post_token, AuthError, AuthRequest, TokenBody, TokenRequest, Tokens, HTTP_TIMEOUT,
};
use serde_json::Value;
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

/// The endpoints we take from the discovery document, and nothing else.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Endpoints {
    pub authorization: String,
    pub token: String,
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

// ------------------------------------------------------------- token requests

/// Post one of Teiserver's grants. The body is form encoded, which the
/// specification made explicit, and carries no client secret because the generic
/// client has none.
async fn grant(
    token_endpoint: &str,
    form: &[(&str, &str)],
    previous_refresh: Option<&str>,
) -> Result<Tokens, AuthError> {
    let answer = post_token(TokenRequest {
        endpoint: token_endpoint,
        body: TokenBody::Form(
            form.iter()
                .map(|(k, v)| ((*k).to_owned(), (*v).to_owned()))
                .collect(),
        ),
        headers: vec![],
        previous_refresh,
    })
    .await?;
    Ok(answer.tokens)
}

/// Trade a refresh token for a fresh access token.
pub async fn refresh(token_endpoint: &str, refresh_token: &str) -> Result<Tokens, AuthError> {
    grant(
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
fn authorize_url(endpoint: &str, request: &AuthRequest) -> Result<Url, AuthError> {
    let mut url = Url::parse(endpoint)
        .map_err(|e| AuthError::Discovery(format!("authorization_endpoint is not a URL: {e}")))?;
    url.query_pairs_mut()
        .append_pair("response_type", "code")
        .append_pair("client_id", CLIENT_ID)
        .append_pair("scope", SCOPE)
        .append_pair("redirect_uri", &request.redirect_uri)
        .append_pair("state", &request.state)
        .append_pair("code_challenge_method", "S256")
        .append_pair("code_challenge", &request.challenge);
    Ok(url)
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
    let authorization = coilbox_oauth::authorize(
        &base,
        |request| authorize_url(&endpoints.authorization, request),
        open_browser,
    )
    .await?;
    grant(
        &endpoints.token,
        &[
            ("client_id", CLIENT_ID),
            ("grant_type", "authorization_code"),
            ("code", &authorization.code),
            ("code_verifier", &authorization.verifier),
            ("redirect_uri", &authorization.redirect_uri),
        ],
        None,
    )
    .await
}

// -------------------------------------------------------------- token store

/// Whether a connect can get a token without opening a browser.
///
/// This is what tells an auto-reconnect to stop rather than retry. A dropped
/// connection is worth another go, a sign-in the server will not take is not.
pub async fn signed_in(server_id: &str, username: &str) -> Result<bool, AuthError> {
    coilbox_oauth::signed_in(server_id, username).await
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
    coilbox_oauth::remember(server_id, username, tokens).await
}

/// Forget an account here: the stored refresh token and any access token in
/// memory.
///
/// Here is as far as it goes. Teiserver implements no RFC 7009 revocation endpoint
/// and advertises none in its metadata, so the refresh token stays valid on the
/// server for its full hundred years. Signing out means this machine can no longer
/// use it, not that it has stopped working.
///
/// The keychain delete has a deadline, so this always answers (issue #1469). A
/// delete that ran out of time reports itself as one: the account is unusable
/// here from now on, and whether the stored copy went with it is not known.
pub async fn sign_out(server_id: &str, username: &str) -> Result<(), AuthError> {
    coilbox_oauth::forget(server_id, username).await
}

/// An access token good for the next minute at least, refreshed from the stored
/// refresh token if the one in memory is spent or missing.
///
/// This is what `mp_connect_tachyon` calls for the bearer token on the upgrade,
/// on the first connect and on every reconnect after it. The browser is never
/// opened from here: a stored refresh token is all a reconnect needs, and an
/// account that has none is told to sign in rather than sent to the browser
/// behind the user's back.
pub async fn access_token(
    base_url: &str,
    server_id: &str,
    username: &str,
) -> Result<String, AuthError> {
    let base_url = base_url.to_owned();
    coilbox_oauth::access_token(server_id, username, |stored| async move {
        let endpoints = discover(&base_url).await?;
        refresh(&endpoints.token, &stored).await
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use coilbox_oauth::challenge_for;
    use std::sync::Arc;
    use tokio::io::{AsyncReadExt as _, AsyncWriteExt as _};
    use tokio::net::{TcpListener, TcpStream};

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

    // ----------------------------------------------------------------- tokens

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

    /// The refusal a dead refresh token gets. Teiserver answers every refresh
    /// failure with an HTTP 400 and `invalid_request`, whatever the cause, so a
    /// revoked token and a banned account look the same from here. What matters
    /// is that neither is worth trying again.
    #[tokio::test]
    async fn a_refused_refresh_ends_in_signing_in_again_rather_than_another_try() {
        let shared = Shared::default();
        shared.lock().unwrap().token_error = Some("invalid_request");
        let base = start(shared.clone()).await;
        let endpoints = discover(&base).await.unwrap();
        let err = refresh(&endpoints.token, "a-revoked-refresh-token")
            .await
            .unwrap_err();
        assert!(err.needs_sign_in(), "{err:?}");
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
