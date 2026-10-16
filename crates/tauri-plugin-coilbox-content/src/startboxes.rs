//! The start boxes a map or a game defines for Zero-K (issue #4194).
//!
//! Zero-K's `ParseBoxes` (`LuaRules/Gadgets/Include/startbox_utilities.lua`)
//! takes the first of two files that exists: the game's
//! `LuaRules/Configs/StartBoxes/<map name>.lua`, then the map's
//! `mapconfig/map_startboxes.lua`. Both are Lua returning one entry per box,
//! each with polygons, suggested start points and the side's names. They are
//! code, so they run in the springlua sandbox with the `Game` constants and the
//! `GetTeamCount` Zero-K gives them, and a file that fails is no boxes at all.

use std::collections::{BTreeMap, VecDeque};
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use coilbox_springlua::{GameConstants, SpringLua};
use picoframe_core::CliResult;
use serde::{Deserialize, Serialize};
use serde_json::json;

/// The folder in the game holding one file per map, named after the map.
pub const GAME_DIR: &str = "LuaRules/Configs/StartBoxes/";
/// The file in the map archive.
pub const MAP_FILE: &str = "mapconfig/map_startboxes.lua";

/// Which archive a file was read from.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Source {
    Game,
    Map,
}

/// One box id's areas, as the file declared them. Zero-K hands boxes to ally
/// teams at random unless shuffling is off, so the id is the box's, not a team's.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct StartBoxTeam {
    pub id: i64,
    #[serde(rename(serialize = "nameLong", deserialize = "namelong"), default)]
    pub name_long: Option<String>,
    #[serde(rename(serialize = "nameShort", deserialize = "nameshort"), default)]
    pub name_short: Option<String>,
    /// Suggested start positions, as `[x, z]` in world units.
    #[serde(rename(serialize = "startPoints", deserialize = "startpoints"))]
    pub start_points: Vec<[f64; 2]>,
    /// Polygons, each a list of `[x, z]` corners in world units.
    pub boxes: Vec<Vec<[f64; 2]>>,
}

/// The boxes for one map, and the file they came from.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct StartBoxConfig {
    pub source: Source,
    pub file: String,
    pub teams: Vec<StartBoxTeam>,
}

#[derive(Deserialize)]
struct Evaluated {
    teams: Vec<StartBoxTeam>,
}

/// Runs the file at `__PATH__` and rewrites what it returned as a sequence of
/// boxes in id order, shifting a file that counts from 1 down to 0 as
/// `ParseBoxes` does. Keys are lower case because `eval_to` lowers them.
const WRAPPER: &str = r#"
function GetTeamCount() return __TEAMS__ end
Spring.Utilities = Spring.Utilities or {}
Spring.Utilities.GetTeamCount = GetTeamCount

local config = VFS.Include(__PATH__)
if type(config) ~= "table" then
  error("the file returned " .. type(config) .. ", not a table")
