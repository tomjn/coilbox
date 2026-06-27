//! Serde data model for the content plugin. The `*State`/`ContentRoot`/`Engine`
//! shapes are serialized to the frontend (camelCase) and are the cross-plugin
//! read API; `StoreFile`/`UserRoot` are the durable on-disk shape.
//!
//! Timestamps are epoch-millis `u64` (display data only) so the crate doesn't
//! need a date dependency — the frontend formats them with `new Date(ms)`.

use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum RootSource {
    Auto,
    Manual,
}

#[derive(Serialize, Deserialize, Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "lowercase")]
pub enum RootKind {
    /// pr-downloader / installed layout (engine/ games/ maps/ packages/ pool/ rapid/).
    Data,
    /// All-in-one folder: a spring binary + basecontent next to it.
    Portable,
}

#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct RootCounts {
    pub games: u32,
    pub maps: u32,
    pub engines: u32,
    pub packages: u32,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Engine {
    pub id: String,
    pub root_path: String,
    pub path: String,
    pub executable: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub platform: Option<String>,
    pub version: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sync_version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub verified_at: Option<u64>,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ContentRoot {
    pub id: String,
    pub path: String,
    pub source: RootSource,
    pub kind: RootKind,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    pub origins: Vec<String>,
    pub exists: bool,
    pub valid: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub forced: Option<bool>,
    pub counts: RootCounts,
    pub engines: Vec<Engine>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_scanned_at: Option<u64>,
}

#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct ContentState {
    pub schema_version: u32,
    pub roots: Vec<ContentRoot>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_scan_at: Option<u64>,
}

/// A user-added root, persisted verbatim (auto roots are recomputed each rescan).
#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct UserRoot {
    pub path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    #[serde(default)]
    pub forced: bool,
}

/// The durable on-disk store: the user's manual roots plus the last computed
/// snapshot (so reads are instant without rescanning).
#[derive(Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct StoreFile {
    #[serde(default)]
    pub schema_version: u32,
    #[serde(default)]
    pub user_roots: Vec<UserRoot>,
    #[serde(default)]
    pub snapshot: Option<ContentState>,
}

pub const SCHEMA_VERSION: u32 = 1;

/// Read the store from `path`, returning a default (empty) store if it's absent.
pub fn load_store(path: &std::path::Path) -> Result<StoreFile, String> {
    match std::fs::read_to_string(path) {
        Ok(s) => serde_json::from_str(&s).map_err(|e| format!("invalid content store json: {e}")),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(StoreFile::default()),
        Err(e) => Err(format!("could not read content store: {e}")),
    }
}

/// Write the full store to `path`, creating the parent dir if needed.
pub fn save_store(path: &std::path::Path, store: &StoreFile) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("could not create content store dir: {e}"))?;
    }
    let json = serde_json::to_string_pretty(store).map_err(|e| e.to_string())?;
    std::fs::write(path, json).map_err(|e| format!("could not write content store: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn missing_store_is_default() {
        let p = std::env::temp_dir().join("content_store_does_not_exist_xyz.json");
        let _ = std::fs::remove_file(&p);
        let store = load_store(&p).unwrap();
        assert!(store.user_roots.is_empty());
        assert!(store.snapshot.is_none());
    }

    #[test]
    fn roundtrips_user_roots() {
        let dir = std::env::temp_dir().join("content_store_test");
        let p = dir.join("state.json");
        let _ = std::fs::remove_dir_all(&dir);
        let mut store = StoreFile {
            schema_version: SCHEMA_VERSION,
            ..Default::default()
        };
        store.user_roots.push(UserRoot {
            path: "/tmp/spring".into(),
            label: Some("test".into()),
            forced: true,
        });
        save_store(&p, &store).unwrap();
        let back = load_store(&p).unwrap();
        assert_eq!(back.user_roots.len(), 1);
        assert_eq!(back.user_roots[0].path, "/tmp/spring");
        assert!(back.user_roots[0].forced);
    }
}
