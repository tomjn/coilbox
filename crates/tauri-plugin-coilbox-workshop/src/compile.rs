//! Turning a tweak project into the Lua a game reads (issue #1275).
//!
//! There are two forms of generated Lua and they are not interchangeable.
//!
//! A **table** is a plain map of unit name to definition. It says what a unit
//! is and nothing about how to get there, so it can be read, diffed and pasted
//! by hand. It is what Beyond All Reason's `tweakunits` slot carries, and what
//! a game's own `units/<name>.lua` file returns. It cannot express a change
//! that depends on what the game already says.
//!
//! A **block** is executable Lua wrapped in `do ... end`, run with `UnitDefs`
//! in scope. It is what BAR's `tweakdefs` slot carries, and what a mutator's
//! `gamedata/unitdefs_post.lua` runs. It is needed the moment a change has to
//! read a definition before writing it: replaying a build menu over whatever
//! list the game ships today, dropping a unit from every builder in the game,
//! or standing a whole definition in for one the game already loaded.
//!
//! So the compiler picks per change rather than per store, and says why. Those
//! two forms are also why one compiler serves both delivery routes: the mutator
//! archive is these chunks written into files, and the BAR export (issue #1277)
//! is the same chunks base64ed into numbered slots.
//!
//! One store is neither form, because it is not Lua. A game that keeps its
//! unit names and descriptions in `language/<code>/units.json` rather than in
//! its definitions gets a JSON file of its own beside that one, which is
//! [`LANGUAGE_FILE`]. It is a file and never a chunk: no slot can carry it,
//! since a slot's Lua runs in the definition parser and `Spring.I18N` is not
//! there.
//!
//! The compiler never sees the game. That is deliberate: every decision it
//! makes is a fact about the project, so compiling is deterministic, needs no
//! unitsync scan, and produces the same bytes on the machine that made the
//! project and the machine that received it.

use crate::before_post;
use crate::lua::{lua_literal, lua_string, PatchTree};
use crate::model::{
    through_a_position, BuildMenuOp, CegClass, ExplosionGenerator, GameEdits, LibraryWeapon,
    ModProject, UnitClone,
};
use serde::Serialize;
use serde_json::{json, Value};
use std::collections::BTreeMap;

/// Which of the two forms a chunk is written in.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum LuaForm {
    /// A plain table of unit name to definition.
    Table,
    /// Executable Lua wrapped in `do ... end`, run with `UnitDefs` in scope.
    Block,
}

/// One piece of generated Lua, and the compiler's reason for its form.
///
/// The reason is not decoration. A modder reading a `do ... end` block wants to
/// know why it is not the simpler thing, and issue #1277 needs to know which
/// slot kind a chunk belongs in.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Chunk {
    pub form: LuaForm,
    /// What this chunk changes, as a heading.
    pub title: String,
    /// Why the compiler wrote it in this form rather than the other.
    pub reason: String,
    pub lua: String,
}

/// One file of the generated mutator archive.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompiledFile {
    /// Relative to the archive root, always with forward slashes.
    pub path: String,
    pub contents: String,
}

/// What a project compiled to.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompiledMod {
    /// The Lua, in the two forms, with the compiler's reasoning attached.
    pub chunks: Vec<Chunk>,
    /// The same Lua laid out as a mutator archive, which is the route every
    /// Spring and Recoil game supports (issue #1268), plus the language file
    /// that has no chunk behind it.
    pub files: Vec<CompiledFile>,
    /// What the compiler could not do, and what to watch out for in what it
    /// did. Empty is the ordinary case.
    pub notes: Vec<String>,
    /// Every edit as one `do ... end` block, for Beyond All Reason's bare
    /// `tweakdefs` mod option on a local skirmish launch (issue #1278). `None`
    /// when there is nothing to tweak.
    ///
    /// Only `tweakdefs` is used, never `tweakunits`: a `tweakunits` slot is a
    /// plain table BAR merges into `UnitDefs` by some rule of its own that
    /// nothing here has confirmed, while `tweakdefs` runs as Lua with
    /// `UnitDefs` in scope, the same contract `gamedata/unitdefs_post.lua`
    /// already relies on and this project has already tested. So an added
    /// unit is folded in here as a plain `UnitDefs[name] = def` assignment
    /// rather than left for a `tweakunits` slot to interpret, and everything
    /// this field carries is exactly as certain as the mutator route already
    /// is. Splitting a large project across BAR's numbered slots is issue
    /// #1277's, not this field's: a project too big for the one bare slot is
    /// simply not offered this route (see `src/workshop/localBar.ts`).
    pub bar_tweakdefs: Option<String>,
}

/// Where the executable half of a mutator has to live.
///
/// The engine's own `gamedata/unitdefs.lua` includes this path after every
/// `units/*.lua` file has loaded, which is the only hook a mutator has for
/// anything that reads the game's definitions.
const POST_FILE: &str = "gamedata/unitdefs_post.lua";

/// What a mutator calls the file it puts a unit's words in, inside each
/// `language/<code>/` folder (issue #2743).
///
/// A game that keeps its unit names outside its definitions keeps them in
/// `language/<code>/units.json`, and shipping a file of that name would take
/// the place of the game's own and blank every unit the project never
/// mentioned. It does not have to. Beyond All Reason's i18n module, which is
/// the module every game of that lineage loads, reads
/// `VFS.DirList(languageDir, '*.json')` and loads every file it gets back,
/// setting one key at a time (`modules/i18n/i18n.lua`, and `i18n.set` in
/// `modules/i18n/i18nlib/i18n/init.lua`). So a second file in the same folder
/// is additive: the keys it names are set from it, and every other unit still
/// reads the game's own.
///
/// The name itself decides whether that works, which is why it is a constant
/// with an argument attached rather than a string in a `format!`. The engine
/// returns a directory listing sorted by path and de-duplicated
/// (`CVFSHandler::GetFilesInDir` stable-sorts `files[section]`, and
/// `CFileHandler::DirList` sorts the result again), so the last file by name
/// is the last one loaded and the last write to a key wins. `zz_coilbox.json`
/// sorts after `units.json`. A name sorting before it would be overwritten by
/// the game's own file and the rename would vanish, which is the bug this
/// replaces rather than a new one.
const LANGUAGE_FILE: &str = "zz_coilbox.json";

/// Where a project's armour class moves have to live (issue #2645).
///
/// The engine reads this file's returned table whole
/// (`CDamageArrayHandler::Init`), and a mutator archive covers up the base
/// game's copy of any path it also ships with no way for either to read the
/// other, the same limit [`POST_FILE`]'s own note names. So this is never a
/// patch: it is `edits.armor_classes.base`, the snapshot the project took the
/// moment it moved its first unit, with every move applied on top.
const ARMOR_FILE: &str = "gamedata/armordefs.lua";

/// A mutator archive's version for every route except packaging.
///
/// The local test route (`mutator.rs`) rewrites its folder whole on every
/// test and the BAR route (`localBar.ts`) writes a mod option that is
/// forgotten the moment the skirmish ends, so neither reads this field.
/// Packaging a project for somebody else is the one route where the number
/// has to mean something (issue #1283): two players on different builds of
/// the same archive name is a sync error, not an error message, so
/// `package.rs` renders `modinfo.lua` a second time through
/// [`modinfo_versioned`] with the version the author is publishing.
const MUTATOR_VERSION: &str = "1";

/// Compile a project.
pub fn compile(project: &ModProject) -> CompiledMod {
    let edits = &project.edits;
    let mut chunks = Vec::new();
    let mut notes = Vec::new();

    // Lua the project carries but cannot edit (issue #1280), compiled first
    // so everything the user did in coilbox lands on top of it. An imported
    // set is the baseline they started from: a program that scales every
    // unit's health has to run before the one unit they then typed a number
    // into, or their number gets scaled too.
    //
    // Only a block the decoder proved is a Lua chunk. The other kind never
    // parsed, and writing it into a file would break the whole file rather
    // than just itself.
    let (carried_lua, unparsed_lua): (Vec<_>, Vec<_>) = project
        .read_only_lua
        .iter()
        .partition(|block| block.compiles_verbatim());
    for block in &carried_lua {
        chunks.push(Chunk {
            form: LuaForm::Block,
            title: block.title.clone(),
            reason: "Carried from a decoded import as it stands. Coilbox never runs it, and cannot edit it either, so it is written out the way it arrived.".to_string(),
            lua: block.lua.clone(),
        });
    }

    // A copy's key becomes a file name under the generated archive, so it is
    // checked again here rather than trusted. The editor already refuses
    // anything else (`checkCloneName`), but a project arrives as JSON that
    // somebody may have written by hand or been sent, and `../` in a key would
    // put a generated file outside the archive.
    for key in edits.clones.keys() {
        if !valid_unit_key(key) {
            notes.push(format!(
                "The copy named {key:?} was left out. A unit's internal name can only hold lowercase letters, digits and underscores, and it becomes a file name in the generated game."
            ));
        }
    }

    // A copy the project adds under a name nothing else uses. Its definition is
    // whole and owned, so the plain table says all of it, and the game loads it
    // out of `units/` beside its own.
    let added: Vec<&UnitClone> = edits
        .clones
        .values()
        .filter(|clone| !clone.replaces_game_unit && valid_unit_key(&clone.key))
        .collect();
    let replaced: Vec<&UnitClone> = edits
        .clones
        .values()
        .filter(|clone| clone.replaces_game_unit && valid_unit_key(&clone.key))
        .collect();

    // Computed unconditionally, so `bar_tweakdefs` below can fold the same
    // added units in as assignments without resolving their definitions a
    // second time.
    let added_entries: Vec<(String, Value)> = added
        .iter()
        .map(|clone| (clone.key.clone(), game_clone_def(clone, edits)))
        .collect();
    for (key, def) in &added_entries {
        notes.extend(reference_notes(key, def));
    }
    // Assigned rather than left as a plain table (issue #2962). BAR's
    // `tweakunits` route walks the units the game already has and merges a
    // tweak into each one it finds a key for, so a key naming a unit the game
    // does not have matches nothing and the whole added unit is dropped with
    // no error. Only an assignment creates one, which is what
    // `bar_tweakdefs_body` has always done for the single-slot route and what
    // the numbered-slot packer gets by carrying this as a block.
    //
    // The archive route is unaffected: it loads these out of `units/` beside
    // the game's own, so [`added_block`] is deliberately left out of the post
    // file below rather than restating every definition a second time.
    let mut unit_files = Vec::new();
    let added_chunk = (!added_entries.is_empty()).then_some(chunks.len());
    if !added_entries.is_empty() {
        chunks.push(Chunk {
            form: LuaForm::Block,
            title: format!(
                "{} unit{} added",
                added_entries.len(),
                if added_entries.len() == 1 { "" } else { "s" }
            ),
            reason: "A copy owns its whole definition, and the game has no unit of that name to merge onto, so it has to be assigned rather than merged.".to_string(),
            lua: added_block(&added_entries),
        });
        for (key, def) in &added_entries {
            unit_files.push(CompiledFile {
                path: format!("units/{key}.lua"),
                contents: unit_file(project, key, def),
            });
        }
    }

    // A copy under a name the game already uses. It has to land after the
    // game's own definitions, and it has to replace rather than merge, so the
    // table form cannot carry it.
    for clone in &replaced {
        let def = game_clone_def(clone, edits);
        notes.extend(reference_notes(&clone.key, &def));
        chunks.push(Chunk {
            form: LuaForm::Block,
            title: format!("{} replaced", clone.key),
            reason: format!(
                "The game defines {} too, so this has to be written after its definitions have loaded, and it replaces rather than merges.",
                clone.key
            ),
            lua: replace_block(clone, &def),
        });
    }

    // Field changes against the game's own units. A patch and nothing more:
    // every field the project does not mention keeps following the game.
    //
    // A change through a list position is held apart from the rest (issue
    // #3041). Its step means the position counted from zero in a list
    // numbered 1 to n, and the Lua key itself in any other table, which is
    // how the unit page read the game. Only the game's own table can say
    // which, so it is a block that reads the table before it writes.
    let mut patches: Vec<(String, PatchTree)> = Vec::new();
    let mut positional: Vec<(&str, &str, &Value)> = Vec::new();
    let mut count = 0;
    for (unit, patch) in &edits.overrides {
        if edits.clones.contains_key(unit) {
            continue; // Folded into the copy's own definition above.
        }
        let mut tree = PatchTree::new();
        for (path, value) in patch {
            if through_a_position(path) {
                positional.push((unit, path, value));
            } else {
                tree.insert(path, value.clone());
                count += 1;
            }
        }
        if !tree.is_empty() {
            patches.push((unit.clone(), tree));
        }
    }
    if !patches.is_empty() {
        chunks.push(Chunk {
            form: LuaForm::Table,
            title: format!(
                "{count} field change{}",
                if count == 1 { "" } else { "s" }
            ),
            reason: "Each one is a value the user typed, so none of them has to read the game's own first.".to_string(),
            lua: patch_table(&patches, ""),
        });
    }
    if !positional.is_empty() {
        chunks.push(Chunk {
            form: LuaForm::Block,
            title: format!(
                "{} field change{} through a list",
                positional.len(),
                if positional.len() == 1 { "" } else { "s" }
            ),
            reason: "A list with a gap in it, such as weapons 1 and 3 and no 2, keeps its own numbers, so which entry each change is for has to be read off the game's own list.".to_string(),
            lua: positional_block(&positional),
        });
    }

    // Slots the project re-armed with a weapon out of its own library (issue
    // #2640). A copy's are folded into its definition above. A game unit's
    // slot has to be found in the game's own list first, which only the
    // loaded table can answer, so it is a block.
    notes.extend(equip_notes(edits));
    let equips: Vec<(&str, EquipAt, &str)> = edits
        .equipped
        .iter()
        .filter(|(unit, _)| !edits.clones.contains_key(*unit))
        .flat_map(|(unit, slots)| {
            slots
                .iter()
                .map(move |(step, key)| (unit.as_str(), step.as_str(), key.as_str()))
        })
        .filter_map(|(unit, step, key)| {
            let at = equip_at(step)?;
            (edits.weapons.contains_key(key) && valid_unit_key(key)).then_some((unit, at, key))
        })
        .collect();
    if !equips.is_empty() {
        chunks.push(Chunk {
            form: LuaForm::Block,
            title: equip_title(&equips),
            reason: if equips.iter().any(|(_, at, _)| matches!(at, EquipAt::Death(_))) {
                "Each weapon is written into the unit's own weapon definitions as the game loads it, and the slot or death explosion field is pointed at it there, so no other unit changes."
            } else {
                "The slot is found in the unit's own weapon list as the game loads it, and the weapon is written into that unit's own weapon definitions, so no other unit changes."
            }
            .to_string(),
            lua: equip_block(&equips, &edits.weapons),
        });
    }

    // Build menus. A copy's menu is folded into its definition, because the
    // project owns that list outright. A game unit's menu cannot be: writing
    // out the list as it stands today would pin it, and a unit the game adds to
    // that factory next patch would silently never appear.
    for (builder, ops) in &edits.menus {
        if edits.clones.contains_key(builder) || ops.is_empty() {
            continue;
        }
        chunks.push(Chunk {
            form: LuaForm::Block,
            title: format!("{builder} build menu"),
            reason: "Replayed over the list the game ships, so a unit it adds to this builder later is still there.".to_string(),
            lua: menu_block(builder, ops),
        });
    }

    // Units switched off, which means dropping them from every build list in
    // the game. There is no way to say that as a table: it is a read of every
    // definition before a write to some of them.
    if !edits.disabled.is_empty() {
        chunks.push(Chunk {
            form: LuaForm::Block,
            title: format!(
                "{} unit{} switched off",
                edits.disabled.len(),
                if edits.disabled.len() == 1 { "" } else { "s" }
            ),
            reason: "It reads every builder in the game before it writes to any of them."
                .to_string(),
            lua: disabled_block(&edits.disabled),
        });
    }

    // The words a player reads, for a game that keeps them in a localisation
    // file rather than in its unit definitions. Added beside the game's own
    // file rather than over it, for the reason [`LANGUAGE_FILE`] gives.
    for code in edits.text.values().flat_map(|langs| langs.keys()) {
        if !valid_language_code(code) {
            notes.push(format!(
                "Name and description edits in the language {code:?} were left out. A language code can only hold lowercase letters, digits, hyphens and underscores, and it becomes a folder name in the generated game."
            ));
        }
    }
    let (language_files, carried) = language_files(edits);
    if carried > 0 {
        let paths = language_files
            .iter()
            .map(|file| file.path.as_str())
            .collect::<Vec<_>>()
            .join(", ");
        notes.push(format!(
            "{carried} name and description edit{} {} in {paths}, added beside the game's own units.json rather than over it, so every unit the project does not name keeps the words the game gives it. Beyond All Reason's tweak slot route cannot carry these at all: that Lua runs in the definition parser, which has no Spring.I18N.",
            if carried == 1 { "" } else { "s" },
            if carried == 1 { "is" } else { "are" },
        ));
    }

    // The two things that can be true of carried Lua, said separately. A
    // block that compiled is in the output, and the user should know whose
    // code they are about to run. One that never parsed is not in the output,
    // and saying so is the difference between a note and a silent drop.
    if !carried_lua.is_empty() {
        let count = carried_lua.len();
        notes.push(format!(
            "{count} block{} of Lua from a decoded import {} compiled into the output as {} arrived, ahead of this project's own changes. Coilbox cannot edit or check that Lua, so read it in the project if you are unsure what it does.",
            if count == 1 { "" } else { "s" },
            if count == 1 { "is" } else { "are" },
            if count == 1 { "it" } else { "they" },
        ));
    }
    if !unparsed_lua.is_empty() {
        let count = unparsed_lua.len();
        notes.push(format!(
            "{count} block{} of decoded Lua {} left out of the output, because {} never parsed as Lua and writing {} into a file would break the file. {} still carried on the project to read: {}.",
            if count == 1 { "" } else { "s" },
            if count == 1 { "is" } else { "are" },
            if count == 1 { "it" } else { "they" },
            if count == 1 { "it" } else { "them" },
            if count == 1 { "It is" } else { "They are" },
            unparsed_lua
                .iter()
                .map(|block| block.title.as_str())
                .collect::<Vec<_>>()
                .join(", "),
        ));
    }

    let mut files = Vec::new();
    if !edits.is_empty() {
        files.push(CompiledFile {
            path: "modinfo.lua".to_string(),
            contents: modinfo(project),
        });
    }
    files.extend(unit_files);
    files.extend(language_files);
    let weapon_files = weapon_files(edits, &mut notes);
    if !weapon_files.is_empty() {
        notes.push(format!(
            "{} weapon file{} written under weapons/, one for each unit and library weapon it carries, so the weapon is in the game's shared weapon table under the name its slot gives it. A game that adds a unit's own weapons to that table itself, as Balanced Annihilation and Beyond All Reason do, replaces each one with the same weapon, and one that does not, such as SpringMCLegacy or THIS, finds it there. A BAR tweak slot carries no files, and needs none, because Beyond All Reason adds the unit's own weapons itself.",
            weapon_files.len(),
            if weapon_files.len() == 1 { "" } else { "s" }
        ));
    }
    files.extend(weapon_files);
    if let Some(armor_file) = armor_defs_file(edits) {
        files.push(armor_file);
        notes.push(format!(
            "{ARMOR_FILE} takes the place of the base game's own file of that name whole, moving {} unit{} into a different armour class. Coilbox cannot patch that file, only replace it, so it compiles from a snapshot of the game's own classes rather than the game itself. Opening the project keeps that snapshot following the game (issue #3062), except for a class a move still targets that the game has since removed or renamed, which the project's checks report so it can be resolved by hand.",
            edits.armor_classes.moves.len(),
            if edits.armor_classes.moves.len() == 1 { "" } else { "s" }
        ));
    }
    if !edits.explosion_generators.is_empty() {
        for generator in edits.explosion_generators.values() {
            files.push(CompiledFile {
                path: format!("effects/{}.lua", generator.key),
                contents: ceg_file(generator),
            });
        }
        notes.push(format!(
            "{} explosion effect{} written under effects/. The engine reads these from a real file in the game's own archive tree (rts/Sim/Projectiles/ExplosionGenerator.cpp), so a BAR tweak slot cannot carry them: this project's tweakdefs export is left empty and the mutator or edit-in-place route is needed to see the effect in game.",
            edits.explosion_generators.len(),
            if edits.explosion_generators.len() == 1 { "" } else { "s" }
        ));
    }

    // Every block, in the order they were compiled, which is the order they have
    // to run in: a copy standing in for a game unit before a menu is replayed
    // over it, and switching a unit off last so it reaches every list either of
    // the first two left behind. Taken from the chunks rather than rebuilt, so
    // the file and the Lua the user reads cannot say different things.
    let post_blocks: Vec<&str> = chunks
        .iter()
        .enumerate()
        .filter(|(i, chunk)| chunk.form == LuaForm::Block && Some(*i) != added_chunk)
        .map(|(_, chunk)| chunk.lua.as_str())
        .collect();
    if !patches.is_empty() || !post_blocks.is_empty() {
        files.push(CompiledFile {
            path: POST_FILE.to_string(),
            contents: post_file(project, &patches, &post_blocks),
        });
        notes.push(format!(
            "The mutator's {POST_FILE} takes the place of the base game's own file of that name, if it has one. The engine's definition parser gives a mutator no way to reach a file its own archive covers up, so a game that post-processes its units there needs the tweak slot route instead."
        ));
    }

    // A tweak slot can carry a field pointing at a generator's name, but never
    // the effects/<key>.lua file the name resolves to (see the note above), so
    // a project with any generator gets no tweakdefs export at all rather than
    // one that quietly points at nothing in game.
    let bar_tweakdefs = if !edits.explosion_generators.is_empty()
        || (added_entries.is_empty() && patches.is_empty() && post_blocks.is_empty())
    {
        None
    } else {
        Some(bar_tweakdefs_body(
            project,
            &added_entries,
            &patches,
            &post_blocks,
        ))
    };

    CompiledMod {
        chunks,
        files,
        notes,
        bar_tweakdefs,
    }
}

