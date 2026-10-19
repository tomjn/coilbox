//! The compatibility fixes, and the manifests that say which of them make up
//! each compat version (issue #4555).
//!
//! Two players must build the same mutator or they desync, so a fix is
//! immutable once a manifest lists it. A change is a new fix with a new id and a
//! new manifest. `hashes.txt` beside the manifests records the SHA-256 of every
//! listed fix, and [`hash_problems`] reports any that no longer match.
//!
//! Every file is embedded with `include_str!`, so a build reads nothing at run
//! time. Adding a manifest or a fix means adding it to [`MANIFESTS`] or
//! [`FIXES`] below. A test fails if a file in `lua/compat/` is missing from them.
//!
//! A fix file starts with a header of `-- key: value` lines:
//!
//! ```lua
//! -- id: spring-set-unit-to-feature
//! -- catalogue: entry-id-one, entry-id-two
//! -- license: MIT or GNU GPL, v2 or later
//! ```
//!
//! `id` is the file name without `.lua`. `catalogue` lists the ids of the
//! `engineLuaCompat.json` entries the fix addresses.
//!
//! A fix with a `-- states: synced, unsynced` line is part of the Lua prelude
//! (issue #4558), and the line says which Lua states it runs in. See
//! [`prelude`] and [`prelude_files`].
//!
//! A fix in `lua/compat/gadgets/` is a gadget instead (issue #4559), and its
//! `-- gadget: coilbox_compat_<name>` line names the gadget and the file it is
//! written to in the game's `LuaRules/Gadgets/`. See [`gadget_files`].
//!
//! A fix in `lua/compat/defs/` is a def fix instead (issue #4560), and its
//! `-- defs: defs_post, weapondefs_post` line names the def files of the
//! mutator it runs in. See [`DefsFile`] and [`defs_block`].

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

/// The `license` every fix carries, as in `lua/LICENSE.md`.
pub const LICENSE: &str = "MIT or GNU GPL, v2 or later";

/// Every manifest, by version number.
const MANIFESTS: &[(u32, &str)] = &[
    (1, include_str!("../../../lua/compat/manifests/1.json")),
    (2, include_str!("../../../lua/compat/manifests/2.json")),
    (3, include_str!("../../../lua/compat/manifests/3.json")),
    (4, include_str!("../../../lua/compat/manifests/4.json")),
    (5, include_str!("../../../lua/compat/manifests/5.json")),
    (6, include_str!("../../../lua/compat/manifests/6.json")),
    (7, include_str!("../../../lua/compat/manifests/7.json")),
    (8, include_str!("../../../lua/compat/manifests/8.json")),
    (9, include_str!("../../../lua/compat/manifests/9.json")),
    (10, include_str!("../../../lua/compat/manifests/10.json")),
    (11, include_str!("../../../lua/compat/manifests/11.json")),
    (12, include_str!("../../../lua/compat/manifests/12.json")),
    (13, include_str!("../../../lua/compat/manifests/13.json")),
    (14, include_str!("../../../lua/compat/manifests/14.json")),
];

/// Every fix file, by id.
const FIXES: &[(&str, &str)] = &[
    (
        "callin-allow-command-105",
        include_str!("../../../lua/compat/callin-allow-command-105.lua"),
    ),
    (
        "callin-unit-damaged-95",
        include_str!("../../../lua/compat/callin-unit-damaged-95.lua"),
    ),
    (
        "compat-callin-hooks",
        include_str!("../../../lua/compat/compat-callin-hooks.lua"),
    ),
    (
        "compat-callin-hooks-v2",
        include_str!("../../../lua/compat/compat-callin-hooks-v2.lua"),
    ),
    (
        "defs-commander-85",
        include_str!("../../../lua/compat/defs/defs-commander-85.lua"),
    ),
    (
        "defs-helpers",
        include_str!("../../../lua/compat/defs/defs-helpers.lua"),
    ),
    (
        "defs-icon-type-2025",
        include_str!("../../../lua/compat/defs/defs-icon-type-2025.lua"),
    ),
    (
        "defs-manual-bomb-settings-92",
        include_str!("../../../lua/compat/defs/defs-manual-bomb-settings-92.lua"),
    ),
    (
        "defs-missing-model-standin",
        include_str!("../../../lua/compat/defs/defs-missing-model-standin.lua"),
    ),
    (
        "defs-model-center-offset-89",
        include_str!("../../../lua/compat/defs/defs-model-center-offset-89.lua"),
    ),
    (
        "defs-weapon-consts-87",
        include_str!("../../../lua/compat/defs/defs-weapon-consts-87.lua"),
    ),
    (
        "gadget-aircraft-crash-83",
        include_str!("../../../lua/compat/gadgets/gadget-aircraft-crash-83.lua"),
    ),
    (
        "gadget-aircraft-crash-83-v2",
        include_str!("../../../lua/compat/gadgets/gadget-aircraft-crash-83-v2.lua"),
    ),
    (
        "gadget-aircraft-crash-83-v3",
        include_str!("../../../lua/compat/gadgets/gadget-aircraft-crash-83-v3.lua"),
    ),
    (
        "gadget-messages-tdf-95",
        include_str!("../../../lua/compat/gadgets/gadget-messages-tdf-95.lua"),
    ),
    (
        "gadget-model-center-offset-89",
        include_str!("../../../lua/compat/gadgets/gadget-model-center-offset-89.lua"),
    ),
    (
        "gadget-only-forward-aim-105",
        include_str!("../../../lua/compat/gadgets/gadget-only-forward-aim-105.lua"),
    ),
    (
        "game-identity",
        include_str!("../../../lua/compat/game-identity.lua"),
    ),
    (
        "game-version-104",
        include_str!("../../../lua/compat/game-version-104.lua"),
    ),
    (
        "gl-smoothing",
        include_str!("../../../lua/compat/gl-smoothing.lua"),
    ),
    (
        "snext-spairs-sipairs",
        include_str!("../../../lua/compat/snext-spairs-sipairs.lua"),
    ),
    (
        "spring-get-team-info-105",
        include_str!("../../../lua/compat/spring-get-team-info-105.lua"),
    ),
    (
        "spring-ground-info-105",
        include_str!("../../../lua/compat/spring-ground-info-105.lua"),
    ),
    (
        "spring-make-font",
        include_str!("../../../lua/compat/spring-make-font.lua"),
    ),
    (
        "spring-rules-param-105",
        include_str!("../../../lua/compat/spring-rules-param-105.lua"),
    ),
    (
        "spring-set-unit-to-feature",
        include_str!("../../../lua/compat/spring-set-unit-to-feature.lua"),
    ),
    (
        "spring-sun-parameters",
        include_str!("../../../lua/compat/spring-sun-parameters.lua"),
    ),
    (
        "spring-unit-lineage",
        include_str!("../../../lua/compat/spring-unit-lineage.lua"),
    ),
    (
        "spring-unit-travel",
        include_str!("../../../lua/compat/spring-unit-travel.lua"),
    ),
    (
        "spring-update-info-texture",
        include_str!("../../../lua/compat/spring-update-info-texture.lua"),
    ),
];

/// The fix that makes `Game.gameName` and `Game.gameVersion` read as the base
/// game's (issue #4633). It reads them from the mutator's `modinfo.lua`, which
/// the writer fills in for a manifest that lists it and for no other.
pub const GAME_IDENTITY_FIX: &str = "game-identity";

/// The recorded SHA-256 of every fix a manifest lists.
const HASHES: &str = include_str!("../../../lua/compat/manifests/hashes.txt");

/// The converter a compat version was built with.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct Converter {
    #[serde(rename = "crate")]
    pub name: String,
    pub version: String,
}

/// The newest version of the code that turns a manifest and a game into a
/// mutator's bytes (issue #4629). The fixes are pinned by their hashes, but the
/// code around them decides the bytes too: how the prelude wraps the fixes and
/// the entry files, which call-in adapters a game's handlers pick, how the scan
/// reads those handlers, the `modinfo.lua` and `defs_post.lua` text, and how
/// the worker loads the tiles and converts the models.
///
/// Every manifest names the writer it is built with, and the marker records
/// it. A build keeps the behaviour of every writer up to this one and builds a
/// manifest with the writer it names, so a manifest players may already have
/// built goes on building the same bytes. It refuses a manifest that names a
/// newer writer (see [`knows_writer`]).
///
/// Golden tests in the compat plugin and in the worker hash a fixed build for
/// each manifest and each writer, and fail when the bytes change. A change to
/// the bytes keeps the old behaviour for the writers that had it and puts the
/// new one behind a new writer: move this, add a manifest that names it, and
/// record the new writer's hashes beside the old ones.
pub const WRITER: u32 = 3;

/// Whether this build can write a manifest that names `writer`.
pub fn knows_writer(writer: u32) -> bool {
    (1..=WRITER).contains(&writer)
}

/// Whether `writer` keeps a full 3do sheet's flat colour tiles until every
/// named tile has gone, and names a model that lost one (issue #4640). Writer
/// 1 gave them up first and drew those faces grey.
pub fn keeps_palette_tiles(writer: u32) -> bool {
    writer >= 2
}

