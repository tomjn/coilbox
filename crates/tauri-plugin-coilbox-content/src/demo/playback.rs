//! The playback game: a generated game that shows a replay's recorded track
//! inside the engine, and the start script that launches it (issue #3793).
//!
//! It has the shape of the analysis game (`analysis/game.rs`) and the scenario
//! test mutator. A loose `.sdd` under the content root's `games/` holds a
//! `modinfo.lua` that depends on the game the replay was recorded on, the
//! rewind player's Lua and the replay's track. The base game is depended on and
//! never touched.
//!
//! Unlike the analysis game, this one is launched in a window for a person, from
//! a start script of its own and not from the replay. Nobody plays in it. The
//! script has one spectator and no players or AIs, and every team's
//! `teamleader` is that spectator, which the engine accepts and which lets a
//! gadget create units on any team (the findings in issue #3791). Team and ally
//! team numbers are the replay's own, so a team in the track is the same number
//! in the game. Nothing here names or counts the Gaia team: the engine adds it
//! and the Lua side reads it from the engine.
//!
//! `recorddemo=0` keeps the engine from writing a replay of the playback, which
//! would otherwise fill the replay library with matches nobody played.
//!
//! The folder is cleared and written again on every launch, so only one exists
//! and a file an earlier launch wrote cannot outlive the code that wrote it.
//! The Lua it carries is whatever is under `lua/rewind-player/luarules/` and
//! `luaui/` when coilbox is built. `build.rs` lists those files, so the gadget
//! (#3794) and the timeline widget (#3798) are added by adding files there.

use std::path::{Path, PathBuf};

use picoframe_core::CliResult;
use tauri::{ipc::Channel, AppHandle, Runtime};
use tauri_plugin_coilbox_play::LaunchEvent;

use super::analysis::game::lua_string;
use super::analysis::store;
use super::track_store::{self, TrackState};
use super::{find_game, index_suffix, parse_tdf, read_header_and_script, Section};

include!(concat!(env!("OUT_DIR"), "/rewind_player_files.rs"));

/// The game's folder name under a content root's `games/`.
pub const FOLDER: &str = "coilbox-replay-playback.sdd";

const NAME: &str = "Coilbox replay playback";
const VERSION: &str = "1";

/// Where the track sits in the game. The reader's `Fetch.PATH` is the same
/// string, and a test holds the two together.
pub const TRACK_PATH: &str = "coilbox_rewind/track.cbtrack";

/// The one spectator's name, and the name the script gives as the local player.
const SPECTATOR: &str = "Coilbox playback";

/// The file the start script is written to, in the app's `play` folder.
const SCRIPT_FILE: &str = "replay-playback.txt";

/// What a start script has to name to launch the playback game. The engine
/// builds an archive's name as its `name`, a space, and its `version`.
pub fn gametype() -> String {
    format!("{NAME} {VERSION}")
}

