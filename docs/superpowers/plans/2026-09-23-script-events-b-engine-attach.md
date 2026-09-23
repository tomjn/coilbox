# Script events, part B: the engine's attach and detach, and the Hulk's full cycle

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A scenario event can have the engine attach or detach the stand-in itself, asking the script's `QueryTransport` for the piece at the moment it attaches, so air transports ride the real per-call answer in both runtimes. `transport-pickup` gains a `TransportDrop`, and BA's Hulk plays its whole cycle: reach out, lift to the pad, hide, reach out again, put down.

**Architecture:** `ScriptEvent` gains `engine: "attach" | "detach"` and its `callin` becomes optional. Each runtime handles an engine event in `fire_due`: attach runs `QueryTransport` inline, as the engine's `Call` does, and attaches through part A's `Model::attach_unit`. Detach goes through `Model::drop_unit`. Both push the same attach and drop events a script's own calls do, so part C draws them with no change. The transport scenarios move to engine events, and the probe `attach` with `follow: true` goes, along with the drawing and world code only it used.

**Tech Stack:** Rust (`coilbox-unitpose`, `tauri-plugin-coilbox-anim`, `coilbox-springlua`), TypeScript, React 19, vitest, bun, the Tauri MCP for the end-to-end check.

**Spec:** `docs/superpowers/specs/2026-09-23-script-events-design.md`, sections 3 and 6 and testing items 4 and 7. Read it first.

**Depends on:** part A and part C merged. The spec says B and C each need only A. B also needs C, for two reasons. B takes `transport-load` and `transport-unload` off the probe `attach` with `follow: true`, which is what draws them until C's `passengerAt` does. And section 6's keys after the drop use C's `fromRelease`. Landing B first would leave the air transports drawn off their pieces until C merged.

## Global constraints

- Before any push, run all seven CI commands from the repo root and confirm each passes: `bunx biome ci .`, `bun run typecheck`, `bun run test`, `scripts/mission-tests.sh`, `cargo fmt --all --check`, `cargo clippy --all-targets -- -D warnings`, `cargo test --workspace`. `luajit` must be on PATH.
- Let rustfmt own formatting. Run `cargo fmt --all` rather than formatting by hand.
- Do not `git rebase`. Update a branch by merging `origin/main` into it.
- Do not use worktrees. Work in the primary checkout.
- `git add` named files only. Never `git add -A`.
- Filing the PR goes through the `file-pr` skill, and the user approves the description before it is created. Give the user a chance to run `bun tauri dev` first.
- Comments match the surrounding code and cite the engine file and line a behaviour comes from.
- Notes shown to the user are plain English, sentence case, and have no semicolons.
- No number in a scenario is guessed. The Hulk's frames come from running it (Task B6).
- Read "Driving the app" in `CLAUDE.md` before starting an instance. Never drive, stop or resize an app you did not start.

## Settled here, beyond the spec

- **`callin` stays a `String` in Rust, defaulting to empty.** It is optional on the wire, which is what the TypeScript mirror needs, and an engine event is the only one without it. An `Option<String>` would change 49 `ScriptEvent` literals from `callin: "X".into()` to `callin: Some(...)` for nothing. Every literal still gains `engine: None`, because a struct literal has to name every field.
- **COB's `QueryTransport` is handed `[0, height * 65536]`.** `callinArgs[0]` in `CobInstance.cpp:363-374` is the argument count, not an argument, and `Start` copies from `args[1]` (`CobThread.cpp:147-170`). The first argument starts at 0. The answer is 2 only when there is no `QueryTransport`, or it waits rather than finishing in one tick, because only then are the arguments left untouched (`CobInstance.cpp:564-622`).
- **A COB `QueryTransport` that waits keeps running** as an ordinary thread, as `RealCall` hands it to `AddThread` (`CobInstance.cpp:620`).
- **Lua's `QueryTransport` is called with the stand-in's id and its answer less one**, and a missing function, an error or a non-number answer is -1, the void (`LuaUnitScript.cpp:505-519,535-550,794-797`). It is called directly, not as a coroutine, as the probe already calls it.
- **`StandInAttach.follow` goes.** With `QueryTransport` gone, every attach left is a factory's build spot, which never follows. The `follow: true` branch in `placeStandIn` and the `fromRelease` fallback to the attach piece, both from part C, go with it. `worldAt` keeps its rule that a stand-in is not on the build piece on the attach's own frame. That rule came from the air arm (`MobileCAI.cpp:1451-1453`) and is left as it is for the factory, not changed in passing.
- **`TransportDrop`'s position is resolved from the track** by a new `dropAtStandIn: { frame }` marker, as `aimAtStandIn` is. Track keys are in the stand-in's radius, which depends on the unit, so a literal position in elmos would be right for one unit only.

## Branch

`script-events-engine-attach`, off `main` once parts A and C have merged.

```bash
git fetch origin
git checkout -b script-events-engine-attach origin/main
```

---

### Task B1: an event the engine acts on

**Files:**
- Modify: `crates/coilbox-unitpose/src/lib.rs:36-65` (`ScriptEvent`) and `mod world_tests`
- Modify, literals only: every `ScriptEvent { ... }` in `crates/` and `src-tauri/`

**Interfaces:**
- Produces:
  ```rust
  #[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
  #[serde(rename_all = "lowercase")]
  pub enum EngineAction { Attach, Detach }
  ```
  `ScriptEvent::engine: Option<EngineAction>`, and `ScriptEvent::callin` now `#[serde(default)]`.

- [ ] **Step 1: Write the failing test**

In `mod world_tests`:

```rust
    /// An event the engine acts on carries no call-in at all.
    #[test]
    fn reads_an_event_the_engine_acts_on() {
        let attach: ScriptEvent =
            serde_json::from_str(r#"{ "frame": 120, "engine": "attach" }"#).unwrap();
        assert_eq!(attach.engine, Some(EngineAction::Attach));
        assert_eq!(attach.callin, "");
        let detach: ScriptEvent =
            serde_json::from_str(r#"{ "frame": 330, "engine": "detach" }"#).unwrap();
        assert_eq!(detach.engine, Some(EngineAction::Detach));
        let plain: ScriptEvent =
            serde_json::from_str(r#"{ "frame": 0, "callin": "Create" }"#).unwrap();
        assert_eq!(plain.engine, None);
    }
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cargo test -p coilbox-unitpose world_tests`
Expected: compile error, no field `engine`.

- [ ] **Step 3: Add the field**

