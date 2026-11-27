//! A fake hub and a fake mirror, for the tests of [`super`].
//!
//! Each is a small HTTP server on a loopback port, so a run is tested over real
//! HTTP. The mirror follows `PROTOCOL.md` sections 3 and 4 closely enough that a
//! request the real one would refuse is refused here too: the multipart envelope
//! is checked part by part, and a wrong offset gets `bad_offset`. The hub
//! answers the shapes `Uploads.php` produces.
//!
//! The servers use threads and blocking sockets rather than the test runtime,
//! so a handler can sleep to stand in for a transfer that never ends.

use std::collections::{HashMap, VecDeque};
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde_json::{json, Value};

pub const UPLOAD_ID: &str = "0a1b2c3d-0000-4000-8000-000000000001";

pub struct Request {
    pub method: String,
    pub path: String,
    /// Header names lowercased.
    pub headers: HashMap<String, String>,
    pub body: Vec<u8>,
}

pub enum Reply {
    Json(u16, Value),
    /// Close the connection without answering, as a dropped response looks.
    Close,
    /// Hold the connection open for a while, then close it.
    Hang(Duration),
}

pub struct Server {
    pub base: String,
}

impl Server {
    pub fn start(handler: impl Fn(&Request) -> Reply + Send + Sync + 'static) -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let handler = Arc::new(handler);
        std::thread::spawn(move || {
            for stream in listener.incoming() {
                let Ok(stream) = stream else { continue };
                let handler = handler.clone();
                std::thread::spawn(move || serve(stream, handler.as_ref()));
            }
        });
        Self {
            base: format!("http://127.0.0.1:{port}"),
        }
    }
}

fn serve(mut stream: TcpStream, handler: &(dyn Fn(&Request) -> Reply + Send + Sync)) {
    let Some(request) = read_request(&mut stream) else {
        return;
    };
    match handler(&request) {
        Reply::Json(status, body) => {
            let body = body.to_string();
            let head = format!(
                "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                body.len()
            );
            let _ = stream.write_all(head.as_bytes());
            let _ = stream.write_all(body.as_bytes());
            let _ = stream.flush();
        }
        Reply::Close => {}
        Reply::Hang(how_long) => std::thread::sleep(how_long),
    }
}

fn read_request(stream: &mut TcpStream) -> Option<Request> {
    let mut buf = Vec::new();
    let mut chunk = [0u8; 8192];
    let head_end = loop {
        let n = stream.read(&mut chunk).ok()?;
        if n == 0 {
            return None;
        }
        buf.extend_from_slice(&chunk[..n]);
        if let Some(at) = buf.windows(4).position(|w| w == b"\r\n\r\n") {
            break at + 4;
        }
    };
    let head = String::from_utf8_lossy(&buf[..head_end]).into_owned();
    let mut lines = head.lines();
    let mut first = lines.next()?.split(' ');
    let method = first.next()?.to_owned();
    let path = first.next()?.to_owned();
    let headers: HashMap<String, String> = lines
        .filter_map(|l| l.split_once(':'))
        .map(|(k, v)| (k.trim().to_ascii_lowercase(), v.trim().to_owned()))
        .collect();
    let length: usize = headers
        .get("content-length")
        .and_then(|v| v.parse().ok())
        .unwrap_or(0);
    while buf.len() < head_end + length {
        let n = stream.read(&mut chunk).ok()?;
        if n == 0 {
            break;
        }
        buf.extend_from_slice(&chunk[..n]);
    }
    Some(Request {
        method,
        path,
        headers,
        body: buf.split_off(head_end),
    })
}

// ------------------------------------------------------------------- the hub

#[derive(Default)]
struct HubState {
    /// Answers to `POST /api/v1/uploads`. Empty means the hub's own: 201 the
    /// first time and 200, with a new token, after that.
    refusal: Option<(u16, Value)>,
    mirror: String,
    reservations: Vec<(Option<String>, String)>,
    /// What `GET /api/v1/uploads/{id}` says in turn. The last repeats.
    states: VecDeque<String>,
    last_state: String,
    polls: usize,
    poll_status: Option<u16>,
    /// Answers to `POST /api/v1/replays/uploads` in turn. The last repeats. A
    /// `None` is the hub's own upload answer, 201 the first time and 200 after.
    replay_answers: VecDeque<Option<(u16, Value)>>,
    last_replay_answer: Option<(u16, Value)>,
    replay_requests: Vec<(Option<String>, String)>,
}

