//! Reading and writing an engine's `uikeys.txt`, and storing saved keymaps.
//!
//! The engine reads this file from its write dir, next to `springsettings.cfg`,
//! and reads it raw-first: once this file exists, the copy a game ships in its
//! archive never loads. So a write here replaces the player's whole keymap, and
//! the first write over a file coilbox did not author keeps a `.bak` beside it.

use serde::Serialize;
use std::path::Path;

/// First line of a file coilbox wrote. Mirrors `COILBOX_HEADER` in `uikeys.ts`.
const COILBOX_HEADER: &str = "// Written by coilbox";

const FILENAME: &str = "uikeys.txt";
const BACKUP: &str = "uikeys.txt.bak";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadResult {
    /// Full path of the file, whether or not it is there.
    pub path: String,
    pub exists: bool,
    /// The file's text, or empty when there is none.
    pub text: String,
    /// True when the text on disk was last written by coilbox.
    pub ours: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WriteResult {
    pub path: String,
    /// True when this write took the one-time copy of a hand-written file.
    pub backed_up: bool,
}

pub fn read(config_dir: &str) -> ReadResult {
    let path = Path::new(config_dir).join(FILENAME);
    let text = std::fs::read_to_string(&path).unwrap_or_default();
    ReadResult {
        path: path.to_string_lossy().to_string(),
        exists: path.is_file(),
        ours: text.starts_with(COILBOX_HEADER),
        text,
    }
}

pub fn write(config_dir: &str, text: &str) -> Result<WriteResult, String> {
    let dir = Path::new(config_dir);
    std::fs::create_dir_all(dir).map_err(|e| format!("create {}: {e}", dir.display()))?;
    let path = dir.join(FILENAME);
    let backup = dir.join(BACKUP);

    // Only the player's own file is worth keeping, and only the first time: a
    // later backup would be a copy of something coilbox wrote.
    let existing = std::fs::read_to_string(&path).unwrap_or_default();
    let backed_up = path.is_file() && !existing.starts_with(COILBOX_HEADER) && !backup.exists();
    if backed_up {
        std::fs::copy(&path, &backup).map_err(|e| format!("back up {}: {e}", path.display()))?;
    }

    std::fs::write(&path, text).map_err(|e| format!("write {}: {e}", path.display()))?;
    Ok(WriteResult {
        path: path.to_string_lossy().to_string(),
        backed_up,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn tmp(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("cbx-keys-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn read_reports_a_missing_file() {
        let dir = tmp("missing");
        let res = read(dir.to_string_lossy().as_ref());
        assert!(!res.exists);
        assert_eq!(res.text, "");
        assert!(res.path.ends_with("uikeys.txt"));
    }

    #[test]
    fn read_returns_the_text() {
        let dir = tmp("text");
        std::fs::write(dir.join("uikeys.txt"), b"bind a chat\n").unwrap();
        let res = read(dir.to_string_lossy().as_ref());
        assert!(res.exists);
        assert_eq!(res.text, "bind a chat\n");
    }

    #[test]
    fn first_write_over_a_hand_written_file_keeps_a_backup() {
        let dir = tmp("backup");
        let d = dir.to_string_lossy().to_string();
        std::fs::write(dir.join("uikeys.txt"), b"bind a chat\n").unwrap();

        let first = write(&d, "// Written by coilbox\nbind b chat\n").unwrap();
        assert!(first.backed_up);
        assert_eq!(
            std::fs::read_to_string(dir.join("uikeys.txt.bak")).unwrap(),
            "bind a chat\n"
        );

        // A second write has nothing of the player's left to protect, and must
        // not overwrite the one copy of it that exists.
        let second = write(&d, "// Written by coilbox\nbind c chat\n").unwrap();
        assert!(!second.backed_up);
        assert_eq!(
            std::fs::read_to_string(dir.join("uikeys.txt.bak")).unwrap(),
            "bind a chat\n"
        );
        assert_eq!(
            std::fs::read_to_string(dir.join("uikeys.txt")).unwrap(),
            "// Written by coilbox\nbind c chat\n"
        );
    }

    #[test]
    fn write_creates_the_file_when_there_is_none() {
        let dir = tmp("create");
        let res = write(dir.to_string_lossy().as_ref(), "// Written by coilbox\n").unwrap();
        assert!(!res.backed_up);
        assert!(dir.join("uikeys.txt").is_file());
        assert!(!dir.join("uikeys.txt.bak").exists());
    }
}