/// Whether `writer` copies a game's entry files byte for byte (issue #4641).
/// Writer 1 read them as text, which replaced every byte that is not UTF-8
/// with U+FFFD.
pub fn copies_entry_bytes(writer: u32) -> bool {
    writer >= 2
}

/// Whether `writer` leaves a `.3do` unconverted when the game ships an `.s3o`
/// at the same path, compared in lower case (issue #4697). Writer 2 converted
/// it, and the converted file covered up the game's own model.
pub fn keeps_game_s3o(writer: u32) -> bool {
    writer >= 3
}

/// The writer of manifests 1 and 2, which predate the `writer` field.
fn first_writer() -> u32 {
    1
}

/// One compat version: the fixes that make it up, the converter it was made
/// with and the writer it pins.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct Manifest {
    pub version: u32,
    pub fixes: Vec<String>,
    pub converter: Converter,
    /// The [`WRITER`] this manifest is built with.
    #[serde(default = "first_writer")]
    pub writer: u32,
}

/// The manifest for compat version `n`, or `None` if there is no such version.
///
/// Panics if an embedded manifest is not valid. The tests parse every one.
pub fn manifest(n: u32) -> Option<Manifest> {
    let (_, json) = MANIFESTS.iter().find(|(v, _)| *v == n)?;
    Some(parse_manifest(json))
}

/// The highest compat version, which is the one coilbox builds by default.
pub fn latest() -> u32 {
    latest_of(MANIFESTS)
}

/// The source of the fix with this id, or `None` if there is no such fix.
pub fn fix_source(id: &str) -> Option<&'static str> {
    FIXES.iter().find(|(i, _)| *i == id).map(|(_, src)| *src)
}

fn parse_manifest(json: &str) -> Manifest {
    serde_json::from_str(json).expect("an embedded compat manifest is valid JSON")
}

fn latest_of(manifests: &[(u32, &str)]) -> u32 {
    manifests
        .iter()
        .map(|(v, _)| *v)
        .max()
        .expect("there is at least one compat manifest")
}

/// Lowercase hex, two digits a byte. sha2 0.11's output does not format itself.
fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// The SHA-256 of a fix's source, as lowercase hex.
pub fn fix_hash(source: &str) -> String {
    hex(&Sha256::digest(source.as_bytes()))
}

/// The Total Annihilation palette a mutator's 3do conversion read (issue
/// #4642). A face that names no texture takes its colour from
/// `unittextures/tatex/palette.pal`, which the worker reads through the VFS,
/// so it can come from the game, a dependency or the engine's base content.
/// The base archive's checksum covers none but the first, so the marker
/// records this, and a mutator whose palette has changed since is stale.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Palette {
    /// The file name of the archive in the game's set that holds those bytes,
    /// or `None` when there were none or no archive in the set could be named.
    pub source: Option<String>,
    /// The SHA-256 of the bytes, or `None` when nothing answered to the name.
    pub sha256: Option<String>,
}

impl Palette {
    /// The record of `bytes`, the palette file the VFS gave, found in `source`.
    pub fn of(bytes: Option<&[u8]>, source: Option<String>) -> Palette {
        Palette {
            source: bytes.and(source),
            sha256: bytes.map(|b| hex(&Sha256::digest(b))),
        }
    }

    /// Whether `other` gives a conversion the same colours. Only the bytes
    /// decide that, so the same file found in another archive is the same.
    pub fn same_bytes(&self, other: &Palette) -> bool {
        self.sha256 == other.sha256
    }
}

/// Reads `<hash>  <id>` lines, skipping blanks and `#` comments.
fn parse_hashes(text: &str) -> BTreeMap<&str, &str> {
    text.lines()
        .map(str::trim)
        .filter(|l| !l.is_empty() && !l.starts_with('#'))
        .filter_map(|l| l.split_once(char::is_whitespace))
        .map(|(hash, id)| (id.trim(), hash))
        .collect()
}

/// What is wrong with the fixes a set of manifests lists. Empty means fine.
///
/// A listed fix with no source, no recorded hash, or a source that no longer
/// hashes to the recorded value is a problem. `source` looks a fix up by id.
pub fn hash_problems<'a>(
    manifests: &[Manifest],
    recorded: &str,
    source: impl Fn(&str) -> Option<&'a str>,
) -> Vec<String> {
    let recorded = parse_hashes(recorded);
    let mut problems = Vec::new();
    for fix in manifests.iter().flat_map(|m| &m.fixes) {
        let Some(src) = source(fix) else {
            problems.push(format!("{fix}: no such fix file"));
            continue;
        };
        match recorded.get(fix.as_str()) {
            None => problems.push(format!("{fix}: no recorded hash")),
            Some(want) if *want != fix_hash(src) => problems.push(format!(
                "{fix}: changed after it was listed. Add a new fix with a new id instead"
            )),
            Some(_) => {}
        }
    }
    problems
}

/// [`hash_problems`] over every embedded manifest, fix and recorded hash.
pub fn embedded_problems() -> Vec<String> {
    let manifests: Vec<Manifest> = MANIFESTS.iter().map(|(_, j)| parse_manifest(j)).collect();
    hash_problems(&manifests, HASHES, fix_source)
}

/// The header of a fix file.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Header {
    pub id: String,
    pub catalogue: Vec<String>,
    pub license: String,
    /// The Lua states a prelude fix runs in. Empty for a fix that is not part
    /// of the prelude.
    pub states: Vec<String>,
    /// The name of a gadget fix, which is also its file name in the game's
    /// `LuaRules/Gadgets/`. `None` for a fix that is not a gadget.
    pub gadget: Option<String>,
    /// The def files a def fix runs in, by [`DefsFile::name`]. Empty for a fix
    /// that is not a def fix.
    pub defs: Vec<String>,
}

fn list(value: &str) -> Vec<String> {
    value
        .split(',')
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(String::from)
        .collect()
}

/// Reads the `-- key: value` lines at the top of a fix file.
///
/// Returns `None` if `id` or `license` is missing. `catalogue` may be empty.
pub fn parse_header(source: &str) -> Option<Header> {
    let (mut id, mut catalogue, mut license, mut states) = (None, Vec::new(), None, Vec::new());
    let (mut gadget, mut defs) = (None, Vec::new());
    for line in source.lines() {
        let Some(rest) = line.strip_prefix("--") else {
            break;
        };
        let Some((key, value)) = rest.split_once(':') else {
            continue;
        };
        let value = value.trim();
        match key.trim() {
            "id" => id = Some(value.to_string()),
            "catalogue" => catalogue = list(value),
            "license" => license = Some(value.to_string()),
            "states" => states = list(value),
            "gadget" => gadget = Some(value.to_string()),
            "defs" => defs = list(value),
            _ => {}
        }
    }
    Some(Header {
        id: id?,
        catalogue,
        license: license?,
        states,
        gadget,
        defs,
    })
}

/// The two Lua states a game's Lua runs in. The engine gives `gl` and the
/// unsynced controls only to the unsynced one, so each has its own prelude.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LuaState {
    Synced,
    Unsynced,
}

impl LuaState {
    /// The word a fix's `states` line uses for this state.
    pub fn name(self) -> &'static str {
        match self {
            LuaState::Synced => "synced",
            LuaState::Unsynced => "unsynced",
        }
    }

    /// Where the mutator puts this state's prelude.
    pub fn prelude_path(self) -> &'static str {
        match self {
            LuaState::Synced => "compat/prelude-synced.lua",
            LuaState::Unsynced => "compat/prelude-unsynced.lua",
        }
    }
}

/// The files the engine starts each Lua handle from, with the state each runs
/// in. Where a handle has two candidates, the engine takes the first that
/// exists: `luaui.lua` before `LuaUI/main.lua` (`rts/Lua/LuaUI.cpp`). The
/// others are fixed names in `LuaRules.cpp`, `LuaGaia.cpp` and `LuaIntro.cpp`.
pub const ENTRY_FILES: &[(&[&str], LuaState)] = &[
    (&["LuaRules/main.lua"], LuaState::Synced),
    (&["LuaRules/draw.lua"], LuaState::Unsynced),
    (&["LuaGaia/main.lua"], LuaState::Synced),
    (&["LuaGaia/draw.lua"], LuaState::Unsynced),
    (&["luaui.lua", "LuaUI/main.lua"], LuaState::Unsynced),
    (&["LuaIntro/main.lua"], LuaState::Unsynced),
];

/// The prelude fixes `manifest` lists for `state`, in manifest order.
fn prelude_fixes(manifest: &Manifest, state: LuaState) -> Vec<(&'static str, &'static str)> {
    manifest
        .fixes
        .iter()
        .filter_map(|id| FIXES.iter().find(|(i, _)| i == id).copied())
        .filter(|(_, src)| {
            parse_header(src).is_some_and(|h| h.states.iter().any(|s| s == state.name()))
        })
        .collect()
}

/// The prelude for one Lua state, built from the fixes `manifest` lists for
/// it, or `None` when it lists none.
///
/// Each fix runs as a function given the shared `compat` table, inside a
/// `pcall`, so a fix that fails is logged and the game's Lua still loads.
pub fn prelude(manifest: &Manifest, state: LuaState) -> Option<String> {
    let fixes = prelude_fixes(manifest, state);
    if fixes.is_empty() {
        return None;
    }
    let mut out = format!(
        "-- Written by coilbox's compatibility mode from compat manifest {n}, {state} state.\n\
         -- Each fix below is a file in lua/compat/ in the coilbox repository.\n\
         -- license: {LICENSE}\n\
         \n\
         {RUNNER}",
        n = manifest.version,
        state = state.name(),
    );
    for (id, src) in fixes {
        out.push_str(&fix_chunk(id, src));
    }
    Some(out)
}

