# Nano spray in the model editor's preview: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The preview draws Total Annihilation style nano spray from the piece `QueryNanoPiece` names to the stand-in, in the `building` and `building-factory` scenarios, as a pure function of the frame.

**Architecture:** Both script runtimes gain a `nano-start` and `nano-stop` engine action. While spraying, each frame asks `QueryNanoPiece` through the engine's cache rule and records a `nano` output. TypeScript resolves those outputs into world-space emissions once per timeline, turns emissions into particles as a closed form of the frame, and draws them as camera-facing dots in one instanced mesh.

**Tech Stack:** Rust (`coilbox-unitpose`, `tauri-plugin-coilbox-anim`, `coilbox-springlua`), TypeScript, React, three.js, vitest with happy-dom.

**Spec:** `docs/superpowers/specs/2026-09-23-effects-renderer-design.md`, delivery PR A. Read sections "What the engine does", "Decisions", 1 to 4 and "Testing" before starting.

## Global constraints

- Engine numbers are copied from `~/dev/RecoilEngine` with the file and line in a comment. Numbers with no engine source (the TA dot size and colour variation) are labelled in the code as set by eye.
- `Math.random` is never used for anything drawn. Randomness comes from `unitFloat` in `src/lego/effects.ts`.
- No semicolons and no em dashes in comments, commit messages or docs. The humanize hook blocks them.
- Do not `git rebase`. Do not use `git add -A`. Add files by name.
- Before the PR, run all seven CI commands from `CLAUDE.md`: `bunx biome ci .`, `bun run typecheck`, `bun run test`, `scripts/mission-tests.sh`, `cargo fmt --all --check`, `cargo clippy --all-targets -- -D warnings`, `cargo test --workspace`.
- Branch: `effects-renderer`, which already holds the spec commit.

## File map

| File | Change |
|---|---|
| `crates/coilbox-unitpose/src/nanopiece.rs` | New. The engine's `NanoPieceCache` rule. |
| `crates/coilbox-unitpose/src/lib.rs` | `EngineAction::NanoStart`, `NanoStop`, `ScriptOutput::Nano`, `Model` spray state and `spray`. |
| `crates/tauri-plugin-coilbox-anim/src/cobrun.rs` | Handle the actions, ask `QueryNanoPiece` inline each spraying frame. |
| `crates/tauri-plugin-coilbox-anim/src/cobrun_tests.rs` | `mod engine_nano`. |
| `crates/coilbox-springlua/src/unitscript.rs` | Same as the compiled runtime, in Lua's conventions. |
| `crates/coilbox-springlua/src/unitscript_tests.rs` | `mod engine_nano`. |
| `src/lego/scriptPlayback.ts` | `ScriptOutput` nano, `ScriptEvent.engine` values, `Scenario.nano`, two scenarios. |
| `src/lego/scriptMarks.ts` | No marks for nano, words for nano. |
| `src/lego/pages/components/AnimationPanel.tsx` | Marks row condition, pass the nano style on. |
| `src/lego/pages/BuilderPage.tsx` | Carry the nano style in its stand-in state. |
| `src/lego/effects.ts` | New. Pure: emissions to particles. |
| `src/lego/pages/components/effectsLayer.ts` | New. The instanced dot mesh. |
| `src/lego/pages/components/effectsPlayback.ts` | New. Outputs to emissions, cached per timeline, and `placeEffects`. |
| `src/lego/pages/components/standInPlayback.ts` | Export `groupOfPiece`, add `nano` to `StandInPlacement`. |
| `src/lego/pages/components/sceneState.ts` | `effects` on `SceneState`. |
| `src/lego/pages/components/useScriptFrameStepping.ts` | Call `placeEffects` beside `placeStandIn`. |
| `src/lego/pages/components/ModelViewport.tsx` | Build and free the layer, the toggle. |

---

### Task 1: The nano piece cache and the new types in `coilbox-unitpose`

**Files:**
- Create: `crates/coilbox-unitpose/src/nanopiece.rs`
- Modify: `crates/coilbox-unitpose/src/lib.rs` (module list at `:18-21`, `EngineAction` at `:86-91`, `ScriptOutput` at `:150-176`, `Model` at `:336-360`, next to `play_sound` at `:533-535`)

**Interfaces:**
- Produces: `coilbox_unitpose::NanoPieces`, `EngineAction::NanoStart` (`"nano-start"`), `EngineAction::NanoStop` (`"nano-stop"`), `ScriptOutput::Nano { frame: u32, piece: Option<String> }` serialised as `{ "kind": "nano", "frame", "piece" }`, and on `Model`: `spraying: bool`, `nano: NanoPieces`, `fn spray(&mut self, frame: u32, answer: Option<Option<usize>>)`.

- [ ] **Step 1: Write the failing tests**

Create `crates/coilbox-unitpose/src/nanopiece.rs` with only the tests first:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    /// Two new answers, then 31 known ones, because the engine asks while
    /// its count is at most 30 (`NanoPieceCache.cpp:29`).
    #[test]
    fn asks_until_thirty_one_known_answers_in_a_row_then_stops() {
        let mut cache = NanoPieces::default();
        let mut asked = 0;
        for frame in 0..100 {
            if cache.wants_answer() {
                asked += 1;
                cache.next(frame, Some(Some((frame % 2) as usize)));
            } else {
                cache.next(frame, None);
            }
        }
        assert_eq!(asked, 33);
    }

    #[test]
    fn once_it_stops_asking_it_picks_only_pieces_it_saw() {
        let mut cache = NanoPieces::default();
        for frame in 0..40 {
            let answer = cache
                .wants_answer()
                .then_some(Some(1 + (frame % 2) as usize));
            cache.next(frame, answer);
        }
        assert!(!cache.wants_answer());
        let picked: Vec<Option<usize>> = (40..140).map(|frame| cache.next(frame, None)).collect();
        assert!(picked.iter().all(|piece| matches!(piece, Some(1) | Some(2))));
        assert!(picked.contains(&Some(1)));
        assert!(picked.contains(&Some(2)));
    }

    /// `SafeGetPiece` failing leaves the random cached piece, or none
    /// (`NanoPieceCache.cpp:21-27,44-46`).
    #[test]
    fn an_answer_naming_no_piece_falls_back_to_the_cache_or_nothing() {
        let mut cache = NanoPieces::default();
        assert_eq!(cache.next(0, Some(None)), None);
        cache.next(1, Some(Some(2)));
        assert_eq!(cache.next(2, Some(None)), Some(2));
    }

    #[test]
    fn the_pick_is_the_same_on_every_run() {
        let run = || {
            let mut cache = NanoPieces::default();
            cache.next(0, Some(Some(0)));
            cache.next(1, Some(Some(1)));
            cache.next(2, Some(Some(2)));
            (3..50).map(|frame| cache.next(frame, None)).collect::<Vec<_>>()
        };
        assert_eq!(run(), run());
    }
}
```

Add `pub mod nanopiece;` after `pub mod passenger;` and `pub use nanopiece::NanoPieces;` after `pub use passenger::Passenger;` in `lib.rs`.

- [ ] **Step 2: Run the tests to see them fail**

Run: `cargo test -p coilbox-unitpose nanopiece`
Expected: compile error, `NanoPieces` not found.

- [ ] **Step 3: Write the cache above the tests**

```rust
//! Which piece a builder sprays nano from, frame by frame.
//!
//! The engine does not ask `QueryNanoPiece` for ever. `NanoPieceCache` asks it
//! for every particle until it has had more than 30 answers in a row that it
//! already knew, then stops asking and picks at random among the pieces it has
//! seen (`rts/Sim/Misc/NanoPieceCache.cpp:17-50`). A script that alternates
//! between two nozzles sprays from both, before and after it stops being asked.

/// `MAX_QUERYNANOPIECE_CALLS` (`rts/Sim/Misc/NanoPieceCache.h:39`).
pub const MAX_QUERYNANOPIECE_CALLS: u32 = 30;

