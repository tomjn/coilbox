# Multiplayer Chat: Channels & DMs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An iMessage/WhatsApp-style chat hub for the multiplayer lobby - a conversation sidebar, a message pane with a bottom composer and a top action bar - covering joinable channels (with a full server channel-browser drawer), direct messages with durable per-account history, and unread badges; built from a reusable presentational `ChatPane` the future battle GUI can embed.

**Architecture:** Backend work lives in two Rust crates. The pure `coilbox-lobby-protocol` gains a DM store, a channel directory, message timestamps (threaded via a new `reduce_at`), and the `CHANNELS` command. The `tauri-plugin-coilbox-multiplayer` plugin gains a typed outbound channel (so the connection task is the single writer for outgoing DMs), best-effort JSONL DM persistence under the app data dir, and a `mp_list_channels` command. The frontend adds a store-agnostic `ChatPane` fed by a `useConversation` hook, a sidebar, a member panel, a channel-browser drawer, a `ChatPage` hub, and provider-level unread tracking.

**Tech Stack:** Rust (serde, tokio, tauri plugin), TypeScript/React (picoframe frame + plugin-sdk, react-router, Tailwind), lucide-react icons.

**Design spec:** `docs/superpowers/specs/2026-07-02-multiplayer-chat-channels-dms-design.md`

**Verification commands (CI-equivalent, run from repo root):**
- `cargo fmt --all --check`
- `cargo clippy --all-targets --all-features -- -D warnings`
- `cargo test -p coilbox-lobby-protocol` (and `-p tauri-plugin-coilbox-multiplayer`)
- `bunx biome ci .`
- `bun run typecheck`

---

## Phase 1 - Protocol crate (`crates/coilbox-lobby-protocol`)

### Task 1: Message timestamps via `reduce_at`

**Files:**
- Modify: `crates/coilbox-lobby-protocol/src/state.rs` (add `at` to `ChatMsg`; derive `Deserialize`)
- Modify: `crates/coilbox-lobby-protocol/src/reduce.rs` (add `reduce_at`, stamp every `ChatMsg`)
- Modify: `crates/coilbox-lobby-protocol/src/lib.rs` (export `reduce_at`)

- [ ] **Step 1: Add the failing test** in `reduce.rs` `mod tests`:

```rust
#[test]
fn reduce_at_stamps_chat_timestamp() {
    let mut s = LobbyState::new();
    reduce_at(&mut s, parse_line("JOIN main"), 111);
    reduce_at(&mut s, parse_line("SAID main bob hello there"), 12345);
    assert_eq!(s.channels["main"].messages[0].at, 12345);
}
```

- [ ] **Step 2: Run it, verify it fails**

Run: `cargo test -p coilbox-lobby-protocol reduce_at_stamps_chat_timestamp` Expected: FAIL - `cannot find function reduce_at` / no field `at`.

- [ ] **Step 3: Add `at` to `ChatMsg` and derive `Deserialize`** in `state.rs`. Add the import and update the struct:

```rust
use serde::{Deserialize, Serialize};
```

```rust
/// The kind of a chat message, so the frontend can render it appropriately.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ChatKind {
    Said,
    SaidEx,
    SaidBattle,
    Private,
    System,
    Join,
    Leave,
}

/// A single chat line. `channel` is `None` for battle chat with no known channel
/// and for private messages. `at` is a unix-millis receive timestamp (0 when the
/// reducer is driven without a clock, e.g. in tests via `reduce`).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatMsg {
    pub channel: Option<String>,
    pub from: String,
    pub text: String,
    pub kind: ChatKind,
    pub at: u64,
}
```

(The `use serde::Serialize;` line at the top of `state.rs` becomes the combined import above.)

- [ ] **Step 4: Introduce `reduce_at` and stamp messages** in `reduce.rs`. Rename the current `pub fn reduce` body into `reduce_at` with a `now_ms: u64` parameter, add a thin `reduce` delegate, thread `now_ms` into `push_chat`/`reduce_battle_chat`, and add `at: now_ms` to every `ChatMsg` literal.

Replace the function signature and add the delegate:

```rust
/// Apply a server message to the lobby state, returning the deltas produced.
/// `now_ms` stamps any chat message created (unix millis; pass 0 when no clock).
pub fn reduce_at(state: &mut LobbyState, msg: ServerMessage, now_ms: u64) -> Vec<Delta> {
    match msg {
        // ... existing arms, with the edits below ...
    }
}

/// Clock-free convenience wrapper (timestamps stamped as 0). Used by tests.
pub fn reduce(state: &mut LobbyState, msg: ServerMessage) -> Vec<Delta> {
    reduce_at(state, msg, 0)
}
```

In the `Joined`, `Left`, `ChannelMessage`, `Said`, `SaidEx` arms add `at: now_ms,` to each `ChatMsg { ... }` literal. Update the two helpers:

```rust
fn push_chat(state: &mut LobbyState, channel: &str, msg: ChatMsg) -> Vec<Delta> {
    // unchanged body - caller sets msg.at
    let ch = state
        .channels
        .entry(channel.to_string())
        .or_insert_with(|| ChannelState {
            name: channel.to_string(),
            ..Default::default()
        });
    let index = ch.messages.len();
    ch.messages.push(msg);
    vec![Delta::ChatMessage {
        channel: Some(channel.to_string()),
        index,
    }]
}

fn reduce_battle_chat(
    state: &mut LobbyState,
    username: String,
    message: String,
    kind: ChatKind,
    now_ms: u64,
) -> Vec<Delta> {
    let channel = state
        .current_battle
        .and_then(|id| state.battles.get(&id))
        .and_then(|b| b.channel.clone());
    match channel {
        Some(chan) => push_chat(
            state,
            &chan,
            ChatMsg {
                channel: Some(chan.clone()),
                from: username,
                text: message,
                kind,
                at: now_ms,
            },
        ),
        None => vec![Delta::ChatMessage {
            channel: None,
            index: 0,
        }],
    }
}
```

Update the two `reduce_battle_chat(...)` call sites (the `SaidBattle` / `SaidBattleEx` arms) to pass `now_ms`.

- [ ] **Step 5: Export `reduce_at`** in `lib.rs`:

```rust
pub use reduce::{reduce, reduce_at, Delta};
```

- [ ] **Step 6: Run the test + the full crate suite**

Run: `cargo test -p coilbox-lobby-protocol` Expected: PASS (the new test plus all existing reducer/parser tests still green - they use `reduce`, unaffected).

- [ ] **Step 7: Commit**

```bash
git add crates/coilbox-lobby-protocol/src/state.rs crates/coilbox-lobby-protocol/src/reduce.rs crates/coilbox-lobby-protocol/src/lib.rs
git commit -m "feat(lobby-protocol): timestamped chat via reduce_at"
```

---

### Task 2: DM store (incoming, outgoing, echo-guard)

**Files:**
- Modify: `crates/coilbox-lobby-protocol/src/state.rs` (`dms` field)
- Modify: `crates/coilbox-lobby-protocol/src/reduce.rs` (store `SaidPrivate`, `record_outgoing_private`, `push_dm` helper)
- Modify: `crates/coilbox-lobby-protocol/src/lib.rs` (export `record_outgoing_private`)

- [ ] **Step 1: Add failing tests** in `reduce.rs` `mod tests`:

