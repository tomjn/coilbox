//! The unit load check: run the unit builder's scratch game in a headless
//! engine, spawn the unit, let it run, and say what the engine made of it
//! (issue #3319).
//!
//! The builder writes the unit into its scratch game first, the same way Test
//! in game does, and asks unitsync for the name that game goes by. This writes
//! a second generated game that depends on that one and carries the check
//! gadget (`lua/unit-check/`), plays it headless through the replay analysis's
//! launch ([`crate::demo::analysis::launch`]), and reads the engine's output.
//! See [`log`] for what is read and why.
//!
//! The check game carries nothing but the gadget and its request, so the
//! scratch game a windowed test plays is the same one this checks, and nothing
//! about that test changes.
//!
//! Everything this writes is under one folder in the app's cache, kept between
//! checks. The engine's write directory is the part worth keeping: the archive
//! cache in it took a check of Splinter Faction from 28.3 seconds on its first
//! run to 10.9 seconds on the next, on this Mac. Splinter Faction also restarts
//! the engine on its first run in a write directory, to build files it keeps
//! there.

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use picoframe_core::CliResult;
use serde::Serialize;
use serde_json::json;
use tauri::{AppHandle, Manager, Runtime};
use tauri_plugin_coilbox_scenario::mutator::write_file;

use crate::demo::analysis::game::lua_string;
use crate::demo::analysis::launch::{self, EngineExit, RunControl};
use crate::demo::analysis::START_UP_ALLOWANCE;

pub mod log;

/// The check game's folder name under its data directory's `games/`.
pub const FOLDER: &str = "coilbox-unit-check.sdd";

const NAME: &str = "Coilbox unit check";
const VERSION: &str = "1";

/// The check gadget, compiled in so a check needs nothing on disk but the
/// engine and the scratch game.
const GADGET: &str =
    include_str!("../../../lua/unit-check/luarules/gadgets/coilbox_unit_check.lua");

const GADGET_PATH: &str = "luarules/gadgets/coilbox_unit_check.lua";

/// Where the gadget looks for its request. The same path is in the gadget.
const REQUEST_PATH: &str = "luarules/configs/coilbox_unit_check_request.lua";

/// The folder under the app's cache directory that checks run in.
const CHECK_DIR: &str = "unit-check";

/// Frames a second at the engine's normal speed (`GAME_SPEED` in
/// `rts/Sim/Misc/GlobalConstants.h`). The gadget asks the server to play
/// faster than that, and the server never plays slower.
const GAME_SPEED: u32 = 30;

/// What one check needs.
#[derive(Clone, Debug)]
pub struct CheckRequest {
    /// The engine folder, which holds `spring-headless`.
    pub engine_dir: PathBuf,
    /// The content folders the engine reads, the one holding the scratch game
    /// first.
    pub content_dirs: Vec<PathBuf>,
    /// The scratch game's name, as unitsync reports it.
    pub game: String,
    /// The map's name, as unitsync reports it.
    pub map: String,
    /// The unit's name, which is its definition's key.
    pub unit_name: String,
    /// The frame the gadget spawns the unit on.
    pub spawn_frame: u32,
    /// How many frames the unit runs for after that.
    pub frames: u32,
}

/// How a check came out.
#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum Outcome {
    /// The unit spawned and ran, and nothing about it was an error.
    Loaded,
    /// The check ran to the end and found errors about the unit.
    Problems,
    /// The engine stopped before the match started. Its fatal entries say why.
    GameDidNotLoad,
    /// The engine stopped part way through with no fatal entry: it crashed,
    /// ran out of time or was stopped.
    Unfinished,
}

/// Everything a check found.
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct UnitCheckReport {
    pub outcome: Outcome,
    /// How many pieces the spawned unit had. Absent when it never spawned.
    pub spawned_pieces: Option<u32>,
    /// The frame the check finished on. Absent when it never did.
    pub done_frame: Option<i32>,
    /// How far the unit got when ordered to move, in whole elmos. Absent for a
    /// unit the engine gave no move class, which is not ordered anywhere.
    pub moved_elmos: Option<u32>,
    /// The move class the engine gave the unit, as the engine names it.
    pub move_class: Option<String>,
    pub problems: Vec<log::Entry>,
    pub warnings: Vec<log::Entry>,
    pub fatal: Vec<log::Entry>,
    /// Errors in the log about anything other than the unit.
    pub other_errors: usize,
    pub exit: EngineExit,
    /// The engine's whole output, kept until the next check.
    pub log_path: String,
}