/// A copy's definition as it will be read: the definition it was made with,
/// with the project's later edits to it written in, and its own build list
/// resolved if the project reordered one.
///
/// Folded rather than left as a patch because a copy owns its table outright.
/// The game has no unit of that name to follow, so there is nothing for a
/// sparse patch to be sparse against (`src/workshop/clones.ts`).
pub(crate) fn resolved_clone_def(clone: &UnitClone, edits: &GameEdits) -> Value {
    clone_def(clone, edits, false)
}

/// A copy's definition as the mutator writes it, for the game's post files to
/// run over (issue #3054).
///
/// [`resolved_clone_def`] with the game's own values put back first, wherever
/// its post files changed one and the project has not changed it since. The
/// copy then goes through the game's post-processing once, as its source did,
/// rather than a second time on top of the values the page read.
///
/// The edit-in-place route keeps [`resolved_clone_def`]. It copies the source
/// unit's own file and writes only what the copy changed, so the file's
/// values are already there.
fn game_clone_def(clone: &UnitClone, edits: &GameEdits) -> Value {
    clone_def(clone, edits, true)
}

fn clone_def(clone: &UnitClone, edits: &GameEdits, before_post: bool) -> Value {
    let mut def = clone.def.clone();
    if let (true, Some(change)) = (before_post, &clone.before_post) {
        let edited = edits
            .overrides
            .get(&clone.key)
            .into_iter()
            .flat_map(|patch| patch.keys().map(String::as_str));
        before_post::restore(&mut def, change, edited);
    }
    if let Some(patch) = edits.overrides.get(&clone.key) {
        for (path, value) in patch {
            let steps: Vec<&str> = path.split('.').collect();
            write_path(&mut def, &steps, value.clone());
        }
    }
    if let Some(source) = clone.source.as_deref() {
        mount_own_weapons(&mut def, source, &clone.key);
        point_own_references(&mut def, source, &clone.key);
    }
    if let Some(slots) = edits.equipped.get(&clone.key) {
        equip_into(&mut def, &clone.key, slots, &edits.weapons);
    }
    if let Some(ops) = edits.menus.get(&clone.key) {
        let key = build_options_key(&def);
        let resolved = apply_build_menu(&build_options_of(&def), ops);
        let steps = [key.as_str()];
        write_path(
            &mut def,
            &steps,
            Value::Array(resolved.into_iter().map(Value::String).collect()),
        );
    }
    def
}

/// Point a copy's weapon slots at the definitions the copy carries itself
/// (issue #2639).
///
/// A copy is made from a unit as the game loaded it, after the base content's
/// `gamedata/weapondefs_post.lua` has run. That script copies each definition
/// a unit carries into the game's shared table as `<unit>_<name>` and points
/// the slot at it, so a copy of `armcom` holds `weapondefs.armcomlaser` and a
/// slot naming `armcom_armcomlaser`. Loaded as a unit of its own, the copy's
/// definition becomes `supercom_armcomlaser` and nothing mounts it: the slot
/// still fires armcom's weapon, and an edit to the copy's weapon reaches the
/// game as nothing at all. Renaming the slot to the copy's own prefix is what
/// makes the definition the copy carries the one it fires.
///
/// Only a slot whose name is the source's prefix on a definition the copy
/// carries. A slot naming a shared weapon, or one another unit carries, is left
/// alone.
fn mount_own_weapons(def: &mut Value, source: &str, key: &str) {
    if source.eq_ignore_ascii_case(key) {
        return;
    }
    let Some(map) = def.as_object_mut() else {
        return;
    };
    let own: Vec<String> = map
        .iter()
        .find(|(k, _)| k.eq_ignore_ascii_case("weapondefs"))
        .and_then(|(_, v)| v.as_object())
        .map(|defs| defs.keys().map(|k| k.to_lowercase()).collect())
        .unwrap_or_default();
    if own.is_empty() {
        return;
    }
    let prefix = format!("{}_", source.to_lowercase());
    // A death explosion the source carries itself is named the same way once
    // the post files have run, so it is pointed at the copy's own the same way
    // (issue #2642). No installed game ships a unit like that today: Balanced
    // Annihilation's two candidates name theirs in capitals, which its post
    // file does not match, so they explode as the shared weapon of that name.
    for (field, value) in map.iter_mut() {
        if !DEATH_MOUNTS.contains(&field.to_lowercase().as_str()) {
            continue;
        }
        let Some(lower) = value.as_str().map(|n| n.trim().to_lowercase()) else {
            continue;
        };
        if let Some(short) = lower.strip_prefix(&prefix) {
            if own.iter().any(|k| k == short) {
                *value = Value::String(format!("{}_{short}", key.to_lowercase()));
            }
        }
    }
    let Some(weapons) = map
        .iter_mut()
        .find(|(k, _)| k.eq_ignore_ascii_case("weapons"))
        .map(|(_, v)| v)
    else {
        return;
    };
    let slots: Vec<&mut Value> = match weapons {
        Value::Array(items) => items.iter_mut().collect(),
        Value::Object(items) => items.values_mut().collect(),
        _ => return,
    };
    for slot in slots {
        let Some(name) = slot
            .as_object_mut()
            .and_then(|table| {
                table
                    .iter_mut()
                    .find(|(k, _)| k.eq_ignore_ascii_case("name"))
            })
            .map(|(_, v)| v)
        else {
            continue;
        };
        let Some(lower) = name.as_str().map(|n| n.trim().to_lowercase()) else {
            continue;
        };
        if let Some(short) = lower.strip_prefix(&prefix) {
            if own.iter().any(|k| k == short) {
                *name = Value::String(format!("{}_{short}", key.to_lowercase()));
            }
        }
    }
}

/// The two unit fields that name a death explosion (issue #2642), lowercased
/// as the unit tables hold them. RecoilEngine looks each one up by name in the
/// game's weapon table (`UnitDef.cpp`, `CWeaponDefHandler::GetWeaponDef`, which
/// lowercases it), and `selfDestructAs` falls back to `explodeAs` when unset.
pub(crate) const DEATH_MOUNTS: [&str; 2] = ["explodeas", "selfdestructas"];

/// Where an equipped library weapon goes on a unit.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum EquipAt {
    /// A weapon slot, by its step: the position counted from zero in a list,
    /// or the Lua key itself in a list with a gap (`weaponSlots.ts`).
    Slot(u64),
    /// One of [`DEATH_MOUNTS`].
    Death(&'static str),
}

/// Where an `equipped` entry's step puts its weapon, or `None` for a step that
/// is neither a slot number nor a death explosion, which nothing in coilbox
/// writes (`weaponLibrary.ts`).
pub(crate) fn equip_at(step: &str) -> Option<EquipAt> {
    if let Some(field) = DEATH_MOUNTS.iter().find(|field| **field == step) {
        return Some(EquipAt::Death(field));
    }
    if step.is_empty() || !step.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    step.parse().ok().map(EquipAt::Slot)
}

/// A library weapon's definition as the game will read it: the definition it
/// was copied with, put back the way the game's own files had it where its
/// post files changed it (issue #3054), and the changes the project made to it
/// since.
pub(crate) fn library_def(weapon: &LibraryWeapon) -> Value {
    let mut def = weapon.def.clone();
    if let Some(change) = &weapon.before_post {
        before_post::restore(&mut def, change, weapon.changes.keys().map(String::as_str));
    }
    for (path, value) in &weapon.changes {
        let steps: Vec<&str> = path.split('.').collect();
        write_path(&mut def, &steps, value.clone());
    }
    def
}

/// How a game turns a reference between weapons into a definition (issue
/// #2641). `src/workshop/weaponRefs.ts` has the same list and the sources.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Resolution {
    /// A short name among the same unit's own `weapondefs`. Beyond All
    /// Reason's `alldefs_post.lua` prefixes it with the unit's name.
    Own,
    /// A full name in the game's weapon table, looked up as it stands.
    Full,
}

/// The custom parameters that name another weapon definition.
const REFERENCE_FIELDS: [(&str, Resolution); 2] = [
    ("cluster_def", Resolution::Own),
    ("speceffect_def", Resolution::Full),
];

/// One reference a definition holds: the `customparams` key and the field's
/// key as the definition spells them, how it resolves, and the name it holds.
struct Reference {
    params: String,
    key: String,
    resolution: Resolution,
    value: String,
}

fn find_key<'a>(map: &'a serde_json::Map<String, Value>, lower: &str) -> Option<&'a String> {
    map.keys().find(|k| k.eq_ignore_ascii_case(lower))
}

/// Every reference a weapon definition holds.
fn references(def: &Value) -> Vec<Reference> {
    let Some(map) = def.as_object() else {
        return Vec::new();
    };
    let Some(params) = find_key(map, "customparams") else {
        return Vec::new();
    };
    let Some(table) = map[params].as_object() else {
        return Vec::new();
    };
    REFERENCE_FIELDS
        .iter()
        .filter_map(|(field, resolution)| {
            let key = find_key(table, field)?;
            let value = table[key].as_str()?.trim();
            (!value.is_empty()).then(|| Reference {
                params: params.clone(),
                key: key.clone(),
                resolution: *resolution,
                value: value.to_string(),
            })
        })
        .collect()
}

/// Write a reference's new value where it was read from.
fn set_reference(def: &mut Value, reference: &Reference, value: String) {
    if let Some(table) = def
        .get_mut(&reference.params)
        .and_then(Value::as_object_mut)
    {
        table.insert(reference.key.clone(), Value::String(value));
    }
}

/// Every library weapon one library weapon names, and the ones those name, in
/// the order they are reached (issue #2641). A reference inside a library
/// weapon names another library weapon by its key, and equipping the first
/// writes each of these into the unit beside it, the same as `librarySupport`
/// in `weaponRefs.ts` lists them.
pub(crate) fn library_support(weapons: &BTreeMap<String, LibraryWeapon>, key: &str) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    let mut queue = vec![key.to_string()];
    while let Some(at) = queue.pop() {
        let Some(weapon) = weapons.get(&at) else {
            continue;
        };
        for reference in references(&library_def(weapon)) {
            let next = reference.value.to_lowercase();
            if next == key
                || out.contains(&next)
                || !weapons.contains_key(&next)
                || !valid_unit_key(&next)
            {
                continue;
            }
            out.push(next.clone());
            queue.push(next);
        }
    }
    out
}

/// A library weapon and the ones it names, as `unit` carries them: each under
/// its library key, with every full-name reference to one of them turned into
/// the name the game gives it in that unit, `<unit>_<key>`. A short-name
/// reference is left as the key, which the game's post files prefix itself.
pub(crate) fn library_defs_for(
    unit: &str,
    key: &str,
    weapons: &BTreeMap<String, LibraryWeapon>,
) -> Vec<(String, Value)> {
    let mut keys = vec![key.to_string()];
    keys.extend(library_support(weapons, key));
    keys.iter()
        .filter_map(|k| weapons.get(k).map(|w| (k.clone(), library_def(w))))
        .map(|(k, mut def)| {
            for reference in references(&def) {
                let lower = reference.value.to_lowercase();
                if reference.resolution == Resolution::Full && keys.contains(&lower) {
                    set_reference(
                        &mut def,
                        &reference,
                        format!("{}_{lower}", unit.to_lowercase()),
                    );
                }
            }
            (k, def)
        })
        .collect()
}

/// Point a copy's references at the definitions the copy carries itself
/// (issue #2641), for the reason [`mount_own_weapons`] gives for its slots.
///
/// A full-name reference, `armmship_rocket_split`, still names the source's
/// definition, so it becomes the copy's own, `<copy>_rocket_split`. A
/// short-name one read after the game's post files had prefixed it,
/// `legcluster_cluster_munition`, goes back to the short name the post files
/// will prefix with the copy's name. Only a name that lands on a definition
/// the copy carries.
fn point_own_references(def: &mut Value, source: &str, key: &str) {
    if source.eq_ignore_ascii_case(key) {
        return;
    }
    let prefix = format!("{}_", source.to_lowercase());
    let Some(own) = def
        .as_object_mut()
        .and_then(|map| {
            let k = find_key(map, "weapondefs")?.clone();
            map.get_mut(&k)
        })
        .and_then(Value::as_object_mut)
    else {
        return;
    };
    let names: Vec<String> = own.keys().cloned().collect();
    for weapon in own.values_mut() {
        for reference in references(weapon) {
            let lower = reference.value.to_lowercase();
            let Some(short) = lower.strip_prefix(&prefix) else {
                continue;
            };
            let Some(target) = names.iter().find(|n| n.eq_ignore_ascii_case(short)) else {
                continue;
            };
            let value = match reference.resolution {
                Resolution::Own => target.clone(),
                Resolution::Full => format!("{}_{}", key.to_lowercase(), target.to_lowercase()),
            };
            set_reference(weapon, &reference, value);
        }
    }
}

