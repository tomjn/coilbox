# Mission runtime

The Lua that plays a coilbox scenario inside the engine. It is coilbox-authored and game-agnostic: a game vendors a copy, and coilbox installs and updates it (see the [scenario editor design](../../docs/superpowers/specs/2026-07-31-scenario-editor-design.md)).

## Layout

- `luarules/gadgets/coilbox_mission_runtime.lua`, the gadget. It gates on the modoption, loads the compiled mission, and hands it to the rest of the runtime.
- `luarules/mission_runtime/`, the runtime's own modules. `coilbox_start.lua` turns a compiled mission into the team setup and the list of units to place. It is pure, with no engine calls and no state, so the gadget reads the engine, asks it what the mission wants, and carries the answer out.
- `missions/runtime.lua`, the version marker and capability table. Coilbox reads it out of an installed game to decide what the editor may offer.
- `tests/`, checks that run outside the engine with `luajit`. Not part of what a game vendors.

A game vendoring the runtime takes `luarules/`, `luaui/` and `missions/`, and nothing else.

## How a mission starts

Coilbox writes `coilbox_mission = <scenario id>` into the start script and the compiled scenario to `missions/<id>/mission.lua` in the game. Without that modoption the gadget chunk returns `false`, so the gadget handler drops it before it reads a file or defines a callin: a normal game is unaffected.

With it, the gadget loads `missions/runtime.lua` and the compiled mission, refuses a mission that needs a newer runtime than this one, and publishes both on `GG.CoilboxMission`:

```lua
GG.CoilboxMission = {
  id      = <scenario id>,
  mission = <compiled scenario>,
  runtime = <runtime.lua>,
  teams   = <per-participant setup, with the engine team number resolved>,
  actors  = <actor records by scenario id>,
  units   = <scenario actor id -> unitID, for the actors currently alive>,
}
```

`mission` is the compiled scenario exactly as coilbox emitted it, so a misbehaving mission can be diagnosed by reading `missions/<id>/mission.lua` beside the scenario JSON.

## The start

The runtime takes over the start rather than sharing it, so a mission plays the same wherever it was launched from:

- `GameStart`: every actor is created at the ground height under its position, and each team's `startUnits` are placed in a square grid on that team's engine start position. Actors are addressable afterwards through `GG.CoilboxMission.units`.
- Game frame 1: every mission team's bank is set to its `resources`, defaulting to nothing. This is how the normal starting resources are suppressed. `income` is then paid in every frame, spread over the second it is quoted per.
- A team whose scenario entry sets `noCommander` has anything the game spawns for it removed, from load until the end of game frame 1. Only creations with no builder are touched, so nothing anyone has begun building is affected.

Suppression removes rather than prevents because the engine offers no veto: `AllowUnitCreation` is consulted for builders and factories only, never for `Spring.CreateUnit`, which is what a game's start gadget uses.

The gadget sits at `layer = 1000`, behind a game's own gadgets. `gadgetHandler` runs low layers first, and the runtime is overriding the game rather than pre-empting it, so it wants the last word on starting resources and on damage modifiers.

## Conventions

- Everything vendored is named `coilbox_*` so a game maintainer can see at a glance which files came from here.
- The gadget file is loaded twice, once synced and once unsynced. Put synced-only work behind `gadgetHandler:IsSyncedCode()`, and keep anything that runs in both deterministic. The two halves have separate `GG` tables, so the synced half tells the unsynced half what it did with `SendToUnsynced`.
- Files under `missions/` are data. They are read with an empty environment, so they may not call the engine or touch globals.
- Files under `luarules/mission_runtime/` are code. They are read with the gadget's own environment, so they may call the engine, and a module that does not need to should not.
- Adding a condition or action type means adding it to `missions/runtime.lua` and bumping `version` in the same change. A type that has shipped is never removed: a scenario asking for it would then silently do nothing.

## Tests

```sh
luajit lua/mission-runtime/tests/gate_test.lua
luajit lua/mission-runtime/tests/plan_test.lua
luajit lua/mission-runtime/tests/start_test.lua
```

`tests/support.lua` holds the shared scaffolding: a stub of the slice of the engine the runtime touches, which records what the runtime asked for and plays back the callins it reacts to.
