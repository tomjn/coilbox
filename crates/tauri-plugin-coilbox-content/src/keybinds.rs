//! Reading and writing an engine's `uikeys.txt`, and storing saved keymaps.
//!
//! The engine reads this file from its write dir, next to `springsettings.cfg`,
//! and reads it raw-first: once this file exists, the copy a game ships in its
//! archive never loads. So a write here replaces the player's whole keymap, and
//! the first write over a file coilbox did not author keeps a `.bak` beside it.

use picoframe_core::CliResult;
use serde::Serialize;
use serde_json::json;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Runtime};

/// First line of a file coilbox wrote. Mirrors `COILBOX_HEADER` in `uikeys.ts`.
const COILBOX_HEADER: &str = "// Written by coilbox";

const FILENAME: &str = "uikeys.txt";
const BACKUP: &str = "uikeys.txt.bak";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadResult {
    /// Full path of the file, whether or not it is there.
    pub path: String,
    pub exists: bool,
    /// The file's text, or empty when there is none.
    pub text: String,
    /// True when the text on disk was last written by coilbox.
    pub ours: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WriteResult {
    pub path: String,
    /// True when this write took the one-time copy of a hand-written file.
    pub backed_up: bool,
}

pub fn read(config_dir: &str) -> ReadResult {
    let path = Path::new(config_dir).join(FILENAME);
    let text = std::fs::read_to_string(&path).unwrap_or_default();
    ReadResult {
        path: path.to_string_lossy().to_string(),
        exists: path.is_file(),
        ours: text.starts_with(COILBOX_HEADER),
        text,
    }
}

pub fn write(config_dir: &str, text: &str) -> Result<WriteResult, String> {
    let dir = Path::new(config_dir);
    std::fs::create_dir_all(dir).map_err(|e| format!("create {}: {e}", dir.display()))?;
    let path = dir.join(FILENAME);
    let backup = dir.join(BACKUP);

    // Only the player's own file is worth keeping, and only the first time: a
    // later backup would be a copy of something coilbox wrote.
    let existing = std::fs::read_to_string(&path).unwrap_or_default();
    let backed_up = path.is_file() && !existing.starts_with(COILBOX_HEADER) && !backup.exists();
    if backed_up {
        std::fs::copy(&path, &backup).map_err(|e| format!("back up {}: {e}", path.display()))?;
    }

    std::fs::write(&path, text).map_err(|e| format!("write {}: {e}", path.display()))?;
    Ok(WriteResult {
        path: path.to_string_lossy().to_string(),
        backed_up,
    })
}

/// One saved keymap: metadata this module owns, and the payload it does not read.
/// Named `StoredKeymap` because `SavedKeymap` in `keymap.ts` is the payload.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredKeymap {
    pub name: String,
    pub slug: String,
    pub created_at_ms: u64,
    /// The keymap document, as the frontend serialised it.
    pub json: String,
}

