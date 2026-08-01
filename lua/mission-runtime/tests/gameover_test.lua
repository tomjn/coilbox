-- Proves how a mission ends: which ally teams a victory and a defeat declare,
-- that it ends once and nothing runs after it, and that the anchor keeps a team
-- the player has emptied from ending it early. The gadget is loaded under the
-- stub engine, because the Spring.GameOver call is the whole of what a replay
-- says about who won and the anchor is a unit the gadget places. Run it with:
--
--   luajit lua/mission-runtime/tests/gameover_test.lua
--
-- This directory is not part of the runtime a game vendors. Only luarules/,
-- luaui/ and missions/ are installed into a game.

local support = dofile((arg[0]:match("^(.*)/[^/]+$") or ".") .. "/support.lua")
local check, load, logged = support.check, support.load, support.logged
local missionFiles, compiled = support.missionFiles, support.compiled

-- The two participants every mission here has, and the human playing the first.
local TEAMS = { player = { team = 0 }, enemy = { team = 1 } }
local PLAYERS = { [0] = { team = 0 } }

--------------------------------------------------------------------------------
-- Scaffolding.
--------------------------------------------------------------------------------

--- A fire-once trigger that runs `actions` on the first polled tick.
local function once(id, actions)
	return {
		id = id,
		enabled = true,
		["repeat"] = false,
		conditions = { op = "all", conditions = { { type = "time_elapsed", params = { seconds = 0 } } } },
		actions = actions,
	}
end

local function ends(what, team)
	return { type = what, params = { team = team } }
end

--- Start a mission and run to the first playable frame. `overrides` is the
-- compiled mission, `options` the stub engine's.
local function playing(overrides, options)
	overrides.teams = overrides.teams or TEAMS
	options = options or {}
	options.players = options.players == nil and PLAYERS or options.players

	local engine = load({ coilbox_mission = "demo" }, missionFiles(compiled(overrides)), options)
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

--- The winners of the one Spring.GameOver call the mission made, as text.
local function winners(engine)
	if #engine.gameOver ~= 1 then
		return "called " .. #engine.gameOver .. " times"
	end
	return table.concat(engine.gameOver[1], ",")
end

--------------------------------------------------------------------------------
-- Victory: the named participant's ally team is the only winner, which is what
-- makes a replay say the player won.
--------------------------------------------------------------------------------

local engine = playing({ triggers = { once("won", { ends("victory", "player") }) } })
engine.env:GameFrame(15)

check("victory declares the participant's ally team the winner", winners(engine) == "0", winners(engine))
check("and the mission is over", engine.GG.CoilboxMission.gameOver.isOver())

engine = playing({ triggers = { once("won", { ends("victory", "enemy") }) } })
engine.env:GameFrame(15)
check("victory for the other side declares theirs", winners(engine) == "1", winners(engine))

--------------------------------------------------------------------------------
-- Defeat: everyone else wins. A replay says who won and nothing else, so a loss
-- is the player's ally team being absent from that list.
--------------------------------------------------------------------------------

engine = playing({ triggers = { once("lost", { ends("defeat", "player") }) } })
engine.env:GameFrame(15)
check("defeat declares every other ally team the winner", winners(engine) == "1", winners(engine))

engine = playing({ triggers = { once("lost", { ends("defeat", "player") }) } }, {
	allyTeamList = { 0, 1, 2, 3 },
	gaiaTeam = 3,
})
engine.env:GameFrame(15)
check("with everyone else meaning everyone, not just the one enemy",
	winners(engine) == "1,2", winners(engine))
check("and Gaia left out of it, because Gaia is not playing",
	winners(engine):find("3") == nil, winners(engine))

--------------------------------------------------------------------------------
-- A mission ends once.
--------------------------------------------------------------------------------

engine = playing({
	triggers = {
		once("won", { ends("victory", "player"), ends("defeat", "player") }),
	},
})
engine.env:GameFrame(15)

