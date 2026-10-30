//! Removing a widget from the engine's write folder, and putting it back (issue
//! #1288).
//!
//! The caller says which widget files to remove and which of their subfolders
//! to take with them (the frontend knows which widgets share a subfolder). All
//! of it is copied to a new folder under the widget backups first, laid out as
//! under the write folder, so a failed copy removes nothing. Restoring copies
//! that layout back, and refuses rather than overwrite anything.

use picoframe_core::CliResult;
use serde::Serialize;
use serde_json::json;
use std::path::{Component, Path, PathBuf};
use tauri::{AppHandle, Runtime};

use crate::widget::widget_owned;
use crate::widget_add::{back_up_files, copy_file, BACKUPS};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Removed {
    /// Every file that was deleted, relative to the write folder.
    pub files: Vec<String>,
    /// The backup folder holding them.
    pub backup: String,
}

/// `rel` as a path under the write folder: plain names only, in a folder under
/// `LuaUI/`, at least `depth` of them. Coilbox's own widget is refused.
fn checked(rel: &str, depth: usize) -> Result<PathBuf, String> {
    let path = Path::new(rel);
    let parts: Vec<String> = path
        .components()
        .map(|c| match c {
            Component::Normal(n) => Ok(n.to_string_lossy().to_string()),
            _ => Err(format!("{rel} is not a path under the write folder")),
        })
        .collect::<Result<_, _>>()?;
    if parts.len() < depth || !parts[0].eq_ignore_ascii_case("luaui") {
        return Err(format!("{rel} is not in a widget folder"));
    }
    if widget_owned(&parts[1..].join("/")) {
        return Err(format!("{rel} is coilbox's own widget"));
    }
    Ok(path.to_path_buf())
}

fn key(rel: &Path) -> String {
    rel.components()
        .map(|c| c.as_os_str().to_string_lossy())
        .collect::<Vec<_>>()
        .join("/")
}

/// The files under `dir`, as paths relative to `write_dir`. A link to a file
/// counts as that file. Anything that cannot be copied (a link to a folder or to
/// nothing, an entry that cannot be read) is an error, because the folder is
/// deleted whole and would lose it with no copy.
fn files_under(write_dir: &Path, dir: &Path, out: &mut Vec<String>) -> Result<(), String> {
    let entries =
        std::fs::read_dir(dir).map_err(|e| format!("could not read {}: {e}", dir.display()))?;
    let mut paths: Vec<PathBuf> = Vec::new();
    for entry in entries {
        let entry = entry.map_err(|e| format!("could not read {}: {e}", dir.display()))?;
        paths.push(entry.path());
    }
    paths.sort();
    for path in paths {
        let meta = std::fs::symlink_metadata(&path)
            .map_err(|e| format!("could not read {}: {e}", path.display()))?;
        if meta.is_dir() {
            files_under(write_dir, &path, out)?;
        } else if std::fs::metadata(&path).is_ok_and(|m| m.is_file()) {
            out.push(key(path.strip_prefix(write_dir).unwrap_or(&path)));
        } else {
            return Err(format!(
                "{} cannot be copied to the backup, so nothing was removed",
                path.display()
            ));
        }
    }
    Ok(())
}

