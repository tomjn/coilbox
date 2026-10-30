//! A stand-in token endpoint, for the tests in this crate.

use std::sync::{Arc, Mutex};

use serde_json::Value;
use tokio::io::{AsyncReadExt as _, AsyncWriteExt as _};
use tokio::net::TcpListener;

/// What the last request carried, so a test can assert on how it was encoded, and
/// how many there have been, so a test can assert on how often it was sent.
#[derive(Default)]
struct Seen {
    headers: String,
    body: String,
    requests: usize,
}

/// A one-endpoint HTTP server that answers every POST the same way.
pub struct TokenServer {
    url: String,
    seen: Arc<Mutex<Seen>>,
}

impl TokenServer {
    /// Answer 200 with `answer`.
    pub fn answering(answer: Value) -> Self {
        Self::start("200 OK", answer.to_string())
    }

    /// Answer 400 with `answer`, the way an OAuth refusal comes back.
    pub fn refusing(answer: Value) -> Self {
        Self::start("400 Bad Request", answer.to_string())
    }

    /// Fail on the server's own side.
    pub fn faulting() -> Self {
        Self::start("500 Internal Server Error", "{}".into())
    }

    fn start(status: &'static str, answer: String) -> Self {
        let seen = Arc::new(Mutex::new(Seen::default()));
        let recorded = seen.clone();
        // Bound here rather than in the task, so the port is known before the
        // caller makes its request and a single-threaded test runtime cannot
        // deadlock waiting for a task it has not polled yet.
        let bound = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        bound.set_nonblocking(true).unwrap();
        let port = bound.local_addr().unwrap().port();
        tokio::spawn(async move {
            let listener = TcpListener::from_std(bound).unwrap();
            while let Ok((mut sock, _)) = listener.accept().await {
                let mut buf = Vec::new();
                let mut chunk = [0u8; 1024];
                // Only a `POST` to the token route counts as a request. Other
                // programs on a developer machine probe new local ports with a
                // `GET /` or a TLS `ClientHello`, and a stand-in that counted or
                // waited on those would fail every assertion on a request count.
                // The bytes are checked as they arrive, so a probe that waits for
                // a reply is let go at once and does not hold up the requests
                // behind it.
                const ROUTE: &[u8] = b"post /token";
                let head_end = loop {
                    match sock.read(&mut chunk).await {
                        Ok(0) | Err(_) => break None,
                        Ok(n) => buf.extend_from_slice(&chunk[..n]),
                    }
                    let seen = buf.len().min(ROUTE.len());
                    if !buf[..seen].eq_ignore_ascii_case(&ROUTE[..seen]) {
                        break None;
                    }
                    if let Some(p) = buf.windows(4).position(|w| w == b"\r\n\r\n") {
                        break Some(p + 4);
                    }
                };
                let Some(head_end) = head_end else {
                    continue;
                };
                let head = String::from_utf8_lossy(&buf[..head_end]).to_ascii_lowercase();
                let len: usize = head
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
                {
                    let mut seen = recorded.lock().unwrap();
                    *seen = Seen {
                        headers: head,
                        body: String::from_utf8_lossy(&buf[head_end..]).into_owned(),
                        requests: seen.requests + 1,
                    };
                }
                let response = format!(
                    "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{answer}",
                    answer.len()
                );
                let _ = sock.write_all(response.as_bytes()).await;
                let _ = sock.flush().await;
            }
        });
        Self {
            url: format!("http://127.0.0.1:{port}/token"),
            seen,
        }
    }

    pub fn url(&self) -> String {
        self.url.clone()
    }

    /// The request headers of the last request, lowercased.
    pub fn last_headers(&self) -> String {
        self.seen.lock().unwrap().headers.clone()
    }

    pub fn last_body(&self) -> String {
        self.seen.lock().unwrap().body.clone()
    }

    /// How many requests have been answered. What a test asserts on when the
    /// property is a count rather than a result, such as one refresh however many
    /// callers asked for a token.
    pub fn requests(&self) -> usize {
        self.seen.lock().unwrap().requests
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Send `bytes` to the stand-in and read until it lets go, so what it did
    /// with them is settled when this returns.
    async fn send_and_read_to_end(server: &TokenServer, bytes: &[u8]) -> Vec<u8> {
        let address = server
            .url()
            .strip_prefix("http://")
            .and_then(|rest| rest.split('/').next().map(str::to_owned))
            .unwrap();
        let mut sock = tokio::net::TcpStream::connect(address).await.unwrap();
        sock.write_all(bytes).await.unwrap();
        let mut answer = Vec::new();
        let _ = sock.read_to_end(&mut answer).await;
        answer
    }

    /// Other programs on a developer machine probe new local ports with a
    /// `GET /` and a TLS `ClientHello`. Neither is a request to the token route,
    /// and the request behind them must still be answered and counted once.
    #[tokio::test]
    async fn connections_that_are_not_a_token_request_are_let_go_and_not_counted() {
        let server = TokenServer::answering(serde_json::json!({ "access_token": "a" }));

        let get = send_and_read_to_end(&server, b"GET / HTTP/1.1\r\nhost: localhost\r\n\r\n").await;
        assert!(get.is_empty(), "a stray GET was answered");
        let hello = send_and_read_to_end(&server, &[0x16, 0x03, 0x01, 0x05, 0xc8, 0x01]).await;
        assert!(hello.is_empty(), "a TLS probe was answered");
        assert_eq!(server.requests(), 0);

        let real = send_and_read_to_end(
            &server,
            b"POST /token HTTP/1.1\r\nhost: localhost\r\ncontent-length: 3\r\n\r\nabc",
        )
        .await;
        assert!(String::from_utf8_lossy(&real).starts_with("HTTP/1.1 200"));
        assert_eq!(server.requests(), 1);
        assert_eq!(server.last_body(), "abc");
    }
}