check("a second ending in the same trigger is ignored", #engine.gameOver == 1, #engine.gameOver)
check("the first one is the one that counts", winners(engine) == "0", winners(engine))
check("and the second is reported", logged(engine, "the mission has already ended"))

--------------------------------------------------------------------------------
-- Nothing runs after the end.
--------------------------------------------------------------------------------

local function probing(id)
	return {
		id = id,
		enabled = true,
		["repeat"] = true,
		conditions = { op = "all", conditions = { { type = "time_elapsed", params = { seconds = 0 } } } },
		actions = { { type = "probe", params = { mark = id } } },
	}
end

engine = playing({
	actors = { { id = "scout", unitDef = "grunt", team = "player", pos = { x = 300, z = 300 } } },
	triggers = {
		probing("ticking"),
		once("won", { ends("victory", "player") }),
		{
			id = "on-death",
			enabled = true,
			["repeat"] = true,
			conditions = { op = "all", conditions = { { type = "unit_dead", params = { actor = "scout" } } } },
			actions = { { type = "probe", params = { mark = "on-death" } } },
		},
	},
})

engine.env:GameFrame(15)
check("a trigger listed before the one that ends the mission still fires on that tick",
	table.concat(engine.fired, ",") == "ticking", table.concat(engine.fired, ","))

engine.fired[1] = nil
engine.env:GameFrame(30)
check("and nothing is evaluated on the tick after the mission ended",
	next(engine.fired) == nil, table.concat(engine.fired, ","))

engine.env.Spring.DestroyUnit(engine.GG.CoilboxMission.units.scout)
check("nor does an event raised after it wake anything",
	next(engine.fired) == nil, table.concat(engine.fired, ","))

--------------------------------------------------------------------------------
-- Which participant an action with no team means.
--------------------------------------------------------------------------------

engine = playing({ triggers = { once("won", { { type = "victory", params = {} } }) } })
engine.env:GameFrame(15)
check("a victory naming no team is the team a human is playing", winners(engine) == "0", winners(engine))

engine = playing({ triggers = { once("won", { { type = "victory", params = {} } }) } },
	{ players = { [0] = { team = 1 }, [1] = { team = 0, spectator = true } } })
engine.env:GameFrame(15)
check("whichever team that is, and a spectator is playing none",
	winners(engine) == "1", winners(engine))

engine = playing({ triggers = { once("won", { { type = "victory", params = {} } }) } }, { players = {} })
engine.env:GameFrame(15)
check("with no human at all it falls back to the lowest engine team, not the first id",
	winners(engine) == "0", winners(engine))
check("and says so", logged(engine, "no human is playing a mission team"))

engine = playing({ triggers = { once("won", { ends("victory", "nobody") }) } })
engine.env:GameFrame(15)
check("a participant the mission does not have ends nothing", #engine.gameOver == 0, #engine.gameOver)
check("and is reported", logged(engine, "no team named nobody in this mission"))

--------------------------------------------------------------------------------
-- The anchor.
--------------------------------------------------------------------------------

local function anchored(overrides, options)
	options = options or {}
	options.inert = options.inert == nil and { wall = true } or options.inert
	options.defs = options.defs == nil and { wall = true, grunt = true } or options.defs
	return playing(overrides, options)
end

engine = anchored({
	actors = { { id = "scout", unitDef = "grunt", team = "player", pos = { x = 300, z = 300 } } },
})

local anchors = {}
for unitID, unit in pairs(engine.units) do
	if unit.def == "wall" then
		anchors[#anchors + 1] = { id = unitID, team = unit.team }
	end
end

check("a mission team a human is playing gets one anchor", #anchors == 1, #anchors)
check("and it is on that team", anchors[1] and anchors[1].team == 0)
check("a team no human is playing gets none",
	engine.env.Spring.GetTeamUnitCount(1) == 0, engine.env.Spring.GetTeamUnitCount(1))

local anchor = anchors[1].id
local damage = { engine.env:UnitPreDamaged(anchor) }
check("an anchor cannot be damaged", damage[1] == 0 and damage[2] == 0)
check("it blocks nothing", engine.blocking[anchor] == false)
check("it is stealthed", engine.stealth[anchor] == true)
check("it sees nothing", (engine.sensors[anchor] or {}).los == 0 and (engine.sensors[anchor] or {}).radar == 0)
check("and it earns nothing", (engine.resourcing[anchor] or {}).umm == 0)

local told = false
for _, message in ipairs(engine.sent) do
	told = told or (message[1] == "coilbox_mission_anchor" and message[2] == anchor)
end
check("the unsynced half is told which unit it is", told)

-- The anchor is placed inside the start window like everything else the runtime
-- puts on the map, so no trigger ever sees it arrive.
engine = anchored({
	triggers = {
		{
			id = "built-something",
			enabled = true,
			["repeat"] = true,
			conditions = {
				op = "all",
				conditions = {
					{ type = "unit_built", params = { team = "player", unitDef = "wall", count = 1 } },
				},
			},
			actions = { { type = "probe", params = { mark = "built-something" } } },
		},
	},
})
engine.env:GameFrame(15)
check("an anchor is not something the team built",
	table.concat(engine.fired, ",") == "", table.concat(engine.fired, ","))

--------------------------------------------------------------------------------
-- The anchor keeps the team from being empty, and the mission's own counting
-- ignores it. Both halves matter: the engine ends a game for a team with
-- nothing left, and a mission asking whether the player has anything left has
-- to get the answer it would have got without an anchor.
--------------------------------------------------------------------------------

engine = anchored({
	actors = { { id = "scout", unitDef = "grunt", team = "player", pos = { x = 300, z = 300 } } },
	zones = {
		{ id = "corner", shape = "box", min = { x = -100, z = -100 }, max = { x = 100, z = 100 } },
	},
	triggers = {
		{
			id = "wiped",
			enabled = true,
			["repeat"] = true,
			conditions = {
				op = "all",
				conditions = { { type = "unit_count", params = { team = "player", max = 0 } } },
			},
			actions = { { type = "probe", params = { mark = "wiped" } } },
		},
		{
			id = "in-corner",
			enabled = true,
			["repeat"] = true,
			conditions = {
				op = "all",
				conditions = { { type = "units_in_zone", params = { team = "player", zone = "corner" } } },
			},
			actions = { { type = "probe", params = { mark = "in-corner" } } },
		},
	},
})

engine.env:GameFrame(15)
check("a team with a unit of its own does not read as wiped",
	table.concat(engine.fired, ",") == "", table.concat(engine.fired, ","))

engine.env.Spring.DestroyUnit(engine.GG.CoilboxMission.units.scout)
engine.env:GameFrame(30)

check("a team whose last unit died reads as wiped",
	table.concat(engine.fired, ",") == "wiped", table.concat(engine.fired, ","))
check("but the engine still counts a unit for it, which is what stops the game ending",
	engine.env.Spring.GetTeamUnitCount(0) == 1, engine.env.Spring.GetTeamUnitCount(0))
check("and an anchor standing in a zone is in no zone as far as the mission is concerned",
	table.concat(engine.fired, ","):find("in%-corner") == nil, table.concat(engine.fired, ","))

--------------------------------------------------------------------------------
-- What happens when there is nothing to anchor with, or the anchor dies.
--------------------------------------------------------------------------------

engine = anchored({}, { inert = {}, defs = { grunt = true } })
check("a game with no def that does nothing gets no anchor",
	engine.env.Spring.GetTeamUnitCount(0) == 0, engine.env.Spring.GetTeamUnitCount(0))
check("and is told what that costs", logged(engine, "no unit def in this game can be a mission anchor"))

engine = anchored({})
local standing = engine.GG.CoilboxMission.gameOver
check("the anchor is counted as one", standing.anchorCount(0) == 1, standing.anchorCount(0))

for unitID, unit in pairs(engine.units) do
	if unit.def == "wall" then
		engine.env.Spring.DestroyUnit(unitID)
	end
end
check("an anchor that died is no longer discounted", standing.anchorCount(0) == 0, standing.anchorCount(0))
check("and losing one is reported", logged(engine, "mission anchor for team 0 was destroyed"))

--------------------------------------------------------------------------------
-- Ending a mission is synced only, like the triggers that end it.
--------------------------------------------------------------------------------

local unsynced = load({ coilbox_mission = "demo" }, missionFiles(compiled({ teams = TEAMS })),
	{ synced = false, players = PLAYERS })
unsynced.env:Initialize()
check("the unsynced half ends nothing", unsynced.GG.CoilboxMission.gameOver == nil)
check("and declares no game over", #unsynced.gameOver == 0)

support.report()
