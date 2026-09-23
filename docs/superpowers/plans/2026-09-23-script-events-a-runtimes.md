# Script events, part A: events and the passenger in both runtimes

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Both unit script runtimes record `EmitSfx`, `Explode`, sound, `AttachUnit` and `DropUnit` as frame-stamped events on the timeline, and carry the stand-in the way the engine carries a passenger, so a script that attaches it reads it on the piece from the next frame on.

**Architecture:** A `Passenger` type and a `ScriptOutput` event type live in `coilbox-unitpose` beside `Model`, and `Model` owns one of each, so the compiled and Lua runtimes record through the same methods and cannot drift. Each runtime decodes its own call forms, resolves pieces to model indexes, then calls `Model`. `Model::after_frame` runs after the frame's threads in both schedulers, which is the engine's `UpdatePostAnimation`. `unitvalue::world` and Lua's `Spring.GetUnitPosition` answer from the passenger once it has left `Loose`.

**Tech Stack:** Rust (`coilbox-unitpose`, `tauri-plugin-coilbox-anim`, `coilbox-springlua` on mlua), TypeScript for the one type mirror, vitest, bun.

**Spec:** `docs/superpowers/specs/2026-09-23-script-events-design.md`, sections 1 and 2 and testing items 1 to 3. Read it first. It carries the engine citations each decision rests on. This is the first of three plans. Part C (`2026-09-23-script-events-c-drawing.md`) lands second and part B (`2026-09-23-script-events-b-engine-attach.md`) third, for the reason given at the top of part B.

## Global constraints

- Before any push, run all seven CI commands from the repo root and confirm each passes: `bunx biome ci .`, `bun run typecheck`, `bun run test`, `scripts/mission-tests.sh`, `cargo fmt --all --check`, `cargo clippy --all-targets -- -D warnings`, `cargo test --workspace`. `luajit` must be on PATH.
- Let rustfmt own formatting. Run `cargo fmt --all` rather than formatting by hand.
- Do not `git rebase`. Update a branch by merging `origin/main` into it.
- Do not use worktrees. Work in the primary checkout.
- `git add` named files only. Never `git add -A`.
- Filing the PR goes through the `file-pr` skill, and the user approves the description before it is created. Give the user a chance to run `bun tauri dev` first.
- Comments match the surrounding code. They cite the engine file and line a behaviour comes from, as the existing code does.
- Notes shown to the user are plain English, sentence case, and have no semicolons.
- Pieces in events are named, never numbered. A name means the same in both runtimes.
- The engine's source is at `~/dev/RecoilEngine`. Read it rather than inferring engine behaviour.

## Settled here, beyond the spec

These are implementation details the spec left open. Each is settled from the code and the engine.

- **Sound is not in the cross-runtime event parity test.** This crate's BOS compiler writes TA-format files (version 4), which carry no sound table, so a compiled `play-sound` has no name to record. `bos2lua` turns `play-sound` into `Spring.PlaySoundFile("sounds/<name>.wav", ...)`. The two can never match. Sound is tested in each runtime on its own, against a hand-built TA:K file for COB.
- **A COB piece the model does not have counts as naming no piece** for the five calls. The run already notes that piece once at start (`cobrun.rs:355-361`), and nothing can ride a piece the model lacks.
- **Lua `EmitSfx` with a generator name** rather than a number is recorded as `SFX_GLOBAL` (16384) with a note. The engine looks the name up and ORs in `SFX_GLOBAL` (`LuaUnitScript.cpp:1430`). The preview has no generator list to look it up in.
- **A drop of a stand-in that is not carried does nothing** beyond being recorded, as `DetachUnitCore` refuses a unit it is not carrying (`Unit.cpp:2715-2720`). A second attach while carried moves it to the new piece (`Unit.cpp:2640-2654`).
- **`Passenger` carries its position in every non-loose state.** The spec's enum has `Released { at }` only, but a stand-in that has just been attached is still where it was until the frame ends, so `Riding` and `Void` need a position too.
- **The drop method is `release`, not `drop`.** Clippy's `should_implement_trait` rejects an inherent `drop`.
- **Until part C lands, the new note "Effects are marked on the scrubber, not drawn." describes marks that do not exist yet.** Part C is next in the queue, so this is a gap of one PR.

## Branch

`script-events-runtimes`, off `script-events-spec`, which already carries the spec and these three plans. PR A ships them.

```bash
git checkout script-events-spec
git checkout -b script-events-runtimes
```

---

### Task A1: the passenger, the event type and recording on `Model`

**Files:**
- Create: `crates/coilbox-unitpose/src/passenger.rs`
- Modify: `crates/coilbox-unitpose/src/lib.rs` (module list at line 18, `Timeline` at 120-190, `Model` at 263-455, tests at 536-619)

**Interfaces:**
- Produces, in `coilbox_unitpose`:
  - `pub enum Passenger { Loose, Riding { piece: usize, at: [f64; 3] }, Void { at: [f64; 3] }, Released { at: [f64; 3] } }`, `Default` is `Loose`, derives `Debug, Clone, Copy, PartialEq`.
  - `Passenger::at(&self) -> Option<[f64; 3]>`, none only for `Loose`.
  - `Passenger::attach(&mut self, piece: Option<usize>, loose_at: Option<[f64; 3]>)`, none is the void.
  - `Passenger::release(&mut self)`.
  - `Passenger::after_frame(&mut self, model: &Model)`.
  - `pub enum ScriptOutput` with variants `Attach { frame: u32, unit: i32, piece: Option<String> }`, `Drop { frame: u32, unit: i32 }`, `Sfx { frame: u32, piece: String, sfx: i32 }`, `Explode { frame: u32, piece: String, flags: i32 }`, `Sound { frame: u32, name: Option<String> }`. Serialises internally tagged as `kind`, lowercase.
  - `Timeline::events: Vec<ScriptOutput>`.
  - `Model::passenger: Passenger`, `Model::events: Vec<ScriptOutput>`.
  - `Model::no_such_piece(&mut self, call: &str, piece: i64)`.
  - `Model::emit_sfx(&mut self, frame: u32, piece: usize, sfx: i32)`.
  - `Model::explode(&mut self, frame: u32, piece: usize, flags: i32)`.
  - `Model::play_sound(&mut self, frame: u32, name: Option<String>)`.
  - `Model::attach_unit(&mut self, frame: u32, unit: i32, piece: Option<usize>, world: Option<&World>)`.
  - `Model::drop_unit(&mut self, frame: u32, unit: i32, world: Option<&World>)`.
  - `Model::after_frame(&mut self)`.
  - `pub const EFFECTS_NOTE: &str = "Effects are marked on the scrubber, not drawn."`

- [ ] **Step 1: Write the failing tests**

Add to `mod tests` in `crates/coilbox-unitpose/src/lib.rs`, after `a_parent_chain_that_loops_still_answers`. `placed()` there already puts `arm` (index 2) at `[4.0, 12.0, 0.0]`.

