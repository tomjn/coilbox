//! The pure state reducer.
//!
//! [`reduce`] applies one [`ServerMessage`] to a [`LobbyState`], mutating it in
//! place and returning the [`Delta`]s the frontend should react to. It performs
//! NO side effects: things like ringing, notifications and launching are
//! represented as [`Delta`] variants for the driving plugin to act on.

use crate::message::ServerMessage;
use crate::state::{
    Battle, Bot, ChannelState, ChatKind, ChatMsg, DirChannel, LobbyState, MemberStatus, StartRect,
    User, Vote,
};
use crate::status::{BattleStatus, ClientStatus};
use crate::vote::{parse_vote_line, VoteLine};
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
    /// A channel's founder/operators were (re)learned from a ChanServ `:info`
    /// reply. The snapshot carries the new `founder`/`operators`; this just
    /// signals the UI to re-read them (e.g. to gate moderation controls).
    ChannelOpsChanged {
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
    /// One line of the server's message-of-the-day, sent as a run of `MOTD`
    /// lines right after login. Carries the line verbatim so the frontend can
    /// log the welcome/news the server greets every client with.
    Motd {
        line: String,
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
    /// The server confirmed a user is now ignored (its `IGNORE` ack).
    Ignored {
        name: String,
    },
    /// The server confirmed a user is no longer ignored (its `UNIGNORE` ack).
    Unignored {
        name: String,
    },
    /// The server's `IGNORELIST` finished streaming; carries the full confirmed set
    /// so the frontend can reconcile it against the local ignore list in one shot.
    ServerIgnoreList {
        ignores: Vec<String>,
    },
    /// The mutual-friend set changed (`FRIEND`/`UNFRIEND`, or a `FRIENDLIST` rebuild).
    FriendsChanged,
    /// The incoming friend-request set changed (`FRIENDREQUEST`, an accept clearing
    /// one, or a `FRIENDREQUESTLIST` rebuild).
    FriendRequestsChanged,
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
                    id: None,
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
                    id: None,
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
                id: None,
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
                id: None,
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
                id: None,
            },
        ),
        // Channel backlog replayed by GETCHANNELMESSAGES. Appending is correct
        // without sorting: the server sends the burst oldest-first in answer to
        // our request right after JOIN, so it lands ahead of any live chat.
        // Unlike live chat, `at` is the server's send time, not our receive time.
        ServerMessage::JsonSaid {
            channel,
            username,
            message,
            ex_msg,
            id,
            at_ms,
        } => push_chat(
            state,
            &channel,
            ChatMsg {
                channel: Some(channel.clone()),
                from: username,
                text: message,
                kind: if ex_msg {
                    ChatKind::SaidEx
                } else {
                    ChatKind::Said
                },
                at: at_ms,
                id: Some(id),
            },
        ),
        ServerMessage::SaidPrivate { username, message } => {
            // Some servers echo our own SAYPRIVATE back to us; we already recorded that
            // copy locally when sending, so drop the echo.
            if state.my_username.as_deref() == Some(username.as_str()) {
                return vec![];
            }
            // ChanServ answers our `:info <chan>` query with a one-line channel report.
            // Fold it into the channel's founder/operators (used to gate the moderation
            // controls) and suppress the line — it's machine-directed, not chat.
            if username == "ChanServ" {
                if let Some((channel, founder, operators)) = parse_chanserv_info(&message) {
                    if let Some(ch) = state.channels.get_mut(&channel) {
                        ch.founder = founder;
                        ch.operators = operators;
                        return vec![Delta::ChannelOpsChanged { channel }];
                    }
                    // Reply for a channel we're not tracking — still swallow the noise.
                    return vec![];
                }
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
                    id: None,
                },
            )
        }
        ServerMessage::SaidPrivateEx { username, message } => {
            // Private action / `/me`. Same self-echo guard as SaidPrivate: our own
            // outbound action is recorded locally on send.
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
                    kind: ChatKind::SaidEx,
                    at: now_ms,
                    id: None,
                },
            )
        }
        ServerMessage::SaidBattle { username, message } => {
            reduce_battle_chat(state, username, message, ChatKind::SaidBattle, now_ms)
        }
        ServerMessage::SaidBattleEx { username, message } => {
            reduce_battle_chat(state, username, message, ChatKind::SaidEx, now_ms)
        }
        ServerMessage::BattleOpened {
            id,
            battle_type: _,
            nat_type,
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
            // The founder is implicitly a member of their battle, but the server
            // sends no JOINEDBATTLE for them, so seed the member here — for any
            // founder, not just us. Without this a battle's host (typically an
            // autohost bot) never appears in its own roster and its
            // CLIENTBATTLESTATUS is dropped (find_member_battle can't place a
            // member that isn't in any battle yet).
            let mut battle = Battle {
                id,
                host,
                ip,
                port,
                nat_type,
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
            battle
                .members
                .insert(battle.host.clone(), MemberStatus::default());
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
                        id: None,
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
                state.current_vote = None;
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
                state.current_vote = None;
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
            // Own-join acknowledgement: signal the UI to switch into the battle view
            // off this delta rather than waiting for an incidental follow-up message.
            state.current_battle = Some(id);
            state.last_battle = Some(id);
            state.current_vote = None;
            vec![Delta::EnteredBattle { id, own: false }]
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
            state.current_vote = None;
            // A fresh host port arrives via HOSTPORT right after this ack; drop any
            // stale one from a previous host session.
            state.host_port = None;
            vec![Delta::EnteredBattle { id, own: true }]
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
        ServerMessage::Motd { line } => {
            vec![Delta::Motd { line }]
        }
        ServerMessage::Ignore { username, .. } => {
            state.server_ignores.insert(username.clone());
            vec![Delta::Ignored { name: username }]
        }
        ServerMessage::Unignore { username } => {
            state.server_ignores.remove(&username);
            vec![Delta::Unignored { name: username }]
        }
        ServerMessage::IgnoreListBegin => {
            // The server is about to (re)send the whole list; clear so removed
            // entries don't linger while the fresh set streams in.
            state.server_ignores.clear();
            vec![]
        }
        ServerMessage::IgnoreListEntry { username, .. } => {
            state.server_ignores.insert(username);
            vec![]
        }
        ServerMessage::IgnoreListEnd => {
            let ignores = state.server_ignores.iter().cloned().collect();
            vec![Delta::ServerIgnoreList { ignores }]
        }
        ServerMessage::Friend { username } => {
            // A friendship established: promote out of any pending request.
            let had_request = state.friend_requests.remove(&username);
            state.friends.insert(username);
            let mut deltas = vec![Delta::FriendsChanged];
            if had_request {
                deltas.push(Delta::FriendRequestsChanged);
            }
            deltas
        }
        ServerMessage::Unfriend { username } => {
            state.friends.remove(&username);
            vec![Delta::FriendsChanged]
        }
        ServerMessage::FriendRequest { username, msg: _ } => {
            state.friend_requests.insert(username);
            vec![Delta::FriendRequestsChanged]
        }
        // FRIENDLIST framing rebuilds the friend set: clear on begin, add each
        // entry live (mirrors the CHANNELS directory rebuild), signal on end.
        ServerMessage::FriendListBegin => {
            state.friends.clear();
            vec![]
        }
        ServerMessage::FriendListEntry { username } => {
            state.friends.insert(username);
            vec![]
        }
        ServerMessage::FriendListEnd => vec![Delta::FriendsChanged],
        ServerMessage::FriendRequestListBegin => {
            state.friend_requests.clear();
            vec![]
        }
        ServerMessage::FriendRequestListEntry { username, msg: _ } => {
            state.friend_requests.insert(username);
            vec![]
        }
        ServerMessage::FriendRequestListEnd => vec![Delta::FriendRequestsChanged],
        // Messages carrying no state change / handled by the login machine.
        ServerMessage::TasServer { .. }
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
/// Parse a ChanServ `:info` reply into `(channel-without-#, founder, operators)`.
///
/// The reply is one human-readable line in a fixed field order, e.g.
///   `#lobby info: Founder is <alice>. Operator list is [bob carol]. Currently
///    contains 3 users and 0 bridged users. Anti-spam ... . Channel history ... .`
/// Founder may read `No founder is registered`; the operator list `empty`. The
/// server's bracket formatting is buggy for multiple operators (it can emit
/// `[bob] carol]`), so we take the whole clause up to the users count, strip all
/// brackets, and split on whitespace — robust to both the clean and buggy forms.
/// Returns `None` when the text isn't a recognizable info reply.
fn parse_chanserv_info(
    message: &str,
) -> Option<(String, Option<String>, std::collections::HashSet<String>)> {
    let rest = message.strip_prefix('#')?;
    let idx = rest.find(" info:")?;
    let channel = rest[..idx].to_string();
    if channel.is_empty() {
        return None;
    }
    let body = &rest[idx + " info:".len()..];
    // `Founder is <name>` -> Some(name); "No founder is registered" (or anything
    // without the marker) -> None.
    let founder = body.find("Founder is <").and_then(|p| {
        let after = &body[p + "Founder is <".len()..];
        after.find('>').map(|e| after[..e].to_string())
    });
    // The operator clause runs from "Operator list is " to the users count that
    // always follows it. Strip brackets, split, and drop the literal `empty`.
    let operators = body
        .find("Operator list is ")
        .map(|p| {
            let s = &body[p + "Operator list is ".len()..];
            let clause = match s.find(". Currently contains") {
                Some(e) => &s[..e],
                None => s,
            };
            clause
                .replace(['[', ']'], " ")
                .split_whitespace()
                .filter(|t| *t != "empty")
                .map(str::to_string)
                .collect::<std::collections::HashSet<String>>()
        })
        .unwrap_or_default();
    Some((channel, founder, operators))
}

/// Append a message to a channel's log, creating the channel bucket if it is not
/// there, and emit the delta naming where it landed.
///
/// Public because Tachyon has no channels and no `SAID` echo, so
/// `tauri-plugin-coilbox-multiplayer` puts lobby chat into the joined battle's
/// synthetic bucket itself rather than through a line.
pub fn push_chat(state: &mut LobbyState, channel: &str, msg: ChatMsg) -> Vec<Delta> {
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
///
/// Public for the same reason as [`push_chat`]: a Tachyon direct message arrives
/// as a `messaging/received` event rather than as a line, so the plugin files it
/// into the thread itself.
pub fn push_dm(state: &mut LobbyState, peer: &str, msg: ChatMsg) -> Vec<Delta> {
    state.dms.entry(peer.to_string()).or_default().push(msg);
    vec![Delta::PrivateMessage {
        from: peer.to_string(),
    }]
}

/// Record a private message WE sent to `peer`. The server does not echo
/// `SAYPRIVATE`/`SAYPRIVATEEX` back to us in a form we parse, so the plugin calls
/// this so the sent line appears in the thread. `kind` is `Private` for a normal
/// message or `SaidEx` for a `/me` action. `from` is our own username (falls back
/// to empty if not yet logged in).
pub fn record_outgoing_private(
    state: &mut LobbyState,
    peer: &str,
    text: &str,
    kind: ChatKind,
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
            kind,
            at: now_ms,
            id: None,
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
    // SPADS runs `!`-command votes as battle chat from the autohost. Recognise
    // those lines while we're in a battle and fold them into `current_vote` so the
    // room can show a one-click vote panel. Accept them from the battle's host (the
    // autohost) or a bot-flagged sender — a human parroting the line still can't
    // spoof a panel. Gating on the host identity (not the bot flag alone) matters
    // because not every lobby server flags its autohost account as a bot, yet the
    // vote lines always come from the host; unrecognised lines leave the vote
    // untouched, so chat is never disturbed.
    if let Some(battle_id) = state.current_battle {
        let is_host = state
            .battles
            .get(&battle_id)
            .is_some_and(|b| b.host == username);
        let from_bot = state.users.get(&username).is_some_and(|u| u.status.bot);
        if is_host || from_bot {
            if let Some(line) = parse_vote_line(&message) {
                apply_vote_line(state, line, now_ms);
            }
        }
    }
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
                id: None,
            },
        ),
        None => vec![Delta::ChatMessage {
            channel: None,
            index: 0,
        }],
    }
}

