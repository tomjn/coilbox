//! A distribution's bundled content: `.coilbox/content`, laid out like a Spring
//! data directory (`engine/`, `games/`, `maps/`, `packages/` plus `pool/`).
//!
//! Games, maps and rapid packages are read where they sit, as an extra content
//! root listed after the player's own (see `add_bundle_acc` in `lib.rs`).
//!
//! The engine cannot be. Recoil only uses an engine's own folder as its write
//! directory when that folder is writable and holds `springsettings.cfg`
//! (`DataDirLocater::IsPortableMode`). Run from a bundle it would either write
//! its archive cache, replays and logs into the bundle, or, if the bundle is
//! read-only, into `~/.config/spring` or `~/.spring`, outside the distribution
//! entirely. Coilbox also puts an engine's own root first in `SPRING_DATADIR`,
//! which would rank the bundle above the player's folder. So the engine for this
//! platform is copied once into the player's own content folder, where it
//! behaves exactly like one coilbox downloaded.

use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use picoframe_core::CliResult;
use serde::Serialize;
use serde_json::json;
use tauri::{ipc::Channel, AppHandle, Runtime};

use crate::scan;

/// The platform folder names pr-downloader writes engines under
/// (`platformToString` in its `Version.cpp`). A bundle uses the same names, so a
/// distributor can copy `engine/` straight out of a working install.
pub(crate) const PLATFORMS: &[&str] = &[
    "linux64",
    "linux_arm64",
    "windows64",
    "windows_arm64",
    "macos_arm64",
];

/// The platform folder name for the machine coilbox is running on, or `None`
/// for one pr-downloader has no engines for.
pub(crate) fn host_platform() -> Option<&'static str> {
    match (std::env::consts::OS, std::env::consts::ARCH) {
        ("linux", "x86_64") => Some("linux64"),
        ("linux", "aarch64") => Some("linux_arm64"),
        ("windows", "x86_64") => Some("windows64"),
        ("windows", "aarch64") => Some("windows_arm64"),
        ("macos", "aarch64") => Some("macos_arm64"),
        _ => None,
    }
}

/// What a Spring data directory has at its top level. Anything else in the
/// bundle is a file in the wrong place.
const TOP_LEVEL: &[&str] = &["engine", "games", "maps", "packages", "pool", "rapid"];

/// Where a staged engine copy is built before it is renamed into place, inside
/// the destination root so the rename never crosses a drive. Outside `engine/`,
/// so engine discovery never lists a half-copied folder.
const STAGING: &str = ".coilbox-installing";

/// One engine the bundle carries.
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BundledEngine {
    /// The platform folder it sits in, or `None` for `engine/<version>/`, which
    /// means "for whatever platform this package runs on".
    pub platform: Option<String>,
    pub version: String,
    pub path: String,
    /// Total size of its files, which is what installing it copies.
    pub bytes: u64,
    pub for_this_platform: bool,
    /// Already in one of the player's own content folders, by version.
    pub installed: bool,
}

/// An authoring mistake in the bundle, for the profile health checklist.
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BundleProblem {
    pub kind: &'static str,
    /// Relative to the bundle folder.
    pub path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
}

