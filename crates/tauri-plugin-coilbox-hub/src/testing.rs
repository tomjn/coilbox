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
        Self::start(Answering::Holding(held_from(rows)))
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
    let (head, body) = read_raw(sock).await?;
    Some((head, String::from_utf8_lossy(&body).into_owned()))
}

/// The same, with the body left as bytes, which is what a multipart body is.
async fn read_raw(sock: &mut tokio::net::TcpStream) -> Option<(String, Vec<u8>)> {
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
    Some((head, buf.split_off(head_end)))
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

// ------------------------------------------------------------------- uploads

/// One upload as it came off the wire, taken apart the way `request.formData()`
/// would. Nothing here is reconstructed from what the client meant to send.
#[derive(Debug, Clone)]
pub struct SeenUpload {
    /// The request headers, lowercased.
    pub headers: String,
    /// The whole body exactly as it arrived, and the `Content-Type` that frames
    /// it. Together they are a request the hub's own route can be replayed against,
    /// which is what stops this stand-in and the client imitating each other.
    pub raw: Vec<u8>,
    pub content_type: String,
    /// The `asset` part, parsed. A part with no filename is a string entry, which
    /// is what the route requires of this one.
    pub declaration: Value,
    /// The `asset` part exactly as it was sent, for feeding to the hub's own
    /// parser.
    pub declaration_json: String,
    /// The `file` part's bytes, its filename and its declared type. The route
    /// requires a filename, because a part without one arrives as a string rather
    /// than as the `Blob` it asks for.
    pub file: Vec<u8>,
    pub file_name: String,
    pub file_type: String,
}

/// How the stand-in answers an upload.
enum Uploads {
    /// The route's own answer: 201 for an identity it has not seen in this run,
    /// 200 for one it has, which is the hub's created-or-replaced distinction.
    Accepting,
    /// Answer this to every upload, for the shapes a real hub only produces when
    /// something is wrong.
    Canned { status: u16, body: String },
    /// Read the request and never answer, so a cancellation has something to
    /// interrupt.
    Hanging,
}

/// A stand-in hub answering both routes an upload run uses, on one address, so a
/// test can assert on the order they were called in and on how many of each there
/// were.
pub struct HubServer {
    base: String,
    seen: Arc<Mutex<HubSeen>>,
}

#[derive(Default)]
struct HubSeen {
    have_requests: usize,
    uploads: Vec<SeenUpload>,
}

impl HubServer {
    /// A hub holding these source hashes, taking any upload.
    pub fn holding(rows: &[(AssetIdentity, &str)]) -> Self {
        Self::start(held_from(rows), Uploads::Accepting)
    }

    /// A hub that wants everything and refuses every upload with this answer.
    pub fn refusing(status: u16, body: Value) -> Self {
        Self::start(
            HashMap::new(),
            Uploads::Canned {
                status,
                body: body.to_string(),
            },
        )
    }

    /// A hub that wants everything and never finishes an upload.
    pub fn hanging() -> Self {
        Self::start(HashMap::new(), Uploads::Hanging)
    }

    fn start(held: HashMap<String, String>, uploads: Uploads) -> Self {
        let seen = Arc::new(Mutex::new(HubSeen::default()));
        let recorded = seen.clone();
        let bound = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        bound.set_nonblocking(true).unwrap();
        let port = bound.local_addr().unwrap().port();
        tokio::spawn(async move {
            let listener = TcpListener::from_std(bound).unwrap();
            // Identities this run has already taken, which is what turns the
            // second upload of one picture into the hub's 200.
            let mut stored: HashMap<String, ()> = HashMap::new();
            while let Ok((mut sock, _)) = listener.accept().await {
                let Some((head, body)) = read_raw(&mut sock).await else {
                    continue;
                };
                let (status, answer) = if head.starts_with("post /api/v1/assets/have") {
                    let keys = keys_of(&String::from_utf8_lossy(&body));
                    recorded.lock().unwrap().have_requests += 1;
                    (200, answer_from(&keys, &held))
                } else {
                    let Some(upload) = parse_multipart(&head, &body) else {
                        continue;
                    };
                    let key = identity_key_of(&upload.declaration);
                    recorded.lock().unwrap().uploads.push(upload);
                    match &uploads {
                        Uploads::Hanging => {
                            // Held open on purpose. The socket stays alive as long
                            // as this task does.
                            tokio::time::sleep(std::time::Duration::from_secs(60)).await;
                            continue;
                        }
                        Uploads::Canned { status, body } => (*status, body.clone()),
                        Uploads::Accepting => {
                            let created = stored.insert(key, ()).is_none();
                            (
                                if created { 201 } else { 200 },
                                serde_json::json!({
                                    "format": "coilbox-hub-asset-upload",
                                    "version": 1,
                                    "moderation": "pending",
                                })
                                .to_string(),
                            )
                        }
                    }
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
            base: format!("http://127.0.0.1:{port}"),
            seen,
        }
    }

    /// The hub address, which both routes hang off.
    pub fn base(&self) -> String {
        self.base.clone()
    }

    pub fn have_requests(&self) -> usize {
        self.seen.lock().unwrap().have_requests
    }

    pub fn uploads(&self) -> Vec<SeenUpload> {
        self.seen.lock().unwrap().uploads.clone()
    }
}

fn held_from(rows: &[(AssetIdentity, &str)]) -> HashMap<String, String> {
    rows.iter()
        .map(|(identity, source_hash)| (identity_key(identity), (*source_hash).to_owned()))
        .collect()
}

/// Take a multipart body apart into the two entries the route reads.
///
/// Deliberately literal about the rules the route depends on: the boundary comes
/// out of the request's own `Content-Type`, a part with a `filename` is a file and
/// one without is a string, and each part's body is everything between its blank
/// line and the `\r\n` before the next boundary.
fn parse_multipart(head: &str, body: &[u8]) -> Option<SeenUpload> {
    let content_type = head
        .lines()
        .find_map(|l| l.strip_prefix("content-type:"))?
        .trim()
        .to_owned();
    let boundary = content_type.split("boundary=").nth(1)?.trim().to_owned();
    let sep = format!("--{boundary}");

    let mut declaration_json = None;
    let mut file = None;
    for part in split_on(body, sep.as_bytes()) {
        let Some(blank) = part.windows(4).position(|w| w == b"\r\n\r\n") else {
            continue;
        };
        let headers = String::from_utf8_lossy(&part[..blank]).to_ascii_lowercase();
        // Trailing \r\n before the next boundary is framing, not content.
        let content = part[blank + 4..]
            .strip_suffix(b"\r\n")
            .unwrap_or(&part[blank + 4..]);
        let name = between(&headers, "name=\"", "\"")?;
        if name == "asset" {
            declaration_json = Some(String::from_utf8_lossy(content).into_owned());
        } else if name == "file" {
            file = Some((
                content.to_vec(),
                between(&headers, "filename=\"", "\"").unwrap_or_default(),
                headers
                    .lines()
                    .find_map(|l| l.strip_prefix("content-type:"))
                    .unwrap_or_default()
                    .trim()
                    .to_owned(),
            ));
        }
    }

    let declaration_json = declaration_json?;
    let (file, file_name, file_type) = file?;
    Some(SeenUpload {
        headers: head.to_owned(),
        raw: body.to_vec(),
        content_type,
        declaration: serde_json::from_str(&declaration_json).ok()?,
        declaration_json,
        file,
        file_name,
        file_type,
    })
}

/// Everything between consecutive occurrences of `sep`, which for a multipart body
/// is one part each. The last boundary carries a `--` suffix and still starts with
/// `sep`, so it closes the final part.
fn split_on<'a>(body: &'a [u8], sep: &[u8]) -> Vec<&'a [u8]> {
    let mut at = Vec::new();
    let mut i = 0;
    while i + sep.len() <= body.len() {
        if &body[i..i + sep.len()] == sep {
            at.push(i);
            i += sep.len();
        } else {
            i += 1;
        }
    }
    at.windows(2)
        .map(|w| &body[w[0] + sep.len()..w[1]])
        .collect()
}

fn between(haystack: &str, open: &str, close: &str) -> Option<String> {
    let start = haystack.find(open)? + open.len();
    let end = haystack[start..].find(close)? + start;
    Some(haystack[start..end].to_owned())
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
