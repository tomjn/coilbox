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

/// One map's `mapinfo` metadata in the batch `map-meta` output.
#[derive(Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct MapMeta {
    pub name: String,
    /// mapinfo metadata (description, author, ...).
    pub info: BTreeMap<String, String>,
}

/// Output of the batch `map-meta` mode: mapinfo metadata per map, one Init.
#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct MapMetaOutput {
    pub maps: Vec<MapMeta>,
    pub errors: Vec<String>,
}

/// One map thumbnail in the batch `thumbnails` output.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Thumbnail {
    pub name: String,
    /// Cache file name, served over `coilbox://unitsyncthumb/`. Set whenever the
    /// render reached disk, and preferred by callers over `dataUrl`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file: Option<String>,
    /// Only set when there was no cache dir, or the write failed.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data_url: Option<String>,
    /// Map proportions (for undistorted minimap display); ratio = aspect ratio.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub width: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub height: Option<u32>,
    /// The map's size in elmos, which is the space start positions, blueprint
    /// footprints and every other overlay are in (issue #1629). Derived from the
    /// proportions above, which are metal infomap samples and not a length.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub width_elmos: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub height_elmos: Option<u32>,
}

/// Output of the batch `thumbnails` mode: a small minimap per map, one Init.
#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ThumbnailsOutput {
    pub thumbnails: Vec<Thumbnail>,
    pub errors: Vec<String>,
}

/// A rendered minimap, returned by the lazy `minimap` mode.
///
/// `asset` and `assetSkipped` only appear when the caller asked for hub assets
/// (`--asset-dir`), and then exactly one of them is set. The asset is the mip 1
/// square texture rather than whatever mip the display render used, which is the
/// whole of #1630. It is square and the map is not, so `widthElmos` and
/// `heightElmos` above are what a consumer stretches it back to: both travel in
/// this one output so nothing has to ask twice.
#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct MinimapOutput {
    /// Cache file name, served over `coilbox://unitsyncthumb/`. Set whenever the
    /// render reached disk, and preferred by callers over `dataUrl`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file: Option<String>,
    /// PNG `data:` URL, only set when there was no cache dir or the write failed.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data_url: Option<String>,
    /// Side length in pixels.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub side: Option<u32>,
    /// The map's size in elmos, which is the space the start positions below are
    /// in, and what an overlay drawn on this minimap is lined up against
    /// (issue #1629).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub width_elmos: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub height_elmos: Option<u32>,
    /// Team start positions in map world coordinates (for overlaying on the map).
    pub start_positions: Vec<StartPos>,
    /// Wind power range (`atmosphere.minWind`/`maxWind` from mapinfo.lua).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub min_wind: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_wind: Option<f32>,
    /// Tidal power (root-level `tidalStrength` from mapinfo.lua).
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
    /// The mip 1 texture stored as the hub's `minimap` asset.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub asset: Option<MapOverlayAsset>,
    /// Why there is no asset, when one was asked for.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub asset_skipped: Option<MapOverlaySkip>,
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
    /// Cache file name, served over `coilbox://unitsyncheader/`. Set whenever the
    /// resolved art reached disk, and preferred by callers over `dataUrl`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file: Option<String>,
    /// Only set when there was no cache dir, or the write failed.
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
///
/// `asset` and `assetSkipped` only appear when the caller asked for hub assets
/// (`--asset-dir`), and then exactly one of them is set. The asset is the full
/// resolution 16 bit grid rather than the downscaled picture above, which is the
/// whole of #1627.
#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct HeightmapOutput {
    /// Cache file name, served over `coilbox://unitsyncthumb/`. Set whenever the
    /// render reached disk, and preferred by callers over `dataUrl`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file: Option<String>,
    /// Grey WebP `data:` URL of the (downscaled) heightmap, only set when there
    /// was no cache dir or the write failed.
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
    /// World height at the picture's black, and at its white (issue #1730).
    ///
    /// Not [`Self::min_height`] and [`Self::max_height`]: the picture is
    /// rescaled into the window its own samples occupy, so a reader that
    /// displaced it by the map's range would flatten every map whose heights do
    /// not reach both ends of the 16 bit scale. Absent when the picture did not
    /// render.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub picture_min_height: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub picture_max_height: Option<f32>,
    /// The same picture stored as the hub's `overlay:height` asset.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub asset: Option<MapOverlayAsset>,
    /// Why there is no asset, when one was asked for.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub asset_skipped: Option<MapOverlaySkip>,
    pub errors: Vec<String>,
}