```rust
    fn scene(pos: [f64; 3]) -> World {
        World {
            stand_in: Some(StandIn {
                id: 2,
                pos: Some(pos),
                radius: 5.0,
                height: 6.0,
            }),
            own: Size {
                radius: 10.0,
                height: 12.0,
            },
        }
    }

    /// `CUnit::AttachUnit` records the piece and nothing else. The passenger
    /// moves once every script has ticked (`rts/Game/Game.cpp:1796-1798`).
    #[test]
    fn an_attach_does_not_move_the_stand_in_until_the_frame_ends() {
        let mut model = placed();
        model.attach_unit(0, 2, Some(2), Some(&scene([30.0, 0.0, 40.0])));

        assert_eq!(model.passenger.at(), Some([30.0, 0.0, 40.0]));
        model.after_frame();
        assert_eq!(model.passenger.at(), Some([4.0, 12.0, 0.0]));
    }

    /// A riding stand-in follows its piece frame by frame.
    #[test]
    fn a_riding_stand_in_follows_its_piece() {
        let mut model = placed();
        model.attach_unit(0, 2, Some(2), Some(&scene([30.0, 0.0, 40.0])));
        model.after_frame();
        model.pieces[1].pos[1] = 5.0;
        model.after_frame();

        assert_eq!(model.passenger.at(), Some([4.0, 17.0, 0.0]));
    }

    /// A negative piece puts a passenger at the transporter's own position
    /// (`rts/Sim/Units/Unit.cpp:726-732`), which is the origin here.
    #[test]
    fn the_void_is_the_origin() {
        let mut model = placed();
        model.attach_unit(0, 2, None, Some(&scene([30.0, 0.0, 40.0])));
        model.after_frame();

        assert_eq!(model.passenger, Passenger::Void { at: [0.0; 3] });
    }

    /// `DetachUnit` does not move the passenger (`Unit.cpp:2715-2780`).
    #[test]
    fn a_drop_keeps_the_last_position() {
        let mut model = placed();
        let world = scene([30.0, 0.0, 40.0]);
        model.attach_unit(0, 2, Some(2), Some(&world));
        model.after_frame();
        model.drop_unit(1, 2, Some(&world));
        model.pieces[1].pos[1] = 50.0;
        model.after_frame();

        assert_eq!(model.passenger, Passenger::Released { at: [4.0, 12.0, 0.0] });
    }

    /// A second attach while carried moves the passenger to the new piece
    /// (`Unit.cpp:2640-2654`), and still waits for the frame to end.
    #[test]
    fn a_second_attach_moves_to_the_new_piece() {
        let mut model = placed();
        let world = scene([30.0, 0.0, 40.0]);
        model.attach_unit(0, 2, Some(2), Some(&world));
        model.after_frame();
        model.attach_unit(1, 2, Some(1), Some(&world));

        assert_eq!(model.passenger.at(), Some([4.0, 12.0, 0.0]));
        model.after_frame();
        assert_eq!(model.passenger.at(), Some([0.0, 10.0, 0.0]));
    }

    /// `DetachUnitCore` refuses a unit it is not carrying (`Unit.cpp:2715-2720`).
    #[test]
    fn dropping_a_stand_in_nobody_carries_moves_nothing() {
        let mut model = placed();
        model.drop_unit(0, 2, Some(&scene([30.0, 0.0, 40.0])));

        assert_eq!(model.passenger, Passenger::Loose);
        assert_eq!(model.events, [ScriptOutput::Drop { frame: 0, unit: 2 }]);
    }

    /// The engine does nothing for an id with no unit behind it
    /// (`rts/Sim/Units/Scripts/UnitScript.cpp:838-841,852-855`), and the
    /// stand-in is the only other unit.
    #[test]
    fn attaching_another_unit_is_recorded_and_moves_nothing() {
        let mut model = placed();
        model.attach_unit(3, 7, Some(2), Some(&scene([30.0, 0.0, 40.0])));

        assert_eq!(model.passenger, Passenger::Loose);
        assert_eq!(
            model.events,
            [ScriptOutput::Attach {
                frame: 3,
                unit: 7,
                piece: Some("arm".to_string()),
            }]
        );
    }

    /// The engine asserts against a unit carrying itself (`Unit.cpp:2638`).
    #[test]
    fn attaching_the_unit_to_itself_is_noted() {
        let mut model = placed();
        model.attach_unit(0, unitvalue::UNIT_ID, Some(2), None);

        assert_eq!(model.passenger, Passenger::Loose);
        assert_eq!(model.events.len(), 1);
        assert!(model.warnings.iter().any(|w| w.contains("carry or drop itself")));
    }

    #[test]
    fn records_effects_by_piece_name() {
        let mut model = placed();
        model.emit_sfx(4, 2, 1025);
        model.explode(5, 1, 257);
        model.play_sound(6, Some("krogtaunt".to_string()));

        assert_eq!(
            model.events,
            [
                ScriptOutput::Sfx { frame: 4, piece: "arm".to_string(), sfx: 1025 },
                ScriptOutput::Explode { frame: 5, piece: "torso".to_string(), flags: 257 },
                ScriptOutput::Sound { frame: 6, name: Some("krogtaunt".to_string()) },
            ]
        );
    }

    /// The effects note is said only when there is an effect to mark. An
    /// attach on its own is not one.
    #[test]
    fn notes_effects_only_when_the_run_recorded_one() {
        let mut quiet = placed();
        quiet.attach_unit(0, 2, None, None);
        let mut timeline = Timeline::new(names(), 0);
        quiet.finish(&mut timeline);
        assert!(!timeline.warnings.iter().any(|w| w == EFFECTS_NOTE));
        assert_eq!(timeline.events.len(), 1);

        let mut loud = placed();
        loud.play_sound(0, None);
        let mut timeline = Timeline::new(names(), 0);
        loud.finish(&mut timeline);
        assert!(timeline.warnings.iter().any(|w| w == EFFECTS_NOTE));
    }

    /// The shape `ScriptTimeline.events` reads in `src/lego/scriptPlayback.ts`.
    #[test]
    fn serialises_an_event_the_way_the_panel_reads_it() {
        let attach = ScriptOutput::Attach { frame: 3, unit: 2, piece: None };
        assert_eq!(
            serde_json::to_value(&attach).unwrap(),
            serde_json::json!({ "kind": "attach", "frame": 3, "unit": 2, "piece": null })
        );
        let sfx = ScriptOutput::Sfx { frame: 1, piece: "flare".to_string(), sfx: 1025 };
        assert_eq!(
            serde_json::to_value(&sfx).unwrap(),
            serde_json::json!({ "kind": "sfx", "frame": 1, "piece": "flare", "sfx": 1025 })
        );
    }
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cargo test -p coilbox-unitpose`
Expected: compile errors naming `attach_unit`, `after_frame`, `passenger`, `ScriptOutput`, `EFFECTS_NOTE`. If `serde_json::json!` is reported missing, check `crates/coilbox-unitpose/Cargo.toml`: `serde_json` is already used by `world_tests`, so it is there as a dependency or dev-dependency.

- [ ] **Step 3: Write `passenger.rs`**

```rust
//! Where the stand-in is once a script has taken hold of it.
//!
//! The engine does not move a passenger when a script attaches it.
//! `CUnit::AttachUnit` records the piece and nothing else
//! (`rts/Sim/Units/Unit.cpp:2635-2712`). Every frame, once every script has
//! ticked, `UpdateTransportees` moves each passenger onto its piece
//! (`rts/Game/Game.cpp:1796-1798`, `Unit.cpp:718-757`). So a script that reads
//! its passenger straight after attaching it sees where the passenger was.
//!
//! Both runtimes carry the stand-in through this, so a script asking where it
//! is gets the same answer from either.

use crate::Model;

type Vec3 = [f64; 3];

/// What scripts have done with the stand-in, and where that leaves it.
///
/// Every state but `Loose` carries the stand-in's position, because from its
/// first attach the runtime owns where it is. A later event's scene still says
/// how big it is, but no longer where.
#[derive(Debug, Clone, Copy, PartialEq, Default)]
pub enum Passenger {
    /// Nothing has attached it. Where it is comes from the scene.
    #[default]
    Loose,
    /// Carried on a piece, by its index in the model.
    Riding { piece: usize, at: Vec3 },
    /// Carried out of sight. A negative piece puts a passenger at the
    /// transporter's own position and in the void, where it is not drawn
    /// (`Unit.cpp:726-732,2672`, `rts/Rendering/Units/UnitDrawer.cpp:418`).
    Void { at: Vec3 },
    /// Let go. A drop does not move it (`Unit.cpp:2715-2780`).
    Released { at: Vec3 },
}

impl Passenger {
    /// Where the stand-in is, or none while it is loose and the scene says.
    pub fn at(&self) -> Option<Vec3> {
        match *self {
            Self::Loose => None,
            Self::Riding { at, .. } | Self::Void { at } | Self::Released { at } => Some(at),
        }
    }

    /// Carry it on `piece`, or in the void when there is none.
    ///
    /// It stays where it is until [`Passenger::after_frame`] moves it.
    /// `loose_at` is where the scene has it, for a stand-in nothing has held
    /// yet. One the scene puts nowhere starts from the origin.
    pub fn attach(&mut self, piece: Option<usize>, loose_at: Option<Vec3>) {
        let at = self.at().or(loose_at).unwrap_or([0.0; 3]);
        *self = match piece {
            Some(piece) => Self::Riding { piece, at },
            None => Self::Void { at },
        };
    }

    /// Let it go where it is. A stand-in nobody is carrying is not let go
    /// again, as `DetachUnitCore` refuses a unit it is not carrying
    /// (`Unit.cpp:2715-2720`).
    pub fn release(&mut self) {
        if let Self::Riding { at, .. } | Self::Void { at } = *self {
            *self = Self::Released { at };
        }
    }

    /// Move a carried stand-in onto its piece, once every thread has run this
    /// frame, as `UpdateTransportees` does.
    ///
    /// A model nobody placed has no piece positions, and a riding stand-in
    /// then stays where it was rather than dropping to the origin.
    pub fn after_frame(&mut self, model: &Model) {
        match self {
            Self::Riding { piece, at } => {
                if let Some(now) = model.piece_position(*piece) {
                    *at = now;
                }
            }
            Self::Void { at } => *at = [0.0; 3],
            Self::Loose | Self::Released { .. } => {}
        }
    }
}
```

- [ ] **Step 4: Add the event type, the timeline field and the `Model` methods in `lib.rs`**

After `pub mod unitvalue;` at line 18:

```rust
pub mod passenger;

pub use passenger::Passenger;

/// Said once when a run recorded an effect, an explosion or a sound, none of
/// which the preview draws or plays.
pub const EFFECTS_NOTE: &str = "Effects are marked on the scrubber, not drawn.";
```

Before `pub struct Timeline` (line 120):

