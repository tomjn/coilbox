//! Writing into a loose `.sdd` game so that every write can be taken back.
//!
//! Coilbox writes into a game's own folder in two places: the `.3do` installer
//! in the content plugin (issue #2622) and the workshop's edit-in-place route
//! (issue #2635). Both follow the same rule. Before the first write to a file,
//! the original is renamed aside under a coilbox-owned suffix. The backup is
//! the only record, so undo works by name alone after a restart, with nothing
//! remembered by the app.
//!
//! A file coilbox created has no original to keep, so it gets an empty marker
//! beside it under a second suffix instead. Undo deletes the file and the
//! marker. Accept deletes only the marker.
//!
//! Each caller picks its own suffixes through [`Markers`], so undoing one
//! feature's writes never touches another's.

use std::io::Write;
use std::path::{Path, PathBuf};

/// Whether `game_dir` is a directory named `*.sdd`. A `.sdz` or `.sd7` is one
/// packed file, and there is no sound way to rewrite one of those in place.
pub fn is_sdd(game_dir: &Path) -> bool {
    game_dir
        .extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| e.eq_ignore_ascii_case("sdd"))
        && game_dir.is_dir()
}

/// Whether `game_dir` sits directly in a folder named `games`, the only place
/// a content root keeps the games the engine loads.
pub fn in_games_dir(game_dir: &Path) -> bool {
    game_dir
        .parent()
        .and_then(|p| p.file_name())
        .and_then(|n| n.to_str())
        .is_some_and(|n| n.eq_ignore_ascii_case("games"))
}

/// A relative path, forward-slash separated regardless of platform.
pub fn key(rel: &Path) -> String {
    rel.to_string_lossy().replace('\\', "/")
}

/// `path` with `suffix` added to its file name.
pub fn with_suffix(path: &Path, suffix: &str) -> PathBuf {
    let mut os = path.as_os_str().to_os_string();
    os.push(suffix);
    PathBuf::from(os)
}

/// The file a marker named `<file><suffix>` belongs to.
pub fn without_suffix(marker: &Path, suffix: &str) -> Option<PathBuf> {
    marker
        .as_os_str()
        .to_string_lossy()
        .strip_suffix(suffix)
        .map(PathBuf::from)
}

/// Every file under `root` whose name ends in `suffix`. A `.git` folder is
/// skipped: a game kept in git has one, nothing coilbox writes goes there, and
/// it can hold more files than the game itself.
pub fn collect(root: &Path, suffix: &str) -> Vec<PathBuf> {
    let mut out = Vec::new();
    walk(root, suffix, &mut out);
    out.sort();
    out
}

fn walk(at: &Path, suffix: &str, out: &mut Vec<PathBuf>) {
    let Ok(entries) = std::fs::read_dir(at) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if path.is_dir() {
            if name != ".git" {
                walk(&path, suffix, out);
            }
        } else if name.ends_with(suffix) {
            out.push(path);
        }
    }
}

/// Write `bytes` to `path` so that a reader sees either the old file or the
/// new one, never half of each: write a temporary file beside it, flush it to
/// disk, then rename it over `path`.
pub fn write_atomic(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    let temp = with_suffix(path, ".coilbox-tmp");
    let result = (|| {
        let mut file = std::fs::File::create(&temp)?;
        file.write_all(bytes)?;
        file.sync_all()?;
        std::fs::rename(&temp, path)
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(&temp);
    }
    result
}

/// How many files carry each kind of marker.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct Status {
    /// Files coilbox changed, each with the original kept aside.
    pub backups: usize,
    /// Files coilbox created, which did not exist before.
    pub created: usize,
}

impl Status {
    /// Whether there is anything to undo or accept.
    pub fn is_empty(&self) -> bool {
        self.backups == 0 && self.created == 0
    }
}

/// What an undo did, as paths relative to the folder it was run over.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Undone {
    /// Files put back from their backup.
    pub restored: Vec<String>,
    /// Files coilbox had created, now deleted.
    pub deleted: Vec<String>,
}

/// The two suffixes one feature marks its writes with.
#[derive(Debug, Clone, Copy)]
pub struct Markers {
    /// Added to a file's name for the original kept aside before the first
    /// write.
    pub backup: &'static str,
    /// Added to a file's name for the empty marker that says coilbox created
    /// the file.
    pub created: &'static str,
}

