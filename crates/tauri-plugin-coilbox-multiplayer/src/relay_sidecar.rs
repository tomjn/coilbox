//! Where the relay agent binary is, what to start it with, and how to tell
//! whether one is already running.
//!
//! Everything here is pure or nearly so, which is the point: the spawn itself
//! is in [`crate::relay_agent`] where the pipes and the control channel are,
//! and the parts worth testing are separated from the part that needs a
//! process.
//!
//! ## Finding one that is already there
//!
//! Somebody who closes coilbox during a relayed battle and opens it again has
//! a game still running through a sidecar coilbox no longer has pipes to. It
//! must not start a second one: that would open a second allocation at a
//! second address and advertise it, while the players in the game carry on
//! through the first.
//!
//! [`already_relaying`] is the check, and the sidecar leaves the run file that
//! answers it. The sidecar makes the same check itself when it starts, with an
//! exclusive create, so two coilboxes racing cannot both win. This one is what
//! keeps coilbox from launching a process it knows will refuse.
//!
//! What coilbox cannot do is take the running sidecar back over. Its control
//! channel is that process's stdin and stdout, and there is no reattaching to
//! those from a new parent. So a reopened coilbox finds the relay and leaves
//! it be, which means the players already in that game keep playing and
//! nobody new can be let through until it ends. `relay_agent`'s module doc
//! carries the same limitation from the sidecar's side.
//!
//! ## Asking one to stop without a pipe to it
//!
//! Finding a sidecar and being unable to say anything to it left a host with a
//! process id and no way to host again for the rest of that machine's uptime
//! (issue #2062). [`leave_a_stop_note`] is what closes that: a note beside the
//! run file, which the sidecar reads on its own interval once its coilbox has
//! closed.
//!
//! It asks rather than orders, and coilbox never ends the process itself. Two
//! separate reasons, either of which is enough. The sidecar may be carrying a
//! game other people are playing and coilbox has no way of telling from out
//! here, so the one process that can tell is the one that decides. And a
//! process id is unique only while its process lives, so a run file naming a
//! number the OS has since handed to something unrelated would have coilbox
//! ending whatever that turned out to be.
//!
//! [`note_was_taken`] is the answer. The sidecar removes a note addressed to
//! it, which is the only proof of life a process with no pipe can give.
//!
//! ## Telling a recycled process number from a live sidecar
//!
//! A note that nothing takes is close to proof and is not proof, because the
//! sidecar only reads notes once its own coilbox has closed. So a leftover
//! record naming a number the OS had handed on to something else was a dead end
//! that only a restart cleared (issue #2078).
//!
//! The lock is the proof. The sidecar keeps a shared lock on its run file
//! for the whole time it runs, and the kernel gives that lock up when the
//! process ends, however it ends. [`already_relaying`] tries to take it: if it
//! can, the sidecar that wrote the record is dead and the record is a leftover,
//! and the next battle starts a sidecar that clears it on the way in.

use std::io;
use std::path::{Path, PathBuf};
use std::time::Duration;

use coilbox_relay_protocol::{stop_note_path, RunFile, StopNote, NOTE_LOOKED_FOR_EVERY};
use tauri::{AppHandle, Runtime};

/// The environment variable the sidecar reads the TURN password from.
///
/// Not an argument, and this is the reason rather than a preference: `ps`
/// shows one process's arguments to every other process on the machine, and a
/// relay credential is worth stealing. The sidecar refuses to take it any
/// other way (`coilbox-relay-agent`, `PASSWORD_VAR`).
pub const PASSWORD_VAR: &str = "COILBOX_TURN_PASSWORD";

/// The TURN server a relayed battle goes through.
#[derive(Clone, Debug)]
pub struct Turn {
    /// `host:port`.
    pub server: String,
    pub user: String,
    pub password: String,
}

/// The battle a sidecar is being started for.
#[derive(Clone, Debug)]
pub struct Battle {
    /// The engine's host port on this machine.
    pub engine_port: u16,
    /// The seat count, which caps how many loopback sockets the sidecar binds.
    pub max_peers: usize,
    /// The relay to allocate on. Without one the sidecar runs over a plain UDP
    /// socket, which works for a host that can already be reached and is what
    /// the tests use.
    pub turn: Option<Turn>,
}

