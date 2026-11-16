-- Proves the neutral team (issue #5252): what a scenario places for it lands on
-- the engine's Gaia team, marked neutral and holding its fire, and Gaia is drawn
-- in the scenario's colour. Run it with:
--
--   luajit lua/mission-runtime/tests/neutral_test.lua
--
-- This directory is not part of the runtime a game vendors. Only luarules/,
-- luaui/ and missions/ are installed into a game.

local support = dofile((arg[0]:match("^(.*)/[^/]+$") or ".") .. "/support.lua")
local check, load, logged = support.check, support.load, support.logged
local missionFiles, compiled = support.missionFiles, support.compiled

local GAIA = 2

local MISSION = compiled({
	teams = {
		player = { team = 0 },
		neutral = { gaia = true, color = { 0.2, 0.4, 0.6 } },
	},
	actors = {
		{ id = "hero", unitDef = "armcom", team = "player", pos = { x = 100, z = 200 } },
		{ id = "prize", unitDef = "armmex", team = "neutral", pos = { x = 500, z = 500 } },
	},
})

local function loaded(options)
	local engine = load({ coilbox_mission = "demo" }, missionFiles(MISSION), options)
	engine.env:Initialize()
	return engine
end

local function started(options)
	local engine = loaded(options)
	engine.env:GameStart()
	return engine
end

local function ordersTo(engine, unitID, cmd)
	local out = {}
	for _, order in ipairs(engine.orders) do
		if order[1] == unitID and order[2] == cmd then
			out[#out + 1] = order
		end
	end
	return out
end

local engine = started({ teamList = { 0, 1, GAIA }, gaiaTeam = GAIA })
local units = engine.GG.CoilboxMission.units
local prize, hero = units.prize, units.hero

check("a neutral team's unit is on the Gaia team", engine.units[prize] and engine.units[prize].team == GAIA)
check("and it is marked neutral", engine.neutral[prize] == true)
local holds = ordersTo(engine, prize, engine.env.CMD.FIRE_STATE)
check("and it holds its fire", #holds == 1 and holds[1][3][1] == 0)
check("a participant's unit is not marked neutral", engine.neutral[hero] == nil)
check("and keeps its fire state", #ordersTo(engine, hero, engine.env.CMD.FIRE_STATE) == 0)

local unsynced = loaded({ synced = false, teamList = { 0, 1, GAIA }, gaiaTeam = GAIA })
local color = unsynced.teamColors[GAIA]
check("the unsynced half draws Gaia in the neutral team's colour",
	color and color[1] == 0.2 and color[2] == 0.4 and color[3] == 0.6)
check("and touches no other team's colour", unsynced.teamColors[0] == nil)

local noGaia = started({ teamList = { 0, 1 } })
check("a game with no Gaia team places nothing for the neutral team",
	noGaia.GG.CoilboxMission.units.prize == nil)
check("and says why", logged(noGaia, "no Gaia team"))

support.report()
