//! Campaign storage plugin (Rust half). Campaigns are authored sequences of
//! skirmish missions; this crate persists them and their assets under app-data and
//! stays schema-agnostic — a campaign document is an opaque JSON string the
//! frontend owns and validates. The plugin's jobs are storage, safe image
//! import/re-encode, and opaque import/export round-trips.
//!
//! On-disk layout under `<data_dir>/campaign/`:
//!   - `campaigns/<id>.json`         one document per local campaign
//!   - `images/<campaignId>/<uuid>.jpg`  imported panorama art
//!   - `progress.json`               opaque per-player progress
//!
//! A distribution profile can additionally ship *read-only* campaigns as export
//! files in the portable `.coilbox/campaigns/` folder; [`campaign_list`] merges
//! those in as `"bundled"` so bundled campaigns show up without being copied into
//! writable storage (progress is tracked separately, so they still record progress).
//!
//! Registered as `"coilbox-campaign"`; the frontend invokes
//! `plugin:coilbox-campaign|<cmd>`.

mod images;

use coilbox_portable::{is_safe_rel, valid_id};
use images::{data_uri_bytes, data_url, reencode_image, ImageKind};
use picoframe_core::CliResult;
use serde::Serialize;
use serde_json::json;
use std::path::{Path, PathBuf};
use tauri::{
    plugin::{Builder, TauriPlugin},
    AppHandle, Runtime,
};

/// Empty progress document returned when `progress.json` doesn't exist yet. Mirrors
/// the frontend `ProgressFile` schema so it parses unconditionally.
const DEFAULT_PROGRESS: &str = r#"{"schemaVersion":1,"campaigns":{}}"#;

/// A campaign document plus where it was read from. The frontend parses/validates
/// the JSON; `source` lets the UI mark bundled campaigns as read-only.
#[derive(Serialize)]
struct CampaignItem {
    json: String,
    source: &'static str, // "local" | "bundled"
}

/// Base storage directory: `<data_dir>/campaign`.
fn campaign_dir<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    Ok(coilbox_portable::data_dir(app)?.join("campaign"))
}

fn campaigns_dir<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    Ok(campaign_dir(app)?.join("campaigns"))
}

fn images_dir<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    Ok(campaign_dir(app)?.join("images"))
}

/// Audio/video assets live under `<data_dir>/campaign/media/<campaignId>/` and are
/// served to the webview by the `coilbox://` protocol's `campaign` root (never as
/// data URIs — large AV would blow up memory and can't be range-served). Kept
/// separate from `images/` because images are re-encoded and read back as data URIs.
fn media_dir<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    Ok(campaign_dir(app)?.join("media"))
}

fn progress_path<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    Ok(campaign_dir(app)?.join("progress.json"))
}

/// Read every `*.json` file in `dir` (non-recursive) and append it to `items` with
/// the given source. A missing directory or an unreadable file is skipped, not an
/// error — a fresh install simply has no local campaigns, and a non-portable
/// install has no bundled ones.
fn read_json_dir(dir: &Path, source: &'static str, items: &mut Vec<CampaignItem>) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }
        if let Ok(json) = std::fs::read_to_string(&path) {
            items.push(CampaignItem { json, source });
        }
    }
}

/// Resolve `<images>/<campaignId>/<file>` with both parts validated, or an error.
fn image_path<R: Runtime>(
    app: &AppHandle<R>,
    campaign_id: &str,
    file: &str,
) -> Result<PathBuf, String> {
    if !valid_id(campaign_id) {
        return Err(format!("invalid campaign id: {campaign_id}"));
    }
    let rel = Path::new(file);
    if !is_safe_rel(rel) {
        return Err(format!("unsafe image file name: {file}"));
    }
    Ok(images_dir(app)?.join(campaign_id).join(rel))
}

/// `campaign_list` — every stored campaign: local documents under app-data first,
/// then any read-only campaigns bundled in the portable `.coilbox/campaigns/`
/// folder. Non-portable installs simply contribute no bundled entries.
#[tauri::command]
async fn campaign_list<R: Runtime>(app: AppHandle<R>) -> CliResult {
    let mut items = Vec::new();
    if let Ok(dir) = campaigns_dir(&app) {
        read_json_dir(&dir, "local", &mut items);
    }
    if let Some(root) = coilbox_portable::portable_root() {
        read_json_dir(&root.join("campaigns"), "bundled", &mut items);
    }
    CliResult::ok(json!({ "items": items }))
}

