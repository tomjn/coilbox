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
use tauri_plugin_coilbox_unitsync::DeclaredGame;
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

/// One file of a compat mutator, as the path in the folder and its bytes. Bytes
/// rather than text, because a game's own entry file is copied in as it is,
/// and it need not be UTF-8 (issue #4641).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct File {
    pub path: String,
    pub contents: Vec<u8>,
}

impl From<CompiledFile> for File {
    fn from(file: CompiledFile) -> Self {
        File {
            path: file.path,
            contents: file.contents.into_bytes(),
        }
    }
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
    /// The palette the model conversion read (issue #4642), which the base
    /// checksum does not cover. Left out when no model was converted, so the
    /// palette coloured nothing, and by markers from before the field.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub palette: Option<coilbox_compat::Palette>,
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
///
/// A manifest that lists [`coilbox_compat::GAME_IDENTITY_FIX`] also gets the
/// base game's `name` and `version` as `compatbasename` and `compatbaseversion`,
/// which that fix copies into `Game.gameName` and `Game.gameVersion` (issue
/// #4633). They are left out of every other manifest, whose bytes are fixed. A
/// base game with no version gets an empty one, which is what it reads as.
fn modinfo(
    game_name: &str,
    declared: &DeclaredGame,
    manifest: &coilbox_compat::Manifest,
) -> String {
    let n = manifest.version;
    let shortname = declared
        .short_name
        .as_deref()
        .map(|s| format!("\x20 shortname = {},\n", lua_string(s)))
        .unwrap_or_default();
    let identity = if manifest
        .fixes
        .iter()
        .any(|id| id == coilbox_compat::GAME_IDENTITY_FIX)
    {
        let name = declared
            .name
            .as_deref()
            .map(|s| format!("\x20 compatbasename = {},\n", lua_string(s)))
            .unwrap_or_default();
        let version = lua_string(declared.version.as_deref().unwrap_or_default());
        format!("{name}\x20 compatbaseversion = {version},\n")
    } else {
        String::new()
    };
    format!(
        "-- Written by coilbox's compatibility mode. Rebuilt from compat manifest {n}, so do not edit it.\n\
         return {{\n\
         \x20 name = {name},\n\
         \x20 version = {version},\n\
         {shortname}\
         {identity}\
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
/// wrapped to load it, whose bytes `read` returns by path, `None` for one the
/// game does not have. The gadget fixes (#4559) are written to `LuaRules/Gadgets/`
/// as they are. The def fixes (#4560) go in the def files, which the build
/// writes once it knows which the game can take (see `defs`). A manifest that
/// lists a fix of no kind this coilbox knows is refused rather than built
/// without it.
///
/// A manifest of writer 5 or later also gets the licence notice for that Lua in
/// `compat/coilbox-licence/` (issue #4623), whether or not the game has an entry
/// file to wrap. The gadgets and the def files are coilbox's Lua too.
pub fn files(
    manifest: &coilbox_compat::Manifest,
    game_name: &str,
    declared: &DeclaredGame,
    marker: &Marker,
    read: impl FnMut(&str) -> Result<Option<Vec<u8>>, String>,
) -> Result<Vec<File>, String> {
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
    let mut files = vec![File {
        path: "modinfo.lua".into(),
        contents: modinfo(game_name, declared, manifest).into_bytes(),
    }];
    for (path, contents) in coilbox_compat::prelude_files(manifest, read)? {
        files.push(File { path, contents });
    }
    for (path, contents) in coilbox_compat::gadget_files(manifest) {
        files.push(File {
            path,
            contents: contents.into_bytes(),
        });
    }
    for (path, contents) in coilbox_compat::licence_files(manifest.writer) {
        files.push(File { path, contents });
    }
    files.sort_by(|a, b| a.path.cmp(&b.path));
    files.push(marker_file(marker)?);
    Ok(files)
}

/// [`MARKER`] recording `marker`.
pub fn marker_file(marker: &Marker) -> Result<File, String> {
    let text = serde_json::to_string_pretty(marker).map_err(|e| e.to_string())? + "\n";
    Ok(File {
        path: MARKER.into(),
        contents: text.into_bytes(),
    })
}

/// Refuse a manifest whose writer is newer than the newest this build keeps,
/// or whose converter is not `coilbox-3do-convert`: its mutator could not be
/// reproduced byte for byte.
///
/// The converter's version is not checked (issue #4678). This build carries
/// one converter, and a version check would stop it building every manifest
/// made with an older one. A change to what the converter writes goes behind a
/// compat writer instead, so the writer the manifest names decides the bytes.
pub fn check_pins(manifest: &coilbox_compat::Manifest) -> Result<(), String> {
    if !coilbox_compat::knows_writer(manifest.writer) {
        return Err(format!(
            "compat {} needs compat writer {}, and this coilbox has writers up to {}",
            manifest.version,
            manifest.writer,
            coilbox_compat::WRITER
        ));
    }
    let pin = &manifest.converter;
    if pin.name != "coilbox-3do-convert" {
        return Err(format!(
            "compat {} needs the converter {}, and this coilbox has coilbox-3do-convert",
            manifest.version, pin.name
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
    /// The palette the models take their colours from has other bytes now,
    /// or is there now and was not, or the other way round.
    Palette {
        built: coilbox_compat::Palette,
        now: coilbox_compat::Palette,
    },
    /// The folder has no marker coilbox can read.
    NoMarker,
}

/// Why a mutator built as `marker` is stale against manifest `now`, the
/// writer that manifest names, the base archive's current checksum, and the
/// palette a conversion would read now. `palette_now` reads that, and is only
/// called for a marker that records a palette. Empty means it is current.
pub fn staleness(
    marker: Option<&Marker>,
    now: u32,
    writer: u32,
    base_checksum: &str,
    palette_now: impl FnOnce() -> Result<coilbox_compat::Palette, String>,
) -> Result<Vec<Stale>, String> {
    let Some(marker) = marker else {
        return Ok(vec![Stale::NoMarker]);
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
    if let Some(built) = &marker.palette {
        let now = palette_now()?;
        if !built.same_bytes(&now) {
            why.push(Stale::Palette {
                built: built.clone(),
                now,
            });
        }
    }
    Ok(why)
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

    fn no_file(_: &str) -> Result<Option<Vec<u8>>, String> {
        Ok(None)
    }

    fn text(file: &File) -> &str {
        std::str::from_utf8(&file.contents).unwrap()
    }

    fn declared_short(short: &str) -> DeclaredGame {
        DeclaredGame {
            short_name: Some(short.into()),
            ..Default::default()
        }
    }

    fn xta() -> DeclaredGame {
        DeclaredGame {
            short_name: Some("XTA".into()),
            name: Some("XTA".into()),
            version: Some("9.65".into()),
        }
    }

    fn modinfo_of(files: &[File]) -> String {
        text(files.iter().find(|f| f.path == "modinfo.lua").unwrap()).to_string()
    }

    fn eval(modinfo: &str) -> serde_json::Value {
        coilbox_springlua::SpringLua::new(tempfile::tempdir().unwrap().path())
            .unwrap()
            .eval_value(modinfo, "modinfo.lua")
            .unwrap()
    }

    fn marker(n: u32, checksum: &str) -> Marker {
        Marker {
            manifest_version: n,
            writer: coilbox_compat::WRITER,
            base_checksum: checksum.into(),
            coilbox_version: "1.2.3".into(),
            palette: None,
        }
    }

    /// For a marker that records no palette, which must not read one.
    fn unread() -> Result<coilbox_compat::Palette, String> {
        panic!("read the palette for a marker that records none")
    }

    fn palette(bytes: &[u8], source: &str) -> coilbox_compat::Palette {
        coilbox_compat::Palette::of(Some(bytes), Some(source.into()))
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
        let files = files(
            &m,
            "XTA \"v\" 9.65",
            &DeclaredGame::default(),
            &marker(1, "abc"),
            no_file,
        )
        .unwrap();
        assert_eq!(files[0].path, "modinfo.lua");
        let modinfo = text(&files[0]);
        assert!(modinfo.contains(r#"name = "XTA \"v\" 9.65 (compat 1)","#));
        assert!(modinfo.contains(r#"version = "1","#));
        assert!(modinfo.contains("modtype = 1,"));
        assert!(modinfo.contains(r#"    "XTA \"v\" 9.65","#));
        let lua = coilbox_springlua::SpringLua::new(tempfile::tempdir().unwrap().path())
            .unwrap()
            .eval_value(modinfo, "modinfo.lua")
            .unwrap();
        assert_eq!(lua["depend"][0], "XTA \"v\" 9.65");
        assert_eq!(lua["modtype"], 1);
    }

    #[test]
    fn the_modinfo_carries_the_base_games_short_name() {
        let m = coilbox_compat::manifest(1).unwrap();
        let files = files(
            &m,
            "XTA 9.65",
            &declared_short("XTA"),
            &marker(1, "abc"),
            no_file,
        )
        .unwrap();
        let lua = eval(&modinfo_of(&files));
        assert_eq!(lua["shortname"], "XTA");
    }

    #[test]
    fn a_game_with_no_short_name_gets_none_in_the_modinfo() {
        let m = coilbox_compat::manifest(1).unwrap();
        let files = files(
            &m,
            "XTA 9.65",
            &DeclaredGame::default(),
            &marker(1, "abc"),
            no_file,
        )
        .unwrap();
        assert!(!modinfo_of(&files).contains("shortname"));
    }

    #[test]
    fn a_short_name_is_escaped_as_a_lua_string() {
        let m = coilbox_compat::manifest(1).unwrap();
        let files = files(
            &m,
            "XTA",
            &declared_short("X\"\\TA"),
            &marker(1, "abc"),
            no_file,
        )
        .unwrap();
        let lua = eval(&modinfo_of(&files));
        assert_eq!(lua["shortname"], "X\"\\TA");
    }

    /// Issue #4633: the engine reads `Game.gameName` and `Game.gameVersion`
    /// from the mutator's modinfo, so the base game's go beside them.
    #[test]
    fn the_modinfo_carries_the_base_games_name_and_version_from_manifest_6() {
        let m = coilbox_compat::manifest(6).unwrap();
        let files = files(&m, "XTA 9.65", &xta(), &marker(6, "abc"), no_file).unwrap();
        let lua = eval(&modinfo_of(&files));
        assert_eq!(lua["compatbasename"], "XTA");
        assert_eq!(lua["compatbaseversion"], "9.65");
        assert_eq!(lua["name"], "XTA 9.65 (compat 6)");
        assert_eq!(lua["version"], "6");
        assert_eq!(lua["shortname"], "XTA");
    }

    #[test]
    fn a_base_game_with_no_version_is_written_with_an_empty_one() {
        let m = coilbox_compat::manifest(6).unwrap();
        let bare = DeclaredGame {
            name: Some("Bare".into()),
            ..Default::default()
        };
        let files = files(&m, "Bare", &bare, &marker(6, "abc"), no_file).unwrap();
        let lua = eval(&modinfo_of(&files));
        assert_eq!(lua["compatbasename"], "Bare");
        assert_eq!(lua["compatbaseversion"], "");
    }

    #[test]
    fn the_base_games_name_and_version_are_escaped_as_lua_strings() {
        let m = coilbox_compat::manifest(6).unwrap();
        let odd = DeclaredGame {
            name: Some("X\"\\TA".into()),
            version: Some("1\"\n2".into()),
            ..Default::default()
        };
        let files = files(&m, "XTA", &odd, &marker(6, "abc"), no_file).unwrap();
        let lua = eval(&modinfo_of(&files));
        assert_eq!(lua["compatbasename"], "X\"\\TA");
        assert_eq!(lua["compatbaseversion"], "1\"\n2");
    }

    /// A shipped manifest builds the same bytes whatever the scan says, so the
    /// base game's name and version are written only for a manifest that lists
    /// the fix that reads them.
    #[test]
    fn manifests_before_6_write_the_same_modinfo_whatever_the_base_declares() {
        for n in 1..=5 {
            let m = coilbox_compat::manifest(n).unwrap();
            let with = files(&m, "XTA 9.65", &xta(), &marker(n, "abc"), no_file).unwrap();
            let without = files(
                &m,
                "XTA 9.65",
                &declared_short("XTA"),
                &marker(n, "abc"),
                no_file,
            )
            .unwrap();
            assert_eq!(modinfo_of(&with), modinfo_of(&without), "manifest {n}");
            assert!(!modinfo_of(&with).contains("compatbase"), "manifest {n}");
        }
    }

    #[test]
    fn the_files_are_sorted_with_lf_endings_and_the_marker_last() {
        let m = coilbox_compat::manifest(1).unwrap();
        let files = files(
            &m,
            "XTA 9.65",
            &DeclaredGame::default(),
            &marker(1, "abc"),
            no_file,
        )
        .unwrap();
        let paths: Vec<_> = files.iter().map(|f| f.path.as_str()).collect();
        assert_eq!(paths, ["modinfo.lua", MARKER]);
        for f in &files {
            assert!(!f.contents.contains(&b'\r'), "{}", f.path);
            assert!(f.contents.ends_with(b"\n"), "{}", f.path);
        }
        let back: Marker = serde_json::from_slice(&files[1].contents).unwrap();
        assert_eq!(back, marker(1, "abc"));
    }

    #[test]
    fn two_builds_of_the_same_manifest_are_the_same_bytes() {
        let m = coilbox_compat::manifest(1).unwrap();
        let a = files(
            &m,
            "XTA 9.65",
            &DeclaredGame::default(),
            &marker(1, "abc"),
            no_file,
        )
        .unwrap();
        let b = files(
            &m,
            "XTA 9.65",
            &DeclaredGame::default(),
            &marker(1, "abc"),
            no_file,
        )
        .unwrap();
        assert_eq!(a, b);
    }

    #[test]
    fn a_manifest_that_lists_a_fix_outside_the_prelude_is_refused() {
        let mut m = coilbox_compat::manifest(1).unwrap();
        m.fixes.push("not-a-prelude-fix".into());
        assert!(files(
            &m,
            "XTA 9.65",
            &DeclaredGame::default(),
            &marker(1, "abc"),
            no_file
        )
        .is_err());
    }

    #[test]
    fn the_prelude_is_written_with_the_entry_files_the_game_has() {
        let m = coilbox_compat::manifest(2).unwrap();
        let read = |path: &str| -> Result<Option<Vec<u8>>, String> {
            Ok((path == "LuaRules/main.lua").then(|| b"-- the game's rules\n".to_vec()))
        };
        let files = files(
            &m,
            "XTA 9.65",
            &DeclaredGame::default(),
            &marker(2, "abc"),
            read,
        )
        .unwrap();
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
            text(&files[0]),
            "VFS.Include(\"compat/prelude-synced.lua\") -- the game's rules\n"
        );
        for f in &files {
            assert!(!f.contents.contains(&b'\r'), "{}", f.path);
            assert!(f.contents.ends_with(b"\n"), "{}", f.path);
        }
    }

    #[test]
    fn the_gadgets_are_written_to_luarules_gadgets_as_they_are() {
        let m = coilbox_compat::manifest(3).unwrap();
        let files = files(
            &m,
            "XTA 9.65",
            &DeclaredGame::default(),
            &marker(3, "abc"),
            no_file,
        )
        .unwrap();
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
            text(&files[1]),
            coilbox_compat::fix_source("gadget-messages-tdf-95").unwrap()
        );
        let again = super::files(
            &m,
            "XTA 9.65",
            &DeclaredGame::default(),
            &marker(3, "abc"),
            no_file,
        )
        .unwrap();
        assert!(files
            .iter()
            .zip(&again)
            .all(|(a, b)| a.path == b.path && a.contents == b.contents));
    }

    #[test]
    fn a_failed_read_of_the_base_game_fails_the_build() {
        let m = coilbox_compat::manifest(2).unwrap();
        let read = |_: &str| -> Result<Option<Vec<u8>>, String> { Err("no worker".into()) };
        assert_eq!(
            files(
                &m,
                "XTA 9.65",
                &DeclaredGame::default(),
                &marker(2, "abc"),
                read
            )
            .err(),
            Some("no worker".to_string())
        );
    }

    #[test]
    fn the_latest_manifest_pins_the_converter_and_writer_this_build_carries() {
        let m = coilbox_compat::manifest(coilbox_compat::latest()).unwrap();
        assert_eq!(check_pins(&m), Ok(()));
        let mut other = m.clone();
        other.converter.name = "another-3do-convert".into();
        assert!(check_pins(&other)
            .unwrap_err()
            .contains("another-3do-convert"));
        let mut other = m.clone();
        other.writer = coilbox_compat::WRITER + 1;
        assert!(check_pins(&other).unwrap_err().contains("writer"));
        other.writer = 0;
        assert!(check_pins(&other).is_err());
    }

    /// A newer coilbox builds the older manifest a host is on (issue #4564),
    /// with the writer that manifest names.
    #[test]
    fn every_manifest_passes_the_pins_whatever_writer_it_names() {
        for n in 1..=coilbox_compat::latest() {
            let m = coilbox_compat::manifest(n).unwrap();
            assert_eq!(check_pins(&m), Ok(()), "manifest {n}");
        }
    }

    /// Issue #4678: a manifest made with another version of the converter
    /// still passes, older or newer.
    #[test]
    fn the_converter_version_a_manifest_names_is_not_a_pin() {
        for version in ["0.0.1", "0.2.0", "1.0.0"] {
            let mut m = coilbox_compat::manifest(1).unwrap();
            m.converter.version = version.into();
            assert_eq!(check_pins(&m), Ok(()), "{version}");
        }
    }

    #[test]
    fn a_mutator_built_as_now_is_current() {
        assert!(staleness(Some(&marker(1, "ABC")), 1, W, "abc", unread)
            .unwrap()
            .is_empty());
    }

    #[test]
    fn a_new_manifest_makes_it_stale() {
        assert_eq!(
            staleness(Some(&marker(1, "abc")), 2, W, "abc", unread).unwrap(),
            [Stale::Manifest { built: 1, now: 2 }]
        );
    }

    #[test]
    fn a_changed_base_archive_makes_it_stale() {
        assert_eq!(
            staleness(Some(&marker(1, "abc")), 1, W, "def", unread).unwrap(),
            [Stale::BaseChecksum {
                built: "abc".into(),
                now: "def".into()
            }]
        );
    }

    /// Issue #4642: the palette can come from the engine or a dependency,
    /// which the base checksum does not cover.
    #[test]
    fn a_palette_with_other_bytes_makes_it_stale() {
        let mut built = marker(1, "abc");
        built.palette = Some(palette(b"one", "springcontent.sdz"));
        let now = palette(b"two", "springcontent.sdz");
        assert_eq!(
            staleness(Some(&built), 1, W, "abc", || Ok(now.clone())).unwrap(),
            [Stale::Palette {
                built: built.palette.clone().unwrap(),
                now
            }]
        );
    }

    /// The dependency that held it has gone, so the faces would draw grey.
    #[test]
    fn a_palette_that_is_no_longer_there_makes_it_stale() {
        let mut built = marker(1, "abc");
        built.palette = Some(palette(b"one", "ba-deps.sdz"));
        let gone = coilbox_compat::Palette::of(None, None);
        let why = staleness(Some(&built), 1, W, "abc", || Ok(gone)).unwrap();
        assert!(matches!(why[..], [Stale::Palette { .. }]), "{why:?}");
    }

    #[test]
    fn the_same_palette_bytes_from_another_archive_are_current() {
        let mut built = marker(1, "abc");
        built.palette = Some(palette(b"one", "xta-9.65.sd7"));
        let moved = palette(b"one", "springcontent.sdz");
        assert!(staleness(Some(&built), 1, W, "abc", || Ok(moved))
            .unwrap()
            .is_empty());
    }

    #[test]
    fn a_palette_that_cannot_be_read_now_is_an_error() {
        let mut built = marker(1, "abc");
        built.palette = Some(palette(b"one", "xta-9.65.sd7"));
        assert_eq!(
            staleness(Some(&built), 1, W, "abc", || Err("no worker".into())),
            Err("no worker".into())
        );
    }

    #[test]
    fn a_marker_records_the_palette_only_when_it_has_one() {
        let without = String::from_utf8(marker_file(&marker(1, "abc")).unwrap().contents).unwrap();
        assert!(!without.contains("palette"), "{without}");
        let mut with = marker(1, "abc");
        with.palette = Some(palette(b"one", "springcontent.sdz"));
        let file = marker_file(&with).unwrap();
        let back: Marker = serde_json::from_slice(&file.contents).unwrap();
        assert_eq!(back, with);
    }

    const W: u32 = coilbox_compat::WRITER;

    #[test]
    fn another_writer_makes_it_stale() {
        let mut old = marker(1, "abc");
        old.writer = W + 1;
        assert_eq!(
            staleness(Some(&old), 1, W, "abc", unread).unwrap(),
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

    /// Markers written before the field record no palette, and read as one
    /// whose build converted no model.
    #[test]
    fn a_marker_without_a_palette_still_reads() {
        let old = r#"{"manifestVersion": 8, "writer": 2, "baseChecksum": "abc", "coilboxVersion": "1.2.3"}"#;
        let marker: Marker = serde_json::from_str(old).unwrap();
        assert_eq!(marker.palette, None);
    }

    #[test]
    fn a_folder_without_a_marker_is_stale() {
        assert_eq!(
            staleness(None, 1, W, "abc", unread).unwrap(),
            [Stale::NoMarker]
        );
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
