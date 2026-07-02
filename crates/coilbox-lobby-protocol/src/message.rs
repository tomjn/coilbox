//! Parsing of inbound server lines into typed [`ServerMessage`] values.
//!
//! Framing is newline-delimited UTF-8, one command per line, `COMMAND arg1
//! arg2 ...` with the command upper-cased. The server splits arguments greedily
//! keeping the LAST field's embedded spaces (no brace/bang escaping), so a
//! correct client parser must know each message's arity and use `splitn(N, ' ')`
//! to keep trailing text (chat, titles) intact.
//!
//! Some payloads carry tab-separated sub-fields: the trailing block of
//! `BATTLEOPENED` and the `key=value\t...` list of `SETSCRIPTTAGS`.
//!
//! Lines may carry an optional `#<digits> ` message-id prefix, which is stripped
//! here (the id itself is the plugin's concern, not the state's).

use serde::Serialize;

/// A typed inbound server message.
///
/// Every string field is owned so a `ServerMessage` is `'static` and can be
/// handed straight to the reducer and serialized to the frontend.
// `BattleOpened` legitimately carries ~16 fields, so it dwarfs the other
// variants. These messages are short-lived values passed by move into the
// reducer, not stored in bulk, so boxing the variant would only add indirection
// and churn the match sites and serde shape for no real benefit.
#[allow(clippy::large_enum_variant)]
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ServerMessage {
    /// `TASSERVER <ver> <minspring> <natport> <mode>`
    TasServer {
        version: String,
        min_spring: String,
        nat_port: String,
        mode: String,
    },
    /// `ACCEPTED <user>`
    Accepted { username: String },
    /// `DENIED <reason>`
    Denied { reason: String },
    /// `MOTD <line>`
    Motd { line: String },
    /// `LOGININFOEND`
    LoginInfoEnd,
    /// `ADDUSER <username> <country> <user_id> <agent>`
    AddUser {
        username: String,
        country: String,
        user_id: String,
        agent: String,
    },
    /// `REMOVEUSER <username>`
    RemoveUser { username: String },
    /// `CLIENTSTATUS <username> <status_int>`
    ClientStatus { username: String, status: i32 },
    /// `JOIN <channel>`
    Join { channel: String },
    /// `JOINED <channel> <username>`
    Joined { channel: String, username: String },
    /// `LEFT <channel> <username> [reason]`
    Left {
        channel: String,
        username: String,
        reason: Option<String>,
    },
    /// `CLIENTS <channel> <space-sep usernames>`
    Clients {
        channel: String,
        usernames: Vec<String>,
    },
    /// `CHANNELTOPIC <channel> <author> <topic>`
    ChannelTopic {
        channel: String,
        author: String,
        topic: String,
    },
    /// `CHANNELMESSAGE <channel> <text>`
    ChannelMessage { channel: String, text: String },
    /// `JOINFAILED <reason>`
    JoinFailed { reason: String },
    /// `SAID <channel> <username> <msg>`
    Said {
        channel: String,
        username: String,
        message: String,
    },
    /// `SAIDEX <channel> <username> <msg>`
    SaidEx {
        channel: String,
        username: String,
        message: String,
    },
    /// `SAIDPRIVATE <fromuser> <msg>`
    SaidPrivate { username: String, message: String },
    /// `SAIDBATTLE <username> <msg>`
    SaidBattle { username: String, message: String },
    /// `SAIDBATTLEEX <username> <msg>`
    SaidBattleEx { username: String, message: String },
    /// `BATTLEOPENED <id> <type> <natType> <host> <ip> <port> <maxplayers> <passworded> <rank> <maphash> <engine\tversion\tmap\ttitle\tmodname[\tchannel]>`
    BattleOpened {
        id: u32,
        battle_type: String,
        nat_type: String,
        host: String,
        ip: String,
        port: String,
        max_players: u32,
        passworded: bool,
        rank: String,
        maphash: String,
        engine: String,
        version: String,
        map: String,
        title: String,
        modname: String,
        channel: Option<String>,
    },
    /// `UPDATEBATTLEINFO <id> <spectatorCount> <locked> <maphash> <map>`
    UpdateBattleInfo {
        id: u32,
        spectator_count: u32,
        locked: bool,
        maphash: String,
        map: String,
    },
    /// `BATTLECLOSED <id>`
    BattleClosed { id: u32 },
    /// `JOINEDBATTLE <id> <username> [scriptPassword]`
    JoinedBattle {
        id: u32,
        username: String,
        script_password: Option<String>,
    },
    /// `LEFTBATTLE <id> <username>`
    LeftBattle { id: u32, username: String },
    /// `JOINBATTLE <id> <hashcode> [channel]` (own-join ack)
    JoinBattle {
        id: u32,
        hashcode: String,
        channel: Option<String>,
    },
    /// `JOINBATTLEFAILED <reason>`
    JoinBattleFailed { reason: String },
    /// `JOINBATTLEREQUEST <username> <ip>`
    JoinBattleRequest { username: String, ip: String },
    /// `CLIENTBATTLESTATUS <username> <battlestatus_int> <teamcolor_int>`
    ClientBattleStatus {
        username: String,
        battle_status: i32,
        team_color: i64,
    },
    /// `ADDBOT <battle_id> <name> <owner> <battlestatus_int> <teamcolor_int> <aidll>`
    AddBot {
        battle_id: u32,
        name: String,
        owner: String,
        battle_status: i32,
        team_color: i64,
        ai_dll: String,
    },
    /// `REMOVEBOT <battle_id> <name>`
    RemoveBot { battle_id: u32, name: String },
    /// `UPDATEBOT <battle_id> <name> <battlestatus_int> <teamcolor_int>`
    UpdateBot {
        battle_id: u32,
        name: String,
        battle_status: i32,
        team_color: i64,
    },
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
    /// `REQUESTBATTLESTATUS`
    RequestBattleStatus,
    /// `OPENBATTLE <battle_id>` (own host ack)
    OpenBattle { id: u32 },
    /// `OPENBATTLEFAILED <reason>`
    OpenBattleFailed { reason: String },
    /// `HOSTPORT <port>`
    HostPort { port: u16 },
    /// `PING [token]`
    Ping { token: Option<String> },
    /// `PONG [token]`
    Pong { token: Option<String> },
    /// `RING <username>`
    Ring { username: String },
    /// `SERVERMSG <text>`
    ServerMsg { text: String },
    /// `SERVERMSGBOX <text>`
    ServerMsgBox { text: String },
    /// `FAILED cmd=..\tmsg=..`
    Failed { text: String },
    /// `OK cmd=..`
    Ok { text: String },
    /// `COMPFLAGS <flags>`
    CompFlags { flags: Vec<String> },
    /// `AGREEMENT <line>`
    Agreement { line: String },
    /// `AGREEMENTEND`
    AgreementEnd,
    /// `JSON <payload>`
    Json { payload: String },
    /// `REGISTRATIONACCEPTED`
    RegistrationAccepted,
    /// `REGISTRATIONDENIED <reason>`
    RegistrationDenied { reason: String },
    /// Any command not recognized above.
    Unknown { raw: String },
}

