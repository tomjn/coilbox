//! Tracing a project's edits to what the compiler wrote them into (issue
//! #2653).
//!
//! `compile.rs` and `bar_pack.rs` already say, for the whole project, which
//! file or which numbered lobby slot a change lands in. What they do not say
//! is the question this module answers: given one field on one unit, which
//! output carries it, so that a broken game and a large project can be
//! joined back to the one line the user actually needs to change. The
//! direction matters more than the shape: a table of outputs and their
//! contents is something `workshop_compile`'s own response already is. This
//! starts from the edit and asks where it went, which is why every entry
//! here is keyed by unit and field first and only reports its output second.
//!
//! Nothing in `compile.rs`, `bar_pack.rs` or `package.rs` changes for this.
//! This module is a read over their public output, not a new source of
//! truth: it re-derives, from the same `GameEdits` those modules are handed,
//! the same category boundaries `compile::compile` uses to decide what
//! becomes a chunk, and pairs that reconstruction positionally against the
//! chunks `compile::compile` actually produced. [`build_ledger`] refuses to
//! guess when that pairing does not line up (`resolve_slots` returning
//! `None`): a trace that is subtly wrong sends somebody to the wrong field,
//! which is worse than a trace that says it does not know.
//!
//! Mutator file attribution needs none of that reconstruction, because
//! `compile::compile`'s own rule for which file a category's Lua lands in is
//! a fixed fact about the shape of a mutator archive (a copy's own file, or
//! the one file a mutator can run code in) rather than something that
//! depends on packing arithmetic. BAR slot attribution does need it, because
//! which of the 30 numbered slots a chunk lands in depends on how big every
//! chunk ahead of it was.

use crate::bar_pack::{self, BarSlotPack};
use crate::compile::{compile, Chunk, LuaForm};
use crate::model::{BuildMenuOp, GameEdits, ModProject};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use serde::Serialize;
use std::collections::{BTreeSet, HashMap};

/// Mirrors `compile::POST_FILE`, which is private to that module. The path is
/// a fact about the shape of a mutator archive that this module has to name
/// on its own account rather than reach into `compile.rs` for, since nothing
/// here is allowed to change what that module exposes.
const POST_FILE: &str = "gamedata/unitdefs_post.lua";

/// Mirrors `compile::language_file_path`, for the reason `POST_FILE` is
/// mirrored. `a_language_edits_file_is_the_one_the_compiler_wrote` holds the
/// two together, since this is the one mirrored fact here that would send
/// somebody to a file that does not exist if it drifted.
fn language_file_path(code: &str) -> String {
    format!("language/{code}/zz_coilbox.json")
}

/// Mirrors `compile::valid_language_code`, for the same reason.
fn valid_language_code(code: &str) -> bool {
    !code.is_empty()
        && code
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_' || b == b'-')
}

/// Mirrors `compile::valid_unit_key`, for the same reason `POST_FILE` does: a
/// stable, already-duplicated invariant (see that function's own comment
/// about `checkCloneName` in `src/workshop/clones.ts`) rather than a new one
/// invented here.
fn valid_unit_key(key: &str) -> bool {
    !key.is_empty()
        && key
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_')
}

/// Where a traced change landed in BAR's numbered tweak export.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BarSlotRef {
    /// `"tweakdefs"` or `"tweakunits"`.
    pub kind: String,
    /// The slot as `!bset` names it: bare for the first of its kind, numbered
    /// from the second (`bar_pack`'s own convention).
    pub label: String,
}

/// Why a traced change did not land in a numbered BAR slot.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum BarSlotMiss {
    /// Too big for any one slot on its own (`bar_pack::BarSlotPack::oversized`).
    Oversized,
    /// Every slot BAR exposes was already spoken for
    /// (`bar_pack::BarSlotPack::unplaced`).
    Unplaced,
    /// This project's chunk order could not be matched against the compiler's
    /// own, so which slot a change reached is not known rather than known to
    /// be missing. See this module's own doc comment for why that is refused
    /// rather than guessed.
    Unresolved,
    /// A name or description edit, which the mutator carries in a language
    /// file and no slot can carry at all: a slot's Lua runs in the definition
    /// parser, where `Spring.I18N` does not exist (issue #2743). Not a
    /// packing failure like the two above, and said out loud rather than left
    /// blank, because a rename that reaches the mutator and not the lobby
    /// export is exactly the difference somebody needs to be told about.
    NoSlotForWords,
}

