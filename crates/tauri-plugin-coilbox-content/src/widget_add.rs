//! Adding a widget to a content root, which every engine coilbox starts reads
//! (issues #1286 and #4856). `write_dir` names that folder.
//!
//! The player picks a `.lua` file, a folder or a zip. The files keep the layout
//! they came with, because a widget that includes other files names their paths
//! in its own code. Which folders they go into is the caller's to say (the
//! handler table in `src/widgets/handlers.ts` knows what each game reads), and
//! this puts one copy in each.
//!
//! Anything already there that the new files would overwrite, or that has the
//! same widget name, is a conflict. Without `replace` a conflict stops the add
//! with nothing written. With it, the old files are copied to a backup folder
//! outside the write folder first, so no game loads them, and then replaced.
//! Removing a widget (#1288) keeps its copies in the same place and layout.

use picoframe_core::CliResult;
use serde::Serialize;
use serde_json::json;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU32, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Runtime};

use crate::player_widgets::{case_sensitive, scan, WidgetFile};
use crate::widget::widget_owned;

/// Under the app data dir. Each backup is a folder in here holding the files as
/// they were, at the path they had relative to the write folder, under `files/`,
/// and a `backup.json` that says what and when.
pub(crate) const BACKUPS: &str = "widget-backups";

/// Names that are in a downloaded folder or zip without being part of the
/// widget.
const SKIPPED: &[&str] = &[".git", ".DS_Store", "__MACOSX", "Thumbs.db"];

/// A widget file in what the player picked.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlannedWidget {
    /// Relative to the picked folder or zip, with forward slashes.
    pub path: String,
    /// The name a game saves its state under: `GetInfo().name`, or the file
    /// name when there is none. `None` when the file could not be read.
    pub name: Option<String>,
    /// In a subfolder, which only some games load.
    pub nested: bool,
    pub error: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WidgetPlan {
    /// Every file that would be copied, relative to the picked folder or zip.
    pub files: Vec<String>,
    pub widgets: Vec<PlannedWidget>,
    /// Built on RmlUi, which a game reads from its own folder.
    pub rml: bool,
    /// `.lua` files more than one folder down. A handler looks no deeper, so no
    /// game loads them.
    pub too_deep: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Conflict {
    /// Relative to the write folder, spelled as on disk.
    pub path: String,
    /// The existing widget's name, when it is a widget that ran.
    pub name: Option<String>,
    /// `name`: a widget with the same name. `path`: a file the new files would
    /// overwrite.
    pub reason: &'static str,
}

#[derive(Debug, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum AddOutcome {
    /// Nothing was written.
    Conflicts { conflicts: Vec<Conflict> },
    #[serde(rename_all = "camelCase")]
    Added {
        /// The folders written to, relative to the write folder and spelled as
        /// on disk.
        folders: Vec<String>,
        widgets: Vec<PlannedWidget>,
        /// The backup folder, when something was replaced.
        backup: Option<String>,
    },
}

fn key(rel: &Path) -> String {
    rel.to_string_lossy().replace('\\', "/")
}

/// A path inside what was picked, joined with `/`. Unlike [`key`] it leaves a
/// backslash in a file name alone, because on macOS and Linux that is part of
/// the name and the copy has to find the file under it.
fn rel_key(rel: &Path) -> String {
    rel.components()
        .map(|c| c.as_os_str().to_string_lossy())
        .collect::<Vec<_>>()
        .join("/")
}

/// The picked files copied under `<root>/LuaUI/Widgets`, which is where the
/// widgets in them are read from when they are checked, so a path they include
/// resolves as it will once they are installed. Removed when dropped.
struct Stage {
    root: PathBuf,
    /// Relative to `<root>/LuaUI/Widgets`, with forward slashes.
    files: Vec<String>,
}

impl Stage {
    fn widgets(&self) -> PathBuf {
        self.root.join("LuaUI").join("Widgets")
    }
}

impl Drop for Stage {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.root);
    }
}

fn skipped(rel: &Path) -> bool {
    rel.components()
        .any(|c| SKIPPED.contains(&c.as_os_str().to_string_lossy().as_ref()))
}