pub struct FakeHub {
    pub base: String,
    state: Arc<Mutex<HubState>>,
}

impl FakeHub {
    /// A hub that reserves a slot on this mirror and says `listed` when asked.
    pub fn new(mirror_base: &str) -> Self {
        let state = Arc::new(Mutex::new(HubState {
            mirror: mirror_base.to_owned(),
            last_state: "listed".into(),
            ..HubState::default()
        }));
        let shared = state.clone();
        let server = Server::start(move |request| hub_answer(&shared, request));
        Self {
            base: server.base,
            state,
        }
    }

    /// Answer every reservation with this.
    pub fn refusing(self, status: u16, body: Value) -> Self {
        self.state.lock().unwrap().refusal = Some((status, body));
        self
    }

    /// The states the hub reports in turn, the last one for ever after.
    pub fn polling(self, states: &[&str]) -> Self {
        let mut state = self.state.lock().unwrap();
        state.states = states.iter().map(|s| (*s).to_owned()).collect();
        drop(state);
        self
    }

    /// Answer every status request with this status and no upload.
    pub fn poll_status(self, status: u16) -> Self {
        self.state.lock().unwrap().poll_status = Some(status);
        self
    }

    /// What the replay route answers in turn, the last for ever after. `None`
    /// is an upload slot on the mirror.
    pub fn replaying(self, answers: Vec<Option<(u16, Value)>>) -> Self {
        self.state.lock().unwrap().replay_answers = answers.into();
        self
    }

    /// The authorization header and the body of each replay request.
    pub fn replay_requests(&self) -> Vec<(Option<String>, String)> {
        self.state.lock().unwrap().replay_requests.clone()
    }

    /// The authorization header and the body of each reservation.
    pub fn reservations(&self) -> Vec<(Option<String>, String)> {
        self.state.lock().unwrap().reservations.clone()
    }

    pub fn polls(&self) -> usize {
        self.state.lock().unwrap().polls
    }
}

fn hub_answer(state: &Mutex<HubState>, request: &Request) -> Reply {
    let mut state = state.lock().unwrap();
    if request.method == "POST" && request.path == "/api/v1/uploads" {
        state.reservations.push((
            request.headers.get("authorization").cloned(),
            String::from_utf8_lossy(&request.body).into_owned(),
        ));
        if let Some((status, body)) = state.refusal.clone() {
            return Reply::Json(status, body);
        }
        let count = state.reservations.len();
        let mirror = state.mirror.clone();
        return Reply::Json(
            if count == 1 { 201 } else { 200 },
            json!({ "upload": {
                "id": UPLOAD_ID,
                "state": "uploading",
                "mirror": "jj",
                "upload_url": format!("{mirror}/upload.php"),
                "limits_url": format!("{mirror}/limits.php"),
                "token": format!("token-{count}"),
                "start_by": 1,
                "reserved_until": "2026-11-18T00:00:00Z",
            }}),
        );
    }
    if request.method == "POST" && request.path == "/api/v1/replays/uploads" {
        state.replay_requests.push((
            request.headers.get("authorization").cloned(),
            String::from_utf8_lossy(&request.body).into_owned(),
        ));
        if let Some(next) = state.replay_answers.pop_front() {
            state.last_replay_answer = next;
        }
        if let Some((status, body)) = state.last_replay_answer.clone() {
            return Reply::Json(status, body);
        }
        let count = state.replay_requests.len();
        let mirror = state.mirror.clone();
        return Reply::Json(
            if count == 1 { 201 } else { 200 },
            json!({ "upload": {
                "id": UPLOAD_ID,
                "game_id": "9f2c4b1ad07e5386c1f4a92b6e8d0375",
                "state": "uploading",
                "mirror": "jj",
                "filename": "9f2c4b1ad07e5386c1f4a92b6e8d0375.sdfz",
                "upload_url": format!("{mirror}/upload.php"),
                "limits_url": format!("{mirror}/limits.php"),
                "token": format!("token-{count}"),
                "start_by": 1,
                "reserved_until": 2,
            }}),
        );
    }
    if request.method == "GET" && request.path == format!("/api/v1/uploads/{UPLOAD_ID}") {
        state.polls += 1;
        if let Some(status) = state.poll_status {
            return Reply::Json(status, json!({ "error": "No such upload." }));
        }
        if let Some(next) = state.states.pop_front() {
            state.last_state = next;
        }
        return Reply::Json(
            200,
            json!({ "upload": {
                "id": UPLOAD_ID,
                "state": state.last_state,
                "filename": "x.sd7",
                "kind": "map",
                "reserved_until": "2026-11-18T00:00:00Z",
            }}),
        );
    }
    Reply::Json(404, json!({ "error": "not here" }))
}

