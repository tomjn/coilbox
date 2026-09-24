# Firing and bitmaps in the preview effects renderer, implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a scenario fires a weapon, both runtimes record the muzzle flare and the shot, and the model editor's preview draws the engine's muzzle flame and a neutral tracer with the game's own bitmaps.

**Architecture:** Rust runtimes gain an engine `fire` action and two outputs, `flare` and `shot`. The TypeScript pipeline from PR A is extended: `effectsPlayback.ts` resolves flares and shots to world-space emissions once per timeline, `effects.ts` turns them into textured sprites as a pure function of the frame, and `effectsLayer.ts` draws the sprites in a second instanced mesh with the engine's blend. Bitmaps come from the game archive through one `unitsyncLuaExec` call and one new decode command, packed into a canvas atlas.

**Tech Stack:** Rust (coilbox-unitpose, tauri-plugin-coilbox-anim, coilbox-springlua, coilbox-bos2lua, tauri-plugin-coilbox-lego), TypeScript, React, three.js, vitest.

**Spec:** `docs/superpowers/specs/2026-09-23-effects-renderer-design.md`, PR B in "Delivery". Read sections 1 to 5 before starting any task.

## Global Constraints

- Engine facts come from `~/dev/RecoilEngine`. Cite the file and line in a comment where code ports engine behaviour.
- A number with no engine source is labelled in code as set by eye and tuned with the user on screen.
- Do not change the nano constants in `src/lego/effects.ts` (`NANO_DOT_HALF_SIZE`, `NANO_BRIGHTNESS_SPREAD`, `NANO_DOTS_PER_FRAME`, `NANO_SPREAD`, `NANO_HIGHLIGHT_CHANCE`, `NANO_HIGHLIGHT_MIX`) or how nano is drawn.
- Comments, docs and commit messages: no em dashes, no semicolons (a hook blocks them). Plain English, sentence case.
- `Math.random` is never used in effects code. Random draws come from `unitFloat(seed, draw)`.
- three.js caches an instanced geometry's max instance count at first render. Growing a buffer means a new geometry.
- Rust: run `cargo fmt --all` rather than hand-formatting.
- Commit after each task with `git add <explicit paths>`. Never `git add -A`. Never amend.
- Do not run `git checkout`, `git rebase`, `git pull` or `git push`.

## Decisions taken while planning (differences from the spec's wording)

1. The weapon number rides in the event's existing `args`, `{ engine: "fire", args: [1] }`, rather than a new `weapon` field on `ScriptEvent`. The spec avoided a new field for nano for the same reason: about 50 Rust literals build a `ScriptEvent`.
2. Bitmaps are read with `VFS.LoadFile` inside the same `unitsyncLuaExec` call that evaluates `gamedata/resources.lua`. That call mounts the game with its dependencies. `unitsyncArchiveExtract` reads only the named archive (`crates/coilbox-unitsync-worker/src/archive.rs:757`), and `unitsyncArchiveFile` drops TGA alpha (`archive.rs:715-727`), so neither suits particle bitmaps. The bytes come back hex encoded and are decoded by `coilbox_texture::decode`, the decoder every stored unit texture goes through.
3. When the game has no `gamedata/resources.lua` of its own, the base content's copy answers if the game depends on it, because the lookup goes through the VFS, and that copy parses `resources.tdf` itself. With neither, the base content's default names are used (`cont/base/springcontent/gamedata/resources.lua:59-112`).
4. `sfx 2048 + n`, the tracer along the emit direction, is not in PR B. The spec's delivery list names it in neither B nor C, and it belongs with the rest of `emit-sfx` in PR C. PR B implements the emit point rule, because `shot` uses it.
5. `bos2lua` currently writes `Show(piece)` for every BOS `show`. The engine draws a flare instead when `show` runs inside a fire function (`CobThread.cpp:715-728`), so a converted script loses its flares. Task 3 fixes the converter, which the parity test in the spec needs.
6. The nano parity case carried over from PR A landed in #3011, with #3009 fixed. Nothing to do for it here.

## File structure

- `crates/coilbox-unitpose/src/lib.rs`: `EngineAction::Fire`, `ScriptOutput::Flare` and `ScriptOutput::Shot`, `Model::show_flare` and `Model::shot`.
- `crates/tauri-plugin-coilbox-anim/src/cobrun.rs`: the call stack remembers each frame's function, `SHOW` in a fire function records a flare, and the `fire` action.
- `crates/coilbox-springlua/src/unitscript.rs`: `Spring.UnitScript.ShowFlare` and the `fire` action.
- `crates/coilbox-bos2lua/src/emit.rs`: `show` in a fire function becomes `Spring.UnitScript.ShowFlare`.
- `crates/tauri-plugin-coilbox-anim/src/bos2lua_parity.rs`: a firing parity test, and the sweep uses the `fire` action.
- `src/lego/scriptPlayback.ts`, `src/lego/scriptMarks.ts`, `src/lego/aimResolver.ts`: types, the `firing` scenario, scrubber words, aim directions.
- `src/lego/effects.ts`: emit point rule, flame and tracer emissions, sprites.
- `src/lego/pages/components/effectsLayer.ts`: the sprite mesh and the atlas.
- `src/lego/pages/components/effectsPlayback.ts`, `useScriptFrameStepping.ts`, `standInPlayback.ts`, `AnimationPanel.tsx`: resolving flares and shots.
- `crates/tauri-plugin-coilbox-lego/src/lib.rs`, `build.rs`, `permissions/default.toml`, `src/lego/bindings.ts`: `lego_bitmap_png`.
- `src/lego/effectBitmaps.ts` (new), `src/lego/pages/components/useEffectBitmaps.ts` (new), `BuilderPage.tsx`, `ModelViewport.tsx`, `AnimationPanel.tsx`: loading bitmaps and saying which are missing.

---

### Task 1: Flare and shot outputs, and firing in the compiled runtime

**Files:**
- Modify: `crates/coilbox-unitpose/src/lib.rs` (`EngineAction` at :90, `ScriptOutput` at :169, `Model` output helpers near :557)
- Modify: `crates/tauri-plugin-coilbox-anim/src/cobrun.rs` (`Call` :252, `Thread::new` :293, `Run` :315, `Run::start` :351, `fire_due` :446, `engine` :553, `query_nano_piece` :647, `SHOW` :1009, `RETURN` :1068, `call` :1294)
- Test: `crates/tauri-plugin-coilbox-anim/src/cobrun_tests.rs`

**Interfaces:**
- Produces, in `coilbox_unitpose`:
  - `EngineAction::Fire`, serialised as `"fire"`. The weapon number, counted from one, is the event's `args[0]`, 1 when absent.
  - `ScriptOutput::Flare { frame: u32, piece: String }`, serialised with `kind: "flare"`.
  - `ScriptOutput::Shot { frame: u32, weapon: u32, piece: Option<String> }`, serialised with `kind: "shot"`.
  - `Model::show_flare(&mut self, frame: u32, piece: usize)`
  - `Model::shot(&mut self, frame: u32, weapon: u32, piece: Option<usize>)`, which notes "The script named no weapon piece." when `piece` is `None`.
- Neither new output is an effect for `is_effect`, so `EFFECTS_NOTE` does not change. Both are drawn now.

Engine facts for this task:
- `SHOW` compares `LocalFunctionID()`, the function of the innermost call frame, against the script index of `FirePrimary + COBFN_Weapon_Funcs * i` for `i < MAX_WEAPONS_PER_UNIT`, which is 32. A match calls `ShowFlare` and leaves visibility alone (`rts/Sim/Units/Scripts/CobThread.cpp:715-728`). The names are `FireWeapon1` to `FireWeapon32`, with `FirePrimary`, `FireSecondary` and `FireTertiary` as older spellings (`CobScriptNames.cpp:59-90`). `Program::script` already applies those aliases.
- On one frame the engine calls `FireWeapon`, then `Shot` with one argument of 0, then `QueryWeapon` (`rts/Sim/Weapons/Weapon.cpp:509-511,590-595`, `CobInstance.cpp:489-493`). Each `Call` runs the call-in's first tick inline (`CobInstance.cpp:593`).
- `QueryWeapon` is seeded `[1, -1]` and slot 0 is returned (`CobInstance.cpp:437-446`), so a missing or waiting `QueryWeapon` answers script piece 1. If that is not a piece, the engine uses the `AimFromWeapon` piece, asked the same way (`Weapon.cpp:235-260`).

- [ ] **Step 1: Write the failing tests**

Append to `crates/tauri-plugin-coilbox-anim/src/cobrun_tests.rs`. The tests compile BOS with the crate's own compiler, so they read as scripts.

```rust
mod engine_fire {
    use super::*;
    use coilbox_unitpose::{EngineAction, ScriptOutput};
    use std::path::Path;

    fn compile(source: &str) -> Vec<u8> {
        let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("../coilbox-bos2lua/tests/fixtures");
        crate::compile_bos(source, &dir).unwrap()
    }

    fn fire(frame: u32, weapon: f64) -> ScriptEvent {
        ScriptEvent {
            frame,
            callin: String::new(),
            args: vec![weapon],
            ambient: false,
            world: None,
            engine: Some(EngineAction::Fire),
        }
    }

    fn fired(bytes: &[u8], events: &[ScriptEvent], frames: u32) -> Timeline {
        let mut all = created();
        all.extend_from_slice(events);
        run(bytes, &model_pieces(), &all, frames, &[], &HashMap::new())
    }

    fn hidden(timeline: &Timeline, frame: usize, piece: &str) -> bool {
        let index = timeline.pieces.iter().position(|p| p == piece).unwrap();
        timeline.hidden[frame][index]
    }

    const GUN: &str = r#"
        piece base, turret, barrel;
        Create() { hide barrel; }
        QueryWeapon1(piecenum) { piecenum = barrel; }
        AimFromWeapon1(piecenum) { piecenum = turret; }
        FirePrimary() { show barrel; }
        Shot1(zero) { show turret; }
    "#;

    /// `show` inside a fire function draws a flare and leaves the piece
    /// hidden (`CobThread.cpp:715-728`). Anywhere else it unhides.
    #[test]
    fn show_in_a_fire_function_records_a_flare_and_leaves_the_piece_hidden() {
        let timeline = fired(&compile(GUN), &[fire(5, 1.0)], 8);

        assert_eq!(timeline.error, None);
        assert!(timeline.events.contains(&ScriptOutput::Flare {
            frame: 5,
            piece: "barrel".into()
        }));
        assert!(hidden(&timeline, 7, "barrel"));
    }

    /// `Shot1` is not a fire function, so its `show` unhides.
    #[test]
    fn show_outside_a_fire_function_still_unhides() {
        let source = GUN.replace("show turret", "hide turret; show turret");
        let timeline = fired(&compile(&source), &[fire(5, 1.0)], 8);

        assert!(!hidden(&timeline, 7, "turret"));
        assert!(!timeline
            .events
            .iter()
            .any(|e| matches!(e, ScriptOutput::Flare { piece, .. } if piece == "turret")));
    }

    /// A function a fire function calls is not itself a fire function: the
    /// engine checks the innermost call frame.
    #[test]
    fn show_in_a_function_called_from_a_fire_function_unhides() {
        let source = r#"
            piece base, turret, barrel;
            Create() { hide barrel; }
            Flash() { show barrel; }
            FireWeapon1() { call-script Flash(); }
        "#;
        let timeline = fired(&compile(source), &[fire(5, 1.0)], 8);

        assert!(!hidden(&timeline, 7, "barrel"));
        assert!(!timeline
            .events
            .iter()
            .any(|e| matches!(e, ScriptOutput::Flare { .. })));
    }

    /// `FireWeapon`, then `Shot`, then `QueryWeapon`, on the one frame
    /// (`Weapon.cpp:509-511,590-595`). The shot names what `QueryWeapon1`
    /// answered after `Shot1` ran.
    #[test]
    fn fire_calls_fire_then_shot_then_query_weapon_on_its_frame() {
        let source = r#"
            piece base, turret, barrel;
            static-var muzzle;
            Create() { muzzle = turret; }
            FireWeapon1() { muzzle = base; }
            Shot1(zero) { muzzle = barrel; }
            QueryWeapon1(piecenum) { piecenum = muzzle; }
        "#;
        let timeline = fired(&compile(source), &[fire(5, 1.0)], 8);

        assert_eq!(
            timeline
                .events
                .iter()
                .filter(|e| matches!(e, ScriptOutput::Shot { .. }))
                .cloned()
                .collect::<Vec<_>>(),
            [ScriptOutput::Shot {
                frame: 5,
                weapon: 1,
                piece: Some("barrel".into())
            }]
        );
    }

    /// A missing `QueryWeapon` answers script piece 1, as the engine's seed
    /// leaves it (`CobInstance.cpp:437-446`).
    #[test]
    fn a_missing_query_weapon_answers_script_piece_one() {
        let source = "piece base, turret, barrel;\nCreate() { }\n";
        let timeline = fired(&compile(source), &[fire(5, 1.0)], 8);

        assert!(timeline.events.contains(&ScriptOutput::Shot {
            frame: 5,
            weapon: 1,
            piece: Some("turret".into())
        }));
        assert!(timeline.warnings.iter().any(|w| w.contains("no QueryWeapon1")));
    }

    /// The weapon number picks the call-ins: weapon 2 runs `FireWeapon2`.
    #[test]
    fn the_weapon_number_picks_the_call_ins() {
        let source = r#"
            piece base, turret, barrel;
            Create() { hide barrel; hide turret; }
            FireWeapon1() { show turret; }
            FireWeapon2() { show barrel; }
            QueryWeapon2(piecenum) { piecenum = barrel; }
        "#;
        let timeline = fired(&compile(source), &[fire(5, 2.0)], 8);

        assert!(timeline.events.contains(&ScriptOutput::Flare {
            frame: 5,
            piece: "barrel".into()
        }));
        assert!(!timeline
            .events
            .iter()
            .any(|e| matches!(e, ScriptOutput::Flare { piece, .. } if piece == "turret")));
    }
}
```