/// The map's raw heights, returned by the lazy `height-field` mode: the file the
/// grid was written to plus the bounds its words span (issue #1490).
///
/// No inline fallback. The grid runs to tens of megabytes on a large map, which
/// is not something to put on the bridge as base64, so without a cache directory
/// this mode reports the failure and the caller goes quiet.
#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct HeightFieldOutput {
    /// Cache file name, served over `coilbox://unitsyncthumb/`. Little endian
    /// `u16` words, row major, `width * height` of them.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file: Option<String>,
    /// Grid dimensions, `(mapx+1, mapy+1)`, which is the engine's own corner
    /// grid at 8 elmo spacing.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub width: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub height: Option<u32>,
    /// World height at word 0, and at word 65536. The engine's conversion is
    /// `minHeight + word * (maxHeight - minHeight) / 65536`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub min_height: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_height: Option<f32>,
    pub errors: Vec<String>,
}

/// One map overlay layer encoded as the asset the hub takes, written to disk.
///
/// Like [`UnitBuildpicAsset`], the bytes stay out of the JSON and the file goes
/// in the asset directory for the uploader (#1633) to read off `path`.
///
/// There is no `source_member` here. A unit's picture is an archive member and a
/// map's overlay is not: unitsync produces it from the map file, so the raw
/// samples are the only source bytes there are.
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct MapOverlayAsset {
    /// The hub's variant name for this layer, e.g. `overlay:metal`.
    pub variant: String,
    /// How the bytes were produced. Always `extracted` here: a map layer is read
    /// out of the archive's infomaps rather than drawn.
    pub origin: String,
    /// The name the archive this was read out of declares for itself, which is
    /// what the hub row's `source_archive` holds. See
    /// [`crate::archive::archive_name_for_map`] for why a map's repeats its
    /// `map_name`.
    pub source_archive: String,
    /// Absolute path to the encoded file, named after `hash`.
    pub path: String,
    /// sha256 of the encoded bytes. The hub's object path component.
    pub hash: String,
    /// sha256 of the infomap samples as `GetInfoMap` returned them, before any
    /// colouring or encoding. Identity and dedupe compare on this, because it
    /// does not move when the encoder does.
    pub source_hash: String,
    pub encode_profile: String,
    pub mime: String,
    /// The encoded grid, which is the infomap's own sample counts: an overlay
    /// class has no edge cap, so nothing is downscaled.
    pub width: u32,
    pub height: u32,
    pub bytes: u64,
    /// World height at sample 0 and at sample 65535, for `overlay:height` and
    /// nothing else. They are what turn samples back into elmos and nothing
    /// downstream can recover them from the image, so they travel with the asset
    /// rather than beside it: whatever uploads the bytes has to put these on the
    /// row in the same request (spec 13.2).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub min_height: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_height: Option<f32>,
}

/// Why a map produced no overlay asset. Each is a different answer and only some
/// of them are anyone's bug.
#[derive(Serialize, Deserialize, Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "kebab-case")]
pub enum MapOverlaySkip {
    /// The map has no infomap of this kind, so there is nothing to store.
    NoSource,
    /// `minimap` only: the texture is one repeated colour, so it is a blank
    /// square rather than a picture of the map (issue #1658). Storing it would
    /// beat the placeholder a consumer generates from the map's name, which is
    /// the better of the two.
    Blank,
    /// The infomap is there and the read failed, which is coilbox's problem.
    ReadFailed,
    /// `overlay:height` only: the samples read and the world-height bounds did
    /// not, so what the samples mean is unknown. Storing them anyway would put a
    /// grid of numbers in the hub that nothing can convert to elmos.
    NoBounds,
    /// libwebp refused it.
    EncodeFailed,
    /// Encoded past the class's byte cap, which the hub also applies.
    TooLarge,
    /// Encoded, and the file could not be written to the asset directory.
    NotWritten,
}

