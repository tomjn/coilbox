//! content plugin (Rust half). Discovers Spring/Recoil **data roots** (content
//! folders) and the **engines** inside them — both auto-detected from standard
//! per-OS locations and manually added via a folder picker. The persisted
//! `state.json` (under app-data) is the authoritative store and the cross-plugin
//! read API: other plugins can call `content_state_load` / `content_list_engines`
//! to find where content lives without re-implementing detection.
//!
//! Engine *version* identity is folder-derived; the binary is only executed on an
//! explicit `content_verify_engine` (bounded by a timeout), never during listing.
//! Results use the [`CliResult`] envelope, matching every other picoframe plugin.

mod archives;
mod branding;
mod build_tree_export;
mod caches;
mod demo;
mod engine;
mod model;
mod path_validity;
mod paths;
mod rapid_pool;
mod savegame;
mod scan;
mod settings_backup;
mod stats;
mod stats_watcher;
mod storage;

use model::{
    load_store, save_store, ContentRoot, ContentState, RootCounts, RootKind, RootSource, StoreFile,
    UserRoot, SCHEMA_VERSION,
};
use paths::{candidate_roots, current_os, BaseDirs, Candidate};
use picoframe_core::CliResult;
use serde_json::json;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{
    plugin::{Builder, TauriPlugin},
    AppHandle, Manager, Runtime,
};

const VERIFY_TIMEOUT: Duration = Duration::from_secs(20);

// ---- small shared helpers (used by scan.rs too) ----------------------------

/// Stable short id from string parts.
pub(crate) fn hash_id(parts: &[&str]) -> String {
    use std::hash::{Hash, Hasher};
    let mut h = std::collections::hash_map::DefaultHasher::new();
    for p in parts {
        p.hash(&mut h);
    }
    format!("{:016x}", h.finish())
}

/// Display form of a path, stripping the Windows `\\?\` verbatim prefix that
/// `canonicalize` produces (we keep canonical paths for dedupe keys, not display).
pub(crate) fn display_path(p: &Path) -> String {
    let s = p.to_string_lossy().to_string();
    #[cfg(windows)]
    {
        if let Some(stripped) = s.strip_prefix(r"\\?\") {
            return stripped.to_string();
        }
    }
    s
}

/// Canonical path for dedupe keys; falls back to the raw path when it can't be
/// canonicalized (e.g. it doesn't exist — such candidates are invalid anyway).
fn canonical(p: &Path) -> PathBuf {
    std::fs::canonicalize(p).unwrap_or_else(|_| p.to_path_buf())
}

/// Resolve a *stored* user-root path to an absolute path before it's canonicalized.
/// Absolute paths pass through; a **relative** stored path is a portable root,
/// resolved against the app directory ([`coilbox_portable::app_dir`]) so a shipped
/// package keeps working after it's moved. Falls back to the raw relative path only
/// when the app dir can't be resolved (it then fails validation like any bad path).
fn resolve_stored(p: &str) -> PathBuf {
    let path = Path::new(p);
    if path.is_absolute() {
        return path.to_path_buf();
    }
    match coilbox_portable::app_dir() {
        Some(base) => base.join(path),
        None => path.to_path_buf(),
    }
}

/// Given a canonical absolute root and whether the caller asked for a portable
/// root, decide how to *store* it: relative to the app dir (portable) or absolute.
/// In portable mode (`.coilbox` present) roots under the app dir are relativized
/// automatically; an explicit `portable` request for a folder outside the app dir
/// is an error (there's nothing stable to make it relative to).
fn stored_root_path(portable: bool, canon: &Path) -> Result<String, String> {
    if portable || coilbox_portable::is_portable() {
        if let Some(base) = coilbox_portable::app_dir() {
            if let Ok(rel) = canon.strip_prefix(canonical(&base)) {
                let s = display_path(rel);
                return Ok(if s.is_empty() { ".".into() } else { s });
            }
        }
        if portable {
            return Err(
                "Portable roots must live inside the app folder (next to the \
                        coilbox executable)."
                    .into(),
            );
        }
    }
    Ok(display_path(canon))
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn store_path<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    Ok(coilbox_portable::data_dir(app)?
        .join("content")
        .join("state.json"))
}

/// The replay-stats store, alongside the content `state.json` under app-data.
fn stats_path<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    Ok(coilbox_portable::data_dir(app)?
        .join("content")
        .join("stats.json"))
}

/// Gather real filesystem anchors from the environment + tauri path APIs.
fn base_dirs<R: Runtime>(app: &AppHandle<R>, include_zerok: bool) -> BaseDirs {
    let home = std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from);
    let documents = app
        .path()
        .document_dir()
        .ok()
        .or_else(|| home.as_ref().map(|h| h.join("Documents")));
    let local_data = app.path().local_data_dir().ok();
    let config = std::env::var_os("XDG_CONFIG_HOME")
        .map(PathBuf::from)
        .or_else(|| home.as_ref().map(|h| h.join(".config")));
    let spring_datadir = std::env::var_os("SPRING_DATADIR")
        .map(|v| std::env::split_paths(&v).collect())
        .unwrap_or_default();
    BaseDirs {
        home,
        documents,
        local_data,
        config,
        program_data: std::env::var_os("ProgramData").map(PathBuf::from),
        program_files_x86: std::env::var_os("ProgramFiles(x86)").map(PathBuf::from),
        spring_writedir: std::env::var_os("SPRING_WRITEDIR").map(PathBuf::from),
        spring_datadir,
        include_zerok,
    }
}

// ---- root assembly ---------------------------------------------------------

/// Accumulator while merging candidate origins + user roots before scanning.
struct Acc {
    canon: PathBuf,
    origins: Vec<String>,
    source: RootSource,
    label: Option<String>,
    forced: bool,
    /// Stored as a relative (portable) path — surfaced as `ContentRoot.portable`.
    portable: bool,
}

fn build_root(a: Acc, with_counts: bool, now: u64) -> ContentRoot {
    let exists = a.canon.is_dir();
    let kind_opt = if exists {
        scan::classify(&a.canon)
    } else {
        None
    };
    let engines = if exists {
        scan::discover_engines(&a.canon)
    } else {
        Vec::new()
    };
    let counts = if exists && with_counts {
        scan::counts(&a.canon, engines.len() as u32)
    } else {
        RootCounts {
            engines: engines.len() as u32,
            ..Default::default()
        }
    };
    ContentRoot {
        id: hash_id(&[a.canon.to_string_lossy().as_ref()]),
        path: display_path(&a.canon),
        source: a.source,
        kind: kind_opt.unwrap_or(RootKind::Data),
        label: a.label,
        origins: a.origins,
        exists,
        valid: kind_opt.is_some() || a.forced,
        portable: a.portable,
        forced: if a.forced { Some(true) } else { None },
        counts,
        engines,
        last_scanned_at: Some(now),
    }
}

/// The app dir to seed a self-contained content root at when running portable,
/// else `None`. A portable install keeps all content beside the binary, so this is
/// the single anchor both `compute_state` and `content_candidates` use to suppress
/// OS-wide auto-discovery.
fn portable_seed_dir() -> Option<PathBuf> {
    coilbox_portable::is_portable()
        .then(coilbox_portable::app_dir)
        .flatten()
}

/// Build the auto-discovered accumulators before manual roots are merged in.
///
/// In portable mode the app is fully self-contained: OS-wide auto-discovery is
/// skipped entirely and a single root is seeded at the app dir (where game content
/// sits beside the binary). It's `forced` so a freshly shipped, still-empty package
/// keeps a writable root, and `portable` so it's stored relative to the app dir.
/// Otherwise the candidate list is merged, deduped by canonical path.
fn auto_accs(portable_app_dir: Option<PathBuf>, candidates: Vec<Candidate>) -> Vec<Acc> {
    if let Some(app_dir) = portable_app_dir {
        return vec![Acc {
            canon: canonical(&app_dir),
            origins: vec!["portable".into()],
            source: RootSource::Auto,
            label: None,
            forced: true,
            portable: true,
        }];
    }
    let mut accs: Vec<Acc> = Vec::new();
    for c in candidates {
        let canon = canonical(&c.path);
        match accs.iter_mut().find(|a| a.canon == canon) {
            Some(a) => {
                if !a.origins.contains(&c.origin) {
                    a.origins.push(c.origin);
                }
            }
            None => accs.push(Acc {
                canon,
                origins: vec![c.origin],
                source: RootSource::Auto,
                label: None,
                forced: false,
                portable: false,
            }),
        }
    }
    accs
}

