//! A copy goes through the game's post-processing once, like its source
//! (issue #3054).
//!
//! The unit page reads every definition after the game's post files have run,
//! and a copy is made from that read. The copy then goes back into the game as
//! a definition of its own, and the post files run over it again. Balanced
//! Annihilation V15.9.8 multiplies every weapon's `cratermult` by 0.3 there,
//! and does it twice for a weapon a unit carries, so a copy that kept the
//! values the page showed would load with its crater multiplier cut a second
//! time.
//!
//! Each test here loads a game the way the engine's own `gamedata/unitdefs.lua`
//! and `gamedata/weapondefs.lua` do: the unit files, then the game's
//! `unitdefs_post.lua` with `UnitDefs` in scope, then the weapon files, then
//! its `weapondefs_post.lua`. It loads it once alone, which is what the
//! unitsync worker reads, and works out what the post files changed with the
//! worker's own code. It makes the copies the page would, from those values,
//! compiles the project, and loads the game again with the mutator's files on
//! top. The copy has to come out of that second load equal to its source.
//!
//! Two games. A small one written here, whose post files have Balanced
//! Annihilation's shape, runs everywhere. Balanced Annihilation itself runs
//! wherever V15.9.8 is installed, reading its real post files out of the
//! archive: its code is GPL and this repository is MIT, so none of it is
//! copied in.

use std::collections::BTreeMap;
use std::io::Read;
use std::path::PathBuf;

use coilbox_springlua::SpringLua;
use serde_json::{json, Map, Value};
use tauri_plugin_coilbox_workshop::{compile, ModProject};

#[allow(dead_code)]
#[path = "../../coilbox-unitsync-worker/src/beforepost.rs"]
mod beforepost;

use beforepost::BeforePost;

/// A game's files, by path, and which of them are unit and weapon files.
struct Game {
    files: BTreeMap<String, String>,
    units: Vec<String>,
    weapons: Vec<String>,
}

/// One load of a game: the unit and weapon tables after post-processing, and
/// what the post files changed in them.
struct Loaded {
    units: Map<String, Value>,
    weapons: Map<String, Value>,
    before_post: BeforePost,
}

/// Load `game`, with `mutator`'s files on top of it, the way the engine's own
/// def loaders do. A mutator file of the same name as a game file takes its
/// place, which is what an archive depending on the game does.
fn load(game: &Game, mutator: &[(String, String)]) -> Loaded {
    let root = tempfile::tempdir().expect("tempdir");
    let mut files: BTreeMap<PathBuf, String> = game
        .files
        .iter()
        .map(|(path, text)| (root.path().join(path), text.clone()))
        .collect();
    let mut units = game.units.clone();
    for (path, text) in mutator {
        files.insert(root.path().join(path), text.clone());
        if path.starts_with("units/") && !units.contains(path) {
            units.push(path.clone());
        }
    }
    let list = |paths: &[String]| {
        paths
            .iter()
            .map(|p| format!("{p:?}"))
            .collect::<Vec<_>>()
            .join(", ")
    };
    let source = format!(
        r#"(function()
  Spring.GetModOptions = function() return {{}} end
  Spring.Echo = function() end
  local function copy(v, seen)
    if type(v) ~= 'table' then return v end
    if seen[v] then return seen[v] end
    local out = {{}}
    seen[v] = out
    for k, x in pairs(v) do out[copy(k, seen)] = copy(x, seen) end
    return out
  end
  local function read(files)
    local out = {{}}
    for _, file in ipairs(files) do
      for name, def in pairs(VFS.Include(file)) do out[name] = def end
    end
    return out
  end
  DEFS = {{}}
  UnitDefs = read({{ {units} }})
  local rawUnits = copy(UnitDefs, {{}})
  VFS.Include('gamedata/unitdefs_post.lua')
  DEFS.unitDefs = UnitDefs
  UnitDefs = nil
  WeaponDefs = read({{ {weapons} }})
  local rawWeapons = copy(WeaponDefs, {{}})
  VFS.Include('gamedata/weapondefs_post.lua')
  return {{ units = DEFS.unitDefs, weapons = WeaponDefs, rawUnits = rawUnits, rawWeapons = rawWeapons }}
end)()"#,
        units = list(&units),
        weapons = list(&game.weapons),
    );
    let vm = SpringLua::with_files(root.path(), files).expect("vm");
    let out = vm
        .eval_expr_value(&source, "load.lua")
        .unwrap_or_else(|e| panic!("{e}"));
    let table = |key: &str| -> Map<String, Value> {
        out[key]
            .as_object()
            .cloned()
            .unwrap_or_else(|| panic!("{key} is not a table"))
    };
    let (units, weapons) = (table("units"), table("weapons"));
    let before_post = BeforePost::read(&units, &weapons, &table("rawUnits"), &table("rawWeapons"));
    Loaded {
        units,
        weapons,
        before_post,
    }
}

