//! Pure `BattleConfig -> script.txt` generator for the Recoil/Spring engine.
//!
//! The engine reads a TDF start script (`[SECTION]{ Key=Value; }`) that models a
//! strict hierarchy: a `[PLAYER]` or `[AI]` controls a `[TEAM]`, and teams join
//! `[ALLYTEAM]`s. A native skirmish AI is an `[AI]` block; a game-internal Lua AI
//! is instead set on its team via `[TEAM].LuaAI`. This module is IO-free so it can
//! be unit-tested; the file write + engine launch live in `launch.rs`/`lib.rs`.
//!
//! Format reference: `RecoilEngine/doc/StartScriptFormat.txt`.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fmt::Write;

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct BattleConfig {
    /// `[GAME].MapName` — map name without extension.
    pub map_name: String,
    /// `[GAME].GameType` — game name, rapid tag, or archive name.
    pub game_type: String,
    /// `[GAME].MyPlayerName` — must match one `[PLAYER].Name`.
    pub my_player_name: String,
    /// 0 fixed, 1 random, 2 choose-in-game, 3 choose-before.
    pub start_pos_type: u8,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub game_start_delay: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fixed_rng_seed: Option<u32>,
    pub players: Vec<Player>,
    #[serde(default)]
    pub ais: Vec<Ai>,
    pub teams: Vec<Team>,
    pub ally_teams: Vec<AllyTeam>,
    #[serde(default)]
    pub mod_options: BTreeMap<String, String>,
    #[serde(default)]
    pub map_options: BTreeMap<String, String>,
    /// `[RESTRICT]` — per-unit build limits. Key = unit internal name, value =
    /// limit (0 disables the unit). Engine-level: applies to all teams, not just
    /// one side (`RecoilEngine/doc/StartScriptFormat.txt`).
    #[serde(default)]
    pub restricted_units: BTreeMap<String, u32>,
    /// Whether this machine hosts the game. Singleplayer/skirmish and lobby-host
    /// are hosts (`true`, the default — the engine runs a local host); a client
    /// joining a remote lobby battle sets this `false` and gets a minimal script
    /// that just points at the host (`[GAME]` below).
    #[serde(default = "default_true")]
    pub is_host: bool,
    /// Host address for a networked game. When hosting, `[GAME].HostIP` (defaults
    /// to `0.0.0.0`); when joining, the host we connect to.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub host_ip: Option<String>,
    /// Why this host binds an address the engine is about to complain about,
    /// written into the script as a comment above `HostIP`.
    ///
    /// The engine logs `opening socket on loopback address, other users will not
    /// be able to connect!` whenever it binds one
    /// (`rts/System/Net/UDPListener.cpp`, `TryBindSocket`). On a battle relayed
    /// through a TURN server that warning is untrue: the players reach the relay
    /// and the relay agent carries them to the engine over loopback, which is
    /// exactly what it is for. The engine cannot be told to stop saying it, so
    /// the answer is to put the explanation where somebody who has just read the
    /// infolog will look next, which is the script sitting beside it.
    ///
    /// A `//` line comment, which the engine's TDF reader has always skipped
    /// (`cont/base/springcontent/gamedata/parse_tdf.lua`, `EatWhite`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub host_loopback_reason: Option<String>,
    /// Host port. Present for a networked host (the port the engine listens on) or
    /// a client (the port to connect to). Absent for pure singleplayer.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub host_port: Option<u16>,
    /// Script password the client presents to the host (client scripts only).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub my_passwd: Option<String>,
}

fn default_true() -> bool {
    true
}

