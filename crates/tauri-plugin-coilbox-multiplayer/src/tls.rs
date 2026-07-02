//! Socket setup and the STLS/TLS upgrade.
//!
//! The lobby protocol runs over a plain TCP line stream. uberserver (and Recoil's
//! Chobby ecosystem) negotiate TLS *in-band* via `STLS`: the server sends its
//! plaintext greeting, the client replies `STLS`, the server acknowledges with
//! `OK cmd=STLS` and then expects the TLS ClientHello on the same socket. We do
//! this upgrade up-front here so the main read loop always sees a clean,
//! already-secured stream and never has to special-case the handshake.

use std::sync::Arc;

use tokio::io::{AsyncBufReadExt, AsyncRead, AsyncWrite, AsyncWriteExt, BufReader};
use tokio::net::TcpStream;
use tokio_rustls::TlsConnector;

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
