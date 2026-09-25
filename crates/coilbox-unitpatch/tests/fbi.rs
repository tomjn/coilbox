//! The `.fbi` patcher (issue #2638) over real unit files. `this_dagger.fbi`
//! is trimmed from THIS's `units/dagger.fbi`, and `xta_armcom.fbi` from XTA
//! 9.65's `Units/ARMCOM.FBI`, Windows line endings kept.

use std::path::{Path, PathBuf};

use coilbox_unitpatch::fbi;
use coilbox_unitpatch::{parse_path, Edit, Op, Patched, Refusal, RefusalKind, Value};

fn fixture(name: &str) -> String {
    let path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures")
        .join(name);
    std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("{}: {e}", path.display()))
}

fn dagger() -> (String, PathBuf) {
    (
        fixture("this_dagger.fbi"),
        PathBuf::from("units/dagger.fbi"),
    )
}

fn armcom() -> (String, PathBuf) {
    (fixture("xta_armcom.fbi"), PathBuf::from("Units/ARMCOM.FBI"))
}

fn set(source: &str, file: &Path, path: &str, value: Value) -> Result<Patched, Refusal> {
    fbi::patch(
        source,
        &Edit {
            unit: fbi::unit_name(file),
            path: parse_path(path).expect("valid path"),
            op: Op::Set(value),
        },
        file,
    )
}

fn num(n: f64) -> Value {
    Value::Number(n)
}

fn text(s: &str) -> Value {
    Value::String(s.into())
}

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
            assert_eq!(refusal.kind, kind, "{}", refusal.message);
            refusal
        }
    }
}

#[test]
fn sets_a_field_whatever_case_the_file_spells_it_in() {
    let (source, file) = dagger();
    let patched = set(&source, &file, "maxdamage", num(700.0)).unwrap();
    assert_replaced(&source, &patched, "MaxDamage=650;", "MaxDamage=700;");
    assert_eq!(patched.location.start.line, 14);

    let patched = set(&source, &file, "acceleration", num(0.1)).unwrap();
    assert_replaced(&source, &patched, "Acceleration=.08;", "Acceleration=0.1;");
}

#[test]
fn a_value_the_file_already_holds_changes_nothing() {
    let (source, file) = dagger();
    let patched = set(&source, &file, "acceleration", num(0.08)).unwrap();
    assert!(!patched.changed);
    assert_eq!(patched.text, source);
    let patched = set(&source, &file, "canfly", Value::Bool(true)).unwrap();
    assert!(!patched.changed);
}

#[test]
fn a_new_field_goes_in_the_right_section_in_the_files_style() {
    let (source, file) = dagger();
    let patched = set(&source, &file, "cloakcost", num(10.0)).unwrap();
    assert_replaced(
        &source,
        &patched,
        "\tSmoothAnim=0;\n",
        "\tSmoothAnim=0;\n\tcloakcost=10;\n",
    );

    let patched = set(&source, &file, "customparams.role", text("attacker")).unwrap();
    assert_replaced(
        &source,
        &patched,
        "\t\tcost=200;\n",
        "\t\tcost=200;\n\t\trole=attacker;\n",
    );

    let (source, file) = armcom();
    let patched = set(&source, &file, "cloakcost", num(55.0)).unwrap();
    assert_replaced(
        &source,
        &patched,
        "\tcollisionVolumeTest = 1;\r\n",
        "\tcollisionVolumeTest = 1;\r\n\tcloakcost = 55;\r\n",
    );
}

#[test]
fn weapon_and_effect_fields_go_to_their_numbered_keys() {
    let (source, file) = dagger();
    let patched = set(&source, &file, "weapons[2].name", text("KHeavy")).unwrap();
    assert_replaced(&source, &patched, "Weapon2=KLight;", "Weapon2=KHeavy;");
    let patched = set(&source, &file, "weapons[1].maxangledif", num(45.0)).unwrap();
    assert_replaced(&source, &patched, "MaxAngleDif1=30;", "MaxAngleDif1=45;");
    let patched = set(&source, &file, "weapons[3].name", text("KHeavy")).unwrap();
    assert_replaced(
        &source,
        &patched,
        "\tSmoothAnim=0;\n",
        "\tSmoothAnim=0;\n\tweapon3=KHeavy;\n",
    );
    refused(
        set(&source, &file, "weapons[3].maxangledif", num(1.0)),
        RefusalKind::ParentMissing,
    );
    refused(
        set(&source, &file, "weapons[1].def", text("X")),
        RefusalKind::FieldComputed,
    );

    let patched = set(
        &source,
        &file,
        "sfxtypes.explosiongenerators[2]",
        text("custom:boom"),
    )
    .unwrap();
    assert_replaced(
        &source,
        &patched,
        "explosiongenerator1 = custom:death_small;",
        "explosiongenerator1 = custom:boom;",
    );
}

