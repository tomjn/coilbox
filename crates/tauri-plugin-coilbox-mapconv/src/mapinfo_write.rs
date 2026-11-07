//! Writes `mapinfo.lua` next to a compiled map.
//!
//! The file is built as a list of [`Edit`]s applied one after another by
//! [`crate::luapatch`], on either an existing `mapinfo.lua` or an empty
//! skeleton. A later feature that adds a section (`resources`, `splats`) adds
//! edits to [`edits`] and nothing else changes.
//!
//! Which fields the page owns:
//! - Always rewritten, because they describe the compile that just ran:
//!   `mapfile`, `smf.minheight`, `smf.maxheight`, `smf.smtFileName0`.
//! - Rewritten when the page sends a value: `name`, `shortname`, `description`,
//!   `author`, the shading colours, the terrain hardness and the start
//!   positions (an empty list removes `teams`; a shorter one removes the teams
//!   past its end). `name` and `shortname` fall back to the output name when the
//!   file has none.
//! - Written only when the file is new: the atmosphere, lighting, water and
//!   terrain type defaults, plus the engine's global defaults.
//! - Everything else in an existing file is left exactly as it was.

use std::path::{Path, PathBuf};

use coilbox_springlua::SpringLua;
use serde::Deserialize;

use crate::luapatch::{apply, index_keys, remove, Key, Mode, Val};
use crate::{mapinfo, smf};

/// A team's start position, in elmos.
#[derive(Deserialize, Debug, Clone, Copy, PartialEq)]
pub struct StartPos {
    pub x: f64,
    pub z: f64,
}

/// What the Compile page sends. An absent field means the page has no opinion.
#[derive(Deserialize, Debug, Default, Clone)]
#[serde(default, rename_all = "camelCase")]
pub struct MapinfoForm {
    pub name: Option<String>,
    pub shortname: Option<String>,
    pub description: Option<String>,
    pub author: Option<String>,
    pub sky_color: Option<[f64; 3]>,
    pub fog_color: Option<[f64; 3]>,
    pub sun_color: Option<[f64; 3]>,
    pub sun_dir: Option<[f64; 3]>,
    pub ground_ambient_color: Option<[f64; 3]>,
    pub ground_diffuse_color: Option<[f64; 3]>,
    pub water_surface_color: Option<[f64; 3]>,
    pub water_surface_alpha: Option<f64>,
    pub terrain_hardness: Option<f64>,
    /// One slot per team, in team order. A slot that is `None` is a row the page
    /// left unfilled. The whole list absent means the page has no opinion, and
    /// an empty list means the map has no start positions.
    pub start_positions: Option<Vec<Option<StartPos>>>,
}

#[derive(Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct WriteOpts {
    pub out_dir: String,
    /// The compile's `-o`. The `.smf` and `.smt` are `<out_suffix>.smf` and `.smt`.
    pub out_suffix: String,
    /// The compile's `-minh` and `-maxh`. When absent the `.smf` header is read.
    pub min_height: Option<f64>,
    pub max_height: Option<f64>,
    #[serde(default)]
    pub info: MapinfoForm,
}

#[derive(Debug)]
pub struct Written {
    pub path: PathBuf,
    /// The file did not exist before.
    pub created: bool,
    /// The file's text differs from what was there.
    pub changed: bool,
}

/// One change to the file.
pub enum Edit {
    Put {
        path: Vec<Key>,
        val: Val,
        mode: Mode,
    },
    /// Delete the field. A field the file does not have is left alone.
    Remove { path: Vec<Key> },
    /// Delete the integer keyed fields of the table at `path` numbered `keep`
    /// or higher.
    Trim { path: Vec<Key>, keep: usize },
}

const SKELETON: &str = "local mapinfo = {\n}\n\nreturn mapinfo\n";

fn n(s: &str) -> Key {
    Key::Name(s.into())
}

fn put(path: &[&str], val: Val, mode: Mode) -> Edit {
    Edit::Put {
        path: path.iter().map(|s| n(s)).collect(),
        val,
        mode,
    }
}

fn set(path: &[&str], val: Val) -> Edit {
    put(path, val, Mode::Set)
}

