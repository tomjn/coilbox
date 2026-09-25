//! Writing a value the game's post-processing turns into the one the modder
//! typed, on the mutator archive route (issue #3059).
//!
//! A game's own Lua post-processes definitions as it loads them. Balanced
//! Annihilation V15.9.8 multiplies every weapon's `cratermult` by 0.3, once
//! in `unitdefs_post.lua` and again in `weapondefs_post.lua`, so a crater
//! multiplier of 0.5 typed on a copy of the Big Bertha loads as 0.045. What
//! the game does to a typed value depends on the route as well as the game:
//! the same 0.5 loads as 0.15 once the mutator ships its own
//! `gamedata/unitdefs_post.lua`, which covers the game's (`postHook.ts`).
//!
//! So nothing here is worked out from the game alone. [`settle`] compiles the
//! project, loads the game with the compiled files on top, and reads each
//! typed number back. For a field that loads as something else it loads once
//! more with a second value, fits a straight line through the two, and
//! writes the value that line says loads as the typed one. Then it loads that
//! and checks the game ends up with exactly the typed value. Where it does
//! not, it moves the written value toward it while the gap keeps shrinking,
//! and gives up on the field when it stops shrinking. A post file can clamp,
//! round or branch, so two points on a line are a guess and only the last
//! load is proof. Every claim in the answer comes from that last load of the
//! exact files the mutator will carry.
//!
//! The load itself is somebody else's. [`settle`] is handed a function that
//! loads a game with some files on top and reads some values, which is the
//! unitsync worker's `--defs-probe` mode in the app and a Lua VM over a
//! game's files in the tests. The worker runs the engine's own Lua, which
//! holds numbers as 32 bit floats, so [`Precision`] says which grid a written
//! value has to sit on.
//!
//! Only the mutator route. Beyond All Reason's tweak slots and the edit in
//! place route still write the typed value, and the note beside the field
//! says so.

use crate::compile::{compile, equip_at, CompiledMod};
use crate::model::ModProject;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;

/// Which of the game's two loaded tables a read is in.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DefTable {
    Units,
    Weapons,
}

/// One value to read out of a loaded game.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProbeRead {
    pub table: DefTable,
    /// The definition's name in that table, compared without regard to case.
    pub key: String,
    /// Steps into the definition, spelled the way the project's overrides
    /// spell them: a list position counted from zero, any other key compared
    /// without regard to case.
    pub path: Vec<String>,
    /// The typed value. The loader compares with it in the game's own number
    /// type, which is what "loads as the typed value" means.
    pub expect: f64,
}

/// A file on top of the game, the way a mutator's file covers the game's.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ProbeFile {
    pub path: String,
    pub contents: String,
}

/// One load of the game with `files` on top, and what to read out of it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ProbeRun {
    pub files: Vec<ProbeFile>,
    pub reads: Vec<ProbeRead>,
}

/// What one read found.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct ProbeReading {
    /// The loaded value, exactly. `None` when there is no number there.
    pub value: Option<f64>,
    /// Whether it equals [`ProbeRead::expect`] in the game's number type.
    pub equal: bool,
}

/// What one load found: a reading per read, in order, or why it failed.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct ProbeResult {
    pub reads: Vec<ProbeReading>,
    pub error: Option<String>,
}

/// The number type the game loads a value into.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Precision {
    /// The engine's Lua: `LUA_NUMBER` is `float` (`rts/lib/lua/include/luaconf.h`).
    F32,
    /// A stock Lua 5.1, which the tests load with.
    F64,
}

impl Precision {
    fn round(self, x: f64) -> f64 {
        match self {
            Precision::F32 => f64::from(x as f32),
            Precision::F64 => x,
        }
    }

    /// The next value up or down from `x` that this type can hold.
    fn step(self, x: f64, up: bool) -> f64 {
        match self {
            Precision::F32 => {
                let x = x as f32;
                f64::from(if up { x.next_up() } else { x.next_down() })
            }
            Precision::F64 => {
                if up {
                    x.next_up()
                } else {
                    x.next_down()
                }
            }
        }
    }
}

/// One number the modder typed.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum TypedField {
    /// A field change on a game unit or a copy, in `edits.overrides`.
    Unit { unit: String, path: String },
    /// A change to a library weapon, in `edits.weapons[weapon].changes`.
    Weapon { weapon: String, path: String },
}