```rust
#[test]
fn incoming_private_stored_in_dm_thread() {
    let mut s = LobbyState::new();
    s.my_username = Some("me".into());
    let d = reduce_at(&mut s, parse_line("SAIDPRIVATE bob hi there me"), 500);
    assert_eq!(d, vec![Delta::PrivateMessage { from: "bob".into() }]);
    let thread = &s.dms["bob"];
    assert_eq!(thread.len(), 1);
    assert_eq!(thread[0].from, "bob");
    assert_eq!(thread[0].text, "hi there me");
    assert_eq!(thread[0].kind, ChatKind::Private);
    assert_eq!(thread[0].at, 500);
}

#[test]
fn own_private_echo_is_ignored() {
    let mut s = LobbyState::new();
    s.my_username = Some("me".into());
    // A server that echoes our own SAYPRIVATE back as SAIDPRIVATE me ...
    let d = reduce_at(&mut s, parse_line("SAIDPRIVATE me hello"), 1);
    assert!(d.is_empty());
    assert!(!s.dms.contains_key("me"));
}

#[test]
fn outgoing_private_recorded_under_peer_from_me() {
    let mut s = LobbyState::new();
    s.my_username = Some("me".into());
    let d = record_outgoing_private(&mut s, "bob", "yo bob", 777);
    assert_eq!(d, vec![Delta::PrivateMessage { from: "bob".into() }]);
    let thread = &s.dms["bob"];
    assert_eq!(thread.len(), 1);
    assert_eq!(thread[0].from, "me");
    assert_eq!(thread[0].text, "yo bob");
    assert_eq!(thread[0].at, 777);
}
```

- [ ] **Step 2: Run, verify failure**

Run: `cargo test -p coilbox-lobby-protocol incoming_private_stored_in_dm_thread own_private_echo_is_ignored outgoing_private_recorded_under_peer_from_me` Expected: FAIL - no field `dms`, no `record_outgoing_private`.

- [ ] **Step 3: Add `dms` to `LobbyState`** in `state.rs`:

```rust
pub struct LobbyState {
    pub my_username: Option<String>,
    pub compflags: HashSet<String>,
    pub users: HashMap<String, User>,
    pub channels: HashMap<String, ChannelState>,
    /// Direct-message threads keyed by the other party's username.
    pub dms: HashMap<String, Vec<ChatMsg>>,
    pub battles: HashMap<u32, Battle>,
    pub current_battle: Option<u32>,
    pub last_battle: Option<u32>,
}
```

- [ ] **Step 4: Store incoming DMs + add outgoing recorder** in `reduce.rs`. Replace the `SaidPrivate` arm:

```rust
ServerMessage::SaidPrivate { username, message } => {
    // Some servers echo our own SAYPRIVATE back to us; we already recorded that
    // copy locally when sending, so drop the echo.
    if state.my_username.as_deref() == Some(username.as_str()) {
        return vec![];
    }
    push_dm(
        state,
        &username,
        ChatMsg {
            channel: None,
            from: username.clone(),
            text: message,
            kind: ChatKind::Private,
            at: now_ms,
        },
    )
}
```

Add the helper and the outgoing recorder near `push_chat`:

```rust
/// Append a message to a DM thread keyed by `peer` (the other party), emitting a
/// `PrivateMessage` delta naming that thread.
fn push_dm(state: &mut LobbyState, peer: &str, msg: ChatMsg) -> Vec<Delta> {
    state.dms.entry(peer.to_string()).or_default().push(msg);
    vec![Delta::PrivateMessage {
        from: peer.to_string(),
    }]
}

/// Record a private message WE sent to `peer`. The server does not echo
/// `SAYPRIVATE`, so the plugin calls this so the sent line appears in the thread.
/// `from` is our own username (falls back to empty if not yet logged in).
pub fn record_outgoing_private(
    state: &mut LobbyState,
    peer: &str,
    text: &str,
    now_ms: u64,
) -> Vec<Delta> {
    let me = state.my_username.clone().unwrap_or_default();
    push_dm(
        state,
        peer,
        ChatMsg {
            channel: None,
            from: me,
            text: text.to_string(),
            kind: ChatKind::Private,
            at: now_ms,
        },
    )
}
```

- [ ] **Step 5: Export `record_outgoing_private`** in `lib.rs`:

```rust
pub use reduce::{record_outgoing_private, reduce, reduce_at, Delta};
```

- [ ] **Step 6: Run tests**

Run: `cargo test -p coilbox-lobby-protocol` Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add crates/coilbox-lobby-protocol/src/state.rs crates/coilbox-lobby-protocol/src/reduce.rs crates/coilbox-lobby-protocol/src/lib.rs
git commit -m "feat(lobby-protocol): DM store with echo-guard + outgoing record"
```

---

### Task 3: Channel directory (`CHANNELS` / `CHANNEL` / `ENDOFCHANNELS`)

**Files:**
- Modify: `crates/coilbox-lobby-protocol/src/state.rs` (`DirChannel`, `channel_directory`)
- Modify: `crates/coilbox-lobby-protocol/src/message.rs` (`ChannelInfo`, `EndOfChannels` variants + parse)
- Modify: `crates/coilbox-lobby-protocol/src/reduce.rs` (reduce arms, `begin_channel_list`, `ChannelListReceived` delta)
- Modify: `crates/coilbox-lobby-protocol/src/command.rs` (`list_channels`)
- Modify: `crates/coilbox-lobby-protocol/src/lib.rs` (exports `DirChannel`, `begin_channel_list`)

- [ ] **Step 1: Add failing tests.** In `command.rs` `mod tests`, extend `simple_builders` (or add) :

```rust
#[test]
fn list_channels_line() {
    assert_eq!(list_channels(), "CHANNELS");
}
```

In `reduce.rs` `mod tests`:

```rust
#[test]
fn channel_directory_accumulates_then_completes() {
    let mut s = LobbyState::new();
    begin_channel_list(&mut s);
    reduce(&mut s, parse_line("CHANNEL main 42 Welcome to main"));
    reduce(&mut s, parse_line("CHANNEL newbies 7"));
    let d = reduce(&mut s, parse_line("ENDOFCHANNELS"));
    assert_eq!(d, vec![Delta::ChannelListReceived]);
    assert_eq!(s.channel_directory.len(), 2);
    assert_eq!(s.channel_directory[0].name, "main");
    assert_eq!(s.channel_directory[0].user_count, 42);
    assert_eq!(s.channel_directory[0].topic.as_deref(), Some("Welcome to main"));
    assert_eq!(s.channel_directory[1].name, "newbies");
    assert_eq!(s.channel_directory[1].user_count, 7);
    assert_eq!(s.channel_directory[1].topic, None);
}

#[test]
fn begin_channel_list_clears_previous() {
    let mut s = LobbyState::new();
    begin_channel_list(&mut s);
    reduce(&mut s, parse_line("CHANNEL a 1"));
    begin_channel_list(&mut s);
    assert!(s.channel_directory.is_empty());
}
```

- [ ] **Step 2: Run, verify failure**

Run: `cargo test -p coilbox-lobby-protocol channel_directory_accumulates_then_completes begin_channel_list_clears_previous list_channels_line` Expected: FAIL - unknown items.

- [ ] **Step 3: Add `DirChannel` + `channel_directory`** in `state.rs`:

```rust
/// A public channel as advertised by the server's `CHANNELS` directory.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DirChannel {
    pub name: String,
    pub user_count: u32,
    pub topic: Option<String>,
}
```

Add to `LobbyState`:

```rust
    /// The last-fetched public channel directory (from `CHANNELS`).
    pub channel_directory: Vec<DirChannel>,
```

- [ ] **Step 4: Parse the messages** in `message.rs`. Add variants to `ServerMessage`:

```rust
    /// `CHANNEL <name> <usercount> [topic]`
    ChannelInfo {
        name: String,
        user_count: u32,
        topic: Option<String>,
    },
    /// `ENDOFCHANNELS`
    EndOfChannels,
```

Add match arms in `parse_line` (place near the `CHANNELMESSAGE` arm). Note ordering: match `"CHANNELMESSAGE"`, `"CHANNELTOPIC"` before a bare `"CHANNEL"` is not a concern (exact string match), but `"ENDOFCHANNELS"` must be its own arm:

```rust
        "CHANNEL" => match fields::<3>(rest) {
            Some([name, count, topic]) => ServerMessage::ChannelInfo {
                name: name.to_string(),
                user_count: count.trim().parse().unwrap_or(0),
                topic: (!topic.is_empty()).then(|| topic.to_string()),
            },
            None => match fields::<2>(rest) {
                Some([name, count]) => ServerMessage::ChannelInfo {
                    name: name.to_string(),
                    user_count: count.trim().parse().unwrap_or(0),
                    topic: None,
                },
                None => ServerMessage::Unknown { raw: raw() },
            },
        },
        "ENDOFCHANNELS" => ServerMessage::EndOfChannels,
