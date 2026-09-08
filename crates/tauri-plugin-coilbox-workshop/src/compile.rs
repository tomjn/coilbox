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
//! The compiler never sees the game. That is deliberate: every decision it
//! makes is a fact about the project, so compiling is deterministic, needs no
//! unitsync scan, and produces the same bytes on the machine that made the
//! project and the machine that received it.

use crate::lua::{lua_literal, lua_string, PatchTree};
use crate::model::{BuildMenuOp, GameEdits, ModProject, UnitClone};
use serde::Serialize;
use serde_json::Value;

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
    /// Spring and Recoil game supports (issue #1268).
    pub files: Vec<CompiledFile>,
    /// What the compiler could not do, and what to watch out for in what it
    /// did. Empty is the ordinary case.
    pub notes: Vec<String>,
}

/// Where the executable half of a mutator has to live.
///
/// The engine's own `gamedata/unitdefs.lua` includes this path after every
/// `units/*.lua` file has loaded, which is the only hook a mutator has for
/// anything that reads the game's definitions.
const POST_FILE: &str = "gamedata/unitdefs_post.lua";

/// A mutator archive's version. The archive's name is its `name` and this,
/// joined, so it has to be something. Versioning a project for distribution is
/// issue #1283's, and until it exists every compile is version one.
const MUTATOR_VERSION: &str = "1";

