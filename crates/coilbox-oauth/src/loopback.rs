//! The loopback listener the browser is redirected back to, per RFC 8252.

use std::collections::HashMap;
use std::time::Duration;

use tokio::io::{AsyncReadExt as _, AsyncWriteExt as _};
use tokio::net::{TcpListener, TcpStream};
use url::Url;

use crate::AuthError;

/// Path the browser is redirected back to, shared by every service.
///
/// Tachyon's generic client registers `http://localhost/oauth2callback` with no
/// port, and Teiserver skips the port comparison when both sides are loopback, so
/// an ephemeral port matches. Supabase allows any path under `http://127.0.0.1:*`,
/// so it takes this one too rather than needing one of its own.
pub const CALLBACK_PATH: &str = "/oauth2callback";

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

/// A bound loopback socket waiting for the browser to come back to it.
///
/// Bound before the browser opens, so the redirect URI in the authorization
/// request names a port that is already listening.
pub struct Loopback {
    listener: TcpListener,
    redirect_uri: String,
}

impl Loopback {
    /// Bind an ephemeral port on the loopback interface.
    pub async fn bind() -> Result<Self, AuthError> {
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .map_err(|e| AuthError::Listener(e.to_string()))?;
        let port = listener
            .local_addr()
            .map_err(|e| AuthError::Listener(e.to_string()))?
            .port();
        Ok(Self {
            listener,
            redirect_uri: format!("http://127.0.0.1:{port}{CALLBACK_PATH}"),
        })
    }

    /// The address to send the authorization server's redirect to.
    pub fn redirect_uri(&self) -> &str {
        &self.redirect_uri
    }

    /// Wait for the browser to arrive at the callback and return the authorization
    /// code.
    ///
    /// It answers every request it receives, because a browser left on an
    /// unanswered socket shows an error page rather than the one we wrote, but only
    /// a request to [`CALLBACK_PATH`] ends the wait.
    ///
    /// A callback carrying the wrong `state` is refused rather than ignored.
    /// Ignoring it would leave the real browser able to finish, but it would also
    /// mean a process on this machine could keep guessing without us ever noticing.
    pub async fn wait_for_code(self, state: &str, timeout: Duration) -> Result<String, AuthError> {
        let listener = self.listener;
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
                // The target is a path, so it needs any origin to parse as a URL.
                // Ours is the one it arrived on.
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
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn the_listener_gives_up_rather_than_waiting_for_a_browser_that_never_comes() {
        let loopback = Loopback::bind().await.unwrap();
        let err = loopback
            .wait_for_code("some-state", Duration::from_millis(50))
            .await
            .unwrap_err();
        assert!(matches!(err, AuthError::TimedOut), "{err:?}");
    }

    #[tokio::test]
    async fn the_redirect_uri_names_the_port_that_is_already_listening() {
        let loopback = Loopback::bind().await.unwrap();
        let uri = loopback.redirect_uri().to_owned();
        assert!(uri.starts_with("http://127.0.0.1:"), "{uri}");
        assert!(uri.ends_with(CALLBACK_PATH), "{uri}");
        // The port is bound, so connecting to it succeeds while the listener lives.
        let parsed = Url::parse(&uri).unwrap();
        assert!(
            tokio::net::TcpStream::connect(("127.0.0.1", parsed.port().unwrap()))
                .await
                .is_ok()
        );
    }
}
