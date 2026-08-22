//! Find and read a unit's animation script inside a game archive.
//!
//! A unit definition names its script in the `script` key, defaulting to
//! `<unitname>.cob`, and the unit script framework then walks `scripts/` for it.
//! That walk is not a plain path lookup: `LuaGadgets/Gadgets/unit_script.lua`
//! tries an exact match, then a basename match, then both again with `.cob`
//! swapped for `.lua`, because the Lua rewrite of a game keeps the old `.cob`
//! name in its definitions. [`find_script`] is that walk.
//!
//! Two kinds of file come back. A `.lua` script is text coilbox can adopt as
//! the unit's own, edit and export. A `.cob` is compiled bytecode: readable
//! through the disassembler in `tauri-plugin-coilbox-anim`, but not Lua and not
//! something an export can write, so it comes back as bytes and is labelled.
//!
//! A `.cob` also brings back the `.bos` source beside it where the game ships
//! one, which most do. That source is text, and coilbox has a BOS to Lua
//! converter, so it is the way a compiled unit still opens with an animation.

use std::path::Path;

use serde::Serialize;

use crate::ffi::Unitsync;

/// Where the framework looks for a unit's script.
const SCRIPT_DIR: &str = "scripts";

/// The biggest script worth reading, in bytes.
///
/// The largest hand-written unit scripts in the games to hand are tens of
/// kilobytes. A megabyte is far past anything real and stops a corrupt archive
/// handing back a member the size of the archive.
const SCRIPT_CAP: usize = 1024 * 1024;

/// One unit's script, as found in its game.
#[derive(Debug, Default, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UnitScriptOutput {
    /// The archive member it was found at, so the caller can say where from.
    pub member: Option<String>,
    /// `lua` or `cob`. Absent when nothing was found.
    pub kind: Option<String>,
    /// The source, for a Lua script. Absent for a `.cob`, which is not text.
    pub text: Option<String>,
    /// The bytes, for a `.cob`. Absent for Lua, which is in `text`.
    pub bytes: Option<Vec<u8>>,
    /// The `.bos` source beside a `.cob`, where the game ships it. Absent for
    /// Lua, which needs no conversion, and for a `.cob` shipped on its own.
    pub bos_member: Option<String>,
    /// That source. Text, because BOS is source rather than bytecode.
    pub bos_text: Option<String>,
    /// What the unit definition asked for, whether or not it was found. Worth
    /// reporting either way: a name that resolved to nothing is the useful
    /// half of "this unit has no script here".
    pub declared: Option<String>,
    pub errors: Vec<String>,
}

impl UnitScriptOutput {
    fn err(message: String) -> Self {
        Self {
            errors: vec![message],
            ..Default::default()
        }
    }
}

/// Print a `UnitScriptOutput` carrying only an error (used on panic/setup fail).
pub fn emit_error(msg: String) {
    println!(
        "{}",
        serde_json::to_string(&UnitScriptOutput::err(msg)).unwrap_or_default()
    );
}

/// Read `unit_name`'s script out of `game_archive`.
///
/// `unit_name` is the unit definition's own key, lower case as the engine
/// stores it. The `script` key is read from the mounted definitions, so a game
/// that computes its script names in Lua is followed rather than guessed at.
pub fn render(lib: &str, game_archive: &str, unit_name: &str) -> UnitScriptOutput {
    let us = match unsafe { Unitsync::load(Path::new(lib)) } {
        Ok(u) => u,
        Err(e) => return UnitScriptOutput::err(e),
    };
    us.init(false, 0);

    if !us.add_all_archives(game_archive) {
        us.uninit();
        return UnitScriptOutput::err(format!("could not mount {game_archive}"));
    }

    let declared = declared_script(&us, unit_name);
    let want = declared
        .clone()
        .unwrap_or_else(|| format!("{unit_name}.cob"));

    // Through the shared resolver rather than joining the name onto the
    // archive directory. A game is named several ways (display name, file name,
    // full path) and only that one knows which is which, so a hand-rolled join
    // opens nothing for most of them.
    let handle = crate::archive::resolve_open_path(&us, game_archive)
        .as_deref()
        .and_then(|p| us.open_archive(p));
    let Some(handle) = handle else {
        us.remove_all_archives();
        us.uninit();
        return UnitScriptOutput {
            declared,
            errors: vec![format!("could not open archive {game_archive}")],
            ..Default::default()
        };
    };

    let list: Vec<(String, String)> = us
        .list_archive_files(handle)
        .into_iter()
        .map(|(path, _)| (path.to_lowercase(), path))
        .collect();

    let mut out = match find_script(&list, &want) {
        Some(member) => read_script(&us, handle, &member, declared.clone()),
        None => UnitScriptOutput {
            declared,
            ..Default::default()
        },
    };

    // Only for a `.cob`. A game shipping Lua has nothing to convert, and the
    // `.bos` beside that Lua is the older source of a script already superseded.
    if out.kind.as_deref() == Some("cob") {
        if let Some(member) = find_bos(&list, &want) {
            if let Some((_, bytes)) = us.read_archive_member(handle, &member, SCRIPT_CAP) {
                out.bos_text = Some(String::from_utf8_lossy(&bytes).into_owned());
                out.bos_member = Some(member);
            }
        }
    }

    us.close_archive(handle);
    us.remove_all_archives();
    us.uninit();
    out
}