/// A value to write in place of a typed one.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct WrittenValue {
    /// What the modder typed, so a project changed since is not written over.
    pub typed: Value,
    pub written: f64,
}

/// Values to write in place of typed ones, on the mutator route. Empty is
/// the ordinary case, and writes every value as typed.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct Written {
    /// Unit, then dotted path, as `edits.overrides` keys them.
    #[serde(skip_serializing_if = "BTreeMap::is_empty")]
    pub units: BTreeMap<String, BTreeMap<String, WrittenValue>>,
    /// Library weapon, then dotted path, as its `changes` keys them.
    #[serde(skip_serializing_if = "BTreeMap::is_empty")]
    pub weapons: BTreeMap<String, BTreeMap<String, WrittenValue>>,
}

impl Written {
    pub fn is_empty(&self) -> bool {
        self.units.is_empty() && self.weapons.is_empty()
    }

    fn insert(&mut self, field: &TypedField, typed: f64, written: f64) {
        let (map, key, path) = match field {
            TypedField::Unit { unit, path } => (&mut self.units, unit, path),
            TypedField::Weapon { weapon, path } => (&mut self.weapons, weapon, path),
        };
        map.entry(key.clone()).or_default().insert(
            path.clone(),
            WrittenValue {
                typed: number(typed),
                written,
            },
        );
    }
}

fn number(x: f64) -> Value {
    serde_json::Number::from_f64(x).map_or(Value::Null, Value::Number)
}

/// `project` with each written value in place of the typed one it was worked
/// out for. A value the project no longer holds is skipped, so a stale
/// answer writes the typed value rather than one worked out for another.
pub fn with_written(project: &ModProject, written: &Written) -> ModProject {
    let mut out = project.clone();
    let swap = |slot: Option<&mut Value>, value: &WrittenValue| {
        if let Some(slot) = slot {
            if slot.as_f64().is_some() && slot.as_f64() == value.typed.as_f64() {
                *slot = number(value.written);
            }
        }
    };
    for (unit, paths) in &written.units {
        let mut patch = out.edits.overrides.get_mut(unit);
        for (path, value) in paths {
            swap(patch.as_mut().and_then(|p| p.get_mut(path)), value);
        }
    }
    for (key, paths) in &written.weapons {
        let mut weapon = out.edits.weapons.get_mut(key);
        for (path, value) in paths {
            swap(weapon.as_mut().and_then(|w| w.changes.get_mut(path)), value);
        }
    }
    out
}

/// Compile `project` for the mutator route, with `written` in place.
pub fn compile_written(project: &ModProject, written: &Written) -> CompiledMod {
    if written.is_empty() {
        compile(project)
    } else {
        compile(&with_written(project, written))
    }
}

/// Where the game keeps one typed number once it has loaded.
#[derive(Debug, Clone, PartialEq)]
struct Place {
    table: DefTable,
    key: String,
    path: Vec<String>,
}

/// A typed number and every place the game keeps it.
#[derive(Debug, Clone)]
struct Field {
    field: TypedField,
    typed: f64,
    places: Vec<Place>,
}

/// A weapon slot's `def` and `name` are names, not numbers, and a post file
/// turns the first into the second.
fn a_slot_name(path: &str) -> bool {
    let steps: Vec<String> = path.split('.').map(str::to_lowercase).collect();
    steps.len() == 3 && steps[0] == "weapons" && (steps[2] == "def" || steps[2] == "name")
}

fn steps(path: &str) -> Vec<String> {
    path.split('.').map(str::to_string).collect()
}

/// Where the game keeps a unit field. A weapon the unit carries is read out
/// of the shared weapon table under `<unit>_<name>`, the name the base
/// content's `weapondefs_post.lua` gives it, because that entry is what the
/// engine fires and a game's weapon post file may change it after the unit's.
fn unit_place(unit: &str, path: &str) -> Place {
    let all = steps(path);
    if all.len() >= 3 && all[0].eq_ignore_ascii_case("weapondefs") {
        return Place {
            table: DefTable::Weapons,
            key: format!("{}_{}", unit.to_lowercase(), all[1].to_lowercase()),
            path: all[2..].to_vec(),
        };
    }
    Place {
        table: DefTable::Units,
        key: unit.to_lowercase(),
        path: all,
    }
}

