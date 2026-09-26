//! The numbered tweak slots reach every game whose decoder this project has
//! read, in the engine's own Lua with the slots handed over as mod options
//! (issue #3126).
//!
//! Beyond All Reason and Zero-K both declare `tweakdefs`/`tweakunits` slots,
//! and both read a `tweakunits` payload through `CustomKeyToUsefulTable`,
//! which rewrites every `_` to `=` before a decoder that only knows the
//! URL-safe alphabet. So a field change whose base64 holds a 63 has no
//! spelling either game reads in a `tweakunits` slot. This loads each game
//! twice: once with such a table in a `tweakunits` slot, the way the packer
//! used to send it, to show the change is lost, and once with exactly what
//! the packer sends now, to show it lands.
//!
//! It needs an engine under `~/.spring/engine`, the games named below, and a
//! worker built from this checkout in `target/debug`. Where any is missing,
//! or the worker predates `--defs-probe`, it checks nothing for that game and
//! says so.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use base64::{engine::general_purpose::STANDARD_NO_PAD, Engine as _};
use serde_json::{json, Value};
use tauri_plugin_coilbox_workshop::loads_as::{
    tweak_mod_options, DefTable, ProbeRead, ProbeResult, ProbeRun, TweakRoute, Written,
};
use tauri_plugin_coilbox_workshop::ModProject;

/// Each checked game, and a unit it has with a `health` field.
const GAMES: &[(&str, &str)] = &[
    ("Beyond All Reason test-30922-8064a43", "armpw"),
    ("Zero-K v1.14.8.0", "cloakraid"),
];

/// "Heavy tank". Russian so its UTF-8 bytes can encode to a 63.
const NAME: &str = "Тяжёлый танк";

const HEALTH: f64 = 1234.0;

fn setup() -> Result<(PathBuf, PathBuf), String> {
    let home = PathBuf::from(std::env::var_os("HOME").ok_or("no HOME")?);
    let data = home.join(".spring");
    let lib = if cfg!(target_os = "macos") {
        "libunitsync.dylib"
    } else if cfg!(windows) {
        "unitsync.dll"
    } else {
        "libunitsync.so"
    };
    let engine = std::fs::read_dir(data.join("engine"))
        .map_err(|_| "no engine is installed".to_string())?
        .flatten()
        .flat_map(|platform| {
            std::fs::read_dir(platform.path())
                .into_iter()
                .flatten()
                .flatten()
        })
        .map(|e| e.path())
        .find(|dir| dir.join(lib).is_file())
        .ok_or("no engine is installed")?;
    let worker = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../target/debug")
        .join(if cfg!(windows) {
            "coilbox-unitsync-worker.exe"
        } else {
            "coilbox-unitsync-worker"
        });
    if !worker.is_file() {
        return Err("the unitsync worker is not built".into());
    }
    std::env::set_var("UNITSYNC_WORKER", &worker);
    Ok((engine, data))
}

fn load(
    engine: &Path,
    data: &Path,
    game: &str,
    runs: &[ProbeRun],
) -> Result<Vec<ProbeResult>, String> {
    let input = serde_json::to_string(&json!({ "runs": runs })).expect("json");
    let out = tauri_plugin_coilbox_unitsync::defs_probe_blocking(
        &engine.to_string_lossy(),
        &data.to_string_lossy(),
        game,
        &input,
    )?;
    let out: Value = serde_json::from_str(&out).map_err(|e| format!("{e}: {out}"))?;
    serde_json::from_value(out["runs"].clone())
        .ok()
        .filter(|r: &Vec<ProbeResult>| r.len() == runs.len())
        .ok_or_else(|| out["errors"].to_string())
}

fn health(unit: &str) -> ProbeRead {
    ProbeRead {
        table: DefTable::Units,
        key: unit.into(),
        path: vec!["health".into()],
        expect: HEALTH,
    }
}

