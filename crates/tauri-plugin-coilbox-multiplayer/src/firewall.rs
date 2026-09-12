//! Answering Windows Firewall before a game depends on the answer
//! (issue #2799).
//!
//! The first time a program opens a port for incoming connections, Windows
//! Defender Firewall asks the person whether to allow it. Hosting from coilbox
//! can set that off for three different programs, and the last of them is the
//! engine, which asks while the game is starting. That is the worst possible
//! moment: the host is looking at a loading screen, the prompt is behind it, and
//! a host who dismisses it or never sees it gets a battle nobody can join, with
//! nothing on the machine able to say why. `hostingRoute.ts` already names "a
//! firewall prompt nobody answered" as one of the things it cannot see.
//!
//! So coilbox asks first, from the hosting drawer, where nothing is waiting.
//!
//! ## Rules rather than a rehearsal
//!
//! The other way to do this is to open a listening socket from each program at
//! a calm moment so that Windows asks then. It needs no administrator rights,
//! which is a real advantage, and it is what a person would do by hand. It also
//! does not work for the engine, which has no mode that opens a port without
//! starting a game, and it depends on Windows choosing to prompt, which is not
//! something coilbox can check afterwards.
//!
//! Adding the rules says what is wanted instead of arranging for a question to
//! be asked. One elevated prompt covers all three programs, and the rules can be
//! read back, so the drawer can say whether the programs are already allowed
//! rather than only offering to try. The price is that it needs administrator
//! rights, and a host who says no to the elevation prompt is left where they
//! started, which is what they would have been anyway.
//!
//! ## Only three programs, and only the engine that is about to run
//!
//! coilbox itself, because a room hosted on the local network listens on TCP.
//! The relay agent, because it opens a UDP socket. And the engine, because it
//! opens the game port. Windows remembers per program file and every engine
//! version lives in its own folder, so a new engine is a new program that asks
//! again. Rather than allow every engine on the disk, this covers the one the
//! hosting form is about to launch, and the drawer asks again when the host
//! switches engine.
//!
//! ## Reading can be refused too
//!
//! The read was meant to be the cheap unprivileged half, and on some machines it
//! is not: `Get-NetFirewallRule` answers "Access is denied" to an unelevated
//! coilbox, with Windows Defender Firewall running normally and the same command
//! working fine from an administrator window. So a host who cannot be told what
//! the rules say is exactly a host for whom adding them still works, and the
//! panel has to keep offering that rather than read as broken.
//!
//! ## What it cannot promise
//!
//! Reading the rules back matches on the program path Windows stored, so a rule
//! whose path is written differently from ours reads as no rule at all. The
//! worst that does is offer to add a rule that duplicates one already there,
//! which Windows accepts and which changes nothing.
//!
//! Nothing here runs anywhere but Windows. [`supported`] is the gate, and the
//! frontend hides the whole panel on the strength of it rather than sniffing
//! the platform for itself.

use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::{AppHandle, Runtime};

use crate::relay_sidecar;

/// The rule group every rule coilbox adds belongs to, so somebody looking
/// through Windows Defender Firewall can see at a glance which rules are ours.
const GROUP: &str = "Coilbox";

/// Windows says "the operation was cancelled by the user" with this, which is
/// what a host who answers no to the elevation prompt produces. Worth telling
/// apart from a failure, because it is a choice rather than a fault.
const CANCELLED: i32 = 1223;

/// One program Windows Firewall has to be told about, and what it says now.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Program {
    /// What the rule is called, in Windows Defender Firewall and on screen.
    pub name: String,
    /// The program file. Windows remembers an answer per file, so this is the
    /// identity of the thing being allowed.
    pub path: String,
    /// Whether an inbound allow rule for it is there. `None` is coilbox not
    /// having been able to look, which is a different answer from no and has to
    /// stay different: telling a host they are blocked when nothing was read
    /// would send them to an elevation prompt for no reason.
    pub allowed: Option<bool>,
}

