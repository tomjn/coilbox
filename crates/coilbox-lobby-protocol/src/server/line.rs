//! Server line builders: the direction [`crate::command`] does not cover.
//!
//! Each function returns the wire line WITHOUT a trailing newline, exactly like
//! [`crate::command`], and [`crate::command::is_wire_safe`] applies to the result
//! just the same: a `\n` in a chat body or a room title would arrive at the joiner
//! as a second command.
//!
//! The set is what a battle room needs, not the whole of TASServer: the handshake
//! five, then the room messages listed in the LAN hosting design. Anything a
//! joining client can be told, it is told with one of these.

use std::collections::BTreeMap;

use crate::status::{BattleStatus, ClientStatus};

/// The fields of a `BATTLEOPENED` announcement.
///
/// A struct rather than sixteen positional arguments, which is the one place in
/// this module where the line is wide enough for the order to be a real hazard.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct BattleOpened {
    pub id: u32,
    /// `0` for a normal battle, `1` for a replay. Rooms only ever open `0`.
    pub battle_type: u8,
    /// `0` for a directly reachable host port, which is the only kind a direct
    /// room offers: there is no third party to punch holes through.
    pub nat_type: u8,
    pub host: String,
    pub ip: String,
    pub port: u16,
    pub max_players: u32,
    pub passworded: bool,
    pub rank: u8,
    pub maphash: i32,
    pub engine: String,
    pub version: String,
    pub map: String,
    pub title: String,
    pub modname: String,
    /// The battle's chat channel, conventionally `__battle__<id>`. Battle chat is
    /// unavailable to the joiner without it: `SAIDBATTLE` is filed under the
    /// channel named here, and under nothing at all when this is `None`.
    pub channel: Option<String>,
}

/// `TASSERVER <version> <min_spring> <nat_port> <mode>`, the greeting.
///
/// Exactly four fields. A greeting with any other arity parses as `Unknown` and
/// the joiner's login machine never starts.
pub fn tas_server(version: &str, min_spring: &str, nat_port: u16, mode: u8) -> String {
    format!("TASSERVER {version} {min_spring} {nat_port} {mode}")
}

/// `COMPFLAGS <flags>`, the answer to `LISTCOMPFLAGS`.
///
/// Not optional: a joiner that never sees this sits in `AwaitCompFlags` forever,
/// with no error and no timeout to break it out.
pub fn comp_flags(flags: &[&str]) -> String {
    format!("COMPFLAGS {}", flags.join(" "))
}

/// `ACCEPTED <username>`.
pub fn accepted(username: &str) -> String {
    format!("ACCEPTED {username}")
}

/// `DENIED <reason>`.
pub fn denied(reason: &str) -> String {
    format!("DENIED {reason}")
}

/// `LOGININFOEND`, the end of the login state burst.
///
/// The only thing that makes a joiner ready. Like `COMPFLAGS`, omitting it hangs
/// them silently.
pub fn login_info_end() -> String {
    "LOGININFOEND".to_string()
}

/// `PONG [token]`, the answer to a client's `PING`.
///
/// A client that pings as a keepalive expects nothing back, so this is only
/// courtesy. It costs one line and it keeps a client that does wait for it from
/// deciding the room has gone quiet.
pub fn pong(token: Option<&str>) -> String {
    match token {
        Some(t) => format!("PONG {t}"),
        None => "PONG".to_string(),
    }
}

/// `OPENBATTLEFAILED <reason>`, a refusal to open a battle, shown verbatim.
pub fn open_battle_failed(reason: &str) -> String {
    format!("OPENBATTLEFAILED {reason}")
}

/// `ADDUSER <username> <country> <user_id> <agent>`.
pub fn add_user(username: &str, country: &str, user_id: &str, agent: &str) -> String {
    format!("ADDUSER {username} {country} {user_id} {agent}")
}

/// `REMOVEUSER <username>`.
pub fn remove_user(username: &str) -> String {
    format!("REMOVEUSER {username}")
}

/// `CLIENTSTATUS <username> <status_int>`.
///
/// Setting the host's `ingame` bit is how a direct room starts the match: there is
/// no start message in the protocol, and the battle room auto-launches a joiner
/// when the host goes ingame.
pub fn client_status(username: &str, status: ClientStatus) -> String {
    format!("CLIENTSTATUS {username} {}", status.to_int())
}

