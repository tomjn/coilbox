//! Reading the missions a game ships inside its own archive (issue #2160).
//!
//! A game may carry finished missions of its own, and it may be packaged. The
//! three kinds a game arrives as are a `.sdd` folder, a `.sdz` zip and a `.sd7`
//! 7-zip, so one shape covers all three: list the mission folders, read one file
//! out of one. Nothing here writes, and nothing here needs an engine, so a
//! mission list costs no unitsync scan.
//!
//! The Tauri commands that expose these to the frontend
//! (`scenario_game_missions`, `scenario_game_mission_file`,
//! `scenario_game_runtime`) live in `lib.rs`.

use coilbox_portable::is_safe_rel;
use serde::Serialize;
use std::io::Read;
use std::path::{Path, PathBuf};

/// One mission folder a game ships.
///
/// `has_document` is what decides whether the editor can open it: a mission with
/// only the compiled Lua is playable and never editable, because reconstructing a
/// document out of compiled Lua would be a guess dressed as a source.
#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GameMissionEntry {
    pub folder: String,
    pub has_document: bool,
    pub has_compiled: bool,
}

/// The compiled mission every mission folder has to hold to count as one.
const COMPILED: &str = "mission.lua";
/// The document a mission folder holds when it is editable.
const DOCUMENT: &str = "scenario.json";

/// Refuse a folder or file name that could climb out of `missions/`.
fn safe_part(part: &str) -> Result<(), String> {
    if part.is_empty() || !is_safe_rel(Path::new(part)) || part.contains('/') || part.contains('\\')
    {
        return Err(format!("unsafe mission path: {part}"));
    }
    Ok(())
}

/// Every mission folder in the game at `root`, sorted, whether `root` is a loose
/// folder or a packaged archive. A game with no `missions/` has none, which is
/// not an error.
pub fn list_missions(root: &Path) -> Result<Vec<GameMissionEntry>, String> {
    let mut found = if root.is_dir() {
        list_loose(root)
    } else {
        list_packaged(root)?
    };
    found.sort_by(|a, b| a.folder.cmp(&b.folder));
    Ok(found)
}

fn list_loose(root: &Path) -> Vec<GameMissionEntry> {
    let Ok(entries) = std::fs::read_dir(root.join("missions")) else {
        return Vec::new();
    };
    entries
        .flatten()
        .filter(|e| e.path().is_dir())
        .filter_map(|e| e.file_name().to_str().map(str::to_string))
        .filter(|folder| !folder.starts_with('.'))
        .filter(|folder| root.join("missions").join(folder).join(COMPILED).is_file())
        .map(|folder| {
            let has_document = root.join("missions").join(&folder).join(DOCUMENT).is_file();
            GameMissionEntry {
                folder,
                has_document,
                has_compiled: true,
            }
        })
        .collect()
}

/// Fold a packaged archive's member names into mission entries. Both archive
/// readers hand back a flat list of paths, so the folding is shared.
fn fold_members(names: impl Iterator<Item = String>) -> Vec<GameMissionEntry> {
    let mut entries: Vec<GameMissionEntry> = Vec::new();
    for name in names {
        let rest = match name.strip_prefix("missions/") {
            Some(rest) => rest,
            None => continue,
        };
        let Some((folder, file)) = rest.split_once('/') else {
            continue;
        };
        if file != COMPILED && file != DOCUMENT {
            continue;
        }
        let at = entries.iter().position(|e| e.folder == folder);
        let entry = match at {
            Some(i) => &mut entries[i],
            None => {
                entries.push(GameMissionEntry {
                    folder: folder.to_string(),
                    has_document: false,
                    has_compiled: false,
                });
                entries.last_mut().expect("just pushed")
            }
        };
        if file == COMPILED {
            entry.has_compiled = true;
        } else {
            entry.has_document = true;
        }
    }
    entries.retain(|e| e.has_compiled);
    entries
}

