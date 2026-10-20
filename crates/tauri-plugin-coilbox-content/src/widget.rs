//! Installing the blueprint widget into a content root (issue #1419).
//!
//! The widget is coilbox-authored Lua kept in this repo under
//! `lua/blueprint-widget/` and shipped as a bundle resource. Its `luaui/` tree
//! goes into `<content root>/LuaUI/`, which every engine coilbox launches reads,
//! so it is installed once rather than once per engine. Nothing here runs on
//! its own: the player presses the button, and an update is the same button
//! again when what is installed no longer matches what coilbox ships.
//!
//! "Matches" is byte equality with the bundled files. There is no version
//! number to get out of step with the files it is meant to describe.

use picoframe_core::CliResult;
use serde_json::json;
use std::ffi::OsStr;
use std::path::{Component, Path, PathBuf};
use tauri::{AppHandle, Manager, Runtime};

/// The tree under the widget's source directory that is installed. `tests/`
/// and the README sit beside it and never are.
const VENDORED: &str = "luaui";

/// Where the tree lands under the content root, spelled the way the engine's
/// own `cont/LuaUI` spells it.
const DEST: &str = "LuaUI";

/// The folder under `LuaUI/` that holds the licence notice for coilbox's Lua
/// (issue #4005), named as the folder written into a game by the mission runtime
/// install. The name carries `coilbox` so it cannot be taken for anything
/// else's licence. The folder is coilbox's outright: an install rewrites every
/// file in it and removes any other, and a removal takes it.
const NOTICE_DIR: &str = "coilbox-licence";

/// What goes in [`NOTICE_DIR`], as the file name and its contents. Embedded from
/// the files in the repo so the licence texts are copied byte for byte, and a
/// dev run writes the same bytes as a packaged one.
const NOTICE_FILES: [(&str, &[u8]); 3] = [
    ("NOTICE.md", include_bytes!("../../../lua/GAME-NOTICE.md")),
    ("LICENSE-MIT", include_bytes!("../../../LICENSE")),
    ("COPYING", include_bytes!("../../../lua/COPYING")),
];

/// Where the widget can sit inside the resource directory, in the order they
/// are tried. The same shapes the mission runtime is probed under.
const CANDIDATES: [&str; 4] = [
    ".coilbox/resources/blueprint-widget",
    "blueprint-widget",
    "lua/blueprint-widget",
    "_up_/lua/blueprint-widget",
];

/// The first [`CANDIDATES`] entry under `resource_dir` that is a directory.
pub fn bundled_widget_dir(resource_dir: &Path, is_dir: impl Fn(&Path) -> bool) -> Option<PathBuf> {
    CANDIDATES
        .into_iter()
        .map(|rel| resource_dir.join(rel))
        .find(|path| is_dir(path))
}

/// Under `tauri dev` there are no resources beside the binary, so a debug
/// build falls back to the source tree.
pub fn source_tree_widget_dir() -> Option<PathBuf> {
    if !cfg!(debug_assertions) {
        return None;
    }
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../lua/blueprint-widget")
        .canonicalize()
        .ok()
        .filter(|dir| dir.is_dir())
}

/// What is on disk against what coilbox ships.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WidgetStatus {
    /// Any of the widget's files are there.
    pub installed: bool,
    /// Every shipped file is there with the same bytes, so there is nothing to
    /// update.
    pub current: bool,
    /// Shipped files, relative to `LuaUI/`, in the spelling coilbox ships.
    pub files: Vec<String>,
    /// Shipped files that are not installed, or differ.
    pub stale: Vec<String>,
}

/// Whether a path under `LuaUI/` is the widget's to write and remove: its own
/// module directory, and its widget files. `Config/coilbox_blueprints*.json`
/// shares the name and is data, the library coilbox writes and the spool the
/// widget writes, and neither is an install's to touch.
fn widget_owned(rel: &str) -> bool {
    let lower = rel.to_lowercase();
    lower.starts_with("coilbox_blueprints/")
        || (lower.starts_with("widgets/")
            && lower.rsplit('/').next().is_some_and(|name| {
                name.starts_with("coilbox_blueprints") && name.ends_with(".lua")
            }))
}

