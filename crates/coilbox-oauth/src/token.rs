//! The token request, and the pair of secrets it comes back with.

use std::time::{Duration, Instant};

use serde_json::Value;

use crate::AuthError;

/// Budget for a single request to the service, discovery or token.
pub const HTTP_TIMEOUT: Duration = Duration::from_secs(30);

/// What to assume when the answer does not say how long the access token lasts.
/// The shortest sensible assumption rather than an unbounded one.
const DEFAULT_EXPIRES_IN: u64 = 300;

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

/// How a service wants its token request encoded. RFC 6749 made form encoding
/// explicit, and GoTrue takes JSON instead, so both are here rather than one being
/// assumed.
pub enum TokenBody {
    Form(Vec<(String, String)>),
    Json(Value),
}

/// One request to a token endpoint.
pub struct TokenRequest<'a> {
    pub endpoint: &'a str,
    pub body: TokenBody,
    /// Headers the service needs on top of the content type, such as Supabase's
    /// `apikey`. Empty for a service that needs none.
    pub headers: Vec<(&'a str, String)>,
    /// The refresh token to keep when the answer carries none, which RFC 6749
    /// allows a server that rotates nothing to do.
    pub previous_refresh: Option<&'a str>,
}

/// What a token endpoint answered. `Debug` is safe to print: [`Tokens`] redacts
/// itself and `extra` has had both secrets taken out of it.
#[derive(Debug)]
pub struct TokenResponse {
    pub tokens: Tokens,
    /// Everything else the answer carried, with both tokens removed, so a service
    /// can read the fields only it knows about (GoTrue returns the signed-in user
    /// here) without anything downstream being able to print a secret out of it.
    pub extra: Value,
}