/// `campaign_save` — write a campaign document (serialized by the frontend) to
/// `campaigns/<id>.json`. Treated as an opaque string; only the id is validated.
#[tauri::command]
async fn campaign_save<R: Runtime>(app: AppHandle<R>, id: String, json: String) -> CliResult {
    if !valid_id(&id) {
        return CliResult::err(format!("invalid campaign id: {id}"));
    }
    let dir = match campaigns_dir(&app) {
        Ok(d) => d,
        Err(e) => return CliResult::err(e),
    };
    if let Err(e) = std::fs::create_dir_all(&dir) {
        return CliResult::err(format!("could not create campaign dir: {e}"));
    }
    match std::fs::write(dir.join(format!("{id}.json")), json) {
        Ok(()) => CliResult::ok(json!({})),
        Err(e) => CliResult::err(format!("could not write campaign: {e}")),
    }
}

/// `campaign_delete` — remove a campaign document and its image folder. Best-effort
/// on the images (a campaign with no imported art has none).
#[tauri::command]
async fn campaign_delete<R: Runtime>(app: AppHandle<R>, id: String) -> CliResult {
    if !valid_id(&id) {
        return CliResult::err(format!("invalid campaign id: {id}"));
    }
    let doc = match campaigns_dir(&app) {
        Ok(d) => d.join(format!("{id}.json")),
        Err(e) => return CliResult::err(e),
    };
    if let Err(e) = std::fs::remove_file(&doc) {
        if e.kind() != std::io::ErrorKind::NotFound {
            return CliResult::err(format!("could not delete campaign: {e}"));
        }
    }
    if let Ok(dir) = images_dir(&app) {
        let _ = std::fs::remove_dir_all(dir.join(&id));
    }
    if let Ok(dir) = media_dir(&app) {
        let _ = std::fs::remove_dir_all(dir.join(&id));
    }
    CliResult::ok(json!({}))
}

/// Shared tail of both image imports: bound + re-encode the decoded bytes for the
/// given kind, mint a uuid filename (with the kind's extension), and write it under
/// the campaign's image folder. Returns the bare filename the frontend stores.
fn store_image<R: Runtime>(
    app: &AppHandle<R>,
    campaign_id: &str,
    raw: &[u8],
    kind: ImageKind,
) -> Result<String, String> {
    if !valid_id(campaign_id) {
        return Err(format!("invalid campaign id: {campaign_id}"));
    }
    let bytes = reencode_image(raw, kind).ok_or("could not decode image")?;
    let dir = images_dir(app)?.join(campaign_id);
    std::fs::create_dir_all(&dir).map_err(|e| format!("could not create image dir: {e}"))?;
    let file = format!("{}.{}", uuid::Uuid::new_v4(), kind.ext());
    std::fs::write(dir.join(&file), bytes).map_err(|e| format!("could not write image: {e}"))?;
    Ok(file)
}

/// `campaign_image_import` — import an image from a file the user picked: read,
/// decode, downscale to the kind's bounds, re-encode (opaque JPEG or alpha PNG),
/// and store it. `kind` is one of panorama/background/icon/sideGraphic (absent =
/// panorama). Returns the stored filename.
#[tauri::command]
async fn campaign_image_import<R: Runtime>(
    app: AppHandle<R>,
    campaign_id: String,
    src_path: String,
    kind: Option<String>,
) -> CliResult {
    let raw = match std::fs::read(&src_path) {
        Ok(b) => b,
        Err(e) => return CliResult::err(format!("could not read image: {e}")),
    };
    match store_image(&app, &campaign_id, &raw, ImageKind::parse(kind.as_deref())) {
        Ok(file) => CliResult::ok(json!({ "file": file })),
        Err(e) => CliResult::err(e),
    }
}

/// `campaign_image_import_data` — import an image from a base64 `data:` URI (used
/// when an imported campaign carries embedded art). Enforces the same decode +
/// downscale + re-encode bounds as the file path, so a hostile import file can't
/// write unbounded data to disk.
#[tauri::command]
async fn campaign_image_import_data<R: Runtime>(
    app: AppHandle<R>,
    campaign_id: String,
    data_uri: String,
    kind: Option<String>,
) -> CliResult {
    let raw = match data_uri_bytes(&data_uri) {
        Some(b) => b,
        None => return CliResult::err("invalid image data URI"),
    };
    match store_image(&app, &campaign_id, &raw, ImageKind::parse(kind.as_deref())) {
        Ok(file) => CliResult::ok(json!({ "file": file })),
        Err(e) => CliResult::err(e),
    }
}