impl BundleProblem {
    fn new(kind: &'static str, path: impl Into<String>) -> Self {
        Self {
            kind,
            path: path.into(),
            detail: None,
        }
    }
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BundleReport {
    pub path: String,
    pub games: u32,
    pub maps: u32,
    pub packages: u32,
    pub engines: Vec<BundledEngine>,
    pub problems: Vec<BundleProblem>,
}

/// One entry of an engine folder, as the copy will reproduce it.
#[derive(Debug, Clone, PartialEq)]
enum Entry {
    Dir(PathBuf),
    File(PathBuf, u64),
    /// A link whose target stays inside the folder, stored as written.
    Link(PathBuf, PathBuf),
}

/// Whether a link at `rel` (relative to the folder being copied) pointing at
/// `target` stays inside that folder. Decided on the path alone, the way the
/// zip import in the conquest plugin decides a member's path, so a link can
/// never be followed out of the bundle.
fn link_stays_inside(rel: &Path, target: &Path) -> bool {
    if target.is_absolute() || target.has_root() {
        return false;
    }
    let mut depth: i64 = 0;
    for c in rel.parent().unwrap_or(Path::new("")).components() {
        if let Component::Normal(_) = c {
            depth += 1;
        }
    }
    for c in target.components() {
        match c {
            Component::Normal(_) => depth += 1,
            Component::ParentDir => {
                depth -= 1;
                if depth < 0 {
                    return false;
                }
            }
            Component::CurDir => {}
            _ => return false,
        }
    }
    true
}

/// Every entry under `dir`, parents before children, without following links.
/// Fails on a link that leads out of `dir` and on anything that is not a file,
/// a folder or a link.
fn walk(dir: &Path) -> Result<Vec<Entry>, String> {
    fn go(root: &Path, rel: &Path, out: &mut Vec<Entry>) -> Result<(), String> {
        let at = root.join(rel);
        let mut children: Vec<_> = std::fs::read_dir(&at)
            .map_err(|e| format!("could not read {}: {e}", at.display()))?
            .filter_map(|e| e.ok())
            .map(|e| e.file_name())
            .collect();
        children.sort();
        for name in children {
            let child_rel = rel.join(&name);
            let child = root.join(&child_rel);
            let meta = std::fs::symlink_metadata(&child)
                .map_err(|e| format!("could not read {}: {e}", child.display()))?;
            let ft = meta.file_type();
            if ft.is_symlink() {
                let target = std::fs::read_link(&child)
                    .map_err(|e| format!("could not read the link {}: {e}", child.display()))?;
                if !link_stays_inside(&child_rel, &target) {
                    return Err(format!(
                        "{} is a link to {}, outside the engine folder. A bundled engine may only link to its own files.",
                        child.display(),
                        target.display()
                    ));
                }
                out.push(Entry::Link(child_rel, target));
            } else if ft.is_dir() {
                out.push(Entry::Dir(child_rel.clone()));
                go(root, &child_rel, out)?;
            } else if ft.is_file() {
                out.push(Entry::File(child_rel, meta.len()));
            } else {
                return Err(format!(
                    "{} is not a file or a folder, so it cannot be copied.",
                    child.display()
                ));
            }
        }
        Ok(())
    }
    let mut out = Vec::new();
    go(dir, Path::new(""), &mut out)?;
    Ok(out)
}

fn total_bytes(entries: &[Entry]) -> u64 {
    entries
        .iter()
        .map(|e| match e {
            Entry::File(_, len) => *len,
            _ => 0,
        })
        .sum()
}

fn is_hidden(name: &str) -> bool {
    name.starts_with('.')
}

fn count_archives(dir: &Path, exts: &[&str]) -> u32 {
    let Ok(rd) = std::fs::read_dir(dir) else {
        return 0;
    };
    rd.flatten()
        .filter(|e| {
            let name = e.file_name().to_string_lossy().to_lowercase();
            exts.iter().any(|ext| name.ends_with(ext))
        })
        .count() as u32
}

/// Read what the bundle at `bundle` holds and what is wrong with it.
/// `installed(platform, version)` answers whether the player already has that
/// engine in a folder of their own.
pub(crate) fn inspect(
    bundle: &Path,
    host: Option<&str>,
    installed: impl Fn(Option<&str>, &str) -> bool,
) -> BundleReport {
    let mut problems = Vec::new();

    if let Ok(rd) = std::fs::read_dir(bundle) {
        let mut names: Vec<String> = rd
            .flatten()
            .map(|e| e.file_name().to_string_lossy().to_string())
            .collect();
        names.sort();
        for name in names {
            if is_hidden(&name) || TOP_LEVEL.contains(&name.to_ascii_lowercase().as_str()) {
                continue;
            }
            let lower = name.to_ascii_lowercase();
            if [".sd7", ".sdz", ".sdd"].iter().any(|e| lower.ends_with(e)) {
                problems.push(BundleProblem::new("looseArchive", name));
            } else {
                problems.push(BundleProblem::new("stray", name));
            }
        }
    }

    let games = count_archives(&bundle.join("games"), &[".sd7", ".sdz", ".sdd"]);
    let maps = count_archives(&bundle.join("maps"), &[".sd7", ".sdz", ".sdd"]);
    let packages = count_archives(&bundle.join("packages"), &[".sdp"]);
    if packages > 0 && !bundle.join("pool").is_dir() {
        problems.push(BundleProblem::new("packagesWithoutPool", "packages"));
    }

    // A loose game folder is one the mission runtime would write a compiled
    // mission into, which coilbox refuses to do in a bundle.
    if let Ok(rd) = std::fs::read_dir(bundle.join("games")) {
        let mut sdds: Vec<String> = rd
            .flatten()
            .filter(|e| e.path().is_dir())
            .map(|e| e.file_name().to_string_lossy().to_string())
            .filter(|n| n.to_ascii_lowercase().ends_with(".sdd"))
            .collect();
        sdds.sort();
        for n in sdds {
            problems.push(BundleProblem::new("looseGame", format!("games/{n}")));
        }
    }

    // `engine/<x>/` holding version folders, where `x` is no platform.
    if let Ok(rd) = std::fs::read_dir(bundle.join("engine")) {
        for e in rd.flatten() {
            let p = e.path();
            let name = e.file_name().to_string_lossy().to_string();
            if !p.is_dir() || is_hidden(&name) || scan::spring_binary_in(&p).is_some() {
                continue;
            }
            if !PLATFORMS.contains(&name.as_str()) {
                problems.push(BundleProblem::new(
                    "unknownPlatform",
                    format!("engine/{name}"),
                ));
            }
        }
    }

    let mut engines = Vec::new();
    for (dir, platform) in scan::engine_dirs(bundle) {
        // The bundle folder itself holding a binary is not a layout a bundle
        // has. Report it rather than list it.
        if dir == bundle {
            problems.push(BundleProblem::new("engineAtTop", "."));
            continue;
        }
        if platform.as_deref().is_some_and(|p| !PLATFORMS.contains(&p)) {
            continue;
        }
        let version = dir
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default();
        let rel = dir
            .strip_prefix(bundle)
            .map(|r| r.to_string_lossy().replace('\\', "/"))
            .unwrap_or_default();
        let for_this_platform = match platform.as_deref() {
            None => true,
            Some(p) => Some(p) == host,
        };
        let bytes = match walk(&dir) {
            Ok(entries) => total_bytes(&entries),
            Err(e) => {
                problems.push(BundleProblem {
                    kind: "unreadableEngine",
                    path: rel.clone(),
                    detail: Some(e),
                });
                continue;
            }
        };
        engines.push(BundledEngine {
            installed: installed(platform.as_deref(), &version),
            platform,
            version,
            path: rel,
            bytes,
            for_this_platform,
        });
    }
    engines.sort_by(|a, b| (&a.platform, &a.version).cmp(&(&b.platform, &b.version)));

    if !engines.is_empty() && !engines.iter().any(|e| e.for_this_platform) {
        problems.push(BundleProblem {
            kind: "noEngineForThisPlatform",
            path: "engine".into(),
            detail: host.map(str::to_string),
        });
    }
    if games == 0 && maps == 0 && packages == 0 && engines.is_empty() {
        problems.push(BundleProblem::new("empty", "."));
    }

    BundleReport {
        path: crate::display_path(bundle),
        games,
        maps,
        packages,
        engines,
        problems,
    }
}

/// Where an engine from the bundle lands under `dest_root`, mirroring where it
/// sat in the bundle.
pub(crate) fn engine_dest(dest_root: &Path, platform: Option<&str>, version: &str) -> PathBuf {
    let base = dest_root.join("engine");
    match platform {
        Some(p) => base.join(p).join(version),
        None => base.join(version),
    }
}

#[derive(Debug, PartialEq)]
pub(crate) enum Installed {
    Copied { dest: PathBuf, bytes: u64 },
    AlreadyThere { dest: PathBuf },
}

/// Copy one file's bytes without its extended attributes, reporting each chunk.
///
/// `std::fs::copy` would carry macOS's quarantine flag across from a bundle
/// unpacked out of a browser download, and Gatekeeper then refuses to run the
/// engine. A file coilbox downloads itself never carries the flag, and the
/// engine came in the same download as coilbox, so the copy is written the way
/// a download would be. The permission bits are kept, so the binary stays
/// executable.
fn copy_file(
    from: &Path,
    to: &Path,
    cancel: &AtomicBool,
    on_bytes: &mut dyn FnMut(u64),
) -> Result<(), String> {
    let mut src =
        std::fs::File::open(from).map_err(|e| format!("could not read {}: {e}", from.display()))?;
    let mut dst = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(to)
        .map_err(|e| format!("could not write {}: {e}", to.display()))?;
    let mut buf = vec![0u8; 1 << 20];
    loop {
        if cancel.load(Ordering::Relaxed) {
            return Err("cancelled".into());
        }
        let n = src
            .read(&mut buf)
            .map_err(|e| format!("could not read {}: {e}", from.display()))?;
        if n == 0 {
            break;
        }
        dst.write_all(&buf[..n])
            .map_err(|e| format!("could not write {}: {e}", to.display()))?;
        on_bytes(n as u64);
    }
    dst.sync_all()
        .map_err(|e| format!("could not write {}: {e}", to.display()))?;
    let perms = owner_writable(
        std::fs::metadata(from)
            .map_err(|e| format!("could not read {}: {e}", from.display()))?
            .permissions(),
    );
    std::fs::set_permissions(to, perms)
        .map_err(|e| format!("could not set permissions on {}: {e}", to.display()))?;
    Ok(())
}

/// `perms` with the owner allowed to write. A bundle is often read-only, and
/// the engine rewrites its own `springsettings.cfg` in the folder it runs from,
/// so a copy that kept a read-only mode would be an engine that cannot save its
/// settings.
fn owner_writable(perms: std::fs::Permissions) -> std::fs::Permissions {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::Permissions::from_mode(perms.mode() | 0o200)
    }
    #[cfg(not(unix))]
    {
        let mut perms = perms;
        perms.set_readonly(false);
        perms
    }
}

