//! Spawning child processes: no console window on Windows, and a file we can
//! actually run on unix.
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
//! The unix side is the same idea for a different problem: coilbox unpacks
//! engines from archives whose POSIX modes get dropped on the way out, so
//! [`command`] puts the execute bit back on a file it is about to run.
//!
//! Two things here are about a child's lifetime rather than its console.
//! [`command_that_outlives_us`] is for the one child that must not die with
//! coilbox, and [`is_running`] answers "is that process still there" for a
//! process nobody here spawned, so there is no `Child` to ask.

use std::ffi::OsStr;
use std::process::Command;

/// Suppresses the console Windows would otherwise allocate for a console-mode
/// child of a GUI-subsystem parent.
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// Asks the kernel to start the child outside whatever job object this process
/// is in, rather than inheriting it.
///
/// It is a request and not a guarantee: `CreateProcess` refuses it with
/// `ERROR_ACCESS_DENIED` unless the job allows breaking away, which is what
/// `JOB_OBJECT_LIMIT_BREAKAWAY_OK` in `src-tauri/src/win_job.rs` is for.
#[cfg(windows)]
const CREATE_BREAKAWAY_FROM_JOB: u32 = 0x0100_0000;

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
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd
}

/// [`command`], for the one child that has to keep running after coilbox has
/// closed.
///
/// Only the relay agent. Everything else coilbox starts is meant to die with
/// it, which is what `src-tauri/src/win_job.rs` arranges and why an orphaned
/// pr-downloader does not sit there holding its own `.exe` open through an
/// installer run.
///
/// The relay agent is the exception because a relayed battle is carried by it:
/// close the window mid-game and every other player is dropped from a game the
/// host carries on playing. That is the failure the sidecar exists to prevent,
/// and on Windows the job object caused it (issue #2033).
///
/// Outside Windows this is [`command`] and nothing more. No job object exists,
/// and `std::process::Child` neither kills nor waits on drop, so a child whose
/// parent exits is simply reparented and carries on.
pub fn command_that_outlives_us<S: AsRef<OsStr>>(program: S) -> Command {
    #[cfg_attr(not(windows), allow(unused_mut))]
    let mut cmd = command(program);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(CREATE_NO_WINDOW | CREATE_BREAKAWAY_FROM_JOB);
    }
    cmd
}

/// Whether process `pid` is still running.
///
/// For a process this one did not spawn and therefore holds no `Child` for:
/// the relay agent watching the engine coilbox launched, and coilbox deciding
/// whether the relay agent named in a run file is still there or is a leftover
/// from a session that was killed (issue #2027).
///
/// Note what this cannot tell you. A pid is only unique while its process
/// lives, so a pid the OS has since handed to something else answers `true`.
/// That is safe for both callers here because both are asking "may I assume it
/// has gone", and the answer being late is a wait rather than a mistake. It
/// would not be safe for anything that then went on to signal the pid.
pub fn is_running(pid: u32) -> bool {
    #[cfg(unix)]
    {
        // Signal 0 does no signalling. It runs the kernel's existence and
        // permission checks and returns their result, which is exactly the
        // question. `EPERM` means the process is there and belongs to somebody
        // else, so it counts as running. Only `ESRCH` means gone.
        if unsafe { libc::kill(pid as libc::pid_t, 0) } == 0 {
            return true;
        }
        std::io::Error::last_os_error().raw_os_error() == Some(libc::EPERM)
    }
    #[cfg(windows)]
    {
        use windows::Win32::Foundation::{CloseHandle, WAIT_OBJECT_0};
        use windows::Win32::System::Threading::{
            OpenProcess, WaitForSingleObject, PROCESS_QUERY_LIMITED_INFORMATION, SYNCHRONIZE,
        };

        // A process that has exited but still has a handle open somewhere can
        // be opened, so the handle is not the answer on its own. Waiting on it
        // with no timeout is: the object is signalled once the process has
        // exited and not before. `GetExitCodeProcess` would be the other
        // route, and it is worse, because a process that genuinely exited with
        // 259 is indistinguishable from `STILL_ACTIVE`.
        unsafe {
            let Ok(handle) =
                OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION | SYNCHRONIZE, false, pid)
            else {
                // No such process, or one we are not allowed to look at. The
                // second is not a case coilbox reaches: both processes it asks
                // about are its own children.
                return false;
            };
            let finished = WaitForSingleObject(handle, 0) == WAIT_OBJECT_0;
            let _ = CloseHandle(handle);
            !finished
        }
    }
    #[cfg(not(any(unix, windows)))]
    {
        let _ = pid;
        true
    }
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

#[cfg(test)]
mod liveness {
    //! Real processes rather than a mock of the OS, because the thing under
    //! test is what the OS says and a mock of that is a statement of what we
    //! already believe.

    use super::*;

    /// A process that has definitely finished, and whose pid we still hold.
    ///
    /// Reaped before the pid is handed back, so on unix it is gone rather than
    /// a zombie, which is the state the callers care about.
    fn a_finished_process() -> u32 {
        let (program, args): (&str, &[&str]) = if cfg!(windows) {
            ("cmd", &["/C", "exit"])
        } else {
            ("sh", &["-c", "exit"])
        };
        let mut child = Command::new(program)
            .args(args)
            .spawn()
            .expect("a shell to run");
        let pid = child.id();
        child.wait().expect("it exits at once");
        pid
    }

    #[test]
    fn this_process_is_running() {
        assert!(is_running(std::process::id()));
    }

    #[test]
    fn a_process_that_has_finished_is_not_running() {
        assert!(
            !is_running(a_finished_process()),
            "a finished process reading as running is what leaves a relay agent \
             waiting on an engine that ended minutes ago"
        );
    }
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