```

- [ ] **Step 5: Reduce the new messages** in `reduce.rs`. Add arms inside `reduce_at`'s match (before the catch-all `Unknown` group), and remove `ChannelInfo`/`EndOfChannels` from any no-op group if the compiler flags non-exhaustiveness:

```rust
        ServerMessage::ChannelInfo {
            name,
            user_count,
            topic,
        } => {
            state.channel_directory.push(DirChannel {
                name,
                user_count,
                topic,
            });
            vec![]
        }
        ServerMessage::EndOfChannels => vec![Delta::ChannelListReceived],
```

Add the `Delta` variant:

```rust
    ChannelListReceived,
```

Add the public reset helper near `push_chat`:

```rust
/// Clear the channel directory ahead of a fresh `CHANNELS` request so stale
/// entries don't linger while the new list streams in.
pub fn begin_channel_list(state: &mut LobbyState) {
    state.channel_directory.clear();
}
```

Import `DirChannel` at the top of `reduce.rs` (extend the `use crate::state::{...}` line to include `DirChannel`).

- [ ] **Step 6: Add the command builder** in `command.rs`:

```rust
/// `CHANNELS` - request the public channel directory.
pub fn list_channels() -> String {
    "CHANNELS".to_string()
}
```

- [ ] **Step 7: Export** in `lib.rs`:

```rust
pub use reduce::{begin_channel_list, record_outgoing_private, reduce, reduce_at, Delta};
pub use state::{
    Battle, Bot, ChannelState, ChatKind, ChatMsg, DirChannel, LobbyState, MemberStatus, StartRect,
    User,
};
```

- [ ] **Step 8: Run tests + clippy/fmt**

Run: `cargo test -p coilbox-lobby-protocol` Expected: PASS. Run: `cargo fmt --all` then `cargo clippy -p coilbox-lobby-protocol --all-targets -- -D warnings` Expected: clean.

- [ ] **Step 9: Commit**

```bash
git add crates/coilbox-lobby-protocol/src
git commit -m "feat(lobby-protocol): CHANNELS directory (parse, state, command)"
```

---

## Phase 2 - Plugin (`crates/tauri-plugin-coilbox-multiplayer`)

### Task 4: Typed outbound channel (`Outbound` enum)

Mechanical refactor so the connection task can act on outgoing DMs. No behavior change yet.

**Files:**
- Modify: `crates/tauri-plugin-coilbox-multiplayer/src/conn.rs`
- Modify: `crates/tauri-plugin-coilbox-multiplayer/src/lib.rs`

- [ ] **Step 1: Define `Outbound` and change the channel type** in `conn.rs`. Add the enum and update `ServerConn.tx` + the mpsc types:

```rust
/// A queued outbound action for the connection task. `Line` is a raw wire line;
/// `SayPrivate` is recorded into DM state + persisted + emitted as a delta by the
/// task before the wire line is sent, keeping the task the single state writer.
pub enum Outbound {
    Line(String),
    SayPrivate { peer: String, text: String },
}
```

Change `ServerConn`:

```rust
pub struct ServerConn {
    pub tx: UnboundedSender<Outbound>,
    pub state: Arc<Mutex<LobbyState>>,
    pub abort: tokio::task::AbortHandle,
}
```

Change the channel creation in `spawn_connection`:

```rust
    let (tx, rx) = mpsc::unbounded_channel::<Outbound>();
```

And the `rx` param type in `run_loop`:

```rust
    mut rx: mpsc::UnboundedReceiver<Outbound>,
```

Update the select arm to handle the enum (for now `SayPrivate` just sends the wire line; the record/persist logic is added in Task 8):

```rust
            Some(out) = rx.recv() => match out {
                Outbound::Line(line) => outbound.push(line),
                Outbound::SayPrivate { peer, text } => {
                    outbound.push(command::say_private(&peer, &text));
                }
            },
```

- [ ] **Step 2: Update `lib.rs` senders.** Import `Outbound`:

```rust
use conn::{spawn_connection, LobbyEvent, Outbound, Registry, ServerConn};
```

In `enqueue`, wrap the line:

```rust
        Some(conn) => match conn.tx.send(Outbound::Line(line)) {
```

In `mp_disconnect`, wrap the exit line:

```rust
            let _ = tx.send(Outbound::Line(command::exit(None)));
```

- [ ] **Step 3: Build to verify the refactor compiles**

Run: `cargo build -p tauri-plugin-coilbox-multiplayer` Expected: compiles (existing plugin tests unaffected).

- [ ] **Step 4: Commit**

```bash
git add crates/tauri-plugin-coilbox-multiplayer/src/conn.rs crates/tauri-plugin-coilbox-multiplayer/src/lib.rs
git commit -m "refactor(multiplayer): typed Outbound channel"
```

---

### Task 5: `DmLog` - JSONL persistence helper

**Files:**
- Create: `crates/tauri-plugin-coilbox-multiplayer/src/dmlog.rs`
- Modify: `crates/tauri-plugin-coilbox-multiplayer/src/lib.rs` (`mod dmlog;`)

- [ ] **Step 1: Write the module with a failing round-trip test.** Create `dmlog.rs`:

```rust
//! Best-effort durable DM history: one append-only JSONL file per account, keyed
//! by a sanitized `serverKey`. Only the connection task touches an instance, so no
//! internal locking is needed. All IO is best-effort - a failure is logged and
//! never breaks live chat.

use std::collections::HashMap;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};

use coilbox_lobby_protocol::ChatMsg;
use serde::{Deserialize, Serialize};

/// One persisted DM line: the thread key (`peer`) plus the message.
#[derive(Serialize, Deserialize)]
struct StoredDm {
    peer: String,
    msg: ChatMsg,
}

/// Append-only DM history at a fixed path.
pub struct DmLog {
    path: PathBuf,
}

/// Turn a `serverKey` (`user@host:port`) into a filesystem-safe stem.
pub fn sanitize_key(server_key: &str) -> String {
    server_key
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '.' || c == '-' { c } else { '_' })
        .collect()
}

impl DmLog {
    /// A log at `<dir>/<sanitized key>.jsonl`. Does not touch disk yet.
    pub fn new(dir: &Path, server_key: &str) -> Self {
        DmLog {
            path: dir.join(format!("{}.jsonl", sanitize_key(server_key))),
        }
    }

    /// Load all threads grouped by peer. Missing file -> empty; bad lines skipped.
    pub fn load(&self) -> HashMap<String, Vec<ChatMsg>> {
        let mut out: HashMap<String, Vec<ChatMsg>> = HashMap::new();
        let Ok(contents) = fs::read_to_string(&self.path) else {
            return out;
        };
        for line in contents.lines() {
            if line.trim().is_empty() {
                continue;
            }
            if let Ok(rec) = serde_json::from_str::<StoredDm>(line) {
                out.entry(rec.peer).or_default().push(rec.msg);
            }
        }
        out
    }

