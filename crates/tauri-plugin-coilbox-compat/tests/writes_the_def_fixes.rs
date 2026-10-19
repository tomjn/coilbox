//! A compat build of a real old game writes the def fixes, and the game's own
//! def pipeline then carries what they put back (issue #4560): every unit with
//! the `commander` tag has `customparams.iscommander`, a bomb that sets
//! `manualBombSettings` keeps the burst its file gives, and a unit with no
//! tag is as the base game has it. A game whose own def loading the mutator
//! cannot reach, as Balanced Annihilation 15.9.8's, gets no def fixes, a note
//! saying why, and defs unchanged.
//!
//! Like `converts_the_models`, it writes only into fresh content roots under
//! the system's temporary folder, which `TMPDIR` moves, and reads the base game
//! from `~/.spring/games`. `COILBOX_COMPAT_GAME` picks another game there.

mod common;

use std::path::Path;
use std::time::Instant;

use common::setup;
use serde_json::Value;

/// The name the scan gives the game in `archive`, which the mutator depends on.
fn game_name(engine: &Path, root: &Path, archive: &str) -> String {
    let out = tauri_plugin_coilbox_unitsync::scan_blocking(
        &engine.to_string_lossy(),
        &root.to_string_lossy(),
    )
    .expect("scan");
    let scan: Value = serde_json::from_str(&out).expect("JSON");
    scan["games"]
        .as_array()
        .and_then(|games| {
            games.iter().find(|g| {
                g["primaryArchive"]["name"]
                    .as_str()
                    .is_some_and(|n| n.eq_ignore_ascii_case(archive))
            })
        })
        .and_then(|g| g["name"].as_str())
        .expect("the scan lists the base game")
        .to_string()
}

/// Every unit and weapon def of `archive`, as `unitsync_unit_defs` reads them.
fn defs_of(engine: &Path, root: &Path, archive: &str) -> (String, Value) {
    let started = Instant::now();
    let out = tauri_plugin_coilbox_unitsync::unit_defs_blocking(
        &engine.to_string_lossy(),
        &root.to_string_lossy(),
        archive,
    )
    .expect("unit defs");
    eprintln!("{archive}: defs read in {:?}", started.elapsed());
    let defs: Value = serde_json::from_str(&out).expect("JSON");
    assert!(
        defs["units"].as_object().is_some_and(|u| !u.is_empty()),
        "{}",
        defs["unitErrors"]
    );
    (out, defs)
}

/// The key of `t` whose lower case is `name`.
fn field<'a>(t: &'a Value, name: &str) -> Option<&'a Value> {
    t.as_object()?
        .iter()
        .find(|(k, _)| k.to_lowercase() == name)
        .map(|(_, v)| v)
}

fn commander(unit: &Value) -> bool {
    match field(unit, "commander") {
        Some(Value::Bool(b)) => *b,
        Some(Value::Number(n)) => n.as_f64() != Some(0.0),
        Some(Value::String(s)) => s != "0" && !s.eq_ignore_ascii_case("false"),
        _ => false,
    }
}

fn is_commander_param(unit: &Value) -> Option<&Value> {
    field(field(unit, "customparams")?, "iscommander")
}

