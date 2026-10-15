//! Pruning the unit-model texture cache: the folder `coilbox-unitsync-worker`
//! writes a unit's textures (and its flattened model JSON) into, one file a
//! member, for the viewer to load over the asset protocol.
//!
//! Nothing ever deleted from it (issue #1919). Two things make an entry
//! unreachable, and this sweeps both:
//!
//! - `coilbox_unitsync_worker::unitmodel::CACHE_VERSION` was bumped, which
//!   orphans every file the cache held under the old number in one go: #1918
//!   did exactly that, and left 585 MB dead on the machine that filed #1919.
//!   Every file the worker writes starts `v<CACHE_VERSION>-`, and anything that
//!   does not, or that names an older number, cannot be asked for by anything
//!   still running.
//! - The archive it came from was uninstalled, or replaced by a new version
//!   (issue #1921). The cache key folds in the archive's path, size and mtime,
//!   so a new version writes a whole new set of files beside the old rather
//!   than over it. The key is a hash, so the worker also writes a
//!   `v<CACHE_VERSION>-<key>.source` record of those three, and this checks
//!   them against the file system: one `stat` per key, with no unitsync and no
//!   worker. A key whose archive is gone, or no longer has the size and mtime
//!   it was cached from, loses every file. So does a key with no record, which
//!   is how the files cached before records existed get cleared, once.
//!
//! Checking each key's own archive, rather than reconciling against a content
//! scan's list, means an archive that is installed is never swept for having
//! been outside a scan (another content root, another engine). An archive on a
//! drive that is not mounted does look uninstalled, and its files are
//! re-extracted when it is next opened.
//!
//! Run once at startup, the same moment as the lego geometry sweep
//! (`tauri-plugin-coilbox-lego`'s `geometry::sweep`, issue #1902) and for the
//! same reason: nothing can be part way through a render before the window is
//! even up, so it is the one moment "is this file live" has an answer that
//! cannot go stale under it.

use std::collections::BTreeMap;
use std::io::ErrorKind;
use std::path::{Path, PathBuf};

/// The worker's unit model cache version, read from the one definition both
/// crates share. Bumping it orphans every file written under the old number, and
/// this sweep then removes them.
const MODEL_CACHE_VERSION: u32 = coilbox_unitsync_worker::cachekey::MODEL_CACHE_VERSION;

/// What the worker's `unitmodel::record_source` writes for each cache key.
#[derive(serde::Deserialize)]
struct Source {
    path: PathBuf,
    size: u64,
    mtime: u64,
}

/// Delete every file in `dir` that was not written under the current
/// [`MODEL_CACHE_VERSION`], or whose archive is no longer the one it was
/// cached from, answering how many went.
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
    let mut by_key: BTreeMap<String, Vec<PathBuf>> = BTreeMap::new();
    for entry in entries.flatten() {
        let Some(name) = entry.file_name().to_str().map(str::to_string) else {
            continue;
        };
        if !entry.path().is_file() {
            continue;
        }
        match name.strip_prefix(&current) {
            // A current name the worker would not write is left alone, since
            // there is no key to check it against.
            Some(rest) => {
                if let Some(key) = game_key(rest) {
                    by_key
                        .entry(key.to_string())
                        .or_default()
                        .push(entry.path());
                }
            }
            None => {
                if std::fs::remove_file(entry.path()).is_ok() {
                    removed += 1;
                }
            }
        }
    }
    for (key, files) in by_key {
        if source_is_live(&dir.join(format!("{current}{key}.source"))) {
            continue;
        }
        for file in files {
            if std::fs::remove_file(file).is_ok() {
                removed += 1;
            }
        }
    }
    removed
}

/// The cache key a current file's name carries after its version prefix: the
/// hex run before the `_` of a cached member or the `.` of a source record.
fn game_key(rest: &str) -> Option<&str> {
    let key = &rest[..rest.find(['_', '.'])?];
    (!key.is_empty() && key.chars().all(|c| c.is_ascii_hexdigit())).then_some(key)
}