/// The core rescan: merge auto candidates with the user's manual roots, scan each,
/// and drop auto roots that don't validate (manual roots are always kept so the
/// user can see/remove them).
fn compute_state<R: Runtime>(
    app: &AppHandle<R>,
    store: &StoreFile,
    with_counts: bool,
    include_zerok: bool,
) -> ContentState {
    let base = base_dirs(app, include_zerok);
    // Portable installs are fully self-contained: skip OS-wide auto-discovery and
    // seed a single root at the app dir (game content sits beside the binary). A
    // user can still add extra roots by hand below.
    let mut accs = auto_accs(portable_seed_dir(), candidate_roots(current_os(), &base));

    for u in &store.user_roots {
        // A manual root stored as an absolute path from a different OS (e.g. a
        // shared portable `.coilbox/data` copied cross-machine) can never resolve
        // here, drop it rather than track a permanently-dead entry (issue #524).
        if path_validity::is_foreign_absolute(&u.path) {
            continue;
        }
        let canon = canonical(&resolve_stored(&u.path));
        let portable = Path::new(&u.path).is_relative();
        match accs.iter_mut().find(|a| a.canon == canon) {
            Some(a) => {
                a.source = RootSource::Manual;
                if u.label.is_some() {
                    a.label = u.label.clone();
                }
                a.forced = u.forced;
                a.portable = portable;
                if !a.origins.iter().any(|o| o == "manual") {
                    a.origins.push("manual".into());
                }
            }
            None => accs.push(Acc {
                canon,
                origins: vec!["manual".into()],
                source: RootSource::Manual,
                label: u.label.clone(),
                forced: u.forced,
                portable,
            }),
        }
    }

    let now = now_ms();
    let mut roots: Vec<ContentRoot> = accs
        .into_iter()
        .map(|a| build_root(a, with_counts, now))
        .collect();
    // Keep valid roots and every manual root; drop auto candidates that exist but
    // aren't recognizable Spring roots (noise).
    roots.retain(|r| r.valid || matches!(r.source, RootSource::Manual));

    ContentState {
        schema_version: SCHEMA_VERSION,
        roots,
        last_scan_at: Some(now),
    }
}

/// Persist `state` as the snapshot in `store` and write it out.
fn persist(path: &Path, mut store: StoreFile, state: &ContentState) -> Result<(), String> {
    store.schema_version = SCHEMA_VERSION;
    store.snapshot = Some(state.clone());
    save_store(path, &store)
}

/// Re-derive the filesystem-dependent fields of a cached snapshot without a full
/// rescan. The snapshot freezes `exists` / `valid` / `engines` at scan time, but a
/// content folder or engine can be deleted between runs, so any read that gates UI
/// (first-run setup, engine-download buttons) must re-check disk, or it acts on
/// stale truth. Cheap: re-stats each root and re-scans only the `engine/` layout,
/// deliberately skipping the content-count walk (those counts self-correct on the
/// next explicit rescan). Not persisted, a read must stay read-only.
///
/// A root whose path is an absolute path from a different OS (a Windows path in a
/// state.json copied onto macOS/Linux, or the reverse) is dropped outright. It can
/// never exist here, and offering it as a recreate-this-folder manual root would
/// try to create a garbage, literally-named folder (issue #524).
fn refresh_against_disk(state: ContentState) -> ContentState {
    let ContentState {
        schema_version,
        roots,
        last_scan_at,
    } = state;
    let mut roots: Vec<ContentRoot> = roots
        .into_iter()
        .filter(|r| !path_validity::is_foreign_absolute(&r.path))
        .map(|mut r| {
            let canon = canonical(Path::new(&r.path));
            let exists = canon.is_dir();
            let forced = r.forced == Some(true);
            let kind = if exists { scan::classify(&canon) } else { None };
            let engines = if exists {
                scan::discover_engines(&canon)
            } else {
                Vec::new()
            };
            r.exists = exists;
            // `forced` means valid even with no recognizable Spring layout, not
            // valid even though the folder is gone. A forced root whose directory
            // has vanished (deleted, or copied from another machine) must not
            // report itself as usable.
            r.valid = exists && (kind.is_some() || forced);
            if let Some(k) = kind {
                r.kind = k;
            }
            if exists {
                r.counts.engines = engines.len() as u32;
            } else {
                // Folder gone: zero counts so nothing reports a stale total.
                r.counts = RootCounts::default();
            }
            r.engines = engines;
            r
        })
        .collect();
    // Mirror compute_state: keep valid roots and every manual root (so a vanished
    // manual root stays visible and recreatable); drop auto roots that no longer
    // validate (noise).
    roots.retain(|r| r.valid || matches!(r.source, RootSource::Manual));
    ContentState {
        schema_version,
        roots,
        last_scan_at,
    }
}

/// Make sure a portable install's own root (the app dir) is present in `roots`,
/// re-derived fresh from the current machine's portable anchor rather than trusted
/// from whatever the snapshot says. `content_state_load` only refreshes existing
/// snapshot entries against disk. It never re-runs auto-discovery the way a rescan
/// does, so a snapshot copied from another machine or OS (a shared portable
/// `.coilbox/data` folder) can leave portable installs with zero usable roots even
/// though the real folder sits right next to the executable (issue #524). Not
/// persisted, mirrors `refresh_against_disk`'s read-only contract. An explicit
/// rescan writes the seeded root for real, exactly like a first run does.
fn ensure_portable_seed(roots: Vec<ContentRoot>) -> Vec<ContentRoot> {
    ensure_portable_seed_in(roots, portable_seed_dir())
}

/// Pure core of [`ensure_portable_seed`], taking the portable app dir explicitly
/// (mirrors [`auto_accs`]) so it's unit-testable without a real `.coilbox` folder
/// next to the test binary.
fn ensure_portable_seed_in(
    mut roots: Vec<ContentRoot>,
    portable_app_dir: Option<PathBuf>,
) -> Vec<ContentRoot> {
    let Some(app_dir) = portable_app_dir else {
        return roots;
    };
    let canon = canonical(&app_dir);
    if roots.iter().any(|r| canonical(Path::new(&r.path)) == canon) {
        return roots;
    }
    let acc = Acc {
        canon,
        origins: vec!["portable".into()],
        source: RootSource::Auto,
        label: None,
        forced: true,
        portable: true,
    };
    roots.push(build_root(acc, false, now_ms()));
    roots
}

// ---- commands --------------------------------------------------------------

/// `content_candidates` — the standard per-OS locations, with exists/valid flags.
/// Cheap: no engine discovery or counts. Deduped by canonical path.
#[tauri::command]
async fn content_candidates<R: Runtime>(
    app: AppHandle<R>,
    include_zerok: Option<bool>,
) -> Result<CliResult, ()> {
    // Portable mode is self-contained: the only "candidate" is the app dir itself,
    // never the shared OS locations (which we don't even stat).
    let candidates = match portable_seed_dir() {
        Some(app_dir) => vec![Candidate {
            path: app_dir,
            origin: "portable".into(),
        }],
        None => {
            let base = base_dirs(&app, include_zerok.unwrap_or(false));
            candidate_roots(current_os(), &base)
        }
    };
    let mut seen: Vec<PathBuf> = Vec::new();
    let mut out: Vec<serde_json::Value> = Vec::new();
    for c in candidates {
        let canon = canonical(&c.path);
        if seen.contains(&canon) {
            continue;
        }
        seen.push(canon.clone());
        let exists = canon.is_dir();
        let valid = exists && scan::classify(&canon).is_some();
        out.push(json!({
            "path": display_path(&canon),
            "origin": c.origin,
            "exists": exists,
            "valid": valid,
        }));
    }
    Ok(CliResult::ok(json!({ "candidates": out })))
}

/// `content_state_load` — the persisted snapshot (the cross-plugin read API),
/// re-validated against disk so a folder/engine deleted between runs is reflected.
#[tauri::command]
async fn content_state_load<R: Runtime>(app: AppHandle<R>) -> Result<CliResult, ()> {
    let path = match store_path(&app) {
        Ok(p) => p,
        Err(e) => return Ok(CliResult::err(e)),
    };
    let store = match load_store(&path) {
        Ok(s) => s,
        Err(e) => return Ok(CliResult::err(e)),
    };
    let mut state = refresh_against_disk(store.snapshot.unwrap_or_default());
    state.roots = ensure_portable_seed(state.roots);
    Ok(CliResult::ok(json!({ "state": state })))
}

