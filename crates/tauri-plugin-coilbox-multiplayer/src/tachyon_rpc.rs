//! Matching Tachyon responses to requests, in both directions.
//!
//! Tachyon carries requests both ways over one socket. We send `lobby/join` and
//! wait for its answer, and the server sends us `battle/start` and waits for
//! ours. This module owns both halves of that and nothing else: it does not know
//! any command, it does not touch lobby state, and it does not talk to the
//! frontend.
//!
//! [`spawn`] takes a connected [`TachyonSocket`] and returns a [`TachyonClient`]
//! for callers plus the task that owns the socket. Callers await
//! [`TachyonClient::request`], which resolves when the response carrying the same
//! `messageId` arrives.
//!
//! Four things shape the design.
//!
//! A late answer to a server request is a disconnect, not a slow reply.
//! Teiserver closes with code 1008 and "Response to request with message id ...
//! not received in time". So inbound requests are answered on the connection
//! task by a synchronous [`Handler`], never by asking the frontend, and the
//! socket read wins the `select!` so reading is never starved by our own sends.
//!
//! Events carry a `messageId` too, and it correlates with nothing. Only a
//! response is ever looked up, and a response whose id matches nothing is
//! dropped, which is the normal outcome after one of our requests timed out.
//!
//! Failure is typed. Every command can fail with `unauthorized`,
//! `internal_error`, `invalid_request` or `command_unimplemented`, and most add
//! their own on top, so a failed response comes back as a [`Failure`] the caller
//! can match on rather than as a string it has to read.
//!
//! `command_unimplemented` is not one of those failures. Teiserver answers it for
//! every part of the spec it has not built, which today is the whole `clan`
//! service and a handful of other commands, so it says the feature is absent
//! rather than that the request went wrong. It comes back as
//! [`RequestError::Unsupported`], and the connection remembers the command so a
//! second caller is told at once rather than after another round trip. Remembered
//! rather than listed, because a list in the source would be wrong as soon as
//! Teiserver caught up, and the memory lives and dies with the connection so a
//! server that has caught up is believed on the next one.
//!
//! The send path is a queue rather than a straight line. The socket holds sends
//! to eight a second against Teiserver's ten, so a burst of user actions reaches
//! the socket faster than it can leave, and Teiserver answers a burst that gets
//! through by closing the connection. The queue in front of the socket is
//! bounded, so a caller waits for a place in it rather than piling work up, and
//! every queued frame carries the point past which sending it is worse than not
//! sending it.

use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use coilbox_tachyon_protocol::{Envelope, MessageKind};
use serde::Deserialize;
use serde_json::{Map, Value};
use tokio::sync::{mpsc, oneshot};
use tokio::task::JoinHandle;
use tokio::time::Instant;

use crate::lock_or_recover;
use crate::tachyon_ws::{TachyonSocket, WsError};

/// How long a request has, counted from the call rather than from the send.
///
/// Teiserver pings every 1000 to 9500 milliseconds and drops a client that does
/// not answer, so a socket that is up at all has proved itself inside ten
/// seconds. A request with no answer after fifteen is a lost request rather than
/// a slow server. Much shorter would fail requests the server did go on to
/// answer, and much longer would leave a click with no outcome for long enough
/// that the user gives up on it first.
///
/// The budget covers the wait in the send queue as well as the wait for the
/// answer, so a caller gets an outcome inside fifteen seconds however busy the
/// send path is.
const REQUEST_TIMEOUT: Duration = Duration::from_secs(15);

/// How much of that budget a request needs left for sending it to be worth
/// doing.
///
/// A frame that goes out with almost none of its window left will not be
/// answered in time, and the caller will already have given up. Worse, the
/// server acts on it either way, so a late `lobby/join` puts the user in a lobby
/// they were told they never joined. Refusing it locally is the kinder outcome
/// and the honest one: nothing reached the server, so nothing happened there.
const MIN_ANSWER_WINDOW: Duration = Duration::from_secs(1);

/// How many frames may wait for the socket before callers are held back.
///
/// This is where the backing off happens. The socket's limiter sets the rate and
/// each frame's deadline decides how long waiting is worth it, so the depth only
/// has to stop a runaway caller from queueing without limit. Thirty two is four
/// seconds of sending at the socket's eight a second.
const SEND_QUEUE_DEPTH: usize = 32;

/// Why a response says a command failed.
///
/// The four named reasons are added to every command in the schema. Anything
/// else is a reason that command adds on its own, such as `lobby_full` on
/// `lobby/join`, and it is carried by its wire value, which is the only thing a
/// server behind or ahead of the vendored schema is guaranteed to agree with us
/// about.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum FailureReason {
    /// The credentials do not allow this command.
    Unauthorized,
    /// The server failed on its own side.
    InternalError,
    /// The server rejected the request body.
    InvalidRequest,
    /// Teiserver has not built this command yet. Common enough that a client has
    /// to degrade rather than treat it as fatal.
    CommandUnimplemented,
    /// A reason belonging to one command.
    Other(String),
}

impl FailureReason {
    /// Read a reason off the wire.
    pub fn from_wire(reason: &str) -> Self {
        match reason {
            "unauthorized" => Self::Unauthorized,
            "internal_error" => Self::InternalError,
            "invalid_request" => Self::InvalidRequest,
            "command_unimplemented" => Self::CommandUnimplemented,
            other => Self::Other(other.to_string()),
        }
    }

    /// The wire value, which is what goes back out in a response we send.
    pub fn as_wire(&self) -> &str {
        match self {
            Self::Unauthorized => "unauthorized",
            Self::InternalError => "internal_error",
            Self::InvalidRequest => "invalid_request",
            Self::CommandUnimplemented => "command_unimplemented",
            Self::Other(reason) => reason,
        }
    }
}

impl std::fmt::Display for FailureReason {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_wire())
    }
}

/// A failed response: the machine-readable reason and the optional free text the
/// server may add for a human.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Failure {
    pub reason: FailureReason,
    pub details: Option<String>,
}

