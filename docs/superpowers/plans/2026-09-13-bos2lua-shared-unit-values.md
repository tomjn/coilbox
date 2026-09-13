# Shared COB unit values in converted Lua scripts: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Older games that share numbers between units through COB unit values 1024 to 8191 keep working when `coilbox-bos2lua` converts their scripts to Lua for a current Recoil engine. Their gadgets and widgets get working `Spring.GetCOB*Var`, `Spring.GetUnitCOBValue` and `Spring.SetUnitCOBValue` back from a file coilbox writes for the game. Scripts using `CURRENT_FUEL` or `ALPHA_THRESHOLD` get a warning, because neither can be brought back.

**Architecture:** The converter sends every `get` and `set` whose id is a shared value, or is only known at runtime, through two Lua helpers, `cobGet` and `cobSet`. They keep each value as a rules param on the unit, the team or the game, and hand any other id to the engine as before. Rules params reach synced gadgets, unsynced gadgets and widgets. A polyfill file, `lualibs/cob_vars.lua`, reads and writes the same params: it brings back the four removed `Spring.GetCOB*Var` functions everywhere, and wraps `Spring.GetUnitCOBValue` and `Spring.SetUnitCOBValue` in synced LuaRules. The game includes it from its own entry files. Basecontent is never modified. The preview's Lua runtime is changed first to answer shared values as the engine does, so the tests can tell a working conversion from a broken one.

**Tech Stack:** Rust (`coilbox-bos2lua`, `coilbox-springlua`, `coilbox-unitpose`, `tauri-plugin-coilbox-anim`), Lua 5.1 as the engine runs it, mlua in the preview runtime, React and TypeScript for the BOS to Lua page.

**Spec:** No spec document. The findings this plan works from are under Background, each with its source.

## Background

Engine facts are from `~/dev/RecoilEngine`, test game facts from `~/dev/spring-testdata/games`, and THIS facts from `~/.spring/games/THIS.sdd`.

The removal:

- Spring 102.0 deprecated the COB unit, team, allyteam and global values (commit `6d36b84dc1`, 2016, `doc/changelog.txt` line 1326, marked `!`). From then on a read returned 0 and a write did nothing. Recoil deleted the code in July 2020 (commit `b444a9416a`). Those ids now reach the `unknown get-constant` and `unknown set-constant` branches in `rts/Sim/Units/Scripts/UnitScript.cpp`, which log an error and return 0.
- `Spring.UnitScript.GetUnitValue` and `SetUnitValue` call the same `CUnitScript::GetUnitVal` and `SetUnitVal` (`rts/Sim/Units/Scripts/LuaUnitScript.cpp:1262`), so a converted script that passes these ids to the engine fails exactly as the COB did.
- The id layout, fixed since 0.77b1 (`git show 101.0:rts/Sim/Units/Scripts/UnitScript.h`):

| Kind | Ids | Count | Keyed by |
|---|---|---|---|
| Unit | 1024-1031 | 8 | the unit, or another unit through the first argument |
| Team | 2048-2111 | 64 | the unit's team at the time of the call |
| Allyteam | 3072-3135 | 64 | the unit's allyteam at the time of the call |
| Global | 4096-8191 | 4096 | nothing, one set for the game |

- Unit values had three forms (`git show 101.0:rts/Sim/Units/Scripts/UnitScript.cpp`, lines 1338-1364). `get 1024+n` with first argument 0 read the unit's own value. With a positive first argument it read that unit's value, or 0 if the unit was missing. With a negative first argument it set unit `-p1`'s value to the second argument and returned 1, or 0 if the unit was missing. `set 1024+n to v` set the unit's own value. Every value started at 0.
- `CURRENT_FUEL` (93) has returned 0 and ignored sets with no error since fuel was removed in 101.0. `ALPHA_THRESHOLD` (103) was removed in 99.0 (commit `9072350aca`) and now hits the unknown-constant error.

The Lua functions:

- Removed in 102.0 (`git show 101.0:rts/Lua/LuaSyncedRead.cpp`, lines 5654-5745): `GetCOBUnitVar(unitID, n [, split])` returned nothing for a unit that was not allied or did not exist. `GetCOBTeamVar(teamID, n [, split])` and `GetCOBAllyTeamVar(allyTeamID, n [, split])` returned nothing for an invalid or unallied team or allyteam. `GetCOBGlobalVar(n [, split])` had no access check. All four returned nothing for `n` out of range, counted from 0. They lived in `LuaSyncedRead`, which the engine registers for synced gadgets (`rts/Lua/LuaHandleSynced.cpp:131`), unsynced gadgets (`:509`) and widgets (`rts/Lua/LuaUI.cpp:128`).
- With `split` true a value came back as two numbers, `UNPACKX` then `UNPACKZ` (`rts/Sim/Units/Scripts/CobInstance.h:10-12`): the top 16 bits and the bottom 16 bits, each as a signed 16 bit number.
- Still present: `Spring.GetUnitCOBValue(unitID, [split,] id, p1, p2, p3, p4)` and `Spring.SetUnitCOBValue(unitID, id, value)`, registered "for backwards compatibility" wherever the Lua unit script functions are (`LuaUnitScript.cpp:1090-1091`, bodies at 1305 and 1362), which is synced LuaRules. The commented-out registrations at `rts/Lua/LuaSyncedCtrl.cpp:319-320` date from their 2009 move and mean nothing. They call `GetUnitVal` and `SetUnitVal` on the unit's script, so a shared id fails through them too.

Why rules params, not `GG`:

- `GG` is the gadget handler's table (`cont/base/springcontent/LuaGadgets/gadgets.lua` lines 71 and 282). It exists only in the synced LuaRules state. Unsynced code reads synced state through `SYNCED`, which copies globals only (`rts/Lua/LuaSyncedTable.cpp`), and widgets run in a separate state.
- Rules params are set from synced Lua and read through `LuaSyncedRead`, so all three places can read them. The setters take an access table, where `{ allied = true }` matches the old allied checks (`rts/Lua/LuaSyncedCtrl.cpp` around line 1583). `GetGameRulesParam` reads with the private mask, so every reader sees a game param (`rts/Lua/LuaSyncedRead.cpp:1169`). There are no allyteam rules params, so an allyteam value is written on every team in the allyteam.
- `GetUnitRulesParam` and `SetUnitRulesParam` return nothing and do nothing for a unit that does not exist (`LuaSyncedRead.cpp:1241`, `LuaSyncedCtrl.cpp:1678`). A new unit starts with no rules params, even when it reuses an old unit's ID. `Spring.GetTeamList(allyTeamID)` returns nothing for an invalid allyteam (`LuaSyncedRead.cpp:1668`).

How games load this without touching basecontent:

- The engine loads `LuaRules/main.lua`, `LuaRules/draw.lua` (`rts/Lua/LuaRules.cpp:22-23`) and `luaui.lua`, or `LuaUI/main.lua` when there is no `luaui.lua` (`rts/Lua/LuaUI.cpp:93`), from the game. All are game files.
- The gadget handler only loads the game's own `LuaRules/Gadgets/` folder. Basecontent's `unit_script.lua` gadget runs only if the game has a file that includes it. SplinterFaction 0.1.78 and THIS both ship a six line `LuaRules/Gadgets/unit_script.lua` that does. Metal Factions 2.58 has none.
- Metal Factions 2.58's `luaui.lua` line 21 includes `lualibs/security.lua`, so widgets can include a `lualibs/` file from the game archive.

THIS, the legacy game this plan is checked against:

- 30 `.bos` and 30 `.cob` files in `scripts/`, plus 12 hand-written Lua unit scripts. `minelayer` has both, and `units/minelayer.fbi` already names `minelayer.lua`.
- `scripts/THIS.h` defines perks as team values, `PERK_BETTER_KINETICS` 2049 to `PERK_GRAV_FLAK` 2060. 23 files in `scripts/` use them, such as `if (!get PERK_MORE_GUNS)` in `sword.bos`. `scripts/exptype.h` also defines `UNIT_VAR` 1024, `TEAM_VAR` 2048, `ALLY_VAR` 3072 and `GLOBAL_VAR` 4096, and both headers define `CURRENT_FUEL` and `ALPHA_THRESHOLD`.
- `LuaRules/Gadgets/perks.locals.lua` lines 59-76 set a picked perk with `spSetUnitCOBValue(u, 2048+perk, 1)` on the first unit without a Lua script, then call `NewPerk` on every unit: `CallCOBScript(u, "NewPerk", 0, 2048+perk)` for COB units and `CallAsUnit(u, env.NewPerk, perk)` for Lua units. The hand-written Lua scripts read `GG.perks[team].have[...]` instead of team values.
- THIS never calls `Spring.GetCOB*Var`. `unit_turn.lua`, `build.locals.lua` and `unit_timeslow.lua` call `Get` and `SetUnitCOBValue` with ordinary ids such as `COB.HEADING` and 82.
- `LuaRules/main.lua` and `LuaRules/draw.lua` start with `VFS.Include("LuaGadgets/gadgets.lua",nil, VFS.BASE)`. The game has both `luaui.lua` and `LuaUI/main.lua`.

In coilbox:

- The preview's Lua runtime stores any unit value a script sets and hands it back (`crates/coilbox-springlua/src/unitscript.rs`, `install_unit_value`). That is why a converted script using team values plays correctly in the preview today while reading 0 in the game. Its unit rules param stubs also ignore which unit they are given.
- The BOS to Lua page (`src/animation/pages/Bos2LuaPage.tsx`) calls `anim_bos2lua` (`crates/tauri-plugin-coilbox-anim/src/lib.rs`, `animBos2lua` in `src/animation/bindings.ts`) and lists the conversion's warnings under the Lua.

## Global constraints