/// A rendered metal infomap, returned by the lazy `metalmap` mode: a downscaled
/// green-on-transparent RGBA PNG marking where mexes can extract, for overlaying
/// on the minimap. Transparent where there's no metal, so it reads over the map.
///
/// `asset` and `assetSkipped` only appear when the caller asked for hub assets
/// (`--asset-dir`), and then exactly one of them is set. They carry the density
/// values rather than the picture above, which is the whole of #1626.
#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct MetalmapOutput {
    /// Cache file name, served over `coilbox://unitsyncthumb/`. Set whenever the
    /// render reached disk, and preferred by callers over `dataUrl`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file: Option<String>,
    /// RGBA PNG `data:` URL of the (downscaled) metal infomap, only set when there
    /// was no cache dir or the write failed.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data_url: Option<String>,
    /// Metal infomap dimensions before downscaling (its ratio is the map's aspect).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub width: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub height: Option<u32>,
    /// The raw density stored as the hub's `overlay:metal` asset.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub asset: Option<MapOverlayAsset>,
    /// Why there is no asset, when one was asked for.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub asset_skipped: Option<MapOverlaySkip>,
    pub errors: Vec<String>,
}

/// A map's terrain-type infomap, returned by the `typemap` mode: the raw type
/// indices stored as the hub's `overlay:type` asset.
///
/// No picture and no cache file, unlike the metal and height modes. Nothing in
/// coilbox draws a type map, so there is no display output to share the read
/// with, and the mode does nothing at all without `--asset-dir`.
#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct TypemapOutput {
    /// Type infomap dimensions, `(mapx/2, mapy/2)`, the same grid the metal
    /// infomap is on.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub width: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub height: Option<u32>,
    /// The raw type indices stored as the hub's `overlay:type` asset.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub asset: Option<MapOverlayAsset>,
    /// Why there is no asset. Exactly one of this and `asset` is always set.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub asset_skipped: Option<MapOverlaySkip>,
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
    /// The unitdef's `objectname`: the model file the engine draws this unit
    /// with, resolved against `objects3d/`. Often carries no extension, in which
    /// case the engine tries `.s3o` then `.3do`. Absent for a unit that names no
    /// model at all.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub object_name: Option<String>,
    /// The unitdef's `footprintx`/`footprintz`: how much ground the unit stands
    /// on, in build squares. `Game.footprintScale` times `Game.squareSize` elmos
    /// each, which is 16. One square for a unit that declares nothing, the same
    /// floor the engine applies.
    pub footprint_x: u32,
    pub footprint_z: u32,
    /// The unitdef's `maxSlope` in degrees, clamped to the 0..89 the engine
    /// clamps it to. This is what decides whether a building will stand on a
    /// piece of ground: the engine turns it into `40 * tan(maxSlope)` elmos of
    /// height difference it will tolerate across the footprint.
    ///
    /// `None` on a line written before this field existed, which is not the
    /// same as zero. Zero is a def asking for flat ground, `None` is a dataset
    /// that cannot answer the question.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_slope: Option<f32>,
    /// Whether the building sits on the water rather than on the seabed, from
    /// the unitdef's `floater` or its having a `waterline`. A floater is exempt
    /// from the slope test wherever the ground is below sea level.
    pub float_on_water: bool,
    /// The unitdef's `minWaterDepth`/`maxWaterDepth`, the other half of the
    /// engine's `CheckTerrainConstraints`: the ground under every square of the
    /// footprint must lie in `[-maxWaterDepth, -minWaterDepth]`. A naval yard
    /// declares a `minWaterDepth` so it can only go in the sea, a land building
    /// declares a `maxWaterDepth` of 0 so it cannot.
    ///
    /// `None` on a line written before these fields existed, for the same
    /// reason `max_slope` is. The engine's own defaults are -10e6 and +10e6, a
    /// band so wide it refuses nothing, and a line that predates the fields is
    /// not claiming that band.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub min_water_depth: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_water_depth: Option<f32>,
    /// The unitdef's `waterline`: how far below the water a floater sits.
    /// `GetBuildHeight` levels a floater to `-waterline` rather than to the
    /// ground, so without it a floater cannot be judged at all.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub waterline: Option<f32>,
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