/// Why coilbox could not read or change the rules, for a host who would
/// otherwise be looking at a panel that quietly did nothing.
///
/// Split into a line to read and a pile to unfold, because PowerShell's half of
/// this is an error record: six lines of file, offending source and category,
/// only the first of which says anything. Sending the whole thing to the panel
/// put a wall of red in the hosting drawer.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Problem {
    /// The one line, in coilbox's words rather than PowerShell's.
    pub title: String,
    /// What Windows said, for whoever is writing a bug report. Folded away.
    pub details: Vec<String>,
    /// Whether something went wrong, as against a machine that will not answer
    /// or a host who said no. Only a fault is worth drawing in red: a refused
    /// administrator prompt is a decision, and a firewall coilbox may not read
    /// is a fact about the machine that the button below still fixes.
    pub fault: bool,
}

impl Problem {
    /// A problem with nothing to unfold: the line is the whole of it.
    fn plain(title: impl Into<String>) -> Problem {
        Problem {
            title: title.into(),
            details: Vec::new(),
            fault: true,
        }
    }

    /// The same problem, not held against anybody. See [`Problem::fault`].
    fn not_a_fault(mut self) -> Problem {
        self.fault = false;
        self
    }
}

/// What the hosting drawer draws.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Firewall {
    /// False everywhere but Windows, and the whole panel is hidden on it.
    pub supported: bool,
    /// The programs, in the order they should be listed.
    pub programs: Vec<Program>,
    /// Why the panel cannot say what it usually says, if it cannot.
    pub problem: Option<Problem>,
}

impl Firewall {
    /// The answer on every platform that has no Windows Firewall.
    fn unsupported() -> Firewall {
        Firewall {
            supported: false,
            programs: Vec::new(),
            problem: None,
        }
    }
}

/// Whether any of this applies to the machine coilbox is running on.
pub fn supported() -> bool {
    cfg!(target_os = "windows")
}

/// The programs and whether Windows Firewall lets each of them in.
pub fn state<R: Runtime>(app: &AppHandle<R>, engine: Option<&Path>) -> Firewall {
    if !supported() {
        return Firewall::unsupported();
    }
    let mut programs = programs(engine);
    let problem = match read_rules(app, &programs) {
        Ok(answers) => {
            for (program, allowed) in programs.iter_mut().zip(answers) {
                program.allowed = Some(allowed);
            }
            None
        }
        Err(e) => Some(e),
    };
    Firewall {
        supported: true,
        programs,
        problem,
    }
}

/// Add an inbound allow rule for each program, behind one elevation prompt,
/// and answer with what the rules say afterwards.
///
/// The state comes back read afresh rather than assumed from a command that
/// exited zero, because the point of the panel is to say what is true.
pub fn allow<R: Runtime>(app: &AppHandle<R>, engine: Option<&Path>) -> Firewall {
    if !supported() {
        return Firewall::unsupported();
    }
    let programs = programs(engine);
    if let Err(e) = add_rules(app, &programs) {
        return Firewall {
            supported: true,
            programs,
            problem: Some(e),
        };
    }
    state(app, engine)
}

/// The programs to allow, in the order the drawer lists them.
///
/// A program coilbox cannot find is left out rather than named with a path that
/// does not exist. In a `tauri dev` tree the relay agent sidecar is often not
/// built, and offering to add a firewall rule for a file that is not there would
/// be an elevation prompt in exchange for nothing.
fn programs(engine: Option<&Path>) -> Vec<Program> {
    let mut programs = Vec::new();
    if let Ok(exe) = std::env::current_exe() {
        programs.push(Program {
            name: "Coilbox".into(),
            path: exe.to_string_lossy().into_owned(),
            allowed: None,
        });
    }
    if let Some(agent) = relay_sidecar::resolve_sidecar() {
        programs.push(Program {
            name: "Coilbox relay".into(),
            path: agent.to_string_lossy().into_owned(),
            allowed: None,
        });
    }
    if let Some(engine) = engine.filter(|e| e.is_file()) {
        programs.push(Program {
            name: engine_rule_name(engine),
            path: engine.to_string_lossy().into_owned(),
            allowed: None,
        });
    }
    programs
}