/// The start of a prelude or a def fix block: the table the fixes share and
/// the function that logs one that fails.
const RUNNER: &str = "local compat = {}\n\
     \n\
     local function failed(id, err)\n\
     \tlocal message = \"coilbox compat fix \" .. id .. \" failed: \" .. tostring(err)\n\
     \tif type(Spring) == \"table\" and type(Spring.Log) == \"function\" then\n\
     \t\tSpring.Log(\"coilbox-compat\", type(LOG) == \"table\" and LOG.ERROR or \"error\", message)\n\
     \telseif type(Spring) == \"table\" and type(Spring.Echo) == \"function\" then\n\
     \t\tSpring.Echo(message)\n\
     \tend\n\
     end\n";

/// One fix, run as a function given the shared `compat` table, inside a
/// `pcall`.
fn fix_chunk(id: &str, src: &str) -> String {
    format!(
        "\n-- fix: {id}\n\
         do\n\
         local ok, err = pcall(function(...)\n\
         {src}\
         end, compat)\n\
         if not ok then failed({id:?}, err) end\n\
         end\n"
    )
}

/// An entry file with its state's prelude included in front of the original,
/// whose bytes follow unchanged.
///
/// The include goes on the original's first line, so every line of the game's
/// code keeps its number in an error message.
pub fn wrap_entry(original: &[u8], state: LuaState) -> Vec<u8> {
    let mut out = format!("VFS.Include(\"{}\") ", state.prelude_path()).into_bytes();
    out.extend_from_slice(original);
    out
}

/// Whether the fix `id` is part of the prelude, which [`prelude_files`] writes.
pub fn is_prelude_fix(id: &str) -> bool {
    fix_source(id)
        .and_then(parse_header)
        .is_some_and(|h| !h.states.is_empty())
}

/// The start of every gadget fix's name, so a game's own gadget for the same
/// thing can be told apart from it in the infolog.
pub const GADGET_PREFIX: &str = "coilbox_compat_";

/// The gadget name of the fix `id`, or `None` when it is not a gadget fix.
fn gadget_name(id: &str) -> Option<String> {
    fix_source(id).and_then(parse_header)?.gadget
}

/// Whether the fix `id` is a gadget, which [`gadget_files`] writes.
pub fn is_gadget_fix(id: &str) -> bool {
    gadget_name(id).is_some()
}

/// Every gadget fix `manifest` lists, as the path in the mutator and the
/// fix's source unchanged, sorted by path. The game's gadget handler loads
/// each from `LuaRules/Gadgets/`, and each gadget decides when it loads whether
/// the game needs it, from the game's own files. So every game built from one
/// manifest gets the same gadget files.
pub fn gadget_files(manifest: &Manifest) -> Vec<(String, String)> {
    let mut files: Vec<(String, String)> = manifest
        .fixes
        .iter()
        .filter_map(|id| {
            let name = gadget_name(id)?;
            Some((
                format!("LuaRules/Gadgets/{name}.lua"),
                fix_source(id)?.to_string(),
            ))
        })
        .collect();
    files.sort();
    files
}

/// The def files of a mutator that def fixes run in. The engine's
/// `gamedata/defs.lua` loads `defs_post.lua` once every def table is built, and
/// its `weapondefs.lua` loads `weapondefs_post.lua` once the weapon files are
/// read, before any unit's own weapons join the shared table.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DefsFile {
    DefsPost,
    WeaponDefsPost,
}

impl DefsFile {
    /// Both, in the order the engine loads them.
    pub const ALL: [DefsFile; 2] = [DefsFile::WeaponDefsPost, DefsFile::DefsPost];

    /// The word a def fix's `defs` line uses for this file.
    pub fn name(self) -> &'static str {
        match self {
            DefsFile::DefsPost => "defs_post",
            DefsFile::WeaponDefsPost => "weapondefs_post",
        }
    }

    /// Where the mutator writes this file.
    pub fn path(self) -> &'static str {
        match self {
            DefsFile::DefsPost => "gamedata/defs_post.lua",
            DefsFile::WeaponDefsPost => "gamedata/weapondefs_post.lua",
        }
    }
}

/// Whether the fix `id` is a def fix, which [`defs_block`] writes.
pub fn is_defs_fix(id: &str) -> bool {
    fix_source(id)
        .and_then(parse_header)
        .is_some_and(|h| !h.defs.is_empty())
}

/// The def fixes `manifest` lists for `file`, in manifest order.
pub fn defs_fixes(manifest: &Manifest, file: DefsFile) -> Vec<&'static str> {
    manifest
        .fixes
        .iter()
        .filter_map(|id| FIXES.iter().find(|(i, _)| i == id).copied())
        .filter(|(_, src)| {
            parse_header(src).is_some_and(|h| h.defs.iter().any(|d| d == file.name()))
        })
        .map(|(id, _)| id)
        .collect()
}

/// The Lua that runs the def fixes `manifest` lists for `file`, for the
/// mutator to put in that file, or `None` when it lists none. Each fix runs as
/// a prelude fix does, given the shared `compat` table inside a `pcall`, so a
/// fix that fails is logged and the defs still load.
pub fn defs_block(manifest: &Manifest, file: DefsFile) -> Option<String> {
    let fixes = defs_fixes(manifest, file);
    if fixes.is_empty() {
        return None;
    }
    let mut out = format!(
        "-- The def fixes of compat manifest {n}. Each is a file in lua/compat/defs/\n\
         -- in the coilbox repository.\n\
         \n\
         {RUNNER}",
        n = manifest.version,
    );
    for id in fixes {
        let src = fix_source(id).expect("a listed def fix has a source");
        out.push_str(&fix_chunk(id, src));
    }
    Some(out)
}

/// A prelude fix that puts a call-in's arguments or a function's results back
/// in an older order, and how to tell Lua written for the current order.
struct Adapter {
    fix: &'static str,
    /// The catalogue entry the fix addresses, which the scan of a game's Lua
    /// names a handler's call-in or a called function by.
    entry: &'static str,
    change: Change,
}

enum Change {
    /// A call-in's arguments, which a handler names.
    Arguments {
        /// The 0-based position of the first argument the change moved.
        moved: usize,
        /// How many arguments the old list had.
        old_len: usize,
        /// Part of the name of the argument the change added, lower case. The
        /// old list has nothing by that name.
        added: &'static str,
    },
    /// A function's results, which a call names by assigning them, where the
    /// change put one result in front of the old list.
    Results {
        /// Part of the name of each old result, lower case, in the old order.
        old: &'static [&'static str],
        /// Part of the name of the result the change put first.
        added: &'static str,
    },
    /// A function's results, which a call names by assigning them, where the
    /// change swapped results around and the list kept its length.
    Swapped {
        /// The 0-based position of the first result the change moved.
        moved: usize,
        /// 0-based positions, each with words whose presence in the name
        /// there, lower case, means the call reads the new order.
        new: &'static [(usize, &'static [&'static str])],
    },
}

/// Changing this changes the mutator two players build from the same manifest,
/// so a change here needs a new manifest, as a changed fix does.
const ADAPTERS: &[Adapter] = &[
    Adapter {
        fix: "callin-unit-damaged-95",
        entry: "signature:UnitDamaged@95.0",
        change: Change::Arguments {
            moved: 6,
            old_len: 9,
            added: "proj",
        },
    },
    Adapter {
        fix: "callin-allow-command-105",
        entry: "signature:AllowCommand@105.0",
        change: Change::Arguments {
            moved: 7,
            old_len: 8,
            added: "player",
        },
    },
    Adapter {
        fix: "spring-ground-info-105",
        entry: "signature:Spring.GetGroundInfo@105.0",
        change: Change::Results {
            old: &[
                "name", "metal", "hard", "tank", "kbot", "hover", "ship", "track",
            ],
            added: "index",
        },
    },
    // A count does not decide this one: XTA and Expand and Exterminate take
    // nine results, the team colours GetTeamInfo returned before Spring 0.76,
    // and read the old order.
    Adapter {
        fix: "spring-get-team-info-105",
        entry: "signature:Spring.GetTeamInfo@105.0",
        change: Change::Swapped {
            moved: 6,
            new: &[(6, &["income", "mult"]), (7, &["key", "custom", "opt"])],
        },
    },
];

/// Where a game's Lua takes values from the engine, as the scan of it reports
/// one: the catalogue entry, such as `signature:UnitDamaged@95.0`, and the
/// names the Lua gives the values. For a call-in those are the arguments its
/// handler takes. For a function they are the names one call assigns its
/// results to.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Handler {
    pub entry: String,
    pub params: Vec<String>,
}

#[derive(PartialEq)]
enum Order {
    Old,
    New,
    /// The handler reads none of the arguments the change moved.
    Either,
}

