//! The def fixes (issue #4560): tags the engine stopped reading, put back
//! through the game's own def pipeline.
//!
//! A def fix is Lua in `lua/compat/defs/` that runs while the game's defs
//! load, in one of two files of the mutator. `gamedata/defs_post.lua` runs once
//! every def table is built, and is the file the converted models are named in
//! too, so its fixes go after that part (see `models::defs_post`).
//! `gamedata/weapondefs_post.lua` runs before the engine's own copy of it, which
//! it then includes, as `defs_post.lua` includes the engine's.
//!
//! Each fix looks at every def as the game left it and changes only those that
//! set the tag it is for, so a def that sets none is unchanged. Doing it while
//! the defs load, rather than writing the values out at build time, keeps the
//! game's own post-processing and mod options in front of it, and keeps the
//! mutator's bytes down to the manifest.
//!
//! A mutator's file covers up the base game's file of the same name, so a game
//! that ships its own copy of one of the two, or whose own loader never loads
//! it, gets no def fixes in that file, and the build says so. From writer 4 the
//! fixes of `defs_post.lua` go in `gamedata/weapondefs.lua` for such a game when
//! they can (see `models::Hook`).
//!
//! The fixes of `weapondefs_post.lua` do not follow them there. Balanced
//! Annihilation 15.9.8 ships its own copy of that file, and each of its seven
//! bombs gives its own burst with no `manualBombSettings`, so the bomb fix would
//! replace each with the old engine's burst of 2.

use std::collections::BTreeSet;

use coilbox_compat::{DefsFile, Manifest};
use serde_json::{Map, Value};
use tauri_plugin_coilbox_workshop::{lua_string, CompiledFile};

use crate::models;

/// The def fixes of a build: the Lua for each file they can be written to, and
/// why any could not.
#[derive(Debug, Default)]
pub struct Plan {
    /// The block of def fixes for `gamedata/defs_post.lua`.
    pub defs_post: Option<String>,
    /// Which file of the mutator [`Plan::defs_post`] goes in.
    pub hook: models::Hook,
    /// `gamedata/weapondefs_post.lua`.
    pub weapondefs_post: Option<CompiledFile>,
    /// The def files that hold def fixes.
    pub written: Vec<DefsFile>,
    /// Why the fixes for a file are not written, one line each.
    pub notes: Vec<String>,
}

/// The file the engine's def pipeline loads `file` from, which a game may
/// ship its own copy of.
fn loader(file: DefsFile) -> &'static str {
    match file {
        DefsFile::DefsPost => "gamedata/defs.lua",
        DefsFile::WeaponDefsPost => "gamedata/weapondefs.lua",
    }
}

/// Why the def fixes for `file` cannot run, from the base game's own copy of
/// its loader and of the file, or `None` when they can.
fn hook_problem(file: DefsFile, own_loader: Option<&str>, own: Option<&str>) -> Option<String> {
    let path = file.path();
    if own.is_some() {
        return Some(format!(
            "The game ships its own {path}, which the mutator's would cover up, so the def fixes that run there are not written."
        ));
    }
    let named = |text: &str| text.to_ascii_lowercase().contains(file.name());
    // The models are named in defs_post.lua too, so both ask the same
    // question of the game's defs.lua.
    let loads = match file {
        DefsFile::DefsPost => models::hook_problem(own_loader, None).is_none(),
        DefsFile::WeaponDefsPost => own_loader.is_none_or(named),
    };
    if !loads {
        return Some(format!(
            "The game's own {} never loads {path}, so the def fixes that run there are not written.",
            loader(file)
        ));
    }
    None
}