/// One traced change: what happened, the field it came from when it names
/// one, and where it landed once compiled.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LedgerChange {
    pub description: String,
    /// The dotted field path this change set, for a field edit. Absent for a
    /// whole-unit change (added, replaced, switched off) and for a build
    /// menu operation, neither of which is one field.
    pub field_path: Option<String>,
    /// The mutator archive file(s) that carry this change. Empty when
    /// nothing does (see `uncompiled_reason`).
    pub files: Vec<String>,
    pub bar_slot: Option<BarSlotRef>,
    pub bar_miss: Option<BarSlotMiss>,
    /// Why no output carries this change at all: a name or description edit
    /// for a game that keeps them in a localisation file, or a copy whose key
    /// the compiler already declined to use. Absent for everything else.
    pub uncompiled_reason: Option<String>,
}

/// One unit's row in the ledger.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UnitLedger {
    pub unit: String,
    pub changes: Vec<LedgerChange>,
}

/// The whole trace: every unit the project names, and what each of its
/// changes carries.
#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChangeLedger {
    pub units: Vec<UnitLedger>,
    /// Set when the BAR slot trace could not be verified for this project, so
    /// every change's `bar_miss` reads `unresolved` rather than a slot number
    /// nobody checked.
    pub notes: Vec<String>,
}

/// Which category of `compile::compile`'s output a chunk belongs to, and
/// which unit it is about where that is one unit rather than the whole
/// project.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
enum PositionKey {
    /// Every added unit, folded into one table chunk.
    Added,
    /// One unit standing in for a game unit the project replaces.
    Replaced(String),
    /// Every field change against a unit the project does not also clone,
    /// folded into one table chunk.
    Patches,
    /// One builder's replayed build menu.
    Menu(String),
    /// Every unit switched off, folded into one block chunk.
    Disabled,
}

/// Where a category's chunk landed once packed, or why it did not.
#[derive(Debug, Clone)]
enum SlotResolution {
    Slot(BarSlotRef),
    Miss(BarSlotMiss),
}

/// The same category boundaries `compile::compile` uses, in the same order it
/// pushes chunks in: added, then each replaced clone (alphabetically, the
/// order a `BTreeMap`'s own iteration already gives), then field changes,
/// then each builder's menu (alphabetically), then disabled units. Read this
/// module's own doc comment for why re-deriving this rather than reading it
/// off `compile.rs` is the whole design.
fn categorize(edits: &GameEdits) -> Vec<(PositionKey, LuaForm)> {
    let mut positions = Vec::new();

    let added_nonempty = edits
        .clones
        .iter()
        .any(|(key, clone)| !clone.replaces_game_unit && valid_unit_key(key));
    if added_nonempty {
        positions.push((PositionKey::Added, LuaForm::Table));
    }

    for (key, clone) in &edits.clones {
        if clone.replaces_game_unit && valid_unit_key(key) {
            positions.push((PositionKey::Replaced(key.clone()), LuaForm::Block));
        }
    }

    let patches_nonempty = edits
        .overrides
        .iter()
        .any(|(unit, patch)| !edits.clones.contains_key(unit) && !patch.is_empty());
    if patches_nonempty {
        positions.push((PositionKey::Patches, LuaForm::Table));
    }

    for (builder, ops) in &edits.menus {
        if !edits.clones.contains_key(builder) && !ops.is_empty() {
            positions.push((PositionKey::Menu(builder.clone()), LuaForm::Block));
        }
    }

    if !edits.disabled.is_empty() {
        positions.push((PositionKey::Disabled, LuaForm::Block));
    }

    positions
}