/// One drawable batch inside a piece: an indexed triangle list whose corners all
/// sample the same texture. An `.s3o` piece is always one batch, because the
/// format binds one texture per model. A `.3do` piece is one batch per distinct
/// texture its faces name, which is what makes both formats fit this shape.
#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ModelGroup {
    /// Which entry of [`UnitModelOutput::textures`] this batch samples. `None`
    /// for a `.3do` face the format gives a flat palette colour rather than a
    /// texture.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub texture: Option<String>,
    /// x, y, z per vertex.
    pub positions: Vec<f32>,
    /// x, y, z per vertex.
    pub normals: Vec<f32>,
    /// u, v per vertex.
    pub uvs: Vec<f32>,
    /// Three indices per triangle, into this batch's own vertices.
    pub indices: Vec<u32>,
}

/// One piece of the model tree, with its geometry already triangulated. Mirrors
/// the `Piece` both reader crates expose: a name, a translation from the parent,
/// and children. A piece with no groups is hierarchy only (a flare or aim point).
#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ModelPiece {
    pub name: String,
    pub offset: [f32; 3],
    pub groups: Vec<ModelGroup>,
    pub children: Vec<ModelPiece>,
}

/// One texture the model asks for, and what became of it. `file` empty means
/// nothing in the archive matched, which the viewer says on screen rather than
/// drawing an untextured mesh that looks like a bug.
#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ModelTexture {
    /// The name as the model file gives it, and the key groups refer to.
    pub name: String,
    /// The archive member it resolved to. Empty when nothing matched.
    pub source: String,
    /// The file written into the texture cache dir, which the webview loads over
    /// the asset protocol. Empty when nothing matched.
    pub file: String,
    /// A `.3do` name listed in the game's `unittextures/tatex/teamtex.txt`: a
    /// region the engine paints in the player's colour. The file behind it is a
    /// flat magenta placeholder, so it is not read and the viewer picks a colour
    /// instead. Nobody has ever seen a magenta commander in a game.
    pub team_colour: bool,
}

/// Output of `--unit-model`: one unit's model, read out of a game archive and
/// flattened so the viewer draws `.s3o` and `.3do` the same way.
#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct UnitModelOutput {
    /// `"s3o"` or `"3do"`. Empty when nothing was read.
    pub format: String,
    /// The archive member the model came from, as the archive stores it.
    pub path: String,
    pub radius: f32,
    pub height: f32,
    pub mid: [f32; 3],
    #[serde(skip_serializing_if = "Option::is_none")]
    pub root: Option<ModelPiece>,
    pub textures: Vec<ModelTexture>,
    /// An `.s3o`'s second texture, whose red channel marks the regions the
    /// engine paints in the owning player's colour. Those regions are black in
    /// the first texture, so a viewer that ignores this draws a unit with black
    /// holes where its markings should be.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub team_mask: Option<ModelTexture>,
    /// Faces a `.3do` draws in a flat colour from the Total Annihilation
    /// palette, which is engine-embedded and not in the archive. They are drawn
    /// plain grey, so the count is reported rather than hidden.
    pub palette_faces: u32,
    pub errors: Vec<String>,
}