/// `content_rescan` — recompute roots/engines from scratch and persist.
#[tauri::command]
async fn content_rescan<R: Runtime>(
    app: AppHandle<R>,
    with_counts: Option<bool>,
    include_zerok: Option<bool>,
) -> Result<CliResult, ()> {
    let path = match store_path(&app) {
        Ok(p) => p,
        Err(e) => return Ok(CliResult::err(e)),
    };
    let store = match load_store(&path) {
        Ok(s) => s,
        Err(e) => return Ok(CliResult::err(e)),
    };
    let app2 = app.clone();
    let user_roots = store.user_roots.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let s = StoreFile {
            user_roots,
            ..Default::default()
        };
        compute_state(
            &app2,
            &s,
            with_counts.unwrap_or(true),
            include_zerok.unwrap_or(false),
        )
    })
    .await;
    let state = match result {
        Ok(s) => s,
        Err(e) => return Ok(CliResult::err(format!("rescan task failed: {e}"))),
    };
    if let Err(e) = persist(&path, store, &state) {
        return Ok(CliResult::err(e));
    }
    Ok(CliResult::ok(json!({ "state": state })))
}

/// `content_scan_root` — rescan a single tracked root, preserving its origins/
/// source, and update the snapshot entry. Returns the refreshed root.
#[tauri::command]
async fn content_scan_root<R: Runtime>(app: AppHandle<R>, path: String) -> Result<CliResult, ()> {
    let sp = match store_path(&app) {
        Ok(p) => p,
        Err(e) => return Ok(CliResult::err(e)),
    };
    let mut store = match load_store(&sp) {
        Ok(s) => s,
        Err(e) => return Ok(CliResult::err(e)),
    };
    let canon = canonical(Path::new(&path));

    // Reuse the existing snapshot entry's metadata if we have one.
    let existing = store.snapshot.as_ref().and_then(|s| {
        s.roots
            .iter()
            .find(|r| canonical(Path::new(&r.path)) == canon)
    });
    // A matching manual root; `portable` tracks whether it's stored relative.
    let manual = store
        .user_roots
        .iter()
        .find(|u| canonical(&resolve_stored(&u.path)) == canon);
    let is_manual = manual.is_some();
    let portable = manual.is_some_and(|u| Path::new(&u.path).is_relative());
    let acc = match existing {
        Some(r) => Acc {
            canon: canon.clone(),
            origins: r.origins.clone(),
            source: r.source,
            label: r.label.clone(),
            forced: r.forced.unwrap_or(false),
            portable,
        },
        None => Acc {
            canon: canon.clone(),
            origins: vec![if is_manual { "manual" } else { "scan" }.into()],
            source: if is_manual {
                RootSource::Manual
            } else {
                RootSource::Auto
            },
            label: None,
            forced: false,
            portable,
        },
    };

    let result =
        tauri::async_runtime::spawn_blocking(move || build_root(acc, true, now_ms())).await;
    let root = match result {
        Ok(r) => r,
        Err(e) => return Ok(CliResult::err(format!("scan task failed: {e}"))),
    };

    if let Some(snap) = store.snapshot.as_mut() {
        match snap.roots.iter_mut().find(|r| r.id == root.id) {
            Some(r) => *r = root.clone(),
            None => snap.roots.push(root.clone()),
        }
        let snapshot = snap.clone();
        if let Err(e) = persist(&sp, store, &snapshot) {
            return Ok(CliResult::err(e));
        }
    }
    Ok(CliResult::ok(json!({ "root": root })))
}

/// Add a root by canonical path: validate (unless `force`), record the user root
/// (relative when `portable`), recompute and persist, returning the new state.
fn add_root_inner<R: Runtime>(
    app: &AppHandle<R>,
    canon: &Path,
    label: Option<String>,
    force: bool,
    portable: bool,
) -> Result<ContentState, String> {
    let sp = store_path(app)?;
    let valid = canon.is_dir() && scan::classify(canon).is_some();
    if !valid && !force {
        return Err(
            "That folder doesn't look like a Spring data root (no engine/games/maps/rapid layout \
             or portable install). Add it anyway to force."
                .into(),
        );
    }
    // How to persist it: relative (portable) or absolute. Errors when a portable
    // root is explicitly requested for a folder outside the app dir.
    let stored = stored_root_path(portable, canon)?;
    let mut store = load_store(&sp)?;
    if !store
        .user_roots
        .iter()
        .any(|u| canonical(&resolve_stored(&u.path)) == canon)
    {
        store.user_roots.push(UserRoot {
            path: stored,
            label,
            forced: force && !valid,
        });
    }
    let state = compute_state(app, &store, true, false);
    persist(&sp, store, &state)?;
    Ok(state)
}

/// `content_add_root` — add a manually-picked root. Rejects non-roots unless
/// `force`, then recomputes and returns the full state.
#[tauri::command]
async fn content_add_root<R: Runtime>(
    app: AppHandle<R>,
    path: String,
    label: Option<String>,
    force: Option<bool>,
    portable: Option<bool>,
) -> Result<CliResult, ()> {
    let canon = canonical(Path::new(&path));
    match add_root_inner(
        &app,
        &canon,
        label,
        force.unwrap_or(false),
        portable.unwrap_or(false),
    ) {
        Ok(state) => Ok(CliResult::ok(json!({ "state": state }))),
        Err(e) => Ok(CliResult::err(e)),
    }
}

/// `content_create_standard_root` — create the OS-standard content folder on disk
/// and register it as a forced root (it is empty, so it fails the normal Spring
/// layout check). Returns the recomputed state, so the caller learns the new id.
#[tauri::command]
async fn content_create_standard_root<R: Runtime>(app: AppHandle<R>) -> Result<CliResult, ()> {
    let base = base_dirs(&app, false);
    let Some(path) = paths::standard_root_path(current_os(), &base) else {
        return Ok(CliResult::err(
            "No standard content location is known for this platform.",
        ));
    };
    if let Err(e) = std::fs::create_dir_all(&path) {
        return Ok(CliResult::err(format!(
            "Couldn't create {}: {e}",
            path.display()
        )));
    }
    let canon = canonical(&path);
    match add_root_inner(&app, &canon, None, true, false) {
        Ok(state) => Ok(CliResult::ok(json!({ "state": state }))),
        Err(e) => Ok(CliResult::err(e)),
    }
}

/// `content_remove_root` — remove a manual root (auto roots can't be removed).
#[tauri::command]
async fn content_remove_root<R: Runtime>(app: AppHandle<R>, path: String) -> Result<CliResult, ()> {
    let sp = match store_path(&app) {
        Ok(p) => p,
        Err(e) => return Ok(CliResult::err(e)),
    };
    let canon = canonical(Path::new(&path));
    let mut store = match load_store(&sp) {
        Ok(s) => s,
        Err(e) => return Ok(CliResult::err(e)),
    };
    store
        .user_roots
        .retain(|u| canonical(&resolve_stored(&u.path)) != canon);
    let state = compute_state(&app, &store, true, false);
    if let Err(e) = persist(&sp, store, &state) {
        return Ok(CliResult::err(e));
    }
    Ok(CliResult::ok(json!({ "state": state })))
}

/// `content_recreate_root` — recreate the on-disk folder for a configured root
/// whose directory was deleted, then re-register it as forced (an empty folder
/// fails the Spring-layout check, exactly as `content_create_standard_root`). The
/// path is expected to already be one of the user's roots.
#[tauri::command]
async fn content_recreate_root<R: Runtime>(
    app: AppHandle<R>,
    path: String,
) -> Result<CliResult, ()> {
    let sp = match store_path(&app) {
        Ok(p) => p,
        Err(e) => return Ok(CliResult::err(e)),
    };
    let target = resolve_stored(&path);
    if let Err(e) = std::fs::create_dir_all(&target) {
        return Ok(CliResult::err(format!(
            "Couldn't create {}: {e}",
            target.display()
        )));
    }
    let canon = canonical(&target);
    let mut store = match load_store(&sp) {
        Ok(s) => s,
        Err(e) => return Ok(CliResult::err(e)),
    };
    // Force the matching user root so the freshly-created (empty) folder validates.
    match store
        .user_roots
        .iter_mut()
        .find(|u| canonical(&resolve_stored(&u.path)) == canon)
    {
        Some(u) => u.forced = true,
        None => {
            // Not previously tracked — register it so the new folder is usable.
            let stored = match stored_root_path(false, &canon) {
                Ok(s) => s,
                Err(e) => return Ok(CliResult::err(e)),
            };
            store.user_roots.push(UserRoot {
                path: stored,
                label: None,
                forced: true,
            });
        }
    }
    let state = compute_state(&app, &store, true, false);
    if let Err(e) = persist(&sp, store, &state) {
        return Ok(CliResult::err(e));
    }
    Ok(CliResult::ok(json!({ "state": state })))
}

