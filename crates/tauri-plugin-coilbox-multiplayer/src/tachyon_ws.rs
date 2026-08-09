//! The Tachyon WebSocket transport.
//!
//! Tachyon replaces the TASServer line protocol with UTF-8 JSON over a WebSocket
//! at `wss://<server>/tachyon`. This module owns that socket and nothing above it:
//! it opens the connection, checks the negotiated protocol version, carries text
//! frames both ways, and reports why the socket closed. Message shapes, request
//! correlation and login all belong to later work.
//!
//! Three things differ from [`crate::tls`], which serves the line protocol.
//!
//! Authorisation happens on the HTTP upgrade as an `Authorization: Bearer` header,
//! so there is no in-band login and no STLS dance. TLS is negotiated before the
//! WebSocket exists.
//!
//! The protocol version is the WebSocket subprotocol. We offer [`SUBPROTOCOL`] and
//! the server echoes back the one it picked. A server that picks nothing, or picks
//! something we did not offer, is a failure rather than a plain connection.
//!
//! Teiserver enforces limits the specification does not mention. It closes with
//! code 1008 and a short body such as "Rate limited" or "Request too big", and
//! those closes are hard disconnects rather than rejected messages. So the send
//! path carries its own limiter and every close surfaces its code and body.

use std::sync::Arc;
use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use tokio::net::TcpStream;
use tokio::time::Instant;
use tokio_rustls::TlsConnector;
use tokio_tungstenite::tungstenite::http::Uri;
use tokio_tungstenite::tungstenite::protocol::frame::CloseFrame;
use tokio_tungstenite::tungstenite::{ClientRequestBuilder, Error as TungsteniteError, Message};
use tokio_tungstenite::WebSocketStream;
use tokio_util::sync::CancellationToken;

use crate::tls::{client_config, AsyncReadWrite};

/// The protocol version we offer in `Sec-WebSocket-Protocol`, formatted as
/// `{version}.tachyon`. `v0` is the only version that exists, and Teiserver
/// hardcodes this exact string.
pub const SUBPROTOCOL: &str = "v0.tachyon";

/// Messages a second the send limiter allows, and how many it lets through back to
/// back. Teiserver allows 10 a second with a burst of 20 and drops the connection
/// on the first breach, so we sit under both rather than at them. This is a floor
/// under the send path, not a queueing policy: a caller that wants ordering or
/// backoff builds it on top.
const SEND_RATE_PER_SEC: f64 = 8.0;
const SEND_BURST: f64 = 15.0;
const _: () = assert!(SEND_RATE_PER_SEC < 10.0 && SEND_BURST < 20.0);

/// Why a connect ended without a socket.
///
/// The split between [`Unreachable`](WsConnectError::Unreachable) and
/// [`Rejected`](WsConnectError::Rejected) is the one a user needs: a server we
/// could not reach is a network problem, a server that refused the upgrade is a
/// credentials or configuration problem. Teiserver answers a missing or expired
/// token with 401 and a JSON body, and that body is the only explanation anyone
/// gets, so it is carried through verbatim.
#[derive(Debug)]
pub enum WsConnectError {
    /// The caller fired the [`CancellationToken`].
    Cancelled,
    /// The connect exceeded its budget without resolving.
    TimedOut,
    /// The URL was not a Tachyon endpoint we will open.
    BadUrl(String),
    /// DNS, TCP or TLS failed, so the server never answered.
    Unreachable(String),
    /// The server answered the upgrade with an HTTP response instead of switching
    /// protocols. `body` may be empty if the server sent none.
    Rejected { status: u16, body: String },
    /// The upgrade completed but the handshake was not usable, most often because
    /// of the subprotocol.
    Protocol(String),
}

impl std::fmt::Display for WsConnectError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Cancelled => write!(f, "connect cancelled"),
            Self::TimedOut => write!(f, "connect timed out"),
            Self::BadUrl(m) => write!(f, "bad url: {m}"),
            Self::Unreachable(m) => write!(f, "could not reach the server: {m}"),
            Self::Rejected { status, body } if body.is_empty() => {
                write!(f, "server refused the connection with HTTP {status}")
            }
            Self::Rejected { status, body } => {
                write!(
                    f,
                    "server refused the connection with HTTP {status}: {body}"
                )
            }
            Self::Protocol(m) => write!(f, "handshake failed: {m}"),
        }
    }
}