/// The headless engine to run, or what is missing, in words a person can act
/// on. The same two refusals as `scripts/mission-engine.sh`: no binary, and a
/// binary with no base content, which the engine needs to read even a start
/// script and without which it fails claiming the script has no game section.
pub fn headless_engine(engine_dir: &Path, content_dirs: &[PathBuf]) -> Result<PathBuf, String> {
    let engine = launch::headless_binary(engine_dir);
    if !engine.is_file() {
        return Err(format!(
            "No headless engine in {}. The check needs spring-headless, and this engine does not have it.",
            engine_dir.display()
        ));
    }
    let has_base = std::iter::once(engine_dir)
        .chain(content_dirs.iter().map(PathBuf::as_path))
        .any(|dir| dir.join("base").is_dir());
    if !has_base {
        return Err(format!(
            "The headless engine in {} has no base content. Neither it nor the content folder has a base folder.",
            engine_dir.display()
        ));
    }
    Ok(engine)
}

/// What a start script has to name to launch the check game. The engine
/// builds an archive's name as its `name`, a space, and its `version`.
pub fn gametype() -> String {
    format!("{NAME} {VERSION}")
}

/// The check game's `modinfo.lua`, depending on the scratch game.
fn modinfo(scratch_game: &str) -> String {
    [
        "-- The game coilbox checks a built unit loads in.".to_string(),
        "-- Rewritten for every check.".to_string(),
        String::new(),
        "return {".to_string(),
        format!("  name = {},", lua_string(NAME)),
        "  shortname = \"coilbox_unit_check\",".to_string(),
        format!("  game = {},", lua_string(NAME)),
        format!("  version = {},", lua_string(VERSION)),
        format!(
            "  description = {},",
            lua_string(&format!("The coilbox unit check on top of {scratch_game}."))
        ),
        "  modtype = 1,".to_string(),
        "  depend = {".to_string(),
        format!("    {},", lua_string(scratch_game)),
        "  },".to_string(),
        "}".to_string(),
        String::new(),
    ]
    .join("\n")
}

/// The gadget's request file: a Lua table.
fn request_file(request: &CheckRequest) -> String {
    format!(
        "-- Asks the coilbox unit check to check this unit.\nreturn {{\n  unitName = {},\n  spawnFrame = {},\n  frames = {},\n}}\n",
        lua_string(&request.unit_name),
        request.spawn_frame,
        request.frames,
    )
}

/// Whether a name can go into a start script as it is. The script's syntax
/// has no quoting, so a name holding one of its delimiters would change what
/// the script says.
fn script_safe(name: &str) -> bool {
    !name.trim().is_empty() && !name.contains([';', '{', '}', '[', ']', '=', '\n', '\r'])
}

/// The start script: one player and two teams on the check game. Two teams,
/// because a game may end a match with one ally team left in it at once. Both
/// are on the scratch game's side, as Test in game's are.
fn start_script(map: &str) -> String {
    let team = |n: u32| {
        format!(
            "\t[team{n}]\n\t{{\n\t\tallyteam={n};\n\t\tteamleader=0;\n\t\tside=Coilbox;\n\t}}\n"
        )
    };
    let ally = |n: u32| format!("\t[allyteam{n}]\n\t{{\n\t\tnumallies=0;\n\t}}\n");
    format!(
        "[game]\n{{\n\tishost=1;\n\tnumallyteams=2;\n\tnumusers=1;\n\tnumteams=2;\n\tnumplayers=1;\n\tstartpostype=1;\n\tgametype={};\n\tmapname={map};\n\tmyplayername=coilbox;\n\t[player0]\n\t{{\n\t\tteam=0;\n\t\tspectator=0;\n\t\tname=coilbox;\n\t}}\n{}{}{}{}}}\n",
        gametype(),
        team(0),
        team(1),
        ally(0),
        ally(1),
    )
}

/// How long a check may run before it is killed: the replay analysis's
/// allowance for the engine to start, plus the frames played at the engine's
/// normal speed, which is the slowest the server plays them.
pub fn run_timeout(spawn_frame: u32, frames: u32) -> Duration {
    START_UP_ALLOWANCE
        + Duration::from_secs_f64(
            f64::from(spawn_frame.saturating_add(frames)) / f64::from(GAME_SPEED),
        )
}

