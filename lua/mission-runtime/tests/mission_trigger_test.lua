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

local ran = record(state.triggers, { "add_var", "gift_units", "reveal_area", "unlock_unit" })

-- Vars are a later issue. A stand-in here shows what registering one looks like
-- and lets the fixture's own state machine run end to end.
local vars = { garrisonBuilt = 0 }
state.triggers:addCondition("var", {
	test = function(params)
		return vars[params.name] >= params.value
	end,
})
state.triggers:addAction("set_var", function(params)
	vars[params.name] = params.value
end)

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
check("a registered stand-in condition is what let it hold", vars.garrisonBuilt == 1)

check("the mission's own units are not counted as built",
	state.triggers:isEnabled("built-outpost") == true)

local depot = engine.spawn("armestor", 1, 99)
engine.env:GameFrame(45)
check("a unit under construction has not been built yet",
	state.triggers:isEnabled("built-outpost") == true)

engine.finish(depot)
check("a finished unit fires the trigger watching for it",
	state.triggers:isEnabled("built-outpost") == false)
check("its actions ran on the event, not on the next tick", ranAll(ran) == "unlock_unit,add_var", ranAll(ran))
check("and its disable_trigger took effect", state.triggers:isEnabled("count-check") == false)

engine.give(state.units.outpost, 0)
check("an actor changing hands fires the trigger watching for it",
	state.triggers:isEnabled("outpost-captured") == false)
check("that trigger's actions ran", ranAll(ran) == "unlock_unit,add_var,gift_units,reveal_area", ranAll(ran))

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

check("a condition this runtime has no implementation for is reported",
	logged(engine, "no implementation for condition units_in_zone"))
check("and the trigger asking for it never fires", state.triggers:isEnabled("spring-ambush") == true)

--------------------------------------------------------------------------------
-- Triggers are synced only.
--------------------------------------------------------------------------------

local unsynced = load({ coilbox_mission = "demo" }, missionFiles(fixture("ambush")), { synced = false })
unsynced.env:Initialize()
check("the unsynced half runs no triggers", unsynced.GG.CoilboxMission.triggers == nil)

support.report()
