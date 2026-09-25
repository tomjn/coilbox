//! What the generated Lua does, rather than what it looks like.
//!
//! The unit tests beside the compiler check the text it writes, which catches a
//! typo in a heading and misses a `do` with no `end`. These run the same output
//! in a real Lua 5.1 VM against a stand-in `UnitDefs` and check what came out
//! the other side, which is the only thing the player ever experiences.
//!
//! The one that matters is the build menu. The editor replays operations over
//! the game's list in TypeScript to draw the menu on screen, and the generated
//! Lua replays them again in the game. Two implementations of one rule is
//! exactly the arrangement that drifts, and a menu that reads one way in
//! coilbox and loads another way in the game is the bug nobody would think to
//! look for.

use coilbox_springlua::SpringLua;
use serde_json::{json, Value};
use tauri_plugin_coilbox_workshop::{compile, LuaForm, ModProject};

/// Run every block a project compiled to, over a stand-in unit table, and hand
/// back what the table became.
fn run(edits: Value, unit_defs: &str) -> Value {
    let project: ModProject = serde_json::from_value(json!({
        "name": "Test project",
        "gameName": "Balanced Annihilation V15.9.8",
        "edits": edits,
    }))
    .expect("parse");
    let blocks: Vec<String> = compile(&project)
        .chunks
        .into_iter()
        .filter(|chunk| chunk.form == LuaForm::Block)
        .map(|chunk| chunk.lua)
        .collect();
    assert!(!blocks.is_empty(), "nothing compiled to a block");

    let root = tempfile::tempdir().expect("tempdir");
    let lua = SpringLua::new(root.path()).expect("vm");
    // Read back with integer keys kept, so a table with a gap in its numbers
    // comes back as the object the unitsync worker would read it as rather
    // than cut short at the gap.
    let source = format!(
        "(function()\nlocal UnitDefs = {unit_defs}\n\n{}\n\nreturn UnitDefs\nend)()",
        blocks.join("\n\n")
    );
    lua.eval_expr_value(&source, "generated.lua")
        .unwrap_or_else(|e| panic!("{e}\n\n{source}"))
}

/// Add, remove and move, replayed over a list the compiler never saw. The
/// expected list is what `applyBuildMenu` in `src/workshop/buildMenus.ts`
/// produces for the same three operations.
#[test]
fn a_build_menu_block_replays_the_operations_the_editor_recorded() {
    let out = run(
        json!({
            "menus": { "armlab": [
                { "op": "add", "unit": "armpw" },
                { "op": "remove", "unit": "armflash" },
                { "op": "move", "unit": "armrock", "before": "armham" }
            ] }
        }),
        r#"{ armlab = { buildoptions = { "armflash", "armham", "armrock" } } }"#,
    );
    assert_eq!(
        out["armlab"]["buildoptions"],
        json!(["armrock", "armham", "armpw"])
    );
}

/// Issue #3041. The unit page counts a list numbered 1 to n from zero, and
/// reads any other table, such as XTA's commander with weapons 1 and 3 and no
/// 2, by its own keys. The compiler never sees the game, so the generated Lua
/// has to tell the two apart when it runs.
#[test]
fn a_field_change_through_a_list_position_lands_where_the_page_read_it() {
    let out = run(
        json!({
            "overrides": {
                "armcom": {
                    "weapons.3.name": "ARM_DGUN",
                    "weapons.1.onlytargetcategory": "SURFACE",
                    "maxdamage": 4000
                },
                "corcom": { "weapons.1.name": "COR_DGUN" },
                "newlist": { "customparams.recoil.0": 5 },
                "gone": { "weapons.0.name": "X" }
            }
        }),
        r#"{
            armcom = { maxdamage = 3500, weapons = {
                [1] = { name = "CSARMCOMLASER" },
                [3] = { name = "CSARM_DISINTEGRATOR" },
            } },
            corcom = { weapons = { { name = "CORLASER" }, { name = "CORDGUN" } } },
            newlist = { customparams = {} },
        }"#,
    );
    assert_eq!(
        out["armcom"]["weapons"],
        json!({
            "1": { "name": "CSARMCOMLASER", "onlytargetcategory": "SURFACE" },
            "3": { "name": "ARM_DGUN" }
        })
    );
    assert_eq!(
        out["corcom"]["weapons"],
        json!([{ "name": "CORLASER" }, { "name": "COR_DGUN" }])
    );
    assert_eq!(out["newlist"]["customparams"]["recoil"], json!([5]));
    assert!(out.get("gone").is_none());
}

