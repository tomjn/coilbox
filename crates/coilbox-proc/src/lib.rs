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