end
local ids = {}
for id in pairs(config) do
  if type(id) == "number" then ids[#ids + 1] = id end
end
table.sort(ids)
local shift = (config[0] == nil and config[1] ~= nil) and 1 or 0

local function point(p, what)
  local x = type(p) == "table" and tonumber(p[1])
  local z = type(p) == "table" and tonumber(p[2])
  if not x or not z then error(what .. " is not a pair of numbers") end
  return { x, z }
end

local out = {}
for _, id in ipairs(ids) do
  local team = config[id]
  if type(team) ~= "table" then error("box " .. id .. " is not a table") end
  local boxes = {}
  for i, polygon in ipairs(team.boxes or {}) do
    local corners = {}
    for j, corner in ipairs(polygon) do
      corners[j] = point(corner, "corner " .. j .. " of polygon " .. i .. " of box " .. id)
    end
    boxes[i] = corners
  end
  local points = {}
  for i, p in ipairs(team.startpoints or {}) do
    points[i] = point(p, "start point " .. i .. " of box " .. id)
  end
  out[#out + 1] = {
    id = id - shift,
    namelong = team.nameLong,
    nameshort = team.nameShort,
    startpoints = points,
    boxes = boxes,
  }
end
return { teams = out }
"#;

/// The boxes for `game.map_name`, read in Zero-K's order. `read` fetches a
/// file from the game or the map archive, `None` when the archive has no such
/// file. `Ok(None)` when neither file exists. An `Err` is a file that failed to
/// read or evaluate, which the caller treats as no boxes.
pub fn find(
    mut read: impl FnMut(Source, &str) -> Result<Option<String>, String>,
    game: &GameConstants,
    team_count: u32,
) -> Result<Option<StartBoxConfig>, String> {
    let game_file = format!("{GAME_DIR}{}.lua", game.map_name);
    let (source, file, text) = if let Some(text) = read(Source::Game, &game_file)? {
        (Source::Game, game_file, text)
    } else if let Some(text) = read(Source::Map, MAP_FILE)? {
        (Source::Map, MAP_FILE.to_string(), text)
    } else {
        return Ok(None);
    };
    let files = gather(&mut |path| read(source, path), &file, text)?;
    let teams = evaluate(files, &file, game, team_count).map_err(|e| format!("{file}: {e}"))?;
    Ok(Some(StartBoxConfig {
        source,
        file,
        teams,
    }))
}

/// Evaluate `file` out of `files` and read the boxes it returns.
pub fn evaluate(
    files: BTreeMap<String, String>,
    file: &str,
    game: &GameConstants,
    team_count: u32,
) -> Result<Vec<StartBoxTeam>, String> {
    // A root nothing is ever written to, so every read is one of `files`.
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let root =
        std::env::temp_dir().join(format!("coilbox-startboxes-{}-{nanos}", std::process::id()));
    let files: BTreeMap<PathBuf, String> = files
        .into_iter()
        .map(|(path, text)| (root.join(path), text))
        .collect();
    let lua = SpringLua::with_files(&root, files).map_err(|e| e.to_string())?;
    lua.set_game(game).map_err(|e| e.to_string())?;
    let path = if file.starts_with(GAME_DIR) {
        format!("\"{GAME_DIR}\" .. Game.mapName .. \".lua\"")
    } else {
        format!("\"{MAP_FILE}\"")
    };
    let src = WRAPPER
        .replace("__TEAMS__", &team_count.to_string())
        .replace("__PATH__", &path);
    let out: Evaluated = lua.eval_to(&src, "startboxes").map_err(|e| e.to_string())?;
    Ok(out.teams)
}

/// `first` and every file it pulls in through `VFS.Include` with a literal
/// name, read with `read`. Several of Zero-K's game files include a shared
/// `helpers.lua` or another map's file. A name the archive does not hold is
/// left out, and the evaluation then fails on it with the name in the error.
fn gather(
    read: &mut dyn FnMut(&str) -> Result<Option<String>, String>,
    first: &str,
    text: String,
) -> Result<BTreeMap<String, String>, String> {
    let mut files = BTreeMap::new();
    let mut queue = VecDeque::from([(first.to_string(), text)]);
    while let Some((path, text)) = queue.pop_front() {
        for included in included_names(&text) {
            let seen = included.eq_ignore_ascii_case(&path)
                || files
                    .keys()
                    .chain(queue.iter().map(|(p, _)| p))
                    .any(|p: &String| p.eq_ignore_ascii_case(&included));
            if seen {
                continue;
            }
            if let Some(found) = read(&included)? {
                queue.push_back((included, found));
            }
        }
        files.insert(path, text);
    }
    Ok(files)
}

/// The quoted names in `VFS.Include("...")` calls in `text`.
fn included_names(text: &str) -> Vec<String> {
    const CALL: &str = "VFS.Include";
    let mut names = Vec::new();
    let mut rest = text;
    while let Some(at) = rest.find(CALL) {
        rest = &rest[at + CALL.len()..];
        let args = rest.trim_start();
        let args = args.strip_prefix('(').unwrap_or(args).trim_start();
        let Some(quote) = args.chars().next().filter(|c| *c == '"' || *c == '\'') else {
            continue;
        };
        if let Some(end) = args[1..].find(quote) {
            names.push(args[1..1 + end].to_string());
        }
    }
    names
}

/// `content_start_boxes`: the start boxes Zero-K uses on `mapName`, read from
/// `gameArchive` and the map (issue #4194). `mapSizeX` and `mapSizeZ` are the
/// map's size in world units and `teamCount` the number of ally teams with
/// somebody on them, which is what Zero-K's `GetTeamCount` answers.
///
/// Answers `{ config }`, where `config` is null when neither file exists or
/// the file failed. A failure is logged and its reason returned as `error`.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub(crate) async fn content_start_boxes(
    engine_path: String,
    data_dir: String,
    game_archive: String,
    map_name: String,
    map_size_x: f64,
    map_size_z: f64,
    team_count: u32,
) -> CliResult {
    let game = GameConstants {
        map_name: map_name.clone(),
        map_size_x,
        map_size_z,
    };
    let archive = game_archive.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        find(
            |source, file| {
                let archive = match source {
                    Source::Game => &archive,
                    Source::Map => &game.map_name,
                };
                tauri_plugin_coilbox_unitsync::archive_text_blocking(
                    &engine_path,
                    &data_dir,
                    archive,
                    file,
                )
            },
            &game,
            team_count,
        )
    })
    .await
    .unwrap_or_else(|e| Err(format!("the start box task failed: {e}")));
    match result {
        Ok(config) => CliResult::ok(json!({ "config": config })),
        Err(e) => {
            eprintln!("[start-boxes] no start boxes for {map_name} in {game_archive}: {e}");
            CliResult::ok(json!({ "config": null, "error": e }))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn game(name: &str, x: f64, z: f64) -> GameConstants {
        GameConstants {
            map_name: name.into(),
            map_size_x: x,
            map_size_z: z,
        }
    }

    /// A reader over two in-memory archives, recording what was asked for.
    fn archives<'a>(
        game_files: &'a [(&'a str, &'a str)],
        map_files: &'a [(&'a str, &'a str)],
        asked: &'a mut Vec<(Source, String)>,
    ) -> impl FnMut(Source, &str) -> Result<Option<String>, String> + 'a {
        move |source, path| {
            asked.push((source, path.to_string()));
            let files = match source {
                Source::Game => game_files,
                Source::Map => map_files,
            };
            Ok(files
                .iter()
                .find(|(p, _)| p.eq_ignore_ascii_case(path))
                .map(|(_, text)| text.to_string()))
        }
    }

    /// The map side format: a 1-based list with quoted keys, as maps exported
    /// from Zero-K's box editor write it, and a polygon of more than four corners.
    const MAP_SIDE: &str = r#"
