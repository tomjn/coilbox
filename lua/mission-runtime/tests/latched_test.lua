-- Proves a condition marked `latched = true`: once it has held it counts as
-- holding from then on (issue #5296). The mission is the one the option exists
-- for, "visit both ridges, in any order", played through the gadget under the
-- stub engine, with a `/luarules reload` between the two visits. The finer rules
-- are the trigger engine's and are in trigger_test.lua. Run it with:
--
--   luajit lua/mission-runtime/tests/latched_test.lua
--
-- This directory is not part of the runtime a game vendors. Only luarules/,
-- luaui/ and missions/ are installed into a game.

local support = dofile((arg[0]:match("^(.*)/[^/]+$") or ".") .. "/support.lua")
local check, load = support.check, support.load
local missionFiles, compiled = support.missionFiles, support.compiled

local function visited(zone)
	return { type = "units_in_zone", params = { zone = zone }, latched = true }
end

local MISSION = compiled({
	teams = { player = { team = 0 }, enemy = { team = 1 } },
	zones = {
		{ id = "east", name = "East ridge", shape = "box", min = { x = 800, z = 0 }, max = { x = 1000, z = 200 } },
		{ id = "west", name = "West ridge", shape = "box", min = { x = 0, z = 0 }, max = { x = 200, z = 200 } },
	},
	vars = { scouted = 0 },
	triggers = {
		{
			id = "both",
			enabled = true,
			["repeat"] = false,
			conditions = { op = "all", conditions = { visited("east"), visited("west") } },
			actions = { { type = "add_var", params = { name = "scouted", value = 1 } } },
		},
	},
})

local OPTIONS = { defList = { { name = "marker", speed = 0, weapons = {} }, { name = "grunt" } } }

local function started(options)
	local engine = load({ coilbox_mission = "demo" }, missionFiles(MISSION), options or OPTIONS)
	engine.env:Initialize()
	return engine
end

--- Move the scout to `x` and run polled ticks up to `frame`.
local function goTo(engine, scout, x, from, frame)
	engine.move(scout, x, 100)
	for f = from, frame do
		engine.env:GameFrame(f)
	end
end

local function scouted(engine)
	return engine.GG.CoilboxMission.vars.get("scouted")
end

local AWAY, EAST, WEST = 500, 900, 100

for _, order in ipairs({ { "east", EAST, "west", WEST }, { "west", WEST, "east", EAST } }) do
	local firstName, first, secondName, second = unpack(order)

	local engine = started()
	engine.env:GameStart()
	local scout = engine.spawn("grunt", 0)

	goTo(engine, scout, first, 1, 15)
	check("one ridge visited is not both: " .. firstName, scouted(engine) == 0, scouted(engine))
	goTo(engine, scout, AWAY, 16, 30)
	goTo(engine, scout, second, 31, 45)
	check("it completes at " .. secondName .. " after " .. firstName .. " was left",
		scouted(engine) == 1, scouted(engine))

	-- The same, with the gadget loaded again between the two visits.
	engine = started()
	engine.env:GameStart()
	scout = engine.spawn("grunt", 0)
	goTo(engine, scout, first, 1, 15)
	goTo(engine, scout, AWAY, 16, 30)

	local after = started({ defList = OPTIONS.defList, frame = 30, survivors = engine })
	goTo(after, scout, AWAY, 31, 45)
	check("a reload alone completes nothing: " .. firstName .. " first", scouted(after) == 0, scouted(after))
	goTo(after, scout, second, 46, 60)
	check("the visit to " .. firstName .. " is remembered across a reload", scouted(after) == 1, scouted(after))
end

support.report()