impl Failure {
    /// A failure with no free text, which is what a handler of ours usually
    /// sends.
    pub fn new(reason: FailureReason) -> Self {
        Self {
            reason,
            details: None,
        }
    }
}

impl std::fmt::Display for Failure {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match &self.details {
            Some(details) => write!(f, "{}: {details}", self.reason),
            None => write!(f, "{}", self.reason),
        }
    }
}

/// Why a request we sent did not produce a success response.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum RequestError {
    /// This server has not built the command. Separate from
    /// [`Failed`](Self::Failed) because nothing went wrong: the feature is
    /// absent, so the surface that asked should hide or disable itself rather
    /// than report an error. Also returned without going to the server at all
    /// once this connection has seen the answer once.
    Unsupported,
    /// The server answered, and the answer was no.
    Failed(Failure),
    /// No answer arrived inside [`REQUEST_TIMEOUT`].
    TimedOut,
    /// The request waited behind others for so long that too little of its
    /// budget was left to be worth sending, so it never went out. Distinct from
    /// [`TimedOut`](Self::TimedOut) because nothing reached the server, so
    /// nothing happened there and the caller can retry it safely.
    NotSent,
    /// The connection ended with the request still in flight. `code` and
    /// `reason` are the close frame's, so a policy disconnect is legible: 1008
    /// with "Rate limited" is the only way to tell that case apart.
    Closed { code: Option<u16>, reason: String },
}

impl std::fmt::Display for RequestError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Unsupported => write!(f, "this server does not support that command"),
            Self::Failed(failure) => write!(f, "{failure}"),
            Self::TimedOut => write!(f, "the server did not answer in time"),
            Self::NotSent => write!(
                f,
                "the request waited too long behind others and was not sent"
            ),
            Self::Closed { code, reason } => write!(
                f,
                "{}",
                WsError::Closed {
                    code: *code,
                    reason: reason.clone()
                }
            ),
        }
    }
}

/// What a handler answers a server-to-client request with.
///
/// The success `data` is optional because some commands have none: the schema
/// for a successful `battle/start` response has no `data` property at all, while
/// `matchmaking/checkAssets` requires one.
pub type HandlerResult = Result<Option<Value>, Failure>;

/// Answers one server-to-client command. The argument is the request's `data`,
/// or `Value::Null` when it carried none.
///
/// Synchronous on purpose. The answer goes out on the connection task, and a
/// late answer closes the connection, so a handler has to return at once. A
/// handler with real work to do spawns it and answers now.
pub type Handler = Box<dyn Fn(&Value) -> HandlerResult + Send + Sync>;

/// The handlers for server-to-client requests, one per command id.
///
/// This is the seam a later ticket plugs `battle/start` and
/// `matchmaking/checkAssets` into. A command with no handler is answered
/// `command_unimplemented`, which is a real protocol answer, so an unregistered
/// command costs a rejection rather than the connection.
#[derive(Default)]
pub struct Handlers(HashMap<String, Handler>);

impl Handlers {
    pub fn new() -> Self {
        Self::default()
    }

    /// Register the answer for one command id, such as `battle/start`.
    #[must_use]
    pub fn on(
        mut self,
        command_id: &str,
        handler: impl Fn(&Value) -> HandlerResult + Send + Sync + 'static,
    ) -> Self {
        self.0.insert(command_id.to_string(), Box::new(handler));
        self
    }
}

/// The requests we have sent and not yet had an answer to, keyed by `messageId`.
/// Shared because callers register their own entry and the connection task
/// resolves it.
type Pending = Arc<Mutex<HashMap<String, oneshot::Sender<Result<String, RequestError>>>>>;

/// The commands this server has answered `command_unimplemented` for, by command
/// id. Shared, because one caller finding out should spare every other caller the
/// round trip, and it starts empty on every connection so a server that has
/// caught up is asked again.
type Unsupported = Arc<Mutex<HashSet<String>>>;

/// A frame waiting for the socket.
///
/// `send_by` is the point past which the connection task refuses it rather than
/// putting it on the wire, and `message_id` is how it tells the caller so.
struct Outgoing {
    message_id: String,
    frame: String,
    send_by: Instant,
}

/// Sends Tachyon requests over a live connection and waits for their answers.
///
/// Cheap to clone, and every clone shares one connection.
#[derive(Clone)]
pub struct TachyonClient {
    outbound: mpsc::Sender<Outgoing>,
    pending: Pending,
    unsupported: Unsupported,
    next_id: Arc<AtomicU64>,
}

impl TachyonClient {
    /// Send one request and wait for the response that echoes its `messageId`.
    ///
    /// The success value is the whole response frame, for the caller to hand to
    /// `coilbox_tachyon_protocol::parse_frame` or to the generated type for that
    /// command. A failed response comes back as [`RequestError::Failed`].
    ///
    /// `data` is omitted from the frame when it is `None`, because 17 of the 68
    /// requests in the schema have no `data` property.
    ///
    /// A busy send path makes this wait rather than fail: the queue is bounded,
    /// so a caller with no place in it holds until one frees up. It waits for a
    /// place only while sending would still be worth it, so a send path that is
    /// wedged cannot hold a caller past its own budget.
    pub async fn request(
        &self,
        command_id: &str,
        data: Option<Value>,
    ) -> Result<String, RequestError> {
        // Asking again would cost a round trip, a place in the send queue and a
        // token from the rate limiter, to be told the same thing.
        if self.is_unsupported(command_id) {
            return Err(RequestError::Unsupported);
        }

        let deadline = Instant::now() + REQUEST_TIMEOUT;
        let send_by = deadline - MIN_ANSWER_WINDOW;

        // Unique per connection is all the schema asks of a message id, and the
        // pending table lives and dies with the connection, so a counter does.
        let message_id = self.next_id.fetch_add(1, Ordering::Relaxed).to_string();
        let (tx, rx) = oneshot::channel();

        // Register before sending. The answer can arrive while we are still on
        // this line, and it has to find its entry when it does.
        lock_or_recover(&self.pending).insert(message_id.clone(), tx);
        let _entry = Registered {
            pending: self.pending.clone(),
            message_id: message_id.clone(),
        };

        let queued = Outgoing {
            frame: request_frame(&message_id, command_id, data),
            message_id,
            send_by,
        };
        match tokio::time::timeout_at(send_by, self.outbound.send(queued)).await {
            Ok(Ok(())) => {}
            // The connection task has gone, so it will never read this.
            Ok(Err(_)) => {
                return Err(RequestError::Closed {
                    code: None,
                    reason: String::new(),
                })
            }
            // The queue was full for everything this request had, so it never
            // reached the socket.
            Err(_elapsed) => return Err(RequestError::NotSent),
        }

        match tokio::time::timeout_at(deadline, rx).await {
            Ok(Ok(outcome)) => outcome,
            // The task dropped our sender without answering, which only happens
            // if it stopped without running its own cleanup.
            Ok(Err(_)) => Err(RequestError::Closed {
                code: None,
                reason: String::new(),
            }),
            Err(_elapsed) => Err(RequestError::TimedOut),
        }
    }

