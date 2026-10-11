//! Installing a game or map archive the player already has as a file.
//!
//! Somebody handed a link to a new game ends up with a `.sdz` or `.sd7` in their
//! downloads folder. This copies it into the content folder chosen for its kind,
//! `games/` for a game and `maps/` for a map, and leaves the original where it
//! is. Nothing here runs the archive's Lua: the kind is read off the list of
//! file names, by the rule the engine's own scanner uses.

use std::path::{Path, PathBuf};

/// What an archive is, which decides the folder it goes in.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ArchiveKind {
    Game,
    Map,
}

impl ArchiveKind {
    /// The name the frontend reads, and the word a message uses.
    pub fn as_str(self) -> &'static str {
        match self {
            ArchiveKind::Game => "game",
            ArchiveKind::Map => "map",
        }
    }

    /// The folder under a content root this kind lives in.
    fn folder(self) -> &'static str {
        match self {
            ArchiveKind::Game => "games",
            ArchiveKind::Map => "maps",
        }
    }
}

/// Where an archive would go, worked out before anything is copied.
#[derive(Debug, PartialEq, Eq)]
pub struct Plan {
    pub kind: ArchiveKind,
    pub file_name: String,
    pub dest_dir: PathBuf,
}

/// The paths of every file in the archive, with forward slashes.
fn member_names(path: &Path) -> Result<Vec<String>, String> {
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .map(str::to_ascii_lowercase);
    let unreadable = |e: String| format!("Could not read {}: {e}", display_name(path));
    match ext.as_deref() {
        Some("sdz") => {
            let file = std::fs::File::open(path).map_err(|e| unreadable(e.to_string()))?;
            let zip = zip::ZipArchive::new(file).map_err(|e| unreadable(e.to_string()))?;
            Ok(zip.file_names().map(|n| n.replace('\\', "/")).collect())
        }
        Some("sd7") => {
            let archive = sevenz_rust2::ArchiveReader::open(path, sevenz_rust2::Password::empty())
                .map_err(|e| unreadable(e.to_string()))?;
            Ok(archive
                .archive()
                .files
                .iter()
                .map(|f| f.name().replace('\\', "/"))
                .collect())
        }
        _ => Err(format!(
            "{} is not a .sdz or .sd7 archive.",
            display_name(path)
        )),
    }
}

/// Tell a map from a game by the files an archive holds.
///
/// This is the order `CArchiveScanner::ScanArchive` decides in (RecoilEngine,
/// `rts/System/FileSystem/ArchiveScanner.cpp`). A `mapinfo.lua` at the root
/// makes a map, even beside a `modinfo.lua`. Failing that a `modinfo.lua` makes
/// a game. Failing that any `.smf` makes a map, which is how a map from before
/// `mapinfo.lua` is recognised. Anything else is neither.
pub fn classify_names<S: AsRef<str>>(names: &[S]) -> Option<ArchiveKind> {
    let lower: Vec<String> = names
        .iter()
        .map(|n| n.as_ref().trim_start_matches('/').to_ascii_lowercase())
        .collect();
    let has = |name: &str| lower.iter().any(|n| n == name);
    if has("mapinfo.lua") {
        Some(ArchiveKind::Map)
    } else if has("modinfo.lua") {
        Some(ArchiveKind::Game)
    } else if lower.iter().any(|n| n.ends_with(".smf")) {
        Some(ArchiveKind::Map)
    } else {
        None
    }
}

fn display_name(path: &Path) -> String {
    path.file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| path.display().to_string())
}

/// True when `dir` already holds something called `name`, compared without
/// case. The engine lowercases archive names, so two files that differ only in
/// case are one archive to it even on a filesystem that keeps both.
fn name_taken(dir: &Path, name: &str) -> bool {
    let wanted = name.to_lowercase();
    std::fs::read_dir(dir).is_ok_and(|rd| {
        rd.flatten()
            .any(|e| e.file_name().to_string_lossy().to_lowercase() == wanted)
    })
}

