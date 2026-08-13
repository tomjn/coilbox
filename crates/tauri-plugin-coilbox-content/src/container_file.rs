//! Writing a coilbox container to a path the caller picked.
//!
//! The frontend owns what is in the file. This owns only the getting of it onto
//! disk, and the one thing that is not a plain `fs::write`: the directory it goes
//! in may not be there yet (issue #1480). Sending a layout to a game writes
//! `LuaUI/Config/blueprints.json`, and a player who has never saved a base in
//! game has neither `LuaUI` nor `Config`, which is exactly the player the feature
//! is for.
//!
//! So it makes the directory, but only so far. See [`MAKEABLE_DEPTH`].

use std::path::{Path, PathBuf};

/// How many missing directories coilbox will make to reach a destination.
///
/// Two, which is `LuaUI/Config` under a config directory the engine already
/// made. That covers the whole of the real case and stops short of the wrong
/// one: a path anchored somewhere that does not exist is three or more levels
/// short, and building a tree there would put the file somewhere nobody asked
/// for and leave the player looking for it. Saying which directory is missing is
/// more use than a `blueprints.json` in a fresh `.spring-typo`.
const MAKEABLE_DEPTH: usize = 2;

/// The directories between `dir` and the nearest one that exists, deepest first.
/// Empty when `dir` is already there.
fn missing_above(dir: &Path) -> Vec<PathBuf> {
    let mut missing = Vec::new();
    let mut at = dir.to_path_buf();
    // An empty path is the current directory, which is always there.
    while !at.as_os_str().is_empty() && !at.is_dir() {
        missing.push(at.clone());
        match at.parent() {
            Some(up) => at = up.to_path_buf(),
            None => break,
        }
    }
    missing
}

/// Write `text` to `dest`, making the directory it goes in when that is a
/// missing config directory rather than a wrong path.
pub fn write(dest: &str, text: &str) -> Result<(), String> {
    let path = Path::new(dest);
    if let Some(parent) = path.parent() {
        let missing = missing_above(parent);
        if let Some(shallowest) = missing.last() {
            if missing.len() > MAKEABLE_DEPTH {
                return Err(format!(
                    "there is no directory at {}, and coilbox will not build a tree to reach {dest}. Check that is where you meant to write.",
                    shallowest.display()
                ));
            }
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("could not make the directory {}: {e}", parent.display()))?;
        }
    }
    std::fs::write(path, text).map_err(|e| format!("could not write {dest}: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "cbx-container-{tag}-{}-{:?}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&dir).expect("temp dir");
        dir
    }

    /// Issue #1480. A player who has never saved a base in game has no
    /// `LuaUI/Config`, and that is the player the send is for, so the first thing
    /// they try must not fail on the operating system's own words.
    #[test]
    fn makes_the_config_directory_a_fresh_game_has_not_got() {
        let root = temp("fresh");
        let dest = root.join("LuaUI/Config/blueprints.json");
        write(&dest.to_string_lossy(), "{}").expect("written");
        assert_eq!(std::fs::read_to_string(&dest).unwrap(), "{}");
        std::fs::remove_dir_all(&root).ok();
    }

    /// The other half of the same rule. A destination anchored somewhere that is
    /// not there is a wrong path, and the answer to it is saying which directory
    /// is missing rather than making four of them in the wrong place.
    #[test]
    fn refuses_a_path_that_is_anchored_nowhere() {
        let root = temp("nowhere");
        let anchor = root.join("no-such-game");
        let dest = anchor.join("LuaUI/Config/blueprints.json");
        let said = write(&dest.to_string_lossy(), "{}").expect_err("refused");
        // Named, and named as coilbox's refusal rather than passed off as the
        // operating system's "no such file", which says nothing about which of
        // the four directories in the path is the one that is not there.
        assert!(
            said.contains(&anchor.to_string_lossy().to_string()),
            "{said}"
        );
        assert!(said.contains("will not build a tree"), "{said}");
        assert!(!anchor.exists(), "built a tree at {}", anchor.display());
        std::fs::remove_dir_all(&root).ok();
    }

    /// The ordinary export, where the save dialog picked a directory that is
    /// already there.
    #[test]
    fn writes_into_a_directory_that_is_already_there() {
        let root = temp("plain");
        let dest = root.join("keymap.json");
        write(&dest.to_string_lossy(), "hello").expect("written");
        assert_eq!(std::fs::read_to_string(&dest).unwrap(), "hello");
        std::fs::remove_dir_all(&root).ok();
    }
}
