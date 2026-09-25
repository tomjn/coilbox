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
//!  - `weapons` is the project's weapon library, whole definitions copied out
//!    of the game under names of their own (issue #2640).
//!  - `equipped` says which unit slot fires which library weapon.
//!
//! Nothing here is authoritative. If one of those modules changes shape, that
//! module is right and this file is behind.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;

/// A unit's sparse patch: dotted field path to the value the user set.
pub type UnitPatch = BTreeMap<String, Value>;

/// Whether a field path goes through a list position: a step of nothing but
/// digits, which is how `overrides.ts` writes one. Which entry that step is
/// depends on the game's own table (issue #3041), so every route that
/// carries such a change reads the table before it writes.
pub(crate) fn through_a_position(path: &str) -> bool {
    path.split('.')
        .any(|step| !step.is_empty() && step.bytes().all(|b| b.is_ascii_digit()))
}

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
    /// What the game's own post-processing changed in `def` (issue #3054).
    /// Absent for a copy made before coilbox could tell.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub before_post: Option<PostChange>,
}

/// What a game's post files changed in one definition, a mirror of
/// `PostChange` in `src/workshop/beforePost.ts` and of the unitsync worker's
/// read of it (`beforepost.rs`).
///
/// A copy's definition holds the values the game ended up with, which is what
/// the page shows. The game runs its post-processing again over anything a
/// mutator adds, so the compiler writes these back first: `values` are the
/// game's own values at each path the post files changed or removed, and
/// `added` the paths they added.
#[derive(Debug, Clone, Default, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct PostChange {
    pub values: BTreeMap<String, Value>,
    pub added: Vec<String>,
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

/// One weapon in the project's library (issue #2640), a mirror of
/// `LibraryWeapon` in `src/workshop/weaponLibrary.ts`.
///
/// A whole definition copied out of the game's weapon table under a name of
/// its own, plus the sparse changes made to it since. It reaches the game only
/// through a slot that [`GameEdits::equipped`] points at it.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryWeapon {
    /// Its short name, which is its key in a unit's own `weapondefs`.
    pub key: String,
    /// The game weapon it was copied from, lowercased as the game's table
    /// keys it. Kept for the drift check (issue #1281), never compiled.
    #[serde(default)]
    pub source: Option<String>,
    /// The game's checksum when it was copied, for the same reason.
    #[serde(default)]
    pub source_checksum: Option<String>,
    /// The definition as it was copied.
    #[serde(default)]
    pub def: Value,
    /// Dotted paths into `def` and the values the user set since.
    #[serde(default)]
    pub changes: BTreeMap<String, Value>,
    /// What the game's own post-processing changed in `def` (issue #3054).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub before_post: Option<PostChange>,
}

/// A unit's armour class, when the project has moved it out of the one the
/// game's own `gamedata/armordefs.lua` puts it in (issue #2645), a mirror of
/// `ArmorClasses` in `src/workshop/armorClasses.ts`.
///
/// The engine assigns a unit's class purely from which class's membership list
/// in that one file names it, and `compile::compile` is handed the project
/// alone, never the game (its own doc comment). So the moment the project
/// moves its first unit, the frontend takes a snapshot of the game's whole
/// table into `base`, and every move after that is read against the snapshot
/// rather than the game, the same way a copied weapon in the library is read
/// against the copy it was made from rather than the game's weapon of today.
#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ArmorClasses {
    /// The game's own class membership at the moment of the first move: class
    /// name to the unit def keys it lists as members, exactly as the game
    /// wrote them.
    pub base: BTreeMap<String, Vec<String>>,
    /// Unit key to the class name the project moves it to. A unit named here
    /// is taken out of whichever of `base`'s lists names it and put in this
    /// one instead. A target of `"default"` (case insensitive) takes it out of
    /// every list, which is the engine's own catch-all class and needs no
    /// list of its own.
    pub moves: BTreeMap<String, String>,
}

impl ArmorClasses {
    /// Whether the project moves anything at all. `base` on its own compiles
    /// to nothing, so it does not count.
    pub fn is_empty(&self) -> bool {
        self.moves.is_empty()
    }
}

/// The three classes a spawn can be (issue #2643), a mirror of `SpawnClass`
/// in `src/workshop/explosionGenerators.ts`. Named exactly as the engine
/// spells the class (`rts/Rendering/Env/Particles/Classes/*.cpp`), which is
/// also the value `compile.rs` writes into a spawn's `class` field.
/// `CStandardGroundFlash` is not one of them: it is [`GroundFlash`] instead,
/// matching the engine's own reserved `groundflash` key
/// (`rts/Rendering/GroundFlash.cpp`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[allow(clippy::enum_variant_names)]
pub enum SpawnClass {
    CBitmapMuzzleFlame,
    CSimpleParticleSystem,
    CHeatCloudProjectile,
}

