//! The widget files a player has added under the engine's write folder (issue
//! #1284).
//!
//! Each game's widget handler reads its own folders under `LuaUI/` (the list of
//! which lives in `src/widgets/handlers.ts`). This lists every `.lua` file in
//! the folders the caller names, directly and one subfolder down, and reads
//! each one's `GetInfo()` in the `coilbox-springlua` sandbox. Which games load
//! which file is the frontend's to work out from that.
//!
//! Folder names are matched without regard to case, and every spelling on disk
//! is listed as its own folder. On a filesystem that folds case there is only
//! ever one. On one that does not, `Widgets/` and `widgets/` can both be there,
//! and a handler reads only the one it spells, so the caller needs both.

use picoframe_core::CliResult;
use serde::Serialize;
use serde_json::json;
use std::path::{Path, PathBuf};

use crate::widget::widget_owned;

/// The engine's own spelling of the folder every handler's folders sit under.
const LUAUI: &str = "luaui";

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WidgetFile {
    /// Relative to the write folder, with forward slashes, spelled as on disk.
    pub path: String,
    /// The scanned folder it is in or under, relative to the write folder and
    /// spelled as on disk, for example `LuaUI/Widgets`.
    pub folder: String,
    /// In a subfolder of [`folder`](Self::folder) rather than directly in it.
    pub nested: bool,
    /// Coilbox's own blueprint widget.
    pub coilbox: bool,
    /// The file calls `Spring.GiveOrder` or one of its siblings (issue #1292).
    pub gives_orders: bool,
    pub info: Option<coilbox_springlua::WidgetInfo>,
    /// Why the file's `GetInfo()` could not be read. Set exactly when `info` is
    /// not.
    pub error: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WidgetScan {
    /// Whether this filesystem tells `Widgets` and `widgets` apart.
    pub case_sensitive: bool,
    /// The scanned folders that exist, relative to the write folder and spelled
    /// as on disk.
    pub folders: Vec<String>,
    pub files: Vec<WidgetFile>,
    /// Folders that are there and could not be read.
    pub errors: Vec<String>,
}

fn key(rel: &Path) -> String {
    rel.to_string_lossy().replace('\\', "/")
}

/// The entries of `dir`, sorted. A folder that is not there is empty. One that
/// is there and cannot be read says so in `errors`, so its widgets do not
/// vanish from the list without a word.
fn entries(dir: &Path, errors: &mut Vec<String>) -> Vec<PathBuf> {
    match std::fs::read_dir(dir) {
        Ok(entries) => {
            let mut out: Vec<PathBuf> = entries.flatten().map(|e| e.path()).collect();
            out.sort();
            out
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Vec::new(),
        Err(e) => {
            errors.push(format!("could not read {}: {e}", dir.display()));
            Vec::new()
        }
    }
}

/// The child folders of `dir` whose names fold to one of `names`, as they are
/// spelled.
fn children_named(dir: &Path, names: &[String], errors: &mut Vec<String>) -> Vec<PathBuf> {
    entries(dir, errors)
        .into_iter()
        .filter(|p| p.is_dir())
        .filter(|p| {
            p.file_name()
                .map(|n| n.to_string_lossy().to_lowercase())
                .is_some_and(|n| names.contains(&n))
        })
        .collect()
}

fn lua_files(dir: &Path, errors: &mut Vec<String>) -> Vec<PathBuf> {
    entries(dir, errors)
        .into_iter()
        .filter(|p| p.is_file())
        .filter(|p| {
            p.extension()
                .is_some_and(|e| e.to_string_lossy().eq_ignore_ascii_case("lua"))
        })
        .collect()
}

fn subfolders(dir: &Path, errors: &mut Vec<String>) -> Vec<PathBuf> {
    entries(dir, errors)
        .into_iter()
        .filter(|p| p.is_dir())
        .collect()
}

/// Whether two paths name one file. By device and inode where there are such
/// things, because two folders whose names differ only in case can both exist
/// on a filesystem that tells them apart.
#[cfg(unix)]
fn same_file(a: &Path, b: &Path) -> bool {
    use std::os::unix::fs::MetadataExt;
    match (std::fs::metadata(a), std::fs::metadata(b)) {
        (Ok(a), Ok(b)) => a.dev() == b.dev() && a.ino() == b.ino(),
        _ => false,
    }
}

/// Elsewhere by the path each one resolves to, which on Windows is spelled as
/// on disk, so a folder set to tell case apart is not taken for its sibling.
#[cfg(not(unix))]
fn same_file(a: &Path, b: &Path) -> bool {
    match (std::fs::canonicalize(a), std::fs::canonicalize(b)) {
        (Ok(a), Ok(b)) => a == b,
        _ => false,
    }
}

/// Whether `dir`'s filesystem tells names apart by case, found by asking for
/// `dir` under its own name in the other case and checking whether that is
/// `dir` itself. A name with no letters to swap cannot answer, so that falls
/// back to the platform's usual filesystem.
fn case_sensitive(dir: &Path) -> bool {
    let name = dir.file_name().map(|n| n.to_string_lossy().to_string());
    let swapped = name.as_ref().map(|name| {
        name.chars()
            .map(|c| {
                if c.is_lowercase() {
                    c.to_uppercase().next().unwrap_or(c)
                } else {
                    c.to_lowercase().next().unwrap_or(c)
                }
            })
            .collect::<String>()
    });
    match (swapped, dir.parent()) {
        (Some(swapped), Some(parent)) if Some(&swapped) != name.as_ref() => {
            !same_file(dir, &parent.join(swapped))
        }
        _ => cfg!(target_os = "linux"),
    }
}

/// Read one file. `None` for a file in a subfolder that runs and declares
/// nothing, because that is a helper a widget includes rather than a widget.
/// Directly in a widget folder, a handler tries to load every file, so one
/// with no `GetInfo` is listed as a widget that will not load.
fn read_file(
    write_dir: &Path,
    luaui: &Path,
    folder: &str,
    path: &Path,
    nested: bool,
) -> Option<WidgetFile> {
    let rel = path.strip_prefix(write_dir).map(key).unwrap_or_default();
    let under_luaui = path.strip_prefix(luaui).map(key).unwrap_or_default();
    let mut gives_orders = false;
    let read = match std::fs::read(path) {
        Ok(bytes) => {
            let src = String::from_utf8_lossy(&bytes);
            gives_orders = coilbox_springlua::gives_orders(&src);
            coilbox_springlua::SpringLua::new(write_dir)
                .map_err(|e| e.to_string())
                .and_then(|lua| lua.widget_info(&src, &rel))
        }
        Err(e) => Err(format!("could not read the file: {e}")),
    };
    let (info, error) = match read {
        Ok(Some(info)) => (Some(info), None),
        Ok(None) if nested => return None,
        Ok(None) => (
            None,
            Some("the file defines no GetInfo function".to_string()),
        ),
        Err(e) => (None, Some(e)),
    };
    Some(WidgetFile {
        path: rel,
        folder: folder.to_string(),
        nested,
        coilbox: widget_owned(&under_luaui),
        gives_orders,
        info,
        error,
    })
}

/// List and read every widget file in `folders` (names under `LuaUI/`, any
/// case) of `write_dir`.
pub fn scan(write_dir: &Path, folders: &[String]) -> WidgetScan {
    let names: Vec<String> = folders.iter().map(|f| f.to_lowercase()).collect();
    let mut errors = Vec::new();
    let mut scanned = Vec::new();
    let mut files = Vec::new();
    for luaui in children_named(write_dir, &[LUAUI.to_string()], &mut errors) {
        for dir in children_named(&luaui, &names, &mut errors) {
            let folder = dir.strip_prefix(write_dir).map(key).unwrap_or_default();
            for path in lua_files(&dir, &mut errors) {
                files.extend(read_file(write_dir, &luaui, &folder, &path, false));
            }
            for sub in subfolders(&dir, &mut errors) {
                for path in lua_files(&sub, &mut errors) {
                    files.extend(read_file(write_dir, &luaui, &folder, &path, true));
                }
            }
            scanned.push(folder);
        }
    }
    // A folder is listed once for its files and once for its subfolders, so
    // one that cannot be read says so twice in a row.
    errors.dedup();
    WidgetScan {
        case_sensitive: case_sensitive(write_dir),
        folders: scanned,
        files,
        errors,
    }
}

/// `content_player_widgets`, every widget file in the named `LuaUI/` folders of
/// the engine's write folder, with what each one's `GetInfo()` declares.
#[tauri::command]
pub(crate) async fn content_player_widgets(write_dir: String, folders: Vec<String>) -> CliResult {
    let res =
        tauri::async_runtime::spawn_blocking(move || scan(Path::new(&write_dir), &folders)).await;
    match res {
        Ok(r) => CliResult::ok(json!(r)),
        Err(e) => CliResult::err(format!("widget scan task failed: {e}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "coilbox-player-widgets-{}-{tag}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("temp dir");
        dir
    }

    fn write(dir: &Path, rel: &str, text: &str) {
        let path = dir.join(rel);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, text).unwrap();
    }

    fn names() -> Vec<String> {
        vec!["widgets".into(), "rmlwidgets".into(), "addons".into()]
    }

    #[test]
    fn lists_direct_and_nested_files_with_their_info() {
        let dir = temp_dir("nested");
        write(
            &dir,
            "LuaUI/Widgets/a.lua",
            r#"function widget:GetInfo() return { name = "A" } end"#,
        );
        write(
            &dir,
            "LuaUI/Widgets/pack/b.lua",
            r#"function widget:GetInfo() return { name = "B" } end"#,
        );
        write(
            &dir,
            "LuaUI/Widgets/pack/helper.lua",
            "local M = {} return M",
        );
        write(&dir, "LuaUI/Widgets/plain.lua", "local x = 1");
        write(&dir, "LuaUI/Widgets/readme.txt", "not a widget");
        write(&dir, "LuaUI/Config/x.lua", "return {}");
        let scan = scan(&dir, &names());
        assert_eq!(scan.folders, vec!["LuaUI/Widgets"]);
        assert!(scan.errors.is_empty());
        let plain = scan.files.iter().find(|f| f.path.ends_with("plain.lua"));
        assert_eq!(
            plain.and_then(|f| f.error.as_deref()),
            Some("the file defines no GetInfo function")
        );
        let got: Vec<_> = scan
            .files
            .iter()
            .map(|f| {
                (
                    f.path.as_str(),
                    f.nested,
                    f.info.as_ref().and_then(|i| i.name.clone()),
                )
            })
            .collect();
        assert_eq!(
            got,
            vec![
                ("LuaUI/Widgets/a.lua", false, Some("A".to_string())),
                ("LuaUI/Widgets/plain.lua", false, None),
                ("LuaUI/Widgets/pack/b.lua", true, Some("B".to_string())),
            ]
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn reports_a_widget_that_gives_orders_and_one_that_declares_control() {
        let dir = temp_dir("orders");
        write(
            &dir,
            "LuaUI/Widgets/orders.lua",
            "function widget:GetInfo() return { name = \"Orders\" } end\nSpring.GiveOrder(1, {}, 0)",
        );
        write(
            &dir,
            "LuaUI/Widgets/declared.lua",
            "function widget:GetInfo() return { name = \"Declared\", control = true } end",
        );
        let scan = scan(&dir, &names());
        let find = |name: &str| {
            scan.files
                .iter()
                .find(|f| f.info.as_ref().and_then(|i| i.name.as_deref()) == Some(name))
                .unwrap()
        };
        assert!(find("Orders").gives_orders);
        assert_eq!(find("Orders").info.as_ref().unwrap().control, None);
        assert!(!find("Declared").gives_orders);
        assert_eq!(find("Declared").info.as_ref().unwrap().control, Some(true));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[cfg(unix)]
    #[test]
    fn two_folders_are_not_one_because_both_exist() {
        let dir = temp_dir("same");
        std::fs::create_dir_all(dir.join("one")).unwrap();
        std::fs::create_dir_all(dir.join("two")).unwrap();
        assert!(same_file(&dir.join("one"), &dir.join("one")));
        assert!(!same_file(&dir.join("one"), &dir.join("two")));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_broken_file_is_listed_with_its_error() {
        let dir = temp_dir("broken");
        write(&dir, "LuaUI/Widgets/bad.lua", "this is not lua");
        let scan = scan(&dir, &names());
        assert_eq!(scan.files.len(), 1);
        assert!(scan.files[0].info.is_none());
        assert!(scan.files[0].error.is_some());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn marks_coilboxs_own_widget() {
        let dir = temp_dir("coilbox");
        write(
            &dir,
            "LuaUI/Widgets/coilbox_blueprints.lua",
            r#"function widget:GetInfo() return { name = "Blueprints" } end"#,
        );
        write(
            &dir,
            "LuaUI/Widgets/other.lua",
            r#"function widget:GetInfo() return { name = "Other" } end"#,
        );
        let scan = scan(&dir, &names());
        let marks: Vec<_> = scan
            .files
            .iter()
            .map(|f| (f.path.as_str(), f.coilbox))
            .collect();
        assert_eq!(
            marks,
            vec![
                ("LuaUI/Widgets/coilbox_blueprints.lua", true),
                ("LuaUI/Widgets/other.lua", false)
            ]
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_missing_luaui_folder_is_an_empty_list() {
        let dir = temp_dir("empty");
        let scan = scan(&dir, &names());
        assert!(scan.folders.is_empty());
        assert!(scan.files.is_empty());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
