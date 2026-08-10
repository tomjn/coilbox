//! Outgoing command builders.
//!
//! Each function returns the wire line WITHOUT a trailing newline — the driving
//! plugin appends `\n`. Argument order is taken from the uberserver `in_*`
//! handlers so the strings match exactly what the server expects.

use std::collections::BTreeMap;

use crate::status::{BattleStatus, ClientStatus};

/// Whether a built line is safe to put on the wire.
///
/// Newline is the protocol's own message delimiter and the writer appends it
/// without inspecting the payload, so a `\n` or `\r` inside an argument is not a
/// malformed command — it is a second command injected after the first. Nothing
/// here escapes: an argument that needs to span lines must be split by the
/// caller into separate commands. Reaching the wire with a break is therefore a
/// caller bug, so the send path rejects rather than silently strips it.
pub fn is_wire_safe(line: &str) -> bool {
    !line.contains(['\n', '\r'])
}

/// `LOGIN <user> <pass> <cpu> <local_ip> <agent>\t<client_id>\t<flags>`.
///
/// `pw_hash` is the already-computed `BASE64(MD5(password))`. `cpu` is fixed at
/// `0`. The final field is tab-structured: `agent\tclient_id\tflags` with flags
/// space-separated.
///
/// `client_id` is the field teiserver reads as the account's lobby hash. It refuses
/// a login that leaves it empty or `0`, so pass a real per-install value.
pub fn login(
    user: &str,
    pw_hash: &str,
    local_ip: &str,
    agent: &str,
    client_id: &str,
    flags: &[&str],
) -> String {
    format!(
        "LOGIN {user} {pw_hash} 0 {local_ip} {agent}\t{client_id}\t{}",
        flags.join(" ")
    )
}

/// `REGISTER <user> <pass> [email]`.
pub fn register(user: &str, pw: &str, email: Option<&str>) -> String {
    match email {
        Some(e) => format!("REGISTER {user} {pw} {e}"),
        None => format!("REGISTER {user} {pw}"),
    }
}

/// `LISTCOMPFLAGS`.
pub fn list_comp_flags() -> String {
    "LISTCOMPFLAGS".to_string()
}

/// `CHANNELS` - request the public channel directory.
pub fn list_channels() -> String {
    "CHANNELS".to_string()
}

/// `PING [token]`.
pub fn ping(token: Option<&str>) -> String {
    match token {
        Some(t) => format!("PING {t}"),
        None => "PING".to_string(),
    }
}

/// `PONG [token]`.
pub fn pong(token: Option<&str>) -> String {
    match token {
        Some(t) => format!("PONG {t}"),
        None => "PONG".to_string(),
    }
}

/// `CONFIRMAGREEMENT [code]`.
pub fn confirm_agreement(code: Option<&str>) -> String {
    match code {
        Some(c) => format!("CONFIRMAGREEMENT {c}"),
        None => "CONFIRMAGREEMENT".to_string(),
    }
}

/// `JOIN <chan> [key]`.
pub fn join_channel(chan: &str, key: Option<&str>) -> String {
    match key {
        Some(k) => format!("JOIN {chan} {k}"),
        None => format!("JOIN {chan}"),
    }
}

/// `LEAVE <chan>`.
pub fn leave_channel(chan: &str) -> String {
    format!("LEAVE {chan}")
}

/// `GETCHANNELMESSAGES <chan> <last_msg_id>` - request the channel's stored
/// backlog, replayed as a burst of `JSON {"SAID":{..}}` frames, oldest first.
///
/// Only valid once joined. `last_msg_id` is a cursor, not a timestamp: `0` cold-
/// starts, otherwise pass the highest id already seen. Channels that don't store
/// history (the default) reply with nothing at all rather than an error.
pub fn get_channel_messages(chan: &str, last_msg_id: u64) -> String {
    format!("GETCHANNELMESSAGES {chan} {last_msg_id}")
}