/// A constant colour, 0 to 1 per channel, a mirror of `CegColor`.
#[derive(Debug, Clone, Copy, Deserialize, Serialize)]
pub struct CegColor {
    pub r: f64,
    pub g: f64,
    pub b: f64,
}

/// One spawn: one of the three particle classes, fired some number of times
/// and gated on what was actually hit, a mirror of `ExplosionSpawn` in
/// `src/workshop/explosionGenerators.ts`.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExplosionSpawn {
    pub class: SpawnClass,
    #[serde(default = "default_ceg_count")]
    pub count: u32,
    #[serde(default)]
    pub ground: bool,
    #[serde(default)]
    pub water: bool,
    #[serde(default)]
    pub air: bool,
    #[serde(default)]
    pub underwater: bool,
    #[serde(default)]
    pub texture: Option<String>,
    #[serde(default)]
    pub color: Option<CegColor>,
    #[serde(default)]
    pub size: Option<f64>,
    #[serde(default)]
    pub lifetime: Option<f64>,
    #[serde(default)]
    pub particles: Option<u32>,
}

fn default_ceg_count() -> u32 {
    1
}

/// A generator's optional ground flash: the engine's reserved `groundflash`
/// key, which takes neither a repeat count nor the gating flags a spawn
/// does, a mirror of `GroundFlash` in `explosionGenerators.ts`.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GroundFlash {
    #[serde(default)]
    pub color: Option<CegColor>,
    #[serde(default)]
    pub size: Option<f64>,
    #[serde(default)]
    pub lifetime: Option<f64>,
}

/// One custom explosion generator: a list of spawns, plus an optional ground
/// flash and the engine's `useDefaultExplosions` toggle, written as
/// `effects/<key>.lua` (issues #2643 and #3066), a mirror of
/// `ExplosionGenerator` in `src/workshop/explosionGenerators.ts`.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExplosionGenerator {
    pub key: String,
    #[serde(default)]
    pub spawns: Vec<ExplosionSpawn>,
    #[serde(default)]
    pub ground_flash: Option<GroundFlash>,
    #[serde(default)]
    pub use_default_explosions: bool,
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
    /// The weapon library, by key (issue #2640). Absent on a project saved
    /// before it, which reads as empty.
    #[serde(default)]
    pub weapons: BTreeMap<String, LibraryWeapon>,
    /// Unit key, then the slot's step as `weaponSlots.ts` writes it, then the
    /// library weapon that slot fires. The step can also be `explodeas` or
    /// `selfdestructas`, for a library weapon the unit explodes as when it dies
    /// or self-destructs (issue #2642).
    #[serde(default)]
    pub equipped: BTreeMap<String, BTreeMap<String, String>>,
    /// Which units the project has moved to a different armour class (issue
    /// #2645). Absent on a project saved before it, which reads as empty.
    #[serde(rename = "armorClasses", default)]
    pub armor_classes: ArmorClasses,
    /// Custom explosion generators the project writes as `effects/<key>.lua`
    /// (issue #2643), by key. Absent on a project saved before it, which
    /// reads as empty.
    #[serde(rename = "explosionGenerators", default)]
    pub explosion_generators: BTreeMap<String, ExplosionGenerator>,
}

impl GameEdits {
    /// Whether the project records nothing about the game.
    pub fn is_empty(&self) -> bool {
        self.overrides.is_empty()
            && self.clones.is_empty()
            && self.menus.is_empty()
            && self.text.is_empty()
            && self.disabled.is_empty()
            && self.weapons.is_empty()
            && self.equipped.values().all(BTreeMap::is_empty)
            && self.armor_classes.is_empty()
            && self.explosion_generators.is_empty()
    }

    /// How many slots fire a library weapon, and how many death explosions
    /// are one, across every unit.
    pub fn equipped_count(&self) -> usize {
        self.equipped.values().map(BTreeMap::len).sum()
    }