/// `content_list_engines`, every engine across tracked roots (read API).
///
/// Shares `content_state_load`'s re-anchoring. A snapshot copied from another
/// machine can leave only dead foreign roots, so this also runs
/// `ensure_portable_seed` after `refresh_against_disk` to recover a live portable
/// root before collecting engines (issue #539, following on from #524).
#[tauri::command]
async fn content_list_engines<R: Runtime>(app: AppHandle<R>) -> Result<CliResult, ()> {
    let path = match store_path(&app) {
        Ok(p) => p,
        Err(e) => return Ok(CliResult::err(e)),
    };
    let store = match load_store(&path) {
        Ok(s) => s,
        Err(e) => return Ok(CliResult::err(e)),
    };
    let mut state = refresh_against_disk(store.snapshot.unwrap_or_default());
    state.roots = ensure_portable_seed(state.roots);
    let engines: Vec<_> = state.roots.into_iter().flat_map(|r| r.engines).collect();
    Ok(CliResult::ok(json!({ "engines": engines })))
}

/// `content_verify_engine` — execute the engine binary to read its sync-version.
/// The engine must be one tracked in the snapshot and its executable must live
/// within its content root (refuses to run anything else).
#[tauri::command]
async fn content_verify_engine<R: Runtime>(
    app: AppHandle<R>,
    path: String,
) -> Result<CliResult, ()> {
    let sp = match store_path(&app) {
        Ok(p) => p,
        Err(e) => return Ok(CliResult::err(e)),
    };
    let mut store = match load_store(&sp) {
        Ok(s) => s,
        Err(e) => return Ok(CliResult::err(e)),
    };
    let Some(snap) = store.snapshot.as_mut() else {
        return Ok(CliResult::err("no scan yet — run a rescan first"));
    };

    let target = canonical(Path::new(&path));
    let mut found: Option<(usize, usize)> = None;
    'outer: for (ri, r) in snap.roots.iter().enumerate() {
        for (ei, e) in r.engines.iter().enumerate() {
            if canonical(Path::new(&e.executable)) == target
                || canonical(Path::new(&e.path)) == target
            {
                found = Some((ri, ei));
                break 'outer;
            }
        }
    }
    let Some((ri, ei)) = found else {
        return Ok(CliResult::err(
            "engine not found in tracked roots — rescan first",
        ));
    };

    // Security: the executable must be inside its content root.
    let root_canon = canonical(Path::new(&snap.roots[ri].path));
    let exe = PathBuf::from(snap.roots[ri].engines[ei].executable.clone());
    if !canonical(&exe).starts_with(&root_canon) {
        return Ok(CliResult::err(
            "engine executable is outside its content root — refusing to run",
        ));
    }

    let exe2 = exe.clone();
    let result =
        tauri::async_runtime::spawn_blocking(move || engine::read_version(&exe2, VERIFY_TIMEOUT))
            .await;
    let version = match result {
        Ok(Ok(v)) => v,
        Ok(Err(e)) => return Ok(CliResult::err(e)),
        Err(e) => return Ok(CliResult::err(format!("verify task failed: {e}"))),
    };

    let now = now_ms();
    snap.roots[ri].engines[ei].sync_version = Some(version);
    snap.roots[ri].engines[ei].verified_at = Some(now);
    let engine = snap.roots[ri].engines[ei].clone();
    let snapshot = snap.clone();
    if let Err(e) = persist(&sp, store, &snapshot) {
        return Ok(CliResult::err(e));
    }
    Ok(CliResult::ok(json!({ "engine": engine })))
}

/// `content_open_path` — reveal a content folder (or an engine's directory) in
/// the OS file manager. Runs the platform open command directly instead of the
/// frontend opener plugin, so any user content root opens regardless of the
/// opener capability's path scope (which can't enumerate arbitrary user folders).
#[tauri::command]
async fn content_open_path(path: String) -> Result<CliResult, ()> {
    if !Path::new(&path).exists() {
        return Ok(CliResult::err(format!("path does not exist: {path}")));
    }
    let program = if cfg!(target_os = "macos") {
        "open"
    } else if cfg!(target_os = "windows") {
        "explorer"
    } else {
        "xdg-open"
    };
    match std::process::Command::new(program).arg(&path).spawn() {
        Ok(_) => Ok(CliResult::ok(json!({}))),
        Err(e) => Ok(CliResult::err(format!("failed to open {path}: {e}"))),
    }
}

/// `content_list_replays` — list demo files under `<root>/demos` and
/// `<root>/replays`, and in the same folders of every engine installed under the
/// root (fast fs metadata, no decoding). `root` is a `ContentRoot.path`.
#[tauri::command]
async fn content_list_replays(root: String) -> Result<CliResult, ()> {
    let p = PathBuf::from(&root);
    match tauri::async_runtime::spawn_blocking(move || demo::list_replays(&p)).await {
        Ok(replays) => Ok(CliResult::ok(json!({ "replays": replays }))),
        Err(e) => Ok(CliResult::err(format!("list replays task failed: {e}"))),
    }
}

/// `content_demo_info` — decode one replay: native header + start-script (map,
/// game, players, sides, ally-teams) plus demotool's winner. `enginePath` is an
/// `Engine.path` (where `demotool` lives); `replayPath` an absolute demo path.
#[tauri::command]
async fn content_demo_info(engine_path: String, replay_path: String) -> Result<CliResult, ()> {
    let engine = PathBuf::from(&engine_path);
    let demo_path = PathBuf::from(&replay_path);
    match tauri::async_runtime::spawn_blocking(move || demo::demo_info(&engine, &demo_path)).await {
        Ok(Ok(info)) => Ok(CliResult::ok(json!({ "info": info }))),
        Ok(Err(e)) => Ok(CliResult::err(e)),
        Err(e) => Ok(CliResult::err(format!("demo info task failed: {e}"))),
    }
}

/// `content_stats_ingest` — incrementally parse every replay under `roots` into the
/// local stats database, decoding only files new or changed since the last pass
/// (idempotent, keyed by filename). `enginePath` locates `demotool` for the winner
/// read; when empty/absent the native decode still records map/players/game. With
/// `dryRun`, the pass runs but the store isn't written (returns the would-be
/// summary). `roots` are `ContentRoot.path`s. Runs off the UI thread.
#[tauri::command]
async fn content_stats_ingest<R: Runtime>(
    app: AppHandle<R>,
    roots: Vec<String>,
    engine_path: String,
    dry_run: Option<bool>,
) -> Result<CliResult, ()> {
    let sp = match stats_path(&app) {
        Ok(p) => p,
        Err(e) => return Ok(CliResult::err(e)),
    };
    let dry_run = dry_run.unwrap_or(false);
    let res = tauri::async_runtime::spawn_blocking(move || {
        let mut store = stats::load(&sp)?;
        let root_paths: Vec<PathBuf> = roots.iter().map(PathBuf::from).collect();
        let engine_dir = PathBuf::from(&engine_path);
        let summary = stats::ingest(&root_paths, &engine_dir, &mut store);
        if !dry_run {
            stats::save(&sp, &store)?;
        }
        Ok::<_, String>((summary, store))
    })
    .await;
    match res {
        Ok(Ok((summary, store))) => Ok(CliResult::ok(
            json!({ "summary": summary, "records": store.records }),
        )),
        Ok(Err(e)) => Ok(CliResult::err(e)),
        Err(e) => Ok(CliResult::err(format!("stats ingest task failed: {e}"))),
    }
}

/// `content_stats_query` — return the whole local stats record set (the flat table
/// every stats view aggregates over). Read-only; never triggers an ingest.
#[tauri::command]
async fn content_stats_query<R: Runtime>(app: AppHandle<R>) -> Result<CliResult, ()> {
    let sp = match stats_path(&app) {
        Ok(p) => p,
        Err(e) => return Ok(CliResult::err(e)),
    };
    match tauri::async_runtime::spawn_blocking(move || stats::load(&sp)).await {
        Ok(Ok(store)) => Ok(CliResult::ok(json!({ "records": store.records }))),
        Ok(Err(e)) => Ok(CliResult::err(e)),
        Err(e) => Ok(CliResult::err(format!("stats query task failed: {e}"))),
    }
}