fn default(path: &[&str], val: Val) -> Edit {
    put(path, val, Mode::Default)
}

fn table(entries: Vec<(&str, Val)>) -> Val {
    Val::Table(entries.into_iter().map(|(k, v)| (n(k), v)).collect())
}

fn rgb(c: [f64; 3]) -> Val {
    Val::Array(c.to_vec())
}

fn text(s: &str) -> Val {
    Val::Str(s.into())
}

/// Trimmed text, or `None` when the page left the field empty.
fn filled(s: &Option<String>) -> Option<&str> {
    s.as_deref().map(str::trim).filter(|s| !s.is_empty())
}

/// The values a new file starts with. Colours, wind and shadow densities are
/// the engine's own defaults (`rts/Map/MapInfo.cpp`), so a map that never
/// changes them looks the same as one with no entry at all.
fn new_file_defaults() -> Vec<Edit> {
    let speeds = || {
        table(vec![
            ("tank", Val::Num(1.0)),
            ("kbot", Val::Num(1.0)),
            ("hover", Val::Num(1.0)),
            ("ship", Val::Num(1.0)),
        ])
    };
    vec![
        default(&["maphardness"], Val::Num(100.0)),
        default(&["gravity"], Val::Num(130.0)),
        default(&["tidalStrength"], Val::Num(0.0)),
        default(&["maxMetal"], Val::Num(0.02)),
        default(&["extractorRadius"], Val::Num(500.0)),
        default(&["voidWater"], Val::Bool(false)),
        default(
            &["atmosphere"],
            table(vec![
                ("minWind", Val::Num(5.0)),
                ("maxWind", Val::Num(25.0)),
                ("fogStart", Val::Num(0.1)),
                ("fogEnd", Val::Num(1.0)),
                ("fogColor", rgb([0.7, 0.7, 0.8])),
                ("skyColor", rgb([0.1, 0.15, 0.7])),
                ("sunColor", rgb([1.0, 1.0, 1.0])),
                ("cloudColor", rgb([1.0, 1.0, 1.0])),
                ("cloudDensity", Val::Num(0.5)),
            ]),
        ),
        default(
            &["lighting"],
            table(vec![
                ("sunDir", rgb([0.0, 1.0, 2.0])),
                ("groundAmbientColor", rgb([0.5, 0.5, 0.5])),
                ("groundDiffuseColor", rgb([0.5, 0.5, 0.5])),
                ("groundSpecularColor", rgb([0.1, 0.1, 0.1])),
                ("groundShadowDensity", Val::Num(0.8)),
                ("unitAmbientColor", rgb([0.4, 0.4, 0.4])),
                ("unitDiffuseColor", rgb([0.7, 0.7, 0.7])),
                ("unitShadowDensity", Val::Num(0.8)),
            ]),
        ),
        default(
            &["water"],
            table(vec![
                ("surfaceColor", rgb([0.75, 0.8, 0.85])),
                ("surfaceAlpha", Val::Num(0.55)),
            ]),
        ),
        Edit::Put {
            path: vec![n("terrainTypes")],
            val: Val::Table(vec![(
                Key::Index(0),
                table(vec![
                    ("name", text("Default")),
                    ("hardness", Val::Num(1.0)),
                    ("receiveTracks", Val::Bool(true)),
                    ("moveSpeeds", speeds()),
                ]),
            )]),
            mode: Mode::Default,
        },
    ]
}