/// The def fixes `manifest` lists, in the files of the mutator they can go
/// in. `read` returns a file of the base game by path. It is asked only about
/// the files a listed def fix needs.
pub fn plan(
    manifest: &Manifest,
    mut read: impl FnMut(&str) -> Result<Option<String>, String>,
) -> Result<Plan, String> {
    let mut plan = Plan::default();
    for file in DefsFile::ALL {
        let Some(block) = coilbox_compat::defs_block(manifest, file) else {
            continue;
        };
        let own_loader = read(loader(file))?;
        let own = read(file.path())?;
        if let Some(why) = hook_problem(file, own_loader.as_deref(), own.as_deref()) {
            let hook = match file {
                DefsFile::DefsPost => models::hook(
                    manifest.writer,
                    own_loader.as_deref(),
                    own.as_deref(),
                    || read(models::WEAPONDEFS),
                )?,
                DefsFile::WeaponDefsPost => models::Hook::Nowhere(why.clone()),
            };
            if hook != models::Hook::WeaponDefs {
                plan.notes.push(why);
                continue;
            }
            plan.hook = hook;
        }
        plan.written.push(file);
        match file {
            DefsFile::DefsPost => plan.defs_post = Some(block),
            DefsFile::WeaponDefsPost => {
                plan.weapondefs_post = Some(weapondefs_post(&block, manifest.version))
            }
        }
    }
    Ok(plan)
}

/// `gamedata/weapondefs_post.lua`: the def fixes in `block`, then the
/// engine's own copy of the file, which this one covers up. `n` is the
/// manifest it was built from.
pub fn weapondefs_post(block: &str, n: u32) -> CompiledFile {
    let path = DefsFile::WeaponDefsPost.path();
    let contents = format!(
        "-- Written by coilbox's compatibility mode. Rebuilt from compat manifest {n}, so do not edit it.\n\
         -- license: {license}\n\
         --\n\
         -- Runs the def fixes that have to see the weapon defs before the engine's\n\
         -- own copy of this file does, then that copy, which this one covers up.\n\
         \n\
         {block}\
         \n\
         -- The engine's own copy of this file. Not a tail call, for the reason\n\
         -- given in defs_post.lua: VFS.Include reads its caller's environment.\n\
         local base = VFS.BASE or \"b\"\n\
         if VFS.FileExists({path}, base) then\n\
         \x20 VFS.Include({path}, nil, base)\n\
         end\n",
        license = coilbox_compat::LICENSE,
        path = lua_string(path),
    );
    CompiledFile {
        path: path.into(),
        contents,
    }
}

// What follows counts the defs the def fixes change, from a read of the base
// game's defs, for the build to report. Each counter mirrors its fix's Lua, and
// a test runs both over the same defs.

/// The key of `t` whose lower case is `name`, as `compat.key` finds it.
fn key<'a>(t: &'a Map<String, Value>, name: &str) -> Option<&'a str> {
    if t.contains_key(name) {
        return t.get_key_value(name).map(|(k, _)| k.as_str());
    }
    t.keys()
        .filter(|k| k.to_lowercase() == name)
        .min()
        .map(String::as_str)
}

fn get<'a>(t: &'a Map<String, Value>, name: &str) -> Option<&'a Value> {
    key(t, name).and_then(|k| t.get(k))
}

/// A number, or a string holding one, as Lua's `tonumber` reads it.
fn number(v: &Value) -> Option<f64> {
    match v {
        Value::Number(n) => n.as_f64(),
        Value::String(s) => s.trim().parse().ok(),
        _ => None,
    }
}

/// `compat.bool`.
fn truthy(v: Option<&Value>) -> bool {
    match v {
        Some(Value::Bool(b)) => *b,
        Some(v) => match number(v) {
            Some(n) => n != 0.0,
            None => v.as_str().is_some_and(|s| s.eq_ignore_ascii_case("true")),
        },
        None => false,
    }
}

/// Whether `compat.float3` reads three numbers from `v`.
fn float3(v: Option<&Value>) -> bool {
    match v {
        Some(Value::Array(a)) => a.len() >= 3 && a[..3].iter().all(|x| number(x).is_some()),
        Some(Value::String(s)) => {
            let words: Vec<&str> = s.split_whitespace().take(3).collect();
            words.len() == 3 && words.iter().all(|w| w.parse::<f64>().is_ok())
        }
        _ => false,
    }
}