/// `campaign_image_read` — read a stored image and return it as a `data:` URL (this
/// codebase never uses `convertFileSrc`). Content type follows the stored
/// extension, so alpha-preserving PNG icons/side graphics keep their transparency.
#[tauri::command]
async fn campaign_image_read<R: Runtime>(
    app: AppHandle<R>,
    campaign_id: String,
    file: String,
) -> CliResult {
    let path = match image_path(&app, &campaign_id, &file) {
        Ok(p) => p,
        Err(e) => return CliResult::err(e),
    };
    let content_type = match path.extension().and_then(|e| e.to_str()) {
        Some("png") => "image/png",
        _ => "image/jpeg",
    };
    match std::fs::read(&path) {
        Ok(bytes) => CliResult::ok(json!({ "dataUrl": data_url(content_type, &bytes) })),
        Err(e) => CliResult::err(format!("could not read image: {e}")),
    }
}

/// `campaign_image_delete` — best-effort removal of a stored panorama (dropping an
/// image from a mission needn't fail if the file is already gone).
#[tauri::command]
async fn campaign_image_delete<R: Runtime>(
    app: AppHandle<R>,
    campaign_id: String,
    file: String,
) -> CliResult {
    if let Ok(path) = image_path(&app, &campaign_id, &file) {
        let _ = std::fs::remove_file(path);
    }
    CliResult::ok(json!({}))
}

/// `campaign_media_import` — copy an audio/video file the user picked into the
/// campaign's `media/<campaignId>/` folder **verbatim** (no re-encode: AV is served
/// as-is by the `coilbox://` protocol, which range-serves it for `<video>` seeking).
/// Unlike images, AV is never inlined as a data URI. Returns the bare stored
/// filename to reference as a `{ kind: "file" }` media ref.
#[tauri::command]
async fn campaign_media_import<R: Runtime>(
    app: AppHandle<R>,
    campaign_id: String,
    src_path: String,
) -> CliResult {
    if !valid_id(&campaign_id) {
        return CliResult::err(format!("invalid campaign id: {campaign_id}"));
    }
    // Preserve the source extension (alnum-sanitized) so the protocol's `mime_for`
    // picks the right content type; default to `bin` when there's no usable one.
    let ext: String = Path::new(&src_path)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .collect::<String>()
        .to_ascii_lowercase();
    let ext = if ext.is_empty() {
        "bin".to_string()
    } else {
        ext
    };
    let dir = match media_dir(&app) {
        Ok(d) => d.join(&campaign_id),
        Err(e) => return CliResult::err(e),
    };
    if let Err(e) = std::fs::create_dir_all(&dir) {
        return CliResult::err(format!("could not create media dir: {e}"));
    }
    let file = format!("{}.{}", uuid::Uuid::new_v4(), ext);
    match std::fs::copy(&src_path, dir.join(&file)) {
        Ok(_) => CliResult::ok(json!({ "file": file })),
        Err(e) => CliResult::err(format!("could not import media: {e}")),
    }
}

/// `campaign_export` — write a caller-serialized campaign export document to a
/// caller-chosen path (opaque; the frontend builds the export shape and picks the
/// destination via the save dialog).
#[tauri::command]
async fn campaign_export(json: String, dest: String) -> CliResult {
    match std::fs::write(&dest, json) {
        Ok(()) => CliResult::ok(json!({})),
        Err(e) => CliResult::err(format!("could not write campaign export: {e}")),
    }
}

/// `campaign_import` — read a campaign export file the user picked and hand its raw
/// contents back for the frontend to parse and validate.
#[tauri::command]
async fn campaign_import(src: String) -> CliResult {
    match std::fs::read_to_string(&src) {
        Ok(json) => CliResult::ok(json!({ "json": json })),
        Err(e) => CliResult::err(format!("could not read campaign import: {e}")),
    }
}