fn key(rel: &Path) -> String {
    rel.to_string_lossy().replace('\\', "/")
}

/// Every file under `dir`, relative to it, sorted, with forward slashes.
fn files_under(dir: &Path) -> Vec<String> {
    fn walk(root: &Path, at: &Path, out: &mut Vec<String>) {
        let Ok(entries) = std::fs::read_dir(at) else {
            return;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                walk(root, &path, out);
            } else if let Ok(rel) = path.strip_prefix(root) {
                out.push(key(rel));
            }
        }
    }
    let mut out = Vec::new();
    walk(dir, dir, &mut out);
    out.sort();
    out
}

/// The shipped files, relative to the vendored tree.
pub fn shipped_files(src: &Path) -> Vec<String> {
    files_under(&src.join(VENDORED))
}

/// `rel` under `root`, each component spelled the way `root` already spells
/// it when a directory of that name is there in another case. A content root
/// that already has a `luaui/` takes the widget rather than growing a second
/// `LuaUI/` beside it on a case-sensitive filesystem.
fn resolve_case(root: &Path, rel: &Path) -> PathBuf {
    let mut at = root.to_path_buf();
    for component in rel.components() {
        let Component::Normal(name) = component else {
            continue;
        };
        let wanted = name.to_string_lossy().to_lowercase();
        let existing = std::fs::read_dir(&at).ok().and_then(|entries| {
            entries
                .flatten()
                .map(|e| e.file_name())
                .find(|have| have.to_string_lossy().to_lowercase() == wanted)
        });
        at = at.join(existing.unwrap_or_else(|| name.to_os_string()));
    }
    at
}

/// Where the widget's `LuaUI/` sits under `root`, in whatever case is there.
fn dest_tree(root: &Path) -> PathBuf {
    resolve_case(root, Path::new(DEST))
}

/// Compare what is installed under `root` with what `src` ships.
pub fn status(src: &Path, root: &Path) -> WidgetStatus {
    let files = shipped_files(src);
    let dest = dest_tree(root);
    let mut stale = Vec::new();
    let mut installed = false;
    for rel in &files {
        let to = resolve_case(&dest, Path::new(rel));
        match (
            std::fs::read(src.join(VENDORED).join(rel)),
            std::fs::read(&to),
        ) {
            (Ok(want), Ok(have)) => {
                installed = true;
                if want != have {
                    stale.push(rel.clone());
                }
            }
            _ => stale.push(rel.clone()),
        }
    }
    let notice = resolve_case(&dest, Path::new(NOTICE_DIR));
    for (name, bytes) in NOTICE_FILES {
        if std::fs::read(notice.join(name)).ok().as_deref() != Some(bytes) {
            stale.push(format!("{NOTICE_DIR}/{name}"));
        }
    }
    if !installed {
        installed = files_under(&dest).iter().any(|rel| widget_owned(rel));
    }
    WidgetStatus {
        installed,
        current: installed && stale.is_empty(),
        files,
        stale,
    }
}

/// Copy the widget into `root`, then drop any of its own files an older
/// install left behind. Returns the files written, relative to `LuaUI/`.
pub fn install(src: &Path, root: &Path) -> Result<Vec<String>, String> {
    let files = shipped_files(src);
    if files.is_empty() {
        return Err(format!("no widget files to install from {}", src.display()));
    }
    if !root.is_dir() {
        return Err(format!("{} is not a directory", root.display()));
    }
    let dest = dest_tree(root);
    let mut written = Vec::new();
    for rel in &files {
        let to = resolve_case(&dest, Path::new(rel));
        if let Some(parent) = to.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("could not create {}: {e}", parent.display()))?;
        }
        std::fs::copy(src.join(VENDORED).join(rel), &to)
            .map_err(|e| format!("could not write {}: {e}", to.display()))?;
        written.push(rel.clone());
    }
    let shipped: Vec<String> = files.iter().map(|f| f.to_lowercase()).collect();
    for rel in files_under(&dest) {
        if widget_owned(&rel) && !shipped.contains(&rel.to_lowercase()) {
            let stale = dest.join(&rel);
            std::fs::remove_file(&stale)
                .map_err(|e| format!("could not remove {}: {e}", stale.display()))?;
        }
    }
    install_notice(&dest)?;
    Ok(written)
}