/// Whether `compat.param` would add the custom parameter `name` to `def`.
fn lacks_param(def: &Map<String, Value>, name: &str) -> bool {
    match get(def, "customparams") {
        Some(Value::Object(params)) => key(params, name).is_none(),
        _ => true,
    }
}

/// Whether the fix `id` changes the unit def `ud`.
fn changes_unit(id: &str, ud: &Map<String, Value>) -> bool {
    match id {
        "defs-commander-85" => truthy(get(ud, "commander")) && lacks_param(ud, "iscommander"),
        "defs-model-center-offset-89" => {
            float3(get(ud, "modelcenteroffset")) && lacks_param(ud, "modelcenteroffset")
        }
        _ => false,
    }
}

/// Whether the fix `id` changes the weapon def `wd`.
fn changes_weapon(id: &str, wd: &Map<String, Value>) -> bool {
    match id {
        "defs-weapon-consts-87" => {
            let set =
                |tag, param| get(wd, tag).and_then(number).is_some() && lacks_param(wd, param);
            set("areaofeffect", "areaofeffect") || set("weaponvelocity", "maxvelocity")
        }
        "defs-manual-bomb-settings-92" => {
            let bomb = match get(wd, "weapontype") {
                Some(kind) => kind
                    .as_str()
                    .is_some_and(|k| k.eq_ignore_ascii_case("aircraftbomb")),
                None => truthy(get(wd, "dropped")),
            };
            let reload = get(wd, "reloadtime").and_then(number).unwrap_or(1.0);
            bomb && (key(wd, "manualbombsettings").is_some() || reload > 0.0)
        }
        _ => false,
    }
}

/// The def fixes this build knows how to count, which a test checks is every
/// def fix but the helpers and the ones for missing models and icon types,
/// which the build counts from its own run of the fixes (see `standins`).
pub const COUNTED: &[&str] = &[
    "defs-commander-85",
    "defs-model-center-offset-89",
    "defs-weapon-consts-87",
    "defs-manual-bomb-settings-92",
];

