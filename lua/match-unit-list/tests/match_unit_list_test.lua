-- Tests for the match unit list Lua: the stand-in for the engine's team and
-- option functions, and the engine's rules for refusing a unit definition.
--
-- Run with: luajit lua/match-unit-list/tests/match_unit_list_test.lua
--
-- The file under test is spliced into a larger chunk by the unitsync worker,
-- after one line that defines `__cb_match`. This does the same: a chunk made of
-- that line, the file, and a return of what the file defines.

local failures = 0

local function check(name, ok, detail)
	if ok then
		print("ok   " .. name)
	else
		failures = failures + 1
		print("FAIL " .. name .. (detail and (": " .. tostring(detail)) or ""))
	end
end

local function eq(name, got, want)
	check(name, got == want, "got " .. tostring(got) .. ", wanted " .. tostring(want))
end

local root = arg[0]:match("^(.*)/tests/[^/]+$") or "."
local file = assert(io.open(root .. "/match_unit_list.lua"))
local source = file:read("*a")
file:close()

--- Load the file with `match` as its setup, in an environment whose `Spring`
--- holds only what the caller puts there. Returns the environment's `Spring`
--- and the refusal function.
local function load(match, spring)
	local env = setmetatable({ Spring = spring or {} }, { __index = _G })
	env.__setup = match
	local chunk = assert(loadstring("local __cb_match = __setup\n" .. source .. "\nreturn __cb_engine_keeps"))
	setfenv(chunk, env)
	return env.Spring, chunk()
end

--- A match of two humans on one ally team against a Lua AI on another, with a
--- spectator, as the worker writes it: Gaia last, allied with nobody.
local function a_match()
	return {
		modOptions = { experimentallegionfaction = "1", maxunits = "2000" },
		mapOptions = { waterlevel = "3" },
		teams = {
			{ leader = 0, ally = 0, side = "armada", income = 1, custom = {} },
			{ leader = 1, ally = 0, side = "cortex", income = 1, custom = {} },
			{ leader = 0, ally = 1, side = "", income = 1.5, custom = { raptorstartbox = "1" } },
			{ leader = -1, ally = 2, side = "", income = 1, custom = {} },
		},
		allies = {
			{ true, false, false },
			{ false, true, false },
			{ false, false, true },
		},
		allyCustom = { { numallies = "0" }, { numallies = "0" }, {} },
		players = {
			{ team = 0, spectator = false },
			{ team = 1, spectator = false },
			{ team = 0, spectator = true },
		},
		ais = { { team = 2, name = "Raptors", host = 0, lua = "RaptorsAI" } },
		gaia = 3,
	}
end

local function list(t)
	if t == nil then return "nil" end
	return table.concat(t, ",")
end

-- With no setup nothing is installed, so the worker's own stand-in answers.
do
	local spring = load(nil)
	eq("no setup installs no function", next(spring), nil)
end

-- Options.
do
	local spring = load(a_match())
	local options = spring.GetModOptions()
	eq("mod options are the script's", options.experimentallegionfaction, "1")
	options.maxunits = "1"
	eq("each call gives a new table", spring.GetModOptions().maxunits, "2000")
	eq("one mod option by key", spring.GetModOption("maxunits"), "2000")
	eq("a mod option that is not set gives no value", select("#", spring.GetModOption("nope")), 0)
	eq("map options are the script's", spring.GetMapOptions().waterlevel, "3")
	eq("one map option by key", spring.GetMapOption("waterlevel"), "3")
	check("a key that is not a string raises", not pcall(spring.GetModOption, {}))
end

-- Teams and ally teams.
do
	local spring = load(a_match())
	eq("gaia is the last team", spring.GetGaiaTeamID(), 3)
	eq("every ally team, gaia's too", list(spring.GetAllyTeamList()), "0,1,2")
	eq("every team, gaia too", list(spring.GetTeamList()), "0,1,2,3")
	eq("the teams of one ally team", list(spring.GetTeamList(0)), "0,1")
	eq("gaia's ally team holds gaia", list(spring.GetTeamList(2)), "3")
	eq("an ally team that does not exist gives no value", select("#", spring.GetTeamList(9)), 0)
	eq("so does -1, as the engine's code has it", select("#", spring.GetTeamList(-1)), 0)
	check("an argument that is not a number raises", not pcall(spring.GetTeamList, nil))

	local id, leader, dead, has_ai, side, ally, income, custom = spring.GetTeamInfo(2)
	eq("team info: id", id, 2)
	eq("team info: leader", leader, 0)
	eq("team info: not dead while loading", dead, false)
	eq("team info: has an AI", has_ai, true)
	eq("team info: side", side, "")
	eq("team info: ally team", ally, 1)
	eq("team info: income", income, 1.5)
	eq("team info: custom keys", custom.raptorstartbox, "1")
	eq("team info without the keys has seven values", select("#", spring.GetTeamInfo(0, false)), 7)
	eq("a human team has no AI", select(4, spring.GetTeamInfo(0, false)), false)
	eq("gaia's ally team", select(6, spring.GetTeamInfo(spring.GetGaiaTeamID(), false)), 2)
	eq("a team that does not exist gives no value", select("#", spring.GetTeamInfo(9)), 0)

	eq("a team's ally team", spring.GetTeamAllyTeamID(1), 0)
	eq("teams on one ally team are allied", spring.AreTeamsAllied(0, 1), true)
	eq("teams on two are not", spring.AreTeamsAllied(0, 2), false)
	eq("nobody is allied with gaia", spring.AreTeamsAllied(0, 3), false)
	eq("gaia is allied with itself", spring.AreTeamsAllied(3, 3), true)
	eq("a team that does not exist gives no value", select("#", spring.AreTeamsAllied(0, 9)), 0)
	eq("ally team custom keys", spring.GetAllyTeamInfo(0).numallies, "0")
	eq("an ally team that does not exist gives no value", select("#", spring.GetAllyTeamInfo(9)), 0)
