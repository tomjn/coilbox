//! Spawning child processes without flashing a console window on Windows.
//!
//! Coilbox is a GUI-subsystem app, so it owns no console. When it spawns a
//! console-mode child (pr-downloader, the unitsync worker, springmapconvng,
//! uberstress, the engine), Windows allocates a fresh console for that child,
//! which appears as a command prompt flashing open and shut for the lifetime of
//! the run. `CREATE_NO_WINDOW` suppresses it.
//!
//! The flag is per-spawn: nothing about the parent propagates it, so every
//! `Command` needs it set. Rather than leave each plugin to remember an inline
//! `#[cfg(windows)]` block (four of them had it, three spawn sites didn't),
//! build children through [`command`] and the flag comes for free.
//!
//! Inert off Windows.

use std::ffi::OsStr;
use std::process::Command;

/// `Command::new`, plus `CREATE_NO_WINDOW` on Windows.
///
/// Use this instead of [`std::process::Command::new`] anywhere coilbox spawns a
/// child. Harmless for GUI-subsystem children like the engine, which never get
/// a console either way.
pub fn command<S: AsRef<OsStr>>(program: S) -> Command {
    #[cfg(unix)]
    restore_exec_bit(program.as_ref());
    #[cfg_attr(not(windows), allow(unused_mut))]
    let mut cmd = Command::new(program);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd
}

/// Give `program` an owner execute bit when it has none at all.
///
/// Coilbox extracts Recoil engine releases from `.7z`, and the crate that does it
/// drops the POSIX modes the archive carries, so `spring` and the engine's own
/// `pr-downloader` land non-executable and every run of them fails with EACCES
/// (issue #1013). New installs keep their modes. This repairs the ones already on
/// disk, at the one point where we are about to run the file anyway.
///
/// Only paths are considered, via [`spawned_file`].
#[cfg(unix)]
fn restore_exec_bit(program: &OsStr) {
    use std::os::unix::fs::PermissionsExt;
    let Some(path) = spawned_file(program) else {
        return;
    };
    let Ok(meta) = std::fs::metadata(path) else {
        return;
    };
    let mode = meta.permissions().mode();
    if !meta.is_file() || mode & 0o111 != 0 {
        return;
    }
    let _ = std::fs::set_permissions(path, std::fs::Permissions::from_mode(mode | 0o100));
}

/// The file `Command` will run, when the program names one. A program with no
/// separator in it goes through a `PATH` lookup instead, so a same-named file in
/// the working directory is not the thing about to run and is left alone.
#[cfg(unix)]
fn spawned_file(program: &OsStr) -> Option<&std::path::Path> {
    let path = std::path::Path::new(program);
    let named_a_directory = path.parent().is_some_and(|p| !p.as_os_str().is_empty());
    named_a_directory.then_some(path)
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;

    fn mode_of(path: &std::path::Path) -> u32 {
        std::fs::metadata(path).unwrap().permissions().mode() & 0o777
    }

    fn write(dir: &std::path::Path, name: &str, mode: u32) -> std::path::PathBuf {
        let path = dir.join(name);
        std::fs::write(&path, b"#!/bin/sh\n").unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(mode)).unwrap();
        path
    }

    #[test]
    fn unpacked_engine_binary_becomes_runnable() {
        let dir = tempfile::tempdir().unwrap();
        let bin = write(dir.path(), "spring", 0o644);
        let _ = command(&bin);
        assert_eq!(mode_of(&bin), 0o744, "owner execute bit added");
    }

    #[test]
    fn a_readable_only_binary_keeps_its_other_bits() {
        let dir = tempfile::tempdir().unwrap();
        let bin = write(dir.path(), "pr-downloader", 0o600);
        let _ = command(&bin);
        assert_eq!(mode_of(&bin), 0o700, "group and other stay as they were");
    }

    #[test]
    fn an_executable_binary_is_left_alone() {
        let dir = tempfile::tempdir().unwrap();
        let bin = write(dir.path(), "spring", 0o755);
        let _ = command(&bin);
        assert_eq!(mode_of(&bin), 0o755);
    }

    #[test]
    fn a_group_executable_binary_is_left_alone() {
        // Some other exec bit is enough to run it, so touching the file would be
        // a change we were not asked to make.
        let dir = tempfile::tempdir().unwrap();
        let bin = write(dir.path(), "spring", 0o645);
        let _ = command(&bin);
        assert_eq!(mode_of(&bin), 0o645);
    }

    #[test]
    fn a_bare_program_name_is_left_to_the_path_lookup() {
        assert!(spawned_file(OsStr::new("xdg-open")).is_none());
        assert!(spawned_file(OsStr::new("./xdg-open")).is_some());
        assert!(spawned_file(OsStr::new("/usr/bin/xdg-open")).is_some());
    }

    #[test]
    fn a_missing_program_does_not_panic() {
        let dir = tempfile::tempdir().unwrap();
        let _ = command(dir.path().join("nothing-here"));
    }

    #[test]
    fn a_directory_is_left_alone() {
        let dir = tempfile::tempdir().unwrap();
        let sub = dir.path().join("engine");
        std::fs::create_dir(&sub).unwrap();
        std::fs::set_permissions(&sub, std::fs::Permissions::from_mode(0o700)).unwrap();
        let _ = command(&sub);
        assert_eq!(mode_of(&sub), 0o700);
    }
}
