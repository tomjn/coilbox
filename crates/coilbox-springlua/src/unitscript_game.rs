//! What a unit script finds in its world that the unit script API does not put
//! there (issue #2791).
//!
//! A unit script runs inside the game's LuaRules state, so it can reach the
//! engine's constant tables, the libraries the game's gadget handler loaded
//! before any unit existed, and whatever the game's gadgets put in `GG`. Zero-K
//! leans on all three, and most of its units stopped on one of them.
//!
//! Three kinds of stand-in, each chosen by what the real thing hands back:
//!
//!  - the engine's constants, `Game`, `CMD` and `CMDTYPE`, which are the same
//!    numbers in every game and are copied from the engine source.
//!  - the game's own library code, `LuaRules/Utilities.lua`, run from the files
//!    the unitsync worker read with the script, because its vector maths moves
//!    pieces and a stub could only guess at it.
//!  - Zero-K's gadget tables in `GG`, answered as they stand for a finished unit
//!    nothing has slowed, buffed or upgraded. None of them moves a piece.

use std::cell::RefCell;
use std::collections::HashMap;
use std::rc::Rc;

use mlua::{Function, Lua, MultiValue, Table};

use super::{describe, fold_include, Sim};

/// Where a game following Zero-K's layout keeps the library its gadget handler
/// loads into the LuaRules state (`LuaRules/gadgets.lua:41` in Zero-K).
const UTILITIES: &str = "LuaRules/Utilities.lua";

/// Install the engine's constants, a `VFS` over the files read with the script,
/// and Zero-K's gadget tables.
pub(super) fn install(
    lua: &Lua,
    sim: &Rc<RefCell<Sim>>,
    includes: &HashMap<String, String>,
) -> mlua::Result<()> {
    install_engine_constants(lua)?;
    install_vfs(lua, sim, includes)?;
    install_zero_k_gadgets(lua, sim)
}

/// Run the game's own `LuaRules/Utilities.lua`, as its gadget handler does
/// before any unit script loads, when the worker read it with the script.
///
/// It fills `Spring.Utilities`. Nothing happens for a game that does not ship
/// one, which is every game not built from Zero-K.
pub(super) fn load_libraries(lua: &Lua, sim: &Rc<RefCell<Sim>>) -> mlua::Result<()> {
    let include: Function = lua.globals().get::<Table>("VFS")?.get("Include")?;
    let exists: Function = lua.globals().get::<Table>("VFS")?.get("FileExists")?;
    if !exists.call::<bool>(UTILITIES)? {
        return Ok(());
    }
    if let Err(error) = include.call::<MultiValue>(UTILITIES) {
        sim.borrow_mut().model.note(format!(
            "The game's {UTILITIES} stopped: {}",
            describe(&error)
        ));
    }
    Ok(())
}

/// A call with no effect on the pieces, noted each time it is made.
fn does_nothing(lua: &Lua, sim: &Rc<RefCell<Sim>>, label: &str) -> mlua::Result<Function> {
    let state = Rc::clone(sim);
    let label = label.to_string();
    lua.create_function(move |_, _: MultiValue| {
        state
            .borrow_mut()
            .model
            .note(format!("{label} does nothing in the preview."));
        Ok(())
    })
}