/// References in a copy's finished definition that name nothing it carries
/// (issue #2641), one sentence each.
///
/// A copy's whole definition is the project's, so what it carries is known
/// here. A short-name reference has to name one of its own definitions. A
/// full-name one under the copy's own prefix has to as well. A full name under
/// any other is a weapon in the game's table, which the compiler never sees,
/// so it is left to the page's own check.
fn reference_notes(key: &str, def: &Value) -> Vec<String> {
    let Some(own) = def
        .as_object()
        .and_then(|map| map.get(find_key(map, "weapondefs")?))
        .and_then(Value::as_object)
    else {
        return Vec::new();
    };
    let carries = |name: &str| own.keys().any(|k| k.eq_ignore_ascii_case(name));
    let prefix = format!("{}_", key.to_lowercase());
    let mut notes = Vec::new();
    for (holder, weapon) in own {
        for reference in references(weapon) {
            let lower = reference.value.to_lowercase();
            let names = match reference.resolution {
                Resolution::Own => Some(lower.as_str()),
                Resolution::Full => lower.strip_prefix(&prefix),
            };
            if let Some(name) = names {
                if !carries(name) {
                    notes.push(format!(
                        "{key}'s weapon {holder} names {} in {}, which {key} does not carry, so the effect that needs it does not happen.",
                        reference.value, reference.key
                    ));
                }
            }
        }
    }
    notes
}

/// What the compiler left out of the equipped slots, one sentence each.
fn equip_notes(edits: &GameEdits) -> Vec<String> {
    let mut notes = Vec::new();
    for (key, weapon) in &edits.weapons {
        if !valid_unit_key(key) || weapon.key != *key {
            notes.push(format!(
                "The library weapon {key:?} was left out. A weapon's name can only hold lowercase letters, digits and underscores, and it becomes a key in each unit that equips it."
            ));
        }
    }
    for (unit, slots) in &edits.equipped {
        for (step, key) in slots {
            match equip_at(step) {
                None => notes.push(format!(
                    "{unit} has a weapon equipped in a slot called {step:?}, which is not a slot number or a death explosion, so it was left out."
                )),
                Some(_) if edits.weapons.contains_key(key) => {}
                Some(EquipAt::Slot(_)) => notes.push(format!(
                    "{unit} has {key} equipped, which is not in the project's weapon library any more, so that slot keeps the weapon the game gives it."
                )),
                Some(EquipAt::Death(field)) => notes.push(format!(
                    "{unit} has {key} as its {field}, which is not in the project's weapon library any more, so it keeps the explosion the game gives it."
                )),
            }
        }
    }
    notes
}

/// Point a slot at a weapon the unit carries in its own `weapondefs`.
///
/// Both keys a game can bind a slot by are written. `def` is what Beyond All
/// Reason's `weapondefs_post.lua`, Balanced Annihilation's and the base
/// content's all read: each turns it into `<unit>_<def>` once it has put the
/// unit's own definitions into the shared table under that name. `name` is
/// that same full name, for a game that reads the slot's name and never its
/// `def`. Any other spelling of either is dropped first, so the slot cannot
/// end up naming two weapons.
fn point_slot(slot: &mut Value, unit: &str, key: &str) {
    if !slot.is_object() {
        *slot = Value::Object(serde_json::Map::new());
    }
    if let Some(table) = slot.as_object_mut() {
        table.retain(|k, _| {
            let lower = k.to_lowercase();
            lower != "name" && lower != "def"
        });
        table.insert("def".to_string(), Value::String(key.to_string()));
        table.insert(
            "name".to_string(),
            Value::String(format!("{}_{key}", unit.to_lowercase())),
        );
    }
}

/// The name a unit's death explosion field is given for a library weapon it
/// carries (issue #2642): the full name the game gives that definition,
/// `<unit>_<key>`.
///
/// Not the short name. Balanced Annihilation's, Beyond All Reason's and the
/// base content's `weapondefs_post.lua` each turn a short name into
/// `<unit>_<name>` when the unit carries a definition of exactly that name,
/// and leave the field alone otherwise. The full name finds nothing under
/// that rule and is left alone, and the engine then finds the definition by
/// it, so it works in a game with that rule and in one without it.
pub(crate) fn death_name(unit: &str, key: &str) -> String {
    format!("{}_{key}", unit.to_lowercase())
}

/// Where the weapon file for library weapon `key` on `unit` goes (issue
/// #3068), or `None` for a unit whose name cannot be part of a file name.
///
/// Every equipped weapon goes into the shared weapon table this way as well
/// as into the unit's own `weapondefs`. A slot and a death explosion name it
/// `<unit>_<key>`, and the engine looks that name up in the shared table.
/// Only a game's `gamedata/weapondefs_post.lua` copies a unit's own weapons
/// there, and SpringMCLegacy's and THIS's do not, so without this file the
/// name finds nothing. The base content's `gamedata/weapondefs.lua` reads
/// every `weapons/*.lua` into the table before any post file runs, and Beyond
/// All Reason's does the same. A game whose post file does copy the unit's
/// weapons, as the base content's, Balanced Annihilation's and Beyond All
/// Reason's all do, writes the unit's entry over this one under the same
/// name, so it loads exactly as it did without the file.
pub(crate) fn weapon_file_path(unit: &str, key: &str) -> Option<String> {
    weapon_file_name(unit, key).map(|name| format!("weapons/{name}"))
}

/// The file name alone of [`weapon_file_path`], for the in-place route to put
/// in whichever spelling of `weapons` the game already has.
pub(crate) fn weapon_file_name(unit: &str, key: &str) -> Option<String> {
    let unit = unit.to_lowercase();
    (valid_unit_key(&unit) && valid_unit_key(key)).then(|| format!("coilbox_{unit}_{key}.lua"))
}

/// The weapon file [`weapon_file_path`] names: library weapon `key` and the
/// library weapons it names, each under the full name it has on `unit`.
pub(crate) fn weapon_file(
    unit: &str,
    key: &str,
    weapons: &BTreeMap<String, LibraryWeapon>,
) -> String {
    let entries: Vec<String> = library_defs_for(unit, key, weapons)
        .into_iter()
        .map(|(name, def)| {
            format!(
                "  [{}] = {},",
                lua_string(&death_name(unit, &name)),
                lua_literal(&def, "  ")
            )
        })
        .collect();
    format!(
        "-- Written by coilbox (issue #3068). A weapon from a project's weapon\n\
         -- library that {unit} carries, under the name its slot or death\n\
         -- explosion gives it. The engine looks that name up in the shared\n\
         -- weapon table, and a game whose gamedata/weapondefs_post.lua adds a\n\
         -- unit's own weapondefs to that table replaces this entry with the\n\
         -- same weapon. One whose post file does not finds it here.\n\
         return {{\n{}\n}}\n",
        entries.join("\n")
    )
}

/// Every weapon file the project's equipped weapons need, one per unit and
/// library weapon, whether the unit is the game's or a copy.
fn weapon_files(edits: &GameEdits, notes: &mut Vec<String>) -> Vec<CompiledFile> {
    let mut pairs: Vec<(&str, &str)> = edits
        .equipped
        .iter()
        .flat_map(|(unit, slots)| {
            slots
                .iter()
                .filter(|(step, _)| equip_at(step).is_some())
                .map(move |(_, key)| (unit.as_str(), key.as_str()))
        })
        .filter(|(_, key)| edits.weapons.contains_key(*key))
        .collect();
    pairs.sort_unstable();
    pairs.dedup();
    let mut files = Vec::new();
    for (unit, key) in pairs {
        match weapon_file_path(unit, key) {
            Some(path) => files.push(CompiledFile {
                path,
                contents: weapon_file(unit, key, &edits.weapons),
            }),
            // A bad weapon name has a note of its own in `equip_notes`.
            None if valid_unit_key(key) => notes.push(format!(
                "{unit} has {key} equipped, but its name cannot be part of a file name, so {key} gets no file under weapons/. A game that does not add a unit's own weapons to its weapon table, such as SpringMCLegacy or THIS, will not find it."
            )),
            None => {}
        }
    }
    files
}

/// The heading for the chunk of equipped weapons: slots, death explosions, or
/// both.
fn equip_title(equips: &[(&str, EquipAt, &str)]) -> String {
    let deaths = equips
        .iter()
        .filter(|(_, at, _)| matches!(at, EquipAt::Death(_)))
        .count();
    let slots = equips.len() - deaths;
    let plural = |n: usize| if n == 1 { "" } else { "s" };
    match (slots, deaths) {
        (_, 0) => format!("{slots} weapon{} equipped", plural(slots)),
        (0, _) => format!("{deaths} death explosion{} equipped", plural(deaths)),
        _ => format!(
            "{slots} weapon{} and {deaths} death explosion{} equipped",
            plural(slots),
            plural(deaths)
        ),
    }
}

/// Equip library weapons into a copy the project owns (issue #2640).
///
/// The copy's whole definition is the project's, so the weapon is written
/// straight into it rather than by a block at load time: into the copy's own
/// `weapondefs` under the library name, with the slot pointed at it by
/// [`point_slot`]. A step is a position counted from zero in a list and the
/// Lua key itself in a list with a gap, the way `weaponSlots.ts` reads one.
/// A slot the copy does not have is left alone.
fn equip_into(
    def: &mut Value,
    unit: &str,
    slots: &BTreeMap<String, String>,
    weapons: &BTreeMap<String, LibraryWeapon>,
) {
    for (step, key) in slots {
        if !weapons.contains_key(key) || !valid_unit_key(key) {
            continue;
        }
        let Some(at) = equip_at(step) else {
            continue;
        };
        let Some(map) = def.as_object_mut() else {
            return;
        };
        match at {
            EquipAt::Death(field) => {
                let spelled = map
                    .keys()
                    .find(|k| k.eq_ignore_ascii_case(field))
                    .cloned()
                    .unwrap_or_else(|| field.to_string());
                map.insert(spelled, Value::String(death_name(unit, key)));
            }
            EquipAt::Slot(_) => {
                let slot = map
                    .iter_mut()
                    .find(|(k, _)| k.eq_ignore_ascii_case("weapons"))
                    .and_then(|(_, list)| match list {
                        Value::Array(items) => {
                            step.parse::<usize>().ok().and_then(|i| items.get_mut(i))
                        }
                        Value::Object(items) => items.get_mut(step),
                        _ => None,
                    });
                let Some(slot) = slot else {
                    continue;
                };
                point_slot(slot, unit, key);
            }
        }
        let defs_key = map
            .keys()
            .find(|k| k.eq_ignore_ascii_case("weapondefs"))
            .cloned()
            .unwrap_or_else(|| "weapondefs".to_string());
        let own = map
            .entry(defs_key)
            .or_insert_with(|| Value::Object(serde_json::Map::new()));
        if !own.is_object() {
            *own = Value::Object(serde_json::Map::new());
        }
        if let Some(own) = own.as_object_mut() {
            // The weapons it names come with it (issue #2641).
            for (name, def) in library_defs_for(unit, key, weapons) {
                own.insert(name, def);
            }
        }
    }
}

/// Library weapons equipped into the game's own units (issue #2640).
///
/// Each weapon is written into the unit's own `weapondefs` under its library
/// name, so it is that unit's alone, and the slot is pointed at it the way
/// [`point_slot`] does for a copy. The slot is found the way
/// [`positional_block`] finds a list entry, and a unit or slot the game does
/// not have is skipped. Each unit gets its own copy of the table, because the
/// game's post-processing edits a definition in place.
///
/// The library weapons a weapon names go into the unit beside it (issue
/// #2641), each under its library key. A full-name reference to one has to
/// say which unit it is in, which only the loop knows, so `support` carries
/// where each of those is and the loop writes `<unit>_<key>` there. A project
/// with no such weapons gets none of this, and the same Lua it always did.
///
/// A death explosion (issue #2642) is an entry whose second value is the
/// field's name rather than a slot number. The weapon goes into the unit's
/// own `weapondefs` the same way, and the field is set to [`death_name`].
fn equip_block(
    equips: &[(&str, EquipAt, &str)],
    weapons: &BTreeMap<String, LibraryWeapon>,
) -> String {
    let mut library = serde_json::Map::new();
    let mut support: BTreeMap<String, (Vec<String>, Vec<[String; 4]>)> = BTreeMap::new();
    for (_, _, key) in equips {
        let Some(weapon) = weapons.get(*key) else {
            continue;
        };
        library.insert((*key).to_string(), library_def(weapon));
        let children = library_support(weapons, key);
        if children.is_empty() || support.contains_key(*key) {
            continue;
        }
        let mut full = Vec::new();
        for holder in std::iter::once(key.to_string()).chain(children.iter().cloned()) {
            let def = library_def(&weapons[&holder]);
            for reference in references(&def) {
                let target = reference.value.to_lowercase();
                if reference.resolution == Resolution::Full
                    && (target == *key || children.contains(&target))
                {
                    full.push([holder.clone(), reference.params, reference.key, target]);
                }
            }
            library.insert(holder.clone(), def);
        }
        support.insert((*key).to_string(), (children, full));
    }
    let support_table = if support.is_empty() {
        String::new()
    } else {
        let quoted = |items: &[String]| {
            items
                .iter()
                .map(|item| lua_string(item))
                .collect::<Vec<_>>()
                .join(", ")
        };
        let rows: Vec<String> = support
            .iter()
            .map(|(key, (children, full))| {
                let refs: Vec<String> = full
                    .iter()
                    .map(|r| format!("{{ {} }}", quoted(r)))
                    .collect();
                format!(
                    "    [{}] = {{ {{ {} }}, {{ {} }} }},",
                    lua_string(key),
                    quoted(children),
                    refs.join(", ")
                )
            })
            .collect();
        format!(
            "\x20 -- The library weapons each one names, and the references that\n\
             \x20 -- name one by the full name it gets in the unit.\n\
             \x20 local support = {{\n{}\n  }}\n",
            rows.join("\n")
        )
    };
    let support_loop = if support.is_empty() {
        ""
    } else {
        "\x20     local s = support[name]\n\
         \x20     if s then\n\
         \x20       for _, child in ipairs(s[1]) do ud[defs][child] = copy(library[child]) end\n\
         \x20       for _, r in ipairs(s[2]) do\n\
         \x20         local params = ud[defs][r[1]][r[2]]\n\
         \x20         if type(params) == \"table\" then params[r[3]] = unit .. \"_\" .. r[4] end\n\
         \x20       end\n\
         \x20     end\n"
    };
    let entries: Vec<String> = equips
        .iter()
        .map(|(unit, at, key)| {
            let at = match at {
                EquipAt::Slot(step) => step.to_string(),
                EquipAt::Death(field) => lua_string(field),
            };
            format!("    {{ {}, {at}, {} }},", lua_string(unit), lua_string(key))
        })
        .collect();
    format!(
        "-- Weapons equipped from the project's weapon library. Each goes into the\n\
         -- unit's own weapondefs, and the slot names it by def and by full name.\n\
         -- A death explosion field names it by full name.\n\
         do\n\
         \x20 local library = {}\n\
         \x20 local equipped = {{\n{}\n  }}\n\
         {}\
         \x20 local function field(t, lower)\n\
         \x20   for k in pairs(t) do\n\
         \x20     if type(k) == \"string\" and string.lower(k) == lower then return k end\n\
         \x20   end\n\
         \x20   return lower\n\
         \x20 end\n\
         \x20 local function key(list, at)\n\
         \x20   local count = 0\n\
         \x20   for _ in pairs(list) do count = count + 1 end\n\
         \x20   if count == 0 or #list == count then return at + 1 end\n\
         \x20   if list[at] == nil and list[tostring(at)] ~= nil then return tostring(at) end\n\
         \x20   return at\n\
         \x20 end\n\
         \x20 local function copy(v)\n\
         \x20   if type(v) ~= \"table\" then return v end\n\
         \x20   local out = {{}}\n\
         \x20   for k, x in pairs(v) do out[k] = copy(x) end\n\
         \x20   return out\n\
         \x20 end\n\
         \x20 for _, e in ipairs(equipped) do\n\
         \x20   local unit, at, name = e[1], e[2], e[3]\n\
         \x20   local ud = UnitDefs[unit]\n\
         \x20   local placed = false\n\
         \x20   if type(ud) == \"table\" and type(at) == \"string\" then\n\
         \x20     -- A death explosion, named by the full name the game gives\n\
         \x20     -- a definition the unit carries.\n\
         \x20     ud[field(ud, at)] = unit .. \"_\" .. name\n\
         \x20     placed = true\n\
         \x20   elseif type(ud) == \"table\" then\n\
         \x20     local weapons = ud[field(ud, \"weapons\")]\n\
         \x20     local step = type(weapons) == \"table\" and key(weapons, at) or nil\n\
         \x20     local slot = step ~= nil and weapons[step] or nil\n\
         \x20     if slot ~= nil then\n\
         \x20       if type(slot) ~= \"table\" then\n\
         \x20         slot = {{}}\n\
         \x20         weapons[step] = slot\n\
         \x20       end\n\
         \x20       for k in pairs(slot) do\n\
         \x20         local lower = type(k) == \"string\" and string.lower(k)\n\
         \x20         if lower == \"name\" or lower == \"def\" then slot[k] = nil end\n\
         \x20       end\n\
         \x20       slot.def = name\n\
         \x20       slot.name = unit .. \"_\" .. name\n\
         \x20       placed = true\n\
         \x20     end\n\
         \x20   end\n\
         \x20   if placed then\n\
         \x20     local defs = field(ud, \"weapondefs\")\n\
         \x20     if type(ud[defs]) ~= \"table\" then ud[defs] = {{}} end\n\
         \x20     ud[defs][name] = copy(library[name])\n\
         {}\
         \x20   end\n\
         \x20 end\n\
         end",
        lua_literal(&Value::Object(library), "  "),
        entries.join("\n"),
        support_table,
        support_loop
    )
}