pub(crate) fn copy_file(from: &Path, to: &Path) -> Result<(), String> {
    if let Some(parent) = to.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("could not create {}: {e}", parent.display()))?;
    }
    std::fs::copy(from, to)
        .map(|_| ())
        .map_err(|e| format!("could not copy {} to {}: {e}", from.display(), to.display()))
}

fn stage_dir(from: &Path, base: &Path, into: &Path, stage: &mut Stage) -> Result<(), String> {
    let entries =
        std::fs::read_dir(from).map_err(|e| format!("could not read {}: {e}", from.display()))?;
    let mut paths: Vec<PathBuf> = entries.flatten().map(|e| e.path()).collect();
    paths.sort();
    for path in paths {
        let rel = path.strip_prefix(base).unwrap_or(&path).to_path_buf();
        if skipped(&rel) {
            continue;
        }
        // A link could point anywhere on the machine, so it is not followed.
        let Ok(meta) = std::fs::symlink_metadata(&path) else {
            continue;
        };
        if meta.is_dir() {
            stage_dir(&path, base, into, stage)?;
        } else if meta.is_file() {
            copy_file(&path, &into.join(&rel))?;
            stage.files.push(rel_key(&rel));
        }
    }
    Ok(())
}

fn stage_zip(source: &Path, into: &Path, stage: &mut Stage) -> Result<(), String> {
    let file = std::fs::File::open(source)
        .map_err(|e| format!("could not open {}: {e}", source.display()))?;
    let mut zip = zip::ZipArchive::new(file)
        .map_err(|e| format!("{} is not a readable zip: {e}", source.display()))?;
    for i in 0..zip.len() {
        let mut entry = zip
            .by_index(i)
            .map_err(|e| format!("could not read {}: {e}", source.display()))?;
        if entry.is_dir() {
            continue;
        }
        let Some(rel) = entry.enclosed_name() else {
            return Err(format!(
                "{} holds {}, which would land outside the widget folder",
                source.display(),
                entry.name()
            ));
        };
        if skipped(&rel) {
            continue;
        }
        let out = into.join(&rel);
        if let Some(parent) = out.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("could not create {}: {e}", parent.display()))?;
        }
        let mut f = std::fs::File::create(&out)
            .map_err(|e| format!("could not create {}: {e}", out.display()))?;
        io::copy(&mut entry, &mut f)
            .map_err(|e| format!("could not unpack {}: {e}", entry.name()))?;
        stage.files.push(rel_key(&rel));
    }
    Ok(())
}

/// Make `path` with only its owner allowed in, failing if it is already there.
fn private_dir(path: &Path) -> io::Result<()> {
    let mut dir = std::fs::DirBuilder::new();
    #[cfg(unix)]
    {
        use std::os::unix::fs::DirBuilderExt;
        dir.mode(0o700);
    }
    dir.create(path)
}

