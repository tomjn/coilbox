//! JSON output shapes. Serialized camelCase so the Tauri plugin can pass them
//! straight through to the frontend (matching the rest of coilbox).

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

/// One selectable item of a `list`-typed option.
#[derive(Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct OptionListItem {
    pub key: String,
    pub name: String,
}

/// A map or game configuration option: its key, label, description, and — when the
/// engine build exposes them — its type, default, numeric bounds and list items,
/// so the UI can render a checkbox / number / select instead of a bare text box.
#[derive(Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct ConfigOption {
    pub key: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    /// `"bool"`, `"number"`, `"list"`, `"string"`, or `"section"` (omitted if
    /// unknown). A `"section"` is a group header, not a setting: it carries no
    /// value and must never be written to a start script.
    #[serde(rename = "type", skip_serializing_if = "Option::is_none")]
    pub kind: Option<String>,
    /// Key of the section this option belongs under; absent when top-level.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub section: Option<String>,
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
    /// Map proportions (for undistorted minimap display); ratio = aspect ratio.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub width: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub height: Option<u32>,
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
    /// Water/sky/sun appearance from mapinfo.lua, for the 3D preview's lighting and
    /// water colour. Colours are `[r, g, b]` in 0..1; omitted fields stay `None`.
    /// `voidWater`/`voidGround` are the transparency flags (space maps hide the
    /// water plane and everything below the sea plane).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub void_water: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub void_ground: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub void_alpha_min: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub water_color: Option<[f32; 3]>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub water_alpha: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub water_plane_color: Option<[f32; 3]>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub water_absorb: Option<[f32; 3]>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub water_base_color: Option<[f32; 3]>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub water_min_color: Option<[f32; 3]>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub force_rendering: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sky_color: Option<[f32; 3]>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fog_color: Option<[f32; 3]>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cloud_color: Option<[f32; 3]>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cloud_density: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sun_dir: Option<[f32; 3]>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sun_color: Option<[f32; 3]>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ground_ambient_color: Option<[f32; 3]>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ground_diffuse_color: Option<[f32; 3]>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ground_specular_color: Option<[f32; 3]>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ground_shadow_density: Option<f32>,
    pub errors: Vec<String>,
}

/// Output of the lazy `--map --map-skybox` mode: a map's skybox DDS cube map as a
/// raw-bytes `data:` URL, for the 3D preview's sky. `data_url` is absent when the
/// map declares no `atmosphere.skyBox`, or the referenced member can't be read.
#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct MapSkyboxOutput {
    /// `data:application/octet-stream` URL of the raw DDS bytes (parsed by the
    /// frontend's `DDSLoader`), when the map ships a skybox.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data_url: Option<String>,
    pub errors: Vec<String>,
}

/// One game's resolved header art in the batch `game-headers` output. `data_url`
/// is absent when the game has no usable loadpicture/folder art.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GameHeaderItem {
    /// The game's display name (matches `GameItem.name`), for keying in the UI.
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data_url: Option<String>,
}

/// Output of the batch `game-headers` mode: header art for every game in one
/// Init, for the Games grid. Keyed on cheap file identity (not sync-checksum).
#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct GameHeadersOutput {
    pub headers: Vec<GameHeaderItem>,
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

/// A rendered metal infomap, returned by the lazy `metalmap` mode: a downscaled
/// green-on-transparent RGBA PNG marking where mexes can extract, for overlaying
/// on the minimap. Transparent where there's no metal, so it reads over the map.
#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct MetalmapOutput {
    /// RGBA PNG `data:` URL of the (downscaled) metal infomap, ready for an `<img>`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data_url: Option<String>,
    /// Metal infomap dimensions before downscaling (its ratio is the map's aspect).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub width: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub height: Option<u32>,
    pub errors: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GameItem {
    pub name: String,
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
#[derive(Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct Side {
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub start_unit: Option<String>,
    /// Human-friendly name of the start unit (from `GetFullUnitName`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub start_unit_name: Option<String>,
}

/// One unit available in a game (from `GetUnitName`/`GetFullUnitName`).
#[derive(Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct UnitEntry {
    pub name: String,
    /// Human-friendly name of the unit (from `GetFullUnitName`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub full_name: Option<String>,
}

/// Output of the lazy `game` mode: a game's sides and unit count (requires
/// loading the game's archive set, so it's fetched on demand, not during scan).
#[derive(Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct GameInfoOutput {
    pub sides: Vec<Side>,
    pub unit_count: u32,
    /// Every unit in the game, sorted by internal name.
    pub units: Vec<UnitEntry>,
    /// Game options (from modoptions.lua), when present.
    pub options: Vec<ConfigOption>,
    /// Sync checksum (from GetPrimaryModChecksum via the primary archive) —
    /// hashes the archive plus its dependencies, so it's computed lazily here,
    /// not during the enumeration scan.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub checksum: Option<String>,
    pub errors: Vec<String>,
}