/// `content_stats_watch_start` (#462): start (or restart) the live filesystem
/// watcher over `roots`' demos/replays folders, so a newly-arrived replay is
/// ingested as it lands rather than only on the next scan-on-open. Idempotent:
/// replaces any watcher already running. `enginePath` is used the same way as
/// [`content_stats_ingest`]'s. A watcher that fails to start (e.g. the OS watch
/// couldn't be constructed) reports an error but never crashes the app,
/// scan-on-open keeps working regardless.
#[tauri::command]
async fn content_stats_watch_start<R: Runtime>(
    app: AppHandle<R>,
    roots: Vec<String>,
    engine_path: String,
) -> Result<CliResult, ()> {
    let sp = match stats_path(&app) {
        Ok(p) => p,
        Err(e) => return Ok(CliResult::err(e)),
    };
    let root_paths: Vec<PathBuf> = roots.iter().map(PathBuf::from).collect();
    let engine_dir = PathBuf::from(&engine_path);
    match stats_watcher::start(app, root_paths, engine_dir, sp) {
        Ok(()) => Ok(CliResult::ok(json!({ "watching": true }))),
        Err(e) => Ok(CliResult::err(e)),
    }
}

/// `content_stats_watch_stop` (#462): stop the live filesystem watcher, if one
/// is running. Idempotent.
#[tauri::command]
fn content_stats_watch_stop() -> Result<CliResult, ()> {
    stats_watcher::stop();
    Ok(CliResult::ok(json!({ "watching": false })))
}

/// `content_demo_chat` — extract a replay's chat log (its `NETMSG_CHAT`/`SYSTEMMSG`
/// lines) by running `demotool --dump`. `enginePath` holds `demotool`; `replayPath`
/// is an absolute demo path. Read on demand (it walks the whole demo stream), not
/// during listing.
#[tauri::command]
async fn content_demo_chat(engine_path: String, replay_path: String) -> Result<CliResult, ()> {
    let engine = PathBuf::from(&engine_path);
    let demo_path = PathBuf::from(&replay_path);
    match tauri::async_runtime::spawn_blocking(move || demo::demo_chat(&engine, &demo_path)).await {
        Ok(Ok(chat)) => Ok(CliResult::ok(json!(chat))),
        Ok(Err(e)) => Ok(CliResult::err(e)),
        Err(e) => Ok(CliResult::err(format!("demo chat task failed: {e}"))),
    }
}

/// `content_rewrite_demo` — write a "remixed" **copy** of a replay whose
/// embedded `gametype` is `targetGametype` (and, when `engineVersion` is given,
/// whose header engine version is restamped), so the engine loads a different
/// local game build when the copy is watched. Returns the new sibling path; the
/// source is never modified (see `demo::rewrite_demo`). `replayPath` is an
/// absolute demo path from `content_list_replays`.
#[tauri::command]
async fn content_rewrite_demo(
    replay_path: String,
    target_gametype: String,
    engine_version: Option<String>,
) -> Result<CliResult, ()> {
    let src = PathBuf::from(&replay_path);
    match tauri::async_runtime::spawn_blocking(move || {
        demo::rewrite_demo(&src, &target_gametype, engine_version.as_deref())
    })
    .await
    {
        Ok(Ok(path)) => Ok(CliResult::ok(json!({ "path": path.to_string_lossy() }))),
        Ok(Err(e)) => Ok(CliResult::err(e)),
        Err(e) => Ok(CliResult::err(format!("rewrite demo task failed: {e}"))),
    }
}

/// `content_list_saves` — list singleplayer savegames under `<root>/Saves` (fast
/// fs metadata + a best-effort map/game read). `root` is a `ContentRoot.path`.
#[tauri::command]
async fn content_list_saves(root: String) -> Result<CliResult, ()> {
    let p = PathBuf::from(&root);
    match tauri::async_runtime::spawn_blocking(move || savegame::list_saves(&p)).await {
        Ok(saves) => Ok(CliResult::ok(json!({ "saves": saves }))),
        Err(e) => Ok(CliResult::err(format!("list saves task failed: {e}"))),
    }
}

/// `content_delete_save` — delete one savegame file. `path` must be a `.ssf`/`.slsf`
/// path from `content_list_saves` (guarded against deleting anything else).
#[tauri::command]
async fn content_delete_save(path: String) -> Result<CliResult, ()> {
    let p = PathBuf::from(&path);
    let ok_ext = p
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.eq_ignore_ascii_case("ssf") || e.eq_ignore_ascii_case("slsf"))
        .unwrap_or(false);
    if !ok_ext {
        return Ok(CliResult::err("not a savegame file".to_string()));
    }
    match std::fs::remove_file(&p) {
        Ok(()) => Ok(CliResult::ok(json!({ "ok": true }))),
        Err(e) => Ok(CliResult::err(format!("delete failed: {e}"))),
    }
}

/// `content_delete_replay` — delete one replay file. `path` must be a `.sdfz`/`.sdf`
/// path from `content_list_replays` (guarded against deleting anything else).
#[tauri::command]
async fn content_delete_replay(path: String) -> Result<CliResult, ()> {
    let p = PathBuf::from(&path);
    if !demo::is_replay_path(&p) {
        return Ok(CliResult::err("not a replay file".to_string()));
    }
    match std::fs::remove_file(&p) {
        Ok(()) => Ok(CliResult::ok(json!({ "ok": true }))),
        Err(e) => Ok(CliResult::err(format!("delete failed: {e}"))),
    }
}

/// `content_delete_replays`: delete a batch of replays, for the storage screen's
/// bulk cleanup (issue #386). Each path is guarded the same way
/// `content_delete_replay` guards its one, and a path that fails is skipped with a
/// reason rather than aborting the batch. `apply=false` sizes the batch without
/// deleting. See [`demo::delete_replays`].
#[tauri::command]
async fn content_delete_replays(paths: Vec<String>, apply: bool) -> Result<CliResult, ()> {
    let paths: Vec<PathBuf> = paths.iter().map(PathBuf::from).collect();
    match tauri::async_runtime::spawn_blocking(move || demo::delete_replays(&paths, apply)).await {
        Ok(summary) => Ok(CliResult::ok(json!({ "summary": summary }))),
        Err(e) => Ok(CliResult::err(format!("delete replays task failed: {e}"))),
    }
}

/// `content_delete_archive`: delete one downloaded game or map archive and
/// report the bytes it freed. `path` is an on-disk archive path from a scan.
/// Guarded by [`archives::classify`], which refuses anything outside a content
/// root's `games`/`maps`/`packages` so the engine's base archives cannot go.
#[tauri::command]
async fn content_delete_archive(path: String) -> Result<CliResult, ()> {
    let p = PathBuf::from(&path);
    match tauri::async_runtime::spawn_blocking(move || archives::delete(&p)).await {
        Ok(Ok(bytes)) => Ok(CliResult::ok(json!({ "bytes": bytes }))),
        Ok(Err(e)) => Ok(CliResult::err(e)),
        Err(e) => Ok(CliResult::err(format!("delete archive task failed: {e}"))),
    }
}

/// `content_gather_replays`: move the replays sitting inside each installed
/// engine's own folder into the root's `demos/`, so deleting an old engine
/// folder does not take them (issue #971). `apply` false previews without moving
/// anything. `root` is a `ContentRoot.path`. See [`demo::gather_replays`].
#[tauri::command]
async fn content_gather_replays(root: String, apply: bool) -> Result<CliResult, ()> {
    let p = PathBuf::from(&root);
    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    match tauri::async_runtime::spawn_blocking(move || demo::gather_replays(&p, apply, now_ms))
        .await
    {
        Ok(summary) => Ok(CliResult::ok(json!({ "summary": summary }))),
        Err(e) => Ok(CliResult::err(format!("gather replays task failed: {e}"))),
    }
}

/// `content_export_build_tree_html` — write a single self-contained build-tree
/// export HTML file (built entirely by the frontend) to a caller-chosen path.
/// Opaque: the frontend owns the markup and picks the destination via the save
/// dialog (mirrors `campaign_export`).
#[tauri::command]
async fn content_export_build_tree_html(dest: String, html: String) -> Result<CliResult, ()> {
    Ok(match build_tree_export::write_html(&dest, &html) {
        Ok(()) => CliResult::ok(json!({})),
        Err(e) => CliResult::err(e),
    })
}