/// The same change through the mutator's whole post file and through BAR's
/// single `tweakdefs` payload, the two outputs that carry every field
/// change. Before issue #3041 both wrote the commander's D-gun change into a
/// fourth weapon of its own.
#[test]
fn the_post_file_and_bar_tweakdefs_change_the_weapon_the_page_showed() {
    let project: ModProject = serde_json::from_value(json!({
        "name": "Test project",
        "gameName": "XTA 9.65",
        "edits": { "overrides": { "armcom": {
            "weapons.3.name": "ARM_DGUN",
            "maxdamage": 4000
        } } },
    }))
    .expect("parse");
    let compiled = compile(&project);
    let post = compiled
        .files
        .iter()
        .find(|f| f.path == "gamedata/unitdefs_post.lua")
        .expect("a post file");
    let unit_defs = r#"{ armcom = { maxdamage = 3500, weapons = {
        [1] = { name = "CSARMCOMLASER" },
        [3] = { name = "CSARM_DISINTEGRATOR" },
    } } }"#;
    for (what, lua) in [
        ("post file", post.contents.clone()),
        (
            "tweakdefs",
            compiled.bar_tweakdefs.clone().expect("tweakdefs"),
        ),
    ] {
        let root = tempfile::tempdir().expect("tempdir");
        let vm = SpringLua::new(root.path()).expect("vm");
        let source =
            format!("(function()\nUnitDefs = {unit_defs}\n(function()\n{lua}\nend)()\nreturn UnitDefs\nend)()");
        let out = vm
            .eval_expr_value(&source, "generated.lua")
            .unwrap_or_else(|e| panic!("{what}: {e}\n\n{source}"));
        assert_eq!(
            out["armcom"],
            json!({
                "maxdamage": 4000,
                "weapons": {
                    "1": { "name": "CSARMCOMLASER" },
                    "3": { "name": "ARM_DGUN" }
                }
            }),
            "{what}"
        );
    }
}

/// Issue #2639. Balanced Annihilation's commander carries its weapon
/// definitions itself, and so does a second unit that happens to call one of
/// its own the same thing. A slot edit and a definition edit on the first
/// land in its own slot and its own definition, through both routes, and the
/// second unit's definition of the same name is untouched.
#[test]
fn a_weapon_edit_changes_this_units_slot_and_definition_and_no_other() {
    let project: ModProject = serde_json::from_value(json!({
        "name": "Test project",
        "gameName": "Balanced Annihilation V15.9.8",
        "edits": { "overrides": { "armcom": {
            "weapons.0.onlytargetcategory": "SURFACE",
            "weapondefs.armcomlaser.range": 400,
            "weapondefs.armcomlaser.damage.subs": 20
        } } },
    }))
    .expect("parse");
    let compiled = compile(&project);
    let post = compiled
        .files
        .iter()
        .find(|f| f.path == "gamedata/unitdefs_post.lua")
        .expect("a post file");
    let unit_defs = r#"{
        armcom = {
            weapons = { { name = "armcom_armcomlaser", onlytargetcategory = "NOTSUB" } },
            weapondefs = { armcomlaser = { range = 300, damage = { default = 75, subs = 5 } } },
        },
        corcom = {
            weapons = { { name = "corcom_armcomlaser" } },
            weapondefs = { armcomlaser = { range = 300, damage = { default = 75, subs = 5 } } },
        },
    }"#;
    for (what, lua) in [
        ("post file", post.contents.clone()),
        (
            "tweakdefs",
            compiled.bar_tweakdefs.clone().expect("tweakdefs"),
        ),
    ] {
        let root = tempfile::tempdir().expect("tempdir");
        let vm = SpringLua::new(root.path()).expect("vm");
        let source =
            format!("(function()\nUnitDefs = {unit_defs}\n(function()\n{lua}\nend)()\nreturn UnitDefs\nend)()");
        let out = vm
            .eval_expr_value(&source, "generated.lua")
            .unwrap_or_else(|e| panic!("{what}: {e}\n\n{source}"));
        assert_eq!(
            out["armcom"],
            json!({
                "weapons": [{ "name": "armcom_armcomlaser", "onlytargetcategory": "SURFACE" }],
                "weapondefs": { "armcomlaser": { "range": 400, "damage": { "default": 75, "subs": 20 } } }
            }),
            "{what}"
        );
        assert_eq!(
            out["corcom"]["weapondefs"],
            json!({ "armcomlaser": { "range": 300, "damage": { "default": 75, "subs": 5 } } }),
            "{what}"
        );
    }
}

