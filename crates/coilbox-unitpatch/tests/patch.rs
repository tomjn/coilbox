//! The patcher over real unit file shapes. `mcl_brv.lua`, `flove_spire.lua`
//! and `sf_cloakingtower.lua` are copied from SpringMCLegacy, flove and
//! SplinterFaction. `bar_armdfly.lua` is written to Beyond All Reason's shape,
//! because BAR is not installed as a loose folder on the development machine.

use std::path::Path;

use coilbox_unitpatch::{
    check_fields, parse_path, patch, Edit, Location, Op, Patched, Refusal, RefusalKind, Value,
};

fn fixture(name: &str) -> String {
    let path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures")
        .join(name);
    std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("{}: {e}", path.display()))
}

fn edit(unit: &str, path: &str, op: Op) -> Edit {
    Edit {
        unit: unit.into(),
        path: parse_path(path).expect("valid path"),
        op,
    }
}

fn run(source: &str, edit: &Edit) -> Result<Patched, Refusal> {
    let root = tempfile::tempdir().expect("temp dir");
    patch(source, edit, root.path())
}

fn set(source: &str, unit: &str, path: &str, value: Value) -> Result<Patched, Refusal> {
    run(source, &edit(unit, path, Op::Set(value)))
}

fn push(source: &str, unit: &str, path: &str, value: Value) -> Result<Patched, Refusal> {
    run(source, &edit(unit, path, Op::Push(value)))
}

fn num(value: f64) -> Value {
    Value::Number(value)
}

fn text(value: &str) -> Value {
    Value::String(value.into())
}