In `ScriptEvent`, replace the `callin` field and add `engine` after `world`:

```rust
    /// The call-in's name, such as `Create` or `AimWeapon1`. Empty on an event
    /// the engine acts on rather than calling into the script for.
    #[serde(default)]
    pub callin: String,
```

```rust
    /// Something the engine does to the stand-in itself, rather than a call-in
    /// it fires. Such an event has no `callin`.
    #[serde(default)]
    pub engine: Option<EngineAction>,
```

After `ScriptEvent`:

```rust
/// What the engine does to the stand-in without the script asking.
///
/// The air transport arm attaches a passenger to the piece `QueryTransport`
/// answers, and detaches it again, itself
/// (`rts/Sim/Units/CommandAI/MobileCAI.cpp:1451-1453,2041-2042,2090-2091`).
/// Every other transport leaves both to its script.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum EngineAction {
    Attach,
    Detach,
}
```

Re-export it beside `ScriptEvent` in `crates/coilbox-springlua/src/unitscript.rs:37`: `pub use coilbox_unitpose::{EngineAction, Rest, ScriptEvent, Timeline, FPS, MAX_FRAMES};`.

- [ ] **Step 4: Add `engine: None` to every literal**

Run: `cargo check --workspace --all-targets --examples 2>&1 | grep -B2 -A6 "missing field .engine"`
Expected: one error per `ScriptEvent { ... }` literal. The files holding them today are `crates/coilbox-springlua/tests/unit_sweep.rs`, `crates/coilbox-springlua/src/unitscript_tests.rs`, `crates/coilbox-unitpose/src/lib.rs`, `crates/coilbox-bos2lua/tests/{simplify,convert,prune,language,removed_values,sweep}.rs`, `crates/coilbox-bos2lua/examples/run.rs`, `crates/tauri-plugin-coilbox-anim/src/{cobrun_tests,bos2lua_parity}.rs`, and any in `src-tauri/` or the plugin's `lib.rs`. Add `engine: None,` after the `world` field in each. Repeat the check until it is clean.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cargo test -p coilbox-unitpose && cargo check --workspace --all-targets --examples`
Expected: pass, and clean.

- [ ] **Step 6: Commit**

Add each file the check named, then:

```bash
git commit -m "Let a scenario event be something the engine does to the stand-in"
```

---

### Task B2: the compiled runtime attaches and detaches for the engine

**Files:**
- Modify: `crates/tauri-plugin-coilbox-anim/src/cobrun.rs` (`fire_due` at 437-483, new `engine` and `query_transport` methods, the `cob_args` doc comment at 216-217)
- Test: `crates/tauri-plugin-coilbox-anim/src/cobrun_tests.rs`, new `mod engine_attach`

**Interfaces:**
- Consumes: `EngineAction` (B1), `Run::attach(unit, piece)` and the `Model` methods (part A).
- Produces: `Run::engine(&mut self, action: EngineAction) -> Result<(), String>`, `Run::query_transport(&mut self, height: f64) -> Result<i32, String>`.

- [ ] **Step 1: Write the failing tests**

```rust
mod engine_attach {
    use super::*;
    use coilbox_unitpose::{EngineAction, ScriptOutput};

    fn scene(height: f64) -> coilbox_unitpose::World {
        coilbox_unitpose::World {
            stand_in: Some(coilbox_unitpose::StandIn {
                id: 2,
                pos: Some([30.0, 0.0, 40.0]),
                radius: 5.0,
                height,
            }),
            own: coilbox_unitpose::Size {
                radius: 10.0,
                height: 12.0,
            },
        }
    }

    fn engine(frame: u32, action: EngineAction, world: Option<coilbox_unitpose::World>) -> ScriptEvent {
        ScriptEvent {
            frame,
            callin: String::new(),
            args: Vec::new(),
            ambient: false,
            world,
            engine: Some(action),
        }
    }

    fn carried(bytes: &[u8], events: &[ScriptEvent]) -> Timeline {
        run(bytes, &model_pieces(), events, 6, &[], &HashMap::new())
    }

    /// `QueryTransport(piecenum, height)` claims both arguments and sets the
    /// first, which is how a COB call-in answers.
    fn answers(piece: u32) -> Vec<u8> {
        let mut words = vec![op("CREATE_LOCAL_VAR"), op("CREATE_LOCAL_VAR")];
        words.extend(push(piece));
        words.extend([op("POP_LOCAL_VAR"), 0, op("RETURN")]);
        build(&[("QueryTransport", words)], PIECES, 0)
    }

    #[test]
    fn asks_query_transport_straight_away_and_attaches_there() {
        let timeline = carried(&answers(1), &[engine(0, EngineAction::Attach, Some(scene(6.0)))]);

        assert_eq!(timeline.error, None);
        assert_eq!(
            timeline.events,
            [ScriptOutput::Attach { frame: 0, unit: 2, piece: Some("turret".to_string()) }]
        );
        assert!(!timeline.warnings.iter().any(|w| w.contains("QueryTransport")), "{:?}", timeline.warnings);
    }

    /// `CobInstance.cpp:368-370`: the passenger's height in 65536ths.
    #[test]
    fn hands_query_transport_the_height_in_65536ths() {
        let mut words = vec![op("CREATE_LOCAL_VAR"), op("CREATE_LOCAL_VAR")];
        words.extend([op("PUSH_LOCAL_VAR"), 1]);
        words.extend(push(65536));
        words.extend([op("DIV"), op("POP_LOCAL_VAR"), 0, op("RETURN")]);
        let bytes = build(&[("QueryTransport", words)], PIECES, 0);
        let timeline = carried(&bytes, &[engine(0, EngineAction::Attach, Some(scene(2.0)))]);

        assert_eq!(
            timeline.events,
            [ScriptOutput::Attach { frame: 0, unit: 2, piece: Some("barrel".to_string()) }]
        );
    }

    /// With no `QueryTransport` the engine's arguments are left as they were,
    /// and the first of them is the count, 2 (`CobInstance.cpp:564-579`).
    #[test]
    fn a_missing_query_transport_answers_script_piece_two() {
        let timeline = carried(&create_only(vec![op("RETURN")]), &[engine(0, EngineAction::Attach, Some(scene(6.0)))]);

        assert_eq!(
            timeline.events,
            [ScriptOutput::Attach { frame: 0, unit: 2, piece: Some("barrel".to_string()) }]
        );
        assert!(timeline.warnings.iter().any(|w| w.contains("no QueryTransport")));
    }

    /// A call that does not finish in one tick leaves the arguments alone too
    /// (`CobInstance.cpp:590-622`).
    #[test]
    fn a_query_transport_that_waits_answers_script_piece_two() {
        let mut words = vec![op("CREATE_LOCAL_VAR"), op("CREATE_LOCAL_VAR")];
        words.extend(push(100));
        words.push(op("SLEEP"));
        words.extend(push(0));
        words.extend([op("POP_LOCAL_VAR"), 0, op("RETURN")]);
        let bytes = build(&[("QueryTransport", words)], PIECES, 0);
        let timeline = carried(&bytes, &[engine(0, EngineAction::Attach, Some(scene(6.0)))]);

        assert_eq!(
            timeline.events,
            [ScriptOutput::Attach { frame: 0, unit: 2, piece: Some("barrel".to_string()) }]
        );
        assert!(timeline.warnings.iter().any(|w| w.contains("waited")));
    }

    /// `DetachUnitFromAir` (`MobileCAI.cpp:2090-2091`).
    #[test]
    fn detaches_when_the_engine_says() {
        let timeline = carried(
            &answers(1),
            &[
                engine(0, EngineAction::Attach, Some(scene(6.0))),
                engine(3, EngineAction::Detach, Some(scene(6.0))),
            ],
        );

        assert_eq!(timeline.events[1], ScriptOutput::Drop { frame: 3, unit: 2 });
    }

    #[test]
    fn needs_a_stand_in_to_carry() {
        let timeline = carried(&answers(1), &[engine(0, EngineAction::Attach, None)]);

        assert!(timeline.events.is_empty());
        assert!(timeline.warnings.iter().any(|w| w.contains("no stand-in")));
    }
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cargo test -p tauri-plugin-coilbox-anim engine_attach`
Expected: FAIL. Each engine event currently goes looking for a call-in named `""`, which `ambient: false` turns into "This script has no  call-in."