/// Delete `files` and the whole of `folders` under `write_dir`, after copying
/// them to a new folder under `backup_root`.
pub fn remove(
    write_dir: &Path,
    files: &[String],
    folders: &[String],
    label: Option<&str>,
    backup_root: &Path,
) -> Result<Removed, String> {
    if files.is_empty() {
        return Err("no widget to remove".to_string());
    }
    let mut copy: Vec<String> = Vec::new();
    for rel in files {
        let path = checked(rel, 3)?;
        if !path
            .extension()
            .is_some_and(|e| e.to_string_lossy().eq_ignore_ascii_case("lua"))
        {
            return Err(format!("{rel} is not a .lua file"));
        }
        let meta = std::fs::symlink_metadata(write_dir.join(&path))
            .map_err(|e| format!("could not read {rel}: {e}"))?;
        if meta.is_dir() {
            return Err(format!("{rel} is a folder"));
        }
        copy.push(key(&path));
    }
    for rel in folders {
        let path = checked(rel, 3)?;
        let meta = std::fs::symlink_metadata(write_dir.join(&path))
            .map_err(|e| format!("could not read {rel}: {e}"))?;
        // A link to a folder is not a folder of the widget's own.
        if !meta.is_dir() {
            return Err(format!("{rel} is not a folder"));
        }
        files_under(write_dir, &write_dir.join(&path), &mut copy)?;
    }
    copy.sort();
    copy.dedup();
    let paths: Vec<&str> = copy.iter().map(String::as_str).collect();
    let backup = back_up_files(write_dir, backup_root, label, "removed", &paths)?;

    let gone = |e: &std::io::Error| e.kind() == std::io::ErrorKind::NotFound;
    let failed = |what: &Path, e: std::io::Error| {
        format!(
            "could not remove {}: {e}. What was there is copied to {}",
            what.display(),
            backup.display()
        )
    };
    for rel in files {
        let path = write_dir.join(rel);
        if let Err(e) = std::fs::remove_file(&path) {
            if !gone(&e) {
                return Err(failed(&path, e));
            }
        }
    }
    for rel in folders {
        let path = write_dir.join(rel);
        if let Err(e) = std::fs::remove_dir_all(&path) {
            if !gone(&e) {
                return Err(failed(&path, e));
            }
        }
    }
    Ok(Removed {
        files: copy,
        backup: backup.to_string_lossy().to_string(),
    })
}

/// Copy a removed widget's files back from `backup`, a folder directly under
/// `backup_root` that [`remove`] made for this `write_dir`. Writes nothing when
/// any of the files is back already.
pub fn restore(write_dir: &Path, backup: &Path, backup_root: &Path) -> Result<Vec<String>, String> {
    if !write_dir.is_dir() {
        return Err(format!("{} is not a folder", write_dir.display()));
    }
    let root = backup_root
        .canonicalize()
        .map_err(|e| format!("could not read {}: {e}", backup_root.display()))?;
    let backup = backup
        .canonicalize()
        .map_err(|e| format!("could not read {}: {e}", backup.display()))?;
    if backup.parent() != Some(root.as_path()) {
        return Err(format!("{} is not a widget backup", backup.display()));
    }
    let manifest = std::fs::read(backup.join("backup.json")).map_err(|e| {
        format!(
            "could not read {}: {e}",
            backup.join("backup.json").display()
        )
    })?;
    let manifest: serde_json::Value =
        serde_json::from_slice(&manifest).map_err(|e| format!("backup.json is not valid: {e}"))?;
    if manifest["reason"] != "removed" {
        return Err("only a backup of a removed widget can be restored".to_string());
    }
    if manifest["writeDir"].as_str() != Some(write_dir.to_string_lossy().as_ref()) {
        return Err("that backup was made from another widget folder".to_string());
    }
    let mut files = Vec::new();
    files_under(&backup.join("files"), &backup.join("files"), &mut files)?;
    if files.is_empty() {
        return Err("the backup holds no files".to_string());
    }
    let mut taken = Vec::new();
    for rel in &files {
        let path = checked(rel, 3)?;
        if std::fs::symlink_metadata(write_dir.join(&path)).is_ok() {
            taken.push(rel.as_str());
        }
    }
    if !taken.is_empty() {
        return Err(format!(
            "already there, so nothing was restored: {}",
            taken.join(", ")
        ));
    }
    let mut made: Vec<PathBuf> = Vec::new();
    for rel in &files {
        let to = write_dir.join(rel);
        if let Err(e) = copy_file(&backup.join("files").join(rel), &to) {
            for path in &made {
                let _ = std::fs::remove_file(path);
            }
            return Err(e);
        }
        made.push(to);
    }
    Ok(files)
}