fn list_packaged(root: &Path) -> Result<Vec<GameMissionEntry>, String> {
    match kind(root) {
        Kind::Zip => {
            let file = std::fs::File::open(root).map_err(|e| format!("{e}"))?;
            let mut zip = zip::ZipArchive::new(file).map_err(|e| format!("{e}"))?;
            let names: Vec<String> = (0..zip.len())
                .filter_map(|i| zip.by_index(i).ok().map(|f| f.name().to_string()))
                .collect();
            Ok(fold_members(names.into_iter()))
        }
        Kind::SevenZip => {
            let archive = sevenz_rust2::ArchiveReader::open(root, sevenz_rust2::Password::empty())
                .map_err(|e| format!("{e}"))?;
            let names: Vec<String> = archive
                .archive()
                .files
                .iter()
                .map(|f| f.name().replace('\\', "/"))
                .collect();
            Ok(fold_members(names.into_iter()))
        }
        Kind::Unknown => Err(format!("not a game archive: {}", root.display())),
    }
}

enum Kind {
    Zip,
    SevenZip,
    Unknown,
}

/// Which reader an archive needs, by extension. `.sdz` is a zip and `.sd7` is
/// 7-zip, which is what the engine itself goes by.
fn kind(root: &Path) -> Kind {
    match root
        .extension()
        .and_then(|e| e.to_str())
        .map(str::to_ascii_lowercase)
        .as_deref()
    {
        Some("sdz") => Kind::Zip,
        Some("sd7") => Kind::SevenZip,
        _ => Kind::Unknown,
    }
}

/// One file out of one mission folder, whatever the game is packaged as.
pub fn read_file(root: &Path, folder: &str, file: &str) -> Result<Vec<u8>, String> {
    safe_part(folder)?;
    safe_part(file)?;
    read_member(root, &format!("missions/{folder}/{file}"))
}

/// One file directly under `missions/`, outside any mission folder: currently
/// only `runtime.lua`, the version marker a packaged game declares for itself
/// the same way a loose one's install marker does (`runtime::read_marker`).
/// Kept apart from [`read_file`], whose member path always nests a mission
/// folder, because a folder of `"."` is exactly what `safe_part` refuses.
pub fn read_root_file(root: &Path, file: &str) -> Result<Vec<u8>, String> {
    safe_part(file)?;
    read_member(root, &format!("missions/{file}"))
}

