//! Coilbox's end of the engine's autohost interface, so the unit builder's
//! sandbox can reload a running game's Lua (issue #3346).
//!
//! The engine does not listen. Coilbox binds a UDP socket on loopback, the
//! engine reads its port from `AutohostPort`, and when the game's server starts
//! it connects from a port of its own and says so. Each command goes back to
//! that address as one datagram. `docs/developers/engine-reload.md` has the
//! engine source this follows and the test it was proved in.

use std::net::{SocketAddr, UdpSocket};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::time::{Duration, Instant};

/// The message types this reads, from `EVENT` in the engine's
/// `rts/Net/AutohostInterface.cpp`. Everything else it ignores.
const SERVER_STARTED: u8 = 0;
const SERVER_QUIT: u8 = 1;
const SERVER_STARTPLAYING: u8 = 2;
const GAME_LUAMSG: u8 = 20;

/// Where a Lua message's text starts in a `GAME_LUAMSG` datagram: the type,
/// then the engine's own `NETMSG_LUAMSG` packet, which is a magic byte, a
/// `u16` size, the player, a `u16` script id and the UI mode
/// (`CBaseNetProtocol::SendLuaMsg`).
const LUAMSG_TEXT: usize = 8;

/// How often the reader wakes to see whether it has been closed. The same
/// interval the launch polls the engine's exit on.
const READ_POLL: Duration = super::POLL_INTERVAL;

#[derive(Default)]
struct State {
    /// The address the engine sends from, once it has said anything.
    engine: Option<SocketAddr>,
    /// Whether the game has started, which `/luarules reload` needs.
    playing: bool,
    /// Lua messages a player sent since the last reload asked.
    lua: Vec<String>,
}

/// One running game's autohost connection.
pub struct Autohost {
    socket: UdpSocket,
    state: Mutex<State>,
    changed: Condvar,
    closed: AtomicBool,
}

impl Autohost {
    /// Bind a loopback port the operating system picks, and start reading it.
    pub fn bind() -> std::io::Result<Arc<Self>> {
        let socket = UdpSocket::bind(("127.0.0.1", 0))?;
        socket.set_read_timeout(Some(READ_POLL))?;
        let host = Arc::new(Self {
            socket,
            state: Mutex::default(),
            changed: Condvar::new(),
            closed: AtomicBool::new(false),
        });
        let reader = host.clone();
        std::thread::spawn(move || reader.read());
        Ok(host)
    }

    pub fn port(&self) -> u16 {
        self.socket.local_addr().map(|a| a.port()).unwrap_or(0)
    }

    /// Stop reading. The socket goes when the last handle does.
    pub fn close(&self) {
        self.closed.store(true, Ordering::SeqCst);
        self.changed.notify_all();
    }

    fn read(&self) {
        let mut buf = [0u8; 65536];
        while !self.closed.load(Ordering::SeqCst) {
            let Ok((len, from)) = self.socket.recv_from(&mut buf) else {
                continue;
            };
            let Some(&kind) = buf[..len].first() else {
                continue;
            };
            let mut state = self.state.lock().unwrap();
            state.engine = Some(from);
            match kind {
                SERVER_STARTED => state.playing = false,
                SERVER_STARTPLAYING => state.playing = true,
                SERVER_QUIT => state.playing = false,
                GAME_LUAMSG if len > LUAMSG_TEXT => state
                    .lua
                    .push(String::from_utf8_lossy(&buf[LUAMSG_TEXT..len]).into_owned()),
                _ => {}
            }
            drop(state);
            self.changed.notify_all();
        }
    }

    fn send(&self, to: SocketAddr, command: &str) -> Result<(), String> {
        self.socket
            .send_to(command.as_bytes(), to)
            .map(|_| ())
            .map_err(|e| format!("could not send {command} to the game: {e}"))
    }