/// `content_export_build_tree_zip` — assemble the build-tree export zip
/// (`index.html` + `images/` + `assets/`) at a caller-chosen path from the file
/// set the frontend serialized. Image bytes arrive base64-encoded and are decoded
/// here; text files (html/css/js) are written UTF-8.
#[tauri::command]
async fn content_export_build_tree_zip(
    dest: String,
    files: Vec<build_tree_export::ExportFile>,
) -> Result<CliResult, ()> {
    Ok(match build_tree_export::write_zip(&dest, &files) {
        Ok(()) => CliResult::ok(json!({})),
        Err(e) => CliResult::err(e),
    })
}

/// `content_export_challenge`, write a caller-serialized challenge container
/// (the pretty-printed JSON text from `code.ts`'s `encodeChallengeFile`) to a
/// caller-chosen path. Opaque, the frontend owns the container format and picks
/// the destination via the save dialog (mirrors `campaign_export`, issue #476).
#[tauri::command]
async fn content_export_challenge(dest: String, text: String) -> Result<CliResult, ()> {
    Ok(match std::fs::write(&dest, text) {
        Ok(()) => CliResult::ok(json!({})),
        Err(e) => CliResult::err(format!("could not write challenge export: {e}")),
    })
}

/// `content_import_challenge`, read a challenge file the user picked and hand its
/// raw text back for the frontend to decode through the same `decodeChallenge` a
/// pasted code uses (issue #476).
#[tauri::command]
async fn content_import_challenge(src: String) -> Result<CliResult, ()> {
    Ok(match std::fs::read_to_string(&src) {
        Ok(text) => CliResult::ok(json!({ "text": text })),
        Err(e) => CliResult::err(format!("could not read challenge import: {e}")),
    })
}

/// `branding_catalog` — fetch the remote branding catalog JSON, disk-cache it, and
/// fall back to the cache then the bundled seed on network failure. Returns the
/// raw JSON text; the frontend parses/matches it (Rust stays schema-agnostic).
#[tauri::command]
async fn branding_catalog<R: Runtime>(app: AppHandle<R>, url: String) -> Result<CliResult, ()> {
    let cache_file = coilbox_portable::cache_dir(&app)
        .ok()
        .map(|d| d.join("coilbox-branding").join("catalog.json"));
    // The bundled seed. `catalog.json` moved to the repo root and is bundled via the
    // `../catalog.json` resource entry; the exact in-bundle location can vary by
    // bundler, so probe a few candidates and take the first that exists (the old
    // `branding/` layout is kept last for older installs). Missing => None (the
    // fetch is network-first anyway, with the disk cache in between).
    let seed_file = app.path().resource_dir().ok().and_then(|d| {
        ["catalog.json", "_up_/catalog.json", "branding/catalog.json"]
            .into_iter()
            .map(|p| d.join(p))
            .find(|p| p.exists())
    });
    let res = branding::resolve_catalog(&url, cache_file, seed_file).await;
    Ok(CliResult::ok(json!(res)))
}

/// `branding_image` — fetch the first working image URL (https only), cache it
/// once as a `data:` URL keyed by URL hash, and return it. Empty `dataUrl` = the
/// UI falls back to the game's own art / gradient. When `reencode` is set (opaque
/// photographic art — banners, screenshots), decodable rasters are downsampled and
/// JPEG-encoded to bound the cached data URL; logos pass through untouched.
#[tauri::command]
async fn branding_image<R: Runtime>(
    app: AppHandle<R>,
    urls: Vec<String>,
    reencode: bool,
) -> Result<CliResult, ()> {
    let cache_dir = coilbox_portable::cache_dir(&app)
        .ok()
        .map(|d| d.join("coilbox-branding-images"));
    let data_url = branding::resolve_image(&urls, cache_dir, reencode).await;
    Ok(CliResult::ok(json!({ "dataUrl": data_url })))
}

/// Directory holding engine-config profile snapshots, under the app data dir.
fn profiles_dir<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    Ok(coilbox_portable::data_dir(app)?.join("engine-config-profiles"))
}

/// `content_config_profiles` — list saved engine-config snapshots for a content
/// root (its `springsettings.cfg` / `LuaUI/Config` / `uikeys.txt`). `rootPath` is a
/// `ContentRoot.path`.
#[tauri::command]
async fn content_config_profiles<R: Runtime>(
    app: AppHandle<R>,
    root_path: String,
) -> Result<CliResult, ()> {
    let dir = match profiles_dir(&app) {
        Ok(d) => d,
        Err(e) => return Ok(CliResult::err(e)),
    };
    let profiles =
        tauri::async_runtime::spawn_blocking(move || settings_backup::list(&dir, &root_path)).await;
    match profiles {
        Ok(profiles) => Ok(CliResult::ok(json!({ "profiles": profiles }))),
        Err(e) => Ok(CliResult::err(format!("list profiles task failed: {e}"))),
    }
}

/// `content_config_backup` — snapshot a root's present engine-config artifacts into
/// a named profile (re-saving the name replaces it).
#[tauri::command]
async fn content_config_backup<R: Runtime>(
    app: AppHandle<R>,
    root_path: String,
    name: String,
) -> Result<CliResult, ()> {
    let dir = match profiles_dir(&app) {
        Ok(d) => d,
        Err(e) => return Ok(CliResult::err(e)),
    };
    let res = tauri::async_runtime::spawn_blocking(move || {
        settings_backup::backup(&dir, &root_path, &name)
    })
    .await;
    match res {
        Ok(Ok(profile)) => Ok(CliResult::ok(json!({ "profile": profile }))),
        Ok(Err(e)) => Ok(CliResult::err(e)),
        Err(e) => Ok(CliResult::err(format!("backup task failed: {e}"))),
    }
}

/// `content_config_restore` — restore a named profile's artifacts into the root.
/// With `overwrite` unset, refuses (returning `needsOverwrite`) when live files
/// would be clobbered, so the UI can confirm first. `slug` is `ProfileInfo.slug`.
#[tauri::command]
async fn content_config_restore<R: Runtime>(
    app: AppHandle<R>,
    root_path: String,
    slug: String,
    overwrite: Option<bool>,
) -> Result<CliResult, ()> {
    let dir = match profiles_dir(&app) {
        Ok(d) => d,
        Err(e) => return Ok(CliResult::err(e)),
    };
    let overwrite = overwrite.unwrap_or(false);
    let res = tauri::async_runtime::spawn_blocking(move || {
        settings_backup::restore(&dir, &root_path, &slug, overwrite)
    })
    .await;
    match res {
        Ok(Ok(outcome)) => Ok(CliResult::ok(json!(outcome))),
        Ok(Err(e)) => Ok(CliResult::err(e)),
        Err(e) => Ok(CliResult::err(format!("restore task failed: {e}"))),
    }
}

/// `content_config_delete_profile` — delete a named engine-config snapshot.
#[tauri::command]
async fn content_config_delete_profile<R: Runtime>(
    app: AppHandle<R>,
    root_path: String,
    slug: String,
) -> Result<CliResult, ()> {
    let dir = match profiles_dir(&app) {
        Ok(d) => d,
        Err(e) => return Ok(CliResult::err(e)),
    };
    let res = tauri::async_runtime::spawn_blocking(move || {
        settings_backup::delete(&dir, &root_path, &slug)
    })
    .await;
    match res {
        Ok(Ok(())) => Ok(CliResult::ok(json!({ "ok": true }))),
        Ok(Err(e)) => Ok(CliResult::err(e)),
        Err(e) => Ok(CliResult::err(format!("delete profile task failed: {e}"))),
    }
}

/// `content_warm_rapid_pool` — background-read every `packages/*.sdp` manifest
/// across the given roots into the OS page cache so the engine's first rapid-tag
/// resolution is warm. Manifests only; returns a cache-warm summary.
#[tauri::command]
async fn content_warm_rapid_pool(roots: Vec<String>) -> Result<CliResult, ()> {
    let paths: Vec<PathBuf> = roots.iter().map(PathBuf::from).collect();
    match tauri::async_runtime::spawn_blocking(move || rapid_pool::warm(&paths)).await {
        Ok(summary) => Ok(CliResult::ok(json!({ "summary": summary }))),
        Err(e) => Ok(CliResult::err(format!("warm task failed: {e}"))),
    }
}