/// Read one archive member, whatever the game is packaged as. Shared by
/// [`read_file`] and [`read_root_file`], which differ only in the member path
/// they resolve to.
fn read_member(root: &Path, member: &str) -> Result<Vec<u8>, String> {
    if root.is_dir() {
        let path: PathBuf = root.join(member);
        return std::fs::read(&path).map_err(|e| format!("could not read {member}: {e}"));
    }
    match kind(root) {
        Kind::Zip => {
            let f = std::fs::File::open(root).map_err(|e| format!("{e}"))?;
            let mut zip = zip::ZipArchive::new(f).map_err(|e| format!("{e}"))?;
            let mut entry = zip
                .by_name(member)
                .map_err(|e| format!("could not read {member}: {e}"))?;
            let mut bytes = Vec::new();
            entry
                .read_to_end(&mut bytes)
                .map_err(|e| format!("could not read {member}: {e}"))?;
            Ok(bytes)
        }
        Kind::SevenZip => {
            let mut archive =
                sevenz_rust2::ArchiveReader::open(root, sevenz_rust2::Password::empty())
                    .map_err(|e| format!("{e}"))?;
            archive
                .read_file(member)
                .map_err(|e| format!("could not read {member}: {e}"))
        }
        Kind::Unknown => Err(format!("not a game archive: {}", root.display())),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    /// A loose `.sdd`: one mission with both files, one with only the compiled
    /// file, and a stray file that is not a mission at all.
    fn loose_game() -> tempfile::TempDir {
        let dir = tempfile::tempdir().unwrap();
        let missions = dir.path().join("missions");
        std::fs::create_dir_all(missions.join("first-contact")).unwrap();
        std::fs::write(
            missions.join("first-contact/mission.lua"),
            "return { name = \"First contact\" }",
        )
        .unwrap();
        std::fs::write(missions.join("first-contact/scenario.json"), "{}").unwrap();
        std::fs::create_dir_all(missions.join("compiled-only")).unwrap();
        std::fs::write(missions.join("compiled-only/mission.lua"), "return {}").unwrap();
        std::fs::write(missions.join("runtime.lua"), "return { version = 3 }").unwrap();
        dir
    }

    /// The same tree as a `.sdz`.
    fn zipped_game(dir: &Path) -> PathBuf {
        let path = dir.join("game.sdz");
        let file = std::fs::File::create(&path).unwrap();
        let mut zip = zip::ZipWriter::new(file);
        let opts = zip::write::SimpleFileOptions::default();
        for (name, body) in [
            ("missions/first-contact/mission.lua", "return {}"),
            ("missions/first-contact/scenario.json", "{}"),
            ("missions/compiled-only/mission.lua", "return {}"),
            ("missions/runtime.lua", "return { version = 3 }"),
        ] {
            zip.start_file(name, opts).unwrap();
            zip.write_all(body.as_bytes()).unwrap();
        }
        zip.finish().unwrap();
        path
    }

    /// The same tree as a `.sd7`.
    fn sevenzipped_game(dir: &Path) -> PathBuf {
        let path = dir.join("game.sd7");
        let mut writer = sevenz_rust2::ArchiveWriter::create(&path).unwrap();
        for (name, body) in [
            ("missions/first-contact/mission.lua", "return {}"),
            ("missions/first-contact/scenario.json", "{}"),
            ("missions/compiled-only/mission.lua", "return {}"),
            ("missions/runtime.lua", "return { version = 3 }"),
        ] {
            writer
                .push_archive_entry(
                    sevenz_rust2::ArchiveEntry::new_file(name),
                    Some(std::io::Cursor::new(body.as_bytes().to_vec())),
                )
                .unwrap();
        }
        writer.finish().unwrap();
        path
    }

    #[test]
    fn lists_a_loose_games_missions() {
        let game = loose_game();

        let found = list_missions(game.path()).unwrap();

        assert_eq!(found.len(), 2);
        assert_eq!(found[0].folder, "compiled-only");
        assert!(!found[0].has_document);
        assert_eq!(found[1].folder, "first-contact");
        assert!(found[1].has_document);
    }

    #[test]
    fn a_file_beside_the_missions_is_not_a_mission() {
        let game = loose_game();

        let found = list_missions(game.path()).unwrap();

        assert!(found.iter().all(|m| m.folder != "runtime.lua"));
    }

    #[test]
    fn lists_a_packaged_games_missions() {
        let dir = tempfile::tempdir().unwrap();

        for archive in [zipped_game(dir.path()), sevenzipped_game(dir.path())] {
            let found = list_missions(&archive).unwrap();

            assert_eq!(found.len(), 2, "in {}", archive.display());
            assert_eq!(found[1].folder, "first-contact");
            assert!(found[1].has_document);
        }
    }

    #[test]
    fn reads_a_file_out_of_every_kind() {
        let loose = loose_game();
        let dir = tempfile::tempdir().unwrap();

        for root in [
            loose.path().to_path_buf(),
            zipped_game(dir.path()),
            sevenzipped_game(dir.path()),
        ] {
            let bytes = read_file(&root, "first-contact", "scenario.json").unwrap();

            assert_eq!(bytes, b"{}", "in {}", root.display());
        }
    }

    #[test]
    fn refuses_a_path_that_climbs_out() {
        let game = loose_game();

        assert!(read_file(game.path(), "../..", "modinfo.lua").is_err());
        assert!(read_file(game.path(), "first-contact", "../modinfo.lua").is_err());
    }

    #[test]
    fn reads_the_runtime_marker_out_of_every_kind() {
        let loose = loose_game();
        let dir = tempfile::tempdir().unwrap();

        for root in [
            loose.path().to_path_buf(),
            zipped_game(dir.path()),
            sevenzipped_game(dir.path()),
        ] {
            let bytes = read_root_file(&root, "runtime.lua").unwrap();

            assert_eq!(bytes, b"return { version = 3 }", "in {}", root.display());
        }
    }

    #[test]
    fn read_root_file_refuses_a_path_that_climbs_out() {
        let game = loose_game();

        assert!(read_root_file(game.path(), "../modinfo.lua").is_err());
        assert!(read_root_file(game.path(), "sub/file.lua").is_err());
    }

    #[test]
    fn a_game_with_no_missions_is_not_an_error() {
        let dir = tempfile::tempdir().unwrap();

        assert_eq!(list_missions(dir.path()).unwrap(), Vec::new());
    }
}