```rust
/// Something a script announced, on the frame it did.
///
/// Pieces are named rather than numbered, because a name means the same in
/// both runtimes and is what the viewport looks a piece up by.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum ScriptOutput {
    /// `attach-unit` or `AttachUnit`. `piece` is none for the void.
    Attach {
        frame: u32,
        unit: i32,
        piece: Option<String>,
    },
    /// `drop-unit` or `DropUnit`.
    Drop { frame: u32, unit: i32 },
    /// `emit-sfx` or `EmitSfx`, with the raw effect number. From 1024 it
    /// indexes the unit's own generator list, from 2048 it fires a weapon and
    /// from 4096 it detonates one (`rts/Sim/Units/Scripts/CobDefines.h:9-20`).
    /// The editor has no unit definition to name a generator from.
    Sfx { frame: u32, piece: String, sfx: i32 },
    /// `explode` or `Explode`, with the raw flags.
    Explode { frame: u32, piece: String, flags: i32 },
    /// A COB sound table entry or the Lua call's first argument. None for a
    /// compiled script with no sound table, which is a TA script rather than
    /// a TA:K one.
    Sound { frame: u32, name: Option<String> },
}

impl ScriptOutput {
    /// Whether this is something the preview would draw or play, as opposed
    /// to carrying the stand-in.
    fn is_effect(&self) -> bool {
        matches!(self, Self::Sfx { .. } | Self::Explode { .. } | Self::Sound { .. })
    }
}
```

In `Timeline`, after `offsets_run` (line 163):

```rust
    /// What the script announced, in frame order.
    #[serde(default)]
    pub events: Vec<ScriptOutput>,
```

and `events: Vec::new(),` in `Timeline::new` after `offsets_run: Vec::new(),`.

In `Model`, after `warnings` (line 274):

```rust
    /// What scripts have done with the stand-in.
    pub passenger: Passenger,
    /// What the script announced, in the order it did.
    pub events: Vec<ScriptOutput>,
```

In `impl Model`, after `set_hidden` (line 432):

```rust
    /// A piece a script named is not one of this unit's. The engine reports it
    /// and does nothing (`ShowUnitScriptError`), so nothing is recorded.
    pub fn no_such_piece(&mut self, call: &str, piece: i64) {
        self.note(format!(
            "{call} names piece {piece}, which this unit does not have, so it did nothing."
        ));
    }

    pub fn emit_sfx(&mut self, frame: u32, piece: usize, sfx: i32) {
        let piece = self.pieces[piece].name.clone();
        self.events.push(ScriptOutput::Sfx { frame, piece, sfx });
    }

    pub fn explode(&mut self, frame: u32, piece: usize, flags: i32) {
        let piece = self.pieces[piece].name.clone();
        self.events.push(ScriptOutput::Explode { frame, piece, flags });
    }

    pub fn play_sound(&mut self, frame: u32, name: Option<String>) {
        self.events.push(ScriptOutput::Sound { frame, name });
    }

    /// Attach a unit to `piece`, or to the void when there is none.
    ///
    /// Recorded whichever unit it names. Only the stand-in moves, because it is
    /// the only other unit there is, and the engine does nothing for an id
    /// with no unit behind it (`UnitScript.cpp:838-841`).
    pub fn attach_unit(&mut self, frame: u32, unit: i32, piece: Option<usize>, world: Option<&World>) {
        let name = piece.map(|piece| self.pieces[piece].name.clone());
        self.events.push(ScriptOutput::Attach { frame, unit, piece: name });
        if unit == unitvalue::UNIT_ID {
            self.carries_itself();
        } else if let Some(stand_in) = stand_in(unit, world) {
            self.passenger.attach(piece, stand_in.pos);
        }
    }

    /// Let a unit go. Recorded whichever unit it names, as an attach is
    /// (`UnitScript.cpp:852-855`).
    pub fn drop_unit(&mut self, frame: u32, unit: i32, world: Option<&World>) {
        self.events.push(ScriptOutput::Drop { frame, unit });
        if unit == unitvalue::UNIT_ID {
            self.carries_itself();
        } else if stand_in(unit, world).is_some() {
            self.passenger.release();
        }
    }

    /// The engine asserts against a unit carrying itself (`Unit.cpp:2638`).
    fn carries_itself(&mut self) {
        self.note(
            "This script tells the unit to carry or drop itself, which the engine does not allow, so nothing happened.".to_string(),
        );
    }

    /// Move the stand-in onto its piece once every thread has run this frame,
    /// which is the engine's `UpdatePostAnimation` (`rts/Game/Game.cpp:1796-1798`).
    pub fn after_frame(&mut self) {
        let mut passenger = std::mem::take(&mut self.passenger);
        passenger.after_frame(self);
        self.passenger = passenger;
    }
```

After `impl Model` closes, before `fn tick_rotate`:

```rust
/// The stand-in, when `unit` is its id.
fn stand_in(unit: i32, world: Option<&World>) -> Option<&StandIn> {
    world?.stand_in.as_ref().filter(|stand_in| stand_in.id == unit)
}
```

Replace `Model::finish` (lines 447-454):

```rust
    /// Close a timeline off: carry the warnings and events over, say once that
    /// effects are marked rather than drawn, and drop the visibility track when
    /// nothing ever used it.
    pub fn finish(&self, timeline: &mut Timeline) {
        timeline.warnings.extend(self.warnings.iter().cloned());
        timeline.events = self.events.clone();
        if self.events.iter().any(ScriptOutput::is_effect) {
            timeline.warnings.push(EFFECTS_NOTE.to_string());
        }
        if !self.visibility_used {
            timeline.hidden.clear();
        }
    }
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cargo test -p coilbox-unitpose`
Expected: all pass, including the eleven new ones.

- [ ] **Step 6: Commit**

```bash
git add crates/coilbox-unitpose/src/passenger.rs crates/coilbox-unitpose/src/lib.rs
git commit -m "Record what a script announces, and carry the stand-in as the engine does"
```

---

### Task A2: answer where a carried stand-in is

**Files:**
- Modify: `crates/coilbox-unitpose/src/unitvalue.rs:294-336` (`world`) and its tests at 515-610
- Modify: `crates/coilbox-unitpose/src/lib.rs` tests
- Modify, callers only: `crates/tauri-plugin-coilbox-anim/src/cobrun.rs:1143`, `crates/coilbox-springlua/src/unitscript.rs:2227`

**Interfaces:**
- Consumes: `Passenger::at` from A1.
- Produces: `pub fn world(id: i32, p1: i32, world: Option<&crate::World>, carried: Option<[f64; 3]>) -> Option<Answer>`. `carried` is `model.passenger.at()`. When it is some, it replaces `stand_in.pos`.

- [ ] **Step 1: Write the failing tests**

In `unitvalue.rs` tests, change the helper `value` (line 530) to pass `None` as the new fourth argument, and add `None` to every direct `world(...)` call in the tests (lines 559, 566, 578, 600). Then add:

```rust
    /// Once a script holds the stand-in, the runtime says where it is and the
    /// scene does not. Its size still comes from the scene.
    #[test]
    fn answers_a_carried_stand_in_from_where_it_is_carried() {
        let w = scene(Some([10.0, 2.0, 84.0]));
        let carried = Some([1.0, 2.0, 3.0]);
        assert_eq!(
            world(UNIT_XZ, 2, Some(&w), carried).map(|a| a.value),
            Some(pack_xz(1.0, 3.0))
        );
        assert_eq!(
            world(UNIT_Y, 2, Some(&w), carried).map(|a| a.value),
            Some(2 * 65536)
        );
        assert_eq!(
            world(UNIT_HEIGHT, 2, Some(&w), carried).map(|a| a.value),
            Some(28 * 65536)
        );
    }

    /// A scene that puts the stand-in nowhere does not matter once it is held.
    #[test]
    fn a_carried_stand_in_is_somewhere_even_when_the_scene_says_nowhere() {
        let answer = world(UNIT_XZ, 2, Some(&scene(None)), Some([1.0, 0.0, 3.0])).unwrap();
        assert_eq!(answer.value, pack_xz(1.0, 3.0));
        assert_eq!(answer.note, None);
    }
```

In `lib.rs` `mod tests`, add the spec's "a later snapshot does not move an attached stand-in":

```rust
    /// A later event's scene says where it last saw the stand-in, which is
    /// no longer where a held stand-in is.
    #[test]
    fn a_later_scene_does_not_move_an_attached_stand_in() {
        let mut model = placed();
        model.attach_unit(0, 2, Some(2), Some(&scene([30.0, 0.0, 40.0])));
        model.after_frame();
        let later = scene([90.0, 0.0, 90.0]);

        let answer = unitvalue::world(unitvalue::UNIT_XZ, 2, Some(&later), model.passenger.at());
        assert_eq!(answer.map(|a| a.value), Some(unitvalue::pack_xz(4.0, 0.0)));
    }
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cargo test -p coilbox-unitpose`
Expected: compile error, `world` takes 3 arguments but 4 were supplied.

