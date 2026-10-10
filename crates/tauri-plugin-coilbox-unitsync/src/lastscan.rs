//! The last good content scan of each engine and content folder, kept on disk so
//! the Maps and Games pages have a list to show at the next launch (issue #3715).
//!
//! The file is a first paint and nothing more. It can name an archive deleted
//! since, so the frontend never lets it decide whether anything is installed.
//! Anything unreadable, from another format version, or written for another
//! engine path or content folder reads as no saved scan.

use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::Value;

/// Bump when the shape of a saved scan changes. An older file then reads as none.
const VERSION: u32 = 1;

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Saved {
    version: u32,
    engine_path: String,
    data_dir: String,
    scan: Value,
}

/// One file per target. The name is a hash, and the target is stored inside the
/// file too, so a hash collision reads as none rather than as another target's scan.
fn file_for(dir: &Path, engine_path: &str, data_dir: &str) -> PathBuf {
    let mut h = std::collections::hash_map::DefaultHasher::new();
    engine_path.hash(&mut h);
    data_dir.hash(&mut h);
    dir.join(format!("{:016x}.json", h.finish()))
}

/// Replace the saved scan for a target. Writes beside the file and renames over
/// it, so a crash mid-write leaves the old scan rather than half a new one.
pub fn save(dir: &Path, engine_path: &str, data_dir: &str, scan: &Value) -> Result<(), String> {
    std::fs::create_dir_all(dir).map_err(|e| format!("could not create {}: {e}", dir.display()))?;
    let path = file_for(dir, engine_path, data_dir);
    let saved = Saved {
        version: VERSION,
        engine_path: engine_path.to_string(),
        data_dir: data_dir.to_string(),
        scan: scan.clone(),
    };
    let json = serde_json::to_vec(&saved).map_err(|e| e.to_string())?;
    let tmp = path.with_extension("tmp");
    std::fs::write(&tmp, json).map_err(|e| format!("could not write {}: {e}", tmp.display()))?;
    std::fs::rename(&tmp, &path).map_err(|e| format!("could not replace {}: {e}", path.display()))
}

/// The saved scan for a target, or `None` when there is none that can be trusted
/// as a first paint.
pub fn load(dir: &Path, engine_path: &str, data_dir: &str) -> Option<Value> {
    let bytes = std::fs::read(file_for(dir, engine_path, data_dir)).ok()?;
    let saved: Saved = serde_json::from_slice(&bytes).ok()?;
    (saved.version == VERSION && saved.engine_path == engine_path && saved.data_dir == data_dir)
        .then_some(saved.scan)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn round_trips() {
        let dir = tempfile::tempdir().unwrap();
        let scan = json!({"maps": [{"name": "A"}], "games": [], "errors": []});
        save(dir.path(), "/engine", "/data", &scan).unwrap();
        assert_eq!(load(dir.path(), "/engine", "/data"), Some(scan));
    }

    #[test]
    fn a_second_save_replaces_the_first() {
        let dir = tempfile::tempdir().unwrap();
        save(dir.path(), "/engine", "/data", &json!({"n": 1})).unwrap();
        save(dir.path(), "/engine", "/data", &json!({"n": 2})).unwrap();
        assert_eq!(load(dir.path(), "/engine", "/data"), Some(json!({"n": 2})));
    }

    #[test]
    fn another_target_reads_as_none() {
        let dir = tempfile::tempdir().unwrap();
        save(dir.path(), "/engine", "/data", &json!({"n": 1})).unwrap();
        assert_eq!(load(dir.path(), "/other", "/data"), None);
        assert_eq!(load(dir.path(), "/engine", "/other"), None);
    }

    #[test]
    fn a_file_for_another_target_under_the_same_name_reads_as_none() {
        let dir = tempfile::tempdir().unwrap();
        let wrong = Saved {
            version: VERSION,
            engine_path: "/elsewhere".into(),
            data_dir: "/data".into(),
            scan: json!({"n": 1}),
        };
        std::fs::write(
            file_for(dir.path(), "/engine", "/data"),
            serde_json::to_vec(&wrong).unwrap(),
        )
        .unwrap();
        assert_eq!(load(dir.path(), "/engine", "/data"), None);
    }

    #[test]
    fn a_corrupt_file_reads_as_none() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(file_for(dir.path(), "/engine", "/data"), b"{not json").unwrap();
        assert_eq!(load(dir.path(), "/engine", "/data"), None);
    }

    #[test]
    fn another_version_reads_as_none() {
        let dir = tempfile::tempdir().unwrap();
        let old = Saved {
            version: VERSION + 1,
            engine_path: "/engine".into(),
            data_dir: "/data".into(),
            scan: json!({"n": 1}),
        };
        std::fs::write(
            file_for(dir.path(), "/engine", "/data"),
            serde_json::to_vec(&old).unwrap(),
        )
        .unwrap();
        assert_eq!(load(dir.path(), "/engine", "/data"), None);
    }

    #[test]
    fn a_missing_file_reads_as_none() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(load(dir.path(), "/engine", "/data"), None);
    }
}
