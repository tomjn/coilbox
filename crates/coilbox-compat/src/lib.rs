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

use std::collections::BTreeMap;

use serde::Deserialize;
use sha2::{Digest, Sha256};

/// The `license` every fix carries, as in `lua/LICENSE.md`.
pub const LICENSE: &str = "MIT or GNU GPL, v2 or later";

/// Every manifest, by version number.
const MANIFESTS: &[(u32, &str)] = &[
    (1, include_str!("../../../lua/compat/manifests/1.json")),
    (2, include_str!("../../../lua/compat/manifests/2.json")),
    (3, include_str!("../../../lua/compat/manifests/3.json")),
    (4, include_str!("../../../lua/compat/manifests/4.json")),
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
        "gadget-aircraft-crash-83",
        include_str!("../../../lua/compat/gadgets/gadget-aircraft-crash-83.lua"),
    ),
    (
        "gadget-aircraft-crash-83-v2",
        include_str!("../../../lua/compat/gadgets/gadget-aircraft-crash-83-v2.lua"),
    ),
    (
        "gadget-messages-tdf-95",
        include_str!("../../../lua/compat/gadgets/gadget-messages-tdf-95.lua"),
    ),
    (
        "gadget-only-forward-aim-105",
        include_str!("../../../lua/compat/gadgets/gadget-only-forward-aim-105.lua"),
    ),
    (
        "gl-smoothing",
        include_str!("../../../lua/compat/gl-smoothing.lua"),
    ),
    (
        "spring-make-font",
        include_str!("../../../lua/compat/spring-make-font.lua"),
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
        "spring-unit-travel",
        include_str!("../../../lua/compat/spring-unit-travel.lua"),
    ),
    (
        "spring-update-info-texture",
        include_str!("../../../lua/compat/spring-update-info-texture.lua"),
    ),
];

/// The recorded SHA-256 of every fix a manifest lists.
const HASHES: &str = include_str!("../../../lua/compat/manifests/hashes.txt");

/// The converter a compat version was built with.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct Converter {
    #[serde(rename = "crate")]
    pub name: String,
    pub version: String,
}

/// One compat version: the fixes that make it up and the converter it pins.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct Manifest {
    pub version: u32,
    pub fixes: Vec<String>,
    pub converter: Converter,
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
    let mut gadget = None;
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
            _ => {}
        }
    }
    Some(Header {
        id: id?,
        catalogue,
        license: license?,
        states,
        gadget,
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
         local compat = {{}}\n\
         \n\
         local function failed(id, err)\n\
         \tlocal message = \"coilbox compat fix \" .. id .. \" failed: \" .. tostring(err)\n\
         \tif type(Spring) == \"table\" and type(Spring.Log) == \"function\" then\n\
         \t\tSpring.Log(\"coilbox-compat\", type(LOG) == \"table\" and LOG.ERROR or \"error\", message)\n\
         \telseif type(Spring) == \"table\" and type(Spring.Echo) == \"function\" then\n\
         \t\tSpring.Echo(message)\n\
         \tend\n\
         end\n",
        n = manifest.version,
        state = state.name(),
    );
    for (id, src) in fixes {
        out.push_str(&format!(
            "\n-- fix: {id}\n\
             do\n\
             local ok, err = pcall(function(...)\n\
             {src}\
             end, compat)\n\
             if not ok then failed({id:?}, err) end\n\
             end\n"
        ));
    }
    Some(out)
}

/// An entry file with its state's prelude included in front of the original.
///
/// The include goes on the original's first line, so every line of the game's
/// code keeps its number in an error message.
pub fn wrap_entry(original: &str, state: LuaState) -> String {
    format!("VFS.Include(\"{}\") {original}", state.prelude_path())
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

/// A prelude fix that puts a call-in's arguments back in an older order, and
/// how to tell a handler written for the current order.
struct Adapter {
    fix: &'static str,
    /// The catalogue entry the fix addresses, which the scan of a game's Lua
    /// names a handler's call-in by.
    entry: &'static str,
    /// The 0-based position of the first argument the change moved.
    moved: usize,
    /// How many arguments the old list had.
    old_len: usize,
    /// Part of the name of the argument the change added, lower case. The old
    /// list has nothing by that name.
    added: &'static str,
}

/// Changing this changes the mutator two players build from the same manifest,
/// so a change here needs a new manifest, as a changed fix does.
const ADAPTERS: &[Adapter] = &[
    Adapter {
        fix: "callin-unit-damaged-95",
        entry: "signature:UnitDamaged@95.0",
        moved: 6,
        old_len: 9,
        added: "proj",
    },
    Adapter {
        fix: "callin-allow-command-105",
        entry: "signature:AllowCommand@105.0",
        moved: 7,
        old_len: 8,
        added: "player",
    },
];

/// A call-in handler a game's Lua defines, as the scan of it reports one: the
/// catalogue entry of the call-in, such as `signature:UnitDamaged@95.0`, and
/// the arguments the handler takes from the engine.
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
    if named.len() > adapter.old_len || named.iter().any(|p| p.contains(adapter.added)) {
        Order::New
    } else if named.len() > adapter.moved {
        Order::Old
    } else {
        Order::Either
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
/// game has for that state, wrapped. `read` returns the base game's copy of a
/// path, or `None` when it has none, and an error from it stops the build so a
/// failed read never leaves a handle without its prelude. The files are sorted
/// by path.
///
/// A game with no file for a handle gets none written, so the engine runs
/// nothing there, as it would for the game alone.
pub fn prelude_files<E>(
    manifest: &Manifest,
    mut read: impl FnMut(&str) -> Result<Option<String>, E>,
) -> Result<Vec<(String, String)>, E> {
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
            files.push((state.prelude_path().to_string(), prelude));
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
        }
    }

    fn files_for(
        m: &Manifest,
        mut read: impl FnMut(&str) -> Option<String>,
    ) -> Vec<(String, String)> {
        prelude_files::<()>(m, |path| Ok(read(path))).unwrap()
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
                assert_eq!(*first, "compat-callin-hooks", "manifest {}", m.version);
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
        let wrapped = wrap_entry(original, LuaState::Synced);
        assert_eq!(
            wrapped,
            "VFS.Include(\"compat/prelude-synced.lua\") local a = 1\nreturn a\n"
        );
        assert_eq!(wrapped.lines().count(), original.lines().count());
        assert!(wrap_entry("", LuaState::Unsynced)
            .starts_with("VFS.Include(\"compat/prelude-unsynced.lua\")"));
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
                Ok(Some(String::new()))
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
            assert_eq!(text, &wrap_entry(&format!("-- {path}\n"), state), "{path}");
        }
    }

    /// The preludes for manifest 2, as the Lua tests in `lua/compat/tests/`
    /// load them. `COILBOX_WRITE_FIXTURE=1` writes them again after a
    /// deliberate change to how a prelude is built.
    #[test]
    fn the_lua_tests_load_the_preludes_this_crate_builds() {
        let m = manifest(2).unwrap();
        for state in [LuaState::Synced, LuaState::Unsynced] {
            let built = prelude(&m, state).unwrap();
            let path = compat_dir()
                .join("tests/fixtures")
                .join(format!("prelude-2-{}.lua", state.name()));
            if std::env::var_os("COILBOX_WRITE_FIXTURE").is_some() {
                fs::write(&path, &built).unwrap();
            }
            let on_disk = fs::read_to_string(&path).unwrap_or_default();
            assert!(
                on_disk == built,
                "{} is not what manifest 2 builds",
                path.display()
            );
        }
    }
}
