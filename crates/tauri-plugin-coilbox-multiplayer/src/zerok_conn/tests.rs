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

// -------------------------------------------------------------------------
// The login exchange, through the whole connection task.
// -------------------------------------------------------------------------

/// How long a test waits for something that should happen in milliseconds.
const PATIENCE: Duration = Duration::from_secs(5);

/// A stand-in server that greets the way Zero-K's does, keeps whatever the
/// client answers with, and replies with `answer`.
///
/// The greeting goes out unprompted, because that is the behaviour under test:
/// a client that waits to be asked never logs in.
///
/// It answers only the command the answer is a response to, which the real
/// server also does and which matters more than it looks. Answering whatever
/// arrives lets every test about the response pass while the client sends the
/// wrong command entirely.
async fn greet_and_answer(answer: Option<String>) -> (u16, Arc<Mutex<Vec<String>>>) {
    let listener = TcpListener::bind(("127.0.0.1", 0))
        .await
        .expect("bind a loopback port");
    let port = listener.local_addr().expect("it has an address").port();
    let heard: Arc<Mutex<Vec<String>>> = Arc::default();
    let keep = Arc::clone(&heard);
    let asked = answer.as_deref().map(expected_request).map(str::to_string);

    tokio::spawn(async move {
        let (socket, _) = listener.accept().await.expect("a client connects");
        let (read, mut write) = socket.into_split();
        let greeting = "Welcome {\"Engine\":\"105.1.1\",\"UserCount\":3}\n";
        if write.write_all(greeting.as_bytes()).await.is_err() {
            return;
        }
        let mut reader = BufReader::new(read).lines();
        while let Ok(Some(line)) = reader.next_line().await {
            let name = line::split_line(&line)
                .map(|(name, _)| name.to_string())
                .unwrap_or_default();
            let first = {
                let mut kept = keep.lock().unwrap_or_else(|e| e.into_inner());
                kept.push(line);
                kept.len() == 1
            };
            if first && asked.as_deref() == Some(name.as_str()) {
                if let Some(answer) = &answer {
                    let framed = format!("{answer}\n");
                    if write.write_all(framed.as_bytes()).await.is_err() {
                        return;
                    }
                }
            }
        }
    });
    (port, heard)
}

/// The command a response answers, so the stand-in server can hold back an
/// answer to something the client never asked.
fn expected_request(answer: &str) -> &'static str {
    match line::split_line(answer).map(|(name, _)| name) {
        Some("LoginResponse") => "Login",
        Some("RegisterResponse") => "Register",
        other => panic!("no request is known to produce {other:?}"),
    }
}

/// One connected client, with everything a test needs to watch it.
struct Client {
    key: String,
    registry: Registry,
    /// Every event the connection streamed, as the JSON the frontend receives.
    events: Arc<Mutex<Vec<String>>>,
}

impl Client {
    async fn connect(port: u16, username: &str) -> Client {
        Client::open(port, username, LoginMode::Login).await
    }

    /// The same, answering the greeting with `Register` instead.
    async fn register(port: u16, username: &str, email: Option<&str>) -> Client {
        let mode = LoginMode::Register {
            email: email.map(str::to_string),
        };
        Client::open(port, username, mode).await
    }

    async fn open(port: u16, username: &str, mode: LoginMode) -> Client {
        let stream = connect_to(port).await;
        let events: Arc<Mutex<Vec<String>>> = Arc::default();
        let sink = Arc::clone(&events);
        let channel = Channel::new(move |body: tauri::ipc::InvokeResponseBody| {
            if let tauri::ipc::InvokeResponseBody::Json(json) = body {
                sink.lock().unwrap_or_else(|e| e.into_inner()).push(json);
            }
            Ok(())
        });
        let registry = Registry::default();
        let key = format!("{username}@127.0.0.1:{port}");
        spawn_connection(
            registry.clone(),
            key.clone(),
            stream,
            ZerokLogin {
                username: username.to_string(),
                password_hash: "X03MO1qnZdYdgyfeuILPmQ==".to_string(),
                lobby_version: "Coilbox 9.9.9".to_string(),
                install_id: "test-install".to_string(),
                mode,
            },
            channel,
        );
        Client {
            key,
            registry,
            events,
        }
    }

    /// The phase this connection has reached, or `None` once it has been torn
    /// down and evicted from the registry.
    fn phase(&self) -> Option<LoginPhase> {
        let registry = self.registry.lock().unwrap_or_else(|e| e.into_inner());
        registry.get(&self.key).map(|c| *c.phase.borrow())
    }

    /// The name this connection believes it is logged in as.
    fn username(&self) -> Option<String> {
        let registry = self.registry.lock().unwrap_or_else(|e| e.into_inner());
        let name = registry
            .get(&self.key)?
            .state
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .my_username
            .clone();
        name
    }

    /// Every event streamed so far, parsed.
    fn events(&self) -> Vec<serde_json::Value> {
        self.events
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .iter()
            .filter_map(|raw| serde_json::from_str(raw).ok())
            .collect()
    }

