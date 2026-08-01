# Mission runtime

The Lua that plays a coilbox scenario inside the engine. It is coilbox-authored and game-agnostic: a game vendors a copy, and coilbox installs and updates it (see the [scenario editor design](../../docs/superpowers/specs/2026-07-31-scenario-editor-design.md)).

## Layout

- `luarules/gadgets/coilbox_mission_runtime.lua`, the gadget. It gates on the modoption, loads the compiled mission, and hands it to the rest of the runtime.
- `luarules/mission_runtime/`, the runtime's own modules. `coilbox_start.lua` turns a compiled mission into the team setup and the list of units to place. `coilbox_triggers.lua` is the trigger engine. `coilbox_unit_conditions.lua` registers the conditions that read units, `coilbox_zones.lua` the conditions that read zones, `coilbox_vars.lua` the mission's variables, `coilbox_groups.lua` its groups, `coilbox_objectives.lua` its objectives, `coilbox_dialogue.lua` what it says, `coilbox_view.lua` where it points the player, `coilbox_reveal.lua` what it shows them, `coilbox_restrictions.lua` what its teams may build and do, `coilbox_gameover.lua` how it ends, and `coilbox_extensions.lua` the condition and action types a game declares for itself. The first two are pure, with no engine calls and no state, so the gadget reads the engine, asks them what the mission wants, and carries the answer out. `coilbox_dialogue.lua` and `coilbox_view.lua` are pure as well, because saying a line, moving a camera and dropping a marker are all deciding that the mission asked and nothing more.
- `luaui/widgets/coilbox_mission_ui.lua`, the widget: the objectives panel, the dialogue panel, the debrief and the name over a named actor. `luaui/mission_ui/coilbox_panel_model.lua` is everything it decides before it draws, pure and tested outside the engine.
- `missions/runtime.lua`, the version marker and capability table. Coilbox reads it out of an installed game to decide what the editor may offer.
- `missions/extensions.lua` is *not* here, and never installed. It is the game's own file, declaring the game's own trigger types, and both the runtime and the editor read it out of whatever game has one. See [Game extensions](#game-extensions).
- `tests/`, checks that run outside the engine with `luajit`, and `tests/headless/`, the probe and scratch game that run inside one. Not part of what a game vendors.

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
  suppressesStart = <function(teamID): does the mission place this team's start?>,
  suppressesEveryStart = <function(): does it place every team's?>,
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
  restrictions = <what its teams may build and do, synced half only>,
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
- A team whose scenario entry sets `noCommander` gets no start from the game. The game is asked not to spawn one, and a game that has not been asked has anything it spawns removed instead, from load until the end of game frame 1. Only creations with no builder are touched, so nothing anyone has begun building is affected.

Asking is the third item in the [adoption contract](../../docs/mission-runtime.md). A game calls `GG.CoilboxMission.suppressesStart(teamID)` where its own start gadget would spawn, and spawns nothing when the answer is true. The answer is the scenario's, so it holds for the whole mission rather than for a window.

A game whose start is a sequence of pre-game phases rather than a call asks `GG.CoilboxMission.suppressesEveryStart()` at the top of the sequence and skips it. That is the same question asked about the game rather than about one team, true when the mission owns the start of every non-Gaia team in the engine's team list. A phase is global, so the whole game decides whether one is worth running, and a team the mission says nothing about still has a start to pick a faction and a position for.

Skipping is the game's, not the runtime's. A phase machine is the game's own gadget state and its own rules params, and the runtime can reach neither: all it can do is answer. Splinter Faction ran a faction picker and a spot picker to frame 1800 over a mission that was already playing ([issue #888](https://github.com/tomjn/coilbox/issues/888)).

Removing is the fallback for a game that has not adopted that item, and it only reaches as far as game frame 1, which is late enough for a game that spawns at frame 0 and no use at all to one that does not. Splinter Faction spawns at frame 1800 ([issue #884](https://github.com/tomjn/coilbox/issues/884)).

Widening that window is not the fix. A game that counts commanders counts the one the runtime is about to destroy, and Splinter Faction's `game_team_com_ends.lua` answers an ally team's last commander dying with `Spring.KillTeam`: the player loses every unit they have and their seat in the game. Undoing a start at frame 1 is ahead of that bookkeeping and undoing one at frame 1800 is not, so the only reliable answer is for the game not to spawn.

Removing rather than preventing is forced, because the engine offers no veto: `AllowUnitCreation` is consulted for builders and factories only, never for `Spring.CreateUnit`, which is what a game's start gadget uses.

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
- `repeat = true` leaves it armed, so it fires on every pass its conditions hold. `cooldown`, in seconds, is how a mission slows that down.
- Nothing is raised while the start window is open, so a mission's own placed units are not counted as units its team built.
- A condition type nothing has registered is false, and an action type nothing has registered does nothing. Both are reported once. This is what a mission built for a newer runtime does, and it is why the capability table in `missions/runtime.lua` exists.
- Triggers that set each other off inside one frame are cut off after sixteen passes and reported. Synced Lua that does not return takes the game with it.

## Game extensions

`coilbox_extensions.lua` is the same registration seam, offered to the game. A game that ships `missions/extensions.lua` declaring condition and action types of its own, and a handler implementing them, gets a trigger naming one dispatched to its code. The format is in [docs/mission-runtime.md](../../docs/mission-runtime.md#4-optional-declare-your-own-condition-and-action-types), which is the page a game maintainer reads. What matters here is how the module holds the line.

- **Registration is the loader's, not the game's.** The handler returns a table of implementations rather than being handed the engine, so the two rules below are structural rather than something a game is asked to respect.
- **A type the version marker declares is refused**, whichever of its two lists it is in, with an error naming it. `missions/runtime.lua` is the boundary: what it declares is the runtime's, and everything else is the game's to add.
- **Only what the declaration lists is registered.** An implementation with no declaration would be a type the game can run and the editor cannot offer, so it is reported and dropped. A declaration with no implementation is reported too, and behaves like any type nothing registered.
- **It registers last**, after every module above, so the marker's list and the engine's registrations are the same list by the time a game's own are read.
- **The declaration is read in an empty environment and the handler in one that reaches the engine.** The handler's is a table of its own falling through to the gadget's, so it can read `GG`, where a game keeps everything an extension is likely to want, and its own globals stay out of the runtime's. `VFS.Include` with no environment at all does not reach `GG`, which is what the Splinter Faction proof found.
- **`ctx.teamOf(name)`** is added to the shared context here: the engine team number for a team the scenario names, which is the one piece of the runtime's bookkeeping an extension cannot do without.

What was registered is published on `GG.CoilboxMission.extensions` as `{ conditions = { ... }, actions = { ... } }`, so a game's own Lua can see what the runtime took.

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
- `gift_units` hands a group's units to another participant, as a capture rather than a gift. A give is the form a game refuses: the engine passes that flag straight to `AllowUnitTransfer`, and the usual anti-grief gadget says no to a share between teams that are not allied, which is most of what a mission gifts for. Everything else about the two is the same. The group keeps its units, so the mission can go on ordering a squad it gave the player, and a game that refuses the move outright is reported.
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

## Restrictions

A scenario says what its teams may build, with `restrictions.buildable`, an allow or a deny list of unit defs, and what they may do, with `restrictions.commands`, engine command names withheld. `AllowUnitCreation` and `AllowCommand` are where both land.

The engine has its own `[RESTRICT]` block and the runtime does not use it, because it is global and permanent. `unlock_unit` is why: a restriction a mission lifts halfway through, for one participant, is the thing `[RESTRICT]` cannot express.

A restriction binds every team the scenario declares, which is the reach `[RESTRICT]` has. The format names no team, so binding the human player alone would be a rule the mission never stated, and it would leave an author no way to restrict an enemy at all. `unlock_unit` is the other end: an author who wants a rule for the player only writes the restriction and unlocks the def for everyone else. A team the scenario says nothing about, Gaia included, is not the mission's to restrict.

- A refused build drops the order that asked for it. Otherwise a factory queue jams on a unit it will never be allowed to build and a builder stands at the site retrying for the rest of the mission.
- The build icon is still in the menu, so a player clicking one gets a builder that walks over and does nothing ([#832](https://github.com/tomjn/coilbox/issues/832)).
- What the runtime itself places is unaffected. `AllowUnitCreation` is consulted for builders and factories only, never for `Spring.CreateUnit`, so a mission may hand a team a unit that team is forbidden to build.
- A command synced Lua gave is let through. A restriction is what the player may not do, and a mission that withheld `attack` and then could not order its own raiders to attack would be restricting its author.
- A command is named the way the engine names it, so `selfd` is `CMD.SELFD`. A name the engine has no command for is reported.
- Neither callin is defined unless the mission asks for one. `AllowCommand` is consulted for every order anyone gives for the length of the game, and a mission that restricts nothing should pay nothing.

`unlock_unit` lifts the buildable restriction on one def for one participant, and no participant named means the team a human is playing, the same team a `victory` that names none is about. Under an allow list it adds the def rather than taking it off a list: both modes are the same question asked from opposite ends, which is why one action answers both. Unlocking a def nothing was restricting is reported, because an author's mid-mission reward that the player already had is a mission that looks like it did something and did not.

```lua
GG.CoilboxMission.restrictions.allowsBuild(unitDefID, team)   -- team is an engine team
GG.CoilboxMission.restrictions.allowsCommand(cmdID, team)
GG.CoilboxMission.restrictions.unlock("armestor", "player")
```

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
- Version 1 has not shipped to a game yet, so a type it declares and does not implement is a gap to close rather than a lie to version around. There are none left: every condition and action in `missions/runtime.lua` is implemented.

## Tests

```sh
scripts/mission-tests.sh
```

Every `tests/*_test.lua` file, each in its own `luajit`. Adding a suite is adding a file, and running one on its own is still `luajit lua/mission-runtime/tests/<name>_test.lua`. This is what the lint workflow runs.

`tests/support.lua` holds the shared scaffolding: a stub of the slice of the engine the runtime touches, which records what the runtime asked for and plays back the callins it reacts to.

`mission_trigger_test.lua` runs the scenario fixtures in `src/scenario/fixtures/missions/`, which are the files coilbox's own compiler emits. The runtime is proved against the emitted shape rather than against one written to suit it.

Nothing here proves the widget. Everything a widget does is OpenGL, a font and a mouse, and none of the three exists outside a running engine. `panel_test.lua` proves what the widget decides before it draws: which objectives are visible and in what order, which name goes over which unit, how long a line holds the panel, where a line of text breaks, and whether the player won. That the drawing then lands where it should, that the panels do not sit on top of the game's own UI, and that a portrait loads, are claims only a real engine can settle.

## In a real engine

```sh
scripts/mission-headless.sh
```

The suites above run against a stub, so every engine call in them is a claim read off the engine's source rather than something anyone has watched happen. This settles the ones that can be settled by watching. It builds a scratch game out of `luarules/`, `luaui/` and `missions/` on top of an installed game, and plays each fixture mission in `spring-headless`, which simulates with no OpenGL context. `tests/headless/probe.lua` is the player: a headless run has nobody at the keyboard, so the probe walks a unit into a zone, kills an actor, hands one over, and checks what the runtime did about it.

It needs a `spring-headless` binary, a game carrying the fixture missions' unit defs (Balanced Annihilation by default) and any map. The script's own header lists the environment variables that point it at them. Nothing in CI runs it, because a runner has none of the three.

What it has settled:

- The modoption gate. A game with no `coilbox_mission` loads no runtime gadget at all, so nothing here is in a normal game's way.
- The start, against a real game's own start gadget. A team the scenario marks `noCommander` ends the start owning only what the scenario placed, a team's `startUnits` are on its start position, and every mission team's bank is the scenario's number rather than the game's.
- The start window. What the runtime placed is not counted as something the team built, and a unit finished after it is.
- A prefab's factory queue is the three units the prefab wrote, one order each, with the factory repeating.
- The rules params. Objectives, vars, the unit an actor became, the game over and the winning ally team all come back out of `Spring.GetGameRulesParam`.
- Triggers firing on a zone entered, a unit count reached, a unit finished, a death and a capture, and one mission ending: `zone_held_for` completes its objective and hands the win to the player's ally team at the frame the clock says.
- A reveal. A capture lights a zone with one spotter, no other ally team can see it, and it comes off the map when its 30 seconds are up.
- `gift_units` across ally lines. The garrison mission hands the player's squad to an enemy team, and both units arrive.

What it has caught:

- `gift_units` moved nothing between teams that were not allied, and the runtime never noticed, because it asked for a share and threw the refusal away ([#857](https://github.com/tomjn/coilbox/issues/857)). The stub agreed with everything, so all fifteen suites passed on it. Fixed by asking for a capture and reporting a refusal. The stub now takes an `AllowUnitTransfer` of its own.
- A game's extension handler could not see `GG`, so both of its types failed on their first call ([#776](https://github.com/tomjn/coilbox/issues/776)). `VFS.Include` with no environment does not hand the chunk the gadget's, and the stub's stand-in did. Fixed by naming the environment. `scripts/mission-sf-extension.sh` is where it showed up.

What it still cannot settle:

- The widget, still. The engine loads LuaUI in a headless run, but the game the harness runs on has none that loads against a current engine, so `luaui/widgets/` has never been reached ([#850](https://github.com/tomjn/coilbox/issues/850)).
- The restrictions. `AllowUnitCreation` returning `false, true` to clear a factory queue, and `AllowCommand` withholding a command, are the two callins with no fixture behind them: all three fixtures restrict nothing ([#849](https://github.com/tomjn/coilbox/issues/849)).