/// The playback game's `modinfo.lua`, depending on `base_game`, which is the
/// `gametype` the replay was recorded with, and carrying `short_name`, which is
/// the base game's own so that a gadget branching on it behaves as it did.
pub fn modinfo(base_game: &str, short_name: &str) -> String {
    let description = format!("A recorded match of {base_game}, played back from its track.");
    [
        "-- The game coilbox plays a replay's recorded track in.".to_string(),
        "-- Written for one launch and replaced by the next.".to_string(),
        String::new(),
        "return {".to_string(),
        format!("  name = {},", lua_string(NAME)),
        format!("  shortname = {},", lua_string(short_name)),
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

/// The children of `section` named `prefix` and a number, in number order.
fn numbered<'a>(section: &'a Section, prefix: &str) -> Vec<(i32, &'a Section)> {
    let mut found: Vec<(i32, &Section)> = section
        .children
        .iter()
        .filter_map(|(name, child)| Some((index_suffix(name, prefix)?, child)))
        .collect();
    found.sort_by_key(|(index, _)| *index);
    found
}

/// How many of something the script declares: what the replay says, and never
/// fewer than its numbered sections need.
fn declared(game: &Section, key: &str, sections: &[(i32, &Section)]) -> i32 {
    let needed = sections.last().map_or(0, |(index, _)| index + 1);
    game.get(key)
        .and_then(|value| value.parse::<i32>().ok())
        .unwrap_or(0)
        .max(needed)
}

/// Write `section` as a TDF block called `name`, with its keys in alphabetical
/// order so the same replay always gives the same script. `skip` names keys to
/// leave out and `extra` ones to add.
fn write_section(
    out: &mut String,
    name: &str,
    section: &Section,
    skip: &[&str],
    extra: &[(&str, &str)],
) {
    out.push_str(&format!("\t[{name}]\n\t{{\n"));
    let mut keys: Vec<(&str, &str)> = section
        .keys
        .iter()
        .filter(|(key, _)| !skip.contains(&key.as_str()))
        .map(|(key, value)| (key.as_str(), value.as_str()))
        .collect();
    keys.extend_from_slice(extra);
    keys.sort();
    for (key, value) in keys {
        out.push_str(&format!("\t\t{key}={value};\n"));
    }
    for (child, body) in &section.children {
        write_nested(out, child, body, 2);
    }
    out.push_str("\t}\n");
}

/// A section inside a section, which a start script uses for a map option's
/// own table or a restriction list.
fn write_nested(out: &mut String, name: &str, section: &Section, depth: usize) {
    let pad = "\t".repeat(depth);
    out.push_str(&format!("{pad}[{name}]\n{pad}{{\n"));
    let mut keys: Vec<(&String, &String)> = section.keys.iter().collect();
    keys.sort();
    for (key, value) in keys {
        out.push_str(&format!("{pad}\t{key}={value};\n"));
    }
    for (child, body) in &section.children {
        write_nested(out, child, body, depth + 1);
    }
    out.push_str(&format!("{pad}}}\n"));
}

/// Whether a section of the replay's `[game]` is one of the kinds this script
/// replaces: the people and the AIs, and the teams and ally teams that are
/// written out one by one.
fn is_rebuilt(name: &str) -> bool {
    ["player", "ai", "team", "allyteam"]
        .iter()
        .any(|prefix| index_suffix(name, prefix).is_some())
}

/// The start script that launches the playback game, made from the start script
/// of the replay.
///
/// What it takes from the replay: the map, the teams and ally teams with every
/// key they have, and the mod options, map options and any other section that
/// is not a player or an AI. What it drops: the players, the AIs and each
/// team's `luaai`, because nobody plays and no team is controlled. Every team's
/// `teamleader` becomes the one spectator.
pub fn start_script(replay_script: &str) -> Result<String, String> {
    let game = find_game(&parse_tdf(replay_script));
    let map = game
        .get("mapname")
        .filter(|map| !map.is_empty())
        .ok_or("the replay names no map")?;
    let teams = numbered(&game, "team");
    if teams.is_empty() {
        return Err("the replay's start script has no teams".into());
    }
    let ally_teams = numbered(&game, "allyteam");

    let mut out = String::from("[game]\n{\n");
    let top: [(&str, String); 10] = [
        ("ishost", "1".into()),
        ("numplayers", "1".into()),
        ("numusers", "1".into()),
        ("numteams", declared(&game, "numteams", &teams).to_string()),
        (
            "numallyteams",
            declared(&game, "numallyteams", &ally_teams).to_string(),
        ),
        // Nobody can choose a start position, so the one the script or the
        // map gives is used.
        ("startpostype", "1".into()),
        ("recorddemo", "0".into()),
        ("gametype", gametype()),
        ("mapname", map.to_string()),
        ("myplayername", SPECTATOR.into()),
    ];
    for (key, value) in top {
        out.push_str(&format!("\t{key}={value};\n"));
    }
    out.push_str(&format!(
        "\t[player0]\n\t{{\n\t\tname={SPECTATOR};\n\t\tspectator=1;\n\t}}\n"
    ));
    for (index, team) in &teams {
        write_section(
            &mut out,
            &format!("team{index}"),
            team,
            &["teamleader", "luaai"],
            &[("teamleader", "0")],
        );
    }
    for (index, ally_team) in &ally_teams {
        write_section(&mut out, &format!("allyteam{index}"), ally_team, &[], &[]);
    }
    for (name, section) in &game.children {
        if !is_rebuilt(name) {
            write_section(&mut out, name, section, &[], &[]);
        }
    }
    out.push_str("}\n");
    Ok(out)
}

/// How the track got into the game folder.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Placed {
    /// A hard link, so the track takes no more room on disk.
    Linked,
    /// A copy, because the filesystem refused a link.
    Copied,
}

/// Put `track` at `to`, as a hard link and by copying where `link` refuses.
/// A link is refused across filesystems and on some that cannot make one.
fn link_or_copy(
    track: &Path,
    to: &Path,
    link: impl FnOnce(&Path, &Path) -> std::io::Result<()>,
) -> Result<Placed, String> {
    if let Some(parent) = to.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("could not create {}: {e}", parent.display()))?;
    }
    if link(track, to).is_ok() {
        return Ok(Placed::Linked);
    }
    // A refused link can leave nothing, but a partial file would be read as
    // the track.
    let _ = std::fs::remove_file(to);
    std::fs::copy(track, to)
        .map(|_| Placed::Copied)
        .map_err(|e| format!("could not copy the track to {}: {e}", to.display()))
}

/// The playback game's folder under a content root.
pub fn game_dir(content_root: &Path) -> Result<PathBuf, String> {
    if !content_root.is_absolute() || !content_root.is_dir() {
        return Err(format!("not a content root: {}", content_root.display()));
    }
    Ok(content_root.join("games").join(FOLDER))
}

/// Write the playback game under `content_root/games/`, replacing whatever an
/// earlier launch left, and return its folder and how the track was placed.
///
/// `base_game` is the game to depend on and `short_name` its short name.
/// `track` is the stored `.cbtrack`, which is read and never written.
pub fn write_game(
    content_root: &Path,
    base_game: &str,
    short_name: &str,
    track: &Path,
) -> Result<(PathBuf, Placed), String> {
    write_game_with(content_root, base_game, short_name, track, |from, to| {
        std::fs::hard_link(from, to)
    })
}