return {
	{
		["nameLong"] = "South",
		["nameShort"] = "S",
		["startpoints"] = { {5120, 8782.5} },
		["boxes"] = {
			{ {0, 7673.2}, {2458.5, 7600.8}, {10240, 7766.4}, {10240, 10240}, {0, 10240} },
		},
	},
	{
		["nameLong"] = "North",
		["nameShort"] = "N",
		["startpoints"] = { {5120, 1457.3} },
		["boxes"] = { { {10240, 2566.8}, {0, 2473.6}, {0, 0}, {10240, 0} } },
	},
}
"#;

    #[test]
    fn reads_the_map_side_format_counting_from_zero() {
        let mut asked = Vec::new();
        let config = find(
            archives(&[], &[(MAP_FILE, MAP_SIDE)], &mut asked),
            &game("Sailaway 2", 10240.0, 10240.0),
            2,
        )
        .unwrap()
        .expect("boxes");
        assert_eq!(config.source, Source::Map);
        assert_eq!(config.file, MAP_FILE);
        assert_eq!(config.teams.len(), 2);
        let south = &config.teams[0];
        assert_eq!(south.id, 0);
        assert_eq!(south.name_long.as_deref(), Some("South"));
        assert_eq!(south.name_short.as_deref(), Some("S"));
        assert_eq!(south.start_points, vec![[5120.0, 8782.5]]);
        assert_eq!(south.boxes[0].len(), 5);
        assert_eq!(config.teams[1].id, 1);
        assert_eq!(config.teams[1].boxes[0][0], [10240.0, 2566.8]);
    }

    /// The game side format: 0-based keys, a second return value Zero-K
    /// ignores, and a box mirrored from the first through `Game.mapSizeX`.
    const MIRRORED: &str = r#"