/// Every edit for one write, in the order they apply. A new file takes its key
/// order from this list. The identity and the compile's files come first, then
/// the defaults, then the form's overrides, which need the defaults' tables to
/// exist so they change a value instead of starting a half empty table.
pub fn edits(opts: &WriteOpts, min_height: f64, max_height: f64, new_file: bool) -> Vec<Edit> {
    let suffix = opts.out_suffix.trim();
    let form = &opts.info;
    let mut out = Vec::new();

    for (key, value) in [("name", &form.name), ("shortname", &form.shortname)] {
        match filled(value) {
            Some(v) => out.push(set(&[key], text(v))),
            None => out.push(default(&[key], text(suffix))),
        }
    }
    for (key, value) in [("description", &form.description), ("author", &form.author)] {
        if let Some(v) = filled(value) {
            out.push(set(&[key], text(v)));
        }
    }

    out.push(set(&["mapfile"], text(&format!("{suffix}.smf"))));
    out.push(set(&["smf", "minheight"], Val::Num(min_height)));
    out.push(set(&["smf", "maxheight"], Val::Num(max_height)));
    out.push(set(
        &["smf", "smtFileName0"],
        text(&format!("{suffix}.smt")),
    ));

    if new_file {
        out.extend(new_file_defaults());
    }

    let colours: [(&[&str], Option<[f64; 3]>); 7] = [
        (&["atmosphere", "skyColor"], form.sky_color),
        (&["atmosphere", "fogColor"], form.fog_color),
        (&["atmosphere", "sunColor"], form.sun_color),
        (&["lighting", "sunDir"], form.sun_dir),
        (
            &["lighting", "groundAmbientColor"],
            form.ground_ambient_color,
        ),
        (
            &["lighting", "groundDiffuseColor"],
            form.ground_diffuse_color,
        ),
        (&["water", "surfaceColor"], form.water_surface_color),
    ];
    for (path, value) in colours {
        if let Some(c) = value {
            out.push(set(path, rgb(c)));
        }
    }
    if let Some(a) = form.water_surface_alpha {
        out.push(set(&["water", "surfaceAlpha"], Val::Num(a)));
    }
    if let Some(h) = form.terrain_hardness {
        out.push(Edit::Put {
            path: vec![n("terrainTypes"), Key::Index(0), n("hardness")],
            val: Val::Num(h),
            mode: Mode::Set,
        });
    }

    // Row `i` is team `i`, so the rows after a removed one move down a slot and
    // the file's teams from the end of the list on are deleted. The engine stops
    // reading start positions at the first team that has none, so leaving a gap
    // would hide every team after it. A row the page left incomplete is `None`
    // and keeps its team number: it is left as the file has it.
    match &form.start_positions {
        None => {}
        Some(rows) if rows.is_empty() => out.push(Edit::Remove {
            path: vec![n("teams")],
        }),
        Some(rows) => {
            for (team, pos) in rows.iter().enumerate() {
                let Some(pos) = pos else { continue };
                for (axis, v) in [("x", pos.x), ("z", pos.z)] {
                    out.push(Edit::Put {
                        path: vec![n("teams"), Key::Index(team as i64), n("startPos"), n(axis)],
                        val: Val::Num(v),
                        mode: Mode::Set,
                    });
                }
            }
            out.push(Edit::Trim {
                path: vec![n("teams")],
                keep: rows.len(),
            });
        }
    }
    out
}

/// Apply `edits` to `src`.
pub fn patch(src: &str, edits: &[Edit]) -> Result<String, String> {
    edits.iter().try_fold(src.to_string(), |text, e| match e {
        Edit::Put { path, val, mode } => apply(&text, path, val, *mode),
        Edit::Remove { path } => remove(&text, path),
        Edit::Trim { path, keep } => {
            let mut text = text;
            for i in index_keys(&text, path)? {
                if usize::try_from(i).map_or(true, |i| i >= *keep) {
                    let mut at = path.clone();
                    at.push(Key::Index(i));
                    text = remove(&text, &at)?;
                }
            }
            Ok(text)
        }
    })
}

/// The file's text must still evaluate when it did before. A patch that breaks
/// a file the mapper had working is refused, not written.
fn evaluates(dir: &Path, src: &str) -> bool {
    mapinfo::eval_appearance(dir, src).is_some()
}

fn heights(opts: &WriteOpts, dir: &Path) -> Result<(f64, f64), String> {
    if let (Some(lo), Some(hi)) = (opts.min_height, opts.max_height) {
        return Ok((lo, hi));
    }
    let smf_path = dir.join(format!("{}.smf", opts.out_suffix.trim()));
    let header = std::fs::read(&smf_path)
        .map_err(|e| format!("could not read {}: {e}", smf_path.display()))
        .and_then(|b| smf::parse_smf_header(&b))?;
    Ok((
        opts.min_height.unwrap_or(f64::from(header.min_height)),
        opts.max_height.unwrap_or(f64::from(header.max_height)),
    ))
}