    /// Send `/luarules <message>`, which reaches every synced gadget's
    /// `GotChatMsg`, and wait up to `wait` for a Lua message starting with
    /// `reply`. Answers that message and how long it took to come.
    ///
    /// A plain `/luarules` message needs no cheats, unlike `/luarules reload`.
    /// A message that arrived before this one went out does not count.
    pub fn ask_lua_rules(
        &self,
        message: &str,
        reply: &str,
        wait: Duration,
    ) -> Result<(String, Duration), String> {
        if message.is_empty() || message.contains(['\n', '\r', '\0']) {
            return Err(format!("not a LuaRules message: {message:?}"));
        }
        let mut state = self.state.lock().unwrap();
        let Some(engine) = state.engine else {
            return Err("The game has not connected to coilbox.".into());
        };
        if !state.playing {
            return Err("The game has not started yet.".into());
        }
        state.lua.clear();
        let started = Instant::now();
        self.send(engine, &format!("/luarules {message}"))?;
        let deadline = started + wait;
        loop {
            if let Some(answer) = state.lua.iter().find(|m| m.starts_with(reply)) {
                return Ok((answer.clone(), started.elapsed()));
            }
            let now = Instant::now();
            if now >= deadline || self.closed.load(Ordering::SeqCst) {
                return Err(format!(
                    "The game did not answer within {} seconds. Its infolog says why.",
                    wait.as_secs()
                ));
            }
            state = self.changed.wait_timeout(state, deadline - now).unwrap().0;
        }
    }
}

/// The folder a launch adds to `SPRING_DATADIR` to carry the port, under
/// coilbox's own app data. The engine reads a `springsettings.cfg` in any data
/// folder as extra settings and never writes to one that is not its write
/// folder, which this never is, since it goes last.
pub fn settings_dir(app_data: &Path) -> PathBuf {
    app_data.join("play").join("autohost")
}

/// Write the settings file that points the engine at `port`.
pub fn write_settings(dir: &Path, port: u16) -> Result<(), String> {
    std::fs::create_dir_all(dir)
        .map_err(|e| format!("could not create {}: {e}", dir.display()))?;
    let file = dir.join("springsettings.cfg");
    std::fs::write(
        &file,
        format!("AutohostIP = 127.0.0.1\nAutohostPort = {port}\n"),
    )
    .map_err(|e| format!("could not write {}: {e}", file.display()))
}

/// `datadir` with `extra` after every folder already in it, so the engine's
/// write folder and the player's own settings both stay first.
pub fn with_extra_datadir(datadir: &str, extra: &Path) -> Result<String, String> {
    let extra = extra.to_string_lossy();
    if extra.contains(coilbox_proc::DATADIR_SEP) {
        return Err(format!(
            "{extra} cannot be a data folder: its name has a {} in it",
            coilbox_proc::DATADIR_SEP
        ));
    }
    Ok(if datadir.is_empty() {
        extra.into_owned()
    } else {
        format!("{datadir}{}{extra}", coilbox_proc::DATADIR_SEP)
    })
}

#[cfg(test)]
mod tests {
    //! A stand-in engine on a socket of its own, talking the autohost protocol
    //! the way `AutohostInterface.cpp` does.

    use super::*;

    const ASK: &str = "coilbox_sandbox reload_scripts";
    const REPLY: &str = "coilbox_sandbox:";

    struct Engine(UdpSocket);

    impl Engine {
        fn connect(host: &Autohost) -> Self {
            let socket = UdpSocket::bind(("127.0.0.1", 0)).expect("bind");
            socket.connect(("127.0.0.1", host.port())).expect("connect");
            socket
                .set_read_timeout(Some(Duration::from_secs(5)))
                .expect("timeout");
            Self(socket)
        }

        fn say(&self, bytes: &[u8]) {
            self.0.send(bytes).expect("send");
        }

        fn started_playing(&self) {
            self.say(&[SERVER_STARTED]);
            // The real message carries the game's id and script after the type.
            self.say(&[SERVER_STARTPLAYING, 0, 0, 0, 0]);
        }

        /// A Lua message as a player's client sends it and the server copies it.
        fn lua(&self, text: &str) {
            let mut packet = vec![GAME_LUAMSG, 50, 0, 0, 0, 100, 0, 0];
            packet.extend_from_slice(text.as_bytes());
            self.say(&packet);
        }

        fn heard(&self) -> String {
            let mut buf = [0u8; 512];
            let len = self.0.recv(&mut buf).expect("a command");
            String::from_utf8_lossy(&buf[..len]).into_owned()
        }
    }

    /// The reader runs on its own thread, so wait for it to have read what the
    /// stand-in said, rather than sleeping for a guess.
    fn until_playing(host: &Autohost) {
        let state = host.state.lock().unwrap();
        let (state, _) = host
            .changed
            .wait_timeout_while(state, Duration::from_secs(5), |s| !s.playing)
            .unwrap();
        assert!(state.playing, "the stand-in never got as far as playing");
    }

