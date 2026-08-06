# Scenario editor and mission runtime

2026-07-31. Approved design for the scenario/mission milestone.

Coilbox's campaign builder stops at the engine boundary: a mission is a skirmish setup plus briefing media, and nothing controls what happens in-game. This milestone adds scenarios (in-engine content: spawns, triggers, zones, objectives, dialogue), a runtime that games vendor to play them, and an editor to author them. Capability roughly on par with original Total Annihilation missions.

## Vocabulary

- Scenario: the in-engine content. Skirmish setup (map, game, participants), spawns, triggers, zones, objectives, dialogue. A standalone coilbox document, playable bare from a Scenarios page.
- Mission: wraps a scenario and adds presentation. Briefing, panorama, side graphic, voiceover, cutscene. The scenario is snapshotted at attach time, exactly as missions snapshot presets today.
- Campaign: ordered missions, unchanged.

A preset-only mission (today's kind) keeps working as a scenario-less mission. No migration.

## Decisions

- Single player only this milestone. Co-op is a later milestone. The compile step is deterministic, so co-op stays a distribution problem, not a redesign.
- The runtime is generic coilbox-authored Lua, vendored by games. A game that has not adopted it cannot play scenarios (except via the test mutator, which is test-only and never a distribution route).
- The scenario format is pure data. An optional hand-written `script.lua` beside the compiled mission is the escape hatch. The editor shows it exists but never edits it. Every use of it is a bug report against the format.
- Scenarios are standalone documents referenced by campaign missions, like presets.
- The runtime Lua lives in this repo and is verified headless.
- The editor is a 3D scene in coilbox reusing the existing map preview and model readers.
- Verification target: Splinter Faction as an `.sdd` working copy.

## The three artefacts

1. The runtime: Lua in this repo under `lua/mission-runtime/`, shipped as a Tauri resource. A synced gadget that interprets a scenario, an unsynced half plus a LuaUI widget for objectives, dialogue and debrief, and a version number with a capability table.
2. The install path: in Content > Games, for a loose `.sdd` game, install or update the runtime. Coilbox writes the files in, reads back the version marker, and shows what the installed runtime supports. A packaged `.sd7`/`.sdz` is read-only, so coilbox offers the test mutator instead and says why.
3. The test mutator: a generated `coilbox-mission-test.sdd` in `games/`, depending on the base game, carrying the runtime and the one scenario under test. Same pattern and folder-name guards as lego's scratch game, so removing one folder undoes it.

## How the game knows it is a mission

A modoption, `coilbox_mission = <scenario id>`, set by coilbox in the start script it already generates. Without it the gadget returns false from `GetInfo` and costs a normal game nothing. With it, the gadget `VFS.Include`s `missions/<id>/mission.lua` and takes over: it suppresses normal spawn and starting resources, spawns from the scenario, and owns game over.

## The compile step doubles as the validator

The scenario document is coilbox JSON in app data (`scenarios/` beside `campaigns/`). Play or test compiles it to `missions/<id>/mission.lua`, a pure Lua table literal, so the runtime needs one `VFS.Include` and no parser.

`coilbox-springlua` already evaluates loose Spring Lua against a rooted VFS, which is exactly what an `.sdd` is. After writing, coilbox reads the file back and asserts every id reference resolves before the engine sees it. The validator is the same code path the engine will take, not a second implementation that can disagree with it.

## Version negotiation

The runtime ships `missions/runtime.lua` declaring its version and the condition and action types it implements. Coilbox reads it with springlua. The editor offers only those types and greys the rest with the version that would add them. A scenario records the minimum runtime version it needs, computed from the features it uses. This stops the editor emitting triggers a vendored older runtime would silently ignore, which is the worst available failure mode.

## Game extensions

A game may ship `missions/extensions.lua` declaring extra condition and action types with display metadata. The runtime dispatches unknown types to the game's handler. The editor reads the same file and adds them to the palette. This is how SF's RP abilities, weather and faction chooser become editable without coilbox knowing what RP is. Everything engine-level (spawns, orders, zones, LOS, restrictions, game over, camera, markers, rules params) stays in the generic runtime.

## The adoption contract

A game vendoring the runtime:

1. Includes `luarules/`, `luaui/` and `missions/` from the runtime, kept in step with a coilbox version.
2. Adds one guard to whatever calls `Spring.GameOver()`, so the runtime decides when a mission ends. (The engine also ends a game itself when an allyteam has no units. Missions where the player can legitimately hit zero units are handled by the runtime's anchor-unit technique.)
3. Optionally ships `missions/extensions.lua` for its own systems.

## The scenario document

Validated in TypeScript like `parseCampaignJson`. Shape, abbreviated:

```
Scenario {
  schemaVersion, id, name, description
  runtimeVersion          // minimum runtime this scenario needs (computed from features used)
  setup                   // SkirmishDraft-compatible: gameName, mapName, participants, modOptionValues
  teams: { startUnits?, resources?, income?, noCommander? }   // per participant
  zones: [{ id, name, shape: box|circle, coords }]
  actors: [{ id, unitDef, team, pos, facing, state: { hp?, invulnerable?, unselectable?, name? } }]
  groups: [{ id, team, units: [{ def, count }], orders: [patrol|move|guard...], dormant }]
  prefabs: [{ id, team, origin, buildings: [{ id?, def, offset, facing, queue?, repeat? }] }]
  restrictions: { buildable?: { mode: allow|deny, units }, commands?: string[] }
  vars: { name: initial }
  triggers: [{ id, enabled, repeat, conditions: { op, [...] }, actions: [...] }]
  objectives: [{ id, kind: primary|secondary, text, hidden }]
  dialogue: [{ id, speaker, portrait?, text, audio? }]        // in-engine radio messages, trigger-fired
  script?: true           // a companion script.lua exists beside the compiled mission
}
```

Dialogue lives on the scenario, not the mission, because triggers fire it in-engine. The mission keeps only out-of-engine presentation. Every cross-reference is a string id. The compile step resolves them all or refuses.

Launch set of types (the runtime's initial capability table):

- Conditions: `units_in_zone`, `unit_count`, `unit_dead`, `unit_health_below`, `unit_built`, `unit_captured`, `time_elapsed`, `var`, `zone_held_for`.
- Actions: `spawn_group`, `wake_group`, `give_orders`, `gift_units`, `set_var`, `add_var`, `enable_trigger`, `disable_trigger`, `complete_objective`, `fail_objective`, `dialogue`, `play_sound`, `reveal_area`, `unlock_unit`, `camera_pan`, `map_marker`, `victory`, `defeat`.

Triggers enabling and disabling triggers turns the flat list into a state machine. Vars with arithmetic cover counters and branch flags. Evaluation splits between engine events (unit created/finished/destroyed/captured) and a slow polled tick for aggregates (zone occupancy, counts, timers), with each trigger declaring which events it cares about.

## Win/loss needs no new channel

The runtime ends a mission by calling `Spring.GameOver` with the winning allyteams. That lands in the replay, and coilbox's existing demotool-based detection reads it. Scenario missions get accurate campaign results through the code path campaigns use today, and the manual Victory/Defeat fallback stays.

## The editor

A Scenario Builder page (advanced mode, beside Campaign Builder). One 3D scene, one mode strip:

- Scene: terrain from the existing heightmap and textured map preview, placed units drawn with their real models through the `.3do`/`.s3o` readers, zones as ground overlays, patrol paths as lines. All rendering pieces exist. The new work is composition and picking.
- Modes: zones, actors, groups, prefabs. Click to place, drag to move, unit picker reusing the game unit browser from lego.
- Panels: triggers, objectives, dialogue, restrictions, vars as list-plus-form panels. Trigger dropdowns are populated from the id registries, so a zone is picked by name and cannot be typoed.
- Capability gating: types the installed runtime does not support are greyed with the version that adds them. Game extension types appear in the palette with their metadata.
- Test: one button compiles to the test mutator and launches, the lego Test-in-game pattern.

Mission presentation gains a unit-preview slot: `panoramaUnit` / `sideGraphicUnit` on `CampaignMission`, a spinning 3D unit render as an alternative to the existing map preview slots, so a briefing screen can show the mission's boss unit.

## Milestone shape

One milestone, ordered so every phase is provable before the next builds on it:

1. Format and compile: scenario model + parser, Lua-literal emitter, springlua read-back validator, scenario CRUD plugin commands. ~6 issues.
2. Runtime: synced gadget (setup, spawn, suppression), trigger engine, zones and vars, objectives and game over, LuaUI objectives panel, dialogue panel, debrief, and a headless harness that loads a fixture mission and asserts triggers fire. ~9 issues.
3. Install and launch: runtime install/update into an `.sdd` with version read-back, capability table read, test mutator, modoption + missions-folder write at launch. ~5 issues.
4. Editor: scene, placement modes, panels, capability gating, test button. ~10 issues.
5. Integration: Scenarios list page and bare play, scenario attach in the mission editor, export/import carrying scenarios, docs. ~5 issues.
6. SF proof: install the runtime into the SF working copy, author one real mission end to end with Scary le poo's feature list as the checklist, fix what hurts. ~3 issues.
7. Presentation extras: unit 3D preview slot, extension palette polish. ~2 issues.

About 40 issues. Explicitly out of scope this milestone: co-op, difficulty scaling, music states, tutorial affordances, in-game placement mode. All are future format additions the capability table absorbs.