/// One unit in the reusable unit dataset: its internal name, friendly name, and
/// the internal names of the units it can build (`buildoptions`, lowercased). The
/// general graph the build-tree viewer, unit include/exclude settings, and the
/// campaign unit restrictions can all read from.
#[derive(Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct UnitDatasetEntry {
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub full_name: Option<String>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub build_options: Vec<String>,
    /// Whether the unit can move (a mobile unit) vs a static building — derived
    /// from the unitdef's speed. Static buildings are `false`.
    pub mobile: bool,
}

/// Output of the lazy `--unit-dataset` mode: the whole game's unit graph (units +
/// their `buildoptions` edges). Loaded on demand (mounts the game's archive set),
/// never produced during the scan. Disk-cached like `GameInfoOutput`, in its own
/// key namespace.
#[derive(Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct UnitDatasetOutput {
    /// Every unit in the game, sorted by internal name.
    pub units: Vec<UnitDatasetEntry>,
    /// Sync checksum (from GetPrimaryModChecksum) — hashes the archive plus its
    /// dependencies, so it's computed lazily here, not during the scan.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub checksum: Option<String>,
    pub errors: Vec<String>,
}

/// One resolved start unit: its human-friendly name (from the unitdef `name`
/// field) and its build-icon `data:` URL. Either may be absent. Also the on-disk
/// cache record (round-tripped as JSON), so it derives Deserialize too.
#[derive(Serialize, Deserialize, Default, Clone)]
#[serde(rename_all = "camelCase")]
pub struct UnitDisplay {
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub icon: Option<String>,
}

impl UnitDisplay {
    /// Nothing resolved — no name and no icon.
    pub fn is_empty(&self) -> bool {
        self.name.is_none() && self.icon.is_none()
    }
}

/// Output of `--unit-buildpics`: a map of unit internal name -> its display info
/// (friendly name + build icon), for the units that resolved. Units with nothing
/// usable are absent (and still cached on disk so re-runs skip them).
#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct UnitBuildpicsOutput {
    pub units: std::collections::BTreeMap<String, UnitDisplay>,
    pub errors: Vec<String>,
}

/// One side's resolved faction emblem: a PNG `data:` URL plus the source image's
/// longest pixel side. The dimension lets the UI demote a tiny (16px) archive
/// sidepic below a crisper curated (catalog/profile) image instead of upscaling it.
#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct FactionLogoEntry {
    pub side: String,
    pub data_uri: String,
    pub max_dim: u32,
}

/// Output of `--faction-logos`: each requested side whose `Sidepics/<side>` emblem
/// resolved, plus any diagnostics. Sides with no usable image are simply absent.
#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct FactionLogosOutput {
    pub logos: Vec<FactionLogoEntry>,
    pub errors: Vec<String>,
}

/// Output of the lazy `--map --map-info` mode: one map's options + any
/// diagnostics attributed while reading them (requires mounting the map
/// archive, so it's fetched on demand, not during the enumeration scan).
#[derive(Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
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
    /// How to render the value: `"bool"` | `"number"` | `"string"`.
    #[serde(rename = "type")]
    pub value_type: &'static str,
    /// The value as read (stringified); empty string when unset and no default.
    pub value: String,
    /// The engine's default for this key (stringified), for reset + change hints.
    pub default: String,
}

/// Output of the `config` mode: the curated engine settings and the config file path.
#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct EngineConfigOutput {
    pub settings: Vec<EngineConfigSetting>,
    /// Path of the `springsettings.cfg` unitsync reads, when the build exposes it.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub config_path: Option<String>,
    /// Whether this unitsync build can *write* config (`SetSpringConfig*` present).
    pub writable: bool,
    pub errors: Vec<String>,
}

/// Output of the `config-set` mode: whether the write applied, plus diagnostics.
#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct EngineConfigWriteOutput {
    pub ok: bool,
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
    /// Sync checksum (from GetArchiveChecksum) — hashes the whole archive, so
    /// it's computed lazily here, not during the enumeration scan.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub checksum: Option<String>,
    pub errors: Vec<String>,
}

/// Output of the `--archive --file` (member preview) mode. `kind` selects which
/// field carries the content: `text` -> `text`, `image`/`audio` -> `data_url`,
/// `binary` -> neither (metadata only).
#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveFileOutput {
    /// `"text"`, `"image"`, `"audio"`, or `"binary"`.
    pub kind: String,
    /// Decoded (utf8-lossy) contents, when `kind == "text"`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    /// `data:` URL, when `kind == "image"` or `kind == "audio"`.
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

/// `--lua --chunks-file` (REPL) mode output. `result` is the pretty-printed
/// value the *final* chunk returned; `error` is a compile/runtime error (or a
/// "session replay diverged…" message when an earlier chunk failed, in which
/// case `diverged_at` holds that chunk's 1-based index); `prints` is the final
/// chunk's `print` output, newline-joined. `errors` carries non-fatal unitsync
/// diagnostics.
#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct LuaReplOutput {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub diverged_at: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub prints: Option<String>,
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
