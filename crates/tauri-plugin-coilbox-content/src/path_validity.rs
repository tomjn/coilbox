//! Cross-machine / cross-OS validity checks for stored content-root paths.
//!
//! Coilbox's portable `.coilbox/data` folder is designed to be shareable: a
//! distributor sets it up, then copies the whole folder onto another machine (or a
//! different OS entirely). `content/state.json` under it can carry absolute paths
//! baked in from the machine it was written on, a Windows drive path like
//! `E:\Coilbox-master` is meaningless on macOS/Linux, and a POSIX path is
//! meaningless on Windows. `is_foreign_absolute` flags exactly that shape so the
//! caller can treat it as permanently absent rather than trust an accidental
//! `Path`/`canonicalize` parse of it (issue #524).

/// True when `path` is an absolute path written in a different OS's syntax than
/// the one we're running on: a Windows drive letter (`E:\...` / `E:/...`) or UNC
/// (`\\server\share`) path evaluated off Windows, or a POSIX-rooted path (`/...`)
/// evaluated on Windows. Such a string can never resolve to a real folder here.
///
/// A same-OS relative or absolute path returns `false` (it may or may not exist,
/// that's a normal filesystem check, not an OS-mismatch).
pub fn is_foreign_absolute(path: &str) -> bool {
    if path.is_empty() {
        return false;
    }
    let bytes = path.as_bytes();
    let looks_windows = (bytes.len() >= 3
        && bytes[0].is_ascii_alphabetic()
        && bytes[1] == b':'
        && (bytes[2] == b'\\' || bytes[2] == b'/'))
        || path.starts_with("\\\\");
    if cfg!(windows) {
        // A POSIX-rooted path (leading `/`, no drive letter) isn't a Windows path.
        path.starts_with('/') && !looks_windows
    } else {
        looks_windows
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn windows_drive_paths_are_foreign_off_windows() {
        if cfg!(windows) {
            return;
        }
        assert!(is_foreign_absolute(r"E:\Coilbox-master"));
        assert!(is_foreign_absolute("E:/Coilbox-master"));
        assert!(is_foreign_absolute(r"\\server\share\dir"));
    }

    #[test]
    fn posix_paths_are_foreign_on_windows() {
        if !cfg!(windows) {
            return;
        }
        assert!(is_foreign_absolute("/Users/tomjn/dev/coilbox"));
        assert!(!is_foreign_absolute(r"C:\Coilbox-master"));
    }

    #[test]
    fn native_absolute_paths_are_not_foreign() {
        let native = if cfg!(windows) {
            r"C:\Users\u\.spring"
        } else {
            "/home/u/.spring"
        };
        assert!(!is_foreign_absolute(native));
    }

    #[test]
    fn relative_paths_are_not_foreign() {
        assert!(!is_foreign_absolute("game-data"));
        assert!(!is_foreign_absolute("."));
        assert!(!is_foreign_absolute(""));
    }
}