    /// Whether this server has already said it has not built `command_id`.
    ///
    /// This is how a surface turns itself off without making the user find out
    /// the hard way, so a screen whose one command is unsupported can hide
    /// instead of showing an error. It only knows what the connection has been
    /// told, so it is false until something asks once. Tachyon has no command
    /// that lists what a server implements, so the alternative would be a probe
    /// request per feature at connect time, which is a round trip and a rate
    /// limit token each to learn something the first real use learns for free.
    pub fn is_unsupported(&self, command_id: &str) -> bool {
        lock_or_recover(&self.unsupported).contains(command_id)
    }

    /// How many requests are waiting for an answer. Tests use this to prove an
    /// abandoned request leaves nothing behind.
    #[cfg(test)]
    fn pending_count(&self) -> usize {
        lock_or_recover(&self.pending).len()
    }
}

/// Removes a pending entry however its request ends: answered, timed out, or the
/// caller dropped the future. One drop covers all three, so no exit path can
/// leave the table growing.
struct Registered {
    pending: Pending,
    message_id: String,
}

impl Drop for Registered {
    fn drop(&mut self) {
        lock_or_recover(&self.pending).remove(&self.message_id);
    }
}

/// Take over a connected socket and start correlating.
///
/// Returns the client to send requests with and the task that owns the socket.
/// The task ends when the connection does or when the last [`TachyonClient`] is
/// dropped, and it resolves to why.
///
/// `inbound` receives every frame the task does not consume itself: every event,
/// and anything it cannot place. Reducing those into lobby state belongs
/// elsewhere.
pub fn spawn(
    socket: TachyonSocket,
    handlers: Handlers,
    inbound: mpsc::UnboundedSender<String>,
) -> (TachyonClient, JoinHandle<WsError>) {
    let (tx, rx) = mpsc::channel::<Outgoing>(SEND_QUEUE_DEPTH);
    let pending: Pending = Arc::new(Mutex::new(HashMap::new()));
    let unsupported: Unsupported = Arc::new(Mutex::new(HashSet::new()));
    let client = TachyonClient {
        outbound: tx,
        pending: pending.clone(),
        unsupported: unsupported.clone(),
        next_id: Arc::new(AtomicU64::new(1)),
    };
    let task = tokio::spawn(run_loop(
        socket,
        handlers,
        inbound,
        pending,
        unsupported,
        rx,
    ));
    (client, task)
}

/// The connection task. Reads frames, answers the server's requests, resolves
/// our own, and writes what callers queue.
///
/// The `select!` is biased toward the read. Being late with a response to the
/// server is a disconnect, while being late with a request of ours costs
/// nothing, so a busy send queue must never hold up reading.
async fn run_loop(
    mut socket: TachyonSocket,
    handlers: Handlers,
    inbound: mpsc::UnboundedSender<String>,
    pending: Pending,
    unsupported: Unsupported,
    mut outbound: mpsc::Receiver<Outgoing>,
) -> WsError {
    let ended = loop {
        tokio::select! {
            biased;
            frame = socket.recv() => {
                let raw = match frame {
                    Ok(raw) => raw,
                    Err(e) => break e,
                };
                if let Some(answer) = route(&raw, &pending, &unsupported, &handlers, &inbound) {
                    if let Err(e) = socket.send(&answer).await {
                        break e;
                    }
                }
            }
            queued = outbound.recv() => match queued {
                Some(item) => {
                    // It waited so long behind the frames in front of it that
                    // the server would be acting on it after the caller had
                    // given up. Refuse it instead, and say so.
                    if Instant::now() > item.send_by {
                        refuse(&pending, &item.message_id);
                    } else if let Err(e) = socket.send(&item.frame).await {
                        break e;
                    }
                }
                // Every client handle has gone, so nothing else will be sent.
                // Close politely rather than dropping the socket on the server.
                None => {
                    let _ = socket.close().await;
                    break WsError::Closed { code: None, reason: String::new() };
                }
            },
        }
    };

    fail_pending(&pending, &ended);
    ended
}

/// Place one inbound frame. Returns a frame to send back, which only a
/// server-to-client request produces.
fn route(
    raw: &str,
    pending: &Pending,
    unsupported: &Unsupported,
    handlers: &Handlers,
    inbound: &mpsc::UnboundedSender<String>,
) -> Option<String> {
    let Ok(envelope) = serde_json::from_str::<Envelope>(raw) else {
        // Not a Tachyon envelope. Pass it on rather than swallow it, so whoever
        // is reading the connection can report it.
        let _ = inbound.send(raw.to_string());
        return None;
    };

    match envelope.kind {
        MessageKind::Response => {
            let outcome = outcome(raw);
            // Note it before looking the caller up, so a command the user gave up
            // waiting on still teaches the connection that this server has not
            // built it.
            if outcome == Err(RequestError::Unsupported) {
                lock_or_recover(unsupported).insert(envelope.command_id);
            }
            // A response for an id we are not waiting on is dropped. That is the
            // normal outcome once a request of ours has timed out.
            if let Some(waiting) = lock_or_recover(pending).remove(&envelope.message_id) {
                // The receiver is gone if the caller stopped waiting, which is
                // not our problem.
                let _ = waiting.send(outcome);
            }
            None
        }
        // An event's message id correlates with nothing, so it is never looked
        // up.
        MessageKind::Event => {
            let _ = inbound.send(raw.to_string());
            None
        }
        MessageKind::Request => {
            let data = serde_json::from_str::<RequestData>(raw)
                .map(|body| body.data)
                .unwrap_or(Value::Null);
            let answer = match handlers.0.get(&envelope.command_id) {
                Some(handler) => handler(&data),
                None => Err(Failure::new(FailureReason::CommandUnimplemented)),
            };
            Some(response_frame(
                &envelope.message_id,
                &envelope.command_id,
                answer,
            ))
        }
    }
}

