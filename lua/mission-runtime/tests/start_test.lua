-- Proves the start a mission gets: its units on the map, its economy in the
-- bank, and the start the game would otherwise have given it undone. Run it
-- with:
--
--   luajit lua/mission-runtime/tests/start_test.lua
--
-- This directory is not part of the runtime a game vendors. Only luarules/,
-- luaui/ and missions/ are installed into a game.

local support = dofile((arg[0]:match("^(.*)/[^/]+$") or ".") .. "/support.lua")
local check, load, logged = support.check, support.load, support.logged
local missionFiles, compiled = support.missionFiles, support.compiled

-- Team 0 is the player, who keeps whatever commander the game spawns. Team 1 is
-- the enemy, whose units the scenario places itself.
local MISSION = compiled({
	teams = {
		player = {
			team = 0,
			resources = { metal = 500, energy = 250 },
			income = { metal = 6 },
			startUnits = { "armpw" },
		},
		enemy = { team = 1, noCommander = true },
	},
	actors = {
		{
			id = "hero",
			unitDef = "armcom",
			team = "player",
			pos = { x = 100, z = 200 },
			facing = 1,
			state = { hp = 0.5, invulnerable = true },
		},
		{
			id = "boss",
			unitDef = "corkrog",
			team = "enemy",
			pos = { x = 900, z = 800 },
			facing = 3,
			state = { unselectable = true },
		},
	},
})

local OPTIONS = {
	startPositions = { [0] = { x = 1000, z = 1000 } },
	-- Anything but flat, so a unit's height has to have come from its position.
	ground = function(x, z)
		return x + z
	end,
}

local function started(options)
	local engine = load({ coilbox_mission = "demo" }, missionFiles(MISSION), options or OPTIONS)
	engine.env:Initialize()
	engine.env:GameStart()
	return engine
end

--------------------------------------------------------------------------------
-- Spawning.
--------------------------------------------------------------------------------

local engine = started()
local published = engine.GG.CoilboxMission
local hero = engine.units[published.units.hero]
local boss = engine.units[published.units.boss]

check("an actor is on the map", hero ~= nil and hero.def == "armcom")
check("an actor is on its participant's engine team", boss ~= nil and boss.team == 1)
check("an actor keeps its facing", boss.facing == 3)
check("an actor sits on the ground under its position",
	hero.x == 100 and hero.z == 200 and hero.y == 300,
	string.format("%g,%g,%g", hero.x, hero.y, hero.z))

