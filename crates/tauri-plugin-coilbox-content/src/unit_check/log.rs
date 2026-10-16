//! Reading what the engine said during a unit load check (issue #3319).
//!
//! A healthy run of Splinter Faction in a headless engine logs 53 errors, and
//! none of them is about the unit: widgets that need OpenGL, the game's own
//! chicken definitions, features the map names and the game does not have. So
//! the engine's errors cannot be the verdict. What is kept is the entries that
//! name the unit or one of its files, and the check gadget's own lines. The
//! rest are counted and left in the log.
//!
//! Every failure below was made on purpose and read out of a real log:
//!
//! - A script that throws: `[unit_script.lua] Error: [string
//!   "scripts/probe_unit.lua"]:7: ...`, once per copy of the unit.
//! - A script that does not compile: `[unit_script.lua] Error: Failed to load:
//!   probe_unit.lua (...)`.
//! - A piece the script names and the model lacks: `Error:
//!   [LuaRules::RunCallInTraceback] ... "scripts/probe_unit.lua"]:1: piece not
//!   found: nope`.
//! - A model file that is not there: `[unitdefs.lua] Error: removed probe_unit
//!   unitDef, missing model file (probe_unit)`.
//! - A definition that does not parse: `[unitdefs.lua] Error: Error parsing
//!   units/probe_unit.lua: ...`.
//! - A game whose own definition scripts fail on the unit: a `Fatal:` entry,
//!   and the engine exits without starting the match.
//!
//! A texture that is not there says nothing at all, because a headless engine
//! loads no textures. The check gadget looks for those itself.

use serde::Serialize;

/// The section the check gadget logs under, as the engine's formatter writes
/// it. The same string is in the gadget.
pub const SECTION: &str = "[coilbox-unit-check]";

/// How a log entry reads, by the level the engine's formatter wrote before it.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Level {
    Fatal,
    Error,
    Warning,
    Normal,
}

/// One thing the engine said, as many times as it said it.
#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    /// The message, with the time and frame stamps taken off and any stack
    /// trace that followed it kept.
    pub text: String,
    /// How many times it was logged. A spawn gadget that gives every team a
    /// copy makes the same script error once per copy.
    pub count: u32,
}

/// What a run's log says.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct CheckLog {
    /// The unit was spawned, and how many pieces it had.
    pub spawned_pieces: Option<u32>,
    /// The frame the gadget finished its plan on. Absent when it never did.
    pub done_frame: Option<i32>,
    /// Errors about the unit, the check gadget's own included.
    pub problems: Vec<Entry>,
    /// Warnings about the unit.
    pub warnings: Vec<Entry>,
    /// The engine's fatal entries, which are why a match never started.
    pub fatal: Vec<Entry>,
    /// Error entries about anything else.
    pub other_errors: usize,
}

/// Read a run's output. `unit` is the unit's name.
pub fn read(output: &str, unit: &str) -> CheckLog {
    let mut log = CheckLog::default();
    for entry in entries(output) {
        let text = without_stamps(&entry);
        let ours = text.starts_with(SECTION);
        match level(&entry) {
            Level::Fatal => add(&mut log.fatal, text),
            Level::Error if ours || mentions(&text, unit) => add(&mut log.problems, text),
            Level::Error => log.other_errors += 1,
            Level::Warning if mentions(&text, unit) => add(&mut log.warnings, text),
            Level::Normal if ours => {
                let said = text[SECTION.len()..].trim();
                if let Some(pieces) = said
                    .strip_prefix("spawned ")
                    .and_then(|rest| rest.rsplit(" with ").next())
                    .and_then(|rest| rest.strip_suffix(" pieces"))
                {
                    log.spawned_pieces = pieces.parse().ok();
                } else if let Some(frame) = said.strip_prefix("done at frame ") {
                    log.done_frame = frame.parse().ok();
                }
            }
            _ => {}
        }
    }
    log
}

/// The output split into entries. An entry starts at a line that opens with a
/// bracket, which is every line the engine's formatter writes, and runs on
/// through the lines that do not: a stack trace, or the rest of a message that
/// carries newlines of its own.
fn entries(output: &str) -> Vec<String> {
    let mut entries: Vec<String> = Vec::new();
    for line in output.lines() {
        match entries.last_mut() {
            Some(entry) if !line.starts_with('[') => {
                entry.push('\n');
                entry.push_str(line);
            }
            _ => entries.push(line.to_string()),
        }
    }
    entries
}

/// An entry without the `[t=...]` time and `[f=...]` frame the engine stamps
/// it with, which differ between two copies of the same message.
fn without_stamps(entry: &str) -> String {
    let mut rest = entry;
    loop {
        let trimmed = rest.trim_start();
        let stamped = trimmed.starts_with("[t=") || trimmed.starts_with("[f=");
        match trimmed.find(']') {
            Some(end) if stamped => rest = &trimmed[end + 1..],
            _ => return trimmed.trim_end().to_string(),
        }
    }
}