/// Tell the caller of one queued request that it never went out.
///
/// The entry is gone from the table either way, so a caller that stopped
/// waiting costs nothing and the request cannot be answered later by mistake.
fn refuse(pending: &Pending, message_id: &str) {
    if let Some(waiting) = lock_or_recover(pending).remove(message_id) {
        let _ = waiting.send(Err(RequestError::NotSent));
    }
}

/// Fail every request still in flight when the connection ends, so no caller is
/// left waiting for an answer that can no longer arrive.
///
/// A protocol or socket error becomes a close with its text as the reason: from
/// the caller's side the connection ended, and that text is why.
fn fail_pending(pending: &Pending, ended: &WsError) {
    let error = match ended {
        WsError::Closed { code, reason } => RequestError::Closed {
            code: *code,
            reason: reason.clone(),
        },
        WsError::Protocol(m) | WsError::Io(m) => RequestError::Closed {
            code: None,
            reason: m.clone(),
        },
    };
    for (_, waiting) in lock_or_recover(pending).drain() {
        let _ = waiting.send(Err(error.clone()));
    }
}

/// Split a response into the answer its caller gets.
///
/// Only a well-formed failure becomes a [`Failure`]. Everything else is handed
/// over whole, including a response we cannot make sense of, because the caller
/// knows the command and its generated type will say what is wrong with it.
///
/// `command_unimplemented` leaves here as [`RequestError::Unsupported`] instead,
/// which is why a caller never sees it as a [`FailureReason`]. The two say
/// different things and a caller acts differently on each, so there is one way to
/// say each of them.
///
/// The reason is read as the string it is on the wire, so a reason a newer server
/// has and we have never heard of arrives as
/// [`FailureReason::Other`](FailureReason::Other) with the response intact rather
/// than failing the parse.
fn outcome(raw: &str) -> Result<String, RequestError> {
    match serde_json::from_str::<FailedResponse>(raw) {
        Ok(failed) if failed.status == "failed" => {
            Err(match FailureReason::from_wire(&failed.reason) {
                FailureReason::CommandUnimplemented => RequestError::Unsupported,
                reason => RequestError::Failed(Failure {
                    reason,
                    details: failed.details,
                }),
            })
        }
        _ => Ok(raw.to_string()),
    }
}

/// The failure half of a response. Deserialising this is what tells a failure
/// from a success: a success has no `reason`, so it does not parse.
#[derive(Deserialize)]
struct FailedResponse {
    status: String,
    reason: String,
    details: Option<String>,
}

/// The body of a request, so a handler is given the `data` rather than the whole
/// frame.
#[derive(Deserialize)]
struct RequestData {
    #[serde(default)]
    data: Value,
}

/// Build a request frame.
fn request_frame(message_id: &str, command_id: &str, data: Option<Value>) -> String {
    let mut body = envelope_of("request", message_id, command_id);
    if let Some(data) = data {
        body.insert("data".into(), data);
    }
    Value::Object(body).to_string()
}

/// Build the response frame answering a server-to-client request.
fn response_frame(message_id: &str, command_id: &str, answer: HandlerResult) -> String {
    let mut body = envelope_of("response", message_id, command_id);
    match answer {
        Ok(data) => {
            body.insert("status".into(), Value::String("success".into()));
            if let Some(data) = data {
                body.insert("data".into(), data);
            }
        }
        Err(failure) => {
            body.insert("status".into(), Value::String("failed".into()));
            body.insert(
                "reason".into(),
                Value::String(failure.reason.as_wire().to_string()),
            );
            if let Some(details) = failure.details {
                body.insert("details".into(), Value::String(details));
            }
        }
    }
    Value::Object(body).to_string()
}

/// The three fields every frame starts with.
fn envelope_of(kind: &str, message_id: &str, command_id: &str) -> Map<String, Value> {
    let mut body = Map::new();
    body.insert("type".into(), Value::String(kind.into()));
    body.insert("messageId".into(), Value::String(message_id.into()));
    body.insert("commandId".into(), Value::String(command_id.into()));
    body
}

/// The tests run against a real WebSocket server on loopback, the way the
/// transport's own tests do. [`TachyonSocket`] is a concrete type, so testing
/// the correlation on its own would mean putting a trait under it that nothing
/// else wants, and the close-code tests need a real close frame anyway.
#[cfg(test)]
mod tests {
    use super::*;
    use futures_util::{SinkExt, StreamExt};
    use serde_json::json;
    use tokio::net::{TcpListener, TcpStream};
    use tokio_tungstenite::tungstenite::handshake::server::{
        ErrorResponse, Request as ServerRequest, Response as ServerResponse,
    };
    use tokio_tungstenite::tungstenite::http::HeaderValue;
    use tokio_tungstenite::tungstenite::protocol::frame::coding::CloseCode;
    use tokio_tungstenite::tungstenite::protocol::frame::CloseFrame;
    use tokio_tungstenite::tungstenite::{Message, Utf8Bytes};
    use tokio_tungstenite::WebSocketStream;
    use tokio_util::sync::CancellationToken;

