//! TURN over TLS, for a host whose network drops UDP (issue #1698).
//!
//! The `turn` crate speaks to its server through whatever `Conn` it is given
//! and has no TLS of its own. [`TlsConn`] is a `Conn` that carries each of its
//! messages over one TLS stream. Only the leg between the host and the relay
//! changes: the allocation is still a UDP relay, so players send to it exactly
//! as they always have.
//!
//! ## Framing
//!
//! A stream has no datagram boundaries, so each message has to be read back
//! out by its own length (RFC 8656 section 12.5). The first two bits tell the
//! two kinds apart:
//!
//! - `00` is a STUN message, a 20 byte header then the length in bytes 2 and 3.
//! - `01` is ChannelData, a 4 byte header then the length in bytes 2 and 3,
//!   padded to a multiple of four over a stream. The `turn` crate always pads
//!   what it sends (`ChannelData::encode`), and reads a padded one fine.
//!
//! Anything else means the stream has lost its place, and there is no finding
//! it again, so the connection is treated as broken.

use std::io;
use std::net::SocketAddr;
use std::sync::Arc;

use async_trait::async_trait;
use rustls::pki_types::ServerName;
use tokio::io::{AsyncReadExt, AsyncWriteExt, ReadHalf, WriteHalf};
use tokio::net::TcpStream;
use tokio::sync::Mutex;
use tokio_rustls::client::TlsStream;
use tokio_rustls::TlsConnector;
use webrtc_util::Conn;

const STUN_HEADER: usize = 20;
const CHANNEL_DATA_HEADER: usize = 4;

/// The client config for a relay's certificate: the webpki roots, as the lobby
/// connection uses when self-signed certificates are not allowed.
///
/// There is no self-signed option here. The relay password never crosses the
/// wire, but what TLS is for on this leg is getting through a network that
/// only lets TLS out, and a relay operator who offers `turns:` is told to use a
/// certificate clients already trust (uberserver's
/// `docs/ops/relay-hosting-setup.md`).
pub fn client_config() -> Arc<rustls::ClientConfig> {
    let mut roots = rustls::RootCertStore::empty();
    roots.extend(webpki_roots::TLS_SERVER_ROOTS.iter().cloned());
    with_roots(roots)
}

/// A client config that trusts `roots`, and nothing else.
pub fn with_roots(roots: rustls::RootCertStore) -> Arc<rustls::ClientConfig> {
    // The ring provider named rather than taken from a process default, the
    // same as the lobby connection, because nothing in this process installs
    // one.
    let provider = Arc::new(rustls::crypto::ring::default_provider());
    let config = rustls::ClientConfig::builder_with_provider(provider)
        .with_safe_default_protocol_versions()
        .expect("the ring provider supports the default protocol versions")
        .with_root_certificates(roots)
        .with_no_client_auth();
    Arc::new(config)
}

/// One TLS connection to a TURN server, as the `Conn` the TURN client takes.
pub struct TlsConn {
    reader: Mutex<ReadHalf<TlsStream<TcpStream>>>,
    writer: Mutex<WriteHalf<TlsStream<TcpStream>>>,
    local: SocketAddr,
    server: SocketAddr,
}

impl TlsConn {
    /// Connect to `addr`, a `host:port`, and check its certificate against
    /// `config`.
    pub async fn connect(addr: &str, config: Arc<rustls::ClientConfig>) -> io::Result<TlsConn> {
        let host = host_of(addr);
        let name = ServerName::try_from(host.to_string()).map_err(|e| {
            io::Error::new(
                io::ErrorKind::InvalidInput,
                format!("{host} cannot be checked against a certificate: {e}"),
            )
        })?;
        let tcp = TcpStream::connect(addr).await?;
        // A relayed game is small datagrams in both directions, and Nagle
        // would hold each one back waiting for the next.
        tcp.set_nodelay(true)?;
        let local = tcp.local_addr()?;
        let server = tcp.peer_addr()?;
        let stream = TlsConnector::from(config).connect(name, tcp).await?;
        let (reader, writer) = tokio::io::split(stream);
        Ok(TlsConn {
            reader: Mutex::new(reader),
            writer: Mutex::new(writer),
            local,
            server,
        })
    }

    /// The next whole message off the stream, into `buf`.
    ///
    /// Only ever called from the TURN client's one read loop, which is
    /// cancelled only when the client is closed, so a read that stops halfway
    /// through a message never has a next read to confuse.
    async fn read_message(&self, buf: &mut [u8]) -> io::Result<usize> {
        let mut reader = self.reader.lock().await;
        let mut head = [0u8; CHANNEL_DATA_HEADER];
        reader.read_exact(&mut head).await?;
        let length = usize::from(u16::from_be_bytes([head[2], head[3]]));
        let total = match head[0] >> 6 {
            0b00 => STUN_HEADER + length,
            0b01 => CHANNEL_DATA_HEADER + length.next_multiple_of(4),
            _ => {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidData,
                    "the relay sent something that is neither STUN nor ChannelData",
                ))
            }
        };
        if total > buf.len() {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                format!(
                    "the relay sent a {total} byte message, larger than the {} bytes read into",
                    buf.len()
                ),
            ));
        }
        buf[..CHANNEL_DATA_HEADER].copy_from_slice(&head);
        reader
            .read_exact(&mut buf[CHANNEL_DATA_HEADER..total])
            .await?;
        Ok(total)
    }

    async fn write_message(&self, buf: &[u8]) -> io::Result<usize> {
        let mut writer = self.writer.lock().await;
        writer.write_all(buf).await?;
        writer.flush().await?;
        Ok(buf.len())
    }
}