/// Count `text` in `list`, adding it the first time it is seen.
fn add(list: &mut Vec<Entry>, text: String) {
    match list.iter_mut().find(|entry| entry.text == text) {
        Some(entry) => entry.count += 1,
        None => list.push(Entry { text, count: 1 }),
    }
}

/// Whether `text` names `unit` as a whole name: on its own, or as the stem of
/// one of its files. A longer name the unit's is the start of, such as the
/// wreck a game generates for it, is a different thing.
fn mentions(text: &str, unit: &str) -> bool {
    if unit.is_empty() {
        return false;
    }
    let haystack = text.to_ascii_lowercase();
    let needle = unit.to_ascii_lowercase();
    let part_of_a_name = |c: Option<char>| c.is_some_and(|c| c.is_ascii_alphanumeric() || c == '_');
    haystack.match_indices(&needle).any(|(at, _)| {
        !part_of_a_name(haystack[..at].chars().next_back())
            && !part_of_a_name(haystack[at + needle.len()..].chars().next())
    })
}

/// The level of an entry, read off the prefix the engine's formatter writes
/// before the message, after the stamps and any `[Section]`. The same rule as
/// `classifyLine` in `src/play/crash.ts`: the formatter writes the level only
/// above Notice, and a message may contain the word "Error" without being one.
pub fn level(entry: &str) -> Level {
    let mut rest = entry.lines().next().unwrap_or("");
    loop {
        let trimmed = rest.trim_start();
        match trimmed
            .strip_prefix('[')
            .and_then(|r| r.find(']').map(|end| &r[end + 1..]))
        {
            Some(after) => rest = after,
            None => {
                rest = trimmed;
                break;
            }
        }
    }
    let word: String = rest
        .chars()
        .take_while(|c| c.is_alphanumeric() || *c == '_')
        .collect();
    if !rest[word.len()..].starts_with(':') {
        return Level::Normal;
    }
    match word.as_str() {
        "Fatal" => Level::Fatal,
        "Error" => Level::Error,
        "Warning" | "Deprecated" => Level::Warning,
        _ => Level::Normal,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // Lines out of real runs of Splinter Faction 0.1.89 in a headless engine,
    // cut down to the ones each test is about.

    const SPAWNED: &str =
        "[t=00:00:10.290907][f=0000030] [coilbox-unit-check] spawned probe_unit with 5 pieces";
    const DONE: &str = "[t=00:00:10.594594][f=0000480] [coilbox-unit-check] done at frame 480";
    const NOISE: &str = r#"[t=00:00:04.492896][f=-000001] [LuaIntro] Error: Failed to load: main.lua  ([LuaVFS::Include(synced=false)][pcall] file=LuaIntro/Addons/main.lua error=2)
[t=00:00:05.269514][f=-000001] [unitdefs.lua] Error: Error parsing units/chickens/chickenboss_veryeasy.lua: error = 2
[t=00:00:01.648400][f=-000001] Warning: [IsPathOnSpinningDisk] Error 'No such file or directory' getting readlink() for file '/x/games/coilbox-lego-test.sdd'
[t=00:00:01.105275][f=-000001] [featuredefs_post.lua] Warning: Removing feature def, probe_unit_dead, for having invalid model that would crash the engine, probe_unit_dead
[t=00:00:10.273848][f=0000001] Input grabbing is enabled!"#;

    fn log(lines: &[&str]) -> String {
        lines.join("\n") + "\n"
    }

    #[test]
    fn a_unit_that_loads_has_no_problems_and_the_rest_are_counted() {
        let read = read(&log(&[NOISE, SPAWNED, DONE]), "probe_unit");

        assert_eq!(read.spawned_pieces, Some(5));
        assert_eq!(read.done_frame, Some(480));
        assert!(read.problems.is_empty(), "{:?}", read.problems);
        // The wreck's warning names `probe_unit_dead`, which is the game's
        // generated wreck and not the unit.
        assert!(read.warnings.is_empty(), "{:?}", read.warnings);
        assert!(read.fatal.is_empty());
        assert_eq!(read.other_errors, 2);
    }

    #[test]
    fn a_script_that_throws_is_one_problem_counted_per_copy() {
        let throw = "[t=00:00:10.299444][f=0000030] [unit_script.lua] Error: [string \"scripts/probe_unit.lua\"]:7: deliberately broken";
        let unrelated = "[t=00:00:10.300149][f=0000030] Error: [LuaRules::RunCallInTraceback] error=2 (LUA_ERRRUN) callin=UnitCreated trace=[string \"LuaRules/Gadgets/cus_gl4.lua\"]:1948: attempt to call field 'SetUnitBufferUniforms' (a nil value)\nstack traceback:\n\t[string \"LuaRules/Gadgets/cus_gl4.lua\"]:1948: in function 'UnitCreated'";
        let read = read(
            &log(&[throw, unrelated, throw, unrelated, throw, SPAWNED, DONE]),
            "probe_unit",
        );

        assert_eq!(
            read.problems,
            vec![Entry {
                text: "[unit_script.lua] Error: [string \"scripts/probe_unit.lua\"]:7: deliberately broken".into(),
                count: 3,
            }]
        );
        assert_eq!(read.other_errors, 2);
    }

    #[test]
    fn a_stack_trace_stays_with_the_error_it_belongs_to() {
        let piece = "[t=00:00:10.366237][f=0000030] Error: [LuaRules::RunCallInTraceback] error=2 callin=UnitCreated trace=[string \"scripts/probe_unit.lua\"]:1: piece not found: nope\nstack traceback:\n\t[C]: in function 'piece'";
        let read = read(&log(&[piece, SPAWNED, DONE]), "probe_unit");

        assert_eq!(read.problems.len(), 1);
        assert!(read.problems[0]
            .text
            .starts_with("Error: [LuaRules::RunCallInTraceback]"));
        assert!(read.problems[0]
            .text
            .ends_with("\n\t[C]: in function 'piece'"));
    }

    #[test]
    fn a_dropped_definition_is_the_engines_reason_and_the_gadgets() {
        let missing = "[t=00:00:01.054516][f=-000001] [unitdefs.lua] Error: removed probe_unit unitDef, missing model file  (probe_unit)";
        let gadget = "[t=00:00:10.282439][f=0000030] [coilbox-unit-check] Error: no unit definition called probe_unit";
        let echo = "[t=00:00:10.282379][f=0000030] [coilbox] no unit definition called probe_unit";
        let read = read(&log(&[missing, echo, gadget, DONE]), "probe_unit");

        let texts: Vec<&str> = read.problems.iter().map(|e| e.text.as_str()).collect();
        assert_eq!(
            texts,
            vec![
                "[unitdefs.lua] Error: removed probe_unit unitDef, missing model file  (probe_unit)",
                "[coilbox-unit-check] Error: no unit definition called probe_unit",
            ]
        );
        assert_eq!(read.spawned_pieces, None);
    }

    #[test]
    fn a_game_that_never_started_keeps_the_fatal_entry_whole() {
        let fatal = "[t=00:00:02.943208][f=-000001] Fatal: [ExitSpringProcess] errorMsg=\"Errors:\nDefs-Parser: [pcall] error 2 (\"[string \"gamedata/alldefs_post.lua\"]:64: attempt to concatenate field 'unitname' (a nil value)\n\n\") in gamedata/defs.lua\" msgCaption=\"Recoil: caught content_error(s)\" mainThread=1";
        let read = read(
            &log(&[
                NOISE,
                fatal,
                "[t=00:00:02.943275][f=-000001] [SpringApp::Kill][1] fromRun=0",
            ]),
            "probe_unit",
        );

        assert_eq!(read.done_frame, None);
        assert_eq!(read.fatal.len(), 1);
        assert!(read.fatal[0]
            .text
            .contains("field 'unitname' (a nil value)"));
        assert!(read.fatal[0].text.ends_with("mainThread=1"));
        assert_eq!(read.other_errors, 2);
    }

    #[test]
    fn the_unit_is_matched_as_a_whole_name() {
        // `probe` is a prefix of the name, and `probe_unit_dead` is a longer
        // one. Neither is the unit.
        let other = "[t=0][f=1] Error: something about probe";
        let longer = "[t=0][f=1] Error: probe_unit_dead has no model";
        let path = "[t=0][f=1] Error: could not read units/Probe_Unit.lua";
        let read = read(&log(&[other, longer, path, DONE]), "probe_unit");

        let texts: Vec<&str> = read.problems.iter().map(|e| e.text.as_str()).collect();
        assert_eq!(texts, vec!["Error: could not read units/Probe_Unit.lua"]);
    }

    #[test]
    fn a_warning_about_the_unit_is_kept_apart_from_its_errors() {
        let warning = "[t=0][f=1] [unit_script.lua] Warning: probe_unit is slow";
        let read = read(&log(&[warning, SPAWNED, DONE]), "probe_unit");

        assert!(read.problems.is_empty());
        assert_eq!(
            read.warnings,
            vec![Entry {
                text: "[unit_script.lua] Warning: probe_unit is slow".into(),
                count: 1
            }]
        );
    }

    #[test]
    fn the_level_is_read_from_its_prefix_and_not_from_the_message() {
        assert_eq!(
            level("[t=1] Warning: [IsPathOnSpinningDisk] Error 'x'"),
            Level::Warning
        );
        assert_eq!(level("[t=1][f=2] [unit_script.lua] Error: x"), Level::Error);
        assert_eq!(level("[t=1] Fatal: [ExitSpringProcess] x"), Level::Fatal);
        assert_eq!(level("[t=1] [coilbox] no unit definition"), Level::Normal);
        assert_eq!(level("[t=1] Deprecated: x"), Level::Warning);
    }
}
