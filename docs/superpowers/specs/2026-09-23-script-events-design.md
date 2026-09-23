# Script events out of both unit script runtimes

Project 2 of the stand-in work. What a unit script announces (`EmitSfx`, `AttachUnit`, `DropUnit`, `Explode`, `PlaySoundFile`) is recorded as frame-stamped events on `ScriptTimeline` instead of being discarded with a note. The stand-in rides the piece a script attaches it to, and the runtime answers where it is from then on.

Read first: `2026-09-22-model-editor-stand-in-unit-design.md` ("4. Attachment" and "Follow-on projects"), `2026-09-23-stand-in-world-design.md` (project 4), and blocker 3 in `docs/reports/2026-09-22-world-mock-findings.md`.

## What is there today

Both runtimes stub these calls. The compiled runtime pops the operands and notes "Effects are not drawn in the preview", "Explode throws no debris", "Sound is not played" and "Attaching a unit does nothing" (`crates/tauri-plugin-coilbox-anim/src/cobrun.rs:927-957`). The Lua runtime does the same through `install_stubs` and its `Explode` (`crates/coilbox-springlua/src/unitscript.rs:1949-1962,2028-2052`), and through `Spring.PlaySoundFile` (`:1555`).

The stand-in's attachment is decided before the run: `StandInTrack.attach` names a call-in, `legoProbeScript` asks the script for its piece, and `standInPlayback.ts` rides that piece. The probe is Lua only, so a compiled `.cob` unit never has an attach piece.

BA's Hulk (`armtship` in `balanced_annihilation-v15.9.8.sdz`) under "Loading a ship or hover transport" now reaches for the stand-in correctly, then runs `attach-unit unitid to link`, `attach-unit unitid to 0 - 1` and, in `TransportDrop`, `drop-unit`. The stand-in stays parked on the ground throughout.

## What the engine does

From `~/dev/RecoilEngine`. These facts set the design.

**An attach does not move the passenger when it happens.** `CUnit::AttachUnit` records the piece and nothing else (`rts/Sim/Units/Unit.cpp:2635-2712`). Every frame, after every script has ticked, `CUnitHandler::UpdatePostAnimation` calls `UpdateTransportees`, which moves each passenger onto its attach piece's current world position (`rts/Game/Game.cpp:1796-1798`, `rts/Sim/Units/UnitHandler.cpp:457-467`, `Unit.cpp:718-757`). So the passenger follows the animated piece frame by frame, and a script that reads it sees where the piece was at the end of the last frame's animation.

**Piece -1 is the void, not a pad.** A negative piece puts the passenger at the transporter's own position (`Unit.cpp:726-732`) and sets its void state (`Unit.cpp:2672`, `rts/Sim/Objects/SolidObject.cpp:197-206`), and `UnitDrawer.cpp:418` does not draw a unit in the void. The Hulk's `attach-unit unitid to 0 - 1` after `BoomToPad` hides its passenger once it is aboard.

**A drop leaves the passenger where it was.** `DetachUnit` clears the transporter and hands the unit back to its move type (`Unit.cpp:2715-2780`). Nothing moves it at the moment of the drop. Its last position is the one `UpdateTransportees` gave it on the frame before.

**Orientation follows the transporter's body** unless the unit definition sets `holdSteady` (`Unit.cpp:734-748`). The editor has no unit definition, so the stand-in keeps the unit's heading of 0 while carried.

**The air arm attaches and detaches in the engine, not in the script.** `MobileCAI.cpp:1451-1453` calls `BeginTransport(unit)` and then `owner->AttachUnit(unit, QueryTransport(unit))`. Unloading calls `DetachUnitFromAir`, straight after `TransportDrop` when landing (`MobileCAI.cpp:2090-2091,2106-2107`) or after `EndTransport` when dropping in flight (`:2041-2042`). Every other transport calls `TransportPickup` or `TransportDrop` and leaves the script to attach and drop (`:1463,1969,2050`).

**A missing `QueryTransport` answers differently per runtime.** Lua's `RunQueryCallIn` answers -1, the void (`LuaUnitScript.cpp:505-519`). COB's `RealCall` leaves the argument array untouched (`CobInstance.cpp:564-579`), and `QueryTransport` set its first slot to 2, so it answers script piece 2 (`CobInstance.cpp:363-374`).