/// The key a definition spells its build list under, so a rewrite lands on the
/// key the game will read rather than beside it. `buildoptions` in the data and
/// `buildOptions` in the engine's registry, and games have written both.
fn build_options_key(def: &Value) -> String {
    def.as_object()
        .and_then(|map| {
            map.keys()
                .find(|key| key.to_lowercase() == "buildoptions")
                .cloned()
        })
        .unwrap_or_else(|| "buildoptions".to_string())
}

/// The build list a definition declares, lowercased and de-duplicated. The same
/// read `buildMenus.ts` does, including taking an object in numeric key order,
/// which is what an empty Lua table comes back as.
fn build_options_of(def: &Value) -> Vec<String> {
    let Some(raw) = def
        .as_object()
        .and_then(|map| {
            map.iter()
                .find(|(key, _)| key.to_lowercase() == "buildoptions")
        })
        .map(|(_, value)| value)
    else {
        return Vec::new();
    };
    let entries: Vec<&Value> = match raw {
        Value::Array(items) => items.iter().collect(),
        Value::Object(map) => {
            let mut numbered: Vec<(i64, &Value)> = map
                .iter()
                .filter_map(|(key, value)| key.parse::<i64>().ok().map(|n| (n, value)))
                .collect();
            numbered.sort_by_key(|(n, _)| *n);
            numbered.into_iter().map(|(_, value)| value).collect()
        }
        _ => Vec::new(),
    };
    let mut out: Vec<String> = Vec::new();
    for entry in entries {
        let Some(name) = entry.as_str() else { continue };
        let unit = name.trim().to_lowercase();
        if !unit.is_empty() && !out.contains(&unit) {
            out.push(unit);
        }
    }
    out
}

/// Replay a menu's operations over a list. The Rust half of
/// `applyBuildMenu`, used only for a copy the project owns: a game unit's menu
/// is replayed by the generated Lua at load time instead.
fn apply_build_menu(inherited: &[String], ops: &[BuildMenuOp]) -> Vec<String> {
    let mut list: Vec<String> = inherited.to_vec();
    for op in ops {
        match op {
            BuildMenuOp::Add { unit } => {
                if !list.contains(unit) {
                    list.push(unit.clone());
                }
            }
            BuildMenuOp::Remove { unit } => list.retain(|entry| entry != unit),
            BuildMenuOp::Move { unit, before } => {
                let Some(at) = list.iter().position(|entry| entry == unit) else {
                    continue;
                };
                let moved = list.remove(at);
                match before
                    .as_ref()
                    .and_then(|name| list.iter().position(|entry| entry == name))
                {
                    Some(index) => list.insert(index, moved),
                    None => list.push(moved),
                }
            }
        }
    }
    list
}

/// Write a dotted path into a JSON definition, creating whatever it has to pass
/// through. The Rust half of `writePath` in `src/workshop/overrides.ts`, down to
/// taking a step of digits to mean an array index counted from zero.
fn write_path(target: &mut Value, steps: &[&str], value: Value) {
    let step = steps[0];
    let index = array_index(step);
    let wrong_container = match (&*target, index) {
        (Value::Array(_), None) => true,
        (Value::Object(_), Some(_)) => false,
        (Value::Array(_), Some(_)) | (Value::Object(_), None) => false,
        _ => true,
    };
    if wrong_container {
        *target = match index {
            Some(_) => Value::Array(Vec::new()),
            None => Value::Object(serde_json::Map::new()),
        };
    }
    let slot = match target {
        Value::Array(items) => {
            let Some(at) = index else { return };
            while items.len() <= at {
                items.push(Value::Null);
            }
            &mut items[at]
        }
        Value::Object(map) => map.entry(step.to_string()).or_insert(Value::Null),
        _ => return,
    };
    if steps.len() == 1 {
        *slot = value;
        return;
    }
    write_path(slot, &steps[1..], value);
}

fn array_index(step: &str) -> Option<usize> {
    if step.is_empty() || !step.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    step.parse().ok()
}

/// The table form: unit name to whole definition.
fn unit_table(entries: &[(String, Value)], indent: &str) -> String {
    let inner = format!("{indent}  ");
    let body = entries
        .iter()
        .map(|(key, def)| {
            format!(
                "{inner}[{}] = {},",
                lua_string(key),
                lua_literal(def, &inner)
            )
        })
        .collect::<Vec<_>>()
        .join("\n");
    format!("{{\n{body}\n{indent}}}")
}

/// Every unit a project adds, as assignments (issue #2962).
///
/// The same thing [`bar_tweakdefs_body`] writes for the single-slot route,
/// wrapped in `do ... end` so a numbered slot can carry it alongside another
/// mod's. Assignment rather than a merge because there is nothing to merge
/// onto: the game has no unit of this name, which is the whole point of a
/// copy, and BAR's merge would find no key and drop it.
///
/// One table and one loop rather than a line per unit, so a project adding
/// sixty units does not write `UnitDefs[...] =` sixty times into a slot with
/// a size cap on it.
fn added_block(entries: &[(String, Value)]) -> String {
    format!(
        "-- Units added. Assigned directly: none of these existed before, so there is\n\
         -- nothing to merge onto.\n\
         do\n  local added = {}\n  for name, def in pairs(added) do\n    UnitDefs[name] = def\n  end\nend",
        unit_table(entries, "  "),
    )
}

/// Field changes through a list position, each applied to the table the
/// game has when it loads (issue #3041).
///
/// A step of digits is written as a Lua number and every other step as a
/// string. `key` turns a number into the key the unit page meant, by the
/// rule the unitsync worker reads a table with: a table numbered 1 to n is a
/// list counted from zero, and any other table is keyed by its own keys. A
/// table not there yet is made a list, as `writePath` in `overrides.ts`
/// makes one. The last step is merged or set the way the patch table's own
/// `merge` would, and a unit the game no longer has is skipped.
fn positional_block(changes: &[(&str, &str, &Value)]) -> String {
    let entries: Vec<String> = changes
        .iter()
        .map(|(unit, path, value)| {
            let steps: Vec<String> = path
                .split('.')
                .map(|step| match step.parse::<u64>() {
                    Ok(n) if step.bytes().all(|b| b.is_ascii_digit()) => n.to_string(),
                    _ => lua_string(step),
                })
                .collect();
            format!(
                "    {{ {}, {{ {} }}, {} }},",
                lua_string(unit),
                steps.join(", "),
                lua_literal(value, "    ")
            )
        })
        .collect();
    format!(
        "-- Field changes through a list position, matched against the game's own\n\
         -- list when it loads.\n\
         do\n\
         \x20 local changes = {{\n{}\n  }}\n\
         \x20 local function key(list, at)\n\
         \x20   local count = 0\n\
         \x20   for _ in pairs(list) do count = count + 1 end\n\
         \x20   if count == 0 or #list == count then return at + 1 end\n\
         \x20   if list[at] == nil and list[tostring(at)] ~= nil then return tostring(at) end\n\
         \x20   return at\n\
         \x20 end\n\
         \x20 local function merge(dest, src)\n\
         \x20   for k, v in pairs(src) do\n\
         \x20     if type(v) == \"table\" and type(dest[k]) == \"table\" then\n\
         \x20       merge(dest[k], v)\n\
         \x20     else\n\
         \x20       dest[k] = v\n\
         \x20     end\n\
         \x20   end\n\
         \x20 end\n\
         \x20 for _, change in ipairs(changes) do\n\
         \x20   local target, steps, value = UnitDefs[change[1]], change[2], change[3]\n\
         \x20   for i = 1, #steps do\n\
         \x20     if type(target) ~= \"table\" or value == nil then break end\n\
         \x20     local step = steps[i]\n\
         \x20     if type(step) == \"number\" then step = key(target, step) end\n\
         \x20     if i < #steps then\n\
         \x20       if type(target[step]) ~= \"table\" then target[step] = {{}} end\n\
         \x20       target = target[step]\n\
         \x20     elseif type(value) == \"table\" and type(target[step]) == \"table\" then\n\
         \x20       merge(target[step], value)\n\
         \x20     else\n\
         \x20       target[step] = value\n\
         \x20     end\n\
         \x20   end\n\
         \x20 end\n\
         end",
        entries.join("\n")
    )
}

/// The table form again, for patches rather than whole definitions.
fn patch_table(entries: &[(String, PatchTree)], indent: &str) -> String {
    let inner = format!("{indent}  ");
    let body = entries
        .iter()
        .map(|(key, tree)| format!("{inner}[{}] = {},", lua_string(key), tree.to_lua(&inner)))
        .collect::<Vec<_>>()
        .join("\n");
    format!("{{\n{body}\n{indent}}}")
}

/// A whole definition standing in for one the game already loaded.
fn replace_block(clone: &UnitClone, def: &Value) -> String {
    let from = match &clone.source {
        Some(source) => format!(" Copied from {}.", comment_text(source)),
        None => String::new(),
    };
    format!(
        "-- Replaces the game's own {key}.{from}\ndo\n  UnitDefs[{key}] = {def}\nend",
        key = lua_string(&clone.key),
        def = lua_literal(def, "  "),
    )
}

/// One builder's menu, replayed over whatever the game ships.
///
/// Written to stand on its own, because issue #1277 packs each block into a
/// numbered slot of its own and a block that leaned on a helper defined in
/// another slot would break the moment they were ordered differently.
fn menu_block(builder: &str, ops: &[BuildMenuOp]) -> String {
    let mut lines = vec![
        format!("-- Build menu for {}.", comment_text(builder)),
        "do".to_string(),
        format!("  local def = UnitDefs[{}]", lua_string(builder)),
        "  if def then".to_string(),
        // The key as this game spells it, so the rewrite lands on the list the
        // engine reads rather than beside it.
        "    local key = \"buildoptions\"".to_string(),
        "    if def[key] == nil then".to_string(),
        "      for k in pairs(def) do".to_string(),
        "        if string.lower(k) == \"buildoptions\" then".to_string(),
        "          key = k".to_string(),
        "          break".to_string(),
        "        end".to_string(),
        "      end".to_string(),
        "    end".to_string(),
        // Every numbered entry in key order, closed up. Games comment entries
        // out and leave gaps in the numbering, and the engine keeps what
        // follows a gap, which `#` and `table.remove` would not.
        "    local list = {}".to_string(),
        "    if type(def[key]) == \"table\" then".to_string(),
        "      local keys = {}".to_string(),
        "      for i in pairs(def[key]) do".to_string(),
        "        if type(i) == \"number\" then".to_string(),
        "          keys[#keys + 1] = i".to_string(),
        "        end".to_string(),
        "      end".to_string(),
        "      table.sort(keys)".to_string(),
        "      for _, i in ipairs(keys) do".to_string(),
        "        list[#list + 1] = def[key][i]".to_string(),
        "      end".to_string(),
        "    end".to_string(),
        "    local function at(unit)".to_string(),
        "      for i = 1, #list do".to_string(),
        "        if string.lower(tostring(list[i])) == unit then".to_string(),
        "          return i".to_string(),
        "        end".to_string(),
        "      end".to_string(),
        "    end".to_string(),
    ];
    for op in ops {
        match op {
            BuildMenuOp::Add { unit } => {
                let unit = lua_string(unit);
                lines.push(format!("    if not at({unit}) then"));
                lines.push(format!("      list[#list + 1] = {unit}"));
                lines.push("    end".to_string());
            }
            BuildMenuOp::Remove { unit } => {
                lines.push("    do".to_string());
                lines.push(format!("      local i = at({})", lua_string(unit)));
                lines.push("      if i then".to_string());
                lines.push("        table.remove(list, i)".to_string());
                lines.push("      end".to_string());
                lines.push("    end".to_string());
            }
            BuildMenuOp::Move { unit, before } => {
                lines.push("    do".to_string());
                lines.push(format!("      local i = at({})", lua_string(unit)));
                lines.push("      if i then".to_string());
                lines.push("        local moved = table.remove(list, i)".to_string());
                match before {
                    Some(anchor) => {
                        lines.push(format!("        local before = at({})", lua_string(anchor)));
                        lines.push("        if before then".to_string());
                        lines.push("          table.insert(list, before, moved)".to_string());
                        lines.push("        else".to_string());
                        lines.push("          list[#list + 1] = moved".to_string());
                        lines.push("        end".to_string());
                    }
                    None => lines.push("        list[#list + 1] = moved".to_string()),
                }
                lines.push("      end".to_string());
                lines.push("    end".to_string());
            }
        }
    }
    lines.push("    def[key] = list".to_string());
    lines.push("  end".to_string());
    lines.push("end".to_string());
    lines.join("\n")
}

/// Every unit the project switches off, taken out of every build list.
///
/// A mark against a unit and never an edit to a menu, which is the whole reason
/// `disabled.ts` is a store of its own: re-enabling puts every placement back
/// exactly, because nothing was ever recorded as taken away.
fn disabled_block(disabled: &[String]) -> String {
    let entries = disabled
        .iter()
        .map(|unit| format!("    [{}] = true,", lua_string(unit)))
        .collect::<Vec<_>>()
        .join("\n");
    format!(
        "-- Units switched off, taken out of every build menu in the game.\n\
         do\n\
         \x20 local off = {{\n{entries}\n  }}\n\
         \x20 for _, def in pairs(UnitDefs) do\n\
         \x20   for key, list in pairs(def) do\n\
         \x20     if string.lower(key) == \"buildoptions\" and type(list) == \"table\" then\n\
         \x20       local keys = {{}}\n\
         \x20       for i in pairs(list) do\n\
         \x20         if type(i) == \"number\" then\n\
         \x20           keys[#keys + 1] = i\n\
         \x20         end\n\
         \x20       end\n\
         \x20       table.sort(keys)\n\
         \x20       local kept = {{}}\n\
         \x20       for _, i in ipairs(keys) do\n\
         \x20         if not off[string.lower(tostring(list[i]))] then\n\
         \x20           kept[#kept + 1] = list[i]\n\
         \x20         end\n\
         \x20       end\n\
         \x20       def[key] = kept\n\
         \x20     end\n\
         \x20   end\n\
         \x20 end\n\
         end"
    )
}

/// Text that is safe to put in a `--` comment: one line, no control characters.
///
/// A newline inside one would end the comment and leave whatever came after it
/// as Lua the game runs. Everything that reaches a Lua string is escaped by
/// `lua_string`, and these are the values that do not: a project's name, which
/// somebody typed, and a unit key, which arrives in a file somebody sent.
fn comment_text(text: &str) -> String {
    text.chars()
        .map(|c| if c.is_control() { ' ' } else { c })
        .collect()
}

/// A header saying where a file came from, on every file the compiler writes.
fn header(project: &ModProject) -> String {
    let name = if project.name.is_empty() {
        "an unnamed project".to_string()
    } else {
        comment_text(&project.name)
    };
    format!("-- Compiled by coilbox from the tweak project \"{name}\".\n-- Rewritten every time the project compiles, so edit the project, not this.\n")
}

/// Where one language's words go in the generated archive.
fn language_file_path(code: &str) -> String {
    format!("language/{code}/{LANGUAGE_FILE}")
}

/// Whether a code can name a language folder.
///
/// Checked for the reason [`valid_unit_key`] is: the code becomes a folder
/// name under the generated archive, and a project arrives as JSON somebody
/// may have written by hand or been sent. Every code coilbox reads comes out
/// of an archive member path the worker already narrowed to a single segment
/// (`language_code_of` in `dataset.rs`), so nothing the app itself produces is
/// turned away here. Hyphens and underscores are allowed because real locales
/// use both: Beyond All Reason ships a `test_unicode`, and `pt-br` is the
/// shape the wider Spring scene writes a regional locale in.
fn valid_language_code(code: &str) -> bool {
    !code.is_empty()
        && code
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_' || b == b'-')
}

