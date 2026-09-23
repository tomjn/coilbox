# A world for the stand-in to answer from

Project 4 of the stand-in work. A unit script that asks where another unit is gets the stand-in's real position rather than a zero and a note. The evidence behind it is `docs/reports/2026-09-22-world-mock-findings.md`, and this spec corrects that report in two places, marked below.

## What is there today

Both runtimes answer a script's unit value reads in the same order: arithmetic, removed shared values, `GAME_FRAME`, the `values` map the panel seeds, `unitvalue::known`, and then zero with "This script asks the world for value {id}, and the preview has no world to ask." (`crates/tauri-plugin-coilbox-anim/src/cobrun.rs:1090-1137`, `crates/coilbox-springlua/src/unitscript.rs:2117-2150`).

The `values` map is the only way in from outside, and it cannot carry a world. It is keyed by id alone, so `UNIT_XZ(passenger)` and `UNIT_XZ(self)` would share one answer. It is also fixed for the whole run, so a scenario that picks up in one place and drops in another cannot be answered.

Lua scripts do not ask through `GetUnitValue` at all. They call `Spring.GetUnitPosition(passengerID)`, which the Lua runtime answers with the origin for any id (`unitscript.rs:1402`), and `Spring.GetUnitHeight`, which it does not define, so SplinterFaction's `lozdragonfly_lus.lua` `BeginTransport` stops on its first line.

The stand-in's own id collides with the unit's. `STAND_IN_UNIT_ID` in `src/lego/scriptPlayback.ts:213` and `UNIT_ID` in `crates/coilbox-unitpose/src/unitvalue.rs:106` are both 1, so a script asking about its passenger is asking about itself.

## What the engine does

**The passenger is still when a pickup reads it.** `TransportPickup(unit)` fires once, on the first slow update where the passenger is inside `loadingRadius`, and the transport stops itself (`rts/Sim/Units/CommandAI/MobileCAI.cpp:1414-1463`). After that the command only polls `IsBusy()`. A passenger that asked to be loaded stops once inside `cancelDistance` (`MobileCAI.cpp:430-465`). An idle passenger is already still.

**Scripts read the passenger once, at the top of the call-in.** A survey of 10 local games (Balanced Annihilation, SplinterFaction, THIS, SpringMCLegacy, flove, Metal Factions, Expand and Exterminate, Spring 1944, plus `empty_mod` and a second SplinterFaction archive) found every transport call-in reading the passenger's position as its first statement, before any sleep. The BA boom transports re-read `UNIT_HEIGHT` after their waits, which is a constant. Two `.sd7` games, `basically_ota` and `xta`, were not scanned because no `7z` is installed.

**A carried unit's position is its attach piece's.** The Hulk's `TransportDrop` opens with the same `BoomCalc(get UNIT_XZ(unitid), ...)` as its pickup, so it reads where the passenger sits on the pad, not where it is going.

**The engine's answers** (`rts/Sim/Units/Scripts/UnitScript.cpp:1060-1105`):

- `UNIT_XZ`, `UNIT_Y`, `UNIT_HEIGHT` answer for the script's own unit when `p1 <= 0`, for unit `p1` otherwise, and 0 for an id that matches no unit.
- `UNIT_XZ` packs world x and z in elmos as `(x << 16) + (z & 0xffff)` (`CobInstance.h:10`).
- `UNIT_Y` is `pos.y * 65536`.
- `UNIT_HEIGHT` is the unit's radius times 65536, not its height. The findings report says height, which is wrong.
- `GROUND_HEIGHT` is the height above water at a packed position, times 65536.
- `XZ_ATAN` is `RAD2TAANG * atan2(x, z) + 32768 - heading` and `XZ_HYPOT` is `hypot(x, z) * 65536`, both on a packed pair unpacked as signed 16-bit halves (`CobInstance.h:11-12`). Neither asks about the world. The report and the comment on `unitvalue::arithmetic` both call them world questions, which is wrong: the only outside input is the unit's own heading, which is 0 in the editor.

## Decision: one snapshot per call-in, not a per-frame table

The stand-in is parked for the length of any call-in that reads it, and each call-in carries the stand-in's position on its own frame. A per-frame table would hand the runtime the same number on every frame a pickup reads, because the engine's passenger is not moving then.

The one script found that reads a moving passenger over time is BA's `intruder.bos` `AreaUnload`, which polls `UNIT_XZ(passenger)` against `PIECE_XZ(link)` every `sleep 100` after `drop-unit` to see whether it has left. That is a question about attachment state, which only a runtime that tracks `attach-unit` can answer, so it belongs to project 2. No scenario drives `AreaUnload`, which BA calls from Lua. Under this design its first loop spins until the preview ends. That is recorded here as a known limit and not designed for.

## Scope: three pieces, each its own PR

None of the three needs another to land first. The Hulk's boom is right end to end only once all three and project 2 have landed.

