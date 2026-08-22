//! Pruning the unit-model texture cache: the folder `coilbox-unitsync-worker`
//! writes a unit's textures (and its flattened model JSON) into, one file a
//! member, for the viewer to load over the asset protocol.
//!
//! Nothing ever deleted from it (issue #1919). Two things make an entry
//! unreachable, and only one of them is worth sweeping for here:
//!
//! - The archive it came from was uninstalled, or replaced by a new version.
//!   The cache key folds in the archive's path, size and mtime, so a new
//!   version writes a whole new set of files beside the old rather than over
//!   it. Telling which archives are still installed needs the engine loaded
//!   through the worker, which needs an engine and a data dir the frontend
//!   picks, none of which is knowable this early or worth spinning up a
//!   process for on every launch. Left for a follow-up (issue #1919's own
//!   comments) with real archive knowledge to draw on.
//! - `coilbox_unitsync_worker::unitmodel::CACHE_VERSION` was bumped, which
//!   orphans every file the cache held under the old number in one go: #1918
//!   did exactly that, and left 585 MB dead on the machine that filed this.
//!   That is what this sweeps, because it is decidable from the file name
//!   alone: every file the worker writes now starts `v<CACHE_VERSION>-`, and
//!   anything that does not, or that names an older number, cannot be asked
//!   for by anything still running.
//!
//! Run once at startup, the same moment as the lego geometry sweep
//! (`tauri-plugin-coilbox-lego`'s `geometry::sweep`, issue #1902) and for the
//! same reason: nothing can be part way through a render before the window is
//! even up, so it is the one moment "is this file live" has an answer that
//! cannot go stale under it.

use std::path::Path;

/// Duplicated from `coilbox_unitsync_worker::unitmodel::CACHE_VERSION`. There is
/// no library dependency between this plugin and that sidecar binary (it is
/// spawned as a process, not linked), so the number is kept here by hand.
/// Bumping one without the other only ever costs a launch's worth of pruning,
/// either a generation too early or a generation too late, never a live file:
/// see `unitmodel::CACHE_VERSION`'s own doc for the other half of this note.
const MODEL_CACHE_VERSION: u32 = 3;

/// Delete every file in `dir` that was not written under the current
/// [`MODEL_CACHE_VERSION`], answering how many went.
///
/// Best effort throughout. A folder that cannot be listed is left exactly as it
/// is, because a sweep that cannot see what is in it cannot tell a stale file
/// from a live one and would be guessing rather than answering.
pub fn sweep(dir: &Path) -> usize {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return 0;
    };
    let current = format!("v{MODEL_CACHE_VERSION}-");
    let mut removed = 0;
    for entry in entries.flatten() {
        let Some(name) = entry.file_name().to_str().map(str::to_string) else {
            continue;
        };
        if name.starts_with(&current) || !entry.path().is_file() {
            continue;
        }
        if std::fs::remove_file(entry.path()).is_ok() {
            removed += 1;
        }
    }
    removed
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cache(files: &[&str]) -> tempfile::TempDir {
        let dir = tempfile::tempdir().expect("tempdir");
        for name in files {
            std::fs::write(dir.path().join(name), b"x").expect("write");
        }
        dir
    }

    #[test]
    fn a_file_from_an_old_cache_version_goes_and_the_current_one_stays() {
        let dir = cache(&[
            "v3-abcd_unittextures_atlas_dds.dds",
            "abcd_unittextures_atlas_dds.dds", // pre-#1919, no version prefix at all
            "v2-abcd_unittextures_atlas_dds.dds",
        ]);

        assert_eq!(sweep(dir.path()), 2);

        assert!(dir
            .path()
            .join("v3-abcd_unittextures_atlas_dds.dds")
            .is_file());
        assert!(!dir.path().join("abcd_unittextures_atlas_dds.dds").exists());
        assert!(!dir
            .path()
            .join("v2-abcd_unittextures_atlas_dds.dds")
            .exists());
    }

    #[test]
    fn a_cache_that_is_not_there_yet_is_nothing_to_sweep_rather_than_a_fault() {
        assert_eq!(sweep(Path::new("/definitely/not/here")), 0);
    }

    #[test]
    fn a_folder_that_cannot_be_listed_leaves_every_file_alone() {
        // A file where the cache dir should be: readable as an entry, not as a
        // directory, which is the shape of "the answer cannot be got at".
        let dir = tempfile::tempdir().expect("tempdir");
        let not_a_dir = dir.path().join("model-textures");
        std::fs::write(&not_a_dir, b"not a folder").expect("write");

        assert_eq!(sweep(&not_a_dir), 0);
    }

    #[test]
    fn a_cache_that_is_already_current_loses_nothing() {
        let dir = cache(&[
            "v3-abcd_unittextures_atlas_dds.dds",
            "v3-efgh_unittextures_skin_png.png",
        ]);

        assert_eq!(sweep(dir.path()), 0);
        assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 2);
    }
}
