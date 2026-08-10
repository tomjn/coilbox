//! Signing in to a service through the system browser.
//!
//! Neither service coilbox signs in to has a password grant or a device code flow,
//! so the only interactive sign-in is OAuth 2.0 authorization code with PKCE and a
//! loopback redirect, as profiled by RFC 8252 for native apps. This crate owns that
//! flow and nothing above it: it runs the browser handoff, posts the token request,
//! and keeps the refresh token in the OS keychain.
//!
//! What is here is what both services do the same way. What each does differently
//! stays with the service: how it describes its endpoints, what goes on the
//! authorization URL, and what the token request looks like. Today that is
//! `tachyon_auth` in the multiplayer plugin and `auth` in the hub plugin.
//!
//! Four rules shape the code.
//!
//! Nothing about a service is hardcoded here. Every endpoint arrives as an argument
//! from whatever the service's own discovery returned.
//!
//! The loopback listener is the soft spot in this flow, because any process on the
//! machine can post to it. So [`authorize`] sends a random `state` and refuses a
//! callback that does not carry the same value back.
//!
//! The browser is only ever handed a URL on the origin the caller names. A
//! discovery document that pointed the authorization endpoint somewhere else would
//! otherwise send the user's credentials to that somewhere else.
//!
//! Nothing here logs a token, an authorization code or a PKCE verifier, and none of
//! the three crosses the Tauri IPC boundary. [`Tokens`] redacts itself when printed
//! so a stray `{:?}` cannot leak one either.

mod account;
mod error;
mod loopback;
mod pkce;
#[cfg(test)]
mod testing;
mod token;

use std::time::Duration;

use url::Url;

pub use account::{access_token, forget, remember, signed_in, REFRESH_MARGIN};
pub use error::AuthError;
pub use loopback::CALLBACK_PATH;
pub use pkce::{challenge_for, random_token, Pkce};
pub use token::{post_token, TokenBody, TokenRequest, TokenResponse, Tokens, HTTP_TIMEOUT};

use loopback::Loopback;

/// How long the loopback listener waits for the browser before giving up. The
/// Tachyon reference client uses a minute, and an abandoned sign-in must not leave
/// a listener bound for the rest of the session.
pub const CALLBACK_TIMEOUT: Duration = Duration::from_secs(60);

/// The three things a service has to put on its authorization URL, handed to it
/// once the loopback listener is bound.
pub struct AuthRequest {
    /// The public half of the PKCE pair, for `code_challenge`.
    pub challenge: String,
    /// The value the callback has to carry back.
    pub state: String,
    /// Where the browser is sent when it is done.
    pub redirect_uri: String,
}

/// A finished browser handoff, ready to be traded for tokens.
///
/// `Debug` prints placeholders for the code and the verifier, the same reason
/// [`Tokens`] does: the two together are a sign-in anybody could finish.
pub struct Authorization {
    pub code: String,
    pub verifier: String,
    /// The same URI the authorization request carried, which a token endpoint may
    /// insist on seeing again.
    pub redirect_uri: String,
}

impl std::fmt::Debug for Authorization {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Authorization")
            .field("code", &"<redacted>")
            .field("verifier", &"<redacted>")
            .field("redirect_uri", &self.redirect_uri)
            .finish()
    }
}

/// Whether two URLs share a scheme, host and port.
fn same_origin(a: &Url, b: &Url) -> bool {
    a.scheme() == b.scheme()
        && a.host() == b.host()
        && a.port_or_known_default() == b.port_or_known_default()
}