If the compiler rejects a line of BOS above, fix the BOS, not the assertion. `call-script` and `static-var` are the compiler's spellings. Check `crates/tauri-plugin-coilbox-anim/src/parser.rs` if unsure.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cargo test -p tauri-plugin-coilbox-anim engine_fire`
Expected: compile errors for `EngineAction::Fire`, `ScriptOutput::Flare` and `ScriptOutput::Shot`.

- [ ] **Step 3: Add the types in `coilbox-unitpose`**

In `crates/coilbox-unitpose/src/lib.rs`, add to `EngineAction` after `FactoryFinish`:

```rust
    /// A weapon fires. The engine calls `FireWeapon`, then `Shot`, then asks
    /// `QueryWeapon` for the muzzle, all on one frame
    /// (`rts/Sim/Weapons/Weapon.cpp:509-511,590-595`). The weapon number,
    /// counted from one, is the event's first argument.
    Fire,
```

`#[serde(rename_all = "lowercase")]` already makes it `"fire"`.

Add to `ScriptOutput` after `Nano`:

```rust
    /// `show` inside a fire function, or `ShowFlare`. The engine draws a
    /// muzzle flame at the piece rather than unhiding it
    /// (`rts/Sim/Units/Scripts/CobThread.cpp:715-728`).
    Flare { frame: u32, piece: String },
    /// A shot, and the piece `QueryWeapon` named for its muzzle, or none when
    /// neither it nor `AimFromWeapon` named a piece of this unit.
    Shot {
        frame: u32,
        weapon: u32,
        piece: Option<String>,
    },
```

Add to `impl Model` beside `emit_sfx`:

```rust
    pub fn show_flare(&mut self, frame: u32, piece: usize) {
        let piece = self.pieces[piece].name.clone();
        self.events.push(ScriptOutput::Flare { frame, piece });
    }

    pub fn shot(&mut self, frame: u32, weapon: u32, piece: Option<usize>) {
        if piece.is_none() {
            self.note("The script named no weapon piece.".to_string());
        }
        let piece = piece.map(|index| self.pieces[index].name.clone());
        self.events.push(ScriptOutput::Shot {
            frame,
            weapon,
            piece,
        });
    }
```

Add a serialisation test to the `tests` module in the same file:

```rust
    #[test]
    fn serialises_a_flare_and_a_shot_with_their_kinds() {
        let flare = serde_json::to_value(ScriptOutput::Flare {
            frame: 3,
            piece: "flare1".into(),
        })
        .unwrap();
        assert_eq!(flare["kind"], "flare");
        let shot = serde_json::to_value(ScriptOutput::Shot {
            frame: 3,
            weapon: 1,
            piece: None,
        })
        .unwrap();
        assert_eq!(shot["kind"], "shot");
        assert_eq!(shot["piece"], serde_json::Value::Null);
    }
```

Check `serde_json` is a dev dependency of the crate first. If it is not, deserialize an `EngineAction` from `"\"fire\""` instead, following the existing `EngineAction` test near `lib.rs:1100`, and serialise with whatever the crate already uses.

- [ ] **Step 4: Remember each call frame's function in the compiled runtime**

In `cobrun.rs`:

1. Add `function: usize` to `struct Call`, documented as "The function this frame is running, which is what `SHOW` checks (`CobThread.cpp:715-718`)."
2. `Thread::new` stores `function` in its first `Call` instead of discarding it (remove `let _ = function;`).
3. `Run::call` pushes `function` into the new `Call`.
4. The `RETURN` arm's pattern `Some(Call { ret: Some(ret), stack_top })` becomes `Some(Call { ret: Some(ret), stack_top, .. })`.
5. Add a field to `Run`, filled in `Run::start`:

```rust
    /// The functions the engine calls as `FireWeapon1` to `FireWeapon32`, in
    /// which `SHOW` draws a flare instead of unhiding
    /// (`CobThread.cpp:715-728`, `MAX_WEAPONS_PER_UNIT` being 32).
    fire_functions: Vec<usize>,
```

```rust
        let fire_functions = (1..=32)
            .filter_map(|weapon| program.script(&format!("FireWeapon{weapon}")))
            .collect();
```

Compute it before `program` moves into `Self`.

6. Replace the `SHOW`/`HIDE` arm:

```rust
            w if w == op("SHOW") || w == op("HIDE") => {
                let hide = word == op("HIDE");
                let piece = self.word(i)?;
                if let Some(piece) = model_piece(&self.program, piece) {
                    let function = self.threads[i].calls.last().map(|call| call.function);
                    let in_fire = function.is_some_and(|f| self.fire_functions.contains(&f));
                    if !hide && in_fire {
                        self.model.show_flare(self.frame, piece);
                    } else {
                        self.model.set_hidden(piece, hide);
                    }
                }
            }
```

- [ ] **Step 5: The `fire` action**

In `fire_due`, the engine branch currently reads `self.tick_queued_call_ins(start)?; self.engine(action)?; continue;`. Make it:

```rust
            if let Some(action) = event.engine {
                self.tick_queued_call_ins(start)?;
                if action == EngineAction::Fire {
                    let weapon = event.args.first().copied().unwrap_or(1.0) as u32;
                    self.fire(weapon)?;
                } else {
                    self.engine(action)?;
                }
                continue;
            }
```

Add beside `query_nano_piece`. Refactor the ask into one helper that `query_nano_piece` also uses, keeping its existing notes word for word so its tests stay green:

```rust
    /// A weapon fires: `FireWeapon`, then `Shot` with its one argument of 0,
    /// then `QueryWeapon` for the muzzle, each call-in's first tick run inline
    /// as the engine's `Call` runs it (`Weapon.cpp:509-511,590-595`,
    /// `CobInstance.cpp:489-493,593`).
    fn fire(&mut self, weapon: u32) -> Result<(), String> {
        let queued_at = self.threads.len();
        self.start_callin(&format!("FireWeapon{weapon}"), &[])?;
        self.tick_queued_call_ins(queued_at)?;
        let queued_at = self.threads.len();
        self.start_callin(&format!("Shot{weapon}"), &[0.0])?;
        self.tick_queued_call_ins(queued_at)?;
        let piece = self.weapon_piece(weapon)?;
        self.model.shot(self.frame, weapon, piece);
        Ok(())
    }

    /// The muzzle piece, as `CWeapon::UpdateWeaponPieces` settles it: what
    /// `QueryWeapon` answers, or the `AimFromWeapon` piece when that is not a
    /// piece (`Weapon.cpp:235-260`).
    fn weapon_piece(&mut self, weapon: u32) -> Result<Option<usize>, String> {
        let muzzle = self.ask_piece(&format!("QueryWeapon{weapon}"), "the shot")?;
        if let Some(piece) = model_piece(&self.program, muzzle) {
            return Ok(Some(piece));
        }
        let aim_from = self.ask_piece(&format!("AimFromWeapon{weapon}"), "the shot")?;
        Ok(model_piece(&self.program, aim_from))
    }
```

`ask_piece(callin, what)` is the body of `query_nano_piece` with the call-in name as a parameter: seed `[-1]`, one parameter, step the thread once, return slot 0, or return 1 with a note when the call-in is missing or waits. Its notes read:

- "This script has no {callin} call-in, so {what} comes from script piece 1, which is what the engine answers for it."
- "{callin} waited rather than answering, so {what} comes from script piece 1, which is what the engine answers for it."

`query_nano_piece` keeps its own two notes, because PR A's tests assert them. Either give `ask_piece` a way to pass the notes in, or leave `query_nano_piece` as it is and write `ask_piece` beside it. Pick the one with less code. Do not change the nano notes' wording.

Import `EngineAction` where `fire_due` needs it if it is not already in scope.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cargo test -p tauri-plugin-coilbox-anim engine_fire` and then `cargo test -p coilbox-unitpose`
Expected: all pass.

- [ ] **Step 7: Run the crate's whole suite**

Run: `cargo test -p tauri-plugin-coilbox-anim`
Expected: all pass, including `engine_nano` and the parity tests that need no game. The Lua runtime does not know `EngineAction::Fire` yet, and nothing sends it, so nothing else changes.

- [ ] **Step 8: Commit**

```bash
cargo fmt --all
git add crates/coilbox-unitpose/src/lib.rs crates/tauri-plugin-coilbox-anim/src/cobrun.rs crates/tauri-plugin-coilbox-anim/src/cobrun_tests.rs
git commit -m "Record a flare and a shot when a compiled script fires"
```

---

### Task 2: Firing in the Lua runtime

**Files:**
- Modify: `crates/coilbox-springlua/src/unitscript.rs` (`fire_due` :577, `engine` :675, `query_nano_piece` :775, `install_unit_script_table` :1137, the `Show`/`Hide` loop :2180)
- Test: `crates/coilbox-springlua/src/unitscript_tests.rs`

**Interfaces:**
- Consumes: `EngineAction::Fire`, `Model::show_flare`, `Model::shot` from Task 1.
- Produces: `Spring.UnitScript.ShowFlare(piece)` and a bare `ShowFlare(piece)` global, with the piece counted from one. The `fire` action behaves as in Task 1.

Engine facts for this task:
- `Spring.UnitScript.ShowFlare(piece)` is "Same as COB's show inside FireWeaponX" (`LuaUnitScript.cpp:185-186,1512-1520`).
- Lua's `RunQueryCallIn` answers -1, which names no piece, when the call-in is missing or answers nothing (`LuaUnitScript.cpp:505-519`). So a missing `QueryWeapon` falls to `AimFromWeapon`, and to none if that is missing too.
- The preview's Lua runtime looks call-ins up by their numbered names, `FireWeapon1`, `Shot1`, `QueryWeapon1`, as the unit script framework's dispatcher does (see `src/lego/luaCallinLint.ts:8-21`). `Shot1` takes no arguments in Lua (`LuaUnitScript.cpp:143`).

- [ ] **Step 1: Write the failing tests**

Append to `crates/coilbox-springlua/src/unitscript_tests.rs`, using the file's own `pieces()` helper (base, turret, barrel):

```rust
mod engine_fire {
    use super::*;
    use coilbox_unitpose::ScriptOutput;