- [ ] **Step 3: Change `world`**

In `unitvalue.rs`, the signature and the stand-in branch:

```rust
/// Where a unit is and how big, answered off the scene the event carried.
///
/// `rts/Sim/Units/Scripts/UnitScript.cpp:1060-1105`. The unit itself stands at
/// the origin, and the ground is flat at 0, which is what the viewport draws.
/// `carried` is where the stand-in is once a script has held it
/// ([`crate::Passenger::at`]), which the scene no longer decides.
/// `None` for an id this does not cover, and for one it cannot answer without
/// a scene, so the caller's own "no world" note still says so.
pub fn world(
    id: i32,
    p1: i32,
    world: Option<&crate::World>,
    carried: Option<[f64; 3]>,
) -> Option<Answer> {
```

and replace `let Some(pos) = stand_in.pos else {` with `let Some(pos) = carried.or(stand_in.pos) else {`.

Update the two callers:

- `cobrun.rs:1143`: `unitvalue::world(id, p1, self.world.as_ref(), self.model.passenger.at())`
- `unitscript.rs:2227`: `unitvalue::world(id, p1, sim.world.as_ref(), sim.model.passenger.at())`

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cargo test -p coilbox-unitpose && cargo check --workspace --all-targets`
Expected: tests pass, and the workspace compiles.

- [ ] **Step 5: Commit**

```bash
git add crates/coilbox-unitpose/src/unitvalue.rs crates/coilbox-unitpose/src/lib.rs crates/tauri-plugin-coilbox-anim/src/cobrun.rs crates/coilbox-springlua/src/unitscript.rs
git commit -m "Answer where a held stand-in is from the runtime, not the scene"
```

---

### Task A3: read the TA:K sound table

**Files:**
- Modify: `crates/tauri-plugin-coilbox-anim/src/cob.rs` (`DecodedCob` at 64-84, `decode` at 86-130, tests at 225-255)

**Interfaces:**
- Produces: `DecodedCob::sounds: Vec<String>`, empty unless the header's version is 6.
- Produces, test only: `#[cfg(test)] pub(crate) fn ta_kingdoms(bytes: Vec<u8>, sounds: &[&str]) -> Vec<u8>`. It takes an `encode` output whose first script is two words of padding, and returns a version 6 file whose header points at a table of `sounds`. Used again in A4.

The engine reads two header words after the eleven when `VersionSignature` is 6: `OffsetToSoundNameArray` then `NumberOfSounds`, and each array entry is the byte offset of a NUL-terminated name (`rts/Sim/Units/Scripts/CobFile.cpp:37-38,174-190`). A TA:K header is two words longer than TA's, so its code starts at byte 52, but the code offset is read from the header either way, which is why `decode` needs no other change.

- [ ] **Step 1: Write the failing tests**

In `cob.rs`, above `#[cfg(test)] mod tests`:

```rust
/// A TA:K file made out of a TA one, for tests.
///
/// `encode` writes TA's eleven-word header with the code straight after it.
/// TA:K's header is two words longer, so `bytes` must come from an `encode`
/// whose first script is two words of padding. Those two words become the
/// sound table's offset and count, and the table goes on the end.
// Unused where the disassembly integration test compiles this module on its
// own, as `DecodedCob`'s fields are.
#[cfg(test)]
#[allow(dead_code)]
pub(crate) fn ta_kingdoms(mut bytes: Vec<u8>, sounds: &[&str]) -> Vec<u8> {
    let table = bytes.len() as u32;
    let mut name_at = table + 4 * sounds.len() as u32;
    let mut offsets = Vec::new();
    let mut names = Vec::new();
    for sound in sounds {
        offsets.extend_from_slice(&name_at.to_le_bytes());
        names.extend_from_slice(sound.as_bytes());
        names.push(0);
        name_at += sound.len() as u32 + 1;
    }
    bytes[0..4].copy_from_slice(&6u32.to_le_bytes());
    bytes[44..48].copy_from_slice(&table.to_le_bytes());
    bytes[48..52].copy_from_slice(&(sounds.len() as u32).to_le_bytes());
    bytes.extend_from_slice(&offsets);
    bytes.extend_from_slice(&names);
    bytes
}
```

In `mod tests`:

```rust
    fn padded() -> Vec<u8> {
        let mut code = HashMap::new();
        code.insert("Pad".to_string(), vec![0u8; 8]);
        code.insert("Create".to_string(), vec![0u8; 4]);
        encode(
            &["Pad".to_string(), "Create".to_string()],
            &code,
            &["base".to_string()],
            &[],
            4,
        )
    }

    /// `CobFile.cpp:174-190`: a TA:K script names its sounds in a table.
    #[test]
    fn reads_a_ta_kingdoms_sound_table() {
        let decoded = decode(&ta_kingdoms(padded(), &["krogtaunt", "krogdeath"])).unwrap();
        assert_eq!(decoded.sounds, ["krogtaunt", "krogdeath"]);
        assert_eq!(decoded.pieces, ["base"]);
    }

    /// A TA script has no table, and the two words after its header are code.
    #[test]
    fn a_ta_script_has_no_sound_table() {
        assert!(decode(&padded()).unwrap().sounds.is_empty());
    }
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cargo test -p tauri-plugin-coilbox-anim cob::tests`
Expected: compile error, no field `sounds` on `DecodedCob`.

- [ ] **Step 3: Read the table**

In `DecodedCob`, after `offsets`:

```rust
    /// The sounds a TA:K script plays by index, in its own order. Empty for a
    /// TA script, which has no table (`CobFile.cpp:37-38,174-190`).
    pub sounds: Vec<String>,
```

In `decode`, before `Ok(DecodedCob {`:

```rust
    // Version 6 is TA:K, whose header runs two words past the eleven: where
    // the sound names are, then how many.
    let sounds = if header.version == 6 {
        let at = read_u32(buf, HEADER_WORDS * 4)?;
        let count = read_u32(buf, HEADER_WORDS * 4 + 4)?;
        names_at(at, count)?
    } else {
        Vec::new()
    };
```

and `sounds,` in the struct literal.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cargo test -p tauri-plugin-coilbox-anim cob::tests`
Expected: pass. Then `cargo test -p tauri-plugin-coilbox-anim --test '*'` to confirm the disassembly integration test, which compiles `cob.rs` on its own, still builds with the new field.

- [ ] **Step 5: Commit**

```bash
git add crates/tauri-plugin-coilbox-anim/src/cob.rs
git commit -m "Read the sound table a TA:K script carries"
```

---

### Task A4: the compiled runtime records the five calls

**Files:**
- Modify: `crates/tauri-plugin-coilbox-anim/src/cobrun.rs` (`Program` at 112-163, `step` at 412-418, the five opcodes at 927-957)
- Test: `crates/tauri-plugin-coilbox-anim/src/cobrun_tests.rs`, new `mod announcements` at the end of the file

**Interfaces:**
- Consumes: `Model::{emit_sfx, explode, play_sound, attach_unit, drop_unit, no_such_piece, after_frame}` from A1, `cob::ta_kingdoms` and `DecodedCob::sounds` from A3.
- Produces: `Program::sounds: Vec<String>`, and `Run::attach(&mut self, unit: i32, piece: i32)`.

Operand order is the engine's, from `rts/Sim/Units/Scripts/CobThread.cpp`:

| Opcode | Order | Lines |
|---|---|---|
| `EMIT_SFX` | pop type, then piece from the code word | 520-524 |
| `EXPLODE` | piece from the code word, then pop flags | 456-460 |
| `PLAY_SOUND` | sound index from the code word, then pop an attribute nothing here reads | 462-466 |
| `ATTACH_UNIT` | pop an unused third operand, then piece, then unit | 677-682 |
| `DROP_UNIT` | pop unit | 684-686 |

A negative attach piece is the void. Any other piece has to be one of the unit's (`UnitScript.cpp:828-835`).

- [ ] **Step 1: Write the failing tests**

At the end of `cobrun_tests.rs`:

```rust
mod announcements {
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

    fn pickup(bytes: &[u8]) -> Timeline {
        run(
            bytes,
            &model_pieces(),
            &[ScriptEvent {
                frame: 0,
                callin: "TransportPickup".to_string(),
                args: vec![2.0],
                ambient: false,
                world: Some(scene()),
            }],
            2,
            &[],
            &HashMap::new(),
        )
    }

    #[test]
    fn records_an_effect_on_its_piece_and_frame() {
        let mut create = push(1025);
        create.extend([op("EMIT_SFX"), 2, op("RETURN")]);
        let timeline = play(&create_only(create), 2);

        assert_eq!(
            timeline.events,
            [ScriptOutput::Sfx { frame: 0, piece: "barrel".to_string(), sfx: 1025 }]
        );
        assert!(timeline.warnings.iter().any(|w| w == coilbox_unitpose::EFFECTS_NOTE));
        assert!(!timeline.warnings.iter().any(|w| w.contains("not drawn in the preview")));
    }