/// What to call the rule for an engine binary.
///
/// Named after the folder the engine lives in, because that is the engine
/// version and because two engines must not share a rule name: adding one would
/// then replace the other's rule and quietly un-allow an engine the host still
/// plays with.
fn engine_rule_name(engine: &Path) -> String {
    let version = engine
        .parent()
        .and_then(|p| p.file_name())
        .map(|n| n.to_string_lossy().into_owned())
        .filter(|n| !n.is_empty());
    match version {
        Some(version) => format!("Coilbox engine ({version})"),
        None => "Coilbox engine".into(),
    }
}

/// Read whether each program has an inbound allow rule, in the same order.
///
/// A read that cannot happen is never a fault. On a machine that refuses an
/// unelevated `Get-NetFirewallRule` this is the only thing the panel will ever
/// say, and it has to read as "coilbox cannot tell you" rather than as an error.
fn read_rules<R: Runtime>(app: &AppHandle<R>, programs: &[Program]) -> Result<Vec<bool>, Problem> {
    if programs.is_empty() {
        return Ok(Vec::new());
    }
    let out = run_script(
        app,
        "check.ps1",
        &check_script(programs),
        "check the firewall rules",
    )
    .map_err(Problem::not_a_fault)?;
    read_answers(&out, programs.len())
}

/// Add a rule for each program, behind one elevation prompt.
fn add_rules<R: Runtime>(app: &AppHandle<R>, programs: &[Program]) -> Result<(), Problem> {
    if programs.is_empty() {
        return Ok(());
    }
    let script = script_path(app, "allow.ps1")?;
    write_script(&script, &allow_script(programs))?;
    run_script(
        app,
        "elevate.ps1",
        &elevate_script(&script),
        "add the firewall rules",
    )
    .map(|_| ())
}

/// PowerShell that prints `yes` or `no` for each program, one line each, in the
/// order they were given.
///
/// The rules are pulled in one pass and put in a set, rather than asked about
/// one program at a time, because each of these is a CIM call and a machine with
/// a few hundred firewall rules is ordinary.
///
/// Matching is case-insensitive, which is what Windows paths are. It is still a
/// string match, so a rule Windows wrote with the path spelled differently reads
/// as no rule. The module doc says what that costs.
///
/// The read is caught, and the catch writes the exception's own message and
/// nothing else. Left to `$ErrorActionPreference` a refused read prints a whole
/// error record, and every line of it reached the hosting drawer.
fn check_script(programs: &[Program]) -> String {
    let paths = programs
        .iter()
        .map(|p| quoted(&p.path))
        .collect::<Vec<_>>()
        .join(",");
    format!(
        "$ErrorActionPreference = 'Stop'\n\
         $allowed = New-Object 'System.Collections.Generic.HashSet[string]' \
         ([System.StringComparer]::OrdinalIgnoreCase)\n\
         try {{\n\
         \x20   Get-NetFirewallRule -Direction Inbound -Action Allow -Enabled True |\n\
         \x20       Get-NetFirewallApplicationFilter |\n\
         \x20       ForEach-Object {{ if ($_.Program) {{ [void]$allowed.Add($_.Program) }} }}\n\
         }} catch {{\n\
         \x20   [Console]::Error.WriteLine($_.Exception.Message)\n\
         \x20   exit 1\n\
         }}\n\
         foreach ($p in @({paths})) {{ if ($allowed.Contains($p)) {{ 'yes' }} else {{ 'no' }} }}\n"
    )
}