/// Tech Annihilation comments entries out of its build lists and leaves the
/// numbers after them as they were. The engine keeps every numbered entry, so
/// a replay that stopped at the first gap would drop the rest from the game.
#[test]
fn a_build_menu_with_gaps_keeps_every_entry_after_them() {
    let out = run(
        json!({ "menus": { "armcom": [{ "op": "add", "unit": "armpw" }] } }),
        r#"{ armcom = { buildoptions = {
            [1] = "armwin", [2] = "armsolar", [4] = "armgeo_mini", [9] = "armmstor",
        } } }"#,
    );
    assert_eq!(
        out["armcom"]["buildoptions"],
        json!(["armwin", "armsolar", "armgeo_mini", "armmstor", "armpw"])
    );
}

/// The game spells the key, not us. A definition writing `buildOptions` has to
/// come back with `buildOptions` rewritten and no second key beside it.
#[test]
fn a_block_writes_back_to_the_key_the_definition_uses() {
    let out = run(
        json!({ "menus": { "armlab": [{ "op": "add", "unit": "armpw" }] } }),
        r#"{ armlab = { buildOptions = { "armflash" } } }"#,
    );
    assert_eq!(out["armlab"]["buildOptions"], json!(["armflash", "armpw"]));
    assert!(out["armlab"].get("buildoptions").is_none());
}

/// A move with no anchor goes to the end, and an anchor that is no longer in
/// the game does the same rather than dropping the unit.
#[test]
fn a_move_whose_anchor_has_gone_puts_the_unit_on_the_end() {
    let out = run(
        json!({
            "menus": { "armlab": [{ "op": "move", "unit": "armpw", "before": "gone" }] }
        }),
        r#"{ armlab = { buildoptions = { "armpw", "armflash" } } }"#,
    );
    assert_eq!(out["armlab"]["buildoptions"], json!(["armflash", "armpw"]));
}

/// A builder the game no longer has is left alone rather than crashing the
/// definition parser, which would take the whole game down with it.
#[test]
fn a_block_for_a_builder_the_game_dropped_does_nothing() {
    let out = run(
        json!({ "menus": { "gone": [{ "op": "add", "unit": "armpw" }] } }),
        r#"{ armlab = { buildoptions = { "armflash" } } }"#,
    );
    assert_eq!(out["armlab"]["buildoptions"], json!(["armflash"]));
    assert!(out.get("gone").is_none());
}

/// Switching a unit off takes it out of every builder in the game, and leaves
/// the unit itself where it is.
#[test]
fn switching_a_unit_off_clears_it_from_every_build_menu() {
    let out = run(
        json!({ "disabled": ["armflash"] }),
        r#"{
            armlab = { buildoptions = { "armflash", "armpw" } },
            armvp = { buildOptions = { "armflash" } },
            armflash = { maxdamage = 100 },
        }"#,
    );
    assert_eq!(out["armlab"]["buildoptions"], json!(["armpw"]));
    // An emptied list comes back as an empty table, which mlua reads as a map.
    assert!(out["armvp"]["buildOptions"]
        .as_array()
        .map(|list| list.is_empty())
        .unwrap_or(true));
    assert_eq!(out["armflash"]["maxdamage"], json!(100));
}

/// Switching a unit off rewrites every list, so a list with gaps in its
/// numbering has to come back with everything after the gaps still in it.
#[test]
fn switching_a_unit_off_keeps_the_entries_after_a_gap() {
    let out = run(
        json!({ "disabled": ["armsolar"] }),
        r#"{ armcom = { buildoptions = {
            [1] = "armwin", [2] = "armsolar", [4] = "armgeo_mini", [9] = "armmstor",
        } } }"#,
    );
    assert_eq!(
        out["armcom"]["buildoptions"],
        json!(["armwin", "armgeo_mini", "armmstor"])
    );
}