fn make_link(src_root: &Path, rel: &Path, target: &Path, dest: &Path) -> Result<(), String> {
    #[cfg(unix)]
    {
        let _ = src_root;
        std::os::unix::fs::symlink(target, dest)
            .map_err(|e| format!("could not create the link {}: {e}", rel.display()))
    }
    #[cfg(not(unix))]
    {
        // Creating a link on Windows needs a privilege a player rarely has, so
        // the file it points at is copied in its place. `walk` has already
        // checked that it points inside the folder.
        let resolved = src_root
            .join(rel.parent().unwrap_or(Path::new("")))
            .join(target);
        std::fs::copy(&resolved, dest)
            .map(|_| ())
            .map_err(|e| format!("could not copy {}: {e}", rel.display()))
    }
}

/// Copy the engine folder `src` into `dest_root`, under the platform and version
/// it had in the bundle.
///
/// Built under [`STAGING`] and renamed into place only once every file is
/// written, so a copy that stops half way never looks like an installed engine.
/// A version already there is left alone. Checks the drive has room for every
/// byte before writing one.
pub(crate) fn install_engine(
    src: &Path,
    dest_root: &Path,
    platform: Option<&str>,
    version: &str,
    free_space: impl Fn(&Path) -> std::io::Result<u64>,
    cancel: &AtomicBool,
    mut progress: impl FnMut(u64, u64),
) -> Result<Installed, String> {
    let dest = engine_dest(dest_root, platform, version);
    if scan::spring_binary_in(&dest).is_some() {
        return Ok(Installed::AlreadyThere { dest });
    }
    if dest.exists() {
        return Err(format!(
            "{} already exists and holds no engine. Remove it, then try again.",
            dest.display()
        ));
    }
    let entries = walk(src)?;
    let total = total_bytes(&entries);
    let free = free_space(dest_root).map_err(|e| {
        format!(
            "could not read the free space on the drive holding {}: {e}",
            dest_root.display()
        )
    })?;
    if free < total {
        return Err(format!(
            "The engine needs {total} bytes and the drive holding {} has {free} free.",
            dest_root.display()
        ));
    }

    let staging_root = dest_root.join(STAGING);
    // Whatever is here is a copy an earlier run did not finish.
    match std::fs::remove_dir_all(&staging_root) {
        Ok(()) => {}
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
        Err(e) => return Err(format!("could not clear {}: {e}", staging_root.display())),
    }
    let staging = staging_root.join("engine");
    let result = (|| {
        std::fs::create_dir_all(&staging)
            .map_err(|e| format!("could not write {}: {e}", staging.display()))?;
        let mut done = 0u64;
        progress(0, total);
        for entry in &entries {
            match entry {
                Entry::Dir(rel) => std::fs::create_dir(staging.join(rel))
                    .map_err(|e| format!("could not create {}: {e}", rel.display()))?,
                Entry::File(rel, _) => {
                    copy_file(&src.join(rel), &staging.join(rel), cancel, &mut |n| {
                        done += n;
                        progress(done, total);
                    })?
                }
                Entry::Link(rel, target) => make_link(src, rel, target, &staging.join(rel))?,
            }
        }
        if let Some(parent) = dest.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("could not create {}: {e}", parent.display()))?;
        }
        std::fs::rename(&staging, &dest)
            .map_err(|e| format!("could not move the engine into {}: {e}", dest.display()))
    })();
    let _ = std::fs::remove_dir_all(&staging_root);
    result?;
    Ok(Installed::Copied { dest, bytes: total })
}