/// PowerShell that adds one inbound allow rule per program. Needs elevation.
///
/// Each rule is removed by name before it is added, so pressing the button twice
/// leaves one rule rather than two. By name and not by group, because the group
/// holds the rules for every engine the host has ever allowed and clearing it
/// would take away the ones for engines they still play with.
///
/// No protocol and no port. Windows defaults to any of both, which is what the
/// prompt it is standing in for would have created, and the engine's port is a
/// setting the host can change between battles anyway.
fn allow_script(programs: &[Program]) -> String {
    let mut script = String::from("$ErrorActionPreference = 'Stop'\n");
    for program in programs {
        let name = quoted(&program.name);
        let path = quoted(&program.path);
        let group = quoted(GROUP);
        script.push_str(&format!(
            "Remove-NetFirewallRule -DisplayName {name} -ErrorAction SilentlyContinue\n\
             New-NetFirewallRule -DisplayName {name} -Group {group} -Direction Inbound \
             -Action Allow -Profile Any -Program {path} | Out-Null\n"
        ));
    }
    script.push_str("exit 0\n");
    script
}

/// PowerShell that runs `script` again as an administrator and waits for it.
///
/// This is the elevation. `Start-Process -Verb RunAs` is what raises the one
/// UAC prompt, and the host saying no to it throws, which is caught and turned
/// into [`CANCELLED`] so that a refusal reads as a refusal rather than as
/// coilbox being broken.
fn elevate_script(script: &Path) -> String {
    let script = quoted(&script.to_string_lossy());
    format!(
        "try {{\n\
         \x20   $p = Start-Process -FilePath 'powershell.exe' -Verb RunAs -WindowStyle Hidden \
         -Wait -PassThru -ErrorAction Stop \
         -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File',{script}\n\
         \x20   if ($null -eq $p) {{ exit 1 }}\n\
         \x20   exit $p.ExitCode\n\
         }} catch {{\n\
         \x20   exit {CANCELLED}\n\
         }}\n"
    )
}

/// A string PowerShell will read as exactly `text`.
///
/// Single quotes, because PowerShell expands nothing inside them and a program
/// path is full of backslashes that a double-quoted string would take as
/// escapes. A single quote in the text is doubled, which is the only escape a
/// single-quoted PowerShell string has.
fn quoted(text: &str) -> String {
    format!("'{}'", text.replace('\'', "''"))
}

/// Turn the check script's output into one answer per program.
///
/// A run that printed a different number of lines is refused rather than
/// matched up as far as it goes, because the answers are positional: one line
/// missing would report every program after it as the one before.
fn read_answers(out: &str, wanted: usize) -> Result<Vec<bool>, Problem> {
    let answers: Vec<bool> = out
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .map(|line| line.eq_ignore_ascii_case("yes"))
        .collect();
    if answers.len() != wanted {
        return Err(Problem::plain(format!(
            "Windows answered about {} programs and coilbox asked about {wanted}",
            answers.len()
        )));
    }
    Ok(answers)
}

/// Where the scripts are written.
///
/// Beside everything else coilbox writes, through `coilbox_portable` for the
/// same reason the rest of it goes that way: portable mode puts the data root
/// next to the executable, and a path that skipped it would be written in one
/// place and run from another.
fn script_path<R: Runtime>(app: &AppHandle<R>, name: &str) -> Result<PathBuf, Problem> {
    let dir = coilbox_portable::data_dir(app)
        .map_err(|e| Problem::plain(format!("Coilbox has nowhere to write the script: {e}")))?;
    Ok(dir.join("firewall").join(name))
}

/// Write a script where PowerShell can run it.
///
/// A file rather than `-Command`, because `powershell.exe` re-parses its own
/// command line and a program path with a space in it has to survive both that
/// and the quoting Windows does on the way in. `-File` takes one path and reads
/// the rest from disk, which has neither problem.
fn write_script(path: &Path, script: &str) -> Result<(), Problem> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| Problem::plain(format!("Coilbox could not write the script: {e}")))?;
    }
    std::fs::write(path, script)
        .map_err(|e| Problem::plain(format!("Coilbox could not write the script: {e}")))
}