/// `BATTLEOPENED <id> <type> <natType> <host> <ip> <port> <maxplayers> <passworded> <rank> <maphash> <engine\tversion\tmap\ttitle\tmodname[\tchannel]>`.
pub fn battle_opened(b: &BattleOpened) -> String {
    let mut sentence = format!(
        "{}\t{}\t{}\t{}\t{}",
        b.engine, b.version, b.map, b.title, b.modname
    );
    if let Some(channel) = &b.channel {
        sentence.push('\t');
        sentence.push_str(channel);
    }
    format!(
        "BATTLEOPENED {} {} {} {} {} {} {} {} {} {} {sentence}",
        b.id,
        b.battle_type,
        b.nat_type,
        b.host,
        b.ip,
        b.port,
        b.max_players,
        b.passworded as u8,
        b.rank,
        b.maphash,
    )
}

/// `UPDATEBATTLEINFO <id> <spectatorCount> <locked> <maphash> <map>`.
pub fn update_battle_info(
    id: u32,
    spectators: u32,
    locked: bool,
    maphash: i32,
    map: &str,
) -> String {
    format!(
        "UPDATEBATTLEINFO {id} {spectators} {} {maphash} {map}",
        locked as u8
    )
}

/// `BATTLECLOSED <id>`.
pub fn battle_closed(id: u32) -> String {
    format!("BATTLECLOSED {id}")
}

/// `OPENBATTLE <id>`, the host's own acknowledgement, which is what sets their
/// `current_battle`.
pub fn open_battle(id: u32) -> String {
    format!("OPENBATTLE {id}")
}

/// `JOINBATTLE <id> <hashcode> [channel]`, a joiner's own acknowledgement.
///
/// Sets `current_battle`, so it has to precede every message that carries no
/// battle id of its own: `SETSCRIPTTAGS` and `ADDSTARTRECT` land nowhere if they
/// arrive first.
pub fn join_battle(id: u32, modhash: i32, channel: Option<&str>) -> String {
    match channel {
        Some(c) => format!("JOINBATTLE {id} {modhash} {c}"),
        None => format!("JOINBATTLE {id} {modhash}"),
    }
}

/// `JOINBATTLEFAILED <reason>`, a refusal the joiner shows verbatim, so it has to
/// read as a sentence: a wrong room password, a name already taken, a full room.
pub fn join_battle_failed(reason: &str) -> String {
    format!("JOINBATTLEFAILED {reason}")
}

/// `JOINEDBATTLE <id> <username> [scriptPassword]`, broadcast to the room.
///
/// The script password goes only to the host, who needs it for the start script.
/// The other members get the two-field form.
pub fn joined_battle(id: u32, username: &str, script_password: Option<&str>) -> String {
    match script_password {
        Some(sp) => format!("JOINEDBATTLE {id} {username} {sp}"),
        None => format!("JOINEDBATTLE {id} {username}"),
    }
}

/// `LEFTBATTLE <id> <username>`.
pub fn left_battle(id: u32, username: &str) -> String {
    format!("LEFTBATTLE {id} {username}")
}

/// `CLIENTBATTLESTATUS <username> <battlestatus_int> <teamcolor_int>`.
pub fn client_battle_status(username: &str, status: BattleStatus, color: u32) -> String {
    format!("CLIENTBATTLESTATUS {username} {} {color}", status.to_int())
}

/// `REQUESTBATTLESTATUS`, asking a member to (re)send their `MYBATTLESTATUS`.
///
/// Sent right after their join acknowledgement, which is how the room learns the
/// team, ally and colour they arrived with.
pub fn request_battle_status() -> String {
    "REQUESTBATTLESTATUS".to_string()
}

/// `ADDBOT <battle_id> <name> <owner> <battlestatus_int> <teamcolor_int> <aidll>`.
pub fn add_bot(
    battle_id: u32,
    name: &str,
    owner: &str,
    status: BattleStatus,
    color: u32,
    ai_dll: &str,
) -> String {
    format!(
        "ADDBOT {battle_id} {name} {owner} {} {color} {ai_dll}",
        status.to_int()
    )
}

/// `UPDATEBOT <battle_id> <name> <battlestatus_int> <teamcolor_int>`.
pub fn update_bot(battle_id: u32, name: &str, status: BattleStatus, color: u32) -> String {
    format!("UPDATEBOT {battle_id} {name} {} {color}", status.to_int())
}

/// `REMOVEBOT <battle_id> <name>`.
pub fn remove_bot(battle_id: u32, name: &str) -> String {
    format!("REMOVEBOT {battle_id} {name}")
}

