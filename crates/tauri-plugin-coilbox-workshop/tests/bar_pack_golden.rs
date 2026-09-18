//! What a project packs to, written down, for Coilbox Hub to check its own
//! packer against (coilbox-hub issue #418).
//!
//! The hub gives a published project's page the `!bset` lines a host pastes
//! into a lobby, so somebody without coilbox can use it. It cannot call this
//! crate, so it holds a TypeScript port of the chunk compiler and the packer,
//! and two implementations of one rule is the arrangement that drifts. This
//! fixture is what stops it: every case is a project beside exactly what this
//! crate made of it, and the hub vendors the file and runs its port over the
//! same projects.
//!
//! So a failure here after a change to `compile.rs`, `lua.rs` or `bar_pack.rs`
//! is not a test to fix and move on from. Regenerate the fixture, and the hub's
//! vendor check goes red until its port is brought level:
//!
//!   UPDATE_GOLDEN=1 cargo test -p tauri-plugin-coilbox-workshop --test bar_pack_golden

use serde_json::{json, Value};
use tauri_plugin_coilbox_workshop::{compile, pack_bar_slots, ModProject};

const FIXTURE: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/tests/fixtures/bar-pack-golden.json"
);

/// Everything the hub's port has to reproduce for one project: the chunks a
/// reader is shown, and the lines. Preflight is left out because most of it
/// runs the Lua in a sandbox the hub does not have.
fn outcome(project: &Value) -> (Value, Value) {
    let project: ModProject = serde_json::from_value(project.clone()).expect("parse");
    let compiled = compile(&project);
    (
        json!(compiled.chunks),
        json!(pack_bar_slots(&compiled.chunks)),
    )
}

#[test]
fn every_case_packs_to_what_the_fixture_says() {
    let text = std::fs::read_to_string(FIXTURE).expect("read fixture");
    let mut cases: Vec<Value> = serde_json::from_str(&text).expect("fixture is JSON");
    assert!(!cases.is_empty(), "the fixture holds no cases");

    if std::env::var_os("UPDATE_GOLDEN").is_some() {
        for case in &mut cases {
            let (chunks, pack) = outcome(&case["project"]);
            case["chunks"] = chunks;
            case["pack"] = pack;
        }
        let out = serde_json::to_string_pretty(&cases).expect("serialise");
        std::fs::write(FIXTURE, format!("{out}\n")).expect("write fixture");
        return;
    }

    for case in &cases {
        let name = case["name"].as_str().unwrap_or("unnamed");
        let (chunks, pack) = outcome(&case["project"]);
        assert_eq!(chunks, case["chunks"], "{name}: chunks");
        assert_eq!(pack, case["pack"], "{name}: pack");
    }
}
