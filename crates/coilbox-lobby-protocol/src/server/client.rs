//! Parsing of inbound client lines into typed [`ClientCommand`] values.
//!
//! The mirror of [`crate::message`]: same framing, same greedy last-field split,
//! same tolerance for a malformed line (it becomes [`ClientCommand::Unknown`]
//! rather than an error). The arities are taken from [`crate::command`], which is
//! what our own client puts on the wire.
//!
//! Numbers stay in their wire form (`i32` status ints, not decoded bitfields) so
//! this module makes no decisions the room has not asked for, exactly as
//! `ServerMessage` leaves `CLIENTSTATUS` as an int for `reduce` to decode.

use crate::message::{fields, parse_bool01, split_command, strip_framing, tag};

/// A typed inbound client command.
///
/// Every command our own client can send has a variant, including the ones a
/// room has no answer for (`FRIENDLIST`, `IGNORELIST`, the channel directory).
/// The client fires those unprompted on login, so a room that cannot name them
/// cannot tell "ignore this" apart from "I did not understand you".
// `OpenBattle` carries 13 fields, so it dwarfs the other variants. These are
// short-lived values passed by move into the room, so boxing it would only add
// indirection for no real benefit.
#[allow(clippy::large_enum_variant)]
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ClientCommand {
    /// `LOGIN <user> <pass> <cpu> <local_ip> <agent>\t<client_id>\t<flags>`.
    ///
    /// `cpu` is parsed and dropped: it is fixed at `0` and no server has read it
    /// for a decade.
    Login {
        username: String,
        password_hash: String,
        local_ip: String,
        agent: String,
        client_id: String,
        flags: Vec<String>,
    },
    /// `REGISTER <user> <pass> [email]`
    Register {
        username: String,
        password_hash: String,
        email: Option<String>,
    },
    /// `LISTCOMPFLAGS`
    ListCompFlags,
    /// `CONFIRMAGREEMENT [code]`
    ConfirmAgreement { code: Option<String> },
    /// `STLS`
    Stls,
    /// `PING [token]`
    Ping { token: Option<String> },
    /// `PONG [token]`
    Pong { token: Option<String> },
    /// `EXIT [reason]`
    Exit { reason: Option<String> },
    /// `CHANNELS`
    ListChannels,
    /// `JOIN <channel> [key]`
    JoinChannel {
        channel: String,
        key: Option<String>,
    },
    /// `LEAVE <channel>`
    LeaveChannel { channel: String },
    /// `GETCHANNELMESSAGES <channel> <last_msg_id>`
    GetChannelMessages { channel: String, last_msg_id: u64 },
    /// `SAY <channel> <msg>`
    Say { channel: String, message: String },
    /// `SAYEX <channel> <msg>`
    SayEx { channel: String, message: String },
    /// `SAYPRIVATE <user> <msg>`
    SayPrivate { username: String, message: String },
    /// `SAYPRIVATEEX <user> <msg>`
    SayPrivateEx { username: String, message: String },
    /// `SAYBATTLE <msg>`
    SayBattle { message: String },
    /// `SAYBATTLEEX <msg>`
    SayBattleEx { message: String },
    /// `OPENBATTLE <type> <natType> <key> <port> <maxplayers> <modhash> <rank> <maphash> <engine\tversion\tmap\ttitle\tmodname>`
    OpenBattle {
        battle_type: u8,
        nat_type: u8,
        key: Option<String>,
        port: u16,
        max_players: u32,
        modhash: i64,
        rank: u8,
        maphash: i64,
        engine: String,
        version: String,
        map: String,
        title: String,
        modname: String,
    },
    /// `JOINBATTLE <id> [key] [scriptPassword]`. A `*` in the key slot is the
    /// placeholder for "no key", so it arrives as `None`.
    JoinBattle {
        id: u32,
        key: Option<String>,
        script_password: Option<String>,
    },
    /// `LEAVEBATTLE`
    LeaveBattle,
    /// `JOINBATTLEACCEPT <username>`
    JoinBattleAccept { username: String },
    /// `JOINBATTLEDENY <username> [reason]`
    JoinBattleDeny {
        username: String,
        reason: Option<String>,
    },
    /// `MYSTATUS <status_int>`
    MyStatus { status: i32 },
    /// `MYBATTLESTATUS <battlestatus_int> <teamcolor_int>`
    MyBattleStatus {
        battle_status: i32,
        team_color: i64,
    },
    /// `UPDATEBATTLEINFO <spectatorCount> <locked> <maphash> <map>`
    UpdateBattleInfo {
        spectator_count: u32,
        locked: bool,
        maphash: i64,
        map: String,
    },
    /// `ADDBOT <name> <battlestatus_int> <teamcolor_int> <aidll>`
    AddBot {
        name: String,
        battle_status: i32,
        team_color: i64,
        ai_dll: String,
    },
    /// `UPDATEBOT <name> <battlestatus_int> <teamcolor_int>`
    UpdateBot {
        name: String,
        battle_status: i32,
        team_color: i64,
    },
    /// `REMOVEBOT <name>`
    RemoveBot { name: String },
    /// `FORCETEAMNO <user> <team>`
    ForceTeamNo { username: String, team: u8 },
    /// `FORCEALLYNO <user> <ally>`
    ForceAllyNo { username: String, ally: u8 },
    /// `FORCETEAMCOLOR <user> <color_int>`
    ForceTeamColor { username: String, team_color: i64 },
    /// `FORCESPECTATORMODE <user>`
    ForceSpectatorMode { username: String },
    /// `KICKFROMBATTLE <user>`
    KickFromBattle { username: String },
    /// `ADDSTARTRECT <ally> <left> <top> <right> <bottom>`
    AddStartRect {
        ally: u8,
        left: i32,
        top: i32,
        right: i32,
        bottom: i32,
    },
    /// `REMOVESTARTRECT <ally>`
    RemoveStartRect { ally: u8 },
    /// `SETSCRIPTTAGS <key=val\tkey=val...>`
    SetScriptTags { tags: Vec<(String, String)> },
    /// `REMOVESCRIPTTAGS <space-sep tags>`
    RemoveScriptTags { tags: Vec<String> },
    /// `IGNORE userName=<name>[\treason=<reason>]`
    Ignore {
        username: String,
        reason: Option<String>,
    },
    /// `UNIGNORE userName=<name>`
    Unignore { username: String },
    /// `IGNORELIST`
    IgnoreList,
    /// `FRIENDREQUEST userName=<name>[\tmsg=<msg>]`
    FriendRequest {
        username: String,
        msg: Option<String>,
    },
    /// `ACCEPTFRIENDREQUEST userName=<name>`
    AcceptFriendRequest { username: String },
    /// `DECLINEFRIENDREQUEST userName=<name>`
    DeclineFriendRequest { username: String },
    /// `UNFRIEND userName=<name>`
    Unfriend { username: String },
    /// `FRIENDLIST`
    FriendList,
    /// `FRIENDREQUESTLIST`
    FriendRequestList,
    /// Any command not recognized above, or one whose arity is wrong.
    Unknown { raw: String },
}