    /// A server that accepts one connection, agrees to the Tachyon subprotocol,
    /// and runs `body` over the socket. Returns the URL to connect to.
    async fn serve<F, Fut>(body: F) -> String
    where
        F: FnOnce(WebSocketStream<TcpStream>) -> Fut + Send + 'static,
        Fut: std::future::Future<Output = ()> + Send,
    {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        tokio::spawn(async move {
            let (sock, _) = listener.accept().await.unwrap();
            #[allow(
                clippy::result_large_err,
                reason = "the callback signature is tungstenite's"
            )]
            let on_upgrade = |_req: &ServerRequest, mut res: ServerResponse| {
                res.headers_mut().insert(
                    "Sec-WebSocket-Protocol",
                    HeaderValue::from_static(crate::tachyon_ws::SUBPROTOCOL),
                );
                Ok::<_, ErrorResponse>(res)
            };
            let ws = tokio_tungstenite::accept_hdr_async(sock, on_upgrade)
                .await
                .unwrap();
            body(ws).await;
        });
        format!("ws://127.0.0.1:{port}/tachyon")
    }

    /// Connect a client to `url` and start correlating.
    async fn start(
        url: &str,
        handlers: Handlers,
    ) -> (
        TachyonClient,
        JoinHandle<WsError>,
        mpsc::UnboundedReceiver<String>,
    ) {
        let socket = crate::tachyon_ws::connect(
            url,
            "test-token",
            Duration::from_secs(5),
            &CancellationToken::new(),
        )
        .await
        .unwrap_or_else(|e| panic!("connect failed: {e}"));
        let (inbound_tx, inbound_rx) = mpsc::unbounded_channel();
        let (client, task) = spawn(socket, handlers, inbound_tx);
        (client, task, inbound_rx)
    }

    /// Wait for something the connection task should produce. Bounded, so a
    /// task that never produces it fails the test rather than hanging it.
    async fn soon<T>(rx: &mut mpsc::UnboundedReceiver<T>) -> T {
        tokio::time::timeout(Duration::from_secs(5), rx.recv())
            .await
            .expect("nothing arrived within 5 seconds")
            .expect("the sender went away")
    }

    /// The next text frame the server receives, as JSON.
    async fn next_json(ws: &mut WebSocketStream<TcpStream>) -> Value {
        loop {
            match ws.next().await.expect("socket closed").unwrap() {
                Message::Text(text) => return serde_json::from_str(&text).unwrap(),
                Message::Ping(_) | Message::Pong(_) => continue,
                other => panic!("unexpected frame {other:?}"),
            }
        }
    }

    /// A success response echoing the request's ids.
    fn success(request: &Value, data: Value) -> Message {
        Message::text(
            json!({
                "type": "response",
                "messageId": request["messageId"],
                "commandId": request["commandId"],
                "status": "success",
                "data": data,
            })
            .to_string(),
        )
    }

    #[tokio::test]
    async fn a_request_resolves_with_its_response() {
        let url = serve(|mut ws| async move {
            let request = next_json(&mut ws).await;
            assert_eq!(request["type"], "request");
            assert_eq!(request["commandId"], "lobby/join");
            assert_eq!(request["data"]["id"], "abc");
            ws.send(success(&request, json!({ "name": "a lobby" })))
                .await
                .unwrap();
            std::future::pending::<()>().await;
        })
        .await;

        let (client, _task, _inbound) = start(&url, Handlers::new()).await;
        let raw = client
            .request("lobby/join", Some(json!({ "id": "abc" })))
            .await
            .unwrap();
        let response: Value = serde_json::from_str(&raw).unwrap();
        assert_eq!(response["data"]["name"], "a lobby");
        assert_eq!(client.pending_count(), 0);
    }

    #[tokio::test]
    async fn two_requests_in_flight_reach_the_right_callers() {
        // The server answers in the opposite order to the one it read them in,
        // so a layer that answered whoever asked first would fail this.
        let url = serve(|mut ws| async move {
            let first = next_json(&mut ws).await;
            let second = next_json(&mut ws).await;
            ws.send(success(&second, json!({ "for": second["commandId"] })))
                .await
                .unwrap();
            ws.send(success(&first, json!({ "for": first["commandId"] })))
                .await
                .unwrap();
            std::future::pending::<()>().await;
        })
        .await;

        let (client, _task, _inbound) = start(&url, Handlers::new()).await;
        let a = client.clone();
        let first = tokio::spawn(async move { a.request("lobby/list", None).await });
        // The frames go out in order, so this second request is the one the
        // server reads second.
        let b = client.clone();
        let second = tokio::spawn(async move { b.request("party/create", None).await });

        let first: Value = serde_json::from_str(&first.await.unwrap().unwrap()).unwrap();
        let second: Value = serde_json::from_str(&second.await.unwrap().unwrap()).unwrap();
        assert_eq!(first["commandId"], "lobby/list");
        assert_eq!(first["data"]["for"], "lobby/list");
        assert_eq!(second["commandId"], "party/create");
        assert_eq!(second["data"]["for"], "party/create");
    }

    #[tokio::test]
    async fn a_failed_response_arrives_as_a_typed_failure() {
        let url = serve(|mut ws| async move {
            let request = next_json(&mut ws).await;
            ws.send(Message::text(
                json!({
                    "type": "response",
                    "messageId": request["messageId"],
                    "commandId": "lobby/join",
                    "status": "failed",
                    "reason": "lobby_full",
                    "details": "the lobby has 16 of 16 players",
                })
                .to_string(),
            ))
            .await
            .unwrap();
            std::future::pending::<()>().await;
        })
        .await;

        let (client, _task, _inbound) = start(&url, Handlers::new()).await;
        let err = client.request("lobby/join", None).await.unwrap_err();
        assert_eq!(
            err,
            RequestError::Failed(Failure {
                reason: FailureReason::Other("lobby_full".into()),
                details: Some("the lobby has 16 of 16 players".into()),
            })
        );
        assert_eq!(client.pending_count(), 0);
    }

    #[tokio::test]
    async fn a_reason_a_newer_server_invented_still_arrives_as_a_failure() {
        // Teiserver is free to be ahead of the vendored schema. A reason we have
        // never heard of has to reach the caller as the refusal it is, with the
        // server's own words for it, rather than as an unreadable response.
        let url = serve(|mut ws| async move {
            let request = next_json(&mut ws).await;
            ws.send(Message::text(
                json!({
                    "type": "response",
                    "messageId": request["messageId"],
                    "commandId": "lobby/join",
                    "status": "failed",
                    "reason": "lobby_hibernating",
                    "details": "try again in a moment",
                })
                .to_string(),
            ))
            .await
            .unwrap();
            std::future::pending::<()>().await;
        })
        .await;

        let (client, _task, _inbound) = start(&url, Handlers::new()).await;
        let err = client.request("lobby/join", None).await.unwrap_err();
        assert_eq!(
            err,
            RequestError::Failed(Failure {
                reason: FailureReason::Other("lobby_hibernating".into()),
                details: Some("try again in a moment".into()),
            })
        );
        assert_eq!(err.to_string(), "lobby_hibernating: try again in a moment");
        // A reason nobody planned for is still a failure of that command, not a
        // reason to stop asking for it.
        assert!(!client.is_unsupported("lobby/join"));
    }

    #[test]
    fn the_four_shared_reasons_are_named_and_the_rest_keep_their_wire_value() {
        assert_eq!(
            FailureReason::from_wire("command_unimplemented"),
            FailureReason::CommandUnimplemented
        );
        assert_eq!(
            FailureReason::from_wire("unauthorized"),
            FailureReason::Unauthorized
        );
        assert_eq!(
            FailureReason::from_wire("banned"),
            FailureReason::Other("banned".into())
        );
        assert_eq!(FailureReason::Other("banned".into()).as_wire(), "banned");
    }

    #[tokio::test]
    async fn an_unanswered_request_times_out_and_forgets_it() {
        let url = serve(|mut ws| async move {
            let _request = next_json(&mut ws).await;
            std::future::pending::<()>().await;
        })
        .await;

        let (client, _task, _inbound) = start(&url, Handlers::new()).await;
        // Pause the clock only now, so the fifteen second budget costs the test
        // nothing. Pausing any earlier would auto-advance the connect past its
        // own budget while the handshake was still in flight.
        tokio::time::pause();
        let err = client.request("lobby/join", None).await.unwrap_err();
        assert_eq!(err, RequestError::TimedOut);
        assert_eq!(
            client.pending_count(),
            0,
            "the timed out request was left in the table"
        );
    }

    #[tokio::test]
    async fn a_close_fails_every_request_in_flight_with_its_reason() {
        // Code 1008 with "Rate limited" is the one a caller has to be able to
        // tell apart, because it says the client sent too much.
        let url = serve(|mut ws| async move {
            next_json(&mut ws).await;
            next_json(&mut ws).await;
            ws.send(Message::Close(Some(CloseFrame {
                code: CloseCode::Policy,
                reason: Utf8Bytes::from_static("Rate limited"),
            })))
            .await
            .unwrap();
            std::future::pending::<()>().await;
        })
        .await;

        let (client, task, _inbound) = start(&url, Handlers::new()).await;
        let a = client.clone();
        let first = tokio::spawn(async move { a.request("lobby/list", None).await });
        let b = client.clone();
        let second = tokio::spawn(async move { b.request("party/create", None).await });

        let expected = RequestError::Closed {
            code: Some(1008),
            reason: "Rate limited".into(),
        };
        assert_eq!(first.await.unwrap().unwrap_err(), expected);
        assert_eq!(second.await.unwrap().unwrap_err(), expected);
        assert_eq!(expected.to_string(), "closed with code 1008: Rate limited");
        assert!(matches!(
            task.await.unwrap(),
            WsError::Closed {
                code: Some(1008),
                ..
            }
        ));
    }

    #[tokio::test]
    async fn an_event_carrying_a_message_id_does_not_answer_a_request() {
        // The event repeats the request's message id, which correlates with
        // nothing. Answering the caller with it would be wrong.
        let url = serve(|mut ws| async move {
            let request = next_json(&mut ws).await;
            ws.send(Message::text(
                json!({
                    "type": "event",
                    "messageId": request["messageId"],
                    "commandId": "lobby/updated",
                    "data": { "id": "an-event" },
                })
                .to_string(),
            ))
            .await
            .unwrap();
            ws.send(success(&request, json!({ "name": "the response" })))
                .await
                .unwrap();
            std::future::pending::<()>().await;
        })
        .await;

        let (client, _task, mut inbound) = start(&url, Handlers::new()).await;
        let raw = client.request("lobby/join", None).await.unwrap();
        let response: Value = serde_json::from_str(&raw).unwrap();
        assert_eq!(response["type"], "response");
        assert_eq!(response["data"]["name"], "the response");

        let event: Value = serde_json::from_str(&soon(&mut inbound).await).unwrap();
        assert_eq!(event["commandId"], "lobby/updated");
    }

    #[tokio::test]
    async fn a_response_for_an_unknown_message_id_is_dropped() {
        // Which is what every response to a request we already gave up on looks
        // like.
        let url = serve(|mut ws| async move {
            let request = next_json(&mut ws).await;
            ws.send(Message::text(
                json!({
                    "type": "response",
                    "messageId": "a request we never sent",
                    "commandId": "lobby/join",
                    "status": "success",
                    "data": {},
                })
                .to_string(),
            ))
            .await
            .unwrap();
            ws.send(success(&request, json!({ "name": "still answered" })))
                .await
                .unwrap();
            std::future::pending::<()>().await;
        })
        .await;

        let (client, _task, _inbound) = start(&url, Handlers::new()).await;
        let raw = client.request("lobby/join", None).await.unwrap();
        let response: Value = serde_json::from_str(&raw).unwrap();
        assert_eq!(response["data"]["name"], "still answered");
    }

    #[tokio::test]
    async fn a_server_request_is_answered_with_the_same_message_id() {
        let (seen_tx, mut seen_rx) = mpsc::unbounded_channel::<Value>();
        let url = serve(|mut ws| async move {
            ws.send(Message::text(
                json!({
                    "type": "request",
                    "messageId": "srv-1",
                    "commandId": "battle/start",
                    "data": { "ip": "127.0.0.1", "port": 8452 },
                })
                .to_string(),
            ))
            .await
            .unwrap();
            let answer = next_json(&mut ws).await;
            seen_tx.send(answer).unwrap();
            std::future::pending::<()>().await;
        })
        .await;

        let (handled_tx, mut handled_rx) = mpsc::unbounded_channel::<Value>();
        let handlers = Handlers::new().on("battle/start", move |data| {
            handled_tx.send(data.clone()).unwrap();
            Ok(None)
        });
        let (_client, _task, _inbound) = start(&url, handlers).await;

        let data = soon(&mut handled_rx).await;
        assert_eq!(data["port"], 8452);

        let answer = soon(&mut seen_rx).await;
        assert_eq!(answer["type"], "response");
        assert_eq!(answer["messageId"], "srv-1");
        assert_eq!(answer["commandId"], "battle/start");
        assert_eq!(answer["status"], "success");
        // A successful battle/start response has no data property in the schema.
        assert!(answer.get("data").is_none(), "unexpected data: {answer}");
    }

    /// A server that answers every request the moment it reads it, and reports
    /// the command id of each one, so a test can see what actually went out.
    async fn answering_server(seen: mpsc::UnboundedSender<String>) -> String {
        serve(|mut ws| async move {
            while let Some(Ok(frame)) = ws.next().await {
                let Message::Text(text) = frame else { continue };
                let request: Value = serde_json::from_str(&text).unwrap();
                let _ = seen.send(request["commandId"].as_str().unwrap().to_string());
                ws.send(success(&request, json!({}))).await.unwrap();
            }
        })
        .await
    }

    /// Start one request and let it reach the queue before the next one, so the
    /// frames go out in the order this was called in. The test runtime is single
    /// threaded, so yielding is what gives the new task its turn.
    async fn fire(
        client: &TachyonClient,
        command_id: String,
    ) -> JoinHandle<(String, Result<String, RequestError>)> {
        let client = client.clone();
        let handle = tokio::spawn(async move {
            let outcome = client.request(&command_id, None).await;
            (command_id, outcome)
        });
        tokio::task::yield_now().await;
        handle
    }

    /// Keep a short timer pending for as long as the test runs.
    ///
    /// A paused clock jumps straight to the next timer whenever the runtime has
    /// nothing to run, so without this it can jump a request's whole fifteen
    /// seconds while that request's answer is still crossing the loopback
    /// socket. A ten millisecond heartbeat keeps those jumps small.
    fn heartbeat() -> JoinHandle<()> {
        tokio::spawn(async {
            loop {
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        })
    }

    #[tokio::test]
    async fn a_burst_bigger_than_the_allowance_is_spread_rather_than_dropped() {
        let (seen_tx, mut seen_rx) = mpsc::unbounded_channel::<String>();
        let url = answering_server(seen_tx).await;
        let (client, _task, _inbound) = start(&url, Handlers::new()).await;

        // Pause only now. Pausing before the connect would advance the clock
        // past the connect's own budget while the handshake was in flight.
        tokio::time::pause();
        let _beat = heartbeat();
        let started = Instant::now();

        let mut fired = Vec::new();
        for n in 0..25 {
            fired.push(fire(&client, format!("cmd/{n}")).await);
        }
        for (n, handle) in fired.into_iter().enumerate() {
            let (command_id, outcome) = handle.await.unwrap();
            assert_eq!(command_id, format!("cmd/{n}"));
            if let Err(e) = outcome {
                panic!("{command_id} did not go out: {e}");
            }
        }

        // Every frame reached the server, in the order it was asked for. They
        // are all waiting in the channel already, so reading them cannot wait on
        // a timer.
        for n in 0..25 {
            assert_eq!(seen_rx.try_recv().unwrap(), format!("cmd/{n}"));
        }
        assert!(
            seen_rx.try_recv().is_err(),
            "the server saw more frames than we asked for"
        );

        // Fifteen go at once and the rest at eight a second, so twenty five
        // cannot have left in under a second.
        assert!(
            started.elapsed() >= Duration::from_millis(1200),
            "the burst went out in {:?}, so nothing held it back",
            started.elapsed()
        );

        // The queue drained. Once the bucket has refilled, a later request goes
        // out on its own rather than waiting behind what came before it. A
        // request that did wait behind the burst would take three seconds, and
        // the second here is loose enough that the heartbeat's own steps, which
        // are tens of milliseconds, cannot fail it.
        tokio::time::advance(Duration::from_secs(2)).await;
        let after_the_burst = Instant::now();
        client.request("cmd/after", None).await.unwrap();
        assert_eq!(seen_rx.try_recv().unwrap(), "cmd/after");
        assert!(
            after_the_burst.elapsed() < Duration::from_secs(1),
            "a request after the burst waited {:?}, so the queue had not drained",
            after_the_burst.elapsed()
        );
    }

    #[tokio::test]
    async fn work_the_send_path_cannot_take_in_time_is_refused_not_dropped() {
        // Two hundred requests at eight a second is twenty five seconds of
        // sending, and a request only has fifteen, so the tail of this burst
        // cannot be sent in time. Every caller still has to be told which it
        // was.
        let (seen_tx, mut seen_rx) = mpsc::unbounded_channel::<String>();
        let url = answering_server(seen_tx).await;
        let (client, _task, _inbound) = start(&url, Handlers::new()).await;
        tokio::time::pause();
        let _beat = heartbeat();

        let mut fired = Vec::new();
        for n in 0..200 {
            fired.push(fire(&client, format!("cmd/{n}")).await);
        }

        // The queue is full, so most of those callers are waiting for a place in
        // it rather than having handed over a frame. That is the backing off.
        assert_eq!(client.outbound.capacity(), 0);
        assert_eq!(client.outbound.max_capacity(), SEND_QUEUE_DEPTH);

        let mut answered = Vec::new();
        let mut refused = Vec::new();
        for handle in fired {
            let (command_id, outcome) = handle.await.unwrap();
            match outcome {
                Ok(_) => answered.push(command_id),
                Err(RequestError::NotSent) => refused.push(command_id),
                Err(e) => panic!("{command_id} ended as {e}"),
            }
        }

        assert_eq!(
            answered.len() + refused.len(),
            200,
            "some callers got neither an answer nor a refusal"
        );
        assert!(!answered.is_empty(), "nothing got through at all");
        assert!(
            !refused.is_empty(),
            "the whole burst went out, so nothing was held back"
        );

        // A refusal means the frame never left this machine, so the server saw
        // exactly the requests whose callers were answered and no others.
        let mut sent = Vec::new();
        while let Ok(command_id) = seen_rx.try_recv() {
            sent.push(command_id);
        }
        assert_eq!(
            sent, answered,
            "the server saw a different set of requests from the one the callers were told about"
        );
    }

    #[tokio::test]
    async fn a_frame_that_went_stale_in_the_queue_is_refused_rather_than_sent_late() {
        // A plain backlog rarely produces this, because a refusal costs no
        // limiter token, so the moment frames start going stale the queue in
        // front of one empties at once. It takes a socket sending slower than
        // the limiter allows, for example while the connection task is busy
        // answering the server's own requests. Queueing the stale frame directly
        // is simpler than arranging that.
        let (seen_tx, mut seen_rx) = mpsc::unbounded_channel::<String>();
        let url = answering_server(seen_tx).await;
        let (client, _task, _inbound) = start(&url, Handlers::new()).await;

        let (tx, rx) = oneshot::channel();
        lock_or_recover(&client.pending).insert("stale".to_string(), tx);
        client
            .outbound
            .send(Outgoing {
                message_id: "stale".into(),
                frame: request_frame("stale", "lobby/join", None),
                send_by: Instant::now() - Duration::from_secs(1),
            })
            .await
            .unwrap();

        // The caller is told, rather than left waiting for an answer to a
        // question nobody asked. Bounded, so a task that never answers fails the
        // test rather than hanging it.
        let outcome = tokio::time::timeout(Duration::from_secs(5), rx)
            .await
            .expect("nothing came back within 5 seconds")
            .expect("the connection task dropped the caller's sender");
        assert_eq!(outcome, Err(RequestError::NotSent));
        assert_eq!(
            RequestError::NotSent.to_string(),
            "the request waited too long behind others and was not sent"
        );

        // The request behind it still goes out, so the server saw the second and
        // never the first.
        client.request("party/create", None).await.unwrap();
        assert_eq!(soon(&mut seen_rx).await, "party/create");
        assert!(
            seen_rx.try_recv().is_err(),
            "the stale frame was sent after all"
        );
    }

    #[tokio::test]
    async fn a_request_with_no_handler_is_answered_command_unimplemented() {
        // Answering is what matters. Staying quiet would close the connection.
        let (seen_tx, mut seen_rx) = mpsc::unbounded_channel::<Value>();
        let url = serve(|mut ws| async move {
            ws.send(Message::text(
                json!({
                    "type": "request",
                    "messageId": "srv-2",
                    "commandId": "matchmaking/checkAssets",
                    "data": {},
                })
                .to_string(),
            ))
            .await
            .unwrap();
            seen_tx.send(next_json(&mut ws).await).unwrap();
            std::future::pending::<()>().await;
        })
        .await;

        let (_client, _task, _inbound) = start(&url, Handlers::new()).await;
        let answer = soon(&mut seen_rx).await;
        assert_eq!(answer["messageId"], "srv-2");
        assert_eq!(answer["status"], "failed");
        assert_eq!(answer["reason"], "command_unimplemented");
    }

    /// A server behind the spec: it answers `command_unimplemented` to
    /// everything, and reports each command id so a test can count the round
    /// trips it cost.
    async fn unimplementing_server(seen: mpsc::UnboundedSender<String>) -> String {
        serve(|mut ws| async move {
            while let Some(Ok(frame)) = ws.next().await {
                let Message::Text(text) = frame else { continue };
                let request: Value = serde_json::from_str(&text).unwrap();
                let _ = seen.send(request["commandId"].as_str().unwrap().to_string());
                ws.send(Message::text(
                    json!({
                        "type": "response",
                        "messageId": request["messageId"],
                        "commandId": request["commandId"],
                        "status": "failed",
                        "reason": "command_unimplemented",
                    })
                    .to_string(),
                ))
                .await
                .unwrap();
            }
        })
        .await
    }

    #[tokio::test]
    async fn a_command_the_server_has_not_built_is_its_own_outcome() {
        // Teiserver answers this for the whole clan service and a handful of
        // other commands. It is the feature being absent, not the request going
        // wrong, and a caller acts differently on each.
        let (seen_tx, _seen_rx) = mpsc::unbounded_channel::<String>();
        let url = unimplementing_server(seen_tx).await;
        let (client, _task, _inbound) = start(&url, Handlers::new()).await;

        assert!(!client.is_unsupported("clan/create"));
        let err = client.request("clan/create", None).await.unwrap_err();
        assert_eq!(err, RequestError::Unsupported);
        assert_eq!(err.to_string(), "this server does not support that command");
        assert!(client.pending_count() == 0);
        // Which the connection now knows, so a surface can hide itself rather
        // than wait for the user to try it again.
        assert!(client.is_unsupported("clan/create"));
    }

    #[tokio::test]
    async fn a_command_already_answered_unsupported_is_not_asked_again() {
        let (seen_tx, mut seen_rx) = mpsc::unbounded_channel::<String>();
        let url = unimplementing_server(seen_tx).await;
        let (client, _task, _inbound) = start(&url, Handlers::new()).await;

        let first = client.request("clan/create", None).await;
        assert_eq!(first, Err(RequestError::Unsupported));
        assert_eq!(soon(&mut seen_rx).await, "clan/create");

        // The same answer, without the round trip or the rate limit token it
        // would have cost.
        let again = client.request("clan/create", None).await;
        assert_eq!(again, Err(RequestError::Unsupported));

        // Only that command, though. Another one is still asked, so one absent
        // feature cannot switch off the rest.
        let other = client.request("user/report", None).await;
        assert_eq!(other, Err(RequestError::Unsupported));
        assert_eq!(soon(&mut seen_rx).await, "user/report");
        assert!(
            seen_rx.try_recv().is_err(),
            "the second clan/create went to the server after all"
        );
    }
}