/// `SAY <chan> <msg>`.
pub fn say(chan: &str, msg: &str) -> String {
    format!("SAY {chan} {msg}")
}

/// `SAYEX <chan> <msg>`.
pub fn say_ex(chan: &str, msg: &str) -> String {
    format!("SAYEX {chan} {msg}")
}

/// `SAYPRIVATE <user> <msg>`.
pub fn say_private(user: &str, msg: &str) -> String {
    format!("SAYPRIVATE {user} {msg}")
}

/// `SAYPRIVATEEX <user> <msg>` — a private action / `/me` message. The server does
/// not echo this to us in a form we parse, so the caller records its own copy.
pub fn say_private_ex(user: &str, msg: &str) -> String {
    format!("SAYPRIVATEEX {user} {msg}")
}

/// `SAYBATTLE <msg>`.
pub fn say_battle(msg: &str) -> String {
    format!("SAYBATTLE {msg}")
}

/// `SAYBATTLEEX <msg>` — a battle-chat action / `/me` message.
pub fn say_battle_ex(msg: &str) -> String {
    format!("SAYBATTLEEX {msg}")
}

/// `JOINBATTLE <id> [key] [scriptPassword]`.
///
/// When a script password is present but no key, uberserver expects `*` in the
/// key slot as a placeholder.
pub fn join_battle(id: u32, key: Option<&str>, script_pw: Option<&str>) -> String {
    match (key, script_pw) {
        (Some(k), Some(sp)) => format!("JOINBATTLE {id} {k} {sp}"),
        (Some(k), None) => format!("JOINBATTLE {id} {k}"),
        (None, Some(sp)) => format!("JOINBATTLE {id} * {sp}"),
        (None, None) => format!("JOINBATTLE {id}"),
    }
}

/// `LEAVEBATTLE`.
pub fn leave_battle() -> String {
    "LEAVEBATTLE".to_string()
}

/// `JOINBATTLEACCEPT <username>` — as host, authorise a pending join. The server
/// prompts us with `JOINBATTLEREQUEST` when a client wants into our battle (and, for
/// NAT battles, carries the client's IP so hole punching can proceed); without this
/// reply the join never completes.
pub fn join_battle_accept(username: &str) -> String {
    format!("JOINBATTLEACCEPT {username}")
}

/// `JOINBATTLEDENY <username> [reason]` — as host, reject a pending join.
pub fn join_battle_deny(username: &str, reason: Option<&str>) -> String {
    match reason {
        Some(r) => format!("JOINBATTLEDENY {username} {r}"),
        None => format!("JOINBATTLEDENY {username}"),
    }
}

/// `MYSTATUS <status_int>`.
pub fn my_status(status: ClientStatus) -> String {
    format!("MYSTATUS {}", status.to_int())
}

/// `MYBATTLESTATUS <battlestatus_int> <teamcolor_int>`.
pub fn my_battle_status(status: BattleStatus, color: u32) -> String {
    format!("MYBATTLESTATUS {} {}", status.to_int(), color)
}

/// `OPENBATTLE <type> <natType> <key> <port> <maxplayers> <modhash> <rank> <maphash> <engine\tversion\tmap\ttitle\tmodname>`.
#[allow(clippy::too_many_arguments)]
pub fn open_battle(
    battle_type: u8,
    nat_type: u8,
    key: &str,
    port: u16,
    max_players: u32,
    modhash: i32,
    rank: u8,
    maphash: i32,
    engine: &str,
    version: &str,
    map: &str,
    title: &str,
    modname: &str,
) -> String {
    format!(
        "OPENBATTLE {battle_type} {nat_type} {key} {port} {max_players} {modhash} {rank} {maphash} {engine}\t{version}\t{map}\t{title}\t{modname}"
    )
}

/// `UPDATEBATTLEINFO <spectatorCount> <locked> <maphash> <map>`.
pub fn update_battle_info(spectators: u32, locked: bool, maphash: i32, map: &str) -> String {
    format!(
        "UPDATEBATTLEINFO {spectators} {} {maphash} {map}",
        locked as u8
    )
}