end

-- Players.
do
	local spring = load(a_match())
	eq("every player, spectators too", list(spring.GetPlayerList()), "0,1,2")
	eq("a team's players leave spectators out", list(spring.GetPlayerList(0)), "0")
	eq("an AI team has no players", list(spring.GetPlayerList(2)), "")
	eq("no player is active while loading", list(spring.GetPlayerList(0, true)), "")
	eq("active first, then the team", list(spring.GetPlayerList(true, 0)), "")
	eq("a team past the last gives no value", select("#", spring.GetPlayerList(4)), 0)
	eq("two players on one ally team are allied", spring.ArePlayersAllied(0, 1), true)
	eq("a player that does not exist gives no value", select("#", spring.ArePlayersAllied(0, 9)), 0)
end

-- AIs.
do
	local spring = load(a_match())
	eq("the Lua AI's short name", spring.GetTeamLuaAI(2), "RaptorsAI")
	eq("a human team has none", select("#", spring.GetTeamLuaAI(0)), 0)
	check("a team that does not exist raises", not pcall(spring.GetTeamLuaAI, 9))
	local id, name, host, short, version, options = spring.GetAIInfo(2)
	eq("AI info: id", id, 0)
	eq("AI info: name", name, "Raptors")
	eq("AI info: host", host, 0)
	eq("AI info: the short name is the synced placeholder", short, "SYNCED_NOSHORTNAME")
	eq("AI info: so is the version", version, "SYNCED_NOVERSION")
	eq("AI info: no options", next(options), nil)
	eq("a team with no AI gives no value", select("#", spring.GetAIInfo(0)), 0)

	local native = a_match()
	native.ais[1].lua = false
	local other = load(native)
	eq("an AI the game's LuaAI.lua does not list is no Lua AI", select("#", other.GetTeamLuaAI(2)), 0)
	eq("it still counts as an AI on the team", select(4, other.GetTeamInfo(2, false)), true)
end

-- A match with no Gaia.
do
	local match = a_match()
	match.teams[4] = nil
	match.allies = { { true, false }, { false, true } }
	match.allyCustom[3] = nil
	match.gaia = false
	local spring = load(match)
	eq("no gaia gives no value", select("#", spring.GetGaiaTeamID()), 0)
	eq("and one team fewer", list(spring.GetTeamList()), "0,1,2")
end

-- A game that adds units for a kind of AI team, the way Beyond All Reason's
-- definitions decide it: walk the ally teams that are not Gaia's, and look for
-- a team whose Lua AI name contains a word. Written from reading that game's
-- common/springutilities/teamfunctions.lua in test-30922. It has not been run
-- against an engine.
do
	local function kinds(spring)
		local gaia_ally = select(6, spring.GetTeamInfo(spring.GetGaiaTeamID(), false))
		local raptors, scavengers, players = false, false, 0
		for _, ally in ipairs(spring.GetAllyTeamList()) do
			local teams = spring.GetTeamList(ally) or {}
			if #teams > 0 and ally ~= gaia_ally then
				for _, team in ipairs(teams) do
					if not select(4, spring.GetTeamInfo(team, false)) then
						players = players + #spring.GetPlayerList(team)
					end
					local ai = spring.GetTeamLuaAI(team)
					if ai and ai:find("Raptors") then raptors = true end
					if ai and ai:find("Scavengers") then scavengers = true end
				end
			end
		end
		return raptors, scavengers, players
	end

	local raptors, scavengers, players = kinds(load(a_match()))
	eq("a Raptors AI is found", raptors, true)
	eq("no Scavengers AI is", scavengers, false)
	eq("the humans are counted", players, 2)

	local match = a_match()
	match.ais[1].lua = "ScavengersAI"
	raptors, scavengers = kinds(load(match))
	eq("a Scavengers AI is found", scavengers, true)
	eq("and no Raptors AI", raptors, false)

	match.ais[1].lua = false
	raptors, scavengers = kinds(load(match))
	eq("a native AI is neither", raptors or scavengers, false)
