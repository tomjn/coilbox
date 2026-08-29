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

use std::net::IpAddr;

use serde::Serialize;

/// The marker teiserver puts in front of its extension announcement, which it
/// sends as a `SERVERMSG` rather than a command of its own.
const PROTOCOL_EXTENSIONS_PREFIX: &str = "@PROTOCOL_EXTENSIONS@";

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
    /// `CHANNEL <name> <usercount> [topic]`
    ChannelInfo {
        name: String,
        user_count: u32,
        topic: Option<String>,
    },
    /// `ENDOFCHANNELS`
    EndOfChannels,
    /// `JOINFAILED <channel> <reason>`
    JoinFailed { channel: String, reason: String },
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
    /// `SAIDPRIVATEEX <fromuser> <msg>` — a private action / `/me` message.
    SaidPrivateEx { username: String, message: String },
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
    /// `CLIENTIP <username> <ip>`, the address a joiner reaches the outside
    /// world at.
    ///
    /// Sent to the host of a battle only, once per join, immediately before the
    /// `JOINEDBATTLE` announcing the same player, and only where the host asked
    /// for relay support at login and the lobby has a relay. Ordinary joins,
    /// spectators and mid-game joins are all the same case. So a host that is
    /// not relaying, and every host that is not coilbox, never sees one.
    ///
    /// It exists because a TURN relay drops traffic from an address it holds no
    /// permission for and tells neither end, so a relay host has to vouch for a
    /// joiner before that player's engine sends its first packet. The joiner
    /// cannot supply the address themselves: the packets that would carry it are
    /// the ones being dropped.
    ///
    /// There is no port, because a TURN permission matches on the address alone.
    /// `CLIENTIPPORT` is a different message, for hole-punched battles, and this
    /// does not replace it.
    ///
    /// The address is parsed rather than carried as text because the only thing
    /// that is ever done with it is handing it to the relay agent, which takes
    /// an [`IpAddr`]. A value that is not an address names nobody, so a line
    /// carrying one is not a `CLIENTIP` at all.
    ClientIp { username: String, ip: IpAddr },
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
    /// `TURNCREDENTIALS <uri> <username> <password> <ttl_seconds>`, the lobby's
    /// answer to [`crate::command::turn_credentials`].
    ///
    /// The username and password are the relay's, not the player's. The lobby
    /// mints them out of a secret it shares with the relay, and they are good
    /// for `ttl_seconds` and no longer.
    TurnCredentials {
        /// The relay, as a TURN URI: `turn:host:port`.
        uri: String,
        username: String,
        password: String,
        /// How long the relay will accept them for, from now.
        ttl_seconds: u64,
    },
    /// `TURNCREDENTIALSFAILED <reason>`, the lobby declining to mint one. The
    /// reason is meant for the person trying to host, so it is carried whole.
    TurnCredentialsFailed { reason: String },
    /// `RELAYEDHOSTFAILED <reason>`, the lobby refusing the address
    /// [`crate::command::relayed_host`] named for the battle about to be opened.
    /// There is no reply on success, so this is the only thing the lobby ever
    /// says about that line.
    ///
    /// The reason is the rest of the line, may contain spaces, and is written
    /// for a person, so it is carried whole and never matched on. The server's
    /// set today covers a lobby with no relay, a client that did not ask for
    /// relay support, an address that is not public or not an address at all,
    /// and a port outside 1-65535, and it will grow.
    RelayedHostFailed { reason: String },
    /// `PING [token]`
    Ping { token: Option<String> },
    /// `PONG [token]`
    Pong { token: Option<String> },
    /// `RING <username>`
    Ring { username: String },
    /// `SERVERMSG <text>`
    ServerMsg { text: String },
    /// teiserver's extension announcement, sent on login as
    /// `SERVERMSG @PROTOCOL_EXTENSIONS@ {"ring:originator":1}`. It is addressed to
    /// the client, not the player, so it is kept apart from [`Self::ServerMsg`] to
    /// stay out of the notification the user sees. Nothing reads `json` yet.
    ProtocolExtensions { json: String },
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
    /// `JSON <payload>` - any JSON frame we don't parse into a typed variant,
    /// kept raw so an unrecognised or malformed one still reaches the console.
    Json { payload: String },
    /// `JSON {"SAID":{..}}` - a stored channel message replayed in answer to
    /// `GETCHANNELMESSAGES`. `at_ms` is the original send time (already
    /// normalised from whichever dialect the server used), `id` its history
    /// cursor. Live chat arrives as `Said`/`SaidEx` and has neither.
    JsonSaid {
        channel: String,
        username: String,
        message: String,
        ex_msg: bool,
        id: u64,
        at_ms: u64,
    },
    /// `REGISTRATIONACCEPTED`
    RegistrationAccepted,
    /// `REGISTRATIONDENIED <reason>`
    RegistrationDenied { reason: String },
    /// `IGNORE userName=<name>[\treason=<reason>]` — ack that an ignore was stored.
    Ignore {
        username: String,
        reason: Option<String>,
    },
    /// `UNIGNORE userName=<name>` — ack that an ignore was removed.
    Unignore { username: String },
    /// `IGNORELISTBEGIN` — start of the streamed ignore list.
    IgnoreListBegin,
    /// `IGNORELIST userName=<name>[\treason=<reason>]` — one ignore-list entry.
    IgnoreListEntry {
        username: String,
        reason: Option<String>,
    },
    /// `IGNORELISTEND` — end of the streamed ignore list.
    IgnoreListEnd,
    /// `FRIEND userName=<name>` — a friendship was established (sent to both parties).
    Friend { username: String },
    /// `UNFRIEND userName=<name>` — a friendship was removed (sent to both parties).
    Unfriend { username: String },
    /// `FRIENDREQUEST userName=<name>[\tmsg=<msg>]` — an incoming friend request.
    FriendRequest {
        username: String,
        msg: Option<String>,
    },
    /// `FRIENDLISTBEGIN` — start of the mutual-friend list.
    FriendListBegin,
    /// `FRIENDLIST userName=<name>` — one mutual friend in the list stream.
    FriendListEntry { username: String },
    /// `FRIENDLISTEND` — end of the mutual-friend list.
    FriendListEnd,
    /// `FRIENDREQUESTLISTBEGIN` — start of the pending-request list.
    FriendRequestListBegin,
    /// `FRIENDREQUESTLIST userName=<name>[\tmsg=<msg>]` — one pending incoming request.
    FriendRequestListEntry {
        username: String,
        msg: Option<String>,
    },
    /// `FRIENDREQUESTLISTEND` — end of the pending-request list.
    FriendRequestListEnd,
    /// Any command not recognized above.
    Unknown { raw: String },
}