impl Markers {
    /// Write `bytes` to `path`, keeping what was there before.
    ///
    /// The first write to an existing file renames the original aside. Later
    /// writes replace the file and leave that backup alone, so undo always
    /// returns to the file as it was before coilbox first touched it. A path
    /// with nothing at it gets a created marker before the file is written, so
    /// there is never a moment when coilbox's file exists unmarked.
    pub fn write(&self, path: &Path, bytes: &[u8]) -> Result<(), String> {
        let backup = with_suffix(path, self.backup);
        let created = with_suffix(path, self.created);
        let shown = path.display();
        if backup.exists() || created.exists() {
            return write_atomic(path, bytes).map_err(|e| format!("could not write {shown}: {e}"));
        }
        if !path.exists() {
            std::fs::write(&created, b"")
                .map_err(|e| format!("could not mark {shown} as new: {e}"))?;
            return write_atomic(path, bytes).map_err(|e| format!("could not write {shown}: {e}"));
        }
        // The new content goes to disk before the original moves, so a
        // failure here leaves the original exactly where it was.
        let temp = with_suffix(path, ".coilbox-tmp");
        let staged = (|| {
            let mut file = std::fs::File::create(&temp)?;
            file.write_all(bytes)?;
            file.sync_all()
        })();
        if let Err(e) = staged {
            let _ = std::fs::remove_file(&temp);
            return Err(format!("could not write {shown}: {e}"));
        }
        if let Err(e) = std::fs::rename(path, &backup) {
            let _ = std::fs::remove_file(&temp);
            return Err(format!("could not move {shown} aside: {e}"));
        }
        std::fs::rename(&temp, path).map_err(|e| {
            format!(
                "could not write {shown}: {e}. The original is kept at {}, and undo puts it back.",
                backup.display()
            )
        })
    }

    /// How many files under `root` carry each marker.
    pub fn status(&self, root: &Path) -> Status {
        if !root.is_dir() {
            return Status::default();
        }
        Status {
            backups: collect(root, self.backup).len(),
            created: collect(root, self.created).len(),
        }
    }

    /// Put every file under `root` back as it was before coilbox wrote to it:
    /// rename each backup over the file it came from, and delete each file
    /// coilbox created.
    ///
    /// Stops at the first failure. Everything not yet undone keeps its marker,
    /// so [`status`](Self::status) still counts it and a second undo finishes
    /// the job.
    pub fn undo(&self, root: &Path) -> Result<Undone, String> {
        let mut undone = Undone::default();
        for backup in collect(root, self.backup) {
            let Some(original) = without_suffix(&backup, self.backup) else {
                continue;
            };
            std::fs::rename(&backup, &original)
                .map_err(|e| format!("could not restore {}: {e}", original.display()))?;
            undone.restored.push(relative(root, &original));
        }
        for marker in collect(root, self.created) {
            let Some(file) = without_suffix(&marker, self.created) else {
                continue;
            };
            if file.exists() {
                std::fs::remove_file(&file)
                    .map_err(|e| format!("could not delete {}: {e}", file.display()))?;
            }
            std::fs::remove_file(&marker)
                .map_err(|e| format!("could not delete {}: {e}", marker.display()))?;
            undone.deleted.push(relative(root, &file));
        }
        Ok(undone)
    }

    /// Keep every change under `root`: delete the backups and the created
    /// markers, and leave the files as they are now. Returns the files kept,
    /// relative to `root`.
    pub fn accept(&self, root: &Path) -> Result<Vec<String>, String> {
        let mut kept = Vec::new();
        for suffix in [self.backup, self.created] {
            for marker in collect(root, suffix) {
                std::fs::remove_file(&marker)
                    .map_err(|e| format!("could not delete {}: {e}", marker.display()))?;
                if let Some(file) = without_suffix(&marker, suffix) {
                    kept.push(relative(root, &file));
                }
            }
        }
        kept.sort();
        Ok(kept)
    }
}

fn relative(root: &Path, path: &Path) -> String {
    key(path.strip_prefix(root).unwrap_or(path))
}

#[cfg(test)]
mod tests {
    use super::*;

    const MARKERS: Markers = Markers {
        backup: ".test-backup",
        created: ".test-created",
    };

    fn read(path: &Path) -> String {
        std::fs::read_to_string(path).unwrap()
    }