end

-- The engine's refusal rules.
do
	local _, keeps = load(nil)
	local moves = { { name = "TANK2" }, { Name = "kbot1" }, "not a table", { name = "never read" } }

	local function kept(units, movedefs)
		local table_, order = keeps({ movedefs = movedefs or moves }, units)
		return table.concat(order, ","), table_
	end

	eq("a plain building is kept", kept({ solar = { health = 100 } }), "solar")
	eq("keys are sorted", kept({ b = {}, a = {}, c = {} }), "a,b,c")
	eq("keys are lowercased", kept({ ArmCom = {}, armack = {} }), "armack,armcom")
	eq("a key that is not a string takes no id", kept({ a = {}, [1] = {} }), "a")
	eq("a definition that is not a table is every default", kept({ a = "text" }), "a")

	eq("health of zero", kept({ a = { health = 0 }, b = {} }), "b")
	eq("health below zero, under the old name", kept({ a = { maxDamage = -5 }, b = {} }), "b")
	eq("the new name wins over the old", kept({ a = { health = 10, maxdamage = 0 } }), "a")
	eq("a negative metal cost", kept({ a = { metalCost = -1 }, b = {} }), "b")
	eq("a metal cost of zero is kept", kept({ a = { metalcost = 0 } }), "a")
	eq("a negative metal cost, old name", kept({ a = { buildCostMetal = -1 } }), "")
	eq("a negative energy cost", kept({ a = { energyCost = -1 } }), "")
	eq("a negative energy cost, old name", kept({ a = { buildCostEnergy = -1 } }), "")
	eq("a build time of zero", kept({ a = { buildTime = 0 } }), "")
	eq("a negative speed", kept({ a = { speed = -1 } }), "")
	eq("the old speed is made positive", kept({ a = { maxVelocity = -1 } }), "a")
	eq("a negative reverse speed", kept({ a = { rSpeed = -1 } }), "")
	eq("a negative acceleration", kept({ a = { maxAcc = -1 } }), "")
	eq("a negative acceleration, old name", kept({ a = { acceleration = -1 } }), "")
	eq("a negative brake rate", kept({ a = { maxDec = -1 } }), "")
	eq("a negative brake rate, old name", kept({ a = { brakeRate = -1 } }), "")
	eq("the brake rate defaults to the acceleration", kept({ a = { acceleration = 2 } }), "a")

	eq("a number written as text counts", kept({ a = { health = "0" } }), "")
	eq("text that is no number reads as zero", kept({ a = { health = "lots" } }), "")
	eq("a boolean where a number goes is the default", kept({ a = { health = false } }), "a")

	local mover = function(class, extra)
		local def = { canMove = true, speed = 30, movementClass = class }
		for k, v in pairs(extra or {}) do def[k] = v end
		return def
	end
	eq("a mover with a class the game defines", kept({ a = mover("tank2") }), "a")
	eq("the class is matched without regard to case", kept({ a = mover("KBOT1") }), "a")
	eq("a mover with a class it does not", kept({ a = mover("smallboat"), b = {} }), "b")
	eq("a mover with no class at all", kept({ a = mover(nil) }), "")
	eq("the list stops at the first entry that is not a table", kept({ a = mover("never read") }), "")
	eq("an aircraft needs no class", kept({ a = mover("smallboat", { canFly = true }) }), "a")
	eq("nor does a unit that cannot move", kept({ a = mover("smallboat", { canMove = false }) }), "a")
	eq("nor one with no speed", kept({ a = mover("smallboat", { speed = 0 }) }), "a")
	eq("canMove written as text", kept({ a = mover("smallboat", { canMove = "false" }) }), "a")
	eq("the old speed counts as speed", kept({ a = { canmove = 1, maxvelocity = 1, movementclass = "nope" } }), "")
	eq("a game with no movement classes", kept({ a = mover("tank2") }, "none"), "")

	local _, table_ = kept({ ArmCom = { health = 5 } })
	eq("the kept table is keyed in lower case", table_.armcom.health, 5)

	-- A refused definition takes no id, so the next one moves up.
	local order = select(2, keeps({ movedefs = moves }, {
		a = {},
		b = mover("smallboat"),
		c = {},
	}))
	eq("the definition after a refused one takes its place", order[2], "c")
end

if failures > 0 then
	print(failures .. " failed")
	os.exit(1)
end
print("all passed")
