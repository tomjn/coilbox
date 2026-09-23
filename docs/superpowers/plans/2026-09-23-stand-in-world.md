# Stand-in world implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A unit script that asks where the stand-in is gets its real position and size, in both runtimes, so a boom transport such as BA's Hulk reaches for its passenger.

**Architecture:** Three independent PRs. A fixes and adds the piece-position and packed-coordinate answers that need no world. B adds a ship and hover pickup scenario. C gives every event a snapshot of the stand-in on that event's frame, and both runtimes answer `UNIT_XZ`, `UNIT_Y`, `UNIT_HEIGHT`, `GROUND_HEIGHT` and Lua's `Spring.GetUnitPosition`, `GetUnitHeight` and `GetUnitRadius` from one shared Rust function.

**Tech Stack:** Rust (`coilbox-unitpose`, `tauri-plugin-coilbox-anim`, `coilbox-springlua` on mlua), TypeScript and React 19, vitest, bun.

**Spec:** `docs/superpowers/specs/2026-09-23-stand-in-world-design.md`. Read it before starting any part. It carries the engine citations each decision rests on.

## Global constraints

- Before any push, run all seven CI commands from the repo root and confirm each passes: `bunx biome ci .`, `bun run typecheck`, `bun run test`, `scripts/mission-tests.sh`, `cargo fmt --all --check`, `cargo clippy --all-targets -- -D warnings`, `cargo test --workspace`. `luajit` must be on PATH.
- Let rustfmt own formatting. Run `cargo fmt --all` rather than formatting by hand.
- Do not `git rebase`. Update a branch by merging `origin/main` into it.
- Do not use worktrees. Each part is a branch off `main` in the primary checkout, one at a time.
- `git add` named files only. Never `git add -A`.
- Filing each PR goes through the `file-pr` skill, and the user approves the description before it is created. Give the user a chance to run `bun tauri dev` first.
- Comments match the surrounding code. They cite the engine file and line a behaviour comes from, as the existing code does.
- Notes shown to the user are plain English, sentence case, and have no semicolons.
- COB fixed-point scale is 65536. A packed pair is `(x << 16) + (z & 0xffff)` and unpacks as signed 16-bit halves (`rts/Sim/Units/Scripts/CobInstance.h:10-12`).

---

## Part A: answers that need no world

Branch: `piece-and-packed-answers` off `main`.

### Task A1: the compiled runtime reads the piece it is asked for

The compiled runtime answers `PIECE_XZ` and `PIECE_Y` for piece `p1 - 1`. The engine reads `p1` as a 0-based script piece index (`UnitScript.h:80-85`, `UnitScript.cpp:1023-1040`). A probe asking for `PIECE_Y` of piece 1, resting at y=7, got 0.

**Files:**
- Modify: `crates/tauri-plugin-coilbox-anim/src/cobrun.rs:1107-1125`
- Test: `crates/tauri-plugin-coilbox-anim/src/cobrun_tests.rs`, in `mod what_it_says_about_itself`

**Interfaces:**
- Consumes: `model_piece(program: &Program, piece: i32) -> Option<usize>` at `cobrun.rs:594`.
- Produces: nothing new.

- [ ] **Step 1: Write the failing test**

Add inside `mod what_it_says_about_itself`, after `says_when_a_script_asks_about_the_world`:

```rust
    /// `get PIECE_Y(turret)` pushes the turret's script piece number, counted
    /// from 0, and the engine reads exactly that piece (`SafeGetPiece(p1)` at
    /// `rts/Sim/Units/Scripts/UnitScript.h:80-85`).
    #[test]
    fn asks_about_the_piece_it_names_rather_than_the_one_before() {
        // get PIECE_Y(1, 0, 0, 0), then move the barrel along z by it.
        let mut code = push(8);
        code.extend(push(1));
        code.extend(push(0));
        code.extend(push(0));
        code.extend(push(0));
        code.push(op("GET"));
        code.extend([op("MOVE_NOW"), 2, 2, op("RETURN")]);
        // The turret seven above the base, the barrel one above that.
        let rest = [
            Rest {
                parent: None,
                position: [0.0, 0.0, 0.0],
            },
            Rest {
                parent: Some(0),
                position: [0.0, 7.0, 0.0],
            },
            Rest {
                parent: Some(1),
                position: [0.0, 1.0, 0.0],
            },
        ];

        let timeline = run(
            &create_only(code),
            &model_pieces(),
            &created(),
            2,
            &rest,
            &HashMap::new(),
        );

        assert_eq!(timeline.error, None);
        assert!(close(pose(&timeline, 0, "barrel")[2], 7.0));
    }
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cargo test -p tauri-plugin-coilbox-anim --lib asks_about_the_piece_it_names`
Expected: FAIL. The barrel's z is 0, which is the base's height.

- [ ] **Step 3: Fix the index**

In `unit_value`, replace the lookup lines:

```rust
            let index = self.program.pieces.get((p1 - 1).max(0) as usize).copied();
            let at = index.flatten().and_then(|at| self.model.piece_position(at));
```

with:

```rust
            // Counted from 0, as every other piece a `.cob` names is.
            let at = model_piece(&self.program, p1).and_then(|at| self.model.piece_position(at));
```

- [ ] **Step 4: Run the crate's tests**

Run: `cargo test -p tauri-plugin-coilbox-anim --lib`
Expected: PASS, including the new test.

- [ ] **Step 5: Commit**

```bash
git add crates/tauri-plugin-coilbox-anim/src/cobrun.rs crates/tauri-plugin-coilbox-anim/src/cobrun_tests.rs
git commit -m "Read the piece a compiled script asks the position of, not the one before it"
```

### Task A2: the packed-coordinate maths moves into the shared arithmetic

`XZ_ATAN` and `XZ_HYPOT` are arithmetic on a packed pair plus the unit's own heading, which is 0 in the editor (`UnitScript.cpp:1094-1097`). Both runtimes already call `unitvalue::arithmetic` first.

**Files:**
- Modify: `crates/coilbox-unitpose/src/unitvalue.rs:133-185` and its tests at `:335-342`

**Interfaces:**
- Produces: `pub const PIECE_XZ: i32 = 7`, `pub const PIECE_Y: i32 = 8`, `pub fn pack_xz(x: f64, z: f64) -> i32` in `coilbox_unitpose::unitvalue`. Task A3 and part C use them.

- [ ] **Step 1: Replace the test that pins the old behaviour with ones that pin the engine's**

Delete `does_not_answer_the_packed_coordinate_pair` and add:

```rust
    /// `XZ_ATAN` is the heading to a packed x and z, turned half a circle and
    /// less the unit's own heading, which is 0 in the editor
    /// (`rts/Sim/Units/Scripts/UnitScript.cpp:1094-1095`).
    #[test]
    fn heads_towards_a_packed_pair() {
        // Straight ahead is atan2(0, 1), nothing, plus half a circle.
        assert_eq!(arithmetic(XZ_ATAN, pack_xz(0.0, 1.0), 0), Some(32768));
        // A quarter circle round is 16384, plus the half.
        assert_eq!(arithmetic(XZ_ATAN, pack_xz(1.0, 0.0), 0), Some(49152));
    }

    /// `XZ_HYPOT` is how far a packed x and z is, in 65536ths
    /// (`UnitScript.cpp:1096-1097`).
    #[test]
    fn measures_a_packed_pair() {
        assert_eq!(arithmetic(XZ_HYPOT, pack_xz(3.0, 4.0), 0), Some(5 * 65536));
    }

    /// The halves are signed, so a pair to the right and behind unpacks as
    /// negative rather than as a very large number.
    #[test]
    fn unpacks_a_negative_pair() {
        assert_eq!(arithmetic(XZ_HYPOT, pack_xz(-3.0, -4.0), 0), Some(5 * 65536));
    }
```

- [ ] **Step 2: Run them and watch them fail**

Run: `cargo test -p coilbox-unitpose unitvalue`
Expected: compile error, `pack_xz` and `XZ_HYPOT` not found.

- [ ] **Step 3: Implement**

Replace the `#[cfg(test)] const XZ_ATAN: i32 = 12;` block and its comment with:

```rust
const XZ_ATAN: i32 = 12;
const XZ_HYPOT: i32 = 13;

/// Where one of the unit's own pieces is. Not answered here, because the
/// answer comes from the model each runtime holds, but named here so both
/// runtimes read it by the same name.
pub const PIECE_XZ: i32 = 7;
pub const PIECE_Y: i32 = 8;

/// A map position as a script holds one: x in the high half and z in the low,
/// each a whole number of elmos (`PACKXZ` in `CobInstance.h:10`).
pub fn pack_xz(x: f64, z: f64) -> i32 {
    ((x as i32) << 16).wrapping_add((z as i32) & 0xffff)
}

/// The two halves of a packed pair, signed, as `UNPACKX` and `UNPACKZ` read
/// them (`CobInstance.h:11-12`).
fn unpack_xz(xz: i32) -> (f32, f32) {
    let bits = xz as u32;
    (f32::from((bits >> 16) as u16 as i16), f32::from((bits & 0xffff) as u16 as i16))
}
```

Add two arms to the `match` in `arithmetic`, before `_ => None`:

```rust
        // A packed pair, from a unit at heading 0, which is the only heading
        // the editor has.
        XZ_ATAN => {
            let (x, z) = unpack_xz(p1);
            sane(RAD2TAANG * x.atan2(z) + 32768.0)
        }
        XZ_HYPOT => {
            let (x, z) = unpack_xz(p1);
            sane(x.hypot(z) * COBSCALE)
        }
```

Replace the doc paragraph on `arithmetic` that begins "`XZ_ATAN` and `XZ_HYPOT` are deliberately not here." with:

```rust
/// `XZ_ATAN` and `XZ_HYPOT` are here too. They take a map position packed into
/// one number, which looks like a question about the world, but the only thing
/// either reads from outside the arguments is the unit's own heading, and that
/// is 0 in the editor.
```

- [ ] **Step 4: Run the tests**

Run: `cargo test -p coilbox-unitpose`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add crates/coilbox-unitpose/src/unitvalue.rs
git commit -m "Answer XZ_ATAN and XZ_HYPOT, which are maths rather than questions about the world"
```

### Task A3: the Lua runtime answers where its own pieces are

**Files:**
- Modify: `crates/coilbox-springlua/src/unitscript.rs:2117-2150` (the `GetUnitValue` closure)
- Test: `crates/coilbox-springlua/src/unitscript_tests.rs`, in `mod world`, after `a_piece_is_where_the_model_puts_it`

**Interfaces:**
- Consumes: `unitvalue::PIECE_XZ`, `unitvalue::PIECE_Y`, `unitvalue::pack_xz` from A2. `Model::piece_position(index: usize) -> Option<[f64; 3]>` in `coilbox-unitpose/src/lib.rs:272`.

- [ ] **Step 1: Write the failing tests**

```rust
    /// The engine hands `GetUnitValue` its piece argument untouched
    /// (`LuaUnitScript.cpp:1262-1286`), so it counts from 0 where every other
    /// piece a Lua script names counts from 1. bos2lua writes `turret - 1` for
    /// exactly this reason.
    #[test]
    fn answers_where_a_piece_is_counting_from_zero() {
        let rest = [
            Rest {
                parent: None,
                position: [0.0, 0.0, 0.0],
            },
            Rest {
                parent: Some(0),
                position: [3.0, 7.0, 5.0],
            },
            Rest::default(),
            Rest::default(),
        ];
        let pieces = pieces();
        let timeline = run(
            r#"
            local turret = piece("turret")
            local barrel = piece("barrel")
            function script.Create()
                local y = GetUnitValue(COB.PIECE_Y, turret - 1)
                local xz = GetUnitValue(COB.PIECE_XZ, turret - 1)
                Move(barrel, y_axis, y / 65536)
                Move(barrel, z_axis, xz)
            end
            "#,
            "test.lua",
            &Unit {
                rest: &rest,
                ..Unit::new(&pieces)
            },
            &create(),
            3,
            &HashMap::new(),
        );

        assert_eq!(timeline.error, None);
        assert_close(pose(&timeline, 0, "barrel")[1], 7.0);
        assert_close(
            pose(&timeline, 0, "barrel")[2],
            f64::from(unitvalue::pack_xz(3.0, 5.0)),
        );
        assert!(
            !timeline.warnings.iter().any(|note| note.contains("the world")),
            "{:?}",
            timeline.warnings
        );
    }

    /// The maths on a packed pair, answered as the compiled runtime answers it.
    #[test]
    fn measures_a_packed_pair_as_the_compiled_runtime_does() {
        let timeline = play(
            r#"
            local base = piece("base")
            function script.Create()
                local far = GetUnitValue(COB.XZ_HYPOT, (3 * 65536) + 4)
                Move(base, z_axis, far / 65536)
            end
            "#,
            2,
        );

        assert_eq!(timeline.error, None);
        assert_close(pose(&timeline, 0, "base")[2], 5.0);
    }
```

Check `COB.XZ_HYPOT` exists in `unitvalue::NAMES` (it does, at `unitvalue.rs:34`). If a `Move` on `y_axis` does not read back as the raw offset in `pose()[1]`, check how `a_piece_is_where_the_model_puts_it` reads a value back and do the same.

- [ ] **Step 2: Run them and watch the first fail**

Run: `cargo test -p coilbox-springlua answers_where_a_piece_is_counting_from_zero measures_a_packed_pair`
Expected: the first FAILS, with a "no world to ask" note and a barrel at 0. The second PASSES already, because A2 put `XZ_HYPOT` into the shared arithmetic, so it only guards against regressions.

- [ ] **Step 3: Implement**

In the `GetUnitValue` closure, directly after `if id == GAME_FRAME { ... }`, add:

```rust
            // Where one of its own pieces is. Counted from 0, unlike every
            // other piece a Lua script names, because the engine hands this
            // argument to `GetUnitVal` untouched (`LuaUnitScript.cpp:1262-1286`).
            // The unit stands at the origin facing forwards, so a piece's place
            // in the unit is its place in the world.
            if id == unitvalue::PIECE_XZ || id == unitvalue::PIECE_Y {
                let at = usize::try_from(p1)
                    .ok()
                    .and_then(|index| sim.model.piece_position(index));
                let Some(at) = at else {
                    sim.model.note(
                        "This script asks where one of its pieces is, and the preview was not told where this unit's pieces sit.".to_string(),
                    );
                    return Ok(0);
                };
                return Ok(if id == unitvalue::PIECE_Y {
                    (at[1] * 65536.0) as i32
                } else {
                    unitvalue::pack_xz(at[0], at[2])
                });
            }
```

- [ ] **Step 4: Run the crate's tests**

Run: `cargo test -p coilbox-springlua`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add crates/coilbox-springlua/src/unitscript.rs crates/coilbox-springlua/src/unitscript_tests.rs
git commit -m "Tell a Lua script where its own pieces are when it asks by unit value"
```

### Task A4: check and file part A

- [ ] **Step 1:** Run all seven CI commands listed under Global constraints. Every one must pass. `cargo test --workspace` also runs the bos2lua parity test, which compares the two runtimes on the same script.
- [ ] **Step 2:** File the PR through the `file-pr` skill once the user has approved the description. The why for the description: converted scripts lost two answers, the compiled runtime answered for the wrong piece, and two ids called world questions are maths. Link the spec.

---

## Part B: a ship and hover pickup scenario

Branch: `transport-pickup-scenario` off `main`.

### Task B1: the scenario

**Files:**
- Modify: `src/lego/scriptPlayback.ts`, adding to `SCENARIOS` directly after `transport-load` (ends at `:432`)
- Test: `src/lego/scriptPlayback.test.ts`, in `describe("scenarios")`

**Interfaces:**
- Consumes: `CREATED`, `at`, `PREVIEW_SECONDS`, `STAND_IN_UNIT_ID` in the same file.
- Produces: a scenario with id `transport-pickup`. Task C7 runs the Hulk through it.

- [ ] **Step 1: Write the failing test**

