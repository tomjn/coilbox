//! What a game's own post-processing changed in each definition (issue #3054).
//!
//! The unit editor reads every definition after the game's
//! `gamedata/unitdefs_post.lua` and `gamedata/weapondefs_post.lua` have run,
//! because those are the values the engine runs. A copy made from one of them
//! goes back into the game as a new definition, and the game's post-processing
//! then runs over it a second time. Balanced Annihilation V15.9.8 multiplies
//! every weapon's `cratermult` by 0.3 there, so a copy of a weapon whose file
//! says 0.1 would hold the 0.009 the game ended with, and load as 0.00081.
//!
//! So the worker also keeps the tables as they stood just before the post files
//! ran, and this module works out the difference: for each definition, the
//! value the game's own files give at every path the post files changed or
//! removed, and every path they added. A copy carries that difference, and the
//! compiler puts the files' values back before the game runs its
//! post-processing, which then does to the copy exactly what it did to the
//! source.
//!
//! Only the difference travels, not a second copy of every table. Most of a
//! definition is untouched by post-processing, and the read is cached and sent
//! to the page whole.
//!
//! Self-contained on purpose, with no `crate::` path in it: the workshop
//! plugin's tests include this file by path, so the Lua runtime test checks the
//! compiler against the same difference the worker hands the page.

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::collections::BTreeMap;

/// What post-processing did to one definition.
///
/// Paths are dotted, as the project's overrides write them: a list position
/// counted from zero, and every other key in the spelling the post-processed
/// table uses. A key the post files removed is written in the spelling of the
/// game's own file, since the post-processed table has none.
#[derive(Serialize, Deserialize, Default, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct PostChange {
    /// The game's own value at each path the post files changed or removed.
    #[serde(skip_serializing_if = "BTreeMap::is_empty")]
    pub values: BTreeMap<String, Value>,
    /// Each path the post files added, which the game's own files do not have.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub added: Vec<String>,
}

impl PostChange {
    pub fn is_empty(&self) -> bool {
        self.values.is_empty() && self.added.is_empty()
    }
}

/// What post-processing changed, for every unit and weapon it changed.
///
/// A definition it left alone has no entry. `None` in place of the whole thing
/// (see `UnitDefsOutput::before_post`) says the game's loader never ran a post
/// file by the usual name, so there was nothing to take a copy before.
#[derive(Serialize, Deserialize, Default, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct BeforePost {
    /// By unit, keyed the way the post-processed unit table keys it.
    pub units: BTreeMap<String, PostChange>,
    /// By weapon, keyed the way the post-processed weapon table keys it. A
    /// weapon a unit carries is keyed `<unit>_<name>`, the name the base
    /// content's `weapondefs_post.lua` gives it in the shared table.
    pub weapon_defs: BTreeMap<String, PostChange>,
}

impl BeforePost {
    /// Compare the tables after post-processing with the copies taken before.
    ///
    /// `raw_weapons` is the shared weapon table as it stood when the game's
    /// `weapondefs_post.lua` was about to run, which holds the weapons out of
    /// `weapons/` and none of the ones units carry. Those are read out of each
    /// unit's own `weapondefs` in `raw_units` instead, and win where both name
    /// one weapon, as they do when the post file puts them in the shared table.
    pub fn read(
        units: &Map<String, Value>,
        weapons: &Map<String, Value>,
        raw_units: &Map<String, Value>,
        raw_weapons: &Map<String, Value>,
    ) -> Self {
        let mut out = BeforePost::default();
        for (key, raw) in raw_units {
            if let Some(post) = units.get(key) {
                insert(&mut out.units, key, post, raw);
            }
        }
        let mut raw_by_name: BTreeMap<String, &Value> = raw_weapons
            .iter()
            .map(|(k, v)| (k.to_lowercase(), v))
            .collect();
        for (unit, raw) in raw_units {
            let Some(own) = raw
                .as_object()
                .and_then(|def| field(def, "weapondefs"))
                .and_then(Value::as_object)
            else {
                continue;
            };
            for (name, def) in own {
                raw_by_name.insert(
                    format!("{}_{}", unit.to_lowercase(), name.to_lowercase()),
                    def,
                );
            }
        }
        for (key, raw) in raw_by_name {
            if let Some(post) = weapons.get(&key) {
                insert(&mut out.weapon_defs, &key, post, raw);
            }
        }
        out
    }
}

fn insert(into: &mut BTreeMap<String, PostChange>, key: &str, post: &Value, raw: &Value) {
    let change = post_change(post, raw);
    if !change.is_empty() {
        into.insert(key.to_string(), change);
    }
}

/// A table's value under `lower`, however the table spells the key.
fn field<'a>(table: &'a Map<String, Value>, lower: &str) -> Option<&'a Value> {
    table.get(lower).or_else(|| {
        table
            .iter()
            .find(|(k, _)| k.to_lowercase() == lower)
            .map(|(_, v)| v)
    })
}

/// What the post files did to one definition: `post` is what they left, and
/// `raw` is what the game's own files gave them.
pub fn post_change(post: &Value, raw: &Value) -> PostChange {
    let mut out = PostChange::default();
    walk(post, raw, "", &mut out);
    out
}

fn join(path: &str, step: &str) -> String {
    if path.is_empty() {
        step.to_string()
    } else {
        format!("{path}.{step}")
    }
}