/// A whole definition standing in for one the game loaded replaces it rather
/// than merging into it, which is the reason it is a block at all.
#[test]
fn a_replacing_copy_leaves_none_of_the_games_own_fields_behind() {
    let out = run(
        json!({
            "clones": { "armcom": {
                "key": "armcom", "source": "armcom",
                "replacesGameUnit": true,
                "def": { "maxdamage": 9000 }
            } }
        }),
        r#"{ armcom = { maxdamage = 3000, buildtime = 50 } }"#,
    );
    assert_eq!(out["armcom"]["maxdamage"], json!(9000));
    assert!(out["armcom"].get("buildtime").is_none());
}

/// Every block has to stand on its own, because issue #1277 packs each one into
/// a numbered slot and the slots are not ordered by us. Running them one at a
/// time proves none of them leans on a helper another one defined.
#[test]
fn each_block_runs_on_its_own() {
    let project: ModProject = serde_json::from_value(json!({
        "name": "Test project",
        "gameName": "g",
        "edits": {
            "menus": { "armlab": [{ "op": "add", "unit": "armpw" }] },
            "disabled": ["armflash"],
            "clones": { "armcom": {
                "key": "armcom", "replacesGameUnit": true, "def": { "maxdamage": 1 }
            } }
        }
    }))
    .expect("parse");
    let compiled = compile(&project);
    let blocks: Vec<&str> = compiled
        .chunks
        .iter()
        .filter(|chunk| chunk.form == LuaForm::Block)
        .map(|chunk| chunk.lua.as_str())
        .collect();
    assert_eq!(blocks.len(), 3);

    for block in blocks {
        let root = tempfile::tempdir().expect("tempdir");
        let lua = SpringLua::new(root.path()).expect("vm");
        let source = format!(
            "local UnitDefs = {{ armlab = {{ buildoptions = {{ \"a\" }} }} }}\n{block}\nreturn UnitDefs\n"
        );
        lua.eval_value_raw(&source, "generated.lua")
            .unwrap_or_else(|e| panic!("{e}\n\n{source}"));
    }
}

/// The whole mutator, parsed. A file with a `do` and no `end` in it loads as
/// nothing and takes the game's unit definitions with it, and the only symptom
/// is a game that starts with none of the project's changes in it.
///
/// The language file (issue #2743) is the one file here that is not Lua. The
/// game reads it with a JSON decoder, so it is checked with one, and the
/// failure it is being held away from is the same: a file the game cannot
/// read is a file the game acts as though were not there.
#[test]
fn every_generated_file_is_lua_that_parses() {
    let project: ModProject = serde_json::from_value(json!({
        "name": "Everything at once",
        "description": "One of each.",
        "gameName": "Balanced Annihilation V15.9.8",
        "edits": {
            "overrides": {
                "armcom": { "maxdamage": 5000, "weapons.1.name": "CANNON" },
                "supercom": { "buildtime": 10 }
            },
            "clones": {
                "supercom": {
                    "key": "supercom", "source": "armcom",
                    "replacesGameUnit": false,
                    "def": { "maxdamage": 9000, "buildoptions": ["armpw"] }
                },
                "armflash": {
                    "key": "armflash", "source": "armflash",
                    "replacesGameUnit": true,
                    "def": { "maxdamage": 1 }
                }
            },
            "menus": {
                "armlab": [{ "op": "move", "unit": "armpw", "before": null }],
                "supercom": [{ "op": "add", "unit": "armmex" }]
            },
            "disabled": ["armstump"],
            "text": { "armcom": { "en": { "name": "Commander" } } }
        }
    }))
    .expect("parse");
    let compiled = compile(&project);
    assert!(compiled.files.len() >= 3);

    assert!(compiled
        .files
        .iter()
        .any(|f| f.path == "language/en/zz_coilbox.json"));

    for file in &compiled.files {
        if file.path.ends_with(".json") {
            let parsed: Value = serde_json::from_str(&file.contents)
                .unwrap_or_else(|e| panic!("{} does not parse as JSON: {e}", file.path));
            assert_eq!(parsed["units"]["names"]["armcom"], json!("Commander"));
            continue;
        }
        let root = tempfile::tempdir().expect("tempdir");
        let lua = SpringLua::new(root.path()).expect("vm");
        // Wrapped in a function body rather than run, because a `modinfo.lua`
        // returns a table and a post file returns nothing, and the question
        // here is only whether the VM will accept the source at all. The
        // sandbox takes `loadstring` away, which is the correct thing for it to
        // do, so this is how a chunk gets compiled without being called.
        let source = format!(
            "local check = function()\n{}\nend\nreturn {{ ok = check ~= nil }}\n",
            file.contents
        );
        let out = lua
            .eval_value_raw(&source, &file.path)
            .unwrap_or_else(|e| panic!("{} does not parse: {e}", file.path));
        assert_eq!(out["ok"], json!(true));
    }
}

