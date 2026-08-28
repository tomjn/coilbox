//! The file that makes a running agent findable, so a coilbox that reopens
//! mid-game finds the relay it already has (issue #2027).
//!
//! Somebody who closes coilbox during a relayed battle and opens it again
//! should get their battle back. What they must not get is a second agent: the
//! players in that game are being relayed by the first one, which is still
//! carrying their traffic and which nobody is talking to any more. A second
//! agent would open a second allocation at a second address, advertise that,
//! and leave the game running through a relay coilbox has forgotten about.
//!
//! ## Why the agent owns the file rather than coilbox
//!
//! Because the file has to mean "an agent is running", and only the agent
//! knows that. It creates the file when it starts and removes it when it
//! stops, so the file's life is the process's life and there is no window
//! where coilbox has written a record of an agent that failed to start.
//!
//! ## What it cannot promise
//!
//! An agent killed outright leaves its file behind, so the file existing is
//! not the answer on its own. The pid in it is, via
//! [`coilbox_proc::is_running`], and a stale file is cleared by whoever finds
//! it next.
//!
//! One gap survives that, and it is worth writing down rather than leaving to
//! be found: a pid the OS has since given to something unrelated reads as
//! running. The cost is an agent that refuses to start and a coilbox that says
//! a relay is already going when it is not, which the user can clear by
//! deleting the file. Closing it properly means an OS-level lock, and that is
//! a lot of machinery for a case that needs a killed agent, a recycled pid and
//! a restart in between.
//!
//! ## Two coilboxes starting at once
//!
//! Barely possible, since coilbox is single-instance on Windows and Linux
//! (`tauri_plugin_single_instance`, `src-tauri/src/main.rs`) and macOS will not
//! launch a second copy of an installed app. It is handled anyway, because the
//! failure is silent and expensive: the claim is an exclusive create, so of
//! two agents racing exactly one gets the file and the other refuses to start
//! rather than both relaying the same battle to different addresses.

use std::io;
use std::path::{Path, PathBuf};

use coilbox_relay_protocol::RunFile as Contents;

/// Why this agent did not get the run file.
#[derive(Debug)]
pub enum Taken {
    /// Another agent has it, and is still running.
    ByAgent(u32),
    /// The file could not be created or written at all.
    Unwritable(io::Error),
}

impl std::fmt::Display for Taken {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Taken::ByAgent(pid) => write!(f, "relay agent {pid} is already running"),
            Taken::Unwritable(e) => write!(f, "could not write the run file: {e}"),
        }
    }
}

/// This agent's claim on the run file, held for as long as it runs.
#[derive(Debug)]
pub struct Claim {
    path: PathBuf,
}

impl Claim {
    /// Claim `path` for this process, or fail because somebody already has it.
    ///
    /// A stale file, meaning one naming a process that has gone, is cleared
    /// and taken over. That is the ordinary case after a crash and it must not
    /// stop the next battle.
    pub fn take(path: PathBuf) -> Result<Claim, Taken> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(Taken::Unwritable)?;
        }
        match create_new(&path) {
            Ok(()) => return Ok(Claim { path }),
            Err(e) if e.kind() != io::ErrorKind::AlreadyExists => {
                return Err(Taken::Unwritable(e))
            }
            Err(_) => {}
        }
        if let Some(pid) = holder(&path) {
            return Err(Taken::ByAgent(pid));
        }
        // Nobody is behind it, so it is a file an agent that was killed left
        // lying around.
        std::fs::remove_file(&path).map_err(Taken::Unwritable)?;
        match create_new(&path) {
            Ok(()) => Ok(Claim { path }),
            // Somebody claimed it in the moment between the two, which is the
            // race the exclusive create exists to settle. They won.
            Err(e) if e.kind() == io::ErrorKind::AlreadyExists => {
                Err(Taken::ByAgent(holder(&path).unwrap_or_default()))
            }
            Err(e) => Err(Taken::Unwritable(e)),
        }
    }
}

impl Drop for Claim {
    /// Give the file up, so the next coilbox knows there is no agent to find.
    ///
    /// Only if it is still ours. An agent that read somebody else's file out
    /// from under them would put the next coilbox straight back into spawning
    /// a second agent over a live battle, which is the thing all of this is
    /// for.
    fn drop(&mut self) {
        if holder(&self.path) == Some(std::process::id()) {
            let _ = std::fs::remove_file(&self.path);
        }
    }
}