```ts
  /**
   * Every transport that is not a `CHoverAirMoveType` is handed
   * `TransportPickup(unit)` once the passenger is in range, and attaches the
   * passenger itself (`rts/Sim/Units/CommandAI/MobileCAI.cpp:1459-1463`).
   * Nothing tells it which piece, so the scenario attaches nothing.
   */
  it("loads a ship or hover transport the way the engine's other arm does", () => {
    const pickup = scenarioById("transport-pickup");
    const callins = pickup?.events.map((e) => e.callin) ?? [];
    expect(callins).toContain("TransportPickup");
    expect(callins).not.toContain("BeginTransport");
    expect(pickup?.standIn?.attach ?? null).toBeNull();
    // Lua's form is the unit id alone.
    expect(
      pickup?.events.find((e) => e.callin === "TransportPickup")?.args,
    ).toHaveLength(1);
  });

  /** The engine calls it once the passenger has stopped, so the stand-in is
   *  parked for as long as the transport might be reading where it is. */
  it("parks the passenger before the pickup and keeps it there", () => {
    const pickup = scenarioById("transport-pickup");
    const frame =
      pickup?.events.find((e) => e.callin === "TransportPickup")?.frame ?? -1;
    const keys = pickup?.standIn?.keys ?? [];
    const parked = keys.filter(
      (key) => key.frame >= frame && key.frame <= at(11),
    );
    expect(parked.length).toBeGreaterThanOrEqual(1);
    const before = keys.filter((key) => key.frame < frame).at(-1);
    for (const key of parked) expect(key.pos).toEqual(before?.pos);
  });
```

- [ ] **Step 2: Run them and watch them fail**

Run: `bunx vitest run src/lego/scriptPlayback.test.ts`
Expected: FAIL, no scenario `transport-pickup`.

- [ ] **Step 3: Add the scenario**

```ts
  {
    id: "transport-pickup",
    label: "Loading a ship or hover transport",
    description:
      "A ship, hovercraft or ground transport picking something up. It is told what to load and reaches for it, and the script decides where it goes.",
    events: [
      ...CREATED,
      // The engine's other arm: anything that is not an air transport stops,
      // then calls `TransportPickup` with the passenger and leaves the script
      // to attach it (`rts/Sim/Units/CommandAI/MobileCAI.cpp:1459-1463`).
      { frame: at(4), callin: "TransportPickup", args: [STAND_IN_UNIT_ID] },
    ],
    standIn: {
      keys: [
        // Approaching on the ground, from in front, and still by the time the
        // transport is told to pick it up. The engine only calls
        // `TransportPickup` once the passenger is in range, and a passenger
        // that asked to be loaded stops there (`MobileCAI.cpp:430-465`).
        { frame: 0, pos: [0, 0, 5] },
        { frame: at(3), pos: [0, 0, 3] },
        // The return leg, which is the preview's rather than the engine's. No
        // call-in fires during it.
        { frame: at(11), pos: [0, 0, 3] },
        { frame: at(PREVIEW_SECONDS), pos: [0, 0, 5] },
      ],
    },
  },
```

`[0, 0, 3]` is a starting point and not a verified reach. Task C7 checks it against the Hulk's reach guard and changes the key if the guard fails.

- [ ] **Step 4: Run the tests**

Run: `bunx vitest run src/lego/scriptPlayback.test.ts`
Expected: PASS, including the existing invariants over every scenario.

- [ ] **Step 5: Commit**

```bash
git add src/lego/scriptPlayback.ts src/lego/scriptPlayback.test.ts
git commit -m "Add a pickup scenario for ship, hover and ground transports"
```

### Task B2: see it, check it and file it

- [ ] **Step 1:** Ask the user to open BA's Hulk (`armtship`) in the model editor under `bun tauri dev`, pick "Loading a ship or hover transport" and confirm that the boom call-in fires. The boom's angles stay wrong until part C lands, and the scenario description should not promise more.
- [ ] **Step 2:** Run all seven CI commands.
- [ ] **Step 3:** File the PR through `file-pr` once the user approves the description.

---

## Part C: the world

Branch: `stand-in-world` off `main`, after A has merged, because C3 and C4 read `unitvalue::pack_xz`. If A has not merged, branch off A's branch and say so in the PR.

### Task C1: the snapshot type on an event

**Files:**
- Modify: `crates/coilbox-unitpose/src/lib.rs:35-60` (the `ScriptEvent` struct)
- Modify: every `ScriptEvent { ... }` literal in `crates/`, 43 sites across `coilbox-bos2lua/examples/run.rs`, `coilbox-bos2lua/tests/{convert,language,prune,removed_values,simplify,sweep}.rs`, `coilbox-springlua/src/unitscript_tests.rs`, `coilbox-springlua/tests/unit_sweep.rs`, `tauri-plugin-coilbox-anim/src/bos2lua_parity.rs` and `tauri-plugin-coilbox-anim/src/cobrun_tests.rs`

**Interfaces:**
- Produces, in `coilbox_unitpose`:

```rust
pub struct World { pub stand_in: Option<StandIn>, pub own: Size }
pub struct StandIn { pub id: i32, pub pos: Option<[f64; 3]>, pub radius: f64, pub height: f64 }
pub struct Size { pub radius: f64, pub height: f64 }
// and on ScriptEvent:
pub world: Option<World>,
```

JSON shape from TypeScript: `{ "standIn": { "id", "pos", "radius", "height" } | null, "self": { "radius", "height" } }`.

- [ ] **Step 1: Write the failing test**

Add a test module at the bottom of `crates/coilbox-unitpose/src/lib.rs`, or beside its existing tests if it has a module:

```rust
#[cfg(test)]
mod world_tests {
    use super::*;

    /// The shape the panel sends, field for field.
    #[test]
    fn reads_the_world_the_panel_sends() {
        let event: ScriptEvent = serde_json::from_str(
            r#"{
                "frame": 120, "callin": "TransportPickup", "args": [2],
                "world": {
                    "standIn": { "id": 2, "pos": [0, 0, 84], "radius": 28, "height": 30.8 },
                    "self": { "radius": 60, "height": 40 }
                }
            }"#,
        )
        .unwrap();
        let world = event.world.unwrap();
        let stand_in = world.stand_in.unwrap();
        assert_eq!(stand_in.id, 2);
        assert_eq!(stand_in.pos, Some([0.0, 0.0, 84.0]));
        assert_eq!(world.own.radius, 60.0);
    }

    /// Every caller outside the panel sends no world, and a stand-in with no
    /// place on this frame sends no position.
    #[test]
    fn reads_an_event_with_no_world_and_a_stand_in_with_no_place() {
        let bare: ScriptEvent = serde_json::from_str(r#"{ "frame": 0, "callin": "Create" }"#).unwrap();
        assert!(bare.world.is_none());
        let gone: World = serde_json::from_str(
            r#"{ "standIn": { "id": 2, "pos": null, "radius": 4, "height": 4 }, "self": { "radius": 1, "height": 1 } }"#,
        )
        .unwrap();
        assert_eq!(gone.stand_in.unwrap().pos, None);
    }
}
```

If `serde_json` is not already a dev-dependency of `coilbox-unitpose`, check `crates/coilbox-unitpose/Cargo.toml`. The workspace already uses it, so adding it as a dev-dependency brings in no new dependency. Say so in the commit.

- [ ] **Step 2: Run it and watch it fail**

Run: `cargo test -p coilbox-unitpose world_tests`
Expected: compile error, no field `world`.

- [ ] **Step 3: Add the types and the field**

Add after `ScriptEvent` in `lib.rs`:

```rust
/// What the preview's scene holds on one event's frame, for a script that asks.
///
/// Sent with each event rather than once per run, because a scenario can pick
/// the stand-in up in one place and put it down in another. A runtime keeps the
/// last one it was handed. That is truthful for everything a script reads about
/// its passenger, because the engine only calls a transport once the passenger
/// has stopped (`rts/Sim/Units/CommandAI/MobileCAI.cpp:430-465,1414-1463`).
#[derive(Debug, Clone, Default, Deserialize)]
pub struct World {
    /// The one other unit in the scene, or none when the scenario has none.
    #[serde(rename = "standIn", default)]
    pub stand_in: Option<StandIn>,
    /// The unit the script runs on, which stands at the origin facing +z.
    #[serde(rename = "self")]
    pub own: Size,
}

/// The stand-in, in elmos, in the unit's own space, which is world space
/// because the unit stands at the origin facing +z.
#[derive(Debug, Clone, Copy, Deserialize)]
pub struct StandIn {
    pub id: i32,
    /// Where its base is, or none when the scenario puts it nowhere on this
    /// frame.
    pub pos: Option<[f64; 3]>,
    pub radius: f64,
    pub height: f64,
}

/// A unit's size as the engine keeps it: `radius` is the collision sphere's,
/// `height` the model's.
#[derive(Debug, Clone, Copy, Default, Deserialize)]
pub struct Size {
    pub radius: f64,
    pub height: f64,
}
```