/// What a game's `weapondefs_post.lua` does with the unit table once the
/// mutator's `unitdefs_post.lua` or a BAR tweak slot has run over it: put
/// each unit's own definitions into the shared table as `<unit>_<name>`,
/// then, for a game that binds a slot by `def`, point the slot at one. The
/// `def` half is the loop in the base content's `ProcessUnitDef`, Balanced
/// Annihilation's `ExtractWeaponDefs` and Beyond All Reason's own post file.
/// A game that binds by `name` skips it. Returns the unit table, the shared
/// table, and the range of the weapon each slot ends up firing, as the engine
/// would look it up by lowercased name.
fn load_weapons(generated: &str, unit_defs: &str, shared: &str, by_def: bool) -> Value {
    let root = tempfile::tempdir().expect("tempdir");
    let vm = SpringLua::new(root.path()).expect("vm");
    let source = format!(
        "(function()\n\
         UnitDefs = {unit_defs}\n\
         (function()\n{generated}\nend)()\n\
         local WeaponDefs = {shared}\n\
         local byDef = {by_def}\n\
         for udName, ud in pairs(UnitDefs) do\n\
           if type(ud.weapondefs) == 'table' then\n\
             for name, wd in pairs(ud.weapondefs) do WeaponDefs[udName .. '_' .. name] = wd end\n\
           end\n\
           if byDef and type(ud.weapons) == 'table' then\n\
             for i = 1, 32 do\n\
               local w = ud.weapons[i]\n\
               if type(w) == 'table' then\n\
                 if type(w.def) == 'string' then\n\
                   local full = udName .. '_' .. string.lower(w.def)\n\
                   if type(WeaponDefs[full]) == 'table' then w.name = full end\n\
                 end\n\
                 w.def = nil\n\
               end\n\
             end\n\
           end\n\
         end\n\
         local fires = {{}}\n\
         for udName, ud in pairs(UnitDefs) do\n\
           fires[udName] = {{}}\n\
           for i = 1, 32 do\n\
             local w = ud.weapons and ud.weapons[i]\n\
             if type(w) == 'table' and type(w.name) == 'string' then\n\
               local wd = WeaponDefs[string.lower(w.name)]\n\
               fires[udName][tostring(i)] = wd and wd.range or 'nothing'\n\
             end\n\
           end\n\
         end\n\
         return {{ fires = fires, units = UnitDefs }}\n\
         end)()"
    );
    vm.eval_expr_value(&source, "generated.lua")
        .unwrap_or_else(|e| panic!("{e}\n\n{source}"))
}

/// The mutator's post file and the BAR tweakdefs a project compiled to.
fn both_routes(edits: Value) -> Vec<(&'static str, String)> {
    let project: ModProject = serde_json::from_value(json!({
        "name": "Test project",
        "gameName": "Balanced Annihilation V15.9.8",
        "edits": edits,
    }))
    .expect("parse");
    let compiled = compile(&project);
    let post = compiled
        .files
        .iter()
        .find(|f| f.path == "gamedata/unitdefs_post.lua")
        .expect("a post file")
        .contents
        .clone();
    vec![
        ("post file", post),
        ("tweakdefs", compiled.bar_tweakdefs.expect("tweakdefs")),
    ]
}

