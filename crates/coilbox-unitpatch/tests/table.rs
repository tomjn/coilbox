//! A whole table written into a unit's file (issue #3055): a weapon added to
//! a unit's `weapondefs`, in the file's own style, over the shapes the
//! patcher reads. Each result has been through the post-check, which runs the
//! file and confirms the unit gained exactly this table.

use std::path::{Path, PathBuf};

use coilbox_unitpatch::{
    evaluate, parse_path, patch, Edit, Op, Patched, Refusal, RefusalKind, Value,
};
use serde_json::json;

fn fixture(name: &str) -> String {
    let path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures")
        .join(name);
    std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("{}: {e}", path.display()))
}

fn sf_game() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/sf_game")
}

fn laser() -> Value {
    Value::from_json(&json!({
        "range": 300,
        "weapontype": "LaserCannon",
        "damage": { "default": 100, "vtol": 5 },
    }))
    .expect("a table")
}

fn set(unit: &str, path: &str, value: Value) -> Edit {
    Edit {
        unit: unit.into(),
        path: parse_path(path).expect("valid path"),
        op: Op::Set(value),
    }
}

fn run(source: &str, edit: &Edit) -> Result<Patched, Refusal> {
    let root = tempfile::tempdir().expect("temp dir");
    patch(source, edit, root.path())
}

/// The unit as the patched file returns it, keys lowercased.
fn unit_after(text: &str, unit: &str) -> serde_json::Value {
    let root = tempfile::tempdir().expect("temp dir");
    evaluate(text, root.path()).expect("runs")[unit.to_lowercase()].clone()
}

#[track_caller]
fn refused(result: Result<Patched, Refusal>, kind: RefusalKind) -> Refusal {
    match result {
        Ok(patched) => panic!("expected {kind:?}, got a patch:\n{}", patched.text),
        Err(refusal) => {
            assert_eq!(refusal.kind, kind, "{refusal}");
            refusal
        }
    }
}

/// The text the patch inserted at the place it reports, after checking that
/// every other byte of `original` is still there.
#[track_caller]
fn inserted(original: &str, patched: &Patched) -> String {
    let at = patched.location.start.byte;
    let added = patched.text.len() - original.len();
    assert_eq!(&patched.text[..at], &original[..at]);
    assert_eq!(&patched.text[at + added..], &original[at..]);
    patched.text[at..at + added].to_string()
}

#[test]
fn bar_gets_a_weapondefs_table_in_its_own_style() {
    let source = fixture("bar_armdfly.lua");
    let patched = run(&source, &set("armdfly", "weapondefs.heavylaser", laser())).unwrap();
    assert!(patched.changed);
    // Tabs, trailing commas, lists numbered as the file numbers them, and the
    // `=` column the file lines its keys up in.
    assert_eq!(
        inserted(&source, &patched),
        "\t\tweapondefs  = {\n\t\t\theavylaser = {\n\t\t\t\tdamage = {\n\t\t\t\t\tdefault = 100,\n\t\t\t\t\tvtol = 5,\n\t\t\t\t},\n\t\t\t\trange = 300,\n\t\t\t\tweapontype = \"LaserCannon\",\n\t\t\t},\n\t\t},\n"
    );
    let unit = unit_after(&patched.text, "armdfly");
    assert_eq!(
        unit["weapondefs"],
        json!({ "heavylaser": { "range": 300, "weapontype": "LaserCannon", "damage": { "default": 100, "vtol": 5 } } })
    );
}

#[test]
fn a_second_weapon_joins_the_weapondefs_table_the_first_made() {
    let source = fixture("bar_armdfly.lua");
    let first = run(&source, &set("armdfly", "weapondefs.heavylaser", laser())).unwrap();
    let small = Value::from_json(&json!({ "range": 100 })).unwrap();
    let second = run(&first.text, &set("armdfly", "weapondefs.smalllaser", small)).unwrap();
    assert_eq!(
        inserted(&first.text, &second),
        "\t\t\tsmalllaser = {\n\t\t\t\trange = 100,\n\t\t\t},\n"
    );
    let unit = unit_after(&second.text, "armdfly");
    assert_eq!(unit["weapondefs"]["smalllaser"], json!({ "range": 100 }));
    assert_eq!(unit["weapondefs"]["heavylaser"]["range"], json!(300));
}