// ---- commands --------------------------------------------------------------

/// What the frontend's download progress bar reads. The same fields as the
/// downloads plugin's `DownloadProgress`, so the queue draws a copy the way it
/// draws a download.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CopyProgress {
    phase: &'static str,
    downloaded_bytes: u64,
    total_bytes: Option<u64>,
    percent: Option<f64>,
    bytes_per_sec: Option<f64>,
}

impl CopyProgress {
    fn copying(done: u64, total: u64) -> Self {
        let percent = if total == 0 {
            100.0
        } else {
            done as f64 * 100.0 / total as f64
        };
        Self {
            phase: "copying",
            downloaded_bytes: done,
            total_bytes: Some(total),
            percent: Some(percent),
            bytes_per_sec: None,
        }
    }
    fn done() -> Self {
        Self {
            phase: "done",
            downloaded_bytes: 0,
            total_bytes: None,
            percent: None,
            bytes_per_sec: None,
        }
    }
}

static CANCELS: Mutex<Option<HashMap<String, Arc<AtomicBool>>>> = Mutex::new(None);

fn cancel_flag(op_id: &str) -> Arc<AtomicBool> {
    let mut map = CANCELS.lock().unwrap();
    map.get_or_insert_with(HashMap::new)
        .entry(op_id.to_string())
        .or_insert_with(|| Arc::new(AtomicBool::new(false)))
        .clone()
}

fn forget_flag(op_id: &str) {
    if let Some(map) = CANCELS.lock().unwrap().as_mut() {
        map.remove(op_id);
    }
}