/// One JSON file per language the project has words in, and how many edits
/// they carry between them.
///
/// The count is the compiler's own rather than [`GameEdits::text_edit_count`],
/// so that an edit in a language code this refused is not counted as carried.
fn language_files(edits: &GameEdits) -> (Vec<CompiledFile>, usize) {
    // Language code, then field, then unit: the shape the game reads, and
    // `BTreeMap` all the way down so two compiles of one project are the same
    // bytes.
    type ByUnit = std::collections::BTreeMap<String, String>;
    let mut by_language: std::collections::BTreeMap<String, (ByUnit, ByUnit)> =
        std::collections::BTreeMap::new();
    let mut carried = 0usize;

    for (unit, languages) in &edits.text {
        for (code, fields) in languages {
            if !valid_language_code(code) {
                continue;
            }
            let entry = by_language.entry(code.clone()).or_default();
            if let Some(name) = &fields.name {
                entry.0.insert(unit.clone(), name.clone());
                carried += 1;
            }
            if let Some(description) = &fields.description {
                entry.1.insert(unit.clone(), description.clone());
                carried += 1;
            }
        }
    }

    let files = by_language
        .into_iter()
        .map(|(code, (names, descriptions))| {
            let mut units = serde_json::Map::new();
            if !names.is_empty() {
                units.insert("names".to_string(), json_of(names));
            }
            if !descriptions.is_empty() {
                units.insert("descriptions".to_string(), json_of(descriptions));
            }
            let body = Value::Object(
                [("units".to_string(), Value::Object(units))]
                    .into_iter()
                    .collect(),
            );
            CompiledFile {
                path: language_file_path(&code),
                // Pretty printed and no header comment: JSON has no comment
                // syntax, and a key holding one would become a translation
                // the game loads. Which project wrote the file is what the
                // archive's own `modinfo.lua` is for.
                contents: format!(
                    "{}\n",
                    serde_json::to_string_pretty(&body).unwrap_or_else(|_| "{}".to_string())
                ),
            }
        })
        .collect();
    (files, carried)
}

/// A map of unit to string as a JSON object.
fn json_of(entries: std::collections::BTreeMap<String, String>) -> Value {
    Value::Object(
        entries
            .into_iter()
            .map(|(unit, text)| (unit, Value::String(text)))
            .collect(),
    )
}

/// One copy's own file, which is what a game's `units/` folder is full of.
fn unit_file(project: &ModProject, key: &str, def: &Value) -> String {
    format!(
        "{}\nreturn {{\n  [{}] = {},\n}}\n",
        header(project),
        lua_string(key),
        lua_literal(def, "  "),
    )
}

/// The project's `gamedata/armordefs.lua` (issue #2645), or `None` when it
/// moves nothing.
///
/// `edits.armor_classes.base`, the snapshot taken when the project moved its
/// first unit, with every move applied on top: a unit named in a move is
/// dropped out of whichever of `base`'s lists names it (case insensitively,
/// matching the engine's own lookup), then added to its target class's list,
/// unless that target is `"default"`, which needs no list of its own.
fn armor_defs_file(edits: &GameEdits) -> Option<CompiledFile> {
    if edits.armor_classes.moves.is_empty() {
        return None;
    }
    let moved: std::collections::BTreeSet<String> = edits
        .armor_classes
        .moves
        .keys()
        .map(|k| k.to_lowercase())
        .collect();
    let mut classes: BTreeMap<String, Vec<String>> = edits
        .armor_classes
        .base
        .iter()
        .map(|(name, members)| {
            let kept = members
                .iter()
                .filter(|m| !moved.contains(&m.to_lowercase()))
                .cloned()
                .collect();
            (name.clone(), kept)
        })
        .collect();
    for (unit, class) in &edits.armor_classes.moves {
        if class.eq_ignore_ascii_case("default") {
            continue;
        }
        classes.entry(class.clone()).or_default().push(unit.clone());
    }
    Some(CompiledFile {
        path: ARMOR_FILE.to_string(),
        contents: armor_defs_lua(&classes),
    })
}

/// [`armor_defs_file`]'s Lua: the same shape `gamedata/armordefs.lua` already
/// has in every game measured for issue #2645, a class name to an array of
/// unit def names, keyed with `[...]` rather than a bare word so a class name
/// the game itself spelled oddly still writes out as valid Lua.
fn armor_defs_lua(classes: &BTreeMap<String, Vec<String>>) -> String {
    let mut out = String::from(
        "-- Written by coilbox (issue #2645). Replaces the base game's own\n-- gamedata/armordefs.lua whole: the engine reads this file's table in one\n-- piece, and this archive covers up the base game's copy of it entirely.\nlocal armorDefs = {\n",
    );
    for (name, members) in classes {
        out.push_str(&format!("  [{}] = {{\n", lua_string(name)));
        for member in members {
            out.push_str(&format!("    {},\n", lua_string(member)));
        }
        out.push_str("  },\n");
    }
    out.push_str("}\nreturn armorDefs\n");
    out
}

/// A constant colour as `CColorMap::LoadFromDefString` reads one: whitespace
/// separated floats, at least two RGBA groups
/// (`rts/Rendering/Textures/ColorMap.cpp:98,143`). A flat colour is just the
/// same stop written twice, which is enough for what the form offers.
fn ceg_colormap(color: &crate::model::CegColor) -> String {
    let stop = format!("{} {} {} 1", color.r, color.g, color.b);
    format!("{stop} {stop}")
}

/// One generator's class specific properties, keyed by the name the engine's
/// `GetMemberInfo` chain reads for that class (`ExpGenSpawnableMemberInfo.h`,
/// and the class's own `.cpp`, see `explosionGenerators.ts`'s doc comment for
/// the file and line of each). Ground flash takes no `properties` table at
/// all, so it never calls this function. Its own reserved shape is
/// [`ceg_groundflash_value`].
fn ceg_properties(generator: &ExplosionGenerator) -> Value {
    let mut props = serde_json::Map::new();
    match generator.class {
        CegClass::CBitmapMuzzleFlame => {
            if let Some(texture) = &generator.texture {
                props.insert("sidetexture".to_string(), json!(texture));
                props.insert("fronttexture".to_string(), json!(texture));
            }
            if let Some(color) = &generator.color {
                props.insert("colormap".to_string(), json!(ceg_colormap(color)));
            }
            if let Some(size) = generator.size {
                props.insert("size".to_string(), json!(size));
            }
            if let Some(lifetime) = generator.lifetime {
                props.insert("ttl".to_string(), json!(lifetime as i64));
            }
        }
        CegClass::CSimpleParticleSystem => {
            if let Some(texture) = &generator.texture {
                props.insert("texture".to_string(), json!(texture));
            }
            if let Some(color) = &generator.color {
                props.insert("colormap".to_string(), json!(ceg_colormap(color)));
            }
            if let Some(size) = generator.size {
                props.insert("particlesize".to_string(), json!(size));
            }
            if let Some(lifetime) = generator.lifetime {
                props.insert("particlelife".to_string(), json!(lifetime));
            }
            if let Some(particles) = generator.particles {
                props.insert("numparticles".to_string(), json!(particles));
            }
        }
        CegClass::CHeatCloudProjectile => {
            if let Some(texture) = &generator.texture {
                props.insert("texture".to_string(), json!(texture));
            }
            if let Some(size) = generator.size {
                props.insert("size".to_string(), json!(size));
            }
            if let Some(lifetime) = generator.lifetime {
                props.insert("heatfalloff".to_string(), json!(lifetime));
            }
        }
        CegClass::CStandardGroundFlash => {}
    }
    Value::Object(props)
}

/// The reserved `groundflash` sub-table `CCustomExplosionGenerator::Load`
/// parses outside the ordinary spawn loop, and always gates on `ground`
/// itself (`ExplosionGenerator.cpp:1027-1039`), so neither a repeat count
/// nor the gating flags the other three classes take are written here.
fn ceg_groundflash_value(generator: &ExplosionGenerator) -> Value {
    let mut flash = serde_json::Map::new();
    if let Some(lifetime) = generator.lifetime {
        flash.insert("ttl".to_string(), json!(lifetime as i64));
    }
    if let Some(color) = &generator.color {
        flash.insert("color".to_string(), json!([color.r, color.g, color.b]));
    }
    if let Some(size) = generator.size {
        flash.insert("flashSize".to_string(), json!(size));
    }
    Value::Object(flash)
}

/// One generator's spawn entry, for every class but ground flash: `class`,
/// the repeat `count` (default 1, `ExplosionGenerator.cpp:978`), the gating
/// flags read straight off the spawn table rather than `properties`
/// (`GetFlagsFromTable`, `ExplosionGenerator.cpp:60`), and the class's own
/// `properties`.
fn ceg_spawn_value(generator: &ExplosionGenerator) -> Value {
    let class_name = match generator.class {
        CegClass::CBitmapMuzzleFlame => "CBitmapMuzzleFlame",
        CegClass::CSimpleParticleSystem => "CSimpleParticleSystem",
        CegClass::CHeatCloudProjectile => "CHeatCloudProjectile",
        CegClass::CStandardGroundFlash => unreachable!("ground flash has no spawn entry"),
    };
    json!({
        "class": class_name,
        "count": generator.count,
        "ground": generator.ground,
        "water": generator.water,
        "air": generator.air,
        "underwater": generator.underwater,
        "properties": ceg_properties(generator),
    })
}

/// One generator's whole CEG entry: `{ groundflash = {...} }` for
/// `CStandardGroundFlash`, `{ spawn1 = {...} }` for the other three.
fn ceg_entry_value(generator: &ExplosionGenerator) -> Value {
    if generator.class == CegClass::CStandardGroundFlash {
        json!({ "groundflash": ceg_groundflash_value(generator) })
    } else {
        json!({ "spawn1": ceg_spawn_value(generator) })
    }
}

/// A generator's whole `effects/<key>.lua` (issue #2643): a table of CEG name
/// to entry, the same shape every file under `effects/` returns
/// (`gamedata/explosions.lua`'s `LoadLuas`, in `cont/base/springcontent`).
/// One file per generator, one entry per file, since the form edits one
/// generator at a time.
fn ceg_file(generator: &ExplosionGenerator) -> String {
    format!(
        "-- Written by coilbox (issue #2643). The engine merges every file under\n-- effects/ into the shared table gamedata/explosions.lua returns\n-- (rts/Sim/Projectiles/ExplosionGenerator.cpp), keyed by the name a weapon\n-- field names.\nreturn {{\n  [{}] = {},\n}}\n",
        lua_string(&generator.key),
        lua_literal(&ceg_entry_value(generator), "  "),
    )
}

/// The patch table with the code that applies it: every field change, merged
/// onto whatever `UnitDefs` already holds. Shared by [`post_file`] and
/// [`bar_tweakdefs_body`], which both run this over the same `UnitDefs` the
/// engine loaded, just reached through a different slot.
fn write_patches_section(out: &mut String, patches: &[(String, PatchTree)]) {
    if patches.is_empty() {
        return;
    }
    out.push_str("\n-- Field changes. Only the fields the project set are here, so everything\n");
    out.push_str("-- else still follows the game when it updates.\n");
    out.push_str(&format!("local changes = {}\n", patch_table(patches, "")));
    out.push_str(
        "\nlocal function merge(dest, src)\n\
         \x20 for key, value in pairs(src) do\n\
         \x20   if type(value) == \"table\" and type(dest[key]) == \"table\" then\n\
         \x20     merge(dest[key], value)\n\
         \x20   else\n\
         \x20     dest[key] = value\n\
         \x20   end\n\
         \x20 end\n\
         end\n\n",
    );
    out.push_str(
        "-- A unit the game no longer has is skipped rather than created: a patch is a\n\
         -- change to a definition, and half of one is not a unit.\n\
         for name, patch in pairs(changes) do\n\
         \x20 local def = UnitDefs[name]\n\
         \x20 if def then\n\
         \x20   merge(def, patch)\n\
         \x20 end\n\
         end\n",
    );
}

/// Every block, one after another. Shared by [`post_file`] and
/// [`bar_tweakdefs_body`] for the reason [`write_patches_section`] is.
fn write_blocks_section(out: &mut String, blocks: &[&str]) {
    for block in blocks {
        out.push('\n');
        out.push_str(block);
        out.push('\n');
    }
}

/// The executable half of the mutator: the patch table with the code that
/// applies it, then every block.
fn post_file(project: &ModProject, patches: &[(String, PatchTree)], blocks: &[&str]) -> String {
    let mut out = header(project);
    write_patches_section(&mut out, patches);
    write_blocks_section(&mut out, blocks);
    out
}

/// The same edits as one payload for BAR's bare `tweakdefs` mod option
/// (issue #1278). Everything [`post_file`] runs, plus the units a project
/// adds, folded in as plain assignments rather than left for a `tweakunits`
/// slot: see [`CompiledMod::bar_tweakdefs`] for why.
fn bar_tweakdefs_body(
    project: &ModProject,
    added: &[(String, Value)],
    patches: &[(String, PatchTree)],
    blocks: &[&str],
) -> String {
    let mut out = header(project);
    if !added.is_empty() {
        out.push_str(
            "\n-- Units added. Assigned directly: none of these existed before, so there is\n",
        );
        out.push_str("-- nothing to merge onto.\n");
        out.push_str(&format!("local added = {}\n", unit_table(added, "")));
        out.push_str("for name, def in pairs(added) do\n  UnitDefs[name] = def\nend\n");
    }
    write_patches_section(&mut out, patches);
    write_blocks_section(&mut out, blocks);
    out
}

/// A mutator's `modinfo.lua`.
///
/// `modtype = 1` is what makes it a game the engine can be launched with. The
/// single `depend` entry is the name unitsync reports for the base game, which
/// is the same string a start script names, so the two cannot drift apart. The
/// same shape `src/scenario/mutator.ts` and `src/lego/scratchGame.ts` write.
fn modinfo(project: &ModProject) -> String {
    modinfo_versioned(project, MUTATOR_VERSION)
}

/// [`modinfo`] with an explicit version rather than the placeholder every
/// other route leaves in place. `package.rs` calls this directly to render
/// the file a second time with the version being published, since nothing
/// else about a compile depends on the archive's own version.
pub(crate) fn modinfo_versioned(project: &ModProject, version: &str) -> String {
    let name = if project.name.is_empty() {
        "Coilbox tweaks"
    } else {
        &project.name
    };
    let description = match project.description.as_deref().map(str::trim) {
        Some(text) if !text.is_empty() => text.to_string(),
        _ => format!("Tweaks for {}, made with coilbox.", project.game_name),
    };
    format!(
        "{header}\n\
         return {{\n\
         \x20 name = {name},\n\
         \x20 shortname = {shortname},\n\
         \x20 game = {name},\n\
         \x20 version = {version},\n\
         \x20 description = {description},\n\
         \x20 modtype = 1,\n\
         \x20 depend = {{\n\
         \x20   {depend},\n\
         \x20 }},\n\
         }}\n",
        header = header(project),
        name = lua_string(name),
        shortname = lua_string(&shortname(name)),
        version = lua_string(version),
        description = lua_string(&description),
        depend = lua_string(&project.game_name),
    )
}

/// Whether a key can be a unit's internal name.
///
/// `checkCloneName` in `src/workshop/clones.ts` holds a new copy to this, and
/// every unit key in both games installed here matches it. Checked again
/// because the key becomes a file name under the generated archive and a
/// project arrives as JSON that somebody may have written by hand.
pub(crate) fn valid_unit_key(key: &str) -> bool {
    !key.is_empty()
        && key
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_')
}

