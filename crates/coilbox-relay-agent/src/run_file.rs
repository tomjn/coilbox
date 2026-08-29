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
//! ## The note that comes back the other way
//!
//! Being findable is only half of what a reopened coilbox needs. Finding an
//! agent it cannot speak to and cannot stop left a host with a process id and
//! no way to host again (issue #2062), so
//! [`take_notes_asking_us_to_stop`] reads a note coilbox leaves beside this
//! file. It is a request rather than an order, because the agent may be
//! carrying a game and the coilbox asking has no idea whether it is.
//!
//! ## Two coilboxes starting at once
//!
//! Barely possible, since coilbox is single-instance on Windows and Linux
//! (`tauri_plugin_single_instance`, `src-tauri/src/main.rs`) and macOS will not
//! launch a second copy of an installed app. It is handled anyway, because the
//! failure is silent and expensive: the claim is an exclusive create, so of
//! two agents racing exactly one gets the file and the other refuses to start
//! rather than both relaying the same battle to different addresses.

use std::convert::Infallible;
use std::io;
use std::path::{Path, PathBuf};

use coilbox_relay_protocol::{
    stop_note_path, RunFile as Contents, StopNote, NOTE_LOOKED_FOR_EVERY,
};

use crate::stopping::Stopping;

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
            Err(e) if e.kind() != io::ErrorKind::AlreadyExists => return Err(Taken::Unwritable(e)),
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

/// Read notes left beside `run_file` asking this agent to stop, forever.
///
/// The other half of the run file, and the reason it is in this module: the run
/// file is how a coilbox with no pipe finds this agent, and this is the only
/// thing it can then say to it. [`coilbox_relay_protocol::StopNote`] carries why
/// the channel exists and why it is a request rather than an order.
///
/// Never returns. Nothing waits on it, and the process exiting is what ends it.
///
/// Two things about it are not obvious and neither can be dropped.
///
/// Nothing is read until this agent's own coilbox has closed. A note is what a
/// coilbox with no pipe says, and while the pipe is open the coilbox on the
/// other end of it is the one hosting through this relay: acting on a note then
/// would let a second coilbox end a battle the first one is holding open.
///
/// A note is taken only if it names this process. That makes a note nobody ever
/// took inert rather than a stop the next agent to start inherits, which
/// matters because coilbox writes one and then has no way of withdrawing it.
pub async fn take_notes_asking_us_to_stop(run_file: &Path, stopping: &Stopping) -> Infallible {
    let note = stop_note_path(run_file);
    let us = std::process::id();
    loop {
        tokio::time::sleep(NOTE_LOOKED_FOR_EVERY).await;
        if stopping.has_coilbox_gone() && take_note_for(&note, us) {
            eprintln!(
                "coilbox-relay-agent: coilbox has left a note asking this relay to stop. If a \
                 game is still being played through it, it carries on until that game ends."
            );
            stopping.coilbox_left_a_note();
        }
    }
}

/// Take the note at `path` if it is addressed to process `us`.
///
/// Taking it means removing it, which is how the coilbox that wrote it learns
/// that something read it. That is the only proof of life it can get from a
/// process it has no pipe to, and it is what tells "a relay that is carrying a
/// game and would not stop" apart from "a run file naming a process id the OS
/// has since given to something else".
///
/// Everything that is not a note for us is left where it is: no file, an
/// unreadable one, or one naming a different process. Removing another agent's
/// note would take away the answer its own coilbox is waiting for.
fn take_note_for(path: &Path, us: u32) -> bool {
    let Ok(text) = std::fs::read_to_string(path) else {
        return false;
    };
    if StopNote::from_json(&text).ok().map(|note| note.pid) != Some(us) {
        return false;
    }
    // Removed before the flag is set rather than after, so a coilbox watching
    // for the note to go never sees an agent that has already acted on one it
    // still appears not to have read.
    let _ = std::fs::remove_file(path);
    true
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

    /// Write a note addressed to `pid` where this agent will look for one.
    fn leave_a_note(run_file: &Path, pid: u32) -> PathBuf {
        let note = stop_note_path(run_file);
        std::fs::create_dir_all(note.parent().expect("a parent")).expect("a writable temp dir");
        std::fs::write(&note, StopNote { pid }.to_json()).expect("a writable file");
        note
    }

    /// The channel itself: a note for this process is taken, and taking it
    /// removes the file, which is the only answer the coilbox that wrote it
    /// will ever get.
    #[test]
    fn a_note_for_this_process_is_taken_and_the_file_goes_with_it() {
        let (_dir, path) = a_path();
        let note = leave_a_note(&path, std::process::id());

        assert!(take_note_for(&note, std::process::id()));
        assert!(
            !note.exists(),
            "a note that stays put reads to coilbox as one nothing ever looked at"
        );
    }

    /// A note for somebody else stays where it is. coilbox has no way to
    /// withdraw one, so a note nobody took would otherwise become a stop the
    /// next agent inherits, and removing it would take away the answer another
    /// agent's coilbox is waiting on.
    #[test]
    fn a_note_for_another_process_is_left_alone() {
        let (_dir, path) = a_path();
        let note = leave_a_note(&path, gone_pid());

        assert!(!take_note_for(&note, std::process::id()));
        assert!(note.exists(), "somebody else's note is not ours to take");
    }

    /// Half a note, or one from a version that wrote a different shape. Reading
    /// a stop out of it would end a relay nobody asked about.
    #[test]
    fn a_note_that_cannot_be_read_is_not_a_note_for_us() {
        let (_dir, path) = a_path();
        let note = stop_note_path(&path);
        std::fs::create_dir_all(note.parent().expect("a parent")).expect("a writable temp dir");
        std::fs::write(&note, "{\"pid\":").expect("a writable file");

        assert!(!take_note_for(&note, std::process::id()));
    }

    #[test]
    fn no_note_is_not_a_note() {
        let (_dir, path) = a_path();
        assert!(!take_note_for(&stop_note_path(&path), std::process::id()));
    }

    /// The gate, and the reason it is in the reader rather than only in the
    /// stopping rule: while coilbox is there the note is not even read, so a
    /// second coilbox cannot take the answer the first one is waiting on out
    /// from under it either.
    #[tokio::test(start_paused = true)]
    async fn no_note_is_read_while_coilbox_is_still_there() {
        let (_dir, path) = a_path();
        let note = leave_a_note(&path, std::process::id());
        let stopping = Stopping::new();

        tokio::select! {
            _ = take_notes_asking_us_to_stop(&path, &stopping) => unreachable!("it never returns"),
            () = tokio::time::sleep(NOTE_LOOKED_FOR_EVERY * 10) => {}
        }

        assert!(
            note.exists(),
            "a coilbox holding the pipe to this agent says stop down it, so a note arriving \
             now is somebody else's and must not be acted on"
        );
        assert_eq!(stopping.reason(), None);
    }

    /// The whole path inside the agent, on a leftover with nothing to protect:
    /// coilbox has gone, a note turns up, and the agent decides to stop.
    #[tokio::test(start_paused = true)]
    async fn a_note_left_after_coilbox_has_gone_is_taken_and_acted_on() {
        let (_dir, path) = a_path();
        let note = leave_a_note(&path, std::process::id());
        let stopping = Stopping::new();
        stopping.coilbox_has_gone();

        tokio::select! {
            _ = take_notes_asking_us_to_stop(&path, &stopping) => unreachable!("it never returns"),
            reason = stopping.wait() => assert_eq!(reason, crate::stopping::Reason::AskedInANote),
        }

        assert!(!note.exists(), "the note has to be taken, not only read");
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
