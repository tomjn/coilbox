//! The pure state reducer.
//!
//! [`reduce`] applies one [`ServerMessage`] to a [`LobbyState`], mutating it in
//! place and returning the [`Delta`]s the frontend should react to. It performs
//! NO side effects: things like ringing, notifications and launching are
//! represented as [`Delta`] variants for the driving plugin to act on.

use crate::message::ServerMessage;
use crate::state::{
    Battle, Bot, ChannelState, ChatKind, ChatMsg, DirChannel, LobbyState, MemberStatus, StartRect,
    User,
};
use crate::status::{BattleStatus, ClientStatus};
use serde::Serialize;

/// A frontend-facing change produced by [`reduce`].
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Delta {
    UserAdded {
        name: String,
    },
    UserRemoved {
        name: String,
    },
    UserStatusChanged {
        name: String,
    },
    BattleOpened {
        id: u32,
    },
    BattleClosed {
        id: u32,
    },
    BattleInfoChanged {
        id: u32,
    },
    /// We just entered a battle: our own `JOINBATTLE`/`OPENBATTLE` ack landed.
    /// `own` is `true` when we opened it (host), `false` when we joined someone
    /// else's. Carries no new payload beyond the trigger - the snapshot already
    /// reflects `current_battle` - so the frontend switches into the battle view
    /// off this signal instead of waiting for an incidental follow-up delta.
    EnteredBattle {
        id: u32,
        own: bool,
    },
    MemberJoined {
        battle_id: u32,
        name: String,
    },
    MemberLeft {
        battle_id: u32,
        name: String,
    },
    MemberStatusChanged {
        battle_id: u32,
        name: String,
    },
    BotChanged {
        battle_id: u32,
        name: String,
    },
    BotRemoved {
        battle_id: u32,
        name: String,
    },
    ChatMessage {
        channel: Option<String>,
        index: usize,
    },
    PrivateMessage {
        from: String,
    },
    ChannelJoined {
        channel: String,
    },
    ChannelLeft {
        channel: String,
    },
    ChannelTopicChanged {
        channel: String,
    },
    StartRectChanged {
        ally: u8,
    },
    ScriptTagsChanged,
    PlayerWentIngame {
        name: String,
    },
    HostPort {
        port: u16,
    },
    LoggedIn {
        username: String,
    },
    LoginDenied {
        reason: String,
    },
    RegistrationDenied {
        reason: String,
    },
    /// A `SERVERMSG` (plain announcement) or `SERVERMSGBOX` (the server asked the
    /// client to show it prominently). `boxed` distinguishes the two so the
    /// frontend can render a toast vs. a dismissible dialog.
    ServerMessage {
        text: String,
        boxed: bool,
    },
    Ring {
        from: String,
    },
    JoinBattleFailed {
        reason: String,
    },
    OpenBattleFailed {
        reason: String,
    },
    /// A `JOINFAILED` for a chat channel: the server refused a `JOIN`, naming the
    /// channel and why (registered/locked, banned, bad name, …).
    JoinChannelFailed {
        channel: String,
        reason: String,
    },
    /// A generic `FAILED`: a command the server rejected, carrying the failed
    /// command name (empty if the server omitted it) and a human-readable reason.
    CommandFailed {
        command: String,
        reason: String,
    },
    ChannelListReceived,
}

