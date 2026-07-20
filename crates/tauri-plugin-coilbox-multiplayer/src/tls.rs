//! Socket setup and the STLS/TLS upgrade.
//!
//! The lobby protocol runs over a plain TCP line stream. uberserver (and Recoil's
//! Chobby ecosystem) negotiate TLS *in-band* via `STLS`: the server sends its
//! plaintext greeting, the client replies `STLS`, the server acknowledges with
//! `OK cmd=STLS` and then expects the TLS ClientHello on the same socket. We do
//! this upgrade up-front here so the main read loop always sees a clean,
//! already-secured stream and never has to special-case the handshake.

use std::sync::Arc;
use std::time::Duration;

use tokio::io::{AsyncBufReadExt, AsyncRead, AsyncWrite, AsyncWriteExt, BufReader};
use tokio::net::TcpStream;
use tokio_rustls::TlsConnector;
use tokio_util::sync::CancellationToken;

/// A boxed, object-safe duplex byte stream. Both the plain-TCP and the TLS cases
/// erase to this so `conn.rs` can frame either identically. tokio provides the
/// `AsyncRead`/`AsyncWrite` impls for `Box<dyn _>` via its blanket `Box<T>`
/// forwards, so `Framed` accepts the boxed value directly.
pub trait AsyncReadWrite: AsyncRead + AsyncWrite + Unpin + Send {}
impl<T: AsyncRead + AsyncWrite + Unpin + Send> AsyncReadWrite for T {}

/// Connect to `host:port`, optionally performing the STLS upgrade, returning a
/// ready-to-frame byte stream.
///
/// When `tls` is set we drive the uberserver STLS dance: read and discard the
/// plaintext greeting, send `STLS`, read and discard the `OK cmd=STLS` line, then
/// hand the raw socket to rustls. The server re-sends a fresh greeting on the
/// encrypted channel, which the caller's read loop consumes normally.
pub async fn connect_stream(
    host: &str,
    port: u16,
    tls: bool,
    allow_self_signed: bool,
) -> Result<Box<dyn AsyncReadWrite>, String> {
    let tcp = TcpStream::connect((host, port))
        .await
        .map_err(|e| format!("connect {host}:{port} failed: {e}"))?;

    if !tls {
        return Ok(Box::new(tcp));
    }

    // STLS handshake over the plaintext socket. We buffer only to `read_line` the
    // two control lines; the server stays silent after `OK cmd=STLS` until it
    // receives our TLS ClientHello, so nothing is buffered past that line and
    // `into_inner()` cannot drop unread application bytes.
    let mut buf = BufReader::new(tcp);
    let mut line = String::new();
    buf.read_line(&mut line)
        .await
        .map_err(|e| format!("reading greeting failed: {e}"))?;
    buf.write_all(b"STLS\n")
        .await
        .map_err(|e| format!("sending STLS failed: {e}"))?;
    buf.flush()
        .await
        .map_err(|e| format!("flushing STLS failed: {e}"))?;
    line.clear();
    buf.read_line(&mut line)
        .await
        .map_err(|e| format!("reading STLS ack failed: {e}"))?;
    let tcp = buf.into_inner();

    let connector = TlsConnector::from(Arc::new(client_config(allow_self_signed)?));
    let server_name = rustls::pki_types::ServerName::try_from(host.to_string())
        .map_err(|e| format!("invalid server name {host}: {e}"))?;
    let tls_stream = connector
        .connect(server_name, tcp)
        .await
        .map_err(|e| format!("TLS handshake failed: {e}"))?;
    Ok(Box::new(tls_stream))
}

/// Why an in-flight connect ended without a stream. `Cancelled` and `TimedOut` are
/// the two abandon paths this issue adds; `Failed` carries the underlying
/// connect/handshake error string for the ordinary failure case.
pub enum ConnectError {
    /// The caller fired the [`CancellationToken`] (user hit Cancel).
    Cancelled,
    /// The connect exceeded its budget without resolving (stuck handshake).
    TimedOut,
    /// The connect/STLS/TLS attempt itself failed; message is user-facing.
    Failed(String),
}

/// [`connect_stream`] with two escape hatches so a stuck handshake can't hang
/// forever: a hard `timeout` backstop and a `cancel` token the frontend can fire to
/// abandon the attempt immediately. The `select!` is `biased` toward the token so an
/// already-fired cancel wins deterministically over a connect that resolves in the
/// same poll. Dropping the connect future here tears down the half-open socket/TLS
/// state, which is what makes the cancel a real teardown rather than a visual one.
pub async fn connect_stream_cancellable(
    host: &str,
    port: u16,
    tls: bool,
    allow_self_signed: bool,
    timeout: Duration,
    cancel: &CancellationToken,
) -> Result<Box<dyn AsyncReadWrite>, ConnectError> {
    tokio::select! {
        biased;
        _ = cancel.cancelled() => Err(ConnectError::Cancelled),
        res = tokio::time::timeout(timeout, connect_stream(host, port, tls, allow_self_signed)) => {
            match res {
                Ok(Ok(stream)) => Ok(stream),
                Ok(Err(e)) => Err(ConnectError::Failed(e)),
                Err(_elapsed) => Err(ConnectError::TimedOut),
            }
        }
    }
}

