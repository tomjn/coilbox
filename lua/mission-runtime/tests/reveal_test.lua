-- Proves what reveal_area does: that it puts a spotter over the zone with sight
-- enough to cover it, that the spotter is invisible and inert everywhere else,
-- that the reveal ends when the author said, and that the mission's own counting
-- never sees the unit doing it. The gadget is loaded under the stub engine
-- because a reveal is a unit the gadget places. Run it with:
--
--   luajit lua/mission-runtime/tests/reveal_test.lua
--
-- This directory is not part of the runtime a game vendors. Only luarules/,
-- luaui/ and missions/ are installed into a game.

local support = dofile((arg[0]:match("^(.*)/[^/]+$") or ".") .. "/support.lua")
local check, load, logged = support.check, support.load, support.logged
local missionFiles, compiled = support.missionFiles, support.compiled

-- The two participants every mission here has, and the human playing the first.
local TEAMS = { player = { team = 0 }, enemy = { team = 1 } }
local PLAYERS = { [0] = { team = 0 } }

-- A game whose first def does nothing at all, which is what a spotter is built
-- from, and two that do the things that rule a def out.
local DEFS = {
	{ name = "turret", speed = 0 },
	{ name = "wall", speed = 0, weapons = {} },
	{ name = "grunt" },
}

-- The zone every reveal here names, and a box one for the geometry.
local ZONES = {
	{ id = "depot", shape = "circle", center = { x = 500, z = 600 }, radius = 200 },
	{ id = "yard", shape = "box", min = { x = 0, z = 0 }, max = { x = 300, z = 400 } },
	{ id = "hut", shape = "circle", center = { x = 900, z = 900 }, radius = 10 },
}

local HIDDEN_MESSAGE = "coilbox_mission_hidden"
-- What the runtime will not ask for less sight than.
local MIN_RADIUS = 64

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

local function reveals(params)
	return { type = "reveal_area", params = params }
end

--- Start a mission and run to the first playable frame.
local function playing(overrides, options)
	overrides.teams = overrides.teams or TEAMS
	overrides.zones = overrides.zones == nil and ZONES or overrides.zones
	options = options or {}
	options.players = options.players == nil and PLAYERS or options.players
	options.defList = options.defList == nil and DEFS or options.defList

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