/// `ADDSTARTRECT <ally> <left> <top> <right> <bottom>`.
///
/// Carries no battle id, so it applies to the receiver's current battle and must
/// follow their join acknowledgement.
pub fn add_start_rect(ally: u8, left: i32, top: i32, right: i32, bottom: i32) -> String {
    format!("ADDSTARTRECT {ally} {left} {top} {right} {bottom}")
}

/// `REMOVESTARTRECT <ally>`. Current-battle scoped, like [`add_start_rect`].
pub fn remove_start_rect(ally: u8) -> String {
    format!("REMOVESTARTRECT {ally}")
}

/// `SETSCRIPTTAGS <key=val\tkey=val...>`. Current-battle scoped, like
/// [`add_start_rect`].
pub fn set_script_tags(tags: &BTreeMap<String, String>) -> String {
    let body = tags
        .iter()
        .map(|(k, v)| format!("{k}={v}"))
        .collect::<Vec<_>>()
        .join("\t");
    format!("SETSCRIPTTAGS {body}")
}

/// `REMOVESCRIPTTAGS <space-sep tags>`. Current-battle scoped.
pub fn remove_script_tags(tags: &[&str]) -> String {
    format!("REMOVESCRIPTTAGS {}", tags.join(" "))
}

/// `HOSTPORT <port>`, the UDP port the host's engine will bind, which the host's
/// own start script reads.
pub fn host_port(port: u16) -> String {
    format!("HOSTPORT {port}")
}

/// `SAIDBATTLE <username> <msg>`.
pub fn said_battle(username: &str, message: &str) -> String {
    format!("SAIDBATTLE {username} {message}")
}

/// `SAIDBATTLEEX <username> <msg>`, a battle-chat action.
pub fn said_battle_ex(username: &str, message: &str) -> String {
    format!("SAIDBATTLEEX {username} {message}")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::command::is_wire_safe;
    use crate::status::default_battle_status;

    #[test]
    fn greeting_has_exactly_four_fields() {
        let line = tas_server("0.38", "*", 8452, 0);
        assert_eq!(line, "TASSERVER 0.38 * 8452 0");
        assert_eq!(line.split(' ').count(), 5);
    }

    #[test]
    fn battle_opened_appends_the_channel_to_the_tab_block() {
        let b = BattleOpened {
            id: 1,
            battle_type: 0,
            nat_type: 0,
            host: "alice".into(),
            ip: "192.168.0.5".into(),
            port: 8452,
            max_players: 16,
            passworded: false,
            rank: 0,
            maphash: -1,
            engine: "spring".into(),
            version: "105".into(),
            map: "Red Comet".into(),
            title: "LAN game".into(),
            modname: "BAR".into(),
            channel: Some("__battle__1".into()),
        };
        assert_eq!(
            battle_opened(&b),
            "BATTLEOPENED 1 0 0 alice 192.168.0.5 8452 16 0 0 -1 spring\t105\tRed Comet\tLAN game\tBAR\t__battle__1"
        );
        let no_channel = BattleOpened { channel: None, ..b };
        assert!(battle_opened(&no_channel).ends_with("\tBAR"));
    }

    #[test]
    fn optional_fields_are_omitted_not_blanked() {
        assert_eq!(pong(None), "PONG");
        assert_eq!(pong(Some("42")), "PONG 42");
        assert_eq!(joined_battle(1, "bob", None), "JOINEDBATTLE 1 bob");
        assert_eq!(joined_battle(1, "bob", Some("sp")), "JOINEDBATTLE 1 bob sp");
        assert_eq!(join_battle(1, -1, None), "JOINBATTLE 1 -1");
        assert_eq!(
            join_battle(1, -1, Some("__battle__1")),
            "JOINBATTLE 1 -1 __battle__1"
        );
    }

    #[test]
    fn status_lines_carry_the_packed_int() {
        let bs = default_battle_status();
        assert_eq!(
            client_battle_status("bob", bs, 255),
            format!("CLIENTBATTLESTATUS bob {} 255", bs.to_int())
        );
        let ingame = ClientStatus {
            ingame: true,
            ..Default::default()
        };
        assert_eq!(client_status("alice", ingame), "CLIENTSTATUS alice 1");
    }

    /// Every argument that a player types reaches these builders unescaped, so the
    /// caller has to check before writing. Chat is the obvious one, a room title is
    /// the one that gets forgotten.
    #[test]
    fn caller_supplied_text_can_still_break_the_wire() {
        assert!(is_wire_safe(&said_battle("bob", "hello there")));
        assert!(!is_wire_safe(&said_battle(
            "bob",
            "hi\nSAIDBATTLE host pwned"
        )));
        assert!(!is_wire_safe(&join_battle_failed("no\rway")));
    }
}