/// Apply a server message to the lobby state, returning the deltas produced.
/// `now_ms` stamps any chat message created (unix millis; pass 0 when no clock).
pub fn reduce_at(state: &mut LobbyState, msg: ServerMessage, now_ms: u64) -> Vec<Delta> {
    match msg {
        ServerMessage::Accepted { username } => {
            state.my_username = Some(username.clone());
            vec![Delta::LoggedIn { username }]
        }
        ServerMessage::Denied { reason } => {
            vec![Delta::LoginDenied { reason }]
        }
        ServerMessage::CompFlags { flags } => {
            state.compflags = flags.into_iter().collect();
            vec![]
        }
        ServerMessage::AddUser {
            username,
            country,
            user_id,
            agent,
        } => {
            state.users.insert(
                username.clone(),
                User {
                    name: username.clone(),
                    country,
                    user_id,
                    agent,
                    status: ClientStatus::default(),
                },
            );
            vec![Delta::UserAdded { name: username }]
        }
        ServerMessage::RemoveUser { username } => {
            state.users.remove(&username);
            vec![Delta::UserRemoved { name: username }]
        }
        ServerMessage::ClientStatus { username, status } => {
            let new_status = ClientStatus::from_int(status);
            let mut deltas = Vec::new();
            if let Some(user) = state.users.get_mut(&username) {
                let was_ingame = user.status.ingame;
                user.status = new_status;
                deltas.push(Delta::UserStatusChanged {
                    name: username.clone(),
                });
                if new_status.ingame && !was_ingame {
                    deltas.push(Delta::PlayerWentIngame {
                        name: username.clone(),
                    });
                }
            } else {
                deltas.push(Delta::UserStatusChanged {
                    name: username.clone(),
                });
            }
            deltas
        }
        ServerMessage::Join { channel } => {
            state
                .channels
                .entry(channel.clone())
                .or_insert_with(|| ChannelState {
                    name: channel.clone(),
                    ..Default::default()
                });
            vec![Delta::ChannelJoined { channel }]
        }
        ServerMessage::Joined { channel, username } => {
            if let Some(ch) = state.channels.get_mut(&channel) {
                ch.users.insert(username.clone());
            }
            push_chat(
                state,
                &channel,
                ChatMsg {
                    channel: Some(channel.clone()),
                    from: username,
                    text: String::new(),
                    kind: ChatKind::Join,
                    at: now_ms,
                },
            )
        }
        ServerMessage::Left {
            channel,
            username,
            reason,
        } => {
            // Our own LEFT (the server's echo of our LEAVE) means we're no longer in
            // the channel, so drop it from state entirely rather than just trimming
            // the member list — otherwise it would linger in the channel list.
            if state.my_username.as_deref() == Some(username.as_str()) {
                state.channels.remove(&channel);
                return vec![Delta::ChannelLeft { channel }];
            }
            if let Some(ch) = state.channels.get_mut(&channel) {
                ch.users.remove(&username);
            }
            push_chat(
                state,
                &channel,
                ChatMsg {
                    channel: Some(channel.clone()),
                    from: username,
                    text: reason.unwrap_or_default(),
                    kind: ChatKind::Leave,
                    at: now_ms,
                },
            )
        }
        ServerMessage::Clients { channel, usernames } => {
            if let Some(ch) = state.channels.get_mut(&channel) {
                ch.users.extend(usernames);
            }
            vec![]
        }
        ServerMessage::ChannelTopic {
            channel,
            author: _,
            topic,
        } => {
            if let Some(ch) = state.channels.get_mut(&channel) {
                ch.topic = Some(topic);
            }
            vec![Delta::ChannelTopicChanged { channel }]
        }
        ServerMessage::ChannelMessage { channel, text } => push_chat(
            state,
            &channel,
            ChatMsg {
                channel: Some(channel.clone()),
                from: String::new(),
                text,
                kind: ChatKind::System,
                at: now_ms,
            },
        ),
        ServerMessage::Said {
            channel,
            username,
            message,
        } => push_chat(
            state,
            &channel,
            ChatMsg {
                channel: Some(channel.clone()),
                from: username,
                text: message,
                kind: ChatKind::Said,
                at: now_ms,
            },
        ),
        ServerMessage::SaidEx {
            channel,
            username,
            message,
        } => push_chat(
            state,
            &channel,
            ChatMsg {
                channel: Some(channel.clone()),
                from: username,
                text: message,
                kind: ChatKind::SaidEx,
                at: now_ms,
            },
        ),
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
        ServerMessage::SaidBattle { username, message } => {
            reduce_battle_chat(state, username, message, ChatKind::SaidBattle, now_ms)
        }
        ServerMessage::SaidBattleEx { username, message } => {
            reduce_battle_chat(state, username, message, ChatKind::SaidBattle, now_ms)
        }
        ServerMessage::BattleOpened {
            id,
            battle_type: _,
            nat_type: _,
            host,
            ip,
            port,
            max_players,
            passworded,
            rank: _,
            maphash,
            engine,
            version,
            map,
            title,
            modname,
            channel,
        } => {
            // The founder is implicitly a member of their own battle, but the
            // server sends no JOINEDBATTLE for them, so seed the member here.
            // Without this we never appear in our own roster and our own
            // CLIENTBATTLESTATUS echo is dropped (find_member_battle can't place
            // a member that isn't in any battle yet).
            let own = state.my_username.as_deref() == Some(host.as_str());
            let mut battle = Battle {
                id,
                host,
                ip,
                port,
                map,
                maphash,
                modname,
                engine,
                version,
                max_players,
                passworded,
                locked: false,
                spectator_count: 0,
                title,
                channel,
                ..Default::default()
            };
            if own {
                battle
                    .members
                    .insert(battle.host.clone(), MemberStatus::default());
            }
            state.battles.insert(id, battle);
            vec![Delta::BattleOpened { id }]
        }
        ServerMessage::UpdateBattleInfo {
            id,
            spectator_count,
            locked,
            maphash,
            map,
        } => {
            // Turn map/lock changes into non-bubble "system" chat notices, derived
            // from the diff against current state before we overwrite it. The server
            // echoes UPDATEBATTLEINFO to every member (the founder included), so all
            // clients synthesize the same notice from the real change.
            let mut notices: Vec<(String, String)> = Vec::new();
            if let Some(b) = state.battles.get_mut(&id) {
                if let Some(chan) = b.channel.clone() {
                    if b.map != map {
                        notices.push((chan.clone(), format!("Host changed the map to {map}")));
                    }
                    if b.locked != locked {
                        let text = if locked {
                            "Host locked the battle"
                        } else {
                            "Host unlocked the battle"
                        };
                        notices.push((chan, text.to_string()));
                    }
                }
                b.spectator_count = spectator_count;
                b.locked = locked;
                b.maphash = maphash;
                b.map = map;
            }
            let mut deltas = vec![Delta::BattleInfoChanged { id }];
            for (chan, text) in notices {
                deltas.extend(push_chat(
                    state,
                    &chan,
                    ChatMsg {
                        channel: Some(chan.clone()),
                        from: String::new(),
                        text,
                        kind: ChatKind::System,
                        at: now_ms,
                    },
                ));
            }
            deltas
        }
        ServerMessage::BattleClosed { id } => {
            state.battles.remove(&id);
            if state.current_battle == Some(id) {
                state.current_battle = None;
                state.my_intended_battle_status = None;
            }
            vec![Delta::BattleClosed { id }]
        }
        ServerMessage::JoinedBattle {
            id,
            username,
            script_password,
        } => {
            if let Some(b) = state.battles.get_mut(&id) {
                b.members.entry(username.clone()).or_insert(MemberStatus {
                    battle_status: BattleStatus::default(),
                    team_color: 0,
                    script_password,
                });
            }
            vec![Delta::MemberJoined {
                battle_id: id,
                name: username,
            }]
        }
        ServerMessage::LeftBattle { id, username } => {
            if let Some(b) = state.battles.get_mut(&id) {
                b.members.remove(&username);
            }
            if state.my_username.as_deref() == Some(username.as_str())
                && state.current_battle == Some(id)
            {
                state.current_battle = None;
                state.my_intended_battle_status = None;
            }
            vec![Delta::MemberLeft {
                battle_id: id,
                name: username,
            }]
        }
        ServerMessage::JoinBattle {
            id,
            hashcode: _,
            channel: _,
        } => {
            // Own-join acknowledgement.
            state.current_battle = Some(id);
            state.last_battle = Some(id);
            vec![] // RED-check: temporarily reverted
        }
        ServerMessage::JoinBattleFailed { reason } => {
            vec![Delta::JoinBattleFailed { reason }]
        }
        ServerMessage::JoinBattleRequest { .. } => vec![],
        ServerMessage::ClientBattleStatus {
            username,
            battle_status,
            team_color,
        } => {
            let bs = BattleStatus::from_int(battle_status);
            let color = team_color as u32;
            // Update in whichever battle the member is currently in (usually the
            // current battle, but keep the global picture correct).
            let mut deltas = Vec::new();
            let target = find_member_battle(state, &username);
            if let Some(bid) = target {
                if let Some(b) = state.battles.get_mut(&bid) {
                    let m = b.members.entry(username.clone()).or_default();
                    m.battle_status = bs;
                    m.team_color = color;
                }
                deltas.push(Delta::MemberStatusChanged {
                    battle_id: bid,
                    name: username,
                });
            }
            deltas
        }
        ServerMessage::AddBot {
            battle_id,
            name,
            owner,
            battle_status,
            team_color,
            ai_dll,
        } => {
            if let Some(b) = state.battles.get_mut(&battle_id) {
                b.bots.insert(
                    name.clone(),
                    Bot {
                        name: name.clone(),
                        owner,
                        ai_dll,
                        battle_status: BattleStatus::from_int(battle_status),
                        team_color: team_color as u32,
                    },
                );
            }
            vec![Delta::BotChanged { battle_id, name }]
        }
        ServerMessage::UpdateBot {
            battle_id,
            name,
            battle_status,
            team_color,
        } => {
            if let Some(b) = state.battles.get_mut(&battle_id) {
                if let Some(bot) = b.bots.get_mut(&name) {
                    bot.battle_status = BattleStatus::from_int(battle_status);
                    bot.team_color = team_color as u32;
                }
            }
            vec![Delta::BotChanged { battle_id, name }]
        }
        ServerMessage::RemoveBot { battle_id, name } => {
            if let Some(b) = state.battles.get_mut(&battle_id) {
                b.bots.remove(&name);
            }
            vec![Delta::BotRemoved { battle_id, name }]
        }
        ServerMessage::AddStartRect {
            ally,
            left,
            top,
            right,
            bottom,
        } => {
            if let Some(bid) = state.current_battle {
                if let Some(b) = state.battles.get_mut(&bid) {
                    b.start_rects.insert(
                        ally,
                        StartRect {
                            left,
                            top,
                            right,
                            bottom,
                        },
                    );
                }
            }
            vec![Delta::StartRectChanged { ally }]
        }
        ServerMessage::RemoveStartRect { ally } => {
            if let Some(bid) = state.current_battle {
                if let Some(b) = state.battles.get_mut(&bid) {
                    b.start_rects.remove(&ally);
                }
            }
            vec![Delta::StartRectChanged { ally }]
        }
        ServerMessage::SetScriptTags { tags } => {
            if let Some(bid) = state.current_battle {
                if let Some(b) = state.battles.get_mut(&bid) {
                    for (k, v) in tags {
                        b.script_tags.insert(k, v);
                    }
                }
            }
            vec![Delta::ScriptTagsChanged]
        }
        ServerMessage::RemoveScriptTags { tags } => {
            if let Some(bid) = state.current_battle {
                if let Some(b) = state.battles.get_mut(&bid) {
                    for k in tags {
                        b.script_tags.remove(&k);
                    }
                }
            }
            vec![Delta::ScriptTagsChanged]
        }
        ServerMessage::OpenBattle { id } => {
            state.current_battle = Some(id);
            state.last_battle = Some(id);
            // A fresh host port arrives via HOSTPORT right after this ack; drop any
            // stale one from a previous host session.
            state.host_port = None;
            vec![] // RED-check: temporarily reverted
        }
        ServerMessage::OpenBattleFailed { reason } => {
            vec![Delta::OpenBattleFailed { reason }]
        }
        ServerMessage::HostPort { port } => {
            state.host_port = Some(port);
            vec![Delta::HostPort { port }]
        }
        ServerMessage::Ring { username } => {
            vec![Delta::Ring { from: username }]
        }
        ServerMessage::ServerMsg { text } => {
            vec![Delta::ServerMessage { text, boxed: false }]
        }
        ServerMessage::ServerMsgBox { text } => {
            vec![Delta::ServerMessage { text, boxed: true }]
        }
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
        ServerMessage::RegistrationDenied { reason } => {
            vec![Delta::RegistrationDenied { reason }]
        }
        ServerMessage::JoinFailed { channel, reason } => {
            vec![Delta::JoinChannelFailed { channel, reason }]
        }
        ServerMessage::Failed { text } => {
            let (command, reason) = parse_failed(&text);
            vec![Delta::CommandFailed { command, reason }]
        }
        // Messages carrying no state change / handled by the login machine.
        ServerMessage::TasServer { .. }
        | ServerMessage::Motd { .. }
        | ServerMessage::LoginInfoEnd
        | ServerMessage::RequestBattleStatus
        | ServerMessage::Ping { .. }
        | ServerMessage::Pong { .. }
        | ServerMessage::Ok { .. }
        | ServerMessage::Agreement { .. }
        | ServerMessage::AgreementEnd
        | ServerMessage::Json { .. }
        | ServerMessage::RegistrationAccepted
        | ServerMessage::Unknown { .. } => vec![],
    }
}