    #[test]
    fn records_an_explosion_with_its_flags() {
        let mut create = push(257);
        create.extend([op("EXPLODE"), 1, op("RETURN")]);
        let timeline = play(&create_only(create), 2);

        assert_eq!(
            timeline.events,
            [ScriptOutput::Explode { frame: 0, piece: "turret".to_string(), flags: 257 }]
        );
    }

    /// A TA:K file names its sounds, and the index picks one.
    #[test]
    fn names_a_sound_from_the_table() {
        let mut create = push(0);
        create.extend([op("PLAY_SOUND"), 1, op("RETURN")]);
        let bytes = crate::cob::ta_kingdoms(
            build(&[("Pad", vec![0, 0]), ("Create", create)], PIECES, 0),
            &["krogtaunt", "krogdeath"],
        );
        let timeline = play(&bytes, 2);

        assert_eq!(
            timeline.events,
            [ScriptOutput::Sound { frame: 0, name: Some("krogdeath".to_string()) }]
        );
    }

    /// A TA file has no table, so the sound has no name and the run says which
    /// index it was.
    #[test]
    fn a_sound_with_no_table_is_recorded_without_a_name() {
        let mut create = push(0);
        create.extend([op("PLAY_SOUND"), 3, op("RETURN")]);
        let timeline = play(&create_only(create), 2);

        assert_eq!(timeline.events, [ScriptOutput::Sound { frame: 0, name: None }]);
        assert!(timeline.warnings.iter().any(|w| w.contains("plays sound 3")), "{:?}", timeline.warnings);
    }

    /// `ShowUnitScriptError` and nothing else, in the engine.
    #[test]
    fn a_piece_that_is_not_there_records_nothing() {
        let mut create = push(1025);
        create.extend([op("EMIT_SFX"), 9, op("RETURN")]);
        let timeline = play(&create_only(create), 2);

        assert!(timeline.events.is_empty());
        assert!(timeline.warnings.iter().any(|w| w.contains("emit-sfx names piece 9")));
    }

    /// The unit first, then the piece, then an operand nothing reads, which is
    /// the order the engine pops them in reverse.
    #[test]
    fn attaches_and_drops_in_the_engine_s_operand_order() {
        let mut words = vec![op("CREATE_LOCAL_VAR")];
        words.extend([op("PUSH_LOCAL_VAR"), 0]);
        words.extend(push(1));
        words.extend(push(0));
        words.push(op("ATTACH_UNIT"));
        words.extend([op("PUSH_LOCAL_VAR"), 0]);
        words.extend([op("DROP_UNIT"), op("RETURN")]);
        let timeline = pickup(&build(&[("TransportPickup", words)], PIECES, 0));

        assert_eq!(
            timeline.events,
            [
                ScriptOutput::Attach { frame: 0, unit: 2, piece: Some("turret".to_string()) },
                ScriptOutput::Drop { frame: 0, unit: 2 },
            ]
        );
    }

    /// `attach-unit unitid to 0 - 1` is the Hulk hiding its passenger.
    #[test]
    fn a_negative_piece_is_the_void() {
        let mut words = vec![op("CREATE_LOCAL_VAR")];
        words.extend([op("PUSH_LOCAL_VAR"), 0]);
        words.extend(push(u32::MAX));
        words.extend(push(0));
        words.extend([op("ATTACH_UNIT"), op("RETURN")]);
        let timeline = pickup(&build(&[("TransportPickup", words)], PIECES, 0));

        assert_eq!(
            timeline.events,
            [ScriptOutput::Attach { frame: 0, unit: 2, piece: None }]
        );
    }
}
```

`push(u32::MAX)` pushes the word `0xffffffff`, which the interpreter reads back as -1 through `as i32`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cargo test -p tauri-plugin-coilbox-anim announcements`
Expected: every test fails on `timeline.events` being empty.

- [ ] **Step 3: Record in the interpreter**

`Program`, after `piece_names`:

```rust
    /// The sounds a TA:K file names, by the index `PLAY_SOUND` plays them by.
    sounds: Vec<String>,
```

and in `Program::read`, `sounds: decoded.sounds,` in the struct literal, before `piece_names: decoded.pieces` so nothing moves out of `decoded` twice.

`step` (412-418) becomes:

```rust
    fn step(&mut self, events: &[ScriptEvent]) -> Result<(), String> {
        self.budget = FRAME_INSTRUCTIONS;
        self.model.tick();
        self.wake_finished();
        self.fire_due(events)?;
        self.run_threads()?;
        // After every thread, as the engine moves its passengers once every
        // script has ticked (`rts/Game/Game.cpp:1796-1798`).
        self.model.after_frame();
        Ok(())
    }
```

and extend its doc comment's first line to "One frame: tick the animations, wake what they finished, fire what is due, run every thread that can run, then carry the stand-in."

Replace the five arms at 927-957, from the `// Things a preview cannot do, each said once.` comment down to the end of the `DROP_UNIT` arm:

```rust
            // What a script announces. Each is recorded on the frame it
            // happens, for the scrubber, and none is drawn.
            w if w == op("EMIT_SFX") => {
                let sfx = self.pop(i);
                let piece = self.word(i)?;
                match model_piece(&self.program, piece) {
                    Some(at) => self.model.emit_sfx(self.frame, at, sfx),
                    None => self.model.no_such_piece("emit-sfx", i64::from(piece)),
                }
            }
            w if w == op("EXPLODE") => {
                let piece = self.word(i)?;
                let flags = self.pop(i);
                match model_piece(&self.program, piece) {
                    Some(at) => self.model.explode(self.frame, at, flags),
                    None => self.model.no_such_piece("explode", i64::from(piece)),
                }
            }
            w if w == op("PLAY_SOUND") => {
                let index = self.word(i)?;
                self.pop(i);
                let name = usize::try_from(index)
                    .ok()
                    .and_then(|at| self.program.sounds.get(at))
                    .cloned();
                if name.is_none() {
                    self.model.note(format!(
                        "This script plays sound {index}, and the file names no sound {index}, so the scrubber cannot say which."
                    ));
                }
                self.model.play_sound(self.frame, name);
            }
            // Popped in the engine's order: a third operand nothing reads, then
            // the piece, then the unit (`CobThread.cpp:677-682`).
            w if w == op("ATTACH_UNIT") => {
                self.pop(i);
                let piece = self.pop(i);
                let unit = self.pop(i);
                self.attach(unit, piece);
            }
            w if w == op("DROP_UNIT") => {
                let unit = self.pop(i);
                self.model.drop_unit(self.frame, unit, self.world.as_ref());
            }
```

Add to the second `impl Run` block, after `do_turn`:

```rust
    /// A negative piece is the void, and any other has to be one of this
    /// unit's (`rts/Sim/Units/Scripts/UnitScript.cpp:828-835`).
    fn attach(&mut self, unit: i32, piece: i32) {
        let at = if piece < 0 {
            None
        } else {
            let Some(at) = model_piece(&self.program, piece) else {
                self.model.no_such_piece("attach-unit", i64::from(piece));
                return;
            };
            Some(at)
        };
        self.model.attach_unit(self.frame, unit, at, self.world.as_ref());
    }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cargo test -p tauri-plugin-coilbox-anim`
Expected: all pass, the seven new ones included.

- [ ] **Step 5: Commit**

```bash
git add crates/tauri-plugin-coilbox-anim/src/cobrun.rs crates/tauri-plugin-coilbox-anim/src/cobrun_tests.rs
git commit -m "Record effects, sound and attachment from compiled scripts"
```

---

### Task A5: the Lua runtime records the five calls

**Files:**
- Modify: `crates/coilbox-springlua/src/unitscript.rs`: `step` at 542-553, `sandbox` install list at 885-898, `GetUnitPosition` at 1406-1436, the `Spring` stub list at 1555, `Explode` in `install_motion` at 1949-1962, `install_stubs` at 2025-2052
- Test: `crates/coilbox-springlua/src/unitscript_tests.rs`, new `mod announcements` at the end

**Interfaces:**
- Consumes: the `Model` methods from A1 and `Passenger::at`.
- Produces: `fn install_announcements(lua: &Lua, sim: &Rc<RefCell<Sim>>) -> mlua::Result<()>` and `fn announced_piece(sim: &mut Sim, call: &str, piece: i64) -> Option<usize>`.

Lua argument forms, from `rts/Sim/Units/Scripts/LuaUnitScript.cpp`. Every piece is counted from one, and the engine subtracts one:

| Call | Form | Lines |
|---|---|---|
| `EmitSfx` | `(piece, type)`, type a number or a generator name | 1422-1433 |
| `AttachUnit` | `(piece, unit)`, so 0 and below are the void | 1445-1457 |
| `DropUnit` | `(unit)` | 1468-1480 |
| `Explode` | `(piece, flags)` | 1492-1503 |

- [ ] **Step 1: Write the failing tests**

At the end of `unitscript_tests.rs`:

```rust
mod announcements {
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

    /// base at the origin, turret on it at (0, 10, 20), the rest at base.
    fn rest() -> Vec<Rest> {
        vec![
            Rest { parent: None, position: [0.0; 3] },
            Rest { parent: Some(0), position: [0.0, 10.0, 20.0] },
            Rest { parent: Some(0), position: [0.0; 3] },
            Rest { parent: Some(0), position: [0.0; 3] },
        ]
    }

    fn pickup(script: &str, frames: u32) -> Timeline {
        let names = pieces();
        let rest = rest();
        run(
            script,
            "test.lua",
            &Unit { rest: &rest, ..Unit::new(&names) },
            &[ScriptEvent {
                frame: 0,
                callin: "TransportPickup".to_string(),
                args: vec![2.0],
                ambient: false,
                world: Some(scene()),
            }],
            frames,
            &HashMap::new(),
        )
    }

    #[test]
    fn records_effects_and_sound_with_pieces_counted_from_one() {
        let timeline = play(
            r#"
            local turret, flare = piece("turret", "flare")
            function script.Create()
                EmitSfx(flare, 1025)
                Explode(turret, SFX.SHATTER)
                PlaySoundFile("krogtaunt")
                Spring.PlaySoundFile("sounds/krogdeath.wav", 1)
            end
            "#,
            2,
        );

        assert_eq!(timeline.error, None);
        assert_eq!(
            timeline.events,
            [
                ScriptOutput::Sfx { frame: 0, piece: "flare".to_string(), sfx: 1025 },
                ScriptOutput::Explode { frame: 0, piece: "turret".to_string(), flags: 1 },
                ScriptOutput::Sound { frame: 0, name: Some("krogtaunt".to_string()) },
                ScriptOutput::Sound { frame: 0, name: Some("sounds/krogdeath.wav".to_string()) },
            ]
        );
        assert!(timeline.warnings.iter().any(|w| w == coilbox_unitpose::EFFECTS_NOTE));
        assert!(!timeline.warnings.iter().any(|w| w.contains("does nothing in the preview")), "{:?}", timeline.warnings);
    }

    /// The engine reports a piece it does not have and carries on, so the
    /// thread keeps going rather than stopping on the line.
    #[test]
    fn a_piece_that_is_not_there_is_noted_and_the_thread_carries_on() {
        let timeline = play(
            r#"
            local base = piece("base")
            function script.Create()
                Explode(99, 1)
                Move(base, y_axis, 3)
            end
            "#,
            2,
        );

        assert_eq!(timeline.error, None);
        assert!(timeline.events.is_empty());
        assert!(timeline.warnings.iter().any(|w| w.contains("Explode names piece 99")));
        assert_close(pose(&timeline, 1, "base")[1], 3.0);
    }

    /// A generator named rather than numbered is marked global
    /// (`LuaUnitScript.cpp:1430`).
    #[test]
    fn an_effect_named_rather_than_numbered_is_marked_global() {
        let timeline = play(
            r#"
            local flare = piece("flare")
            function script.Create() EmitSfx(flare, "muzzleflash") end
            "#,
            2,
        );

        assert_eq!(
            timeline.events,
            [ScriptOutput::Sfx { frame: 0, piece: "flare".to_string(), sfx: 16384 }]
        );
        assert!(timeline.warnings.iter().any(|w| w.contains("muzzleflash")));
    }

    /// Both spellings of the framework's call-outs record the same thing.
    #[test]
    fn attaches_to_a_piece_then_the_void_then_drops() {
        let timeline = pickup(
            r#"
            local turret = piece("turret")
            function script.TransportPickup(passenger)
                AttachUnit(turret, passenger)
                Spring.UnitScript.AttachUnit(0, passenger)
                UnitScript.DropUnit(passenger)
            end
            "#,
            2,
        );

        assert_eq!(timeline.error, None);
        assert_eq!(
            timeline.events,
            [
                ScriptOutput::Attach { frame: 0, unit: 2, piece: Some("turret".to_string()) },
                ScriptOutput::Attach { frame: 0, unit: 2, piece: None },
                ScriptOutput::Drop { frame: 0, unit: 2 },
            ]
        );
    }

    /// Shaped like `intruder.bos` `AreaUnload`: attach, then poll until the
    /// passenger is on the piece. It is not there on the attach's own frame,
    /// because the engine moves passengers after every script has ticked, and
    /// it is there one poll later. After a drop, moving the piece leaves the
    /// passenger behind.
    #[test]
    fn a_passenger_reaches_its_piece_after_the_frame_it_was_attached() {
        let timeline = pickup(
            r#"
            local base, turret, barrel = piece("base", "turret", "barrel")
            function script.TransportPickup(passenger)
                AttachUnit(turret, passenger)
                local polls = 1
                while GetUnitValue(COB.UNIT_XZ, passenger) ~= GetUnitValue(COB.PIECE_XZ, turret - 1) do
                    polls = polls + 1
                    Sleep(100)
                end
                Move(base, y_axis, polls)
                local held = GetUnitValue(COB.PIECE_XZ, turret - 1)
                DropUnit(passenger)
                Move(turret, x_axis, 50)
                Sleep(100)
                if GetUnitValue(COB.UNIT_XZ, passenger) ~= GetUnitValue(COB.PIECE_XZ, turret - 1) then
                    Move(barrel, y_axis, 1)
                end
                if GetUnitValue(COB.UNIT_XZ, passenger) == held then
                    Move(barrel, z_axis, 1)
                end
            end
            "#,
            20,
        );

        assert_eq!(timeline.error, None);
        // 1 would mean the attach moved the stand-in at once. 0 would mean it
        // never reached the piece.
        assert_close(pose(&timeline, 19, "base")[1], 2.0);
        assert_close(pose(&timeline, 19, "barrel")[1], 1.0);
        assert_close(pose(&timeline, 19, "barrel")[2], 1.0);
    }

    /// Lua's own way of asking gets the same answer.
    #[test]
    fn spring_says_a_carried_passenger_is_on_its_piece() {
        let timeline = pickup(
            r#"
            local base, turret = piece("base", "turret")
            function script.TransportPickup(passenger)
                AttachUnit(turret, passenger)
                Sleep(33)
                local x, y, z = Spring.GetUnitPosition(passenger)
                Move(base, x_axis, x)
                Move(base, y_axis, y)
                Move(base, z_axis, z)
            end
            "#,
            4,
        );

        assert_eq!(timeline.error, None);
        let base = pose(&timeline, 3, "base");
        assert_close(base[0], 0.0);
        assert_close(base[1], 10.0);
        assert_close(base[2], 20.0);
    }
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cargo test -p coilbox-springlua announcements`
Expected: failures on empty `events`, on the "Explode names piece 99" note (the current `Explode` raises instead), and on the carried position.

- [ ] **Step 3: Record in the Lua runtime**

Remove `"EmitSfx"`, `"PlaySoundFile"`, `"AttachUnit"` and `"DropUnit"` from the list in `install_stubs`, leaving `"ChangeHeading"`. Reword its doc comment to "The calls a preview cannot honour but must not fail on. Each one is noted the first time it is used, so the panel can say what it left out rather than pretending it did it."

Delete the `Explode` global and its comment from `install_motion` (1949-1962).

Remove `"PlaySoundFile"` from the `Spring` stub list at line 1555. After that loop in `install_spring`, add:

```rust
    // The same call as the framework's own `PlaySoundFile`, so a converted
    // script's `Spring.PlaySoundFile` is recorded the same way.
    spring.set("PlaySoundFile", lua.globals().get::<Value>("PlaySoundFile")?)?;
```

Add after `install_stubs`:

```rust
/// `SFX_GLOBAL` (`rts/Sim/Units/Scripts/CobDefines.h:20`), which the engine ORs
/// into a generator it looked up by name.
const SFX_GLOBAL: i32 = 16384;

/// What a script announces: effects, debris, sound, and carrying another unit.
///
/// Each is recorded on the frame it happens, for the scrubber to mark, and
/// none is drawn or played. Pieces come in counted from one, as `piece()`
/// hands them out, and the engine subtracts one
/// (`rts/Sim/Units/Scripts/LuaUnitScript.cpp:1422-1503`).
fn install_announcements(lua: &Lua, sim: &Rc<RefCell<Sim>>) -> mlua::Result<()> {
    let globals = lua.globals();

    let state = Rc::clone(sim);
    globals.set(
        "EmitSfx",
        lua.create_function(move |_, (piece, sfx): (i64, Value)| {
            let mut guard = state.borrow_mut();
            let sim = &mut *guard;
            let Some(at) = announced_piece(sim, "EmitSfx", piece) else {
                return Ok(());
            };
            let sfx = match sfx {
                Value::Integer(number) => number as i32,
                Value::Number(number) => number as i32,
                // A generator named rather than numbered, which the engine
                // looks up and marks global (`LuaUnitScript.cpp:1430`).
                Value::String(name) => {
                    sim.model.note(format!(
                        "EmitSfx names the effect {}, which is marked as a global effect because the preview has no list of effects to number it from.",
                        name.to_string_lossy()
                    ));
                    SFX_GLOBAL
                }
                _ => 0,
            };
            sim.model.emit_sfx(sim.frame, at, sfx);
            Ok(())
        })?,
    )?;

    // Explode(piece, flags) throws debris and leaves the piece exactly as it
    // was. A script that wants the piece gone hides it itself.
    let state = Rc::clone(sim);
    globals.set(
        "Explode",
        lua.create_function(move |_, (piece, flags): (i64, Option<i64>)| {
            let mut guard = state.borrow_mut();
            let sim = &mut *guard;
            if let Some(at) = announced_piece(sim, "Explode", piece) {
                sim.model.explode(sim.frame, at, flags.unwrap_or(0) as i32);
            }
            Ok(())
        })?,
    )?;

    // AttachUnit(piece, unit). The engine subtracts one from the piece, so
    // zero and below are the void (`LuaUnitScript.cpp:1445-1457`).
    let state = Rc::clone(sim);
    globals.set(
        "AttachUnit",
        lua.create_function(move |_, (piece, unit): (i64, i64)| {
            let mut guard = state.borrow_mut();
            let sim = &mut *guard;
            let at = if piece < 1 {
                None
            } else {
                let Some(at) = announced_piece(sim, "AttachUnit", piece) else {
                    return Ok(());
                };
                Some(at)
            };
            sim.model.attach_unit(sim.frame, unit as i32, at, sim.world.as_ref());
            Ok(())
        })?,
    )?;

    let state = Rc::clone(sim);
    globals.set(
        "DropUnit",
        lua.create_function(move |_, unit: i64| {
            let mut guard = state.borrow_mut();
            let sim = &mut *guard;
            sim.model.drop_unit(sim.frame, unit as i32, sim.world.as_ref());
            Ok(())
        })?,
    )?;

    // Answers nothing, as it did when it was a stub. Its name is the first
    // argument, whatever follows it.
    let state = Rc::clone(sim);
    globals.set(
        "PlaySoundFile",
        lua.create_function(move |_, (name, _rest): (Value, MultiValue)| {
            let mut guard = state.borrow_mut();
            let sim = &mut *guard;
            let name = match name {
                Value::String(name) => Some(name.to_string_lossy()),
                _ => None,
            };
            sim.model.play_sound(sim.frame, name);
            Ok(())
        })?,
    )?;

    Ok(())
}

/// The model piece a script's 1-based piece number names, or a note and none
/// when it names no piece of this unit, which the engine reports and ignores.
fn announced_piece(sim: &mut Sim, call: &str, piece: i64) -> Option<usize> {
    let index = usize::try_from(piece - 1)
        .ok()
        .filter(|index| *index < sim.model.pieces.len());
    if index.is_none() {
        sim.model.no_such_piece(call, piece);
    }
    index
}
```

In `sandbox`, add `install_announcements(&lua, sim)?;` after `install_stubs(&lua, sim)?;`, so `install_unit_script_table` finds all five globals.

`step` (542-553) becomes:

```rust
    fn step(&mut self, events: &[ScriptEvent]) -> Result<(), String> {
        self.budget.set(FRAME_INSTRUCTIONS);
        self.fatal.set(false);
        {
            let mut sim = self.sim.borrow_mut();
            sim.frame = self.frame;
            sim.model.tick();
        }
        self.wake_finished();
        self.fire_due(events)?;
        self.run_threads()?;
        // After every coroutine, as the engine moves its passengers once every
        // script has ticked (`rts/Game/Game.cpp:1796-1798`).
        self.sim.borrow_mut().model.after_frame();
        Ok(())
    }
```

In `GetUnitPosition` (1424), the stand-in arm answers from the passenger first:

```rust
                unitvalue::Who::StandIn(stand_in) => {
                    match sim.model.passenger.at().or(stand_in.pos) {
                        Some([x, y, z]) => (Some(x), Some(y), Some(z)),
                        None => {
                            sim.model.note(
                                "This script asks where the stand-in is on a frame this scenario puts it nowhere, so it read nothing.".to_string(),
                            );
                            (None, None, None)
                        }
                    }
                }
```

Update the comment above `GetUnitPosition` to add: "Once a script has held the stand-in, it is where the runtime carried it."

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cargo test -p coilbox-springlua`
Expected: all pass. The two probe tests call `Run::start`, which now installs the announcements, so check they still pass rather than assuming.

- [ ] **Step 5: Commit**

```bash
git add crates/coilbox-springlua/src/unitscript.rs crates/coilbox-springlua/src/unitscript_tests.rs
git commit -m "Record effects, sound and attachment from Lua scripts"
```

---

### Task A6: both runtimes announce the same events

**Files:**
- Modify: `crates/tauri-plugin-coilbox-anim/src/bos2lua_parity.rs`

**Interfaces:**
- Consumes: `cobrun::run`, `coilbox_springlua::unitscript::run`, `crate::compile_bos`, `coilbox_bos2lua::convert`, `ScriptOutput`.
- Produces: `fn both(source: &str) -> (Vec<u8>, String, Vec<String>)`, `fn pickup_at(frame: u32) -> ScriptEvent`, `fn rest_for(pieces: &[String], at: &[(&str, Option<&str>, [f64; 3])]) -> Vec<Rest>`.

One BOS source per test, compiled by this crate and converted by `bos2lua`, run through both runtimes. The events must be equal and must be the expected ones, so two empty lists cannot pass.

- [ ] **Step 1: Write the failing tests**

Change the first import to also bring in `Rest`:

```rust
use coilbox_springlua::unitscript::{run as run_lua, Rest, ScriptEvent, Unit};
use coilbox_unitpose::ScriptOutput;
```

Append:

```rust
/// Compile `source` with this crate's compiler and convert it with the
/// converter, as the fixture test above does, and name its pieces.
fn both(source: &str) -> (Vec<u8>, String, Vec<String>) {
    let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("../coilbox-bos2lua/tests/fixtures");
    let cob = crate::compile_bos(source, &dir).unwrap();
    let lua = coilbox_bos2lua::convert(
        source,
        &coilbox_bos2lua::Options {
            name: "scripts/events.bos",
            includes: &HashMap::new(),
            pieces: None,
            linear_scale: coilbox_bos2lua::linear_scale(source, &cob)
                .unwrap_or(coilbox_bos2lua::MODERN_LINEAR),
            precedence: coilbox_bos2lua::Precedence::Modern,
            prune: false,
        },
    )
    .unwrap()
    .lua;
    let pieces = pieces_of(&lua);
    (cob, lua, pieces)
}

/// `TransportPickup(2)`, with the stand-in parked at (30, 0, 40).
fn pickup_at(frame: u32) -> ScriptEvent {
    ScriptEvent {
        frame,
        callin: "TransportPickup".into(),
        args: vec![2.0],
        ambient: false,
        world: Some(coilbox_unitpose::World {
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
        }),
    }
}

/// Rest positions in the order the conversion lists its pieces, by name, so
/// the test does not depend on that order.
fn rest_for(pieces: &[String], at: &[(&str, Option<&str>, [f64; 3])]) -> Vec<Rest> {
    let index = |name: &str| pieces.iter().position(|p| p == name).unwrap();
    pieces
        .iter()
        .map(|piece| {
            let (_, parent, position) = at.iter().find(|(name, _, _)| name == piece).unwrap();
            Rest {
                parent: parent.map(index),
                position: *position,
            }
        })
        .collect()
}

/// Sound is left out: this crate's compiler writes no sound table, so a
/// compiled `play-sound` has no name, and the converter plays
/// `sounds/<name>.wav`. Each runtime's own tests cover sound.
#[test]
fn both_runtimes_announce_the_same_events() {
    let (cob, lua, pieces) = both(
        r#"
#define SHATTER 1
#define BITMAP1 256
piece base, flare, arm1, link;
Create()
{
	emit-sfx 1025 from flare;
	explode arm1 type SHATTER | BITMAP1;
}
TransportPickup(unitid)
{
	attach-unit unitid to link;
	sleep 100;
	attach-unit unitid to 0 - 1;
	sleep 100;
	drop-unit unitid;
}
"#,
    );
    let events = [event(0, "Create", &[]), pickup_at(10)];
    let from_cob = crate::cobrun::run(&cob, &pieces, &events, 40, &[], &HashMap::new());
    let from_lua = run_lua(&lua, "events.lua", &Unit::new(&pieces), &events, 40, &HashMap::new());

    assert_eq!(from_cob.error, None);
    assert_eq!(from_lua.error, None);
    assert_eq!(from_cob.events, from_lua.events);
    assert_eq!(
        from_cob.events[..3],
        [
            ScriptOutput::Sfx { frame: 0, piece: "flare".into(), sfx: 1025 },
            ScriptOutput::Explode { frame: 0, piece: "arm1".into(), flags: 257 },
            ScriptOutput::Attach { frame: 10, unit: 2, piece: Some("link".into()) },
        ]
    );
    assert!(matches!(from_cob.events[3], ScriptOutput::Attach { unit: 2, piece: None, .. }));
    assert!(matches!(from_cob.events[4], ScriptOutput::Drop { unit: 2, .. }));
    assert_eq!(from_cob.events.len(), 5);
}

