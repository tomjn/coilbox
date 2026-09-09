//! Checking compiled output before it ever leaves the app (issue #1276).
//!
//! A malformed tweak blob does not fail loudly. Beyond All Reason reads a
//! `tweakunits` or `tweakdefs` slot at load time, and a mistake in either one
//! produces a game that starts and behaves as though the tweak were not
//! there, or does not start at all, with the cause buried in an infolog. This
//! module is the check coilbox can run before any of that happens, because it
//! already holds the same compiled output the game would have been handed.
//!
//! Three buckets rather than one, because a warning that stops an export is a
//! warning people learn to route around. A blocker is something that would
//! reach the game broken: bad Lua, a slot in the wrong shape, two copies
//! fighting over one unit name. Review is what the compiler already flagged
//! as worth a look while still choosing to proceed (`CompiledMod::notes`). A
//! pass is a check that came back clean, so the user can see what was looked
//! at and not only what was wrong.
//!
//! What each check actually validates:
//!
//!  - Every file the mutator archive route would write parses. This is the
//!    syntax check the issue asks for first, run through the same sandbox
//!    that reads a game's own config (`coilbox-springlua`), or through a JSON
//!    parser for the one file that is not Lua (issue #2743).
//!  - Every table-form chunk evaluates to a Lua table. Beyond All Reason's
//!    `tweakunits` route gives a plain table payload a slot of its own, and
//!    issue #1277 packs the transport. A chunk is what would go in one slot.
//!  - Every block-form chunk is wrapped in `do ... end`, checked on the
//!    rendered text rather than by running it: that shape is what lets BAR
//!    concatenate several into one `tweakdefs` slot without one block's
//!    locals leaking into the next.
//!  - No two of a project's own copies claim the same unit name. `clones` is
//!    keyed by an arbitrary id, and nothing stops two entries naming the same
//!    `key`. The compiler would then write two files to the same path, or two
//!    entries under the same table key, and one would silently overwrite the
//!    other.
//!  - A chunk's Lua survives a base64 round trip under the same alphabet
//!    issue #1277 will encode it with (URL-safe, unpadded). This project
//!    never produces the bytes any other way today, so the check cannot catch
//!    a mistake in a user's project. It catches a mistake in coilbox's own
//!    encoding the moment one is introduced, on every project rather than
//!    only in a unit test.
//!
//! What this deliberately leaves out: the 16,000 character cap on a BAR slot,
//! and the 19-character `!bset tweakunits10 ` prefix that has to fit inside
//! it. Both are real, but neither means anything until something decides how
//! chunks are sliced across numbered slots, which is issue #1277's packer and
//! not this compiler's chunks. Checking a size here would either duplicate
//! that decision or guess at it.

use crate::compile::{Chunk, CompiledMod, LuaForm};
use crate::model::ModProject;
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use coilbox_springlua::SpringLua;
use serde::Serialize;
use std::collections::BTreeMap;

/// What a preflight run found, kept in three lists so a caller never has to
/// re-sort a blocker from a note by guessing at its wording.
#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreflightReport {
    /// Would reach the game broken. Export should wait until these clear.
    pub blockers: Vec<String>,
    /// Worth a look, but the compiler already chose to proceed past these.
    pub review: Vec<String>,
    /// What was checked and came back clean.
    pub passes: Vec<String>,
}

/// Run every check over what a project compiled to.
///
/// Takes the project as well as the compiled output because one check, two
/// copies naming the same unit, is a fact about the project's own `clones`
/// map that the compiled Lua no longer carries once it has been rendered.
pub fn preflight(project: &ModProject, compiled: &CompiledMod) -> PreflightReport {
    let mut report = PreflightReport::default();

    check_files_parse(compiled, &mut report);
    check_table_chunks_are_tables(compiled, &mut report);
    check_block_chunks_are_wrapped(compiled, &mut report);
    check_duplicate_clone_keys(project, &mut report);
    check_base64_round_trip(compiled, &mut report);

    // The compiler's own notes are already "what to watch out for in what it
    // did" (`CompiledMod::notes`'s own doc comment). That is the review
    // bucket's definition, so they are carried across rather than
    // re-derived.
    report.review.extend(compiled.notes.iter().cloned());

    report
}

/// A VM only ever evaluates a string this crate built itself, never reads a
/// file, so the VFS root it is rooted at is never consulted. The system temp
/// directory is a real path without needing one made and torn down per call.
fn lua_root() -> std::path::PathBuf {
    std::env::temp_dir()
}

