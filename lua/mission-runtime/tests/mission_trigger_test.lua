-- Proves the trigger engine wired into the gadget, driven by the scenario
-- fixtures coilbox itself compiles. Everything here reads a real
-- missions/<id>/mission.lua, so the shapes under test are the emitted ones, not
-- shapes invented to suit the runtime. Run it with:
--
--   luajit lua/mission-runtime/tests/mission_trigger_test.lua
--
-- This directory is not part of the runtime a game vendors. Only luarules/,
-- luaui/ and missions/ are installed into a game.

local support = dofile((arg[0]:match("^(.*)/[^/]+$") or ".") .. "/support.lua")
local check, load, logged = support.check, support.load, support.logged
local missionFiles, fixture = support.missionFiles, support.fixture

--- Start a fixture mission and run up to the first frame the game is playing.
local function playing(id)
	local engine = load({ coilbox_mission = "demo" }, missionFiles(fixture(id)), {
		startPositions = { [0] = { x = 500, z = 500 }, [1] = { x = 100, z = 100 } },
	})
	engine.env:Initialize()
	engine.env:GameStart()
	return engine, engine.GG.CoilboxMission
end

--- Stand in for the action types later issues implement, recording that they
-- ran. Registering onto the published engine is the seam a game's own
-- extensions use too.
local function record(triggers, kinds)
	local ran = {}
	for _, kind in ipairs(kinds) do
		triggers:addAction(kind, function()
			ran[#ran + 1] = kind
		end)
	end
	return ran
end

local function ranAll(ran)
	return table.concat(ran, ",")
end

--------------------------------------------------------------------------------
-- Garrison: what a team owns, what it has built, and what it has lost.
--------------------------------------------------------------------------------

local engine, state = playing("garrison")

check("the trigger engine is published", state.triggers ~= nil)
check("a trigger the scenario disabled starts disabled", state.triggers:isEnabled("unlock") == false)
check("every other trigger starts armed", state.triggers:isEnabled("count-check") == true)

local ran = record(state.triggers, { "reveal_area", "unlock_unit" })

engine.env:GameFrame(0)
check("nothing fires while the start window is open", state.triggers:isEnabled("count-check") == true)
engine.env:GameFrame(1)

for _ = 1, 2 do
	engine.spawn("armpw", 1)
end
engine.env:GameFrame(15)
check("a unit count short of its minimum does not hold", state.triggers:isEnabled("count-check") == true)

engine.spawn("armpw", 1)
engine.env:GameFrame(30)
check("a unit count reaching its minimum fires", state.triggers:isEnabled("count-check") == false)
check("a fired trigger's enable_trigger arms another", state.triggers:isEnabled("unlock") == false,
	"unlock should have been armed and then spent")
check("the trigger it armed ran in the same pass", ranAll(ran) == "unlock_unit", ranAll(ran))
check("the var an earlier action set is what let it hold", state.vars.get("garrisonBuilt") == 1,
	tostring(state.vars.get("garrisonBuilt")))

check("the mission's own units are not counted as built",
	state.triggers:isEnabled("built-outpost") == true)

local depot = engine.spawn("armestor", 1, 99)
engine.env:GameFrame(45)
check("a unit under construction has not been built yet",
	state.triggers:isEnabled("built-outpost") == true)

engine.finish(depot)
check("a finished unit fires the trigger watching for it",
	state.triggers:isEnabled("built-outpost") == false)
check("its add_var ran on the event, not on the next tick", state.vars.get("garrisonBuilt") == 2,
	tostring(state.vars.get("garrisonBuilt")))
check("and its disable_trigger took effect", state.triggers:isEnabled("count-check") == false)

engine.give(state.units.outpost, 0)
check("an actor changing hands fires the trigger watching for it",
	state.triggers:isEnabled("outpost-captured") == false)
check("that trigger's actions ran", ranAll(ran) == "unlock_unit,reveal_area", ranAll(ran))

-- The mission gifts a dormant group it never spawned. Nothing to hand over, and
-- an author who forgot the spawn_group is told so rather than left wondering.
check("gifting a group that was never spawned says so",
	logged(engine, "group reinforcements has no units on the map to gift"))

--------------------------------------------------------------------------------
-- Ambush: an actor's health and its death.
--------------------------------------------------------------------------------

engine, state = playing("ambush")

local lines = record(state.triggers, { "dialogue", "play_sound", "camera_pan", "map_marker" })
local scout = state.units.scout

engine.env:GameFrame(1)
engine.env:GameFrame(15)
check("a healthy actor trips nothing", #lines == 0, ranAll(lines))

engine.env.Spring.SetUnitHealth(scout, 40)
check("health is not read between ticks", #lines == 0)
engine.env:GameFrame(30)
check("an actor below its stated health fires on the polled tick",
	ranAll(lines) == "dialogue", ranAll(lines))
check("the trigger watching it is spent", state.triggers:isEnabled("scout-wounded") == false)
check("the trigger watching its death is not", state.triggers:isEnabled("scout-down") == true)

engine.env.Spring.DestroyUnit(scout)
check("a dead actor fires on the death itself", state.triggers:isEnabled("scout-down") == false)
check("its dialogue ran", ranAll(lines) == "dialogue,dialogue", ranAll(lines))

--------------------------------------------------------------------------------
-- The ambush itself: a box zone the player has to walk into.
--
-- The mission's own units are already on the map, and the enemy scout stood
-- inside the pass from the first frame, so the zone is proved to be reading the
-- team the trigger names rather than whatever is nearest.
--------------------------------------------------------------------------------

local patrol = engine.spawn("armpw", 0)
engine.move(patrol, 800, 800)
engine.env:GameFrame(45)
check("the player's units outside the pass do not spring the ambush",
	state.triggers:isEnabled("spring-ambush") == true)
check("a dormant group is not on the map before it is spawned",
	#state.groups.units("raiders") == 0)

engine.move(patrol, 100, 100)
engine.env:GameFrame(60)
check("walking into the pass springs it", state.triggers:isEnabled("spring-ambush") == false)
check("and the whole trigger ran",
	ranAll(lines) == "dialogue,dialogue,dialogue,camera_pan,map_marker,play_sound", ranAll(lines))

--------------------------------------------------------------------------------
-- The raiders: spawn_group, wake_group and give_orders as the mission wrote
-- them, against the real implementation.
--------------------------------------------------------------------------------

local raiders = state.groups.units("raiders")
check("spawn_group put the whole group on the map", #raiders == 4, tostring(#raiders))
check("its units are the def and team the scenario names",
	engine.units[raiders[1]].def == "armpw" and engine.units[raiders[1]].team == 1)
check("wake_group left it running its orders", state.groups.isAwake("raiders") == true)
check("so it is not holding position",
	engine.units[raiders[1]].movestate ~= engine.env.CMD.MOVESTATE_HOLDPOS)

-- The scout the group was told to attack died earlier in this test. A declared
-- actor that is dead is a target that is not there, not a name the mission got
-- wrong, so nothing is reported.
check("an order about an actor that has died is not reported as a bad name",
	not logged(engine, "to give an order about"))

--------------------------------------------------------------------------------
-- Siege: holding a zone for a minute.
--------------------------------------------------------------------------------

local siege
engine, siege = playing("siege")

local ended = record(siege.triggers, { "complete_objective", "victory", "fail_objective", "defeat" })

--- Run the game on to `frame`, ticking every frame the way the engine does.
local function playTo(from, frame)
	for at = from, frame do
		engine.env:GameFrame(at)
	end
	return frame
end

local at = playTo(1, 60)
check("the defenders sitting in their own keep do not complete the player's objective",
	#ended == 0, ranAll(ended))

local squad = engine.spawn("armpw", 0)
engine.move(squad, 20, 20)
at = playTo(at + 1, 1800)
check("taking the keep does not complete a hold on its own", #ended == 0, ranAll(ended))

engine.move(squad, 900, 900)
at = playTo(at + 1, 1830)
check("and leaving before the minute is up loses the hold", #ended == 0, ranAll(ended))

engine.move(squad, 20, 20)
at = playTo(at + 1, 3600)
check("so the minute has to be served from the return", #ended == 0, ranAll(ended))

playTo(at + 1, 3660)
check("a minute held end to end completes the objective and wins",
	ranAll(ended) == "complete_objective,victory", ranAll(ended))

--------------------------------------------------------------------------------
-- Triggers are synced only.
--------------------------------------------------------------------------------

local unsynced = load({ coilbox_mission = "demo" }, missionFiles(fixture("ambush")), { synced = false })
unsynced.env:Initialize()
check("the unsynced half runs no triggers", unsynced.GG.CoilboxMission.triggers == nil)

support.report()