Add to `ScriptEvent`, after `ambient`:

```rust
    /// The scene on this event's frame, for a script that asks where something
    /// is. None from every caller that is not the model editor's panel.
    #[serde(default)]
    pub world: Option<World>,
```

- [ ] **Step 4: Fix every literal**

Run `cargo check --workspace --all-targets 2>&1 | grep -B2 "missing field .world."` to list them. Add `world: None,` after the `ambient` line in each. Run `cargo check --workspace --all-targets` until clean.

- [ ] **Step 5: Run the tests**

Run: `cargo test -p coilbox-unitpose`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add crates/coilbox-unitpose crates/coilbox-bos2lua crates/coilbox-springlua crates/tauri-plugin-coilbox-anim
git commit -m "Let an event carry the scene as it stands on its frame"
```

### Task C2: the answers, written once

**Files:**
- Modify: `crates/coilbox-unitpose/src/unitvalue.rs`

**Interfaces:**
- Consumes: `World`, `StandIn`, `Size` from C1. `UNIT_ID`, `COBSCALE`, `pack_xz` in the same file.
- Produces:

```rust
pub struct Answer { pub value: i32, pub note: Option<String> }
pub fn world(id: i32, p1: i32, world: Option<&crate::World>) -> Option<Answer>
pub enum Who<'a> { Own(&'a crate::Size), StandIn(&'a crate::StandIn), Nobody }
pub fn who(id: i64, world: &crate::World) -> Who<'_>
```

C3 and C4 call `world`. C4's Lua functions call `who`.

- [ ] **Step 1: Write the failing tests**

Add to `mod tests` in `unitvalue.rs`:

```rust
    fn scene(pos: Option<[f64; 3]>) -> crate::World {
        crate::World {
            stand_in: Some(crate::StandIn {
                id: 2,
                pos,
                radius: 28.0,
                height: 30.8,
            }),
            own: crate::Size {
                radius: 60.0,
                height: 40.0,
            },
        }
    }

    fn value(id: i32, p1: i32, world: Option<&crate::World>) -> Option<i32> {
        self::world(id, p1, world).map(|answer| answer.value)
    }

    /// `rts/Sim/Units/Scripts/UnitScript.cpp:1060-1092`, a cell at a time.
    #[test]
    fn answers_for_the_unit_itself_from_the_origin() {
        let w = scene(Some([10.0, 2.0, 84.0]));
        for asker in [0, -1, UNIT_ID] {
            assert_eq!(value(UNIT_XZ, asker, Some(&w)), Some(0));
            assert_eq!(value(UNIT_Y, asker, Some(&w)), Some(0));
            assert_eq!(value(UNIT_HEIGHT, asker, Some(&w)), Some(60 * 65536));
        }
    }

    #[test]
    fn answers_for_the_stand_in_from_where_it_is() {
        let w = scene(Some([10.0, 2.0, 84.0]));
        assert_eq!(value(UNIT_XZ, 2, Some(&w)), Some(pack_xz(10.0, 84.0)));
        assert_eq!(value(UNIT_Y, 2, Some(&w)), Some(2 * 65536));
        // The radius, not the height: `UnitScript.cpp:1082-1092`.
        assert_eq!(value(UNIT_HEIGHT, 2, Some(&w)), Some(28 * 65536));
    }

    /// The engine's answer for a unit that does not exist, which is not a gap
    /// in the preview and so carries no note.
    #[test]
    fn answers_zero_for_a_unit_that_is_not_there() {
        let w = scene(Some([10.0, 2.0, 84.0]));
        let answer = world(UNIT_XZ, 7, Some(&w)).unwrap();
        assert_eq!(answer.value, 0);
        assert_eq!(answer.note, None);
    }

    #[test]
    fn says_so_when_the_stand_in_is_nowhere_on_this_frame() {
        let answer = world(UNIT_XZ, 2, Some(&scene(None))).unwrap();
        assert_eq!(answer.value, 0);
        assert!(answer.note.is_some());
    }

    #[test]
    fn the_ground_is_flat_at_zero_everywhere() {
        assert_eq!(value(GROUND_HEIGHT, pack_xz(100.0, -50.0), None), Some(0));
    }

    /// No world at all is every caller outside the panel. What needs no facts
    /// is still answered, and the rest is left for the caller's note.
    #[test]
    fn answers_what_needs_no_facts_when_given_no_world() {
        assert_eq!(value(UNIT_XZ, 0, None), Some(0));
        assert_eq!(value(UNIT_Y, 0, None), Some(0));
        assert_eq!(value(UNIT_HEIGHT, 0, None), None);
        assert_eq!(value(UNIT_XZ, 2, None), None);
    }

    #[test]
    fn leaves_everything_else_to_the_caller() {
        assert!(world(HEALTH, 0, Some(&scene(None))).is_none());
    }

    #[test]
    fn offers_no_control_for_a_question_about_the_world() {
        let mut asked = Vec::new();
        for id in [UNIT_XZ, UNIT_Y, UNIT_HEIGHT, GROUND_HEIGHT] {
            note_asked(&mut asked, id);
        }
        assert!(asked.is_empty(), "{asked:?}");
    }
```

- [ ] **Step 2: Run them and watch them fail**

Run: `cargo test -p coilbox-unitpose unitvalue`
Expected: compile errors, no `world`, `UNIT_XZ` and so on.

- [ ] **Step 3: Implement**

Add to `unitvalue.rs`, after `known`:

```rust
/// Ids that ask where a unit is or how big it is, from `CobDefines.h`.
pub const UNIT_XZ: i32 = 9;
pub const UNIT_Y: i32 = 10;
pub const UNIT_HEIGHT: i32 = 11;
pub const GROUND_HEIGHT: i32 = 16;

/// What a question about the scene was answered with, and what the preview
/// wants said about it.
#[derive(Debug, Clone, PartialEq)]
pub struct Answer {
    pub value: i32,
    pub note: Option<String>,
}

/// Which unit an id means in a scene with at most two in it.
pub enum Who<'a> {
    Own(&'a crate::Size),
    StandIn(&'a crate::StandIn),
    Nobody,
}

/// The engine reads 0 or less as "this unit" (`UnitScript.cpp:1061`).
pub fn who(id: i64, world: &crate::World) -> Who<'_> {
    if id <= 0 || id == i64::from(UNIT_ID) {
        return Who::Own(&world.own);
    }
    match &world.stand_in {
        Some(stand_in) if i64::from(stand_in.id) == id => Who::StandIn(stand_in),
        _ => Who::Nobody,
    }
}

/// Where a unit is and how big, answered off the scene the event carried.
///
/// `rts/Sim/Units/Scripts/UnitScript.cpp:1060-1105`. The unit itself stands at
/// the origin, and the ground is flat at 0, which is what the viewport draws.
/// `None` for an id this does not cover, and for one it cannot answer without
/// a scene, so the caller's own "no world" note still says so.
pub fn world(id: i32, p1: i32, world: Option<&crate::World>) -> Option<Answer> {
    let plain = |value: i32| Answer { value, note: None };
    if !matches!(id, UNIT_XZ | UNIT_Y | UNIT_HEIGHT | GROUND_HEIGHT) {
        return None;
    }
    if id == GROUND_HEIGHT {
        return Some(plain(0));
    }
    let asks_itself = p1 <= 0 || p1 == UNIT_ID;
    if asks_itself && id != UNIT_HEIGHT {
        return Some(plain(0));
    }
    let world = world?;
    let stand_in = match who(i64::from(p1), world) {
        Who::Own(own) => return Some(plain((own.radius * f64::from(COBSCALE)) as i32)),
        Who::Nobody => return Some(plain(0)),
        Who::StandIn(stand_in) => stand_in,
    };
    let Some(pos) = stand_in.pos else {
        return Some(Answer {
            value: 0,
            note: Some(
                "This script asks where the stand-in is on a frame this scenario puts it nowhere, so it read 0.".to_string(),
            ),
        });
    };
    Some(plain(match id {
        UNIT_XZ => pack_xz(pos[0], pos[2]),
        UNIT_Y => (pos[1] * f64::from(COBSCALE)) as i32,
        // The radius, which is what the engine answers under this name.
        _ => (stand_in.radius * f64::from(COBSCALE)) as i32,
    }))
}
```

In `excluded_from_asked`, add `|| matches!(id, UNIT_XZ | UNIT_Y | UNIT_HEIGHT | GROUND_HEIGHT)` to the returned expression and extend its doc comment:

```rust
/// ... and the questions about where a unit is, which a control keyed by id
/// alone cannot tell apart from one unit to the next.
```

Replace the local `const PIECE_XZ` and `const PIECE_Y` in `excluded_from_asked` with the public ones from A2.

`answers_nothing_about_the_world` asserts `known(GROUND_HEIGHT) == None`, which stays true. Leave it as it is.

- [ ] **Step 4: Run the tests**

Run: `cargo test -p coilbox-unitpose`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add crates/coilbox-unitpose/src/unitvalue.rs
git commit -m "Answer where a unit is and how big from the scene an event carries"
```

### Task C3: the compiled runtime answers from the scene

**Files:**
- Modify: `crates/tauri-plugin-coilbox-anim/src/cobrun.rs`: the `Run` struct (`:300-334`), `Run::start` (`:337-368`), `fire_due` (`:427-466`), `cob_args` (`:218-238`), `unit_value` (`:1090-1137`)
- Test: `crates/tauri-plugin-coilbox-anim/src/cobrun_tests.rs`, in `mod what_it_says_about_itself`

**Interfaces:**
- Consumes: `unitvalue::world`, `World`, `StandIn`, `Size` from C1 and C2.

- [ ] **Step 1: Write the failing tests**

```rust
    fn scene(pos: Option<[f64; 3]>) -> coilbox_unitpose::World {
        coilbox_unitpose::World {
            stand_in: Some(coilbox_unitpose::StandIn {
                id: 2,
                pos,
                radius: 28.0,
                height: 30.8,
            }),
            own: coilbox_unitpose::Size {
                radius: 60.0,
                height: 40.0,
            },
        }
    }

    /// `get UNIT_Y(unitid)` then move the base by it, from a call-in handed
    /// the stand-in's id, as `TransportPickup` is.
    fn reads_y_of_the_passenger() -> Vec<u8> {
        let mut pickup = vec![op("CREATE_LOCAL_VAR")];
        pickup.extend(push(10));
        pickup.extend([op("PUSH_LOCAL_VAR"), 0]);
        pickup.extend(push(0));
        pickup.extend(push(0));
        pickup.extend(push(0));
        pickup.push(op("GET"));
        pickup.extend([op("MOVE_NOW"), 0, 2, op("RETURN")]);
        build(&[("TransportPickup", pickup)], PIECES, 0)
    }

    #[test]
    fn tells_a_transport_where_its_passenger_is() {
        let timeline = run(
            &reads_y_of_the_passenger(),
            &model_pieces(),
            &[ScriptEvent {
                frame: 0,
                callin: "TransportPickup".to_string(),
                args: vec![2.0],
                ambient: false,
                world: Some(scene(Some([0.0, 3.0, 84.0]))),
            }],
            2,
            &[],
            &HashMap::new(),
        );

        assert!(close(pose(&timeline, 0, "base")[2], 3.0));
        assert!(
            !timeline.warnings.iter().any(|note| note.contains("the world")),
            "{:?}",
            timeline.warnings
        );
    }

    /// A call-in fired later reads the scene its own event brought, which is
    /// what a parked passenger looks like to it.
    #[test]
    fn a_later_event_moves_the_passenger() {
        let first = ScriptEvent {
            frame: 0,
            callin: "Create".to_string(),
            args: Vec::new(),
            ambient: false,
            world: Some(scene(Some([0.0, 1.0, 0.0]))),
        };
        let second = ScriptEvent {
            frame: 1,
            callin: "TransportPickup".to_string(),
            args: vec![2.0],
            ambient: false,
            world: Some(scene(Some([0.0, 5.0, 0.0]))),
        };
        let timeline = run(
            &reads_y_of_the_passenger(),
            &model_pieces(),
            &[first, second],
            3,
            &[],
            &HashMap::new(),
        );

        assert!(close(pose(&timeline, 1, "base")[2], 5.0));
    }

    /// COB's `BeginTransport` takes the passenger's model height, not its id
    /// (`CobInstance.cpp:355-360`).
    #[test]
    fn hands_begin_transport_the_stand_ins_height_when_there_is_one() {
        let mut begin = vec![op("CREATE_LOCAL_VAR")];
        begin.extend([op("PUSH_LOCAL_VAR"), 0]);
        begin.extend([op("MOVE_NOW"), 0, 2, op("RETURN")]);
        let bytes = build(&[("BeginTransport", begin)], PIECES, 0);

        let timeline = run(
            &bytes,
            &model_pieces(),
            &[ScriptEvent {
                frame: 0,
                callin: "BeginTransport".to_string(),
                args: vec![2.0],
                ambient: false,
                world: Some(scene(Some([0.0, 0.0, 0.0]))),
            }],
            2,
            &[],
            &HashMap::new(),
        );

        assert!(close(pose(&timeline, 0, "base")[2], 30.8));
    }
```

If `close` is too tight for `30.8` after the round trip through 65536ths, compare within `1e-4` as `packs_a_transport_drop_position_the_way_a_cob_reads_it` does.

- [ ] **Step 2: Run them and watch them fail**

Run: `cargo test -p tauri-plugin-coilbox-anim --lib what_it_says_about_itself`
Expected: the three new tests FAIL. The base does not move, and the "no world" note appears.

- [ ] **Step 3: Implement**

Add a field to `Run`, after `set_values`:

```rust
    /// The scene the latest event brought, which is what a script asking where
    /// something is gets told until the next event brings another.
    world: Option<coilbox_unitpose::World>,
```

Initialise it as `world: None,` in `Run::start`.

At the top of the loop body in `fire_due`, before the `let Some(function) = ...` line:

```rust
            // Before the call-in, and whether or not the script has one, so
            // the scene is right for every thread from this frame on.
            if let Some(world) = &event.world {
                self.world = Some(world.clone());
            }
```

Change `cob_args` to take the scene, and use it for `BeginTransport`:

```rust
fn cob_args(callin: &str, args: &[f64], world: Option<&coilbox_unitpose::World>) -> Vec<i32> {
```

```rust
    if lower == "begintransport" {
        // The passenger's model height, which is what COB is handed where Lua
        // is handed the id. Without a scene the argument is taken as that
        // height, which is what a caller outside the panel means by it.
        if let Some(stand_in) = world.and_then(|world| world.stand_in.as_ref()) {
            return vec![(stand_in.height * 65536.0) as i32];
        }
        return args.iter().map(|arg| (arg * 65536.0) as i32).collect();
    }
```

Update its one caller in `fire_due` to `thread.data = cob_args(&event.callin, &event.args, self.world.as_ref());`.

In `unit_value`, after the `PIECE_XZ || PIECE_Y` block and before `if let Some(value) = self.set_values.get(&id)`:

```rust
        // Where a unit is and how big, from the scene the latest event brought.
        // Before the stored values, because a script cannot set these.
        if let Some(answer) = unitvalue::world(id, p1, self.world.as_ref()) {
            if let Some(note) = answer.note {
                self.model.note(note);
            }
            return answer.value;
        }
```

- [ ] **Step 4: Run the crate's tests**

Run: `cargo test -p tauri-plugin-coilbox-anim`
Expected: PASS. `hands_begin_transport_a_height_rather_than_a_unit_id` still passes, because it sends no world.

- [ ] **Step 5: Commit**

```bash
git add crates/tauri-plugin-coilbox-anim/src/cobrun.rs crates/tauri-plugin-coilbox-anim/src/cobrun_tests.rs
git commit -m "Tell a compiled script where the stand-in is"
```

### Task C4: the Lua runtime answers from the scene

**Files:**
- Modify: `crates/coilbox-springlua/src/unitscript.rs`: `struct Sim` (`:198-236`), `fire_due` (`:571-596`), the `GetUnitValue` closure (`:2117-2150`), `Spring.GetUnitPosition` (`:1398-1410`), and new `Spring.GetUnitHeight` and `Spring.GetUnitRadius` beside it
- Test: `crates/coilbox-springlua/src/unitscript_tests.rs`, in `mod world`

**Interfaces:**
- Consumes: `unitvalue::world`, `unitvalue::who`, `unitvalue::Who`, `World` from C1 and C2.

- [ ] **Step 1: Write the failing tests**

```rust
    fn scene(pos: Option<[f64; 3]>) -> coilbox_unitpose::World {
        coilbox_unitpose::World {
            stand_in: Some(coilbox_unitpose::StandIn {
                id: 2,
                pos,
                radius: 28.0,
                height: 30.8,
            }),
            own: coilbox_unitpose::Size {
                radius: 60.0,
                height: 40.0,
            },
        }
    }

    fn pickup(script: &str, world: Option<coilbox_unitpose::World>) -> Timeline {
        run(
            script,
            "test.lua",
            &Unit::new(&pieces()),
            &[ScriptEvent {
                frame: 0,
                callin: "TransportPickup".to_string(),
                args: vec![2.0],
                ambient: false,
                world,
            }],
            2,
            &HashMap::new(),
        )
    }

    /// The same question a converted BOS script asks, answered the same way.
    #[test]
    fn tells_a_transport_by_unit_value_where_its_passenger_is() {
        let timeline = pickup(
            r#"
            local base = piece("base")
            function script.TransportPickup(passenger)
                Move(base, z_axis, GetUnitValue(COB.UNIT_Y, passenger) / 65536)
            end
            "#,
            Some(scene(Some([0.0, 3.0, 84.0]))),
        );
        assert_eq!(timeline.error, None);
        assert_close(pose(&timeline, 0, "base")[2], 3.0);
    }

    /// How a Lua transport asks, which is SplinterFaction's
    /// `lozdragonfly_lus.lua` on its first line.
    #[test]
    fn tells_a_transport_by_spring_call_where_and_how_big_its_passenger_is() {
        let timeline = pickup(
            r#"
            local base = piece("base")
            local turret = piece("turret")
            local barrel = piece("barrel")
            function script.TransportPickup(passenger)
                local _, _, z = Spring.GetUnitPosition(passenger)
                Move(base, z_axis, z)
                Move(turret, z_axis, Spring.GetUnitHeight(passenger))
                Move(barrel, z_axis, Spring.GetUnitRadius(passenger))
            end
            "#,
            Some(scene(Some([0.0, 3.0, 84.0]))),
        );
        assert_eq!(timeline.error, None);
        assert_close(pose(&timeline, 0, "base")[2], 84.0);
        assert_close(pose(&timeline, 0, "turret")[2], 30.8);
        assert_close(pose(&timeline, 0, "barrel")[2], 28.0);
    }

    /// The engine hands back nothing for a unit that does not exist.
    #[test]
    fn a_unit_that_is_not_there_has_no_position_or_size() {
        let timeline = pickup(
            r#"
            function script.TransportPickup(passenger)
                if Spring.GetUnitPosition(7) ~= nil then error("found a unit") end
                if Spring.GetUnitHeight(7) ~= nil then error("sized a unit") end
            end
            "#,
            Some(scene(Some([0.0, 3.0, 84.0]))),
        );
        assert_eq!(timeline.error, None);
        assert!(
            !timeline.warnings.iter().any(|note| note.contains("stopped")),
            "{:?}",
            timeline.warnings
        );
    }

    /// Its own position is still the origin, as it was before there was a
    /// scene.
    #[test]
    fn the_unit_itself_is_still_at_the_origin() {
        let timeline = pickup(
            r#"
            local base = piece("base")
            function script.TransportPickup(passenger)
                local x, y, z = Spring.GetUnitPosition(unitID)
                Move(base, z_axis, x + y + z + Spring.GetUnitRadius(unitID))
            end
            "#,
            Some(scene(Some([0.0, 3.0, 84.0]))),
        );
        assert_eq!(timeline.error, None);
        assert_close(pose(&timeline, 0, "base")[2], 60.0);
    }
```

A Lua `error()` inside a call-in may surface as a warning that the thread stopped rather than as `timeline.error`. The third test checks both. Confirm the wording by reading how `converted_scripts_move_pieces_as_their_cobs_do` detects "That thread stopped", and match it.

- [ ] **Step 2: Run them and watch them fail**

Run: `cargo test -p coilbox-springlua world::`
Expected: FAIL. `GetUnitHeight` is nil, and the base does not move.

- [ ] **Step 3: Implement**

Add to `struct Sim`, after `values`:

```rust
    /// The scene the latest event brought, for a script asking where something
    /// is. Kept until the next event brings another.
    world: Option<coilbox_unitpose::World>,
```

`Sim` is built with `..Sim::default()`, so `Option` needs nothing more.

At the top of the loop body in `fire_due`, before the `let function: Option<Function> = ...` line:

```rust
            // Before the call-in, and whether or not the script has one, so
            // the scene is right for every thread from this frame on.
            if let Some(world) = &event.world {
                self.sim.borrow_mut().world = Some(world.clone());
            }
```

In the `GetUnitValue` closure, after the PIECE block from A3 and before `if let Some(value) = sim.values.get(&id)`:

```rust
            // Where a unit is and how big, from the scene the latest event
            // brought. Before the stored values, because a script cannot set
            // these.
            if let Some(answer) = unitvalue::world(id, p1, sim.world.as_ref()) {
                if let Some(note) = answer.note {
                    sim.model.note(note);
                }
                return Ok(answer.value);
            }
```

Replace `Spring.GetUnitPosition` with:

```rust
    // The unit itself stands at the origin, which is where the viewport draws
    // it. The stand-in is where the scene the latest event brought puts it, and
    // any other id is a unit that does not exist, which the engine answers with
    // nothing.
    let state = Rc::clone(sim);
    spring.set(
        "GetUnitPosition",
        lua.create_function(move |_, (id, _): (Option<i64>, MultiValue)| {
            let mut sim = state.borrow_mut();
            let asked = id.unwrap_or(i64::from(unitvalue::UNIT_ID));
            let Some(world) = sim.world.clone() else {
                sim.model.note(
                    "GetUnitPosition answers the origin in the preview, which is where the unit stands because there is nowhere else to stand.".to_string(),
                );
                return Ok((Some(0.0), Some(0.0), Some(0.0)));
            };
            Ok(match unitvalue::who(asked, &world) {
                unitvalue::Who::Own(_) => (Some(0.0), Some(0.0), Some(0.0)),
                unitvalue::Who::StandIn(stand_in) => match stand_in.pos {
                    Some([x, y, z]) => (Some(x), Some(y), Some(z)),
                    None => {
                        sim.model.note(
                            "This script asks where the stand-in is on a frame this scenario puts it nowhere, so it read nothing.".to_string(),
                        );
                        (None, None, None)
                    }
                },
                unitvalue::Who::Nobody => (None, None, None),
            })
        })?,
    )?;
```

Add after it, one function per engine call (`rts/Lua/LuaSyncedRead.cpp:238-239`):

```rust
    // A unit's size, which a transport reads to know how far to lower what it
    // is carrying.
    let state = Rc::clone(sim);
    spring.set(
        "GetUnitHeight",
        lua.create_function(move |_, (id, _): (Option<i64>, MultiValue)| {
            Ok(unit_size(&state, "GetUnitHeight", id).map(|(_, height)| height))
        })?,
    )?;
    let state = Rc::clone(sim);
    spring.set(
        "GetUnitRadius",
        lua.create_function(move |_, (id, _): (Option<i64>, MultiValue)| {
            Ok(unit_size(&state, "GetUnitRadius", id).map(|(radius, _)| radius))
        })?,
    )?;
```

And a helper beside `piece_position` (`unitscript.rs:1702`):

```rust
/// A unit's radius and height from the scene the latest event brought, or
/// nothing for a unit that does not exist, which is what the engine answers.
fn unit_size(sim: &Rc<RefCell<Sim>>, asked_by: &str, id: Option<i64>) -> Option<(f64, f64)> {
    let mut sim = sim.borrow_mut();
    let Some(world) = sim.world.clone() else {
        sim.model.note(format!(
            "{asked_by} has nothing to answer with, because the preview was not told how big anything is."
        ));
        return None;
    };
    match unitvalue::who(id.unwrap_or(i64::from(unitvalue::UNIT_ID)), &world) {
        unitvalue::Who::Own(own) => Some((own.radius, own.height)),
        unitvalue::Who::StandIn(stand_in) => Some((stand_in.radius, stand_in.height)),
        unitvalue::Who::Nobody => None,
    }
}
```

- [ ] **Step 4: Run the crate's tests**

Run: `cargo test -p coilbox-springlua`
Expected: PASS, including the existing `GetUnitPosition(unitID)` test at `unitscript_tests.rs:1968`.

- [ ] **Step 5: Commit**

```bash
git add crates/coilbox-springlua/src/unitscript.rs crates/coilbox-springlua/src/unitscript_tests.rs
git commit -m "Tell a Lua script where the stand-in is and how big, and how big it is itself"
```

### Task C5: the resolver builds the scene for each event

**Files:**
- Modify: `src/lego/scriptPlayback.ts:15-36` (the `ScriptEvent` interface) and `:213` (`STAND_IN_UNIT_ID`)
- Modify: `src/lego/standIn.ts` (export a height)
- Modify: `src/lego/s3oBuild.ts` (export the unit's own size)
- Modify: `src/lego/aimResolver.ts` (the scene resolver)
- Test: `src/lego/aimResolver.test.ts`, `src/lego/s3oBuild.test.ts`

**Interfaces:**
- Produces:

```ts
// scriptPlayback.ts
export interface ScriptWorld {
  standIn: { id: number; pos: [number, number, number] | null; radius: number; height: number } | null;
  self: { radius: number; height: number };
}
// ScriptEvent gains: world?: ScriptWorld;
export const STAND_IN_UNIT_ID = 2;
// standIn.ts
export function standInHeight(radius: number): number;
// s3oBuild.ts
export function unitSize(project: LegoProject, pack: LoadedPack, raw: RawGeometry | null): { radius: number; height: number };
// aimResolver.ts
export interface WorldContext {
  radius: number;
  self: { radius: number; height: number };
  attachPiece: (from: StandInAttach["from"]) => Vec3 | null;
}
export function worldAt(track: StandInTrack | null, frame: number, ctx: WorldContext): ScriptWorld;
export function withWorld(events: ScriptEvent[], track: StandInTrack | null, ctx: WorldContext): ScriptEvent[];
```

- [ ] **Step 1: Write the failing tests**

In `aimResolver.test.ts`:

```ts
import { withWorld, worldAt, type WorldContext } from "./aimResolver";
import { STAND_IN_UNIT_ID, type StandInTrack } from "./scriptPlayback";
import { standInHeight } from "./standIn";

const CTX: WorldContext = {
  radius: 10,
  self: { radius: 60, height: 40 },
  attachPiece: (from) => (from === "QueryTransport" ? [0, 20, -5] : null),
};

const PARKED: StandInTrack = {
  keys: [
    { frame: 0, pos: [0, 0, 5] },
    { frame: 90, pos: [0, 0, 3] },
    { frame: 330, pos: [0, 0, 3] },
  ],
};

describe("worldAt", () => {
  it("puts the stand-in where its track does, in elmos", () => {
    const world = worldAt(PARKED, 120, CTX);
    expect(world.standIn).toEqual({
      id: STAND_IN_UNIT_ID,
      pos: [0, 0, 30],
      radius: 10,
      height: standInHeight(10),
    });
    expect(world.self).toEqual({ radius: 60, height: 40 });
  });

  /** A carried unit is where its attach piece is, so a transport dropping it
   *  reads the pad rather than the ground (the Hulk's `TransportDrop`). */
  it("puts an attached stand-in on the piece it rides", () => {
    const riding: StandInTrack = {
      ...PARKED,
      attach: { from: "QueryTransport", frame: 0, until: 150, follow: true },
    };
    expect(worldAt(riding, 120, CTX).standIn?.pos).toEqual([0, 20, -5]);
  });

  it("measures a key from the attach piece when the key says to", () => {
    const leaving: StandInTrack = {
      keys: [{ frame: 0, pos: [0, -1, 0], fromAttachPiece: true }],
      attach: { from: "QueryTransport", frame: 100, until: null, follow: true },
    };
    expect(worldAt(leaving, 0, CTX).standIn?.pos).toEqual([0, 10, -5]);
  });

  it("keeps the stand-in's id on a frame with nowhere to put it", () => {
    const world = worldAt({ keys: [] }, 0, CTX);
    expect(world.standIn?.id).toBe(STAND_IN_UNIT_ID);
    expect(world.standIn?.pos).toBeNull();
  });

  it("has no stand-in at all when the scenario has none", () => {
    expect(worldAt(null, 0, CTX).standIn).toBeNull();
  });
});

describe("withWorld", () => {
  it("gives every event the scene on its own frame", () => {
    const events = withWorld(
      [
        { frame: 0, callin: "Create" },
        { frame: 120, callin: "TransportPickup", args: [STAND_IN_UNIT_ID] },
      ],
      PARKED,
      CTX,
    );
    expect(events[0].world?.standIn?.pos).toEqual([0, 0, 50]);
    expect(events[1].world?.standIn?.pos).toEqual([0, 0, 30]);
  });
});
```

Frame 0 is the first key, `[0, 0, 5]` times radius 10. Frame 120 lies between the keys at 90 and 330, which are both `[0, 0, 3]`, so it is 30.

In `s3oBuild.test.ts`, beside the existing `describe("buildS3o")` tests, add a `unitSize` test that builds the same fixture the first `buildS3o` test builds and asserts:

```ts
expect(unitSize(project, pack, raw)).toEqual({
  radius: built?.radius,
  height: built?.height,
});
```

where `built` is `buildS3o(...)` over the same fixture. Copy the fixture construction from that first test rather than inventing one. It is the source of truth for how a project is built in that file.

- [ ] **Step 2: Run them and watch them fail**

Run: `bunx vitest run src/lego/aimResolver.test.ts src/lego/s3oBuild.test.ts`
Expected: FAIL, missing exports.

- [ ] **Step 3: Implement**

`scriptPlayback.ts`: export `ScriptWorld` as in Interfaces, and add to `ScriptEvent`:

```ts
  /**
   * The scene on this event's frame, for a script that asks where something is.
   * Filled in by `withWorld` before the run, never written by hand, for the
   * same reason `aimAtStandIn` is resolved rather than literal.
   */
  world?: ScriptWorld;
```

Change `const STAND_IN_UNIT_ID = 1;` to `export const STAND_IN_UNIT_ID = 2;` and add to its comment:

```ts
 * Two, not one: one is the unit itself (`UNIT_ID` in
 * `crates/coilbox-unitpose/src/unitvalue.rs`), and a script asking where its
 * passenger is would otherwise be told where it is itself.
```

`standIn.ts`, below the `HEIGHT` declaration so it is initialised before use:

```ts
/** How tall the stand-in is, in elmos, which is what the engine calls a
 *  unit's height. */
export function standInHeight(radius: number): number {
  return HEIGHT * radius;
}
```

`s3oBuild.ts`, after `unitBounds`:

```ts
/**
 * The radius and height the exported header would carry, which is what the
 * engine keeps as the unit's own `radius` and `height` and answers a script
 * asking how big it is with.
 */
export function unitSize(
  project: LegoProject,
  pack: LoadedPack,
  raw: RawGeometry | null,
): { radius: number; height: number } {
  const { world } = bakedPieces(project, pack, raw);
  const measured = header(world, project.mid);
  return {
    radius: project.radius ?? measured.radius,
    height: project.height ?? measured.height,
  };
}
```

`aimResolver.ts`, after `resolveScenario`. Add `ScriptWorld` and `StandInAttach` to the type import from `./scriptPlayback`, `STAND_IN_UNIT_ID` as a value import from it, and `attachedAt` and `standInHeight` to the import from `./standIn`:

```ts
/** What the scene resolver needs to know about the unit and its script. */
export interface WorldContext {
  /** The stand-in's radius beside this unit, in elmos. */
  radius: number;
  /** The unit's own size, as its exported header would carry it. */
  self: { radius: number; height: number };
  /** Where the piece a call-in names rests, or null when the script names
   *  none or cannot be asked. */
  attachPiece: (from: StandInAttach["from"]) => Vec3 | null;
}

/**
 * The scene on one frame, as a script asking about it is told.
 *
 * A carried stand-in is where its attach piece rests, because a carried unit
 * is where its transport holds it. Rest rather than animated, for the reason
 * the aim is measured from rest: the answer has to exist before the run.
 */
export function worldAt(
  track: StandInTrack | null,
  frame: number,
  ctx: WorldContext,
): ScriptWorld {
  if (!track) return { standIn: null, self: ctx.self };
  const base = {
    id: STAND_IN_UNIT_ID,
    radius: ctx.radius,
    height: standInHeight(ctx.radius),
  };

  const attach = attachedAt(track, frame);
  const riding = attach ? ctx.attachPiece(attach.from) : null;
  if (riding) return { standIn: { ...base, pos: riding }, self: ctx.self };

  const pose = standInAt(track, frame, ctx.radius);
  if (!pose) return { standIn: { ...base, pos: null }, self: ctx.self };
  const from =
    pose.fromAttachPiece && track.attach
      ? ctx.attachPiece(track.attach.from)
      : null;
  const pos: Vec3 = from
    ? [from[0] + pose.pos[0], from[1] + pose.pos[1], from[2] + pose.pos[2]]
    : pose.pos;
  return { standIn: { ...base, pos }, self: ctx.self };
}

/** Every event with the scene on its own frame. */
export function withWorld(
  events: ScriptEvent[],
  track: StandInTrack | null,
  ctx: WorldContext,
): ScriptEvent[] {
  return events.map((event) => ({
    ...event,
    world: worldAt(track, event.frame, ctx),
  }));
}
```

- [ ] **Step 4: Run the tests**

Run: `bunx vitest run src/lego/aimResolver.test.ts src/lego/s3oBuild.test.ts src/lego/scriptPlayback.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lego/scriptPlayback.ts src/lego/standIn.ts src/lego/s3oBuild.ts src/lego/aimResolver.ts src/lego/aimResolver.test.ts src/lego/s3oBuild.test.ts
git commit -m "Work out the scene each event's script will be told about"
```

### Task C6: the panel sends the scene with every run

**Files:**
- Modify: `src/lego/pages/components/AnimationPanel.tsx`: imports (`:33-72`), `runEvents` (`:312-379`), `start` (`:388-436`)
- Test: `src/lego/pages/components/AnimationPanel.dom.test.tsx`

**Interfaces:**
- Consumes: `withWorld` and `unitSize` from C5. `pieceWorldRest` and `standInRadius` are already imported.

- [ ] **Step 1: Write the failing tests**

Add to `AnimationPanel.dom.test.tsx`:

```tsx
describe("the scene a script is told about", () => {
  /** Every run carries at least the unit's own size, so a script asking how
   *  big it is gets an answer rather than a note. */
  it("goes with a scenario that has no stand-in", async () => {
    show(project({ compiledScript: COMPILED }));
    fireEvent.click(screen.getByRole("button", { name: /Play/ }));

    await waitFor(() => expect(runCob).toHaveBeenCalled());
    const events = runCob.mock.calls[0][0].events;
    expect(events.length).toBeGreaterThan(0);
    for (const event of events) {
      expect(event.world).toMatchObject({ standIn: null });
      expect(event.world.self).toBeDefined();
    }
  });

  it("puts the stand-in in it for a scenario that has one", async () => {
    show(project({ compiledScript: COMPILED }));
    fireEvent.click(
      screen.getByRole("combobox", { name: "What happens to the unit" }),
    );
    fireEvent.click(await screen.findByText("Loading a transport"));
    fireEvent.click(screen.getByRole("button", { name: /Play/ }));

    await waitFor(() => expect(runCob).toHaveBeenCalled());
    const events = runCob.mock.calls.at(-1)?.[0].events;
    const begin = events.find(
      (event: { callin: string }) => event.callin === "BeginTransport",
    );
    expect(begin.world.standIn).toMatchObject({ id: 2 });
    expect(begin.world.standIn.pos).toHaveLength(3);
  });
});
```

If picking a scenario from the select starts a run by itself, as the "Call a function" test suggests, drop the Play click in the second test and wait on the call the select causes.

- [ ] **Step 2: Run them and watch them fail**

Run: `bunx vitest run src/lego/pages/components/AnimationPanel.dom.test.tsx`
Expected: FAIL, `event.world` is undefined.

- [ ] **Step 3: Implement**

Import `withWorld` beside `resolveScenario` from `../../aimResolver`, and `unitSize` beside `pieceWorldRest, unitBounds` from `../../s3oBuild`.

Below the `bounds` memo:

```tsx
  // The unit's own size, for a script that asks how big it is. Memoised for
  // the reason `bounds` is.
  const size = useMemo(() => unitSize(project, pack, raw), [project, pack, raw]);
```

In `runEvents`, at the top of the `try` block, before `const pieces = ...`:

```tsx
        // Every run carries the scene. A scenario with a stand-in has already
        // been given it by `start`. Anything else, an idle run or a call to one
        // of the script's own functions, is the unit alone.
        const sent = events.some((event) => event.world)
          ? events
          : withWorld(events, null, {
              radius: 0,
              self: size,
              attachPiece: () => null,
            });
```

Use `events: sent` in both the `animCobRun` and the `legoRunScript` calls. Add `size` to `runEvents`' dependency list.

In `start`, hoist `pieceWorldRest(project, pack, raw)` above the `resolveScenario` call into `const rest = ...`, and pass `pieceRest: rest` to `resolveScenario`, so the unit is baked once. Then replace the final `return runEvents(events, withValues);` with:

```tsx
      const scene = withWorld(events, scenario.standIn ?? null, {
        radius: standInRadius(bounds),
        self: size,
        attachPiece: (from) => {
          const piece = named.get(from);
          return piece ? (rest.get(piece) ?? null) : null;
        },
      });
      return runEvents(scene, withValues);
```

Add `size` to `start`'s dependency list.

- [ ] **Step 4: Run the tests**

Run: `bunx vitest run src/lego`
Expected: PASS. The "Call a function" test uses `toMatchObject` on events, so an added `world` field does not break it.

- [ ] **Step 5: Commit**

```bash
git add src/lego/pages/components/AnimationPanel.tsx src/lego/pages/components/AnimationPanel.dom.test.tsx
git commit -m "Send the scene with every script run the panel makes"
```

### Task C7: check it on screen, then file part C

- [ ] **Step 1:** Run all seven CI commands.
- [ ] **Step 2:** Start your own portable instance, following "Driving the app" in `CLAUDE.md`. Seed `.coilbox/data` from the user's settings directory. Use your own port and socket. Drive it through a second MCP server over stdio, not the session's pinned one. Confirm which app you are driving before trusting a screenshot.
- [ ] **Step 3:** Open Balanced Annihilation's Hulk, `armtship` in `balanced_annihilation-v15.9.8.sdz`, in the model editor. Pick "Loading a ship or hover transport", which needs part B merged, and play it with the compiled script. Pass means:
  - none of the six "asks the world for value" notes from `docs/reports/2026-09-22-world-mock-findings.md` appears
  - the boom telescopes and turns towards the stand-in rather than to a fixed place
  - the reach guard passes, so `BoomExtend` runs at all.
- [ ] **Step 4:** If the reach guard fails, the stand-in is parked out of reach. Move the parked keys in `transport-pickup` nearer (smaller z), rerun, and commit the change separately with the parked position that passed.
- [ ] **Step 5:** Take the Hulk's script over as Lua and repeat step 3. Both runtimes must show the same boom.
- [ ] **Step 6:** Offer the user `bun tauri dev` to see it themselves.
- [ ] **Step 7:** Stop your instance by its own absolute path. Revert any local edits to the MCP socket path. Delete the portable data you created.
- [ ] **Step 8:** File the PR through `file-pr` once the user approves the description. Say in it that the Hulk still lifts its passenger into empty sea until project 2 records `attach-unit`, and that `intruder.bos` `AreaUnload` is a known limit.