/// Shaped like `intruder.bos` `AreaUnload`, in both runtimes. The passenger is
/// not on the piece on the attach's own frame, because the engine moves it
/// after every script has ticked (`rts/Game/Game.cpp:1796-1798`), and it is on
/// the piece at the second poll. After a drop, moving the piece leaves the
/// passenger where it was.
#[test]
fn both_runtimes_move_a_passenger_once_the_frame_is_over() {
    let (cob, lua, pieces) = both(
        r#"
#define PIECE_XZ 7
#define UNIT_XZ 9
piece base, link, mark;
static-var polls, held;
TransportPickup(unitid)
{
	attach-unit unitid to link;
	polls = 1;
	while (get UNIT_XZ(unitid) != get PIECE_XZ(link))
	{
		polls = polls + 1;
		sleep 100;
	}
	if (polls == 1) { move base to y-axis [1] now; }
	if (polls == 2) { move base to y-axis [2] now; }
	if (polls > 2) { move base to y-axis [3] now; }
	held = get PIECE_XZ(link);
	drop-unit unitid;
	move link to x-axis [50] now;
	sleep 100;
	if (get UNIT_XZ(unitid) != get PIECE_XZ(link)) { move mark to y-axis [1] now; }
	if (get UNIT_XZ(unitid) == held) { move mark to z-axis [1] now; }
}
"#,
    );
    let rest = rest_for(
        &pieces,
        &[
            ("base", None, [0.0; 3]),
            ("link", Some("base"), [0.0, 10.0, 20.0]),
            ("mark", Some("base"), [0.0; 3]),
        ],
    );
    let events = [pickup_at(0)];
    let from_cob = crate::cobrun::run(&cob, &pieces, &events, 20, &rest, &HashMap::new());
    let from_lua = run_lua(
        &lua,
        "areaunload.lua",
        &Unit { rest: &rest, ..Unit::new(&pieces) },
        &events,
        20,
        &HashMap::new(),
    );

    for (runtime, timeline) in [("COB", &from_cob), ("Lua", &from_lua)] {
        assert_eq!(timeline.error, None, "{runtime}");
        let last = timeline.frames.last().unwrap();
        let at = |piece: &str, value: usize| last[pieces.iter().position(|p| p == piece).unwrap() * 6 + value];
        // 1 would mean the attach moved the stand-in at once. 0 would mean it
        // never reached the piece.
        assert!((at("base", 1) - 2.0).abs() < TOLERANCE, "{runtime}: polls {}", at("base", 1));
        assert!((at("mark", 1) - 1.0).abs() < TOLERANCE, "{runtime}: the passenger followed the piece after the drop");
        assert!((at("mark", 2) - 1.0).abs() < TOLERANCE, "{runtime}: the passenger moved when it was dropped");
    }
}
```

- [ ] **Step 2: Run the tests to verify they pass, and that they can fail**

Run: `cargo test -p tauri-plugin-coilbox-anim bos2lua_parity`
Expected: both pass on top of A4 and A5.

Then prove the ordering test can fail. Temporarily add `self.after_frame();` as the last line of `Model::attach_unit` in `crates/coilbox-unitpose/src/lib.rs`, which is an attach that moves the stand-in at once. Rerun, and confirm `both_runtimes_move_a_passenger_once_the_frame_is_over` fails for both runtimes with polls 1. Remove the line and confirm it passes again. Check with `git diff crates/coilbox-unitpose/src/lib.rs` that nothing is left over from the experiment. Record the result in the PR description.

If the compiler or the converter rejects either source, read the error before changing the source. The grammar is `crates/tauri-plugin-coilbox-anim/src/grammar.rs:262-272` (`emit-sfx <expr> from <expr>`, `explode <piece> type <expr>`, `attach-unit <expr> to <expr>`, `drop-unit <expr>`).

- [ ] **Step 3: Extend the sweep to compare events**

In `converted_scripts_move_pieces_as_their_cobs_do`, after `let first = first_difference(...)` and its `match`, compare events too, with sound names blanked for the reason in the test above:

```rust
        let heard = |t: &coilbox_unitpose::Timeline| -> Vec<ScriptOutput> {
            t.events
                .iter()
                .cloned()
                .map(|e| match e {
                    ScriptOutput::Sound { frame, .. } => ScriptOutput::Sound { frame, name: None },
                    other => other,
                })
                .collect()
        };
        if heard(&from_cob) != heard(&from_lua) && !KNOWN.iter().any(|(known, _)| *known == name) {
            differ.push(format!("{name}: the two announce different events"));
        }
```

Run it against Balanced Annihilation's scripts, unpacked under `target/` so nothing lands outside the repo's ignored build folder:

```bash
mkdir -p target/bos-sweep/ba
unzip -o -q ~/.spring/games/balanced_annihilation-v15.9.8.sdz 'scripts/*' -d target/bos-sweep/ba
COILBOX_BOS_SWEEP=target/bos-sweep/ba/scripts cargo test -p tauri-plugin-coilbox-anim converted_scripts_move_pieces_as_their_cobs_do -- --nocapture
```

Expected: the summary line `N match or are known, M differ, K skipped`. Read every "announce different events" line. A difference the runtimes cause is a bug in A4 or A5 and is fixed here. A difference that is already a pose difference, or that comes from the converter, goes in the PR description with its script name, not in `KNOWN`. Do not report the sweep as passing if it was not run. Delete `target/bos-sweep` afterwards.

- [ ] **Step 4: Commit**

```bash
git add crates/tauri-plugin-coilbox-anim/src/bos2lua_parity.rs
git commit -m "Hold both runtimes to the same events and the same passenger"
```

---

### Task A7: the TypeScript mirror

**Files:**
- Modify: `src/lego/scriptPlayback.ts:55-82`
- Modify, fixtures only: `src/lego/scriptPlayback.test.ts:32`, `src/lego/inferRoles.test.ts:84`, `src/lego/pages/components/AnimationPanel.dom.test.tsx:60`, `src/lego/pages/components/ScriptTab.dom.test.tsx:375`

**Interfaces:**
- Produces: `export type ScriptOutput` and `ScriptTimeline.events: ScriptOutput[]`, used by part C.

- [ ] **Step 1: Add the type**

Above `export interface ScriptTimeline`:

```ts
/**
 * Something a script announced, on the frame it did. Mirrors `ScriptOutput` in
 * `crates/coilbox-unitpose/src/lib.rs`. Pieces are named, because a name means
 * the same in both runtimes.
 */
export type ScriptOutput =
  | { frame: number; kind: "attach"; unit: number; piece: string | null } // null is the void
  | { frame: number; kind: "drop"; unit: number }
  | { frame: number; kind: "sfx"; piece: string; sfx: number }
  | { frame: number; kind: "explode"; piece: string; flags: number }
  | { frame: number; kind: "sound"; name: string | null };
```

In `ScriptTimeline`, after `offsetsRun`:

```ts
  /** What the script announced, in frame order: effects, sound, and carrying
   *  the stand-in. */
  events: ScriptOutput[];
```

- [ ] **Step 2: Run the typecheck to find every fixture**

Run: `bun run typecheck`
Expected: errors in the four fixture files named above, "Property 'events' is missing". Any other file in the list is a place that builds a `ScriptTimeline` by hand and needs the same fix.

- [ ] **Step 3: Add `events: [],` after each `offsetsRun: [],`**

- [ ] **Step 4: Verify**

Run: `bun run typecheck && bunx vitest run src/lego`
Expected: no type errors, all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lego/scriptPlayback.ts src/lego/scriptPlayback.test.ts src/lego/inferRoles.test.ts src/lego/pages/components/AnimationPanel.dom.test.tsx src/lego/pages/components/ScriptTab.dom.test.tsx
git commit -m "Carry a run's events to the panel"
```

---

### Task A8: full check and the PR

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

Expected: each exits 0. If `cargo fmt --all --check` fails, run `cargo fmt --all`, commit the result, and run all seven again. Report any failure with its output. Do not trim a check to get a pass.

- [ ] **Step 2: Check it in the app**

Tell the user the branch is ready for `bun tauri dev`. What changed on screen: a unit whose script emits effects or plays sound shows "Effects are marked on the scrubber, not drawn." once, in place of up to three older notes, and a transport no longer says "Attaching a unit does nothing in the preview." The marks themselves arrive with part C.

- [ ] **Step 3: File the PR**

Use the `file-pr` skill. The description names the three settled details from "Settled here, beyond the spec" that a reviewer cannot see in the diff, the falsification run from A6 step 2, and what the sweep in A6 step 3 found. Get the user's approval before creating it. Do not push before that.
