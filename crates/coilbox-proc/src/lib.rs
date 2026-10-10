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
        use windows_sys::Win32::Foundation::{CloseHandle, INVALID_HANDLE_VALUE, WAIT_OBJECT_0};
        use windows_sys::Win32::System::Threading::{
            OpenProcess, WaitForSingleObject, PROCESS_QUERY_LIMITED_INFORMATION,
            PROCESS_SYNCHRONIZE,
        };

        // A process that has exited but still has a handle open somewhere can
        // be opened, so the handle is not the answer on its own. Waiting on it
        // with no timeout is: the object is signalled once the process has
        // exited and not before. `GetExitCodeProcess` would be the other
        // route, and it is worse, because a process that genuinely exited with
        // 259 is indistinguishable from `STILL_ACTIVE`.
        unsafe {
            // `windows-sys` hands back the raw HANDLE rather than a `Result`,
            // so the failure test is ours to make. OpenProcess documents NULL
            // as its only failure return, and INVALID_HANDLE_VALUE is rejected
            // too because that is the other value the `windows` wrapper this
            // replaced counted as a failure.
            let handle = OpenProcess(
                PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_SYNCHRONIZE,
                0,
                pid,
            );
            if handle.is_null() || handle == INVALID_HANDLE_VALUE {
                // No such process, or one we are not allowed to look at. The
                // second is not a case coilbox reaches: both processes it asks
                // about are its own children.
                return false;
            }
            let finished = WaitForSingleObject(handle, 0) == WAIT_OBJECT_0;
            // Still closed by hand. A raw HANDLE has no `Drop`, just as the
            // `windows` HANDLE it replaces had none, so nothing closes it for
            // us.
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

/// The bytes free to this user on the drive holding `path`, which must exist.
///
/// Lives here for the same reason as [`is_running`]: it asks the OS directly
/// through `libc` and `windows-sys`, which this crate already carries.
pub fn free_space(path: &std::path::Path) -> std::io::Result<u64> {
    #[cfg(unix)]
    {
        use std::os::unix::ffi::OsStrExt;
        let c_path = std::ffi::CString::new(path.as_os_str().as_bytes())
            .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidInput, e))?;
        let mut stats: libc::statvfs = unsafe { std::mem::zeroed() };
        if unsafe { libc::statvfs(c_path.as_ptr(), &mut stats) } != 0 {
            return Err(std::io::Error::last_os_error());
        }
        // The field widths differ between macOS and Linux, so the casts are
        // needed on one and redundant on the other.
        #[allow(clippy::unnecessary_cast)]
        Ok(stats.f_bavail as u64 * stats.f_frsize as u64)
    }
    #[cfg(windows)]
    {
        use std::os::windows::ffi::OsStrExt;
        use windows_sys::Win32::Storage::FileSystem::GetDiskFreeSpaceExW;
        let wide: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
        let mut available: u64 = 0;
        let ok = unsafe {
            GetDiskFreeSpaceExW(
                wide.as_ptr(),
                &mut available,
                std::ptr::null_mut(),
                std::ptr::null_mut(),
            )
        };
        if ok == 0 {
            return Err(std::io::Error::last_os_error());
        }
        Ok(available)
    }
    #[cfg(not(any(unix, windows)))]
    {
        let _ = path;
        Err(std::io::Error::other(
            "free space is unknown on this platform",
        ))
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

/// Lets go of whatever it holds open inside an engine folder, and returns once
/// it has.
type EngineHolder = Box<dyn Fn(&std::path::Path) + Send + Sync>;

/// Everything that holds files open inside engine folders between uses. Today
/// that is the unitsync plugin, whose workers keep an engine's `unitsync`
/// library loaded while they run.
///
/// Here for the same reason [`CONTENT_ROOTS`] is: the plugin that deletes or
/// replaces an engine folder and the plugin that holds it open do not depend on
/// each other, and both depend on this crate.
static ENGINE_HOLDERS: std::sync::RwLock<Vec<EngineHolder>> = std::sync::RwLock::new(Vec::new());

/// Register something to call before an engine folder is deleted or replaced.
pub fn on_engine_release(holder: impl Fn(&std::path::Path) + Send + Sync + 'static) {
    ENGINE_HOLDERS
        .write()
        .unwrap_or_else(|e| e.into_inner())
        .push(Box::new(holder));
}

/// Have every registered holder let go of the files under `dir`, an engine's
/// folder or a folder of engines. Call it before deleting, overwriting or
/// renaming anything in there.
///
/// It matters on Windows, which will not delete or overwrite a library a
/// process has loaded: a recursive delete removes what it can and stops,
/// leaving half an engine. It blocks until the holders have let go, which can
/// take as long as a read they are in the middle of, so call it from a blocking
/// task.
pub fn release_engine(dir: &std::path::Path) {
    for holder in ENGINE_HOLDERS
        .read()
        .unwrap_or_else(|e| e.into_inner())
        .iter()
    {
        holder(dir);
    }
}

/// How many games the player is in right now.
static GAMES_RUNNING: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);