/// Resolve the sidecar path, the same way every other sidecar in this repo is
/// resolved.
///
/// `RELAY_AGENT_SIDECAR` overrides everything, which is what `tauri dev` and
/// the tests use. Otherwise `coilbox-relay-agent` in the `.coilbox` folder
/// next to the executable, where the Windows installer tucks sidecars to keep
/// the install root clean, then next to the executable itself as `externalBin`
/// arranges.
pub fn resolve_sidecar() -> Option<PathBuf> {
    if let Ok(p) = std::env::var("RELAY_AGENT_SIDECAR") {
        if !p.is_empty() {
            return Some(PathBuf::from(p));
        }
    }
    let exe = std::env::current_exe().ok()?;
    let dir = exe.parent()?;
    let name = format!("coilbox-relay-agent{}", std::env::consts::EXE_SUFFIX);
    let tucked = dir.join(".coilbox").join(&name);
    if tucked.exists() {
        return Some(tucked);
    }
    let candidate = dir.join(&name);
    candidate.exists().then_some(candidate)
}

/// Where a running sidecar records itself, so it can be found after coilbox
/// has been closed and opened again.
///
/// Beside the start script the play plugin writes, and through
/// `coilbox_portable` for the same reason everything else goes through it:
/// portable mode puts the data root next to the executable, and a path that
/// skipped it would be written in one place and looked for in another.
pub fn run_file_path<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    Ok(coilbox_portable::data_dir(app)?
        .join("relay")
        .join("agent.json"))
}

/// Where the sidecar's stderr goes.
///
/// A file rather than a pipe, and that is not a style choice. The sidecar
/// carries on after coilbox has closed, a pipe coilbox held would be closed
/// at that moment, and `eprintln!` panics when the write fails. Piping it
/// would kill the sidecar at exactly the point it exists to keep running. A
/// file also means the log survives the close, which is when somebody
/// debugging a relayed battle most wants it.
pub fn log_path(run_file: &Path) -> PathBuf {
    run_file.with_file_name("agent.log")
}

/// The pid of the sidecar already relaying a battle, if one is.
///
/// `None` covers every way of not finding one: no file, an unreadable file, one
/// naming a process that has gone, and one naming a process that is running and
/// is not the sidecar that wrote it. They all mean the same thing to the
/// caller, which is that starting a sidecar is the right move.
///
/// ## The last of those, and why it is not a guess
///
/// A pid is unique only while its process lives. Once the sidecar has gone the
/// OS may hand its number to anything, and a run file naming a number that now
/// belongs to somebody's browser refused every relayed battle for the rest of
/// that machine's uptime (issue #2078).
///
/// The lock settles it. The sidecar holds a shared lock on the run file for
/// as long as it runs and the kernel releases it the moment that process ends,
/// so a free lock means the writer is dead. That is the one thing a live
/// sidecar always does and a recycled process never would, and it is why
/// clearing on it cannot clear a record belonging to a sidecar carrying a game.
///
/// Only for a record that says its writer took a lock. One from a build before
/// the lock has a free lock either way, so it is left to its pid and needs the
/// note in [`leave_a_stop_note`], or a restart.
pub fn already_relaying(run_file: &Path) -> Option<u32> {
    let text = std::fs::read_to_string(run_file).ok()?;
    let record = RunFile::from_json(&text).ok()?;
    if !coilbox_proc::is_running(record.pid) {
        return None;
    }
    (!record.locked || coilbox_relay_protocol::run_file_is_still_held(run_file))
        .then_some(record.pid)
}

/// How long to give a note before deciding nothing is reading them.
///
/// Two of the sidecar's own intervals plus two more. It looks for a note every
/// [`NOTE_LOOKED_FOR_EVERY`] and then acts on it in its next stopping check,
/// which runs on the same interval (`LOOK_EVERY` in `coilbox-relay-agent`), so
/// two is the honest floor and anything under it would report a sidecar that was
/// about to stop as one that would not. The two on top are for a machine that is
/// busy running a game, which is the machine this always runs on.
///
/// Spent in full only when a host is about to be told the sidecar kept going,
/// which is the one case where waiting beats guessing.
pub const NOTE_PATIENCE: Duration = NOTE_LOOKED_FOR_EVERY.saturating_mul(4);

/// Leave a note asking the sidecar running as `pid` to stop.
///
/// The only thing coilbox can say to a sidecar it did not spawn, and
/// [`coilbox_relay_protocol::StopNote`] carries why. It is a request: the
/// sidecar answers it with its own stopping rule and keeps running if a game is
/// still being played through it.
///
/// Written whole rather than appended to, so a note left by an earlier attempt
/// is replaced rather than added to. `pid` comes from [`already_relaying`] at
/// the moment of asking, so the note names the sidecar that is actually there.
pub fn leave_a_stop_note(run_file: &Path, pid: u32) -> io::Result<()> {
    let note = stop_note_path(run_file);
    if let Some(parent) = note.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(note, StopNote { pid }.to_json())
}

/// Whether the note coilbox left has been taken.
///
/// The sidecar removes a note addressed to it, so this is the only proof of
/// life available for a process coilbox has no pipe to, and it is what tells
/// the two failures apart. A note that was taken means a sidecar read it and
/// decided, which for one that is still running means it is carrying a game. A
/// note nothing ever touched means nothing is there to read it, so the run file
/// names a process id the OS has since given to something else.
pub fn note_was_taken(run_file: &Path) -> bool {
    !stop_note_path(run_file).exists()
}

