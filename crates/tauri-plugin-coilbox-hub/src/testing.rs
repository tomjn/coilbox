//! A stand-in hub, for the tests in this crate.
//!
//! The same shape as `TokenServer` in `coilbox-oauth`: a socket bound before the
//! caller makes its request, one request per connection, and what it saw kept
//! where a test can assert on it. It exists so the have check can be tested
//! end to end over real HTTP without a sign-in, since a keychain prompt in a test
//! run is a test that hangs.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use serde_json::Value;
use tokio::io::{AsyncReadExt as _, AsyncWriteExt as _};
use tokio::net::TcpListener;

use crate::have::AssetIdentity;

/// What the requests carried, so a test can assert on how they were encoded and
/// on how many there were.
#[derive(Default)]
struct Seen {
    headers: String,
    body: String,
    requests: usize,
    /// How many keys each request carried, in order, which is what a batching
    /// assertion is about.
    batch_sizes: Vec<usize>,
}

/// How the server decides what to answer.
enum Answering {
    /// Answer the have check properly, from what it holds: identity to the
    /// `source_hash` it has for it. Absent is `missing`, equal is `have`, and
    /// different is `changed`, which is the hub's own `resolveStatus`.
    Holding(HashMap<String, String>),
    /// Answer this, whatever was asked. For the shapes a real hub only produces
    /// when something is wrong.
    Canned { status: u16, body: String },
}

pub struct HaveServer {
    url: String,
    seen: Arc<Mutex<Seen>>,
}

impl HaveServer {
    /// A hub holding these source hashes and nothing else.
    pub fn holding(rows: &[(AssetIdentity, &str)]) -> Self {
        let held = rows
            .iter()
            .map(|(identity, source_hash)| (identity_key(identity), (*source_hash).to_owned()))
            .collect();
        Self::start(Answering::Holding(held))
    }

    /// A hub answering this status and body to anything.
    pub fn answering(status: u16, body: Value) -> Self {
        Self::start(Answering::Canned {
            status,
            body: body.to_string(),
        })
    }

    fn start(answering: Answering) -> Self {
        let seen = Arc::new(Mutex::new(Seen::default()));
        let recorded = seen.clone();
        // Bound here rather than in the task, so the port is known before the
        // caller makes its request.
        let bound = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        bound.set_nonblocking(true).unwrap();
        let port = bound.local_addr().unwrap().port();
        tokio::spawn(async move {
            let listener = TcpListener::from_std(bound).unwrap();
            while let Ok((mut sock, _)) = listener.accept().await {
                let Some((head, body)) = read_request(&mut sock).await else {
                    continue;
                };
                let keys = keys_of(&body);
                {
                    let mut seen = recorded.lock().unwrap();
                    seen.requests += 1;
                    seen.batch_sizes.push(keys.len());
                    seen.headers = head;
                    seen.body = body;
                }
                let (status, answer) = match &answering {
                    Answering::Holding(held) => (200, answer_from(&keys, held)),
                    Answering::Canned { status, body } => (*status, body.clone()),
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
            url: format!("http://127.0.0.1:{port}/api/v1/assets/have"),
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

    pub fn requests(&self) -> usize {
        self.seen.lock().unwrap().requests
    }

    pub fn batch_sizes(&self) -> Vec<usize> {
        self.seen.lock().unwrap().batch_sizes.clone()
    }
}

/// One request off the socket: its head, lowercased, and its body.
async fn read_request(sock: &mut tokio::net::TcpStream) -> Option<(String, String)> {
    let mut buf = Vec::new();
    let mut chunk = [0u8; 4096];
    let head_end = loop {
        match sock.read(&mut chunk).await {
            Ok(0) | Err(_) => return None,
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
    Some((head, String::from_utf8_lossy(&buf[head_end..]).into_owned()))
}

/// The keys a request body carried, as they were sent.
fn keys_of(body: &str) -> Vec<Value> {
    serde_json::from_str::<Value>(body)
        .ok()
        .and_then(|v| v.get("keys").and_then(Value::as_array).cloned())
        .unwrap_or_default()
}

/// The answer to a batch, echoing each key with its status, in request order.
fn answer_from(keys: &[Value], held: &HashMap<String, String>) -> String {
    let results: Vec<Value> = keys
        .iter()
        .map(|key| {
            let sent = key.get("source_hash").and_then(Value::as_str).unwrap_or("");
            let status = match held.get(&identity_key_of(key)) {
                None => "missing",
                Some(stored) if stored == sent => "have",
                Some(_) => "changed",
            };
            let mut echoed = key.clone();
            let object = echoed.as_object_mut().expect("a key is an object");
            object.remove("source_hash");
            object.insert("status".into(), Value::String(status.into()));
            echoed
        })
        .collect();
    serde_json::json!({
        "format": "coilbox-hub-asset-have",
        "version": 1,
        "results": results,
    })
    .to_string()
}

/// The hub's `identityKey`: the two shapes flattened into one lookup string
/// without either becoming able to collide with the other.
fn identity_key(identity: &AssetIdentity) -> String {
    match identity {
        AssetIdentity::Unit {
            game,
            unit_name,
            variant,
        } => format!("unit\u{0}{game}\u{0}{unit_name}\u{0}{variant}"),
        AssetIdentity::Map { map_name, variant } => format!("map\u{0}{map_name}\u{0}{variant}"),
    }
}

fn identity_key_of(key: &Value) -> String {
    let field = |name: &str| {
        key.get(name)
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_owned()
    };
    match key.get("keyed_on").and_then(Value::as_str) {
        Some("unit") => format!(
            "unit\u{0}{}\u{0}{}\u{0}{}",
            field("game"),
            field("unit_name"),
            field("variant")
        ),
        _ => format!("map\u{0}{}\u{0}{}", field("map_name"), field("variant")),
    }
}
