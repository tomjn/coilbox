//! The boxes the def fix `defs-missing-model-standin` points a def at when its
//! model is not in the game (issue #4686).
//!
//! The fix decides at load time which defs need one, and names the box by the
//! def's footprint, `compat/models/standin-<x>x<z>.s3o`. The build has to write
//! those boxes before the game loads, so it runs the same fix over the game's
//! defs through the unitsync worker, with every other def fix of
//! `defs_post.lua` around it as the mutator runs them, and reads back the list
//! the fix keeps of what it changed. That list is the build's note too. The
//! same run reads back the unit defs `defs-icon-type-2025` changes, which the
//! build counts.
//!
//! Running the fix itself, rather than a Rust copy of it, matters here: the fix
//! asks the engine's VFS whether a model is there, across the game, its
//! dependencies and the base content, and nothing short of unitsync sees that
//! VFS.
//!
//! A failed run fails the build. The boxes are part of the mutator's bytes, and
//! two players whose builds wrote different boxes would desync.

use serde::Deserialize;
use tauri_plugin_coilbox_unitsync::DEFS_ENV_SHIM;

use crate::defs;
use crate::mutator;
use coilbox_compat::{DefsFile, Manifest};

/// The fix's id.
pub const FIX: &str = "defs-missing-model-standin";

/// The def fix that gives a unit def whose icon type the game does not define
/// the type "default" (issue #4699). It needs the game's VFS too, so the build
/// counts what it changes from the same run.
pub const ICONS_FIX: &str = "defs-icon-type-2025";

/// The box a def gets when the one for its footprint is not there, which every
/// build with the fix writes. Matches `FALLBACK` in the fix.
const FALLBACK: &str = "compat/models/standin-1x1.s3o";

/// The texture every box is drawn with.
const TEXTURE: &str = "compat/models/standin.tga";

/// One footprint square, in elmos: the engine's `SQUARE_SIZE` of 8 times its
/// `SPRING_FOOTPRINT_SCALE` of 2 (`rts/Sim/Misc/GlobalConstants.h`).
const FOOTPRINT_SQUARE: f32 = 16.0;

/// How tall a box stands, in elmos: one map square. A wreck lies low, and the
/// box only has to show that something is there.
const HEIGHT: f32 = 8.0;

/// The grey a converted model's palette faces take when their colour is not
/// known (`PALETTE_GREY` in `coilbox-3do-convert`), with alpha 0, because the
/// alpha of an `.s3o`'s first texture is its team colour mask.
const GREY: [u8; 4] = [128, 128, 128, 0];

/// One def the fix changed.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Deserialize)]
pub struct Standin {
    /// `unit`, `feature` or `weapon`.
    pub kind: String,
    pub name: String,
    /// The model the def named.
    pub model: String,
    /// The box its footprint asks for, which may not have been written.
    pub standin: String,
}

/// Whether a build from `manifest` with the def fixes in `plan` runs the fix,
/// and so needs its boxes.
pub fn wanted(manifest: &Manifest, plan: &defs::Plan) -> bool {
    plan.written.contains(&DefsFile::DefsPost)
        && coilbox_compat::defs_fixes(manifest, DefsFile::DefsPost).contains(&FIX)
}

/// The Lua the worker runs to find the defs the fix changes: the game's defs
/// loaded as the engine loads them, then the def fixes of `manifest`'s
/// `defs_post.lua`, then the fix's list and any fix that failed, as JSON.
///
/// A model is looked for in the archives a game loads from, as the engine
/// does, and not on disk, which the worker's parser can also read.
pub fn script(manifest: &Manifest) -> Result<String, String> {
    let block = coilbox_compat::defs_block(manifest, DefsFile::DefsPost)
        .ok_or("the manifest has no def fixes for defs_post.lua")?;
    Ok(SCRIPT
        .replace("--[[shim]]", DEFS_ENV_SHIM)
        .replace("--[[fixes]]", &block))
}

/// [`script`], before the shim and the fixes go in.
const SCRIPT: &str = r#"--[[shim]]
local function __cb_json(s)
  return '"' .. (tostring(s):gsub('[%c"\\\128-\255]', function(c)
    return string.format('\\u%04x', string.byte(c))
  end)) .. '"'