/// Every number the project typed that reaches the game, with the places the
/// game keeps it. A library weapon reaches it once per slot or death
/// explosion that fires it, under the name the compiler gives it there.
fn typed_fields(project: &ModProject) -> Vec<Field> {
    let edits = &project.edits;
    let mut out = Vec::new();
    for (unit, patch) in &edits.overrides {
        for (path, value) in patch {
            let Some(typed) = value.as_f64() else {
                continue;
            };
            if a_slot_name(path) {
                continue;
            }
            out.push(Field {
                field: TypedField::Unit {
                    unit: unit.clone(),
                    path: path.clone(),
                },
                typed,
                places: vec![unit_place(unit, path)],
            });
        }
    }
    for (key, weapon) in &edits.weapons {
        let mounts: Vec<String> = edits
            .equipped
            .iter()
            .flat_map(|(unit, slots)| {
                slots
                    .iter()
                    .filter(|(step, fires)| *fires == key && equip_at(step).is_some())
                    .map(move |_| crate::compile::death_name(unit, key))
            })
            .collect();
        if mounts.is_empty() {
            continue;
        }
        for (path, value) in &weapon.changes {
            let Some(typed) = value.as_f64() else {
                continue;
            };
            out.push(Field {
                field: TypedField::Weapon {
                    weapon: key.clone(),
                    path: path.clone(),
                },
                typed,
                places: mounts
                    .iter()
                    .map(|name| Place {
                        table: DefTable::Weapons,
                        key: name.clone(),
                        path: steps(path),
                    })
                    .collect(),
            });
        }
    }
    out
}

/// What became of one typed number.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Outcome {
    /// It loads as typed with nothing done to it.
    AsTyped,
    /// Another value is written, and it loads as the typed one.
    Written,
    /// It is written as typed, and the game loads something else.
    Unproven,
    /// The game has no number where the field should be, so it is written as
    /// typed and nothing is claimed about it.
    Unread,
}

/// One typed number, what the game loads it as, and what was done about it.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FieldReport {
    pub field: TypedField,
    pub typed: f64,
    /// What the game loads when the typed value is written, from the first
    /// load. `None` where [`Outcome::Unread`].
    pub loads_as_typed: Option<f64>,
    pub outcome: Outcome,
    /// The value written in its place, for [`Outcome::Written`].
    #[serde(skip_serializing_if = "Option::is_none")]
    pub written: Option<f64>,
    /// Why, in a sentence, for [`Outcome::Unproven`] and [`Outcome::Unread`].
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

/// What [`settle`] worked out.
#[derive(Debug, Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Settled {
    /// What to hand the mutator route's compile.
    pub written: Written,
    pub fields: Vec<FieldReport>,
    /// How many times the game was loaded.
    pub loads: usize,
}

const UNREAD: &str = "Coilbox could not find this number in the game's loaded definitions, so it is written as typed.";
const FLAT: &str = "The game loads the same value here whatever is typed, so no value can load as the typed one. It is written as typed.";
const PROBE_FAILED: &str =
    "The game did not load with a trial value here, so it is written as typed.";
const NO_EXACT: &str =
    "No value coilbox tried loads as exactly the typed one, so it is written as typed.";
const CHANGED_BY_ANOTHER: &str =
    "Another value coilbox writes changes what this one loads as, so it is written as typed.";

/// A field being worked on.
struct Trial {
    /// The value written in its place.
    x: f64,
    /// How much the loaded value moves per unit written.
    slope: f64,
    /// The smallest gap to the typed value seen so far, once there is one.
    best: Option<f64>,
}

type Loader<'a> = dyn FnMut(&[ProbeRun]) -> Result<Vec<ProbeResult>, String> + 'a;