/// POST to the token endpoint and read the tokens out of the answer.
pub async fn post_token(request: TokenRequest<'_>) -> Result<TokenResponse, AuthError> {
    let client = reqwest::Client::builder()
        .timeout(HTTP_TIMEOUT)
        .build()
        .map_err(|e| AuthError::Http(e.to_string()))?;
    let mut post = client.post(request.endpoint);
    for (name, value) in &request.headers {
        post = post.header(*name, value);
    }
    post = match &request.body {
        TokenBody::Form(pairs) => post.form(pairs),
        TokenBody::Json(value) => post
            .header(reqwest::header::CONTENT_TYPE, "application/json")
            .body(value.to_string()),
    };

    let sent_at = Instant::now();
    let resp = post
        .send()
        .await
        .map_err(|e| AuthError::Http(e.to_string()))?;
    let status = resp.status();
    let body = resp
        .text()
        .await
        .map_err(|e| AuthError::Http(e.to_string()))?;
    let mut doc: Value = serde_json::from_str(&body).unwrap_or(Value::Null);

    // A 5xx is the service failing on its own side, not our request being wrong.
    // Checked before the error body, because reading it as a refusal would send
    // the user back to the browser over a fault that clears itself.
    if status.is_server_error() {
        return Err(AuthError::Http(format!(
            "the token endpoint answered HTTP {}",
            status.as_u16()
        )));
    }

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

    let take = |doc: &mut Value, name: &str| -> Option<String> {
        doc.get_mut(name)
            .map(Value::take)
            .and_then(|v| match v {
                Value::String(s) => Some(s),
                _ => None,
            })
            .filter(|s| !s.is_empty())
    };
    let access = take(&mut doc, "access_token").ok_or_else(|| AuthError::Token {
        error: "invalid_response".into(),
        description: Some("no access_token".into()),
    })?;
    let refresh = take(&mut doc, "refresh_token")
        .or_else(|| request.previous_refresh.map(str::to_owned))
        .ok_or_else(|| AuthError::Token {
            error: "invalid_response".into(),
            description: Some("no refresh_token".into()),
        })?;
    let expires_in = doc
        .get("expires_in")
        .and_then(Value::as_u64)
        .unwrap_or(DEFAULT_EXPIRES_IN);

    // `take` left nulls where the two secrets were. Drop the keys so `extra` cannot
    // be mistaken for an answer that had no tokens in it.
    if let Some(object) = doc.as_object_mut() {
        object.remove("access_token");
        object.remove("refresh_token");
    }

    Ok(TokenResponse {
        tokens: Tokens {
            access,
            refresh,
            expires_at: sent_at + Duration::from_secs(expires_in),
        },
        extra: doc,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testing::TokenServer;
    use serde_json::json;

    #[tokio::test]
    async fn a_form_grant_is_posted_and_its_tokens_read_back() {
        let server = TokenServer::answering(json!({
            "access_token": "an-access-token",
            "refresh_token": "a-refresh-token",
            "expires_in": 1800,
        }));
        let answer = post_token(TokenRequest {
            endpoint: &server.url(),
            body: TokenBody::Form(vec![
                ("grant_type".into(), "refresh_token".into()),
                ("refresh_token".into(), "the-stored-one".into()),
            ]),
            headers: vec![],
            previous_refresh: None,
        })
        .await
        .unwrap();
        assert_eq!(answer.tokens.access, "an-access-token");
        assert_eq!(answer.tokens.refresh, "a-refresh-token");
        assert_eq!(
            server.last_body(),
            "grant_type=refresh_token&refresh_token=the-stored-one"
        );
        assert!(server
            .last_headers()
            .contains("content-type: application/x-www-form-urlencoded"));
    }

    #[tokio::test]
    async fn a_json_grant_carries_the_headers_the_service_asked_for() {
        let server = TokenServer::answering(json!({
            "access_token": "an-access-token",
            "refresh_token": "a-refresh-token",
        }));
        post_token(TokenRequest {
            endpoint: &server.url(),
            body: TokenBody::Json(json!({ "auth_code": "a-code" })),
            headers: vec![("apikey", "a-publishable-key".into())],
            previous_refresh: None,
        })
        .await
        .unwrap();
        assert_eq!(server.last_body(), "{\"auth_code\":\"a-code\"}");
        let headers = server.last_headers();
        assert!(headers.contains("apikey: a-publishable-key"), "{headers}");
        assert!(
            headers.contains("content-type: application/json"),
            "{headers}"
        );
    }

    /// Teiserver does not rotate refresh tokens, so a refresh answer carries no
    /// `refresh_token` field. Losing the stored one there would sign the user out
    /// every thirty minutes.
    #[tokio::test]
    async fn the_stored_refresh_token_is_kept_when_the_answer_returns_none() {
        let server = TokenServer::answering(json!({ "access_token": "an-access-token" }));
        let answer = post_token(TokenRequest {
            endpoint: &server.url(),
            body: TokenBody::Form(vec![]),
            headers: vec![],
            previous_refresh: Some("the-stored-one"),
        })
        .await
        .unwrap();
        assert_eq!(answer.tokens.refresh, "the-stored-one");
    }

    /// What the hub reads its signed-in user out of, and the reason the two
    /// secrets are taken out of it first.
    #[tokio::test]
    async fn everything_but_the_two_secrets_is_handed_back_as_extra() {
        let server = TokenServer::answering(json!({
            "access_token": "an-access-token",
            "refresh_token": "a-refresh-token",
            "token_type": "bearer",
            "user": { "id": "a-user-id" },
        }));
        let answer = post_token(TokenRequest {
            endpoint: &server.url(),
            body: TokenBody::Form(vec![]),
            headers: vec![],
            previous_refresh: None,
        })
        .await
        .unwrap();
        assert_eq!(answer.extra["user"]["id"], "a-user-id");
        assert_eq!(answer.extra["token_type"], "bearer");
        let printed = answer.extra.to_string();
        assert!(!printed.contains("an-access-token"), "{printed}");
        assert!(!printed.contains("a-refresh-token"), "{printed}");
    }

    #[tokio::test]
    async fn an_oauth_error_is_surfaced_with_its_description() {
        let server = TokenServer::refusing(json!({
            "error": "invalid_grant",
            "error_description": "the stand-in server said no",
        }));
        let err = post_token(TokenRequest {
            endpoint: &server.url(),
            body: TokenBody::Form(vec![]),
            headers: vec![],
            previous_refresh: None,
        })
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

    /// The other half of that. A service failing on its own side says nothing
    /// about the sign-in, so reading it as a refusal would send the user to the
    /// browser over a fault that clears itself.
    #[tokio::test]
    async fn a_server_fault_leaves_the_sign_in_alone() {
        let server = TokenServer::faulting();
        let err = post_token(TokenRequest {
            endpoint: &server.url(),
            body: TokenBody::Form(vec![]),
            headers: vec![],
            previous_refresh: None,
        })
        .await
        .unwrap_err();
        assert!(
            matches!(&err, AuthError::Http(m) if m.contains("500")),
            "{err:?}"
        );
        assert!(!err.needs_sign_in(), "{err:?}");
    }

    /// So does a service nobody can reach, which is the ordinary case a reconnect
    /// loop exists for.
    #[tokio::test]
    async fn a_token_endpoint_that_answers_nothing_leaves_the_sign_in_alone() {
        // Bind and drop a listener, so the port is one nothing is listening on.
        let dead = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = dead.local_addr().unwrap().port();
        drop(dead);
        let err = post_token(TokenRequest {
            endpoint: &format!("http://127.0.0.1:{port}/token"),
            body: TokenBody::Form(vec![]),
            headers: vec![],
            previous_refresh: None,
        })
        .await
        .unwrap_err();
        assert!(matches!(err, AuthError::Http(_)), "{err:?}");
        assert!(!err.needs_sign_in(), "{err:?}");
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
}