/// Compile `edits` and hand back the mutator's files.
fn mutator(edits: Value) -> Vec<(String, String)> {
    let project: ModProject = serde_json::from_value(json!({
        "name": "TEST post-processing (delete me)",
        "gameName": "Balanced Annihilation V15.9.8",
        "edits": edits,
    }))
    .expect("parse");
    compile(&project)
        .files
        .into_iter()
        .map(|file| (file.path, file.contents))
        .collect()
}

/// A copy of `source` under `key`, as the unit page makes one: the unit as the
/// worker read it, with a name of its own and what the post files changed.
fn copied_unit(game: &Loaded, source: &str, key: &str) -> Value {
    let mut def = game.units[source].clone();
    def["humanName"] = json!(format!("{source} copy"));
    json!({
        "key": key,
        "source": source,
        "replacesGameUnit": false,
        "def": def,
        "beforePost": game.before_post.units.get(source),
    })
}

/// A copy of the game weapon `source` into the library under `key`.
fn copied_weapon(game: &Loaded, source: &str, key: &str) -> Value {
    json!({
        "key": key,
        "source": source,
        "def": game.weapons[source],
        "beforePost": game.before_post.weapon_defs.get(source),
    })
}

/// A game with Balanced Annihilation V15.9.8's post-processing, cut down to
/// what matters here. `unitdefs_post.lua` runs `WeaponDef_Post` over each
/// weapon a unit carries, and `weapondefs_post.lua` puts those weapons into the
/// shared table, points each slot at one by full name, and runs
/// `WeaponDef_Post` over them again. So a weapon a unit carries has its crater
/// multiplier scaled twice and one out of `weapons/` once, as in the real game.
fn model_game() -> Game {
    let files: BTreeMap<String, String> = [
        (
            "gamedata/alldefs_post.lua",
            r#"
function UnitDef_Post(name, ud) end
function WeaponDef_Post(name, wd)
  wd.cratermult = (wd.cratermult or 1) * 0.3
end
"#,
        ),
        (
            "gamedata/unitdefs_post.lua",
            r#"
VFS.Include("gamedata/alldefs_post.lua")
for name, ud in pairs(UnitDefs) do
  UnitDef_Post(name, ud)
  if ud.weapondefs then
    for wname, wd in pairs(ud.weapondefs) do WeaponDef_Post(wname, wd) end
  end
end
"#,
        ),
        (
            "gamedata/weapondefs_post.lua",
            r#"
VFS.Include("gamedata/alldefs_post.lua")
for name, wd in pairs(WeaponDefs) do WeaponDef_Post(name, wd) end
for udName, ud in pairs(DEFS.unitDefs) do
  if type(ud.weapondefs) == 'table' then
    for wdName, wd in pairs(ud.weapondefs) do
      local fullName = udName .. '_' .. wdName
      WeaponDefs[fullName] = wd
      WeaponDef_Post(fullName, wd)
    end
  end
  if type(ud.weapons) == 'table' then
    for i = 1, 32 do
      local w = ud.weapons[i]
      if type(w) == 'table' then
        if type(w.def) == 'string' then
          local fullName = udName .. '_' .. string.lower(w.def)
          if type(WeaponDefs[fullName]) == 'table' then w.name = fullName end
        end
        w.def = nil
      end
    end
  end
end
"#,
        ),
        (
            "units/armbrtha.lua",
            r#"return { armbrtha = {
  humanName = "Big Bertha",
  weapons = { [1] = { def = "ARM_BERTHACANNON", onlytargetcategory = "SURFACE" } },
  weapondefs = { arm_berthacannon = { cratermult = 0.1, range = 4650 } },
} }"#,
        ),
        (
            "units/armcom.lua",
            r#"return { armcom = {
  humanName = "Commander",
  weapons = {
    [1] = { def = "ARMCOMLASER", onlytargetcategory = "NOTSUB" },
    [2] = { def = "ARMCOMSEALASER" },
  },
  weapondefs = {
    armcomlaser = { range = 300 },
    armcomsealaser = { cratermult = 0, range = 260 },
  },
} }"#,
        ),
        (
            "weapons/commander_blast.lua",
            r#"return { commander_blast = { cratermult = 3, areaofeffect = 720 } }"#,
        ),
    ]
    .into_iter()
    .map(|(path, text)| (path.to_string(), text.to_string()))
    .collect();
    Game {
        files,
        units: vec!["units/armbrtha.lua".into(), "units/armcom.lua".into()],
        weapons: vec!["weapons/commander_blast.lua".into()],
    }
}

