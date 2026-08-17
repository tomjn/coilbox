//! Portable-mode path resolution for Coilbox.
//!
//! Coilbox is normally a single per-user install: every plugin stores its state
//! under the OS `app_data_dir()` / `app_cache_dir()`, keyed off the bundle id
//! `com.tomjn.coilbox`. That's fine for one install, but a game can *ship* coilbox
//! inside its package, and two installs sharing the same bundle id would share the
//! same per-user storage and stomp on each other.
//!
//! Portable mode fixes that: when a `.coilbox` folder holding a `profile.json`
//! sits next to the executable, coilbox uses it for *all* of its own storage
//! ([`data_dir`] → `.coilbox/data`, [`cache_dir`] → `.coilbox/cache`) instead of
//! the global per-user dirs. The whole package is then self-contained and can't
//! touch a player's normal install.
//!
//! The `profile.json` requirement (not just the folder) matters because the
//! Windows installer now tucks its sidecars into `.coilbox`, so the folder alone
//! exists for ordinary installs too. A distribution's `.coilbox/profile.json` is
//! what marks a package as portable. Absent that file, everything behaves exactly
//! as before.
//!
//! Detection is lazy + memoized, so there's nothing to wire up in `main()`.

use std::path::{Component, Path, PathBuf};
use std::sync::OnceLock;

use tauri::{AppHandle, Manager, Runtime};

/// The directory coilbox is "next to" — the anchor for portable detection and for
/// resolving relative content roots.
///
/// Usually `current_exe().parent()`. Two platform wrinkles:
///
/// - **Linux AppImage:** an AppImage mounts itself at a throwaway temp path, so
///   `current_exe()` points *inside the mount* (`/tmp/.mount_XXXX/usr/bin/coilbox`),
///   not next to the `.AppImage` file the user actually placed. The runtime exposes
///   the real file path in the `APPIMAGE` env var; when present we anchor on its
///   parent so a `.coilbox` folder beside the AppImage is found. Absent everywhere
///   but a running AppImage.
/// - **macOS:** the executable lives inside `Foo.app/Contents/MacOS/`, so if any
///   ancestor is a `.app` bundle we return the bundle's *parent* — the folder the
///   user sees the app in, where `.coilbox` would naturally sit beside it. Inert off
///   macOS (no `.app` ancestors).
fn app_dir_from_exe(exe: Option<&Path>, appimage: Option<&Path>) -> Option<PathBuf> {
    if let Some(appimage) = appimage {
        return appimage.parent().map(Path::to_path_buf);
    }
    let dir = exe?.parent()?;
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
        let appimage = std::env::var_os("APPIMAGE").map(PathBuf::from);
        let exe = std::env::current_exe().ok();
        app_dir_from_exe(exe.as_deref(), appimage.as_deref())
    })
    .clone()
}

/// Pure core of [`portable_root`]: `<app_dir>/.coilbox` when it exists as a dir AND
/// contains a `profile.json` file. The folder alone is no longer sufficient — the
/// Windows installer puts sidecars in `.coilbox` on every install, so `profile.json`
/// is the specific portable-mode marker.
fn portable_root_in(
    app_dir: &Path,
    is_dir: impl Fn(&Path) -> bool,
    is_file: impl Fn(&Path) -> bool,
) -> Option<PathBuf> {
    let candidate = app_dir.join(".coilbox");
    if is_dir(&candidate) && is_file(&candidate.join("profile.json")) {
        Some(candidate)
    } else {
        None
    }
}