fn order(adapter: &Adapter, params: &[String]) -> Order {
    let named: Vec<String> = params
        .iter()
        .filter(|p| *p != "...")
        .map(|p| p.to_ascii_lowercase())
        .collect();
    match adapter.change {
        Change::Arguments {
            moved,
            old_len,
            added,
        } => {
            if named.len() > old_len || named.iter().any(|p| p.contains(added)) {
                Order::New
            } else if named.len() > moved {
                Order::Old
            } else {
                Order::Either
            }
        }
        Change::Results { old, added } => {
            if named.len() > old.len() {
                return Order::New;
            }
            // Each result whose name fits its place in one order and not the
            // other says which order the call reads.
            let (mut reads_old, mut reads_new) = (false, false);
            for (i, name) in named.iter().enumerate() {
                let fits = |word: Option<&&str>| word.is_some_and(|w| name.contains(*w));
                let new_word = if i == 0 { Some(&added) } else { old.get(i - 1) };
                match (fits(old.get(i)), fits(new_word)) {
                    (true, false) => reads_old = true,
                    (false, true) => reads_new = true,
                    _ => {}
                }
            }
            match (reads_old, reads_new) {
                (true, false) => Order::Old,
                (false, true) => Order::New,
                _ => Order::Either,
            }
        }
        Change::Swapped { moved, new } => {
            let reads_new = new.iter().any(|(at, words)| {
                named
                    .get(*at)
                    .is_some_and(|p| words.iter().any(|w| p.contains(w)))
            });
            if reads_new {
                Order::New
            } else if named.len() > moved {
                Order::Old
            } else {
                Order::Either
            }
        }
    }
}

/// `manifest` without the call-in adapters a game whose Lua defines `handlers`
/// does not need, keeping the order of the rest.
///
/// An adapter is left out when at least one handler of its call-in takes the
/// current order and none takes the old one. A game with no handler the scan
/// can read, or with handlers of both orders, keeps it, as it was shipped
/// with it. The answer depends on nothing but `handlers`, and the order they
/// come in does not change it.
pub fn for_game(manifest: &Manifest, handlers: &[Handler]) -> Manifest {
    let unneeded = |id: &String| {
        ADAPTERS.iter().filter(|a| a.fix == id).any(|a| {
            let orders: Vec<Order> = handlers
                .iter()
                .filter(|h| h.entry == a.entry)
                .map(|h| order(a, &h.params))
                .collect();
            orders.contains(&Order::New) && !orders.contains(&Order::Old)
        })
    };
    Manifest {
        fixes: manifest
            .fixes
            .iter()
            .filter(|id| !unneeded(id))
            .cloned()
            .collect(),
        ..manifest.clone()
    }
}