/// Strip a `\r`, then an optional leading `#<digits> ` message-id prefix.
fn strip_framing(line: &str) -> &str {
    let line = line.strip_suffix('\r').unwrap_or(line);
    if let Some(rest) = line.strip_prefix('#') {
        // `#<digits> <command...>`
        if let Some(sp) = rest.find(' ') {
            let (digits, tail) = rest.split_at(sp);
            if !digits.is_empty() && digits.bytes().all(|b| b.is_ascii_digit()) {
                return &tail[1..];
            }
        }
    }
    line
}

/// Split into `(COMMAND, rest)` with the command upper-cased.
fn split_command(line: &str) -> (String, &str) {
    match line.split_once(' ') {
        Some((cmd, rest)) => (cmd.to_ascii_uppercase(), rest),
        None => (line.to_ascii_uppercase(), ""),
    }
}

/// Parse `N` space-separated fields keeping the last field's embedded spaces.
/// Returns `None` if there are fewer than `n` fields.
fn fields<const N: usize>(rest: &str) -> Option<[&str; N]> {
    let mut out: [&str; N] = [""; N];
    let mut remaining = rest;
    for (i, slot) in out.iter_mut().enumerate() {
        if i + 1 == N {
            *slot = remaining;
        } else {
            let (head, tail) = remaining.split_once(' ')?;
            *slot = head;
            remaining = tail;
        }
    }
    Some(out)
}

