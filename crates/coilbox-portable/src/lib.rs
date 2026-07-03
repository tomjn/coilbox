//! Portable-mode path resolution for Coilbox.
//!
//! Coilbox is normally a single per-user install: every plugin stores its state
//! under the OS `app_data_dir()` / `app_cache_dir()`, keyed off the bundle id
//! `com.tomjn.coilbox`. That's fine for one install, but a game can *ship* coilbox
//! inside its package, and two installs sharing the same bundle id would share the
//! same per-user storage and stomp on each other.
//!
//! Portable mode fixes that: if a `.coilbox` folder sits next to the executable,
//! coilbox uses it for *all* of its own storage ([`data_dir`] → `.coilbox/data`,
//! [`cache_dir`] → `.coilbox/cache`) instead of the global per-user dirs. The whole
//! package is then self-contained and can't touch a player's normal install.
//! Absent that folder, everything behaves exactly as before.
//!
//! Detection is lazy + memoized, so there's nothing to wire up in `main()`.

use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use tauri::{AppHandle, Manager, Runtime};

/// The directory coilbox is "next to" — the anchor for portable detection and for
/// resolving relative content roots.
///
/// Usually `current_exe().parent()`. On macOS the executable lives inside
/// `Foo.app/Contents/MacOS/`, so if any ancestor is a `.app` bundle we return the
/// bundle's *parent* — i.e. the folder the user sees the app in, where `.coilbox`
/// would naturally sit beside it. Inert off macOS (no `.app` ancestors).
fn app_dir_from_exe(exe: &Path) -> Option<PathBuf> {
    let dir = exe.parent()?;
    if let Some(bundle) = dir
        .ancestors()
        .find(|p| p.extension().is_some_and(|e| e.eq_ignore_ascii_case("app")))
    {
        if let Some(parent) = bundle.parent() {
            return Some(parent.to_path_buf());
        }
    }
    Some(dir.to_path_buf())
}

/// The app anchor directory (see [`app_dir_from_exe`]). Memoized; `None` only if the
/// executable path can't be resolved.
pub fn app_dir() -> Option<PathBuf> {
    static DIR: OnceLock<Option<PathBuf>> = OnceLock::new();
    DIR.get_or_init(|| {
        std::env::current_exe()
            .ok()
            .and_then(|e| app_dir_from_exe(&e))
    })
    .clone()
}

/// Pure core of [`portable_root`]: `<app_dir>/.coilbox` when it exists as a dir.
fn portable_root_in(app_dir: &Path, is_dir: impl Fn(&Path) -> bool) -> Option<PathBuf> {
    let candidate = app_dir.join(".coilbox");
    is_dir(&candidate).then_some(candidate)
}

/// `Some(<app_dir>/.coilbox)` when that folder exists next to the app — i.e. we're
/// running in portable mode. Memoized (resolved once at first use).
pub fn portable_root() -> Option<PathBuf> {
    static ROOT: OnceLock<Option<PathBuf>> = OnceLock::new();
    ROOT.get_or_init(|| portable_root_in(app_dir().as_deref()?, |p| p.is_dir()))
        .clone()
}

/// Whether coilbox is running self-contained in a `.coilbox` folder.
pub fn is_portable() -> bool {
    portable_root().is_some()
}

/// Base directory for coilbox's own persisted state/config: `.coilbox/data` in
/// portable mode, otherwise the OS per-user `app_data_dir()`.
pub fn data_dir<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    if let Some(root) = portable_root() {
        return Ok(root.join("data"));
    }
    app.path()
        .app_data_dir()
        .map_err(|e| format!("could not resolve app data dir: {e}"))
}

/// Base directory for coilbox's caches: `.coilbox/cache` in portable mode, otherwise
/// the OS per-user `app_cache_dir()`.
pub fn cache_dir<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    if let Some(root) = portable_root() {
        return Ok(root.join("cache"));
    }
    app.path()
        .app_cache_dir()
        .map_err(|e| format!("could not resolve app cache dir: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn app_dir_is_exe_parent_on_plain_layout() {
        let exe = Path::new("/opt/games/SplinterFaction/coilbox");
        assert_eq!(
            app_dir_from_exe(exe),
            Some(PathBuf::from("/opt/games/SplinterFaction"))
        );
    }

    #[test]
    fn app_dir_escapes_macos_bundle() {
        let exe = Path::new("/Applications/Coilbox.app/Contents/MacOS/coilbox");
        // `.coilbox` should sit beside the bundle, not inside Contents/MacOS.
        assert_eq!(app_dir_from_exe(exe), Some(PathBuf::from("/Applications")));
    }

    #[test]
    fn portable_root_present_when_dir_exists() {
        let base = Path::new("/pkg");
        let root = portable_root_in(base, |p| p == Path::new("/pkg/.coilbox"));
        assert_eq!(root, Some(PathBuf::from("/pkg/.coilbox")));
    }

    #[test]
    fn portable_root_absent_when_missing() {
        let base = Path::new("/pkg");
        assert_eq!(portable_root_in(base, |_| false), None);
    }
}