/// Work out, for every number the project typed, a value that the game loads
/// as that number on the mutator route, and prove it by loading it.
///
/// Fails only when the game will not load with the project as typed. That is
/// a fact about the project or the game, not about any one field, and the
/// caller writes every value as typed.
pub fn settle(
    project: &ModProject,
    precision: Precision,
    load: &mut Loader<'_>,
) -> Result<Settled, String> {
    let fields = typed_fields(project);
    let mut settled = Settled::default();
    if fields.is_empty() {
        return Ok(settled);
    }
    let typed: Vec<f64> = fields.iter().map(|f| precision.round(f.typed)).collect();

    // The project as typed.
    let first = load_once(project, &fields, &BTreeMap::new(), load, &mut settled)
        .map_err(|e| format!("the game did not load with this project: {e}"))?;
    let mut reasons: BTreeMap<usize, &'static str> = BTreeMap::new();
    let mut loads_as_typed: Vec<Option<f64>> = Vec::new();
    let mut wrong = Vec::new();
    for (i, readings) in first.iter().enumerate() {
        loads_as_typed.push(readings.first().and_then(|r| r.value));
        if readings.iter().any(|r| r.value.is_none()) {
            reasons.insert(i, UNREAD);
        } else if !readings.iter().all(|r| r.equal) {
            wrong.push(i);
        }
    }

    // A second value for each field that loads as something else, to see how
    // the loaded value follows the written one.
    let mut trials: BTreeMap<usize, Trial> = BTreeMap::new();
    if !wrong.is_empty() {
        let probe: BTreeMap<usize, f64> = wrong
            .iter()
            .map(|&i| (i, precision.round(second_value(fields[i].typed))))
            .collect();
        match load_once(project, &fields, &probe, load, &mut settled) {
            Err(_) => {
                for &i in &wrong {
                    reasons.insert(i, PROBE_FAILED);
                }
            }
            Ok(second) => {
                for &i in &wrong {
                    let (Some(y0), Some(y1)) = (loads_as_typed[i], second[i][0].value) else {
                        reasons.insert(i, PROBE_FAILED);
                        continue;
                    };
                    let x0 = fields[i].typed;
                    let slope = (y1 - y0) / (probe[&i] - x0);
                    let x = precision.round(x0 + (typed[i] - y0) / slope);
                    if slope == 0.0 || !slope.is_finite() || !x.is_finite() {
                        reasons.insert(i, FLAT);
                        continue;
                    }
                    trials.insert(
                        i,
                        Trial {
                            x,
                            slope,
                            best: None,
                        },
                    );
                }
            }
        }
    }

    // Load what would be written and check it, moving each written value
    // toward the typed one while the gap shrinks. A field whose gap stops
    // shrinking goes back to typed, so every round either proves the lot or
    // gives something up, and this ends.
    let mut last = first.clone();
    while !trials.is_empty() {
        let values: BTreeMap<usize, f64> = trials.iter().map(|(&i, t)| (i, t.x)).collect();
        let Ok(readings) = load_once(project, &fields, &values, load, &mut settled) else {
            for i in std::mem::take(&mut trials).into_keys() {
                reasons.insert(i, NO_EXACT);
            }
            break;
        };
        let mut moved = false;
        let mut dropped = Vec::new();
        for (&i, trial) in trials.iter_mut() {
            let Some(miss) = readings[i].iter().find(|r| !r.equal) else {
                continue;
            };
            moved = true;
            let Some(value) = miss.value else {
                dropped.push(i);
                continue;
            };
            let gap = value - typed[i];
            if trial.best.is_some_and(|best| gap.abs() >= best) {
                dropped.push(i);
                continue;
            }
            trial.best = Some(gap.abs());
            let step = -gap / trial.slope;
            let next = precision.round(trial.x + step);
            trial.x = if next == trial.x || !next.is_finite() {
                precision.step(trial.x, step > 0.0)
            } else {
                next
            };
        }
        for i in dropped {
            trials.remove(&i);
            reasons.insert(i, NO_EXACT);
        }
        if !moved {
            last = readings;
            break;
        }
        if trials.is_empty() {
            last = first.clone();
        }
    }

    for (i, field) in fields.iter().enumerate() {
        let proven = last[i].iter().all(|r| r.equal) && !reasons.contains_key(&i);
        let (outcome, written, reason) = match (trials.get(&i), proven) {
            (Some(trial), true) => (Outcome::Written, Some(trial.x), None),
            (None, true) => (Outcome::AsTyped, None, None),
            _ => match reasons.get(&i) {
                Some(&UNREAD) => (Outcome::Unread, None, Some(UNREAD)),
                Some(reason) => (Outcome::Unproven, None, Some(*reason)),
                None => (Outcome::Unproven, None, Some(CHANGED_BY_ANOTHER)),
            },
        };
        if let Some(x) = written {
            settled.written.insert(&field.field, field.typed, x);
        }
        settled.fields.push(FieldReport {
            field: field.field.clone(),
            typed: field.typed,
            loads_as_typed: loads_as_typed[i],
            outcome,
            written,
            reason: reason.map(str::to_string),
        });
    }
    Ok(settled)
}