// ----------------------------------------------------------------- the mirror

/// What the mirror does when the last byte arrives.
#[derive(Clone, Copy)]
pub enum Finish {
    Accept,
    /// Another file of that name, in any case, is already in the folder.
    Exists,
    HashMismatch,
}

/// One `POST upload.php` as the mirror saw it.
#[derive(Debug, Clone)]
pub struct SeenChunk {
    pub token: String,
    pub offset: String,
    pub len: usize,
}

pub struct MirrorState {
    pub max_chunk: u64,
    pub size: u64,
    pub held: Vec<u8>,
    pub complete: bool,
    pub finish: Finish,
    /// Tokens whose first chunk is too late.
    pub expired: Vec<String>,
    /// Append the next chunk, then close the connection without answering.
    pub drop_next_response: bool,
    /// Answer every `POST` with this, before reading it.
    pub canned_post: Option<(u16, Value)>,
    pub limits: Option<(u16, Value)>,
    pub post_hangs_for: Option<Duration>,
    pub posts: Vec<SeenChunk>,
}

pub struct FakeMirror {
    pub base: String,
    pub state: Arc<Mutex<MirrorState>>,
}

impl FakeMirror {
    pub fn new(size: u64, max_chunk: u64) -> Self {
        let state = Arc::new(Mutex::new(MirrorState {
            max_chunk,
            size,
            held: Vec::new(),
            complete: false,
            finish: Finish::Accept,
            expired: Vec::new(),
            drop_next_response: false,
            canned_post: None,
            limits: None,
            post_hangs_for: None,
            posts: Vec::new(),
        }));
        let shared = state.clone();
        let server = Server::start(move |request| mirror_answer(&shared, request));
        Self {
            base: server.base,
            state,
        }
    }

    pub fn with_state(&self, change: impl FnOnce(&mut MirrorState)) {
        change(&mut self.state.lock().unwrap());
    }

    pub fn held(&self) -> Vec<u8> {
        self.state.lock().unwrap().held.clone()
    }

    pub fn posts(&self) -> Vec<SeenChunk> {
        self.state.lock().unwrap().posts.clone()
    }
}

fn error(status: u16, code: &str) -> Reply {
    Reply::Json(status, json!({ "error": code }))
}

fn mirror_answer(state: &Mutex<MirrorState>, request: &Request) -> Reply {
    let mut state = state.lock().unwrap();
    match (request.method.as_str(), request.path.as_str()) {
        ("GET", "/limits.php") => match state.limits.clone() {
            Some((status, body)) => Reply::Json(status, body),
            None => Reply::Json(200, json!({ "v": 1, "max_chunk_bytes": state.max_chunk })),
        },
        ("GET", "/upload.php") => {
            if !request.headers.contains_key("x-mirror-token") {
                return error(400, "bad_request");
            }
            Reply::Json(
                200,
                json!({ "received": state.held.len(), "complete": state.complete }),
            )
        }
        ("POST", "/upload.php") => post(&mut state, request),
        _ => error(405, "method_not_allowed"),
    }
}