/// `Game`, `CMD`, `CMDTYPE` and `math.tau`, with the engine's values.
///
/// `Game` holds only what is the same in every match, from
/// `rts/Lua/LuaConstGame.cpp` and `rts/Sim/Misc/GlobalConstants.h`. Its map
/// fields are left out, because the preview has no map and a made up size would
/// clamp a position to a map nobody chose.
///
/// `CMD` and `CMDTYPE` are from `rts/Lua/LuaConstCMD.cpp`,
/// `rts/Lua/LuaConstCMDTYPE.cpp` and `rts/Sim/Units/CommandAI/Command.h`. Both
/// map each name to its number and each number back to its name, as the engine
/// builds them. Zero-K's own command list reads `CMDTYPE` while it loads.
///
/// `FeatureDefs` and `FeatureDefNames` are empty, since the preview has no
/// features. A script looking one up finds none, which is the branch where it
/// spawns no wreck.
fn install_engine_constants(lua: &Lua) -> mlua::Result<()> {
    lua.load(
        r#"
        local function dual(names)
          local t = {}
          for name, id in pairs(names) do
            t[name] = id
            t[id] = name
          end
          return t
        end

        Game = {
          gameSpeed = 30,
          squareSize = 8,
          metalMapSquareSize = 16,
          buildSquareSize = 16,
          buildGridResolution = 2,
          footprintScale = 2,
        }

        CMD = dual({
          STOP = 0, INSERT = 1, REMOVE = 2, WAIT = 5, TIMEWAIT = 6,
          DEATHWAIT = 7, SQUADWAIT = 8, GATHERWAIT = 9, MOVE = 10, PATROL = 15,
          FIGHT = 16, ATTACK = 20, AREA_ATTACK = 21, GUARD = 25,
          GROUPSELECT = 35, GROUPADD = 36, GROUPCLEAR = 37, REPAIR = 40,
          FIRE_STATE = 45, MOVE_STATE = 50, SETBASE = 55, INTERNAL = 60,
          SELFD = 65, LOAD_UNITS = 75, LOAD_ONTO = 76, UNLOAD_UNITS = 80,
          UNLOAD_UNIT = 81, ONOFF = 85, RECLAIM = 90, CLOAK = 95,
          STOCKPILE = 100, MANUALFIRE = 105, RESTORE = 110, REPEAT = 115,
          TRAJECTORY = 120, RESURRECT = 125, CAPTURE = 130,
          AUTOREPAIRLEVEL = 135, IDLEMODE = 145,
        })
        CMD.DGUN = CMD.MANUALFIRE
        CMD.LOOPBACKATTACK = CMD.ATTACK
        CMD.OPT_ALT, CMD.OPT_CTRL, CMD.OPT_SHIFT = 128, 64, 32
        CMD.OPT_RIGHT, CMD.OPT_INTERNAL, CMD.OPT_META = 16, 8, 4
        CMD.MOVESTATE_NONE, CMD.MOVESTATE_HOLDPOS = -1, 0
        CMD.MOVESTATE_MANEUVER, CMD.MOVESTATE_ROAM = 1, 2
        CMD.FIRESTATE_NONE, CMD.FIRESTATE_HOLDFIRE = -1, 0
        CMD.FIRESTATE_RETURNFIRE, CMD.FIRESTATE_FIREATWILL = 1, 2
        CMD.FIRESTATE_FIREATNEUTRAL = 3
        CMD.WAITCODE_TIME, CMD.WAITCODE_DEATH = 1, 2
        CMD.WAITCODE_SQUAD, CMD.WAITCODE_GATHER = 3, 4

        CMDTYPE = dual({
          ICON = 0, ICON_MODE = 5, ICON_MAP = 10, ICON_AREA = 11,
          ICON_UNIT = 12, ICON_UNIT_OR_MAP = 13, ICON_FRONT = 14,
          ICON_UNIT_OR_AREA = 16, NEXT = 17, PREV = 18,
          ICON_UNIT_FEATURE_OR_AREA = 19, ICON_BUILDING = 20, CUSTOM = 21,
          ICON_UNIT_OR_RECTANGLE = 22, NUMBER = 23,
        })

        FeatureDefs, FeatureDefNames = {}, {}

        -- Recoil's Lua adds a full turn to `math` (`rts/lib/lua/src/lmathlib.cpp`).
        math.tau = 2 * math.pi
        "#,
    )
    .set_name("unitscript:constants")
    .exec()
}

