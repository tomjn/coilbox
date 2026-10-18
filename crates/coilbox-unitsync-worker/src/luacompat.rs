//! `--lua-compat` mode: find each use of a Lua API the engine removed or
//! changed in a game and the archives it depends on (issue #4553).
//!
//! Every `.lua` under `luarules/`, `luaui/`, `luaintro/`, `gamedata/` and
//! `scripts/` is read out of its archive and handed to
//! [`coilbox_luacompat::scan`]. Nothing is mounted. Each archive is opened and
//! read on its own, so a hit names the archive it is in.
//!
//! Dependencies that are base content, `springcontent` and `maphelper`, are
//! skipped. Every game gets them from the engine, so a hit in one is not the
//! game's to fix.

use std::collections::BTreeSet;
use std::path::Path;

use coilbox_luacompat::{scan, Catalogue, Hit};
use serde::Serialize;

use crate::ffi::Unitsync;

/// The folders whose Lua is scanned, compared lower case. Games spell them
/// `LuaRules` and `LuaUI` as often as not.
const FOLDERS: [&str; 5] = ["luarules", "luaui", "luaintro", "gamedata", "scripts"];

/// Everything the scan found in one game.
#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LuaCompatOutput {
    /// Files with at least one hit, in archive order and then path order.
    pub files: Vec<FileHits>,
    /// How many `.lua` files were read, with or without hits.
    pub files_scanned: usize,
    /// The archives read, as file names: the game first, then its dependencies.
    pub archives: Vec<String>,
    /// Dependencies named by the game that were not read, because nothing
    /// installed answers to the name.
    pub unresolved: Vec<String>,
    pub errors: Vec<String>,
}

/// The hits in one file.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileHits {
    /// The archive file the Lua is in.
    pub archive: String,
    /// The member's path inside it, as the archive spells it.
    pub path: String,
    pub hits: Vec<Hit>,
}

impl LuaCompatOutput {
    fn err(message: String) -> Self {
        Self {
            errors: vec![message],
            ..Default::default()
        }
    }
}

/// Print a `LuaCompatOutput` carrying only an error (used on panic).
pub fn emit_error(msg: String) {
    println!(
        "{}",
        serde_json::to_string(&LuaCompatOutput::err(msg)).unwrap_or_default()
    );
}

/// Scan `game_archive` and its dependencies.
pub fn render(lib: &str, game_archive: &str) -> LuaCompatOutput {
    let us = match unsafe { Unitsync::load(Path::new(lib)) } {
        Ok(u) => u,
        Err(e) => return LuaCompatOutput::err(e),
    };
    us.init(false, 0);
    let mut out = LuaCompatOutput {
        errors: us.drain_errors(),
        ..Default::default()
    };

    let (archives, unresolved) = archives_to_scan(&us, game_archive);
    // Looking names up can probe archives that are not there. That is not the
    // scan's error to report.
    let _ = us.drain_errors();
    out.unresolved = unresolved;

    for archive in archives {
        scan_archive(&us, &archive, &mut out);
        out.archives.push(archive);
    }

    out.errors.extend(us.drain_errors());
    us.uninit();
    out
}

/// The archive files to read, the game's first, and the dependency names that
/// could not be turned into one.
///
/// `GetPrimaryModArchiveList` gives the game's own archive and its
/// dependencies by display name, such as `Map Helper v1`, while opening an
/// archive takes a file name. A dependency that is itself an installed game is
/// turned into a file through that game's entry. One that is neither a file nor
/// an installed game is returned as unresolved.
fn archives_to_scan(us: &Unitsync, game_archive: &str) -> (Vec<String>, Vec<String>) {
    let mut archives = vec![game_archive.to_string()];
    let mut unresolved = Vec::new();

    let Some(index) =
        (0..us.mod_count()).find(|&i| us.mod_archive(i).as_deref() == Some(game_archive))
    else {
        return (archives, unresolved);
    };
    let own_name = us.mod_info(index).get("name").cloned();

    for dep in us.mod_archives(index) {
        if dep == game_archive || Some(&dep) == own_name.as_ref() || is_base_content(&dep) {
            continue;
        }
        let file = if us.archive_path(&dep).is_some() {
            Some(dep.clone())
        } else {
            (0..us.mod_count())
                .find(|&i| us.mod_info(i).get("name") == Some(&dep))
                .and_then(|i| us.mod_archive(i))
        };
        match file {
            Some(file) if is_base_content(&file) => {}
            Some(file) if !archives.contains(&file) => archives.push(file),
            Some(_) => {}
            None => unresolved.push(dep),
        }
    }
    (archives, unresolved)
}

/// Whether an archive is one every game gets from the engine. Matched on the
/// name with everything but letters and digits taken out, so
/// `springcontent.sdz`, `Spring content` and `Map Helper v1` all count.
fn is_base_content(name: &str) -> bool {
    let squashed: String = name
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .collect::<String>()
        .to_lowercase();
    squashed.contains("springcontent") || squashed.contains("maphelper")
}

/// Whether an archive member is Lua the scan reads.
fn is_scanned_lua(member: &str) -> bool {
    let path = member.replace('\\', "/").to_lowercase();
    path.ends_with(".lua")
        && path
            .split('/')
            .next()
            .is_some_and(|top| FOLDERS.contains(&top))
}

/// Read and scan the Lua in one archive, adding to `out`.
fn scan_archive(us: &Unitsync, archive: &str, out: &mut LuaCompatOutput) {
    let handle = crate::archive::resolve_open_path(us, archive)
        .as_deref()
        .and_then(|p| us.open_archive(p));
    let Some(handle) = handle else {
        out.errors.push(format!("could not open archive {archive}"));
        return;
    };

    let members: BTreeSet<String> = us
        .list_archive_files(handle)
        .into_iter()
        .map(|(path, _)| path)
        .filter(|path| is_scanned_lua(path))
        .collect();
    for member in members {
        // Uncapped, because a cap would skip the biggest files without saying
        // so. A game's own Lua is the size it is.
        let Some((_, bytes)) = us.read_archive_member(handle, &member, usize::MAX) else {
            out.errors
                .push(format!("could not read {member} in {archive}"));
            continue;
        };
        out.files_scanned += 1;
        let hits = scan(&String::from_utf8_lossy(&bytes), Catalogue::embedded());
        if !hits.is_empty() {
            out.files.push(FileHits {
                archive: archive.to_string(),
                path: member,
                hits,
            });
        }
    }
    us.close_archive(handle);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn base_content_is_recognised_by_any_spelling() {
        assert!(is_base_content("springcontent.sdz"));
        assert!(is_base_content("Spring content"));
        assert!(is_base_content("Map Helper v1"));
        assert!(is_base_content("maphelper.sdz"));
        assert!(!is_base_content("Balanced Annihilation V9.79"));
        assert!(!is_base_content("xta-9.65.sd7"));
    }

    #[test]
    fn only_lua_in_the_five_folders_is_scanned() {
        assert!(is_scanned_lua("LuaRules/Gadgets/a.lua"));
        assert!(is_scanned_lua("luaui\\widgets\\a.LUA"));
        assert!(is_scanned_lua("luaintro/main.lua"));
        assert!(is_scanned_lua("gamedata/defs.lua"));
        assert!(is_scanned_lua("scripts/armcom.lua"));
        assert!(!is_scanned_lua("scripts/armcom.cob"));
        assert!(!is_scanned_lua("units/armcom.lua"));
        assert!(!is_scanned_lua("lups/lups.lua"));
        assert!(!is_scanned_lua("modinfo.lua"));
        assert!(!is_scanned_lua("objects3d/luaui/a.lua"));
    }
}