/// Read an optional trailing argument: `None` when the client sent nothing.
fn opt(rest: &str) -> Option<String> {
    (!rest.is_empty()).then(|| rest.to_string())
}

/// Read an optional key slot, where `*` is the protocol's "no key" placeholder.
fn opt_key(s: &str) -> Option<String> {
    (!s.is_empty() && s != "*").then(|| s.to_string())
}

/// Parse a single client line into a [`ClientCommand`].
pub fn parse_client_line(line: &str) -> ClientCommand {
    let line = strip_framing(line);
    let (cmd, rest) = split_command(line);
    let raw = || ClientCommand::Unknown {
        raw: line.to_string(),
    };

    match cmd.as_str() {
        "LOGIN" => parse_login(rest, raw),
        "REGISTER" => match fields::<3>(rest) {
            Some([username, password_hash, email]) => ClientCommand::Register {
                username: username.to_string(),
                password_hash: password_hash.to_string(),
                email: opt(email),
            },
            None => match fields::<2>(rest) {
                Some([username, password_hash]) => ClientCommand::Register {
                    username: username.to_string(),
                    password_hash: password_hash.to_string(),
                    email: None,
                },
                None => raw(),
            },
        },
        "LISTCOMPFLAGS" => ClientCommand::ListCompFlags,
        "CONFIRMAGREEMENT" => ClientCommand::ConfirmAgreement { code: opt(rest) },
        "STLS" => ClientCommand::Stls,
        "PING" => ClientCommand::Ping { token: opt(rest) },
        "PONG" => ClientCommand::Pong { token: opt(rest) },
        "EXIT" => ClientCommand::Exit { reason: opt(rest) },
        "CHANNELS" => ClientCommand::ListChannels,
        "JOIN" => match fields::<2>(rest) {
            Some([channel, key]) => ClientCommand::JoinChannel {
                channel: channel.to_string(),
                key: opt(key),
            },
            None if !rest.is_empty() => ClientCommand::JoinChannel {
                channel: rest.to_string(),
                key: None,
            },
            None => raw(),
        },
        "LEAVE" if !rest.is_empty() => ClientCommand::LeaveChannel {
            channel: rest.to_string(),
        },
        "GETCHANNELMESSAGES" => match fields::<2>(rest) {
            Some([channel, last]) => ClientCommand::GetChannelMessages {
                channel: channel.to_string(),
                last_msg_id: last.trim().parse().unwrap_or(0),
            },
            None => raw(),
        },
        "SAY" => match fields::<2>(rest) {
            Some([channel, message]) => ClientCommand::Say {
                channel: channel.to_string(),
                message: message.to_string(),
            },
            None => raw(),
        },
        "SAYEX" => match fields::<2>(rest) {
            Some([channel, message]) => ClientCommand::SayEx {
                channel: channel.to_string(),
                message: message.to_string(),
            },
            None => raw(),
        },
        "SAYPRIVATE" => match fields::<2>(rest) {
            Some([username, message]) => ClientCommand::SayPrivate {
                username: username.to_string(),
                message: message.to_string(),
            },
            None => raw(),
        },
        "SAYPRIVATEEX" => match fields::<2>(rest) {
            Some([username, message]) => ClientCommand::SayPrivateEx {
                username: username.to_string(),
                message: message.to_string(),
            },
            None => raw(),
        },
        "SAYBATTLE" => ClientCommand::SayBattle {
            message: rest.to_string(),
        },
        "SAYBATTLEEX" => ClientCommand::SayBattleEx {
            message: rest.to_string(),
        },
        "OPENBATTLE" => parse_open_battle(rest, raw),
        "JOINBATTLE" => parse_join_battle(rest, raw),
        "LEAVEBATTLE" => ClientCommand::LeaveBattle,
        "JOINBATTLEACCEPT" if !rest.is_empty() => ClientCommand::JoinBattleAccept {
            username: rest.to_string(),
        },
        "JOINBATTLEDENY" if !rest.is_empty() => {
            let (username, reason) = rest.split_once(' ').unwrap_or((rest, ""));
            ClientCommand::JoinBattleDeny {
                username: username.to_string(),
                reason: opt(reason),
            }
        }
        "MYSTATUS" => match rest.trim().parse() {
            Ok(status) => ClientCommand::MyStatus { status },
            Err(_) => raw(),
        },
        "MYBATTLESTATUS" => match fields::<2>(rest) {
            Some([bs, color]) => ClientCommand::MyBattleStatus {
                battle_status: bs.trim().parse().unwrap_or(0),
                team_color: color.trim().parse().unwrap_or(0),
            },
            None => raw(),
        },
        "UPDATEBATTLEINFO" => match fields::<4>(rest) {
            Some([spectators, locked, maphash, map]) => ClientCommand::UpdateBattleInfo {
                spectator_count: spectators.trim().parse().unwrap_or(0),
                locked: parse_bool01(locked),
                maphash: maphash.trim().parse().unwrap_or(0),
                map: map.to_string(),
            },
            None => raw(),
        },
        "ADDBOT" => match fields::<4>(rest) {
            Some([name, bs, color, ai_dll]) => ClientCommand::AddBot {
                name: name.to_string(),
                battle_status: bs.trim().parse().unwrap_or(0),
                team_color: color.trim().parse().unwrap_or(0),
                ai_dll: ai_dll.to_string(),
            },
            None => raw(),
        },
        "UPDATEBOT" => match fields::<3>(rest) {
            Some([name, bs, color]) => ClientCommand::UpdateBot {
                name: name.to_string(),
                battle_status: bs.trim().parse().unwrap_or(0),
                team_color: color.trim().parse().unwrap_or(0),
            },
            None => raw(),
        },
        "REMOVEBOT" if !rest.is_empty() => ClientCommand::RemoveBot {
            name: rest.to_string(),
        },
        "FORCETEAMNO" => match fields::<2>(rest) {
            Some([username, team]) => ClientCommand::ForceTeamNo {
                username: username.to_string(),
                team: team.trim().parse().unwrap_or(0),
            },
            None => raw(),
        },
        "FORCEALLYNO" => match fields::<2>(rest) {
            Some([username, ally]) => ClientCommand::ForceAllyNo {
                username: username.to_string(),
                ally: ally.trim().parse().unwrap_or(0),
            },
            None => raw(),
        },
        "FORCETEAMCOLOR" => match fields::<2>(rest) {
            Some([username, color]) => ClientCommand::ForceTeamColor {
                username: username.to_string(),
                team_color: color.trim().parse().unwrap_or(0),
            },
            None => raw(),
        },
        "FORCESPECTATORMODE" if !rest.is_empty() => ClientCommand::ForceSpectatorMode {
            username: rest.to_string(),
        },
        "KICKFROMBATTLE" if !rest.is_empty() => ClientCommand::KickFromBattle {
            username: rest.to_string(),
        },
        "ADDSTARTRECT" => match fields::<5>(rest) {
            Some([ally, left, top, right, bottom]) => ClientCommand::AddStartRect {
                ally: ally.trim().parse().unwrap_or(0),
                left: left.trim().parse().unwrap_or(0),
                top: top.trim().parse().unwrap_or(0),
                right: right.trim().parse().unwrap_or(0),
                bottom: bottom.trim().parse().unwrap_or(0),
            },
            None => raw(),
        },
        "REMOVESTARTRECT" => match rest.trim().parse() {
            Ok(ally) => ClientCommand::RemoveStartRect { ally },
            Err(_) => raw(),
        },
        "SETSCRIPTTAGS" => ClientCommand::SetScriptTags {
            tags: rest
                .split('\t')
                .filter(|s| !s.is_empty())
                .filter_map(|kv| {
                    kv.split_once('=')
                        .map(|(k, v)| (k.to_string(), v.to_string()))
                })
                .collect(),
        },
        "REMOVESCRIPTTAGS" => ClientCommand::RemoveScriptTags {
            tags: rest.split_whitespace().map(str::to_string).collect(),
        },
        "IGNORE" => match tag(rest, "userName") {
            Some(u) => ClientCommand::Ignore {
                username: u.to_string(),
                reason: tag(rest, "reason").map(str::to_string),
            },
            None => raw(),
        },
        "UNIGNORE" => match tag(rest, "userName") {
            Some(u) => ClientCommand::Unignore {
                username: u.to_string(),
            },
            None => raw(),
        },
        "IGNORELIST" => ClientCommand::IgnoreList,
        "FRIENDREQUEST" => match tag(rest, "userName") {
            Some(u) => ClientCommand::FriendRequest {
                username: u.to_string(),
                msg: tag(rest, "msg").map(str::to_string),
            },
            None => raw(),
        },
        "ACCEPTFRIENDREQUEST" => match tag(rest, "userName") {
            Some(u) => ClientCommand::AcceptFriendRequest {
                username: u.to_string(),
            },
            None => raw(),
        },
        "DECLINEFRIENDREQUEST" => match tag(rest, "userName") {
            Some(u) => ClientCommand::DeclineFriendRequest {
                username: u.to_string(),
            },
            None => raw(),
        },
        "UNFRIEND" => match tag(rest, "userName") {
            Some(u) => ClientCommand::Unfriend {
                username: u.to_string(),
            },
            None => raw(),
        },
        "FRIENDLIST" => ClientCommand::FriendList,
        "FRIENDREQUESTLIST" => ClientCommand::FriendRequestList,
        _ => raw(),
    }
}

