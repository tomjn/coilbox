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
    /// Non-spectator player count.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub player_count: Option<u32>,
    /// Battle start (epoch-millis) from the demo header — more accurate than mtime.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub start_time_ms: Option<u64>,
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

/// Decoded replay metadata: native header + start-script, plus demotool's winner.
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
    /// False when demotool was absent/failed, so the UI shows "winner unknown"
    /// rather than implying a draw.
    pub winners_known: bool,
    pub num_ally_teams: u32,
    pub ally_teams: Vec<AllyTeamInfo>,
    pub players: Vec<PlayerInfo>,
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