/// How many unit and weapon defs the def fixes `manifest` lists change, in the
/// files `written`, counted on `unit_defs`, the base game's defs as
/// `unitsync_unit_defs` reads them.
///
/// That read is of the defs the game ends with, after its own post-processing
/// and the engine's. The bomb fix runs before the engine's weapondefs_post.lua,
/// which takes `manualBombSettings` off a bomb, so the read has none, and every
/// bomb with a reload time above 0 counts. That is every bomb the fix changes
/// either way: it takes the tag off one that has it and works out the burst of
/// one that does not.
pub fn changed(
    manifest: &Manifest,
    written: &[DefsFile],
    unit_defs: &str,
) -> Result<usize, String> {
    let read: Value = serde_json::from_str(unit_defs)
        .map_err(|e| format!("could not read the game's defs: {e}"))?;
    let table = |name: &str| -> Vec<(String, Map<String, Value>)> {
        read[name]
            .as_object()
            .map(|t| {
                t.iter()
                    .filter_map(|(k, v)| Some((k.clone(), v.as_object()?.clone())))
                    .collect()
            })
            .unwrap_or_default()
    };
    let (units, weapons) = (table("units"), table("weaponDefs"));
    let mut touched: BTreeSet<(bool, String)> = BTreeSet::new();
    for file in written {
        for id in coilbox_compat::defs_fixes(manifest, *file) {
            for (name, ud) in &units {
                if changes_unit(id, ud) {
                    touched.insert((true, name.clone()));
                }
            }
            for (name, wd) in &weapons {
                if changes_weapon(id, wd) {
                    touched.insert((false, name.clone()));
                }
            }
        }
    }
    Ok(touched.len())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn manifest(n: u32) -> Manifest {
        coilbox_compat::manifest(n).unwrap()
    }

    fn read_from<'a>(
        files: &'a [(&'a str, &'a str)],
        asked: &'a std::cell::RefCell<Vec<String>>,
    ) -> impl FnMut(&str) -> Result<Option<String>, String> + 'a {
        move |path| {
            asked.borrow_mut().push(path.to_string());
            Ok(files
                .iter()
                .find(|(p, _)| *p == path)
                .map(|(_, t)| t.to_string()))
        }
    }

    #[test]
    fn a_manifest_without_def_fixes_reads_nothing_and_writes_nothing() {
        let asked = std::cell::RefCell::new(Vec::new());
        let plan = plan(&manifest(4), read_from(&[], &asked)).unwrap();
        assert!(plan.written.is_empty() && plan.notes.is_empty());
        assert!(plan.defs_post.is_none() && plan.weapondefs_post.is_none());
        assert!(asked.borrow().is_empty());
    }

    #[test]
    fn a_game_with_none_of_the_files_gets_both() {
        let asked = std::cell::RefCell::new(Vec::new());
        let plan = plan(&manifest(5), read_from(&[], &asked)).unwrap();
        assert_eq!(plan.written, [DefsFile::WeaponDefsPost, DefsFile::DefsPost]);
        assert!(plan.notes.is_empty());
        let block = plan.defs_post.unwrap();
        assert!(block.contains("-- fix: defs-commander-85\n"));
        let weapons = plan.weapondefs_post.unwrap();
        assert_eq!(weapons.path, "gamedata/weapondefs_post.lua");
        assert!(weapons
            .contents
            .contains("-- fix: defs-manual-bomb-settings-92\n"));
        assert!(!weapons.contents.contains("defs-commander-85"));
        assert_eq!(
            *asked.borrow(),
            [
                "gamedata/weapondefs.lua",
                "gamedata/weapondefs_post.lua",
                "gamedata/defs.lua",
                "gamedata/defs_post.lua",
            ]
        );
    }

    #[test]
    fn a_game_that_ships_a_post_file_or_skips_it_gets_no_fixes_there() {
        let asked = std::cell::RefCell::new(Vec::new());
        let own = [
            ("gamedata/weapondefs_post.lua", "-- the game's own\n"),
            ("gamedata/defs.lua", "LoadDefs('unitDefs')\n"),
        ];
        let plan = plan(&manifest(5), read_from(&own, &asked)).unwrap();
        assert!(plan.written.is_empty());
        assert_eq!(plan.defs_post, None);
        assert!(plan.weapondefs_post.is_none());
        assert_eq!(plan.notes.len(), 2);
        assert!(plan.notes[0].contains("ships its own gamedata/weapondefs_post.lua"));
        assert!(plan.notes[1].contains("never loads gamedata/defs_post.lua"));

        let skips = [("gamedata/weapondefs.lua", "-- loads nothing after\n")];
        let plan = super::plan(&manifest(5), read_from(&skips, &asked)).unwrap();
        assert_eq!(plan.written, [DefsFile::DefsPost]);
        assert!(plan.notes[0].contains("gamedata/weapondefs.lua never loads"));

        let loads = [(
            "gamedata/weapondefs.lua",
            "VFS.Include('gamedata/WeaponDefs_Post.lua')\n",
        )];
        let plan = super::plan(&manifest(5), read_from(&loads, &asked)).unwrap();
        assert_eq!(plan.written.len(), 2);
    }

    /// Balanced Annihilation 15.9.8's shape: its own defs.lua never loads
    /// defs_post.lua, and it ships its own weapondefs_post.lua.
    #[test]
    fn writer_4_carries_the_defs_post_fixes_to_weapondefs_and_leaves_the_bomb_fix_out() {
        let asked = std::cell::RefCell::new(Vec::new());
        let own = [
            (
                "gamedata/defs.lua",
                "DEFS.unitDefs = LoadDefs('unitDefs')\n\
                 DEFS.featureDefs = LoadDefs('featureDefs')\n\
                 DEFS.weaponDefs = LoadDefs('weaponDefs')\n",
            ),
            ("gamedata/weapondefs_post.lua", "-- the game's own\n"),
        ];
        let latest = manifest(coilbox_compat::latest());
        assert!(coilbox_compat::hooks_weapondefs(latest.writer));
        let plan = plan(&latest, read_from(&own, &asked)).unwrap();
        assert_eq!(plan.written, [DefsFile::DefsPost]);
        assert_eq!(plan.hook, models::Hook::WeaponDefs);
        assert!(plan.defs_post.unwrap().contains("defs-commander-85"));
        assert!(plan.weapondefs_post.is_none());
        assert_eq!(plan.notes.len(), 1);
        assert!(plan.notes[0].contains("ships its own gamedata/weapondefs_post.lua"));
    }

    #[test]
    fn a_failed_read_fails_the_plan() {
        let failed = plan(&manifest(5), |_| Err("no worker".to_string()));
        assert_eq!(failed.err(), Some("no worker".to_string()));
    }

    /// Units and weapons the way an old game's defs reach the def files: tags
    /// in whatever case the game wrote, a commander, a unit that is not one, an
    /// offset, bombs with and without manualBombSettings, and a weapon a unit
    /// declares inside itself.
    const UNITS: &str = r#"{
        armcom = { commander = 1, canmanualfire = 1, objectname = "armcom" },
        corcom = { Commander = "1", modelCenterOffset = "0 -5 0" },
        armpw = { canmanualfire = 1, customparams = { techlevel = "1" } },
        armthud = { weapondefs = { thudbomb = { dropped = 1, reloadtime = 3 } } },
    }"#;
    const WEAPONS: &str = r#"{
        armbomb = { dropped = 1, manualBombSettings = 1, reloadtime = 9, burst = 4, burstrate = 0.1 },
        corbomb = { weapontype = "AircraftBomb", reloadtime = 0.1 },
        cannon = { weapontype = "Cannon", areaofeffect = 64, weaponvelocity = 300 },
        laser = { range = 300 },
    }"#;

    /// Runs `src` in Lua 5.1 with the defs above in `DEFS`, `WeaponDefs` set
    /// when `weapons_global`, and a stand in for the engine's own copy of
    /// `path` that returns the units. Answers with what `check` returns, run
    /// after it, or with what `src` returns.
    fn run(src: &str, path: &str, weapons_global: bool, check: &str) -> Value {
        let root = tempfile::tempdir().unwrap();
        let base = std::collections::BTreeMap::from([(
            root.path().join(path),
            "BASE_RAN = true\nreturn { base = true, units = DEFS.unitDefs }\n".to_string(),
        )]);
        let lua = coilbox_springlua::SpringLua::with_files(root.path(), base).unwrap();
        lua.eval_value_raw(
            &format!(
                "DEFS = {{ unitDefs = {UNITS}, weaponDefs = {WEAPONS} }}\n\
                 WeaponDefs = {}\nreturn {{}}",
                if weapons_global {
                    "DEFS.weaponDefs"
                } else {
                    "nil"
                }
            ),
            "setup",
        )
        .unwrap();
        lua.eval_value_raw(&format!("{src}\n{check}"), path)
            .unwrap()
    }

    fn defs_post_of(n: u32) -> String {
        let block = coilbox_compat::defs_block(&manifest(n), DefsFile::DefsPost).unwrap();
        models::defs_post(&BTreeSet::new(), Some(&block), n)
            .unwrap()
            .contents
    }

    #[test]
    fn a_unit_with_the_commander_tag_gets_iscommander_and_one_without_gets_nothing() {
        let got = run(&defs_post_of(5), models::DEFS_POST, false, "");
        assert_eq!(
            got["base"], true,
            "the engine's own defs_post.lua still runs"
        );
        let units = &got["units"];
        assert_eq!(units["armcom"]["customparams"]["iscommander"], "1");
        assert_eq!(units["armcom"]["canmanualfire"], 1);
        assert_eq!(units["corcom"]["customparams"]["iscommander"], "1");
        assert_eq!(
            units["corcom"]["customparams"]["modelcenteroffset"],
            "0 -5 0"
        );
        assert_eq!(
            units["armpw"],
            serde_json::json!({ "canmanualfire": 1, "customparams": { "techlevel": "1" } })
        );
    }

    #[test]
    fn the_written_weapondefs_post_works_out_bombs_and_then_runs_the_engine_s() {
        let block = coilbox_compat::defs_block(&manifest(5), DefsFile::WeaponDefsPost).unwrap();
        let file = weapondefs_post(&block, 5);
        assert!(!file.contents.contains('\r'));
        let got = run(
            &file.contents,
            &file.path,
            true,
            "return { weapons = WeaponDefs, units = DEFS.unitDefs, base = BASE_RAN }",
        );
        let w = &got["weapons"];
        assert_eq!(w["armbomb"]["burst"], 4);
        assert!(w["armbomb"].get("manualBombSettings").is_none());
        assert_eq!(w["corbomb"]["burst"], 11);
        assert_eq!(w["corbomb"]["reloadtime"], 5);
        assert!(w["cannon"].get("burst").is_none());
        assert_eq!(
            got["units"]["armthud"]["weapondefs"]["thudbomb"]["burst"],
            2
        );
        assert_eq!(got["base"], true);
    }

    /// Each counter against the Lua it mirrors, over the same defs.
    #[test]
    fn the_count_is_the_number_of_defs_the_lua_changes() {
        let m = manifest(5);
        let count = "local n = 0 for _ in pairs(compat.changed) do n = n + 1 end\n\
                     return { n = n, units = DEFS.unitDefs, weapons = DEFS.weaponDefs }";
        let block = coilbox_compat::defs_block(&m, DefsFile::DefsPost).unwrap();
        let lua = run(&block, models::DEFS_POST, false, count);
        // The bomb fix runs before the engine's weapondefs_post.lua, which
        // takes the tag off, and the count reads the defs after it, so these
        // weapons are counted as the read has them.
        let bombs = coilbox_compat::defs_block(&m, DefsFile::WeaponDefsPost).unwrap();
        let bomb_lua = run(&bombs, "gamedata/weapondefs_post.lua", true, count);

        let read = run(
            "",
            "read",
            false,
            "DEFS.weaponDefs.armbomb.manualBombSettings = nil\n\
             return { units = DEFS.unitDefs, weaponDefs = DEFS.weaponDefs }",
        );
        let read = read.to_string();
        let only = |file| changed(&m, &[file], &read).unwrap();
        // The unit's own bomb is not in the shared table the read has, so the
        // Lua finds one more weapon than the count.
        assert_eq!(
            only(DefsFile::DefsPost),
            lua["n"].as_u64().unwrap() as usize
        );
        assert_eq!(
            only(DefsFile::WeaponDefsPost) + 1,
            bomb_lua["n"].as_u64().unwrap() as usize
        );
        assert_eq!(only(DefsFile::DefsPost), 3);
        assert_eq!(
            changed(&m, &DefsFile::ALL, &read).unwrap(),
            3 + 2,
            "armcom, corcom and cannon, then armbomb and corbomb, cannon once"
        );
        assert_eq!(changed(&m, &[], &read).unwrap(), 0);
        assert!(changed(&m, &DefsFile::ALL, "not json").is_err());
    }

    #[test]
    fn every_def_fix_but_the_helpers_is_counted() {
        let m = manifest(coilbox_compat::latest());
        let listed: Vec<&str> = DefsFile::ALL
            .iter()
            .flat_map(|f| coilbox_compat::defs_fixes(&m, *f))
            .filter(|id| {
                ![
                    "defs-helpers",
                    crate::standins::FIX,
                    crate::standins::ICONS_FIX,
                ]
                .contains(id)
            })
            .collect();
        let mut listed = listed;
        listed.dedup();
        assert_eq!(listed.len(), COUNTED.len());
        for id in listed {
            assert!(COUNTED.contains(&id), "{id} is not counted");
        }
    }
}