/// A slot's label the way `!bset` names it: bare for the first of its kind,
/// numbered from the second. Mirrors `bar_pack::bset_prefix`'s own naming,
/// minus the `!bset ` command and the trailing space that make it a whole
/// chat line rather than a name for the slot.
fn slot_label(kind: &str, index: usize) -> String {
    if index == 0 {
        kind.to_string()
    } else {
        format!("{kind}{index}")
    }
}

/// Decode one `!bset tweakdefs...`/`!bset tweakunits...` line back to the Lua
/// it carries, for the containment check [`resolve_slots`] runs against a
/// block-form chunk. `rsplit_once` rather than reconstructing the prefix:
/// the payload is everything after the line's last space regardless of which
/// kind or index the prefix names.
fn decode_slot_line(line: &str) -> Option<String> {
    let (_, payload) = line.rsplit_once(' ')?;
    let bytes = URL_SAFE_NO_PAD.decode(payload).ok()?;
    String::from_utf8(bytes).ok()
}

/// Pair [`categorize`]'s reconstruction against the chunks `compile::compile`
/// actually produced, and resolve each to where `bar_pack::pack` placed it.
///
/// `None` when the lengths or the forms at any position disagree, which means
/// this reconstruction has drifted from `compile.rs`'s real order. That is
/// refused rather than trusted regardless, per this module's own doc comment.
fn resolve_slots(
    positions: &[(PositionKey, LuaForm)],
    chunks: &[Chunk],
    pack: &BarSlotPack,
) -> Option<HashMap<PositionKey, SlotResolution>> {
    if positions.len() != chunks.len() {
        return None;
    }
    let mut table_index = 0usize;
    let mut resolved = HashMap::new();

    for (i, (key, form)) in positions.iter().enumerate() {
        let chunk = &chunks[i];
        if chunk.form != *form {
            return None;
        }

        let resolution = if pack.oversized.contains(&chunk.title) {
            SlotResolution::Miss(BarSlotMiss::Oversized)
        } else if pack.unplaced.contains(&chunk.title) {
            SlotResolution::Miss(BarSlotMiss::Unplaced)
        } else {
            match form {
                // Exactly one chunk per slot (`bar_pack::pack_tables`), so the
                // n-th table chunk that was not oversized or unplaced is the
                // n-th line `pack.tweakunits` holds.
                LuaForm::Table => {
                    let index = table_index;
                    table_index += 1;
                    SlotResolution::Slot(BarSlotRef {
                        kind: "tweakunits".to_string(),
                        label: slot_label("tweakunits", index),
                    })
                }
                // Several blocks can share one slot (`bar_pack::pack_blocks`
                // concatenates until the next one would not fit), so the slot
                // has to be found rather than counted: decode each line back
                // to Lua and look for this chunk's own minified text inside
                // it, the same identity check `compile.rs`'s own tests use.
                LuaForm::Block => {
                    let minified = bar_pack::minify_lua(&chunk.lua);
                    let found = pack.tweakdefs.iter().enumerate().find(|(_, line)| {
                        decode_slot_line(line).is_some_and(|decoded| decoded.contains(&minified))
                    });
                    match found {
                        Some((index, _)) => SlotResolution::Slot(BarSlotRef {
                            kind: "tweakdefs".to_string(),
                            label: slot_label("tweakdefs", index),
                        }),
                        // Placed by `bar_pack::pack` (not oversized, not
                        // unplaced) yet not found in any slot's decoded text:
                        // this reconstruction has drifted from the real
                        // packing in a way the earlier checks did not catch.
                        None => return None,
                    }
                }
            }
        };
        resolved.insert(key.clone(), resolution);
    }

    Some(resolved)
}

