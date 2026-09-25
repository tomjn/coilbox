//! Putting a copy back the way the game's own files had it, before the game
//! post-processes it again (issue #3054).
//!
//! A copied unit or library weapon holds the values the game ended up with,
//! because that is what the page reads and shows. The game's post files run
//! over every definition a mutator adds, so a copy written out with those
//! values is post-processed twice. Its [`PostChange`] says what the post files
//! changed, and [`restore`] writes the game's own values back at those paths
//! just before the copy is compiled. The game then does to the copy exactly
//! what it did to the source.
//!
//! A path the project has changed since is left as the project has it. The
//! value the user set is what they meant, and putting the file's value back
//! under it would undo their edit.

use crate::model::PostChange;
use serde_json::Value;

/// Write the game's own values back into `def`, except where a path in
/// `edited` covers the same field.
///
/// Only into tables `def` still has. A path whose parent the project replaced
/// with something else is skipped, since there is nowhere left for the value
/// to go.
pub(crate) fn restore<'a>(
    def: &mut Value,
    change: &PostChange,
    edited: impl IntoIterator<Item = &'a str> + Clone,
) {
    let untouched = |path: &str| !edited.clone().into_iter().any(|e| overlaps(path, e));
    for (path, value) in &change.values {
        if untouched(path) {
            set(def, path, value.clone());
        }
    }
    for path in &change.added {
        if untouched(path) {
            remove(def, path);
        }
    }
}

/// Whether two paths name the same field or one lies inside the other.
///
/// Compared without regard to case, since the engine reads keys that way. A
/// weapon slot's `def` and its `name` count as one field: a game's post file
/// turns the first into the second, so a slot the user pointed somewhere else
/// by `name` must not get the file's `def` back beside it and fire that
/// instead.
fn overlaps(a: &str, b: &str) -> bool {
    let (a, b) = (steps(a), steps(b));
    a.iter().zip(&b).all(|(x, y)| x == y)
}

fn steps(path: &str) -> Vec<String> {
    let mut out: Vec<String> = path.split('.').map(str::to_lowercase).collect();
    if out.len() == 3 && out[0] == "weapons" && out[2] == "def" {
        out[2] = "name".to_string();
    }
    out
}

/// The table or list `step` names inside `value`, if there is one.
fn child<'a>(value: &'a mut Value, step: &str) -> Option<&'a mut Value> {
    match value {
        Value::Object(map) => map.get_mut(step),
        Value::Array(items) => step.parse::<usize>().ok().and_then(|i| items.get_mut(i)),
        _ => None,
    }
}

/// The container holding the last step of `path`, and that step.
fn parent<'a, 'p>(def: &'a mut Value, path: &'p str) -> Option<(&'a mut Value, &'p str)> {
    let (head, last) = match path.rsplit_once('.') {
        Some((head, last)) => (Some(head), last),
        None => (None, path),
    };
    let mut at = def;
    if let Some(head) = head {
        for step in head.split('.') {
            at = child(at, step)?;
        }
    }
    Some((at, last))
}

fn set(def: &mut Value, path: &str, value: Value) {
    let Some((container, last)) = parent(def, path) else {
        return;
    };
    match container {
        Value::Object(map) => {
            map.insert(last.to_string(), value);
        }
        Value::Array(items) => {
            if let Some(slot) = last.parse::<usize>().ok().and_then(|i| items.get_mut(i)) {
                *slot = value;
            }
        }
        _ => {}
    }
}

/// Take a key the post files added back out. Only from a table: a list entry
/// they added would come back as a list of a different length, which
/// [`PostChange::values`] carries whole instead.
fn remove(def: &mut Value, path: &str) {
    if let Some((Value::Object(map), last)) = parent(def, path) {
        map.remove(last);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::collections::BTreeMap;

    fn change(values: Value, added: &[&str]) -> PostChange {
        PostChange {
            values: serde_json::from_value::<BTreeMap<String, Value>>(values).expect("values"),
            added: added.iter().map(|s| s.to_string()).collect(),
        }
    }

    #[test]
    fn the_game_s_own_values_go_back_and_added_keys_come_out() {
        let mut def = json!({
            "weapons": [{ "name": "armcom_armcomlaser", "onlytargetcategory": "NOTSUB" }],
            "weapondefs": { "armcomlaser": { "cratermult": 0.09, "range": 300 } }
        });
        restore(
            &mut def,
            &change(
                json!({ "weapons.0.def": "ARMCOMLASER" }),
                &["weapons.0.name", "weapondefs.armcomlaser.cratermult"],
            ),
            std::iter::empty(),
        );
        assert_eq!(
            def,
            json!({
                "weapons": [{ "def": "ARMCOMLASER", "onlytargetcategory": "NOTSUB" }],
                "weapondefs": { "armcomlaser": { "range": 300 } }
            })
        );
    }

    #[test]
    fn a_field_the_project_changed_keeps_the_project_s_value() {
        let mut def = json!({ "cratermult": 0.3, "weapons": [{ "name": "a_b" }] });
        restore(
            &mut def,
            &change(
                json!({ "cratermult": 1, "weapons.0.def": "B" }),
                &["weapons.0.name"],
            ),
            ["CraterMult", "weapons.0.name"],
        );
        assert_eq!(
            def,
            json!({ "cratermult": 0.3, "weapons": [{ "name": "a_b" }] })
        );
    }

    #[test]
    fn a_table_the_project_replaced_is_left_alone() {
        let mut def = json!({ "weapondefs": "gone" });
        restore(
            &mut def,
            &change(json!({ "weapondefs.laser.cratermult": 1 }), &[]),
            std::iter::empty(),
        );
        assert_eq!(def, json!({ "weapondefs": "gone" }));
    }
}
