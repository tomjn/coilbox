//! Outgoing command builders.
//!
//! Each function returns the wire line WITHOUT a trailing newline — the driving
//! plugin appends `\n`. Argument order is taken from the uberserver `in_*`
//! handlers so the strings match exactly what the server expects.

use std::collections::BTreeMap;

use crate::status::{BattleStatus, ClientStatus};

/// `LOGIN <user> <pass> <cpu> <local_ip> <agent>\t<client_id>\t<flags>`.
///
/// `pw_hash` is the already-computed `BASE64(MD5(password))`. `cpu` is fixed at
/// `0`. The final field is tab-structured: `agent\tclient_id\tflags` with flags
/// space-separated.
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

/// `SAYBATTLE <msg>`.
pub fn say_battle(msg: &str) -> String {
    format!("SAYBATTLE {msg}")
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
            "0",
            &["u", "sp", "b"],
        );
        assert_eq!(
            l,
            "LOGIN alice aGFzaA== 0 192.168.0.5 Coilbox 0.1\t0\tu sp b"
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
    }
}