/// `LOGIN <user> <pass> <cpu> <local_ip> <agent>\t<client_id>\t<flags>`.
///
/// The agent is the last space-separated field and carries its own spaces, so the
/// tab block has to be split out of it afterwards. A client that sends no tab
/// block at all (a pre-2010 lobby) still logs in, with no id and no flags.
fn parse_login(rest: &str, raw: impl Fn() -> ClientCommand) -> ClientCommand {
    let Some([username, password_hash, _cpu, local_ip, tail]) = fields::<5>(rest) else {
        return raw();
    };
    let mut parts = tail.split('\t');
    let agent = parts.next().unwrap_or_default();
    let client_id = parts.next().unwrap_or_default();
    let flags = parts.next().unwrap_or_default();
    ClientCommand::Login {
        username: username.to_string(),
        password_hash: password_hash.to_string(),
        local_ip: local_ip.to_string(),
        agent: agent.to_string(),
        client_id: client_id.to_string(),
        flags: flags.split_whitespace().map(str::to_string).collect(),
    }
}

/// `JOINBATTLE <id> [key] [scriptPassword]`, where a key of `*` means none.
fn parse_join_battle(rest: &str, raw: impl Fn() -> ClientCommand) -> ClientCommand {
    let mut parts = rest.split_whitespace();
    let Some(Ok(id)) = parts.next().map(str::parse) else {
        return raw();
    };
    ClientCommand::JoinBattle {
        id,
        key: parts.next().and_then(opt_key),
        script_password: parts.next().map(str::to_string),
    }
}

