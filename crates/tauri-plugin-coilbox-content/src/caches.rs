//! Reclaim the app's grow-only generated-image / info caches.
//!
//! Several caches accumulate without bound: a version bump or a replaced archive
//! salts the cache key, orphaning the old files, and nothing ever deletes them.
//! Every entry regenerates on demand, so clearing any of these dirs is always
//! safe — the only cost is the next render/fetch being cold.
//!
//! All caches live as immediate subdirectories of the app cache dir. This module
//! only ever touches `cache_root.join(<known subdir>)`: the names are compile-time
//! constants with no path separators, so the join can't escape the cache root, and
//! the walk never follows symlinks out of a cache dir.

use picoframe_core::CliResult;
use serde::Serialize;
use serde_json::json;
use std::path::Path;
use tauri::{AppHandle, Runtime};

/// The cache subdirectories under the app cache dir, as `(dir name, label)`.
///
/// The `coilbox-unitsync-*` names mirror the `*_CACHE_SUBDIR` constants in the
/// `tauri-plugin-coilbox-unitsync` crate; the `coilbox-branding*` names mirror
/// this crate's `branding` module (`branding_catalog` / `branding_image`). Keep
/// them in sync if either side renames a dir.
pub(crate) const CACHE_SUBDIRS: &[(&str, &str)] = &[
    ("coilbox-unitsync-thumbs", "Map thumbnails"),
    ("coilbox-unitsync-headers", "Game headers"),
    ("coilbox-unitsync-buildpics", "Unit build icons"),
    ("coilbox-unitsync-faction-logos", "Faction logos"),
    ("coilbox-unitsync-info", "Game and map info"),
    ("coilbox-hub-assets", "Unit renders"),
    ("coilbox-branding", "Branding catalog"),
    ("coilbox-branding-images", "Branding images"),
];

/// Size (and, when applied, clearance) of one cache dir.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CacheEntry {
    /// The on-disk subdir name (stable id).
    pub name: String,
    /// Human-readable label for the UI.
    pub label: String,
    pub bytes: u64,
    pub files: u64,
}

/// Result of a reclaim (dry run or applied). Sizes are computed identically either
/// way; on a dry run nothing is deleted.
#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ReclaimSummary {
    /// Whether the caches were actually cleared (`false` for a dry run).
    pub applied: bool,
    pub caches: Vec<CacheEntry>,
    pub total_bytes: u64,
    pub total_files: u64,
}

/// Recursively tally `(bytes, files)` under `dir`. Symlinks are counted as a single
/// entry and never traversed, so the walk can't follow a link out of the cache dir.
/// A missing/unreadable dir contributes nothing.
pub(crate) fn dir_stats(dir: &Path) -> (u64, u64) {
    let mut bytes = 0u64;
    let mut files = 0u64;
    let Ok(rd) = std::fs::read_dir(dir) else {
        return (0, 0);
    };
    for entry in rd.flatten() {
        let p = entry.path();
        let Ok(md) = std::fs::symlink_metadata(&p) else {
            continue;
        };
        if md.file_type().is_symlink() {
            files += 1; // count the link itself; don't follow it
        } else if md.is_dir() {
            let (b, f) = dir_stats(&p);
            bytes += b;
            files += f;
        } else {
            bytes += md.len();
            files += 1;
        }
    }
    (bytes, files)
}

/// Recursively delete the contents of `dir`. Symlinks are removed as links (never
/// followed), so this can only ever delete files and dirs physically inside `dir`.
fn remove_tree(dir: &Path) {
    let Ok(rd) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in rd.flatten() {
        let p = entry.path();
        let Ok(md) = std::fs::symlink_metadata(&p) else {
            continue;
        };
        if md.file_type().is_symlink() || md.is_file() {
            let _ = std::fs::remove_file(&p);
        } else if md.is_dir() {
            remove_tree(&p);
            let _ = std::fs::remove_dir(&p);
        }
    }
}

/// Size every known cache dir under `cache_root`. When `apply` is set, also clear
/// each one (contents removed, then the now-empty dir). Only the enumerated
/// subdirs are ever touched.
pub(crate) fn reclaim(cache_root: &Path, apply: bool) -> ReclaimSummary {
    let mut out = ReclaimSummary {
        applied: apply,
        ..Default::default()
    };
    for (name, label) in CACHE_SUBDIRS {
        let dir = cache_root.join(name);
        let (bytes, files) = dir_stats(&dir);
        out.total_bytes += bytes;
        out.total_files += files;
        out.caches.push(CacheEntry {
            name: (*name).into(),
            label: (*label).into(),
            bytes,
            files,
        });
        if apply {
            remove_tree(&dir);
            let _ = std::fs::remove_dir(&dir);
        }
    }
    out
}