### A. Answers that need no world

- The engine reads the piece argument of `PIECE_XZ` (7) and `PIECE_Y` (8) as a 0-based script piece index, `SafeGetPiece(p1)` at `rts/Sim/Units/Scripts/UnitScript.h:80-85`. It passes a Lua script's argument through unchanged (`LuaUnitScript.cpp:1262-1286`), unlike every other Lua piece call, which subtracts 1 (`LuaUnitScript.cpp:87`). bos2lua already allows for this and emits `GetUnitValue(COB.PIECE_XZ, turret - 1)`, checked by a probe conversion.
- The compiled runtime is off by one. It looks up `p1 - 1` (`cobrun.rs:1112`), so it answers the piece before the one asked for. A probe that asked for `PIECE_Y` of piece 1, resting at y=7, got 0, the base's height. It is fixed to read `p1` itself, with a test. The Hulk's `BoomCalc` measures from its turret with this read, so this matters for the Hulk as much as the world does.
- The Lua runtime answers `PIECE_XZ` and `PIECE_Y` the same way, reading the raw argument as a 0-based index into `sim.model.piece_position`. It must not go through the `piece_position` helper that `Spring.GetUnitPiecePosition` uses, which subtracts 1 for Lua's 1-based numbers. Today every script converted from BOS to Lua loses both answers.
- `XZ_ATAN` (12) and `XZ_HYPOT` (13) move into `unitvalue::arithmetic` with the engine lines above and a heading of 0, so both runtimes answer them. The doc comment on `arithmetic` that says they are world questions is corrected.
- Tests follow the existing `arithmetic` tests. Each runtime gets one test that a script reading 7, 8, 12 and 13 gets the same numbers from both.

Size S.

### B. A ship and hover pickup scenario

A new scenario, `transport-pickup`, labelled "Loading a ship or hover transport". It fires `TransportPickup(STAND_IN_UNIT_ID)` after `CREATED`, which is the engine's arm for every transport that is not `CHoverAirMoveType` (`MobileCAI.cpp:1459-1463`). This reaches five of BA's nine transports: `armtship`, `cortship`, `armthovr`, `corthovr` and `intruder`.

The stand-in approaches and parks in front of the unit before the call-in fires, and stays parked. There is no attach, because the attach piece comes from the script's own `attach-unit`, which is project 2. It walks back to its start over the end of the preview, like `transport-load`, so the loop does not jump.

No unload scenario is needed. `transport-unload` already fires `TransportDrop`, which every kind of transport receives.

The parked position has to be inside the Hulk's reach guard (`Static_Var_1 < 126` in `scripts/armtship.bos` `BoomCalc`). It is picked by running the Hulk against it once project 4 lands, not guessed. Until then the scenario's value is that the boom call-in fires at all.

Size S.

### C. Project 4: the world