/// The host part of `host:port`, without the brackets an IPv6 address is
/// written in.
fn host_of(addr: &str) -> &str {
    let host = addr.rsplit_once(':').map_or(addr, |(host, _)| host);
    host.strip_prefix('[')
        .and_then(|host| host.strip_suffix(']'))
        .unwrap_or(host)
}

/// Everything is sent to, and heard from, the one server at the other end of
/// the stream. The TURN client only ever talks to its TURN server, because the
/// agent gives it no STUN server.
#[async_trait]
impl Conn for TlsConn {
    async fn connect(&self, _addr: SocketAddr) -> Result<(), webrtc_util::Error> {
        Err(webrtc_util::Error::Other(
            "a TLS relay connection is connected when it is made".to_string(),
        ))
    }

    async fn recv(&self, buf: &mut [u8]) -> Result<usize, webrtc_util::Error> {
        Ok(self.read_message(buf).await?)
    }

    async fn recv_from(&self, buf: &mut [u8]) -> Result<(usize, SocketAddr), webrtc_util::Error> {
        Ok((self.read_message(buf).await?, self.server))
    }

    async fn send(&self, buf: &[u8]) -> Result<usize, webrtc_util::Error> {
        Ok(self.write_message(buf).await?)
    }

    async fn send_to(&self, buf: &[u8], _target: SocketAddr) -> Result<usize, webrtc_util::Error> {
        Ok(self.write_message(buf).await?)
    }

    fn local_addr(&self) -> Result<SocketAddr, webrtc_util::Error> {
        Ok(self.local)
    }

    fn remote_addr(&self) -> Option<SocketAddr> {
        Some(self.server)
    }

    async fn close(&self) -> Result<(), webrtc_util::Error> {
        Ok(self.writer.lock().await.shutdown().await?)
    }

    fn as_any(&self) -> &(dyn std::any::Any + Send + Sync) {
        self
    }
}

#[cfg(test)]
pub(crate) mod tests {
    //! A TLS server on loopback with a test certificate, and the messages that
    //! go over it.
    //!
    //! The certificate in `tests/tls/` is for `localhost` and `127.0.0.1`,
    //! signed by the CA beside it, and both last until 2126.
    //! `tests/tls/README.md` has the command that made them.

    use super::*;
    use rustls::pki_types::pem::PemObject;
    use rustls::pki_types::{CertificateDer, PrivateKeyDer};
    use std::net::Ipv4Addr;
    use tokio::net::TcpListener;
    use tokio_rustls::TlsAcceptor;

    const CA: &[u8] = include_bytes!("../tests/tls/ca.pem");
    const CERT: &[u8] = include_bytes!("../tests/tls/relay.pem");
    const KEY: &[u8] = include_bytes!("../tests/tls/relay.key");

    /// A client config that trusts the test CA.
    pub(crate) fn trusting_the_test_ca() -> Arc<rustls::ClientConfig> {
        let mut roots = rustls::RootCertStore::empty();
        roots
            .add(CertificateDer::from_pem_slice(CA).expect("the test CA is a certificate"))
            .expect("the test CA is a usable root");
        with_roots(roots)
    }