/// Whether the archive a key's source record names is still there with the
/// size and mtime it was cached from. A missing or unreadable record answers
/// no, and so does an archive that is not found. Any other failure to `stat`
/// it answers yes, because that is not evidence the archive is gone.
fn source_is_live(record: &Path) -> bool {
    let Ok(raw) = std::fs::read_to_string(record) else {
        return false;
    };
    let Ok(source) = serde_json::from_str::<Source>(&raw) else {
        return false;
    };
    match std::fs::metadata(&source.path) {
        Ok(md) => {
            // The same reading of the mtime as the worker's `cache_key_base`.
            let mtime = md
                .modified()
                .ok()
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_secs())
                .unwrap_or(0);
            md.len() == source.size && mtime == source.mtime
        }
        Err(e) => e.kind() != ErrorKind::NotFound,
    }
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

    /// Write `key`'s source record naming `archive`, taking its size and mtime
    /// from the file as it stands, the way the worker would.
    fn record(cache: &Path, key: &str, archive: &Path) {
        let md = std::fs::metadata(archive).expect("archive");
        let mtime = md
            .modified()
            .unwrap()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs();
        let json = serde_json::json!({
            "path": archive, "size": md.len(), "mtime": mtime,
        });
        std::fs::write(cache.join(format!("v3-{key}.source")), json.to_string()).unwrap();
    }

    /// An installed archive, as a file with some bytes in it.
    fn archive(dir: &Path, name: &str) -> PathBuf {
        let path = dir.join(name);
        std::fs::write(&path, b"an archive").unwrap();
        path
    }

    fn left(dir: &Path) -> Vec<String> {
        let mut names: Vec<String> = std::fs::read_dir(dir)
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        names.sort();
        names
    }

    #[test]
    fn a_file_from_an_old_cache_version_goes_and_the_current_one_stays() {
        let games = tempfile::tempdir().unwrap();
        let dir = cache(&[
            "v3-abcd_unittextures_atlas_dds.dds",
            "abcd_unittextures_atlas_dds.dds", // pre-#1919, no version prefix at all
            "v2-abcd_unittextures_atlas_dds.dds",
        ]);
        record(dir.path(), "abcd", &archive(games.path(), "ba.sdz"));

        assert_eq!(sweep(dir.path()), 2);

        assert_eq!(
            left(dir.path()),
            ["v3-abcd.source", "v3-abcd_unittextures_atlas_dds.dds"]
        );
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
    fn a_cache_whose_archives_are_all_installed_loses_nothing() {
        let games = tempfile::tempdir().unwrap();
        let dir = cache(&[
            "v3-abcd_unittextures_atlas_dds.dds",
            "v3-abcd_objects3d_armcom_s3o.json",
            "v3-ef01_unittextures_skin_png.png",
        ]);
        record(dir.path(), "abcd", &archive(games.path(), "ba.sdz"));
        record(dir.path(), "ef01", &archive(games.path(), "sf.sdd"));

        assert_eq!(sweep(dir.path()), 0);
        assert_eq!(left(dir.path()).len(), 5);
    }

    /// Issue #1921: the game was uninstalled, so nothing will ask for its
    /// files again. Its neighbour, still installed, keeps every one of its own.
    #[test]
    fn an_uninstalled_archive_s_files_go_and_its_neighbour_s_stay() {
        let games = tempfile::tempdir().unwrap();
        let dir = cache(&[
            "v3-abcd_unittextures_atlas_dds.dds",
            "v3-abcd_objects3d_armcom_s3o.json",
            "v3-ef01_unittextures_skin_png.png",
        ]);
        let gone = archive(games.path(), "ba.sdz");
        record(dir.path(), "abcd", &gone);
        record(dir.path(), "ef01", &archive(games.path(), "sf.sdz"));
        std::fs::remove_file(&gone).unwrap();

        assert_eq!(sweep(dir.path()), 3);
        assert_eq!(
            left(dir.path()),
            ["v3-ef01.source", "v3-ef01_unittextures_skin_png.png"]
        );
    }

    /// A new version installed over the old at the same path: the path still
    /// answers, but not with the size the files were cached from, so the worker
    /// would work out a different key for it now.
    #[test]
    fn an_archive_replaced_in_place_by_a_new_version_loses_the_old_files() {
        let games = tempfile::tempdir().unwrap();
        let dir = cache(&["v3-abcd_unittextures_atlas_dds.dds"]);
        let path = archive(games.path(), "ba.sdz");
        record(dir.path(), "abcd", &path);
        std::fs::write(&path, b"a new version, longer than the old").unwrap();

        assert_eq!(sweep(dir.path()), 2);
        assert!(left(dir.path()).is_empty());
    }

    /// The files cached before records existed have none, so they go once,
    /// and are re-extracted with a record the next time a model is opened.
    #[test]
    fn a_key_with_no_source_record_is_swept() {
        let dir = cache(&[
            "v3-abcd_unittextures_atlas_dds.dds",
            "v3-abcd_objects3d_armcom_s3o.json",
        ]);

        assert_eq!(sweep(dir.path()), 2);
        assert!(left(dir.path()).is_empty());
    }

    /// A record that does not parse cannot vouch for anything. It goes with
    /// its files, so the worker writes a fresh one rather than skipping it.
    #[test]
    fn a_key_whose_record_does_not_parse_is_swept_with_the_record() {
        let dir = cache(&["v3-abcd_unittextures_atlas_dds.dds", "v3-abcd.source"]);

        assert_eq!(sweep(dir.path()), 2);
        assert!(left(dir.path()).is_empty());
    }

    /// An archive that cannot be looked at is not an archive that is gone. The
    /// folder holding it is made unreadable, so `stat` fails with a permission
    /// error rather than "not found".
    #[cfg(unix)]
    #[test]
    fn an_archive_that_cannot_be_looked_at_keeps_its_files() {
        use std::os::unix::fs::PermissionsExt;
        let games = tempfile::tempdir().unwrap();
        let locked = games.path().join("locked");
        std::fs::create_dir(&locked).unwrap();
        let dir = cache(&["v3-abcd_unittextures_atlas_dds.dds"]);
        record(dir.path(), "abcd", &archive(&locked, "ba.sdz"));
        std::fs::set_permissions(&locked, std::fs::Permissions::from_mode(0o000)).unwrap();
        let blocked = std::fs::metadata(locked.join("ba.sdz")).is_err();

        let removed = sweep(dir.path());
        std::fs::set_permissions(&locked, std::fs::Permissions::from_mode(0o755)).unwrap();

        // Root reads through the lock, and then there is nothing to test.
        if blocked {
            assert_eq!(removed, 0);
            assert_eq!(left(dir.path()).len(), 2);
        }
    }

    /// A current name the worker would never write has no key to check, so
    /// there is no evidence either way and it stays.
    #[test]
    fn a_current_file_with_no_readable_key_is_left_alone() {
        let dir = cache(&["v3-not-a-key.dds", "v3-.source"]);

        assert_eq!(sweep(dir.path()), 0);
        assert_eq!(left(dir.path()).len(), 2);
    }

    #[test]
    fn a_key_is_the_hex_before_the_member_or_the_record_extension() {
        assert_eq!(
            game_key("f8d41c13d95f2dbb_unittextures_a_dds.dds"),
            Some("f8d41c13d95f2dbb")
        );
        assert_eq!(
            game_key("f8d41c13d95f2dbb.source"),
            Some("f8d41c13d95f2dbb")
        );
        assert_eq!(game_key("f8d41c13d95f2dbb"), None);
        assert_eq!(game_key("xyz_a.dds"), None);
    }
}