/// Issue #2640. Balanced Annihilation's commander names its weapon by `def`
/// in its own file, and so does Beyond All Reason's. A library weapon
/// equipped into the first slot is fired by that slot with the project's
/// changes on it, the unit's second slot and a second unit whose weapon has
/// the same short name are untouched, and the mount fields stay where they
/// were. Run once as a game that binds by `def` and once as one that binds by
/// `name`, since the compiled Lua writes both.
#[test]
fn an_equipped_library_weapon_is_what_the_slot_fires_in_a_def_bound_game() {
    let routes = both_routes(json!({
        "weapons": { "heavylaser": {
            "key": "heavylaser",
            "source": "armcom_armcomlaser",
            "def": { "range": 300, "damage": { "default": 75 } },
            "changes": { "range": 450, "damage.default": 200 }
        } },
        "equipped": { "armcom": { "0": "heavylaser" } }
    }));
    let unit_defs = r#"{
        armcom = {
            weapons = {
                { def = "ARMCOMLASER", onlytargetcategory = "NOTSUB" },
                { def = "ARM_DISINTEGRATOR" },
            },
            weapondefs = {
                armcomlaser = { range = 300, damage = { default = 75 } },
                arm_disintegrator = { range = 250 },
            },
        },
        corcom = {
            weapons = { { def = "ARMCOMLASER" } },
            weapondefs = { armcomlaser = { range = 300 } },
        },
    }"#;
    for (what, lua) in routes {
        for by_def in [true, false] {
            let out = load_weapons(&lua, unit_defs, "{}", by_def);
            let fires = &out["fires"];
            assert_eq!(fires["armcom"]["1"], json!(450), "{what}, by_def {by_def}");
            assert_eq!(
                out["units"]["armcom"]["weapons"][0]["onlytargetcategory"],
                json!("NOTSUB"),
                "{what}"
            );
            assert_eq!(
                out["units"]["armcom"]["weapondefs"]["heavylaser"]["damage"],
                json!({ "default": 200 }),
                "{what}"
            );
            if by_def {
                assert_eq!(fires["armcom"]["2"], json!(250), "{what}");
                assert_eq!(fires["corcom"]["1"], json!(300), "{what}");
            }
            assert_eq!(
                out["units"]["corcom"]["weapondefs"],
                json!({ "armcomlaser": { "range": 300 } }),
                "{what}"
            );
        }
    }
}

/// Issue #3052. XTA's commander names a weapon out of the game's shared
/// `weapons/` folder by `name`, in a list with a gap in it, and so does a
/// second unit. Giving the first its own copy and equipping it points that
/// one slot at the copy, and the shared weapon and the second unit's slot are
/// exactly as they were.
#[test]
fn a_copy_of_a_shared_weapon_changes_one_unit_and_not_the_others() {
    let routes = both_routes(json!({
        "weapons": { "arm_comlaser_copy": {
            "key": "arm_comlaser_copy",
            "source": "arm_comlaser",
            "def": { "range": 280, "weapontype": "LaserCannon" },
            "changes": { "range": 500 }
        } },
        "equipped": { "arm_commander": { "1": "arm_comlaser_copy" } }
    }));
    let unit_defs = r#"{
        arm_commander = {
            weapons = {
                [1] = { name = "ARM_COMLASER", onlytargetcategory = "NOTAIR" },
                [3] = { name = "ARM_DISINTEGRATOR" },
            },
        },
        core_commander = { weapons = { [1] = { name = "ARM_COMLASER" } } },
    }"#;
    let shared = r#"{
        arm_comlaser = { range = 280, weapontype = "LaserCannon" },
        arm_disintegrator = { range = 250 },
    }"#;
    for (what, lua) in routes {
        let out = load_weapons(&lua, unit_defs, shared, true);
        let fires = &out["fires"];
        assert_eq!(fires["arm_commander"]["1"], json!(500), "{what}");
        assert_eq!(fires["arm_commander"]["3"], json!(250), "{what}");
        assert_eq!(fires["core_commander"]["1"], json!(280), "{what}");
        assert_eq!(
            out["units"]["arm_commander"]["weapons"]["1"]["onlytargetcategory"],
            json!("NOTAIR"),
            "{what}"
        );
        assert_eq!(
            out["units"]["core_commander"]["weapons"][0]["name"],
            json!("ARM_COMLASER"),
            "{what}"
        );
    }
}