/// A second value to write, to see how the loaded value follows the first.
fn second_value(typed: f64) -> f64 {
    if typed == 0.0 {
        1.0
    } else {
        typed * 2.0
    }
}

/// Load the game once with the project compiled for the mutator route, each
/// field in `values` written in place of its typed value, and read every
/// field back. The readings come back per field, one per place.
fn load_once(
    project: &ModProject,
    fields: &[Field],
    values: &BTreeMap<usize, f64>,
    load: &mut Loader<'_>,
    settled: &mut Settled,
) -> Result<Vec<Vec<ProbeReading>>, String> {
    let mut written = Written::default();
    for (&i, &x) in values {
        written.insert(&fields[i].field, fields[i].typed, x);
    }
    let files = compile_written(project, &written)
        .files
        .into_iter()
        .map(|f| ProbeFile {
            path: f.path,
            contents: f.contents,
        })
        .collect();
    let reads: Vec<ProbeRead> = fields
        .iter()
        .flat_map(|f| {
            f.places.iter().map(|p| ProbeRead {
                table: p.table,
                key: p.key.clone(),
                path: p.path.clone(),
                expect: f.typed,
            })
        })
        .collect();
    let count = reads.len();
    settled.loads += 1;
    let result = load(&[ProbeRun { files, reads }])?
        .into_iter()
        .next()
        .ok_or_else(|| "the loader answered with nothing".to_string())?;
    if let Some(e) = result.error {
        return Err(e);
    }
    if result.reads.len() != count {
        return Err(format!(
            "the loader answered {} reads of {count}",
            result.reads.len()
        ));
    }
    let mut readings = result.reads.into_iter();
    Ok(fields
        .iter()
        .map(|f| readings.by_ref().take(f.places.len()).collect())
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn project(edits: Value) -> ModProject {
        serde_json::from_value(
            json!({ "name": "TEST (delete me)", "gameName": "g", "edits": edits }),
        )
        .expect("parse")
    }

    /// A loader over a game that post-processes one number, `f`, and reads
    /// the typed value back out of the compiled post file.
    fn game(
        f: impl Fn(f64) -> f64,
        precision: Precision,
    ) -> impl FnMut(&[ProbeRun]) -> Result<Vec<ProbeResult>, String> {
        move |runs: &[ProbeRun]| {
            Ok(runs
                .iter()
                .map(|run| {
                    let post = run
                        .files
                        .iter()
                        .find(|file| file.path == "gamedata/unitdefs_post.lua")
                        .expect("a post file");
                    let typed: f64 = post
                        .contents
                        .split("maxdamage")
                        .nth(1)
                        .and_then(|rest| rest.split('=').nth(1))
                        .and_then(|rest| rest.trim_start().split([',', '\n', ' ', '}']).next())
                        .and_then(|n| n.parse().ok())
                        .expect("a maxdamage");
                    let value = precision.round(f(precision.round(typed)));
                    ProbeResult {
                        reads: run
                            .reads
                            .iter()
                            .map(|read| ProbeReading {
                                value: Some(value),
                                equal: value == precision.round(read.expect),
                            })
                            .collect(),
                        error: None,
                    }
                })
                .collect())
        }
    }

    fn one(settled: &Settled) -> &FieldReport {
        assert_eq!(settled.fields.len(), 1);
        &settled.fields[0]
    }

    #[test]
    fn a_value_the_game_scales_is_written_so_it_loads_as_typed() {
        let p = project(json!({ "overrides": { "armcom": { "maxdamage": 0.5 } } }));
        for precision in [Precision::F32, Precision::F64] {
            let scale = |x: f64| precision.round(precision.round(x * 0.3) * 0.3);
            let settled = settle(&p, precision, &mut game(scale, precision)).expect("settle");
            let report = one(&settled);
            assert_eq!(report.outcome, Outcome::Written, "{precision:?}");
            let x = report.written.expect("a written value");
            assert_eq!(scale(x), precision.round(0.5), "{precision:?}");
            assert_eq!(
                settled.written.units["armcom"]["maxdamage"].written, x,
                "{precision:?}"
            );
            assert!(settled.loads >= 3, "typed, a second value and a check");
        }
    }

    #[test]
    fn a_value_the_game_leaves_alone_is_left_alone_after_one_load() {
        let p = project(json!({ "overrides": { "armcom": { "maxdamage": 3000 } } }));
        let settled = settle(&p, Precision::F32, &mut game(|x| x, Precision::F32)).expect("settle");
        assert_eq!(one(&settled).outcome, Outcome::AsTyped);
        assert!(settled.written.is_empty());
        assert_eq!(settled.loads, 1);
    }

    #[test]
    fn a_value_the_game_clamps_stays_as_typed() {
        let p = project(json!({ "overrides": { "armcom": { "maxdamage": 5000 } } }));
        let settled = settle(
            &p,
            Precision::F32,
            &mut game(|x| x.min(4000.0), Precision::F32),
        )
        .expect("settle");
        let report = one(&settled);
        assert_eq!(report.outcome, Outcome::Unproven);
        assert_eq!(report.reason.as_deref(), Some(FLAT));
        assert!(settled.written.is_empty());
    }

    /// A game that rounds to whole numbers leaves nothing that loads as 2.5,
    /// and the written value goes back to typed once the gap stops closing.
    #[test]
    fn a_value_no_written_value_reaches_stays_as_typed() {
        let p = project(json!({ "overrides": { "armcom": { "maxdamage": 2.5 } } }));
        let settled = settle(
            &p,
            Precision::F32,
            &mut game(|x| (x * 3.0).round(), Precision::F32),
        )
        .expect("settle");
        let report = one(&settled);
        assert_eq!(report.outcome, Outcome::Unproven);
        assert!(settled.written.is_empty());
    }

    #[test]
    fn a_project_the_game_will_not_load_is_an_error() {
        let p = project(json!({ "overrides": { "armcom": { "maxdamage": 1 } } }));
        let err = settle(&p, Precision::F32, &mut |_: &[ProbeRun]| {
            Ok(vec![ProbeResult {
                reads: Vec::new(),
                error: Some("defs.lua: boom".into()),
            }])
        })
        .expect_err("an error");
        assert!(err.contains("boom"), "{err}");
    }

    #[test]
    fn a_project_with_no_typed_number_loads_nothing() {
        let p = project(json!({ "overrides": { "armcom": { "name": "Big" } } }));
        let settled = settle(&p, Precision::F32, &mut |_: &[ProbeRun]| {
            panic!("nothing to load")
        })
        .expect("settle");
        assert!(settled.fields.is_empty());
    }

    #[test]
    fn a_written_value_is_skipped_once_the_project_changes_the_field() {
        let p = project(json!({ "overrides": { "armcom": { "maxdamage": 0.5 } } }));
        let mut written = Written::default();
        written.insert(
            &TypedField::Unit {
                unit: "armcom".into(),
                path: "maxdamage".into(),
            },
            0.5,
            5.5,
        );
        assert_eq!(
            with_written(&p, &written).edits.overrides["armcom"]["maxdamage"],
            json!(5.5)
        );
        let changed = project(json!({ "overrides": { "armcom": { "maxdamage": 0.7 } } }));
        assert_eq!(
            with_written(&changed, &written).edits.overrides["armcom"]["maxdamage"],
            json!(0.7)
        );
    }

    /// A weapon a unit carries is read out of the shared weapon table, a
    /// library weapon once per unit that fires it, and a slot's name not at
    /// all.
    #[test]
    fn each_typed_number_is_read_where_the_engine_reads_it() {
        let p = project(json!({
            "overrides": { "armbrtha2": {
                "weapondefs.arm_berthacannon.cratermult": 0.5,
                "weapons.0.def": "X",
            } },
            "weapons": { "gun": { "key": "gun", "def": {}, "changes": { "range": 900 } } },
            "equipped": { "armcom": { "0": "gun" }, "corcom": { "explodeas": "gun" } },
        }));
        let fields = typed_fields(&p);
        assert_eq!(fields.len(), 2);
        assert_eq!(
            fields[0].places,
            vec![Place {
                table: DefTable::Weapons,
                key: "armbrtha2_arm_berthacannon".into(),
                path: vec!["cratermult".into()],
            }]
        );
        let names: Vec<&str> = fields[1].places.iter().map(|p| p.key.as_str()).collect();
        assert_eq!(names, vec!["armcom_gun", "corcom_gun"]);
    }
}