/// `OPENBATTLE <type> <natType> <key> <port> <maxplayers> <modhash> <rank> <maphash> <engine\tversion\tmap\ttitle\tmodname>`.
fn parse_open_battle(rest: &str, raw: impl Fn() -> ClientCommand) -> ClientCommand {
    let Some([battle_type, nat_type, key, port, max_players, modhash, rank, tail]) =
        fields::<8>(rest)
    else {
        return raw();
    };
    // tail = "<maphash> <engine\tversion\tmap\ttitle\tmodname>"
    let Some((maphash, sentence)) = tail.split_once(' ') else {
        return raw();
    };
    let parts: Vec<&str> = sentence.split('\t').collect();
    if parts.len() < 5 {
        return raw();
    }
    ClientCommand::OpenBattle {
        battle_type: battle_type.trim().parse().unwrap_or(0),
        nat_type: nat_type.trim().parse().unwrap_or(0),
        key: opt_key(key),
        port: port.trim().parse().unwrap_or(0),
        max_players: max_players.trim().parse().unwrap_or(0),
        modhash: modhash.trim().parse().unwrap_or(0),
        rank: rank.trim().parse().unwrap_or(0),
        maphash: maphash.trim().parse().unwrap_or(0),
        engine: parts[0].to_string(),
        version: parts[1].to_string(),
        map: parts[2].to_string(),
        title: parts[3].to_string(),
        modname: parts[4].to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::command;
    use crate::status::default_battle_status;

    #[test]
    fn login_splits_the_tab_block_off_the_agent() {
        let line = command::login(
            "alice",
            "aGFzaA==",
            "192.168.0.5",
            "Coilbox 0.1 dev",
            "7654321",
            &["u", "sp"],
        );
        assert_eq!(
            parse_client_line(&line),
            ClientCommand::Login {
                username: "alice".into(),
                password_hash: "aGFzaA==".into(),
                local_ip: "192.168.0.5".into(),
                agent: "Coilbox 0.1 dev".into(),
                client_id: "7654321".into(),
                flags: vec!["u".into(), "sp".into()],
            }
        );
    }

    /// An old client sends no `\t` block at all. It still logs in, because the
    /// room only needs the name.
    #[test]
    fn login_without_a_tab_block() {
        assert_eq!(
            parse_client_line("LOGIN alice hash 0 127.0.0.1 SpringLobby 0.2"),
            ClientCommand::Login {
                username: "alice".into(),
                password_hash: "hash".into(),
                local_ip: "127.0.0.1".into(),
                agent: "SpringLobby 0.2".into(),
                client_id: String::new(),
                flags: vec![],
            }
        );
    }

    #[test]
    fn join_battle_variants_round_trip_through_the_client_builder() {
        assert_eq!(
            parse_client_line(&command::join_battle(3, None, None)),
            ClientCommand::JoinBattle {
                id: 3,
                key: None,
                script_password: None,
            }
        );
        assert_eq!(
            parse_client_line(&command::join_battle(3, None, Some("sp"))),
            ClientCommand::JoinBattle {
                id: 3,
                key: None,
                script_password: Some("sp".into()),
            }
        );
        assert_eq!(
            parse_client_line(&command::join_battle(3, Some("pw"), Some("sp"))),
            ClientCommand::JoinBattle {
                id: 3,
                key: Some("pw".into()),
                script_password: Some("sp".into()),
            }
        );
    }

    #[test]
    fn open_battle_reads_the_tab_sentence() {
        let line = command::open_battle(
            0,
            0,
            "*",
            8452,
            16,
            -1,
            0,
            -1,
            "spring",
            "105",
            "Map",
            "Title Here",
            "BAR",
        );
        assert_eq!(
            parse_client_line(&line),
            ClientCommand::OpenBattle {
                battle_type: 0,
                nat_type: 0,
                key: None,
                port: 8452,
                max_players: 16,
                modhash: -1,
                rank: 0,
                maphash: -1,
                engine: "spring".into(),
                version: "105".into(),
                map: "Map".into(),
                title: "Title Here".into(),
                modname: "BAR".into(),
            }
        );
    }

    #[test]
    fn status_lines_keep_their_wire_ints() {
        let bs = default_battle_status();
        assert_eq!(
            parse_client_line(&command::my_battle_status(bs, 255)),
            ClientCommand::MyBattleStatus {
                battle_status: bs.to_int(),
                team_color: 255,
            }
        );
        assert_eq!(
            parse_client_line("MYSTATUS 1"),
            ClientCommand::MyStatus { status: 1 }
        );
    }

    #[test]
    fn chat_keeps_embedded_spaces() {
        assert_eq!(
            parse_client_line("SAYBATTLE hello   world"),
            ClientCommand::SayBattle {
                message: "hello   world".into()
            }
        );
        assert_eq!(
            parse_client_line("SAY main hello   world"),
            ClientCommand::Say {
                channel: "main".into(),
                message: "hello   world".into(),
            }
        );
    }

    #[test]
    fn tagged_commands_read_their_key_values() {
        assert_eq!(
            parse_client_line(&command::ignore("bob", Some("spammer"))),
            ClientCommand::Ignore {
                username: "bob".into(),
                reason: Some("spammer".into()),
            }
        );
        assert_eq!(
            parse_client_line(&command::friend_request("bob", Some("hi there"))),
            ClientCommand::FriendRequest {
                username: "bob".into(),
                msg: Some("hi there".into()),
            }
        );
    }

    #[test]
    fn script_tags_and_start_rects() {
        let mut tags = std::collections::BTreeMap::new();
        tags.insert("game/startpostype".to_string(), "2".to_string());
        tags.insert("game/hosttype".to_string(), "coilbox".to_string());
        assert_eq!(
            parse_client_line(&command::set_script_tags(&tags)),
            ClientCommand::SetScriptTags {
                tags: vec![
                    ("game/hosttype".into(), "coilbox".into()),
                    ("game/startpostype".into(), "2".into()),
                ],
            }
        );
        assert_eq!(
            parse_client_line(&command::add_start_rect(1, 0, 0, 50, 200)),
            ClientCommand::AddStartRect {
                ally: 1,
                left: 0,
                top: 0,
                right: 50,
                bottom: 200,
            }
        );
    }

    /// A line we don't know, and a line we do know with the wrong arity, both have
    /// to survive as `Unknown`: the room ignores them, and neither may take the
    /// connection down.
    #[test]
    fn unknown_and_malformed_lines_degrade() {
        for line in [
            "FROBNICATE whatever",
            "MYSTATUS",
            "MYBATTLESTATUS 4",
            "ADDBOT justaname",
            "OPENBATTLE 0 0 * 8452",
            "JOINBATTLE notanumber",
            "IGNORE nothing=useful",
        ] {
            assert_eq!(
                parse_client_line(line),
                ClientCommand::Unknown { raw: line.into() },
                "should have degraded: {line}"
            );
        }
    }

    #[test]
    fn framing_is_stripped_like_the_server_direction() {
        assert_eq!(
            parse_client_line("#42 LEAVEBATTLE\r"),
            ClientCommand::LeaveBattle
        );
    }
}