/// Every Lua file the prelude adds to a compat mutator built from `manifest`:
/// the prelude for each state that has fixes, and each entry file the base
/// game has for that state, wrapped. `read` returns the bytes of the base
/// game's copy of a path, or `None` when it has none, and an error from it
/// stops the build so a failed read never leaves a handle without its prelude.
/// The files are sorted by path.
///
/// A game with no file for a handle gets none written, so the engine runs
/// nothing there, as it would for the game alone.
pub fn prelude_files<E>(
    manifest: &Manifest,
    mut read: impl FnMut(&str) -> Result<Option<Vec<u8>>, E>,
) -> Result<Vec<(String, Vec<u8>)>, E> {
    let mut files = Vec::new();
    for state in [LuaState::Synced, LuaState::Unsynced] {
        let Some(prelude) = prelude(manifest, state) else {
            continue;
        };
        let mut used = false;
        for (candidates, _) in ENTRY_FILES.iter().filter(|(_, s)| *s == state) {
            for path in candidates.iter() {
                if let Some(original) = read(path)? {
                    files.push((path.to_string(), wrap_entry(&original, state)));
                    used = true;
                    break;
                }
            }
        }
        if used {
            files.push((state.prelude_path().to_string(), prelude.into_bytes()));
        }
    }
    files.sort();
    Ok(files)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeSet;
    use std::fs;
    use std::path::PathBuf;

    fn compat_dir() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../lua/compat")
    }

    fn manifest_of(fixes: &[&str]) -> Manifest {
        Manifest {
            version: 9,
            fixes: fixes.iter().map(|s| s.to_string()).collect(),
            converter: Converter {
                name: "coilbox-3do-convert".into(),
                version: "0.0.0".into(),
            },
            writer: WRITER,
        }
    }

    fn files_for(
        m: &Manifest,
        mut read: impl FnMut(&str) -> Option<String>,
    ) -> Vec<(String, String)> {
        prelude_files::<()>(m, |path| Ok(read(path).map(String::into_bytes)))
            .unwrap()
            .into_iter()
            .map(|(path, bytes)| (path, String::from_utf8(bytes).unwrap()))
            .collect()
    }

    fn all_manifests() -> Vec<Manifest> {
        MANIFESTS.iter().map(|(_, j)| parse_manifest(j)).collect()
    }

    #[test]
    fn latest_is_the_highest_number_whatever_the_order() {
        let json = "{}";
        assert_eq!(latest_of(&[(2, json), (10, json), (3, json)]), 10);
        assert_eq!(latest_of(&[(1, json)]), 1);
    }

    #[test]
    fn a_palette_is_recorded_by_its_bytes_and_where_they_came_from() {
        let found = Palette::of(Some(b"abc"), Some("springcontent.sdz".into()));
        assert_eq!(found.source.as_deref(), Some("springcontent.sdz"));
        assert_eq!(
            found.sha256.as_deref(),
            Some("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad")
        );
        let none = Palette::of(None, Some("springcontent.sdz".into()));
        assert_eq!(
            none,
            Palette {
                source: None,
                sha256: None
            }
        );
    }

    #[test]
    fn only_a_palettes_bytes_decide_whether_it_is_the_same() {
        let game = Palette::of(Some(b"abc"), Some("xta.sd7".into()));
        let engine = Palette::of(Some(b"abc"), Some("springcontent.sdz".into()));
        assert!(game.same_bytes(&engine));
        assert!(!game.same_bytes(&Palette::of(Some(b"abd"), Some("xta.sd7".into()))));
        assert!(!game.same_bytes(&Palette::of(None, None)));
    }

    #[test]
    fn latest_is_a_version_that_has_a_manifest() {
        assert!(manifest(latest()).is_some());
        assert!(manifest(latest() + 1).is_none());
    }

    #[test]
    fn first_manifest_is_empty_apart_from_the_converter_pin() {
        let m = manifest(1).unwrap();
        assert_eq!(m.version, 1);
        assert!(m.fixes.is_empty());
        assert_eq!(m.converter.name, "coilbox-3do-convert");
    }

    #[test]
    fn every_manifest_says_the_version_its_file_is_named_for() {
        for (n, json) in MANIFESTS {
            assert_eq!(parse_manifest(json).version, *n);
        }
    }

    #[test]
    fn manifests_1_and_2_predate_the_writer_field_and_mean_the_first_writer() {
        assert_eq!(manifest(1).unwrap().writer, 1);
        assert_eq!(manifest(2).unwrap().writer, 1);
    }

    /// A manifest that left the field out would read as writer 1 whatever
    /// writer it was built with.
    #[test]
    fn every_manifest_after_2_names_its_writer() {
        for (n, json) in MANIFESTS.iter().filter(|(n, _)| *n > 2) {
            let raw: serde_json::Value = serde_json::from_str(json).unwrap();
            assert!(raw["writer"].is_u64(), "manifest {n} has no writer");
        }
    }

    #[test]
    fn the_latest_manifest_names_the_writer_this_build_carries() {
        assert_eq!(manifest(latest()).unwrap().writer, WRITER);
    }

    /// A newer coilbox builds the older manifest a host is on (issue #4564),
    /// so every manifest's writer stays one this build knows.
    #[test]
    fn this_build_knows_every_manifests_writer_and_no_newer_one() {
        for m in all_manifests() {
            assert!(knows_writer(m.writer), "manifest {}", m.version);
        }
        assert!(!knows_writer(0));
        assert!(!knows_writer(WRITER + 1));
    }

    #[test]
    fn every_manifest_file_is_embedded() {
        let dir = compat_dir().join("manifests");
        let embedded: BTreeSet<String> =
            MANIFESTS.iter().map(|(n, _)| format!("{n}.json")).collect();
        let on_disk: BTreeSet<String> = fs::read_dir(dir)
            .unwrap()
            .map(|e| e.unwrap().file_name().into_string().unwrap())
            .filter(|n| n.ends_with(".json"))
            .collect();
        assert_eq!(on_disk, embedded);
    }

    /// The ids of the fix files in `dir`.
    fn fix_files_in(dir: PathBuf) -> BTreeSet<String> {
        fs::read_dir(dir)
            .unwrap()
            .map(|e| e.unwrap().file_name().into_string().unwrap())
            .filter_map(|n| n.strip_suffix(".lua").map(String::from))
            .collect()
    }

    #[test]
    fn every_fix_file_is_embedded_and_its_header_agrees() {
        let mut on_disk = fix_files_in(compat_dir());
        on_disk.extend(fix_files_in(compat_dir().join("gadgets")));
        on_disk.extend(fix_files_in(compat_dir().join("defs")));
        let embedded: BTreeSet<String> = FIXES.iter().map(|(id, _)| id.to_string()).collect();
        assert_eq!(on_disk, embedded);
        for (id, src) in FIXES {
            let header = parse_header(src).unwrap_or_else(|| panic!("{id}: header incomplete"));
            assert_eq!(&header.id, id, "{id}: header id differs from the file name");
            assert_eq!(header.license, LICENSE, "{id}: wrong licence");
        }
    }

    #[test]
    fn every_fix_a_manifest_names_exists() {
        for m in all_manifests() {
            for fix in &m.fixes {
                assert!(
                    fix_source(fix).is_some(),
                    "manifest {}: no fix {fix}",
                    m.version
                );
            }
        }
        let problems = hash_problems(&[manifest_of(&["missing"])], "", |_| None);
        assert_eq!(problems, ["missing: no such fix file"]);
    }

    #[test]
    fn recorded_hashes_match_the_embedded_fixes() {
        assert_eq!(embedded_problems(), Vec::<String>::new());
    }

    #[test]
    fn the_hash_guard_rejects_a_changed_fix() {
        let original = "-- id: a\nreturn 1\n";
        let recorded = format!("{}  a\n", fix_hash(original));
        let m = [manifest_of(&["a"])];
        assert!(hash_problems(&m, &recorded, |_| Some(original)).is_empty());

        let problems = hash_problems(&m, &recorded, |_| Some("-- id: a\nreturn 2\n"));
        assert_eq!(problems.len(), 1);
        assert!(problems[0].starts_with("a: changed"));
    }

    #[test]
    fn the_hash_guard_rejects_a_listed_fix_with_no_recorded_hash() {
        let problems = hash_problems(&[manifest_of(&["a"])], "# nothing\n", |_| Some("x"));
        assert_eq!(problems, ["a: no recorded hash"]);
    }

    #[test]
    fn fix_hash_is_sha256_hex() {
        assert_eq!(
            fix_hash("abc"),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
    }

    #[test]
    fn a_header_is_read_from_the_leading_comment_lines() {
        let src = "-- id: spring-set-unit-to-feature\n-- catalogue: one, two\n-- license: MIT or GNU GPL, v2 or later\nlocal x = 1 -- id: not-this\n";
        let h = parse_header(src).unwrap();
        assert_eq!(h.id, "spring-set-unit-to-feature");
        assert_eq!(h.catalogue, ["one", "two"]);
        assert_eq!(h.license, LICENSE);
        assert!(parse_header("-- id: a\n").is_none());
        assert!(h.states.is_empty());
    }

    #[test]
    fn a_header_reads_the_name_of_a_gadget_fix() {
        let src = "-- id: a\n-- gadget: coilbox_compat_a\n-- license: x\n";
        let h = parse_header(src).unwrap();
        assert_eq!(h.gadget.as_deref(), Some("coilbox_compat_a"));
        assert!(h.states.is_empty());
        assert_eq!(
            parse_header("-- id: a\n-- license: x\n").unwrap().gadget,
            None
        );
    }

    #[test]
    fn the_gadget_fixes_are_the_files_in_gadgets_and_carry_their_name() {
        let in_folder = fix_files_in(compat_dir().join("gadgets"));
        let gadgets: BTreeSet<String> = FIXES
            .iter()
            .filter(|(id, _)| is_gadget_fix(id))
            .map(|(id, _)| id.to_string())
            .collect();
        assert_eq!(gadgets, in_folder);
        for id in &gadgets {
            let header = parse_header(fix_source(id).unwrap()).unwrap();
            let name = header.gadget.unwrap();
            assert!(name.starts_with(GADGET_PREFIX), "{id}: {name}");
            assert!(
                name[GADGET_PREFIX.len()..]
                    .chars()
                    .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_'),
                "{id}: {name}"
            );
            assert!(
                header.states.is_empty(),
                "{id}: a gadget is not in the prelude"
            );
            assert!(
                fix_source(id)
                    .unwrap()
                    .contains(&format!("name = \"{name}\",")),
                "{id}: GetInfo does not register as {name}"
            );
        }
    }

    #[test]
    fn manifest_3_is_manifest_2_with_the_gadgets() {
        let (two, three) = (manifest(2).unwrap(), manifest(3).unwrap());
        assert_eq!(three.fixes[..two.fixes.len()], two.fixes[..]);
        assert!(gadget_files(&two).is_empty());
        let paths: Vec<String> = gadget_files(&three).into_iter().map(|(p, _)| p).collect();
        assert_eq!(
            paths,
            [
                "LuaRules/Gadgets/coilbox_compat_aircraft_crash.lua",
                "LuaRules/Gadgets/coilbox_compat_messages_tdf.lua",
                "LuaRules/Gadgets/coilbox_compat_only_forward_aim.lua",
            ]
        );
        for state in [LuaState::Synced, LuaState::Unsynced] {
            let (a, b) = (
                prelude(&two, state).unwrap(),
                prelude(&three, state).unwrap(),
            );
            let rest = |p: &str| p.split_once('\n').unwrap().1.to_string();
            assert_eq!(rest(&a), rest(&b), "{}", state.name());
        }
    }

    #[test]
    fn manifest_4_is_manifest_3_with_the_new_aircraft_gadget() {
        let (three, four) = (manifest(3).unwrap(), manifest(4).unwrap());
        let swapped: Vec<String> = three
            .fixes
            .iter()
            .map(|id| match id.as_str() {
                "gadget-aircraft-crash-83" => "gadget-aircraft-crash-83-v2".to_string(),
                _ => id.clone(),
            })
            .collect();
        assert_eq!(four.fixes, swapped);
        assert_eq!(four.converter, three.converter);
        let paths =
            |m: &Manifest| -> Vec<String> { gadget_files(m).into_iter().map(|(p, _)| p).collect() };
        assert_eq!(paths(&four), paths(&three));
        let (_, src) = gadget_files(&four)
            .into_iter()
            .find(|(p, _)| p.ends_with("coilbox_compat_aircraft_crash.lua"))
            .unwrap();
        assert_eq!(src, fix_source("gadget-aircraft-crash-83-v2").unwrap());
    }

    #[test]
    fn manifest_5_is_manifest_4_with_the_def_fixes_and_their_gadget() {
        let (four, five) = (manifest(4).unwrap(), manifest(5).unwrap());
        assert_eq!(five.fixes[..four.fixes.len()], four.fixes[..]);
        assert_eq!(
            five.fixes[four.fixes.len()..],
            [
                "gadget-model-center-offset-89",
                "defs-helpers",
                "defs-commander-85",
                "defs-model-center-offset-89",
                "defs-weapon-consts-87",
                "defs-manual-bomb-settings-92",
            ]
        );
        assert_eq!(five.converter, four.converter);
        assert_eq!(five.writer, four.writer);
        for state in [LuaState::Synced, LuaState::Unsynced] {
            let rest = |m: &Manifest| {
                let p = prelude(m, state).unwrap();
                p.split_once('\n').unwrap().1.to_string()
            };
            assert_eq!(rest(&four), rest(&five), "{}", state.name());
        }
    }

    #[test]
    fn manifest_6_is_manifest_5_with_the_game_identity_fix() {
        let (five, six) = (manifest(5).unwrap(), manifest(6).unwrap());
        assert_eq!(six.fixes[..five.fixes.len()], five.fixes[..]);
        assert_eq!(six.fixes[five.fixes.len()..], [GAME_IDENTITY_FIX]);
        assert_eq!(six.converter, five.converter);
        assert_eq!(six.writer, five.writer);
        assert!(is_prelude_fix(GAME_IDENTITY_FIX));
        for state in [LuaState::Synced, LuaState::Unsynced] {
            let p = prelude(&six, state).unwrap();
            assert!(p.contains("-- fix: game-identity\n"), "{}", state.name());
            assert!(!prelude(&five, state).unwrap().contains("game-identity"));
        }
    }

    #[test]
    fn manifest_7_is_manifest_6_with_the_aircraft_gadget_that_reads_the_engine() {
        let (six, seven) = (manifest(6).unwrap(), manifest(7).unwrap());
        let swapped: Vec<String> = six
            .fixes
            .iter()
            .map(|id| match id.as_str() {
                "gadget-aircraft-crash-83-v2" => "gadget-aircraft-crash-83-v3".to_string(),
                _ => id.clone(),
            })
            .collect();
        assert_eq!(seven.fixes, swapped);
        assert!(seven.fixes.iter().any(|id| id == GAME_IDENTITY_FIX));
        assert_eq!(seven.converter, six.converter);
        assert_eq!(seven.writer, six.writer);
        let paths =
            |m: &Manifest| -> Vec<String> { gadget_files(m).into_iter().map(|(p, _)| p).collect() };
        assert_eq!(paths(&seven), paths(&six));
        let (_, src) = gadget_files(&seven)
            .into_iter()
            .find(|(p, _)| p.ends_with("coilbox_compat_aircraft_crash.lua"))
            .unwrap();
        assert_eq!(src, fix_source("gadget-aircraft-crash-83-v3").unwrap());
    }

    /// Writer 2 changes how a build writes the bytes (issue #4640), and the
    /// fixes stay those of manifest 7.
    #[test]
    fn manifest_8_is_manifest_7_built_by_writer_2() {
        let (seven, eight) = (manifest(7).unwrap(), manifest(8).unwrap());
        assert_eq!(eight.fixes, seven.fixes);
        assert_eq!(eight.converter, seven.converter);
        assert_eq!((seven.writer, eight.writer), (1, 2));
        assert!(!keeps_palette_tiles(seven.writer));
        assert!(keeps_palette_tiles(eight.writer));
        assert!(!copies_entry_bytes(seven.writer));
        assert!(copies_entry_bytes(eight.writer));
    }

    /// Writer 3 leaves a `.3do` unconverted when the game has an `.s3o` of the
    /// same name (issue #4697), and the fixes stay those of manifest 12.
    #[test]
    fn manifest_13_is_manifest_12_built_by_writer_3() {
        let (twelve, thirteen) = (manifest(12).unwrap(), manifest(13).unwrap());
        assert_eq!(thirteen.fixes, twelve.fixes);
        assert_eq!(thirteen.converter, twelve.converter);
        assert_eq!((twelve.writer, thirteen.writer), (2, 3));
        assert!(!keeps_game_s3o(twelve.writer));
        assert!(keeps_game_s3o(thirteen.writer));
        assert!(keeps_palette_tiles(thirteen.writer) && copies_entry_bytes(thirteen.writer));
    }

    /// Manifests 2 to 8 hook call-ins with `rawget` and `rawset`, which a
    /// synced state lacks (issue #4685). Manifest 9 swaps in hooks that do not.
    #[test]
    fn manifest_9_is_manifest_8_with_hooks_that_need_no_raw_functions() {
        let (eight, nine) = (manifest(8).unwrap(), manifest(9).unwrap());
        let swapped: Vec<String> = eight
            .fixes
            .iter()
            .map(|id| match id.as_str() {
                "compat-callin-hooks" => "compat-callin-hooks-v2".to_string(),
                _ => id.clone(),
            })
            .collect();
        assert_eq!(nine.fixes, swapped);
        assert_eq!(nine.converter, eight.converter);
        assert_eq!(nine.writer, eight.writer);
    }

    /// What `CSyncedLuaHandle::Init` sets to nil. The Lua tests run the synced
    /// prelude without these too, so this catches a use the tests do not reach.
    #[test]
    fn the_latest_synced_prelude_calls_nothing_the_synced_state_removes() {
        let removed = [
            "rawequal",
            "rawget",
            "rawset",
            "newproxy",
            "gcinfo",
            "collectgarbage",
            "dofile",
            "loadfile",
            "loadlib",
            "require",
        ];
        let m = manifest(latest()).unwrap();
        for (id, src) in prelude_fixes(&m, LuaState::Synced) {
            for line in src.lines().filter(|l| !l.trim_start().starts_with("--")) {
                let mut words = line.split(|c: char| !(c.is_alphanumeric() || c == '_'));
                if let Some(word) = words.find(|w| removed.contains(w)) {
                    panic!("{id} uses {word}, which synced Lua lacks: {line}");
                }
            }
        }
    }

    /// Issue #4686: manifest 10 adds the def fix that gives a def whose model
    /// is missing a stand-in, and keeps the writer of manifest 9.
    #[test]
    fn manifest_10_is_manifest_9_with_the_missing_model_standin() {
        let (nine, ten) = (manifest(9).unwrap(), manifest(10).unwrap());
        let added: Vec<&String> = ten
            .fixes
            .iter()
            .filter(|id| !nine.fixes.contains(id))
            .collect();
        assert_eq!(added, ["defs-missing-model-standin"]);
        let kept: Vec<&String> = ten
            .fixes
            .iter()
            .filter(|id| nine.fixes.contains(id))
            .collect();
        assert_eq!(kept, nine.fixes.iter().collect::<Vec<_>>());
        assert_eq!((&ten.converter, ten.writer), (&nine.converter, nine.writer));
        assert_eq!(
            defs_fixes(&ten, DefsFile::DefsPost).last(),
            Some(&"defs-missing-model-standin")
        );
    }

    #[test]
    fn the_def_fixes_are_the_files_in_defs_and_name_only_files_that_exist() {
        let in_folder = fix_files_in(compat_dir().join("defs"));
        let defs: BTreeSet<String> = FIXES
            .iter()
            .filter(|(id, _)| is_defs_fix(id))
            .map(|(id, _)| id.to_string())
            .collect();
        assert_eq!(defs, in_folder);
        let names: Vec<&str> = DefsFile::ALL.iter().map(|f| f.name()).collect();
        for (id, src) in FIXES {
            let h = parse_header(src).unwrap();
            let kinds = [!h.states.is_empty(), h.gadget.is_some(), !h.defs.is_empty()];
            assert_eq!(kinds.iter().filter(|k| **k).count(), 1, "{id}: one kind");
            for file in &h.defs {
                assert!(
                    names.contains(&file.as_str()),
                    "{id}: unknown def file {file}"
                );
            }
        }
    }

    #[test]
    fn the_def_helpers_come_first_in_each_def_file() {
        for m in all_manifests() {
            for file in DefsFile::ALL {
                if let Some(first) = defs_fixes(&m, file).first() {
                    assert_eq!(*first, "defs-helpers", "manifest {}", m.version);
                }
            }
        }
    }

    #[test]
    fn each_def_file_gets_only_its_own_fixes() {
        assert!(DefsFile::ALL
            .iter()
            .all(|f| defs_block(&manifest(4).unwrap(), *f).is_none()));
        let five = manifest(5).unwrap();
        assert_eq!(
            defs_fixes(&five, DefsFile::DefsPost),
            [
                "defs-helpers",
                "defs-commander-85",
                "defs-model-center-offset-89",
                "defs-weapon-consts-87",
            ]
        );
        assert_eq!(
            defs_fixes(&five, DefsFile::WeaponDefsPost),
            ["defs-helpers", "defs-manual-bomb-settings-92"]
        );
        let block = defs_block(&five, DefsFile::DefsPost).unwrap();
        assert!(block.contains(fix_source("defs-commander-85").unwrap()));
        assert!(block.contains("-- fix: defs-helpers\n"));
        assert!(!block.contains("defs-manual-bomb-settings-92"));
        assert!(!block.contains('\r'));
        assert_eq!(block, defs_block(&five, DefsFile::DefsPost).unwrap());
    }

    #[test]
    fn a_gadget_is_written_as_its_fix_file() {
        let files = gadget_files(&manifest(3).unwrap());
        let (_, src) = files
            .iter()
            .find(|(p, _)| p.ends_with("coilbox_compat_messages_tdf.lua"))
            .unwrap();
        assert_eq!(src, fix_source("gadget-messages-tdf-95").unwrap());
        assert!(!is_gadget_fix("spring-unit-travel"));
        assert!(!is_prelude_fix("gadget-messages-tdf-95"));
    }

    #[test]
    fn a_header_reads_the_states_a_prelude_fix_runs_in() {
        let src = "-- id: a\n-- states: synced, unsynced\n-- license: x\n\n-- states: not-this\n";
        assert_eq!(parse_header(src).unwrap().states, ["synced", "unsynced"]);
    }

    #[test]
    fn every_prelude_fix_names_only_states_that_exist_and_ends_in_a_newline() {
        for (id, src) in FIXES {
            let header = parse_header(src).unwrap();
            for state in &header.states {
                assert!(
                    state == "synced" || state == "unsynced",
                    "{id}: unknown state {state}"
                );
            }
            assert!(src.ends_with('\n'), "{id}");
            assert!(!src.contains('\r'), "{id}");
        }
    }

    #[test]
    fn the_hooks_come_first_in_every_manifest_with_a_prelude() {
        for m in all_manifests() {
            let prelude: Vec<&String> = m
                .fixes
                .iter()
                .filter(|id| {
                    !parse_header(fix_source(id).unwrap())
                        .unwrap()
                        .states
                        .is_empty()
                })
                .collect();
            if let Some(first) = prelude.first() {
                let hooks = if m.version < 9 {
                    "compat-callin-hooks"
                } else {
                    "compat-callin-hooks-v2"
                };
                assert_eq!(*first, hooks, "manifest {}", m.version);
            }
        }
    }

    #[test]
    fn manifest_1_has_no_prelude() {
        let m = manifest(1).unwrap();
        assert!(prelude(&m, LuaState::Synced).is_none());
        assert!(prelude(&m, LuaState::Unsynced).is_none());
        assert!(files_for(&m, |_| Some("x".into())).is_empty());
    }

    #[test]
    fn each_state_gets_only_its_own_fixes() {
        let m = manifest(2).unwrap();
        let synced = prelude(&m, LuaState::Synced).unwrap();
        let unsynced = prelude(&m, LuaState::Unsynced).unwrap();
        for both in ["compat-callin-hooks", "callin-unit-damaged-95"] {
            assert!(synced.contains(&format!("-- fix: {both}\n")), "{both}");
            assert!(unsynced.contains(&format!("-- fix: {both}\n")), "{both}");
        }
        for only in [
            "spring-unit-travel",
            "spring-set-unit-to-feature",
            "callin-allow-command-105",
        ] {
            assert!(synced.contains(&format!("-- fix: {only}\n")), "{only}");
            assert!(!unsynced.contains(&format!("-- fix: {only}\n")), "{only}");
        }
        for only in [
            "gl-smoothing",
            "spring-make-font",
            "spring-update-info-texture",
            "spring-sun-parameters",
        ] {
            assert!(unsynced.contains(&format!("-- fix: {only}\n")), "{only}");
            assert!(!synced.contains(&format!("-- fix: {only}\n")), "{only}");
        }
        assert!(
            synced.find("-- fix: compat-callin-hooks").unwrap()
                < synced.find("-- fix: spring-unit-travel").unwrap()
        );
    }

    #[test]
    fn a_prelude_carries_each_fix_unchanged() {
        let m = manifest(2).unwrap();
        let synced = prelude(&m, LuaState::Synced).unwrap();
        assert!(synced.contains(fix_source("spring-unit-travel").unwrap()));
        assert!(!synced.contains('\r'));
    }

    #[test]
    fn a_wrapped_entry_file_keeps_the_original_on_its_own_line_numbers() {
        let original = "local a = 1\nreturn a\n";
        let wrapped = String::from_utf8(wrap_entry(original.as_bytes(), LuaState::Synced)).unwrap();
        assert_eq!(
            wrapped,
            "VFS.Include(\"compat/prelude-synced.lua\") local a = 1\nreturn a\n"
        );
        assert_eq!(wrapped.lines().count(), original.lines().count());
        assert!(wrap_entry(b"", LuaState::Unsynced)
            .starts_with(b"VFS.Include(\"compat/prelude-unsynced.lua\")"));
    }

    /// Issue #4641: games of the Total Annihilation era carry Latin-1 text in
    /// their Lua, and the game has to see the bytes it shipped.
    #[test]
    fn a_wrapped_entry_file_keeps_bytes_that_are_not_utf8() {
        let original = b"local name = \"Caf\xe9\"\n\xff\n";
        let wrapped = wrap_entry(original, LuaState::Synced);
        let include = b"VFS.Include(\"compat/prelude-synced.lua\") ";
        assert_eq!(&wrapped[..include.len()], include);
        assert_eq!(&wrapped[include.len()..], original);
        let files = prelude_files::<()>(&manifest(8).unwrap(), |path| {
            Ok((path == "LuaRules/main.lua").then(|| original.to_vec()))
        })
        .unwrap();
        assert_eq!(files[0], ("LuaRules/main.lua".to_string(), wrapped));
    }

    #[test]
    fn only_the_entry_files_a_game_has_are_written() {
        let m = manifest(2).unwrap();
        let files = files_for(&m, |path| {
            (path == "LuaRules/main.lua").then(|| "-- rules\n".to_string())
        });
        let paths: Vec<&str> = files.iter().map(|(p, _)| p.as_str()).collect();
        assert_eq!(paths, ["LuaRules/main.lua", "compat/prelude-synced.lua"]);
        assert_eq!(
            files[0].1,
            "VFS.Include(\"compat/prelude-synced.lua\") -- rules\n"
        );
        assert!(files_for(&m, |_| None).is_empty());
    }

    #[test]
    fn a_read_that_fails_stops_the_build() {
        let m = manifest(2).unwrap();
        let got = prelude_files(&m, |path| {
            if path == "LuaRules/draw.lua" {
                Err(format!("could not read {path}"))
            } else {
                Ok(Some(Vec::new()))
            }
        });
        assert_eq!(got, Err("could not read LuaRules/draw.lua".to_string()));
    }

    #[test]
    fn only_fixes_with_states_are_prelude_fixes() {
        assert!(is_prelude_fix("spring-unit-travel"));
        assert!(is_prelude_fix("compat-callin-hooks"));
        assert!(!is_prelude_fix("no-such-fix"));
    }

    fn handler(entry: &str, params: &[&str]) -> Handler {
        Handler {
            entry: entry.into(),
            params: params.iter().map(|s| s.to_string()).collect(),
        }
    }

    const DAMAGED: &str = "signature:UnitDamaged@95.0";
    const COMMAND: &str = "signature:AllowCommand@105.0";

    fn left_out(handlers: &[Handler]) -> Vec<String> {
        let full = manifest(2).unwrap();
        let picked = for_game(&full, handlers);
        full.fixes
            .into_iter()
            .filter(|id| !picked.fixes.contains(id))
            .collect()
    }

    #[test]
    fn each_adapter_names_the_catalogue_entry_its_fix_addresses() {
        for a in ADAPTERS {
            let header = parse_header(fix_source(a.fix).unwrap()).unwrap();
            assert_eq!(header.catalogue, [a.entry], "{}", a.fix);
        }
    }

    #[test]
    fn a_handler_that_names_the_new_argument_takes_the_new_order() {
        let new = handler(DAMAGED, &["u", "d", "t", "dmg", "p", "w", "projID", "a"]);
        assert_eq!(left_out(&[new]), ["callin-unit-damaged-95"]);
        let new = handler(COMMAND, &["u", "d", "t", "c", "p", "o", "tag", "playerID"]);
        assert_eq!(left_out(&[new]), ["callin-allow-command-105"]);
    }

    #[test]
    fn a_handler_with_more_arguments_than_the_old_list_takes_the_new_order() {
        let ten: Vec<String> = (0..10).map(|i| format!("a{i}")).collect();
        let ten: Vec<&str> = ten.iter().map(String::as_str).collect();
        assert_eq!(
            left_out(&[handler(DAMAGED, &ten)]),
            ["callin-unit-damaged-95"]
        );
        assert_eq!(
            left_out(&[handler(COMMAND, &ten[..9])]),
            ["callin-allow-command-105"]
        );
    }

    #[test]
    fn a_handler_that_reads_the_moved_arguments_by_the_old_order_keeps_the_adapter() {
        let old = handler(DAMAGED, &["u", "d", "t", "dmg", "p", "w", "attackerID"]);
        let new = handler(DAMAGED, &["u", "d", "t", "dmg", "p", "w", "projectileID"]);
        assert!(left_out(std::slice::from_ref(&old)).is_empty());
        // A game updated in one place and not another keeps what it shipped
        // with, as neither order suits every handler.
        assert!(left_out(&[old, new]).is_empty());
    }

    #[test]
    fn a_handler_that_never_reads_the_moved_arguments_decides_nothing() {
        let short = handler(DAMAGED, &["u", "d", "t", "dmg", "p", "w", "..."]);
        assert!(left_out(std::slice::from_ref(&short)).is_empty());
        let new = handler(DAMAGED, &["u", "d", "t", "dmg", "p", "w", "projectileID"]);
        assert_eq!(left_out(&[short, new]), ["callin-unit-damaged-95"]);
    }

    const GROUND: &str = "signature:Spring.GetGroundInfo@105.0";

    fn left_out_of_11(handlers: &[Handler]) -> Vec<String> {
        let full = manifest(11).unwrap();
        let picked = for_game(&full, handlers);
        full.fixes
            .into_iter()
            .filter(|id| !picked.fixes.contains(id))
            .collect()
    }

    #[test]
    fn a_call_that_reads_the_metal_second_keeps_the_ground_info_adapter() {
        // Spring 1944's game_flagManager.lua, written for the old order.
        let old = handler(GROUND, &["_", "curMetal"]);
        assert!(left_out_of_11(std::slice::from_ref(&old)).is_empty());
        let old = handler(GROUND, &["typeName", "metal", "hardness"]);
        assert!(left_out_of_11(&[old]).is_empty());
    }

    #[test]
    fn a_call_that_reads_the_new_order_leaves_the_ground_info_adapter_out() {
        for new in [
            handler(GROUND, &["_", "_", "metal"]),
            handler(GROUND, &["ttIndex", "ttName"]),
            handler(GROUND, &["_", "name", "_", "hardness"]),
        ] {
            assert_eq!(
                left_out_of_11(std::slice::from_ref(&new)),
                ["spring-ground-info-105"],
                "{new:?}"
            );
        }
        let nine: Vec<String> = (0..9).map(|i| format!("v{i}")).collect();
        let nine: Vec<&str> = nine.iter().map(String::as_str).collect();
        assert_eq!(
            left_out_of_11(&[handler(GROUND, &nine)]),
            ["spring-ground-info-105"]
        );
    }

    #[test]
    fn a_call_whose_names_say_nothing_about_the_order_decides_nothing() {
        let unclear = handler(GROUND, &["a", "b", "c"]);
        assert!(left_out_of_11(std::slice::from_ref(&unclear)).is_empty());
        let new = handler(GROUND, &["_", "_", "metal"]);
        assert_eq!(
            left_out_of_11(&[unclear, new.clone()]),
            ["spring-ground-info-105"]
        );
        // Calls of both orders keep what the game shipped with.
        let old = handler(GROUND, &["_", "metal"]);
        assert!(left_out_of_11(&[old, new]).is_empty());
    }

    /// Issue #4695: manifest 11 adds `Game.version` and the old
    /// `Spring.GetGroundInfo` order, and keeps the writer of manifest 10.
    #[test]
    fn manifest_11_is_manifest_10_with_game_version_and_the_old_ground_info() {
        let (ten, eleven) = (manifest(10).unwrap(), manifest(11).unwrap());
        let added: Vec<&String> = eleven
            .fixes
            .iter()
            .filter(|id| !ten.fixes.contains(id))
            .collect();
        assert_eq!(added, ["game-version-104", "spring-ground-info-105"]);
        let kept: Vec<&String> = eleven
            .fixes
            .iter()
            .filter(|id| ten.fixes.contains(id))
            .collect();
        assert_eq!(kept, ten.fixes.iter().collect::<Vec<_>>());
        assert_eq!(
            (&eleven.converter, eleven.writer),
            (&ten.converter, ten.writer)
        );
        for state in [LuaState::Synced, LuaState::Unsynced] {
            let ids: Vec<&str> = prelude_fixes(&eleven, state)
                .iter()
                .map(|(id, _)| *id)
                .collect();
            assert!(ids.contains(&"game-version-104"), "{state:?}");
            assert!(ids.contains(&"spring-ground-info-105"), "{state:?}");
        }
    }

    /// Issues #4700 and #4699: manifest 14 stores a numeric string given to a
    /// rules param as a number, and reads an icon type the game does not
    /// define as "default", as 104.0 did, and keeps the writer of manifest 13.
    #[test]
    fn manifest_14_is_manifest_13_with_the_old_rules_params_and_icon_types() {
        let (thirteen, fourteen) = (manifest(13).unwrap(), manifest(14).unwrap());
        let added: Vec<&String> = fourteen
            .fixes
            .iter()
            .filter(|id| !thirteen.fixes.contains(id))
            .collect();
        assert_eq!(added, ["spring-rules-param-105", "defs-icon-type-2025"]);
        assert_eq!(
            defs_fixes(&fourteen, DefsFile::DefsPost).last(),
            Some(&"defs-icon-type-2025")
        );
        assert!(!defs_fixes(&fourteen, DefsFile::WeaponDefsPost).contains(&"defs-icon-type-2025"));
        let kept: Vec<&String> = fourteen
            .fixes
            .iter()
            .filter(|id| thirteen.fixes.contains(id))
            .collect();
        assert_eq!(kept, thirteen.fixes.iter().collect::<Vec<_>>());
        assert_eq!(
            (&fourteen.converter, fourteen.writer),
            (&thirteen.converter, thirteen.writer)
        );
        let ids = |state| -> Vec<&str> {
            prelude_fixes(&fourteen, state)
                .iter()
                .map(|(id, _)| *id)
                .collect()
        };
        assert!(ids(LuaState::Synced).contains(&"spring-rules-param-105"));
        assert!(!ids(LuaState::Unsynced).contains(&"spring-rules-param-105"));
    }

    /// Issues #4692 to #4694: manifest 12 adds the unsynced fix that puts
    /// back snext, spairs and sipairs, the synced one that keeps unit lineage
    /// and the adapter for Spring.GetTeamInfo's results, and keeps the writer
    /// of manifest 11.
    #[test]
    fn manifest_12_is_manifest_11_with_the_iterators_lineage_and_team_info() {
        let (eleven, twelve) = (manifest(11).unwrap(), manifest(12).unwrap());
        assert_eq!(twelve.fixes[..eleven.fixes.len()], eleven.fixes[..]);
        assert_eq!(
            twelve.fixes[eleven.fixes.len()..],
            [
                "snext-spairs-sipairs",
                "spring-unit-lineage",
                "spring-get-team-info-105"
            ]
        );
        assert_eq!(
            (&twelve.converter, twelve.writer),
            (&eleven.converter, eleven.writer)
        );
        let ids = |state| -> Vec<&str> {
            prelude_fixes(&twelve, state)
                .iter()
                .map(|(id, _)| *id)
                .collect()
        };
        let (synced, unsynced) = (ids(LuaState::Synced), ids(LuaState::Unsynced));
        assert!(
            unsynced.contains(&"snext-spairs-sipairs") && !synced.contains(&"snext-spairs-sipairs")
        );
        assert!(
            synced.contains(&"spring-unit-lineage") && !unsynced.contains(&"spring-unit-lineage")
        );
        for ids in [&synced, &unsynced] {
            assert!(ids.contains(&"spring-get-team-info-105"));
        }
    }

    const TEAM_INFO: &str = "signature:Spring.GetTeamInfo@105.0";

    /// The fixes manifest 12 leaves out for a game whose Lua takes
    /// `Spring.GetTeamInfo`'s results into these names.
    fn team_info_left_out(sites: &[&[&str]]) -> Vec<String> {
        let full = manifest(12).unwrap();
        let handlers: Vec<Handler> = sites.iter().map(|s| handler(TEAM_INFO, s)).collect();
        let picked = for_game(&full, &handlers);
        full.fixes
            .into_iter()
            .filter(|id| !picked.fixes.contains(id))
            .collect()
    }

    /// Issue #4694: XTA and Expand and Exterminate read the custom keys 7th.
    #[test]
    fn a_call_that_reads_the_custom_keys_seventh_keeps_the_team_info_adapter() {
        let keys = ["_", "_", "_", "_", "_", "_", "teamOptions"];
        assert!(team_info_left_out(&[&keys]).is_empty());
        // The colours GetTeamInfo returned before Spring 0.76 read past the
        // 7th, and are no sign of the new order.
        let colours = ["_", "_", "_", "_", "_", "_", "r", "g", "b"];
        assert!(team_info_left_out(&[&colours, &["_", "_", "_", "isDead"]]).is_empty());
    }

    #[test]
    fn a_call_that_reads_the_new_order_leaves_the_team_info_adapter_out() {
        let income = ["_", "_", "_", "_", "_", "_", "incomeMultiplier"];
        assert_eq!(team_info_left_out(&[&income]), ["spring-get-team-info-105"]);
        let keys = ["_", "_", "_", "_", "_", "_", "_", "customKeys"];
        assert_eq!(team_info_left_out(&[&keys]), ["spring-get-team-info-105"]);
        let opts = [
            "id", "leader", "dead", "ai", "side", "ally", "mult", "teamOpts",
        ];
        assert_eq!(team_info_left_out(&[&opts]), ["spring-get-team-info-105"]);
        let old = ["_", "_", "_", "_", "_", "_", "teamOptions"];
        assert!(team_info_left_out(&[&income, &old]).is_empty());
        // Reading no further than the side decides nothing.
        assert_eq!(
            team_info_left_out(&[&income, &["_", "_", "_", "_", "side"]]),
            ["spring-get-team-info-105"]
        );
    }

    #[test]
    fn a_manifest_without_the_adapter_is_left_as_it_is() {
        let m = manifest(1).unwrap();
        let new = handler(DAMAGED, &["u", "d", "t", "dmg", "p", "w", "projectileID"]);
        assert_eq!(for_game(&m, &[new]), m);
    }

    #[test]
    fn luaui_lua_is_taken_before_luaui_main_lua() {
        let m = manifest(2).unwrap();
        let both = files_for(&m, |path| match path {
            "luaui.lua" | "LuaUI/main.lua" => Some(path.to_string()),
            _ => None,
        });
        let paths: Vec<&str> = both.iter().map(|(p, _)| p.as_str()).collect();
        assert_eq!(paths, ["compat/prelude-unsynced.lua", "luaui.lua"]);
        let main_only = files_for(&m, |path| (path == "LuaUI/main.lua").then(String::new));
        assert_eq!(main_only[0].0, "LuaUI/main.lua");
    }

    #[test]
    fn every_entry_file_of_a_full_game_is_wrapped_for_its_state() {
        let m = manifest(2).unwrap();
        let files = files_for(&m, |path| Some(format!("-- {path}\n")));
        let paths: Vec<&str> = files.iter().map(|(p, _)| p.as_str()).collect();
        assert_eq!(
            paths,
            [
                "LuaGaia/draw.lua",
                "LuaGaia/main.lua",
                "LuaIntro/main.lua",
                "LuaRules/draw.lua",
                "LuaRules/main.lua",
                "compat/prelude-synced.lua",
                "compat/prelude-unsynced.lua",
                "luaui.lua",
            ]
        );
        for (path, text) in &files {
            if path.starts_with("compat/") {
                continue;
            }
            let state = if path.ends_with("main.lua") && !path.starts_with("LuaIntro") {
                LuaState::Synced
            } else {
                LuaState::Unsynced
            };
            let wrapped = wrap_entry(format!("-- {path}\n").as_bytes(), state);
            assert_eq!(text.as_bytes(), wrapped, "{path}");
        }
    }

    /// The preludes for manifests 9, 11, 12 and 14, as the Lua tests in
    /// `lua/compat/tests/` load them. Earlier manifests' synced preludes call
    /// `rawget`, which the tests' synced state lacks, so they are not kept.
    /// `COILBOX_WRITE_FIXTURE=1` writes them again after a deliberate change to
    /// how a prelude is built.
    #[test]
    fn the_lua_tests_load_the_preludes_this_crate_builds() {
        for n in [9, 11, 12, 14] {
            let m = manifest(n).unwrap();
            for state in [LuaState::Synced, LuaState::Unsynced] {
                let built = prelude(&m, state).unwrap();
                let path = compat_dir()
                    .join("tests/fixtures")
                    .join(format!("prelude-{n}-{}.lua", state.name()));
                if std::env::var_os("COILBOX_WRITE_FIXTURE").is_some() {
                    fs::write(&path, &built).unwrap();
                }
                let on_disk = fs::read_to_string(&path).unwrap_or_default();
                assert!(
                    on_disk == built,
                    "{} is not what manifest {n} builds",
                    path.display()
                );
            }
        }
    }
}
