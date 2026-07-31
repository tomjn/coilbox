//! The test mutator: a generated game that carries the runtime and one scenario.
//!
//! A packaged `.sd7`/`.sdz` cannot be written into, so a game that has not
//! vendored the runtime has no way to play a scenario. Rather than unpack
//! someone else's game, coilbox writes a game of its own that depends on it: an
//! `.sdd` under the content root's `games/`, holding the runtime and the one
//! mission under test. The base game supplies everything else.
//!
//! This is a test route and never a distribution one. The folder name is fixed
//! and coilbox's own, so repeated tests reuse one folder rather than leaving a
//! trail, and deleting that folder undoes everything this flow ever wrote. It is
//! the same shape as lego's scratch game (`src/lego/scratchGame.ts`).

use std::path::{Path, PathBuf};

/// The mutator's folder name. Fixed here rather than passed in, so this module
/// can only ever write to coilbox's own game and never into an install.
pub const FOLDER: &str = "coilbox-mission-test.sdd";

/// Where the compiled missions live inside a game archive.
const MISSIONS: &str = "missions";

/// The mutator folder under `data_dir`, which has to be a content root that
/// already exists. The folder itself is created by the caller.
pub fn mutator_dir(data_dir: &str) -> Result<PathBuf, String> {
    let root = PathBuf::from(data_dir);
    if !root.is_absolute() || !root.is_dir() {
        return Err(format!("not a content root: {data_dir}"));
    }
    Ok(root.join("games").join(FOLDER))
}

/// Write one generated file into the mutator, creating its folder.
///
/// Removing before writing bumps the containing folder's modification time,
/// which is what the engine's archive scanner keys its cache off. Rewriting a
/// file in place leaves the folder looking untouched, and a change made since
/// the last scan would never load. Lego's scratch game does the same.
pub fn write_file(target: &Path, contents: &str) -> Result<(), String> {
    if let Some(parent) = target.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("could not create {}: {e}", parent.display()))?;
    }
    let _ = std::fs::remove_file(target);
    std::fs::write(target, contents)
        .map_err(|e| format!("could not write {}: {e}", target.display()))
}

/// Drop every compiled mission in the mutator except `keep`.
///
/// The mutator carries exactly one scenario, so testing a second one must not
/// leave the first behind: what the runtime loads is chosen by a modoption, and
/// a stale mission folder is a mission that can still be launched by hand long
/// after the scenario it came from changed. Only directories are considered,
/// which is what leaves the runtime's own `missions/runtime.lua` alone.
pub fn prune_missions(dir: &Path, keep: &str) -> Result<(), String> {
    let missions = dir.join(MISSIONS);
    let Ok(entries) = std::fs::read_dir(&missions) else {
        return Ok(());
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        if path.file_name().and_then(|n| n.to_str()) == Some(keep) {
            continue;
        }
        std::fs::remove_dir_all(&path)
            .map_err(|e| format!("could not remove {}: {e}", path.display()))?;
    }
    Ok(())
}

/// Where a scenario's compiled mission and its dialogue media sit in the game.
pub fn mission_dir(dir: &Path, scenario_id: &str) -> PathBuf {
    dir.join(MISSIONS).join(scenario_id)
}

/// Copy a scenario's stored dialogue clips in beside its compiled mission.
///
/// The document references them by bare file name, because that is how the
/// engine loads a portrait or a sound out of the archive. A missing media
/// folder is the ordinary case of a scenario with no dialogue clips, not an
/// error.
pub fn copy_media(src: &Path, dest: &Path) -> Result<Vec<String>, String> {
    let Ok(entries) = std::fs::read_dir(src) else {
        return Ok(Vec::new());
    };
    std::fs::create_dir_all(dest)
        .map_err(|e| format!("could not create {}: {e}", dest.display()))?;
    let mut copied = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
            continue;
        };
        if name.starts_with('.') {
            continue;
        }
        let to = dest.join(name);
        let _ = std::fs::remove_file(&to);
        std::fs::copy(&path, &to).map_err(|e| format!("could not write {}: {e}", to.display()))?;
        copied.push(name.to_string());
    }
    copied.sort();
    Ok(copied)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The name has to be one no real game folder could have, because it is what
    /// tells coilbox (and the person deleting it) that the folder is a
    /// throwaway. Held to the same shape as lego's scratch game.
    #[test]
    fn the_folder_is_coilboxs_own_and_loose() {
        assert!(FOLDER.starts_with("coilbox-"));
        assert!(FOLDER.ends_with(".sdd"));
        assert!(!FOLDER.contains(".."));
        assert!(FOLDER
            .chars()
            .all(|c| c.is_ascii_lowercase() || c == '-' || c == '.'));
    }

    #[test]
    fn the_mutator_sits_under_the_content_roots_games() {
        let root = tempfile::tempdir().expect("tempdir");
        let dir = mutator_dir(&root.path().to_string_lossy()).expect("dir");
        assert_eq!(dir, root.path().join("games").join(FOLDER));
    }

    #[test]
    fn a_content_root_that_is_not_there_is_an_error() {
        assert!(mutator_dir("/no/such/content/root").is_err());
        assert!(mutator_dir("relative/path").is_err());
    }

    #[test]
    fn writing_a_file_twice_replaces_it() {
        let dir = tempfile::tempdir().expect("tempdir");
        let target = dir.path().join("missions/demo/mission.lua");
        write_file(&target, "first").expect("write");
        write_file(&target, "second").expect("write");
        assert_eq!(std::fs::read_to_string(&target).expect("read"), "second");
    }

    #[test]
    fn only_the_scenario_under_test_keeps_its_mission() {
        let dir = tempfile::tempdir().expect("tempdir");
        write_file(&mission_dir(dir.path(), "keep").join("mission.lua"), "keep").expect("write");
        write_file(&mission_dir(dir.path(), "old").join("mission.lua"), "old").expect("write");
        write_file(&dir.path().join("missions/runtime.lua"), "return {}").expect("write");

        prune_missions(dir.path(), "keep").expect("prune");

        assert!(mission_dir(dir.path(), "keep").join("mission.lua").exists());
        assert!(!mission_dir(dir.path(), "old").exists());
        // The runtime's own marker is a file, not a mission, and stays.
        assert!(dir.path().join("missions/runtime.lua").exists());
    }

    #[test]
    fn pruning_a_mutator_with_no_missions_yet_is_fine() {
        let dir = tempfile::tempdir().expect("tempdir");
        prune_missions(dir.path(), "keep").expect("prune");
    }

    #[test]
    fn dialogue_clips_land_beside_the_mission() {
        let media = tempfile::tempdir().expect("tempdir");
        std::fs::write(media.path().join("a.png"), "portrait").expect("write");
        std::fs::write(media.path().join("b.ogg"), "voice").expect("write");
        std::fs::write(media.path().join(".DS_Store"), "junk").expect("write");
        std::fs::create_dir(media.path().join("sub")).expect("mkdir");
        let dest = tempfile::tempdir().expect("tempdir");

        let copied = copy_media(media.path(), dest.path()).expect("copy");

        assert_eq!(copied, vec!["a.png", "b.ogg"]);
        assert_eq!(
            std::fs::read_to_string(dest.path().join("a.png")).expect("read"),
            "portrait"
        );
        assert!(!dest.path().join(".DS_Store").exists());
    }

    #[test]
    fn a_scenario_with_no_dialogue_clips_copies_nothing() {
        let dest = tempfile::tempdir().expect("tempdir");
        let copied = copy_media(Path::new("/no/such/media"), dest.path()).expect("copy");
        assert!(copied.is_empty());
    }
}