**How each call arrives**, checked opcode by opcode:

| Call | COB (`CobThread.cpp`) | Lua (`LuaUnitScript.cpp`) |
|---|---|---|
| sfx | type popped, piece from the code word (`:520-524`) | `EmitSfx(piece, type)`, piece 1-based (`:1422-1433`) |
| attach | unit, piece, then an unused third operand, all popped (`:677-682`) | `AttachUnit(piece, unit)`, piece 1-based (`:1445-1457`) |
| drop | unit popped (`:684-686`) | `DropUnit(unit)` (`:1468-1480`) |
| explode | piece from the code word, flags popped (`:456-460`) | `Explode(piece, flags)` |
| sound | sound index from the code word, attribute popped (`:462-466`) | `Spring.PlaySoundFile(name, ...)` |

A COB sound index names an entry in the file's sound table, which only TA:K scripts carry (`CobFile.cpp:37-38,174-190`).

## Decision: the runtime owns the stand-in from its first attach

One pass, not two. From the first frame the stand-in is attached to the end of the run, the runtime keeps where it is and answers every read about it from that. The TypeScript track owns it before then.

Two passes would not converge. Scripts branch on what they read: the Hulk's reach guard decides whether `attach-unit` runs at all, and `intruder.bos` `AreaUnload` loops on `UNIT_XZ(passenger) != PIECE_XZ(link)` straight after an attach. A second pass whose reads differ can attach differently from the first, so no fixed number of passes is right. A second run also doubles the time every scrub takes, which project 1 rejected for aim.

This answers `AreaUnload`, which project 4 left as a known limit. It attaches, then polls until the passenger's `UNIT_XZ` equals the link's `PIECE_XZ`. That holds one frame later, because the passenger moves after the tick. After `drop-unit` it moves the beam and checks that the passenger was left behind, which it was, because a dropped passenger stays put.

## 1. Events on the timeline

`Timeline` in `crates/coilbox-unitpose/src/lib.rs` and `ScriptTimeline` in `src/lego/scriptPlayback.ts` gain one list, in frame order:

```ts
events: ScriptOutput[];

type ScriptOutput =
  | { frame: number; kind: "attach"; unit: number; piece: string | null } // null is the void
  | { frame: number; kind: "drop"; unit: number }
  | { frame: number; kind: "sfx"; piece: string; sfx: number }
  | { frame: number; kind: "explode"; piece: string; flags: number }
  | { frame: number; kind: "sound"; name: string | null };
```

Pieces are named, because the viewport and project 3 look pieces up by name and a name means the same in both runtimes. `sfx` is the raw number. From 1024 upwards it is an index into the unit's own generator list, from 2048 it fires a weapon and from 4096 it detonates one (`CobDefines.h:9-20`, `UnitScript.cpp:736-750`). The editor has no unit definition to name a generator from, so turning the number into something to draw is project 3's.

A sound's `name` is the COB sound table entry, or the Lua call's first argument. It is null for a compiled script with no sound table, which is a TA script rather than TA:K, and the run notes the index once.

The notes change:

- "Effects are not drawn", "Explode throws no debris" and "Sound is not played" become one note, "Effects are marked on the scrubber, not drawn", given only when the run recorded one.
- "Attaching a unit does nothing" goes.
- A piece index that names no piece is noted and records nothing, as the engine's `ShowUnitScriptError` does.
- `attach-unit` or `drop-unit` on any id but the stand-in's is recorded and changes nothing, which is the engine's `GetUnit(u) == nullptr` return (`UnitScript.cpp:838-841,852-855`). On the unit's own id it is also noted, because the engine asserts against a unit carrying itself (`Unit.cpp:2638`).

`ChangeHeading` stays a stub. It is not in this project's list.

## 2. The passenger, shared by both runtimes

A new type in `crates/coilbox-unitpose`, beside `Model`, so both runtimes carry the stand-in the same way:

```rust
pub enum Passenger {
    Loose,
    Riding { piece: usize },
    Void,
    Released { at: [f64; 3] },
}
```