/// The patched text is the original with exactly one occurrence of `old`
/// turned into `new`, every other byte the same.
#[track_caller]
fn assert_replaced(original: &str, patched: &Patched, old: &str, new: &str) {
    assert_eq!(original.matches(old).count(), 1, "`{old}` must be unique");
    assert!(patched.changed);
    assert_eq!(patched.text, original.replacen(old, new, 1));
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

// Beyond All Reason's shape: `return { armdfly = { ... } }`.

#[test]
fn bar_replaces_a_number_and_nothing_else() {
    let source = fixture("bar_armdfly.lua");
    let patched = set(&source, "armdfly", "metalcost", num(400.0)).unwrap();
    assert_replaced(&source, &patched, "metalcost = 320", "metalcost = 400");
    assert_eq!(patched.location.start.line, 13);
    assert_eq!(
        &source[patched.location.start.byte..patched.location.end.byte],
        "320"
    );
}

#[test]
fn bar_keeps_odd_spacing_and_the_trailing_comment() {
    let source = fixture("bar_armdfly.lua");
    let patched = set(&source, "armdfly", "buildtime", num(17500.5)).unwrap();
    assert_replaced(
        &source,
        &patched,
        "buildtime   =   16000, -- odd",
        "buildtime   =   17500.5, -- odd",
    );
}

#[test]
fn bar_keeps_each_string_quote_style() {
    let source = fixture("bar_armdfly.lua");
    let long = set(&source, "armdfly", "name", text("Dragonfly II")).unwrap();
    assert_replaced(&source, &long, "[[Dragonfly]]", "[[Dragonfly II]]");
    let single = set(
        &source,
        "armdfly",
        "customparams.unitgroup",
        text("builder"),
    )
    .unwrap();
    assert_replaced(&source, &single, "'util'", "'builder'");
}

#[test]
fn bar_leaves_a_semicolon_separator_alone() {
    let source = fixture("bar_armdfly.lua");
    let patched = set(&source, "armdfly", "energycost", num(9000.0)).unwrap();
    assert_replaced(
        &source,
        &patched,
        "energycost = 11000;",
        "energycost = 9000;",
    );
}

#[test]
fn bar_appends_a_new_field_in_the_units_indentation() {
    let source = fixture("bar_armdfly.lua");
    let patched = set(&source, "armdfly", "cruisealtitude", num(120.0)).unwrap();
    assert_replaced(
        &source,
        &patched,
        "\t\t},\n\t},\n}",
        "\t\t},\n\t\tcruisealtitude = 120,\n\t},\n}",
    );
}

#[test]
fn bar_appends_a_new_field_inside_a_nested_table() {
    let source = fixture("bar_armdfly.lua");
    let patched = set(&source, "armdfly", "customparams.techlevel", num(2.0)).unwrap();
    assert_replaced(
        &source,
        &patched,
        "unitgroup = 'util',\n",
        "unitgroup = 'util',\n\t\t\ttechlevel = 2,\n",
    );
}

#[test]
fn bar_pushes_onto_a_numbered_list() {
    let source = fixture("bar_armdfly.lua");
    let patched = push(&source, "armdfly", "buildoptions", text("armmex")).unwrap();
    assert_replaced(
        &source,
        &patched,
        "[2] = \"armwin\",\n",
        "[2] = \"armwin\",\n\t\t\t[3] = \"armmex\",\n",
    );
}

#[test]
fn bar_pushes_onto_a_one_line_list() {
    let source = fixture("bar_armdfly.lua");
    let patched = push(
        &source,
        "armdfly",
        "sfxtypes.crashexplosiongenerators",
        text("crashing-large"),
    )
    .unwrap();
    assert_replaced(
        &source,
        &patched,
        "{ \"crashing-small\" }",
        "{ \"crashing-small\", \"crashing-large\" }",
    );
}

#[test]
fn bar_reaches_into_a_list_entry() {
    let source = fixture("bar_armdfly.lua");
    let patched = set(&source, "armdfly", "weapons[1].def", text("ARMDFLY_EMP")).unwrap();
    assert_replaced(
        &source,
        &patched,
        "\"ARMDFLY_PARALYZER\"",
        "\"ARMDFLY_EMP\"",
    );
}

#[test]
fn bar_refuses_a_computed_field_and_says_where_it_is() {
    let source = fixture("bar_armdfly.lua");
    let refusal = refused(
        set(&source, "armdfly", "health", num(2000.0)),
        RefusalKind::FieldComputed,
    );
    let location = refusal.location.expect("a location");
    assert_eq!(location.start.line, 12);
    assert_eq!(
        &source[location.start.byte..location.end.byte],
        "1200 * 1.5"
    );
    assert!(
        refusal.message.contains("1200 * 1.5"),
        "{}",
        refusal.message
    );
}

#[test]
fn bar_refuses_paths_that_do_not_fit() {
    let source = fixture("bar_armdfly.lua");
    refused(
        set(&source, "armdfly", "nothere.inner", num(1.0)),
        RefusalKind::ParentMissing,
    );
    refused(
        set(&source, "armdfly", "metalcost.inner", num(1.0)),
        RefusalKind::NotATable,
    );
    refused(
        set(&source, "armcom", "metalcost", num(1.0)),
        RefusalKind::UnitNotFound,
    );
    refused(
        push(&source, "armdfly", "customparams", text("x")),
        RefusalKind::NotAList,
    );
}

#[test]
fn bar_setting_the_value_it_already_has_changes_nothing() {
    let source = fixture("bar_armdfly.lua");
    let patched = set(&source, "armdfly", "metalcost", num(320.0)).unwrap();
    assert!(!patched.changed);
    assert_eq!(patched.text, source);
}

#[test]
fn syntax_errors_are_refused_with_a_location() {
    let source = "return {\n\tu = { a = 1, b = },\n}\n";
    let refusal = refused(set(source, "u", "a", num(2.0)), RefusalKind::Syntax);
    assert_eq!(refusal.location.expect("a location").start.line, 2);
}

// SpringMCLegacy's shape: `local BRV = Tank:New{ ... }` and
// `return lowerkeys({ ["BRV"] = BRV:New() })`.

#[test]
fn mcl_replaces_a_field_whatever_its_case() {
    let source = fixture("mcl_brv.lua");
    let patched = set(&source, "brv", "trackwidth", num(40.0)).unwrap();
    assert_replaced(
        &source,
        &patched,
        "trackWidth\t\t\t= 37,--width",
        "trackWidth\t\t\t= 40,--width",
    );
}

#[test]
fn mcl_replaces_a_nested_field() {
    let source = fixture("mcl_brv.lua");
    let patched = set(&source, "BRV", "customparams.tonnage", num(85.0)).unwrap();
    assert_replaced(&source, &patched, "= 80,", "= 85,");
}

#[test]
fn mcl_appends_a_new_field_to_the_class_table() {
    // `description         =` lines its `=` up with spaces, so the new field
    // does too.
    let source = fixture("mcl_brv.lua");
    let patched = set(&source, "BRV", "maxvelocity", num(2.5)).unwrap();
    assert_replaced(
        &source,
        &patched,
        "\t},\n}\n\nreturn",
        "\t},\n\tmaxvelocity         = 2.5,\n}\n\nreturn",
    );
}

#[test]
fn mcl_pushes_onto_an_inline_list_without_a_trailing_comma() {
    let source = fixture("mcl_brv.lua");
    let patched = push(&source, "BRV", "customparams.mods", text("jumpjets")).unwrap();
    assert_replaced(
        &source,
        &patched,
        "{\"ferrofibrousarmour\"}",
        "{\"ferrofibrousarmour\", \"jumpjets\"}",
    );
}

// flove's shape: a unit built from a base class in the same file.

#[test]
fn flove_edits_the_units_own_table() {
    let source = fixture("flove_spire.lua");
    let patched = set(&source, "Spire", "maxdamage", num(1500.0)).unwrap();
    assert_replaced(&source, &patched, "= 1000,", "= 1500,");
}

#[test]
fn flove_edits_a_field_the_unit_inherits_from_its_base_in_the_file() {
    let source = fixture("flove_spire.lua");
    let patched = set(&source, "spire", "customparams.modelradius", text("45")).unwrap();
    assert_replaced(&source, &patched, "[[30]]", "[[45]]");
}

// SplinterFaction's shape: `local unitDef = { ... }` and
// `return lowerkeys({ [unitName] = unitDef })`.

#[test]
fn sf_follows_a_unit_name_held_in_a_local() {
    let source = fixture("sf_cloakingtower.lua");
    let patched = set(&source, "cloakingtower", "maxdamage", num(150.0)).unwrap();
    assert_replaced(
        &source,
        &patched,
        "maxDamage                     = 100,",
        "maxDamage                     = 150,",
    );
}

#[test]
fn sf_refuses_fields_set_from_locals() {
    let source = fixture("sf_cloakingtower.lua");
    let refusal = refused(
        set(&source, "cloakingtower", "buildcostmetal", num(600.0)),
        RefusalKind::FieldComputed,
    );
    let location = refusal.location.expect("a location");
    assert_eq!(
        &source[location.start.byte..location.end.byte],
        "buildCostMetal"
    );
    refused(
        set(
            &source,
            "cloakingtower",
            "customparams.requiretech",
            text("tech1"),
        ),
        RefusalKind::FieldComputed,
    );
}

#[test]
fn sf_lines_a_new_field_up_with_the_column_of_equals_signs() {
    // The file has Windows line endings, as it does in the game.
    let source = fixture("sf_cloakingtower.lua");
    let patched = set(&source, "cloakingtower", "maxvelocity", num(0.0)).unwrap();
    let decay = "\tBuildingGroundDecalDecaySpeed = 0.9,\r\n";
    assert_replaced(
        &source,
        &patched,
        decay,
        &format!("{decay}\tmaxvelocity{} = 0,\r\n", " ".repeat(18)),
    );
}

#[test]
fn sf_keeps_non_ascii_text_elsewhere_in_the_file() {
    let source = fixture("sf_cloakingtower.lua");
    assert!(source.contains('\u{2014}'));
    let patched = set(
        &source,
        "cloakingtower",
        "customparams.area_cloak_radius",
        num(350.0),
    )
    .unwrap();
    assert_replaced(
        &source,
        &patched,
        "area_cloak_radius = 300, --",
        "area_cloak_radius = 350, --",
    );
}

// Cases the fixtures do not cover.

#[test]
fn a_field_set_again_after_the_table_is_refused() {
    let source = "local unitName = \"wraith\"\nlocal unitDef = {\n\tname = \"Wraith\",\n\tmaxDamage = 300,\n}\nunitDef.maxDamage = 500\nunitDef.unitname = unitName\nreturn lowerkeys({ [unitName] = unitDef })\n";
    let refusal = refused(
        set(source, "wraith", "maxdamage", num(400.0)),
        RefusalKind::FieldComputed,
    );
    assert_eq!(refusal.location.expect("a location").start.line, 6);
    let patched = set(source, "wraith", "name", text("Wraith II")).unwrap();
    assert_replaced(source, &patched, "\"Wraith\"", "\"Wraith II\"");
}

#[test]
fn an_edit_that_reaches_another_unit_fails_the_post_check() {
    let source = "local Base = Unit:New{\n\tmaxDamage = 100,\n}\nlocal A = Base:New{ name = \"A\" }\nlocal B = Base:New{ name = \"B\" }\nreturn lowerkeys({ A = A, B = B })\n";
    let refusal = refused(
        set(source, "A", "maxdamage", num(200.0)),
        RefusalKind::PostCheckFailed,
    );
    assert!(
        refusal.message.contains("b.maxdamage"),
        "{}",
        refusal.message
    );
}

#[test]
fn a_file_that_does_not_run_is_refused() {
    let source = "local opts = Spring.GetModOptions()\nreturn { u = { a = 1 } }\n";
    refused(set(source, "u", "a", num(2.0)), RefusalKind::EvalFailed);
}

#[test]
fn a_unit_built_by_an_unknown_call_is_refused() {
    let source = "return { u = MakeUnit(\"u\", { a = 1 }) }\n";
    refused(set(source, "u", "a", num(2.0)), RefusalKind::UnitComputed);
}

#[test]
fn windows_line_endings_are_kept() {
    let source = "return {\r\n\tu = {\r\n\t\ta = 1,\r\n\t},\r\n}\r\n";
    let patched = set(source, "u", "b", num(2.0)).unwrap();
    assert_replaced(
        source,
        &patched,
        "\t\ta = 1,\r\n",
        "\t\ta = 1,\r\n\t\tb = 2,\r\n",
    );
}

#[test]
fn a_new_field_goes_after_a_comment_on_the_last_line() {
    let source = "return {\n\tu = {\n\t\ta = 1 -- no comma here\n\t},\n}\n";
    let patched = set(source, "u", "b", num(2.0)).unwrap();
    assert_eq!(
        patched.text,
        "return {\n\tu = {\n\t\ta = 1, -- no comma here\n\t\tb = 2\n\t},\n}\n"
    );
}

#[test]
fn a_new_value_that_is_not_finite_is_refused() {
    let source = "return { u = { a = 1 } }\n";
    refused(
        set(source, "u", "a", num(f64::NAN)),
        RefusalKind::InvalidValue,
    );
}

#[test]
fn a_refusal_serialises_for_the_interface() {
    let source = fixture("bar_armdfly.lua");
    let refusal = refused(
        set(&source, "armdfly", "health", num(2000.0)),
        RefusalKind::FieldComputed,
    );
    let json = serde_json::to_value(&refusal).unwrap();
    assert_eq!(json["kind"], "fieldComputed");
    assert_eq!(json["location"]["start"]["line"], 12);
}

// The dry run the unit page asks before an edit (issue #2633).

fn check(source: &str, unit: &str, fields: &[(&str, Value)]) -> Vec<Result<Location, Refusal>> {
    let root = tempfile::tempdir().expect("temp dir");
    let fields: Vec<_> = fields
        .iter()
        .map(|(path, value)| (parse_path(path).expect("valid path"), value.clone()))
        .collect();
    check_fields(source, unit, &fields, root.path())
        .into_iter()
        .map(|answer| answer.map(|place| place.location))
        .collect()
}

#[test]
fn a_dry_run_answers_each_field_on_its_own() {
    let source = fixture("bar_armdfly.lua");
    let answers = check(
        &source,
        "armdfly",
        &[("metalcost", num(400.0)), ("health", num(2000.0))],
    );
    assert_eq!(answers.len(), 2);
    assert!(answers[0].is_ok(), "{:?}", answers[0]);
    let refusal = answers[1].as_ref().expect_err("health is computed");
    assert_eq!(refusal.kind, RefusalKind::FieldComputed);
    assert_eq!(refusal.location.expect("a location").start.line, 12);
}

/// `patch` accepts a value the file already holds without running the
/// post-check, so a dry run with the value the game has must try another one
/// or a shared table would read as writable.
#[test]
fn a_dry_run_with_the_current_value_still_catches_a_shared_table() {
    let source = "local Base = Unit:New{\n\tmaxDamage = 100,\n\tname = \"Base\",\n\tarmored = true,\n}\nlocal A = Base:New{ cost = 5 }\nlocal B = Base:New{ cost = 6 }\nreturn lowerkeys({ A = A, B = B })\n";
    let answers = check(
        source,
        "A",
        &[
            ("maxdamage", num(100.0)),
            ("name", text("Base")),
            ("armored", Value::Bool(true)),
            ("cost", num(5.0)),
        ],
    );
    for answer in &answers[..3] {
        let refusal = answer.as_ref().expect_err("B shares this table");
        assert_eq!(refusal.kind, RefusalKind::PostCheckFailed, "{refusal}");
    }
    assert!(answers[3].is_ok(), "{:?}", answers[3]);
}

#[test]
fn a_dry_run_refuses_what_patch_refuses() {
    let source = "local opts = Spring.GetModOptions()\nreturn { u = { a = 1 } }\n";
    let answers = check(source, "u", &[("a", num(2.0)), ("b", num(f64::INFINITY))]);
    assert_eq!(
        answers[0].as_ref().unwrap_err().kind,
        RefusalKind::EvalFailed
    );
    assert_eq!(
        answers[1].as_ref().unwrap_err().kind,
        RefusalKind::InvalidValue
    );
}