/// Write `script` and run it, answering with what it printed.
///
/// `what` is what the script was for, in the second half of "Windows would not
/// let coilbox ...", so a failure names the thing that did not happen.
fn run_script<R: Runtime>(
    app: &AppHandle<R>,
    name: &str,
    script: &str,
    what: &str,
) -> Result<String, Problem> {
    let path = script_path(app, name)?;
    write_script(&path, script)?;
    let out = coilbox_proc::command("powershell")
        .args(["-NoProfile", "-ExecutionPolicy", "Bypass", "-File"])
        .arg(&path)
        .output()
        .map_err(|e| Problem::plain(format!("Coilbox could not run PowerShell: {e}")))?;
    if !out.status.success() {
        return Err(why_it_failed(out.status.code(), &out.stderr, what));
    }
    Ok(String::from_utf8_lossy(&out.stdout).into_owned())
}

/// What to tell the host about a script that did not exit zero.
///
/// A refusal at the elevation prompt is the answer somebody chose, so it gets a
/// sentence saying nothing changed and nothing to unfold. Everything else says
/// what did not happen and keeps PowerShell's own words behind it, because a
/// firewall rule that did not get added has no other symptom until a game
/// nobody can join.
fn why_it_failed(code: Option<i32>, stderr: &[u8], what: &str) -> Problem {
    if code == Some(CANCELLED) {
        return Problem {
            title: "The Windows administrator prompt was refused, so nothing changed".into(),
            details: Vec::new(),
            fault: false,
        };
    }
    let mut details = tidy(stderr);
    if details.is_empty() {
        details.push(match code {
            Some(code) => format!("PowerShell exited with code {code} and said nothing."),
            None => "PowerShell stopped part way through.".into(),
        });
    }
    Problem {
        title: format!("Windows would not let coilbox {what}"),
        details,
        fault: true,
    }
}