- [ ] **Step 3: Handle engine events**

Import `EngineAction` in the `use coilbox_unitpose::{...}` line at the top of `cobrun.rs`.

In `fire_due`, straight after the `if let Some(world) = &event.world { ... }` block:

```rust
            if let Some(action) = event.engine {
                self.engine(action)?;
                continue;
            }
```

Add to the first `impl Run` block, after `fire_due`:

```rust
    /// What the engine does to the stand-in itself: the air transport arm's
    /// attach and detach (`rts/Sim/Units/CommandAI/MobileCAI.cpp:1451-1453,2090-2091`).
    fn engine(&mut self, action: EngineAction) -> Result<(), String> {
        let Some(stand_in) = self.world.as_ref().and_then(|world| world.stand_in) else {
            self.model.note(
                "The scenario has the engine carry the stand-in, and there is no stand-in in the scene.".to_string(),
            );
            return Ok(());
        };
        match action {
            EngineAction::Attach => {
                let piece = self.query_transport(stand_in.height)?;
                self.attach(stand_in.id, piece);
            }
            EngineAction::Detach => {
                self.model
                    .drop_unit(self.frame, stand_in.id, self.world.as_ref());
            }
        }
        Ok(())
    }

    /// Ask `QueryTransport` for the piece to carry the stand-in on, straight
    /// away, as the engine's `Call` does.
    ///
    /// COB hands it the passenger's height in 65536ths and reads the answer
    /// back out of its first argument (`rts/Sim/Units/Scripts/CobInstance.cpp:363-374`).
    /// The engine's argument array starts with its count, 2, and a script
    /// with no `QueryTransport`, or one that waits rather than finishing in one
    /// tick, leaves it there (`CobInstance.cpp:564-622`). So those answer
    /// script piece 2.
    fn query_transport(&mut self, height: f64) -> Result<i32, String> {
        const UNANSWERED: i32 = 2;
        let Some(function) = self.program.script("QueryTransport") else {
            self.model.note(
                "This script has no QueryTransport call-in, so the stand-in rides script piece 2, which is what the engine answers for it.".to_string(),
            );
            return Ok(UNANSWERED);
        };
        let mut thread = Thread::new(
            function,
            self.program.offsets[function],
            0,
            "QueryTransport".into(),
        );
        thread.data = vec![0, (height * COBSCALE) as i32];
        thread.params = 2;
        self.add(thread)?;
        let index = self.threads.len() - 1;
        self.step_thread(index)?;
        for thread in std::mem::take(&mut self.queued) {
            self.add(thread)?;
        }
        if matches!(self.threads[index].state, State::Dead) {
            return Ok(self.threads[index].data.first().copied().unwrap_or(0));
        }
        // Still running, as the engine leaves it (`CobInstance.cpp:620`).
        self.model.note(
            "QueryTransport waited rather than answering, so the stand-in rides script piece 2, which is what the engine answers for it.".to_string(),
        );
        Ok(UNANSWERED)
    }
```

Replace the doc comment's last paragraph on `cob_args` (216-217, "`QueryTransport` is not here...") with: "`QueryTransport` is not here. It is never fired as an event: the engine asks it for a piece when it attaches, which `Run::query_transport` does."

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cargo test -p tauri-plugin-coilbox-anim`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add crates/tauri-plugin-coilbox-anim/src/cobrun.rs crates/tauri-plugin-coilbox-anim/src/cobrun_tests.rs
git commit -m "Attach and detach for the engine in the compiled runtime, asking QueryTransport when it does"
```

---

### Task B3: the Lua runtime attaches and detaches for the engine

**Files:**
- Modify: `crates/coilbox-springlua/src/unitscript.rs` (`fire_due` at 574-604, new `engine` and `query_transport` methods on `Run`)
- Test: `crates/coilbox-springlua/src/unitscript_tests.rs`, new `mod engine_attach`

**Interfaces:**
- Consumes: `EngineAction` (B1), the `Model` methods (part A), `describe(&mlua::Error) -> String` at 799.
- Produces: `Run::engine(&mut self, action: EngineAction)`, `Run::query_transport(&mut self, passenger: i32) -> i64`.

- [ ] **Step 1: Write the failing tests**