/// Run one check in `root`. Blocks for as long as the engine runs, so call it
/// from a blocking task. Cancelling `control` kills the engine.
pub fn run_check(
    root: &Path,
    request: &CheckRequest,
    control: &RunControl,
) -> Result<UnitCheckReport, String> {
    for (what, name) in [("game", &request.game), ("map", &request.map)] {
        if !script_safe(name) {
            return Err(format!(
                "the {what} name {name:?} cannot go in a start script"
            ));
        }
    }
    let engine = headless_engine(&request.engine_dir, &request.content_dirs)?;

    // A check from a coilbox that was killed outright may have left its
    // engine running in here.
    launch::kill_leftover_engine(root);

    let data = root.join("data");
    let game = data.join("games").join(FOLDER);
    write_file(&game.join("modinfo.lua"), &modinfo(&request.game))?;
    write_file(&game.join(GADGET_PATH), GADGET)?;
    write_file(&game.join(REQUEST_PATH), &request_file(request))?;
    let script = root.join("script.txt");
    write_file(&script, &start_script(&request.map))?;

    let mut data_dirs = vec![data];
    data_dirs.extend(request.content_dirs.iter().cloned());
    let log_path = root.join("engine.log");
    let exit = launch::run_headless(
        &launch::Launch {
            engine: &engine,
            demo: &script,
            write_dir: &root.join("write"),
            config: &root.join("engine.cfg"),
            pid_file: &root.join(launch::PID_FILE),
            data_dirs: &data_dirs,
            log: &log_path,
            timeout: run_timeout(request.spawn_frame, request.frames),
            on_poll: &|| {},
        },
        control,
    )?;

    let output = std::fs::read(&log_path)
        .map(|bytes| String::from_utf8_lossy(&bytes).into_owned())
        .unwrap_or_default();
    let read = log::read(&output, &request.unit_name);
    let outcome = match (read.done_frame, read.fatal.is_empty()) {
        (Some(_), _) if read.problems.is_empty() => Outcome::Loaded,
        (Some(_), _) => Outcome::Problems,
        (None, false) => Outcome::GameDidNotLoad,
        (None, true) => Outcome::Unfinished,
    };
    Ok(UnitCheckReport {
        outcome,
        spawned_pieces: read.spawned_pieces,
        done_frame: read.done_frame,
        moved_elmos: read.moved.as_ref().map(|(elmos, _)| *elmos),
        move_class: read.moved.map(|(_, class)| class),
        problems: read.problems,
        warnings: read.warnings,
        fatal: read.fatal,
        other_errors: read.other_errors,
        exit,
        log_path: log_path.to_string_lossy().into_owned(),
    })
}

/// The app's one check at a time.
pub struct UnitChecks {
    root: PathBuf,
    running: Mutex<Option<Arc<RunControl>>>,
}

impl UnitChecks {
    /// Stop the running check, if there is one, and wait for its engine to be
    /// gone. Returns whether there was one.
    fn cancel(&self) -> bool {
        let running = self
            .running
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clone();
        if let Some(control) = &running {
            control.cancel();
        }
        running.is_some()
    }
}

/// Make the app's checks and hand them to Tauri. Called once, at plugin setup.
pub(crate) fn manage<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    let root = coilbox_portable::cache_dir(app)?.join(CHECK_DIR);
    {
        let root = root.clone();
        std::thread::spawn(move || launch::kill_leftover_engine(&root));
    }
    app.manage(UnitChecks {
        root,
        running: Mutex::new(None),
    });
    Ok(())
}

/// Stop a running check, for `RunEvent::Exit`. A headless engine would go on
/// without coilbox otherwise.
pub(crate) fn shutdown<R: Runtime>(app: &AppHandle<R>) {
    if let Some(checks) = app.try_state::<UnitChecks>() {
        checks.cancel();
    }
}

const NO_CHECKS: &str = "the unit check could not set up its folder";