/// What PowerShell said, with the error record's decoration taken off.
///
/// A terminating error prints the message and then five more lines: where in
/// the script it happened, the offending line, a row of tildes under it, and two
/// lines of category and error id. Only the first says anything to a person, and
/// the rest arrived in the hosting drawer as a wall of red.
///
/// Dropped by shape rather than by matching the text, because the message itself
/// is in the language Windows is installed in and the decoration is not.
fn tidy(stderr: &[u8]) -> Vec<String> {
    String::from_utf8_lossy(stderr)
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .filter(|line| !line.starts_with('+'))
        .filter(|line| !(line.starts_with("At ") && line.contains(" char:")))
        .map(str::to_owned)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn a_program(name: &str, path: &str) -> Program {
        Program {
            name: name.into(),
            path: path.into(),
            allowed: None,
        }
    }

    /// The escape that matters. A Windows account name may carry an apostrophe,
    /// which lands in the path of everything under that profile, and an
    /// unescaped one would end the PowerShell string early and turn the rest of
    /// a path into code.
    #[test]
    fn a_quote_in_a_path_is_escaped_rather_than_ending_the_string() {
        assert_eq!(
            quoted(r"C:\Users\Tom O'Neill\c.exe"),
            "'C:\\Users\\Tom O''Neill\\c.exe'"
        );
    }

    /// Backslashes are left exactly as they are, which is the reason the quoting
    /// is single and not double: a double-quoted PowerShell string would read
    /// `\c` as an escape and hand Windows a path that does not exist.
    #[test]
    fn backslashes_are_left_alone() {
        assert_eq!(
            quoted(r"C:\Program Files\coilbox\coilbox.exe"),
            "'C:\\Program Files\\coilbox\\coilbox.exe'"
        );
    }

    /// One rule per program, and each removed by its own name first so that
    /// pressing the button twice does not leave two of everything.
    #[test]
    fn the_allow_script_replaces_each_rule_by_name() {
        let script = allow_script(&[
            a_program("Coilbox", r"C:\c\coilbox.exe"),
            a_program("Coilbox relay", r"C:\c\relay.exe"),
        ]);

        assert_eq!(
            script.matches("New-NetFirewallRule").count(),
            2,
            "one rule per program, got: {script}"
        );
        assert!(script.contains("Remove-NetFirewallRule -DisplayName 'Coilbox' "));
        assert!(script.contains("Remove-NetFirewallRule -DisplayName 'Coilbox relay' "));
        assert!(
            !script.contains("Remove-NetFirewallRule -Group"),
            "clearing the group would take away the rules for every other engine the host has \
             allowed, got: {script}"
        );
    }

    /// Inbound and allow, on every profile, for the program rather than a port.
    /// This is the whole of what the rule has to be, and it is the one thing a
    /// person cannot check from the panel.
    #[test]
    fn the_allow_script_asks_for_an_inbound_allow_on_the_program() {
        let script = allow_script(&[a_program("Coilbox", r"C:\c\coilbox.exe")]);

        assert!(script.contains("-Direction Inbound"));
        assert!(script.contains("-Action Allow"));
        assert!(script.contains("-Profile Any"));
        assert!(script.contains(r"-Program 'C:\c\coilbox.exe'"));
        assert!(
            !script.contains("-Protocol"),
            "a protocol would allow the engine's UDP and not coilbox's TCP, got: {script}"
        );
    }

    /// The check has to name every program, in order, because the answers come
    /// back positionally.
    #[test]
    fn the_check_script_asks_about_every_program_in_order() {
        let script = check_script(&[
            a_program("Coilbox", r"C:\c\coilbox.exe"),
            a_program("Coilbox relay", r"C:\c\relay.exe"),
        ]);

        let first = script
            .find(r"'C:\c\coilbox.exe'")
            .expect("the first program");
        let second = script
            .find(r"'C:\c\relay.exe'")
            .expect("the second program");
        assert!(
            first < second,
            "the order is the answer's order, got: {script}"
        );
        assert!(script.contains("-Direction Inbound -Action Allow -Enabled True"));
    }

    /// The elevation, which is the only part of this that needs a prompt. A
    /// refusal has to come back as a refusal, or a host who said no is told
    /// coilbox is broken.
    #[test]
    fn the_elevate_script_runs_the_other_one_as_an_administrator() {
        let script = elevate_script(Path::new(r"C:\c\allow.ps1"));

        assert!(script.contains("-Verb RunAs"));
        assert!(script.contains("-Wait"));
        assert!(script.contains(r"'-File','C:\c\allow.ps1'"));
        assert!(
            script.contains(&format!("exit {CANCELLED}")),
            "a refused prompt has to be told apart from a failure, got: {script}"
        );
    }

    #[test]
    fn yes_and_no_come_back_in_the_order_they_were_asked() {
        assert_eq!(
            read_answers("yes\nno\nyes\n", 3),
            Ok(vec![true, false, true])
        );
    }

    /// Anything that is not a clean yes is a no, because the panel offers to fix
    /// it and offering to fix something that is already right costs one prompt.
    /// Reading a stray line as an allowed program costs a battle nobody can
    /// join.
    #[test]
    fn an_answer_that_is_not_yes_is_no() {
        assert_eq!(read_answers("no\nnope\n", 2), Ok(vec![false, false]));
    }

    /// A run that answered about a different number of programs is refused
    /// rather than lined up as far as it goes, because one missing line would
    /// report every program after it as the one before.
    #[test]
    fn a_short_answer_is_refused_rather_than_lined_up() {
        assert!(read_answers("yes\n", 3).is_err());
        assert!(read_answers("yes\nno\nyes\nno\n", 3).is_err());
    }

    /// The read is the half that was supposed to need no rights, and on some
    /// machines it is refused. Caught, or `$ErrorActionPreference = 'Stop'`
    /// prints a six line error record that the hosting drawer then shows.
    #[test]
    fn the_check_script_catches_a_refused_read() {
        let script = check_script(&[a_program("Coilbox", r"C:\c\coilbox.exe")]);

        assert!(script.contains("try {"), "got: {script}");
        assert!(
            script.contains("[Console]::Error.WriteLine($_.Exception.Message)"),
            "the message alone, not the record around it, got: {script}"
        );
        let caught = script.find("} catch {").expect("a catch");
        let asked = script.find("foreach ($p in").expect("the answers");
        assert!(
            caught < asked,
            "the catch covers the read and not the answers, got: {script}"
        );
    }

    /// PowerShell's error record, as a machine that refuses the read produces
    /// it. Every line but the first is decoration, and the whole lot used to go
    /// on screen.
    #[test]
    fn an_error_record_keeps_its_message_and_loses_its_decoration() {
        let record = "Get-NetFirewallRule : Access is denied.\n\
                      At C:\\c\\.coilbox\\data\\firewall\\check.ps1:3 char:1\n\
                      + Get-NetFirewallRule -Direction Inbound -Action Allow -Enabled True |\n\
                      + ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~\n    \
                      + CategoryInfo          : PermissionDenied: (MSFT_NetFirewallRule:root/\
                      standardcimv2/MSFT_NetFirewallRule) [Get-NetFirewallRule], CimException\n    \
                      + FullyQualifiedErrorId : Windows System Error 5,Get-NetFirewallRule\n";

        assert_eq!(
            tidy(record.as_bytes()),
            vec!["Get-NetFirewallRule : Access is denied.".to_owned()]
        );
    }

    /// A machine that will not answer is not a fault, and the panel draws it
    /// quietly with the button still there. The host can still add the rules:
    /// that half elevates.
    #[test]
    fn a_refused_read_is_not_drawn_as_a_fault() {
        let problem = why_it_failed(Some(1), b"Access is denied.\n", "check the firewall rules")
            .not_a_fault();

        assert_eq!(
            problem.title,
            "Windows would not let coilbox check the firewall rules"
        );
        assert_eq!(problem.details, vec!["Access is denied.".to_owned()]);
        assert!(!problem.fault);
    }

    /// A refusal at the administrator prompt is a decision. Nothing to unfold,
    /// and nothing to draw in red.
    #[test]
    fn a_refused_prompt_reads_as_a_choice() {
        let problem = why_it_failed(Some(CANCELLED), b"", "add the firewall rules");

        assert!(problem.title.contains("refused"));
        assert!(problem.details.is_empty());
        assert!(!problem.fault);
    }

    /// A script that failed and said nothing still has to leave something to
    /// unfold, or the panel says a thing went wrong and offers no way to find
    /// out what.
    #[test]
    fn a_silent_failure_still_says_what_the_exit_code_was() {
        let problem = why_it_failed(Some(9), b"  \n", "add the firewall rules");

        assert_eq!(
            problem.title,
            "Windows would not let coilbox add the firewall rules"
        );
        assert_eq!(
            problem.details,
            vec!["PowerShell exited with code 9 and said nothing.".to_owned()]
        );
        assert!(problem.fault);
    }

    /// An engine is named after the folder it is in, because that is its
    /// version and because two engines sharing a rule name would mean allowing
    /// one un-allowed the other.
    #[test]
    fn an_engine_rule_is_named_after_its_version() {
        assert_eq!(
            engine_rule_name(Path::new("/data/engine/105.1.1-2590/spring")),
            "Coilbox engine (105.1.1-2590)"
        );
    }

    /// Nothing here happens anywhere but Windows, and the frontend hides the
    /// panel on the strength of this rather than reading the user agent.
    #[test]
    fn nothing_is_supported_off_windows() {
        assert_eq!(supported(), cfg!(target_os = "windows"));
    }
}