```rust
mod engine_attach {
    use super::*;
    use coilbox_unitpose::ScriptOutput;

    fn scene() -> coilbox_unitpose::World {
        coilbox_unitpose::World {
            stand_in: Some(coilbox_unitpose::StandIn {
                id: 2,
                pos: Some([30.0, 0.0, 40.0]),
                radius: 5.0,
                height: 6.0,
            }),
            own: coilbox_unitpose::Size {
                radius: 10.0,
                height: 12.0,
            },
        }
    }

    fn engine(frame: u32, action: EngineAction) -> ScriptEvent {
        ScriptEvent {
            frame,
            callin: String::new(),
            args: Vec::new(),
            ambient: false,
            world: Some(scene()),
            engine: Some(action),
        }
    }

    fn carried(script: &str, events: &[ScriptEvent]) -> Timeline {
        run(script, "test.lua", &Unit::new(&pieces()), events, 6, &HashMap::new())
    }

    #[test]
    fn asks_query_transport_with_the_passenger_s_id() {
        let timeline = carried(
            r#"
            local base, turret = piece("base", "turret")
            function script.QueryTransport(passenger)
                if passenger == 2 then return turret end
                return base
            end
            "#,
            &[engine(0, EngineAction::Attach)],
        );

        assert_eq!(timeline.error, None);
        assert_eq!(
            timeline.events,
            [ScriptOutput::Attach { frame: 0, unit: 2, piece: Some("turret".to_string()) }]
        );
    }

    /// `RunQueryCallIn` answers -1 when there is nothing to call
    /// (`LuaUnitScript.cpp:505-519`), which is the void.
    #[test]
    fn a_missing_query_transport_is_the_void() {
        let timeline = carried("function script.Create() end", &[engine(0, EngineAction::Attach)]);

        assert_eq!(
            timeline.events,
            [ScriptOutput::Attach { frame: 0, unit: 2, piece: None }]
        );
        assert!(timeline.warnings.iter().any(|w| w.contains("no QueryTransport")));
    }

    #[test]
    fn a_query_transport_that_fails_is_the_void() {
        let timeline = carried(
            r#"function script.QueryTransport() error("boom") end"#,
            &[engine(0, EngineAction::Attach)],
        );

        assert_eq!(
            timeline.events,
            [ScriptOutput::Attach { frame: 0, unit: 2, piece: None }]
        );
        assert!(timeline.warnings.iter().any(|w| w.contains("QueryTransport failed")));
    }

    #[test]
    fn detaches_when_the_engine_says() {
        let timeline = carried(
            r#"
            local turret = piece("turret")
            function script.QueryTransport() return turret end
            "#,
            &[engine(0, EngineAction::Attach), engine(3, EngineAction::Detach)],
        );

        assert_eq!(timeline.events[1], ScriptOutput::Drop { frame: 3, unit: 2 });
    }
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cargo test -p coilbox-springlua engine_attach`
Expected: FAIL on empty events.

- [ ] **Step 3: Handle engine events**

In `fire_due`, after the `if let Some(world) = &event.world { ... }` block:

```rust
            if let Some(action) = event.engine {
                self.engine(action);
                continue;
            }
```

Add to `impl Run`, after `fire_due`:

```rust
    /// What the engine does to the stand-in itself: the air transport arm's
    /// attach and detach (`rts/Sim/Units/CommandAI/MobileCAI.cpp:1451-1453,2090-2091`).
    fn engine(&mut self, action: EngineAction) {
        let stand_in = self
            .sim
            .borrow()
            .world
            .as_ref()
            .and_then(|world| world.stand_in);
        let Some(stand_in) = stand_in else {
            self.sim.borrow_mut().model.note(
                "The scenario has the engine carry the stand-in, and there is no stand-in in the scene.".to_string(),
            );
            return;
        };
        // Asked before the borrow below, because answering runs Lua.
        let piece = match action {
            EngineAction::Attach => Some(self.query_transport(stand_in.id)),
            EngineAction::Detach => None,
        };
        let mut guard = self.sim.borrow_mut();
        let sim = &mut *guard;
        let Some(piece) = piece else {
            sim.model.drop_unit(sim.frame, stand_in.id, sim.world.as_ref());
            return;
        };
        let at = if piece < 0 {
            None
        } else {
            let Some(at) = usize::try_from(piece)
                .ok()
                .filter(|index| *index < sim.model.pieces.len())
            else {
                sim.model.no_such_piece("QueryTransport", piece + 1);
                return;
            };
            Some(at)
        };
        sim.model
            .attach_unit(sim.frame, stand_in.id, at, sim.world.as_ref());
    }

    /// Ask `QueryTransport` for the piece, straight away, as the engine's
    /// `RunQueryCallIn` does: the passenger's id in, a piece counted from one
    /// out, less one. A script with no `QueryTransport`, or one that fails or
    /// answers with no number, gets -1, the void
    /// (`rts/Sim/Units/Scripts/LuaUnitScript.cpp:505-519,535-550,794-797`).
    fn query_transport(&mut self, passenger: i32) -> i64 {
        let function: Option<Function> = self.script.get("QueryTransport").ok().flatten();
        let Some(function) = function else {
            self.sim.borrow_mut().model.note(
                "This script has no QueryTransport call-in, so the stand-in goes in the void, which is what the engine answers for it.".to_string(),
            );
            return -1;
        };
        match function.call::<Option<f64>>(passenger) {
            Ok(Some(piece)) => piece as i64 - 1,
            Ok(None) => {
                self.sim.borrow_mut().model.note(
                    "QueryTransport answered with no piece, so the stand-in goes in the void, which is what the engine answers for it.".to_string(),
                );
                -1
            }
            Err(error) => {
                self.sim.borrow_mut().model.note(format!(
                    "QueryTransport failed, so the stand-in goes in the void, which is what the engine answers for it: {}",
                    describe(&error)
                ));
                -1
            }
        }
    }
```