/// `ADDBOT <name> <battlestatus_int> <teamcolor_int> <aidll>`.
pub fn add_bot(name: &str, battle_status: BattleStatus, color: u32, ai_dll: &str) -> String {
    format!("ADDBOT {name} {} {color} {ai_dll}", battle_status.to_int())
}

/// `UPDATEBOT <name> <battlestatus_int> <teamcolor_int>`.
pub fn update_bot(name: &str, battle_status: BattleStatus, color: u32) -> String {
    format!("UPDATEBOT {name} {} {color}", battle_status.to_int())
}

/// `REMOVEBOT <name>`.
pub fn remove_bot(name: &str) -> String {
    format!("REMOVEBOT {name}")
}

/// `FORCETEAMNO <user> <team>`.
pub fn force_team_no(user: &str, team: u8) -> String {
    format!("FORCETEAMNO {user} {team}")
}

/// `FORCEALLYNO <user> <ally>`.
pub fn force_ally_no(user: &str, ally: u8) -> String {
    format!("FORCEALLYNO {user} {ally}")
}

/// `FORCETEAMCOLOR <user> <color_int>`.
pub fn force_team_color(user: &str, color: u32) -> String {
    format!("FORCETEAMCOLOR {user} {color}")
}

/// `FORCESPECTATORMODE <user>`.
pub fn force_spectator_mode(user: &str) -> String {
    format!("FORCESPECTATORMODE {user}")
}

/// `KICKFROMBATTLE <user>`.
pub fn kick_from_battle(user: &str) -> String {
    format!("KICKFROMBATTLE {user}")
}

/// `ADDSTARTRECT <ally> <left> <top> <right> <bottom>`.
pub fn add_start_rect(ally: u8, left: i32, top: i32, right: i32, bottom: i32) -> String {
    format!("ADDSTARTRECT {ally} {left} {top} {right} {bottom}")
}

/// `REMOVESTARTRECT <ally>`.
pub fn remove_start_rect(ally: u8) -> String {
    format!("REMOVESTARTRECT {ally}")
}

/// `SETSCRIPTTAGS <key=val\tkey=val...>`.
pub fn set_script_tags(tags: &BTreeMap<String, String>) -> String {
    let body = tags
        .iter()
        .map(|(k, v)| format!("{k}={v}"))
        .collect::<Vec<_>>()
        .join("\t");
    format!("SETSCRIPTTAGS {body}")
}

/// `REMOVESCRIPTTAGS <space-sep tags>`.
pub fn remove_script_tags(tags: &[&str]) -> String {
    format!("REMOVESCRIPTTAGS {}", tags.join(" "))
}

/// `FRIENDREQUEST userName=<user>[\tmsg=<msg>]` — send a friend request.
pub fn friend_request(user: &str, msg: Option<&str>) -> String {
    match msg {
        Some(m) => format!("FRIENDREQUEST userName={user}\tmsg={m}"),
        None => format!("FRIENDREQUEST userName={user}"),
    }
}

/// `ACCEPTFRIENDREQUEST userName=<user>` — accept an incoming friend request.
pub fn accept_friend_request(user: &str) -> String {
    format!("ACCEPTFRIENDREQUEST userName={user}")
}

/// `DECLINEFRIENDREQUEST userName=<user>` — decline an incoming friend request.
pub fn decline_friend_request(user: &str) -> String {
    format!("DECLINEFRIENDREQUEST userName={user}")
}

/// `UNFRIEND userName=<user>` — remove an existing friendship.
pub fn unfriend(user: &str) -> String {
    format!("UNFRIEND userName={user}")
}

/// `FRIENDLIST` — request the mutual-friend list.
pub fn friend_list() -> String {
    "FRIENDLIST".to_string()
}