    /// Accept TLS connections with the test certificate, and hand each one to
    /// `serve`.
    pub(crate) async fn tls_server<F, Fut>(serve: F) -> SocketAddr
    where
        F: Fn(tokio_rustls::server::TlsStream<TcpStream>) -> Fut + Send + Sync + 'static,
        Fut: std::future::Future<Output = ()> + Send + 'static,
    {
        let provider = Arc::new(rustls::crypto::ring::default_provider());
        let config = rustls::ServerConfig::builder_with_provider(provider)
            .with_safe_default_protocol_versions()
            .expect("the default protocol versions")
            .with_no_client_auth()
            .with_single_cert(
                vec![CertificateDer::from_pem_slice(CERT).expect("the test certificate")],
                PrivateKeyDer::from_pem_slice(KEY).expect("the test key"),
            )
            .expect("a certificate and key that belong together");
        let acceptor = TlsAcceptor::from(Arc::new(config));
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0))
            .await
            .expect("a free loopback port");
        let addr = listener.local_addr().expect("a bound address");
        tokio::spawn(async move {
            while let Ok((tcp, _)) = listener.accept().await {
                let acceptor = acceptor.clone();
                let served = serve(acceptor.accept(tcp).await.expect("a TLS handshake"));
                tokio::spawn(served);
            }
        });
        addr
    }

    /// A STUN Binding request, which starts `00`, with `extra` bytes of body.
    fn stun_message(extra: u16) -> Vec<u8> {
        let mut message = vec![0u8; STUN_HEADER + usize::from(extra)];
        message[0..2].copy_from_slice(&0x0001u16.to_be_bytes());
        message[2..4].copy_from_slice(&extra.to_be_bytes());
        message[4..8].copy_from_slice(&0x2112_A442u32.to_be_bytes());
        message
    }

    /// ChannelData on channel 0x4000, padded the way the `turn` crate pads it.
    fn channel_data(payload: &[u8]) -> Vec<u8> {
        let mut message = vec![0x40, 0x00];
        message.extend_from_slice(&(payload.len() as u16).to_be_bytes());
        message.extend_from_slice(payload);
        message.resize(message.len().next_multiple_of(4), 0);
        message
    }

    /// Two messages written in one go come back as two messages, which is the
    /// whole job of the framing. A stream would otherwise hand them over as
    /// one lump, or split one in half.
    #[tokio::test]
    async fn messages_written_together_are_read_back_one_at_a_time() {
        let stun = stun_message(8);
        let data = channel_data(b"hello");
        let sent = [stun.clone(), data.clone()].concat();
        let addr = tls_server(move |mut stream| {
            let sent = sent.clone();
            async move {
                stream.write_all(&sent).await.expect("the client is there");
                stream.flush().await.expect("the client is there");
                // Held open, so the client reads messages rather than an end.
                std::future::pending::<()>().await;
            }
        })
        .await;

        let conn = TlsConn::connect(&addr.to_string(), trusting_the_test_ca())
            .await
            .expect("a TLS connection the test CA vouches for");
        let mut buf = vec![0u8; 1500];

        let (read, from) = conn.recv_from(&mut buf).await.expect("the STUN message");
        assert_eq!(&buf[..read], &stun[..]);
        assert_eq!(
            from, addr,
            "the TURN client needs to hear it came from its server"
        );
        let (read, _) = conn.recv_from(&mut buf).await.expect("the ChannelData");
        assert_eq!(
            &buf[..read],
            &data[..],
            "ChannelData is read with its padding, so the next message starts where it should"
        );
    }

    /// What the client sends arrives as it was written.
    #[tokio::test]
    async fn a_message_sent_arrives_whole() {
        let (heard, mut hears) = tokio::sync::mpsc::unbounded_channel();
        let addr = tls_server(move |mut stream| {
            let heard = heard.clone();
            async move {
                let mut buf = vec![0u8; STUN_HEADER + 4];
                stream.read_exact(&mut buf).await.expect("a whole message");
                let _ = heard.send(buf);
            }
        })
        .await;

        let conn = TlsConn::connect(&addr.to_string(), trusting_the_test_ca())
            .await
            .expect("a TLS connection the test CA vouches for");
        let message = stun_message(4);
        conn.send_to(&message, addr).await.expect("sent");

        assert_eq!(hears.recv().await, Some(message));
    }

    /// A stream that has lost its place cannot find it again, so it has to
    /// stop rather than hand the TURN client garbage.
    #[tokio::test]
    async fn bytes_that_are_neither_stun_nor_channel_data_break_the_connection() {
        let addr = tls_server(|mut stream| async move {
            stream
                .write_all(&[0xC0, 0, 0, 0])
                .await
                .expect("the client is there");
            stream.flush().await.expect("the client is there");
            std::future::pending::<()>().await;
        })
        .await;

        let conn = TlsConn::connect(&addr.to_string(), trusting_the_test_ca())
            .await
            .expect("a TLS connection the test CA vouches for");
        let mut buf = vec![0u8; 1500];
        let failed = conn
            .recv_from(&mut buf)
            .await
            .expect_err("nothing sensible can be read from here");
        assert!(
            failed.to_string().contains("neither STUN nor ChannelData"),
            "{failed}"
        );
    }

    /// A relay whose certificate nobody vouches for is refused, which is the
    /// difference between TLS and a stream that happens to be encrypted.
    #[tokio::test]
    async fn a_certificate_the_roots_do_not_vouch_for_is_refused() {
        let addr = tls_server(|_| async {}).await;
        let refused = TlsConn::connect(&addr.to_string(), client_config())
            .await
            .err()
            .expect("the public roots do not include the test CA");
        assert!(refused.to_string().contains("certificate"), "{refused}");
    }

    #[test]
    fn the_name_checked_is_the_host_without_its_port() {
        assert_eq!(host_of("relay.example.org:5349"), "relay.example.org");
        assert_eq!(host_of("127.0.0.1:5349"), "127.0.0.1");
        assert_eq!(host_of("[2001:db8::1]:5349"), "2001:db8::1");
    }
}
