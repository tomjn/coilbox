//! Pure `BattleConfig -> script.txt` generator for the Recoil/Spring engine.
//!
//! The engine reads a TDF start script (`[SECTION]{ Key=Value; }`) that models a
//! strict hierarchy: a `[PLAYER]` or `[AI]` controls a `[TEAM]`, and teams join
//! `[ALLYTEAM]`s. A native skirmish AI is an `[AI]` block; a game-internal Lua AI
//! is instead set on its team via `[TEAM].LuaAI`. This module is IO-free so it can
//! be unit-tested; the file write + engine launch live in `launch.rs`/`lib.rs`.
//!
//! Format reference: `RecoilEngine/doc/StartScriptFormat.txt`.

use serde::Deserialize;
use std::collections::BTreeMap;
use std::fmt::Write;

#[derive(Deserialize, Clone, Debug)]
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
    #[serde(default)]
    pub game_start_delay: Option<u32>,
    #[serde(default)]
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
    /// Whether this machine hosts the game. Singleplayer/skirmish and lobby-host
    /// are hosts (`true`, the default — the engine runs a local host); a client
    /// joining a remote lobby battle sets this `false` and gets a minimal script
    /// that just points at the host (`[GAME]` below).
    #[serde(default = "default_true")]
    pub is_host: bool,
    /// Host address for a networked game. When hosting, `[GAME].HostIP` (defaults
    /// to `0.0.0.0`); when joining, the host we connect to.
    #[serde(default)]
    pub host_ip: Option<String>,
    /// Host port. Present for a networked host (the port the engine listens on) or
    /// a client (the port to connect to). Absent for pure singleplayer.
    #[serde(default)]
    pub host_port: Option<u16>,
    /// Script password the client presents to the host (client scripts only).
    #[serde(default)]
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
            is_host: true,
            host_ip: None,
            host_port: None,
            my_passwd: None,
        }
    }
}

#[derive(Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct Player {
    pub name: String,
    pub spectator: bool,
    /// Team index this player controls; omitted from the script when spectating.
    #[serde(default)]
    pub team: Option<u32>,
}

/// A native skirmish AI — rendered as an `[AI]` block.
#[derive(Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct Ai {
    pub name: String,
    pub short_name: String,
    #[serde(default)]
    pub version: Option<String>,
    pub team: u32,
    /// Player index whose machine runs the AI (usually 0, the host).
    pub host: u32,
    #[serde(default)]
    pub options: BTreeMap<String, String>,
}

#[derive(Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct Team {
    pub team_leader: u32,
    pub ally_team: u32,
    /// RGB in 0..1, rendered space-separated (`RgbColor=r g b`).
    pub rgb_color: [f32; 3],
    #[serde(default)]
    pub side: Option<String>,
    #[serde(default)]
    pub advantage: Option<f32>,
    #[serde(default)]
    pub income_multiplier: Option<f32>,
    /// Pre-placed start position (with `StartPosType=3`), in unitsync map coords.
    #[serde(default)]
    pub start_pos_x: Option<f32>,
    #[serde(default)]
    pub start_pos_z: Option<f32>,
    /// A game Lua AI controlling this team — set INSTEAD of an `[AI]` block.
    #[serde(default)]
    pub lua_ai: Option<String>,
}

#[derive(Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct AllyTeam {
    pub num_allies: u32,
    /// Start box `[top, left, bottom, right]` in 0..1 (with `StartPosType=2`).
    #[serde(default)]
    pub start_rect: Option<[f32; 4]>,
}

