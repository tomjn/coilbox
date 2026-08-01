# Mission runtime

The Lua that plays a coilbox scenario inside the engine. It is coilbox-authored and game-agnostic: a game vendors a copy, and coilbox installs and updates it (see the [scenario editor design](../../docs/superpowers/specs/2026-07-31-scenario-editor-design.md)).

## Layout

- `luarules/gadgets/coilbox_mission_runtime.lua`, the gadget. It gates on the modoption, loads the compiled mission, and hands it to the rest of the runtime.
- `luarules/mission_runtime/`, the runtime's own modules. `coilbox_start.lua` turns a compiled mission into the team setup and the list of units to place. `coilbox_triggers.lua` is the trigger engine. `coilbox_unit_conditions.lua` registers the conditions that read units, `coilbox_zones.lua` the conditions that read zones, `coilbox_vars.lua` the mission's variables, `coilbox_groups.lua` its groups, `coilbox_objectives.lua` its objectives, `coilbox_dialogue.lua` what it says, `coilbox_view.lua` where it points the player, `coilbox_reveal.lua` what it shows them, and `coilbox_gameover.lua` how it ends. The first two are pure, with no engine calls and no state, so the gadget reads the engine, asks them what the mission wants, and carries the answer out. `coilbox_dialogue.lua` and `coilbox_view.lua` are pure as well, because saying a line, moving a camera and dropping a marker are all deciding that the mission asked and nothing more.
- `luaui/widgets/coilbox_mission_ui.lua`, the widget: the objectives panel, the dialogue panel, the debrief and the name over a named actor. `luaui/mission_ui/coilbox_panel_model.lua` is everything it decides before it draws, pure and tested outside the engine.
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
  triggers = <the trigger engine, synced half only>,
  zones   = <the scenario's zones, corners the right way round, synced half only>,
  vars    = <the mission's variables, synced half only>,
  groups  = <the scenario's groups, synced half only>,
  objectives = <the mission's objectives, synced half only>,
  dialogue = <what it says, synced half only>,
  view    = <where it points the player, synced half only>,
  reveal  = <what it shows them, synced half only>,
  gameOver = <what ends the mission, synced half only>,
}
```

`mission` is the compiled scenario exactly as coilbox emitted it, so a misbehaving mission can be diagnosed by reading `missions/<id>/mission.lua` beside the scenario JSON.

## The start

The runtime takes over the start rather than sharing it, so a mission plays the same wherever it was launched from:

- `GameStart`: every actor is created at the ground height under its position, each prefab's buildings at their origin plus their own offset, each team's `startUnits` in a square grid on that team's engine start position, and last every group the scenario does not call `dormant`. Actors are addressable afterwards through `GG.CoilboxMission.units`, groups through `GG.CoilboxMission.groups`. Groups are placed last so one ordered to guard an actor has something to guard.
- Last of all, one anchor for each mission team a human is playing, so that team can never be empty. See [the anchor](#the-anchor).
- A building is put through `Spring.Pos2BuildPos` on the way. `Spring.CreateUnit` does not snap, and a base a few elmos off the build grid cannot be rebuilt where it stood and sits at the wrong height on a slope. That call answers with the height a builder would have used, so it replaces the ground read for buildings.
- Game frame 1: every mission team's bank is set to its `resources`, defaulting to nothing. This is how the normal starting resources are suppressed. `income` is then paid in every frame, spread over the second it is quoted per.
- A team whose scenario entry sets `noCommander` has anything the game spawns for it removed, from load until the end of game frame 1. Only creations with no builder are touched, so nothing anyone has begun building is affected.

Suppression removes rather than prevents because the engine offers no veto: `AllowUnitCreation` is consulted for builders and factories only, never for `Spring.CreateUnit`, which is what a game's start gadget uses.

The gadget sits at `layer = 1000`, behind a game's own gadgets. `gadgetHandler` runs low layers first, and the runtime is overriding the game rather than pre-empting it, so it wants the last word on starting resources and on damage modifiers.

## Triggers

A scenario's triggers are a flat list of "when these conditions hold, run these actions". Triggers that enable and disable other triggers are what turn the list into a state machine, so `coilbox_triggers.lua` owns the arming and nothing else. What a condition or action *means* is registered onto it:

```lua
GG.CoilboxMission.triggers:addCondition("units_in_zone", {
  -- The events this condition reacts to. Leave it out and the condition is an
  -- aggregate, evaluated on the polled tick instead.
  events = { "unit_destroyed" },
  test = function(params, ctx) return true end,
})