    fn fire(frame: u32, weapon: f64) -> ScriptEvent {
        ScriptEvent {
            frame,
            callin: String::new(),
            args: vec![weapon],
            ambient: false,
            world: None,
            engine: Some(EngineAction::Fire),
        }
    }

    fn fired(script: &str, events: &[ScriptEvent], frames: u32) -> Timeline {
        let mut all = vec![ScriptEvent {
            frame: 0,
            callin: "Create".into(),
            args: Vec::new(),
            ambient: false,
            world: None,
            engine: None,
        }];
        all.extend_from_slice(events);
        run(script, "test.lua", &Unit::new(&pieces()), &all, frames, &HashMap::new())
    }

    #[test]
    fn show_flare_records_a_flare_and_leaves_the_piece_hidden() {
        let timeline = fired(
            r#"
            local turret, barrel = piece("turret", "barrel")
            function script.Create() Hide(barrel) end
            function script.QueryWeapon1() return barrel end
            function script.FireWeapon1() Spring.UnitScript.ShowFlare(barrel) end
            "#,
            &[fire(5, 1.0)],
            8,
        );

        assert_eq!(timeline.error, None);
        assert!(timeline.events.contains(&ScriptOutput::Flare {
            frame: 5,
            piece: "barrel".into()
        }));
        let index = timeline.pieces.iter().position(|p| p == "barrel").unwrap();
        assert!(timeline.hidden[7][index]);
    }

    #[test]
    fn fire_calls_fire_then_shot_then_query_weapon_on_its_frame() {
        let timeline = fired(
            r#"
            local base, turret, barrel = piece("base", "turret", "barrel")
            local muzzle = turret
            function script.FireWeapon1() muzzle = base end
            function script.Shot1() muzzle = barrel end
            function script.QueryWeapon1() return muzzle end
            "#,
            &[fire(5, 1.0)],
            8,
        );

        assert!(timeline.events.contains(&ScriptOutput::Shot {
            frame: 5,
            weapon: 1,
            piece: Some("barrel".into())
        }));
    }

    /// `RunQueryCallIn` answers -1 for a missing `QueryWeapon`, so the engine
    /// falls back to the `AimFromWeapon` piece (`Weapon.cpp:235-260`).
    #[test]
    fn a_missing_query_weapon_falls_back_to_aim_from_weapon() {
        let timeline = fired(
            r#"
            local turret = piece("turret")
            function script.AimFromWeapon1() return turret end
            "#,
            &[fire(5, 1.0)],
            8,
        );

        assert!(timeline.events.contains(&ScriptOutput::Shot {
            frame: 5,
            weapon: 1,
            piece: Some("turret".into())
        }));
    }

    #[test]
    fn no_weapon_piece_at_all_records_a_shot_from_no_piece_and_says_so() {
        let timeline = fired("function script.Create() end", &[fire(5, 1.0)], 8);

        assert!(timeline.events.contains(&ScriptOutput::Shot {
            frame: 5,
            weapon: 1,
            piece: None
        }));
        assert!(timeline
            .warnings
            .iter()
            .any(|w| w == "The script named no weapon piece."));
    }

    #[test]
    fn show_flare_is_on_the_unit_script_table_too() {
        let timeline = fired(
            r#"
            local barrel = piece("barrel")
            function script.FireWeapon1() UnitScript.ShowFlare(barrel) ShowFlare(barrel) end
            "#,
            &[fire(5, 1.0)],
            8,
        );

        assert_eq!(timeline.error, None);
        assert_eq!(
            timeline
                .events
                .iter()
                .filter(|e| matches!(e, ScriptOutput::Flare { .. }))
                .count(),
            2
        );
    }
}
```

If `EngineAction`, `Unit`, `run` or `Timeline` are not in scope through `use super::*`, import them the way `mod engine_nano` in the same file does.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cargo test -p coilbox-springlua engine_fire`
Expected: FAIL. `ShowFlare` is nil, and the `fire` action falls through to the stand-in code, which notes there is no stand-in.

- [ ] **Step 3: Register `ShowFlare`**

Beside the `Hide`/`Show` loop near `unitscript.rs:2180`, in the same function:

```rust
    // `Spring.UnitScript.ShowFlare(piece)`, which draws a muzzle flame at the
    // piece rather than showing it (`LuaUnitScript.cpp:185-186,1512-1520`).
    let state = Rc::clone(sim);
    globals.set(
        "ShowFlare",
        lua.create_function(move |_, piece: i64| {
            let mut sim = state.borrow_mut();
            let index = piece_index(&sim, piece)?;
            let frame = sim.frame;
            sim.model.show_flare(frame, index);
            Ok(())
        })?,
    )?;
```

Add `"ShowFlare"` to the name list in `install_unit_script_table`, after `"DropUnit"`. `Spring.UnitScript` is that same table (`unitscript.rs:1537`), so both spellings work.

- [ ] **Step 4: The `fire` action**

In `fire_due`, route the action as Task 1 does:

```rust
            if let Some(action) = event.engine {
                self.tick_queued_call_ins(start)?;
                if action == EngineAction::Fire {
                    let weapon = event.args.first().copied().unwrap_or(1.0) as u32;
                    self.fire(weapon)?;
                } else {
                    self.engine(action)?;
                }
                continue;
            }
```

Add beside `query_nano_piece`:

```rust
    /// A weapon fires: `FireWeapon`, then `Shot`, then `QueryWeapon` for the
    /// muzzle, each call-in's first tick run inline
    /// (`Weapon.cpp:509-511,590-595`, `LuaUnitScript.cpp:878-883,1018`).
    fn fire(&mut self, weapon: u32) -> Result<(), String> {
        let queued_at = self.runners.len();
        self.start_callin(&format!("FireWeapon{weapon}"), Vec::new())?;
        self.tick_queued_call_ins(queued_at)?;
        let queued_at = self.runners.len();
        self.start_callin(&format!("Shot{weapon}"), Vec::new())?;
        self.tick_queued_call_ins(queued_at)?;
        let piece = self.weapon_piece(weapon);
        let mut sim = self.sim.borrow_mut();
        let frame = sim.frame;
        sim.model.shot(frame, weapon, piece);
        Ok(())
    }

    /// What `QueryWeapon` names, or the `AimFromWeapon` piece when that names
    /// none of this unit's pieces (`Weapon.cpp:235-260`).
    fn weapon_piece(&mut self, weapon: u32) -> Option<usize> {
        let count = self.sim.borrow().model.pieces.len();
        let valid = |piece: i64| usize::try_from(piece).ok().filter(|index| *index < count);
        valid(self.ask_piece(&format!("QueryWeapon{weapon}")))
            .or_else(|| valid(self.ask_piece(&format!("AimFromWeapon{weapon}"))))
    }

    /// Ask a call-in that answers with a piece, as `RunQueryCallIn` does: a
    /// piece counted from one out, less one, or -1 when it is missing, fails
    /// or answers nothing (`LuaUnitScript.cpp:505-519`).
    fn ask_piece(&mut self, callin: &str) -> i64 {
        let function: Option<Function> = self.script.get(callin).ok().flatten();
        let Some(function) = function else { return -1 };
        match function.call::<Option<f64>>(()) {
            Ok(Some(piece)) => piece as i64 - 1,
            Ok(None) => -1,
            Err(error) => {
                self.sim.borrow_mut().model.note(format!(
                    "{callin} failed: {}",
                    describe(&error)
                ));
                -1
            }
        }
    }
```

The borrow in the closure passed to `or_else` may fight the borrow checker, because `self.ask_piece` needs `&mut self`. If so, write the two asks as plain `if let` statements. Leave `query_nano_piece` alone.

- [ ] **Step 5: Run the tests**

Run: `cargo test -p coilbox-springlua`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
cargo fmt --all
git add crates/coilbox-springlua/src/unitscript.rs crates/coilbox-springlua/src/unitscript_tests.rs
git commit -m "Record a flare and a shot when a Lua unit script fires"
```

---

### Task 3: bos2lua writes `ShowFlare` in a fire function, and the parity test

**Files:**
- Modify: `crates/coilbox-bos2lua/src/emit.rs` (`Writer` :1163, `Writer::new` :1217, `StmtKind::Show` :2863, `weapon` :291, `role` :332)
- Modify: `crates/tauri-plugin-coilbox-anim/src/bos2lua_parity.rs` (the sweep's `events` :119-135, new test after `both` :436)
- Test: `crates/coilbox-bos2lua/tests/convert.rs`

**Interfaces:**
- Consumes: Tasks 1 and 2.
- Produces: converted Lua in which a BOS `show` inside a function the engine calls as a fire call-in is `Spring.UnitScript.ShowFlare(piece)`.

A function counts as a fire function when it keeps the engine's fire role after the tie-break the converter already applies (the numbered `FireWeaponN` wins over `FirePrimary`, `emit.rs:909-935`). A function that only shares the name after losing the tie-break is an ordinary function, as in the engine.

- [ ] **Step 1: Write the failing converter test**

Append to `crates/coilbox-bos2lua/tests/convert.rs`:

```rust
/// The engine draws a muzzle flame for `show` inside a fire function and
/// leaves the piece hidden (`CobThread.cpp:715-728`). Anywhere else, `show`
/// unhides.
#[test]
fn show_in_a_fire_function_becomes_show_flare() {
    let source = r#"
        piece base, flare;
        Create() { hide flare; show base; }
        FirePrimary() { show flare; }
    "#;
    let lua = convert(
        source,
        &Options {
            name: "scripts/gun.bos",
            includes: &HashMap::new(),
            pieces: None,
            linear_scale: MODERN_LINEAR,
            precedence: Precedence::Modern,
            prune: false,
        },
    )
    .unwrap()
    .lua;

    assert!(lua.contains("Spring.UnitScript.ShowFlare(flare)"), "{lua}");
    assert!(lua.contains("Show(base)"), "{lua}");
    assert!(!lua.contains("Show(flare)"), "{lua}");
}
```

If the converter names the piece local something other than `flare`, adjust the expected text to what it writes, and keep the three assertions' meaning.

- [ ] **Step 2: Run it to verify it fails**

Run: `cargo test -p coilbox-bos2lua --test convert show_in_a_fire_function`
Expected: FAIL, the output has `Show(flare)`.

- [ ] **Step 3: Implement**

1. Add to `Writer`:

```rust
    /// Whether the function being written is one the engine calls as a fire
    /// call-in, where `show` draws a muzzle flame instead of unhiding
    /// (`CobThread.cpp:715-728`).
    fire: bool,
```

Initialise it to `false` in `Writer::new`.

2. Find where the writer starts each BOS function (where `locals` and `ret` are reset for the function) and set `self.fire` there. It is true when the function's role after the tie-break is `Role::Callin(spec)` with `spec.lua` starting with `"FireWeapon"`. The tie-break result is recorded on `Program` (look at how the writer finds a function's call-in spec, `p.funcs` and `claimed` near `emit.rs:909-960`). Reset it to `false` when the function ends.

3. In the `StmtKind::Hide(piece) | StmtKind::Show(piece)` arm:

```rust
            StmtKind::Show(piece) if self.fire => {
                let p = self.piece(piece);
                self.code(&format!("Spring.UnitScript.ShowFlare({p})"), t);
            }