/// The `bar_slot`/`bar_miss` pair for one change, given its category's
/// resolution and whether the whole trace could be verified.
fn slot_fields(
    resolution: Option<&SlotResolution>,
    verified: bool,
) -> (Option<BarSlotRef>, Option<BarSlotMiss>) {
    if !verified {
        return (None, Some(BarSlotMiss::Unresolved));
    }
    match resolution {
        Some(SlotResolution::Slot(slot)) => (Some(slot.clone()), None),
        Some(SlotResolution::Miss(miss)) => (None, Some(*miss)),
        None => (None, Some(BarSlotMiss::Unresolved)),
    }
}

/// The file(s) and BAR resolution key a change against `unit` reaches,
/// whichever of the three homes it has: its own copy's file, the one file a
/// mutator can run code in, or nowhere when the copy's own key was already
/// left out of the compile.
fn unit_home(unit: &str, edits: &GameEdits) -> (Vec<String>, Option<PositionKey>) {
    match edits.clones.get(unit) {
        Some(_) if !valid_unit_key(unit) => (Vec::new(), None),
        Some(clone) if clone.replaces_game_unit => (
            vec![POST_FILE.to_string()],
            Some(PositionKey::Replaced(unit.to_string())),
        ),
        Some(_) => (vec![format!("units/{unit}.lua")], Some(PositionKey::Added)),
        None => (vec![POST_FILE.to_string()], Some(PositionKey::Patches)),
    }
}