/// `content_prune_rapid_pool` — reclaim orphaned rapid pool data under `root`
/// (pool blobs referenced by no on-disk `.sdp`, plus `*.incomplete` leftovers).
/// `apply=false` is a dry run that computes the summary without deleting.
#[tauri::command]
async fn content_prune_rapid_pool(root: String, apply: bool) -> Result<CliResult, ()> {
    let res =
        tauri::async_runtime::spawn_blocking(move || rapid_pool::prune(Path::new(&root), apply))
            .await;
    match res {
        Ok(Ok(summary)) => Ok(CliResult::ok(json!({ "summary": summary }))),
        Ok(Err(e)) => Ok(CliResult::err(e)),
        Err(e) => Ok(CliResult::err(format!("prune task failed: {e}"))),
    }
}

/// `content_reclaim_caches` — size (and, when `apply`, clear) the app's grow-only
/// generated-image / info caches under the app cache dir. `apply=false` is a dry
/// run that reports per-cache sizes without deleting. Every cache regenerates on
/// demand, so clearing is always safe.
#[tauri::command]
async fn content_reclaim_caches<R: Runtime>(
    app: AppHandle<R>,
    apply: Option<bool>,
) -> Result<CliResult, ()> {
    let cache_root = match coilbox_portable::cache_dir(&app) {
        Ok(d) => d,
        Err(e) => return Ok(CliResult::err(e)),
    };
    let apply = apply.unwrap_or(false);
    match tauri::async_runtime::spawn_blocking(move || caches::reclaim(&cache_root, apply)).await {
        Ok(summary) => Ok(CliResult::ok(json!({ "summary": summary }))),
        Err(e) => Ok(CliResult::err(format!("reclaim task failed: {e}"))),
    }
}

/// `content_storage_overview`: where one content root's disk has gone, broken
/// down by engines, games, maps, replays, saves, the rapid pool and everything
/// else (issue #386). One root per call, so the UI can render each as it lands.
/// A recursive walk of a large pool is not instant. See [`storage::overview`].
#[tauri::command]
async fn content_storage_overview(root: String) -> Result<CliResult, ()> {
    let p = PathBuf::from(&root);
    match tauri::async_runtime::spawn_blocking(move || storage::overview(&p)).await {
        Ok(overview) => Ok(CliResult::ok(json!({ "overview": overview }))),
        Err(e) => Ok(CliResult::err(format!("storage overview task failed: {e}"))),
    }
}

/// `content_delete_engine`: remove one installed engine directory and report the
/// bytes it freed. Guarded by [`storage::delete_engine`], which only accepts a
/// real directory sitting inside a folder named `engine`, so the command cannot
/// be turned into an arbitrary recursive delete.
#[tauri::command]
async fn content_delete_engine(path: String) -> Result<CliResult, ()> {
    let p = PathBuf::from(&path);
    match tauri::async_runtime::spawn_blocking(move || storage::delete_engine(&p)).await {
        Ok(Ok(bytes)) => Ok(CliResult::ok(json!({ "bytes": bytes }))),
        Ok(Err(e)) => Ok(CliResult::err(e)),
        Err(e) => Ok(CliResult::err(format!("delete engine task failed: {e}"))),
    }
}