    /// The first event of a kind, if one has arrived.
    fn event(&self, kind: &str) -> Option<serde_json::Value> {
        self.events()
            .into_iter()
            .find(|event| event["kind"] == kind || event["delta"]["kind"] == kind)
    }

    async fn wait_for(&self, kind: &'static str) -> serde_json::Value {
        let deadline = std::time::Instant::now() + PATIENCE;
        while std::time::Instant::now() < deadline {
            if let Some(event) = self.event(kind) {
                return event;
            }
            tokio::time::sleep(Duration::from_millis(2)).await;
        }
        panic!("timed out waiting for a {kind} event on {}", self.key);
    }
}

/// The line the client answered the greeting with, once it has answered.
async fn first_line(heard: &Arc<Mutex<Vec<String>>>) -> String {
    let deadline = std::time::Instant::now() + PATIENCE;
    while std::time::Instant::now() < deadline {
        if let Some(line) = heard
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .first()
            .cloned()
        {
            return line;
        }
        tokio::time::sleep(Duration::from_millis(2)).await;
    }
    panic!("the client never answered the greeting");
}

#[tokio::test]
async fn the_greeting_is_answered_with_a_login() {
    let (port, heard) = greet_and_answer(None).await;
    let client = Client::connect(port, "someone").await;

    let line = first_line(&heard).await;
    let Some(ZerokMessage::Login(login)) = line::parse_line(&line) else {
        panic!("the client answered the greeting with {line}");
    };

    assert_eq!(login.name.as_deref(), Some("someone"));
    assert_eq!(
        login.password_hash.as_deref(),
        Some("X03MO1qnZdYdgyfeuILPmQ==")
    );
    assert_eq!(login.install_id.as_deref(), Some("test-install"));
    // Names coilbox and its version, so a player who sees it knows what they
    // are talking to.
    assert_eq!(login.lobby_version.as_deref(), Some("Coilbox 9.9.9"));
    // 1 is ZeroKLobby. There is no value for a third-party client, and a type
    // the server does not know is worse than one that is not strictly true.
    assert_eq!(login.client_type, types::ClientTypes::ZeroKLobby);
    assert_eq!(login.user_id, 0);

    // The Steam and RSA members the server does not ask for go out unset rather
    // than as null, which is what upstream's serialiser does.
    let (_, body) = line::split_line(&line).expect("it is a line");
    let sent: serde_json::Value = serde_json::from_str(body).expect("the body is JSON");
    let object = sent.as_object().expect("it is an object");
    for unset in [
        "SteamAuthToken",
        "ClientPubKey",
        "SignedChallengeToken",
        "EncryptedPasswordHash",
    ] {
        assert!(!object.contains_key(unset), "{unset} should not be sent");
    }

    assert_eq!(client.phase(), Some(LoginPhase::AwaitAccepted));
    drop(client);
}

#[tokio::test]
async fn a_login_the_server_accepts_reaches_ready() {
    let (port, _heard) = greet_and_answer(Some(
        r#"LoginResponse {"ResultCode":0,"Name":"Someone"}"#.into(),
    ))
    .await;
    let client = Client::connect(port, "someone").await;

    let delta = client.wait_for("loggedIn").await;
    // Zero-K answers with the name it knows the account by, which here differs
    // from the one that was typed only in case. Taking the server's is what
    // keeps every later message matching.
    assert_eq!(delta["delta"]["username"], "Someone");
    assert_eq!(client.username().as_deref(), Some("Someone"));
    assert_eq!(client.phase(), Some(LoginPhase::Ready));
}