fn write_game_with(
    content_root: &Path,
    base_game: &str,
    short_name: &str,
    track: &Path,
    link: impl FnOnce(&Path, &Path) -> std::io::Result<()>,
) -> Result<(PathBuf, Placed), String> {
    if base_game.trim().is_empty() {
        return Err("the replay names no game to depend on".into());
    }
    let dir = game_dir(content_root)?;
    match std::fs::remove_dir_all(&dir) {
        Ok(()) => {}
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
        Err(e) => return Err(format!("could not clear {}: {e}", dir.display())),
    }
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("could not create {}: {e}", dir.display()))?;
    let write = |rel: &str, contents: &str| {
        let target = dir.join(rel);
        if let Some(parent) = target.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("could not create {}: {e}", parent.display()))?;
        }
        std::fs::write(&target, contents)
            .map_err(|e| format!("could not write {}: {e}", target.display()))
    };
    write("modinfo.lua", &modinfo(base_game, short_name))?;
    for (rel, contents) in REWIND_PLAYER_FILES {
        write(rel, contents)?;
    }
    let placed = link_or_copy(track, &dir.join(TRACK_PATH), link)?;
    Ok((dir, placed))
}

/// What a launch needs written before the engine starts.
pub struct Prepare<'a> {
    pub replay: &'a Path,
    /// The track store's folder. See [`track_store`].
    pub tracks: &'a Path,
    /// The content root the game is written under.
    pub content_root: &'a Path,
    /// Another installed version of the replay's game to depend on, when the
    /// exact one is not installed.
    pub game: Option<&'a str>,
    /// Where the start script goes.
    pub script_dir: &'a Path,
}

/// Write the playback game and its start script for a replay, and return the
/// script's path. Refuses a replay with no current track, a remix (which has
/// no track of its own) and a replay of the playback game itself.
///
/// `short_name` answers the short name of a game, which only the engine's
/// archive scan knows.
pub fn prepare(
    request: &Prepare,
    short_name: impl FnOnce(&str) -> Result<String, String>,
) -> Result<PathBuf, String> {
    let game_id = store::replay_key(request.replay)?;
    let raw = read_header_and_script(request.replay)?;
    let recorded = find_game(&parse_tdf(&raw.script))
        .get("gametype")
        .unwrap_or("")
        .to_string();
    if recorded == gametype() {
        return Err(
            "this replay was recorded on the playback game, which has nothing of its own to show"
                .into(),
        );
    }
    match track_store::state(request.tracks, &game_id)? {
        Some(TrackState::Current) => {}
        Some(TrackState::Stale) => {
            return Err("this replay's track was made by another version of the recorder, so it has to be recorded again".into());
        }
        None => return Err("this replay has no track yet, so it has to be recorded first".into()),
    }
    let script = start_script(&raw.script)?;
    let base_game = request
        .game
        .map(str::trim)
        .filter(|game| !game.is_empty())
        .map_or(recorded, str::to_string);
    let short = short_name(&base_game)
        .map_err(|e| format!("could not read the short name of {base_game}: {e}"))?;
    write_game(
        request.content_root,
        &base_game,
        &short,
        &track_store::track_path(request.tracks, &game_id)?,
    )?;
    std::fs::create_dir_all(request.script_dir)
        .map_err(|e| format!("could not create {}: {e}", request.script_dir.display()))?;
    let path = request.script_dir.join(SCRIPT_FILE);
    std::fs::write(&path, script)
        .map_err(|e| format!("could not write {}: {e}", path.display()))?;
    // Playing a track is watching it, so a disk budget removes it last. The
    // launch does not depend on it.
    let _ = track_store::mark_watched(request.tracks, &game_id);
    Ok(path)
}