/// Why a send or receive on a live socket failed.
#[derive(Debug)]
pub enum WsError {
    /// The connection ended. `code` is the WebSocket close code and `reason` the
    /// close frame body. Both are absent when the peer went away without closing.
    Closed { code: Option<u16>, reason: String },
    /// The peer broke the protocol, for example by sending a binary frame.
    Protocol(String),
    /// The underlying socket failed.
    Io(String),
}

impl std::fmt::Display for WsError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Closed { code: None, .. } => write!(f, "connection lost"),
            Self::Closed {
                code: Some(c),
                reason,
            } if reason.is_empty() => {
                write!(f, "closed with code {c}")
            }
            Self::Closed {
                code: Some(c),
                reason,
            } => write!(f, "closed with code {c}: {reason}"),
            Self::Protocol(m) => write!(f, "protocol error: {m}"),
            Self::Io(m) => write!(f, "socket error: {m}"),
        }
    }
}

/// A live Tachyon WebSocket.
///
/// Text frames only, in both directions. Pings are answered without the caller
/// doing anything (see [`TachyonSocket::recv`]) and sends pass through a rate
/// limiter.
pub struct TachyonSocket {
    ws: WebSocketStream<Box<dyn AsyncReadWrite>>,
    limiter: RateLimiter,
    subprotocol: String,
}

impl TachyonSocket {
    /// The protocol version the server picked, for example `v0.tachyon`. Always one
    /// of the versions we offered, because the connect fails otherwise.
    pub fn subprotocol(&self) -> &str {
        &self.subprotocol
    }

    /// Send one text frame, waiting first for the rate limiter to allow it.
    pub async fn send(&mut self, text: &str) -> Result<(), WsError> {
        self.limiter.acquire().await;
        self.ws.send(Message::text(text)).await.map_err(from_lib)
    }

    /// Wait for the next text frame.
    ///
    /// Ping and pong frames are consumed here rather than returned. tungstenite
    /// queues the pong reply the moment it reads a ping and flushes it on the next
    /// read, which is the loop below, so the answer goes out while the caller is
    /// still waiting for its message. Teiserver pings every 1000 to 9500
    /// milliseconds and drops a client that does not answer, so a caller that
    /// stops calling `recv` loses the connection within ten seconds.
    ///
    /// A binary frame is a protocol error. Tachyon carries UTF-8 JSON only.
    pub async fn recv(&mut self) -> Result<String, WsError> {
        loop {
            match self.ws.next().await {
                Some(Ok(Message::Text(text))) => return Ok(text.to_string()),
                Some(Ok(Message::Ping(_) | Message::Pong(_))) => continue,
                Some(Ok(Message::Binary(_))) => {
                    return Err(WsError::Protocol(
                        "server sent a binary frame, Tachyon carries text only".into(),
                    ))
                }
                Some(Ok(Message::Close(frame))) => return Err(closed(frame)),
                // `Message::Frame` is a write-side variant and is never read back.
                Some(Ok(Message::Frame(_))) => continue,
                Some(Err(e)) => return Err(from_lib(e)),
                None => {
                    return Err(WsError::Closed {
                        code: None,
                        reason: String::new(),
                    })
                }
            }
        }
    }

    /// Start a graceful close. The caller should keep calling [`Self::recv`] until
    /// it reports the connection closed, which is what drives the close handshake
    /// to completion.
    pub async fn close(&mut self) -> Result<(), WsError> {
        self.ws.close(None).await.map_err(from_lib)
    }
}

/// Open a Tachyon WebSocket at `url`, presenting `token` as a bearer credential.
///
/// This carries a token it is given and never obtains one. Both escape hatches
/// from [`crate::tls::connect_stream_cancellable`] apply, and for the same reason:
/// the `select!` is biased toward the token so an already-fired cancel wins over a
/// connect resolving in the same poll, and dropping the connect future tears down
/// the half-open socket rather than leaving it running behind a cancelled UI.
pub async fn connect(
    url: &str,
    token: &str,
    timeout: Duration,
    cancel: &CancellationToken,
) -> Result<TachyonSocket, WsConnectError> {
    tokio::select! {
        biased;
        _ = cancel.cancelled() => Err(WsConnectError::Cancelled),
        res = tokio::time::timeout(timeout, do_connect(url, token)) => {
            match res {
                Ok(inner) => inner,
                Err(_elapsed) => Err(WsConnectError::TimedOut),
            }
        }
    }
}