/// What Beyond All Reason does with the references between a unit's weapons
/// once a tweak has run (issue #2641): `processWeapons` in
/// `gamedata/alldefs_post.lua` prefixes a short `cluster_def` with the unit's
/// name, and `weapondefs_post.lua` puts each definition a unit carries into
/// the shared table as `<unit>_<name>`. The two gadgets then look each
/// reference up by name. Returns, per unit and definition, the range of what
/// each reference finds, or `nothing`.
fn resolve_references(generated: &str, unit_defs: &str) -> Value {
    let root = tempfile::tempdir().expect("tempdir");
    let vm = SpringLua::new(root.path()).expect("vm");
    let source = format!(
        "(function()\n\
         UnitDefs = {unit_defs}\n\
         (function()\n{generated}\nend)()\n\
         local WeaponDefs = {{}}\n\
         for udName, ud in pairs(UnitDefs) do\n\
           for name, wd in pairs(ud.weapondefs or {{}}) do\n\
             if wd.customparams and wd.customparams.cluster_def then\n\
               wd.customparams.cluster_def = udName .. '_' .. wd.customparams.cluster_def\n\
             end\n\
             WeaponDefs[udName .. '_' .. name] = wd\n\
           end\n\
         end\n\
         local found = {{}}\n\
         for udName, ud in pairs(UnitDefs) do\n\
           found[udName] = {{}}\n\
           for name, wd in pairs(ud.weapondefs or {{}}) do\n\
             local cp = wd.customparams or {{}}\n\
             local function range(ref)\n\
               if ref == nil then return 'none' end\n\
               local hit = WeaponDefs[string.lower(ref)]\n\
               return hit and hit.range or 'nothing'\n\
             end\n\
             found[udName][name] = {{ cluster = range(cp.cluster_def), split = range(cp.speceffect_def), range = wd.range }}\n\
           end\n\
         end\n\
         return found\n\
         end)()"
    );
    vm.eval_expr_value(&source, "generated.lua")
        .unwrap_or_else(|e| panic!("{e}\n\n{source}"))
}

/// A stand-in for Beyond All Reason's `armmship` as its file has it: a rocket
/// whose split names the unmounted `rocket_split` by full name, and a second
/// ship with a definition of the same short name that must not move.
const SHIPS: &str = r#"{
    armmship = {
        weapons = { { def = "ROCKET" } },
        weapondefs = {
            rocket = { range = 1000, customparams = { speceffect = "split", speceffect_def = "armmship_rocket_split" } },
            rocket_split = { range = 300 },
        },
    },
    cormship = {
        weapons = { { def = "ROCKET" } },
        weapondefs = {
            rocket = { range = 1000, customparams = { speceffect = "split", speceffect_def = "cormship_rocket_split" } },
            rocket_split = { range = 300 },
        },
    },
}"#;

/// Issue #2641. An edit to a definition no slot mounts is an ordinary edit
/// to the unit, and reaches that unit's definition and no other on both
/// routes.
#[test]
fn an_edit_to_a_supporting_definition_reaches_that_unit_alone() {
    let routes = both_routes(json!({
        "overrides": { "armmship": { "weapondefs.rocket_split.range": 450 } }
    }));
    for (what, lua) in routes {
        let found = resolve_references(&lua, SHIPS);
        assert_eq!(found["armmship"]["rocket"]["split"], json!(450), "{what}");
        assert_eq!(found["cormship"]["rocket"]["split"], json!(300), "{what}");
    }
}

/// Issue #2641. A library weapon equipped into a game unit brings the library
/// weapons it names, and both references find the library's copies in that
/// unit: the full name the block writes, and the short name the game's post
/// files prefix. The unit's own child is untouched.
#[test]
fn an_equipped_library_weapon_fires_its_own_children() {
    let routes = both_routes(json!({
        "weapons": {
            "rocket_copy": {
                "key": "rocket_copy", "source": "armmship_rocket",
                "def": { "range": 1000, "customparams": {
                    "speceffect": "split", "speceffect_def": "rocket_split_copy",
                    "cluster_def": "munition_copy"
                } }
            },
            "rocket_split_copy": {
                "key": "rocket_split_copy", "source": "armmship_rocket_split",
                "def": { "range": 300 }, "changes": { "range": 350 }
            },
            "munition_copy": {
                "key": "munition_copy", "source": "legcluster_cluster_munition",
                "def": { "range": 100 }
            }
        },
        "equipped": { "armmship": { "0": "rocket_copy" } }
    }));
    for (what, lua) in routes {
        let found = resolve_references(&lua, SHIPS);
        let copy = &found["armmship"]["rocket_copy"];
        assert_eq!(copy["split"], json!(350), "{what}");
        assert_eq!(copy["cluster"], json!(100), "{what}");
        assert_eq!(found["armmship"]["rocket"]["split"], json!(300), "{what}");
        assert_eq!(
            found["cormship"]["rocket_split_copy"],
            Value::Null,
            "{what}"
        );
    }
}