GG.CoilboxMission.triggers:addAction("set_var", function(params, ctx) end)
```

`ctx` is shared by every condition and action. It carries `state` (the table above), `engine`, `gameSpeed`, the current `frame`, and `event` when this pass came from one. Register in the gadget's `Initialize`, before the first frame.

A condition answers a question at the moment it is asked, which is no use to a condition about duration: `test` runs once per armed trigger per pass, so it is neither a clock nor guaranteed to run at all. Anything that has to sample the world on a fixed beat registers a sampler instead and leaves its `test` a lookup:

```lua
GG.CoilboxMission.triggers:addTick(function(ctx) end)
```

Samplers run at the top of every polled tick, before the pass, and never on an event or inside a cascade. So one runs once per beat however many passes follow it, and a condition reading what one wrote reads this tick's reading rather than the last one's.

Evaluation splits two ways:

- Events. The runtime raises `unit_created`, `unit_finished`, `unit_destroyed` and `unit_captured`, and anything may raise its own name with `engine:event(name, payload)`. A trigger is woken by an event only when *every* one of its conditions watches events, because a trigger that fired on a unit's death without rechecking its zone condition would be firing on a half-truth.
- The polled tick, every 15 frames. Aggregates land here: unit counts, zone occupancy, elapsed time. A trigger with one polled condition is polled.

A trigger fires when its condition group holds. The group is flat, one `op` over one list, with no nesting. An empty list holds under `all` and does not under `any`. Firing settles the trigger's own state first and runs its actions second, so an action has the last word: a fire-once trigger that re-enables itself stays armed.

- `repeat = false` disarms the trigger when it fires. `enable_trigger` re-arms it.
- `repeat = true` leaves it armed, so it fires on every pass its conditions hold. `cooldown`, in seconds, is how a mission slows that down. The compiled format does not carry `cooldown` yet ([#795](https://github.com/tomjn/coilbox/issues/795)). The runtime reads it so that adding it is an editor change only.
- Nothing is raised while the start window is open, so a mission's own placed units are not counted as units its team built.
- A condition type nothing has registered is false, and an action type nothing has registered does nothing. Both are reported once. This is what a mission built for a newer runtime does, and it is why the capability table in `missions/runtime.lua` exists.
- Triggers that set each other off inside one frame are cut off after sixteen passes and reported. Synced Lua that does not return takes the game with it.

## Zones

A zone is a named area of the map: a box with a `min` and a `max` corner, or a circle with a `center` and a `radius`. Both are flat. A scenario carries no height anywhere, because everything in one sits on terrain, so a zone is a footprint and a unit is in it or is not whatever its altitude.

Membership is the engine's own spatial queries, `Spring.GetUnitsInRectangle` and `Spring.GetUnitsInCylinder`. So a zone contains what everything else in the game would say it contains: a unit's mid position, and a boundary that counts as inside. A synced gadget reads every team, so nothing is hidden from the query by line of sight and every machine counts the same units. A box whose corners arrive the wrong way round is read as the box they describe, because one nothing can ever be inside is a silent mission.

- `units_in_zone` counts what is in a zone now, optionally narrowed to one `team` and to a list of `unitDefs`, and holds when the count sits between `min` and `max`. A condition stating neither means at least one, because asking about units in a zone with no number is asking whether anything is there. Stating only a maximum keeps its own meaning, so `max = 0` is how a mission asks whether a zone is clear.
- `zone_held_for` holds once a `team` has had a unit in a `zone` continuously for `seconds`. Occupancy is one reading per polled tick, taken by a sampler rather than by the condition, so the clock does not depend on which triggers happened to be armed and asked. Leaving the zone drops the reading, so coming back starts the count again. The clock belongs to the world, not to the trigger: a hold that began before the trigger watching it was armed still counts.

Only the zone and team pairs a mission's `zone_held_for` conditions actually name are sampled, so a mission that asks for no holds costs nothing per tick.

A hold is presence, not control. A team standing in a zone holds it whether or not anyone else is standing there too ([#802](https://github.com/tomjn/coilbox/issues/802)).

The zones are published as well as read, so anything else that has to work out where a zone is, `reveal_area` for one, reads the same corners the conditions do rather than parsing the shapes again.

## Revealing an area

`reveal_area` lifts the fog over a zone for a participant, so a mission can show the player the base it is about to send them at. `seconds` is how long for, and no seconds is the rest of the mission. No team named means the team a human is playing, the same team a `victory` that names none is about.

There is no engine call for it. Nothing in `LuaSyncedCtrl` grants sight over a region: `Spring.SetGlobalLos` is the whole map and per ally team, `Spring.SetUnitLosState` forces one unit's visibility and lifts no fog at all, and a feature emits no sight. The only thing in the engine that lights part of a map is a unit's own sight radius. So a reveal is a unit.

That unit is a spotter, and it is [the anchor](#the-anchor)'s twin: the same def that does nothing at all, invulnerable, blocking nothing, earning nothing, drawn nowhere, and left out of the runtime's own counting. It differs in the two ways that matter for standing in someone else's base rather than in an empty corner. It has sight, ground and air, at the radius the zone needs. And every other ally team is pinned to never see it, with `Spring.SetUnitLosMask` and `Spring.SetUnitLosState`, so an enemy army does not spend the mission shooting at an invulnerable box.

Two things follow from sight belonging to a unit, and neither is hidden:

- It is a circle. A box zone is covered by the circle around its corners, so a reveal spills past them. Under-revealing would leave the thing the author drew the box around in the dark.
- Terrain occludes it. Sight is a raycast from the spotter, so a ridge inside the zone shadows its far side, exactly as it would for a scout standing there. Air sight is granted at the same radius and is not occluded, so aircraft over the zone are seen wherever the ground is.

- Revealing a zone that is already lit for that participant keeps the one spotter and takes the new deadline, so a repeating trigger lights a zone once rather than filling it with units, and the last reveal decides when the fog comes back.
- A spotter goes on and comes off mid-mission, so neither is anything the triggers see: it is not a unit the team built and its going out is not a death. The start window does the same job for everything the runtime places at game start.
- When it comes off, the fog closes over what it saw and the ground it explored stays explored, the same as when any other unit walks away.
- A game with no def inert enough to be a spotter reveals nothing, and is told so.

```lua
GG.CoilboxMission.reveal.reveal("depot", "player", 30)
GG.CoilboxMission.reveal.hide("depot", "player")
```

## Pointing the player

`camera_pan` moves the camera to a place on the map, over `seconds`, defaulting to one second because a mission that teleports the camera has lost the player by the time they work out where it went. `map_marker` drops one of the map's own labelled points there, with the label the author wrote or none.

Both are the player's screen rather than the game, so, like a line of dialogue, synced Lua decides only that the mission asked and the unsynced half does it. They are the unsynced half's rather than the widget's because neither needs a panel and neither queues behind anything: a player who had the widget switched off would otherwise get no markers.

A marker is added locally. Every client runs that half, so a marker sent the way a player's own click sends one would be broadcast once per player and land on the map that many times over.

A scenario carries no height, so the ground under the position is read by the unsynced half at the moment the camera moves or the marker lands.

Neither action names a team. In a mission more than one person is playing, every player's camera moves and every player gets the marker ([#827](https://github.com/tomjn/coilbox/issues/827)).

```lua
GG.CoilboxMission.view.pan(500, 600, 2)
GG.CoilboxMission.view.mark(500, 600, "Ambush!")
```

## Vars

A var is a named number belonging to one mission: a kill counter, a phase number, a flag saying which branch the player took. Numbers and nothing else, by design, so `add_var` always has something to add to and the `var` condition is one comparison. A scenario's `vars` table is the name and the number each one starts at.

- `set_var` writes a number, `add_var` moves one by a delta, and `var` compares one against a number with `eq`, `ne`, `lt`, `lte`, `gt` or `gte`.
- `var` is polled rather than event-driven. A var changes only when an action changes it, so an event looks like the obvious fit, until a trigger reading a var nothing has changed yet, a mission's opening branch reading the number its author set, is never asked at all and the mission stalls.
- A name the scenario never declared reads as nothing and is reported. Writing one creates it. The compile step resolves every var a trigger names, so a stray name means a mission built by a newer editor or edited by hand, and a mission that half runs is harder to diagnose than one that says what it did.

Every write is mirrored into a game rules param named `coilbox_mission_var_<name>`, because a var nothing outside synced Lua can read is no use to an objectives panel, a debrief or a debug view. Reading the mirror needs no line of sight and no channel of our own: the engine keeps one table of game rules params for every Lua handle and answers `Spring.GetGameRulesParam` from all of them, LuaUI included. It stores each one as a float, so the mirror is a copy for readers and `GG.CoilboxMission.vars` stays the table the mission runs on.

A game's own actions read and write a var through that table rather than around it, so the mirror follows:

```lua
GG.CoilboxMission.vars.get("alertLevel")
GG.CoilboxMission.vars.set("alertLevel", 3)
GG.CoilboxMission.vars.add("kills", 1)
```

## Groups

A group is a block of units spawned and ordered together under one id: a raiding party, a reinforcement wave, a garrison. The scenario says what is in it, where it lands, what it does, and whether it is there from the start. A group's `units` are counts by def, which is what the editor draws, so the runtime expands them in the order the scenario lists them and places the block in a square grid on the group's own position.

A group has two states, and both actions earn their keep:

- On the map or not. A group the scenario does not call `dormant` is placed at game start. A dormant one waits for `spawn_group`.
- Awake or asleep. Asleep is a group standing there on hold position: its units exist, defend themselves, and do not wander off before the mission says so. Awake is a group running its orders.

So a dormant garrison is `spawn_group` when the mission wants it standing there and `wake_group` when it wants it moving, and a reinforcement wave is `wake_group` on its own, which spawns it and sends it off in one action.

- `spawn_group` places a group unless it already has units standing, so a trigger that fires twice does not double it and a wiped group can be sent again. It leaves the group as asleep or awake as it found it.
- `wake_group` runs the group's authored orders, placing it first if it is not on the map. "Wake the reinforcements" with nothing to wake would say nothing and do nothing.
- `give_orders` replaces a group's orders and wakes it, because a group told to move that stands there holding position is a mission that looks broken and reports nothing. It does not place one: ordering units nothing asked for is not what the author wrote.
- `gift_units` hands a group's units to another participant, as a gift rather than a capture. The group keeps them, so the mission can go on ordering a squad it gave the player.
- An action aimed at a group with nothing on the map is reported once. That is what a mission that forgot its `spawn_group` looks like.

A game's own actions, and the rest of the runtime, drive a group through that handle rather than around it, so the roll of who is still standing stays right:

```lua
GG.CoilboxMission.groups.units("raiders")     -- its units that are alive
GG.CoilboxMission.groups.isAwake("raiders")
GG.CoilboxMission.groups.spawn("raiders")
GG.CoilboxMission.groups.wake("raiders")
GG.CoilboxMission.groups.orders("raiders", { { kind = "move", waypoints = { { x = 0, z = 0 } } } })
GG.CoilboxMission.groups.gift("raiders", "player")
```

Sleep is the move state and nothing else. Each unit's own move state is read back before it is put on hold, so waking hands back the game's default for that unit type rather than guessing at one. Fire state is left alone: a garrison that will not defend itself is a stranger thing than one that will.

### Orders

An order list is one queue. The first command replaces whatever the unit was doing and the rest queue behind it, which is what a player holding shift through a path gets. Every unit in the group is given the same queue.

- `move`, `patrol` and `fight` are one command per waypoint. A scenario carries no height, so the ground is read at the moment the order is given.
- `patrol` is the engine's own. Giving the first patrol point to a unit with an empty queue makes the engine close the loop back to where the unit is standing, so a group patrols between its spawn and the points the author drew, exactly as it would if a player had shift-clicked them.
- `guard` is one command and no more. Guarding never finishes, so a second queued guard would never come up. A guard on a group names one of its units.
- `attack` is one command per unit in the target, which is what shift-attacking a squad gives a player and what lets a group work through what it was pointed at.

A target is an actor id or a group id, one name space, because the editor offers the author one list. A declared actor that has died, or a group that has been wiped, is a target that is not there rather than a name the mission got wrong, so only an undeclared name is reported.

## Prefab bases

A prefab is a base the author drags around as one piece, so its buildings are stored as offsets from an origin and resolved against it at game start. A building carries its own facing, and a factory carries the `queue` it starts with and whether it `repeat`s.

A build order is the negative of the unit def id. The engine reads the shift and control keys on one as "five of these" and "twenty of these", so each is given with no options at all and appends exactly one unit. Build orders always append, so nothing clears the queue either. `repeat` goes last and needs its 0-or-1 parameter, and the engine refuses it outright for a factory whose def cannot repeat, which is the game's decision rather than the mission's.

## Objectives

An objective is a line of text the player is working towards, with an id, a `kind` of `primary` or `secondary`, and whether it starts `hidden`. The runtime owns one thing about it: whether it is still open, and how it ended. `complete_objective` and `fail_objective` settle one.

- The first outcome sticks. A repeating trigger that goes on failing an objective the player has already completed would otherwise rewrite the debrief twice a second, and an author who wants a second chance at something writes a second objective. The second outcome is reported.
- An objective the scenario never declared is reported and settles nothing. Unlike a var it cannot be invented: its text and its kind are the scenario's, and there is nothing to draw without them.
- Settling an objective does not end the mission. A mission with three objectives and one ending is the ordinary case, so `victory` and `defeat` say when it is over.

Every objective is mirrored into a game rules param named `coilbox_mission_objective_<id>`, for the same reason a var is: the panel that draws them runs outside synced Lua. A rules param is a float, so the state is one: `0` still open, `1` completed, `-1` failed. Every declared objective is written before the first frame, so a reader never finds one missing.

The text, the kind and `hidden` are not mirrored. They never change, so a reader takes them from the compiled mission it is already looking at. A hidden objective is one to leave undrawn while its state is `0`.

```lua
GG.CoilboxMission.objectives.get("take-keep")   -- "active", "complete" or "failed"
GG.CoilboxMission.objectives.complete("take-keep")
GG.CoilboxMission.objectives.fail("take-keep")
```

## Dialogue and sound

A dialogue line is a radio message: an id, a speaker, a line of text, and optionally a portrait and a voice clip. The scenario declares them and a trigger fires one with `dialogue`. Portraits and clips are bare file names, and the launch path copies them in beside the compiled mission, so they are read from `missions/<id>/`.

`play_sound` is the same idea without the panel. Its `sound` is passed to `Spring.PlaySoundFile` as the author wrote it, so it is an item in the game's own `sounds.lua` or a path to a file in the game. Unlike a dialogue clip it is not something coilbox ships beside the mission.

- A line id the scenario never declared says nothing and is reported. Like an objective and unlike a var it cannot be invented: a line is its speaker and its text as much as its id.
- The synced half decides only that a line was said. Which is why the whole message is the id: what a line looks like and sounds like is the reader's, and the reader has the compiled mission.

```lua
GG.CoilboxMission.dialogue.get("warn")     -- the scenario's record for a line
GG.CoilboxMission.dialogue.say("warn")
GG.CoilboxMission.dialogue.sound("alarm.wav")
```

## The panels

The objectives panel, the dialogue panel and the debrief are one LuaUI widget, `coilbox_mission_ui`. It reads the mission's state out of game rules params, reads the mission itself out of the archive the same way the gadget does, and never talks back: nothing on one player's screen may reach the game.

- The objectives panel lists what the mission is asking for: primaries first, then secondaries, each in the order the scenario lists them. A hidden objective is left out while it is active, and settling one is what reveals it.
- The dialogue panel shows one line at a time, with its speaker, its portrait and its clip. Lines queue rather than interrupt, because a trigger with two lines in it is an author writing an exchange. A line holds the panel for as long as its text takes to read, three seconds at least and twelve at most, and the backlog behind it is capped at six.
- The debrief appears once the mission is over and says whether the player won, with how each objective ended. Clicking it dismisses it.
- An actor the author gave a `name` has that name drawn over its unit. This is the one piece of actor state with no engine call behind it, because nothing renames a unit.

What the widget draws is decided in `coilbox_panel_model.lua`, which is pure: it takes a function that reads a game rules param and a function that measures a string, and answers with what to draw. That is the only part of a widget a test outside the engine can reach, so all of it lives there.

### What crosses between the halves

Anything that never changes, the widget reads out of the compiled mission itself. Everything else is a game rules param, because the engine keeps one table of them for every Lua handle and answers `Spring.GetGameRulesParam` from all of them:

| Param | What it says |
| --- | --- |
| `coilbox_mission_objective_<id>` | `0` active, `1` complete, `-1` failed |
| `coilbox_mission_var_<name>` | the var's number |
| `coilbox_mission_actor_<id>` | the unit that actor is, or `0` when it is not on the map |
| `coilbox_mission_over` | `1` once the mission has ended |
| `coilbox_mission_winners` | how many ally teams won |
| `coilbox_mission_winner_<allyTeam>` | `1` for each of them |

Every one of those is written before the first frame, so a reader never finds one missing.

The exceptions are the things that happen rather than the things that are. A line of dialogue is one: two lines in one frame would overwrite each other in a param, and the second half of an exchange is the half worth having. So the synced half sends it to its unsynced half, which passes it to LuaUI with `Script.LuaUI.CoilboxMissionDialogue(<line id>)`. A game with no LuaUI, or a player who has switched the widget off, gets no dialogue: the engine treats a call to a global nothing registered as doing nothing, and there is nowhere for a line to appear anyway.

A sound, a camera move and a map marker go to the unsynced half and stop there rather than going on to LuaUI. None of the three has a conversation to queue behind, none needs a panel, and a player with the widget switched off should still get their markers.

The outcome is mirrored despite `Spring.GameOver` already carrying it, because LuaUI cannot read it back: the engine hands the winning ally teams to the `GameOver` callin and the stock widget handler calls a widget's `GameOver` with no arguments at all.

## Ending a mission

The runtime ends a mission with `Spring.GameOver`, the same call a normal game ends with, so the result lands in the replay and coilbox reads a scenario's outcome through the code path it already reads a skirmish's through. Nothing of ours in between, and nothing to keep in step.

- `victory` names a participant and declares its ally team the only winner.
- `defeat` names a participant and declares every other ally team the winner, Gaia aside. That is what a losing player's replay has to say: a reader deciding whether the player lost asks whether the player's ally team is in the winning list, so a loss is that list without them in it.
- Either with no team named means the team a human is playing. Failing that, the lowest engine team number, said out loud, because that is the first slot in the start script and where the player sits in a mission coilbox launched.
- A mission ends once. The second ending is reported, and nothing is evaluated afterwards: no polled tick, no event. The result is already in the replay, and a trigger that spawns a wave into a finished mission is a mission that looks broken.
- The outcome is mirrored into `coilbox_mission_over`, `coilbox_mission_winners` and one `coilbox_mission_winner_<allyTeam>` per winner. That is a copy of what went to `Spring.GameOver` and it exists for the debrief, which cannot read the call back. See [what crosses between the halves](#what-crosses-between-the-halves).

The actions run in the order the trigger lists them, so a trigger that wins and then plays a line plays the line.

### The anchor

A game ends itself when an ally team has nothing left. The engine's own `game_end` gadget kills every team in that ally team, which demotes its players to spectators and hands the win to the survivors. A mission where the player legitimately reaches zero units, the convoy driving off the map or the last commando spent, would end there in a loss halfway through.

So each mission team a human is playing gets one anchor: a unit that is on the map for no other reason. The team is never empty, so nothing but the runtime decides the mission is over. This is the other half of the adoption contract, and it holds whether or not the vendoring game has added its guard to `Spring.GameOver`, because being spectated mid-mission is the damage even when nobody declares a winner.

- The def is the first one the game has that does nothing at all: immobile, unarmed, builds nothing, and neither makes nor spends resources. Chosen by ascending def id, because a unit created on one machine and not another is a desync. A game with no such def gets no anchor, and is told what that costs. [A spotter](#revealing-an-area) is built from the same def, for the same reasons.
- It is placed with everything else the runtime places, inside the start window, so no trigger sees it arrive and no team counts it as something it built. The engine clamps a creation into the map, so it stands in the corner.
- It is invulnerable, blocks nothing, sees nothing, is stealthed, earns nothing, and the unsynced half draws it nowhere, puts it on no minimap and lets nothing select it.
- The runtime's own counting skips it. `unit_count` takes it off a team's total and `units_in_zone` and `zone_held_for` leave it out, so a mission asking whether the player has anything left, or whether a zone is clear, gets the answer it would have got without an anchor. It still shows in that team's unit count in the game's own UI, which is the price.

```lua
GG.CoilboxMission.gameOver.isOver()
GG.CoilboxMission.gameOver.victory("player")
GG.CoilboxMission.gameOver.defeat("player")
```

## Conventions

- Everything vendored is named `coilbox_*` so a game maintainer can see at a glance which files came from here.
- The gadget file is loaded twice, once synced and once unsynced. Put synced-only work behind `gadgetHandler:IsSyncedCode()`, and keep anything that runs in both deterministic. The two halves have separate `GG` tables, so the synced half tells the unsynced half what it did with `SendToUnsynced`.
- Files under `missions/` are data. They are read with an empty environment, so they may not call the engine or touch globals.
- Files under `luarules/mission_runtime/` are code. They are read with the gadget's own environment, so they may call the engine, and a module that does not need to should not.
- Adding a condition or action type means adding it to `missions/runtime.lua` and bumping `version` in the same change. A type that has shipped is never removed: a scenario asking for it would then silently do nothing.
- Version 1 has not shipped to a game yet, so a type it declares and does not implement is a gap to close rather than a lie to version around. `unlock_unit` is the last one, and it waits on the runtime enforcing a scenario's restrictions ([#793](https://github.com/tomjn/coilbox/issues/793)).

## Tests

```sh
luajit lua/mission-runtime/tests/gate_test.lua
luajit lua/mission-runtime/tests/plan_test.lua
luajit lua/mission-runtime/tests/start_test.lua
luajit lua/mission-runtime/tests/trigger_test.lua
luajit lua/mission-runtime/tests/zone_test.lua
luajit lua/mission-runtime/tests/var_test.lua
luajit lua/mission-runtime/tests/group_test.lua
luajit lua/mission-runtime/tests/objective_test.lua
luajit lua/mission-runtime/tests/gameover_test.lua
luajit lua/mission-runtime/tests/dialogue_test.lua
luajit lua/mission-runtime/tests/view_test.lua
luajit lua/mission-runtime/tests/reveal_test.lua
luajit lua/mission-runtime/tests/panel_test.lua
luajit lua/mission-runtime/tests/mission_trigger_test.lua
```

`tests/support.lua` holds the shared scaffolding: a stub of the slice of the engine the runtime touches, which records what the runtime asked for and plays back the callins it reacts to.

`mission_trigger_test.lua` runs the scenario fixtures in `src/scenario/fixtures/missions/`, which are the files coilbox's own compiler emits. The runtime is proved against the emitted shape rather than against one written to suit it.

Nothing here proves the widget. Everything a widget does is OpenGL, a font and a mouse, and none of the three exists outside a running engine. `panel_test.lua` proves what the widget decides before it draws: which objectives are visible and in what order, which name goes over which unit, how long a line holds the panel, where a line of text breaks, and whether the player won. That the drawing then lands where it should, that the panels do not sit on top of the game's own UI, and that a portrait loads, are claims only a real engine can settle.
