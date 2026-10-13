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
include!(concat!(env!("OUT_DIR"), "/rewind_player_adapters.rs"));

pub(crate) mod adapter;

/// The game's folder name under a content root's `games/`.
pub const FOLDER: &str = "coilbox-replay-playback.sdd";

const NAME: &str = "Coilbox replay playback";
const VERSION: &str = "1";

/// Where the track sits in the game. The reader's `Fetch.PATH` is the same
/// string, and a test holds the two together.
pub const TRACK_PATH: &str = "coilbox_rewind/track.cbtrack";

/// The one spectator's name, and the name the script gives as the local player.
/// It has no space, because the engine's client replaces one with an underscore
/// when it connects, and the connection then matches no player in the script.
const SPECTATOR: &str = "CoilboxPlayback";

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

/// The mod option the player reads for the frame to open on.
const START_FRAME_OPTION: &str = "coilbox_rewind_start_frame";

/// The mod option the player reads for opening paused.
const START_PAUSED_OPTION: &str = "coilbox_rewind_start_paused";

/// Where the player opens. The default is the track's first frame, playing.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Opening {
    /// The frame to open on. The player holds it inside the track.
    pub frame: Option<u32>,
    /// Open on the player's own pause. The engine keeps running.
    pub paused: bool,
}

impl Opening {
    /// The mod options that say it, in the start script's `[modoptions]`.
    fn options(&self) -> Vec<(&'static str, String)> {
        let mut options = Vec::new();
        if let Some(frame) = self.frame {
            options.push((START_FRAME_OPTION, frame.to_string()));
        }
        if self.paused {
            options.push((START_PAUSED_OPTION, "1".to_string()));
        }
        options
    }
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
///
/// `opening` adds the player's two mod options. The replay's own values for
/// those keys are dropped whether or not `opening` sets them, since they are
/// the player's and a replay has no business moving where it opens.
pub fn start_script(replay_script: &str, opening: &Opening) -> Result<String, String> {
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
    let options = opening.options();
    let extra: Vec<(&str, &str)> = options.iter().map(|(k, v)| (*k, v.as_str())).collect();
    let skip = [START_FRAME_OPTION, START_PAUSED_OPTION];
    for (name, section) in &game.children {
        if name == "modoptions" {
            write_section(&mut out, name, section, &skip, &extra);
        } else if !is_rebuilt(name) {
            write_section(&mut out, name, section, &[], &[]);
        }
    }
    if !extra.is_empty() && game.child("modoptions").is_none() {
        write_section(&mut out, "modoptions", &Section::default(), &[], &extra);
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
/// `track` is the stored `.cbtrack`, which is read and never written. `chosen`
/// is the game's adapter: it is written at [`adapter::PATH`], and a file that
/// stands in for each gadget and widget it switches off is written over the
/// base game's, since a depending game's files take precedence.
pub fn write_game(
    content_root: &Path,
    base_game: &str,
    short_name: &str,
    track: &Path,
    chosen: &adapter::Chosen,
) -> Result<(PathBuf, Placed), String> {
    write_game_with(
        content_root,
        base_game,
        short_name,
        track,
        chosen,
        |from, to| std::fs::hard_link(from, to),
    )
}

fn write_game_with(
    content_root: &Path,
    base_game: &str,
    short_name: &str,
    track: &Path,
    chosen: &adapter::Chosen,
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
    write(adapter::PATH, &chosen.text)?;
    for rel in chosen.adapter.iter().flat_map(adapter::Adapter::shadows) {
        write(&rel, adapter::SHADOW)?;
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
    /// Where the player opens.
    pub opening: Opening,
    /// The adapters coilbox ships, as file names and sources. A launch passes
    /// [`REWIND_PLAYER_ADAPTERS`].
    pub adapters: &'a [(&'a str, &'a str)],
}

/// What a launch needs to know about the game the playback depends on.
pub struct BaseGame {
    /// The game's short name, which only the engine's archive scan knows.
    pub short_name: String,
    /// The game's version, when it declares one.
    pub version: Option<String>,
    /// The adapter the game holds at [`adapter::PATH`] in its own archive, when
    /// it holds one, or why it could not be read.
    pub own_adapter: Result<Option<String>, String>,
}

/// Write the playback game and its start script for a replay, and return the
/// script's path. Refuses a replay with no current track, a remix (which has
/// no track of its own) and a replay of the playback game itself.
///
/// `lookup` answers what the engine's archive scan knows about the game being
/// depended on, which is its short name, version and adapter.
pub fn prepare(
    request: &Prepare,
    lookup: impl FnOnce(&str) -> Result<BaseGame, String>,
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
    let script = start_script(&raw.script, &request.opening)?;
    let base_game = request
        .game
        .map(str::trim)
        .filter(|game| !game.is_empty())
        .map_or(recorded, str::to_string);
    let installed = lookup(&base_game)
        .map_err(|e| format!("could not read the short name of {base_game}: {e}"))?;
    let chosen = adapter::choose(
        installed.own_adapter,
        request.adapters,
        &installed.short_name,
        installed.version.as_deref(),
    );
    write_game(
        request.content_root,
        &base_game,
        &installed.short_name,
        &track_store::track_path(request.tracks, &game_id)?,
        &chosen,
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

/// What the engine's scan says about the game the playback depends on, and the
/// adapter that game holds in its own archive (issue #3799).
pub fn installed_game(engine_dir: &str, datadirs: &str, game: &str) -> Result<BaseGame, String> {
    let installed =
        tauri_plugin_coilbox_unitsync::installed_game_blocking(engine_dir, datadirs, game)?;
    let own_adapter = tauri_plugin_coilbox_unitsync::archive_text_blocking(
        engine_dir,
        datadirs,
        &installed.archive,
        adapter::PATH,
    );
    Ok(BaseGame {
        short_name: installed.short_name,
        version: installed.version,
        own_adapter,
    })
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
/// depend on when the exact one is not installed. `startFrame` is the frame to
/// open on, held inside the track, and `paused` opens on the player's own
/// pause. Without them the player opens on the track's first frame, playing.
///
/// It rejects, with the reason, for a replay with no current track, a remix, a
/// replay of the playback game and an engine that is not there. The game folder
/// is not touched while another game is running.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub(crate) async fn content_replay_playback_launch<R: Runtime>(
    app: AppHandle<R>,
    replay_path: String,
    executable: String,
    data_dir: String,
    run_id: String,
    on_event: Channel<LaunchEvent>,
    game: Option<String>,
    start_frame: Option<u32>,
    paused: Option<bool>,
) -> CliResult {
    let opening = Opening {
        frame: start_frame,
        paused: paused.unwrap_or(false),
    };
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
                    opening,
                    script_dir: &script_dir,
                    adapters: REWIND_PLAYER_ADAPTERS,
                },
                |base| installed_game(&engine_dir, &datadirs, base),
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
        let game = parsed(&start_script(REPLAY_SCRIPT, &Opening::default()).unwrap());

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
        let game = parsed(&start_script(REPLAY_SCRIPT, &Opening::default()).unwrap());

        for (index, team) in numbered(&game, "team") {
            assert_eq!(team.get("teamleader"), Some("0"), "team {index}");
            assert_eq!(team.get("luaai"), None, "team {index}");
        }
    }

    #[test]
    fn team_numbers_and_ally_teams_are_the_replays_own() {
        let game = parsed(&start_script(REPLAY_SCRIPT, &Opening::default()).unwrap());

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
        let game = parsed(&start_script(script, &Opening::default()).unwrap());

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
        let game = parsed(&start_script(script, &Opening::default()).unwrap());

        assert_eq!(game.get("numteams"), Some("2"));
    }

    #[test]
    fn colours_sides_and_start_positions_carry_over() {
        let game = parsed(&start_script(REPLAY_SCRIPT, &Opening::default()).unwrap());
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
        let game = parsed(&start_script(REPLAY_SCRIPT, &Opening::default()).unwrap());

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
    fn a_start_frame_and_paused_are_mod_options() {
        let opening = Opening {
            frame: Some(550),
            paused: true,
        };
        let game = parsed(&start_script(REPLAY_SCRIPT, &opening).unwrap());
        let options = game.child("modoptions").unwrap();

        assert_eq!(options.get("coilbox_rewind_start_frame"), Some("550"));
        assert_eq!(options.get("coilbox_rewind_start_paused"), Some("1"));
        // The replay's own options are still there.
        assert_eq!(options.get("deathmode"), Some("com"));
    }

    #[test]
    fn a_frame_without_paused_opens_playing() {
        let opening = Opening {
            frame: Some(0),
            paused: false,
        };
        let game = parsed(&start_script(REPLAY_SCRIPT, &opening).unwrap());
        let options = game.child("modoptions").unwrap();

        assert_eq!(options.get("coilbox_rewind_start_frame"), Some("0"));
        assert_eq!(options.get("coilbox_rewind_start_paused"), None);
    }

    #[test]
    fn paused_without_a_frame_opens_on_the_first_frame_paused() {
        let opening = Opening {
            frame: None,
            paused: true,
        };
        let game = parsed(&start_script(REPLAY_SCRIPT, &opening).unwrap());
        let options = game.child("modoptions").unwrap();

        assert_eq!(options.get("coilbox_rewind_start_frame"), None);
        assert_eq!(options.get("coilbox_rewind_start_paused"), Some("1"));
    }

    #[test]
    fn without_an_opening_neither_key_is_there() {
        let game = parsed(&start_script(REPLAY_SCRIPT, &Opening::default()).unwrap());
        let options = game.child("modoptions").unwrap();

        assert_eq!(options.get("coilbox_rewind_start_frame"), None);
        assert_eq!(options.get("coilbox_rewind_start_paused"), None);
        assert_eq!(options.keys.len(), 4);
    }

    #[test]
    fn a_replay_without_mod_options_still_gets_the_keys() {
        let script = "[game]\n{\n[team0]\n{\nallyteam=0;\n}\nmapname=M;\ngametype=G 1;\n}\n";
        let opening = Opening {
            frame: Some(9),
            paused: true,
        };
        let game = parsed(&start_script(script, &opening).unwrap());
        let options = game.child("modoptions").unwrap();

        assert_eq!(options.get("coilbox_rewind_start_frame"), Some("9"));
        assert_eq!(options.get("coilbox_rewind_start_paused"), Some("1"));
        // Without an opening, no empty section appears.
        let plain = parsed(&start_script(script, &Opening::default()).unwrap());
        assert!(plain.child("modoptions").is_none());
    }

    #[test]
    fn a_replays_own_keys_cannot_shadow_the_opening() {
        let script = REPLAY_SCRIPT.replace(
            "[modoptions]\n{\n",
            "[modoptions]\n{\ncoilbox_rewind_start_frame=1;\ncoilbox_rewind_start_paused=1;\n",
        );
        let opening = Opening {
            frame: Some(550),
            paused: false,
        };
        let text = start_script(&script, &opening).unwrap();
        let options = parsed(&text);
        let options = options.child("modoptions").unwrap();

        assert_eq!(options.get("coilbox_rewind_start_frame"), Some("550"));
        // Its paused key is dropped, not carried, when ours is unset.
        assert_eq!(options.get("coilbox_rewind_start_paused"), None);
        assert_eq!(text.matches("coilbox_rewind_start_frame").count(), 1);

        // The same holds with no opening at all.
        let text = start_script(&script, &Opening::default()).unwrap();
        assert!(!text.contains("coilbox_rewind_start"), "{text}");
    }

    #[test]
    fn the_game_and_map_are_named_and_no_demo_is_recorded() {
        let game = parsed(&start_script(REPLAY_SCRIPT, &Opening::default()).unwrap());

        assert_eq!(game.get("gametype"), Some("Coilbox replay playback 1"));
        assert_eq!(game.get("mapname"), Some("All That Glitters v2.2.3"));
        assert_eq!(game.get("recorddemo"), Some("0"));
        assert_eq!(game.get("ishost"), Some("1"));
    }

    /// The replay chose start positions in the lobby (type 2). Nobody can in
    /// the playback, so it takes the fixed type the spike ran with.
    #[test]
    fn nobody_is_asked_for_a_start_position() {
        let game = parsed(&start_script(REPLAY_SCRIPT, &Opening::default()).unwrap());

        assert_eq!(game.get("startpostype"), Some("1"));
    }

    /// The replay's address is not the playback's.
    #[test]
    fn the_replays_network_keys_are_not_carried() {
        let script = start_script(REPLAY_SCRIPT, &Opening::default()).unwrap();

        assert!(!script.contains("hostip"), "{script}");
        assert!(!script.contains("hostport"), "{script}");
    }

    #[test]
    fn the_same_replay_gives_the_same_script() {
        assert_eq!(
            start_script(REPLAY_SCRIPT, &Opening::default()).unwrap(),
            start_script(REPLAY_SCRIPT, &Opening::default()).unwrap()
        );
    }

    /// The script is read by the engine's own parser, so the shape has to be
    /// the one the spike ran: a `[game]` block with sections inside it.
    #[test]
    fn the_script_is_a_game_block() {
        let script = start_script(REPLAY_SCRIPT, &Opening::default()).unwrap();

        assert!(script.starts_with("[game]\n{\n"), "{script}");
        assert!(script.ends_with("}\n"), "{script}");
    }

    #[test]
    fn nothing_assumes_where_gaia_is() {
        let script = start_script(REPLAY_SCRIPT, &Opening::default()).unwrap();

        assert!(!script.to_lowercase().contains("gaia"), "{script}");
        assert_eq!(parsed(&script).get("numteams"), Some("2"));
    }

    #[test]
    fn a_replay_with_no_map_or_no_teams_gives_no_script() {
        assert!(start_script(
            "[game]\n{\n[team0]\n{\nallyteam=0;\n}\n}\n",
            &Opening::default()
        )
        .is_err());
        assert!(start_script("[game]\n{\nmapname=M;\n}\n", &Opening::default()).is_err());
        assert!(start_script("", &Opening::default()).is_err());
    }

    /// Tables inside a section survive, such as a restriction list.
    #[test]
    fn a_table_inside_a_section_is_kept() {
        let script = "[game]\n{\nmapname=M;\n[team0]\n{\nallyteam=0;\n}\n\
            [restrict]\n{\n[unit0]\n{\nunitname=armcom;\nlimit=0;\n}\n}\n}\n";
        let game = parsed(&start_script(script, &Opening::default()).unwrap());

        let unit = game.child("restrict").unwrap().child("unit0").unwrap();
        assert_eq!(unit.get("unitname"), Some("armcom"));
        assert_eq!(unit.get("limit"), Some("0"));
    }

    // ---- the game folder -------------------------------------------------

    fn none() -> adapter::Chosen {
        adapter::Chosen::none()
    }

    /// A game that holds no adapter of its own.
    fn base(short_name: &str) -> BaseGame {
        BaseGame {
            short_name: short_name.into(),
            version: Some("1.0".into()),
            own_adapter: Ok(None),
        }
    }

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
        let (dir, _) =
            write_game(root.path(), "Some Game 1.0", "some_game", &track, &none()).unwrap();

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
        let (dir, _) =
            write_game(root.path(), "Some Game 1.0", "some_game", &track, &none()).unwrap();

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
        let (dir, placed) = write_game(root.path(), "G 1", "g", &track, &none()).unwrap();

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
        let (dir, placed) = write_game_with(root.path(), "G 1", "g", &track, &none(), |_, _| {
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
        let (dir, placed) = write_game_with(root.path(), "G 1", "g", &track, &none(), |_, to| {
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

        let err =
            write_game(root.path(), "G 1", "g", &root.path().join("none"), &none()).unwrap_err();
        assert!(err.contains("could not copy the track"), "{err}");
    }

    /// Every launch starts from nothing: a file an earlier launch wrote that
    /// this one does not is gone, and the track is the new one.
    #[test]
    fn the_game_is_cleared_and_written_again_on_every_launch() {
        let root = tempfile::tempdir().unwrap();
        let first = a_track(root.path(), "first track");
        let (dir, _) = write_game(root.path(), "Old Game 1", "old", &first, &none()).unwrap();
        std::fs::write(dir.join("stale.lua"), "left behind").unwrap();
        std::fs::create_dir_all(dir.join("units")).unwrap();
        std::fs::write(dir.join("units/stale.lua"), "left behind").unwrap();
        let second = root.path().join("second.cbtrack");
        std::fs::write(&second, "second track").unwrap();

        let (again, _) = write_game(root.path(), "New Game 2", "new", &second, &none()).unwrap();

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

        assert!(write_game(root.path(), "  ", "x", &track, &none()).is_err());
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
                    opening: Opening::default(),
                    script_dir: &self.scripts,
                    adapters: &[],
                },
                |_| Ok(base("SHORT")),
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
    fn a_launch_passes_its_opening_to_the_script() {
        let world = World::new(REPLAY_SCRIPT);
        world.record(RECORDER_VERSION);

        let script = prepare(
            &Prepare {
                replay: &world.replay,
                tracks: &world.tracks,
                content_root: &world.root,
                game: None,
                script_dir: &world.scripts,
                adapters: &[],
                opening: Opening {
                    frame: Some(40),
                    paused: true,
                },
            },
            |_| Ok(base("SHORT")),
        )
        .unwrap();

        let game = parsed(&std::fs::read_to_string(&script).unwrap());
        let options = game.child("modoptions").unwrap();
        assert_eq!(options.get("coilbox_rewind_start_frame"), Some("40"));
        assert_eq!(options.get("coilbox_rewind_start_paused"), Some("1"));
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
                opening: Opening::default(),
                script_dir: &world.scripts,
                adapters: &[],
            },
            |game| {
                *asked.borrow_mut() = game.to_string();
                Ok(base("SF"))
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
                opening: Opening::default(),
                script_dir: &world.scripts,
                adapters: &[],
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

    // ---- the game's adapter ----------------------------------------------

    const FIXTURE_ADAPTER: &str = "return { name = 'Fixture', shortname = 'SHORT', \
        versions = { min = '1.0', max = '1.9' }, \
        gadgets = { 'game_end.lua', 'sub/inner.lua' }, widgets = { 'gui_bars.lua' }, \
        units = { 'armcom' } }";

    fn chosen(text: &str) -> adapter::Chosen {
        adapter::choose(Ok(None), &[("fixture.lua", text)], "SHORT", Some("1.5"))
    }

    #[test]
    fn what_the_adapter_names_is_shadowed_by_a_file_that_asks_not_to_load() {
        let root = tempfile::tempdir().unwrap();
        let track = a_track(root.path(), "track");
        let (dir, _) =
            write_game(root.path(), "G 1", "g", &track, &chosen(FIXTURE_ADAPTER)).unwrap();

        for shadow in [
            "luarules/gadgets/game_end.lua",
            "luarules/gadgets/sub/inner.lua",
            "luaui/widgets/gui_bars.lua",
        ] {
            assert_eq!(
                std::fs::read_to_string(dir.join(shadow)).unwrap(),
                adapter::SHADOW,
                "{shadow}"
            );
        }
        // Only what is named, and the player is still there.
        let written = files(&dir);
        assert!(!written
            .iter()
            .any(|f| f == "luarules/gadgets/game_over.lua"));
        assert!(written
            .iter()
            .any(|f| f == "luarules/gadgets/coilbox_rewind_player.lua"));
    }

    #[test]
    fn the_adapter_in_use_is_written_where_the_player_reads_it() {
        let root = tempfile::tempdir().unwrap();
        let track = a_track(root.path(), "track");
        let (dir, _) =
            write_game(root.path(), "G 1", "g", &track, &chosen(FIXTURE_ADAPTER)).unwrap();

        assert_eq!(
            std::fs::read_to_string(dir.join(adapter::PATH)).unwrap(),
            FIXTURE_ADAPTER
        );
    }

    #[test]
    fn with_no_adapter_nothing_is_shadowed_and_the_default_is_written() {
        let root = tempfile::tempdir().unwrap();
        let track = a_track(root.path(), "track");
        let (dir, _) = write_game(root.path(), "G 1", "g", &track, &none()).unwrap();

        let written = files(&dir);
        assert!(written.iter().any(|f| f == adapter::PATH));
        let expected: Vec<String> = REWIND_PLAYER_FILES
            .iter()
            .map(|(rel, _)| rel.to_string())
            .chain([
                "modinfo.lua".to_string(),
                TRACK_PATH.to_string(),
                adapter::PATH.to_string(),
            ])
            .collect();
        let mut expected = expected;
        expected.sort();
        assert_eq!(written, expected);
        assert!(std::fs::read_to_string(dir.join(adapter::PATH))
            .unwrap()
            .trim_end()
            .ends_with("return false"));
    }

    #[test]
    fn a_shadow_from_an_earlier_launch_does_not_outlive_it() {
        let root = tempfile::tempdir().unwrap();
        let track = a_track(root.path(), "track");
        let (dir, _) =
            write_game(root.path(), "G 1", "g", &track, &chosen(FIXTURE_ADAPTER)).unwrap();
        assert!(dir.join("luarules/gadgets/game_end.lua").exists());

        write_game(root.path(), "G 1", "g", &track, &none()).unwrap();

        assert!(!dir.join("luarules/gadgets/game_end.lua").exists());
        assert!(!dir.join("luaui/widgets/gui_bars.lua").exists());
    }

    fn prepared_with(world: &World, shipped: &[(&str, &str)], base: BaseGame) -> PathBuf {
        prepare(
            &Prepare {
                replay: &world.replay,
                tracks: &world.tracks,
                content_root: &world.root,
                game: None,
                opening: Opening::default(),
                script_dir: &world.scripts,
                adapters: shipped,
            },
            |_| Ok(base),
        )
        .unwrap()
    }

    fn shadowed(world: &World) -> bool {
        world
            .root
            .join("games")
            .join(FOLDER)
            .join("luarules/gadgets/game_end.lua")
            .exists()
    }

    fn played(world: &World) -> String {
        std::fs::read_to_string(world.root.join("games").join(FOLDER).join(adapter::PATH)).unwrap()
    }

    #[test]
    fn a_launch_uses_the_shipped_adapter_of_a_game_in_its_range() {
        let world = World::new(REPLAY_SCRIPT);
        world.record(RECORDER_VERSION);

        prepared_with(&world, &[("fixture.lua", FIXTURE_ADAPTER)], base("short"));

        assert!(shadowed(&world));
        assert_eq!(played(&world), FIXTURE_ADAPTER);
    }

    #[test]
    fn a_launch_for_a_version_outside_the_range_switches_nothing_off() {
        let world = World::new(REPLAY_SCRIPT);
        world.record(RECORDER_VERSION);
        let mut game = base("SHORT");
        game.version = Some("2.0".into());

        prepared_with(&world, &[("fixture.lua", FIXTURE_ADAPTER)], game);

        assert!(!shadowed(&world));
        assert!(played(&world).trim_end().ends_with("return false"));
    }

    #[test]
    fn a_launch_for_a_game_with_no_adapter_still_gets_its_game_and_script() {
        let world = World::new(REPLAY_SCRIPT);
        world.record(RECORDER_VERSION);

        let script = prepared_with(&world, &[("fixture.lua", FIXTURE_ADAPTER)], base("OTHER"));

        assert!(!shadowed(&world));
        assert!(script.exists());
        assert!(world
            .root
            .join("games")
            .join(FOLDER)
            .join(TRACK_PATH)
            .exists());
    }

    #[test]
    fn a_games_own_adapter_wins_over_the_one_coilbox_ships() {
        let world = World::new(REPLAY_SCRIPT);
        world.record(RECORDER_VERSION);
        let own = "return { name = 'Own', gadgets = { 'own_gadget.lua' } }";
        let mut game = base("SHORT");
        game.own_adapter = Ok(Some(own.into()));

        prepared_with(&world, &[("fixture.lua", FIXTURE_ADAPTER)], game);

        let dir = world.root.join("games").join(FOLDER);
        assert_eq!(played(&world), own);
        assert!(dir.join("luarules/gadgets/own_gadget.lua").exists());
        assert!(!shadowed(&world));
    }

    #[test]
    fn a_games_own_adapter_that_cannot_be_read_does_not_stop_the_launch() {
        let world = World::new(REPLAY_SCRIPT);
        world.record(RECORDER_VERSION);
        let mut game = base("OTHER");
        game.own_adapter = Err("could not open the archive".into());

        prepared_with(&world, &[], game);

        assert!(played(&world).contains("could not open the archive"));
    }

    /// A gadget that says what the engine made of the script, because the
    /// engine's own log does not name the colours or the team leaders. It is
    /// written into the game folder after the launch is prepared and is not
    /// part of the game.
    const PROBE: &str = r#"
function gadget:GetInfo()
	return { name = "probe", layer = -1000, enabled = true }
end
if gadgetHandler:IsSyncedCode() then
	function gadget:Initialize()
		Spring.Echo("PROBE map " .. Game.mapName)
		Spring.Echo("PROBE game " .. Game.gameName .. " " .. Game.gameVersion)
		Spring.Echo("PROBE gaia " .. Spring.GetGaiaTeamID())
		for _, team in ipairs(Spring.GetTeamList()) do
			local _, leader, dead, ai, side, ally = Spring.GetTeamInfo(team, false)
			Spring.Echo(string.format("PROBE team %d ally %d leader %d dead %s ai %s side %s", team, ally, leader, tostring(dead), tostring(ai), side))
		end
		local players, spectators = 0, 0
		for _, player in ipairs(Spring.GetPlayerList()) do
			local _, _, spectator = Spring.GetPlayerInfo(player, false)
			players = players + 1
			if spectator then
				spectators = spectators + 1
			end
		end
		Spring.Echo("PROBE players " .. players .. " spectators " .. spectators)
	end
else
	-- Team colours are only readable from the unsynced half.
	function gadget:Initialize()
		for _, team in ipairs(Spring.GetTeamList()) do
			local r, g, b = Spring.GetTeamColor(team)
			Spring.Echo(string.format("PROBE colour team %d %.3f %.3f %.3f", team, r, g, b))
		end
	end
end
"#;

    /// What the two tests below share: a replay recorded into a track, and the
    /// playback game and start script written for it.
    struct Prepared {
        dir: tempfile::TempDir,
        engine_dir: PathBuf,
        data_dirs: Vec<PathBuf>,
        content: PathBuf,
        game_dir: PathBuf,
        script: PathBuf,
        wait: std::time::Duration,
        replay: PathBuf,
        tracks: PathBuf,
        stand_in: Option<String>,
    }

    impl Prepared {
        /// Writes the playback game again, as a launch with `adapters` shipped
        /// would. The track is not recorded again.
        fn rewrite(&self, adapters: &[(&str, &str)]) {
            let datadirs = self
                .data_dirs
                .iter()
                .map(|d| d.to_string_lossy())
                .collect::<Vec<_>>()
                .join(&coilbox_proc::DATADIR_SEP.to_string());
            prepare(
                &Prepare {
                    replay: &self.replay,
                    tracks: &self.tracks,
                    content_root: &self.content,
                    game: self.stand_in.as_deref(),
                    opening: Opening::default(),
                    script_dir: &self.dir.path().join("play"),
                    adapters,
                },
                |game| installed_game(&self.engine_dir.to_string_lossy(), &datadirs, game),
            )
            .expect("the playback is prepared again");
        }
    }

    fn var(name: &str) -> Option<String> {
        std::env::var(name).ok().filter(|v| !v.is_empty())
    }

    /// Records the replay named by the environment into a track, the way the
    /// queue does, and prepares its playback. `None` when the variables are not
    /// set, which is every run but one made on purpose. With `in_the_middle`
    /// the launch asks for the track's middle frame, paused, through
    /// [`Opening`], the way the replay page's button does (issue #3809).
    fn prepared(in_the_middle: bool) -> Option<Prepared> {
        use super::super::analysis::launch::RunControl;
        use super::super::analysis::{
            analyse_replay, run_timeout, AnalysisRequest, AnalysisStatus,
        };
        use coilbox_track_thin::{thin_dump_cancellable, ThinOptions};

        let (Some(replay), Some(engine_dir), Some(data_dirs)) = (
            var("COILBOX_ANALYSIS_REPLAY"),
            var("COILBOX_ANALYSIS_ENGINE_DIR"),
            var("COILBOX_ANALYSIS_DATA_DIRS"),
        ) else {
            eprintln!(
                "did nothing: set COILBOX_ANALYSIS_REPLAY, COILBOX_ANALYSIS_ENGINE_DIR and \
                 COILBOX_ANALYSIS_DATA_DIRS to run it"
            );
            return None;
        };
        let replay = PathBuf::from(replay);
        let engine_dir = PathBuf::from(engine_dir);
        let data_dirs: Vec<PathBuf> = data_dirs
            .split(coilbox_proc::DATADIR_SEP)
            .map(PathBuf::from)
            .collect();
        let stand_in = var("COILBOX_PLAYBACK_GAME");
        let wait = std::time::Duration::from_secs(
            var("COILBOX_PLAYBACK_SECONDS")
                .and_then(|v| v.parse().ok())
                .unwrap_or(120),
        );
        let dir = tempfile::tempdir().unwrap();

        // 1. Record the replay into a track, the way the queue does.
        let game_id = store::replay_key(&replay).unwrap();
        let raw = read_header_and_script(&replay).unwrap();
        let dump = dir.path().join("recording.dump");
        let tracks = dir.path().join("tracks");
        let run = analyse_replay(
            &AnalysisRequest {
                replay: replay.clone(),
                engine_dir: engine_dir.clone(),
                data_dirs: data_dirs.clone(),
                game: None,
                game_short_name: None,
                scratch_root: dir.path().join("scratch"),
                timeout: run_timeout(raw.game_time),
                record: Some(dump.clone()),
            },
            &RunControl::default(),
            &|_| {},
        )
        .expect("the recording run");
        assert_eq!(run.report.status, AnalysisStatus::Reproduced);
        track_store::store(&tracks, &game_id, |track| {
            thin_dump_cancellable(
                &dump,
                track,
                &ThinOptions {
                    game_id: track_store::id_bytes(&game_id).unwrap(),
                    ..ThinOptions::default()
                },
                &|| false,
            )
            .map(|_| ())
        })
        .expect("a track is stored");

        // 2. Write the playback game and its start script.
        let content = dir.path().join("content");
        std::fs::create_dir_all(&content).unwrap();
        let datadirs = data_dirs
            .iter()
            .map(|d| d.to_string_lossy())
            .collect::<Vec<_>>()
            .join(&coilbox_proc::DATADIR_SEP.to_string());
        let opening = if in_the_middle {
            let track = std::fs::read(track_store::track_path(&tracks, &game_id).unwrap()).unwrap();
            let word = |at: usize| u32::from_le_bytes(track[at..at + 4].try_into().unwrap());
            let (first, last) = (word(12), word(16));
            Opening {
                frame: Some(first + (last - first) / 2),
                paused: true,
            }
        } else {
            Opening::default()
        };
        let script = prepare(
            &Prepare {
                replay: &replay,
                tracks: &tracks,
                content_root: &content,
                game: stand_in.as_deref(),
                opening,
                script_dir: &dir.path().join("play"),
                adapters: REWIND_PLAYER_ADAPTERS,
            },
            |game| installed_game(&engine_dir.to_string_lossy(), &datadirs, game),
        )
        .expect("the playback is prepared");
        let game_dir = content.join("games").join(FOLDER);
        Some(Prepared {
            dir,
            engine_dir,
            data_dirs,
            content,
            game_dir,
            script,
            wait,
            replay,
            tracks,
            stand_in,
        })
    }

    /// The engine's log as text. A game can log bytes that are not UTF-8, as
    /// Balanced Annihilation 15.9.8 does, and a log read as a string would
    /// then come back empty.
    fn read_log(log: &Path) -> String {
        String::from_utf8_lossy(&std::fs::read(log).unwrap_or_default()).into_owned()
    }

    /// A copy of a folder and everything in it.
    fn copy_folder(from: &Path, to: &Path) {
        std::fs::create_dir_all(to).unwrap();
        for entry in std::fs::read_dir(from).unwrap().flatten() {
            let target = to.join(entry.file_name());
            if entry.path().is_dir() {
                copy_folder(&entry.path(), &target);
            } else {
                std::fs::copy(entry.path(), target).unwrap();
            }
        }
    }

    /// Launches the headless engine on a prepared playback and reads its log
    /// until `done` says the lines are in. Gives whether it timed out, the log
    /// and how many replays the engine wrote.
    fn launch(prepared: &Prepared, done: &dyn Fn(&str) -> bool) -> (bool, String, usize) {
        use super::super::analysis::launch::{headless_binary, run_headless, Launch, RunControl};

        let dir = prepared.dir.path();
        let write_dir = dir.join("write");
        let log = dir.join("engine.log");
        let control = RunControl::default();
        let mut dirs = vec![prepared.content.clone()];
        dirs.extend(prepared.data_dirs.iter().cloned());
        let exit = run_headless(
            &Launch {
                engine: &headless_binary(&prepared.engine_dir),
                demo: &prepared.script,
                write_dir: &write_dir,
                config: &dir.join("engine.cfg"),
                pid_file: &dir.join("engine.pid"),
                data_dirs: &dirs,
                log: &log,
                timeout: prepared.wait,
                on_poll: &|| {
                    if done(&read_log(&log)) {
                        control.cancel();
                    }
                },
            },
            &control,
        )
        .expect("the engine launches");
        let output = read_log(&log);
        // For a person to read afterwards, since the folder is removed.
        if let Some(keep) = var("COILBOX_PLAYBACK_LOG") {
            let _ = std::fs::copy(&log, keep);
        }
        // The game and its script, for a person to open in an engine with a
        // window, which is the only way to see anything the playback draws.
        if let Some(keep) = var("COILBOX_PLAYBACK_KEEP_GAME") {
            let keep = PathBuf::from(keep);
            copy_folder(&prepared.game_dir, &keep.join(FOLDER));
            std::fs::copy(&prepared.script, keep.join("script.txt")).unwrap();
        }
        let written = std::fs::read_dir(write_dir.join("demos"))
            .map(|d| d.flatten().count())
            .unwrap_or(0);
        eprintln!("exit: {exit:?}");
        (exit.timed_out, output, written)
    }

    /// The whole route against a real engine, a real game and a real replay:
    /// the replay is recorded into a track, the playback game and its script
    /// are written for it, and the engine is launched on them. The engine's log
    /// then has to show the replay's map, its teams with their colours, one
    /// spectator, the player gadget's line about the track, and no replay
    /// written.
    ///
    /// Reads the same variables as the analysis tests, and does nothing without
    /// them. `COILBOX_PLAYBACK_GAME` names another installed game for the
    /// playback to depend on, for a replay recorded on a scratch game whose own
    /// gadgets would play over the track. `COILBOX_PLAYBACK_SECONDS` is how long to wait
    /// for the log lines (default 120). `COILBOX_PLAYBACK_LOG` is a path to copy
    /// the engine's output to. `COILBOX_PLAYBACK_KEEP_GAME` is a folder to copy
    /// the playback game and its script to. The engine is the headless one in
    /// `COILBOX_ANALYSIS_ENGINE_DIR`, since a window cannot be checked here.
    #[test]
    #[ignore = "needs an engine, a game, a map and a replay recorded with them"]
    fn a_real_replay_is_played_back_in_the_engine() {
        let Some(prepared) = prepared(false) else {
            return;
        };
        std::fs::write(prepared.game_dir.join("luarules/gadgets/probe.lua"), PROBE).unwrap();

        let (timed_out, output, written) = launch(&prepared, &|text| {
            text.contains("PROBE players") && text.contains("COILBOX_REWIND_PLAYER")
        });
        let lines: Vec<&str> = output
            .lines()
            .filter(|l| l.contains("PROBE ") || l.contains("COILBOX_REWIND_PLAYER"))
            .collect();
        eprintln!("{}", lines.join("\n"));
        eprintln!(
            "script:\n{}",
            std::fs::read_to_string(&prepared.script).unwrap()
        );

        assert!(!timed_out, "the log never showed the lines. Log:\n{output}");
        assert!(output.contains("PROBE players 1 spectators 1"), "{output}");
        // The track reached the game, through the reader.
        assert!(
            lines
                .iter()
                .any(|l| l.contains("COILBOX_REWIND_PLAYER track frames")),
            "{output}"
        );
        // No replay of the playback was written.
        assert_eq!(written, 0, "the playback wrote a replay");
    }

    /// The gadget that drives the player in the engine and reports what the
    /// engine then has. It is written into the game folder for the test below
    /// and is not part of the game.
    const DRIVER: &str = include_str!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../lua/rewind-player/tests/headless/playback_driver.lua"
    ));

    /// The value of `key=` in a line of the driver's.
    fn field<'a>(line: &'a str, key: &str) -> &'a str {
        line.split_whitespace()
            .find_map(|word| word.strip_prefix(key)?.strip_prefix('='))
            .unwrap_or_else(|| panic!("no {key}= in {line}"))
    }

    fn number(line: &str, key: &str) -> f64 {
        field(line, key)
            .parse()
            .unwrap_or_else(|_| panic!("{key} is not a number in {line}"))
    }

    /// A track with `blocks` blocks of zero bytes after its header and index
    /// and every block number moved along by as much. It is the same track by
    /// the format page, with every chunk further into the file.
    fn moved_along(track: &[u8], blocks: u32) -> Vec<u8> {
        let word = |at: usize| u32::from_le_bytes(track[at..at + 4].try_into().unwrap());
        let header = u16::from_le_bytes(track[6..8].try_into().unwrap()) as usize;
        let windows = word(24) as usize;
        let mut head = track[..header + 16 * windows].to_vec();
        let mut first = word(36).min(word(44));
        let mut shift = |at: usize| {
            let moved = word(at) + blocks;
            head[at..at + 4].copy_from_slice(&moved.to_le_bytes());
        };
        shift(36);
        shift(44);
        for k in 0..windows {
            let at = header + 16 * k;
            first = first.min(word(at));
            shift(at);
            if word(at + 12) > 0 {
                shift(at + 8);
            }
        }
        let start = first as usize * 64;
        head.resize(start + blocks as usize * 64, 0);
        head.extend_from_slice(&track[start..]);
        head
    }

    /// The player gadget against a real engine (issue #3794). A replay is
    /// recorded into a track and played back, and a driver gadget seeks the
    /// player about and reports what the engine has each time, measured
    /// against a reader of its own. The engine then has to have, at ten
    /// times, the units and features the track has there, where and how the
    /// track has them, and has to have a building gone before its construction,
    /// the ground as the track has it, no dead team and no error from the
    /// player's Lua.
    ///
    /// `scripts/rewind-playback-headless.sh` records a match that has all of
    /// that in it and runs this on it. It reads the variables the test above
    /// does. `COILBOX_PLAYBACK_PAD_BLOCKS` moves every chunk of the track that
    /// many 64 byte blocks further into the file first, which is how a track
    /// longer than 16,777,216 bytes is played (issue #3971).
    ///
    /// The engine is headless, so nothing here shows what a person would see.
    #[test]
    #[ignore = "needs an engine, a game, a map and a replay recorded with them"]
    fn a_real_track_is_played_at_any_time() {
        let Some(prepared) = prepared(true) else {
            return;
        };
        std::fs::write(
            prepared
                .game_dir
                .join("luarules/gadgets/playback_driver.lua"),
            DRIVER,
        )
        .unwrap();

        let inside = prepared.game_dir.join(TRACK_PATH);
        let track = std::fs::read(&inside).unwrap();
        if let Some(blocks) = var("COILBOX_PLAYBACK_PAD_BLOCKS") {
            let moved = moved_along(&track, blocks.parse().expect("a number of blocks"));
            // The file in the game is a link to the stored track, so it is
            // replaced and not written through.
            std::fs::remove_file(&inside).unwrap();
            std::fs::write(&inside, &moved).unwrap();
            eprintln!(
                "the track is {} bytes, moved from {}",
                moved.len(),
                track.len()
            );
        }
        let word = |at: usize| u32::from_le_bytes(track[at..at + 4].try_into().unwrap());
        let (first, last) = (word(12), word(16));

        // The launch asked for the middle of the match, paused, through the
        // arguments the replay page's button passes (issue #3809).
        let middle = first + (last - first) / 2;
        let script = std::fs::read_to_string(&prepared.script).unwrap();
        assert!(
            script.contains(&format!("coilbox_rewind_start_frame={middle};")),
            "{script}"
        );
        assert!(
            script.contains("coilbox_rewind_start_paused=1;"),
            "{script}"
        );

        let (timed_out, output, written) =
            launch(&prepared, &|text| text.contains("REWIND_DRIVER done"));
        let driver: Vec<&str> = output
            .lines()
            .filter_map(|l| l.split_once("REWIND_DRIVER ").map(|(_, rest)| rest))
            .collect();
        let player: Vec<&str> = output
            .lines()
            .filter(|l| l.contains("COILBOX_REWIND_PLAYER"))
            .collect();
        eprintln!("{}\n{}", player.join("\n"), driver.join("\n"));
        assert!(!timed_out, "the driver never finished. Log:\n{output}");
        let line = |start: &str| {
            *driver
                .iter()
                .find(|l| l.starts_with(start))
                .unwrap_or_else(|| panic!("no driver line starting {start}"))
        };

        // The mod options were read.
        let options = line("options ");
        assert_eq!(number(options, "frame"), f64::from(middle), "{options}");
        assert_eq!(field(options, "playing"), "0", "{options}");

        // A seek that the driver's own reader agrees with, at ten times.
        let start = line("start ");
        let tolerance = number(start, "tolerance");
        let step = number(start, "step");
        // The most a rotation is off by from being rounded, from the format page.
        let rounding = 6f64.sqrt() / (2f64.powf(number(start, "rotation_bits") - 1.0) - 1.0);
        // Health and build progress are stored in this many steps.
        let fraction = 1.0 / 65535.0;
        let agrees = |l: &str| {
            assert_eq!(field(l, "shown"), field(l, "frame"), "{l}");
            assert_eq!(field(l, "engine_units"), field(l, "track_units"), "{l}");
            assert_eq!(
                field(l, "engine_features"),
                field(l, "track_features"),
                "{l}"
            );
            assert!(number(l, "place") <= tolerance, "{l}");
            assert!(number(l, "turn") <= rounding, "{l}");
            assert!(number(l, "health") <= fraction, "{l}");
            assert!(number(l, "build") <= fraction, "{l}");
            assert_eq!(field(l, "wrong_build_state"), "0", "{l}");
        };
        let seeks: Vec<&str> = driver
            .iter()
            .copied()
            .filter(|l| l.starts_with("seek "))
            .collect();
        assert_eq!(seeks.len(), 10, "{driver:?}");
        seeks.iter().for_each(|l| agrees(l));
        let mut counts: Vec<&str> = seeks.iter().map(|l| field(l, "track_units")).collect();
        counts.sort_unstable();
        counts.dedup();
        assert!(
            counts.len() >= 3,
            "the seeks saw only {counts:?} units, so they show little"
        );
        assert!(!driver.iter().any(|l| l.starts_with("lost ")), "{driver:?}");

        // Seeking backwards past a building's construction removes it.
        let after = line("construction after ");
        let during = line("construction during ");
        let before = line("construction before ");
        let again = line("construction again ");
        assert!(number(after, "units") >= 1.0, "{after}");
        assert_eq!(field(after, "building"), "0", "{after}");
        assert_eq!(field(during, "units"), field(after, "units"), "{during}");
        assert_eq!(field(during, "building"), "1", "{during}");
        assert_eq!(
            number(before, "units"),
            number(after, "units") - 1.0,
            "{before}"
        );
        assert_eq!(field(again, "units"), field(after, "units"), "{again}");
        assert_eq!(field(again, "building"), "1", "{again}");

        // A unit that dies while playing at the match's speed dies with its
        // death effect, and what that leaves behind is removed, so the features
        // are still the track's.
        let past = line("played_past_death ");
        assert!(
            number(past, "frame") > number(line("death "), "last_frame"),
            "{past}"
        );
        agrees(past);
        // Every unit removed by a seek went quietly, and this one exploded.
        let explosions = |start: &str, key: &str| number(line(start), key);
        assert_eq!(explosions("explosions before_death", "before_death"), 0.0);
        assert!(explosions("explosions after_death", "after_death") >= 1.0);

        // The ground goes forward and comes back.
        let ground: Vec<&str> = driver
            .iter()
            .copied()
            .filter(|l| l.starts_with("terrain ") && !l.starts_with("terrain none"))
            .collect();
        assert_eq!(ground.len(), 3, "{driver:?}");
        for l in ground {
            let off = (number(l, "wanted") - number(l, "engine")).abs();
            assert!(off <= step, "{l}");
        }

        // Play goes forward, backward and stops at the end.
        let forward = number(line("play forward "), "shown");
        assert!(
            forward > f64::from(first) + 60.0 && forward <= f64::from(first) + 90.0,
            "{forward}"
        );
        let backward = line("play backward ");
        assert!(number(backward, "shown") < forward, "{backward}");
        assert_eq!(field(backward, "direction"), "-1", "{backward}");
        agrees(line("played_to_end "));
        assert_eq!(field(line("play end "), "playing"), "0");

        // The base game killed no team while the match was empty.
        agrees(line("after_empty "));
        assert_eq!(field(line("teams "), "dead"), "0");

        // A string longer than a float can address was read right.
        assert_eq!(field(line("long_string "), "wrong"), "0");

        // No error from the player's Lua. The base game's own gadgets are not
        // the player's to answer for.
        let errors: Vec<&str> = output
            .lines()
            .filter(|l| l.to_lowercase().contains("error"))
            .filter(|l| {
                l.contains("coilbox_")
                    || l.contains("rewind_player")
                    || l.contains("playback_driver")
            })
            .collect();
        assert!(errors.is_empty(), "{errors:#?}");
        assert_eq!(written, 0, "the playback wrote a replay");
    }

    /// The adapter the headless run uses, shipped to the launch the way
    /// coilbox ships its own. It is not part of the game coilbox ships.
    const HEADLESS_ADAPTER: &str = include_str!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../lua/rewind-player/tests/headless/fixture_adapter.lua"
    ));

    /// The widget that says what was loaded and created.
    const ADAPTER_PROBE: &str = include_str!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../lua/rewind-player/tests/headless/adapter_probe.lua"
    ));

    /// Launches the prepared playback with the probe in it and gives the
    /// engine's log, once the probe has reported. `before` runs after the probe
    /// is written, for a variation on the game.
    fn probed(prepared: &Prepared, before: &dyn Fn(&Path)) -> String {
        std::fs::write(
            prepared
                .game_dir
                .join("luaui/widgets/coilbox_rewind_adapter_probe.lua"),
            ADAPTER_PROBE,
        )
        .unwrap();
        before(&prepared.game_dir);
        let (timed_out, output, _) = launch(prepared, &|text| text.contains("ADAPTER_PROBE done"));
        assert!(!timed_out, "the probe never reported. Log:\n{output}");
        output
    }

    fn lines_with<'a>(output: &'a str, needles: &[&str]) -> Vec<&'a str> {
        output
            .lines()
            .filter(|l| needles.iter().any(|n| l.contains(n)))
            .collect()
    }

    fn count(output: &str, needle: &str) -> usize {
        output.lines().filter(|l| l.contains(needle)).count()
    }

    /// A game's adapter against a real engine and a real game (issue #3799).
    /// The same playback is launched three times on Splinter Faction.
    ///
    /// 1. With no adapter shipped. The base game's `game_end.lua` and
    ///    `game_team_com_ends.lua` load and a team is asked to be killed, which
    ///    the guard says, and the widget loads, and the unit the adapter will
    ///    hide is created.
    /// 2. With the fixture adapter. Neither gadget is loaded and no team is
    ///    asked to be killed, the widget is not loaded, the hidden unit is not
    ///    created, and the hooks run.
    /// 3. With the fixture adapter and the files that stand in for the gadget
    ///    and the widget emptied, which says what the handlers do with an
    ///    empty file.
    ///
    /// `scripts/rewind-playback-headless.sh` runs this, and it reads the
    /// variables the tests above do.
    #[test]
    #[ignore = "needs an engine, a game, a map and a replay recorded with them"]
    fn an_adapter_switches_things_off_in_the_engine() {
        let Some(prepared) = prepared(false) else {
            return;
        };
        let gadgets = ["game_end.lua>", "game_team_com_ends.lua>"];
        let kill = "the base game asked to kill team";

        // 1. No adapter.
        prepared.rewrite(&[]);
        let plain = probed(&prepared, &|_| {});
        let report = |name: &str, output: &str| {
            for l in lines_with(
                output,
                &[
                    "ADAPTER_PROBE ",
                    "ADAPTER_FIXTURE ",
                    "adapter loaded",
                    kill,
                    gadgets[0],
                    gadgets[1],
                ],
            ) {
                eprintln!("{name}: {l}");
            }
        };
        report("no adapter", &plain);
        // The engine loads the game twice in a headless run, so a line is there
        // once for each.
        assert!(
            count(&plain, "COILBOX_REWIND_PLAYER adapter loaded: none") >= 1,
            "{plain}"
        );
        for gadget in gadgets {
            assert!(count(&plain, gadget) >= 1, "{gadget} did not load");
        }
        assert_eq!(count(&plain, kill), 1, "the base game never asked");
        assert!(
            plain.contains("gui_static_resourcebar.lua=1"),
            "the widget the adapter names did not load without it"
        );
        let units = lines_with(&plain, &["ADAPTER_PROBE units"])[0].to_string();
        assert!(units.contains("lozscorpion="), "{units}");
        assert!(units.contains("fedak="), "{units}");
        assert_eq!(count(&plain, "ADAPTER_FIXTURE"), 0);

        // 2. The fixture adapter.
        prepared.rewrite(&[("fixture.lua", HEADLESS_ADAPTER)]);
        let shadows = adapter::Adapter::parse(HEADLESS_ADAPTER).unwrap().shadows();
        assert_eq!(
            shadows,
            [
                "luarules/gadgets/game_end.lua",
                "luarules/gadgets/game_team_com_ends.lua",
                "luaui/widgets/gui_static_resourcebar.lua"
            ]
        );
        let adapted = probed(&prepared, &|_| {});
        report("adapter", &adapted);
        assert!(
            count(
                &adapted,
                "COILBOX_REWIND_PLAYER adapter loaded: Headless fixture. 2 gadgets and 1 widgets"
            ) >= 1,
            "{adapted}"
        );
        for gadget in gadgets {
            assert_eq!(count(&adapted, gadget), 0, "{gadget} loaded");
        }
        assert_eq!(count(&adapted, kill), 0, "the base game still asked");
        assert!(
            adapted.contains("gui_static_resourcebar.lua=0"),
            "the widget loaded"
        );
        let units = lines_with(&adapted, &["ADAPTER_PROBE units"])[0].to_string();
        assert!(!units.contains("lozscorpion"), "{units}");
        assert!(units.contains("fedak="), "{units}");
        assert_eq!(count(&adapted, "ADAPTER_FIXTURE unitPlaced first"), 1);
        let first = lines_with(&adapted, &["ADAPTER_FIXTURE unitPlaced first"])[0].to_string();
        assert!(!first.contains("def=lozscorpion"), "{first}");
        assert_eq!(count(&adapted, "ADAPTER_FIXTURE afterFrame first"), 1);
        for name in ["game_end", "game_team_com_ends", "gui_static_resourcebar"] {
            let errors: Vec<&str> = lines_with(&adapted, &[name])
                .into_iter()
                .filter(|l| l.to_lowercase().contains("error") || l.contains("Failed"))
                .collect();
            assert!(errors.is_empty(), "{name}: {errors:#?}");
        }

        // 3. The same, with empty files in place of `return false`.
        prepared.rewrite(&[("fixture.lua", HEADLESS_ADAPTER)]);
        let emptied = probed(&prepared, &|game| {
            for rel in &shadows {
                std::fs::write(game.join(rel), "").unwrap();
            }
        });
        report("empty shadows", &emptied);
        // Why a shadow returns `false` and is not empty. Splinter Faction's
        // gadget handler takes an empty file as a gadget with nothing in it and
        // loads it under the file's name, so the log still lists the gadget. Its
        // widget handler refuses an empty file with an error.
        for gadget in ["game_end.lua", "game_team_com_ends.lua"] {
            assert!(
                emptied.contains(&format!("gadget:  {gadget}")),
                "an empty {gadget} did not load as an empty gadget"
            );
        }
        assert!(
            emptied.contains("Failed to load: gui_static_resourcebar.lua  (no GetInfo() call)"),
            "an empty widget was not an error"
        );
    }

    /// The widget that presses the timeline's keys in the engine. It is
    /// written into the game folder for the test below and is not part of the
    /// game.
    const TIMELINE_PROBE: &str = include_str!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../lua/rewind-player/tests/headless/timeline_probe.lua"
    ));

    /// The timeline widget against a real engine and a real game's widget
    /// handler (issue #3798). The game's handler has to load the widget out of
    /// the playback game and turn it on with nothing asked of the game, and
    /// every key and a press on the bar have to change what the player
    /// publishes, which is the message going the whole way round.
    ///
    /// `scripts/rewind-playback-headless.sh` runs this, and it reads the
    /// variables the tests above do.
    ///
    /// The engine is headless, so the widget draws nothing. A draw that does
    /// not raise is all this shows about how it looks.
    #[test]
    #[ignore = "needs an engine, a game, a map and a replay recorded with them"]
    fn the_timeline_drives_the_player_in_the_engine() {
        let Some(prepared) = prepared(true) else {
            return;
        };
        std::fs::write(
            prepared
                .game_dir
                .join("luaui/widgets/coilbox_rewind_timeline_probe.lua"),
            TIMELINE_PROBE,
        )
        .unwrap();

        let (timed_out, output, _) =
            launch(&prepared, &|text| text.contains("TIMELINE_PROBE done"));
        let probe: Vec<&str> = output
            .lines()
            .filter_map(|l| l.split_once("TIMELINE_PROBE ").map(|(_, rest)| rest))
            .collect();
        for l in &probe {
            eprintln!("timeline {l}");
        }
        assert!(!timed_out, "the probe never finished. Log:\n{output}");
        let line = |start: &str| {
            *probe
                .iter()
                .find(|l| l.starts_with(start))
                .unwrap_or_else(|| panic!("no probe line starting {start}"))
        };

        // The game's own handler loaded the widget and it reads the player.
        let loaded = line("loaded=");
        assert_eq!(field(loaded, "loaded"), "1", "{loaded}");
        let (first, last) = (number(loaded, "first"), number(loaded, "last"));
        assert!(last > first, "{loaded}");

        // Every key was taken, and its message arrived.
        let after = |step: &str| {
            let l = line(&format!("{step} "));
            assert_eq!(field(l, "taken"), "1", "{l}");
            assert_eq!(field(l, "arrived"), "1", "{l}");
            l
        };
        assert_eq!(field(after("toggle"), "playing"), "1");
        assert_eq!(field(after("pause"), "playing"), "0");
        assert_eq!(number(after("end"), "frame"), last);
        assert_eq!(number(after("home"), "frame"), first);
        assert_eq!(number(after("right"), "frame"), first + 30.0);
        assert_eq!(number(after("shift_right"), "frame"), first + 330.0);
        assert_eq!(number(after("shift_left"), "frame"), first + 30.0);
        assert_eq!(number(after("left"), "frame"), first);
        assert_eq!(number(after("full_stop"), "frame"), first + 1.0);
        assert_eq!(number(after("comma"), "frame"), first);
        assert_eq!(number(after("minus"), "speed"), 0.5);
        assert_eq!(number(after("equals"), "speed"), 1.0);
        assert_eq!(number(after("plus"), "speed"), 2.0);

        // A key held with Ctrl is left alone and changes nothing.
        let held = line("ctrl_space ");
        assert_eq!(field(held, "taken"), "0", "{held}");
        assert_eq!(field(held, "playing"), "0", "{held}");

        // A press on the middle of the bar seeks to the middle of the track.
        let drag = after("drag");
        assert_eq!(
            number(drag, "frame"),
            (first + (last - first) / 2.0 + 0.5).floor(),
            "{drag}"
        );
        let reverse = after("reverse");
        assert_eq!(field(reverse, "direction"), "-1", "{reverse}");
        assert_eq!(field(reverse, "playing"), "1", "{reverse}");

        // The handler still has the widget, which it drops when one raises,
        // and it was asked to draw in between.
        let still = line("still_loaded=");
        assert_eq!(field(still, "still_loaded"), "1", "{still}");
        assert_eq!(field(still, "config"), "table", "{still}");
        assert!(number(still, "draws") >= 1.0, "{still}");
        let errors: Vec<&str> = output
            .lines()
            .filter(|l| l.to_lowercase().contains("error"))
            .filter(|l| l.contains("coilbox_") || l.contains("Coilbox rewind"))
            .collect();
        assert!(errors.is_empty(), "{errors:#?}");
    }
}