/// Every generated file has to be what its name says it is, or the mutator
/// route delivers a game with none of the project's changes in it and no
/// error a player can see.
///
/// The Lua is wrapped in a function body rather than run directly, matching
/// the integration test this mirrors (`tests/generated_lua_runs.rs`): a
/// `modinfo.lua` returns a table and `gamedata/unitdefs_post.lua` returns
/// nothing, so running either as a top-level chunk answers the wrong
/// question. Whether the source compiles at all is the same question for
/// both, and a function body answers only that.
///
/// A mutator's language file (issue #2743) is JSON rather than Lua, and a
/// game reads it with a JSON decoder, so it is checked with one. Same
/// failure either way: a file the game cannot read is a file the game acts as
/// though were not there.
fn check_files_parse(compiled: &CompiledMod, report: &mut PreflightReport) {
    if compiled.files.is_empty() {
        return;
    }
    let lua_files: Vec<&crate::compile::CompiledFile> = compiled
        .files
        .iter()
        .filter(|file| !file.path.ends_with(".json"))
        .collect();
    let mut ok = true;

    for file in compiled.files.iter().filter(|f| f.path.ends_with(".json")) {
        if let Err(e) = serde_json::from_str::<serde_json::Value>(&file.contents) {
            ok = false;
            report.blockers.push(format!(
                "{} does not parse as JSON, so the mutator route would ship a game that reads none of it: {e}",
                file.path
            ));
        }
    }

    if !lua_files.is_empty() {
        let lua = match SpringLua::new(lua_root()) {
            Ok(lua) => lua,
            Err(e) => {
                report
                    .blockers
                    .push(format!("Could not start the Lua syntax check: {e}"));
                return;
            }
        };
        for file in lua_files {
            let source = format!(
                "local check = function()\n{}\nend\nreturn {{ ok = check ~= nil }}\n",
                file.contents
            );
            if let Err(e) = lua.eval_value_raw(&source, &file.path) {
                ok = false;
                report.blockers.push(format!(
                    "{} does not parse as Lua, so the mutator route would ship a game with this file broken: {e}",
                    file.path
                ));
            }
        }
    }

    if ok {
        report.passes.push(format!(
            "{} generated file{} parse{} as the engine will read {}.",
            compiled.files.len(),
            if compiled.files.len() == 1 { "" } else { "s" },
            if compiled.files.len() == 1 { "s" } else { "" },
            if compiled.files.len() == 1 {
                "it"
            } else {
                "them"
            },
        ));
    }
}

/// A `tweakunits` slot is a plain table (issue #1277). A table-form chunk
/// that is not one, once rendered, would still be accepted as Lua by
/// `return <chunk>` but would not be the map of unit name to definition BAR
/// expects, so evaluating it and checking its shape is the only way to know.
fn check_table_chunks_are_tables(compiled: &CompiledMod, report: &mut PreflightReport) {
    let table_chunks: Vec<&Chunk> = compiled
        .chunks
        .iter()
        .filter(|chunk| chunk.form == LuaForm::Table)
        .collect();
    if table_chunks.is_empty() {
        return;
    }
    let lua = match SpringLua::new(lua_root()) {
        Ok(lua) => lua,
        Err(e) => {
            report
                .blockers
                .push(format!("Could not start the Lua syntax check: {e}"));
            return;
        }
    };
    let mut ok = true;
    for chunk in &table_chunks {
        let source = format!("return {}\n", chunk.lua);
        match lua.eval_value_raw(&source, &chunk.title) {
            Ok(value) if value.is_object() => {}
            Ok(_) => {
                ok = false;
                report.blockers.push(format!(
                    "{} does not compile to a table, so a tweakunits slot would reject it.",
                    chunk.title
                ));
            }
            Err(e) => {
                ok = false;
                report
                    .blockers
                    .push(format!("{} does not parse as Lua: {e}", chunk.title));
            }
        }
    }
    if ok {
        report.passes.push(format!(
            "{} table chunk{} compile{} to a Lua table.",
            table_chunks.len(),
            if table_chunks.len() == 1 { "" } else { "s" },
            if table_chunks.len() == 1 { "s" } else { "" },
        ));
    }
}