/// Where one content root's keymaps live, under the keymaps store.
fn root_dir(store: &Path, root_path: &str) -> PathBuf {
    store.join(crate::hash_id(&[root_path]))
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Saved keymaps for a content root, newest first.
pub fn keymaps_list(store: &Path, root_path: &str) -> Vec<StoredKeymap> {
    let dir = root_dir(store, root_path);
    let mut out: Vec<StoredKeymap> = match std::fs::read_dir(&dir) {
        Ok(rd) => rd
            .filter_map(|e| e.ok())
            .filter(|e| e.path().extension().is_some_and(|x| x == "json"))
            .filter_map(|e| {
                let text = std::fs::read_to_string(e.path()).ok()?;
                let v: serde_json::Value = serde_json::from_str(&text).ok()?;
                Some(StoredKeymap {
                    name: v.get("name")?.as_str()?.to_string(),
                    slug: v.get("slug")?.as_str()?.to_string(),
                    created_at_ms: v.get("createdAtMs").and_then(|x| x.as_u64()).unwrap_or(0),
                    json: v.get("keymap")?.to_string(),
                })
            })
            .collect(),
        Err(_) => Vec::new(),
    };
    out.sort_by_key(|k| std::cmp::Reverse(k.created_at_ms));
    out
}

/// Save (or replace by name) one keymap for a content root.
pub fn keymaps_save(
    store: &Path,
    root_path: &str,
    name: &str,
    json: &str,
) -> Result<StoredKeymap, String> {
    let slug =
        crate::settings_backup::slug(name).ok_or("Keymap name must contain a letter or number")?;
    let keymap: serde_json::Value =
        serde_json::from_str(json).map_err(|e| format!("keymap is not valid JSON: {e}"))?;
    let dir = root_dir(store, root_path);
    std::fs::create_dir_all(&dir).map_err(|e| format!("create keymaps dir: {e}"))?;
    let created_at_ms = now_ms();
    let doc = serde_json::json!({
        "name": name,
        "slug": slug,
        "createdAtMs": created_at_ms,
        "keymap": keymap,
    });
    std::fs::write(
        dir.join(format!("{slug}.json")),
        serde_json::to_string_pretty(&doc).map_err(|e| format!("serialise keymap: {e}"))?,
    )
    .map_err(|e| format!("write keymap: {e}"))?;
    Ok(StoredKeymap {
        name: name.to_string(),
        slug,
        created_at_ms,
        json: keymap.to_string(),
    })
}

/// Delete one saved keymap. Deleting one that is not there is not an error.
pub fn keymaps_delete(store: &Path, root_path: &str, slug: &str) -> Result<(), String> {
    let path = root_dir(store, root_path).join(format!("{slug}.json"));
    if path.exists() {
        std::fs::remove_file(&path).map_err(|e| format!("delete keymap: {e}"))?;
    }
    Ok(())
}

/// Directory holding saved keymaps, under the app data dir.
fn keymaps_dir<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    Ok(coilbox_portable::data_dir(app)?.join("keymaps"))
}

/// `content_keybinds_read`, the `uikeys.txt` beside an engine's
/// `springsettings.cfg`. `configDir` is that file's directory, which unitsync
/// reports, so a portable engine's own config dir is handled without guessing.
#[tauri::command]
pub(crate) async fn content_keybinds_read(config_dir: String) -> CliResult {
    let res = tauri::async_runtime::spawn_blocking(move || read(&config_dir)).await;
    match res {
        Ok(r) => CliResult::ok(json!(r)),
        Err(e) => CliResult::err(format!("read keybinds task failed: {e}")),
    }
}

/// `content_keybinds_write`, replace that `uikeys.txt`, keeping a one-time
/// `.bak` of a file coilbox did not write.
#[tauri::command]
pub(crate) async fn content_keybinds_write(config_dir: String, text: String) -> CliResult {
    let res = tauri::async_runtime::spawn_blocking(move || write(&config_dir, &text)).await;
    match res {
        Ok(Ok(r)) => CliResult::ok(json!(r)),
        Ok(Err(e)) => CliResult::err(e),
        Err(e) => CliResult::err(format!("write keybinds task failed: {e}")),
    }
}

/// `content_keymaps`, saved keymaps for a content root, newest first. Separate
/// from config profiles because a keymap is worth moving on its own.
#[tauri::command]
pub(crate) async fn content_keymaps<R: Runtime>(app: AppHandle<R>, root_path: String) -> CliResult {
    let dir = match keymaps_dir(&app) {
        Ok(d) => d,
        Err(e) => return CliResult::err(e),
    };
    let res = tauri::async_runtime::spawn_blocking(move || keymaps_list(&dir, &root_path)).await;
    match res {
        Ok(keymaps) => CliResult::ok(json!({ "keymaps": keymaps })),
        Err(e) => CliResult::err(format!("list keymaps task failed: {e}")),
    }
}

/// `content_keymap_save`, store a keymap under a name (re-saving replaces it).
/// `json` is opaque here: the frontend owns the keymap's shape.
#[tauri::command]
pub(crate) async fn content_keymap_save<R: Runtime>(
    app: AppHandle<R>,
    root_path: String,
    name: String,
    json: String,
) -> CliResult {
    let dir = match keymaps_dir(&app) {
        Ok(d) => d,
        Err(e) => return CliResult::err(e),
    };
    let res = tauri::async_runtime::spawn_blocking(move || {
        keymaps_save(&dir, &root_path, &name, &json)
    })
    .await;
    match res {
        Ok(Ok(keymap)) => CliResult::ok(json!({ "keymap": keymap })),
        Ok(Err(e)) => CliResult::err(e),
        Err(e) => CliResult::err(format!("save keymap task failed: {e}")),
    }
}

