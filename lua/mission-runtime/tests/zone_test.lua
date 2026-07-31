-- Proves zones: what counts as inside a box and a circle, what the two zone
-- conditions ask, and what starts and restarts a hold. The gadget is loaded
-- under the stub engine, because a zone means nothing except against the
-- engine's spatial queries, and the stub answers those the way the engine does:
-- a unit on the boundary is inside. Run it with:
--
--   luajit lua/mission-runtime/tests/zone_test.lua
--
-- This directory is not part of the runtime a game vendors. Only luarules/,
-- luaui/ and missions/ are installed into a game.

local support = dofile((arg[0]:match("^(.*)/[^/]+$") or ".") .. "/support.lua")
local check, load, logged = support.check, support.load, support.logged
local missionFiles, compiled = support.missionFiles, support.compiled

--------------------------------------------------------------------------------
-- Scaffolding: a mission of nothing but zones and the triggers that read them.
--
-- Every trigger repeats, so each polled tick says which conditions hold right
-- then rather than which have ever held.
--------------------------------------------------------------------------------

local ZONES = {
	{ id = "yard", name = "Yard", shape = "box", min = { x = 0, z = 0 }, max = { x = 200, z = 200 } },
	-- The same box with its corners the wrong way round, which is what dragging
	-- one up and to the left in the editor produces.
	{ id = "backwards", name = "Backwards", shape = "box", min = { x = 200, z = 200 }, max = { x = 0, z = 0 } },
	{ id = "well", name = "Well", shape = "circle", center = { x = 0, z = 0 }, radius = 50 },
}

local TEAMS = {
	player = { team = 0 },
	enemy = { team = 1 },
}

local function watching(id, params, kind)
	return {
		id = id,
		enabled = true,
		["repeat"] = true,
		conditions = { op = "all", conditions = { { type = kind or "units_in_zone", params = params } } },
		actions = { { type = "probe", params = { mark = id } } },
	}
end

