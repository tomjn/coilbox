//! `cargo run -p coilbox-bos2lua --example run -- <script.lua> <piece> [frames]`
//!
//! Plays a Lua unit script through the preview runtime with the call-ins the
//! sweep uses, then prints one piece's pose on every frame and everything the
//! run said. For looking at a converted script that moves differently from its
//! COB.

use coilbox_springlua::unitscript::{run, ScriptEvent, Unit};

fn event(frame: u32, callin: &str, args: &[f64]) -> ScriptEvent {
    ScriptEvent {
        frame,
        callin: callin.into(),
        args: args.to_vec(),
        ambient: true,
    }
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let (Some(path), Some(watch)) = (args.get(1), args.get(2)) else {
        eprintln!("usage: run <script.lua> <piece> [frames]");
        std::process::exit(2);
    };
    let frames = args.get(3).and_then(|f| f.parse().ok()).unwrap_or(60);
    let lua = std::fs::read_to_string(path).expect("readable script");
    let pieces: Vec<String> = lua
        .split("piece(\"")
        .skip(1)
        .filter_map(|rest| rest.split('"').next())
        .map(str::to_string)
        .collect();
    let events = [
        event(0, "Create", &[]),
        event(1, "setSFXoccupy", &[4.0]),
        event(5, "StartMoving", &[]),
        event(60, "StopMoving", &[]),
        event(70, "Activate", &[]),
        event(80, "StartBuilding", &[0.5, 0.1]),
        event(120, "StopBuilding", &[]),
        event(130, "AimWeapon1", &[0.8, 0.1]),
        event(131, "AimWeapon2", &[-0.5, 0.2]),
        event(150, "FireWeapon1", &[]),
        event(151, "Shot1", &[]),
        event(160, "Deactivate", &[]),
        event(200, "Killed", &[50.0, 100.0]),
    ];
    let timeline = run(&lua, path, &Unit::new(&pieces), &events, frames);
    let Some(at) = pieces.iter().position(|p| p == watch) else {
        eprintln!("no piece called {watch}; the script has {pieces:?}");
        std::process::exit(2);
    };
    for (f, frame) in timeline.frames.iter().enumerate() {
        let pose: Vec<String> = frame[at * 6..at * 6 + 6]
            .iter()
            .map(|v| format!("{v:8.4}"))
            .collect();
        println!("{f:4} {}", pose.join(" "));
    }
    for w in &timeline.warnings {
        println!("warning: {w}");
    }
    if let Some(e) = timeline.error {
        println!("error: {e}");
    }
}