/// Write the licence notice into `dest` (the `LuaUI/` tree), and drop any file an
/// older notice left in the folder. Not part of the list [`install`] returns,
/// which is the widget's files.
fn install_notice(dest: &Path) -> Result<(), String> {
    let dir = resolve_case(dest, Path::new(NOTICE_DIR));
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("could not create {}: {e}", dir.display()))?;
    for (name, bytes) in NOTICE_FILES {
        let to = dir.join(name);
        std::fs::write(&to, bytes).map_err(|e| format!("could not write {}: {e}", to.display()))?;
    }
    if let Ok(entries) = std::fs::read_dir(&dir) {
        for entry in entries.flatten() {
            let name = entry.file_name();
            let path = entry.path();
            if path.is_file() && !NOTICE_FILES.iter().any(|(own, _)| OsStr::new(own) == name) {
                std::fs::remove_file(&path)
                    .map_err(|e| format!("could not remove {}: {e}", path.display()))?;
            }
        }
    }
    Ok(())
}

/// Remove every file the widget owns under `root`, and its own directory once
/// it is empty. The player's config files are not the widget's and stay.
pub fn remove(root: &Path) -> Result<Vec<String>, String> {
    let dest = dest_tree(root);
    let mut removed = Vec::new();
    for rel in files_under(&dest) {
        if widget_owned(&rel) {
            let path = dest.join(&rel);
            std::fs::remove_file(&path)
                .map_err(|e| format!("could not remove {}: {e}", path.display()))?;
            removed.push(rel);
        }
    }
    let notice = resolve_case(&dest, Path::new(NOTICE_DIR));
    for (name, _) in NOTICE_FILES {
        let _ = std::fs::remove_file(notice.join(name));
    }
    // Only when empty, so anything else in there stays.
    let _ = std::fs::remove_dir(&notice);
    let own_dir = resolve_case(&dest, Path::new("coilbox_blueprints"));
    if own_dir.is_dir() {
        // Only when empty: remove_dir refuses otherwise, and anything left in
        // there is not the widget's.
        let _ = std::fs::remove_dir(&own_dir);
    }
    Ok(removed)
}

/// Where the bundled blueprint widget lives, or a message when this build has
/// none to offer.
fn widget_dir<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    let bundled = app
        .path()
        .resource_dir()
        .ok()
        .and_then(|dir| bundled_widget_dir(&dir, |path| path.is_dir()));
    bundled
        .or_else(source_tree_widget_dir)
        .ok_or_else(|| "this build of coilbox does not carry the blueprint widget".to_string())
}

/// `content_widget_status`, what is installed under a content root against
/// what coilbox ships. `rootPath` is a `ContentRoot.path`.
#[tauri::command]
pub(crate) async fn content_widget_status<R: Runtime>(
    app: AppHandle<R>,
    root_path: String,
) -> CliResult {
    let src = match widget_dir(&app) {
        Ok(d) => d,
        Err(e) => return CliResult::err(e),
    };
    let res =
        tauri::async_runtime::spawn_blocking(move || status(&src, Path::new(&root_path))).await;
    match res {
        Ok(status) => CliResult::ok(json!(status)),
        Err(e) => CliResult::err(format!("widget status task failed: {e}")),
    }
}