check("a team's start units are on the map", #engine.alive() == 3, #engine.alive() .. " units")
check("a start unit sits at its team's start position",
	engine.alive()[3].x == 1000 and engine.alive()[3].z == 1000)

check("an actor is addressable by its scenario id", published.units.hero ~= nil)
check("a start unit is not addressable", published.units.armpw == nil)
check("actor records are published", published.actors.boss.unitDef == "corkrog")
check("the team plan is published", published.teams[1].id == "enemy")

--------------------------------------------------------------------------------
-- Actor state.
--------------------------------------------------------------------------------

check("stated health is a fraction of the unit's own maximum", hero.health == 50, hero.health)
check("an actor with no stated health is left alone", boss.health == 100)

local damage = engine.env:UnitPreDamaged(published.units.hero)
check("an invulnerable actor takes no damage", damage == 0, tostring(damage))
check("every other unit takes its damage", engine.env:UnitPreDamaged(published.units.boss) == nil)

engine.env.Spring.DestroyUnit(published.units.hero)
check("a dead actor is no longer addressable", published.units.hero == nil)
check("a dead actor's invulnerability does not outlive it",
	engine.env:UnitPreDamaged(1) == nil)

--------------------------------------------------------------------------------
-- Suppressing the start the game would have given.
--------------------------------------------------------------------------------

engine = started()
local intruder = engine.spawn("armcom", 1)
check("the game's spawn for a mission-owned team is undone",
	engine.units[intruder].alive == false)

local kept = engine.spawn("armcom", 0)
check("the game's spawn for a team the mission does not own is left alone",
	engine.units[kept].alive == true)

local building = engine.spawn("armsolar", 1, 42)
check("anything with a builder is left alone", engine.units[building].alive == true)

check("the mission's own units survive their own suppression",
	engine.units[engine.GG.CoilboxMission.units.boss].alive == true)

engine.env:GameFrame(0)
check("the start window is still open on frame 0",
	engine.units[engine.spawn("armcom", 1)].alive == false)

engine.env:GameFrame(1)
check("the start window closes once the game is running",
	engine.units[engine.spawn("armcom", 1)].alive == true)

-- Issue #884. Undoing a start only reaches as far as the window, and Splinter
-- Faction spawns 1800 frames past it, so what a game is actually asked to do is
-- not spawn. The question it asks holds for the whole mission, because it is the
-- scenario's own answer rather than anything about what frame it is.
engine = started()
local mission = engine.GG.CoilboxMission
check("the contract says a team the scenario spawns for is the mission's",
	mission.suppressesStart(1) == true)
check("and that a team it does not spawn for is still the game's",
	mission.suppressesStart(0) == false)
check("and says nothing about a team the mission has no participant for",
	mission.suppressesStart(7) == false)

engine.env:GameFrame(1)
check("and it still says so long after the start window has closed",
	mission.suppressesStart(1) == true)

-- Issue #888. A game whose start is a sequence of pre-game phases rather than a
-- call asks the same question about the game, because a faction picker and a
-- start position picker are global and decide nothing the mission has decided.
check("a game whose teams do not all belong to the mission still runs its phases",
	mission.suppressesEveryStart() == false)

local OWNS_EVERY_START = compiled({
	teams = {
		player = { team = 0, noCommander = true },
		enemy = { team = 1, noCommander = true },
	},
})

local function owningEveryStart(options)
	local owner = load({ coilbox_mission = "demo" }, missionFiles(OWNS_EVERY_START), options)
	owner.env:Initialize()
	return owner.GG.CoilboxMission
end

check("a game whose every team the mission started skips them",
	owningEveryStart().suppressesEveryStart() == true)
check("and Gaia is not a team that wants a start",
	owningEveryStart({ teamList = { 0, 1, 2 }, gaiaTeam = 2 })
		.suppressesEveryStart() == true)
check("but a team the mission says nothing about is",
	owningEveryStart({ teamList = { 0, 1, 2 } }).suppressesEveryStart() == false)

--------------------------------------------------------------------------------
-- Economy.
--------------------------------------------------------------------------------

engine = started()
check("nothing lands in the bank before the game runs", engine.resources[0] == nil)

engine.env:GameFrame(1)
check("a team's stated bank is what it starts with",
	engine.resources[0].m == 500 and engine.resources[0].e == 250)
check("a team the scenario says nothing about starts with nothing",
	engine.resources[1].m == 0 and engine.resources[1].e == 0)

check("free income is spread over the second it is quoted per",
	engine.income[0].m == 6 / 30, tostring(engine.income[0] and engine.income[0].m))
engine.env:GameFrame(2)
check("free income keeps arriving", engine.income[0].m == 2 * 6 / 30)
check("a team with no stated income gets none", engine.income[1] == nil)

--------------------------------------------------------------------------------
-- A scenario the game cannot satisfy.
--------------------------------------------------------------------------------

local missing = { startPositions = OPTIONS.startPositions, ground = OPTIONS.ground, defs = { armcom = true } }
engine = started(missing)
check("a unit def the game does not have is reported", logged(engine, "could not spawn corkrog"))
check("the rest of the mission still spawns", engine.GG.CoilboxMission.units.hero ~= nil)

--------------------------------------------------------------------------------
-- The unsynced half.
--------------------------------------------------------------------------------

engine = started()
local unsynced = load({ coilbox_mission = "demo" }, missionFiles(MISSION), { synced = false })
unsynced.env:Initialize()

check("the unsynced half does not police unit creation", unsynced.env.UnitCreated == nil)
check("the unsynced half reads the mission too", unsynced.GG.CoilboxMission.id == "demo")

for _, message in ipairs(engine.sent) do
	unsynced.env:RecvFromSynced(unpack(message))
end

local bossID = engine.GG.CoilboxMission.units.boss
check("the unsynced half learns which unit an actor became",
	unsynced.GG.CoilboxMission.units.boss == bossID)
check("an unselectable actor cannot be clicked", unsynced.noSelect[bossID] == true)
check("every other actor can be", unsynced.noSelect[engine.GG.CoilboxMission.units.hero] == nil)
check("another gadget's message is passed on untouched",
	unsynced.env:RecvFromSynced("something_else", "boss", 99) == nil)

support.report()
