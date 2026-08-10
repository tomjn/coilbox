//! A stand-in token endpoint, for the tests in this crate.

use std::sync::{Arc, Mutex};

use serde_json::Value;
use tokio::io::{AsyncReadExt as _, AsyncWriteExt as _};
use tokio::net::TcpListener;

/// What the last request carried, so a test can assert on how it was encoded.
#[derive(Default)]
struct Seen {
    headers: String,
    body: String,
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
                let head_end = loop {
                    match sock.read(&mut chunk).await {
                        Ok(0) | Err(_) => return,
                        Ok(n) => buf.extend_from_slice(&chunk[..n]),
                    }
                    if let Some(p) = buf.windows(4).position(|w| w == b"\r\n\r\n") {
                        break p + 4;
                    }
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
                *recorded.lock().unwrap() = Seen {
                    headers: head,
                    body: String::from_utf8_lossy(&buf[head_end..]).into_owned(),
                };
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
}