/// Build the rustls client config. Normally we verify against the webpki root
/// bundle; only when the user has explicitly ticked "allow self-signed" (uberserver
/// ships a self-signed cert; teiserver does not) do we swap in the accept-anything
/// [`NoVerify`] verifier.
fn client_config(allow_self_signed: bool) -> Result<rustls::ClientConfig, String> {
    // Pin the ring provider explicitly rather than relying on a process-wide
    // default being installed elsewhere in the app.
    let provider = Arc::new(rustls::crypto::ring::default_provider());
    let builder = rustls::ClientConfig::builder_with_provider(provider.clone())
        .with_safe_default_protocol_versions()
        .map_err(|e| format!("tls config: {e}"))?;

    let config = if allow_self_signed {
        builder
            .dangerous()
            .with_custom_certificate_verifier(Arc::new(NoVerify(provider)))
            .with_no_client_auth()
    } else {
        let mut roots = rustls::RootCertStore::empty();
        roots.extend(webpki_roots::TLS_SERVER_ROOTS.iter().cloned());
        builder.with_root_certificates(roots).with_no_client_auth()
    };
    Ok(config)
}

/// A certificate verifier that accepts any server certificate.
///
/// DANGER: this defeats TLS authentication entirely. It is reachable ONLY when the
/// user has ticked "allow self-signed" for a specific configured server, which is
/// how uberserver's self-signed deployments are expected to be used. It is never
/// wired up for the default (webpki-verified) path.
#[derive(Debug)]
struct NoVerify(Arc<rustls::crypto::CryptoProvider>);

impl rustls::client::danger::ServerCertVerifier for NoVerify {
    fn verify_server_cert(
        &self,
        _end_entity: &rustls::pki_types::CertificateDer<'_>,
        _intermediates: &[rustls::pki_types::CertificateDer<'_>],
        _server_name: &rustls::pki_types::ServerName<'_>,
        _ocsp_response: &[u8],
        _now: rustls::pki_types::UnixTime,
    ) -> Result<rustls::client::danger::ServerCertVerified, rustls::Error> {
        Ok(rustls::client::danger::ServerCertVerified::assertion())
    }

    fn verify_tls12_signature(
        &self,
        _message: &[u8],
        _cert: &rustls::pki_types::CertificateDer<'_>,
        _dss: &rustls::DigitallySignedStruct,
    ) -> Result<rustls::client::danger::HandshakeSignatureValid, rustls::Error> {
        Ok(rustls::client::danger::HandshakeSignatureValid::assertion())
    }

    fn verify_tls13_signature(
        &self,
        _message: &[u8],
        _cert: &rustls::pki_types::CertificateDer<'_>,
        _dss: &rustls::DigitallySignedStruct,
    ) -> Result<rustls::client::danger::HandshakeSignatureValid, rustls::Error> {
        Ok(rustls::client::danger::HandshakeSignatureValid::assertion())
    }

    fn supported_verify_schemes(&self) -> Vec<rustls::SignatureScheme> {
        self.0.signature_verification_algorithms.supported_schemes()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::net::TcpListener;

    /// A listener that accepts one connection and then goes silent forever, so a
    /// `tls` connect stalls on the STLS greeting read (never the TLS handshake) —
    /// the same shape as a real slow/broken server. Returns the bound port.
    async fn stalled_server() -> u16 {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        tokio::spawn(async move {
            let _held = listener.accept().await; // hold the socket open, say nothing
            std::future::pending::<()>().await;
        });
        port
    }

    #[tokio::test]
    async fn connect_times_out_on_a_stalled_handshake() {
        let port = stalled_server().await;
        let token = CancellationToken::new();
        let res = connect_stream_cancellable(
            "127.0.0.1",
            port,
            true,
            true,
            Duration::from_millis(150),
            &token,
        )
        .await;
        assert!(matches!(res, Err(ConnectError::TimedOut)));
    }

    #[tokio::test]
    async fn cancel_aborts_an_in_flight_connect_before_the_timeout() {
        let port = stalled_server().await;
        let token = CancellationToken::new();
        let fire = token.clone();
        // Cancel once the connect is surely parked on the greeting read; a 30s
        // timeout guarantees the token, not the backstop, is what ends it.
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(50)).await;
            fire.cancel();
        });
        let res = connect_stream_cancellable(
            "127.0.0.1",
            port,
            true,
            true,
            Duration::from_secs(30),
            &token,
        )
        .await;
        assert!(matches!(res, Err(ConnectError::Cancelled)));
    }

    #[tokio::test]
    async fn an_already_cancelled_token_wins_immediately() {
        let port = stalled_server().await;
        let token = CancellationToken::new();
        token.cancel();
        let res = connect_stream_cancellable(
            "127.0.0.1",
            port,
            true,
            true,
            Duration::from_secs(30),
            &token,
        )
        .await;
        assert!(matches!(res, Err(ConnectError::Cancelled)));
    }
}