Import `EngineAction` into the file's `use coilbox_unitpose::{...}` (the re-export in B1 covers the tests).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cargo test -p coilbox-springlua`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add crates/coilbox-springlua/src/unitscript.rs crates/coilbox-springlua/src/unitscript_tests.rs
git commit -m "Attach and detach for the engine in the Lua runtime, asking QueryTransport when it does"
```

---

### Task B4: the air transports ride what `QueryTransport` answers

**Files:**
- Modify: `src/lego/scriptPlayback.ts` (`ScriptEvent` at 15-42, `StandInKey.fromRelease` doc, `StandInAttach` at 137-153, `transport-load` at 420-453, `transport-unload` at 481-519)
- Modify: `src/lego/pages/components/standInPlayback.ts` (`placeLoose`, from part C)
- Modify: `src/lego/aimResolver.ts` (`worldAt`, `WorldContext.attachPiece` doc)
- Modify: `src/lego/pages/components/AnimationPanel.tsx:80-95` (`STAND_IN_PROBES` and its comment)
- Test: `src/lego/scriptPlayback.test.ts:191-238`, `src/lego/aimResolver.test.ts:196-262`, `src/lego/pages/components/ModelViewport.dom.test.tsx` (`describe("placeStandIn")`)

**Interfaces:**
- Produces:
  - `ScriptEvent.callin?: string`, `ScriptEvent.engine?: "attach" | "detach"`.
  - `StandInAttach` is `{ from: "QueryBuildInfo"; frame: number; until: number | null }`.

- [ ] **Step 1: Write the failing scenario tests**

In `scriptPlayback.test.ts`, replace "loads a transport the way the engine's air arm does" and "unloads with the two call-ins the engine actually fires":

```ts
  /**
   * The engine's air arm calls `BeginTransport`, then attaches with the piece
   * `QueryTransport` names, itself (`rts/Sim/Units/CommandAI/MobileCAI.cpp:1451-1453`).
   * `TransportPickup` is the ground and ship arm and is deliberately absent.
   */
  it("loads a transport the way the engine's air arm does", () => {
    const load = scenarioById("transport-load");
    const events = load?.events ?? [];
    const begin = events.findIndex((e) => e.callin === "BeginTransport");
    expect(begin).toBeGreaterThan(-1);
    expect(events.map((e) => e.callin)).not.toContain("TransportPickup");
    expect(events[begin + 1]).toEqual({ frame: events[begin].frame, engine: "attach" });
    expect(events.some((e) => e.engine === "detach")).toBe(true);
    expect(load?.standIn?.attach ?? null).toBeNull();
  });

  /**
   * `StartUnload` is not here on purpose: nothing in `rts/` outside the script
   * interface files calls it. Landing calls `TransportDrop` and then detaches
   * (`MobileCAI.cpp:2090-2091`).
   */
  it("unloads with the call-ins the engine fires, then detaches", () => {
    const unload = scenarioById("transport-unload");
    const events = unload?.events ?? [];
    expect(events.map((e) => e.callin)).toContain("EndTransport");
    expect(events.map((e) => e.callin)).not.toContain("StartUnload");
    expect(events.find((e) => e.engine === "attach")?.frame).toBe(0);
    const drop = events.findIndex((e) => e.callin === "TransportDrop");
    expect(events[drop + 1]).toEqual({ frame: events[drop].frame, engine: "detach" });
    expect(unload?.standIn?.attach ?? null).toBeNull();
  });
```

and in "puts a factory's stand-in on its build piece, sitting still", drop `follow: false` from the expected object.

- [ ] **Step 2: Run them to verify they fail**

Run: `bunx vitest run src/lego/scriptPlayback.test.ts`
Expected: FAIL, on the missing engine events and the attach still present.

- [ ] **Step 3: Change the types and the scenarios**

`ScriptEvent`:

```ts
export interface ScriptEvent {
  frame: number;
  /** The call-in to fire. Absent on an event the engine acts on. */
  callin?: string;
  // ...args, ambient, aimAtStandIn, world unchanged...
  /**
   * Something the engine does to the stand-in itself, rather than a call-in it
   * fires. The air transport arm attaches a passenger to the piece
   * `QueryTransport` names, and detaches it, without the script asking
   * (`rts/Sim/Units/CommandAI/MobileCAI.cpp:1451-1453,2041-2042,2090-2091`).
   * The runtime asks `QueryTransport` at the moment it attaches.
   */
  engine?: "attach" | "detach";
}
```

`StandInAttach` becomes:

```ts
/**
 * The piece a factory builds on, and for how long.
 *
 * A factory spawns what it builds at the world position of the piece
 * `QueryBuildInfo` names and leaves it there
 * (`rts/Sim/Units/UnitTypes/Factory.cpp:95-101,178`), so the stand-in sits at
 * the piece's rest position rather than riding it. A transport's passenger is
 * carried by the runtime instead, from the attach events it reports.
 */
export interface StandInAttach {
  /** The call-in the probe asks for that piece. */
  from: "QueryBuildInfo";
  /** The first frame the stand-in sits on it. */
  frame: number;
  /** The frame it comes off again, or null to stay on to the end. */
  until: number | null;
}
```

and remove `follow: false,` from `building-factory`'s `attach`.

In `StandInKey.fromRelease`'s comment, replace the last sentence about the attach piece with: "Before anything has let it go it is measured from the unit's origin, as any other key is."

`transport-load`'s events and track:

```ts
    events: [
      ...CREATED,
      // The engine's air arm calls `BeginTransport`, then attaches the
      // passenger to the piece `QueryTransport` names, itself
      // (`rts/Sim/Units/CommandAI/MobileCAI.cpp:1451-1453`).
      { frame: at(4), callin: "BeginTransport", args: [STAND_IN_UNIT_ID] },
      { frame: at(4), engine: "attach" },
      // Where its attachment has always ended in this scenario, so the return
      // leg below has somewhere to start from.
      { frame: at(11), engine: "detach" },
    ],
    standIn: {
      keys: [
        // Approaching on the ground, from in front.
        { frame: 0, pos: [0, 0, 4.5] },
        { frame: at(4), pos: [0, 0, 1] },
        // The return leg, which is the preview's rather than the engine's: no
        // unload call-in fires during it. It walks from wherever the detach
        // left the stand-in back to where it started, so the loop does not
        // jump.
        { frame: at(PREVIEW_SECONDS), pos: [0, 0, 4.5] },
      ],
    },
```

`transport-unload`'s events and track:

```ts
    events: [
      ...CREATED,
      // Carried from the start. The air arm attaches for itself.
      { frame: 0, engine: "attach" },
      // `TransportDrop(unitID, x, y, z)` in the Lua form
      // (`rts/Sim/Units/Scripts/LuaUnitScript.cpp:806-826`). The position is
      // where the passenger is going, which is the ground under the transport.
      {
        frame: at(5),
        callin: "TransportDrop",
        args: [STAND_IN_UNIT_ID, 0, 0, 0],
      },
      // Landing detaches straight after `TransportDrop` (`MobileCAI.cpp:2090-2091`).
      { frame: at(5), engine: "detach" },
      // Once the last passenger is off (`MobileCAI.cpp:2094-2098`).
      { frame: at(6), callin: "EndTransport" },
    ],
    // Every key is measured from where the transport let go, so the stand-in
    // settles below the piece it rode.
    standIn: {
      keys: [
        { frame: at(5), pos: [0, 0, 0], fromRelease: true },
        { frame: at(7.5), pos: [0, -1.6, -1.2], fromRelease: true },
        { frame: at(12), pos: [0, -1.6, -1.2], fromRelease: true },
        // Back up to the release point. The preview's own return leg, not a
        // reload: no call-in fires during it.
        { frame: at(PREVIEW_SECONDS), pos: [0, 0, 0], fromRelease: true },
      ],
    },
