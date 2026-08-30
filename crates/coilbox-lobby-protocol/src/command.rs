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

/// Whether a value can be sent in one of a line's space-separated slots.
///
/// A slot ends at the first space, so a value with whitespace in it is not a
/// malformed argument, it is every argument after it moved along one. A room
/// password of "let me in" puts the rest of the password where the port belongs
/// and the port where the player limit belongs, and the battle that opens has a
/// limit of zero, which refuses every joiner as full. Nothing escapes it, so the
/// value has to be refused where it is typed.
pub fn fits_one_field(value: &str) -> bool {
    !value.chars().any(char::is_whitespace)
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

/// The compatibility flag a server names when it has a relay to host battles
/// through, and that a client names to say it understands one.
///
/// It appears in both directions, which is why it lives here rather than in the
/// login machine: the server offers it in its answer to `LISTCOMPFLAGS`, and we
/// echo it back in the `LOGIN` flags to say we can use it.
///
/// The letter is the one proposed in ScarylePoo/uberserver#26, which is open, so
/// no server names it yet. Until one does this reads as "no relay here", which
/// is exactly what a server without a relay means. The direction that must never
/// be got wrong is the other one: uberserver's `_checkCompat` answers a flag it
/// does not know with `MOTD Your client has compatibility errors`, aimed at the
/// person logging in, so the flag is only ever sent to a server that offered it
/// first.
pub const RELAY_COMPAT_FLAG: &str = "r";

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
///
/// Callers should always pass a script password. uberserver takes a bare
/// `JOINBATTLE <id>`, but teiserver only matches the three-field form and answers
/// "No incomming match for JOINBATTLE" to anything shorter.
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

/// `RELAYEDHOST <ip> <port>`, telling the lobby that the battle this client is
/// about to open is reachable at the relay rather than at this machine.
///
/// The lobby works a battle's address out from the host's own connection, which
/// is right for every host that is reachable and wrong for one that is not. A
/// relayed battle lives at a TURN allocation on the relay server, and that
/// address is genuinely public, so a joiner dials it exactly as it dials a
/// direct host. There is nothing for a joining client to understand and nothing
/// for another lobby client to implement. What has to change is the one thing
/// only the host knows: which address to put in `BATTLEOPENED`.
///
/// Sent immediately before `OPENBATTLE`, and only ever after the allocation
/// exists. A lobby that has not seen one of these opens the battle the way it
/// always has.
///
/// The port is here as well as in `OPENBATTLE` so that this line and
/// [`move_relayed_host`] are the same two fields in the same order, and so the
/// server reads a whole address out of either without looking at the battle
/// behind it.
///
/// ScarylePoo/uberserver#32 is the server half, and no server runs it yet. A
/// lobby that does not understand this line ignores it and advertises the
/// battle at the host's own address, which is the broken host relay hosting
/// exists to fix rather than a new failure.
pub fn relayed_host(ip: std::net::IpAddr, port: u16) -> String {
    format!("RELAYEDHOST {ip} {port}")
}

/// `MOVERELAYEDHOST <ip> <port>`, telling the lobby that the battle this client
/// is already hosting now lives somewhere else on the relay.
///
/// The sidecar rebuilds an allocation it has lost and the new one is at a
/// different address, so the battle is advertised where nothing answers. One
/// line moves it, and the room, its players, its chat and its map choice all
/// stay where they are (issue #2031).
///
/// Same two fields as [`relayed_host`], and a separate command rather than a
/// second `RELAYEDHOST` because the server cannot tell the two apart by
/// context. A relay host reopening its battle sends `RELAYEDHOST` while the old
/// battle is still open, and the server reads the staged address in
/// `in_OPENBATTLE` before the `in_LEAVEBATTLE` that closes the old one. Reusing
/// the command would have the server move a battle that is about to be
/// destroyed and then open the replacement at the host's own unreachable
/// address (ScarylePoo/uberserver#43).
///
/// The address is the one the TURN server handed out, never one we hoped for:
/// the only caller is `relay_host::readvertise`, which is reached from an agent
/// event saying the allocation is open.
///
/// Answered with `BATTLEHOSTMOVED` on success, broadcast to everybody watching
/// the battle list, or `MOVERELAYEDHOSTFAILED` on refusal. A lobby that has
/// never heard of it says nothing, and the battle stays advertised at the
/// address that has gone.
pub fn move_relayed_host(ip: std::net::IpAddr, port: u16) -> String {
    format!("MOVERELAYEDHOST {ip} {port}")
}

/// `TURNCREDENTIALS`, asking the lobby to mint a short-lived credential for its
/// relay, so a host nothing can reach can open an allocation on it.
///
/// A TURN server that served anybody would be free bandwidth for the whole
/// internet, so it only serves people the lobby has vouched for. The lobby does
/// the vouching by minting a username and a password the relay can check on its
/// own (ScarylePoo/uberserver#27). Nothing here has to understand how: it asks,
/// it reads the answer, and it passes the answer to the relay agent.
///
/// The command takes no arguments. Who is asking is who is logged in.
pub fn turn_credentials() -> String {
    "TURNCREDENTIALS".to_string()
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

/// The most bytes of payload to put in one `SETSCRIPTTAGS` or `REMOVESCRIPTTAGS`
/// line.
///
/// The TASServer protocol names no line limit and neither does this crate, but
/// SPADS, the autohost every real lobby runs, packs both its script-tag lines to
/// 900 characters and sends as many lines as it takes (`limitLineSize` in
/// `spads.pl`, used for the set list in `sendBattleSettings` and for the removal
/// list in `sendBattleMapOptions`). That is the only length evidence there is, so
/// follow it. It started to matter when a battle began publishing its game's
/// whole option list (#1837): Beyond All Reason declares 177 options, which is
/// 6.7 KB.
pub const SCRIPT_TAG_LINE_BUDGET: usize = 900;

/// Pack `items` into `COMMAND <item><sep><item>...` lines, each carrying at most
/// [`SCRIPT_TAG_LINE_BUDGET`] bytes of payload.
///
/// Empty for no items. A single item wider than the budget goes out alone and
/// over it, because dropping it would silently lose a tag.
fn packed_lines(command: &str, sep: char, items: impl Iterator<Item = String>) -> Vec<String> {
    let mut lines = Vec::new();
    let mut body = String::new();
    for item in items {
        if !body.is_empty() && body.len() + 1 + item.len() > SCRIPT_TAG_LINE_BUDGET {
            lines.push(format!("{command} {body}"));
            body.clear();
        }
        if !body.is_empty() {
            body.push(sep);
        }
        body.push_str(&item);
    }
    if !body.is_empty() {
        lines.push(format!("{command} {body}"));
    }
    lines
}

/// `SETSCRIPTTAGS <key=val\tkey=val...>`, packed into as many lines as
/// [`SCRIPT_TAG_LINE_BUDGET`] takes. A receiver merges each line into the
/// battle's tags, so splitting means the same thing as one long line.
///
/// Empty for no tags. A single pair wider than the budget goes out alone and
/// over it, because dropping it would silently lose an option.
pub fn set_script_tags(tags: &BTreeMap<String, String>) -> Vec<String> {
    packed_lines(
        "SETSCRIPTTAGS",
        '\t',
        tags.iter().map(|(k, v)| format!("{k}={v}")),
    )
}

/// `REMOVESCRIPTTAGS <space-sep tags>`, packed into as many lines as
/// [`SCRIPT_TAG_LINE_BUDGET`] takes. A receiver drops the keys each line names,
/// so splitting means the same thing as one long line.
///
/// Empty for no tags. Bare keys rather than pairs, so a line holds more of them
/// than a `SETSCRIPTTAGS` line does, but cutting a restriction list back removes
/// two tags per unit (#1867) and that outgrows the budget just as fast.
pub fn remove_script_tags(tags: &[&str]) -> Vec<String> {
    packed_lines(
        "REMOVESCRIPTTAGS",
        ' ',
        tags.iter().map(|t| (*t).to_string()),
    )
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

    /// The room password rides in a space-separated slot, so a space in it is
    /// not a bad password, it is a battle built out of the wrong fields.
    #[test]
    fn a_room_password_with_a_space_moves_every_field_after_it() {
        let line = open_battle(
            0,
            0,
            "let me in",
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
        // The port slot now holds the second half of the password, and the
        // player limit holds the port.
        assert!(line.starts_with("OPENBATTLE 0 0 let me in 8452 16"));
        assert!(!fits_one_field("let me in"));
        assert!(fits_one_field("letmein"));
        // The empty key a room with no password sends.
        assert!(fits_one_field("*"));
    }

    #[test]
    fn set_script_tags_sorted() {
        let mut m = BTreeMap::new();
        m.insert("game/b".to_string(), "2".to_string());
        m.insert("game/a".to_string(), "1".to_string());
        assert_eq!(
            set_script_tags(&m),
            vec!["SETSCRIPTTAGS game/a=1\tgame/b=2"]
        );
    }

    #[test]
    fn set_script_tags_says_nothing_about_nothing() {
        assert!(set_script_tags(&BTreeMap::new()).is_empty());
    }

    /// A battle now publishes its game's whole option list (#1837), which for
    /// Beyond All Reason's 177 options is 6.7 KB. SPADS packs its own script-tag
    /// lines to 900 characters, so match that rather than find out which servers
    /// truncate.
    #[test]
    fn set_script_tags_packs_a_long_list_into_budgeted_lines() {
        let mut m = BTreeMap::new();
        for i in 0..100 {
            m.insert(format!("game/modoptions/option{i:03}"), "value".to_string());
        }
        let lines = set_script_tags(&m);
        assert!(lines.len() > 1, "100 options should not fit one line");
        for line in &lines {
            let body = line.strip_prefix("SETSCRIPTTAGS ").expect("line prefix");
            assert!(
                body.len() <= SCRIPT_TAG_LINE_BUDGET,
                "line body of {} exceeds the budget",
                body.len()
            );
        }
        // Splitting must lose nothing: a receiver merges each line into the
        // battle's tags, so the pairs across all lines are the whole map.
        let pairs: Vec<&str> = lines
            .iter()
            .flat_map(|l| {
                l.strip_prefix("SETSCRIPTTAGS ")
                    .expect("line prefix")
                    .split('\t')
            })
            .collect();
        assert_eq!(pairs.len(), 100);
        assert!(pairs.contains(&"game/modoptions/option042=value"));
    }

    /// One pair wider than the budget still goes out. Dropping it would silently
    /// lose an option, which is the bug this whole area is about.
    #[test]
    fn set_script_tags_sends_an_oversized_pair_alone() {
        let mut m = BTreeMap::new();
        m.insert("game/modoptions/tweakdefs".to_string(), "x".repeat(2000));
        m.insert("game/modoptions/maxunits".to_string(), "5000".to_string());
        let lines = set_script_tags(&m);
        assert_eq!(lines.len(), 2);
        assert_eq!(
            lines[1],
            format!(
                "SETSCRIPTTAGS game/modoptions/tweakdefs={}",
                "x".repeat(2000)
            )
        );
    }

    #[test]
    fn remove_script_tags_line() {
        assert_eq!(
            remove_script_tags(&["game/a", "game/b"]),
            vec!["REMOVESCRIPTTAGS game/a game/b"]
        );
    }

    #[test]
    fn remove_script_tags_says_nothing_about_nothing() {
        assert!(remove_script_tags(&[]).is_empty());
    }

    /// Clearing a restriction set removes `game/restrict/unit<N>` and
    /// `.../limit<N>` for every unit that goes (#1867), so 100 units is 201 keys
    /// and about 4 KB in one line. SPADS packs its own removal list to 900
    /// characters, so match that rather than find out which servers truncate.
    #[test]
    fn remove_script_tags_packs_a_long_list_into_budgeted_lines() {
        let mut keys = vec!["game/restrict/numrestrictions".to_string()];
        for i in 0..100 {
            keys.push(format!("game/restrict/unit{i}"));
            keys.push(format!("game/restrict/limit{i}"));
        }
        let refs: Vec<&str> = keys.iter().map(String::as_str).collect();
        let lines = remove_script_tags(&refs);
        assert!(lines.len() > 1, "201 keys should not fit one line");
        for line in &lines {
            let body = line.strip_prefix("REMOVESCRIPTTAGS ").expect("line prefix");
            assert!(
                body.len() <= SCRIPT_TAG_LINE_BUDGET,
                "line body of {} exceeds the budget",
                body.len()
            );
        }
        // Splitting must lose nothing: a key left on a dropped line stays set,
        // and a stale restriction the host thinks it cleared still binds the
        // match.
        let sent: Vec<&str> = lines
            .iter()
            .flat_map(|l| {
                l.strip_prefix("REMOVESCRIPTTAGS ")
                    .expect("line prefix")
                    .split(' ')
            })
            .collect();
        assert_eq!(sent, keys);
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
    fn turn_credentials_line() {
        assert_eq!(turn_credentials(), "TURNCREDENTIALS");
    }

    /// The address and the port are separate slots, the way `CLIENTIPPORT`
    /// already writes an address and a port, so the server reads them without
    /// splitting anything.
    #[test]
    fn relayed_host_line() {
        assert_eq!(
            relayed_host("198.51.100.9".parse().expect("an address"), 30001),
            "RELAYEDHOST 198.51.100.9 30001"
        );
    }

    /// A TURN server on IPv6 hands out an IPv6 allocation, and the line has to
    /// stay two fields when it does. Written bare rather than in brackets
    /// because the port has a slot of its own, so there is nothing to
    /// disambiguate.
    #[test]
    fn a_relayed_host_on_ipv6_is_still_two_fields() {
        let line = relayed_host("2001:db8::1".parse().expect("an address"), 30001);
        assert_eq!(line, "RELAYEDHOST 2001:db8::1 30001");
        assert_eq!(line.split(' ').count(), 3);
    }

    /// Moving a battle that is already open is its own command, carrying the
    /// same two fields. Sharing the shape is what lets a host build either from
    /// the same allocation, and not sharing the name is what stops the server
    /// reading a reopen as a move.
    #[test]
    fn move_relayed_host_line() {
        assert_eq!(
            move_relayed_host("198.51.100.9".parse().expect("an address"), 30002),
            "MOVERELAYEDHOST 198.51.100.9 30002"
        );
        assert_eq!(
            move_relayed_host("2001:db8::1".parse().expect("an address"), 30002),
            "MOVERELAYEDHOST 2001:db8::1 30002"
        );
    }

    /// The two are different commands and neither is a prefix the other can be
    /// mistaken for by anything reading the first word, which is how both the
    /// server and coilbox's own test lobby tell them apart.
    #[test]
    fn moving_a_battle_and_opening_one_are_not_the_same_command() {
        let ip = "198.51.100.9".parse().expect("an address");
        let opening = relayed_host(ip, 30001);
        let moving = move_relayed_host(ip, 30002);
        assert_ne!(
            opening.split(' ').next(),
            moving.split(' ').next(),
            "a server telling the two apart reads the command and nothing else"
        );
        assert!(!moving.starts_with("RELAYEDHOST "));
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