/// The sidecar's argument vector. The password is deliberately not in it.
pub fn build_args(battle: &Battle, run_file: &Path) -> Vec<String> {
    let mut args = vec![
        "--engine-port".to_string(),
        battle.engine_port.to_string(),
        "--max-peers".to_string(),
        battle.max_peers.to_string(),
        "--run-file".to_string(),
        run_file.to_string_lossy().into_owned(),
    ];
    if let Some(turn) = &battle.turn {
        args.push("--turn-server".to_string());
        args.push(turn.server.clone());
        args.push("--turn-user".to_string());
        args.push(turn.user.clone());
    }
    args
}

#[cfg(test)]
mod tests {
    use super::*;

    fn a_battle() -> Battle {
        Battle {
            engine_port: 8452,
            max_peers: 8,
            turn: Some(Turn {
                server: "relay.example:3478".to_string(),
                user: "battle-host".to_string(),
                password: "a-short-lived-secret".to_string(),
            }),
        }
    }

    #[test]
    fn the_arguments_are_the_ones_the_sidecar_parses() {
        let args = build_args(&a_battle(), Path::new("/data/relay/agent.json"));
        assert_eq!(
            args,
            vec![
                "--engine-port",
                "8452",
                "--max-peers",
                "8",
                "--run-file",
                "/data/relay/agent.json",
                "--turn-server",
                "relay.example:3478",
                "--turn-user",
                "battle-host",
            ]
        );
    }

    /// The one assertion here that is about somebody else's machine: every
    /// process on this one can read another's command line, so a credential in
    /// it is a credential given away. The sidecar refuses to take it that way
    /// and this is the other end of the same rule.
    #[test]
    fn the_turn_password_never_reaches_the_command_line() {
        let battle = a_battle();
        let password = battle
            .turn
            .as_ref()
            .expect("this battle has a relay")
            .password
            .clone();

        assert!(
            !build_args(&battle, Path::new("/data/relay/agent.json"))
                .iter()
                .any(|arg| arg.contains(&password)),
            "the password has to travel in the environment, not in argv"
        );
    }

    /// Without a relay the sidecar runs over a plain UDP socket, so naming a
    /// server it has not got would be an argument it refuses to start with.
    #[test]
    fn a_battle_with_no_relay_names_no_server() {
        let battle = Battle {
            turn: None,
            ..a_battle()
        };
        let args = build_args(&battle, Path::new("/data/relay/agent.json"));
        assert!(!args.iter().any(|arg| arg == "--turn-server"));
        assert!(!args.iter().any(|arg| arg == "--turn-user"));
    }

    /// The log sits beside the run file rather than anywhere else, so one
    /// directory holds everything a relayed battle leaves behind.
    #[test]
    fn the_log_sits_beside_the_run_file() {
        assert_eq!(
            log_path(Path::new("/data/relay/agent.json")),
            Path::new("/data/relay/agent.log")
        );
    }

    /// A process that is running and has never heard of a run file, for
    /// standing in for whatever the OS gave a dead sidecar's number to. The
    /// caller kills it.
    fn a_process_that_is_not_the_sidecar() -> std::process::Child {
        let (program, args): (&str, &[&str]) = if cfg!(windows) {
            ("cmd", &["/C", "timeout", "/T", "60"])
        } else {
            ("sh", &["-c", "sleep 60"])
        };
        std::process::Command::new(program)
            .args(args)
            .spawn()
            .expect("a shell to run")
    }

    /// The findability check, in the two states that matter: a live agent is
    /// found, and one that has gone is not.
    ///
    /// The lock stands in for the sidecar, because that is what a running
    /// sidecar is from out here: something holding the file open.
    #[test]
    fn a_run_file_naming_a_live_process_is_a_relay_that_is_already_running() {
        let dir = tempfile::tempdir().expect("a temp dir");
        let run_file = dir.path().join("agent.json");
        std::fs::write(
            &run_file,
            RunFile {
                pid: std::process::id(),
                locked: true,
            }
            .to_json(),
        )
        .expect("a writable temp dir");
        let held = std::fs::OpenOptions::new()
            .read(true)
            .write(true)
            .open(&run_file)
            .expect("the file is there");
        held.try_lock_shared().expect("nothing else has it");

        assert_eq!(already_relaying(&run_file), Some(std::process::id()));
    }