```

Place it before the existing combined arm.

- [ ] **Step 4: Run the converter's tests**

Run: `cargo test -p coilbox-bos2lua`
Expected: all pass. If a snapshot or golden test changes because a fixture shows a piece in a fire function, check the new text is `Spring.UnitScript.ShowFlare(...)` in that function only, then update the expected text.

- [ ] **Step 5: Write the parity test**

In `crates/tauri-plugin-coilbox-anim/src/bos2lua_parity.rs`, after `both`, add:

```rust
/// A flare in `FirePrimary`, a `show` in an ordinary function, a
/// `QueryWeapon1` and an alternating `QueryNanoPiece`, through both runtimes.
/// They announce the same events, and the flare piece stays hidden.
#[test]
fn both_runtimes_fire_and_spray_alike() {
    let source = r#"
        piece base, turret, flare1, flare2;
        static-var alternate;
        Create() { hide flare1; hide flare2; alternate = 0; }
        QueryWeapon1(piecenum) { piecenum = flare1; }
        AimFromWeapon1(piecenum) { piecenum = turret; }
        FirePrimary() { show flare1; }
        Shot1(zero) { show flare2; }
        QueryNanoPiece(piecenum) {
            if (alternate) { piecenum = flare1; alternate = 0; }
            else { piecenum = flare2; alternate = 1; }
        }
    "#;
    let (cob, lua, pieces) = both(source);
    let events = [
        event(0, "Create", &[]),
        ScriptEvent {
            args: vec![1.0],
            ..action(10, EngineAction::Fire)
        },
        action(20, EngineAction::NanoStart),
        action(30, EngineAction::NanoStop),
    ];
    let from_cob = crate::cobrun::run(&cob, &pieces, &events, 40, &[], &HashMap::new());
    let from_lua = run_lua(&lua, "gun.lua", &Unit::new(&pieces), &events, 40, &HashMap::new());

    assert_eq!(from_cob.error, None);
    assert_eq!(from_lua.error, None);
    assert_eq!(from_cob.events, from_lua.events);
    assert!(from_cob.events.contains(&ScriptOutput::Flare {
        frame: 10,
        piece: "flare1".into()
    }));
    assert!(from_cob.events.contains(&ScriptOutput::Shot {
        frame: 10,
        weapon: 1,
        piece: Some("flare1".into())
    }));
    let flare1 = pieces.iter().position(|p| p == "flare1").unwrap();
    let flare2 = pieces.iter().position(|p| p == "flare2").unwrap();
    for timeline in [&from_cob, &from_lua] {
        assert!(timeline.hidden[39][flare1]);
        assert!(!timeline.hidden[39][flare2]);
    }
}
```

`ScriptEvent` may not derive `Default` or allow `..action(...)`. If the struct update syntax does not compile, build the event with a struct literal as `pickup_at` does. Check `action` and `event` exist in the file with those signatures and use them as they are.

- [ ] **Step 6: The sweep fires rather than calling the call-ins**

In `converted_scripts_move_pieces_as_their_cobs_do`, replace

```rust
        event(150, "FireWeapon1", &[]),
        event(151, "Shot1", &[]),
```

with

```rust
        action(150, EngineAction::Fire),
```

The sweep's `heard` comparison then covers flares and shots too. It runs only with `COILBOX_BOS_SWEEP` set, so it passes trivially otherwise. Do not try to run it with a game. The lead runs it.

- [ ] **Step 7: Run the tests**

Run: `cargo test -p tauri-plugin-coilbox-anim bos2lua_parity`
Expected: all pass, the sweep printing that `COILBOX_BOS_SWEEP` is not set.

- [ ] **Step 8: Commit**

```bash
cargo fmt --all
git add crates/coilbox-bos2lua/src/emit.rs crates/coilbox-bos2lua/tests/convert.rs crates/tauri-plugin-coilbox-anim/src/bos2lua_parity.rs
git commit -m "Convert a show in a fire function to ShowFlare, and compare firing across both runtimes"
```

---

### Task 4: The firing scenario, scrubber words and aim directions

**Files:**
- Modify: `src/lego/scriptPlayback.ts` (`ScriptEvent.engine` :69-75, `ScriptOutput` :94-101, `firing` scenario :477-515)
- Modify: `src/lego/scriptMarks.ts` (`describeOutput` :72)
- Modify: `src/lego/aimResolver.ts` (add `aimDirection` and `aimsOf`)
- Modify: `src/lego/pages/components/standInPlayback.ts` (`StandInPlacement` :33)
- Modify: `src/lego/pages/components/AnimationPanel.tsx` (`onStandIn` call :461)
- Test: `src/lego/scriptMarks.test.ts`, `src/lego/aimResolver.test.ts`, `src/lego/scriptPlayback.test.ts`

**Interfaces:**
- Produces:
  - `ScriptOutput` gains `{ frame: number; kind: "flare"; piece: string }` and `{ frame: number; kind: "shot"; weapon: number; piece: string | null }`.
  - `ScriptEvent.engine` gains `"fire"`. The weapon number is `args[0]`, counted from one.
  - `export function aimDirection(heading: number, pitch: number): [number, number, number]` in `aimResolver.ts`, the inverse of `aimWeaponAngles`: a unit vector.
  - `export interface Aim { frame: number; dir: [number, number, number] }` and `export function aimsOf(events: ScriptEvent[]): Aim[]` in `aimResolver.ts`: one entry per `AimWeapon<n>` event with two numeric `args`, in event order.
  - `StandInPlacement.aims?: Aim[]`, documented as "The direction each resolved `AimWeapon` aimed, which is the engine's `wantedDir` a muzzle flame faces (`Weapon.cpp:509-510`)."

`aimWeaponAngles` returns `heading = atan2(dx, dz)` and `pitch = asin(dy)` for the unit direction `d` (read `aimResolver.ts:88-103`: it negates `-dx` twice). So the inverse is `[cos(pitch) * sin(heading), sin(pitch), cos(pitch) * cos(heading)]`.

- [ ] **Step 1: Write the failing tests**

In `src/lego/aimResolver.test.ts` add:

```ts
describe("aimDirection", () => {
  it("undoes aimWeaponAngles", () => {
    const from: [number, number, number] = [1, 2, 3];
    const to: [number, number, number] = [-7, 5, 11];
    const { heading, pitch } = aimWeaponAngles(from, to);
    const dir = aimDirection(heading, pitch);
    const length = Math.hypot(-8, 3, 8);
    expect(dir[0]).toBeCloseTo(-8 / length);
    expect(dir[1]).toBeCloseTo(3 / length);
    expect(dir[2]).toBeCloseTo(8 / length);
  });
});

describe("aimsOf", () => {
  it("reads each resolved AimWeapon's direction, and nothing else", () => {
    const aims = aimsOf([
      { frame: 0, callin: "Create" },
      { frame: 15, callin: "AimWeapon1", args: [0, 0] },
      { frame: 20, callin: "StartBuilding", args: [1, 0] },
      { frame: 30, callin: "AimWeapon2", args: [Math.PI / 2, 0] },
    ]);
    expect(aims.map((aim) => aim.frame)).toEqual([15, 30]);
    expect(aims[0].dir[2]).toBeCloseTo(1);
    expect(aims[1].dir[0]).toBeCloseTo(1);
  });
});
```

Import `aimDirection` and `aimsOf` alongside the file's existing imports.

In `src/lego/scriptMarks.test.ts` add:

```ts
it("describes a flare and a shot", () => {
  expect(describeOutput({ frame: 1, kind: "flare", piece: "flare1" })).toBe(
    "Flare from flare1",
  );
  expect(
    describeOutput({ frame: 1, kind: "shot", weapon: 1, piece: "flare1" }),
  ).toBe("Shot, weapon 1 from flare1");
  expect(
    describeOutput({ frame: 1, kind: "shot", weapon: 2, piece: null }),
  ).toBe("Shot, weapon 2 from no piece");
});

it("marks a flare and a shot on the scrubber", () => {
  expect(isMarked({ frame: 1, kind: "flare", piece: "flare1" })).toBe(true);
  expect(isMarked({ frame: 1, kind: "shot", weapon: 1, piece: null })).toBe(
    true,
  );
});
```

In `src/lego/scriptPlayback.test.ts` add:

```ts
it("fires weapon 1 through the engine in the firing scenario", () => {
  const firing = SCENARIOS.find((scenario) => scenario.id === "firing");
  const fires = firing?.events.filter((event) => event.engine === "fire");
  expect(fires?.map((event) => [event.frame, event.args])).toEqual([
    [at(4), [1]],
    [at(9.5), [1]],
  ]);
  expect(firing?.events.some((event) => event.callin === "Shot1")).toBe(false);
});
```

Import `SCENARIOS` and `at` if the test file does not already.

- [ ] **Step 2: Run to verify they fail**

Run: `bunx vitest run src/lego/aimResolver.test.ts src/lego/scriptMarks.test.ts src/lego/scriptPlayback.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

`scriptPlayback.ts`:
- Add `| "fire"` to `ScriptEvent.engine`, and a paragraph to its doc comment: "`fire` fires a weapon, whose number, counted from one, is `args[0]`. The runtime calls `FireWeapon`, then `Shot`, then asks `QueryWeapon` for the muzzle, on the one frame (`rts/Sim/Weapons/Weapon.cpp:509-511,590-595`)."
- Add the two `ScriptOutput` members, each with a trailing comment in the style of the others: `// show inside a fire function, or ShowFlare` and `// null when neither QueryWeapon nor AimFromWeapon named a piece`.
- In the `firing` scenario, replace `{ frame: at(4), callin: "Shot1" }` with `{ frame: at(4), engine: "fire", args: [1] }` and the same at `at(9.5)`. Keep the frames.

`scriptMarks.ts` `describeOutput`:

```ts
    case "flare":
      return `Flare from ${event.piece}`;
    case "shot":
      return `Shot, weapon ${event.weapon} from ${event.piece ?? "no piece"}`;
```

`isMarked` stays as it is. It already marks everything but nano.

`aimResolver.ts`:

```ts
/**
 * The unit direction `AimWeapon`'s heading and pitch point along, which is
 * the inverse of `aimWeaponAngles` and the engine's `wantedDir`.
 */
export function aimDirection(heading: number, pitch: number): Vec3 {
  return [
    Math.cos(pitch) * Math.sin(heading),
    Math.sin(pitch),
    Math.cos(pitch) * Math.cos(heading),
  ];
}

/** Where a resolved `AimWeapon` aimed, and when. */
export interface Aim {
  frame: number;
  dir: Vec3;
}

/** Every resolved `AimWeapon<n>` in a run's events, in order. A muzzle flame
 *  faces the latest one (`Weapon.cpp:509-510`). */
export function aimsOf(events: ScriptEvent[]): Aim[] {
  const aims: Aim[] = [];
  for (const event of events) {
    const [heading, pitch] = event.args ?? [];
    if (!/^AimWeapon\d+$/.test(event.callin ?? "")) continue;
    if (typeof heading !== "number" || typeof pitch !== "number") continue;
    aims.push({ frame: event.frame, dir: aimDirection(heading, pitch) });
  }
  return aims;
}
```

`Vec3` and `ScriptEvent` are already imported in `aimResolver.ts`. Check before adding imports.

`standInPlayback.ts`: add `aims?: Aim[]` to `StandInPlacement` with the doc comment from Interfaces. Import the `Aim` type from `../../aimResolver`.

`AnimationPanel.tsx` line 461: `onStandIn({ track, attachPieces: named, nano: scenario.nano ?? null, aims: aimsOf(events) });`. Import `aimsOf` next to `resolveScenario`. Check the `onStandIn` prop type at :227 accepts `aims`, and add `aims?: Aim[]` there too if it lists the fields itself.

- [ ] **Step 4: Run the tests and the type check**

Run: `bunx vitest run src/lego/aimResolver.test.ts src/lego/scriptMarks.test.ts src/lego/scriptPlayback.test.ts` then `bun run typecheck`
Expected: pass. A type error from an exhaustive `switch` over `ScriptOutput` elsewhere means that switch needs the two new kinds, handled the way it handles `sfx`.

- [ ] **Step 5: Commit**

```bash
git add src/lego/scriptPlayback.ts src/lego/scriptMarks.ts src/lego/aimResolver.ts src/lego/pages/components/standInPlayback.ts src/lego/pages/components/AnimationPanel.tsx src/lego/aimResolver.test.ts src/lego/scriptMarks.test.ts src/lego/scriptPlayback.test.ts
git commit -m "Fire the firing scenario's weapon through the engine, and mark flares and shots"
```