- Branch from `main` before the first commit: `git switch -c bos2lua-shared-unit-values`. No worktree. No rebase.
- Stage files by name. Never `git add -A`.
- No new external dependencies, and no Tauri command added, so no ACL change. The one new dependency edge is internal: `tauri-plugin-coilbox-lego` gains `coilbox-bos2lua` by path in Task 6.
- Basecontent is never modified. Everything a game needs is a file the game owns or adds.
- Never modify `~/.spring/games/THIS.sdd` itself. Task 7 works on a copy.
- Rules param names are fixed and shared by the converter and the polyfill: `cobUnitVar<n>`, `cobTeamVar<n>`, `cobAllyVar<n>` and `cobGlobalVar<n>`, with `n` counted from 0 within its range.
- Comments and messages follow the crates' existing voice: plain sentences, no semicolons, no em dashes.
- Before any PR, run all seven CI commands from `CLAUDE.md`, not a subset: `bunx biome ci .`, `bun run typecheck`, `bun run test`, `scripts/mission-tests.sh`, `cargo fmt --all --check`, `cargo clippy --all-targets -- -D warnings`, `cargo test --workspace`. `luajit` must be on PATH.
- A PR goes through the `file-pr` skill, and the user approves its description before it is created. The user gets to try the change with `bun tauri dev` first.

## File structure

- `crates/coilbox-unitpose/src/unitvalue.rs`: gains `removed_shared(id)`, the one definition of the shared ranges in Rust.
- `crates/coilbox-springlua/src/unitscript.rs`: the preview answers shared unit values as the engine does, its rules param stubs respect which unit and team they are given, and it gains the team stubs the new Lua calls.
- `crates/coilbox-springlua/src/unitscript_tests.rs`: tests for those changes, in `mod world`.
- `crates/coilbox-bos2lua/src/shared_values.lua`: new. The Lua a converted script carries when it shares values.
- `crates/coilbox-bos2lua/src/cob_vars.lua`: new. The polyfill a game adds as `lualibs/cob_vars.lua`.
- `crates/coilbox-bos2lua/src/emit.rs`: routes `get` and `set`, emits `shared_values.lua`, and warns.
- `crates/coilbox-bos2lua/src/lib.rs`: exports the polyfill text and says whether a conversion shares values.
- `crates/coilbox-bos2lua/tests/removed_values.rs`: new. Conversion, runtime and polyfill tests.
- `crates/tauri-plugin-coilbox-anim/src/lib.rs`, `src/animation/bindings.ts`, `src/animation/pages/Bos2LuaPage.tsx`: the page offers the polyfill file when a conversion needs it.
- `crates/tauri-plugin-coilbox-anim/src/cobrun.rs`, `cobrun_tests.rs`: the COB runtime the model editor plays a compiled unit with says when a script uses a shared value, without changing what it stores.
- `crates/tauri-plugin-coilbox-lego/Cargo.toml`, `crates/tauri-plugin-coilbox-lego/src/lib.rs`, `src/lego/bindings.ts`, `src/lego/pages/components/ExportDrawer.tsx`: a model editor export writes `lualibs/cob_vars.lua` beside a script that shares values, and the export drawer says how to wire it.

---

### Task 1: The preview answers shared values and rules params as the engine does

**Files:**
- Modify: `crates/coilbox-unitpose/src/unitvalue.rs` (new function above `known`, new test in `mod tests`)
- Modify: `crates/coilbox-springlua/src/unitscript.rs` (`Sim` at line 196, `install_unit_value`, and the rules param stubs in `install_spring` from line 1436)
- Test: `crates/coilbox-springlua/src/unitscript_tests.rs` (`mod world`, from line 1501)

**Interfaces:**
- Produces: `pub fn removed_shared(id: i32) -> bool` in `coilbox_unitpose::unitvalue`. True for 1024..=1031, 2048..=2111, 3072..=3135 and 4096..=8191.
- Produces, in the preview's `Spring` table: `SetUnitRulesParam` and `GetUnitRulesParam` act only for unit `unitvalue::UNIT_ID` (1). `SetTeamRulesParam` and `GetTeamRulesParam` act only for team 0. `ValidUnitID(id)` is true only for unit 1. `GetUnitAllyTeam` returns 0. `GetTeamList()` and `GetTeamList(0)` return `{ 0 }`, and any other allyteam returns nil. `GetTeamInfo(0)` returns 0, and any other team returns nil.

- [ ] **Step 1: Create the branch**

Run: `git switch -c bos2lua-shared-unit-values`
Expected: `Switched to a new branch 'bos2lua-shared-unit-values'`

- [ ] **Step 2: Write the failing unitpose test**

Add to `mod tests` in `crates/coilbox-unitpose/src/unitvalue.rs`, after `does_the_maths_a_script_asks_for`:

```rust
    /// The values BOS scripts once shared, which Spring 102.0 stopped keeping.
    /// The edges matter, because the ids between the ranges were never shared
    /// and still reach the engine.
    #[test]
    fn knows_which_values_were_shared() {
        for id in [1024, 1031, 2048, 2111, 3072, 3135, 4096, 8191] {
            assert!(removed_shared(id), "{id}");
        }
        for id in [1023, 1032, 2047, 2112, 3071, 3136, 4095, 8192, 93, 103] {
            assert!(!removed_shared(id), "{id}");
        }
    }
```

- [ ] **Step 3: Run it to see it fail**

Run: `cargo test -p coilbox-unitpose knows_which_values_were_shared`
Expected: compile error, `cannot find function removed_shared`.

- [ ] **Step 4: Add the function**

In `crates/coilbox-unitpose/src/unitvalue.rs`, directly above `pub fn known`:

```rust
/// Unit values 1024 to 8191 once held numbers BOS scripts shared: 8 per unit,
/// 64 per team, 64 per allyteam and 4096 for the whole game. Spring 102.0
/// stopped keeping them and Recoil deleted them, so the engine answers 0 and
/// ignores a set.
pub fn removed_shared(id: i32) -> bool {
    matches!(id, 1024..=1031 | 2048..=2111 | 3072..=3135 | 4096..=8191)
}
```

- [ ] **Step 5: Run it to see it pass**

Run: `cargo test -p coilbox-unitpose knows_which_values_were_shared`
Expected: `test result: ok. 1 passed`

- [ ] **Step 6: Write the failing preview tests**

Add inside `mod world` in `crates/coilbox-springlua/src/unitscript_tests.rs`, after `a_question_about_the_world_says_there_is_none`:

```rust
    /// The engine stopped keeping shared values in Spring 102.0, so a script
    /// that sets one and reads it back gets 0 in the game. A preview that
    /// handed the number back would show a script working that does not.
    #[test]
    fn a_shared_value_reads_zero_as_the_engine_answers() {
        let timeline = play(
            r#"
            local turret = piece("turret")
            function script.Create()
                SetUnitValue(2048, 5)
                Turn(turret, y_axis, GetUnitValue(2048))
            end
            "#,
            3,
        );

        assert_eq!(timeline.error, None);
        assert_close(rot_y(&timeline, 0, "turret"), 0.0);
        assert!(
            note_about(&timeline, "the engine no longer keeps shared values"),
            "{:?}",
            timeline.warnings
        );
    }

    /// The preview has one unit, 1, on team 0 in allyteam 0. A rules param or a
    /// question about any other unit or team finds nothing, as it would for a
    /// unit or team that does not exist. Each check adds its own bit, so a
    /// wrong total says which one failed.
    #[test]
    fn rules_params_and_teams_belong_to_the_one_unit() {
        let timeline = play(
            r#"
            local turret = piece("turret")
            function script.Create()
                Spring.SetUnitRulesParam(unitID, "mine", 1, { allied = true })
                Spring.SetUnitRulesParam(unitID + 1, "mine", 10)
                Spring.SetTeamRulesParam(0, "ours", 2, { allied = true })
                Spring.SetTeamRulesParam(1, "ours", 20)
                local total = Spring.GetUnitRulesParam(unitID, "mine") + Spring.GetTeamRulesParam(0, "ours")
                if Spring.GetUnitRulesParam(unitID + 1, "mine") == nil and Spring.GetTeamRulesParam(1, "ours") == nil then
                    total = total + 4
                end
                if Spring.ValidUnitID(unitID) and not Spring.ValidUnitID(unitID + 1) then
                    total = total + 8
                end
                if Spring.GetTeamList(Spring.GetUnitAllyTeam(unitID))[1] == 0 and Spring.GetTeamList(1) == nil then
                    total = total + 16
                end
                if Spring.GetTeamInfo(0) == 0 and Spring.GetTeamInfo(1) == nil then
                    total = total + 32
                end
                Move(turret, y_axis, total)
            end
            "#,
            3,
        );

        assert_eq!(timeline.error, None);
        assert_close(pose(&timeline, 0, "turret")[1], 63.0);
    }
```

- [ ] **Step 7: Run them to see them fail**

Run: `cargo test -p coilbox-springlua -- a_shared_value_reads_zero rules_params_and_teams_belong`
Expected: `a_shared_value_reads_zero_as_the_engine_answers` fails with `expected 0, got 5`. `rules_params_and_teams_belong_to_the_one_unit` fails with `timeline.error` set, because `SetTeamRulesParam` is nil.

- [ ] **Step 8: Answer shared unit values as the engine does**

In `install_unit_value` in `crates/coilbox-springlua/src/unitscript.rs`, make the start of the `SetUnitValue` closure:

```rust
        lua.create_function(move |_, (id, value, _rest): (i64, Value, MultiValue)| {
            if unitvalue::removed_shared(id as i32) {
                state.borrow_mut().model.note(format!(
                    "This script sets shared value {id}, and the engine no longer keeps shared values, so the game ignores it."
                ));
                return Ok(());
            }
            let value = match value {
```

In the `GetUnitValue` closure, directly after the `unitvalue::arithmetic` block and before `let mut sim = state.borrow_mut();`:

```rust
            if unitvalue::removed_shared(id) {
                state.borrow_mut().model.note(format!(
                    "This script asks for shared value {id}, and the engine no longer keeps shared values, so it reads 0 in the game."
                ));
                return Ok(0);
            }
```

- [ ] **Step 9: Give the preview's rules params an owner, and add the team stubs**

Add a field to `Sim`, after `unit_rules`:

```rust
    team_rules: HashMap<String, RuleValue>,
```

`Sim` derives `Default`, so its construction at line 368 needs no change.

Add this function directly above `fn install_spring`:

```rust
/// Whether a unit id a script passed is the preview's one unit.
fn is_the_unit(unit: &Value) -> bool {
    let id = f64::from(unitvalue::UNIT_ID);
    match unit {
        Value::Integer(number) => *number as f64 == id,
        Value::Number(number) => *number == id,
        _ => false,
    }
}
```

In `install_spring`, replace the `SetUnitRulesParam` and `GetUnitRulesParam` blocks with:

