//! Per-content-root backup/restore of a Spring/Recoil engine's user config:
//! `springsettings.cfg` (engine settings), `LuaUI/Config/` (widget config) and
//! `uikeys.txt` (keybinds). A "profile" is a named snapshot of the three,
//! letting a user swap settings sets. Snapshots live under the app data dir,
//! keyed by a hash of the root path, so they travel with a portable install and
//! never touch the root except on an explicit restore.
//!
//! Where those three files sit depends on the engine. An engine installed into
//! `engine/<version>/` satisfies Recoil's Portable Mode test, which makes that
//! directory its write dir, so its config is in there rather than at the root.
//! A snapshot therefore covers the root and every engine directory under it, and
//! mirrors that layout so a restore puts each copy back where it came from.

use picoframe_core::CliResult;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Runtime};

/// The three config artifacts, each a path relative to a config location.
/// `is_dir` selects a recursive copy (`LuaUI/Config`) vs a single-file copy.
struct Artifact {
    /// Stable id stored in the manifest + returned to the UI.
    id: &'static str,
    /// Path relative to a config location (and mirrored inside a snapshot).
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

/// Every place under `base` an engine's config can be: `base` itself, plus each
/// directory one and two levels under `engine/`. Two levels because a springfiles
/// install nests versions under a platform folder. Paths are relative to `base`,
/// so the same walk describes a content root and a snapshot of one.
fn config_locations(base: &Path) -> Vec<PathBuf> {
    let mut out = vec![PathBuf::new()];
    let Ok(entries) = std::fs::read_dir(base.join("engine")) else {
        return out;
    };
    for entry in entries.flatten() {
        if !entry.path().is_dir() {
            continue;
        }
        let dir = Path::new("engine").join(entry.file_name());
        if let Ok(inner) = std::fs::read_dir(base.join(&dir)) {
            for sub in inner.flatten() {
                if sub.path().is_dir() {
                    out.push(dir.join(sub.file_name()));
                }
            }
        }
        out.push(dir);
    }
    out
}

/// Every artifact actually present under `base`, as (location, artifact) pairs.
fn artifacts_under(base: &Path) -> Vec<(PathBuf, &'static Artifact)> {
    config_locations(base)
        .into_iter()
        .flat_map(|loc| ARTIFACTS.iter().map(move |a| (loc.clone(), a)))
        .filter(|(loc, a)| base.join(loc).join(a.rel).exists())
        .collect()
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

/// Save the three config artifacts present under `root_path` into a named snapshot,
/// from the root and from each engine directory under it. Only artifacts that exist
/// are copied (a fresh root may have none). Re-saving the same name replaces that
/// snapshot. The manifest names each *kind* captured, once, whatever it was found
/// beside.
pub fn backup(profiles_root: &Path, root_path: &str, name: &str) -> Result<ProfileInfo, String> {
    let slug = slug(name).ok_or("Profile name must contain a letter or number")?;
    let root = Path::new(root_path);
    let dest = root_profiles_dir(profiles_root, root_path).join(&slug);
    // A clean re-save: drop any prior snapshot dir for this slug first.
    if dest.exists() {
        std::fs::remove_dir_all(&dest).map_err(|e| format!("clear old snapshot: {e}"))?;
    }
    std::fs::create_dir_all(&dest).map_err(|e| format!("create snapshot dir: {e}"))?;

    let found = artifacts_under(root);
    for (loc, a) in &found {
        let src = root.join(loc).join(a.rel);
        let to = dest.join(loc).join(a.rel);
        if let Some(parent) = to.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("create {}: {e}", parent.display()))?;
        }
        if a.is_dir {
            copy_dir_all(&src, &to)?;
        } else {
            std::fs::copy(&src, &to).map_err(|e| format!("copy {}: {e}", src.display()))?;
        }
    }