/// The engine's `MAX_TEAMS` (`rts/Sim/Misc/GlobalConstants.h`). A team number
/// past it is never read, so it is not loaded into the page.
const MAX_TEAMS: usize = 255;

/// The start positions `<dir>/mapinfo.lua` holds, one slot per team up to the
/// highest team that has an entry. A team with no readable `startPos` is `None`.
/// Empty when there is no file or it has no teams. The file is evaluated, so
/// teams a mapper computed are read too.
pub fn read_teams(dir: &Path) -> Result<Vec<Option<StartPos>>, String> {
    let path = dir.join("mapinfo.lua");
    let src = match std::fs::read_to_string(&path) {
        Ok(s) => s,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => return Err(format!("could not read {}: {e}", path.display())),
    };
    let value = SpringLua::new(dir)
        .and_then(|lua| {
            lua.eval_expr_value(&format!("(function()\n{src}\nend)()"), "mapinfo.lua")
        })
        .map_err(|e| format!("could not evaluate {}: {e}", path.display()))?;
    let field = |v: &serde_json::Value, name: &str| {
        v.as_object()?
            .iter()
            .find(|(k, _)| k.eq_ignore_ascii_case(name))
            .map(|(_, v)| v.clone())
    };
    let start = |team: &serde_json::Value| {
        let pos = field(team, "startPos")?;
        Some(StartPos {
            x: field(&pos, "x")?.as_f64()?,
            z: field(&pos, "z")?.as_f64()?,
        })
    };
    // A table written as a list has Lua keys from 1, so its first entry is team 1.
    let entries: Vec<(usize, serde_json::Value)> = match field(&value, "teams") {
        Some(serde_json::Value::Object(map)) => map
            .into_iter()
            .filter_map(|(k, v)| Some((k.parse().ok()?, v)))
            .collect(),
        Some(serde_json::Value::Array(list)) => list
            .into_iter()
            .enumerate()
            .map(|(i, v)| (i + 1, v))
            .collect(),
        _ => Vec::new(),
    };
    let mut teams = Vec::new();
    for (team, entry) in entries.into_iter().filter(|(t, _)| *t < MAX_TEAMS) {
        if teams.len() <= team {
            teams.resize(team + 1, None);
        }
        teams[team] = start(&entry);
    }
    Ok(teams)
}