```rust
    let state = Rc::clone(sim);
    spring.set(
        "SetUnitRulesParam",
        lua.create_function(move |_, (unit, name, value): (Value, String, Value)| {
            // Any other unit does not exist here, and the engine ignores a set
            // on a unit that does not exist.
            if is_the_unit(&unit) {
                state
                    .borrow_mut()
                    .unit_rules
                    .insert(name, RuleValue::of(&value));
            }
            Ok(())
        })?,
    )?;

    let state = Rc::clone(sim);
    spring.set(
        "GetUnitRulesParam",
        lua.create_function(move |lua, (unit, name): (Value, String)| {
            let sim = state.borrow();
            match sim.unit_rules.get(&name) {
                Some(value) if is_the_unit(&unit) => value.to_value(lua),
                _ => Ok(Value::Nil),
            }
        })?,
    )?;

    // The one team's, which is team 0.
    let state = Rc::clone(sim);
    spring.set(
        "SetTeamRulesParam",
        lua.create_function(move |_, (team, name, value): (Option<i64>, String, Value)| {
            if team == Some(0) {
                state
                    .borrow_mut()
                    .team_rules
                    .insert(name, RuleValue::of(&value));
            }
            Ok(())
        })?,
    )?;

    let state = Rc::clone(sim);
    spring.set(
        "GetTeamRulesParam",
        lua.create_function(move |lua, (team, name): (Option<i64>, String)| {
            let sim = state.borrow();
            match sim.team_rules.get(&name) {
                Some(value) if team == Some(0) => value.to_value(lua),
                _ => Ok(Value::Nil),
            }
        })?,
    )?;
```

Directly after the `GetUnitTeam` block, add:

```rust
    spring.set(
        "GetUnitAllyTeam",
        lua.create_function(|_, _: MultiValue| Ok(0))?,
    )?;

    // Only the preview's own unit exists.
    spring.set(
        "ValidUnitID",
        lua.create_function(|_, unit: Value| Ok(is_the_unit(&unit)))?,
    )?;

    // One allyteam holding one team. The engine answers nothing for an
    // allyteam that does not exist.
    spring.set(
        "GetTeamList",
        lua.create_function(|lua, ally: Option<i64>| match ally.unwrap_or(0) {
            0 => Ok(Value::Table(lua.create_sequence_from([0])?)),
            _ => Ok(Value::Nil),
        })?,
    )?;

    // The team's id, which is the first thing the engine answers, or nothing
    // for a team that does not exist.
    spring.set(
        "GetTeamInfo",
        lua.create_function(|_, team: Option<i64>| Ok((team == Some(0)).then_some(0)))?,
    )?;
```

- [ ] **Step 10: Run the crate's tests**

Run: `cargo test -p coilbox-springlua`
Expected: all pass, including the two new tests and the existing rules param test near line 477, which passes `unitID`.

Run: `cargo test -p coilbox-bos2lua -p tauri-plugin-coilbox-anim`
Expected: all pass. No existing fixture uses a shared value or another unit's rules params.

- [ ] **Step 11: Commit**

```bash
cargo fmt --all
git add crates/coilbox-unitpose/src/unitvalue.rs crates/coilbox-springlua/src/unitscript.rs crates/coilbox-springlua/src/unitscript_tests.rs
git commit -m "Answer shared COB unit values and rules params in the Lua preview as the engine does" -m "Spring 102.0 stopped keeping unit values 1024 to 8191. The preview handed a set value back, so a converted script that depends on them played correctly here and read 0 in the game. Rules params now belong to the preview's one unit and team, so a read of another unit's finds nothing, as it does for a unit that does not exist."
```

---

### Task 2: Converted scripts keep shared values as rules params

**Files:**
- Create: `crates/coilbox-bos2lua/src/shared_values.lua`
- Modify: `crates/coilbox-bos2lua/src/emit.rs` (import at line 18, `HELPER_NAMES` at line 840, `helper` at line 1037, `finish` at line 895, `Expr::Get` at line 1153, `StmtKind::Set` at line 2160)
- Create: `crates/coilbox-bos2lua/tests/removed_values.rs`

**Interfaces:**
- Consumes: `coilbox_unitpose::unitvalue::removed_shared(id: i32) -> bool` and the preview stubs from Task 1.
- Produces: Lua locals `cobAllied`, `cobGet(id, ...)` and `cobSet(id, value)` in converted output, reading and writing the rules params named in Global constraints.
- Produces: a warning containing `rules params` for a shared id known when converting, and one containing `while running` for an id only known at runtime.
- Produces: `Writer::unit_value_call(&mut self, id: Option<i64>, engine: &str, shared: &'static str) -> String`. Task 5 edits the same two match arms.
- Produces: `helpers.contains("cobAllied")` is true exactly when the Lua carries `shared_values.lua`. Task 3 relies on it.

- [ ] **Step 1: Write the failing tests**

Create `crates/coilbox-bos2lua/tests/removed_values.rs`:

```rust
//! Unit values the engine no longer keeps. Spring 102.0 stopped keeping the
//! values BOS scripts shared, 1024 to 8191, so the Lua keeps them as rules
//! params. Every conversion here is run, and the preview answers a shared value
//! sent to the engine with 0, as the game does, so only Lua that keeps them
//! itself passes.

use coilbox_bos2lua::{convert, Conversion, Options, MODERN_LINEAR};
use coilbox_springlua::unitscript::{run, ScriptEvent, Unit};
use std::collections::HashMap;

fn convert_bos(source: &str) -> Conversion {
    let includes = HashMap::new();
    convert(
        source,
        &Options {
            name: "scripts/shared.bos",
            includes: &includes,
            pieces: None,
            linear_scale: MODERN_LINEAR,
        },
    )
    .unwrap()
}

fn pieces() -> Vec<String> {
    ["base", "turret"].iter().map(|p| p.to_string()).collect()
}

fn create() -> [ScriptEvent; 1] {
    [ScriptEvent {
        frame: 0,
        callin: "Create".into(),
        args: Vec::new(),
        ambient: true,
    }]
}

/// How far up the y axis `turret` sits a frame after Create, in elmos. Every
/// script here declares `piece base, turret;`, so turret is the second piece.
fn turret_height(lua: &str) -> f64 {
    let pieces = pieces();
    let timeline = run(lua, "shared.lua", &Unit::new(&pieces), &create(), 3);
    assert_eq!(timeline.error, None, "{lua}");
    timeline.frames[1][6 + 1]
}

#[test]
fn a_team_value_that_is_set_reads_back() {
    let conversion = convert_bos(
        "piece base, turret;\n\nCreate()\n{\n\tset 2048 to [2];\n\tmove turret to y-axis get 2048 now;\n}\n",
    );
    let lua = &conversion.lua;
    assert!(lua.contains("cobSet(2048, 131072)"), "{lua}");
    assert!(lua.contains("cobGet(2048)"), "{lua}");
    assert_eq!(turret_height(lua), 2.0);
    assert!(
        conversion.warnings.iter().any(|w| w.contains("rules params")),
        "{:?}",
        conversion.warnings
    );
}

#[test]
fn an_allyteam_value_and_a_game_value_read_back() {
    let lua = convert_bos(
        "piece base, turret;\n\nCreate()\n{\n\tvar total;\n\tset 3072 to [1];\n\tset 4096 to [2];\n\ttotal = (get 3072) + (get 4096);\n\tmove turret to y-axis total now;\n}\n",
    )
    .lua;
    assert_eq!(turret_height(&lua), 3.0);
}

/// A negative first argument sets the value on the unit with that id, and a
/// positive one reads it. The preview's one unit stands in for the other.
#[test]
fn a_unit_value_is_set_and_read_through_a_unit_id() {
    let lua = convert_bos(
        "piece base, turret;\n\nCreate()\n{\n\tvar me;\n\tme = get 71;\n\tget 1025(0 - me, [2]);\n\tmove turret to y-axis get 1025(me) now;\n}\n",
    )
    .lua;
    assert_eq!(turret_height(&lua), 2.0);
}

#[test]
fn a_unit_value_of_a_unit_that_does_not_exist_reads_zero() {
    let lua = convert_bos(
        "piece base, turret;\n\nCreate()\n{\n\tset 1025 to [2];\n\tmove turret to y-axis get 1025(999) now;\n}\n",
    )
    .lua;
    assert_eq!(turret_height(&lua), 0.0);
}

#[test]
fn an_id_only_known_while_running_is_checked_then() {
    let conversion = convert_bos(
        "piece base, turret;\n\nCreate()\n{\n\tvar id;\n\tid = 2048;\n\tset id to [2];\n\tmove turret to y-axis get id now;\n}\n",
    );
    assert!(conversion.lua.contains("cobSet(id, 131072)"), "{}", conversion.lua);
    assert_eq!(turret_height(&conversion.lua), 2.0);
    assert!(
        conversion.warnings.iter().any(|w| w.contains("while running")),
        "{:?}",
        conversion.warnings
    );
}

/// 1032 sits between the unit and team ranges and was never shared, so it
/// still goes to the engine, and a script with no shared value gets no helpers.
#[test]
fn a_value_that_was_never_shared_still_goes_to_the_engine() {
    let conversion = convert_bos(
        "piece base, turret;\n\nCreate()\n{\n\tset 1032 to 1;\n\tmove turret to y-axis get 1032 now;\n}\n",
    );
    let lua = &conversion.lua;
    assert!(lua.contains("SetUnitValue(1032, 1)"), "{lua}");
    assert!(lua.contains("GetUnitValue(1032)"), "{lua}");
    assert!(!lua.contains("cobAllied"), "{lua}");
    assert!(conversion.warnings.is_empty(), "{:?}", conversion.warnings);
}
```

- [ ] **Step 2: Run them to see them fail**

Run: `cargo test -p coilbox-bos2lua --test removed_values`
Expected: `a_value_that_was_never_shared_still_goes_to_the_engine` and `a_unit_value_of_a_unit_that_does_not_exist_reads_zero` pass. The other four fail, either on a missing `cobSet` or `cobGet` in the Lua text or on `left: 0.0, right: 2.0` (or `3.0`), because the preview now answers shared values with 0.

- [ ] **Step 3: Write the Lua the helpers carry**

Create `crates/coilbox-bos2lua/src/shared_values.lua`. It starts with an empty line, as every block `finish` writes does, and the indentation is tabs:

```lua

-- Unit values 1024 to 8191 were numbers BOS scripts shared: 8 per unit, 64 per
-- team, 64 per allyteam and 4096 for the whole game. The engine stopped keeping
-- them in Spring 102.0, so these keep them as rules params, which gadgets and
-- widgets can read too: cobUnitVar<n> on the unit, cobTeamVar<n> on the team,
-- cobAllyVar<n> on every team in the allyteam and cobGlobalVar<n> on the game,
-- with n counted from 0. lualibs/cob_vars.lua reads and writes the same ones
-- through Spring.GetCOBTeamVar, Spring.SetUnitCOBValue and their siblings.
local cobAllied = { allied = true }

-- get, keeping the shared values. A unit value with a positive first argument
-- reads that unit's, and with a negative one sets that unit's to the second.
-- Any other id goes to the engine.
local function cobGet(id, ...)
	if id >= 1024 and id <= 1031 then
		local p1, p2 = ...
		p1 = p1 or 0
		local name = "cobUnitVar" .. (id - 1024)
		if p1 == 0 then
			return Spring.GetUnitRulesParam(unitID, name) or 0
		elseif p1 > 0 then
			return Spring.GetUnitRulesParam(p1, name) or 0
		elseif Spring.ValidUnitID(-p1) then
			Spring.SetUnitRulesParam(-p1, name, p2 or 0, cobAllied)
			return 1
		end
		return 0
	elseif id >= 2048 and id <= 2111 then
		return Spring.GetTeamRulesParam(Spring.GetUnitTeam(unitID), "cobTeamVar" .. (id - 2048)) or 0
	elseif id >= 3072 and id <= 3135 then
		return Spring.GetTeamRulesParam(Spring.GetUnitTeam(unitID), "cobAllyVar" .. (id - 3072)) or 0
	elseif id >= 4096 and id <= 8191 then
		return Spring.GetGameRulesParam("cobGlobalVar" .. (id - 4096)) or 0
	end
	return GetUnitValue(id, ...)
end

-- set, keeping the shared values. Any other id goes to the engine.
local function cobSet(id, value)
	if id >= 1024 and id <= 1031 then
		Spring.SetUnitRulesParam(unitID, "cobUnitVar" .. (id - 1024), value, cobAllied)
	elseif id >= 2048 and id <= 2111 then
		Spring.SetTeamRulesParam(Spring.GetUnitTeam(unitID), "cobTeamVar" .. (id - 2048), value, cobAllied)
	elseif id >= 3072 and id <= 3135 then
		local name = "cobAllyVar" .. (id - 3072)
		for _, team in ipairs(Spring.GetTeamList(Spring.GetUnitAllyTeam(unitID))) do
			Spring.SetTeamRulesParam(team, name, value, cobAllied)
		end
	elseif id >= 4096 and id <= 8191 then
		Spring.SetGameRulesParam("cobGlobalVar" .. (id - 4096), value)
	else
		SetUnitValue(id, value)
	end
end
```

- [ ] **Step 4: Register and emit the helpers**

In `crates/coilbox-bos2lua/src/emit.rs`, change the import on line 18 to:

```rust
use coilbox_unitpose::unitvalue::{self, NAMES as COB_NAMES};
```

Add directly above `struct Writer`:

```rust
/// The Lua that keeps the shared unit values the engine stopped keeping.
const SHARED_VALUES: &str = include_str!("shared_values.lua");
```

Replace `HELPER_NAMES` so BOS names cannot collide with the new locals:

```rust
    const HELPER_NAMES: [&'static str; 9] = [
        "COB_ANGLE",
        "COB_LINEAR",
        "trunc",
        "toCobAngle",
        "div",
        "BosSleep",
        "cobAllied",
        "cobGet",
        "cobSet",
    ];
```

In `helper`, after the `div` block, count all three locals whenever either function is used, because `SHARED_VALUES` declares all three:

```rust
        if name == "cobGet" || name == "cobSet" {
            self.helpers.extend(["cobAllied", "cobGet", "cobSet"]);
        }
```

In `finish`, after the `div` block:

```rust
        if helpers.contains("cobAllied") {
            lua.push_str(SHARED_VALUES);
        }
```

- [ ] **Step 5: Choose the call for each get and set**

Add this method to `impl Writer`, directly after `helper`:

```rust
    /// The function a `get` or `set` goes through: the engine's, or the Lua's
    /// own for the shared values the engine stopped keeping. An id the script
    /// only works out while running goes through the Lua's, which checks it
    /// then and hands anything else to the engine.
    fn unit_value_call(&mut self, id: Option<i64>, engine: &str, shared: &'static str) -> String {
        match id {
            Some(v) if !i32::try_from(v).is_ok_and(unitvalue::removed_shared) => self.header(engine),
            Some(_) => {
                self.warn(
                    "shared",
                    "This script shares unit values between units, which the engine stopped keeping in Spring 102.0. The Lua keeps them as rules params instead. Every script that shares them has to be converted too, because a COB script still reads 0. Gadgets and widgets that set or read them, through Spring.SetUnitCOBValue, Spring.GetCOBTeamVar or their siblings, need lualibs/cob_vars.lua, which the BOS to Lua page offers and a model editor export writes.".to_string(),
                );
                self.helper(shared)
            }
            None => {
                self.warn(
                    "shared-runtime",
                    "A get or set here only learns which unit value it wants while running, so it goes through cobGet or cobSet, which keep the shared values the engine stopped keeping and hand any other value to the engine.".to_string(),
                );
                self.helper(shared)
            }
        }
    }
```

Change the `Expr::Get` arm in `expr`:

```rust
            Expr::Get(id, args) => {
                let id = self.num(id);
                let f = self.unit_value_call(id.value, "GetUnitValue", "cobGet");
                let mut parts = vec![id.text.clone()];
                for a in args {
                    parts.push(self.num(a).text);
                }
                L::atom(format!("{f}({})", parts.join(", ")))
            }
```

Change the `StmtKind::Set` arm:

```rust
            StmtKind::Set(id, value) => {
                let id = self.num(id);
                let f = self.unit_value_call(id.value, "SetUnitValue", "cobSet");
                let v = self.num(value).text;
                self.code(&format!("{f}({}, {v})", id.text), t);
            }
```

- [ ] **Step 6: Run the new tests to see them pass**

Run: `cargo test -p coilbox-bos2lua --test removed_values`
Expected: `test result: ok. 6 passed`

If `a_unit_value_is_set_and_read_through_a_unit_id` fails, print the Lua with `cargo test -p coilbox-bos2lua --test removed_values a_unit_value_is_set -- --nocapture` and check that `get 71` became `GetUnitValue(71)`. The preview answers `MY_ID` (71) with 1 through `unitvalue::known`.

- [ ] **Step 7: Run everything that converts or previews scripts**

Run: `cargo test -p coilbox-bos2lua -p coilbox-springlua -p tauri-plugin-coilbox-anim`
Expected: all pass. `names_unit_values_the_way_the_engine_does` in `tests/convert.rs` still sees `SetUnitValue(COB.INBUILDSTANCE, 1)`, because a named id is known when converting and is not shared.

- [ ] **Step 8: Commit**

```bash
cargo fmt --all
git add crates/coilbox-bos2lua/src/emit.rs crates/coilbox-bos2lua/src/shared_values.lua crates/coilbox-bos2lua/tests/removed_values.rs
git commit -m "Keep shared COB unit values as rules params when converting BOS to Lua" -m "Older games share numbers between units through unit values 1024 to 8191, which the engine stopped keeping in Spring 102.0. Rules params rather than GG, because gadgets' unsynced code and widgets can read rules params and cannot reach GG. A new unit starts with none, so a reused unit ID never reads an old value."
```

---

### Task 3: The polyfill for the game's gadgets and widgets

**Files:**
- Create: `crates/coilbox-bos2lua/src/cob_vars.lua`
- Modify: `crates/coilbox-bos2lua/src/lib.rs` (`Conversion` struct at line 20, new constant after `SCRIPTOR_LINEAR`)
- Modify: `crates/coilbox-bos2lua/src/emit.rs` (`finish`)
- Test: `crates/coilbox-bos2lua/tests/removed_values.rs`

**Interfaces:**
- Consumes: the rules param names from Global constraints, and `helpers.contains("cobAllied")` from Task 2.
- Produces: `pub const COB_VARS_POLYFILL: &str` in `coilbox_bos2lua`, the text of `lualibs/cob_vars.lua`.
- Produces: `pub shared_values: bool` on `Conversion`, true when the Lua carries `shared_values.lua`.
- Produces, in any Lua state that includes the file: `Spring.GetCOBUnitVar(unitID, n [, split])`, `Spring.GetCOBTeamVar(teamID, n [, split])`, `Spring.GetCOBAllyTeamVar(allyTeamID, n [, split])` and `Spring.GetCOBGlobalVar(n [, split])`. Where `Spring.GetUnitCOBValue`, `Spring.SetUnitCOBValue` and `Spring.SetTeamRulesParam` all exist, which is synced LuaRules: wrapped `Spring.GetUnitCOBValue(unitID, [split,] id, p1, p2, ...)` and `Spring.SetUnitCOBValue(unitID, id, value, ...)` that keep shared ids in the rules params and pass every other call to the engine's function unchanged.

- [ ] **Step 1: Write the failing tests**

Change the `use` line at the top of `crates/coilbox-bos2lua/tests/removed_values.rs` to:

```rust
use coilbox_bos2lua::{convert, Conversion, Options, COB_VARS_POLYFILL, MODERN_LINEAR};
```

Append:

