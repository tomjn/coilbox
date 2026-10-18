//! The compat mutator's folder, its files, and whether it is stale (issue #4556).
//!
//! A compat mutator is a loose `coilbox-compat-<stem>-<n>.sdd` under the
//! content root's `games/`, depending on the original game, which it never
//! edits. `<stem>` is the base archive's file name, lowercased, without its
//! extension, and `<n>` is the manifest version it was built from.
//!
//! Two machines on the same manifest have to write the same bytes, so a
//! multiplayer game sees a version mismatch as a missing archive and not a
//! desync. So nothing written depends on the machine: the files are sorted by
//! path, every line ends in LF, and nothing carries a timestamp or a path.
//!
//! The one exception is [`MARKER`], which records the coilbox version that
//! wrote the folder. Its name starts with a dot, and the engine leaves every
//! such file out of an archive's checksum (`CreateIgnoreFilter` in
//! `rts/System/FileSystem/ArchiveScanner.cpp` adds `^\..*$`), so it does not
//! change what two players compare.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tauri_plugin_coilbox_workshop::{lua_string, CompiledFile};

/// The start of every compat mutator's folder name.
pub const PREFIX: &str = "coilbox-compat-";

/// The file in the folder that records what it was built from.
pub const MARKER: &str = ".coilbox-compat.json";

/// The archive extensions unitsync reports a game under.
const ARCHIVE_EXTENSIONS: &[&str] = &["sd7", "sdz", "sdd", "sdp"];

/// The base archive's file name, lowercased and without its extension, or an
/// error for a name that is not a plain archive file name.
pub fn stem(archive_name: &str) -> Result<String, String> {
    let refuse = || format!("{archive_name:?} is not a game archive's file name");
    if archive_name.contains(['/', '\\']) || archive_name.chars().any(char::is_control) {
        return Err(refuse());
    }
    let (stem, ext) = archive_name.rsplit_once('.').ok_or_else(refuse)?;
    let ext = ext.to_ascii_lowercase();
    if stem.is_empty() || stem.ends_with('.') || !ARCHIVE_EXTENSIONS.contains(&ext.as_str()) {
        return Err(refuse());
    }
    Ok(stem.to_lowercase())
}

/// The folder name of the compat mutator for `archive_name` at manifest `n`.
pub fn folder(archive_name: &str, n: u32) -> Result<String, String> {
    Ok(format!("{PREFIX}{}-{n}.sdd", stem(archive_name)?))
}

/// `games/` under `data_dir`, which has to be a content root that exists.
pub fn games_dir(data_dir: &str) -> Result<PathBuf, String> {
    let root = PathBuf::from(data_dir);
    if !root.is_absolute() || !root.is_dir() {
        return Err(format!("not a content root: {data_dir}"));
    }
    Ok(root.join("games"))
}

/// What [`MARKER`] records.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Marker {
    pub manifest_version: u32,
    /// The [`coilbox_compat::WRITER`] that wrote the folder. A marker from
    /// before the field was written by the first.
    #[serde(default = "first_writer")]
    pub writer: u32,
    /// The base archive's checksum as unitsync reports it.
    pub base_checksum: String,
    pub coilbox_version: String,
}

fn first_writer() -> u32 {
    1
}

/// `modinfo.lua`. The engine appends `version` to `name` unless the name
/// already contains it (`ArchiveData` in `ArchiveScanner.cpp`), and
/// `(compat <n>)` always does, so the game is listed as exactly `name`.
///
/// `shortname` is the base game's own, so game Lua that checks
/// `Game.gameShortName` sees the game and not the mutator. It is left out when
/// the base game declares none.
fn modinfo(game_name: &str, short_name: Option<&str>, n: u32) -> String {
    let shortname = short_name
        .map(|s| format!("\x20 shortname = {},\n", lua_string(s)))
        .unwrap_or_default();
    format!(
        "-- Written by coilbox's compatibility mode. Rebuilt from compat manifest {n}, so do not edit it.\n\
         return {{\n\
         \x20 name = {name},\n\
         \x20 version = {version},\n\
         {shortname}\
         \x20 modtype = 1,\n\
         \x20 depend = {{\n\
         \x20   {depend},\n\
         \x20 }},\n\
         }}\n",
        name = lua_string(&format!("{game_name} (compat {n})")),
        version = lua_string(&n.to_string()),
        depend = lua_string(game_name),
    )
}