#[test]
fn a_table_the_file_already_holds_changes_nothing() {
    let source = fixture("bar_armdfly.lua");
    let first = run(&source, &set("armdfly", "weapondefs.heavylaser", laser())).unwrap();
    let again = run(
        &first.text,
        &set("armdfly", "weapondefs.heavylaser", laser()),
    )
    .unwrap();
    assert!(!again.changed);
    assert_eq!(again.text, first.text);
}

/// flove's `mushrooms.lua` indents some lines with spaces and its tables
/// with tabs. A table written into one takes the step that table's own
/// fields are indented by, not the first indented line in the file.
#[test]
fn a_table_is_indented_by_the_step_its_container_uses() {
    let source = "local Base = Unit:New {\n    maxdamage = 1,\n}\nlocal U = Base:New {\n\tname = \"U\",\n}\nreturn lowerkeys({ U = U })\n";
    let patched = run(source, &set("U", "weapondefs.heavylaser", laser())).unwrap();
    assert_eq!(
        inserted(source, &patched),
        "\tweapondefs = {\n\t\theavylaser = {\n\t\t\tdamage = {\n\t\t\t\tdefault = 100,\n\t\t\t\tvtol = 5,\n\t\t\t},\n\t\t\trange = 300,\n\t\t\tweapontype = \"LaserCannon\",\n\t\t},\n\t},\n"
    );
}

#[test]
fn a_changed_table_replaces_the_one_the_file_holds() {
    let source = fixture("bar_armdfly.lua");
    let first = run(&source, &set("armdfly", "weapondefs.heavylaser", laser())).unwrap();
    let longer = Value::from_json(&json!({ "range": 450, "weapontype": "LaserCannon" })).unwrap();
    let second = run(
        &first.text,
        &set("armdfly", "weapondefs.heavylaser", longer),
    )
    .unwrap();
    assert!(second.changed);
    let unit = unit_after(&second.text, "armdfly");
    assert_eq!(
        unit["weapondefs"]["heavylaser"],
        json!({ "range": 450, "weapontype": "LaserCannon" })
    );
    // Written back where the old table was, at the same depth.
    assert!(second
        .text
        .contains("\t\t\theavylaser = {\n\t\t\t\trange = 450,\n\t\t\t\tweapontype = \"LaserCannon\",\n\t\t\t},"));
}

#[test]
fn a_file_with_windows_line_endings_keeps_them() {
    let source = fixture("bar_armdfly.lua").replace('\n', "\r\n");
    let patched = run(&source, &set("armdfly", "weapondefs.heavylaser", laser())).unwrap();
    let added = inserted(&source, &patched);
    assert!(added.contains("\r\n\t\t\theavylaser = {\r\n"), "{added:?}");
    assert!(!added.replace("\r\n", "").contains('\n'), "{added:?}");
}

#[test]
fn mcl_class_built_unit_gets_the_table_in_its_own_braces() {
    let source = fixture("mcl_brv.lua");
    let patched = run(&source, &set("BRV", "weapondefs.heavylaser", laser())).unwrap();
    let added = inserted(&source, &patched);
    // MCL lines its `=` up in a column, and the new key joins it.
    assert!(
        added.starts_with("\tweapondefs          = {\n\t\theavylaser = {\n"),
        "{added:?}"
    );
    let unit = unit_after(&patched.text, "BRV");
    assert_eq!(unit["weapondefs"]["heavylaser"]["damage"]["vtol"], json!(5));
    assert_eq!(unit["customparams"]["tonnage"], json!(80));
}