/// Read the archive at `path` and decide where it would be installed.
///
/// `games_root` and `maps_root` are the content folders chosen for each kind.
/// Refuses a folder, a file that is neither a game nor a map, a kind with no
/// folder chosen, and a name the target folder already has.
pub fn plan(
    path: &Path,
    games_root: Option<&str>,
    maps_root: Option<&str>,
) -> Result<Plan, String> {
    let name = display_name(path);
    if !path.is_file() {
        return Err(format!("{name} is not a file coilbox can read."));
    }
    let kind = classify_names(&member_names(path)?)
        .ok_or_else(|| format!("{name} is neither a game nor a map."))?;
    let root = match kind {
        ArchiveKind::Game => games_root,
        ArchiveKind::Map => maps_root,
    }
    .filter(|r| !r.trim().is_empty())
    .ok_or_else(|| {
        format!(
            "No folder is chosen for {}. Choose one in Settings, under Content folders.",
            kind.folder()
        )
    })?;
    let dest_dir = Path::new(root).join(kind.folder());
    if name_taken(&dest_dir, &name) {
        return Err(format!(
            "{name} is already in {}. Nothing was copied.",
            dest_dir.display()
        ));
    }
    Ok(Plan {
        kind,
        file_name: name,
        dest_dir,
    })
}