/// Every file of the mutator for `game_name` built from `manifest`, sorted by
/// path, with the marker last so a write that stops part way leaves none.
///
/// The Lua prelude's fixes (#4558) are written with the base game's entry files
/// wrapped to load it, which `read` returns by path, `None` for one the game
/// does not have. The gadget fixes (#4559) are written to `LuaRules/Gadgets/`
/// as they are. The def fixes (#4560) go in the def files, which the build
/// writes once it knows which the game can take (see `defs`). A manifest that
/// lists a fix of no kind this coilbox knows is refused rather than built
/// without it.
pub fn files(
    manifest: &coilbox_compat::Manifest,
    game_name: &str,
    short_name: Option<&str>,
    marker: &Marker,
    read: impl FnMut(&str) -> Result<Option<String>, String>,
) -> Result<Vec<CompiledFile>, String> {
    if game_name.trim().is_empty() {
        return Err("the base game has no name to depend on".into());
    }
    if manifest.fixes.iter().any(|id| {
        !coilbox_compat::is_prelude_fix(id)
            && !coilbox_compat::is_gadget_fix(id)
            && !coilbox_compat::is_defs_fix(id)
    }) {
        return Err(format!(
            "compat {} lists fixes this coilbox cannot write yet",
            manifest.version
        ));
    }
    let mut files = vec![CompiledFile {
        path: "modinfo.lua".into(),
        contents: modinfo(game_name, short_name, manifest.version),
    }];
    for (path, contents) in coilbox_compat::prelude_files(manifest, read)?
        .into_iter()
        .chain(coilbox_compat::gadget_files(manifest))
    {
        files.push(CompiledFile { path, contents });
    }
    files.sort_by(|a, b| a.path.cmp(&b.path));
    let marker = serde_json::to_string_pretty(marker).map_err(|e| e.to_string())? + "\n";
    files.push(CompiledFile {
        path: MARKER.into(),
        contents: marker,
    });
    Ok(files)
}

/// Refuse a manifest whose converter or writer is not the one this build
/// carries: its mutator could not be reproduced byte for byte.
pub fn check_pins(manifest: &coilbox_compat::Manifest) -> Result<(), String> {
    if manifest.writer != coilbox_compat::WRITER {
        return Err(format!(
            "compat {} needs compat writer {}, and this coilbox has writer {}",
            manifest.version,
            manifest.writer,
            coilbox_compat::WRITER
        ));
    }
    let pin = &manifest.converter;
    if pin.name != "coilbox-3do-convert" || pin.version != coilbox_3do_convert::VERSION {
        return Err(format!(
            "compat {} needs {} {}, and this coilbox has coilbox-3do-convert {}",
            manifest.version,
            pin.name,
            pin.version,
            coilbox_3do_convert::VERSION
        ));
    }
    Ok(())
}

/// Why a built mutator no longer matches what would be built now.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum Stale {
    /// Built from an older or newer manifest than the one coilbox builds now.
    Manifest { built: u32, now: u32 },
    /// Written by another version of the code that writes the mutator.
    Writer { built: u32, now: u32 },
    /// The base archive has changed since.
    BaseChecksum { built: String, now: String },
    /// The folder has no marker coilbox can read.
    NoMarker,
}

/// Why a mutator built as `marker` is stale against manifest `now`, the
/// writer that manifest names, and the base archive's current checksum. Empty
/// means it is current.
pub fn staleness(
    marker: Option<&Marker>,
    now: u32,
    writer: u32,
    base_checksum: &str,
) -> Vec<Stale> {
    let Some(marker) = marker else {
        return vec![Stale::NoMarker];
    };
    let mut why = Vec::new();
    if marker.manifest_version != now {
        why.push(Stale::Manifest {
            built: marker.manifest_version,
            now,
        });
    }
    if marker.writer != writer {
        why.push(Stale::Writer {
            built: marker.writer,
            now: writer,
        });
    }
    if !marker.base_checksum.eq_ignore_ascii_case(base_checksum) {
        why.push(Stale::BaseChecksum {
            built: marker.base_checksum.clone(),
            now: base_checksum.to_string(),
        });
    }
    why
}