/// Fold one recognised SPADS vote line into `state.current_vote`. A start line
/// opens a fresh vote (SPADS seeds the caller's own yes, so yes starts at 1); a
/// progress line updates the tally and deadline (synthesising a vote if we joined
/// mid-vote and missed the start); a terminal line clears it.
fn apply_vote_line(state: &mut LobbyState, line: VoteLine, now_ms: u64) {
    match line {
        VoteLine::Start {
            caller,
            subject,
            allow_abstain,
        } => {
            state.current_vote = Some(Vote {
                subject,
                caller,
                allow_abstain,
                yes: 1,
                no: 0,
                yes_needed: 0,
                no_needed: 0,
                ends_at: 0,
            });
        }
        VoteLine::Progress {
            subject,
            yes,
            yes_needed,
            no,
            no_needed,
            remaining_secs,
        } => {
            // now_ms is 0 when the reducer runs without a clock (tests via `reduce`);
            // leave the deadline unset then rather than inventing one from epoch 0.
            let ends_at = if now_ms > 0 {
                now_ms + remaining_secs * 1000
            } else {
                0
            };
            match state.current_vote.as_mut() {
                Some(v) => {
                    v.subject = subject;
                    v.yes = yes;
                    v.yes_needed = yes_needed;
                    v.no = no;
                    v.no_needed = no_needed;
                    v.ends_at = ends_at;
                }
                None => {
                    state.current_vote = Some(Vote {
                        subject,
                        caller: String::new(),
                        // We missed the start line, so we can't know if abstain was
                        // advertised; assume it was (the SPADS default) rather than
                        // hide a valid option.
                        allow_abstain: true,
                        yes,
                        no,
                        yes_needed,
                        no_needed,
                        ends_at,
                    });
                }
            }
        }
        VoteLine::End { .. } => {
            state.current_vote = None;
        }
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
    fn parses_clean_chanserv_info() {
        let (chan, founder, ops) = parse_chanserv_info(
            "#lobby info: Founder is <alice>. Operator list is [bob carol]. \
             Currently contains 3 users and 0 bridged users. Anti-spam protection is off. \
             Channel history is off. Last used on Jul 12, 2026.",
        )
        .expect("should parse");
        assert_eq!(chan, "lobby");
        assert_eq!(founder.as_deref(), Some("alice"));
        assert_eq!(
            ops,
            ["bob", "carol"].into_iter().map(String::from).collect()
        );
    }

    #[test]
    fn parses_buggy_multi_operator_bracket() {
        // The reference server mis-closes the bracket after the first operator:
        // `[bob] carol]`. We must still recover both names.
        let (_, _, ops) = parse_chanserv_info(
            "#lobby info: Founder is <alice>. Operator list is [bob] carol]. \
             Currently contains 1 users and 0 bridged users. Anti-spam protection is on. \
             Channel history is on. Last used on Jul 12, 2026.",
        )
        .expect("should parse");
        assert_eq!(
            ops,
            ["bob", "carol"].into_iter().map(String::from).collect()
        );
    }

    #[test]
    fn parses_chanserv_info_without_founder_or_ops() {
        let (chan, founder, ops) = parse_chanserv_info(
            "#games info: No founder is registered. Operator list is empty. \
             Currently contains 0 users and 0 bridged users.",
        )
        .expect("should parse");
        assert_eq!(chan, "games");
        assert_eq!(founder, None);
        assert!(ops.is_empty());
    }

    #[test]
    fn ignores_non_info_chanserv_text() {
        assert!(parse_chanserv_info("Channel #foo is not registered").is_none());
        assert!(parse_chanserv_info("hello there").is_none());
    }

    #[test]
    fn chanserv_info_updates_channel_ops_and_is_suppressed() {
        let mut s = LobbyState::new();
        reduce(&mut s, parse_line("ACCEPTED me"));
        reduce(&mut s, parse_line("JOIN lobby"));
        let before = s.channels["lobby"].messages.len();
        let d = reduce(
            &mut s,
            parse_line(
                "SAIDPRIVATE ChanServ #lobby info: Founder is <alice>. \
                 Operator list is [bob]. Currently contains 2 users and 0 bridged users.",
            ),
        );
        assert_eq!(
            d,
            vec![Delta::ChannelOpsChanged {
                channel: "lobby".into()
            }]
        );
        let ch = &s.channels["lobby"];
        assert_eq!(ch.founder.as_deref(), Some("alice"));
        assert!(ch.operators.contains("bob"));
        // The info line must NOT appear as a ChanServ DM.
        assert_eq!(ch.messages.len(), before);
        assert!(!s.dms.contains_key("ChanServ"));
    }

    #[test]
    fn ordinary_chanserv_dm_is_still_recorded() {
        let mut s = LobbyState::new();
        reduce(&mut s, parse_line("ACCEPTED me"));
        let d = reduce(
            &mut s,
            parse_line("SAIDPRIVATE ChanServ Opped bob in #lobby"),
        );
        assert!(matches!(d.as_slice(), [Delta::PrivateMessage { .. }]));
        assert!(s.dms.contains_key("ChanServ"));
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
    fn motd_line_emits_delta() {
        let mut s = LobbyState::new();
        let d = reduce(&mut s, parse_line("MOTD Welcome to the server"));
        assert_eq!(
            d,
            vec![Delta::Motd {
                line: "Welcome to the server".into(),
            }]
        );
        // A blank MOTD line (servers pad the block with empties) still round-trips
        // so the frontend can preserve the spacing.
        let blank = reduce(&mut s, parse_line("MOTD"));
        assert_eq!(
            blank,
            vec![Delta::Motd {
                line: String::new()
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
    fn battle_keeps_the_hosts_declared_nat_type() {
        let mut s = LobbyState::new();
        reduce(
            &mut s,
            parse_line(
                "BATTLEOPENED 9 0 1 alice 1.2.3.4 8452 12 0 0 -1 spring\t105\tMap\tTitle\tBAR",
            ),
        );
        // Field 3, between the battle type and the founder. A joiner needs it to
        // know the host expects hole punching rather than a direct connection.
        assert_eq!(s.battles.get(&9).unwrap().nat_type, "1");
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
    fn other_battle_open_seats_its_founder_only() {
        let mut s = LobbyState::new();
        reduce(&mut s, parse_line("ACCEPTED alice"));
        reduce(
            &mut s,
            parse_line(
                "BATTLEOPENED 8 0 0 bob 1.2.3.4 8452 12 0 0 -1 spring\t105\tMap\tTitle\tBAR",
            ),
        );
        assert_eq!(s.battles[&8].members.keys().collect::<Vec<_>>(), ["bob"]);

        // The founder's status echo must land too — an autohost that takes a slot
        // (rather than spectating) has to render correctly.
        let bs = BattleStatus {
            mode: true,
            ..Default::default()
        };
        let line = format!("CLIENTBATTLESTATUS bob {} 255", bs.to_int());
        reduce(&mut s, parse_line(&line));
        assert_eq!(s.battles[&8].members["bob"].battle_status, bs);
    }

    #[test]
    fn joinedbattle_for_a_seated_founder_is_idempotent() {
        let mut s = LobbyState::new();
        reduce(&mut s, parse_line("ACCEPTED alice"));
        reduce(
            &mut s,
            parse_line(
                "BATTLEOPENED 8 0 0 bob 1.2.3.4 8452 12 0 0 -1 spring\t105\tMap\tTitle\tBAR",
            ),
        );
        reduce(&mut s, parse_line("JOINEDBATTLE 8 bob"));
        assert_eq!(s.battles[&8].members.keys().collect::<Vec<_>>(), ["bob"]);
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
    fn friend_request_then_accept_moves_to_friends() {
        let mut s = LobbyState::new();
        let d = reduce(&mut s, parse_line("FRIENDREQUEST userName=bob"));
        assert_eq!(d, vec![Delta::FriendRequestsChanged]);
        assert!(s.friend_requests.contains("bob"));
        // FRIEND establishes the friendship and clears the pending request.
        let d = reduce(&mut s, parse_line("FRIEND userName=bob"));
        assert_eq!(d, vec![Delta::FriendsChanged, Delta::FriendRequestsChanged]);
        assert!(s.friends.contains("bob"));
        assert!(!s.friend_requests.contains("bob"));
    }

    #[test]
    fn unfriend_removes_friend() {
        let mut s = LobbyState::new();
        reduce(&mut s, parse_line("FRIEND userName=bob"));
        assert!(s.friends.contains("bob"));
        let d = reduce(&mut s, parse_line("UNFRIEND userName=bob"));
        assert_eq!(d, vec![Delta::FriendsChanged]);
        assert!(!s.friends.contains("bob"));
    }

    #[test]
    fn friend_list_framing_rebuilds_friends() {
        let mut s = LobbyState::new();
        // A stale friend must be dropped by the rebuild.
        s.friends.insert("stale".into());
        reduce(&mut s, parse_line("FRIENDLISTBEGIN"));
        assert!(s.friends.is_empty());
        reduce(&mut s, parse_line("FRIENDLIST userName=alice"));
        reduce(&mut s, parse_line("FRIENDLIST userName=bob"));
        let d = reduce(&mut s, parse_line("FRIENDLISTEND"));
        assert_eq!(d, vec![Delta::FriendsChanged]);
        assert!(s.friends.contains("alice"));
        assert!(s.friends.contains("bob"));
        assert!(!s.friends.contains("stale"));
    }

    #[test]
    fn friend_request_list_framing_rebuilds_requests() {
        let mut s = LobbyState::new();
        s.friend_requests.insert("stale".into());
        reduce(&mut s, parse_line("FRIENDREQUESTLISTBEGIN"));
        assert!(s.friend_requests.is_empty());
        reduce(&mut s, parse_line("FRIENDREQUESTLIST userName=carol"));
        let d = reduce(&mut s, parse_line("FRIENDREQUESTLISTEND"));
        assert_eq!(d, vec![Delta::FriendRequestsChanged]);
        assert!(s.friend_requests.contains("carol"));
        assert!(!s.friend_requests.contains("stale"));
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
        let d = record_outgoing_private(&mut s, "bob", "yo bob", ChatKind::Private, 777);
        assert_eq!(d, vec![Delta::PrivateMessage { from: "bob".into() }]);
        let thread = &s.dms["bob"];
        assert_eq!(thread.len(), 1);
        assert_eq!(thread[0].from, "me");
        assert_eq!(thread[0].text, "yo bob");
        assert_eq!(thread[0].kind, ChatKind::Private);
        assert_eq!(thread[0].at, 777);
    }

    #[test]
    fn outgoing_private_action_recorded_as_emote() {
        let mut s = LobbyState::new();
        s.my_username = Some("me".into());
        let d = record_outgoing_private(&mut s, "bob", "waves", ChatKind::SaidEx, 777);
        assert_eq!(d, vec![Delta::PrivateMessage { from: "bob".into() }]);
        let thread = &s.dms["bob"];
        assert_eq!(thread[0].from, "me");
        assert_eq!(thread[0].text, "waves");
        assert_eq!(thread[0].kind, ChatKind::SaidEx);
    }

    #[test]
    fn incoming_private_action_stored_as_emote() {
        let mut s = LobbyState::new();
        s.my_username = Some("me".into());
        let d = reduce_at(&mut s, parse_line("SAIDPRIVATEEX bob waves at you"), 500);
        assert_eq!(d, vec![Delta::PrivateMessage { from: "bob".into() }]);
        let thread = &s.dms["bob"];
        assert_eq!(thread.len(), 1);
        assert_eq!(thread[0].from, "bob");
        assert_eq!(thread[0].text, "waves at you");
        assert_eq!(thread[0].kind, ChatKind::SaidEx);
    }

    #[test]
    fn battle_action_stored_as_emote() {
        let mut s = LobbyState::new();
        s.my_username = Some("me".into());
        s.battles.insert(
            1,
            Battle {
                id: 1,
                channel: Some("battlechan".into()),
                ..Default::default()
            },
        );
        s.current_battle = Some(1);
        reduce_at(&mut s, parse_line("SAIDBATTLEEX bob waves"), 500);
        let msgs = &s.channels["battlechan"].messages;
        assert_eq!(msgs.len(), 1);
        assert_eq!(msgs[0].from, "bob");
        assert_eq!(msgs[0].text, "waves");
        assert_eq!(msgs[0].kind, ChatKind::SaidEx);
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

    /// A battle we've joined whose host `bot` is a SPADS autohost, so its battle
    /// chat is recognised as vote traffic.
    fn autohost_battle(bot: &str) -> LobbyState {
        let mut s = LobbyState::new();
        s.my_username = Some("me".into());
        let mut u = User {
            name: bot.into(),
            ..Default::default()
        };
        u.status.bot = true;
        s.users.insert(bot.into(), u);
        s.battles.insert(
            1,
            Battle {
                id: 1,
                host: bot.into(),
                ..Default::default()
            },
        );
        s.current_battle = Some(1);
        s
    }

    #[test]
    fn autohost_vote_start_opens_vote() {
        let mut s = autohost_battle("AutoHost");
        reduce(
            &mut s,
            parse_line(
                "SAIDBATTLE AutoHost Bob called a vote for command \"set map Red Comet\" [!vote y, !vote n, !vote b]",
            ),
        );
        let v = s.current_vote.expect("vote opened");
        assert_eq!(v.subject, "set map Red Comet");
        assert_eq!(v.caller, "Bob");
        assert!(v.allow_abstain);
        assert_eq!(v.yes, 1);
        assert_eq!(v.no, 0);
    }

    #[test]
    fn autohost_vote_progress_updates_tally_and_deadline() {
        let mut s = autohost_battle("AutoHost");
        reduce(
            &mut s,
            parse_line(
                "SAIDBATTLE AutoHost Bob called a vote for command \"set map Red Comet\" [!vote y, !vote n, !vote b]",
            ),
        );
        reduce_at(
            &mut s,
            parse_line(
                "SAIDBATTLE AutoHost Vote in progress: \"set map Red Comet\" [y:2/3, n:1/3] (30s remaining)",
            ),
            10_000,
        );
        let v = s.current_vote.expect("vote still open");
        assert_eq!((v.yes, v.yes_needed, v.no, v.no_needed), (2, 3, 1, 3));
        assert_eq!(v.ends_at, 10_000 + 30_000);
    }

    #[test]
    fn autohost_vote_end_clears_vote() {
        let mut s = autohost_battle("AutoHost");
        reduce(
            &mut s,
            parse_line(
                "SAIDBATTLE AutoHost Bob called a vote for command \"set map Red Comet\" [!vote y, !vote n, !vote b]",
            ),
        );
        assert!(s.current_vote.is_some());
        reduce(
            &mut s,
            parse_line("SAIDBATTLE AutoHost Vote for command \"set map Red Comet\" passed."),
        );
        assert!(s.current_vote.is_none());
    }

    #[test]
    fn non_bot_vote_line_is_ignored() {
        let mut s = autohost_battle("AutoHost");
        // A human parroting the exact line must not spoof a vote panel.
        reduce(
            &mut s,
            parse_line(
                "SAIDBATTLE me Bob called a vote for command \"set map Red Comet\" [!vote y, !vote n, !vote b]",
            ),
        );
        assert!(s.current_vote.is_none());
    }

    #[test]
    fn unflagged_host_vote_line_opens_vote() {
        // Not every lobby server flags its autohost account as a bot, but the vote
        // lines still come from the battle host — recognise them by host identity.
        let mut s = LobbyState::new();
        s.my_username = Some("me".into());
        s.users.insert(
            "AutoHost".into(),
            User {
                name: "AutoHost".into(),
                ..Default::default()
            },
        );
        s.battles.insert(
            1,
            Battle {
                id: 1,
                host: "AutoHost".into(),
                ..Default::default()
            },
        );
        s.current_battle = Some(1);
        reduce(
            &mut s,
            parse_line(
                "SAIDBATTLE AutoHost Bob called a vote for command \"set map Red Comet\" [!vote y, !vote n, !vote b]",
            ),
        );
        let v = s.current_vote.expect("vote opened from unflagged host");
        assert_eq!(v.subject, "set map Red Comet");
        assert_eq!(v.caller, "Bob");
    }

    #[test]
    fn progress_synthesises_vote_when_joined_mid_vote() {
        let mut s = autohost_battle("AutoHost");
        reduce_at(
            &mut s,
            parse_line(
                "SAIDBATTLE AutoHost Vote in progress: \"set map Red Comet\" [y:2/3, n:1/3] (30s remaining)",
            ),
            10_000,
        );
        let v = s.current_vote.expect("vote synthesised from progress");
        assert_eq!(v.subject, "set map Red Comet");
        assert_eq!(v.yes, 2);
        assert!(
            v.allow_abstain,
            "abstain assumed when start line was missed"
        );
    }

    #[test]
    fn ignore_ack_adds_to_server_ignores() {
        let mut s = LobbyState::new();
        let d = reduce(&mut s, parse_line("IGNORE userName=bob"));
        assert!(s.server_ignores.contains("bob"));
        assert_eq!(d, vec![Delta::Ignored { name: "bob".into() }]);
    }

    #[test]
    fn unignore_ack_removes_from_server_ignores() {
        let mut s = LobbyState::new();
        reduce(&mut s, parse_line("IGNORE userName=bob"));
        let d = reduce(&mut s, parse_line("UNIGNORE userName=bob"));
        assert!(!s.server_ignores.contains("bob"));
        assert_eq!(d, vec![Delta::Unignored { name: "bob".into() }]);
    }

    #[test]
    fn ignorelist_rebuilds_server_ignores_and_reports_full_set() {
        let mut s = LobbyState::new();
        // A stale entry present before the list arrives must be cleared by BEGIN.
        s.server_ignores.insert("stale".into());
        reduce(&mut s, parse_line("IGNORELISTBEGIN"));
        assert!(s.server_ignores.is_empty());
        reduce(&mut s, parse_line("IGNORELIST userName=bob\treason=rude"));
        reduce(&mut s, parse_line("IGNORELIST userName=alice"));
        let d = reduce(&mut s, parse_line("IGNORELISTEND"));
        // BTreeSet iterates sorted, so the reported list is deterministic.
        assert_eq!(
            d,
            vec![Delta::ServerIgnoreList {
                ignores: vec!["alice".into(), "bob".into()],
            }]
        );
        assert!(s.server_ignores.contains("bob"));
        assert!(s.server_ignores.contains("alice"));
        assert!(!s.server_ignores.contains("stale"));
    }

    #[test]
    fn leaving_battle_clears_active_vote() {
        let mut s = autohost_battle("AutoHost");
        reduce(
            &mut s,
            parse_line(
                "SAIDBATTLE AutoHost Bob called a vote for command \"set map Red Comet\" [!vote y, !vote n, !vote b]",
            ),
        );
        assert!(s.current_vote.is_some());
        reduce(&mut s, parse_line("LEFTBATTLE 1 me"));
        assert!(s.current_vote.is_none());
    }
}