/// `content_keymap_delete`, drop one saved keymap by slug.
#[tauri::command]
pub(crate) async fn content_keymap_delete<R: Runtime>(
    app: AppHandle<R>,
    root_path: String,
    slug: String,
) -> CliResult {
    let dir = match keymaps_dir(&app) {
        Ok(d) => d,
        Err(e) => return CliResult::err(e),
    };
    let res =
        tauri::async_runtime::spawn_blocking(move || keymaps_delete(&dir, &root_path, &slug)).await;
    match res {
        Ok(Ok(())) => CliResult::ok(json!({ "ok": true })),
        Ok(Err(e)) => CliResult::err(e),
        Err(e) => CliResult::err(format!("delete keymap task failed: {e}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("cbx-keys-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn read_reports_a_missing_file() {
        let dir = tmp("missing");
        let res = read(dir.to_string_lossy().as_ref());
        assert!(!res.exists);
        assert_eq!(res.text, "");
        assert!(res.path.ends_with("uikeys.txt"));
    }

    #[test]
    fn read_returns_the_text() {
        let dir = tmp("text");
        std::fs::write(dir.join("uikeys.txt"), b"bind a chat\n").unwrap();
        let res = read(dir.to_string_lossy().as_ref());
        assert!(res.exists);
        assert_eq!(res.text, "bind a chat\n");
    }

    #[test]
    fn first_write_over_a_hand_written_file_keeps_a_backup() {
        let dir = tmp("backup");
        let d = dir.to_string_lossy().to_string();
        std::fs::write(dir.join("uikeys.txt"), b"bind a chat\n").unwrap();

        let first = write(&d, "// Written by coilbox\nbind b chat\n").unwrap();
        assert!(first.backed_up);
        assert_eq!(
            std::fs::read_to_string(dir.join("uikeys.txt.bak")).unwrap(),
            "bind a chat\n"
        );

        // A second write has nothing of the player's left to protect, and must
        // not overwrite the one copy of it that exists.
        let second = write(&d, "// Written by coilbox\nbind c chat\n").unwrap();
        assert!(!second.backed_up);
        assert_eq!(
            std::fs::read_to_string(dir.join("uikeys.txt.bak")).unwrap(),
            "bind a chat\n"
        );
        assert_eq!(
            std::fs::read_to_string(dir.join("uikeys.txt")).unwrap(),
            "// Written by coilbox\nbind c chat\n"
        );
    }

    #[test]
    fn keymaps_save_list_delete() {
        let dir = tmp("keymaps");
        let store = dir.join("store");
        let root = "/some/content/root";

        assert!(keymaps_list(&store, root).is_empty());

        let saved = keymaps_save(&store, root, "My BAR Keys", r#"{"bindings":[]}"#).unwrap();
        assert_eq!(saved.slug, "my-bar-keys");
        assert_eq!(saved.name, "My BAR Keys");

        let listed = keymaps_list(&store, root);
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].json, r#"{"bindings":[]}"#);

        // A different root does not see it.
        assert!(keymaps_list(&store, "/other/root").is_empty());

        // Re-saving the same name replaces rather than duplicates.
        keymaps_save(&store, root, "My BAR Keys", r#"{"bindings":[1]}"#).unwrap();
        let listed = keymaps_list(&store, root);
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].json, r#"{"bindings":[1]}"#);

        keymaps_delete(&store, root, "my-bar-keys").unwrap();
        assert!(keymaps_list(&store, root).is_empty());
    }

    #[test]
    fn keymaps_reject_an_unusable_name() {
        let dir = tmp("badname");
        assert!(keymaps_save(&dir, "/root", "***", "{}").is_err());
    }

    #[test]
    fn write_creates_the_file_when_there_is_none() {
        let dir = tmp("create");
        let res = write(dir.to_string_lossy().as_ref(), "// Written by coilbox\n").unwrap();
        assert!(!res.backed_up);
        assert!(dir.join("uikeys.txt").is_file());
        assert!(!dir.join("uikeys.txt.bak").exists());
    }
}
