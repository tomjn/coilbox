//! The workshop's own test mutator (issue #1278).
//!
//! A compiled project is already the shape of any other mutator archive: a
//! `modinfo.lua` depending on the base game plus whatever it changes
//! (`compile::compile`'s own doc comment). Playing it locally needs nowhere
//! else to put that but a generated game under the content root's `games/`,
//! the same move `crates/tauri-plugin-coilbox-scenario/src/mutator.rs` makes
//! for a scenario under test, and the community tools this issue exists to
//! outdo have no equivalent of at all.
//!
//! The folder name is fixed and coilbox's own, so testing a project twice
//! reuses one folder rather than leaving a trail, and deleting it undoes
//! everything this route ever wrote.
//!
//! Unlike the scenario mutator, a compiled project's file list changes shape
//! from one compile to the next: a dropped copy stops emitting a
//! `units/<key>.lua`, a cleared override can empty `gamedata/unitdefs_post.lua`
//! out of the list entirely. Rewriting files in place would leave whichever
//! of those a previous run wrote and the current one no longer does, which is
//! content the editor no longer shows and the engine would still load. So
//! every write clears the whole folder first and writes back only what the
//! current compile produced, which also bumps the folder's own modification
//! time, the same signal a single file's remove-then-write bumps for the
//! scenario mutator, and what the engine's archive scanner keys its cache on.

use crate::compile::CompiledFile;
use std::path::{Path, PathBuf};

/// The mutator's folder name. Fixed here rather than passed in, so this
/// module can only ever write to coilbox's own game and never into an
/// install.
pub const FOLDER: &str = "coilbox-workshop-test.sdd";

/// The mutator folder under `data_dir`, which has to be a content root that
/// already exists. The folder itself is created by the caller.
pub fn mutator_dir(data_dir: &str) -> Result<PathBuf, String> {
    let root = PathBuf::from(data_dir);
    if !root.is_absolute() || !root.is_dir() {
        return Err(format!("not a content root: {data_dir}"));
    }
    Ok(root.join("games").join(FOLDER))
}

/// Replace the mutator folder's contents with exactly the files a compile
/// produced.
///
/// The folder is removed whole first rather than written into in place, for
/// the reason this module's own doc comment gives: a file an earlier compile
/// wrote and the current one no longer emits must not survive as content the
/// editor no longer shows and the engine still loads. A missing folder (the
/// first test) is not an error, there is simply nothing to clear.
pub fn write_mutator(dir: &Path, files: &[CompiledFile]) -> Result<(), String> {
    if dir.exists() {
        std::fs::remove_dir_all(dir)
            .map_err(|e| format!("could not clear {}: {e}", dir.display()))?;
    }
    std::fs::create_dir_all(dir)
        .map_err(|e| format!("could not create {}: {e}", dir.display()))?;
    for file in files {
        let target = dir.join(&file.path);
        if let Some(parent) = target.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("could not create {}: {e}", parent.display()))?;
        }
        std::fs::write(&target, &file.contents)
            .map_err(|e| format!("could not write {}: {e}", target.display()))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn file(path: &str, contents: &str) -> CompiledFile {
        CompiledFile {
            path: path.to_string(),
            contents: contents.to_string(),
        }
    }

    /// The name has to be one no real game folder could have, matching the
    /// scenario mutator's own shape so the two can never be mistaken for one
    /// another in a game list.
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
    fn writing_the_mutator_writes_every_file_at_its_path() {
        let root = tempfile::tempdir().expect("tempdir");
        let dir = root.path().join("mutator");
        let files = vec![
            file("modinfo.lua", "return {}"),
            file("units/supercom.lua", "return { supercom = {} }"),
        ];

        write_mutator(&dir, &files).expect("write");

        assert_eq!(
            std::fs::read_to_string(dir.join("modinfo.lua")).expect("read"),
            "return {}"
        );
        assert_eq!(
            std::fs::read_to_string(dir.join("units/supercom.lua")).expect("read"),
            "return { supercom = {} }"
        );
    }

    /// The one this module exists for: a file an earlier compile wrote and the
    /// current one no longer emits must not survive the next write.
    #[test]
    fn a_file_the_new_compile_no_longer_emits_does_not_survive() {
        let root = tempfile::tempdir().expect("tempdir");
        let dir = root.path().join("mutator");

        write_mutator(
            &dir,
            &[
                file("modinfo.lua", "return {}"),
                file("units/dropped.lua", "return { dropped = {} }"),
            ],
        )
        .expect("first write");
        assert!(dir.join("units/dropped.lua").exists());

        write_mutator(&dir, &[file("modinfo.lua", "return {}")]).expect("second write");

        assert!(!dir.join("units/dropped.lua").exists());
        assert!(dir.join("modinfo.lua").exists());
    }

    #[test]
    fn writing_over_a_folder_that_does_not_exist_yet_is_fine() {
        let root = tempfile::tempdir().expect("tempdir");
        let dir = root.path().join("brand-new").join(super::FOLDER);
        write_mutator(&dir, &[file("modinfo.lua", "return {}")]).expect("write");
        assert!(dir.join("modinfo.lua").exists());
    }
}