/// Balanced Annihilation V15.9.8's own post files, the two units the checks
/// use and every weapon out of its `weapons/` folder, read out of the
/// installed archive. `None` where it is not installed.
fn balanced_annihilation() -> Option<Game> {
    let path = std::env::var_os("COILBOX_BA_ARCHIVE")
        .map(PathBuf::from)
        .or_else(|| {
            std::env::var_os("HOME").map(|home| {
                PathBuf::from(home).join(".spring/games/balanced_annihilation-v15.9.8.sdz")
            })
        })?;
    let file = std::fs::File::open(&path).ok()?;
    let mut archive = zip::ZipArchive::new(file).expect("a zip");
    let wanted = [
        "gamedata/alldefs_post.lua",
        "gamedata/unitdefs_post.lua",
        "gamedata/weapondefs_post.lua",
        "gamedata/post_save_to_customparams.lua",
        "units/armbrtha.lua",
        "units/armcom.lua",
    ];
    let mut files = BTreeMap::new();
    let mut weapons = Vec::new();
    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).expect("an entry");
        let name = entry.name().to_string();
        let weapon = name.starts_with("weapons/") && name.ends_with(".lua");
        if !wanted.contains(&name.as_str()) && !weapon {
            continue;
        }
        let mut text = String::new();
        entry.read_to_string(&mut text).expect("utf-8 Lua");
        if weapon {
            weapons.push(name.clone());
        }
        files.insert(name, text);
    }
    assert_eq!(
        files.len() - weapons.len(),
        wanted.len(),
        "{} is missing a file this test reads",
        path.display()
    );
    weapons.sort();
    Some(Game {
        files,
        units: vec!["units/armbrtha.lua".into(), "units/armcom.lua".into()],
        weapons,
    })
}

fn cratermult(weapons: &Map<String, Value>, name: &str) -> Value {
    weapons
        .get(name)
        .unwrap_or_else(|| panic!("no weapon {name}"))
        .get("cratermult")
        .cloned()
        .unwrap_or(Value::Null)
}

