//! Serde data model for the content plugin. The `*State`/`ContentRoot`/`Engine`
//! shapes are serialized to the frontend (camelCase) and are the cross-plugin
//! read API; `StoreFile`/`UserRoot` are the durable on-disk shape.
//!
//! Timestamps are epoch-millis `u64` (display data only) so the crate doesn't
//! need a date dependency — the frontend formats them with `new Date(ms)`.

use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum RootSource {
    Auto,
    Manual,
}

#[derive(Serialize, Deserialize, Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "lowercase")]
pub enum RootKind {
    /// pr-downloader / installed layout (engine/ games/ maps/ packages/ pool/ rapid/).
    Data,
    /// All-in-one folder: a spring binary + basecontent next to it.
    Portable,
}

#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct RootCounts {
    pub games: u32,
    pub maps: u32,
    pub engines: u32,
    pub packages: u32,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Engine {
    pub id: String,
    pub root_path: String,
    pub path: String,
    pub executable: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub platform: Option<String>,
    pub version: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sync_version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub verified_at: Option<u64>,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ContentRoot {
    pub id: String,
    pub path: String,
    pub source: RootSource,
    pub kind: RootKind,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    pub origins: Vec<String>,
    pub exists: bool,
    pub valid: bool,
    /// True when this root is stored as a path *relative* to the app dir — a
    /// portable root that follows the executable when the package is moved.
    #[serde(default)]
    pub portable: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub forced: Option<bool>,
    pub counts: RootCounts,
    pub engines: Vec<Engine>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_scanned_at: Option<u64>,
}

#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct ContentState {
    pub schema_version: u32,
    pub roots: Vec<ContentRoot>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_scan_at: Option<u64>,
}

/// A user-added root, persisted verbatim (auto roots are recomputed each rescan).
#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct UserRoot {
    pub path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    #[serde(default)]
    pub forced: bool,
}

/// The durable on-disk store: the user's manual roots plus the last computed
/// snapshot (so reads are instant without rescanning).
#[derive(Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct StoreFile {
    #[serde(default)]
    pub schema_version: u32,
    #[serde(default)]
    pub user_roots: Vec<UserRoot>,
    #[serde(default)]
    pub snapshot: Option<ContentState>,
}

/// A replay file found in a root's `demos/`/`replays/` folder. The summary fields
/// come from a cheap native decode of the demo header + start-script (no demotool,
/// no winner); they're `None` when the file can't be decoded.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ReplayFile {
    pub filename: String,
    pub path: String,
    pub size_bytes: u64,
    pub modified_ms: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub map_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub game_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duration_sec: Option<u32>,
    /// How many seats the match had: non-spectator players plus skirmish AIs. A
    /// bot occupies a team and a slot in the ally structure, so leaving it out
    /// reported a 1v3 skirmish as a one-player game.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub player_count: Option<u32>,
    /// Battle start (epoch-millis) from the demo header — more accurate than mtime.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub start_time_ms: Option<u64>,
    /// Min/avg/max of the non-spectator players' skill (parsed from the start-script
    /// `skill=[..]` field), when any player has one.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub skill_min: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub skill_avg: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub skill_max: Option<f32>,
    /// True when this file carries coilbox's remix marker — a copy rewritten to run
    /// on a different local build, not an engine-recorded demo.
    pub remixed: bool,
}

/// One chat/system line from a demo's network stream (via `demotool --dump`).
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatLine {
    /// The speaking player's number, when the line names one.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub player: Option<u32>,
    /// The player's name resolved from the start-script, when known.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub player_name: Option<String>,
    pub text: String,
    /// True for engine `SYSTEMMSG` lines (vs a player `CHAT` line).
    pub system: bool,
}

/// A demo's chat log (its `NETMSG_CHAT`/`NETMSG_SYSTEMMSG` lines).
#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct DemoChat {
    pub messages: Vec<ChatLine>,
}

/// One player (or spectator) from a demo's start-script, with the side/ally-team
/// resolved from their team.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PlayerInfo {
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub team: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ally_team: Option<i32>,
    /// Faction (the team's `side`, e.g. `Armada`/`Cortex`/`Legion`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub side: Option<String>,
    /// Normalized team colour `[r, g, b]` (0..1), when present.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rgb_color: Option<[f32; 3]>,
    pub spectator: bool,
    /// True/false when the winner is known and the player isn't a spectator;
    /// `None` when the winner couldn't be determined.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub won: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub skill: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub country_code: Option<String>,
    /// This seat's five counters from the trailer. Absent when the recording
    /// never reached a game over, when the trailer is in a format the decoder
    /// refuses, and when the engine recorded no statistics at all (see
    /// [`DemoTrailer::players`]).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stats: Option<PlayerStats>,
    /// Actions per minute: `stats.num_commands` over the match's minutes.
    ///
    /// Derived here rather than in each surface that shows it, so the one
    /// division and the "there is no answer" case are decided once. Absent
    /// exactly when `stats` is, plus for a match with no measured duration.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub apm: Option<f32>,
}