/// `campaign_progress_load` — the opaque `progress.json`, or an empty default when
/// it doesn't exist yet.
#[tauri::command]
async fn campaign_progress_load<R: Runtime>(app: AppHandle<R>) -> CliResult {
    let json = progress_path(&app)
        .ok()
        .and_then(|p| std::fs::read_to_string(p).ok())
        .unwrap_or_else(|| DEFAULT_PROGRESS.to_string());
    CliResult::ok(json!({ "json": json }))
}

/// `campaign_progress_save` — persist the opaque progress document.
#[tauri::command]
async fn campaign_progress_save<R: Runtime>(app: AppHandle<R>, json: String) -> CliResult {
    let path = match progress_path(&app) {
        Ok(p) => p,
        Err(e) => return CliResult::err(e),
    };
    if let Some(parent) = path.parent() {
        if let Err(e) = std::fs::create_dir_all(parent) {
            return CliResult::err(format!("could not create campaign dir: {e}"));
        }
    }
    match std::fs::write(&path, json) {
        Ok(()) => CliResult::ok(json!({})),
        Err(e) => CliResult::err(format!("could not write progress: {e}")),
    }
}

/// Build the plugin. Registered as `"coilbox-campaign"` (crate name minus the
/// `tauri-plugin-` prefix); the frontend invokes `plugin:coilbox-campaign|<cmd>`.
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("coilbox-campaign")
        .invoke_handler(tauri::generate_handler![
            campaign_list,
            campaign_save,
            campaign_delete,
            campaign_image_import,
            campaign_image_import_data,
            campaign_image_read,
            campaign_image_delete,
            campaign_media_import,
            campaign_export,
            campaign_import,
            campaign_progress_load,
            campaign_progress_save
        ])
        .build()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn valid_id_accepts_charset() {
        assert!(valid_id("abc"));
        assert!(valid_id("Camp-01"));
        assert!(valid_id("0123456789"));
        assert!(valid_id("a-b-c"));
    }

    #[test]
    fn valid_id_rejects_bad_ids() {
        assert!(!valid_id(""));
        assert!(!valid_id("a b"));
        assert!(!valid_id("a/b"));
        assert!(!valid_id("../etc"));
        assert!(!valid_id("a.json"));
        assert!(!valid_id("café"));
    }

    #[test]
    fn is_safe_rel_matches_profile_guard() {
        assert!(is_safe_rel(Path::new("abc.jpg")));
        assert!(!is_safe_rel(Path::new("")));
        assert!(!is_safe_rel(Path::new("../x.jpg")));
        assert!(!is_safe_rel(Path::new("/abs.jpg")));
        assert!(!is_safe_rel(Path::new("a/../b.jpg")));
    }

    #[test]
    fn read_json_dir_reads_only_json_and_tags_source() {
        let tmp = tempfile::tempdir().unwrap();
        std::fs::write(tmp.path().join("a.json"), r#"{"id":"a"}"#).unwrap();
        std::fs::write(tmp.path().join("b.json"), r#"{"id":"b"}"#).unwrap();
        std::fs::write(tmp.path().join("notes.txt"), "ignore me").unwrap();

        let mut items = Vec::new();
        read_json_dir(tmp.path(), "local", &mut items);

        assert_eq!(items.len(), 2);
        assert!(items.iter().all(|i| i.source == "local"));
        let mut jsons: Vec<&str> = items.iter().map(|i| i.json.as_str()).collect();
        jsons.sort();
        assert_eq!(jsons, vec![r#"{"id":"a"}"#, r#"{"id":"b"}"#]);
    }

    #[test]
    fn read_json_dir_missing_dir_is_empty() {
        let mut items = Vec::new();
        read_json_dir(Path::new("/no/such/campaign/dir"), "local", &mut items);
        assert!(items.is_empty());
    }

    #[test]
    fn read_json_dir_merges_local_then_bundled() {
        let local = tempfile::tempdir().unwrap();
        let bundled = tempfile::tempdir().unwrap();
        std::fs::write(local.path().join("one.json"), r#"{"n":1}"#).unwrap();
        std::fs::write(bundled.path().join("two.json"), r#"{"n":2}"#).unwrap();

        let mut items = Vec::new();
        read_json_dir(local.path(), "local", &mut items);
        read_json_dir(bundled.path(), "bundled", &mut items);

        assert_eq!(items.len(), 2);
        assert_eq!(items[0].source, "local");
        assert_eq!(items[1].source, "bundled");
    }
}