/// A `tweakdefs` slot has to be `do ... end` so several can be concatenated
/// into one slot without one block's locals leaking into the next
/// (`menu_block`'s own doc comment). Checked on the text rather than by
/// running the block: whether it is wrapped is a fact about its shape, not
/// about what it does when it runs.
fn check_block_chunks_are_wrapped(compiled: &CompiledMod, report: &mut PreflightReport) {
    let block_chunks: Vec<&Chunk> = compiled
        .chunks
        .iter()
        .filter(|chunk| chunk.form == LuaForm::Block)
        .collect();
    if block_chunks.is_empty() {
        return;
    }
    let mut ok = true;
    for chunk in &block_chunks {
        if !is_wrapped_in_do_end(&chunk.lua) {
            ok = false;
            report.blockers.push(format!(
                "{} is not wrapped in do ... end, so a tweakdefs slot could not run it alongside another mod's.",
                chunk.title
            ));
        }
    }
    if ok {
        report.passes.push(format!(
            "{} block chunk{} {} wrapped in do ... end.",
            block_chunks.len(),
            if block_chunks.len() == 1 { "" } else { "s" },
            if block_chunks.len() == 1 { "is" } else { "are" },
        ));
    }
}

/// The compiler's every block-form chunk is a leading `-- ` comment line
/// (`comment_text`'s callers) followed by `do`, the body, and a closing
/// `end` on its own line. Checked against exactly that shape rather than a
/// looser scan, so a stray identifier ending in "end" cannot pass as a
/// closed block.
fn is_wrapped_in_do_end(lua: &str) -> bool {
    let lines: Vec<&str> = lua
        .lines()
        .filter(|line| !line.trim_start().starts_with("--"))
        .collect();
    match (lines.first(), lines.last()) {
        (Some(first), Some(last)) => first.trim() == "do" && last.trim() == "end",
        _ => false,
    }
}

/// `clones` is keyed by an arbitrary id, and nothing before this stops two
/// entries from naming the same unit `key`. The compiler would then write
/// two `units/<key>.lua` files to the same path, or fold both into the same
/// table entry, and one clone's work would vanish with nothing in the
/// generated Lua left to say so.
fn check_duplicate_clone_keys(project: &ModProject, report: &mut PreflightReport) {
    let mut owners: BTreeMap<&str, Vec<&str>> = BTreeMap::new();
    for (slot, clone) in &project.edits.clones {
        owners.entry(clone.key.as_str()).or_default().push(slot);
    }
    if owners.is_empty() {
        return;
    }
    let mut ok = true;
    for (unit, slots) in &owners {
        if slots.len() > 1 {
            ok = false;
            report.blockers.push(format!(
                "{unit} is defined by {} copies ({}), and only one of them will reach the game.",
                slots.len(),
                slots.join(", "),
            ));
        }
    }
    if ok {
        report.passes.push(format!(
            "Every copy names a unit none of the project's other copies claim ({} checked).",
            owners.len()
        ));
    }
}