/// The engines in the player's own folders, as (platform, version) pairs.
fn own_engines<R: Runtime>(app: &AppHandle<R>) -> Vec<(Option<String>, String)> {
    let Ok(path) = crate::store_path(app) else {
        return Vec::new();
    };
    let Ok(store) = crate::model::load_store(&path) else {
        return Vec::new();
    };
    let state = crate::refresh_against_disk(store.snapshot.unwrap_or_default());
    crate::ensure_portable_seed(state.roots)
        .into_iter()
        .filter(|r| !r.bundled)
        .flat_map(|r| r.engines)
        .map(|e| (e.platform, e.version))
        .collect()
}

/// Whether the player has this engine already: an engine of the same version
/// in a folder of their own, on the same platform or with none named, or the
/// exact folder the copy would write in the download destination.
fn is_installed(
    own: &[(Option<String>, String)],
    write_root: Option<&Path>,
    platform: Option<&str>,
    version: &str,
) -> bool {
    let same = own.iter().any(|(p, v)| {
        v == version && (p.is_none() || platform.is_none() || p.as_deref() == platform)
    });
    same || write_root
        .is_some_and(|w| scan::spring_binary_in(&engine_dest(w, platform, version)).is_some())
}

/// A download destination the copy may write into: an existing absolute folder
/// outside the bundle.
fn checked_write_root(write_path: &str) -> Result<PathBuf, String> {
    let p = PathBuf::from(write_path);
    if !p.is_absolute() || !p.is_dir() {
        return Err(format!("the download folder {write_path} does not exist"));
    }
    coilbox_portable::refuse_in_bundle(&p)?;
    Ok(p)
}

/// `content_bundle_inspect` reports the distribution's bundled content, or
/// `{ bundle: null }` when there is none. `write_path` is the download
/// destination, used to tell whether a bundled engine is already installed.
#[tauri::command]
pub(crate) async fn content_bundle_inspect<R: Runtime>(
    app: AppHandle<R>,
    write_path: Option<String>,
) -> CliResult {
    let Some(bundle) = coilbox_portable::bundle_dir() else {
        return CliResult::ok(json!({ "bundle": null }));
    };
    let result = tauri::async_runtime::spawn_blocking(move || {
        let own = own_engines(&app);
        let write_root = write_path.map(PathBuf::from);
        inspect(&bundle, host_platform(), |p, v| {
            is_installed(&own, write_root.as_deref(), p, v)
        })
    })
    .await;
    match result {
        Ok(report) => CliResult::ok(json!({ "bundle": report })),
        Err(e) => CliResult::err(format!("could not read the bundled content: {e}")),
    }
}

/// `content_bundle_install_engine` copies the bundled engine for this platform
/// at `platform`/`version` into the download destination `write_path`. Returns
/// `{ path, copied, bytes }`, with `copied: false` when it was already there.
#[tauri::command]
pub(crate) async fn content_bundle_install_engine(
    write_path: String,
    platform: Option<String>,
    version: String,
    op_id: Option<String>,
    on_progress: Channel<CopyProgress>,
) -> CliResult {
    let Some(bundle) = coilbox_portable::bundle_dir() else {
        return CliResult::err("This distribution bundles no content.");
    };
    let dest_root = match checked_write_root(&write_path) {
        Ok(p) => p,
        Err(e) => return CliResult::err(e),
    };
    let host = host_platform();
    // Only an engine the bundle actually lists, for this machine, is copied.
    // Nothing the caller names is joined onto a path unchecked.
    let Some((src, _)) = scan::engine_dirs(&bundle).into_iter().find(|(dir, p)| {
        dir != &bundle
            && p.as_deref() == platform.as_deref()
            && dir
                .file_name()
                .is_some_and(|n| n.to_string_lossy() == version)
    }) else {
        return CliResult::err(format!("The bundle has no engine {version}."));
    };
    if platform.is_some() && platform.as_deref() != host {
        return CliResult::err(format!(
            "The bundled engine {version} is for {}, not this machine.",
            platform.unwrap_or_default()
        ));
    }

    let op = op_id.unwrap_or_else(|| format!("bundle-engine-{version}"));
    let cancel = cancel_flag(&op);
    let result = tauri::async_runtime::spawn_blocking(move || {
        let mut last = Instant::now() - Duration::from_secs(1);
        install_engine(
            &src,
            &dest_root,
            platform.as_deref(),
            &version,
            coilbox_proc::free_space,
            &cancel,
            |done, total| {
                if done == total || last.elapsed() >= Duration::from_millis(100) {
                    last = Instant::now();
                    let _ = on_progress.send(CopyProgress::copying(done, total));
                }
            },
        )
        .inspect(|_| {
            let _ = on_progress.send(CopyProgress::done());
        })
    })
    .await;
    forget_flag(&op);
    match result {
        Ok(Ok(Installed::Copied { dest, bytes })) => CliResult::ok(json!({
            "path": crate::display_path(&dest), "copied": true, "bytes": bytes
        })),
        Ok(Ok(Installed::AlreadyThere { dest })) => CliResult::ok(json!({
            "path": crate::display_path(&dest), "copied": false, "bytes": 0
        })),
        Ok(Err(e)) => CliResult::err(e),
        Err(e) => CliResult::err(format!("the engine copy stopped: {e}")),
    }
}