/// A copied unit loads with the weapon its source has. With nothing else in
/// the project the mutator has no post file, so the game's own
/// `unitdefs_post.lua` runs over the copy, as it does over the source.
fn a_copied_unit_loads_like_its_source(game: &Game) {
    let alone = load(game, &[]);
    let files = mutator(json!({
        "clones": { "armbrtha2": copied_unit(&alone, "armbrtha", "armbrtha2") }
    }));
    assert!(
        files
            .iter()
            .all(|(path, _)| path != "gamedata/unitdefs_post.lua"),
        "a copy on its own needs no post file"
    );
    let modded = load(game, &files);
    let source = "armbrtha_arm_berthacannon";
    let copy = "armbrtha2_arm_berthacannon";
    assert_eq!(
        cratermult(&modded.weapons, copy),
        cratermult(&alone.weapons, source),
        "the copy's crater multiplier against the game's own"
    );
    assert_eq!(modded.weapons[copy], modded.weapons[source]);
    assert_eq!(
        modded.units["armbrtha2"]["weapons"][0]["name"],
        json!(copy),
        "the copy's slot fires its own weapon"
    );
    // The whole unit, not only the weapon, apart from its name and the prefix
    // on the weapons it carries.
    let unnamed = |unit: &Value, prefix: &str| {
        let text = serde_json::to_string(unit)
            .expect("json")
            .replace(prefix, "UNIT_");
        let mut unit: Map<String, Value> = serde_json::from_str(&text).expect("json");
        unit.retain(|k, _| !matches!(k.to_lowercase().as_str(), "name" | "humanname"));
        unit
    };
    assert_eq!(
        unnamed(&modded.units["armbrtha2"], "armbrtha2_"),
        unnamed(&alone.units["armbrtha"], "armbrtha_"),
    );
}

/// Library weapons equipped into a game unit load equal to the weapons they
/// were copied from. The equip is a block in the mutator's post file, which
/// takes the place of the game's own, so both the copies and their sources
/// miss the game's `unitdefs_post.lua` and are compared within one load.
fn library_weapons_load_like_their_sources(game: &Game) {
    let alone = load(game, &[]);
    let files = mutator(json!({
        "weapons": {
            "berthacannon_copy": copied_weapon(&alone, "armbrtha_arm_berthacannon", "berthacannon_copy"),
            "armcomlaser_copy": copied_weapon(&alone, "armcom_armcomlaser", "armcomlaser_copy"),
        },
        "equipped": { "armcom": { "0": "berthacannon_copy", "1": "armcomlaser_copy" } }
    }));
    let modded = load(game, &files);
    for (copy, source) in [
        ("armcom_berthacannon_copy", "armbrtha_arm_berthacannon"),
        ("armcom_armcomlaser_copy", "armcom_armcomlaser"),
    ] {
        assert_eq!(
            modded.weapons[copy], modded.weapons[source],
            "{copy} against {source}"
        );
    }
    assert_eq!(
        modded.units["armcom"]["weapons"][0]["name"],
        json!("armcom_berthacannon_copy")
    );
}

#[test]
fn a_copied_unit_loads_like_its_source_in_a_game_that_scales_on_load() {
    a_copied_unit_loads_like_its_source(&model_game());
}

#[test]
fn library_weapons_load_like_their_sources_in_a_game_that_scales_on_load() {
    library_weapons_load_like_their_sources(&model_game());
}

/// The model game really does scale, so the two tests above could fail.
#[test]
fn the_model_game_scales_a_carried_weapon_twice() {
    let alone = load(&model_game(), &[]);
    let got = cratermult(&alone.weapons, "armbrtha_arm_berthacannon")
        .as_f64()
        .expect("a number");
    assert!((got - 0.009).abs() < 1e-9, "got {got}");
}

#[test]
fn a_copied_unit_loads_like_its_source_in_balanced_annihilation() {
    let Some(game) = balanced_annihilation() else {
        eprintln!("Balanced Annihilation V15.9.8 is not installed, so this checks nothing");
        return;
    };
    a_copied_unit_loads_like_its_source(&game);
}

#[test]
fn library_weapons_load_like_their_sources_in_balanced_annihilation() {
    let Some(game) = balanced_annihilation() else {
        eprintln!("Balanced Annihilation V15.9.8 is not installed, so this checks nothing");
        return;
    };
    library_weapons_load_like_their_sources(&game);
}