#[derive(Debug, Clone, Default)]
pub struct NanoPieces {
    /// Model piece indices, in the order they were first answered.
    cached: Vec<usize>,
    /// Answers in a row that were already cached or named no piece, the
    /// engine's `lastNanoPieceCnt`.
    repeats: u32,
}

impl NanoPieces {
    /// Whether the engine would still call `QueryNanoPiece` for this particle.
    pub fn wants_answer(&self) -> bool {
        self.repeats <= MAX_QUERYNANOPIECE_CALLS
    }

    /// The piece this frame's particle comes from. `answer` is none when the
    /// call-in was not asked, and `Some(None)` when it was asked and named no
    /// piece of this unit.
    pub fn next(&mut self, frame: u32, answer: Option<Option<usize>>) -> Option<usize> {
        let mut piece = if self.cached.is_empty() {
            None
        } else {
            Some(self.cached[pick(frame, self.cached.len())])
        };
        match answer {
            None => {}
            Some(None) => self.repeats += 1,
            Some(Some(answered)) => {
                piece = Some(answered);
                if self.cached.contains(&answered) {
                    self.repeats += 1;
                } else {
                    self.cached.push(answered);
                    self.repeats = 0;
                }
            }
        }
        piece
    }
}

/// The engine's `gsRNG.NextInt(len)`, made a function of the frame so every
/// run of a preview picks the same.
fn pick(frame: u32, len: usize) -> usize {
    let mut x = u64::from(frame)
        .wrapping_add(1)
        .wrapping_mul(0x9E37_79B9_7F4A_7C15);
    x ^= x >> 31;
    x = x.wrapping_mul(0xBF58_476D_1CE4_E5B9);
    x ^= x >> 29;
    (x % len as u64) as usize
}
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `cargo test -p coilbox-unitpose nanopiece`
Expected: 4 passed.

- [ ] **Step 5: Write the failing tests for the new types**

Add to the `tests` module at the bottom of `lib.rs`, beside `reads_an_event_the_engine_acts_on` (`:1037`):

```rust
    #[test]
    fn reads_the_nano_actions() {
        let start: ScriptEvent =
            serde_json::from_str(r#"{ "frame": 15, "engine": "nano-start" }"#).unwrap();
        assert_eq!(start.engine, Some(EngineAction::NanoStart));
        let stop: ScriptEvent =
            serde_json::from_str(r#"{ "frame": 150, "engine": "nano-stop" }"#).unwrap();
        assert_eq!(stop.engine, Some(EngineAction::NanoStop));
    }

    #[test]
    fn a_spraying_frame_records_its_piece_by_name() {
        let mut model = Model::new(&["base".to_string(), "nozzle".to_string()]);
        model.spray(4, Some(Some(1)));
        model.spray(5, Some(None));
        assert_eq!(
            model.events,
            [
                ScriptOutput::Nano { frame: 4, piece: Some("nozzle".to_string()) },
                ScriptOutput::Nano { frame: 5, piece: Some("nozzle".to_string()) },
            ]
        );
        assert_eq!(
            serde_json::to_value(&model.events[0]).unwrap(),
            serde_json::json!({ "kind": "nano", "frame": 4, "piece": "nozzle" })
        );
    }

    /// Nano is drawn, so it does not bring the note that effects are not.
    #[test]
    fn nano_alone_does_not_say_effects_are_not_drawn() {
        let mut model = Model::new(&["base".to_string()]);
        model.spray(0, Some(Some(0)));
        let mut timeline = Timeline::new(vec!["base".to_string()], 1);
        model.finish(&mut timeline);
        assert!(!timeline.warnings.iter().any(|w| w == EFFECTS_NOTE));
    }
```

- [ ] **Step 6: Run them to see them fail**

Run: `cargo test -p coilbox-unitpose`
Expected: compile errors for `NanoStart`, `NanoStop`, `ScriptOutput::Nano` and `spray`.

- [ ] **Step 7: Add the types and `spray`**

In `EngineAction`, after `Detach,`:

```rust
    /// A builder starts spraying nano. `CBuilder` adds build power, and
    /// sprays, on every frame it builds (`rts/Sim/Units/UnitTypes/Builder.cpp:339-354`).
    #[serde(rename = "nano-start")]
    NanoStart,
    /// It stops.
    #[serde(rename = "nano-stop")]
    NanoStop,
```

In `ScriptOutput`, after `Sound`:

```rust
    /// The piece one frame's nano particle comes from, as `NanoPieceCache`
    /// chose it. None when the script has named no piece of this unit yet.
    Nano { frame: u32, piece: Option<String> },
```

`is_effect` stays as it is, because nano is drawn.

In `Model`, after `events`:

```rust
    /// Whether a builder is spraying nano, between an engine `nano-start` and
    /// `nano-stop`.
    pub spraying: bool,
    /// Which piece it sprays from. Kept for the whole run, as the engine keeps
    /// one cache per builder.
    pub nano: NanoPieces,
```

`Model::new` needs no change, because `..Self::default()` fills both.

After `play_sound`:

```rust
    /// One spraying frame. `answer` is what `QueryNanoPiece` named, or none
    /// when the cache has stopped asking (`NanoPieceCache.cpp:29-47`).
    pub fn spray(&mut self, frame: u32, answer: Option<Option<usize>>) {
        let piece = self.nano.next(frame, answer);
        if piece.is_none() {
            self.note("The script has named no nano piece, so nothing sprays.".to_string());
        }
        let piece = piece.map(|index| self.pieces[index].name.clone());
        self.events.push(ScriptOutput::Nano { frame, piece });
    }
```

The `ScriptOutput::Nano` match arm is needed wherever `ScriptOutput` is matched exhaustively in the workspace. Find them with `grep -rn "ScriptOutput::Sound" crates` and add a `Nano` arm next to each.

- [ ] **Step 8: Run the crate's tests**

Run: `cargo test -p coilbox-unitpose`
Expected: all pass.

- [ ] **Step 9: Commit**

```bash
git add crates/coilbox-unitpose/src/nanopiece.rs crates/coilbox-unitpose/src/lib.rs
git commit -m "Record which piece a builder sprays nano from, with the engine's cache rule"
```

---

### Task 2: Nano in the compiled runtime

**Files:**
- Modify: `crates/tauri-plugin-coilbox-anim/src/cobrun.rs` (`fire_due` at `:446-501`, `engine` at `:511-530`, next to `query_transport` at `:544-576`)
- Test: `crates/tauri-plugin-coilbox-anim/src/cobrun_tests.rs`, new `mod engine_nano` after `mod engine_attach`

**Interfaces:**
- Consumes: Task 1's `EngineAction::NanoStart`, `NanoStop`, `Model::spray`, `Model::spraying`, `Model::nano.wants_answer()`.
- Produces: `nano` outputs on the timeline of a compiled run.

- [ ] **Step 1: Write the failing tests**

Append to `cobrun_tests.rs`:

```rust
mod engine_nano {
    use super::*;
    use coilbox_unitpose::{EngineAction, ScriptOutput};

    fn action(frame: u32, action: EngineAction) -> ScriptEvent {
        ScriptEvent {
            frame,
            callin: String::new(),
            args: Vec::new(),
            ambient: false,
            world: None,
            engine: Some(action),
        }
    }

    fn sprayed(bytes: &[u8], frames: u32, start: u32, stop: u32) -> Timeline {
        run(
            bytes,
            &model_pieces(),
            &[
                action(start, EngineAction::NanoStart),
                action(stop, EngineAction::NanoStop),
            ],
            frames,
            &[],
            &HashMap::new(),
        )
    }

    fn nano(timeline: &Timeline) -> Vec<(u32, Option<String>)> {
        timeline
            .events
            .iter()
            .filter_map(|event| match event {
                ScriptOutput::Nano { frame, piece } => Some((*frame, piece.clone())),
                _ => None,
            })
            .collect()
    }

    /// `QueryNanoPiece(piecenum)` flips static 0 between 1 and 0 and answers
    /// it plus one, so barrel, turret, barrel and so on.
    fn alternating() -> Vec<u8> {
        let mut words = vec![op("CREATE_LOCAL_VAR")];
        words.extend(push(1));
        words.extend([op("PUSH_STATIC"), 0, op("SUB"), op("POP_STATIC"), 0]);
        words.extend([op("PUSH_STATIC"), 0]);
        words.extend(push(1));
        words.extend([op("ADD"), op("POP_LOCAL_VAR"), 0, op("RETURN")]);
        build(&[("QueryNanoPiece", words)], PIECES, 1)
    }

    #[test]
    fn sprays_from_what_query_nano_piece_answers_on_each_frame_between_start_and_stop() {
        let timeline = sprayed(&alternating(), 8, 2, 6);

        assert_eq!(timeline.error, None);
        assert_eq!(
            nano(&timeline),
            [
                (2, Some("barrel".to_string())),
                (3, Some("turret".to_string())),
                (4, Some("barrel".to_string())),
                (5, Some("turret".to_string())),
            ]
        );
    }

    /// The engine seeds the call with `[1, -1]` and returns slot 0
    /// (`CobInstance.cpp:411-421`), so with no call-in it is script piece 1.
    #[test]
    fn a_missing_query_nano_piece_answers_script_piece_one() {
        let timeline = sprayed(&create_only(vec![op("RETURN")]), 3, 0, 2);

        assert_eq!(
            nano(&timeline),
            [(0, Some("turret".to_string())), (1, Some("turret".to_string()))]
        );
        assert!(timeline
            .warnings
            .iter()
            .any(|w| w.contains("no QueryNanoPiece")));
    }
}
```

- [ ] **Step 2: Run them to see them fail**

Run: `cargo test -p tauri-plugin-coilbox-anim engine_nano`
Expected: FAIL, no `Nano` events (the actions reach `engine`, which notes there is no stand-in).

- [ ] **Step 3: Handle the actions and spray each frame**

In `engine`, before the `let Some(stand_in)` line:

```rust
        if matches!(action, EngineAction::NanoStart | EngineAction::NanoStop) {
            self.model.spraying = action == EngineAction::NanoStart;
            return Ok(());
        }
```

and replace its closing `match action { ... }` with:

```rust
        if action == EngineAction::Attach {
            let piece = self.query_transport(stand_in.height)?;
            self.attach(stand_in.id, piece);
        } else {
            self.model
                .drop_unit(self.frame, stand_in.id, self.world.as_ref());
        }
        Ok(())
```

In `fire_due`, after the `for event in ...` loop and before `Ok(())`:

```rust
        // After the frame's call-ins and before its threads, because the engine
        // updates builders before scripts tick (`rts/Game/Game.cpp:1782-1798`).
        if self.model.spraying {
            self.tick_queued_call_ins(start)?;
            let answer = if self.model.nano.wants_answer() {
                let piece = self.query_nano_piece()?;
                Some(model_piece(&self.program, piece))
            } else {
                None
            };
            self.model.spray(frame, answer);
        }
```

After `query_transport`:

```rust
    /// Ask `QueryNanoPiece` straight away, as the engine's `Call` does.
    ///
    /// The engine seeds its arguments with a count of 1 and a -1, and returns
    /// the first slot (`rts/Sim/Units/Scripts/CobInstance.cpp:411-421`). A
    /// script with no `QueryNanoPiece`, or one that waits, leaves the count
    /// there, so it answers script piece 1.
    fn query_nano_piece(&mut self) -> Result<i32, String> {
        const UNANSWERED: i32 = 1;
        let Some(function) = self.program.script("QueryNanoPiece") else {
            self.model.note(
                "This script has no QueryNanoPiece call-in, so nano sprays from script piece 1, which is what the engine answers for it."
                    .to_string(),
            );
            return Ok(UNANSWERED);
        };
        let mut thread = Thread::new(
            function,
            self.program.offsets[function],
            0,
            "QueryNanoPiece".into(),
        );
        thread.data = vec![-1];
        thread.params = 1;
        self.add(thread)?;
        let index = self.threads.len() - 1;
        self.step_thread(index)?;
        for thread in std::mem::take(&mut self.queued) {
            self.add(thread)?;
        }
        if matches!(self.threads[index].state, State::Dead) {
            return Ok(self.threads[index].data.first().copied().unwrap_or(0));
        }
        self.model.note(
            "QueryNanoPiece waited rather than answering, so nano sprays from script piece 1, which is what the engine answers for it."
                .to_string(),
        );
        Ok(UNANSWERED)
    }
```

`EngineAction` must derive `PartialEq` for `==`. It already does (`lib.rs:86`).

- [ ] **Step 4: Run the tests**

Run: `cargo test -p tauri-plugin-coilbox-anim`
Expected: all pass, including `engine_attach`.

- [ ] **Step 5: Commit**

```bash
git add crates/tauri-plugin-coilbox-anim/src/cobrun.rs crates/tauri-plugin-coilbox-anim/src/cobrun_tests.rs
git commit -m "Spray nano in the compiled runtime, asking QueryNanoPiece as the engine does"
```

---

### Task 3: Nano in the Lua runtime

**Files:**
- Modify: `crates/coilbox-springlua/src/unitscript.rs` (`fire_due` at `:578-617`, `engine` at `:627-666`, next to `query_transport` at `:675-699`)
- Test: `crates/coilbox-springlua/src/unitscript_tests.rs`, new `mod engine_nano` after `mod engine_attach` (`:2767`)

**Interfaces:**
- Consumes: Task 1's types.
- Produces: the same `nano` outputs as Task 2 for an equivalent script.

- [ ] **Step 1: Write the failing tests**

```rust
mod engine_nano {
    use super::*;
    use coilbox_unitpose::ScriptOutput;

    fn action(frame: u32, action: EngineAction) -> ScriptEvent {
        ScriptEvent {
            frame,
            callin: String::new(),
            args: Vec::new(),
            ambient: false,
            world: None,
            engine: Some(action),
        }
    }

    fn sprayed(script: &str, frames: u32, start: u32, stop: u32) -> Timeline {
        run(
            script,
            "test.lua",
            &Unit::new(&pieces()),
            &[
                action(start, EngineAction::NanoStart),
                action(stop, EngineAction::NanoStop),
            ],
            frames,
            &HashMap::new(),
        )
    }

    fn nano(timeline: &Timeline) -> Vec<(u32, Option<String>)> {
        timeline
            .events
            .iter()
            .filter_map(|event| match event {
                ScriptOutput::Nano { frame, piece } => Some((*frame, piece.clone())),
                _ => None,
            })
            .collect()
    }

    /// The same answers as the compiled runtime's `alternating` script.
    #[test]
    fn sprays_from_what_query_nano_piece_answers_on_each_frame_between_start_and_stop() {
        let timeline = sprayed(
            r#"
            local turret, barrel = piece("turret", "barrel")
            local flip = 0
            function script.QueryNanoPiece()
                flip = 1 - flip
                if flip == 1 then return barrel end
                return turret
            end
            "#,
            8,
            2,
            6,
        );

        assert_eq!(timeline.error, None);
        assert_eq!(
            nano(&timeline),
            [
                (2, Some("barrel".to_string())),
                (3, Some("turret".to_string())),
                (4, Some("barrel".to_string())),
                (5, Some("turret".to_string())),
            ]
        );
    }

    /// `RunQueryCallIn` answers -1 when there is nothing to call
    /// (`LuaUnitScript.cpp:505-519`), which names no piece.
    #[test]
    fn a_missing_query_nano_piece_names_no_piece() {
        let timeline = sprayed("function script.Create() end", 3, 0, 2);

        assert_eq!(nano(&timeline), [(0, None), (1, None)]);
        assert!(timeline
            .warnings
            .iter()
            .any(|w| w.contains("no QueryNanoPiece")));
    }
}
```

- [ ] **Step 2: Run them to see them fail**

Run: `cargo test -p coilbox-springlua engine_nano`
Expected: FAIL, no `Nano` events.