    /// The bug in issue #2078. The sidecar has gone and the OS has given its
    /// number to something else, so the pid reads as running and nothing holds
    /// the file. Reporting a relay here is what left a host unable to open a
    /// relayed battle until they restarted the machine.
    #[test]
    fn a_run_file_naming_a_process_that_is_not_the_sidecar_is_not_a_relay() {
        let dir = tempfile::tempdir().expect("a temp dir");
        let run_file = dir.path().join("agent.json");
        let mut stranger = a_process_that_is_not_the_sidecar();
        std::fs::write(
            &run_file,
            RunFile {
                pid: stranger.id(),
                locked: true,
            }
            .to_json(),
        )
        .expect("a writable temp dir");

        let found = already_relaying(&run_file);
        let _ = stranger.kill();
        let _ = stranger.wait();

        assert_eq!(found, None);
    }

    /// The same record from a build that took no lock. Its lock is free whether
    /// the sidecar is alive or dead, so the pid is all there is to go on and it
    /// still counts. Without this, upgrading coilbox during a relayed game
    /// would start a second sidecar over the first.
    #[test]
    fn a_run_file_from_a_build_that_took_no_lock_is_still_a_relay() {
        let dir = tempfile::tempdir().expect("a temp dir");
        let run_file = dir.path().join("agent.json");
        let mut older = a_process_that_is_not_the_sidecar();
        let pid = older.id();
        std::fs::write(&run_file, format!("{{\"pid\":{pid}}}")).expect("a writable temp dir");

        let found = already_relaying(&run_file);
        let _ = older.kill();
        let _ = older.wait();

        assert_eq!(found, Some(pid));
    }

    #[test]
    fn nothing_is_relaying_when_there_is_no_run_file() {
        let dir = tempfile::tempdir().expect("a temp dir");
        assert_eq!(already_relaying(&dir.path().join("agent.json")), None);
    }

    /// The note names the sidecar it is for, in the shape that sidecar reads.
    /// A note naming the wrong process is one it leaves alone, which reads to a
    /// host as a relay that will not stop.
    #[test]
    fn a_note_names_the_sidecar_it_is_for() {
        let dir = tempfile::tempdir().expect("a temp dir");
        let run_file = dir.path().join("relay").join("agent.json");

        leave_a_stop_note(&run_file, 4021).expect("a writable temp dir");

        assert_eq!(
            std::fs::read_to_string(dir.path().join("relay").join("stop.json"))
                .expect("the note was written"),
            "{\"pid\":4021}"
        );
    }

    /// The proof of life, in both directions. Without it coilbox cannot tell a
    /// sidecar that read the note and kept going, because it is carrying a
    /// game, from a run file naming a process id that belongs to something else
    /// entirely, and those two need opposite things said about them.
    #[test]
    fn a_note_nothing_has_taken_is_how_coilbox_knows_nothing_is_reading_them() {
        let dir = tempfile::tempdir().expect("a temp dir");
        let run_file = dir.path().join("relay").join("agent.json");
        assert!(
            note_was_taken(&run_file),
            "there is no note yet, so nothing is outstanding"
        );

        leave_a_stop_note(&run_file, 4021).expect("a writable temp dir");
        assert!(!note_was_taken(&run_file));

        // The sidecar taking it, which it does by removing the file.
        std::fs::remove_file(stop_note_path(&run_file)).expect("the note is there");
        assert!(note_was_taken(&run_file));
    }

    /// A second ask replaces the first rather than leaving a note for a sidecar
    /// that has since been replaced.
    #[test]
    fn asking_again_leaves_one_note_for_the_sidecar_that_is_there_now() {
        let dir = tempfile::tempdir().expect("a temp dir");
        let run_file = dir.path().join("relay").join("agent.json");

        leave_a_stop_note(&run_file, 4021).expect("a writable temp dir");
        leave_a_stop_note(&run_file, 4022).expect("a writable temp dir");

        assert_eq!(
            std::fs::read_to_string(stop_note_path(&run_file)).expect("the note was written"),
            "{\"pid\":4022}"
        );
    }

    /// A file left behind by a sidecar that was killed. Treating it as a
    /// running relay would mean no relayed battle ever starts again until
    /// somebody deletes the file by hand.
    #[test]
    fn a_run_file_left_by_a_sidecar_that_died_is_not_a_relay() {
        let dir = tempfile::tempdir().expect("a temp dir");
        let run_file = dir.path().join("agent.json");

        let (program, args): (&str, &[&str]) = if cfg!(windows) {
            ("cmd", &["/C", "exit"])
        } else {
            ("sh", &["-c", "exit"])
        };
        let mut child = std::process::Command::new(program)
            .args(args)
            .spawn()
            .expect("a shell to run");
        let gone = child.id();
        child.wait().expect("it exits at once");

        std::fs::write(
            &run_file,
            RunFile {
                pid: gone,
                locked: true,
            }
            .to_json(),
        )
        .expect("a writable temp dir");
        assert_eq!(already_relaying(&run_file), None);
    }
}