```

Update the two scenario descriptions only if they now say something untrue. `transport-load`'s "the stand-in rides the piece the script names for it" is still true.

- [ ] **Step 4: Remove what only the probe attach used**

`standInPlayback.ts`, `placeLoose` from part C, keeps only the build spot:

```ts
/** Before anything has attached it, the track, as it always was. */
function placeLoose(
  state: SceneState,
  project: LegoProject,
  track: StandInTrack,
  attachPieces: Map<string, string>,
  frame: number,
): void {
  const pose = standInAt(track, frame, state.standInRadius);
  if (!pose) {
    state.standIn.visible = false;
    return;
  }
  state.standIn.visible = true;
  state.standIn.rotation.set(0, pose.heading, 0);

  // A factory's build spot: where its piece rests, not where the doors have
  // swung it. The rest offsets are what `showBaked` wrote.
  const attach = attachedAt(track, frame);
  const piece = attach ? attachPieces.get(attach.from) : undefined;
  const rest = piece ? restOfPiece(state, project, piece) : null;
  if (rest) {
    state.standIn.position.set(...rest);
    return;
  }

  // Loose, or on a build piece the probe never named. Nothing has been let go
  // yet, so every key is measured from the unit's origin.
  state.standIn.position.set(...pose.pos);
}
```

`aimResolver.ts` `worldAt`: remove the `from` lookup and use `pose.pos` directly.

```ts
  const pose = standInAt(track, frame, ctx.radius);
  if (!pose) return { standIn: { ...base, pos: null }, self: ctx.self };
  return { standIn: { ...base, pos: pose.pos }, self: ctx.self };
```

Reword the comment above `const attach = attachedAt(track, frame)` in `worldAt` to: "A factory's stand-in sits on its build piece from the frame after the attach. The rule came from the air arm, which attaches in the runtime now, and is kept for the factory rather than changed in passing." Reword the `worldAt` doc comment's first paragraph to say a stand-in on a build piece is where that piece rests.

`AnimationPanel.tsx`: `const STAND_IN_PROBES = ["AimFromWeapon1", "QueryBuildInfo"];`, and its comment's first sentence becomes "The call-ins a scenario asks a script to name a piece for, before the run." Replace the comment's last two sentences with: "`QueryTransport` is not here: the runtime asks it itself, at the moment the engine attaches a passenger."

- [ ] **Step 5: Update the tests the typecheck and the suite name**

Run: `bun run typecheck && bunx vitest run src/lego`
Expected: failures and type errors in `aimResolver.test.ts` and `ModelViewport.dom.test.tsx` where they build a `QueryTransport` attach or a `follow` field. Change each as follows:

- `aimResolver.test.ts` `CTX.attachPiece`: answer for `"QueryBuildInfo"`.
- "puts an attached stand-in on the piece it rides" becomes "puts a factory's stand-in on its build piece", with `attach: { from: "QueryBuildInfo", frame: 0, until: 150 }` and the same expectation.
- "measures a key from the attach piece when the key says to" becomes "measures a fromRelease key from the origin before anything is let go", with no `attach` and `expect(worldAt(leaving, 0, CTX).standIn?.pos).toEqual([0, -10, 0])`.
- "keeps a passenger off the piece on the attach's own frame": `from: "QueryBuildInfo"`, no `follow`, and its comment says the rule is kept for the factory, as in `worldAt`.
- `ModelViewport.dom.test.tsx`: delete "rides the attach piece where the pose put it", which C's "rides the piece its script attached it to" replaces. Drop `follow` from "sits at the attach piece's rest position when it does not follow" and rename it "sits at a factory's build piece where it rests". In "holds the keyed position when the probe named no piece", use `from: "QueryBuildInfo"` with no `follow`. Replace "measures a fromRelease key from the attach piece before anything is let go" with a test that the same key is measured from the origin, expecting `[0, -5, 0]`.

Run it again. Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/lego/scriptPlayback.ts src/lego/scriptPlayback.test.ts src/lego/pages/components/standInPlayback.ts src/lego/aimResolver.ts src/lego/aimResolver.test.ts src/lego/pages/components/AnimationPanel.tsx src/lego/pages/components/ModelViewport.dom.test.tsx
git commit -m "Let the engine carry air transports' passengers, on the piece QueryTransport answers"
```

---

### Task B5: put the stand-in down where the track had it

**Files:**
- Modify: `src/lego/scriptPlayback.ts` (`ScriptEvent`)
- Modify: `src/lego/aimResolver.ts` (`resolveScenario` at 133-174)
- Test: `src/lego/aimResolver.test.ts`, `describe("resolveScenario")`

**Interfaces:**
- Produces: `ScriptEvent.dropAtStandIn?: { frame: number }`. `resolveScenario` replaces it with `args: [STAND_IN_UNIT_ID, x, y, z]` in elmos. Task B6 uses it.

- [ ] **Step 1: Write the failing tests**

In `describe("resolveScenario")`:

```ts
  /** The track is in radii, so where to put the stand-in down depends on the
   *  unit, and has to be worked out rather than written as elmos. */
  it("puts the stand-in down where the track had it", () => {
    const putting: Scenario = {
      ...firing,
      events: [{ frame: 300, callin: "TransportDrop", dropAtStandIn: { frame: 120 } }],
      standIn: { keys: [{ frame: 0, pos: [0, 0, 3] }] },
    };
    const { events } = resolveScenario(putting, context());
    expect(events[0]).toEqual({
      frame: 300,
      callin: "TransportDrop",
      args: [STAND_IN_UNIT_ID, 0, 0, 30],
    });
  });

  it("puts it down at the origin, and says so, when the track has nowhere", () => {
    const putting: Scenario = {
      ...firing,
      events: [{ frame: 300, callin: "TransportDrop", dropAtStandIn: { frame: 120 } }],
      standIn: { keys: [] },
    };
    const { events, notes } = resolveScenario(putting, context());
    expect(events[0].args).toEqual([STAND_IN_UNIT_ID, 0, 0, 0]);
    expect(notes.join(" ")).toContain("TransportDrop");
  });
```

- [ ] **Step 2: Run them to verify they fail**

Run: `bunx vitest run src/lego/aimResolver.test.ts`
Expected: FAIL, the marker is passed through untouched.