/// The first spacing of `NAME` whose `payload` holds `wanted`, so each
/// load below is certain to carry the character it is about.
fn with_spacing<T>(wanted: impl Fn(&T) -> bool, make: impl Fn(&str) -> T) -> T {
    (0..12)
        .map(|pad| make(&format!("{}{NAME}", " ".repeat(pad))))
        .find(|payload| wanted(payload))
        .expect("some spacing encodes the character")
}

#[test]
fn a_field_change_lands_through_the_numbered_slots_in_each_checked_game() {
    let (engine, data) = match setup() {
        Ok(v) => v,
        Err(why) => {
            eprintln!("{why}, so this checks nothing");
            return;
        }
    };
    for (game, unit) in GAMES {
        let bare = load(
            &engine,
            &data,
            game,
            &[ProbeRun {
                reads: vec![health(unit)],
                ..Default::default()
            }],
        );
        match &bare {
            Err(e) if e.contains("unknown argument") => {
                eprintln!(
                    "the worker in target/debug predates --defs-probe, so this checks nothing"
                );
                return;
            }
            Ok(runs) if runs[0].error.is_none() && runs[0].reads[0].value.is_some() => {}
            other => {
                eprintln!("{game} did not load ({other:?}), so this checks nothing for it");
                continue;
            }
        }
        let own = bare.expect("loaded").remove(0).reads[0].value;
        assert_ne!(
            own,
            Some(HEALTH),
            "{game}: pick a health the game does not already have"
        );

        // The old route: the table in a `tweakunits` slot. A 63 sits in the
        // third place of a group with a fourth after it, where the decoder's
        // nil stops the slot, in whichever alphabet it is spelt.
        let table =
            |name: &str| format!("{{ {unit} = {{ health = {HEALTH}, name = \"{name}\" }} }}");
        let breaks = |text: &String| {
            let payload = STANDARD_NO_PAD.encode(text.as_bytes());
            payload
                .char_indices()
                .any(|(i, c)| c == '/' && i % 4 == 2 && i + 1 < payload.len())
        };
        let old = with_spacing(breaks, table);
        let standard = STANDARD_NO_PAD.encode(old.as_bytes());
        let url_safe = standard.replace('+', "-").replace('/', "_");

        // The new route: exactly what the packer sends, with a 63 in it.
        let project = |name: &str| -> ModProject {
            serde_json::from_value(json!({
                "name": "TEST tweak slots in each checked game (delete me)",
                "gameName": game,
                "edits": { "overrides": { *unit: { "health": HEALTH, "name": name } } },
            }))
            .expect("parse")
        };
        let options = |p: &ModProject| {
            tweak_mod_options(p, &Written::default(), TweakRoute::Numbered).expect("slots")
        };
        let new = with_spacing(|p| options(p)["tweakdefs"].contains('_'), project);
        let packed = options(&new);
        assert_eq!(packed.keys().collect::<Vec<_>>(), vec!["tweakdefs"]);

        let runs: Vec<ProbeRun> = [
            BTreeMap::from([("tweakunits".to_string(), standard)]),
            BTreeMap::from([("tweakunits".to_string(), url_safe)]),
            packed,
        ]
        .into_iter()
        .map(|mod_options| ProbeRun {
            reads: vec![health(unit)],
            mod_options,
            ..Default::default()
        })
        .collect();
        let back = load(&engine, &data, game, &runs).expect("a load");
        eprintln!("{game}: {back:?}");
        for (run, route) in back
            .iter()
            .zip(["tweakunits, standard", "tweakunits, URL-safe"])
        {
            assert_eq!(run.error, None, "{game}, {route}");
            assert_eq!(
                run.reads[0].value, own,
                "{game}, {route}: the slot should be lost"
            );
        }
        assert_eq!(back[2].error, None, "{game}");
        assert_eq!(
            back[2].reads[0].value,
            Some(HEALTH),
            "{game}: the packed slots"
        );
        assert!(back[2].reads[0].equal, "{game}");
    }
}
