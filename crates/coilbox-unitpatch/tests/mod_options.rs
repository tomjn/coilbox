//! `Spring.GetModOptions()` stood in for the post-check (issue #3038).
//!
//! `fixtures/sf_game` gets SplinterFaction's chicken queen shape added to it:
//! two of the six real unit files (`chickenboss_easy.lua`,
//! `chickenboss_normal.lua`, copied byte for byte), the shared basedef they
//! build their table from (trimmed), and an excerpt of the game's own
//! `ModOptions.lua` declaring one option, `startmetal`, that neither unit
//! file reads. `chicken_queentimemult`, the option they do read, is not
//! declared by the real game either, so the fixture matches that too.

use std::path::{Path, PathBuf};

use coilbox_unitpatch::{evaluate, parse_path, patch, Edit, Op, Refusal, RefusalKind, Value};

fn game() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/sf_game")
}

fn read(rel: &str) -> String {
    let path = game().join(rel);
    std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("{}: {e}", path.display()))
}

const EASY: &str = "Units/chickens/chickenboss_easy.lua";
const NORMAL: &str = "Units/chickens/chickenboss_normal.lua";

#[track_caller]
fn refused(result: Result<coilbox_unitpatch::Patched, Refusal>, kind: RefusalKind) -> Refusal {
    match result {
        Ok(patched) => panic!("expected {kind:?}, got a patch:\n{}", patched.text),
        Err(refusal) => {
            assert_eq!(refusal.kind, kind, "{refusal}");
            refusal
        }
    }
}

/// Before the fix, this is exactly how the bug showed up: the file could not
/// be run at all, because `Spring.GetModOptions()` did not exist in the
/// sandbox. `chicken_queentimemult` is not declared by the game's own
/// `ModOptions.lua`, so the stand-in has to fall back to a plain number for
/// the arithmetic to go through.
#[test]
fn a_unit_that_multiplies_by_an_undeclared_mod_option_now_runs() {
    let source = read(EASY);
    let result = evaluate(&source, &game()).expect("the file runs");
    let unit = &result["chickenboss_easy"];
    // hitPoints = 125000 * <fallback 1>, then buildCostMetal = ceil(hitPoints / 2.5).
    assert_eq!(unit["buildcostmetal"], 50000.0);
}

/// A second unit file reading the same undeclared option gets the same
/// fallback, so the before/after comparison the post-check makes never sees
/// this table move on its own.
#[test]
fn a_second_unit_reading_the_same_option_gets_the_same_fallback() {
    let source = read(NORMAL);
    let result = evaluate(&source, &game()).expect("the file runs");
    let unit = &result["chickenboss_normal"];
    // hitPoints = 150000 * <fallback 1>, then buildCostMetal = ceil(hitPoints / 2.5).
    assert_eq!(unit["buildcostmetal"], 60000.0);
}

/// A unit that reads an option the game *does* declare gets the game's own
/// default, not the generic fallback.
#[test]
fn a_declared_mod_option_reads_as_the_games_own_default() {
    let source = "return { x = { metal = Spring.GetModOptions().startmetal } }";
    let result = evaluate(source, &game()).expect("the file runs");
    assert_eq!(result["x"]["metal"], 1000.0);
}

/// Now that the file runs, an edit to a field in the shared basedef is
/// refused for the real reason (`FileShared`), not because the check could
/// not evaluate the file at all.
#[test]
fn a_field_in_the_shared_basedef_is_still_refused_as_shared() {
    let source = read(EASY);
    let edit = Edit {
        unit: "chickenboss_easy".into(),
        path: parse_path("maxdamage").expect("valid path"),
        op: Op::Set(Value::Number(50000.0)),
    };
    let refusal = refused(patch(&source, &edit, &game()), RefusalKind::FileShared);
    assert!(
        refusal.to_string().contains("chickenboss_basedef.lua"),
        "{refusal}"
    );
}