// Hand-written so `is_host` defaults to `true` (a bool's `Default` is `false`),
// matching the serde `default_true` used for deserialization. Everything else is
// its type's own default.
impl Default for BattleConfig {
    fn default() -> Self {
        Self {
            map_name: String::new(),
            game_type: String::new(),
            my_player_name: String::new(),
            start_pos_type: 0,
            game_start_delay: None,
            fixed_rng_seed: None,
            players: Vec::new(),
            ais: Vec::new(),
            teams: Vec::new(),
            ally_teams: Vec::new(),
            mod_options: BTreeMap::new(),
            map_options: BTreeMap::new(),
            restricted_units: BTreeMap::new(),
            is_host: true,
            host_ip: None,
            host_loopback_reason: None,
            host_port: None,
            my_passwd: None,
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct Player {
    pub name: String,
    pub spectator: bool,
    /// Team index this player controls; omitted from the script when spectating.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub team: Option<u32>,
}

/// A native skirmish AI — rendered as an `[AI]` block.
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct Ai {
    pub name: String,
    pub short_name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    pub team: u32,
    /// Player index whose machine runs the AI (usually 0, the host).
    pub host: u32,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub options: BTreeMap<String, String>,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct Team {
    pub team_leader: u32,
    pub ally_team: u32,
    /// RGB in 0..1, rendered space-separated (`RgbColor=r g b`).
    pub rgb_color: [f32; 3],
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub side: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub advantage: Option<f32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub income_multiplier: Option<f32>,
    /// Pre-placed start position (with `StartPosType=3`), in unitsync map coords.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub start_pos_x: Option<f32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub start_pos_z: Option<f32>,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct AllyTeam {
    pub num_allies: u32,
    /// Start box `[top, left, bottom, right]` in 0..1 (with `StartPosType=2`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub start_rect: Option<[f32; 4]>,
}

/// Render a `BattleConfig` into the engine's `[GAME]{ ... }` start-script text.
///
/// Refuses a script holding a value that would change what the script says. See
/// [`generate_client_script`] and [`host_script_refusal`].
pub fn generate_script(cfg: &BattleConfig) -> Result<String, String> {
    // A client joining a remote lobby battle needs only a minimal script pointing
    // at the host; the host relays the full game/team/player state. (See skylobby
    // `script-data-client`.)
    if !cfg.is_host {
        return generate_client_script(cfg);
    }
    if let Some(refused) = host_script_refusal(cfg) {
        return Err(refused);
    }

    let mut s = String::new();
    s.push_str("[GAME]\n{\n");

    kv(&mut s, 1, "MapName", &cfg.map_name);
    kv(&mut s, 1, "GameType", &cfg.game_type);
    kv(&mut s, 1, "StartPosType", &cfg.start_pos_type.to_string());
    kv(&mut s, 1, "MyPlayerName", &cfg.my_player_name);
    kv(&mut s, 1, "IsHost", "1");
    // A networked host advertises where the engine listens; pure singleplayer omits
    // this and the engine picks a local port itself.
    if let Some(port) = cfg.host_port {
        if let Some(reason) = &cfg.host_loopback_reason {
            // Above `HostIP` rather than at the top of the file, so it is next
            // to the line it is about. Line breaks would end the comment and
            // leave the rest as a key the parser cannot read, so they are
            // flattened rather than trusted.
            let _ = writeln!(s, "\t// {}", reason.replace(['\n', '\r'], " "));
        }
        kv(
            &mut s,
            1,
            "HostIP",
            cfg.host_ip.as_deref().unwrap_or("0.0.0.0"),
        );
        kv(&mut s, 1, "HostPort", &port.to_string());
    }
    kv(&mut s, 1, "NumPlayers", &cfg.players.len().to_string());
    kv(&mut s, 1, "NumTeams", &cfg.teams.len().to_string());
    kv(&mut s, 1, "NumAllyTeams", &cfg.ally_teams.len().to_string());
    if let Some(d) = cfg.game_start_delay {
        kv(&mut s, 1, "GameStartDelay", &d.to_string());
    }
    if let Some(seed) = cfg.fixed_rng_seed {
        kv(&mut s, 1, "FixedRNGSeed", &seed.to_string());
    }

    for (i, p) in cfg.players.iter().enumerate() {
        section(&mut s, 1, &format!("PLAYER{i}"), |s| {
            kv(s, 2, "Name", &p.name);
            kv(s, 2, "Spectator", if p.spectator { "1" } else { "0" });
            // A spectator controls no team, so omit Team entirely.
            if !p.spectator {
                if let Some(t) = p.team {
                    kv(s, 2, "Team", &t.to_string());
                }
            }
        });
    }

    for (i, a) in cfg.ais.iter().enumerate() {
        section(&mut s, 1, &format!("AI{i}"), |s| {
            kv(s, 2, "Name", &a.name);
            kv(s, 2, "ShortName", &a.short_name);
            if let Some(v) = &a.version {
                kv(s, 2, "Version", v);
            }
            kv(s, 2, "Team", &a.team.to_string());
            kv(s, 2, "Host", &a.host.to_string());
            if !a.options.is_empty() {
                section(s, 2, "OPTIONS", |s| {
                    for (k, v) in &a.options {
                        kv(s, 3, k, v);
                    }
                });
            }
        });
    }

    for (i, t) in cfg.teams.iter().enumerate() {
        section(&mut s, 1, &format!("TEAM{i}"), |s| {
            kv(s, 2, "TeamLeader", &t.team_leader.to_string());
            kv(s, 2, "AllyTeam", &t.ally_team.to_string());
            kv(s, 2, "RgbColor", &fmt_rgb(t.rgb_color));
            if let Some(side) = &t.side {
                kv(s, 2, "Side", side);
            }
            if let Some(a) = t.advantage {
                kv(s, 2, "Advantage", &fmt_f(a));
            }
            if let Some(m) = t.income_multiplier {
                kv(s, 2, "IncomeMultiplier", &fmt_f(m));
            }
            if let (Some(x), Some(z)) = (t.start_pos_x, t.start_pos_z) {
                kv(s, 2, "StartPosX", &fmt_f(x));
                kv(s, 2, "StartPosZ", &fmt_f(z));
            }
        });
    }

    for (i, at) in cfg.ally_teams.iter().enumerate() {
        section(&mut s, 1, &format!("ALLYTEAM{i}"), |s| {
            kv(s, 2, "NumAllies", &at.num_allies.to_string());
            if let Some([top, left, bottom, right]) = at.start_rect {
                kv(s, 2, "StartRectTop", &fmt_f(top));
                kv(s, 2, "StartRectLeft", &fmt_f(left));
                kv(s, 2, "StartRectBottom", &fmt_f(bottom));
                kv(s, 2, "StartRectRight", &fmt_f(right));
            }
        });
    }

    if !cfg.mod_options.is_empty() {
        section(&mut s, 1, "MODOPTIONS", |s| {
            for (k, v) in &cfg.mod_options {
                kv(s, 2, k, v);
            }
        });
    }
    if !cfg.map_options.is_empty() {
        section(&mut s, 1, "MAPOPTIONS", |s| {
            for (k, v) in &cfg.map_options {
                kv(s, 2, k, v);
            }
        });
    }
    // RESTRICT is engine-level: it caps build counts for all teams, not just one
    // side (RecoilEngine/doc/StartScriptFormat.txt).
    if !cfg.restricted_units.is_empty() {
        section(&mut s, 1, "RESTRICT", |s| {
            kv(
                s,
                2,
                "NumRestrictions",
                &cfg.restricted_units.len().to_string(),
            );
            for (i, (name, limit)) in cfg.restricted_units.iter().enumerate() {
                kv(s, 2, &format!("Unit{i}"), name);
                kv(s, 2, &format!("Limit{i}"), &limit.to_string());
            }
        });
    }

    s.push_str("}\n");
    Ok(s)
}

/// Minimal `[GAME]` block for a client joining a remote host: it identifies the
/// player and where to connect; the host supplies teams/players/AIs over the wire.
///
/// Every value in it came from a lobby server, so each one is checked before it
/// is written, and a value that fails is refused rather than escaped. A script
/// quietly rewritten into something else is worse than a launch that did not
/// happen. See [`value_refusal`] for what is refused and why.
fn generate_client_script(cfg: &BattleConfig) -> Result<String, String> {
    let ip = cfg
        .host_ip
        .as_deref()
        .ok_or("Coilbox did not start the game: the server did not say where the match is.")?;
    let port = cfg.host_port.ok_or(
        "Coilbox did not start the game: the server did not say which port the match is on.",
    )?;
    if let Some(refused) = host_refusal(ip) {
        return Err(refused);
    }
    if let Some(refused) = value_refusal("player name", &cfg.my_player_name) {
        return Err(refused);
    }
    if let Some(refused) = cfg
        .my_passwd
        .as_deref()
        .and_then(|pw| value_refusal("script password", pw))
    {
        return Err(refused);
    }

    let mut s = String::new();
    s.push_str("[GAME]\n{\n");
    kv(&mut s, 1, "IsHost", "0");
    kv(&mut s, 1, "MyPlayerName", &cfg.my_player_name);
    kv(&mut s, 1, "HostIP", ip);
    kv(&mut s, 1, "HostPort", &port.to_string());
    if let Some(pw) = &cfg.my_passwd {
        kv(&mut s, 1, "MyPasswd", pw);
    }
    s.push_str("}\n");
    Ok(s)
}

/// Why `value` cannot be written as a script value, or `None` when it can.
///
/// The engine reads a value as everything from the `=` to the next `;` or line
/// break (`cont/base/springcontent/gamedata/parse_tdf.lua`, `ParseValue`). Either
/// of those inside a name or a password ends the value early, and whatever
/// follows is read as keys of its own. A value that opens with `"` is read as a
/// quoted string and loses its quotes, and spaces in front of a value are
/// skipped, so those would change the value without breaking anything visible.
///
/// Brackets, braces and `=` are left alone. Inside a value the parser treats
/// them as ordinary text, and Zero-K names may contain `[` and `]` for a clan
/// tag (`Utils.ValidLobbyNameCharacter` in Zero-K-Infrastructure).
fn value_refusal(what: &str, value: &str) -> Option<String> {
    if let Some(refused) = line_refusal(what, value) {
        return Some(refused);
    }
    let reason = if value.is_empty() {
        "is empty"
    } else if value.starts_with(char::is_whitespace) || value.ends_with(char::is_whitespace) {
        "starts or ends with a space"
    } else if value.starts_with('"') {
        "starts with a quote mark"
    } else {
        return None;
    };
    Some(format!(
        "Coilbox did not start the game: the {what} {reason}."
    ))
}

/// Why `value` cannot be written without starting another line of the script, or
/// `None` when it can. Only what ends a value early (see [`value_refusal`]), since
/// an empty option is a real setting and the rest of that check does not apply to
/// text a game declared. A NUL counts too: the engine copies the script as a C
/// string (`TdfParser::ParseBuffer`), which would cut it off there.
fn line_refusal(what: &str, value: &str) -> Option<String> {
    let reason = if value.contains(';') {
        "contains a semicolon"
    } else if value.chars().any(char::is_control) {
        "contains a line break or another control character"
    } else {
        return None;
    };
    Some(format!(
        "Coilbox did not start the game: the {what} {reason}."
    ))
}

/// The same for an option: its key as well as its value. A key is read up to the
/// first space or `=` (`ParseKey`, same file), so one holding either carries a value
/// of its own, and one holding `}` can close the section. Every option key in the
/// games checked for this is letters, digits and underscores.
fn option_refusal(what: &str, key: &str, value: &str) -> Option<String> {
    let plain = !key.is_empty() && key.chars().all(|c| c.is_ascii_alphanumeric() || c == '_');
    if !plain {
        return Some(format!(
            "Coilbox did not start the game: the {what} {key:?} has a name that is not only letters, digits and underscores."
        ));
    }
    line_refusal(&format!("{what} {key}"), value)
}

/// Why a host script cannot be written, or `None` when it can.
///
/// Everything in it that is text can come from a saved or followed preset or a
/// lobby, and goes through [`kv`] as it stands. A value that starts another line can
/// add a tweak slot, which is Lua the game runs, or close the section and set a
/// mutator, so the launch is refused rather than the text escaped, for the reason
/// [`generate_client_script`] gives. The numbers it holds cannot do this.
fn host_script_refusal(cfg: &BattleConfig) -> Option<String> {
    let mut texts: Vec<(&str, &str)> = vec![
        ("map name", &cfg.map_name),
        ("game name", &cfg.game_type),
        ("player name", &cfg.my_player_name),
    ];
    if let Some(ip) = &cfg.host_ip {
        texts.push(("host address", ip));
    }
    for p in &cfg.players {
        texts.push(("player name", &p.name));
    }
    for a in &cfg.ais {
        texts.push(("bot name", &a.name));
        texts.push(("bot short name", &a.short_name));
        if let Some(version) = &a.version {
            texts.push(("bot version", version));
        }
    }
    for t in &cfg.teams {
        if let Some(side) = &t.side {
            texts.push(("team side", side));
        }
    }
    for unit in cfg.restricted_units.keys() {
        texts.push(("restricted unit", unit));
    }
    let options = [
        ("mod option", &cfg.mod_options),
        ("map option", &cfg.map_options),
    ];
    let bot_options = cfg.ais.iter().map(|a| ("bot option", &a.options));
    texts
        .into_iter()
        .find_map(|(what, text)| line_refusal(what, text))
        .or_else(|| {
            options
                .into_iter()
                .chain(bot_options)
                .flat_map(|(what, map)| map.iter().map(move |(k, v)| (what, k, v)))
                .find_map(|(what, k, v)| option_refusal(what, k, v))
        })
}

/// The same check for the host's address, which is narrower still. An address
/// is an IP or a host name, so anything beyond letters, digits, `.`, `:` and
/// `-` is not one.
fn host_refusal(ip: &str) -> Option<String> {
    if let Some(refused) = value_refusal("host address", ip) {
        return Some(refused);
    }
    let address = |c: char| c.is_ascii_alphanumeric() || matches!(c, '.' | ':' | '-');
    (!ip.chars().all(address))
        .then(|| "Coilbox did not start the game: the host address is not an address.".into())
}

/// Write one `Key=Value;` line at `indent` tab stops.
fn kv(out: &mut String, indent: usize, key: &str, val: &str) {
    let pad = "\t".repeat(indent);
    let _ = writeln!(out, "{pad}{key}={val};");
}

/// Write a `[NAME] { ... }` block, delegating its body to `body`.
fn section<F: FnOnce(&mut String)>(out: &mut String, indent: usize, name: &str, body: F) {
    let pad = "\t".repeat(indent);
    let _ = writeln!(out, "{pad}[{name}]");
    let _ = writeln!(out, "{pad}{{");
    body(out);
    let _ = writeln!(out, "{pad}}}");
}

/// Space-separated RGB, e.g. `0.9 0.1 0.1`.
fn fmt_rgb([r, g, b]: [f32; 3]) -> String {
    format!("{} {} {}", fmt_f(r), fmt_f(g), fmt_f(b))
}

/// Compact float rendering (no trailing zeros; `1.0` -> `1`).
fn fmt_f(v: f32) -> String {
    format!("{v}")
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A 1v(native AI) skirmish: you on team 0/ally 0, AI on team 1/ally 1.
    fn sample() -> BattleConfig {
        BattleConfig {
            map_name: "Comet Catcher Remake 1.8".into(),
            game_type: "Beyond All Reason test-27381".into(),
            my_player_name: "You".into(),
            start_pos_type: 0,
            players: vec![Player {
                name: "You".into(),
                spectator: false,
                team: Some(0),
            }],
            ais: vec![Ai {
                name: "AI: BARb".into(),
                short_name: "BARb".into(),
                version: Some("stable".into()),
                team: 1,
                host: 0,
                options: BTreeMap::new(),
            }],
            teams: vec![
                Team {
                    team_leader: 0,
                    ally_team: 0,
                    rgb_color: [0.9, 0.1, 0.1],
                    side: Some("Armada".into()),
                    ..Default::default()
                },
                Team {
                    team_leader: 0,
                    ally_team: 1,
                    rgb_color: [0.1, 0.4, 1.0],
                    side: Some("Cortex".into()),
                    ..Default::default()
                },
            ],
            ally_teams: vec![
                AllyTeam {
                    num_allies: 0,
                    start_rect: None,
                },
                AllyTeam {
                    num_allies: 0,
                    start_rect: None,
                },
            ],
            ..Default::default()
        }
    }

    #[test]
    fn counts_match_vec_lengths() {
        let s = generate_script(&sample()).unwrap();
        assert!(s.contains("NumPlayers=1;"));
        assert!(s.contains("NumTeams=2;"));
        assert!(s.contains("NumAllyTeams=2;"));
        assert!(s.contains("IsHost=1;"));
    }

    #[test]
    fn braces_are_balanced() {
        let s = generate_script(&sample()).unwrap();
        assert_eq!(s.matches('{').count(), s.matches('}').count());
    }

    #[test]
    fn native_ai_renders_ai_block_and_no_lua_ai() {
        let s = generate_script(&sample()).unwrap();
        assert!(s.contains("[AI0]"));
        assert!(s.contains("ShortName=BARb;"));
        assert!(s.contains("Host=0;"));
        assert!(!s.contains("LuaAI="));
    }

    /// A game Lua AI goes through the same `[AI]` block as a native one: the
    /// engine's `LoadSkirmishAIs` is the only reader of the script, and it flags
    /// Lua-ness itself by matching ShortName against the game's `LuaAI.lua`.
    #[test]
    fn lua_ai_renders_an_ai_block_with_game_version() {
        let mut cfg = sample();
        cfg.ais[0].short_name = "Scavengers".into();
        cfg.ais[0].version = Some("<game>".into());
        let s = generate_script(&cfg).unwrap();
        assert!(s.contains("[AI0]"));
        assert!(s.contains("ShortName=Scavengers;"));
        assert!(s.contains("Version=<game>;"));
    }

    #[test]
    fn spectator_has_no_team_line() {
        let mut cfg = sample();
        cfg.players[0].spectator = true;
        cfg.players[0].team = None;
        let s = generate_script(&cfg).unwrap();
        // The single PLAYER block is a spectator, so no Team= should appear inside it.
        let player_block = s
            .split("[PLAYER0]")
            .nth(1)
            .unwrap()
            .split("[AI0]")
            .next()
            .unwrap();
        assert!(player_block.contains("Spectator=1;"));
        assert!(!player_block.contains("Team="));
    }

    #[test]
    fn rgb_color_is_space_separated_floats() {
        let s = generate_script(&sample()).unwrap();
        assert!(s.contains("RgbColor=0.9 0.1 0.1;"));
        assert!(s.contains("RgbColor=0.1 0.4 1;"));
    }

    #[test]
    fn mod_options_emitted_when_present() {
        let mut cfg = sample();
        cfg.mod_options.insert("startmetal".into(), "1000".into());
        let s = generate_script(&cfg).unwrap();
        assert!(s.contains("[MODOPTIONS]"));
        assert!(s.contains("startmetal=1000;"));
    }

    #[test]
    fn ai_options_render_nested_block() {
        let mut cfg = sample();
        cfg.ais[0]
            .options
            .insert("difficultyLevel".into(), "1".into());
        let s = generate_script(&cfg).unwrap();
        assert!(s.contains("[OPTIONS]"));
        assert!(s.contains("difficultyLevel=1;"));
    }

    #[test]
    fn client_script_is_minimal_and_points_at_host() {
        let mut cfg = sample();
        cfg.is_host = false;
        cfg.host_ip = Some("192.0.2.10".into());
        cfg.host_port = Some(8452);
        cfg.my_passwd = Some("s3cret".into());
        let s = generate_script(&cfg).unwrap();
        assert!(s.contains("IsHost=0;"));
        assert!(s.contains("MyPlayerName=You;"));
        assert!(s.contains("HostIP=192.0.2.10;"));
        assert!(s.contains("HostPort=8452;"));
        assert!(s.contains("MyPasswd=s3cret;"));
        // No full-host structure leaks into a client script.
        assert!(!s.contains("[TEAM0]"));
        assert!(!s.contains("NumPlayers="));
    }

    /// A client script as a joiner gets it: somebody else's game, named by a
    /// lobby server.
    fn client() -> BattleConfig {
        BattleConfig {
            my_player_name: "[teh]Someone".into(),
            is_host: false,
            host_ip: Some("192.0.2.10".into()),
            host_port: Some(8452),
            my_passwd: Some("dGhlIHBhc3N3b3Jk+/=".into()),
            ..Default::default()
        }
    }

    /// The keys of a script, top level only, in order.
    fn keys(script: &str) -> Vec<String> {
        script
            .lines()
            .filter_map(|line| line.trim().split_once('='))
            .map(|(key, _)| key.to_owned())
            .collect()
    }

    /// Everything a Zero-K server can send in a real `ConnectSpring` goes
    /// through untouched, the clan tag's brackets and a password's `=` included.
    #[test]
    fn a_real_join_is_written_as_it_came() {
        let s = generate_script(&client()).unwrap();
        assert!(s.contains("MyPlayerName=[teh]Someone;"));
        assert!(s.contains("MyPasswd=dGhlIHBhc3N3b3Jk+/=;"));
        assert_eq!(
            keys(&s),
            ["IsHost", "MyPlayerName", "HostIP", "HostPort", "MyPasswd"]
        );
    }

    /// Each value that could end its own line early, or be read as something
    /// other than what it is, stops the launch rather than reaching the file.
    #[test]
    fn a_value_that_would_forge_the_script_is_refused() {
        let forged = [
            "x;IsHost=1",
            "x\nIsHost=1;",
            "x\rIsHost=1;",
            "x\0",
            "x\t",
            " x",
            "x ",
            "\"x\"",
            "",
        ];
        for value in forged {
            let mut cfg = client();
            cfg.my_player_name = value.into();
            assert!(
                generate_script(&cfg).is_err(),
                "a player name of {value:?} was written"
            );
            let mut cfg = client();
            cfg.my_passwd = Some(value.into());
            assert!(
                generate_script(&cfg).is_err(),
                "a script password of {value:?} was written"
            );
            let mut cfg = client();
            cfg.host_ip = Some(value.into());
            assert!(
                generate_script(&cfg).is_err(),
                "a host address of {value:?} was written"
            );
        }
    }

    /// A host script with one option set, the way a preset's option reaches it.
    fn with_option(key: &str, value: &str, map: bool) -> Result<String, String> {
        let mut cfg = sample();
        let options = if map {
            &mut cfg.map_options
        } else {
            &mut cfg.mod_options
        };
        options.insert(key.into(), value.into());
        generate_script(&cfg)
    }

    /// A value ends at the next `;` or line break (`ParseValue` in the engine's
    /// `parse_tdf.lua`), so either one starts a key of the sender's choosing. These
    /// write a tweak slot that no filter on the option's own key would see.
    #[test]
    fn an_option_value_that_would_write_other_lines_is_refused() {
        for value in [
            "1;tweakdefs=bHVh",
            "1;\ntweakdefs=bHVh",
            "1\ntweakdefs=bHVh",
            "1\rtweakdefs=bHVh",
            "1;\n}\nMutator0=evil;\n[X]\n{\nbar=2",
            "a\0b",
            "a\tb",
        ] {
            for map in [false, true] {
                assert!(
                    with_option("maxunits", value, map).is_err(),
                    "a value of {value:?} was written (map options: {map})"
                );
            }
        }
    }

    /// A key is read up to the first space or `=`, so anything else in one can
    /// close the section or carry a value of its own.
    #[test]
    fn an_option_key_that_is_not_a_plain_name_is_refused() {
        for key in [
            "a=1;\ntweakdefs",
            "a}",
            "}\nMapName",
            "a b",
            "a;b",
            "a-b",
            "a.b",
            "[x]",
            "a\nb",
            "",
            "tw\u{e9}ak",
        ] {
            for map in [false, true] {
                assert!(
                    with_option(key, "1", map).is_err(),
                    "a key of {key:?} was written (map options: {map})"
                );
            }
        }
    }

    /// What real games set must still start: an empty value, which a tweak slot
    /// left blank has today, and text the parser treats as ordinary inside a value.
    #[test]
    fn an_ordinary_option_is_still_written() {
        for (key, value) in [
            ("maxunits", "2000"),
            ("tweakdefs", ""),
            ("tweakdefs3", "ZG8gZW5k"),
            ("TweakDefs", "ZG8gZW5k"),
            ("tweakdefs", "cmV0dXJuIHt9=="),
            ("a_b_2", "a}b"),
            ("a", "[a]=b"),
            ("a", "a//b"),
            ("a", " spaced "),
            ("a", "\"quoted\""),
            ("a", "caf\u{e9}"),
        ] {
            for map in [false, true] {
                let script = with_option(key, value, map)
                    .unwrap_or_else(|e| panic!("{key}={value:?} was refused: {e}"));
                assert!(script.contains(&format!("{key}={value};")), "{script}");
            }
        }
    }

    /// The refusal names the option, so a player can find it in the setup.
    #[test]
    fn a_refused_option_is_named() {
        assert_eq!(
            with_option("maxunits", "1;x", false).unwrap_err(),
            "Coilbox did not start the game: the mod option maxunits contains a semicolon."
        );
        assert_eq!(
            with_option("wind", "1\nx", true).unwrap_err(),
            "Coilbox did not start the game: the map option wind contains a line break or another control character."
        );
        assert_eq!(
            with_option("a}", "1", false).unwrap_err(),
            "Coilbox did not start the game: the mod option \"a}\" has a name that is not only letters, digits and underscores."
        );
    }

    /// Every other value a preset or a lobby can fill goes through `kv` as well, so
    /// a side or a bot's name could do what an option's value can.
    #[test]
    fn every_other_value_that_could_write_other_lines_is_refused() {
        let forged = "x;\ntweakdefs=bHVh";
        type Set = fn(&mut BattleConfig, String);
        let cases: [(&str, Set); 9] = [
            ("the map name", |c, v| c.map_name = v),
            ("the game name", |c, v| c.game_type = v),
            ("the player name", |c, v| c.my_player_name = v),
            ("a player's name", |c, v| c.players[0].name = v),
            ("a bot's name", |c, v| c.ais[0].name = v),
            ("a bot's short name", |c, v| c.ais[0].short_name = v),
            ("a bot's version", |c, v| c.ais[0].version = Some(v)),
            ("a team's side", |c, v| c.teams[0].side = Some(v)),
            ("a restricted unit", |c, v| {
                c.restricted_units.insert(v, 0);
            }),
        ];
        for (what, set) in cases {
            let mut cfg = sample();
            set(&mut cfg, forged.into());
            assert!(generate_script(&cfg).is_err(), "{what} was written");
        }
        let mut cfg = sample();
        cfg.ais[0].options.insert("a}".into(), "1".into());
        assert!(generate_script(&cfg).is_err(), "a bot option's key");
        let mut cfg = sample();
        cfg.ais[0].options.insert("a".into(), forged.into());
        assert!(generate_script(&cfg).is_err(), "a bot option's value");
    }

    /// The refusal says which value it was, so the player is not left guessing.
    #[test]
    fn a_refusal_names_the_value() {
        let mut cfg = client();
        cfg.my_passwd = Some("a;b".into());
        assert_eq!(
            generate_script(&cfg).unwrap_err(),
            "Coilbox did not start the game: the script password contains a semicolon."
        );
    }

    /// An address is letters, digits and the separators of an IP or a host
    /// name. Brackets and braces are fine in a name and not in an address.
    #[test]
    fn a_host_address_takes_only_address_characters() {
        for good in ["192.0.2.10", "2001:db8::1", "zero-k.info"] {
            let mut cfg = client();
            cfg.host_ip = Some(good.into());
            assert!(generate_script(&cfg).is_ok(), "{good} was refused");
        }
        for bad in ["[2001:db8::1]", "host}", "a=b", "host/path"] {
            let mut cfg = client();
            cfg.host_ip = Some(bad.into());
            assert!(generate_script(&cfg).is_err(), "{bad} was written");
        }
    }

    /// A client script that does not say where to connect starts an engine that
    /// waits forever, so it is not written at all.
    #[test]
    fn a_client_script_without_an_address_or_port_is_refused() {
        let mut cfg = client();
        cfg.host_ip = None;
        assert!(generate_script(&cfg).is_err());
        let mut cfg = client();
        cfg.host_port = None;
        assert!(generate_script(&cfg).is_err());
    }

    #[test]
    fn networked_host_emits_hostport() {
        let mut cfg = sample();
        cfg.host_port = Some(8452);
        let s = generate_script(&cfg).unwrap();
        assert!(s.contains("IsHost=1;"));
        assert!(s.contains("HostIP=0.0.0.0;"));
        assert!(s.contains("HostPort=8452;"));
        // Full host structure still present.
        assert!(s.contains("[TEAM0]"));
    }

    /// A relayed host binds loopback and the engine warns that nobody will be
    /// able to connect, which under a relay is untrue. The note goes into the
    /// script beside `HostIP` so it is next to the line it is about, and next to
    /// the infolog somebody has just read the warning in.
    #[test]
    fn a_host_that_explains_its_loopback_bind_says_so_above_hostip() {
        let mut cfg = sample();
        cfg.host_ip = Some("127.0.0.1".into());
        cfg.host_port = Some(8452);
        cfg.host_loopback_reason = Some("This battle is relayed, so loopback is right.".into());
        let s = generate_script(&cfg).unwrap();

        let note = s
            .lines()
            .position(|l| l.contains("relayed"))
            .expect("the reason is in the script");
        let host_ip = s
            .lines()
            .position(|l| l.contains("HostIP="))
            .expect("a networked host names an address");
        assert_eq!(
            note + 1,
            host_ip,
            "the note belongs above the line it is about"
        );
        assert!(
            s.lines()
                .nth(note)
                .expect("the note")
                .trim_start()
                .starts_with("//"),
            "the engine's TDF reader skips `//` lines and nothing else, so anything \
             else here is a key it cannot parse"
        );
    }

    /// A newline in the reason would end the comment and leave the rest of it
    /// sitting in the script as a key the parser gives up on, taking the whole
    /// game with it. The value comes from Rust rather than from a person, so
    /// this is belt and braces, and it is cheap.
    #[test]
    fn a_reason_with_a_line_break_in_it_cannot_break_the_script() {
        let mut cfg = sample();
        cfg.host_port = Some(8452);
        cfg.host_loopback_reason = Some("first line\nHostPort=1;".into());
        let s = generate_script(&cfg).unwrap();
        assert!(s.contains("// first line HostPort=1;"));
        let ports: Vec<&str> = s
            .lines()
            .map(str::trim)
            .filter(|l| l.starts_with("HostPort="))
            .collect();
        assert_eq!(
            ports,
            vec!["HostPort=8452;"],
            "the second half of the reason stayed inside the comment"
        );
    }

    /// A host that is not relayed says nothing, because for them the engine's
    /// warning about a loopback socket would be true.
    #[test]
    fn a_host_with_nothing_to_explain_adds_no_comment() {
        let mut cfg = sample();
        cfg.host_port = Some(8452);
        assert!(!generate_script(&cfg).unwrap().contains("//"));
    }

    #[test]
    fn singleplayer_host_unchanged_without_port() {
        // Default is_host=true, no host_port -> identical to the legacy skirmish path.
        let s = generate_script(&sample()).unwrap();
        assert!(s.contains("IsHost=1;"));
        assert!(!s.contains("HostPort="));
        assert!(!s.contains("HostIP="));
    }

    #[test]
    fn start_boxes_render_when_present() {
        let mut cfg = sample();
        cfg.start_pos_type = 2;
        cfg.ally_teams[0].start_rect = Some([0.0, 0.0, 1.0, 0.3]);
        let s = generate_script(&cfg).unwrap();
        assert!(s.contains("StartRectRight=0.3;"));
        assert!(s.contains("StartPosType=2;"));
    }

    #[test]
    fn restrict_section_renders_sequential_indices() {
        let mut cfg = sample();
        cfg.restricted_units.insert("armcom".into(), 1);
        cfg.restricted_units.insert("armflash".into(), 0);
        let s = generate_script(&cfg).unwrap();
        assert!(s.contains("[RESTRICT]"));
        assert!(s.contains("NumRestrictions=2;"));
        // BTreeMap orders by key, so armcom (Unit0) sorts before armflash (Unit1).
        assert!(s.contains("Unit0=armcom;"));
        assert!(s.contains("Limit0=1;"));
        assert!(s.contains("Unit1=armflash;"));
        assert!(s.contains("Limit1=0;"));
    }

    #[test]
    fn restrict_section_omitted_when_empty() {
        let s = generate_script(&sample()).unwrap();
        assert!(!s.contains("[RESTRICT]"));
        assert!(!s.contains("NumRestrictions"));
    }
}
