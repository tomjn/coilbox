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

mod engine;
mod model;
mod paths;
mod scan;

use model::{
    load_store, save_store, ContentRoot, ContentState, RootCounts, RootKind, RootSource, StoreFile,
    UserRoot, SCHEMA_VERSION,
};
use paths::{candidate_roots, current_os, BaseDirs};
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

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn store_path<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|e| format!("could not resolve app data dir: {e}"))?
        .join("content")
        .join("state.json"))
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
        forced: if a.forced { Some(true) } else { None },
        counts,
        engines,
        last_scanned_at: Some(now),
    }
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
    let mut accs: Vec<Acc> = Vec::new();

    for c in candidate_roots(current_os(), &base) {
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
            }),
        }
    }

    for u in &store.user_roots {
        let canon = canonical(Path::new(&u.path));
        match accs.iter_mut().find(|a| a.canon == canon) {
            Some(a) => {
                a.source = RootSource::Manual;
                if u.label.is_some() {
                    a.label = u.label.clone();
                }
                a.forced = u.forced;
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

// ---- commands --------------------------------------------------------------

/// `content_candidates` — the standard per-OS locations, with exists/valid flags.
/// Cheap: no engine discovery or counts. Deduped by canonical path.
#[tauri::command]
async fn content_candidates<R: Runtime>(
    app: AppHandle<R>,
    include_zerok: Option<bool>,
) -> Result<CliResult, ()> {
    let base = base_dirs(&app, include_zerok.unwrap_or(false));
    let mut seen: Vec<PathBuf> = Vec::new();
    let mut out: Vec<serde_json::Value> = Vec::new();
    for c in candidate_roots(current_os(), &base) {
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

/// `content_state_load` — the persisted snapshot (the cross-plugin read API).
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
    let state = store.snapshot.unwrap_or_default();
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
    let is_manual = store
        .user_roots
        .iter()
        .any(|u| canonical(Path::new(&u.path)) == canon);
    let acc = match existing {
        Some(r) => Acc {
            canon: canon.clone(),
            origins: r.origins.clone(),
            source: r.source,
            label: r.label.clone(),
            forced: r.forced.unwrap_or(false),
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

/// `content_add_root` — add a manually-picked root. Rejects non-roots unless
/// `force`, then recomputes and returns the full state.
#[tauri::command]
async fn content_add_root<R: Runtime>(
    app: AppHandle<R>,
    path: String,
    label: Option<String>,
    force: Option<bool>,
) -> Result<CliResult, ()> {
    let sp = match store_path(&app) {
        Ok(p) => p,
        Err(e) => return Ok(CliResult::err(e)),
    };
    let canon = canonical(Path::new(&path));
    let valid = canon.is_dir() && scan::classify(&canon).is_some();
    let force = force.unwrap_or(false);
    if !valid && !force {
        return Ok(CliResult::err(
            "That folder doesn't look like a Spring data root (no engine/games/maps/rapid layout \
             or portable install). Add it anyway to force.",
        ));
    }
    let mut store = match load_store(&sp) {
        Ok(s) => s,
        Err(e) => return Ok(CliResult::err(e)),
    };
    if !store
        .user_roots
        .iter()
        .any(|u| canonical(Path::new(&u.path)) == canon)
    {
        store.user_roots.push(UserRoot {
            path: display_path(&canon),
            label,
            forced: force && !valid,
        });
    }
    let state = compute_state(&app, &store, true, false);
    if let Err(e) = persist(&sp, store, &state) {
        return Ok(CliResult::err(e));
    }
    Ok(CliResult::ok(json!({ "state": state })))
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
        .retain(|u| canonical(Path::new(&u.path)) != canon);
    let state = compute_state(&app, &store, true, false);
    if let Err(e) = persist(&sp, store, &state) {
        return Ok(CliResult::err(e));
    }
    Ok(CliResult::ok(json!({ "state": state })))
}

/// `content_list_engines` — every engine across tracked roots (read API).
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
    let engines: Vec<_> = store
        .snapshot
        .map(|s| s.roots.into_iter().flat_map(|r| r.engines).collect())
        .unwrap_or_default();
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
            content_remove_root,
            content_list_engines,
            content_verify_engine
        ])
        .build()
}