/// The connect itself: TCP, then TLS if the scheme asks for it, then the WebSocket
/// upgrade carrying the bearer token and the subprotocol offer.
async fn do_connect(url: &str, token: &str) -> Result<TachyonSocket, WsConnectError> {
    let target = Endpoint::parse(url)?;

    let tcp = TcpStream::connect((target.host.as_str(), target.port))
        .await
        .map_err(|e| {
            WsConnectError::Unreachable(format!(
                "connect {}:{} failed: {e}",
                target.host, target.port
            ))
        })?;

    let stream: Box<dyn AsyncReadWrite> = if target.tls {
        // Always verify. The self-signed escape hatch exists for uberserver
        // deployments on the line protocol, and Tachyon servers are public HTTPS.
        let config = client_config(false).map_err(WsConnectError::Unreachable)?;
        let name = rustls::pki_types::ServerName::try_from(target.host.clone())
            .map_err(|e| WsConnectError::BadUrl(format!("invalid server name: {e}")))?;
        let tls = TlsConnector::from(Arc::new(config))
            .connect(name, tcp)
            .await
            .map_err(|e| WsConnectError::Unreachable(format!("TLS handshake failed: {e}")))?;
        Box::new(tls)
    } else {
        Box::new(tcp)
    };

    let request = ClientRequestBuilder::new(target.uri)
        .with_header("Authorization", format!("Bearer {token}"))
        .with_sub_protocol(SUBPROTOCOL);

    let (ws, response) = tokio_tungstenite::client_async(request, stream)
        .await
        .map_err(handshake_error)?;

    // tungstenite already rejects a missing subprotocol and one we did not offer,
    // but we have to read the header out to record what was picked, so check it
    // here too rather than depend on that staying true.
    let subprotocol = response
        .headers()
        .get("Sec-WebSocket-Protocol")
        .and_then(|v| v.to_str().ok())
        .filter(|v| *v == SUBPROTOCOL)
        .ok_or_else(|| {
            WsConnectError::Protocol(format!(
                "server did not agree to protocol version {SUBPROTOCOL}"
            ))
        })?
        .to_string();

    Ok(TachyonSocket {
        ws,
        limiter: RateLimiter::new(SEND_BURST, SEND_RATE_PER_SEC),
        subprotocol,
    })
}

/// Where a Tachyon URL points, once we have decided we are willing to open it.
struct Endpoint {
    uri: Uri,
    host: String,
    port: u16,
    tls: bool,
}

impl Endpoint {
    /// Parse and vet a Tachyon URL. `wss://` anywhere, `ws://` only on loopback,
    /// because a plaintext WebSocket sends the bearer token in the clear.
    fn parse(url: &str) -> Result<Self, WsConnectError> {
        let uri: Uri = url
            .parse()
            .map_err(|e| WsConnectError::BadUrl(format!("{url}: {e}")))?;
        let host = uri
            .host()
            .ok_or_else(|| WsConnectError::BadUrl(format!("{url} has no host")))?
            .to_string();

        let tls = match uri.scheme_str() {
            Some("wss") => true,
            Some("ws") if is_loopback(&host) => false,
            Some("ws") => {
                return Err(WsConnectError::BadUrl(
                    "ws:// is only allowed for localhost, use wss://".into(),
                ))
            }
            other => {
                return Err(WsConnectError::BadUrl(format!(
                    "unsupported scheme {}, expected ws or wss",
                    other.unwrap_or("(none)")
                )))
            }
        };

        let port = uri.port_u16().unwrap_or(if tls { 443 } else { 80 });
        Ok(Self {
            uri,
            host,
            port,
            tls,
        })
    }
}

/// Whether a host names this machine. `[::1]` arrives from the URL with its
/// brackets already stripped.
fn is_loopback(host: &str) -> bool {
    host == "localhost" || host == "::1" || host.starts_with("127.")
}

/// Turn a failed upgrade into the split a user can act on. An HTTP response means
/// the server answered and refused, and its body is the diagnostic.
fn handshake_error(e: TungsteniteError) -> WsConnectError {
    match e {
        TungsteniteError::Http(response) => {
            let status = response.status().as_u16();
            let body = response
                .body()
                .as_ref()
                .map(|b| String::from_utf8_lossy(b).trim().to_string())
                .unwrap_or_default();
            WsConnectError::Rejected { status, body }
        }
        TungsteniteError::Io(e) => WsConnectError::Unreachable(e.to_string()),
        other => WsConnectError::Protocol(other.to_string()),
    }
}