/// Read the `script` key off one unit definition.
///
/// Through the game's own definitions rather than off a file, because the key
/// is often built in Lua: a game with one shared script for a family of units
/// writes it that way, and a path lookup would miss every one of them.
fn declared_script(us: &Unitsync, unit_name: &str) -> Option<String> {
    let lua = format!(
        "{}{}\
         local ok, defs = pcall(function() return VFS.Include('gamedata/defs.lua') end)\n\
         local ud = (type(defs) == 'table') and defs.unitDefs or nil\n\
         if type(ud) ~= 'table' then return '' end\n\
         local d = ud['{unit_name}']\n\
         if type(d) ~= 'table' then return '' end\n\
         local s = d.script or d.Script\n\
         return (type(s) == 'string') and s or ''\n",
        crate::lua::CHUNKED_RESULT,
        crate::lua::DEFS_ENV_SHIM
    );
    let raw = us.run_lua_source(&lua, "rmMbe").ok()?;
    let trimmed = raw.trim();
    (!trimmed.is_empty()).then(|| trimmed.to_string())
}

/// The member a declared script name resolves to, following the framework's own
/// order: exact, basename, then both again as `.lua`.
///
/// Case is folded because a definition written on Windows says `ARMCOM.COB` for
/// a member stored as `scripts/armcom.cob`, and the engine does not care.
pub(crate) fn find_script(list: &[(String, String)], declared: &str) -> Option<String> {
    let want = declared.trim().replace('\\', "/").to_lowercase();
    if want.is_empty() {
        return None;
    }

    let swapped = want.strip_suffix(".cob").map(|stem| format!("{stem}.lua"));
    // The framework's own order. A `.lua` beside a `.cob` of the same name is
    // the Lua rewrite of that script, and it is the one that runs, so it is
    // tried before the exact `.cob` the definition still names.
    let candidates: Vec<String> = swapped.into_iter().chain([want]).collect();

    resolve(list, &candidates)
}

/// The `.bos` source sitting beside the script a definition names.
///
/// Many games ship the source they compiled the `.cob` from: SplinterFaction
/// has 83 `.bos` files beside its 84 `.cob` files. The engine never loads one,
/// so this is not part of [`find_script`]'s walk. It is a separate lookup, run
/// only once a `.cob` has already won, that finds source coilbox can convert.
///
/// The walk itself is the framework's, because the source sits where the script
/// does and a game filing one in a subfolder files the other there too.
pub(crate) fn find_bos(list: &[(String, String)], declared: &str) -> Option<String> {
    let want = declared.trim().replace('\\', "/").to_lowercase();
    let stem = want
        .strip_suffix(".cob")
        .or_else(|| want.strip_suffix(".lua"))
        .unwrap_or(&want);
    if stem.is_empty() {
        return None;
    }
    resolve(list, &[format!("{stem}.bos")])
}

/// Exact match on every candidate, then basename match on every candidate.
///
/// Both passes run over the whole list before the next candidate is tried,
/// which is the framework's order: a `.lua` two folders down still beats a
/// `.cob` sitting exactly where the definition said.
fn resolve(list: &[(String, String)], candidates: &[String]) -> Option<String> {
    for candidate in candidates {
        if let Some(hit) = exact(list, &format!("{SCRIPT_DIR}/{candidate}")) {
            return Some(hit);
        }
    }
    for candidate in candidates {
        let base = candidate.rsplit('/').next().unwrap_or(candidate);
        if let Some(hit) = list.iter().find(|(lower, _)| {
            lower.starts_with(SCRIPT_DIR) && lower.ends_with(&format!("/{base}"))
        }) {
            return Some(hit.1.clone());
        }
    }
    None
}

fn exact(list: &[(String, String)], target_lc: &str) -> Option<String> {
    list.iter()
        .find(|(lower, _)| lower == target_lc)
        .map(|(_, real)| real.clone())
}