--- Start a mission of the given triggers and run to the first playable frame.
local function playing(triggers)
	local mission = compiled({ zones = ZONES, teams = TEAMS, triggers = triggers })
	local engine = load({ coilbox_mission = "demo" }, missionFiles(mission))
	engine.env:Initialize()
	engine.env:GameStart()

	local fired = {}
	engine.GG.CoilboxMission.triggers:addAction("probe", function(params)
		fired[#fired + 1] = params.mark
	end)
	engine.fired = fired

	engine.env:GameFrame(1)
	return engine
end

--- Run the polled tick at `frame` and say what fired on it, in mission order.
local function tick(engine, frame)
	for index = #engine.fired, 1, -1 do
		engine.fired[index] = nil
	end
	engine.env:GameFrame(frame)
	return table.concat(engine.fired, ",")
end

--- A unit of `def` standing at x, z on a team.
local function standing(engine, def, team, x, z)
	local unitID = engine.spawn(def, team)
	engine.move(unitID, x, z)
	return unitID
end

--------------------------------------------------------------------------------
-- What is inside a box, and what is inside a circle.
--------------------------------------------------------------------------------

local engine = playing({
	watching("in-yard", { zone = "yard" }),
	watching("in-backwards", { zone = "backwards" }),
	watching("in-well", { zone = "well" }),
})

local held = tick(engine, 15)
check("an empty zone holds nothing", held == "", held)

local walker = standing(engine, "armpw", 0, 100, 100)
held = tick(engine, 30)
check("a unit inside a box is in it", held == "in-yard,in-backwards", held)
check("and outside a circle is not in that", held:find("in%-well") == nil, held)

engine.move(walker, 30, 40)
held = tick(engine, 45)
check("a unit inside every zone is in all of them", held == "in-yard,in-backwards,in-well", held)

engine.move(walker, -100, -100)
held = tick(engine, 60)
check("a unit outside every zone is in none", held == "", held)

--------------------------------------------------------------------------------
-- The boundary counts as inside, the way the engine's own queries have it.
--------------------------------------------------------------------------------

engine.move(walker, 200, 200)
held = tick(engine, 75)
check("a unit on a box corner is inside it", held == "in-yard,in-backwards", held)
check("a box drawn with its corners the wrong way round is the same box",
	held:find("in%-backwards") ~= nil, held)

engine.move(walker, 200.5, 200)
held = tick(engine, 90)
check("a unit just past a box corner is outside it", held == "", held)

engine.move(walker, -50, 0)
held = tick(engine, 105)
check("a unit on a circle's edge is inside it", held == "in-well", held)

engine.move(walker, -50.5, 0)
held = tick(engine, 120)
check("a unit just past a circle's edge is outside it", held == "", held)

engine.move(walker, -30, -40)
held = tick(engine, 135)
check("a circle measures distance rather than a bounding box", held == "in-well",
	"3-4-5 sits exactly on a radius of 50, and " .. held)

engine.move(walker, -36, -36)
held = tick(engine, 150)
check("so a corner of that bounding box is outside the circle", held == "", held)

--------------------------------------------------------------------------------
-- What units_in_zone counts.
--------------------------------------------------------------------------------

engine = playing({
	watching("anyone", { zone = "yard" }),
	watching("mine", { zone = "yard", team = "player" }),
	watching("theirs", { zone = "yard", team = "enemy" }),
	watching("a-crowd", { zone = "yard", min = 3 }),
	watching("clear", { zone = "yard", max = 0 }),
	watching("at-most-one", { zone = "yard", max = 1 }),
	watching("tanks", { zone = "yard", unitDefs = { "armpw", "armham" } }),
	watching("two-tanks", { zone = "yard", team = "player", unitDefs = { "armpw" }, min = 2 }),
})

held = tick(engine, 15)
check("an empty zone is clear and holds nobody", held == "clear,at-most-one", held)

standing(engine, "armck", 0, 10, 10)
held = tick(engine, 30)
check("a condition naming no count at all means at least one", held == "anyone,mine,at-most-one", held)
check("a condition naming a team counts only that team's units", held:find("theirs") == nil, held)
check("a maximum of none is how a mission asks whether a zone is clear", held:find("clear") == nil, held)
check("a condition naming unit defs counts only those", held:find("tanks") == nil,
	"a builder is not one of the named defs, and " .. held)

standing(engine, "armpw", 1, 20, 20)
held = tick(engine, 45)
check("a unit of another team is counted by a condition naming no team",
	held == "anyone,mine,theirs,tanks", held)
check("a maximum stops holding once the zone is fuller than it", held:find("at%-most%-one") == nil, held)

standing(engine, "armpw", 0, 30, 30)
held = tick(engine, 60)
check("a minimum holds once the zone is at least that full",
	held == "anyone,mine,theirs,a-crowd,tanks", held)
check("a minimum over a team's named defs counts only those",
	held:find("two%-tanks") == nil, "two peewees are in the yard but only one is the player's")

standing(engine, "armpw", 0, 40, 40)
held = tick(engine, 75)
check("and holds once enough of them are there",
	held == "anyone,mine,theirs,a-crowd,tanks,two-tanks", held)

--------------------------------------------------------------------------------
-- Zones and teams a mission does not have.
--------------------------------------------------------------------------------

engine = playing({
	watching("nowhere", { zone = "atlantis" }),
	watching("nobody", { zone = "yard", team = "martians" }),
	watching("never", { zone = "atlantis", team = "player", seconds = 1 }, "zone_held_for"),
})

standing(engine, "armpw", 0, 10, 10)
held = tick(engine, 15)
check("a condition naming a zone that does not exist never holds", held:find("nowhere") == nil, held)
check("and says so", logged(engine, "no zone named atlantis"))
check("a condition naming a team that does not exist never holds", held:find("nobody") == nil, held)
check("and says so", logged(engine, "no team named martians"))

held = tick(engine, 30)
check("a hold on a zone that does not exist is never sampled and never holds", held == "", held)

--------------------------------------------------------------------------------
-- Holding a zone.
--
-- A second is 30 frames and the tick is every 15, so a hold is provable frame by
-- frame rather than by counting how often a condition happened to be asked.
--------------------------------------------------------------------------------

engine = playing({
	watching("held", { zone = "yard", team = "player", seconds = 1 }, "zone_held_for"),
	watching("held-now", { zone = "yard", team = "player", seconds = 0 }, "zone_held_for"),
})

held = tick(engine, 15)
check("an empty zone is held by nobody", held == "", held)

local holder = standing(engine, "armpw", 0, 100, 100)
held = tick(engine, 30)
check("a zone entered this tick has been held for no time at all", held == "held-now", held)

held = tick(engine, 45)
check("a hold shorter than the condition asks does not hold", held == "held-now", "half a second in")

held = tick(engine, 60)
check("a hold as long as the condition asks does", held == "held,held-now", held)

held = tick(engine, 75)
check("and keeps holding while the team stays", held == "held,held-now", held)

engine.move(holder, 500, 500)
held = tick(engine, 90)
check("leaving the zone ends the hold", held == "", held)

engine.move(holder, 100, 100)
held = tick(engine, 105)
check("coming back starts the clock again rather than carrying on", held == "held-now", held)

held = tick(engine, 120)
check("so half a second back in is still short", held == "held-now", held)

held = tick(engine, 135)
check("and the full time is served a second time", held == "held,held-now", held)

--------------------------------------------------------------------------------
-- The hold is sampled on the tick, not by the trigger being asked.
--
-- A trigger nothing has armed is never tested. That may not stop the clock, or a
-- hold would measure how often a mission happened to look rather than how long a
-- team stayed.
--------------------------------------------------------------------------------

engine = playing({
	{
		id = "gate",
		enabled = true,
		["repeat"] = false,
		conditions = { op = "all", conditions = { { type = "time_elapsed", params = { seconds = 1 } } } },
		actions = { { type = "enable_trigger", params = { trigger = "late" } } },
	},
	{
		id = "late",
		enabled = false,
		["repeat"] = true,
		conditions = {
			op = "all",
			conditions = { { type = "zone_held_for", params = { zone = "yard", team = "player", seconds = 1 } } },
		},
		actions = { { type = "probe", params = { mark = "late" } } },
	},
})

standing(engine, "armpw", 0, 100, 100)
held = tick(engine, 15)
check("a trigger nothing has armed fires nothing", held == "", held)

held = tick(engine, 30)
check("and arming it does not fire it on its own", held == "", "the gate arms it on this tick")

held = tick(engine, 45)
check("a hold that began before its trigger was armed counts", held == "late",
	"held since frame 15, armed at frame 30, one second up at frame 45")

support.report()