    #[test]
    fn the_first_write_moves_the_original_aside_and_later_ones_keep_it() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("units/a.lua");
        std::fs::create_dir_all(file.parent().unwrap()).unwrap();
        std::fs::write(&file, "original").unwrap();

        MARKERS.write(&file, b"first").unwrap();
        MARKERS.write(&file, b"second").unwrap();

        assert_eq!(read(&file), "second");
        assert_eq!(read(&with_suffix(&file, ".test-backup")), "original");
        assert_eq!(
            MARKERS.status(dir.path()),
            Status {
                backups: 1,
                created: 0
            }
        );
        assert!(!with_suffix(&file, ".coilbox-tmp").exists());
    }

    #[test]
    fn undo_restores_the_original_and_deletes_a_created_file() {
        let dir = tempfile::tempdir().unwrap();
        let old = dir.path().join("a.lua");
        let new = dir.path().join("sub/b.lua");
        std::fs::create_dir_all(new.parent().unwrap()).unwrap();
        std::fs::write(&old, "original").unwrap();
        MARKERS.write(&old, b"changed").unwrap();
        MARKERS.write(&new, b"made by coilbox").unwrap();
        assert_eq!(
            MARKERS.status(dir.path()),
            Status {
                backups: 1,
                created: 1
            }
        );

        let undone = MARKERS.undo(dir.path()).unwrap();

        assert_eq!(undone.restored, vec!["a.lua"]);
        assert_eq!(undone.deleted, vec!["sub/b.lua"]);
        assert_eq!(read(&old), "original");
        assert!(!new.exists());
        assert!(MARKERS.status(dir.path()).is_empty());
    }

    #[test]
    fn a_created_file_written_again_is_still_created_not_backed_up() {
        let dir = tempfile::tempdir().unwrap();
        let new = dir.path().join("b.lua");
        MARKERS.write(&new, b"one").unwrap();
        MARKERS.write(&new, b"two").unwrap();

        assert_eq!(read(&new), "two");
        assert_eq!(
            MARKERS.status(dir.path()),
            Status {
                backups: 0,
                created: 1
            }
        );
    }

    #[test]
    fn accept_keeps_the_changes_and_drops_every_marker() {
        let dir = tempfile::tempdir().unwrap();
        let old = dir.path().join("a.lua");
        let new = dir.path().join("b.lua");
        std::fs::write(&old, "original").unwrap();
        MARKERS.write(&old, b"changed").unwrap();
        MARKERS.write(&new, b"new").unwrap();

        let kept = MARKERS.accept(dir.path()).unwrap();

        assert_eq!(kept, vec!["a.lua", "b.lua"]);
        assert_eq!(read(&old), "changed");
        assert_eq!(read(&new), "new");
        assert!(MARKERS.status(dir.path()).is_empty());
    }

    #[test]
    fn another_features_markers_are_not_touched() {
        let dir = tempfile::tempdir().unwrap();
        let other = Markers {
            backup: ".other-backup",
            created: ".other-created",
        };
        let file = dir.path().join("a.lua");
        std::fs::write(&file, "original").unwrap();
        other.write(&file, b"changed").unwrap();

        assert!(MARKERS.status(dir.path()).is_empty());
        MARKERS.undo(dir.path()).unwrap();
        assert_eq!(read(&file), "changed");
    }

    #[test]
    fn a_git_folder_is_not_searched() {
        let dir = tempfile::tempdir().unwrap();
        let git = dir.path().join(".git");
        std::fs::create_dir_all(&git).unwrap();
        std::fs::write(git.join("x.test-backup"), "").unwrap();
        assert!(MARKERS.status(dir.path()).is_empty());
    }

    #[test]
    fn guards_recognise_a_loose_game_in_a_games_folder() {
        let dir = tempfile::tempdir().unwrap();
        let game = dir.path().join("games/dev.sdd");
        std::fs::create_dir_all(&game).unwrap();
        assert!(is_sdd(&game) && in_games_dir(&game));

        let elsewhere = dir.path().join("maps/dev.sdd");
        std::fs::create_dir_all(&elsewhere).unwrap();
        assert!(is_sdd(&elsewhere) && !in_games_dir(&elsewhere));

        let packed = dir.path().join("games/dev.sdz");
        std::fs::write(&packed, "zip").unwrap();
        assert!(!is_sdd(&packed));
    }
}
