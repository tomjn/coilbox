//! Finding the Open Annihilation program and reading its version (issue #4943).
//!
//! Open Annihilation (OA) is a separate engine that coilbox launches but does
//! not install or update. All coilbox keeps about it is the path to its program
//! and the one line `--version` prints, so this is not the engine catalogue and
//! knows nothing of Spring folders.
//!
//! A path counts as OA when running it with `--version` exits 0 and prints a
//! first line starting with [`VERSION_PREFIX`]. Nothing about the file's name or
//! place is trusted, so a copy anywhere passes and a renamed Spring engine does
//! not.

use coilbox_ui_error::UiError;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::{Duration, Instant};

/// What the first line of `--version` starts with, for example
/// `Open Annihilation 0.8.9 (macos-universal arm64, 9eb18ad4)`.
const VERSION_PREFIX: &str = "Open Annihilation ";

/// How long `--version` may take before the program counts as not running.
///
/// It answered in under 0.01 s on OA 0.8.9 on macOS (measured with `time`, five
/// runs). Ten seconds is a chosen margin for a cold disk or an antivirus scan on
/// another machine, not a measurement.
const VERSION_WAIT: Duration = Duration::from_secs(10);

/// The most of the program's output that is read. OA prints one line, so a
/// program that prints more than this is not it.
const OUTPUT_LIMIT: u64 = 4096;

const NOT_A_FILE: &str = "play.oa.not_a_file";
const DID_NOT_RUN: &str = "play.oa.did_not_run";
const TIMED_OUT: &str = "play.oa.timed_out";
const EXITED_BADLY: &str = "play.oa.exited_badly";
const NOT_OA: &str = "play.oa.not_oa";

/// Where OA's installer puts the program, in the order to try them. The macOS
/// path is the binary inside the app, never the `.app` bundle, because coilbox
/// reads its standard output. Linux has no fixed place: OA ships as a zip the
/// player unpacks anywhere.
pub fn default_paths() -> Vec<PathBuf> {
    if cfg!(target_os = "macos") {
        vec![PathBuf::from(
            "/Applications/Open Annihilation.app/Contents/MacOS/open-annihilation",
        )]
    } else if cfg!(windows) {
        vec![
            PathBuf::from(r"C:\Program Files\Open Annihilation\open-annihilation.exe"),
            PathBuf::from(r"C:\Program Files (x86)\Open Annihilation\open-annihilation.exe"),
        ]
    } else {
        Vec::new()
    }
}

/// The first of `candidates` that is OA, with its version line.
pub fn find_in(candidates: &[PathBuf]) -> Option<(PathBuf, String)> {
    candidates.iter().find_map(|path| {
        path.is_file()
            .then(|| check(path, VERSION_WAIT).ok())
            .flatten()
            .map(|version| (path.clone(), version))
    })
}

/// Run `path` with `--version` and answer the line it prints, or why `path` is
/// not a working Open Annihilation.
///
/// Anything else a program prints, or writes to stderr, is dropped. The wait is
/// a parameter so a test does not spend ten seconds on a program that hangs.
pub fn check(path: &Path, wait: Duration) -> Result<String, String> {
    let shown = path.display().to_string();
    if !path.is_file() {
        return Err(UiError::new(
            NOT_A_FILE,
            format!("{shown} is not a program. Choose the open-annihilation file itself."),
        )
        .param("path", &shown)
        .into());
    }
    let mut child = coilbox_proc::command(path)
        .arg("--version")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| {
            String::from(
                UiError::new(DID_NOT_RUN, format!("{shown} would not run: {e}"))
                    .param("path", &shown)
                    .param("reason", e),
            )
        })?;
    // Read on another thread so a program that prints more than a pipe holds
    // cannot stall before the wait below has a chance to end it.
    let stdout = child.stdout.take().expect("stdout was piped");
    let (sent, received) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let mut text = Vec::new();
        let _ = stdout.take(OUTPUT_LIMIT).read_to_end(&mut text);
        let _ = sent.send(text);
    });

    let deadline = Instant::now() + wait;
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) if Instant::now() < deadline => {
                std::thread::sleep(Duration::from_millis(10));
            }
            Ok(None) => {
                let _ = child.kill();
                let _ = child.wait();
                let seconds = wait.as_secs();
                return Err(UiError::new(
                    TIMED_OUT,
                    format!("{shown} did not answer within {seconds} seconds."),
                )
                .param("path", &shown)
                .param("seconds", seconds)
                .into());
            }
            Err(e) => {
                return Err(
                    UiError::new(DID_NOT_RUN, format!("{shown} would not run: {e}"))
                        .param("path", &shown)
                        .param("reason", e)
                        .into(),
                );
            }
        }
    };
    // A program that left a child holding its output open would keep the
    // reader waiting, so the wait on it is bounded too.
    let output = received.recv_timeout(wait).unwrap_or_default();
    let first_line = String::from_utf8_lossy(&output)
        .lines()
        .next()
        .unwrap_or("")
        .trim()
        .to_string();

    if !status.success() {
        return Err(UiError::new(
            EXITED_BADLY,
            format!("{shown} ran but failed when asked for its version."),
        )
        .param("path", &shown)
        .into());
    }
    if first_line.starts_with(VERSION_PREFIX) {
        Ok(first_line)
    } else {
        Err(UiError::new(
            NOT_OA,
            format!("{shown} is not Open Annihilation. Choose the open-annihilation file."),
        )
        .param("path", &shown)
        .into())
    }
}