fn stage(source: &Path) -> Result<Stage, String> {
    static NEXT: AtomicU32 = AtomicU32::new(0);
    // Made by this process alone and readable by it alone. A folder that is
    // already there, which another user could have left as a link, is never
    // reused, so the next name is tried.
    let root = loop {
        let root = std::env::temp_dir().join(format!(
            "coilbox-widget-add-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        match private_dir(&root) {
            Ok(()) => break root,
            Err(e) if e.kind() == io::ErrorKind::AlreadyExists => continue,
            Err(e) => return Err(format!("could not create {}: {e}", root.display())),
        }
    };
    let mut stage = Stage {
        root,
        files: Vec::new(),
    };
    let into = stage.widgets();
    std::fs::create_dir_all(&into)
        .map_err(|e| format!("could not create {}: {e}", into.display()))?;
    let ext = source
        .extension()
        .map(|e| e.to_string_lossy().to_lowercase());
    if source.is_dir() {
        stage_dir(source, source, &into, &mut stage)?;
    } else if ext.as_deref() == Some("zip") {
        stage_zip(source, &into, &mut stage)?;
    } else if ext.as_deref() == Some("lua") {
        let name = source.file_name().ok_or("the file has no name")?;
        copy_file(source, &into.join(name))?;
        stage.files.push(name.to_string_lossy().to_string());
    } else {
        return Err("pick a .lua file, a .zip or a folder".to_string());
    }
    if !stage
        .files
        .iter()
        .any(|f| f.to_lowercase().ends_with(".lua"))
    {
        return Err(format!("{} has no .lua file in it", source.display()));
    }
    Ok(stage)
}

fn file_name(path: &str) -> &str {
    path.rsplit('/').next().unwrap_or(path)
}

/// The name a game saves a widget's state under.
fn state_name(f: &WidgetFile) -> Option<String> {
    f.info.as_ref().map(|i| {
        i.name
            .clone()
            .unwrap_or_else(|| file_name(&f.path).to_string())
    })
}

fn is_rml(stage: &Stage) -> bool {
    stage.files.iter().any(|f| {
        let lower = f.to_lowercase();
        if lower.ends_with(".rml") || lower.ends_with(".rcss") {
            return true;
        }
        // The engine's Lua table for RmlUi is `RmlUi`.
        lower.ends_with(".lua")
            && std::fs::read(stage.widgets().join(f))
                .is_ok_and(|b| b.windows(5).any(|w| w == b"RmlUi"))
    })
}

fn plan_of(stage: &Stage) -> WidgetPlan {
    let prefix = "LuaUI/Widgets/";
    let found = scan(&stage.root, &["widgets".to_string()]);
    let widgets = found
        .files
        .iter()
        .map(|f| PlannedWidget {
            path: f.path.strip_prefix(prefix).unwrap_or(&f.path).to_string(),
            name: state_name(f),
            nested: f.nested,
            error: f.error.clone(),
        })
        .collect();
    WidgetPlan {
        files: stage.files.clone(),
        widgets,
        rml: is_rml(stage),
        too_deep: stage
            .files
            .iter()
            .filter(|f| f.to_lowercase().ends_with(".lua") && f.split('/').count() > 2)
            .cloned()
            .collect(),
    }
}

/// What is in `source`, without writing anything to the write folder.
pub fn plan(source: &Path) -> Result<WidgetPlan, String> {
    Ok(plan_of(&stage(source)?))
}

/// `folder` (under the write folder, for example `LuaUI/Widgets`) as a path.
/// On a filesystem that folds case an existing folder with the same name in any
/// case is used, so `LuaUI/widgets` finds `LuaUI/Widgets`. On one that does not,
/// a handler reads only the spelling it asks for, so that spelling is used.
fn resolve(write_dir: &Path, folder: &str, sensitive: bool) -> Result<PathBuf, String> {
    let mut at = write_dir.to_path_buf();
    for part in folder.split('/') {
        if part.is_empty() || part == "." || part == ".." || part.contains('\\') {
            return Err(format!("{folder} is not a folder under the write folder"));
        }
        let existing = if sensitive {
            None
        } else {
            let mut names: Vec<_> = std::fs::read_dir(&at)
                .map(|d| d.flatten().map(|e| e.path()).collect())
                .unwrap_or_default();
            names.sort();
            names.into_iter().find(|p| {
                p.is_dir()
                    && p.file_name()
                        .is_some_and(|n| n.to_string_lossy().to_lowercase() == part.to_lowercase())
            })
        };
        at = existing.unwrap_or_else(|| at.join(part));
    }
    Ok(at)
}

fn same_path(a: &Path, b: &Path, sensitive: bool) -> bool {
    if sensitive {
        a == b
    } else {
        a.to_string_lossy().to_lowercase() == b.to_string_lossy().to_lowercase()
    }
}

fn destinations(
    write_dir: &Path,
    folders: &[String],
    sensitive: bool,
) -> Result<Vec<PathBuf>, String> {
    let mut out: Vec<PathBuf> = Vec::new();
    for folder in folders {
        let dir = resolve(write_dir, folder, sensitive)?;
        if !out.iter().any(|d| same_path(d, &dir, sensitive)) {
            out.push(dir);
        }
    }
    Ok(out)
}

/// What is in the destinations that adding the staged files would clash with,
/// each existing file once.
fn conflicts(
    write_dir: &Path,
    dests: &[PathBuf],
    stage: &Stage,
    plan: &WidgetPlan,
    sensitive: bool,
) -> Vec<Conflict> {
    let new_names: Vec<&str> = plan
        .widgets
        .iter()
        .filter_map(|w| w.name.as_deref())
        .collect();
    let mut found: Vec<Conflict> = Vec::new();
    let mut push = |c: Conflict| {
        if !found.iter().any(|f| f.path == c.path) {
            found.push(c);
        }
    };
    for dest in dests {
        let Some(folder) = dest.file_name().map(|n| n.to_string_lossy().to_lowercase()) else {
            continue;
        };
        for f in scan(write_dir, &[folder]).files {
            if !same_path(&write_dir.join(&f.folder), dest, sensitive) {
                continue;
            }
            let name = state_name(&f);
            if name.as_deref().is_some_and(|n| new_names.contains(&n)) {
                push(Conflict {
                    path: f.path,
                    name,
                    reason: "name",
                });
            }
        }
        for rel in &stage.files {
            let target = dest.join(rel);
            if target.is_file() {
                let path = rel_key(target.strip_prefix(write_dir).unwrap_or(&target));
                push(Conflict {
                    path,
                    name: None,
                    reason: "path",
                });
            }
        }
    }
    found
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Copy the files in conflict to a new folder under `backup_root`.
fn back_up(
    write_dir: &Path,
    backup_root: &Path,
    conflicts: &[Conflict],
    widgets: &[PlannedWidget],
) -> Result<PathBuf, String> {
    let label = widgets.iter().find_map(|w| w.name.as_deref());
    let paths: Vec<&str> = conflicts.iter().map(|c| c.path.as_str()).collect();
    back_up_files(write_dir, backup_root, label, "replaced", &paths)
}

/// Copy `paths` (relative to `write_dir`) to a new folder under `backup_root`,
/// laid out as they are under the write folder. `label` names the folder, and
/// `reason` is written to its `backup.json`.
pub(crate) fn back_up_files(
    write_dir: &Path,
    backup_root: &Path,
    label: Option<&str>,
    reason: &str,
    paths: &[&str],
) -> Result<PathBuf, String> {
    let at = now_ms();
    let label = label
        .and_then(crate::settings_backup::slug)
        .unwrap_or_else(|| "widget".to_string());
    std::fs::create_dir_all(backup_root)
        .map_err(|e| format!("could not create {}: {e}", backup_root.display()))?;
    // Made with `create_dir`, which fails on a folder that is there, so two
    // backups of one widget never share a folder and overwrite each other.
    let mut taken = 0;
    let dir = loop {
        let name = if taken == 0 {
            format!("{at}-{label}")
        } else {
            format!("{at}-{label}-{taken}")
        };
        let dir = backup_root.join(name);
        match std::fs::create_dir(&dir) {
            Ok(()) => break dir,
            Err(e) if e.kind() == io::ErrorKind::AlreadyExists => taken += 1,
            Err(e) => return Err(format!("could not create {}: {e}", dir.display())),
        }
    };
    for path in paths {
        copy_file(&write_dir.join(path), &dir.join("files").join(path))?;
    }
    let manifest = json!({
        "savedAt": at,
        "writeDir": write_dir.to_string_lossy(),
        "reason": reason,
        "files": paths,
    });
    std::fs::write(
        dir.join("backup.json"),
        serde_json::to_vec_pretty(&manifest).map_err(|e| e.to_string())?,
    )
    .map_err(|e| format!("could not write {}: {e}", dir.display()))?;
    Ok(dir)
}

/// Add `source` to each of `folders` under `write_dir`. See the module docs for
/// what `replace` does.
pub fn add(
    write_dir: &Path,
    source: &Path,
    folders: &[String],
    replace: bool,
    backup_root: &Path,
) -> Result<AddOutcome, String> {
    if !write_dir.is_dir() {
        return Err(format!("{} is not a folder", write_dir.display()));
    }
    let stage = stage(source)?;
    let plan = plan_of(&stage);
    let sensitive = case_sensitive(write_dir);
    let dests = destinations(write_dir, folders, sensitive)?;
    if dests.is_empty() {
        return Err("no folder to add it to".to_string());
    }
    let clashes = conflicts(write_dir, &dests, &stage, &plan, sensitive);
    if let Some(own) = clashes.iter().find(|c| {
        c.path
            .split_once('/')
            .is_some_and(|(_, under)| widget_owned(under))
    }) {
        return Err(format!("{} is coilbox's own widget", own.path));
    }
    if !clashes.is_empty() && !replace {
        return Ok(AddOutcome::Conflicts { conflicts: clashes });
    }
    let backup = if clashes.is_empty() {
        None
    } else {
        Some(back_up(write_dir, backup_root, &clashes, &plan.widgets)?)
    };
    // A widget with the same name but another file name would otherwise load
    // beside the new one and share its setting, so it goes once the new files
    // are in. A file the new files overwrite is replaced by the copy instead.
    let stale: Vec<PathBuf> = clashes
        .iter()
        .filter(|c| c.reason == "name")
        .map(|c| write_dir.join(&c.path))
        .filter(|path| {
            !dests.iter().any(|d| {
                stage
                    .files
                    .iter()
                    .any(|f| same_path(&d.join(f), path, sensitive))
            })
        })
        .collect();
    let mut created: Vec<PathBuf> = Vec::new();
    let copied = dests.iter().try_for_each(|dest| {
        stage.files.iter().try_for_each(|rel| {
            let to = dest.join(rel);
            if !to.exists() {
                created.push(to.clone());
            }
            copy_file(&stage.widgets().join(rel), &to)
        })
    });
    if let Err(e) = copied {
        // Leave what was there as it was: drop the files this add made and put
        // back the ones it overwrote.
        for path in &created {
            let _ = std::fs::remove_file(path);
        }
        if let Some(backup) = &backup {
            for c in &clashes {
                let _ = copy_file(
                    &backup.join("files").join(&c.path),
                    &write_dir.join(&c.path),
                );
            }
        }
        return Err(e);
    }
    for path in stale {
        std::fs::remove_file(&path)
            .map_err(|e| format!("could not remove {}: {e}", path.display()))?;
    }
    Ok(AddOutcome::Added {
        folders: dests
            .iter()
            .map(|d| key(d.strip_prefix(write_dir).unwrap_or(d)))
            .collect(),
        widgets: plan.widgets,
        backup: backup.map(|b| b.to_string_lossy().to_string()),
    })
}

/// `content_widget_plan`, what is in a `.lua` file, folder or zip the player
/// picked, so they can see what adding it does before it does.
#[tauri::command]
pub(crate) async fn content_widget_plan(source: String) -> CliResult {
    let res = tauri::async_runtime::spawn_blocking(move || plan(Path::new(&source))).await;
    match res {
        Ok(Ok(p)) => CliResult::ok(json!(p)),
        Ok(Err(e)) => CliResult::err(e),
        Err(e) => CliResult::err(format!("widget plan task failed: {e}")),
    }
}

/// `content_widget_add`, copy the picked widget into `folders` under the write
/// folder. Without `replace`, answers with the clashes and writes nothing.
#[tauri::command]
pub(crate) async fn content_widget_add<R: Runtime>(
    app: AppHandle<R>,
    write_dir: String,
    source: String,
    folders: Vec<String>,
    replace: bool,
) -> CliResult {
    if let Err(e) = coilbox_portable::refuse_read_only(Path::new(&write_dir)) {
        return CliResult::err(e);
    }
    let backups = match coilbox_portable::data_dir(&app) {
        Ok(d) => d.join(BACKUPS),
        Err(e) => return CliResult::err(e),
    };
    let res = tauri::async_runtime::spawn_blocking(move || {
        add(
            Path::new(&write_dir),
            Path::new(&source),
            &folders,
            replace,
            &backups,
        )
    })
    .await;
    match res {
        Ok(Ok(outcome)) => CliResult::ok(json!(outcome)),
        Ok(Err(e)) => CliResult::err(e),
        Err(e) => CliResult::err(format!("widget add task failed: {e}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    const GET_INFO: &str = r#"function widget:GetInfo() return { name = "NAME" } end"#;

    fn widget(name: &str) -> String {
        GET_INFO.replace("NAME", name)
    }

    fn put(dir: &Path, rel: &str, text: &str) {
        let path = dir.join(rel);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, text).unwrap();
    }

    fn zip_of(path: &Path, entries: &[(&str, &str)]) {
        let mut zip = zip::ZipWriter::new(std::fs::File::create(path).unwrap());
        let opts = zip::write::SimpleFileOptions::default();
        for (name, text) in entries {
            zip.start_file(*name, opts).unwrap();
            zip.write_all(text.as_bytes()).unwrap();
        }
        zip.finish().unwrap();
    }

    fn folders() -> Vec<String> {
        vec!["LuaUI/Widgets".to_string()]
    }

    #[test]
    fn a_lua_file_goes_into_the_folder() {
        let tmp = tempfile::tempdir().unwrap();
        let (data, write) = (tmp.path().join("data"), tmp.path().join("write"));
        std::fs::create_dir_all(&write).unwrap();
        put(&data, "gui_a.lua", &widget("A"));
        let out = add(
            &write,
            &data.join("gui_a.lua"),
            &folders(),
            false,
            &tmp.path().join("backups"),
        )
        .unwrap();
        let AddOutcome::Added {
            widgets, backup, ..
        } = out
        else {
            panic!("expected the widget to be added");
        };
        assert_eq!(widgets[0].name.as_deref(), Some("A"));
        assert!(backup.is_none());
        assert!(write.join("LuaUI/Widgets/gui_a.lua").is_file());
    }

    #[test]
    fn a_zip_keeps_its_layout_and_says_which_widgets_are_nested() {
        let tmp = tempfile::tempdir().unwrap();
        let zip = tmp.path().join("pack.zip");
        zip_of(
            &zip,
            &[
                ("Pack/gui_b.lua", &widget("B")),
                ("Pack/lib/helper.lua", "return {}"),
                ("__MACOSX/Pack/._gui_b.lua", "junk"),
            ],
        );
        let p = plan(&zip).unwrap();
        assert_eq!(p.files, vec!["Pack/gui_b.lua", "Pack/lib/helper.lua"]);
        assert_eq!(p.widgets.len(), 1);
        assert_eq!(p.widgets[0].path, "Pack/gui_b.lua");
        assert!(p.widgets[0].nested);
        assert!(!p.rml);
        let write = tmp.path().join("write");
        std::fs::create_dir_all(&write).unwrap();
        add(&write, &zip, &folders(), false, &tmp.path().join("b")).unwrap();
        assert!(write.join("LuaUI/Widgets/Pack/lib/helper.lua").is_file());
        assert!(!write.join("LuaUI/Widgets/__MACOSX").exists());
    }

    #[test]
    fn a_lua_file_more_than_one_folder_down_is_listed_as_too_deep() {
        let tmp = tempfile::tempdir().unwrap();
        let zip = tmp.path().join("repo.zip");
        zip_of(
            &zip,
            &[
                ("repo-main/widgets/gui_deep.lua", &widget("Deep")),
                ("top.lua", &widget("Top")),
            ],
        );
        let p = plan(&zip).unwrap();
        assert_eq!(p.too_deep, vec!["repo-main/widgets/gui_deep.lua"]);
        assert_eq!(p.widgets.len(), 1);
        assert_eq!(p.widgets[0].path, "top.lua");
    }

    #[cfg(unix)]
    #[test]
    fn a_backslash_in_a_file_name_is_part_of_the_name() {
        let tmp = tempfile::tempdir().unwrap();
        let (write, src) = (tmp.path().join("write"), tmp.path().join("src"));
        std::fs::create_dir_all(&write).unwrap();
        put(&src, "gui_a.lua", &widget("A"));
        put(&src, "data\\helper.lua", "return {}");
        add(&write, &src, &folders(), false, &tmp.path().join("b")).unwrap();
        assert!(write.join("LuaUI/Widgets/data\\helper.lua").is_file());
    }

    #[cfg(unix)]
    #[test]
    fn a_file_with_a_backslash_in_its_name_can_be_replaced() {
        let tmp = tempfile::tempdir().unwrap();
        let (write, src, backups) = (
            tmp.path().join("write"),
            tmp.path().join("src"),
            tmp.path().join("b"),
        );
        put(&write, "LuaUI/Widgets/data\\helper.lua", "old");
        put(&src, "gui_a.lua", &widget("A"));
        put(&src, "data\\helper.lua", "new");
        let AddOutcome::Conflicts { conflicts } =
            add(&write, &src, &folders(), false, &backups).unwrap()
        else {
            panic!("expected a conflict");
        };
        assert_eq!(conflicts[0].path, "LuaUI/Widgets/data\\helper.lua");
        add(&write, &src, &folders(), true, &backups).unwrap();
        assert_eq!(
            std::fs::read_to_string(write.join("LuaUI/Widgets/data\\helper.lua")).unwrap(),
            "new"
        );
    }

    #[test]
    fn each_stage_gets_a_folder_of_its_own() {
        let tmp = tempfile::tempdir().unwrap();
        let src = tmp.path().join("gui_a.lua");
        std::fs::write(&src, widget("A")).unwrap();
        let (one, two) = (stage(&src).unwrap(), stage(&src).unwrap());
        assert_ne!(one.root, two.root);
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = std::fs::metadata(&one.root).unwrap().permissions().mode();
            assert_eq!(mode & 0o077, 0);
        }
    }

    #[test]
    fn a_folder_with_rml_files_is_an_rml_widget() {
        let tmp = tempfile::tempdir().unwrap();
        let src = tmp.path().join("src");
        put(&src, "gui_c.lua", &widget("C"));
        put(&src, "gui_c.rml", "<rml/>");
        put(&src, ".git/config", "x");
        let p = plan(&src).unwrap();
        assert!(p.rml);
        assert_eq!(p.files, vec!["gui_c.lua", "gui_c.rml"]);
    }

    #[test]
    fn a_lua_file_that_uses_rmlui_is_an_rml_widget() {
        let tmp = tempfile::tempdir().unwrap();
        let src = tmp.path().join("gui_d.lua");
        std::fs::write(
            &src,
            format!("{}\nlocal c = RmlUi.GetContext('shared')", widget("D")),
        )
        .unwrap();
        assert!(plan(&src).unwrap().rml);
    }

    #[test]
    fn a_zip_that_climbs_out_of_the_folder_is_refused() {
        let tmp = tempfile::tempdir().unwrap();
        let zip = tmp.path().join("bad.zip");
        zip_of(&zip, &[("../evil.lua", "x")]);
        assert!(plan(&zip).unwrap_err().contains("outside"));
    }

    #[test]
    fn something_that_is_not_a_widget_is_refused() {
        let tmp = tempfile::tempdir().unwrap();
        let txt = tmp.path().join("a.txt");
        std::fs::write(&txt, "x").unwrap();
        assert!(plan(&txt).is_err());
        let empty = tmp.path().join("empty");
        std::fs::create_dir_all(&empty).unwrap();
        assert!(plan(&empty).unwrap_err().contains("no .lua file"));
    }

    #[test]
    fn a_widget_with_the_same_name_stops_the_add_until_replace() {
        let tmp = tempfile::tempdir().unwrap();
        let (write, backups) = (tmp.path().join("write"), tmp.path().join("backups"));
        put(&write, "LuaUI/Widgets/old_name.lua", &widget("Same"));
        let src = tmp.path().join("new_name.lua");
        std::fs::write(&src, widget("Same")).unwrap();
        let AddOutcome::Conflicts { conflicts } =
            add(&write, &src, &folders(), false, &backups).unwrap()
        else {
            panic!("expected a conflict");
        };
        assert_eq!(conflicts.len(), 1);
        assert_eq!(conflicts[0].path, "LuaUI/Widgets/old_name.lua");
        assert_eq!(conflicts[0].reason, "name");
        assert!(!write.join("LuaUI/Widgets/new_name.lua").exists());
        assert!(!backups.exists());

        let AddOutcome::Added { backup, .. } =
            add(&write, &src, &folders(), true, &backups).unwrap()
        else {
            panic!("expected the widget to be added");
        };
        let backup = PathBuf::from(backup.unwrap());
        assert!(backup.starts_with(&backups));
        assert_eq!(
            std::fs::read_to_string(backup.join("files/LuaUI/Widgets/old_name.lua")).unwrap(),
            widget("Same")
        );
        assert!(backup.join("backup.json").is_file());
        assert!(!write.join("LuaUI/Widgets/old_name.lua").exists());
        assert!(write.join("LuaUI/Widgets/new_name.lua").is_file());
    }

    #[test]
    fn a_file_the_new_files_overwrite_is_backed_up() {
        let tmp = tempfile::tempdir().unwrap();
        let (write, backups) = (tmp.path().join("write"), tmp.path().join("backups"));
        put(&write, "LuaUI/Widgets/gui_e.lua", &widget("Old E"));
        let src = tmp.path().join("gui_e.lua");
        std::fs::write(&src, widget("New E")).unwrap();
        let AddOutcome::Conflicts { conflicts } =
            add(&write, &src, &folders(), false, &backups).unwrap()
        else {
            panic!("expected a conflict");
        };
        assert_eq!(conflicts[0].reason, "path");
        let AddOutcome::Added { backup, .. } =
            add(&write, &src, &folders(), true, &backups).unwrap()
        else {
            panic!("expected the widget to be added");
        };
        let backup = PathBuf::from(backup.unwrap());
        assert!(
            std::fs::read_to_string(backup.join("files/LuaUI/Widgets/gui_e.lua"))
                .unwrap()
                .contains("Old E")
        );
        assert!(
            std::fs::read_to_string(write.join("LuaUI/Widgets/gui_e.lua"))
                .unwrap()
                .contains("New E")
        );
    }

    #[test]
    fn a_replacement_that_cannot_be_written_leaves_the_old_widget() {
        let tmp = tempfile::tempdir().unwrap();
        let (write, backups) = (tmp.path().join("write"), tmp.path().join("backups"));
        put(&write, "LuaUI/Widgets/old_name.lua", &widget("Same"));
        // A file where the new widget needs a folder.
        put(&write, "LuaUI/Widgets/pack", "in the way");
        let src = tmp.path().join("src");
        put(&src, "pack/new_name.lua", &widget("Same"));
        // Copied before the one that fails, so it has to be taken back out.
        put(&src, "a.lua", &widget("Other"));
        assert!(add(&write, &src, &folders(), true, &backups).is_err());
        assert!(write.join("LuaUI/Widgets/old_name.lua").is_file());
        assert!(!write.join("LuaUI/Widgets/a.lua").exists());
        assert_eq!(
            std::fs::read_to_string(write.join("LuaUI/Widgets/pack")).unwrap(),
            "in the way"
        );
    }

    #[test]
    fn two_backups_in_one_millisecond_do_not_share_a_folder() {
        let tmp = tempfile::tempdir().unwrap();
        let (write, backups) = (tmp.path().join("write"), tmp.path().join("backups"));
        put(&write, "LuaUI/Widgets/a.lua", "x");
        let clashes = vec![Conflict {
            path: "LuaUI/Widgets/a.lua".to_string(),
            name: None,
            reason: "path",
        }];
        // Fast enough that several land in one millisecond.
        let made: std::collections::HashSet<PathBuf> = (0..20)
            .map(|_| back_up(&write, &backups, &clashes, &[]).unwrap())
            .collect();
        assert_eq!(made.len(), 20);
        assert!(made
            .iter()
            .all(|d| d.join("files/LuaUI/Widgets/a.lua").is_file()));
    }

    #[test]
    fn coilboxs_own_widget_is_not_replaced() {
        let tmp = tempfile::tempdir().unwrap();
        let write = tmp.path().join("write");
        put(
            &write,
            "LuaUI/Widgets/coilbox_blueprints.lua",
            &widget("Blueprints"),
        );
        let src = tmp.path().join("other.lua");
        std::fs::write(&src, widget("Blueprints")).unwrap();
        let err = add(&write, &src, &folders(), true, &tmp.path().join("b"))
            .err()
            .unwrap();
        assert!(err.contains("coilbox's own widget"));
    }

    #[test]
    fn two_spellings_of_one_folder_are_one_destination_where_case_folds() {
        let tmp = tempfile::tempdir().unwrap();
        let write = tmp.path().join("write");
        std::fs::create_dir_all(&write).unwrap();
        let both = vec!["LuaUI/Widgets".to_string(), "LuaUI/widgets".to_string()];
        let sensitive = case_sensitive(&write);
        let dests = destinations(&write, &both, sensitive).unwrap();
        assert_eq!(dests.len(), if sensitive { 2 } else { 1 });
    }

    #[test]
    fn an_existing_folder_is_used_whatever_its_case_where_case_folds() {
        let tmp = tempfile::tempdir().unwrap();
        let write = tmp.path().join("write");
        std::fs::create_dir_all(write.join("luaui/widgets")).unwrap();
        if case_sensitive(&write) {
            return;
        }
        let dest = resolve(&write, "LuaUI/Widgets", false).unwrap();
        assert!(dest.ends_with("luaui/widgets"));
    }

    #[test]
    fn a_folder_that_climbs_out_is_refused() {
        let tmp = tempfile::tempdir().unwrap();
        assert!(resolve(tmp.path(), "LuaUI/../..", true).is_err());
    }
}