/// `Some(<app_dir>/.coilbox)` when that folder exists next to the app and holds a
/// `profile.json` — i.e. we're running in portable mode. Memoized (resolved once at
/// first use).
pub fn portable_root() -> Option<PathBuf> {
    static ROOT: OnceLock<Option<PathBuf>> = OnceLock::new();
    ROOT.get_or_init(|| portable_root_in(app_dir().as_deref()?, |p| p.is_dir(), |p| p.is_file()))
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

/// Where the app's user settings are stored: the `string -> string` map behind the
/// frame's `useSetting`, written by `us_settings_save` in the uberstress plugin and
/// read back at boot by `src/settings-storage.ts`.
///
/// Named here rather than in the plugin that writes it because it is no longer only
/// that plugin's file. The hub reads it to find out whether the user has agreed to
/// asset uploads (`crates/tauri-plugin-coilbox-hub/src/consent.rs`), and a reader
/// and a writer disagreeing about the path would be a setting that silently never
/// takes effect. The `uberstress` segment is history: the store was that plugin's
/// before it became the app's, and moving it would strip every existing install of
/// its settings.
pub fn settings_file<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    Ok(data_dir(app)?.join("uberstress").join("settings.json"))
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

/// Reject anything that could escape a resolved root: absolute paths, a Windows
/// drive/root prefix, or any `..` component. Only plain forward-relative paths pass.
/// Shared by the profile/campaign plugins and the `coilbox://` asset protocol so the
/// path-traversal guard is defined once.
pub fn is_safe_rel(rel: &Path) -> bool {
    rel.components()
        .all(|c| matches!(c, Component::Normal(_) | Component::CurDir))
        && !rel.as_os_str().is_empty()
}

/// Ids used verbatim as directory/file names (campaign ids, asset-protocol path
/// segments) must be free of path syntax and safe on every filesystem: `[A-Za-z0-9-]+`.
pub fn valid_id(id: &str) -> bool {
    !id.is_empty() && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
}

/// Guess a MIME type from a file extension, covering the media a distribution can
/// ship: images, audio, video and web fonts. Anything unknown falls back to a
/// generic binary type. Shared by `profile_asset` (data URIs) and the `coilbox://`
/// protocol (streamed responses) so both agree on content types.
pub fn mime_for(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(|e| e.to_str())
        .map(str::to_ascii_lowercase)
        .as_deref()
    {
        // Images
        Some("webp") => "image/webp",
        Some("png") => "image/png",
        Some("jpg" | "jpeg") => "image/jpeg",
        Some("gif") => "image/gif",
        // Most of a legacy game's unit textures are `.bmp`, and a webview will
        // not decode one served as an octet stream.
        Some("bmp") => "image/bmp",
        Some("svg") => "image/svg+xml",
        Some("avif") => "image/avif",
        // Audio
        Some("ogg" | "oga") => "audio/ogg",
        Some("mp3") => "audio/mpeg",
        Some("wav") => "audio/wav",
        Some("flac") => "audio/flac",
        Some("opus") => "audio/opus",
        Some("m4a") => "audio/mp4",
        // Video
        Some("mp4") => "video/mp4",
        Some("webm") => "video/webm",
        Some("mov") => "video/quicktime",
        Some("ogv") => "video/ogg",
        // Fonts (profile CSS @font-face)
        Some("woff2") => "font/woff2",
        Some("woff") => "font/woff",
        Some("ttf") => "font/ttf",
        Some("otf") => "font/otf",
        // A model the unitsync worker flattened into the texture cache, which
        // the webview fetches rather than taking over the IPC bridge (#1684).
        Some("json") => "application/json",
        _ => "application/octet-stream",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn is_safe_rel_accepts_forward_paths_only() {
        assert!(is_safe_rel(Path::new("images/x.jpg")));
        assert!(!is_safe_rel(Path::new("")));
        assert!(!is_safe_rel(Path::new("../x.jpg")));
        assert!(!is_safe_rel(Path::new("/abs.jpg")));
        assert!(!is_safe_rel(Path::new("a/../b.jpg")));
    }

    #[test]
    fn valid_id_charset() {
        assert!(valid_id("Camp-01"));
        assert!(!valid_id(""));
        assert!(!valid_id("a/b"));
        assert!(!valid_id("../etc"));
        assert!(!valid_id("café"));
    }

    #[test]
    fn mime_covers_media_and_fonts() {
        assert_eq!(mime_for(Path::new("a.mp4")), "video/mp4");
        assert_eq!(mime_for(Path::new("a.OGG")), "audio/ogg");
        assert_eq!(mime_for(Path::new("a.woff2")), "font/woff2");
        assert_eq!(mime_for(Path::new("a.png")), "image/png");
        assert_eq!(mime_for(Path::new("a.bmp")), "image/bmp");
        assert_eq!(mime_for(Path::new("a.xyz")), "application/octet-stream");
    }

    #[test]
    fn app_dir_is_exe_parent_on_plain_layout() {
        let exe = Path::new("/opt/games/SplinterFaction/coilbox");
        assert_eq!(
            app_dir_from_exe(Some(exe), None),
            Some(PathBuf::from("/opt/games/SplinterFaction"))
        );
    }

    #[test]
    fn app_dir_escapes_macos_bundle() {
        let exe = Path::new("/Applications/Coilbox.app/Contents/MacOS/coilbox");
        // `.coilbox` should sit beside the bundle, not inside Contents/MacOS.
        assert_eq!(
            app_dir_from_exe(Some(exe), None),
            Some(PathBuf::from("/Applications"))
        );
    }

    #[test]
    fn app_dir_prefers_appimage_parent_over_exe_mount() {
        // Inside an AppImage, current_exe() points into the throwaway mount; the
        // real file (and any `.coilbox` beside it) lives at $APPIMAGE.
        let exe = Path::new("/tmp/.mount_abc12/usr/bin/coilbox");
        let appimage = Path::new("/home/player/SplinterFaction/coilbox.AppImage");
        assert_eq!(
            app_dir_from_exe(Some(exe), Some(appimage)),
            Some(PathBuf::from("/home/player/SplinterFaction"))
        );
    }

    #[test]
    fn portable_root_present_when_dir_and_profile_exist() {
        let base = Path::new("/pkg");
        let root = portable_root_in(
            base,
            |p| p == Path::new("/pkg/.coilbox"),
            |p| p == Path::new("/pkg/.coilbox/profile.json"),
        );
        assert_eq!(root, Some(PathBuf::from("/pkg/.coilbox")));
    }

    #[test]
    fn portable_root_absent_when_dir_missing() {
        let base = Path::new("/pkg");
        assert_eq!(portable_root_in(base, |_| false, |_| true), None);
    }

    #[test]
    fn portable_root_absent_when_profile_missing() {
        // A `.coilbox` folder without `profile.json` (e.g. a normal Windows install
        // whose sidecars live there) is NOT portable.
        let base = Path::new("/pkg");
        let root = portable_root_in(base, |p| p == Path::new("/pkg/.coilbox"), |_| false);
        assert_eq!(root, None);
    }
}