    #[test]
    fn a_message_goes_to_lua_rules_and_the_reply_comes_back() {
        let host = Autohost::bind().expect("bind");
        let engine = Engine::connect(&host);
        engine.started_playing();
        until_playing(&host);

        let answering = std::thread::spawn(move || {
            let heard = engine.heard();
            engine.lua("someone else's message");
            engine.lua("coilbox_sandbox:loaded");
            heard
        });
        let (answer, took) = host
            .ask_lua_rules(ASK, REPLY, Duration::from_secs(5))
            .expect("answered");

        assert_eq!(
            answering.join().unwrap(),
            "/luarules coilbox_sandbox reload_scripts"
        );
        assert_eq!(answer, "coilbox_sandbox:loaded");
        assert!(took < Duration::from_secs(5));
        host.close();
    }

    #[test]
    fn a_message_before_the_engine_has_connected_is_refused() {
        let host = Autohost::bind().expect("bind");
        let err = host
            .ask_lua_rules(ASK, REPLY, Duration::from_secs(1))
            .expect_err("refused");
        assert!(err.contains("not connected"), "{err}");
        host.close();
    }

    #[test]
    fn a_message_before_the_game_has_started_is_refused() {
        let host = Autohost::bind().expect("bind");
        let engine = Engine::connect(&host);
        engine.say(&[SERVER_STARTED]);
        {
            let state = host.state.lock().unwrap();
            let _ = host
                .changed
                .wait_timeout_while(state, Duration::from_secs(5), |s| s.engine.is_none())
                .unwrap();
        }
        let err = host
            .ask_lua_rules(ASK, REPLY, Duration::from_secs(1))
            .expect_err("refused");
        assert!(err.contains("not started"), "{err}");
        host.close();
    }

    /// One message, one line of chat. A line break would be a second command
    /// in the engine's console, and that is not what was asked for.
    #[test]
    fn a_message_that_is_not_one_line_is_refused() {
        let host = Autohost::bind().expect("bind");
        for bad in ["", "reload\n/quitforce"] {
            let err = host
                .ask_lua_rules(bad, REPLY, Duration::from_secs(1))
                .expect_err("refused");
            assert!(err.contains("not a LuaRules message"), "{err}");
        }
        host.close();
    }

    /// A reply that came before this message went out, or no reply at all,
    /// must not read as this one having been answered.
    #[test]
    fn only_a_reply_after_the_message_counts() {
        let host = Autohost::bind().expect("bind");
        let engine = Engine::connect(&host);
        engine.started_playing();
        engine.lua("coilbox_sandbox:loaded");
        {
            let state = host.state.lock().unwrap();
            let _ = host
                .changed
                .wait_timeout_while(state, Duration::from_secs(5), |s| s.lua.is_empty())
                .unwrap();
        }
        until_playing(&host);

        let err = host
            .ask_lua_rules(ASK, REPLY, Duration::from_millis(300))
            .expect_err("nothing answered this message");
        assert!(err.contains("did not answer"), "{err}");
        assert_eq!(engine.heard(), "/luarules coilbox_sandbox reload_scripts");
        host.close();
    }

    #[test]
    fn the_settings_point_the_engine_at_the_port() {
        let dir = std::env::temp_dir().join(format!("coilbox-autohost-{}", std::process::id()));
        write_settings(&dir, 53344).expect("write");
        let text = std::fs::read_to_string(dir.join("springsettings.cfg")).expect("read");
        assert!(text.contains("AutohostPort = 53344\n"), "{text}");
        assert!(text.contains("AutohostIP = 127.0.0.1\n"), "{text}");
        std::fs::remove_dir_all(&dir).expect("clean up");
    }

    #[test]
    fn the_settings_folder_goes_after_every_other_data_folder() {
        let sep = coilbox_proc::DATADIR_SEP;
        let joined = with_extra_datadir(&format!("/a{sep}/b"), Path::new("/c")).expect("joined");
        assert_eq!(joined, format!("/a{sep}/b{sep}/c"));
        assert!(with_extra_datadir("/a", Path::new(&format!("/c{sep}d"))).is_err());
    }
}