/// Strip a `\r`, then an optional leading `#<digits> ` message-id prefix.
pub(crate) fn strip_framing(line: &str) -> &str {
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
pub(crate) fn split_command(line: &str) -> (String, &str) {
    match line.split_once(' ') {
        Some((cmd, rest)) => (cmd.to_ascii_uppercase(), rest),
        None => (line.to_ascii_uppercase(), ""),
    }
}

/// Parse `N` space-separated fields keeping the last field's embedded spaces.
/// Returns `None` if there are fewer than `n` fields.
pub(crate) fn fields<const N: usize>(rest: &str) -> Option<[&str; N]> {
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

pub(crate) fn parse_bool01(s: &str) -> bool {
    s.trim() != "0" && !s.trim().is_empty()
}

/// Look up a `key=value` tag in a tab-separated tag block, returning its value.
/// Used by the friend messages, whose payload is `userName=<name>[\tmsg=<msg>]`.
pub(crate) fn tag<'a>(rest: &'a str, key: &str) -> Option<&'a str> {
    rest.split('\t').find_map(|kv| {
        let (k, v) = kv.split_once('=')?;
        (k == key).then_some(v)
    })
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
        "JOINFAILED" => {
            // `JOINFAILED <channel> <reason>`: the channel is the first token, the
            // reason is the remaining sentence (empty if the server omitted it).
            let (channel, reason) = rest.split_once(' ').unwrap_or((rest, ""));
            ServerMessage::JoinFailed {
                channel: channel.to_string(),
                reason: reason.to_string(),
            }
        }
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
        "SAIDPRIVATEEX" => match fields::<2>(rest) {
            Some([username, message]) => ServerMessage::SaidPrivateEx {
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
        "CLIENTIP" => match fields::<2>(rest) {
            // The last field is greedy, so a username with a space in it pushes
            // the rest of the line into the address slot and the parse fails
            // there. That is the shift guard: a `CLIENTIP` whose fields have
            // moved along is not read as one, the same way a shifted
            // `TURNCREDENTIALS` is not read as a credential.
            Some([username, ip]) if !username.is_empty() => match ip.trim().parse() {
                Ok(ip) => ServerMessage::ClientIp {
                    username: username.to_string(),
                    ip,
                },
                Err(_) => ServerMessage::Unknown { raw: raw() },
            },
            _ => ServerMessage::Unknown { raw: raw() },
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
        "TURNCREDENTIALS" => parse_turn_credentials(rest, raw),
        "TURNCREDENTIALSFAILED" => ServerMessage::TurnCredentialsFailed {
            reason: rest.to_string(),
        },
        "RELAYEDHOSTFAILED" => ServerMessage::RelayedHostFailed {
            reason: rest.to_string(),
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
        "SERVERMSG" => match rest.strip_prefix(PROTOCOL_EXTENSIONS_PREFIX) {
            Some(json) => ServerMessage::ProtocolExtensions {
                json: json.trim().to_string(),
            },
            None => ServerMessage::ServerMsg {
                text: rest.to_string(),
            },
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
        "JSON" => parse_json_frame(rest),
        "REGISTRATIONACCEPTED" => ServerMessage::RegistrationAccepted,
        "REGISTRATIONDENIED" => ServerMessage::RegistrationDenied {
            reason: rest.to_string(),
        },
        "IGNORE" => {
            let (username, reason) = parse_ignore_tags(rest);
            ServerMessage::Ignore { username, reason }
        }
        "UNIGNORE" => {
            let (username, _) = parse_ignore_tags(rest);
            ServerMessage::Unignore { username }
        }
        "IGNORELISTBEGIN" => ServerMessage::IgnoreListBegin,
        "IGNORELIST" => {
            let (username, reason) = parse_ignore_tags(rest);
            ServerMessage::IgnoreListEntry { username, reason }
        }
        "IGNORELISTEND" => ServerMessage::IgnoreListEnd,
        "FRIEND" => match tag(rest, "userName") {
            Some(u) => ServerMessage::Friend {
                username: u.to_string(),
            },
            None => ServerMessage::Unknown { raw: raw() },
        },
        "UNFRIEND" => match tag(rest, "userName") {
            Some(u) => ServerMessage::Unfriend {
                username: u.to_string(),
            },
            None => ServerMessage::Unknown { raw: raw() },
        },
        "FRIENDREQUEST" => match tag(rest, "userName") {
            Some(u) => ServerMessage::FriendRequest {
                username: u.to_string(),
                msg: tag(rest, "msg").map(str::to_string),
            },
            None => ServerMessage::Unknown { raw: raw() },
        },
        "FRIENDLISTBEGIN" => ServerMessage::FriendListBegin,
        "FRIENDLIST" => match tag(rest, "userName") {
            Some(u) => ServerMessage::FriendListEntry {
                username: u.to_string(),
            },
            None => ServerMessage::Unknown { raw: raw() },
        },
        "FRIENDLISTEND" => ServerMessage::FriendListEnd,
        "FRIENDREQUESTLISTBEGIN" => ServerMessage::FriendRequestListBegin,
        "FRIENDREQUESTLIST" => match tag(rest, "userName") {
            Some(u) => ServerMessage::FriendRequestListEntry {
                username: u.to_string(),
                msg: tag(rest, "msg").map(str::to_string),
            },
            None => ServerMessage::Unknown { raw: raw() },
        },
        "FRIENDREQUESTLISTEND" => ServerMessage::FriendRequestListEnd,
        _ => ServerMessage::Unknown { raw: raw() },
    }
}

/// Normalise a JSON chat frame's `time` to unix millis.
///
/// The dialect depends on the `jsonchat` compat flag, which we don't set: without
/// it the server sends a string of unix seconds, with it an integer of unix
/// microseconds. Accept both, so enabling the flag later can't silently shift
/// every timestamp by a factor of a million.
fn chat_time_ms(v: &serde_json::Value) -> Option<u64> {
    match v {
        serde_json::Value::String(s) => s.parse::<u64>().ok()?.checked_mul(1_000),
        serde_json::Value::Number(n) => Some(n.as_u64()? / 1_000),
        _ => None,
    }
}

/// Parse a `JSON <payload>` frame into a typed variant. Frames are single-key
/// envelopes, `{"<COMMAND>":{..fields..}}`.
///
/// Anything unrecognised or unreadable degrades to the raw [`ServerMessage::Json`]
/// passthrough rather than failing: a server that grows a new JSON frame, or sends
/// a malformed one, must not take the connection down with it.
fn parse_json_frame(rest: &str) -> ServerMessage {
    let fallback = || ServerMessage::Json {
        payload: rest.to_string(),
    };
    let Ok(frame) = serde_json::from_str::<serde_json::Value>(rest) else {
        return fallback();
    };
    let Some(body) = frame.get("SAID") else {
        return fallback();
    };
    let (Some(channel), Some(username), Some(message), Some(id), Some(at_ms)) = (
        body.get("chanName").and_then(serde_json::Value::as_str),
        body.get("userName").and_then(serde_json::Value::as_str),
        body.get("msg").and_then(serde_json::Value::as_str),
        body.get("id").and_then(serde_json::Value::as_u64),
        body.get("time").and_then(chat_time_ms),
    ) else {
        return fallback();
    };
    ServerMessage::JsonSaid {
        channel: channel.to_string(),
        username: username.to_string(),
        message: message.to_string(),
        // The only field whose absence has a safe reading: not an action.
        ex_msg: body
            .get("ex_msg")
            .and_then(serde_json::Value::as_bool)
            .unwrap_or(false),
        id,
        at_ms,
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

/// Parse an ignore payload's tab-separated `userName=<name>[\treason=<reason>]`
/// tags into `(username, reason)`. Shared by `IGNORE`/`UNIGNORE`/`IGNORELIST`.
fn parse_ignore_tags(rest: &str) -> (String, Option<String>) {
    let mut username = String::new();
    let mut reason = None;
    for field in rest.split('\t') {
        if let Some(v) = field.strip_prefix("userName=") {
            username = v.to_string();
        } else if let Some(v) = field.strip_prefix("reason=") {
            reason = Some(v.to_string());
        }
    }
    (username, reason)
}

/// Parse `TURNCREDENTIALS <uri> <username> <password> <ttl_seconds>`.
///
/// A field that cannot be read is refused rather than guessed at, and that
/// matters more here than on most lines. A slot ends at the first space
/// ([`crate::command::fits_one_field`]), so a value carrying one moves every
/// field after it along by one. The password would arrive as its first half,
/// the host would take that to the relay, and the relay would refuse the
/// allocation without saying anything a person could act on.
///
/// What catches a shift is the lifetime: it is last, so it is greedy, and it
/// has to be a plain number. Any value that stole a slot pushes text into it and
/// it stops parsing. So a shifted line is not read as a credential at all. It
/// falls through to [`ServerMessage::Unknown`] the way any unreadable line does,
/// and the host waits out the ask rather than being handed a credential built
/// from the wrong pieces. The first three fields cannot hold a space at all,
/// because a space is where this splits them.
fn parse_turn_credentials(rest: &str, raw: impl Fn() -> String) -> ServerMessage {
    let Some([uri, username, password, ttl]) = fields::<4>(rest) else {
        return ServerMessage::Unknown { raw: raw() };
    };
    // An empty slot is a field the server left out, which is the other way a
    // line can be four fields wide and still not be a credential.
    if uri.is_empty() || username.is_empty() || password.is_empty() {
        return ServerMessage::Unknown { raw: raw() };
    }
    let Ok(ttl_seconds) = ttl.trim().parse::<u64>() else {
        return ServerMessage::Unknown { raw: raw() };
    };
    ServerMessage::TurnCredentials {
        uri: uri.to_string(),
        username: username.to_string(),
        password: password.to_string(),
        ttl_seconds,
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
    fn json_said_reads_a_history_frame() {
        let m = parse_line(
            r#"JSON {"SAID":{"chanName":"main","time":"1718200000","userName":"bob","msg":"hi there","ex_msg":false,"id":42}}"#,
        );
        assert_eq!(
            m,
            ServerMessage::JsonSaid {
                channel: "main".into(),
                username: "bob".into(),
                message: "hi there".into(),
                ex_msg: false,
                id: 42,
                at_ms: 1_718_200_000_000,
            }
        );
    }

    /// The dialect depends on a compat flag, so the same instant must parse
    /// identically whether or not `jsonchat` is ever enabled. Getting this wrong
    /// misplaces every history line by a factor of a million.
    #[test]
    fn json_said_time_dialects_agree() {
        let seconds = parse_line(
            r#"JSON {"SAID":{"chanName":"main","time":"1718200000","userName":"bob","msg":"hi","ex_msg":false,"id":1}}"#,
        );
        let micros = parse_line(
            r#"JSON {"SAID":{"chanName":"main","time":1718200000000000,"userName":"bob","msg":"hi","ex_msg":false,"id":1}}"#,
        );
        assert_eq!(seconds, micros);
        let ServerMessage::JsonSaid { at_ms, .. } = seconds else {
            panic!("expected JsonSaid");
        };
        assert_eq!(at_ms, 1_718_200_000_000);
    }

    #[test]
    fn json_said_carries_ex_msg_and_spaces() {
        let m = parse_line(
            r#"JSON {"SAID":{"chanName":"main","time":"1718200000","userName":"bob","msg":"waves   slowly","ex_msg":true,"id":7}}"#,
        );
        assert!(matches!(
            m,
            ServerMessage::JsonSaid {
                ex_msg: true,
                ref message,
                ..
            } if message == "waves   slowly"
        ));
    }

    /// A JSON frame we don't model, or can't read, must degrade to the raw
    /// passthrough rather than panic or vanish - it still reaches the console.
    #[test]
    fn unreadable_json_frames_fall_back_to_passthrough() {
        for payload in [
            r#"{"SAIDPRIVATE":{"userName":"bob","msg":"hi"}}"#, // a frame we don't model
            r#"{"SAID":{"chanName":"main"}}"#,                  // SAID missing its fields
            r#"{"SAID":{"chanName":"main","time":"nonsense","userName":"b","msg":"m","id":1}}"#,
            "not json at all",
            "",
        ] {
            let m = parse_line(&format!("JSON {payload}"));
            assert_eq!(
                m,
                ServerMessage::Json {
                    payload: payload.to_string()
                },
                "payload should have fallen back: {payload}"
            );
        }
    }

    #[test]
    fn parses_saidprivateex_action() {
        let m = parse_line("SAIDPRIVATEEX alice waves at you");
        assert_eq!(
            m,
            ServerMessage::SaidPrivateEx {
                username: "alice".into(),
                message: "waves at you".into(),
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
    fn parses_ignore_ack_with_and_without_reason() {
        assert_eq!(
            parse_line("IGNORE userName=bob"),
            ServerMessage::Ignore {
                username: "bob".into(),
                reason: None,
            }
        );
        assert_eq!(
            parse_line("IGNORE userName=bob\treason=spammer"),
            ServerMessage::Ignore {
                username: "bob".into(),
                reason: Some("spammer".into()),
            }
        );
    }

    #[test]
    fn parses_unignore_ack() {
        assert_eq!(
            parse_line("UNIGNORE userName=bob"),
            ServerMessage::Unignore {
                username: "bob".into()
            }
        );
    }

    #[test]
    fn parses_ignorelist_framing() {
        assert_eq!(
            parse_line("IGNORELISTBEGIN"),
            ServerMessage::IgnoreListBegin
        );
        assert_eq!(
            parse_line("IGNORELIST userName=bob\treason=rude"),
            ServerMessage::IgnoreListEntry {
                username: "bob".into(),
                reason: Some("rude".into()),
            }
        );
        assert_eq!(
            parse_line("IGNORELIST userName=alice"),
            ServerMessage::IgnoreListEntry {
                username: "alice".into(),
                reason: None,
            }
        );
        assert_eq!(parse_line("IGNORELISTEND"), ServerMessage::IgnoreListEnd);
    }

    #[test]
    fn parses_friend_messages() {
        assert_eq!(
            parse_line("FRIEND userName=bob"),
            ServerMessage::Friend {
                username: "bob".into()
            }
        );
        assert_eq!(
            parse_line("UNFRIEND userName=bob"),
            ServerMessage::Unfriend {
                username: "bob".into()
            }
        );
        assert_eq!(
            parse_line("FRIENDREQUEST userName=bob"),
            ServerMessage::FriendRequest {
                username: "bob".into(),
                msg: None,
            }
        );
        assert_eq!(
            parse_line("FRIENDREQUEST userName=bob\tmsg=hi there"),
            ServerMessage::FriendRequest {
                username: "bob".into(),
                msg: Some("hi there".into()),
            }
        );
    }

    #[test]
    fn parses_friend_list_framing() {
        assert_eq!(
            parse_line("FRIENDLISTBEGIN"),
            ServerMessage::FriendListBegin
        );
        assert_eq!(
            parse_line("FRIENDLIST userName=alice"),
            ServerMessage::FriendListEntry {
                username: "alice".into()
            }
        );
        assert_eq!(parse_line("FRIENDLISTEND"), ServerMessage::FriendListEnd);
        assert_eq!(
            parse_line("FRIENDREQUESTLISTBEGIN"),
            ServerMessage::FriendRequestListBegin
        );
        assert_eq!(
            parse_line("FRIENDREQUESTLIST userName=carol\tmsg=add me"),
            ServerMessage::FriendRequestListEntry {
                username: "carol".into(),
                msg: Some("add me".into()),
            }
        );
        assert_eq!(
            parse_line("FRIENDREQUESTLISTEND"),
            ServerMessage::FriendRequestListEnd
        );
    }

    /// A credential in the shape coturn's shared-secret scheme produces: the
    /// username is an expiry and a user id, the password is base64 of an HMAC.
    #[test]
    fn parses_a_minted_turn_credential() {
        let m = parse_line(
            "TURNCREDENTIALS turn:relay.example.org:3478 1786000000:alice bnVIYm9hcmRIbWFjc2ln= 86400",
        );
        assert_eq!(
            m,
            ServerMessage::TurnCredentials {
                uri: "turn:relay.example.org:3478".into(),
                username: "1786000000:alice".into(),
                password: "bnVIYm9hcmRIbWFjc2ln=".into(),
                ttl_seconds: 86_400,
            }
        );
    }

    /// The hazard [`crate::command::fits_one_field`] names, on the receiving
    /// side. Base64 has no space in it, but "has none normally" is not a thing
    /// to rely on when the result is a host taking half a password to the relay.
    #[test]
    fn a_credential_field_with_a_space_is_not_read_as_a_credential() {
        use crate::command::fits_one_field;

        // What a real password looks like, and what it must not look like.
        assert!(fits_one_field("bnVIYm9hcmRIbWFjc2ln="));
        assert!(!fits_one_field("half a password"));

        for line in [
            // A space in the password pushes its tail into the lifetime.
            "TURNCREDENTIALS turn:relay.example.org:3478 1786000000:alice half a password 86400",
            // A space in the username does the same one field earlier.
            "TURNCREDENTIALS turn:relay.example.org:3478 alice smith secret 86400",
            // A lifetime that is not a number, on its own.
            "TURNCREDENTIALS turn:relay.example.org:3478 alice secret a-while",
            // Three fields, so not a credential at all.
            "TURNCREDENTIALS turn:relay.example.org:3478 alice secret",
            // A field the server left empty.
            "TURNCREDENTIALS  alice secret 86400",
        ] {
            assert_eq!(
                parse_line(line),
                ServerMessage::Unknown { raw: line.into() },
                "a line this shape must not become a credential: {line}"
            );
        }
    }

    #[test]
    fn parses_a_refusal_to_mint_a_turn_credential() {
        assert_eq!(
            parse_line("TURNCREDENTIALSFAILED you have asked too often"),
            ServerMessage::TurnCredentialsFailed {
                reason: "you have asked too often".into(),
            }
        );
        // A server that names no reason still refuses.
        assert_eq!(
            parse_line("TURNCREDENTIALSFAILED"),
            ServerMessage::TurnCredentialsFailed { reason: "".into() }
        );
    }

    /// The lobby's only answer to `RELAYEDHOST`, and the only way a host finds
    /// out their battle is not going through the relay after all.
    ///
    /// Every reason the server has today is a sentence, so the whole of the rest
    /// of the line is the reason. Taking only the first word would leave a host
    /// reading "Port" or "This", which says nothing.
    #[test]
    fn parses_a_refusal_of_the_address_a_relayed_battle_lives_at() {
        for (line, reason) in [
            (
                "RELAYEDHOSTFAILED This server has no relay configured",
                "This server has no relay configured",
            ),
            (
                "RELAYEDHOSTFAILED 192.168.1.5 is not a public address, so nobody could join a battle there",
                "192.168.1.5 is not a public address, so nobody could join a battle there",
            ),
            (
                "RELAYEDHOSTFAILED Port is out of range: 1-65535: 70000",
                "Port is out of range: 1-65535: 70000",
            ),
        ] {
            assert_eq!(
                parse_line(line),
                ServerMessage::RelayedHostFailed {
                    reason: reason.into(),
                },
                "the whole sentence is the reason: {line}"
            );
        }
        // A server that names no reason still refuses, and the refusal is what
        // matters.
        assert_eq!(
            parse_line("RELAYEDHOSTFAILED"),
            ServerMessage::RelayedHostFailed { reason: "".into() }
        );
    }

    /// The line that makes relay hosting work. A battle host is told each
    /// joiner's public address before the `JOINEDBATTLE` for the same player,
    /// and the address is the whole point of the line.
    #[test]
    fn parses_a_joiners_address() {
        assert_eq!(
            parse_line("CLIENTIP alice 203.0.113.7"),
            ServerMessage::ClientIp {
                username: "alice".into(),
                ip: "203.0.113.7".parse().expect("an address"),
            }
        );
        // Nothing in the wire format says IPv4, and a lobby reached over IPv6
        // observes its clients at IPv6 addresses.
        assert_eq!(
            parse_line("CLIENTIP alice 2001:db8::1"),
            ServerMessage::ClientIp {
                username: "alice".into(),
                ip: "2001:db8::1".parse().expect("an address"),
            }
        );
    }

    /// A line this shape names nobody the host could let through, so it must not
    /// be read as if it did. The address is parsed here rather than carried as
    /// text because the only thing that happens to it is being handed to the
    /// relay agent, and text that is not an address cannot be.
    #[test]
    fn a_line_that_names_no_address_is_not_a_joiner() {
        for line in [
            // Not an address at all.
            "CLIENTIP alice not-an-address",
            // A username with a space in it shifts the address out of its slot,
            // and what lands there is the rest of the line.
            "CLIENTIP alice smith 203.0.113.7",
            // One field, so nothing to allow.
            "CLIENTIP alice",
            // A field the server left empty.
            "CLIENTIP  203.0.113.7",
            // An address with the port a TURN permission would ignore, which is
            // a server sending a different message from the one agreed.
            "CLIENTIP alice 203.0.113.7:8452",
        ] {
            assert_eq!(
                parse_line(line),
                ServerMessage::Unknown { raw: line.into() },
                "a line this shape must not be read as a joiner's address: {line}"
            );
        }
    }

    /// `CLIENTIPPORT` is a different message, for hole-punched battles, and it
    /// shares every letter of this one's name. Reading it as a `CLIENTIP` would
    /// hand the relay an address for a battle that is not relayed at all.
    ///
    /// The second line is the one with teeth. A well-formed `CLIENTIPPORT` has a
    /// port on the end, which lands in the greedy address slot and fails to
    /// parse, so it would be refused by accident even if the command were
    /// matched by its first eight letters. One without its port would not be.
    #[test]
    fn clientipport_is_not_clientip() {
        for line in [
            "CLIENTIPPORT alice 203.0.113.7 8452",
            "CLIENTIPPORT alice 203.0.113.7",
        ] {
            assert_eq!(
                parse_line(line),
                ServerMessage::Unknown { raw: line.into() },
                "a different command must not be read as a joiner's address: {line}"
            );
        }
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