/// `content_bundle_cancel` stops an engine copy started with this `op_id`.
#[tauri::command]
pub(crate) async fn content_bundle_cancel(op_id: String) -> CliResult {
    let found = CANCELS
        .lock()
        .unwrap()
        .as_ref()
        .and_then(|m| m.get(&op_id).cloned());
    if let Some(flag) = &found {
        flag.store(true, Ordering::Relaxed);
    }
    CliResult::ok(json!({ "cancelled": found.is_some() }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn write(p: &Path, bytes: &[u8]) {
        fs::create_dir_all(p.parent().unwrap()).unwrap();
        fs::write(p, bytes).unwrap();
    }

    /// An engine folder with a binary, a library in a subfolder and base content.
    fn fake_engine(dir: &Path) {
        write(&dir.join("spring"), b"#!/bin/sh\necho engine\n");
        write(&dir.join("libunitsync.so"), &[7u8; 3000]);
        write(&dir.join("base/springcontent.sdz"), &[1u8; 5000]);
        write(&dir.join("springsettings.cfg"), b"");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(dir.join("spring"), fs::Permissions::from_mode(0o755)).unwrap();
        }
    }

    fn never_installed(_: Option<&str>, _: &str) -> bool {
        false
    }

    #[test]
    fn host_platform_is_one_pr_downloader_names() {
        if let Some(p) = host_platform() {
            assert!(PLATFORMS.contains(&p));
        }
    }

    #[test]
    fn link_check_follows_the_path_not_the_disk() {
        assert!(link_stays_inside(
            Path::new("lib/a.so"),
            Path::new("a.so.1")
        ));
        assert!(link_stays_inside(
            Path::new("lib/a.so"),
            Path::new("../spring")
        ));
        assert!(!link_stays_inside(
            Path::new("a.so"),
            Path::new("../outside")
        ));
        assert!(!link_stays_inside(
            Path::new("lib/a.so"),
            Path::new("../../x")
        ));
        assert!(!link_stays_inside(Path::new("a"), Path::new("/etc/passwd")));
    }

    #[test]
    fn inspect_counts_content_and_lists_engines_by_platform() {
        let tmp = tempfile::tempdir().unwrap();
        let b = tmp.path();
        write(&b.join("games/sf_1.sdz"), b"g");
        write(&b.join("maps/a.sd7"), b"m");
        write(&b.join("maps/b.sdz"), b"m");
        fake_engine(&b.join("engine/linux64/105.1"));
        fake_engine(&b.join("engine/windows64/105.1"));
        let r = inspect(b, Some("linux64"), |p, v| {
            p == Some("linux64") && v == "105.1"
        });
        assert_eq!((r.games, r.maps, r.packages), (1, 2, 0));
        assert_eq!(r.engines.len(), 2);
        let linux = &r.engines[0];
        assert_eq!(linux.platform.as_deref(), Some("linux64"));
        assert!(linux.for_this_platform && linux.installed);
        assert_eq!(linux.bytes, 22 + 3000 + 5000);
        assert_eq!(linux.path, "engine/linux64/105.1");
        let windows = &r.engines[1];
        assert!(!windows.for_this_platform && !windows.installed);
        assert!(r.problems.is_empty(), "{:?}", r.problems);
    }

    #[test]
    fn inspect_treats_a_flat_engine_as_this_platforms() {
        let tmp = tempfile::tempdir().unwrap();
        fake_engine(&tmp.path().join("engine/105.1"));
        let r = inspect(tmp.path(), Some("macos_arm64"), never_installed);
        assert_eq!(r.engines.len(), 1);
        assert_eq!(r.engines[0].platform, None);
        assert!(r.engines[0].for_this_platform);
    }

    #[test]
    fn inspect_reports_each_authoring_mistake() {
        let tmp = tempfile::tempdir().unwrap();
        let b = tmp.path();
        write(&b.join("sf_1.sdz"), b"g");
        write(&b.join("readme.txt"), b"x");
        write(&b.join(".DS_Store"), b"x");
        write(&b.join("packages/abc.sdp"), b"p");
        fs::create_dir_all(b.join("games/sf.sdd")).unwrap();
        fake_engine(&b.join("engine/macos/105.1"));
        fake_engine(&b.join("engine/windows64/105.1"));
        let r = inspect(b, Some("linux64"), never_installed);
        let kinds: Vec<_> = r
            .problems
            .iter()
            .map(|p| (p.kind, p.path.as_str()))
            .collect();
        assert_eq!(
            kinds,
            vec![
                ("stray", "readme.txt"),
                ("looseArchive", "sf_1.sdz"),
                ("packagesWithoutPool", "packages"),
                ("looseGame", "games/sf.sdd"),
                ("unknownPlatform", "engine/macos"),
                ("noEngineForThisPlatform", "engine"),
            ]
        );
        // The engine under an unknown platform folder is not offered.
        assert_eq!(r.engines.len(), 1);
    }

    #[test]
    fn inspect_calls_an_empty_bundle_empty() {
        let tmp = tempfile::tempdir().unwrap();
        let r = inspect(tmp.path(), Some("linux64"), never_installed);
        assert_eq!(r.problems, vec![BundleProblem::new("empty", ".")]);
    }

    #[cfg(unix)]
    #[test]
    fn inspect_reports_an_engine_that_links_outside_itself() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().join("engine/linux64/105.1");
        fake_engine(&dir);
        std::os::unix::fs::symlink("/etc/hosts", dir.join("hosts")).unwrap();
        let r = inspect(tmp.path(), Some("linux64"), never_installed);
        assert!(r.engines.is_empty());
        assert_eq!(r.problems[0].kind, "unreadableEngine");
    }

    fn plenty(_: &Path) -> std::io::Result<u64> {
        Ok(u64::MAX)
    }

    #[test]
    fn install_copies_the_engine_and_a_second_run_does_nothing() {
        let tmp = tempfile::tempdir().unwrap();
        let src = tmp.path().join("bundle/engine/linux64/105.1");
        fake_engine(&src);
        let dest_root = tmp.path().join("player");
        fs::create_dir_all(&dest_root).unwrap();
        let cancel = AtomicBool::new(false);
        let mut seen = Vec::new();
        let out = install_engine(
            &src,
            &dest_root,
            Some("linux64"),
            "105.1",
            plenty,
            &cancel,
            |d, t| seen.push((d, t)),
        )
        .unwrap();
        let dest = dest_root.join("engine/linux64/105.1");
        assert_eq!(
            out,
            Installed::Copied {
                dest: dest.clone(),
                bytes: 8022
            }
        );
        assert_eq!(seen.first(), Some(&(0, 8022)));
        assert_eq!(seen.last(), Some(&(8022, 8022)));
        assert_eq!(
            fs::read(dest.join("base/springcontent.sdz")).unwrap(),
            vec![1u8; 5000]
        );
        assert!(!dest_root.join(STAGING).exists());
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = fs::metadata(dest.join("spring"))
                .unwrap()
                .permissions()
                .mode();
            assert_eq!(mode & 0o777, 0o755);
        }
        // Discovery in the player's folder finds it as an ordinary engine.
        let found = scan::discover_engines(&dest_root);
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].platform.as_deref(), Some("linux64"));

        let again = install_engine(
            &src,
            &dest_root,
            Some("linux64"),
            "105.1",
            |_| panic!("an installed engine must not be measured again"),
            &cancel,
            |_, _| panic!("an installed engine must not be copied again"),
        )
        .unwrap();
        assert_eq!(again, Installed::AlreadyThere { dest });
    }

    #[test]
    fn install_refuses_when_the_drive_is_too_full_and_writes_nothing() {
        let tmp = tempfile::tempdir().unwrap();
        let src = tmp.path().join("bundle/engine/105.1");
        fake_engine(&src);
        let dest_root = tmp.path().join("player");
        fs::create_dir_all(&dest_root).unwrap();
        let err = install_engine(
            &src,
            &dest_root,
            None,
            "105.1",
            |_| Ok(8021),
            &AtomicBool::new(false),
            |_, _| {},
        )
        .unwrap_err();
        assert!(err.contains("8022") && err.contains("8021"), "{err}");
        assert_eq!(fs::read_dir(&dest_root).unwrap().count(), 0);
    }

    #[test]
    fn a_cancelled_copy_leaves_no_engine_and_no_staging() {
        let tmp = tempfile::tempdir().unwrap();
        let src = tmp.path().join("bundle/engine/105.1");
        fake_engine(&src);
        let dest_root = tmp.path().join("player");
        fs::create_dir_all(&dest_root).unwrap();
        let cancel = AtomicBool::new(false);
        let err = install_engine(&src, &dest_root, None, "105.1", plenty, &cancel, |d, _| {
            if d > 0 {
                cancel.store(true, Ordering::Relaxed);
            }
        })
        .unwrap_err();
        assert_eq!(err, "cancelled");
        assert!(scan::discover_engines(&dest_root).is_empty());
        assert!(!dest_root.join(STAGING).exists());
        assert!(!dest_root.join("engine/105.1").exists());
    }

    #[test]
    fn install_clears_a_copy_an_earlier_run_left_half_done() {
        let tmp = tempfile::tempdir().unwrap();
        let src = tmp.path().join("bundle/engine/105.1");
        fake_engine(&src);
        let dest_root = tmp.path().join("player");
        write(&dest_root.join(STAGING).join("engine/spring"), b"half");
        let out = install_engine(
            &src,
            &dest_root,
            None,
            "105.1",
            plenty,
            &AtomicBool::new(false),
            |_, _| {},
        )
        .unwrap();
        assert!(matches!(out, Installed::Copied { .. }));
        assert!(!dest_root.join(STAGING).exists());
    }

    #[test]
    fn install_will_not_merge_into_a_folder_that_is_not_an_engine() {
        let tmp = tempfile::tempdir().unwrap();
        let src = tmp.path().join("bundle/engine/105.1");
        fake_engine(&src);
        let dest_root = tmp.path().join("player");
        write(&dest_root.join("engine/105.1/notes.txt"), b"mine");
        let err = install_engine(
            &src,
            &dest_root,
            None,
            "105.1",
            plenty,
            &AtomicBool::new(false),
            |_, _| {},
        )
        .unwrap_err();
        assert!(err.contains("holds no engine"), "{err}");
        assert_eq!(
            fs::read(dest_root.join("engine/105.1/notes.txt")).unwrap(),
            b"mine"
        );
    }

    #[cfg(unix)]
    #[test]
    fn install_keeps_a_link_inside_the_engine_and_refuses_one_that_leaves() {
        let tmp = tempfile::tempdir().unwrap();
        let src = tmp.path().join("bundle/engine/105.1");
        fake_engine(&src);
        std::os::unix::fs::symlink("libunitsync.so", src.join("unitsync.so")).unwrap();
        let dest_root = tmp.path().join("player");
        fs::create_dir_all(&dest_root).unwrap();
        install_engine(
            &src,
            &dest_root,
            None,
            "105.1",
            plenty,
            &AtomicBool::new(false),
            |_, _| {},
        )
        .unwrap();
        let link = dest_root.join("engine/105.1/unitsync.so");
        assert_eq!(
            fs::read_link(&link).unwrap(),
            PathBuf::from("libunitsync.so")
        );

        let src2 = tmp.path().join("bundle/engine/105.2");
        fake_engine(&src2);
        std::os::unix::fs::symlink("../../../../secret", src2.join("leak")).unwrap();
        let err = install_engine(
            &src2,
            &dest_root,
            None,
            "105.2",
            plenty,
            &AtomicBool::new(false),
            |_, _| {},
        )
        .unwrap_err();
        assert!(err.contains("outside the engine folder"), "{err}");
        assert!(!dest_root.join("engine/105.2").exists());
    }

    #[cfg(unix)]
    #[test]
    fn a_read_only_bundle_still_installs_an_engine_that_can_save_its_settings() {
        use std::os::unix::fs::PermissionsExt;
        let tmp = tempfile::tempdir().unwrap();
        let src = tmp.path().join("bundle/engine/105.1");
        fake_engine(&src);
        for f in ["springsettings.cfg", "spring"] {
            let p = src.join(f);
            let mode = fs::metadata(&p).unwrap().permissions().mode();
            fs::set_permissions(&p, fs::Permissions::from_mode(mode & 0o555)).unwrap();
        }
        let dest_root = tmp.path().join("player");
        fs::create_dir_all(&dest_root).unwrap();
        install_engine(
            &src,
            &dest_root,
            None,
            "105.1",
            plenty,
            &AtomicBool::new(false),
            |_, _| {},
        )
        .unwrap();
        let dest = dest_root.join("engine/105.1");
        let mode = |f: &str| fs::metadata(dest.join(f)).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode("springsettings.cfg"), 0o644);
        assert_eq!(mode("spring"), 0o755);
    }

    #[test]
    fn installed_matches_by_version_and_compatible_platform() {
        let own = vec![
            (Some("linux64".to_string()), "105.1".to_string()),
            (None, "2025.04".to_string()),
        ];
        assert!(is_installed(&own, None, Some("linux64"), "105.1"));
        assert!(is_installed(&own, None, None, "105.1"));
        assert!(!is_installed(&own, None, Some("windows64"), "105.1"));
        assert!(is_installed(&own, None, Some("linux64"), "2025.04"));
        assert!(!is_installed(&own, None, Some("linux64"), "106.0"));
    }

    #[test]
    fn copy_progress_reads_as_a_download_does() {
        let v = serde_json::to_value(CopyProgress::copying(50, 200)).unwrap();
        assert_eq!(
            v,
            json!({ "phase": "copying", "downloadedBytes": 50, "totalBytes": 200, "percent": 25.0, "bytesPerSec": null })
        );
    }
}