fn walk(post: &Value, raw: &Value, path: &str, out: &mut PostChange) {
    match (post, raw) {
        (Value::Object(post), Value::Object(raw)) => walk_tables(post, raw, path, out),
        (Value::Array(post), Value::Array(raw)) if post.len() == raw.len() => {
            for (i, (p, r)) in post.iter().zip(raw).enumerate() {
                walk(p, r, &join(path, &i.to_string()), out);
            }
        }
        // A value changed, a list that grew or shrank, or a table that became
        // something else: the game's own value goes back whole. The top of a
        // definition is always a table, so `path` is never empty here.
        _ => {
            if post != raw && !path.is_empty() {
                out.values.insert(path.to_string(), raw.clone());
            }
        }
    }
}

/// Pair each key of the game's own table with the post-processed table's, the
/// same spelling first and then any spelling, since a game such as Beyond All
/// Reason lowercases every key in its post files. A key with a dot in it cannot
/// be written as a path step and is left alone, which keeps the post value
/// there.
fn walk_tables(
    post: &Map<String, Value>,
    raw: &Map<String, Value>,
    path: &str,
    out: &mut PostChange,
) {
    let mut unpaired: Vec<&String> = post.keys().filter(|k| !raw.contains_key(*k)).collect();
    for (key, raw_value) in raw {
        if key.contains('.') {
            continue;
        }
        let paired = if post.contains_key(key) {
            Some(key)
        } else {
            let lower = key.to_lowercase();
            unpaired
                .iter()
                .position(|k| k.to_lowercase() == lower)
                .map(|at| unpaired.remove(at))
        };
        match paired {
            Some(post_key) => walk(&post[post_key], raw_value, &join(path, post_key), out),
            None => {
                out.values.insert(join(path, key), raw_value.clone());
            }
        }
    }
    for key in unpaired {
        if !key.contains('.') {
            out.added.push(join(path, key));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn map(value: Value) -> Map<String, Value> {
        value.as_object().expect("an object").clone()
    }

    /// Balanced Annihilation's shape: a slot names its weapon by `def` in the
    /// file, and the post files swap that for the full `name`, and scale the
    /// crater multiplier.
    #[test]
    fn a_scaled_value_a_renamed_slot_and_an_added_key_are_all_recorded() {
        let change = post_change(
            &json!({
                "maxdamage": 3000,
                "weapons": [{ "name": "armcom_armcomlaser", "onlytargetcategory": "NOTSUB" }],
                "weapondefs": { "armcomlaser": { "cratermult": 0.009, "range": 300 } }
            }),
            &json!({
                "maxdamage": 3000,
                "weapons": [{ "def": "ARMCOMLASER", "onlytargetcategory": "NOTSUB" }],
                "weapondefs": { "armcomlaser": { "cratermult": 0.1, "range": 300 } }
            }),
        );
        assert_eq!(
            change.values,
            BTreeMap::from([
                ("weapondefs.armcomlaser.cratermult".to_string(), json!(0.1)),
                ("weapons.0.def".to_string(), json!("ARMCOMLASER")),
            ])
        );
        assert_eq!(change.added, vec!["weapons.0.name".to_string()]);
    }

    #[test]
    fn a_key_the_post_files_only_lowercased_is_not_a_change() {
        let change = post_change(
            &json!({ "bouncerebound": 0, "customparams": {} }),
            &json!({ "bounceRebound": 0 }),
        );
        assert_eq!(change.values, BTreeMap::new());
        assert_eq!(change.added, vec!["customparams".to_string()]);
    }

    #[test]
    fn a_list_that_changed_length_goes_back_whole() {
        let change = post_change(
            &json!({ "buildoptions": ["armlab"] }),
            &json!({ "buildoptions": ["armlab", "armvp"] }),
        );
        assert_eq!(change.values["buildoptions"], json!(["armlab", "armvp"]));
    }

    #[test]
    fn a_definition_post_processing_left_alone_has_no_entry() {
        let def = json!({ "maxdamage": 3000, "weapons": [{ "name": "laser" }] });
        let out = BeforePost::read(
            &map(json!({ "armcom": def })),
            &Map::new(),
            &map(json!({ "armcom": def })),
            &Map::new(),
        );
        assert!(out.units.is_empty());
    }

    /// A weapon a unit carries is compared under the name the shared table
    /// gives it, and one out of `weapons/` under its own.
    #[test]
    fn weapons_are_keyed_the_way_the_shared_table_keys_them() {
        let out = BeforePost::read(
            &map(
                json!({ "armbrtha": { "weapondefs": { "berthacannon": { "cratermult": 0.009 } } } }),
            ),
            &map(json!({
                "armbrtha_berthacannon": { "cratermult": 0.009 },
                "commander_blast": { "cratermult": 0.9 }
            })),
            &map(
                json!({ "armbrtha": { "weaponDefs": { "BerthaCannon": { "cratermult": 0.1 } } } }),
            ),
            &map(json!({ "commander_blast": { "cratermult": 3 } })),
        );
        assert_eq!(
            out.weapon_defs["armbrtha_berthacannon"].values["cratermult"],
            json!(0.1)
        );
        assert_eq!(
            out.weapon_defs["commander_blast"].values["cratermult"],
            json!(3)
        );
        assert_eq!(
            out.units["armbrtha"].values["weapondefs.berthacannon.cratermult"],
            json!(0.1)
        );
    }

    /// Serialised as the page reads it, with empty halves left out.
    #[test]
    fn serialises_in_camel_case_without_empty_halves() {
        let out = BeforePost {
            units: BTreeMap::from([(
                "armcom".to_string(),
                PostChange {
                    values: BTreeMap::from([("cratermult".to_string(), json!(1))]),
                    added: Vec::new(),
                },
            )]),
            weapon_defs: BTreeMap::new(),
        };
        assert_eq!(
            serde_json::to_value(&out).unwrap(),
            json!({ "units": { "armcom": { "values": { "cratermult": 1 } } }, "weaponDefs": {} })
        );
    }
}