    /// Append one message to `peer`'s thread. Best-effort; logs on failure.
    pub fn append(&self, peer: &str, msg: &ChatMsg) {
        if let Some(parent) = self.path.parent() {
            let _ = fs::create_dir_all(parent);
        }
        let rec = StoredDm {
            peer: peer.to_string(),
            msg: msg.clone(),
        };
        let line = match serde_json::to_string(&rec) {
            Ok(l) => l,
            Err(e) => {
                eprintln!("dmlog: serialize failed: {e}");
                return;
            }
        };
        match OpenOptions::new().create(true).append(true).open(&self.path) {
            Ok(mut f) => {
                if let Err(e) = writeln!(f, "{line}") {
                    eprintln!("dmlog: write failed: {e}");
                }
            }
            Err(e) => eprintln!("dmlog: open failed: {e}"),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use coilbox_lobby_protocol::ChatKind;

    fn msg(from: &str, text: &str, at: u64) -> ChatMsg {
        ChatMsg {
            channel: None,
            from: from.to_string(),
            text: text.to_string(),
            kind: ChatKind::Private,
            at,
        }
    }

    #[test]
    fn round_trips_grouped_by_peer_in_order() {
        let dir = std::env::temp_dir().join(format!("coilbox-dmlog-test-{}", std::process::id()));
        let log = DmLog::new(&dir, "me@host:8200");
        log.append("bob", &msg("me", "hi bob", 1));
        log.append("bob", &msg("bob", "hi me", 2));
        log.append("carol", &msg("carol", "yo", 3));

        let loaded = log.load();
        assert_eq!(loaded["bob"].len(), 2);
        assert_eq!(loaded["bob"][0].text, "hi bob");
        assert_eq!(loaded["bob"][1].from, "bob");
        assert_eq!(loaded["carol"].len(), 1);

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn missing_file_loads_empty() {
        let dir = std::env::temp_dir().join(format!("coilbox-dmlog-missing-{}", std::process::id()));
        let log = DmLog::new(&dir, "nobody@nowhere:1");
        assert!(log.load().is_empty());
    }
}
```

- [ ] **Step 2: Register the module** in `lib.rs` (top, with the other `mod`s):

```rust
mod conn;
mod dmlog;
mod tls;
```

- [ ] **Step 3: Run the tests, verify pass**

Run: `cargo test -p tauri-plugin-coilbox-multiplayer dmlog` Expected: PASS (both `dmlog::tests`).

- [ ] **Step 4: Commit**

```bash
git add crates/tauri-plugin-coilbox-multiplayer/src/dmlog.rs crates/tauri-plugin-coilbox-multiplayer/src/lib.rs
git commit -m "feat(multiplayer): DmLog JSONL persistence helper"
```

---

### Task 6: Wire persistence + timestamps into the connection task

Thread a `DmLog` and app data dir into the connection, preload DM history, use `reduce_at`, and persist incoming + outgoing DMs (completing the `SayPrivate` arm).

**Files:**
- Modify: `crates/tauri-plugin-coilbox-multiplayer/src/conn.rs`
- Modify: `crates/tauri-plugin-coilbox-multiplayer/src/lib.rs`

- [ ] **Step 1: Import the new protocol items + time + DmLog** in `conn.rs`:

```rust
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use coilbox_lobby_protocol::{
    command, parse_line, record_outgoing_private, reduce_at, Delta, LobbyState, LoginConfig,
    LoginMachine, LoginPhase, ServerMessage,
};

use crate::dmlog::DmLog;
```

Add a small clock helper in `conn.rs`:

```rust
/// Unix-millis now, saturating to 0 on the (impossible) pre-epoch case.
fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}
```

- [ ] **Step 2: Accept a `DmLog`, preload history, own it in the loop.** Change `spawn_connection` to take `dm_log: DmLog`, seed the initial state's `dms`, and pass it to `run_loop`:

```rust
pub fn spawn_connection(
    registry: Registry,
    server_key: String,
    stream: Box<dyn AsyncReadWrite>,
    login_cfg: LoginConfig,
    on_event: Channel<LobbyEvent>,
    dm_log: DmLog,
) {
    let (tx, rx) = mpsc::unbounded_channel::<Outbound>();
    let mut initial = LobbyState::new();
    initial.dms = dm_log.load();
    let state = Arc::new(Mutex::new(initial));

    let handle = tokio::spawn(run_loop(
        registry.clone(),
        server_key.clone(),
        stream,
        login_cfg,
        on_event,
        rx,
        state.clone(),
        dm_log,
    ));

    registry.lock().unwrap().insert(
        server_key,
        ServerConn {
            tx,
            state,
            abort: handle.abort_handle(),
        },
    );
}
```

Add the `dm_log: DmLog` parameter to `run_loop`'s signature (last arg).

- [ ] **Step 3: Use `reduce_at` and persist incoming DMs.** Replace the reduce block in the inbound arm:

```rust
                    let now = now_ms();
                    let deltas = reduce_at(&mut state.lock().unwrap(), msg, now);
                    for delta in deltas {
                        if let Delta::PrivateMessage { from } = &delta {
                            let last = state
                                .lock()
                                .unwrap()
                                .dms
                                .get(from)
                                .and_then(|t| t.last())
                                .cloned();
                            if let Some(m) = last {
                                dm_log.append(from, &m);
                            }
                        }
                        let _ = on_event.send(LobbyEvent::Delta { delta });
                    }
```

- [ ] **Step 4: Complete the `SayPrivate` arm** (record + persist + delta + wire line):

```rust
                Outbound::SayPrivate { peer, text } => {
                    let now = now_ms();
                    let deltas =
                        record_outgoing_private(&mut state.lock().unwrap(), &peer, &text, now);
                    let last = state
                        .lock()
                        .unwrap()
                        .dms
                        .get(&peer)
                        .and_then(|t| t.last())
                        .cloned();
                    if let Some(m) = last {
                        dm_log.append(&peer, &m);
                    }
                    for delta in deltas {
                        let _ = on_event.send(LobbyEvent::Delta { delta });
                    }
                    outbound.push(command::say_private(&peer, &text));
                }
```

- [ ] **Step 5: Build the `DmLog` in `mp_connect`.** Make the command generic over `R` and resolve the app data dir. In `lib.rs`, update the signature and body:

```rust
#[tauri::command]
#[allow(clippy::too_many_arguments)]
async fn mp_connect<R: Runtime>(
    app: tauri::AppHandle<R>,
    registry: State<'_, Registry>,
    server_key: String,
    host: String,
    port: u16,
    tls: bool,
    allow_self_signed: bool,
    username: String,
    password: String,
    compat_flags: Vec<String>,
    on_event: Channel<LobbyEvent>,
) -> Result<CliResult, ()> {
    if registry.lock().unwrap().contains_key(&server_key) {
        return Ok(CliResult::err(format!("already connected: {server_key}")));
    }

    let dm_dir = match app.path().app_data_dir() {
        Ok(d) => d.join("coilbox").join("lobby-dms"),
        Err(e) => return Ok(CliResult::err(format!("no app data dir: {e}"))),
    };
    let dm_log = dmlog::DmLog::new(&dm_dir, &server_key);

    let stream = match tls::connect_stream(&host, port, tls, allow_self_signed).await {
        Ok(s) => s,
        Err(e) => return Ok(CliResult::err(e)),
    };

    let login_cfg = LoginConfig {
        username,
        password_hash: password_hash(&password),
        local_ip: "*".into(),
        agent: format!("Coilbox {}", env!("CARGO_PKG_VERSION")),
        client_id: "0".into(),
        compat_flags,
        use_stls: false,
    };

    spawn_connection(
        registry.inner().clone(),
        server_key,
        stream,
        login_cfg,
        on_event,
        dm_log,
    );
    Ok(CliResult::ok(json!({ "connected": true })))
}
```

Ensure the `tauri` import brings `Manager` (already present) so `app.path()` resolves; add `use tauri::Manager;` is already imported via the existing `use tauri::{... Manager ...}`.

- [ ] **Step 6: Build + run plugin tests**

Run: `cargo build -p tauri-plugin-coilbox-multiplayer` Expected: compiles. Run: `cargo test -p tauri-plugin-coilbox-multiplayer` Expected: PASS (existing `battle_to_config` tests + `dmlog` tests).

- [ ] **Step 7: Commit**

```bash
git add crates/tauri-plugin-coilbox-multiplayer/src/conn.rs crates/tauri-plugin-coilbox-multiplayer/src/lib.rs
git commit -m "feat(multiplayer): persist DMs + timestamp reduce in conn task"
```

---

### Task 7: `mp_say_private` posts `SayPrivate`; add `mp_list_channels` + ACL

**Files:**
- Modify: `crates/tauri-plugin-coilbox-multiplayer/src/lib.rs`
- Modify: `crates/tauri-plugin-coilbox-multiplayer/build.rs`
- Modify: `crates/tauri-plugin-coilbox-multiplayer/permissions/default.toml`

- [ ] **Step 1: Reroute `mp_say_private` through the typed channel** in `lib.rs` (it must record/persist, so it can no longer use `enqueue`):

```rust
/// `mp_say_private` - direct message to a user. Posts a typed `SayPrivate` so the
/// connection task records it into DM state, persists it, and emits a delta before
/// sending the wire line (the server does not echo SAYPRIVATE).
#[tauri::command]
fn mp_say_private(
    registry: State<'_, Registry>,
    server_key: String,
    username: String,
    message: String,
) -> CliResult {
    let map = registry.lock().unwrap();
    match map.get(&server_key) {
        Some(conn) => match conn.tx.send(Outbound::SayPrivate {
            peer: username,
            text: message,
        }) {
            Ok(()) => CliResult::ok(json!({ "sent": true })),
            Err(_) => CliResult::err("connection is closed"),
        },
        None => CliResult::err(format!("not connected: {server_key}")),
    }
}
```

- [ ] **Step 2: Add `mp_list_channels`** in `lib.rs` (near `mp_join_channel`). It resets the directory then requests it:

```rust
/// `mp_list_channels` - clear the cached directory and request the server's public
/// channel list (`CHANNELS`); the reply streams as `CHANNEL...ENDOFCHANNELS`.
#[tauri::command]
fn mp_list_channels(registry: State<'_, Registry>, server_key: String) -> CliResult {
    if let Some(conn) = registry.lock().unwrap().get(&server_key) {
        coilbox_lobby_protocol::begin_channel_list(&mut conn.state.lock().unwrap());
    }
    enqueue(registry.inner(), &server_key, command::list_channels())
}
```

- [ ] **Step 3: Register the command** in the `invoke_handler!` list in `init()` (add `mp_list_channels,`).

- [ ] **Step 4: Add to the ACL command list** in `build.rs` (append to `COMMANDS`):

```rust
    "mp_list_channels",
```

- [ ] **Step 5: Allow it by default** in `permissions/default.toml` (add to the `permissions` array):

```toml
  "allow-mp-list-channels",
```

- [ ] **Step 6: Regenerate ACL + build the app crate** so the autogenerated command TOML and `src-tauri/gen/schemas/*` are refreshed:

Run: `cargo build -p coilbox` (the Tauri app crate; this runs the plugin `build.rs` and regenerates schemas) Expected: compiles; new files appear under `crates/tauri-plugin-coilbox-multiplayer/permissions/autogenerated/commands/mp_list_channels.toml` and `src-tauri/gen/schemas/*` update.

Note: if the app crate name differs, build the whole workspace: `cargo build`.

- [ ] **Step 7: Full Rust gate**

Run: `cargo fmt --all --check` Run: `cargo clippy --all-targets --all-features -- -D warnings` Run: `cargo test -p coilbox-lobby-protocol -p tauri-plugin-coilbox-multiplayer` Expected: all clean/green.

- [ ] **Step 8: Commit** (include regenerated ACL + schema files):

```bash
git add crates/tauri-plugin-coilbox-multiplayer/src/lib.rs crates/tauri-plugin-coilbox-multiplayer/build.rs crates/tauri-plugin-coilbox-multiplayer/permissions
git add src-tauri/gen/schemas
git commit -m "feat(multiplayer): mp_list_channels + DM send via typed channel"
```

---

## Phase 3 - Frontend bindings & store (`src/multiplayer`)

### Task 8: Extend TypeScript bindings

**Files:**
- Modify: `src/multiplayer/bindings.ts`

- [ ] **Step 1: Add `at` to `ChatMsg`:**

```ts
export interface ChatMsg {
  channel: string | null;
  from: string;
  text: string;
  kind: ChatKind;
  at: number;
}
```

- [ ] **Step 2: Add `DirChannel` + extend `LobbyState`:**

```ts
export interface DirChannel {
  name: string;
  userCount: number;
  topic: string | null;
}

export interface LobbyState {
  myUsername: string | null;
  compflags: string[];
  users: Record<string, User>;
  channels: Record<string, ChannelState>;
  dms: Record<string, ChatMsg[]>;
  battles: Record<string, Battle>;
  currentBattle: number | null;
  lastBattle: number | null;
  channelDirectory: DirChannel[];
}
```

- [ ] **Step 3: Add the `channelListReceived` delta** to the `Delta` union:

```ts
  | { kind: "channelListReceived" }
```

- [ ] **Step 4: Add the `mpListChannels` command** (near `mpJoinChannel`):

```ts
export const mpListChannels = defineCommand<
  { serverKey: string },
  { sent: boolean }
>("coilbox-multiplayer", "mp_list_channels");
```

- [ ] **Step 5: Typecheck**

Run: `bun run typecheck` Expected: PASS (no consumers broke - additive changes).

- [ ] **Step 6: Commit**

```bash
git add src/multiplayer/bindings.ts
git commit -m "feat(multiplayer): bindings for DMs, channel directory, timestamps"
```

---

### Task 9: Unread tracking + conversation ids in the provider

Add conversation-id helpers and provider-level unread state (baseline seeded on connect so persisted history isn't unread; survives navigation).

**Files:**
- Create: `src/multiplayer/chat/conversation.ts`
- Modify: `src/multiplayer/store.tsx`

- [ ] **Step 1: Add conversation descriptor + id helpers.** Create `src/multiplayer/chat/conversation.ts`:

```ts
import type { ChatMsg, LobbyState, User } from "../bindings";

/** Which conversation a chat surface is bound to. `battle` is reserved for the
 * future battle GUI and not used by the hub. */
export type ConversationDescriptor =
  | { kind: "channel"; name: string }
  | { kind: "dm"; peer: string };

/** Stable string id for unread bookkeeping and selection. */
export function convId(d: ConversationDescriptor): string {
  return d.kind === "channel" ? `channel:${d.name}` : `dm:${d.peer}`;
}

/** All conversation ids present in a snapshot, with their current message counts. */
export function conversationCounts(state: LobbyState): Record<string, number> {
  const out: Record<string, number> = {};
  for (const name of Object.keys(state.channels)) {
    out[`channel:${name}`] = state.channels[name].messages.length;
  }
  for (const peer of Object.keys(state.dms ?? {})) {
    out[`dm:${peer}`] = state.dms[peer].length;
  }
  return out;
}

/** Resolve members of a conversation from the snapshot (empty for DMs). */
export function conversationMembers(
  state: LobbyState,
  d: ConversationDescriptor,
): User[] {
  if (d.kind !== "channel") return [];
  const ch = state.channels[d.name];
  if (!ch) return [];
  return ch.users
    .map((u) => state.users[u])
    .filter((u): u is User => Boolean(u));
}

/** Messages of a conversation from the snapshot. */
export function conversationMessages(
  state: LobbyState,
  d: ConversationDescriptor,
): ChatMsg[] {
  if (d.kind === "channel") return state.channels[d.name]?.messages ?? [];
  return state.dms?.[d.peer] ?? [];
}
```

- [ ] **Step 2: Add unread state to `MultiplayerProvider`** in `store.tsx`. Extend the context type:

```ts
interface MultiplayerContextValue {
  mirror: LobbyMirror;
  activeKey: string | null;
  busy: boolean;
  connect: (server: LobbyServer) => Promise<void>;
  disconnect: () => Promise<void>;
  /** Unread count for a conversation id given its current message count. */
  unreadFor: (id: string, count: number) => number;
  /** Mark a conversation read up to its current message count. */
  markSeen: (id: string, count: number) => void;
}
```

Add imports at the top of `store.tsx`:

```ts
import { useEffect, useRef } from "react";
import { conversationCounts } from "./chat/conversation";
```

(Merge `useEffect`/`useRef` into the existing `react` import.)

Inside `MultiplayerProvider`, add the seen map + baseline effect + callbacks:

```ts
  // Per-conversation "seen up to N messages" marks. Seeded to the connect-time
  // snapshot so persisted DM history and already-present channel logs don't show
  // as unread; conversations appearing AFTER connect start unseen (fully unread).
  const seenRef = useRef<Record<string, number>>({});
  const [, forceSeenTick] = useReducer((n: number) => n + 1, 0);
  const baselineDoneRef = useRef(false);

  useEffect(() => {
    if (activeKey == null) {
      seenRef.current = {};
      baselineDoneRef.current = false;
      return;
    }
    if (!baselineDoneRef.current && mirror.state) {
      seenRef.current = conversationCounts(mirror.state);
      baselineDoneRef.current = true;
      forceSeenTick();
    }
  }, [activeKey, mirror.state]);

  const unreadFor = useCallback((id: string, count: number) => {
    const seen = seenRef.current[id] ?? 0;
    return Math.max(0, count - seen);
  }, []);

  const markSeen = useCallback((id: string, count: number) => {
    if (seenRef.current[id] === count) return;
    seenRef.current[id] = count;
    forceSeenTick();
  }, []);
```

Add `unreadFor` and `markSeen` to the context provider `value={{ ... }}`.

- [ ] **Step 3: Typecheck**

Run: `bun run typecheck` Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/multiplayer/chat/conversation.ts src/multiplayer/store.tsx
git commit -m "feat(multiplayer): conversation ids + unread tracking"
```

---

## Phase 4 - Frontend chat components (`src/multiplayer/chat`)

> No frontend unit-test runner exists; each task here verifies with `bun run typecheck` + `bunx biome ci .`, and the whole surface is smoke-tested live in Task 16.

### Task 10: `useConversation` hook

**Files:**
- Create: `src/multiplayer/chat/useConversation.ts`

- [ ] **Step 1: Write the hook.** Create the file:

```ts
import { useCallback, useMemo } from "react";
import { mpSay, mpSayPrivate } from "../bindings";
import type { ChatMsg, User } from "../bindings";
import { useMultiplayer } from "../store";
import {
  type ConversationDescriptor,
  conversationMembers,
  conversationMessages,
} from "./conversation";

export interface ConversationView {
  title: string;
  subtitle?: string;
  messages: ChatMsg[];
  members: User[];
  /** Send text to this conversation (no-op when not connected/empty). */
  send: (text: string) => Promise<void>;
}

/**
 * Bind a conversation descriptor to the live mirror: its title, messages,
 * members, and a `send` that targets the right wire command. This is the single
 * place that knows channel-vs-DM differences, so `ChatPane` stays presentational
 * and the future battle GUI reuses the same component.
 */
export function useConversation(
  desc: ConversationDescriptor | null,
): ConversationView {
  const { mirror, activeKey } = useMultiplayer();
  const state = mirror.state;

  const messages = useMemo(
    () => (state && desc ? conversationMessages(state, desc) : []),
    [state, desc],
  );
  const members = useMemo(
    () => (state && desc ? conversationMembers(state, desc) : []),
    [state, desc],
  );

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!activeKey || !desc || !trimmed) return;
      if (desc.kind === "channel") {
        await mpSay({ serverKey: activeKey, channel: desc.name, message: trimmed });
      } else {
        await mpSayPrivate({
          serverKey: activeKey,
          username: desc.peer,
          message: trimmed,
        });
      }
    },
    [activeKey, desc],
  );

  const title = !desc ? "" : desc.kind === "channel" ? `#${desc.name}` : desc.peer;
  const subtitle =
    desc?.kind === "channel"
      ? (state?.channels[desc.name]?.topic ?? undefined)
      : undefined;

  return { title, subtitle, messages, members, send };
}
```

- [ ] **Step 2: Typecheck + lint**

Run: `bun run typecheck` and `bunx biome ci src/multiplayer/chat/useConversation.ts` Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/multiplayer/chat/useConversation.ts
git commit -m "feat(multiplayer): useConversation hook"
```

---

### Task 11: `ChatPane` (presentational) + `MemberList`

**Files:**
- Create: `src/multiplayer/chat/ChatPane.tsx`
- Create: `src/multiplayer/chat/MemberList.tsx`

- [ ] **Step 1: Write `MemberList`.** Create `MemberList.tsx`:

```tsx
import type { User } from "../bindings";

/**
 * A reusable member panel: the users in the active conversation, with a coarse
 * status hint. Clicking a member (when `onSelect` is given) starts a DM.
 */
export function MemberList({
  members,
  onSelect,
}: {
  members: User[];
  onSelect?: (username: string) => void;
}) {
  return (
    <aside className="flex w-56 shrink-0 flex-col border-l border-border">
      <div className="border-b border-border px-4 py-3 text-sm font-semibold">
        Members ({members.length})
      </div>
      <ul className="flex flex-col gap-0.5 overflow-auto p-2">
        {members.map((u) => {
          const label = u.status.ingame
            ? "in-game"
            : u.status.away
              ? "away"
              : null;
          const row = (
            <span className="flex items-center justify-between gap-2">
              <span className="truncate">{u.name}</span>
              {label && (
                <span className="text-xs text-muted-foreground">{label}</span>
              )}
            </span>
          );
          return (
            <li key={u.name}>
              {onSelect ? (
                <button
                  type="button"
                  onClick={() => onSelect(u.name)}
                  className="w-full rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted"
                >
                  {row}
                </button>
              ) : (
                <span className="block px-2 py-1.5 text-sm">{row}</span>
              )}
            </li>
          );
        })}
        {members.length === 0 && (
          <li className="px-2 py-1.5 text-sm text-muted-foreground">
            No members.
          </li>
        )}
      </ul>
    </aside>
  );
}
```

- [ ] **Step 2: Write `ChatPane`.** Create `ChatPane.tsx` (store-agnostic; fills its container):

```tsx
import { Button, Input } from "@picoframe/frame";
import { type ReactNode, useEffect, useRef, useState } from "react";
import type { ChatMsg } from "../bindings";

/** Format a unix-millis timestamp as a short local time (blank when absent). */
function formatTime(at: number): string {
  if (!at) return "";
  return new Date(at).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export interface ChatPaneProps {
  title: string;
  subtitle?: string;
  messages: ChatMsg[];
  /** The logged-in username, used to right-align our own messages. */
  currentUser?: string | null;
  onSend: (text: string) => void | Promise<void>;
  /** Top-bar action buttons (e.g. a members toggle). */
  headerActions?: ReactNode;
  /** `full` fills the viewport column; `embedded` fits a smaller host box. */
  variant?: "full" | "embedded";
  emptyState?: ReactNode;
  placeholder?: string;
  disabled?: boolean;
}

/**
 * The reusable chat surface: a top bar, an auto-scrolling message list, and a
 * bottom composer. Presentational only - it imports no store, so the hub and the
 * future battle GUI render the identical component for visual consistency.
 */
export function ChatPane({
  title,
  subtitle,
  messages,
  currentUser,
  onSend,
  headerActions,
  variant = "full",
  emptyState,
  placeholder = "Message…",
  disabled = false,
}: ChatPaneProps) {
  const [draft, setDraft] = useState("");
  const endRef = useRef<HTMLDivElement>(null);

  // Keep the newest message in view as the log grows.
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length]);

  async function submit() {
    const text = draft.trim();
    if (!text || disabled) return;
    setDraft("");
    await onSend(text);
  }

  return (
    <section
      className={
        variant === "full"
          ? "flex min-w-0 flex-1 flex-col"
          : "flex min-h-0 flex-col rounded-md border border-border"
      }
    >
      <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold">{title}</h2>
          {subtitle && (
            <p className="truncate text-xs text-muted-foreground">{subtitle}</p>
          )}
        </div>
        {headerActions && (
          <div className="flex shrink-0 items-center gap-1">{headerActions}</div>
        )}
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-auto px-4 py-3">
        {messages.length === 0
          ? (emptyState ?? (
              <p className="text-sm text-muted-foreground">No messages yet.</p>
            ))
          : messages.map((m, i) => {
              const own = currentUser != null && m.from === currentUser;
              return (
                <div
                  // biome-ignore lint/suspicious/noArrayIndexKey: append-only log, index is stable identity.
                  key={`${m.from}-${m.at}-${i}`}
                  className={own ? "flex flex-col items-end" : "flex flex-col items-start"}
                >
                  <div
                    className={
                      own
                        ? "max-w-[75%] rounded-2xl rounded-br-sm bg-primary px-3 py-1.5 text-sm text-primary-foreground"
                        : "max-w-[75%] rounded-2xl rounded-bl-sm bg-muted px-3 py-1.5 text-sm"
                    }
                  >
                    {!own && (
                      <span className="mr-2 text-xs font-medium text-muted-foreground">
                        {m.from}
                      </span>
                    )}
                    <span className="whitespace-pre-wrap break-words">{m.text}</span>
                  </div>
                  <span className="px-1 pt-0.5 text-[10px] text-muted-foreground">
                    {formatTime(m.at)}
                  </span>
                </div>
              );
            })}
        <div ref={endRef} />
      </div>

      <div className="flex gap-2 border-t border-border px-4 py-3">
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder={placeholder}
          disabled={disabled}
          aria-label="Message"
        />
        <Button onClick={submit} disabled={disabled || draft.trim() === ""}>
          Send
        </Button>
      </div>
    </section>
  );
}
```

- [ ] **Step 2b: Typecheck + lint**

Run: `bun run typecheck` and `bunx biome ci src/multiplayer/chat` Expected: PASS. (If `bg-primary`/`text-primary-foreground` are unavailable in the theme, fall back to `bg-foreground`/`bg-muted` - verify against an existing component's classes during the live smoke.)

- [ ] **Step 3: Commit**

```bash
git add src/multiplayer/chat/ChatPane.tsx src/multiplayer/chat/MemberList.tsx
git commit -m "feat(multiplayer): presentational ChatPane + MemberList"
```

---

### Task 12: `ConversationSidebar`

**Files:**
- Create: `src/multiplayer/chat/ConversationSidebar.tsx`

- [ ] **Step 1: Write the sidebar.** Lists joined channels + DM threads with unread badges, a "Browse channels" button, and a new-DM input:

```tsx
import { Button, Input } from "@picoframe/frame";
import { Hash, MessageSquare, Search } from "lucide-react";
import { useState } from "react";
import { useMultiplayer } from "../store";
import { type ConversationDescriptor, convId } from "./conversation";

function Badge({ n }: { n: number }) {
  if (n <= 0) return null;
  return (
    <span className="ml-auto min-w-5 rounded-full bg-primary px-1.5 text-center text-xs text-primary-foreground">
      {n > 99 ? "99+" : n}
    </span>
  );
}

/** The left rail: channels, DMs, unread badges, browse + new-DM affordances. */
export function ConversationSidebar({
  active,
  onSelect,
  onBrowse,
}: {
  active: ConversationDescriptor | null;
  onSelect: (d: ConversationDescriptor) => void;
  onBrowse: () => void;
}) {
  const { mirror, unreadFor } = useMultiplayer();
  const state = mirror.state;
  const channels = state ? Object.keys(state.channels).sort() : [];
  const peers = state ? Object.keys(state.dms ?? {}).sort() : [];
  const [newDm, setNewDm] = useState("");

  const activeId = active ? convId(active) : null;

  function rowClass(id: string): string {
    return `flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm ${
      id === activeId ? "bg-muted font-medium" : "hover:bg-muted"
    }`;
  }

  function startDm() {
    const peer = newDm.trim();
    if (!peer) return;
    setNewDm("");
    onSelect({ kind: "dm", peer });
  }

  return (
    <nav className="flex w-60 shrink-0 flex-col border-r border-border">
      <div className="flex items-center justify-between px-3 py-3">
        <span className="text-sm font-semibold">Channels</span>
        <Button onClick={onBrowse} aria-label="Browse channels" className="h-7 px-2">
          <Search className="size-4" />
        </Button>
      </div>
      <ul className="flex flex-col gap-0.5 px-2">
        {channels.map((name) => {
          const id = `channel:${name}`;
          const count = state?.channels[name].messages.length ?? 0;
          return (
            <li key={id}>
              <button
                type="button"
                className={rowClass(id)}
                onClick={() => onSelect({ kind: "channel", name })}
              >
                <Hash className="size-4 shrink-0 text-muted-foreground" />
                <span className="truncate">{name}</span>
                <Badge n={unreadFor(id, count)} />
              </button>
            </li>
          );
        })}
        {channels.length === 0 && (
          <li className="px-2 py-1.5 text-xs text-muted-foreground">
            No channels joined. Browse to join one.
          </li>
        )}
      </ul>

      <div className="mt-4 px-3 py-2 text-sm font-semibold">Direct messages</div>
      <ul className="flex flex-col gap-0.5 px-2">
        {peers.map((peer) => {
          const id = `dm:${peer}`;
          const count = state?.dms[peer].length ?? 0;
          return (
            <li key={id}>
              <button
                type="button"
                className={rowClass(id)}
                onClick={() => onSelect({ kind: "dm", peer })}
              >
                <MessageSquare className="size-4 shrink-0 text-muted-foreground" />
                <span className="truncate">{peer}</span>
                <Badge n={unreadFor(id, count)} />
              </button>
            </li>
          );
        })}
      </ul>

      <div className="mt-auto flex gap-2 border-t border-border p-3">
        <Input
          value={newDm}
          onChange={(e) => setNewDm(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") startDm();
          }}
          placeholder="New DM: username"
          aria-label="Start a direct message"
        />
      </div>
    </nav>
  );
}
```

- [ ] **Step 2: Typecheck + lint**

Run: `bun run typecheck` and `bunx biome ci src/multiplayer/chat` Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/multiplayer/chat/ConversationSidebar.tsx
git commit -m "feat(multiplayer): conversation sidebar with unread badges"
```

---

### Task 13: `ChannelBrowser` drawer

**Files:**
- Create: `src/multiplayer/chat/ChannelBrowser.tsx`

- [ ] **Step 1: Write the drawer.** A slide-in `<aside>` (not a modal); on open it requests the directory, lists it, and joins on click:

```tsx
import { Button } from "@picoframe/frame";
import { X } from "lucide-react";
import { useEffect, useState } from "react";
import { mpJoinChannel, mpListChannels } from "../bindings";
import { useMultiplayer } from "../store";

/**
 * A right-edge slide-in drawer listing the server's public channels. Requests the
 * directory each time it opens; Join sends `JOIN` and hands the name back so the
 * hub can select it once the join lands. Motion is disabled under
 * prefers-reduced-motion via the `motion-reduce:` variants.
 */
export function ChannelBrowser({
  open,
  onClose,
  onJoined,
}: {
  open: boolean;
  onClose: () => void;
  onJoined: (name: string) => void;
}) {
  const { mirror, activeKey } = useMultiplayer();
  const [loading, setLoading] = useState(false);
  const directory = mirror.state?.channelDirectory ?? [];

  useEffect(() => {
    if (!open || !activeKey) return;
    setLoading(true);
    mpListChannels({ serverKey: activeKey }).catch(() => {});
  }, [open, activeKey]);

  // The directory arriving (channelListReceived -> snapshot) clears loading.
  useEffect(() => {
    if (directory.length > 0) setLoading(false);
  }, [directory.length]);

  async function join(name: string) {
    if (!activeKey) return;
    await mpJoinChannel({ serverKey: activeKey, channel: name });
    onJoined(name);
    onClose();
  }

  return (
    <>
      {open && (
        <button
          type="button"
          aria-label="Close channel browser"
          className="absolute inset-0 z-10 bg-black/20"
          onClick={onClose}
        />
      )}
      <aside
        className={`absolute inset-y-0 right-0 z-20 flex w-80 flex-col border-l border-border bg-background shadow-lg transition-transform motion-reduce:transition-none ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
        aria-hidden={!open}
      >
        <header className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold">Browse channels</h2>
          <div className="flex items-center gap-1">
            <Button
              className="h-7 px-2"
              onClick={() => activeKey && mpListChannels({ serverKey: activeKey })}
            >
              Refresh
            </Button>
            <Button className="h-7 px-2" onClick={onClose} aria-label="Close">
              <X className="size-4" />
            </Button>
          </div>
        </header>
        <ul className="flex flex-col gap-1 overflow-auto p-3">
          {loading && directory.length === 0 && (
            <li className="text-sm text-muted-foreground">Loading channels…</li>
          )}
          {!loading && directory.length === 0 && (
            <li className="text-sm text-muted-foreground">No channels found.</li>
          )}
          {directory.map((c) => (
            <li
              key={c.name}
              className="flex items-center justify-between gap-2 rounded-md border border-border p-2"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">
                  {c.name}{" "}
                  <span className="text-xs text-muted-foreground">
                    ({c.userCount})
                  </span>
                </p>
                {c.topic && (
                  <p className="truncate text-xs text-muted-foreground">
                    {c.topic}
                  </p>
                )}
              </div>
              <Button className="h-7 px-2" onClick={() => join(c.name)}>
                Join
              </Button>
            </li>
          ))}
        </ul>
      </aside>
    </>
  );
}
```

- [ ] **Step 2: Typecheck + lint**

Run: `bun run typecheck` and `bunx biome ci src/multiplayer/chat` Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/multiplayer/chat/ChannelBrowser.tsx
git commit -m "feat(multiplayer): channel browser drawer"
```

---

### Task 14: `ChatPage` hub

**Files:**
- Create: `src/multiplayer/pages/ChatPage.tsx`

- [ ] **Step 1: Write the hub page.** Composes the sidebar, `ChatPane` (via `useConversation`), the member panel, and the drawer; handles not-connected and no-selection states; marks the active conversation seen:

```tsx
import { Button } from "@picoframe/frame";
import { Users } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { ChannelBrowser } from "../chat/ChannelBrowser";
import { ChatPane } from "../chat/ChatPane";
import { ConversationSidebar } from "../chat/ConversationSidebar";
import { type ConversationDescriptor, convId } from "../chat/conversation";
import { MemberList } from "../chat/MemberList";
import { useConversation } from "../chat/useConversation";
import { useMultiplayer } from "../store";

/**
 * The chat hub: sidebar of channels + DMs, a reusable ChatPane for the active
 * conversation, a toggleable member panel, and the channel-browser drawer.
 * Connection lives on the Lobby page; when disconnected this shows a prompt.
 */
export default function ChatPage() {
  const { mirror, activeKey, markSeen } = useMultiplayer();
  const [active, setActive] = useState<ConversationDescriptor | null>(null);
  const [showMembers, setShowMembers] = useState(false);
  const [browserOpen, setBrowserOpen] = useState(false);

  const conv = useConversation(active);
  const me = mirror.state?.myUsername ?? null;

  // Mark the open conversation read as its message count changes.
  useEffect(() => {
    if (active) markSeen(convId(active), conv.messages.length);
  }, [active, conv.messages.length, markSeen]);

  if (!activeKey) {
    return (
      <main className="flex flex-col items-center justify-center gap-4 p-10 text-center">
        <h1 className="text-lg font-semibold">Chat</h1>
        <p className="text-sm text-muted-foreground">
          You are not connected to a lobby server.
        </p>
        <Button asChild>
          <Link to="/lobby">Go to the Lobby to connect</Link>
        </Button>
      </main>
    );
  }

  return (
    <main className="relative flex h-full min-h-0 overflow-hidden">
      <ConversationSidebar
        active={active}
        onSelect={setActive}
        onBrowse={() => setBrowserOpen(true)}
      />

      {active ? (
        <ChatPane
          variant="full"
          title={conv.title}
          subtitle={conv.subtitle}
          messages={conv.messages}
          currentUser={me}
          onSend={conv.send}
          placeholder={
            active.kind === "channel"
              ? `Message ${conv.title}`
              : `Message ${conv.title}`
          }
          headerActions={
            active.kind === "channel" ? (
              <Button
                className="h-7 px-2"
                onClick={() => setShowMembers((v) => !v)}
                aria-label="Toggle members"
                aria-pressed={showMembers}
              >
                <Users className="size-4" />
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
          Select a conversation, or browse channels to join one.
        </div>
      )}

      {active?.kind === "channel" && showMembers && (
        <MemberList
          members={conv.members}
          onSelect={(username) => setActive({ kind: "dm", peer: username })}
        />
      )}

      <ChannelBrowser
        open={browserOpen}
        onClose={() => setBrowserOpen(false)}
        onJoined={(name) => setActive({ kind: "channel", name })}
      />
    </main>
  );
}
```

- [ ] **Step 2: Typecheck + lint**

Run: `bun run typecheck` and `bunx biome ci src/multiplayer` Expected: PASS. (If `<Button asChild>` is unsupported by `@picoframe/frame`, replace with a plain `Link` styled as a button - confirm the Button API during the smoke.)

- [ ] **Step 3: Commit**

```bash
git add src/multiplayer/pages/ChatPage.tsx
git commit -m "feat(multiplayer): chat hub page"
```

---

### Task 15: Register the Chat nav item + route

**Files:**
- Modify: `src/multiplayer/index.ts`

- [ ] **Step 1: Add the nav item + route.** Update `index.ts`:

```ts
import type { FramePlugin } from "@picoframe/plugin-sdk";
import { MessagesSquare, Swords } from "lucide-react";
import { MultiplayerProvider } from "./store";
```

Add to the `items` array (after the Lobby item):

```ts
        {
          id: "multiplayer.chat",
          label: "Chat",
          to: "/chat",
          end: true,
          order: 1,
          icon: MessagesSquare,
        },
```

Add to `routes`:

```ts
    {
      path: "chat",
      lazy: () => import("./pages/ChatPage"),
      crumb: "Chat",
    },
```

- [ ] **Step 2: Typecheck + lint**

Run: `bun run typecheck` and `bunx biome ci src/multiplayer` Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/multiplayer/index.ts
git commit -m "feat(multiplayer): Chat nav item + route"
```

---

### Task 16: Full verification + live smoke

**Files:** none (verification only).

- [ ] **Step 1: Run the complete CI-equivalent gate** from the repo root:

Run: `cargo fmt --all --check` Run: `cargo clippy --all-targets --all-features -- -D warnings` Run: `cargo test -p coilbox-lobby-protocol -p tauri-plugin-coilbox-multiplayer` Run: `bunx biome ci .` Run: `bun run typecheck` Expected: all pass. Fix any failures before proceeding.

- [ ] **Step 2: Live smoke** with `bun tauri dev`. Connect on the Lobby page, then open **Chat** and verify:
  - Sidebar shows joined channels; **Browse channels** opens the drawer, lists the directory, and **Join** adds a channel that becomes selectable.
  - Sending in a channel appears in the pane; incoming channel chat appears; timestamps render.
  - **New DM: username** opens a DM; sending shows your message immediately (right-aligned); an incoming DM appears and raises an unread badge that clears when viewed.
  - The members toggle shows/hides the member panel; clicking a member opens a DM.
  - Disconnect (on Lobby), reconnect, reopen a DM peer: **prior DM history is present** (persistence). Confirm a JSONL file exists under the app data dir `coilbox/lobby-dms/`.

- [ ] **Step 3: Record any smoke fixes**, then re-run Step 1's gate and commit fixes with a descriptive message.

---

## Self-review notes

- **Spec coverage:** DM store (Task 2), outgoing echo + local record (Tasks 2/6/7), timestamps (Task 1), channel directory + `mp_list_channels` (Tasks 3/7), DM persistence JSONL per account (Tasks 5/6), presentational `ChatPane` + `useConversation` (Tasks 10/11), sidebar + unread (Tasks 9/12), channel-browser **drawer** (Task 13), hub page + not-connected empty state (Task 14), nav (Task 15). Battle-in-hub, mentions, OS notifications, channel-history persistence remain out of scope per the spec.
- **Type consistency:** `reduce_at(state, msg, now_ms)`, `record_outgoing_private(state, peer, text, now_ms)`, `begin_channel_list(state)`, `DirChannel { name, user_count, topic }`, `Delta::ChannelListReceived`, `Outbound::{Line, SayPrivate{peer,text}}`, `DmLog::{new,load,append}`, `ConversationDescriptor`, `convId`, `unreadFor`/`markSeen`, `mpListChannels`, `LobbyState.dms`/`channelDirectory`, `ChatMsg.at` are used identically across backend and frontend tasks.
- **Reserved:** the `battle` conversation branch is intentionally absent (added with the battle GUI); `useConversation`/`ChatPane` are already shaped to accept it.