/// One skirmish AI from a demo's start-script `[aiN]` section, with the
/// side/ally-team/colour resolved from the team it controls. That is the same
/// resolution `PlayerInfo` gets, so a roster or a chart series can treat an AI
/// seat like any other.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AiInfo {
    /// The display name the host gave this bot, e.g. `AI 1`.
    pub name: String,
    /// The AI's identifier, e.g. `SurvivalAI` or `BARb`. This is what names the
    /// opponent, since `name` is often just a slot number.
    pub short_name: String,
    /// The AI's version, e.g. `<game>` for a game-supplied Lua AI.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub team: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ally_team: Option<i32>,
    /// The player number whose machine ran the AI (`host` in the script).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub host: Option<i32>,
    /// Faction (the team's `side`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub side: Option<String>,
    /// Normalized team colour `[r, g, b]` (0..1), when present.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rgb_color: Option<[f32; 3]>,
    /// True/false when the winner is known, and `None` when it couldn't be
    /// determined.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub won: Option<bool>,
}

/// A start box (`startrect`), normalized 0..1 over the map (origin top-left).
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct StartBox {
    pub left: f32,
    pub top: f32,
    pub right: f32,
    pub bottom: f32,
}

/// An ally team: its start box (when the game used box placement) and a
/// representative team colour, for overlaying on the minimap.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AllyTeamInfo {
    pub id: i32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub start_box: Option<StartBox>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub color: Option<[f32; 3]>,
}

/// Decoded replay metadata: native header + start-script + trailer, with
/// demotool as a fallback for the winner when the trailer's format is one the
/// decoder refuses.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DemoInfo {
    pub engine_version: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub game_id: Option<String>,
    /// Battle start, epoch-millis (format with `new Date(ms)`).
    pub start_time_ms: u64,
    /// In-game duration, seconds.
    pub duration_sec: u32,
    /// Wall-clock duration, seconds.
    pub wallclock_sec: u32,
    pub map_name: String,
    /// The game + version, e.g. `Beyond All Reason test-30018-d71d659`.
    pub game_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub start_pos_type: Option<i32>,
    pub winning_ally_teams: Vec<u32>,
    /// False when this file has no answer: the recording never reached a
    /// recorded game over, or its trailer is in a format this decoder
    /// doesn't know and demotool wasn't there (or couldn't say either). The
    /// UI shows "winner unknown" rather than implying a draw.
    pub winners_known: bool,
    pub num_ally_teams: u32,
    pub ally_teams: Vec<AllyTeamInfo>,
    pub players: Vec<PlayerInfo>,
    /// The skirmish AIs the script seated. Separate from `players` because a bot
    /// is not a person: it has no dossier, no skill and no country, and its name
    /// (`AI 1`) is a slot label that repeats across unrelated matches.
    pub ais: Vec<AiInfo>,
    /// The `[modoptions]` section verbatim (key -> value), for surfaces that want
    /// to reproduce the battle's options (e.g. refight-as-skirmish, #368). Empty
    /// when the script carried no `[modoptions]` section.
    pub mod_options: std::collections::HashMap<String, String>,
    /// True when this file carries coilbox's remix marker (a rewritten copy, not an
    /// engine-recorded demo).
    pub remixed: bool,
    /// For a remix, the `gametype` the replay was originally recorded on (before it
    /// was pointed at a local build).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_gametype: Option<String>,
    /// For a remix, the filename of the original replay it was made from, so the UI
    /// can link back to it.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub origin_filename: Option<String>,
}

/// One `TeamStatistics` sample: 20 fields, 80 bytes, written every
/// `teamStatPeriod` seconds of a match.
///
/// Every figure except `frame` is a running total for the whole match so far, so
/// a per-minute view is the difference between two consecutive samples and needs
/// no second series.
///
/// Field order is the engine's `rts/Sim/Misc/TeamStatistics.h` declaration order,
/// which is also the on-disk order: `frame`, twelve `f32`, seven `i32`.
#[derive(Serialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TeamStatSample {
    /// Sim frame the sample was taken at. 30 frames is one second.
    pub frame: i32,
    pub metal_used: f32,
    pub energy_used: f32,
    pub metal_produced: f32,
    pub energy_produced: f32,
    pub metal_excess: f32,
    pub energy_excess: f32,
    pub metal_received: f32,
    pub energy_received: f32,
    pub metal_sent: f32,
    pub energy_sent: f32,
    pub damage_dealt: f32,
    pub damage_received: f32,
    pub units_produced: i32,
    pub units_died: i32,
    pub units_received: i32,
    pub units_sent: i32,
    pub units_captured: i32,
    pub units_out_captured: i32,
    pub units_killed: i32,
}