    let captured = ARTIFACTS
        .iter()
        .filter(|a| found.iter().any(|(_, f)| f.id == a.id))
        .map(|a| a.id.to_string())
        .collect();

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

/// Restore a named snapshot's artifacts back into `root_path`, each to the
/// location it was captured from. What the snapshot holds is read off its own
/// tree rather than the manifest, so a snapshot taken before this covered the
/// engine directories still restores to the root.
///
/// A location the root no longer has is skipped: writing config into an engine
/// version that is not installed would only leave a stub directory behind.
///
/// When `overwrite` is false and any target artifact already exists, writes
/// nothing and returns `needs_overwrite: true`. Otherwise each captured artifact
/// replaces the live one.
pub fn restore(
    profiles_root: &Path,
    root_path: &str,
    slug: &str,
    overwrite: bool,
) -> Result<RestoreOutcome, String> {
    let src_dir = root_profiles_dir(profiles_root, root_path).join(slug);
    if !src_dir.join("manifest.json").is_file() {
        return Err("Profile not found".to_string());
    }
    let root = Path::new(root_path);

    let present: Vec<(PathBuf, &Artifact)> = artifacts_under(&src_dir)
        .into_iter()
        .filter(|(loc, _)| root.join(loc).is_dir())
        .collect();

    if !overwrite {
        let clobbers = present
            .iter()
            .any(|(loc, a)| root.join(loc).join(a.rel).exists());
        if clobbers {
            return Ok(RestoreOutcome {
                needs_overwrite: true,
                restored: 0,
            });
        }
    }

    let mut restored = 0u32;
    for (loc, a) in present {
        let from = src_dir.join(&loc).join(a.rel);
        let to = root.join(&loc).join(a.rel);
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

/// Directory holding engine-config profile snapshots, under the app data dir.
fn profiles_dir<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    Ok(coilbox_portable::data_dir(app)?.join("engine-config-profiles"))
}

/// `content_config_profiles`, list saved engine-config snapshots for a content
/// root (its `springsettings.cfg` / `LuaUI/Config` / `uikeys.txt`). `rootPath` is a
/// `ContentRoot.path`.
#[tauri::command]
pub(crate) async fn content_config_profiles<R: Runtime>(
    app: AppHandle<R>,
    root_path: String,
) -> CliResult {
    let dir = match profiles_dir(&app) {
        Ok(d) => d,
        Err(e) => return CliResult::err(e),
    };
    let profiles = tauri::async_runtime::spawn_blocking(move || list(&dir, &root_path)).await;
    match profiles {
        Ok(profiles) => CliResult::ok(json!({ "profiles": profiles })),
        Err(e) => CliResult::err(format!("list profiles task failed: {e}")),
    }
}

/// `content_config_backup`, snapshot a root's present engine-config artifacts into
/// a named profile (re-saving the name replaces it).
#[tauri::command]
pub(crate) async fn content_config_backup<R: Runtime>(
    app: AppHandle<R>,
    root_path: String,
    name: String,
) -> CliResult {
    let dir = match profiles_dir(&app) {
        Ok(d) => d,
        Err(e) => return CliResult::err(e),
    };
    let res = tauri::async_runtime::spawn_blocking(move || backup(&dir, &root_path, &name)).await;
    match res {
        Ok(Ok(profile)) => CliResult::ok(json!({ "profile": profile })),
        Ok(Err(e)) => CliResult::err(e),
        Err(e) => CliResult::err(format!("backup task failed: {e}")),
    }
}

/// `content_config_restore`, restore a named profile's artifacts into the root.
/// With `overwrite` unset, refuses (returning `needsOverwrite`) when live files
/// would be clobbered, so the UI can confirm first. `slug` is `ProfileInfo.slug`.
#[tauri::command]
pub(crate) async fn content_config_restore<R: Runtime>(
    app: AppHandle<R>,
    root_path: String,
    slug: String,
    overwrite: Option<bool>,
) -> CliResult {
    let dir = match profiles_dir(&app) {
        Ok(d) => d,
        Err(e) => return CliResult::err(e),
    };
    let overwrite = overwrite.unwrap_or(false);
    let res = tauri::async_runtime::spawn_blocking(move || {
        restore(&dir, &root_path, &slug, overwrite)
    })
    .await;
    match res {
        Ok(Ok(outcome)) => CliResult::ok(json!(outcome)),
        Ok(Err(e)) => CliResult::err(e),
        Err(e) => CliResult::err(format!("restore task failed: {e}")),
    }
}

/// `content_config_delete_profile`, delete a named engine-config snapshot.
#[tauri::command]
pub(crate) async fn content_config_delete_profile<R: Runtime>(
    app: AppHandle<R>,
    root_path: String,
    slug: String,
) -> CliResult {
    let dir = match profiles_dir(&app) {
        Ok(d) => d,
        Err(e) => return CliResult::err(e),
    };
    let res = tauri::async_runtime::spawn_blocking(move || delete(&dir, &root_path, &slug)).await;
    match res {
        Ok(Ok(())) => CliResult::ok(json!({ "ok": true })),
        Ok(Err(e)) => CliResult::err(e),
        Err(e) => CliResult::err(format!("delete profile task failed: {e}")),
    }
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

    /// A scratch root with a Portable Mode engine in it: coilbox installs into
    /// `engine/<version>/`, and that is where the engine then writes its config.
    fn portable_root(tag: &str) -> (PathBuf, PathBuf, PathBuf) {
        let tmp = std::env::temp_dir().join(format!("cbx-cfg-{tag}-{}", now_ms()));
        let root = tmp.join("root");
        let engine = root.join("engine").join("2026.07.4");
        std::fs::create_dir_all(engine.join("LuaUI/Config")).unwrap();
        std::fs::write(engine.join("springsettings.cfg"), b"Fullscreen=0\n").unwrap();
        std::fs::write(engine.join("uikeys.txt"), b"bind x\n").unwrap();
        std::fs::write(engine.join("LuaUI/Config/BA.lua"), b"return {}\n").unwrap();
        (tmp.clone(), root, engine)
    }

    /// The root a coilbox install actually produces has nothing at the top level
    /// and everything inside the engine directory, and a profile that only looked
    /// at the root captured none of it.
    #[test]
    fn a_portable_engines_config_is_captured_and_put_back() {
        let (tmp, root, engine) = portable_root("portable");
        let profiles = tmp.join("profiles");
        let root_s = root.to_string_lossy().to_string();

        let info = backup(&profiles, &root_s, "Mine").unwrap();
        assert_eq!(info.artifacts.len(), 3);

        std::fs::write(engine.join("springsettings.cfg"), b"Fullscreen=1\n").unwrap();
        std::fs::remove_file(engine.join("uikeys.txt")).unwrap();

        let done = restore(&profiles, &root_s, "mine", true).unwrap();
        assert_eq!(done.restored, 3);
        assert_eq!(
            std::fs::read_to_string(engine.join("springsettings.cfg")).unwrap(),
            "Fullscreen=0\n"
        );
        assert_eq!(
            std::fs::read_to_string(engine.join("uikeys.txt")).unwrap(),
            "bind x\n"
        );
        assert_eq!(
            std::fs::read_to_string(engine.join("LuaUI/Config/BA.lua")).unwrap(),
            "return {}\n"
        );
        let _ = std::fs::remove_dir_all(&tmp);
    }

    /// A springfiles install nests the version under a platform folder, so the
    /// walk has to reach two levels down.
    #[test]
    fn a_nested_engine_directory_is_captured() {
        let tmp = std::env::temp_dir().join(format!("cbx-cfg-nested-{}", now_ms()));
        let root = tmp.join("root");
        let profiles = tmp.join("profiles");
        let engine = root.join("engine").join("macos_arm64").join("105.1.1");
        std::fs::create_dir_all(&engine).unwrap();
        std::fs::write(engine.join("uikeys.txt"), b"bind x\n").unwrap();

        let root_s = root.to_string_lossy().to_string();
        assert_eq!(
            backup(&profiles, &root_s, "Mine").unwrap().artifacts,
            vec!["uikeys.txt".to_string()]
        );

        std::fs::remove_file(engine.join("uikeys.txt")).unwrap();
        assert_eq!(
            restore(&profiles, &root_s, "mine", true).unwrap().restored,
            1
        );
        assert_eq!(
            std::fs::read_to_string(engine.join("uikeys.txt")).unwrap(),
            "bind x\n"
        );
        let _ = std::fs::remove_dir_all(&tmp);
    }

    /// Restoring a snapshot taken against an engine the player has since removed
    /// must not put its config back as a stub directory.
    #[test]
    fn an_engine_that_is_gone_is_not_restored_into() {
        let (tmp, root, engine) = portable_root("gone");
        let profiles = tmp.join("profiles");
        let root_s = root.to_string_lossy().to_string();

        backup(&profiles, &root_s, "Mine").unwrap();
        std::fs::remove_dir_all(&engine).unwrap();

        assert_eq!(
            restore(&profiles, &root_s, "mine", true).unwrap().restored,
            0
        );
        assert!(!engine.exists());
        let _ = std::fs::remove_dir_all(&tmp);
    }
}