---

### Task 5: Flame and tracer particles

**Files:**
- Modify: `src/lego/effects.ts`
- Test: `src/lego/effects.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces, from `src/lego/effects.ts`:

```ts
export interface FlameEmission {
  kind: "flame";
  birth: number;
  /** The flare piece's origin, world space. */
  at: Vec3;
  /** Unit length, the latest aim. */
  dir: Vec3;
  /** `CMuzzleFlame`'s size. */
  size: number;
  seed: number;
}
export interface TracerEmission {
  kind: "tracer";
  birth: number;
  /** The muzzle's emit point, world space. */
  at: Vec3;
  /** The stand-in's middle, world space. */
  to: Vec3;
  seed: number;
}
export type Emission = NanoEmission | FlameEmission | TracerEmission;

export interface Sprites {
  count: number;
  /** Three per sprite, world space. */
  centers: Float32Array;
  /** One per sprite, in elmos. */
  halfSizes: Float32Array;
  /** Four per sprite, RGBA from 0 to 1, multiplied by the bitmap. */
  colors: Float32Array;
  /** One per sprite: `BITMAP_MUZZLE_FLAME`, `BITMAP_LASER`, or `BITMAP_SMOKE + n`. */
  bitmaps: Float32Array;
}
// Particles gains: sprites: Sprites

export const BITMAP_MUZZLE_FLAME = 0;
export const BITMAP_LASER = 1;
export const BITMAP_SMOKE = 2;
export const DEFAULT_FLAME_SIZE: number;
export function emitPoint(vertices: Vec3[]): { pos: Vec3; dir: Vec3 };
export function particlesAt(emissions: Emission[], frame: number, smokeCount?: number): Particles;
```

`smokeCount` defaults to 1. It is the number of smoke bitmaps the game names, which `CMuzzleFlame::Draw` cycles through (`a % NumSmokeTextures()`).

Engine facts, all from `rts/Rendering/Env/Particles/Classes/MuzzleFlame.cpp:25-102` unless named:
- Construction: `pos -= dir * size * 0.2`, `numSmoke = 1 + (int)(size * 5)`, and `randSmokeDir[a] = dir + guRNG.NextFloat() * 0.4`, one float added to all three components.
- `Update` runs `age++` then deletes when `age > 4 + size * 30`. The speed is the unit's, 0 in the preview.
- `Draw`, for each `a` below `numSmoke`: `alpha = max(0, 1 - age / (4 + size * 30))`, `modAge = sqrt(age + 2)`, `drawsize = modAge * 3`, `interPos = pos + randSmokeDir[a] * (a + 2) * modAge * 0.4`, `fade = clamp((1 - alpha) * (20 + a) * 0.1, 0, 1)`. A smoke quad of colour bytes `(180 * alpha * fade)` three times and `(255 * alpha * fade)`, truncated to integers, with smoke bitmap `a % count`. Then, when `fade < 1`, a muzzle flame quad of colour bytes `ifade * 255` three times and alpha byte 1, where `ifade = 1 - fade`.
- The size is `min(damageAreaOfEffect * 0.2, min(1500, damage) * 0.003)` (`Weapon.cpp:1229`). With the weapon def defaults, area of effect 8 stored as 4 (`WeaponDef.cpp:71`) and damage 1 (`WeaponDef.cpp:417`), that is `min(0.8, 0.003)`.
- The emit point: 0 vertices gives the origin and +Z, 1 vertex gives the origin and that vertex, 2 or more give vertex 0 and vertex 1 minus vertex 0 (`rts/Rendering/Models/3DModelPiece.cpp:60-78`).

The flame's age on a frame: the flame is made during the firing frame's unit update, and the projectile handler updates it later in the same frame before it is drawn, so on frame `birth + k` it has age `k + 1`. Say so in a comment.

The tracer has no engine source. Its numbers are preview choices, set by eye, to be tuned with the user on screen. Start from: `TRACER_SPEED = 30` elmos a frame, `TRACER_LENGTH = 40` elmos, `TRACER_HALF_SIZE = 2` elmos, `TRACER_QUADS = 8`, colour `[1, 1, 1, 1]`, bitmap `BITMAP_LASER`. Label each as set by eye.

- [ ] **Step 1: Write the failing tests**

Add to `src/lego/effects.test.ts`:

```ts
describe("emitPoint", () => {
  it("emits from the origin along +Z for a piece with no vertices", () => {
    expect(emitPoint([])).toEqual({ pos: [0, 0, 0], dir: [0, 0, 1] });
  });

  it("emits from the origin along the vertex for a one-vertex piece", () => {
    expect(emitPoint([[1, 2, 3]])).toEqual({ pos: [0, 0, 0], dir: [1, 2, 3] });
  });

  it("emits from vertex 0 towards vertex 1 for a longer piece", () => {
    expect(
      emitPoint([
        [1, 2, 3],
        [1, 2, 5],
        [9, 9, 9],
      ]),
    ).toEqual({ pos: [1, 2, 3], dir: [0, 0, 2] });
  });
});

const flame: FlameEmission = {
  kind: "flame",
  birth: 10,
  at: [0, 0, 0],
  dir: [0, 0, 1],
  size: DEFAULT_FLAME_SIZE,
  seed: 3,
};

describe("the muzzle flame", () => {
  it("defaults to the size the weapon def defaults give", () => {
    expect(DEFAULT_FLAME_SIZE).toBeCloseTo(0.003);
  });

  it("draws a smoke quad and a flame quad for ages 1 to 4, and nothing after", () => {
    for (const frame of [10, 11, 12, 13]) {
      const { sprites } = particlesAt([flame], frame);
      expect(sprites.count).toBe(2);
      expect(sprites.bitmaps[0]).toBe(BITMAP_SMOKE);
      expect(sprites.bitmaps[1]).toBe(BITMAP_MUZZLE_FLAME);
    }
    expect(particlesAt([flame], 14).sprites.count).toBe(0);
    expect(particlesAt([flame], 9).sprites.count).toBe(0);
  });

  it("matches CMuzzleFlame::Draw on its first frame", () => {
    const { sprites } = particlesAt([flame], 10);
    const age = 1;
    const life = 4 + DEFAULT_FLAME_SIZE * 30;
    const alpha = 1 - age / life;
    const modAge = Math.sqrt(age + 2);
    const fade = Math.min(1, (1 - alpha) * 20 * 0.1);
    expect(sprites.halfSizes[0]).toBeCloseTo(modAge * 3);
    expect(sprites.colors[0]).toBeCloseTo(Math.trunc(180 * alpha * fade) / 255);
    expect(sprites.colors[3]).toBeCloseTo(Math.trunc(255 * alpha * fade) / 255);
    expect(sprites.colors[4]).toBeCloseTo(Math.trunc((1 - fade) * 255) / 255);
    expect(sprites.colors[7]).toBeCloseTo(1 / 255);
    // Along +Z from the piece, pulled back by size * 0.2 first.
    expect(sprites.centers[2]).toBeGreaterThan(0);
  });

  it("cycles the smoke bitmaps by quad", () => {
    const big = { ...flame, size: 1 };
    const { sprites } = particlesAt([big], 10, 2);
    const smoke = Array.from(sprites.bitmaps).filter(
      (bitmap) => bitmap >= BITMAP_SMOKE,
    );
    expect(smoke.slice(0, 4)).toEqual([
      BITMAP_SMOKE,
      BITMAP_SMOKE + 1,
      BITMAP_SMOKE,
      BITMAP_SMOKE + 1,
    ]);
  });
});

const tracer: TracerEmission = {
  kind: "tracer",
  birth: 20,
  at: [0, 0, 0],
  to: [0, 0, 100],
  seed: 1,
};

describe("the tracer", () => {
  it("runs from the muzzle to the target and then stops", () => {
    const early = particlesAt([tracer], 20).sprites;
    expect(early.count).toBeGreaterThan(0);
    for (let i = 0; i < early.count; i++) {
      expect(early.centers[i * 3 + 2]).toBeGreaterThanOrEqual(0);
      expect(early.centers[i * 3 + 2]).toBeLessThanOrEqual(100);
      expect(early.bitmaps[i]).toBe(BITMAP_LASER);
    }
    expect(particlesAt([tracer], 20 + 100).sprites.count).toBe(0);
  });

  it("moves towards the target frame by frame", () => {
    const furthest = (frame: number) => {
      const { sprites } = particlesAt([tracer], frame);
      return Math.max(
        ...Array.from({ length: sprites.count }, (_, i) => sprites.centers[i * 3 + 2]),
      );
    };
    expect(furthest(22)).toBeGreaterThan(furthest(20));
  });
});

describe("particlesAt with flames and tracers", () => {
  it("gives the same arrays for the same frame, in any visiting order", () => {
    const emissions = [flame, tracer];
    const first = particlesAt(emissions, 21);
    particlesAt(emissions, 11);
    particlesAt(emissions, 30);
    expect(particlesAt(emissions, 21)).toEqual(first);
  });

  it("keeps nano on the dots and everything else on the sprites", () => {
    const { count, sprites } = particlesAt([flame], 10);
    expect(count).toBe(0);
    expect(sprites.count).toBeGreaterThan(0);
  });
});
```

Import the new names from `./effects`. Existing nano tests in the file must keep passing unchanged.

- [ ] **Step 2: Run to verify they fail**

Run: `bunx vitest run src/lego/effects.test.ts`
Expected: FAIL on the missing exports.

- [ ] **Step 3: Implement**

1. Add the types, constants and `emitPoint` from Interfaces. `DEFAULT_FLAME_SIZE = Math.min(4 * 0.2, Math.min(1500, 1) * 0.003)` with a comment naming `Weapon.cpp:1229`, `WeaponDef.cpp:71` and `WeaponDef.cpp:417`.
2. Update the module doc comment to say it also draws the muzzle flame as `CMuzzleFlame` draws it and a neutral tracer the preview chose.
3. Restructure `particlesAt`: collect sprite values in plain arrays alongside the dot arrays. Loop the emissions and branch on `emission.kind`. The nano branch is today's loop body, unchanged. Add `flameSprites(emission, frame, smokeCount, out)` and `tracerSprites(emission, frame, out)` following the engine facts and preview choices above. Draw a flame's quads in the engine's order: for each `a`, the smoke quad then its flame quad.
4. `unitFloat(emission.seed, a)` stands in for `guRNG.NextFloat()` for quad `a`.
5. Return `sprites` built from the arrays as `Float32Array`s.

A tracer's quads sit at `TRACER_QUADS` evenly spaced distances from `head - TRACER_LENGTH` to `head`, where `head = (frame - birth) * TRACER_SPEED`, skipping any outside `[0, distance to target]`. It draws nothing before its birth, and nothing once `head - TRACER_LENGTH` is past the target.

- [ ] **Step 4: Run the tests**

Run: `bunx vitest run src/lego/effects.test.ts` then `bun run typecheck`
Expected: pass. The type check fails in `effectsLayer.dom.test.ts` if its `particles()` helper builds a `Particles` without `sprites`. Add `sprites` with empty arrays to that helper.

- [ ] **Step 5: Commit**

```bash
git add src/lego/effects.ts src/lego/effects.test.ts src/lego/pages/components/effectsLayer.dom.test.ts
git commit -m "Work out the muzzle flame and a tracer as sprites for any frame"
```

---

### Task 6: Draw sprites in the effects layer

**Files:**
- Modify: `src/lego/pages/components/effectsLayer.ts`
- Test: `src/lego/pages/components/effectsLayer.dom.test.ts`

**Interfaces:**
- Consumes: `Particles.sprites`, `BITMAP_*` from Task 5.
- Produces:

```ts
export interface EffectsAtlas {
  texture: THREE.Texture;
  /** UV rectangle per bitmap slot, [u0, v0, u1, v1], or null for a bitmap the
   *  game does not have, which draws as a soft round sprite. */
  rects: (readonly [number, number, number, number] | null)[];
  /** How many smoke bitmaps it holds. At least 1. */
  smokeCount: number;
}