/// [`check`] with the wait the player's settings page uses, and the one the
/// launcher (issue #4944) should use to confirm the stored path before it spawns.
pub fn check_with_default_wait(path: &Path) -> Result<String, String> {
    check(path, VERSION_WAIT)
}

/// How long `--list-content --json` may take. It finished within the same
/// whole second on OA 0.8.10 on macOS (three runs timed with `date`), so this
/// is the same chosen margin as [`VERSION_WAIT`], not a measurement.
const LIST_WAIT: Duration = Duration::from_secs(10);

/// One installed map, as `--list-content --json` names it. `shown_name` is what
/// OA's own menus show and what the lobby's map field carries. `key` is the
/// name `--map` takes, which differs from it for a few maps.
#[derive(Debug, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OaMap {
    pub shown_name: String,
    pub key: String,
}

/// The installed maps `--list-content --json` prints on standard output, in the
/// order OA gives them. Its log goes to standard error, which is dropped.
pub fn list_maps(path: &Path, wait: Duration) -> Result<Vec<OaMap>, String> {
    let shown = path.display().to_string();
    let mut child = coilbox_proc::command(path)
        .args(["--list-content", "--json"])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("{shown} would not run: {e}"))?;
    let mut stdout = child.stdout.take().expect("stdout was piped");
    let (sent, received) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let mut text = Vec::new();
        let _ = stdout.read_to_end(&mut text);
        let _ = sent.send(text);
    });

    let deadline = Instant::now() + wait;
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) if Instant::now() < deadline => {
                std::thread::sleep(Duration::from_millis(10));
            }
            Ok(None) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(format!(
                    "{shown} did not list its maps within {} seconds.",
                    wait.as_secs()
                ));
            }
            Err(e) => return Err(format!("{shown} would not run: {e}")),
        }
    };
    if !status.success() {
        return Err(format!("{shown} failed when asked for its maps."));
    }
    let output = received.recv_timeout(wait).unwrap_or_default();
    parse_maps(&String::from_utf8_lossy(&output))
}

/// The `maps` array of the JSON object on the last line of `text`.
fn parse_maps(text: &str) -> Result<Vec<OaMap>, String> {
    let line = text
        .lines()
        .rev()
        .find(|l| !l.trim().is_empty())
        .ok_or("Open Annihilation listed nothing.")?;
    let parsed: serde_json::Value = serde_json::from_str(line)
        .map_err(|e| format!("Open Annihilation's map list was not JSON: {e}"))?;
    let maps = parsed
        .get("maps")
        .and_then(serde_json::Value::as_array)
        .ok_or("Open Annihilation's list has no maps.")?;
    Ok(maps
        .iter()
        .filter_map(|m| {
            let key = m.get("key")?.as_str()?;
            let shown_name = m.get("shown-name").and_then(|s| s.as_str()).unwrap_or(key);
            Some(OaMap {
                shown_name: shown_name.to_string(),
                key: key.to_string(),
            })
        })
        .collect())
}