fn parse_bool01(s: &str) -> bool {
    s.trim() != "0" && !s.trim().is_empty()
}

/// Parse a single server line into a [`ServerMessage`].
pub fn parse_line(line: &str) -> ServerMessage {
    let line = strip_framing(line);
    let (cmd, rest) = split_command(line);
    let raw = || line.to_string();

    match cmd.as_str() {
        "TASSERVER" => match fields::<4>(rest) {
            Some([version, min_spring, nat_port, mode]) => ServerMessage::TasServer {
                version: version.to_string(),
                min_spring: min_spring.to_string(),
                nat_port: nat_port.to_string(),
                mode: mode.to_string(),
            },
            None => ServerMessage::Unknown { raw: raw() },
        },
        "ACCEPTED" => ServerMessage::Accepted {
            username: rest.to_string(),
        },
        "DENIED" => ServerMessage::Denied {
            reason: rest.to_string(),
        },
        "MOTD" => ServerMessage::Motd {
            line: rest.to_string(),
        },
        "LOGININFOEND" => ServerMessage::LoginInfoEnd,
        "ADDUSER" => match fields::<4>(rest) {
            Some([username, country, user_id, agent]) => ServerMessage::AddUser {
                username: username.to_string(),
                country: country.to_string(),
                user_id: user_id.to_string(),
                agent: agent.to_string(),
            },
            None => ServerMessage::Unknown { raw: raw() },
        },
        "REMOVEUSER" => ServerMessage::RemoveUser {
            username: rest.to_string(),
        },
        "CLIENTSTATUS" => match fields::<2>(rest) {
            Some([username, status]) => ServerMessage::ClientStatus {
                username: username.to_string(),
                status: status.trim().parse().unwrap_or(0),
            },
            None => ServerMessage::Unknown { raw: raw() },
        },
        "JOIN" => ServerMessage::Join {
            channel: rest.to_string(),
        },
        "JOINED" => match fields::<2>(rest) {
            Some([channel, username]) => ServerMessage::Joined {
                channel: channel.to_string(),
                username: username.to_string(),
            },
            None => ServerMessage::Unknown { raw: raw() },
        },
        "LEFT" => match fields::<3>(rest) {
            Some([channel, username, reason]) => ServerMessage::Left {
                channel: channel.to_string(),
                username: username.to_string(),
                reason: (!reason.is_empty()).then(|| reason.to_string()),
            },
            None => match fields::<2>(rest) {
                Some([channel, username]) => ServerMessage::Left {
                    channel: channel.to_string(),
                    username: username.to_string(),
                    reason: None,
                },
                None => ServerMessage::Unknown { raw: raw() },
            },
        },
        "CLIENTS" => match fields::<2>(rest) {
            Some([channel, users]) => ServerMessage::Clients {
                channel: channel.to_string(),
                usernames: users.split_whitespace().map(str::to_string).collect(),
            },
            None => ServerMessage::Unknown { raw: raw() },
        },
        "CHANNELTOPIC" => match fields::<3>(rest) {
            Some([channel, author, topic]) => ServerMessage::ChannelTopic {
                channel: channel.to_string(),
                author: author.to_string(),
                topic: topic.to_string(),
            },
            None => ServerMessage::Unknown { raw: raw() },
        },
        "CHANNELMESSAGE" => match fields::<2>(rest) {
            Some([channel, text]) => ServerMessage::ChannelMessage {
                channel: channel.to_string(),
                text: text.to_string(),
            },
            None => ServerMessage::Unknown { raw: raw() },
        },
        "JOINFAILED" => ServerMessage::JoinFailed {
            reason: rest.to_string(),
        },
        "SAID" => said(rest, raw, |channel, username, message| {
            ServerMessage::Said {
                channel,
                username,
                message,
            }
        }),
        "SAIDEX" => said(rest, raw, |channel, username, message| {
            ServerMessage::SaidEx {
                channel,
                username,
                message,
            }
        }),
        "SAIDPRIVATE" => match fields::<2>(rest) {
            Some([username, message]) => ServerMessage::SaidPrivate {
                username: username.to_string(),
                message: message.to_string(),
            },
            None => ServerMessage::Unknown { raw: raw() },
        },
        "SAIDBATTLE" => match fields::<2>(rest) {
            Some([username, message]) => ServerMessage::SaidBattle {
                username: username.to_string(),
                message: message.to_string(),
            },
            None => ServerMessage::Unknown { raw: raw() },
        },
        "SAIDBATTLEEX" => match fields::<2>(rest) {
            Some([username, message]) => ServerMessage::SaidBattleEx {
                username: username.to_string(),
                message: message.to_string(),
            },
            None => ServerMessage::Unknown { raw: raw() },
        },
        "BATTLEOPENED" => parse_battle_opened(rest, raw),
        "UPDATEBATTLEINFO" => match fields::<5>(rest) {
            Some([id, spectators, locked, maphash, map]) => ServerMessage::UpdateBattleInfo {
                id: id.trim().parse().unwrap_or(0),
                spectator_count: spectators.trim().parse().unwrap_or(0),
                locked: parse_bool01(locked),
                maphash: maphash.to_string(),
                map: map.to_string(),
            },
            None => ServerMessage::Unknown { raw: raw() },
        },
        "BATTLECLOSED" => ServerMessage::BattleClosed {
            id: rest.trim().parse().unwrap_or(0),
        },
        "JOINEDBATTLE" => match fields::<3>(rest) {
            Some([id, username, script]) => ServerMessage::JoinedBattle {
                id: id.trim().parse().unwrap_or(0),
                username: username.to_string(),
                script_password: (!script.is_empty()).then(|| script.to_string()),
            },
            None => match fields::<2>(rest) {
                Some([id, username]) => ServerMessage::JoinedBattle {
                    id: id.trim().parse().unwrap_or(0),
                    username: username.to_string(),
                    script_password: None,
                },
                None => ServerMessage::Unknown { raw: raw() },
            },
        },
        "LEFTBATTLE" => match fields::<2>(rest) {
            Some([id, username]) => ServerMessage::LeftBattle {
                id: id.trim().parse().unwrap_or(0),
                username: username.to_string(),
            },
            None => ServerMessage::Unknown { raw: raw() },
        },
        "JOINBATTLE" => match fields::<3>(rest) {
            Some([id, hashcode, channel]) => ServerMessage::JoinBattle {
                id: id.trim().parse().unwrap_or(0),
                hashcode: hashcode.to_string(),
                channel: (!channel.is_empty()).then(|| channel.to_string()),
            },
            None => match fields::<2>(rest) {
                Some([id, hashcode]) => ServerMessage::JoinBattle {
                    id: id.trim().parse().unwrap_or(0),
                    hashcode: hashcode.to_string(),
                    channel: None,
                },
                None => ServerMessage::Unknown { raw: raw() },
            },
        },
        "JOINBATTLEFAILED" => ServerMessage::JoinBattleFailed {
            reason: rest.to_string(),
        },
        "JOINBATTLEREQUEST" => match fields::<2>(rest) {
            Some([username, ip]) => ServerMessage::JoinBattleRequest {
                username: username.to_string(),
                ip: ip.to_string(),
            },
            None => ServerMessage::Unknown { raw: raw() },
        },
        "CLIENTBATTLESTATUS" => match fields::<3>(rest) {
            Some([username, bs, color]) => ServerMessage::ClientBattleStatus {
                username: username.to_string(),
                battle_status: bs.trim().parse().unwrap_or(0),
                team_color: color.trim().parse().unwrap_or(0),
            },
            None => ServerMessage::Unknown { raw: raw() },
        },
        "ADDBOT" => match fields::<6>(rest) {
            Some([battle_id, name, owner, bs, color, ai_dll]) => ServerMessage::AddBot {
                battle_id: battle_id.trim().parse().unwrap_or(0),
                name: name.to_string(),
                owner: owner.to_string(),
                battle_status: bs.trim().parse().unwrap_or(0),
                team_color: color.trim().parse().unwrap_or(0),
                ai_dll: ai_dll.to_string(),
            },
            None => ServerMessage::Unknown { raw: raw() },
        },
        "REMOVEBOT" => match fields::<2>(rest) {
            Some([battle_id, name]) => ServerMessage::RemoveBot {
                battle_id: battle_id.trim().parse().unwrap_or(0),
                name: name.to_string(),
            },
            None => ServerMessage::Unknown { raw: raw() },
        },
        "UPDATEBOT" => match fields::<4>(rest) {
            Some([battle_id, name, bs, color]) => ServerMessage::UpdateBot {
                battle_id: battle_id.trim().parse().unwrap_or(0),
                name: name.to_string(),
                battle_status: bs.trim().parse().unwrap_or(0),
                team_color: color.trim().parse().unwrap_or(0),
            },
            None => ServerMessage::Unknown { raw: raw() },
        },
        "ADDSTARTRECT" => match fields::<5>(rest) {
            Some([ally, left, top, right, bottom]) => ServerMessage::AddStartRect {
                ally: ally.trim().parse().unwrap_or(0),
                left: left.trim().parse().unwrap_or(0),
                top: top.trim().parse().unwrap_or(0),
                right: right.trim().parse().unwrap_or(0),
                bottom: bottom.trim().parse().unwrap_or(0),
            },
            None => ServerMessage::Unknown { raw: raw() },
        },
        "REMOVESTARTRECT" => ServerMessage::RemoveStartRect {
            ally: rest.trim().parse().unwrap_or(0),
        },
        "SETSCRIPTTAGS" => ServerMessage::SetScriptTags {
            tags: rest
                .split('\t')
                .filter(|s| !s.is_empty())
                .filter_map(|kv| {
                    kv.split_once('=')
                        .map(|(k, v)| (k.to_string(), v.to_string()))
                })
                .collect(),
        },
        "REMOVESCRIPTTAGS" => ServerMessage::RemoveScriptTags {
            tags: rest.split_whitespace().map(str::to_string).collect(),
        },
        "REQUESTBATTLESTATUS" => ServerMessage::RequestBattleStatus,
        "OPENBATTLE" => ServerMessage::OpenBattle {
            id: rest.trim().parse().unwrap_or(0),
        },
        "OPENBATTLEFAILED" => ServerMessage::OpenBattleFailed {
            reason: rest.to_string(),
        },
        "HOSTPORT" => ServerMessage::HostPort {
            port: rest.trim().parse().unwrap_or(0),
        },
        "PING" => ServerMessage::Ping {
            token: (!rest.is_empty()).then(|| rest.to_string()),
        },
        "PONG" => ServerMessage::Pong {
            token: (!rest.is_empty()).then(|| rest.to_string()),
        },
        "RING" => ServerMessage::Ring {
            username: rest.to_string(),
        },
        "SERVERMSG" => ServerMessage::ServerMsg {
            text: rest.to_string(),
        },
        "SERVERMSGBOX" => ServerMessage::ServerMsgBox {
            text: rest.to_string(),
        },
        "FAILED" => ServerMessage::Failed {
            text: rest.to_string(),
        },
        "OK" => ServerMessage::Ok {
            text: rest.to_string(),
        },
        "COMPFLAGS" => ServerMessage::CompFlags {
            flags: rest.split_whitespace().map(str::to_string).collect(),
        },
        "AGREEMENT" => ServerMessage::Agreement {
            line: rest.to_string(),
        },
        "AGREEMENTEND" => ServerMessage::AgreementEnd,
        "JSON" => ServerMessage::Json {
            payload: rest.to_string(),
        },
        "REGISTRATIONACCEPTED" => ServerMessage::RegistrationAccepted,
        "REGISTRATIONDENIED" => ServerMessage::RegistrationDenied {
            reason: rest.to_string(),
        },
        _ => ServerMessage::Unknown { raw: raw() },
    }
}