--- The spotters standing, as { id = , unit = }. Read off the runtime's own roll
-- rather than off the def, because the team a human plays is anchored with the
-- same def and the anchor is not a reveal.
local function spotters(engine)
	local reveal = engine.GG.CoilboxMission.reveal
	local found = {}
	for _, unitID in ipairs(engine.order) do
		local unit = engine.units[unitID]
		if unit.alive and reveal.isSpotter(unitID) then
			found[#found + 1] = { id = unitID, unit = unit }
		end
	end
	return found
end

local function only(engine)
	local found = spotters(engine)
	return found[1] and found[1].id, found[1] and found[1].unit, #found
end

--- Run the game on to `frame`, ticking every frame the way the engine does.
local function playTo(engine, from, frame)
	for at = from, frame do
		engine.env:GameFrame(at)
	end
	return frame
end

--------------------------------------------------------------------------------
-- Lighting a circle.
--------------------------------------------------------------------------------

local engine = playing({ triggers = { once("look", { reveals({ zone = "depot", team = "player" }) }) } })
engine.env:GameFrame(15)

local unitID, unit, count = only(engine)
check("a reveal puts one unit on the map", count == 1, tostring(count))
check("in the middle of the zone", unit and unit.x == 500 and unit.z == 600,
	unit and (unit.x .. "/" .. unit.z))
check("on the team the action named", unit and unit.team == 0, unit and unit.team)
check("seeing as far as the zone reaches",
	(engine.sensors[unitID] or {}).los == 200, tostring((engine.sensors[unitID] or {}).los))
check("and finding aircraft over it too, which is a sight map of its own",
	(engine.sensors[unitID] or {}).airLos == 200)
check("while seeing nothing on radar, which would reach past the zone",
	(engine.sensors[unitID] or {}).radar == 0)

--------------------------------------------------------------------------------
-- What a spotter is not allowed to be. It stands in someone else's base, so
-- everything about it that could reach the mission is taken off.
--------------------------------------------------------------------------------

local damage = { engine.env:UnitPreDamaged(unitID) }
check("a spotter cannot be damaged", damage[1] == 0 and damage[2] == 0)
check("it blocks nothing", engine.blocking[unitID] == false)
check("nothing sees it on radar", engine.stealth[unitID] == true)
check("or on sonar", engine.sonarStealth[unitID] == true)
check("and it earns nothing", (engine.resourcing[unitID] or {}).umm == 0)

local told = false
for _, message in ipairs(engine.sent) do
	told = told or (message[1] == HIDDEN_MESSAGE and message[2] == unitID)
end
check("the unsynced half is told to take it off the screen", told)

check("the ally team it belongs to is left alone, because that is the one meant "
	.. "to see the zone", (engine.losMask[unitID] or {})[0] == nil)
check("every other ally team stops being updated about it",
	(engine.losMask[unitID] or {})[1] ~= nil)
check("and is left seeing nothing of it, so nobody spends the mission shooting "
	.. "at an invulnerable box", (engine.losState[unitID] or {})[1] == 0)

--------------------------------------------------------------------------------
-- Lighting a box, which the engine can only do with a circle.
--------------------------------------------------------------------------------

engine = playing({ triggers = { once("look", { reveals({ zone = "yard", team = "player" }) }) } })
engine.env:GameFrame(15)

unitID, unit = only(engine)
check("a box is lit from its middle", unit and unit.x == 150 and unit.z == 200,
	unit and (unit.x .. "/" .. unit.z))
check("with the circle that reaches its corners, because a smaller one would "
	.. "leave what the author drew the box around in the dark",
	(engine.sensors[unitID] or {}).los == 250, tostring((engine.sensors[unitID] or {}).los))

engine = playing({ triggers = { once("look", { reveals({ zone = "hut", team = "player" }) }) } })
engine.env:GameFrame(15)
unitID = only(engine)
check("a zone smaller than the engine's sight map still lights something",
	(engine.sensors[unitID] or {}).los == MIN_RADIUS, tostring((engine.sensors[unitID] or {}).los))

--------------------------------------------------------------------------------
-- How long a reveal lasts.
--------------------------------------------------------------------------------

engine = playing({
	triggers = { once("look", { reveals({ zone = "depot", team = "player", seconds = 30 }) }) },
})
local at = playTo(engine, 15, 15)
check("a reveal with a deadline starts lit", #spotters(engine) == 1)

at = playTo(engine, at + 1, 900 - 1)
check("and is still lit a frame before it", #spotters(engine) == 1, #spotters(engine))

playTo(engine, at + 1, 915)
check("and goes out on it", #spotters(engine) == 0, #spotters(engine))

engine = playing({ triggers = { once("look", { reveals({ zone = "depot", team = "player" }) }) } })
playTo(engine, 15, 3600)
check("a reveal with no deadline is the rest of the mission", #spotters(engine) == 1)

--------------------------------------------------------------------------------
-- A trigger that reveals the same zone over and over. One spotter, and the last
-- reveal decides when the fog comes back.
--------------------------------------------------------------------------------

engine = playing({
	triggers = {
		{
			id = "watch",
			enabled = true,
			["repeat"] = true,
			conditions = { op = "all", conditions = { { type = "time_elapsed", params = { seconds = 0 } } } },
			actions = { reveals({ zone = "depot", team = "player", seconds = 30 }) },
		},
	},
})
playTo(engine, 15, 900)
check("a repeating reveal lights the zone once rather than filling it with units",
	#spotters(engine) == 1, #spotters(engine))
check("and each one puts the deadline back, so the zone stays lit while the "
	.. "trigger keeps firing", spotters(engine)[1] ~= nil)

--------------------------------------------------------------------------------
-- What the mission's own counting sees, which is nothing.
--------------------------------------------------------------------------------

engine = playing({
	triggers = {
		once("look", { reveals({ zone = "depot", team = "player" }) }),
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
			id = "in-depot",
			enabled = true,
			["repeat"] = true,
			conditions = {
				op = "all",
				conditions = { { type = "units_in_zone", params = { team = "player", zone = "depot" } } },
			},
			actions = { { type = "probe", params = { mark = "in-depot" } } },
		},
		{
			id = "built",
			enabled = true,
			["repeat"] = true,
			conditions = {
				op = "all",
				conditions = { { type = "unit_built", params = { team = "player", unitDef = "wall" } } },
			},
			actions = { { type = "probe", params = { mark = "built" } } },
		},
	},
})
engine.env:GameFrame(15)
engine.env:GameFrame(30)

local marks = table.concat(engine.fired, ",")
check("a team whose only unit is a spotter still reads as wiped",
	marks:find("wiped") ~= nil, marks)
check("a spotter standing in a zone is in no zone as far as the mission is concerned",
	marks:find("in%-depot") == nil, marks)
check("and it is not something the team built", marks:find("built") == nil, marks)
check("while the engine still counts it, which is what makes the zone visible: "
	.. "the team has its anchor and its spotter",
	engine.env.Spring.GetTeamUnitCount(0) == 2, engine.env.Spring.GetTeamUnitCount(0))

--------------------------------------------------------------------------------
-- What an author can get wrong.
--------------------------------------------------------------------------------

engine = playing({ triggers = { once("look", { reveals({ zone = "nowhere", team = "player" }) }) } })
engine.env:GameFrame(15)
check("a zone the mission never declared reveals nothing", #spotters(engine) == 0)
check("and is reported", logged(engine, "no zone named nowhere to reveal"))

engine = playing({ triggers = { once("look", { reveals({ zone = "depot", team = "nobody" }) }) } })
engine.env:GameFrame(15)
check("a team the mission never declared reveals nothing", #spotters(engine) == 0)
check("and is reported", logged(engine, "no team named nobody in this mission"))

engine = playing({ triggers = { once("look", { reveals({ zone = "depot", team = "player" }) }) } },
	{ defList = { { name = "turret", speed = 0 }, { name = "grunt" } } })
engine.env:GameFrame(15)
check("a game with no def that does nothing reveals nothing",
	engine.env.Spring.GetTeamUnitCount(0) == 0, engine.env.Spring.GetTeamUnitCount(0))
check("and is told what that costs", logged(engine, "can be a mission spotter"))

--------------------------------------------------------------------------------
-- A reveal that names no team means the team the player is on, the same one a
-- victory that names none does.
--------------------------------------------------------------------------------

engine = playing({ triggers = { once("look", { reveals({ zone = "depot" }) }) } })
engine.env:GameFrame(15)
local _, spotter = only(engine)
check("a reveal with no team named lights the zone for the human's team",
	spotter and spotter.team == 0, spotter and spotter.team)

engine = playing({ triggers = { once("look", { reveals({ zone = "depot" }) }) } },
	{ players = { [0] = { team = 1, spectator = true } } })
engine.env:GameFrame(15)
_, spotter = only(engine)
check("and with nobody playing, the lowest mission team", spotter and spotter.team == 0,
	spotter and spotter.team)
check("said out loud", logged(engine, "no human is playing a mission team"))

--------------------------------------------------------------------------------
-- The published handle, which is how a game's own actions reveal an area.
--------------------------------------------------------------------------------

engine = playing({})
local reveal = engine.GG.CoilboxMission.reveal

check("revealing through the handle reveals", reveal.reveal("depot", "player") == true)
check("and puts a spotter up", #spotters(engine) == 1)
check("revealing a zone the mission has not got reveals nothing",
	reveal.reveal("nowhere", "player") == false)

unitID = only(engine)
check("the spotter is one", reveal.isSpotter(unitID) == true)
check("and counts as one for its team", reveal.spotterCount(0) == 1, reveal.spotterCount(0))
check("but not for anyone else's", reveal.spotterCount(1) == 0)

check("hiding the zone again puts the fog back", reveal.hide("depot", "player") == true)
check("and takes the spotter off", #spotters(engine) == 0)
check("hiding one that was never revealed does nothing", reveal.hide("yard", "player") == false)

check("revealing it again works, because the first spotter is forgotten",
	reveal.reveal("depot", "player") == true)
unitID = only(engine)
engine.env.Spring.DestroyUnit(unitID)
check("a spotter that died despite being invulnerable is no longer counted",
	reveal.spotterCount(0) == 0, reveal.spotterCount(0))
check("and the zone can be lit again", reveal.reveal("depot", "player") == true)

--------------------------------------------------------------------------------
-- Revealing is synced only, like everything that puts a unit on the map.
--------------------------------------------------------------------------------

local unsynced = load({ coilbox_mission = "demo" },
	missionFiles(compiled({ teams = TEAMS, zones = ZONES })), { synced = false })
unsynced.env:Initialize()
check("the unsynced half reveals nothing", unsynced.GG.CoilboxMission.reveal == nil)

support.report()