/// What Beyond All Reason's and Balanced Annihilation's `weapondefs_post.lua`
/// and the engine do with a unit's death explosions once a tweak or the
/// mutator's post file has run (issue #2642). Each unit's own definitions go
/// into the shared table as `<unit>_<name>`. A field naming exactly one of
/// those short names, as written, becomes that full name. The engine then
/// looks the field up lowercased, and `selfDestructAs` falls back to
/// `explodeAs` when unset (`UnitDef.cpp`). Returns, per unit, the area of
/// effect of what each field finds, or `nothing`.
fn load_deaths(generated: &str, unit_defs: &str, shared: &str) -> Value {
    let root = tempfile::tempdir().expect("tempdir");
    let vm = SpringLua::new(root.path()).expect("vm");
    let source = format!(
        "(function()\n\
         UnitDefs = {unit_defs}\n\
         (function()\n{generated}\nend)()\n\
         local WeaponDefs = {shared}\n\
         for udName, ud in pairs(UnitDefs) do\n\
           for name, wd in pairs(ud.weapondefs or {{}}) do WeaponDefs[udName .. '_' .. name] = wd end\n\
           for _, f in ipairs({{ 'explodeas', 'selfdestructas' }}) do\n\
             if type(ud[f]) == 'string' and WeaponDefs[udName .. '_' .. ud[f]] then\n\
               ud[f] = udName .. '_' .. ud[f]\n\
             end\n\
           end\n\
         end\n\
         local found = {{}}\n\
         for udName, ud in pairs(UnitDefs) do\n\
           local function aoe(name)\n\
             local hit = type(name) == 'string' and WeaponDefs[string.lower(name)]\n\
             return hit and hit.areaofeffect or 'nothing'\n\
           end\n\
           found[udName] = {{ dies = aoe(ud.explodeas), selfd = aoe(ud.selfdestructas or ud.explodeas) }}\n\
         end\n\
         return found\n\
         end)()"
    );
    vm.eval_expr_value(&source, "generated.lua")
        .unwrap_or_else(|e| panic!("{e}\n\n{source}"))
}

/// Issue #2642. A copy of a shared explosion out of `weapons/`, made the
/// death explosion of one unit, is what that unit explodes as on both routes.
/// Its self-destruct, which names the same shared explosion, and a second
/// unit that dies with it are untouched, and so is the shared definition.
/// A unit with no `selfdestructas` self-destructs as its new death explosion,
/// because that is the engine's fallback.
#[test]
fn a_copied_death_explosion_is_what_that_unit_explodes_as() {
    let routes = both_routes(json!({
        "weapons": { "big_unitex_copy": {
            "key": "big_unitex_copy",
            "source": "big_unitex",
            "def": { "areaofeffect": 64, "damage": { "default": 25 } },
            "changes": { "areaofeffect": 200 }
        } },
        "equipped": {
            "armpw": { "explodeas": "big_unitex_copy" },
            "armflash": { "explodeas": "big_unitex_copy" }
        }
    }));
    let unit_defs = r#"{
        armpw = { explodeas = "BIG_UNITEX", selfdestructas = "BIG_UNITEX" },
        armflash = { explodeAs = "big_unitex" },
        corak = { explodeas = "big_unitex", selfdestructas = "BIG_UNITEX" },
    }"#;
    let shared = r#"{ big_unitex = { areaofeffect = 64, damage = { default = 25 } } }"#;
    for (what, lua) in routes {
        let found = load_deaths(&lua, unit_defs, shared);
        assert_eq!(found["armpw"]["dies"], json!(200), "{what}");
        assert_eq!(found["armpw"]["selfd"], json!(64), "{what}");
        assert_eq!(found["corak"]["dies"], json!(64), "{what}");
        assert_eq!(found["corak"]["selfd"], json!(64), "{what}");
        // `explodeAs` in capitals: the block writes the key the unit uses, so
        // the lowercase read below finds nothing new beside it.
        let raw = load_weapons(&lua, unit_defs, shared, false);
        assert_eq!(
            raw["units"]["armflash"]["explodeAs"],
            json!("armflash_big_unitex_copy"),
            "{what}"
        );
        assert_eq!(raw["units"]["armflash"]["explodeas"], Value::Null, "{what}");
    }
}