#[test]
fn weapons_numbered_with_a_gap_are_refused() {
    let (source, file) = armcom();
    let refusal = refused(
        set(&source, &file, "weapons[2].name", text("X")),
        RefusalKind::FieldComputed,
    );
    assert!(
        refusal.message.contains("Weapon1, Weapon3"),
        "{}",
        refusal.message
    );
}

#[test]
fn fields_the_engine_takes_from_elsewhere_are_refused() {
    let (source, file) = dagger();
    for path in ["buildoptions", "sounds.select"] {
        refused(
            set(&source, &file, path, text("x")),
            RefusalKind::FieldComputed,
        );
    }
    refused(
        set(&source, &file, "unitname", text("knife")),
        RefusalKind::FieldComputed,
    );
    let patched = set(&source, &file, "unitname", text("dagger")).unwrap();
    assert!(!patched.changed);
    refused(
        set(&source, &file, "customparams[1]", num(1.0)),
        RefusalKind::NotATable,
    );
    refused(
        set(&source, &file, "featuredefs.dead.metal", num(1.0)),
        RefusalKind::ParentMissing,
    );
}

#[test]
fn another_units_file_is_not_this_one() {
    let (source, _) = dagger();
    let refusal = refused(
        fbi::patch(
            &source,
            &Edit {
                unit: "dagger".into(),
                path: parse_path("maxdamage").unwrap(),
                op: Op::Set(num(1.0)),
            },
            Path::new("units/knife.fbi"),
        ),
        RefusalKind::UnitNotFound,
    );
    assert!(refusal.message.contains("knife"));
}

#[test]
fn a_file_the_engine_cannot_read_is_refused_where_it_breaks() {
    let file = Path::new("units/dagger.fbi");
    let refusal = refused(
        set(
            "[UNITINFO]\n{\n\tMaxDamage=650\n}\n",
            file,
            "maxdamage",
            num(1.0),
        ),
        RefusalKind::Syntax,
    );
    assert_eq!(refusal.location.unwrap().start.line, 3);
    refused(
        set("[WEAPON1] { a=1; }", file, "maxdamage", num(1.0)),
        RefusalKind::ReturnNotLiteral,
    );
    refused(
        set(
            "[UNITINFO] { MaxDamage=1; maxdamage=2; }",
            file,
            "maxdamage",
            num(3.0),
        ),
        RefusalKind::FieldAmbiguous,
    );
}

#[test]
fn a_dry_run_says_which_fields_can_change() {
    let (source, file) = dagger();
    let fields: Vec<_> = [
        ("maxdamage", num(650.0)),
        ("brandnew", num(1.0)),
        ("buildoptions", text("x")),
        ("unitname", text("dagger")),
    ]
    .into_iter()
    .map(|(path, value)| (parse_path(path).unwrap(), value))
    .collect();
    let answers = fbi::check_fields(&source, "dagger", &fields, &file);
    assert!(answers[0].is_ok());
    assert!(answers[1].is_ok());
    assert_eq!(
        answers[2].as_ref().unwrap_err().kind,
        RefusalKind::FieldComputed
    );
    assert_eq!(
        answers[3].as_ref().unwrap_err().kind,
        RefusalKind::FieldComputed
    );
}

#[test]
fn a_copy_is_the_sources_text_with_its_edits_and_its_own_name() {
    let (source, file) = dagger();
    let edits = vec![
        (parse_path("maxdamage").unwrap(), Op::Set(num(900.0))),
        (parse_path("unitname").unwrap(), Op::Set(text("dagger2"))),
        (
            parse_path("sfxtypes.explosiongenerators").unwrap(),
            Op::Push(text("custom:extra")),
        ),
    ];
    let cloned = fbi::clone_unit(&source, "dagger", "dagger2", &edits, &file).unwrap();
    assert_eq!(
        cloned.text,
        source
            .replacen("MaxDamage=650;", "MaxDamage=900;", 1)
            .replacen("Unitname=dagger;", "Unitname=dagger2;", 1)
            .replacen(
                "custom:death_small;\n",
                "custom:death_small;\n\t\texplosiongenerator2 = custom:extra;\n",
                1
            )
    );
    assert!(cloned.included.is_none());

    let refusals = fbi::clone_unit(
        &source,
        "dagger",
        "dagger2",
        &[(parse_path("buildoptions").unwrap(), Op::Push(text("x")))],
        &file,
    )
    .unwrap_err();
    assert_eq!(refusals.len(), 1);
    assert_eq!(refusals[0].edit, Some(0));
}

#[test]
fn evaluate_gives_the_files_own_table_under_the_units_name() {
    let (source, file) = armcom();
    let units = fbi::evaluate(&source, &file).unwrap();
    assert_eq!(units["armcom"]["maxdamage"], "3500");
    assert_eq!(units["armcom"]["unitname"], "ARMCOM");
}