#[test]
fn flove_unit_gets_the_table_in_the_units_own_table_not_its_parents() {
    let source = fixture("flove_spire.lua");
    let patched = run(&source, &set("Spire", "weapondefs.heavylaser", laser())).unwrap();
    let added = inserted(&source, &patched);
    // Into `Spire`'s own braces, after `maxDamage`, not into `SpireBase`.
    let at = patched.text.find(&added).unwrap();
    assert!(
        at > source.find("local Spire = ").unwrap(),
        "{}",
        patched.text
    );
    assert!(added.contains("heavylaser = {"), "{added:?}");
    let unit = unit_after(&patched.text, "Spire");
    assert_eq!(unit["weapondefs"]["heavylaser"]["range"], json!(300));
    assert_eq!(unit["maxdamage"], json!(1000));
}

#[test]
fn sf_local_table_gets_the_table_lined_up_with_its_keys() {
    let source = fixture("sf_cloakingtower.lua");
    let patched = run(
        &source,
        &set("cloakingtower", "weapondefs.heavylaser", laser()),
    )
    .unwrap();
    let added = inserted(&source, &patched);
    // The copied SplinterFaction file has Windows line endings, and keeps them.
    assert!(
        added.starts_with("\tweapondefs                    = {\r\n\t\theavylaser = {\r\n"),
        "{added:?}"
    );
    assert!(!added.replace("\r\n", "").contains('\n'), "{added:?}");
    let unit = unit_after(&patched.text, "cloakingtower");
    assert_eq!(
        unit["weapondefs"]["heavylaser"]["weapontype"],
        json!("LaserCannon")
    );
}

/// SplinterFaction's unit files set `unitDef.weaponDefs` after including the
/// basedef, so a weapon added to the basedef's table would be thrown away.
#[test]
fn sf_basedef_unit_whose_file_sets_its_weapondefs_later_is_refused() {
    let game = sf_game();
    let path = game.join("Units/survivalai/beacon.lua");
    let source = std::fs::read_to_string(path).unwrap();
    let refusal = refused(
        patch(
            &source,
            &set("beacon", "weapondefs.heavylaser", laser()),
            &game,
        ),
        RefusalKind::FieldComputed,
    );
    assert!(
        refusal.message.contains("sets this value again"),
        "{refusal}"
    );
}

#[test]
fn a_table_two_units_share_is_refused_by_the_post_check() {
    let source = "local base = {\n\tmaxdamage = 1,\n}\nreturn {\n\ta = base,\n\tb = base,\n}\n";
    let refusal = refused(
        run(source, &set("a", "weapondefs.heavylaser", laser())),
        RefusalKind::PostCheckFailed,
    );
    assert!(refusal.message.contains("b.weapondefs"), "{refusal}");
}

#[test]
fn a_value_worked_out_by_code_is_not_replaced_by_a_table() {
    let source = "return {\n\tu = {\n\t\tweapondefs = makeDefs(),\n\t},\n}\n";
    refused(
        run(source, &set("u", "weapondefs.heavylaser", laser())),
        RefusalKind::FieldComputed,
    );
}

#[test]
fn a_table_cannot_be_pushed_onto_a_list() {
    let source = fixture("bar_armdfly.lua");
    let edit = Edit {
        unit: "armdfly".into(),
        path: parse_path("buildoptions").unwrap(),
        op: Op::Push(laser()),
    };
    refused(run(&source, &edit), RefusalKind::InvalidValue);
}

#[test]
fn an_fbi_file_refuses_a_table_and_says_why() {
    let source = fixture("xta_armcom.fbi");
    let refusal = refused(
        coilbox_unitpatch::fbi::patch(
            &source,
            &set("armcom", "weapondefs.heavylaser", laser()),
            Path::new("units/ARMCOM.FBI"),
        ),
        RefusalKind::InvalidValue,
    );
    assert!(refusal.message.contains("weapondefs"), "{refusal}");
}
