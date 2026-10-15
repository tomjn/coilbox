//! A `.sdz` or `.sd7` opened with coilbox from the file manager.
//!
//! Windows and Linux hand the file over as a launch argument. A first launch
//! finds it in its own arguments, which the frontend asks for once it is up
//! (`launch_archives`). A launch while coilbox is running is caught by the
//! single-instance plugin, whose callback in `main.rs` emits [`EVENT`] with what
//! that launch was given.
//!
//! macOS sends an open-file event instead, which the deep-link plugin already
//! forwards to the frontend as a `file://` URL, so nothing here runs for it.
//!
//! Nothing is copied from here. The frontend asks the player first.

use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};

/// Emitted with the archive paths a second launch was given.
#[cfg(not(target_os = "macos"))]
pub const EVENT: &str = "open-archive";

/// The archive paths among a launch's arguments, made absolute against `cwd`.
/// `args` is the whole argument list, program name first.
pub fn archives_in<S: AsRef<str>>(args: &[S], cwd: &Path) -> Vec<String> {
    args.iter()
        .skip(1)
        .map(AsRef::as_ref)
        .filter(|arg| {
            Path::new(arg)
                .extension()
                .and_then(|e| e.to_str())
                .is_some_and(|e| e.eq_ignore_ascii_case("sdz") || e.eq_ignore_ascii_case("sd7"))
        })
        .map(|arg| cwd.join(arg).display().to_string())
        .collect()
}

/// The archives this process was launched with. Answers once: a webview that
/// reloads must not offer the same file a second time.
#[tauri::command]
pub fn launch_archives() -> Vec<String> {
    static TAKEN: AtomicBool = AtomicBool::new(false);
    if TAKEN.swap(true, Ordering::SeqCst) {
        return Vec::new();
    }
    let args: Vec<String> = std::env::args().collect();
    let cwd = std::env::current_dir().unwrap_or_default();
    archives_in(&args, &cwd)
}

#[cfg(test)]
mod tests {
    use super::archives_in;
    use std::path::Path;

    #[test]
    fn keeps_archives_and_drops_everything_else() {
        let found = archives_in(
            &[
                "/usr/bin/coilbox",
                "coilbox://open?screen=maps",
                "/home/me/Downloads/Game 1.0.sdz",
                "--flag",
                "/home/me/Map.SD7",
                "/home/me/notes.txt",
            ],
            Path::new("/somewhere"),
        );
        assert_eq!(
            found,
            ["/home/me/Downloads/Game 1.0.sdz", "/home/me/Map.SD7"]
        );
    }

    #[test]
    fn the_program_name_is_never_an_archive() {
        assert!(archives_in(&["/odd/place.sdz"], Path::new("/")).is_empty());
    }

    #[test]
    fn a_relative_path_is_resolved_against_the_launch_folder() {
        let found = archives_in(&["coilbox", "game.sdz"], Path::new("/home/me/Downloads"));
        assert_eq!(found, ["/home/me/Downloads/game.sdz"]);
    }
}
