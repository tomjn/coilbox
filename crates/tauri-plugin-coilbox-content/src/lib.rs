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

mod branding;
mod demo;
mod engine;
mod model;
mod paths;
mod rapid_pool;
mod savegame;
mod scan;
mod settings_backup;

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
/// content folder or engine can be deleted between runs — so any read that gates UI
/// (first-run setup, engine-download buttons) must re-check disk, or it acts on
/// stale truth. Cheap: re-stats each root and re-scans only the `engine/` layout,
/// deliberately skipping the content-count walk (those counts self-correct on the
/// next explicit rescan). Not persisted — a read must stay read-only.
fn refresh_against_disk(state: ContentState) -> ContentState {
    let ContentState {
        schema_version,
        roots,
        last_scan_at,
    } = state;
    let mut roots: Vec<ContentRoot> = roots
        .into_iter()
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
            r.valid = kind.is_some() || forced;
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
    let state = refresh_against_disk(store.snapshot.unwrap_or_default());
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
        .map(|s| {
            refresh_against_disk(s)
                .roots
                .into_iter()
                .flat_map(|r| r.engines)
                .collect()
        })
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
/// `<root>/replays` (fast fs metadata; no decoding). `root` is a `ContentRoot.path`.
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
            content_demo_chat,
            content_rewrite_demo,
            content_list_saves,
            content_delete_save,
            content_config_profiles,
            content_config_backup,
            content_config_restore,
            content_config_delete_profile,
            content_warm_rapid_pool,
            content_prune_rapid_pool,
            branding_catalog,
            branding_image
        ])
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
}