/// One model of a `--unit-models` batch: where the flattened model was written,
/// rather than the model itself (issue #1684).
///
/// The bytes stay out of the JSON for the same reason the textures already do. A
/// flattened model is a list of floats per vertex and runs to megabytes, and a
/// blueprint asks for twenty at once, so the batch writes each one into the
/// model-texture cache and names it. The webview reads it back over the
/// `unitmodel` asset protocol root, beside the textures it refers to.
#[derive(Serialize, Deserialize, Default, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct UnitModelFile {
    /// The file in the model-texture cache dir. Holds one [`UnitModelOutput`]
    /// as JSON.
    pub file: String,
    /// The archive member the model came from, which is what the file is named
    /// after: two units sharing one model share one file.
    pub path: String,
    /// `"s3o"` or `"3do"`.
    pub format: String,
}

/// Output of `--unit-models`: a batch of units' models read in one archive
/// mount, written to the model-texture cache.
#[derive(Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct UnitModelsOutput {
    /// Keyed by the `objectname` as asked for, so a caller looks up what it
    /// sent rather than what the archive called it.
    pub models: BTreeMap<String, UnitModelFile>,
    /// The objects that produced no model, and why. An object is in exactly one
    /// of the two maps.
    pub skipped: BTreeMap<String, String>,
    pub errors: Vec<String>,
}

/// A top down render encoded as the asset the hub takes, written to disk.
///
/// Everything else in the corpus is extracted from an archive. This one is
/// generated, which is why it carries the two fields that say what generated it:
/// `model_digest` names what was drawn and `renderer_version` names what drew it.
/// Together they are what `source_hash` is over.
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct UnitRenderAsset {
    /// The hub's variant name, `render:<angle>`.
    pub variant: String,
    /// How the bytes were produced. Always `rendered` here, against `extracted`
    /// for everything read straight out of an archive.
    pub origin: String,
    /// The name the archive the model was read out of declares for itself, which
    /// is what the hub row's `source_archive` holds. A render is drawn rather
    /// than read, and it is drawn from a model that came out of an archive, so
    /// the provenance is the same question with the same answer.
    pub source_archive: String,
    /// Absolute path to the encoded file, named after `hash`.
    pub path: String,
    /// sha256 of the encoded bytes. The hub's object path component.
    pub hash: String,
    /// The identity dedupe and the have check compare on, over the render's
    /// inputs rather than its pixels. See `assetencode::render_source_hash`.
    pub source_hash: String,
    /// The archive member the model was read from.
    pub source_member: String,
    /// sha256 over the model file and its textures, the part of `source_hash`
    /// that comes out of the archive.
    pub model_digest: String,
    /// Which renderer drew it, declared by the webview side that did the drawing.
    pub renderer_version: u32,
    /// The footprint the frame was taken on, in build squares. Reported because
    /// the consumer insets the bleed by one square to get back to it, and the hub
    /// does not hold footprints.
    pub footprint_x: u32,
    pub footprint_z: u32,
    pub encode_profile: String,
    pub mime: String,
    pub width: u32,
    pub height: u32,
    pub bytes: u64,
}

/// Why a unit produced no render asset.
#[derive(Serialize, Deserialize, Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "kebab-case")]
pub enum RenderSkip {
    /// The pixels are not the shape this footprint frames to. The hub cannot
    /// check this, because it does not hold footprints, so it is checked here or
    /// nowhere.
    MisFramed,
    /// The pixel buffer is missing, unreadable, or not `width * height * 4` long.
    NoPixels,
    /// An angle the vocabulary does not list, which the hub would refuse too.
    UnknownAngle,
    /// The game archive has no model for this unit's `objectname`.
    NoModel,
    /// libwebp refused it.
    EncodeFailed,
    /// Encoded past the class's byte cap, which the hub also applies.
    TooLarge,
    /// Encoded, and the file could not be written to the asset directory.
    NotWritten,
}

/// Output of `--unit-render`: one unit's top down render, encoded from pixels the
/// webview drew.
///
/// Exactly one of `asset` and `assetSkipped` is set. `dataUrl` carries the
/// encoded bytes back as well, unlike the extraction modes: there is one render
/// per call rather than a roster of them, and the caller drew the picture and has
/// a reason to look at what came out of the encoder.
#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct UnitRenderOutput {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub asset: Option<UnitRenderAsset>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub asset_skipped: Option<RenderSkip>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data_url: Option<String>,
    pub errors: Vec<String>,
}