- `attach(piece)` sets `Riding` or `Void`. It does not move the stand-in.
- `drop()` sets `Released` at the stand-in's current position.
- `after_frame(&Model)` runs once per frame after the threads, matching `UpdatePostAnimation`. `Riding` updates the stand-in's position to `model.piece_position(piece)`. `Void` puts it at the origin.
- The position is kept on the passenger, not on `World`. Once the passenger has left `Loose`, a later event's snapshot still supplies the stand-in's radius and height, but not its position.

`unitvalue::world` takes the passenger's position in place of `standIn.pos` whenever the passenger is not `Loose`. `UNIT_XZ` of a riding stand-in and `PIECE_XZ` of its piece come from the same `piece_position` and the same `pack_xz`, so they compare equal, as they do in the engine. Lua's `Spring.GetUnitPosition` answers from the same place.

`piece_position` does not compose rotations (`lib.rs:307-312`). A stand-in riding a piece whose parent has turned is answered where the piece would be if the parent had not turned. That limit is already on `PIECE_XZ`, and this project inherits it rather than widening it. What is drawn does not share it (section 4).

### The compiled runtime

`EMIT_SFX`, `EXPLODE`, `PLAY_SOUND`, `ATTACH_UNIT` and `DROP_UNIT` decode as in the table and push an event. `Run::step` calls `after_frame` after `run_threads`. `cob::decode` reads the TA:K sound table when the header has one.

### The Lua runtime

`EmitSfx`, `AttachUnit`, `DropUnit` and `Explode` leave `install_stubs` and record, taking the Lua argument order and 1-based pieces. `Spring.PlaySoundFile` records its name and still answers as it does now. The scheduler calls `after_frame` after the frame's coroutines.

## 3. The engine's own attach and detach

`ScriptEvent` gains an optional action the engine takes on the stand-in, rather than a call-in it fires:

```ts
engine?: "attach" | "detach";
```

`callin` becomes optional in `crates/coilbox-unitpose/src/lib.rs` and in the TypeScript mirror, and is absent on these events.

- `"attach"` calls `QueryTransport(standInId)` inline, as the engine's `Call` does, and attaches the stand-in to the piece it answers. A compiled `QueryTransport` gets the stand-in's height in 65536ths, as `CobInstance.cpp:368-370` passes it, and answers through its first argument. A missing `QueryTransport` answers as the engine's does, -1 in Lua and script piece 2 in COB, and the run notes it either way.
- `"detach"` drops the stand-in, as `DetachUnitFromAir` does.

The air scenarios move to these events, and `StandInTrack.attach` with `from: "QueryTransport"` goes:

- `transport-load` gains `{ frame: at(4), engine: "attach" }` straight after its `BeginTransport`, and `{ frame: at(11), engine: "detach" }` where its attachment ends today.
- `transport-unload` gains `{ frame: 0, engine: "attach" }`, and `{ frame: at(5), engine: "detach" }` straight after its `TransportDrop`, which is the order `MobileCAI.cpp:2090-2091` uses when landing.

This gives the real per-call answer where the probe gave a fixed one, which project 1 named as project 2's. It also gives compiled units an attach piece for the first time. `QueryBuildInfo` keeps the probe and the `follow: false` attach, because a factory's build spot is a spawn point and not an attachment (`Factory.cpp:95-101,178`). `StandInAttach.from` narrows to `"QueryBuildInfo"`.

## 4. Drawing it

A pure function in `src/lego/standIn.ts`, `passengerAt(events, frame)`, folds the attach and drop events up to a frame into one of: loose, riding a named piece, in the void, or released on a frame. `placeStandIn` in `standInPlayback.ts` uses it ahead of the track:

- Riding: the stand-in takes the animated three.js group's world position, as the `follow` branch does now, with heading 0. On the attach's own frame it is already on the piece, because `UpdateTransportees` runs within that frame.
- Void: hidden.
- Released on frame N: at the piece's world position on frame N - 1, which is the last place `UpdateTransportees` put it. That position is worked out once per timeline, by posing the scene at N - 1 and reading the group, and it is cached per drop so that scrubbing stays a pure function of the frame.
- Loose, before any attach: the track, exactly as now.