/// Read the member, and decide from its name whether it is text or bytecode.
fn read_script(
    us: &Unitsync,
    handle: i32,
    member: &str,
    declared: Option<String>,
) -> UnitScriptOutput {
    let Some((_, bytes)) = us.read_archive_member(handle, member, SCRIPT_CAP) else {
        return UnitScriptOutput {
            declared,
            errors: vec![format!("could not read {member}")],
            ..Default::default()
        };
    };

    if member.to_lowercase().ends_with(".lua") {
        // Lossy rather than a failure: a script with one stray byte in a
        // comment is still worth reading, and refusing it over that byte helps
        // nobody. A `.cob` never reaches here, so this is never bytecode.
        return UnitScriptOutput {
            member: Some(member.to_string()),
            kind: Some("lua".into()),
            text: Some(String::from_utf8_lossy(&bytes).into_owned()),
            declared,
            ..Default::default()
        };
    }

    UnitScriptOutput {
        member: Some(member.to_string()),
        kind: Some("cob".into()),
        bytes: Some(bytes),
        declared,
        ..Default::default()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn listing(paths: &[&str]) -> Vec<(String, String)> {
        paths
            .iter()
            .map(|p| (p.to_lowercase(), (*p).to_string()))
            .collect()
    }

    #[test]
    fn finds_the_script_a_definition_names() {
        let list = listing(&["scripts/armcom.lua"]);
        assert_eq!(
            find_script(&list, "armcom.lua"),
            Some("scripts/armcom.lua".into())
        );
    }

    /// A game that moved to Lua keeps the old `.cob` name in its definitions,
    /// and the framework swaps the extension rather than failing.
    #[test]
    fn takes_the_lua_rewrite_of_a_cob_a_definition_still_names() {
        let list = listing(&["scripts/armcom.lua"]);
        assert_eq!(
            find_script(&list, "armcom.cob"),
            Some("scripts/armcom.lua".into())
        );
    }

    /// Both present means the Lua one runs, because the framework only ever
    /// loads `.lua` files and finds it first.
    #[test]
    fn prefers_the_lua_when_both_are_there() {
        let list = listing(&["scripts/armcom.cob", "scripts/armcom.lua"]);
        assert_eq!(
            find_script(&list, "armcom.cob"),
            Some("scripts/armcom.lua".into())
        );
    }

    #[test]
    fn falls_back_to_the_cob_when_there_is_no_lua() {
        let list = listing(&["scripts/armcom.cob"]);
        assert_eq!(
            find_script(&list, "armcom.cob"),
            Some("scripts/armcom.cob".into())
        );
    }

    #[test]
    fn finds_a_script_in_a_subfolder_by_its_name_alone() {
        let list = listing(&["scripts/arm/armcom.lua"]);
        assert_eq!(
            find_script(&list, "armcom.lua"),
            Some("scripts/arm/armcom.lua".into())
        );
    }

    /// A definition written on Windows says `ARMCOM.COB` with backslashes, and
    /// the engine does not care about either.
    #[test]
    fn ignores_case_and_windows_separators() {
        let list = listing(&["scripts/units/armcom.lua"]);
        assert_eq!(
            find_script(&list, "units\\ARMCOM.COB"),
            Some("scripts/units/armcom.lua".into())
        );
    }

    /// A script is only ever loaded out of `scripts/`, so a namesake elsewhere
    /// in the archive is not this unit's script.
    #[test]
    fn does_not_reach_outside_the_scripts_folder() {
        let list = listing(&["luaui/widgets/armcom.lua"]);
        assert_eq!(find_script(&list, "armcom.lua"), None);
    }

    #[test]
    fn finds_nothing_for_a_unit_that_names_nothing() {
        let list = listing(&["scripts/armcom.lua"]);
        assert_eq!(find_script(&list, "   "), None);
    }

    /// The whole point: a compiled script with its source sitting beside it.
    #[test]
    fn finds_the_bos_source_beside_a_cob() {
        let list = listing(&["scripts/armcom.cob", "scripts/armcom.bos"]);
        assert_eq!(
            find_bos(&list, "armcom.cob"),
            Some("scripts/armcom.bos".into())
        );
    }

    /// SplinterFaction ships one more `.cob` than `.bos`, so a compiled script
    /// with no source is the ordinary case rather than a fault.
    #[test]
    fn finds_no_source_for_a_cob_shipped_without_one() {
        let list = listing(&["scripts/armcom.cob"]);
        assert_eq!(find_bos(&list, "armcom.cob"), None);
    }

    /// The same fold the framework's own walk does, because a definition
    /// written on Windows names the script that way.
    #[test]
    fn finds_the_source_ignoring_case_and_separators_and_subfolders() {
        let list = listing(&["scripts/arm/ARMCOM.BOS"]);
        assert_eq!(
            find_bos(&list, "units\\ARMCOM.COB"),
            Some("scripts/arm/ARMCOM.BOS".into())
        );
    }

    /// A game that moved to Lua names its script `.lua`, and the source beside
    /// it is still `.bos`.
    #[test]
    fn finds_the_source_for_a_script_named_as_lua() {
        let list = listing(&["scripts/armcom.bos"]);
        assert_eq!(
            find_bos(&list, "armcom.lua"),
            Some("scripts/armcom.bos".into())
        );
    }

    /// A script is only ever loaded out of `scripts/`, and its source is only
    /// ever found there for the same reason.
    #[test]
    fn does_not_take_source_from_outside_the_scripts_folder() {
        let list = listing(&["examples/armcom.bos"]);
        assert_eq!(find_bos(&list, "armcom.cob"), None);
    }
}