/// `content_unit_check`: check that a unit the builder wrote into its scratch
/// game loads and runs in a headless engine. `game` is the scratch game's name
/// and `map` the map's, both as unitsync reports them. `dataDir` is the content
/// folder holding the scratch game. Answers the report, and rejects in words
/// when there is no headless engine, no base content, or a check already
/// running. The time limit is not the caller's to choose: see [`run_timeout`].
// Each argument is one field of the IPC payload, so grouping them would only
// move the width into a struct the frontend then has to nest.
#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub(crate) async fn content_unit_check<R: Runtime>(
    app: AppHandle<R>,
    engine_path: String,
    data_dir: String,
    game: String,
    map: String,
    unit_name: String,
    spawn_frame: u32,
    frames: u32,
) -> CliResult {
    let Some(checks) = app.try_state::<UnitChecks>() else {
        return CliResult::err(NO_CHECKS);
    };
    let control = Arc::new(RunControl::default());
    {
        let mut running = checks.running.lock().unwrap_or_else(|e| e.into_inner());
        if running.is_some() {
            return CliResult::err("A check is already running.");
        }
        *running = Some(control.clone());
    }
    let root = checks.root.clone();
    let mut content_dirs = vec![PathBuf::from(&data_dir)];
    content_dirs.extend(
        coilbox_proc::extra_datadirs(&data_dir)
            .split(coilbox_proc::DATADIR_SEP)
            .filter(|dir| !dir.is_empty())
            .map(PathBuf::from),
    );
    let request = CheckRequest {
        engine_dir: PathBuf::from(engine_path),
        content_dirs,
        game,
        map,
        unit_name,
        spawn_frame,
        frames,
    };
    let checked = {
        let control = control.clone();
        tauri::async_runtime::spawn_blocking(move || run_check(&root, &request, &control)).await
    };
    *checks.running.lock().unwrap_or_else(|e| e.into_inner()) = None;
    match checked {
        Ok(Ok(report)) => CliResult::ok(json!({ "report": report })),
        Ok(Err(e)) => CliResult::err(e),
        Err(e) => CliResult::err(format!("unit check task failed: {e}")),
    }
}

