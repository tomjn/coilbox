//! The project model, as Rust reads it.
//!
//! A mirror of `src/workshop/project.ts` and the five modules beside it, not a
//! second model. The frontend holds the project, the editor writes to it, and
//! the compiler is handed the whole thing over one command, so these types
//! exist to read that JSON and nothing else. Every field name matches the
//! TypeScript one, and every store keeps the shape its own module documents:
//!
//!  - `overrides` is sparse, keyed by unit and then by dotted field path.
//!  - `clones` is whole definitions the project adds.
//!  - `menus` is ordered operations, replayed over the game's own list.
//!  - `text` is name and description for a game that keeps them in a
//!    localisation file.
//!  - `disabled` is a mark against a unit key.
//!
//! Nothing here is authoritative. If one of those modules changes shape, that
//! module is right and this file is behind.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;

/// A unit's sparse patch: dotted field path to the value the user set.
pub type UnitPatch = BTreeMap<String, Value>;

/// One unit the project adds, held as a whole definition rather than a patch.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UnitClone {
    /// Its internal name, which is its key in the game's unit table.
    pub key: String,
    /// The unit it was copied from. Absent for one built in the lego builder.
    #[serde(default)]
    pub source: Option<String>,
    /// Whether it stands in for a unit the game already has.
    #[serde(default)]
    pub replaces_game_unit: bool,
    /// The whole definition, as the game would have to read it.
    #[serde(default)]
    pub def: Value,
}

/// One change to one build menu. Unit names are lowercased def keys.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(tag = "op", rename_all = "lowercase")]
pub enum BuildMenuOp {
    Add {
        unit: String,
    },
    Remove {
        unit: String,
    },
    /// Put `unit` immediately before `before`, or on the end when it is null.
    Move {
        unit: String,
        before: Option<String>,
    },
}

/// One language's edits to one unit's words.
#[derive(Debug, Clone, Default, Deserialize, Serialize)]
pub struct TextFields {
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
}

/// Everything one project changes about one game.
#[derive(Debug, Clone, Default, Deserialize, Serialize)]
pub struct GameEdits {
    #[serde(default)]
    pub overrides: BTreeMap<String, UnitPatch>,
    #[serde(default)]
    pub clones: BTreeMap<String, UnitClone>,
    #[serde(default)]
    pub menus: BTreeMap<String, Vec<BuildMenuOp>>,
    #[serde(default)]
    pub text: BTreeMap<String, BTreeMap<String, TextFields>>,
    #[serde(default)]
    pub disabled: Vec<String>,
}

impl GameEdits {
    /// Whether the project records nothing about the game.
    pub fn is_empty(&self) -> bool {
        self.overrides.is_empty()
            && self.clones.is_empty()
            && self.menus.is_empty()
            && self.text.is_empty()
            && self.disabled.is_empty()
    }

    /// How many name and description edits the project holds, across every
    /// unit and every language. A German name and an English name are two,
    /// matching `textEditCount` in `src/workshop/unitText.ts`, so the number
    /// is the user's own count.
    pub fn text_edit_count(&self) -> usize {
        self.text
            .values()
            .flat_map(|langs| langs.values())
            .map(|fields| {
                usize::from(fields.name.is_some()) + usize::from(fields.description.is_some())
            })
            .sum()
    }
}

/// A block of Lua a project carries but does not edit (issue #1280).
///
/// A mirror of `src/workshop/readOnlyLua.ts`. What lands here came out of a
/// decoded tweak set that turned out to be a program rather than data: a
/// `tweakdefs` block full of loops and conditionals, that could be shown but
/// not safely read into any of the five editable stores. It sits on
/// `ModProject` rather than inside `GameEdits`, on purpose: `GameEdits` is the
/// five stores an edit can land in, and this is not an edit at all, only Lua
/// kept for the record. Nothing in this crate ever mutates it after a project
/// is created, and `compile.rs` never compiles it, only notes that it exists.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadOnlyLuaBlock {
    pub title: String,
    pub lua: String,
    pub note: String,
}

/// A project as the compiler is handed one.
///
/// The same fields `ModProjectPayload` carries, minus the ones nothing here
/// reads. Unknown fields are ignored, so a project shared from a later version
/// of coilbox still compiles rather than failing to parse.
#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModProject {
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    /// The base game's exact archive name, which is what `depend` names.
    #[serde(default)]
    pub game_name: String,
    #[serde(default)]
    pub edits: GameEdits,
    /// Lua the project carries read-only (issue #1280). See
    /// [`ReadOnlyLuaBlock`] for why it lives here rather than in `edits`.
    #[serde(default)]
    pub read_only_lua: Vec<ReadOnlyLuaBlock>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    /// The wire shape is the frontend's, camel case and all, so a project read
    /// out of the settings store parses without anything in between.
    #[test]
    fn a_project_parses_from_the_shape_the_frontend_holds() {
        let project: ModProject = serde_json::from_value(json!({
            "id": "abc",
            "name": "Faster commanders",
            "gameName": "Balanced Annihilation V15.9.8",
            "authoredChecksum": "deadbeef",
            "createdAt": "2026-09-01T00:00:00.000Z",
            "edits": {
                "overrides": { "armcom": { "maxDamage": 5000 } },
                "clones": {
                    "supercom": {
                        "key": "supercom",
                        "source": "armcom",
                        "replacesGameUnit": false,
                        "def": { "maxDamage": 9000 }
                    }
                },
                "menus": { "armlab": [{ "op": "move", "unit": "armpw", "before": null }] },
                "text": { "armcom": { "en": { "name": "Commander" } } },
                "disabled": ["armflash"]
            }
        }))
        .expect("parse");

        assert_eq!(project.name, "Faster commanders");
        assert_eq!(project.game_name, "Balanced Annihilation V15.9.8");
        assert_eq!(project.edits.overrides["armcom"]["maxDamage"], json!(5000));
        assert!(!project.edits.clones["supercom"].replaces_game_unit);
        assert_eq!(
            project.edits.clones["supercom"].source.as_deref(),
            Some("armcom")
        );
        assert_eq!(project.edits.disabled, vec!["armflash"]);
        assert_eq!(project.edits.text_edit_count(), 1);
    }

    /// A project that changes nothing still parses, which is what the editor
    /// holds for the whole of the first session before anything is typed.
    #[test]
    fn an_empty_project_parses_and_says_so() {
        let project: ModProject =
            serde_json::from_value(json!({ "name": "x", "gameName": "g" })).expect("parse");
        assert!(project.edits.is_empty());
    }

    #[test]
    fn the_three_menu_operations_round_trip() {
        let ops: Vec<BuildMenuOp> = serde_json::from_value(json!([
            { "op": "add", "unit": "a" },
            { "op": "remove", "unit": "b" },
            { "op": "move", "unit": "c", "before": "d" }
        ]))
        .expect("parse");
        assert_eq!(ops.len(), 3);
        assert!(matches!(&ops[0], BuildMenuOp::Add { unit } if unit == "a"));
        assert!(matches!(&ops[1], BuildMenuOp::Remove { unit } if unit == "b"));
        assert!(matches!(&ops[2], BuildMenuOp::Move { before: Some(b), .. } if b == "d"));
    }
}
