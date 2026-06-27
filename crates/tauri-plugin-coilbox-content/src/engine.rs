//! Execute an engine binary to read its sync-version. This is the *fallback* /
//! explicit-verify path — normal listing derives identity from folder names and
//! never runs anything. Runs are bounded by a hard timeout that kills the child,
//! since a manually-added folder could contain a hostile or hanging binary.

use std::io::Read;
use std::path::Path;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

const VERSION_FLAGS: &[&str] = &["--sync-version", "--version"];

/// Run `executable` to obtain its version string, trying `--sync-version` then
/// `--version`. Returns the first non-empty line (e.g. `104.0.1-1828-g1f481b7 BAR`).
pub fn read_version(executable: &Path, timeout: Duration) -> Result<String, String> {
    let mut last_err = String::from("could not read engine version");
    for flag in VERSION_FLAGS {
        match run_one(executable, flag, timeout) {
            Ok(v) if !v.is_empty() => return Ok(v),
            Ok(_) => last_err = "engine produced no version output".into(),
            Err(e) => last_err = e,
        }
    }
    Err(last_err)
}

fn run_one(executable: &Path, flag: &str, timeout: Duration) -> Result<String, String> {
    let mut cmd = Command::new(executable);
    cmd.arg(flag).stdout(Stdio::piped()).stderr(Stdio::piped());
    // Don't pop a console window on Windows (CREATE_NO_WINDOW).
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000);
    }
    let mut child = cmd
        .spawn()
        .map_err(|e| format!("failed to launch engine: {e}"))?;

    let start = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) => {
                if start.elapsed() > timeout {
                    let _ = child.kill();
                    let _ = child.wait();
                    return Err("engine version check timed out".into());
                }
                std::thread::sleep(Duration::from_millis(50));
            }
            Err(e) => return Err(format!("error waiting for engine: {e}")),
        }
    }

    // Output is a single short line; reading after exit can't deadlock here.
    let mut out = String::new();
    if let Some(mut s) = child.stdout.take() {
        let _ = s.read_to_string(&mut out);
    }
    Ok(first_nonempty_line(&out))
}

fn first_nonempty_line(s: &str) -> String {
    s.lines()
        .map(str::trim)
        .find(|l| !l.is_empty())
        .unwrap_or("")
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_first_nonempty_line() {
        assert_eq!(first_nonempty_line("\n  104.0 BAR \nextra"), "104.0 BAR");
        assert_eq!(first_nonempty_line(""), "");
    }

    #[cfg(unix)]
    #[test]
    fn reads_version_from_echo() {
        // /bin/echo ignores the flag and prints it back; good enough to exercise
        // the spawn/collect path without a real engine.
        let v = read_version(Path::new("/bin/echo"), Duration::from_secs(5)).unwrap();
        assert_eq!(v, "--sync-version");
    }

    #[cfg(unix)]
    #[test]
    fn times_out_on_hang() {
        // Pass "2" as the flag so `/bin/sleep 2` actually blocks; the 200ms
        // timeout must kill it.
        let err = run_one(Path::new("/bin/sleep"), "2", Duration::from_millis(200)).unwrap_err();
        assert!(err.contains("timed out"), "got: {err}");
    }
}