fn post(state: &mut MirrorState, request: &Request) -> Reply {
    let token = request.headers.get("x-mirror-token").cloned();
    let Some(token) = token else {
        return error(400, "bad_request");
    };
    let offset_header = request
        .headers
        .get("x-mirror-offset")
        .cloned()
        .unwrap_or_default();
    // The chunk is parsed before the answer is chosen, so a request that breaks
    // the envelope is recorded and refused even when a canned answer is set.
    let chunk = parse_envelope(request);
    state.posts.push(SeenChunk {
        token: token.clone(),
        offset: offset_header.clone(),
        len: chunk.as_ref().map_or(0, Vec::len),
    });
    if let Some(how_long) = state.post_hangs_for {
        return Reply::Hang(how_long);
    }
    if let Some((status, body)) = state.canned_post.clone() {
        return Reply::Json(status, body);
    }
    if state.complete {
        return error(409, "used");
    }
    let Some(chunk) = chunk.filter(|c| !c.is_empty()) else {
        return error(400, "bad_request");
    };
    if state.held.len() as u64 == state.size {
        return finish(state);
    }
    if state.held.is_empty() && state.expired.contains(&token) {
        return error(410, "expired");
    }
    let Ok(offset) = offset_header.parse::<usize>() else {
        return error(400, "bad_request");
    };
    if offset != state.held.len() {
        return Reply::Json(
            409,
            json!({ "error": "bad_offset", "received": state.held.len() }),
        );
    }
    if (state.held.len() + chunk.len()) as u64 > state.size {
        return error(413, "too_large");
    }
    state.held.extend_from_slice(&chunk);
    if state.drop_next_response {
        state.drop_next_response = false;
        return Reply::Close;
    }
    if state.held.len() as u64 == state.size {
        return finish(state);
    }
    Reply::Json(
        200,
        json!({ "received": state.held.len(), "complete": false }),
    )
}

fn finish(state: &mut MirrorState) -> Reply {
    match state.finish {
        Finish::Accept => {
            state.complete = true;
            Reply::Json(
                201,
                json!({
                    "complete": true,
                    "received": state.held.len(),
                    "path": "maps/x.sd7",
                    "reported": true,
                }),
            )
        }
        Finish::Exists => {
            state.held.clear();
            error(409, "exists")
        }
        Finish::HashMismatch => {
            state.held.clear();
            error(422, "hash_mismatch")
        }
    }
}

/// The chunk in a `multipart/form-data` body, or `None` when the body is not the
/// envelope `PROTOCOL.md` section 3 describes: exactly one part, named `chunk`,
/// with `filename="chunk"`, `Content-Type: application/octet-stream` and no
/// other header, and a boundary of at most 70 characters.
fn parse_envelope(request: &Request) -> Option<Vec<u8>> {
    let content_type = request.headers.get("content-type")?;
    let boundary = content_type.strip_prefix("multipart/form-data; boundary=")?;
    if boundary.len() > 70 {
        return None;
    }
    let open = format!("--{boundary}\r\n").into_bytes();
    let close = format!("\r\n--{boundary}--\r\n").into_bytes();
    let body = &request.body;
    let rest = body.strip_prefix(open.as_slice())?;
    let rest = rest.strip_suffix(close.as_slice())?;
    let head_end = rest.windows(4).position(|w| w == b"\r\n\r\n")?;
    let head = std::str::from_utf8(&rest[..head_end]).ok()?;
    let lines: Vec<&str> = head.split("\r\n").collect();
    let disposition_ok = lines.first().is_some_and(|l| {
        l.eq_ignore_ascii_case("content-disposition: form-data; name=\"chunk\"; filename=\"chunk\"")
    });
    let type_ok = lines
        .get(1)
        .is_some_and(|l| l.eq_ignore_ascii_case("content-type: application/octet-stream"));
    if lines.len() != 2 || !disposition_ok || !type_ok {
        return None;
    }
    let data = rest[head_end + 4..].to_vec();
    // A second boundary inside the data would be a second part.
    let any_boundary = format!("\r\n--{boundary}").into_bytes();
    if data
        .windows(any_boundary.len())
        .any(|w| w == any_boundary.as_slice())
    {
        return None;
    }
    Some(data)
}