/// Render a `BattleConfig` into the engine's `[GAME]{ ... }` start-script text.
pub fn generate_script(cfg: &BattleConfig) -> String {
    // A client joining a remote lobby battle needs only a minimal script pointing
    // at the host; the host relays the full game/team/player state. (See skylobby
    // `script-data-client`.)
    if !cfg.is_host {
        return generate_client_script(cfg);
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
            if let Some(lua) = &t.lua_ai {
                kv(s, 2, "LuaAI", lua);
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

    s.push_str("}\n");
    s
}

/// Minimal `[GAME]` block for a client joining a remote host: it identifies the
/// player and where to connect; the host supplies teams/players/AIs over the wire.
fn generate_client_script(cfg: &BattleConfig) -> String {
    let mut s = String::new();
    s.push_str("[GAME]\n{\n");
    kv(&mut s, 1, "IsHost", "0");
    kv(&mut s, 1, "MyPlayerName", &cfg.my_player_name);
    if let Some(ip) = &cfg.host_ip {
        kv(&mut s, 1, "HostIP", ip);
    }
    if let Some(port) = cfg.host_port {
        kv(&mut s, 1, "HostPort", &port.to_string());
    }
    if let Some(pw) = &cfg.my_passwd {
        kv(&mut s, 1, "MyPasswd", pw);
    }
    s.push_str("}\n");
    s
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
        let s = generate_script(&sample());
        assert!(s.contains("NumPlayers=1;"));
        assert!(s.contains("NumTeams=2;"));
        assert!(s.contains("NumAllyTeams=2;"));
        assert!(s.contains("IsHost=1;"));
    }

    #[test]
    fn braces_are_balanced() {
        let s = generate_script(&sample());
        assert_eq!(s.matches('{').count(), s.matches('}').count());
    }

    #[test]
    fn native_ai_renders_ai_block_and_no_lua_ai() {
        let s = generate_script(&sample());
        assert!(s.contains("[AI0]"));
        assert!(s.contains("ShortName=BARb;"));
        assert!(s.contains("Host=0;"));
        assert!(!s.contains("LuaAI="));
    }

    #[test]
    fn lua_ai_renders_on_team_without_ai_block() {
        let mut cfg = sample();
        cfg.ais.clear();
        cfg.teams[1].lua_ai = Some("Scavengers".into());
        let s = generate_script(&cfg);
        assert!(!s.contains("[AI0]"));
        assert!(s.contains("LuaAI=Scavengers;"));
    }

    #[test]
    fn spectator_has_no_team_line() {
        let mut cfg = sample();
        cfg.players[0].spectator = true;
        cfg.players[0].team = None;
        let s = generate_script(&cfg);
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
        let s = generate_script(&sample());
        assert!(s.contains("RgbColor=0.9 0.1 0.1;"));
        assert!(s.contains("RgbColor=0.1 0.4 1;"));
    }

    #[test]
    fn mod_options_emitted_when_present() {
        let mut cfg = sample();
        cfg.mod_options.insert("startmetal".into(), "1000".into());
        let s = generate_script(&cfg);
        assert!(s.contains("[MODOPTIONS]"));
        assert!(s.contains("startmetal=1000;"));
    }

    #[test]
    fn ai_options_render_nested_block() {
        let mut cfg = sample();
        cfg.ais[0]
            .options
            .insert("difficultyLevel".into(), "1".into());
        let s = generate_script(&cfg);
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
        let s = generate_script(&cfg);
        assert!(s.contains("IsHost=0;"));
        assert!(s.contains("MyPlayerName=You;"));
        assert!(s.contains("HostIP=192.0.2.10;"));
        assert!(s.contains("HostPort=8452;"));
        assert!(s.contains("MyPasswd=s3cret;"));
        // No full-host structure leaks into a client script.
        assert!(!s.contains("[TEAM0]"));
        assert!(!s.contains("NumPlayers="));
    }

    #[test]
    fn networked_host_emits_hostport() {
        let mut cfg = sample();
        cfg.host_port = Some(8452);
        let s = generate_script(&cfg);
        assert!(s.contains("IsHost=1;"));
        assert!(s.contains("HostIP=0.0.0.0;"));
        assert!(s.contains("HostPort=8452;"));
        // Full host structure still present.
        assert!(s.contains("[TEAM0]"));
    }

    #[test]
    fn singleplayer_host_unchanged_without_port() {
        // Default is_host=true, no host_port -> identical to the legacy skirmish path.
        let s = generate_script(&sample());
        assert!(s.contains("IsHost=1;"));
        assert!(!s.contains("HostPort="));
        assert!(!s.contains("HostIP="));
    }

    #[test]
    fn start_boxes_render_when_present() {
        let mut cfg = sample();
        cfg.start_pos_type = 2;
        cfg.ally_teams[0].start_rect = Some([0.0, 0.0, 1.0, 0.3]);
        let s = generate_script(&cfg);
        assert!(s.contains("StartRectRight=0.3;"));
        assert!(s.contains("StartPosType=2;"));
    }
}