/// Compile a project.
pub fn compile(project: &ModProject) -> CompiledMod {
    let edits = &project.edits;
    let mut chunks = Vec::new();
    let mut notes = Vec::new();

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

    let mut unit_files = Vec::new();
    if !added.is_empty() {
        let entries: Vec<(String, Value)> = added
            .iter()
            .map(|clone| (clone.key.clone(), resolved_clone_def(clone, edits)))
            .collect();
        chunks.push(Chunk {
            form: LuaForm::Table,
            title: format!(
                "{} unit{} added",
                entries.len(),
                if entries.len() == 1 { "" } else { "s" }
            ),
            reason: "A copy owns its whole definition, so nothing about it depends on what the game says.".to_string(),
            lua: unit_table(&entries, ""),
        });
        for (key, def) in &entries {
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
        chunks.push(Chunk {
            form: LuaForm::Block,
            title: format!("{} replaced", clone.key),
            reason: format!(
                "The game defines {} too, so this has to be written after its definitions have loaded, and it replaces rather than merges.",
                clone.key
            ),
            lua: replace_block(clone, &resolved_clone_def(clone, edits)),
        });
    }

    // Field changes against the game's own units. A patch and nothing more:
    // every field the project does not mention keeps following the game.
    let mut patches: Vec<(String, PatchTree)> = Vec::new();
    for (unit, patch) in &edits.overrides {
        if edits.clones.contains_key(unit) {
            continue; // Folded into the copy's own definition above.
        }
        let mut tree = PatchTree::new();
        for (path, value) in patch {
            tree.insert(path, value.clone());
        }
        if !tree.is_empty() {
            patches.push((unit.clone(), tree));
        }
    }
    if !patches.is_empty() {
        let count: usize = edits
            .overrides
            .iter()
            .filter(|(unit, _)| !edits.clones.contains_key(*unit))
            .map(|(_, patch)| patch.len())
            .sum();
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
    // file rather than in its unit definitions. A mutator archive can only
    // replace that file whole, and replacing it would blank every unit the
    // project never touched, so these do not compile to a mutator at all. The
    // tweak slot route is where they belong, and that is issue #1277's.
    if !edits.text.is_empty() {
        let count = edits.text_edit_count();
        notes.push(format!(
            "{count} name and description edit{} {} not compiled. {} keeps them in language/<code>/units.json, and a mutator can only replace that file whole, which would blank every other unit's words.",
            if count == 1 { "" } else { "s" },
            if count == 1 { "is" } else { "are" },
            if project.game_name.is_empty() { "This game" } else { &project.game_name },
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

    // Every block, in the order they were compiled, which is the order they have
    // to run in: a copy standing in for a game unit before a menu is replayed
    // over it, and switching a unit off last so it reaches every list either of
    // the first two left behind. Taken from the chunks rather than rebuilt, so
    // the file and the Lua the user reads cannot say different things.
    let post_blocks: Vec<&str> = chunks
        .iter()
        .filter(|chunk| chunk.form == LuaForm::Block)
        .map(|chunk| chunk.lua.as_str())
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

    CompiledMod {
        chunks,
        files,
        notes,
    }
}

/// A copy's definition as it will be read: the definition it was made with,
/// with the project's later edits to it written in, and its own build list
/// resolved if the project reordered one.
///
/// Folded rather than left as a patch because a copy owns its table outright.
/// The game has no unit of that name to follow, so there is nothing for a
/// sparse patch to be sparse against (`src/workshop/clones.ts`).
fn resolved_clone_def(clone: &UnitClone, edits: &GameEdits) -> Value {
    let mut def = clone.def.clone();
    if let Some(patch) = edits.overrides.get(&clone.key) {
        for (path, value) in patch {
            let steps: Vec<&str> = path.split('.').collect();
            write_path(&mut def, &steps, value.clone());
        }
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
        "    local list = def[key] or {}".to_string(),
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
         \x20       local kept = {{}}\n\
         \x20       for i = 1, #list do\n\
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

/// One copy's own file, which is what a game's `units/` folder is full of.
fn unit_file(project: &ModProject, key: &str, def: &Value) -> String {
    format!(
        "{}\nreturn {{\n  [{}] = {},\n}}\n",
        header(project),
        lua_string(key),
        lua_literal(def, "  "),
    )
}

/// The executable half of the mutator: the patch table with the code that
/// applies it, then every block.
fn post_file(project: &ModProject, patches: &[(String, PatchTree)], blocks: &[&str]) -> String {
    let mut out = header(project);
    if !patches.is_empty() {
        out.push_str(
            "\n-- Field changes. Only the fields the project set are here, so everything\n",
        );
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
    for block in blocks {
        out.push('\n');
        out.push_str(block);
        out.push('\n');
    }
    out
}

/// A mutator's `modinfo.lua`.
///
/// `modtype = 1` is what makes it a game the engine can be launched with. The
/// single `depend` entry is the name unitsync reports for the base game, which
/// is the same string a start script names, so the two cannot drift apart. The
/// same shape `src/scenario/mutator.ts` and `src/lego/scratchGame.ts` write.
fn modinfo(project: &ModProject) -> String {
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
        version = lua_string(MUTATOR_VERSION),
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
fn valid_unit_key(key: &str) -> bool {
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

    /// A patch against a weapon must count from one and must not invent the
    /// weapons it does not mention.
    #[test]
    fn a_patch_into_a_weapon_lands_on_the_lua_index() {
        let out = compile(&project(json!({
            "overrides": { "armcom": { "weapons.1.name": "CANNON" } }
        })));
        assert!(out.chunks[0].lua.contains("[2] = { name = \"CANNON\" }"));
        assert!(!out.chunks[0].lua.contains("[1]"));
    }

    #[test]
    fn a_new_unit_is_a_table_and_gets_its_own_file() {
        let out = compile(&project(json!({
            "clones": { "supercom": {
                "key": "supercom", "source": "armcom",
                "replacesGameUnit": false,
                "def": { "maxDamage": 9000, "objectName": "arm_com.s3o" }
            } }
        })));
        assert_eq!(out.chunks[0].form, LuaForm::Table);
        let unit = file(&out, "units/supercom.lua");
        assert!(unit.contains("return {"));
        assert!(unit.contains("[\"supercom\"] = {"));
        assert!(unit.contains("maxDamage = 9000"));
        // Nothing executable in a file that only adds a unit.
        assert!(!unit.contains("UnitDefs"));
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
        assert_eq!(out.chunks.len(), 1);
        assert_eq!(out.chunks[0].form, LuaForm::Table);
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

    /// A game that names its units in a localisation file cannot be patched by
    /// a mutator, and a compiler that silently dropped those edits would be
    /// worse than one that says so.
    #[test]
    fn name_edits_for_a_localisation_game_are_reported_rather_than_dropped() {
        let out = compile(&project(json!({
            "text": { "armcom": { "en": { "name": "Commander", "description": "Boss" } } }
        })));
        assert_eq!(out.notes.len(), 1);
        assert!(out.notes[0].starts_with("2 name and description edits are not compiled."));
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
}