#[test]
#[ignore = "needs xta-9.65.sd7 (or COILBOX_COMPAT_GAME) in ~/.spring/games, an installed engine with libunitsync, a built coilbox-unitsync-worker in target/debug"]
fn the_commanders_get_iscommander_and_the_bombs_keep_their_burst_where_the_game_allows() {
    let (engine, archive) = match setup() {
        Ok(v) => v,
        Err(why) => {
            eprintln!("{why}, so this checks nothing");
            return;
        }
    };
    let root = tempfile::tempdir().unwrap();
    let name = game_name(&engine, root.path(), &archive);
    let built = tauri_plugin_coilbox_compat::build(
        &root.path().to_string_lossy(),
        &engine.to_string_lossy(),
        &archive,
        &name,
        "0",
        coilbox_compat::latest(),
        "0.0.0",
    )
    .expect("build");
    eprintln!("{archive}: notes {:?}", built.notes);
    // Each def file is either written or named in a note that says why not.
    let written = |file: &str| built.files.iter().any(|f| f == file);
    let noted = |file: &str| {
        built
            .notes
            .iter()
            .any(|n| n.contains(file) && n.contains("def fixes that run there are not written"))
    };
    let (post, weapons_post) = (
        tauri_plugin_coilbox_compat::models::DEFS_POST,
        "gamedata/weapondefs_post.lua",
    );
    let fixes_in_post = !noted(post);
    assert!(
        written(weapons_post) != noted(weapons_post),
        "{:?}",
        built.notes
    );
    // defs_post.lua also carries the converted models, so it can be written
    // with no def fixes in it, but never left out without a note.
    assert!(written(post) || noted(post), "{:?}", built.notes);
    match archive.as_str() {
        "xta-9.65.sd7" => assert!(fixes_in_post && written(weapons_post), "{:?}", built.notes),
        // Its own defs.lua never loads defs_post.lua, and it ships its own
        // weapondefs_post.lua, so it gets no def fixes (#4628).
        "balanced_annihilation-v15.9.8.sdz" => {
            assert!(!fixes_in_post && noted(weapons_post), "{:?}", built.notes)
        }
        _ => {}
    }

    let (base_text, base) = defs_of(&engine, root.path(), &archive);
    let (_, fixed) = defs_of(&engine, root.path(), &built.folder);
    let (base_units, units) = (
        base["units"].as_object().unwrap(),
        fixed["units"].as_object().unwrap(),
    );
    assert_eq!(base_units.len(), units.len());

    let mut commanders = Vec::new();
    for (key, unit) in units {
        let before = &base_units[key];
        if fixes_in_post && commander(before) && is_commander_param(before).is_none() {
            assert_eq!(
                is_commander_param(unit),
                Some(&Value::String("1".into())),
                "{key}"
            );
            commanders.push(key.clone());
        } else {
            assert_eq!(
                is_commander_param(unit),
                is_commander_param(before),
                "{key}"
            );
        }
        assert_eq!(
            field(unit, "canmanualfire"),
            field(before, "canmanualfire"),
            "{key}"
        );
    }
    eprintln!("{} commanders: {commanders:?}", commanders.len());
    let manifest = coilbox_compat::manifest(coilbox_compat::latest()).unwrap();
    let models = tauri_plugin_coilbox_compat::models::model_keys(&built.files).len();
    if !fixes_in_post && !written(weapons_post) {
        // Nothing to count, and every unit is as the base game has it, which
        // the loop above checked for iscommander.
        assert!(commanders.is_empty());
        assert_eq!(built.def_overrides, models);
        return;
    }
    assert!(!commanders.is_empty());

    // XTA's bombers set manualBombSettings with a burst of their own, which
    // the engine's weapondefs_post.lua replaces with 2 at 0.4.
    let (base_weapons, weapons) = (&base["weaponDefs"], &fixed["weaponDefs"]);
    // A TDF value is a string, and one the engine's copy wrote is a number.
    let burst = |w: &Value| {
        field(w, "burst").and_then(|b| match b {
            Value::String(s) => s.parse::<f64>().ok(),
            other => other.as_f64(),
        })
    };
    if archive == "xta-9.65.sd7" {
        assert_eq!(burst(&base_weapons["armbomb"]), Some(2.0));
        assert_eq!(burst(&weapons["armbomb"]), Some(4.0));
        assert_eq!(burst(&weapons["corbomb"]), Some(3.0));
        assert!(field(&weapons["armbomb"], "manualbombsettings").is_none());
    }
    let with_area = weapons
        .as_object()
        .unwrap()
        .values()
        .filter(|w| {
            field(w, "customparams")
                .and_then(|p| field(p, "areaofeffect"))
                .is_some()
        })
        .count();
    eprintln!("{with_area} weapons keep areaOfEffect in customparams");
    assert!(with_area > 0);

    let counted = tauri_plugin_coilbox_compat::defs::changed(
        &manifest,
        &coilbox_compat::DefsFile::ALL,
        &base_text,
    )
    .unwrap();
    eprintln!(
        "{counted} defs counted as changed by the def fixes, defOverrides {}",
        built.def_overrides
    );
    assert!(counted >= commanders.len() + with_area);

    // The defs whose model the game does not have get a box (issue #4686),
    // and the build counts them from its own run of the fix.
    // The same run lists the unit defs whose icon type reads "default" (issue
    // #4699).
    let (standins, icons) = if fixes_in_post {
        let source = tauri_plugin_coilbox_compat::standins::script(&manifest).unwrap();
        let answer = tauri_plugin_coilbox_unitsync::lua_exec_blocking(
            &engine.to_string_lossy(),
            &root.path().to_string_lossy(),
            &archive,
            &source,
        )
        .expect("the stand-in run");
        let found = tauri_plugin_coilbox_compat::standins::parse(&answer).unwrap();
        (found.standins, found.icons)
    } else {
        (Vec::new(), Vec::new())
    };
    eprintln!("{} defs get a box: {standins:?}", standins.len());
    eprintln!("{} unit defs read the default icon: {icons:?}", icons.len());
    if archive == "xta-9.65.sd7" {
        let names: Vec<(&str, &str)> = standins
            .iter()
            .map(|s| (s.kind.as_str(), s.name.as_str()))
            .collect();
        assert_eq!(names, [("feature", "arm_infinity_dead")]);
        for box_file in [
            "compat/models/standin-1x1.s3o",
            standins[0].standin.as_str(),
            "compat/models/standin.tga",
        ] {
            assert!(built.files.iter().any(|f| f == box_file), "{box_file}");
        }
        assert!(built.notes.iter().any(|n| n.contains("arm_infinity_dead")));
    }
    assert_eq!(
        built.def_overrides,
        models + counted + standins.len() + icons.len()
    );
}