#[tokio::test]
async fn a_refused_login_says_why_in_the_server_s_own_words() {
    let (port, _heard) = greet_and_answer(Some(r#"LoginResponse {"ResultCode":3}"#.into())).await;
    let client = Client::connect(port, "someone").await;

    let delta = client.wait_for("loginDenied").await;
    // Upstream's own [Description] for code 3, generated rather than
    // transcribed, so a reworded reason arrives with the next refresh.
    assert_eq!(delta["delta"]["reason"], "invalid password");

    // The denial reaches the login form ahead of the disconnect that follows it.
    let disconnected = client.wait_for("disconnected").await;
    assert_eq!(disconnected["reason"], "invalid password");
}

#[tokio::test]
async fn a_ban_carries_the_reason_the_server_gave_for_it() {
    let (port, _heard) = greet_and_answer(Some(
        r#"LoginResponse {"ResultCode":4,"BanReason":"smurfing"}"#.into(),
    ))
    .await;
    let client = Client::connect(port, "someone").await;

    let delta = client.wait_for("loginDenied").await;
    assert_eq!(delta["delta"]["reason"], "banned: smurfing");
}

#[tokio::test]
async fn a_refusal_code_we_do_not_know_still_says_something() {
    // A server ahead of the pinned commit. The number is worth more than
    // nothing, and the message still has to end the connection.
    let (port, _heard) =
        greet_and_answer(Some(r#"LoginResponse {"ResultCode":9999}"#.into())).await;
    let client = Client::connect(port, "someone").await;

    let delta = client.wait_for("loginDenied").await;
    assert_eq!(
        delta["delta"]["reason"],
        "the server refused the login (code 9999)"
    );
}

#[tokio::test]
async fn a_refused_login_leaves_nothing_in_the_registry_to_retry() {
    // The key has to free up, so a second attempt with a corrected password is
    // not refused as a duplicate connection.
    let (port, _heard) = greet_and_answer(Some(r#"LoginResponse {"ResultCode":3}"#.into())).await;
    let client = Client::connect(port, "someone").await;
    client.wait_for("disconnected").await;

    let deadline = std::time::Instant::now() + PATIENCE;
    while std::time::Instant::now() < deadline {
        if client.phase().is_none() {
            return;
        }
        tokio::time::sleep(Duration::from_millis(2)).await;
    }
    panic!("the refused connection is still in the registry");
}

// -------------------------------------------------------------------------
// Registering, which runs on a connection of its own.
// -------------------------------------------------------------------------

#[tokio::test]
async fn the_greeting_is_answered_with_a_register_when_that_is_what_was_asked() {
    let (port, heard) = greet_and_answer(None).await;
    let client = Client::register(port, "newcomer", Some("  someone@example.com  ")).await;

    let line = first_line(&heard).await;
    let Some(ZerokMessage::Register(register)) = line::parse_line(&line) else {
        panic!("the client answered the greeting with {line}");
    };
    assert_eq!(register.name.as_deref(), Some("newcomer"));
    assert_eq!(
        register.password_hash.as_deref(),
        Some("X03MO1qnZdYdgyfeuILPmQ==")
    );
    // Trimmed, because a stray space in an email box is the caller's typo and
    // not something to store against the account.
    assert_eq!(register.email.as_deref(), Some("someone@example.com"));
    assert_eq!(register.install_id.as_deref(), Some("test-install"));
    assert_eq!(register.user_id, 0);

    assert_eq!(client.phase(), Some(LoginPhase::AwaitRegistration));
}

#[tokio::test]
async fn no_email_means_no_email_member_rather_than_an_empty_one() {
    let (port, heard) = greet_and_answer(None).await;
    let _client = Client::register(port, "newcomer", None).await;

    let line = first_line(&heard).await;
    let (name, body) = line::split_line(&line).expect("it is a line");
    // Named, because a Login has no Email member either and this would pass
    // against one without saying anything.
    assert_eq!(name, "Register");
    let sent: serde_json::Value = serde_json::from_str(body).expect("the body is JSON");
    assert!(
        !sent.as_object().expect("an object").contains_key("Email"),
        "an unset email is left out, not sent as an empty string"
    );
}

#[tokio::test]
async fn an_accepted_registration_reaches_the_registered_phase() {
    let (port, _heard) =
        greet_and_answer(Some(r#"RegisterResponse {"ResultCode":0}"#.into())).await;
    let client = Client::register(port, "newcomer", None).await;

    let deadline = std::time::Instant::now() + PATIENCE;
    while std::time::Instant::now() < deadline {
        if client.phase() == Some(LoginPhase::Registered) {
            // The connection stays up, and the caller drops it before logging in
            // on a fresh one. Registering never logs anybody in.
            assert!(client.event("disconnected").is_none());
            return;
        }
        tokio::time::sleep(Duration::from_millis(2)).await;
    }
    panic!("the registration never reached the registered phase");
}

#[tokio::test]
async fn a_taken_name_says_so_in_the_server_s_own_words() {
    // Code 2, which on a RegisterResponse is NameAlreadyTaken. On a
    // LoginResponse the same number is InvalidName, which is why the two
    // refusals are read through their own enums rather than one shared one.
    let (port, _heard) =
        greet_and_answer(Some(r#"RegisterResponse {"ResultCode":2}"#.into())).await;
    let client = Client::register(port, "taken", None).await;

    let delta = client.wait_for("registrationDenied").await;
    assert_eq!(delta["delta"]["reason"], "name already exists");

    let disconnected = client.wait_for("disconnected").await;
    assert_eq!(disconnected["reason"], "name already exists");
}

#[tokio::test]
async fn a_registration_the_server_bans_carries_its_reason() {
    let (port, _heard) = greet_and_answer(Some(
        r#"RegisterResponse {"ResultCode":4,"BanReason":"ban evasion"}"#.into(),
    ))
    .await;
    let client = Client::register(port, "newcomer", None).await;

    let delta = client.wait_for("registrationDenied").await;
    assert_eq!(delta["delta"]["reason"], "banned: ban evasion");
}

#[tokio::test]
async fn the_two_refusal_codes_are_not_confused_for_one_another() {
    // The check the shape of this code is built around. Both enums have a 2 and
    // they mean different things, so reading a registration refusal through the
    // login enum would tell somebody their name was invalid when it was taken.
    assert_eq!(
        coilbox_zerok_protocol::types::LoginResponseCode::from(2).description(),
        Some("invalid name")
    );
    assert_eq!(
        coilbox_zerok_protocol::types::RegisterResponseCode::from(2).description(),
        Some("name already exists")
    );
}