/// Read the close code and body out of a close frame.
fn closed(frame: Option<CloseFrame>) -> WsError {
    match frame {
        Some(f) => WsError::Closed {
            code: Some(f.code.into()),
            reason: f.reason.to_string(),
        },
        None => WsError::Closed {
            code: None,
            reason: String::new(),
        },
    }
}

/// Map a library error onto ours, keeping a peer-sent close distinct from a broken
/// socket so the caller can tell a policy disconnect from a dropped network.
fn from_lib(e: TungsteniteError) -> WsError {
    match e {
        TungsteniteError::ConnectionClosed | TungsteniteError::AlreadyClosed => WsError::Closed {
            code: None,
            reason: String::new(),
        },
        TungsteniteError::Protocol(p) => WsError::Protocol(p.to_string()),
        TungsteniteError::Utf8(m) => WsError::Protocol(format!("invalid UTF-8: {m}")),
        TungsteniteError::Io(e) => WsError::Io(e.to_string()),
        other => WsError::Io(other.to_string()),
    }
}

/// A token bucket over the send path.
///
/// `burst` tokens are available immediately and the bucket refills at `per_sec`.
/// A send with no token waits for one, which is the simplest thing that keeps us
/// under a limit whose penalty is disconnection.
struct RateLimiter {
    burst: f64,
    per_sec: f64,
    tokens: f64,
    last: Instant,
}

impl RateLimiter {
    fn new(burst: f64, per_sec: f64) -> Self {
        Self {
            burst,
            per_sec,
            tokens: burst,
            last: Instant::now(),
        }
    }

