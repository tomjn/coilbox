-- Proves what a compiled mission asks for at game start, before any of it
-- reaches the engine. The module under test is pure, so this needs no stubs at
-- all. Run it with:
--
--   luajit lua/mission-runtime/tests/plan_test.lua
--
-- This directory is not part of the runtime a game vendors. Only luarules/,
-- luaui/ and missions/ are installed into a game.

local support = dofile((arg[0]:match("^(.*)/[^/]+$") or ".") .. "/support.lua")
local check = support.check

local START = dofile(support.root() .. "/luarules/mission_runtime/coilbox_start.lua")

--- The ids of a team plan, in the order the plan holds them.
local function ids(plan)
	local out = {}
	for _, team in ipairs(plan) do
		out[#out + 1] = team.id
	end
	return table.concat(out, ",")
end

local function field(plan, id, name)
	for _, team in ipairs(plan) do
		if team.id == id then
			return team[name]
		end
	end
end

--------------------------------------------------------------------------------
-- The team plan.
--------------------------------------------------------------------------------

local plan, problems = START.teamPlan({
	teams = {
		player = {
			team = 0,
			resources = { metal = 500 },
			income = { energy = 12 },
			startUnits = { "armcom" },
		},
		enemy = { team = 1, noCommander = true },
		watcher = {},
	},
})

check("teams come out in participant id order", ids(plan) == "enemy,player", ids(plan))
check("a team with no engine number is dropped", #plan == 2)
check("a team with no engine number is reported",
	(problems[1] or ""):find("watcher", 1, true) ~= nil, problems[1])

check("a team keeps its engine number", field(plan, "player", "team") == 0)
check("stated resources survive", field(plan, "player", "metal") == 500)
check("an unstated bank is nothing, not the skirmish default",
	field(plan, "player", "energy") == 0)
check("stated income survives", field(plan, "player", "energyIncome") == 12)
check("unstated income is nothing", field(plan, "player", "metalIncome") == 0)
check("start units survive", field(plan, "player", "startUnits")[1] == "armcom")
check("no start units is an empty list", #field(plan, "enemy", "startUnits") == 0)
check("noCommander is off unless the scenario says so", field(plan, "player", "noCommander") == false)
check("noCommander is on when the scenario says so", field(plan, "enemy", "noCommander") == true)

check("a mission with no teams plans nothing", #START.teamPlan({}) == 0)

--------------------------------------------------------------------------------
-- Where a team's start units go.
--------------------------------------------------------------------------------

local one = START.gridOffsets(1, 64)
check("a single start unit lands on the start position", one[1].x == 0 and one[1].z == 0)

local four = START.gridOffsets(4, 64)
check("four start units make a square", #four == 4)
check("the square is centred on the start position",
	four[1].x == -32 and four[1].z == -32 and four[4].x == 32 and four[4].z == 32,
	string.format("%g,%g .. %g,%g", four[1].x, four[1].z, four[4].x, four[4].z))

local three = START.gridOffsets(3, 64)
check("a partial grid still fits the same square", #three == 3 and three[3].x == -32)

--------------------------------------------------------------------------------
-- Placements.
--------------------------------------------------------------------------------

local mission = {
	teams = {
		player = { team = 0, startUnits = { "armpw", "armpw" } },
		enemy = { team = 1 },
	},
	actors = {
		{ id = "boss", unitDef = "corkrog", team = "enemy", pos = { x = 100, z = 200 }, facing = 2 },
		{ id = "hero", unitDef = "armcom", team = "player", pos = { x = 10, z = 20 } },
		{ id = "ghost", unitDef = "armpw", team = "nobody", pos = { x = 0, z = 0 } },
	},
}

plan = START.teamPlan(mission)
local placements
placements, problems = START.placements(mission, plan, { [0] = { x = 1000, z = 2000 } })

check("an actor becomes a placement", placements[1].actor == "boss")
check("an actor's participant id becomes an engine team", placements[1].team == 1)
check("an actor keeps its facing", placements[1].facing == 2)
check("an actor with no facing gets the engine's first", placements[2].facing == 0)
check("an actor keeps its position", placements[1].x == 100 and placements[1].z == 200)
check("an actor on an unknown team is dropped", #placements == 4, #placements .. " placements")
check("an actor on an unknown team is reported",
	(problems[1] or ""):find("ghost", 1, true) ~= nil, problems[1])

check("start units follow the actors", placements[3].unitDef == "armpw")
check("start units belong to their team", placements[3].team == 0)
check("start units sit around the team start position",
	placements[3].x == 968 and placements[4].x == 1032,
	string.format("%g and %g", placements[3].x, placements[4].x))
check("a start unit is not an actor", placements[3].actor == nil)

placements, problems = START.placements(mission, plan, {})
check("start units with no start position are left unplaced", #placements == 2)
check("start units with no start position are reported",
	(problems[2] or ""):find("no start position", 1, true) ~= nil, problems[2])

support.report()
