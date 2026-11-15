//! Execute an engine binary to read its sync-version. This is the *fallback* /
//! explicit-verify path — normal listing derives identity from folder names and
//! never runs anything. Runs are bounded by a hard timeout that kills the child,
//! since a manually-added folder could contain a hostile or hanging binary.

use std::io::Read;
use std::path::Path;
use std::process::Stdio;
use std::time::{Duration, Instant};

const VERSION_FLAGS: &[&str] = &["--sync-version", "--version"];

/// How many lines of each output stream a failure report keeps, from the end.
const REPORT_LINES: usize = 20;

/// Run `executable` to obtain its version string, trying `--sync-version` then
/// `--version`. Returns the first non-empty line (e.g. `104.0.1-1828-g1f481b7 BAR`).
///
/// When neither answers, the error says what was run for each flag, how it
/// ended, the end of what it printed, and the loader variables it was given, so
/// a player's report shows why the engine did not start.
pub fn read_version(executable: &Path, timeout: Duration) -> Result<String, String> {
    let mut report = vec!["The engine did not report a version.".to_string()];
    for flag in VERSION_FLAGS {
        report.push(String::new());
        report.push(format!(
            "Command: {}",
            coilbox_proc::shell_line(executable, &[flag])
        ));
        match run_one(executable, flag, timeout) {
            Ok(run) => {
                let version = first_nonempty_line(&run.stdout);
                if !version.is_empty() {
                    return Ok(version);
                }
                report.push(format!("Result: {}", run.ended));
                push_tail(&mut report, "Stdout", &run.stdout);
                push_tail(&mut report, "Stderr", &run.stderr);
            }
            Err(e) => report.push(format!("Result: {e}")),
        }
    }
    report.push(String::new());
    report.extend(coilbox_proc::describe_host_env());
    Err(report.join("\n"))
}

/// What one run printed and how it ended.
struct Run {
    /// How it ended, in words.
    ended: String,
    stdout: String,
    stderr: String,
}

fn run_one(executable: &Path, flag: &str, timeout: Duration) -> Result<Run, String> {
    let mut cmd = coilbox_proc::host_command(executable);
    cmd.arg(flag)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut child = cmd
        .spawn()
        .map_err(|e| format!("failed to launch engine: {e}"))?;

    // Drained while we wait: a crashing engine can print more than a pipe
    // holds, and it would block on the write and look like a hang.
    let drain = |pipe: Option<Box<dyn Read + Send>>| {
        std::thread::spawn(move || {
            let mut out = Vec::new();
            if let Some(mut p) = pipe {
                let _ = p.read_to_end(&mut out);
            }
            String::from_utf8_lossy(&out).into_owned()
        })
    };
    let stdout = drain(child.stdout.take().map(|p| Box::new(p) as _));
    let stderr = drain(child.stderr.take().map(|p| Box::new(p) as _));

    let start = Instant::now();
    let ended = loop {
        match child.try_wait() {
            Ok(Some(status)) => break coilbox_proc::describe_exit(&status),
            Ok(None) => {
                if start.elapsed() > timeout {
                    let _ = child.kill();
                    let _ = child.wait();
                    break format!("timed out after {} ms and was killed", timeout.as_millis());
                }
                std::thread::sleep(Duration::from_millis(50));
            }
            Err(e) => return Err(format!("error waiting for engine: {e}")),
        }
    };
    Ok(Run {
        ended,
        stdout: stdout.join().unwrap_or_default(),
        stderr: stderr.join().unwrap_or_default(),
    })
}

/// Add the last [`REPORT_LINES`] lines of `text` under `label`, or say it was
/// empty.
fn push_tail(report: &mut Vec<String>, label: &str, text: &str) {
    let lines: Vec<&str> = text.lines().filter(|l| !l.trim().is_empty()).collect();
    if lines.is_empty() {
        report.push(format!("{label}: (empty)"));
        return;
    }
    let skipped = lines.len().saturating_sub(REPORT_LINES);
    if skipped > 0 {
        report.push(format!(
            "{label} (last {REPORT_LINES} of {} lines):",
            lines.len()
        ));
    } else {
        report.push(format!("{label}:"));
    }
    report.extend(lines[skipped..].iter().map(|l| format!("  {l}")));
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
        let run = run_one(Path::new("/bin/sleep"), "2", Duration::from_millis(200)).unwrap();
        assert!(run.ended.contains("timed out"), "got: {}", run.ended);
    }

    #[cfg(unix)]
    #[test]
    fn an_engine_that_aborts_is_reported_with_its_command_signal_and_stderr() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        let bin = dir.path().join("spring");
        std::fs::write(
            &bin,
            "#!/bin/sh\necho 'symbol lookup error' >&2\nkill -ABRT $$\n",
        )
        .unwrap();
        std::fs::set_permissions(&bin, std::fs::Permissions::from_mode(0o755)).unwrap();

        let err = read_version(&bin, Duration::from_secs(5)).unwrap_err();
        let shown = bin.display();
        assert!(
            err.contains(&format!("Command: '{shown}' '--sync-version'")),
            "{err}"
        );
        assert!(
            err.contains(&format!("Command: '{shown}' '--version'")),
            "{err}"
        );
        assert!(
            err.contains("Result: killed by signal 6 (SIGABRT)"),
            "{err}"
        );
        assert!(err.contains("Stderr:\n  symbol lookup error"), "{err}");
        assert!(err.contains("Stdout: (empty)"), "{err}");
        assert!(err.contains("LD_LIBRARY_PATH="), "{err}");
    }
}
