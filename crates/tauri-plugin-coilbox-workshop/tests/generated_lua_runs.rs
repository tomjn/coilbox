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
    let source = format!(
        "local UnitDefs = {unit_defs}\n\n{}\n\nreturn UnitDefs\n",
        blocks.join("\n\n")
    );
    lua.eval_value_raw(&source, "generated.lua")
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