/// A short name for the archive, out of the project's own.
fn shortname(name: &str) -> String {
    let slug: String = name
        .to_lowercase()
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '_' })
        .collect();
    let slug = slug.trim_matches('_').to_string();
    if slug.is_empty() {
        "coilbox_tweaks".to_string()
    } else {
        format!("coilbox_{slug}")
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn project(edits: Value) -> ModProject {
        serde_json::from_value(json!({
            "name": "Faster commanders",
            "gameName": "Balanced Annihilation V15.9.8",
            "edits": edits,
        }))
        .expect("parse")
    }

    /// One class's own `{ ... }` body out of a compiled `armordefs.lua`, so a
    /// test can say a unit is or is not a member of it without a substring
    /// match landing in a different class by coincidence.
    fn class_block<'a>(lua: &'a str, name: &str) -> &'a str {
        let key = format!("[{:?}] = {{", name);
        let start = lua
            .find(&key)
            .unwrap_or_else(|| panic!("no {name} in {lua}"));
        let body = &lua[start + key.len()..];
        let end = body.find("},\n").unwrap_or(body.len());
        &body[..end]
    }

    fn file<'a>(out: &'a CompiledMod, path: &str) -> &'a str {
        &out.files
            .iter()
            .find(|f| f.path == path)
            .unwrap_or_else(|| {
                panic!(
                    "no {path} in {:?}",
                    out.files.iter().map(|f| &f.path).collect::<Vec<_>>()
                )
            })
            .contents
    }

    #[test]
    fn a_project_that_changes_nothing_compiles_to_nothing() {
        let out = compile(&project(json!({})));
        assert!(out.chunks.is_empty());
        assert!(out.files.is_empty());
        assert!(out.notes.is_empty());
        assert!(out.bar_tweakdefs.is_none());
    }

    /// The form the issue asks for on the simple case: a plain table, no code.
    #[test]
    fn a_field_change_is_a_table_and_carries_only_the_field() {
        let out = compile(&project(json!({
            "overrides": { "armcom": { "maxDamage": 5000 } }
        })));
        let chunk = &out.chunks[0];
        assert_eq!(chunk.form, LuaForm::Table);
        assert_eq!(chunk.lua, "{\n  [\"armcom\"] = { maxDamage = 5000 },\n}");
        // Nothing but the one field: the whole point of a sparse override.
        assert!(!chunk.lua.contains("buildoptions"));
    }

    /// A patch against a weapon must not invent the weapons it does not
    /// mention. Which weapon its step is depends on whether the game's list
    /// has a gap (issue #3041), so it is a block that reads the list first,
    /// and the rest of the unit's changes stay in the plain table.
    /// `tests/generated_lua_runs.rs` runs it.
    #[test]
    fn a_patch_into_a_weapon_is_a_block_that_reads_the_list_first() {
        let out = compile(&project(json!({
            "overrides": { "armcom": { "weapons.1.name": "CANNON", "maxDamage": 5000 } }
        })));
        assert_eq!(out.chunks.len(), 2);
        assert_eq!(out.chunks[0].form, LuaForm::Table);
        assert_eq!(out.chunks[0].title, "1 field change");
        assert!(!out.chunks[0].lua.contains("weapons"));
        let block = &out.chunks[1];
        assert_eq!(block.form, LuaForm::Block);
        assert_eq!(block.title, "1 field change through a list");
        assert!(block
            .lua
            .contains("{ \"armcom\", { \"weapons\", 1, \"name\" }, \"CANNON\" },"));
        for route in [
            &out.files
                .iter()
                .find(|f| f.path == POST_FILE)
                .expect("post file")
                .contents,
            out.bar_tweakdefs.as_ref().expect("tweakdefs"),
        ] {
            assert!(route.contains(&block.lua));
            assert!(route.contains("maxDamage = 5000"));
        }
    }

    /// Issue #2639. A slot field and a definition field are written into two
    /// different tables of the same unit: the slot through its position in
    /// the list, the definition by name inside the unit's own `weapondefs`.
    #[test]
    fn a_slot_edit_and_a_definition_edit_land_in_their_own_tables() {
        let out = compile(&project(json!({
            "overrides": { "armcom": {
                "weapons.0.onlytargetcategory": "SURFACE",
                "weapondefs.armcomlaser.range": 400,
                "weapondefs.armcomlaser.damage.subs": 20
            } }
        })));
        let table = &out.chunks[0];
        assert_eq!(table.form, LuaForm::Table);
        assert!(table
            .lua
            .contains("weapondefs = {\n      armcomlaser = {\n        damage = { subs = 20 },\n        range = 400,"));
        assert!(!table.lua.contains("onlytargetcategory"));
        let block = &out.chunks[1];
        assert_eq!(block.form, LuaForm::Block);
        assert!(block
            .lua
            .contains("{ \"armcom\", { \"weapons\", 0, \"onlytargetcategory\" }, \"SURFACE\" },"));
        assert!(!block.lua.contains("weapondefs"));
    }

    /// Issue #2639. A copy's slots name the unit it was copied from, which
    /// would fire the source's weapon and leave the copy's own definition, and
    /// every edit to it, mounted by nothing. See [`mount_own_weapons`].
    #[test]
    fn a_copys_slots_mount_the_definitions_the_copy_carries() {
        let out = compile(&project(json!({
            "clones": { "supercom": {
                "key": "supercom", "source": "armcom",
                "replacesGameUnit": false,
                "def": {
                    "weapons": [
                        { "name": "armcom_armcomlaser", "onlytargetcategory": "NOTSUB" },
                        { "name": "ARM_LIGHTLASER" },
                        { "name": "corcom_corlaser" }
                    ],
                    "weapondefs": { "armcomlaser": { "range": 300 } }
                }
            } },
            "overrides": { "supercom": { "weapondefs.armcomlaser.range": 450 } }
        })));
        let unit = file(&out, "units/supercom.lua");
        assert!(unit.contains("name = \"supercom_armcomlaser\""), "{unit}");
        assert!(unit.contains("range = 450"), "{unit}");
        // A shared weapon, and one another unit carries, are left as they were.
        assert!(unit.contains("name = \"ARM_LIGHTLASER\""), "{unit}");
        assert!(unit.contains("name = \"corcom_corlaser\""), "{unit}");
    }

    /// A copy standing in for the unit it was copied from already has the
    /// prefix its slots use.
    #[test]
    fn a_replacing_copy_keeps_its_slot_names() {
        let clone: UnitClone = serde_json::from_value(json!({
            "key": "armcom", "source": "armcom", "replacesGameUnit": true,
            "def": {
                "weapons": [{ "name": "armcom_armcomlaser" }],
                "weapondefs": { "armcomlaser": {} }
            }
        }))
        .expect("parse");
        let def = resolved_clone_def(&clone, &GameEdits::default());
        assert_eq!(def["weapons"][0]["name"], json!("armcom_armcomlaser"));
    }

    fn library() -> Value {
        json!({ "heavylaser": {
            "key": "heavylaser",
            "source": "armcom_armcomlaser",
            "def": { "range": 300, "damage": { "default": 75 } },
            "changes": { "range": 450 }
        } })
    }

    /// Issue #2640. A library weapon equipped into a game unit is one block,
    /// carrying the weapon with its changes folded in, and a weapon the
    /// library holds but nothing equips is not compiled at all.
    #[test]
    fn an_equipped_weapon_is_a_block_carrying_the_weapon_with_its_changes() {
        let mut weapons = library();
        weapons["unused"] = json!({ "key": "unused", "def": { "range": 1 } });
        let out = compile(&project(json!({
            "weapons": weapons,
            "equipped": { "armcom": { "0": "heavylaser" } }
        })));
        assert_eq!(out.chunks.len(), 1);
        let chunk = &out.chunks[0];
        assert_eq!(chunk.form, LuaForm::Block);
        assert_eq!(chunk.title, "1 weapon equipped");
        assert!(chunk.lua.contains("range = 450"), "{}", chunk.lua);
        assert!(!chunk.lua.contains("range = 300"), "{}", chunk.lua);
        assert!(chunk.lua.contains("{ \"armcom\", 0, \"heavylaser\" },"));
        assert!(!chunk.lua.contains("unused"));
        assert!(out.bar_tweakdefs.expect("tweakdefs").contains("heavylaser"));
    }

    /// A copy's definition is the project's own, so a weapon equipped into
    /// it is written straight into its file: into its own `weapondefs`, with
    /// the slot naming it both ways and keeping its mount fields.
    #[test]
    fn a_weapon_equipped_into_a_copy_is_folded_into_its_file() {
        let out = compile(&project(json!({
            "weapons": library(),
            "clones": { "supercom": {
                "key": "supercom", "source": "armcom",
                "replacesGameUnit": false,
                "def": {
                    "weapons": [
                        { "name": "armcom_armcomlaser", "onlytargetcategory": "NOTSUB" },
                        { "name": "ARM_LIGHTLASER" }
                    ],
                    "weapondefs": { "armcomlaser": { "range": 300 } }
                }
            } },
            "equipped": { "supercom": { "1": "heavylaser" } }
        })));
        assert!(out.chunks.iter().all(|c| !c.title.contains("equipped")));
        let unit = file(&out, "units/supercom.lua");
        assert!(unit.contains("def = \"heavylaser\""), "{unit}");
        assert!(unit.contains("name = \"supercom_heavylaser\""), "{unit}");
        assert!(!unit.contains("ARM_LIGHTLASER"), "{unit}");
        assert!(unit.contains("name = \"supercom_armcomlaser\""), "{unit}");
        assert!(unit.contains("heavylaser = {"), "{unit}");
        assert!(unit.contains("range = 450"), "{unit}");
    }

    /// The table a compiled weapon file returns.
    fn weapon_table(out: &CompiledMod, path: &str) -> Value {
        coilbox_springlua::SpringLua::new(std::env::temp_dir())
            .expect("vm")
            .eval_value_raw(file(out, path), path)
            .expect("the file runs")
    }

    /// Issue #3068. Each unit and library weapon it carries gets a file under
    /// `weapons/` holding the weapon under the full name its slot and death
    /// explosion give it, whether the unit is the game's or a copy. A weapon
    /// in two places on one unit is one file, and the tweak slot export,
    /// which cannot carry files, is still made.
    #[test]
    fn every_equipped_weapon_gets_a_weapon_file_under_its_full_name() {
        let out = compile(&project(json!({
            "weapons": library(),
            "clones": { "supercom": {
                "key": "supercom", "source": "armcom",
                "replacesGameUnit": false,
                "def": { "weapons": [{ "name": "armcom_armcomlaser" }] }
            } },
            "equipped": {
                "armcom": { "0": "heavylaser", "explodeas": "heavylaser" },
                "supercom": { "0": "heavylaser" },
            }
        })));
        let paths: Vec<&str> = out
            .files
            .iter()
            .map(|f| f.path.as_str())
            .filter(|p| p.starts_with("weapons/"))
            .collect();
        assert_eq!(
            paths,
            vec![
                "weapons/coilbox_armcom_heavylaser.lua",
                "weapons/coilbox_supercom_heavylaser.lua"
            ]
        );
        let table = weapon_table(&out, "weapons/coilbox_armcom_heavylaser.lua");
        assert_eq!(
            table,
            json!({ "armcom_heavylaser": { "range": 450, "damage": { "default": 75 } } })
        );
        assert!(out
            .notes
            .iter()
            .any(|n| n.starts_with("2 weapon files written under weapons/")));
        assert!(out.bar_tweakdefs.is_some());
    }

    /// Issue #3068, with #2641. The weapons a library weapon names go into
    /// its weapon file too, each under the unit's full name for it, and a
    /// full-name reference between them points at that name.
    #[test]
    fn a_weapon_file_carries_the_weapons_a_library_weapon_names() {
        let out = compile(&project(json!({
            "weapons": library_with_child(),
            "equipped": { "armmship": { "0": "rocket_copy" } }
        })));
        let table = weapon_table(&out, "weapons/coilbox_armmship_rocket_copy.lua");
        let names: Vec<&String> = table.as_object().expect("a table").keys().collect();
        assert_eq!(
            names,
            vec![
                "armmship_munition_copy",
                "armmship_rocket_copy",
                "armmship_rocket_split_copy"
            ]
        );
        let params = &table["armmship_rocket_copy"]["customparams"];
        assert_eq!(
            params["speceffect_def"],
            json!("armmship_rocket_split_copy")
        );
        assert_eq!(table["armmship_rocket_split_copy"]["range"], json!(350));
    }

    /// A unit whose name cannot be part of a file name gets no weapon file,
    /// and a slot that is neither a number nor a death explosion none either.
    #[test]
    fn no_weapon_file_for_a_name_that_cannot_be_a_file_name() {
        let out = compile(&project(json!({
            "weapons": library(),
            "equipped": {
                "Arm Com": { "0": "heavylaser" },
                "armcom": { "left": "heavylaser" },
            }
        })));
        assert!(out.files.iter().all(|f| !f.path.starts_with("weapons/")));
        assert!(
            out.notes.iter().any(|n| n.starts_with(
                "Arm Com has heavylaser equipped, but its name cannot be part of a file name"
            )),
            "{:?}",
            out.notes
        );
    }

    /// A copy of Beyond All Reason's `armmship` as the page read it, with a
    /// rocket whose split effect names the unit's own unmounted definition by
    /// its full name, and a plasma shell whose cluster child the game's post
    /// files had already prefixed (issue #2641). Values are made up, shaped
    /// like BAR test-30922's.
    fn ship_copy(extra: Value) -> ModProject {
        let mut edits = json!({
            "clones": { "myship": {
                "key": "myship", "source": "armmship",
                "replacesGameUnit": false,
                "def": {
                    "weapons": [{ "name": "armmship_rocket" }, { "name": "armmship_plasma" }],
                    "weapondefs": {
                        "rocket": { "range": 1000, "customparams": {
                            "speceffect": "split", "speceffect_def": "armmship_rocket_split"
                        } },
                        "rocket_split": { "range": 300 },
                        "plasma": { "customparams": { "cluster_def": "armmship_cluster_munition" } },
                        "cluster_munition": { "range": 100 }
                    }
                }
            } }
        });
        if let (Some(target), Some(more)) = (edits.as_object_mut(), extra.as_object()) {
            for (k, v) in more {
                target.insert(k.clone(), v.clone());
            }
        }
        project(edits)
    }

    /// Issue #2641. A copy's references name the definitions the copy carries,
    /// the way its slots do: the full name under the copy's own prefix, and the
    /// short name back where the game's post files will prefix it.
    #[test]
    fn a_copys_references_name_the_definitions_the_copy_carries() {
        let clone = &ship_copy(json!({})).edits.clones["myship"];
        let def = resolved_clone_def(clone, &GameEdits::default());
        let own = &def["weapondefs"];
        assert_eq!(
            own["rocket"]["customparams"]["speceffect_def"],
            json!("myship_rocket_split")
        );
        assert_eq!(
            own["plasma"]["customparams"]["cluster_def"],
            json!("cluster_munition")
        );
        let out = compile(&ship_copy(json!({})));
        assert!(out.notes.is_empty(), "{:?}", out.notes);
    }

    /// Issue #2641. A reference in a copy that names nothing the copy carries
    /// is said, since the copy's whole definition is the project's.
    #[test]
    fn a_copys_reference_to_nothing_is_noted() {
        let out = compile(&ship_copy(json!({
            "overrides": { "myship": {
                "weapondefs.plasma.customparams.cluster_def": "gone",
                "weapondefs.rocket.customparams.speceffect_def": "myship_nothing"
            } }
        })));
        assert_eq!(out.notes.len(), 2, "{:?}", out.notes);
        assert!(
            out.notes[0].contains("names gone in cluster_def"),
            "{:?}",
            out.notes
        );
        assert!(
            out.notes[1].contains("names myship_nothing in speceffect_def"),
            "{:?}",
            out.notes
        );
    }

    fn library_with_child() -> Value {
        json!({
            "rocket_copy": {
                "key": "rocket_copy", "source": "armmship_rocket",
                "def": { "range": 1000, "customparams": {
                    "speceffect": "split", "speceffect_def": "rocket_split_copy",
                    "cluster_def": "munition_copy"
                } }
            },
            "rocket_split_copy": {
                "key": "rocket_split_copy", "source": "armmship_rocket_split",
                "def": { "range": 300 }, "changes": { "range": 350 }
            },
            "munition_copy": {
                "key": "munition_copy", "source": "armmship_cluster_munition",
                "def": { "range": 100 }
            }
        })
    }

    /// Issue #2641. A library weapon brings the library weapons it names into
    /// the copy beside it. The full-name reference gets the copy's own full
    /// name, and the short one stays the key the game's post files prefix.
    #[test]
    fn a_library_weapon_brings_the_weapons_it_names_into_a_copy() {
        let out = compile(&ship_copy(json!({
            "weapons": library_with_child(),
            "equipped": { "myship": { "0": "rocket_copy" } }
        })));
        let clone = &ship_copy(json!({
            "weapons": library_with_child(),
            "equipped": { "myship": { "0": "rocket_copy" } }
        }))
        .edits;
        let def = resolved_clone_def(&clone.clones["myship"], clone);
        let own = &def["weapondefs"];
        assert_eq!(own["rocket_split_copy"]["range"], json!(350));
        assert_eq!(own["munition_copy"]["range"], json!(100));
        let params = &own["rocket_copy"]["customparams"];
        assert_eq!(params["speceffect_def"], json!("myship_rocket_split_copy"));
        assert_eq!(params["cluster_def"], json!("munition_copy"));
        assert_eq!(out.notes.len(), 1, "{:?}", out.notes);
        assert!(out.notes[0].contains("weapon file"), "{:?}", out.notes);
    }

    /// Issue #2641. Into a game unit, the block carries the weapons a library
    /// weapon names, and where the unit's name goes, and a project without
    /// any gets the block it always did.
    #[test]
    fn an_equip_block_carries_the_weapons_a_library_weapon_names() {
        let out = compile(&project(json!({
            "weapons": library_with_child(),
            "equipped": { "armmship": { "0": "rocket_copy" } }
        })));
        let block = &out.chunks[0].lua;
        assert!(block.contains("local support = {"), "{block}");
        assert!(block.contains(
            "[\"rocket_copy\"] = { { \"munition_copy\", \"rocket_split_copy\" }, { { \"rocket_copy\", \"customparams\", \"speceffect_def\", \"rocket_split_copy\" } } },"
        ), "{block}");
        assert!(block.contains("rocket_split_copy = {"), "{block}");
        let plain = compile(&project(json!({
            "weapons": library(),
            "equipped": { "armcom": { "0": "heavylaser" } }
        })));
        assert!(
            !plain.chunks[0].lua.contains("support"),
            "{}",
            plain.chunks[0].lua
        );
    }

    /// Issue #2641. A library weapon naming itself, or two naming each other,
    /// is written once each rather than looping.
    #[test]
    fn library_support_stops_at_a_cycle() {
        let weapons: BTreeMap<String, LibraryWeapon> = serde_json::from_value(json!({
            "a": { "key": "a", "source": "x_a", "def": { "customparams": { "cluster_def": "b" } } },
            "b": { "key": "b", "source": "x_b", "def": { "customparams": { "cluster_def": "a" } } }
        }))
        .expect("parse");
        assert_eq!(library_support(&weapons, "a"), vec!["b".to_string()]);
    }

    /// A slot whose library weapon has gone keeps the game's weapon, and says
    /// so, rather than compiling a slot that names nothing.
    #[test]
    fn a_slot_naming_a_weapon_the_library_lost_is_left_out_with_a_note() {
        let out = compile(&project(json!({
            "equipped": { "armcom": { "0": "gone", "x": "gone" } }
        })));
        assert!(out.chunks.is_empty());
        assert!(out.notes.iter().any(|n| n
            .contains("armcom has gone equipped, which is not in the project's weapon library")));
        assert!(out.notes.iter().any(|n| n.contains("not a slot number")));
    }

    fn blast() -> Value {
        json!({ "big_unitex_copy": {
            "key": "big_unitex_copy",
            "source": "big_unitex",
            "def": { "areaofeffect": 64, "damage": { "default": 25 } },
            "changes": { "areaofeffect": 200 }
        } })
    }

    /// Issue #2642. A death explosion equipped into a game unit goes in the
    /// same block as the slots, named by its field rather than a number, and
    /// the heading says what it is.
    #[test]
    fn a_death_explosion_on_a_game_unit_is_an_entry_in_the_equip_block() {
        let mut weapons = blast();
        weapons["heavylaser"] = library()["heavylaser"].clone();
        let out = compile(&project(json!({
            "weapons": weapons,
            "equipped": {
                "armcom": { "0": "heavylaser", "explodeas": "big_unitex_copy" },
                "armpw": { "selfdestructas": "big_unitex_copy" }
            }
        })));
        assert_eq!(out.chunks.len(), 1);
        let chunk = &out.chunks[0];
        assert_eq!(chunk.title, "1 weapon and 2 death explosions equipped");
        assert!(chunk
            .lua
            .contains("{ \"armcom\", \"explodeas\", \"big_unitex_copy\" },"));
        assert!(chunk
            .lua
            .contains("{ \"armpw\", \"selfdestructas\", \"big_unitex_copy\" },"));
        assert!(chunk.lua.contains("areaofeffect = 200"), "{}", chunk.lua);
        let only = compile(&project(json!({
            "weapons": blast(),
            "equipped": { "armpw": { "explodeas": "big_unitex_copy" } }
        })));
        assert_eq!(only.chunks[0].title, "1 death explosion equipped");
    }

    /// Issue #2642. A copy's death explosion is written into its file: the
    /// weapon into its own `weapondefs`, and the field, in the spelling the
    /// copy already uses, naming it by full name.
    #[test]
    fn a_death_explosion_equipped_into_a_copy_is_folded_into_its_file() {
        let out = compile(&project(json!({
            "weapons": blast(),
            "clones": { "supercom": {
                "key": "supercom", "source": "armcom",
                "replacesGameUnit": false,
                "def": { "explodeAs": "COMMANDER_BLAST", "selfdestructas": "COMMANDER_BLAST" }
            } },
            "equipped": { "supercom": { "explodeas": "big_unitex_copy" } }
        })));
        assert!(out.chunks.iter().all(|c| !c.title.contains("equipped")));
        let unit = file(&out, "units/supercom.lua");
        assert!(
            unit.contains("explodeAs = \"supercom_big_unitex_copy\""),
            "{unit}"
        );
        assert!(
            unit.contains("selfdestructas = \"COMMANDER_BLAST\""),
            "{unit}"
        );
        assert!(unit.contains("big_unitex_copy = {"), "{unit}");
        assert!(unit.contains("areaofeffect = 200"), "{unit}");
    }

    /// Issue #2642. A copy made after the post files ran names a death
    /// explosion its source carries by the source's full name, and is pointed
    /// at its own, as its slots are. One naming a shared explosion is left.
    #[test]
    fn a_copy_explodes_as_the_definition_it_carries() {
        let out = compile(&project(json!({
            "clones": { "myshock": {
                "key": "myshock", "source": "armshock",
                "replacesGameUnit": false,
                "def": {
                    "explodeas": "armshock_shocker",
                    "selfdestructas": "BIG_UNIT",
                    "weapondefs": { "shocker": { "range": 1 } }
                }
            } }
        })));
        let unit = file(&out, "units/myshock.lua");
        assert!(unit.contains("explodeas = \"myshock_shocker\""), "{unit}");
        assert!(unit.contains("selfdestructas = \"BIG_UNIT\""), "{unit}");
    }

    /// A death explosion whose library weapon has gone keeps the game's, and
    /// says so in its own words.
    #[test]
    fn a_death_explosion_the_library_lost_is_left_out_with_a_note() {
        let out = compile(&project(json!({
            "equipped": { "armcom": { "explodeas": "gone" } }
        })));
        assert!(out.chunks.is_empty());
        assert!(out.notes.iter().any(|n| n.contains(
            "armcom has gone as its explodeas, which is not in the project's weapon library"
        )));
    }

    /// The archive loads an added unit out of `units/`, so that file stays a
    /// plain table. The chunk is a block because the other route, a BAR slot,
    /// has to assign it: see [`added_block`] and issue #2962.
    #[test]
    fn a_new_unit_is_assigned_in_its_chunk_and_plain_in_its_own_file() {
        let out = compile(&project(json!({
            "clones": { "supercom": {
                "key": "supercom", "source": "armcom",
                "replacesGameUnit": false,
                "def": { "maxDamage": 9000, "objectName": "arm_com.s3o" }
            } }
        })));
        assert_eq!(out.chunks[0].form, LuaForm::Block);
        assert!(out.chunks[0].lua.contains("UnitDefs[name] = def"));
        assert!(out.chunks[0].lua.starts_with("-- Units added."));
        let unit = file(&out, "units/supercom.lua");
        assert!(unit.contains("return {"));
        assert!(unit.contains("[\"supercom\"] = {"));
        assert!(unit.contains("maxDamage = 9000"));
        // Nothing executable in a file that only adds a unit.
        assert!(!unit.contains("UnitDefs"));
    }

    /// The archive already loads these out of `units/`, so restating every
    /// definition in the post file would double the archive for nothing.
    #[test]
    fn added_units_are_not_restated_in_the_post_file() {
        let out = compile(&project(json!({
            "clones": { "supercom": {
                "key": "supercom", "source": "armcom",
                "replacesGameUnit": false,
                "def": { "maxDamage": 9000 }
            } }
        })));
        assert!(!out.files.iter().any(|f| f.path == POST_FILE));
    }

    /// The bug itself (issue #2962): exported as `!bset` lines, an added unit
    /// used to land in a `tweakunits` slot, where BAR's merge finds no unit of
    /// that name and drops it without an error.
    #[test]
    fn an_added_unit_packs_into_a_tweakdefs_slot() {
        let out = compile(&project(json!({
            "clones": { "supercom": {
                "key": "supercom", "source": "armcom",
                "replacesGameUnit": false,
                "def": { "maxDamage": 9000 }
            } }
        })));
        let pack = crate::bar_pack::pack(&out.chunks);
        assert_eq!(pack.tweakunits.len(), 0);
        assert_eq!(pack.tweakdefs.len(), 1);
        assert!(pack.complete());
    }

    /// Editing a copy after making it is an ordinary override against the
    /// copy's own definition, and the copy owns its table, so the edit is
    /// folded in rather than left as a patch to apply later.
    #[test]
    fn an_edit_to_a_copy_is_folded_into_the_copys_definition() {
        let out = compile(&project(json!({
            "clones": { "supercom": {
                "key": "supercom", "source": "armcom",
                "replacesGameUnit": false,
                "def": { "maxDamage": 9000 }
            } },
            "overrides": { "supercom": { "maxDamage": 12000 } }
        })));
        assert!(file(&out, "units/supercom.lua").contains("maxDamage = 12000"));
        // And no patch table, because there is nothing left to patch.
        assert!(!out.files.iter().any(|f| f.path == POST_FILE));
    }

    /// A copy under a name the game already uses cannot be a table entry: a
    /// merge would leave the game's own fields underneath it.
    #[test]
    fn a_copy_that_replaces_a_game_unit_is_a_block() {
        let out = compile(&project(json!({
            "clones": { "armcom": {
                "key": "armcom", "source": "armcom",
                "replacesGameUnit": true,
                "def": { "maxDamage": 9000 }
            } }
        })));
        assert_eq!(out.chunks[0].form, LuaForm::Block);
        assert!(out.chunks[0].lua.starts_with("-- Replaces"));
        assert!(out.chunks[0].lua.contains("do\n  UnitDefs[\"armcom\"] = {"));
        assert!(out.chunks[0].lua.ends_with("end"));
        assert!(!out.files.iter().any(|f| f.path == "units/armcom.lua"));
        assert!(file(&out, POST_FILE).contains("UnitDefs[\"armcom\"]"));
    }

    /// The build menu case the issue names. It must not write the list out as
    /// it stands, or a unit the game adds to that factory later is lost.
    #[test]
    fn a_game_units_build_menu_is_a_block_that_replays_the_operations() {
        let out = compile(&project(json!({
            "menus": { "armlab": [
                { "op": "add", "unit": "armpw" },
                { "op": "remove", "unit": "armflash" },
                { "op": "move", "unit": "armrock", "before": "armham" }
            ] }
        })));
        let chunk = &out.chunks[0];
        assert_eq!(chunk.form, LuaForm::Block);
        assert!(chunk.lua.contains("local def = UnitDefs[\"armlab\"]"));
        assert!(chunk.lua.contains("list[#list + 1] = \"armpw\""));
        assert!(chunk.lua.contains("table.remove(list, i)"));
        assert!(chunk.lua.contains("table.insert(list, before, moved)"));
        // The list is never written out in full, which is what pins it.
        assert!(!chunk.lua.contains("armsolar"));
    }

    /// A copy's menu is the other half of that decision. The project owns the
    /// whole definition, so there is nothing to replay against.
    #[test]
    fn a_copys_build_menu_is_resolved_into_its_definition() {
        let out = compile(&project(json!({
            "clones": { "mylab": {
                "key": "mylab", "source": "armlab",
                "replacesGameUnit": false,
                "def": { "buildoptions": ["armpw", "armflash"] }
            } },
            "menus": { "mylab": [{ "op": "remove", "unit": "armflash" }] }
        })));
        // One chunk, not two: the menu is folded in rather than replayed. It
        // is a block because an added unit is assigned (issue #2962), which
        // says nothing about the menu decision this test is about.
        assert_eq!(out.chunks.len(), 1);
        assert_eq!(out.chunks[0].form, LuaForm::Block);
        let unit = file(&out, "units/mylab.lua");
        assert!(unit.contains("[1] = \"armpw\""));
        assert!(!unit.contains("armflash"));
    }

    /// The game spells the key, not us.
    #[test]
    fn a_copys_menu_is_written_back_under_the_key_the_definition_uses() {
        let out = compile(&project(json!({
            "clones": { "mylab": {
                "key": "mylab", "source": "armlab",
                "replacesGameUnit": false,
                "def": { "buildOptions": ["armpw"] }
            } },
            "menus": { "mylab": [{ "op": "add", "unit": "armflash" }] }
        })));
        let unit = file(&out, "units/mylab.lua");
        assert!(unit.contains("buildOptions = {"));
        assert!(!unit.contains("buildoptions ="));
    }

    #[test]
    fn switching_a_unit_off_reads_every_builder_so_it_is_a_block() {
        let out = compile(&project(json!({ "disabled": ["armflash"] })));
        assert_eq!(out.chunks[0].form, LuaForm::Block);
        assert!(out.chunks[0].lua.contains("[\"armflash\"] = true"));
        assert!(out.chunks[0]
            .lua
            .contains("for _, def in pairs(UnitDefs) do"));
    }

    /// A mutator is a game that depends on the base game and supplies only what
    /// it changes.
    #[test]
    fn the_modinfo_depends_on_the_base_game_and_is_launchable() {
        let out = compile(&project(json!({ "disabled": ["armflash"] })));
        let modinfo = file(&out, "modinfo.lua");
        assert!(modinfo.contains("modtype = 1"));
        assert!(modinfo.contains("\"Balanced Annihilation V15.9.8\""));
        assert!(modinfo.contains("name = \"Faster commanders\""));
        assert!(modinfo.contains("shortname = \"coilbox_faster_commanders\""));
    }

    /// The post file is the one place a mutator can run code, and it covers up
    /// the base game's own. Saying so is the whole of what this issue can do
    /// about it.
    #[test]
    fn the_post_file_is_flagged_because_it_covers_the_games_own() {
        let out = compile(&project(json!({ "disabled": ["armflash"] })));
        assert!(out.files.iter().any(|f| f.path == POST_FILE));
        assert!(out.notes.iter().any(|n| n.contains("unitdefs_post.lua")));
    }

    /// The drawer shows the chunks and the file is what gets written. If the
    /// two could differ, reading the Lua would stop being a way of finding out
    /// what the game will do.
    #[test]
    fn the_post_file_holds_exactly_the_blocks_the_user_is_shown() {
        let out = compile(&project(json!({
            "menus": { "armlab": [{ "op": "add", "unit": "armpw" }] },
            "disabled": ["armflash"],
            "clones": { "armcom": {
                "key": "armcom", "replacesGameUnit": true, "def": { "maxdamage": 1 }
            } }
        })));
        let post = file(&out, POST_FILE);
        let blocks: Vec<&Chunk> = out
            .chunks
            .iter()
            .filter(|chunk| chunk.form == LuaForm::Block)
            .collect();
        assert_eq!(blocks.len(), 3);
        // In order, and each one whole.
        let mut at = 0;
        for block in blocks {
            let found = post[at..]
                .find(&block.lua)
                .unwrap_or_else(|| panic!("{} is not in the post file", block.title));
            at += found + block.lua.len();
        }
    }

    /// A game that names its units in a localisation file gets a file of its
    /// own beside the game's, naming only the units the project renamed.
    #[test]
    fn name_edits_for_a_localisation_game_get_their_own_language_file() {
        let out = compile(&project(json!({
            "text": { "armcom": { "en": { "name": "Commander", "description": "Boss" } } }
        })));
        let written = file(&out, "language/en/zz_coilbox.json");
        let parsed: Value = serde_json::from_str(written).expect("json");
        assert_eq!(parsed["units"]["names"]["armcom"], json!("Commander"));
        assert_eq!(parsed["units"]["descriptions"]["armcom"], json!("Boss"));
        // Only what the project said. A key for a unit it never touched would
        // be the whole-file replacement this route exists to avoid.
        assert_eq!(
            parsed["units"]["names"].as_object().expect("names").len(),
            1
        );
        assert_eq!(out.notes.len(), 1);
        assert!(out.notes[0]
            .starts_with("2 name and description edits are in language/en/zz_coilbox.json,"));
    }

    /// The name is the whole mechanism. Beyond All Reason's i18n module loads
    /// every JSON file in a language folder in name order and lets the last
    /// write to a key win, so a file sorting before `units.json` would be
    /// overwritten by the game's own and the rename would never arrive.
    #[test]
    fn the_language_file_sorts_after_the_games_own() {
        assert!(LANGUAGE_FILE > "units.json");
        assert!(LANGUAGE_FILE.ends_with(".json"));
    }

    /// One file per language, and a locale the project says nothing in does
    /// not get an empty one.
    #[test]
    fn each_language_gets_its_own_file_and_no_others() {
        let out = compile(&project(json!({
            "text": {
                "armcom": { "en": { "name": "Commander" }, "de": { "name": "Kommandant" } },
                "armflash": { "de": { "description": "Schnell" } }
            }
        })));
        let paths: Vec<&str> = out.files.iter().map(|f| f.path.as_str()).collect();
        assert!(paths.contains(&"language/en/zz_coilbox.json"));
        assert!(paths.contains(&"language/de/zz_coilbox.json"));
        assert_eq!(
            paths.iter().filter(|p| p.starts_with("language/")).count(),
            2
        );
        let de: Value =
            serde_json::from_str(file(&out, "language/de/zz_coilbox.json")).expect("json");
        assert_eq!(de["units"]["names"]["armcom"], json!("Kommandant"));
        assert_eq!(de["units"]["descriptions"]["armflash"], json!("Schnell"));
        // English said nothing about descriptions, so it carries no such key
        // rather than an empty object.
        let en: Value =
            serde_json::from_str(file(&out, "language/en/zz_coilbox.json")).expect("json");
        assert!(en["units"].get("descriptions").is_none());
    }

    /// The same check `a_copy_whose_key_is_not_a_unit_name_is_left_out` makes,
    /// for the other value in a project that becomes a path.
    #[test]
    fn a_language_code_that_is_not_a_code_is_left_out_and_said_so() {
        let out = compile(&project(json!({
            "text": { "armcom": { "../../evil": { "name": "Commander" } } }
        })));
        assert!(out.files.iter().all(|f| !f.path.contains("..")));
        assert!(out.files.iter().all(|f| !f.path.starts_with("language/")));
        assert_eq!(out.notes.len(), 1);
        assert!(out.notes[0].contains("left out"));
    }

    fn carried(title: &str, lua: &str, form: &str) -> crate::model::ReadOnlyLuaBlock {
        crate::model::ReadOnlyLuaBlock {
            title: title.to_string(),
            lua: lua.to_string(),
            note: "Decoded as a program, not data.".to_string(),
            form: Some(form.to_string()),
        }
    }

    /// The whole point of importing somebody's tweak set (issue #1280): most
    /// of a real one is program, so a project that carried it without
    /// compiling it would keep the small editable part and lose the rest.
    #[test]
    fn carried_lua_is_compiled_verbatim_and_noted() {
        let mut project = project(json!({ "disabled": ["armflash"] }));
        project.read_only_lua = vec![carried(
            "tweakdefs3",
            "do for _, d in pairs(UnitDefs) do d.health = 2 end end",
            "block",
        )];
        let out = compile(&project);
        assert!(out.notes.iter().any(|n| n.contains("1 block of Lua")));
        let post = out
            .files
            .iter()
            .find(|f| f.path == POST_FILE)
            .expect("post file");
        assert!(post.contents.contains("d.health = 2"));
    }

    /// Run order is the reason it is compiled first. A program that scales
    /// every unit has to run before the one unit the user then typed a number
    /// into, or their number gets scaled too.
    #[test]
    fn carried_lua_runs_before_the_projects_own_blocks() {
        let mut project = project(json!({ "disabled": ["armflash"] }));
        project.read_only_lua = vec![carried("tweakdefs", "do local imported = 1 end", "block")];
        let out = compile(&project);
        assert_eq!(out.chunks[0].title, "tweakdefs");
        assert_eq!(out.chunks[0].form, LuaForm::Block);
        let post = out
            .files
            .iter()
            .find(|f| f.path == POST_FILE)
            .expect("post file");
        let imported = post.contents.find("local imported").expect("imported");
        let disabled = post.contents.find("armflash").expect("disabled");
        assert!(imported < disabled);
    }

    /// A block that never parsed cannot be written into a file, because it
    /// would break the whole file rather than only itself.
    #[test]
    fn lua_that_never_parsed_is_left_out_and_said_so() {
        let mut project = project(json!({ "disabled": ["armflash"] }));
        project.read_only_lua = vec![carried("tweakdefs9", "not lua at all {{{", "unrecognised")];
        let out = compile(&project);
        assert!(out
            .notes
            .iter()
            .any(|n| n.contains("left out of the output") && n.contains("tweakdefs9")));
        for compiled in &out.files {
            assert!(!compiled.contents.contains("not lua at all"));
        }
    }

    /// A project saved before the decoder recorded its verdict says nothing
    /// about whether its Lua parses, so it is not written out.
    #[test]
    fn carried_lua_with_no_recorded_form_is_not_compiled() {
        let mut project = project(json!({ "disabled": ["armflash"] }));
        project.read_only_lua = vec![crate::model::ReadOnlyLuaBlock {
            title: "tweakdefs".to_string(),
            lua: "do local old = 1 end".to_string(),
            note: "From an older project.".to_string(),
            form: None,
        }];
        let out = compile(&project);
        for compiled in &out.files {
            assert!(!compiled.contents.contains("local old"));
        }
    }

    /// A project arrives as JSON that somebody may have been sent, and its
    /// name goes into a Lua comment. A newline in it would end the comment and
    /// leave the rest as Lua the game runs.
    #[test]
    fn a_name_with_a_newline_in_it_cannot_break_out_of_the_comment() {
        let hostile: ModProject = serde_json::from_value(json!({
            "name": "evil\nUnitDefs = nil --",
            "gameName": "g",
            "edits": { "disabled": ["a"] },
        }))
        .expect("parse");
        let out = compile(&hostile);
        // Inside `modinfo.lua`'s quoted `name` the text is harmless, because
        // `lua_string` escapes the newline. What must not exist anywhere is a
        // line of its own carrying it, which is what a broken comment leaves.
        for compiled in &out.files {
            assert!(
                !compiled
                    .contents
                    .lines()
                    .any(|line| line.trim() == "UnitDefs = nil --"),
                "{} carries the injected line",
                compiled.path
            );
        }
    }

    /// The same, for the key that becomes a path under the archive.
    #[test]
    fn a_copy_whose_key_is_not_a_unit_name_is_left_out_and_said_so() {
        let out = compile(&project(json!({
            "clones": { "../../evil": {
                "key": "../../evil", "replacesGameUnit": false, "def": { "maxdamage": 1 }
            } }
        })));
        assert!(out.files.iter().all(|f| !f.path.contains("..")));
        assert!(out.chunks.is_empty());
        assert_eq!(out.notes.len(), 1);
        assert!(out.notes[0].contains("left out"));
    }

    /// Two runs over the same project have to produce the same bytes, or a
    /// share code and a preflight and a diff all mean nothing.
    #[test]
    fn compiling_twice_produces_the_same_bytes() {
        let input = project(json!({
            "overrides": { "zebra": { "b": 1, "a": 2 }, "armcom": { "maxDamage": 5 } },
            "disabled": ["b", "a"],
            "menus": { "z": [{ "op": "add", "unit": "q" }], "a": [{ "op": "add", "unit": "q" }] }
        }));
        let first = compile(&input);
        let second = compile(&input);
        assert_eq!(
            serde_json::to_string(&first).expect("json"),
            serde_json::to_string(&second).expect("json")
        );
    }

    #[test]
    fn replaying_a_menu_matches_the_editors_own_rules() {
        let inherited = vec!["a".to_string(), "b".to_string(), "c".to_string()];
        let ops: Vec<BuildMenuOp> = serde_json::from_value(json!([
            { "op": "move", "unit": "c", "before": "a" },
            { "op": "remove", "unit": "b" },
            { "op": "add", "unit": "d" }
        ]))
        .expect("parse");
        assert_eq!(apply_build_menu(&inherited, &ops), vec!["c", "a", "d"]);
    }

    #[test]
    fn a_move_with_no_anchor_goes_to_the_end() {
        let inherited = vec!["a".to_string(), "b".to_string()];
        let ops: Vec<BuildMenuOp> =
            serde_json::from_value(json!([{ "op": "move", "unit": "a", "before": null }]))
                .expect("parse");
        assert_eq!(apply_build_menu(&inherited, &ops), vec!["b", "a"]);
    }

    #[test]
    fn a_dotted_path_writes_through_arrays_and_tables_alike() {
        let mut def = json!({ "weapons": [{ "name": "OLD" }] });
        write_path(&mut def, &["weapons", "0", "name"], json!("NEW"));
        write_path(&mut def, &["customParams", "tier"], json!("2"));
        assert_eq!(def["weapons"][0]["name"], json!("NEW"));
        assert_eq!(def["customParams"]["tier"], json!("2"));
    }

    /// A field change reaches `bar_tweakdefs` through exactly the same merge
    /// code `POST_FILE` runs, since both have to apply the same patch onto the
    /// same `UnitDefs`.
    #[test]
    fn a_field_change_lands_in_bar_tweakdefs_as_a_merge() {
        let out = compile(&project(json!({
            "overrides": { "armcom": { "maxDamage": 5000 } }
        })));
        let tweakdefs = out.bar_tweakdefs.expect("bar_tweakdefs");
        assert!(tweakdefs.contains("local changes = "));
        assert!(tweakdefs.contains("merge(def, patch)"));
        assert!(tweakdefs.contains("maxDamage = 5000"));
    }

    /// An added unit cannot go through a merge: there is nothing in
    /// `UnitDefs` yet to merge onto, so it is a plain assignment instead.
    #[test]
    fn an_added_unit_lands_in_bar_tweakdefs_as_an_assignment() {
        let out = compile(&project(json!({
            "clones": { "supercom": {
                "key": "supercom", "source": "armcom",
                "replacesGameUnit": false,
                "def": { "maxDamage": 9000 }
            } }
        })));
        let tweakdefs = out.bar_tweakdefs.expect("bar_tweakdefs");
        assert!(tweakdefs.contains("local added = "));
        assert!(tweakdefs.contains("UnitDefs[name] = def"));
        assert!(tweakdefs.contains("maxDamage = 9000"));
        // Not a merge: nothing existed to merge onto.
        assert!(!tweakdefs.contains("local changes ="));
    }

    /// Every block-form edit (a replaced unit, a build menu, a disabled unit)
    /// reaches `bar_tweakdefs` the same way it reaches `POST_FILE`: as the
    /// exact block the chunk list already shows the user, run in the same
    /// order.
    #[test]
    fn block_form_edits_land_in_bar_tweakdefs_in_compiled_order() {
        let out = compile(&project(json!({
            "menus": { "armlab": [{ "op": "add", "unit": "armpw" }] },
            "disabled": ["armflash"],
            "clones": { "armcom": {
                "key": "armcom", "replacesGameUnit": true, "def": { "maxdamage": 1 }
            } }
        })));
        let tweakdefs = out.bar_tweakdefs.expect("bar_tweakdefs");
        let blocks: Vec<&Chunk> = out
            .chunks
            .iter()
            .filter(|chunk| chunk.form == LuaForm::Block)
            .collect();
        assert_eq!(blocks.len(), 3);
        let mut at = 0;
        for block in blocks {
            let found = tweakdefs[at..]
                .find(&block.lua)
                .unwrap_or_else(|| panic!("{} is not in bar_tweakdefs", block.title));
            at += found + block.lua.len();
        }
    }

    /// A name and description edit is the one thing neither route can carry
    /// (compile.rs's own note), so it must not silently appear in
    /// `bar_tweakdefs` either.
    #[test]
    fn text_only_edits_leave_bar_tweakdefs_empty() {
        let out = compile(&project(json!({
            "text": { "armcom": { "en": { "name": "Commander" } } }
        })));
        assert!(out.bar_tweakdefs.is_none());
    }

    /// A project that has never moved a unit ships no armour class file at
    /// all, even when the frontend has stashed a snapshot: `base` on its own
    /// says nothing the game does not already say (issue #2645).
    #[test]
    fn a_snapshot_with_no_moves_compiles_to_nothing() {
        let out = compile(&project(json!({
            "armorClasses": { "base": { "commanders": ["armcom"] }, "moves": {} }
        })));
        assert!(out.files.iter().all(|f| f.path != ARMOR_FILE));
    }

    /// Moving a unit writes the whole snapshot back with that unit taken out
    /// of its old class and put in the new one, and every other class
    /// untouched.
    #[test]
    fn moving_a_unit_rewrites_its_class_and_keeps_the_rest() {
        let out = compile(&project(json!({
            "armorClasses": {
                "base": {
                    "commanders": ["armcom", "corcom"],
                    "vtol": ["armkam"],
                },
                "moves": { "armcom": "heavyunits" },
            }
        })));
        let lua = file(&out, ARMOR_FILE);
        let commanders = class_block(lua, "commanders");
        assert!(commanders.contains("corcom"));
        assert!(!commanders.contains("armcom"), "commanders: {commanders}");
        let heavyunits = class_block(lua, "heavyunits");
        assert!(heavyunits.contains("armcom"));
        assert!(class_block(lua, "vtol").contains("armkam"));
        assert!(lua.trim_end().ends_with("return armorDefs"));
        assert!(out.notes.iter().any(|n| n.contains(ARMOR_FILE)));
    }

    /// Moving a unit to "default" only has to remove it from its old class:
    /// the engine's own catch-all needs no list naming anybody.
    #[test]
    fn moving_a_unit_to_default_only_removes_it() {
        let out = compile(&project(json!({
            "armorClasses": {
                "base": { "commanders": ["armcom", "corcom"] },
                "moves": { "armcom": "default" },
            }
        })));
        let lua = file(&out, ARMOR_FILE);
        assert!(!lua.contains("\"armcom\""));
        assert!(lua.contains("\"corcom\""));
        assert!(!lua.contains("[\"default\"]"));
    }

    /// A move can name a class the snapshot never held, which is how a
    /// modder invents a brand new one.
    #[test]
    fn moving_a_unit_into_a_new_class_creates_it() {
        let out = compile(&project(json!({
            "armorClasses": {
                "base": { "commanders": ["armcom"] },
                "moves": { "armkam": "flyingcircus" },
            }
        })));
        let lua = file(&out, ARMOR_FILE);
        assert!(lua.contains("[\"flyingcircus\"]"));
        assert!(lua.contains("\"armkam\""));
    }

    /// A VM only ever evaluates a string this test built, never reads a file,
    /// so which directory it is rooted at is never consulted (the same
    /// reasoning `preflight::lua_root` gives).
    fn ceg_lua_root() -> std::path::PathBuf {
        std::env::temp_dir()
    }

    /// A generator's file, evaluated the way the engine's own `LoadLuas`
    /// would read it (`gamedata/explosions.lua`), so a test checks the real
    /// table shape rather than a substring of the source.
    fn eval_ceg(lua: &str) -> Value {
        coilbox_springlua::SpringLua::new(ceg_lua_root())
            .expect("start the Lua VM")
            .eval_value_raw(lua, "effects/test.lua")
            .expect("effects file should evaluate")
    }

    #[test]
    fn a_muzzle_flame_writes_a_spawn_with_colour_and_texture_in_properties() {
        let out = compile(&project(json!({
            "explosionGenerators": {
                "purpleflash": {
                    "key": "purpleflash",
                    "class": "CBitmapMuzzleFlame",
                    "count": 1,
                    "ground": true,
                    "water": true,
                    "air": true,
                    "underwater": true,
                    "texture": "flare.tga",
                    "color": { "r": 1.0, "g": 0.0, "b": 1.0 },
                    "size": 8.0,
                    "lifetime": 30.0,
                }
            }
        })));
        let lua = file(&out, "effects/purpleflash.lua");
        let value = eval_ceg(lua);
        let entry = &value["purpleflash"]["spawn1"];
        assert_eq!(entry["class"], "CBitmapMuzzleFlame");
        assert_eq!(entry["ground"], true);
        assert_eq!(entry["properties"]["sidetexture"], "flare.tga");
        assert_eq!(entry["properties"]["fronttexture"], "flare.tga");
        assert_eq!(entry["properties"]["size"], 8.0);
        assert_eq!(entry["properties"]["ttl"], 30);
        // A flat colour is the same RGBA stop written twice.
        assert_eq!(entry["properties"]["colormap"], "1 0 1 1 1 0 1 1");
    }

    #[test]
    fn a_particle_system_writes_numparticles_and_particlelife() {
        let out = compile(&project(json!({
            "explosionGenerators": {
                "smoke": {
                    "key": "smoke",
                    "class": "CSimpleParticleSystem",
                    "count": 2,
                    "ground": true,
                    "water": false,
                    "air": true,
                    "underwater": false,
                    "texture": "smoke.tga",
                    "size": 4.5,
                    "lifetime": 60.0,
                    "particles": 20,
                }
            }
        })));
        let lua = file(&out, "effects/smoke.lua");
        let value = eval_ceg(lua);
        let entry = &value["smoke"]["spawn1"];
        assert_eq!(entry["class"], "CSimpleParticleSystem");
        assert_eq!(entry["count"], 2);
        assert_eq!(entry["water"], false);
        assert_eq!(entry["properties"]["particlesize"], 4.5);
        assert_eq!(entry["properties"]["particlelife"], 60.0);
        assert_eq!(entry["properties"]["numparticles"], 20);
        assert!(entry["properties"].get("colormap").is_none());
    }

    #[test]
    fn a_heat_cloud_has_no_colour_and_uses_heatfalloff_for_lifetime() {
        let out = compile(&project(json!({
            "explosionGenerators": {
                "warmth": {
                    "key": "warmth",
                    "class": "CHeatCloudProjectile",
                    "count": 1,
                    "ground": true,
                    "water": true,
                    "air": true,
                    "underwater": true,
                    "size": 3.0,
                    "lifetime": 0.5,
                }
            }
        })));
        let lua = file(&out, "effects/warmth.lua");
        let value = eval_ceg(lua);
        let entry = &value["warmth"]["spawn1"];
        assert_eq!(entry["class"], "CHeatCloudProjectile");
        assert_eq!(entry["properties"]["heatfalloff"], 0.5);
        assert!(entry["properties"].get("colormap").is_none());
    }

    /// Ground flash is the reserved `groundflash` key, not a generic spawn:
    /// no `spawn1`, no repeat count, no gating flags, matching the shape
    /// real CEG files use and `ExplosionGenerator.cpp:1027-1039` parses
    /// unconditionally alongside whatever else the entry holds.
    #[test]
    fn a_ground_flash_writes_the_reserved_key_not_a_spawn() {
        let out = compile(&project(json!({
            "explosionGenerators": {
                "bigflash": {
                    "key": "bigflash",
                    "class": "CStandardGroundFlash",
                    "count": 1,
                    "ground": false,
                    "water": false,
                    "air": false,
                    "underwater": false,
                    "color": { "r": 1.0, "g": 1.0, "b": 0.8 },
                    "size": 100.0,
                    "lifetime": 20.0,
                }
            }
        })));
        let lua = file(&out, "effects/bigflash.lua");
        let value = eval_ceg(lua);
        let entry = &value["bigflash"];
        assert!(entry.get("spawn1").is_none());
        let flash = &entry["groundflash"];
        assert_eq!(flash["ttl"], 20);
        assert_eq!(flash["flashSize"], 100.0);
        let color: Vec<f64> = flash["color"]
            .as_array()
            .expect("color is an array")
            .iter()
            .map(|v| v.as_f64().expect("color channel is a number"))
            .collect();
        assert_eq!(color, vec![1.0, 1.0, 0.8]);
    }

    /// The engine only ever loads a CEG from a real file under `effects/`
    /// (`ExplosionGenerator.cpp:208`), which a BAR tweak slot has no way to
    /// carry, so a project holding one gets no tweakdefs export at all
    /// rather than one that points at a generator nothing delivers.
    #[test]
    fn a_project_with_an_explosion_generator_gets_no_bar_tweakdefs() {
        let out = compile(&project(json!({
            "overrides": { "armcom": { "weapondefs.disintegrator.explosionGenerator": "custom:purpleflash" } },
            "explosionGenerators": {
                "purpleflash": {
                    "key": "purpleflash",
                    "class": "CBitmapMuzzleFlame",
                    "count": 1,
                    "ground": true,
                    "water": true,
                    "air": true,
                    "underwater": true,
                }
            }
        })));
        assert!(out.bar_tweakdefs.is_none());
        assert!(out
            .notes
            .iter()
            .any(|n| n.contains("tweak slot") && n.contains("effects/")));
    }
}
