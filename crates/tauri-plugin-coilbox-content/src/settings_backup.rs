//! Per-content-root backup/restore of a Spring/Recoil engine's user config:
//! `springsettings.cfg` (engine settings), `LuaUI/Config/` (widget config) and
//! `uikeys.txt` (keybinds). Each root has its own copy of these under its data
//! dir, so a "profile" is a named snapshot of the three, letting a user swap
//! settings sets. Snapshots live under the app data dir, keyed by a hash of the
//! root path, so they travel with a portable install and never touch the root
//! except on an explicit restore.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

/// The three config artifacts, each a path relative to a content root. `is_dir`
/// selects a recursive copy (`LuaUI/Config`) vs a single-file copy.
struct Artifact {
    /// Stable id stored in the manifest + returned to the UI.
    id: &'static str,
    /// Path relative to the content root (and mirrored inside a snapshot).
    rel: &'static str,
    is_dir: bool,
}

const ARTIFACTS: &[Artifact] = &[
    Artifact {
        id: "springsettings.cfg",
        rel: "springsettings.cfg",
        is_dir: false,
    },
    Artifact {
        id: "uikeys.txt",
        rel: "uikeys.txt",
        is_dir: false,
    },
    Artifact {
        id: "LuaUI/Config",
        rel: "LuaUI/Config",
        is_dir: true,
    },
];

/// One saved profile's metadata (its manifest, round-tripped as JSON).
#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ProfileInfo {
    /// Display name as the user typed it.
    pub name: String,
    /// Filesystem slug (the snapshot directory name); the id for restore/delete.
    pub slug: String,
    /// Creation time, epoch-millis (format with `new Date(ms)`).
    pub created_at_ms: u64,
    /// Which of the three artifacts this snapshot actually captured.
    pub artifacts: Vec<String>,
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Filesystem-safe slug for a profile name: lowercase, non-alphanumerics collapsed
/// to single dashes, trimmed. `None` when nothing usable remains (e.g. all
/// punctuation), so the caller can reject an unusable name.
pub fn slug(name: &str) -> Option<String> {
    let mut out = String::new();
    let mut last_dash = false;
    for ch in name.trim().chars() {
        if ch.is_ascii_alphanumeric() {
            out.push(ch.to_ascii_lowercase());
            last_dash = false;
        } else if !last_dash && !out.is_empty() {
            out.push('-');
            last_dash = true;
        }
    }
    while out.ends_with('-') {
        out.pop();
    }
    (!out.is_empty()).then_some(out)
}

/// The snapshot directory for one root, `<profiles_root>/<root_key>` where
/// `root_key` is a hash of the root path (stable + filesystem-safe).
fn root_profiles_dir(profiles_root: &Path, root_path: &str) -> PathBuf {
    profiles_root.join(crate::hash_id(&[root_path]))
}

/// Recursively copy `src` into `dst` (creating `dst`). Used for `LuaUI/Config`.
fn copy_dir_all(src: &Path, dst: &Path) -> Result<(), String> {
    std::fs::create_dir_all(dst).map_err(|e| format!("create {}: {e}", dst.display()))?;
    for entry in std::fs::read_dir(src).map_err(|e| format!("read {}: {e}", src.display()))? {
        let entry = entry.map_err(|e| format!("read entry: {e}"))?;
        let from = entry.path();
        let to = dst.join(entry.file_name());
        if from.is_dir() {
            copy_dir_all(&from, &to)?;
        } else {
            std::fs::copy(&from, &to).map_err(|e| format!("copy {}: {e}", from.display()))?;
        }
    }
    Ok(())
}

fn write_manifest(dir: &Path, info: &ProfileInfo) -> Result<(), String> {
    let json = serde_json::to_string_pretty(info).map_err(|e| e.to_string())?;
    std::fs::write(dir.join("manifest.json"), json).map_err(|e| format!("write manifest: {e}"))
}

/// Save the three config artifacts present under `root_path` into a named snapshot.
/// Only artifacts that exist are copied (a fresh root may have none). Re-saving the
/// same name replaces that snapshot.
pub fn backup(profiles_root: &Path, root_path: &str, name: &str) -> Result<ProfileInfo, String> {
    let slug = slug(name).ok_or("Profile name must contain a letter or number")?;
    let root = Path::new(root_path);
    let dest = root_profiles_dir(profiles_root, root_path).join(&slug);
    // A clean re-save: drop any prior snapshot dir for this slug first.
    if dest.exists() {
        std::fs::remove_dir_all(&dest).map_err(|e| format!("clear old snapshot: {e}"))?;
    }
    std::fs::create_dir_all(&dest).map_err(|e| format!("create snapshot dir: {e}"))?;

    let mut captured = Vec::new();
    for a in ARTIFACTS {
        let src = root.join(a.rel);
        if !src.exists() {
            continue;
        }
        let to = dest.join(a.rel);
        if let Some(parent) = to.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("create {}: {e}", parent.display()))?;
        }
        if a.is_dir {
            copy_dir_all(&src, &to)?;
        } else {
            std::fs::copy(&src, &to).map_err(|e| format!("copy {}: {e}", src.display()))?;
        }
        captured.push(a.id.to_string());
    }

    let info = ProfileInfo {
        name: name.trim().to_string(),
        slug,
        created_at_ms: now_ms(),
        artifacts: captured,
    };
    write_manifest(&dest, &info)?;
    Ok(info)
}