local layout = {
	[0] = {
		boxes = { { {0, 0}, {800, 0}, {800, 2048}, {0, 2048} } },
		startpoints = { {400, 1024} },
		nameLong = "West",
		nameShort = "W",
	},
	[1] = { boxes = {}, startpoints = {}, nameLong = "East", nameShort = "E" },
}
for i, corner in ipairs(layout[0].boxes[1]) do
	layout[1].boxes[1] = layout[1].boxes[1] or {}
	layout[1].boxes[1][i] = { Game.mapSizeX - corner[1], Game.mapSizeZ - corner[2] }
end
layout[1].startpoints[1] = { Game.mapSizeX - 400, Game.mapSizeZ - 1024 }
return layout, { 2 }
"#;

    #[test]
    fn reads_the_game_side_format_and_game_map_size() {
        let mut asked = Vec::new();
        let config = find(
            archives(
                &[("LuaRules/Configs/StartBoxes/Mirror 1.lua", MIRRORED)],
                &[],
                &mut asked,
            ),
            &game("Mirror 1", 7168.0, 2048.0),
            2,
        )
        .unwrap()
        .expect("boxes");
        assert_eq!(config.source, Source::Game);
        assert_eq!(config.file, "LuaRules/Configs/StartBoxes/Mirror 1.lua");
        let ids: Vec<i64> = config.teams.iter().map(|t| t.id).collect();
        assert_eq!(ids, vec![0, 1]);
        let east = &config.teams[1];
        assert_eq!(east.name_short.as_deref(), Some("E"));
        assert_eq!(east.start_points, vec![[6768.0, 1024.0]]);
        assert_eq!(east.boxes[0][1], [6368.0, 2048.0]);
    }

    /// A file that hands out boxes by the number of teams, as older map files
    /// and many of Zero-K's own do, both through the bare global and through
    /// `Spring.Utilities`.
    const BY_TEAM_COUNT: &str = r#"