This draws from the three.js hierarchy, which composes rotations. It does not draw from the runtime's `piece_position`. So a stand-in on a turned boom is drawn in the right place even where a script reading it is told the approximate one.

After a drop, the track takes over again, with the release point as an implicit key at the drop's frame. Keys after it interpolate from there. `StandInKey.fromAttachPiece` is renamed `fromRelease` and measures from the latest release point, which is what `transport-unload` already means by it. A dropped stand-in holds where it was let go and does not fall. Falling belongs to the move type, which is out of scope.

Keys between an attach and the next drop are ignored, because the runtime owns the stand-in then.

There is one known gap. The track's return leg, which the preview adds so the loop does not jump, can walk a released stand-in back while the runtime still answers the release point. No call-in fires during a return leg. It is recorded in the code, not designed for.

## 5. Marks on the scrubber

Under the scrubber in `AnimationPanel.tsx:620-655`, one mark for each frame that has events of any kind, attach and drop included. Frames that fall on the same pixel merge into one mark. Each mark is a button that seeks to its frame, named for what happened there, with the registry `tooltip` listing the frame's events in words:

- `EmitSfx 1025 from flare (CEG 1)`, with the ranges from `CobDefines.h` named.
- `Explode arm1 (SHATTER | BITMAP1)`, with flag names from `CobDefines.h`.
- `Sound krogtaunt`.
- `Attach stand-in to link`, `Attach stand-in to the void`, `Drop stand-in`.

The row renders only when the timeline has events, so a unit that emits nothing looks as it does today.

## 6. The ship and hover scenario

`transport-pickup` gains a `TransportDrop(STAND_IN_UNIT_ID, x, y, z)` at the parked position. The Hulk then plays its whole cycle: it reaches out, lifts the stand-in to the pad, hides it in the void, reaches out again and puts it down where it found it. The drop's frame is picked by running the Hulk until its pickup has finished, not guessed. Keys after the drop use `fromRelease` so the return leg starts from where the stand-in was put down.

## Not in scope

- Project 3, the particle renderer. This project records effects and marks them, and draws none.
- The unit definition. `holdSteady`, generator names and `IsTransportUnit` all need it, and the editor has none. The preview treats every unit as a transport, as a script that attaches is asking to be one.
- Falling after a drop, terrain, pathing, collision and line of sight.
- Composing rotations in `piece_position`, which would correct `PIECE_XZ` and a riding stand-in's reads together. It needs rest rotations the runtimes do not carry.
- Playing sounds.

## Testing

1. `Passenger` unit tests in `coilbox-unitpose`: attach does not move the stand-in until `after_frame`, `Void` is the origin, a drop keeps the last position, and a later snapshot does not move an attached stand-in.
2. Each runtime runs a small script that makes each of the five calls and asserts the same `events` from both. This extends the COB against Lua parity test in `bos2lua_parity.rs`.
3. A test shaped like `AreaUnload` in each runtime: attach, poll `UNIT_XZ` against `PIECE_XZ` every 100 ms, and show that it ends on the second poll. Then drop, move the piece, and show the two differ.
4. The compiled runtime's `engine: "attach"` runs `QueryTransport` inline and attaches to its answer. The missing call-in case answers piece 2 in COB and the void in Lua.
5. `passengerAt` gets TypeScript tests for each state, several attach and drop cycles, and the attach's own frame.
6. `ModelViewport.dom.test.tsx` covers a riding stand-in, a hidden one and a released one. `AnimationPanel.dom.test.tsx` covers marks appearing, merging and seeking.
7. End to end on screen, through the Tauri MCP on a seeded portable instance: the Hulk under `transport-pickup`, once compiled and once converted to Lua. Pass means the stand-in rides `link` while the boom swings, disappears on the pad, reappears on the boom and is set down, with no attach or effect note in the panel.

## Delivery

Three PRs. A lands first, and B and C each need only A:

- A. The events and the passenger in both runtimes, sections 1 and 2. M.
- B. The engine's attach and detach and the scenario changes, sections 3 and 6. S.
- C. Drawing and the scrubber marks, sections 4 and 5. M.

L in total, or M if the Hulk's cycle fits the preview's 15 seconds without retiming the scenario.