```rust
/// A timeline for a Lua script that can include the polyfill as a game does.
fn with_polyfill(lua: &str) -> coilbox_springlua::unitscript::Timeline {
    let pieces = pieces();
    let includes = HashMap::from([(
        "lualibs/cob_vars.lua".to_string(),
        COB_VARS_POLYFILL.to_string(),
    )]);
    let unit = Unit {
        includes: &includes,
        ..Unit::new(&pieces)
    };
    run(lua, "polyfill.lua", &unit, &create(), 3)
}

#[test]
fn a_conversion_says_whether_it_shares_values() {
    let sharing = convert_bos("piece base, turret;\n\nCreate()\n{\n\tset 2048 to 1;\n}\n");
    let not_sharing = convert_bos("piece base, turret;\n\nCreate()\n{\n\tset 1032 to 1;\n}\n");
    assert!(sharing.shared_values);
    assert!(!not_sharing.shared_values);
}

/// The converted Lua and the polyfill are two files that must agree on where
/// each kind of value lives.
#[test]
fn the_converter_and_the_polyfill_use_the_same_names() {
    let lua = convert_bos("piece base, turret;\n\nCreate()\n{\n\tset 2048 to 1;\n}\n").lua;
    for name in ["cobUnitVar", "cobTeamVar", "cobAllyVar", "cobGlobalVar"] {
        assert!(lua.contains(&format!("\"{name}\"")), "{name} in {lua}");
        assert!(COB_VARS_POLYFILL.contains(&format!("\"{name}\"")), "{name}");
    }
}

/// The removed functions read back what a converted script stores. A packed
/// position splits into two signed halves, and a team that does not exist, a
/// unit that does not exist or a slot out of range answers nothing, as the
/// engine's did.
#[test]
fn the_polyfill_reads_what_a_converted_script_stores() {
    let timeline = with_polyfill(
        r#"
local base, turret = piece("base", "turret")
include("lualibs/cob_vars.lua")
function script.Create()
	Spring.SetTeamRulesParam(0, "cobTeamVar3", 2, { allied = true })
	Spring.SetGameRulesParam("cobGlobalVar0", 5 * 65536 + 65529)
	local x, z = Spring.GetCOBGlobalVar(0, true)
	Move(turret, y_axis, Spring.GetCOBTeamVar(0, 3) + Spring.GetCOBAllyTeamVar(0, 9) + Spring.GetCOBUnitVar(unitID, 0))
	Move(turret, x_axis, x)
	Move(turret, z_axis, z)
	if Spring.GetCOBTeamVar(1, 3) == nil and Spring.GetCOBTeamVar(0, 64) == nil and Spring.GetCOBUnitVar(unitID + 1, 0) == nil then
		Move(base, y_axis, 1)
	end
end
"#,
    );
    assert_eq!(timeline.error, None, "{:?}", timeline.warnings);
    let frame = &timeline.frames[1];
    // base's y, then turret's x, y and z.
    assert_eq!([frame[1], frame[6], frame[7], frame[8]], [1.0, 5.0, 2.0, -7.0]);
}

/// THIS sets a perk with `Spring.SetUnitCOBValue(u, 2048 + perk, 1)`. The
/// wrapped functions keep a shared id in the rules params, so a converted
/// script and `GetCOBTeamVar` both see it, and hand anything else, such as
/// the heading `unit_turn.lua` sets, to the engine's function. The script
/// stands in for the engine's two functions, counting the calls that reach
/// them, because the preview has neither.
#[test]
fn the_polyfill_keeps_shared_ids_set_through_unit_cob_values() {
    let timeline = with_polyfill(
        r#"
local base, turret = piece("base", "turret")
local reached = 0
Spring.GetUnitCOBValue = function(unitID, id) reached = reached + 1 return 7 end
Spring.SetUnitCOBValue = function(unitID, id, value) reached = reached + 1 end
include("lualibs/cob_vars.lua")
function script.Create()
	Spring.SetUnitCOBValue(unitID, 2049, 1)
	Spring.SetUnitCOBValue(unitID, 82, 5)
	local heading = Spring.GetUnitCOBValue(unitID, 82)
	Spring.SetUnitCOBValue(unitID, 4096, 5 * 65536 + 65529)
	local x, z = Spring.GetUnitCOBValue(unitID, true, 4096)
	Spring.GetUnitCOBValue(unitID, 1025, -unitID, 3)
	Move(turret, y_axis, Spring.GetUnitCOBValue(unitID, 2049) + Spring.GetCOBTeamVar(0, 1) + Spring.GetUnitCOBValue(unitID, 1025))
	Move(turret, x_axis, x)
	Move(turret, z_axis, z)
	Move(base, y_axis, reached + heading)
end
"#,
    );
    assert_eq!(timeline.error, None, "{:?}", timeline.warnings);
    let frame = &timeline.frames[1];
    // turret: the perk read two ways plus the unit value set through a unit
    // id, then the split position. base: the two calls with id 82 reached the
    // engine's functions, and the heading they answered is 7.
    assert_eq!([frame[7], frame[6], frame[8], frame[1]], [5.0, 5.0, -7.0, 9.0]);
}
```

- [ ] **Step 2: Run them to see them fail**

Run: `cargo test -p coilbox-bos2lua --test removed_values`
Expected: compile errors, `no COB_VARS_POLYFILL in the root` and `no field shared_values`.

- [ ] **Step 3: Write the polyfill**

Create `crates/coilbox-bos2lua/src/cob_vars.lua`, indented with tabs:

```lua
-- lualibs/cob_vars.lua, written by coilbox.
--
-- Unit scripts coilbox converted from BOS keep the unit values BOS scripts
-- shared, 1024 to 8191, as rules params, because the engine stopped keeping
-- them in Spring 102.0. This file lets a game's gadgets and widgets reach the
-- same values the old way. It brings back Spring.GetCOBUnitVar, GetCOBTeamVar,
-- GetCOBAllyTeamVar and GetCOBGlobalVar, which 102.0 removed. In synced
-- LuaRules it also makes Spring.GetUnitCOBValue and SetUnitCOBValue keep the
-- shared values, which the engine answers with 0 and ignores.
--
-- Include it on the first line of LuaRules/main.lua, LuaRules/draw.lua and
-- luaui.lua (or LuaUI/main.lua), so it runs before any gadget or widget copies
-- a Spring function into a local:
--
--   VFS.Include("lualibs/cob_vars.lua")
--
-- One difference from the engine's: a value the reader may not see, such as an
-- enemy team's, reads 0 where the engine answered nothing.

if Spring.GetCOBTeamVar then
	return
end

local GetUnitRulesParam = Spring.GetUnitRulesParam
local GetTeamRulesParam = Spring.GetTeamRulesParam
local GetGameRulesParam = Spring.GetGameRulesParam
local GetTeamInfo = Spring.GetTeamInfo
local GetTeamList = Spring.GetTeamList
local GetUnitTeam = Spring.GetUnitTeam
local GetUnitAllyTeam = Spring.GetUnitAllyTeam
local ValidUnitID = Spring.ValidUnitID
local floor = math.floor

local function signed16(value)
	return (value + 32768) % 65536 - 32768
end

-- The value, or its two halves when asked to split it. The engine packed a map
-- position into one value as x * 65536 + z.
local function answer(value, split)
	value = value or 0
	if split then
		return signed16(floor(value / 65536)), signed16(value % 65536)
	end
	return value
end

local function inRange(n, count)
	return type(n) == "number" and n >= 0 and n < count
end

function Spring.GetCOBUnitVar(unitID, n, split)
	if not ValidUnitID(unitID) or not inRange(n, 8) then
		return
	end
	return answer(GetUnitRulesParam(unitID, "cobUnitVar" .. n), split)
end

function Spring.GetCOBTeamVar(teamID, n, split)
	if GetTeamInfo(teamID) == nil or not inRange(n, 64) then
		return
	end
	return answer(GetTeamRulesParam(teamID, "cobTeamVar" .. n), split)
end

-- Every team in an allyteam holds the same copy, so the first one answers.
function Spring.GetCOBAllyTeamVar(allyTeamID, n, split)
	local teams = GetTeamList(allyTeamID)
	if teams == nil or not inRange(n, 64) then
		return
	end
	return answer(teams[1] and GetTeamRulesParam(teams[1], "cobAllyVar" .. n), split)
end

function Spring.GetCOBGlobalVar(n, split)
	if not inRange(n, 4096) then
		return
	end
	return answer(GetGameRulesParam("cobGlobalVar" .. n), split)
end

local GetUnitCOBValue = Spring.GetUnitCOBValue
local SetUnitCOBValue = Spring.SetUnitCOBValue
local SetUnitRulesParam = Spring.SetUnitRulesParam
local SetTeamRulesParam = Spring.SetTeamRulesParam
local SetGameRulesParam = Spring.SetGameRulesParam

-- Only synced LuaRules has both the unit value functions and the setters.
if not (GetUnitCOBValue and SetUnitCOBValue and SetTeamRulesParam) then
	return
end

local allied = { allied = true }

-- Which kind of shared value an id is, and the rules param it lives in, or
-- nil for any other id.
local function shared(id)
	if type(id) ~= "number" then
		return nil
	elseif id >= 1024 and id <= 1031 then
		return "unit", "cobUnitVar" .. (id - 1024)
	elseif id >= 2048 and id <= 2111 then
		return "team", "cobTeamVar" .. (id - 2048)
	elseif id >= 3072 and id <= 3135 then
		return "ally", "cobAllyVar" .. (id - 3072)
	elseif id >= 4096 and id <= 8191 then
		return "game", "cobGlobalVar" .. (id - 4096)
	end
	return nil
end

function Spring.SetUnitCOBValue(unitID, id, value, ...)
	local kind, name = shared(id)
	if kind == nil or not ValidUnitID(unitID) then
		return SetUnitCOBValue(unitID, id, value, ...)
	end
	if kind == "unit" then
		SetUnitRulesParam(unitID, name, value, allied)
	elseif kind == "team" then
		SetTeamRulesParam(GetUnitTeam(unitID), name, value, allied)
	elseif kind == "ally" then
		for _, team in ipairs(GetTeamList(GetUnitAllyTeam(unitID))) do
			SetTeamRulesParam(team, name, value, allied)
		end
	else
		SetGameRulesParam(name, value)
	end
end

-- The engine's takes an optional split flag before the id. A unit value with a
-- positive first argument reads that unit's, and with a negative one sets that
-- unit's to the second, as a BOS get did.
function Spring.GetUnitCOBValue(unitID, ...)
	local split, id, p1, p2 = ...
	if type(split) ~= "boolean" then
		split, id, p1, p2 = false, ...
	end
	local kind, name = shared(id)
	if kind == nil or not ValidUnitID(unitID) then
		return GetUnitCOBValue(unitID, ...)
	end
	local value
	if kind == "unit" then
		p1 = p1 or 0
		if p1 >= 0 then
			value = GetUnitRulesParam(p1 == 0 and unitID or p1, name)
		elseif ValidUnitID(-p1) then
			SetUnitRulesParam(-p1, name, p2 or 0, allied)
			value = 1
		end
	elseif kind == "game" then
		value = GetGameRulesParam(name)
	else
		value = GetTeamRulesParam(GetUnitTeam(unitID), name)
	end
	return answer(value, split)
end
```