/// `content_reclaim_caches`, size (and, when `apply`, clear) the app's grow-only
/// generated-image / info caches under the app cache dir. `apply=false` is a dry
/// run that reports per-cache sizes without deleting. Every cache regenerates on
/// demand, so clearing is always safe.
#[tauri::command]
pub(crate) async fn content_reclaim_caches<R: Runtime>(
    app: AppHandle<R>,
    apply: Option<bool>,
) -> CliResult {
    let cache_root = match coilbox_portable::cache_dir(&app) {
        Ok(d) => d,
        Err(e) => return CliResult::err(e),
    };
    let apply = apply.unwrap_or(false);
    match tauri::async_runtime::spawn_blocking(move || reclaim(&cache_root, apply)).await {
        Ok(summary) => CliResult::ok(json!({ "summary": summary })),
        Err(e) => CliResult::err(format!("reclaim task failed: {e}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::PathBuf;

    fn tmp(name: &str) -> PathBuf {
        let p = std::env::temp_dir().join(format!("caches_test_{name}"));
        let _ = fs::remove_dir_all(&p);
        fs::create_dir_all(&p).unwrap();
        p
    }

    #[test]
    fn subdir_names_are_safe_relative_segments() {
        for (name, label) in CACHE_SUBDIRS {
            assert!(!name.is_empty(), "empty cache name");
            assert!(!label.is_empty(), "empty cache label for {name}");
            assert!(
                !name.contains('/') && !name.contains('\\') && *name != ".." && *name != ".",
                "cache name must be a single relative segment: {name}"
            );
        }
    }

    #[test]
    fn sizes_a_cache_dir_recursively() {
        let root = tmp("size");
        let dir = root.join("coilbox-unitsync-thumbs");
        fs::create_dir_all(dir.join("sub")).unwrap();
        fs::write(dir.join("a.png"), b"1234").unwrap();
        fs::write(dir.join("sub").join("b.png"), b"567").unwrap();

        let summary = reclaim(&root, false);
        let thumbs = summary
            .caches
            .iter()
            .find(|c| c.name == "coilbox-unitsync-thumbs")
            .unwrap();
        assert_eq!(thumbs.bytes, 7);
        assert_eq!(thumbs.files, 2);
        assert_eq!(summary.total_bytes, 7);
        assert!(!summary.applied);
        // dry run must not delete
        assert!(dir.join("a.png").exists());
    }

    #[test]
    fn apply_clears_only_known_cache_dirs() {
        let root = tmp("clear");
        // a known cache dir with content
        let cache = root.join("coilbox-branding-images");
        fs::create_dir_all(&cache).unwrap();
        fs::write(cache.join("x.png"), b"data").unwrap();
        // an UNRELATED sibling dir that must survive
        let bystander = root.join("important-user-data");
        fs::create_dir_all(&bystander).unwrap();
        fs::write(bystander.join("keep.txt"), b"keep").unwrap();

        let summary = reclaim(&root, true);
        assert!(summary.applied);
        assert!(!cache.exists(), "cache dir should be gone");
        assert!(bystander.join("keep.txt").exists(), "bystander untouched");
    }

    #[test]
    fn missing_cache_dirs_size_to_zero() {
        let root = tmp("missing");
        let summary = reclaim(&root, false);
        assert_eq!(summary.total_bytes, 0);
        assert_eq!(summary.total_files, 0);
        assert_eq!(summary.caches.len(), CACHE_SUBDIRS.len());
    }

    #[cfg(unix)]
    #[test]
    fn symlinks_are_not_followed_out_of_the_cache() {
        use std::os::unix::fs::symlink;
        let root = tmp("symlink");
        // an outside dir the cache must never reach through a link
        let outside = root.join("outside");
        fs::create_dir_all(&outside).unwrap();
        fs::write(outside.join("secret.txt"), b"secret").unwrap();

        let cache = root.join("coilbox-unitsync-info");
        fs::create_dir_all(&cache).unwrap();
        symlink(&outside, cache.join("link")).unwrap();

        // size counts the link as one entry, not the outside file's bytes
        let dry = reclaim(&root, false);
        let info = dry
            .caches
            .iter()
            .find(|c| c.name == "coilbox-unitsync-info")
            .unwrap();
        assert_eq!(info.files, 1);
        assert_eq!(info.bytes, 0);

        // clearing removes the link but never the linked-to file
        reclaim(&root, true);
        assert!(!cache.exists());
        assert!(outside.join("secret.txt").exists(), "linked file survives");
    }
}
