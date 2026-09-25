//! Copying a unit into a file of its own (issue #2634), over the same file
//! shapes the patcher tests use.

use std::path::Path;

use coilbox_unitpatch::{clone_unit, parse_path, CloneRefusal, Op, RefusalKind, Value};

fn fixture(name: &str) -> String {
    let path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures")
        .join(name);
    std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("{}: {e}", path.display()))
}

fn copy(
    source: &str,
    unit: &str,
    new_unit: &str,
    edits: &[(&str, Op)],
) -> Result<String, Vec<CloneRefusal>> {
    let root = tempfile::tempdir().expect("temp dir");
    let edits: Vec<_> = edits
        .iter()
        .map(|(path, op)| (parse_path(path).expect("valid path"), op.clone()))
        .collect();
    clone_unit(source, unit, new_unit, &edits, root.path()).map(|cloned| {
        assert_eq!(cloned.included, None);
        cloned.text
    })
}

#[test]
fn bar_copy_renames_the_key_and_makes_each_edit() {
    let source = fixture("bar_armdfly.lua");
    let copied = copy(
        &source,
        "armdfly",
        "armdfly2",
        &[
            ("metalcost", Op::Set(Value::Number(400.0))),
            ("buildoptions", Op::Push(Value::String("armmex".into()))),
        ],
    )
    .expect("copied");

    let expected = source
        .replacen("\tarmdfly = {", "\tarmdfly2 = {", 1)
        .replacen("metalcost = 320", "metalcost = 400", 1)
        .replacen(
            "\t\t\t[2] = \"armwin\",\n",
            "\t\t\t[2] = \"armwin\",\n\t\t\t[3] = \"armmex\",\n",
            1,
        );
    assert_eq!(copied, expected);
}

#[test]
fn mcl_copy_renames_the_bracketed_key_and_keeps_the_class_chain() {
    let source = fixture("mcl_brv.lua");
    let copied = copy(
        &source,
        "BRV",
        "brv_heavy",
        &[("customparams.tonnage", Op::Set(Value::Number(85.0)))],
    )
    .expect("copied");

    let expected = source
        .replacen("[\"BRV\"] = BRV:New()", "[\"brv_heavy\"] = BRV:New()", 1)
        .replacen("tonnage\t\t\t= 80", "tonnage\t\t\t= 85", 1);
    assert_eq!(copied, expected);
}

/// SpringMCLegacy's Direwolf file returns several variants built from one
/// shared table. The copy's file keeps only the one it copies, so an edit to
/// the table it shares with the others in the source is safe in the copy.
#[test]
fn a_copy_out_of_a_file_of_variants_keeps_only_its_own_entry() {
    let source = "local Direwolf = Assault:New{\n\tname = \"Dire Wolf\",\n\tcustomparams = { tonnage = 100 },\n}\nlocal Prime = Direwolf:New{\n\tdescription = \"Assault Vanguard\",\n}\nreturn lowerkeys({\n\t[\"WF_Direwolf_P\"] = Prime:New(),\n\t[\"SJ_Direwolf_P\"] = Prime:New(),\n\t[\"CC_Direwolf_P\"] = Prime:New(),\n})\n";
    let copied = copy(
        source,
        "SJ_Direwolf_P",
        "sj_direwolf_x",
        &[("customparams.tonnage", Op::Set(Value::Number(95.0)))],
    )
    .expect("copied");

    assert_eq!(
        copied,
        "local Direwolf = Assault:New{\n\tname = \"Dire Wolf\",\n\tcustomparams = { tonnage = 95 },\n}\nlocal Prime = Direwolf:New{\n\tdescription = \"Assault Vanguard\",\n}\nreturn lowerkeys({\n\t[\"sj_direwolf_x\"] = Prime:New(),\n})\n"
    );
}

/// A key the file spells through a local keeps the local, which the file
/// may read for other things, and gets the new name written in its place.
#[test]
fn a_key_spelled_through_a_local_is_replaced_by_the_new_name() {
    let source = "local unitName = \"armpw\"\nlocal unitDef = {\n\tbuildpic = unitName .. \".dds\",\n\tmetalcost = 50,\n}\nreturn lowerkeys({ [unitName] = unitDef })\n";
    let copied = copy(source, "armpw", "armpw2", &[]).expect("copied");
    assert_eq!(
        copied,
        source.replacen("[unitName] = unitDef", "[\"armpw2\"] = unitDef", 1)
    );
}

#[test]
fn every_edit_the_copy_cannot_take_is_refused_by_position() {
    let source = fixture("bar_armdfly.lua");
    let refused = copy(
        &source,
        "armdfly",
        "armdfly2",
        &[
            ("metalcost", Op::Set(Value::Number(400.0))),
            ("health", Op::Set(Value::Number(2000.0))),
            ("customparams", Op::Push(Value::String("x".into()))),
        ],
    )
    .expect_err("refused");

    let found: Vec<(Option<usize>, RefusalKind)> =
        refused.iter().map(|r| (r.edit, r.refusal.kind)).collect();
    assert_eq!(
        found,
        vec![
            (Some(1), RefusalKind::FieldComputed),
            (Some(2), RefusalKind::NotAList)
        ]
    );
}

#[test]
fn a_unit_the_file_does_not_define_is_refused_as_a_whole() {
    let source = fixture("bar_armdfly.lua");
    let refused = copy(&source, "armcom", "armcom2", &[]).expect_err("refused");
    assert_eq!(refused.len(), 1);
    assert_eq!(refused[0].edit, None);
    assert_eq!(refused[0].refusal.kind, RefusalKind::UnitNotFound);
}