/// The marker in `dir`, or `None` when there is none or it does not parse.
pub fn read_marker(dir: &Path) -> Option<Marker> {
    let text = std::fs::read_to_string(dir.join(MARKER)).ok()?;
    serde_json::from_str(&text).ok()
}

/// Every compat mutator built for `archive_name` in `games`, as its folder
/// name and manifest version, in no particular order.
pub fn built_folders(games: &Path, archive_name: &str) -> Result<Vec<(String, u32)>, String> {
    let start = format!("{PREFIX}{}-", stem(archive_name)?);
    let Ok(entries) = std::fs::read_dir(games) else {
        return Ok(Vec::new());
    };
    Ok(entries
        .flatten()
        .filter(|e| e.path().is_dir())
        .filter_map(|e| e.file_name().into_string().ok())
        .filter_map(|name| {
            let n = name.strip_prefix(&start)?.strip_suffix(".sdd")?;
            // Only the spelling `folder` writes, so `+2` and `02` are not 2.
            let v = n.parse::<u32>().ok().filter(|v| v.to_string() == n)?;
            Some((name, v))
        })
        .collect())
}

/// The newest compat mutator built for `archive_name` in `games`, as its folder
/// name and manifest version, or `None` when there is none.
pub fn newest_built(games: &Path, archive_name: &str) -> Result<Option<(String, u32)>, String> {
    Ok(built_folders(games, archive_name)?
        .into_iter()
        .max_by_key(|(_, n)| *n))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn no_file(_: &str) -> Result<Option<String>, String> {
        Ok(None)
    }

    fn marker(n: u32, checksum: &str) -> Marker {
        Marker {
            manifest_version: n,
            writer: coilbox_compat::WRITER,
            base_checksum: checksum.into(),
            coilbox_version: "1.2.3".into(),
        }
    }

    #[test]
    fn a_packed_game_is_named_by_its_file_without_the_extension() {
        assert_eq!(
            folder("xta-9.65.sd7", 1).unwrap(),
            "coilbox-compat-xta-9.65-1.sdd"
        );
        assert_eq!(
            folder("Balanced_Annihilation-V15.9.8.SDZ", 3).unwrap(),
            "coilbox-compat-balanced_annihilation-v15.9.8-3.sdd"
        );
    }

    #[test]
    fn a_loose_game_is_named_the_same_way() {
        assert_eq!(
            folder("SplinterFaction.sdd", 1).unwrap(),
            "coilbox-compat-splinterfaction-1.sdd"
        );
    }

    #[test]
    fn a_name_that_is_not_an_archive_file_is_refused() {
        for bad in [
            "../xta.sd7",
            "games/xta.sd7",
            "a\\b.sdz",
            "xta",
            "xta.lua",
            ".sd7",
            "..sd7",
            "xta\n.sd7",
        ] {
            assert!(folder(bad, 1).is_err(), "{bad:?}");
        }
    }

    #[test]
    fn the_modinfo_depends_on_the_base_game_and_names_the_version() {
        let m = coilbox_compat::manifest(1).unwrap();
        let files = files(&m, "XTA \"v\" 9.65", None, &marker(1, "abc"), no_file).unwrap();
        let modinfo = &files[0];
        assert_eq!(modinfo.path, "modinfo.lua");
        assert!(modinfo
            .contents
            .contains(r#"name = "XTA \"v\" 9.65 (compat 1)","#));
        assert!(modinfo.contents.contains(r#"version = "1","#));
        assert!(modinfo.contents.contains("modtype = 1,"));
        assert!(modinfo.contents.contains(r#"    "XTA \"v\" 9.65","#));
        let lua = coilbox_springlua::SpringLua::new(tempfile::tempdir().unwrap().path())
            .unwrap()
            .eval_value(&modinfo.contents, "modinfo.lua")
            .unwrap();
        assert_eq!(lua["depend"][0], "XTA \"v\" 9.65");
        assert_eq!(lua["modtype"], 1);
    }

    #[test]
    fn the_modinfo_carries_the_base_games_short_name() {
        let m = coilbox_compat::manifest(1).unwrap();
        let files = files(&m, "XTA 9.65", Some("XTA"), &marker(1, "abc"), no_file).unwrap();
        let lua = coilbox_springlua::SpringLua::new(tempfile::tempdir().unwrap().path())
            .unwrap()
            .eval_value(&files[0].contents, "modinfo.lua")
            .unwrap();
        assert_eq!(lua["shortname"], "XTA");
    }

    #[test]
    fn a_game_with_no_short_name_gets_none_in_the_modinfo() {
        let m = coilbox_compat::manifest(1).unwrap();
        let files = files(&m, "XTA 9.65", None, &marker(1, "abc"), no_file).unwrap();
        assert!(!files[0].contents.contains("shortname"));
    }

    #[test]
    fn a_short_name_is_escaped_as_a_lua_string() {
        let m = coilbox_compat::manifest(1).unwrap();
        let files = files(&m, "XTA", Some("X\"\\TA"), &marker(1, "abc"), no_file).unwrap();
        let lua = coilbox_springlua::SpringLua::new(tempfile::tempdir().unwrap().path())
            .unwrap()
            .eval_value(&files[0].contents, "modinfo.lua")
            .unwrap();
        assert_eq!(lua["shortname"], "X\"\\TA");
    }

    #[test]
    fn the_files_are_sorted_with_lf_endings_and_the_marker_last() {
        let m = coilbox_compat::manifest(1).unwrap();
        let files = files(&m, "XTA 9.65", None, &marker(1, "abc"), no_file).unwrap();
        let paths: Vec<_> = files.iter().map(|f| f.path.as_str()).collect();
        assert_eq!(paths, ["modinfo.lua", MARKER]);
        for f in &files {
            assert!(!f.contents.contains('\r'), "{}", f.path);
            assert!(f.contents.ends_with('\n'), "{}", f.path);
        }
        let back: Marker = serde_json::from_str(&files[1].contents).unwrap();
        assert_eq!(back, marker(1, "abc"));
    }

    #[test]
    fn two_builds_of_the_same_manifest_are_the_same_bytes() {
        let m = coilbox_compat::manifest(1).unwrap();
        let a = files(&m, "XTA 9.65", None, &marker(1, "abc"), no_file).unwrap();
        let b = files(&m, "XTA 9.65", None, &marker(1, "abc"), no_file).unwrap();
        let bytes = |fs: &[CompiledFile]| -> Vec<(String, String)> {
            fs.iter()
                .map(|f| (f.path.clone(), f.contents.clone()))
                .collect()
        };
        assert_eq!(bytes(&a), bytes(&b));
    }

    #[test]
    fn a_manifest_that_lists_a_fix_outside_the_prelude_is_refused() {
        let mut m = coilbox_compat::manifest(1).unwrap();
        m.fixes.push("not-a-prelude-fix".into());
        assert!(files(&m, "XTA 9.65", None, &marker(1, "abc"), no_file).is_err());
    }

    #[test]
    fn the_prelude_is_written_with_the_entry_files_the_game_has() {
        let m = coilbox_compat::manifest(2).unwrap();
        let read = |path: &str| -> Result<Option<String>, String> {
            Ok((path == "LuaRules/main.lua").then(|| "-- the game's rules\n".to_string()))
        };
        let files = files(&m, "XTA 9.65", None, &marker(2, "abc"), read).unwrap();
        let paths: Vec<_> = files.iter().map(|f| f.path.as_str()).collect();
        assert_eq!(
            paths,
            [
                "LuaRules/main.lua",
                "compat/prelude-synced.lua",
                "modinfo.lua",
                MARKER
            ]
        );
        assert_eq!(
            files[0].contents,
            "VFS.Include(\"compat/prelude-synced.lua\") -- the game's rules\n"
        );
        for f in &files {
            assert!(!f.contents.contains('\r'), "{}", f.path);
            assert!(f.contents.ends_with('\n'), "{}", f.path);
        }
    }

    #[test]
    fn the_gadgets_are_written_to_luarules_gadgets_as_they_are() {
        let m = coilbox_compat::manifest(3).unwrap();
        let files = files(&m, "XTA 9.65", None, &marker(3, "abc"), no_file).unwrap();
        let paths: Vec<_> = files.iter().map(|f| f.path.as_str()).collect();
        assert_eq!(
            paths,
            [
                "LuaRules/Gadgets/coilbox_compat_aircraft_crash.lua",
                "LuaRules/Gadgets/coilbox_compat_messages_tdf.lua",
                "LuaRules/Gadgets/coilbox_compat_only_forward_aim.lua",
                "modinfo.lua",
                MARKER
            ]
        );
        assert_eq!(
            files[1].contents,
            coilbox_compat::fix_source("gadget-messages-tdf-95").unwrap()
        );
        let again = super::files(&m, "XTA 9.65", None, &marker(3, "abc"), no_file).unwrap();
        assert!(files
            .iter()
            .zip(&again)
            .all(|(a, b)| a.path == b.path && a.contents == b.contents));
    }

    #[test]
    fn a_failed_read_of_the_base_game_fails_the_build() {
        let m = coilbox_compat::manifest(2).unwrap();
        let read = |_: &str| -> Result<Option<String>, String> { Err("no worker".into()) };
        assert_eq!(
            files(&m, "XTA 9.65", None, &marker(2, "abc"), read).err(),
            Some("no worker".to_string())
        );
    }

    #[test]
    fn the_latest_manifest_pins_the_converter_and_writer_this_build_carries() {
        let m = coilbox_compat::manifest(coilbox_compat::latest()).unwrap();
        assert_eq!(check_pins(&m), Ok(()));
        let mut other = m.clone();
        other.converter.version = "0.0.0".into();
        assert!(check_pins(&other).is_err());
        let mut other = m.clone();
        other.writer = coilbox_compat::WRITER + 1;
        assert!(check_pins(&other).unwrap_err().contains("writer"));
    }

    #[test]
    fn a_mutator_built_as_now_is_current() {
        assert!(staleness(Some(&marker(1, "ABC")), 1, W, "abc").is_empty());
    }

    #[test]
    fn a_new_manifest_makes_it_stale() {
        assert_eq!(
            staleness(Some(&marker(1, "abc")), 2, W, "abc"),
            [Stale::Manifest { built: 1, now: 2 }]
        );
    }

    #[test]
    fn a_changed_base_archive_makes_it_stale() {
        assert_eq!(
            staleness(Some(&marker(1, "abc")), 1, W, "def"),
            [Stale::BaseChecksum {
                built: "abc".into(),
                now: "def".into()
            }]
        );
    }

    const W: u32 = coilbox_compat::WRITER;

    #[test]
    fn another_writer_makes_it_stale() {
        let mut old = marker(1, "abc");
        old.writer = W + 1;
        assert_eq!(
            staleness(Some(&old), 1, W, "abc"),
            [Stale::Writer {
                built: W + 1,
                now: W
            }]
        );
    }

    /// Markers written before the field read as the first writer.
    #[test]
    fn a_marker_without_a_writer_was_written_by_the_first() {
        let old = r#"{"manifestVersion": 2, "baseChecksum": "abc", "coilboxVersion": "1.2.3"}"#;
        let marker: Marker = serde_json::from_str(old).unwrap();
        assert_eq!(marker.writer, 1);
    }

    #[test]
    fn a_folder_without_a_marker_is_stale() {
        assert_eq!(staleness(None, 1, W, "abc"), [Stale::NoMarker]);
    }

    #[test]
    fn the_newest_built_folder_is_found_by_its_number() {
        let root = tempfile::tempdir().unwrap();
        let games = root.path();
        for name in [
            "coilbox-compat-xta-9.65-2.sdd",
            "coilbox-compat-xta-9.65-10.sdd",
            "coilbox-compat-xta-9.65-x.sdd",
            "coilbox-compat-xta-9.65-+11.sdd",
            "coilbox-compat-xta-9.65-011.sdd",
            "coilbox-compat-other-12.sdd",
        ] {
            std::fs::create_dir(games.join(name)).unwrap();
        }
        std::fs::write(games.join("coilbox-compat-xta-9.65-20.sdd"), "a file").unwrap();
        assert_eq!(
            newest_built(games, "xta-9.65.sd7").unwrap(),
            Some(("coilbox-compat-xta-9.65-10.sdd".into(), 10))
        );
        assert_eq!(newest_built(games, "ba.sdz").unwrap(), None);
        assert_eq!(newest_built(&games.join("nope"), "ba.sdz").unwrap(), None);
    }
}