- [ ] **Step 3: Handle the actions and spray each frame**

In `engine`, before `let stand_in = self`:

```rust
        if matches!(action, EngineAction::NanoStart | EngineAction::NanoStop) {
            self.sim.borrow_mut().model.spraying = action == EngineAction::NanoStart;
            return;
        }
```

and replace

```rust
        let piece = match action {
            EngineAction::Attach => Some(self.query_transport(stand_in.id)),
            EngineAction::Detach => None,
        };
```

with

```rust
        let piece = (action == EngineAction::Attach).then(|| self.query_transport(stand_in.id));
```

In `fire_due`, after the `for event in ...` loop and before `Ok(())`:

```rust
        // After the frame's call-ins and before its threads, because the engine
        // updates builders before scripts tick (`rts/Game/Game.cpp:1782-1798`).
        let spraying = self.sim.borrow().model.spraying;
        if spraying {
            self.tick_queued_call_ins(start)?;
            let wants = self.sim.borrow().model.nano.wants_answer();
            let answer = if wants {
                let piece = self.query_nano_piece();
                let count = self.sim.borrow().model.pieces.len();
                Some(usize::try_from(piece).ok().filter(|index| *index < count))
            } else {
                None
            };
            self.sim.borrow_mut().model.spray(frame, answer);
        }
```

After `query_transport`:

```rust
    /// Ask `QueryNanoPiece` straight away, as the engine's `RunQueryCallIn`
    /// does: a piece counted from one out, less one. A script with no
    /// `QueryNanoPiece`, or one that fails or answers with no number, gets -1,
    /// which names no piece (`rts/Sim/Units/Scripts/LuaUnitScript.cpp:505-519,836-840`).
    fn query_nano_piece(&mut self) -> i64 {
        let function: Option<Function> = self.script.get("QueryNanoPiece").ok().flatten();
        let Some(function) = function else {
            self.sim.borrow_mut().model.note(
                "This script has no QueryNanoPiece call-in, so no nano sprays, which is what the engine does.".to_string(),
            );
            return -1;
        };
        match function.call::<Option<f64>>(()) {
            Ok(Some(piece)) => piece as i64 - 1,
            Ok(None) => {
                self.sim.borrow_mut().model.note(
                    "QueryNanoPiece answered with no piece, so no nano sprays from it.".to_string(),
                );
                -1
            }
            Err(error) => {
                self.sim.borrow_mut().model.note(format!(
                    "QueryNanoPiece failed, so no nano sprays from it: {}",
                    describe(&error)
                ));
                -1
            }
        }
    }
```

- [ ] **Step 4: Run the tests**

Run: `cargo test -p coilbox-springlua`
Expected: all pass, including `engine_attach`.

- [ ] **Step 5: Commit**

```bash
git add crates/coilbox-springlua/src/unitscript.rs crates/coilbox-springlua/src/unitscript_tests.rs
git commit -m "Spray nano in the Lua runtime, with Lua's answer for a missing QueryNanoPiece"
```

---

### Task 4: Nano in the TypeScript types, the scenarios and the scrubber

**Files:**
- Modify: `src/lego/scriptPlayback.ts` (`ScriptEvent.engine` at `:58`, `ScriptOutput` at `:76-81`, `Scenario` at `:213-222`, `building` at `:338-384`, `building-factory` at `:385-418`)
- Modify: `src/lego/scriptMarks.ts`
- Modify: `src/lego/pages/components/AnimationPanel.tsx` (`:88-95`, `:224-229`, `:410-413`, `:457`, `:656`)
- Modify: `src/lego/pages/BuilderPage.tsx` (`:209-214`)
- Modify: `src/lego/pages/components/standInPlayback.ts` (`StandInPlacement` at `:30-38`)
- Test: `src/lego/scriptMarks.test.ts`, `src/lego/scriptPlayback.test.ts`

**Interfaces:**
- Produces: `type NanoStyle = "builder" | "factory"` exported from `src/lego/scriptPlayback.ts`, `ScriptOutput` member `{ frame: number; kind: "nano"; piece: string | null }`, `Scenario.nano?: NanoStyle`, `StandInPlacement.nano?: NanoStyle | null`, `isMarked(event: ScriptOutput): boolean` from `scriptMarks.ts`.

- [ ] **Step 1: Write the failing tests**

In `src/lego/scriptMarks.test.ts`:

```ts
it("marks no nano frames, which a build span records on every frame", () => {
  const marks = scrubberMarks(
    [
      { frame: 3, kind: "nano", piece: "nozzle" },
      { frame: 4, kind: "nano", piece: "nozzle" },
      { frame: 5, kind: "sfx", piece: "flare", sfx: 1025 },
    ],
    100,
    0,
  );
  expect(marks.map((mark) => mark.frame)).toEqual([5]);
  expect(isMarked({ frame: 3, kind: "nano", piece: null })).toBe(false);
});

it("says where nano sprays from", () => {
  expect(describeOutput({ frame: 3, kind: "nano", piece: "nozzle" })).toBe(
    "Nano spray from nozzle",
  );
  expect(describeOutput({ frame: 3, kind: "nano", piece: null })).toBe(
    "Nano spray from no piece",
  );
});
```

Add `isMarked` to the file's import from `./scriptMarks`.

In `src/lego/scriptPlayback.test.ts`:

```ts
describe("nano spans", () => {
  function span(id: string) {
    const scenario = scenarioById(id);
    if (!scenario) throw new Error(`no scenario ${id}`);
    const frames = (name: string) =>
      scenario.events.filter((e) => e.callin === name).map((e) => e.frame);
    const engine = (name: string) =>
      scenario.events.filter((e) => e.engine === name).map((e) => e.frame);
    return { scenario, frames, engine };
  }

  it("sprays for as long as a construction unit builds", () => {
    const { scenario, frames, engine } = span("building");
    expect(scenario.nano).toBe("builder");
    expect(engine("nano-start")).toEqual(frames("StartBuilding"));
    expect(engine("nano-stop")).toEqual(frames("StopBuilding"));
  });

  it("sprays for as long as a factory builds", () => {
    const { scenario, frames, engine } = span("building-factory");
    expect(scenario.nano).toBe("factory");
    expect(engine("nano-start")).toEqual(frames("StartBuilding"));
    expect(engine("nano-stop")).toEqual(frames("StopBuilding"));
  });
});
```

Import `scenarioById` if the file does not already.

- [ ] **Step 2: Run them to see them fail**

Run: `bunx vitest run src/lego/scriptMarks.test.ts src/lego/scriptPlayback.test.ts`
Expected: FAIL on the new cases, and type errors on `kind: "nano"`.

- [ ] **Step 3: Types and scenarios**

In `scriptPlayback.ts`:

`ScriptEvent.engine` becomes `engine?: "attach" | "detach" | "nano-start" | "nano-stop";` and its comment gains:

```ts
   * `nano-start` and `nano-stop` bracket the frames a builder sprays nano on.
   * The runtime asks `QueryNanoPiece` on each of them, through the engine's
   * cache (`rts/Sim/Misc/NanoPieceCache.cpp:17-50`).
```

Add to `ScriptOutput`:

```ts
  | { frame: number; kind: "nano"; piece: string | null } // null when no piece is named yet
```

Above `Scenario`:

```ts
/** How a unit sprays nano, which sets the particle's speed and spread: a
 *  construction unit's at 3 elmos a frame, a factory's at 1
 *  (`rts/Sim/Projectiles/ProjectileHandler.cpp:670-746`). */
export type NanoStyle = "builder" | "factory";
```

In `Scenario`, after `standIn`:

```ts
  /** How this scenario's unit sprays nano, when it does. */
  nano?: NanoStyle;
```

In `building`, add `nano: "builder",` after `description`, and after each `StartBuilding` and `StopBuilding` event add the engine event on the same frame:

```ts
      { frame: at(0.5), engine: "nano-start" },
      ...
      { frame: at(5), engine: "nano-stop" },
      ...
      { frame: at(6.5), engine: "nano-start" },
      ...
      { frame: at(11), engine: "nano-stop" },
```

In `building-factory`, add `nano: "factory",` and:

```ts
      { frame: at(2), engine: "nano-start" },
      { frame: at(11), engine: "nano-stop" },
```

each straight after its `StartBuilding` or `StopBuilding`.

- [ ] **Step 4: Marks**

In `scriptMarks.ts`, replace the module comment's second paragraph with:

```ts
 * Nano spray is not marked. A build span records it on every frame, which
 * would bury everything else, and `StartBuilding` already says where it starts.
```

Add:

```ts
/** Whether an event gets a mark under the scrubber. */
export function isMarked(event: ScriptOutput): boolean {
  return event.kind !== "nano";
}
```

In `scrubberMarks`, first line of the loop body: `if (!isMarked(event)) continue;`

In `describeOutput`, add:

```ts
    case "nano":
      return event.piece === null
        ? "Nano spray from no piece"
        : `Nano spray from ${event.piece}`;
```

In `AnimationPanel.tsx:656`, the condition becomes `timeline && timeline.events.some(isMarked)`, importing `isMarked` from `../../scriptMarks`.

- [ ] **Step 5: Carry the style to the viewport**

In `standInPlayback.ts`, add to `StandInPlacement`:

```ts
  /** How the running scenario's unit sprays nano at the stand-in, or null
   *  when it does not. */
  nano?: NanoStyle | null;
```

importing `NanoStyle` alongside `StandInTrack`.

In `AnimationPanel.tsx`, the `onStandIn` placement type at `:226-229` and `NO_STAND_IN` at `:91-95` gain `nano?: NanoStyle | null`. At `:457` pass `onStandIn({ track, attachPieces: named, nano: scenario.nano ?? null })`.

In `BuilderPage.tsx:211-214`, the state type gains `nano?: NanoStyle | null`. Both files import `type NanoStyle` from the `scriptPlayback` module they already import from.

- [ ] **Step 6: Run the tests and the type check**

Run: `bunx vitest run src/lego/scriptMarks.test.ts src/lego/scriptPlayback.test.ts && bun run typecheck`
Expected: pass. A `switch` elsewhere on `ScriptOutput.kind` that the type check flags gets a `nano` case in the same style.

- [ ] **Step 7: Commit**

```bash
git add src/lego/scriptPlayback.ts src/lego/scriptMarks.ts src/lego/scriptMarks.test.ts src/lego/scriptPlayback.test.ts src/lego/pages/components/AnimationPanel.tsx src/lego/pages/BuilderPage.tsx src/lego/pages/components/standInPlayback.ts
git commit -m "Spray nano in the building scenarios, and keep it off the scrubber marks"
```

---

### Task 5: Particles as a pure function of the frame

**Files:**
- Create: `src/lego/effects.ts`
- Test: `src/lego/effects.test.ts`

**Interfaces:**
- Consumes: `NanoStyle` from `./scriptPlayback`.
- Produces:

```ts
export type Vec3 = [number, number, number]
export interface NanoEmission {
  kind: "nano"
  birth: number
  at: Vec3
  to: Vec3
  /** Half the buildee's radius, as `Builder.cpp:353` passes it. */
  radius: number
  style: NanoStyle
  seed: number
}
export type Emission = NanoEmission
export interface Particles {
  count: number
  centers: Float32Array // 3 per particle
  halfSizes: Float32Array // 1 per particle
  colors: Float32Array // 3 per particle, sRGB 0 to 1
}
export function unitFloat(seed: number, draw: number): number
export function particlesAt(emissions: Emission[], frame: number): Particles
```

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from "vitest";
import { type Emission, particlesAt, unitFloat } from "./effects";

function nano(birth: number, overrides: Partial<Emission> = {}): Emission {
  return {
    kind: "nano",
    birth,
    at: [0, 0, 0],
    to: [30, 0, 0],
    radius: 5,
    style: "builder",
    seed: birth,
    ...overrides,
  };
}