/// Encodes and decodes every chunk under the alphabet issue #1277 will pack
/// a BAR slot with (URL-safe, padding stripped, per that issue's own
/// description of NuttyB's packer) and checks the bytes survived unchanged.
///
/// This can only fail today from a bug in coilbox's own encode/decode
/// pairing, never from anything a user's project contains, since nothing yet
/// produces these bytes any other way. It stays a preflight check rather
/// than only a unit test so that a mismatch introduced later, say encoding
/// with one alphabet and decoding with another, is caught on every project a
/// user runs this against, not only in CI.
fn check_base64_round_trip(compiled: &CompiledMod, report: &mut PreflightReport) {
    if compiled.chunks.is_empty() {
        return;
    }
    let mut ok = true;
    for chunk in &compiled.chunks {
        let encoded = URL_SAFE_NO_PAD.encode(chunk.lua.as_bytes());
        match URL_SAFE_NO_PAD.decode(&encoded) {
            Ok(bytes) if bytes == chunk.lua.as_bytes() => {}
            Ok(_) => {
                ok = false;
                report.blockers.push(format!(
                    "{}'s base64 payload decodes back to different Lua than it started as.",
                    chunk.title
                ));
            }
            Err(e) => {
                ok = false;
                report.blockers.push(format!(
                    "{}'s base64 payload does not decode: {e}",
                    chunk.title
                ));
            }
        }
    }
    if ok {
        report.passes.push(format!(
            "{} chunk{} base64-encode{} and decode{} back unchanged.",
            compiled.chunks.len(),
            if compiled.chunks.len() == 1 { "" } else { "s" },
            if compiled.chunks.len() == 1 { "s" } else { "" },
            if compiled.chunks.len() == 1 { "s" } else { "" },
        ));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn project(edits: serde_json::Value) -> ModProject {
        serde_json::from_value(json!({
            "name": "Test project",
            "gameName": "Balanced Annihilation V15.9.8",
            "edits": edits,
        }))
        .expect("parse")
    }

    fn run(edits: serde_json::Value) -> (ModProject, CompiledMod, PreflightReport) {
        let project = project(edits);
        let compiled = crate::compile::compile(&project);
        let report = preflight(&project, &compiled);
        (project, compiled, report)
    }

    #[test]
    fn a_project_that_changes_nothing_has_nothing_to_report() {
        let (_, _, report) = run(json!({}));
        assert!(report.blockers.is_empty());
        assert!(report.review.is_empty());
        assert!(report.passes.is_empty());
    }

    #[test]
    fn a_field_change_passes_every_check_that_applies_to_it() {
        let (_, _, report) = run(json!({
            "overrides": { "armcom": { "maxDamage": 5000 } }
        }));
        assert!(report.blockers.is_empty());
        assert!(report
            .passes
            .iter()
            .any(|p| p.contains("table chunk") && p.contains("compile")));
        assert!(report.passes.iter().any(|p| p.contains("base64-encode")));
        // A field change still writes modinfo.lua and the post file, so the
        // file-syntax check has something to report on too.
        assert!(report.passes.iter().any(|p| p.contains("generated file")));
    }

    #[test]
    fn a_replacing_copy_passes_the_wrapped_check() {
        let (_, _, report) = run(json!({
            "clones": { "armcom": {
                "key": "armcom", "source": "armcom",
                "replacesGameUnit": true,
                "def": { "maxDamage": 9000 }
            } }
        }));
        assert!(report.blockers.is_empty());
        assert!(report
            .passes
            .iter()
            .any(|p| p.contains("block chunk") && p.contains("do ... end")));
    }

    /// The case the issue names: two entries in `clones`, different ids,
    /// naming the same unit. Neither compile.rs nor its tests catch this
    /// today, which is exactly why it belongs in preflight.
    #[test]
    fn two_clones_naming_the_same_unit_is_a_blocker() {
        let (_, _, report) = run(json!({
            "clones": {
                "first": { "key": "supercom", "replacesGameUnit": false, "def": { "maxDamage": 1 } },
                "second": { "key": "supercom", "replacesGameUnit": false, "def": { "maxDamage": 2 } }
            }
        }));
        assert!(report
            .blockers
            .iter()
            .any(|b| b.contains("supercom") && b.contains("2 copies")));
        // Not also reported clean: a blocker and a pass about the same fact
        // would be the exact confusion the three-way split exists to avoid.
        assert!(report
            .passes
            .iter()
            .all(|p| !p.contains("Every copy names")));
    }

    /// A name and description edit is not compiled at all (compile.rs's own
    /// note), which is exactly the kind of thing worth a look without being
    /// wrong enough to block on.
    #[test]
    fn a_compiler_note_lands_in_review_not_blockers() {
        let (_, compiled, report) = run(json!({
            "text": { "armcom": { "en": { "name": "Commander" } } }
        }));
        assert!(!compiled.notes.is_empty());
        assert_eq!(report.review, compiled.notes);
        assert!(report.blockers.is_empty());
    }

    #[test]
    fn is_wrapped_in_do_end_rejects_a_trailing_word_that_only_ends_in_end() {
        assert!(!is_wrapped_in_do_end("do\n  x = 1\nbackend"));
        assert!(!is_wrapped_in_do_end("domino\n  x = 1\nend"));
        assert!(is_wrapped_in_do_end("-- a comment\ndo\n  x = 1\nend"));
    }

    /// Every check that runs at all runs over everything the milestone's own
    /// "one of each" fixture compiles to, matching
    /// `every_generated_file_is_lua_that_parses` in the integration tests so
    /// the two suites are checking the same claim from two angles.
    #[test]
    fn a_project_with_one_of_everything_has_no_blockers() {
        let (_, _, report) = run(json!({
            "overrides": {
                "armcom": { "maxdamage": 5000 },
                "supercom": { "buildtime": 10 }
            },
            "clones": {
                "supercom": {
                    "key": "supercom", "source": "armcom",
                    "replacesGameUnit": false,
                    "def": { "maxdamage": 9000, "buildoptions": ["armpw"] }
                },
                "armflash": {
                    "key": "armflash", "source": "armflash",
                    "replacesGameUnit": true,
                    "def": { "maxdamage": 1 }
                }
            },
            "menus": {
                "armlab": [{ "op": "move", "unit": "armpw", "before": null }],
                "supercom": [{ "op": "add", "unit": "armmex" }]
            },
            "disabled": ["armstump"],
            "text": { "armcom": { "en": { "name": "Commander" } } }
        }));
        assert!(report.blockers.is_empty());
        assert!(!report.passes.is_empty());
    }
}
