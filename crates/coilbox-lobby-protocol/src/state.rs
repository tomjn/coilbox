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
///
/// `id` is the server's channel-history row id, set only on lines replayed by
/// `GETCHANNELMESSAGES`; live chat carries no id, so `Some` means "backlog" and
/// `None` means "just happened". Consumers rely on that to avoid re-logging,
/// re-notifying and mis-counting a replayed backlog as unread. For `at` it also
/// marks the one case where the timestamp is the server's send time rather than
/// our receive time.
///
/// This is a disk format as well as a wire one: chat logs are JSONL of `ChatMsg`
/// and a line that fails to parse is skipped silently, so any field added here
/// must tolerate its own absence in lines written before it existed.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatMsg {
    pub channel: Option<String>,
    pub from: String,
    pub text: String,
    pub kind: ChatKind,
    pub at: u64,
    pub id: Option<u64>,
}

/// The state of a joined channel.
///
/// `founder`/`operators` are not part of the base protocol — they're learned by
/// parsing a ChanServ `:info` reply (see `reduce`), and drive who sees the
/// channel-moderation controls. They stay empty for channels ChanServ doesn't
/// manage or that we've not queried.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChannelState {
    pub name: String,
    pub topic: Option<String>,
    pub users: HashSet<String>,
    pub messages: Vec<ChatMsg>,
    /// The channel's registered founder (from ChanServ `:info`), if any.
    pub founder: Option<String>,
    /// The channel's operators (from ChanServ `:info`).
    pub operators: HashSet<String>,
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
    /// The Tachyon lobby id this battle came from, or `None` on a TASServer
    /// connection. Tachyon names a lobby by a string uuid and `id` is a `u32`,
    /// so `id` is a handle derived from this and this is what a later
    /// `lobby/join` has to name.
    pub tachyon_id: Option<String>,
    pub host: String,
    pub ip: String,
    pub port: String,
    /// The host's declared NAT traversal mode: `"0"` for a directly reachable
    /// port, `"1"` for hole punching, `"2"` for fixed source ports. We only
    /// implement the direct case, so anything else is worth telling a joining
    /// player about rather than letting the engine hang on it.
    pub nat_type: String,
    pub map: String,
    pub maphash: String,
    pub modname: String,
    pub engine: String,
    pub version: String,
    pub max_players: u32,
    /// How many players the server says are in the battle, where the server
    /// counts them for us. TASServer does not, so it stays `None` there and the
    /// count is worked out from `members` and `host` instead.
    pub player_count: Option<u32>,
    pub passworded: bool,
    pub locked: bool,
    pub spectator_count: u32,
    pub title: String,
    pub channel: Option<String>,
    pub members: HashMap<String, MemberStatus>,
    pub bots: HashMap<String, Bot>,
    pub script_tags: BTreeMap<String, String>,
    pub start_rects: HashMap<u8, StartRect>,
    /// The members who may change the lobby, by the name the roster shows them
    /// under. Tachyon's answer to a host: a lobby has no founder, and a boss is
    /// appointed by a vote rather than by opening the battle. Always empty on a
    /// TASServer connection, where `host` is who may change things.
    pub bosses: Vec<String>,
    /// Whether this lobby allows bosses at all. A lobby with them switched off
    /// refuses `lobby/appointBoss`, so the room offers it only when this is set.
    pub bosses_enabled: bool,
    /// Whether a battle is running in this lobby, so the row offers Watch live
    /// rather than Join. Tachyon says so on the lobby itself. Always false on a
    /// TASServer connection, which says nothing about the battle and where the
    /// list reads the host's ingame bit instead.
    pub in_progress: bool,
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

/// A party: a small group that stays together across battles and, once
/// matchmaking is built, queues as one.
///
/// Tachyon only. TASServer has no such thing, so a connection to one leaves
/// [`LobbyState::party`] empty, the way it leaves `bosses` and `in_progress`
/// empty on a battle.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Party {
    /// The server's id for this party, which is what an answer to an invitation
    /// names.
    pub id: String,
    /// The members, by the name the rest of the app shows them under, in the
    /// order the server listed them. Somebody the server has not named yet is
    /// under their user id, as they are in a battle roster.
    pub members: Vec<String>,
    /// The people invited and yet to answer, named the same way.
    pub invited: Vec<String>,
    /// How many members the server will let this party hold.
    pub max_members: u32,
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
    /// The party we are in, or `None` when we are in none. Always `None` on a
    /// TASServer connection, which has no parties.
    pub party: Option<Party>,
    /// The parties we have been invited to and not yet answered, in the order the
    /// server listed them. Always empty on a TASServer connection.
    pub party_invites: Vec<Party>,
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