/// One unit to work out a render key for: which model, and the footprint the
/// render will be framed on.
///
/// The footprint comes from the caller rather than from the archive on purpose.
/// `--unit-render` frames the pixels with the footprint it is given, so a key
/// derived from a different one would name a picture nobody is going to draw.
#[derive(Deserialize, Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct UnitRenderKeyRequest {
    /// The unit's internal name, which is what the hub keys a unit picture on.
    pub unit: String,
    /// The unitdef's `objectname`, which is what the model is found by.
    pub object: String,
    pub footprint_x: u32,
    pub footprint_z: u32,
}

/// What a unit's render will be called before anybody draws it (issue #1672).
///
/// `source_hash` is the whole point: it is what the have check compares on, and
/// every field it is over is here, so a caller can ask the hub whether it already
/// holds this picture and only render the ones it does not.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct UnitRenderKey {
    /// The `objectname` the digest was taken of, echoed because several units
    /// share one model and the caller may want to draw it once.
    pub object_name: String,
    /// The archive member the model was read from.
    pub source_member: String,
    /// sha256 over the model file and its textures as the archive stores them.
    pub model_digest: String,
    /// The hub's variant name, `render:<angle>`.
    pub variant: String,
    pub renderer_version: u32,
    pub footprint_x: u32,
    pub footprint_z: u32,
    /// What the footprint frames to, which is part of the identity and also what
    /// the caller has to draw for the render to be accepted.
    pub width_px: u32,
    pub height_px: u32,
    /// The identity the have check compares on. See
    /// `assetencode::render_source_hash`.
    pub source_hash: String,
}

/// Output of `--unit-render-keys`: what a batch of units' renders would be
/// called, without drawing any of them.
#[derive(Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct UnitRenderKeysOutput {
    /// Keyed by the unit's internal name, as asked for.
    pub keys: BTreeMap<String, UnitRenderKey>,
    /// The units that got no key, and why. A unit is in exactly one of the two
    /// maps.
    pub skipped: BTreeMap<String, RenderSkip>,
    pub errors: Vec<String>,
}

/// A build pic encoded as the asset the hub takes, written to disk.
///
/// The bytes are not in here on purpose. This worker prints one JSON document
/// on stdout and a few hundred WebPs is the wrong shape for that, so the file
/// goes in the asset directory and the uploader (#1633) reads `path`.
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct UnitBuildpicAsset {
    /// The hub's variant name for this class, always `buildpic` here.
    pub variant: String,
    /// How the bytes were produced. Always `extracted` here, against `rendered`
    /// for a picture coilbox drew.
    pub origin: String,
    /// The name the archive this was read out of declares for itself, which is
    /// what the hub row's `source_archive` holds. See
    /// [`crate::archive::archive_name_for_game`] for why it is that and not the
    /// file name on disk.
    pub source_archive: String,
    /// Absolute path to the encoded file, named after `hash`.
    pub path: String,
    /// sha256 of the encoded bytes. The hub's object path component.
    pub hash: String,
    /// sha256 of the archive member as read, before any decode. Identity and
    /// dedupe compare on this, because it does not move when the encoder does.
    pub source_hash: String,
    /// The archive member the picture came from, as the archive stores it.
    pub source_member: String,
    pub encode_profile: String,
    pub mime: String,
    pub width: u32,
    pub height: u32,
    pub bytes: u64,
}

/// Why a unit produced no build pic asset. Every one of these is a different
/// answer, and only some of them are anyone's bug.
#[derive(Serialize, Deserialize, Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "kebab-case")]
pub enum BuildpicSkip {
    /// No `unitpics/` member matched, so the game ships this unit no build pic.
    NoSource,
    /// A member matched and coilbox could not decode it, which is #1625.
    Undecodable,
    /// Decoded, but not square. The hub rejects that on the bytes, and cropping
    /// or padding would invent a picture the game does not ship.
    NotSquare,
    /// Encoded past the class's byte cap, which the hub also applies.
    TooLarge,
    /// libwebp refused it.
    EncodeFailed,
    /// Encoded, and the file could not be written to the asset directory.
    NotWritten,
}