/// Run the browser half of the sign-in and come back with an authorization code.
///
/// `origin` is the address the authorization URL must be on, `build_url` turns the
/// PKCE challenge, the state and the redirect URI into the service's own
/// authorization URL, and `open_browser` is a parameter rather than a call to the
/// opener plugin so tests can play the part of the browser.
pub async fn authorize<B, O>(
    origin: &str,
    build_url: B,
    open_browser: O,
) -> Result<Authorization, AuthError>
where
    B: FnOnce(&AuthRequest) -> Result<Url, AuthError>,
    O: FnOnce(&str) -> Result<(), String>,
{
    // Bind before the browser opens, so the redirect URI in the authorization
    // request names a port that is already listening.
    let loopback = Loopback::bind().await?;
    let pkce = Pkce::generate()?;
    let request = AuthRequest {
        challenge: pkce.challenge().to_owned(),
        state: random_token(16)?,
        redirect_uri: loopback.redirect_uri().to_owned(),
    };
    let url = build_url(&request)?;

    // The guard the Tachyon reference client uses, with teeth. Checking the URL we
    // built against the endpoint we built it from proves little on its own, so the
    // origin both must be on is the service's own. A discovery document that named
    // an authorization endpoint elsewhere would otherwise put the user's password
    // into a sign-in page of somebody else's choosing.
    let expected = Url::parse(origin)
        .map_err(|e| AuthError::Discovery(format!("{origin} is not a URL: {e}")))?;
    if !same_origin(&url, &expected) {
        return Err(AuthError::Browser(format!(
            "refusing to open {}, which is not on {}",
            url.origin().ascii_serialization(),
            expected.origin().ascii_serialization()
        )));
    }
    open_browser(url.as_str()).map_err(AuthError::Browser)?;

    let code = loopback
        .wait_for_code(&request.state, CALLBACK_TIMEOUT)
        .await?;
    Ok(Authorization {
        code,
        verifier: pkce.verifier().to_owned(),
        redirect_uri: request.redirect_uri,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    /// A browser stand-in. It hits the loopback callback with whatever `reply`
    /// builds from the state it saw in the authorization URL.
    fn browser(reply: fn(&str) -> String) -> impl FnOnce(&str) -> Result<(), String> {
        move |url: &str| {
            let parsed = Url::parse(url).unwrap();
            let query: HashMap<String, String> = parsed.query_pairs().into_owned().collect();
            let redirect = query.get("redirect_uri").cloned().unwrap();
            let state = query.get("state").cloned().unwrap();
            let target = format!("{redirect}?{}", reply(&state));
            tokio::spawn(async move {
                let _ = reqwest::get(&target).await;
            });
            Ok(())
        }
    }

    /// The URL a service under test would build. It puts the redirect URI and the
    /// state on the query, which is what the browser stand-in reads them from.
    fn build(origin: &str) -> impl FnOnce(&AuthRequest) -> Result<Url, AuthError> + '_ {
        move |request: &AuthRequest| {
            let mut url = Url::parse(&format!("{origin}/authorize")).unwrap();
            url.query_pairs_mut()
                .append_pair("code_challenge", &request.challenge)
                .append_pair("state", &request.state)
                .append_pair("redirect_uri", &request.redirect_uri);
            Ok(url)
        }
    }

    #[tokio::test]
    async fn a_finished_handoff_carries_the_code_and_the_verifier_that_unlocks_it() {
        let origin = "http://127.0.0.1:9";
        let authorization = authorize(
            origin,
            build(origin),
            browser(|state| format!("code=an-authorization-code&state={state}")),
        )
        .await
        .unwrap();
        assert_eq!(authorization.code, "an-authorization-code");
        assert_eq!(authorization.verifier.len(), 43);
        assert!(authorization.redirect_uri.ends_with(CALLBACK_PATH));
        assert!(!format!("{authorization:?}").contains(&authorization.verifier));
    }

    #[tokio::test]
    async fn a_callback_carrying_someone_else_s_state_is_refused() {
        let origin = "http://127.0.0.1:9";
        let err = authorize(
            origin,
            build(origin),
            browser(|_state| "code=a-code-from-nowhere&state=not-the-state-we-sent".into()),
        )
        .await
        .unwrap_err();
        assert!(matches!(err, AuthError::StateMismatch), "{err:?}");
    }

    #[tokio::test]
    async fn an_error_redirect_is_surfaced_rather_than_waited_out() {
        let origin = "http://127.0.0.1:9";
        let err = authorize(
            origin,
            build(origin),
            browser(|state| {
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
    async fn the_browser_is_never_sent_off_the_origin_the_caller_named() {
        let err = authorize(
            "http://127.0.0.1:9",
            build("https://not-the-service.example"),
            |_url| panic!("the browser must not be opened"),
        )
        .await
        .unwrap_err();
        assert!(matches!(err, AuthError::Browser(_)), "{err:?}");
    }
}