**C1. A distinct stand-in id.** `STAND_IN_UNIT_ID` becomes 2, so it can never equal `UNIT_ID`. The scenarios that pass it (`transport-load`, `transport-unload`, B's `transport-pickup`) pick this up through the constant. Whether a script reading `MY_ID` or `unitID` could now be told apart from its passenger is covered by a test.

**C2. The snapshot on an event.** `ScriptEvent` in `crates/coilbox-unitpose/src/lib.rs` and its TypeScript mirror in `src/lego/scriptPlayback.ts` gain an optional `world`:

```ts
world?: {
  standIn: { id: number; pos: [number, number, number] | null; radius: number; height: number } | null;
  self: { radius: number; height: number };
};
```

`standIn` is null when the scenario has no track, so there is no such unit and a script asking about any other id is told 0, as the engine tells it. When the scenario has a track but places nothing on the event's frame, `standIn` keeps its id and `pos` is null, so the runtime knows the script asked about the stand-in and can say it was not there.

`pos` is in elmos in unit space, which is world space because the unit stands at the origin facing +z. Piece positions are in the same frame. The engine flips model x on load, and `GetObjectSpacePos` at heading 0 has `rightdir` of `(-1,0,0)` (`rts/Sim/Objects/SolidObject.h:233`). The two cancel, so a script subtracting a piece's `PIECE_XZ` from the stand-in's `UNIT_XZ` gets the offset the viewport draws. `self` is the edited unit's own radius and height as the exported `.s3o` header would carry them, which is what `unit->radius` is in the engine unless a unit definition overrides it.

Each runtime keeps the last `world` it was handed and answers from it until the next one arrives. It applies the snapshot before firing the call-in on the same event. A thread started earlier that reads after this event sees the new snapshot, which matches a parked passenger.

**C3. The resolver.** A pure function beside `resolveScenario` in `src/lego/aimResolver.ts` attaches a `world` to every event in a scenario:

- When the track places the stand-in on the event's frame, `standIn` is its base position from `standInAt(track, frame, radius)`. Its radius is `standInRadius(bounds)` and its height is the `HEIGHT * radius` the shape in `standIn.ts` is built to.
- When the stand-in is attached on that frame, `pos` is the attach piece's rest position, which is the same compromise `aimResolver` makes for aim and for the same reason.
- When the track places no stand-in on that frame, `standIn` keeps its id and `pos` is null, as C2 describes.
- A scenario with no track still gets `self`, so the unit can answer questions about itself.

`AnimationPanel.start()` already runs `resolveScenario` before every run (`src/lego/pages/components/AnimationPanel.tsx:389-433`), so the new resolver runs in the same place and needs no new wiring. The "Call a function" mode passes `self` and no stand-in.

**C4. The answers, written once.** A new function in `crates/coilbox-unitpose/src/unitvalue.rs`, `world(id, p1, &World) -> Option<i32>`, is called by both runtimes after `known` and before the "no world" note:

| Question | `p1 <= 0` or `UNIT_ID` | The stand-in's id | Any other id |
|---|---|---|---|
| `UNIT_XZ` (9) | 0, the unit is at the origin | packed `pos.x`, `pos.z` | 0 |
| `UNIT_Y` (10) | 0 | `pos.y * 65536` | 0 |
| `UNIT_HEIGHT` (11) | `self.radius * 65536` | `standIn.radius * 65536` | 0 |
| `GROUND_HEIGHT` (16) | 0 at every position, the plane is flat at `y = 0` | | |

"Any other id" answers 0 without a note, because that is the engine's answer for a unit that does not exist and is therefore not a gap in the preview. When a script asks where the stand-in is on an event whose `standIn.pos` is null, the answer is 0 with a note saying the scenario puts no stand-in in the scene then.

The Lua runtime also answers from the same `World`:

- `Spring.GetUnitPosition(id)` gives the stand-in's `pos` for its id. It keeps today's origin for the unit's own id and gives nil for any other id, which is the engine's answer for an invalid unit.
- `Spring.GetUnitHeight(id)` and `Spring.GetUnitRadius(id)` are added (`rts/Lua/LuaSyncedRead.cpp:238-239`). They answer `self` or `standIn` by id, and nil otherwise.

When an event carries no `world` at all, which is every caller outside the panel (the bos2lua sweep, the parity test, the examples), the questions that need no facts are still answered: `GROUND_HEIGHT` and the unit's own `UNIT_XZ` and `UNIT_Y`. Everything else keeps today's "no world" note.

**C6. The passenger's height for a compiled `BeginTransport`.** COB's `BeginTransport` takes the passenger's model height in 65536ths (`CobInstance.cpp:355-360`), and `cob_args` today converts the scenario's single argument, which is the stand-in's unit id, as if it were that height. When the event carries a stand-in, `cob_args` uses `standIn.height` instead. Without one it keeps today's conversion, so the existing test still describes it.

**C5. The panel.** Ids 9, 10, 11 and 16 are no longer offered as controls. A control keyed by id alone cannot tell "where am I" from "where is my passenger", and the value is a packed integer nobody can type. They are added to `excluded_from_asked` in `unitvalue.rs`, beside `PIECE_XZ` and `PIECE_Y`, which are excluded for the same reason.

Size M.

## Not in scope

- Anything that reads a moving unit between call-ins, including `intruder.bos` `AreaUnload`. Project 2.
- `TARGET_ID` (83), `LAST_ATTACKER_ID` (84) and `TRANSPORT_ID` (94). They answer ids, not positions, and with one other object in the scene no script found needs them.
- Terrain, heightmaps, water, pathing, collision and line of sight. The plane is flat at `y = 0`.
- Loading radius. The preview does not read a unit definition's `loadingRadius`. B's parked position is set by what the script accepts.

## Testing

1. `unitvalue::world` gets a unit test for every cell of the C4 table, plus a test that the stand-in's id and `UNIT_ID` differ.
2. Each runtime gets one test that runs a small script reading 9, 10, 11 and 16 for itself, for the stand-in and for an unknown id, and asserts the same numbers from both. Lua's test also covers `GetUnitPosition`, `GetUnitHeight` and `GetUnitRadius`.
3. One test in the compiled runtime shows that a later event's snapshot replaces an earlier one, and that it is applied even when the script has no such call-in.
4. The resolver gets TypeScript tests for a parked stand-in, an attached stand-in, a frame with no stand-in, and a scenario with no track.
5. End to end, run on screen through the Tauri MCP on a seeded portable instance: BA's Hulk (`armtship` in `balanced_annihilation-v15.9.8.sdz`) through B's scenario, run once as compiled and once converted to Lua. Pass means none of the six "no world" notes the findings report lists, the reach guard passes, and `arm2` to `arm7` turn towards the stand-in rather than to a fixed place. This needs A and B as well as C.