/// List saved profiles for a root, newest first. Ignores snapshot dirs without a
/// readable manifest.
pub fn list(profiles_root: &Path, root_path: &str) -> Vec<ProfileInfo> {
    let dir = root_profiles_dir(profiles_root, root_path);
    let mut out: Vec<ProfileInfo> = match std::fs::read_dir(&dir) {
        Ok(rd) => rd
            .filter_map(|e| e.ok())
            .filter_map(|e| std::fs::read_to_string(e.path().join("manifest.json")).ok())
            .filter_map(|s| serde_json::from_str::<ProfileInfo>(&s).ok())
            .collect(),
        Err(_) => Vec::new(),
    };
    out.sort_by_key(|p| std::cmp::Reverse(p.created_at_ms));
    out
}

/// Outcome of a restore attempt. `needs_overwrite` is set (with nothing written)
/// when the snapshot's artifacts would clobber existing files and `overwrite`
/// wasn't given, so the UI can confirm first.
#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct RestoreOutcome {
    pub needs_overwrite: bool,
    /// Number of artifacts written (0 when `needs_overwrite`).
    pub restored: u32,
}

/// Restore a named snapshot's artifacts back into `root_path`. When `overwrite` is
/// false and any target artifact already exists, writes nothing and returns
/// `needs_overwrite: true`. Otherwise each captured artifact replaces the live one.
pub fn restore(
    profiles_root: &Path,
    root_path: &str,
    slug: &str,
    overwrite: bool,
) -> Result<RestoreOutcome, String> {
    let src_dir = root_profiles_dir(profiles_root, root_path).join(slug);
    let manifest = std::fs::read_to_string(src_dir.join("manifest.json"))
        .map_err(|_| "Profile not found".to_string())?;
    let info: ProfileInfo = serde_json::from_str(&manifest).map_err(|e| e.to_string())?;
    let root = Path::new(root_path);

    let present: Vec<&Artifact> = ARTIFACTS
        .iter()
        .filter(|a| info.artifacts.iter().any(|id| id == a.id))
        .collect();

    if !overwrite {
        let clobbers = present.iter().any(|a| root.join(a.rel).exists());
        if clobbers {
            return Ok(RestoreOutcome {
                needs_overwrite: true,
                restored: 0,
            });
        }
    }

    let mut restored = 0u32;
    for a in present {
        let from = src_dir.join(a.rel);
        let to = root.join(a.rel);
        if let Some(parent) = to.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("create {}: {e}", parent.display()))?;
        }
        if a.is_dir {
            // Replace the live dir wholesale so removed widget-config files don't linger.
            if to.exists() {
                std::fs::remove_dir_all(&to).map_err(|e| format!("clear {}: {e}", to.display()))?;
            }
            copy_dir_all(&from, &to)?;
        } else {
            std::fs::copy(&from, &to).map_err(|e| format!("copy {}: {e}", from.display()))?;
        }
        restored += 1;
    }
    Ok(RestoreOutcome {
        needs_overwrite: false,
        restored,
    })
}

/// Delete a named snapshot.
pub fn delete(profiles_root: &Path, root_path: &str, slug: &str) -> Result<(), String> {
    let dir = root_profiles_dir(profiles_root, root_path).join(slug);
    if dir.exists() {
        std::fs::remove_dir_all(&dir).map_err(|e| format!("delete snapshot: {e}"))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn slug_normalizes_and_rejects_empty() {
        assert_eq!(slug("My BAR Setup!").as_deref(), Some("my-bar-setup"));
        assert_eq!(slug("  a  b  ").as_deref(), Some("a-b"));
        assert_eq!(slug("***"), None);
        assert_eq!(slug("   "), None);
    }

    #[test]
    fn backup_restore_roundtrip() {
        let tmp = std::env::temp_dir().join(format!("cbx-cfg-{}", now_ms()));
        let root = tmp.join("root");
        let profiles = tmp.join("profiles");
        std::fs::create_dir_all(root.join("LuaUI/Config")).unwrap();
        std::fs::write(root.join("springsettings.cfg"), b"Fullscreen=0\n").unwrap();
        std::fs::write(root.join("uikeys.txt"), b"bind x\n").unwrap();
        std::fs::write(root.join("LuaUI/Config/foo.lua"), b"return {}\n").unwrap();

        let root_s = root.to_string_lossy().to_string();
        let info = backup(&profiles, &root_s, "Test One").unwrap();
        assert_eq!(info.slug, "test-one");
        assert_eq!(info.artifacts.len(), 3);
        assert_eq!(list(&profiles, &root_s).len(), 1);

        // Mutate the live files, then a no-overwrite restore must refuse.
        std::fs::write(root.join("springsettings.cfg"), b"Fullscreen=1\n").unwrap();
        let dry = restore(&profiles, &root_s, "test-one", false).unwrap();
        assert!(dry.needs_overwrite);
        assert_eq!(
            std::fs::read_to_string(root.join("springsettings.cfg")).unwrap(),
            "Fullscreen=1\n"
        );

        // Overwrite restore rewrites the snapshotted value.
        let done = restore(&profiles, &root_s, "test-one", true).unwrap();
        assert!(!done.needs_overwrite);
        assert_eq!(done.restored, 3);
        assert_eq!(
            std::fs::read_to_string(root.join("springsettings.cfg")).unwrap(),
            "Fullscreen=0\n"
        );

        delete(&profiles, &root_s, "test-one").unwrap();
        assert!(list(&profiles, &root_s).is_empty());
        let _ = std::fs::remove_dir_all(&tmp);
    }
}
