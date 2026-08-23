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

use std::path::{Component, Path, PathBuf};

/// The tree under the widget's source directory that is installed. `tests/`
/// and the README sit beside it and never are.
const VENDORED: &str = "luaui";

/// Where the tree lands under the content root, spelled the way the engine's
/// own `cont/LuaUI` spells it.
const DEST: &str = "LuaUI";

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
    Ok(written)
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
    let own_dir = resolve_case(&dest, Path::new("coilbox_blueprints"));
    if own_dir.is_dir() {
        // Only when empty: remove_dir refuses otherwise, and anything left in
        // there is not the widget's.
        let _ = std::fs::remove_dir(&own_dir);
    }
    Ok(removed)
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
        assert_eq!(s.stale.len(), 3);
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

    #[test]
    fn bundled_dir_is_the_first_candidate_that_exists() {
        let resources = Path::new("/res");
        let found = bundled_widget_dir(resources, |p| p.ends_with("lua/blueprint-widget"));
        assert_eq!(found, Some(PathBuf::from("/res/lua/blueprint-widget")));
        assert_eq!(bundled_widget_dir(resources, |_| false), None);
    }
}
