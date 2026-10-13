//! The analysis game: a generated game that depends on the one a replay was
//! recorded on and adds the replay logger, and nothing else (issue #1183).
//!
//! It is the scenario test mutator's shape, `crates/tauri-plugin-coilbox-scenario/
//! src/mutator.rs`, and it is written by that module's writer. A loose `.sdd`
//! holding a `modinfo.lua` that names the base game in `depend`, and one gadget.
//! The base game is depended on and never touched, so it can be a packaged
//! `.sd7` or `.sdz`, and it never has to know coilbox exists.
//!
//! What it must not hold matters as much. A depending archive mounts above its
//! base, so a unit, weapon or feature definition in here would join the base
//! game's and move the definition ids every recorded event is keyed by. The
//! tests pin the file list to the files written here: two, and two more for a
//! run that records.
//!
//! The game keeps a name, short name and version of its own. It has to have its
//! own name, because the name is what the rewritten replay points at, and the
//! short name follows it the way the test mutator's does. A base game whose
//! gadgets branch on `Game.gameShortName` or `Game.gameName` will see these and
//! not its own. The divergence check after every run is what catches a game
//! where that changes the match.

use std::path::{Path, PathBuf};

use tauri_plugin_coilbox_scenario::mutator::write_file;

/// The game's folder name under a data directory's `games/`.
pub const FOLDER: &str = "coilbox-replay-analysis.sdd";

const NAME: &str = "Coilbox replay analysis";
const SHORT_NAME: &str = "coilbox_replay_analysis";
const VERSION: &str = "1";

/// The logger, compiled in so a run needs nothing on disk but the engine.
pub const LOGGER: &str =
    include_str!("../../../../../lua/replay-logger/luarules/gadgets/coilbox_replay_logger.lua");

/// Where a game's gadget handler looks. Every handler measured scans this
/// folder of every mounted archive: Splinter Faction's own `gadgets.lua`, and
/// the engine's base content one that Metal Factions uses.
const LOGGER_PATH: &str = "luarules/gadgets/coilbox_replay_logger.lua";

/// The file the logger writes, relative to the engine's write directory. The
/// same name is in the gadget, and a test holds the two together.
pub const EVENTS_FILE: &str = "coilbox-replay-events.jsonl";

/// The rewind recorder, the second gadget, which goes in only for a run that
/// asks for a recording (issue #3780).
pub const RECORDER: &str =
    include_str!("../../../../../lua/rewind-recorder/luarules/gadgets/coilbox_rewind_recorder.lua");

const RECORDER_PATH: &str = "luarules/gadgets/coilbox_rewind_recorder.lua";

/// Where the recorder looks for its request. The same path is in the gadget,
/// and a test holds the two together.
const RECORDER_REQUEST_PATH: &str = "luarules/configs/coilbox_rewind_request.lua";

/// The file the recorder writes, relative to the engine's write directory. The
/// same name is in the gadget, and a test holds the two together.
pub const RECORDING_FILE: &str = "coilbox-rewind.dump";

/// What a run that records tells the recorder.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Recording {
    /// The last frame in the replay's stream. The recorder ends its file
    /// there, because a replay of a match that crashed never reaches game over.
    pub last_frame: i32,
}

/// The recorder's request file: a Lua table.
fn recorder_request(recording: &Recording) -> String {
    format!(
        "-- Asks the coilbox rewind recorder to record this run.\nreturn {{\n  lastFrame = {},\n}}\n",
        recording.last_frame
    )
}

/// What a start script has to name to launch the analysis game. The engine
/// builds an archive's name as its `name`, a space, and its `version`.
pub fn gametype() -> String {
    format!("{NAME} {VERSION}")
}

/// A Lua string literal holding `text`.
fn lua_string(text: &str) -> String {
    let mut out = String::with_capacity(text.len() + 2);
    out.push('"');
    for c in text.chars() {
        match c {
            '\\' => out.push_str("\\\\"),
            '"' => out.push_str("\\\""),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            other => out.push(other),
        }
    }
    out.push('"');
    out
}

/// The analysis game's `modinfo.lua`, depending on `base_game`, which is the
/// `gametype` the replay was recorded with.
pub fn modinfo(base_game: &str) -> String {
    let description = format!("The coilbox replay logger on top of {base_game}.");
    [
        "-- The game coilbox replays a match in to record what happened.".to_string(),
        "-- Written for one run and deleted after it.".to_string(),
        String::new(),
        "return {".to_string(),
        format!("  name = {},", lua_string(NAME)),
        format!("  shortname = {},", lua_string(SHORT_NAME)),
        format!("  game = {},", lua_string(NAME)),
        format!("  version = {},", lua_string(VERSION)),
        format!("  description = {},", lua_string(&description)),
        "  modtype = 1,".to_string(),
        "  depend = {".to_string(),
        format!("    {},", lua_string(base_game)),
        "  },".to_string(),
        "}".to_string(),
        String::new(),
    ]
    .join("\n")
}