export interface EffectsLayer {
  object: THREE.Mesh;          // the nano dots, as now
  sprites: THREE.Mesh;         // a child of `object`, so its visibility follows
  update(particles: Particles): void;
  setAtlas(atlas: EffectsAtlas | null): void;
  /** The atlas's smoke count, 1 with no atlas. */
  readonly smokeCount: number;
  dispose(): void;
}
```

Engine facts: particles are drawn with blend `ONE, ONE_MINUS_SRC_ALPHA`, depth test on and depth write off (`rts/Rendering/Env/Particles/ProjectileDrawer.cpp:802-807`). The quad's corners are the centre plus and minus the camera's right and up times the draw size (`MuzzleFlame.cpp:74-79`), which is a view-space offset.

- [ ] **Step 1: Write the failing tests**

Add to `effectsLayer.dom.test.ts`:

```ts
function withSprites(count: number, bitmap: number) {
  return {
    ...particles(0),
    sprites: {
      count,
      centers: new Float32Array(count * 3),
      halfSizes: new Float32Array(count).fill(2),
      colors: new Float32Array(count * 4).fill(1),
      bitmaps: new Float32Array(count).fill(bitmap),
    },
  };
}

function spriteGeometry(layer: ReturnType<typeof buildEffectsLayer>) {
  return layer.sprites.geometry as THREE.InstancedBufferGeometry;
}