- [ ] **Step 3: Add the marker and resolve it**

In `ScriptEvent`, after `aimAtStandIn`:

```ts
  /**
   * Put the stand-in down where the track had it on `frame`, rather than at
   * literal coordinates. `resolveScenario` replaces the marker with
   * `TransportDrop`'s Lua arguments, the unit id then x, y and z in elmos,
   * because a track is measured in the stand-in's radius and that depends on
   * the unit.
   */
  dropAtStandIn?: { frame: number };
```

In `resolveScenario`, at the top of the `scenario.events.map` callback:

```ts
    if (event.dropAtStandIn) return putDown(event, track, ctx.radius, notes);
```

and after `resolveScenario`:

```ts
/** `TransportDrop`'s Lua arguments for a `dropAtStandIn` marker. */
function putDown(
  event: ScriptEvent,
  track: StandInTrack | undefined,
  radius: number,
  notes: string[],
): ScriptEvent {
  const { dropAtStandIn: marker, ...rest } = event;
  const pose = track && marker ? standInAt(track, marker.frame, radius) : null;
  if (!pose) {
    notes.push(
      `${event.callin} puts the stand-in down where it stood on frame ${marker?.frame}, and this scenario places no stand-in then. It is put down at the unit's origin instead.`,
    );
    return { ...rest, args: [STAND_IN_UNIT_ID, 0, 0, 0] };
  }
  return { ...rest, args: [STAND_IN_UNIT_ID, ...pose.pos] };
}
```

Import `standInAt` from `./standIn` and `STAND_IN_UNIT_ID` from `./scriptPlayback` if the file does not already.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun run typecheck && bunx vitest run src/lego/aimResolver.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lego/scriptPlayback.ts src/lego/aimResolver.ts src/lego/aimResolver.test.ts
git commit -m "Put the stand-in down where the track had it"
```

---

### Task B6: the Hulk's whole cycle, measured and checked on screen

The drop frame in `transport-pickup` is picked by running the Hulk, not guessed. This task starts an instance of your own, measures, writes the scenario, then checks both runtimes on screen.

**Files:**
- Modify: `src/lego/scriptPlayback.ts` (`transport-pickup` at 454-480)
- Modify: `src/lego/scriptPlayback.test.ts` ("loads a ship or hover transport the way the engine's other arm does" at 261)
- Local only, reverted before any commit: `src-tauri/src/main.rs:259`, `vite.config.ts:16`, `src-tauri/tauri.conf.json:8`
- Create, gitignored: `docs/reports/script-events-mcp.mjs`, screenshots in `docs/reports/`

- [ ] **Step 1: Look before starting anything**

```bash
pgrep -fl "target/debug/coilbox"
pgrep -fl "script-events-e2e"
lsof -nP -iTCP:1431 -sTCP:LISTEN
ls -l /tmp/tauri-mcp-script-events.sock
```

Anything already running is somebody else's. Leave it alone. If port 1431 or the socket path is taken, pick another pair and use it everywhere below.

- [ ] **Step 2: Give your instance its own port, socket and target folder**

Local edits, reverted in step 9:

- `src-tauri/src/main.rs:259`: `.socket_path("/tmp/tauri-mcp-script-events.sock".into())`
- `vite.config.ts:16`: `port: 1431,`
- `src-tauri/tauri.conf.json:8`: `"devUrl": "http://localhost:1431",`

A separate target folder, so the portable profile beside the binary cannot turn the user's own dev app portable:

```bash
export CARGO_TARGET_DIR="$PWD/target/script-events-e2e"
cargo build -p coilbox-unitsync-worker
```

A `tauri dev` app resolves `$CARGO_TARGET_DIR/debug/coilbox-unitsync-worker`, which only `cargo build` refreshes.

- [ ] **Step 3: Seed a portable profile**

```bash
APP="$CARGO_TARGET_DIR/debug"
mkdir -p "$APP/.coilbox/data" "$APP/.coilbox/cache"
printf '{}' > "$APP/.coilbox/profile.json"
cp -R "$HOME/Library/Application Support/com.tomjn.coilbox/." "$APP/.coilbox/data/"
```

An empty game picker later means this step did not take, not a bug in the change. The copy carries the user's projects too, so delete only what you create.

- [ ] **Step 4: Start it, and a second MCP server to drive it**

Start `CARGO_TARGET_DIR="$PWD/target/script-events-e2e" bun tauri dev` in the background.

The session's own Tauri MCP tools are pinned to `/tmp/tauri-mcp.sock` and would drive whichever app holds that. Drive yours through its own server over stdio instead, with this script at `docs/reports/script-events-mcp.mjs`:

```js
// node docs/reports/script-events-mcp.mjs <tool> '<json arguments>' [screenshot.png]
import { writeFileSync } from "node:fs";
import { homedir } from "node:os";

const server = `${homedir()}/dev/tauri-plugin-mcp/mcp-server-ts`;
const sdk = `${server}/node_modules/@modelcontextprotocol/sdk/dist/esm`;
const { Client } = await import(`${sdk}/client/index.js`);
const { StdioClientTransport } = await import(`${sdk}/client/stdio.js`);

const [tool, args = "{}", out] = process.argv.slice(2);
const transport = new StdioClientTransport({
  command: "node",
  args: [`${server}/build/index.js`],
  env: { ...process.env, TAURI_MCP_IPC_PATH: "/tmp/tauri-mcp-script-events.sock" },
});
const client = new Client({ name: "script-events-e2e", version: "0.0.0" });
await client.connect(transport);
const result = await client.callTool({ name: tool, arguments: JSON.parse(args) });
for (const part of result.content ?? []) {
  if (part.type === "image" && out) writeFileSync(out, Buffer.from(part.data, "base64"));
  else if (part.type === "text") console.log(part.text);
}
await client.close();
```

Confirm it is your app before anything else: `node docs/reports/script-events-mcp.mjs query_page '{"mode":"app_info"}'` must show a URL on port 1431. Use `navigate` to move between pages, never `execute_js` to write anything, which has killed the app before. A black screenshot means the window is too large, so shrink it with `manage_window`. If the user's screen is elsewhere, transitions do not run in your window, so read the DOM rather than trusting a screenshot of something mid-slide.

- [ ] **Step 5: Measure the Hulk's pickup**

Open Balanced Annihilation's Hulk, `armtship` in `balanced_annihilation-v15.9.8.sdz`, in the model editor, with its compiled script. Pick "Loading a ship or hover transport" and play it as the scenario stands, with no drop yet.

