//! The authoritative per-connection lobby state.
//!
//! This crate holds ONE connection's state. Multi-server is the plugin's
//! concern — it keeps a map of these. Every type here crosses to the frontend,
//! so all derive `Serialize` with camelCase field names.

use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};

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

/// A transient SPADS autohost vote in the current battle, surfaced so the UI can
/// show a one-click Yes/No/Abstain panel instead of making the user read chat and
/// type `!vote`. Present only while a vote is open; cleared when it passes, fails,
/// is cancelled, or we leave the battle.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Vote {
    /// The command being voted on, e.g. `set map Red Comet`.
    pub subject: String,
    /// Who called the vote (empty when we joined mid-vote and only saw progress).
    pub caller: String,
    pub yes: u32,
    pub no: u32,
    /// Yes votes needed to pass, from the latest progress line (0 until one arrives).
    pub yes_needed: u32,
    /// No votes needed to fail, from the latest progress line.
    pub no_needed: u32,
    /// Whether the bot advertised abstain (`!vote b`); the panel hides Abstain if not.
    pub allow_abstain: bool,
    /// Unix-millis deadline derived from the progress "Ns remaining" (0 if unknown).
    pub ends_at: u64,
}

/// A public channel as advertised by the server's `CHANNELS` directory.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DirChannel {
    pub name: String,
    pub user_count: u32,
    pub topic: Option<String>,
}

/// The authoritative lobby state for one connection.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
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
    /// The UDP port the server told us to host our battle on (`HOSTPORT`), set only
    /// while we are the founder of `current_battle`. The host-mode start script binds
    /// the engine to this; cleared when we open a fresh battle.
    pub host_port: Option<u16>,
    /// The last-fetched public channel directory (from `CHANNELS`).
    pub channel_directory: Vec<DirChannel>,
    /// Server-confirmed ignores for this account, reconciled from the server's
    /// `IGNORELIST` and its `IGNORE`/`UNIGNORE` acks. The client-side ignore list
    /// (a frontend preference) is the source of truth for hiding; this mirrors what
    /// the server has stored so both can be converged on login.
    pub server_ignores: BTreeSet<String>,
    /// Mutual (established) server-side friends, synced from `FRIENDLIST` on login
    /// and kept live by `FRIEND`/`UNFRIEND`. Sorted; merged with client-local
    /// favourites in the Friends UI. Empty on servers without friend support.
    pub friends: BTreeSet<String>,
    /// Incoming pending friend requests (`FRIENDREQUEST` / `FRIENDREQUESTLIST`),
    /// awaiting our accept/decline. Sorted; empty on unsupported servers.
    pub friend_requests: BTreeSet<String>,
    /// A live SPADS autohost vote in the current battle, or `None` when none is
    /// open. Parsed from the bot's battle chat; drives the vote panel.
    pub current_vote: Option<Vote>,
    /// Our intended per-battle status + team colour, authoritative for answering
    /// `REQUESTBATTLESTATUS`. Set when we open a battle (host defaults to player)
    /// and updated on every status push (spectate/ready/sync/colour), so a server
    /// re-prompt never reverts us to the spectator default. Cleared on leave.
    /// Internal-only: the frontend reads confirmed status from `members`.
    #[serde(skip)]
    pub my_intended_battle_status: Option<(BattleStatus, u32)>,
}

impl LobbyState {
    /// A fresh, empty state.
    pub fn new() -> Self {
        Self::default()
    }

    /// Our current battle status + team colour, for answering `REQUESTBATTLESTATUS`.
    /// Falls back to the protocol default when we are not yet a member (e.g. the
    /// prompt races our own join), so the server always gets a well-formed reply.
    pub fn my_battle_status_or_default(&self) -> (BattleStatus, u32) {
        // Our own intent wins: it's set the moment we open a battle (host → player)
        // and on every status push, so a re-prompt can't revert a spectate toggle.
        if let Some(intended) = self.my_intended_battle_status {
            return intended;
        }
        if let (Some(bid), Some(me)) = (self.current_battle, self.my_username.as_ref()) {
            if let Some(m) = self.battles.get(&bid).and_then(|b| b.members.get(me)) {
                return (m.battle_status, m.team_color);
            }
        }
        (crate::status::default_battle_status(), 0)
    }
}