describe("unitFloat", () => {
  it("is the same for the same seed and draw, and in [0, 1)", () => {
    expect(unitFloat(7, 2)).toBe(unitFloat(7, 2));
    for (let draw = 0; draw < 200; draw++) {
      const value = unitFloat(3, draw);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
    expect(unitFloat(7, 2)).not.toBe(unitFloat(8, 2));
  });
});

describe("particlesAt", () => {
  it("gives the same particles for the same frame, every time", () => {
    const emissions = [nano(0), nano(1), nano(2)];
    expect(particlesAt(emissions, 5)).toEqual(particlesAt(emissions, 5));
  });

  it("does not depend on the order frames were visited in", () => {
    const emissions = [nano(0), nano(4), nano(9)];
    const forwards = [3, 7, 12].map((frame) => particlesAt(emissions, frame));
    const backwards = [12, 7, 3].map((frame) => particlesAt(emissions, frame));
    expect(backwards.reverse()).toEqual(forwards);
  });

  /** `int(len / 3)` frames at 3 elmos a frame (`ProjectileHandler.cpp:742`),
   *  gone once the frame reaches its death frame (`NanoProjectile.cpp:71-77`). */
  it("lives len / 3 frames for a builder, starting where it was emitted", () => {
    const emissions = [nano(10)];
    expect(particlesAt(emissions, 9).count).toBe(0);
    const born = particlesAt(emissions, 10);
    expect(born.count).toBe(1);
    expect(Array.from(born.centers)).toEqual([0, 0, 0]);
    expect(particlesAt(emissions, 19).count).toBe(1);
    expect(particlesAt(emissions, 20).count).toBe(0);
  });

  it("moves a builder's particle three elmos a frame, give or take its jitter", () => {
    const later = particlesAt([nano(0)], 5);
    const x = later.centers[0];
    expect(x).toBeGreaterThan(15 * 0.8);
    expect(x).toBeLessThan(15 * 1.2);
  });

  /** A factory's lives `int(len)` frames at 1 elmo a frame (`:703`). */
  it("lives len frames for a factory", () => {
    const emissions = [nano(0, { style: "factory" })];
    expect(particlesAt(emissions, 29).count).toBe(1);
    expect(particlesAt(emissions, 30).count).toBe(0);
  });

  it("varies its green from particle to particle, around the nano colour", () => {
    const emissions = Array.from({ length: 20 }, (_, birth) => nano(birth));
    const { colors, count } = particlesAt(emissions, 20);
    const greens = Array.from({ length: count }, (_, i) => colors[i * 3 + 1]);
    expect(new Set(greens).size).toBeGreaterThan(1);
    for (let i = 0; i < count; i++) {
      expect(colors[i * 3 + 1]).toBeGreaterThanOrEqual(colors[i * 3]);
    }
  });

  it("draws nothing for an emission with nowhere to go", () => {
    expect(particlesAt([nano(0, { to: [0, 0, 0] })], 0).count).toBe(0);
  });
});
```

The jitter test bounds are loose on purpose. A builder's jitter is `radius / len` of the direction, here 5 / 30, so the along-track speed stays within about a sixth of 3.

- [ ] **Step 2: Run them to see them fail**

Run: `bunx vitest run src/lego/effects.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Write `effects.ts`**

```ts
/**
 * What a unit script emits, as particles on one frame.
 *
 * Pure: a frame and the emissions resolved from a run give the same particles
 * every time, whatever order the frames were visited in, because a preview is
 * scrubbed and an accumulating simulation would draw something different on
 * every visit. Each particle is a closed form of how long ago it was emitted.
 * The engine's random draws come from `unitFloat`, never `Math.random`.
 *
 * Nano moves as Recoil moves it (`rts/Sim/Projectiles/ProjectileHandler.cpp:670-746`)
 * and is drawn as Total Annihilation drew it: opaque dots with no alpha and a
 * little variation in colour. That is the user's choice, recorded in the spec.
 */

import type { NanoStyle } from "./scriptPlayback";

export type Vec3 = [number, number, number];

export interface NanoEmission {
  kind: "nano";
  /** The frame it was emitted on. */
  birth: number;
  /** The nano piece's origin, world space. */
  at: Vec3;
  /** The buildee's middle, world space. */
  to: Vec3;
  /** Half the buildee's radius, as `Builder.cpp:353` passes it. */
  radius: number;
  style: NanoStyle;
  seed: number;
}

export type Emission = NanoEmission;

export interface Particles {
  count: number;
  /** Three per particle. */
  centers: Float32Array;
  /** One per particle, in elmos. */
  halfSizes: Float32Array;
  /** Three per particle, sRGB from 0 to 1. */
  colors: Float32Array;
}

/** `UnitDef::nanoColor`'s default (`rts/Sim/Units/UnitDef.cpp:513`). */
const NANO_COLOR: Vec3 = [0.2, 0.7, 0.2];

/**
 * Half the width of a TA nano dot, in elmos. Set by eye against the user's
 * Total Annihilation screenshots, starting from Recoil's nano draw radius of 3
 * (`NanoProjectile.cpp:52`). TA's own value is not available.
 */
const NANO_DOT_HALF_SIZE = 3;

/** How far a dot's brightness strays from the nano colour, either way. Set by
 *  eye against the TA screenshots. */
const NANO_BRIGHTNESS_SPREAD = 0.3;

/** How often a dot is a near-white highlight, and how near. Set by eye
 *  against the TA screenshots. */
const NANO_HIGHLIGHT_CHANCE = 0.06;
const NANO_HIGHLIGHT_MIX = 0.6;

/** A number in [0, 1) that is the same for the same seed and draw. */
export function unitFloat(seed: number, draw: number): number {
  let x = Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(draw + 1, 0xc2b2ae35);
  x ^= x >>> 16;
  x = Math.imul(x, 0x7feb352d);
  x ^= x >>> 15;
  x = Math.imul(x, 0x846ca68b);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}

/**
 * The engine's `NextVector`: a point uniform in the unit ball
 * (`rts/System/GlobalRNG.h:151-161`). The engine rejects points outside the
 * ball, which draws an unknown number of times. This draws three and maps
 * them to the same distribution, so it always takes the same draws.
 */
function ballPoint(seed: number, first: number): Vec3 {
  const z = unitFloat(seed, first) * 2 - 1;
  const angle = unitFloat(seed, first + 1) * Math.PI * 2;
  const r = Math.cbrt(unitFloat(seed, first + 2));
  const ring = Math.sqrt(1 - z * z);
  return [r * ring * Math.cos(angle), r * z, r * ring * Math.sin(angle)];
}

interface NanoMotion {
  speed: Vec3;
  life: number;
}

/** Where a nano particle goes and for how long, from
 *  `CProjectileHandler::AddNanoParticle` (`ProjectileHandler.cpp:686-703,724-745`). */
function nanoMotion(emission: NanoEmission): NanoMotion | null {
  const d: Vec3 = [
    emission.to[0] - emission.at[0],
    emission.to[1] - emission.at[1],
    emission.to[2] - emission.at[2],
  ];
  const len = Math.hypot(...d);
  if (len === 0) return null;
  const builder = emission.style === "builder";
  const jitter = builder ? emission.radius / len : 0.15;
  const pace = builder ? 3 : 1;
  const wobble = ballPoint(emission.seed, 0);
  const speed: Vec3 = [
    (d[0] / len + wobble[0] * jitter) * pace,
    (d[1] / len + wobble[1] * jitter) * pace,
    (d[2] / len + wobble[2] * jitter) * pace,
  ];
  return { speed, life: Math.trunc(builder ? len / 3 : len) };
}

/** A TA nano dot's colour: the nano colour, a little brighter or darker, and
 *  now and then close to white. */
function nanoColor(seed: number): Vec3 {
  const brightness = 1 + (unitFloat(seed, 3) * 2 - 1) * NANO_BRIGHTNESS_SPREAD;
  const lit = NANO_COLOR.map((c) => Math.min(1, c * brightness)) as Vec3;
  if (unitFloat(seed, 4) >= NANO_HIGHLIGHT_CHANCE) return lit;
  return lit.map((c) => c + (1 - c) * NANO_HIGHLIGHT_MIX) as Vec3;
}

export function particlesAt(emissions: Emission[], frame: number): Particles {
  const centers: number[] = [];
  const halfSizes: number[] = [];
  const colors: number[] = [];
  for (const emission of emissions) {
    const age = frame - emission.birth;
    if (age < 0) continue;
    const motion = nanoMotion(emission);
    if (!motion || age >= motion.life) continue;
    centers.push(
      emission.at[0] + motion.speed[0] * age,
      emission.at[1] + motion.speed[1] * age,
      emission.at[2] + motion.speed[2] * age,
    );
    halfSizes.push(NANO_DOT_HALF_SIZE);
    colors.push(...nanoColor(emission.seed));
  }
  return {
    count: halfSizes.length,
    centers: new Float32Array(centers),
    halfSizes: new Float32Array(halfSizes),
    colors: new Float32Array(colors),
  };
}
```

- [ ] **Step 4: Run the tests**

Run: `bunx vitest run src/lego/effects.test.ts`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/lego/effects.ts src/lego/effects.test.ts
git commit -m "Nano particles as a closed form of the frame, drawn the TA way"
```

---

### Task 6: The dot layer

**Files:**
- Create: `src/lego/pages/components/effectsLayer.ts`
- Test: `src/lego/pages/components/effectsLayer.dom.test.ts`

**Interfaces:**
- Consumes: `Particles` from `../../effects`.
- Produces:

```ts
export interface EffectsLayer {
  object: THREE.Mesh
  update(particles: Particles): void
  dispose(): void
}
export function buildEffectsLayer(): EffectsLayer
```

- [ ] **Step 1: Write the failing test**

```ts
// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { buildEffectsLayer } from "./effectsLayer";

function particles(count: number) {
  return {
    count,
    centers: new Float32Array(Array.from({ length: count * 3 }, (_, i) => i)),
    halfSizes: new Float32Array(count).fill(3),
    colors: new Float32Array(count * 3).fill(0.5),
  };
}

describe("buildEffectsLayer", () => {
  it("draws as many dots as it is given, growing past its first size", () => {
    const layer = buildEffectsLayer();
    const geometry = layer.object.geometry as THREE.InstancedBufferGeometry;

    layer.update(particles(2));
    expect(geometry.instanceCount).toBe(2);
    expect(Array.from(geometry.getAttribute("center").array).slice(0, 6)).toEqual([
      0, 1, 2, 3, 4, 5,
    ]);

    layer.update(particles(500));
    expect(geometry.instanceCount).toBe(500);
    expect(geometry.getAttribute("center").array[1499]).toBe(1499);

    layer.update(particles(0));
    expect(geometry.instanceCount).toBe(0);
    layer.dispose();
  });

  it("is never culled, since its bounds are one quad at the origin", () => {
    expect(buildEffectsLayer().object.frustumCulled).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `bunx vitest run src/lego/pages/components/effectsLayer.dom.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Write `effectsLayer.ts`**

```ts
/**
 * The dots a unit script's effects are drawn with.
 *
 * One instanced quad per particle, turned to face the camera in the vertex
 * shader, so orbiting the camera, which re-renders without a new frame, needs
 * no rebuild. Opaque and hard edged, which is how Total Annihilation drew nano.
 */

import * as THREE from "three";
import type { Particles } from "../../effects";

export interface EffectsLayer {
  object: THREE.Mesh;
  update(particles: Particles): void;
  dispose(): void;
}

const VERTEX = /* glsl */ `
attribute vec3 center;
attribute float halfSize;
attribute vec3 tint;
varying vec2 vCorner;
varying vec3 vTint;
void main() {
  vec4 view = modelViewMatrix * vec4(center, 1.0);
  view.xy += position.xy * halfSize;
  gl_Position = projectionMatrix * view;
  vCorner = position.xy;
  vTint = tint;
}
`;

/** The colour goes out as it came in. It is sRGB already, so no colour space
 *  conversion is included. */
const FRAGMENT = /* glsl */ `
varying vec2 vCorner;
varying vec3 vTint;
void main() {
  if (dot(vCorner, vCorner) > 1.0) discard;
  gl_FragColor = vec4(vTint, 1.0);
}
`;

export function buildEffectsLayer(): EffectsLayer {
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3),
  );
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  let capacity = 0;
  const grow = (count: number) => {
    capacity = Math.max(count, capacity * 2, 64);
    geometry.setAttribute("center", new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3));
    geometry.setAttribute("halfSize", new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1));
    geometry.setAttribute("tint", new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3));
  };
  grow(0);
  geometry.instanceCount = 0;

  const material = new THREE.ShaderMaterial({
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
  });
  const object = new THREE.Mesh(geometry, material);
  object.frustumCulled = false;

  return {
    object,
    update(particles) {
      if (particles.count > capacity) grow(particles.count);
      const write = (name: string, values: Float32Array) => {
        const attribute = geometry.getAttribute(name) as THREE.InstancedBufferAttribute;
        (attribute.array as Float32Array).set(values);
        attribute.needsUpdate = true;
      };
      write("center", particles.centers);
      write("halfSize", particles.halfSizes);
      write("tint", particles.colors);
      geometry.instanceCount = particles.count;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}
```

The `64` floor is an allocation size, not a limit: `grow` always makes room for whatever count arrives.

- [ ] **Step 4: Run the test**

Run: `bunx vitest run src/lego/pages/components/effectsLayer.dom.test.ts`
Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/lego/pages/components/effectsLayer.ts src/lego/pages/components/effectsLayer.dom.test.ts
git commit -m "An instanced layer of camera-facing dots for script effects"
```

---

### Task 7: Resolve nano outputs to emissions, and place them each frame

**Files:**
- Create: `src/lego/pages/components/effectsPlayback.ts`
- Modify: `src/lego/pages/components/standInPlayback.ts` (export `groupOfPiece` at `:174`)
- Modify: `src/lego/pages/components/sceneState.ts` (`SceneState` beside `standInRadius` at `:78`)
- Test: `src/lego/pages/components/ModelViewport.dom.test.tsx`, inside `describe("placeStandIn")` after its last test, where `standInScene`, `doc` and `run` are in scope

**Interfaces:**
- Consumes: `particlesAt`, `Emission` (Task 5), `EffectsLayer` (Task 6), `StandInPlacement`, `placeStandIn`, `groupOfPiece`, `applyTimelineFrame`, `STAND_IN_MID_Y` from `../../standIn`.
- Produces:

```ts
export function placeEffects(
  state: SceneState,
  project: LegoProject,
  standIn: StandInPlacement,
  show: boolean,
  timeline: ScriptTimeline | null,
  frame: number,
): void
```

and `SceneState.effects: EffectsLayer`.

- [ ] **Step 1: Write the failing tests**

```ts
  describe("placeEffects", () => {
    const beside: StandInPlacement = {
      track: { keys: [{ frame: 0, pos: [1, 0, 2] }] },
      attachPieces: new Map(),
      show: true,
      nano: "builder",
    };

    function sprayScene(): SceneState {
      const state = standInScene();
      (state as { effects: EffectsLayer }).effects = buildEffectsLayer();
      return state;
    }

    function geometry(state: SceneState) {
      return state.effects.object.geometry as THREE.InstancedBufferGeometry;
    }

    it("sprays from the nano piece on the frame it was emitted", () => {
      const state = sprayScene();
      const timeline = run(40, () => 0, [
        { frame: 5, kind: "nano", piece: "arm" },
      ]);
      placeEffects(state, doc, beside, true, timeline, 5);

      expect(state.effects.object.visible).toBe(true);
      expect(geometry(state).instanceCount).toBe(1);
      expect(Array.from(geometry(state).getAttribute("center").array).slice(0, 3)).toEqual([0, 4, 0]);
    });

    /** The engine places a frame-N emission where the pieces were at the end
     *  of frame N - 1's animation. */
    it("uses the pose of the frame before", () => {
      const state = sprayScene();
      const timeline = run(40, (frame) => frame, [
        { frame: 5, kind: "nano", piece: "arm" },
      ]);
      placeEffects(state, doc, beside, true, timeline, 5);

      expect(geometry(state).getAttribute("center").array[0]).toBe(4);
    });

    it("leaves the scene posed on the frame it was asked for", () => {
      const state = sprayScene();
      const timeline = run(40, (frame) => frame, [
        { frame: 5, kind: "nano", piece: "arm" },
      ]);
      applyTimelineFrame(state, doc, timeline, 12);
      placeEffects(state, doc, beside, true, timeline, 12);

      expect(state.groups.get("arm")?.position.x).toBe(12);
    });

    it("draws nothing for a scenario that does not spray, or with the toggle off", () => {
      const timeline = run(40, () => 0, [{ frame: 5, kind: "nano", piece: "arm" }]);
      const quiet = sprayScene();
      placeEffects(quiet, doc, { ...beside, nano: null }, true, timeline, 5);
      expect(geometry(quiet).instanceCount).toBe(0);

      const hidden = sprayScene();
      placeEffects(hidden, doc, beside, false, timeline, 5);
      expect(hidden.effects.object.visible).toBe(false);
    });

    it("sprays at the stand-in even while the stand-in is hidden", () => {
      const state = sprayScene();
      const timeline = run(40, () => 0, [{ frame: 5, kind: "nano", piece: "arm" }]);
      placeEffects(state, doc, { ...beside, show: false }, true, timeline, 5);
      expect(geometry(state).instanceCount).toBe(1);
      expect(state.standIn.visible).toBe(false);
    });
  });
```

Add imports at the top of the file: `placeEffects` from `./effectsPlayback`, `buildEffectsLayer` and `type EffectsLayer` from `./effectsLayer`, `type StandInPlacement` from `./standInPlayback`, `applyTimelineFrame` from `./animationPlayback` if not already imported.

- [ ] **Step 2: Run them to see them fail**

Run: `bunx vitest run src/lego/pages/components/ModelViewport.dom.test.tsx -t placeEffects`
Expected: FAIL, module not found.

- [ ] **Step 3: Add `effects` to `SceneState` and export `groupOfPiece`**

In `sceneState.ts`, after `standInRadius`:

```ts
  /** The dots a script's effects are drawn with. A view aid, never exported. */
  effects: EffectsLayer;
```

importing `type EffectsLayer` from `./effectsLayer`. In `standInPlayback.ts`, `function groupOfPiece` becomes `export function groupOfPiece`.

- [ ] **Step 4: Write `effectsPlayback.ts`**

```ts
/**
 * Draw what a running script emitted, on one frame.
 *
 * Called beside `placeStandIn`, from the same two places. Where each emission
 * starts and what it aims at is worked out once per timeline, by posing the
 * scene on the frame before it, then putting the scene back, the way
 * `releasePoint` reads a release. After that every frame is `particlesAt`,
 * so scrubbing back to a frame draws what it drew before.
 */

import * as THREE from "three";

import { type Emission, particlesAt, type Vec3 } from "../../effects";
import type { LegoProject } from "../../model";
import type { NanoStyle, ScriptTimeline } from "../../scriptPlayback";
import { STAND_IN_MID_Y } from "../../standIn";
import { applyTimelineFrame } from "./animationPlayback";
import type { SceneState } from "./sceneState";
import { groupOfPiece, placeStandIn, type StandInPlacement } from "./standInPlayback";

const AT = new THREE.Vector3();
const NOTHING = particlesAt([], 0);

interface Resolved {
  radius: number;
  nano: NanoStyle;
  emissions: Emission[];
}

/** Emissions already worked out, per timeline. A new run is a new timeline.
 *  Kept alongside what they depend on besides the run, so a stand-in resized
 *  under the same run is worked out again. */
const RESOLVED = new WeakMap<ScriptTimeline, Resolved>();

export function placeEffects(
  state: SceneState,
  project: LegoProject,
  standIn: StandInPlacement,
  show: boolean,
  timeline: ScriptTimeline | null,
  frame: number,
): void {
  state.effects.object.visible = show;
  const nano = standIn.nano ?? null;
  if (!show || !timeline || !nano || !standIn.track) {
    state.effects.update(NOTHING);
    return;
  }
  const emissions = resolve(state, project, standIn, nano, timeline, frame);
  state.effects.update(particlesAt(emissions, frame));
}

function resolve(
  state: SceneState,
  project: LegoProject,
  standIn: StandInPlacement,
  nano: NanoStyle,
  timeline: ScriptTimeline,
  frame: number,
): Emission[] {
  const known = RESOLVED.get(timeline);
  if (known && known.radius === state.standInRadius && known.nano === nano) {
    return known.emissions;
  }

  // The stand-in is where the spray goes whether or not it is being shown.
  const seen = { ...standIn, show: true };
  const emissions: Emission[] = [];
  let posed = -1;
  timeline.events.forEach((event, seed) => {
    if (event.kind !== "nano" || event.piece === null) return;
    const group = groupOfPiece(state, project, event.piece);
    if (!group) return;
    const before = Math.max(event.frame - 1, 0);
    if (before !== posed) {
      applyTimelineFrame(state, project, timeline, before);
      placeStandIn(state, project, seen, timeline, before);
      posed = before;
    }
    group.updateWorldMatrix(true, false);
    group.getWorldPosition(AT);
    const at: Vec3 = [AT.x, AT.y, AT.z];
    const to: Vec3 = [
      state.standIn.position.x,
      state.standIn.position.y + STAND_IN_MID_Y * state.standInRadius,
      state.standIn.position.z,
    ];
    emissions.push({
      kind: "nano",
      birth: event.frame,
      at,
      to,
      radius: state.standInRadius * 0.5,
      style: nano,
      seed,
    });
  });
  if (posed !== -1) {
    applyTimelineFrame(state, project, timeline, frame);
    placeStandIn(state, project, standIn, timeline, frame);
  }

  RESOLVED.set(timeline, { radius: state.standInRadius, nano, emissions });
  return emissions;
}
```

`timeline.events` are in frame order, so posing only when the frame changes poses each spraying frame once.

- [ ] **Step 5: Run the tests**

Run: `bunx vitest run src/lego/pages/components/ModelViewport.dom.test.tsx`
Expected: all pass, the new `placeEffects` cases included.

- [ ] **Step 6: Commit**

```bash
git add src/lego/pages/components/effectsPlayback.ts src/lego/pages/components/standInPlayback.ts src/lego/pages/components/sceneState.ts src/lego/pages/components/ModelViewport.dom.test.tsx
git commit -m "Place nano emissions from the pose of the frame before, once per run"
```

---

### Task 8: Wire the layer into the viewport, with a toggle

**Files:**
- Modify: `src/lego/pages/components/ModelViewport.tsx` (lucide import at `:28-34`, stand-in build at `:649-655`, state at `:842-844`, teardown at `:1018-1020`, `showStandIn` at `:532`, `useScriptFrameStepping` call at `:1075-1090`, stand-in toggle at `:1376-1382`)
- Modify: `src/lego/pages/components/useScriptFrameStepping.ts`

**Interfaces:**
- Consumes: `buildEffectsLayer` (Task 6), `placeEffects` (Task 7).
- Produces: `ScriptFrameSteppingDeps.showEffects: boolean`.

- [ ] **Step 1: Stepping**

In `useScriptFrameStepping.ts`, add `showEffects: boolean` to `ScriptFrameSteppingDeps` with the comment `/** The viewport's effects toggle. */`, destructure it, and keep it in a ref beside `standInRef`:

```ts
  const showEffectsRef = useRef(showEffects);
  showEffectsRef.current = showEffects;
```

In the tick, straight after `placeStandIn(...)`:

```ts
          placeEffects(
            state,
            projectRef.current,
            standInRef.current,
            showEffectsRef.current,
            timeline,
            frameAt(timeline, elapsed),
          );
```

In the presets branch, after `state.standIn.visible = false;`: `state.effects.object.visible = false;`. In the cleanup, after `current.standIn.visible = false;`: `current.effects.object.visible = false;`.

In the paused effect, after `placeStandIn(...)`:

```ts
    placeEffects(state, projectRef.current, standIn, showEffects, scriptTimeline, frame);
```

and add `showEffects` to that effect's dependency list. Import `placeEffects` from `./effectsPlayback`.

- [ ] **Step 2: Viewport**

In `ModelViewport.tsx`:

- Add `Sparkles` to the lucide import.
- After `scene.add(standInGroup);`:

```ts
      // The dots a script's effects are drawn with. Hidden until a run that
      // emits something plays.
      const effects = buildEffectsLayer();
      effects.object.visible = false;
      scene.add(effects.object);
```

- In the state object after `standInRadius: radius,`: `effects,`
- In the teardown after `state.disposeStandIn();`: `state.effects.dispose();`
- After `const [showStandIn, setShowStandIn] = useState(true);`: `const [showEffects, setShowEffects] = useState(true);`
- In the `useScriptFrameStepping` call, after the `standIn:` line: `showEffects,`
- After the stand-in `ViewToggle`:

```tsx
            <ViewToggle
              icon={Sparkles}
              on={showEffects}
              onChange={setShowEffects}
              hideTitle="Hide script effects"
              showTitle="Show script effects, such as nano spray, from the unit's own script"
            />
```

Import `buildEffectsLayer` from `./effectsLayer`.

- [ ] **Step 3: Type check and the viewport tests**

Run: `bun run typecheck && bunx vitest run src/lego/pages/components/`
Expected: pass. A test that builds a full `SceneState` through the real viewport now gets `effects` from the build.

- [ ] **Step 4: Commit**

```bash
git add src/lego/pages/components/ModelViewport.tsx src/lego/pages/components/useScriptFrameStepping.ts
git commit -m "Draw nano spray in the viewport, with a toggle beside the stand-in's"
```

---

### Task 9: The full check suite and the screen

**Files:** none new.

- [ ] **Step 1: Run all seven CI commands**

```bash
bunx biome ci .
bun run typecheck
bun run test
scripts/mission-tests.sh
cargo fmt --all --check
cargo clippy --all-targets -- -D warnings
cargo test --workspace
```

Expected: every one passes. Fix any failure in the task that caused it and commit the fix separately. `cargo fmt --all` fixes formatting.

- [ ] **Step 2: Look at it on screen**

Follow "Driving the app" in `CLAUDE.md` and the `separate-target-dir-dev-instance` memory: a seeded portable instance, its own port and socket, a second MCP server over stdio. Import a Balanced Annihilation construction unit (for example `armck`) and a factory (for example `armlab`) from the installed game.

Pass means:
1. Under `building`, a stream of opaque green dots, some lighter and some darker, runs from the nano nozzle to the stand-in's middle while it builds, and stops when it stops.
2. From both nozzles if the unit's `QueryNanoPiece` alternates.
3. Under `building-factory`, the factory's spray moves at a third of the speed.
4. Scrubbing back and forth over one frame shows the same dots each time.
5. The effects toggle hides and shows them.

Take screenshots of 1 and 3 for the user.

- [ ] **Step 3: Tune the TA look with the user**

Show the user the screenshots beside their TA screenshots. Adjust `NANO_DOT_HALF_SIZE`, `NANO_BRIGHTNESS_SPREAD`, `NANO_HIGHLIGHT_CHANCE` and `NANO_HIGHLIGHT_MIX` in `src/lego/effects.ts` as they direct, keeping the comments that say these are set by eye. Commit each change.

- [ ] **Step 4: Hand over**

Give the user a chance to try `bun tauri dev`, as `CLAUDE.md` asks, before any PR. Revert any local socket or port edits. Offer to clean up the portable instance's build output.