/// Write the analysis game under `data_dir/games/` and return its folder.
///
/// `data_dir` is a scratch data directory of coilbox's own, never a player's
/// content folder. The caller removes it after the run.
///
/// `logger` is the gadget to carry, which is [`LOGGER`] for every caller but
/// the test that perturbs the simulation on purpose to prove the divergence
/// check notices.
///
/// `recording` adds the rewind recorder and its request. Without it neither
/// file is written, so a run that does not record plays the game it always did.
pub fn write_game(
    data_dir: &Path,
    base_game: &str,
    logger: &str,
    recording: Option<&Recording>,
) -> Result<PathBuf, String> {
    if base_game.trim().is_empty() {
        return Err("the replay names no game to depend on".into());
    }
    let dir = data_dir.join("games").join(FOLDER);
    write_file(&dir.join("modinfo.lua"), &modinfo(base_game))?;
    write_file(&dir.join(LOGGER_PATH), logger)?;
    if let Some(recording) = recording {
        write_file(&dir.join(RECORDER_PATH), RECORDER)?;
        write_file(
            &dir.join(RECORDER_REQUEST_PATH),
            &recorder_request(recording),
        )?;
    }
    Ok(dir)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Every file under `dir`, relative to it, sorted.
    fn files(dir: &Path) -> Vec<String> {
        fn walk(root: &Path, dir: &Path, out: &mut Vec<String>) {
            for entry in std::fs::read_dir(dir).expect("read_dir").flatten() {
                let path = entry.path();
                if path.is_dir() {
                    walk(root, &path, out);
                } else {
                    let rel = path.strip_prefix(root).expect("under root");
                    out.push(rel.to_string_lossy().replace('\\', "/"));
                }
            }
        }
        let mut out = Vec::new();
        walk(dir, dir, &mut out);
        out.sort();
        out
    }

    #[test]
    fn the_game_is_a_modinfo_and_one_gadget_and_nothing_else() {
        let data = tempfile::tempdir().expect("tempdir");
        let dir = write_game(data.path(), "Some Game 1.0", LOGGER, None).expect("write");

        assert_eq!(dir, data.path().join("games").join(FOLDER));
        // No units, weapons, features or gamedata: anything of that kind would
        // join the base game's definitions and move their ids.
        assert_eq!(
            files(&dir),
            vec!["luarules/gadgets/coilbox_replay_logger.lua", "modinfo.lua"]
        );
    }

    /// A run that records carries two more files: the recorder and what it was
    /// asked. Still no definitions of any kind.
    #[test]
    fn a_recording_adds_the_recorder_and_its_request_and_nothing_else() {
        let data = tempfile::tempdir().expect("tempdir");
        let recording = Recording { last_frame: 23200 };
        let dir =
            write_game(data.path(), "Some Game 1.0", LOGGER, Some(&recording)).expect("write");

        assert_eq!(
            files(&dir),
            vec![
                "luarules/configs/coilbox_rewind_request.lua",
                "luarules/gadgets/coilbox_replay_logger.lua",
                "luarules/gadgets/coilbox_rewind_recorder.lua",
                "modinfo.lua"
            ]
        );
        let written = std::fs::read_to_string(dir.join(RECORDER_PATH)).expect("read");
        assert_eq!(written, RECORDER);
        assert!(written.contains("Coilbox rewind recorder"));
        let request = std::fs::read_to_string(dir.join(RECORDER_REQUEST_PATH)).expect("read");
        assert!(
            request.contains("return {\n  lastFrame = 23200,\n}"),
            "{request}"
        );
    }

    /// The recorder reads its request and writes its file by names of its own
    /// choosing. This side writes the one and reads the other by the same
    /// names, so they are held together here.
    #[test]
    fn the_recorder_reads_the_request_and_writes_the_file_this_side_names() {
        assert!(RECORDER.contains(&format!("local REQUEST_FILE = \"{RECORDER_REQUEST_PATH}\"")));
        assert!(RECORDER.contains(&format!("local DUMP_FILE = \"{RECORDING_FILE}\"")));
    }

    #[test]
    fn the_gadget_written_is_the_one_in_the_repository() {
        let data = tempfile::tempdir().expect("tempdir");
        let dir = write_game(data.path(), "Some Game 1.0", LOGGER, None).expect("write");

        let written = std::fs::read_to_string(dir.join(LOGGER_PATH)).expect("read");
        assert_eq!(written, LOGGER);
        assert!(written.contains("Coilbox replay logger"));
    }

    #[test]
    fn the_modinfo_depends_on_the_game_the_replay_was_recorded_on() {
        let text = modinfo("SplinterFaction $VERSION");

        assert!(text.contains("depend = {\n    \"SplinterFaction $VERSION\",\n  },"));
        assert!(text.contains("modtype = 1,"));
        assert!(text.contains("name = \"Coilbox replay analysis\","));
        assert!(text.contains("version = \"1\","));
    }

    #[test]
    fn a_game_name_with_a_quote_in_it_cannot_end_the_string() {
        let text = modinfo("Odd \"Game\" \\ 2");

        assert!(text.contains("    \"Odd \\\"Game\\\" \\\\ 2\","));
    }

    /// The engine names an archive `name version`, and that is the string the
    /// rewritten replay has to carry.
    #[test]
    fn the_gametype_is_the_name_the_engine_gives_the_archive() {
        assert_eq!(gametype(), "Coilbox replay analysis 1");
        assert!(modinfo("x").contains(&format!("name = \"{NAME}\"")));
    }

    #[test]
    fn a_replay_that_names_no_game_is_refused() {
        let data = tempfile::tempdir().expect("tempdir");
        assert!(write_game(data.path(), "  ", LOGGER, None).is_err());
    }

    /// The folder has to be one no real game could have, held to the same shape
    /// as the test mutator's.
    #[test]
    fn the_folder_is_coilboxs_own_and_loose() {
        assert!(FOLDER.starts_with("coilbox-"));
        assert!(FOLDER.ends_with(".sdd"));
        assert!(!FOLDER.contains(".."));
    }

    /// The logger writes to a name of its own choosing. This side reads it back
    /// by the same name, so the two are held together here.
    #[test]
    fn the_logger_writes_the_file_this_side_reads() {
        assert!(LOGGER.contains(&format!("local LOG_FILE = \"{EVENTS_FILE}\"")));
    }
}