/// Create the file and write this process into it, failing if it is there.
///
/// `create_new` is the whole mechanism: it is one atomic syscall, so two
/// agents racing cannot both succeed.
fn create_new(path: &Path) -> io::Result<()> {
    use std::io::Write;
    let mut file = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)?;
    file.write_all(
        Contents {
            pid: std::process::id(),
        }
        .to_json()
        .as_bytes(),
    )
}

/// The pid of the agent that holds `path`, if one still does.
///
/// `None` covers every way of not having an answer: no file, an unreadable
/// one, or one naming a process that has gone. They all mean the same thing to
/// a caller, which is that nothing is relaying.
fn holder(path: &Path) -> Option<u32> {
    let text = std::fs::read_to_string(path).ok()?;
    let pid = Contents::from_json(&text).ok()?.pid;
    coilbox_proc::is_running(pid).then_some(pid)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn a_path() -> (tempfile::TempDir, PathBuf) {
        let dir = tempfile::tempdir().expect("a temp dir");
        let path = dir.path().join("relay").join("agent.json");
        (dir, path)
    }

    /// The point of the file: it is there while the agent is, and gone
    /// afterwards, so coilbox can tell one from the other.
    #[test]
    fn a_claim_is_visible_while_it_is_held_and_gone_once_it_is_not() {
        let (_dir, path) = a_path();

        let claim = Claim::take(path.clone()).expect("nothing else has it");
        assert_eq!(holder(&path), Some(std::process::id()));

        drop(claim);
        assert!(!path.exists(), "a stopped agent leaves nothing to find");
    }

    /// The failure this exists to prevent, stated directly: while an agent
    /// holds the file, a second one does not get to start.
    #[test]
    fn a_second_agent_does_not_get_a_claim_somebody_else_holds() {
        let (_dir, path) = a_path();
        let _held = Claim::take(path.clone()).expect("nothing else has it");

        let refused = Claim::take(path.clone()).expect_err("one agent per battle");
        assert!(
            matches!(refused, Taken::ByAgent(pid) if pid == std::process::id()),
            "got: {refused}"
        );
    }

    /// An agent that was killed leaves its file behind. The next battle has to
    /// start anyway, or one crash means no more relayed games until somebody
    /// finds the file and deletes it by hand.
    #[test]
    fn a_file_left_by_an_agent_that_died_is_taken_over() {
        let (_dir, path) = a_path();
        std::fs::create_dir_all(path.parent().expect("a parent")).expect("a writable temp dir");
        std::fs::write(&path, Contents { pid: gone_pid() }.to_json()).expect("a writable file");

        let _claim = Claim::take(path.clone()).expect("a dead agent holds nothing");
        assert_eq!(holder(&path), Some(std::process::id()));
    }

    /// A file from some other version, or one somebody has half written. There
    /// is no agent to find in it, so it is treated as one that was left
    /// behind.
    #[test]
    fn a_file_that_cannot_be_read_is_treated_as_nobody_holding_it() {
        let (_dir, path) = a_path();
        std::fs::create_dir_all(path.parent().expect("a parent")).expect("a writable temp dir");
        std::fs::write(&path, "{\"relayAgent\":").expect("a writable file");

        let _claim = Claim::take(path.clone()).expect("an unreadable file holds nothing");
        assert_eq!(holder(&path), Some(std::process::id()));
    }

    /// Dropping a claim must not take away a file that is now somebody else's,
    /// which would put the next coilbox back into spawning a second agent over
    /// a live battle.
    #[test]
    fn dropping_a_claim_leaves_another_agents_file_alone() {
        let (_dir, path) = a_path();
        let claim = Claim::take(path.clone()).expect("nothing else has it");

        // Somebody else's agent, written over the top the way a hand edit or a
        // restore from backup would.
        std::fs::write(&path, Contents { pid: gone_pid() }.to_json()).expect("a writable file");
        drop(claim);

        assert!(path.exists(), "a claim only ever removes its own file");
    }

    /// A pid that is definitely not in use, for standing in for an agent that
    /// was killed.
    fn gone_pid() -> u32 {
        let (program, args): (&str, &[&str]) = if cfg!(windows) {
            ("cmd", &["/C", "exit"])
        } else {
            ("sh", &["-c", "exit"])
        };
        let mut child = std::process::Command::new(program)
            .args(args)
            .spawn()
            .expect("a shell to run");
        let pid = child.id();
        child.wait().expect("it exits at once");
        pid
    }
}