    /// Wait until one token is free, then take it.
    async fn acquire(&mut self) {
        loop {
            let now = Instant::now();
            let earned = now.duration_since(self.last).as_secs_f64() * self.per_sec;
            self.tokens = (self.tokens + earned).min(self.burst);
            self.last = now;
            if self.tokens >= 1.0 {
                self.tokens -= 1.0;
                return;
            }
            let wait = (1.0 - self.tokens) / self.per_sec;
            tokio::time::sleep(Duration::from_secs_f64(wait)).await;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write as _;
    use tokio::io::AsyncWriteExt;
    use tokio::net::TcpListener;
    use tokio::sync::mpsc;
    use tokio_tungstenite::tungstenite::handshake::server::{
        ErrorResponse, Request as ServerRequest, Response as ServerResponse,
    };
    use tokio_tungstenite::tungstenite::http::HeaderValue;
    use tokio_tungstenite::tungstenite::protocol::frame::coding::CloseCode;
    use tokio_tungstenite::tungstenite::Utf8Bytes;

    /// A server that accepts one connection, agrees to `subprotocol` if given one,
    /// and then runs `body` over the socket. Returns the `ws://` URL to connect to.
    #[allow(
        clippy::result_large_err,
        reason = "the callback signature is tungstenite's"
    )]
    async fn serve<F, Fut>(subprotocol: Option<&'static str>, body: F) -> String
    where
        F: FnOnce(WebSocketStream<TcpStream>) -> Fut + Send + 'static,
        Fut: std::future::Future<Output = ()> + Send,
    {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        tokio::spawn(async move {
            let (sock, _) = listener.accept().await.unwrap();
            let on_upgrade = |_req: &ServerRequest, mut res: ServerResponse| {
                if let Some(p) = subprotocol {
                    res.headers_mut()
                        .insert("Sec-WebSocket-Protocol", HeaderValue::from_static(p));
                }
                Ok::<_, ErrorResponse>(res)
            };
            let ws = tokio_tungstenite::accept_hdr_async(sock, on_upgrade)
                .await
                .unwrap();
            body(ws).await;
        });
        format!("ws://127.0.0.1:{port}/tachyon")
    }

    /// Connect with a generous budget and no cancellation, which is what every test
    /// that is not about timeouts wants.
    async fn open(url: &str) -> Result<TachyonSocket, WsConnectError> {
        connect(
            url,
            "test-token",
            Duration::from_secs(5),
            &CancellationToken::new(),
        )
        .await
    }

    /// [`open`] for a connect that must fail. A live socket is not `Debug`, so
    /// `unwrap_err` is not available on the result.
    async fn open_err(url: &str) -> WsConnectError {
        match open(url).await {
            Err(e) => e,
            Ok(_) => panic!("expected the connect to {url} to fail"),
        }
    }

    #[tokio::test]
    #[allow(
        clippy::result_large_err,
        reason = "the callback signature is tungstenite's"
    )]
    async fn a_text_message_makes_the_round_trip() {
        // The server also records the upgrade headers so we can prove the bearer
        // token and the subprotocol offer actually went out on the wire.
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let (tx, mut rx) = mpsc::unbounded_channel::<(String, String)>();
        tokio::spawn(async move {
            let (sock, _) = listener.accept().await.unwrap();
            let on_upgrade = |req: &ServerRequest, mut res: ServerResponse| {
                let header = |name: &str| {
                    req.headers()
                        .get(name)
                        .and_then(|v| v.to_str().ok())
                        .unwrap_or_default()
                        .to_string()
                };
                let _ = tx.send((header("Authorization"), header("Sec-WebSocket-Protocol")));
                res.headers_mut().insert(
                    "Sec-WebSocket-Protocol",
                    HeaderValue::from_static(SUBPROTOCOL),
                );
                Ok::<_, ErrorResponse>(res)
            };
            let mut ws = tokio_tungstenite::accept_hdr_async(sock, on_upgrade)
                .await
                .unwrap();
            let got = ws.next().await.unwrap().unwrap();
            ws.send(Message::text(format!("echo:{}", got.into_text().unwrap())))
                .await
                .unwrap();
        });

        let mut socket = open(&format!("ws://127.0.0.1:{port}/tachyon"))
            .await
            .unwrap();
        assert_eq!(socket.subprotocol(), SUBPROTOCOL);
        socket.send(r#"{"type":"request"}"#).await.unwrap();
        assert_eq!(socket.recv().await.unwrap(), r#"echo:{"type":"request"}"#);

        let (auth, offered) = rx.recv().await.unwrap();
        assert_eq!(auth, "Bearer test-token");
        assert_eq!(offered, SUBPROTOCOL);
    }

    #[tokio::test]
    async fn a_server_that_agrees_to_no_subprotocol_is_rejected() {
        let url = serve(None, |_ws| async {}).await;
        let err = open_err(&url).await;
        assert!(
            matches!(err, WsConnectError::Protocol(_)),
            "expected a protocol error, got {err}"
        );
    }

    #[tokio::test]
    async fn a_subprotocol_we_did_not_offer_is_rejected() {
        let url = serve(Some("v9.tachyon"), |_ws| async {}).await;
        let err = open_err(&url).await;
        assert!(
            matches!(err, WsConnectError::Protocol(_)),
            "expected a protocol error, got {err}"
        );
    }

    #[tokio::test]
    async fn a_binary_frame_is_a_protocol_error() {
        let url = serve(Some(SUBPROTOCOL), |mut ws| async move {
            ws.send(Message::binary(vec![1, 2, 3])).await.unwrap();
            // Stay up so the client's error is the frame, not a dropped socket.
            std::future::pending::<()>().await;
        })
        .await;
        let mut socket = open(&url).await.unwrap();
        let err = socket.recv().await.unwrap_err();
        assert!(
            matches!(err, WsError::Protocol(_)),
            "expected a protocol error, got {err}"
        );
    }

    #[tokio::test]
    async fn a_policy_close_surfaces_its_code_and_body() {
        let url = serve(Some(SUBPROTOCOL), |mut ws| async move {
            ws.send(Message::Close(Some(CloseFrame {
                code: CloseCode::Policy,
                reason: Utf8Bytes::from_static("Rate limited"),
            })))
            .await
            .unwrap();
            std::future::pending::<()>().await;
        })
        .await;
        let mut socket = open(&url).await.unwrap();
        let err = socket.recv().await.unwrap_err();
        match err {
            WsError::Closed { code, reason } => {
                assert_eq!(code, Some(1008));
                assert_eq!(reason, "Rate limited");
                assert_eq!(
                    WsError::Closed { code, reason }.to_string(),
                    "closed with code 1008: Rate limited"
                );
            }
            other => panic!("expected a close, got {other}"),
        }
    }

    #[tokio::test]
    async fn the_client_answers_a_ping_without_being_asked() {
        // The server pings, then reads. If tungstenite did not queue and flush the
        // pong on the next read, this would sit here until the test timed out.
        let (tx, mut rx) = mpsc::unbounded_channel::<()>();
        let url = serve(Some(SUBPROTOCOL), move |mut ws| async move {
            ws.send(Message::Ping(Default::default())).await.unwrap();
            while let Some(Ok(msg)) = ws.next().await {
                if matches!(msg, Message::Pong(_)) {
                    let _ = tx.send(());
                    break;
                }
            }
            std::future::pending::<()>().await;
        })
        .await;

        let mut socket = open(&url).await.unwrap();
        // The caller only ever waits for a message. Answering the ping happens
        // inside this one call.
        let waiting = tokio::spawn(async move { socket.recv().await });
        tokio::time::timeout(Duration::from_secs(5), rx.recv())
            .await
            .expect("no pong arrived within 5 seconds")
            .expect("server task ended without seeing a pong");
        waiting.abort();
    }

    #[tokio::test]
    async fn a_refused_upgrade_carries_the_status_and_body() {
        // A plain HTTP server, which is what a Tachyon endpoint looks like when the
        // bearer token is missing or expired.
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        tokio::spawn(async move {
            let (mut sock, _) = listener.accept().await.unwrap();
            let body = br#"{"error":"unauthorized_client"}"#;
            let mut head = Vec::new();
            write!(
                head,
                "HTTP/1.1 401 Unauthorized\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n",
                body.len()
            )
            .unwrap();
            head.extend_from_slice(body);
            sock.write_all(&head).await.unwrap();
            sock.flush().await.unwrap();
            std::future::pending::<()>().await;
        });

        let err = open_err(&format!("ws://127.0.0.1:{port}/tachyon")).await;
        match err {
            WsConnectError::Rejected { status, body } => {
                assert_eq!(status, 401);
                assert_eq!(body, r#"{"error":"unauthorized_client"}"#);
            }
            other => panic!("expected a rejection, got {other}"),
        }
    }

    #[tokio::test]
    async fn an_unreachable_server_is_not_a_rejection() {
        // Port 1 on loopback has nothing listening, so the TCP connect fails.
        let err = open_err("ws://127.0.0.1:1/tachyon").await;
        assert!(
            matches!(err, WsConnectError::Unreachable(_)),
            "expected unreachable, got {err}"
        );
    }

    #[tokio::test]
    async fn plaintext_is_refused_off_loopback() {
        let err = open_err("ws://server4.beyondallreason.info/tachyon").await;
        assert!(
            matches!(err, WsConnectError::BadUrl(_)),
            "expected a bad url, got {err}"
        );
    }

    #[tokio::test]
    async fn an_already_cancelled_token_wins_immediately() {
        let cancel = CancellationToken::new();
        cancel.cancel();
        let res = connect(
            "wss://server4.beyondallreason.info/tachyon",
            "test-token",
            Duration::from_secs(30),
            &cancel,
        )
        .await;
        assert!(matches!(res, Err(WsConnectError::Cancelled)));
    }

    #[tokio::test]
    async fn the_limiter_makes_sends_wait_once_the_burst_is_spent() {
        // Small numbers so the test is quick. The shipped values are checked below.
        let mut limiter = RateLimiter::new(2.0, 10.0);
        let start = Instant::now();
        for _ in 0..4 {
            limiter.acquire().await;
        }
        // Two free, then two more at 10 a second.
        assert!(
            start.elapsed() >= Duration::from_millis(190),
            "four sends took {:?}, so the limiter did not hold them back",
            start.elapsed()
        );
    }

    /// The live endpoint refuses a connection with no bearer token, which is a
    /// check that needs no credentials. Ignored because CI has no network.
    #[tokio::test]
    #[ignore = "needs the live server"]
    async fn the_live_server_refuses_an_empty_token() {
        let res = connect(
            "wss://server4.beyondallreason.info/tachyon",
            "",
            Duration::from_secs(30),
            &CancellationToken::new(),
        )
        .await;
        let err = match res {
            Err(e) => e,
            Ok(_) => panic!("the live server accepted an empty token"),
        };
        match err {
            WsConnectError::Rejected { status, body } => {
                assert_eq!(status, 401);
                assert!(
                    body.contains("unauthorized_client"),
                    "unexpected body: {body}"
                );
            }
            other => panic!("expected a 401, got {other}"),
        }
    }
}
