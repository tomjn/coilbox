//! The real connection task against a real socket.
//!
//! A stand-in server on loopback, so what is under test is the socket, the
//! framing and the task that owns them rather than a mock of any of it. The one
//! thing loopback cannot prove is the TCP keepalive, which only shows up against
//! something that would otherwise forget the connection.

use std::time::Duration;

use coilbox_zerok_protocol::{line, types, ZerokMessage};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::mpsc;

use super::*;

/// A stand-in Zero-K server. Answers one connection, sends `send` on it, and
/// reports every line it is sent.
async fn serve(send: Vec<String>) -> (u16, mpsc::UnboundedReceiver<String>) {
    let listener = TcpListener::bind(("127.0.0.1", 0))
        .await
        .expect("bind a loopback port");
    let port = listener.local_addr().expect("it has an address").port();
    let (heard_tx, heard_rx) = mpsc::unbounded_channel();

    tokio::spawn(async move {
        let (socket, _) = listener.accept().await.expect("a client connects");
        let (read, mut write) = socket.into_split();
        for line in send {
            let framed = format!("{line}\n");
            if write.write_all(framed.as_bytes()).await.is_err() {
                return;
            }
        }
        let mut reader = BufReader::new(read).lines();
        while let Ok(Some(line)) = reader.next_line().await {
            if heard_tx.send(line).is_err() {
                return;
            }
        }
    });
    (port, heard_rx)
}

/// Everything the connection task emitted, drained once it has settled.
///
/// A `Channel` needs a Tauri app to build, which a unit test has no business
/// starting, so the task is driven directly and its socket end read here.
async fn connect_to(port: u16) -> TcpStream {
    let cancel = CancellationToken::new();
    connect("127.0.0.1", port, Duration::from_secs(5), &cancel)
        .await
        .unwrap_or_else(|_| panic!("connect to the stand-in server on {port}"))
}

#[tokio::test]
async fn the_server_speaks_first_and_the_line_parses() {
    // Zero-K sends Welcome unprompted. Nothing is written to get it.
    let welcome = r#"Welcome {"Engine":"105.1.1","Game":"Zero-K v1.12.6.0","UserCount":7}"#;
    let (port, _heard) = serve(vec![welcome.to_string()]).await;

    let stream = connect_to(port).await;
    let mut framed = Framed::new(stream, LinesCodec::new());
    let raw = tokio::time::timeout(Duration::from_secs(5), framed.next())
        .await
        .expect("the greeting arrives")
        .expect("there is a line")
        .expect("it reads");

    assert_eq!(raw, welcome, "the line arrives with its newline stripped");
    let Some(ZerokMessage::Welcome(parsed)) = line::parse_line(&raw) else {
        panic!("the greeting did not parse as a Welcome: {raw}");
    };
    assert_eq!(parsed.user_count, 7);
    assert_eq!(parsed.game.as_deref(), Some("Zero-K v1.12.6.0"));
}

#[tokio::test]
async fn a_body_holding_spaces_survives_the_socket() {
    // The one framing mistake worth a test of its own. A message split on every
    // space rather than the first loses everything after the first word.
    let said = r#"Say {"User":"someone","Text":"good game all","Place":0}"#;
    let (port, _heard) = serve(vec![said.to_string()]).await;

    let stream = connect_to(port).await;
    let mut framed = Framed::new(stream, LinesCodec::new());
    let raw = tokio::time::timeout(Duration::from_secs(5), framed.next())
        .await
        .expect("the line arrives")
        .expect("there is a line")
        .expect("it reads");

    let Some(ZerokMessage::Say(say)) = line::parse_line(&raw) else {
        panic!("Say did not parse: {raw}");
    };
    assert_eq!(say.text.as_deref(), Some("good game all"));
    assert_eq!(say.user.as_deref(), Some("someone"));
}

#[tokio::test]
async fn a_line_the_server_could_not_have_sent_does_not_end_the_connection() {
    // Upstream throws on a line with no space in it. There is nothing useful to
    // do with one, but dropping the connection over it would be worse.
    let (port, _heard) = serve(vec![
        "nonsense".to_string(),
        r#"DefaultEngineChanged {"Engine":"105.1.1"}"#.to_string(),
    ])
    .await;

    let stream = connect_to(port).await;
    let mut framed = Framed::new(stream, LinesCodec::new());
    let mut seen = Vec::new();
    for _ in 0..2 {
        let raw = tokio::time::timeout(Duration::from_secs(5), framed.next())
            .await
            .expect("a line arrives")
            .expect("there is a line")
            .expect("it reads");
        seen.push(line::parse_line(&raw));
    }
    assert!(seen[0].is_none(), "a line with no space is not a line");
    assert!(
        matches!(seen[1], Some(ZerokMessage::DefaultEngineChanged(_))),
        "the line after it still reads"
    );
}

#[tokio::test]
async fn a_command_reaches_the_server_as_one_line() {
    let (port, mut heard) = serve(Vec::new()).await;
    let stream = connect_to(port).await;
    let mut framed = Framed::new(stream, LinesCodec::new());

    let out = line::to_line(&types::JoinChannel {
        channel_name: Some("zk".into()),
        password: None,
    })
    .expect("JoinChannel serialises");
    framed.send(out.clone()).await.expect("it goes out");

    let arrived = tokio::time::timeout(Duration::from_secs(5), heard.recv())
        .await
        .expect("the server hears it")
        .expect("it is a line");
    assert_eq!(arrived, out);
    // A password left unset is left out, not sent as null. Upstream's serialiser
    // does the same, and its server reads an explicit null as no password.
    assert_eq!(arrived, r#"JoinChannel {"ChannelName":"zk"}"#);
}

#[tokio::test]
async fn a_connect_that_is_cancelled_does_not_open() {
    let cancel = CancellationToken::new();
    cancel.cancel();
    // Port 1 on loopback, which nothing listens on, so the only way this returns
    // anything other than Cancelled is by ignoring the token.
    let opened = connect("127.0.0.1", 1, Duration::from_secs(5), &cancel).await;
    assert!(matches!(opened, Err(ConnectError::Cancelled)));
}

#[tokio::test]
async fn a_connect_to_nothing_says_so_rather_than_hanging() {
    let cancel = CancellationToken::new();
    // A port nothing is bound to, taken and released so the number is real and
    // free rather than picked out of the air.
    let listener = TcpListener::bind(("127.0.0.1", 0)).await.expect("bind");
    let port = listener.local_addr().expect("an address").port();
    drop(listener);

    let opened = connect("127.0.0.1", port, Duration::from_secs(5), &cancel).await;
    match opened {
        Err(ConnectError::Failed(message)) => {
            assert!(message.contains(&port.to_string()), "it names the port");
        }
        Err(ConnectError::TimedOut) => {
            panic!("a refused connection should fail rather than time out")
        }
        Err(ConnectError::Cancelled) => panic!("nothing cancelled it"),
        Ok(_) => panic!("nothing is listening there"),
    }
}
