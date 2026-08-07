//! Install the mission runtime into a loose game folder, from a shell script.
//!
//! The Splinter Faction harness scripts play the runtime a game vendors rather
//! than the one in this repo, and nothing re-installed it, so the two drifted
//! and the proof stayed green against a runtime coilbox no longer ships (issue
//! #934). They now install first, and this is what they call.
//!
//! It is a way in to the plugin's own install rather than a second copy of it,
//! so a harness run writes what the **Install the mission runtime** button
//! writes, down to the prune of files a newer runtime no longer ships. The
//! source folder is an argument because the app finds it through an `AppHandle`
//! an example has no way to make.
//!
//! Usage: install-mission-runtime <runtime folder> <game folder>

use std::path::Path;
use tauri_plugin_coilbox_scenario::runtime;

fn main() {
    let mut args = std::env::args().skip(1);
    let (Some(src), Some(dest)) = (args.next(), args.next()) else {
        eprintln!("usage: install-mission-runtime <runtime folder> <game folder>");
        std::process::exit(2);
    };

    let dest = Path::new(&dest);
    // What the game was holding, so a run can say the copy it replaced was
    // behind. An unadopted game has no marker and nothing to say, and asking for
    // one anyway is what made a first install into an empty folder print a VFS
    // error and a traceback over the top of its caller (issue #936).
    let before = runtime::marker_present(dest)
        .then(|| runtime::read_marker(dest).ok())
        .flatten();
    let files = match runtime::install(Path::new(&src), dest) {
        Ok(files) => files,
        Err(e) => {
            eprintln!("{e}");
            std::process::exit(1);
        }
    };
    // Read back through the engine's own VFS, for the reason the command does:
    // what matters is the runtime the engine will load out of that folder.
    let marker = match runtime::read_marker(dest) {
        Ok(marker) => marker,
        Err(e) => {
            eprintln!("{e}");
            std::process::exit(1);
        }
    };
    // A drifted copy said out loud rather than quietly overwritten, because a
    // run against the wrong runtime is what issue #934 is about. It goes to
    // stderr so it lands in a harness's output rather than in the field the
    // caller is reading.
    if let Some(before) = before.filter(|before| before["version"] != marker["version"]) {
        eprintln!(
            "the game was on runtime version {}, and is now on {}",
            before["version"], marker["version"]
        );
    }
    // The version and the file count, space separated, for a shell caller to
    // read. The version is also what the adoption probe is told to expect, so a
    // runtime that loaded out of the game and reports a different one is a
    // failure rather than a surprise.
    println!("{} {}", marker["version"], files.len());
}