/// One resolved start unit: its human-friendly name (from the unitdef `name`
/// field) and its build-icon `data:` URL. Either may be absent. Also the on-disk
/// cache record (round-tripped as JSON), so it derives Deserialize too.
///
/// `asset` and `assetSkipped` only appear when the caller asked for hub assets
/// (`--asset-dir`), and then exactly one of them is set. `iconSkipped` is always
/// reported, because the content pages need it whether or not anything wants an
/// asset: without it a unit the game ships no picture for and a unit whose
/// picture coilbox cannot read both arrive as a missing `icon` (#1625).
///
/// The two fields answer different questions, so both can be set at once. A
/// picture that decodes but is not square has an `icon` and no `asset`, and one
/// that never decoded at all has neither, with the same reason in both places.
#[derive(Serialize, Deserialize, Default, Clone)]
#[serde(rename_all = "camelCase")]
pub struct UnitDisplay {
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub name: Option<String>,
    /// The icon's PNG file in the buildpic cache dir, which the webview fetches
    /// over `coilbox://unitsyncbuildpic/`. This rather than `icon` in every case
    /// where there is a cache dir to write it to.
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub icon_file: Option<String>,
    /// The icon inline, only when there was nowhere on disk to keep it. A whole
    /// roster of these is megabytes of base64 across the bridge, so `icon_file`
    /// is the normal answer and never set at the same time as this.
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub icon: Option<String>,
    /// Why there is neither. Only `NoSource`, `Undecodable` and (vanishingly
    /// rarely) `EncodeFailed` can appear here. The rest of `BuildpicSkip` is
    /// about encoding the hub's asset, which happens after an icon exists.
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub icon_skipped: Option<BuildpicSkip>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub asset: Option<UnitBuildpicAsset>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub asset_skipped: Option<BuildpicSkip>,
}

impl UnitDisplay {
    /// Nothing resolved: no name, no icon, and no answer about either.
    pub fn is_empty(&self) -> bool {
        self.name.is_none()
            && self.icon_file.is_none()
            && self.icon.is_none()
            && self.icon_skipped.is_none()
            && self.asset.is_none()
            && self.asset_skipped.is_none()
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

/// One side's resolved faction emblem: a PNG plus the source image's longest
/// pixel side. The dimension lets the UI demote a tiny (16px) archive sidepic
/// below a crisper curated (catalog/profile) image instead of upscaling it.
#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct FactionLogoEntry {
    pub side: String,
    /// Cache file name, served over `coilbox://unitsyncfactionlogo/`. Set
    /// whenever the PNG reached disk, and preferred by callers over `dataUri`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file: Option<String>,
    /// PNG `data:` URL, only set when there was no cache dir or the write failed.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data_uri: Option<String>,
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
    /// Which control the value deserves: `"bool"` | `"number"` | `"string"` |
    /// `"enum"` (a named choice, see `options`) | `"range"` (both ends known,
    /// see `min`/`max`).
    #[serde(rename = "type")]
    pub value_type: &'static str,
    /// The value as read (stringified); empty string when unset and no default.
    pub value: String,
    /// The engine's default for this key (stringified), for reset + change hints.
    pub default: String,
    /// A line under the label, for a key whose name does not explain itself.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hint: Option<&'static str>,
    /// The engine's own bounds, where it declares them.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub min: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max: Option<f64>,
    /// The named choices for an `"enum"`, empty for everything else.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub options: Vec<EngineConfigOption>,
}

/// One named choice of an `"enum"` setting.
#[derive(Serialize)]
pub struct EngineConfigOption {
    /// The value to write, stringified like every other value here.
    pub value: String,
    pub label: &'static str,
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