local function box(x) return { boxes = { { {x, 0}, {x + 100, 0}, {x + 100, 100} } }, startpoints = { {x + 50, 50} } } end
local ret = { [0] = box(0), [1] = box(1000) }
if GetTeamCount() > 2 then ret[2] = box(2000) end
if Spring.Utilities.GetTeamCount() > 3 then ret[3] = box(3000) end
return ret
"#;

    #[test]
    fn get_team_count_answers_the_rooms_team_count() {
        for (teams, boxes) in [(2, 2), (3, 3), (4, 4)] {
            let mut asked = Vec::new();
            let config = find(
                archives(&[], &[(MAP_FILE, BY_TEAM_COUNT)], &mut asked),
                &game("Count", 4096.0, 4096.0),
                teams,
            )
            .unwrap()
            .expect("boxes");
            assert_eq!(config.teams.len(), boxes, "with {teams} teams");
        }
    }

    #[test]
    fn the_games_file_wins_over_the_maps() {
        let mut asked = Vec::new();
        let config = find(
            archives(
                &[("LuaRules/Configs/StartBoxes/Sailaway 2.lua", MIRRORED)],
                &[(MAP_FILE, MAP_SIDE)],
                &mut asked,
            ),
            &game("Sailaway 2", 7168.0, 2048.0),
            2,
        )
        .unwrap()
        .expect("boxes");
        assert_eq!(config.source, Source::Game);
        assert_eq!(config.teams[0].name_long.as_deref(), Some("West"));
        assert!(
            asked.iter().all(|(source, _)| *source == Source::Game),
            "the map is not read once the game has a file: {asked:?}"
        );
    }

    #[test]
    fn the_maps_file_is_read_when_the_game_has_none() {
        let mut asked = Vec::new();
        let config = find(
            archives(&[], &[(MAP_FILE, MAP_SIDE)], &mut asked),
            &game("Sailaway 2", 10240.0, 10240.0),
            2,
        )
        .unwrap()
        .expect("boxes");
        assert_eq!(config.source, Source::Map);
        assert_eq!(
            asked,
            vec![
                (
                    Source::Game,
                    "LuaRules/Configs/StartBoxes/Sailaway 2.lua".to_string()
                ),
                (Source::Map, MAP_FILE.to_string()),
            ]
        );
    }

    #[test]
    fn no_file_is_no_boxes() {
        let mut asked = Vec::new();
        let config = find(archives(&[], &[], &mut asked), &game("Plain", 1.0, 1.0), 2).unwrap();
        assert_eq!(config, None);
    }

    #[test]
    fn a_file_that_fails_is_an_error_naming_it() {
        let mut asked = Vec::new();
        let broken = "return { [0] = { boxes = { { {0, 0}, {Spring.NoSuchCall(), 0} } } } }";
        let err = find(
            archives(&[], &[(MAP_FILE, broken)], &mut asked),
            &game("Broken", 1.0, 1.0),
            2,
        )
        .unwrap_err();
        assert!(err.starts_with(MAP_FILE), "{err}");

        let mut asked = Vec::new();
        let not_a_point = "return { [0] = { boxes = { { {0, 'west'} } }, startpoints = {} } }";
        let err = find(
            archives(&[], &[(MAP_FILE, not_a_point)], &mut asked),
            &game("Broken", 1.0, 1.0),
            2,
        )
        .unwrap_err();
        assert!(err.contains("not a pair of numbers"), "{err}");
    }

    /// A game file that is one line pointing at another map's, and one that
    /// pulls in a shared helper, both get the file they include.
    #[test]
    fn follows_literal_includes_inside_the_same_archive() {
        let mut asked = Vec::new();
        let config = find(
            archives(
                &[
                    (
                        "LuaRules/Configs/StartBoxes/Mirror 1.1.lua",
                        "return VFS.Include(\"LuaRules/Configs/StartBoxes/Mirror 1.lua\")",
                    ),
                    ("LuaRules/Configs/StartBoxes/Mirror 1.lua", MIRRORED),
                ],
                &[],
                &mut asked,
            ),
            &game("Mirror 1.1", 7168.0, 2048.0),
            2,
        )
        .unwrap()
        .expect("boxes");
        assert_eq!(config.teams.len(), 2);
        assert_eq!(config.file, "LuaRules/Configs/StartBoxes/Mirror 1.1.lua");
    }

    #[test]
    fn included_names_reads_both_quotes_and_no_parentheses() {
        let text = r#"local a = VFS.Include("a.lua") local b = VFS.Include ( 'b.lua', nil, VFS.GAME ) local c = VFS.Include "c.lua" local d = VFS.Include(name)"#;
        assert_eq!(included_names(text), vec!["a.lua", "b.lua", "c.lua"]);
    }

    /// Every file under `COILBOX_STARTBOX_SWEEP`, evaluated the way the app
    /// evaluates it, for checking the format against real maps and a checkout
    /// of Zero-K's `LuaRules/Configs/StartBoxes`. Prints one line per file.
    #[test]
    #[ignore = "needs COILBOX_STARTBOX_SWEEP naming a folder of start box files"]
    fn sweep() {
        let dir = std::env::var("COILBOX_STARTBOX_SWEEP").expect("COILBOX_STARTBOX_SWEEP");
        let mut entries: Vec<_> = std::fs::read_dir(&dir)
            .unwrap()
            .flatten()
            .map(|e| e.path())
            .filter(|p| p.extension().is_some_and(|e| e == "lua"))
            .collect();
        entries.sort();
        let (mut good, mut bad) = (0, 0);
        for path in entries {
            let name = path.file_stem().unwrap().to_string_lossy().into_owned();
            let siblings: Vec<(String, String)> = std::fs::read_dir(&dir)
                .unwrap()
                .flatten()
                .filter_map(|e| {
                    let file = e.file_name().to_string_lossy().into_owned();
                    let text = std::fs::read_to_string(e.path()).ok()?;
                    Some((format!("{GAME_DIR}{file}"), text))
                })
                .collect();
            let result = find(
                |_, wanted| {
                    Ok(siblings
                        .iter()
                        .find(|(p, _)| p.eq_ignore_ascii_case(wanted))
                        .map(|(_, t)| t.clone()))
                },
                &game(&name, 8192.0, 8192.0),
                2,
            );
            match result {
                Ok(Some(config)) => {
                    good += 1;
                    let corners: usize = config
                        .teams
                        .iter()
                        .flat_map(|t| &t.boxes)
                        .map(Vec::len)
                        .sum();
                    println!(
                        "ok   {name}: {} boxes, {corners} corners",
                        config.teams.len()
                    );
                }
                Ok(None) => println!("none {name}"),
                Err(e) => {
                    bad += 1;
                    println!("FAIL {name}: {e}");
                }
            }
        }
        println!("{good} evaluated, {bad} failed");
    }
}