/// Build the plugin. Registered as `"coilbox-content"`; the frontend invokes
/// `plugin:coilbox-content|<cmd>`.
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("coilbox-content")
        .invoke_handler(tauri::generate_handler![
            content_candidates,
            content_state_load,
            content_rescan,
            content_scan_root,
            content_add_root,
            content_create_standard_root,
            content_recreate_root,
            content_remove_root,
            content_list_engines,
            content_verify_engine,
            content_open_path,
            content_list_replays,
            content_demo_info,
            content_stats_ingest,
            content_stats_query,
            content_stats_watch_start,
            content_stats_watch_stop,
            content_demo_chat,
            content_rewrite_demo,
            content_delete_replay,
            content_delete_replays,
            content_delete_archive,
            content_gather_replays,
            content_list_saves,
            content_delete_save,
            content_config_profiles,
            content_config_backup,
            content_config_restore,
            content_config_delete_profile,
            content_warm_rapid_pool,
            content_prune_rapid_pool,
            content_reclaim_caches,
            content_storage_overview,
            content_delete_engine,
            content_export_build_tree_html,
            content_export_build_tree_zip,
            content_export_challenge,
            content_import_challenge,
            branding_catalog,
            branding_image
        ])
        // Stop the replay watcher (#462) cleanly when the app is shutting
        // down, rather than leaving its background thread to be torn down by
        // process exit.
        .on_event(|_app, event| {
            if let tauri::RunEvent::Exit = event {
                stats_watcher::stop();
            }
        })
        .build()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolve_stored_passes_absolute_through() {
        let abs = if cfg!(windows) {
            "C:\\data\\spring"
        } else {
            "/data/spring"
        };
        assert_eq!(resolve_stored(abs), PathBuf::from(abs));
    }

    #[test]
    fn resolve_stored_joins_relative_onto_app_dir() {
        let r = resolve_stored("game-data");
        // Resolved against the app dir (here the test binary's dir): absolute and
        // ending in the relative component.
        assert!(r.is_absolute());
        assert!(r.ends_with("game-data"));
    }

    fn cand(path: &str, origin: &str) -> Candidate {
        Candidate {
            path: PathBuf::from(path),
            origin: origin.into(),
        }
    }

    #[test]
    fn auto_accs_portable_seeds_single_forced_root() {
        let app = if cfg!(windows) { "C:\\pkg" } else { "/pkg" };
        // Even with shared candidates present, portable mode ignores them and
        // seeds exactly one root at the app dir.
        let accs = auto_accs(
            Some(PathBuf::from(app)),
            vec![
                cand("/home/u/.spring", "prd-default"),
                cand("/opt/bar", "bar"),
            ],
        );
        assert_eq!(accs.len(), 1);
        let a = &accs[0];
        assert_eq!(a.canon, PathBuf::from(app));
        assert_eq!(a.origins, vec!["portable".to_string()]);
        assert!(
            a.forced,
            "seeded root must be forced so an empty package keeps it"
        );
        assert!(a.portable, "seeded root is stored relative to the app dir");
        assert!(a.source == RootSource::Auto);
    }

    #[test]
    fn auto_accs_non_portable_merges_candidates() {
        // Not portable: candidates become auto roots, deduped by path (origins merged),
        // never forced or portable.
        let accs = auto_accs(
            None,
            vec![
                cand("/home/u/.spring", "prd-default"),
                cand("/home/u/.spring", "springlobby"),
                cand("/opt/bar", "bar"),
            ],
        );
        assert_eq!(accs.len(), 2);
        let spring = accs
            .iter()
            .find(|a| a.canon.to_str() == Some("/home/u/.spring"))
            .unwrap();
        assert_eq!(
            spring.origins,
            vec!["prd-default".to_string(), "springlobby".to_string()]
        );
        assert!(!spring.forced);
        assert!(!spring.portable);
        assert!(spring.source == RootSource::Auto);
    }

    #[test]
    fn stored_root_path_errors_when_portable_outside_app_dir() {
        let far = if cfg!(windows) {
            Path::new("C:\\definitely\\not\\under\\the\\app\\zzz")
        } else {
            Path::new("/definitely/not/under/the/app/zzz")
        };
        assert!(stored_root_path(true, far).is_err());
    }

    #[test]
    fn stored_root_path_absolute_when_not_portable() {
        let p = if cfg!(windows) {
            Path::new("C:\\data\\spring")
        } else {
            Path::new("/data/spring")
        };
        assert_eq!(stored_root_path(false, p).unwrap(), display_path(p));
    }

    /// A snapshot root with the (stale) `exists: true` and inflated counts a real
    /// snapshot carries at scan time.
    fn stale_root(path: &str, source: RootSource, forced: bool) -> ContentRoot {
        ContentRoot {
            id: hash_id(&[path]),
            path: path.into(),
            source,
            kind: RootKind::Data,
            label: None,
            origins: Vec::new(),
            exists: true,
            valid: true,
            portable: false,
            forced: if forced { Some(true) } else { None },
            counts: RootCounts {
                games: 9,
                maps: 9,
                engines: 9,
                packages: 9,
            },
            engines: Vec::new(),
            last_scanned_at: Some(0),
        }
    }

    #[test]
    fn refresh_against_disk_revalidates_roots() {
        let base = std::env::temp_dir().join("coilbox_refresh_against_disk_test");
        let _ = std::fs::remove_dir_all(&base);
        let live = base.join("live");
        std::fs::create_dir_all(live.join("games")).unwrap(); // valid Data layout
        let empty = base.join("empty");
        std::fs::create_dir_all(&empty).unwrap(); // exists but not a Spring root
        let gone = base.join("gone"); // never created

        let state = ContentState {
            schema_version: SCHEMA_VERSION,
            roots: vec![
                stale_root(&display_path(&live), RootSource::Manual, false),
                stale_root(&display_path(&empty), RootSource::Manual, true), // forced-empty
                stale_root(&display_path(&gone), RootSource::Manual, false), // vanished manual
                stale_root(&display_path(&gone), RootSource::Auto, false),   // vanished auto
            ],
            last_scan_at: Some(0),
        };

        let out = refresh_against_disk(state);
        // The dead auto root is dropped; all three manual roots survive.
        assert_eq!(out.roots.len(), 3);

        let find = |p: &std::path::Path, src: RootSource| {
            out.roots
                .iter()
                .find(|r| r.path == display_path(p) && r.source == src)
                .unwrap()
        };
        let live_r = find(&live, RootSource::Manual);
        assert!(live_r.exists && live_r.valid);

        let empty_r = find(&empty, RootSource::Manual);
        assert!(empty_r.exists, "empty folder still exists");
        assert!(empty_r.valid, "forced root stays valid even when empty");

        let gone_r = find(&gone, RootSource::Manual);
        assert!(!gone_r.exists, "deleted folder is detected as gone");
        assert!(!gone_r.valid, "gone, unforced root is invalid");
        assert_eq!(gone_r.counts.games, 0, "stale counts zeroed when gone");

        let _ = std::fs::remove_dir_all(&base);
    }

    /// A Windows-style drive path off Windows (or a POSIX path on Windows) as a
    /// stored root path, the shape a `state.json` copied cross-machine carries.
    fn foreign_path() -> &'static str {
        if cfg!(windows) {
            "/Users/someone/Coilbox-master"
        } else {
            r"E:\Coilbox-master"
        }
    }

    #[test]
    fn refresh_against_disk_drops_foreign_auto_root_even_when_forced() {
        let state = ContentState {
            schema_version: SCHEMA_VERSION,
            roots: vec![stale_root(foreign_path(), RootSource::Auto, true)],
            last_scan_at: Some(0),
        };
        let out = refresh_against_disk(state);
        assert!(
            out.roots.is_empty(),
            "a foreign-OS path is never a live root, forced or not"
        );
    }

    #[test]
    fn refresh_against_disk_drops_foreign_manual_root_instead_of_offering_recreate() {
        let state = ContentState {
            schema_version: SCHEMA_VERSION,
            roots: vec![stale_root(foreign_path(), RootSource::Manual, false)],
            last_scan_at: Some(0),
        };
        let out = refresh_against_disk(state);
        assert!(
            out.roots.is_empty(),
            "a foreign manual root can never be recreated here, so it is dropped"
        );
    }

    #[test]
    fn refresh_against_disk_keeps_valid_local_root_alongside_a_dropped_foreign_one() {
        let base = std::env::temp_dir().join("coilbox_refresh_mixed_paths_test");
        let _ = std::fs::remove_dir_all(&base);
        std::fs::create_dir_all(base.join("games")).unwrap();

        let state = ContentState {
            schema_version: SCHEMA_VERSION,
            roots: vec![
                stale_root(&display_path(&base), RootSource::Manual, false),
                stale_root(foreign_path(), RootSource::Auto, true),
            ],
            last_scan_at: Some(0),
        };
        let out = refresh_against_disk(state);
        assert_eq!(out.roots.len(), 1);
        assert!(out.roots[0].exists && out.roots[0].valid);

        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn refresh_against_disk_forced_root_is_invalid_once_it_vanishes() {
        let base = std::env::temp_dir().join("coilbox_refresh_forced_gone_test");
        let _ = std::fs::remove_dir_all(&base); // never created: simulates a gone folder

        let state = ContentState {
            schema_version: SCHEMA_VERSION,
            roots: vec![stale_root(&display_path(&base), RootSource::Auto, true)],
            last_scan_at: Some(0),
        };
        let out = refresh_against_disk(state);
        assert!(
            out.roots.is_empty(),
            "forced must not keep a vanished auto root reporting itself as valid"
        );
    }

    #[test]
    fn ensure_portable_seed_in_noop_without_a_portable_app_dir() {
        let roots = vec![stale_root("/some/path", RootSource::Manual, false)];
        let out = ensure_portable_seed_in(roots.clone(), None);
        assert_eq!(out.len(), roots.len());
    }

    #[test]
    fn ensure_portable_seed_in_injects_a_fresh_root_when_absent() {
        let base = std::env::temp_dir().join("coilbox_ensure_portable_seed_test");
        let _ = std::fs::remove_dir_all(&base);
        std::fs::create_dir_all(&base).unwrap();

        let out = ensure_portable_seed_in(Vec::new(), Some(base.clone()));
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].path, display_path(&canonical(&base)));
        assert!(out[0].portable);
        assert_eq!(out[0].forced, Some(true));
        assert!(out[0].exists);

        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn ensure_portable_seed_in_does_not_duplicate_an_existing_entry() {
        let base = std::env::temp_dir().join("coilbox_ensure_portable_seed_dup_test");
        let _ = std::fs::remove_dir_all(&base);
        std::fs::create_dir_all(&base).unwrap();
        let existing = stale_root(&display_path(&canonical(&base)), RootSource::Auto, true);

        let out = ensure_portable_seed_in(vec![existing], Some(base.clone()));
        assert_eq!(out.len(), 1, "an already-fresh app-dir entry is left alone");

        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn ensure_portable_seed_in_recovers_after_a_dead_cross_machine_snapshot() {
        // Issue #524: the only root in a copied snapshot is a dead foreign path
        // baked in on another machine. Once `refresh_against_disk` drops it,
        // `ensure_portable_seed_in` must still supply a live root at *this*
        // machine's portable anchor rather than leaving the app un-set-up.
        let base = std::env::temp_dir().join("coilbox_ensure_portable_seed_crossmachine_test");
        let _ = std::fs::remove_dir_all(&base);
        std::fs::create_dir_all(&base).unwrap();

        let state = ContentState {
            schema_version: SCHEMA_VERSION,
            roots: vec![stale_root(foreign_path(), RootSource::Auto, true)],
            last_scan_at: Some(0),
        };
        let refreshed = refresh_against_disk(state);
        assert!(refreshed.roots.is_empty());

        let seeded = ensure_portable_seed_in(refreshed.roots, Some(base.clone()));
        assert_eq!(seeded.len(), 1);
        assert!(seeded[0].exists && seeded[0].valid);
        assert_eq!(seeded[0].path, display_path(&canonical(&base)));

        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn content_list_engines_recovers_engines_after_a_dead_cross_machine_snapshot() {
        // Issue #539: content_list_engines shares refresh_against_disk with
        // content_state_load but was missing the ensure_portable_seed re-anchoring
        // from #524, so a copied snapshot with only a dead foreign root listed no
        // engines even though a valid portable folder with an installed engine sat
        // right next to the executable. This mirrors that sequence directly.
        let base = std::env::temp_dir().join("coilbox_list_engines_crossmachine_test");
        let _ = std::fs::remove_dir_all(&base);
        let engine_dir = base.join("engine").join("105.1.1");
        std::fs::create_dir_all(&engine_dir).unwrap();
        std::fs::write(engine_dir.join("spring"), b"fake").unwrap();

        let state = ContentState {
            schema_version: SCHEMA_VERSION,
            roots: vec![stale_root(foreign_path(), RootSource::Auto, true)],
            last_scan_at: Some(0),
        };
        let refreshed = refresh_against_disk(state);
        assert!(refreshed.roots.is_empty());

        let seeded = ensure_portable_seed_in(refreshed.roots, Some(base.clone()));
        let engines: Vec<_> = seeded.into_iter().flat_map(|r| r.engines).collect();
        assert_eq!(
            engines.len(),
            1,
            "the re-anchored portable root's engine must surface in the flattened list"
        );

        let _ = std::fs::remove_dir_all(&base);
    }
}