/// `content_replay_playback_launch`: write the playback game and its start
/// script for a replay and launch the engine on it (issue #3793). Resolves when
/// the engine exits, as `play_launch_replay` does, with `{ exitCode, signal }`.
///
/// `replayPath` is a `ReplayFile.path`. `executable` is the engine the replay
/// was recorded on, resolved the way a replay launch resolves it, and `dataDir`
/// the content folder it plays from, which the game is written under.
/// `runId` and `onEvent` are the play launch's: the run goes in the same
/// registry, so it is refused while any game is running, and `play_cancel`
/// ends it. `game` names another installed version of the replay's game to
/// depend on when the exact one is not installed.
///
/// It rejects, with the reason, for a replay with no current track, a remix, a
/// replay of the playback game and an engine that is not there. The game folder
/// is not touched while another game is running.
#[tauri::command]
pub(crate) async fn content_replay_playback_launch<R: Runtime>(
    app: AppHandle<R>,
    replay_path: String,
    executable: String,
    data_dir: String,
    run_id: String,
    on_event: Channel<LaunchEvent>,
    game: Option<String>,
) -> CliResult {
    let tracks = match track_store::app_store_dir(&app) {
        Ok(dir) => dir,
        Err(e) => return CliResult::err(e),
    };
    let script_dir = match coilbox_portable::data_dir(&app) {
        Ok(dir) => dir.join("play"),
        Err(e) => return CliResult::err(e),
    };
    let engine_dir = Path::new(&executable)
        .parent()
        .map(|dir| dir.to_string_lossy().into_owned())
        .unwrap_or_default();
    let datadirs = coilbox_proc::spring_datadir(&data_dir);
    let content_root = PathBuf::from(&data_dir);
    tauri_plugin_coilbox_play::launch_prepared(
        &app,
        executable,
        data_dir,
        run_id,
        on_event,
        move || {
            prepare(
                &Prepare {
                    replay: Path::new(&replay_path),
                    tracks: &tracks,
                    content_root: &content_root,
                    game: game.as_deref(),
                    script_dir: &script_dir,
                },
                |base| {
                    tauri_plugin_coilbox_unitsync::game_short_name_blocking(
                        &engine_dir,
                        &datadirs,
                        base,
                    )
                },
            )
        },
    )
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The start script of a replay the engine recorded on 2026-08-23, a
    /// Splinter Faction match against an AI. Team 1 is changed to have a Lua AI
    /// and a start position, and the lobby's address and start position type
    /// are added, so each of those has something to be tested against. The
    /// sections are in the order the engine wrote them, which is not numeric.
    const REPLAY_SCRIPT: &str = "[game]\n{\n\
        [allyteam1]\n{\nnumallies=0;\nstartrectleft=0.5;\n}\n\
        [team0]\n{\nallyteam=0;\nteamleader=0;\nrgbcolor=0.9 0.24 0.2;\nside=Federation of Kala;\nhandicap=0;\n}\n\
        [allyteam0]\n{\nnumallies=0;\n}\n\
        [modoptions]\n{\nminspeed=1;\ndeathmode=com;\nstartmetal=1000;\nt0ort1=t1;\n}\n\
        [player0]\n{\nteam=0;\nspectator=0;\nname=You;\n}\n\
        [ai0]\n{\nteam=1;\nhost=0;\nversion=<game>;\nname=SurvivalAI;\nshortname=Sandbox;\n}\n\
        [mapoptions]\n{\ndry=0;\n}\n\
        [team1]\n{\nallyteam=1;\nteamleader=0;\nrgbcolor=0.015686275 0.2 1;\nside=Loz Alliance;\nluaai=Scavengers;\nstartposx=1200;\nstartposz=3400;\n}\n\
        ishost=1;\nnumallyteams=2;\nnumteams=2;\nstartpostype=2;\n\
        gametype=SplinterFaction $VERSION;\nmapname=All That Glitters v2.2.3;\n\
        myplayername=You;\nnumplayers=1;\nhostip=127.0.0.1;\nhostport=8452;\n}\n";

    fn parsed(script: &str) -> Section {
        find_game(&parse_tdf(script))
    }

    fn names(section: &Section) -> Vec<&str> {
        section.children.iter().map(|(n, _)| n.as_str()).collect()
    }

    #[test]
    fn the_script_has_one_spectator_and_no_players_or_ais() {
        let game = parsed(&start_script(REPLAY_SCRIPT).unwrap());

        let players = numbered(&game, "player");
        assert_eq!(players.len(), 1);
        assert_eq!(players[0].1.get("spectator"), Some("1"));
        assert_eq!(players[0].1.get("name"), Some(SPECTATOR));
        assert_eq!(game.get("myplayername"), Some(SPECTATOR));
        assert_eq!(game.get("numplayers"), Some("1"));
        assert!(numbered(&game, "ai").is_empty());
        assert!(!names(&game).iter().any(|n| n.starts_with("ai")));
    }

    #[test]
    fn every_team_is_led_by_the_spectator_and_has_no_ai() {
        let game = parsed(&start_script(REPLAY_SCRIPT).unwrap());

        for (index, team) in numbered(&game, "team") {
            assert_eq!(team.get("teamleader"), Some("0"), "team {index}");
            assert_eq!(team.get("luaai"), None, "team {index}");
        }
    }

    #[test]
    fn team_numbers_and_ally_teams_are_the_replays_own() {
        let game = parsed(&start_script(REPLAY_SCRIPT).unwrap());

        let teams = numbered(&game, "team");
        assert_eq!(
            teams.iter().map(|(i, _)| *i).collect::<Vec<_>>(),
            vec![0, 1]
        );
        assert_eq!(teams[0].1.get("allyteam"), Some("0"));
        assert_eq!(teams[1].1.get("allyteam"), Some("1"));
        assert_eq!(game.get("numteams"), Some("2"));
        assert_eq!(game.get("numallyteams"), Some("2"));
        let allies = numbered(&game, "allyteam");
        assert_eq!(allies.len(), 2);
        assert_eq!(allies[1].1.get("startrectleft"), Some("0.5"));
    }

    /// A game with gaps in its team numbers, which a replay of a match with
    /// teams that were removed has. No team moves and none is added.
    #[test]
    fn a_gap_in_the_team_numbers_stays_a_gap() {
        let script = "[game]\n{\nmapname=M;\ngametype=G 1;\nnumteams=4;\nnumallyteams=3;\n\
            [team0]\n{\nallyteam=0;\nteamleader=0;\n}\n\
            [team3]\n{\nallyteam=2;\nteamleader=2;\n}\n\
            [allyteam0]\n{\nnumallies=0;\n}\n[allyteam2]\n{\nnumallies=0;\n}\n}\n";
        let game = parsed(&start_script(script).unwrap());

        assert_eq!(
            numbered(&game, "team")
                .iter()
                .map(|(i, _)| *i)
                .collect::<Vec<_>>(),
            vec![0, 3]
        );
        assert_eq!(game.get("numteams"), Some("4"));
        assert_eq!(game.get("numallyteams"), Some("3"));
        assert_eq!(
            numbered(&game, "allyteam")
                .iter()
                .map(|(i, _)| *i)
                .collect::<Vec<_>>(),
            vec![0, 2]
        );
    }

    /// A replay that under-declares its teams would give the engine a script
    /// with a team past `numteams`.
    #[test]
    fn the_counts_never_fall_below_the_sections_that_are_there() {
        let script = "[game]\n{\nmapname=M;\ngametype=G 1;\nnumteams=1;\n\
            [team0]\n{\nallyteam=0;\n}\n[team1]\n{\nallyteam=1;\n}\n}\n";
        let game = parsed(&start_script(script).unwrap());

        assert_eq!(game.get("numteams"), Some("2"));
    }

    #[test]
    fn colours_sides_and_start_positions_carry_over() {
        let game = parsed(&start_script(REPLAY_SCRIPT).unwrap());
        let teams = numbered(&game, "team");

        assert_eq!(teams[0].1.get("rgbcolor"), Some("0.9 0.24 0.2"));
        assert_eq!(teams[0].1.get("side"), Some("Federation of Kala"));
        assert_eq!(teams[0].1.get("handicap"), Some("0"));
        assert_eq!(teams[1].1.get("rgbcolor"), Some("0.015686275 0.2 1"));
        assert_eq!(teams[1].1.get("startposx"), Some("1200"));
        assert_eq!(teams[1].1.get("startposz"), Some("3400"));
    }

    #[test]
    fn mod_options_and_map_options_carry_over() {
        let original = parsed(REPLAY_SCRIPT);
        let game = parsed(&start_script(REPLAY_SCRIPT).unwrap());

        for section in ["modoptions", "mapoptions"] {
            let before = original.child(section).unwrap();
            let after = game.child(section).unwrap();
            assert_eq!(before.keys, after.keys, "{section}");
        }
        assert_eq!(
            game.child("modoptions").unwrap().get("deathmode"),
            Some("com")
        );
        assert_eq!(game.child("mapoptions").unwrap().get("dry"), Some("0"));
    }

    #[test]
    fn the_game_and_map_are_named_and_no_demo_is_recorded() {
        let game = parsed(&start_script(REPLAY_SCRIPT).unwrap());

        assert_eq!(game.get("gametype"), Some("Coilbox replay playback 1"));
        assert_eq!(game.get("mapname"), Some("All That Glitters v2.2.3"));
        assert_eq!(game.get("recorddemo"), Some("0"));
        assert_eq!(game.get("ishost"), Some("1"));
    }

    /// The replay chose start positions in the lobby (type 2). Nobody can in
    /// the playback, so it takes the fixed type the spike ran with.
    #[test]
    fn nobody_is_asked_for_a_start_position() {
        let game = parsed(&start_script(REPLAY_SCRIPT).unwrap());

        assert_eq!(game.get("startpostype"), Some("1"));
    }

    /// The replay's address is not the playback's.
    #[test]
    fn the_replays_network_keys_are_not_carried() {
        let script = start_script(REPLAY_SCRIPT).unwrap();

        assert!(!script.contains("hostip"), "{script}");
        assert!(!script.contains("hostport"), "{script}");
    }

    #[test]
    fn the_same_replay_gives_the_same_script() {
        assert_eq!(
            start_script(REPLAY_SCRIPT).unwrap(),
            start_script(REPLAY_SCRIPT).unwrap()
        );
    }

    /// The script is read by the engine's own parser, so the shape has to be
    /// the one the spike ran: a `[game]` block with sections inside it.
    #[test]
    fn the_script_is_a_game_block() {
        let script = start_script(REPLAY_SCRIPT).unwrap();

        assert!(script.starts_with("[game]\n{\n"), "{script}");
        assert!(script.ends_with("}\n"), "{script}");
    }

    #[test]
    fn nothing_assumes_where_gaia_is() {
        let script = start_script(REPLAY_SCRIPT).unwrap();

        assert!(!script.to_lowercase().contains("gaia"), "{script}");
        assert_eq!(parsed(&script).get("numteams"), Some("2"));
    }

    #[test]
    fn a_replay_with_no_map_or_no_teams_gives_no_script() {
        assert!(start_script("[game]\n{\n[team0]\n{\nallyteam=0;\n}\n}\n").is_err());
        assert!(start_script("[game]\n{\nmapname=M;\n}\n").is_err());
        assert!(start_script("").is_err());
    }

    /// Tables inside a section survive, such as a restriction list.
    #[test]
    fn a_table_inside_a_section_is_kept() {
        let script = "[game]\n{\nmapname=M;\n[team0]\n{\nallyteam=0;\n}\n\
            [restrict]\n{\n[unit0]\n{\nunitname=armcom;\nlimit=0;\n}\n}\n}\n";
        let game = parsed(&start_script(script).unwrap());

        let unit = game.child("restrict").unwrap().child("unit0").unwrap();
        assert_eq!(unit.get("unitname"), Some("armcom"));
        assert_eq!(unit.get("limit"), Some("0"));
    }

    // ---- the game folder -------------------------------------------------

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

    fn a_track(dir: &Path, contents: &str) -> PathBuf {
        let path = dir.join("stored.cbtrack");
        std::fs::write(&path, contents).unwrap();
        path
    }

    #[test]
    fn the_folder_is_coilboxs_own_and_loose() {
        assert!(FOLDER.starts_with("coilbox-"));
        assert!(FOLDER.ends_with(".sdd"));
        assert!(!FOLDER.contains(".."));
        assert!(FOLDER
            .chars()
            .all(|c| c.is_ascii_lowercase() || c == '-' || c == '.'));
    }

    #[test]
    fn the_game_is_the_modinfo_the_player_and_the_track_and_no_definitions() {
        let root = tempfile::tempdir().unwrap();
        let track = a_track(root.path(), "track");
        let (dir, _) = write_game(root.path(), "Some Game 1.0", "some_game", &track).unwrap();

        assert_eq!(dir, root.path().join("games").join(FOLDER));
        let written = files(&dir);
        for expected in [
            "modinfo.lua",
            "coilbox_rewind/track.cbtrack",
            "luarules/gadgets/coilbox_rewind_player.lua",
            "luarules/rewind_player/coilbox_track.lua",
            "luarules/rewind_player/coilbox_track_fetch.lua",
        ] {
            assert!(written.iter().any(|f| f == expected), "{expected}");
        }
        // A depending archive mounts above its base, so a definition here
        // would join the base game's and move the ids the track is keyed by.
        for kind in ["units/", "weapons/", "features/", "gamedata/", "unitpics/"] {
            assert!(
                !written.iter().any(|f| f.starts_with(kind)),
                "{kind} in {written:?}"
            );
        }
        // The recorder is for the analysis game only.
        assert!(!written.iter().any(|f| f.contains("recorder")));
    }

    #[test]
    fn what_is_written_is_what_the_repository_holds() {
        let root = tempfile::tempdir().unwrap();
        let track = a_track(root.path(), "track");
        let (dir, _) = write_game(root.path(), "Some Game 1.0", "some_game", &track).unwrap();

        for (rel, contents) in REWIND_PLAYER_FILES {
            assert_eq!(&std::fs::read_to_string(dir.join(rel)).unwrap(), contents);
        }
        let gadget =
            std::fs::read_to_string(dir.join("luarules/gadgets/coilbox_rewind_player.lua"))
                .unwrap();
        assert!(gadget.contains("Coilbox rewind player"));
        // Only Lua the engine loads. The README and the tests stay out.
        assert!(REWIND_PLAYER_FILES
            .iter()
            .all(|(rel, _)| rel.ends_with(".lua")
                && (rel.starts_with("luarules/") || rel.starts_with("luaui/"))));
    }

    /// The reader asks for the track at a path of its own, and this side puts
    /// it there. The two are held together here.
    #[test]
    fn the_track_sits_where_the_reader_looks() {
        let fetch = REWIND_PLAYER_FILES
            .iter()
            .find(|(rel, _)| *rel == "luarules/rewind_player/coilbox_track_fetch.lua")
            .expect("the reader is shipped")
            .1;

        assert!(fetch.contains(&format!("M.PATH = \"{TRACK_PATH}\"")));
    }

    #[test]
    fn the_modinfo_depends_on_the_game_the_replay_was_recorded_on() {
        let text = modinfo("SplinterFaction $VERSION", "SF");

        assert!(text.contains("depend = {\n    \"SplinterFaction $VERSION\",\n  },"));
        assert!(text.contains("modtype = 1,"));
        assert!(text.contains("shortname = \"SF\","));
        assert!(text.contains("name = \"Coilbox replay playback\","));
        assert!(text.contains("version = \"1\","));
    }

    #[test]
    fn the_gametype_is_the_name_the_engine_gives_the_archive() {
        assert_eq!(gametype(), "Coilbox replay playback 1");
        assert!(modinfo("x", "x").contains(&format!("name = \"{NAME}\"")));
    }

    #[test]
    fn a_game_name_with_a_quote_in_it_cannot_end_the_string() {
        let text = modinfo("Odd \"Game\" \\ 2", "x");

        assert!(text.contains("    \"Odd \\\"Game\\\" \\\\ 2\","));
    }

    #[cfg(unix)]
    #[test]
    fn the_track_is_hard_linked_and_takes_no_room_of_its_own() {
        use std::os::unix::fs::MetadataExt;
        let root = tempfile::tempdir().unwrap();
        let track = a_track(root.path(), "the track");
        let (dir, placed) = write_game(root.path(), "G 1", "g", &track).unwrap();

        assert_eq!(placed, Placed::Linked);
        let inside = dir.join(TRACK_PATH);
        assert_eq!(std::fs::read_to_string(&inside).unwrap(), "the track");
        assert_eq!(
            std::fs::metadata(&inside).unwrap().ino(),
            std::fs::metadata(&track).unwrap().ino()
        );
        assert_eq!(std::fs::metadata(&track).unwrap().nlink(), 2);
    }

    #[test]
    fn a_refused_link_falls_back_to_a_copy() {
        let root = tempfile::tempdir().unwrap();
        let track = a_track(root.path(), "the track");
        let (dir, placed) = write_game_with(root.path(), "G 1", "g", &track, |_, _| {
            Err(std::io::Error::other("cross-device link"))
        })
        .unwrap();

        assert_eq!(placed, Placed::Copied);
        assert_eq!(
            std::fs::read_to_string(dir.join(TRACK_PATH)).unwrap(),
            "the track"
        );
        // Still a separate file: removing the copy leaves the stored track.
        std::fs::remove_file(dir.join(TRACK_PATH)).unwrap();
        assert!(track.exists());
    }

    /// A link that fails after it made a file would leave something the player
    /// reads as the track.
    #[test]
    fn a_link_that_left_a_partial_file_is_replaced_by_the_copy() {
        let root = tempfile::tempdir().unwrap();
        let track = a_track(root.path(), "the whole track");
        let (dir, placed) = write_game_with(root.path(), "G 1", "g", &track, |_, to| {
            std::fs::write(to, "part")?;
            Err(std::io::Error::other("refused"))
        })
        .unwrap();

        assert_eq!(placed, Placed::Copied);
        assert_eq!(
            std::fs::read_to_string(dir.join(TRACK_PATH)).unwrap(),
            "the whole track"
        );
    }

    #[test]
    fn a_track_that_is_not_there_is_an_error() {
        let root = tempfile::tempdir().unwrap();

        let err = write_game(root.path(), "G 1", "g", &root.path().join("none")).unwrap_err();
        assert!(err.contains("could not copy the track"), "{err}");
    }

    /// Every launch starts from nothing: a file an earlier launch wrote that
    /// this one does not is gone, and the track is the new one.
    #[test]
    fn the_game_is_cleared_and_written_again_on_every_launch() {
        let root = tempfile::tempdir().unwrap();
        let first = a_track(root.path(), "first track");
        let (dir, _) = write_game(root.path(), "Old Game 1", "old", &first).unwrap();
        std::fs::write(dir.join("stale.lua"), "left behind").unwrap();
        std::fs::create_dir_all(dir.join("units")).unwrap();
        std::fs::write(dir.join("units/stale.lua"), "left behind").unwrap();
        let second = root.path().join("second.cbtrack");
        std::fs::write(&second, "second track").unwrap();

        let (again, _) = write_game(root.path(), "New Game 2", "new", &second).unwrap();

        assert_eq!(again, dir);
        assert!(!dir.join("stale.lua").exists());
        assert!(!dir.join("units").exists());
        assert_eq!(
            std::fs::read_to_string(dir.join(TRACK_PATH)).unwrap(),
            "second track"
        );
        let modinfo = std::fs::read_to_string(dir.join("modinfo.lua")).unwrap();
        assert!(modinfo.contains("New Game 2") && !modinfo.contains("Old Game 1"));
        // The first track is the stored one and is untouched by the clearing.
        assert_eq!(std::fs::read_to_string(&first).unwrap(), "first track");
    }

    #[test]
    fn a_replay_that_names_no_game_is_refused() {
        let root = tempfile::tempdir().unwrap();
        let track = a_track(root.path(), "t");

        assert!(write_game(root.path(), "  ", "x", &track).is_err());
        assert!(!root.path().join("games").exists());
    }

    #[test]
    fn a_content_root_that_is_not_there_is_an_error() {
        assert!(game_dir(Path::new("/no/such/content/root")).is_err());
        assert!(game_dir(Path::new("relative/path")).is_err());
    }

    // ---- preparing a launch ----------------------------------------------

    use super::super::tests::DemoFixture;
    use coilbox_track::{Settings, Track};
    use coilbox_track_thin::RECORDER_VERSION;

    const ID: &str = "00112233445566778899aabbccddeeff";

    fn id_bytes() -> [u8; 16] {
        let mut out = [0u8; 16];
        for (i, byte) in out.iter_mut().enumerate() {
            *byte = u8::from_str_radix(&ID[i * 2..i * 2 + 2], 16).unwrap();
        }
        out
    }

    struct World {
        _dir: tempfile::TempDir,
        replay: PathBuf,
        tracks: PathBuf,
        root: PathBuf,
        scripts: PathBuf,
    }

    impl World {
        fn new(script: &str) -> World {
            let dir = tempfile::tempdir().unwrap();
            let replay = dir.path().join("match.sdfz");
            let fixture = DemoFixture {
                script: script.into(),
                game_id: id_bytes(),
                ..Default::default()
            };
            std::fs::write(&replay, fixture.gzipped()).unwrap();
            let root = dir.path().join("content");
            std::fs::create_dir_all(&root).unwrap();
            World {
                tracks: dir.path().join("tracks"),
                scripts: dir.path().join("play"),
                replay,
                root,
                _dir: dir,
            }
        }

        /// Put a track for the replay in the store, made by the recorder
        /// version given. The store itself refuses one that is not current, so
        /// the file is written where the store keeps it.
        fn record(&self, recorder_version: u16) {
            let track = Track::new(Settings {
                recorder_version,
                game_id: id_bytes(),
                last_frame: 90,
                ..Settings::default()
            });
            std::fs::create_dir_all(&self.tracks).unwrap();
            std::fs::write(
                track_store::track_path(&self.tracks, ID).unwrap(),
                track.to_bytes().unwrap(),
            )
            .unwrap();
        }

        fn prepare(&self, game: Option<&str>) -> Result<PathBuf, String> {
            prepare(
                &Prepare {
                    replay: &self.replay,
                    tracks: &self.tracks,
                    content_root: &self.root,
                    game,
                    script_dir: &self.scripts,
                },
                |_| Ok("SHORT".to_string()),
            )
        }
    }

    #[test]
    fn a_replay_with_a_current_track_gets_a_game_and_a_script() {
        let world = World::new(REPLAY_SCRIPT);
        world.record(RECORDER_VERSION);

        let script = world.prepare(None).unwrap();

        assert_eq!(script, world.scripts.join(SCRIPT_FILE));
        let game = parsed(&std::fs::read_to_string(&script).unwrap());
        assert_eq!(game.get("gametype"), Some("Coilbox replay playback 1"));
        let dir = world.root.join("games").join(FOLDER);
        let modinfo = std::fs::read_to_string(dir.join("modinfo.lua")).unwrap();
        assert!(
            modinfo.contains("\"SplinterFaction $VERSION\""),
            "{modinfo}"
        );
        assert!(modinfo.contains("shortname = \"SHORT\""), "{modinfo}");
        assert_eq!(
            std::fs::read(dir.join(TRACK_PATH)).unwrap(),
            std::fs::read(track_store::track_path(&world.tracks, ID).unwrap()).unwrap()
        );
    }

    #[test]
    fn another_installed_version_of_the_game_can_stand_in() {
        let world = World::new(REPLAY_SCRIPT);
        world.record(RECORDER_VERSION);
        let asked = std::cell::RefCell::new(String::new());

        prepare(
            &Prepare {
                replay: &world.replay,
                tracks: &world.tracks,
                content_root: &world.root,
                game: Some(" SplinterFaction 0.1.89 "),
                script_dir: &world.scripts,
            },
            |game| {
                *asked.borrow_mut() = game.to_string();
                Ok("SF".into())
            },
        )
        .unwrap();

        assert_eq!(*asked.borrow(), "SplinterFaction 0.1.89");
        let modinfo =
            std::fs::read_to_string(world.root.join("games").join(FOLDER).join("modinfo.lua"))
                .unwrap();
        assert!(modinfo.contains("\"SplinterFaction 0.1.89\""), "{modinfo}");
    }

    #[test]
    fn a_replay_with_no_track_is_refused_and_nothing_is_written() {
        let world = World::new(REPLAY_SCRIPT);

        let err = world.prepare(None).unwrap_err();

        assert!(err.contains("no track"), "{err}");
        assert!(!world.root.join("games").exists());
        assert!(!world.scripts.exists());
    }

    #[test]
    fn a_stale_track_is_refused() {
        let world = World::new(REPLAY_SCRIPT);
        world.record(RECORDER_VERSION + 1);

        let err = world.prepare(None).unwrap_err();

        assert!(err.contains("another version of the recorder"), "{err}");
        assert!(!world.root.join("games").exists());
    }

    /// The game is not written when the short name cannot be read, because a
    /// game with the wrong short name plays a different match.
    #[test]
    fn a_short_name_that_cannot_be_read_stops_the_launch() {
        let world = World::new(REPLAY_SCRIPT);
        world.record(RECORDER_VERSION);

        let err = prepare(
            &Prepare {
                replay: &world.replay,
                tracks: &world.tracks,
                content_root: &world.root,
                game: None,
                script_dir: &world.scripts,
            },
            |_| Err("not installed".into()),
        )
        .unwrap_err();

        assert!(err.contains("could not read the short name"), "{err}");
        assert!(!world.root.join("games").exists());
    }

    #[test]
    fn a_replay_of_the_playback_game_is_refused() {
        let script = REPLAY_SCRIPT.replace("SplinterFaction $VERSION", &gametype());
        let world = World::new(&script);
        world.record(RECORDER_VERSION);

        let err = world.prepare(None).unwrap_err();

        assert!(err.contains("recorded on the playback game"), "{err}");
    }

    /// Playing a track is watching it.
    #[test]
    fn a_launch_marks_the_track_watched() {
        let world = World::new(REPLAY_SCRIPT);
        world.record(RECORDER_VERSION);
        let stored = track_store::track_path(&world.tracks, ID).unwrap();
        filetime::set_file_mtime(&stored, filetime::FileTime::from_unix_time(1_000_000, 0))
            .unwrap();

        world.prepare(None).unwrap();

        let modified = std::fs::metadata(&stored).unwrap().modified().unwrap();
        assert!(modified > std::time::UNIX_EPOCH + std::time::Duration::from_secs(1_000_000));
    }

    #[test]
    fn a_launch_replaces_the_game_an_earlier_one_wrote() {
        let world = World::new(REPLAY_SCRIPT);
        world.record(RECORDER_VERSION);
        world.prepare(None).unwrap();
        let dir = world.root.join("games").join(FOLDER);
        std::fs::write(dir.join("stale.lua"), "x").unwrap();

        world.prepare(None).unwrap();

        assert!(!dir.join("stale.lua").exists());
        assert!(dir.join(TRACK_PATH).exists());
    }
}