- [ ] **Step 4: Export it and report sharing**

In `crates/coilbox-bos2lua/src/lib.rs`, add a field to `Conversion`, after `warnings`:

```rust
    /// Whether the Lua keeps shared unit values as rules params. A game running
    /// it also wants [`COB_VARS_POLYFILL`] if its gadgets or widgets set or
    /// read them.
    pub shared_values: bool,
```

Add after `SCRIPTOR_LINEAR`:

```rust
/// `lualibs/cob_vars.lua`, which lets a game's gadgets and widgets set and
/// read the shared unit values a converted script keeps as rules params. A
/// game includes it from its own `LuaRules/main.lua`, `LuaRules/draw.lua` and
/// `luaui.lua`.
pub const COB_VARS_POLYFILL: &str = include_str!("cob_vars.lua");
```

In `finish` in `crates/coilbox-bos2lua/src/emit.rs`, change the construction at the end to:

```rust
        Conversion {
            lua,
            warnings: self.warnings,
            shared_values: self.helpers.contains("cobAllied"),
        }
```

- [ ] **Step 5: Run the tests to see them pass**

Run: `cargo test -p coilbox-bos2lua`
Expected: all pass, including the four new tests.

If a polyfill test reports `timeline.error`, read `timeline.warnings` in the failure output. An `include(...) read nothing` note means the include key did not match. A nil call names the missing preview stub.

- [ ] **Step 6: Commit**

```bash
cargo fmt --all
git add crates/coilbox-bos2lua/src/cob_vars.lua crates/coilbox-bos2lua/src/lib.rs crates/coilbox-bos2lua/src/emit.rs crates/coilbox-bos2lua/tests/removed_values.rs
git commit -m "Add a polyfill for setting and reading shared COB values from gadgets and widgets" -m "Older games set shared values with Spring.SetUnitCOBValue and read them with the Spring.GetCOB*Var functions 102.0 removed. The polyfill uses the rules params converted scripts keep them in, and the game includes it from its own entry files, so basecontent stays untouched."
```

---

### Task 4: The BOS to Lua page offers the polyfill

**Files:**
- Modify: `crates/tauri-plugin-coilbox-anim/src/lib.rs` (the `CliResult::ok(json!({ ... }))` in `anim_bos2lua`, around line 192)
- Modify: `src/animation/bindings.ts` (`animBos2lua` at line 72)
- Modify: `src/animation/pages/Bos2LuaPage.tsx`

**Interfaces:**
- Consumes: `Conversion::shared_values` and `coilbox_bos2lua::COB_VARS_POLYFILL` from Task 3.
- Produces: `anim_bos2lua` returns `cobVars: string | null`, the polyfill text when the conversion shares values.

- [ ] **Step 1: Return the polyfill with the conversion**

In `anim_bos2lua` in `crates/tauri-plugin-coilbox-anim/src/lib.rs`, change the success arm to:

```rust
        Ok(Ok((conversion, linear_scale))) => CliResult::ok(json!({
            "lua": conversion.lua,
            "warnings": conversion.warnings,
            "linearScale": linear_scale,
            "cobVars": conversion
                .shared_values
                .then_some(coilbox_bos2lua::COB_VARS_POLYFILL),
        })),
```

- [ ] **Step 2: Type it in the binding**

In `src/animation/bindings.ts`, change the result type of `animBos2lua` to:

```ts
  { lua: string; warnings: string[]; linearScale: number; cobVars: string | null }
```

- [ ] **Step 3: Show it on the page**

In `src/animation/pages/Bos2LuaPage.tsx`, change `Converted` and `EMPTY` to:

```tsx
interface Converted {
  lua: string;
  warnings: string[];
  cobVars: string | null;
  error: string | null;
}

const EMPTY: Converted = { lua: "", warnings: [], cobVars: null, error: null };
```

Change the `.then` in the effect to:

```tsx
      .then(({ lua, warnings, cobVars }) => {
        if (ticket === latest.current)
          setConverted({ lua, warnings, cobVars, error: null });
      })
```

Replace the `copied` state and `copyLua` with one copy function for both buttons:

```tsx
  const [copied, setCopied] = useState<"lua" | "cobVars" | null>(null);
```

```tsx
  async function copy(text: string, which: "lua" | "cobVars") {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(which);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      // The clipboard may be unavailable, and the textarea stays selectable.
    }
  }
```

Change the header's copy button to:

```tsx
            <Button
              size="sm"
              onClick={() => void copy(converted.lua, "lua")}
              disabled={!converted.lua}
            >
              {copied === "lua" ? <Check /> : <Copy />}{" "}
              {copied === "lua" ? "Copied" : "Copy Lua"}
            </Button>
```

Add directly after the warnings list, inside the same column:

```tsx
          {converted.cobVars && (
            <section
              aria-labelledby="cob-vars-heading"
              className="flex flex-col gap-2 rounded-md border border-border p-3 text-xs"
            >
              <div className="flex items-center justify-between gap-2">
                <h2 id="cob-vars-heading" className="text-sm font-medium">
                  Add <code>lualibs/cob_vars.lua</code> to the game
                </h2>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void copy(converted.cobVars ?? "", "cobVars")}
                >
                  {copied === "cobVars" ? <Check /> : <Copy />}{" "}
                  {copied === "cobVars" ? "Copied" : "Copy file"}
                </Button>
              </div>
              <p className="text-muted-foreground">
                This script shares values with other units, and keeps them as
                rules params. The file lets the game's gadgets and widgets set
                and read them through <code>Spring.SetUnitCOBValue</code>,{" "}
                <code>Spring.GetCOBTeamVar</code> and their siblings. Put{" "}
                <code>VFS.Include("lualibs/cob_vars.lua")</code> on the first
                line of <code>LuaRules/main.lua</code>,{" "}
                <code>LuaRules/draw.lua</code> and <code>luaui.lua</code>.
              </p>
            </section>
          )}
```

- [ ] **Step 4: Check it compiles and lints**

Run: `bun run typecheck`
Expected: exits 0.

Run: `bunx biome ci .`
Expected: exits 0. If it reports formatting only, run `bunx biome format --write src/animation` and rerun `bunx biome ci .`.

Run: `cargo clippy -p tauri-plugin-coilbox-anim --all-targets -- -D warnings`
Expected: exits 0.

- [ ] **Step 5: Commit**

```bash
git add crates/tauri-plugin-coilbox-anim/src/lib.rs src/animation/bindings.ts src/animation/pages/Bos2LuaPage.tsx
git commit -m "Offer the COB vars polyfill on the BOS to Lua page when a script shares values"
```

---

### Task 5: Warn on CURRENT_FUEL and ALPHA_THRESHOLD

**Files:**
- Modify: `crates/coilbox-bos2lua/src/emit.rs` (new method beside `unit_value_call`, the `Expr::Get` and `StmtKind::Set` arms)
- Test: `crates/coilbox-bos2lua/tests/removed_values.rs`

**Interfaces:**
- Consumes: `Writer::unit_value_call` and the two match arms as Task 2 left them.
- Produces: `Writer::removed_value(&mut self, id: Option<i64>)`. Warnings containing `CURRENT_FUEL` and `ALPHA_THRESHOLD`, and a trailing note on the Lua line that uses either.

- [ ] **Step 1: Write the failing test**

Append to `crates/coilbox-bos2lua/tests/removed_values.rs`:

```rust
/// Neither can be brought back. The engine call stays, so the Lua does what the
/// COB does today, and the porter is told why the unit behaves differently.
#[test]
fn fuel_and_the_alpha_threshold_are_said_to_be_gone() {
    let conversion = convert_bos(
        "piece base, turret;\n\nCreate()\n{\n\tset 103 to 5;\n\tmove turret to y-axis get 93 now;\n}\n",
    );
    let lua = &conversion.lua;
    assert!(lua.contains("SetUnitValue(103, 5)"), "{lua}");
    assert!(lua.contains("ALPHA_THRESHOLD was removed in Spring 99.0"), "{lua}");
    assert!(lua.contains("CURRENT_FUEL has done nothing since Spring 101.0"), "{lua}");
    for name in ["CURRENT_FUEL", "ALPHA_THRESHOLD"] {
        assert!(
            conversion.warnings.iter().any(|w| w.contains(name)),
            "{name} in {:?}",
            conversion.warnings
        );
    }
    assert_eq!(turret_height(lua), 0.0);
}
```

- [ ] **Step 2: Run it to see it fail**

Run: `cargo test -p coilbox-bos2lua --test removed_values fuel_and_the_alpha_threshold`
Expected: FAIL on the `ALPHA_THRESHOLD was removed in Spring 99.0` assertion.

- [ ] **Step 3: Add the warning**

Add to `impl Writer`, directly after `unit_value_call`:

```rust
    /// Unit values the engine dropped with nothing to stand in for them. The
    /// call stays as the BOS wrote it, and the line and the warnings say why
    /// it does nothing.
    fn removed_value(&mut self, id: Option<i64>) {
        let (name, note, message) = match id {
            Some(93) => (
                "CURRENT_FUEL",
                "CURRENT_FUEL has done nothing since Spring 101.0 removed fuel",
                "CURRENT_FUEL has done nothing since Spring 101.0 removed fuel. It reads 0 and a set is ignored, with no error in the log.",
            ),
            Some(103) => (
                "ALPHA_THRESHOLD",
                "ALPHA_THRESHOLD was removed in Spring 99.0",
                "ALPHA_THRESHOLD was removed in Spring 99.0. It reads 0, a set is ignored, and the engine logs an unknown constant error for each.",
            ),
            _ => return,
        };
        self.warn(&format!("removed:{name}"), message.to_string());
        self.note = Some(note.to_string());
    }
```

Call it in both the `Expr::Get` and `StmtKind::Set` arms, straight after `let id = self.num(id);`:

```rust
                self.removed_value(id.value);
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `cargo test -p coilbox-bos2lua`
Expected: all pass, including `fuel_and_the_alpha_threshold_are_said_to_be_gone`.

- [ ] **Step 5: Commit**

```bash
cargo fmt --all
git add crates/coilbox-bos2lua/src/emit.rs crates/coilbox-bos2lua/tests/removed_values.rs
git commit -m "Say when a converted script uses CURRENT_FUEL or ALPHA_THRESHOLD" -m "The engine dropped both with nothing to replace them. CURRENT_FUEL fails silently, so without a warning a porter has no way to find it."
```

---

### Task 6: The model editor

The model editor imports a game's unit, plays a `.cob` with the COB runtime (`src/lego/pages/components/AnimationPanel.tsx:202`) and Lua with the preview runtime, converts a `.bos` through `anim_bos2lua` (`src/lego/adoptGameScript.ts:172`), and exports the Lua (`lego_export` in `crates/tauri-plugin-coilbox-lego/src/lib.rs`). Tasks 1-3 already reach its Lua path. This task covers the two gaps: the COB runtime says nothing about shared values, and an export never writes the polyfill.

**Files:**
- Modify: `crates/coilbox-bos2lua/src/lib.rs` (new function beside `COB_VARS_POLYFILL`)
- Test: `crates/coilbox-bos2lua/tests/removed_values.rs`
- Modify: `crates/tauri-plugin-coilbox-anim/src/cobrun.rs` (`unit_value` near line 1030, the `SET` arm near line 845)
- Test: `crates/tauri-plugin-coilbox-anim/src/cobrun_tests.rs`
- Modify: `crates/tauri-plugin-coilbox-lego/Cargo.toml`, `crates/tauri-plugin-coilbox-lego/src/lib.rs` (`lego_export` from line 1950, its tests in `mod tests` from line 2868)
- Modify: `src/lego/bindings.ts` (the `legoExport` result type near line 140), `src/lego/pages/components/ExportDrawer.tsx` (`Result` type at line 110, the result list near line 1001)
- Test: `src/lego/pages/components/ExportDrawer.dom.test.tsx`

**Interfaces:**
- Consumes: `coilbox_bos2lua::COB_VARS_POLYFILL` and the line `local cobAllied = { allied = true }` in `shared_values.lua`, from Tasks 2 and 3. `coilbox_unitpose::unitvalue::removed_shared` from Task 1.
- Produces: `pub fn shares_values(lua: &str) -> bool` in `coilbox_bos2lua`, true when the Lua carries `shared_values.lua`. It reads the script's text, so it still answers for a script the user edited and saved.
- Produces: `fn write_cob_vars(root: &Path, scratch: bool, script: Option<&str>) -> Result<(Option<String>, bool), String>` in the lego plugin. `lego_export` answers two more fields, `cobVars: string | null` (the path written) and `cobVarsKept: boolean` (a file was already there and was left alone).

- [ ] **Step 1: Write the failing converter test**

Change the `use` line of `crates/coilbox-bos2lua/tests/removed_values.rs` to add `shares_values`:

```rust
use coilbox_bos2lua::{convert, shares_values, Conversion, Options, COB_VARS_POLYFILL, MODERN_LINEAR};
```

Append:

```rust
/// A model editor export only has the script's text, which the user may have
/// edited since it was converted, so whether it shares values is read from it.
#[test]
fn the_text_says_whether_a_script_shares_values() {
    let sharing = convert_bos("piece base, turret;\n\nCreate()\n{\n\tset 2048 to 1;\n}\n");
    let not_sharing = convert_bos("piece base, turret;\n\nCreate()\n{\n\tset 1032 to 1;\n}\n");
    assert!(shares_values(&sharing.lua));
    assert!(!shares_values(&not_sharing.lua));
}
```

- [ ] **Step 2: Write the failing COB runtime test**

Append inside the test module of `crates/tauri-plugin-coilbox-anim/src/cobrun_tests.rs`, after `says_when_a_script_asks_about_the_world`:

```rust
    /// The engine stopped keeping shared values in Spring 102.0. The preview
    /// still keeps what a script stores, so a `.cob` and its converted Lua play
    /// the same, but says the game will not, rather than calling a shared value
    /// a question about the world.
    #[test]
    fn says_the_engine_no_longer_keeps_shared_values() {
        let mut code = push(2049);
        code.extend(push(1));
        code.push(op("SET"));
        code.extend(push(2050));
        code.push(op("GET_UNIT_VALUE"));
        code.push(op("POP_STACK"));
        code.push(op("RETURN"));

        let timeline = play(&create_only(code), 2);

        let shared: Vec<_> = timeline
            .warnings
            .iter()
            .filter(|note| note.contains("no longer keeps shared values"))
            .collect();
        assert_eq!(shared.len(), 2, "{:?}", timeline.warnings);
        assert!(
            !timeline.warnings.iter().any(|note| note.contains("the world")),
            "{:?}",
            timeline.warnings
        );
    }
```

- [ ] **Step 3: Run both to see them fail**

Run: `cargo test -p coilbox-bos2lua --test removed_values the_text_says`
Expected: compile error, `no shares_values in the root`.

Run: `cargo test -p tauri-plugin-coilbox-anim says_the_engine_no_longer_keeps`
Expected: FAIL on `left: 0, right: 2`.

- [ ] **Step 4: Add `shares_values`**

In `crates/coilbox-bos2lua/src/lib.rs`, directly after `COB_VARS_POLYFILL`:

```rust
/// Whether a Lua unit script keeps shared unit values the way a conversion
/// writes them, read from its text so a script edited after converting still
/// answers.
pub fn shares_values(lua: &str) -> bool {
    lua.contains("local cobAllied = { allied = true }")
}
```

- [ ] **Step 5: Note shared values in the COB runtime**

In `crates/tauri-plugin-coilbox-anim/src/cobrun.rs`, in the `SET` arm, make the `else` branch:

```rust
                } else {
                    if unitvalue::removed_shared(id) {
                        self.model.note(format!(
                            "This script sets shared value {id}, which the preview keeps, but the engine no longer keeps shared values, so the game ignores it unless the script is converted to Lua."
                        ));
                    }
                    // Kept rather than dropped, so a script that stores its own
                    // state in a unit value reads back what it wrote.
                    self.set_values.insert(id, value);
                }
```

In `unit_value`, directly after the `unitvalue::arithmetic` check:

```rust
        if unitvalue::removed_shared(id) {
            self.model.note(format!(
                "This script asks for shared value {id}, and the engine no longer keeps shared values, so it reads 0 in the game unless the script is converted to Lua."
            ));
            return self.set_values.get(&id).copied().unwrap_or(0);
        }
```

- [ ] **Step 6: Run both to see them pass**

Run: `cargo test -p coilbox-bos2lua --test removed_values`
Expected: all pass.

Run: `cargo test -p tauri-plugin-coilbox-anim`
Expected: all pass, including the parity test in `bos2lua_parity.rs`.

- [ ] **Step 7: Commit**

```bash
cargo fmt --all
git add crates/coilbox-bos2lua/src/lib.rs crates/coilbox-bos2lua/tests/removed_values.rs crates/tauri-plugin-coilbox-anim/src/cobrun.rs crates/tauri-plugin-coilbox-anim/src/cobrun_tests.rs
git commit -m "Say in the COB preview when a script uses a shared unit value" -m "The model editor plays a game's .cob with this runtime. It keeps what a script stores so a .cob and its converted Lua still play alike, but the game reads 0, and the note now says so instead of calling it a question about the world."
```

- [ ] **Step 8: Write the failing export test**

In `crates/tauri-plugin-coilbox-lego/Cargo.toml`, after the `coilbox-springlua` line:

```toml
# The polyfill an export writes beside a converted script that keeps the
# shared COB unit values the engine stopped keeping.
coilbox-bos2lua = { path = "../coilbox-bos2lua" }
```

Add to `mod tests` in `crates/tauri-plugin-coilbox-lego/src/lib.rs`:

```rust
    /// The polyfill is one file every sharing unit in the game uses, so it is
    /// written once and left alone like the script, refreshed in the scratch
    /// game, and never written for a script that shares nothing.
    #[test]
    fn writes_the_cob_vars_polyfill_only_beside_a_script_that_shares_values() {
        let dir = tempfile::tempdir().expect("tempdir");
        let sharing = "local cobAllied = { allied = true }\n";
        let target = dir.path().join("lualibs/cob_vars.lua");

        assert_eq!(
            write_cob_vars(dir.path(), false, Some("-- shares nothing")).expect("write"),
            (None, false)
        );
        assert_eq!(write_cob_vars(dir.path(), false, None).expect("write"), (None, false));
        assert!(!target.exists());

        let (written, kept) = write_cob_vars(dir.path(), false, Some(sharing)).expect("write");
        assert_eq!(written, Some(target.to_string_lossy().to_string()));
        assert!(!kept);
        assert_eq!(
            std::fs::read_to_string(&target).expect("read"),
            coilbox_bos2lua::COB_VARS_POLYFILL
        );

        std::fs::write(&target, "-- the game's own").expect("write");
        assert_eq!(
            write_cob_vars(dir.path(), false, Some(sharing)).expect("write"),
            (None, true)
        );
        assert_eq!(std::fs::read_to_string(&target).expect("read"), "-- the game's own");

        let (written, kept) = write_cob_vars(dir.path(), true, Some(sharing)).expect("write");
        assert!(written.is_some() && !kept);
        assert_eq!(
            std::fs::read_to_string(&target).expect("read"),
            coilbox_bos2lua::COB_VARS_POLYFILL
        );
    }
```

- [ ] **Step 9: Run it to see it fail**

Run: `cargo test -p tauri-plugin-coilbox-lego writes_the_cob_vars_polyfill`
Expected: compile error, `cannot find function write_cob_vars`.

- [ ] **Step 10: Write the polyfill on export**

In `crates/tauri-plugin-coilbox-lego/src/lib.rs`, add directly above `lego_export`'s doc comment:

```rust
/// Where an export writes the polyfill for shared COB unit values.
const COB_VARS: &[&str] = &["lualibs", "cob_vars.lua"];

