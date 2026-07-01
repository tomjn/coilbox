//! JSON output shapes. Serialized camelCase so the Tauri plugin can pass them
//! straight through to the frontend (matching the rest of coilbox).

use serde::Serialize;
use std::collections::BTreeMap;

/// One selectable item of a `list`-typed option.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OptionListItem {
    pub key: String,
    pub name: String,
}

/// A map or game configuration option: its key, label, description, and — when the
/// engine build exposes them — its type, default, numeric bounds and list items,
/// so the UI can render a checkbox / number / select instead of a bare text box.
#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ConfigOption {
    pub key: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    /// `"bool"`, `"number"`, `"list"`, or `"string"` (omitted if unknown).
    #[serde(rename = "type", skip_serializing_if = "Option::is_none")]
    pub kind: Option<String>,
    /// Default value, stringified (`"1"`/`"0"` for bool, the item key for list).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub default: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub number_min: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub number_max: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub number_step: Option<f32>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub list_items: Vec<OptionListItem>,
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
    pub archives: Vec<Archive>,
    /// mapinfo metadata (description, author, dimensions, ...).
    pub info: BTreeMap<String, String>,
    /// Map proportions (for undistorted minimap display); ratio = aspect ratio.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub width: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub height: Option<u32>,
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
    /// Wind power range (`atmosphere.minWind`/`maxWind` from mapinfo.lua).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub min_wind: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_wind: Option<f32>,
    /// Tidal power (`water.tidalStrength` from mapinfo.lua).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tidal_strength: Option<f32>,
    pub errors: Vec<String>,
}

/// A rendered heightmap, returned by the lazy `heightmap` mode: a downscaled
/// grayscale PNG plus the world-height bounds needed for correct displacement.
#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct HeightmapOutput {
    /// Grayscale PNG `data:` URL of the (downscaled) heightmap, for a displacement map.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data_url: Option<String>,
    /// Full heightmap dimensions `(mapx+1, mapy+1)` before downscaling (its ratio
    /// is the map's true aspect ratio).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub width: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub height: Option<u32>,
    /// World height at infomap value 0 (where the flat water plane sits).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub min_height: Option<f32>,
    /// World height at infomap value 65535.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_height: Option<f32>,
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
    /// Non-fatal unitsync diagnostics attributed to this game during the scan.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub warnings: Vec<String>,
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

/// Output of the lazy `--map --map-info` mode: one map's options + any
/// diagnostics attributed while reading them (requires mounting the map
/// archive, so it's fetched on demand, not during the enumeration scan).
#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct MapInfoOutput {
    /// Map options (from mapoptions.lua), when present.
    pub options: Vec<ConfigOption>,
    /// Sync checksum (from GetMapChecksumFromName) — hashes the whole archive, so
    /// it's computed lazily here, not during the enumeration scan.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub checksum: Option<String>,
    /// Non-fatal unitsync diagnostics attributed to this map.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub warnings: Vec<String>,
    pub errors: Vec<String>,
}

/// A skirmish AI available to play against: a native engine AI or a game Lua AI.
#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SkirmishAi {
    /// unitsync `shortName` — the value written to `[AI].ShortName` / `[TEAM].LuaAI`.
    pub short_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    /// `"native"` (engine-bundled) or `"lua"` (declared inside the game archive).
    pub kind: String,
}

/// Output of the `skirmish-ais` mode: the AIs available, optionally for a game.
#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SkirmishAiOutput {
    pub ais: Vec<SkirmishAi>,
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

/// One member of an archive's file tree.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveFileEntry {
    /// Slash-separated path within the archive.
    pub path: String,
    pub size: u64,
}

/// Output of the `--archive` (tree) mode: the archive's flat member list plus
/// its resolved on-disk path (for the `.sdd` "open folder" action).
#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveTreeOutput {
    pub files: Vec<ArchiveFileEntry>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub archive_path: Option<String>,
    pub errors: Vec<String>,
}

/// Output of the `--archive --file` (member preview) mode. `kind` selects which
/// field carries the content: `text` -> `text`, `image` -> `data_url`,
/// `binary` -> neither (metadata only).
#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveFileOutput {
    /// `"text"`, `"image"`, or `"binary"`.
    pub kind: String,
    /// Decoded (utf8-lossy) contents, when `kind == "text"`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    /// `data:` URL, when `kind == "image"`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data_url: Option<String>,
    /// The member's real size in bytes (before any cap).
    pub size: u64,
    /// True when the member exceeded the preview cap and was not rendered.
    pub truncated: bool,
    pub errors: Vec<String>,
}

/// `--lua` mode output. `result` is the pretty-printed value the script returned
/// (set on success); `error` is a compile/runtime error from the Lua parser (set
/// on failure). Exactly one of the two is normally set. `errors` carries
/// non-fatal unitsync diagnostics (e.g. archive-mount warnings).
#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct LuaExecOutput {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    pub errors: Vec<String>,
}

/// Output of the `--archive --file --extract` (download) mode: the number of
/// bytes written to the destination path, plus any diagnostics.
#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveExtractOutput {
    /// Bytes written to the destination (0 when extraction failed).
    pub size: u64,
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