fn said(
    rest: &str,
    raw: impl Fn() -> String,
    ctor: impl Fn(String, String, String) -> ServerMessage,
) -> ServerMessage {
    match fields::<3>(rest) {
        Some([channel, username, message]) => ctor(
            channel.to_string(),
            username.to_string(),
            message.to_string(),
        ),
        None => ServerMessage::Unknown { raw: raw() },
    }
}

fn parse_battle_opened(rest: &str, raw: impl Fn() -> String) -> ServerMessage {
    // 10 fixed fields then a tab-structured sentence.
    let Some([id, battle_type, nat_type, host, ip, port, max_players, passworded, rank, tail]) =
        fields::<10>(rest)
    else {
        return ServerMessage::Unknown { raw: raw() };
    };
    // tail = "<maphash> <engine\tversion\tmap\ttitle\tmodname[\tchannel]>"
    let Some((maphash, sentence)) = tail.split_once(' ') else {
        return ServerMessage::Unknown { raw: raw() };
    };
    let parts: Vec<&str> = sentence.split('\t').collect();
    if parts.len() < 5 {
        return ServerMessage::Unknown { raw: raw() };
    }
    ServerMessage::BattleOpened {
        id: id.trim().parse().unwrap_or(0),
        battle_type: battle_type.to_string(),
        nat_type: nat_type.to_string(),
        host: host.to_string(),
        ip: ip.to_string(),
        port: port.to_string(),
        max_players: max_players.trim().parse().unwrap_or(0),
        passworded: parse_bool01(passworded),
        rank: rank.to_string(),
        maphash: maphash.to_string(),
        engine: parts[0].to_string(),
        version: parts[1].to_string(),
        map: parts[2].to_string(),
        title: parts[3].to_string(),
        modname: parts[4].to_string(),
        channel: parts.get(5).map(|s| s.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_tasserver_greeting() {
        let m = parse_line("TASSERVER 0.38 * 8201 0");
        assert_eq!(
            m,
            ServerMessage::TasServer {
                version: "0.38".into(),
                min_spring: "*".into(),
                nat_port: "8201".into(),
                mode: "0".into(),
            }
        );
    }

    #[test]
    fn strips_cr_and_msgid_prefix() {
        let m = parse_line("#42 ACCEPTED alice\r");
        assert_eq!(
            m,
            ServerMessage::Accepted {
                username: "alice".into()
            }
        );
    }

    #[test]
    fn adduser_keeps_agent_with_spaces() {
        let m = parse_line("ADDUSER bob GB 1234 SpringLobby 0.1 test");
        assert_eq!(
            m,
            ServerMessage::AddUser {
                username: "bob".into(),
                country: "GB".into(),
                user_id: "1234".into(),
                agent: "SpringLobby 0.1 test".into(),
            }
        );
    }

    #[test]
    fn said_preserves_embedded_spaces() {
        let m = parse_line("SAID main alice hello   world  with spaces");
        assert_eq!(
            m,
            ServerMessage::Said {
                channel: "main".into(),
                username: "alice".into(),
                message: "hello   world  with spaces".into(),
            }
        );
    }

    #[test]
    fn battleopened_tab_block_five_parts() {
        let line = "BATTLEOPENED 7 0 0 alice 1.2.3.4 8452 16 0 0 -1 spring\t105\tDeltaSiegeDry\tMy Cool Battle\tBAR";
        let m = parse_line(line);
        assert_eq!(
            m,
            ServerMessage::BattleOpened {
                id: 7,
                battle_type: "0".into(),
                nat_type: "0".into(),
                host: "alice".into(),
                ip: "1.2.3.4".into(),
                port: "8452".into(),
                max_players: 16,
                passworded: false,
                rank: "0".into(),
                maphash: "-1".into(),
                engine: "spring".into(),
                version: "105".into(),
                map: "DeltaSiegeDry".into(),
                title: "My Cool Battle".into(),
                modname: "BAR".into(),
                channel: None,
            }
        );
    }

    #[test]
    fn battleopened_with_channel() {
        let line = "BATTLEOPENED 7 0 0 alice 1.2.3.4 8452 16 0 0 -1 spring\t105\tmap\ttitle\tmod\t__battle__7";
        let m = parse_line(line);
        match m {
            ServerMessage::BattleOpened { channel, .. } => {
                assert_eq!(channel.as_deref(), Some("__battle__7"))
            }
            other => panic!("expected BattleOpened, got {other:?}"),
        }
    }

    #[test]
    fn setscripttags_tab_split() {
        let m = parse_line("SETSCRIPTTAGS game/startpostype=2\tgame/hosttype=coilbox");
        assert_eq!(
            m,
            ServerMessage::SetScriptTags {
                tags: vec![
                    ("game/startpostype".into(), "2".into()),
                    ("game/hosttype".into(), "coilbox".into()),
                ]
            }
        );
    }

    #[test]
    fn joinedbattle_optional_script_password() {
        assert_eq!(
            parse_line("JOINEDBATTLE 3 alice"),
            ServerMessage::JoinedBattle {
                id: 3,
                username: "alice".into(),
                script_password: None,
            }
        );
        assert_eq!(
            parse_line("JOINEDBATTLE 3 alice secret"),
            ServerMessage::JoinedBattle {
                id: 3,
                username: "alice".into(),
                script_password: Some("secret".into()),
            }
        );
    }

    #[test]
    fn clientstatus_parses_int() {
        assert_eq!(
            parse_line("CLIENTSTATUS alice 87"),
            ServerMessage::ClientStatus {
                username: "alice".into(),
                status: 87,
            }
        );
    }

    #[test]
    fn left_optional_reason() {
        assert_eq!(
            parse_line("LEFT main bob"),
            ServerMessage::Left {
                channel: "main".into(),
                username: "bob".into(),
                reason: None,
            }
        );
        assert_eq!(
            parse_line("LEFT main bob quit: bye now"),
            ServerMessage::Left {
                channel: "main".into(),
                username: "bob".into(),
                reason: Some("quit: bye now".into()),
            }
        );
    }

    #[test]
    fn unknown_command() {
        assert_eq!(
            parse_line("FROBNICATE whatever"),
            ServerMessage::Unknown {
                raw: "FROBNICATE whatever".into()
            }
        );
    }

    #[test]
    fn ping_pong_optional_token() {
        assert_eq!(parse_line("PING"), ServerMessage::Ping { token: None });
        assert_eq!(
            parse_line("PONG tok1"),
            ServerMessage::Pong {
                token: Some("tok1".into())
            }
        );
    }
}