/// Write `<out_dir>/mapinfo.lua`, creating it or patching the one there.
pub fn write(opts: &WriteOpts) -> Result<Written, String> {
    let suffix = opts.out_suffix.trim();
    if suffix.is_empty() {
        return Err("the output name is empty".into());
    }
    let dir = PathBuf::from(&opts.out_dir);
    let path = dir.join("mapinfo.lua");
    let existing = match std::fs::read_to_string(&path) {
        Ok(s) => Some(s),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => None,
        Err(e) => return Err(format!("could not read {}: {e}", path.display())),
    };
    let smf_path = dir.join(format!("{suffix}.smf"));
    if !smf_path.is_file() {
        return Err(format!(
            "{} is not there. Compile the map first.",
            smf_path.display()
        ));
    }
    let (min_height, max_height) = heights(opts, &dir)?;
    let before = existing.as_deref().unwrap_or(SKELETON);
    let after = patch(
        before,
        &edits(opts, min_height, max_height, existing.is_none()),
    )?;

    if existing.as_deref().is_some_and(|e| evaluates(&dir, e)) && !evaluates(&dir, &after) {
        return Err(format!(
            "the edited {} no longer evaluates, so nothing was written",
            path.display()
        ));
    }
    let changed = existing.as_deref() != Some(after.as_str());
    if changed {
        let tmp = dir.join("mapinfo.lua.tmp");
        std::fs::write(&tmp, &after)
            .map_err(|e| format!("could not write {}: {e}", tmp.display()))?;
        std::fs::rename(&tmp, &path)
            .map_err(|e| format!("could not replace {}: {e}", path.display()))?;
    }
    Ok(Written {
        path,
        created: existing.is_none(),
        changed,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Options for `mymap`, with a stand-in `.smf` in `dir` unless one is there.
    fn opts(dir: &Path) -> WriteOpts {
        let smf = dir.join("mymap.smf");
        if !smf.exists() {
            std::fs::write(smf, b"stand-in").unwrap();
        }
        WriteOpts {
            out_dir: dir.to_string_lossy().into(),
            out_suffix: "mymap".into(),
            min_height: Some(-20.0),
            max_height: Some(480.0),
            info: MapinfoForm::default(),
        }
    }

    fn temp_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "coilbox-mapinfo-write-{}-{tag}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// The file's table as JSON, keys as written. Integer keys come back as
    /// strings, so `teams[0]` is `v["teams"]["0"]`.
    fn eval(dir: &Path) -> serde_json::Value {
        let src = std::fs::read_to_string(dir.join("mapinfo.lua")).unwrap();
        SpringLua::new(dir)
            .unwrap()
            .eval_expr_value(&format!("(function()\n{src}\nend)()"), "mapinfo.lua")
            .unwrap()
    }

    #[test]
    fn a_new_file_evaluates_with_the_compile_values() {
        let dir = temp_dir("new");
        let mut o = opts(&dir);
        o.info.description = Some("A test map".into());
        o.info.author = Some("Tom".into());
        o.info.start_positions = Some(vec![
            Some(StartPos {
                x: 512.0,
                z: 1024.0,
            }),
            Some(StartPos {
                x: 3000.0,
                z: 2000.0,
            }),
        ]);
        let w = write(&o).unwrap();
        assert!(w.created && w.changed);
        let v = eval(&dir);
        assert_eq!(v["name"], "mymap");
        assert_eq!(v["shortname"], "mymap");
        assert_eq!(v["description"], "A test map");
        assert_eq!(v["author"], "Tom");
        assert_eq!(v["mapfile"], "mymap.smf");
        assert_eq!(v["smf"]["minheight"], -20);
        assert_eq!(v["smf"]["maxheight"], 480);
        assert_eq!(v["smf"]["smtFileName0"], "mymap.smt");
        assert_eq!(v["teams"]["1"]["startPos"]["x"], 3000);
        assert_eq!(v["teams"]["0"]["startPos"]["z"], 1024);
        assert_eq!(v["terrainTypes"]["0"]["name"], "Default");
        assert_eq!(v["atmosphere"]["skyColor"][1], 0.15);
        assert_eq!(v["water"]["surfaceAlpha"], 0.55);
    }

    #[test]
    fn a_second_write_keeps_what_the_mapper_changed() {
        let dir = temp_dir("again");
        let mut o = opts(&dir);
        write(&o).unwrap();
        let path = dir.join("mapinfo.lua");
        let hand = std::fs::read_to_string(&path)
            .unwrap()
            .replace("gravity = 130,", "gravity = 90, -- floaty")
            .replace("maxMetal = 0.02", "maxMetal = 1.5");
        std::fs::write(&path, format!("-- my map\n{hand}")).unwrap();

        o.max_height = Some(500.0);
        o.info.start_positions = Some(vec![Some(StartPos { x: 1.0, z: 2.0 })]);
        let w = write(&o).unwrap();
        assert!(!w.created && w.changed);

        let after = std::fs::read_to_string(&path).unwrap();
        assert!(after.starts_with("-- my map\n"));
        assert!(after.contains("gravity = 90, -- floaty"));
        let v = eval(&dir);
        assert_eq!(v["maxMetal"], 1.5);
        assert_eq!(v["smf"]["maxheight"], 500);
        assert_eq!(v["teams"]["0"]["startPos"]["x"], 1);
    }

    #[test]
    fn an_unfilled_start_position_keeps_the_team_numbers_after_it() {
        let dir = temp_dir("gap");
        let mut o = opts(&dir);
        o.info.start_positions = Some(vec![None, None, Some(StartPos { x: 7.0, z: 8.0 })]);
        write(&o).unwrap();
        let v = eval(&dir);
        assert_eq!(v["teams"]["2"]["startPos"]["x"], 7);
        assert!(v["teams"].get("0").is_none());
    }

    const THREE_TEAMS: &str = "-- my map\nlocal mapinfo = {\n    name = \"Mine\",\n    gravity = 130, -- floaty\n    teams = {\n        [0] = { startPos = { x = 1, z = 2 } },\n        [1] = { startPos = { x = 3, z = 4 } }, -- the middle one\n        [2] = { startPos = { x = 5, z = 6 } },\n    },\n}\nreturn mapinfo\n";

    fn pos(x: f64, z: f64) -> Option<StartPos> {
        Some(StartPos { x, z })
    }

    #[test]
    fn a_team_removed_on_the_page_leaves_the_file_with_the_rest_renumbered() {
        let dir = temp_dir("remove-middle");
        std::fs::write(dir.join("mapinfo.lua"), THREE_TEAMS).unwrap();
        let mut o = opts(&dir);
        o.info.start_positions = Some(vec![pos(1.0, 2.0), pos(5.0, 6.0)]);
        write(&o).unwrap();

        let v = eval(&dir);
        assert_eq!(v["teams"]["0"]["startPos"]["x"], 1);
        assert_eq!(v["teams"]["1"]["startPos"]["x"], 5);
        assert_eq!(v["teams"]["1"]["startPos"]["z"], 6);
        assert!(v["teams"].get("2").is_none());
        let text = std::fs::read_to_string(dir.join("mapinfo.lua")).unwrap();
        assert!(text.starts_with("-- my map\n"));
        assert!(text.contains("gravity = 130, -- floaty"));
    }

    #[test]
    fn no_start_positions_removes_the_teams_block_and_nothing_else() {
        let dir = temp_dir("remove-all");
        std::fs::write(dir.join("mapinfo.lua"), THREE_TEAMS).unwrap();
        let mut o = opts(&dir);
        o.info.start_positions = Some(Vec::new());
        write(&o).unwrap();

        let v = eval(&dir);
        assert!(v.get("teams").is_none());
        assert_eq!(v["name"], "Mine");
        let text = std::fs::read_to_string(dir.join("mapinfo.lua")).unwrap();
        assert!(text.contains("gravity = 130, -- floaty"));
        assert!(!text.contains("startPos"));
    }

    #[test]
    fn a_page_with_no_opinion_leaves_the_teams_alone() {
        let dir = temp_dir("no-opinion");
        std::fs::write(dir.join("mapinfo.lua"), THREE_TEAMS).unwrap();
        write(&opts(&dir)).unwrap();
        let v = eval(&dir);
        assert_eq!(v["teams"]["2"]["startPos"]["x"], 5);
    }

    #[test]
    fn an_unfilled_row_is_left_as_the_file_has_it_and_later_teams_stay() {
        let dir = temp_dir("unfilled");
        std::fs::write(dir.join("mapinfo.lua"), THREE_TEAMS).unwrap();
        let mut o = opts(&dir);
        o.info.start_positions = Some(vec![pos(1.0, 2.0), None, pos(7.0, 8.0)]);
        write(&o).unwrap();
        let v = eval(&dir);
        assert_eq!(v["teams"]["1"]["startPos"]["x"], 3);
        assert_eq!(v["teams"]["2"]["startPos"]["x"], 7);
    }

    #[test]
    fn the_teams_of_a_file_are_read_back_by_team_number() {
        let dir = temp_dir("read-teams");
        assert!(read_teams(&dir).unwrap().is_empty());
        std::fs::write(
            dir.join("mapinfo.lua"),
            "return { Teams = { [0] = { StartPos = { x = 1, z = 2 } }, [2] = { startpos = { x = 5.5, z = 6 } }, [1] = {} } }",
        )
        .unwrap();
        assert_eq!(
            read_teams(&dir).unwrap(),
            vec![pos(1.0, 2.0), None, pos(5.5, 6.0)]
        );
        std::fs::write(dir.join("mapinfo.lua"), "return { name = \"x\" }").unwrap();
        assert!(read_teams(&dir).unwrap().is_empty());
    }

    #[test]
    fn a_team_number_past_the_engine_limit_is_not_read() {
        let dir = temp_dir("read-teams-limit");
        std::fs::write(
            dir.join("mapinfo.lua"),
            "return { teams = { [0] = { startPos = { x = 1, z = 2 } }, [4000000000] = { startPos = { x = 3, z = 4 } } } }",
        )
        .unwrap();
        assert_eq!(read_teams(&dir).unwrap(), vec![pos(1.0, 2.0)]);
    }

    #[test]
    fn a_map_that_was_not_compiled_is_an_error() {
        let dir = temp_dir("no-smf");
        let mut o = opts(&dir);
        std::fs::remove_file(dir.join("mymap.smf")).unwrap();
        o.min_height = Some(0.0);
        o.max_height = Some(1.0);
        let err = write(&o).unwrap_err();
        assert!(err.contains("mymap.smf"), "{err}");
        assert!(!dir.join("mapinfo.lua").exists());
    }

    #[test]
    fn a_form_colour_on_a_new_file_keeps_the_rest_of_its_table() {
        let dir = temp_dir("new-colour");
        let mut o = opts(&dir);
        o.info.sky_color = Some([0.2, 0.3, 0.4]);
        write(&o).unwrap();
        let text = std::fs::read_to_string(dir.join("mapinfo.lua")).unwrap();
        assert!(text.starts_with("local mapinfo = {\n    name = \"mymap\","));
        let v = eval(&dir);
        assert_eq!(v["atmosphere"]["skyColor"][0], 0.2);
        assert_eq!(v["atmosphere"]["maxWind"], 25);
    }

    #[test]
    fn writing_twice_with_no_change_leaves_the_file_alone() {
        let dir = temp_dir("same");
        let o = opts(&dir);
        write(&o).unwrap();
        let w = write(&o).unwrap();
        assert!(!w.created && !w.changed);
    }

    #[test]
    fn an_existing_file_does_not_gain_the_new_file_defaults() {
        let dir = temp_dir("existing");
        std::fs::write(
            dir.join("mapinfo.lua"),
            "local mapinfo = {\n    name = \"Mine\",\n    author = \"Me\",\n}\nreturn mapinfo\n",
        )
        .unwrap();
        write(&opts(&dir)).unwrap();
        let v = eval(&dir);
        assert_eq!(v["name"], "Mine");
        assert_eq!(v["author"], "Me");
        assert_eq!(v["shortname"], "mymap");
        assert!(v.get("atmosphere").is_none());
        assert!(v.get("gravity").is_none());
    }

    #[test]
    fn a_form_value_overrides_the_file() {
        let dir = temp_dir("override");
        let mut o = opts(&dir);
        write(&o).unwrap();
        o.info.sky_color = Some([0.2, 0.3, 0.4]);
        o.info.terrain_hardness = Some(2.0);
        o.info.name = Some("Renamed".into());
        write(&o).unwrap();
        let v = eval(&dir);
        assert_eq!(v["name"], "Renamed");
        assert_eq!(v["atmosphere"]["skyColor"][2], 0.4);
        assert_eq!(v["terrainTypes"]["0"]["hardness"], 2);
    }

    #[test]
    fn heights_come_from_the_smf_header_when_the_form_has_none() {
        let dir = temp_dir("header");
        let mut smf = vec![0u8; 52];
        smf[..15].copy_from_slice(b"spring map file");
        smf[44..48].copy_from_slice(&(-5.0f32).to_le_bytes());
        smf[48..52].copy_from_slice(&75.0f32.to_le_bytes());
        std::fs::write(dir.join("mymap.smf"), smf).unwrap();
        let mut o = opts(&dir);
        o.min_height = None;
        o.max_height = None;
        write(&o).unwrap();
        let v = eval(&dir);
        assert_eq!(v["smf"]["minheight"], -5);
        assert_eq!(v["smf"]["maxheight"], 75);
    }

    #[test]
    fn a_file_the_writer_cannot_edit_is_an_error_and_is_not_touched() {
        let dir = temp_dir("computed");
        let src = "return VFS.Include(\"maps/other.lua\")\n";
        std::fs::write(dir.join("mapinfo.lua"), src).unwrap();
        assert!(write(&opts(&dir)).is_err());
        assert_eq!(
            std::fs::read_to_string(dir.join("mapinfo.lua")).unwrap(),
            src
        );
    }
}