/// Trace every edit in `project` to the file and BAR slot it compiles into.
pub fn build_ledger(project: &ModProject) -> ChangeLedger {
    let edits = &project.edits;
    let compiled = compile(project);
    let pack = bar_pack::pack(&compiled.chunks);
    let positions = categorize(edits);
    let resolutions = resolve_slots(&positions, &compiled.chunks, &pack);
    let verified = resolutions.is_some();

    let mut notes = Vec::new();
    if !verified && !positions.is_empty() {
        notes.push(
            "This project's BAR slot trace could not be matched against the compiler's own \
             chunk order, so no slot numbers are shown. The mutator file each change carries \
             is unaffected."
                .to_string(),
        );
    }
    let resolution_of = |key: &PositionKey| -> Option<&SlotResolution> {
        resolutions.as_ref().and_then(|map| map.get(key))
    };

    let mut unit_keys: BTreeSet<String> = BTreeSet::new();
    unit_keys.extend(edits.overrides.keys().cloned());
    unit_keys.extend(edits.clones.keys().cloned());
    unit_keys.extend(edits.menus.keys().cloned());
    unit_keys.extend(edits.disabled.iter().cloned());
    unit_keys.extend(edits.text.keys().cloned());

    let mut units = Vec::new();
    for unit in unit_keys {
        let mut changes = Vec::new();

        if let Some(clone) = edits.clones.get(&unit) {
            if !valid_unit_key(&unit) {
                changes.push(LedgerChange {
                    description: "Copy left out of the compile".to_string(),
                    field_path: None,
                    files: Vec::new(),
                    bar_slot: None,
                    bar_miss: None,
                    uncompiled_reason: Some(
                        "Its key can only hold lowercase letters, digits and underscores, and \
                         it becomes a file name in the generated game."
                            .to_string(),
                    ),
                });
            } else if clone.replaces_game_unit {
                let (bar_slot, bar_miss) = slot_fields(
                    resolution_of(&PositionKey::Replaced(unit.clone())),
                    verified,
                );
                changes.push(LedgerChange {
                    description: "Replaces the game's own unit".to_string(),
                    field_path: None,
                    files: vec![POST_FILE.to_string()],
                    bar_slot,
                    bar_miss,
                    uncompiled_reason: None,
                });
            } else {
                let (bar_slot, bar_miss) =
                    slot_fields(resolution_of(&PositionKey::Added), verified);
                changes.push(LedgerChange {
                    description: "Added as a new unit".to_string(),
                    field_path: None,
                    files: vec![format!("units/{unit}.lua")],
                    bar_slot,
                    bar_miss,
                    uncompiled_reason: None,
                });
            }
        }

        if let Some(patch) = edits.overrides.get(&unit) {
            let (files, home_key) = unit_home(&unit, edits);
            for path in patch.keys() {
                let (bar_slot, bar_miss) = match &home_key {
                    Some(key) => slot_fields(resolution_of(key), verified),
                    None => (None, None),
                };
                changes.push(LedgerChange {
                    description: format!("Field change: {path}"),
                    field_path: Some(path.clone()),
                    files: files.clone(),
                    bar_slot,
                    bar_miss,
                    uncompiled_reason: home_key.is_none().then(|| {
                        "This copy's key was already left out of the compile, so nothing \
                         carries its fields either."
                            .to_string()
                    }),
                });
            }
        }

        if let Some(ops) = edits.menus.get(&unit) {
            if !ops.is_empty() {
                let (files, home_key) = if edits.clones.contains_key(&unit) {
                    unit_home(&unit, edits)
                } else {
                    (
                        vec![POST_FILE.to_string()],
                        Some(PositionKey::Menu(unit.clone())),
                    )
                };
                for op in ops {
                    let (bar_slot, bar_miss) = match &home_key {
                        Some(key) => slot_fields(resolution_of(key), verified),
                        None => (None, None),
                    };
                    let description = match op {
                        BuildMenuOp::Add { unit: target } => {
                            format!("Build menu: added {target}")
                        }
                        BuildMenuOp::Remove { unit: target } => {
                            format!("Build menu: removed {target}")
                        }
                        BuildMenuOp::Move {
                            unit: target,
                            before: Some(before),
                        } => format!("Build menu: moved {target} before {before}"),
                        BuildMenuOp::Move {
                            unit: target,
                            before: None,
                        } => format!("Build menu: moved {target} to the end"),
                    };
                    changes.push(LedgerChange {
                        description,
                        field_path: None,
                        files: files.clone(),
                        bar_slot,
                        bar_miss,
                        uncompiled_reason: home_key.is_none().then(|| {
                            "This copy's key was already left out of the compile, so nothing \
                             carries its build menu either."
                                .to_string()
                        }),
                    });
                }
            }
        }

        if edits.disabled.iter().any(|off| off == &unit) {
            let (bar_slot, bar_miss) = slot_fields(resolution_of(&PositionKey::Disabled), verified);
            changes.push(LedgerChange {
                description: "Switched off".to_string(),
                field_path: None,
                files: vec![POST_FILE.to_string()],
                bar_slot,
                bar_miss,
                uncompiled_reason: None,
            });
        }

        if let Some(languages) = edits.text.get(&unit) {
            for (lang, fields) in languages {
                let (files, uncompiled_reason, bar_miss) = if valid_language_code(lang) {
                    (
                        vec![language_file_path(lang)],
                        None,
                        Some(BarSlotMiss::NoSlotForWords),
                    )
                } else {
                    (
                        Vec::new(),
                        Some(
                            "This language code can only hold lowercase letters, digits, \
                             hyphens and underscores, and it becomes a folder name in the \
                             generated game."
                                .to_string(),
                        ),
                        None,
                    )
                };
                for (label, value) in [("Name", &fields.name), ("Description", &fields.description)]
                {
                    let Some(value) = value else { continue };
                    changes.push(LedgerChange {
                        description: format!("{label} ({lang}): {value}"),
                        field_path: None,
                        files: files.clone(),
                        bar_slot: None,
                        bar_miss,
                        uncompiled_reason: uncompiled_reason.clone(),
                    });
                }
            }
        }

        units.push(UnitLedger { unit, changes });
    }

    ChangeLedger { units, notes }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn project(edits: serde_json::Value) -> ModProject {
        serde_json::from_value(json!({
            "name": "Faster commanders",
            "gameName": "Balanced Annihilation V15.9.8",
            "edits": edits,
        }))
        .expect("parse")
    }

    fn changes_for<'a>(ledger: &'a ChangeLedger, unit: &str) -> &'a [LedgerChange] {
        &ledger
            .units
            .iter()
            .find(|u| u.unit == unit)
            .unwrap_or_else(|| panic!("no {unit} in the ledger"))
            .changes
    }

    /// The simplest case the issue names: a field change against a game unit
    /// lands in the one file a mutator can run code in.
    #[test]
    fn a_field_change_traces_to_the_post_file() {
        let ledger = build_ledger(&project(json!({
            "overrides": { "armcom": { "maxDamage": 5000 } }
        })));
        let changes = changes_for(&ledger, "armcom");
        assert_eq!(changes.len(), 1);
        assert_eq!(changes[0].field_path.as_deref(), Some("maxDamage"));
        assert_eq!(changes[0].files, vec![POST_FILE.to_string()]);
    }

    /// A copy the project adds gets its own file, and the ledger has to name
    /// it rather than the shared post file every other change lands in.
    #[test]
    fn an_added_units_change_traces_to_its_own_file() {
        let ledger = build_ledger(&project(json!({
            "clones": { "supercom": {
                "key": "supercom", "source": "armcom", "replacesGameUnit": false,
                "def": { "maxDamage": 9000 }
            } }
        })));
        let changes = changes_for(&ledger, "supercom");
        assert_eq!(changes.len(), 1);
        assert_eq!(changes[0].files, vec!["units/supercom.lua".to_string()]);
    }

    /// A field changed on a copy is folded into the copy's own definition,
    /// so it has to trace to the copy's file, not to the post file the same
    /// field would reach against a game unit.
    #[test]
    fn a_field_changed_on_a_copy_traces_to_the_copys_own_file() {
        let ledger = build_ledger(&project(json!({
            "clones": { "supercom": {
                "key": "supercom", "source": "armcom", "replacesGameUnit": false,
                "def": { "maxDamage": 9000 }
            } },
            "overrides": { "supercom": { "maxDamage": 12000 } }
        })));
        let changes = changes_for(&ledger, "supercom");
        assert_eq!(changes.len(), 2);
        let field_change = changes
            .iter()
            .find(|c| c.field_path.is_some())
            .expect("a field change row");
        assert_eq!(field_change.files, vec!["units/supercom.lua".to_string()]);
    }

    /// The case the task calls out by name: one unit's edits split across
    /// two BAR outputs. A field change on a game unit is a table (a
    /// `tweakunits` slot) and a build menu edit on the same unit is a block
    /// (a `tweakdefs` slot), so the same unit's two changes land in two
    /// different numbered slots.
    #[test]
    fn one_units_edits_split_across_two_bar_outputs() {
        let ledger = build_ledger(&project(json!({
            "overrides": { "armlab": { "maxDamage": 1 } },
            "menus": { "armlab": [{ "op": "add", "unit": "armpw" }] }
        })));
        let changes = changes_for(&ledger, "armlab");
        assert_eq!(changes.len(), 2);
        let field = changes
            .iter()
            .find(|c| c.field_path.is_some())
            .expect("field change");
        let menu = changes
            .iter()
            .find(|c| c.description.starts_with("Build menu"))
            .expect("menu change");
        let field_slot = field.bar_slot.as_ref().expect("field lands in a slot");
        let menu_slot = menu.bar_slot.as_ref().expect("menu lands in a slot");
        assert_eq!(field_slot.kind, "tweakunits");
        assert_eq!(menu_slot.kind, "tweakdefs");
        assert_ne!(field_slot.label, menu_slot.label);
        // Both files are the same post file: the split is a BAR-slot fact,
        // not a mutator-file fact.
        assert_eq!(field.files, menu.files);
    }

    /// The other case the task calls out: one output that carries several
    /// units. Two small build menus are concatenated into the same
    /// `tweakdefs` slot by `bar_pack::pack_blocks`, so both units' ledger
    /// rows have to name that same slot.
    #[test]
    fn one_bar_slot_carries_several_units() {
        let ledger = build_ledger(&project(json!({
            "menus": {
                "armlab": [{ "op": "add", "unit": "armpw" }],
                "armvp": [{ "op": "add", "unit": "armch" }]
            }
        })));
        let a = changes_for(&ledger, "armlab")[0]
            .bar_slot
            .clone()
            .expect("armlab lands in a slot");
        let b = changes_for(&ledger, "armvp")[0]
            .bar_slot
            .clone()
            .expect("armvp lands in a slot");
        assert_eq!(
            a, b,
            "two small menus should share the one slot they fit in"
        );
    }

    /// The same "one output, several units" case for the mutator route: every
    /// unit the project switches off is one shared block, written into the
    /// same post file.
    #[test]
    fn switching_off_several_units_shares_one_block_and_one_file() {
        let ledger = build_ledger(&project(json!({
            "disabled": ["armflash", "armrock"]
        })));
        let a = &changes_for(&ledger, "armflash")[0];
        let b = &changes_for(&ledger, "armrock")[0];
        assert_eq!(a.files, vec![POST_FILE.to_string()]);
        assert_eq!(a.files, b.files);
        assert_eq!(a.bar_slot, b.bar_slot);
    }

    /// Two units added in the same project each get a file of their own (a
    /// mutator's `units/` folder has one file per unit), but they are one
    /// table chunk, so BAR's numbered export puts both in the same
    /// `tweakunits` slot. The two output kinds do not have to agree.
    #[test]
    fn two_added_units_get_different_files_but_the_same_bar_slot() {
        let ledger = build_ledger(&project(json!({
            "clones": {
                "supercom": {
                    "key": "supercom", "replacesGameUnit": false, "def": { "maxDamage": 1 }
                },
                "megacom": {
                    "key": "megacom", "replacesGameUnit": false, "def": { "maxDamage": 2 }
                }
            }
        })));
        let a = &changes_for(&ledger, "supercom")[0];
        let b = &changes_for(&ledger, "megacom")[0];
        assert_ne!(a.files, b.files, "each added unit gets its own file");
        assert_eq!(
            a.bar_slot, b.bar_slot,
            "both are folded into the one combined tweakunits chunk"
        );
    }

    /// A copy replacing a game unit lands its whole definition in the post
    /// file rather than getting a file of its own, since a mutator archive
    /// cannot merge a replacement on top of the base game's own file.
    #[test]
    fn a_replaced_units_change_traces_to_the_post_file() {
        let ledger = build_ledger(&project(json!({
            "clones": { "armcom": {
                "key": "armcom", "replacesGameUnit": true, "def": { "maxDamage": 9000 }
            } }
        })));
        let changes = changes_for(&ledger, "armcom");
        assert_eq!(changes[0].files, vec![POST_FILE.to_string()]);
    }

    /// A name edit reaches the mutator's own language file and no BAR slot,
    /// and the ledger has to say both: the file it can be read in, and the
    /// route it will not travel by (issue #2743).
    #[test]
    fn a_name_edit_names_its_language_file_and_no_bar_slot() {
        let ledger = build_ledger(&project(json!({
            "text": { "armcom": { "en": { "name": "Commander" } } }
        })));
        let changes = changes_for(&ledger, "armcom");
        assert_eq!(changes.len(), 1);
        assert_eq!(changes[0].files, vec!["language/en/zz_coilbox.json"]);
        assert!(changes[0].bar_slot.is_none());
        assert_eq!(changes[0].bar_miss, Some(BarSlotMiss::NoSlotForWords));
        assert!(changes[0].uncompiled_reason.is_none());
    }

    /// The one path this module mirrors rather than reads off `compile.rs`.
    /// A drift here sends somebody to a file the archive does not hold.
    #[test]
    fn a_language_edits_file_is_the_one_the_compiler_wrote() {
        let project = project(json!({
            "text": { "armcom": { "en": { "name": "Commander" } } }
        }));
        let ledger = build_ledger(&project);
        let traced = &changes_for(&ledger, "armcom")[0].files[0];
        assert!(
            compile(&project).files.iter().any(|f| &f.path == traced),
            "the ledger names {traced}, which the compiler did not write"
        );
    }

    /// A language code that cannot be a folder name is left out of the
    /// compile, and the ledger agrees rather than naming a file.
    #[test]
    fn a_name_edit_in_an_impossible_language_is_reported_as_left_out() {
        let ledger = build_ledger(&project(json!({
            "text": { "armcom": { "../evil": { "name": "Commander" } } }
        })));
        let changes = changes_for(&ledger, "armcom");
        assert_eq!(changes.len(), 1);
        assert!(changes[0].files.is_empty());
        assert!(changes[0].uncompiled_reason.is_some());
    }

    /// A copy whose key cannot be a unit name is left out of the compile
    /// entirely (`compile::valid_unit_key`), and the ledger has to agree
    /// rather than claiming it reached a file.
    #[test]
    fn a_copy_with_an_invalid_key_is_reported_as_left_out() {
        let ledger = build_ledger(&project(json!({
            "clones": { "../evil": {
                "key": "../evil", "replacesGameUnit": false, "def": { "maxDamage": 1 }
            } }
        })));
        let changes = changes_for(&ledger, "../evil");
        assert_eq!(changes.len(), 1);
        assert!(changes[0].files.is_empty());
        assert!(changes[0].uncompiled_reason.is_some());
    }

    /// A project with nothing recorded traces to nothing, the same empty
    /// answer `compile::compile` gives it.
    #[test]
    fn an_empty_project_traces_to_an_empty_ledger() {
        let ledger = build_ledger(&project(json!({})));
        assert!(ledger.units.is_empty());
        assert!(ledger.notes.is_empty());
    }

    /// Running the trace twice over the same project must agree with itself,
    /// the same determinism `compile::compile`'s own test holds it to.
    #[test]
    fn tracing_twice_produces_the_same_ledger() {
        let input = project(json!({
            "overrides": { "armcom": { "maxDamage": 5 } },
            "disabled": ["armflash"],
            "menus": { "armlab": [{ "op": "add", "unit": "armpw" }] }
        }));
        let first = build_ledger(&input);
        let second = build_ledger(&input);
        assert_eq!(
            serde_json::to_string(&first).expect("json"),
            serde_json::to_string(&second).expect("json")
        );
    }

    // -- the refusal: what happens when this module's own reconstruction
    // does not match what `compile::compile` really produced. No real
    // project can reach these paths while `categorize` and `compile::compile`
    // agree, which every test above demonstrates they do, so the fallback
    // itself is exercised directly rather than left to chance.

    /// A chunk count that does not match `compile::compile`'s own is refused
    /// rather than paired up positionally anyway.
    #[test]
    fn resolve_slots_refuses_to_guess_when_the_chunk_count_disagrees() {
        let positions = vec![(PositionKey::Added, LuaForm::Table)];
        let pack = bar_pack::pack(&[]);
        assert!(resolve_slots(&positions, &[], &pack).is_none());
    }

    /// The counts can agree while the forms at a position do not, which is
    /// just as much a sign this reconstruction has drifted.
    #[test]
    fn resolve_slots_refuses_to_guess_when_a_forms_disagree() {
        let chunk = Chunk {
            form: LuaForm::Block,
            title: "1 unit added".to_string(),
            reason: "test".to_string(),
            lua: "do end".to_string(),
        };
        let chunks = [chunk];
        let pack = bar_pack::pack(&chunks);
        let positions = vec![(PositionKey::Added, LuaForm::Table)];
        assert!(resolve_slots(&positions, &chunks, &pack).is_none());
    }

    /// What a change looks like once the trace could not be verified: not
    /// silence, `unresolved`, so a reader can tell "no slot" apart from "not
    /// traced" (see `ChangeDestination` in `ChecksButton.tsx`, which reads
    /// this value and says which one it is).
    #[test]
    fn slot_fields_reports_unresolved_rather_than_silence_when_unverified() {
        let (slot, miss) = slot_fields(None, false);
        assert!(slot.is_none());
        assert_eq!(miss, Some(BarSlotMiss::Unresolved));
    }
}