/// Copy the archive at `path` into the folder for its kind and return where it
/// went. Runs every check [`plan`] does again, so a file that changed since the
/// player was asked is judged as it is now. The copy never replaces a file: the
/// destination is opened with `create_new`, and a copy that fails part way is
/// removed.
pub fn install(
    path: &Path,
    games_root: Option<&str>,
    maps_root: Option<&str>,
) -> Result<(Plan, PathBuf), String> {
    let plan = plan(path, games_root, maps_root)?;
    std::fs::create_dir_all(&plan.dest_dir)
        .map_err(|e| format!("Could not create {}: {e}", plan.dest_dir.display()))?;
    let dest = plan.dest_dir.join(&plan.file_name);
    let mut from =
        std::fs::File::open(path).map_err(|e| format!("Could not read {}: {e}", plan.file_name))?;
    let mut to = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&dest)
        .map_err(|e| match e.kind() {
            std::io::ErrorKind::AlreadyExists => format!(
                "{} is already in {}. Nothing was copied.",
                plan.file_name,
                plan.dest_dir.display()
            ),
            _ => format!("Could not write {}: {e}", dest.display()),
        })?;
    if let Err(e) = std::io::copy(&mut from, &mut to) {
        drop(to);
        let _ = std::fs::remove_file(&dest);
        return Err(format!("Could not copy {}: {e}", plan.file_name));
    }
    Ok((plan, dest))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn sdz(dir: &Path, name: &str, members: &[&str]) -> PathBuf {
        let path = dir.join(name);
        let mut zip = zip::ZipWriter::new(std::fs::File::create(&path).unwrap());
        for member in members {
            zip.start_file(*member, zip::write::SimpleFileOptions::default())
                .unwrap();
            zip.write_all(b"content").unwrap();
        }
        zip.finish().unwrap();
        path
    }

    fn sd7(dir: &Path, name: &str, members: &[&str]) -> PathBuf {
        let path = dir.join(name);
        let mut writer = sevenz_rust2::ArchiveWriter::create(&path).unwrap();
        for member in members {
            writer
                .push_archive_entry(
                    sevenz_rust2::ArchiveEntry::new_file(member),
                    Some(&b"content"[..]),
                )
                .unwrap();
        }
        writer.finish().unwrap();
        path
    }

    #[test]
    fn a_modinfo_makes_a_game() {
        assert_eq!(
            classify_names(&["modinfo.lua", "units/a.lua"]),
            Some(ArchiveKind::Game)
        );
    }

    #[test]
    fn a_mapinfo_makes_a_map_even_beside_a_modinfo() {
        assert_eq!(
            classify_names(&["modinfo.lua", "mapinfo.lua"]),
            Some(ArchiveKind::Map)
        );
    }

    #[test]
    fn a_map_from_before_mapinfo_is_known_by_its_smf() {
        assert_eq!(
            classify_names(&["maps/Old.smf", "maps/Old.smd"]),
            Some(ArchiveKind::Map)
        );
    }

    #[test]
    fn names_are_matched_without_case() {
        assert_eq!(classify_names(&["ModInfo.lua"]), Some(ArchiveKind::Game));
        assert_eq!(classify_names(&["maps/OLD.SMF"]), Some(ArchiveKind::Map));
    }

    #[test]
    fn an_info_file_below_the_root_does_not_count() {
        assert_eq!(classify_names(&["docs/modinfo.lua", "readme.txt"]), None);
    }

    #[test]
    fn a_zip_game_goes_to_games_and_the_original_stays() {
        let dir = tempfile::tempdir().unwrap();
        let src = sdz(dir.path(), "Some Game 1.0.sdz", &["modinfo.lua"]);
        let root = dir.path().join("root");
        let (plan, dest) = install(&src, root.to_str(), None).unwrap();
        assert_eq!(plan.kind, ArchiveKind::Game);
        assert_eq!(dest, root.join("games").join("Some Game 1.0.sdz"));
        assert_eq!(std::fs::read(&dest).unwrap(), std::fs::read(&src).unwrap());
    }

    #[test]
    fn a_7z_map_goes_to_the_maps_root() {
        let dir = tempfile::tempdir().unwrap();
        let src = sd7(dir.path(), "some_map.sd7", &["mapinfo.lua", "maps/a.smf"]);
        let games = dir.path().join("g");
        let maps = dir.path().join("m");
        let (plan, dest) = install(&src, games.to_str(), maps.to_str()).unwrap();
        assert_eq!(plan.kind, ArchiveKind::Map);
        assert_eq!(dest, maps.join("maps").join("some_map.sd7"));
        assert!(!games.exists());
    }

    #[test]
    fn an_archive_that_is_neither_is_refused_and_nothing_is_written() {
        let dir = tempfile::tempdir().unwrap();
        let src = sdz(dir.path(), "notes.sdz", &["readme.txt"]);
        let root = dir.path().join("root");
        let err = install(&src, root.to_str(), root.to_str()).unwrap_err();
        assert_eq!(err, "notes.sdz is neither a game nor a map.");
        assert!(!root.exists());
    }

    #[test]
    fn a_name_already_there_is_refused_whatever_its_case() {
        let dir = tempfile::tempdir().unwrap();
        let src = sdz(dir.path(), "Game.sdz", &["modinfo.lua"]);
        let root = dir.path().join("root");
        std::fs::create_dir_all(root.join("games")).unwrap();
        std::fs::write(root.join("games").join("game.SDZ"), b"the one already here").unwrap();
        let err = install(&src, root.to_str(), None).unwrap_err();
        assert!(err.contains("already in"), "{err}");
        assert_eq!(
            std::fs::read(root.join("games").join("game.SDZ")).unwrap(),
            b"the one already here"
        );
    }

    #[test]
    fn a_kind_with_no_folder_chosen_is_refused() {
        let dir = tempfile::tempdir().unwrap();
        let src = sdz(dir.path(), "map.sdz", &["mapinfo.lua"]);
        let err = plan(&src, dir.path().to_str(), None).unwrap_err();
        assert!(err.starts_with("No folder is chosen for maps."), "{err}");
    }

    #[test]
    fn a_file_that_is_not_an_archive_is_refused() {
        let dir = tempfile::tempdir().unwrap();
        let fake = dir.path().join("fake.sdz");
        std::fs::write(&fake, b"not a zip").unwrap();
        let err = plan(&fake, dir.path().to_str(), None).unwrap_err();
        assert!(err.starts_with("Could not read fake.sdz"), "{err}");

        let other = dir.path().join("picture.png");
        std::fs::write(&other, b"png").unwrap();
        let err = plan(&other, dir.path().to_str(), None).unwrap_err();
        assert_eq!(err, "picture.png is not a .sdz or .sd7 archive.");
    }

    #[test]
    fn a_folder_is_refused() {
        let dir = tempfile::tempdir().unwrap();
        let sdd = dir.path().join("Game.sdd");
        std::fs::create_dir_all(&sdd).unwrap();
        let err = plan(&sdd, dir.path().to_str(), None).unwrap_err();
        assert_eq!(err, "Game.sdd is not a file coilbox can read.");
    }
}
