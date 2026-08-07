//! Remove one downloaded game or map archive from a content root.
//!
//! The engine ships its own base archives (`springcontent.sdz`, `maphelper.sdz`,
//! `cursors.sdz`, `bitmaps.sdz` and friends) and deleting one leaves an engine
//! that cannot start a game. Nothing in a scan flags an archive as base, so the
//! only discriminator available is where the file sits: engine archives live in
//! `<engineDir>/base/`, while everything a user downloads lands in a content
//! root's `games/`, `maps/` or `packages/`. [`classify`] therefore accepts a path
//! only when its immediate parent is one of those three directories, which keeps
//! the guard in Rust rather than trusting the caller to have hidden the button.

use std::path::Path;

/// Archive extensions a user can have downloaded. `.sdp` is a rapid package.
const ARCHIVE_EXTS: &[&str] = &["sd7", "sdz", "sdd", "sdp"];

/// The directories downloaded content lands in. Deliberately excludes `base`.
const CONTENT_DIRS: &[&str] = &["games", "maps", "packages"];

/// What `content_delete_archive` is allowed to remove.
pub(crate) enum Removal {
    File,
    /// A `.sdd` is a loose directory, so it needs a recursive removal.
    Dir,
}

/// Decide whether `path` is a deletable downloaded archive, and how to remove it.
/// Rejects anything outside `games`/`maps`/`packages`, which is what keeps the
/// engine's base archives safe (see the module docs).
pub(crate) fn classify(path: &Path) -> Result<Removal, String> {
    if !path.exists() {
        return Err("archive not found".to_string());
    }
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .map(str::to_ascii_lowercase)
        .unwrap_or_default();
    if !ARCHIVE_EXTS.contains(&ext.as_str()) {
        return Err("not a game or map archive".to_string());
    }
    let parent_ok = path
        .parent()
        .and_then(|p| p.file_name())
        .and_then(|n| n.to_str())
        .map(|n| CONTENT_DIRS.contains(&n.to_ascii_lowercase().as_str()))
        .unwrap_or(false);
    if !parent_ok {
        return Err(
            "only archives in a content root's games, maps or packages folder can be deleted"
                .to_string(),
        );
    }
    if ext == "sdd" {
        Ok(Removal::Dir)
    } else {
        Ok(Removal::File)
    }
}

/// Delete a downloaded archive, returning the bytes it freed.
pub(crate) fn delete(path: &Path) -> Result<u64, String> {
    match classify(path)? {
        Removal::File => {
            let bytes = std::fs::metadata(path).map(|m| m.len()).unwrap_or(0);
            std::fs::remove_file(path).map_err(|e| format!("delete failed: {e}"))?;
            Ok(bytes)
        }
        Removal::Dir => {
            let (bytes, _files) = crate::caches::dir_stats(path);
            std::fs::remove_dir_all(path).map_err(|e| format!("delete failed: {e}"))?;
            Ok(bytes)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::PathBuf;

    fn tmp(name: &str) -> PathBuf {
        let p = std::env::temp_dir().join(format!("archives_test_{name}"));
        let _ = fs::remove_dir_all(&p);
        fs::create_dir_all(&p).unwrap();
        p
    }

    fn write_in(root: &Path, dir: &str, file: &str, body: &[u8]) -> PathBuf {
        let d = root.join(dir);
        fs::create_dir_all(&d).unwrap();
        let p = d.join(file);
        fs::write(&p, body).unwrap();
        p
    }

    #[test]
    fn accepts_a_game_archive() {
        let root = tmp("game");
        let p = write_in(&root, "games", "somegame.sd7", b"1234");
        assert!(matches!(classify(&p), Ok(Removal::File)));
        assert_eq!(delete(&p), Ok(4));
        assert!(!p.exists());
    }

    #[test]
    fn accepts_a_rapid_package() {
        let root = tmp("package");
        let p = write_in(&root, "packages", "abc123.sdp", b"12345");
        assert!(matches!(classify(&p), Ok(Removal::File)));
    }

    #[test]
    fn accepts_a_loose_sdd_directory() {
        let root = tmp("sdd");
        let dir = root.join("games").join("dev.sdd");
        fs::create_dir_all(dir.join("units")).unwrap();
        fs::write(dir.join("units").join("a.lua"), b"abc").unwrap();
        assert!(matches!(classify(&dir), Ok(Removal::Dir)));
        assert_eq!(delete(&dir), Ok(3));
        assert!(!dir.exists());
    }

    #[test]
    fn rejects_an_engine_base_archive() {
        let root = tmp("base");
        let p = write_in(&root, "base", "springcontent.sdz", b"engine");
        assert!(classify(&p).is_err());
        assert!(delete(&p).is_err());
        assert!(p.exists(), "base archive must survive");
    }

    #[test]
    fn rejects_an_unknown_extension() {
        let root = tmp("ext");
        let p = write_in(&root, "games", "notes.txt", b"hi");
        assert!(classify(&p).is_err());
    }

    #[test]
    fn rejects_a_missing_path() {
        let root = tmp("missing");
        assert!(classify(&root.join("games").join("gone.sd7")).is_err());
    }
}