    /// How many of [`Self::equipped_count`] are death explosions (issue #2642).
    pub fn death_explosion_count(&self) -> usize {
        self.equipped
            .values()
            .flat_map(BTreeMap::keys)
            .filter(|step| crate::compile::DEATH_MOUNTS.contains(&step.as_str()))
            .count()
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
/// is created.
///
/// Read-only is about editing, not about compiling. Importing somebody's
/// tweak set is asking to run their program, and most of a real set is
/// program: a project that kept only the part it could turn into fields
/// would throw away nearly all of it. So `compile.rs` emits a block verbatim
/// when [`form`](Self::form) says the decoder proved it is a Lua chunk.
/// Nothing in coilbox ever runs it, exactly as before: the game does, the
/// same way it would have run the `!bset` lines it was decoded from.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadOnlyLuaBlock {
    pub title: String,
    pub lua: String,
    pub note: String,
    /// What the decoder made of it, mirroring `DecodedSlot::form`. Only
    /// `"block"` is compiled: that is the one value that means the text
    /// already compiled as a Lua chunk. `None` on a project saved before
    /// this was recorded, which is read as not known to parse.
    #[serde(default)]
    pub form: Option<String>,
}

impl ReadOnlyLuaBlock {
    /// Whether this block can be emitted into the compiled output. Emitting
    /// one that never parsed would break every file it landed in, so an
    /// unrecognised block stays where it is and the compiler says so.
    pub fn compiles_verbatim(&self) -> bool {
        self.form.as_deref() == Some("block")
    }
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
    /// Field changes the user sent through the mutator route because the
    /// edit-in-place route cannot write them (issue #2633), as unit to dotted
    /// field paths spelled the way `edits.overrides` spells them. The
    /// in-place write skips them. The compiler reads only `edits`, so a
    /// mutator still carries them.
    #[serde(default)]
    pub mutator_only: BTreeMap<String, Vec<String>>,
    /// Copies sent through the mutator route whole, because one of their
    /// changes has no edit a file can take (issue #3035). A copy is written as
    /// a file or not at all (`inplace_clone.rs`), so this is a mark against
    /// the whole copy rather than one of its fields, unlike `mutator_only`.
    /// The in-place write skips a copy named here rather than refusing the
    /// whole batch over it.
    #[serde(default)]
    pub clone_mutator_only: Vec<String>,
}

impl ModProject {
    /// Whether the user sent this one field change through the mutator route.
    pub fn is_mutator_only(&self, unit: &str, field: &str) -> bool {
        self.mutator_only
            .get(unit)
            .is_some_and(|fields| fields.iter().any(|f| f == field))
    }

    /// Whether the user sent this whole copy through the mutator route.
    pub fn is_clone_mutator_only(&self, unit: &str) -> bool {
        self.clone_mutator_only.iter().any(|u| u == unit)
    }
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

    /// A project saved before issue #2633 has no `mutatorOnly`, and one saved
    /// after it reads the marks back per unit.
    #[test]
    fn the_mutator_only_marks_are_optional() {
        let project: ModProject = serde_json::from_value(json!({
            "name": "x",
            "gameName": "g",
            "mutatorOnly": { "wf_direwolf_p": ["maxDamage", "customparams.speed"] },
        }))
        .expect("parse");
        assert!(project.is_mutator_only("wf_direwolf_p", "customparams.speed"));
        assert!(!project.is_mutator_only("wf_direwolf_p", "customparams"));
        assert!(!project.is_mutator_only("sj_direwolf_p", "maxDamage"));

        let older: ModProject =
            serde_json::from_value(json!({ "name": "x", "gameName": "g" })).expect("parse");
        assert!(older.mutator_only.is_empty());
    }

    /// A project saved before issue #3035 has no `cloneMutatorOnly`, and one
    /// saved after it reads the marks back as a flat list of copy keys: a
    /// copy is written as a file or not at all, so the mark is against the
    /// whole copy rather than one of its fields.
    #[test]
    fn the_clone_mutator_only_marks_are_optional() {
        let project: ModProject = serde_json::from_value(json!({
            "name": "x",
            "gameName": "g",
            "cloneMutatorOnly": ["armdfly2"],
        }))
        .expect("parse");
        assert!(project.is_clone_mutator_only("armdfly2"));
        assert!(!project.is_clone_mutator_only("brv_mk2"));

        let older: ModProject =
            serde_json::from_value(json!({ "name": "x", "gameName": "g" })).expect("parse");
        assert!(older.clone_mutator_only.is_empty());
    }

    /// A project saved before issue #2640 has no library, and one saved after
    /// it reads each weapon and each slot that fires one.
    #[test]
    fn the_weapon_library_is_optional() {
        let project: ModProject = serde_json::from_value(json!({
            "name": "x",
            "gameName": "g",
            "edits": {
                "weapons": { "heavylaser": {
                    "key": "heavylaser",
                    "source": "armcom_armcomlaser",
                    "sourceChecksum": "c6a15f1f",
                    "def": { "range": 300 },
                    "changes": { "range": 450 }
                } },
                "equipped": { "armcom": { "0": "heavylaser" } }
            }
        }))
        .expect("parse");
        let weapon = &project.edits.weapons["heavylaser"];
        assert_eq!(weapon.source.as_deref(), Some("armcom_armcomlaser"));
        assert_eq!(weapon.changes["range"], json!(450));
        assert_eq!(project.edits.equipped["armcom"]["0"], "heavylaser");
        assert_eq!(project.edits.equipped_count(), 1);
        assert!(!project.edits.is_empty());

        let older: ModProject =
            serde_json::from_value(json!({ "name": "x", "gameName": "g", "edits": {} }))
                .expect("parse");
        assert!(older.edits.weapons.is_empty());
        assert!(older.edits.equipped.is_empty());
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