/// `lualibs/cob_vars.lua`, beside a script that keeps the shared COB unit
/// values the engine stopped keeping, so the game's gadgets and widgets can
/// set and read them too.
///
/// Every sharing unit in the game uses the one file, so it is not any unit's:
/// it is never in the receipt a rename reads, and it follows the script's rule,
/// written once and left alone in a real game folder and refreshed in the
/// scratch game. Answers the path written, and whether a file already there
/// was left alone.
fn write_cob_vars(
    root: &Path,
    scratch: bool,
    script: Option<&str>,
) -> Result<(Option<String>, bool), String> {
    if !script.is_some_and(coilbox_bos2lua::shares_values) {
        return Ok((None, false));
    }
    let target = COB_VARS.iter().fold(root.to_path_buf(), |path, part| path.join(part));
    if keep_existing(&target, scratch, false) {
        return Ok((None, true));
    }
    let dir = root.join(COB_VARS[0]);
    std::fs::create_dir_all(&dir).map_err(|e| format!("could not create {}: {e}", dir.display()))?;
    std::fs::write(&target, coilbox_bos2lua::COB_VARS_POLYFILL)
        .map_err(|e| format!("could not write {}: {e}", target.display()))?;
    Ok((Some(target.to_string_lossy().to_string()), false))
}
```

In `lego_export`, directly before the `// The unit script is written once and then left alone.` comment, because the script block below moves `script`:

```rust
    let (cob_vars_path, cob_vars_kept) = match write_cob_vars(&root, scratch, script.as_deref()) {
        Ok(written) => written,
        Err(e) => return CliResult::err(e),
    };
```

Add to the `CliResult::ok(json!({ ... }))` at the end of `lego_export`, after `"scriptKept"`:

```rust
        "cobVars": cob_vars_path,
        "cobVarsKept": cob_vars_kept,
```

- [ ] **Step 11: Run it to see it pass**

Run: `cargo test -p tauri-plugin-coilbox-lego`
Expected: all pass, including `writes_the_cob_vars_polyfill_only_beside_a_script_that_shares_values` and the three rename receipt tests, which must still count seven files.

- [ ] **Step 12: Say it in the export drawer**

In `src/lego/bindings.ts`, add to the `legoExport` result type, after `scriptKept`:

```ts
    /**
     * `lualibs/cob_vars.lua`, written because the script keeps shared COB unit
     * values. Null when the script shares none or a file was already there.
     */
    cobVars: string | null;
    /** True when `lualibs/cob_vars.lua` was already there and was left alone. */
    cobVarsKept: boolean;
```

In `src/lego/pages/components/ExportDrawer.tsx`, add the same two fields to the `done` arm of `Result`, after `scriptKept: boolean;`:

```tsx
      cobVars: string | null;
      cobVarsKept: boolean;
```

`setResult` spreads `...exported`, so the values arrive without further change. In the result list, directly after the `result.scriptKept` paragraph:

```tsx
                {result.cobVars ? (
                  <code className="break-all">{result.cobVars}</code>
                ) : null}
                {result.cobVars || result.cobVarsKept ? (
                  <p className="text-muted-foreground">
                    {result.cobVarsKept
                      ? "lualibs/cob_vars.lua was already there and has been left alone. "
                      : null}
                    This unit's script keeps shared COB unit values as rules
                    params. For the game's gadgets and widgets to set and read
                    them, put{" "}
                    <code>VFS.Include("lualibs/cob_vars.lua")</code> on the
                    first line of <code>LuaRules/main.lua</code>,{" "}
                    <code>LuaRules/draw.lua</code> and <code>luaui.lua</code>.
                  </p>
                ) : null}
```

- [ ] **Step 13: Cover the drawer**

Read `src/lego/pages/components/ExportDrawer.dom.test.tsx` and find how it mocks `legoExport` and asserts on the result list after an export. Add `cobVars: null` and `cobVarsKept: false` to every mocked export result so they match the new type. Then add one test, copied from the nearest existing test that exports and reads the result list, whose mocked result has `cobVars: "/game/lualibs/cob_vars.lua"`. It asserts that the path and the text `VFS.Include("lualibs/cob_vars.lua")` are shown. Add a second assertion to an existing export test with `cobVars: null` and `cobVarsKept: false` that the include text is not shown.

Run: `bun run test src/lego/pages/components/ExportDrawer.dom.test.tsx`
Expected: all pass.

Run: `bun run typecheck` and `bunx biome ci .`
Expected: both exit 0. If biome reports formatting only, run `bunx biome format --write src/lego` and rerun `bunx biome ci .`.

- [ ] **Step 14: Commit**

```bash
cargo fmt --all
git add crates/tauri-plugin-coilbox-lego/Cargo.toml Cargo.lock crates/tauri-plugin-coilbox-lego/src/lib.rs src/lego/bindings.ts src/lego/pages/components/ExportDrawer.tsx src/lego/pages/components/ExportDrawer.dom.test.tsx
git commit -m "Write the COB vars polyfill when the model editor exports a script that shares values" -m "An exported converted script keeps its own shared values, but a game's gadgets and widgets only reach them through lualibs/cob_vars.lua. The export writes it once, beside the script, and the drawer says which line to add. It is shared by every such unit, so the rename receipt never claims it."
```

---

### Task 7: Verify the whole change

**Files:** none in the repo changed unless a check fails.

- [ ] **Step 1: Run the full CI suite**

Run each and confirm it passes:

```bash
bunx biome ci .
bun run typecheck
bun run test
scripts/mission-tests.sh
cargo fmt --all --check
cargo clippy --all-targets -- -D warnings
cargo test --workspace
```

Expected: every command exits 0. If clippy's Tauri crate fails on a missing sidecar, run `bun run sidecar:unitsync` and retry. That is a build input, not a failure in this change.

- [ ] **Step 2: See it in the app**

1. Run `bun tauri dev` and open the BOS to Lua page, under Animation.
2. Load `~/.spring/games/THIS.sdd/scripts/sword.bos`. Its includes are not beside a loaded file, so `PERK_*` will be listed as missing. Paste `#define PERK_BETTER_KINETICS 2049` and `#define PERK_MORE_GUNS 2050` at the top of the BOS text.
3. Confirm the Lua carries the `cobAllied` block, uses `cobGet(PERK_MORE_GUNS)` or `cobGet(2050)`, the warnings mention rules params, and an "Add lualibs/cob_vars.lua to the game" section appears.
4. Click Copy file, paste into a text editor and confirm it is the polyfill.
5. Paste the BOS from `a_value_that_was_never_shared_still_goes_to_the_engine`. Confirm the section disappears.
6. Paste the BOS from `fuel_and_the_alpha_threshold_are_said_to_be_gone`. Confirm both removal warnings show.
7. In the model editor, import a THIS unit that ships a `.cob` and a `.bos`, such as `sword`. Confirm the import notes include the rules params warning, and that playing the compiled script notes that the engine no longer keeps shared values.
8. Export that unit with its converted script into a scratch folder. Confirm `lualibs/cob_vars.lua` is written and the drawer shows the `VFS.Include` line.

- [ ] **Step 3: Port a copy of THIS and play it**

The preview has one unit and no gadgets or widgets, so it cannot show perks reaching units or the polyfill running in three Lua states. This step can. Work on a copy, never on `~/.spring/games/THIS.sdd`.

1. `cp -R ~/.spring/games/THIS.sdd ~/.spring/games/THIS-lua.sdd`, then change `name='THIS'` in the copy's `modinfo.lua` to `name='THIS Lua'`, so the two archives do not clash.
2. Convert all 29 scripts in the copy's `scripts/` that have a `.bos` and no `.lua`, with their includes, using `cargo run -p coilbox-bos2lua --example convert` (read `crates/coilbox-bos2lua/examples/convert.rs` for its arguments). Save each `.lua` beside its `.bos`. Leave `minelayer.bos` alone, because `units/minelayer.fbi` already names `minelayer.lua`.
3. In each file under the copy's `units/` whose `script` names one of those scripts, point `script` at the `.lua`.
4. Save the polyfill as `lualibs/cob_vars.lua` in the copy. Add `VFS.Include("lualibs/cob_vars.lua")` as the first line of `LuaRules/main.lua`, `LuaRules/draw.lua` and `luaui.lua`, above the existing `VFS.Include("LuaGadgets/gadgets.lua",nil, VFS.BASE)` in the first two.
5. Fix `LuaRules/Gadgets/perks.locals.lua`, which the converter cannot. Lines 63-68 only call `spSetUnitCOBValue(u, 2048+perk, 1)` on a unit without a Lua script, and after conversion every unit has one, so the perk is never set. Call it on the team's first unit whatever its script. Lines 69-75 pass `perk` to `NewPerk` in Lua scripts and `2048+perk` to COB scripts. Converted scripts compare against `PERK_*`, so they need `2048+perk`, while the hand-written ones such as `scripts/THIS.lua` expect `perk`. Decide per script with the user, because that is game knowledge, not a converter rule.
6. Start a skirmish with THIS Lua on the current engine. Pick the perk at index 2 (`PERK_MORE_GUNS`, 2050), then build a `sword`. Confirm its `turret1`, `barrel1` and `sleeve1` are visible, because `sword.bos` lines 22-26 hide them when the perk reads 0. Build a second `sword` before picking the perk in another skirmish and confirm they are hidden, so the check can fail.
7. Confirm `infolog.txt` has no `unknown get-constant` or `unknown set-constant` line for ids 1024 to 8191, and no Lua error from `cob_vars.lua`.
8. In a widget, call `Spring.GetCOBTeamVar(Spring.GetMyTeamID(), 2)` after picking that perk and confirm it answers 1.

- [ ] **Step 4: Offer the PR**

Tell the user the branch is ready to try with `bun tauri dev`, and file the PR through the `file-pr` skill once they approve the description. Offer to delete `~/.spring/games/THIS-lua.sdd` once they are done with it.

## Out of scope, and why

- **The COB preview runtime** (`crates/tauri-plugin-coilbox-anim/src/cobrun.rs`) still stores shared values. The parity sweep in `bos2lua_parity.rs` compares converted Lua with the COB's intended behaviour, and the converted Lua now keeps these values, so the two still agree.
- **Keeping shared values for COB scripts that stay COB.** A COB script can call LuaRules through `call-script lua_...`, but each shared `get` would have to be rewritten into a call plus a read of a `LUA` slot, and that belongs in the compiler.
- **Editing a game's own files automatically.** Every game's `main.lua`, `draw.lua` and `luaui.lua` differ, Metal Factions loads a security file before anything else, and THIS's perks gadget needs a decision per script. The page shows the one line to add instead of rewriting files blind.
- **Performance.** A script setting a shared value every frame now makes an engine call with a string key each time. That has not been measured, and the THIS skirmish in Task 7 is where a problem would show.
