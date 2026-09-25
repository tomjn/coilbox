//! A unit whose table is in a file its unit file includes (issue #3021).
//! `fixtures/sf_game` holds files copied from SplinterFaction, byte for byte
//! and in its own folder layout: each unit file sets a few globals and
//! includes a `basedefs` file that sets `unitDef`. The unit files spell the
//! folder `units-configs-basedefs`, and the game spells it
//! `Units-Configs-Basedefs`, as SplinterFaction does.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use coilbox_unitpatch::{
    check_fields, clone_unit, evaluate, locate_edit, parse_path, patch, patch_pending, Edit, Op,
    Patched, Refusal, RefusalKind, Value,
};

fn game() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/sf_game")
}

fn read(rel: &str) -> String {
    let path = game().join(rel);
    std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("{}: {e}", path.display()))
}

const BEACON: &str = "Units/survivalai/beacon.lua";
const BEACON_BASEDEF: &str = "Units-Configs-Basedefs/basedefs/survivalai/beacon_basedef.lua";
const SCORPION: &str = "Units/Loz Alliance - Faction 2/Tech 1/lozscorpion.lua";
const AIRPLANT: &str = "Units/Loz Alliance - Faction 2/lozairplant.lua";

fn set(unit: &str, path: &str, value: Value) -> Edit {
    Edit {
        unit: unit.into(),
        path: parse_path(path).expect("valid path"),
        op: Op::Set(value),
    }
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

#[test]
fn a_value_in_the_included_file_is_changed_there_and_nothing_else_moves() {
    let source = read(BEACON);
    let basedef = read(BEACON_BASEDEF);

    let patched = patch(
        &source,
        &set("beacon", "maxdamage", Value::Number(2500.0)),
        &game(),
    )
    .expect("patch");

    // The unit file asks for the folder in lower case, and the path handed
    // back is the one on disk.
    assert_eq!(patched.file, Some(game().join(BEACON_BASEDEF)));
    assert!(patched.changed);
    let old = "maxDamage                     = 2000";
    assert_eq!(basedef.matches(old).count(), 1);
    assert_eq!(
        patched.text,
        basedef.replacen(old, "maxDamage                     = 2500", 1)
    );
    assert_eq!(
        &basedef[patched.location.start.byte..patched.location.end.byte],
        "2000"
    );
    assert_eq!(patched.location.start.line, 29);
}

#[test]
fn a_new_field_goes_at_the_end_of_the_included_table_in_its_style() {
    let source = read(BEACON);
    let basedef = read(BEACON_BASEDEF);

    let patched = patch(
        &source,
        &set("beacon", "customparams.coilboxtest", Value::Number(1.0)),
        &game(),
    )
    .expect("patch");

    assert_eq!(patched.file, Some(game().join(BEACON_BASEDEF)));
    let last = "\t\tunitguide = [[The spawn beacon";
    let at = basedef.find(last).expect("the last custom param");
    let line_end = at + basedef[at..].find("\r\n").expect("CRLF") + 2;
    let mut expected = basedef.clone();
    expected.insert_str(line_end, "\t\tcoilboxtest              = 1,\r\n");
    assert_eq!(patched.text, expected);
}

#[test]
fn a_value_already_there_leaves_the_included_file_as_it_is() {
    let source = read(BEACON);
    let patched = patch(
        &source,
        &set("beacon", "maxdamage", Value::Number(2000.0)),
        &game(),
    )
    .expect("patch");
    assert!(!patched.changed);
    assert_eq!(patched.text, read(BEACON_BASEDEF));
    assert_eq!(patched.file, Some(game().join(BEACON_BASEDEF)));
}

/// A second edit to the same unit has to start from the first one's text,
/// which the caller holds and has not written yet.
#[test]
fn a_pending_edit_is_read_in_place_of_the_disk() {
    let source = read(BEACON);
    let first = patch(
        &source,
        &set("beacon", "maxdamage", Value::Number(2500.0)),
        &game(),
    )
    .expect("first");
    let pending: BTreeMap<PathBuf, String> =
        [(first.file.clone().unwrap(), first.text.clone())].into();

    let second = patch_pending(
        &source,
        &set("beacon", "workertime", Value::Number(1600.0)),
        &game(),
        &pending,
    )
    .expect("second");

    assert_eq!(
        second.text,
        first.text.replacen(
            "workerTime                    = 1500",
            "workerTime                    = 1600",
            1
        )
    );
    // The value the first edit wrote is the one the post-check starts from.
    let again = patch_pending(
        &source,
        &set("beacon", "maxdamage", Value::Number(2500.0)),
        &game(),
        &pending,
    )
    .expect("again");
    assert!(!again.changed);
}

/// The basedef writes `name` as `name = humanName`, a global the unit file
/// itself sets once, as a literal, before the include (issue #3079). The
/// patcher follows it and changes the unit file's own `humanName` line
/// instead of refusing.
#[test]
fn a_value_the_basedef_reads_from_a_global_is_changed_in_the_unit_files_own_line() {
    let source = read(SCORPION);
    let patched = patch(
        &source,
        &set("lozscorpion", "name", Value::String("Wasp".into())),
        &game(),
    )
    .expect("patch");

    assert_eq!(
        patched.file, None,
        "humanName is the unit file's own global, not the basedef's"
    );
    assert!(patched.changed);
    assert_eq!(
        patched.text,
        source.replacen("humanName = [[Scorpion]]", "humanName = [[Wasp]]", 1)
    );
    assert_eq!(
        &source[patched.location.start.byte..patched.location.end.byte],
        "[[Scorpion]]"
    );
}

/// The basedef also sets `selfDestructAs = explodeAs`, reading the very same
/// global as `explodeAs` itself, so an edit to `explodeas` always changes
/// `selfdestructas` too (issue #3079's "care needed"). Both end up holding
/// the new value, which is why the post-check allows the extra move rather
/// than refusing it as an unrelated side effect.
#[test]
fn changing_explodeas_also_changes_the_selfdestructas_that_reads_the_same_global() {
    let source = read(SCORPION);
    let patched = patch(
        &source,
        &set(
            "lozscorpion",
            "explodeas",
            Value::String("lozscorpion_blast".into()),
        ),
        &game(),
    )
    .expect("patch");

    assert_eq!(patched.file, None);
    assert_eq!(
        patched.text,
        source.replacen(
            "explodeAs = [[smallexplosiongenericblue]]",
            "explodeAs = [[lozscorpion_blast]]",
            1
        )
    );
    let after = evaluate(&patched.text, &game()).expect("evaluates");
    assert_eq!(after["lozscorpion"]["explodeas"], "lozscorpion_blast");
    assert_eq!(after["lozscorpion"]["selfdestructas"], "lozscorpion_blast");
}

/// The global is only followed when the unit file sets it once, as a
/// literal, at the top level, before the include (issue #3079). Set twice,
/// set only inside a conditional (so not at the top level at all), not set
/// before the include, or set to something other than a literal, and the
/// basedef's own refusal stays.
#[test]
fn a_global_set_more_than_once_conditionally_or_to_something_other_than_a_literal_stays_refused() {
    let cases = [
        ("explodeAs = \"a\"\nexplodeAs = \"b\"\n", "set twice"),
        (
            "if true then\n\texplodeAs = \"a\"\nend\n",
            "set only conditionally",
        ),
        ("", "never set"),
        ("explodeAs = tostring(1)\n", "not a literal"),
    ];
    for (before_include, why) in cases {
        let root = tempfile::tempdir().expect("tempdir");
        std::fs::create_dir_all(root.path().join("units")).unwrap();
        std::fs::write(
            root.path().join("basedef.lua"),
            "unitDef = { explodeAs = explodeAs }\n",
        )
        .unwrap();
        let unit =
            format!("{before_include}VFS.Include(\"basedef.lua\")\nreturn {{ x = unitDef }}\n");
        std::fs::write(root.path().join("units/x.lua"), &unit).unwrap();

        let refusal = refused(
            patch(
                &unit,
                &set("x", "explodeas", Value::String("weapon".into())),
                root.path(),
            ),
            RefusalKind::FieldComputed,
        );
        assert_eq!(refusal.file, Some(root.path().join("basedef.lua")), "{why}");
    }

    // Set once, as a literal, but after the include rather than before it.
    let root = tempfile::tempdir().expect("tempdir");
    std::fs::create_dir_all(root.path().join("units")).unwrap();
    std::fs::write(
        root.path().join("basedef.lua"),
        "unitDef = { explodeAs = explodeAs }\n",
    )
    .unwrap();
    let unit = "VFS.Include(\"basedef.lua\")\nexplodeAs = \"a\"\nreturn { x = unitDef }\n";
    std::fs::write(root.path().join("units/x.lua"), unit).unwrap();
    let refusal = refused(
        patch(
            unit,
            &set("x", "explodeas", Value::String("weapon".into())),
            root.path(),
        ),
        RefusalKind::FieldComputed,
    );
    assert_eq!(
        refusal.file,
        Some(root.path().join("basedef.lua")),
        "set after the include"
    );
}

/// SplinterFaction's unit files set `unitDef.weaponDefs` after the include,
/// so the weapons the included file writes out are not the ones the game
/// reads.
#[test]
fn a_value_the_unit_file_sets_after_the_include_stays_refused() {
    let source = read(SCORPION);
    let refusal = refused(
        patch(
            &source,
            &set(
                "lozscorpion",
                "weapondefs.flakcannon.reloadtime",
                Value::Number(1.0),
            ),
            &game(),
        ),
        RefusalKind::FieldComputed,
    );
    assert_eq!(refusal.file, None, "the unit file is the one that sets it");
    assert_eq!(refusal.location.expect("a location").start.line, 19);
}

#[test]
fn an_included_file_two_unit_files_share_is_refused() {
    let source = read(AIRPLANT);
    let refusal = refused(
        patch(
            &source,
            &set("lozairplant", "maxdamage", Value::Number(5.0)),
            &game(),
        ),
        RefusalKind::FileShared,
    );
    assert_eq!(refusal.file, None);
    let location = refusal.location.expect("the include");
    assert_eq!(location.start.line, 26);
    assert!(
        source[location.start.byte..location.end.byte].starts_with("VFS.Include("),
        "{}",
        &source[location.start.byte..location.end.byte]
    );
    for file in [
        "Units/Federation of Kala - Faction 1/fedairplant.lua",
        "Units/Loz Alliance - Faction 2/lozairplant.lua",
    ] {
        assert!(refusal.message.contains(file), "{}", refusal.message);
    }
}

#[test]
fn a_unit_file_that_includes_nothing_setting_the_table_is_refused() {
    let source = "unitName = \"x\"\r\nVFS.Include(\"units-configs-basedefs/configs/explosion_lighting_configs.lua\")\r\nreturn lowerkeys({ [unitName] = unitDef })\r\n";
    let refusal = refused(
        patch(source, &set("x", "maxdamage", Value::Number(1.0)), &game()),
        RefusalKind::UnitComputed,
    );
    assert!(
        refusal.message.contains("files it includes"),
        "{}",
        refusal.message
    );
}

#[test]
fn an_include_that_climbs_out_of_the_game_is_not_followed() {
    let source =
        "VFS.Include(\"../sf_game/Units-Configs-Basedefs/basedefs/survivalai/beacon_basedef.lua\")\nreturn { beacon = unitDef }\n";
    let refusal = refused(
        patch(
            source,
            &set("beacon", "maxdamage", Value::Number(1.0)),
            &game(),
        ),
        RefusalKind::UnitComputed,
    );
    assert!(
        refusal.message.contains("could not read"),
        "{}",
        refusal.message
    );
}

#[test]
fn the_dry_run_and_locate_name_the_included_file() {
    let source = read(BEACON);
    let fields = vec![
        (parse_path("maxdamage").unwrap(), Value::Number(2000.0)),
        (
            parse_path("name").unwrap(),
            Value::String("Spawn Beacon".into()),
        ),
    ];
    let answers = check_fields(&source, "beacon", &fields, &game());
    let place = answers[0].as_ref().expect("maxdamage can be written");
    assert_eq!(place.file, Some(game().join(BEACON_BASEDEF)));
    // The basedef writes `name = humanName`, a global the unit file sets
    // once, as a literal, before the include, so this is writable too
    // (issue #3079), into the unit file's own `humanName` line rather than
    // the basedef.
    let name_place = answers[1]
        .as_ref()
        .expect("name reads a global the unit file sets before the include");
    assert_eq!(name_place.file, None);

    let located = locate_edit(
        &source,
        &set("beacon", "maxdamage", Value::Number(1.0)),
        &game(),
    )
    .expect("located");
    assert_eq!(located, place.clone());

    let shared = check_fields(
        &read(AIRPLANT),
        "lozairplant",
        &[(parse_path("maxdamage").unwrap(), Value::Number(1.0))],
        &game(),
    );
    assert_eq!(
        shared[0].as_ref().expect_err("shared").kind,
        RefusalKind::FileShared
    );
}

/// A copy gets a copy of the included file too, so its edits cannot reach
/// the source unit through the file they would otherwise share.
#[test]
fn a_copy_gets_its_own_copy_of_the_included_file() {
    let source = read(BEACON);
    let basedef = read(BEACON_BASEDEF);
    let edits = vec![(
        parse_path("maxdamage").unwrap(),
        Op::Set(Value::Number(3000.0)),
    )];

    let cloned = clone_unit(&source, "beacon", "beacon_mk2", &edits, &game()).expect("copy");

    let (path, text) = cloned.included.expect("a copy of the basedef");
    assert_eq!(
        path,
        game().join("Units-Configs-Basedefs/basedefs/survivalai/beacon_mk2_basedef.lua")
    );
    assert!(!path.exists(), "nothing is written");
    assert_eq!(
        text,
        basedef.replacen(
            "maxDamage                     = 2000",
            "maxDamage                     = 3000",
            1
        )
    );
    assert_eq!(
        cloned.text,
        source
            .replacen("[unitName]", "[\"beacon_mk2\"]", 1)
            .replacen(
                "\"units-configs-basedefs/basedefs/survivalai/beacon_basedef.lua\"",
                "\"units-configs-basedefs/basedefs/survivalai/beacon_mk2_basedef.lua\"",
                1
            )
    );
}

/// The source's file is shared, so the source itself cannot be edited in
/// place, but a copy has a file of its own and can.
#[test]
fn a_copy_of_a_unit_whose_file_is_shared_can_be_edited() {
    let edits = vec![(
        parse_path("maxdamage").unwrap(),
        Op::Set(Value::Number(9.0)),
    )];
    let cloned = clone_unit(
        &read(AIRPLANT),
        "lozairplant",
        "lozairplant2",
        &edits,
        &game(),
    )
    .expect("copy");
    let (path, text) = cloned.included.expect("a copy of the basedef");
    assert_eq!(
        path,
        game().join(
            "Units-Configs-Basedefs/basedefs/Fed and Loz Shared Buildings/lozairplant2_airplant_basedef.lua"
        )
    );
    assert!(text.contains("maxDamage                         = 9,"));
}

#[test]
fn a_copy_whose_included_file_name_is_taken_is_refused() {
    let edits: Vec<_> = Vec::new();
    // A copy named `beacon` would get `beacon_basedef.lua`, which exists. A
    // copy may not overwrite it.
    let source = read(BEACON);
    let refusals =
        clone_unit(&source, "beacon", "beacon", &edits, &game()).expect_err("the name is taken");
    assert_eq!(refusals[0].refusal.kind, RefusalKind::NameTaken);
}