/// `content_widget_install`, copy the blueprint widget into a content root's
/// `LuaUI/`. The same command updates one already there. Only ever run from the
/// button: coilbox never installs a widget on its own.
#[tauri::command]
pub(crate) async fn content_widget_install<R: Runtime>(
    app: AppHandle<R>,
    root_path: String,
) -> CliResult {
    if let Err(e) = coilbox_portable::refuse_read_only(Path::new(&root_path)) {
        return CliResult::err(e);
    }
    let src = match widget_dir(&app) {
        Ok(d) => d,
        Err(e) => return CliResult::err(e),
    };
    let res =
        tauri::async_runtime::spawn_blocking(move || install(&src, Path::new(&root_path))).await;
    match res {
        Ok(Ok(written)) => CliResult::ok(json!({ "written": written })),
        Ok(Err(e)) => CliResult::err(e),
        Err(e) => CliResult::err(format!("widget install task failed: {e}")),
    }
}

/// `content_widget_remove`, take the blueprint widget out of a content root.
/// The library file and the spool are data rather than the widget, and stay.
#[tauri::command]
pub(crate) async fn content_widget_remove(root_path: String) -> CliResult {
    if let Err(e) = coilbox_portable::refuse_read_only(Path::new(&root_path)) {
        return CliResult::err(e);
    }
    let res = tauri::async_runtime::spawn_blocking(move || remove(Path::new(&root_path))).await;
    match res {
        Ok(Ok(removed)) => CliResult::ok(json!({ "removed": removed })),
        Ok(Err(e)) => CliResult::err(e),
        Err(e) => CliResult::err(format!("widget remove task failed: {e}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("cbx-widget-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn write(path: &Path, text: &str) {
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, text).unwrap();
    }

    /// A widget source tree like the repo's, plus the things that must not be
    /// installed.
    fn source(tag: &str) -> PathBuf {
        let src = tmp(&format!("src-{tag}"));
        write(&src.join("luaui/widgets/coilbox_blueprints.lua"), "widget");
        write(&src.join("luaui/coilbox_blueprints/json.lua"), "json");
        write(&src.join("luaui/coilbox_blueprints/store.lua"), "store");
        write(&src.join("tests/json_test.lua"), "test");
        write(&src.join("README.md"), "readme");
        src
    }

    #[test]
    fn shipped_files_are_the_luaui_tree_only() {
        let src = source("shipped");
        assert_eq!(
            shipped_files(&src),
            vec![
                "coilbox_blueprints/json.lua",
                "coilbox_blueprints/store.lua",
                "widgets/coilbox_blueprints.lua",
            ]
        );
    }

    #[test]
    fn install_writes_under_luaui_and_status_is_current() {
        let src = source("install");
        let root = tmp("root-install");
        let written = install(&src, &root).unwrap();
        assert_eq!(written.len(), 3);
        assert_eq!(
            std::fs::read_to_string(root.join("LuaUI/widgets/coilbox_blueprints.lua")).unwrap(),
            "widget"
        );
        assert_eq!(
            std::fs::read_to_string(root.join("LuaUI/coilbox_blueprints/json.lua")).unwrap(),
            "json"
        );
        assert!(!root.join("LuaUI/tests").exists());
        let s = status(&src, &root);
        assert!(s.installed && s.current);
        assert!(s.stale.is_empty());
    }

    #[test]
    fn status_before_install_is_neither_installed_nor_current() {
        let src = source("status");
        let root = tmp("root-status");
        let s = status(&src, &root);
        assert!(!s.installed && !s.current);
        // The three widget files and the three notice files.
        assert_eq!(s.stale.len(), 6);
    }

    #[test]
    fn a_changed_shipped_file_makes_the_install_stale() {
        let src = source("stale");
        let root = tmp("root-stale");
        install(&src, &root).unwrap();
        write(&src.join("luaui/coilbox_blueprints/json.lua"), "json v2");
        let s = status(&src, &root);
        assert!(s.installed && !s.current);
        assert_eq!(s.stale, vec!["coilbox_blueprints/json.lua"]);
        install(&src, &root).unwrap();
        assert!(status(&src, &root).current);
    }

    #[test]
    fn install_takes_the_case_the_root_already_has() {
        let src = source("case");
        let root = tmp("root-case");
        write(&root.join("luaui/Widgets/other.lua"), "theirs");
        install(&src, &root).unwrap();
        assert!(root.join("luaui/Widgets/coilbox_blueprints.lua").is_file());
        assert!(!root.join("LuaUI").exists() || cfg!(not(target_os = "linux")));
        assert!(status(&src, &root).current);
    }

    #[test]
    fn install_drops_a_file_an_older_widget_shipped_and_leaves_the_rest() {
        let src = source("prune");
        let root = tmp("root-prune");
        write(&root.join("LuaUI/coilbox_blueprints/old.lua"), "old");
        write(
            &root.join("LuaUI/Widgets/coilbox_blueprints_extra.lua"),
            "old",
        );
        write(&root.join("LuaUI/Widgets/gui_theirs.lua"), "theirs");
        write(&root.join("LuaUI/Config/coilbox_blueprints.json"), "{}");
        install(&src, &root).unwrap();
        assert!(!root.join("LuaUI/coilbox_blueprints/old.lua").exists());
        assert!(!root
            .join("LuaUI/Widgets/coilbox_blueprints_extra.lua")
            .exists());
        assert!(root.join("LuaUI/Widgets/gui_theirs.lua").is_file());
        // The library file is named like the widget, and it is coilbox's data
        // rather than the widget's code, so an install must not touch it.
        assert!(root.join("LuaUI/Config/coilbox_blueprints.json").is_file());
    }

    #[test]
    fn remove_takes_the_widget_out_and_nothing_else() {
        let src = source("remove");
        let root = tmp("root-remove");
        write(&root.join("LuaUI/Widgets/gui_theirs.lua"), "theirs");
        install(&src, &root).unwrap();
        let removed = remove(&root).unwrap();
        assert_eq!(removed.len(), 3);
        assert!(!root.join("LuaUI/Widgets/coilbox_blueprints.lua").exists());
        assert!(!root.join("LuaUI/coilbox_blueprints").exists());
        assert!(root.join("LuaUI/Widgets/gui_theirs.lua").is_file());
        let s = status(&src, &root);
        assert!(!s.installed);
    }

    #[test]
    fn install_refuses_an_empty_source_or_a_missing_root() {
        let empty = tmp("src-empty");
        let root = tmp("root-empty");
        assert!(install(&empty, &root).is_err());
        let src = source("missing-root");
        assert!(install(&src, &root.join("nope")).is_err());
    }

    /// The repo file a notice copy is made from, read at test time so the
    /// comparison is against the file on disk and not against the embedded bytes.
    fn repo_file(rel: &str) -> Vec<u8> {
        let path = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../..")
            .join(rel);
        std::fs::read(&path).unwrap_or_else(|e| panic!("{}: {e}", path.display()))
    }

    /// The three files an install writes beside the widget, and the repo file
    /// each is a copy of.
    const NOTICE_COPIES: [(&str, &str); 3] = [
        ("LuaUI/coilbox-licence/NOTICE.md", "lua/GAME-NOTICE.md"),
        ("LuaUI/coilbox-licence/LICENSE-MIT", "LICENSE"),
        ("LuaUI/coilbox-licence/COPYING", "lua/COPYING"),
    ];

    fn assert_notice_current(root: &Path) {
        for (rel, from) in NOTICE_COPIES {
            assert_eq!(
                std::fs::read(root.join(rel)).unwrap_or_else(|e| panic!("{rel}: {e}")),
                repo_file(from),
                "{rel} is not a copy of {from}"
            );
        }
    }

    #[test]
    fn a_fresh_install_writes_the_notice_and_both_licence_texts() {
        let src = source("notice-fresh");
        let root = tmp("root-notice-fresh");
        let written = install(&src, &root).unwrap();
        assert_notice_current(&root);
        // The notice is not one of the widget's files.
        assert!(written.iter().all(|f| !f.starts_with("coilbox-licence")));
    }

    #[test]
    fn a_reinstall_replaces_a_changed_notice_and_drops_a_stale_file() {
        let src = source("notice-again");
        let root = tmp("root-notice-again");
        install(&src, &root).unwrap();
        for (rel, _) in NOTICE_COPIES {
            std::fs::write(root.join(rel), "an older notice").unwrap();
        }
        let stale = root.join("LuaUI/coilbox-licence/OLD-NOTICE.md");
        write(&stale, "from an older coilbox");
        install(&src, &root).unwrap();
        assert_notice_current(&root);
        assert!(!stale.exists());
    }

    #[test]
    fn an_install_without_the_notice_is_stale_until_it_is_written() {
        let src = source("notice-stale");
        let root = tmp("root-notice-stale");
        install(&src, &root).unwrap();
        std::fs::remove_dir_all(root.join("LuaUI/coilbox-licence")).unwrap();
        let s = status(&src, &root);
        assert!(s.installed && !s.current);
        assert!(s.stale.contains(&"coilbox-licence/NOTICE.md".to_string()));
        install(&src, &root).unwrap();
        assert!(status(&src, &root).current);
    }

    #[test]
    fn the_notice_takes_the_case_the_root_already_has() {
        let src = source("notice-case");
        let root = tmp("root-notice-case");
        write(&root.join("luaui/Widgets/other.lua"), "theirs");
        install(&src, &root).unwrap();
        assert!(root.join("luaui/coilbox-licence/NOTICE.md").is_file());
        assert!(status(&src, &root).current);
    }

    #[test]
    fn the_notice_install_leaves_the_players_own_files_and_licences() {
        let src = source("notice-theirs");
        let root = tmp("root-notice-theirs");
        write(&root.join("LuaUI/Widgets/gui_theirs.lua"), "theirs");
        write(&root.join("LuaUI/LICENSE"), "their licence");
        write(&root.join("LuaUI/COPYING"), "their GPL");
        write(&root.join("LICENSE"), "the root's licence");
        write(&root.join("LuaUI/Config/coilbox_blueprints.json"), "{}");
        install(&src, &root).unwrap();
        install(&src, &root).unwrap();
        for (rel, text) in [
            ("LuaUI/Widgets/gui_theirs.lua", "theirs"),
            ("LuaUI/LICENSE", "their licence"),
            ("LuaUI/COPYING", "their GPL"),
            ("LICENSE", "the root's licence"),
            ("LuaUI/Config/coilbox_blueprints.json", "{}"),
        ] {
            assert_eq!(std::fs::read_to_string(root.join(rel)).unwrap(), text);
        }
    }

    #[test]
    fn remove_takes_the_notice_with_the_widget_and_nothing_else() {
        let src = source("notice-remove");
        let root = tmp("root-notice-remove");
        write(&root.join("LuaUI/Widgets/gui_theirs.lua"), "theirs");
        write(&root.join("LuaUI/LICENSE"), "their licence");
        install(&src, &root).unwrap();
        remove(&root).unwrap();
        assert!(!root.join("LuaUI/coilbox-licence").exists());
        assert!(root.join("LuaUI/Widgets/gui_theirs.lua").is_file());
        assert!(root.join("LuaUI/LICENSE").is_file());
    }

    #[test]
    fn bundled_dir_is_the_first_candidate_that_exists() {
        let resources = Path::new("/res");
        let found = bundled_widget_dir(resources, |p| p.ends_with("lua/blueprint-widget"));
        assert_eq!(found, Some(PathBuf::from("/res/lua/blueprint-widget")));
        assert_eq!(bundled_widget_dir(resources, |_| false), None);
    }
}
