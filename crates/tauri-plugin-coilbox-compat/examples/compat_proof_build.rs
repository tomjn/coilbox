//! Builds the compat mutator for one game, for `scripts/compat-proof.sh`
//! (issue #4566), through the same `build` the app's compat build command
//! calls, from the latest manifest.
//!
//! Usage: `compat_proof_build <engine dir> <content root> <archive>`
//!
//! `UNITSYNC_WORKER` must name a built worker. The mutator is written under
//! the content root's `games/`. Prints the mutator's folder on the first line,
//! then the manifest it was built from and any notes, one per line.

use serde_json::Value;

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let [engine, root, archive] = args.as_slice() else {
        eprintln!("usage: compat_proof_build <engine dir> <content root> <archive>");
        std::process::exit(2);
    };
    if let Err(e) = run(engine, root, archive) {
        eprintln!("{archive}: {e}");
        std::process::exit(1);
    }
}

fn run(engine: &str, root: &str, archive: &str) -> Result<(), String> {
    let scan: Value =
        serde_json::from_str(&tauri_plugin_coilbox_unitsync::scan_blocking(engine, root)?)
            .map_err(|e| format!("the scan is not JSON: {e}"))?;
    let name = scan["games"]
        .as_array()
        .and_then(|games| {
            games.iter().find(|g| {
                g["primaryArchive"]["name"]
                    .as_str()
                    .is_some_and(|n| n.eq_ignore_ascii_case(archive))
            })
        })
        .and_then(|g| g["name"].as_str())
        .ok_or("the scan does not list the game")?
        .to_string();
    let checksum = tauri_plugin_coilbox_unitsync::game_checksum_blocking(engine, root, archive)?
        .ok_or("unitsync gave no checksum for the game")?;
    let manifest = coilbox_compat::latest();
    let built = tauri_plugin_coilbox_compat::build(
        root,
        engine,
        archive,
        &name,
        &checksum,
        manifest,
        env!("CARGO_PKG_VERSION"),
    )?;
    println!("{}", built.folder);
    println!("manifest {manifest}");
    for note in &built.notes {
        println!("note {note}");
    }
    Ok(())
}
