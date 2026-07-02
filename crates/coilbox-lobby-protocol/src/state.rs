//! The authoritative per-connection lobby state.
//!
//! This crate holds ONE connection's state. Multi-server is the plugin's
//! concern — it keeps a map of these. Every type here crosses to the frontend,
//! so all derive `Serialize` with camelCase field names.

use std::collections::{BTreeMap, HashMap, HashSet};

use serde::{Deserialize, Serialize};

use crate::status::{BattleStatus, ClientStatus};

/// A logged-in user visible on the server.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct User {
    pub name: String,
    pub country: String,
    pub user_id: String,
    pub agent: String,
    pub status: ClientStatus,
}

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

/// The state of a joined channel.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChannelState {
    pub name: String,
    pub topic: Option<String>,
    pub users: HashSet<String>,
    pub messages: Vec<ChatMsg>,
}

/// A member's status inside a battle.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemberStatus {
    pub battle_status: BattleStatus,
    pub team_color: u32,
    pub script_password: Option<String>,
}

/// An AI bot inside a battle.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Bot {
    pub name: String,
    pub owner: String,
    pub ai_dll: String,
    pub battle_status: BattleStatus,
    pub team_color: u32,
}

/// A start-position rectangle for an ally team.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StartRect {
    pub left: i32,
    pub top: i32,
    pub right: i32,
    pub bottom: i32,
}

/// An open battle in the lobby room.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Battle {
    pub id: u32,
    pub host: String,
    pub ip: String,
    pub port: String,
    pub map: String,
    pub maphash: String,
    pub modname: String,
    pub engine: String,
    pub version: String,
    pub max_players: u32,
    pub passworded: bool,
    pub locked: bool,
    pub spectator_count: u32,
    pub title: String,
    pub channel: Option<String>,
    pub members: HashMap<String, MemberStatus>,
    pub bots: HashMap<String, Bot>,
    pub script_tags: BTreeMap<String, String>,
    pub start_rects: HashMap<u8, StartRect>,
}

/// The authoritative lobby state for one connection.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LobbyState {
    pub my_username: Option<String>,
    pub compflags: HashSet<String>,
    pub users: HashMap<String, User>,
    pub channels: HashMap<String, ChannelState>,
    pub battles: HashMap<u32, Battle>,
    pub current_battle: Option<u32>,
    pub last_battle: Option<u32>,
}

impl LobbyState {
    /// A fresh, empty state.
    pub fn new() -> Self {
        Self::default()
    }
}
