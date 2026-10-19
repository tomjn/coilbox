//! A game gets only the call-in adapters its own Lua needs (issue #4622), read
//! from its handlers the way the mutator build reads them.

use coilbox_compat::{for_game, manifest, prelude, Handler, LuaState};
use coilbox_luacompat::{scan, Catalogue};

/// The handlers `sources` define, as the mutator build collects them from the
/// scan of the base archive.
fn handlers(sources: &[&str]) -> Vec<Handler> {
    sources
        .iter()
        .flat_map(|src| scan(src, Catalogue::embedded()))
        .flat_map(|hit| {
            let entry = hit.entry_id;
            hit.params
                .into_iter()
                .chain(hit.results.into_iter().flatten())
                .map(move |params| Handler {
                    entry: entry.clone(),
                    params,
                })
        })
        .collect()
}

const GROUND_INFO: &str = "-- fix: spring-ground-info-105\n";

fn prelude_11(sources: &[&str]) -> String {
    let m = for_game(&manifest(11).unwrap(), &handlers(sources));
    prelude(&m, LuaState::Synced).unwrap()
}

/// Spring 1944's game_flagManager.lua, which reads the metal second.
const S44_FLAGS: &str = "local GetGroundInfo = Spring.GetGroundInfo\n\
    local function AnalyzeMetalMap()\n\
    \tlocal _, curMetal = GetGroundInfo(mx, mz)\n\
    end\n";
const NEW_GROUND: &str = "local _, _, metal = Spring.GetGroundInfo(x, z)\n";

#[test]
fn a_game_that_reads_the_old_ground_info_order_through_an_alias_keeps_the_adapter() {
    assert!(prelude_11(&[S44_FLAGS]).contains(GROUND_INFO));
    assert!(prelude_11(&[]).contains(GROUND_INFO));
}

#[test]
fn a_game_that_reads_the_new_ground_info_order_gets_no_adapter_for_it() {
    assert!(!prelude_11(&[NEW_GROUND]).contains(GROUND_INFO));
    assert!(prelude_11(&[NEW_GROUND, S44_FLAGS]).contains(GROUND_INFO));
}

fn synced_prelude(sources: &[&str]) -> String {
    let m = for_game(&manifest(2).unwrap(), &handlers(sources));
    prelude(&m, LuaState::Synced).unwrap()
}

const NEW_DAMAGED: &str = "function gadget:UnitDamaged(unitID, unitDefID, unitTeam, damage, paralyzer, weaponDefID, projectileID, attackerID, attackerDefID, attackerTeam)\nend\n";
const OLD_DAMAGED: &str = "function gadget:UnitDamaged(unitID, unitDefID, unitTeam, damage, paralyzer, weaponID, attackerID, attackerDefID, attackerTeam)\nend\n";
const NEW_COMMAND: &str = "function gadget:AllowCommand(unitID, unitDefID, teamID, cmdID, cmdParams, cmdOptions, cmdTag, playerID, fromSynced, fromLua)\n  return true\nend\n";
const OLD_COMMAND: &str = "function gadget:AllowCommand(unitID, unitDefID, teamID, cmdID, cmdParams, cmdOptions, cmdTag, synced)\n  return true\nend\n";

#[test]
fn a_game_whose_handlers_take_the_new_order_gets_no_adapter_for_them() {
    let prelude = synced_prelude(&[NEW_DAMAGED, NEW_COMMAND]);
    assert!(!prelude.contains("-- fix: callin-unit-damaged-95\n"));
    assert!(!prelude.contains("-- fix: callin-allow-command-105\n"));
    assert!(prelude.contains("-- fix: compat-callin-hooks\n"));
    assert!(prelude.contains("-- fix: spring-unit-travel\n"));
}

#[test]
fn a_game_updated_for_one_change_gets_only_the_other_adapter() {
    let prelude = synced_prelude(&[NEW_DAMAGED, OLD_COMMAND]);
    assert!(!prelude.contains("-- fix: callin-unit-damaged-95\n"));
    assert!(prelude.contains("-- fix: callin-allow-command-105\n"));
}

#[test]
fn a_game_written_for_the_old_order_gets_the_whole_manifest() {
    let full = prelude(&manifest(2).unwrap(), LuaState::Synced).unwrap();
    assert_eq!(synced_prelude(&[OLD_DAMAGED, OLD_COMMAND]), full);
    assert_eq!(synced_prelude(&[]), full);
}

#[test]
fn two_builds_for_the_same_game_are_the_same_bytes() {
    let a = synced_prelude(&[NEW_DAMAGED, OLD_COMMAND]);
    let b = synced_prelude(&[OLD_COMMAND, NEW_DAMAGED]);
    assert_eq!(a, b);
}
