-- Proves what unit_count counts for a team: all of its units, only the types
-- `unitDefs` names, and never the types `exceptDefs` names (issue #5293). The
-- group variant is in group_test.lua. Run it with:
--
--   luajit lua/mission-runtime/tests/unit_condition_test.lua
--
-- This directory is not part of the runtime a game vendors. Only luarules/,
-- luaui/ and missions/ are installed into a game.

local support = dofile((arg[0]:match("^(.*)/[^/]+$") or ".") .. "/support.lua")
local check, load = support.check, support.load
local missionFiles, compiled = support.missionFiles, support.compiled

--- A repeating trigger that holds only while the team's count is exactly
-- `count`, so a count that is too high or too low both show.
local function counting(id, count, params)
	params.team, params.min, params.max = "player", count, count
	return {
		id = id,
		enabled = true,
		["repeat"] = true,
		conditions = { op = "all", conditions = { { type = "unit_count", params = params } } },
		actions = { { type = "probe", params = { mark = id } } },
	}
end

local mission = compiled({
	teams = { player = { team = 0 }, enemy = { team = 1 } },
	triggers = {
		counting("all", 6, {}),
		counting("no-walls", 3, { exceptDefs = { "armdrag", "armfort" } }),
		counting("named-twice", 4, { exceptDefs = { "armdrag", "armdrag" } }),
		counting("unknown-except", 6, { exceptDefs = { "nosuchunit" } }),
		counting("empty-except", 6, { exceptDefs = {} }),
		counting("both", 2, { unitDefs = { "armpw", "armdrag" }, exceptDefs = { "armdrag" } }),
		counting("all-excepted", 0, { unitDefs = { "armdrag" }, exceptDefs = { "armdrag" } }),
	},
})

local engine = load({ coilbox_mission = "demo" }, missionFiles(mission), {})
engine.env:Initialize()
engine.env:GameStart()

local fired = {}
engine.GG.CoilboxMission.triggers:addAction("probe", function(params)
	fired[#fired + 1] = params.mark
end)
engine.env:GameFrame(1)

for _, def in ipairs({ "armpw", "armpw", "armck", "armdrag", "armdrag", "armfort" }) do
	engine.spawn(def, 0)
end
engine.spawn("armpw", 1)
engine.env:GameFrame(15)
local read = "," .. table.concat(fired, ",") .. ","

local function has(id)
	return read:find("," .. id .. ",", 1, true) ~= nil
end

check("a unit_count with neither list counts every unit of the team", has("all"), read)
check("exceptDefs leaves those types out of the team's count", has("no-walls"), read)
check("a type listed twice in exceptDefs is taken off once", has("named-twice"), read)
check("a type the game does not have takes nothing off", has("unknown-except"), read)
check("an empty exceptDefs takes nothing off", has("empty-except"), read)
check("with both lists a unit is counted if named by one and not the other", has("both"), read)
check("a type in both lists is not counted", has("all-excepted"), read)

support.report()