/// One team's samples for a whole match, in the order the engine recorded them.
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TeamStatSeries {
    /// The `[teamN]` index this series belongs to.
    pub team: i32,
    /// Empty for a team the engine recorded no samples for, which is an answer
    /// ("no statistics") rather than an error.
    pub samples: Vec<TeamStatSample>,
}

/// One player's `PlayerStatistics`: five `i32` counters for the whole match,
/// written once per `[playerN]` seat when the game ended.
///
/// The on-disk order is the one here, which is *not* the order the engine's
/// `rts/Game/Players/PlayerStatistics.h` declares its own members in:
/// `PlayerStatistics` derives from `TeamControllerStatistics`, so the base
/// class's `num_commands`/`unit_commands` come first. Read as declared, a real
/// row reports 416,476 commands over eight minutes instead of 163.
#[derive(Serialize, Clone, Copy, Debug, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PlayerStats {
    /// Orders the player gave. Over the match's minutes this is actions per
    /// minute, the number every RTS player quotes at each other.
    pub num_commands: i32,
    /// Orders that reached a unit, as opposed to orders given. The gap between
    /// this and `num_commands` is a real signal about how someone plays.
    pub unit_commands: i32,
    pub mouse_pixels: i32,
    pub mouse_clicks: i32,
    pub key_presses: i32,
}

/// What the fixed-size records after a replay's demo stream hold.
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DemoTrailer {
    /// The ally-teams that won, straight from the file. Empty is a real outcome
    /// (a game over with nobody winning), not a missing answer.
    pub winning_ally_teams: Vec<u32>,
    /// Seconds between samples, so a caller can turn a frame into a time without
    /// assuming 15.
    pub team_stat_period_sec: u32,
    /// One entry per team the header counts, in team order.
    pub teams: Vec<TeamStatSeries>,
    /// One entry per player the header counts, indexed by the player id the
    /// start-script's `[playerN]` sections use.
    ///
    /// `None` when this match's statistics were never recorded, which the file
    /// says by giving every team zero samples. The bytes are still there and
    /// they still read as integers, but they are whatever was in that memory
    /// (issue #1190): three of the nine replays measured hold command counts
    /// like -335216640 next to nine empty sample series. So the presence of the
    /// block is not evidence, and the decoder refuses to hand it over rather
    /// than leave every caller to remember why.
    pub players: Option<Vec<PlayerStats>>,
}

pub const SCHEMA_VERSION: u32 = 1;

/// Read the store from `path`, returning a default (empty) store if it's absent.
pub fn load_store(path: &std::path::Path) -> Result<StoreFile, String> {
    match std::fs::read_to_string(path) {
        Ok(s) => serde_json::from_str(&s).map_err(|e| format!("invalid content store json: {e}")),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(StoreFile::default()),
        Err(e) => Err(format!("could not read content store: {e}")),
    }
}

/// Write the full store to `path`, creating the parent dir if needed.
pub fn save_store(path: &std::path::Path, store: &StoreFile) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("could not create content store dir: {e}"))?;
    }
    let json = serde_json::to_string_pretty(store).map_err(|e| e.to_string())?;
    std::fs::write(path, json).map_err(|e| format!("could not write content store: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn missing_store_is_default() {
        let p = std::env::temp_dir().join("content_store_does_not_exist_xyz.json");
        let _ = std::fs::remove_file(&p);
        let store = load_store(&p).unwrap();
        assert!(store.user_roots.is_empty());
        assert!(store.snapshot.is_none());
    }

    #[test]
    fn roundtrips_user_roots() {
        let dir = std::env::temp_dir().join("content_store_test");
        let p = dir.join("state.json");
        let _ = std::fs::remove_dir_all(&dir);
        let mut store = StoreFile {
            schema_version: SCHEMA_VERSION,
            ..Default::default()
        };
        store.user_roots.push(UserRoot {
            path: "/tmp/spring".into(),
            label: Some("test".into()),
            forced: true,
        });
        save_store(&p, &store).unwrap();
        let back = load_store(&p).unwrap();
        assert_eq!(back.user_roots.len(), 1);
        assert_eq!(back.user_roots[0].path, "/tmp/spring");
        assert!(back.user_roots[0].forced);
    }
}