end
local __cb_failed = {}
local __cb_log = Spring.Log
Spring.Log = function(section, level, msg, ...)
  if section == 'coilbox-compat' then __cb_failed[#__cb_failed + 1] = tostring(msg) end
  if type(__cb_log) == 'function' then return __cb_log(section, level, msg, ...) end
end
local __cb_loaded, __cb_defs = pcall(VFS.Include, 'gamedata/defs.lua')
if not __cb_loaded or type(__cb_defs) ~= 'table' then
  return '{"loaded":false,"why":' .. __cb_json(__cb_loaded and 'gamedata/defs.lua returned no table' or __cb_defs) .. '}'
end
DEFS = {
  unitDefs = __cb_defs.unitdefs, featureDefs = __cb_defs.featuredefs,
  weaponDefs = __cb_defs.weapondefs, armorDefs = __cb_defs.armordefs,
  moveDefs = __cb_defs.movedefs,
}
local __cb_exists = VFS.FileExists
VFS.FileExists = function(path, modes) return __cb_exists(path, modes or 'Mmeb') end

--[[fixes]]
local __cb_out = {}
for _, s in ipairs(compat.standins or {}) do
  __cb_out[#__cb_out + 1] = '{"kind":' .. __cb_json(s.kind) .. ',"name":' .. __cb_json(s.name)
    .. ',"model":' .. __cb_json(s.model) .. ',"standin":' .. __cb_json(s.standin) .. '}'
end
local __cb_icons = {}
for _, name in ipairs(compat.icons or {}) do __cb_icons[#__cb_icons + 1] = __cb_json(name) end
local __cb_fails = {}
for _, m in ipairs(__cb_failed) do __cb_fails[#__cb_fails + 1] = __cb_json(m) end
return '{"loaded":true,"ran":' .. tostring(compat.standins ~= nil) .. ',"standins":['
  .. table.concat(__cb_out, ',') .. '],"icons":[' .. table.concat(__cb_icons, ',')
  .. '],"failed":[' .. table.concat(__cb_fails, ',') .. ']}'
"#;

/// The worker's answer to `--lua`.
#[derive(Deserialize)]
struct Answer {
    result: Option<String>,
    error: Option<String>,
}

#[derive(Deserialize)]
struct Ran {
    loaded: bool,
    #[serde(default)]
    why: String,
    #[serde(default)]
    ran: bool,
    #[serde(default)]
    standins: Vec<Standin>,
    #[serde(default)]
    icons: Vec<String>,
    #[serde(default)]
    failed: Vec<String>,
}

/// What a run of [`script`] found.
#[derive(Debug, Default, PartialEq, Eq)]
pub struct Found {
    /// The defs the fix changed, sorted.
    pub standins: Vec<Standin>,
    /// The unit defs `defs-icon-type-2025`, which runs in the same block,
    /// gave the icon type "default" (issue #4699), sorted.
    pub icons: Vec<String>,
    /// Why the game's defs did not load under unitsync, when they did not.
    /// The fix then still gives every def whose model is missing the 1x1 box
    /// when the game loads, and only the boxes for other footprints are lost.
    pub unread: Option<String>,
}

/// A string as Lua's `%q` writes it, read back. The script escapes every
/// control character itself, so only `\"` and `\\` can appear.
fn unquote(q: &str) -> Option<String> {
    let inner = q.strip_prefix('"')?.strip_suffix('"')?;
    let mut out = String::with_capacity(inner.len());
    let mut chars = inner.chars();
    while let Some(c) = chars.next() {
        if c == '\\' {
            match chars.next()? {
                c @ ('"' | '\\') => out.push(c),
                _ => return None,
            }
        } else {
            out.push(c);
        }
    }
    Some(out)
}

/// What the worker's answer to [`script`] found.
///
/// A game whose defs raise under unitsync raises the same way on every
/// computer, so that is a finding: no def is known to need a box, and the 1x1
/// one is written as ever. Anything else that goes wrong is an error, since
/// another computer's run could find what this one did not.
pub fn parse(answer: &str) -> Result<Found, String> {
    let fail = |why: String| format!("could not find the defs whose model is missing: {why}");
    let a: Answer =
        serde_json::from_str(answer).map_err(|e| fail(format!("the worker's answer: {e}")))?;
    if let Some(e) = a.error {
        return Err(fail(e));
    }
    let result = a
        .result
        .ok_or_else(|| fail("the worker gave no result".into()))?;
    let json = unquote(&result).ok_or_else(|| fail(format!("not a string: {result}")))?;
    let ran: Ran = serde_json::from_str(&json).map_err(|e| fail(format!("{e}: {json}")))?;
    if !ran.loaded {
        return Ok(Found {
            unread: Some(ran.why),
            ..Found::default()
        });
    }
    if let Some(m) = ran.failed.iter().find(|m| m.contains(FIX)) {
        return Err(fail(m.clone()));
    }
    if !ran.ran {
        return Err(fail(format!("{FIX} did not run")));
    }
    let (mut standins, mut icons) = (ran.standins, ran.icons);
    standins.sort();
    icons.sort();
    Ok(Found {
        standins,
        icons,
        unread: None,
    })
}

/// The footprint a box is named for, or `None` for a name that is not a box.
fn footprint(path: &str) -> Option<(u32, u32)> {
    let size = path
        .strip_prefix("compat/models/standin-")?
        .strip_suffix(".s3o")?;
    let (x, z) = size.split_once('x')?;
    let whole = |s: &str| -> Option<u32> {
        if s.starts_with('0') || !s.bytes().all(|b| b.is_ascii_digit()) {
            return None;
        }
        s.parse().ok().filter(|n| *n >= 1)
    };
    Some((whole(x)?, whole(z)?))
}

/// A box `x` by `z` footprint squares across and [`HEIGHT`] tall, standing on
/// the ground at its middle, with a flat face on each side.
fn box_model(x: u32, z: u32) -> coilbox_s3o::Model {
    let (hx, hz) = (
        x as f32 * FOOTPRINT_SQUARE / 2.0,
        z as f32 * FOOTPRINT_SQUARE / 2.0,
    );
    // Each face as its normal and its four corners, wound counter-clockwise
    // seen from outside.
    let faces: [([f32; 3], [[f32; 3]; 4]); 6] = [
        (
            [1.0, 0.0, 0.0],
            [
                [hx, 0.0, hz],
                [hx, 0.0, -hz],
                [hx, HEIGHT, -hz],
                [hx, HEIGHT, hz],
            ],
        ),
        (
            [-1.0, 0.0, 0.0],
            [
                [-hx, 0.0, -hz],
                [-hx, 0.0, hz],
                [-hx, HEIGHT, hz],
                [-hx, HEIGHT, -hz],
            ],
        ),
        (
            [0.0, 1.0, 0.0],
            [
                [-hx, HEIGHT, hz],
                [hx, HEIGHT, hz],
                [hx, HEIGHT, -hz],
                [-hx, HEIGHT, -hz],
            ],
        ),
        (
            [0.0, -1.0, 0.0],
            [
                [-hx, 0.0, -hz],
                [hx, 0.0, -hz],
                [hx, 0.0, hz],
                [-hx, 0.0, hz],
            ],
        ),
        (
            [0.0, 0.0, 1.0],
            [
                [-hx, 0.0, hz],
                [hx, 0.0, hz],
                [hx, HEIGHT, hz],
                [-hx, HEIGHT, hz],
            ],
        ),
        (
            [0.0, 0.0, -1.0],
            [
                [hx, 0.0, -hz],
                [-hx, 0.0, -hz],
                [-hx, HEIGHT, -hz],
                [hx, HEIGHT, -hz],
            ],
        ),
    ];
    let mut vertices = Vec::new();
    let mut indices = Vec::new();
    for (normal, corners) in faces {
        let first = vertices.len() as u32;
        vertices.extend(corners.iter().map(|pos| coilbox_s3o::Vertex {
            pos: *pos,
            normal,
            uv: [0.5, 0.5],
        }));
        indices.extend([0, 1, 2, 0, 2, 3].map(|i| first + i));
    }
    coilbox_s3o::Model {
        // Both at 0, so the engine works them out from the box.
        radius: 0.0,
        height: 0.0,
        mid: [0.0, HEIGHT / 2.0, 0.0],
        texture1: TEXTURE.into(),
        texture2: String::new(),
        root: coilbox_s3o::Piece {
            name: "base".into(),
            primitive_type: coilbox_s3o::PrimitiveType::Triangles,
            offset: [0.0, 0.0, 0.0],
            vertices,
            indices,
            children: Vec::new(),
        },
    }
}

/// A one pixel TGA of [`GREY`]: uncompressed true colour, 32 bits, with 8 of
/// them alpha, stored blue first.
fn texture() -> Vec<u8> {
    let mut out = vec![0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 1, 0, 32, 8];
    out.extend([GREY[2], GREY[1], GREY[0], GREY[3]]);
    out
}

/// The files the boxes in `standins` need: the 1x1 box, one box for each other
/// footprint they ask for, and the texture. A name that is not a box is left
/// out, and the fix gives that def the 1x1 box.
pub fn files(standins: &[Standin]) -> Result<Vec<mutator::File>, String> {
    let mut paths: Vec<&str> = standins
        .iter()
        .map(|s| s.standin.as_str())
        .chain([FALLBACK])
        .filter(|p| footprint(p).is_some())
        .collect();
    paths.sort();
    paths.dedup();
    let mut out = Vec::new();
    for path in paths {
        let (x, z) = footprint(path).expect("filtered to boxes");
        let contents = coilbox_s3o::write(&box_model(x, z))
            .map_err(|e| format!("could not write {path}: {e}"))?;
        out.push(mutator::File {
            path: path.into(),
            contents,
        });
    }
    out.push(mutator::File {
        path: TEXTURE.into(),
        contents: texture(),
    });
    Ok(out)
}

/// The build's note naming every def the fix changes, or saying why it could
/// not tell, or `None` when it changes none.
pub fn note(found: &Found) -> Option<String> {
    if let Some(why) = &found.unread {
        return Some(format!(
            "Could not load the game's defs to find the models it does not have, so a def whose model is missing is drawn as the smallest box: {why}"
        ));
    }
    let standins = &found.standins;
    if standins.is_empty() {
        return None;
    }
    let listed: Vec<String> = standins
        .iter()
        .map(|s| format!("{} {} ({})", s.kind, s.name, s.model))
        .collect();
    let (count, verb, each) = match standins.len() {
        1 => ("1 def".to_string(), "names", "it"),
        n => (format!("{n} defs"), "name", "each"),
    };
    Some(format!(
        "{count} {verb} a model the game does not have, so {each} is drawn as a plain box the size of its footprint: {}.",
        listed.join(", ")
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn standin(kind: &str, name: &str, model: &str, standin: &str) -> Standin {
        Standin {
            kind: kind.into(),
            name: name.into(),
            model: model.into(),
            standin: standin.into(),
        }
    }

    /// The worker's answer to a script that returned `json`, with the quoting
    /// `%q` gives it.
    fn answer(json: &str) -> String {
        let quoted = format!("\"{}\"", json.replace('\\', "\\\\").replace('"', "\\\""));
        serde_json::json!({ "result": quoted, "errors": [] }).to_string()
    }

    #[test]
    fn the_answer_is_read_back_sorted() {
        let got = parse(&answer(
            r#"{"loaded":true,"ran":true,"standins":[
                {"kind":"weapon","name":"shell","model":"shell.3do","standin":"compat/models/standin-1x1.s3o"},
                {"kind":"feature","name":"arm_infinity_dead","model":"arm_infinity_dead","standin":"compat/models/standin-3x2.s3o"}
            ],"failed":["coilbox compat fix defs-commander-85 failed: x"]}"#,
        ))
        .unwrap();
        assert_eq!(got.unread, None);
        assert_eq!(
            got.standins,
            [
                standin(
                    "feature",
                    "arm_infinity_dead",
                    "arm_infinity_dead",
                    "compat/models/standin-3x2.s3o"
                ),
                standin("weapon", "shell", "shell.3do", FALLBACK),
            ]
        );
    }

    #[test]
    fn the_unit_defs_whose_icon_type_reads_default_are_read_back_sorted() {
        let got = parse(&answer(
            r#"{"loaded":true,"ran":true,"standins":[],"icons":["usbarge","gersiebelfahre"],"failed":[]}"#,
        ))
        .unwrap();
        assert_eq!(got.icons, ["gersiebelfahre", "usbarge"]);
        // A run from before the icon fix lists none.
        let old = parse(&answer(
            r#"{"loaded":true,"ran":true,"standins":[],"failed":[]}"#,
        ));
        assert!(old.unwrap().icons.is_empty());
    }

    /// The game's own defs raising is the same on every computer, so the
    /// build goes on with the 1x1 box and says why.
    #[test]
    fn defs_that_do_not_load_are_noted_and_get_the_smallest_box() {
        let got = parse(&answer(
            r#"{"loaded":false,"why":"[string \"gamedata/defs.lua\"]:2: attempt to call global 'LoadDefs' (a nil value)"}"#,
        ))
        .unwrap();
        assert!(got.standins.is_empty());
        let note = note(&got).unwrap();
        assert!(note.starts_with("Could not load the game's defs"), "{note}");
        assert!(note.contains("'LoadDefs'"), "{note}");
    }

    #[test]
    fn a_run_that_failed_or_never_ran_the_fix_fails() {
        let failed = format!(
            r#"{{"loaded":true,"ran":true,"standins":[],"failed":["coilbox compat fix {FIX} failed: boom"]}}"#
        );
        assert!(parse(&answer(&failed)).unwrap_err().contains("boom"));
        let skipped = r#"{"loaded":true,"ran":false,"standins":[],"failed":[]}"#;
        assert!(parse(&answer(skipped)).unwrap_err().contains("did not run"));
        let raised = r#"{"error":"defs.lua: no such file","errors":[]}"#;
        assert!(parse(raised).unwrap_err().contains("no such file"));
        assert!(parse(r#"{"result":"not quoted","errors":[]}"#).is_err());
    }

    #[test]
    fn a_box_name_gives_its_footprint() {
        assert_eq!(footprint("compat/models/standin-3x2.s3o"), Some((3, 2)));
        assert_eq!(footprint(FALLBACK), Some((1, 1)));
        for not in [
            "compat/models/standin-0x2.s3o",
            "compat/models/standin-03x2.s3o",
            "compat/models/standin-1e+15x1.s3o",
            "compat/models/standin-3x.s3o",
            "objects3d/standin-3x2.s3o",
        ] {
            assert_eq!(footprint(not), None, "{not}");
        }
    }

    #[test]
    fn each_footprint_gets_one_box_and_the_1x1_one_is_always_there() {
        let none = files(&[]).unwrap();
        let paths = |f: &[mutator::File]| f.iter().map(|f| f.path.clone()).collect::<Vec<_>>();
        assert_eq!(paths(&none), [FALLBACK, TEXTURE]);
        let some = files(&[
            standin("feature", "a", "a", "compat/models/standin-3x2.s3o"),
            standin("unit", "b", "b", "compat/models/standin-3x2.s3o"),
            standin("feature", "c", "c", "compat/models/standin-1e+15x1.s3o"),
        ])
        .unwrap();
        assert_eq!(
            paths(&some),
            [FALLBACK, "compat/models/standin-3x2.s3o", TEXTURE]
        );
    }

    #[test]
    fn a_box_is_its_footprint_across_and_stands_on_the_ground() {
        let file = files(&[standin("f", "a", "a", "compat/models/standin-3x2.s3o")]).unwrap();
        let model = coilbox_s3o::read(&file[1].contents).unwrap();
        let (mut min, mut max) = ([f32::MAX; 3], [f32::MIN; 3]);
        for v in &model.root.vertices {
            for i in 0..3 {
                min[i] = min[i].min(v.pos[i]);
                max[i] = max[i].max(v.pos[i]);
            }
        }
        assert_eq!((min, max), ([-24.0, 0.0, -16.0], [24.0, HEIGHT, 16.0]));
        assert_eq!(model.root.triangles().len(), 36);
        assert_eq!(model.texture1, TEXTURE);
        assert_eq!(model.mid, [0.0, HEIGHT / 2.0, 0.0]);
    }

    /// Every face's corners wind counter-clockwise seen from outside, so the
    /// cross product of two edges points the way the face's normal does.
    #[test]
    fn every_face_faces_out() {
        let model = box_model(2, 1);
        let v = &model.root.vertices;
        for t in model.root.indices.chunks(3) {
            let [a, b, c] = [
                v[t[0] as usize].pos,
                v[t[1] as usize].pos,
                v[t[2] as usize].pos,
            ];
            let (e1, e2) = (
                [b[0] - a[0], b[1] - a[1], b[2] - a[2]],
                [c[0] - a[0], c[1] - a[1], c[2] - a[2]],
            );
            let cross = [
                e1[1] * e2[2] - e1[2] * e2[1],
                e1[2] * e2[0] - e1[0] * e2[2],
                e1[0] * e2[1] - e1[1] * e2[0],
            ];
            let n = v[t[0] as usize].normal;
            assert!(
                cross[0] * n[0] + cross[1] * n[1] + cross[2] * n[2] > 0.0,
                "{t:?}"
            );
        }
    }

    #[test]
    fn the_texture_is_one_grey_pixel() {
        let tga = texture();
        assert_eq!(tga.len(), 18 + 4);
        assert_eq!((tga[2], tga[12], tga[14], tga[16]), (2, 1, 1, 32));
        assert_eq!(&tga[18..], [128, 128, 128, 0]);
    }

    #[test]
    fn the_note_names_every_def_changed() {
        assert_eq!(note(&Found::default()), None);
        let n = note(&Found {
            standins: vec![
                standin("feature", "gdakula2_dead", "gdakula2_dead", FALLBACK),
                standin("weapon", "shell", "shell.3do", FALLBACK),
            ],
            ..Found::default()
        })
        .unwrap();
        assert!(n.starts_with("2 defs name a model"), "{n}");
        let one = note(&Found {
            standins: vec![standin("feature", "a", "a", FALLBACK)],
            ..Found::default()
        })
        .unwrap();
        assert!(
            one.starts_with("1 def names a model the game does not have, so it is drawn"),
            "{one}"
        );
        assert!(n.contains("feature gdakula2_dead (gdakula2_dead), weapon shell (shell.3do)"));
    }

    /// The script, run in Lua 5.1 over a game's defs with a stand in for the
    /// engine's defs.lua and its VFS, gives the answer `parse` reads.
    #[test]
    fn the_script_finds_the_missing_models_the_fix_finds() {
        let m = coilbox_compat::manifest(coilbox_compat::latest()).unwrap();
        let source = script(&m).unwrap();
        let root = tempfile::tempdir().unwrap();
        let defs = "return { unitdefs = { armcom = { objectName = 'armcom' } },\n\
                    featuredefs = { arm_infinity_dead = { object = 'arm_infinity_dead', footprintX = 3, footprintZ = 2 } },\n\
                    weapondefs = {}, armordefs = {}, movedefs = {} }\n";
        let files = std::collections::BTreeMap::from([
            (root.path().join("gamedata/defs.lua"), defs.to_string()),
            (root.path().join("objects3d/armcom.3do"), String::new()),
        ]);
        let lua = coilbox_springlua::SpringLua::with_files(root.path(), files).unwrap();
        let got = lua
            .eval_value_raw(&format!("return (function()\n{source}\nend)()"), "standins")
            .unwrap();
        let json = got.as_str().expect("a string").to_string();
        let quoted = format!("\"{}\"", json.replace('\\', "\\\\").replace('"', "\\\""));
        let read = parse(&serde_json::json!({ "result": quoted }).to_string()).unwrap();
        assert_eq!(
            read.standins,
            [standin(
                "feature",
                "arm_infinity_dead",
                "arm_infinity_dead",
                "compat/models/standin-3x2.s3o"
            )]
        );
    }

    /// Issue #4699: the same run lists the unit defs the icon type fix gives
    /// "default", which the build counts.
    #[test]
    fn the_script_lists_the_unit_defs_whose_icon_type_reads_default() {
        let m = coilbox_compat::manifest(coilbox_compat::latest()).unwrap();
        let source = script(&m).unwrap();
        let root = tempfile::tempdir().unwrap();
        let defs = "return { unitdefs = {\n\
                    gersiebelfahre = { objectName = 'boat', iconType = 'pontoon' },\n\
                    rifle = { objectName = 'boat', iconType = 'rifle' } },\n\
                    featuredefs = {}, weapondefs = {}, armordefs = {}, movedefs = {} }\n";
        let files = std::collections::BTreeMap::from([
            (root.path().join("gamedata/defs.lua"), defs.to_string()),
            (
                root.path().join("gamedata/icontypes.lua"),
                "return { default = {}, rifle = {} }\n".to_string(),
            ),
            (root.path().join("objects3d/boat.s3o"), String::new()),
        ]);
        let lua = coilbox_springlua::SpringLua::with_files(root.path(), files).unwrap();
        let got = lua
            .eval_value_raw(&format!("return (function()\n{source}\nend)()"), "icons")
            .unwrap();
        let json = got.as_str().expect("a string").to_string();
        let quoted = format!("\"{}\"", json.replace('\\', "\\\\").replace('"', "\\\""));
        let read = parse(&serde_json::json!({ "result": quoted }).to_string()).unwrap();
        assert_eq!(read.icons, ["gersiebelfahre"]);
        assert!(read.standins.is_empty());
    }
}
