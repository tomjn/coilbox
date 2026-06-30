//! JSON output shapes. Serialized camelCase so the Tauri plugin can pass them
//! straight through to the frontend (matching the rest of coilbox).

use serde::Serialize;
use std::collections::BTreeMap;

/// A map or game configuration option (its key, label and description).
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigOption {
    pub key: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
}

/// A team start position in map world coordinates (elmos).
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StartPos {
    pub x: f32,
    pub z: f32,
}

/// An archive (`.sdz`/`.sd7`/`.sdd`) backing a map or game.
#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Archive {
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    /// Hex CRC, when the engine build exposes a checksum accessor.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub checksum: Option<String>,
    /// On-disk size in bytes (file size, or recursive total for a `.sdd` dir),
    /// when the archive's path resolves.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub size: Option<u64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MapItem {
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub checksum: Option<String>,
    pub archives: Vec<Archive>,
    /// mapinfo metadata (description, author, dimensions, ...).
    pub info: BTreeMap<String, String>,
    /// Map proportions (for undistorted minimap display); ratio = aspect ratio.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub width: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub height: Option<u32>,
    /// Map options (from mapoptions.lua), when present.
    pub options: Vec<ConfigOption>,
}

/// One map thumbnail in the batch `thumbnails` output.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Thumbnail {
    pub name: String,
    pub data_url: String,
}

/// Output of the batch `thumbnails` mode: a small minimap per map, one Init.
#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ThumbnailsOutput {
    pub thumbnails: Vec<Thumbnail>,
    pub errors: Vec<String>,
}

/// A rendered minimap, returned by the lazy `minimap` mode.
#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct MinimapOutput {
    /// PNG `data:` URL, ready to drop into an `<img src>`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data_url: Option<String>,
    /// Side length in pixels.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub side: Option<u32>,
    /// Team start positions in map world coordinates (for overlaying on the map).
    pub start_positions: Vec<StartPos>,
    pub errors: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GameItem {
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub checksum: Option<String>,
    /// The game's own archive.
    pub primary_archive: Archive,
    /// Archives the game depends on (its primary archive excluded).
    pub dependency_archives: Vec<Archive>,
    /// modinfo metadata (name, shortname, version, description, ...).
    pub info: BTreeMap<String, String>,
}

/// A faction/side of a game, with its commander/start unit.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Side {
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub start_unit: Option<String>,
    /// Human-friendly name of the start unit (from `GetFullUnitName`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub start_unit_name: Option<String>,
}

/// Output of the lazy `game` mode: a game's sides and unit count (requires
/// loading the game's archive set, so it's fetched on demand, not during scan).
#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct GameInfoOutput {
    pub sides: Vec<Side>,
    pub unit_count: u32,
    /// Game options (from modoptions.lua), when present.
    pub options: Vec<ConfigOption>,
    pub errors: Vec<String>,
}

/// One engine configuration value, read from a curated key via `GetSpringConfig*`.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineConfigSetting {
    pub key: String,
    pub label: String,
    pub category: String,
    /// The value as read (stringified); empty string when unset and no default.
    pub value: String,
}

/// Output of the `config` mode: the curated engine settings and the config file path.
#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct EngineConfigOutput {
    pub settings: Vec<EngineConfigSetting>,
    /// Path of the `springsettings.cfg` unitsync reads, when the build exposes it.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub config_path: Option<String>,
    pub errors: Vec<String>,
}

#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ScanOutput {
    pub maps: Vec<MapItem>,
    pub games: Vec<GameItem>,
    /// Non-fatal diagnostics drained from unitsync during the scan.
    pub errors: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sync_version: Option<String>,
}