/// Held for as long as a game the player launched is running. See
/// [`game_started`].
pub struct GameRunning(());

impl Drop for GameRunning {
    fn drop(&mut self) {
        GAMES_RUNNING.fetch_sub(1, std::sync::atomic::Ordering::SeqCst);
    }
}

/// Say that a game the player is in has started. It counts as running until
/// what this returns is dropped.
///
/// Here for the same reason [`CONTENT_ROOTS`] is. The play plugin launches
/// games and the content plugin runs replay analyses, a headless engine at
/// full speed, and neither depends on the other. An analysis must not run
/// under a game somebody is playing, so the one tells the other through this.
pub fn game_started() -> GameRunning {
    GAMES_RUNNING.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
    GameRunning(())
}

/// Whether a game the player launched is running.
pub fn game_running() -> bool {
    GAMES_RUNNING.load(std::sync::atomic::Ordering::SeqCst) > 0
}

/// What the engine splits a `SPRING_DATADIR` list on (`cPD` in its
/// `DataDirLocater.cpp`).
pub const DATADIR_SEP: char = if cfg!(windows) { ';' } else { ':' };

/// Every content folder the content plugin knows, published by it each time it
/// hands a state to the frontend. The unitsync and play plugins read it back so
/// an engine sees all of them, where it used to see only the folder it lives in
/// and called a game sitting in the next folder along "not installed".
static CONTENT_ROOTS: std::sync::RwLock<Vec<String>> = std::sync::RwLock::new(Vec::new());

/// Replace the published content folders.
pub fn set_content_roots(roots: Vec<String>) {
    *CONTENT_ROOTS.write().unwrap() = roots;
}

/// The content folders last published with [`set_content_roots`].
pub fn content_roots() -> Vec<String> {
    CONTENT_ROOTS.read().unwrap().clone()
}

/// The published content folders other than `primary`, as a `SPRING_DATADIR`
/// style list. Empty when there are none.
pub fn extra_datadirs(primary: &str) -> String {
    join_extras(primary, &CONTENT_ROOTS.read().unwrap())
}

/// The `SPRING_DATADIR` for an engine whose own folder is `primary`. That folder
/// comes first, which the engine reads as the highest priority.
pub fn spring_datadir(primary: &str) -> String {
    let extras = extra_datadirs(primary);
    if extras.is_empty() {
        primary.to_string()
    } else {
        format!("{primary}{DATADIR_SEP}{extras}")
    }
}