Read the scrubber marks from part C with `query_page` in `map` mode: each is a button named "Frame N: ...". Record:

- `A`, the frame of "Attach stand-in to link".
- `V`, the frame of "Attach stand-in to the void". `TransportPickup` ends on this frame: after it the script only calls `BoomReset`, which does not wait, and sets `BUSY` (`scripts/armtship.bos:207-221`).

If either mark is missing, the Hulk's reach guard failed and nothing below applies. Stop and report what the panel shows.

These are frame numbers as the marks show them, counted from one. Subtract one for a scenario frame.

- [ ] **Step 6: Write the drop into the scenario**

The drop fires one second after `V`. That second is a pacing choice, so the stand-in is seen to disappear before it comes back. It is not a measured number, and the PR description says so. Replace `transport-pickup`'s events and track, with `V` the scenario frame from step 5:

```ts
    events: [
      ...CREATED,
      // The engine's other arm: anything that is not an air transport stops,
      // then calls `TransportPickup` with the passenger and leaves the script
      // to attach it (`rts/Sim/Units/CommandAI/MobileCAI.cpp:1459-1463`).
      { frame: at(4), callin: "TransportPickup", args: [STAND_IN_UNIT_ID] },
      // Then puts it down where it found it. The Hulk's pickup ends on frame
      // <V>, measured by running armtship from balanced_annihilation-v15.9.8,
      // and this is a second later so the stand-in is seen to go.
      {
        frame: <V> + at(1),
        callin: "TransportDrop",
        dropAtStandIn: { frame: at(4) },
      },
    ],
    standIn: {
      keys: [
        // Approaching on the ground, from in front, and still by the time the
        // transport is told to pick it up. The engine only calls
        // `TransportPickup` once the passenger is in range, and a passenger
        // that asked to be loaded stops there (`MobileCAI.cpp:430-465`).
        { frame: 0, pos: [0, 0, 5] },
        { frame: at(3), pos: [0, 0, 3] },
        // Held where the Hulk put it down, then the preview's own return leg.
        // No call-in fires during it.
        { frame: at(13), pos: [0, 0, 0], fromRelease: true },
        { frame: at(PREVIEW_SECONDS), pos: [0, 0, 5] },
      ],
    },
```

Write the measured number in place of `<V>`, not the placeholder. In `scriptPlayback.test.ts`, change "loads a ship or hover transport the way the engine's other arm does" to also expect a `TransportDrop` after the `TransportPickup` with a `dropAtStandIn` marker at the pickup's frame, and update its comment.

Play it again and read the marks. Record `D`, the frame of "Drop stand-in". The cycle fits the preview when `D` is before `at(13)`, the hold key.

If it does not fit, move the scenario earlier rather than lengthening `PREVIEW_SECONDS`, which every scenario shares. Bring `TransportPickup`, its approach key and the drop's `dropAtStandIn` frame forward by the same amount, remeasure `V` and `D`, and repeat. If the pickup would have to start before `at(1)`, stop and ask the user, because that is a choice about the preview's length.

- [ ] **Step 7: Check the whole cycle, compiled and in Lua**

Play the scenario with the compiled script. Pass means, each seen on screen or read from the DOM:

1. The stand-in rides `link` while the boom swings out and back to the pad.
2. It disappears on the pad at `V`.
3. It reappears on the boom when `TransportDrop` starts, and is set down at `D` near where it was parked.
4. It holds there, then walks back to its start by the end of the run.
5. The panel shows no "Attaching a unit does nothing in the preview." and none of "Effects are not drawn in the preview.", "Explode throws no debris in the preview." or "Sound is not played in the preview.".
6. Scrubbing back and forth across `D` shows the same picture each time.

Save a screenshot at each of `A`, `V` and `D` under `docs/reports/`, and look at them before claiming anything.

Then take the Hulk's script over as Lua, with the conversion in `src/lego/pages/components/ScriptTab.tsx`, and repeat the six checks. The converted script comes from the decompiled `scripts/armtship.bos` in the same archive, so its frames can differ from the compiled run by a frame or two. Record both sets of `A`, `V` and `D`. A difference larger than a few frames, or a cycle that completes in one runtime and not the other, is a finding to report, not a pass.

- [ ] **Step 8: Run the scenario tests**

Run: `bunx vitest run src/lego`
Expected: PASS, including "brings a moving stand-in back to where it started", whose first and last keys must still match.

- [ ] **Step 9: Stop your instance and put everything back**

Stop the background `bun tauri dev` you started. Then stop anything of yours it left behind, by its own absolute path or its own PID, never a bare pattern that matches the user's:

```bash
pkill -f "$PWD/target/script-events-e2e/debug/coilbox"
# Your vite is whatever still listens on your port. Check it is this
# checkout's before stopping it.
PID=$(lsof -nP -iTCP:1431 -sTCP:LISTEN -t)
[ -n "$PID" ] && ps -o command= -p "$PID"
```

Kill that PID only if the command shows this checkout's path. Check each is gone with `pgrep -fl script-events-e2e` and the `lsof` line again. Revert the three local edits:

```bash
git checkout -- src-tauri/src/main.rs vite.config.ts src-tauri/tauri.conf.json
git status --short
```

`git status` must show only `src/lego/scriptPlayback.ts` and `src/lego/scriptPlayback.test.ts`. Then offer the user the removal of `target/script-events-e2e`, which holds a full debug build and the copied profile. Check its size with `du -sh target/script-events-e2e` and say the number.

- [ ] **Step 10: Commit**

```bash
git add src/lego/scriptPlayback.ts src/lego/scriptPlayback.test.ts
git commit -m "Have the Hulk put its passenger down again, at a frame measured by running it"
```

---

### Task B7: full check and the PR

- [ ] **Step 1: Run the seven CI commands**

```bash
bunx biome ci .
bun run typecheck
bun run test
scripts/mission-tests.sh
cargo fmt --all --check
cargo clippy --all-targets -- -D warnings
cargo test --workspace
```

Expected: each exits 0. Report any failure with its output.

- [ ] **Step 2: Let the user look**

Tell the user the branch is ready for `bun tauri dev`, with the Hulk under "Loading a ship or hover transport" as the thing to watch, and the frames from B6.

- [ ] **Step 3: File the PR**

Use the `file-pr` skill. The description says why B landed after C, that the Hulk's drop comes one second after its measured pickup end as a pacing choice, the measured `A`, `V` and `D` in both runtimes, and the screenshots. Get the user's approval before creating it.