/// `FRIENDREQUESTLIST` — request the pending incoming friend requests.
pub fn friend_request_list() -> String {
    "FRIENDREQUESTLIST".to_string()
}

/// `STLS` — request the TLS upgrade. The actual upgrade is done by the plugin.
pub fn stls() -> String {
    "STLS".to_string()
}

/// `EXIT [reason]`.
pub fn exit(reason: Option<&str>) -> String {
    match reason {
        Some(r) => format!("EXIT {r}"),
        None => "EXIT".to_string(),
    }
}

/// `IGNORE userName=<name>[\treason=<reason>]` — ask the server to stop relaying a
/// user's chat/rings to us. Tags are tab-separated `key=value`.
pub fn ignore(user: &str, reason: Option<&str>) -> String {
    match reason {
        Some(r) => format!("IGNORE userName={user}\treason={r}"),
        None => format!("IGNORE userName={user}"),
    }
}

/// `UNIGNORE userName=<name>` — undo a server-side ignore.
pub fn unignore(user: &str) -> String {
    format!("UNIGNORE userName={user}")
}

/// `IGNORELIST` — request the server's stored ignore list (streams as
/// `IGNORELISTBEGIN` / `IGNORELIST ...` / `IGNORELISTEND`).
pub fn ignore_list() -> String {
    "IGNORELIST".to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::status::default_battle_status;

    #[test]
    fn login_line() {
        let l = login(
            "alice",
            "aGFzaA==",
            "192.168.0.5",
            "Coilbox 0.1",
            "7654321",
            &["u", "sp", "b"],
        );
        assert_eq!(
            l,
            "LOGIN alice aGFzaA== 0 192.168.0.5 Coilbox 0.1\t7654321\tu sp b"
        );
    }

    #[test]
    fn register_with_and_without_email() {
        assert_eq!(register("bob", "hash", None), "REGISTER bob hash");
        assert_eq!(
            register("bob", "hash", Some("bob@example.com")),
            "REGISTER bob hash bob@example.com"
        );
    }

    #[test]
    fn join_battle_variants() {
        assert_eq!(join_battle(3, None, None), "JOINBATTLE 3");
        assert_eq!(join_battle(3, Some("pw"), None), "JOINBATTLE 3 pw");
        assert_eq!(join_battle(3, None, Some("sp")), "JOINBATTLE 3 * sp");
        assert_eq!(join_battle(3, Some("pw"), Some("sp")), "JOINBATTLE 3 pw sp");
    }

    #[test]
    fn join_battle_accept_deny() {
        assert_eq!(join_battle_accept("carol"), "JOINBATTLEACCEPT carol");
        assert_eq!(join_battle_deny("carol", None), "JOINBATTLEDENY carol");
        assert_eq!(
            join_battle_deny("carol", Some("full")),
            "JOINBATTLEDENY carol full"
        );
    }

    #[test]
    fn my_battle_status_line() {
        let l = my_battle_status(default_battle_status(), 255);
        let expected = format!("MYBATTLESTATUS {} 255", default_battle_status().to_int());
        assert_eq!(l, expected);
    }

    #[test]
    fn open_battle_tab_block() {
        let l = open_battle(
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
            l,
            "OPENBATTLE 0 0 * 8452 16 -1 0 -1 spring\t105\tMap\tTitle Here\tBAR"
        );
    }

    #[test]
    fn set_script_tags_sorted() {
        let mut m = BTreeMap::new();
        m.insert("game/b".to_string(), "2".to_string());
        m.insert("game/a".to_string(), "1".to_string());
        assert_eq!(set_script_tags(&m), "SETSCRIPTTAGS game/a=1\tgame/b=2");
    }

    #[test]
    fn remove_script_tags_line() {
        assert_eq!(
            remove_script_tags(&["game/a", "game/b"]),
            "REMOVESCRIPTTAGS game/a game/b"
        );
    }

    #[test]
    fn update_battle_info_line() {
        assert_eq!(
            update_battle_info(2, true, -1, "SomeMap"),
            "UPDATEBATTLEINFO 2 1 -1 SomeMap"
        );
    }

    #[test]
    fn list_channels_line() {
        assert_eq!(list_channels(), "CHANNELS");
    }

    #[test]
    fn friend_command_lines() {
        assert_eq!(friend_request("bob", None), "FRIENDREQUEST userName=bob");
        assert_eq!(
            friend_request("bob", Some("hi there")),
            "FRIENDREQUEST userName=bob\tmsg=hi there"
        );
        assert_eq!(
            accept_friend_request("bob"),
            "ACCEPTFRIENDREQUEST userName=bob"
        );
        assert_eq!(
            decline_friend_request("bob"),
            "DECLINEFRIENDREQUEST userName=bob"
        );
        assert_eq!(unfriend("bob"), "UNFRIEND userName=bob");
        assert_eq!(friend_list(), "FRIENDLIST");
        assert_eq!(friend_request_list(), "FRIENDREQUESTLIST");
    }

    #[test]
    fn simple_builders() {
        assert_eq!(list_comp_flags(), "LISTCOMPFLAGS");
        assert_eq!(leave_battle(), "LEAVEBATTLE");
        assert_eq!(stls(), "STLS");
        assert_eq!(ping(None), "PING");
        assert_eq!(pong(Some("t")), "PONG t");
        assert_eq!(exit(None), "EXIT");
        assert_eq!(exit(Some("bye")), "EXIT bye");
        assert_eq!(say("main", "hi there"), "SAY main hi there");
        assert_eq!(force_team_color("bob", 255), "FORCETEAMCOLOR bob 255");
        assert_eq!(get_channel_messages("main", 0), "GETCHANNELMESSAGES main 0");
        assert_eq!(
            get_channel_messages("main", 42),
            "GETCHANNELMESSAGES main 42"
        );
    }

    #[test]
    fn action_builders() {
        assert_eq!(say_ex("main", "waves"), "SAYEX main waves");
        assert_eq!(say_private_ex("bob", "waves"), "SAYPRIVATEEX bob waves");
        assert_eq!(say_battle_ex("waves"), "SAYBATTLEEX waves");
    }

    #[test]
    fn say_builders() {
        assert_eq!(say("main", "hi"), "SAY main hi");
        assert_eq!(say_private("bob", "hi"), "SAYPRIVATE bob hi");
        assert_eq!(say_battle("hi"), "SAYBATTLE hi");
        // The body is passed through verbatim: it is the last argument, so
        // spaces in it are part of the message and need no quoting.
        assert_eq!(say("main", "a  b\tc"), "SAY main a  b\tc");
    }

    #[test]
    fn wire_safety_rejects_line_breaks() {
        assert!(is_wire_safe(&say("main", "hi there")));
        assert!(is_wire_safe(""));
        // Each of these builds a line that would arrive as two commands.
        assert!(!is_wire_safe(&say("main", "hi\nSAY other pwned")));
        assert!(!is_wire_safe(&say_private("bob", "a\rb")));
        assert!(!is_wire_safe(&say_battle("a\r\nb")));
        assert!(!is_wire_safe(&say_ex("main", "waves\nx")));
        assert!(!is_wire_safe(&say_private_ex("bob", "waves\nx")));
        assert!(!is_wire_safe(&say_battle_ex("waves\nx")));
        // Not chat-specific: any argument can carry a break.
        assert!(!is_wire_safe(&join_channel("main", Some("k\ney"))));
    }

    #[test]
    fn ignore_builders() {
        assert_eq!(ignore("bob", None), "IGNORE userName=bob");
        assert_eq!(
            ignore("bob", Some("spammer")),
            "IGNORE userName=bob\treason=spammer"
        );
        assert_eq!(unignore("bob"), "UNIGNORE userName=bob");
        assert_eq!(ignore_list(), "IGNORELIST");
    }
}