/// `VFS` and `Script`, over the files the worker read with the script.
///
/// Enough for a game's library to load the rest of itself: Zero-K's
/// `Utilities.lua` lists `LuaRules/Utilities/` and includes each file it
/// finds. The files are keyed by their path in the archive. Nothing else is
/// reachable, so a script cannot read the game beyond what was handed in.
///
/// One difference from the engine, on purpose. A file that throws while it
/// loads is noted and answers nothing, where the engine would pass the error
/// up. The game's libraries were written for a gadget's Lua state, which has
/// calls the preview does not, and one that needs drawing calls should not stop
/// the vector maths in the next file from loading.
fn install_vfs(
    lua: &Lua,
    sim: &Rc<RefCell<Sim>>,
    includes: &HashMap<String, String>,
) -> mlua::Result<()> {
    let files: Rc<Vec<(String, String, String)>> = Rc::new(
        includes
            .iter()
            .map(|(name, text)| (fold_include(name), name.clone(), text.clone()))
            .collect(),
    );
    let find = |files: &[(String, String, String)], name: &str| -> Option<String> {
        let want = fold_include(name);
        files
            .iter()
            .find(|(folded, _, _)| *folded == want)
            .map(|(_, _, text)| text.clone())
    };

    let vfs = lua.create_table()?;
    for (name, mode) in crate::vfs::MODES {
        vfs.set(*name, *mode)?;
    }

    let held = Rc::clone(&files);
    let state = Rc::clone(sim);
    vfs.set(
        "Include",
        lua.create_function(move |lua, (name, env): (String, Option<Table>)| {
            let Some(text) = find(&held, &name) else {
                state.borrow_mut().model.note(format!(
                    "VFS.Include(\"{name}\") read nothing: the preview does not have that file."
                ));
                return Ok(MultiValue::new());
            };
            let mut chunk = lua.load(text).set_name(&name);
            if let Some(env) = env {
                chunk = chunk.set_environment(env);
            }
            match chunk.call::<MultiValue>(()) {
                Ok(values) => Ok(values),
                Err(error) => {
                    state.borrow_mut().model.note(format!(
                        "VFS.Include(\"{name}\") stopped, so whatever it defines is missing: {}",
                        describe(&error)
                    ));
                    Ok(MultiValue::new())
                }
            }
        })?,
    )?;

    let held = Rc::clone(&files);
    vfs.set(
        "LoadFile",
        lua.create_function(move |_, (name, _): (String, MultiValue)| Ok(find(&held, &name)))?,
    )?;

    let held = Rc::clone(&files);
    vfs.set(
        "FileExists",
        lua.create_function(move |_, (name, _): (String, MultiValue)| {
            Ok(find(&held, &name).is_some())
        })?,
    )?;

    // The files directly inside `dir`, by their archive spelling, matching an
    // optional `*` and `?` pattern as the engine's does, without regard to case.
    let held = Rc::clone(&files);
    vfs.set(
        "DirList",
        lua.create_function(
            move |lua, (dir, pattern, _): (String, Option<String>, MultiValue)| {
                let mut prefix = fold_include(&dir);
                if !prefix.is_empty() && !prefix.ends_with('/') {
                    prefix.push('/');
                }
                let pattern = pattern.unwrap_or_else(|| "*".into()).to_lowercase();
                let mut found: Vec<String> = held
                    .iter()
                    .filter(|(folded, _, _)| {
                        folded
                            .strip_prefix(&prefix)
                            .is_some_and(|rest| !rest.contains('/') && glob(&pattern, rest))
                    })
                    .map(|(_, name, _)| name.clone())
                    .collect();
                found.sort();
                lua.create_sequence_from(found)
            },
        )?,
    )?;
    lua.globals().set("VFS", vfs)?;

    // The LuaRules state's own name, which is what `Script.GetName` answers
    // to every gadget and unit script in it.
    let script = lua.create_table()?;
    script.set(
        "GetName",
        lua.create_function(|_, _: MultiValue| Ok("LuaRules"))?,
    )?;
    lua.globals().set("Script", script)
}