/// The env that stops an engine, or unitsync, reading the player's other Spring
/// folders (`~/.spring`, `My Games\Spring`), for a portable coilbox. It still
/// reads every folder in `SPRING_DATADIR`.
///
/// The folder named is the engine's own, never a content folder: it is the only
/// place the engine's base content is, and isolation drops it unless it is the
/// folder named.
pub fn isolation_env(portable: bool, engine_dir: &std::path::Path) -> Option<(String, String)> {
    portable.then(|| ("SPRING_ISOLATED".into(), engine_dir.display().to_string()))
}

fn join_extras(primary: &str, roots: &[String]) -> String {
    roots
        .iter()
        // A folder with the separator in its name cannot go in the list: the
        // engine would split it into two folders that do not exist.
        .filter(|r| r.as_str() != primary && !r.is_empty() && !r.contains(DATADIR_SEP))
        .map(String::as_str)
        .collect::<Vec<_>>()
        .join(&DATADIR_SEP.to_string())
}

#[cfg(test)]
mod game_running {
    use super::*;

    /// The only test in this crate that says a game started, so the count is
    /// its own.
    #[test]
    fn a_game_counts_as_running_until_what_it_was_given_is_dropped() {
        assert!(!game_running());
        let first = game_started();
        let second = game_started();
        assert!(game_running());
        drop(first);
        assert!(game_running(), "one of two games ending is not both");
        drop(second);
        assert!(!game_running());
    }
}

#[cfg(test)]
mod datadirs {
    use super::*;

    fn roots(paths: &[&str]) -> Vec<String> {
        paths.iter().map(|p| p.to_string()).collect()
    }

    #[test]
    fn the_engines_own_folder_is_left_out_of_the_extras() {
        let sep = DATADIR_SEP;
        assert_eq!(
            join_extras("/a", &roots(&["/a", "/b", "/c"])),
            format!("/b{sep}/c")
        );
    }

    #[test]
    fn no_other_folders_means_no_extras() {
        assert_eq!(join_extras("/a", &roots(&["/a"])), "");
        assert_eq!(join_extras("/a", &[]), "");
    }

    #[test]
    fn a_folder_the_engine_would_split_is_dropped() {
        let split = format!("/b{DATADIR_SEP}c");
        assert_eq!(join_extras("/a", &roots(&[&split, "/d"])), "/d");
    }

    #[test]
    fn a_portable_coilbox_isolates_the_engine_to_its_own_folder() {
        let engine = std::path::Path::new("/pkg/engine/105");
        assert_eq!(
            isolation_env(true, engine),
            Some(("SPRING_ISOLATED".to_string(), "/pkg/engine/105".to_string()))
        );
    }

    #[test]
    fn an_installed_coilbox_leaves_the_engine_its_usual_folders() {
        assert_eq!(isolation_env(false, std::path::Path::new("/e")), None);
    }
}

#[cfg(test)]
mod engine_release {
    use super::*;
    use std::path::{Path, PathBuf};
    use std::sync::{Arc, Mutex};

    #[test]
    fn every_holder_is_told_which_folder_to_let_go_of() {
        let told: Arc<Mutex<Vec<(u8, PathBuf)>>> = Arc::default();
        for holder in [1, 2] {
            let told = told.clone();
            on_engine_release(move |dir| {
                // Other tests in this process may release folders of their own.
                if dir.ends_with("engine-release-test") {
                    told.lock().unwrap().push((holder, dir.to_path_buf()));
                }
            });
        }
        let dir = Path::new("/content/engine/engine-release-test");
        release_engine(dir);
        assert_eq!(
            *told.lock().unwrap(),
            vec![(1, dir.to_path_buf()), (2, dir.to_path_buf())],
            "both were called, and before release_engine returned"
        );
    }
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

#[cfg(test)]
mod free_space_tests {
    #[test]
    fn free_space_reads_a_real_folder_and_refuses_a_missing_one() {
        let dir = tempfile::tempdir().unwrap();
        assert!(super::free_space(dir.path()).unwrap() > 0);
        assert!(super::free_space(&dir.path().join("not-there")).is_err());
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