/// [`list_maps`] with the wait the host form uses.
pub fn list_maps_with_default_wait(path: &Path) -> Result<Vec<OaMap>, String> {
    list_maps(path, LIST_WAIT)
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;

    const A_FEW_SECONDS: Duration = Duration::from_secs(5);

    /// A folder for one test's stand-in programs, removed on drop.
    struct Dir(PathBuf);

    impl Dir {
        fn new(name: &str) -> Self {
            let dir =
                std::env::temp_dir().join(format!("coilbox-oa-{name}-{}", std::process::id()));
            let _ = std::fs::remove_dir_all(&dir);
            std::fs::create_dir_all(&dir).unwrap();
            Dir(dir)
        }

        /// A shell script standing in for a program, with its execute bit.
        fn program(&self, name: &str, body: &str) -> PathBuf {
            let path = self.0.join(name);
            std::fs::write(&path, format!("#!/bin/sh\n{body}\n")).unwrap();
            std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
            path
        }
    }

    impl Drop for Dir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    fn code_of(error: &str) -> String {
        UiError::parse(error)
            .expect("a UiError, not plain text")
            .code
            .into_owned()
    }

    #[test]
    fn a_program_that_prints_the_version_line_is_oa() {
        let dir = Dir::new("good");
        let oa = dir.program(
            "anywhere-at-all",
            r#"echo "Open Annihilation 0.8.0 (macos-universal arm64, 2ac0217b)""#,
        );
        assert_eq!(
            check(&oa, A_FEW_SECONDS).unwrap(),
            "Open Annihilation 0.8.0 (macos-universal arm64, 2ac0217b)"
        );
    }

    #[test]
    fn the_maps_come_from_the_json_on_standard_output() {
        let dir = Dir::new("maps");
        let oa = dir.program(
            "oa",
            r#"echo 'open-annihilation: timing: noise' >&2
echo '{"maps":[{"shown-name":"Shew Drop","key":"Comet Catcher","players":4},{"key":"Plain"}],"mods":[]}'"#,
        );
        assert_eq!(
            list_maps(&oa, A_FEW_SECONDS).unwrap(),
            vec![
                OaMap {
                    shown_name: "Shew Drop".into(),
                    key: "Comet Catcher".into()
                },
                OaMap {
                    shown_name: "Plain".into(),
                    key: "Plain".into()
                },
            ]
        );
    }

    #[test]
    fn a_map_list_that_is_not_json_or_fails_is_an_error() {
        let dir = Dir::new("badmaps");
        let not_json = dir.program("a", "echo 'hello'");
        assert!(list_maps(&not_json, A_FEW_SECONDS).is_err());
        let failing = dir.program("b", "echo '{\"maps\":[]}'; exit 2");
        assert!(list_maps(&failing, A_FEW_SECONDS).is_err());
        let hanging = dir.program("c", "sleep 30");
        let error = list_maps(&hanging, Duration::from_millis(200)).unwrap_err();
        assert!(error.contains("did not list"), "{error}");
    }

    #[test]
    fn only_the_first_line_is_kept() {
        let dir = Dir::new("lines");
        let oa = dir.program("oa", "echo 'Open Annihilation 1.0 (x)'; echo 'and more'");
        assert_eq!(
            check(&oa, A_FEW_SECONDS).unwrap(),
            "Open Annihilation 1.0 (x)"
        );
    }

    #[test]
    fn a_program_that_prints_something_else_is_refused() {
        let dir = Dir::new("other");
        let other = dir.program("spring", "echo 'spring 105.0'");
        assert_eq!(code_of(&check(&other, A_FEW_SECONDS).unwrap_err()), NOT_OA);
    }

    #[test]
    fn a_program_that_prints_nothing_is_refused() {
        let dir = Dir::new("silent");
        let silent = dir.program("silent", "exit 0");
        assert_eq!(code_of(&check(&silent, A_FEW_SECONDS).unwrap_err()), NOT_OA);
    }

    #[test]
    fn a_failing_program_is_refused_even_when_it_prints_the_line() {
        let dir = Dir::new("failing");
        let bad = dir.program("oa", "echo 'Open Annihilation 1.0 (x)'; exit 3");
        assert_eq!(
            code_of(&check(&bad, A_FEW_SECONDS).unwrap_err()),
            EXITED_BADLY
        );
    }

    #[test]
    fn a_program_that_hangs_is_stopped_and_refused() {
        let dir = Dir::new("hang");
        let slow = dir.program("slow", "sleep 30");
        let started = Instant::now();
        let error = check(&slow, Duration::from_millis(200)).unwrap_err();
        assert_eq!(code_of(&error), TIMED_OUT);
        assert!(
            started.elapsed() < Duration::from_secs(10),
            "the wait ended the program rather than waiting for it"
        );
    }

    #[test]
    fn a_program_that_floods_its_output_does_not_stall_the_check() {
        let dir = Dir::new("flood");
        let flood = dir.program("flood", "yes 'Open Annihilation'");
        let started = Instant::now();
        // It starts with the right words and never stops, so it is refused
        // whichever of the limits ends it first.
        assert!(check(&flood, A_FEW_SECONDS).is_err());
        assert!(started.elapsed() < A_FEW_SECONDS);
    }

    #[test]
    fn a_missing_path_and_a_folder_are_not_programs() {
        let dir = Dir::new("missing");
        assert_eq!(
            code_of(&check(&dir.0.join("nothing"), A_FEW_SECONDS).unwrap_err()),
            NOT_A_FILE
        );
        assert_eq!(
            code_of(&check(&dir.0, A_FEW_SECONDS).unwrap_err()),
            NOT_A_FILE
        );
    }

    #[test]
    fn a_file_that_cannot_run_is_refused_not_a_panic() {
        let dir = Dir::new("plain");
        let text = dir.0.join("readme.txt");
        std::fs::write(&text, "not a program").unwrap();
        assert!(check(&text, A_FEW_SECONDS).is_err());
    }

    #[test]
    fn the_first_default_that_is_oa_wins_and_the_rest_are_skipped() {
        let dir = Dir::new("find");
        let not_oa = dir.program("a", "echo 'spring'");
        let oa = dir.program("b", "echo 'Open Annihilation 2.0 (y)'");
        let missing = dir.0.join("nothing");
        let found = find_in(&[missing, not_oa, oa.clone()]).expect("the third is OA");
        assert_eq!(found, (oa, "Open Annihilation 2.0 (y)".to_string()));
        assert_eq!(find_in(&[dir.0.join("nothing")]), None);
    }
}
