//! A compat build of a real old game writes the def fixes, and the game's own
//! def pipeline then carries what they put back (issue #4560): every unit with
//! the `commander` tag has `customparams.iscommander`, a bomb that sets
//! `manualBombSettings` keeps the burst its file gives, and a unit with no
//! tag is as the base game has it.
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
fn the_commanders_get_iscommander_and_the_bombs_keep_their_burst() {
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
    for file in [
        tauri_plugin_coilbox_compat::models::DEFS_POST,
        "gamedata/weapondefs_post.lua",
    ] {
        assert!(
            built.files.iter().any(|f| f == file),
            "{file}: {:?}",
            built.notes
        );
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
        if commander(before) && is_commander_param(before).is_none() {
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

    let manifest = coilbox_compat::manifest(coilbox_compat::latest()).unwrap();
    let counted = tauri_plugin_coilbox_compat::defs::changed(
        &manifest,
        &coilbox_compat::DefsFile::ALL,
        &base_text,
    )
    .unwrap();
    eprintln!("{counted} defs counted as changed by the def fixes");
    assert!(counted >= commanders.len() + with_area);
}