describe("the sprite mesh", () => {
  it("hangs off the dots, so the effects toggle hides both", () => {
    const layer = buildEffectsLayer();
    expect(layer.sprites.parent).toBe(layer.object);
    expect(layer.sprites.frustumCulled).toBe(false);
    layer.dispose();
  });

  it("blends as the engine blends particles, with the depth test on and depth writes off", () => {
    const material = buildEffectsLayer().sprites.material as THREE.ShaderMaterial;
    expect(material.blending).toBe(THREE.CustomBlending);
    expect(material.blendSrc).toBe(THREE.OneFactor);
    expect(material.blendDst).toBe(THREE.OneMinusSrcAlphaFactor);
    expect(material.depthTest).toBe(true);
    expect(material.depthWrite).toBe(false);
  });

  it("draws as many sprites as it is given, growing past its first size", () => {
    const layer = buildEffectsLayer();
    layer.update(withSprites(3, 0));
    expect(spriteGeometry(layer).instanceCount).toBe(3);
    layer.update(withSprites(500, 0));
    expect(spriteGeometry(layer).instanceCount).toBe(500);
    layer.dispose();
  });

  it("looks each sprite's bitmap up in the atlas, and marks a missing one to draw soft and round", () => {
    const layer = buildEffectsLayer();
    layer.setAtlas({
      texture: new THREE.Texture(),
      rects: [[0, 0, 0.5, 0.5], null],
      smokeCount: 1,
    });
    layer.update(withSprites(1, 0));
    expect(Array.from(spriteGeometry(layer).getAttribute("uvRect").array).slice(0, 4)).toEqual([0, 0, 0.5, 0.5]);

    layer.update(withSprites(1, 1));
    expect(spriteGeometry(layer).getAttribute("uvRect").array[0]).toBeLessThan(0);
    layer.dispose();
  });

  it("applies a new atlas to the sprites it already has", () => {
    const layer = buildEffectsLayer();
    layer.update(withSprites(1, 0));
    expect(spriteGeometry(layer).getAttribute("uvRect").array[0]).toBeLessThan(0);

    layer.setAtlas({
      texture: new THREE.Texture(),
      rects: [[0.25, 0, 0.5, 0.5]],
      smokeCount: 3,
    });
    expect(spriteGeometry(layer).getAttribute("uvRect").array[0]).toBe(0.25);
    expect(layer.smokeCount).toBe(3);
    layer.dispose();
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `bunx vitest run src/lego/pages/components/effectsLayer.dom.test.ts`
Expected: FAIL, no `sprites`.

- [ ] **Step 3: Implement**

1. Keep the dot mesh exactly as it is.
2. Add a sprite geometry builder like `dotGeometry` with instanced attributes `center` (3), `halfSize` (1), `tint` (4) and `uvRect` (4).
3. Shaders:

```glsl
// vertex
attribute vec3 center;
attribute float halfSize;
attribute vec4 tint;
attribute vec4 uvRect;
varying vec4 vTint;
varying vec2 vUv;
varying vec2 vLocal;
varying float vRound;
void main() {
  vec4 view = modelViewMatrix * vec4(center, 1.0);
  view.xy += position.xy * halfSize;
  gl_Position = projectionMatrix * view;
  vTint = tint;
  vLocal = position.xy;
  vRound = uvRect.x < 0.0 ? 1.0 : 0.0;
  vUv = mix(uvRect.xy, uvRect.zw, position.xy * 0.5 + 0.5);
}
```

```glsl
// fragment
uniform sampler2D atlas;
varying vec4 vTint;
varying vec2 vUv;
varying vec2 vLocal;
varying float vRound;
void main() {
  vec4 texel;
  if (vRound > 0.5) {
    float a = clamp(1.0 - length(vLocal), 0.0, 1.0);
    texel = vec4(a * a);
  } else {
    texel = texture2D(atlas, vUv);
  }
  gl_FragColor = texel * vTint;
}
```

Comment the soft round sprite as the stand-in for a bitmap the game lacks, premultiplied because the blend treats colour as premultiplied. Comment that the colour goes out unconverted, as the dots' does.

4. Material: `CustomBlending`, `blendEquation: AddEquation`, `blendSrc: OneFactor`, `blendDst: OneMinusSrcAlphaFactor`, `transparent: true`, `depthTest: true`, `depthWrite: false`, uniform `atlas` holding a 1 by 1 white `THREE.DataTexture` (with `needsUpdate = true`) until `setAtlas` gives a real one.
5. The sprite mesh: `frustumCulled = false`, `renderOrder = 1`, added as a child of the dot mesh.
6. `update` writes the dot attributes as now, then the sprite attributes, growing the sprite geometry the same way. It keeps the last `bitmaps` array so `setAtlas` can refill `uvRect`.
7. `uvRect` for slot `s`: `atlas?.rects[s]` when it is a rectangle, else `[-1, -1, -1, -1]`.
8. `setAtlas(atlas)` sets the uniform (the white texture when `null`), remembers `smokeCount` (1 when `null`), and refills `uvRect` from the last bitmaps.
9. `dispose` disposes both geometries, both materials and the white texture. It does not dispose the atlas texture, which belongs to whoever loaded it.

- [ ] **Step 4: Run the tests**

Run: `bunx vitest run src/lego/pages/components/effectsLayer.dom.test.ts` then `bun run typecheck`
Expected: pass. The existing dot tests still pass.

- [ ] **Step 5: Commit**

```bash
git add src/lego/pages/components/effectsLayer.ts src/lego/pages/components/effectsLayer.dom.test.ts
git commit -m "Draw textured effect sprites with the engine's particle blend"
```

---

### Task 7: Resolve flares and shots to emissions

**Files:**
- Modify: `src/lego/pages/components/effectsPlayback.ts`
- Modify: `src/lego/pages/components/useScriptFrameStepping.ts` (both `placeEffects` calls, :117 and :183)
- Test: `src/lego/pages/components/ModelViewport.dom.test.tsx` (`describe("placeEffects")` :717)

**Interfaces:**
- Consumes: `FlameEmission`, `TracerEmission`, `emitPoint`, `DEFAULT_FLAME_SIZE`, `particlesAt(emissions, frame, smokeCount)` from Task 5, `state.effects.smokeCount` from Task 6, `StandInPlacement.aims` and `Aim` from Task 4, `bakedPieces` from `src/lego/s3oBuild.ts:93`.
- Produces:

```ts
/** A piece's vertices as the export writes them, in its own space, by name. */
export type PieceVertices = (piece: string) => Vec3[];

/** `PieceVertices` from the bake the exporter and playback share, worked out
 *  once for each project, pack and geometry. */
export function bakedVertices(project: LegoProject, pack: LoadedPack, raw: RawGeometry | null): PieceVertices;

export function placeEffects(
  state: SceneState,
  project: LegoProject,
  standIn: StandInPlacement,
  show: boolean,
  timeline: ScriptTimeline | null,
  frame: number,
  vertices: PieceVertices,
): void;
```

Rules, from the spec's section 2:
- A `flare` on frame N: `at` is the piece's origin in world space with the scene posed on frame N - 1 (`ShowFlare` takes `GetPiecePos`, `UnitScript.cpp:968-981`). `dir` is the latest `aims` entry with `frame <= N`, normalised, or up, `[0, 1, 0]`, when there is none, which is the unit's `lastMuzzleFlameDir` before any weapon fires (`Unit.h:332`). `size` is `DEFAULT_FLAME_SIZE`.
- A `shot` on frame N with a piece: `at` is that piece's emit point, `emitPoint(vertices(piece)).pos`, through the piece group's world matrix with the scene posed on frame N - 1. `to` is the stand-in's middle on frame N, as nano's target is read. No tracer when the placement has no track or the shot has no piece.
- Nano is unchanged, and only drawn when `standIn.nano` is set and there is a track.
- The cache per timeline is also dropped when `aims` or `vertices` change, compared by identity. `bakedVertices` returns the same function for the same project, pack and raw, so an unchanged project keeps the cache.

During playback each piece's group holds its baked geometry at its baked offset with no rotation (`bakedPlayback.ts:30-45`), so a baked vertex in the group's local space goes to the world through `group.matrixWorld`.

- [ ] **Step 1: Write the failing tests**

Update every existing `placeEffects(...)` call in `ModelViewport.dom.test.tsx` to pass a last argument `noVertices`, defined once in the `describe`:

```ts
    const noVertices: PieceVertices = () => [];
```

Then add inside `describe("placeEffects")`:

```ts
    function sprites(state: SceneState) {
      return state.effects.sprites.geometry as THREE.InstancedBufferGeometry;
    }

    const aiming: StandInPlacement = {
      ...beside,
      nano: null,
      aims: [{ frame: 0, dir: [0, 0, 1] }],
    };

    it("draws a muzzle flame at the flare piece on its frame, and gone a few frames later", () => {
      const state = sprayScene();
      const timeline = run(40, () => 0, [
        { frame: 5, kind: "flare", piece: "arm" },
      ]);
      placeEffects(state, doc, aiming, true, timeline, 5, noVertices);
      expect(sprites(state).instanceCount).toBeGreaterThan(0);
      const center = sprites(state).getAttribute("center").array;
      expectNear(center[0], 0, 6);
      expectNear(center[1], 4, 6);

      placeEffects(state, doc, aiming, true, timeline, 15, noVertices);
      expect(sprites(state).instanceCount).toBe(0);
    });

    it("draws a flame for a unit that sprays no nano", () => {
      const state = sprayScene();
      const timeline = run(40, () => 0, [
        { frame: 5, kind: "flare", piece: "arm" },
      ]);
      placeEffects(state, doc, { ...aiming, track: null }, true, timeline, 5, noVertices);
      expect(sprites(state).instanceCount).toBeGreaterThan(0);
    });

    it("runs a tracer from the shot piece's emit point to the stand-in", () => {
      const state = sprayScene();
      const timeline = run(40, () => 0, [
        { frame: 5, kind: "shot", weapon: 1, piece: "arm" },
      ]);
      // Two vertices, so the emit point is the first one, ten elmos up the
      // arm from its origin.
      const vertices: PieceVertices = (piece) =>
        piece === "arm"
          ? [
              [0, 10, 0],
              [0, 10, 1],
            ]
          : [];
      placeEffects(state, doc, aiming, true, timeline, 5, vertices);
      expect(sprites(state).instanceCount).toBeGreaterThan(0);
      const center = sprites(state).getAttribute("center").array;
      for (let i = 0; i < sprites(state).instanceCount; i++) {
        expect(center[i * 3 + 1]).toBeGreaterThanOrEqual(0);
      }
    });

    it("draws no tracer for a shot from no piece", () => {
      const state = sprayScene();
      const timeline = run(40, () => 0, [
        { frame: 5, kind: "shot", weapon: 1, piece: null },
      ]);
      placeEffects(state, doc, aiming, true, timeline, 5, noVertices);
      expect(sprites(state).instanceCount).toBe(0);
    });

    it("hides the flame with the effects toggle", () => {
      const state = sprayScene();
      const timeline = run(40, () => 0, [
        { frame: 5, kind: "flare", piece: "arm" },
      ]);
      placeEffects(state, doc, aiming, false, timeline, 5, noVertices);
      expect(state.effects.object.visible).toBe(false);
    });
```

Read the fixture first: `run`, `doc`, `standInScene` and `expectNear` are defined above in the file, and the arm's rest position is what puts the nozzle at y 4 in the nano tests. If the arm's world position differs, use the value the nano test uses for the nozzle. Import `PieceVertices` from `./effectsPlayback`.

Add a unit test for `bakedVertices` in the same `describe`, or in a new `effectsPlayback.test.ts` if it needs no DOM: it returns the same function for the same arguments, and a function that answers `[]` for a name that is not a piece.

- [ ] **Step 2: Run to verify they fail**

Run: `bunx vitest run src/lego/pages/components/ModelViewport.dom.test.tsx -t placeEffects`
Expected: FAIL.

- [ ] **Step 3: Implement**

1. `placeEffects` drops the early return on `!nano || !standIn.track`. It returns nothing drawn only when `!show` or there is no timeline. It passes `state.effects.smokeCount` to `particlesAt`.
2. `resolve` loops `timeline.events` once, as now, with a branch per kind. The nano branch keeps its current code, guarded by `nano && standIn.track`. Posing is shared: keep the `posed` frame and the `applyTimelineFrame` calls, and put the scene back at the end as now.
3. The `Resolved` record gains `aims` and `vertices`, compared by identity along with `radius` and `nano`. `nano` can now be `null` in it.
4. The flame direction search: the latest aim at or before the flare's frame. Aims come in frame order, so a forward scan keeping the last one that qualifies is enough.
5. `bakedVertices`: keep the last `(project, pack, raw)` and the function made from them in module variables, and return the same function when all three are the same objects. The function looks the piece up by name in the map `bakedPieces(project, pack, raw).pieces` (keyed by piece id, each value has `name` and `vertices` with `pos`), built once when the function is made.
6. `useScriptFrameStepping` passes `bakedVertices(projectRef.current, packRef.current, rawRef.current)` as the new last argument in both calls.
7. Update the module doc comment: it now also places the muzzle flame and the tracer.
8. One line in the code where the N - 1 pose is chosen: "A turn ... now in the same thread just before the output is missed, a known limit of reading the frame before."

- [ ] **Step 4: Run the tests**

Run: `bunx vitest run src/lego/pages/components/ModelViewport.dom.test.tsx` then `bun run typecheck`
Expected: pass, including every nano test.

- [ ] **Step 5: Commit**

```bash
git add src/lego/pages/components/effectsPlayback.ts src/lego/pages/components/useScriptFrameStepping.ts src/lego/pages/components/ModelViewport.dom.test.tsx
git commit -m "Place a muzzle flame at each flare and a tracer from each shot"
```

If a new `effectsPlayback.test.ts` was written, add it to the `git add` line.

---

### Task 8: A command that decodes a bitmap with its alpha

**Files:**
- Modify: `crates/tauri-plugin-coilbox-lego/src/lib.rs` (beside `lego_texture_png` :1729, and the `generate_handler!` list)
- Modify: `crates/tauri-plugin-coilbox-lego/build.rs` (`COMMANDS`)
- Modify: `crates/tauri-plugin-coilbox-lego/permissions/default.toml`
- Modify: `src/lego/bindings.ts` (beside `legoTexturePng` :579)

**Interfaces:**
- Produces:
  - Rust: `fn bitmap_png(hex: &str, file: &str) -> Result<(Vec<u8>, u32, u32), String>`, the PNG bytes with alpha kept, and the width and height.
  - Tauri: `lego_bitmap_png(hex: String, file: String) -> CliResult` answering `{ dataUrl, width, height }`.
  - TS: `export const legoBitmapPng = defineCommand<{ hex: string; file: string }, { dataUrl: string; width: number; height: number }>("coilbox-lego", "lego_bitmap_png");`

A particle bitmap's alpha is what the engine's blend reads, so it must survive. The archive preview's TGA path drops alpha on purpose for unit textures (`crates/coilbox-unitsync-worker/src/archive.rs:715-727`), which is why this is a new command. `coilbox_texture::decode(ext, bytes)` is the decoder every stored texture goes through, and `coilbox_texture::encode_png` and `coilbox_texture::png_data_url` exist (`crates/coilbox-texture/src/lib.rs:22,167,318`). Check `encode_png` writes RGBA. If it drops alpha, encode with `image::DynamicImage::ImageRgba8(img).write_to(..., ImageFormat::Png)` instead.

A new plugin command needs its name in `build.rs` `COMMANDS` and an allow entry in `permissions/default.toml`, or the frontend is refused at run time with no compile error. Follow `lego_texture_png` in both files. The command must answer a `CliResult` with `CliResult::ok(json!(...))`, as its neighbours do, because the frontend wrapper discards a bare value.

- [ ] **Step 1: Write the failing test**

In the `#[cfg(test)]` module of `crates/tauri-plugin-coilbox-lego/src/lib.rs` (create one at the end of the file if there is none, following the crate's other test modules):

```rust
    #[test]
    fn bitmap_png_keeps_alpha() {
        let mut tga = Vec::new();
        let img = image::RgbaImage::from_pixel(2, 1, image::Rgba([255, 128, 0, 64]));
        image::DynamicImage::ImageRgba8(img)
            .write_to(&mut std::io::Cursor::new(&mut tga), image::ImageFormat::Tga)
            .unwrap();
        let hex: String = tga.iter().map(|b| format!("{b:02x}")).collect();

        let (png, width, height) = bitmap_png(&hex, "flame.tga").unwrap();

        assert_eq!((width, height), (2, 1));
        let back = image::load_from_memory(&png).unwrap().to_rgba8();
        assert_eq!(back.get_pixel(0, 0).0, [255, 128, 0, 64]);
    }

    #[test]
    fn bitmap_png_refuses_what_is_not_hex() {
        assert!(bitmap_png("zz", "flame.tga").is_err());
    }
```

- [ ] **Step 2: Run to verify it fails**

Run: `cargo test -p tauri-plugin-coilbox-lego bitmap_png`
Expected: FAIL, `bitmap_png` does not exist.

- [ ] **Step 3: Implement**

```rust
/// A particle bitmap from a game archive, hex encoded, as a PNG with its alpha
/// kept, because the engine's particle blend reads it.
fn bitmap_png(hex: &str, file: &str) -> Result<(Vec<u8>, u32, u32), String> {
    if hex.len() % 2 != 0 {
        return Err(format!("{file} did not arrive as hex"));
    }
    let bytes = (0..hex.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&hex[i..i + 2], 16))
        .collect::<Result<Vec<u8>, _>>()
        .map_err(|_| format!("{file} did not arrive as hex"))?;
    let img = coilbox_texture::decode(&extension_of(Path::new(file)), &bytes)
        .ok_or_else(|| format!("coilbox cannot decode {file}"))?;
    let png = coilbox_texture::encode_png(&img)
        .ok_or_else(|| format!("could not encode {file} as a PNG"))?;
    Ok((png, img.width(), img.height()))
}

/// `lego_bitmap_png` decodes one particle bitmap for the preview's effects.
#[tauri::command]
async fn lego_bitmap_png(hex: String, file: String) -> CliResult {
    match bitmap_png(&hex, &file) {
        Ok((png, width, height)) => CliResult::ok(json!({
            "dataUrl": coilbox_texture::png_data_url(&png),
            "width": width,
            "height": height,
        })),
        Err(e) => CliResult::err(e),
    }
}
```

`hex[i..i + 2]` is safe because hex digits are ASCII, but a non-ASCII input would panic on a char boundary. Check `hex.is_ascii()` first and return the same error when it is not.

Register `lego_bitmap_png` in the plugin's `generate_handler!`, in `build.rs` `COMMANDS`, and in `permissions/default.toml`, each next to `lego_texture_png`. Add `legoBitmapPng` to `src/lego/bindings.ts` with a doc comment: "One particle bitmap from a game archive, hex encoded, decoded with its alpha kept as a PNG `data:` URL."

- [ ] **Step 4: Run the tests and a build that regenerates the permissions**

Run: `cargo test -p tauri-plugin-coilbox-lego bitmap_png` then `cargo build -p tauri-plugin-coilbox-lego`
Expected: pass. The build regenerates `permissions/autogenerated`. Check `git status` for new files there and include them in the commit.

- [ ] **Step 5: Commit**

```bash
cargo fmt --all
git add crates/tauri-plugin-coilbox-lego/src/lib.rs crates/tauri-plugin-coilbox-lego/build.rs crates/tauri-plugin-coilbox-lego/permissions src/lego/bindings.ts
git commit -m "Decode a particle bitmap with its alpha for the preview"
```

---

### Task 9: Load the game's bitmaps into an atlas

**Files:**
- Create: `src/lego/effectBitmaps.ts`
- Create: `src/lego/effectBitmaps.test.ts`
- Create: `src/lego/pages/components/useEffectBitmaps.ts`
- Modify: `src/lego/pages/BuilderPage.tsx` (where it renders `ModelViewport` and `AnimationPanel`)
- Modify: `src/lego/pages/components/ModelViewport.tsx` (new prop, and an effect that calls `setAtlas`)
- Modify: `src/lego/pages/components/AnimationPanel.tsx` (new prop, shown with the other notes)

**Interfaces:**
- Consumes: `unitsyncLuaExec` (`src/content/bindings.ts:2532`, answers `{ result?: string; error?: string; errors: string[] }` where `result` is the returned value pretty printed, a string coming back `%q` quoted), `legoBitmapPng` from Task 8, `EffectsAtlas` and `setAtlas` from Task 6, `BITMAP_*` from Task 5, `project.imported?.game?.archive` (`src/lego/model.ts:149-161`), `usePreferredTarget` from `@/play/config` (see `src/blueprint/useShippedEquivalents.ts:36-41` for how it is used).
- Produces, from `src/lego/effectBitmaps.ts`:

```ts
/** The Lua that finds and reads the bitmaps, run with the game mounted. */
export const RESOURCES_LUA: string;

export interface BitmapFile {
  /** "muzzleflame", "laserfalloff", or "smoke1", "smoke2" and so on. */
  key: string;
  /** The name under `bitmaps/`, or null when the game names none. */
  file: string | null;
  /** The file's bytes as hex, or null when it is not in the game. */
  hex: string | null;
}
export function parseBitmaps(result: string | undefined): BitmapFile[];

/** The atlas slot a key goes in: BITMAP_MUZZLE_FLAME, BITMAP_LASER, or
 *  BITMAP_SMOKE + n - 1 for smoke n. */
export function slotOf(key: string): number;

export interface ShelfRect { slot: number; x: number; y: number; width: number; height: number }
export function packShelves(
  sizes: { slot: number; width: number; height: number }[],
): { width: number; height: number; rects: ShelfRect[] };

export interface EffectBitmaps {
  atlas: EffectsAtlas | null;
  /** What the panel says about the bitmaps, or null when every one loaded. */
  note: string | null;
}
export function missingNote(missing: string[]): string | null;
export async function loadEffectBitmaps(
  target: { enginePath: string; dataDir: string },
  archive: string,
): Promise<EffectBitmaps>;
```

- `useEffectBitmaps(project: LegoProject): EffectBitmaps` in `src/lego/pages/components/useEffectBitmaps.ts`.
- `ModelViewport` prop `effectsAtlas?: EffectsAtlas | null`. `AnimationPanel` prop `effectsNote?: string | null`.

Engine facts:
- `ProjectileDrawer` reads `gamedata/resources.lua` from the game with the base content under it, `graphics.projectileTextures` and `graphics.smoke`, and prefixes `bitmaps/` (`rts/Rendering/Env/Particles/ProjectileDrawer.cpp:98-150`). The muzzle flame's bitmap is `muzzleflametexture`, with `explo` as its backup (`ProjectileDrawer.cpp:231`). The laser's is `laserfalloff` (`:216`). Without a smoke table it uses `smoke/smoke00.tga` to `smoke11.tga` (`:137-145`).
- The base content's `resources.lua` parses the game's `resources.tdf` if it has one, and otherwise uses defaults that include `explo = 'explo.tga'` and `laserfalloff = 'laserfalloff.tga'` (`cont/base/springcontent/gamedata/resources.lua:14-20,97-112`).
- Lua table keys are compared lower case, because the engine's `LuaTable` lower-cases them.
- unitsync's Lua parser has `VFS.Include`, `VFS.LoadFile`, `VFS.FileExists`, `VFS.DirList` and `VFS.SubDirs` (`rts/Lua/LuaParser.cpp:182-191`). `unitsyncLuaExec` mounts the archive with its dependencies (`crates/tauri-plugin-coilbox-unitsync/src/lib.rs:1492-1497`).

`RESOURCES_LUA`:

```lua
local function field(t, key)
  if type(t) ~= 'table' then return nil end
  for k, v in pairs(t) do
    if type(k) == 'string' and string.lower(k) == key then return v end
  end
  return nil
end

-- The engine reads gamedata/resources.lua through the game and the base
-- content under it (ProjectileDrawer.cpp:98). With neither, these are the
-- base content's defaults (springcontent/gamedata/resources.lua:97-112).
local textures = { explo = 'explo.tga', laserfalloff = 'laserfalloff.tga' }
local smoke = nil
if VFS.FileExists('gamedata/resources.lua') then
  local ok, res = pcall(VFS.Include, 'gamedata/resources.lua')
  if ok then
    local graphics = field(res, 'graphics')
    textures = field(graphics, 'projectiletextures') or {}
    smoke = field(graphics, 'smoke')
  end
end

local function hex(file)
  local path = 'bitmaps/' .. file
  if not VFS.FileExists(path) then return '' end
  local data = VFS.LoadFile(path)
  if not data then return '' end
  return (string.gsub(data, '.', function(c)
    return string.format('%02x', string.byte(c))
  end))
end

local out = {}
local function add(key, file)
  if type(file) ~= 'string' then file = nil end
  out[#out + 1] = key .. '|' .. (file or '') .. '|' .. (file and hex(file) or '')
end

add('muzzleflame', field(textures, 'muzzleflametexture') or field(textures, 'explo'))
add('laserfalloff', field(textures, 'laserfalloff'))
if type(smoke) == 'table' and #smoke > 0 then
  for i = 1, #smoke do add('smoke' .. i, smoke[i]) end
else
  for i = 0, 11 do add('smoke' .. (i + 1), string.format('smoke/smoke%02d.tga', i)) end
end
return table.concat(out, ';')
```

This file is Lua in a TypeScript string, so the humanize hook's comment rules apply to the Lua comments too. No semicolons in them.

`parseBitmaps`: trim, strip one leading and one trailing `"`, turn `\\` into `\` and `\"` into `"`, split on `;`, then each entry on `|` into key, file and hex, with an empty string meaning null. Skip entries with no key.

`missingNote(missing)`: null for an empty list, otherwise `The game has no ${list}, so those are drawn as a plain round sprite.` where `list` joins the names with commas and "and" before the last. A missing entry is named `bitmaps/<file>` when it has a file and by its key when it has none (a game whose resources name no muzzle flame bitmap).

`loadEffectBitmaps`:
1. Run `unitsyncLuaExec({ ...target, archive, source: RESOURCES_LUA })`. On `error`, answer `{ atlas: null, note: "Could not read the game's bitmaps, so effects are drawn as a plain round sprite: <error>" }`.
2. `parseBitmaps(result)`. For each entry with hex, `legoBitmapPng({ hex, file })`, then load the `dataUrl` into an `HTMLImageElement` and await `decode()`. An entry whose decode fails counts as missing.
3. `packShelves` the loaded images' sizes, draw each into one canvas at its rect, make a `THREE.CanvasTexture` from the canvas with `flipY = false` and `needsUpdate = true`.
4. `rects[slot] = [x / W, y / H, (x + width) / W, (y + height) / H]` for each loaded image, null for the rest. The array's length is `BITMAP_SMOKE + smokeCount`.
5. `smokeCount` is the number of smoke entries, at least 1.
6. The note is `missingNote(...)` over the missing entries.

`packShelves`: sort by height, tallest first. The atlas width is the larger of the widest image and the square root of the total area of the padded images, rounded up. Place images left to right in rows with one pixel of space between neighbours and rows, starting a new row when the next image would not fit. The height is where the last row ends. The pixel between images is there so linear filtering never samples a neighbour. Say so in a comment.

`useEffectBitmaps(project)`:
- No `project.imported?.game`: `{ atlas: null, note: "This unit has no game, so its effects are drawn as a plain round sprite." }`.
- No target from `usePreferredTarget`: `{ atlas: null, note: "There is no engine set up to read the game's bitmaps, so effects are drawn as a plain round sprite." }`.
- Otherwise run `loadEffectBitmaps` in an effect keyed on the archive, `enginePath` and `dataDir`, with a `live` flag so a late answer for an old project is dropped. A thrown error becomes the "Could not read" note. Dispose the previous atlas texture when a new one replaces it and on unmount.

Wiring:
- `BuilderPage.tsx`: `const effectBitmaps = useEffectBitmaps(project);`, pass `effectsAtlas={effectBitmaps.atlas}` to `ModelViewport` and `effectsNote={effectBitmaps.note}` to `AnimationPanel`.
- `ModelViewport.tsx`: `useEffect(() => { const state = sceneRef.current; if (!state) return; state.effects.setAtlas(effectsAtlas ?? null); state.render(); }, [effectsAtlas])`. Put it next to the other effects wiring. Check `state.render` is the right call by reading how the viewport renders after other one-off changes.
- `AnimationPanel.tsx`: show `effectsNote` with the run's other notes (find where `standInNotes` and `timeline.warnings` render, around :886), only when the current timeline has a `flare` or `shot` event, since nothing else in PR B uses a bitmap.

- [ ] **Step 1: Write the failing tests**

`src/lego/effectBitmaps.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { BITMAP_LASER, BITMAP_MUZZLE_FLAME, BITMAP_SMOKE } from "./effects";
import {
  missingNote,
  packShelves,
  parseBitmaps,
  slotOf,
} from "./effectBitmaps";

describe("parseBitmaps", () => {
  it("reads each bitmap's key, file and bytes from the quoted result", () => {
    const result =
      '"muzzleflame|explo.tga|00ff;laserfalloff||;smoke1|smoke\\\\smoke00.tga|"';
    expect(parseBitmaps(result)).toEqual([
      { key: "muzzleflame", file: "explo.tga", hex: "00ff" },
      { key: "laserfalloff", file: null, hex: null },
      { key: "smoke1", file: "smoke\\smoke00.tga", hex: null },
    ]);
  });

  it("reads nothing from no result", () => {
    expect(parseBitmaps(undefined)).toEqual([]);
  });
});

describe("slotOf", () => {
  it("puts each bitmap in its atlas slot", () => {
    expect(slotOf("muzzleflame")).toBe(BITMAP_MUZZLE_FLAME);
    expect(slotOf("laserfalloff")).toBe(BITMAP_LASER);
    expect(slotOf("smoke1")).toBe(BITMAP_SMOKE);
    expect(slotOf("smoke3")).toBe(BITMAP_SMOKE + 2);
  });
});

describe("missingNote", () => {
  it("says nothing when every bitmap loaded", () => {
    expect(missingNote([])).toBeNull();
  });

  it("names the missing bitmaps", () => {
    expect(missingNote(["bitmaps/laserfalloff.tga"])).toBe(
      "The game has no bitmaps/laserfalloff.tga, so those are drawn as a plain round sprite.",
    );
    expect(missingNote(["a", "b", "c"])).toBe(
      "The game has no a, b and c, so those are drawn as a plain round sprite.",
    );
  });
});

describe("packShelves", () => {
  it("places every image without overlap, a pixel apart", () => {
    const sizes = [
      { slot: 0, width: 64, height: 64 },
      { slot: 1, width: 16, height: 128 },
      { slot: 2, width: 32, height: 32 },
      { slot: 3, width: 32, height: 32 },
    ];
    const { width, height, rects } = packShelves(sizes);
    expect(rects).toHaveLength(4);
    for (const rect of rects) {
      expect(rect.x + rect.width).toBeLessThanOrEqual(width);
      expect(rect.y + rect.height).toBeLessThanOrEqual(height);
    }
    for (const a of rects) {
      for (const b of rects) {
        if (a === b) continue;
        const apart =
          a.x + a.width + 1 <= b.x ||
          b.x + b.width + 1 <= a.x ||
          a.y + a.height + 1 <= b.y ||
          b.y + b.height + 1 <= a.y;
        expect(apart).toBe(true);
      }
    }
  });
});
```

The spec's test 6 asks for a resources test against a stub `unitsync_lua_exec` result. Add one for `loadEffectBitmaps` with `vi.mock("@/content/bindings", ...)` answering a result whose `laserfalloff` has no bytes, and `vi.mock("./bindings", ...)` for `legoBitmapPng`. Assert the note names `bitmaps/laserfalloff.tga`. If loading an image in happy-dom never resolves, move the image-and-canvas step behind a small exported function the test can mock with `vi.spyOn`, rather than skipping the test.

- [ ] **Step 2: Run to verify they fail**

Run: `bunx vitest run src/lego/effectBitmaps.test.ts`
Expected: FAIL, the module does not exist.

- [ ] **Step 3: Implement** `effectBitmaps.ts`, `useEffectBitmaps.ts` and the wiring as specified above.

- [ ] **Step 4: Run the tests**

Run: `bunx vitest run src/lego/effectBitmaps.test.ts src/lego/pages/components/ModelViewport.dom.test.tsx src/lego/pages/components/AnimationPanel.dom.test.tsx` then `bun run typecheck` then `bunx biome ci .`
Expected: pass. If `AnimationPanel.dom.test.tsx` or `ModelViewport.dom.test.tsx` renders the components without the new props, the props are optional and nothing should change.

- [ ] **Step 5: Commit**

```bash
git add src/lego/effectBitmaps.ts src/lego/effectBitmaps.test.ts src/lego/pages/components/useEffectBitmaps.ts src/lego/pages/BuilderPage.tsx src/lego/pages/components/ModelViewport.tsx src/lego/pages/components/AnimationPanel.tsx
git commit -m "Draw effects with the unit's game's own bitmaps, and say which it lacks"
```

---

### Task 10: The full check suite and the on-screen check (lead only)

Not for a subagent. The lead does this.

- [ ] Run all seven CI commands: `bunx biome ci .`, `bun run typecheck`, `bun run test`, `scripts/mission-tests.sh`, `cargo fmt --all --check`, `cargo clippy --all-targets -- -D warnings`, `cargo test --workspace`.
- [ ] Run the parity sweep against Balanced Annihilation if a checkout is on disk, with `COILBOX_BOS_SWEEP` pointing at its scripts. Report its line counts.
- [ ] Start a portable instance on port 1433 with the MCP socket at `/tmp/tauri-mcp-nano.sock`, following "Driving the app" in `CLAUDE.md`. Drive it with a second MCP server over stdio.
- [ ] Screenshots: a Balanced Annihilation unit with a flare under `firing`, the flame on the firing frame, the tracer a frame or two later, and the same frame scrubbed to twice. A unit with no game, to show the round sprite and the panel note.
- [ ] Revert the port and socket edits, remove `target/debug/.coilbox/profile.json`, and stop the instance.