/// Whether `name` matches a VFS pattern, where `*` is any run of characters and
/// `?` is one.
///
/// Greedy, going back only to the latest `*`, so it takes time in proportion
/// to the two lengths multiplied, whatever pattern the game's Lua passes.
fn glob(pattern: &str, name: &str) -> bool {
    let p: Vec<char> = pattern.chars().collect();
    let n: Vec<char> = name.chars().collect();
    let (mut pi, mut ni) = (0, 0);
    let mut star: Option<(usize, usize)> = None;
    while ni < n.len() {
        if pi < p.len() && p[pi] == '*' {
            star = Some((pi, ni));
            pi += 1;
        } else if pi < p.len() && (p[pi] == '?' || p[pi] == n[ni]) {
            pi += 1;
            ni += 1;
        } else if let Some((at, from)) = star {
            pi = at + 1;
            ni = from + 1;
            star = Some((at, from + 1));
        } else {
            return false;
        }
    }
    p[pi..].iter().all(|c| *c == '*')
}

/// What Zero-K's gadgets put in `GG` for a unit script to use, answered as for
/// a finished unit nothing is acting on.
///
/// - `unit_attributes_generic.lua:68-83` creates each `att_` table empty, and
///   fills a unit's entry only while something slows, buffs or disables it.
///   Scripts read `GG.att_MoveChange[unitID] or 1`, so an empty table is a unit
///   moving at its own speed.
/// - the same gadget's `GG.Attributes` changes a unit's stats, never its
///   pieces, and so does `GG.UpdateUnitAttributes` from `unit_attributes.lua`.
/// - `GG.PokeDecloakUnit` (`unit_decloak_damaged.lua`) uncloaks a unit for a
///   while.
/// - `GG.Upgrades_WeaponNumMap` (`unit_commander_upgrade.lua:728`) answers
///   `false` for every unit once it has been created.
///
/// Games built from Zero-K carry the same gadgets under the same names. A game
/// without them never reads these names, because nothing in it would set them.
fn install_zero_k_gadgets(lua: &Lua, sim: &Rc<RefCell<Sim>>) -> mlua::Result<()> {
    let gg: Table = lua.globals().get("GG")?;
    for name in [
        "att_LastChangeFrame",
        "att_CostMult",
        "att_HealthMult",
        "att_EconomyChange",
        "att_ReloadChange",
        "att_MoveChange",
        "att_RangeChange",
        "att_JumpRangeChange",
        "att_DeathExplodeMult",
        "att_ProjSpeed",
        "att_ProjMult",
        "att_DamageMult",
        "att_RegenChange",
        "att_ShieldRegenChange",
        "att_ShieldMaxMult",
        "att_StaticBuildRateMult",
    ] {
        gg.set(name, lua.create_table()?)?;
    }

    let attributes = lua.create_table()?;
    for name in [
        "AddEffect",
        "RemoveEffect",
        "RemoveUnit",
        "SetRangeUpdater",
        "SetProjectileSpeedLock",
    ] {
        attributes.set(
            name,
            does_nothing(lua, sim, &format!("GG.Attributes.{name}"))?,
        )?;
    }
    gg.set("Attributes", attributes)?;
    for name in ["UpdateUnitAttributes", "PokeDecloakUnit"] {
        gg.set(name, does_nothing(lua, sim, &format!("GG.{name}"))?)?;
    }
    gg.set(
        "Upgrades_WeaponNumMap",
        lua.create_function(|_, _: MultiValue| Ok(false))?,
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::glob;

    #[test]
    fn a_vfs_pattern_matches_as_the_engine_does() {
        assert!(glob("*.lua", "vector.lua"));
        assert!(!glob("*.lua", "vector.lua.bak"));
        assert!(glob("*", "anything"));
        assert!(glob("v?ctor.lua", "vector.lua"));
        assert!(glob("*a*b", "xxaxxb"));
        assert!(!glob("*a*b", "xxaxx"));
        // A `*` in the name is still matched by the pattern's `*` as a wildcard.
        assert!(glob("*", "*x"));
        // Answers at once rather than trying every split of the name.
        assert!(!glob(&"*a".repeat(30), &"a".repeat(29)));
    }
}