/// `content_widget_delete`, remove widget `files` and the `folders` that hold
/// only them, keeping a copy in the widget backups.
#[tauri::command]
pub(crate) async fn content_widget_delete<R: Runtime>(
    app: AppHandle<R>,
    write_dir: String,
    files: Vec<String>,
    folders: Vec<String>,
    label: Option<String>,
) -> CliResult {
    if let Err(e) = coilbox_portable::refuse_read_only(Path::new(&write_dir)) {
        return CliResult::err(e);
    }
    let backups = match coilbox_portable::data_dir(&app) {
        Ok(d) => d.join(BACKUPS),
        Err(e) => return CliResult::err(e),
    };
    let res = tauri::async_runtime::spawn_blocking(move || {
        remove(
            Path::new(&write_dir),
            &files,
            &folders,
            label.as_deref(),
            &backups,
        )
    })
    .await;
    match res {
        Ok(Ok(removed)) => CliResult::ok(json!(removed)),
        Ok(Err(e)) => CliResult::err(e),
        Err(e) => CliResult::err(format!("widget remove task failed: {e}")),
    }
}

/// `content_widget_restore`, put back the files a removal copied to `backup`.
#[tauri::command]
pub(crate) async fn content_widget_restore<R: Runtime>(
    app: AppHandle<R>,
    write_dir: String,
    backup: String,
) -> CliResult {
    if let Err(e) = coilbox_portable::refuse_read_only(Path::new(&write_dir)) {
        return CliResult::err(e);
    }
    let backups = match coilbox_portable::data_dir(&app) {
        Ok(d) => d.join(BACKUPS),
        Err(e) => return CliResult::err(e),
    };
    let res = tauri::async_runtime::spawn_blocking(move || {
        restore(Path::new(&write_dir), Path::new(&backup), &backups)
    })
    .await;
    match res {
        Ok(Ok(files)) => CliResult::ok(json!(files)),
        Ok(Err(e)) => CliResult::err(e),
        Err(e) => CliResult::err(format!("widget restore task failed: {e}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn put(dir: &Path, rel: &str, text: &str) {
        let path = dir.join(rel);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, text).unwrap();
    }

    fn setup() -> (tempfile::TempDir, PathBuf, PathBuf) {
        let tmp = tempfile::tempdir().unwrap();
        let (write, backups) = (tmp.path().join("write"), tmp.path().join("backups"));
        std::fs::create_dir_all(&write).unwrap();
        (tmp, write, backups)
    }

    fn strings(list: &[&str]) -> Vec<String> {
        list.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn a_widget_file_is_copied_to_the_backups_then_deleted() {
        let (_tmp, write, backups) = setup();
        put(&write, "LuaUI/Widgets/gui_a.lua", "a");
        put(&write, "LuaUI/Widgets/gui_b.lua", "b");
        let out = remove(
            &write,
            &strings(&["LuaUI/Widgets/gui_a.lua"]),
            &[],
            Some("Widget A"),
            &backups,
        )
        .unwrap();
        assert_eq!(out.files, vec!["LuaUI/Widgets/gui_a.lua"]);
        assert!(!write.join("LuaUI/Widgets/gui_a.lua").exists());
        assert!(write.join("LuaUI/Widgets/gui_b.lua").is_file());
        let backup = PathBuf::from(&out.backup);
        assert!(backup.starts_with(&backups));
        assert!(backup
            .file_name()
            .unwrap()
            .to_string_lossy()
            .ends_with("widget-a"));
        assert_eq!(
            std::fs::read_to_string(backup.join("files/LuaUI/Widgets/gui_a.lua")).unwrap(),
            "a"
        );
        let manifest: serde_json::Value =
            serde_json::from_slice(&std::fs::read(backup.join("backup.json")).unwrap()).unwrap();
        assert_eq!(manifest["reason"], "removed");
    }

    #[test]
    fn a_subfolder_goes_with_its_helpers_and_the_other_folders_stay() {
        let (_tmp, write, backups) = setup();
        put(&write, "LuaUI/Widgets/Pack/gui_p.lua", "p");
        put(&write, "LuaUI/Widgets/Pack/lib/helper.lua", "h");
        put(&write, "LuaUI/Widgets/Pack/data.txt", "d");
        put(&write, "LuaUI/Widgets/Other/gui_o.lua", "o");
        put(&write, "LuaUI/Widgets_TAP/Pack/gui_p.lua", "p");
        let out = remove(
            &write,
            &strings(&["LuaUI/Widgets/Pack/gui_p.lua"]),
            &strings(&["LuaUI/Widgets/Pack"]),
            None,
            &backups,
        )
        .unwrap();
        assert_eq!(
            out.files,
            vec![
                "LuaUI/Widgets/Pack/data.txt",
                "LuaUI/Widgets/Pack/gui_p.lua",
                "LuaUI/Widgets/Pack/lib/helper.lua",
            ]
        );
        assert!(!write.join("LuaUI/Widgets/Pack").exists());
        assert!(write.join("LuaUI/Widgets").is_dir());
        assert!(write.join("LuaUI/Widgets/Other/gui_o.lua").is_file());
        assert!(write.join("LuaUI/Widgets_TAP/Pack/gui_p.lua").is_file());
        assert!(PathBuf::from(&out.backup)
            .join("files/LuaUI/Widgets/Pack/lib/helper.lua")
            .is_file());
    }

    #[test]
    fn paths_outside_the_widget_folders_are_refused_and_nothing_is_removed() {
        let (_tmp, write, backups) = setup();
        put(&write, "LuaUI/Widgets/gui_a.lua", "a");
        put(&write, "LuaUI/Config/BYAR.lua", "c");
        put(&write, "other.lua", "o");
        for bad in [
            "LuaUI/Config",
            "LuaUI/../other.lua",
            "../outside.lua",
            "/etc/hosts",
            "other.lua",
            "Other/Widgets/gui_a.lua",
        ] {
            let files = strings(&["LuaUI/Widgets/gui_a.lua", bad]);
            assert!(
                remove(&write, &files, &[], None, &backups).is_err(),
                "{bad}"
            );
        }
        let folders = strings(&["LuaUI/Config"]);
        let files = strings(&["LuaUI/Widgets/gui_a.lua"]);
        assert!(remove(&write, &files, &folders, None, &backups).is_err());
        assert!(write.join("LuaUI/Widgets/gui_a.lua").is_file());
        assert!(write.join("LuaUI/Config/BYAR.lua").is_file());
        assert!(!backups.exists());
    }

    #[test]
    fn only_lua_files_and_real_folders_are_taken() {
        let (_tmp, write, backups) = setup();
        put(&write, "LuaUI/Widgets/readme.txt", "r");
        put(&write, "LuaUI/Widgets/Pack/gui_p.lua", "p");
        let txt = strings(&["LuaUI/Widgets/readme.txt"]);
        assert!(remove(&write, &txt, &[], None, &backups).is_err());
        let dir = strings(&["LuaUI/Widgets/Pack"]);
        assert!(remove(&write, &dir, &[], None, &backups).is_err());
        let file = strings(&["LuaUI/Widgets/Pack/gui_p.lua"]);
        assert!(remove(&write, &file, &file, None, &backups).is_err());
        assert!(write.join("LuaUI/Widgets/readme.txt").is_file());
        assert!(write.join("LuaUI/Widgets/Pack/gui_p.lua").is_file());
        assert!(!backups.exists());
    }

    #[cfg(unix)]
    #[test]
    fn a_folder_holding_something_that_cannot_be_copied_is_not_removed() {
        let (tmp, write, backups) = setup();
        put(&write, "LuaUI/Widgets/Pack/gui_p.lua", "p");
        let elsewhere = tmp.path().join("elsewhere");
        std::fs::create_dir_all(&elsewhere).unwrap();
        std::os::unix::fs::symlink(&elsewhere, write.join("LuaUI/Widgets/Pack/linked")).unwrap();
        let err = remove(
            &write,
            &strings(&["LuaUI/Widgets/Pack/gui_p.lua"]),
            &strings(&["LuaUI/Widgets/Pack"]),
            None,
            &backups,
        )
        .unwrap_err();
        assert!(err.contains("linked"), "{err}");
        assert!(write.join("LuaUI/Widgets/Pack/gui_p.lua").is_file());
        assert!(!backups.exists());
    }

    #[test]
    fn coilboxs_own_widget_is_not_removed() {
        let (_tmp, write, backups) = setup();
        put(&write, "LuaUI/Widgets/coilbox_blueprints.lua", "w");
        put(&write, "LuaUI/coilbox_blueprints/lib.lua", "l");
        for (files, folders) in [
            (strings(&["LuaUI/Widgets/coilbox_blueprints.lua"]), vec![]),
            (
                strings(&["LuaUI/Widgets/coilbox_blueprints.lua"]),
                strings(&["LuaUI/coilbox_blueprints/lib"]),
            ),
        ] {
            let err = remove(&write, &files, &folders, None, &backups).unwrap_err();
            assert!(err.contains("coilbox's own widget"), "{err}");
        }
        assert!(write.join("LuaUI/Widgets/coilbox_blueprints.lua").is_file());
    }

    #[test]
    fn a_widget_comes_back_where_it_was() {
        let (_tmp, write, backups) = setup();
        put(&write, "LuaUI/Widgets/Pack/gui_p.lua", "p");
        put(&write, "LuaUI/Widgets/Pack/lib/helper.lua", "h");
        let out = remove(
            &write,
            &strings(&["LuaUI/Widgets/Pack/gui_p.lua"]),
            &strings(&["LuaUI/Widgets/Pack"]),
            None,
            &backups,
        )
        .unwrap();
        let back = restore(&write, Path::new(&out.backup), &backups).unwrap();
        assert_eq!(back.len(), 2);
        assert_eq!(
            std::fs::read_to_string(write.join("LuaUI/Widgets/Pack/lib/helper.lua")).unwrap(),
            "h"
        );
        // The backup stays, and a second restore finds everything there.
        assert!(PathBuf::from(&out.backup).is_dir());
        assert!(restore(&write, Path::new(&out.backup), &backups)
            .unwrap_err()
            .contains("already there"));
    }

    #[test]
    fn a_restore_that_would_overwrite_writes_nothing() {
        let (_tmp, write, backups) = setup();
        put(&write, "LuaUI/Widgets/a.lua", "a");
        put(&write, "LuaUI/Widgets/b.lua", "b");
        let out = remove(
            &write,
            &strings(&["LuaUI/Widgets/a.lua", "LuaUI/Widgets/b.lua"]),
            &[],
            None,
            &backups,
        )
        .unwrap();
        put(&write, "LuaUI/Widgets/b.lua", "newer");
        let err = restore(&write, Path::new(&out.backup), &backups).unwrap_err();
        assert!(err.contains("LuaUI/Widgets/b.lua"));
        assert!(!write.join("LuaUI/Widgets/a.lua").exists());
        assert_eq!(
            std::fs::read_to_string(write.join("LuaUI/Widgets/b.lua")).unwrap(),
            "newer"
        );
    }

    #[test]
    fn only_a_removal_backup_made_here_can_be_restored() {
        let (tmp, write, backups) = setup();
        put(&write, "LuaUI/Widgets/a.lua", "a");
        // A backup of a replaced file, which restoring would clobber with.
        let replaced =
            back_up_files(&write, &backups, None, "replaced", &["LuaUI/Widgets/a.lua"]).unwrap();
        assert!(restore(&write, &replaced, &backups)
            .unwrap_err()
            .contains("removed widget"));
        // A folder that is not in the backups.
        let stray = tmp.path().join("stray");
        put(&stray, "backup.json", r#"{"reason":"removed"}"#);
        put(&stray, "files/LuaUI/Widgets/x.lua", "x");
        assert!(restore(&write, &stray, &backups)
            .unwrap_err()
            .contains("not a widget backup"));
        // A removal from another write folder.
        let other = tmp.path().join("other");
        std::fs::create_dir_all(&other).unwrap();
        put(&other, "LuaUI/Widgets/o.lua", "o");
        let out = remove(
            &other,
            &strings(&["LuaUI/Widgets/o.lua"]),
            &[],
            None,
            &backups,
        )
        .unwrap();
        assert!(restore(&write, Path::new(&out.backup), &backups)
            .unwrap_err()
            .contains("another widget folder"));
    }
}