/// Clock-free convenience wrapper (timestamps stamped as 0). Used by tests.
pub fn reduce(state: &mut LobbyState, msg: ServerMessage) -> Vec<Delta> {
    reduce_at(state, msg, 0)
}

/// Clear the channel directory ahead of a fresh `CHANNELS` request so stale
/// entries don't linger while the new list streams in.
pub fn begin_channel_list(state: &mut LobbyState) {
    state.channel_directory.clear();
}

/// Parse a `FAILED` payload (`cmd=<command>\tmsg=<message>`, tab-delimited
/// key/values) into its command name and human-readable reason. Servers that
/// send a bare reason (no `cmd=`/`msg=` fields) fall back to the whole payload as
/// the reason with an empty command.
fn parse_failed(text: &str) -> (String, String) {
    let mut command = String::new();
    let mut reason = String::new();
    let mut matched = false;
    for field in text.split('\t') {
        if let Some(v) = field.strip_prefix("cmd=") {
            command = v.to_string();
            matched = true;
        } else if let Some(v) = field.strip_prefix("msg=") {
            reason = v.to_string();
            matched = true;
        }
    }
    if !matched {
        reason = text.to_string();
    }
    (command, reason)
}

/// Append a chat message to a channel (creating it if needed) and emit a delta
/// pointing at its index.
fn push_chat(state: &mut LobbyState, channel: &str, msg: ChatMsg) -> Vec<Delta> {
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

/// Route battle chat into the current battle's channel if one is known,
/// otherwise emit a delta with no channel.
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

/// Find which battle a given member currently belongs to. Prefers the current
/// battle when the member is present there.
fn find_member_battle(state: &LobbyState, username: &str) -> Option<u32> {
    if let Some(bid) = state.current_battle {
        if let Some(b) = state.battles.get(&bid) {
            if b.members.contains_key(username) {
                return Some(bid);
            }
        }
    }
    state
        .battles
        .values()
        .find(|b| b.members.contains_key(username))
        .map(|b| b.id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::message::parse_line;

    #[test]
    fn accepted_sets_username() {
        let mut s = LobbyState::new();
        let d = reduce(&mut s, parse_line("ACCEPTED alice"));
        assert_eq!(s.my_username.as_deref(), Some("alice"));
        assert_eq!(
            d,
            vec![Delta::LoggedIn {
                username: "alice".into()
            }]
        );
    }

    #[test]
    fn denied_emits_login_denied_delta() {
        let mut s = LobbyState::new();
        let d = reduce(&mut s, parse_line("DENIED wrong password"));
        assert_eq!(
            d,
            vec![Delta::LoginDenied {
                reason: "wrong password".into()
            }]
        );
    }

    #[test]
    fn registration_denied_emits_delta() {
        let mut s = LobbyState::new();
        let d = reduce(&mut s, parse_line("REGISTRATIONDENIED username taken"));
        assert_eq!(
            d,
            vec![Delta::RegistrationDenied {
                reason: "username taken".into()
            }]
        );
    }

    #[test]
    fn join_failed_emits_channel_and_reason() {
        let mut s = LobbyState::new();
        let d = reduce(
            &mut s,
            parse_line("JOINFAILED #moderators You do not have access"),
        );
        assert_eq!(
            d,
            vec![Delta::JoinChannelFailed {
                channel: "#moderators".into(),
                reason: "You do not have access".into()
            }]
        );
    }

    #[test]
    fn failed_parses_cmd_and_msg_fields() {
        let mut s = LobbyState::new();
        let d = reduce(&mut s, parse_line("FAILED cmd=JOIN\tmsg=Channel is locked"));
        assert_eq!(
            d,
            vec![Delta::CommandFailed {
                command: "JOIN".into(),
                reason: "Channel is locked".into()
            }]
        );
    }

    #[test]
    fn failed_without_fields_falls_back_to_reason() {
        let mut s = LobbyState::new();
        let d = reduce(&mut s, parse_line("FAILED something went wrong"));
        assert_eq!(
            d,
            vec![Delta::CommandFailed {
                command: String::new(),
                reason: "something went wrong".into()
            }]
        );
    }

    #[test]
    fn server_message_variants_carry_boxed_flag() {
        let mut s = LobbyState::new();
        let plain = reduce(&mut s, parse_line("SERVERMSG Maintenance in 5 minutes"));
        assert_eq!(
            plain,
            vec![Delta::ServerMessage {
                text: "Maintenance in 5 minutes".into(),
                boxed: false,
            }]
        );
        let boxed = reduce(
            &mut s,
            parse_line("SERVERMSGBOX Read this: https://example.com"),
        );
        assert_eq!(
            boxed,
            vec![Delta::ServerMessage {
                text: "Read this: https://example.com".into(),
                boxed: true,
            }]
        );
    }

    #[test]
    fn add_and_remove_user() {
        let mut s = LobbyState::new();
        reduce(&mut s, parse_line("ADDUSER bob GB 5 agent"));
        assert!(s.users.contains_key("bob"));
        reduce(&mut s, parse_line("REMOVEUSER bob"));
        assert!(!s.users.contains_key("bob"));
    }

    #[test]
    fn client_status_edge_triggers_ingame() {
        let mut s = LobbyState::new();
        reduce(&mut s, parse_line("ADDUSER bob GB 5 agent"));
        // ingame bit = 1
        let d = reduce(&mut s, parse_line("CLIENTSTATUS bob 1"));
        assert!(d.contains(&Delta::PlayerWentIngame { name: "bob".into() }));
        // still ingame; no new edge
        let d2 = reduce(&mut s, parse_line("CLIENTSTATUS bob 1"));
        assert!(!d2.contains(&Delta::PlayerWentIngame { name: "bob".into() }));
    }

    #[test]
    fn battle_lifecycle() {
        let mut s = LobbyState::new();
        reduce(
            &mut s,
            parse_line(
                "BATTLEOPENED 9 0 0 alice 1.2.3.4 8452 12 0 0 -1 spring\t105\tMap\tTitle\tBAR",
            ),
        );
        assert_eq!(s.battles.get(&9).unwrap().host, "alice");
        reduce(&mut s, parse_line("UPDATEBATTLEINFO 9 3 1 -1 NewMap"));
        let b = s.battles.get(&9).unwrap();
        assert_eq!(b.spectator_count, 3);
        assert!(b.locked);
        assert_eq!(b.map, "NewMap");
        reduce(&mut s, parse_line("BATTLECLOSED 9"));
        assert!(!s.battles.contains_key(&9));
    }

    #[test]
    fn hostport_captured_and_reset_on_open() {
        let mut s = LobbyState::new();
        let d = reduce(&mut s, parse_line("HOSTPORT 8452"));
        assert_eq!(s.host_port, Some(8452));
        assert_eq!(d, vec![Delta::HostPort { port: 8452 }]);
        // Opening a fresh battle drops the stale port ahead of the next HOSTPORT.
        reduce(&mut s, parse_line("OPENBATTLE 3"));
        assert_eq!(s.host_port, None);
        assert_eq!(s.current_battle, Some(3));
    }

    #[test]
    fn own_join_sets_current_battle() {
        let mut s = LobbyState::new();
        reduce(
            &mut s,
            parse_line(
                "BATTLEOPENED 4 0 0 alice 1.2.3.4 8452 12 0 0 -1 spring\t105\tMap\tTitle\tBAR",
            ),
        );
        let d = reduce(&mut s, parse_line("JOINBATTLE 4 hash"));
        assert_eq!(s.current_battle, Some(4));
        assert_eq!(s.last_battle, Some(4));
        // The ack must emit its own delta so the UI switches into the battle view
        // without depending on an incidental follow-up message.
        assert_eq!(d, vec![Delta::EnteredBattle { id: 4, own: false }]);
    }

    #[test]
    fn own_open_emits_entered_battle_own() {
        let mut s = LobbyState::new();
        let d = reduce(&mut s, parse_line("OPENBATTLE 3"));
        assert_eq!(s.current_battle, Some(3));
        assert_eq!(d, vec![Delta::EnteredBattle { id: 3, own: true }]);
    }

    #[test]
    fn client_battle_status_updates_member() {
        let mut s = LobbyState::new();
        reduce(
            &mut s,
            parse_line(
                "BATTLEOPENED 4 0 0 alice 1.2.3.4 8452 12 0 0 -1 spring\t105\tMap\tTitle\tBAR",
            ),
        );
        reduce(&mut s, parse_line("JOINBATTLE 4 hash"));
        reduce(&mut s, parse_line("JOINEDBATTLE 4 bob"));
        let bs = BattleStatus {
            ready: true,
            ally: 2,
            ..Default::default()
        };
        let line = format!("CLIENTBATTLESTATUS bob {} 255", bs.to_int());
        let d = reduce(&mut s, parse_line(&line));
        assert_eq!(
            d,
            vec![Delta::MemberStatusChanged {
                battle_id: 4,
                name: "bob".into()
            }]
        );
        let m = &s.battles[&4].members["bob"];
        assert_eq!(m.battle_status, bs);
        assert_eq!(m.team_color, 255);
    }

    #[test]
    fn own_open_seats_founder_and_accepts_own_status_echo() {
        let mut s = LobbyState::new();
        reduce(&mut s, parse_line("ACCEPTED alice"));
        reduce(
            &mut s,
            parse_line(
                "BATTLEOPENED 7 0 0 alice 1.2.3.4 8452 12 0 0 -1 spring\t105\tMap\tTitle\tBAR",
            ),
        );
        reduce(&mut s, parse_line("JOINBATTLE 7 hash"));
        // The server sends no JOINEDBATTLE for the founder, yet we must appear.
        assert!(s.battles[&7].members.contains_key("alice"));
        // Our own status echo must land (find_member_battle can now place us).
        let bs = BattleStatus {
            mode: true,
            ..Default::default()
        };
        let line = format!("CLIENTBATTLESTATUS alice {} 255", bs.to_int());
        reduce(&mut s, parse_line(&line));
        assert_eq!(s.battles[&7].members["alice"].battle_status, bs);
    }

    #[test]
    fn other_battle_open_does_not_seat_us() {
        let mut s = LobbyState::new();
        reduce(&mut s, parse_line("ACCEPTED alice"));
        reduce(
            &mut s,
            parse_line(
                "BATTLEOPENED 8 0 0 bob 1.2.3.4 8452 12 0 0 -1 spring\t105\tMap\tTitle\tBAR",
            ),
        );
        assert!(s.battles[&8].members.is_empty());
    }

    #[test]
    fn chat_message_stored_and_indexed() {
        let mut s = LobbyState::new();
        reduce(&mut s, parse_line("JOIN main"));
        let d = reduce(&mut s, parse_line("SAID main bob hello there"));
        assert_eq!(
            d,
            vec![Delta::ChatMessage {
                channel: Some("main".into()),
                index: 0
            }]
        );
        assert_eq!(s.channels["main"].messages[0].text, "hello there");
    }

    #[test]
    fn reduce_at_stamps_chat_timestamp() {
        let mut s = LobbyState::new();
        reduce_at(&mut s, parse_line("JOIN main"), 111);
        reduce_at(&mut s, parse_line("SAID main bob hello there"), 12345);
        assert_eq!(s.channels["main"].messages[0].at, 12345);
    }

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
        assert_eq!(
            s.channel_directory[0].topic.as_deref(),
            Some("Welcome to main")
        );
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

    #[test]
    fn own_leave_removes_channel() {
        let mut s = LobbyState::new();
        s.my_username = Some("me".into());
        reduce(&mut s, parse_line("JOIN main"));
        assert!(s.channels.contains_key("main"));
        let d = reduce(&mut s, parse_line("LEFT main me"));
        assert_eq!(
            d,
            vec![Delta::ChannelLeft {
                channel: "main".into()
            }]
        );
        assert!(!s.channels.contains_key("main"));
    }

    #[test]
    fn other_user_leave_keeps_channel() {
        let mut s = LobbyState::new();
        s.my_username = Some("me".into());
        reduce(&mut s, parse_line("JOIN main"));
        reduce(&mut s, parse_line("JOINED main bob"));
        let d = reduce(&mut s, parse_line("LEFT main bob"));
        assert!(s.channels.contains_key("main"));
        assert!(!s.channels["main"].users.contains("bob"));
        assert!(matches!(d.as_slice(), [Delta::ChatMessage { .. }]));
    }
}
