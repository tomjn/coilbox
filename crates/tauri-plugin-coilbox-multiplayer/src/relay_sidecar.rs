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

use std::path::{Path, PathBuf};

use coilbox_relay_protocol::RunFile;
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
/// `None` covers every way of not finding one: no file, an unreadable file, or
/// one naming a process that has gone. They all mean the same thing to the
/// caller, which is that starting a sidecar is the right move.
pub fn already_relaying(run_file: &Path) -> Option<u32> {
    let text = std::fs::read_to_string(run_file).ok()?;
    let pid = RunFile::from_json(&text).ok()?.pid;
    coilbox_proc::is_running(pid).then_some(pid)
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

    /// The findability check, in the two states that matter: a live agent is
    /// found, and one that has gone is not.
    #[test]
    fn a_run_file_naming_a_live_process_is_a_relay_that_is_already_running() {
        let dir = tempfile::tempdir().expect("a temp dir");
        let run_file = dir.path().join("agent.json");
        std::fs::write(
            &run_file,
            RunFile {
                pid: std::process::id(),
            }
            .to_json(),
        )
        .expect("a writable temp dir");

        assert_eq!(already_relaying(&run_file), Some(std::process::id()));
    }

    #[test]
    fn nothing_is_relaying_when_there_is_no_run_file() {
        let dir = tempfile::tempdir().expect("a temp dir");
        assert_eq!(already_relaying(&dir.path().join("agent.json")), None);
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

        std::fs::write(&run_file, RunFile { pid: gone }.to_json()).expect("a writable temp dir");
        assert_eq!(already_relaying(&run_file), None);
    }
}