/// `content_unit_check_cancel`: stop the running check and wait for its engine
/// to be gone. Answers `{ cancelled }`, false when nothing was running.
#[tauri::command]
pub(crate) async fn content_unit_check_cancel<R: Runtime>(app: AppHandle<R>) -> CliResult {
    let Some(checks) = app.try_state::<UnitChecks>() else {
        return CliResult::err(NO_CHECKS);
    };
    let checks = checks.inner();
    CliResult::ok(json!({ "cancelled": checks.cancel() }))
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use crate::demo::analysis::launch::tests::fake_engine;

    struct World {
        dir: tempfile::TempDir,
        engine: PathBuf,
        content: PathBuf,
    }

    impl World {
        /// An engine folder holding a stand-in `spring-headless` that runs
        /// `body`, and base content beside it.
        fn new(body: &str) -> Self {
            let dir = tempfile::tempdir().unwrap();
            let engine = fake_engine(dir.path(), body);
            std::fs::create_dir_all(engine.parent().unwrap().join("base")).unwrap();
            let content = dir.path().join("content");
            std::fs::create_dir_all(&content).unwrap();
            World {
                dir,
                engine,
                content,
            }
        }

        fn root(&self) -> PathBuf {
            self.dir.path().join("check")
        }

        fn request(&self) -> CheckRequest {
            CheckRequest {
                engine_dir: self.engine.parent().unwrap().to_path_buf(),
                content_dirs: vec![self.content.clone()],
                game: "Coilbox unit test scratch".into(),
                map: "Small_Supreme_Battlefield_V3".into(),
                unit_name: "probe_unit".into(),
                spawn_frame: 30,
                frames: 450,
            }
        }

        fn check(&self) -> Result<UnitCheckReport, String> {
            run_check(&self.root(), &self.request(), &RunControl::default())
        }
    }

    const GOOD_RUN: &str =
        "echo '[t=00:00:10.29][f=0000030] [coilbox-unit-check] spawned probe_unit with 5 pieces'; \
         echo '[t=00:00:04.49][f=-000001] [LuaIntro] Error: Failed to load: main.lua'; \
         echo '[t=00:00:10.59][f=0000480] [coilbox-unit-check] done at frame 480'";

    #[test]
    fn a_unit_that_loads_is_reported_loaded_with_the_rest_counted() {
        let world = World::new(GOOD_RUN);
        let report = world.check().unwrap();

        assert_eq!(report.outcome, Outcome::Loaded);
        assert_eq!(report.spawned_pieces, Some(5));
        assert_eq!(report.done_frame, Some(480));
        assert_eq!(report.other_errors, 1);
        assert_eq!(report.exit.code, Some(0));
        assert_eq!(
            PathBuf::from(&report.log_path),
            world.root().join("engine.log")
        );
    }

    #[test]
    fn errors_about_the_unit_are_problems() {
        let world = World::new(
            "echo '[t=1][f=30] [unit_script.lua] Error: [string \"scripts/probe_unit.lua\"]:7: boom'; \
             echo '[t=1][f=30] [coilbox-unit-check] spawned probe_unit with 5 pieces'; \
             echo '[t=1][f=480] [coilbox-unit-check] done at frame 480'",
        );
        let report = world.check().unwrap();

        assert_eq!(report.outcome, Outcome::Problems);
        assert_eq!(report.problems.len(), 1);
    }

    #[test]
    fn an_engine_that_stops_with_a_fatal_entry_did_not_load_the_game() {
        let world = World::new(
            "echo '[t=1][f=-1] Fatal: [ExitSpringProcess] errorMsg=\"alldefs_post.lua:64: unitname\"'; exit 21",
        );
        let report = world.check().unwrap();

        assert_eq!(report.outcome, Outcome::GameDidNotLoad);
        assert_eq!(report.fatal.len(), 1);
        assert_eq!(report.exit.code, Some(21));
    }

    #[test]
    fn an_engine_that_stops_part_way_is_unfinished() {
        let world =
            World::new("echo '[t=1][f=30] [coilbox-unit-check] spawned probe_unit with 5 pieces'; kill -SEGV $$");
        let report = world.check().unwrap();

        assert_eq!(report.outcome, Outcome::Unfinished);
        assert_eq!(report.spawned_pieces, Some(5));
        assert_eq!(report.exit.signal, Some(11));
    }

    #[test]
    fn the_engine_is_given_the_check_game_on_top_of_the_content_folder() {
        let world = World::new(
            "printf '%s\\n' \"$@\" > \"$(dirname \"$0\")/../args\"; printf '%s' \"$SPRING_DATADIR\" > \"$(dirname \"$0\")/../datadir\"",
        );
        world.check().unwrap();
        let root = world.root();

        let args = std::fs::read_to_string(world.dir.path().join("args")).unwrap();
        let args: Vec<&str> = args.lines().collect();
        let script = root.join("script.txt");
        assert_eq!(args.last(), Some(&script.to_str().unwrap()));
        assert!(args.contains(&"--isolation"));
        assert!(args.contains(&root.join("write").to_str().unwrap()));
        let datadir = std::fs::read_to_string(world.dir.path().join("datadir")).unwrap();
        assert_eq!(
            datadir,
            format!(
                "{}:{}",
                root.join("data").display(),
                world.content.display()
            )
        );

        let game = root.join("data/games").join(FOLDER);
        let modinfo = std::fs::read_to_string(game.join("modinfo.lua")).unwrap();
        assert!(
            modinfo.contains("\"Coilbox unit test scratch\","),
            "{modinfo}"
        );
        assert_eq!(
            std::fs::read_to_string(game.join(GADGET_PATH)).unwrap(),
            GADGET
        );
        let request = std::fs::read_to_string(game.join(REQUEST_PATH)).unwrap();
        assert!(request.contains("unitName = \"probe_unit\""), "{request}");
        assert!(request.contains("spawnFrame = 30"), "{request}");
        assert!(request.contains("frames = 450"), "{request}");

        let script = std::fs::read_to_string(script).unwrap();
        assert!(
            script.contains("\tgametype=Coilbox unit check 1;\n"),
            "{script}"
        );
        assert!(
            script.contains("\tmapname=Small_Supreme_Battlefield_V3;\n"),
            "{script}"
        );
        assert_eq!(script.matches("side=Coilbox;").count(), 2, "{script}");
    }

    #[test]
    fn a_second_check_replaces_the_first_ones_request() {
        let world = World::new(GOOD_RUN);
        world.check().unwrap();
        let mut request = world.request();
        request.unit_name = "other_unit".into();
        run_check(&world.root(), &request, &RunControl::default()).unwrap();

        let written = std::fs::read_to_string(
            world
                .root()
                .join("data/games")
                .join(FOLDER)
                .join(REQUEST_PATH),
        )
        .unwrap();
        assert!(written.contains("unitName = \"other_unit\""), "{written}");
    }

    #[test]
    fn an_engine_with_no_headless_binary_is_refused_in_words() {
        let world = World::new(GOOD_RUN);
        std::fs::remove_file(&world.engine).unwrap();

        let refused = world.check().unwrap_err();
        assert!(refused.starts_with("No headless engine in "), "{refused}");
    }

    #[test]
    fn an_engine_with_no_base_content_is_refused_in_words() {
        let world = World::new(GOOD_RUN);
        std::fs::remove_dir(world.engine.parent().unwrap().join("base")).unwrap();

        let refused = world.check().unwrap_err();
        assert!(refused.contains("has no base content"), "{refused}");

        // Base content in the content folder is enough, as it is for the
        // mission harness.
        std::fs::create_dir_all(world.content.join("base")).unwrap();
        assert!(world.check().is_ok());
    }

    #[test]
    fn a_name_that_would_break_the_start_script_is_refused() {
        let world = World::new(GOOD_RUN);
        let mut request = world.request();
        request.map = "Evil;}[game]".into();

        assert!(run_check(&world.root(), &request, &RunControl::default()).is_err());
        assert!(!world.root().join("script.txt").exists());
    }

    #[test]
    fn a_check_is_allowed_the_start_up_allowance_and_its_frames_at_normal_speed() {
        assert_eq!(
            run_timeout(30, 450),
            START_UP_ALLOWANCE + Duration::from_secs(16)
        );
    }

    /// The whole check against a real engine, a real game and a scratch game
    /// already written, which is what the builder's Test drawer writes.
    ///
    /// Reads what to run from the environment and does nothing without it:
    ///
    /// - `COILBOX_UNIT_CHECK_ENGINE_DIR`: an engine folder with
    ///   `spring-headless` and base content.
    /// - `COILBOX_UNIT_CHECK_CONTENT_DIRS`: the content folders, the one
    ///   holding the scratch game first, separated the way `SPRING_DATADIR` is.
    /// - `COILBOX_UNIT_CHECK_GAME`, `COILBOX_UNIT_CHECK_MAP` and
    ///   `COILBOX_UNIT_CHECK_UNIT`: the scratch game's name, the map's and the
    ///   unit's.
    /// - `COILBOX_UNIT_CHECK_ROOT`: the folder to run in, kept afterwards.
    /// - `COILBOX_UNIT_CHECK_EXPECT`: the outcome expected, in the report's
    ///   spelling. Default `loaded`.
    #[test]
    #[ignore = "needs an engine, a game, a map and a scratch game holding a unit"]
    fn a_real_engine_checks_a_real_unit() {
        let var = |name: &str| std::env::var(name).ok().filter(|v| !v.is_empty());
        let (Some(engine), Some(content), Some(game), Some(map), Some(unit), Some(root)) = (
            var("COILBOX_UNIT_CHECK_ENGINE_DIR"),
            var("COILBOX_UNIT_CHECK_CONTENT_DIRS"),
            var("COILBOX_UNIT_CHECK_GAME"),
            var("COILBOX_UNIT_CHECK_MAP"),
            var("COILBOX_UNIT_CHECK_UNIT"),
            var("COILBOX_UNIT_CHECK_ROOT"),
        ) else {
            eprintln!(
                "did nothing: set COILBOX_UNIT_CHECK_ENGINE_DIR, COILBOX_UNIT_CHECK_CONTENT_DIRS, \
                 COILBOX_UNIT_CHECK_GAME, COILBOX_UNIT_CHECK_MAP, COILBOX_UNIT_CHECK_UNIT and \
                 COILBOX_UNIT_CHECK_ROOT to run it"
            );
            return;
        };
        let expect = var("COILBOX_UNIT_CHECK_EXPECT").unwrap_or_else(|| "loaded".into());
        let request = CheckRequest {
            engine_dir: PathBuf::from(engine),
            content_dirs: content
                .split(coilbox_proc::DATADIR_SEP)
                .map(PathBuf::from)
                .collect(),
            game,
            map,
            unit_name: unit,
            spawn_frame: 30,
            frames: 450,
        };
        let report = run_check(Path::new(&root), &request, &RunControl::default()).unwrap();
        let json = serde_json::to_string_pretty(&report).unwrap();
        std::fs::write(Path::new(&root).join("report.json"), &json).unwrap();
        eprintln!("{json}");
        assert_eq!(
            serde_json::to_value(report.outcome).unwrap(),
            serde_json::Value::String(expect)
        );
    }
}
